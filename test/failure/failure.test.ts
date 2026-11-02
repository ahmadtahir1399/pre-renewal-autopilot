// FAILURE INJECTION (the crash test). No network, no key. Each case asserts:
//   1. the affected policy ends in a SAFE state (needs_attention, or the notification fallback),
//   2. every other policy still completes,
//   3. an audit event records what happened,
//   4. no half-written pack (no pack row, no output folder) or half-written state remains.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { APIConnectionTimeoutError, RateLimitError } from 'openai';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, describe, expect, it } from 'vitest';
import { createApprovalCore } from '../../src/approval/actions.js';
import { createDispatcher } from '../../src/approval/dispatch.js';
import { FakeNotifier } from '../../src/approval/notifier.js';
import type { DataSource, DocumentPaths } from '../../src/data/datasource.js';
import { parseGroundTruth } from '../../src/domain/schemas.js';
import type { ExtractedTerms, GroundTruth } from '../../src/domain/types.js';
import { MemoryExtractionCache } from '../../src/documents/cache.js';
import type { LlmClient } from '../../src/llm/client.js';
import { FakeLlmClient } from '../../src/llm/fakeClient.js';
import { slugify } from '../../src/outputs/writePack.js';
import { createGroundTruthReader, createLlmReader, type TermsReader } from '../../src/pipeline/readers.js';
import { runPipeline } from '../../src/pipeline/runPipeline.js';
import { listAllAudit } from '../../src/state/audit.js';
import { all } from '../../src/state/db.js';
import { getActivePack, getCaseByCycleKey } from '../../src/state/repo.js';
import { createDemo, type Demo, FIXTURES, TODAY } from '../helpers.js';

const PACK_POLICIES = ['pol-s01', 'pol-s02', 'pol-s03', 'pol-s04', 'pol-s05', 'pol-s06', 'pol-s10', 'pol-s11', 'pol-s13', 'pol-s14', 'pol-s15'];

let demo: Demo | null = null;
afterEach(() => {
  demo?.cleanup();
  demo = null;
});

function truth(policyId: string): GroundTruth {
  return parseGroundTruth(JSON.parse(readFileSync(path.join(FIXTURES, 'ground-truth', `${policyId}.json`), 'utf8')));
}

function terms(policyId: string, side: 'expiring' | 'renewal'): ExtractedTerms {
  const value = truth(policyId).expectedTerms[side];
  if (!value) throw new Error(`no ${side} terms for ${policyId}`);
  return structuredClone(value);
}

function cycleKeyOf(policyId: string): string {
  return truth(policyId).cycleKey;
}

/** Route one policy to a special reader; everything else uses the answer keys. */
function routedReader(routes: Record<string, TermsReader>): TermsReader {
  const fallback = createGroundTruthReader(FIXTURES);
  return {
    modelName: fallback.modelName,
    isFake: true,
    read: (p, ctx) => (routes[ctx.policyId] ?? fallback).read(p, ctx),
    peek: (p, ctx) => (routes[ctx.policyId] ?? fallback).peek(p, ctx),
  };
}

function withDocuments(source: DataSource, overrides: Record<string, DocumentPaths>, hooks: { onPaths?: (policyId: string) => void } = {}): DataSource {
  return {
    listPolicies: () => source.listPolicies(),
    getPolicy: (id) => source.getPolicy(id),
    getClient: (id) => source.getClient(id),
    getBroker: (id) => source.getBroker(id),
    getDocumentPaths: async (id) => {
      hooks.onPaths?.(id);
      return overrides[id] ?? source.getDocumentPaths(id);
    },
    updateRenewalStatus: (id, status) => source.updateRenewalStatus(id, status),
  };
}

function outputFoldersFor(outputDir: string, policyId: string): string[] {
  if (!existsSync(outputDir)) return [];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === policyId) found.push(full);
      else walk(full);
    }
  };
  walk(outputDir);
  return found;
}

