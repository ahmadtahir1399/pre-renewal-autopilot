import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { compareTerms } from '../src/compare/compareTerms.js';
import { buildSummary } from '../src/compare/summary.js';
import { LocalJsonSource } from '../src/data/localJsonSource.js';
import { parseGroundTruth } from '../src/domain/schemas.js';
import type { Broker, Client, ExtractedTerms, Policy } from '../src/domain/types.js';
import { buildEmails } from '../src/outputs/buildEml.js';
import { guardCellText } from '../src/outputs/buildXlsx.js';
import { encodeHeaderText, nzUtcOffset, renderEml, rfc5322Date } from '../src/outputs/eml.js';
import { assertEmailFactsMatch, EmailFactMismatchError, factTokens, findBannedPhrases } from '../src/outputs/factCheck.js';
import { TEMPLATE_VERSION } from '../src/outputs/templates/emailTemplates.js';
import { PackConflictError, slugify, type WritePackInput, writePack } from '../src/outputs/writePack.js';
import { SEVERITY_FILLS } from '../src/outputs/xlsxLayout.js';

const RUN_DATE = '2026-10-19';
const CONFIG = { premiumMediumPct: 10, premiumHighPct: 25 };
const PACK_SCENARIOS = ['pol-s01', 'pol-s02', 'pol-s03', 'pol-s04', 'pol-s05', 'pol-s06', 'pol-s10', 'pol-s11', 'pol-s13', 'pol-s14', 'pol-s15'];

let outputDir: string;
let dataDir: string;
beforeEach(() => {
  outputDir = mkdtempSync(path.join(tmpdir(), 'pra-out-'));
  dataDir = mkdtempSync(path.join(tmpdir(), 'pra-data-'));
});
afterEach(() => {
  rmSync(outputDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

async function packInput(policyId: string, overrides: Partial<WritePackInput> = {}): Promise<WritePackInput> {
  const source = new LocalJsonSource({ fixturesDir: path.join(process.cwd(), 'fixtures'), dataDir });
  const policy = (await source.getPolicy(policyId)) as Policy;
  const client = (await source.getClient(policy.clientId)) as Client;
  const broker = (await source.getBroker(policy.brokerId)) as Broker;
  const gt = parseGroundTruth(JSON.parse(readFileSync(path.join('fixtures', 'ground-truth', `${policyId}.json`), 'utf8')));
  const expiring = gt.expectedTerms.expiring as ExtractedTerms;
  const renewal = gt.expectedTerms.renewal as ExtractedTerms;
  const comparison = compareTerms(expiring, renewal, CONFIG);
  return { runDate: RUN_DATE, version: 1, client, broker, policy, terms: { expiring, renewal }, comparison, summary: buildSummary(comparison.diffs), outputDir, ...overrides };
}

async function openXlsx(relativePath: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(outputDir, ...relativePath.split('/')));
  return workbook;
}

function rowValues(sheet: ExcelJS.Worksheet, row: number, columns: number): unknown[] {
  return Array.from({ length: columns }, (_, i) => sheet.getRow(row).getCell(i + 1).value);
}

function parseEml(text: string): { headers: Record<string, string>; body: string; rawHeaderLines: string[] } {
  const [head = '', ...rest] = text.split('\r\n\r\n');
  const unfolded = head.replace(/\r\n[ \t]/g, ' ');
  const rawHeaderLines = unfolded.split('\r\n');
  const headers: Record<string, string> = {};
  for (const line of rawHeaderLines) {
    const index = line.indexOf(':');
    headers[line.slice(0, index)] = line.slice(index + 1).trim();
  }
  return { headers, body: rest.join('\r\n\r\n').replace(/\r\n/g, '\n'), rawHeaderLines };
}

function decodeEncodedWords(value: string): string {
  // RFC 2047: whitespace BETWEEN two encoded words is ignored; other spaces are kept.
  return value
    .replace(/(\?=)\s+(=\?UTF-8\?B\?)/g, '$1$2')
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_m, b64: string) => Buffer.from(b64, 'base64').toString('utf8'));
}

