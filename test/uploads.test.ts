// Prompt 7 Stage U2: analyseUpload end to end on the 15-fixture demo (fake readers only; no network, no key).

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApprovalCore, MANUAL_CASE_SYNC_NOTE } from '../src/approval/actions.js';
import { buildPackCard } from '../src/approval/cards.js';
import { createDispatcher } from '../src/approval/dispatch.js';
import { FakeNotifier } from '../src/approval/notifier.js';
import { analysisDepsFor } from '../src/cli/context.js';
import { compareTerms } from '../src/compare/compareTerms.js';
import { parseEnv } from '../src/config/env.js';
import { createLlmReader, type TermsReader } from '../src/pipeline/readers.js';
import { MemoryExtractionCache, type ReadPolicyTermsResult } from '../src/documents/index.js';
import type { DataSource } from '../src/data/datasource.js';
import type { ExtractedTerms } from '../src/domain/types.js';
import { FakeLlmClient } from '../src/llm/fakeClient.js';
import { runPipeline } from '../src/pipeline/runPipeline.js';
import { createAuditLog, listAllAudit } from '../src/state/audit.js';
import { all } from '../src/state/db.js';
import { getActivePack, getCaseByCycleKey, getPackById, listPacks } from '../src/state/repo.js';
import { acquireRunGate } from '../src/state/runGate.js';
import { type AnalyseUploadRequest, type AnalysisDeps, analyseUpload, recoverInterruptedUploads } from '../src/uploads/analysisService.js';
import { createKnownDocumentReader, type KnownDocumentRegistry, loadKnownDocuments, sha256OfFile } from '../src/uploads/knownDocuments.js';
import { ManualAwareSource, ManualPolicyWriteError } from '../src/uploads/manualSource.js';
import { getManualClient, getManualPolicy, getUpload, insertUpload, listStoredDocuments, manualPolicyId, transitionUpload } from '../src/uploads/repo.js';
import { deleteUploadFiles, purgeOldUploads, removeCacheEntriesForHash } from '../src/uploads/retention.js';
import { createDemo, type Demo, FIXTURES, TODAY } from './helpers.js';
import { SAMPLES, sample, sampleTerms } from './uploadHelpers.js';

let registry: KnownDocumentRegistry;
beforeAll(() => {
  registry = loadKnownDocuments({ fixturesDir: FIXTURES, samplesDir: SAMPLES });
});

let demo: Demo;
afterEach(() => demo.cleanup());

const runtimeDir = () => path.join(demo.dataDir, 'runtime');
const lockPath = () => path.join(runtimeDir(), 'run.lock');

/** The registry plus extra (bytes -> terms) entries for edge cases. */
function extended(extra: Array<[Uint8Array, ExtractedTerms]>): KnownDocumentRegistry {
  const map = new Map<string, ExtractedTerms>();
  for (const [bytes, terms] of extra) map.set(sha(bytes), terms);
  return {
    has: (h) => map.has(h) || registry.has(h),
    get: (h) => (map.has(h) ? structuredClone(map.get(h)) : registry.get(h)),
    get size() {
      return registry.size + map.size;
    },
  };
}

function sha(bytes: Uint8Array): string {
  const file = path.join(demo.root, `sha-${Math.random().toString(16).slice(2)}.bin`);
  writeFileSync(file, bytes);
  const value = sha256OfFile(file);
  unlinkSync(file);
  return value;
}

/** Same PDF, different bytes (a trailing comment after %%EOF): a "corrected" document for tests. */
function variant(bytes: Uint8Array, tag: string): Uint8Array {
  return new Uint8Array(Buffer.concat([Buffer.from(bytes), Buffer.from(`\n%${tag}\n`)]));
}

function deps(overrides: Partial<AnalysisDeps> = {}): AnalysisDeps {
  const known = overrides.knownDocuments ?? registry;
  return {
    db: demo.db,
    clock: demo.clock,
    dataSource: demo.dataSource,
    reader: createKnownDocumentReader(known),
    knownDocuments: known,
    compareConfig: { premiumMediumPct: 10, premiumHighPct: 25 },
    outputDir: demo.outputDir,
    runtimeDir: runtimeDir(),
    lockPath: lockPath(),
    timeZone: 'Pacific/Auckland',
    today: () => TODAY,
    limits: { maxBytes: 10 * 1024 * 1024, maxPages: 30, parseTimeoutMs: 20_000 },
    dailyLimit: 10,
    timeoutMs: 60_000,
    ...overrides,
  };
}

