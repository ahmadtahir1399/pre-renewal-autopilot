// Prompt 7 Stage U1: the UploadJob state machine, the upload repositories, the daily-limit day boundary
// (including both DST days in Pacific/Auckland) and the 001 -> 002 upgrade of a database that already has data.

import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manualInstantClock } from '../src/domain/dates.js';
import { all, type Db, get, migrate, openDatabase, run } from '../src/state/db.js';
import { getCaseById, insertCase, listCases } from '../src/state/repo.js';
import { UPLOAD_ERROR_MESSAGES, UPLOAD_FAILURE_CODES, UPLOAD_REJECTION_CODES, isRejectionCode, messageFor } from '../src/uploads/errors.js';
import { assertUploadTransition, canUploadTransition, InvalidUploadTransitionError, UPLOAD_STATUSES } from '../src/uploads/model.js';
import {
  countAnalysesStartedOnLocalDay,
  countLiveDocumentsWithHash,
  getExportByHash,
  getManualPolicy,
  getUpload,
  insertExport,
  insertStoredDocument,
  insertUpload,
  listRunningUploads,
  listStoredDocuments,
  listStoredDocumentsBefore,
  manualClientId,
  manualPolicyId,
  markStoredDocumentDeleted,
  setUploadDocuments,
  transitionUpload,
  upsertManualClient,
  upsertManualPolicy,
} from '../src/uploads/repo.js';

const MIGRATIONS = path.join(process.cwd(), 'src', 'state', 'migrations');
let dir: string;
let db: Db;
const clock = manualInstantClock('2026-10-19T18:00:00.000Z');

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pra-uploads-'));
  db = openDatabase(path.join(dir, 'test.db'));
  clock.set('2026-10-19T18:00:00.000Z');
  migrate(db, clock);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('UploadJob state machine', () => {
  const allowed = new Set([
    'received>validating',
    'received>rejected',
    'received>failed',
    'validating>extracting',
    'validating>rejected',
    'validating>failed',
    'extracting>comparing',
    'extracting>failed',
    'comparing>done',
    'comparing>failed',
  ]);

  it('checks EVERY pair of states', () => {
    for (const from of UPLOAD_STATUSES) {
      for (const to of UPLOAD_STATUSES) {
        const key = `${from}>${to}`;
        expect(canUploadTransition(from, to), key).toBe(allowed.has(key));
        if (allowed.has(key)) expect(() => assertUploadTransition(1, from, to)).not.toThrow();
        else expect(() => assertUploadTransition(1, from, to)).toThrow(InvalidUploadTransitionError);
      }
    }
  });

  it('done, failed and rejected are terminal', () => {
    for (const terminal of ['done', 'failed', 'rejected'] as const) {
      for (const to of UPLOAD_STATUSES) expect(canUploadTransition(terminal, to)).toBe(false);
    }
  });
});

describe('upload error codes', () => {
  it('every code has a plain message that names no file and no secret', () => {
    for (const code of [...UPLOAD_REJECTION_CODES, ...UPLOAD_FAILURE_CODES]) {
      const message = UPLOAD_ERROR_MESSAGES[code];
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/\.pdf\b|token|key|stack|Error:/i);
    }
  });

  it('rejection and failure codes are disjoint; the U-2 identity codes are failures', () => {
    for (const code of UPLOAD_FAILURE_CODES) expect(isRejectionCode(code)).toBe(false);
    for (const code of UPLOAD_REJECTION_CODES) expect(isRejectionCode(code)).toBe(true);
    for (const code of ['type_not_supported', 'document_mismatch', 'identity_unreadable', 'type_disagreement'] as const) expect(isRejectionCode(code)).toBe(false);
  });

  it('side-specific messages say which document', () => {
    expect(messageFor('encrypted', 'renewal')).toMatch(/^The renewal offer: /);
    expect(messageFor('encrypted', 'expiring')).toMatch(/^The expiring policy: /);
    expect(messageFor('busy')).toBe(UPLOAD_ERROR_MESSAGES.busy);
  });
});