function auditTypes(d: Demo, policyId: string): string[] {
  return listAllAudit(d.db).filter((e) => e.policyId === policyId).map((e) => e.type);
}

/** Safe state for the failed policy + everyone else completed + audit + no half state. */
function assertSafe(d: Demo, failedPolicyId: string, options: { status?: string | undefined; auditType?: string } = {}): void {
  const caseRow = getCaseByCycleKey(d.db, cycleKeyOf(failedPolicyId));
  if (options.status === undefined && 'status' in options) expect(caseRow).toBeUndefined();
  else expect(caseRow?.status).toBe(options.status ?? 'needs_attention');
  if (caseRow) {
    expect(getActivePack(d.db, caseRow.id)).toBeUndefined();
    expect(all(d.db, 'SELECT id FROM packs WHERE case_id = ?', caseRow.id)).toHaveLength(0);
  }
  expect(outputFoldersFor(d.outputDir, failedPolicyId)).toEqual([]);
  expect(auditTypes(d, failedPolicyId)).toContain(options.auditType ?? 'needs_attention');
  for (const other of PACK_POLICIES.filter((p) => p !== failedPolicyId)) {
    const otherCase = getCaseByCycleKey(d.db, cycleKeyOf(other));
    expect(otherCase?.status, other).toBe('in_review');
    expect(otherCase && getActivePack(d.db, otherCase.id), other).toBeDefined();
  }
}

function llmReaderWith(llm: LlmClient): TermsReader {
  return createLlmReader(llm, new MemoryExtractionCache());
}

describe('LLM output problems', () => {
  it('invalid JSON on every attempt -> LlmOutputInvalidError after 2 retries -> needs_attention, others complete', async () => {
    demo = await createDemo({ runPipeline: false });
    const fake = new FakeLlmClient(['not json', '{"also": "not the schema"', 'still not json']);
    const summary = await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ reader: routedReader({ 'pol-s01': llmReaderWith(fake) }) }) });
    expect(fake.callCount).toBe(3);
    expect(summary.rows.find((r) => r.policyId === 'pol-s01')).toMatchObject({ outcome: 'needs_attention', note: 'the AI reader returned invalid output' });
    assertSafe(demo, 'pol-s01');
    const event = listAllAudit(demo.db).find((e) => e.policyId === 'pol-s01' && e.type === 'needs_attention');
    expect(event?.details.retriedNextRun).toBe(true);
  });

  it('invalid JSON twice, then valid -> succeeds on the third attempt (2 retries); invalid once then valid -> pack', async () => {
    for (const bad of [['not json', 'not json'], ['not json']]) {
      demo?.cleanup();
      demo = await createDemo({ runPipeline: false });
      const fake = new FakeLlmClient([...bad, terms('pol-s01', 'expiring'), terms('pol-s01', 'renewal')]);
      await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ reader: routedReader({ 'pol-s01': llmReaderWith(fake) }) }) });
      expect(fake.callCount).toBe(bad.length + 2);
      expect(demo.packFor('pol-s01').pack.diffs.map((d) => `${d.field}/${d.severity}`)).toEqual(truth('pol-s01').expectedDiffs?.map((d) => `${d.field}/${d.severity}`));
    }
  });

  it('a timeout and a rate-limit error -> needs_attention (retried next run), others complete; the next run recovers', async () => {
    for (const error of [new APIConnectionTimeoutError(), new RateLimitError(429, undefined, 'Rate limit reached for requests', new Headers())]) {
      demo?.cleanup();
      demo = await createDemo({ runPipeline: false });
      const throwing: LlmClient = { model: 'test-model', completeJson: async () => Promise.reject(error) };
      const summary = await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ reader: routedReader({ 'pol-s02': llmReaderWith(throwing) }) }) });
      expect(summary.rows.find((r) => r.policyId === 'pol-s02')?.outcome).toBe('needs_attention');
      assertSafe(demo, 'pol-s02');
      expect(listAllAudit(demo.db).find((e) => e.policyId === 'pol-s02' && e.type === 'needs_attention')?.details.retriedNextRun).toBe(true);
      // Transient: the input hash was not stored, so the next run tries again and succeeds.
      const again = await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps() });
      expect(again.rows.find((r) => r.policyId === 'pol-s02')?.outcome).toBe('new_pack');
      expect(getCaseByCycleKey(demo.db, cycleKeyOf('pol-s02'))?.status).toBe('in_review');
    }
  });
});

