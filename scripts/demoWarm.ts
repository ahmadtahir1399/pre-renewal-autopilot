// npm run demo:warm                          prints how many demo documents need a live extraction, then STOPS
// RUN_LIVE_LLM=1 npm run demo:warm -- --confirm   one-time live extraction of exactly those documents into the cache
// Only the demo documents not yet cached are read (cache key: file hash + prompt version + model).
// Run it only after the project owner has confirmed the call count.

import { loadEnvOrExit } from '../src/config/env.js';
import { JsonFileExtractionCache } from '../src/documents/cache.js';
import { readPolicyTerms } from '../src/documents/index.js';
import { EXTRACT_PROMPT_VERSION } from '../src/documents/prompts/extractTerms.js';
import { createLlmClient } from '../src/llm/client.js';
import { uncachedDocuments } from './demo/demoPolicies.js';

const env = loadEnvOrExit();
if (!env.LLM_PROVIDER || !env.LLM_API_KEY || !env.LLM_MODEL) {
  console.log('Set LLM_PROVIDER, LLM_API_KEY and LLM_MODEL in .env first. Nothing was called.');
  process.exit(1);
}
const cache = new JsonFileExtractionCache();
const missing = await uncachedDocuments(env, cache);
console.log(`Model ${env.LLM_MODEL}, prompt ${EXTRACT_PROMPT_VERSION}. Demo documents not yet cached: ${missing.length}`);
for (const doc of missing) console.log(`  ${doc.policyId} ${doc.side}`);
if (missing.length === 0) {
  console.log('Already warm: demo:reset will use cached live extraction. Nothing was called.');
  process.exit(0);
}
console.log(`Expected LLM calls: ${missing.length} (up to ${missing.length * 3} if the model's output needs validation retries).`);
if (!env.RUN_LIVE_LLM || !process.argv.includes('--confirm')) {
  console.log('STOPPED before any call. To spend these calls: set RUN_LIVE_LLM=1 for this command and add --confirm.');
  process.exit(0);
}
const llm = createLlmClient(env);
for (const doc of missing) {
  const result = await readPolicyTerms(doc.path, { llm, cache, policyId: doc.policyId, documentKind: doc.side });
  console.log(`  ${doc.policyId} ${doc.side}: cached (tokens ${result.usage.inputTokens}/${result.usage.outputTokens}, warnings ${result.warnings.length})`);
}
console.log('Done. demo:reset will now use cached live extraction.');
