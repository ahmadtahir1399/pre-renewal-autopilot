import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../src/approval/actions.js';
import { attentionLine, buildPackCard, weeksUntil } from '../src/approval/cards.js';
import { createDispatcher } from '../src/approval/dispatch.js';
import { FakeNotifier } from '../src/approval/notifier.js';
import { SHUTDOWN_ORDER, shutdown } from '../src/approval/serve.js';
import { decodeCallback, encodeCallback } from '../src/approval/telegram/telegramNotifier.js';
import { explainTelegramFailure } from '../src/approval/check.js';
import { createGroundTruthReader } from '../src/pipeline/readers.js';
import { runPipeline } from '../src/pipeline/runPipeline.js';
import { createAuditLog, listAllAudit } from '../src/state/audit.js';
import { all } from '../src/state/db.js';
import { getCaseByCycleKey, getPackById } from '../src/state/repo.js';
import { createDemo, type Demo, FIXTURES, failingWrites, TODAY, withModel } from './helpers.js';

let demo: Demo;
beforeEach(async () => {
  demo = await createDemo();
});
afterEach(() => demo.cleanup());

function core(overrides: Partial<Parameters<typeof createApprovalCore>[0]> = {}) {
  return createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, outputDir: demo.outputDir, allowedTelegramChatIds: ['424242'], ...overrides });
}

const approvedDir = (rel: string) => path.join(demo.outputDir, 'approved', ...rel.split('/'));
const overlay = () => (existsSync(demo.overlayPath) ? JSON.parse(readFileSync(demo.overlayPath, 'utf8')).statuses : {});

