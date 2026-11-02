// ATTACK-SURFACE MATRIX. One hostile string set is injected as the client name, the policy number,
// an exclusion title and summary, and every source quote, then pushed through EVERY sink.
// Each sink has an explicit expected-safe assertion. The matrix is printed (rows = sinks,
// columns = hostile inputs) and every cell must be PASS.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../../src/approval/actions.js';
import { SCRIPT_TAGS } from '../../src/approval/web/clientScripts.js';
import { createDispatcher } from '../../src/approval/dispatch.js';
import { FakeNotifier } from '../../src/approval/notifier.js';
import { generateToken, WebApprovalServer } from '../../src/approval/web/server.js';
import { createLogger } from '../../src/config/logger.js';
import type { DataSource } from '../../src/data/datasource.js';
import { parseGroundTruth } from '../../src/domain/schemas.js';
import type { ExtractedTerms } from '../../src/domain/types.js';
import { createGroundTruthReader, type TermsReader } from '../../src/pipeline/readers.js';
import { formatAuditTimeline, formatRunSummary } from '../../src/pipeline/report.js';
import { runPipeline } from '../../src/pipeline/runPipeline.js';
import { listAllAudit } from '../../src/state/audit.js';
import { createDemo, FIXTURES, TODAY } from '../helpers.js';
import { httpGet, loginCookie, unsafeCharsIn } from './support.js';

const HOSTILE: Record<string, string> = {
  formula: '=HYPERLINK("http://example.com/x","click me")',
  script: '<script>alert(1)</script>',
  crlfHeader: 'Acme Ltd\r\nBcc: x@example.com',
  markup: '**bold** [link](http://example.com) <b>x</b> &amp; _y_ `code`',
  long10k: 'A'.repeat(10_000),
  controlsRtl: `Evil${String.fromCodePoint(0x202e)}gnp.exe ${String.fromCodePoint(0x00, 0x1b)}[31mred${String.fromCodePoint(0x07)} ${String.fromCodePoint(0x2066)}iso${String.fromCodePoint(0x2069)} ${String.fromCodePoint(0x200f)}end`,
  pathTraversal: '..\\..\\..\\Windows\\System32\\x ../../etc/passwd',
};
const TARGETS = ['pol-s15', 'pol-s03'] as const;
const SINKS = ['xlsx cells', '.eml headers', '.eml bodies', 'summary.txt', 'web HTML', 'Telegram text (FakeNotifier)', 'audit details', 'log lines', 'output paths'] as const;
type Sink = (typeof SINKS)[number];

const matrix = new Map<Sink, Map<string, string>>(SINKS.map((s) => [s, new Map()]));
const record = (sink: Sink, input: string, problem: string | null) => matrix.get(sink)?.set(input, problem === null ? 'PASS' : `FAIL: ${problem}`);

function hostileTerms(policyId: string, side: 'expiring' | 'renewal', h: string): ExtractedTerms {
  const truth = parseGroundTruth(JSON.parse(readFileSync(path.join(FIXTURES, 'ground-truth', `${policyId}.json`), 'utf8')));
  const terms = structuredClone(truth.expectedTerms[side] as ExtractedTerms);
  for (const field of ['insurerName', 'policyNumber', 'policyType', 'periodStart', 'periodEnd', 'annualPremium', 'excess', 'coverLimit'] as const) {
    (terms[field] as { sourceQuote: string | null }).sourceQuote = h;
  }
  terms.policyNumber = { ...terms.policyNumber, value: h };
  terms.keyExclusions = terms.keyExclusions.map((e) => ({ ...e, title: h, summary: h }));
  return terms;
}

function hostileReader(h: string): TermsReader {
  const base = createGroundTruthReader(FIXTURES);
  const read: TermsReader['read'] = async (p, ctx) => {
    const result = await base.read(p, ctx);
    return (TARGETS as readonly string[]).includes(ctx.policyId) ? { ...result, terms: hostileTerms(ctx.policyId, ctx.kind, h) } : result;
  };
  return { ...base, read, peek: read };
}

function hostileSource(source: DataSource, clientIds: ReadonlySet<string>, h: string): DataSource {
  return {
    listPolicies: () => source.listPolicies(),
    getPolicy: (id) => source.getPolicy(id),
    getClient: async (id) => {
      const client = await source.getClient(id);
      return client && clientIds.has(id) ? { ...client, name: h } : client;
    },
    getBroker: (id) => source.getBroker(id),
    getDocumentPaths: (id) => source.getDocumentPaths(id),
    updateRenewalStatus: (id, status) => source.updateRenewalStatus(id, status),
  };
}

const ALLOWED_HEADERS = new Set(['from', 'to', 'subject', 'date', 'message-id', 'mime-version', 'content-type', 'content-transfer-encoding', 'x-unsent']);

