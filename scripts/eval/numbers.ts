// Number checking for public prose: every number in a document must be traceable to the evaluation
// JSON, to fixtures/README.md, or to a short, justified allowlist of design constants. Pure functions.

import { formatRatio } from './score.js';

/** Design constants allowed in prose, each with its justification. */
export const ALLOWLIST: ReadonlyArray<[string, string]> = [
  ['84', 'window start in days (WINDOW_MIN_DAYS default, locked rule)'],
  ['112', 'window end in days (WINDOW_MAX_DAYS default, locked rule)'],
  ['10', 'premium increase percent for a MEDIUM flag (PREMIUM_MEDIUM_PCT, locked rule D-B)'],
  ['25', 'premium increase percent for a HIGH flag (PREMIUM_HIGH_PCT, locked rule D-B)'],
  ['15', 'number of synthetic scenarios'],
  ['11', 'scenarios that make a pack (D-D)'],
  ['14', 'scenario S14 / pol-s14, the prompt-injection case'],
  ['13', 'policies selected on the reference date (fixtures README)'],
  ['12', 'weeks before expiry where the window starts (84 days)'],
  ['16', 'weeks before expiry where the window ends (112 days)'],
  ['7', 'number of non-negotiable rules and of daily steps'],
  ['8', 'schedule fields measured per document (insurerName ... coverLimit)'],
  ['30', 'documents in the fixture set (15 policies x 2)'],
  ['28', 'documents measured (30 minus the missing and the image-only one)'],
  ['2026-10-19', 'fixed reference date of the fixtures'],
  ['8787', 'default approval page port (APPROVAL_WEB_PORT)'],
  ['127.0.0.1', 'loopback address the approval page binds to'],
  ['60', 'demo length lower bound in seconds'],
  ['90', 'demo length upper bound in seconds'],
  ['4096', 'Telegram message text limit (grammY types)'],
  ['998', 'RFC 5322 line length limit'],
];

const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const IP = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
// A number not glued to letters, hyphens or dots (excludes pol-s01, v1.0.0, gpt-5.4-nano, D-130, r1).
const NUMBER = /(?<![\w.\-/#])\d[\d,]*(?:\.\d+)?(?![\w\-/])/g;

/** Prose numbers: dates and IPs as whole tokens, other numbers with commas removed. Code, list markers and URLs are skipped. */
export function extractNumbers(markdown: string): string[] {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`[^`]*`/g, ' ') // inline code
    .replace(/\]\([^)]*\)/g, ']') // link targets
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*\d+\.\s/gm, ' ') // ordered list markers
    .replace(/^#+.*$/gm, (h) => h.replace(/^#+\s*\d+(\.\d+)*\s/, '')); // numbered headings
  const out: string[] = [];
  const withoutDates = text.replace(DATE, (d) => {
    out.push(d);
    return ' ';
  });
  const withoutIps = withoutDates.replace(IP, (ip) => {
    out.push(ip);
    return ' ';
  });
  // Ranges such as "60-90" or "3227-6168" are two numbers (identifiers like pol-s01 or D-130 have a letter before the hyphen).
  const withoutRanges = withoutIps.replace(/(?<![\w.])(\d[\d,.]*)-(?=\d)/g, '$1 ');
  for (const match of withoutRanges.matchAll(NUMBER)) out.push(match[0].replace(/,/g, '').replace(/\.$/, ''));
  return out;
}

/** Every number, numeric string and formatted ratio found in a JSON value. */
export function knownFromJson(value: unknown, into: Set<string> = new Set(), numbers: number[] = []): { known: Set<string>; numbers: number[] } {
  if (typeof value === 'number') {
    into.add(String(value));
    numbers.push(value);
  } else if (typeof value === 'string') {
    for (const n of extractNumbers(value)) into.add(n);
  } else if (Array.isArray(value)) {
    for (const item of value) knownFromJson(item, into, numbers);
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.hit === 'number' && typeof obj.total === 'number') {
      const pct = /\(([\d.]+)%\)/.exec(formatRatio({ hit: obj.hit, total: obj.total }))?.[1];
      if (pct) into.add(pct);
    }
    for (const item of Object.values(obj)) knownFromJson(item, into, numbers);
  }
  return { known: into, numbers };
}

/** A prose number matches a JSON number if it equals it after rounding the JSON number to the same decimals. */
export function matchesRounded(token: string, numbers: readonly number[]): boolean {
  if (!/^\d+(\.\d+)?$/.test(token)) return false;
  const decimals = token.split('.')[1]?.length ?? 0;
  if (decimals === 0) return false; // whole numbers must match exactly (already checked via the set)
  const target = Number(token);
  return numbers.some((n) => Number(n.toFixed(decimals)) === target);
}

export interface Unmatched {
  file: string;
  number: string;
}

export function unmatchedNumbers(files: ReadonlyArray<{ file: string; text: string }>, known: Set<string>, jsonNumbers: readonly number[]): Unmatched[] {
  const allow = new Set(ALLOWLIST.map(([n]) => n));
  const out: Unmatched[] = [];
  for (const { file, text } of files) {
    for (const number of extractNumbers(text)) {
      if (allow.has(number) || known.has(number) || matchesRounded(number, jsonNumbers)) continue;
      out.push({ file, number });
    }
  }
  return out;
}