describe('handleAction (shared core)', () => {
  it('approve end to end: state, approvals row, files ONLY after approve, overlay updated', async () => {
    const pack = demo.packFor('pol-s02');
    expect(existsSync(approvedDir(pack.paths.xlsx))).toBe(false); // nothing copied before the tap
    expect(overlay()).toEqual({});
    const result = await core().handleAction({ action: 'approve', packId: pack.id, actor: 'broker:web', channel: 'web' });
    expect(result.kind).toBe('ok');
    expect(getCaseByCycleKey(demo.db, 'pol-s02:2027-01-25')?.status).toBe('approved');
    expect(all(demo.db, 'SELECT action, actor, channel FROM approvals')).toEqual([{ action: 'approve', actor: 'broker:web', channel: 'web' }]);
    for (const rel of [pack.paths.xlsx, pack.paths.clientEml, pack.paths.insurerEml]) expect(existsSync(approvedDir(rel))).toBe(true);
    expect(overlay()).toEqual({ 'pol-s02': 'approved' });
    expect(getPackById(demo.db, pack.id)?.syncState).toBe('ok');
    expect(createAuditLog(demo.db, demo.clock).listAudit('pol-s02').map((e) => e.type)).toEqual(expect.arrayContaining(['approved', 'status_changed']));
  });

  it('skip: in_review -> skipped, no files, data source NOT written', async () => {
    const pack = demo.packFor('pol-s05');
    const result = await core().handleAction({ action: 'skip', packId: pack.id, actor: 'broker:cli', channel: 'cli' });
    expect(result.kind).toBe('ok');
    expect(getCaseByCycleKey(demo.db, 'pol-s05:2027-01-18')?.status).toBe('skipped');
    expect(existsSync(approvedDir(pack.paths.xlsx))).toBe(false);
    expect(overlay()).toEqual({});
  });

  it('open changes no state and returns the DB path inside OUTPUT_DIR', async () => {
    const pack = demo.packFor('pol-s15');
    const before = all(demo.db, 'SELECT status FROM cases ORDER BY id');
    const result = await core().handleAction({ action: 'open', packId: pack.id, actor: 'broker:web', channel: 'web' });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.xlsxPath).toBe(path.join(demo.outputDir, ...pack.paths.xlsx.split('/')));
    expect(result.flagged).toEqual(['[HIGH] Annual premium']);
    expect(all(demo.db, 'SELECT status FROM cases ORDER BY id')).toEqual(before);
    expect(all(demo.db, 'SELECT * FROM approvals')).toEqual([]);
  });

  it('a second approve returns already_done and changes nothing', async () => {
    const pack = demo.packFor('pol-s01');
    const approval = core();
    await approval.handleAction({ action: 'approve', packId: pack.id, actor: 'broker:web', channel: 'web' });
    const again = await approval.handleAction({ action: 'approve', packId: pack.id, actor: 'broker:web', channel: 'web' });
    expect(again.kind).toBe('already_done');
    const events = createAuditLog(demo.db, demo.clock).listAudit('pol-s01');
    expect(events.filter((e) => e.type === 'approved')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'approval_ignored')).toHaveLength(1);
    expect(all(demo.db, 'SELECT * FROM approvals')).toHaveLength(1);
  });

  it('a superseded pack says "replaced by version N" and does nothing', async () => {
    const old = demo.packFor('pol-s03');
    await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ reader: withModel(createGroundTruthReader(FIXTURES), 'model-2') }) });
    const result = await core().handleAction({ action: 'approve', packId: old.id, actor: 'broker:web', channel: 'web' });
    expect(result).toMatchObject({ kind: 'superseded', currentVersion: 2, message: 'This pack was replaced by version 2.' });
    expect(getCaseByCycleKey(demo.db, 'pol-s03:2027-01-12')?.status).toBe('in_review');
  });

  it('wrong_state when the case is not in_review (approve after skip)', async () => {
    const pack = demo.packFor('pol-s06');
    const approval = core();
    await approval.handleAction({ action: 'skip', packId: pack.id, actor: 'broker:cli', channel: 'cli' });
    const result = await approval.handleAction({ action: 'approve', packId: pack.id, actor: 'broker:cli', channel: 'cli' });
    expect(result).toMatchObject({ kind: 'wrong_state', status: 'skipped' });
  });

  it('unauthorised actors are refused and audited; unknown packs are not_found', async () => {
    const pack = demo.packFor('pol-s01');
    const approval = core();
    const stranger = await approval.handleAction({ action: 'approve', packId: pack.id, actor: 'broker:telegram:999', channel: 'telegram' });
    expect(stranger.kind).toBe('not_allowed');
    expect(listAllAudit(demo.db).some((e) => e.type === 'unauthorised_attempt')).toBe(true);
    const allowed = await approval.handleAction({ action: 'open', packId: pack.id, actor: 'broker:telegram:424242', channel: 'telegram' });
    expect(allowed.kind).toBe('ok');
    expect((await approval.handleAction({ action: 'approve', packId: 99999, actor: 'broker:cli', channel: 'cli' })).kind).toBe('not_found');
    expect(getCaseByCycleKey(demo.db, 'pol-s01:2027-01-17')?.status).toBe('in_review');
  });

  it('a data-source failure after approval keeps the pack approved; retry-sync fixes it', async () => {
    const pack = demo.packFor('pol-s11');
    const source = failingWrites(demo.dataSource);
    const approval = core({ dataSource: source });
    const result = await approval.handleAction({ action: 'approve', packId: pack.id, actor: 'broker:web', channel: 'web' });
    expect(result.kind).toBe('ok');
    expect(getCaseByCycleKey(demo.db, 'pol-s11:2027-02-08')?.status).toBe('approved');
    expect(getPackById(demo.db, pack.id)?.syncState).toBe('status_sync_failed');
    expect(overlay()).toEqual({});
    source.fail = false;
    expect(await approval.retrySync()).toEqual([{ packId: pack.id, policyId: 'pol-s11', ok: true }]);
    expect(getPackById(demo.db, pack.id)?.syncState).toBe('ok');
    expect(overlay()).toEqual({ 'pol-s11': 'approved' });
    expect(listAllAudit(demo.db).map((e) => e.type)).toEqual(expect.arrayContaining(['status_sync_failed', 'status_sync_retried']));
  });

  it('a copy failure is handled: approved, copy_failed, retry-sync copies the files', async () => {
    const pack = demo.packFor('pol-s13');
    const result = await core({
      copyFile: () => {
        throw new Error('disk full');
      },
    }).handleAction({ action: 'approve', packId: pack.id, actor: 'broker:web', channel: 'web' });
    expect(result.kind).toBe('ok');
    expect(getPackById(demo.db, pack.id)?.syncState).toBe('copy_failed');
    expect(overlay()).toEqual({ 'pol-s13': 'approved' }); // the status update still happened
    await core().retrySync();
    expect(existsSync(approvedDir(pack.paths.clientEml))).toBe(true);
    expect(getPackById(demo.db, pack.id)?.syncState).toBe('ok');
  });

  it('refuses everything after stopAccepting (shutdown)', async () => {
    const approval = core();
    approval.stopAccepting();
    const result = await approval.handleAction({ action: 'approve', packId: demo.packFor('pol-s01').id, actor: 'broker:cli', channel: 'cli' });
    expect(result.kind).toBe('not_allowed');
  });
});