function checkEmlHeaders(eml: string): string | null {
  if (/\r(?!\n)|(?<!\r)\n/.test(eml)) return 'line endings are not all CRLF';
  const head = eml.split('\r\n\r\n')[0] ?? '';
  for (const line of head.split('\r\n')) {
    if (line.length > 998) return `header line of ${line.length} chars`;
    if (/^[ \t]/.test(line)) continue; // folded continuation
    const name = /^([A-Za-z-]+):/.exec(line)?.[1]?.toLowerCase();
    if (!name || !ALLOWED_HEADERS.has(name)) return `unexpected header line "${line.slice(0, 40)}"`;
  }
  return unsafeCharsIn(head, { allowCrLf: true });
}

function checkEmlBody(eml: string): string | null {
  const [head, ...rest] = eml.split('\r\n\r\n');
  if (!/content-type: text\/plain/i.test(head ?? '')) return 'not text/plain';
  const body = rest.join('\r\n\r\n');
  if (body.split('\r\n').some((l) => l.length > 998)) return 'body line over 998 chars';
  return unsafeCharsIn(body, { allowCrLf: true });
}

async function checkXlsx(file: string): Promise<string | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  let problem: string | null = null;
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (problem) return;
        if (cell.formula || cell.type === ExcelJS.ValueType.Formula) problem = `formula cell ${sheet.name}!${cell.address}`;
        else if (typeof cell.value === 'string') {
          if (/^[=+\-@\t\r]/.test(cell.value)) problem = `unguarded formula starter in ${sheet.name}!${cell.address}`;
          else problem = unsafeCharsIn(cell.value) ? `${sheet.name}!${cell.address} ${unsafeCharsIn(cell.value)}` : null;
        }
      });
    });
  });
  return problem;
}

