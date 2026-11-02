// Pure database functions for uploads, stored documents, manual clients/policies and exports (Prompt 7, D-F).
// Every timestamp comes from the injected clock. Upload status changes go through the upload state machine.

import { createHash } from 'node:crypto';
import { addDays, type InstantClock } from '../domain/dates.js';
import type { ExtractionWarning } from '../documents/verifyQuotes.js';
import { ExtractedTermsSchema } from '../domain/schemas.js';
import type { ExtractedTerms, PolicyType } from '../domain/types.js';
import { zonedParts, zonedTimeToUtc } from '../pipeline/scheduler.js';
import { all, type Db, get, type Row, run } from '../state/db.js';
import type { UploadErrorCode } from './errors.js';
import { assertUploadTransition, RUNNING_UPLOAD_STATUSES, type UploadMode, type UploadSide, type UploadStatus } from './model.js';

// ---- uploads ----------------------------------------------------------------

export interface UploadRow {
  id: number;
  createdAt: string;
  actor: string;
  mode: UploadMode;
  policyId: string | null;
  status: UploadStatus;
  failureCode: UploadErrorCode | null;
  failureMessage: string | null;
  expiringDocId: number | null;
  renewalDocId: number | null;
  caseId: number | null;
  packId: number | null;
  tokensIn: number;
  tokensOut: number;
  startedAt: string | null;
  finishedAt: string | null;
}

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const int = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

function toUpload(row: Row): UploadRow {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    actor: String(row.actor),
    mode: String(row.mode) as UploadMode,
    policyId: text(row.policy_id),
    status: String(row.status) as UploadStatus,
    failureCode: text(row.failure_code) as UploadErrorCode | null,
    failureMessage: text(row.failure_message),
    expiringDocId: int(row.expiring_doc_id),
    renewalDocId: int(row.renewal_doc_id),
    caseId: int(row.case_id),
    packId: int(row.pack_id),
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
    startedAt: text(row.started_at),
    finishedAt: text(row.finished_at),
  };
}

export function insertUpload(db: Db, clock: InstantClock, input: { actor: string; mode: UploadMode; policyId?: string | null }): UploadRow {
  const id = run(
    db,
    "INSERT INTO uploads (created_at, actor, mode, policy_id, status) VALUES (?, ?, ?, ?, 'received')",
    clock.now().toISOString(),
    input.actor,
    input.mode,
    input.policyId ?? null,
  ).lastInsertRowid;
  return getUpload(db, id) as UploadRow;
}

export function getUpload(db: Db, id: number): UploadRow | undefined {
  const row = get(db, 'SELECT * FROM uploads WHERE id = ?', id);
  return row ? toUpload(row) : undefined;
}

export function listUploads(db: Db, limit = 50): UploadRow[] {
  return all(db, 'SELECT * FROM uploads ORDER BY id DESC LIMIT ?', limit).map(toUpload);
}

export function listRunningUploads(db: Db): UploadRow[] {
  const placeholders = RUNNING_UPLOAD_STATUSES.map(() => '?').join(', ');
  return all(db, `SELECT * FROM uploads WHERE status IN (${placeholders}) ORDER BY id`, ...RUNNING_UPLOAD_STATUSES).map(toUpload);
}

export interface UploadUpdate {
  failureCode?: UploadErrorCode | null;
  failureMessage?: string | null;
  caseId?: number | null;
  packId?: number | null;
  tokensIn?: number;
  tokensOut?: number;
}

/**
 * Move a job to `to` (checked against UPLOAD_TRANSITIONS). started_at is set when the job enters 'extracting'
 * (an analysis really starts; door rejections do not count towards the daily limit); finished_at on a terminal state.
 */