const attachS07 = (overrides: Partial<AnalyseUploadRequest> = {}): AnalyseUploadRequest => ({
  mode: 'attach',
  policyId: 'pol-s07',
  files: { renewal: { bytes: sample('pol-s07-renewal.pdf'), clientFilename: 'pol-s07-renewal.pdf' } },
  consent: true,
  actor: 'broker:cli',
  ...overrides,
});

const newHarbourview = (overrides: Partial<AnalyseUploadRequest> = {}): AnalyseUploadRequest => ({
  mode: 'new',
  newPolicy: { clientName: 'Harbourview Bakery Ltd', contactName: 'Jo Baker', contactEmail: 'jo.baker@example.com', brokerId: 'brk-01' },
  files: {
    expiring: { bytes: sample('harbourview-expiring.pdf'), clientFilename: 'harbourview-expiring.pdf' },
    renewal: { bytes: sample('harbourview-renewal.pdf'), clientFilename: 'harbourview-renewal.pdf' },
  },
  consent: true,
  actor: 'broker:web',
  ...overrides,
});

const HARBOURVIEW_ID = () => {
  const e = sampleTerms('harbourview-expiring.truth.json');
  return manualPolicyId(e.insurerName.value as string, e.policyNumber.value as string);
};

const types = (policyId: string) => createAuditLog(demo.db, demo.clock).listAudit(policyId).map((e) => e.type);
const overlayExists = () => existsSync(demo.overlayPath);

