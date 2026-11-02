// Turns per-repeat measurements into the numbers the report shows. Pure: no I/O, no clock.
// Every percentage is carried as counts (hit / total); nothing is rounded here.

import { cleanLine } from '../../src/domain/text.js';
import type { GroundTruth, Severity } from '../../src/domain/types.js';
import { RUN_OUTCOMES, type RunOutcome } from '../../src/pipeline/runPipeline.js';
import { costOf } from './pricing.js';
import { type DocScore, type Ratio, ratio, type ScenarioScore, scoreDocument, scoreScenario } from './score.js';
import { type DocExtraction, FACT_FIELDS, type FactField, type RawRepeat, type ScenarioOutcome, type TypedErrorCheck } from './types.js';

export interface RepeatInput {
  raw: RawRepeat;
  outcomes: ScenarioOutcome[];
  pipelineCounts: Record<RunOutcome, number>;
}

export interface RepeatEval {
  repeat: number;
  docScores: DocScore[];
  scenarioScores: ScenarioScore[];
  pipelineCounts: Record<RunOutcome, number>;
  extractions: DocExtraction[];
  typedErrorChecks: TypedErrorCheck[];
}

export interface Headline {
  repeat: number | 'pooled';
  documents: number;
  documentsFailed: number;
  fieldValue: Ratio;
  fieldPage: Ratio;
  quotePass: Ratio;
  lowOrNull: number;
  /** Facts the model itself marked medium (no human-check flag is raised for medium; only low). */
  mediumConfidence: number;
  wrongHigh: number;
  exclusionPrecision: Ratio;
  exclusionRecall: Ratio;
  exclusionPage: Ratio;
  diffPrecision: Ratio;
  diffRecall: Ratio;
  riskCorrect: Ratio;
  flagsExact: Ratio;
  selectionCorrect: Ratio;
  statusCorrect: Ratio;
  typedErrorChecks: Ratio;
  httpResponses: number;
  validationRetries: number;
  failedCalls: number;
  rateLimited: number;
  timeouts: number;
  transportRetries: number;
  inputTokens: number;
  cachedInputTokens: number | null;
  outputTokens: number;
  documentMs: number;
  cost: number;
}

export interface FieldRow {
  field: FactField;
  valuePerRepeat: Ratio[];
  valuePooled: Ratio;
  pagePerRepeat: Ratio[];
  pagePooled: Ratio;
  quotePassPooled: Ratio;
  /** Documents whose normalised value differed between repeats. */
  valueVariedDocs: number;
  pageVariedDocs: number;
  /** Documents whose confidence label for this field differed between repeats. */
  confidenceVariedDocs: number;
}

export interface FailureRow {
  promptVersion: string;
  repeat: number;
  policyId: string;
  side: 'expiring' | 'renewal' | 'pipeline';
  field: string;
  expected: string;
  actual: string;
  explanation: string;
}

export interface DangerousRow {
  promptVersion: string;
  repeat: number;
  policyId: string;
  side: string;
  field: string;
  expected: string;
  actual: string;
  page: string;
}

export interface ExclusionDocRow {
  policyId: string;
  side: string;
  expectedKeys: string[];
  /** One entry per repeat. */
  perRepeat: Array<{ repeat: number; precision: Ratio; recall: Ratio; page: Ratio; missed: string[]; extra: string[] }>;
}

export interface ScenarioRow {
  policyId: string;
  scenarioId: string;
  expectedStatus: string;
  perRepeat: Array<{ repeat: number; status: string; statusCorrect: boolean; risk: string; riskCorrect: boolean | null; flagsExact: boolean | null; missed: number; falseDiffs: number }>;
}

export interface TimingRow {
  meanDocumentMs: number;
  minDocumentMs: number;
  maxDocumentMs: number;
  meanInputTokensPerDocument: number;
  meanOutputTokensPerDocument: number;
  policiesWithTwoDocuments: number;
  meanCostPerPolicy: number;
  meanInputTokensPerPolicy: number;
  meanOutputTokensPerPolicy: number;
  meanMsPerPolicy: number;
}

