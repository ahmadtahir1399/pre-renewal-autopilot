// The conveyor belt. One daily run: select -> check documents -> idempotency -> read terms ->
// compare -> write pack -> save in ONE transaction -> audit. Every policy is isolated in its own
// try/catch, so one failure never stops the others. updateRenewalStatus is NEVER called here
// (only after an Approve, in src/approval). The per-policy body lives in processCase.ts (Prompt 7),
// shared with the upload door.

import { randomUUID } from 'node:crypto';
import { type CompareConfig, compareTerms } from '../compare/compareTerms.js';
import type { DataSource } from '../data/datasource.js';
import { cycleKey as makeCycleKey, type InstantClock } from '../domain/dates.js';
import type { IsoDate, Policy } from '../domain/types.js';
import { createAuditLog, type AuditLog } from '../state/audit.js';
import type { Db } from '../state/db.js';
import { finishRun, getCaseByCycleKey, insertRun, processedCycleKeys } from '../state/repo.js';
import { selectRenewals } from '../selection/renewalWindow.js';
import { pauseReason } from './killSwitch.js';
import {
  attentionReasonFor,
  hashFor,
  type NewPackInfo,
  type NoticeCaseInfo,
  type ProcessCaseDeps,
  type ProcessCaseResult,
  processCase,
  processCaseFailure,
  RUN_OUTCOMES,
  type RunOutcome,
  type RunRow,
} from './processCase.js';
import type { TermsReader } from './readers.js';

// Re-exported so existing imports from runPipeline.js keep working.
export { RUN_OUTCOMES, type NewPackInfo, type NoticeCaseInfo, type RunOutcome, type RunRow };

export interface RunSummary {
  runId: string | null;
  today: IsoDate;
  dryRun: boolean;
  blocked: boolean;
  blockedReason?: string;
  counts: Record<RunOutcome, number>;
  rows: RunRow[];
  totalTokens: { inputTokens: number; outputTokens: number };
  totalDurationMs: number;
}

export interface PipelineDeps {
  dataSource: DataSource;
  /** Writable database; in a dry run a READ-ONLY handle, or null when none exists yet. */
  db: Db | null;
  reader: TermsReader;
  clock: InstantClock;
  compareConfig: CompareConfig;
  outputDir: string;
  dataDir: string;
  templatePath?: string;
  maxConcurrency: number;
  autopilotEnabled: boolean;
  /** Inclusive window in days (env WINDOW_MIN_DAYS / WINDOW_MAX_DAYS); defaults 84 / 112. */
  windowMinDays?: number;
  windowMaxDays?: number;
  print?: (line: string) => void;
  /** Called after a (non-dry) run. Failures are audited and never roll the run back. */
  onPacksReady?: (packs: NewPackInfo[], noticeCases: NoticeCaseInfo[]) => Promise<void>;
  newRunId?: () => string;
  /** Test-only fault injection inside the save transaction. */
  beforeCommit?: (policyId: string) => void;
  /** Last-resort channel when even the audit log cannot be written (D-129). Default: process.stderr. */
  stderr?: (line: string) => void;
}

export interface RunOptions {
  today: IsoDate;
  dryRun: boolean;
  /** Process only this policy id. */
  only?: string;
  /** Rerun an approved/skipped cycle (requires only). */
  force?: boolean;
  deps: PipelineDeps;
}

function emptyCounts(): Record<RunOutcome, number> {
  return Object.fromEntries(RUN_OUTCOMES.map((o) => [o, 0])) as Record<RunOutcome, number>;
}

async function pool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

interface Context {
  options: RunOptions;
  deps: PipelineDeps;
  runId: string | null;
  audit: AuditLog | null;
  newPacks: NewPackInfo[];
  noticeCases: NoticeCaseInfo[];
  /** Policy failures whose audit could not be written at the time (database locked); retried at run end. */
  unrecorded: Array<{ policyId: string; cycleKey: string; reason: string; error: string }>;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 160);

