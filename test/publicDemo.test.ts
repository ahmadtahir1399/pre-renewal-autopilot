// D-123: the public demo mode (no sign-in) and live uploads next to fake demo data. Real HTTP, no network, no key.

import { request } from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../src/approval/actions.js';
import { generateToken, WebApprovalServer } from '../src/approval/web/server.js';
import { FAKE_UPLOAD_NOTE } from '../src/approval/web/uploadViews.js';
import { MemoryExtractionCache } from '../src/documents/index.js';
import { FakeLlmClient } from '../src/llm/fakeClient.js';
import { createLlmReader } from '../src/pipeline/readers.js';
import type { AnalysisDeps } from '../src/uploads/analysisService.js';
import { ManualAwareSource } from '../src/uploads/manualSource.js';
import { listUploads } from '../src/uploads/repo.js';
import { createDemo, type Demo, stripMotionScripts, TODAY } from './helpers.js';
import { sample, sampleTerms } from './uploadHelpers.js';

const PUBLIC = 'demo-host.example.test';
const BOUNDARY = '----pra-public-demo';
let demo: Demo;
let server: WebApprovalServer;
let port: number;
let token: string;

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

function send(method: string, urlPath: string, headers: Record<string, string>, body?: Buffer | string, host = PUBLIC): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: urlPath, headers: { Host: host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const cookieOf = (reply: Reply) => String(reply.headers['set-cookie'] ?? '').split(';')[0] ?? '';
const csrfOf = (html: string) => /name="csrf" value="([a-f0-9]+)"/.exec(html)?.[1] ?? '';

async function start(options: { publicDemo: boolean; liveLlm?: FakeLlmClient; maxSessions?: number }): Promise<void> {
  token = generateToken();
  const source = new ManualAwareSource(demo.dataSource, demo.db);
  server = new WebApprovalServer({
    db: demo.db,
    clock: demo.clock,
    dataSource: source,
    port: 0,
    token,
    approverName: 'Alex Morrow',
    today: () => TODAY,
    fakeLlm: true, // the demo data is fake ...
    publicOrigin: `https://${PUBLIC}`,
    publicDemo: options.publicDemo,
    ...(options.maxSessions ? { maxSessions: options.maxSessions } : {}),
  });
  const analysis: AnalysisDeps = {
    db: demo.db,
    clock: demo.clock,
    dataSource: demo.dataSource,
    // ... while uploads are read "live" (a scripted FakeLlmClient stands in for the model; no registry).
    reader: createLlmReader(options.liveLlm ?? new FakeLlmClient([]), new MemoryExtractionCache()),
    compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 },
    outputDir: demo.outputDir,
    runtimeDir: path.join(demo.dataDir, 'runtime'),
    lockPath: path.join(demo.dataDir, 'runtime', 'run.lock'),
    timeZone: 'Pacific/Auckland',
    today: () => TODAY,
    limits: { maxBytes: 10 * 1024 * 1024, maxPages: 30, parseTimeoutMs: 20_000 },
    dailyLimit: 25,
    timeoutMs: 60_000,
  };
  server.enableUploads({ analysis, retention: { db: demo.db, clock: demo.clock, runtimeDir: analysis.runtimeDir, cacheDir: path.join(demo.root, 'cache'), protectedHashes: new Set() }, brokers: [{ id: 'brk-01', name: 'Alex Morrow' }], retentionDays: 7 });
  port = await server.start(createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: source, outputDir: demo.outputDir, allowedTelegramChatIds: [] }).handleAction);
}

beforeEach(async () => {
  demo = await createDemo();
});
afterEach(async () => {
  await Promise.all([...(server?.pendingAnalyses ?? [])]);
  await server?.stop();
  demo.cleanup();
});

describe('public demo OFF (default): unchanged', () => {
  it('no cookie -> 403; upload pages refused through the public origin', async () => {
    await start({ publicDemo: false });
    const refused = await send('GET', '/', {});
    expect(refused.status).toBe(403);
    expect(refused.text).toContain('Sign-in link needed'); // private mode keeps the sign-in page
    expect((await send('GET', '/?t=not-the-token', {})).status).toBe(403);
    const signed = cookieOf(await send('GET', `/?t=${encodeURIComponent(token)}`, {}));
    expect((await send('GET', '/analysis/new', { Cookie: signed })).status).toBe(403);
  });
});

