// The logbook. Every action writes an audit event (non-negotiable rule 6).
// Details are small JSON and never contain secrets, tokens or document text (guarded).

import { isSecretKey } from '../config/logger.js';
import type { InstantClock } from '../domain/dates.js';
import { all, type Db, run } from './db.js';

export const AUDIT_EVENT_TYPES = [
  'run_started',
  'run_finished',
  'run_blocked_pause',
  'policy_skipped_outside_window',
  'policy_skipped_already_processed',
  'documents_checked',
  'terms_extracted',
  'comparison_done',
  'pack_written',
  'status_changed',
  'needs_attention',
  'unchanged_skip',
  'pack_superseded',
  'notification_sent',
  'notification_failed',
  'reminder_sent',
  'approved',
  'skipped',
  'approval_ignored',
  'unauthorised_attempt',
  'status_sync_failed',
  'status_sync_retried',
  'forced_rerun',
  'demo_reset',
  'seeded',
  // ADDITIONS (D-063): a run-level failure, a policy failure that kept the previous pack,
  // and a light note when a broker opens a pack.
  'run_failed',
  'policy_failed',
  'run_skipped_overlap',
  'opened',
  // ADDITION (D-077): the approved drafts could not be copied to output/approved.
  'copy_failed',
  // Prompt 7 (D-F): manual upload, analysis and overview spreadsheets. Details: hashes (first 12 hex),
  // sizes, page counts and codes only; never filenames, document text or tokens.
  'upload_received',
  'upload_rejected',
  'analysis_started',
  'analysis_finished',
  'analysis_failed',
  'analysis_interrupted',
  'manual_case_created',
  'manual_override_set',
  'overview_created',
  'upload_deleted',
  'upload_purged',
  // ADDITION (Prompt 5, D-129): a policy failure that could not be saved at the time (database
  // busy/locked), written at the end of the run.
  'policy_not_saved',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditActor = 'system' | 'broker:web' | 'broker:cli' | `broker:telegram:${string}`;

export type AuditDetails = Record<string, string | number | boolean | null | string[] | number[]>;

export interface AuditInput {
  type: AuditEventType;
  runId?: string;
  policyId?: string;
  cycleKey?: string;
  actor: AuditActor;
  details?: AuditDetails;
}

export interface AuditEvent {
  id: number;
  at: string;
  type: AuditEventType;
  runId: string | null;
  policyId: string | null;
  cycleKey: string | null;
  actor: string;
  details: AuditDetails;
}

export const MAX_DETAILS_JSON = 2000;
export const MAX_DETAIL_STRING = 300;
const SECRET_VALUE_PATTERNS = [/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/, /\bsk-[A-Za-z0-9_-]{16,}\b/, /\bBearer\s+\S+/i];

export class AuditDetailsRejectedError extends Error {
  constructor(readonly reason: string) {
    super(`Audit details rejected: ${reason}`);
    this.name = 'AuditDetailsRejectedError';
  }
}

/** Guard: small, no secret-looking keys or values, no long strings (document text). */
export function assertSafeDetails(details: AuditDetails): void {
  const json = JSON.stringify(details);
  if (json.length > MAX_DETAILS_JSON) throw new AuditDetailsRejectedError(`details are ${json.length} characters (max ${MAX_DETAILS_JSON})`);
  for (const [key, value] of Object.entries(details)) {
    // A secret-looking KEY is rejected when it carries text; numbers (e.g. inputTokens counts) cannot hold a secret.
    const carriesText = typeof value === 'string' || (Array.isArray(value) && value.some((v) => typeof v === 'string'));
    if (isSecretKey(key) && carriesText) throw new AuditDetailsRejectedError(`key "${key}" looks like a secret`);
    const strings = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [];
    for (const text of strings) {
      if (text.length > MAX_DETAIL_STRING) throw new AuditDetailsRejectedError(`value of "${key}" is too long to be a detail (${text.length} chars)`);
      if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text))) throw new AuditDetailsRejectedError(`value of "${key}" looks like a secret`);
    }
  }
}

export interface AuditLog {
  recordAudit(input: AuditInput): number;
  listAudit(policyId: string): AuditEvent[];
}

function toEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: Number(row.id),
    at: String(row.at),
    type: String(row.type) as AuditEventType,
    runId: row.run_id === null ? null : String(row.run_id),
    policyId: row.policy_id === null ? null : String(row.policy_id),
    cycleKey: row.cycle_key === null ? null : String(row.cycle_key),
    actor: String(row.actor),
    details: JSON.parse(String(row.details)) as AuditDetails,
  };
}

export function createAuditLog(db: Db, clock: InstantClock): AuditLog {
  return {
    recordAudit(input) {
      if (!(AUDIT_EVENT_TYPES as readonly string[]).includes(input.type)) throw new AuditDetailsRejectedError(`unknown event type "${input.type}"`);
      const details = input.details ?? {};
      assertSafeDetails(details);
      const at = clock.now().toISOString();
      return run(
        db,
        'INSERT INTO audit_events (at, type, run_id, policy_id, cycle_key, actor, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        at,
        input.type,
        input.runId ?? null,
        input.policyId ?? null,
        input.cycleKey ?? null,
        input.actor,
        JSON.stringify(details),
        at,
      ).lastInsertRowid;
    },
    listAudit(policyId) {
      return all(db, 'SELECT * FROM audit_events WHERE policy_id = ? ORDER BY id', policyId).map(toEvent);
    },
  };
}

/** Every audit row (tests and the token scan). */
export function listAllAudit(db: Db): AuditEvent[] {
  return all(db, 'SELECT * FROM audit_events ORDER BY id').map(toEvent);
}
