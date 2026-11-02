// The second loading door onto the SAME conveyor belt (Prompt 7, D-F). analyseUpload checks the visit, stores
// the PDFs, reads them with the same reader the nightly run uses (cache on in live mode; the known-document
// registry in fake mode), applies the U-2 identity checks, then hands the case to processCase with
// inputSource 'upload'. Every step updates the job and writes an audit event. Nothing is ever sent.
// U-1: nothing here writes to the data source (it is only READ: policies, clients, brokers, documents).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { CompareConfig } from '../compare/compareTerms.js';
import type { DataSource, DocumentPaths } from '../data/datasource.js';
import { cycleKey as makeCycleKey, type InstantClock } from '../domain/dates.js';
import { DocumentUnreadableError, LlmOutputInvalidError } from '../domain/errors.js';
import type { Broker, Client, IsoDate, Policy } from '../domain/types.js';
import type { ReadPolicyTermsResult } from '../documents/index.js';
import { type NewPackInfo, type NoticeCaseInfo, processCase, type RunOutcome } from '../pipeline/processCase.js';
import type { TermsReader } from '../pipeline/readers.js';
import { type AuditActor, type AuditLog, createAuditLog } from '../state/audit.js';
import type { Db } from '../state/db.js';
import { LockHeldError } from '../state/lockFile.js';
import { getActivePack, getCaseByCycleKey, transitionCase, updateCaseFields } from '../state/repo.js';
import { acquireRunGate } from '../state/runGate.js';
import { isRejectionCode, messageFor, type UploadErrorCode, type UploadFailureCode, UploadRejectedError, type UploadRejectionCode } from './errors.js';
import { checkIdentity } from './identity.js';
import { type IncomingFile, resolveStoredPath, newStorageId, storeValidatedPdf, type UploadLimits, type ValidatedPdf, validatePdfUpload } from './intake.js';
import type { KnownDocumentRegistry } from './knownDocuments.js';
import { DEFAULT_CONTACT_EMAIL, DEFAULT_CONTACT_NAME, isManualPolicyId, manualPolicyToPolicy } from './manualSource.js';
import { UPLOAD_MODES, type UploadMode, type UploadSide } from './model.js';
import {
  countAnalysesStartedOnLocalDay,
  getUpload,
  insertStoredDocument,
  insertUpload,
  listRunningUploads,
  manualPolicyId,
  saveUploadTerms,
  setUploadDocuments,
  setUploadPolicyId,
  transitionUpload,
  type UploadRow,
  upsertManualClient,
  upsertManualPolicy,
} from './repo.js';

export interface UploadFileInput {
  bytes: Uint8Array;
  /** Display only; sanitised; never part of a path. */
  clientFilename?: string;
}

export interface NewPolicyInput {
  clientName: string;
  contactName?: string;
  contactEmail?: string;
  brokerId: string;
}

export interface AnalyseUploadRequest {
  mode: UploadMode;
  /** Attach mode: an existing data-source policy id. */
  policyId?: string;
  /** New mode: who the policy belongs to (the policy itself is read from the documents). */
  newPolicy?: NewPolicyInput;
  files: { expiring?: UploadFileInput; renewal?: UploadFileInput };
  /** U-7: the broker ticked 'These documents are made-up. Their contents are sent to the AI provider.' */
  consent: boolean;
  actor: AuditActor;
  /** Called once the job passed every door check and the reading starts (the web page redirects then). */
  onStarted?: (job: UploadRow) => void;
}

export interface AnalysisDeps {
  db: Db;
  clock: InstantClock;
  /** The RAW data source (read-only use). */
  dataSource: DataSource;
  /** null = live mode without LLM_API_KEY (ai_not_configured). */
  reader: TermsReader | null;
  /** FAKE MODE ONLY. When present, only documents it knows can be analysed. Never passed in live mode. */
  knownDocuments?: KnownDocumentRegistry;
  compareConfig: CompareConfig;
  outputDir: string;
  templatePath?: string;
  /** DATA_DIR/runtime (stored PDFs go to <runtimeDir>/uploads/<id>/<side>.pdf). */
  runtimeDir: string;
  /** The shared run lock: DATA_DIR/runtime/run.lock. */
  lockPath: string;
  timeZone: string;
  today: () => IsoDate;
  limits: UploadLimits;
  dailyLimit: number;
  timeoutMs: number;
  onPacksReady?: (packs: NewPackInfo[], noticeCases: NoticeCaseInfo[]) => Promise<void>;
}

