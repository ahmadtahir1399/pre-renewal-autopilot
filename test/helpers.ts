// Shared test setup: a temp project with the 15 fixtures run through the pipeline (fake LLM).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DataSource } from '../src/data/datasource.js';
import { LocalJsonSource } from '../src/data/localJsonSource.js';
import { loadSeedState } from '../src/data/seedState.js';
import { manualInstantClock } from '../src/domain/dates.js';
import { seedFromState } from '../src/pipeline/demo.js';
import { createGroundTruthReader, type TermsReader } from '../src/pipeline/readers.js';
import { type PipelineDeps, runPipeline } from '../src/pipeline/runPipeline.js';
import { type Db, migrate, openDatabase } from '../src/state/db.js';
import { getActivePack, getCaseByCycleKey, listCases, type PackRow } from '../src/state/repo.js';

export const FIXTURES = path.join(process.cwd(), 'fixtures');

/**
 * D-125: the ONLY script tags a page may carry, in this order, at the end of <head>: four external, same-origin,
 * content-hashed files (motion boot, GSAP, ScrollTrigger, motion layer). No inline code, no attributes besides
 * src and defer.
 */
export const MOTION_SCRIPTS = new RegExp(
  ['boot', 'gsap', 'scrolltrigger', 'motion']
    .map((name) => `<script src="/assets/js/${name}\\.[a-f0-9]{12}\\.js"${name === 'boot' ? '' : ' defer'}></script>`)
    .join('')
    .concat('</head>'),
);

/** The page with its whitelisted motion scripts removed: what is left must not contain "<script" at all. */
export function stripMotionScripts(html: string): string {
  return html.replace(MOTION_SCRIPTS, '</head>');
}

export const TODAY = '2026-10-19';

export interface Demo {
  root: string;
  db: Db;
  clock: ReturnType<typeof manualInstantClock>;
  dataSource: LocalJsonSource;
  outputDir: string;
  dataDir: string;
  overlayPath: string;
  pipelineDeps(overrides?: Partial<PipelineDeps>): PipelineDeps;
  packFor(policyId: string): PackRow;
  cleanup(): void;
}

export async function createDemo(options: { runPipeline?: boolean } = {}): Promise<Demo> {
  const root = mkdtempSync(path.join(tmpdir(), 'pra-demo-'));
  const clock = manualInstantClock('2026-10-18T18:00:00.000Z');
  const db = openDatabase(path.join(root, 'runtime', 'autopilot.db'));
  migrate(db, clock);
  seedFromState(db, clock, loadSeedState(FIXTURES));
  const dataDir = path.join(root, 'data');
  const outputDir = path.join(root, 'output');
  const dataSource = new LocalJsonSource({ fixturesDir: FIXTURES, dataDir });
  const pipelineDeps = (overrides: Partial<PipelineDeps> = {}): PipelineDeps => ({
    dataSource,
    db,
    reader: createGroundTruthReader(FIXTURES),
    clock,
    compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 },
    outputDir,
    dataDir,
    maxConcurrency: 2,
    autopilotEnabled: true,
    ...overrides,
  });
  const demo: Demo = {
    root,
    db,
    clock,
    dataSource,
    outputDir,
    dataDir,
    overlayPath: path.join(dataDir, 'runtime', 'status-overlay.json'),
    pipelineDeps,
    packFor(policyId) {
      const caseRow = listCases(db).find((c) => c.policyId === policyId);
      const pack = caseRow ? getActivePack(db, caseRow.id) : undefined;
      if (!pack) throw new Error(`no active pack for ${policyId}`);
      return pack;
    },
    cleanup() {
      try {
        db.close();
      } catch {
        // already closed
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
  if (options.runPipeline !== false) await runPipeline({ today: TODAY, dryRun: false, deps: pipelineDeps() });
  return demo;
}

export function withModel(reader: TermsReader, modelName: string): TermsReader {
  return { ...reader, modelName };
}

export function caseStatus(db: Db, cycleKey: string): string | undefined {
  return getCaseByCycleKey(db, cycleKey)?.status;
}

/** A data source whose only write fails (for status-sync failure tests). */
export function failingWrites(source: DataSource): DataSource & { fail: boolean } {
  const wrapper = {
    fail: true,
    listPolicies: () => source.listPolicies(),
    getPolicy: (id: string) => source.getPolicy(id),
    getClient: (id: string) => source.getClient(id),
    getBroker: (id: string) => source.getBroker(id),
    getDocumentPaths: (id: string) => source.getDocumentPaths(id),
    updateRenewalStatus: async (id: string, status: Parameters<DataSource['updateRenewalStatus']>[1]) => {
      if (wrapper.fail) throw new Error('data source unavailable');
      await source.updateRenewalStatus(id, status);
    },
  };
  return wrapper;
}
