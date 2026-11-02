// One case on the conveyor belt, shared by the nightly run and the upload door (Prompt 7, D-F):
// document check -> idempotency -> read terms -> compare -> write pack -> ONE save transaction -> audit.
// Moved out of runPipeline without behaviour change (same audit events in the same order, same outcomes,
// the failure-keeps-old-pack rule). updateRenewalStatus is NEVER called here.

import { readdirSync, rmdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { COMPARE_RULES_VERSION, type CompareConfig, compareTerms } from '../compare/compareTerms.js';
import { buildSummary } from '../compare/summary.js';
import type { DocumentPaths } from '../data/datasource.js';
import { cycleKey as makeCycleKey, type InstantClock } from '../domain/dates.js';
import { DocumentMissingError, DocumentUnreadableError, LlmOutputInvalidError } from '../domain/errors.js';
import type { Broker, Client, IsoDate, Pack, Policy, Severity } from '../domain/types.js';
import type { ReadPolicyTermsResult } from '../documents/index.js';
import { EXTRACT_PROMPT_VERSION } from '../documents/prompts/extractTerms.js';
import { TEMPLATE_VERSION } from '../outputs/templates/emailTemplates.js';
import { buildSummaryText, type PackPaths, writePack } from '../outputs/writePack.js';
import type { AuditActor, AuditLog } from '../state/audit.js';
import { type Db, transaction } from '../state/db.js';
import {
  type CaseOrigin,
  type CaseRow,
  getActivePack,
  getCaseByCycleKey,
  type InputSource,
  insertCase,
  insertPack,
  supersedePack,
  transitionCase,
  updateCaseFields,
} from '../state/repo.js';
import { computeInputHash } from './inputHash.js';
import type { TermsReader } from './readers.js';

export const RUN_OUTCOMES = [
  'new_pack',
  'new_version',
  'unchanged_skip',
  'needs_attention',
  'skipped_outside_window',
  'skipped_already_processed',
  'failed_kept_previous',
  // ADDITION (Prompt 5, D-129): the failure itself could not be saved (database busy/locked).
  // Nothing was written for the policy; it is picked up again by the next run.
  'failed_not_saved',
] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export interface RunRow {
  policyId: string;
  outcome: RunOutcome;
  cycleKey: string;
  overallRisk?: Severity;
  version?: number;
  durationMs: number;
  tokens: { inputTokens: number; outputTokens: number };
  fromCache?: boolean;
  /** Short reason or dry-run note, e.g. "renewal document missing", "would extract (not cached)". */
  note?: string;
}

export interface NewPackInfo {
  packId: number;
  caseId: number;
  policyId: string;
  cycleKey: string;
  version: number;
  supersededPackId: number | null;
}

export interface NoticeCaseInfo {
  caseId: number;
  policyId: string;
  cycleKey: string;
  reason: string;
}

export interface ProcessCaseDeps {
  db: Db;
  audit: AuditLog;
  reader: TermsReader;
  clock: InstantClock;
  compareConfig: CompareConfig;
  outputDir: string;
  templatePath?: string;
  /** Test-only fault injection inside the save transaction. */
  beforeCommit?: (policyId: string) => void;
  /** Last-resort channel when even the audit log cannot be written (Prompt 5, D-129). Default: process.stderr. */
  stderr?: (line: string) => void;
}

/** Terms already read by the caller (the upload service reads first for its U-2 checks). */
export interface PreReadTerms {
  expiring: ReadPolicyTermsResult;
  renewal: ReadPolicyTermsResult;
}

export interface ProcessCaseInput {
  policy: Policy;
  /** undefined = record missing; the case then fails exactly as before (after the read, before the pack). */
  client: Client | undefined;
  broker: Broker | undefined;
  /** Absolute paths; either may be missing. */
  paths: DocumentPaths;
  origin: CaseOrigin;
  inputSource: InputSource;
  /** Run date written into the pack. */
  today: IsoDate;
  runId: string | null;
  /** Rerun even when unchanged, approved or skipped (CLI --force --only, or an explicit upload). */
  forced: boolean;
  /** U-4: leave a case alone when its active pack came from an upload (the nightly run sets this). */
  respectUploadOverride?: boolean;
  preRead?: PreReadTerms;
  actor?: AuditActor;
}

export interface ProcessCaseResult {
  row: RunRow;
  newPack?: NewPackInfo;
  notice?: NoticeCaseInfo;
  /** Prompt 5 (D-129): a failure whose audit could not be written at the time; the run retries it at the end. */
  unrecorded?: { policyId: string; cycleKey: string; reason: string; error: string };
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 160);

function defaultStderr(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Remove a version folder the database never recorded. Only inside OUTPUT_DIR; failures go to stderr (Prompt 5). */
function removeOrphanFolder(deps: ProcessCaseDeps, relativeDir: string): void {
  try {
    const root = path.resolve(deps.outputDir);
    const target = path.resolve(root, ...relativeDir.split('/'));
    const rel = path.relative(root, target);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return;
    rmSync(target, { recursive: true, force: true });
    // Then any parent folder this left empty (policy / client / date), never OUTPUT_DIR itself.
    for (let dir = path.dirname(target); dir !== root && path.relative(root, dir) !== '' && !path.relative(root, dir).startsWith('..'); dir = path.dirname(dir)) {
      if (readdirSync(dir).length > 0) break;
      rmdirSync(dir);
    }
  } catch (error) {
    (deps.stderr ?? defaultStderr)(`[autopilot] could not remove unsaved pack folder ${relativeDir}: ${errorText(error)}`);
  }
}

export const MANUAL_OVERRIDE_REASON = 'manual_override_in_place';

/** Deterministic causes (missing/unreadable document) are remembered via the input hash; transient ones are retried. */
export function attentionReasonFor(error: unknown): { reason: string; deterministic: boolean } {
  if (error instanceof DocumentMissingError) return { reason: `${error.documentKind} document missing`, deterministic: true };
  if (error instanceof DocumentUnreadableError) {
    // FIX (Prompt 5): a damaged file is not a scan; say which it is (found by the corrupted-PDF failure test).
    const damaged = error.reason.startsWith('the PDF could not be parsed');
    return { reason: damaged ? 'document could not be read (damaged file or not a PDF)' : 'document has no readable text (image-only scan)', deterministic: true };
  }
  if (error instanceof LlmOutputInvalidError) return { reason: 'the AI reader returned invalid output', deterministic: false };
  const message = error instanceof Error ? error.message : String(error);
  return { reason: `unexpected error: ${message.slice(0, 160)}`, deterministic: false };
}

export function hashFor(reader: TermsReader, compareConfig: CompareConfig, paths: DocumentPaths): string {
  return computeInputHash({
    ...(paths.expiring ? { expiringPath: paths.expiring } : {}),
    ...(paths.renewal ? { renewalPath: paths.renewal } : {}),
    extractPromptVersion: EXTRACT_PROMPT_VERSION,
    modelName: reader.modelName,
    compareRulesVersion: COMPARE_RULES_VERSION,
    compareConfig,
    templateVersion: TEMPLATE_VERSION,
  });
}

interface CaseScope {
  deps: ProcessCaseDeps;
  policy: Policy;
  key: string;
  origin: CaseOrigin;
  runId: string | null;
  actor: AuditActor;
  started: number;
  tokens: { inputTokens: number; outputTokens: number };
  fromCache: boolean | undefined;
}

function scopeFor(deps: ProcessCaseDeps, input: { policy: Policy; origin: CaseOrigin; runId: string | null; actor?: AuditActor }): CaseScope {
  return {
    deps,
    policy: input.policy,
    key: makeCycleKey(input.policy.id, input.policy.expiryDate),
    origin: input.origin,
    runId: input.runId,
    actor: input.actor ?? 'system',
    started: deps.clock.now().getTime(),
    tokens: { inputTokens: 0, outputTokens: 0 },
    fromCache: undefined,
  };
}

function rowFor(scope: CaseScope, outcome: RunOutcome, extra: Partial<RunRow> = {}): RunRow {
  return {
    policyId: scope.policy.id,
    outcome,
    cycleKey: scope.key,
    durationMs: scope.deps.clock.now().getTime() - scope.started,
    tokens: scope.tokens,
    ...(scope.fromCache === undefined ? {} : { fromCache: scope.fromCache }),
    ...extra,
  };
}

function baseFor(scope: CaseScope) {
  return { runId: scope.runId ?? undefined, policyId: scope.policy.id, cycleKey: scope.key, actor: scope.actor };
}

/** The failure-keeps-old-pack rule: keep an existing pack, otherwise set needs_attention (once) with the reason. */
function recordFailure(scope: CaseScope, error: unknown, inputHash: string | undefined): ProcessCaseResult {
  const { deps } = scope;
  const { db, audit } = deps;
  const base = baseFor(scope);
  const runId = scope.runId ?? undefined;
  const { reason, deterministic } = attentionReasonFor(error);
  try {
    const existing = getCaseByCycleKey(db, scope.key);
    const active = existing ? getActivePack(db, existing.id) : undefined;
    if (existing && active) {
      audit.recordAudit({ ...base, type: 'policy_failed', details: { reason, keptVersion: active.version } });
      return { row: rowFor(scope, 'failed_kept_previous', { note: reason, version: active.version }) };
    }
    const newlyFlagged = transaction(db, () => {
      let caseRow = existing ?? insertCase(db, deps.clock, { policyId: scope.policy.id, cycleKey: scope.key, origin: scope.origin });
      const changed = caseRow.status !== 'needs_attention';
      if (changed) caseRow = transitionCase(db, deps.clock, audit, { caseRow, to: 'needs_attention', actor: scope.actor, ...(runId ? { runId } : {}), reason });
      updateCaseFields(db, deps.clock, caseRow.id, { attentionReason: reason, ...(deterministic && inputHash ? { inputHash } : {}) });
      audit.recordAudit({ ...base, type: 'needs_attention', details: { reason, retriedNextRun: !deterministic } });
      return changed ? caseRow : null;
    });
    return {
      row: rowFor(scope, 'needs_attention', { note: reason }),
      ...(newlyFlagged ? { notice: { caseId: newlyFlagged.id, policyId: scope.policy.id, cycleKey: scope.key, reason } } : {}),
    };
  } catch (stateError) {
    // FIX (Prompt 5, D-129): the database refused even the failure record (busy/locked after the
    // busy_timeout wait). The transaction rolled back, so nothing half-done remains; this policy is
    // NOT marked handled and the next run retries it. The audit is retried at run end, else stderr.
    const detail = errorText(stateError);
    (deps.stderr ?? defaultStderr)(`[autopilot] could not save the failure of ${scope.policy.id} (${scope.key}): ${detail}; failure was: ${reason}`);
    return {
      row: rowFor(scope, 'failed_not_saved', { note: `${reason}; not saved (${detail})` }),
      unrecorded: { policyId: scope.policy.id, cycleKey: scope.key, reason, error: detail },
    };
  }
}

/**
 * The case could not even be prepared (for example the data source failed while looking up its documents).
 * Same rule as a failure inside processCase.
 */
export function processCaseFailure(
  deps: ProcessCaseDeps,
  input: { policy: Policy; origin: CaseOrigin; runId: string | null; actor?: AuditActor },
  error: unknown,
): ProcessCaseResult {
  return recordFailure(scopeFor(deps, input), error, undefined);
}

export async function processCase(deps: ProcessCaseDeps, input: ProcessCaseInput): Promise<ProcessCaseResult> {
  const scope = scopeFor(deps, input);
  const { db, audit } = deps;
  const { policy, key, paths } = { policy: input.policy, key: scope.key, paths: input.paths };
  const base = baseFor(scope);
  let existing: CaseRow | undefined;
  let inputHash: string | undefined;

  try {
    // Inside the try (Prompt 5): a locked database here is a policy failure, not a crashed run.
    existing = getCaseByCycleKey(db, key);
    // a. Documents.
    audit.recordAudit({ ...base, type: 'documents_checked', details: { expiring: Boolean(paths.expiring), renewal: Boolean(paths.renewal) } });

    // U-4: an uploaded pack stays in place until the broker forces a rerun.
    if (input.respectUploadOverride && existing && !input.forced) {
      const active = getActivePack(db, existing.id);
      if (active && active.inputSource === 'upload') {
        audit.recordAudit({ ...base, type: 'unchanged_skip', details: { status: existing.status, version: existing.currentVersion, reason: MANUAL_OVERRIDE_REASON } });
        return { row: rowFor(scope, 'unchanged_skip', { version: existing.currentVersion || undefined, note: `manual upload in place (${existing.status})` }) };
      }
    }

    // b. Idempotency.
    inputHash = hashFor(deps.reader, deps.compareConfig, paths);
    if (existing && existing.inputHash === inputHash && !input.forced) {
      audit.recordAudit({ ...base, type: 'unchanged_skip', details: { status: existing.status, version: existing.currentVersion } });
      return { row: rowFor(scope, 'unchanged_skip', { version: existing.currentVersion || undefined, note: `unchanged (${existing.status})` }) };
    }
    if (existing && (existing.status === 'approved' || existing.status === 'skipped') && !input.forced) {
      // Defensive: processedCycleKeys already filters these out.
      return { row: rowFor(scope, 'skipped_already_processed') };
    }
    if (!paths.expiring) throw new DocumentMissingError(policy.id, 'expiring');
    if (!paths.renewal) throw new DocumentMissingError(policy.id, 'renewal');

    // c. Read both documents (or use the caller's reads).
    const expiring = input.preRead?.expiring ?? (await deps.reader.read(paths.expiring, { policyId: policy.id, kind: 'expiring' }));
    const renewal = input.preRead?.renewal ?? (await deps.reader.read(paths.renewal, { policyId: policy.id, kind: 'renewal' }));
    for (const [kind, result] of [['expiring', expiring], ['renewal', renewal]] as const) {
      scope.tokens.inputTokens += result.fromCache ? 0 : result.usage.inputTokens;
      scope.tokens.outputTokens += result.fromCache ? 0 : result.usage.outputTokens;
      audit.recordAudit({
        ...base,
        type: 'terms_extracted',
        details: {
          kind,
          fromCache: result.fromCache,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          warnings: result.warnings.length,
          // D-120: only when the second reading confirmed something (older audit rows stay identical).
          ...(result.repairedFields?.length ? { repaired: result.repairedFields.length } : {}),
        },
      });
    }
    scope.fromCache = expiring.fromCache && renewal.fromCache;

    // d. Compare and write the pack (files first; the database is the source of truth).
    const comparison = compareTerms(expiring.terms, renewal.terms, deps.compareConfig);
    const summaryOfChanges = buildSummary(comparison.diffs);
    audit.recordAudit({ ...base, type: 'comparison_done', details: { overallRisk: comparison.overallRisk, diffs: comparison.diffs.length, flags: comparison.flags.length } });

    const { client, broker } = input;
    if (!client || !broker) throw new Error(`client or broker record missing for ${policy.id}`);
    const version = (existing?.currentVersion ?? 0) + 1;
    // allowOverwrite: a folder for a version the database does not know is an orphan from a
    // failed save (see the transaction below); the database decides which versions exist.
    const written = await writePack({
      runDate: input.today,
      version,
      client,
      broker,
      policy,
      terms: { expiring: expiring.terms, renewal: renewal.terms },
      comparison,
      summary: summaryOfChanges,
      outputDir: deps.outputDir,
      ...(deps.templatePath ? { templatePath: deps.templatePath } : {}),
      allowOverwrite: true,
      ...(input.inputSource === 'upload' ? { uploaded: true } : {}),
    });
    audit.recordAudit({ ...base, type: 'pack_written', details: { version, contentHash: written.contentHash, dir: written.paths.dir } });

    const pack: Pack = {
      cycleKey: key,
      version,
      policyId: policy.id,
      diffs: comparison.diffs,
      flags: comparison.flags,
      xlsxPath: written.paths.xlsx,
      clientEmlPath: written.paths.clientEml,
      insurerEmlPath: written.paths.insurerEml,
      summaryText: buildSummaryText({ runDate: input.today, client, broker, policy, comparison, summary: summaryOfChanges }),
      contentHash: written.contentHash,
      createdAt: deps.clock.now().toISOString(),
    };

    // e. ONE transaction: pack row, supersede, case fields, status transitions, audits.
    let saved: NewPackInfo;
    try {
      saved = commitPack(scope, { existing, inputHash, version, pack, paths: written.paths, inputSource: input.inputSource });
    } catch (commitError) {
      // FIX (Prompt 5): the database does not know this version, so its folder would be a half-written
      // pack on disk. Remove it (best effort) before reporting the failure (found by the lock failure test).
      removeOrphanFolder(deps, written.paths.dir);
      throw commitError;
    }
    return { row: rowFor(scope, version === 1 ? 'new_pack' : 'new_version', { version, overallRisk: comparison.overallRisk }), newPack: saved };
  } catch (error) {
    return recordFailure(scope, error, inputHash);
  }
}

function commitPack(
  scope: CaseScope,
  input: { existing: CaseRow | undefined; inputHash: string; version: number; pack: Pack; paths: PackPaths; inputSource: InputSource },
): NewPackInfo {
  const { deps, policy, key } = scope;
  const { db, audit } = deps;
  const runId = scope.runId ?? undefined;
  const base = baseFor(scope);
  return transaction(db, () => {
    deps.beforeCommit?.(policy.id);
    let caseRow = input.existing ?? insertCase(db, deps.clock, { policyId: policy.id, cycleKey: key, origin: scope.origin });
    const previous = getActivePack(db, caseRow.id);
    if (previous) {
      supersedePack(db, previous.id);
      audit.recordAudit({ ...base, type: 'pack_superseded', details: { oldVersion: previous.version, newVersion: input.version } });
    }
    const packRow = insertPack(db, deps.clock, {
      caseId: caseRow.id,
      version: input.version,
      contentHash: input.pack.contentHash,
      inputHash: input.inputHash,
      paths: input.paths,
      pack: input.pack,
      runId: scope.runId,
      inputSource: input.inputSource,
    });
    updateCaseFields(db, deps.clock, caseRow.id, { inputHash: input.inputHash, currentVersion: input.version, attentionReason: null });
    const move = (to: 'drafted' | 'in_review', force = false) => {
      caseRow = transitionCase(db, deps.clock, audit, { caseRow, to, actor: scope.actor, ...(runId ? { runId } : {}), force });
    };
    if (caseRow.status === 'approved' || caseRow.status === 'skipped') {
      audit.recordAudit({ ...base, type: 'forced_rerun', details: { from: caseRow.status, version: input.version } });
      move('drafted', true);
    }
    if (caseRow.status === 'not_started' || caseRow.status === 'needs_attention') move('drafted');
    if (caseRow.status === 'drafted') move('in_review');
    // A case already in_review stays in_review; only the old PACK is superseded (D-062).
    return { packId: packRow.id, caseId: caseRow.id, policyId: policy.id, cycleKey: key, version: input.version, supersededPackId: previous?.id ?? null };
  });
}
