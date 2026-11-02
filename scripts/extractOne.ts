// LIVE extraction of one document (costs tokens unless cached).
//   PowerShell: $env:RUN_LIVE_LLM='1'; npm run extract:one -- pol-s01 expiring
// Prints terms, warnings and usage. Never prints the document text or any key.

import path from 'node:path';
import { loadEnvOrExit } from '../src/config/env.js';
import { JsonFileExtractionCache, readPolicyTerms } from '../src/documents/index.js';
import { createLlmClient } from '../src/llm/client.js';

const env = loadEnvOrExit();
if (!env.RUN_LIVE_LLM) {
  process.stderr.write('Refusing to run: this makes a LIVE LLM call. Set RUN_LIVE_LLM=1 (PowerShell: $env:RUN_LIVE_LLM=\'1\').\n');
  process.exit(1);
}

const [policyId, kind] = process.argv.slice(2);
if (!policyId || !/^pol-s\d{2}$/.test(policyId) || (kind !== 'expiring' && kind !== 'renewal')) {
  process.stderr.write('Usage: npm run extract:one -- <policyId> <expiring|renewal>   e.g. pol-s01 expiring\n');
  process.exit(1);
}

const llm = createLlmClient(env);
const pdfPath = path.join(env.FIXTURES_DIR, 'documents', policyId, `${kind}.pdf`);
const result = await readPolicyTerms(pdfPath, {
  llm,
  cache: new JsonFileExtractionCache(),
  policyId,
  documentKind: kind,
});

process.stdout.write(
  `${JSON.stringify(
    { policyId, kind, model: llm.model, fromCache: result.fromCache, usage: result.usage, warnings: result.warnings, terms: result.terms },
    null,
    2,
  )}\n`,
);
