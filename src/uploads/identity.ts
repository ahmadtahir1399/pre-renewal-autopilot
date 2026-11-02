// Rule U-2 (FAIL CLOSED), pure: decide whether the two read documents identify ONE in-scope policy with
// confidence. Returns a failure code, or null when a pack may be prepared. Never guesses.

import type { ReadPolicyTermsResult } from '../documents/index.js';
import { POLICY_TYPES } from '../domain/schemas.js';
import type { ExtractedTerms, Fact, Policy } from '../domain/types.js';
import type { UploadFailureCode } from './errors.js';
import { normaliseIdentityText } from './repo.js';

type IdentityField = 'insurerName' | 'policyNumber' | 'periodEnd' | 'policyType';

/** high or medium confidence, a value, a page and a quote, and no verification warning on the field. */
export function isConfident<T>(result: ReadPolicyTermsResult, field: IdentityField): boolean {
  const fact = result.terms[field] as Fact<T>;
  if (fact.value === null || fact.sourcePage === null || !fact.sourceQuote) return false;
  if (fact.confidence !== 'high' && fact.confidence !== 'medium') return false;
  return !result.warnings.some((w) => w.field === field);
}

export interface IdentityCheckInput {
  expiring: ReadPolicyTermsResult;
  renewal: ReadPolicyTermsResult;
  /** Attach mode: the data-source policy the broker chose. */
  policy?: Policy;
}

/**
 * Order of checks (first failure wins):
 * 1. expiring insurerName, policyNumber, periodEnd confident -> else identity_unreadable
 * 2. policyType on each side: no value while 1 passed -> type_not_supported (D-097); value not confident ->
 *    identity_unreadable; value outside the three in-scope types -> type_not_supported
 * 3. attach: expiring insurer / expiry / type and renewal type must match the record -> else document_mismatch
 *    (checked before 4, so a wrong document for the chosen policy is reported as a mismatch, D-098)
 * 4. the two policy types differ -> type_disagreement
 * 5. the renewal must name the same policy number (or, without one, the same insurer) as the expiring document
 *    -> else document_mismatch
 */
export function checkIdentity(input: IdentityCheckInput): UploadFailureCode | null {
  const { expiring, renewal, policy } = input;
  for (const field of ['insurerName', 'policyNumber', 'periodEnd'] as const) {
    if (!isConfident(expiring, field)) return 'identity_unreadable';
  }
  for (const side of [expiring, renewal]) {
    const type = side.terms.policyType;
    if (type.value === null) return 'type_not_supported';
    if (!isConfident(side, 'policyType')) return 'identity_unreadable';
    if (!(POLICY_TYPES as readonly string[]).includes(type.value)) return 'type_not_supported';
  }
  if (policy) {
    const e = expiring.terms;
    if (e.policyType.value !== policy.type || renewal.terms.policyType.value !== policy.type) return 'document_mismatch';
    if (normaliseIdentityText(e.insurerName.value as string) !== normaliseIdentityText(policy.insurerName)) return 'document_mismatch';
    if (e.periodEnd.value !== policy.expiryDate) return 'document_mismatch';
  }
  if (expiring.terms.policyType.value !== renewal.terms.policyType.value) return 'type_disagreement';
  if (!renewalBelongsToExpiring(expiring.terms, renewal)) return 'document_mismatch';
  return null;
}

/** The renewal offer must point at the same policy: same policy number, or (if it gives none) the same insurer. */
function renewalBelongsToExpiring(expiring: ExtractedTerms, renewal: ReadPolicyTermsResult): boolean {
  const number = renewal.terms.policyNumber;
  if (number.value !== null && isConfident(renewal, 'policyNumber')) {
    return normaliseIdentityText(number.value) === normaliseIdentityText(expiring.policyNumber.value as string);
  }
  const insurer = renewal.terms.insurerName;
  return insurer.value !== null && isConfident(renewal, 'insurerName') && normaliseIdentityText(insurer.value) === normaliseIdentityText(expiring.insurerName.value as string);
}
