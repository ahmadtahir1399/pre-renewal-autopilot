// npm run build:one -- <policyId>
// Builds a pack from the ANSWER-KEY ExtractedTerms (no AI) using the REAL compareTerms and
// writePack (diffs are computed, not copied). Overwrites v1 for this run date. Prints the paths.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compareTerms } from '../src/compare/compareTerms.js';
import { buildSummary } from '../src/compare/summary.js';
import { loadEnvOrExit } from '../src/config/env.js';
import { LocalJsonSource } from '../src/data/localJsonSource.js';
import { fixedClock } from '../src/domain/dates.js';
import { parseGroundTruth } from '../src/domain/schemas.js';
import { writePack } from '../src/outputs/writePack.js';

const env = loadEnvOrExit();
const policyId = process.argv[2];
if (!policyId || !/^pol-s\d{2}$/.test(policyId)) {
  process.stderr.write('Usage: npm run build:one -- <policyId>   e.g. pol-s15\n');
  process.exit(1);
}

const source = new LocalJsonSource({ fixturesDir: env.FIXTURES_DIR, dataDir: env.DATA_DIR });
const policy = await source.getPolicy(policyId);
if (!policy) throw new Error(`Unknown policy ${policyId}`);
const client = await source.getClient(policy.clientId);
const broker = await source.getBroker(policy.brokerId);
if (!client || !broker) throw new Error(`Missing client or broker for ${policyId}`);

const truth = parseGroundTruth(JSON.parse(readFileSync(path.join(env.FIXTURES_DIR, 'ground-truth', `${policyId}.json`), 'utf8')));
const { expiring, renewal } = truth.expectedTerms;
if (!expiring || !renewal) {
  process.stderr.write(`${policyId} has no readable pair of documents (${truth.expectedAttention?.reason ?? 'no pack expected'}); no pack is built.\n`);
  process.exit(1);
}

const comparison = compareTerms(expiring, renewal, { premiumMediumPct: env.PREMIUM_MEDIUM_PCT, premiumHighPct: env.PREMIUM_HIGH_PCT });
const result = await writePack({
  runDate: fixedClock(env.REFERENCE_DATE ?? '2026-10-19').today(),
  version: 1,
  client,
  broker,
  policy,
  terms: { expiring, renewal },
  comparison,
  summary: buildSummary(comparison.diffs),
  outputDir: env.OUTPUT_DIR,
  allowOverwrite: true,
});

process.stdout.write(
  `${policyId}: overallRisk=${comparison.overallRisk} diffs=${comparison.diffs.length} flags=${comparison.flags.length} written=${result.written}\n` +
    `contentHash ${result.contentHash}\n` +
    Object.entries(result.paths)
      .map(([name, rel]) => `  ${name.padEnd(10)} ${path.join(env.OUTPUT_DIR, ...rel.split('/'))}`)
      .join('\n') +
    '\n',
);
