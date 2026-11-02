// The shared, channel-independent approval core (D-E). Web, Telegram and the CLI all call
// handleAction. Every action is validated here, server-side. Nothing counts until a person signs.
// updateRenewalStatus is called ONLY here (after an Approve) and in retrySync of that approval, and
// NEVER for a manual-origin case (rule U-1, Prompt 7): those approvals live in the database only.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DataSource } from '../data/datasource.js';
import type { InstantClock } from '../domain/dates.js';
import { describeField } from '../compare/format.js';
import { type AuditActor, createAuditLog } from '../state/audit.js';
import { all, type Db, transaction } from '../state/db.js';
import {
  getActivePack,
  getApprovalForPack,
  getCaseById,
  getPackById,
  insertApproval,
  type PackRow,
  setPackSyncState,
  transitionCase,
} from '../state/repo.js';
import type { ActionHandler, ActionRequest, ActionResult } from './notifier.js';

export interface ApprovalCoreDeps {
  db: Db;
  clock: InstantClock;
  dataSource: DataSource;
  outputDir: string;
  /** Chat ids allowed to act through Telegram (TELEGRAM_ALLOWED_CHAT_IDS). */
  allowedTelegramChatIds: readonly string[];
  /** Injectable for tests (copy failures). */
  copyFile?: (from: string, to: string) => void;
}

export interface RetrySyncResult {
  packId: number;
  policyId: string;
  ok: boolean;
  error?: string;
}

export interface ApprovalCore {
  handleAction: ActionHandler;
  retrySync(): Promise<RetrySyncResult[]>;
  /** During shutdown: refuse new actions. */
  stopAccepting(): void;
}

export function isAllowedActor(actor: AuditActor, allowedTelegramChatIds: readonly string[]): boolean {
  if (actor === 'broker:web' || actor === 'broker:cli') return true;
  if (actor.startsWith('broker:telegram:')) return allowedTelegramChatIds.includes(actor.slice('broker:telegram:'.length));
  return false;
}

/** Resolve a stored relative path (D-057) under a root and refuse anything that escapes it. */
export function resolveInside(root: string, relative: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, ...relative.split('/'));
  const rel = path.relative(base, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Stored path escapes the output directory');
  return target;
}

const FILES_TO_COPY = ['xlsx', 'clientEml', 'insurerEml'] as const;

/** U-1: the audit wording when an approval does not touch the data source. */
export const MANUAL_CASE_SYNC_NOTE = 'data source not applicable (manual case)';

