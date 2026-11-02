// Evaluation: the driving test.
//   npm run eval:fake                       PLUMBING CHECK (answer keys as the "model"); no key, seconds; accuracy NOT measured
//   npm run eval:live                       prints the plan and the exact call count, then STOPS (no call is made)
//   RUN_LIVE_LLM=1 npm run eval:live -- --confirm [--repeats 3] [--resume]   the paid run, after the user typed "go"
//   npm run eval:live -- --report-only      rebuild the live report from reports/raw (no calls)
// Flags: --date yyyy-mm-dd (default: today in TIMEZONE), --final-reason "<text>".
// Scripts may read the real clock (dates, durations); the logic under test never does.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { COMPARE_RULES_VERSION, type CompareConfig } from '../src/compare/compareTerms.js';
import { type Env, loadEnvOrExit } from '../src/config/env.js';
import { systemClock } from '../src/domain/dates.js';
import { EXTRACT_PROMPT_VERSION } from '../src/documents/prompts/extractTerms.js';
import { type LlmResponseInfo, OpenAiLlmClient } from '../src/llm/client.js';
import { createGroundTruthReader, FAKE_MODEL_NAME } from '../src/pipeline/readers.js';
import { emptyCounts, evaluateRepeat, type RepeatEval, summarisePlumbing, summariseVersion, type VersionSummary } from './eval/aggregate.js';
import { loadAllRaw, loadGroundTruths, planDocuments, rawFilePath, readRaw, runRepeat, TRANSPORT_RETRIES, VALIDATION_ATTEMPTS, isReusable } from './eval/live.js';
import { createReplayReader, runPipelineReplay } from './eval/pipelineReplay.js';
import { PRICING } from './eval/pricing.js';
import { type ReportHeader, renderLive, renderPlumbing } from './eval/render.js';
import { scoreScenario } from './eval/score.js';
import type { EvalMode } from './eval/types.js';

const FIXTURES_DIR = 'fixtures';
const REPORTS_DIR = 'reports';
const RAW_DIR = path.join(REPORTS_DIR, 'raw');

