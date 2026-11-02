// Plain-code sanity checks ACROSS the facts of one document (no AI). verifyQuotes checks each fact against its
// page; this checks that the facts make sense together. A fact that fails keeps its value but drops to confidence
// 'low' with a typed warning, so the existing D-B rule turns it into a "needs human check" flag. Never guesses a
// replacement value. Thresholds are deliberately wide: they catch misreads (a sub-limit read as the premium, a
// renewal date read as the expiry), not unusual but real policies.

import { daysBetween } from '../domain/dates.js';
import type { ExtractedTerms, Fact } from '../domain/types.js';
import type { ExtractionWarning } from './verifyQuotes.js';

/** A one-year period is 365 or 366 days long counted inclusively; short-period and long-period policies exist. */
export const MIN_PERIOD_DAYS = 28;
export const MAX_PERIOD_DAYS = 550;

type Field = 'periodStart' | 'periodEnd' | 'annualPremium' | 'excess' | 'coverLimit';

function usable<T>(fact: Fact<T>): fact is Fact<T> & { value: T } {
  return fact.value !== null && fact.confidence !== 'low';
}

export interface ConsistencyResult {
  terms: ExtractedTerms;
  warnings: ExtractionWarning[];
}

/** Returns a NEW terms object; the input is not changed. Only facts still high/medium are judged. */
export function checkConsistency(input: ExtractedTerms): ConsistencyResult {
  const terms: ExtractedTerms = { ...input, keyExclusions: [...input.keyExclusions] };
  const warnings: ExtractionWarning[] = [];
  const flag = (fields: Field[], code: ExtractionWarning['code'], message: string) => {
    for (const field of fields) {
      const fact = terms[field] as Fact<unknown>;
      warnings.push({ code, field, sourcePage: fact.sourcePage, message });
      (terms as unknown as Record<Field, Fact<unknown>>)[field] = { ...fact, confidence: 'low' };
    }
  };

  const { periodStart, periodEnd } = input;
  if (usable(periodStart) && usable(periodEnd)) {
    const days = daysBetween(periodStart.value, periodEnd.value) + 1;
    if (days < 1) {
      flag(['periodStart', 'periodEnd'], 'period_inconsistent', 'The period ends before it starts, so both dates are treated as uncertain.');
    } else if (days < MIN_PERIOD_DAYS || days > MAX_PERIOD_DAYS) {
      flag(['periodStart', 'periodEnd'], 'period_inconsistent', `The period is ${days} days long, which does not look like a policy period, so both dates are treated as uncertain.`);
    }
  }

  const { annualPremium, excess, coverLimit } = input;
  if (usable(annualPremium) && annualPremium.value <= 0) {
    flag(['annualPremium'], 'amount_implausible', 'The premium is zero or negative, so it is treated as uncertain.');
  }
  if (usable(coverLimit) && coverLimit.value <= 0) {
    flag(['coverLimit'], 'amount_implausible', 'The cover limit is zero or negative, so it is treated as uncertain.');
  }
  if (usable(annualPremium) && usable(coverLimit) && annualPremium.value > 0 && coverLimit.value > 0 && annualPremium.value >= coverLimit.value) {
    flag(['annualPremium', 'coverLimit'], 'amount_implausible', 'The premium is not smaller than the cover limit, so one of them was probably misread; both are treated as uncertain.');
  }
  if (usable(excess) && usable(coverLimit) && coverLimit.value > 0 && excess.value >= coverLimit.value) {
    flag(['excess', 'coverLimit'], 'amount_implausible', 'The excess is not smaller than the cover limit, so one of them was probably misread; both are treated as uncertain.');
  }
  return { terms, warnings };
}
