// READ-ONLY audit panel for the pack page. Raw details JSON is NEVER shown: each event type has a
// whitelisted summary built only from known keys, and every value that reaches the text is either a
// small integer, a boolean, or a member of a fixed vocabulary mapped to fixed words. Free text in
// details (errors, paths, hashes, origins) is dropped entirely.

import { RENEWAL_STATUSES } from '../../domain/schemas.js';
import { UPLOAD_FAILURE_CODES, UPLOAD_REJECTION_CODES } from '../../uploads/errors.js';
import type { AuditDetails, AuditEvent } from '../../state/audit.js';
import { actorLabel, channelLabel, formatInstant, plural, statusLabel } from './present.js';

export interface AuditItem {
  /** ISO instant as stored (for the <time datetime> attribute; escaped by the view). */
  iso: string;
  when: string;
  what: string;
  who: string;
}

export const MAX_AUDIT_ITEMS = 50;
export const MAX_AUDIT_TEXT = 160;

type Reader = {
  int(key: string): number | null;
  bool(key: string): boolean | null;
  oneOf<T extends string>(key: string, allowed: readonly T[]): T | null;
};

function reader(details: AuditDetails): Reader {
  return {
    int(key) {
      const value = details[key];
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
    },
    bool(key) {
      const value = details[key];
      return typeof value === 'boolean' ? value : null;
    },
    oneOf(key, allowed) {
      const value = details[key];
      return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as (typeof allowed)[number]) : null;
    },
  };
}

const SEVERITY_WORDS = { info: 'Info', low: 'Low', medium: 'Medium', high: 'High' } as const;
const SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
const CHANNELS = ['web', 'telegram', 'cli'] as const;
const RESULT_WORDS = {
  already_done: 'it was already decided',
  superseded: 'that version was replaced',
  not_found: 'the pack was not found',
  not_allowed: 'it was not allowed',
  wrong_state: 'the renewal was not waiting for a decision',
} as const;

/** Short fixed words for upload codes (Prompt 7). Unknown codes fall back to a generic sentence. */
const UPLOAD_CODE_WORDS: Record<string, string> = {
  not_a_pdf: 'not a PDF',
  too_large: 'file too large',
  too_many_pages: 'too many pages',
  encrypted: 'password-protected PDF',
  corrupted: 'damaged PDF',
  empty_or_scanned: 'no readable text (scan)',
  wrong_number_of_files: 'wrong number of files',
  duplicate_side: 'two files for one side',
  unknown_in_fake_mode: 'not a known sample document (fake mode)',
  daily_limit_reached: 'daily limit reached',
  busy: 'another analysis or run was in progress',
  consent_missing: 'consent not ticked',
  policy_not_found: 'policy not found',
  invalid_input: 'form details not valid',
  ai_not_configured: 'AI reading not configured',
  type_not_supported: 'policy type not supported',
  document_mismatch: 'documents do not match the policy',
  identity_unreadable: 'insurer, number, type or expiry not readable with confidence',
  type_disagreement: 'the documents name different policy types',
  extraction_failed: 'documents could not be read reliably',
  timed_out: 'took too long',
  interrupted: 'the service stopped',
  unexpected: 'unexpected problem',
};
const UPLOAD_CODES = [...UPLOAD_REJECTION_CODES, ...UPLOAD_FAILURE_CODES] as const;
const OUTCOME_WORDS = {
  new_pack: 'pack prepared',
  new_version: 'new version prepared',
  unchanged_skip: 'same documents as before, nothing changed',
  skipped_already_processed: 'already decided, nothing changed',
} as const;
const code = (r: Reader) => {
  const value = r.oneOf('code', UPLOAD_CODES);
  return value ? UPLOAD_CODE_WORDS[value] ?? null : null;
};

const status = (r: Reader, key: string) => {
  const value = r.oneOf(key, RENEWAL_STATUSES);
  return value ? statusLabel(value) : null;
};
const channel = (r: Reader) => {
  const value = r.oneOf('channel', CHANNELS);
  return value ? channelLabel(value) : null;
};
const version = (r: Reader, key = 'version') => {
  const value = r.int(key);
  return value === null ? '' : ` (version ${value})`;
};

