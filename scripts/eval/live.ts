// LIVE extraction for the evaluation: the real readPolicyTerms path with the real LLM and the
// cache DISABLED for both reads and writes (no cache is passed). Every HTTP response is counted
// through the client's onResponse hook; failed requests are retried here with backoff so every
// retry is visible. Raw results go to reports/raw after EACH document, so nothing paid is lost.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';
import { AutopilotError } from '../../src/domain/errors.js';
import { parseGroundTruth } from '../../src/domain/schemas.js';
import type { GroundTruth } from '../../src/domain/types.js';
import { readPolicyTerms } from '../../src/documents/index.js';
import type { LlmClient, LlmResponseInfo } from '../../src/llm/client.js';
import type { DocExtraction, DocRef, RawRepeat, Side, TypedErrorCheck } from './types.js';

export const TRANSPORT_RETRIES = 4;
export const BACKOFF_BASE_MS = 2000;
/** Validation attempts per read (1 + MAX_RETRIES in src/llm/client.ts). */
export const VALIDATION_ATTEMPTS = 3;

export function loadGroundTruths(fixturesDir: string): GroundTruth[] {
  const dir = path.join(fixturesDir, 'ground-truth');
  return readdirSync(dir)
    .filter((f) => /^pol-s\d{2}\.json$/.test(f))
    .sort()
    .map((f) => parseGroundTruth(JSON.parse(readFileSync(path.join(dir, f), 'utf8')), f));
}

export interface TypedCheckRef extends DocRef {
  expected: TypedErrorCheck['expected'];
}

/** Documents with answer-key terms and a text layer are measured; missing / image-only ones are typed-error checks. */
export function planDocuments(fixturesDir: string, truths: readonly GroundTruth[]): { measured: DocRef[]; typedChecks: TypedCheckRef[] } {
  const root = path.dirname(path.resolve(fixturesDir));
  const measured: DocRef[] = [];
  const typedChecks: TypedCheckRef[] = [];
  for (const truth of truths) {
    for (const side of ['expiring', 'renewal'] as const) {
      const doc = truth.documents[side];
      const docPath = path.join(root, ...(doc.path ?? `${path.basename(fixturesDir)}/documents/${truth.policyId}/${side}.pdf`).split('/'));
      if (!doc.exists) typedChecks.push({ policyId: truth.policyId, side, path: docPath, expected: 'document_missing' });
      else if (doc.hasTextLayer === false) typedChecks.push({ policyId: truth.policyId, side, path: docPath, expected: 'document_unreadable' });
      else if (truth.expectedTerms[side]) measured.push({ policyId: truth.policyId, side, path: docPath });
    }
  }
  return { measured, typedChecks };
}

export function classifyError(error: unknown): { code: string; transient: boolean } {
  if (error instanceof AutopilotError) return { code: error.code, transient: false };
  if (error instanceof APIConnectionTimeoutError) return { code: 'timeout', transient: true };
  if (error instanceof APIConnectionError) return { code: 'connection_error', transient: true };
  if (error instanceof APIError) {
    if (error.status === 429) return { code: 'rate_limited', transient: true };
    if (typeof error.status === 'number' && error.status >= 500) return { code: 'api_error', transient: true };
    return { code: 'api_error', transient: false };
  }
  return { code: 'unexpected', transient: false };
}

function shortMessage(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).replace(/\s+/g, ' ').slice(0, 200);
}

export type LlmFactory = (onResponse: (info: LlmResponseInfo) => void) => LlmClient;

export interface MeasureDeps {
  llmFactory: LlmFactory;
  sleep: (ms: number) => Promise<void>;
  /** Wall clock for durations only (scripts may read the real clock). */
  nowMs: () => number;
}

export async function measureDocument(doc: DocRef, deps: MeasureDeps): Promise<DocExtraction> {
  const usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: null as number | null };
  let httpResponses = 0;
  const llm = deps.llmFactory((info) => {
    httpResponses++;
    usage.inputTokens += info.inputTokens;
    usage.outputTokens += info.outputTokens;
    if (info.cachedInputTokens !== null) usage.cachedInputTokens = (usage.cachedInputTokens ?? 0) + info.cachedInputTokens;
  });
  const record: Omit<DocExtraction, 'ok' | 'errorCode' | 'errorMessage' | 'terms' | 'warnings' | 'durationMs'> = {
    policyId: doc.policyId,
    side: doc.side,
    usage,
    httpResponses: 0,
    failedCalls: 0,
    rateLimited: 0,
    timeouts: 0,
    transportRetries: 0,
  };
  const started = deps.nowMs();
  for (let attempt = 0; ; attempt++) {
    try {
      // No cache argument: the cache is disabled for both reads and writes.
      const result = await readPolicyTerms(doc.path, { llm, policyId: doc.policyId, documentKind: doc.side });
      return { ...record, httpResponses, ok: true, errorCode: null, errorMessage: null, terms: result.terms, warnings: result.warnings, durationMs: deps.nowMs() - started };
    } catch (error) {
      const { code, transient } = classifyError(error);
      if (transient) {
        record.failedCalls++;
        if (code === 'rate_limited') record.rateLimited++;
        if (code === 'timeout') record.timeouts++;
      }
      if (transient && attempt < TRANSPORT_RETRIES) {
        record.transportRetries++;
        await deps.sleep(BACKOFF_BASE_MS * 2 ** attempt);
        continue;
      }
      return { ...record, httpResponses, ok: false, errorCode: code, errorMessage: shortMessage(error), terms: null, warnings: [], durationMs: deps.nowMs() - started };
    }
  }
}

