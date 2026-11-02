// The evaluation's own scoring must be right, or every number in the report is wrong.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGroundTruth } from '../src/domain/schemas.js';
import type { ExtractedTerms, TermDiff } from '../src/domain/types.js';
import { LlmOutputInvalidError } from '../src/domain/errors.js';
import { FakeLlmClient } from '../src/llm/fakeClient.js';
import { loadGroundTruths, measureDocument, planDocuments } from '../scripts/eval/live.js';
import { createReplayReader } from '../scripts/eval/pipelineReplay.js';
import { costOf } from '../scripts/eval/pricing.js';
import { flagsExact, formatRatio, matchDiffs, normaliseDate, normaliseFact, normaliseNumber, normaliseText, ratio, scoreDocument } from '../scripts/eval/score.js';

const FIXTURES = path.join(process.cwd(), 'fixtures');
const truth = (id: string) => parseGroundTruth(JSON.parse(readFileSync(path.join(FIXTURES, 'ground-truth', `${id}.json`), 'utf8')));

describe('normalisation', () => {
  it('numbers: strips commas, spaces and symbols', () => {
    expect(normaliseNumber('NZD 12,400.00')).toBe(12400);
    expect(normaliseNumber('$5,000')).toBe(5000);
    expect(normaliseNumber(12400.004)).toBe(12400);
    expect(normaliseNumber('n/a')).toBeNull();
  });
  it('dates: yyyy-mm-dd, also from the printed form', () => {
    expect(normaliseDate('2027-01-17')).toBe('2027-01-17');
    expect(normaliseDate('17 January 2027')).toBe('2027-01-17');
  });
  it('text: trim, case-fold, collapse whitespace', () => {
    expect(normaliseText('  Kestrel   Mutual\nInsurance ')).toBe('kestrel mutual insurance');
    expect(normaliseFact('policyType', 'Commercial_Property')).toBe('commercial_property');
  });
});

describe('formatRatio never hides a miss', () => {
  it('shows counts and never rounds 999/1000 up to 100%', () => {
    expect(formatRatio(ratio(26, 28))).toBe('26 of 28 (92.85%)');
    expect(formatRatio(ratio(999, 1000))).toBe('999 of 1000 (99.90%)');
    expect(formatRatio(ratio(99999, 100000))).toBe('99999 of 100000 (99.99%)');
    expect(formatRatio(ratio(5, 5))).toBe('5 of 5 (100.00%)');
  });
});

describe('document scoring', () => {
  const key = truth('pol-s01').expectedTerms.expiring as ExtractedTerms;

  it('the answer key scores perfectly against itself', () => {
    const score = scoreDocument({ policyId: 'pol-s01', side: 'expiring', expected: key, actual: key, warnings: [], errorCode: null });
    expect(score.fields.every((f) => f.valueMatch && f.pageMatch && !f.wrongHigh)).toBe(true);
    expect(score.exclusions.falseNegatives + score.exclusions.falsePositives).toBe(0);
  });

  it('a wrong value at high confidence is the dangerous case; at low confidence it is not', () => {
    const wrong = structuredClone(key);
    wrong.annualPremium = { ...wrong.annualPremium, value: 99999 };
    const high = scoreDocument({ policyId: 'pol-s01', side: 'expiring', expected: key, actual: wrong, warnings: [], errorCode: null });
    expect(high.fields.find((f) => f.field === 'annualPremium')).toMatchObject({ valueMatch: false, wrongHigh: true });
    wrong.annualPremium = { ...wrong.annualPremium, confidence: 'low' };
    const low = scoreDocument({ policyId: 'pol-s01', side: 'expiring', expected: key, actual: wrong, warnings: [], errorCode: null });
    expect(low.fields.find((f) => f.field === 'annualPremium')).toMatchObject({ valueMatch: false, wrongHigh: false, lowOrNull: true });
  });

  it('a failed extraction scores every field and exclusion as missed', () => {
    const score = scoreDocument({ policyId: 'pol-s01', side: 'expiring', expected: key, actual: null, warnings: [], errorCode: 'llm_output_invalid' });
    expect(score.fields.filter((f) => f.valueMatch)).toHaveLength(0);
    expect(score.exclusions.falseNegatives).toBe(key.keyExclusions.length);
  });

  it('exclusions: a missed key, an extra key and a wrong page are each counted', () => {
    const changed = structuredClone(key);
    const [first, ...rest] = changed.keyExclusions;
    changed.keyExclusions = [...rest.map((e, i) => (i === 0 ? { ...e, sourcePage: 3 } : e)), { key: 'cyber_event', title: 'x', summary: 'y', sourcePage: 4 }];
    const score = scoreDocument({ policyId: 'pol-s01', side: 'expiring', expected: key, actual: changed, warnings: [], errorCode: null });
    expect(score.exclusions.missed).toEqual([first?.key]);
    expect(score.exclusions.extra).toEqual(['cyber_event']);
    expect(score.exclusions.wrongPage).toHaveLength(1);
  });
});