/** One fixed sentence per event type. Anything unexpected degrades to a generic sentence. */
const SUMMARIES: Record<string, (r: Reader) => string> = {
  documents_checked: (r) => {
    const side = (key: string, name: string) => (r.bool(key) === true ? `${name} found` : r.bool(key) === false ? `${name} missing` : null);
    const parts = [side('expiring', 'expiring document'), side('renewal', 'renewal document')].filter(Boolean);
    return parts.length ? `Documents checked: ${parts.join(', ')}` : 'Documents checked';
  },
  terms_extracted: (r) => {
    const kind = r.oneOf('kind', ['expiring', 'renewal'] as const);
    const cached = r.bool('fromCache') === true ? ' (from cache)' : '';
    const repaired = r.int('repaired');
    const second = repaired ? `; ${plural(repaired, 'fact', 'facts')} confirmed on a second reading` : '';
    return kind ? `Terms read from the ${kind} document${cached}${second}` : `Terms read from a document${cached}${second}`;
  },
  comparison_done: (r) => {
    const risk = r.oneOf('overallRisk', SEVERITIES);
    const diffs = r.int('diffs');
    const flags = r.int('flags');
    const parts = [risk ? `overall risk ${SEVERITY_WORDS[risk]}` : null, diffs === null ? null : plural(diffs, 'change', 'changes'), flags === null ? null : plural(flags, 'flag', 'flags')].filter(Boolean);
    return parts.length ? `Comparison done: ${parts.join(', ')}` : 'Comparison done';
  },
  pack_written: (r) => `Draft pack prepared${version(r)}`,
  pack_superseded: (r) => {
    const from = r.int('oldVersion');
    const to = r.int('newVersion');
    return from !== null && to !== null ? `Version ${from} replaced by version ${to}` : 'An older version was replaced';
  },
  status_changed: (r) => {
    const from = status(r, 'from');
    const to = status(r, 'to');
    return from && to ? `Status changed from ${from} to ${to}` : 'Status changed';
  },
  needs_attention: () => 'Marked as needing attention (see the notice on the list page)',
  unchanged_skip: (r) => (r.oneOf('reason', ['manual_override_in_place'] as const) ? 'Morning run: the uploaded pack is in place, left alone' : 'Morning run: nothing changed, pack kept'),
  policy_failed: (r) => `Morning run could not refresh this renewal; the previous pack was kept${version(r, 'keptVersion')}`,
  forced_rerun: (r) => `Rerun requested from the command line${version(r)}`,
  notification_sent: (r) => {
    const kind = r.oneOf('kind', ['pack', 'notice'] as const);
    const where = channel(r);
    const what = kind === 'notice' ? 'Notice shown' : 'Card shown';
    return where ? `${what} on the ${where}` : what;
  },
  notification_failed: (r) => {
    const where = channel(r);
    return where ? `Could not show the card on ${where}` : 'Could not show the card';
  },
  reminder_sent: (r) => {
    const where = channel(r);
    return where ? `Reminder sent on the ${where}` : 'Reminder sent';
  },
  opened: () => 'Comparison spreadsheet opened',
  approved: (r) => `Approved${version(r)}`,
  skipped: (r) => `Skipped${version(r)}`,
  approval_ignored: (r) => {
    const result = r.oneOf('result', Object.keys(RESULT_WORDS) as Array<keyof typeof RESULT_WORDS>);
    return result ? `Action ignored: ${RESULT_WORDS[result]}` : 'Action ignored';
  },
  copy_failed: () => 'Saving the approved drafts failed (nothing was sent). Run npm run retry-sync',
  status_sync_failed: () => 'Updating the renewal status failed (nothing was sent). Run npm run retry-sync',
  status_sync_retried: (r) => {
    const result = r.oneOf('result', ['ok', 'failed'] as const);
    return result === 'ok' ? 'Retry finished: drafts saved and status updated' : result === 'failed' ? 'Retry failed; try npm run retry-sync again' : 'Retry attempted';
  },
  seeded: () => 'Imported as already approved (earlier history)',
  policy_skipped_already_processed: () => 'Morning run: already decided this cycle, skipped',
  policy_skipped_outside_window: () => 'Morning run: not due yet, skipped',
  unauthorised_attempt: () => 'Refused an unauthorised request',
  // Prompt 7: uploads (ids, codes and counts only; never names or document text).
  upload_received: (r) => {
    const mode = r.oneOf('mode', ['attach', 'new'] as const);
    const files = r.int('files');
    const what = mode === 'attach' ? 'missing document' : mode === 'new' ? 'new policy' : 'analysis';
    return `Documents received (${what}${files === null ? '' : `, ${plural(files, 'file', 'files')}`})`;
  },
  upload_rejected: (r) => {
    const words = code(r);
    return words ? `Upload not accepted: ${words}` : 'Upload not accepted';
  },
  analysis_started: (r) => (r.bool('fakeLlm') === true ? 'Analysis started (fake mode: answer keys, no AI)' : 'Analysis started'),
  analysis_finished: (r) => {
    const outcome = r.oneOf('outcome', Object.keys(OUTCOME_WORDS) as Array<keyof typeof OUTCOME_WORDS>);
    return outcome ? `Analysis finished: ${OUTCOME_WORDS[outcome]}${version(r)}` : 'Analysis finished';
  },
  analysis_failed: (r) => {
    const words = code(r);
    return words ? `Analysis stopped: ${words}. No pack was prepared` : 'Analysis stopped. No pack was prepared';
  },
  analysis_interrupted: () => 'Analysis interrupted (the service stopped); marked as stopped',
  manual_case_created: () => 'Manual policy created from the uploaded documents',
  manual_override_set: () => 'Uploaded pack in place; the morning run will leave this renewal alone',
  upload_deleted: (r) => {
    const files = r.int('files');
    return files === null ? 'Uploaded PDFs deleted' : `Uploaded PDFs deleted (${plural(files, 'file', 'files')})`;
  },
  upload_purged: (r) => {
    const files = r.int('files');
    return files === null ? 'Old uploaded PDFs deleted' : `Old uploaded PDFs deleted (${plural(files, 'file', 'files')})`;
  },
  overview_created: (r) => {
    const rows = r.int('rows');
    return rows === null ? 'Overview spreadsheet created' : `Overview spreadsheet created (${plural(rows, 'row', 'rows')})`;
  },
};

