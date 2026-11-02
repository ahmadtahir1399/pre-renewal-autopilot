// Command-line entry point. Thin: parses arguments, wires dependencies, prints results.
//   npm run autopilot -- <command> [options]     (or the per-command npm scripts)

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkWebPort, explainTelegramFailure } from '../approval/check.js';
import type { Dispatcher } from '../approval/dispatch.js';
import type { ActionResult } from '../approval/notifier.js';
import { shutdown } from '../approval/serve.js';
import { TelegramNotifier } from '../approval/telegram/telegramNotifier.js';
import { type Env, loadEnvOrExit, requireEnv } from '../config/env.js';
import { systemInstantClock } from '../domain/dates.js';
import { ConfigError } from '../domain/errors.js';
import { resetDemo } from '../pipeline/demo.js';
import { pause, resume } from '../pipeline/killSwitch.js';
import { FAKE_LLM_BANNER } from '../pipeline/readers.js';
import { formatAuditTimeline, formatRunSummary, formatStatus } from '../pipeline/report.js';
import { runPipeline } from '../pipeline/runPipeline.js';
import { DailyScheduler, realTimer } from '../pipeline/scheduler.js';
import { createAuditLog, listAllAudit } from '../state/audit.js';
import type { Db } from '../state/db.js';
import { readFileSync } from 'node:fs';
import { acquireLock, LockHeldError } from '../state/lockFile.js';
import { getActivePack, getPackById, listCases, type PackRow } from '../state/repo.js';
import { acquireRunGate, acquireRunGateWaiting } from '../state/runGate.js';
import { analyseUpload, type AnalyseUploadRequest, recoverInterruptedUploads } from '../uploads/analysisService.js';
import { listUploads } from '../uploads/repo.js';
import { deleteUploadFiles, purgeOldUploads } from '../uploads/retention.js';
import { createOverview, normaliseFilters, resolveExportPath } from '../outputs/overview.js';
import {
  analysisDepsFor,
  approvalCoreFor,
  channelsFor,
  dataSourceFor,
  dispatcherFor,
  listBrokersFor,
  manualAwareSourceFor,
  openDryRunDb,
  openWritableDb,
  readerFor,
  retentionDepsFor,
  runtimeDir,
  todayClock,
} from './context.js';

/** Plain terminal output (NOT the structured logger, audit or any file). */
const out = (line = '') => process.stdout.write(`${line}\n`);

interface Args {
  command: string;
  positional: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

/** Options that take a value (Prompt 7 adds the analyse options; every other --name is a plain flag). */
const VALUE_OPTIONS = new Set(['only', 'policy', 'client', 'broker', 'contact-name', 'contact-email', 'expiring', 'renewal', 'status']);

export function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg.startsWith('--') && VALUE_OPTIONS.has(arg.slice(2))) {
      values.set(arg.slice(2), rest[++i] ?? '');
    } else if (arg.startsWith('--')) {
      flags.add(arg.slice(2));
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags, values };
}

const HELP = `Pre-Renewal Autopilot (drafts only; nothing is ever sent)

Commands:
  run [--dry-run] [--fake-llm] [--only <policyId>] [--force]   one pipeline run now (sends cards to the channels)
  status                                                        cases and packs
  audit <policyId> | audit --attempts                           readable audit timeline / refused attempts
  pause | resume                                                kill switch (PAUSE file in DATA_DIR)
  reset-demo                                                    clear db, overlay, output (keeps .cache); seed pol-s12
  serve [--fake-llm] [--live-uploads]                           scheduler + approval page (+ Telegram if enabled) + reminders
  approve <packId> | skip <packId>                              decide from the terminal (works with no channel at all)
  retry-sync                                                    retry saving drafts / updating status after an approval
  check:approval                                                readiness check for each configured channel
  analyse <expiring.pdf> [<renewal.pdf>] (--policy <id> | --new --client <name> --broker <id>
          [--contact-name <n>] [--contact-email <e>]) --confirm-synthetic [--fake-llm]
          [--expiring <file>] [--renewal <file>]               analyse uploaded PDFs (synthetic documents only)
  uploads:list                                                  recent upload analyses
  uploads:delete <uploadId>                                     delete that upload's stored PDFs (audit kept)
  uploads:purge [--dry-run]                                     delete stored PDFs older than UPLOAD_RETENTION_DAYS
  overview [--status in_review,approved] [--no-manual]          create the overview spreadsheet; prints its path`;

