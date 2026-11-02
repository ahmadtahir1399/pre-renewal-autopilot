// How the pipeline reads policy terms. Three implementations:
//  - LLM reader (production): Prompt 2's readPolicyTerms with the JSON-file cache.
//  - Cache-only reader (dry run, real mode): reads the cache, NEVER calls the LLM, never writes.
//  - Ground-truth reader (--fake-llm, tests, demo): the REAL pdfText check first, then the answer key.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type ExtractionCache, extractionCacheKey, sha256Hex } from '../documents/cache.js';
import { type ReadPolicyTermsResult, readPolicyTerms } from '../documents/index.js';
import { readPdfText } from '../documents/pdfText.js';
import { EXTRACT_PROMPT_VERSION } from '../documents/prompts/extractTerms.js';
import { parseGroundTruth } from '../domain/schemas.js';
import type { LlmClient } from '../llm/client.js';

export type DocumentKind = 'expiring' | 'renewal';

export interface ReadContext {
  policyId: string;
  kind: DocumentKind;
}

export interface TermsReader {
  /** Model name used in the input hash and cache key. */
  readonly modelName: string;
  readonly isFake: boolean;
  /** Full read (may call the LLM and write the cache). */
  read(pdfPath: string, ctx: ReadContext): Promise<ReadPolicyTermsResult>;
  /** Dry-run read: cached result or undefined. Must not call the LLM or write anything. */
  peek(pdfPath: string, ctx: ReadContext): Promise<ReadPolicyTermsResult | undefined>;
}

export function createLlmReader(llm: LlmClient, cache: ExtractionCache, options: { repair?: boolean } = {}): TermsReader {
  return {
    modelName: llm.model,
    isFake: false,
    read: (pdfPath, ctx) =>
      readPolicyTerms(pdfPath, { llm, cache, policyId: ctx.policyId, documentKind: ctx.kind, ...(options.repair === undefined ? {} : { repair: options.repair }) }),
    peek: (pdfPath) => peekCache(pdfPath, llm.model, cache),
  };
}

/** Dry run without an LLM client: only the model NAME is needed for the cache key. */
export function createCacheOnlyReader(modelName: string, cache: ExtractionCache): TermsReader {
  return {
    modelName,
    isFake: false,
    read: () => {
      throw new Error('The cache-only reader cannot extract (dry run)');
    },
    peek: (pdfPath) => peekCache(pdfPath, modelName, cache),
  };
}

async function peekCache(pdfPath: string, modelName: string, cache: ExtractionCache): Promise<ReadPolicyTermsResult | undefined> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(pdfPath);
  } catch {
    return undefined;
  }
  const entry = await cache.get(extractionCacheKey(sha256Hex(bytes), EXTRACT_PROMPT_VERSION, modelName));
  return entry ? { terms: entry.terms, warnings: entry.warnings, usage: entry.usage, fromCache: true } : undefined;
}

export const FAKE_MODEL_NAME = 'fake-llm-ground-truth';

/** <fixturesDir>/documents/<policyId>/<kind>.pdf -> { policyId, kind } (from the PATH, as required). */
export function policyAndKindFromPath(pdfPath: string): ReadContext {
  const kind = path.basename(pdfPath, '.pdf');
  const policyId = path.basename(path.dirname(pdfPath));
  if ((kind !== 'expiring' && kind !== 'renewal') || !/^pol-s\d{2}$/.test(policyId)) {
    throw new Error(`Fake LLM cannot map "${pdfPath}" to a fixture policy and side`);
  }
  return { policyId, kind };
}

/**
 * FAKE LLM (explicit --fake-llm only): runs the real PDF text check (so missing files throw
 * DocumentMissingError and image-only PDFs throw DocumentUnreadableError), then returns the
 * answer-key ExtractedTerms. No LLM, no cache, no writes.
 */
export function createGroundTruthReader(fixturesDir: string): TermsReader {
  const read = async (pdfPath: string): Promise<ReadPolicyTermsResult> => {
    const { policyId, kind } = policyAndKindFromPath(pdfPath);
    await readPdfText(pdfPath, policyId, kind);
    const truth = parseGroundTruth(JSON.parse(readFileSync(path.join(fixturesDir, 'ground-truth', `${policyId}.json`), 'utf8')));
    const terms = truth.expectedTerms[kind];
    if (!terms) throw new Error(`Answer key has no ${kind} terms for ${policyId}`);
    return { terms: structuredClone(terms), warnings: [], usage: { inputTokens: 0, outputTokens: 0 }, fromCache: false };
  };
  return { modelName: FAKE_MODEL_NAME, isFake: true, read, peek: read };
}

export const FAKE_LLM_BANNER = [
  '*******************************************************************',
  '*  FAKE LLM MODE: policy terms come from the answer keys, not AI  *',
  '*******************************************************************',
].join('\n');