describe('comparison.xlsx', () => {
  it('pol-s15: four sheets, frozen headers, premium high, limit info, exclusion removed info', async () => {
    const result = await writePack(await packInput('pol-s15'));
    const workbook = await openXlsx(result.paths.xlsx);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Summary', 'Comparison', 'Flags', 'Sources']);
    for (const sheet of workbook.worksheets) expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });

    const comparison = workbook.getWorksheet('Comparison') as ExcelJS.Worksheet;
    expect(rowValues(comparison, 1, 6)).toEqual(['Field', 'Expiring', 'Renewal', 'Change', 'Severity', 'Source pages']);
    expect(rowValues(comparison, 2, 6)).toEqual(['Annual premium', 21000, 26670, 'increased', 'high', 'expiring p1, renewal p1']);
    expect(rowValues(comparison, 3, 6)).toEqual(['Cover limit', 8000000, 9500000, 'increased', 'info', 'expiring p1, renewal p1']);
    expect(rowValues(comparison, 4, 6)).toEqual(['Exclusion: Vacant or unoccupied buildings', 'Vacant or unoccupied buildings', '(none)', 'removed', 'info', 'expiring p4']);
    const severityCell = comparison.getRow(2).getCell(5);
    expect((severityCell.fill as ExcelJS.FillPattern).fgColor?.argb).toBe(SEVERITY_FILLS.high);
    expect(comparison.getRow(2).getCell(7).value).toBe('Annual premium increases from 21,000 to 26,670 (+5,670, +27.0 percent).');

    const flags = workbook.getWorksheet('Flags') as ExcelJS.Worksheet;
    expect(rowValues(flags, 2, 2)).toEqual(['high', 'Annual premium']);
    expect(flags.getRow(3).getCell(1).value).toBeNull();

    const summary = workbook.getWorksheet('Summary') as ExcelJS.Worksheet;
    const summaryMap = new Map<unknown, unknown>();
    summary.eachRow((row) => summaryMap.set(row.getCell(1).value, row.getCell(2).value));
    expect(summaryMap.get('Client')).toBe('Quarry Lane Print Works Ltd');
    expect(summaryMap.get('Broker')).toBe('Alex Morrow');
    expect(summaryMap.get('Expiry date')).toBe('2027-02-06');
    expect(summaryMap.get('Run date')).toBe(RUN_DATE);
    expect(summaryMap.get('Overall risk')).toBe('high');
    expect(summaryMap.get('Items needing attention')).toBe(1);

    const sources = workbook.getWorksheet('Sources') as ExcelJS.Worksheet;
    expect(rowValues(sources, 2, 6)).toEqual(['Insurer', 'Expiring', 'Tarn and Fell Underwriting Ltd', 1, 'Insurer: Tarn and Fell Underwriting Ltd', 'high']);
    const premiumRenewal = [] as unknown[][];
    sources.eachRow((row) => {
      if (row.getCell(1).value === 'Annual premium' && row.getCell(2).value === 'Renewal') premiumRenewal.push(rowValues(sources, row.number, 6));
    });
    expect(premiumRenewal).toEqual([['Annual premium', 'Renewal', 26670, 1, 'Annual premium (excl. GST): NZD 26,670.00', 'high']]);
  });

  it('pol-s02: cover limit decreased is high', async () => {
    const result = await writePack(await packInput('pol-s02'));
    const comparison = (await openXlsx(result.paths.xlsx)).getWorksheet('Comparison') as ExcelJS.Worksheet;
    expect(rowValues(comparison, 2, 6)).toEqual(['Cover limit', 10000000, 5000000, 'decreased', 'high', 'expiring p1, renewal p1']);
    expect(comparison.getRow(3).getCell(1).value).toBeNull();
  });

  it('pol-s13 (no changes) says so in the sheet and both emails', async () => {
    const input = await packInput('pol-s13');
    const result = await writePack(input);
    const comparison = (await openXlsx(result.paths.xlsx)).getWorksheet('Comparison') as ExcelJS.Worksheet;
    expect(comparison.getRow(2).getCell(1).value).toBe('No changes found');
    const emails = buildEmails({ ...input, diffs: input.comparison.diffs, flags: input.comparison.flags });
    expect(emails.client.body).toContain('We found no changes to the main terms.');
    expect(emails.insurer.body).toContain('Please confirm the renewal terms set out in your renewal offer');
  });

  it('SPREADSHEET INJECTION GUARD: a formula-looking quote is stored as text, never a formula', async () => {
    const input = await packInput('pol-s01');
    const evil = '=HYPERLINK("http://example.com","x")';
    input.terms.expiring.insurerName.sourceQuote = evil;
    const result = await writePack(input);
    const sources = (await openXlsx(result.paths.xlsx)).getWorksheet('Sources') as ExcelJS.Worksheet;
    const cell = sources.getRow(2).getCell(5);
    expect(cell.value).toBe(`'${evil}`);
    expect(cell.formula).toBeUndefined();
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.numFmt).toBe('@');
    for (const risky of ['+1', '-2', '@x', '\tx', '\rx', '=1']) expect(guardCellText(risky).startsWith("'")).toBe(true);
    expect(guardCellText('Normal text')).toBe('Normal text');
    // Prompt 5 (D-130): a starter hidden behind a control character is still guarded after cleaning.
    expect(guardCellText(`${String.fromCodePoint(0)}=cmd`)).toBe("'=cmd");
  });
});