interface RunOnceOptions {
  db: Db | null;
  dryRun: boolean;
  fakeLlm: boolean;
  only?: string;
  force: boolean;
  dispatcher: Dispatcher | null;
}

async function runOnce(env: Env, options: RunOnceOptions): Promise<number> {
  const summary = await runPipeline({
    today: todayClock(env).today(),
    dryRun: options.dryRun,
    ...(options.only ? { only: options.only } : {}),
    force: options.force,
    deps: {
      dataSource: dataSourceFor(env),
      db: options.db,
      reader: readerFor(env, { fakeLlm: options.fakeLlm, dryRun: options.dryRun }),
      clock: systemInstantClock,
      compareConfig: { premiumMediumPct: env.PREMIUM_MEDIUM_PCT, premiumHighPct: env.PREMIUM_HIGH_PCT },
      outputDir: env.OUTPUT_DIR,
      dataDir: env.DATA_DIR,
      maxConcurrency: env.MAX_CONCURRENCY,
      autopilotEnabled: env.AUTOPILOT_ENABLED,
      windowMinDays: env.WINDOW_MIN_DAYS,
      windowMaxDays: env.WINDOW_MAX_DAYS,
      print: out,
      ...(options.dispatcher ? { onPacksReady: options.dispatcher.onPacksReady } : {}),
    },
  });
  out(formatRunSummary(summary));
  return summary.blocked ? 2 : 0;
}

async function commandRun(env: Env, args: Args): Promise<number> {
  const dryRun = args.flags.has('dry-run');
  const fakeLlm = args.flags.has('fake-llm');
  const force = args.flags.has('force');
  const only = args.values.get('only') || undefined;
  if (force && !only) {
    out('--force needs --only <policyId> (forced reruns are one policy at a time).');
    return 1;
  }
  if (fakeLlm) out(FAKE_LLM_BANNER);
  if (dryRun) {
    const db = openDryRunDb(env);
    try {
      return await runOnce(env, { db, dryRun, fakeLlm, ...(only ? { only } : {}), force, dispatcher: null });
    } finally {
      db?.close();
    }
  }
  const db = openWritableDb(env);
  const lock = acquireRunGate(path.join(runtimeDir(env), 'run.lock'));
  try {
    const dispatcher = dispatcherFor(env, db, channelsFor(env, db, { serve: false }).notifiers);
    return await runOnce(env, { db, dryRun, fakeLlm, ...(only ? { only } : {}), force, dispatcher });
  } finally {
    lock.release();
    db.close();
  }
}

function commandStatus(env: Env): number {
  const db = openDryRunDb(env);
  if (!db) {
    out('No database yet. Run: npm run reset-demo');
    return 0;
  }
  try {
    const cases = listCases(db);
    const active = new Map<number, PackRow>();
    for (const c of cases) {
      const pack = getActivePack(db, c.id);
      if (pack) active.set(c.id, pack);
    }
    out(formatStatus(cases, active));
    return 0;
  } finally {
    db.close();
  }
}

function commandAudit(env: Env, args: Args): number {
  const policyId = args.positional[0];
  if (args.flags.has('attempts')) {
    const db = openDryRunDb(env);
    if (!db) {
      out('No database yet. Run: npm run reset-demo');
      return 0;
    }
    try {
      out(formatAuditTimeline('refused and unauthorised attempts', listAllAudit(db).filter((e) => e.type === 'unauthorised_attempt' || e.type === 'approval_ignored')));
      return 0;
    } finally {
      db.close();
    }
  }
  if (!policyId) {
    out('Usage: npm run audit -- <policyId>   or   npm run audit -- --attempts');
    return 1;
  }
  const db = openDryRunDb(env);
  if (!db) {
    out('No database yet. Run: npm run reset-demo');
    return 0;
  }
  try {
    out(formatAuditTimeline(policyId, createAuditLog(db, systemInstantClock).listAudit(policyId)));
    return 0;
  } finally {
    db.close();
  }
}

function commandResetDemo(env: Env): number {
  const result = resetDemo({ dbPath: env.DB_PATH, dataDir: env.DATA_DIR, outputDir: env.OUTPUT_DIR, fixturesDir: env.FIXTURES_DIR, clock: systemInstantClock });
  out(`Demo reset. Removed: ${result.removed.length ? result.removed.join(', ') : 'nothing'}`);
  out(`Migrations applied: ${result.migrations.join(', ') || 'none'}. Seeded approved cycles: ${result.seeded}.`);
  if (result.pausePresent) out('Note: a PAUSE file is present, so runs are blocked. Run: npm run resume');
  return 0;
}

