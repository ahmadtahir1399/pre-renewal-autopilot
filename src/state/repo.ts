// Typed access to cases, packs, runs and approvals. Status changes go through
// transitionCase, which checks the status machine and ALWAYS writes an audit event.

import type { InstantClock } from '../domain/dates.js';
import { PackSchema } from '../domain/schemas.js';
import type { Pack, RenewalStatus } from '../domain/types.js';
import type { PackPaths } from '../outputs/writePack.js';
import type { AuditActor, AuditLog } from './audit.js';
import { all, type Db, get, type Row, run } from './db.js';
import { assertTransition } from './statusMachine.js';

export type PackStatus = 'active' | 'superseded';
export type SyncState = 'ok' | 'status_sync_failed' | 'copy_failed';
/** Prompt 7 (D-F): where a case came from, and where a pack's documents came from. */
export type CaseOrigin = 'data_source' | 'manual';
export type InputSource = 'data_source' | 'upload';

export interface CaseRow {
  id: number;
  policyId: string;
  cycleKey: string;
  status: RenewalStatus;
  inputHash: string | null;
  currentVersion: number;
  attentionReason: string | null;
  origin: CaseOrigin;
  createdAt: string;
  updatedAt: string;
}

export interface PackRow {
  id: number;
  caseId: number;
  version: number;
  status: PackStatus;
  contentHash: string;
  inputHash: string;
  /** Relative to OUTPUT_DIR, '/' separators (D-057). */
  paths: PackPaths;
  pack: Pack;
  runId: string | null;
  syncState: SyncState;
  inputSource: InputSource;
  createdAt: string;
}

const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