function cap(text: string): string {
  return text.length > MAX_AUDIT_TEXT ? `${text.slice(0, MAX_AUDIT_TEXT - 3)}...` : text;
}

export function summarizeAuditEvent(event: AuditEvent, approverName: string): AuditItem {
  const summarize = SUMMARIES[event.type];
  const details = event.details && typeof event.details === 'object' && !Array.isArray(event.details) ? event.details : {};
  return {
    iso: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(event.at) ? event.at : '',
    when: formatInstant(event.at),
    what: cap(summarize ? summarize(reader(details)) : 'Recorded event'),
    who: cap(actorLabel(event.actor, approverName)),
  };
}

/** The pack's own cycle only; newest MAX_AUDIT_ITEMS, shown oldest first. */
export function auditItemsFor(events: readonly AuditEvent[], cycleKey: string, approverName: string): { items: AuditItem[]; hidden: number } {
  const mine = events.filter((event) => event.cycleKey === cycleKey);
  const shown = mine.slice(-MAX_AUDIT_ITEMS);
  return { items: shown.map((event) => summarizeAuditEvent(event, approverName)), hidden: mine.length - shown.length };
}

/**
 * The job page's panel: events that name this upload (details.uploadId) plus the renewal cycle's events between
 * the job's start and end. Newest MAX_AUDIT_ITEMS, shown oldest first.
 */
export function uploadAuditItems(
  events: readonly AuditEvent[],
  job: { id: number; createdAt: string; finishedAt: string | null },
  cycleKey: string | null,
  approverName: string,
): { items: AuditItem[]; hidden: number } {
  const end = job.finishedAt ?? '9999';
  const mine = events.filter(
    (event) => event.details.uploadId === job.id || (cycleKey !== null && event.cycleKey === cycleKey && event.at >= job.createdAt && event.at <= end),
  );
  const shown = mine.slice(-MAX_AUDIT_ITEMS);
  return { items: shown.map((event) => summarizeAuditEvent(event, approverName)), hidden: mine.length - shown.length };
}
