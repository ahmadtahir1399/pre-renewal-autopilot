// READ-ONLY DATA SOURCE except one write. After a full flow (run, approve, skip, open, retry-sync):
// only updateRenewalStatus mutated, only for the approval, only the overlay file changed, and the
// fixtures hash is unchanged.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApprovalCore } from '../../src/approval/actions.js';
import type { DataSource } from '../../src/data/datasource.js';
import { runPipeline } from '../../src/pipeline/runPipeline.js';
import { createDemo, FIXTURES, TODAY } from '../helpers.js';

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function treeHash(dir: string): string {
  const hash = createHash('sha256');
  for (const file of filesUnder(dir).sort()) hash.update(path.relative(dir, file)).update(readFileSync(file));
  return hash.digest('hex');
}

function recording(source: DataSource, calls: Array<{ method: string; args: unknown[] }>): DataSource {
  const wrap =
    <K extends keyof DataSource>(method: K) =>
    (...args: Parameters<DataSource[K]>) => {
      calls.push({ method, args });
      return (source[method] as (...a: Parameters<DataSource[K]>) => ReturnType<DataSource[K]>)(...args);
    };
  return {
    listPolicies: wrap('listPolicies'),
    getPolicy: wrap('getPolicy'),
    getClient: wrap('getClient'),
    getBroker: wrap('getBroker'),
    getDocumentPaths: wrap('getDocumentPaths'),
    updateRenewalStatus: wrap('updateRenewalStatus'),
  };
}

describe('the data source is read-only except updateRenewalStatus', () => {
  it('a full flow mutates only through updateRenewalStatus(…, approved), only the overlay changes, fixtures are untouched', async () => {
    const before = treeHash(FIXTURES);
    const demo = await createDemo({ runPipeline: false });
    try {
      const calls: Array<{ method: string; args: unknown[] }> = [];
      const dataSource = recording(demo.dataSource, calls);
      await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ dataSource }) });
      const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource, outputDir: demo.outputDir, allowedTelegramChatIds: [] });
      expect((await core.handleAction({ action: 'open', packId: demo.packFor('pol-s03').id, actor: 'broker:web', channel: 'web' })).kind).toBe('ok');
      expect((await core.handleAction({ action: 'approve', packId: demo.packFor('pol-s02').id, actor: 'broker:web', channel: 'web' })).kind).toBe('ok');
      expect((await core.handleAction({ action: 'skip', packId: demo.packFor('pol-s05').id, actor: 'broker:cli', channel: 'cli' })).kind).toBe('ok');
      await core.retrySync();

      const writes = calls.filter((c) => c.method === 'updateRenewalStatus');
      expect(writes.map((c) => c.args)).toEqual([['pol-s02', 'approved']]);
      const reads = new Set(['listPolicies', 'getPolicy', 'getClient', 'getBroker', 'getDocumentPaths']);
      expect(calls.filter((c) => !reads.has(c.method)).map((c) => c.method)).toEqual(['updateRenewalStatus']);
      expect(filesUnder(demo.dataDir).map((f) => path.relative(demo.dataDir, f).split(path.sep).join('/'))).toEqual(['runtime/status-overlay.json']);
      expect(JSON.parse(readFileSync(demo.overlayPath, 'utf8'))).toEqual({ version: 1, statuses: { 'pol-s02': 'approved' } });
    } finally {
      demo.cleanup();
    }
    expect(treeHash(FIXTURES)).toBe(before);
  });

  it('structure: updateRenewalStatus is called only from the approval core', () => {
    const callers: string[] = [];
    for (const file of filesUnder('src').filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (/\.updateRenewalStatus\(/.test(line)) callers.push(file.split(path.sep).join('/'));
      }
    }
    // Merge note (D-136): the Prompt 7 manual-case wrapper is itself a DataSource; its one call is the forward
    // inside its own updateRenewalStatus (manual ids are refused), so it adds no new caller.
    expect([...new Set(callers)]).toEqual(['src/approval/actions.ts', 'src/uploads/manualSource.ts']);
    const wrapper = readFileSync(path.join('src', 'uploads', 'manualSource.ts'), 'utf8');
    expect(wrapper.match(/\.updateRenewalStatus\(/g)).toHaveLength(1);
    expect(wrapper).toMatch(/async updateRenewalStatus\(policyId: string, status: RenewalStatus\): Promise<void> \{\s+if \(isManualPolicyId\(policyId\)\) throw new ManualPolicyWriteError\(\);\s+return this\.inner\.updateRenewalStatus\(policyId, status\);\s+\}/);
  });
});
