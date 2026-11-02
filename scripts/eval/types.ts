// Shapes shared by the evaluation scripts (scripts/evaluate.ts). Evaluation code lives in scripts/,
// not src/: it reads the answer keys, which production code must never see.

import type { ExtractedTerms, Flag, RenewalStatus, Severity, TermDiff } from '../../src/domain/types.js';
import type { ExtractionWarning } from '../../src/documents/verifyQuotes.js';
import type { RunOutcome } from '../../src/pipeline/runPipeline.js';

export type Side = 'expiring' | 'renewal';
export type EvalMode = 'fake' | 'live';

export const FACT_FIELDS = [
  'insurerName',
  'policyNumber',
  'policyType',
  'periodStart',
  'periodEnd',
  'annualPremium',
  'excess',
  'coverLimit',
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export interface DocRef {
  policyId: string;
  side: Side;
  /** Absolute path of the PDF. */
  path: string;
}

/** Token counts of one document read, summed over every HTTP response it needed. */
export interface DocUsage {
  inputTokens: number;
  outputTokens: number;
  /** Sum of usage.prompt_tokens_details.cached_tokens; null when the API never reported it. */
  cachedInputTokens: number | null;
}

/** One document, one repeat, as measured with the real LLM. Stored in reports/raw (gitignored). */
export interface DocExtraction {
  policyId: string;
  side: Side;
  ok: boolean;
  /** AutopilotError code, or rate_limited / timeout / api_error / unexpected. */
  errorCode: string | null;
  /** Short error text (max 200 chars). Never document text. */
  errorMessage: string | null;
  terms: ExtractedTerms | null;
  warnings: ExtractionWarning[];
  usage: DocUsage;
  /** HTTP responses received (1 = no validation retry). */
  httpResponses: number;
  /** HTTP requests that failed (429, 5xx, timeout, connection). */
  failedCalls: number;
  rateLimited: number;
  timeouts: number;
  /** Backoff retries made by the evaluation after a failed request. */
  transportRetries: number;
  durationMs: number;
}

export interface TypedErrorCheck {
  policyId: string;
  side: Side;
  expected: 'document_missing' | 'document_unreadable';
  actual: string | null;
  /** LLM HTTP responses during the check (must be 0: the error comes before any call). */
  llmCalls: number;
  pass: boolean;
}

export interface RawRepeat {
  schemaVersion: 1;
  date: string;
  repeat: number;
  promptVersion: string;
  model: string;
  startedAt: string;
  finishedAt: string | null;
  complete: boolean;
  documents: DocExtraction[];
  typedErrorChecks: TypedErrorCheck[];
}

export type SelectionResult = 'selected' | 'outside_window' | 'already_processed';

/** What the REAL pipeline produced for one scenario (fake reader or replayed live extraction). */
export interface ScenarioOutcome {
  policyId: string;
  selection: SelectionResult;
  runOutcome: RunOutcome;
  runNote: string | null;
  finalStatus: RenewalStatus;
  diffs: TermDiff[] | null;
  flags: Flag[] | null;
  overallRisk: Severity | null;
  /** For packs: xlsx, both .eml and summary.txt exist on disk. null when there is no pack. */
  filesOk: boolean | null;
}
