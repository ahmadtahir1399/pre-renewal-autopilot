// Pure scoring functions: compare measured output with the answer keys. No I/O, no clock.

import type { ExtractedTerms, Flag, GroundTruth, Severity, TermDiff } from '../../src/domain/types.js';
import { parseDocumentDate } from '../../src/documents/verifyQuotes.js';
import type { ExtractionWarning } from '../../src/documents/verifyQuotes.js';
import { FACT_FIELDS, type FactField, type ScenarioOutcome, type Side } from './types.js';

const NUMBER_FIELDS = new Set<FactField>(['annualPremium', 'excess', 'coverLimit']);
const DATE_FIELDS = new Set<FactField>(['periodStart', 'periodEnd']);

/** Numbers: strip commas, spaces and currency symbols; compared to the cent. */
export function normaliseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

/** Dates: yyyy-mm-dd, also accepting the printed form "17 January 2027". */
export function normaliseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  return parseDocumentDate(trimmed) ?? trimmed.toLowerCase();
}

/** Text: trim, case-fold, collapse whitespace. */
export function normaliseText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normaliseFact(field: FactField, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (NUMBER_FIELDS.has(field)) {
    const n = normaliseNumber(value);
    return n === null ? null : String(n);
  }
  if (DATE_FIELDS.has(field)) return normaliseDate(value);
  return normaliseText(value);
}

export interface FieldScore {
  field: FactField;
  expected: string | null;
  actual: string | null;
  valueMatch: boolean;
  expectedPage: number | null;
  actualPage: number | null;
  pageMatch: boolean;
  confidence: 'high' | 'medium' | 'low' | null;
  /** verifyQuotes raised at least one warning for this field. */
  warned: boolean;
  warningCodes: string[];
  /** Confidence 'low' or value null (the "flag, never guess" path). */
  lowOrNull: boolean;
  /** The dangerous case: a WRONG value still marked high confidence. */
  wrongHigh: boolean;
}

export interface ExclusionScore {
  expectedKeys: string[];
  actualKeys: string[];
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** Matched keys whose page equals the answer key's page. */
  pagesCorrect: number;
  missed: string[];
  extra: string[];
  wrongPage: string[];
}

