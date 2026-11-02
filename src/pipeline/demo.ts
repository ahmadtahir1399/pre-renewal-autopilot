// reset-demo: clear runtime state (database, status overlay, output; the extraction cache is kept),
// re-run migrations, seed pol-s12 as approved from fixtures/data/seed-state.json, audit 'demo_reset'.

import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { DataSource } from '../data/datasource.js';
import { loadSeedState } from '../data/seedState.js';
import type { InstantClock } from '../domain/dates.js';
import type { SeedState } from '../domain/types.js';
import { createAuditLog } from '../state/audit.js';
import { type Db, migrate, openDatabase, transaction } from '../state/db.js';
import { getCaseByCycleKey, insertCase } from '../state/repo.js';

/** Insert seeded cycles directly as approved (an import of earlier history, not a transition; D-064). */
export function seedFromState(db: Db, clock: InstantClock, seed: SeedState): number {
  const audit = createAuditLog(db, clock);
  let inserted = 0;
  transaction(db, () => {
    for (const record of seed.records) {
      if (getCaseByCycleKey(db, record.cycleKey)) continue;
      insertCase(db, clock, { policyId: record.policyId, cycleKey: record.cycleKey, status: 'approved' });
      audit.recordAudit({ type: 'seeded', actor: 'system', policyId: record.policyId, cycleKey: record.cycleKey, details: { status: 'approved', source: 'seed-state.json' } });
      inserted++;
    }
  });
  return inserted;
}

export interface ResetDemoInput {
  dbPath: string;
  dataDir: string;
  outputDir: string;
  fixturesDir: string;
  clock: InstantClock;
  dataSource?: DataSource;
}

export interface ResetDemoResult {
  removed: string[];
  migrations: string[];
  seeded: number;
  pausePresent: boolean;
}

function removeIfPresent(target: string, removed: string[]): void {
  if (!existsSync(target)) return;
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); // Windows may briefly lock files
  removed.push(target);
}

export function resetDemo(input: ResetDemoInput): ResetDemoResult {
  const removed: string[] = [];
  for (const suffix of ['', '-wal', '-shm', '-journal']) removeIfPresent(`${input.dbPath}${suffix}`, removed);
  removeIfPresent(path.join(input.dataDir, 'runtime'), removed);
  removeIfPresent(input.outputDir, removed);
  const db = openDatabase(input.dbPath);
  try {
    const migrations = migrate(db, input.clock);
    const seeded = seedFromState(db, input.clock, loadSeedState(input.fixturesDir));
    createAuditLog(db, input.clock).recordAudit({ type: 'demo_reset', actor: 'system', details: { removed: removed.length, seeded } });
    return { removed, migrations, seeded, pausePresent: existsSync(path.join(input.dataDir, 'PAUSE')) };
  } finally {
    db.close();
  }
}
