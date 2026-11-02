import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalJsonSource } from '../src/data/localJsonSource.js';
import { loadSeedState, processedCycleKeysFrom } from '../src/data/seedState.js';
import type { Policy } from '../src/domain/types.js';
import { groupByClient } from '../src/selection/groupByClient.js';
import { selectRenewals } from '../src/selection/renewalWindow.js';

const FIXTURES_DIR = path.join(process.cwd(), 'fixtures');
const TODAY = '2026-10-19';
// Reads only; dataDir is never written by these tests (no status updates).
const source = new LocalJsonSource({ fixturesDir: FIXTURES_DIR, dataDir: path.join(process.cwd(), 'data') });
const policies = await source.listPolicies();
const clientNameById = new Map<string, string>([
  ['cli-01', 'Ironbark Joinery Ltd'],
  ['cli-02', 'Saltwind Cafe Group Ltd'],
  ['cli-03', 'Bluegum Freight Services Ltd'],
  ['cli-04', 'Fernvale Veterinary Clinic Ltd'],
  ['cli-05', 'Quarry Lane Print Works Ltd'],
]);
const seeded = processedCycleKeysFrom(loadSeedState(FIXTURES_DIR));

function run(processed: ReadonlySet<string> = seeded, input: readonly Policy[] = policies) {
  return selectRenewals({ policies: input, today: TODAY, minDays: 84, maxDays: 112, processedCycleKeys: processed, clientNameById });
}

const ids = (list: { id: string }[]) => list.map((p) => p.id);

describe('selectRenewals on the fixtures', () => {
  it('selects exactly the 13 expected candidates', () => {
    expect(ids(run().candidates).sort()).toEqual(
      ['pol-s01', 'pol-s02', 'pol-s03', 'pol-s04', 'pol-s05', 'pol-s06', 'pol-s07', 'pol-s08', 'pol-s10', 'pol-s11', 'pol-s13', 'pol-s14', 'pol-s15'],
    );
  });

  it('excludes pol-s09 (140 days) as outside_window', () => {
    expect(run().skipped).toContainEqual({ policyId: 'pol-s09', reason: 'outside_window' });
  });

  it('includes both boundaries: pol-s10 (84 days) and pol-s11 (112 days)', () => {
    const selected = ids(run().candidates);
    expect(selected).toContain('pol-s10');
    expect(selected).toContain('pol-s11');
  });

  it('skips pol-s12 as already_processed only when its cycleKey is in the set', () => {
    expect(run().skipped).toContainEqual({ policyId: 'pol-s12', reason: 'already_processed' });
    const withEmptySet = run(new Set());
    expect(ids(withEmptySet.candidates)).toContain('pol-s12');
    expect(withEmptySet.skipped).toEqual([{ policyId: 'pol-s09', reason: 'outside_window' }]);
  });

  it('keeps pol-s07 (no renewal PDF) and pol-s08 (image-only PDF) as candidates', () => {
    const selected = ids(run().candidates);
    expect(selected).toContain('pol-s07');
    expect(selected).toContain('pol-s08');
  });

  it('sorts by days to expiry, then client name, then policy id', () => {
    expect(ids(run().candidates)).toEqual([
      'pol-s10', // 84
      'pol-s03', // 85
      'pol-s08', // 88
      'pol-s13', // 89
      'pol-s01', // 90
      'pol-s05', // 91
      'pol-s07', // 95
      'pol-s14', // 97
      'pol-s02', // 98
      'pol-s04', // 100
      'pol-s06', // 105
      'pol-s15', // 110
      'pol-s11', // 112
    ]);
  });

  it('breaks ties on client name, then policy id', () => {
    const base = policies.find((p) => p.id === 'pol-s01') as Policy;
    const tied: Policy[] = [
      { ...base, id: 'pol-x3', clientId: 'cli-01' }, // Ironbark
      { ...base, id: 'pol-x2', clientId: 'cli-03' }, // Bluegum
      { ...base, id: 'pol-x1', clientId: 'cli-01' }, // Ironbark
    ];
    expect(ids(run(new Set(), tied).candidates)).toEqual(['pol-x2', 'pol-x1', 'pol-x3']);
  });

  it('is stable across repeated calls and input order', () => {
    const first = ids(run().candidates);
    expect(ids(run().candidates)).toEqual(first);
    expect(ids(run(seeded, [...policies].reverse()).candidates)).toEqual(first);
    expect(run(seeded, [...policies].reverse()).skipped).toEqual(run().skipped);
  });

  it('does not mutate its input', () => {
    const input = [...policies];
    const before = ids(input);
    run(seeded, input);
    expect(ids(input)).toEqual(before);
  });
});

describe('groupByClient', () => {
  it('groups candidates by client in order of their most urgent policy', () => {
    const groups = groupByClient(run().candidates, clientNameById);
    expect(groups.map((g) => [g.clientId, ids(g.policies)])).toEqual([
      ['cli-04', ['pol-s10', 'pol-s11']],
      ['cli-01', ['pol-s03', 'pol-s01', 'pol-s02']],
      ['cli-03', ['pol-s08', 'pol-s07']],
      ['cli-05', ['pol-s13', 'pol-s14', 'pol-s15']],
      ['cli-02', ['pol-s05', 'pol-s04', 'pol-s06']],
    ]);
    expect(groups[0]?.clientName).toBe('Fernvale Veterinary Clinic Ltd');
    expect(groups.reduce((n, g) => n + g.policies.length, 0)).toBe(13);
  });

  it('returns no groups for no candidates', () => {
    expect(groupByClient([], clientNameById)).toEqual([]);
  });
});
