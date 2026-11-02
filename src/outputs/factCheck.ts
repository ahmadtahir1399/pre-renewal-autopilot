// Plain-code checks on draft emails before anyone sees them.
// assertEmailFactsMatch: every number and date in an email must come from the diffs, the policy
// record or the client record. Dates count as ONE token (2027-01-18, or "18 January 2027").

import type { Client, Policy, TermDiff } from '../domain/types.js';
import { MONTH_NAMES } from './labels.js';

const LONG_DATE = new RegExp(`\\b(\\d{1,2}) (${MONTH_NAMES.join('|')}) (\\d{4})\\b`, 'g');
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
/** A number not glued to letters (so "pol-s01" or "a1b" are not numbers). */
const NUMBER = /(?<![A-Za-z0-9_.])\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9_])/g;

function isoFromLong(day: string, monthName: string, year: string): string {
  const month = MONTH_NAMES.indexOf(monthName) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Numbers and dates in text, as canonical tokens: '12,400.00' -> '12400', '17 January 2027' -> '2027-01-17'. */
export function factTokens(text: string): string[] {
  const tokens: string[] = [];
  let rest = text.replace(LONG_DATE, (_m, day: string, month: string, year: string) => {
    tokens.push(isoFromLong(day, month, year));
    return ' ';
  });
  rest = rest.replace(ISO_DATE, (date) => {
    tokens.push(date);
    return ' ';
  });
  for (const match of rest.matchAll(NUMBER)) tokens.push(String(Number.parseFloat(match[0].replace(/,/g, ''))));
  return tokens;
}

function allowedTokens(diffs: readonly TermDiff[], policy: Policy, client: Client): Set<string> {
  const allowed = new Set<string>();
  const add = (value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'number') allowed.add(String(value));
    else for (const token of factTokens(String(value))) allowed.add(token);
  };
  for (const diff of diffs) {
    add(diff.facts);
    add(diff.expiring);
    add(diff.renewal);
  }
  add(policy.expiryDate);
  add(policy.annualPremium);
  add(policy.insurerName);
  add(client.name);
  add(client.contactName);
  add(client.contactEmail);
  return allowed;
}

export class EmailFactMismatchError extends Error {
  constructor(readonly unexpected: string[]) {
    super(`Draft email contains numbers or dates not found in the comparison or records: ${unexpected.join(', ')}`);
    this.name = 'EmailFactMismatchError';
  }
}

/** Throws EmailFactMismatchError listing every number/date in the email that has no source. */
export function assertEmailFactsMatch(email: { subject: string; body: string } | string, diffs: readonly TermDiff[], policy: Policy, client: Client): void {
  const text = typeof email === 'string' ? email : `${email.subject}\n${email.body}`;
  const allowed = allowedTokens(diffs, policy, client);
  const unexpected = [...new Set(factTokens(text).filter((token) => !allowed.has(token)))];
  if (unexpected.length > 0) throw new EmailFactMismatchError(unexpected);
}

/**
 * COARSE lint (not a guarantee): phrases that would sound like advice, a promise or a risk label
 * in a client email. A human still reviews every draft.
 */
export const BANNED_CLIENT_PHRASES = [
  'we recommend',
  'you should',
  'we advise',
  'our advice',
  'guarantee',
  'you will be covered',
  'fully covered',
  'no need to worry',
  "don't worry",
  'risk level',
  'high risk',
  'low risk',
  'best option',
  'best price',
] as const;

export function findBannedPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return BANNED_CLIENT_PHRASES.filter((phrase) => lower.includes(phrase));
}
