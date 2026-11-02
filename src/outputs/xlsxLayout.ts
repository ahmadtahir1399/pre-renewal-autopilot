// The comparison workbook layout, shared by scripts/makeTemplate.ts and buildXlsx.ts.

import type { Severity } from '../domain/types.js';

export interface SheetLayout {
  name: string;
  headers: string[];
  widths: number[];
}

export const SHEETS = {
  summary: { name: 'Summary', headers: ['Item', 'Value'], widths: [28, 100] },
  comparison: {
    name: 'Comparison',
    headers: ['Field', 'Expiring', 'Renewal', 'Change', 'Severity', 'Source pages', 'Details'],
    widths: [34, 22, 22, 12, 11, 20, 90],
  },
  flags: { name: 'Flags', headers: ['Severity', 'Field', 'What to check'], widths: [11, 34, 100] },
  sources: {
    name: 'Sources',
    headers: ['Field', 'Side', 'Value', 'Page', 'Quote from the document', 'Confidence'],
    widths: [30, 10, 30, 7, 70, 12],
  },
} as const satisfies Record<string, SheetLayout>;

export const SHEET_ORDER = [SHEETS.summary, SHEETS.comparison, SHEETS.flags, SHEETS.sources] as const;

/**
 * ARGB fills; the severity WORD is always written too, so print in black and white still works.
 * Prompt 6: same colour roles as the approval page (src/approval/web/tokens.ts, light theme):
 * fill = severity tint, text = severity ink (both pairs pass 4.5:1, see npm run check:contrast).
 */
export const SEVERITY_FILLS: Record<Severity, string> = {
  high: 'FFFBE7E4',
  medium: 'FFFBEFD6',
  low: 'FFE4EDF8',
  info: 'FFECEFF1',
};

export const SEVERITY_INK: Record<Severity, string> = {
  high: 'FF8E1D17',
  medium: 'FF6E4600',
  low: 'FF1C4A80',
  info: 'FF3F4B56',
};

/** Header row: sunken surface + body ink, with a 3:1 rule underneath (page tokens surfaceSunken / text / borderStrong). */
export const HEADER_FILL = 'FFEBEFF1';
export const HEADER_RULE = 'FF7D8A95';
export const INK = 'FF16202A';
export const FONT_NAME = 'Arial';
export const FONT_SIZE = 10;

/** Print: A4 landscape, one page wide, any number of pages tall, header row repeated on every page. */
export const PRINT_SETUP = {
  paperSize: 9,
  orientation: 'landscape',
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 0,
  margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
} as const;
export const PRINT_TITLE_ROWS = '1:1';

/** Fixed workbook properties (no live timestamps). */
export const WORKBOOK_PROPERTIES = {
  creator: 'Pre-Renewal Autopilot',
  lastModifiedBy: 'Pre-Renewal Autopilot',
  title: 'Renewal comparison (draft)',
  /** Template-only date; filled workbooks use the run date instead. */
  templateDate: new Date(Date.UTC(2026, 0, 1)),
};
