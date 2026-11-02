import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manualInstantClock } from '../src/domain/dates.js';
import { RENEWAL_STATUSES } from '../src/domain/schemas.js';
import type { RenewalStatus } from '../src/domain/types.js';
import { AuditDetailsRejectedError, assertSafeDetails, createAuditLog } from '../src/state/audit.js';
import { all, type Db, migrate, openDatabase, openDatabaseReadOnly, transaction } from '../src/state/db.js';
import { acquireLock, LockHeldError } from '../src/state/lockFile.js';
import { getCaseByCycleKey, insertCase, transitionCase } from '../src/state/repo.js';
import { assertTransition, canTransition, InvalidTransitionError } from '../src/state/statusMachine.js';

let dir: string;
let db: Db;
const clock = manualInstantClock('2026-10-19T18:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pra-state-'));
  db = openDatabase(path.join(dir, 'test.db'));
  migrate(db, clock);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('records applied migrations and applies nothing twice', () => {
    expect(all(db, 'SELECT id FROM schema_migrations').map((r) => r.id)).toEqual(['001_initial', '002_uploads', '003_upload_reading']);
    expect(migrate(db, clock)).toEqual([]);
    const tables = all(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['approvals', 'audit_events', 'cases', 'notifications', 'packs', 'runs', 'schema_migrations']));
  });

  it('enforces one case per cycle key at the database level', () => {
    insertCase(db, clock, { policyId: 'pol-s01', cycleKey: 'pol-s01:2027-01-17' });
    expect(() => insertCase(db, clock, { policyId: 'pol-s01', cycleKey: 'pol-s01:2027-01-17' })).toThrow(/UNIQUE/);
  });

  it('read-only open does not create a missing database', () => {
    expect(openDatabaseReadOnly(path.join(dir, 'nope.db'))).toBeNull();
  });

  it('a failed transaction leaves nothing behind', () => {
    expect(() =>
      transaction(db, () => {
        insertCase(db, clock, { policyId: 'pol-s02', cycleKey: 'pol-s02:2027-01-25' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(getCaseByCycleKey(db, 'pol-s02:2027-01-25')).toBeUndefined();
  });
});

describe('status machine', () => {
  const allowed = new Set(['not_started>drafted', 'not_started>needs_attention', 'needs_attention>drafted', 'drafted>in_review', 'in_review>approved', 'in_review>skipped']);
  const forcedOnly = new Set(['approved>drafted', 'skipped>drafted']);

  it('checks EVERY pair of statuses', () => {
    for (const from of RENEWAL_STATUSES) {
      for (const to of RENEWAL_STATUSES) {
        const pair = `${from}>${to}`;
        expect(canTransition(from, to), pair).toBe(allowed.has(pair));
        expect(canTransition(from, to, { force: true }), `${pair} forced`).toBe(allowed.has(pair) || forcedOnly.has(pair));
      }
    }
  });

  it('names from, to and the policy in the error', () => {
    expect(() => assertTransition('pol-s01', 'approved', 'in_review')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('pol-s01', 'approved', 'in_review')).toThrow('approved -> in_review is not allowed for policy pol-s01');
    expect(() => assertTransition('pol-s01', 'approved', 'drafted')).toThrow(InvalidTransitionError);
    expect(() => assertTransition('pol-s01', 'approved', 'drafted', { force: true })).not.toThrow();
  });

  it('every transition writes a status_changed audit event', () => {
    const audit = createAuditLog(db, clock);
    let caseRow = insertCase(db, clock, { policyId: 'pol-s01', cycleKey: 'pol-s01:2027-01-17' });
    const path_: RenewalStatus[] = ['drafted', 'in_review', 'approved'];
    for (const to of path_) caseRow = transitionCase(db, clock, audit, { caseRow, to, actor: 'system' });
    const events = audit.listAudit('pol-s01').filter((e) => e.type === 'status_changed');
    expect(events.map((e) => `${e.details.from}>${e.details.to}`)).toEqual(['not_started>drafted', 'drafted>in_review', 'in_review>approved']);
    expect(getCaseByCycleKey(db, 'pol-s01:2027-01-17')?.status).toBe('approved');
    expect(() => transitionCase(db, clock, audit, { caseRow, to: 'skipped', actor: 'system' })).toThrow(InvalidTransitionError);
  });
});

describe('audit guard', () => {
  it('accepts small details, including token COUNTS', () => {
    expect(() => assertSafeDetails({ inputTokens: 2343, fromCache: true, reason: 'renewal document missing' })).not.toThrow();
  });

  it('rejects secret-shaped keys and values, and long text', () => {
    expect(() => assertSafeDetails({ token: 'abc' })).toThrow(AuditDetailsRejectedError);
    expect(() => assertSafeDetails({ apiKey: 'x' })).toThrow(AuditDetailsRejectedError);
    expect(() => assertSafeDetails({ note: `123456789:${'A'.repeat(35)}` })).toThrow(AuditDetailsRejectedError);
    expect(() => assertSafeDetails({ note: `sk-${'a'.repeat(20)}` })).toThrow(AuditDetailsRejectedError);
    expect(() => assertSafeDetails({ text: 'x'.repeat(400) })).toThrow(AuditDetailsRejectedError);
    expect(() => assertSafeDetails({ list: Array.from({ length: 200 }, () => 'abcdefghij') })).toThrow(AuditDetailsRejectedError);
  });

  it('refuses unknown event types and stores timestamps from the injected clock', () => {
    const audit = createAuditLog(db, clock);
    // @ts-expect-error - deliberately unknown type
    expect(() => audit.recordAudit({ type: 'made_up', actor: 'system' })).toThrow(AuditDetailsRejectedError);
    audit.recordAudit({ type: 'seeded', actor: 'system', policyId: 'pol-s12', details: { status: 'approved' } });
    expect(audit.listAudit('pol-s12')[0]?.at).toBe('2026-10-19T18:00:00.000Z');
  });
});

describe('lock file', () => {
  it('blocks a second holder whose owner is alive, and takes over a stale lock', () => {
    const lockPath = path.join(dir, 'runtime', 'run.lock');
    const first = acquireLock(lockPath, { pid: 111, isAlive: () => true });
    expect(() => acquireLock(lockPath, { pid: 222, isAlive: () => true })).toThrow(LockHeldError);
    const takeover = acquireLock(lockPath, { pid: 222, isAlive: () => false }); // owner 111 crashed
    first.release(); // not the owner any more: must not delete 222's lock
    expect(() => acquireLock(lockPath, { pid: 333, isAlive: (pid) => pid === 222 })).toThrow(LockHeldError);
    takeover.release();
    expect(() => acquireLock(lockPath, { pid: 333, isAlive: () => true }).release()).not.toThrow();
  });
});
