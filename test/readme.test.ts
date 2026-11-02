// README consistency: every env variable in the schema appears in the README configuration table (and in
// .env.example), and every `npm run <script>` the public docs mention exists in package.json.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EnvSchema } from '../src/config/env.js';

const readme = readFileSync('README.md', 'utf8');
const scripts = Object.keys((JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts);
const PUBLIC_DOCS = ['README.md', 'docs/DEMO_SCRIPT.md', 'docs/ARCHITECTURE.md', 'docs/CASE_STUDY.md', 'docs/RELEASE_CHECKLIST.md', 'docs/LIMITS.md', 'docs/SECURITY.md'];

describe('README and configuration stay in sync', () => {
  it('every env variable in the schema is a row of the README configuration table and is in .env.example', () => {
    const table = readme.slice(readme.indexOf('## Configuration'), readme.indexOf('## Evaluation'));
    const rows = new Set([...table.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]));
    const keys = Object.keys(EnvSchema.shape);
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((k) => !rows.has(k))).toEqual([]);
    expect([...rows].filter((k) => !keys.includes(k as string))).toEqual([]);
    const example = readFileSync('.env.example', 'utf8');
    expect(keys.filter((k) => !new RegExp(`^${k}=`, 'm').test(example))).toEqual([]);
  });

  it('every `npm run <script>` in the public docs exists in package.json', () => {
    const missing: string[] = [];
    for (const file of PUBLIC_DOCS.filter((f) => existsSync(f))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) {
        if (!scripts.includes(match[1] as string)) missing.push(`${file}: npm run ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
