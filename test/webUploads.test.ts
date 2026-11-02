// Prompt 7 Stage U3: the upload pages over real HTTP (fake mode, no network, no key).
// Multipart bodies are BUILT here by hand (a test client); the server parses them with busboy.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { type ClientRequest, request } from 'node:http';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../src/approval/actions.js';
import { CONTENT_SECURITY_POLICY } from '../src/approval/web/html.js';
import { generateToken, WebApprovalServer } from '../src/approval/web/server.js';
import { CONSENT_TEXT, FAKE_UPLOAD_NOTE } from '../src/approval/web/uploadViews.js';
import { renderErrorPage } from '../src/approval/web/views.js';
import { listAllAudit } from '../src/state/audit.js';
import { all } from '../src/state/db.js';
import { acquireRunGate } from '../src/state/runGate.js';
import type { AnalysisDeps } from '../src/uploads/analysisService.js';
import { createKnownDocumentReader, type KnownDocumentRegistry, loadKnownDocuments } from '../src/uploads/knownDocuments.js';
import { ManualAwareSource } from '../src/uploads/manualSource.js';
import { insertUpload, listUploads, transitionUpload } from '../src/uploads/repo.js';
import { createDemo, type Demo, FIXTURES, stripMotionScripts, TODAY } from './helpers.js';
import { SAMPLES, sample } from './uploadHelpers.js';

const EXPECTED_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const MAX_BYTES = 1024 * 1024;

let registry: KnownDocumentRegistry;
beforeAll(() => {
  registry = loadKnownDocuments({ fixturesDir: FIXTURES, samplesDir: SAMPLES });
});

let demo: Demo;
let server: WebApprovalServer;
let token: string;
let port: number;
let analysis: AnalysisDeps;

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

function send(method: string, urlPath: string, headers: Record<string, string>, body?: Buffer | string, host = `127.0.0.1:${port}`): Promise<Reply> {
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

type Part = { name: string; value: string } | { name: string; filename: string; content: Uint8Array; type?: string };
const BOUNDARY = '----pra-test-boundary-7f3a';

function multipart(parts: Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ('value' in part) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type ?? 'application/pdf'}\r\n\r\n`));
      chunks.push(Buffer.from(part.content));
      chunks.push(Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

const multipartHeaders = (cookie: string, origin: string | null = `http://127.0.0.1:${port}`): Record<string, string> => ({
  Cookie: cookie,
  'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
  ...(origin ? { Origin: origin } : {}),
});