describe('attach mode (pipeline already ran)', () => {
  beforeEach(async () => {
    demo = await createDemo();
  });

  it('pol-s07: uploading the missing renewal moves needs_attention -> drafted -> in_review with a pack', async () => {
    expect(getCaseByCycleKey(demo.db, 'pol-s07:2027-01-22')?.status).toBe('needs_attention');
    const notified: number[] = [];
    const result = await analyseUpload(attachS07(), deps({ onPacksReady: async (packs) => void notified.push(...packs.map((p) => p.packId)) }));
    expect(result.job).toMatchObject({ status: 'done', mode: 'attach', policyId: 'pol-s07', failureCode: null });
    expect(result.outcome).toBe('new_pack');
    const caseRow = getCaseByCycleKey(demo.db, 'pol-s07:2027-01-22');
    expect(caseRow).toMatchObject({ status: 'in_review', origin: 'data_source', currentVersion: 1 });
    const pack = getActivePack(demo.db, caseRow?.id ?? 0);
    expect(pack?.inputSource).toBe('upload');
    expect(pack?.pack.diffs).toEqual([]);
    expect(notified).toEqual([pack?.id]);
    // The complete story, in order.
    const story = types('pol-s07');
    const from = story.indexOf('upload_received');
    expect(story.slice(from)).toEqual([
      'upload_received',
      'analysis_started',
      'documents_checked',
      'terms_extracted',
      'terms_extracted',
      'comparison_done',
      'pack_written',
      'status_changed',
      'status_changed',
      'manual_override_set',
      'analysis_finished',
    ]);
    // The ORIGINAL data-source expiring document was used; only the renewal was stored.
    const started = listAllAudit(demo.db).find((e) => e.type === 'analysis_started');
    expect(started?.details).toMatchObject({ expiring: 'data source', fakeLlm: true });
    expect(listStoredDocuments(demo.db, result.job.id).map((d) => d.side)).toEqual(['renewal']);
    expect(overlayExists()).toBe(false);
  });

  it('a renewal for another policy type is refused as document_mismatch: no pack, case kept needs_attention', async () => {
    const result = await analyseUpload(attachS07({ files: { renewal: { bytes: sample('harbourview-renewal.pdf') } } }), deps());
    expect(result.job).toMatchObject({ status: 'failed', failureCode: 'document_mismatch' });
    expect(getCaseByCycleKey(demo.db, 'pol-s07:2027-01-22')?.status).toBe('needs_attention');
    expect(listPacks(demo.db).filter((p) => p.pack.policyId === 'pol-s07')).toHaveLength(0);
  });

  it('attach checks the request: unknown policy, a manual id, and a missing side the data source lacks too', async () => {
    expect((await analyseUpload(attachS07({ policyId: 'pol-s99' }), deps())).job.failureCode).toBe('policy_not_found');
    expect((await analyseUpload(attachS07({ policyId: '../pol-s07' }), deps())).job.failureCode).toBe('policy_not_found');
    expect((await analyseUpload(attachS07({ policyId: 'man-0123456789ab' }), deps())).job.failureCode).toBe('policy_not_found');
    expect((await analyseUpload(attachS07({ files: { expiring: { bytes: sample('pol-s07-renewal.pdf') } } }), deps())).job.failureCode).toBe('wrong_number_of_files');
    expect((await analyseUpload(attachS07({ files: {} }), deps())).job.failureCode).toBe('wrong_number_of_files');
  });

  it('attach approve writes ONLY the overlay status; the data source is otherwise untouched', async () => {
    const fixturesBefore = sha256OfFile(path.join(FIXTURES, 'data', 'policies.json'));
    const result = await analyseUpload(attachS07(), deps());
    const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: new ManualAwareSource(demo.dataSource, demo.db), outputDir: demo.outputDir, allowedTelegramChatIds: [] });
    const approved = await core.handleAction({ action: 'approve', packId: result.job.packId as number, actor: 'broker:web', channel: 'web' });
    expect(approved.kind).toBe('ok');
    expect(JSON.parse(readFileSync(demo.overlayPath, 'utf8')).statuses).toEqual({ 'pol-s07': 'approved' });
    expect(sha256OfFile(path.join(FIXTURES, 'data', 'policies.json'))).toBe(fixturesBefore);
  });

  it('U-4: the nightly run leaves an uploaded pack alone; --force --only takes over', async () => {
    const renewal = variant(new Uint8Array(readFileSync(path.join(FIXTURES, 'documents', 'pol-s01', 'renewal.pdf'))), 'resent');
    const truth = JSON.parse(readFileSync(path.join(FIXTURES, 'ground-truth', 'pol-s01.json'), 'utf8')).expectedTerms.renewal as ExtractedTerms;
    const known = extended([[renewal, truth]]);
    const result = await analyseUpload({ ...attachS07(), policyId: 'pol-s01', files: { renewal: { bytes: renewal } } }, deps({ knownDocuments: known }));
    expect(result.outcome).toBe('new_version');
    const key = 'pol-s01:2027-01-17';
    expect(getActivePack(demo.db, getCaseByCycleKey(demo.db, key)?.id ?? 0)).toMatchObject({ version: 2, inputSource: 'upload' });

    const nightly = await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps() });
    expect(nightly.rows.find((r) => r.policyId === 'pol-s01')?.outcome).toBe('unchanged_skip');
    const skip = createAuditLog(demo.db, demo.clock).listAudit('pol-s01').filter((e) => e.type === 'unchanged_skip').at(-1);
    expect(skip?.details.reason).toBe('manual_override_in_place');

    const forced = await runPipeline({ today: TODAY, dryRun: false, only: 'pol-s01', force: true, deps: demo.pipelineDeps() });
    expect(forced.rows[0]?.outcome).toBe('new_version');
    expect(getActivePack(demo.db, getCaseByCycleKey(demo.db, key)?.id ?? 0)).toMatchObject({ version: 3, inputSource: 'data_source' });
  });

  it('the nightly D-D outcomes are unchanged for every other policy after an upload', async () => {
    await analyseUpload(attachS07(), deps());
    const nightly = await runPipeline({ today: TODAY, dryRun: false, deps: demo.pipelineDeps() });
    const outcomes = Object.fromEntries(nightly.rows.map((r) => [r.policyId, r.outcome]));
    expect(outcomes['pol-s07']).toBe('unchanged_skip');
    expect(outcomes['pol-s08']).toBe('unchanged_skip');
    expect(outcomes['pol-s09']).toBe('skipped_outside_window');
    expect(outcomes['pol-s12']).toBe('skipped_already_processed');
    expect(Object.values(outcomes).filter((o) => o === 'unchanged_skip')).toHaveLength(13);
  });
});

