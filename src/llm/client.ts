// LLM client interface plus the OpenAI implementation.
// The model only extracts text into JSON; it never does arithmetic, comparisons
// or severity decisions. Its output is UNTRUSTED: it must parse as JSON and pass
// the Zod schema, or we retry (up to 2 times) and then throw LlmOutputInvalidError.
//
// OpenAI SDK names used below were read from the installed openai@7.39.0 type
// definitions (client.d.ts, resources/chat/completions/completions.d.ts,
// resources/completions.d.ts). VERIFY them in the current official OpenAI docs.

import OpenAI from 'openai';
import type { z } from 'zod';
import { type Env, requireEnv } from '../config/env.js';
import { ConfigError, LlmOutputInvalidError } from '../domain/errors.js';
import { formatIssues } from '../domain/schemas.js';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompleteJsonRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Extra attempts after the first when output is invalid. Default 2, capped at 2. */
  maxRetries?: number;
}

export interface CompleteJsonResult<T> {
  data: T;
  /** Tokens summed over every attempt of this request. */
  usage: LlmUsage;
  model: string;
}

export interface LlmClient {
  /** ADDITION (D-036): model name, needed for the extraction cache key before any call. */
  readonly model: string;
  completeJson<T>(request: CompleteJsonRequest<T>): Promise<CompleteJsonResult<T>>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RawCompletion {
  text: string;
  usage: LlmUsage;
  model: string;
}

/** Sends one conversation to a model and returns its raw text. */
export type SendMessages = (messages: ChatMessage[]) => Promise<RawCompletion>;

export const MAX_RETRIES = 2;
const MAX_PROBLEMS_SENT_BACK = 20;

/** Models sometimes wrap JSON in a ```json fence even in JSON mode; remove only that wrapper. */
function stripCodeFence(text: string): string {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return match?.[1] ?? text;
}

function validate<T>(text: string, schema: z.ZodType<T>): { ok: true; data: T } | { ok: false; problems: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch (error) {
    return { ok: false, problems: [`output is not valid JSON (${error instanceof Error ? error.message : 'parse error'})`] };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, problems: formatIssues('output', result.error).slice(0, MAX_PROBLEMS_SENT_BACK) };
}

export function retryMessage(problems: string[]): string {
  return [
    'Your previous reply was rejected by the validator for these reasons:',
    ...problems.map((p) => `- ${p}`),
    'Reply again with ONLY a JSON object that matches the schema exactly. Do not add commentary.',
  ].join('\n');
}

/** Shared by every LlmClient (real and fake): JSON parse + Zod validation + retries with feedback. */
export async function completeJsonWithRetries<T>(
  send: SendMessages,
  request: CompleteJsonRequest<T>,
): Promise<CompleteJsonResult<T>> {
  const maxRetries = Math.min(Math.max(request.maxRetries ?? MAX_RETRIES, 0), MAX_RETRIES);
  const messages: ChatMessage[] = [
    { role: 'system', content: request.system },
    { role: 'user', content: request.user },
  ];
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let problems: string[] = [];
  let model = '';

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const raw = await send(messages.map((m) => ({ ...m })));
    usage.inputTokens += raw.usage.inputTokens;
    usage.outputTokens += raw.usage.outputTokens;
    model = raw.model;
    const result = validate(raw.text, request.schema);
    if (result.ok) return { data: result.data, usage, model };
    problems = result.problems;
    messages.push({ role: 'assistant', content: raw.text }, { role: 'user', content: retryMessage(problems) });
  }
  throw new LlmOutputInvalidError(problems, maxRetries + 1);
}

export interface OpenAiLlmClientOptions {
  apiKey: string;
  model: string;
  /** Sent only when set: some models reject a temperature parameter (D-031). */
  temperature?: number;
  /** Per-request timeout in milliseconds. Default 60 000. */
  timeoutMs?: number;
  /**
   * ADDITION (Prompt 5, D-126): the SDK's own retry count for network / 429 / 5xx errors. Default 2.
   * The evaluation sets 0 so every HTTP attempt is visible and counted by its own backoff loop.
   */
  sdkMaxRetries?: number;
  /** ADDITION (Prompt 5, D-126): called once per HTTP response. Measurement only; never sees any text. */
  onResponse?: (info: LlmResponseInfo) => void;
}

/** Token counts of one HTTP response (never prompt or reply text). */
export interface LlmResponseInfo {
  inputTokens: number;
  outputTokens: number;
  /** usage.prompt_tokens_details.cached_tokens when the API reports it; null when absent. */
  cachedInputTokens: number | null;
}

export class OpenAiLlmClient implements LlmClient {
  readonly model: string;
  private readonly client: OpenAI;
  private readonly temperature: number | undefined;
  private readonly onResponse: ((info: LlmResponseInfo) => void) | undefined;

  constructor(options: OpenAiLlmClientOptions) {
    this.model = options.model;
    this.temperature = options.temperature;
    this.onResponse = options.onResponse;
    // maxRetries here is the SDK's own retry for network/5xx errors, separate from validation retries.
    this.client = new OpenAI({ apiKey: options.apiKey, timeout: options.timeoutMs ?? 60_000, maxRetries: options.sdkMaxRetries ?? 2 });
  }

  completeJson<T>(request: CompleteJsonRequest<T>): Promise<CompleteJsonResult<T>> {
    return completeJsonWithRetries(this.send, request);
  }

  private readonly send: SendMessages = async (messages) => {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      // JSON mode: the reply is valid JSON; the schema itself is enforced by Zod (D-037).
      response_format: { type: 'json_object' },
      ...(this.temperature === undefined ? {} : { temperature: this.temperature }),
    });
    const choice = response.choices[0];
    const usage: LlmUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
    // prompt_tokens_details.cached_tokens read from the installed openai@7.39.0 types. VERIFY in the docs.
    this.onResponse?.({ ...usage, cachedInputTokens: response.usage?.prompt_tokens_details?.cached_tokens ?? null });
    return {
      // A refusal, an empty reply or a truncated reply all fail validation and are retried.
      text: choice?.message.content ?? '',
      usage,
      model: response.model,
    };
  };
}

/** Build the configured client. Requires LLM_PROVIDER, LLM_API_KEY and LLM_MODEL (never logged). */
export function createLlmClient(env: Env, measurement: Pick<OpenAiLlmClientOptions, 'sdkMaxRetries' | 'onResponse'> = {}): LlmClient {
  const checked = requireEnv(env, ['LLM_PROVIDER', 'LLM_API_KEY', 'LLM_MODEL']);
  const provider = checked.LLM_PROVIDER.toLowerCase();
  if (provider !== 'openai') {
    throw new ConfigError([`LLM_PROVIDER: "${checked.LLM_PROVIDER}" is not supported (supported: openai)`]);
  }
  return new OpenAiLlmClient({
    apiKey: checked.LLM_API_KEY,
    model: checked.LLM_MODEL,
    ...(checked.LLM_TEMPERATURE === undefined ? {} : { temperature: checked.LLM_TEMPERATURE }),
    ...measurement,
  });
}