async function login(): Promise<{ cookie: string; csrf: string }> {
  const reply = await send('GET', `/?t=${encodeURIComponent(token)}`, {});
  const cookie = String(reply.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  const page = await send('GET', '/analysis/new', { Cookie: cookie });
  const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(page.text)?.[1] ?? '';
  return { cookie, csrf };
}

async function upload(session: { cookie: string; csrf: string }, parts: Part[], headers?: Record<string, string>): Promise<Reply> {
  const body = multipart(parts);
  return send('POST', '/analysis', { ...multipartHeaders(session.cookie), 'Content-Length': String(body.length), ...headers }, body);
}

const attachParts = (csrf: string, extra: Part[] = []): Part[] => [
  { name: 'csrf', value: csrf },
  { name: 'mode', value: 'attach' },
  { name: 'policy', value: 'pol-s07' },
  { name: 'renewal', filename: 'pol-s07-renewal.pdf', content: sample('pol-s07-renewal.pdf') },
  { name: 'consent', value: 'yes' },
  ...extra,
];

const newParts = (csrf: string, overrides: Record<string, string> = {}, files?: { expiring?: Part; renewal?: Part }): Part[] => [
  { name: 'csrf', value: csrf },
  { name: 'mode', value: 'new' },
  { name: 'client_name', value: overrides.client_name ?? 'Harbourview Bakery Ltd' },
  { name: 'contact_name', value: overrides.contact_name ?? 'Jo Baker' },
  { name: 'contact_email', value: overrides.contact_email ?? 'jo.baker@example.com' },
  { name: 'broker', value: overrides.broker ?? 'brk-01' },
  files?.expiring ?? { name: 'expiring', filename: 'harbourview-expiring.pdf', content: sample('harbourview-expiring.pdf') },
  files?.renewal ?? { name: 'renewal', filename: 'harbourview-renewal.pdf', content: sample('harbourview-renewal.pdf') },
  ...(overrides.consent === 'no' ? [] : [{ name: 'consent', value: 'yes' }]),
];

const settle = () => Promise.all([...server.pendingAnalyses]);
const uploadsDir = () => path.join(demo.dataDir, 'runtime', 'uploads');
const storedFiles = () => (existsSync(uploadsDir()) ? readdirSync(uploadsDir(), { recursive: true }).filter((f) => String(f).endsWith('.pdf')) : []);
const jobIdFrom = (reply: Reply) => Number(/^\/analysis\/(\d+)$/.exec(String(reply.headers.location))?.[1]);

async function startServer(options: { publicOrigin?: string; analysisOverrides?: Partial<AnalysisDeps> } = {}): Promise<void> {
  token = generateToken();
  const source = new ManualAwareSource(demo.dataSource, demo.db);
  const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: source, outputDir: demo.outputDir, allowedTelegramChatIds: [] });
  server = new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource: source, port: 0, token, approverName: 'Alex Morrow', today: () => TODAY, fakeLlm: true, ...(options.publicOrigin ? { publicOrigin: options.publicOrigin } : {}) });
  analysis = {
    db: demo.db,
    clock: demo.clock,
    dataSource: demo.dataSource,
    reader: createKnownDocumentReader(registry),
    knownDocuments: registry,
    compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 },
    outputDir: demo.outputDir,
    runtimeDir: path.join(demo.dataDir, 'runtime'),
    lockPath: path.join(demo.dataDir, 'runtime', 'run.lock'),
    timeZone: 'Pacific/Auckland',
    today: () => TODAY,
    limits: { maxBytes: MAX_BYTES, maxPages: 30, parseTimeoutMs: 20_000 },
    dailyLimit: 10,
    timeoutMs: 60_000,
    ...options.analysisOverrides,
  };
  server.enableUploads({
    analysis,
    retention: { db: demo.db, clock: demo.clock, runtimeDir: path.join(demo.dataDir, 'runtime'), cacheDir: path.join(demo.root, 'cache'), protectedHashes: new Set() },
    brokers: [
      { id: 'brk-01', name: 'Alex Morrow' },
      { id: 'brk-02', name: 'Sam Takerei' },
    ],
    retentionDays: 7,
  });
  port = await server.start(core.handleAction);
}

beforeEach(async () => {
  demo = await createDemo();
  await startServer();
});
afterEach(async () => {
  await settle();
  await server.stop();
  demo.cleanup();
});

/** The markup rules for EVERY page state (Prompt 6 + 7). */
function expectSafePage(html: string, label: string): void {
  expect(html, label).toMatch(/^<!doctype html>\n<html lang="en">/);
  expect(html, label).toMatch(/<title>[^<]+<\/title>/);
  expect(html, label).toContain('<main id="main" class="main">');
  expect(stripMotionScripts(html), label).not.toMatch(/<script/i);
  expect(html, label).not.toMatch(/<[^>]*\son[a-z]+\s*=/i);
  expect(html, label).not.toMatch(/<[^>]*\sstyle\s*=/i);
  expect(html, label).not.toMatch(/<style/i);
  expect(html, label).not.toMatch(/(?:href|src|action)="(?:https?:)?\/\//i);
  expect(html, label).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/i);
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  expect(levels[0], label).toBe(1);
  for (let i = 1; i < levels.length; i++) expect((levels[i] as number) - (levels[i - 1] as number), `${label}: heading order`).toBeLessThanOrEqual(1);
}

