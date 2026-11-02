// Prompt 7 Stage U4: the overview spreadsheet (model, workbook, storage, web routes) and the origin row.

import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../src/approval/actions.js';
import { generateToken, WebApprovalServer } from '../src/approval/web/server.js';
import { buildOverviewModel, type OverviewCase, overviewModelText, OVERVIEW_MAX_ROWS } from '../src/outputs/buildOverviewXlsx.js';
import { buildWorkbookModel, UPLOADED_SOURCE_ROW } from '../src/outputs/buildXlsx.js';
import { createOverview, exportFilePath, normaliseFilters, resolveExportPath } from '../src/outputs/overview.js';
import { listAllAudit } from '../src/state/audit.js';
import { getPackById } from '../src/state/repo.js';
import { type AnalysisDeps, analyseUpload } from '../src/uploads/analysisService.js';
import { createKnownDocumentReader, type KnownDocumentRegistry, loadKnownDocuments } from '../src/uploads/knownDocuments.js';
import { ManualAwareSource } from '../src/uploads/manualSource.js';
import { listExports } from '../src/uploads/repo.js';
import { createDemo, type Demo, FIXTURES, stripMotionScripts, TODAY } from './helpers.js';
import { SAMPLES, sample } from './uploadHelpers.js';

let registry: KnownDocumentRegistry;
beforeAll(() => {
  registry = loadKnownDocuments({ fixturesDir: FIXTURES, samplesDir: SAMPLES });
});

let demo: Demo;
beforeEach(async () => {
  demo = await createDemo();
});
afterEach(() => demo.cleanup());

const overviewDeps = () => ({ db: demo.db, clock: demo.clock, dataSource: new ManualAwareSource(demo.dataSource, demo.db), outputDir: demo.outputDir });

function analysisDeps(): AnalysisDeps {
  return {
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
    dailyLimit: 10,
    timeoutMs: 60_000,
  };
}

async function addHarbourview(clientName = 'Harbourview Bakery Ltd') {
  return analyseUpload(
    {
      mode: 'new',
      newPolicy: { clientName, brokerId: 'brk-01' },
      files: { expiring: { bytes: sample('harbourview-expiring.pdf') }, renewal: { bytes: sample('harbourview-renewal.pdf') } },
      consent: true,
      actor: 'broker:cli',
    },
    analysisDeps(),
  );
}

async function open(file: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  return workbook;
}

const cellText = (sheet: ExcelJS.Worksheet, row: number) =>
  ((sheet.getRow(row).values as ExcelJS.CellValue[]) ?? []).slice(1).map((v) => (v === null || v === undefined ? '' : String(v)));

describe('per-analysis comparison workbook: origin row', () => {
  it('uploaded packs get ONE Summary row "Source: Uploaded manually"; nightly packs are unchanged', async () => {
    const result = await addHarbourview();
    const pack = getPackById(demo.db, result.job.packId as number);
    const workbook = await open(path.join(demo.outputDir, ...(pack?.paths.xlsx ?? '').split('/')));
    const summary = workbook.getWorksheet('Summary') as ExcelJS.Worksheet;
    const rows = Array.from({ length: summary.rowCount }, (_, i) => cellText(summary, i + 1));
    expect(rows).toContainEqual([...UPLOADED_SOURCE_ROW]);
    const nightly = demo.packFor('pol-s01');
    const nightlyBook = await open(path.join(demo.outputDir, ...nightly.paths.xlsx.split('/')));
    const nightlySummary = nightlyBook.getWorksheet('Summary') as ExcelJS.Worksheet;
    const nightlyRows = Array.from({ length: nightlySummary.rowCount }, (_, i) => cellText(nightlySummary, i + 1));
    expect(nightlyRows.some((r) => r[0] === 'Source')).toBe(false);
  });

  it('the model only differs by that row (so old content hashes stay identical)', () => {
    const terms = JSON.parse(readFileSync(path.join(FIXTURES, 'ground-truth', 'pol-s01.json'), 'utf8')).expectedTerms;
    const input = {
      runDate: TODAY,
      client: { id: 'c', name: 'C', contactName: 'N', contactEmail: 'n@example.com' },
      broker: { id: 'b', name: 'B', email: 'b@example.com' },
      policy: { id: 'pol-x', clientId: 'c', brokerId: 'b', insurerName: 'I', type: 'commercial_property' as const, expiryDate: '2027-01-17', annualPremium: 1, status: 'in_review' as const },
      terms: { expiring: terms.expiring, renewal: terms.renewal },
      diffs: [],
      flags: [],
      overallRisk: 'info' as const,
      summary: { headline: ['No changes.'], details: [] },
    };
    const plain = buildWorkbookModel(input);
    expect(buildWorkbookModel({ ...input, uploaded: false })).toEqual(plain);
    const uploaded = buildWorkbookModel({ ...input, uploaded: true });
    expect(uploaded.summary.length).toBe(plain.summary.length + 1);
    expect(uploaded.comparison).toEqual(plain.comparison);
  });
});

