import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveOverallRisk } from '../src/compare/compareTerms.js';
import { LocalJsonSource } from '../src/data/localJsonSource.js';
import { loadSeedState } from '../src/data/seedState.js';
import { manualInstantClock } from '../src/domain/dates.js';
import { parseGroundTruth } from '../src/domain/schemas.js';
import { seedFromState } from '../src/pipeline/demo.js';
import { pause } from '../src/pipeline/killSwitch.js';
import { createGroundTruthReader, type TermsReader } from '../src/pipeline/readers.js';
import { type PipelineDeps, type RunSummary, runPipeline } from '../src/pipeline/runPipeline.js';
import { createAuditLog, listAllAudit } from '../src/state/audit.js';
import { all, type Db, migrate, openDatabase, openDatabaseReadOnly } from '../src/state/db.js';
import { getActivePack, getCaseByCycleKey, listCases, listPacks, transitionCase } from '../src/state/repo.js';

const FIXTURES = path.join(process.cwd(), 'fixtures');
const TODAY = '2026-10-19';
const PACK_POLICIES = ['pol-s01', 'pol-s02', 'pol-s03', 'pol-s04', 'pol-s05', 'pol-s06', 'pol-s10', 'pol-s11', 'pol-s13', 'pol-s14', 'pol-s15'];

let root: string;
let db: Db;
let dbPath: string;
const clock = manualInstantClock('2026-10-18T18:00:00.000Z');

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    dataSource: new LocalJsonSource({ fixturesDir: FIXTURES, dataDir: path.join(root, 'data') }),
    db,
    reader: createGroundTruthReader(FIXTURES),
    clock,
    compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 },
    outputDir: path.join(root, 'output'),
    dataDir: path.join(root, 'data'),
    maxConcurrency: 2,
    autopilotEnabled: true,
    ...overrides,
  };
}

const run = (overrides: Partial<PipelineDeps> = {}, extra: { dryRun?: boolean; only?: string; force?: boolean } = {}): Promise<RunSummary> =>
  runPipeline({ today: TODAY, dryRun: extra.dryRun ?? false, ...(extra.only ? { only: extra.only } : {}), force: extra.force ?? false, deps: deps(overrides) });

/** Same reader, different model name: every input hash changes. */
function withModel(reader: TermsReader, modelName: string): TermsReader {
  return { ...reader, modelName };
}

function throwingFor(policyId: string, reader: TermsReader): TermsReader {
  return { ...reader, read: async (p, ctx) => (ctx.policyId === policyId ? Promise.reject(new Error('simulated reader crash')) : reader.read(p, ctx)) };
}

function outcomeOf(summary: RunSummary, policyId: string) {
  return summary.rows.find((r) => r.policyId === policyId)?.outcome;
}

function snapshotTree(...dirs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    if (!existsSync(current)) return;
    if (statSync(current).isFile()) {
      out[current] = createHash('sha256').update(readFileSync(current)).digest('hex');
      return;
    }
    for (const name of readdirSync(current)) walk(path.join(current, name));
  };
  for (const d of dirs) walk(d);
  return out;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'pra-pipe-'));
  dbPath = path.join(root, 'runtime', 'autopilot.db');
  db = openDatabase(dbPath);
  migrate(db, clock);
  seedFromState(db, clock, loadSeedState(FIXTURES));
});
afterEach(() => {
  try {
    db.close();
  } catch {
    // already closed by the test
  }
  rmSync(root, { recursive: true, force: true });
});