export interface AnalysisResult {
  job: UploadRow;
  /** What processCase did (only when the job reached it). */
  outcome: RunOutcome | null;
  /** Plain-English summary for the web page and the CLI. Never document text. */
  message: string;
}

export const MAX_NAME_LENGTH = 100;
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const POLICY_ID = /^[a-z0-9-]{1,40}$/;

/** Name rule: 1-100 characters after trimming, no control, format (bidi) or line-break characters. */
export function isValidName(value: string | undefined): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && Array.from(trimmed).length <= MAX_NAME_LENGTH && !CONTROL.test(value);
}

/** Contact email: plain shape, no CR/LF or other control characters (it ends up in an email header), and
 * an @example.com address like every other email in this project (synthetic data only, D-012). */
export function isValidContactEmail(value: string): boolean {
  return value.length <= 254 && !CONTROL.test(value) && EMAIL.test(value) && value.toLowerCase().endsWith('@example.com');
}

const short = (sha256: string) => sha256.slice(0, 12);
const SIDES: readonly UploadSide[] = ['expiring', 'renewal'];

/** Jobs left in a running state by a stopped process: mark them failed 'interrupted' (call while holding the gate). */
export function recoverInterruptedUploads(db: Db, clock: InstantClock, options: { exceptId?: number; staleReceivedMs: number }): number[] {
  const audit = createAuditLog(db, clock);
  const now = clock.now().getTime();
  const recovered: number[] = [];
  for (const job of listRunningUploads(db)) {
    if (job.id === options.exceptId) continue;
    // A 'received' job may belong to a request that is about to be told 'busy'; only old ones are abandoned.
    if (job.status === 'received' && now - new Date(job.createdAt).getTime() < options.staleReceivedMs) continue;
    transitionUpload(db, clock, job.id, 'failed', { failureCode: 'interrupted', failureMessage: messageFor('interrupted') });
    audit.recordAudit({ type: 'analysis_interrupted', actor: 'system', ...(job.policyId ? { policyId: job.policyId } : {}), details: { uploadId: job.id, from: job.status } });
    recovered.push(job.id);
  }
  return recovered;
}

class Refusal extends Error {
  constructor(
    readonly code: UploadErrorCode,
    readonly side?: UploadSide,
  ) {
    super(code);
  }
}

function failureCodeFor(error: unknown): UploadFailureCode {
  if (error instanceof Refusal && !isRejectionCode(error.code)) return error.code as UploadFailureCode;
  if (error instanceof DocumentUnreadableError) return 'identity_unreadable';
  if (error instanceof LlmOutputInvalidError) return 'extraction_failed';
  return 'unexpected';
}

interface Resolved {
  policy: Policy | undefined;
  /** Existing data-source documents (attach mode). */
  sourcePaths: DocumentPaths;
}

