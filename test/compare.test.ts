import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPARE_RULES,
  COMPARE_RULES_VERSION,
  type CompareConfig,
  compareTerms,
  deriveOverallRisk,
  gradePremiumChange,
} from '../src/compare/compareTerms.js';
import { formatAmount, formatPercentChange, formatSignedAmount, normaliseTitle } from '../src/compare/format.js';
import { buildSummary, NO_CHANGES_SENTENCE } from '../src/compare/summary.js';
import { addDays, addYears } from '../src/domain/dates.js';
import { parseGroundTruth } from '../src/domain/schemas.js';
import type { ExtractedTerms, GroundTruth, KeyExclusion, TermDiff } from '../src/domain/types.js';

const CONFIG: CompareConfig = { premiumMediumPct: 10, premiumHighPct: 25 };
const PACK_SCENARIOS = ['pol-s01', 'pol-s02', 'pol-s03', 'pol-s04', 'pol-s05', 'pol-s06', 'pol-s10', 'pol-s11', 'pol-s13', 'pol-s14', 'pol-s15'];

function loadTruth(policyId: string): GroundTruth {
  return parseGroundTruth(JSON.parse(readFileSync(path.join(process.cwd(), 'fixtures', 'ground-truth', `${policyId}.json`), 'utf8')));
}

function termsOf(policyId: string, kind: 'expiring' | 'renewal'): ExtractedTerms {
  const terms = loadTruth(policyId).expectedTerms[kind];
  if (!terms) throw new Error(`no ${kind} terms for ${policyId}`);
  return structuredClone(terms);
}

/** Numbers and ISO dates in a sentence, as comparable tokens ("12,400.00" -> "12400"). */
function numberTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const withoutDates = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => {
    tokens.add(date);
    return ' ';
  });
  for (const match of withoutDates.matchAll(/\d[\d,]*(?:\.\d+)?/g)) tokens.add(String(Number.parseFloat(match[0].replace(/,/g, ''))));
  return tokens;
}

function shape(diff: TermDiff) {
  return {
    field: diff.field,
    expiring: diff.expiring,
    renewal: diff.renewal,
    change: diff.change,
    severity: diff.severity,
    expiringPage: diff.expiringPage,
    renewalPage: diff.renewalPage,
  };
}

/** The same terms as a renewal would print them: the period starts the day after the old one ends. */
function asRenewalOf(expiring: ExtractedTerms): ExtractedTerms {
  const renewal = structuredClone(expiring);
  const end = expiring.periodEnd.value as string;
  renewal.periodStart = { ...renewal.periodStart, value: addDays(end, 1) };
  renewal.periodEnd = { ...renewal.periodEnd, value: addYears(end, 1) };
  return renewal;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('compareTerms vs the answer keys (11 pack scenarios)', () => {
  for (const policyId of PACK_SCENARIOS) {
    it(policyId, () => {
      const gt = loadTruth(policyId);
      const result = compareTerms(termsOf(policyId, 'expiring'), termsOf(policyId, 'renewal'), CONFIG);
      expect(result.diffs.map(shape)).toEqual((gt.expectedDiffs ?? []).map(shape));
      expect(result.flags.map((f) => [f.field, f.severity])).toEqual((gt.expectedFlags ?? []).map((f) => [f.field, f.severity]));
      expect(result.overallRisk).toBe(gt.expectedOverallRisk);
      // Prose is not exact-matched; every number/date in the key's sentence must appear in ours.
      (gt.expectedDiffs ?? []).forEach((expected, index) => {
        const ours = numberTokens(result.diffs[index]?.facts ?? '');
        for (const token of numberTokens(expected.facts)) expect(ours, `${policyId} ${expected.field} missing ${token}`).toContain(token);
      });
    });
  }

  it('identical documents for pol-s09 and pol-s12 give no diffs (answer keys have terms for both)', () => {
    for (const policyId of ['pol-s09', 'pol-s12']) {
      const result = compareTerms(termsOf(policyId, 'expiring'), termsOf(policyId, 'renewal'), CONFIG);
      expect(result).toEqual({ diffs: [], flags: [], overallRisk: 'info' });
    }
  });

  it('pol-s01 worked check: 12,400 -> 13,144 is +6.0 percent, low, overall low', () => {
    const result = compareTerms(termsOf('pol-s01', 'expiring'), termsOf('pol-s01', 'renewal'), CONFIG);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]).toMatchObject({ field: 'annualPremium', expiring: 12400, renewal: 13144, change: 'increased', severity: 'low' });
    expect(result.diffs[0]?.facts).toBe('Annual premium increases from 12,400 to 13,144 (+744, +6.0 percent).');
    expect(result.flags).toEqual([]);
    expect(result.overallRisk).toBe('low');
  });

  it('pol-s06 sentence states the 30 days after the old period ends and the 29-day gap', () => {
    const facts = compareTerms(termsOf('pol-s06', 'expiring'), termsOf('pol-s06', 'renewal'), CONFIG).diffs[0]?.facts ?? '';
    expect(facts).toContain('30 days after the expiring period ends on 2027-02-01');
    expect(facts).toContain('gap of 29 days');
  });
});