describe('draft emails', () => {
  it('client and insurer .eml files have the expected headers and bodies (pol-s15)', async () => {
    const result = await writePack(await packInput('pol-s15'));
    const client = parseEml(readFileSync(path.join(outputDir, ...result.paths.clientEml.split('/')), 'utf8'));
    expect(client.headers).toMatchObject({
      From: '"Alex Morrow" <alex.morrow@example.com>',
      To: '"Mereana Doyle" <mereana.doyle@example.com>',
      Subject: 'Your Commercial Property insurance renewal - 6 February 2027',
      Date: 'Mon, 19 Oct 2026 07:00:00 +1300',
      'MIME-Version': '1.0',
      'Content-Type': 'text/plain; charset=UTF-8',
      'X-Unsent': '1',
    });
    expect(client.headers['Message-ID']).toMatch(/^<[a-f0-9]{32}@pre-renewal-autopilot\.example>$/);
    expect(client.body).toContain('Hi Mereana,');
    expect(client.body).toContain('due for renewal on 6 February 2027');
    expect(client.body).toContain('Annual premium increases from 21,000 to 26,670 (+5,670, +27.0 percent).');
    expect(client.body).toContain('Has anything changed in your business');
    expect(client.body).not.toMatch(/\b(high|medium|low)\b/); // no risk level in the client email

    const insurer = parseEml(readFileSync(path.join(outputDir, ...result.paths.insurerEml.split('/')), 'utf8'));
    expect(insurer.headers.To).toBe('"Tarn and Fell Underwriting Ltd" <renewals+tarn-and-fell-underwriting-ltd@example.com>');
    expect(insurer.body.replace(/\s+/g, ' ')).toContain('- Please confirm the reason the annual premium has increased from 21,000 to 26,670.');
    expect(insurer.body.match(/Please confirm/g)).toHaveLength(1); // only the HIGH item; info items are not asked
  });

  it('pol-s02 insurer email asks about the reduced cover limit', async () => {
    const input = await packInput('pol-s02');
    const emails = buildEmails({ ...input, diffs: input.comparison.diffs, flags: input.comparison.flags });
    expect(emails.insurer.body.replace(/\s+/g, ' ')).toContain('Please confirm the reason the cover limit has reduced from 10,000,000 to 5,000,000.');
  });

  it('assertEmailFactsMatch passes for all 11 pack scenarios and the client lint finds nothing', async () => {
    for (const policyId of PACK_SCENARIOS) {
      const input = await packInput(policyId);
      const emails = buildEmails({ ...input, diffs: input.comparison.diffs, flags: input.comparison.flags });
      for (const email of [emails.client, emails.insurer]) {
        expect(() => assertEmailFactsMatch(email, input.comparison.diffs, input.policy, input.client), policyId).not.toThrow();
      }
      expect(findBannedPhrases(emails.client.body), policyId).toEqual([]);
    }
  });

  it('assertEmailFactsMatch FAILS when a number or a date is altered by hand', async () => {
    const input = await packInput('pol-s15');
    const { client } = buildEmails({ ...input, diffs: input.comparison.diffs, flags: input.comparison.flags });
    const check = (body: string) => () => assertEmailFactsMatch({ ...client, body }, input.comparison.diffs, input.policy, input.client);
    expect(check(client.body.replace('26,670', '26,970'))).toThrow(EmailFactMismatchError);
    expect(check(client.body.replace('6 February 2027', '7 February 2027'))).toThrow(EmailFactMismatchError);
    expect(check(`${client.body}\nCall us on 0800 123 456.`)).toThrow(EmailFactMismatchError);
    expect(check(client.body)).not.toThrow();
  });

  it('treats dates as one token', () => {
    expect(factTokens('Starts 2027-01-18, renews 17 January 2027, costs 12,400.00 in pol-s01')).toEqual(['2027-01-17', '2027-01-18', '12400']);
  });

  it('the advice/promise lint is a coarse phrase check', () => {
    expect(findBannedPhrases('We recommend you accept. You will be covered.')).toEqual(['we recommend', 'you will be covered']);
  });

  it('HEADER INJECTION GUARD: CR/LF in names or subjects cannot add headers', () => {
    const eml = renderEml({
      from: { name: 'Alex Morrow', email: 'alex.morrow@example.com' },
      to: { name: 'Eve\r\nBcc: attacker@example.com', email: 'eve@example.com' },
      subject: 'Hello\r\nBcc: attacker@example.com\nX-Evil: 1',
      body: 'Body',
      runDate: RUN_DATE,
    });
    const { rawHeaderLines, headers } = parseEml(eml);
    expect(rawHeaderLines.some((line) => /^(Bcc|X-Evil):/i.test(line))).toBe(false);
    expect(headers.To).toBe('"Eve Bcc: attacker@example.com" <eve@example.com>');
    expect(() =>
      renderEml({ from: { name: 'A', email: 'a@example.com' }, to: { name: 'B', email: 'b@example.com\r\nBcc: x@example.com' }, subject: 's', body: 'b', runDate: RUN_DATE }),
    ).toThrow('Invalid email address');
  });

  it('encodes accented names and subjects (RFC 2047)', async () => {
    const input = await packInput('pol-s01');
    input.client = { ...input.client, name: 'Café Société Ltd', contactName: 'Zoë Ngā-Rēhia' };
    const emails = buildEmails({ ...input, diffs: input.comparison.diffs, flags: input.comparison.flags });
    const client = parseEml(renderEml(emails.client));
    expect(client.headers.To).toMatch(/^=\?UTF-8\?B\?/);
    expect(decodeEncodedWords(client.headers.To ?? '')).toBe('Zoë Ngā-Rēhia <zoe.example@example.com>'.replace('zoe.example@example.com', input.client.contactEmail));
    expect(client.body).toContain('Hi Zoë,');
    const insurer = parseEml(renderEml(emails.insurer));
    expect(decodeEncodedWords(insurer.headers.Subject ?? '')).toBe('Renewal query - Café Société Ltd - Commercial Property - 17 January 2027');
    expect(encodeHeaderText('Plain ASCII')).toBe('Plain ASCII');
  });

  it('dates drafts at 07:00 New Zealand time from the run date (hand-coded DST rule)', () => {
    expect(rfc5322Date('2026-10-19')).toBe('Mon, 19 Oct 2026 07:00:00 +1300');
    expect(nzUtcOffset('2026-07-01')).toBe('+1200');
    expect(nzUtcOffset('2026-09-26')).toBe('+1200');
    expect(nzUtcOffset('2026-09-27')).toBe('+1300'); // last Sunday in September 2026
    expect(nzUtcOffset('2027-04-03')).toBe('+1300');
    expect(nzUtcOffset('2027-04-04')).toBe('+1200'); // first Sunday in April 2027
    expect(rfc5322Date('2027-01-01')).toBe('Fri, 01 Jan 2027 07:00:00 +1300');
  });
});