describe('cards', () => {
  it('builds a deterministic, phone-sized card from stored data', async () => {
    const pack = demo.packFor('pol-s15');
    const policy = await demo.dataSource.getPolicy('pol-s15');
    const client = await demo.dataSource.getClient(policy?.clientId ?? '');
    if (!policy || !client) throw new Error('fixture missing');
    const card = buildPackCard({ packId: pack.id, caseId: pack.caseId, pack: pack.pack, policy, client, today: TODAY });
    expect(card.text.split('\n')).toEqual([
      'Quarry Lane Print Works Ltd - Commercial Property',
      'Renews in 15 weeks (2027-02-06)',
      'Overall risk: HIGH',
      '[HIGH] Annual premium increases from 21,000 to 26,670 (+5,670, +27.0 percent).',
      '[INFO] Cover limit increases from 8,000,000 to 9,500,000 (+1,500,000, +18.8 percent).',
      '[INFO] Exclusion no longer in the renewal: Vacant or unoccupied buildings (expiring page 4).',
      '1 item needs your eye',
      'Draft only: nothing has been sent.',
    ]);
  });

  it('rounds weeks down and phrases the attention line', () => {
    expect(weeksUntil(TODAY, '2027-01-11')).toBe(12); // 84 days
    expect(weeksUntil(TODAY, '2027-01-17')).toBe(12); // 90 days
    expect(weeksUntil(TODAY, '2027-02-08')).toBe(16); // 112 days
    expect(weeksUntil(TODAY, '2027-02-07')).toBe(15); // 111 days
    expect(attentionLine(0)).toBe('Nothing needs your eye');
    expect(attentionLine(1)).toBe('1 item needs your eye');
    expect(attentionLine(2)).toBe('2 items need your eye');
  });
});