describe('uploads repository', () => {
  it('walks a job to done, stamping started_at on extracting and finished_at at the end', () => {
    const job = insertUpload(db, clock, { actor: 'broker:web', mode: 'attach', policyId: 'pol-s07' });
    expect(job).toMatchObject({ status: 'received', startedAt: null, finishedAt: null, tokensIn: 0 });
    transitionUpload(db, clock, job.id, 'validating');
    expect(getUpload(db, job.id)?.startedAt).toBeNull();
    clock.advance(1000);
    transitionUpload(db, clock, job.id, 'extracting');
    const started = getUpload(db, job.id)?.startedAt;
    expect(started).toBe('2026-10-19T18:00:01.000Z');
    clock.advance(1000);
    transitionUpload(db, clock, job.id, 'comparing', { tokensIn: 12, tokensOut: 3 });
    clock.advance(1000);
    const done = transitionUpload(db, clock, job.id, 'done', { packId: null, caseId: null });
    expect(done).toMatchObject({ status: 'done', startedAt: started, finishedAt: '2026-10-19T18:00:03.000Z', tokensIn: 12, tokensOut: 3 });
  });

  it('refuses a forbidden move and leaves the row unchanged', () => {
    const job = insertUpload(db, clock, { actor: 'broker:cli', mode: 'new' });
    expect(() => transitionUpload(db, clock, job.id, 'done')).toThrow(InvalidUploadTransitionError);
    expect(getUpload(db, job.id)?.status).toBe('received');
  });

  it('records a rejection code and a bounded message; rejected jobs never count as started', () => {
    const job = insertUpload(db, clock, { actor: 'broker:web', mode: 'new' });
    transitionUpload(db, clock, job.id, 'validating');
    const rejected = transitionUpload(db, clock, job.id, 'rejected', { failureCode: 'not_a_pdf', failureMessage: 'x'.repeat(1000) });
    expect(rejected.failureCode).toBe('not_a_pdf');
    expect(rejected.failureMessage?.length).toBe(300);
    expect(rejected.startedAt).toBeNull();
    expect(countAnalysesStartedOnLocalDay(db, clock.now(), 'Pacific/Auckland')).toBe(0);
  });

  it('lists running jobs (for busy and startup recovery)', () => {
    const a = insertUpload(db, clock, { actor: 'broker:web', mode: 'new' });
    const b = insertUpload(db, clock, { actor: 'broker:web', mode: 'new' });
    transitionUpload(db, clock, b.id, 'rejected', { failureCode: 'busy' });
    expect(listRunningUploads(db).map((u) => u.id)).toEqual([a.id]);
  });

  it('stores documents per side, once per side, and supports soft delete and retention queries', () => {
    const job = insertUpload(db, clock, { actor: 'broker:web', mode: 'new' });
    const base = { uploadId: job.id, sha256: 'a'.repeat(64), sizeBytes: 1234, pageCount: 2, displayName: 'expiring.pdf', storedPath: `uploads/u1/expiring.pdf` };
    const expiring = insertStoredDocument(db, clock, { ...base, side: 'expiring' });
    expect(() => insertStoredDocument(db, clock, { ...base, side: 'expiring' })).toThrow(/UNIQUE/);
    setUploadDocuments(db, job.id, { expiringDocId: expiring.id });
    expect(getUpload(db, job.id)?.expiringDocId).toBe(expiring.id);
    expect(listStoredDocuments(db, job.id)).toHaveLength(1);
    expect(listStoredDocumentsBefore(db, '2026-10-19T17:59:59.000Z')).toHaveLength(0);
    expect(listStoredDocumentsBefore(db, '2026-10-19T18:00:01.000Z').map((d) => d.id)).toEqual([expiring.id]);
    const other = insertUpload(db, clock, { actor: 'broker:web', mode: 'new' });
    insertStoredDocument(db, clock, { ...base, uploadId: other.id, side: 'expiring' });
    expect(countLiveDocumentsWithHash(db, base.sha256, job.id)).toBe(1);
    markStoredDocumentDeleted(db, clock, expiring.id);
    expect(listStoredDocuments(db, job.id)[0]?.deletedAt).toBe('2026-10-19T18:00:00.000Z');
    expect(listStoredDocumentsBefore(db, '2030-01-01T00:00:00.000Z')).toHaveLength(1);
  });

  it('display names are capped at 100 characters', () => {
    const job = insertUpload(db, clock, { actor: 'broker:web', mode: 'new' });
    const doc = insertStoredDocument(db, clock, { uploadId: job.id, side: 'renewal', sha256: 'b'.repeat(64), sizeBytes: 1, pageCount: 1, displayName: 'n'.repeat(400), storedPath: 'uploads/u/renewal.pdf' });
    expect(doc.displayName.length).toBe(100);
  });
});

