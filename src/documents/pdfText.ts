// PDF -> text per page, in plain code (no AI, no OCR).
// Library: pdfjs-dist (Mozilla pdf.js), legacy build for Node. Alternatives: unpdf, pdf-parse.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DocumentMissingError, DocumentUnreadableError } from '../domain/errors.js';

export interface PdfPage {
  /** 1-based, matching the "[PAGE n]" labels sent to the LLM and Fact.sourcePage. */
  pageNumber: number;
  text: string;
}

export interface PdfText {
  pages: PdfPage[];
  pageCount: number;
  isLikelyScanned: boolean;
}

/** A page "has meaningful text" when it holds at least this many non-space characters. */
export const MIN_MEANINGFUL_CHARS = 20;

// In Node, pdf.js reads standard fonts with fs.readFile(base + fileName): a plain folder path
// ending in "/" (not a file:// URL). Windows fs accepts forward slashes.
export const STANDARD_FONTS_DIR = `${path
  .join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts')
  .split(path.sep)
  .join('/')}/`;

async function extractPages(data: Uint8Array): Promise<PdfPage[]> {
  const loadingTask = getDocument({ data, standardFontDataUrl: STANDARD_FONTS_DIR });
  try {
    const doc = await loadingTask.promise;
    const pages: PdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter((s) => s.trim() !== '')
        .join('\n');
      pages.push({ pageNumber, text });
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

export function hasMeaningfulText(page: PdfPage): boolean {
  return page.text.replace(/\s/g, '').length >= MIN_MEANINGFUL_CHARS;
}

/**
 * Read a PDF into per-page text.
 * @throws DocumentMissingError when the file does not exist.
 * @throws DocumentUnreadableError when it cannot be parsed or no page has meaningful text (likely a scan).
 */
export async function readPdfText(pdfPath: string, policyId = 'unknown', documentKind: 'expiring' | 'renewal' = 'expiring'): Promise<PdfText> {
  if (!existsSync(pdfPath)) throw new DocumentMissingError(policyId, documentKind);
  let pages: PdfPage[];
  try {
    pages = await extractPages(new Uint8Array(readFileSync(pdfPath)));
  } catch (error) {
    throw new DocumentUnreadableError(pdfPath, 'the PDF could not be parsed', { cause: error });
  }
  const isLikelyScanned = !pages.some(hasMeaningfulText);
  if (isLikelyScanned) {
    throw new DocumentUnreadableError(pdfPath, 'no page has a text layer (likely an image-only scan; OCR is out of scope)');
  }
  return { pages, pageCount: pages.length, isLikelyScanned };
}