export async function runPipeline(options: RunOptions): Promise<RunSummary> {
  const { deps, dryRun } = options;
  const print = deps.print ?? (() => {});
  if (options.force && !options.only) throw new Error('--force requires --only <policyId>');
  if (!dryRun && !deps.db) throw new Error('A writable database is required unless dryRun is true');
  const startedMs = deps.clock.now().getTime();
  const summary: RunSummary = {
    runId: null,
    today: options.today,
    dryRun,
    blocked: false,
    counts: emptyCounts(),
    rows: [],
    totalTokens: { inputTokens: 0, outputTokens: 0 },
    totalDurationMs: 0,
  };

  // Kill switch.
  const paused = pauseReason(deps.autopilotEnabled, deps.dataDir);
  if (paused) {
    summary.blocked = true;
    summary.blockedReason = paused;
    if (dryRun) {
      print(`Autopilot is paused (${paused}); a real run would stop here.`);
      return summary;
    }
    const db = deps.db as Db;
    const runId = (deps.newRunId ?? randomUUID)();
    summary.runId = runId;
    insertRun(db, deps.clock, { id: runId, today: options.today, dryRun, status: 'blocked' });
    createAuditLog(db, deps.clock).recordAudit({ type: 'run_blocked_pause', runId, actor: 'system', details: { reason: paused } });
    finishRun(db, deps.clock, runId, 'blocked', summary);
    return summary;
  }

  const ctx: Context = { options, deps, runId: null, audit: null, newPacks: [], noticeCases: [], unrecorded: [] };
  if (!dryRun) {
    const db = deps.db as Db;
    ctx.runId = (deps.newRunId ?? randomUUID)();
    summary.runId = ctx.runId;
    ctx.audit = createAuditLog(db, deps.clock);
    insertRun(db, deps.clock, { id: ctx.runId, today: options.today, dryRun, status: 'running' });
    ctx.audit.recordAudit({ type: 'run_started', runId: ctx.runId, actor: 'system', details: { today: options.today, only: options.only ?? null, force: options.force === true, fakeLlm: deps.reader.isFake } });
  }

  try {
    const policies = (await deps.dataSource.listPolicies()).filter((p) => !options.only || p.id === options.only);
    if (options.only && policies.length === 0) throw new Error(`Unknown policy ${options.only}`);
    const clientNameById = new Map<string, string>();
    for (const policy of policies) {
      if (!clientNameById.has(policy.clientId)) clientNameById.set(policy.clientId, (await deps.dataSource.getClient(policy.clientId))?.name ?? '');
    }
    const processed = processedCycleKeys(deps.db);
    if (options.force && options.only) {
      for (const policy of policies) processed.delete(makeCycleKey(policy.id, policy.expiryDate));
    }
    const { candidates, skipped } = selectRenewals({
      policies,
      today: options.today,
      minDays: deps.windowMinDays ?? 84,
      maxDays: deps.windowMaxDays ?? 112,
      processedCycleKeys: processed,
      clientNameById,
    });

    for (const skip of skipped) {
      const policy = policies.find((p) => p.id === skip.policyId) as Policy;
      const key = makeCycleKey(policy.id, policy.expiryDate);
      const outcome: RunOutcome = skip.reason === 'outside_window' ? 'skipped_outside_window' : 'skipped_already_processed';
      summary.rows.push({ policyId: skip.policyId, outcome, cycleKey: key, durationMs: 0, tokens: { inputTokens: 0, outputTokens: 0 } });
      ctx.audit?.recordAudit({
        type: skip.reason === 'outside_window' ? 'policy_skipped_outside_window' : 'policy_skipped_already_processed',
        runId: ctx.runId ?? undefined,
        policyId: skip.policyId,
        cycleKey: key,
        actor: 'system',
      });
    }

    const rows: RunRow[] = [];
    await pool(candidates, deps.maxConcurrency, async (policy) => {
      rows.push(dryRun ? await previewPolicy(ctx, policy) : await processPolicy(ctx, policy));
    });
    summary.rows.push(...rows);
  } catch (error) {
    if (!dryRun && ctx.audit && ctx.runId) {
      ctx.audit.recordAudit({ type: 'run_failed', runId: ctx.runId, actor: 'system', details: { error: (error instanceof Error ? error.message : String(error)).slice(0, 200) } });
      finishRun(deps.db as Db, deps.clock, ctx.runId, 'failed', summary);
    }
    throw error;
  }

  summary.rows.sort((a, b) => (a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0));
  for (const row of summary.rows) {
    summary.counts[row.outcome] += 1;
    summary.totalTokens.inputTokens += row.tokens.inputTokens;
    summary.totalTokens.outputTokens += row.tokens.outputTokens;
  }
  summary.totalDurationMs = deps.clock.now().getTime() - startedMs;

  if (!dryRun && ctx.audit && ctx.runId) {
    const db = deps.db as Db;
    // D-129: failures that could not be audited at the time (database locked) are written now;
    // if even that is impossible, one line goes to stderr so the event is never silently lost.
    for (const item of ctx.unrecorded) {
      try {
        ctx.audit.recordAudit({ type: 'policy_not_saved', runId: ctx.runId, policyId: item.policyId, cycleKey: item.cycleKey, actor: 'system', details: { reason: item.reason, error: item.error, recordedLate: true } });
      } catch (error) {
        (deps.stderr ?? defaultStderr)(`[autopilot] audit still impossible for ${item.policyId} (${item.cycleKey}): ${errorText(error)}; failure was: ${item.reason}`);
      }
    }
    ctx.audit.recordAudit({ type: 'run_finished', runId: ctx.runId, actor: 'system', details: { ...summary.counts } });
    finishRun(db, deps.clock, ctx.runId, 'finished', summary);
    if (deps.onPacksReady) {
      try {
        await deps.onPacksReady(ctx.newPacks, ctx.noticeCases);
      } catch (error) {
        ctx.audit.recordAudit({
          type: 'notification_failed',
          runId: ctx.runId,
          actor: 'system',
          details: { stage: 'onPacksReady', error: (error instanceof Error ? error.message : String(error)).slice(0, 200) },
        });
      }
    }
  }
  return summary;
}