describe('difference matching', () => {
  const diff = (field: string, change: TermDiff['change'], severity: TermDiff['severity']): TermDiff => ({ field, expiring: 1, renewal: 2, change, severity, facts: '' });

  it('matches only when field, change and severity all match', () => {
    const result = matchDiffs([diff('annualPremium', 'increased', 'high'), diff('exclusion:flood', 'added', 'high')], [diff('annualPremium', 'increased', 'medium'), diff('exclusion:flood', 'added', 'high')]);
    expect(result.truePositives).toHaveLength(1);
    expect(result.missed.map((d) => d.field)).toEqual(['annualPremium']);
    expect(result.falseDiffs.map((d) => `${d.field}/${d.severity}`)).toEqual(['annualPremium/medium']);
  });

  it('flags compare as a multiset of field + severity, ignoring message wording', () => {
    expect(flagsExact([{ field: 'excess', severity: 'medium', message: 'a' }], [{ field: 'excess', severity: 'medium', message: 'b' }])).toBe(true);
    expect(flagsExact([{ field: 'excess', severity: 'medium', message: 'a' }], [])).toBe(false);
  });
});

describe('live plan and measurement plumbing (no network)', () => {
  it('measures exactly 28 documents; pol-s07 renewal and pol-s08 expiring are typed-error checks', () => {
    const plan = planDocuments(FIXTURES, loadGroundTruths(FIXTURES));
    expect(plan.measured).toHaveLength(28);
    expect(plan.typedChecks.map((c) => `${c.policyId}/${c.side}/${c.expected}`)).toEqual(['pol-s07/renewal/document_missing', 'pol-s08/expiring/document_unreadable']);
  });

  it('a failed read is recorded with its typed error code, tokens of every response included, no backoff for non-transient errors', async () => {
    const doc = planDocuments(FIXTURES, loadGroundTruths(FIXTURES)).measured[0];
    if (!doc) throw new Error('no document');
    let responses = 0;
    const fake = new FakeLlmClient(['not json', 'not json', 'not json']);
    const result = await measureDocument(doc, {
      llmFactory: (onResponse) => ({
        model: fake.model,
        completeJson: async (request) => {
          try {
            return await fake.completeJson(request);
          } finally {
            for (; responses < fake.callCount; responses++) onResponse({ inputTokens: 10, outputTokens: 2, cachedInputTokens: null });
          }
        },
      }),
      sleep: async () => {
        throw new Error('must not back off');
      },
      nowMs: () => 0,
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'llm_output_invalid', httpResponses: 3, transportRetries: 0 });
    expect(result.usage).toEqual({ inputTokens: 30, outputTokens: 6, cachedInputTokens: null });
  });

  it('the replay reader returns the measured terms and re-throws a measured failure as the same typed error', async () => {
    const key = truth('pol-s01');
    const reader = createReplayReader(
      [
        { policyId: 'pol-s01', side: 'expiring', ok: true, errorCode: null, errorMessage: null, terms: key.expectedTerms.expiring, warnings: [], usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: null }, httpResponses: 1, failedCalls: 0, rateLimited: 0, timeouts: 0, transportRetries: 0, durationMs: 1 },
        { policyId: 'pol-s01', side: 'renewal', ok: false, errorCode: 'llm_output_invalid', errorMessage: 'bad', terms: null, warnings: [], usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: null }, httpResponses: 3, failedCalls: 0, rateLimited: 0, timeouts: 0, transportRetries: 0, durationMs: 1 },
      ],
      'm',
    );
    const ok = await reader.read(path.join(FIXTURES, 'documents', 'pol-s01', 'expiring.pdf'), { policyId: 'pol-s01', kind: 'expiring' });
    expect(ok.terms).toEqual(key.expectedTerms.expiring);
    await expect(reader.read(path.join(FIXTURES, 'documents', 'pol-s01', 'renewal.pdf'), { policyId: 'pol-s01', kind: 'renewal' })).rejects.toBeInstanceOf(LlmOutputInvalidError);
  });
});