describe('document problems', () => {
  it('a corrupted PDF (random bytes named .pdf) gives a typed error before any LLM call, not a crash', async () => {
    demo = await createDemo({ runPipeline: false });
    const bad = path.join(demo.root, 'docs', 'pol-s03', 'renewal.pdf');
    mkdirSync(path.dirname(bad), { recursive: true });
    writeFileSync(bad, Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256)));
    const real = await demo.dataSource.getDocumentPaths('pol-s03');
    const fake = new FakeLlmClient([terms('pol-s03', 'expiring')]);
    const dataSource = withDocuments(demo.dataSource, { 'pol-s03': { ...real, renewal: bad } });
    const summary = await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ dataSource, reader: routedReader({ 'pol-s03': llmReaderWith(fake) }) }) });
    expect(fake.callCount).toBe(1); // the expiring read only; the damaged file never reaches the model
    expect(summary.rows.find((r) => r.policyId === 'pol-s03')).toMatchObject({ outcome: 'needs_attention', note: 'document could not be read (damaged file or not a PDF)' });
    assertSafe(demo, 'pol-s03');
  });

  it('a PDF with one empty page among text pages: no crash; an unsupported fact becomes low confidence + a needs-human-check flag, never a guess', async () => {
    demo = await createDemo({ runPipeline: false });
    const expiring = terms('pol-s05', 'expiring');
    const pdf = await PDFDocument.create({ updateMetadata: false });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page1 = pdf.addPage([595, 842]);
    const scheduleQuotes = (['insurerName', 'policyNumber', 'policyType', 'periodStart', 'periodEnd', 'annualPremium', 'coverLimit'] as const).map((f) => expiring[f].sourceQuote ?? '');
    scheduleQuotes.forEach((line, i) => {
      page1.drawText(line, { x: 40, y: 800 - i * 20, size: 10, font });
    });
    pdf.addPage([595, 842]); // page 2: deliberately EMPTY
    const page3 = pdf.addPage([595, 842]);
    page3.drawText('Section 4 - Exclusions', { x: 40, y: 800, size: 10, font });
    expiring.keyExclusions.forEach((e, i) => {
      page3.drawText(`4.${i + 1} ${e.title}`, { x: 40, y: 780 - i * 20, size: 10, font });
    });
    const file = path.join(demo.root, 'docs', 'pol-s05', 'expiring.pdf');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, await pdf.save());

    // The model claims the excess is on the EMPTY page 2, and gives no value for the cover limit.
    const claimed = structuredClone(expiring);
    claimed.excess = { ...claimed.excess, sourcePage: 2 };
    claimed.coverLimit = { value: null, sourcePage: null, sourceQuote: null, confidence: 'low' };
    claimed.keyExclusions = claimed.keyExclusions.map((e) => ({ ...e, sourcePage: 3 }));
    // Merge note (D-136): since D-120 an unconfirmed fact gets ONE repair reading; the model repeats the same
    // unsupported claim there, so the facts must still end up unconfirmed (never a guess).
    const fake = new FakeLlmClient([claimed, claimed, terms('pol-s05', 'renewal')]);
    const real = await demo.dataSource.getDocumentPaths('pol-s05');
    const dataSource = withDocuments(demo.dataSource, { 'pol-s05': { ...real, expiring: file } });
    await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps({ dataSource, reader: routedReader({ 'pol-s05': llmReaderWith(fake) }) }) });

    const pack = demo.packFor('pol-s05').pack;
    // No computed difference for either unsupported field (never a guess) ...
    expect(pack.diffs.find((d) => d.field === 'excess' || d.field === 'coverLimit')).toBeUndefined();
    // ... and a medium "needs human check" flag naming each one.
    expect(pack.flags.filter((f) => f.field === 'excess' || f.field === 'coverLimit').map((f) => `${f.field}/${f.severity}`).sort()).toEqual(['coverLimit/medium', 'excess/medium']);
    const extracted = listAllAudit(demo.db).find((e) => e.policyId === 'pol-s05' && e.type === 'terms_extracted' && e.details.kind === 'expiring');
    expect(Number(extracted?.details.warnings)).toBeGreaterThan(0);
    // Safe state here = a pack that a person must check (in_review with flags), everyone else complete.
    for (const other of PACK_POLICIES) expect(getCaseByCycleKey(demo.db, cycleKeyOf(other))?.status, other).toBe('in_review');
  });
});