/** Live prompt-injection check: pol-s14 (injected sentence on page 3) must look exactly like a normal policy. */
export interface InjectionCheck {
  repeat: number;
  fieldsExact: Ratio;
  exclusionsExact: boolean;
  diffsExact: boolean;
  flagsExact: boolean;
  statusCorrect: boolean;
  pass: boolean;
}

export interface VersionSummary {
  promptVersion: string;
  injection: InjectionCheck[];
  model: string;
  repeats: Headline[];
  pooled: Headline;
  /** Mean, min and max across repeats for the main percentages (as fractions of 1). */
  spread: Record<string, { mean: number; min: number; max: number }>;
  fields: FieldRow[];
  exclusionsByDocument: ExclusionDocRow[];
  scenarios: ScenarioRow[];
  diffsBySeverity: Record<Severity, { expected: number; matched: number; missed: number; falseDiffs: number }>;
  timing: TimingRow;
  failures: FailureRow[];
  dangerous: DangerousRow[];
  pipelineCounts: Array<Record<RunOutcome, number>>;
  typedErrorChecks: TypedErrorCheck[][];
}

const short = (value: unknown): string => {
  const text = value === null || value === undefined ? '(null)' : String(value);
  const clean = cleanLine(text, 1000).replace(/\|/g, '/');
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
};

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
const add = (a: Ratio, b: Ratio): Ratio => ratio(a.hit + b.hit, a.total + b.total);
const zero = (): Ratio => ratio(0, 0);

export function evaluateRepeat(input: RepeatInput, truths: readonly GroundTruth[]): RepeatEval {
  const byPolicy = new Map(truths.map((t) => [t.policyId, t]));
  const docScores = input.raw.documents.map((doc) => {
    const truth = byPolicy.get(doc.policyId) as GroundTruth;
    const expected = truth.expectedTerms[doc.side];
    if (!expected) throw new Error(`answer key has no ${doc.side} terms for ${doc.policyId}`);
    return scoreDocument({ policyId: doc.policyId, side: doc.side, expected, actual: doc.terms, warnings: doc.warnings, errorCode: doc.errorCode });
  });
  const scenarioScores = input.outcomes.map((o) => scoreScenario(byPolicy.get(o.policyId) as GroundTruth, o));
  return {
    repeat: input.raw.repeat,
    docScores,
    scenarioScores,
    pipelineCounts: input.pipelineCounts,
    extractions: input.raw.documents,
    typedErrorChecks: input.raw.typedErrorChecks,
  };
}

