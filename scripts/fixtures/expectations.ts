// Answer-key logic: expected ExtractedTerms from what was printed, and expected
// diffs / flags / overallRisk by applying locked decisions D-B and D-C.
// Deliberately independent of src/compare (built in Prompt 3) so the key can
// catch mistakes in that engine instead of copying them.

import { addDays, daysBetween } from '../../src/domain/dates.js';
import { EXCLUSION_KEYS, SEVERITIES } from '../../src/domain/schemas.js';
import type { ExtractedTerms, Fact, Flag, Severity, TermDiff } from '../../src/domain/types.js';
import { EXCLUSION_CATALOG } from './catalog.js';
import { type BuiltDocument, EXCLUSIONS_PAGE, type PrintedFact, SCHEDULE_PAGE } from './documentModel.js';
import { formatNzd, formatNzdChange, formatPercentChange, percentChange } from './format.js';

export interface Thresholds {
  mediumPct: number;
  highPct: number;
}

/** Defaults from D-B (PREMIUM_MEDIUM_PCT=10, PREMIUM_HIGH_PCT=25). */
export const DEFAULT_THRESHOLDS: Thresholds = { mediumPct: 10, highPct: 25 };

function printedFact<T>(printed: PrintedFact<T>): Fact<T> {
  return { value: printed.value, sourcePage: SCHEDULE_PAGE, sourceQuote: printed.line, confidence: 'high' };
}

/** What a perfect reader should extract from a document that has a text layer. */
export function expectedTermsFor(doc: BuiltDocument): ExtractedTerms {
  const s = doc.schedule;
  return {
    insurerName: printedFact(s.insurerName),
    policyNumber: printedFact(s.policyNumber),
    policyType: printedFact(s.policyType),
    periodStart: printedFact(s.periodStart),
    periodEnd: printedFact(s.periodEnd),
    annualPremium: printedFact(s.annualPremium),
    excess: printedFact(s.excess),
    coverLimit: printedFact(s.coverLimit),
    keyExclusions: doc.exclusions.map((exclusion) => ({
      key: exclusion.key,
      title: exclusion.title,
      summary: EXCLUSION_CATALOG[exclusion.key].summary,
      sourcePage: EXCLUSIONS_PAGE,
    })),
  };
}

function isUsable<T>(fact: Fact<T>): fact is Fact<T> & { value: T } {
  return fact.value !== null && fact.confidence !== 'low';
}

function rank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

function pages(expiring: Fact<unknown>, renewal: Fact<unknown>): Pick<TermDiff, 'expiringPage' | 'renewalPage'> {
  return {
    ...(expiring.sourcePage === null ? {} : { expiringPage: expiring.sourcePage }),
    ...(renewal.sourcePage === null ? {} : { renewalPage: renewal.sourcePage }),
  };
}

function premiumSeverity(pct: number, thresholds: Thresholds): Severity {
  if (pct < 0) return 'info';
  if (pct >= thresholds.highPct) return 'high';
  if (pct >= thresholds.mediumPct) return 'medium';
  return 'low';
}

export interface ExpectedComparison {
  diffs: TermDiff[];
  flags: Flag[];
  overallRisk: Severity;
}

/**
 * Apply D-B / D-C. Diff order is canonical (D-014): insurerName, periodStart,
 * annualPremium, excess, coverLimit, then exclusions in EXCLUSION_KEYS order.
 */
