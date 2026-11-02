import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalJsonSource } from '../src/data/localJsonSource.js';
import { NotionSource } from '../src/data/notionSource.js';
import { loadSeedState, processedCycleKeysFrom } from '../src/data/seedState.js';
import { DataSourceError } from '../src/domain/errors.js';

const FIXTURES_DIR = path.join(process.cwd(), 'fixtures');

/** Relative path -> sha256 for every file under dir (empty object if dir is missing). */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out[path.relative(dir, full).split(path.sep).join('/')] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

let dataDir: string;
let source: LocalJsonSource;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'pra-data-'));
  source = new LocalJsonSource({ fixturesDir: FIXTURES_DIR, dataDir });
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('LocalJsonSource reads', () => {
  it('lists the 15 fixture policies', async () => {
    const policies = await source.listPolicies();
    expect(policies.map((p) => p.id)).toEqual(Array.from({ length: 15 }, (_, i) => `pol-s${String(i + 1).padStart(2, '0')}`));
  });

  it('gets policies, clients and brokers by id (undefined when unknown)', async () => {
    expect((await source.getPolicy('pol-s01'))?.expiryDate).toBe('2027-01-17');
    expect(await source.getPolicy('pol-s99')).toBeUndefined();
    expect((await source.getClient('cli-01'))?.name).toBe('Ironbark Joinery Ltd');
    expect((await source.getBroker('brk-02'))?.email).toBe('sam.takerei@example.com');
    expect(await source.getClient('nope')).toBeUndefined();
  });

  it('returns document paths only for files that exist', async () => {
    const s01 = await source.getDocumentPaths('pol-s01');
    expect(s01.expiring).toBe(path.join(FIXTURES_DIR, 'documents', 'pol-s01', 'expiring.pdf'));
    expect(s01.renewal).toBe(path.join(FIXTURES_DIR, 'documents', 'pol-s01', 'renewal.pdf'));
    const s07 = await source.getDocumentPaths('pol-s07');
    expect(s07.expiring).toBeDefined();
    expect(s07.renewal).toBeUndefined();
    expect('renewal' in s07).toBe(false);
    expect(await source.getDocumentPaths('pol-s99')).toEqual({});
  });

  it('rejects path tricks in a policy id', async () => {
    await expect(source.getDocumentPaths('../data')).rejects.toBeInstanceOf(DataSourceError);
  });

  it('reading never writes anything (data dir and fixtures unchanged)', async () => {
    const fixturesBefore = snapshot(FIXTURES_DIR);
    await source.listPolicies();
    await source.getPolicy('pol-s03');
    await source.getClient('cli-02');
    await source.getBroker('brk-01');
    await source.getDocumentPaths('pol-s05');
    expect(readdirSync(dataDir)).toEqual([]);
    expect(snapshot(FIXTURES_DIR)).toEqual(fixturesBefore);
  });
});

describe('LocalJsonSource.updateRenewalStatus (the only write)', () => {
  it('changes only the overlay file and leaves fixtures untouched', async () => {
    const fixturesBefore = snapshot(FIXTURES_DIR);
    await source.updateRenewalStatus('pol-s01', 'in_review');
    expect(Object.keys(snapshot(dataDir))).toEqual(['runtime/status-overlay.json']);
    expect(snapshot(FIXTURES_DIR)).toEqual(fixturesBefore);
    expect(JSON.parse(readFileSync(source.overlayPath, 'utf8'))).toEqual({
      version: 1,
      statuses: { 'pol-s01': 'in_review' },
    });
  });

  it('is visible through BOTH getPolicy and listPolicies', async () => {
    await source.updateRenewalStatus('pol-s07', 'needs_attention');
    expect((await source.getPolicy('pol-s07'))?.status).toBe('needs_attention');
    const listed = await source.listPolicies();
    expect(listed.find((p) => p.id === 'pol-s07')?.status).toBe('needs_attention');
    expect(listed.find((p) => p.id === 'pol-s01')?.status).toBe('not_started');
    // A second source on the same data dir sees the same overlay.
    const again = new LocalJsonSource({ fixturesDir: FIXTURES_DIR, dataDir });
    expect((await again.getPolicy('pol-s07'))?.status).toBe('needs_attention');
  });

  it('keeps earlier changes when another policy is updated', async () => {
    await source.updateRenewalStatus('pol-s01', 'in_review');
    await source.updateRenewalStatus('pol-s02', 'approved');
    await source.updateRenewalStatus('pol-s01', 'approved');
    expect(JSON.parse(readFileSync(source.overlayPath, 'utf8')).statuses).toEqual({
      'pol-s01': 'approved',
      'pol-s02': 'approved',
    });
  });

  it('rejects unknown policies and invalid statuses without writing', async () => {
    await expect(source.updateRenewalStatus('pol-s99', 'approved')).rejects.toBeInstanceOf(DataSourceError);
    // @ts-expect-error - deliberately invalid status
    await expect(source.updateRenewalStatus('pol-s01', 'sent')).rejects.toThrow();
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it('refuses a data dir inside the fixtures directory', () => {
    expect(() => new LocalJsonSource({ fixturesDir: FIXTURES_DIR, dataDir: path.join(FIXTURES_DIR, 'data') })).toThrow(
      DataSourceError,
    );
  });
});

describe('seed state', () => {
  it('holds the processed cycle for pol-s12', () => {
    const keys = processedCycleKeysFrom(loadSeedState(FIXTURES_DIR));
    expect([...keys]).toEqual(['pol-s12:2027-01-19']);
  });
});

describe('NotionSource stub', () => {
  it('throws not implemented', async () => {
    await expect(new NotionSource().listPolicies()).rejects.toThrow('not implemented');
  });
});
