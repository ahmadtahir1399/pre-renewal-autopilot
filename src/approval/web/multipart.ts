// Reads the ONE multipart route (POST /analysis) with busboy (Prompt 7, U3). No hand-written multipart parsing.
// Rules (all tested): the caller has already checked Host, Origin and the session cookie; the CSRF token must
// be the FIRST part and valid before any file is accepted; only whitelisted field and file names; at most one
// file per side; limits on parts, fields, field sizes and header pairs; the total size is enforced while
// streaming (Content-Length is never trusted); nothing is written to disk here (bytes stay in memory until the
// analysis service has checked them). The client filename is passed on for DISPLAY only.

import type { IncomingMessage } from 'node:http';
import busboy from 'busboy';
import type { UploadSide } from '../../uploads/model.js';

export const UPLOAD_FIELD_NAMES = ['csrf', 'mode', 'policy', 'client_name', 'contact_name', 'contact_email', 'broker', 'consent'] as const;
export type UploadFieldName = (typeof UPLOAD_FIELD_NAMES)[number];
const FIELDS: ReadonlySet<string> = new Set(UPLOAD_FIELD_NAMES);
export const FILE_FIELD_NAMES: readonly UploadSide[] = ['expiring', 'renewal'];
const FILES: ReadonlySet<string> = new Set(FILE_FIELD_NAMES);

/** Largest text field accepted (a client name is at most 100 characters; room for UTF-8 and a little more). */
export const MAX_FIELD_BYTES = 1000;
/** Room for the multipart framing and the text fields on top of the two files. */
export const FORM_OVERHEAD_BYTES = 64 * 1024;

export interface UploadFormLimits {
  maxFileBytes: number;
}

export function maxUploadBodyBytes(limits: UploadFormLimits): number {
  return 2 * limits.maxFileBytes + FORM_OVERHEAD_BYTES;
}

export type UploadFormResult =
  | {
      kind: 'ok';
      fields: Partial<Record<UploadFieldName, string>>;
      files: Partial<Record<UploadSide, { bytes: Uint8Array; filename: string }>>;
    }
  /** CSRF missing, wrong, or not the first part (a file before the token aborts the request). */
  | { kind: 'csrf' }
  | { kind: 'too_large'; side?: UploadSide }
  | { kind: 'duplicate_side' }
  | { kind: 'bad_request'; reason: string }
  /** The client went away; nothing to answer. */
  | { kind: 'aborted' };

export function isMultipart(contentType: string | undefined): boolean {
  return typeof contentType === 'string' && /^multipart\/form-data\s*;\s*boundary=/i.test(contentType);
}

/**
 * Parse the upload form. On ANY failure the rest of the body is discarded (never stored) and the result says why.
 * `csrfValid` is the session's constant-time CSRF comparison.
 */
export function readUploadForm(req: IncomingMessage, limits: UploadFormLimits, csrfValid: (token: string) => boolean): Promise<UploadFormResult> {
  return new Promise((resolve) => {
    let settled = false;
    let parser: ReturnType<typeof busboy> | null = null;
    const fields: Partial<Record<UploadFieldName, string>> = {};
    const files: Partial<Record<UploadSide, { bytes: Uint8Array; filename: string }>> = {};
    let csrfSeen = false;
    // Sides are recorded when their part STARTS (a later 'file' event can come before the earlier stream ends).
    const seenSides = new Set<UploadSide>();
    let total = 0;
    const maxTotal = maxUploadBodyBytes(limits);

    const finish = (result: UploadFormResult): void => {
      if (settled) return;
      settled = true;
      if (result.kind !== 'ok') {
        // Stop parsing and drop everything received so far; keep draining the socket so an answer can be sent.
        if (parser) req.unpipe(parser);
        for (const side of FILE_FIELD_NAMES) delete files[side];
        req.resume();
      }
      resolve(result);
    };

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxTotal) finish({ kind: 'too_large' });
    });
    req.on('aborted', () => finish({ kind: 'aborted' }));
    req.on('error', () => finish({ kind: 'aborted' }));

    try {
      parser = busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: {
          fieldNameSize: 40,
          fieldSize: MAX_FIELD_BYTES,
          fields: UPLOAD_FIELD_NAMES.length,
          files: FILE_FIELD_NAMES.length,
          parts: UPLOAD_FIELD_NAMES.length + FILE_FIELD_NAMES.length,
          fileSize: limits.maxFileBytes,
          headerPairs: 8,
        },
      });
    } catch {
      finish({ kind: 'bad_request', reason: 'not a multipart form' });
      return;
    }

    parser.on('field', (name, value, info) => {
      if (settled) return;
      if (!csrfSeen) {
        if (name === 'csrf' && csrfValid(value)) {
          csrfSeen = true;
          return;
        }
        finish({ kind: 'csrf' });
        return;
      }
      if (!FIELDS.has(name) || name === 'csrf' || info.nameTruncated) return finish({ kind: 'bad_request', reason: 'unknown field' });
      if (fields[name as UploadFieldName] !== undefined) return finish({ kind: 'bad_request', reason: 'repeated field' });
      if (info.valueTruncated) return finish({ kind: 'bad_request', reason: 'field too long' });
      fields[name as UploadFieldName] = value;
    });

    parser.on('file', (name, stream, info) => {
      if (settled) {
        stream.resume();
        return;
      }
      if (!csrfSeen) {
        stream.resume();
        finish({ kind: 'csrf' });
        return;
      }
      if (!FILES.has(name)) {
        stream.resume();
        finish({ kind: 'bad_request', reason: 'unknown file field' });
        return;
      }
      const side = name as UploadSide;
      if (seenSides.has(side)) {
        stream.resume();
        finish({ kind: 'duplicate_side' });
        return;
      }
      seenSides.add(side);
      const chunks: Buffer[] = [];
      let size = 0;
      let over = false;
      stream.on('limit', () => {
        over = true;
      });
      stream.on('data', (chunk: Buffer) => {
        if (over || settled) return;
        size += chunk.length;
        chunks.push(chunk);
      });
      stream.on('end', () => {
        if (settled) return;
        if (over || stream.truncated) {
          finish({ kind: 'too_large', side });
          return;
        }
        // A browser sends an empty part with no filename for a file input left empty: that is "no file".
        if (size === 0 && info.filename === '') return;
        files[side] = { bytes: new Uint8Array(Buffer.concat(chunks)), filename: info.filename };
      });
    });

    parser.on('partsLimit', () => finish({ kind: 'bad_request', reason: 'too many parts' }));
    parser.on('filesLimit', () => finish({ kind: 'bad_request', reason: 'too many files' }));
    parser.on('fieldsLimit', () => finish({ kind: 'bad_request', reason: 'too many fields' }));
    parser.on('error', () => finish({ kind: 'bad_request', reason: 'malformed multipart body' }));
    parser.on('close', () => {
      if (!csrfSeen) finish({ kind: 'csrf' });
      else finish({ kind: 'ok', fields, files });
    });
    req.pipe(parser);
  });
}
