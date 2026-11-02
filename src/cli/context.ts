// Wiring shared by CLI commands. Each builder asks only for the config it needs.

import path from 'node:path';
import { type Env, requireEnv } from '../config/env.js';
import { LocalJsonSource } from '../data/localJsonSource.js';
import { type Clock, fixedClock, systemClock } from '../domain/dates.js';
import { JsonFileExtractionCache } from '../documents/cache.js';
import { createLlmClient } from '../llm/client.js';
import { createCacheOnlyReader, createGroundTruthReader, createLlmReader, type TermsReader } from '../pipeline/readers.js';
import { type Db, migrate, openDatabase, openDatabaseReadOnly } from '../state/db.js';
import { systemInstantClock } from '../domain/dates.js';
import { ConfigError } from '../domain/errors.js';
import { createApprovalCore, type ApprovalCore } from '../approval/actions.js';
import { createDispatcher, type Dispatcher } from '../approval/dispatch.js';
import type { Notifier } from '../approval/notifier.js';
import { TelegramNotifier } from '../approval/telegram/telegramNotifier.js';
import { generateToken, WebApprovalServer } from '../approval/web/server.js';
import { WebNotifier } from '../approval/web/webNotifier.js';
import { createAuditLog } from '../state/audit.js';
import type { DataSource } from '../data/datasource.js';
import type { NewPackInfo, NoticeCaseInfo } from '../pipeline/processCase.js';
import type { AnalysisDeps } from '../uploads/analysisService.js';
import { limitsFromEnv } from '../uploads/intake.js';
import { createKnownDocumentReader, loadKnownDocuments, sha256OfFile } from '../uploads/knownDocuments.js';
import { ManualAwareSource } from '../uploads/manualSource.js';
import type { RetentionDeps } from '../uploads/retention.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { parseBrokers } from '../domain/schemas.js';

export function todayClock(env: Env): Clock {
  return env.REFERENCE_DATE ? fixedClock(env.REFERENCE_DATE) : systemClock(env.TIMEZONE);
}

export function dataSourceFor(env: Env): LocalJsonSource {
  return new LocalJsonSource({ fixturesDir: env.FIXTURES_DIR, dataDir: env.DATA_DIR });
}

export function runtimeDir(env: Env): string {
  return path.join(env.DATA_DIR, 'runtime');
}

/** The data source plus manual (uploaded) records, for everything that SHOWS or APPROVES cases (Prompt 7).
 * The nightly pipeline keeps the plain data source (listPolicies is the same either way). */
export function manualAwareSourceFor(env: Env, db: Db): ManualAwareSource {
  return new ManualAwareSource(dataSourceFor(env), db);
}

/** Committed synthetic sample uploads (Prompt 7); fake mode knows these documents. */
export const SAMPLES_DIR = path.join('samples', 'uploads');
export const EXTRACTION_CACHE_DIR = path.join('.cache', 'extractions');

/** Writable database with migrations applied. */
export function openWritableDb(env: Env): Db {
  const db = openDatabase(env.DB_PATH);
  migrate(db, systemInstantClock);
  return db;
}

/** Read-only database for dry runs (null if none exists yet; nothing is created). */
export function openDryRunDb(env: Env): Db | null {
  return openDatabaseReadOnly(env.DB_PATH);
}

/** Pick the terms reader. Only the real, non-dry path needs LLM credentials. */
export function readerFor(env: Env, options: { fakeLlm: boolean; dryRun: boolean }): TermsReader {
  if (options.fakeLlm) return createGroundTruthReader(env.FIXTURES_DIR);
  const cache = new JsonFileExtractionCache();
  if (options.dryRun) return createCacheOnlyReader(requireEnv(env, ['LLM_MODEL']).LLM_MODEL, cache);
  return createLlmReader(createLlmClient(env), cache, { repair: env.EXTRACT_REPAIR_PASS });
}

// ---- Stage 8: approval wiring --------------------------------------------------------------

export function approvalCoreFor(env: Env, db: Db): ApprovalCore {
  return createApprovalCore({
    db,
    clock: systemInstantClock,
    dataSource: manualAwareSourceFor(env, db),
    outputDir: env.OUTPUT_DIR,
    allowedTelegramChatIds: env.TELEGRAM_ALLOWED_CHAT_IDS,
  });
}

export interface ChannelSetup {
  notifiers: Notifier[];
  webServer: WebApprovalServer | null;
  telegram: TelegramNotifier | null;
}

/**
 * Notifiers for the configured APPROVAL_CHANNELS. With serve=true the web page is actually served;
 * for a one-off run the web channel only records cards (the page shows them when serve runs).
 * TELEGRAM_* is required ONLY when 'telegram' is configured.
 */
