// NO SEND CAPABILITY. Scans our code (src/, scripts/, package.json) and the PRODUCTION dependency tree
// for email-sending APIs. Comments are stripped first (src/outputs/eml.ts says in a comment that there
// is no SMTP). Prompt 3 chose NO mail library: .eml files are hand-built (D-054), nodemailer was
// rejected because its package ships SMTP and sendmail transports.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Sending APIs and services searched for. */
const SEND_PATTERNS: Array<[string, RegExp]> = [
  ['createTransport', /createTransport\s*\(/],
  ['sendMail', /\bsendMail\b/i],
  ['smtp', /\bsmtps?\b/i],
  ['sendmail binary', /\bsendmail\b/i],
  ['nodemailer', /nodemailer/i],
  ['emailjs', /\bemailjs\b/i],
  ['mailgun', /mailgun/i],
  ['sendgrid', /sendgrid/i],
  ['postmark', /postmark/i],
  ['mailjet', /mailjet/i],
  ['sparkpost', /sparkpost/i],
  ['mandrill', /mandrill/i],
  ['Amazon SES', /client-ses|SESClient|SendEmailCommand|aws-sdk/],
  ['Microsoft Graph sendMail', /graph\.microsoft\.com|\/sendMail/i],
  ['Gmail API send', /gmail\/v1\/users\/[^/]+\/messages\/send|users\.messages\.send/i],
  ['raw outbound socket', /\bnet\.connect\s*\(|\btls\.connect\s*\(|\bcreateConnection\s*\(|new\s+(net\.)?Socket\s*\(/],
  ['SMTP commands', /\b(MAIL FROM|RCPT TO|EHLO|HELO)\b/],
];

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, extensions));
    else if (extensions.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

function hits(files: readonly string[], strip: boolean): string[] {
  const found: string[] = [];
  for (const file of files) {
    if (statSync(file).size > 5_000_000) continue;
    const text = strip ? stripComments(readFileSync(file, 'utf8')) : readFileSync(file, 'utf8');
    for (const [name, pattern] of SEND_PATTERNS) if (pattern.test(text)) found.push(`${file}: ${name}`);
  }
  return found;
}

describe('no email-sending capability', () => {
  it('our code (src/, scripts/) contains no sending API', () => {
    expect(hits([...filesUnder('src', ['.ts']), ...filesUnder('scripts', ['.ts'])], true)).toEqual([]);
  });

  it('package.json declares no mail library', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, Record<string, string> | undefined>;
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies });
    expect(names.filter((n) => SEND_PATTERNS.some(([, p]) => p.test(n)))).toEqual([]);
  });

  it('no PRODUCTION dependency (package-lock, non-dev) bundles a sending transport', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, { dev?: boolean; optional?: boolean }> };
    const production = Object.entries(lock.packages)
      .filter(([key, meta]) => key.startsWith('node_modules/') && meta.dev !== true)
      .map(([key]) => key);
    expect(production.length).toBeGreaterThan(10);
    const names = production.map((key) => key.replace(/^.*node_modules\//, ''));
    expect(names.filter((n) => /nodemailer|smtp|sendmail|mailgun|sendgrid|postmark|mailjet|sparkpost|client-ses/i.test(n))).toEqual([]);
    const found = production.flatMap((key) => hits(filesUnder(key, ['.js', '.mjs', '.cjs']), false));
    // Only the narrow, unambiguous transport APIs are checked inside third-party code.
    expect(found.filter((h) => /createTransport|sendMail|nodemailer|SMTP commands/.test(h))).toEqual([]);
    // Reads every production dependency file: about 2 s alone, much slower while the full suite runs in parallel.
  }, 120_000);
});
