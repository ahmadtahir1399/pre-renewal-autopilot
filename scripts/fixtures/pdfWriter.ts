// Renders a BuiltDocument to PDF bytes with pdf-lib.
// Deterministic: no creation/modification dates (updateMetadata: false), fixed
// Info strings, standard fonts only (nothing embedded from the system).

import { type PDFFont, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { GLYPH_HEIGHT, GLYPH_WIDTH, GrayCanvas } from './bitmapFont.js';
import { SYNTHETIC_NOTICE } from './catalog.js';
import type { Block, BuiltDocument } from './documentModel.js';
import { encodeGrayscalePng } from './png.js';

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const FOOTER_Y = 36;
const BOTTOM_LIMIT = 70;

const STYLE: Record<Exclude<Block['kind'], 'spacer'>, { size: number; bold: boolean; after: number }> = {
  title: { size: 16, bold: true, after: 6 },
  subtitle: { size: 11, bold: false, after: 4 },
  heading: { size: 11, bold: true, after: 3 },
  line: { size: 10, bold: false, after: 2 },
  paragraph: { size: 10, bold: false, after: 6 },
};
const SPACER_HEIGHT = 10;

async function createDeterministicPdf(doc: BuiltDocument): Promise<PDFDocument> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(`Synthetic ${doc.kind} document ${doc.policyId}`);
  pdf.setAuthor('Pre-Renewal Autopilot fixture generator');
  pdf.setCreator('Pre-Renewal Autopilot fixture generator');
  pdf.setProducer('pdf-lib');
  return pdf;
}

/** Greedy word wrap using the font's real glyph widths. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current !== '') lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

function footerText(doc: BuiltDocument, pageIndex: number, pageCount: number): string {
  return `${SYNTHETIC_NOTICE} | ${doc.footerLabel} | Page ${pageIndex + 1} of ${pageCount}`;
}

/** Normal PDF with a real text layer. */
export async function renderTextPdf(doc: BuiltDocument): Promise<Uint8Array> {
  const pdf = await createDeterministicPdf(doc);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0, 0, 0);
  const grey = rgb(0.35, 0.35, 0.35);

  doc.pages.forEach((pageContent, pageIndex) => {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;
    for (const block of pageContent.blocks) {
      if (block.kind === 'spacer') {
        y -= SPACER_HEIGHT;
        continue;
      }
      const style = STYLE[block.kind];
      const font = style.bold ? bold : regular;
      const lineHeight = style.size * 1.35;
      const lines =
        block.kind === 'line' ? [block.text] : wrapText(block.text, font, style.size, CONTENT_WIDTH);
      if (block.kind === 'line' && font.widthOfTextAtSize(block.text, style.size) > CONTENT_WIDTH) {
        throw new Error(`Schedule line too wide for the page: "${block.text}"`);
      }
      for (const line of lines) {
        y -= lineHeight;
        if (y < BOTTOM_LIMIT) throw new Error(`Page ${pageIndex + 1} of ${doc.policyId} ${doc.kind} overflows`);
        page.drawText(line, { x: MARGIN, y, size: style.size, font, color: black });
      }
      y -= style.after;
    }
    page.drawText(footerText(doc, pageIndex, doc.pages.length), {
      x: MARGIN,
      y: FOOTER_Y,
      size: 7,
      font: regular,
      color: grey,
    });
  });

  return pdf.save();
}

// ---------------------------------------------------------------------------
// Image-only PDF (S08): every page is one picture of text; there is NO text layer.
// ---------------------------------------------------------------------------

const IMAGE_SCALE = 2; // image pixels per PDF point
const IMAGE_WIDTH = Math.round(PAGE_WIDTH * IMAGE_SCALE);
const IMAGE_HEIGHT = Math.round(PAGE_HEIGHT * IMAGE_SCALE);
const IMAGE_MARGIN = 100;

function wrapByChars(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current !== '') lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

function renderPageImage(blocks: Block[], footer: string): Buffer {
  const canvas = new GrayCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  let y = IMAGE_MARGIN;
  for (const block of blocks) {
    if (block.kind === 'spacer') {
      y += 16;
      continue;
    }
    const scale = block.kind === 'title' ? 3 : 2;
    const advance = (GLYPH_WIDTH + 1) * scale;
    const maxChars = Math.floor((IMAGE_WIDTH - 2 * IMAGE_MARGIN) / advance);
    for (const line of wrapByChars(block.text.toUpperCase(), maxChars)) {
      if (y + GLYPH_HEIGHT * scale > IMAGE_HEIGHT - IMAGE_MARGIN) throw new Error('Image page overflows');
      canvas.drawText(line, IMAGE_MARGIN, y, scale);
      y += (GLYPH_HEIGHT + 4) * scale;
    }
    y += block.kind === 'paragraph' ? 10 : 4;
  }
  // Footer in small print, wrapped to two lines if needed.
  const footerLines = wrapByChars(footer.toUpperCase(), Math.floor((IMAGE_WIDTH - 2 * IMAGE_MARGIN) / 6));
  footerLines.forEach((line, index) => {
    canvas.drawText(line, IMAGE_MARGIN, IMAGE_HEIGHT - 80 + index * 12, 1);
  });
  return encodeGrayscalePng(IMAGE_WIDTH, IMAGE_HEIGHT, canvas.pixels);
}

export async function renderImageOnlyPdf(doc: BuiltDocument): Promise<Uint8Array> {
  const pdf = await createDeterministicPdf(doc);
  for (let pageIndex = 0; pageIndex < doc.pages.length; pageIndex++) {
    const blocks = doc.pages[pageIndex]?.blocks ?? [];
    const png = await pdf.embedPng(renderPageImage(blocks, footerText(doc, pageIndex, doc.pages.length)));
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(png, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
  }
  return pdf.save();
}