export function channelsFor(env: Env, db: Db, options: { serve: boolean; fakeLlm?: boolean }): ChannelSetup {
  const setup: ChannelSetup = { notifiers: [], webServer: null, telegram: null };
  if (env.APPROVAL_CHANNELS.includes('web')) {
    if (options.serve) {
      setup.webServer = new WebApprovalServer({
        db,
        clock: systemInstantClock,
        dataSource: manualAwareSourceFor(env, db),
        port: env.APPROVAL_WEB_PORT,
        token: env.APPROVAL_WEB_TOKEN ?? generateToken(),
        approverName: env.APPROVER_NAME,
        today: () => todayClock(env).today(),
        fakeLlm: options.fakeLlm === true,
        ...(env.APPROVAL_PUBLIC_ORIGIN ? { publicOrigin: env.APPROVAL_PUBLIC_ORIGIN } : {}),
        ...(env.PUBLIC_DEMO ? { publicDemo: true } : {}),
      });
    }
    setup.notifiers.push(new WebNotifier(setup.webServer));
  }
  if (env.APPROVAL_CHANNELS.includes('telegram')) {
    const checked = requireEnv(env, ['TELEGRAM_BOT_TOKEN']);
    if (checked.TELEGRAM_ALLOWED_CHAT_IDS.length === 0) {
      throw new ConfigError(['TELEGRAM_ALLOWED_CHAT_IDS: is required when APPROVAL_CHANNELS includes telegram (your numeric chat id)']);
    }
    setup.telegram = new TelegramNotifier({
      token: checked.TELEGRAM_BOT_TOKEN,
      allowedChatIds: checked.TELEGRAM_ALLOWED_CHAT_IDS,
      audit: createAuditLog(db, systemInstantClock),
    });
    setup.notifiers.push(setup.telegram);
  }
  return setup;
}

export function dispatcherFor(env: Env, db: Db, notifiers: Notifier[]): Dispatcher {
  return createDispatcher({
    db,
    clock: systemInstantClock,
    dataSource: manualAwareSourceFor(env, db),
    notifiers,
    outputDir: env.OUTPUT_DIR,
    today: () => todayClock(env).today(),
    reminderAfterHours: env.REMINDER_AFTER_HOURS,
    reminderIntervalHours: env.REMINDER_INTERVAL_HOURS,
  });
}

// ---- Prompt 7: upload analysis wiring -------------------------------------------------------

export interface AnalysisSetup {
  deps: AnalysisDeps;
  /** Names (never values) of the variables live analysis is missing; empty when configured or in fake mode. */
  missingAiConfig: string[];
}

/**
 * Live mode: the same LLM reader + extraction cache as the nightly run; reader null when LLM_* is not set
 * (the service then says 'AI reading is not configured'). Fake mode: ONLY the known-document registry.
 */
export function analysisDepsFor(
  env: Env,
  db: Db,
  options: { fakeLlm: boolean; onPacksReady?: (packs: NewPackInfo[], notices: NoticeCaseInfo[]) => Promise<void> },
): AnalysisSetup {
  let reader: TermsReader | null = null;
  let missingAiConfig: string[] = [];
  let knownDocuments: AnalysisDeps['knownDocuments'];
  if (options.fakeLlm) {
    knownDocuments = loadKnownDocuments({ fixturesDir: env.FIXTURES_DIR, samplesDir: SAMPLES_DIR });
    reader = createKnownDocumentReader(knownDocuments);
  } else {
    try {
      reader = createLlmReader(createLlmClient(env), new JsonFileExtractionCache(EXTRACTION_CACHE_DIR), { repair: env.EXTRACT_REPAIR_PASS });
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      missingAiConfig = error.problems.map((problem) => problem.split(':')[0] ?? 'LLM settings');
    }
  }
  const deps: AnalysisDeps = {
    db,
    clock: systemInstantClock,
    dataSource: dataSourceFor(env) as DataSource,
    reader,
    ...(knownDocuments ? { knownDocuments } : {}),
    compareConfig: { premiumMediumPct: env.PREMIUM_MEDIUM_PCT, premiumHighPct: env.PREMIUM_HIGH_PCT },
    outputDir: env.OUTPUT_DIR,
    runtimeDir: runtimeDir(env),
    lockPath: path.join(runtimeDir(env), 'run.lock'),
    timeZone: env.TIMEZONE,
    today: () => todayClock(env).today(),
    limits: limitsFromEnv(env),
    dailyLimit: env.UPLOAD_DAILY_LIMIT,
    timeoutMs: env.ANALYSIS_TIMEOUT_SECONDS * 1000,
    ...(options.onPacksReady ? { onPacksReady: options.onPacksReady } : {}),
  };
  return { deps, missingAiConfig };
}

/** sha256 of every data-source document (their extraction-cache entries are never deleted with an upload). */
export function dataSourceDocumentHashes(env: Env): Set<string> {
  const hashes = new Set<string>();
  const root = path.join(env.FIXTURES_DIR, 'documents');
  if (!existsSync(root)) return hashes;
  for (const policyDir of readdirSync(root)) {
    for (const kind of ['expiring', 'renewal']) {
      const file = path.join(root, policyDir, `${kind}.pdf`);
      if (existsSync(file)) hashes.add(sha256OfFile(file));
    }
  }
  return hashes;
}

export function retentionDepsFor(env: Env, db: Db): RetentionDeps {
  return { db, clock: systemInstantClock, runtimeDir: runtimeDir(env), cacheDir: EXTRACTION_CACHE_DIR, protectedHashes: dataSourceDocumentHashes(env) };
}

/** Brokers for the upload form's select (read-only read of the data source's brokers file). */
export function listBrokersFor(env: Env): Array<{ id: string; name: string }> {
  const brokers = parseBrokers(JSON.parse(readFileSync(path.join(env.FIXTURES_DIR, 'data', 'brokers.json'), 'utf8')), 'brokers.json');
  return brokers.map((b) => ({ id: b.id, name: b.name }));
}
