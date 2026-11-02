// Shared by demo:reset and demo:warm: the four demo policies and the extraction-cache check.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Env } from '../../src/config/env.js';
import { JsonFileExtractionCache, extractionCacheKey, sha256Hex } from '../../src/documents/cache.js';
import { EXTRACT_PROMPT_VERSION } from '../../src/documents/prompts/extractTerms.js';

/** pol-s01 (small change), pol-s02 (HIGH: limit halved), pol-s03 (HIGH: flood added), pol-s07 (renewal missing). */
export const DEMO_POLICIES = ['pol-s01', 'pol-s02', 'pol-s03', 'pol-s07'] as const;

/** Throwaway token used on camera only. It is set for the demo process, never written to .env. */
export const DEMO_WEB_TOKEN = 'demo-token';
export const DEMO_REFERENCE_DATE = '2026-10-19';

export interface DemoDocument {
  policyId: string;
  side: 'expiring' | 'renewal';
  path: string;
}

/** Documents the pipeline actually reads for the demo (pol-s07 stops at "renewal missing" before any read). */
export function demoDocuments(env: Env): DemoDocument[] {
  const docs: DemoDocument[] = [];
  for (const policyId of DEMO_POLICIES) {
    const expiring = path.join(env.FIXTURES_DIR, 'documents', policyId, 'expiring.pdf');
    const renewal = path.join(env.FIXTURES_DIR, 'documents', policyId, 'renewal.pdf');
    if (!existsSync(expiring) || !existsSync(renewal)) continue;
    docs.push({ policyId, side: 'expiring', path: expiring }, { policyId, side: 'renewal', path: renewal });
  }
  return docs;
}

/** Documents with no cached LIVE extraction for this model and prompt version. */
export async function uncachedDocuments(env: Env, cache = new JsonFileExtractionCache()): Promise<DemoDocument[]> {
  if (!env.LLM_MODEL) return demoDocuments(env);
  const missing: DemoDocument[] = [];
  for (const doc of demoDocuments(env)) {
    const key = extractionCacheKey(sha256Hex(readFileSync(doc.path)), EXTRACT_PROMPT_VERSION, env.LLM_MODEL);
    if (!(await cache.get(key))) missing.push(doc);
  }
  return missing;
}
