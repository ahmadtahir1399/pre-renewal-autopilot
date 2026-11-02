// Typed upload errors. ONE exported union of codes, each with a plain-English message used by the web page
// and the CLI. Messages never echo document text, the raw filename or any secret.

/** Refused at the door: the job ends 'rejected'. */
export const UPLOAD_REJECTION_CODES = [
  'not_a_pdf',
  'too_large',
  'too_many_pages',
  'encrypted',
  'corrupted',
  'empty_or_scanned',
  'wrong_number_of_files',
  'duplicate_side',
  'unknown_in_fake_mode',
  'daily_limit_reached',
  'busy',
  'consent_missing',
  'policy_not_found',
  'invalid_input',
  'ai_not_configured',
] as const;

/** Something broke after the door (U-2 identity checks, AI output, time): the job ends 'failed'. */
export const UPLOAD_FAILURE_CODES = [
  'type_not_supported',
  'document_mismatch',
  'identity_unreadable',
  'type_disagreement',
  'extraction_failed',
  'timed_out',
  'interrupted',
  'unexpected',
] as const;

export type UploadRejectionCode = (typeof UPLOAD_REJECTION_CODES)[number];
export type UploadFailureCode = (typeof UPLOAD_FAILURE_CODES)[number];
export type UploadErrorCode = UploadRejectionCode | UploadFailureCode;

export const UPLOAD_ERROR_MESSAGES: Record<UploadErrorCode, string> = {
  not_a_pdf: 'That file is not a PDF. Only PDF documents can be analysed.',
  too_large: 'That file is too large. Each PDF must be within the size limit shown on the page.',
  too_many_pages: 'That PDF has too many pages. Each PDF must be within the page limit shown on the page.',
  encrypted: 'That PDF is password-protected. Remove the password and upload it again.',
  corrupted: 'That PDF could not be opened. It may be damaged; try saving it again and re-uploading.',
  empty_or_scanned: 'That PDF has no readable text. It may be a scan or a picture; scanned documents are not supported (no OCR).',
  wrong_number_of_files: 'Upload one PDF per side: at most one expiring policy and one renewal offer.',
  duplicate_side: 'Two files were sent for the same side. Upload one expiring policy and one renewal offer.',
  unknown_in_fake_mode: 'This document is not one of the known sample documents. In fake mode only the sample PDFs can be analysed; real analysis needs the live AI model.',
  daily_limit_reached: 'The daily limit for analyses has been reached. Try again tomorrow.',
  busy: 'Another analysis or the nightly run is in progress. Try again in a minute.',
  consent_missing: 'Please confirm that the documents are made-up before analysing them.',
  policy_not_found: 'That policy was not found. Choose a policy from the list.',
  invalid_input: 'Some of the details are not valid. Check the form and try again.',
  ai_not_configured: 'AI reading is not configured on this computer, so real documents cannot be analysed.',
  type_not_supported: 'The policy type could not be matched to one of the supported types (commercial property, public liability, business interruption). No pack was prepared.',
  document_mismatch: 'The documents do not match the selected policy (insurer, policy type or expiry date differ). No pack was prepared.',
  identity_unreadable: 'The insurer, policy number, policy type or expiry date could not be read with confidence. No pack was prepared; nothing was guessed.',
  type_disagreement: 'The two documents name different policy types. No pack was prepared.',
  extraction_failed: 'The documents could not be read reliably. No pack was prepared. Try again later.',
  timed_out: 'The analysis took too long and was stopped. No pack was prepared. Try again later.',
  interrupted: 'The analysis was interrupted (the service stopped). No pack was prepared. Try again.',
  unexpected: 'Something unexpected went wrong. No pack was prepared. The details are in the server log.',
};

export function isRejectionCode(code: UploadErrorCode): code is UploadRejectionCode {
  return (UPLOAD_REJECTION_CODES as readonly string[]).includes(code);
}

export class UploadRejectedError extends Error {
  constructor(
    readonly code: UploadRejectionCode,
    readonly side?: 'expiring' | 'renewal',
  ) {
    super(UPLOAD_ERROR_MESSAGES[code]);
    this.name = 'UploadRejectedError';
  }
}

export class UploadFailedError extends Error {
  constructor(readonly code: UploadFailureCode) {
    super(UPLOAD_ERROR_MESSAGES[code]);
    this.name = 'UploadFailedError';
  }
}

/** Plain message for a side-specific rejection ("The renewal offer: ..."). */
export function messageFor(code: UploadErrorCode, side?: 'expiring' | 'renewal'): string {
  const message = UPLOAD_ERROR_MESSAGES[code];
  if (!side) return message;
  return `${side === 'expiring' ? 'The expiring policy' : 'The renewal offer'}: ${message}`;
}
