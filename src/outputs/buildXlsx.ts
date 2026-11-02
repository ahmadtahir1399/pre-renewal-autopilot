// Fills templates/comparison.xlsx. Two steps:
//  1. buildWorkbookModel(): PURE -> plain rows of strings/numbers (also used for the content hash).
//  2. renderWorkbook(): loads the template and writes the rows, with severity colours AND words.
// The run date is an input; nothing here reads the clock.

import ExcelJS from 'exceljs';
import { describeField, EXCLUSION_LABELS, FIELD_LABELS } from '../compare/format.js';
import type { Summary } from '../compare/summary.js';
import { cleanText } from '../domain/text.js';
import type { Broker, Client, ExtractedTerms, Fact, Flag, IsoDate, Policy, Severity, TermDiff } from '../domain/types.js';
import { POLICY_TYPE_LABELS } from './labels.js';
import { FONT_NAME, FONT_SIZE, INK, PRINT_SETUP, PRINT_TITLE_ROWS, SEVERITY_FILLS, SEVERITY_INK, SHEETS, WORKBOOK_PROPERTIES } from './xlsxLayout.js';

export type CellValue = string | number;

export interface ModelRow {
  cells: CellValue[];
  /** Column index (0-based) that shows a severity word and gets its colour. */
  severityColumn?: number;
  severity?: Severity;
}

export interface WorkbookModel {
  summary: ModelRow[];
  comparison: ModelRow[];
  flags: ModelRow[];
  sources: ModelRow[];
}

export interface XlsxInput {
  runDate: IsoDate;
  client: Client;
  broker: Broker;
  policy: Policy;
  terms: { expiring: ExtractedTerms; renewal: ExtractedTerms };
  diffs: readonly TermDiff[];
  flags: readonly Flag[];
  overallRisk: Severity;
  summary: Summary;
  /**
   * Prompt 7: true when the pack was prepared from uploaded documents. Adds ONE Summary row ('Source',
   * 'Uploaded manually'); when false or absent the model (and so the content hash) is exactly as before.
   */
  uploaded?: boolean;
}

export const UPLOADED_SOURCE_ROW = ['Source', 'Uploaded manually'] as const;

/**
 * SPREADSHEET INJECTION GUARD (D-053): a string starting with = + - @ tab or carriage return
 * could be read as a formula. Such strings get a leading apostrophe, and every string is
 * written as an explicit text cell (number format '@'), never as a formula.
 */
export function guardCellText(value: string): string {
  // FIX (D-130): control characters and bidi overrides are removed (attack-surface matrix). The guard
  // looks at BOTH the original and the cleaned text: cleaning can expose a starter ("<NUL>=cmd") or
  // turn a leading CR into LF, and neither may lose the apostrophe.
  const clean = cleanText(value);
  const risky = /^[=+\-@\t\r]/;
  return risky.test(value) || risky.test(clean) ? `'${clean}` : clean;
}

const NOT_FOUND = '(not found)';
const NONE = '(none)';

function diffValue(value: string | number | null, field: string): CellValue {
  if (value === null) return NONE;
  if (typeof value === 'number') return value;
  if (field.startsWith('exclusion:') && !field.startsWith('exclusion:other:') && value in EXCLUSION_LABELS) {
    return EXCLUSION_LABELS[value as keyof typeof EXCLUSION_LABELS];
  }
  return value;
}

function pagesText(diff: TermDiff): string {
  const parts = [
    diff.expiringPage === undefined ? null : `expiring p${diff.expiringPage}`,
    diff.renewalPage === undefined ? null : `renewal p${diff.renewalPage}`,
  ].filter((p): p is string => p !== null);
  return parts.join(', ') || '-';
}

function factValue(fact: Fact<unknown>): CellValue {
  if (fact.value === null) return NOT_FOUND;
  if (typeof fact.value === 'number') return fact.value;
  return String(fact.value);
}

const FACT_FIELDS = ['insurerName', 'policyNumber', 'policyType', 'periodStart', 'periodEnd', 'annualPremium', 'excess', 'coverLimit'] as const;

function sourceRows(side: 'Expiring' | 'Renewal', terms: ExtractedTerms): ModelRow[] {
  const facts: ModelRow[] = FACT_FIELDS.map((field) => {
    const fact = terms[field] as Fact<unknown>;
    return {
      cells: [FIELD_LABELS[field] ?? field, side, factValue(fact), fact.sourcePage ?? '-', fact.sourceQuote ?? '-', fact.confidence],
    };
  });
  const exclusions: ModelRow[] = terms.keyExclusions.map((exclusion) => ({
    // The title is shown as evidence of what the document says; it is never used in a sentence.
    cells: [`Exclusion: ${EXCLUSION_LABELS[exclusion.key]}`, side, exclusion.key, exclusion.sourcePage, `Title in document: ${exclusion.title}`, '-'],
  }));
  return [...facts, ...exclusions];
}

