// Extraction cache: a hit makes ZERO LLM calls. Key = sha256(file bytes) +
// prompt version + model name. Stores only the validated, verified result and
// the usage, never the document text.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ExtractedTermsSchema } from '../domain/schemas.js';
import type { ExtractedTerms } from '../domain/types.js';
import type { LlmUsage } from '../llm/client.js';
import { EXTRACTION_WARNING_CODES, type ExtractionWarning } from './verifyQuotes.js';

export interface CachedExtraction {
  key: string;
  fileSha256: string;
  promptVersion: string;
  model: string;
  terms: ExtractedTerms;
  warnings: ExtractionWarning[];
  /** Tokens spent when this result was first produced. */
  usage: LlmUsage;
  /** D-120: facts confirmed by the repair reading (absent in older entries). */
  repairedFields?: string[];
}

export interface ExtractionCache {
  get(key: string): Promise<CachedExtraction | undefined>;
  set(entry: CachedExtraction): Promise<void>;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function extractionCacheKey(fileSha256: string, promptVersion: string, model: string): string {
  return `${fileSha256}|${promptVersion}|${model}`;
}

const CachedExtractionSchema = z.object({
  key: z.string(),
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  promptVersion: z.string(),
  model: z.string(),
  terms: ExtractedTermsSchema,
  warnings: z.array(
    z.object({
      code: z.enum(EXTRACTION_WARNING_CODES),
      field: z.string(),
      sourcePage: z.number().int().nullable(),
      message: z.string(),
    }),
  ),
  usage: z.object({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0) }),
  repairedFields: z.array(z.string()).optional(),
});

/** One JSON file per key under dir (default .cache/extractions, gitignored). */
export class JsonFileExtractionCache implements ExtractionCache {
  readonly dir: string;

  constructor(dir = path.join('.cache', 'extractions')) {
    this.dir = path.resolve(dir);
  }

  private fileFor(key: string): string {
    return path.join(this.dir, `${sha256Hex(key)}.json`);
  }

  async get(key: string): Promise<CachedExtraction | undefined> {
    const file = this.fileFor(key);
    if (!existsSync(file)) return undefined;
    try {
      const entry = CachedExtractionSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      return entry.key === key ? entry : undefined; // guards against a (very unlikely) filename collision
    } catch {
      return undefined; // a corrupt entry is a miss, never a crash
    }
  }

  async set(entry: CachedExtraction): Promise<void> {
    const validated = CachedExtractionSchema.parse(entry);
    mkdirSync(this.dir, { recursive: true });
    const file = this.fileFor(entry.key);
    writeFileSync(`${file}.tmp`, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
    renameSync(`${file}.tmp`, file);
  }
}

/** In-memory cache for tests. */
export class MemoryExtractionCache implements ExtractionCache {
  private readonly entries = new Map<string, CachedExtraction>();

  async get(key: string): Promise<CachedExtraction | undefined> {
    return this.entries.get(key);
  }

  async set(entry: CachedExtraction): Promise<void> {
    this.entries.set(entry.key, structuredClone(entry));
  }

  get size(): number {
    return this.entries.size;
  }
}
