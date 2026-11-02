// UNAUTHORISED APPROVAL ATTEMPTS through a notifier (FakeNotifier standing in for Telegram). The web
// equivalents (bad token, missing CSRF, bad Origin, bad Host) are in test/web.test.ts, which
// `npm run test:security` re-runs instead of duplicating.

import { describe, expect, it } from 'vitest';
import { createApprovalCore } from '../../src/approval/actions.js';
import { FakeNotifier } from '../../src/approval/notifier.js';
import { listAllAudit } from '../../src/state/audit.js';
import { getCaseByCycleKey } from '../../src/state/repo.js';
import { createDemo } from '../helpers.js';

describe('unauthorised approval attempts are rejected and audited', () => {
  it('a Telegram-style press from a chat that is not allowed changes nothing and is audited', async () => {
    const demo = await createDemo();
    try {
      const notifier = new FakeNotifier('telegram');
      const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, outputDir: demo.outputDir, allowedTelegramChatIds: ['111'] });
      await notifier.start(core.handleAction);
      const pack = demo.packFor('pol-s02');
      for (const action of ['approve', 'skip', 'open'] as const) {
        const result = await notifier.handler?.({ action, packId: pack.id, actor: 'broker:telegram:999', channel: 'telegram' });
        expect(result?.kind, action).toBe('not_allowed');
      }
      expect(getCaseByCycleKey(demo.db, pack.pack.cycleKey)?.status).toBe('in_review');
      const attempts = listAllAudit(demo.db).filter((e) => e.type === 'unauthorised_attempt' && e.actor === 'broker:telegram:999');
      expect(attempts.map((e) => e.details.action)).toEqual(['approve', 'skip', 'open']);
      // The allowed chat still works.
      expect((await notifier.handler?.({ action: 'approve', packId: pack.id, actor: 'broker:telegram:111', channel: 'telegram' }))?.kind).toBe('ok');
      expect(getCaseByCycleKey(demo.db, pack.pack.cycleKey)?.status).toBe('approved');
    } finally {
      demo.cleanup();
    }
  });

  it('an unknown pack id and a repeated decision are refused and audited, never applied twice', async () => {
    const demo = await createDemo();
    try {
      const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: demo.dataSource, outputDir: demo.outputDir, allowedTelegramChatIds: [] });
      expect((await core.handleAction({ action: 'approve', packId: 999_999, actor: 'broker:web', channel: 'web' })).kind).toBe('not_found');
      const pack = demo.packFor('pol-s03');
      expect((await core.handleAction({ action: 'approve', packId: pack.id, actor: 'broker:web', channel: 'web' })).kind).toBe('ok');
      expect((await core.handleAction({ action: 'approve', packId: pack.id, actor: 'broker:web', channel: 'web' })).kind).toBe('already_done');
      expect((await core.handleAction({ action: 'skip', packId: pack.id, actor: 'broker:web', channel: 'web' })).kind).toBe('wrong_state');
      const ignored = listAllAudit(demo.db).filter((e) => e.type === 'approval_ignored');
      expect(ignored.length).toBeGreaterThanOrEqual(3);
    } finally {
      demo.cleanup();
    }
  });
});
