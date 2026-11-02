// FAKE MODE ONLY (--fake-llm): the known-document registry. Maps sha256(file bytes) -> answer-key ExtractedTerms,
// built from fixtures/ground-truth + fixtures/documents and samples/uploads/*.truth.json. Read-only: it is loaded
// once, returns copies, and is NEVER constructed or consulted in live mode (the live path gets the LLM reader).

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { checkTerms } from '../documents/index.js';
import { readPdfText } from '../documents/pdfText.js';
import { ExtractedTermsSchema, parseGroundTruth } from '../domain/schemas.js';
import type { ExtractedTerms } from '../domain/types.js';
import { FAKE_MODEL_NAME, type TermsReader } from '../pipeline/readers.js';
import { UploadRejectedError } from './errors.js';

export const SAMPLE_TRUTH_SUFFIX = '.truth.json';

export const SampleTruthSchema = z.object({
  /** File name of the sample PDF in the same folder. */
  document: z.string().regex(/^[a-z0-9-]+\.pdf$/),
  kind: z.enum(['expiring', 'renewal']),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Synthetic sample, invented for Prompt 7 (never real data). */
  synthetic: z.literal(true),
  expectedTerms: ExtractedTermsSchema,
});
export type SampleTruth = z.infer<typeof SampleTruthSchema>;

export interface KnownDocumentRegistry {
  has(sha256: string): boolean;
  /** A copy of the answer key, or undefined. */
  get(sha256: string): ExtractedTerms | undefined;
  readonly size: number;
}

export function sha256OfFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Load the registry. A sample whose bytes do not match its truth file is a hard error (the sample was changed). */
export function loadKnownDocuments(options: { fixturesDir: string; samplesDir?: string }): KnownDocumentRegistry {
  const entries = new Map<string, ExtractedTerms>();
  const truthDir = path.join(options.fixturesDir, 'ground-truth');
  for (const name of readdirSync(truthDir).filter((n) => /^pol-s\d{2}\.json$/.test(n)).sort()) {
    const truth = parseGroundTruth(JSON.parse(readFileSync(path.join(truthDir, name), 'utf8')));
    for (const kind of ['expiring', 'renewal'] as const) {
      const terms = truth.expectedTerms[kind];
      const pdf = path.join(options.fixturesDir, 'documents', truth.policyId, `${kind}.pdf`);
      if (terms && existsSync(pdf)) entries.set(sha256OfFile(pdf), terms);
    }
  }
  if (options.samplesDir && existsSync(options.samplesDir)) {
    for (const name of readdirSync(options.samplesDir).filter((n) => n.endsWith(SAMPLE_TRUTH_SUFFIX)).sort()) {
      const sample = SampleTruthSchema.parse(JSON.parse(readFileSync(path.join(options.samplesDir, name), 'utf8')));
      const actual = sha256OfFile(path.join(options.samplesDir, sample.document));
      if (actual !== sample.sha256) throw new Error(`Sample ${sample.document} does not match ${name} (regenerate the samples)`);
      entries.set(sample.sha256, sample.expectedTerms);
    }
  }
  return {
    has: (sha256) => entries.has(sha256),
    get: (sha256) => {
      const terms = entries.get(sha256);
      return terms ? structuredClone(terms) : undefined;
    },
    get size() {
      return entries.size;
    },
  };
}

/**
 * Fake reader for uploads: the REAL PDF text check first (missing / image-only files fail exactly as in live
 * mode), then the answer key looked up by the bytes' sha256, then the same plain-code checks as the live path
 * (quotes against the page, consistency across facts). An unknown document is refused with unknown_in_fake_mode. No LLM, no cache, no writes.
 */
export function createKnownDocumentReader(registry: KnownDocumentRegistry): TermsReader {
  const read: TermsReader['read'] = async (pdfPath, ctx) => {
    const pdf = await readPdfText(pdfPath, ctx.policyId, ctx.kind);
    const terms = registry.get(sha256OfFile(pdfPath));
    if (!terms) throw new UploadRejectedError('unknown_in_fake_mode', ctx.kind);
    // The same plain-code checks as live mode: quotes against the page, then consistency across facts.
    const verified = checkTerms(terms, pdf.pages);
    return { terms: verified.terms, warnings: verified.warnings, usage: { inputTokens: 0, outputTokens: 0 }, fromCache: false };
  };
  return { modelName: FAKE_MODEL_NAME, isFake: true, read, peek: read };
}
