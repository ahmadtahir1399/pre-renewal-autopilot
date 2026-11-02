// Prompt 7 Stage U4: ATTACK-SURFACE MATRIX for manual uploads. Rows = sinks, columns = hostile inputs.
// Each hostile string is injected as the client name, contact name, client filename, an extracted exclusion title
// and summary, and an extracted quote, then pushed through every sink. Each sink has ONE explicit "safe" rule.
// The matrix is printed (PASS/FAIL) and every cell must PASS. Also: sentinel secrets never leak, the data source
// is untouched by manual cases, and the hostile terms change nothing except through the compare rules.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../../src/approval/actions.js';
import { createDispatcher } from '../../src/approval/dispatch.js';
import { FakeNotifier } from '../../src/approval/notifier.js';
import { WebApprovalServer } from '../../src/approval/web/server.js';
import { compareTerms } from '../../src/compare/compareTerms.js';
import type { ExtractedTerms } from '../../src/domain/types.js';
import { createOverview, normaliseFilters, resolveExportPath } from '../../src/outputs/overview.js';
import type { TermsReader } from '../../src/pipeline/readers.js';
import { listAllAudit } from '../../src/state/audit.js';
import { getCaseByCycleKey, getPackById } from '../../src/state/repo.js';
import { type AnalysisDeps, analyseUpload } from '../../src/uploads/analysisService.js';
import { loadKnownDocuments, sha256OfFile } from '../../src/uploads/knownDocuments.js';
import { ManualAwareSource } from '../../src/uploads/manualSource.js';
import { listStoredDocuments } from '../../src/uploads/repo.js';
import { createDemo, type Demo, FIXTURES, stripMotionScripts, TODAY } from '../helpers.js';
import { SAMPLES, sample, sampleTerms } from '../uploadHelpers.js';

const INPUTS: Record<string, string> = {
  formula: '=HYPERLINK("#x","Click")',
  script: '<script>alert(1)</script>',
  crlf: 'Kestrel\r\nBcc: attacker@example.com',
  markup: '<b>bold</b> &amp; <i>it</i>',
  long: `L${'o'.repeat(9_998)}g`,
  control_rtl: 'abc\u202Egnp.exe\u202C \u2066x\u2069 bell\u0007end',
  traversal: '..\\..\\Windows\\system32\\CON.pdf',
};
const INPUT_NAMES = Object.keys(INPUTS);
const SENTINELS = { key: 'sk-SENTINEL-not-a-real-key-0123456789', web: 'SENTINEL-web-token-0123456789abcdef', telegram: '123456789:SENTINEL_telegram_token_abcdefghijklmnop' };

/** Characters that must never reach a plain-text or HTML sink raw. */
const RAW_CONTROL = /(?![\t\n\r])\p{Cc}|\p{Bidi_Control}/u;
/** The name rule of the upload door (isValidName): control, format and line-break characters are refused. */
const DOOR_REFUSES = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const FORMULA_START = /^[=+\-@\t\r]/;

let demo: Demo;
let server: WebApprovalServer;
let port: number;
const notifier = new FakeNotifier('web');
const responses: string[] = [];
const logs: string[] = [];
const results = new Map<string, Map<string, boolean>>();
const flows = new Map<string, { jobId: number; packId: number | null; clientName: string; refusedName: boolean }>();
let fixturesBefore = '';
let overviewFile = '';

function record(sink: string, input: string, ok: boolean): void {
  if (!results.has(sink)) results.set(sink, new Map());
  (results.get(sink) as Map<string, boolean>).set(input, ok);
}

function hashTree(dir: string): string {
  const hash = createHash('sha256');
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(`${path.relative(dir, full)}\n`).update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest('hex');
}

function allFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => statSync(path.join(dir, f)).isFile());
}