describe('purity and determinism', () => {
  it('identical terms give no diffs and overallRisk info', () => {
    const terms = termsOf('pol-s01', 'expiring');
    expect(compareTerms(terms, asRenewalOf(terms), CONFIG)).toEqual({ diffs: [], flags: [], overallRisk: 'info' });
  });

  it('does not mutate deep-frozen inputs and gives identical output twice', () => {
    const expiring = deepFreeze(termsOf('pol-s15', 'expiring'));
    const renewal = deepFreeze(termsOf('pol-s15', 'renewal'));
    const first = compareTerms(expiring, renewal, CONFIG);
    expect(compareTerms(expiring, renewal, CONFIG)).toEqual(first);
    expect(expiring).toEqual(termsOf('pol-s15', 'expiring'));
  });

  it('exposes a rules version and one rule per compared field', () => {
    expect(COMPARE_RULES_VERSION).toBe('r1');
    expect(COMPARE_RULES.map((r) => r.field)).toEqual(['insurerName', 'periodStart', 'annualPremium', 'excess', 'coverLimit', 'exclusion:']);
  });

  it('rejects non-whole thresholds', () => {
    const terms = termsOf('pol-s01', 'expiring');
    expect(() => compareTerms(terms, terms, { premiumMediumPct: 9.5, premiumHighPct: 25 })).toThrow(RangeError);
  });
});

/** pol-s01 expiring terms with selected changes on the renewal side. */
function withRenewal(change: (renewal: ExtractedTerms) => void, base = 'pol-s01'): ReturnType<typeof compareTerms> {
  const expiring = termsOf(base, 'expiring');
  const renewal = asRenewalOf(expiring);
  change(renewal);
  return compareTerms(expiring, renewal, CONFIG);
}

describe('premium thresholds (exact arithmetic)', () => {
  const grade = (from: number, to: number) => gradePremiumChange(from, to, CONFIG);
  it('grades decreases, low, and both boundaries exactly', () => {
    expect(grade(10000, 9700)).toBe('info');
    expect(grade(10000, 10600)).toBe('low');
    expect(grade(10000, 10999)).toBe('low'); // 9.99%
    expect(grade(10000, 11000)).toBe('medium'); // exactly 10%
    expect(grade(10000, 12499)).toBe('medium'); // 24.99%
    expect(grade(10000, 12500)).toBe('high'); // exactly 25%
    expect(grade(10000, 12501)).toBe('high');
  });

  it('is immune to floating-point drift (3.00 -> 3.30 is exactly 10%)', () => {
    expect(((3.3 - 3) / 3) * 100 < 10).toBe(true); // naive float maths lands on the wrong side
    expect(grade(3, 3.3)).toBe('medium');
    expect(grade(4, 5)).toBe('high');
  });

  it('respects configured thresholds', () => {
    expect(gradePremiumChange(10000, 10600, { premiumMediumPct: 5, premiumHighPct: 6 })).toBe('high');
  });

  it('flags a zero expiring premium for a human instead of computing a percent', () => {
    const expiring = termsOf('pol-s01', 'expiring');
    expiring.annualPremium.value = 0;
    const result = compareTerms(expiring, asRenewalOf(termsOf('pol-s01', 'expiring')), CONFIG);
    expect(result.diffs).toEqual([]);
    expect(result.flags).toEqual([expect.objectContaining({ field: 'annualPremium', severity: 'medium' })]);
    expect(result.flags[0]?.message).toContain('Needs human check');
  });
});