export function transitionUpload(db: Db, clock: InstantClock, id: number, to: UploadStatus, update: UploadUpdate = {}): UploadRow {
  const current = getUpload(db, id);
  if (!current) throw new Error(`Unknown upload ${id}`);
  assertUploadTransition(id, current.status, to);
  const now = clock.now().toISOString();
  const terminal = to === 'done' || to === 'failed' || to === 'rejected';
  run(
    db,
    `UPDATE uploads SET status = ?, failure_code = ?, failure_message = ?, case_id = ?, pack_id = ?, tokens_in = ?, tokens_out = ?,
       started_at = ?, finished_at = ? WHERE id = ?`,
    to,
    update.failureCode === undefined ? current.failureCode : update.failureCode,
    update.failureMessage === undefined ? current.failureMessage : (update.failureMessage ?? '').slice(0, 300) || null,
    update.caseId === undefined ? current.caseId : update.caseId,
    update.packId === undefined ? current.packId : update.packId,
    update.tokensIn ?? current.tokensIn,
    update.tokensOut ?? current.tokensOut,
    to === 'extracting' && current.startedAt === null ? now : current.startedAt,
    terminal ? now : current.finishedAt,
    id,
  );
  return getUpload(db, id) as UploadRow;
}

export function setUploadDocuments(db: Db, id: number, docs: { expiringDocId?: number | null; renewalDocId?: number | null }): void {
  const current = getUpload(db, id);
  if (!current) throw new Error(`Unknown upload ${id}`);
  run(
    db,
    'UPDATE uploads SET expiring_doc_id = ?, renewal_doc_id = ? WHERE id = ?',
    docs.expiringDocId === undefined ? current.expiringDocId : docs.expiringDocId,
    docs.renewalDocId === undefined ? current.renewalDocId : docs.renewalDocId,
    id,
  );
}

/** New mode: record the U-5 policy id once the expiring document has been read. */
export function setUploadPolicyId(db: Db, id: number, policyId: string): void {
  run(db, 'UPDATE uploads SET policy_id = ? WHERE id = ?', policyId, id);
}

/**
 * Analyses STARTED (entered 'extracting') on the local calendar day of `now` in timeZone. Day bounds are computed
 * with the zone's own rules, so a 23-hour or 25-hour DST day is counted correctly.
 */
export function countAnalysesStartedOnLocalDay(db: Db, now: Date, timeZone: string): number {
  const day = zonedParts(now, timeZone).date;
  const start = zonedTimeToUtc(day, '00:00', timeZone).toISOString();
  const end = zonedTimeToUtc(addDays(day, 1), '00:00', timeZone).toISOString();
  return Number(get(db, 'SELECT COUNT(*) AS n FROM uploads WHERE started_at IS NOT NULL AND started_at >= ? AND started_at < ?', start, end)?.n ?? 0);
}

// ---- stored documents -------------------------------------------------------

export interface StoredDocumentRow {
  id: number;
  uploadId: number;
  side: UploadSide;
  sha256: string;
  sizeBytes: number;
  pageCount: number;
  displayName: string;
  /** Relative to the runtime folder (DATA_DIR/runtime), '/' separators. Never from a request. */
  storedPath: string;
  createdAt: string;
  deletedAt: string | null;
}

function toDocument(row: Row): StoredDocumentRow {
  return {
    id: Number(row.id),
    uploadId: Number(row.upload_id),
    side: String(row.side) as UploadSide,
    sha256: String(row.sha256),
    sizeBytes: Number(row.size_bytes),
    pageCount: Number(row.page_count),
    displayName: String(row.display_name),
    storedPath: String(row.stored_path),
    createdAt: String(row.created_at),
    deletedAt: text(row.deleted_at),
  };
}

export function insertStoredDocument(
  db: Db,
  clock: InstantClock,
  input: { uploadId: number; side: UploadSide; sha256: string; sizeBytes: number; pageCount: number; displayName: string; storedPath: string },
): StoredDocumentRow {
  const id = run(
    db,
    'INSERT INTO uploaded_documents (upload_id, side, sha256, size_bytes, page_count, display_name, stored_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    input.uploadId,
    input.side,
    input.sha256,
    input.sizeBytes,
    input.pageCount,
    input.displayName.slice(0, 100),
    input.storedPath,
    clock.now().toISOString(),
  ).lastInsertRowid;
  return getStoredDocument(db, id) as StoredDocumentRow;
}

export function getStoredDocument(db: Db, id: number): StoredDocumentRow | undefined {
  const row = get(db, 'SELECT * FROM uploaded_documents WHERE id = ?', id);
  return row ? toDocument(row) : undefined;
}

export function listStoredDocuments(db: Db, uploadId: number): StoredDocumentRow[] {
  return all(db, 'SELECT * FROM uploaded_documents WHERE upload_id = ? ORDER BY side', uploadId).map(toDocument);
}