describe('runPipeline on the 15 fixtures (fake LLM = answer keys)', () => {
  it('produces exactly the D-D outcomes and answer-key overall risks', async () => {
    const summary = await run();
    expect(summary.counts).toEqual({
      new_pack: 11,
      new_version: 0,
      unchanged_skip: 0,
      needs_attention: 2,
      skipped_outside_window: 1,
      skipped_already_processed: 1,
      failed_kept_previous: 0,
      failed_not_saved: 0,
    });
    for (const policyId of PACK_POLICIES) {
      const gt = parseGroundTruth(JSON.parse(readFileSync(path.join(FIXTURES, 'ground-truth', `${policyId}.json`), 'utf8')));
      const caseRow = getCaseByCycleKey(db, gt.cycleKey);
      expect(caseRow?.status, policyId).toBe('in_review');
      const pack = getActivePack(db, caseRow?.id ?? -1);
      expect(pack?.version).toBe(1);
      expect(deriveOverallRisk(pack?.pack.diffs ?? [], pack?.pack.flags ?? []), policyId).toBe(gt.expectedOverallRisk);
      expect(existsSync(path.join(root, 'output', ...(pack?.paths.xlsx ?? '').split('/')))).toBe(true);
    }
    for (const policyId of ['pol-s07', 'pol-s08']) {
      const caseRow = listCases(db).find((c) => c.policyId === policyId);
      expect(caseRow?.status).toBe('needs_attention');
      expect(getActivePack(db, caseRow?.id ?? -1)).toBeUndefined();
    }
    expect(summary.rows.find((r) => r.policyId === 'pol-s07')?.note).toBe('renewal document missing');
    expect(summary.rows.find((r) => r.policyId === 'pol-s08')?.note).toContain('image-only');
    expect(listCases(db).some((c) => c.policyId === 'pol-s09')).toBe(false);
    expect(listCases(db).find((c) => c.policyId === 'pol-s12')?.status).toBe('approved');
    expect(listPacks(db)).toHaveLength(11);
  });

  it('writes an audit event for every status transition (11 x 2 + 2) and never touches the overlay', async () => {
    await run();
    const changes = listAllAudit(db).filter((e) => e.type === 'status_changed');
    expect(changes).toHaveLength(24);
    expect(existsSync(path.join(root, 'data', 'runtime', 'status-overlay.json'))).toBe(false);
    const runs = all(db, 'SELECT status, summary_json FROM runs');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('finished');
  });

  it('running twice creates one pack per case', async () => {
    await run();
    const second = await run();
    expect(second.counts.unchanged_skip).toBe(13);
    expect(second.counts.new_pack).toBe(0);
    expect(listPacks(db)).toHaveLength(11);
  });

  it('a changed input creates v2, supersedes v1 and keeps the case in_review', async () => {
    await run();
    const second = await run({ reader: withModel(createGroundTruthReader(FIXTURES), 'another-model') });
    expect(second.counts.new_version).toBe(11);
    const s02 = getCaseByCycleKey(db, 'pol-s02:2027-01-25');
    expect(s02?.status).toBe('in_review');
    expect(s02?.currentVersion).toBe(2);
    const versions = listPacks(db).filter((p) => p.caseId === s02?.id);
    expect(versions.map((p) => [p.version, p.status])).toEqual([
      [1, 'superseded'],
      [2, 'active'],
    ]);
    expect(createAuditLog(db, clock).listAudit('pol-s02').some((e) => e.type === 'pack_superseded')).toBe(true);
  });

  it('one policy that throws does not stop the others', async () => {
    const summary = await run({ reader: throwingFor('pol-s03', createGroundTruthReader(FIXTURES)) });
    expect(outcomeOf(summary, 'pol-s03')).toBe('needs_attention');
    expect(summary.counts.new_pack).toBe(10);
    // A transient failure is retried on the next run (its input hash was not stored).
    const retry = await run();
    expect(outcomeOf(retry, 'pol-s03')).toBe('new_pack');
  });

  it('a failure on a case with an active pack keeps the previous pack (never demoted)', async () => {
    await run();
    const summary = await run({ reader: throwingFor('pol-s03', withModel(createGroundTruthReader(FIXTURES), 'model-2')) });
    expect(outcomeOf(summary, 'pol-s03')).toBe('failed_kept_previous');
    const s03 = getCaseByCycleKey(db, 'pol-s03:2027-01-12');
    expect(s03?.status).toBe('in_review');
    expect(getActivePack(db, s03?.id ?? -1)?.version).toBe(1);
    expect(createAuditLog(db, clock).listAudit('pol-s03').some((e) => e.type === 'policy_failed')).toBe(true);
  });

  it('approved and skipped cases are not reprocessed without --force', async () => {
    await run();
    const audit = createAuditLog(db, clock);
    const s01 = getCaseByCycleKey(db, 'pol-s01:2027-01-17');
    if (!s01) throw new Error('missing case');
    transitionCase(db, clock, audit, { caseRow: s01, to: 'approved', actor: 'broker:cli' });
    const s05 = getCaseByCycleKey(db, 'pol-s05:2027-01-18');
    if (!s05) throw new Error('missing case');
    transitionCase(db, clock, audit, { caseRow: s05, to: 'skipped', actor: 'broker:cli' });

    const changed = await run({ reader: withModel(createGroundTruthReader(FIXTURES), 'model-2') });
    expect(outcomeOf(changed, 'pol-s01')).toBe('skipped_already_processed');
    expect(outcomeOf(changed, 'pol-s05')).toBe('skipped_already_processed');

    const forced = await run({ reader: withModel(createGroundTruthReader(FIXTURES), 'model-2') }, { only: 'pol-s01', force: true });
    expect(outcomeOf(forced, 'pol-s01')).toBe('new_version');
    expect(getCaseByCycleKey(db, 'pol-s01:2027-01-17')?.status).toBe('in_review');
    expect(audit.listAudit('pol-s01').some((e) => e.type === 'forced_rerun')).toBe(true);
    await expect(run({}, { force: true })).rejects.toThrow('--force requires --only');
  });

  it('a transaction failure leaves no half state', async () => {
    const summary = await run({
      beforeCommit: (policyId) => {
        if (policyId === 'pol-s05') throw new Error('simulated database failure');
      },
    });
    expect(outcomeOf(summary, 'pol-s05')).toBe('needs_attention');
    const s05 = getCaseByCycleKey(db, 'pol-s05:2027-01-18');
    expect(s05?.status).toBe('needs_attention');
    expect(listPacks(db).filter((p) => p.caseId === s05?.id)).toHaveLength(0);
    const s05Events = createAuditLog(db, clock).listAudit('pol-s05');
    expect(s05Events.some((e) => e.type === 'status_changed' && e.details.to === 'drafted')).toBe(false);
    // The orphan folder on disk is replaced by the next successful run.
    const retry = await run();
    expect(outcomeOf(retry, 'pol-s05')).toBe('new_pack');
    expect(getCaseByCycleKey(db, 'pol-s05:2027-01-18')?.status).toBe('in_review');
  });

  it('the kill switch stops the run and audits it', async () => {
    pause(path.join(root, 'data'));
    const blocked = await run();
    expect(blocked.blocked).toBe(true);
    expect(listPacks(db)).toHaveLength(0);
    expect(listAllAudit(db).some((e) => e.type === 'run_blocked_pause')).toBe(true);
    rmSync(path.join(root, 'data', 'PAUSE'));
    const disabled = await run({ autopilotEnabled: false });
    expect(disabled.blockedReason).toBe('AUTOPILOT_ENABLED is false');
  });

  it('calls onPacksReady with new packs and new notices; a failing hook is audited, not fatal', async () => {
    const seen: Array<[number, number]> = [];
    await run({ onPacksReady: async (packs, notices) => void seen.push([packs.length, notices.length]) });
    expect(seen).toEqual([[11, 2]]);
    const summary = await run({
      reader: withModel(createGroundTruthReader(FIXTURES), 'model-3'),
      onPacksReady: async () => {
        throw new Error('notifier down');
      },
    });
    expect(summary.counts.new_version).toBe(11);
    expect(listAllAudit(db).some((e) => e.type === 'notification_failed')).toBe(true);
  });
});