async function validateRequest(request: AnalyseUploadRequest, deps: AnalysisDeps): Promise<Resolved> {
  if (!(UPLOAD_MODES as readonly string[]).includes(request.mode)) throw new Refusal('invalid_input');
  const given = SIDES.filter((side) => request.files[side] !== undefined);
  if (request.mode === 'attach') {
    if (typeof request.policyId !== 'string' || !POLICY_ID.test(request.policyId) || isManualPolicyId(request.policyId)) throw new Refusal('policy_not_found');
    const policy = await deps.dataSource.getPolicy(request.policyId);
    if (!policy) throw new Refusal('policy_not_found');
    const sourcePaths = await deps.dataSource.getDocumentPaths(policy.id);
    if (given.length === 0) throw new Refusal('wrong_number_of_files');
    for (const side of SIDES) if (!request.files[side] && !sourcePaths[side]) throw new Refusal('wrong_number_of_files');
    return { policy, sourcePaths };
  }
  if (given.length !== 2) throw new Refusal('wrong_number_of_files');
  const details = request.newPolicy;
  if (!details || !isValidName(details.clientName)) throw new Refusal('invalid_input');
  if (details.contactName !== undefined && details.contactName !== '' && !isValidName(details.contactName)) throw new Refusal('invalid_input');
  if (details.contactEmail !== undefined && details.contactEmail !== '' && !isValidContactEmail(details.contactEmail)) throw new Refusal('invalid_input');
  if (typeof details.brokerId !== 'string' || !POLICY_ID.test(details.brokerId) || !(await deps.dataSource.getBroker(details.brokerId))) throw new Refusal('invalid_input');
  return { policy: undefined, sourcePaths: {} };
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Refusal('timed_out')), Math.max(0, ms));
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function analyseUpload(request: AnalyseUploadRequest, deps: AnalysisDeps): Promise<AnalysisResult> {
  const { db, clock } = deps;
  const audit: AuditLog = createAuditLog(db, clock);
  const startedMs = clock.now().getTime();
  // An unknown mode is stored as 'new' (the column only allows the two modes) and refused as invalid_input below.
  const validMode = (UPLOAD_MODES as readonly string[]).includes(request.mode);
  let job = insertUpload(db, clock, { actor: request.actor, mode: validMode ? request.mode : 'new', policyId: request.mode === 'attach' && typeof request.policyId === 'string' && POLICY_ID.test(request.policyId) ? request.policyId : null });
  let policyIdForAudit: string | undefined = job.policyId ?? undefined;
  const auditBase = () => ({ actor: request.actor, ...(policyIdForAudit ? { policyId: policyIdForAudit } : {}) });
  audit.recordAudit({
    type: 'upload_received',
    ...auditBase(),
    details: { uploadId: job.id, mode: request.mode, files: SIDES.filter((s) => request.files[s]).length, consent: request.consent === true },
  });

  const reject = (code: UploadRejectionCode, side?: UploadSide): AnalysisResult => {
    job = transitionUpload(db, clock, job.id, 'rejected', { failureCode: code, failureMessage: messageFor(code, side) });
    audit.recordAudit({ type: 'upload_rejected', ...auditBase(), details: { uploadId: job.id, code, ...(side ? { side } : {}) } });
    return { job, outcome: null, message: messageFor(code, side) };
  };
  const fail = (code: UploadFailureCode, tokens: { tokensIn?: number; tokensOut?: number } = {}): AnalysisResult => {
    // Tokens are recorded on a failed job too (they were spent).
    job = transitionUpload(db, clock, job.id, 'failed', { failureCode: code, failureMessage: messageFor(code), ...tokens });
    audit.recordAudit({ type: 'analysis_failed', ...auditBase(), details: { uploadId: job.id, code } });
    return { job, outcome: null, message: messageFor(code) };
  };

  // 1. The door: consent, the request itself, AI configured, daily limit, one at a time.
  if (request.consent !== true) return reject('consent_missing');
  let resolved: Resolved;
  try {
    resolved = await validateRequest(request, deps);
  } catch (error) {
    if (error instanceof Refusal && isRejectionCode(error.code)) return reject(error.code);
    throw error;
  }
  const reader = deps.reader;
  if (!reader) return reject('ai_not_configured');
  if (countAnalysesStartedOnLocalDay(db, clock.now(), deps.timeZone) >= deps.dailyLimit) return reject('daily_limit_reached');
  let gate: { release(): void };
  try {
    gate = acquireRunGate(deps.lockPath);
  } catch (error) {
    if (error instanceof LockHeldError) return reject('busy');
    throw error;
  }

  let releaseLater: Promise<unknown> | null = null;
  try {
    recoverInterruptedUploads(db, clock, { exceptId: job.id, staleReceivedMs: 2 * deps.timeoutMs });

    // 2. Validate and store the files (bytes decide; names and declared types are ignored).
    job = transitionUpload(db, clock, job.id, 'validating');
    const validated: Partial<Record<UploadSide, ValidatedPdf>> = {};
    for (const side of SIDES) {
      const file = request.files[side];
      if (!file) continue;
      const incoming: IncomingFile = { side, bytes: file.bytes, ...(file.clientFilename !== undefined ? { clientFilename: file.clientFilename } : {}) };
      try {
        validated[side] = await validatePdfUpload(incoming, deps.limits);
      } catch (error) {
        if (error instanceof UploadRejectedError) return reject(error.code, side);
        throw error;
      }
      if (deps.knownDocuments && !deps.knownDocuments.has((validated[side] as ValidatedPdf).sha256)) return reject('unknown_in_fake_mode', side);
    }
    if (deps.knownDocuments) {
      for (const side of SIDES) {
        const sourcePath = resolved.sourcePaths[side];
        if (!validated[side] && sourcePath && !deps.knownDocuments.has(sha256File(sourcePath))) return reject('unknown_in_fake_mode', side);
      }
    }
    const storageId = newStorageId();
    const paths: DocumentPaths = { ...resolved.sourcePaths };
    const docIds: { expiringDocId?: number; renewalDocId?: number } = {};
    for (const side of SIDES) {
      const pdf = validated[side];
      if (!pdf) continue;
      const stored = storeValidatedPdf(deps.runtimeDir, storageId, pdf);
      const doc = insertStoredDocument(db, clock, { uploadId: job.id, side, sha256: pdf.sha256, sizeBytes: pdf.sizeBytes, pageCount: pdf.pageCount, displayName: pdf.displayName, storedPath: stored.storedPath });
      docIds[side === 'expiring' ? 'expiringDocId' : 'renewalDocId'] = doc.id;
      paths[side] = resolveStoredPath(deps.runtimeDir, stored.storedPath);
    }
    setUploadDocuments(db, job.id, docIds);

    // 3. Read both documents with the same reader as the nightly run.
    job = transitionUpload(db, clock, job.id, 'extracting');
    request.onStarted?.(job);
    const describe = (side: UploadSide) => (validated[side] ? short((validated[side] as ValidatedPdf).sha256) : 'data source');
    audit.recordAudit({
      type: 'analysis_started',
      ...auditBase(),
      details: {
        uploadId: job.id,
        expiring: describe('expiring'),
        renewal: describe('renewal'),
        sizes: SIDES.map((s) => validated[s]?.sizeBytes ?? 0),
        pages: SIDES.map((s) => validated[s]?.pageCount ?? 0),
        fakeLlm: reader.isFake,
      },
    });
    const readContextId = resolved.policy?.id ?? 'upload';
    const reads = (async () => {
      const expiring = await reader.read(paths.expiring as string, { policyId: readContextId, kind: 'expiring' });
      const renewal = await reader.read(paths.renewal as string, { policyId: readContextId, kind: 'renewal' });
      return { expiring, renewal };
    })();
    let read: { expiring: ReadPolicyTermsResult; renewal: ReadPolicyTermsResult };
    try {
      read = await withTimeout(reads, deps.timeoutMs - (clock.now().getTime() - startedMs));
    } catch (error) {
      if (error instanceof Refusal && error.code === 'timed_out') {
        // The model call cannot be cancelled; its late result is discarded and the gate stays closed until it settles.
        releaseLater = reads.catch(() => undefined);
        return fail('timed_out');
      }
      return fail(failureCodeFor(error));
    }
    for (const side of SIDES) {
      const r = read[side];
      saveUploadTerms(db, clock, { uploadId: job.id, side, source: validated[side] ? 'upload' : 'data_source', terms: r.terms, warnings: r.warnings, repairedFields: r.repairedFields ?? [] });
    }
    const tokens = {
      tokensIn: [read.expiring, read.renewal].reduce((sum, r) => sum + (r.fromCache ? 0 : r.usage.inputTokens), 0),
      tokensOut: [read.expiring, read.renewal].reduce((sum, r) => sum + (r.fromCache ? 0 : r.usage.outputTokens), 0),
    };

    // 4. U-2: fail closed on identity. No pack, never a guess.
    const identityProblem = checkIdentity({ expiring: read.expiring, renewal: read.renewal, ...(resolved.policy ? { policy: resolved.policy } : {}) });
    if (identityProblem) {
      if (resolved.policy) keepOrSetNeedsAttention(db, clock, audit, resolved.policy, request.actor, identityProblem);
      return fail(identityProblem, tokens);
    }

    // 5. The case: attach = the data-source policy; new = the manual client + policy (U-5).
    job = transitionUpload(db, clock, job.id, 'comparing', tokens);
    let policy: Policy;
    let client: Client | undefined;
    const origin = request.mode === 'attach' ? 'data_source' : 'manual';
    if (resolved.policy) {
      policy = resolved.policy;
      client = await deps.dataSource.getClient(policy.clientId);
    } else {
      const details = request.newPolicy as NewPolicyInput;
      const e = read.expiring.terms;
      const contactName = details.contactName?.trim() ? details.contactName.trim() : null;
      const contactEmail = details.contactEmail?.trim() ? details.contactEmail.trim() : null;
      const upserted = upsertManualClient(db, clock, { name: details.clientName.trim(), contactName, contactEmail });
      const id = manualPolicyId(e.insurerName.value as string, e.policyNumber.value as string);
      const manual = upsertManualPolicy(db, clock, {
        policyId: id,
        clientId: upserted.client.id,
        brokerId: details.brokerId,
        insurerName: e.insurerName.value as string,
        type: e.policyType.value as Policy['type'],
        expiryDate: e.periodEnd.value as string,
        annualPremium: e.annualPremium.value,
      });
      policyIdForAudit = id;
      setUploadPolicyId(db, job.id, id);
      if (manual.created) {
        audit.recordAudit({ type: 'manual_case_created', ...auditBase(), details: { uploadId: job.id, clientId: upserted.client.id, clientCreated: upserted.created } });
      }
      policy = manualPolicyToPolicy(db, manual.policy);
      const c = upserted.client;
      client = { id: c.id, name: c.name, contactName: c.contactName ?? DEFAULT_CONTACT_NAME, contactEmail: c.contactEmail ?? DEFAULT_CONTACT_EMAIL };
    }
    const broker: Broker | undefined = await deps.dataSource.getBroker(policy.brokerId);
    const key = makeCycleKey(policy.id, policy.expiryDate);
    const previous = getCaseByCycleKey(db, key);
    const previousPack = previous ? getActivePack(db, previous.id) : undefined;

    const result = await processCase(
      { db, audit, reader, clock, compareConfig: deps.compareConfig, outputDir: deps.outputDir, ...(deps.templatePath ? { templatePath: deps.templatePath } : {}) },
      {
        policy,
        client,
        broker,
        paths,
        origin,
        inputSource: 'upload',
        today: deps.today(),
        runId: null,
        forced: false,
        preRead: read,
        actor: request.actor,
      },
    );
    const outcome = result.row.outcome;
    if (outcome !== 'new_pack' && outcome !== 'new_version' && outcome !== 'unchanged_skip' && outcome !== 'skipped_already_processed') {
      return fail('unexpected');
    }
    const caseRow = getCaseByCycleKey(db, key);
    const activePack = caseRow ? getActivePack(db, caseRow.id) : undefined;
    job = transitionUpload(db, clock, job.id, 'done', { caseId: caseRow?.id ?? null, packId: activePack?.id ?? null });
    if (result.newPack && origin === 'data_source') {
      // U-4: from now on the nightly run leaves this case alone (unless --force --only).
      audit.recordAudit({ type: 'manual_override_set', ...auditBase(), cycleKey: key, details: { uploadId: job.id, packId: result.newPack.packId, version: result.newPack.version, replacedNightlyPack: previousPack?.inputSource === 'data_source' } });
    }
    audit.recordAudit({
      type: 'analysis_finished',
      ...auditBase(),
      cycleKey: key,
      details: { uploadId: job.id, outcome, version: activePack?.version ?? null, tokensIn: tokens.tokensIn, tokensOut: tokens.tokensOut, durationMs: clock.now().getTime() - startedMs },
    });
    if (result.newPack && deps.onPacksReady) {
      try {
        await deps.onPacksReady([result.newPack], []);
      } catch (error) {
        audit.recordAudit({ type: 'notification_failed', ...auditBase(), details: { stage: 'onPacksReady', uploadId: job.id, error: (error instanceof Error ? error.name : 'Error').slice(0, 60) } });
      }
    }
    return { job, outcome, message: successMessage(outcome, activePack?.version ?? null) };
  } catch (error) {
    const current = getUpload(db, job.id);
    if (current && (current.status === 'done' || current.status === 'failed' || current.status === 'rejected')) throw error;
    return fail(failureCodeFor(error));
  } finally {
    if (releaseLater) void releaseLater.finally(() => gate.release());
    else gate.release();
  }
}

/** U-2 in attach mode: a case without a pack is set (or kept) needs_attention; a case with a pack is left as it is. */
function keepOrSetNeedsAttention(db: Db, clock: InstantClock, audit: AuditLog, policy: Policy, actor: AuditActor, code: UploadFailureCode): void {
  const key = makeCycleKey(policy.id, policy.expiryDate);
  const caseRow = getCaseByCycleKey(db, key);
  if (!caseRow || getActivePack(db, caseRow.id) || caseRow.status === 'needs_attention') return;
  if (caseRow.status !== 'not_started') return;
  const reason = `uploaded documents refused (${code})`;
  const moved = transitionCase(db, clock, audit, { caseRow, to: 'needs_attention', actor, reason });
  updateCaseFields(db, clock, moved.id, { attentionReason: reason });
}

function successMessage(outcome: RunOutcome, version: number | null): string {
  if (outcome === 'unchanged_skip') return 'These are the same documents as before, so nothing changed. The existing pack is still the current one.';
  if (outcome === 'skipped_already_processed') return 'This renewal was already approved or skipped, so no new pack was prepared. Nothing changed.';
  return `The pack is ready for your review${version && version > 1 ? ` (version ${version})` : ''}. Nothing has been sent.`;
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
