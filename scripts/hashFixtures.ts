// npm run fixtures:hash            -> print hashes and save the snapshot (fixtures/fixtures.sha256)
// npm run fixtures:hash -- --check -> compare against the saved snapshot; exit 1 if anything differs
// SHA-256 per file under fixtures/ (sorted, forward-slash paths) plus one combined hash.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join(process.cwd(), 'fixtures');
const SNAPSHOT_NAME = 'fixtures.sha256';
const SNAPSHOT = path.join(FIXTURES, SNAPSHOT_NAME);

function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const relative = prefix === '' ? name : `${prefix}/${name}`;
    if (statSync(full).isDirectory()) out.push(...listFiles(full, relative));
    else if (relative !== SNAPSHOT_NAME) out.push(relative);
  }
  return out;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

function buildSnapshot(): { lines: string[]; combined: string } {
  const lines = listFiles(FIXTURES).map((file) => `${sha256(readFileSync(path.join(FIXTURES, ...file.split('/'))))}  ${file}`);
  return { lines, combined: sha256(`${lines.join('\n')}\n`) };
}

const { lines, combined } = buildSnapshot();
const text = `${lines.join('\n')}\ncombined  ${combined}\n`;

if (process.argv.includes('--check')) {
  if (!existsSync(SNAPSHOT)) {
    process.stderr.write('No snapshot yet. Run: npm run fixtures:hash\n');
    process.exit(1);
  }
  const saved = readFileSync(SNAPSHOT, 'utf8');
  const savedCombined = /^combined {2}([a-f0-9]{64})$/m.exec(saved)?.[1];
  if (saved === text) {
    process.stdout.write(`fixtures:hash check OK - ${lines.length} files, combined ${combined} matches the snapshot\n`);
  } else {
    const savedLines = new Set(saved.split('\n'));
    const changed = lines.filter((line) => !savedLines.has(line)).map((line) => line.slice(66));
    process.stderr.write(`fixtures:hash check FAILED - combined ${combined}, snapshot ${savedCombined ?? 'unknown'}\n`);
    for (const file of changed) process.stderr.write(`  changed or new: ${file}\n`);
    process.exit(1);
  }
} else {
  writeFileSync(SNAPSHOT, text, 'utf8');
  process.stdout.write(`${lines.length} files hashed. combined ${combined}\nSnapshot saved to fixtures/${SNAPSHOT_NAME}\n`);
}