function guardRows(rows: ModelRow[]): ModelRow[] {
  return rows.map((row) => ({ ...row, cells: row.cells.map((cell) => (typeof cell === 'string' ? guardCellText(cell) : cell)) }));
}

export function buildWorkbookModel(input: XlsxInput): WorkbookModel {
  const { policy, client, broker, summary } = input;
  const summaryRows: ModelRow[] = [
    { cells: ['Status', 'DRAFT for broker review. Nothing has been sent to the client or the insurer.'] },
    { cells: ['Client', client.name] },
    { cells: ['Broker', broker.name] },
    { cells: ['Policy', `${POLICY_TYPE_LABELS[policy.type]} (${policy.id})`] },
    { cells: ['Insurer', policy.insurerName] },
    { cells: ['Expiry date', policy.expiryDate] },
    { cells: ['Run date', input.runDate] },
    ...(input.uploaded ? [{ cells: [...UPLOADED_SOURCE_ROW] }] : []),
    { cells: ['Overall risk', input.overallRisk], severityColumn: 1, severity: input.overallRisk },
    { cells: ['Items needing attention', input.flags.length] },
    ...summary.headline.map((line, index): ModelRow => ({ cells: [index === 0 ? 'Key changes' : '', line] })),
  ];

  const comparisonRows: ModelRow[] =
    input.diffs.length === 0
      ? [{ cells: ['No changes found', '-', '-', '-', '-', '-', summary.headline[0] ?? ''] }]
      : input.diffs.map((diff) => ({
          cells: [describeField(diff.field), diffValue(diff.expiring, diff.field), diffValue(diff.renewal, diff.field), diff.change, diff.severity, pagesText(diff), diff.facts],
          severityColumn: 4,
          severity: diff.severity,
        }));

  const flagRows: ModelRow[] =
    input.flags.length === 0
      ? [{ cells: ['-', '-', 'Nothing needs attention.'] }]
      : input.flags.map((flag) => ({ cells: [flag.severity, describeField(flag.field), flag.message], severityColumn: 0, severity: flag.severity }));

  return {
    summary: guardRows(summaryRows),
    comparison: guardRows(comparisonRows),
    flags: guardRows(flagRows),
    sources: guardRows([...sourceRows('Expiring', input.terms.expiring), ...sourceRows('Renewal', input.terms.renewal)]),
  };
}

/** Canonical text of the model (for the content hash): every cell as a string, tab-separated rows. */
export function workbookModelText(model: WorkbookModel): string {
  const sheet = (name: string, rows: ModelRow[]) => [`# ${name}`, ...rows.map((row) => row.cells.map(String).join('\t'))].join('\n');
  return [
    sheet(SHEETS.summary.name, model.summary),
    sheet(SHEETS.comparison.name, model.comparison),
    sheet(SHEETS.flags.name, model.flags),
    sheet(SHEETS.sources.name, model.sources),
  ].join('\n');
}

function writeRows(sheet: ExcelJS.Worksheet, rows: ModelRow[]): void {
  rows.forEach((row, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 2); // row 1 is the frozen header
    row.cells.forEach((value, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      cell.value = value; // a plain string or number: never a formula object
      // Display formats only; the stored value is unchanged (and the content hash uses the model text).
      cell.numFmt = typeof value === 'string' ? '@' : Number.isInteger(value) ? '#,##0' : '#,##0.00';
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font = { name: FONT_NAME, size: FONT_SIZE, color: { argb: INK } };
      if (row.severity !== undefined && row.severityColumn === columnIndex) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEVERITY_FILLS[row.severity] } };
        cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: SEVERITY_INK[row.severity] } };
      }
    });
    excelRow.commit();
  });
}

/** Load the template and fill it. Returns the .xlsx bytes. */
export async function renderWorkbook(model: WorkbookModel, templatePath: string, runDate: IsoDate): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const runDateUtc = new Date(`${runDate}T00:00:00.000Z`); // derived from the input, not the clock
  workbook.created = runDateUtc;
  workbook.modified = runDateUtc;
  workbook.creator = WORKBOOK_PROPERTIES.creator;
  workbook.lastModifiedBy = WORKBOOK_PROPERTIES.lastModifiedBy;

  const targets: Array<[string, ModelRow[]]> = [
    [SHEETS.summary.name, model.summary],
    [SHEETS.comparison.name, model.comparison],
    [SHEETS.flags.name, model.flags],
    [SHEETS.sources.name, model.sources],
  ];
  for (const [name, rows] of targets) {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) throw new Error(`Template ${templatePath} has no sheet "${name}" (run npm run template:make)`);
    // Print setup is set here as well as in the template, so it holds even if a reader drops it on load.
    sheet.pageSetup = { ...sheet.pageSetup, ...PRINT_SETUP, margins: { ...PRINT_SETUP.margins }, printTitlesRow: PRINT_TITLE_ROWS };
    writeRows(sheet, rows);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
