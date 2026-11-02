// Writes one pack folder: output/<runDate>/<clientSlug>/<policyId>/v<version>/
//   comparison.xlsx, client-email.eml, insurer-email.eml, summary.txt, pack.json (manifest)
// Nothing is sent. Versions are immutable: same content -> no-op; different content -> error
// unless allowOverwrite. Returned paths are RELATIVE to outputDir with '/' separators (D-057).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CompareResult } from '../compare/compareTerms.js';
import { describeField } from '../compare/format.js';
import type { Summary } from '../compare/summary.js';
import { parseIsoDate } from '../domain/dates.js';
import { cleanLine, cleanText } from '../domain/text.js';
import type { Broker, Client, ExtractedTerms, IsoDate, Policy } from '../domain/types.js';
import { buildEmails } from './buildEml.js';
import { buildWorkbookModel, renderWorkbook, workbookModelText } from './buildXlsx.js';
import { emlCanonicalText, renderEml } from './eml.js';
import { assertEmailFactsMatch, findBannedPhrases } from './factCheck.js';
import { POLICY_TYPE_LABELS } from './labels.js';
import { TEMPLATE_VERSION } from './templates/emailTemplates.js';

export interface WritePackInput {
  runDate: IsoDate;
  version: number;
  client: Client;
  broker: Broker;
  policy: Policy;
  terms: { expiring: ExtractedTerms; renewal: ExtractedTerms };
  comparison: CompareResult;
  summary: Summary;
  /** Root output directory (env OUTPUT_DIR). */
  outputDir: string;
  /** Defaults to templates/comparison.xlsx under the current directory. */
  templatePath?: string;
  allowOverwrite?: boolean;
  /** Prompt 7: pack prepared from uploaded documents (adds the 'Uploaded manually' Summary row only). */
  uploaded?: boolean;
}

/** All paths are relative to outputDir and use '/' separators. */
export interface PackPaths {
  dir: string;
  xlsx: string;
  clientEml: string;
  insurerEml: string;
  summaryTxt: string;
  manifest: string;
}

export interface WritePackResult {
  paths: PackPaths;
  contentHash: string;
  /** false when an identical pack already existed (no-op). */
  written: boolean;
}

export class PackConflictError extends Error {
  constructor(readonly dir: string) {
    super(`Pack ${dir} already exists with different content; versions are immutable (use a new version, or allowOverwrite)`);
    this.name = 'PackConflictError';
  }
}

const FILES = {
  xlsx: 'comparison.xlsx',
  clientEml: 'client-email.eml',
  insurerEml: 'insurer-email.eml',
  summaryTxt: 'summary.txt',
  manifest: 'pack.json',
} as const;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** Safe folder name: no accents, a-z 0-9 and single hyphens, max 60 chars, never empty or reserved. */
export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug === '' || WINDOWS_RESERVED.test(slug) ? fallback : slug;
}

function assertInside(child: string, parent: string): void {
  const relative = path.relative(parent, child);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside the output directory: ${child}`);
  }
}

export function buildSummaryText(input: Pick<WritePackInput, 'runDate' | 'client' | 'broker' | 'policy' | 'comparison' | 'summary'>): string {
  const { comparison, summary, policy } = input;
  // FIX (D-130): single-line fields cannot break a line; control and bidi characters are removed.
  return cleanText([
    'PRE-RENEWAL COMPARISON - DRAFT FOR BROKER REVIEW (nothing has been sent)',
    '',
    `Client: ${cleanLine(input.client.name)}`,
    `Broker: ${cleanLine(input.broker.name)}`,
    `Policy: ${POLICY_TYPE_LABELS[policy.type]} (${policy.id}) with ${cleanLine(policy.insurerName)}`,
    `Expiry date: ${policy.expiryDate}`,
    `Run date: ${input.runDate}`,
    `Overall risk: ${comparison.overallRisk}`,
    `Items needing attention: ${comparison.flags.length}`,
    '',
    'Key changes:',
    ...summary.headline.map((line) => `- ${line}`),
    '',
    'All changes:',
    ...(summary.details.length > 0 ? summary.details.map((line) => `- ${line}`) : ['- None']),
    '',
    'Needs attention:',
    ...(comparison.flags.length > 0 ? comparison.flags.map((f) => `- [${f.severity}] ${describeField(f.field)}: ${f.message}`) : ['- Nothing']),
    '',
  ].join('\n'));
}

export async function writePack(input: WritePackInput): Promise<WritePackResult> {
  const runDate = parseIsoDate(input.runDate);
  if (!Number.isInteger(input.version) || input.version < 1) throw new RangeError(`version must be a whole number >= 1, got ${input.version}`);

  const segments = [runDate, slugify(input.client.name, 'client'), slugify(input.policy.id, 'policy'), `v${input.version}`];
  const root = path.resolve(input.outputDir);
  const absDir = path.resolve(root, ...segments);
  assertInside(absDir, root);
  const rel = (file: string) => [...segments, file].join('/');
  const paths: PackPaths = {
    dir: segments.join('/'),
    xlsx: rel(FILES.xlsx),
    clientEml: rel(FILES.clientEml),
    insurerEml: rel(FILES.insurerEml),
    summaryTxt: rel(FILES.summaryTxt),
    manifest: rel(FILES.manifest),
  };

  // Build everything in memory first.
  const { diffs, flags, overallRisk } = input.comparison;
  const model = buildWorkbookModel({ ...input, diffs, flags, overallRisk });
  const emails = buildEmails({ ...input, diffs, flags });
  for (const draft of [emails.client, emails.insurer]) assertEmailFactsMatch(draft, diffs, input.policy, input.client);
  const banned = findBannedPhrases(emails.client.body);
  if (banned.length > 0) throw new Error(`Client email contains banned phrases: ${banned.join(', ')}`);
  const summaryText = buildSummaryText(input);

  // Content hash over canonical TEXT (no file bytes, no timestamps, no absolute paths).
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify({
        templateVersion: TEMPLATE_VERSION,
        xlsx: workbookModelText(model),
        clientEmail: emlCanonicalText(emails.client),
        insurerEmail: emlCanonicalText(emails.insurer),
        summary: summaryText,
      }),
    )
    .digest('hex');

  const manifestPath = path.join(absDir, FILES.manifest);
  if (existsSync(absDir)) {
    const existingHash = existsSync(manifestPath)
      ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { contentHash?: string }).contentHash
      : undefined;
    if (existingHash === contentHash) return { paths, contentHash, written: false };
    if (!input.allowOverwrite) throw new PackConflictError(paths.dir);
  }

  const xlsx = await renderWorkbook(model, input.templatePath ?? path.join('templates', 'comparison.xlsx'), runDate);
  mkdirSync(absDir, { recursive: true });
  writeFileSync(path.join(absDir, FILES.xlsx), xlsx);
  writeFileSync(path.join(absDir, FILES.clientEml), renderEml(emails.client), 'utf8');
  writeFileSync(path.join(absDir, FILES.insurerEml), renderEml(emails.insurer), 'utf8');
  writeFileSync(path.join(absDir, FILES.summaryTxt), summaryText, 'utf8');
  const manifest = { contentHash, policyId: input.policy.id, version: input.version, runDate, templateVersion: TEMPLATE_VERSION, files: paths };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { paths, contentHash, written: true };
}