describe('manual identities (U-5)', () => {
  it('policy ids are stable across case and whitespace and change with either part', () => {
    const id = manualPolicyId('Harbour Mutual', 'HM-1234');
    expect(id).toMatch(/^man-[0-9a-f]{12}$/);
    expect(manualPolicyId('  harbour   MUTUAL ', 'hm-1234')).toBe(id);
    expect(manualPolicyId('Harbour Mutual', 'HM-1235')).not.toBe(id);
    expect(manualPolicyId('Other Mutual', 'HM-1234')).not.toBe(id);
    expect(manualClientId('Harbourview Bakery Ltd')).toMatch(/^mcl-[0-9a-f]{12}$/);
  });

  it('upserts are idempotent and keep the first details', () => {
    const first = upsertManualClient(db, clock, { name: 'Harbourview Bakery Ltd', contactName: 'Sam', contactEmail: 'sam@example.com' });
    const again = upsertManualClient(db, clock, { name: 'harbourview bakery ltd', contactName: 'Other' });
    expect(first.created).toBe(true);
    expect(again).toEqual({ client: first.client, created: false });
    const policy = {
      policyId: manualPolicyId('Harbour Mutual', 'HM-1234'),
      clientId: first.client.id,
      brokerId: 'brk-01',
      insurerName: 'Harbour Mutual',
      type: 'commercial_property' as const,
      expiryDate: '2026-12-01',
      annualPremium: 4200,
    };
    expect(upsertManualPolicy(db, clock, policy).created).toBe(true);
    expect(upsertManualPolicy(db, clock, { ...policy, annualPremium: 1 }).created).toBe(false);
    expect(getManualPolicy(db, policy.policyId)?.annualPremium).toBe(4200);
  });

  it('the database refuses an unsupported policy type', () => {
    const client = upsertManualClient(db, clock, { name: 'X Ltd' }).client;
    expect(() =>
      upsertManualPolicy(db, clock, { policyId: 'man-000000000000', clientId: client.id, brokerId: 'b', insurerName: 'I', type: 'marine' as never, expiryDate: '2026-12-01', annualPremium: null }),
    ).toThrow(/CHECK/);
  });
});

describe('exports', () => {
  it('one row per content hash', () => {
    const row = insertExport(db, clock, { filters: { status: 'all' }, relativePath: 'overview/2026-10-19/abc/overview.xlsx', contentHash: 'c'.repeat(64), rowCount: 3 });
    expect(getExportByHash(db, 'c'.repeat(64))).toEqual(row);
    expect(() => insertExport(db, clock, { filters: {}, relativePath: 'x', contentHash: 'c'.repeat(64), rowCount: 0 })).toThrow(/UNIQUE/);
  });
});

describe('daily limit: analyses started on the local day (TIMEZONE)', () => {
  function startAt(iso: string): void {
    clock.set(iso);
    const job = insertUpload(db, clock, { actor: 'broker:web', mode: 'new' });
    transitionUpload(db, clock, job.id, 'validating');
    transitionUpload(db, clock, job.id, 'extracting');
  }

  it('counts by the local calendar day, not the UTC day', () => {
    // Pacific/Auckland is UTC+13 in October: local 2026-10-19 runs 2026-10-18T11:00Z .. 2026-10-19T11:00Z.
    startAt('2026-10-18T10:59:59.000Z'); // local 2026-10-18 23:59:59
    startAt('2026-10-18T11:00:00.000Z'); // local 2026-10-19 00:00:00
    startAt('2026-10-19T10:59:59.000Z'); // local 2026-10-19 23:59:59
    startAt('2026-10-19T11:00:00.000Z'); // local 2026-10-20 00:00:00
    expect(countAnalysesStartedOnLocalDay(db, new Date('2026-10-19T05:00:00.000Z'), 'Pacific/Auckland')).toBe(2);
    expect(countAnalysesStartedOnLocalDay(db, new Date('2026-10-18T05:00:00.000Z'), 'Pacific/Auckland')).toBe(1);
    expect(countAnalysesStartedOnLocalDay(db, new Date('2026-10-19T12:00:00.000Z'), 'Pacific/Auckland')).toBe(1);
  });

  it('a 23-hour DST day (2026-09-27, clocks go forward) has the right bounds', () => {
    // Local midnight 2026-09-27 is NZST (+12) = 2026-09-26T12:00Z; next midnight is NZDT (+13) = 2026-09-27T11:00Z.
    startAt('2026-09-26T11:59:59.000Z'); // previous day
    startAt('2026-09-26T12:00:00.000Z'); // first second of the day
    startAt('2026-09-27T10:59:59.000Z'); // last second of the day
    startAt('2026-09-27T11:00:00.000Z'); // next day
    expect(countAnalysesStartedOnLocalDay(db, new Date('2026-09-27T00:00:00.000Z'), 'Pacific/Auckland')).toBe(2);
  });

  it('a 25-hour DST day (2027-04-04, clocks go back) has the right bounds', () => {
    // Local midnight 2027-04-04 is NZDT (+13) = 2027-04-03T11:00Z; next midnight is NZST (+12) = 2027-04-04T12:00Z.
    startAt('2027-04-03T10:59:59.000Z');
    startAt('2027-04-03T11:00:00.000Z');
    startAt('2027-04-04T11:59:59.000Z');
    startAt('2027-04-04T12:00:00.000Z');
    expect(countAnalysesStartedOnLocalDay(db, new Date('2027-04-04T00:00:00.000Z'), 'Pacific/Auckland')).toBe(2);
  });
});

