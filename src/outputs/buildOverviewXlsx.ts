// The OVERVIEW spreadsheet (Prompt 7, U4): one row per current case, built from stored data only.
// Same two steps as buildXlsx: a PURE model (plain strings/numbers; also the content hash) and a renderer.
// Same styling roles, same injection guard (D-053) for every string (client names from uploads are untrusted).
// The run date is an input; nothing here reads the clock. No formulas are written, ever.

import ExcelJS from 'exceljs';
import { describeField } from '../compare/format.js';
import type { Flag, IsoDate, RenewalStatus, Severity } from '../domain/types.js';
import { guardCellText, type ModelRow } from './buildXlsx.js';
import { FONT_NAME, FONT_SIZE, HEADER_FILL, HEADER_RULE, INK, PRINT_SETUP, PRINT_TITLE_ROWS, SEVERITY_FILLS, SEVERITY_INK, WORKBOOK_PROPERTIES } from './xlsxLayout.js';

export const OVERVIEW_MAX_ROWS = 500;
export const OVERVIEW_STATUSES: readonly RenewalStatus[] = ['in_review', 'approved', 'skipped', 'needs_attention'];
export const DEFAULT_OVERVIEW_STATUSES: readonly RenewalStatus[] = ['in_review', 'approved'];

export interface OverviewFilters {
  statuses: RenewalStatus[];
  includeManual: boolean;
}

export interface OverviewCase {
  policyId: string;
  clientName: string;
  policyTypeLabel: string;
  insurerName: string;
  expiryDate: IsoDate;
  /** U-3 wording, e.g. 'in 12 weeks', 'today', 'expired 3 days ago'. */
  timing: string;
  /** null = no pack (needs attention). */
  risk: Severity | null;
  flags: readonly Flag[];
  /** Deterministic stored sentence of the most important change, or a fixed text. */
  topChange: string;
  statusLabel: string;
  source: 'Nightly run' | 'Uploaded manually';
  version: number | null;
}

export interface OverviewModel {
  overview: ModelRow[];
  flags: ModelRow[];
  notes: ModelRow[];
  totalCases: number;
  rowCount: number;
  truncated: boolean;
}

export const OVERVIEW_SHEETS = {
  overview: {
    name: 'Overview',
    headers: ['Policy', 'Client', 'Type', 'Insurer', 'Expiry date', 'Weeks to renewal', 'Overall risk', 'Flags', 'Top change', 'Status', 'Source', 'Pack version'],
    widths: [18, 30, 22, 30, 12, 18, 12, 7, 70, 16, 18, 12],
  },
  flags: { name: 'Flags', headers: ['Policy', 'Client', 'Severity', 'Field', 'What to check'], widths: [18, 30, 11, 30, 90] },
  notes: { name: 'Notes', headers: ['Item', 'Value'], widths: [28, 100] },
} as const;

const SEVERITY_WORDS: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const STATUS_WORDS: Record<string, string> = { in_review: 'In review', approved: 'Approved', skipped: 'Skipped', needs_attention: 'Needs attention' };

function guard(rows: ModelRow[]): ModelRow[] {
  return rows.map((row) => ({ ...row, cells: row.cells.map((cell) => (typeof cell === 'string' ? guardCellText(cell) : cell)) }));
}