/** Documents (not yet deleted) created before the cutoff instant. */
export function listStoredDocumentsBefore(db: Db, cutoffIso: string): StoredDocumentRow[] {
  return all(db, 'SELECT * FROM uploaded_documents WHERE deleted_at IS NULL AND created_at < ? ORDER BY id', cutoffIso).map(toDocument);
}

export function markStoredDocumentDeleted(db: Db, clock: InstantClock, id: number): void {
  run(db, 'UPDATE uploaded_documents SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', clock.now().toISOString(), id);
}

/** Other live (not deleted) stored documents with the same bytes (used before deleting cache entries). */
export function countLiveDocumentsWithHash(db: Db, sha256: string, exceptUploadId: number): number {
  return Number(get(db, 'SELECT COUNT(*) AS n FROM uploaded_documents WHERE sha256 = ? AND deleted_at IS NULL AND upload_id != ?', sha256, exceptUploadId)?.n ?? 0);
}

// ---- extracted facts per job ---------------------------------------------------

export interface UploadTermsRow {
  uploadId: number;
  side: UploadSide;
  source: 'upload' | 'data_source';
  terms: ExtractedTerms;
  warnings: ExtractionWarning[];
  /** D-120: facts confirmed by the targeted second reading. */
  repairedFields: string[];
}

export function saveUploadTerms(
  db: Db,
  clock: InstantClock,
  input: Omit<UploadTermsRow, 'terms' | 'warnings' | 'repairedFields'> & { terms: ExtractedTerms; warnings: readonly ExtractionWarning[]; repairedFields?: readonly string[] },
): void {
  run(
    db,
    'INSERT OR REPLACE INTO upload_terms (upload_id, side, source, terms_json, warnings_json, repaired_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    input.uploadId,
    input.side,
    input.source,
    JSON.stringify(ExtractedTermsSchema.parse(input.terms)),
    JSON.stringify(input.warnings),
    JSON.stringify(input.repairedFields ?? []),
    clock.now().toISOString(),
  );
}

export function listUploadTerms(db: Db, uploadId: number): UploadTermsRow[] {
  return all(db, 'SELECT * FROM upload_terms WHERE upload_id = ? ORDER BY side', uploadId).map((row) => ({
    uploadId: Number(row.upload_id),
    side: String(row.side) as UploadSide,
    source: String(row.source) === 'data_source' ? 'data_source' : 'upload',
    terms: ExtractedTermsSchema.parse(JSON.parse(String(row.terms_json))),
    warnings: JSON.parse(String(row.warnings_json)) as ExtractionWarning[],
    repairedFields: (JSON.parse(String(row.repaired_json ?? '[]')) as unknown[]).map(String),
  }));
}

/** The newest job that produced this pack (for the job link on a pack page and the fake-mode check). */
export function getUploadForPack(db: Db, packId: number): UploadRow | undefined {
  const row = get(db, 'SELECT * FROM uploads WHERE pack_id = ? ORDER BY id DESC LIMIT 1', packId);
  return row ? toUpload(row) : undefined;
}

// ---- manual clients and policies -------------------------------------------

export interface ManualClientRow {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
}

export interface ManualPolicyRow {
  policyId: string;
  clientId: string;
  brokerId: string;
  insurerName: string;
  type: PolicyType;
  expiryDate: string;
  annualPremium: number | null;
}

/** Lowercase, trimmed, whitespace collapsed (U-5). */
export function normaliseIdentityText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** U-5: 'man-' + first 12 hex of sha256(normalised insurer + '|' + normalised policy number). */
export function manualPolicyId(insurerName: string, policyNumber: string): string {
  return `man-${createHash('sha256').update(`${normaliseIdentityText(insurerName)}|${normaliseIdentityText(policyNumber)}`).digest('hex').slice(0, 12)}`;
}

/** Deterministic client id: 'mcl-' + first 12 hex of sha256(normalised name). Same name -> same client. */
export function manualClientId(name: string): string {
  return `mcl-${createHash('sha256').update(normaliseIdentityText(name)).digest('hex').slice(0, 12)}`;
}

