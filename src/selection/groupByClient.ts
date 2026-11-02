// Groups selected policies by client. Stable: clients appear in the order of
// their first (most urgent) policy, and policies keep their candidate order.

import type { Policy } from '../domain/types.js';

export interface ClientGroup {
  clientId: string;
  clientName: string;
  policies: Policy[];
}

export function groupByClient(candidates: readonly Policy[], clientNameById: ReadonlyMap<string, string>): ClientGroup[] {
  const groups = new Map<string, ClientGroup>();
  for (const policy of candidates) {
    let group = groups.get(policy.clientId);
    if (!group) {
      group = { clientId: policy.clientId, clientName: clientNameById.get(policy.clientId) ?? policy.clientId, policies: [] };
      groups.set(policy.clientId, group);
    }
    group.policies.push(policy);
  }
  return [...groups.values()];
}