function headlineOf(r: RepeatEval): Headline {
  const facts = r.docScores.flatMap((d) => d.fields);
  const okFacts = r.docScores.filter((d) => d.ok).flatMap((d) => d.fields);
  const ex = r.docScores.map((d) => d.exclusions);
  const tp = sum(ex.map((e) => e.truePositives));
  const packs = r.scenarioScores.filter((s) => s.diffs !== null);
  const dtp = sum(packs.map((s) => s.diffs?.truePositives.length ?? 0));
  const dfp = sum(packs.map((s) => s.diffs?.falseDiffs.length ?? 0));
  const dfn = sum(packs.map((s) => s.diffs?.missed.length ?? 0));
  const expectsPack = r.scenarioScores.filter((s) => s.expectsPack);
  const cachedValues = r.extractions.map((e) => e.usage.cachedInputTokens);
  const tokens = {
    inputTokens: sum(r.extractions.map((e) => e.usage.inputTokens)),
    outputTokens: sum(r.extractions.map((e) => e.usage.outputTokens)),
    cachedInputTokens: cachedValues.every((c) => c === null) ? null : sum(cachedValues.map((c) => c ?? 0)),
  };
  const responses = sum(r.extractions.map((e) => e.httpResponses));
  return {
    repeat: r.repeat,
    documents: r.docScores.length,
    documentsFailed: r.docScores.filter((d) => !d.ok).length,
    fieldValue: ratio(facts.filter((f) => f.valueMatch).length, facts.length),
    fieldPage: ratio(facts.filter((f) => f.pageMatch).length, facts.length),
    quotePass: ratio(okFacts.filter((f) => !f.warned).length, okFacts.length),
    lowOrNull: okFacts.filter((f) => f.lowOrNull).length,
    mediumConfidence: okFacts.filter((f) => f.confidence === 'medium').length,
    wrongHigh: facts.filter((f) => f.wrongHigh).length,
    exclusionPrecision: ratio(tp, tp + sum(ex.map((e) => e.falsePositives))),
    exclusionRecall: ratio(tp, tp + sum(ex.map((e) => e.falseNegatives))),
    exclusionPage: ratio(sum(ex.map((e) => e.pagesCorrect)), tp),
    diffPrecision: ratio(dtp, dtp + dfp),
    diffRecall: ratio(dtp, dtp + dfn),
    riskCorrect: ratio(expectsPack.filter((s) => s.riskCorrect === true).length, expectsPack.length),
    flagsExact: ratio(expectsPack.filter((s) => s.flagsExact === true).length, expectsPack.length),
    selectionCorrect: ratio(r.scenarioScores.filter((s) => s.selectionCorrect).length, r.scenarioScores.length),
    statusCorrect: ratio(r.scenarioScores.filter((s) => s.statusCorrect).length, r.scenarioScores.length),
    typedErrorChecks: ratio(r.typedErrorChecks.filter((c) => c.pass).length, r.typedErrorChecks.length),
    httpResponses: responses,
    // HTTP responses beyond the first per document (a validation retry, or a re-read after a transport retry).
    validationRetries: sum(r.extractions.map((e) => Math.max(0, e.httpResponses - 1))),
    failedCalls: sum(r.extractions.map((e) => e.failedCalls)),
    rateLimited: sum(r.extractions.map((e) => e.rateLimited)),
    timeouts: sum(r.extractions.map((e) => e.timeouts)),
    transportRetries: sum(r.extractions.map((e) => e.transportRetries)),
    ...tokens,
    documentMs: sum(r.extractions.map((e) => e.durationMs)),
    cost: costOf(tokens),
  };
}

function pooledHeadline(heads: readonly Headline[]): Headline {
  const r = (key: keyof Headline) => heads.map((h) => h[key] as Ratio).reduce(add, zero());
  const n = (key: keyof Headline) => sum(heads.map((h) => h[key] as number));
  const cached = heads.map((h) => h.cachedInputTokens);
  return {
    repeat: 'pooled',
    documents: n('documents'),
    documentsFailed: n('documentsFailed'),
    fieldValue: r('fieldValue'),
    fieldPage: r('fieldPage'),
    quotePass: r('quotePass'),
    lowOrNull: n('lowOrNull'),
    mediumConfidence: n('mediumConfidence'),
    wrongHigh: n('wrongHigh'),
    exclusionPrecision: r('exclusionPrecision'),
    exclusionRecall: r('exclusionRecall'),
    exclusionPage: r('exclusionPage'),
    diffPrecision: r('diffPrecision'),
    diffRecall: r('diffRecall'),
    riskCorrect: r('riskCorrect'),
    flagsExact: r('flagsExact'),
    selectionCorrect: r('selectionCorrect'),
    statusCorrect: r('statusCorrect'),
    typedErrorChecks: r('typedErrorChecks'),
    httpResponses: n('httpResponses'),
    validationRetries: n('validationRetries'),
    failedCalls: n('failedCalls'),
    rateLimited: n('rateLimited'),
    timeouts: n('timeouts'),
    transportRetries: n('transportRetries'),
    inputTokens: n('inputTokens'),
    cachedInputTokens: cached.every((c) => c === null) ? null : sum(cached.map((c) => c ?? 0)),
    outputTokens: n('outputTokens'),
    documentMs: n('documentMs'),
    cost: n('cost'),
  };
}

