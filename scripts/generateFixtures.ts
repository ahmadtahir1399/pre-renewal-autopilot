// npm run fixtures:generate
// Deterministically (re)builds everything under fixtures/ except the hash snapshot:
//   fixtures/data/*.json, fixtures/documents/<policyId>/{expiring,renewal}.pdf,
//   fixtures/ground-truth/<policyId>.json, fixtures/README.md
// Running it twice gives byte-identical files (check with npm run fixtures:hash).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cycleKey, daysBetween } from '../src/domain/dates.js';
import {
  parseBrokers,
  parseClients,
  parseGroundTruth,
  parseInsurers,
  parsePolicies,
  parseSeedState,
} from '../src/domain/schemas.js';
import type { GroundTruth, Policy, SeedState } from '../src/domain/types.js';
import { BROKERS, CLIENTS, INSURERS } from './fixtures/catalog.js';
import { buildDocument, CONDITIONS_PAGE, expiryDateOf } from './fixtures/documentModel.js';
import { computeExpectedComparison, expectedTermsFor } from './fixtures/expectations.js';
import { renderImageOnlyPdf, renderTextPdf } from './fixtures/pdfWriter.js';
import { REFERENCE_DATE, SCENARIOS, type ScenarioSpec } from './fixtures/scenarios.js';

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, 'fixtures');
const DATA_DIR = path.join(FIXTURES, 'data');
const DOCS_DIR = path.join(FIXTURES, 'documents');
const TRUTH_DIR = path.join(FIXTURES, 'ground-truth');

/** Project-root relative, forward slashes (D-007). */
const docPath = (policyId: string, kind: 'expiring' | 'renewal') => `fixtures/documents/${policyId}/${kind}.pdf`;

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function policyFor(spec: ScenarioSpec): Policy {
  const client = CLIENTS[spec.clientIndex];
  const broker = BROKERS[spec.brokerIndex];
  const insurer = INSURERS[spec.insurerIndex];
  if (!client || !broker || !insurer) throw new Error(`Bad index in ${spec.id}`);
  return {
    id: spec.policyId,
    clientId: client.id,
    brokerId: broker.id,
    insurerName: insurer.name,
    type: spec.type,
    expiryDate: expiryDateOf(spec),
    annualPremium: spec.expiring.premium,
    status: 'not_started',
    expiringDocPath: docPath(spec.policyId, 'expiring'),
    ...(spec.renewalDocument === 'missing' ? {} : { renewalDocPath: docPath(spec.policyId, 'renewal') }),
  };
}

const ATTENTION_MESSAGES = {
  renewal_document_missing:
    'The renewal offer document is missing for this cycle. A person must obtain it before a pack can be prepared.',
  expiring_document_unreadable:
    'The expiring policy PDF has no text layer (image-only scan). A person must check it or supply a text version.',
} as const;

/** Throws if the computed answer key disagrees with the hand-written expectation in scenarios.ts. */
function crossCheck(spec: ScenarioSpec, computed: ReturnType<typeof computeExpectedComparison>): void {
  const shape = (items: Array<{ field: string; severity: string; change?: string }>) =>
    JSON.stringify(items.map((i) => [i.field, i.change ?? '', i.severity]));
  const problems: string[] = [];
  if (shape(computed.diffs) !== shape(spec.expect.diffs)) {
    problems.push(`diffs computed ${shape(computed.diffs)} but expected ${shape(spec.expect.diffs)}`);
  }
  if (shape(computed.flags) !== shape(spec.expect.flags)) {
    problems.push(`flags computed ${shape(computed.flags)} but expected ${shape(spec.expect.flags)}`);
  }
  if (computed.overallRisk !== spec.expect.overallRisk) {
    problems.push(`overallRisk computed ${computed.overallRisk} but expected ${spec.expect.overallRisk}`);
  }
  if (problems.length > 0) throw new Error(`Answer key mismatch for ${spec.id}:\n  ${problems.join('\n  ')}`);
}

function groundTruthFor(spec: ScenarioSpec, expiringDoc: ReturnType<typeof buildDocument>): GroundTruth {
  const expiryDate = expiryDateOf(spec);
  const renewalDoc = spec.renewalDocument === 'missing' ? null : buildDocument(spec, 'renewal');
  const expiringReadable = spec.expiringDocument === 'text';
  const expectedExpiring = expiringReadable ? expectedTermsFor(expiringDoc) : null;
  const expectedRenewal = renewalDoc ? expectedTermsFor(renewalDoc) : null;

  let comparison: ReturnType<typeof computeExpectedComparison> | null = null;
  if (spec.expect.pack) {
    if (!expectedExpiring || !expectedRenewal) throw new Error(`${spec.id} expects a pack but lacks readable documents`);
    comparison = computeExpectedComparison(expectedExpiring, expectedRenewal);
    crossCheck(spec, comparison);
  }

  return parseGroundTruth(
    {
      schemaVersion: 1,
      scenarioId: spec.id,
      policyId: spec.policyId,
      description: `${spec.whatChanges} Expected: ${spec.expectedResult}`,
      referenceDate: REFERENCE_DATE,
      expiryDate,
      daysToExpiry: daysBetween(REFERENCE_DATE, expiryDate),
      cycleKey: cycleKey(spec.policyId, expiryDate),
      expectedSelection: { selected: spec.expect.selected, skipReason: spec.expect.skipReason },
      documents: {
        expiring: { path: docPath(spec.policyId, 'expiring'), exists: true, hasTextLayer: expiringReadable },
        renewal: renewalDoc
          ? { path: docPath(spec.policyId, 'renewal'), exists: true, hasTextLayer: true }
          : { path: null, exists: false, hasTextLayer: null },
      },
      expectedTerms: { expiring: expectedExpiring, renewal: expectedRenewal },
      expectedAttention: spec.expect.attention
        ? { reason: spec.expect.attention, message: ATTENTION_MESSAGES[spec.expect.attention] }
        : null,
      expectsPack: spec.expect.pack,
      expectedDiffs: comparison?.diffs ?? null,
      expectedFlags: comparison?.flags ?? null,
      expectedOverallRisk: comparison?.overallRisk ?? null,
      expectedFinalStatus: spec.expect.finalStatus,
      injectedInstruction:
        spec.injectedInstruction === null ? null : { page: CONDITIONS_PAGE, text: spec.injectedInstruction },
    },
    `ground-truth/${spec.policyId}`,
  );
}