function send(urlPath: string, cookie = '', method = 'GET', body?: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, ...(cookie ? { Cookie: cookie } : {}) };
    if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/x-www-form-urlencoded', Origin: `http://127.0.0.1:${port}` });
    const req = request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        responses.push(text, JSON.stringify(res.headers));
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function hostileTerms(base: ExtractedTerms, input: string, index: number, side: 'expiring' | 'renewal'): ExtractedTerms {
  const terms = structuredClone(base);
  // A distinct policy number per input gives each flow its own manual policy (U-5).
  terms.policyNumber = { ...terms.policyNumber, value: `HV-MATRIX-${index}` };
  terms.insurerName = { ...terms.insurerName, sourceQuote: input };
  // Only the renewal adds it, so it becomes a diff and reaches the change sentences, cards and emails.
  if (side === 'renewal') terms.keyExclusions = [...terms.keyExclusions, { key: 'other', title: input, summary: input, sourcePage: 4 }];
  return terms;
}

beforeAll(async () => {
  const original = { log: console.log, error: console.error, warn: console.warn, out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) };
  const capture = (...args: unknown[]) => void logs.push(args.map(String).join(' '));
  console.log = capture;
  console.error = capture;
  console.warn = capture;
  const swallow = (chunk: unknown): boolean => {
    logs.push(String(chunk));
    return true;
  };
  process.stdout.write = swallow as typeof process.stdout.write;
  process.stderr.write = swallow as typeof process.stderr.write;
  try {
    for (const [name, value] of Object.entries(SENTINELS)) process.env[`PRA_TEST_SENTINEL_${name.toUpperCase()}`] = value;
    demo = await createDemo();
    fixturesBefore = hashTree(FIXTURES);
    const registry = loadKnownDocuments({ fixturesDir: FIXTURES, samplesDir: SAMPLES });
    const source = new ManualAwareSource(demo.dataSource, demo.db);
    const dispatcher = createDispatcher({ db: demo.db, clock: demo.clock, dataSource: source, notifiers: [notifier], outputDir: demo.outputDir, today: () => TODAY, reminderAfterHours: 48, reminderIntervalHours: 24, retries: 0 });
    const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: source, outputDir: demo.outputDir, allowedTelegramChatIds: [] });
    const expiringSha = sha256OfFile(path.join(SAMPLES, 'harbourview-expiring.pdf'));
    const renewalSha = sha256OfFile(path.join(SAMPLES, 'harbourview-renewal.pdf'));

    for (const [index, name] of INPUT_NAMES.entries()) {
      const input = INPUTS[name] as string;
      const byHash = new Map([
        [expiringSha, hostileTerms(sampleTerms('harbourview-expiring.truth.json'), input, index, 'expiring')],
        [renewalSha, hostileTerms(sampleTerms('harbourview-renewal.truth.json'), input, index, 'renewal')],
      ]);
      const reader: TermsReader = {
        modelName: 'matrix-stub',
        isFake: true,
        read: async (pdfPath) => ({ terms: structuredClone(byHash.get(sha256OfFile(pdfPath)) as ExtractedTerms), warnings: [], usage: { inputTokens: 0, outputTokens: 0 }, fromCache: false }),
        peek: async () => undefined,
      };
      const deps: AnalysisDeps = {
        db: demo.db,
        clock: demo.clock,
        dataSource: demo.dataSource,
        reader,
        knownDocuments: registry,
        compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 },
        outputDir: demo.outputDir,
        runtimeDir: path.join(demo.dataDir, 'runtime'),
        lockPath: path.join(demo.dataDir, 'runtime', 'run.lock'),
        timeZone: 'Pacific/Auckland',
        today: () => TODAY,
        limits: { maxBytes: 10 * 1024 * 1024, maxPages: 30, parseTimeoutMs: 20_000 },
        dailyLimit: 100,
        timeoutMs: 60_000,
        onPacksReady: dispatcher.onPacksReady,
      };
      const files = { expiring: { bytes: sample('harbourview-expiring.pdf'), clientFilename: input }, renewal: { bytes: sample('harbourview-renewal.pdf'), clientFilename: `${input}.pdf` } };
      // The hostile string as client and contact name first; names with control characters or over 100
      // characters are refused at the door (that IS the safe outcome for those inputs).
      const attempt = await analyseUpload({ mode: 'new', newPolicy: { clientName: input, contactName: input, brokerId: 'brk-01' }, files, consent: true, actor: 'broker:web' }, deps);
      let job = attempt.job;
      let clientName = input;
      let refusedName = false;
      if (attempt.job.status === 'rejected') {
        expect(attempt.job.failureCode, name).toBe('invalid_input');
        refusedName = true;
        clientName = `Matrix Client ${index}`;
        job = (await analyseUpload({ mode: 'new', newPolicy: { clientName, brokerId: 'brk-01' }, files, consent: true, actor: 'broker:web' }, deps)).job;
      }
      expect(job.status, name).toBe('done');
      if (job.packId) await core.handleAction({ action: 'approve', packId: job.packId, actor: 'broker:web', channel: 'web' });
      flows.set(name, { jobId: job.id, packId: job.packId, clientName, refusedName });
    }
    const overview = await createOverview({ filters: normaliseFilters({ statuses: ['in_review', 'approved'] }), runDate: TODAY, actor: 'broker:web' }, { db: demo.db, clock: demo.clock, dataSource: source, outputDir: demo.outputDir });
    if (overview.kind === 'empty') throw new Error('overview unexpectedly empty');
    overviewFile = resolveExportPath(demo.outputDir, overview.record.relativePath);

    server = new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource: source, port: 0, token: SENTINELS.web, approverName: 'Alex Morrow', today: () => TODAY, fakeLlm: true });
    server.enableExports({ db: demo.db, clock: demo.clock, dataSource: source, outputDir: demo.outputDir });
    server.enableUploads({
      analysis: { db: demo.db, clock: demo.clock, dataSource: demo.dataSource, reader: null, compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 }, outputDir: demo.outputDir, runtimeDir: path.join(demo.dataDir, 'runtime'), lockPath: path.join(demo.dataDir, 'runtime', 'run.lock'), timeZone: 'Pacific/Auckland', today: () => TODAY, limits: { maxBytes: 1_000_000, maxPages: 30, parseTimeoutMs: 1000 }, dailyLimit: 100, timeoutMs: 1000 },
      retention: { db: demo.db, clock: demo.clock, runtimeDir: path.join(demo.dataDir, 'runtime'), cacheDir: path.join(demo.root, 'cache'), protectedHashes: new Set() },
      brokers: [{ id: 'brk-01', name: 'Alex Morrow' }],
      retentionDays: 7,
    });
    port = await server.start(core.handleAction);
  } finally {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
    process.stdout.write = original.out;
    process.stderr.write = original.err;
  }
}, 120_000);

