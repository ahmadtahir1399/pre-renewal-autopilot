// Renewal status transitions. Everything not listed here is forbidden.
// approved and skipped are final for the cycle, except a FORCED rerun (-> drafted).

import type { RenewalStatus } from '../domain/types.js';

export const ALLOWED_TRANSITIONS: Readonly<Record<RenewalStatus, readonly RenewalStatus[]>> = {
  not_started: ['drafted', 'needs_attention'],
  needs_attention: ['drafted'],
  drafted: ['in_review'],
  in_review: ['approved', 'skipped'],
  approved: [],
  skipped: [],
};

/** Allowed only with an explicit force option. */
export const FORCED_TRANSITIONS: Readonly<Record<RenewalStatus, readonly RenewalStatus[]>> = {
  not_started: [],
  needs_attention: [],
  drafted: [],
  in_review: [],
  approved: ['drafted'],
  skipped: ['drafted'],
};

export class InvalidTransitionError extends Error {
  readonly code = 'invalid_transition';

  constructor(
    readonly policyId: string,
    readonly from: RenewalStatus,
    readonly to: RenewalStatus,
  ) {
    super(`Status change ${from} -> ${to} is not allowed for policy ${policyId}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransition(from: RenewalStatus, to: RenewalStatus, options: { force?: boolean } = {}): boolean {
  if (ALLOWED_TRANSITIONS[from].includes(to)) return true;
  return options.force === true && FORCED_TRANSITIONS[from].includes(to);
}

/** Throws InvalidTransitionError naming from, to and the policy. */
export function assertTransition(policyId: string, from: RenewalStatus, to: RenewalStatus, options: { force?: boolean } = {}): void {
  if (!canTransition(from, to, options)) throw new InvalidTransitionError(policyId, from, to);
}