export function computeExpectedComparison(
  expiring: ExtractedTerms,
  renewal: ExtractedTerms,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ExpectedComparison {
  const diffs: TermDiff[] = [];
  const needsCheck: Flag[] = [];

  const checkBoth = (field: string, a: Fact<unknown>, b: Fact<unknown>): boolean => {
    if (isUsable(a) && isUsable(b)) return true;
    const sides = [!isUsable(a) && 'expiring', !isUsable(b) && 'renewal'].filter(Boolean).join(' and ');
    needsCheck.push({
      field,
      severity: 'medium',
      message: `Needs human check: ${field} is missing or low confidence in the ${sides} document; no difference was computed.`,
    });
    return false;
  };

  // Insurer name: any change = medium.
  if (checkBoth('insurerName', expiring.insurerName, renewal.insurerName)) {
    const from = expiring.insurerName.value as string;
    const to = renewal.insurerName.value as string;
    if (from !== to) {
      diffs.push({
        field: 'insurerName',
        expiring: from,
        renewal: to,
        change: 'changed',
        severity: 'medium',
        facts: `Insurer changed from ${from} to ${to}.`,
        ...pages(expiring.insurerName, renewal.insurerName),
      });
    }
  }

  // Period continuity. ASSUMPTION (D-B): renewal periodStart more than 1 day away
  // from (expiring periodEnd + 1 day) is a medium date flag.
  if (checkBoth('periodStart', expiring.periodEnd, renewal.periodStart)) {
    const expiringEnd = expiring.periodEnd.value as string;
    const renewalStart = renewal.periodStart.value as string;
    const continuousStart = addDays(expiringEnd, 1);
    const offset = daysBetween(continuousStart, renewalStart);
    if (Math.abs(offset) > 1) {
      const direction = offset > 0 ? 'after' : 'before';
      diffs.push({
        field: 'periodStart',
        expiring: expiringEnd,
        renewal: renewalStart,
        change: 'changed',
        severity: 'medium',
        facts: `Renewal period starts ${renewalStart}, ${Math.abs(offset)} days ${direction} continuous cover would start (${continuousStart}); the expiring period ends ${expiringEnd}.`,
        ...pages(expiring.periodEnd, renewal.periodStart),
      });
    }
  }

  // Annual premium.
  if (checkBoth('annualPremium', expiring.annualPremium, renewal.annualPremium)) {
    const from = expiring.annualPremium.value as number;
    const to = renewal.annualPremium.value as number;
    if (from !== to) {
      const pct = percentChange(from, to);
      diffs.push({
        field: 'annualPremium',
        expiring: from,
        renewal: to,
        change: to > from ? 'increased' : 'decreased',
        severity: premiumSeverity(pct, thresholds),
        facts: `Annual premium ${to > from ? 'increased' : 'decreased'} from ${formatNzd(from, 2)} to ${formatNzd(to, 2)} (${formatNzdChange(to - from, 2)}, ${formatPercentChange(pct)}).`,
        ...pages(expiring.annualPremium, renewal.annualPremium),
      });
    }
  }

  // Excess: increase = medium, decrease = info.
  if (checkBoth('excess', expiring.excess, renewal.excess)) {
    const from = expiring.excess.value as number;
    const to = renewal.excess.value as number;
    if (from !== to) {
      diffs.push({
        field: 'excess',
        expiring: from,
        renewal: to,
        change: to > from ? 'increased' : 'decreased',
        severity: to > from ? 'medium' : 'info',
        facts: `Excess ${to > from ? 'increased' : 'decreased'} from ${formatNzd(from, 0)} to ${formatNzd(to, 0)} (${formatNzdChange(to - from, 0)}).`,
        ...pages(expiring.excess, renewal.excess),
      });
    }
  }

  // Cover limit: decrease = high, increase = info.
  if (checkBoth('coverLimit', expiring.coverLimit, renewal.coverLimit)) {
    const from = expiring.coverLimit.value as number;
    const to = renewal.coverLimit.value as number;
    if (from !== to) {
      diffs.push({
        field: 'coverLimit',
        expiring: from,
        renewal: to,
        change: to > from ? 'increased' : 'decreased',
        severity: to < from ? 'high' : 'info',
        facts: `Cover limit ${to > from ? 'increased' : 'decreased'} from ${formatNzd(from, 0)} to ${formatNzd(to, 0)} (${formatNzdChange(to - from, 0)}, ${formatPercentChange(percentChange(from, to))}).`,
        ...pages(expiring.coverLimit, renewal.coverLimit),
      });
    }
  }

  // Exclusions, compared by KEY only (rewording is not a change). Added = high, removed = info.
  const expiringByKey = new Map(expiring.keyExclusions.map((e) => [e.key, e]));
  const renewalByKey = new Map(renewal.keyExclusions.map((e) => [e.key, e]));
  for (const key of EXCLUSION_KEYS) {
    const before = expiringByKey.get(key);
    const after = renewalByKey.get(key);
    if (after && !before) {
      diffs.push({
        field: `exclusion:${key}`,
        expiring: null,
        renewal: key,
        change: 'added',
        severity: 'high',
        facts: `Exclusion "${key}" added in the renewal (page ${after.sourcePage}: ${after.title}).`,
        renewalPage: after.sourcePage,
      });
    } else if (before && !after) {
      diffs.push({
        field: `exclusion:${key}`,
        expiring: key,
        renewal: null,
        change: 'removed',
        severity: 'info',
        facts: `Exclusion "${key}" removed in the renewal (was on expiring page ${before.sourcePage}: ${before.title}).`,
        expiringPage: before.sourcePage,
      });
    }
  }

  // D-C: flags = diffs at medium or high, plus every needs-human-check flag.
  const flags: Flag[] = [
    ...diffs
      .filter((diff) => rank(diff.severity) >= rank('medium'))
      .map((diff) => ({ field: diff.field, severity: diff.severity, message: diff.facts })),
    ...needsCheck,
  ];
  const overallRisk = [...diffs, ...flags].reduce<Severity>(
    (highest, item) => (rank(item.severity) > rank(highest) ? item.severity : highest),
    'info',
  );
  return { diffs, flags, overallRisk };
}
