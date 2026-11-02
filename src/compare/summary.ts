// Deterministic summary built ONLY from the diff sentences (TermDiff.facts).
// The optional AI polish (USE_AI_SUMMARY) is deliberately not built.

import { SEVERITIES } from '../domain/schemas.js';
import type { TermDiff } from '../domain/types.js';

export interface Summary {
  /** Up to 3 most important changes (highest severity first). */
  headline: string[];
  /** Every change, in priority order. */
  details: string[];
}

export const NO_CHANGES_SENTENCE = 'No changes were found between the expiring policy and the renewal offer.';

export function buildSummary(diffs: readonly TermDiff[]): Summary {
  if (diffs.length === 0) return { headline: [NO_CHANGES_SENTENCE], details: [] };
  // Stable sort by severity only; compareTerms already applies the full field order.
  const ordered = diffs
    .map((diff, index) => ({ diff, index }))
    .sort((a, b) => SEVERITIES.indexOf(b.diff.severity) - SEVERITIES.indexOf(a.diff.severity) || a.index - b.index)
    .map(({ diff }) => diff.facts);
  return { headline: ordered.slice(0, 3), details: ordered };
}