describe('overview spreadsheet', () => {
  it('opens cleanly with the three sheets, frozen headers, print setup and the expected cells', async () => {
    await addHarbourview();
    const result = await createOverview({ filters: normaliseFilters({}), runDate: TODAY, actor: 'broker:cli' }, overviewDeps());
    if (result.kind === 'empty') throw new Error('expected rows');
    expect(result.kind).toBe('created');
    expect(result.record.relativePath).toMatch(/^overview\/2026-10-19\/[0-9a-f]{12}\/overview\.xlsx$/);
    const file = resolveExportPath(demo.outputDir, result.record.relativePath);
    const workbook = await open(file);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Overview', 'Flags', 'Notes']);
    const overview = workbook.getWorksheet('Overview') as ExcelJS.Worksheet;
    expect(cellText(overview, 1)).toEqual(['Policy', 'Client', 'Type', 'Insurer', 'Expiry date', 'Weeks to renewal', 'Overall risk', 'Flags', 'Top change', 'Status', 'Source', 'Pack version']);
    expect(overview.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(overview.pageSetup).toMatchObject({ orientation: 'landscape', fitToWidth: 1, printTitlesRow: '1:1' });
    // in_review (11 nightly + Harbourview) + approved pol-s12 (seeded, no pack): 13 rows, sorted by expiry date.
    expect(result.record.rowCount).toBe(13);
    const rows = Array.from({ length: overview.rowCount - 1 }, (_, i) => cellText(overview, i + 2));
    const harbourview = rows.find((r) => r[1] === 'Harbourview Bakery Ltd');
    expect(harbourview).toEqual(expect.arrayContaining(['Public Liability', '2026-12-03', 'in 6 weeks', 'High', '2', 'In review', 'Uploaded manually', '1']));
    const s12 = rows.find((r) => r[0] === 'pol-s12');
    expect(s12?.[6]).toBe('(no pack)');
    expect(rows.map((r) => r[4])).toEqual([...rows.map((r) => r[4])].sort());
    const riskCell = overview.getRow(rows.indexOf(harbourview as string[]) + 2).getCell(7);
    expect(riskCell.font?.bold).toBe(true);
    const flags = workbook.getWorksheet('Flags') as ExcelJS.Worksheet;
    const flagRows = Array.from({ length: flags.rowCount - 1 }, (_, i) => cellText(flags, i + 2));
    expect(flagRows.every((r) => r[2] === 'High' || r[2] === 'Medium')).toBe(true);
    expect(flagRows.filter((r) => r[1] === 'Harbourview Bakery Ltd')).toHaveLength(2);
    const notes = workbook.getWorksheet('Notes') as ExcelJS.Worksheet;
    const noteRows = Array.from({ length: notes.rowCount - 1 }, (_, i) => cellText(notes, i + 2));
    expect(noteRows).toContainEqual(['Status', 'Drafts only. Nothing has been sent.']);
    expect(noteRows).toContainEqual(['Data', 'Synthetic data only (concept project).']);
    expect(noteRows).toContainEqual(['Statuses included', 'In review, Approved']);
    expect(listAllAudit(demo.db).filter((e) => e.type === 'overview_created').at(-1)?.details).toMatchObject({ rows: 13, created: true });
  });

  it('the same content again is a no-op returning the same record; different filters make a new one', async () => {
    const first = await createOverview({ filters: normaliseFilters({}), runDate: TODAY, actor: 'broker:cli' }, overviewDeps());
    const again = await createOverview({ filters: normaliseFilters({}), runDate: TODAY, actor: 'broker:web' }, overviewDeps());
    if (first.kind === 'empty' || again.kind === 'empty') throw new Error('expected rows');
    expect(again.kind).toBe('existing');
    expect(again.record).toEqual(first.record);
    const other = await createOverview({ filters: normaliseFilters({ statuses: ['in_review'] }), runDate: TODAY, actor: 'broker:cli' }, overviewDeps());
    if (other.kind === 'empty') throw new Error('expected rows');
    expect(other.record.contentHash).not.toBe(first.record.contentHash);
    expect(listExports(demo.db)).toHaveLength(2);
    expect(await createOverview({ filters: normaliseFilters({ statuses: ['skipped'] }), runDate: TODAY, actor: 'broker:cli' }, overviewDeps())).toEqual({ kind: 'empty' });
    expect(listExports(demo.db)).toHaveLength(2);
  });

  it('include manual = no leaves uploaded cases out; unknown statuses fall back to the default', async () => {
    await addHarbourview();
    const without = await createOverview({ filters: normaliseFilters({ includeManual: false }), runDate: TODAY, actor: 'broker:cli' }, overviewDeps());
    if (without.kind === 'empty') throw new Error('expected rows');
    expect(without.record.rowCount).toBe(12);
    expect(normaliseFilters({ statuses: ['DROP TABLE', 'approved'] }).statuses).toEqual(['approved']);
    expect(normaliseFilters({ statuses: ['nope'] }).statuses).toEqual(['in_review', 'approved']);
  });

  it('every string is guarded against formulas; numbers stay numbers; the cap adds a visible note', () => {
    const base: OverviewCase = {
      policyId: 'man-000000000001',
      clientName: '=HYPERLINK("#x","y")',
      policyTypeLabel: 'Public Liability',
      insurerName: '+cmd',
      expiryDate: '2026-12-03',
      timing: 'in 6 weeks',
      risk: 'high',
      flags: [{ field: 'coverLimit', severity: 'high', message: '@SUM(1)' }],
      topChange: '-1 change',
      statusLabel: 'In review',
      source: 'Uploaded manually',
      version: 1,
    };
    const model = buildOverviewModel({ runDate: TODAY, filters: normaliseFilters({}), cases: Array.from({ length: OVERVIEW_MAX_ROWS + 3 }, () => base) });
    expect(model.truncated).toBe(true);
    expect(model.rowCount).toBe(OVERVIEW_MAX_ROWS);
    expect(model.overview).toHaveLength(OVERVIEW_MAX_ROWS + 1);
    expect(String(model.overview.at(-1)?.cells[0])).toBe(`Only the first ${OVERVIEW_MAX_ROWS} of ${OVERVIEW_MAX_ROWS + 3} cases are listed. Narrow the filters to see the rest.`);
    const first = model.overview[0]?.cells ?? [];
    expect(first[1]).toBe(`'=HYPERLINK("#x","y")`);
    expect(first[3]).toBe("'+cmd");
    expect(first[8]).toBe("'-1 change");
    expect(first[7]).toBe(1);
    expect(model.flags[0]?.cells[4]).toBe("'@SUM(1)");
    expect(overviewModelText(model)).toBe(overviewModelText(buildOverviewModel({ runDate: TODAY, filters: normaliseFilters({}), cases: Array.from({ length: OVERVIEW_MAX_ROWS + 3 }, () => base) })));
  });

  it('stored paths cannot leave output/overview; downloads use the database path only', async () => {
    for (const bad of ['../x.xlsx', 'overview/../../x.xlsx', 'overview/2026-10-19/abc/overview.xlsx', 'C:/x.xlsx', 'overview\\2026-10-19\\aaaaaaaaaaaa\\overview.xlsx']) {
      expect(() => resolveExportPath(demo.outputDir, bad), bad).toThrow();
    }
    expect(exportFilePath(overviewDeps(), 999)).toBeNull();
    const result = await createOverview({ filters: normaliseFilters({}), runDate: TODAY, actor: 'broker:cli' }, overviewDeps());
    if (result.kind === 'empty') throw new Error('expected rows');
    expect(existsSync(exportFilePath(overviewDeps(), result.record.id)?.absolutePath ?? '')).toBe(true);
  });
});

describe('overview over HTTP', () => {
  let server: WebApprovalServer;
  let port: number;
  let token: string;

  function send(method: string, urlPath: string, headers: Record<string, string>, body?: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string; bytes: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, method, path: urlPath, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: bytes.toString('utf8'), bytes });
        });
      });
      req.on('error', reject);
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  beforeEach(async () => {
    token = generateToken();
    const source = new ManualAwareSource(demo.dataSource, demo.db);
    server = new WebApprovalServer({ db: demo.db, clock: demo.clock, dataSource: source, port: 0, token, approverName: 'Alex Morrow', today: () => TODAY });
    server.enableExports(overviewDeps());
    port = await server.start(createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: source, outputDir: demo.outputDir, allowedTelegramChatIds: [] }).handleAction);
  });
  afterEach(async () => server.stop());

  it('form on the list page -> POST -> export page -> download; CSRF and Origin required; empty selection makes no file', async () => {
    const cookie = String((await send('GET', `/?t=${encodeURIComponent(token)}`, {})).headers['set-cookie'] ?? '').split(';')[0] ?? '';
    const list = await send('GET', '/', { Cookie: cookie });
    expect(list.text).toContain('<form class="form form--overview" method="post" action="/exports"><input type="hidden" name="csrf"');
    const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(list.text)?.[1] ?? '';
    const form = { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Origin: `http://127.0.0.1:${port}` };
    expect((await send('POST', '/exports', form, 'csrf=bad&status=in_review')).status).toBe(403);
    expect((await send('POST', '/exports', { ...form, Origin: 'http://evil.example' }, `csrf=${csrf}&status=in_review`)).status).toBe(403);
    const empty = await send('POST', '/exports', form, `csrf=${csrf}&status=skipped`);
    expect(empty.status).toBe(200);
    expect(empty.text).toContain('No cases match');
    expect(listExports(demo.db)).toHaveLength(0);

    const created = await send('POST', '/exports', form, `csrf=${csrf}&status=in_review&status=approved&include_manual=yes`);
    expect(created.status).toBe(303);
    const page = await send('GET', String(created.headers.location), { Cookie: cookie });
    expect(page.text).toContain('The overview spreadsheet is ready');
    expect(page.text).toContain('In review, Approved');
    expect(stripMotionScripts(page.text)).not.toMatch(/<script|\sstyle=/i);
    const id = Number(/\/exports\/(\d+)/.exec(String(created.headers.location))?.[1]);
    const download = await send('GET', `/exports/${id}/download`, { Cookie: cookie });
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename="overview-2026-10-19-[0-9a-f]{12}\.xlsx"$/);
    expect(download.bytes.subarray(0, 2).toString()).toBe('PK');
    expect((await send('GET', '/exports/999/download', { Cookie: cookie })).status).toBe(404);
    expect((await send('GET', '/exports/999', { Cookie: cookie })).status).toBe(404);
    expect((await send('GET', '/exports/1/download', {})).status).toBe(403);
    const again = await send('POST', '/exports', form, `csrf=${csrf}&status=in_review&status=approved&include_manual=yes`);
    expect(again.headers.location).toBe(`/exports/${id}?done=existing`);
  });
});