function printResult(result: ActionResult): number {
  out(`${result.kind}: ${result.message}`);
  if (result.kind === 'ok' && result.xlsxPath) out(`Spreadsheet: ${result.xlsxPath}`);
  return result.kind === 'ok' ? 0 : 1;
}

async function commandDecide(env: Env, args: Args, action: 'approve' | 'skip'): Promise<number> {
  const packId = Number(args.positional[0]);
  if (!Number.isInteger(packId) || packId < 1) {
    out(`Usage: npm run ${action} -- <packId>   (see npm run status)`);
    return 1;
  }
  const db = openWritableDb(env);
  try {
    return printResult(await approvalCoreFor(env, db).handleAction({ action, packId, actor: 'broker:cli', channel: 'cli' }));
  } finally {
    db.close();
  }
}

async function commandRetrySync(env: Env): Promise<number> {
  const db = openWritableDb(env);
  try {
    const results = await approvalCoreFor(env, db).retrySync();
    if (results.length === 0) out('Nothing to retry: every approved pack is in sync.');
    for (const r of results) out(`pack ${r.packId} (${r.policyId}): ${r.ok ? 'OK' : `FAILED - ${r.error}`}`);
    return results.every((r) => r.ok) ? 0 : 1;
  } finally {
    db.close();
  }
}

async function commandCheckApproval(env: Env): Promise<number> {
  let allPass = true;
  if (env.APPROVAL_CHANNELS.includes('web')) {
    const web = await checkWebPort(env.APPROVAL_WEB_PORT);
    out(`web: ${web.pass ? 'PASS' : 'FAIL'} - ${web.reason}`);
    allPass &&= web.pass;
  }
  if (env.APPROVAL_CHANNELS.includes('telegram')) {
    let token = '';
    try {
      const checked = requireEnv(env, ['TELEGRAM_BOT_TOKEN']);
      token = checked.TELEGRAM_BOT_TOKEN;
      const username = await new TelegramNotifier({ token, allowedChatIds: checked.TELEGRAM_ALLOWED_CHAT_IDS }).checkConnection();
      const chats = checked.TELEGRAM_ALLOWED_CHAT_IDS.length;
      out(`telegram: ${chats > 0 ? 'PASS' : 'FAIL'} - token authenticates as @${username}; ${chats} allowed chat id(s)${chats === 0 ? ' (set TELEGRAM_ALLOWED_CHAT_IDS)' : ''}`);
      allPass &&= chats > 0;
    } catch (error) {
      out(`telegram: FAIL - ${error instanceof ConfigError ? error.problems.join('; ') : explainTelegramFailure(error, token)}`);
      allPass = false;
    }
    out('Note: Telegram needs THIS computer (the one running the automation) to reach api.telegram.org, not just your phone.');
  }
  return allPass ? 0 : 1;
}

