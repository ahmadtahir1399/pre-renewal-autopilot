// npm run template:make
// Creates templates/comparison.xlsx once: four sheets with styled, frozen header rows and widths.
// Fixed workbook properties (no live timestamps).

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  FONT_NAME,
  FONT_SIZE,
  HEADER_FILL,
  HEADER_RULE,
  INK,
  PRINT_SETUP,
  PRINT_TITLE_ROWS,
  SHEET_ORDER,
  WORKBOOK_PROPERTIES,
} from '../src/outputs/xlsxLayout.js';

const target = path.join('templates', 'comparison.xlsx');

const workbook = new ExcelJS.Workbook();
workbook.creator = WORKBOOK_PROPERTIES.creator;
workbook.lastModifiedBy = WORKBOOK_PROPERTIES.lastModifiedBy;
workbook.title = WORKBOOK_PROPERTIES.title;
workbook.created = WORKBOOK_PROPERTIES.templateDate;
workbook.modified = WORKBOOK_PROPERTIES.templateDate;

for (const layout of SHEET_ORDER) {
  const sheet = workbook.addWorksheet(layout.name, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
    pageSetup: { ...PRINT_SETUP, margins: { ...PRINT_SETUP.margins }, printTitlesRow: PRINT_TITLE_ROWS },
  });
  sheet.columns = layout.headers.map((header, index) => ({ header, width: layout.widths[index] ?? 15 }));
  const headerRow = sheet.getRow(1);
  headerRow.height = 20;
  headerRow.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: INK } };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: 'thin', color: { argb: HEADER_RULE } } };
  });
}

mkdirSync(path.dirname(target), { recursive: true });
await workbook.xlsx.writeFile(target);
process.stdout.write(`Template written: ${target} (sheets: ${SHEET_ORDER.map((s) => s.name).join(', ')})\n`);