function readmeFor(truths: GroundTruth[]): string {
  const rows = SCENARIOS.map((spec, index) => {
    const truth = truths[index];
    if (!truth) throw new Error('missing ground truth');
    const flags = truth.expectedFlags?.map((f) => `${f.field} (${f.severity})`).join(', ') || '-';
    return `| ${spec.id} | ${spec.policyId} | ${spec.type} | ${spec.days} | ${truth.expiryDate} | ${spec.whatChanges.replace(/\|/g, '/')} | ${spec.expectedResult} | ${flags} | ${truth.expectedOverallRisk ?? '-'} | ${truth.expectedFinalStatus} |`;
  });
  return [
    '# fixtures - synthetic brokerage and answer keys',
    '',
    'GENERATED by `npm run fixtures:generate` - do not edit by hand. Everything here is invented (synthetic data only).',
    `Reference date: ${REFERENCE_DATE}. Currency NZD. Renewal window 84 to 112 days, inclusive.`,
    '',
    '| Scenario | Policy id | Type | Days | Expiry date | What changes | Expected result | Expected flags | Overall risk | Final status |',
    '| -------- | --------- | ---- | ---- | ----------- | ------------ | --------------- | -------------- | ------------ | ------------ |',
    ...rows,
    '',
    '## Layout',
    '',
    '- `data/` clients (5, three policies each), brokers (2, placeholder Telegram chat ids), insurers (4), policies (15, all `not_started`), seed-state (pol-s12 approved for its cycle).',
    '- `documents/<policyId>/expiring.pdf` and `renewal.pdf`: fixed 4-page layout. Page 1 schedule, page 2 cover sections, page 3 conditions, page 4 exclusions.',
    '- `ground-truth/<policyId>.json`: expected selection, expected ExtractedTerms for both documents (value, page, exact quote), expected diffs, flags, overall risk and final status (decisions D-B to D-D).',
    '- pol-s07 has no renewal PDF. pol-s08 expiring.pdf is image-only (no text layer). pol-s14 page 3 contains an injected instruction that must be ignored.',
    '- `fixtures.sha256`: hash snapshot written by `npm run fixtures:hash` (excluded from the hash itself).',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  for (const dir of [DATA_DIR, DOCS_DIR, TRUTH_DIR]) rmSync(dir, { recursive: true, force: true });
  for (const dir of [DATA_DIR, DOCS_DIR, TRUTH_DIR]) mkdirSync(dir, { recursive: true });

  const policies = parsePolicies(SCENARIOS.map(policyFor));
  writeJson(path.join(DATA_DIR, 'clients.json'), parseClients(CLIENTS));
  writeJson(path.join(DATA_DIR, 'brokers.json'), parseBrokers(BROKERS));
  writeJson(path.join(DATA_DIR, 'insurers.json'), parseInsurers(INSURERS.map(({ id, name }) => ({ id, name }))));
  writeJson(path.join(DATA_DIR, 'policies.json'), policies);

  const seed: SeedState = parseSeedState({
    records: SCENARIOS.filter((s) => s.seededApproved).map((s) => ({
      policyId: s.policyId,
      cycleKey: cycleKey(s.policyId, expiryDateOf(s)),
      status: 'approved',
    })),
  });
  writeJson(path.join(DATA_DIR, 'seed-state.json'), seed);

  const truths: GroundTruth[] = [];
  for (const spec of SCENARIOS) {
    const policyDir = path.join(DOCS_DIR, spec.policyId);
    mkdirSync(policyDir, { recursive: true });
    const expiringDoc = buildDocument(spec, 'expiring');
    const expiringBytes =
      spec.expiringDocument === 'image_only' ? await renderImageOnlyPdf(expiringDoc) : await renderTextPdf(expiringDoc);
    writeFileSync(path.join(policyDir, 'expiring.pdf'), expiringBytes);
    if (spec.renewalDocument === 'text') {
      writeFileSync(path.join(policyDir, 'renewal.pdf'), await renderTextPdf(buildDocument(spec, 'renewal')));
    }
    const truth = groundTruthFor(spec, expiringDoc);
    writeJson(path.join(TRUTH_DIR, `${spec.policyId}.json`), truth);
    truths.push(truth);
  }

  writeFileSync(path.join(FIXTURES, 'README.md'), readmeFor(truths), 'utf8');

  const pdfCount = SCENARIOS.reduce((n, s) => n + 1 + (s.renewalDocument === 'text' ? 1 : 0), 0);
  process.stdout.write(
    `Generated ${policies.length} policies, ${pdfCount} PDFs, ${truths.length} ground-truth files (reference date ${REFERENCE_DATE}).\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
