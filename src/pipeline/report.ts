// Readable text tables for the terminal: run summary, status, audit timeline.

import { deriveOverallRisk } from '../compare/compareTerms.js';
import type { AuditEvent } from '../state/audit.js';
import type { CaseRow, PackRow } from '../state/repo.js';
import type { RunSummary } from './runPipeline.js';

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ').trimEnd();
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

export function formatRunSummary(summary: RunSummary): string {
  if (summary.blocked) return `Run ${summary.dryRun ? '(dry run) ' : ''}blocked: ${summary.blockedReason}`;
  const rows = summary.rows.map((r) => [
    r.policyId,
    r.outcome,
    r.overallRisk ?? '-',
    r.version === undefined ? '-' : `v${r.version}`,
    r.fromCache === undefined ? '-' : r.fromCache ? 'yes' : 'no',
    `${r.tokens.inputTokens}/${r.tokens.outputTokens}`,
    r.note ?? '',
  ]);
  const counts = Object.entries(summary.counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join('  ');
  return [
    `${summary.dryRun ? 'DRY RUN (nothing was written)' : `Run ${summary.runId}`} for ${summary.today}`,
    table(['Policy', 'Outcome', 'Risk', 'Version', 'Cached', 'Tokens in/out', 'Note'], rows),
    '',
    `Totals: ${counts}`,
    `Tokens: ${summary.totalTokens.inputTokens} in / ${summary.totalTokens.outputTokens} out   Duration: ${summary.totalDurationMs} ms`,
  ].join('\n');
}

export function formatStatus(cases: CaseRow[], activePackByCase: Map<number, PackRow>): string {
  const rows = cases.map((c) => {
    const pack = activePackByCase.get(c.id);
    return [
      c.policyId,
      c.cycleKey,
      c.status,
      pack ? `#${pack.id} v${pack.version}` : '-',
      pack ? deriveOverallRisk(pack.pack.diffs, pack.pack.flags) : '-',
      pack ? String(pack.pack.flags.length) : '-',
      pack?.syncState ?? '-',
      c.attentionReason ?? '',
    ];
  });
  return table(['Policy', 'Cycle', 'Status', 'Pack', 'Risk', 'Flags', 'Sync', 'Attention'], rows);
}

function describeDetails(event: AuditEvent): string {
  const d = event.details;
  switch (event.type) {
    case 'status_changed':
      return `${d.from} -> ${d.to}${d.forced ? ' (forced)' : ''}${d.reason ? ` because ${d.reason}` : ''}`;
    case 'documents_checked':
      return `expiring ${d.expiring ? 'found' : 'MISSING'}, renewal ${d.renewal ? 'found' : 'MISSING'}`;
    case 'terms_extracted':
      return `${d.kind} document read${d.fromCache ? ' from cache' : ''} (${d.inputTokens} in / ${d.outputTokens} out tokens, ${d.warnings} warnings${d.repaired ? `, ${d.repaired} confirmed on a second reading` : ''})`;
    case 'comparison_done':
      return `overall risk ${d.overallRisk}; ${d.diffs} changes, ${d.flags} flags`;
    case 'pack_written':
      return `version ${d.version} written to ${d.dir}`;
    case 'pack_superseded':
      return `version ${d.oldVersion} replaced by version ${d.newVersion}`;
    // Prompt 7: uploads (details hold ids, codes, short hashes and counts only).
    case 'upload_received':
      return `upload ${d.uploadId} received (${d.mode} mode, ${d.files} file(s), consent ${d.consent ? 'given' : 'NOT given'})`;
    case 'upload_rejected':
      return `upload ${d.uploadId} refused at the door: ${d.code}${d.side ? ` (${d.side})` : ''}`;
    case 'analysis_started':
      return `upload ${d.uploadId} analysis started: expiring ${d.expiring}, renewal ${d.renewal}${d.fakeLlm ? ' (fake mode)' : ''}`;
    case 'analysis_finished':
      return `upload ${d.uploadId} finished: ${d.outcome}${d.version ? `, pack version ${d.version}` : ''} (${d.tokensIn} in / ${d.tokensOut} out tokens)`;
    case 'analysis_failed':
      return `upload ${d.uploadId} failed: ${d.code} (no pack prepared)`;
    case 'analysis_interrupted':
      return `upload ${d.uploadId} was interrupted while ${d.from}; marked failed`;
    case 'manual_case_created':
      return `manual policy created for client ${d.clientId}${d.clientCreated ? ' (new client)' : ''} from upload ${d.uploadId}`;
    case 'manual_override_set':
      return `upload ${d.uploadId} pack v${d.version} is now in place; the nightly run will leave this case alone (U-4)`;
    case 'upload_deleted':
      return `upload ${d.uploadId}: ${d.files} stored PDF(s) deleted, ${d.cacheEntriesRemoved} cache entries removed`;
    case 'upload_purged':
      return `${d.files} stored PDF(s) older than ${d.retentionDays} days deleted`;
    case 'approved':
      return `pack ${d.packId} v${d.version} approved via ${d.channel}${d.dataSource ? `; ${d.dataSource}` : ''}`;
    default:
      return Object.keys(d).length === 0 ? '' : JSON.stringify(d);
  }
}

export function formatAuditTimeline(policyId: string, events: AuditEvent[]): string {
  if (events.length === 0) return `No audit events for ${policyId}.`;
  const rows = events.map((e) => [e.at.replace('T', ' ').replace(/\.\d+Z$/, 'Z'), e.type, e.actor, describeDetails(e)]);
  return [`Audit timeline for ${policyId}`, table(['When (UTC)', 'Event', 'Actor', 'What happened'], rows)].join('\n');
}