export function createApprovalCore(deps: ApprovalCoreDeps): ApprovalCore {
  const { db, clock } = deps;
  const audit = createAuditLog(db, clock);
  const copy = deps.copyFile ?? ((from: string, to: string) => copyFileSync(from, to));
  let accepting = true;

  const refuse = (request: ActionRequest, result: ActionResult, type: 'approval_ignored' | 'unauthorised_attempt', pack?: PackRow, policyId?: string): ActionResult => {
    audit.recordAudit({
      type,
      actor: request.actor,
      ...(policyId ? { policyId } : {}),
      ...(pack ? { cycleKey: pack.pack.cycleKey } : {}),
      details: { action: request.action, packId: request.packId, channel: request.channel, result: result.kind },
    });
    return result;
  };

  function copyApproved(pack: PackRow): void {
    for (const key of FILES_TO_COPY) {
      const relative = pack.paths[key];
      const from = resolveInside(deps.outputDir, relative);
      const to = resolveInside(deps.outputDir, `approved/${relative}`);
      mkdirSync(path.dirname(to), { recursive: true });
      copy(from, to);
    }
  }

  async function syncAfterApproval(pack: PackRow, policyId: string, actor: AuditActor, manual: boolean): Promise<boolean> {
    let ok = true;
    try {
      copyApproved(pack);
    } catch (error) {
      ok = false;
      setPackSyncState(db, pack.id, 'copy_failed');
      audit.recordAudit({ type: 'copy_failed', actor, policyId, cycleKey: pack.pack.cycleKey, details: { packId: pack.id, error: message(error) } });
    }
    if (manual) {
      // U-1: a manual case has no data-source record to update.
      if (ok) setPackSyncState(db, pack.id, 'ok');
      return ok;
    }
    try {
      await deps.dataSource.updateRenewalStatus(policyId, 'approved');
    } catch (error) {
      if (ok) setPackSyncState(db, pack.id, 'status_sync_failed');
      ok = false;
      audit.recordAudit({ type: 'status_sync_failed', actor, policyId, cycleKey: pack.pack.cycleKey, details: { packId: pack.id, error: message(error) } });
    }
    if (ok) setPackSyncState(db, pack.id, 'ok');
    return ok;
  }

  const handleAction: ActionHandler = async (request) => {
    const base = { packId: request.packId };
    if (!accepting) return { kind: 'not_allowed', ...base, message: 'The service is shutting down; try again in a moment.' };
    if (!isAllowedActor(request.actor, deps.allowedTelegramChatIds)) {
      return refuse(request, { kind: 'not_allowed', ...base, message: 'You are not allowed to act on renewals.' }, 'unauthorised_attempt');
    }
    const pack = Number.isInteger(request.packId) ? getPackById(db, request.packId) : undefined;
    if (!pack) return refuse(request, { kind: 'not_found', ...base, message: 'No such pack.' }, 'approval_ignored');
    const caseRow = getCaseById(db, pack.caseId);
    if (!caseRow) return refuse(request, { kind: 'not_found', ...base, message: 'No such pack.' }, 'approval_ignored', pack);
    if (pack.status !== 'active') {
      const current = getActivePack(db, caseRow.id)?.version ?? caseRow.currentVersion;
      return refuse(request, { kind: 'superseded', ...base, currentVersion: current, message: `This pack was replaced by version ${current}.` }, 'approval_ignored', pack, caseRow.policyId);
    }

    if (request.action === 'open') {
      // Open changes NO state. The path comes from the database, checked to stay inside OUTPUT_DIR.
      const xlsxPath = resolveInside(deps.outputDir, pack.paths.xlsx);
      audit.recordAudit({ type: 'opened', actor: request.actor, policyId: caseRow.policyId, cycleKey: caseRow.cycleKey, details: { packId: pack.id, channel: request.channel } });
      return {
        kind: 'ok',
        action: 'open',
        ...base,
        message: 'Opening the comparison spreadsheet.',
        xlsxPath,
        flagged: pack.pack.flags.slice(0, 5).map((f) => `[${f.severity.toUpperCase()}] ${describeField(f.field)}`),
      };
    }

    const wanted = request.action === 'approve' ? 'approved' : 'skipped';
    const previous = getApprovalForPack(db, pack.id);
    if (caseRow.status === 'approved' || caseRow.status === 'skipped') {
      if (previous && caseRow.status === wanted) {
        return refuse(request, { kind: 'already_done', ...base, decision: wanted, message: `Already ${wanted}. Nothing changed.` }, 'approval_ignored', pack, caseRow.policyId);
      }
    }
    if (caseRow.status !== 'in_review') {
      return refuse(request, { kind: 'wrong_state', ...base, status: caseRow.status, message: `This renewal is ${caseRow.status}, so it cannot be ${wanted}.` }, 'approval_ignored', pack, caseRow.policyId);
    }

    const manual = caseRow.origin === 'manual';
    // One transaction: status change + approvals row + audit.
    transaction(db, () => {
      const fresh = getCaseById(db, caseRow.id);
      if (fresh?.status !== 'in_review') throw new Error('The renewal changed state while the action was running');
      transitionCase(db, clock, audit, { caseRow: fresh, to: wanted, actor: request.actor });
      insertApproval(db, clock, { packId: pack.id, action: request.action === 'approve' ? 'approve' : 'skip', actor: request.actor, channel: request.channel });
      audit.recordAudit({
        type: wanted,
        actor: request.actor,
        policyId: caseRow.policyId,
        cycleKey: caseRow.cycleKey,
        details: { packId: pack.id, version: pack.version, channel: request.channel, ...(manual && wanted === 'approved' ? { dataSource: MANUAL_CASE_SYNC_NOTE } : {}) },
      });
    });

    if (request.action === 'skip') {
      // Skip does NOT write to the data source: it only ever receives 'approved' (D-076).
      return { kind: 'ok', action: 'skip', ...base, message: 'Skipped. No drafts were saved and the data source was not changed.' };
    }
    // Only now, after the tap: copy the drafts and update the one writable field.
    const synced = await syncAfterApproval(pack, caseRow.policyId, request.actor, manual);
    if (manual) {
      return {
        kind: 'ok',
        action: 'approve',
        ...base,
        message: synced
          ? 'Approved. The drafts were saved. This case was uploaded by hand, so no data-source record was changed. Nothing was sent.'
          : 'Approved. Saving the drafts failed; run retry-sync. Nothing was sent.',
      };
    }
    return {
      kind: 'ok',
      action: 'approve',
      ...base,
      message: synced
        ? 'Approved. The drafts were saved and the renewal status was updated. Nothing was sent.'
        : 'Approved. Saving the drafts or updating the renewal status failed; run retry-sync. Nothing was sent.',
    };
  };

  async function retrySync(): Promise<RetrySyncResult[]> {
    const rows = all(
      db,
      "SELECT p.id AS id, c.policy_id AS policy_id, c.origin AS origin FROM packs p JOIN cases c ON c.id = p.case_id WHERE p.sync_state != 'ok' AND c.status = 'approved' ORDER BY p.id",
    );
    const results: RetrySyncResult[] = [];
    for (const row of rows) {
      const pack = getPackById(db, Number(row.id)) as PackRow;
      const policyId = String(row.policy_id);
      let error: string | undefined;
      try {
        const missingCopy = FILES_TO_COPY.some((key) => !existsSync(resolveInside(deps.outputDir, `approved/${pack.paths[key]}`)));
        if (missingCopy) copyApproved(pack);
        // U-1: never for a manual case.
        if (row.origin !== 'manual') await deps.dataSource.updateRenewalStatus(policyId, 'approved');
        setPackSyncState(db, pack.id, 'ok');
      } catch (caught) {
        error = message(caught);
      }
      audit.recordAudit({ type: 'status_sync_retried', actor: 'broker:cli', policyId, cycleKey: pack.pack.cycleKey, details: { packId: pack.id, result: error ? 'failed' : 'ok', ...(error ? { error } : {}) } });
      results.push({ packId: pack.id, policyId, ok: !error, ...(error ? { error } : {}) });
    }
    return results;
  }

  return {
    handleAction,
    retrySync,
    stopAccepting: () => {
      accepting = false;
    },
  };
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
