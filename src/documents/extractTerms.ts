// PDF -> ExtractedTerms via the LLM. The model's output is validated with Zod
// (inside completeJson); quote/value checks happen afterwards in verifyQuotes.ts.

import { ExtractedTermsSchema } from '../domain/schemas.js';
import type { ExtractedTerms } from '../domain/types.js';
import type { LlmClient, LlmUsage } from '../llm/client.js';
import { type PdfText, readPdfText } from './pdfText.js';
import { buildExtractionPrompt } from './prompts/extractTerms.js';

export interface ExtractDeps {
  llm: LlmClient;
  maxRetries?: number;
}

export interface ExtractionResult {
  terms: ExtractedTerms;
  usage: LlmUsage;
  model: string;
}

/** Extract from already-read page text (used by readPolicyTerms to avoid reading the PDF twice). */
export async function extractTermsFromPdfText(pdf: PdfText, deps: ExtractDeps): Promise<ExtractionResult> {
  const { system, user } = buildExtractionPrompt(pdf.pages);
  const result = await deps.llm.completeJson({
    system,
    user,
    schema: ExtractedTermsSchema,
    ...(deps.maxRetries === undefined ? {} : { maxRetries: deps.maxRetries }),
  });
  return { terms: result.data, usage: result.usage, model: result.model };
}

/** Read a PDF and extract its terms. Throws DocumentMissingError / DocumentUnreadableError / LlmOutputInvalidError. */
export async function extractTerms(pdfPath: string, deps: ExtractDeps): Promise<ExtractedTerms> {
  const pdf = await readPdfText(pdfPath);
  return (await extractTermsFromPdfText(pdf, deps)).terms;
}
