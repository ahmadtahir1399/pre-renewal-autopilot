// LIVE check: extracts both documents of pol-s01, pol-s03, pol-s04 and pol-s14 (8 extractions,
// cache on) and compares every fact with the answer keys. Exact comparison, nothing rounded.
//   PowerShell: $env:RUN_LIVE_LLM='1'; npm run live:check
// Writes reports/live-check-prompt2.json (reports/ is gitignored). Never prints document text.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvOrExit } from '../src/config/env.js';
import { JsonFileExtractionCache, readPolicyTerms } from '../src/documents/index.js';
import { parseGroundTruth } from '../src/domain/schemas.js';
import type { ExtractedTerms } from '../src/domain/types.js';
import { createLlmClient } from '../src/llm/client.js';

const env = loadEnvOrExit();
if (!env.RUN_LIVE_LLM) {
  process.stderr.write('Refusing to run: this makes LIVE LLM calls. Set RUN_LIVE_LLM=1 (PowerShell: $env:RUN_LIVE_LLM=\'1\').\n');
  process.exit(1);
}

const POLICIES = ['pol-s01', 'pol-s03', 'pol-s04', 'pol-s14'];
const KINDS = ['expiring', 'renewal'] as const;
const FACTS = ['insurerName', 'policyNumber', 'policyType', 'periodStart', 'periodEnd', 'annualPremium', 'excess', 'coverLimit'] as const;

interface Difference {
  field: string;
  expected: unknown;
  actual: unknown;
}

function compare(expected: ExtractedTerms, actual: ExtractedTerms): Difference[] {
  const diffs: Difference[] = [];
  for (const field of FACTS) {
    const e = expected[field];
    const a = actual[field];
    if (e.value !== a.value) diffs.push({ field: `${field}.value`, expected: e.value, actual: a.value });
    if (e.sourcePage !== a.sourcePage) diffs.push({ field: `${field}.sourcePage`, expected: e.sourcePage, actual: a.sourcePage });
    if (a.value !== null && (a.sourcePage === null || !a.sourceQuote)) {
      diffs.push({ field: `${field}.pageAndQuote`, expected: 'page and quote present', actual: { sourcePage: a.sourcePage, sourceQuote: a.sourceQuote } });
    }
  }
  const pairs = (t: ExtractedTerms) => t.keyExclusions.map((x) => `${x.key}@p${x.sourcePage}`).sort();
  const expectedPairs = pairs(expected);
  const actualPairs = pairs(actual);
  if (JSON.stringify(expectedPairs) !== JSON.stringify(actualPairs)) {
    diffs.push({ field: 'keyExclusions(key@page)', expected: expectedPairs, actual: actualPairs });
  }
  return diffs;
}

const llm = createLlmClient(env);
const cache = new JsonFileExtractionCache();
const rows: Array<Record<string, unknown>> = [];
let newInput = 0;
let newOutput = 0;

for (const policyId of POLICIES) {
  const gt = parseGroundTruth(JSON.parse(readFileSync(path.join(env.FIXTURES_DIR, 'ground-truth', `${policyId}.json`), 'utf8')));
  for (const kind of KINDS) {
    const expected = gt.expectedTerms[kind];
    if (!expected) throw new Error(`${policyId} ${kind} has no expected terms`);
    const result = await readPolicyTerms(path.join(env.FIXTURES_DIR, 'documents', policyId, `${kind}.pdf`), {
      llm,
      cache,
      policyId,
      documentKind: kind,
    });
    if (!result.fromCache) {
      newInput += result.usage.inputTokens;
      newOutput += result.usage.outputTokens;
    }
    const differences = compare(expected, result.terms);
    const lowConfidence = FACTS.filter((f) => result.terms[f].confidence === 'low');
    rows.push({
      policyId,
      kind,
      fromCache: result.fromCache,
      usage: result.usage,
      differences,
      warnings: result.warnings,
      lowConfidence,
      exclusionKeys: result.terms.keyExclusions.map((x) => x.key),
    });
    process.stdout.write(
      `${policyId} ${kind.padEnd(8)} ${result.fromCache ? 'CACHE' : 'LIVE '} in=${result.usage.inputTokens} out=${result.usage.outputTokens} ` +
        `differences=${differences.length} warnings=${result.warnings.length} lowConfidence=[${lowConfidence.join(',')}]\n`,
    );
    for (const d of differences) process.stdout.write(`    DIFF ${d.field}: expected ${JSON.stringify(d.expected)} actual ${JSON.stringify(d.actual)}\n`);
    for (const w of result.warnings) process.stdout.write(`    WARN ${w.field} ${w.code}: ${w.message}\n`);
  }
}

const s04 = rows.filter((r) => r.policyId === 'pol-s04').map((r) => (r.exclusionKeys as string[]).includes('gradual_deterioration'));
const totalDifferences = rows.reduce((n, r) => n + (r.differences as Difference[]).length, 0);
const summary = {
  model: llm.model,
  documents: rows.length,
  totalDifferences,
  s04GradualDeteriorationInBoth: s04.length === 2 && s04.every(Boolean),
  newTokensThisRun: { inputTokens: newInput, outputTokens: newOutput },
  originalTokensAllDocuments: rows.reduce(
    (acc: { inputTokens: number; outputTokens: number }, r) => {
      const u = r.usage as { inputTokens: number; outputTokens: number };
      return { inputTokens: acc.inputTokens + u.inputTokens, outputTokens: acc.outputTokens + u.outputTokens };
    },
    { inputTokens: 0, outputTokens: 0 },
  ),
};
process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
mkdirSync('reports', { recursive: true });
writeFileSync(path.join('reports', 'live-check-prompt2.json'), `${JSON.stringify({ summary, rows }, null, 2)}\n`, 'utf8');
process.stdout.write('Saved reports/live-check-prompt2.json\n');
