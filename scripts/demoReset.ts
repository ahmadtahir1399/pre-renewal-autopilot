// npm run demo:reset [-- --no-serve]
// Restores a clean demo: REFERENCE_DATE 2026-10-19, a throwaway web token "demo-token" (this process
// only; never written to .env), reset-demo, one pipeline run per demo policy (pol-s01, pol-s02, pol-s03,
// pol-s07), then the approval page (serve) unless --no-serve.
// Extraction source, in this order: (a) cached LIVE extraction when the cache holds every demo document
// and the LLM settings are present (no new calls: cache hits only); else (b) --fake-llm with the loud banner.

// The demo values are set BEFORE .env is read; values already in the environment win over .env.
process.env.REFERENCE_DATE = '2026-10-19';
process.env.APPROVAL_WEB_TOKEN = 'demo-token';

const { loadEnvOrExit } = await import('../src/config/env.js');
const { main } = await import('../src/cli/index.js');
const { DEMO_POLICIES, DEMO_REFERENCE_DATE, DEMO_WEB_TOKEN, uncachedDocuments } = await import('./demo/demoPolicies.js');

const env = loadEnvOrExit();
if (env.REFERENCE_DATE !== DEMO_REFERENCE_DATE || env.APPROVAL_WEB_TOKEN !== DEMO_WEB_TOKEN) {
  console.log('Could not set the demo date or token. Nothing was changed.');
  process.exit(1);
}

const missing = await uncachedDocuments(env);
const llmReady = Boolean(env.LLM_PROVIDER && env.LLM_API_KEY && env.LLM_MODEL);
const useCache = llmReady && missing.length === 0;
const source = useCache
  ? `(a) cached LIVE extraction (${env.LLM_MODEL}, every demo document cached; no new AI calls)`
  : `(b) FAKE LLM: answer keys stand in for the AI${llmReady ? ` (${missing.length} demo documents are not cached; run demo:warm to use real extraction)` : ' (no LLM settings in .env)'}`;
console.log(`Extraction source: ${source}`);

const fakeFlag = useCache ? [] : ['--fake-llm'];
const step = async (args: string[]) => {
  const code = await main(args);
  if (code !== 0 && code !== undefined) {
    console.log(`Step "${args.join(' ')}" failed with exit code ${code}. Stopping.`);
    process.exit(code);
  }
};

await step(['resume']);
await step(['reset-demo']);
for (const policyId of DEMO_POLICIES) await step(['run', '--only', policyId, ...fakeFlag]);
await step(['status']);
console.log('');
console.log(`Extraction source used: ${source}`);
console.log(`Demo web token: ${DEMO_WEB_TOKEN} (throwaway, this process only). Reference date: ${DEMO_REFERENCE_DATE}.`);

if (process.argv.includes('--no-serve')) {
  console.log('Demo data ready (--no-serve). Start the page with the same token: run demo:reset without --no-serve.');
} else {
  console.log('Starting the approval page (Ctrl+C to stop)...');
  await step(['serve', ...fakeFlag]);
}