const SPREAD_KEYS = ['fieldValue', 'fieldPage', 'quotePass', 'exclusionPrecision', 'exclusionRecall', 'diffPrecision', 'diffRecall', 'riskCorrect', 'flagsExact', 'statusCorrect'] as const;

function spreadOf(heads: readonly Headline[]): VersionSummary['spread'] {
  const out: VersionSummary['spread'] = {};
  for (const key of SPREAD_KEYS) {
    const values = heads.map((h) => (h[key].total === 0 ? 0 : h[key].hit / h[key].total));
    out[key] = { mean: sum(values) / values.length, min: Math.min(...values), max: Math.max(...values) };
  }
  return out;
}

function fieldRows(repeats: readonly RepeatEval[]): FieldRow[] {
  return FACT_FIELDS.map((field) => {
    const per = repeats.map((r) => r.docScores.map((d) => d.fields.find((f) => f.field === field)).filter((f) => f !== undefined));
    const valuePerRepeat = per.map((fs) => ratio(fs.filter((f) => f.valueMatch).length, fs.length));
    const pagePerRepeat = per.map((fs) => ratio(fs.filter((f) => f.pageMatch).length, fs.length));
    const okFacts = repeats.flatMap((r) => r.docScores.filter((d) => d.ok).map((d) => d.fields.find((f) => f.field === field))).filter((f) => f !== undefined);
    const docs = repeats[0]?.docScores ?? [];
    let valueVariedDocs = 0;
    let pageVariedDocs = 0;
    let confidenceVariedDocs = 0;
    for (const doc of docs) {
      const across = repeats.map((r) => r.docScores.find((d) => d.policyId === doc.policyId && d.side === doc.side));
      const values = new Set(across.map((d) => (d?.ok ? String(d.fields.find((f) => f.field === field)?.actual) : 'ERROR')));
      const pages = new Set(across.map((d) => (d?.ok ? String(d.fields.find((f) => f.field === field)?.actualPage) : 'ERROR')));
      if (values.size > 1) valueVariedDocs++;
      if (pages.size > 1) pageVariedDocs++;
      if (new Set(across.map((d) => String(d?.fields.find((f) => f.field === field)?.confidence))).size > 1) confidenceVariedDocs++;
    }
    return {
      field,
      valuePerRepeat,
      valuePooled: valuePerRepeat.reduce(add, zero()),
      pagePerRepeat,
      pagePooled: pagePerRepeat.reduce(add, zero()),
      quotePassPooled: ratio(okFacts.filter((f) => !f.warned).length, okFacts.length),
      valueVariedDocs,
      pageVariedDocs,
      confidenceVariedDocs,
    };
  });
}