/** Pure. Cases are expected in their final order (the service sorts by expiry date, then policy id). */
export function buildOverviewModel(input: { runDate: IsoDate; filters: OverviewFilters; cases: readonly OverviewCase[] }): OverviewModel {
  const shown = input.cases.slice(0, OVERVIEW_MAX_ROWS);
  const truncated = input.cases.length > shown.length;
  const overview: ModelRow[] = shown.map((c) => ({
    cells: [
      c.policyId,
      c.clientName,
      c.policyTypeLabel,
      c.insurerName,
      c.expiryDate,
      c.timing,
      c.risk ? SEVERITY_WORDS[c.risk] : '(no pack)',
      c.flags.length,
      c.topChange,
      c.statusLabel,
      c.source,
      c.version ?? '-',
    ],
    ...(c.risk ? { severityColumn: 6, severity: c.risk } : {}),
  }));
  if (truncated) overview.push({ cells: [`Only the first ${OVERVIEW_MAX_ROWS} of ${input.cases.length} cases are listed. Narrow the filters to see the rest.`] });

  const flags: ModelRow[] = [];
  for (const c of shown) {
    for (const flag of c.flags) {
      if (flag.severity !== 'medium' && flag.severity !== 'high') continue;
      flags.push({ cells: [c.policyId, c.clientName, SEVERITY_WORDS[flag.severity], describeField(flag.field), flag.message], severityColumn: 2, severity: flag.severity });
    }
  }
  if (flags.length === 0) flags.push({ cells: ['-', '-', '-', '-', 'No medium or high flags in the included cases.'] });

  const statuses = OVERVIEW_STATUSES.filter((s) => input.filters.statuses.includes(s)).map((s) => STATUS_WORDS[s] ?? s);
  const notes: ModelRow[] = [
    { cells: ['Status', 'Drafts only. Nothing has been sent.'] },
    { cells: ['Data', 'Synthetic data only (concept project).'] },
    { cells: ['Run date', input.runDate] },
    { cells: ['Statuses included', statuses.join(', ')] },
    { cells: ['Manual uploads included', input.filters.includeManual ? 'Yes' : 'No'] },
    { cells: ['Cases listed', truncated ? `${shown.length} of ${input.cases.length} (capped at ${OVERVIEW_MAX_ROWS})` : String(shown.length)] },
    { cells: ['How to read severity', 'High: check before anything else (premium up 25% or more, cover limit cut, exclusion added). Medium: worth a look (premium up 10% or more, excess up, insurer or dates changed, a fact that needs a human check). Low: small premium rise. Info: no action needed. Each severity is written as a word and coloured.'] },
    { cells: ['Weeks to renewal', 'Whole weeks rounded down from the run date; uploaded cases may be outside the usual 12-16 week window and say so (for example "in 5 days" or "expired 3 days ago").'] },
  ];
  return { overview: guard(overview), flags: guard(flags), notes: guard(notes), totalCases: input.cases.length, rowCount: shown.length, truncated };
}

/** Canonical text (for the content hash): every cell as a string, tab-separated rows. */
export function overviewModelText(model: OverviewModel): string {
  const sheet = (name: string, rows: ModelRow[]) => [`# ${name}`, ...rows.map((row) => row.cells.map(String).join('\t'))].join('\n');
  return [sheet(OVERVIEW_SHEETS.overview.name, model.overview), sheet(OVERVIEW_SHEETS.flags.name, model.flags), sheet(OVERVIEW_SHEETS.notes.name, model.notes)].join('\n');
}

function addSheet(workbook: ExcelJS.Workbook, layout: { name: string; headers: readonly string[]; widths: readonly number[] }, rows: ModelRow[]): void {
  const sheet = workbook.addWorksheet(layout.name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = layout.headers.map((header, i) => ({ header, width: layout.widths[i] ?? 20 }));
  const head = sheet.getRow(1);
  head.eachCell((cell) => {
    cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: INK } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: 'thin', color: { argb: HEADER_RULE } } };
    cell.alignment = { vertical: 'top', wrapText: true };
  });
  head.commit();
  rows.forEach((row, index) => {
    const excelRow = sheet.getRow(index + 2);
    row.cells.forEach((value, column) => {
      const cell = excelRow.getCell(column + 1);
      cell.value = value; // a plain string or number: never a formula
      cell.numFmt = typeof value === 'string' ? '@' : '0';
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.font = { name: FONT_NAME, size: FONT_SIZE, color: { argb: INK } };
      if (row.severity !== undefined && row.severityColumn === column) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEVERITY_FILLS[row.severity] } };
        cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: SEVERITY_INK[row.severity] } };
      }
    });
    excelRow.commit();
  });
  sheet.pageSetup = { ...sheet.pageSetup, ...PRINT_SETUP, margins: { ...PRINT_SETUP.margins }, printTitlesRow: PRINT_TITLE_ROWS };
}

export async function renderOverviewWorkbook(model: OverviewModel, runDate: IsoDate): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const runDateUtc = new Date(`${runDate}T00:00:00.000Z`); // from the input, not the clock
  workbook.created = runDateUtc;
  workbook.modified = runDateUtc;
  workbook.creator = WORKBOOK_PROPERTIES.creator;
  workbook.lastModifiedBy = WORKBOOK_PROPERTIES.lastModifiedBy;
  workbook.title = 'Renewals overview (draft)';
  addSheet(workbook, OVERVIEW_SHEETS.overview, model.overview);
  addSheet(workbook, OVERVIEW_SHEETS.flags, model.flags);
  addSheet(workbook, OVERVIEW_SHEETS.notes, model.notes);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
