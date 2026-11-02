import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../src/domain/errors.js';
import {
  EXCLUSION_KEYS,
  parseClient,
  parseExtractedTerms,
  parseFlag,
  parsePack,
  parsePolicy,
  parseTermDiff,
} from '../src/domain/schemas.js';
import type { ExtractedTerms, Policy } from '../src/domain/types.js';

const goodPolicy: Policy = {
  id: 'pol-s01',
  clientId: 'cli-01',
  brokerId: 'brk-01',
  insurerName: 'Example Insurer Ltd',
  type: 'commercial_property',
  expiryDate: '2027-01-17',
  annualPremium: 12400,
  status: 'not_started',
  expiringDocPath: 'fixtures/documents/pol-s01/expiring.pdf',
};

function fact<T>(value: T, page = 1) {
  return { value, sourcePage: page, sourceQuote: `quote for ${String(value)}`, confidence: 'high' as const };
}

const goodTerms: ExtractedTerms = {
  insurerName: fact('Example Insurer Ltd'),
  policyNumber: fact('EX-CP-100001'),
  policyType: fact('commercial_property'),
  periodStart: fact('2026-01-18'),
  periodEnd: fact('2027-01-17'),
  annualPremium: fact(12400),
  excess: fact(2500),
  coverLimit: fact(4_000_000),
  keyExclusions: [{ key: 'flood', title: 'Flood', summary: 'Flood damage is not covered.', sourcePage: 4 }],
};

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainValidationError) return error.problems;
    throw error;
  }
  throw new Error('expected a DomainValidationError');
}

describe('exclusion keys', () => {
  it('is one fixed list of 14 keys ending with other', () => {
    expect(EXCLUSION_KEYS).toHaveLength(14);
    expect(EXCLUSION_KEYS.at(-1)).toBe('other');
    expect(new Set(EXCLUSION_KEYS).size).toBe(14);
  });
});

describe('Policy schema', () => {
  it('accepts a good policy', () => {
    expect(parsePolicy(goodPolicy)).toEqual(goodPolicy);
  });

  it('lists every problem with its field path', () => {
    const problems = problemsOf(() =>
      parsePolicy({ ...goodPolicy, type: 'marine', expiryDate: '2027-02-30', annualPremium: -5 }),
    );
    expect(problems).toHaveLength(3);
    expect(problems.some((p) => p.startsWith('policy.type:'))).toBe(true);
    expect(problems.some((p) => p.startsWith('policy.expiryDate:'))).toBe(true);
    expect(problems.some((p) => p.startsWith('policy.annualPremium:'))).toBe(true);
  });

  it('rejects an unknown status and a missing id', () => {
    const { id: _omit, ...withoutId } = goodPolicy;
    expect(problemsOf(() => parsePolicy(withoutId)).some((p) => p.startsWith('policy.id:'))).toBe(true);
    expect(() => parsePolicy({ ...goodPolicy, status: 'sent' })).toThrow(DomainValidationError);
  });
});

describe('Client schema', () => {
  it('requires example.com email addresses (synthetic data only)', () => {
    const client = { id: 'cli-01', name: 'A Ltd', contactName: 'A Person', contactEmail: 'a.person@example.com' };
    expect(parseClient(client)).toEqual(client);
    expect(() => parseClient({ ...client, contactEmail: 'a.person@example.org' })).toThrow(DomainValidationError);
    expect(() => parseClient({ ...client, contactEmail: 'not an email' })).toThrow(DomainValidationError);
  });
});

describe('ExtractedTerms and Fact rules', () => {
  it('accepts good terms', () => {
    expect(parseExtractedTerms(goodTerms)).toEqual(goodTerms);
  });

  it('accepts a missing fact when flagged low confidence', () => {
    const missing = { value: null, sourcePage: null, sourceQuote: null, confidence: 'low' };
    expect(() => parseExtractedTerms({ ...goodTerms, excess: missing })).not.toThrow();
  });

  it('rejects a found value without a source page', () => {
    const problems = problemsOf(() =>
      parseExtractedTerms({ ...goodTerms, annualPremium: { ...fact(12400), sourcePage: null } }),
    );
    expect(problems.some((p) => p.includes('annualPremium.sourcePage'))).toBe(true);
  });

  it('rejects a missing value that claims high confidence (no guessing)', () => {
    const problems = problemsOf(() =>
      parseExtractedTerms({
        ...goodTerms,
        excess: { value: null, sourcePage: null, sourceQuote: null, confidence: 'high' },
      }),
    );
    expect(problems.some((p) => p.includes('excess.confidence'))).toBe(true);
  });

  it('rejects an exclusion key outside the vocabulary', () => {
    const bad = { ...goodTerms, keyExclusions: [{ key: 'volcano', title: 'X', summary: 'Y', sourcePage: 4 }] };
    expect(() => parseExtractedTerms(bad)).toThrow(DomainValidationError);
  });

  it('rejects a money value given as a string', () => {
    expect(() => parseExtractedTerms({ ...goodTerms, annualPremium: fact('12,400') })).toThrow(DomainValidationError);
  });
});

describe('TermDiff, Flag and Pack', () => {
  const diff = {
    field: 'annualPremium',
    expiring: 12400,
    renewal: 13144,
    change: 'increased',
    severity: 'low',
    facts: 'Annual premium increased by 6.0%.',
    expiringPage: 1,
    renewalPage: 1,
  };

  it('accepts a good diff and flag', () => {
    expect(parseTermDiff(diff)).toEqual(diff);
    expect(parseFlag({ field: 'coverLimit', severity: 'high', message: 'Limit decreased' })).toBeTruthy();
  });

  it('rejects an unknown change kind or severity', () => {
    expect(() => parseTermDiff({ ...diff, change: 'went up' })).toThrow(DomainValidationError);
    expect(() => parseFlag({ field: 'x', severity: 'critical', message: 'm' })).toThrow(DomainValidationError);
  });

  it('validates pack hash and timestamp', () => {
    const pack = {
      cycleKey: 'pol-s01:2027-01-17',
      version: 1,
      policyId: 'pol-s01',
      diffs: [diff],
      flags: [],
      xlsxPath: 'output/pol-s01/v1/comparison.xlsx',
      clientEmlPath: 'output/pol-s01/v1/client.eml',
      insurerEmlPath: 'output/pol-s01/v1/insurer.eml',
      summaryText: 'Premium up 6.0%.',
      contentHash: 'a'.repeat(64),
      createdAt: '2026-10-19T18:00:00.000Z',
    };
    expect(parsePack(pack).version).toBe(1);
    expect(() => parsePack({ ...pack, contentHash: 'abc' })).toThrow(DomainValidationError);
    expect(() => parsePack({ ...pack, version: 0 })).toThrow(DomainValidationError);
    expect(() => parsePack({ ...pack, createdAt: '2026-10-19' })).toThrow(DomainValidationError);
  });
});
