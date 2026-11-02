// The supervisor: plain code (no AI) checks every highlighted fact against the page.
// A fact that cannot be checked keeps its value but drops to confidence 'low' and gets a
// typed warning, so Prompt 3 turns it into a "needs human check" flag (D-B).

import { isValidIsoDate } from '../domain/dates.js';
import { EXCLUSION_KEYS } from '../domain/schemas.js';
import type { ExclusionKey, ExtractedTerms, Fact, IsoDate } from '../domain/types.js';
import type { PdfPage } from './pdfText.js';

export const EXTRACTION_WARNING_CODES = [
  'quote_not_found',
  'quote_missing',
  'value_not_on_page',
  'date_unparseable',
  'date_mismatch',
  'page_out_of_range',
  'invalid_exclusion_key',
  // Prompt 7 enhancement (D-119): plain-code checks ACROSS facts (src/documents/consistency.ts).
  'period_inconsistent',
  'amount_implausible',
] as const;
export type ExtractionWarningCode = (typeof EXTRACTION_WARNING_CODES)[number];

/** Typed warning: a field name and a code, plus a short human message (never document text). */
export interface ExtractionWarning {
  code: ExtractionWarningCode;
  field: string;
  sourcePage: number | null;
  message: string;
}

export interface VerifyResult {
  terms: ExtractedTerms;
  warnings: ExtractionWarning[];
}

type FactField = Exclude<keyof ExtractedTerms, 'keyExclusions'>;
const FACT_FIELDS: FactField[] = [
  'insurerName',
  'policyNumber',
  'policyType',
  'periodStart',
  'periodEnd',
  'annualPremium',
  'excess',
  'coverLimit',
];
const MONEY_FIELDS: ReadonlySet<FactField> = new Set(['annualPremium', 'excess', 'coverLimit']);
const DATE_FIELDS: ReadonlySet<FactField> = new Set(['periodStart', 'periodEnd']);

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Lowercase and collapse whitespace (the quote-matching rule). */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Remove commas, spaces and currency symbols so "NZD 12,400.00" becomes "NZD12400.00". */
function compactNumberText(text: string): string {
  return text.replace(/[\s,$€£]/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when the number appears as a whole number token (12400 matches "12400.00", not "112400"). */
export function containsNumber(text: string, value: number): boolean {
  const compact = compactNumberText(text);
  const [whole, fraction = ''] = String(value).split('.');
  const trimmedFraction = fraction.replace(/0+$/, '');
  const fractionPattern = trimmedFraction === '' ? '(?:\\.0+)?' : `\\.${escapeRegExp(trimmedFraction)}0*`;
  return new RegExp(`(?<![\\d.])${escapeRegExp(whole ?? '')}${fractionPattern}(?![\\d])`).test(compact);
}

/**
 * Parse a date written the way the fixture documents print it ("17 January 2027",
 * formatLongDate from Prompt 1) or as ISO yyyy-mm-dd. Returns null if none is found.
 */
export function parseDocumentDate(text: string): IsoDate | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso && isValidIsoDate(iso[0])) return iso[0];
  const long = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})\\b`, 'i').exec(text);
  if (!long) return null;
  const month = MONTHS.indexOf((long[2] ?? '').toLowerCase()) + 1;
  const candidate = `${long[3]}-${String(month).padStart(2, '0')}-${String(long[1]).padStart(2, '0')}`;
  return isValidIsoDate(candidate) ? candidate : null;
}

function lowered<T>(fact: Fact<T>): Fact<T> {
  return { ...fact, confidence: 'low' };
}

function checkFact(
  field: FactField,
  fact: Fact<unknown>,
  pages: readonly PdfPage[],
): ExtractionWarning[] {
  if (fact.value === null) return []; // already null + low: nothing to verify
  const warn = (code: ExtractionWarningCode, message: string): ExtractionWarning => ({
    code,
    field,
    sourcePage: fact.sourcePage,
    message,
  });
  const page = pages.find((p) => p.pageNumber === fact.sourcePage);
  if (!page) {
    return [warn('page_out_of_range', `${field}: sourcePage ${fact.sourcePage ?? 'null'} is not a page of this document (1-${pages.length})`)];
  }
  const warnings: ExtractionWarning[] = [];
  const quote = fact.sourceQuote?.trim() ?? '';
  if (quote === '') {
    warnings.push(warn('quote_missing', `${field}: no source quote was given`));
  } else if (!normalizeForMatch(page.text).includes(normalizeForMatch(quote))) {
    warnings.push(warn('quote_not_found', `${field}: the quote was not found on page ${page.pageNumber}`));
  }
  if (MONEY_FIELDS.has(field) && typeof fact.value === 'number') {
    if (!containsNumber(quote, fact.value) && !containsNumber(page.text, fact.value)) {
      warnings.push(warn('value_not_on_page', `${field}: value ${fact.value} does not appear in the quote or on page ${page.pageNumber}`));
    }
  }
  if (DATE_FIELDS.has(field) && typeof fact.value === 'string') {
    const parsed = parseDocumentDate(quote);
    if (parsed === null) {
      warnings.push(warn('date_unparseable', `${field}: no date could be read from the quote`));
    } else if (parsed !== fact.value) {
      warnings.push(warn('date_mismatch', `${field}: the quote says ${parsed} but the value is ${fact.value}`));
    }
  }
  return warnings;
}

/** Verify every fact and exclusion against the page text. Returns a NEW terms object; input is not mutated. */
export function verifyQuotes(terms: ExtractedTerms, pages: readonly PdfPage[]): VerifyResult {
  const warnings: ExtractionWarning[] = [];
  const verified: ExtractedTerms = { ...terms, keyExclusions: [...terms.keyExclusions] };

  for (const field of FACT_FIELDS) {
    const factWarnings = checkFact(field, terms[field], pages);
    if (factWarnings.length > 0) {
      warnings.push(...factWarnings);
      // Each field keeps its own Fact type; only confidence changes.
      (verified as unknown as Record<FactField, Fact<unknown>>)[field] = lowered(terms[field] as Fact<unknown>);
    }
  }

  terms.keyExclusions.forEach((exclusion, index) => {
    const field = `keyExclusions[${index}]`;
    if (!(EXCLUSION_KEYS as readonly string[]).includes(exclusion.key as ExclusionKey)) {
      warnings.push({ code: 'invalid_exclusion_key', field, sourcePage: exclusion.sourcePage, message: `${field}: "${exclusion.key}" is not in the fixed exclusion list` });
    }
    if (!pages.some((p) => p.pageNumber === exclusion.sourcePage)) {
      warnings.push({ code: 'page_out_of_range', field, sourcePage: exclusion.sourcePage, message: `${field}: sourcePage ${exclusion.sourcePage} is not a page of this document (1-${pages.length})` });
    }
  });

  return { terms: verified, warnings };
}
