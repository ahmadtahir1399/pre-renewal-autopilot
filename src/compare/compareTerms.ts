// The comparison engine: a calculator, not a storyteller.
// PURE: no file, network, clock or environment access; inputs are never mutated.
// Implements locked decisions D-B and D-C as a RULES TABLE (one entry per field).

import { addDays, daysBetween } from '../domain/dates.js';
import { EXCLUSION_KEYS, SEVERITIES } from '../domain/schemas.js';
import type { ExclusionKey, ExtractedTerms, Fact, Flag, KeyExclusion, Severity, TermDiff } from '../domain/types.js';
import {
  coverLimitSentence,
  excessSentence,
  exclusionAddedSentence,
  exclusionRemovedSentence,
  insurerSentence,
  needsCheckSentence,
  normaliseTitle,
  otherExclusionSentence,
  periodSentence,
  premiumSentence,
  zeroPremiumSentence,
} from './format.js';

/** Bump when any rule below changes (Prompt 4 stores it with each pack). */
export const COMPARE_RULES_VERSION = 'r1';

/** Plain numbers passed in by the caller (from env PREMIUM_MEDIUM_PCT / PREMIUM_HIGH_PCT). Whole percents. */
export interface CompareConfig {
  premiumMediumPct: number;
  premiumHighPct: number;
}

export interface CompareResult {
  diffs: TermDiff[];
  flags: Flag[];
  overallRisk: Severity;
}

interface RuleOutcome {
  diffs: TermDiff[];
  /** "Needs human check" flags for this field. */
  checks: Flag[];
}

export interface FieldRule {
  /** Field id or prefix used in TermDiff.field / Flag.field. */
  field: string;
  /** Broker-readable statement of the rule (mirrored in docs/COMPARISON_RULES.md). */
  howCompared: string;
  howGraded: string;
  compare(expiring: ExtractedTerms, renewal: ExtractedTerms, config: CompareConfig): RuleOutcome;
}

const NONE: RuleOutcome = { diffs: [], checks: [] };

function rank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

/** A fact can be compared only when it has a value and is not low confidence (D-B). */
function usable<T>(fact: Fact<T>): fact is Fact<T> & { value: T } {
  return fact.value !== null && fact.confidence !== 'low';
}

function needsCheck(field: string, expiring: Fact<unknown>, renewal: Fact<unknown>): RuleOutcome {
  const sides = [!usable(expiring) && 'expiring', !usable(renewal) && 'renewal'].filter(Boolean).join(' and ');
  return { diffs: [], checks: [{ field, severity: 'medium', message: needsCheckSentence(field, sides) }] };
}

function pages(expiring: Fact<unknown>, renewal: Fact<unknown>): Pick<TermDiff, 'expiringPage' | 'renewalPage'> {
  return {
    ...(expiring.sourcePage === null ? {} : { expiringPage: expiring.sourcePage }),
    ...(renewal.sourcePage === null ? {} : { renewalPage: renewal.sourcePage }),
  };
}

const toCents = (amount: number) => Math.round(amount * 100);