describe('upload page', () => {
  it('renders both sections, the real limits, the exact consent wording and the fake-mode note', async () => {
    const { cookie } = await login();
    const reply = await send('GET', '/analysis/new', { Cookie: cookie });
    expect(reply.status).toBe(200);
    expect(reply.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(CONTENT_SECURITY_POLICY).toBe(EXPECTED_CSP);
    expect(reply.text).toContain('Add a missing document to an existing policy');
    expect(reply.text).toContain('Analyse a new policy');
    expect(reply.text).toContain(`PDF only, up to 1 MB and 30 pages each.`);
    expect(reply.text.split(CONSENT_TEXT)).toHaveLength(3);
    expect(reply.text).toContain(FAKE_UPLOAD_NOTE);
    expect(reply.text).toContain('enctype="multipart/form-data"');
    expect(reply.text).toContain('accept=".pdf,application/pdf"');
    // The CSRF token is the FIRST field of both forms.
    for (const form of reply.text.split('<form').slice(1)) expect(form.indexOf('name="csrf"')).toBeLessThan(form.indexOf('name="mode"'));
    // Policies with a missing document come first and are marked.
    const options = [...reply.text.matchAll(/<option value="(pol-s\d\d)"[^>]*>([^<]*)<\/option>/g)];
    expect(options[0]?.[1]).toBe('pol-s07');
    expect(options[0]?.[2]).toMatch(/^Renewal document missing: /);
    expectSafePage(reply.text, 'empty upload page');
  });

  it('?policy= only preselects an existing option; anything else is ignored', async () => {
    const { cookie } = await login();
    const pre = await send('GET', '/analysis/new?policy=pol-s07', { Cookie: cookie });
    expect(pre.text).toMatch(/<option value="pol-s07" selected>/);
    expectSafePage(pre.text, 'attach preselected');
    const hostile = await send('GET', `/analysis/new?policy=${encodeURIComponent('"><script>x</script>')}`, { Cookie: cookie });
    expect(hostile.text).not.toContain('<script>x');
    expect(hostile.text).not.toContain(' selected>');
  });

  it('the list page links to the upload page and the pol-s07 notice links to a preselected form', async () => {
    const { cookie } = await login();
    const list = await send('GET', '/', { Cookie: cookie });
    expect(list.text).toContain('<a class="btn btn-secondary" href="/analysis/new">Analyse documents</a>');
    expect(list.text).toContain('href="/analysis/new?policy=pol-s07">Upload the missing document');
    expect(list.text).toContain('href="/analysis/new?policy=pol-s08">Upload a readable copy');
  });
});

describe('full browser-less flow (fake mode)', () => {
  it('upload the pol-s07 sample -> job done -> pack in_review -> Approve over HTTP -> overlay approved -> files in output/approved', async () => {
    const session = await login();
    const reply = await upload(session, attachParts(session.csrf));
    expect(reply.status).toBe(303);
    const jobId = jobIdFrom(reply);
    await settle();
    const job = await send('GET', `/analysis/${jobId}`, { Cookie: session.cookie });
    expect(job.status).toBe(200);
    expect(job.text).not.toContain('http-equiv="refresh"');
    expect(job.text).toContain('The pack is ready');
    expect(job.text).toContain('Extracted facts');
    expect(job.text).toContain('From the policy records');
    expect(job.text).toContain('Reading check');
    expect(job.text).toContain('<span class="q__num">16<span class="q__of">/16</span></span>');
    expect(job.text).toContain('Fake mode: the answer keys stood in for the AI; the same checks ran.');
    expectSafePage(job.text, 'job done, no flags');
    const packId = Number(/href="\/pack\/(\d+)"/.exec(job.text)?.[1]);
    const pack = await send('GET', `/pack/${packId}`, { Cookie: session.cookie });
    expect(pack.text).toContain('Uploaded manually');
    expect(pack.text).toContain(`href="/analysis/${jobId}"`);

    const approve = await send('POST', `/pack/${packId}/approve`, { Cookie: session.cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: `http://127.0.0.1:${port}` }, `csrf=${session.csrf}`);
    expect(approve.status).toBe(303);
    expect(JSON.parse(readFileSync(demo.overlayPath, 'utf8')).statuses).toEqual({ 'pol-s07': 'approved' });
    const approvedDir = path.join(demo.outputDir, 'approved');
    const approvedFiles = readdirSync(approvedDir, { recursive: true }).map(String);
    expect(approvedFiles.some((f) => f.includes('pol-s07') && f.endsWith('.xlsx'))).toBe(true);
    expect(approvedFiles.filter((f) => f.includes('pol-s07') && f.endsWith('.eml'))).toHaveLength(2);
  });

  it('a new policy with flags shows the facts table with pages, quotes and confidence words', async () => {
    const session = await login();
    const reply = await upload(session, newParts(session.csrf));
    await settle();
    const job = await send('GET', `/analysis/${jobIdFrom(reply)}`, { Cookie: session.cookie });
    expect(job.text).toContain('Harbourview Bakery Ltd - Public Liability');
    expect(job.text).toContain('<strong>High</strong>');
    expect(job.text).toContain('Page 1');
    expect(job.text).toMatch(/<span class="conf conf-high"><span class="conf__glyph" aria-hidden="true"><\/span>High<span class="vh"> confidence<\/span><\/span>/);
    expect(job.text).toContain('<q class="quote">Policy number: ');
    expectSafePage(job.text, 'job done with flags');
  });
});

describe('multipart security', () => {
  it('auth, Origin and Host are checked before the body: no cookie, bad origin, bad host -> 403, nothing stored', async () => {
    const session = await login();
    const body = multipart(attachParts(session.csrf));
    const noCookie = await send('POST', '/analysis', { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`, Origin: `http://127.0.0.1:${port}` }, body);
    expect(noCookie.status).toBe(403);
    const badOrigin = await send('POST', '/analysis', multipartHeaders(session.cookie, 'http://evil.example'), body);
    expect(badOrigin.status).toBe(403);
    const noOrigin = await send('POST', '/analysis', multipartHeaders(session.cookie, null), body);
    expect(noOrigin.status).toBe(403);
    const badHost = await send('POST', '/analysis', multipartHeaders(session.cookie), body, 'evil.example');
    expect(badHost.status).toBe(403);
    expect(listUploads(demo.db)).toHaveLength(0);
    expect(storedFiles()).toHaveLength(0);
    const reasons = listAllAudit(demo.db).filter((e) => e.type === 'unauthorised_attempt').map((e) => e.details.reason);
    expect(reasons).toEqual(expect.arrayContaining(['missing or invalid session', 'bad origin', 'bad host header']));
    expect(JSON.stringify(listAllAudit(demo.db))).not.toContain(token);
  });

  it('CSRF: wrong token, missing token and a file BEFORE the token are all refused with a bare 403 and no job', async () => {
    const session = await login();
    const wrong = await upload(session, attachParts('0'.repeat(64)));
    expect(wrong.status).toBe(403);
    expect(wrong.text).toBe(renderErrorPage(403));
    const missing = await upload(session, attachParts(session.csrf).slice(1));
    expect(missing.status).toBe(403);
    const fileFirst = await upload(session, [{ name: 'renewal', filename: 'x.pdf', content: sample('pol-s07-renewal.pdf') }, { name: 'csrf', value: session.csrf }, { name: 'mode', value: 'attach' }]);
    expect(fileFirst.status).toBe(403);
    expect(listUploads(demo.db)).toHaveLength(0);
    expect(storedFiles()).toHaveLength(0);
    expect(listAllAudit(demo.db).filter((e) => e.details.reason === 'bad csrf token')).toHaveLength(3);
  });

  it('oversize: refused by Content-Length before reading, and by the streamed size when the length is not declared', async () => {
    const session = await login();
    const declared = await send('POST', '/analysis', { ...multipartHeaders(session.cookie), 'Content-Length': String(10 * MAX_BYTES) }, Buffer.alloc(10));
    expect(declared.status).toBe(413);
    // Chunked (no Content-Length): one file far over the limit.
    const big = multipart([{ name: 'csrf', value: session.csrf }, { name: 'mode', value: 'new' }, { name: 'expiring', filename: 'big.pdf', content: Buffer.alloc(MAX_BYTES * 3, 0x25) }]);
    const streamed = await new Promise<Reply>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/analysis', headers: { Host: `127.0.0.1:${port}`, ...multipartHeaders(session.cookie) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      for (let i = 0; i < big.length; i += 16_384) req.write(big.subarray(i, i + 16_384));
      req.end();
    });
    expect(streamed.status).toBe(413);
    expect(streamed.text).toContain('That file is too large.');
    expect(listUploads(demo.db)).toHaveLength(0);
    expect(storedFiles()).toHaveLength(0);
  });

  it('part-count, unknown fields, repeated fields, a third file and two files for one side are refused', async () => {
    const session = await login();
    const many = await upload(session, [{ name: 'csrf', value: session.csrf }, ...Array.from({ length: 20 }, (_, i) => ({ name: 'mode', value: String(i) }))]);
    expect(many.status).toBe(400);
    expect((await upload(session, [...attachParts(session.csrf), { name: 'admin', value: '1' }])).status).toBe(400);
    expect((await upload(session, [...attachParts(session.csrf), { name: 'mode', value: 'new' }])).status).toBe(400);
    expect((await upload(session, [...attachParts(session.csrf), { name: 'other', filename: 'x.pdf', content: Buffer.from('%PDF-') }])).status).toBe(400);
    const duplicate = await upload(session, [...attachParts(session.csrf), { name: 'renewal', filename: 'again.pdf', content: sample('pol-s07-renewal.pdf') }]);
    expect(duplicate.status).toBe(400);
    expect(duplicate.text).toContain('Two files were sent for the same side.');
    expect(listUploads(demo.db)).toHaveLength(0);
    expect(storedFiles()).toHaveLength(0);
  });

  it('a client that disconnects mid-upload leaves no job and no file behind', async () => {
    const session = await login();
    const body = multipart(attachParts(session.csrf));
    await new Promise<void>((resolve) => {
      const req: ClientRequest = request({ host: '127.0.0.1', port, method: 'POST', path: '/analysis', headers: { Host: `127.0.0.1:${port}`, ...multipartHeaders(session.cookie), 'Content-Length': String(body.length) } });
      req.on('error', () => resolve());
      req.write(body.subarray(0, Math.floor(body.length / 2)));
      setTimeout(() => {
        req.destroy();
        setTimeout(resolve, 150);
      }, 50);
    });
    expect(listUploads(demo.db)).toHaveLength(0);
    expect(storedFiles()).toHaveLength(0);
  });

  it('one in-flight upload per session: a second request while the first is still sending gets 429', async () => {
    const session = await login();
    const body = multipart(attachParts(session.csrf));
    let finishFirst: () => void = () => {};
    const first = new Promise<Reply>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/analysis', headers: { Host: `127.0.0.1:${port}`, ...multipartHeaders(session.cookie), 'Content-Length': String(body.length) } }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: '' }));
      });
      req.on('error', reject);
      req.write(body.subarray(0, 200));
      finishFirst = () => req.end(body.subarray(200));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await upload(session, attachParts(session.csrf));
    expect(second.status).toBe(429);
    expect(second.text).toContain('Another analysis or the nightly run is in progress.');
    finishFirst();
    expect((await first).status).toBe(303);
  });

  it('D-122: through the public origin the pages show no upload entry points; on this computer they do', async () => {
    await server.stop();
    await startServer({ publicOrigin: 'https://demo-host.example.test' });
    const local = await login();
    const uploaded = await upload(local, attachParts(local.csrf));
    await settle();
    const packId = Number(/href="\/pack\/(\d+)"/.exec((await send('GET', `/analysis/${jobIdFrom(uploaded)}`, { Cookie: local.cookie })).text)?.[1]);
    const localList = await send('GET', '/', { Cookie: local.cookie });
    expect(localList.text).toContain('href="/analysis/new"');
    expect(localList.text).toContain('Upload a readable copy');
    expect((await send('GET', `/pack/${packId}`, { Cookie: local.cookie })).text).toContain('href="/analysis/');

    const signIn = await send('GET', `/?t=${encodeURIComponent(token)}`, {}, undefined, 'demo-host.example.test');
    const publicCookie = String(signIn.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    for (const url of ['/', `/pack/${packId}`]) {
      const page = await send('GET', url, { Cookie: publicCookie }, undefined, 'demo-host.example.test');
      expect(page.status, url).toBe(200);
      expect(page.text, url).not.toContain('/analysis');
      expect(page.text, url).not.toContain('Analyse documents');
      expect(page.text, url).not.toContain('Upload the missing document');
      expect(page.text, url).not.toContain(FAKE_UPLOAD_NOTE);
    }
    expect((await send('GET', `/pack/${packId}`, { Cookie: publicCookie }, undefined, 'demo-host.example.test')).text).toContain('Uploaded manually');
  });

  it('uploads are refused through the public HTTPS origin (this computer only)', async () => {
    await server.stop();
    await startServer({ publicOrigin: 'https://demo-host.example.test' });
    const reply = await send('GET', `/?t=${encodeURIComponent(token)}`, {}, undefined, 'demo-host.example.test');
    const cookie = String(reply.headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const page = await send('GET', '/analysis/new', { Cookie: cookie }, undefined, 'demo-host.example.test');
    expect(page.status).toBe(403);
    expect(page.text).toBe(renderErrorPage('uploads_local_only'));
    const post = await send('POST', '/analysis', { Cookie: cookie, 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`, Origin: 'https://demo-host.example.test' }, multipart([{ name: 'csrf', value: 'x' }]), 'demo-host.example.test');
    expect(post.status).toBe(403);
    expect(listUploads(demo.db)).toHaveLength(0);
  });
});

describe('typed rejections: status codes, kind pages, entered text kept (escaped), files never kept', () => {
  it('415, 400, 429 and the form keeps text', async () => {
    const session = await login();
    const notPdf = await upload(session, attachParts(session.csrf).map((p) => (p.name === 'renewal' ? { name: 'renewal', filename: 'note.pdf', content: sample('not-a-pdf.pdf') } : p)));
    expect(notPdf.status).toBe(415);
    expect(notPdf.text).toContain('The renewal offer: That file is not a PDF.');
    expectSafePage(notPdf.text, 'rejection not a pdf');

    const consent = await upload(session, newParts(session.csrf, { consent: 'no', client_name: 'Kept & "Quoted" <Ltd>' }));
    expect(consent.status).toBe(400);
    expect(consent.text).toContain('Please confirm that the documents are made-up');
    expect(consent.text).toContain('value="Kept &amp; &quot;Quoted&quot; &lt;Ltd&gt;"');
    expect(consent.text).not.toContain('type="file" value');
    expectSafePage(consent.text, 'validation error');

    const crlf = await upload(session, newParts(session.csrf, { contact_email: 'jo@example.com\r\nBcc: x@example.com' }));
    expect(crlf.status).toBe(400);
    expect(crlf.text).toContain('Some of the details are not valid.');

    const scanned = await upload(session, newParts(session.csrf, {}, { expiring: { name: 'expiring', filename: 'scan.pdf', content: sample('scanned-expiring.pdf') } }));
    expect(scanned.status).toBe(400);
    expect(scanned.text).toContain('The expiring policy: That PDF has no readable text.');

    const unknown = await upload(session, newParts(session.csrf, {}, { renewal: { name: 'renewal', filename: 'other.pdf', content: Buffer.concat([Buffer.from(sample('harbourview-renewal.pdf')), Buffer.from('\n%x\n')]) } }));
    expect(unknown.status).toBe(400);
    expect(unknown.text).toContain('not one of the known sample documents');
    expectSafePage(unknown.text, 'fake-mode refusal');

    const gate = acquireRunGate(analysis.lockPath);
    const busy = await upload(session, newParts(session.csrf));
    gate.release();
    expect(busy.status).toBe(429);
    expectSafePage(busy.text, 'busy');
    expect(storedFiles()).toHaveLength(0);
  });

  it('daily limit reached -> 429', async () => {
    await server.stop();
    await startServer({ analysisOverrides: { dailyLimit: 1 } });
    const session = await login();
    expect((await upload(session, newParts(session.csrf))).status).toBe(303);
    await settle();
    const limited = await upload(session, newParts(session.csrf));
    expect(limited.status).toBe(429);
    expect(limited.text).toContain('The daily limit for analyses has been reached.');
    expect(limited.text).toContain('1 of 1');
    expectSafePage(limited.text, 'daily limit');
  });

  it('AI not configured: the page says so and shows no forms', async () => {
    await server.stop();
    await startServer({ analysisOverrides: { reader: null, knownDocuments: undefined } });
    const session = await login();
    const page = await send('GET', '/analysis/new', { Cookie: session.cookie });
    expect(page.text).toContain('AI reading is not configured');
    expect(page.text).not.toContain('enctype="multipart/form-data"');
    expectSafePage(page.text, 'AI not configured');
  });
});

describe('hostile input is shown escaped everywhere', () => {
  it('client name, contact, filenames and document text never become markup', async () => {
    const session = await login();
    const reply = await upload(
      session,
      newParts(session.csrf, { client_name: `<script>alert(1)</script>"' javascript:x \u202Eevil` }, {
        expiring: { name: 'expiring', filename: '<img src=x onerror=alert(1)>.pdf', content: sample('hostile-expiring.pdf') },
        renewal: { name: 'renewal', filename: '..\\..\\CON.pdf', content: sample('hostile-renewal.pdf') },
      }),
    );
    expect(reply.status).toBe(400); // the RTL override makes the client name invalid: refused, text kept escaped
    expect(reply.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39; javascript:x evil');
    expect(reply.text).not.toContain('\u202E');
    expectSafePage(reply.text, 'hostile rejection');

    const ok = await upload(
      session,
      newParts(session.csrf, { client_name: `<script>alert(1)</script>"' javascript:x` }, {
        expiring: { name: 'expiring', filename: '<img src=x onerror=alert(1)>.pdf', content: sample('hostile-expiring.pdf') },
        renewal: { name: 'renewal', filename: '..\\..\\CON.pdf', content: sample('hostile-renewal.pdf') },
      }),
    );
    expect(ok.status).toBe(303);
    await settle();
    for (const url of [`/analysis/${jobIdFrom(ok)}`, '/analysis/new', '/']) {
      const page = await send('GET', url, { Cookie: session.cookie });
      expect(page.text, url).not.toContain('<script>alert');
      expect(page.text, url).not.toContain('<img src=x');
      expect(page.text, url).not.toContain('\u202E');
      expect(page.text, url).not.toContain('\u0007');
      expectSafePage(page.text, `hostile ${url}`);
    }
    const job = await send('GET', `/analysis/${jobIdFrom(ok)}`, { Cookie: session.cookie });
    expect(job.text).toContain('&lt;img src=x onerror=alert(1)&gt;.pdf');
    expect(job.text).toContain('CON.pdf');
    expect(job.text).toContain('=HYPERLINK(&quot;#ref&quot;,&quot;Open schedule&quot;)');
  });

  it('a 10,000-character client name is refused without being reflected', async () => {
    const session = await login();
    const reply = await upload(session, newParts(session.csrf, { client_name: 'A'.repeat(10_000) }));
    expect(reply.status).toBe(400);
    expect(reply.text).not.toContain('A'.repeat(200));
  });
});

describe('job page states', () => {
  it('meta refresh is present only while the job is running; status words accompany every colour', async () => {
    const session = await login();
    const running = insertUpload(demo.db, demo.clock, { actor: 'broker:web', mode: 'new' });
    transitionUpload(demo.db, demo.clock, running.id, 'validating');
    transitionUpload(demo.db, demo.clock, running.id, 'extracting');
    const page = await send('GET', `/analysis/${running.id}`, { Cookie: session.cookie });
    expect(page.text).toContain('<meta http-equiv="refresh" content="2">');
    expect(page.text).toMatch(/step--current"[^>]*aria-current="step">.*<span class="step__word">In progress<\/span>/);
    expect(page.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expectSafePage(page.text, 'job running');

    transitionUpload(demo.db, demo.clock, running.id, 'failed', { failureCode: 'identity_unreadable', failureMessage: 'The insurer, policy number, policy type or expiry date could not be read with confidence. No pack was prepared; nothing was guessed.' });
    const failed = await send('GET', `/analysis/${running.id}`, { Cookie: session.cookie });
    expect(failed.text).not.toContain('http-equiv="refresh"');
    expect(failed.text).toContain('<span class="step__word">Stopped</span>');
    expect(failed.text).toContain('nothing was guessed');
    expect(failed.text).toContain('Check that you uploaded the policy schedule pages');
    expectSafePage(failed.text, 'job failed identity');

    const interrupted = insertUpload(demo.db, demo.clock, { actor: 'broker:web', mode: 'new' });
    transitionUpload(demo.db, demo.clock, interrupted.id, 'validating');
    transitionUpload(demo.db, demo.clock, interrupted.id, 'extracting');
    transitionUpload(demo.db, demo.clock, interrupted.id, 'failed', { failureCode: 'interrupted', failureMessage: 'The analysis was interrupted.' });
    const interruptedPage = await send('GET', `/analysis/${interrupted.id}`, { Cookie: session.cookie });
    expect(interruptedPage.text).toContain('Interrupted');
    expectSafePage(interruptedPage.text, 'job interrupted');
  });

  it('unknown ids are 404 pages; GET never changes anything; uploaded PDFs are never served', async () => {
    const session = await login();
    const reply = await upload(session, attachParts(session.csrf));
    await settle();
    const jobId = jobIdFrom(reply);
    const before = { audit: listAllAudit(demo.db).length, uploads: JSON.stringify(listUploads(demo.db)), files: storedFiles().length };
    const notFound = await send('GET', '/analysis/99999', { Cookie: session.cookie });
    expect(notFound.status).toBe(404);
    expectSafePage(notFound.text, '404');
    for (const url of [`/analysis/${jobId}`, '/analysis/new', `/analysis/${jobId}/delete`, `/analysis/${jobId}/renewal.pdf`, '/analysis/x', '/uploads/x/renewal.pdf', '/data/runtime/uploads', '/analysis']) {
      const page = await send('GET', url, { Cookie: session.cookie });
      expect(page.text, url).not.toContain('%PDF-');
      expect(String(page.headers['content-type']), url).not.toContain('pdf');
    }
    expect(listAllAudit(demo.db).length).toBe(before.audit);
    expect(JSON.stringify(listUploads(demo.db))).toBe(before.uploads);
    expect(storedFiles().length).toBe(before.files);
  });

  it('delete requires POST with CSRF and Origin; afterwards the page shows the deleted state', async () => {
    const session = await login();
    const reply = await upload(session, attachParts(session.csrf));
    await settle();
    const jobId = jobIdFrom(reply);
    expect(storedFiles()).toHaveLength(1);
    const form = { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: session.cookie };
    expect((await send('POST', `/analysis/${jobId}/delete`, { ...form, Origin: `http://127.0.0.1:${port}` }, 'csrf=wrong')).status).toBe(403);
    expect((await send('POST', `/analysis/${jobId}/delete`, { ...form, Origin: 'http://evil.example' }, `csrf=${session.csrf}`)).status).toBe(403);
    expect(storedFiles()).toHaveLength(1);
    const ok = await send('POST', `/analysis/${jobId}/delete`, { ...form, Origin: `http://127.0.0.1:${port}` }, `csrf=${session.csrf}`);
    expect(ok.status).toBe(303);
    expect(storedFiles()).toHaveLength(0);
    const page = await send('GET', `/analysis/${jobId}`, { Cookie: session.cookie });
    expect(page.text).toContain('The uploaded PDFs were deleted');
    expect(page.text).not.toContain('Delete the uploaded PDFs</button>');
    expectSafePage(page.text, 'deleted files');
    expect((await send('POST', '/analysis/99999/delete', { ...form, Origin: `http://127.0.0.1:${port}` }, `csrf=${session.csrf}`)).status).toBe(404);
    expect(all(demo.db, "SELECT COUNT(*) AS n FROM audit_events WHERE type = 'upload_deleted'")[0]?.n).toBe(1);
  });
});