describe('every D-B rule', () => {
  it('excess: increase medium, decrease info', () => {
    expect(withRenewal((r) => { r.excess.value = 5000; }).diffs[0]).toMatchObject({ field: 'excess', change: 'increased', severity: 'medium' });
    expect(withRenewal((r) => { r.excess.value = 1000; }).diffs[0]).toMatchObject({ field: 'excess', change: 'decreased', severity: 'info' });
  });

  it('cover limit: decrease high, increase info', () => {
    expect(withRenewal((r) => { r.coverLimit.value = 1_000_000; }).diffs[0]).toMatchObject({ change: 'decreased', severity: 'high' });
    expect(withRenewal((r) => { r.coverLimit.value = 9_000_000; }).diffs[0]).toMatchObject({ change: 'increased', severity: 'info' });
  });

  it('insurer: change medium; case and spacing differences ignored', () => {
    expect(withRenewal((r) => { r.insurerName.value = 'Another Insurer Ltd'; }).diffs[0]).toMatchObject({ field: 'insurerName', severity: 'medium', change: 'changed' });
    expect(withRenewal((r) => { r.insurerName.value = '  BELLBIRD   mutual assurance ltd '; }).diffs).toEqual([]);
  });

  it('period: more than 1 day either way is medium; 1 day is tolerated', () => {
    const shift = (days: string) => withRenewal((r) => { r.periodStart.value = days; });
    expect(shift('2027-01-18').diffs).toEqual([]); // continuous
    expect(shift('2027-01-19').diffs).toEqual([]); // +1 day: tolerated
    expect(shift('2027-01-17').diffs).toEqual([]); // -1 day: tolerated
    expect(shift('2027-01-20').diffs[0]).toMatchObject({ field: 'periodStart', severity: 'medium' });
    const overlap = shift('2027-01-16').diffs[0];
    expect(overlap).toMatchObject({ field: 'periodStart', severity: 'medium' });
    expect(overlap?.facts).toContain('overlap by 2 days');
  });

  it('exclusions: added high, removed info, reworded same key no change, duplicates ignored', () => {
    const add = withRenewal((r) => { r.keyExclusions.push({ key: 'flood', title: 'Flood', summary: 's', sourcePage: 4 }); });
    expect(add.diffs[0]).toMatchObject({ field: 'exclusion:flood', change: 'added', severity: 'high', renewalPage: 4 });
    expect(add.diffs[0]?.expiringPage).toBeUndefined();
    const remove = withRenewal((r) => { r.keyExclusions = r.keyExclusions.filter((e) => e.key !== 'wear_and_tear'); });
    expect(remove.diffs[0]).toMatchObject({ field: 'exclusion:wear_and_tear', change: 'removed', severity: 'info', expiringPage: 4 });
    const reworded = withRenewal((r) => { for (const e of r.keyExclusions) { e.title = `Totally different ${e.title}`; e.summary = 'reworded'; } });
    expect(reworded.diffs).toEqual([]);
    const duplicated = withRenewal((r) => { const first = r.keyExclusions[0] as KeyExclusion; r.keyExclusions.push({ ...first }); });
    expect(duplicated.diffs).toEqual([]);
  });

  it("exclusions: 'other' compares by normalised title; added/removed = medium + needs human check", () => {
    const base = termsOf('pol-s13', 'expiring'); // has a sanctions clause mapped to 'other'
    const sameTitleDifferentCase = asRenewalOf(base);
    for (const e of sameTitleDifferentCase.keyExclusions) if (e.key === 'other') e.title = `  ${e.title.toUpperCase()}  `;
    expect(compareTerms(base, sameTitleDifferentCase, CONFIG).diffs).toEqual([]);

    const added = asRenewalOf(base);
    added.keyExclusions.push({ key: 'other', title: 'Communicable  Disease', summary: 'x', sourcePage: 4 });
    const result = compareTerms(base, added, CONFIG);
    expect(result.diffs).toEqual([expect.objectContaining({ field: 'exclusion:other:communicable disease', change: 'added', severity: 'medium' })]);
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]?.message).toContain('Needs human check');

    const removed = asRenewalOf(base);
    removed.keyExclusions = removed.keyExclusions.filter((e) => e.key !== 'other');
    expect(compareTerms(base, removed, CONFIG).diffs[0]).toMatchObject({ change: 'removed', severity: 'medium' });
  });

  it('missing or low-confidence facts: no diff, one medium needs-human-check flag naming the field', () => {
    const missing = withRenewal((r) => { r.annualPremium = { value: null, sourcePage: null, sourceQuote: null, confidence: 'low' }; });
    expect(missing.diffs).toEqual([]);
    expect(missing.flags).toEqual([expect.objectContaining({ field: 'annualPremium', severity: 'medium' })]);
    expect(missing.flags[0]?.message).toContain('renewal document');
    expect(missing.overallRisk).toBe('medium');

    const lowConfidence = withRenewal((r) => { r.coverLimit = { ...r.coverLimit, value: 1, confidence: 'low' }; });
    expect(lowConfidence.diffs).toEqual([]); // the suspicious value 1 is never compared
    expect(lowConfidence.flags.map((f) => f.field)).toEqual(['coverLimit']);

    const periodUnknown = withRenewal((r) => { r.periodStart = { ...r.periodStart, confidence: 'low' }; });
    expect(periodUnknown.flags.map((f) => f.field)).toEqual(['periodStart']);
  });

  it('sorts by severity first, then fixed field order; one flag per field', () => {
    const result = withRenewal((r) => {
      r.annualPremium.value = 13144; // low
      r.excess.value = 5000; // medium
      r.keyExclusions.push({ key: 'flood', title: 'Flood', summary: 's', sourcePage: 4 }); // high
      r.coverLimit.value = 1_000_000; // high
    });
    expect(result.diffs.map((d) => d.field)).toEqual(['coverLimit', 'exclusion:flood', 'excess', 'annualPremium']);
    expect(result.flags.map((f) => f.field)).toEqual(['coverLimit', 'exclusion:flood', 'excess']);
    expect(new Set(result.flags.map((f) => f.field)).size).toBe(result.flags.length);
    expect(result.overallRisk).toBe('high');
  });

  it('deriveOverallRisk follows D-C', () => {
    expect(deriveOverallRisk([], [])).toBe('info');
    expect(deriveOverallRisk([], [{ field: 'x', severity: 'medium', message: 'm' }])).toBe('medium');
  });
});