afterAll(async () => {
  await server?.stop();
  demo?.cleanup();
});

async function xlsxStrings(file: string): Promise<{ strings: string[]; formulas: number }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const strings: string[] = [];
  let formulas = 0;
  workbook.eachSheet((sheet) =>
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Formula) formulas++;
        if (typeof cell.value === 'string') strings.push(cell.value);
      }),
    ),
  );
  return { strings, formulas };
}

const plainTextSafe = (text: string) => !RAW_CONTROL.test(text.replace(/\r\n/g, '\n'));
const htmlSafe = (html: string) => !RAW_CONTROL.test(html) && !/<script/i.test(stripMotionScripts(html)) && !/<b>bold/.test(html) && !/<img|<i>it/.test(html);

describe('attack-surface matrix', () => {
  it('every sink is safe for every hostile input', async () => {
    const cookie = String((await send(`/?t=${encodeURIComponent(SENTINELS.web)}`)).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const listHtml = (await send('/', cookie)).text;
    const uploadHtml = (await send('/analysis/new', cookie)).text;
    for (const name of INPUT_NAMES) {
      const input = INPUTS[name] as string;
      const flow = flows.get(name) as { jobId: number; packId: number | null; clientName: string; refusedName: boolean };
      const pack = getPackById(demo.db, flow.packId as number);
      if (!pack) throw new Error(`no pack for ${name}`);
      const file = (rel: string) => path.join(demo.outputDir, ...rel.split('/'));

      // xlsx (comparison): no formula cells; no string starts like a formula.
      const xlsx = await xlsxStrings(file(pack.paths.xlsx));
      record('xlsx comparison cells', name, xlsx.formulas === 0 && xlsx.strings.every((s) => !FORMULA_START.test(s) && !RAW_CONTROL.test(s)));
      // xlsx (overview): same rule.
      const overview = await xlsxStrings(overviewFile);
      record('xlsx overview cells', name, overview.formulas === 0 && overview.strings.every((s) => !FORMULA_START.test(s) && !RAW_CONTROL.test(s)));
      // .eml: headers are one line each, no injected header, no raw control/bidi characters; bodies plain text.
      for (const kind of ['clientEml', 'insurerEml'] as const) {
        const eml = readFileSync(file(pack.paths[kind]), 'utf8');
        const [head = '', ...bodyParts] = eml.split(/\r?\n\r?\n/);
        const headerLines = head.split(/\r?\n/);
        const headersOk = headerLines.every((l) => /^[A-Za-z-]+: /.test(l) || /^[ \t]/.test(l)) && !headerLines.some((l) => /^bcc:/i.test(l)) && plainTextSafe(head);
        record(`.eml headers (${kind === 'clientEml' ? 'client' : 'insurer'})`, name, headersOk);
        record(`.eml body (${kind === 'clientEml' ? 'client' : 'insurer'})`, name, plainTextSafe(bodyParts.join('\n')) && /Content-Type: text\/plain/i.test(head));
      }
      // summary.txt: plain text without raw control/bidi characters.
      record('summary.txt', name, plainTextSafe(readFileSync(file(pack.paths.summaryTxt), 'utf8')));
      // Web pages: escaped, no markup from the input, no raw control/bidi characters.
      const jobHtml = (await send(`/analysis/${flow.jobId}`, cookie)).text;
      const packHtml = (await send(`/pack/${pack.id}`, cookie)).text;
      record('web: job page', name, htmlSafe(jobHtml));
      record('web: pack page', name, htmlSafe(packHtml));
      record('web: list page', name, htmlSafe(listHtml));
      record('web: upload page (recent list)', name, htmlSafe(uploadHtml));
      // Notifier (FakeNotifier) card text: plain text, no raw control/bidi characters.
      const card = notifier.records.find((r) => r.packId === pack.id);
      record('notifier message text', name, card !== undefined && plainTextSafe(card.text));
      // Audit details: never the input, never a filename.
      const auditJson = JSON.stringify(listAllAudit(demo.db).map((e) => e.details));
      record('audit details', name, !auditJson.includes(input.slice(0, 12)) && !auditJson.includes('CON.pdf'));
      // Log lines captured during the flows.
      record('log lines', name, !logs.some((line) => line.includes(input.slice(0, 12))));
      // Paths: stored uploads only uploads/<32 hex>/<side>.pdf; output paths free of the input.
      const stored = listStoredDocuments(demo.db, flow.jobId).map((d) => d.storedPath);
      const outputPaths = allFiles(demo.outputDir);
      record(
        'output and upload paths',
        name,
        stored.length === 2 && stored.every((p) => /^uploads\/[0-9a-f]{32}\/(expiring|renewal)\.pdf$/.test(p)) && outputPaths.every((p) => !/[<>"|?*\u202E]|\.\.|CON\.pdf/i.test(p)),
      );
      // Client and contact name at the door: refused (invalid_input) or, when accepted, shown only escaped.
      record('client/contact name at the door', name, flow.refusedName ? DOOR_REFUSES.test(input) || input.length > 100 : htmlSafe(jobHtml));
    }

    const inputs = INPUT_NAMES;
    const width = Math.max(...[...results.keys()].map((k) => k.length));
    const lines = [`${'sink'.padEnd(width)}  ${inputs.map((i) => i.padEnd(11)).join(' ')}`];
    for (const [sink, row] of results) lines.push(`${sink.padEnd(width)}  ${inputs.map((i) => (row.get(i) ? 'PASS' : 'FAIL').padEnd(11)).join(' ')}`);
    process.stdout.write(`\nATTACK-SURFACE MATRIX (rows = sinks, columns = hostile inputs)\n${lines.join('\n')}\n`);
    const failures = [...results].flatMap(([sink, row]) => [...row].filter(([, ok]) => !ok).map(([input]) => `${sink} x ${input}`));
    expect(failures).toEqual([]);
  });

  it('sentinel secrets never appear in uploads, outputs, exports, the database, audit, logs or responses', () => {
    const files = [...allFiles(demo.root).map((f) => path.join(demo.root, f))];
    const haystacks = [...files.map((f) => readFileSync(f).toString('latin1')), JSON.stringify(listAllAudit(demo.db)), ...logs, ...responses];
    for (const secret of Object.values(SENTINELS)) {
      expect(haystacks.some((h) => h.includes(secret)), secret.slice(0, 12)).toBe(false);
    }
  });

  it('the data source is untouched by manual cases; an attach approve writes only the overlay', async () => {
    expect(hashTree(FIXTURES)).toBe(fixturesBefore);
    expect(existsSync(demo.overlayPath)).toBe(false);
    const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: new ManualAwareSource(demo.dataSource, demo.db), outputDir: demo.outputDir, allowedTelegramChatIds: [] });
    const registry = loadKnownDocuments({ fixturesDir: FIXTURES, samplesDir: SAMPLES });
    const { createKnownDocumentReader } = await import('../../src/uploads/knownDocuments.js');
    const attach = await analyseUpload(
      { mode: 'attach', policyId: 'pol-s07', files: { renewal: { bytes: sample('pol-s07-renewal.pdf') } }, consent: true, actor: 'broker:web' },
      {
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
        limits: { maxBytes: 10 * 1024 * 1024, maxPages: 30, parseTimeoutMs: 20_000 },
        dailyLimit: 100,
        timeoutMs: 60_000,
      },
    );
    await core.handleAction({ action: 'approve', packId: attach.job.packId as number, actor: 'broker:web', channel: 'web' });
    expect(JSON.parse(readFileSync(demo.overlayPath, 'utf8')).statuses).toEqual({ 'pol-s07': 'approved' });
    expect(hashTree(FIXTURES)).toBe(fixturesBefore);
  });

  it('the hostile terms change no status, flag or severity except through the compare rules', () => {
    for (const [index, name] of INPUT_NAMES.entries()) {
      const flow = flows.get(name) as { packId: number | null };
      const pack = getPackById(demo.db, flow.packId as number);
      const expected = compareTerms(
        hostileTerms(sampleTerms('harbourview-expiring.truth.json'), INPUTS[name] as string, index, 'expiring'),
        hostileTerms(sampleTerms('harbourview-renewal.truth.json'), INPUTS[name] as string, index, 'renewal'),
        { premiumMediumPct: 10, premiumHighPct: 25 },
      );
      expect(pack?.pack.diffs, name).toEqual(expected.diffs);
      expect(pack?.pack.flags, name).toEqual(expected.flags);
      // Approved only because the test approved it on purpose; nothing in the document can approve.
      expect(getCaseByCycleKey(demo.db, pack?.pack.cycleKey ?? '')?.status, name).toBe('approved');
    }
    const hostileApproved = listAllAudit(demo.db).filter((e) => e.type === 'approved');
    expect(hostileApproved.every((e) => e.actor === 'broker:web')).toBe(true);
  });
});