describe('writePack', () => {
  it('same input twice: same contentHash, second call is a no-op', async () => {
    const first = await writePack(await packInput('pol-s15'));
    const second = await writePack(await packInput('pol-s15'));
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.written).toBe(false);
    expect(first.paths.dir).toBe('2026-10-19/quarry-lane-print-works-ltd/pol-s15/v1');
    expect(JSON.parse(readFileSync(path.join(outputDir, ...first.paths.manifest.split('/')), 'utf8'))).toMatchObject({
      contentHash: first.contentHash,
      templateVersion: TEMPLATE_VERSION,
    });
  });

  it('changed input: different hash; versions are immutable unless allowOverwrite', async () => {
    const first = await writePack(await packInput('pol-s15'));
    const changed = await packInput('pol-s15');
    changed.broker = { ...changed.broker, name: 'Sam Takerei' };
    await expect(writePack(changed)).rejects.toBeInstanceOf(PackConflictError);
    const overwritten = await writePack({ ...changed, allowOverwrite: true });
    expect(overwritten.contentHash).not.toBe(first.contentHash);
    expect(overwritten.written).toBe(true);
  });

  it('slugifies unusual names safely and never leaves the output directory', async () => {
    expect(slugify('Café Société Ltd', 'client')).toBe('cafe-societe-ltd');
    expect(slugify('  ***  ', 'client')).toBe('client');
    expect(slugify('CON', 'client')).toBe('client');
    expect(slugify('com1', 'client')).toBe('client');
    expect(slugify('../../evil', 'client')).toBe('evil');
    expect(slugify('a'.repeat(100), 'client')).toHaveLength(60);
    expect(slugify('Ngā--Rēhia   & Sons', 'client')).toBe('nga-rehia-sons');

    const input = await packInput('pol-s01');
    input.client = { ...input.client, name: '../../evil' };
    const result = await writePack(input);
    expect(result.paths.dir).toBe('2026-10-19/evil/pol-s01/v1');
    const resolved = path.resolve(outputDir, ...result.paths.dir.split('/'));
    expect(path.relative(outputDir, resolved).startsWith('..')).toBe(false);
  });

  it('rejects a bad run date or version', async () => {
    await expect(writePack(await packInput('pol-s01', { runDate: '2026-02-30' }))).rejects.toThrow(RangeError);
    await expect(writePack(await packInput('pol-s01', { version: 0 }))).rejects.toThrow(RangeError);
  });
});