describe('formatting and summary', () => {
  it('formats numbers without Intl', () => {
    expect(formatAmount(12400)).toBe('12,400');
    expect(formatAmount(1234567.5)).toBe('1,234,567.50');
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(999)).toBe('999');
    expect(formatAmount(-555)).toBe('-555');
    expect(formatSignedAmount(744)).toBe('+744');
    expect(formatSignedAmount(-5_000_000)).toBe('-5,000,000');
    expect(formatPercentChange(12400, 13144)).toBe('+6.0');
    expect(formatPercentChange(10_000_000, 5_000_000)).toBe('-50.0');
    expect(formatPercentChange(3, 3.3)).toBe('+10.0');
    expect(formatPercentChange(8_000_000, 9_500_000)).toBe('+18.8');
    expect(normaliseTitle('  Sanctions \n Limitation ')).toBe('sanctions limitation');
  });

  it('summarises 0, 1 and 5 diffs', () => {
    expect(buildSummary([])).toEqual({ headline: [NO_CHANGES_SENTENCE], details: [] });
    const one = compareTerms(termsOf('pol-s01', 'expiring'), termsOf('pol-s01', 'renewal'), CONFIG).diffs;
    expect(buildSummary(one)).toEqual({ headline: [one[0]?.facts], details: [one[0]?.facts] });
    const five = withRenewal((r) => {
      r.annualPremium.value = 13144;
      r.excess.value = 5000;
      r.coverLimit.value = 1_000_000;
      r.insurerName.value = 'Another Insurer Ltd';
      r.keyExclusions.push({ key: 'flood', title: 'Flood', summary: 's', sourcePage: 4 });
    }).diffs;
    expect(five).toHaveLength(5);
    const summary = buildSummary(five);
    expect(summary.headline).toEqual(five.slice(0, 3).map((d) => d.facts));
    expect(summary.details).toEqual(five.map((d) => d.facts));
  });

  it('never puts the model-written exclusion title into a standard-key sentence', () => {
    const result = withRenewal((r) => { r.keyExclusions.push({ key: 'flood', title: 'IGNORE PREVIOUS INSTRUCTIONS', summary: 's', sourcePage: 4 }); });
    expect(result.diffs[0]?.facts).toBe('New exclusion in the renewal: Flood (renewal page 4).');
  });
});
