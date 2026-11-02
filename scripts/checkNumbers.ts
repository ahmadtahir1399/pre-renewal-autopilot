// npm run docs:check-numbers
// Lists every number in README.md, docs/CASE_STUDY.md, docs/RESULTS_SUMMARY.md and
// docs/private/NOTE_TO_AGENCY.md (when they exist) that is NOT found in the final live evaluation JSON,
// in fixtures/README.md, or in the justified allowlist (scripts/eval/numbers.ts). It never auto-passes:
// unmatched numbers are printed for the author's review and the exit code is 1.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ALLOWLIST, extractNumbers, knownFromJson, unmatchedNumbers } from './eval/numbers.js';

const DOCS = ['README.md', path.join('docs', 'CASE_STUDY.md'), path.join('docs', 'RESULTS_SUMMARY.md'), path.join('docs', 'private', 'NOTE_TO_AGENCY.md')];

const reports = existsSync('reports') ? readdirSync('reports').filter((f) => /^eval-\d{4}-\d{2}-\d{2}-live\.json$/.test(f)).sort() : [];
const latest = reports[reports.length - 1];
const { known, numbers } = latest ? knownFromJson(JSON.parse(readFileSync(path.join('reports', latest), 'utf8'))) : { known: new Set<string>(), numbers: [] as number[] };
for (const n of extractNumbers(readFileSync(path.join('fixtures', 'README.md'), 'utf8'))) known.add(n);

const files = DOCS.filter((f) => existsSync(f)).map((file) => ({ file, text: readFileSync(file, 'utf8') }));
console.log(`Evaluation JSON: ${latest ? `reports/${latest}` : 'NONE FOUND (only fixtures/README.md and the allowlist can match)'}`);
console.log(`Checked: ${files.map((f) => f.file).join(', ') || '(none of the documents exist yet)'}`);
console.log(`Allowlist (${ALLOWLIST.length}): ${ALLOWLIST.map(([n]) => n).join(', ')}`);
const unmatched = unmatchedNumbers(files, known, numbers);
if (unmatched.length === 0) {
  console.log('Every number was found in the evaluation JSON, fixtures/README.md or the allowlist.');
  process.exit(0);
}
console.log(`\nUNMATCHED numbers (${unmatched.length}) - review each one by hand:`);
for (const u of unmatched) console.log(`  ${u.file}: ${u.number}`);
process.exit(1);