describe('dispatch, reminders and fallback', () => {
  function dispatcher(notifiers: FakeNotifier[], extra: Partial<Parameters<typeof createDispatcher>[0]> = {}) {
    return createDispatcher({
      db: demo.db,
      clock: demo.clock,
      dataSource: demo.dataSource,
      notifiers,
      outputDir: demo.outputDir,
      today: () => TODAY,
      reminderAfterHours: 48,
      reminderIntervalHours: 24,
      sleep: async () => {},
      ...extra,
    });
  }

  async function freshRunWith(notifiers: FakeNotifier[]) {
    demo.cleanup();
    demo = await createDemo({ runPipeline: false });
    const d = dispatcher(notifiers);
    await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ onPacksReady: d.onPacksReady }) });
    return d;
  }

  it('sends one card per pack and one notice per needs_attention case; never twice', async () => {
    const web = new FakeNotifier('web');
    const d = await freshRunWith([web]);
    expect(web.records.filter((r) => r.kind === 'pack')).toHaveLength(11);
    expect(web.records.filter((r) => r.kind === 'notice')).toHaveLength(2);
    // Same packs again (a second hook call): nothing new is sent.
    const packs = all(demo.db, "SELECT p.id AS id, p.case_id AS caseId, c.policy_id AS policyId, c.cycle_key AS cycleKey, p.version AS version FROM packs p JOIN cases c ON c.id = p.case_id");
    await d.onPacksReady(packs.map((p) => ({ packId: Number(p.id), caseId: Number(p.caseId), policyId: String(p.policyId), cycleKey: String(p.cycleKey), version: Number(p.version), supersededPackId: null })), []);
    expect(web.records.filter((r) => r.kind === 'pack')).toHaveLength(11);
    expect(all(demo.db, "SELECT COUNT(*) AS n FROM notifications WHERE kind = 'pack'")[0]?.n).toBe(11);
    const notice = web.records.find((r) => r.kind === 'notice');
    expect(notice?.text).toContain('needs attention');
  });

  it('a new version resolves the old card and sends the new one', async () => {
    const web = new FakeNotifier('web');
    const d = await freshRunWith([web]);
    await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ reader: withModel(createGroundTruthReader(FIXTURES), 'model-2'), onPacksReady: d.onPacksReady }) });
    expect(web.records.filter((r) => r.kind === 'pack')).toHaveLength(22);
    const resolved = web.records.filter((r) => r.kind === 'resolved');
    expect(resolved).toHaveLength(11);
    expect(resolved[0]?.text).toBe('Replaced by version 2. Please use the new card.');
  });

  it('writes the fallback outbox when a channel fails after 3 retries, and CLI approve still works', async () => {
    const broken = new FakeNotifier('telegram');
    broken.failures = Number.POSITIVE_INFINITY;
    await freshRunWith([broken]);
    expect(broken.attempts).toBe(13 * 4); // 11 packs + 2 notices, 1 try + 3 retries each
    expect(listAllAudit(demo.db).filter((e) => e.type === 'notification_failed').length).toBe(13);
    const outbox = readFileSync(path.join(demo.outputDir, 'outbox', 'pending-approvals.md'), 'utf8');
    const s02 = demo.packFor('pol-s02');
    expect(outbox).toContain(`npm run approve -- ${s02.id}`);
    expect(outbox).toContain(`npm run skip -- ${s02.id}`);
    const result = await core().handleAction({ action: 'approve', packId: s02.id, actor: 'broker:cli', channel: 'cli' });
    expect(result.kind).toBe('ok');
  });

  it('with no channel at all the outbox is written', async () => {
    await freshRunWith([]);
    expect(existsSync(path.join(demo.outputDir, 'outbox', 'pending-approvals.md'))).toBe(true);
  });

  it('reminders: none before 48h, one at 48h, none again until 24h later', async () => {
    const web = new FakeNotifier('web');
    const d = await freshRunWith([web]);
    const start = demo.clock.now().getTime();
    const at = (hours: number) => new Date(start + hours * 3_600_000);
    expect(await d.sendDueReminders(at(47))).toBe(0);
    expect(await d.sendDueReminders(at(48))).toBe(11);
    expect(await d.sendDueReminders(at(60))).toBe(0);
    expect(await d.sendDueReminders(at(71.9))).toBe(0);
    demo.clock.set(at(72).toISOString());
    expect(await d.sendDueReminders(at(72))).toBe(11);
    expect(listAllAudit(demo.db).filter((e) => e.type === 'reminder_sent')).toHaveLength(22);
    expect(web.records.find((r) => r.kind === 'reminder')?.text).toContain('Reminder: still waiting for your decision (2 days)');
  });
});

describe('serve shutdown order', () => {
  it('stops in the documented order, even if a step fails', async () => {
    const calls: string[] = [];
    const done = await shutdown({
      stopAccepting: () => void calls.push('accept'),
      stopScheduler: async () => void calls.push('scheduler'),
      stopReminders: () => void calls.push('reminders'),
      stopNotifiers: async () => {
        calls.push('notifiers');
        throw new Error('web server already closed');
      },
      releaseLocks: () => void calls.push('locks'),
      closeDb: () => void calls.push('db'),
    });
    expect(calls).toEqual(['accept', 'scheduler', 'reminders', 'notifiers', 'locks', 'db']);
    expect(done).toEqual([...SHUTDOWN_ORDER]);
  });
});

describe('telegram helpers (no network)', () => {
  it('uses short opaque callback ids', () => {
    expect(encodeCallback('approve', 12)).toBe('a:12');
    expect(decodeCallback('s:7')).toEqual({ action: 'skip', packId: 7 });
    expect(decodeCallback('o:42')).toEqual({ action: 'open', packId: 42 });
    expect(decodeCallback('x:1')).toBeNull();
    expect(decodeCallback('a:../../etc')).toBeNull();
    expect(Buffer.byteLength(encodeCallback('approve', 999_999_999))).toBeLessThanOrEqual(64);
  });

  it('explains failures without ever printing the token', () => {
    const token = `123456789:${'B'.repeat(35)}`;
    const net = explainTelegramFailure(new Error(`fetch failed for https://api.telegram.org/bot${token}/getMe`), token);
    expect(net).toContain('could not reach api.telegram.org');
    expect(net).not.toContain(token);
    expect(explainTelegramFailure(new Error("Call to 'getMe' failed! (401: Unauthorized)"), token)).toContain('rejected the bot token');
  });
});
