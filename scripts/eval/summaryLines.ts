// The 10-line results summary, generated FROM the final live evaluation JSON. Hand-typed numbers are banned:
// every number below is read from (or formatted directly from counts in) that JSON.

import type { VersionSummary } from './aggregate.js';
import { formatRatio, type Ratio } from './score.js';

export interface LiveReportJson {
  header: { date: string; model: string; promptVersion: string; repeats: number; documents: number };
  finalVersion: string;
  versions: VersionSummary[];
  pricing: { currency: string };
}

const r = (x: Ratio) => formatRatio(x);
const perRepeat = (ratios: readonly Ratio[]) => ratios.map((x, i) => `repeat ${i + 1}: ${x.hit} of ${x.total}`).join('; ');

export function summaryLines(json: LiveReportJson): string[] {
  const v = json.versions.find((x) => x.promptVersion === json.finalVersion);
  if (!v) throw new Error(`final version ${json.finalVersion} not found in the report JSON`);
  const p = v.pooled;
  const n = v.repeats.length;
  const docs = json.header.documents;
  const setup = `${docs} synthetic documents x ${n} repeats, model ${json.header.model}, prompt ${json.finalVersion}`;
  return [
    `1. Field values exact: ${r(p.fieldValue)}. 8 schedule fields per document, ${setup}; exact match with the answer keys after normalising numbers, dates and text.`,
    `2. Source page correct: ${r(p.fieldPage)}. Stated page equals the answer-key page, same facts.`,
    `3. Quote check passed: ${r(p.quotePass)}. Facts from successful reads with no quote warning (the quote and value were found on the stated page, in plain code).`,
    `4. Wrong value still at high confidence: ${p.wrongHigh} of ${p.fieldValue.total} facts. The dangerous case; each one is listed in the report.`,
    `5. Exclusions: recall ${r(p.exclusionRecall)}, precision ${r(p.exclusionPrecision)}. Exclusion keys per document compared as sets with the answer keys.`,
    `6. Differences found, end to end: ${r(p.diffRecall)}. Answer-key differences produced by PDF -> extraction -> plain-code comparison; a match needs field, change and severity.`,
    `7. Differences that were real: ${r(p.diffPrecision)}. Differences produced that are in the answer keys.`,
    `8. Final status correct: ${r(p.statusCorrect)}. 15 scenarios x ${n} repeats through the real pipeline (selection, missing and unreadable documents included).`,
    `9. Run-to-run spread, field values: ${perRepeat(v.repeats.map((h) => h.fieldValue))}. The same documents read ${n} times.`,
    `10. Cost and time: ${p.cost.toFixed(4)} ${json.pricing.currency.split(' ')[0]} for all ${p.httpResponses} calls; mean ${v.timing.meanDocumentMs.toFixed(1)} ms per document. From reported tokens and the author-typed price; times on one machine and network.`,
  ];
}

/** Compact version for space-limited documents (the case study): same source, fewer words. */
export function shortSummaryLines(json: LiveReportJson): string[] {
  const v = json.versions.find((x) => x.promptVersion === json.finalVersion);
  if (!v) throw new Error(`final version ${json.finalVersion} not found in the report JSON`);
  const p = v.pooled;
  return [
    `- Field values exact: ${r(p.fieldValue)}; source pages correct: ${r(p.fieldPage)} (${json.header.documents} documents x ${v.repeats.length} repeats).`,
    `- Wrong value still at high confidence: ${p.wrongHigh} of ${p.fieldValue.total}.`,
    `- Exclusion keys found: ${r(p.exclusionRecall)}; differences found end to end: ${r(p.diffRecall)}, of which real: ${r(p.diffPrecision)}.`,
    `- Final status correct: ${r(p.statusCorrect)}.`,
    `- Cost: ${p.cost.toFixed(4)} ${json.pricing.currency.split(' ')[0]} for ${p.httpResponses} model calls.`,
  ];
}
