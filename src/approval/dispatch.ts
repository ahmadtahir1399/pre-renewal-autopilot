// Sends cards after a run (onPacksReady), reminders (hourly from serve), and the fallback outbox.
// Never sends the same pack to the same channel twice (checked first; also a DB unique index).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveOverallRisk } from '../compare/compareTerms.js';
import type { DataSource } from '../data/datasource.js';
import type { InstantClock } from '../domain/dates.js';
import type { IsoDate } from '../domain/types.js';
import { POLICY_TYPE_LABELS } from '../outputs/labels.js';
import type { NewPackInfo, NoticeCaseInfo } from '../pipeline/runPipeline.js';
import { createAuditLog } from '../state/audit.js';
import { all, type Db, get, run } from '../state/db.js';
import { getCaseById, getPackById, type PackRow } from '../state/repo.js';
import { buildNoticeCard, buildPackCard, buildReminderText } from './cards.js';
import type { Notifier, PackCard } from './notifier.js';

export interface DispatchDeps {
  db: Db;
  clock: InstantClock;
  dataSource: DataSource;
  notifiers: readonly Notifier[];
  outputDir: string;
  today: () => IsoDate;
  reminderAfterHours: number;
  reminderIntervalHours: number;
  /** Retries after the first attempt (default 3) with exponential backoff. */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Dispatcher {
  onPacksReady(packs: NewPackInfo[], notices: NoticeCaseInfo[]): Promise<void>;
  sendDueReminders(now?: Date): Promise<number>;
  /** output/outbox/pending-approvals.md: what is waiting and the exact CLI commands. */
  writeOutbox(): Promise<string>;
}

const HOUR = 3_600_000;

export function createDispatcher(deps: DispatchDeps): Dispatcher {
  const { db, clock } = deps;
  const audit = createAuditLog(db, clock);
  const retries = deps.retries ?? 3;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < retries) await sleep(500 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  async function cardFor(pack: PackRow): Promise<PackCard | null> {
    const policy = await deps.dataSource.getPolicy(pack.pack.policyId);
    const client = policy ? await deps.dataSource.getClient(policy.clientId) : undefined;
    if (!policy || !client) return null;
    return buildPackCard({ packId: pack.id, caseId: pack.caseId, pack: pack.pack, policy, client, today: deps.today(), uploaded: pack.inputSource === 'upload' });
  }

  function recordNotification(input: { packId: number | null; caseId: number; channel: string; kind: 'pack' | 'reminder' | 'notice'; cause?: string; externalMessageId: string; sentAt?: Date }): void {
    const now = (input.sentAt ?? clock.now()).toISOString();
    run(
      db,
      'INSERT INTO notifications (pack_id, case_id, channel, kind, cause, external_message_id, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      input.packId,
      input.caseId,
      input.channel,
      input.kind,
      input.cause ?? null,
      input.externalMessageId,
      now,
      now,
    );
  }

  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

  async function writeOutbox(): Promise<string> {
    const rows = all(db, "SELECT p.id AS id FROM packs p JOIN cases c ON c.id = p.case_id WHERE p.status = 'active' AND c.status = 'in_review' ORDER BY c.policy_id");
    const lines = [
      '# Pending approvals (fallback)',
      '',
      'A notification channel could not be reached, so here is what is waiting. Nothing has been sent to any client or insurer.',
      'Approve or skip from a terminal in the project folder:',
      '',
    ];
    for (const row of rows) {
      const pack = getPackById(db, Number(row.id)) as PackRow;
      const policy = await deps.dataSource.getPolicy(pack.pack.policyId);
      const client = policy ? await deps.dataSource.getClient(policy.clientId) : undefined;
      lines.push(
        `## Pack ${pack.id}: ${client?.name ?? pack.pack.policyId} - ${policy ? POLICY_TYPE_LABELS[policy.type] : ''} (${pack.pack.policyId}, version ${pack.version})`,
        `- Overall risk: ${deriveOverallRisk(pack.pack.diffs, pack.pack.flags)}; items needing attention: ${pack.pack.flags.length}`,
        `- Spreadsheet: ${path.join(deps.outputDir, ...pack.paths.xlsx.split('/'))}`,
        `- Approve: \`npm run approve -- ${pack.id}\``,
        `- Skip: \`npm run skip -- ${pack.id}\``,
        '',
      );
    }
    if (rows.length === 0) lines.push('Nothing is waiting for a decision.', '');
    const file = path.join(deps.outputDir, 'outbox', 'pending-approvals.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, lines.join('\n'), 'utf8');
    return file;
  }

  async function onPacksReady(packs: NewPackInfo[], notices: NoticeCaseInfo[]): Promise<void> {
    let anyFailed = deps.notifiers.length === 0;
    for (const notifier of deps.notifiers) {
      for (const info of packs) {
        const already = get(db, "SELECT id FROM notifications WHERE pack_id = ? AND channel = ? AND kind = 'pack'", info.packId, notifier.channel);
        if (already) continue;
        const pack = getPackById(db, info.packId);
        const card = pack ? await cardFor(pack) : null;
        if (!pack || !card) continue;
        try {
          const sent = await withRetry(() => notifier.sendPack(card));
          recordNotification({ packId: pack.id, caseId: pack.caseId, channel: notifier.channel, kind: 'pack', externalMessageId: sent.externalMessageId });
          audit.recordAudit({ type: 'notification_sent', actor: 'system', policyId: info.policyId, cycleKey: info.cycleKey, details: { kind: 'pack', packId: pack.id, channel: notifier.channel } });
        } catch (error) {
          anyFailed = true;
          audit.recordAudit({ type: 'notification_failed', actor: 'system', policyId: info.policyId, cycleKey: info.cycleKey, details: { kind: 'pack', packId: info.packId, channel: notifier.channel, error: errorText(error) } });
        }
        if (info.supersededPackId !== null) {
          const old = get(db, "SELECT external_message_id FROM notifications WHERE pack_id = ? AND channel = ? AND kind = 'pack'", info.supersededPackId, notifier.channel);
          if (old?.external_message_id) {
            try {
              await withRetry(() => notifier.markResolved({ channel: notifier.channel, externalMessageId: String(old.external_message_id) }, `Replaced by version ${info.version}. Please use the new card.`));
            } catch (error) {
              audit.recordAudit({ type: 'notification_failed', actor: 'system', policyId: info.policyId, details: { kind: 'resolve', packId: info.supersededPackId, channel: notifier.channel, error: errorText(error) } });
            }
          }
        }
      }
      for (const notice of notices) {
        const already = get(db, "SELECT id FROM notifications WHERE case_id = ? AND channel = ? AND kind = 'notice' AND cause = ?", notice.caseId, notifier.channel, notice.reason);
        if (already) continue;
        const caseRow = getCaseById(db, notice.caseId);
        const policy = await deps.dataSource.getPolicy(notice.policyId);
        const client = policy ? await deps.dataSource.getClient(policy.clientId) : undefined;
        if (!caseRow || !policy || !client) continue;
        const card = buildNoticeCard({ caseId: notice.caseId, policy, client, reason: notice.reason });
        try {
          const sent = await withRetry(() => notifier.sendNotice(card));
          recordNotification({ packId: null, caseId: notice.caseId, channel: notifier.channel, kind: 'notice', cause: notice.reason, externalMessageId: sent.externalMessageId });
          audit.recordAudit({ type: 'notification_sent', actor: 'system', policyId: notice.policyId, cycleKey: notice.cycleKey, details: { kind: 'notice', channel: notifier.channel } });
        } catch (error) {
          anyFailed = true;
          audit.recordAudit({ type: 'notification_failed', actor: 'system', policyId: notice.policyId, cycleKey: notice.cycleKey, details: { kind: 'notice', channel: notifier.channel, error: errorText(error) } });
        }
      }
    }
    if (anyFailed) await writeOutbox();
  }

  async function sendDueReminders(now: Date = clock.now()): Promise<number> {
    let sent = 0;
    const rows = all(db, "SELECT p.id AS id FROM packs p JOIN cases c ON c.id = p.case_id WHERE p.status = 'active' AND c.status = 'in_review' ORDER BY p.id");
    for (const notifier of deps.notifiers) {
      for (const row of rows) {
        const pack = getPackById(db, Number(row.id)) as PackRow;
        const waitingMs = now.getTime() - new Date(pack.createdAt).getTime();
        if (waitingMs < deps.reminderAfterHours * HOUR) continue;
        const last = get(db, "SELECT sent_at FROM notifications WHERE pack_id = ? AND channel = ? AND kind = 'reminder' ORDER BY sent_at DESC LIMIT 1", pack.id, notifier.channel);
        if (last && now.getTime() - new Date(String(last.sent_at)).getTime() < deps.reminderIntervalHours * HOUR) continue;
        const card = await cardFor(pack);
        if (!card) continue;
        const reminder: PackCard = { ...card, text: buildReminderText(card, waitingMs / HOUR) };
        try {
          const result = await withRetry(() => notifier.sendReminder(reminder));
          recordNotification({ packId: pack.id, caseId: pack.caseId, channel: notifier.channel, kind: 'reminder', externalMessageId: result.externalMessageId, sentAt: now });
          audit.recordAudit({ type: 'reminder_sent', actor: 'system', policyId: pack.pack.policyId, cycleKey: pack.pack.cycleKey, details: { packId: pack.id, channel: notifier.channel, waitingHours: Math.floor(waitingMs / HOUR) } });
          sent++;
        } catch (error) {
          audit.recordAudit({ type: 'notification_failed', actor: 'system', policyId: pack.pack.policyId, details: { kind: 'reminder', packId: pack.id, channel: notifier.channel, error: errorText(error) } });
          await writeOutbox();
        }
      }
    }
    return sent;
  }

  return { onPacksReady, sendDueReminders, writeOutbox };
}
