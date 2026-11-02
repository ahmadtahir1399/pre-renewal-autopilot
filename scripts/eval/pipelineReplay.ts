// Runs the REAL pipeline (selection -> compare -> outputs -> state) in a throwaway folder and
// reports what happened to each of the 15 scenarios. The terms reader is either the fake
// (answer keys) or a REPLAY of extractions already measured with the live LLM, so the live
// evaluation never pays twice for the same document (REPLAY DESIGN, D-127).

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deriveOverallRisk } from '../../src/compare/compareTerms.js';
import { LocalJsonSource } from '../../src/data/localJsonSource.js';
import { loadSeedState } from '../../src/data/seedState.js';
import { manualInstantClock } from '../../src/domain/dates.js';
import { LlmOutputInvalidError } from '../../src/domain/errors.js';
import type { IsoDate } from '../../src/domain/types.js';
import type { CompareConfig } from '../../src/compare/compareTerms.js';
import { readPdfText } from '../../src/documents/pdfText.js';
import { seedFromState } from '../../src/pipeline/demo.js';
import type { TermsReader } from '../../src/pipeline/readers.js';
import { type RunSummary, runPipeline } from '../../src/pipeline/runPipeline.js';
import { migrate, openDatabase } from '../../src/state/db.js';
import { getActivePack, listCases } from '../../src/state/repo.js';
import type { DocExtraction, ScenarioOutcome } from './types.js';

export function docKey(policyId: string, side: string): string {
  return `${policyId}/${side}`;
}

/** Replays measured extractions. The real PDF text check still runs, so pol-s08 still fails as unreadable. */
export function createReplayReader(extractions: readonly DocExtraction[], modelName: string): TermsReader {
  const byKey = new Map(extractions.map((e) => [docKey(e.policyId, e.side), e]));
  const read: TermsReader['read'] = async (pdfPath, ctx) => {
    await readPdfText(pdfPath, ctx.policyId, ctx.kind);
    const measured = byKey.get(docKey(ctx.policyId, ctx.kind));
    if (!measured) throw new Error(`no measured extraction for ${ctx.policyId} ${ctx.kind}`);
    if (!measured.ok || !measured.terms) {
      if (measured.errorCode === 'llm_output_invalid') throw new LlmOutputInvalidError([measured.errorMessage ?? 'invalid output'], 3);
      throw new Error(`${measured.errorCode ?? 'error'}: ${measured.errorMessage ?? ''}`);
    }
    return {
      terms: structuredClone(measured.terms),
      warnings: measured.warnings,
      usage: { inputTokens: measured.usage.inputTokens, outputTokens: measured.usage.outputTokens },
      fromCache: false,
    };
  };
  return { modelName, isFake: false, read, peek: read };
}

export interface ReplayResult {
  summary: RunSummary;
  outcomes: ScenarioOutcome[];
}

export async function runPipelineReplay(options: { fixturesDir: string; today: IsoDate; reader: TermsReader; maxConcurrency: number; compareConfig: CompareConfig; windowMinDays: number; windowMaxDays: number }): Promise<ReplayResult> {
  const root = mkdtempSync(path.join(tmpdir(), 'pra-eval-'));
  const clock = manualInstantClock('2026-10-18T18:00:00.000Z');
  const db = openDatabase(path.join(root, 'runtime', 'autopilot.db'));
  try {
    migrate(db, clock);
    seedFromState(db, clock, loadSeedState(options.fixturesDir));
    const dataSource = new LocalJsonSource({ fixturesDir: options.fixturesDir, dataDir: path.join(root, 'data') });
    const outputDir = path.join(root, 'output');
    const summary = await runPipeline({
      today: options.today,
      dryRun: false,
      deps: {
        dataSource,
        db,
        reader: options.reader,
        clock,
        compareConfig: options.compareConfig,
        windowMinDays: options.windowMinDays,
        windowMaxDays: options.windowMaxDays,
        outputDir,
        dataDir: path.join(root, 'data'),
        maxConcurrency: options.maxConcurrency,
        autopilotEnabled: true,
      },
    });
    const cases = listCases(db);
    const policies = await dataSource.listPolicies();
    const outcomes = policies.map((policy): ScenarioOutcome => {
      const row = summary.rows.find((r) => r.policyId === policy.id);
      const caseRow = cases.find((c) => c.policyId === policy.id);
      const pack = caseRow ? getActivePack(db, caseRow.id) : undefined;
      const selection = row?.outcome === 'skipped_outside_window' ? 'outside_window' : row?.outcome === 'skipped_already_processed' ? 'already_processed' : 'selected';
      const files = pack ? [pack.paths.xlsx, pack.paths.clientEml, pack.paths.insurerEml, pack.paths.summaryTxt] : [];
      return {
        policyId: policy.id,
        selection,
        runOutcome: row?.outcome ?? 'skipped_outside_window',
        runNote: row?.note ?? null,
        finalStatus: caseRow?.status ?? policy.status,
        diffs: pack ? pack.pack.diffs : null,
        flags: pack ? pack.pack.flags : null,
        overallRisk: pack ? deriveOverallRisk(pack.pack.diffs, pack.pack.flags) : null,
        filesOk: pack ? files.every((f) => existsSync(path.join(outputDir, ...f.split('/')))) : null,
      };
    });
    return { summary, outcomes };
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}