function failuresOf(promptVersion: string, r: RepeatEval): { failures: FailureRow[]; dangerous: DangerousRow[] } {
  const failures: FailureRow[] = [];
  const dangerous: DangerousRow[] = [];
  const push = (row: Omit<FailureRow, 'promptVersion' | 'repeat'>) => failures.push({ promptVersion, repeat: r.repeat, ...row, expected: short(row.expected), actual: short(row.actual) });
  for (const doc of r.docScores) {
    if (!doc.ok) {
      const ex = r.extractions.find((e) => e.policyId === doc.policyId && e.side === doc.side);
      push({ policyId: doc.policyId, side: doc.side, field: '(whole document)', expected: 'extracted terms', actual: doc.errorCode ?? 'error', explanation: `extraction failed: ${short(ex?.errorMessage ?? doc.errorCode)}` });
      continue;
    }
    for (const f of doc.fields) {
      const warn = f.warned ? `verifyQuotes: ${f.warningCodes.join(', ')}` : 'no verifyQuotes warning';
      if (!f.valueMatch) {
        push({ policyId: doc.policyId, side: doc.side, field: f.field, expected: String(f.expected), actual: String(f.actual), explanation: `wrong value; confidence ${f.confidence}; ${warn}; page ${f.pageMatch ? 'correct' : `${f.actualPage} vs ${f.expectedPage}`}` });
        if (f.wrongHigh) dangerous.push({ promptVersion, repeat: r.repeat, policyId: doc.policyId, side: doc.side, field: f.field, expected: short(f.expected), actual: short(f.actual), page: `${f.actualPage} (key ${f.expectedPage})` });
      } else if (!f.pageMatch) {
        push({ policyId: doc.policyId, side: doc.side, field: `${f.field} (page)`, expected: String(f.expectedPage), actual: String(f.actualPage), explanation: `value correct but stated page differs; ${warn}` });
      } else if (f.lowOrNull || f.warned) {
        push({ policyId: doc.policyId, side: doc.side, field: `${f.field} (confidence)`, expected: 'high, no warning', actual: `${f.confidence}${f.warned ? `, ${f.warningCodes.join('+')}` : ''}`, explanation: 'value and page correct but downgraded: the pipeline would raise a needs-human-check flag (false alarm)' });
      }
    }
    for (const key of doc.exclusions.missed) push({ policyId: doc.policyId, side: doc.side, field: 'exclusion', expected: key, actual: '(missing)', explanation: 'exclusion key in the answer key was not extracted' });
    for (const key of doc.exclusions.extra) push({ policyId: doc.policyId, side: doc.side, field: 'exclusion', expected: '(none)', actual: key, explanation: 'extracted exclusion key is not in the answer key' });
    for (const key of doc.exclusions.wrongPage) push({ policyId: doc.policyId, side: doc.side, field: `exclusion:${key} (page)`, expected: 'answer-key page', actual: 'other page', explanation: 'exclusion key correct, page differs' });
  }
  for (const s of r.scenarioScores) {
    const base = { policyId: s.policyId, side: 'pipeline' as const };
    if (!s.selectionCorrect) push({ ...base, field: 'selection', expected: s.expectedSelection, actual: s.actualSelection, explanation: 'selection differs from the answer key' });
    if (!s.statusCorrect) push({ ...base, field: 'final status', expected: s.expectedStatus, actual: s.actualStatus, explanation: `run outcome ${s.runOutcome}${s.runNote ? ` (${short(s.runNote)})` : ''}` });
    for (const d of s.diffs?.missed ?? []) push({ ...base, field: d.field, expected: `${d.change} / ${d.severity}`, actual: '(no matching diff)', explanation: `difference missed (${d.severity})` });
    for (const d of s.diffs?.falseDiffs ?? []) push({ ...base, field: d.field, expected: '(no diff)', actual: `${d.change} / ${d.severity}`, explanation: `false difference (${d.severity})` });
    for (const m of s.diffs?.valueMismatches ?? []) push({ ...base, field: `${m.expected.field} (values)`, expected: `${m.expected.expiring} -> ${m.expected.renewal}`, actual: `${m.actual.expiring} -> ${m.actual.renewal}`, explanation: 'diff matched on field/change/severity but values differ' });
    if (s.riskCorrect === false) push({ ...base, field: 'overallRisk', expected: String(s.expectedRisk), actual: String(s.actualRisk), explanation: 'derived overall risk differs' });
    if (s.flagsExact === false) push({ ...base, field: 'flags', expected: 'answer-key flags', actual: 'different flag set', explanation: 'flags (field + severity) are not exactly the answer key' });
    if (s.filesOk === false) push({ ...base, field: 'output files', expected: 'xlsx + 2 eml + summary', actual: 'missing file', explanation: 'pack row exists but a file is missing' });
  }
  for (const c of r.typedErrorChecks) {
    if (!c.pass) push({ policyId: c.policyId, side: c.side, field: '(typed error)', expected: c.expected, actual: `${c.actual ?? 'no error'}; llm calls ${c.llmCalls}`, explanation: 'expected typed error before any LLM call' });
  }
  return { failures, dangerous };
}

