// Hand-built RFC 5322 .eml DRAFT files (decision D-054). This module only builds text:
// there is no transport, SMTP, sendmail or network code anywhere in this project.
// Deterministic: the Date header comes from the run date at a fixed time of day, and the
// Message-ID is derived from the content hash.

import { createHash } from 'node:crypto';
import { clamp, cleanText } from '../domain/text.js';
import type { IsoDate } from '../domain/types.js';

export interface EmailAddress {
  name: string;
  email: string;
}

export interface EmailDraft {
  from: EmailAddress;
  to: EmailAddress;
  subject: string;
  /** Plain text body with LF line endings. */
  body: string;
  runDate: IsoDate;
}

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Drafts are dated 07:00 local time (the scheduled run time) on the run date. */
export const DRAFT_TIME = '07:00:00';

/**
 * HEADER INJECTION GUARD (D-055): carriage returns, line feeds and other control characters
 * are replaced by spaces, so a name or subject can never start a new header line.
 */
export function sanitizeHeaderText(value: string): string {
  // FIX (D-130): also removes C1 controls and bidi overrides, and clamps to 200 characters so no
  // header line can pass RFC 5322's 998-character limit (a 10,000-character name did; attack-surface matrix).
  // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately removes control characters from header values
  const spaced = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ');
  return clamp(cleanText(spaced).replace(/\s+/g, ' ').trim(), 200);
}

function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/** RFC 2047 encoded words (UTF-8, base64), split on code points so no character is cut in half. */
export function encodeHeaderText(value: string): string {
  const clean = sanitizeHeaderText(value);
  if (isPrintableAscii(clean)) return clean;
  const words: string[] = [];
  let chunk = '';
  for (const char of clean) {
    if (Buffer.byteLength(chunk + char, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk !== '') words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join(' ');
}

export function formatAddress(address: EmailAddress): string {
  const email = address.email.trim();
  if (!EMAIL_PATTERN.test(email)) throw new Error(`Invalid email address for a draft header: "${sanitizeHeaderText(email)}"`);
  const name = sanitizeHeaderText(address.name);
  if (name === '') return `<${email}>`;
  if (isPrintableAscii(name)) return `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>`;
  return `${encodeHeaderText(name)} <${email}>`;
}

function lastSundayOf(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month, 0)); // month is 1-based here: day 0 of next month
  return last.getUTCDate() - last.getUTCDay();
}

function firstSundayOf(year: number, month: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7);
}

/**
 * New Zealand UTC offset at 07:00 local on a date (hand-coded rule, no Intl):
 * NZDT (+1300) from the last Sunday in September until the first Sunday in April, else NZST (+1200).
 * VERIFY if the NZ daylight-saving rule changes.
 */
export function nzUtcOffset(date: IsoDate): '+1300' | '+1200' {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  const startsDst = month > 9 || (month === 9 && day >= lastSundayOf(year, 9));
  const beforeDstEnds = month < 4 || (month === 4 && day < firstSundayOf(year, 4));
  return startsDst || beforeDstEnds ? '+1300' : '+1200';
}

/** RFC 5322 date, e.g. 'Mon, 19 Oct 2026 07:00:00 +1300'. Built from the run date only. */
export function rfc5322Date(runDate: IsoDate): string {
  const [year = 0, month = 1, day = 1] = runDate.split('-').map(Number);
  const weekday = DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year} ${DRAFT_TIME} ${nzUtcOffset(runDate)}`;
}

/** FIX (D-130): words longer than this are split, so no body line can pass RFC 5322's 998-character limit. */
const MAX_WORD = 76;

function splitLongWords(line: string): string {
  return line
    .split(' ')
    .map((word) => (Array.from(word).length > MAX_WORD ? (word.match(/.{1,76}/gu) ?? [word]).join(' ') : word))
    .join(' ');
}

/** Word-wrap a plain-text body at 76 characters. Control characters and bidi overrides are removed. */
export function wrapBody(body: string, width = 76): string {
  return cleanText(body)
    .split('\n')
    .map(splitLongWords)
    .map((line) => {
      if (line.length <= width) return line;
      const indent = /^(\s*-\s+|\s*)/.exec(line)?.[0] ?? '';
      const words = line.slice(indent.length).split(' ');
      const out: string[] = [];
      let current = indent;
      for (const word of words) {
        if (current.trim() !== '' && (current + word).length > width) {
          out.push(current.trimEnd());
          current = ' '.repeat(indent.length);
        }
        current += `${word} `;
      }
      out.push(current.trimEnd());
      return out.join('\n');
    })
    .join('\n');
}

function foldHeader(name: string, value: string): string {
  const line = `${name}: ${value}`;
  if (line.length <= 78) return line;
  const parts = value.split(' ');
  const lines: string[] = [];
  let current = `${name}:`;
  for (const part of parts) {
    if (`${current} ${part}`.length > 78 && current.trim() !== `${name}:`) {
      lines.push(current);
      current = '';
    }
    current += ` ${part}`;
  }
  lines.push(current);
  return lines.join('\r\n');
}

function headerLines(draft: EmailDraft, messageId: string | null): Array<[string, string]> {
  const headers: Array<[string, string]> = [
    ['From', formatAddress(draft.from)],
    ['To', formatAddress(draft.to)],
    ['Subject', encodeHeaderText(draft.subject)],
    ['Date', rfc5322Date(draft.runDate)],
  ];
  if (messageId) headers.push(['Message-ID', messageId]);
  headers.push(
    ['MIME-Version', '1.0'],
    ['Content-Type', 'text/plain; charset=UTF-8'],
    ['Content-Transfer-Encoding', '8bit'],
    // Asks mail apps to open the file as an unsent draft. Some apps ignore it: VERIFY in yours.
    ['X-Unsent', '1'],
  );
  return headers;
}

/** Canonical text (LF line endings, no Message-ID) used for hashing and the content hash. */
export function emlCanonicalText(draft: EmailDraft): string {
  const headers = headerLines(draft, null).map(([name, value]) => `${name}: ${value}`);
  return `${headers.join('\n')}\n\n${wrapBody(draft.body)}\n`;
}

export function messageIdFor(draft: EmailDraft): string {
  const hash = createHash('sha256').update(emlCanonicalText(draft)).digest('hex');
  return `<${hash.slice(0, 32)}@pre-renewal-autopilot.example>`;
}

/** The .eml file content with CRLF line endings (RFC 5322). */
export function renderEml(draft: EmailDraft): string {
  const headers = headerLines(draft, messageIdFor(draft)).map(([name, value]) => foldHeader(name, value));
  const body = wrapBody(draft.body).split('\n').join('\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
}