describe('cost formula', () => {
  it('bills cached input at the cached price and treats an unreported cache count as an upper bound', () => {
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: null })).toBeCloseTo(1.45, 10);
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 500_000 })).toBeCloseTo(0.11, 10);
  });
});

describe('live report path end to end, with planted errors (no network)', () => {
  it('replay + aggregation + rendering count every planted miss and list the dangerous case', async () => {
    const { evaluateRepeat, summariseVersion } = await import('../scripts/eval/aggregate.js');
    const { runPipelineReplay } = await import('../scripts/eval/pipelineReplay.js');
    const { renderLive, SYNTHETIC_LINE } = await import('../scripts/eval/render.js');
    const { PRICING } = await import('../scripts/eval/pricing.js');
    const truths = loadGroundTruths(FIXTURES);
    const plan = planDocuments(FIXTURES, truths);
    const documents = plan.measured.map((doc) => {
      const terms = structuredClone(truths.find((t) => t.policyId === doc.policyId)?.expectedTerms[doc.side] ?? null);
      const failed = doc.policyId === 'pol-s13' && doc.side === 'renewal';
      // Planted error 1: pol-s02 renewal cover limit wrong at HIGH confidence (the dangerous case).
      if (terms && doc.policyId === 'pol-s02' && doc.side === 'renewal') terms.coverLimit = { ...terms.coverLimit, value: 10_000_000 };
      return {
        policyId: doc.policyId,
        side: doc.side,
        // Planted error 2: pol-s13 renewal extraction failed.
        ok: !failed,
        errorCode: failed ? 'llm_output_invalid' : null,
        errorMessage: failed ? 'LlmOutputInvalidError: test' : null,
        terms: failed ? null : terms,
        warnings: [],
        usage: { inputTokens: 2000, outputTokens: 400, cachedInputTokens: null },
        httpResponses: failed ? 3 : 1,
        failedCalls: 0,
        rateLimited: 0,
        timeouts: 0,
        transportRetries: 0,
        durationMs: 1000,
      };
    });
    const raw = { schemaVersion: 1 as const, date: '2026-10-19', repeat: 1, promptVersion: 'vTest', model: 'test-model', startedAt: 'a', finishedAt: 'b', complete: true, documents, typedErrorChecks: [] };
    const replay = await runPipelineReplay({ fixturesDir: FIXTURES, today: '2026-10-19', reader: createReplayReader(documents, 'test-model'), maxConcurrency: 2, compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 }, windowMinDays: 84, windowMaxDays: 112 });
    const version = summariseVersion('vTest', 'test-model', [evaluateRepeat({ raw, outcomes: replay.outcomes, pipelineCounts: replay.summary.counts }, truths)]);
    expect(version.pooled.documents).toBe(28);
    expect(version.pooled.documentsFailed).toBe(1);
    expect(version.pooled.fieldValue).toEqual({ hit: 28 * 8 - 8 - 1, total: 28 * 8 });
    expect(version.pooled.wrongHigh).toBe(1);
    expect(version.dangerous.map((d) => `${d.policyId}/${d.side}/${d.field}`)).toEqual(['pol-s02/renewal/coverLimit']);
    // pol-s02: the HIGH "limit decreased" diff is missed; pol-s13: no pack at all (needs_attention).
    expect(version.diffsBySeverity.high.missed).toBe(1);
    expect(version.scenarios.find((s) => s.policyId === 'pol-s13')?.perRepeat[0]?.status).toBe('needs_attention');
    expect(version.pooled.statusCorrect).toEqual({ hit: 14, total: 15 });
    const md = renderLive({ date: '2026-10-19', mode: 'live', model: 'test-model', promptVersion: 'vTest', compareRulesVersion: 'r1', thresholds: { premiumMediumPct: 10, premiumHighPct: 25, windowMinDays: 84, windowMaxDays: 112 }, repeats: 1, documents: 28, generatedBy: 'test' }, [version], 'vTest', 'test', PRICING);
    expect(md).toContain(SYNTHETIC_LINE);
    expect(md).toContain('| vTest | 1 | pol-s02 | renewal | coverLimit |');
    expect(md).toContain('extraction failed');
  });
});

