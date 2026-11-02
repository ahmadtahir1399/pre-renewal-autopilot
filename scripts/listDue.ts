// npm run list:due
// Prints today's due renewals grouped by client, for REFERENCE_DATE (default 2026-10-19).
// Read-only: uses the DataSource and the seed state; writes nothing.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvOrExit } from '../src/config/env.js';
import { LocalJsonSource } from '../src/data/localJsonSource.js';
import { loadSeedState, processedCycleKeysFrom } from '../src/data/seedState.js';
import { daysBetween, fixedClock } from '../src/domain/dates.js';
import { parseClients } from '../src/domain/schemas.js';
import { groupByClient } from '../src/selection/groupByClient.js';
import { selectRenewals } from '../src/selection/renewalWindow.js';

const env = loadEnvOrExit();
const today = fixedClock(env.REFERENCE_DATE ?? '2026-10-19').today();
const source = new LocalJsonSource({ fixturesDir: env.FIXTURES_DIR, dataDir: env.DATA_DIR });

const clients = parseClients(JSON.parse(readFileSync(path.join(env.FIXTURES_DIR, 'data', 'clients.json'), 'utf8')));
const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

const { candidates, skipped } = selectRenewals({
  policies: await source.listPolicies(),
  today,
  minDays: env.WINDOW_MIN_DAYS,
  maxDays: env.WINDOW_MAX_DAYS,
  processedCycleKeys: processedCycleKeysFrom(loadSeedState(env.FIXTURES_DIR)),
  clientNameById,
});

const lines: string[] = [
  `Due renewals for ${today} (window ${env.WINDOW_MIN_DAYS}-${env.WINDOW_MAX_DAYS} days, inclusive): ${candidates.length} candidates`,
];
for (const group of groupByClient(candidates, clientNameById)) {
  lines.push('', `${group.clientName} (${group.clientId})`);
  for (const policy of group.policies) {
    lines.push(`  ${policy.id}  ${policy.type.padEnd(22)} expires ${policy.expiryDate}  in ${daysBetween(today, policy.expiryDate)} days`);
  }
}
lines.push('', `Skipped: ${skipped.map((s) => `${s.policyId} (${s.reason})`).join(', ') || 'none'}`);
process.stdout.write(`${lines.join('\n')}\n`);