async function commandServe(env: Env, args: Args): Promise<number> {
  const fakeLlm = args.flags.has('fake-llm');
  // D-123: --live-uploads = the demo data stays fake (answer keys) but uploads are read by the live AI.
  const liveUploads = args.flags.has('live-uploads');
  if (fakeLlm) out(FAKE_LLM_BANNER);
  if (env.PUBLIC_DEMO) out('PUBLIC DEMO: no sign-in; anyone who can reach the page can use everything.');
  const serveLock = acquireLock(path.join(runtimeDir(env), 'serve.lock'));
  const db = openWritableDb(env);
  const audit = createAuditLog(db, systemInstantClock);
  recoverUploadsAtStart(env, db);
  const core = approvalCoreFor(env, db);
  const channels = channelsFor(env, db, { serve: true, fakeLlm });
  const dispatcher = dispatcherFor(env, db, channels.notifiers);

  if (channels.webServer) {
    channels.webServer.enableExports({ db, clock: systemInstantClock, dataSource: manualAwareSourceFor(env, db), outputDir: env.OUTPUT_DIR });
    // Prompt 7: the upload pages use the same dispatcher, so an uploaded pack's card reaches every channel once.
    const setup = analysisDepsFor(env, db, { fakeLlm: fakeLlm && !liveUploads, onPacksReady: dispatcher.onPacksReady });
    if (liveUploads) out(setup.deps.reader ? `Uploads: read by the live AI (${setup.deps.reader.modelName}).` : 'Uploads: --live-uploads given but AI reading is not configured.');
    channels.webServer.enableUploads({ analysis: setup.deps, retention: retentionDepsFor(env, db), brokers: listBrokersFor(env), retentionDays: env.UPLOAD_RETENTION_DAYS });
    if (!fakeLlm && setup.missingAiConfig.length > 0) out(`Uploads: AI reading is not configured (set ${setup.missingAiConfig.join(', ')}); the upload page says so.`);
  }
  for (const notifier of channels.notifiers) await notifier.start(core.handleAction);
  if (channels.webServer) {
    out(`Approval page (this computer only): ${channels.webServer.launchUrl()}`);
    const publicUrl = channels.webServer.publicLaunchUrl();
    if (publicUrl) out(`Public sign-in link (via the HTTPS proxy; keep it private): ${publicUrl}`);
    out('Open that link once in your browser; it sets a session cookie and then shows a clean URL.');
  }
  if (channels.notifiers.length === 0) out('No approval channel is enabled; use npm run approve / skip (see output/outbox/pending-approvals.md).');

  const scheduler = new DailyScheduler({
    clock: systemInstantClock,
    timer: realTimer,
    runTime: env.RUN_TIME,
    timeZone: env.TIMEZONE,
    log: out,
    task: async () => {
      // An upload analysis in THIS process holds the gate: wait for it (at most its timeout + 30 s), then run.
      const lock = await acquireRunGateWaiting(path.join(runtimeDir(env), 'run.lock'), { maxWaitMs: env.ANALYSIS_TIMEOUT_SECONDS * 1000 + 30_000 });
      if (!lock) {
        audit.recordAudit({ type: 'run_skipped_overlap', actor: 'system', details: { reason: 'analysis_in_progress' } });
        out('Scheduled run skipped: an upload analysis was still running.');
        return;
      }
      try {
        await runOnce(env, { db, dryRun: false, fakeLlm, force: false, dispatcher });
      } finally {
        lock.release();
      }
    },
    onOverlapSkipped: (at) => audit.recordAudit({ type: 'run_skipped_overlap', actor: 'system', details: { scheduledFor: at.toISOString() } }),
    onError: (error) => out(`Scheduled run failed: ${error instanceof Error ? error.message : String(error)}`),
  });
  scheduler.start();

  // Hourly reminder check.
  let reminderHandle: unknown = null;
  const scheduleReminders = () => {
    reminderHandle = realTimer.setTimeout(() => {
      void dispatcher
        .sendDueReminders()
        .catch((error: unknown) => out(`Reminder check failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(scheduleReminders);
    }, 3_600_000);
  };
  scheduleReminders();
  out('serve is running. Press Ctrl+C to stop.');

  await new Promise<void>((resolve) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      out('Shutting down...');
      void shutdown({
        stopAccepting: core.stopAccepting,
        stopScheduler: () => scheduler.stop(),
        stopReminders: () => {
          if (reminderHandle !== null) realTimer.clearTimeout(reminderHandle);
        },
        stopNotifiers: async () => {
          for (const notifier of channels.notifiers) await notifier.stop();
        },
        releaseLocks: () => serveLock.release(),
        closeDb: () => db.close(),
        log: out,
      }).then(() => {
        out('Stopped cleanly.');
        resolve();
      });
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}

/** Startup recovery: jobs a stopped process left running are marked failed 'interrupted' (only while no run holds the gate). */
function recoverUploadsAtStart(env: Env, db: Db): void {
  let gate: { release(): void };
  try {
    gate = acquireRunGate(path.join(runtimeDir(env), 'run.lock'));
  } catch (error) {
    if (error instanceof LockHeldError) return; // another process is working; it owns its jobs
    throw error;
  }
  try {
    const recovered = recoverInterruptedUploads(db, systemInstantClock, { staleReceivedMs: 0 });
    if (recovered.length > 0) out(`Marked ${recovered.length} interrupted upload analysis job(s) as failed: ${recovered.join(', ')}`);
  } finally {
    gate.release();
  }
}

/** One positional file in attach mode = the side the data source is missing (pol-s07: the renewal). */
async function sidesForAnalyse(env: Env, args: Args, policyId: string | undefined): Promise<{ expiring?: string; renewal?: string } | string> {
  const sides: { expiring?: string; renewal?: string } = {};
  const flagged = { expiring: args.values.get('expiring'), renewal: args.values.get('renewal') };
  if (flagged.expiring || flagged.renewal) {
    if (args.positional.length > 0) return 'Use either positional files or --expiring/--renewal, not both.';
    if (flagged.expiring) sides.expiring = flagged.expiring;
    if (flagged.renewal) sides.renewal = flagged.renewal;
    return sides;
  }
  const [first, second, ...extra] = args.positional;
  if (extra.length > 0 || !first) return 'Give one or two PDF files (expiring first, then renewal).';
  if (second) return { expiring: first, renewal: second };
  if (!policyId) return 'A new policy needs both documents: <expiring.pdf> <renewal.pdf>.';
  const existing = await dataSourceFor(env).getDocumentPaths(policyId);
  if (existing.expiring && !existing.renewal) return { renewal: first };
  if (existing.renewal && !existing.expiring) return { expiring: first };
  return 'This policy has both or neither document in the data source; say which side with --expiring <file> or --renewal <file>.';
}

async function commandAnalyse(env: Env, args: Args): Promise<number> {
  const fakeLlm = args.flags.has('fake-llm');
  if (fakeLlm) out(FAKE_LLM_BANNER);
  const isNew = args.flags.has('new');
  const policyId = args.values.get('policy');
  if (isNew === Boolean(policyId)) {
    out('Choose exactly one: --policy <id> (add documents to an existing policy) or --new --client <name> --broker <id>.');
    return 1;
  }
  const sides = await sidesForAnalyse(env, args, isNew ? undefined : policyId);
  if (typeof sides === 'string') {
    out(sides);
    return 1;
  }
  const files: AnalyseUploadRequest['files'] = {};
  for (const side of ['expiring', 'renewal'] as const) {
    const file = sides[side];
    if (!file) continue;
    try {
      files[side] = { bytes: new Uint8Array(readFileSync(file)), clientFilename: path.basename(file) };
    } catch {
      out(`Cannot read the ${side} file.`);
      return 1;
    }
  }
  const db = openWritableDb(env);
  try {
    const dispatcher = dispatcherFor(env, db, channelsFor(env, db, { serve: false }).notifiers);
    const setup = analysisDepsFor(env, db, { fakeLlm, onPacksReady: dispatcher.onPacksReady });
    if (!fakeLlm && setup.missingAiConfig.length > 0) {
      out(`AI reading is not configured: set ${setup.missingAiConfig.join(', ')} in .env (or use --fake-llm with the sample documents).`);
    }
    const contactName = args.values.get('contact-name');
    const contactEmail = args.values.get('contact-email');
    const request: AnalyseUploadRequest = {
      mode: isNew ? 'new' : 'attach',
      ...(policyId ? { policyId } : {}),
      ...(isNew
        ? {
            newPolicy: {
              clientName: args.values.get('client') ?? '',
              brokerId: args.values.get('broker') ?? '',
              ...(contactName ? { contactName } : {}),
              ...(contactEmail ? { contactEmail } : {}),
            },
          }
        : {}),
      files,
      consent: args.flags.has('confirm-synthetic'),
      actor: 'broker:cli',
    };
    const result = await analyseUpload(request, setup.deps);
    const job = result.job;
    out(`Upload ${job.id}: ${job.status}${job.failureCode ? ` (${job.failureCode})` : ''}`);
    out(result.message);
    if (job.packId) {
      const pack = getPackById(db, job.packId);
      out(`Pack ${job.packId} for ${pack?.pack.policyId ?? '?'} (version ${pack?.version ?? '?'}). Approve with: npm run approve -- ${job.packId}`);
    }
    out(`Tokens used: ${job.tokensIn} in / ${job.tokensOut} out`);
    return job.status === 'done' ? 0 : 1;
  } finally {
    db.close();
  }
}

function commandUploadsList(env: Env): number {
  const db = openDryRunDb(env);
  if (!db) {
    out('No database yet. Run: npm run reset-demo');
    return 0;
  }
  try {
    const jobs = listUploads(db, 50);
    if (jobs.length === 0) {
      out('No upload analyses yet.');
      return 0;
    }
    out('Id    Created (UTC)             Mode    Policy             Status     Code                   Pack  Tokens in/out');
    for (const j of jobs) {
      out(
        `${String(j.id).padEnd(5)} ${j.createdAt.padEnd(25)} ${j.mode.padEnd(7)} ${(j.policyId ?? '-').padEnd(18)} ${j.status.padEnd(10)} ${(j.failureCode ?? '-').padEnd(22)} ${String(j.packId ?? '-').padEnd(5)} ${j.tokensIn}/${j.tokensOut}`,
      );
    }
    return 0;
  } finally {
    db.close();
  }
}

function commandUploadsDelete(env: Env, args: Args): number {
  const uploadId = Number(args.positional[0]);
  if (!Number.isInteger(uploadId) || uploadId < 1) {
    out('Usage: npm run uploads:delete -- <uploadId>   (see npm run uploads:list)');
    return 1;
  }
  const db = openWritableDb(env);
  try {
    const result = deleteUploadFiles(retentionDepsFor(env, db), uploadId, 'broker:cli');
    if (!result.found) {
      out(`No upload ${uploadId}.`);
      return 1;
    }
    const entries = result.cacheEntriesRemoved === 1 ? 'entry' : 'entries';
    out(`Upload ${uploadId}: deleted ${result.files} stored PDF(s) and ${result.cacheEntriesRemoved} extraction-cache ${entries}. The audit trail and the pack stay.`);
    return 0;
  } finally {
    db.close();
  }
}

function commandUploadsPurge(env: Env, args: Args): number {
  const dryRun = args.flags.has('dry-run');
  const db = dryRun ? openDryRunDb(env) : openWritableDb(env);
  if (!db) {
    out('No database yet. Nothing to purge.');
    return 0;
  }
  try {
    const result = purgeOldUploads(retentionDepsFor(env, db), env.UPLOAD_RETENTION_DAYS, { dryRun, actor: 'broker:cli' });
    const which = result.uploadIds.length ? ` (uploads ${result.uploadIds.join(', ')})` : '';
    const entries = result.cacheEntriesRemoved === 1 ? 'entry' : 'entries';
    out(
      dryRun
        ? `[dry run] Would delete ${result.files} stored PDF(s) created before ${result.cutoff}${which}. Nothing was changed.`
        : `Deleted ${result.files} stored PDF(s) created before ${result.cutoff}${which}; ${result.cacheEntriesRemoved} cache ${entries} removed.`,
    );
    return 0;
  } finally {
    db.close();
  }
}

async function commandOverview(env: Env, args: Args): Promise<number> {
  const statuses = (args.values.get('status') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const filters = normaliseFilters({ statuses, includeManual: !args.flags.has('no-manual') });
  const db = openWritableDb(env);
  try {
    const result = await createOverview(
      { filters, runDate: todayClock(env).today(), actor: 'broker:cli' },
      { db, clock: systemInstantClock, dataSource: manualAwareSourceFor(env, db), outputDir: env.OUTPUT_DIR },
    );
    if (result.kind === 'empty') {
      out(`No cases match (statuses: ${filters.statuses.join(', ')}${filters.includeManual ? '' : ', manual cases left out'}). No spreadsheet was created.`);
      return 1;
    }
    out(`${result.kind === 'created' ? 'Created' : 'Unchanged, same content as export'} ${result.record.id}: ${result.record.rowCount} renewal(s).`);
    out(resolveExportPath(env.OUTPUT_DIR, result.record.relativePath));
    return 0;
  } finally {
    db.close();
  }
}

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.command === 'help' || args.flags.has('help')) {
    out(HELP);
    return 0;
  }
  const env = loadEnvOrExit();
  try {
    switch (args.command) {
      case 'run':
        return await commandRun(env, args);
      case 'status':
        return commandStatus(env);
      case 'audit':
        return commandAudit(env, args);
      case 'pause':
        out(`Paused. Created ${pause(env.DATA_DIR)}`);
        return 0;
      case 'resume':
        out(resume(env.DATA_DIR) ? 'Resumed (PAUSE file removed).' : 'Not paused.');
        return 0;
      case 'reset-demo':
        return commandResetDemo(env);
      case 'serve':
        return await commandServe(env, args);
      case 'approve':
        return await commandDecide(env, args, 'approve');
      case 'skip':
        return await commandDecide(env, args, 'skip');
      case 'retry-sync':
        return await commandRetrySync(env);
      case 'check:approval':
        return await commandCheckApproval(env);
      case 'analyse':
        return await commandAnalyse(env, args);
      case 'uploads:list':
        return commandUploadsList(env);
      case 'uploads:delete':
        return commandUploadsDelete(env, args);
      case 'uploads:purge':
        return commandUploadsPurge(env, args);
      case 'overview':
        return await commandOverview(env, args);
      default:
        out(`Unknown command "${args.command}".\n\n${HELP}`);
        return 1;
    }
  } catch (error) {
    if (error instanceof LockHeldError) {
      out(error.message);
      return 3;
    }
    if (error instanceof ConfigError) {
      out(error.message);
      return 1;
    }
    throw error;
  }
}

const isEntryPoint = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