describe('public demo ON', () => {
  it('a first visit gets a page AND a Secure session cookie, no sign-in; every page says it is a public demo', async () => {
    await start({ publicDemo: true });
    const first = await send('GET', '/', {});
    expect(first.status).toBe(200);
    expect(String(first.headers['set-cookie'])).toMatch(/^pra_session=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/; Secure$/);
    expect(first.text).toContain('<strong>Public demo:</strong> anyone with the link can use this demo, and it resets every night');
    expect(first.text).toContain('href="/analysis/new"');
    expect(stripMotionScripts(first.text)).not.toMatch(/<script|\sstyle=/i);
  });

  it('POSTs still need the cookie, a valid CSRF token and the right Origin', async () => {
    await start({ publicDemo: true });
    const first = await send('GET', '/', {});
    const cookie = cookieOf(first);
    const csrf = csrfOf(first.text);
    const packId = Number(/action="\/pack\/(\d+)\/approve"/.exec(first.text)?.[1]);
    const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
    expect((await send('POST', `/pack/${packId}/approve`, { ...form, Origin: `https://${PUBLIC}` }, `csrf=${csrf}`)).status).toBe(403); // no cookie
    expect((await send('POST', `/pack/${packId}/approve`, { ...form, Cookie: cookie, Origin: `https://${PUBLIC}` }, 'csrf=bad')).status).toBe(403);
    expect((await send('POST', `/pack/${packId}/approve`, { ...form, Cookie: cookie, Origin: 'https://evil.example' }, `csrf=${csrf}`)).status).toBe(403);
    expect((await send('POST', `/pack/${packId}/approve`, { ...form, Cookie: cookie, Origin: `https://${PUBLIC}` }, `csrf=${csrf}`)).status).toBe(303);
  });

  it('D-137: nobody ever sees the sign-in page; a stale page says "out of date", an old ?t= link just opens the demo', async () => {
    await start({ publicDemo: true });
    const first = await send('GET', '/', {});
    const packId = Number(/action="\/pack\/(\d+)\/approve"/.exec(first.text)?.[1]);
    // A form from before the nightly restart: its cookie and CSRF token are no longer known.
    const stale = await send('POST', `/pack/${packId}/approve`, { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `pra_session=${'0'.repeat(64)}`, Origin: `https://${PUBLIC}` }, `csrf=${'0'.repeat(64)}`);
    expect(stale.status).toBe(403);
    expect(stale.text).toContain('This page was out of date');
    expect(stale.text).toContain('href="/"');
    expect(stale.text).not.toContain('Sign-in link needed');
    const oldLink = await send('GET', '/?t=not-the-token', {});
    expect(oldLink.status).toBe(303);
    expect(oldLink.headers.location).toBe('/');
    expect(oldLink.headers['set-cookie']).toBeUndefined();
    expect(oldLink.text).not.toContain('Sign-in link needed');
  });

  it('a visitor uploads their own pair through the public origin; it is read by the "live" reader, not the sample registry', async () => {
    const llm = new FakeLlmClient([sampleTerms('harbourview-expiring.truth.json'), sampleTerms('harbourview-renewal.truth.json')]);
    await start({ publicDemo: true, liveLlm: llm });
    const page = await send('GET', '/analysis/new', {});
    expect(page.status).toBe(200);
    expect(page.text).not.toContain(FAKE_UPLOAD_NOTE); // live uploads: no "only known sample documents" note
    expect(page.text).not.toContain('<strong>Demo mode:</strong>');
    const cookie = cookieOf(page);
    const csrf = csrfOf(page.text);
    const parts: Array<[string, string] | [string, string, Uint8Array]> = [
      ['csrf', csrf],
      ['mode', 'new'],
      ['client_name', 'Visitor Test Ltd'],
      ['broker', 'brk-01'],
      ['expiring', 'mine-expiring.pdf', sample('harbourview-expiring.pdf')],
      ['renewal', 'mine-renewal.pdf', sample('harbourview-renewal.pdf')],
      ['consent', 'yes'],
    ];
    const chunks: Buffer[] = [];
    for (const part of parts) {
      chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
      if (part.length === 2) chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part[0]}"\r\n\r\n${part[1]}\r\n`));
      else chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part[0]}"; filename="${part[1]}"\r\nContent-Type: application/pdf\r\n\r\n`), Buffer.from(part[2]), Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
    const reply = await send('POST', '/analysis', { Cookie: cookie, Origin: `https://${PUBLIC}`, 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` }, Buffer.concat(chunks));
    expect(reply.status).toBe(303);
    await Promise.all([...server.pendingAnalyses]);
    expect(llm.callCount).toBe(2);
    expect(listUploads(demo.db)[0]).toMatchObject({ status: 'done', tokensIn: 2000, tokensOut: 400 });
    const job = await send('GET', String(reply.headers.location), { Cookie: cookie });
    expect(job.text).toContain('The pack is ready');
    expect(job.text).not.toContain('<strong>Demo mode:</strong>'); // this analysis really used the (scripted) model
    expect(job.text).toContain('AI usage: 2000 tokens in, 400 tokens out (counts only).');
    const list = await send('GET', '/', { Cookie: cookie });
    expect(list.text).toContain('<strong>Demo mode:</strong>'); // the nightly demo data is still fake, and says so
  });

  it('sessions are capped; the oldest is dropped first', async () => {
    await start({ publicDemo: false, maxSessions: 3 });
    const cookies: string[] = [];
    for (let i = 0; i < 4; i++) cookies.push(cookieOf(await send('GET', `/?t=${encodeURIComponent(token)}`, {})));
    expect((await send('GET', '/', { Cookie: cookies[0] as string })).status).toBe(403);
    expect((await send('GET', '/', { Cookie: cookies[3] as string })).status).toBe(200);
  });
});
