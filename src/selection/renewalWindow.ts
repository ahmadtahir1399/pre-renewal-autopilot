// Decides which policies are due for pre-renewal work today. Pure function:
// no I/O, no clock (today is passed in), no new date maths (Prompt 1 helpers only).

import { cycleKey, daysBetween, isWithinWindow } from '../domain/dates.js';
import type { IsoDate, Policy, SelectionSkipReason } from '../domain/types.js';

export interface SelectRenewalsInput {
  policies: readonly Policy[];
  today: IsoDate;
  /** Inclusive lower bound in days (WINDOW_MIN_DAYS, default 84). */
  minDays: number;
  /** Inclusive upper bound in days (WINDOW_MAX_DAYS, default 112). */
  maxDays: number;
  /** cycleKeys already processed (e.g. from seed state or SQLite); those cycles are skipped. */
  processedCycleKeys: ReadonlySet<string>;
  /** ADDITION (D-030): client names for the required tie-break. Unknown ids sort as ''. */
  clientNameById: ReadonlyMap<string, string>;
}

export interface SkippedPolicy {
  policyId: string;
  reason: SelectionSkipReason;
}

export interface SelectRenewalsResult {
  candidates: Policy[];
  skipped: SkippedPolicy[];
}

/** Plain code-unit comparison: identical on every machine (no locale rules). */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function selectRenewals(input: SelectRenewalsInput): SelectRenewalsResult {
  const { policies, today, minDays, maxDays, processedCycleKeys, clientNameById } = input;
  const candidates: Policy[] = [];
  const skipped: SkippedPolicy[] = [];

  for (const policy of policies) {
    if (!isWithinWindow(today, policy.expiryDate, minDays, maxDays)) {
      skipped.push({ policyId: policy.id, reason: 'outside_window' });
    } else if (processedCycleKeys.has(cycleKey(policy.id, policy.expiryDate))) {
      skipped.push({ policyId: policy.id, reason: 'already_processed' });
    } else {
      // Missing or unreadable documents are deliberately NOT a selection reason.
      // The policy is still due for renewal, so it stays a candidate; the pipeline
      // (Prompt 4) discovers the document problem and marks it needs_attention, so a
      // broker sees it instead of the policy silently disappearing from the run.
      candidates.push(policy);
    }
  }

  const nameOf = (policy: Policy) => clientNameById.get(policy.clientId) ?? '';
  candidates.sort(
    (a, b) =>
      daysBetween(today, a.expiryDate) - daysBetween(today, b.expiryDate) ||
      compareText(nameOf(a), nameOf(b)) ||
      compareText(a.id, b.id),
  );
  skipped.sort((a, b) => compareText(a.policyId, b.policyId));
  return { candidates, skipped };
}
