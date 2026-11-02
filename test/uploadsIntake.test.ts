// Prompt 7 Stage U2: the upload door (intake), the identity rules U-2, the U-3 wording and the run gate.
// No database, no network, no key.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renewalTimingLine } from '../src/approval/cards.js';
import type { ReadPolicyTermsResult } from '../src/documents/index.js';
import type { ExtractedTerms, Policy } from '../src/domain/types.js';
import { acquireRunGate, acquireRunGateWaiting, RunGateBusyError } from '../src/state/runGate.js';
import { UploadRejectedError } from '../src/uploads/errors.js';
import { checkIdentity } from '../src/uploads/identity.js';
import {
  hasPdfMagic,
  newStorageId,
  removeStoredFile,
  resolveStoredPath,
  sanitiseDisplayName,
  storedPathFor,
  storeValidatedPdf,
  type UploadLimits,
  validatePdfUpload,
} from '../src/uploads/intake.js';
import { loadKnownDocuments } from '../src/uploads/knownDocuments.js';
import { encryptedPdf, SAMPLES, sample, sampleTerms } from './uploadHelpers.js';

const LIMITS: UploadLimits = { maxBytes: 10 * 1024 * 1024, maxPages: 30, parseTimeoutMs: 20_000 };

async function blankPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

async function rejection(bytes: Uint8Array, limits: UploadLimits = LIMITS, side: 'expiring' | 'renewal' = 'renewal'): Promise<string> {
  try {
    await validatePdfUpload({ side, bytes, clientFilename: 'whatever.pdf' }, limits);
    return 'accepted';
  } catch (error) {
    if (error instanceof UploadRejectedError) return `${error.code}:${error.side}`;
    throw error;
  }
}