describe('migration 002 upgrades a database that already has data', () => {
  it('keeps every existing row and gives old cases and packs the data-source defaults', () => {
    const oldDir = path.join(dir, 'only-001');
    mkdirSync(oldDir);
    copyFileSync(path.join(MIGRATIONS, '001_initial.sql'), path.join(oldDir, '001_initial.sql'));
    const oldDb = openDatabase(path.join(dir, 'old.db'));
    try {
      expect(migrate(oldDb, clock, oldDir)).toEqual(['001_initial']);
      const at = '2026-10-18T18:00:00.000Z';
      run(oldDb, "INSERT INTO cases (policy_id, cycle_key, status, current_version, created_at, updated_at) VALUES ('pol-s01', 'pol-s01:2027-01-17', 'in_review', 1, ?, ?)", at, at);
      run(oldDb, "INSERT INTO packs (case_id, version, status, content_hash, input_hash, paths, pack_json, run_id, created_at) VALUES (1, 1, 'active', 'h', 'i', '{}', '{}', NULL, ?)", at);
      run(oldDb, "INSERT INTO audit_events (at, type, run_id, policy_id, cycle_key, actor, details, created_at) VALUES (?, 'seeded', NULL, 'pol-s01', NULL, 'system', '{}', ?)", at, at);
      const before = {
        cases: all(oldDb, 'SELECT * FROM cases'),
        packs: all(oldDb, 'SELECT * FROM packs'),
        audit: all(oldDb, 'SELECT * FROM audit_events'),
      };

      expect(migrate(oldDb, clock)).toEqual(['002_uploads', '003_upload_reading']);
      expect(migrate(oldDb, clock)).toEqual([]);

      const cases = all(oldDb, 'SELECT * FROM cases');
      const packs = all(oldDb, 'SELECT * FROM packs');
      expect(cases).toEqual(before.cases.map((row) => ({ ...row, origin: 'data_source' })));
      expect(packs).toEqual(before.packs.map((row) => ({ ...row, input_source: 'data_source' })));
      expect(all(oldDb, 'SELECT * FROM audit_events')).toEqual(before.audit);
      expect(getCaseById(oldDb, 1)?.origin).toBe('data_source');
      expect(get(oldDb, 'SELECT input_source FROM packs WHERE id = 1')?.input_source).toBe('data_source');
      const tables = all(oldDb, "SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
      expect(tables).toEqual(expect.arrayContaining(['uploads', 'uploaded_documents', 'manual_clients', 'manual_policies', 'exports']));
      expect(get(oldDb, 'SELECT COUNT(*) AS n FROM uploads')?.n).toBe(0);
    } finally {
      oldDb.close();
    }
  });

  it('a manual case is stored with origin manual; the database refuses an unknown origin', () => {
    const manual = insertCase(db, clock, { policyId: 'man-0123456789ab', cycleKey: 'man-0123456789ab:2026-12-01', origin: 'manual' });
    expect(manual.origin).toBe('manual');
    expect(listCases(db).map((c) => c.origin)).toEqual(['manual']);
    expect(() => run(db, "UPDATE cases SET origin = 'other' WHERE id = ?", manual.id)).toThrow(/CHECK/);
  });
});
