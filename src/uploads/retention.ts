// Deleting stored upload PDFs: on request (uploads:delete, the web 'Delete the uploaded PDFs' button) and by age
// (uploads:purge, UPLOAD_RETENTION_DAYS). Audit rows and pack metadata are KEPT; the pack's own drafts (xlsx/eml)
// are outputs and stay. Extraction-cache entries for the deleted bytes are removed too, because the cache stores
// fileSha256 in every entry, unless the same bytes are still needed (another live upload or a data-source document).

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { InstantClock } from '../domain/dates.js';
import { type AuditActor, createAuditLog } from '../state/audit.js';
import type { Db } from '../state/db.js';
import { removeStoredFile } from './intake.js';
import { countLiveDocumentsWithHash, getUpload, listStoredDocuments, listStoredDocumentsBefore, markStoredDocumentDeleted, type StoredDocumentRow } from './repo.js';

export interface RetentionDeps {
  db: Db;
  clock: InstantClock;
  runtimeDir: string;
  /** Extraction cache folder (default .cache/extractions). */
  cacheDir: string;
  /** sha256 values of data-source documents (their cache entries are never removed). */
  protectedHashes: ReadonlySet<string>;
}

/** Remove cache entries whose fileSha256 matches. Returns how many files were removed. */
export function removeCacheEntriesForHash(cacheDir: string, sha256: string): number {
  if (!existsSync(cacheDir)) return 0;
  let removed = 0;
  for (const name of readdirSync(cacheDir)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = path.join(cacheDir, name);
    try {
      const entry = JSON.parse(readFileSync(file, 'utf8')) as { fileSha256?: unknown };
      if (entry.fileSha256 === sha256) {
        rmSync(file, { force: true });
        removed++;
      }
    } catch {
      // unreadable entry: not ours to judge; leave it
    }
  }
  return removed;
}

function deleteDocuments(deps: RetentionDeps, docs: StoredDocumentRow[]): { files: number; cacheEntriesRemoved: number } {
  let files = 0;
  let cacheEntriesRemoved = 0;
  for (const doc of docs) {
    if (doc.deletedAt) continue;
    removeStoredFile(deps.runtimeDir, doc.storedPath);
    markStoredDocumentDeleted(deps.db, deps.clock, doc.id);
    files++;
    if (!deps.protectedHashes.has(doc.sha256) && countLiveDocumentsWithHash(deps.db, doc.sha256, doc.uploadId) === 0) {
      cacheEntriesRemoved += removeCacheEntriesForHash(deps.cacheDir, doc.sha256);
    }
  }
  return { files, cacheEntriesRemoved };
}

export interface DeleteResult {
  found: boolean;
  files: number;
  cacheEntriesRemoved: number;
}

/** Delete one upload's stored PDFs. Idempotent: a second call deletes nothing and is still audited. */
export function deleteUploadFiles(deps: RetentionDeps, uploadId: number, actor: AuditActor): DeleteResult {
  const job = Number.isInteger(uploadId) ? getUpload(deps.db, uploadId) : undefined;
  if (!job) return { found: false, files: 0, cacheEntriesRemoved: 0 };
  const result = deleteDocuments(deps, listStoredDocuments(deps.db, job.id));
  createAuditLog(deps.db, deps.clock).recordAudit({
    type: 'upload_deleted',
    actor,
    ...(job.policyId ? { policyId: job.policyId } : {}),
    details: { uploadId: job.id, files: result.files, cacheEntriesRemoved: result.cacheEntriesRemoved },
  });
  return { found: true, ...result };
}

export interface PurgeResult {
  cutoff: string;
  uploadIds: number[];
  files: number;
  cacheEntriesRemoved: number;
  dryRun: boolean;
}

/** Delete every stored PDF older than retentionDays. The dry run lists what would go and changes nothing. */
export function purgeOldUploads(deps: RetentionDeps, retentionDays: number, options: { dryRun: boolean; actor: AuditActor }): PurgeResult {
  const cutoff = new Date(deps.clock.now().getTime() - retentionDays * 86_400_000).toISOString();
  const docs = listStoredDocumentsBefore(deps.db, cutoff);
  const uploadIds = [...new Set(docs.map((d) => d.uploadId))].sort((a, b) => a - b);
  if (options.dryRun) return { cutoff, uploadIds, files: docs.length, cacheEntriesRemoved: 0, dryRun: true };
  const result = deleteDocuments(deps, docs);
  createAuditLog(deps.db, deps.clock).recordAudit({
    type: 'upload_purged',
    actor: options.actor,
    details: { cutoff, retentionDays, uploads: uploadIds.slice(0, 50), files: result.files, cacheEntriesRemoved: result.cacheEntriesRemoved },
  });
  return { cutoff, uploadIds, ...result, dryRun: false };
}