describe('validation matrix (the bytes decide; names and declared types are hints only)', () => {
  it('a text file with a .pdf name is not a PDF', async () => {
    expect(await rejection(sample('not-a-pdf.pdf'))).toBe('not_a_pdf:renewal');
    expect(await rejection(new Uint8Array())).toBe('not_a_pdf:renewal');
  });

  it('a real PDF with the wrong extension is accepted (the extension is ignored)', async () => {
    const result = await validatePdfUpload({ side: 'expiring', bytes: sample('harbourview-expiring.pdf'), clientFilename: 'schedule.docx' }, LIMITS);
    expect(result).toMatchObject({ side: 'expiring', pageCount: 4, displayName: 'schedule.docx' });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('oversize, too many pages, encrypted, corrupted, empty and image-only are refused with their own code', async () => {
    const pdf = sample('harbourview-expiring.pdf');
    expect(await rejection(pdf, { ...LIMITS, maxBytes: pdf.length - 1 })).toBe('too_large:renewal');
    expect(await rejection(pdf, { ...LIMITS, maxPages: 3 })).toBe('too_many_pages:renewal');
    expect(await rejection(encryptedPdf())).toBe('encrypted:renewal');
    expect(await rejection(new TextEncoder().encode('%PDF-1.7\nthis is not really a pdf\n'))).toBe('corrupted:renewal');
    expect(await rejection(pdf.slice(0, 600))).toBe('corrupted:renewal');
    expect(await rejection(await blankPdf(2))).toBe('empty_or_scanned:renewal');
    expect(await rejection(sample('scanned-expiring.pdf'), LIMITS, 'expiring')).toBe('empty_or_scanned:expiring');
  });

  it('the size check comes before any parsing (a huge non-PDF is too_large, not not_a_pdf)', async () => {
    expect(await rejection(new Uint8Array(2048), { ...LIMITS, maxBytes: 1024 })).toBe('too_large:renewal');
  });

  it('magic bytes must be at the very start', () => {
    expect(hasPdfMagic(new TextEncoder().encode('%PDF-1.4'))).toBe(true);
    expect(hasPdfMagic(new TextEncoder().encode(' %PDF-1.4'))).toBe(false);
    expect(hasPdfMagic(new TextEncoder().encode('%PDF'))).toBe(false);
  });
});

describe('client filenames are display text only, never a path', () => {
  let runtime: string;
  beforeEach(() => {
    runtime = mkdtempSync(path.join(tmpdir(), 'pra-intake-'));
  });
  afterEach(() => rmSync(runtime, { recursive: true, force: true }));

  it('display names drop paths, control, bidi and line-break characters and are capped at 100', () => {
    expect(sanitiseDisplayName('..\\..\\x.pdf', 'renewal')).toBe('x.pdf');
    expect(sanitiseDisplayName('../../etc/passwd', 'renewal')).toBe('passwd');
    expect(sanitiseDisplayName('CON.pdf', 'renewal')).toBe('CON.pdf');
    expect(sanitiseDisplayName('a\r\nb\u202Ec\u0007.pdf', 'expiring')).toBe('abc.pdf');
    expect(sanitiseDisplayName('..', 'expiring')).toBe('expiring.pdf');
    expect(sanitiseDisplayName(undefined, 'renewal')).toBe('renewal.pdf');
    expect(Array.from(sanitiseDisplayName(`${'n'.repeat(400)}.pdf`, 'renewal'))).toHaveLength(100);
  });

  it('stored files live at uploads/<32 random hex>/<side>.pdf whatever the client called them', async () => {
    for (const clientFilename of ['..\\..\\x.pdf', 'CON.pdf', '/etc/passwd', 'a\r\nb.pdf']) {
      const pdf = await validatePdfUpload({ side: 'renewal', bytes: sample('pol-s07-renewal.pdf'), clientFilename }, LIMITS);
      const id = newStorageId();
      const stored = storeValidatedPdf(runtime, id, pdf);
      expect(stored.storedPath).toBe(`uploads/${id}/renewal.pdf`);
      expect(stored.absolutePath).toBe(path.join(runtime, 'uploads', id, 'renewal.pdf'));
      expect(readFileSync(stored.absolutePath)).toEqual(Buffer.from(pdf.bytes));
      expect(existsSync(path.join(runtime, 'x.pdf'))).toBe(false);
      expect(existsSync(path.join(runtime, '..', 'x.pdf'))).toBe(false);
      removeStoredFile(runtime, stored.storedPath);
      expect(existsSync(stored.absolutePath)).toBe(false);
      expect(existsSync(path.dirname(stored.absolutePath))).toBe(false);
    }
  });

  it('storage ids are 32 hex characters and do not repeat', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newStorageId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('only exact uploads/<id>/<side>.pdf paths resolve; anything else is refused', () => {
    expect(() => storedPathFor('../x', 'renewal')).toThrow();
    expect(() => storedPathFor('a'.repeat(32), 'other' as 'renewal')).toThrow();
    for (const bad of ['uploads/../x.pdf', '../uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/renewal.pdf', 'uploads/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/renewal.pdf', 'C:/x.pdf', 'uploads\\a\\renewal.pdf']) {
      expect(() => resolveStoredPath(runtime, bad)).toThrow();
    }
  });
});

function result(terms: ExtractedTerms, warnings: ReadPolicyTermsResult['warnings'] = []): ReadPolicyTermsResult {
  return { terms, warnings, usage: { inputTokens: 0, outputTokens: 0 }, fromCache: false };
}

describe('U-2 identity checks (fail closed)', () => {
  const expiring = () => sampleTerms('harbourview-expiring.truth.json');
  const renewal = () => sampleTerms('harbourview-renewal.truth.json');

  it('a consistent pair passes', () => {
    expect(checkIdentity({ expiring: result(expiring()), renewal: result(renewal()) })).toBeNull();
  });

  it('a null policy number, a low-confidence insurer or an unverified expiry are identity_unreadable', () => {
    const noNumber = expiring();
    noNumber.policyNumber = { value: null, sourcePage: null, sourceQuote: null, confidence: 'low' };
    expect(checkIdentity({ expiring: result(noNumber), renewal: result(renewal()) })).toBe('identity_unreadable');
    const lowInsurer = expiring();
    lowInsurer.insurerName = { ...lowInsurer.insurerName, confidence: 'low' };
    expect(checkIdentity({ expiring: result(lowInsurer), renewal: result(renewal()) })).toBe('identity_unreadable');
    const warned = result(expiring(), [{ code: 'quote_not_found', field: 'periodEnd', sourcePage: 1, message: 'periodEnd: quote not found' }]);
    expect(checkIdentity({ expiring: warned, renewal: result(renewal()) })).toBe('identity_unreadable');
  });

  it('an out-of-scope type (no in-scope type read) is type_not_supported; disagreeing types are type_disagreement', () => {
    const marine = expiring();
    marine.policyType = { value: null, sourcePage: null, sourceQuote: null, confidence: 'low' };
    expect(checkIdentity({ expiring: result(marine), renewal: result(renewal()) })).toBe('type_not_supported');
    const otherType = renewal();
    otherType.policyType = { ...otherType.policyType, value: 'commercial_property' };
    expect(checkIdentity({ expiring: result(expiring()), renewal: result(otherType) })).toBe('type_disagreement');
  });

  it('attach mode: type, insurer or expiry that differ from the policy record are document_mismatch', () => {
    const e = expiring();
    const record: Policy = {
      id: 'pol-x',
      clientId: 'cli-01',
      brokerId: 'brk-01',
      insurerName: e.insurerName.value as string,
      type: 'public_liability',
      expiryDate: e.periodEnd.value as string,
      annualPremium: 1,
      status: 'not_started',
    };
    expect(checkIdentity({ expiring: result(e), renewal: result(renewal()), policy: record })).toBeNull();
    expect(checkIdentity({ expiring: result(e), renewal: result(renewal()), policy: { ...record, type: 'commercial_property' } })).toBe('document_mismatch');
    expect(checkIdentity({ expiring: result(e), renewal: result(renewal()), policy: { ...record, insurerName: 'Another Insurer Ltd' } })).toBe('document_mismatch');
    expect(checkIdentity({ expiring: result(e), renewal: result(renewal()), policy: { ...record, expiryDate: '2030-01-01' } })).toBe('document_mismatch');
  });

  it('a renewal for a different policy number is document_mismatch', () => {
    const other = renewal();
    other.policyNumber = { ...other.policyNumber, value: 'XYZ-999' };
    expect(checkIdentity({ expiring: result(expiring()), renewal: result(other) })).toBe('document_mismatch');
  });
});

describe('U-3 card wording for uploaded cases', () => {
  it('future, under a week, today and past', () => {
    expect(renewalTimingLine('2026-10-19', '2026-12-03')).toBe('Renews in 6 weeks (2026-12-03)');
    expect(renewalTimingLine('2026-10-19', '2026-10-26')).toBe('Renews in 1 week (2026-10-26)');
    expect(renewalTimingLine('2026-10-19', '2026-10-20')).toBe('Renews in 1 day (2026-10-20)');
    expect(renewalTimingLine('2026-10-19', '2026-10-24')).toBe('Renews in 5 days (2026-10-24)');
    expect(renewalTimingLine('2026-10-19', '2026-10-19')).toBe('Renews today (2026-10-19)');
    expect(renewalTimingLine('2026-10-19', '2026-10-18')).toBe('Expired 1 day ago (2026-10-18)');
    expect(renewalTimingLine('2026-10-19', '2026-10-09')).toBe('Expired 10 days ago (2026-10-09)');
  });
});

describe('the known-document registry (fake mode only)', () => {
  it('knows the 28 readable fixture documents and the 5 sample documents with answer keys, and returns copies', () => {
    const registry = loadKnownDocuments({ fixturesDir: path.join(process.cwd(), 'fixtures'), samplesDir: SAMPLES });
    expect(registry.size).toBe(28 + 5);
    const sha = (name: string) => validatePdfUpload({ side: 'renewal', bytes: sample(name) }, LIMITS).then((v) => v.sha256);
    return Promise.all([sha('harbourview-renewal.pdf'), sha('pol-s07-renewal.pdf')]).then(([a, b]) => {
      expect(registry.has(a)).toBe(true);
      expect(registry.has(b)).toBe(true);
      const copy = registry.get(a) as ExtractedTerms;
      copy.coverLimit.value = 1;
      expect(registry.get(a)?.coverLimit.value).toBe(1_000_000);
    });
  });
});

describe('run gate: one run or analysis at a time, also inside one process', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pra-gate-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('a second holder in the same process is refused; after release it works again', () => {
    const lockPath = path.join(dir, 'run.lock');
    const first = acquireRunGate(lockPath);
    expect(() => acquireRunGate(lockPath)).toThrow(RunGateBusyError);
    first.release();
    acquireRunGate(lockPath).release();
  });

  it('a scheduled run waits for an analysis to finish, and gives up after its limit', async () => {
    const lockPath = path.join(dir, 'run.lock');
    const held = acquireRunGate(lockPath);
    let sleeps = 0;
    const waiting = acquireRunGateWaiting(lockPath, {
      maxWaitMs: 10_000,
      pollMs: 1000,
      sleep: async () => {
        sleeps++;
        if (sleeps === 3) held.release();
      },
    });
    const lock = await waiting;
    expect(lock).not.toBeNull();
    expect(sleeps).toBe(3);
    lock?.release();
    const again = acquireRunGate(lockPath);
    expect(await acquireRunGateWaiting(lockPath, { maxWaitMs: 2000, pollMs: 1000, sleep: async () => {} })).toBeNull();
    again.release();
  });
});