export async function runTypedErrorCheck(check: TypedCheckRef, llmFactory: LlmFactory): Promise<TypedErrorCheck> {
  let llmCalls = 0;
  const llm = llmFactory(() => {
    llmCalls++;
  });
  let actual: string | null = null;
  try {
    await readPolicyTerms(check.path, { llm, policyId: check.policyId, documentKind: check.side });
  } catch (error) {
    actual = error instanceof AutopilotError ? error.code : classifyError(error).code;
  }
  return { policyId: check.policyId, side: check.side, expected: check.expected, actual, llmCalls, pass: actual === check.expected && llmCalls === 0 };
}

async function pool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) await worker(items[next++] as T);
    }),
  );
}

export function rawFilePath(rawDir: string, date: string, promptVersion: string, repeat: number): string {
  return path.join(rawDir, `${date}-live-${promptVersion}-r${repeat}.json`);
}

export function readRaw(file: string): RawRepeat | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as RawRepeat;
}

function writeRaw(file: string, raw: RawRepeat): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
}

/** Results of a transport failure (rate limit, timeout, connection, 5xx) are re-measured on --resume. */
export function isReusable(doc: DocExtraction): boolean {
  return doc.ok || !['rate_limited', 'timeout', 'connection_error', 'api_error'].includes(doc.errorCode ?? '');
}

export interface RepeatOptions {
  rawDir: string;
  date: string;
  repeat: number;
  promptVersion: string;
  model: string;
  documents: readonly DocRef[];
  typedChecks: readonly TypedCheckRef[];
  concurrency: number;
  resume: boolean;
  deps: MeasureDeps;
  nowIso: () => string;
  log: (line: string) => void;
}

export async function runRepeat(options: RepeatOptions): Promise<RawRepeat> {
  const file = rawFilePath(options.rawDir, options.date, options.promptVersion, options.repeat);
  const previous = options.resume ? readRaw(file) : null;
  if (previous && (previous.model !== options.model || previous.promptVersion !== options.promptVersion)) {
    throw new Error(`${file} was measured with ${previous.model} / ${previous.promptVersion}; refusing to mix it with ${options.model} / ${options.promptVersion}`);
  }
  if (previous?.complete) {
    options.log(`repeat ${options.repeat}: reusing completed raw file ${path.basename(file)}`);
    return previous;
  }
  if (!options.resume && existsSync(file)) {
    throw new Error(`${file} already exists. Use --resume to reuse it, or move it away first (never delete a paid run silently).`);
  }
  const raw: RawRepeat = {
    schemaVersion: 1,
    date: options.date,
    repeat: options.repeat,
    promptVersion: options.promptVersion,
    model: options.model,
    startedAt: previous?.startedAt ?? options.nowIso(),
    finishedAt: null,
    complete: false,
    documents: (previous?.documents ?? []).filter(isReusable),
    typedErrorChecks: [],
  };
  const done = new Set(raw.documents.map((d) => `${d.policyId}/${d.side}`));
  const todo = options.documents.filter((d) => !done.has(`${d.policyId}/${d.side}`));
  if (done.size > 0) options.log(`repeat ${options.repeat}: reusing ${done.size} measured documents, measuring ${todo.length}`);
  await pool(todo, options.concurrency, async (doc) => {
    const result = await measureDocument(doc, options.deps);
    raw.documents.push(result);
    writeRaw(file, raw);
    options.log(`repeat ${options.repeat}: ${doc.policyId} ${doc.side} ${result.ok ? 'ok' : `FAILED (${result.errorCode})`} responses=${result.httpResponses} tokens=${result.usage.inputTokens}/${result.usage.outputTokens}`);
  });
  for (const check of options.typedChecks) raw.typedErrorChecks.push(await runTypedErrorCheck(check, options.deps.llmFactory));
  raw.documents.sort((a, b) => `${a.policyId}/${a.side}`.localeCompare(`${b.policyId}/${b.side}`));
  raw.finishedAt = options.nowIso();
  raw.complete = true;
  writeRaw(file, raw);
  return raw;
}

/** Every raw live repeat on disk (all prompt versions), oldest version first. */
export function loadAllRaw(rawDir: string): RawRepeat[] {
  if (!existsSync(rawDir)) return [];
  return readdirSync(rawDir)
    .filter((f) => /-live-[^-]+-r\d+\.json$/.test(f))
    .map((f) => readRaw(path.join(rawDir, f)) as RawRepeat)
    .filter((r) => r.complete)
    .sort((a, b) => (a.promptVersion === b.promptVersion ? a.repeat - b.repeat : a.startedAt.localeCompare(b.startedAt)));
}

export type { Side };