describe('dry run', () => {
  it('makes ZERO writes (database, overlay, output, cache) on existing state', async () => {
    await run();
    db.close();
    const cacheDir = path.join(root, '.cache');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(path.join(cacheDir, 'marker.json'), '{}');
    const before = snapshotTree(path.join(root, 'runtime'), path.join(root, 'data'), path.join(root, 'output'), cacheDir);
    const readOnly = openDatabaseReadOnly(dbPath);
    const lines: string[] = [];
    const summary = await runPipeline({
      today: TODAY,
      dryRun: true,
      deps: deps({ db: readOnly, reader: withModel(createGroundTruthReader(FIXTURES), 'model-2'), print: (l) => lines.push(l) }),
    });
    readOnly?.close();
    expect(summary.counts.new_version).toBe(11);
    expect(lines.some((l) => l.startsWith('[dry run] pol-s02: would be new_version'))).toBe(true);
    expect(snapshotTree(path.join(root, 'runtime'), path.join(root, 'data'), path.join(root, 'output'), cacheDir)).toEqual(before);
    db = openDatabase(dbPath); // for afterEach
  });

  it('does not create a database when none exists', async () => {
    const fresh = path.join(root, 'fresh');
    const summary = await runPipeline({
      today: TODAY,
      dryRun: true,
      deps: { ...deps({ db: null }), dataDir: path.join(fresh, 'data'), outputDir: path.join(fresh, 'output') },
    });
    expect(summary.counts.new_pack).toBe(12); // pol-s12 is not "processed" without a database...
    expect(existsSync(fresh)).toBe(false); // ...and nothing was created
  });

  it('a cache-only reader reports "would extract (not cached)" and never extracts', async () => {
    const reader: TermsReader = {
      modelName: 'm',
      isFake: false,
      read: () => Promise.reject(new Error('must not be called')),
      peek: async () => undefined,
    };
    const summary = await runPipeline({ today: TODAY, dryRun: true, deps: deps({ db: null, reader }) });
    expect(summary.rows.find((r) => r.policyId === 'pol-s01')?.note).toBe('would extract (not cached)');
  });
});
