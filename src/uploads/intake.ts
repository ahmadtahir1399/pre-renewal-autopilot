// The door check for one uploaded PDF (Prompt 7, U2). Plain code, no AI.
// Trusts NOTHING the client says: the declared content type and file extension are ignored; the bytes decide.
// Storage location: DATA_DIR/runtime/uploads/<random id>/<side>.pdf. The client filename is NEVER part of a path;
// it is only sanitised into a short display name.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { hasMeaningfulText, type PdfPage, STANDARD_FONTS_DIR } from '../documents/pdfText.js';
import { UploadRejectedError } from './errors.js';
import type { UploadSide } from './model.js';

export const PDF_MAGIC = '%PDF-';
export const MAX_DISPLAY_NAME = 100;
/** Folder (inside DATA_DIR/runtime) that holds every stored upload. */
export const UPLOADS_FOLDER = 'uploads';

export interface UploadLimits {
  maxBytes: number;
  maxPages: number;
  /** Time allowed to open and read one PDF. */
  parseTimeoutMs: number;
}

export interface IncomingFile {
  side: UploadSide;
  bytes: Uint8Array;
  /** Client-supplied name: display only, never trusted, never used in a path. */
  clientFilename?: string;
}

export interface ValidatedPdf {
  side: UploadSide;
  bytes: Uint8Array;
  sha256: string;
  sizeBytes: number;
  pageCount: number;
  displayName: string;
}

export function limitsFromEnv(env: { UPLOAD_MAX_MB: number; UPLOAD_MAX_PAGES: number; ANALYSIS_TIMEOUT_SECONDS: number }): UploadLimits {
  return {
    maxBytes: env.UPLOAD_MAX_MB * 1024 * 1024,
    maxPages: env.UPLOAD_MAX_PAGES,
    // One file may use at most a third of the analysis budget, capped at 30 s.
    parseTimeoutMs: Math.min(30_000, Math.floor((env.ANALYSIS_TIMEOUT_SECONDS * 1000) / 3)),
  };
}

/** Strip any path, control, format (bidi) and line-break characters; collapse spaces; cap the length. */
export function sanitiseDisplayName(clientFilename: string | undefined, side: UploadSide): string {
  const fallback = `${side}.pdf`;
  if (!clientFilename) return fallback;
  const lastPart = clientFilename.split(/[\\/]/).pop() ?? '';
  const cleaned = lastPart
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return fallback;
  return Array.from(cleaned).slice(0, MAX_DISPLAY_NAME).join('');
}

export function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i++) if (bytes[i] !== PDF_MAGIC.charCodeAt(i)) return false;
  return true;
}

interface PdfInspection {
  pageCount: number;
  pages: PdfPage[];
}

/**
 * Open the PDF with pdf.js and read the text of every page.
 * Verified by running it on pdfjs-dist 6.4.299: an encrypted PDF throws `PasswordException` (code 1,
 * "No password given"); a damaged or truncated one throws `InvalidPDFException`.
 */
async function inspect(bytes: Uint8Array, side: UploadSide, limits: UploadLimits): Promise<PdfInspection> {
  // pdf.js may transfer (detach) the buffer it is given, so it gets a copy.
  const loadingTask = getDocument({ data: bytes.slice(), standardFontDataUrl: STANDARD_FONTS_DIR });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UploadRejectedError('corrupted', side)), limits.parseTimeoutMs);
  });
  const work = (async (): Promise<PdfInspection> => {
    let doc: Awaited<typeof loadingTask.promise>;
    try {
      doc = await loadingTask.promise;
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new UploadRejectedError(name === 'PasswordException' ? 'encrypted' : 'corrupted', side);
    }
    if (doc.numPages > limits.maxPages) throw new UploadRejectedError('too_many_pages', side);
    const pages: PdfPage[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter((s) => s.trim() !== '')
          .join('\n');
        pages.push({ pageNumber, text });
      }
    } catch {
      throw new UploadRejectedError('corrupted', side);
    }
    return { pageCount: doc.numPages, pages };
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    // Stops pdf.js work on a timeout too (best effort; parsing already in progress may finish first).
    await loadingTask.destroy().catch(() => {});
    work.catch(() => {}); // a late failure after a timeout is discarded
  }
}

/** Every door check for one file. Throws UploadRejectedError with a typed code; never echoes the content. */
export async function validatePdfUpload(file: IncomingFile, limits: UploadLimits): Promise<ValidatedPdf> {
  const { bytes, side } = file;
  if (bytes.length > limits.maxBytes) throw new UploadRejectedError('too_large', side);
  if (!hasPdfMagic(bytes)) throw new UploadRejectedError('not_a_pdf', side);
  const inspected = await inspect(bytes, side, limits);
  if (!inspected.pages.some(hasMeaningfulText)) throw new UploadRejectedError('empty_or_scanned', side);
  return {
    side,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    pageCount: inspected.pageCount,
    displayName: sanitiseDisplayName(file.clientFilename, side),
  };
}

/** 32 hex characters from the operating system's cryptographic random source. */
export function newStorageId(): string {
  return randomBytes(16).toString('hex');
}

const STORAGE_ID = /^[0-9a-f]{32}$/;

/** '/'-separated path relative to the runtime folder; built only from the random id and the side. */
export function storedPathFor(storageId: string, side: UploadSide): string {
  if (!STORAGE_ID.test(storageId)) throw new Error('Invalid storage id');
  if (side !== 'expiring' && side !== 'renewal') throw new Error('Invalid side');
  return `${UPLOADS_FOLDER}/${storageId}/${side}.pdf`;
}

/** Resolve a stored relative path and refuse anything that is not exactly uploads/<id>/<side>.pdf. */
export function resolveStoredPath(runtimeDir: string, storedPath: string): string {
  if (!/^uploads\/[0-9a-f]{32}\/(expiring|renewal)\.pdf$/.test(storedPath)) throw new Error('Stored upload path is not valid');
  const base = path.resolve(runtimeDir, UPLOADS_FOLDER);
  const target = path.resolve(runtimeDir, ...storedPath.split('/'));
  const rel = path.relative(base, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Stored upload path escapes the uploads folder');
  return target;
}

/**
 * Write the bytes to a temp name in the same folder, then rename (Windows-safe). The folder is created with
 * mode 0700 and the file with 0600; on Windows these modes are ignored (NTFS permissions are inherited from
 * DATA_DIR), which is noted in docs/UPLOADS.md.
 */
export function storeValidatedPdf(runtimeDir: string, storageId: string, pdf: ValidatedPdf): { storedPath: string; absolutePath: string } {
  const storedPath = storedPathFor(storageId, pdf.side);
  const absolutePath = resolveStoredPath(runtimeDir, storedPath);
  mkdirSync(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  const temp = `${absolutePath}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, pdf.bytes, { mode: 0o600, flag: 'wx' });
    renameSync(temp, absolutePath);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
  return { storedPath, absolutePath };
}

/** Remove one stored file (and its folder when empty). Missing files are fine. */
export function removeStoredFile(runtimeDir: string, storedPath: string): void {
  const absolutePath = resolveStoredPath(runtimeDir, storedPath);
  rmSync(absolutePath, { force: true });
  try {
    rmdirSync(path.dirname(absolutePath)); // only succeeds when empty
  } catch {
    // the folder still holds the other side, or is already gone
  }
}