export interface DocScore {
  policyId: string;
  side: Side;
  ok: boolean;
  errorCode: string | null;
  fields: FieldScore[];
  exclusions: ExclusionScore;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export function scoreExclusions(expected: ExtractedTerms['keyExclusions'], actual: ExtractedTerms['keyExclusions'] | null): ExclusionScore {
  const expectedKeys = uniqueSorted(expected.map((e) => e.key));
  const actualKeys = uniqueSorted((actual ?? []).map((e) => e.key));
  const matched = expectedKeys.filter((k) => actualKeys.includes(k));
  const wrongPage = matched.filter((key) => {
    const want = expected.find((e) => e.key === key)?.sourcePage;
    return !(actual ?? []).some((e) => e.key === key && e.sourcePage === want);
  });
  return {
    expectedKeys,
    actualKeys,
    truePositives: matched.length,
    falsePositives: actualKeys.length - matched.length,
    falseNegatives: expectedKeys.length - matched.length,
    pagesCorrect: matched.length - wrongPage.length,
    missed: expectedKeys.filter((k) => !actualKeys.includes(k)),
    extra: actualKeys.filter((k) => !expectedKeys.includes(k)),
    wrongPage,
  };
}

export function scoreDocument(input: {
  policyId: string;
  side: Side;
  expected: ExtractedTerms;
  actual: ExtractedTerms | null;
  warnings: readonly ExtractionWarning[];
  errorCode: string | null;
}): DocScore {
  const { expected, actual } = input;
  const fields = FACT_FIELDS.map((field): FieldScore => {
    const want = expected[field];
    const got = actual ? actual[field] : null;
    const expectedValue = normaliseFact(field, want.value);
    const actualValue = got ? normaliseFact(field, got.value) : null;
    const valueMatch = actualValue !== null && actualValue === expectedValue;
    const codes = input.warnings.filter((w) => w.field === field).map((w) => w.code);
    const confidence = got ? got.confidence : null;
    return {
      field,
      expected: expectedValue,
      actual: actualValue,
      valueMatch,
      expectedPage: want.sourcePage,
      actualPage: got ? got.sourcePage : null,
      pageMatch: got !== null && got.sourcePage !== null && got.sourcePage === want.sourcePage,
      confidence,
      warned: codes.length > 0,
      warningCodes: codes,
      lowOrNull: got === null || got.value === null || got.confidence === 'low',
      wrongHigh: got !== null && actualValue !== null && !valueMatch && confidence === 'high',
    };
  });
  return {
    policyId: input.policyId,
    side: input.side,
    ok: actual !== null,
    errorCode: input.errorCode,
    fields,
    exclusions: scoreExclusions(expected.keyExclusions, actual ? actual.keyExclusions : null),
  };
}

// ---- differences, flags, risk, selection, status -------------------------------------------

export function diffKey(diff: Pick<TermDiff, 'field' | 'change' | 'severity'>): string {
  return `${diff.field}|${diff.change}|${diff.severity}`;
}

export interface DiffMatch {
  truePositives: TermDiff[];
  /** Expected diffs the pipeline did not produce. */
  missed: TermDiff[];
  /** Diffs the pipeline produced that the answer key does not have. */
  falseDiffs: TermDiff[];
  /** Matched diffs whose expiring/renewal values differ from the answer key. */
  valueMismatches: Array<{ expected: TermDiff; actual: TermDiff }>;
}

function sameDiffValue(a: TermDiff['expiring'], b: TermDiff['expiring']): boolean {
  if (typeof a === 'number' || typeof b === 'number') return normaliseNumber(a) === normaliseNumber(b);
  return normaliseText(a) === normaliseText(b);
}

/** A diff matches only if field (including exclusion key), change and severity all match (multiset). */
export function matchDiffs(expected: readonly TermDiff[], actual: readonly TermDiff[]): DiffMatch {
  const remaining = [...actual];
  const result: DiffMatch = { truePositives: [], missed: [], falseDiffs: [], valueMismatches: [] };
  for (const want of expected) {
    const index = remaining.findIndex((got) => diffKey(got) === diffKey(want));
    if (index < 0) {
      result.missed.push(want);
      continue;
    }
    const got = remaining.splice(index, 1)[0] as TermDiff;
    result.truePositives.push(got);
    if (!sameDiffValue(want.expiring, got.expiring) || !sameDiffValue(want.renewal, got.renewal)) result.valueMismatches.push({ expected: want, actual: got });
  }
  result.falseDiffs.push(...remaining);
  return result;
}

export function flagKey(flag: Pick<Flag, 'field' | 'severity'>): string {
  return `${flag.field}|${flag.severity}`;
}

/** Flags exact = the same multiset of (field, severity). Message wording is free text (D-019). */
export function flagsExact(expected: readonly Flag[], actual: readonly Flag[]): boolean {
  const a = expected.map(flagKey).sort();
  const b = actual.map(flagKey).sort();
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

export interface ScenarioScore {
  policyId: string;
  scenarioId: string;
  expectedSelection: string;
  actualSelection: string;
  selectionCorrect: boolean;
  expectedStatus: string;
  actualStatus: string;
  statusCorrect: boolean;
  expectsPack: boolean;
  hasPack: boolean;
  diffs: DiffMatch | null;
  expectedRisk: Severity | null;
  actualRisk: Severity | null;
  riskCorrect: boolean | null;
  flagsExact: boolean | null;
  /** Packs only: every output file exists. */
  filesOk: boolean | null;
  runOutcome: string;
  runNote: string | null;
}

export function scoreScenario(truth: GroundTruth, outcome: ScenarioOutcome): ScenarioScore {
  const expectedSelection = truth.expectedSelection.selected ? 'selected' : (truth.expectedSelection.skipReason ?? 'unknown');
  const hasPack = outcome.diffs !== null;
  const expectedDiffs = truth.expectedDiffs ?? [];
  return {
    policyId: truth.policyId,
    scenarioId: truth.scenarioId,
    expectedSelection,
    actualSelection: outcome.selection,
    selectionCorrect: expectedSelection === outcome.selection,
    expectedStatus: truth.expectedFinalStatus,
    actualStatus: outcome.finalStatus,
    statusCorrect: truth.expectedFinalStatus === outcome.finalStatus,
    expectsPack: truth.expectsPack,
    hasPack,
    diffs: truth.expectsPack ? matchDiffs(expectedDiffs, outcome.diffs ?? []) : hasPack ? matchDiffs([], outcome.diffs ?? []) : null,
    expectedRisk: truth.expectedOverallRisk,
    actualRisk: outcome.overallRisk,
    riskCorrect: truth.expectsPack ? outcome.overallRisk === truth.expectedOverallRisk : null,
    flagsExact: truth.expectsPack ? flagsExact(truth.expectedFlags ?? [], outcome.flags ?? []) : null,
    filesOk: outcome.filesOk,
    runOutcome: outcome.runOutcome,
    runNote: outcome.runNote,
  };
}

/** precision / recall as counts; the ratio is computed only for display. */
export interface Ratio {
  hit: number;
  total: number;
}

export function ratio(hit: number, total: number): Ratio {
  return { hit, total };
}

/** "26 of 28 (92.86%)" - two decimals, never rounded up to 100% when a miss exists. */
export function formatRatio(r: Ratio): string {
  if (r.total === 0) return '0 of 0 (n/a)';
  const pct = (r.hit / r.total) * 100;
  const shown = r.hit < r.total ? Math.min(Math.floor(pct * 100) / 100, 99.99) : 100;
  return `${r.hit} of ${r.total} (${shown.toFixed(2)}%)`;
}
