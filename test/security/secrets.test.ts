// SECRETS NEVER APPEAR. A full CLI flow runs in a throwaway folder (no .env there) with dummy SENTINEL
// secrets in the environment, then the database file, audit rows, every log/console line, output/,
// the data folder, reports/ and the web responses are scanned for the sentinels and for secret-shaped
// strings. The CLI runs as child processes with --fake-llm, so nothing reaches any network.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../../src/approval/actions.js';
import { WebApprovalServer } from '../../src/approval/web/server.js';
import { LocalJsonSource } from '../../src/data/localJsonSource.js';
import { manualInstantClock } from '../../src/domain/dates.js';
import { listAllAudit } from '../../src/state/audit.js';
import { type Db, openDatabase } from '../../src/state/db.js';
import { httpGet } from './support.js';

const PROJECT = process.cwd();
const SENTINELS = {
  LLM_API_KEY: 'sk-SENTINELllmkey0123456789abcdefABCDEF',
  TELEGRAM_BOT_TOKEN: '123456789:SENTINELbottokenAAAAAAAAAAAAAAAAAAAAAAAA',
  APPROVAL_WEB_TOKEN: 'SENTINEL-web-token-0123456789abcdef',
};
const WRONG_TOKEN = 'SENTINEL-wrong-token-guess-987654';
const SECRET_SHAPES: Array<[string, RegExp]> = [
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{16,}/],
  ['Telegram bot token', /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/],
  ['Bearer header', /\bBearer\s+[A-Za-z0-9._-]{10,}/],
];

let root = '';
const captured: string[] = [];

function cli(args: string[]): { status: number | null; out: string } {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    ...SENTINELS,
    LLM_PROVIDER: 'openai',
    LLM_MODEL: 'test-model',
    TELEGRAM_ALLOWED_CHAT_IDS: '111',
    APPROVAL_CHANNELS: 'web',
    FIXTURES_DIR: path.join(PROJECT, 'fixtures'),
    DATA_DIR: path.join(root, 'data'),
    OUTPUT_DIR: path.join(root, 'output'),
    DB_PATH: path.join(root, 'runtime', 'autopilot.db'),
    REFERENCE_DATE: '2026-10-19',
    RUN_LIVE_LLM: 'false',
  };
  const result = spawnSync(process.execPath, [path.join(PROJECT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(PROJECT, 'src', 'cli', 'index.ts'), ...args], { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  captured.push(out);
  return { status: result.status, out };
}

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function leaks(label: string, text: string): string[] {
  const found: string[] = [];
  for (const [name, value] of Object.entries({ ...SENTINELS, WRONG_TOKEN })) if (text.includes(value)) found.push(`${label}: contains ${name}`);
  for (const [name, pattern] of SECRET_SHAPES) if (pattern.test(text)) found.push(`${label}: ${name}-shaped string`);
  return found;
}

describe('secrets never appear anywhere', () => {
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'pra-secrets-'));
    mkdirSync(path.join(root, 'templates'), { recursive: true });
    copyFileSync(path.join(PROJECT, 'templates', 'comparison.xlsx'), path.join(root, 'templates', 'comparison.xlsx'));
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('a full CLI flow (reset, fake run, status, audit, approve, skip) succeeds with sentinel secrets set', () => {
    expect(cli(['reset-demo']).status).toBe(0);
    const run = cli(['run', '--fake-llm']);
    expect(run.status).toBe(0);
    expect(run.out).toContain('new_pack=11');
    const status = cli(['status']).out;
    const packId = (policy: string) => new RegExp(`${policy}\\s+\\S+\\s+in_review\\s+#(\\d+)`).exec(status)?.[1];
    expect(packId('pol-s02')).toBeDefined();
    expect(cli(['approve', String(packId('pol-s02'))]).out).toContain('ok:');
    expect(cli(['skip', String(packId('pol-s05'))]).out).toContain('ok:');
    expect(cli(['audit', 'pol-s02']).status).toBe(0);
    expect(cli(['audit', '--attempts']).status).toBe(0);
  }, 300_000);

  it('the web page never echoes its token (or a wrong guess) in any response or audit row', async () => {
    const db: Db = openDatabase(path.join(root, 'runtime', 'autopilot.db'));
    const clock = manualInstantClock('2026-10-18T19:00:00.000Z');
    const dataSource = new LocalJsonSource({ fixturesDir: path.join(PROJECT, 'fixtures'), dataDir: path.join(root, 'data') });
    const server = new WebApprovalServer({ db, clock, dataSource, port: 0, token: SENTINELS.APPROVAL_WEB_TOKEN, approverName: 'broker', today: () => '2026-10-19' });
    const core = createApprovalCore({ db, clock, dataSource, outputDir: path.join(root, 'output'), allowedTelegramChatIds: ['111'] });
    const port = await server.start(core.handleAction);
    try {
      const replies = [await httpGet(port, `/?t=${encodeURIComponent(WRONG_TOKEN)}`), await httpGet(port, `/?t=${encodeURIComponent(SENTINELS.APPROVAL_WEB_TOKEN)}`)];
      const cookie = String(replies[1]?.headers['set-cookie'] ?? '').split(';')[0] ?? '';
      expect(replies[0]?.status).toBe(403);
      expect(replies[1]?.status).toBe(303);
      replies.push(await httpGet(port, '/', { Cookie: cookie }), await httpGet(port, '/pack/1', { Cookie: cookie }));
      const found = replies.flatMap((r, i) => leaks(`web reply ${i}`, `${JSON.stringify(r.headers)}\n${r.text}`));
      found.push(...leaks('audit rows', JSON.stringify(listAllAudit(db))));
      expect(found).toEqual([]);
    } finally {
      await server.stop();
      db.close();
    }
  });

  it('no sentinel or secret-shaped string in the database file, console/log output, output/, data/ or reports/', () => {
    const found: string[] = [];
    found.push(...leaks('console and log output', captured.join('\n')));
    for (const file of [...filesUnder(path.join(root, 'runtime')), ...filesUnder(path.join(root, 'output')), ...filesUnder(path.join(root, 'data'))]) {
      if (statSync(file).size > 20_000_000) continue;
      found.push(...leaks(path.relative(root, file), readFileSync(file).toString('latin1')));
    }
    // reports/ in the project (evaluation reports, raw live results): secret SHAPES only.
    for (const file of filesUnder(path.join(PROJECT, 'reports'))) {
      const text = readFileSync(file, 'utf8');
      for (const [name, pattern] of SECRET_SHAPES) if (pattern.test(text)) found.push(`reports/${path.basename(file)}: ${name}-shaped string`);
    }
    expect(captured.join('').length).toBeGreaterThan(100); // the flow really printed something
    expect(found).toEqual([]);
  });
});
