// createOverview (Prompt 7, U4): gather current cases (read-only), build the overview model, hash its canonical
// text, and store it ONCE under output/overview/<runDate>/<hash prefix>/overview.xlsx. The same content again is
// a no-op that returns the same export record. Recorded in the exports table and audited 'overview_created'.
// Downloads read the stored relative path by export id and check it stays inside OUTPUT_DIR (resolveExportPath).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriveOverallRisk } from '../compare/compareTerms.js';
import type { DataSource } from '../data/datasource.js';
import { daysBetween, type InstantClock } from '../domain/dates.js';
import type { IsoDate, RenewalStatus } from '../domain/types.js';
import { type AuditActor, createAuditLog } from '../state/audit.js';
import type { Db } from '../state/db.js';
import { getActivePack, listCases } from '../state/repo.js';
import { type ExportRow, getExport, getExportByHash, insertExport } from '../uploads/repo.js';
import { buildOverviewModel, DEFAULT_OVERVIEW_STATUSES, type OverviewCase, type OverviewFilters, overviewModelText, OVERVIEW_STATUSES, renderOverviewWorkbook } from './buildOverviewXlsx.js';
import { POLICY_TYPE_LABELS } from './labels.js';

export interface OverviewDeps {
  db: Db;
  clock: InstantClock;
  /** A data source that also resolves manual records (ManualAwareSource). Read only. */
  dataSource: DataSource;
  outputDir: string;
}

export type OverviewResult = { kind: 'created' | 'existing'; record: ExportRow } | { kind: 'empty' };

const STATUS_WORDS: Record<RenewalStatus, string> = {
  not_started: 'Not started',
  drafted: 'Drafted',
  needs_attention: 'Needs attention',
  in_review: 'In review',
  approved: 'Approved',
  skipped: 'Skipped',
};

/** Only known statuses survive; an empty list means the default. */
export function normaliseFilters(input: { statuses?: readonly string[]; includeManual?: boolean }): OverviewFilters {
  const statuses = OVERVIEW_STATUSES.filter((s) => (input.statuses ?? []).includes(s));
  return { statuses: statuses.length ? [...statuses] : [...DEFAULT_OVERVIEW_STATUSES], includeManual: input.includeManual !== false };
}

function timing(days: number): string {
  if (days < 0) return `expired ${-days} ${days === -1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'today';
  if (days < 7) return `in ${days} ${days === 1 ? 'day' : 'days'}`;
  const weeks = Math.floor(days / 7);
  return `in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

async function gatherCases(deps: OverviewDeps, runDate: IsoDate, filters: OverviewFilters): Promise<OverviewCase[]> {
  const cases: OverviewCase[] = [];
  for (const caseRow of listCases(deps.db)) {
    if (!filters.statuses.includes(caseRow.status)) continue;
    const pack = getActivePack(deps.db, caseRow.id);
    const manual = caseRow.origin === 'manual' || pack?.inputSource === 'upload';
    if (manual && !filters.includeManual) continue;
    const policy = await deps.dataSource.getPolicy(caseRow.policyId);
    if (!policy) continue;
    const client = await deps.dataSource.getClient(policy.clientId);
    cases.push({
      policyId: policy.id,
      clientName: client?.name ?? '(unknown client)',
      policyTypeLabel: POLICY_TYPE_LABELS[policy.type],
      insurerName: policy.insurerName,
      expiryDate: policy.expiryDate,
      timing: timing(daysBetween(runDate, policy.expiryDate)),
      risk: pack ? deriveOverallRisk(pack.pack.diffs, pack.pack.flags) : null,
      flags: pack?.pack.flags ?? [],
      topChange: pack ? (pack.pack.diffs[0]?.facts ?? 'No changes found.') : 'No pack: needs a manual check.',
      statusLabel: STATUS_WORDS[caseRow.status],
      source: manual ? 'Uploaded manually' : 'Nightly run',
      version: pack?.version ?? null,
    });
  }
  return cases.sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0));
}

/** Resolve a stored export path (relative to OUTPUT_DIR) and refuse anything that leaves overview/. */
export function resolveExportPath(outputDir: string, relativePath: string): string {
  if (!/^overview\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{12}\/overview\.xlsx$/.test(relativePath)) throw new Error('Stored export path is not valid');
  const base = path.resolve(outputDir, 'overview');
  const target = path.resolve(outputDir, ...relativePath.split('/'));
  const rel = path.relative(base, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Stored export path escapes the output folder');
  return target;
}

export function exportFilePath(deps: Pick<OverviewDeps, 'db' | 'outputDir'>, exportId: number): { record: ExportRow; absolutePath: string } | null {
  const record = Number.isInteger(exportId) ? getExport(deps.db, exportId) : undefined;
  if (!record) return null;
  const absolutePath = resolveExportPath(deps.outputDir, record.relativePath);
  return existsSync(absolutePath) ? { record, absolutePath } : null;
}

export async function createOverview(input: { filters: OverviewFilters; runDate: IsoDate; actor: AuditActor }, deps: OverviewDeps): Promise<OverviewResult> {
  const cases = await gatherCases(deps, input.runDate, input.filters);
  if (cases.length === 0) return { kind: 'empty' };
  const model = buildOverviewModel({ runDate: input.runDate, filters: input.filters, cases });
  const contentHash = createHash('sha256').update(overviewModelText(model)).digest('hex');
  const relativePath = `overview/${input.runDate}/${contentHash.slice(0, 12)}/overview.xlsx`;
  const absolutePath = resolveExportPath(deps.outputDir, relativePath);
  const audit = createAuditLog(deps.db, deps.clock);
  const existing = getExportByHash(deps.db, contentHash);
  if (existing && existsSync(absolutePath)) {
    audit.recordAudit({ type: 'overview_created', actor: input.actor, details: { exportId: existing.id, rows: existing.rowCount, created: false } });
    return { kind: 'existing', record: existing };
  }
  const bytes = await renderOverviewWorkbook(model, input.runDate);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  const temp = `${absolutePath}.tmp`;
  writeFileSync(temp, bytes);
  renameSync(temp, absolutePath);
  const record =
    existing ??
    insertExport(deps.db, deps.clock, {
      filters: { statuses: input.filters.statuses, includeManual: input.filters.includeManual },
      relativePath,
      contentHash,
      rowCount: model.rowCount,
    });
  audit.recordAudit({ type: 'overview_created', actor: input.actor, details: { exportId: record.id, rows: model.rowCount, truncated: model.truncated, created: true } });
  return { kind: 'created', record };
}