export function getManualClient(db: Db, id: string): ManualClientRow | undefined {
  const row = get(db, 'SELECT * FROM manual_clients WHERE id = ?', id);
  return row ? { id: String(row.id), name: String(row.name), contactName: text(row.contact_name), contactEmail: text(row.contact_email) } : undefined;
}

/** Create the client, or return the existing one with the same id (contact details are kept from the first time). */
export function upsertManualClient(db: Db, clock: InstantClock, input: { name: string; contactName?: string | null; contactEmail?: string | null }): { client: ManualClientRow; created: boolean } {
  const id = manualClientId(input.name);
  const existing = getManualClient(db, id);
  if (existing) return { client: existing, created: false };
  run(db, 'INSERT INTO manual_clients (id, name, contact_name, contact_email, created_at) VALUES (?, ?, ?, ?, ?)', id, input.name, input.contactName ?? null, input.contactEmail ?? null, clock.now().toISOString());
  return { client: getManualClient(db, id) as ManualClientRow, created: true };
}

function toManualPolicy(row: Row): ManualPolicyRow {
  return {
    policyId: String(row.policy_id),
    clientId: String(row.client_id),
    brokerId: String(row.broker_id),
    insurerName: String(row.insurer_name),
    type: String(row.type) as PolicyType,
    expiryDate: String(row.expiry_date),
    annualPremium: row.annual_premium === null || row.annual_premium === undefined ? null : Number(row.annual_premium),
  };
}

export function getManualPolicy(db: Db, policyId: string): ManualPolicyRow | undefined {
  const row = get(db, 'SELECT * FROM manual_policies WHERE policy_id = ?', policyId);
  return row ? toManualPolicy(row) : undefined;
}

export function listManualPolicies(db: Db): ManualPolicyRow[] {
  return all(db, 'SELECT * FROM manual_policies ORDER BY policy_id').map(toManualPolicy);
}

export function upsertManualPolicy(db: Db, clock: InstantClock, input: ManualPolicyRow): { policy: ManualPolicyRow; created: boolean } {
  const existing = getManualPolicy(db, input.policyId);
  if (existing) return { policy: existing, created: false };
  run(
    db,
    'INSERT INTO manual_policies (policy_id, client_id, broker_id, insurer_name, type, expiry_date, annual_premium, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    input.policyId,
    input.clientId,
    input.brokerId,
    input.insurerName,
    input.type,
    input.expiryDate,
    input.annualPremium,
    clock.now().toISOString(),
  );
  return { policy: getManualPolicy(db, input.policyId) as ManualPolicyRow, created: true };
}

// ---- exports ----------------------------------------------------------------

export interface ExportRow {
  id: number;
  createdAt: string;
  kind: 'overview';
  filters: Record<string, unknown>;
  /** Relative to OUTPUT_DIR, '/' separators. */
  relativePath: string;
  contentHash: string;
  rowCount: number;
}

function toExport(row: Row): ExportRow {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    kind: 'overview',
    filters: JSON.parse(String(row.filters)) as Record<string, unknown>,
    relativePath: String(row.relative_path),
    contentHash: String(row.content_hash),
    rowCount: Number(row.row_count),
  };
}

export function insertExport(db: Db, clock: InstantClock, input: { filters: Record<string, unknown>; relativePath: string; contentHash: string; rowCount: number }): ExportRow {
  const id = run(
    db,
    "INSERT INTO exports (created_at, kind, filters, relative_path, content_hash, row_count) VALUES (?, 'overview', ?, ?, ?, ?)",
    clock.now().toISOString(),
    JSON.stringify(input.filters),
    input.relativePath,
    input.contentHash,
    input.rowCount,
  ).lastInsertRowid;
  return getExport(db, id) as ExportRow;
}

export function getExport(db: Db, id: number): ExportRow | undefined {
  const row = get(db, 'SELECT * FROM exports WHERE id = ?', id);
  return row ? toExport(row) : undefined;
}

export function getExportByHash(db: Db, contentHash: string): ExportRow | undefined {
  const row = get(db, 'SELECT * FROM exports WHERE content_hash = ?', contentHash);
  return row ? toExport(row) : undefined;
}

export function listExports(db: Db, limit = 20): ExportRow[] {
  return all(db, 'SELECT * FROM exports ORDER BY id DESC LIMIT ?', limit).map(toExport);
}
