// Reads fixtures/data/seed-state.json: cycles already processed before the
// first run (pol-s12 approved). Read-only. Prompt 4 loads it into SQLite.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DataSourceError } from '../domain/errors.js';
import { parseSeedState } from '../domain/schemas.js';
import type { SeedState } from '../domain/types.js';

export function loadSeedState(fixturesDir: string): SeedState {
  const filePath = path.join(fixturesDir, 'data', 'seed-state.json');
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new DataSourceError(`Cannot read ${filePath}`, { cause: error });
  }
  return parseSeedState(raw, 'seed-state.json');
}

/** The cycle keys that must not be processed again. */
export function processedCycleKeysFrom(seed: SeedState): Set<string> {
  return new Set(seed.records.map((record) => record.cycleKey));
}