function assertWholePercent(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a whole, non-negative percent, got ${value}`);
}

/**
 * Premium grade with EXACT integer arithmetic (no floating-point drift):
 * percent >= threshold  <=>  delta * 100 >= threshold * expiring   (all in cents).
 */
export function gradePremiumChange(expiring: number, renewal: number, config: CompareConfig): Severity {
  const from = toCents(expiring);
  const delta = toCents(renewal) - from;
  if (delta < 0) return 'info';
  if (delta * 100 >= config.premiumHighPct * from) return 'high';
  if (delta * 100 >= config.premiumMediumPct * from) return 'medium';
  return 'low';
}

function moneyRule(
  field: 'annualPremium' | 'excess' | 'coverLimit',
  howCompared: string,
  howGraded: string,
  grade: (from: number, to: number, config: CompareConfig) => Severity,
  sentence: (from: number, to: number) => string,
): FieldRule {
  return {
    field,
    howCompared,
    howGraded,
    compare(expiring, renewal, config) {
      const e = expiring[field];
      const r = renewal[field];
      if (!usable(e) || !usable(r)) return needsCheck(field, e, r);
      if (toCents(e.value) === toCents(r.value)) return NONE;
      if (field === 'annualPremium' && toCents(e.value) === 0) {
        return { diffs: [], checks: [{ field, severity: 'medium', message: zeroPremiumSentence() }] };
      }
      const diff: TermDiff = {
        field,
        expiring: e.value,
        renewal: r.value,
        change: r.value > e.value ? 'increased' : 'decreased',
        severity: grade(e.value, r.value, config),
        facts: sentence(e.value, r.value),
        ...pages(e, r),
      };
      return { diffs: [diff], checks: [] };
    },
  };
}

function uniqueByKey(list: readonly KeyExclusion[]): Map<ExclusionKey, KeyExclusion> {
  const map = new Map<ExclusionKey, KeyExclusion>();
  for (const item of list) if (item.key !== 'other' && !map.has(item.key)) map.set(item.key, item);
  return map;
}

function otherByTitle(list: readonly KeyExclusion[]): Map<string, KeyExclusion> {
  const map = new Map<string, KeyExclusion>();
  for (const item of list) {
    if (item.key !== 'other') continue;
    const title = normaliseTitle(item.title);
    if (!map.has(title)) map.set(title, item);
  }
  return map;
}

export const COMPARE_RULES: readonly FieldRule[] = [
  {
    field: 'insurerName',
    howCompared: 'Insurer names compared ignoring letter case and extra spaces.',
    howGraded: 'Any change of insurer = medium.',
    compare(expiring, renewal) {
      const e = expiring.insurerName;
      const r = renewal.insurerName;
      if (!usable(e) || !usable(r)) return needsCheck('insurerName', e, r);
      if (normaliseTitle(e.value) === normaliseTitle(r.value)) return NONE;
      return {
        diffs: [
          {
            field: 'insurerName',
            expiring: e.value,
            renewal: r.value,
            change: 'changed',
            severity: 'medium',
            facts: insurerSentence(e.value, r.value),
            ...pages(e, r),
          },
        ],
        checks: [],
      };
    },
  },
  {
    field: 'periodStart',
    howCompared:
      'Continuity: the renewal should start the day after the expiring period ends. Gap = days from (expiring end + 1 day) to renewal start.',
    howGraded: 'Gap of more than 1 day in either direction = medium (ASSUMPTION, see D-B).',
    compare(expiring, renewal) {
      const end = expiring.periodEnd;
      const start = renewal.periodStart;
      if (!usable(end) || !usable(start)) return needsCheck('periodStart', end, start);
      // ASSUMPTION (D-B): a renewal starting more than 1 day away from the day after the
      // expiring period ends is a medium date flag. 1 day of tolerance either way.
      const continuousStart = addDays(end.value, 1);
      const offset = daysBetween(continuousStart, start.value);
      if (Math.abs(offset) <= 1) return NONE;
      return {
        diffs: [
          {
            field: 'periodStart',
            expiring: end.value,
            renewal: start.value,
            change: 'changed',
            severity: 'medium',
            facts: periodSentence(end.value, continuousStart, start.value, offset),
            ...pages(end, start),
          },
        ],
        checks: [],
      };
    },
  },
  moneyRule(
    'annualPremium',
    'Percent change = (renewal - expiring) / expiring x 100, from the document figures, compared exactly (no rounding).',
    'Decrease = info; increase under PREMIUM_MEDIUM_PCT = low; at least PREMIUM_MEDIUM_PCT = medium; at least PREMIUM_HIGH_PCT = high. Expiring premium of zero = needs human check.',
    gradePremiumChange,
    premiumSentence,
  ),
  moneyRule(
    'excess',
    'Excess amounts compared exactly.',
    'Increase = medium; decrease = info.',
    (from, to) => (to > from ? 'medium' : 'info'),
    excessSentence,
  ),
  moneyRule(
    'coverLimit',
    'Sum insured / limit of indemnity compared exactly.',
    'Decrease = high; increase = info.',
    (from, to) => (to < from ? 'high' : 'info'),
    coverLimitSentence,
  ),
  {
    field: 'exclusion:',
    howCompared:
      "Exclusions compared by key as sets (repeats ignored); rewording with the same key is not a change. Key 'other' compared by normalised title.",
    howGraded: "Key added = high; key removed = info; an 'other' exclusion added or removed = medium and needs human check.",
    compare(expiring, renewal) {
      const diffs: TermDiff[] = [];
      const before = uniqueByKey(expiring.keyExclusions);
      const after = uniqueByKey(renewal.keyExclusions);
      for (const key of EXCLUSION_KEYS) {
        const e = before.get(key);
        const r = after.get(key);
        if (r && !e) {
          diffs.push({ field: `exclusion:${key}`, expiring: null, renewal: key, change: 'added', severity: 'high', facts: exclusionAddedSentence(key, r.sourcePage), renewalPage: r.sourcePage });
        } else if (e && !r) {
          diffs.push({ field: `exclusion:${key}`, expiring: key, renewal: null, change: 'removed', severity: 'info', facts: exclusionRemovedSentence(key, e.sourcePage), expiringPage: e.sourcePage });
        }
      }
      const otherBefore = otherByTitle(expiring.keyExclusions);
      const otherAfter = otherByTitle(renewal.keyExclusions);
      const titles = [...new Set([...otherBefore.keys(), ...otherAfter.keys()])].sort();
      for (const title of titles) {
        const e = otherBefore.get(title);
        const r = otherAfter.get(title);
        if (r && !e) {
          diffs.push({ field: `exclusion:other:${title}`, expiring: null, renewal: title, change: 'added', severity: 'medium', facts: otherExclusionSentence('added', title, r.sourcePage), renewalPage: r.sourcePage });
        } else if (e && !r) {
          diffs.push({ field: `exclusion:other:${title}`, expiring: title, renewal: null, change: 'removed', severity: 'medium', facts: otherExclusionSentence('removed', title, e.sourcePage), expiringPage: e.sourcePage });
        }
      }
      return { diffs, checks: [] };
    },
  },
];

const FIELD_ORDER = ['insurerName', 'periodStart', 'annualPremium', 'excess', 'coverLimit'];

/** Position in the fixed order: named fields, then exclusions in EXCLUSION_KEYS order ('other' last, by title). */
function fieldPosition(field: string): number {
  const named = FIELD_ORDER.indexOf(field);
  if (named >= 0) return named;
  if (field.startsWith('exclusion:other:')) return FIELD_ORDER.length + EXCLUSION_KEYS.indexOf('other');
  if (field.startsWith('exclusion:')) {
    const index = EXCLUSION_KEYS.indexOf(field.slice('exclusion:'.length) as ExclusionKey);
    if (index >= 0) return FIELD_ORDER.length + index;
  }
  return Number.MAX_SAFE_INTEGER;
}

function byPriority(a: { field: string; severity: Severity }, b: { field: string; severity: Severity }): number {
  return (
    rank(b.severity) - rank(a.severity) ||
    fieldPosition(a.field) - fieldPosition(b.field) ||
    (a.field < b.field ? -1 : a.field > b.field ? 1 : 0)
  );
}

/** D-C: highest severity among diffs and flags; 'info' when nothing is above info. */
export function deriveOverallRisk(diffs: readonly TermDiff[], flags: readonly Flag[]): Severity {
  return [...diffs, ...flags].reduce<Severity>((highest, item) => (rank(item.severity) > rank(highest) ? item.severity : highest), 'info');
}

/** D-C flags: one per medium/high diff, one per needs-human-check field; never two for the same field. */
function buildFlags(diffs: readonly TermDiff[], checks: readonly Flag[]): Flag[] {
  const byField = new Map<string, Flag>();
  for (const diff of diffs) {
    if (rank(diff.severity) < rank('medium')) continue;
    const isOther = diff.field.startsWith('exclusion:other:');
    byField.set(diff.field, { field: diff.field, severity: diff.severity, message: isOther ? `${diff.facts} Needs human check.` : diff.facts });
  }
  for (const check of checks) {
    const existing = byField.get(check.field);
    if (!existing) byField.set(check.field, check);
    else if (rank(check.severity) > rank(existing.severity)) byField.set(check.field, { ...check, message: `${existing.message} ${check.message}` });
  }
  return [...byField.values()].sort(byPriority);
}

export function compareTerms(expiring: ExtractedTerms, renewal: ExtractedTerms, config: CompareConfig): CompareResult {
  assertWholePercent('premiumMediumPct', config.premiumMediumPct);
  assertWholePercent('premiumHighPct', config.premiumHighPct);
  const outcomes = COMPARE_RULES.map((rule) => rule.compare(expiring, renewal, config));
  const diffs = outcomes.flatMap((o) => o.diffs).sort(byPriority);
  const flags = buildFlags(diffs, outcomes.flatMap((o) => o.checks));
  return { diffs, flags, overallRisk: deriveOverallRisk(diffs, flags) };
}