function caseDepsFor(ctx: Context): ProcessCaseDeps {
  const { deps } = ctx;
  return {
    db: deps.db as Db,
    audit: ctx.audit as AuditLog,
    reader: deps.reader,
    clock: deps.clock,
    compareConfig: deps.compareConfig,
    outputDir: deps.outputDir,
    ...(deps.templatePath ? { templatePath: deps.templatePath } : {}),
    ...(deps.beforeCommit ? { beforeCommit: deps.beforeCommit } : {}),
    ...(deps.stderr ? { stderr: deps.stderr } : {}),
  };
}

function defaultStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function processPolicy(ctx: Context, policy: Policy): Promise<RunRow> {
  const { deps, options } = ctx;
  const caseDeps = caseDepsFor(ctx);
  const scope = { policy, origin: 'data_source' as const, runId: ctx.runId };
  let prepared: Awaited<ReturnType<typeof prepare>>;
  try {
    prepared = await prepare(deps, policy);
  } catch (error) {
    return collect(ctx, processCaseFailure(caseDeps, scope, error));
  }
  const result = await processCase(caseDeps, {
    ...scope,
    ...prepared,
    inputSource: 'data_source',
    today: options.today,
    forced: options.force === true && options.only === policy.id,
    // U-4: the nightly run never overrides a manual upload (unless --force --only <id>).
    respectUploadOverride: true,
  });
  return collect(ctx, result);
}

async function prepare(deps: PipelineDeps, policy: Policy) {
  const paths = await deps.dataSource.getDocumentPaths(policy.id);
  const client = await deps.dataSource.getClient(policy.clientId);
  const broker = await deps.dataSource.getBroker(policy.brokerId);
  return { paths, client, broker };
}

function collect(ctx: Context, result: ProcessCaseResult): RunRow {
  if (result.newPack) ctx.newPacks.push(result.newPack);
  if (result.notice) ctx.noticeCases.push(result.notice);
  if (result.unrecorded) ctx.unrecorded.push(result.unrecorded);
  return result.row;
}

/** Dry run: read-only database, cache-only reads, no writes of any kind. */
async function previewPolicy(ctx: Context, policy: Policy): Promise<RunRow> {
  const { deps } = ctx;
  const key = makeCycleKey(policy.id, policy.expiryDate);
  const zero = { inputTokens: 0, outputTokens: 0 };
  const existing = deps.db ? getCaseByCycleKey(deps.db, key) : undefined;
  const paths = await deps.dataSource.getDocumentPaths(policy.id);
  const inputHash = hashFor(deps.reader, deps.compareConfig, paths);
  const preview = (outcome: RunOutcome, note: string, extra: Partial<RunRow> = {}): RunRow => {
    deps.print?.(`[dry run] ${policy.id}: would be ${outcome} - ${note}`);
    return { policyId: policy.id, outcome, cycleKey: key, durationMs: 0, tokens: zero, note, ...extra };
  };
  if (existing && existing.inputHash === inputHash) return preview('unchanged_skip', `unchanged (${existing.status})`);
  if (!paths.expiring || !paths.renewal) return preview('needs_attention', `${paths.expiring ? 'renewal' : 'expiring'} document missing`);
  const nextVersion = (existing?.currentVersion ?? 0) + 1;
  const outcome: RunOutcome = nextVersion === 1 ? 'new_pack' : 'new_version';
  try {
    const expiring = await deps.reader.peek(paths.expiring, { policyId: policy.id, kind: 'expiring' });
    const renewal = await deps.reader.peek(paths.renewal, { policyId: policy.id, kind: 'renewal' });
    if (!expiring || !renewal) return preview(outcome, 'would extract (not cached)', { version: nextVersion });
    const comparison = compareTerms(expiring.terms, renewal.terms, deps.compareConfig);
    return preview(outcome, `overall risk ${comparison.overallRisk}`, { version: nextVersion, overallRisk: comparison.overallRisk, fromCache: true });
  } catch (error) {
    return preview('needs_attention', attentionReasonFor(error).reason);
  }
}
