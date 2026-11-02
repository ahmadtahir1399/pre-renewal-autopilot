// npm run ui:preview
// Throwaway demo of the approval page: reset-demo, run --fake-llm (approves nothing), then serve
// --fake-llm with the fixed token "demo-token" (set for THIS process only). The launch URL is printed
// by serve to the terminal and nowhere else. Stop with Ctrl+C.
// WARNING: reset-demo clears this folder's database, overlay and output (keeps .cache).

import { main } from '../src/cli/index.js';

const out = (line = '') => process.stdout.write(`${line}\n`);

process.env.APPROVAL_WEB_TOKEN = 'demo-token';
if (!process.env.REFERENCE_DATE) {
  // The demo outcomes are built around this date (D-070); without it pol-s10 may fall outside the window.
  process.env.REFERENCE_DATE = '2026-10-19';
  out('REFERENCE_DATE was not set; using 2026-10-19 for this preview only.');
}

async function step(label: string, argv: string[]): Promise<void> {
  out(`\n=== ui:preview: ${label} ===`);
  const code = await main(argv);
  if (code !== 0) throw new Error(`"${argv.join(' ')}" exited with code ${code}`);
}

try {
  await step('reset-demo', ['reset-demo']);
  await step('run --fake-llm', ['run', '--fake-llm']);
  out('\n=== ui:preview: serve --fake-llm (token: demo-token; Ctrl+C to stop) ===');
  process.exitCode = await main(['serve', '--fake-llm']);
} catch (error) {
  out(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