function toCase(row: Row): CaseRow {
  return {
    id: Number(row.id),
    policyId: String(row.policy_id),
    cycleKey: String(row.cycle_key),
    status: String(row.status) as RenewalStatus,
    inputHash: text(row.input_hash),
    currentVersion: Number(row.current_version),
    attentionReason: text(row.attention_reason),
    origin: row.origin === 'manual' ? 'manual' : 'data_source',
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function toPack(row: Row): PackRow {
  return {
    id: Number(row.id),
    caseId: Number(row.case_id),
    version: Number(row.version),
    status: String(row.status) as PackStatus,
    contentHash: String(row.content_hash),
    inputHash: String(row.input_hash),
    paths: JSON.parse(String(row.paths)) as PackPaths,
    pack: PackSchema.parse(JSON.parse(String(row.pack_json))),
    runId: text(row.run_id),
    syncState: String(row.sync_state) as SyncState,
    inputSource: row.input_source === 'upload' ? 'upload' : 'data_source',
    createdAt: String(row.created_at),
  };
}

// ---- cases ----------------------------------------------------------------

export function getCaseByCycleKey(db: Db, cycleKey: string): CaseRow | undefined {
  const row = get(db, 'SELECT * FROM cases WHERE cycle_key = ?', cycleKey);
  return row ? toCase(row) : undefined;
}

export function getCaseById(db: Db, id: number): CaseRow | undefined {
  const row = get(db, 'SELECT * FROM cases WHERE id = ?', id);
  return row ? toCase(row) : undefined;
}

export function listCases(db: Db): CaseRow[] {
  return all(db, 'SELECT * FROM cases ORDER BY policy_id, id').map(toCase);
}

/** Insert a new case. Normal cases start not_started; seeding may insert approved directly (D-064). */
export function insertCase(db: Db, clock: InstantClock, input: { policyId: string; cycleKey: string; status?: RenewalStatus; origin?: CaseOrigin }): CaseRow {
  const now = clock.now().toISOString();
  const id = run(
    db,
    'INSERT INTO cases (policy_id, cycle_key, status, current_version, origin, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
    input.policyId,
    input.cycleKey,
    input.status ?? 'not_started',
    input.origin ?? 'data_source',
    now,
    now,
  ).lastInsertRowid;
  return getCaseById(db, id) as CaseRow;
}

export interface TransitionInput {
  caseRow: CaseRow;
  to: RenewalStatus;
  actor: AuditActor;
  runId?: string;
  force?: boolean;
  reason?: string;
}

/** Check the status machine, update the case, and audit 'status_changed'. Returns the updated case. */
export function transitionCase(db: Db, clock: InstantClock, audit: AuditLog, input: TransitionInput): CaseRow {
  const { caseRow, to } = input;
  assertTransition(caseRow.policyId, caseRow.status, to, { force: input.force === true });
  run(db, 'UPDATE cases SET status = ?, updated_at = ? WHERE id = ?', to, clock.now().toISOString(), caseRow.id);
  audit.recordAudit({
    type: 'status_changed',
    actor: input.actor,
    policyId: caseRow.policyId,
    cycleKey: caseRow.cycleKey,
    ...(input.runId ? { runId: input.runId } : {}),
    details: { from: caseRow.status, to, ...(input.force ? { forced: true } : {}), ...(input.reason ? { reason: input.reason } : {}) },
  });
  return { ...caseRow, status: to };
}

export function updateCaseFields(
  db: Db,
  clock: InstantClock,
  caseId: number,
  fields: { inputHash?: string; currentVersion?: number; attentionReason?: string | null },
): void {
  const current = getCaseById(db, caseId);
  if (!current) throw new Error(`Unknown case ${caseId}`);
  run(
    db,
    'UPDATE cases SET input_hash = ?, current_version = ?, attention_reason = ?, updated_at = ? WHERE id = ?',
    fields.inputHash ?? current.inputHash,
    fields.currentVersion ?? current.currentVersion,
    fields.attentionReason === undefined ? current.attentionReason : fields.attentionReason,
    clock.now().toISOString(),
    caseId,
  );
}

/** Cycles that must not be processed again: approved or skipped cases. */
export function processedCycleKeys(db: Db | null): Set<string> {
  if (!db) return new Set();
  return new Set(all(db, "SELECT cycle_key FROM cases WHERE status IN ('approved', 'skipped')").map((row) => String(row.cycle_key)));
}

// ---- packs ----------------------------------------------------------------

export function insertPack(
  db: Db,
  clock: InstantClock,
  input: { caseId: number; version: number; contentHash: string; inputHash: string; paths: PackPaths; pack: Pack; runId: string | null; inputSource?: InputSource },
): PackRow {
  const pack = PackSchema.parse(input.pack);
  const id = run(
    db,
    "INSERT INTO packs (case_id, version, status, content_hash, input_hash, paths, pack_json, run_id, sync_state, input_source, created_at) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, 'ok', ?, ?)",
    input.caseId,
    input.version,
    input.contentHash,
    input.inputHash,
    JSON.stringify(input.paths),
    JSON.stringify(pack),
    input.runId,
    input.inputSource ?? 'data_source',
    clock.now().toISOString(),
  ).lastInsertRowid;
  return getPackById(db, id) as PackRow;
}

export function getPackById(db: Db, id: number): PackRow | undefined {
  const row = get(db, 'SELECT * FROM packs WHERE id = ?', id);
  return row ? toPack(row) : undefined;
}

export function getActivePack(db: Db, caseId: number): PackRow | undefined {
  const row = get(db, "SELECT * FROM packs WHERE case_id = ? AND status = 'active'", caseId);
  return row ? toPack(row) : undefined;
}

export function listPacks(db: Db): PackRow[] {
  return all(db, 'SELECT * FROM packs ORDER BY case_id, version').map(toPack);
}

export function supersedePack(db: Db, packId: number): void {
  run(db, "UPDATE packs SET status = 'superseded' WHERE id = ?", packId);
}

export function setPackSyncState(db: Db, packId: number, state: SyncState): void {
  run(db, 'UPDATE packs SET sync_state = ? WHERE id = ?', state, packId);
}

// ---- runs -----------------------------------------------------------------

export function insertRun(db: Db, clock: InstantClock, input: { id: string; today: string; dryRun: boolean; status: 'running' | 'blocked' }): void {
  const now = clock.now().toISOString();
  run(db, 'INSERT INTO runs (id, today, dry_run, status, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', input.id, input.today, input.dryRun ? 1 : 0, input.status, now, now);
}

export function finishRun(db: Db, clock: InstantClock, id: string, status: 'finished' | 'failed' | 'blocked', summary: unknown): void {
  run(db, 'UPDATE runs SET status = ?, finished_at = ?, summary_json = ? WHERE id = ?', status, clock.now().toISOString(), JSON.stringify(summary), id);
}

export function getRun(db: Db, id: string): Row | undefined {
  return get(db, 'SELECT * FROM runs WHERE id = ?', id);
}

// ---- approvals ------------------------------------------------------------

export function insertApproval(db: Db, clock: InstantClock, input: { packId: number; action: 'approve' | 'skip'; actor: string; channel: string }): void {
  const now = clock.now().toISOString();
  run(db, 'INSERT INTO approvals (pack_id, action, actor, channel, at, created_at) VALUES (?, ?, ?, ?, ?, ?)', input.packId, input.action, input.actor, input.channel, now, now);
}

export function getApprovalForPack(db: Db, packId: number): Row | undefined {
  return get(db, 'SELECT * FROM approvals WHERE pack_id = ? ORDER BY id LIMIT 1', packId);
}
