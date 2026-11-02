// npm run ui:states [-- <outDir>]   (default docs/ui-screens/states, git-ignored)
// Renders every page state of the upload feature (docs/UI_INVENTORY.md, Prompt 7) through the REAL web server
// over HTTP, in a throwaway temp project (fake mode, synthetic samples, no network, no key), and saves one
// .html file per state, so the pages can be scanned (Select-String) or opened in a browser.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApprovalCore } from '../src/approval/actions.js';
import { generateToken, WebApprovalServer } from '../src/approval/web/server.js';
import { LocalJsonSource } from '../src/data/localJsonSource.js';
import { loadSeedState } from '../src/data/seedState.js';
import { manualInstantClock } from '../src/domain/dates.js';
import { seedFromState } from '../src/pipeline/demo.js';
import { createGroundTruthReader } from '../src/pipeline/readers.js';
import { runPipeline } from '../src/pipeline/runPipeline.js';
import { migrate, openDatabase } from '../src/state/db.js';
import { acquireRunGate } from '../src/state/runGate.js';
import type { AnalysisDeps } from '../src/uploads/analysisService.js';
import { createKnownDocumentReader, loadKnownDocuments } from '../src/uploads/knownDocuments.js';
import { ManualAwareSource } from '../src/uploads/manualSource.js';
import { insertUpload, listUploads, transitionUpload } from '../src/uploads/repo.js';

const ROOT = process.cwd();
const FIXTURES = path.join(ROOT, 'fixtures');
const SAMPLES = path.join(ROOT, 'samples', 'uploads');
const OUT = path.resolve(process.argv[2] ?? path.join('docs', 'ui-screens', 'states'));
const TODAY = '2026-10-19';
const BOUNDARY = '----pra-states-boundary';
const out = (line: string) => process.stdout.write(`${line}\n`);

const temp = mkdtempSync(path.join(tmpdir(), 'pra-states-'));
const clock = manualInstantClock('2026-10-18T18:00:00.000Z');
const db = openDatabase(path.join(temp, 'runtime', 'autopilot.db'));
migrate(db, clock);
seedFromState(db, clock, loadSeedState(FIXTURES));
const dataDir = path.join(temp, 'data');
const outputDir = path.join(temp, 'output');
const dataSource = new LocalJsonSource({ fixturesDir: FIXTURES, dataDir });
await runPipeline({
  today: TODAY,
  dryRun: false,
  deps: { dataSource, db, reader: createGroundTruthReader(FIXTURES), clock, compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 }, outputDir, dataDir, maxConcurrency: 2, autopilotEnabled: true },
});

const registry = loadKnownDocuments({ fixturesDir: FIXTURES, samplesDir: SAMPLES });
const sample = (name: string) => new Uint8Array(readFileSync(path.join(SAMPLES, name)));
let port = 0;
let token = '';
let server: WebApprovalServer | null = null;

function analysisDeps(overrides: Partial<AnalysisDeps> = {}): AnalysisDeps {
  return {
    db,
    clock,
    dataSource,
    reader: createKnownDocumentReader(registry),
    knownDocuments: registry,
    compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 },
    outputDir,
    runtimeDir: path.join(dataDir, 'runtime'),
    lockPath: path.join(dataDir, 'runtime', 'run.lock'),
    timeZone: 'Pacific/Auckland',
    today: () => TODAY,
    limits: { maxBytes: 10 * 1024 * 1024, maxPages: 30, parseTimeoutMs: 20_000 },
    dailyLimit: 10,
    timeoutMs: 60_000,
    ...overrides,
  };
}

async function start(overrides: Partial<AnalysisDeps> = {}, publicOrigin?: string): Promise<void> {
  token = generateToken();
  const source = new ManualAwareSource(dataSource, db);
  const core = createApprovalCore({ db, clock, dataSource: source, outputDir, allowedTelegramChatIds: [] });
  server = new WebApprovalServer({ db, clock, dataSource: source, port: 0, token, approverName: 'Alex Morrow', today: () => TODAY, fakeLlm: overrides.knownDocuments !== undefined || !('knownDocuments' in overrides), ...(publicOrigin ? { publicOrigin } : {}) });
  server.enableUploads({
    analysis: analysisDeps(overrides),
    retention: { db, clock, runtimeDir: path.join(dataDir, 'runtime'), cacheDir: path.join(temp, 'cache'), protectedHashes: new Set() },
    brokers: [
      { id: 'brk-01', name: 'Alex Morrow' },
      { id: 'brk-02', name: 'Sam Takerei' },
    ],
    retentionDays: 7,
  });
  server.enableExports({ db, clock, dataSource: source, outputDir });
  port = await server.start(core.handleAction);
}

