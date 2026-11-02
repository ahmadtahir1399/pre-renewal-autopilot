// Shared helpers for the Prompt 7 upload tests (samples and a hand-built encrypted PDF).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ExtractedTerms } from '../src/domain/types.js';
import { SampleTruthSchema } from '../src/uploads/knownDocuments.js';

export const SAMPLES = path.join(process.cwd(), 'samples', 'uploads');
export const sample = (name: string) => new Uint8Array(readFileSync(path.join(SAMPLES, name)));
export const sampleTerms = (name: string): ExtractedTerms => SampleTruthSchema.parse(JSON.parse(readFileSync(path.join(SAMPLES, name), 'utf8'))).expectedTerms;

/** A minimal PDF with a Standard security handler: pdf.js asks for a password (verified: PasswordException). */
export function encryptedPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${'A'.repeat(64)}> /U <${'A'.repeat(64)}> /P -4 >>`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<00112233445566778899AABBCCDDEEFF> <00112233445566778899AABBCCDDEEFF>] >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