describe('results summary and number checker', () => {
  it('extracts prose numbers but not ids, versions, code or list markers', async () => {
    const { extractNumbers } = await import('../scripts/eval/numbers.js');
    expect(extractNumbers('1. Step one\nWe measured 26 of 28 (92.85%) on 2026-10-19 for pol-s01 with gpt-5.4-nano v1.0.0, D-130, `npm run x -- 7` and 1,234 tokens.')).toEqual(['2026-10-19', '26', '28', '92.85', '1234']);
    expect(extractNumbers('A 60-90 second demo; 3227-6168 ms; pol-s01-x and D-130.')).toEqual(['60', '90', '3227', '6168']);
  });

  it('every number in a generated summary is found in the JSON it came from', async () => {
    const { knownFromJson, unmatchedNumbers } = await import('../scripts/eval/numbers.js');
    const { summaryLines } = await import('../scripts/eval/summaryLines.js');
    const { evaluateRepeat, summariseVersion } = await import('../scripts/eval/aggregate.js');
    const { runPipelineReplay } = await import('../scripts/eval/pipelineReplay.js');
    const truths = loadGroundTruths(FIXTURES);
    const documents = planDocuments(FIXTURES, truths).measured.map((doc) => ({
      policyId: doc.policyId,
      side: doc.side,
      ok: true,
      errorCode: null,
      errorMessage: null,
      terms: truths.find((t) => t.policyId === doc.policyId)?.expectedTerms[doc.side] ?? null,
      warnings: [],
      usage: { inputTokens: 2345, outputTokens: 456, cachedInputTokens: 1024 },
      httpResponses: 1,
      failedCalls: 0,
      rateLimited: 0,
      timeouts: 0,
      transportRetries: 0,
      durationMs: 1234,
    }));
    const raw = { schemaVersion: 1 as const, date: '2026-10-19', repeat: 1, promptVersion: 'vTest', model: 'test-model', startedAt: 'a', finishedAt: 'b', complete: true, documents, typedErrorChecks: [] };
    const replay = await runPipelineReplay({ fixturesDir: FIXTURES, today: '2026-10-19', reader: createReplayReader(documents, 'test-model'), maxConcurrency: 2, compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 }, windowMinDays: 84, windowMaxDays: 112 });
    const version = summariseVersion('vTest', 'test-model', [evaluateRepeat({ raw, outcomes: replay.outcomes, pipelineCounts: replay.summary.counts }, truths)]);
    const json = { header: { date: '2026-10-19', model: 'test-model', promptVersion: 'vTest', repeats: 1, documents: 28 }, finalVersion: 'vTest', versions: [version], pricing: { currency: 'USD (assumed)' } };
    const lines = summaryLines(json);
    expect(lines).toHaveLength(10);
    const { known, numbers } = knownFromJson(JSON.parse(JSON.stringify(json)));
    expect(unmatchedNumbers([{ file: 'summary', text: lines.join('\n') }], known, numbers)).toEqual([]);
    // A hand-typed number is caught.
    expect(unmatchedNumbers([{ file: 'prose', text: 'It is 97.3% accurate.' }], known, numbers)).toEqual([{ file: 'prose', number: '97.3' }]);
  });
});
