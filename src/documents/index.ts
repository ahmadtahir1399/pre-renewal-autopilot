// readPolicyTerms = cache lookup -> read PDF -> LLM extract -> plain-code verify (quotes, then consistency)
// -> (D-120) at most ONE targeted repair reading for facts that could not be confirmed -> cache store.
// The AI only extracts; plain code decides what is confirmed. A repaired fact is accepted only if it passes the
// same checks; otherwise the first reading stays, marked uncertain.

import { existsSync, readFileSync } from 'node:fs';
import { DocumentMissingError } from '../domain/errors.js';
import { ExtractedTermsSchema } from '../domain/schemas.js';
import type { ExtractedTerms, Fact } from '../domain/types.js';
import type { LlmClient, LlmUsage } from '../llm/client.js';
import { type ExtractionCache, extractionCacheKey, sha256Hex } from './cache.js';
import { checkConsistency } from './consistency.js';
import { extractTermsFromPdfText } from './extractTerms.js';
import { type PdfPage, readPdfText } from './pdfText.js';
import { buildRepairPrompt, EXTRACT_PROMPT_VERSION, type RepairProblem } from './prompts/extractTerms.js';
import { type ExtractionWarning, verifyQuotes } from './verifyQuotes.js';

export interface ReadPolicyTermsDeps {
  llm: LlmClient;
  /** Optional; without it every call goes to the LLM. */
  cache?: ExtractionCache;
  maxRetries?: number;
  /** D-120: one targeted second reading for unconfirmed facts. Default true. */
  repair?: boolean;
  /** Used only in error messages. */
  policyId?: string;
  documentKind?: 'expiring' | 'renewal';
}

export interface ReadPolicyTermsResult {
  terms: ExtractedTerms;
  warnings: ExtractionWarning[];
  /** Tokens spent producing this result (on a cache hit: the original spend; no new tokens were used). */
  usage: LlmUsage;
  fromCache: boolean;
  /** D-120: facts that failed the first reading and were confirmed by the repair reading. */
  repairedFields?: string[];
}

const FACT_FIELDS = ['insurerName', 'policyNumber', 'policyType', 'periodStart', 'periodEnd', 'annualPremium', 'excess', 'coverLimit'] as const;
type FactField = (typeof FACT_FIELDS)[number];
const isFactField = (field: string): field is FactField => (FACT_FIELDS as readonly string[]).includes(field);

/** Quote check, then the cross-fact consistency check. */
export function checkTerms(terms: ExtractedTerms, pages: readonly PdfPage[]): { terms: ExtractedTerms; warnings: ExtractionWarning[] } {
  const verified = verifyQuotes(terms, pages);
  const consistent = checkConsistency(verified.terms);
  return { terms: consistent.terms, warnings: [...verified.warnings, ...consistent.warnings] };
}

/** The fields worth a second reading: facts with a value problem (not exclusion-list problems). */
export function repairProblems(warnings: readonly ExtractionWarning[]): RepairProblem[] {
  const seen = new Set<string>();
  const problems: RepairProblem[] = [];
  for (const w of warnings) {
    if (!isFactField(w.field) || seen.has(w.field)) continue;
    seen.add(w.field);
    problems.push({ field: w.field, code: w.code });
  }
  return problems;
}

/**
 * Keep the first reading, except for fields that failed it and are CONFIRMED by the repair reading (a value,
 * high/medium confidence, no warning). The merged result is checked for consistency again.
 */
export function mergeRepair(
  first: { terms: ExtractedTerms; warnings: ExtractionWarning[] },
  second: { terms: ExtractedTerms; warnings: ExtractionWarning[] },
  pages: readonly PdfPage[],
): { terms: ExtractedTerms; warnings: ExtractionWarning[]; repairedFields: string[] } {
  const merged: ExtractedTerms = { ...first.terms, keyExclusions: [...first.terms.keyExclusions] };
  const repairedFields: string[] = [];
  for (const { field } of repairProblems(first.warnings)) {
    if (!isFactField(field)) continue;
    const candidate = second.terms[field] as Fact<unknown>;
    const confirmed = candidate.value !== null && candidate.confidence !== 'low' && !second.warnings.some((w) => w.field === field);
    if (!confirmed) continue;
    (merged as unknown as Record<FactField, Fact<unknown>>)[field] = candidate;
    repairedFields.push(field);
  }
  const keptWarnings = first.warnings.filter((w) => !repairedFields.includes(w.field));
  // A repaired value must still make sense next to the others: run every check on the merged facts again.
  const recheck = checkTerms(merged, pages);
  const extra = recheck.warnings.filter((w) => !keptWarnings.some((k) => k.field === w.field && k.code === w.code));
  // A repaired field that fails the recheck is no longer counted as repaired.
  const stillRepaired = repairedFields.filter((field) => !extra.some((w) => w.field === field));
  return { terms: recheck.terms, warnings: [...keptWarnings, ...extra], repairedFields: stillRepaired };
}

export async function readPolicyTerms(pdfPath: string, deps: ReadPolicyTermsDeps): Promise<ReadPolicyTermsResult> {
  const policyId = deps.policyId ?? 'unknown';
  const documentKind = deps.documentKind ?? 'expiring';
  if (!existsSync(pdfPath)) throw new DocumentMissingError(policyId, documentKind);

  const fileSha256 = sha256Hex(readFileSync(pdfPath));
  const key = extractionCacheKey(fileSha256, EXTRACT_PROMPT_VERSION, deps.llm.model);
  const cached = await deps.cache?.get(key);
  if (cached) {
    return {
      terms: cached.terms,
      warnings: cached.warnings,
      usage: cached.usage,
      fromCache: true,
      ...(cached.repairedFields?.length ? { repairedFields: cached.repairedFields } : {}),
    };
  }

  const pdf = await readPdfText(pdfPath, policyId, documentKind);
  const extraction = await extractTermsFromPdfText(pdf, {
    llm: deps.llm,
    ...(deps.maxRetries === undefined ? {} : { maxRetries: deps.maxRetries }),
  });
  const usage: LlmUsage = { ...extraction.usage };
  let result: { terms: ExtractedTerms; warnings: ExtractionWarning[]; repairedFields: string[] } = { ...checkTerms(extraction.terms, pdf.pages), repairedFields: [] };

  const problems = repairProblems(result.warnings);
  if (deps.repair !== false && problems.length > 0) {
    try {
      const { system, user } = buildRepairPrompt(pdf.pages, problems);
      const second = await deps.llm.completeJson({ system, user, schema: ExtractedTermsSchema, maxRetries: 1 });
      usage.inputTokens += second.usage.inputTokens;
      usage.outputTokens += second.usage.outputTokens;
      result = mergeRepair(result, checkTerms(second.data, pdf.pages), pdf.pages);
    } catch {
      // The repair reading is a bonus: if it fails, the first (checked) reading stands, uncertain facts and all.
    }
  }

  await deps.cache?.set({
    key,
    fileSha256,
    promptVersion: EXTRACT_PROMPT_VERSION,
    model: deps.llm.model,
    terms: result.terms,
    warnings: result.warnings,
    usage,
    ...(result.repairedFields.length ? { repairedFields: result.repairedFields } : {}),
  });
  return { terms: result.terms, warnings: result.warnings, usage, fromCache: false, ...(result.repairedFields.length ? { repairedFields: result.repairedFields } : {}) };
}

export { type ExtractionCache, JsonFileExtractionCache, MemoryExtractionCache } from './cache.js';
export { type ExtractionWarning, verifyQuotes } from './verifyQuotes.js';
export { EXTRACT_PROMPT_VERSION } from './prompts/extractTerms.js';