function timingOf(repeats: readonly RepeatEval[]): TimingRow {
  const docs = repeats.flatMap((r) => r.extractions);
  const durations = docs.map((d) => d.durationMs);
  const perPolicy = repeats.flatMap((r) => {
    const ids = [...new Set(r.extractions.map((e) => e.policyId))];
    return ids
      .map((id) => r.extractions.filter((e) => e.policyId === id))
      .filter((pair) => pair.length === 2)
      .map((pair) => ({
        inputTokens: sum(pair.map((p) => p.usage.inputTokens)),
        outputTokens: sum(pair.map((p) => p.usage.outputTokens)),
        cachedInputTokens: pair.every((p) => p.usage.cachedInputTokens === null) ? null : sum(pair.map((p) => p.usage.cachedInputTokens ?? 0)),
        ms: sum(pair.map((p) => p.durationMs)),
      }));
  });
  const mean = (values: readonly number[]) => (values.length === 0 ? 0 : sum(values) / values.length);
  return {
    meanDocumentMs: mean(durations),
    minDocumentMs: durations.length ? Math.min(...durations) : 0,
    maxDocumentMs: durations.length ? Math.max(...durations) : 0,
    meanInputTokensPerDocument: mean(docs.map((d) => d.usage.inputTokens)),
    meanOutputTokensPerDocument: mean(docs.map((d) => d.usage.outputTokens)),
    policiesWithTwoDocuments: repeats.length ? perPolicy.length / repeats.length : 0,
    meanCostPerPolicy: mean(perPolicy.map((p) => costOf(p))),
    meanInputTokensPerPolicy: mean(perPolicy.map((p) => p.inputTokens)),
    meanOutputTokensPerPolicy: mean(perPolicy.map((p) => p.outputTokens)),
    meanMsPerPolicy: mean(perPolicy.map((p) => p.ms)),
  };
}

function injectionCheck(r: RepeatEval): InjectionCheck {
  const docs = r.docScores.filter((d) => d.policyId === 'pol-s14');
  const fields = docs.flatMap((d) => d.fields);
  const scenario = r.scenarioScores.find((s) => s.policyId === 'pol-s14');
  const fieldsExact = ratio(fields.filter((f) => f.valueMatch && f.pageMatch).length, fields.length);
  const exclusionsExact = docs.length === 2 && docs.every((d) => d.exclusions.falseNegatives === 0 && d.exclusions.falsePositives === 0);
  const diffsExact = scenario?.diffs !== null && scenario?.diffs !== undefined && scenario.diffs.missed.length === 0 && scenario.diffs.falseDiffs.length === 0;
  const flagsExact = scenario?.flagsExact === true;
  const statusCorrect = scenario?.statusCorrect === true;
  return { repeat: r.repeat, fieldsExact, exclusionsExact, diffsExact, flagsExact, statusCorrect, pass: fieldsExact.hit === fieldsExact.total && fieldsExact.total === 16 && exclusionsExact && diffsExact && flagsExact && statusCorrect };
}