function send(method: string, urlPath: string, headers: Record<string, string>, body?: Buffer | string, host = `127.0.0.1:${port}`): Promise<{ status: number; location: string; cookie: string; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: urlPath, headers: { Host: host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: String(res.headers.location ?? ''), cookie: String(res.headers['set-cookie'] ?? '').split(';')[0] ?? '', text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

type Part = { name: string; value: string } | { name: string; filename: string; content: Uint8Array };
function multipart(parts: Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ('value' in part) chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    else chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: application/pdf\r\n\r\n`), Buffer.from(part.content), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

let cookie = '';
let csrf = '';
async function login(host?: string): Promise<void> {
  cookie = (await send('GET', `/?t=${encodeURIComponent(token)}`, {}, undefined, host)).cookie;
  const page = await send('GET', '/', { Cookie: cookie }, undefined, host);
  csrf = /name="csrf" value="([a-f0-9]+)"/.exec(page.text)?.[1] ?? '';
}
const postUpload = (parts: Part[]) => send('POST', '/analysis', { Cookie: cookie, Origin: `http://127.0.0.1:${port}`, 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}` }, multipart(parts));
/** A function body does not narrow the module-level variable, so this works after start() assigned it. */
async function stopServer(): Promise<void> {
  await server?.stop();
}
const settle = () => Promise.all([...(server?.pendingAnalyses ?? [])]);

const attach = (file: Part, policy = 'pol-s07'): Part[] => [{ name: 'csrf', value: csrf }, { name: 'mode', value: 'attach' }, { name: 'policy', value: policy }, file, { name: 'consent', value: 'yes' }];
const fresh = (fields: Record<string, string>, files: Part[], consent = true): Part[] => [
  { name: 'csrf', value: csrf },
  { name: 'mode', value: 'new' },
  ...Object.entries(fields).map(([name, value]) => ({ name, value })),
  ...files,
  ...(consent ? [{ name: 'consent', value: 'yes' }] : []),
];
const hvFiles: Part[] = [
  { name: 'expiring', filename: 'harbourview-expiring.pdf', content: sample('harbourview-expiring.pdf') },
  { name: 'renewal', filename: 'harbourview-renewal.pdf', content: sample('harbourview-renewal.pdf') },
];
const hvFields = { client_name: 'Harbourview Bakery Ltd', contact_name: 'Jo Baker', contact_email: 'jo.baker@example.com', broker: 'brk-01' };

const saved: string[] = [];
function save(name: string, reply: { status: number; text: string }): void {
  writeFileSync(path.join(OUT, `${name}.html`), reply.text);
  saved.push(`${String(reply.status).padEnd(4)} ${name}`);
}

try {
  mkdirSync(OUT, { recursive: true });
  await start();
  await login();
  save('upload-empty', await send('GET', '/analysis/new', { Cookie: cookie }));
  save('upload-attach-preselected', await send('GET', '/analysis/new?policy=pol-s07', { Cookie: cookie }));
  save('upload-validation-error', await postUpload(fresh({ ...hvFields, contact_email: 'not an email' }, hvFiles)));
  save('reject-consent-missing', await postUpload(fresh(hvFields, hvFiles, false)));
  save('reject-not-a-pdf', await postUpload(attach({ name: 'renewal', filename: 'note.pdf', content: sample('not-a-pdf.pdf') })));
  save('reject-empty-or-scanned', await postUpload(fresh(hvFields, [{ name: 'expiring', filename: 'scan.pdf', content: sample('scanned-expiring.pdf') }, hvFiles[1] as Part])));
  save('reject-corrupted', await postUpload(attach({ name: 'renewal', filename: 'broken.pdf', content: Buffer.from('%PDF-1.7\nnot really a pdf\n') })));
  save('reject-wrong-number-of-files', await postUpload(fresh(hvFields, [hvFiles[0] as Part])));
  save('reject-duplicate-side', await postUpload([...attach({ name: 'renewal', filename: 'a.pdf', content: sample('pol-s07-renewal.pdf') }), { name: 'renewal', filename: 'b.pdf', content: sample('pol-s07-renewal.pdf') }]));
  save('reject-policy-not-found', await postUpload(attach({ name: 'renewal', filename: 'r.pdf', content: sample('pol-s07-renewal.pdf') }, 'pol-s99')));
  save('reject-unknown-in-fake-mode', await postUpload(attach({ name: 'renewal', filename: 'r.pdf', content: Buffer.concat([Buffer.from(sample('pol-s07-renewal.pdf')), Buffer.from('\n%x\n')]) })));
  const gate = acquireRunGate(path.join(dataDir, 'runtime', 'run.lock'));
  save('reject-busy', await postUpload(fresh(hvFields, hvFiles)));
  gate.release();

  const s07 = await postUpload(attach({ name: 'renewal', filename: 'pol-s07-renewal.pdf', content: sample('pol-s07-renewal.pdf') }));
  await settle();
  save('job-done-no-flags', await send('GET', s07.location, { Cookie: cookie }));
  const hv = await postUpload(fresh(hvFields, hvFiles));
  await settle();
  save('job-done-with-flags', await send('GET', hv.location, { Cookie: cookie }));
  const hostile = await postUpload(fresh({ ...hvFields, client_name: `<script>alert(1)</script> "Quoted" 'x' javascript:x` }, [
    { name: 'expiring', filename: '<img src=x onerror=alert(1)>.pdf', content: sample('hostile-expiring.pdf') },
    { name: 'renewal', filename: '..\\..\\CON.pdf', content: sample('hostile-renewal.pdf') },
  ]));
  await settle();
  save('job-done-hostile', await send('GET', hostile.location, { Cookie: cookie }));
  const packId = /href="\/pack\/(\d+)"/.exec((await send('GET', hostile.location, { Cookie: cookie })).text)?.[1];
  save('pack-hostile', await send('GET', `/pack/${packId}`, { Cookie: cookie }));
  save('list-with-uploads', await send('GET', '/', { Cookie: cookie }));
  const exportForm = { Cookie: cookie, Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  save('export-no-cases', await send('POST', '/exports', exportForm, `csrf=${csrf}&status=skipped`));
  const exported = await send('POST', '/exports', exportForm, `csrf=${csrf}&status=in_review&status=approved&include_manual=yes`);
  save('export-created', await send('GET', exported.location, { Cookie: cookie }));
  save('error-404-unknown-export', await send('GET', '/exports/99999', { Cookie: cookie }));

  const running = insertUpload(db, clock, { actor: 'broker:web', mode: 'attach', policyId: 'pol-s08' });
  transitionUpload(db, clock, running.id, 'validating');
  transitionUpload(db, clock, running.id, 'extracting');
  save('job-running', await send('GET', `/analysis/${running.id}`, { Cookie: cookie }));
  transitionUpload(db, clock, running.id, 'failed', { failureCode: 'identity_unreadable', failureMessage: 'The insurer, policy number, policy type or expiry date could not be read with confidence. No pack was prepared; nothing was guessed.' });
  save('job-failed-identity', await send('GET', `/analysis/${running.id}`, { Cookie: cookie }));
  const interrupted = insertUpload(db, clock, { actor: 'broker:web', mode: 'new' });
  transitionUpload(db, clock, interrupted.id, 'validating');
  transitionUpload(db, clock, interrupted.id, 'extracting');
  transitionUpload(db, clock, interrupted.id, 'failed', { failureCode: 'interrupted', failureMessage: 'The analysis was interrupted (the service stopped). No pack was prepared. Try again.' });
  save('job-interrupted', await send('GET', `/analysis/${interrupted.id}`, { Cookie: cookie }));
  const rejectedJob = listUploads(db, 100).find((job) => job.status === 'rejected');
  if (rejectedJob) save('job-rejected', await send('GET', `/analysis/${rejectedJob.id}`, { Cookie: cookie }));
  await send('POST', `${s07.location}/delete`, { Cookie: cookie, Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/x-www-form-urlencoded' }, `csrf=${csrf}`);
  save('job-files-deleted', await send('GET', s07.location, { Cookie: cookie }));
  save('upload-with-recent', await send('GET', '/analysis/new', { Cookie: cookie }));
  save('error-404-unknown-job', await send('GET', '/analysis/99999', { Cookie: cookie }));
  save('error-403-no-session', await send('GET', '/analysis/new', {}));
  await stopServer();

  await start({ dailyLimit: 1 });
  await login();
  save('reject-daily-limit', await postUpload(fresh(hvFields, hvFiles)));
  await stopServer();

  await start({ reader: null, knownDocuments: undefined });
  await login();
  save('upload-ai-not-configured', await send('GET', '/analysis/new', { Cookie: cookie }));
  await stopServer();

  await start({}, 'https://demo-host.example.test');
  await login('demo-host.example.test');
  save('error-uploads-local-only', await send('GET', '/analysis/new', { Cookie: cookie }, undefined, 'demo-host.example.test'));
  await stopServer();

  out(`Saved ${saved.length} states to ${OUT}:`);
  for (const line of saved) out(`  ${line}`);
} finally {
  try {
    await stopServer();
  } catch {
    // already stopped
  }
  db.close();
  rmSync(temp, { recursive: true, force: true });
}