describe('notifier failure', () => {
  it('every send fails -> notification_failed audited, pending-approvals fallback written, CLI approve still works', async () => {
    demo = await createDemo();
    const notifier = new FakeNotifier('telegram');
    notifier.failures = Number.POSITIVE_INFINITY;
    const d = demo;
    const dispatcher = createDispatcher({ db: d.db, clock: d.clock, dataSource: d.dataSource, notifiers: [notifier], outputDir: d.outputDir, today: () => TODAY, reminderAfterHours: 48, reminderIntervalHours: 24, sleep: async () => {} });
    const packIds = PACK_POLICIES.map((p) => d.packFor(p).id);
    await dispatcher.onPacksReady(
      PACK_POLICIES.map((policyId, i) => ({ packId: packIds[i] as number, caseId: d.packFor(policyId).caseId, policyId, cycleKey: cycleKeyOf(policyId), version: 1, supersededPackId: null })),
      [],
    );
    expect(notifier.records).toHaveLength(0);
    expect(notifier.attempts).toBe(PACK_POLICIES.length * 4); // 1 try + 3 retries each
    expect(listAllAudit(d.db).filter((e) => e.type === 'notification_failed')).toHaveLength(PACK_POLICIES.length);
    const outbox = path.join(d.outputDir, 'outbox', 'pending-approvals.md');
    expect(readFileSync(outbox, 'utf8')).toContain(`npm run approve -- ${d.packFor('pol-s02').id}`);
    const core = createApprovalCore({ db: d.db, clock: d.clock, dataSource: d.dataSource, outputDir: d.outputDir, allowedTelegramChatIds: [] });
    const result = await core.handleAction({ action: 'approve', packId: d.packFor('pol-s02').id, actor: 'broker:cli', channel: 'cli' });
    expect(result.kind).toBe('ok');
    expect(getCaseByCycleKey(d.db, cycleKeyOf('pol-s02'))?.status).toBe('approved');
  });
});