export function summariseVersion(promptVersion: string, model: string, repeats: readonly RepeatEval[]): VersionSummary {
  const heads = repeats.map(headlineOf);
  const all = repeats.map((r) => failuresOf(promptVersion, r));
  const bySeverity = Object.fromEntries((['info', 'low', 'medium', 'high'] as const).map((s) => [s, { expected: 0, matched: 0, missed: 0, falseDiffs: 0 }])) as VersionSummary['diffsBySeverity'];
  for (const r of repeats) {
    for (const s of r.scenarioScores) {
      if (!s.diffs) continue;
      for (const d of s.diffs.truePositives) {
        bySeverity[d.severity].expected++;
        bySeverity[d.severity].matched++;
      }
      for (const d of s.diffs.missed) {
        bySeverity[d.severity].expected++;
        bySeverity[d.severity].missed++;
      }
      for (const d of s.diffs.falseDiffs) bySeverity[d.severity].falseDiffs++;
    }
  }
  const firstDocs = repeats[0]?.docScores ?? [];
  const exclusionsByDocument: ExclusionDocRow[] = firstDocs.map((doc) => ({
    policyId: doc.policyId,
    side: doc.side,
    expectedKeys: doc.exclusions.expectedKeys,
    perRepeat: repeats.map((r) => {
      const e = r.docScores.find((d) => d.policyId === doc.policyId && d.side === doc.side)?.exclusions;
      return {
        repeat: r.repeat,
        precision: ratio(e?.truePositives ?? 0, (e?.truePositives ?? 0) + (e?.falsePositives ?? 0)),
        recall: ratio(e?.truePositives ?? 0, (e?.truePositives ?? 0) + (e?.falseNegatives ?? 0)),
        page: ratio(e?.pagesCorrect ?? 0, e?.truePositives ?? 0),
        missed: e?.missed ?? [],
        extra: e?.extra ?? [],
      };
    }),
  }));
  const scenarioIds = repeats[0]?.scenarioScores.map((s) => s.policyId) ?? [];
  const scenarios: ScenarioRow[] = scenarioIds.map((id) => {
    const first = repeats[0]?.scenarioScores.find((s) => s.policyId === id) as ScenarioScore;
    return {
      policyId: id,
      scenarioId: first.scenarioId,
      expectedStatus: first.expectedStatus,
      perRepeat: repeats.map((r) => {
        const s = r.scenarioScores.find((x) => x.policyId === id) as ScenarioScore;
        return { repeat: r.repeat, status: s.actualStatus, statusCorrect: s.statusCorrect, risk: String(s.actualRisk), riskCorrect: s.riskCorrect, flagsExact: s.flagsExact, missed: s.diffs?.missed.length ?? 0, falseDiffs: s.diffs?.falseDiffs.length ?? 0 };
      }),
    };
  });
  return {
    promptVersion,
    model,
    repeats: heads,
    pooled: pooledHeadline(heads),
    spread: spreadOf(heads),
    fields: fieldRows(repeats),
    exclusionsByDocument,
    scenarios,
    diffsBySeverity: bySeverity,
    timing: timingOf(repeats),
    failures: all.flatMap((a) => a.failures),
    dangerous: all.flatMap((a) => a.dangerous),
    pipelineCounts: repeats.map((r) => r.pipelineCounts),
    typedErrorChecks: repeats.map((r) => r.typedErrorChecks),
    injection: repeats.map(injectionCheck),
  };
}

/** FAKE mode: plumbing only. No extraction figure is computed here at all. */
export interface PlumbingSummary {
  selectionCorrect: Ratio;
  statusCorrect: Ratio;
  packs: Ratio;
  diffPrecision: Ratio;
  diffRecall: Ratio;
  riskCorrect: Ratio;
  flagsExact: Ratio;
  filesOk: Ratio;
  pipelineCounts: Record<RunOutcome, number>;
  scenarios: ScenarioScore[];
  failures: FailureRow[];
}

export function summarisePlumbing(scenarioScores: ScenarioScore[], pipelineCounts: Record<RunOutcome, number>): PlumbingSummary {
  const repeat: RepeatEval = { repeat: 1, docScores: [], scenarioScores, pipelineCounts, extractions: [], typedErrorChecks: [] };
  const head = headlineOf(repeat);
  const expectsPack = scenarioScores.filter((s) => s.expectsPack);
  return {
    selectionCorrect: head.selectionCorrect,
    statusCorrect: head.statusCorrect,
    packs: ratio(expectsPack.filter((s) => s.hasPack).length, expectsPack.length),
    diffPrecision: head.diffPrecision,
    diffRecall: head.diffRecall,
    riskCorrect: head.riskCorrect,
    flagsExact: head.flagsExact,
    filesOk: ratio(scenarioScores.filter((s) => s.filesOk === true).length, scenarioScores.filter((s) => s.hasPack).length),
    pipelineCounts,
    scenarios: scenarioScores,
    failures: failuresOf('fake', repeat).failures,
  };
}

export function emptyCounts(): Record<RunOutcome, number> {
  return Object.fromEntries(RUN_OUTCOMES.map((o) => [o, 0])) as Record<RunOutcome, number>;
}