describe('new mode', () => {
  beforeEach(async () => {
    demo = await createDemo({ runPipeline: false });
  });

  it('end to end: manual client and policy, pack files, a card with the U-3 wording', async () => {
    const notifier = new FakeNotifier('web');
    const source = new ManualAwareSource(demo.dataSource, demo.db);
    const dispatcher = createDispatcher({ db: demo.db, clock: demo.clock, dataSource: source, notifiers: [notifier], outputDir: demo.outputDir, today: () => TODAY, reminderAfterHours: 48, reminderIntervalHours: 24, retries: 0 });
    const result = await analyseUpload(newHarbourview(), deps({ onPacksReady: dispatcher.onPacksReady }));
    expect(result.job).toMatchObject({ status: 'done', mode: 'new', policyId: HARBOURVIEW_ID() });
    const policy = getManualPolicy(demo.db, HARBOURVIEW_ID());
    expect(policy).toMatchObject({ type: 'public_liability', expiryDate: '2026-12-03', brokerId: 'brk-01', annualPremium: 3200 });
    expect(getManualClient(demo.db, policy?.clientId ?? '')).toMatchObject({ name: 'Harbourview Bakery Ltd', contactEmail: 'jo.baker@example.com' });
    const caseRow = getCaseByCycleKey(demo.db, `${HARBOURVIEW_ID()}:2026-12-03`);
    expect(caseRow).toMatchObject({ status: 'in_review', origin: 'manual' });
    const pack = getPackById(demo.db, result.job.packId as number);
    expect(pack?.inputSource).toBe('upload');
    // Pack order: severity first, then the D-014 field order.
    expect(pack?.pack.diffs.map((d) => [d.field, d.severity])).toEqual([
      ['coverLimit', 'high'],
      ['exclusion:asbestos', 'high'],
      ['annualPremium', 'low'],
    ]);
    for (const key of ['xlsx', 'clientEml', 'insurerEml'] as const) expect(existsSync(path.join(demo.outputDir, ...(pack?.paths[key] ?? '').split('/')))).toBe(true);
    const card = notifier.records.find((r) => r.kind === 'pack');
    expect(card?.text).toContain('Harbourview Bakery Ltd - Public Liability');
    expect(card?.text).toContain('Renews in 6 weeks (2026-12-03)');
    expect(card?.text).toContain('Uploaded manually');
    expect(types(HARBOURVIEW_ID())).toEqual(expect.arrayContaining(['manual_case_created', 'analysis_finished']));
    expect(types(HARBOURVIEW_ID())).not.toContain('manual_override_set');
  });

  it('identity is stable: the same pair again is unchanged_skip on the same case and pack', async () => {
    const first = await analyseUpload(newHarbourview(), deps());
    const again = await analyseUpload(newHarbourview({ newPolicy: { clientName: 'harbourview bakery ltd', brokerId: 'brk-01' } }), deps());
    expect(again.outcome).toBe('unchanged_skip');
    expect(again.job).toMatchObject({ status: 'done', policyId: first.job.policyId, packId: first.job.packId });
    expect(all(demo.db, 'SELECT COUNT(*) AS n FROM manual_policies')[0]?.n).toBe(1);
    expect(all(demo.db, 'SELECT COUNT(*) AS n FROM manual_clients')[0]?.n).toBe(1);
  });

  it('a corrected renewal for the same policy makes version 2 and supersedes version 1', async () => {
    const corrected = variant(sample('harbourview-renewal.pdf'), 'corrected');
    const terms = sampleTerms('harbourview-renewal.truth.json');
    terms.keyExclusions = terms.keyExclusions.filter((x) => x.key !== 'asbestos');
    const known = extended([[corrected, terms]]);
    const first = await analyseUpload(newHarbourview(), deps({ knownDocuments: known }));
    const second = await analyseUpload(newHarbourview({ files: { ...newHarbourview().files, renewal: { bytes: corrected } } }), deps({ knownDocuments: known }));
    expect(second.outcome).toBe('new_version');
    expect(getPackById(demo.db, first.job.packId as number)?.status).toBe('superseded');
    expect(getPackById(demo.db, second.job.packId as number)).toMatchObject({ status: 'active', version: 2 });
    expect(getPackById(demo.db, second.job.packId as number)?.pack.diffs.map((d) => d.field)).toEqual(['coverLimit', 'annualPremium']);
  });

  it('U-2 refusals produce NO pack and NO case', async () => {
    const e = sampleTerms('harbourview-expiring.truth.json');
    const r = sampleTerms('harbourview-renewal.truth.json');
    const cases: Array<[string, (x: ExtractedTerms, y: ExtractedTerms) => void]> = [
      [
        'identity_unreadable',
        (x) => {
          x.policyNumber = { value: null, sourcePage: null, sourceQuote: null, confidence: 'low' };
        },
      ],
      [
        'identity_unreadable',
        (x) => {
          x.periodEnd = { ...x.periodEnd, confidence: 'low' };
        },
      ],
      [
        'type_not_supported',
        (x) => {
          x.policyType = { value: null, sourcePage: null, sourceQuote: null, confidence: 'low' };
        },
      ],
      [
        'type_disagreement',
        (_x, y) => {
          y.policyType = { ...y.policyType, value: 'commercial_property' };
        },
      ],
    ];
    for (const [code, mutate] of cases) {
      const expiring = structuredClone(e);
      const renewal = structuredClone(r);
      mutate(expiring, renewal);
      const reader = stubReader(new Map([
        [sha(sample('harbourview-expiring.pdf')), expiring],
        [sha(sample('harbourview-renewal.pdf')), renewal],
      ]));
      const result = await analyseUpload(newHarbourview(), deps({ reader }));
      expect(result.job, code).toMatchObject({ status: 'failed', failureCode: code, packId: null });
    }
    expect(listPacks(demo.db)).toHaveLength(0);
    expect(all(demo.db, "SELECT COUNT(*) AS n FROM cases WHERE policy_id LIKE 'man-%'")[0]?.n).toBe(0);
    expect(all(demo.db, 'SELECT COUNT(*) AS n FROM manual_policies')[0]?.n).toBe(0);
  });

  it('manual approve never calls updateRenewalStatus and creates no overlay', async () => {
    const result = await analyseUpload(newHarbourview(), deps());
    let writes = 0;
    const inner: DataSource = { ...bind(demo.dataSource), updateRenewalStatus: async () => void writes++ };
    const source = new ManualAwareSource(inner, demo.db);
    const core = createApprovalCore({ db: demo.db, clock: demo.clock, dataSource: source, outputDir: demo.outputDir, allowedTelegramChatIds: [] });
    const approved = await core.handleAction({ action: 'approve', packId: result.job.packId as number, actor: 'broker:web', channel: 'web' });
    expect(approved).toMatchObject({ kind: 'ok', action: 'approve' });
    expect(approved.message).toContain('no data-source record was changed');
    expect(writes).toBe(0);
    expect(overlayExists()).toBe(false);
    expect(getPackById(demo.db, result.job.packId as number)?.syncState).toBe('ok');
    const audit = createAuditLog(demo.db, demo.clock).listAudit(HARBOURVIEW_ID()).find((ev) => ev.type === 'approved');
    expect(audit?.details.dataSource).toBe(MANUAL_CASE_SYNC_NOTE);
    expect(existsSync(path.join(demo.outputDir, 'approved'))).toBe(true);
    await expect(source.updateRenewalStatus(HARBOURVIEW_ID(), 'approved')).rejects.toBeInstanceOf(ManualPolicyWriteError);
    expect(await core.retrySync()).toEqual([]);
  });

  it('the hostile pair changes nothing except through the compare rules', async () => {
    const result = await analyseUpload(
      newHarbourview({
        newPolicy: { clientName: `=cmd|'/C calc'!A0 <script>alert(1)</script> "q" javascript:x`, brokerId: 'brk-02' },
        files: { expiring: { bytes: sample('hostile-expiring.pdf'), clientFilename: '..\\..\\evil.pdf' }, renewal: { bytes: sample('hostile-renewal.pdf'), clientFilename: 'CON.pdf' } },
      }),
      deps(),
    );
    expect(result.job.status).toBe('done');
    const pack = getPackById(demo.db, result.job.packId as number);
    const expected = compareTerms(sampleTerms('hostile-expiring.truth.json'), sampleTerms('hostile-renewal.truth.json'), { premiumMediumPct: 10, premiumHighPct: 25 });
    expect(pack?.pack.diffs).toEqual(expected.diffs);
    expect(pack?.pack.flags).toEqual(expected.flags);
    expect(expected.overallRisk).toBe('high');
    expect(getCaseByCycleKey(demo.db, pack?.pack.cycleKey ?? '')?.status).toBe('in_review');
  });

  it('input rules: consent, names, emails, brokers and file counts', async () => {
    const code = async (request: AnalyseUploadRequest) => (await analyseUpload(request, deps())).job.failureCode;
    expect(await code(newHarbourview({ consent: false }))).toBe('consent_missing');
    const base = newHarbourview().newPolicy as NonNullable<AnalyseUploadRequest['newPolicy']>;
    expect(await code(newHarbourview({ newPolicy: { ...base, clientName: '' } }))).toBe('invalid_input');
    expect(await code(newHarbourview({ newPolicy: { ...base, clientName: 'a'.repeat(101) } }))).toBe('invalid_input');
    expect(await code(newHarbourview({ newPolicy: { ...base, clientName: 'Bad\r\nName' } }))).toBe('invalid_input');
    expect(await code(newHarbourview({ newPolicy: { ...base, clientName: 'Bidi\u202Ename' } }))).toBe('invalid_input');
    expect(await code(newHarbourview({ newPolicy: { ...base, contactEmail: 'jo@example.com\r\nBcc: x@example.com' } }))).toBe('invalid_input');
    expect(await code(newHarbourview({ newPolicy: { ...base, contactEmail: 'jo@real-company.test' } }))).toBe('invalid_input');
    expect(await code(newHarbourview({ newPolicy: { ...base, brokerId: 'brk-99' } }))).toBe('invalid_input');
    expect(await code(newHarbourview({ files: { expiring: newHarbourview().files.expiring } as AnalyseUploadRequest['files'] }))).toBe('wrong_number_of_files');
    expect(await code(newHarbourview({ mode: 'other' as 'new' }))).toBe('invalid_input');
    expect(listPacks(demo.db)).toHaveLength(0);
  });

  it('fake mode refuses unknown documents; live mode never uses the registry', async () => {
    const unknown = variant(sample('harbourview-renewal.pdf'), 'unknown');
    const refused = await analyseUpload(newHarbourview({ files: { ...newHarbourview().files, renewal: { bytes: unknown } } }), deps());
    expect(refused.job).toMatchObject({ status: 'rejected', failureCode: 'unknown_in_fake_mode' });
    expect(refused.message).toMatch(/^The renewal offer: /);

    // Live mode: the LLM reader (here a FakeLlmClient) and NO registry: an unknown document is read normally.
    const llm = new FakeLlmClient([sampleTerms('harbourview-expiring.truth.json'), sampleTerms('harbourview-renewal.truth.json')]);
    const live = await analyseUpload(newHarbourview({ files: { ...newHarbourview().files, renewal: { bytes: unknown } } }), deps({ reader: createLlmReader(llm, new MemoryExtractionCache()), knownDocuments: undefined }));
    expect(live.job).toMatchObject({ status: 'done', tokensIn: 2000, tokensOut: 400 });
    expect(llm.callCount).toBe(2);

    const liveEnv = parseEnv({ LLM_PROVIDER: 'openai', LLM_API_KEY: 'sk-test-placeholder-not-a-real-key-000', LLM_MODEL: 'test-model' });
    const liveSetup = analysisDepsFor(liveEnv, demo.db, { fakeLlm: false });
    expect(liveSetup.deps.knownDocuments).toBeUndefined();
    expect(liveSetup.deps.reader?.isFake).toBe(false);
    const fakeSetup = analysisDepsFor(parseEnv({}), demo.db, { fakeLlm: true });
    expect(fakeSetup.deps.knownDocuments?.size).toBe(33);
  });

  it('live mode without LLM settings says AI reading is not configured (names only, never values)', async () => {
    const setup = analysisDepsFor(parseEnv({}), demo.db, { fakeLlm: false });
    expect(setup.deps.reader).toBeNull();
    expect(setup.missingAiConfig.join(',')).toMatch(/LLM_/);
    const result = await analyseUpload(newHarbourview(), { ...deps(), reader: null, knownDocuments: undefined });
    expect(result.job.failureCode).toBe('ai_not_configured');
    expect(result.message).toBe('AI reading is not configured on this computer, so real documents cannot be analysed.');
  });

  it('the daily limit counts analyses started on the local day and resets at local midnight', async () => {
    const limited = deps({ dailyLimit: 1 });
    expect((await analyseUpload(newHarbourview(), limited)).job.status).toBe('done');
    expect((await analyseUpload(newHarbourview({ consent: false }), limited)).job.failureCode).toBe('consent_missing');
    expect((await analyseUpload(newHarbourview(), limited)).job.failureCode).toBe('daily_limit_reached');
    demo.clock.set('2026-10-19T10:59:59.000Z'); // 23:59:59 on 19 October in Auckland: still the same day
    expect((await analyseUpload(newHarbourview(), limited)).job.failureCode).toBe('daily_limit_reached');
    demo.clock.set('2026-10-19T11:00:00.000Z'); // local midnight
    expect((await analyseUpload(newHarbourview(), limited)).job.status).toBe('done');
  });

  it('busy: one analysis or run at a time, in this process and across processes', async () => {
    const gate = acquireRunGate(lockPath());
    expect((await analyseUpload(newHarbourview(), deps())).job.failureCode).toBe('busy');
    gate.release();
    mkdirSync(runtimeDir(), { recursive: true });
    writeFileSync(lockPath(), JSON.stringify({ pid: process.ppid, startedAt: null }));
    expect((await analyseUpload(newHarbourview(), deps())).job.failureCode).toBe('busy');
    unlinkSync(lockPath());
    expect((await analyseUpload(newHarbourview(), deps())).job.status).toBe('done');
  });

  it('timeout: the job fails timed_out, the late result is discarded, the gate reopens after it settles', async () => {
    let finish: (value: ReadPolicyTermsResult) => void = () => {};
    const slow: TermsReader = {
      modelName: 'slow',
      isFake: true,
      read: () =>
        new Promise<ReadPolicyTermsResult>((resolve) => {
          finish = resolve;
        }),
      peek: async () => undefined,
    };
    const result = await analyseUpload(newHarbourview(), deps({ reader: slow, timeoutMs: 50 }));
    expect(result.job).toMatchObject({ status: 'failed', failureCode: 'timed_out', packId: null });
    expect(() => acquireRunGate(lockPath())).toThrow(); // the uncancellable call is still running
    finish({ terms: sampleTerms('harbourview-expiring.truth.json'), warnings: [], usage: { inputTokens: 0, outputTokens: 0 }, fromCache: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    finish({ terms: sampleTerms('harbourview-renewal.truth.json'), warnings: [], usage: { inputTokens: 0, outputTokens: 0 }, fromCache: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getUpload(demo.db, result.job.id)?.status).toBe('failed');
    expect(listPacks(demo.db)).toHaveLength(0);
    acquireRunGate(lockPath()).release();
  });

  it('startup recovery marks jobs left running as failed interrupted (audited)', () => {
    const stuck = insertUpload(demo.db, demo.clock, { actor: 'broker:web', mode: 'new' });
    transitionUpload(demo.db, demo.clock, stuck.id, 'validating');
    transitionUpload(demo.db, demo.clock, stuck.id, 'extracting');
    const fresh = insertUpload(demo.db, demo.clock, { actor: 'broker:web', mode: 'new' });
    expect(recoverInterruptedUploads(demo.db, demo.clock, { staleReceivedMs: 60_000 })).toEqual([stuck.id]);
    expect(getUpload(demo.db, stuck.id)).toMatchObject({ status: 'failed', failureCode: 'interrupted' });
    expect(getUpload(demo.db, fresh.id)?.status).toBe('received');
    expect(listAllAudit(demo.db).filter((e) => e.type === 'analysis_interrupted').map((e) => e.details.uploadId)).toEqual([stuck.id]);
  });

  it('delete and purge remove the stored PDFs and their cache entries, keep audit and packs, spare other uploads', async () => {
    const first = await analyseUpload(newHarbourview(), deps());
    demo.clock.advance(3 * 86_400_000);
    const second = await analyseUpload(newHarbourview({ files: { ...newHarbourview().files, renewal: { bytes: sample('harbourview-renewal.pdf') } } }), deps());
    const cacheDir = path.join(demo.root, 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const expiringSha = listStoredDocuments(demo.db, first.job.id)[0]?.sha256 as string;
    writeFileSync(path.join(cacheDir, `${'a'.repeat(64)}.json`), JSON.stringify({ fileSha256: expiringSha }));
    writeFileSync(path.join(cacheDir, `${'b'.repeat(64)}.json`), JSON.stringify({ fileSha256: 'f'.repeat(64) }));
    const retention = { db: demo.db, clock: demo.clock, runtimeDir: runtimeDir(), cacheDir, protectedHashes: new Set<string>() };
    const files = (id: number) => listStoredDocuments(demo.db, id).map((d) => path.join(runtimeDir(), ...d.storedPath.split('/')));
    const firstFiles = files(first.job.id);
    expect(firstFiles.every((f) => existsSync(f))).toBe(true);

    // The second upload still holds the same bytes, so the cache entry stays.
    const deleted = deleteUploadFiles(retention, first.job.id, 'broker:cli');
    expect(deleted).toEqual({ found: true, files: 2, cacheEntriesRemoved: 0 });
    expect(firstFiles.some((f) => existsSync(f))).toBe(false);
    expect(files(second.job.id).every((f) => existsSync(f))).toBe(true);
    expect(getPackById(demo.db, first.job.packId as number)).toBeDefined();
    expect(deleteUploadFiles(retention, first.job.id, 'broker:cli').files).toBe(0);
    expect(deleteUploadFiles(retention, 9999, 'broker:cli').found).toBe(false);

    // Purge: nothing is older than 7 days yet; after 8 more days the second upload goes too.
    expect(purgeOldUploads(retention, 7, { dryRun: false, actor: 'broker:cli' }).files).toBe(0);
    demo.clock.advance(8 * 86_400_000);
    const dry = purgeOldUploads(retention, 7, { dryRun: true, actor: 'broker:cli' });
    expect(dry).toMatchObject({ dryRun: true, files: 2, uploadIds: [second.job.id] });
    expect(files(second.job.id).every((f) => existsSync(f))).toBe(true);
    const purged = purgeOldUploads(retention, 7, { dryRun: false, actor: 'broker:cli' });
    expect(purged).toMatchObject({ files: 2, cacheEntriesRemoved: 1 });
    expect(existsSync(path.join(cacheDir, `${'a'.repeat(64)}.json`))).toBe(false);
    expect(existsSync(path.join(cacheDir, `${'b'.repeat(64)}.json`))).toBe(true);
    expect(listAllAudit(demo.db).filter((e) => e.type === 'upload_deleted' || e.type === 'upload_purged')).toHaveLength(4);
    expect(listAllAudit(demo.db).filter((e) => e.type === 'analysis_finished')).toHaveLength(2);

    // A data-source document's cache entry is protected.
    expect(removeCacheEntriesForHash(path.join(demo.root, 'nope'), 'x')).toBe(0);
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('audit details never hold a filename, document text or a client name', async () => {
    await analyseUpload(
      newHarbourview({
        newPolicy: { clientName: 'Hostile <script>x</script> Ltd', brokerId: 'brk-01' },
        files: { expiring: { bytes: sample('hostile-expiring.pdf'), clientFilename: '..\\..\\secret-name.pdf' }, renewal: { bytes: sample('hostile-renewal.pdf'), clientFilename: 'CON.pdf' } },
      }),
      deps(),
    );
    await analyseUpload(newHarbourview({ files: { expiring: { bytes: sample('not-a-pdf.pdf'), clientFilename: 'leaky-name.pdf' }, renewal: newHarbourview().files.renewal } as AnalyseUploadRequest['files'] }), deps());
    const json = JSON.stringify(listAllAudit(demo.db).map((e) => e.details));
    for (const forbidden of ['secret-name', 'leaky-name', 'CON.pdf', '.pdf', 'Ignore all previous', 'HYPERLINK', '<script>', 'Hostile', 'POLICY_DOCUMENT', 'Gannet Point']) {
      expect(json, forbidden).not.toContain(forbidden);
    }
  });
});

function stubReader(byHash: Map<string, ExtractedTerms>): TermsReader {
  const read: TermsReader['read'] = async (pdfPath) => {
    const terms = byHash.get(sha256OfFile(pdfPath));
    if (!terms) throw new Error('stub reader: unknown document');
    return { terms: structuredClone(terms), warnings: [], usage: { inputTokens: 0, outputTokens: 0 }, fromCache: false };
  };
  return { modelName: 'stub', isFake: true, read, peek: read };
}

function bind(source: DataSource): DataSource {
  return {
    listPolicies: () => source.listPolicies(),
    getPolicy: (id) => source.getPolicy(id),
    getClient: (id) => source.getClient(id),
    getBroker: (id) => source.getBroker(id),
    getDocumentPaths: (id) => source.getDocumentPaths(id),
    updateRenewalStatus: (id, status) => source.updateRenewalStatus(id, status),
  };
}

describe('cards for data-source packs are unchanged', () => {
  it('without the uploaded flag the first line keeps the D-085 wording', () => {
    const card = buildPackCard({
      packId: 1,
      caseId: 1,
      pack: { cycleKey: 'pol-s01:2027-01-17', version: 1, policyId: 'pol-s01', diffs: [], flags: [], xlsxPath: 'a', clientEmlPath: 'b', insurerEmlPath: 'c', summaryText: 's', contentHash: 'h', createdAt: '2026-10-19T00:00:00.000Z' },
      policy: { id: 'pol-s01', clientId: 'cli-01', brokerId: 'brk-01', insurerName: 'X', type: 'commercial_property', expiryDate: '2027-01-17', annualPremium: 1, status: 'in_review' },
      client: { id: 'cli-01', name: 'C', contactName: 'N', contactEmail: 'n@example.com' },
      today: TODAY,
    });
    expect(card.lines[0]).toBe('Renews in 12 weeks (2027-01-17)');
    expect(card.text).not.toContain('Uploaded manually');
  });
});