describe('SQLite busy / locked', () => {
  it('PROBE: what node:sqlite does under a real lock held by another connection (rollback journal)', async () => {
    demo = await createDemo({ runPipeline: false });
    const dbFile = path.join(demo.root, 'runtime', 'autopilot.db');
    const other = new DatabaseSync(dbFile);
    try {
      demo.db.exec('PRAGMA busy_timeout = 150');
      other.exec('BEGIN IMMEDIATE'); // RESERVED lock: others may read, nobody else may write
      expect(all(demo.db, 'SELECT COUNT(*) AS n FROM cases')).toHaveLength(1); // reads still work
      const started = Date.now();
      expect(() => demo?.db.exec("INSERT INTO runs (id, today, dry_run, status, started_at, created_at) VALUES ('x', '2026-10-19', 0, 'running', 'a', 'a')")).toThrow(/locked|busy/i);
      expect(Date.now() - started).toBeGreaterThanOrEqual(100); // it waited (busy_timeout) before giving up
      other.exec('ROLLBACK');
      other.exec('BEGIN EXCLUSIVE'); // EXCLUSIVE: even reads are refused
      expect(() => all(demo?.db as DatabaseSync, 'SELECT COUNT(*) AS n FROM cases')).toThrow(/locked|busy/i);
      other.exec('ROLLBACK');
    } finally {
      other.close();
    }
  });

  it('a lock during one policy\'s writes: that policy fails safely with no half state, the run continues, the audit is written late (or to stderr)', async () => {
    demo = await createDemo({ runPipeline: false });
    const d = demo;
    d.db.exec('PRAGMA busy_timeout = 100');
    const other = new DatabaseSync(path.join(d.root, 'runtime', 'autopilot.db'));
    let locked = false;
    const fallback = createGroundTruthReader(FIXTURES);
    const reader: TermsReader = {
      ...fallback,
      read: async (p, ctx) => {
        const result = await fallback.read(p, ctx);
        if (ctx.policyId === 'pol-s05' && ctx.kind === 'renewal') {
          other.exec('BEGIN IMMEDIATE'); // another process grabs the write lock mid-policy
          locked = true;
        }
        return result;
      },
    };
    const dataSource = withDocuments(d.dataSource, {}, {
      onPaths: (policyId) => {
        if (locked && policyId !== 'pol-s05') {
          other.exec('COMMIT'); // ... and lets go before the next policy starts
          locked = false;
        }
      },
    });
    const stderr: string[] = [];
    try {
      const summary = await runPipeline({ today: TODAY, dryRun: false, deps: d.pipelineDeps({ dataSource, reader, maxConcurrency: 1, stderr: (line) => stderr.push(line) }) });
      expect(summary.rows.find((r) => r.policyId === 'pol-s05')?.outcome).toBe('failed_not_saved');
      assertSafe(d, 'pol-s05', { status: undefined, auditType: 'policy_not_saved' });
      expect(stderr.some((line) => line.includes('pol-s05') && /locked|busy/i.test(line))).toBe(true);
      // Not stored as handled: the next run picks the policy up again.
      const again = await runPipeline({ today: TODAY, dryRun: false, deps: d.pipelineDeps() });
      expect(again.rows.find((r) => r.policyId === 'pol-s05')?.outcome).toBe('new_pack');
    } finally {
      if (locked) other.exec('ROLLBACK');
      other.close();
    }
  });
});

describe('save fails after the pack files were written', () => {
  it('the commit transaction fails -> rolled back, the unsaved version folder is removed, needs_attention, others complete', async () => {
    demo = await createDemo({ runPipeline: false });
    const summary = await runPipeline({
      today: TODAY,
      dryRun: false,
      deps: demo.pipelineDeps({
        beforeCommit: (policyId) => {
          if (policyId === 'pol-s10') throw new Error('database is locked');
        },
      }),
    });
    expect(summary.rows.find((r) => r.policyId === 'pol-s10')?.outcome).toBe('needs_attention');
    assertSafe(demo, 'pol-s10'); // includes: no output folder left for pol-s10
  });
});

describe('output folder cannot be written', () => {
  // Simulated with an unwritable PATH (a FILE sits where a folder must go). Read-only folder
  // attributes are NOT used: on Windows a read-only folder does not stop files being written in it.
  it('one policy\'s pack folder is blocked by a file -> that policy needs_attention, nothing half-written, others complete', async () => {
    demo = await createDemo({ runPipeline: false });
    const policy = await demo.dataSource.getPolicy('pol-s06');
    const client = policy ? await demo.dataSource.getClient(policy.clientId) : undefined;
    const blocker = path.join(demo.outputDir, TODAY, slugify(client?.name ?? '', 'client'), 'pol-s06');
    mkdirSync(path.dirname(blocker), { recursive: true });
    writeFileSync(blocker, 'not a folder');
    const summary = await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps() });
    expect(summary.rows.find((r) => r.policyId === 'pol-s06')?.outcome).toBe('needs_attention');
    assertSafe(demo, 'pol-s06');
    expect(readFileSync(blocker, 'utf8')).toBe('not a folder');
  });
});
