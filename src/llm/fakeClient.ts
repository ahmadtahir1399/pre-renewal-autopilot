// Test double for LlmClient: returns queued responses and records every call.
// Goes through the SAME retry/validation path as the real client.

import {
  type ChatMessage,
  type CompleteJsonRequest,
  type CompleteJsonResult,
  completeJsonWithRetries,
  type LlmClient,
  type LlmUsage,
} from './client.js';

export interface FakeResponse {
  /** Raw model text, or an object that will be JSON-serialised. */
  output: string | object;
  usage?: LlmUsage;
}

export class FakeLlmClient implements LlmClient {
  readonly model: string;
  /** Every conversation sent, one entry per attempt (copies, safe to inspect). */
  readonly calls: ChatMessage[][] = [];
  private readonly queue: FakeResponse[];

  constructor(responses: Array<string | object | FakeResponse> = [], model = 'fake-model') {
    this.model = model;
    this.queue = responses.map((r) => (typeof r === 'object' && r !== null && 'output' in r ? (r as FakeResponse) : { output: r }));
  }

  enqueue(...responses: Array<string | object>): void {
    for (const output of responses) this.queue.push({ output });
  }

  get callCount(): number {
    return this.calls.length;
  }

  completeJson<T>(request: CompleteJsonRequest<T>): Promise<CompleteJsonResult<T>> {
    return completeJsonWithRetries(async (messages) => {
      this.calls.push(messages.map((m) => ({ ...m })));
      const next = this.queue.shift();
      if (!next) throw new Error('FakeLlmClient: no queued response left');
      return {
        text: typeof next.output === 'string' ? next.output : JSON.stringify(next.output),
        usage: next.usage ?? { inputTokens: 1000, outputTokens: 200 },
        model: this.model,
      };
    }, request);
  }
}
