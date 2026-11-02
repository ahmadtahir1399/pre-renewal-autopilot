// Plain-code PDF text reader used ONLY by verifyFixtures (no AI involved).
// Uses Mozilla pdf.js (pdfjs-dist, legacy build for Node). Prompt 2 may reuse or
// replace this when it builds src/documents/pdfText.ts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PageText {
  pageNumber: number;
  text: string;
}

// In Node, pdf.js reads fonts with fs.readFile(base + fileName), so this is a plain folder path,
// not a file:// URL. pdf.js insists on a trailing "/", and Windows fs accepts forward slashes.
const STANDARD_FONTS_DIR = `${path
  .join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts')
  .split(path.sep)
  .join('/')}/`;

/** Text of every page, items joined with single spaces. */
export async function readPdfPages(filePath: string): Promise<PageText[]> {
  const data = new Uint8Array(readFileSync(filePath));
  const loadingTask = getDocument({ data, standardFontDataUrl: STANDARD_FONTS_DIR });
  try {
    const doc = await loadingTask.promise;
    const pages: PageText[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter((s) => s.trim() !== '')
        .join(' ');
      pages.push({ pageNumber, text });
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

/** Lowercase and collapse whitespace, for quote matching. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