interface Args {
  mode: EvalMode;
  repeats: number;
  date: string | null;
  resume: boolean;
  confirm: boolean;
  reportOnly: boolean;
  finalReason: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { mode: 'fake', repeats: 3, date: null, resume: false, confirm: false, reportOnly: false, finalReason: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode') {
      const value = argv[++i];
      if (value !== 'fake' && value !== 'live') throw new Error('--mode must be fake or live');
      args.mode = value;
    } else if (arg === '--repeats') {
      args.repeats = Number(argv[++i]);
      if (!Number.isInteger(args.repeats) || args.repeats < 1 || args.repeats > 10) throw new Error('--repeats must be a whole number from 1 to 10');
    } else if (arg === '--date') {
      args.date = argv[++i] ?? null;
      if (!args.date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('--date must be yyyy-mm-dd');
    } else if (arg === '--resume') args.resume = true;
    else if (arg === '--confirm') args.confirm = true;
    else if (arg === '--report-only') args.reportOnly = true;
    else if (arg === '--final-reason') args.finalReason = argv[++i] ?? null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function compareConfigOf(env: Env): CompareConfig {
  return { premiumMediumPct: env.PREMIUM_MEDIUM_PCT, premiumHighPct: env.PREMIUM_HIGH_PCT };
}

function header(env: Env, args: Args, model: string, promptVersion: string, repeats: number, documents: number): ReportHeader {
  return {
    date: args.date as string,
    mode: args.mode,
    model,
    promptVersion,
    compareRulesVersion: COMPARE_RULES_VERSION,
    thresholds: { premiumMediumPct: env.PREMIUM_MEDIUM_PCT, premiumHighPct: env.PREMIUM_HIGH_PCT, windowMinDays: env.WINDOW_MIN_DAYS, windowMaxDays: env.WINDOW_MAX_DAYS },
    repeats,
    documents,
    generatedBy: `scripts/evaluate.ts --mode ${args.mode}`,
  };
}

function writeReport(args: Args, markdown: string, json: unknown): { md: string; json: string } {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const base = path.join(REPORTS_DIR, `eval-${args.date}-${args.mode}`);
  writeFileSync(`${base}.md`, `${markdown}\n`, 'utf8');
  writeFileSync(`${base}.json`, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  return { md: `${base}.md`, json: `${base}.json` };
}

async function runFake(env: Env, args: Args): Promise<number> {
  const started = Date.now();
  const truths = loadGroundTruths(FIXTURES_DIR);
  const today = truths[0]?.referenceDate ?? '2026-10-19';
  const replay = await runPipelineReplay({
    fixturesDir: FIXTURES_DIR,
    today,
    reader: createGroundTruthReader(FIXTURES_DIR),
    maxConcurrency: env.MAX_CONCURRENCY,
    compareConfig: compareConfigOf(env),
    windowMinDays: env.WINDOW_MIN_DAYS,
    windowMaxDays: env.WINDOW_MAX_DAYS,
  });
  const scores = replay.outcomes.map((o) => scoreScenario(truths.find((t) => t.policyId === o.policyId) as (typeof truths)[number], o));
  const plumbing = summarisePlumbing(scores, replay.summary.counts);
  const head = header(env, args, FAKE_MODEL_NAME, EXTRACT_PROMPT_VERSION, 1, 0);
  const files = writeReport(args, renderPlumbing(head, plumbing), { header: head, note: 'PLUMBING CHECK - accuracy not measured', plumbing });
  const ok = plumbing.failures.length === 0;
  console.log('PLUMBING CHECK - accuracy not measured (the fake reader returns the answer keys).');
  console.log(`selection ${plumbing.selectionCorrect.hit}/${plumbing.selectionCorrect.total}, status ${plumbing.statusCorrect.hit}/${plumbing.statusCorrect.total}, packs ${plumbing.packs.hit}/${plumbing.packs.total}, risk ${plumbing.riskCorrect.hit}/${plumbing.riskCorrect.total}, flags exact ${plumbing.flagsExact.hit}/${plumbing.flagsExact.total}, files ${plumbing.filesOk.hit}/${plumbing.filesOk.total}, failures ${plumbing.failures.length}`);
  console.log(`Report: ${files.md} and ${files.json} (gitignored). ${ok ? 'PASS' : 'FAIL'} in ${Date.now() - started} ms.`);
  return ok ? 0 : 1;
}

function printPlan(input: { documents: number; repeats: number; reusable: number; model: string; concurrency: number; typedChecks: number }): void {
  const calls = input.documents * input.repeats - input.reusable;
  console.log('LIVE EVALUATION PLAN (no call has been made)');
  console.log(`  Model: ${input.model}`);
  console.log(`  Extraction prompt version: ${EXTRACT_PROMPT_VERSION}`);
  console.log(`  Documents measured: ${input.documents} (readable documents with answer-key terms)`);
  console.log(`  Repeats: ${input.repeats}${input.reusable > 0 ? ` (already measured and reused: ${input.reusable})` : ''}`);
  console.log(`  Expected LLM calls: ${calls} if every read is valid first time`);
  console.log(`  Possible extra calls: up to ${VALIDATION_ATTEMPTS - 1} validation retries per read (worst case ${calls * VALIDATION_ATTEMPTS} calls),`);
  console.log(`    plus up to ${TRANSPORT_RETRIES} backoff re-reads per document after a rate limit, timeout or server error.`);
  console.log(`  Typed-error checks (pol-s07 missing, pol-s08 image-only): ${input.typedChecks} per repeat, 0 calls expected.`);
  console.log(`  Concurrency: ${input.concurrency} (MAX_CONCURRENCY). Extraction cache: disabled (no reads, no writes).`);
}

function finalReasonFor(args: Args, versions: readonly VersionSummary[]): string {
  if (args.finalReason) return args.finalReason;
  return versions.length === 1
    ? 'It is the only version measured.'
    : `It is the current EXTRACT_PROMPT_VERSION in src/documents/prompts/extractTerms.ts; earlier versions are shown in full below.`;
}

async function buildLiveReport(env: Env, args: Args): Promise<number> {
  const truths = loadGroundTruths(FIXTURES_DIR);
  const today = truths[0]?.referenceDate ?? '2026-10-19';
  const raws = loadAllRaw(RAW_DIR);
  if (raws.length === 0) {
    console.log(`No completed raw live repeats in ${RAW_DIR}. Nothing to report.`);
    return 1;
  }
  const versionsOrder = [...new Set(raws.map((r) => r.promptVersion))];
  const versions: VersionSummary[] = [];
  for (const promptVersion of versionsOrder) {
    const ofVersion = raws.filter((r) => r.promptVersion === promptVersion);
    const model = ofVersion[0]?.model ?? 'unknown';
    const evals: RepeatEval[] = [];
    for (const raw of ofVersion) {
      const replay = await runPipelineReplay({
        fixturesDir: FIXTURES_DIR,
        today,
        reader: createReplayReader(raw.documents, model),
        maxConcurrency: env.MAX_CONCURRENCY,
        compareConfig: compareConfigOf(env),
        windowMinDays: env.WINDOW_MIN_DAYS,
        windowMaxDays: env.WINDOW_MAX_DAYS,
      });
      evals.push(evaluateRepeat({ raw, outcomes: replay.outcomes, pipelineCounts: replay.summary.counts ?? emptyCounts() }, truths));
    }
    versions.push(summariseVersion(promptVersion, model, evals));
  }
  const finalVersion = versionsOrder.includes(EXTRACT_PROMPT_VERSION) ? EXTRACT_PROMPT_VERSION : (versionsOrder[versionsOrder.length - 1] as string);
  const final = versions.find((v) => v.promptVersion === finalVersion) as VersionSummary;
  const reason = finalReasonFor(args, versions);
  const head = header(env, args, final.model, finalVersion, final.repeats.length, final.repeats[0]?.documents ?? 0);
  const json = {
    header: head,
    syntheticData: true,
    caveat: 'Fixtures written by the project author from templates; numbers measure this synthetic set only.',
    pricing: PRICING,
    finalVersion,
    finalReason: reason,
    rawFiles: raws.map((r) => path.basename(rawFilePath(RAW_DIR, r.date, r.promptVersion, r.repeat))),
    versions,
  };
  const files = writeReport(args, renderLive(head, versions, finalVersion, reason, PRICING), json);
  const p = final.pooled;
  console.log(`Final version ${finalVersion}, ${final.repeats.length} repeats x ${head.documents} documents:`);
  console.log(`  field values ${p.fieldValue.hit}/${p.fieldValue.total}, pages ${p.fieldPage.hit}/${p.fieldPage.total}, exclusion recall ${p.exclusionRecall.hit}/${p.exclusionRecall.total}, diff recall ${p.diffRecall.hit}/${p.diffRecall.total}, diff precision ${p.diffPrecision.hit}/${p.diffPrecision.total}, status ${p.statusCorrect.hit}/${p.statusCorrect.total}, wrong-at-high ${p.wrongHigh}, failures listed ${final.failures.length}`);
  console.log(`Report: ${files.md} and ${files.json}`);
  return 0;
}

async function runLive(env: Env, args: Args): Promise<number> {
  if (args.reportOnly) return buildLiveReport(env, args);
  if (!env.LLM_API_KEY || !env.LLM_MODEL || !env.LLM_PROVIDER) {
    const missing = [!env.LLM_PROVIDER && 'LLM_PROVIDER', !env.LLM_API_KEY && 'LLM_API_KEY', !env.LLM_MODEL && 'LLM_MODEL'].filter(Boolean).join(', ');
    console.log(`Set ${missing} in your .env file (see .env.example), then run again. Nothing was called.`);
    return 1;
  }
  if (env.LLM_PROVIDER.toLowerCase() !== 'openai') {
    console.log(`LLM_PROVIDER "${env.LLM_PROVIDER}" is not supported (openai only). Nothing was called.`);
    return 1;
  }
  const truths = loadGroundTruths(FIXTURES_DIR);
  const { measured, typedChecks } = planDocuments(FIXTURES_DIR, truths);
  const reusable = args.resume
    ? Array.from({ length: args.repeats }, (_, i) => readRaw(rawFilePath(RAW_DIR, args.date as string, EXTRACT_PROMPT_VERSION, i + 1)))
        .filter((raw) => raw !== null && raw.model === env.LLM_MODEL)
        .reduce((n, raw) => n + (raw?.complete ? measured.length : (raw?.documents.filter(isReusable).length ?? 0)), 0)
    : 0;
  printPlan({ documents: measured.length, repeats: args.repeats, reusable, model: env.LLM_MODEL, concurrency: env.MAX_CONCURRENCY, typedChecks: typedChecks.length });
  if (!args.confirm || !env.RUN_LIVE_LLM) {
    console.log('');
    console.log('STOPPED before any call. To spend these calls: set RUN_LIVE_LLM=1 for this command and add --confirm');
    console.log('(only after the project owner has typed "go").');
    return 0;
  }
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL;
  const temperature = env.LLM_TEMPERATURE;
  const llmFactory = (onResponse: (info: LlmResponseInfo) => void) =>
    new OpenAiLlmClient({ apiKey, model, sdkMaxRetries: 0, onResponse, ...(temperature === undefined ? {} : { temperature }) });
  for (let repeat = 1; repeat <= args.repeats; repeat++) {
    const raw = await runRepeat({
      rawDir: RAW_DIR,
      date: args.date as string,
      repeat,
      promptVersion: EXTRACT_PROMPT_VERSION,
      model,
      documents: measured,
      typedChecks,
      concurrency: env.MAX_CONCURRENCY,
      resume: args.resume,
      deps: { llmFactory, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), nowMs: () => Date.now() },
      nowIso: () => new Date().toISOString(),
      log: (line) => console.log(line),
    });
    const failed = raw.documents.filter((d) => !d.ok).length;
    console.log(`repeat ${repeat} saved: ${raw.documents.length} documents, ${failed} failed, ${raw.typedErrorChecks.filter((c) => c.pass).length}/${raw.typedErrorChecks.length} typed-error checks passed`);
  }
  return buildLiveReport(env, args);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnvOrExit();
  args.date ??= systemClock(env.TIMEZONE).today();
  return args.mode === 'fake' ? runFake(env, args) : runLive(env, args);
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    process.exit(1);
  },
);