function checkPath(outputDir: string, relative: string): string | null {
  const segments = relative.split('/');
  if (!segments.every((s) => /^[a-z0-9][a-z0-9.-]*$/.test(s))) return `unsafe segment in ${relative.slice(0, 80)}`;
  const absolute = path.resolve(outputDir, ...segments);
  const rel = path.relative(path.resolve(outputDir), absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return 'escapes the output folder';
  if (absolute.length >= 260) return `path is ${absolute.length} characters (Windows MAX_PATH 260)`;
  return null;
}

describe('attack-surface matrix', () => {
  for (const [name, h] of Object.entries(HOSTILE)) {
    it(`hostile input "${name}" through every sink`, async () => {
      const demo = await createDemo({ runPipeline: false });
      const telegram = new FakeNotifier('telegram');
      const logLines: string[] = [];
      const printed: string[] = [];
      let server: WebApprovalServer | null = null;
      try {
        const clientIds = new Set<string>();
        for (const id of TARGETS) {
          const policy = await demo.dataSource.getPolicy(id);
          if (policy) clientIds.add(policy.clientId);
        }
        const dataSource = hostileSource(demo.dataSource, clientIds, h);
        const dispatcher = createDispatcher({ db: demo.db, clock: demo.clock, dataSource, notifiers: [telegram], outputDir: demo.outputDir, today: () => TODAY, reminderAfterHours: 48, reminderIntervalHours: 24, sleep: async () => {} });
        const summary = await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ dataSource, reader: hostileReader(h), onPacksReady: dispatcher.onPacksReady, print: (l) => printed.push(l) }) });
        printed.push(formatRunSummary(summary));
        const packs = TARGETS.map((id) => demo.packFor(id)); // throws if the sink was never reached
        const logger = createLogger({ level: 'debug', sink: (line) => logLines.push(line) });
        logger.info('pack ready', { client: h, policyNumber: h, exclusionTitle: h, quote: h });

        // xlsx, eml, summary, paths
        const problems = { xlsx: [] as string[], head: [] as string[], body: [] as string[], summary: [] as string[], paths: [] as string[] };
        for (const pack of packs) {
          const file = (rel: string) => path.join(demo.outputDir, ...rel.split('/'));
          const x = await checkXlsx(file(pack.paths.xlsx));
          if (x) problems.xlsx.push(x);
          for (const eml of [pack.paths.clientEml, pack.paths.insurerEml]) {
            const text = readFileSync(file(eml), 'utf8');
            const hp = checkEmlHeaders(text);
            if (hp) problems.head.push(hp);
            const bp = checkEmlBody(text);
            if (bp) problems.body.push(bp);
          }
          const summaryText = readFileSync(file(pack.paths.summaryTxt), 'utf8');
          const sp = unsafeCharsIn(summaryText) ?? (summaryText.split('\n').filter((l) => l.startsWith('Client: ')).length === 1 ? null : 'Client line split or duplicated');
          if (sp) problems.summary.push(sp);
          for (const rel of Object.values(pack.paths)) {
            const pp = checkPath(demo.outputDir, rel);
            if (pp) problems.paths.push(pp);
          }
        }
        record('xlsx cells', name, problems.xlsx[0] ?? null);
        record('.eml headers', name, problems.head[0] ?? null);
        record('.eml bodies', name, problems.body[0] ?? null);
        record('summary.txt', name, problems.summary[0] ?? null);
        record('output paths', name, problems.paths[0] ?? null);

        // web HTML (real HTTP on 127.0.0.1)
        const token = generateToken();
        const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource, outputDir: demo.outputDir, allowedTelegramChatIds: [] });
        server = new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource, port: 0, token, approverName: 'Alex Morrow', today: () => TODAY });
        const port = await server.start(core.handleAction);
        const cookie = await loginCookie(port, token);
        let webProblem: string | null = null;
        for (const urlPath of ['/', ...packs.map((p) => `/pack/${p.id}`)]) {
          const reply = await httpGet(port, urlPath, { Cookie: cookie });
          if (reply.status !== 200) webProblem ??= `${urlPath} returned ${reply.status}`;
          // Merge note (D-136, after Prompt 8 D-125): the page carries exactly the whitelisted same-origin script
          // tags (SCRIPT_TAGS) once; any OTHER <script (an injected one) is still a failure.
          else if (reply.text.split(SCRIPT_TAGS).length !== 2 || /<script/i.test(reply.text.replace(SCRIPT_TAGS, ''))) webProblem ??= `${urlPath} contains <script`;
          else if (reply.text.includes('<b>x</b>')) webProblem ??= `${urlPath} contains unescaped markup`;
          else if (!String(reply.headers['content-security-policy'] ?? '').includes("default-src 'none'")) webProblem ??= 'CSP header missing';
          else webProblem ??= unsafeCharsIn(reply.text, { allowCrLf: true }) ? `${urlPath} ${unsafeCharsIn(reply.text, { allowCrLf: true })}` : null;
        }
        record('web HTML', name, webProblem);

        // Telegram message text (plain text, no parse_mode; Bot API limit 1-4096 characters per the grammY types)
        const texts = telegram.records.map((r) => r.text);
        const tg =
          texts.length === 0
            ? 'no message recorded'
            : (texts.map((t) => (t.length < 1 || t.length > 4096 ? `message of ${t.length} chars` : unsafeCharsIn(t))).find((p) => p !== null) ?? null);
        record('Telegram text (FakeNotifier)', name, tg);

        // audit details (stored rows + the CLI timeline that prints them)
        const events = listAllAudit(demo.db).filter((e) => (TARGETS as readonly string[]).includes(e.policyId ?? ''));
        let auditProblem: string | null = null;
        for (const e of events) {
          const json = JSON.stringify(e.details);
          if (json.length > 2000) auditProblem ??= `details of ${json.length} chars`;
          for (const v of Object.values(e.details).flat()) if (typeof v === 'string' && v.length > 300) auditProblem ??= `detail string of ${v.length} chars`;
        }
        for (const id of TARGETS) auditProblem ??= unsafeCharsIn(formatAuditTimeline(id, events.filter((e) => e.policyId === id)));
        record('audit details', name, auditProblem);

        // log lines (structured logger + the run summary printed by the CLI)
        let logProblem: string | null = null;
        for (const line of logLines) {
          if (/[\r\n]/.test(line.trimEnd())) logProblem ??= 'log line contains a raw line break';
          try {
            JSON.parse(line);
          } catch {
            logProblem ??= 'log line is not valid JSON';
          }
          if (line.length > 4000) logProblem ??= `log line of ${line.length} chars`;
          logProblem ??= unsafeCharsIn(line.trimEnd());
        }
        for (const line of printed) logProblem ??= unsafeCharsIn(line);
        record('log lines', name, logProblem);
      } finally {
        await server?.stop();
        demo.cleanup();
      }
    });
  }

  afterAll(() => {
    const inputs = Object.keys(HOSTILE);
    const rows = SINKS.map((sink) => `| ${sink} | ${inputs.map((i) => (matrix.get(sink)?.get(i) ?? 'NOT RUN').replace(/\|/g, '/')).join(' | ')} |`);
    console.log(['', 'ATTACK-SURFACE MATRIX', `| Sink | ${inputs.join(' | ')} |`, `| --- | ${inputs.map(() => '---').join(' | ')} |`, ...rows, ''].join('\n'));
  });

  it('every cell of the matrix is PASS', () => {
    const failures = SINKS.flatMap((sink) => Object.keys(HOSTILE).map((i) => `${sink} x ${i}: ${matrix.get(sink)?.get(i) ?? 'NOT RUN'}`)).filter((line) => !line.endsWith(': PASS'));
    expect(failures).toEqual([]);
  });
});
