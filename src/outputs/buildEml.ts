// Builds the two DRAFT emails (client, insurer). Text only: nothing is ever sent.

import { SEVERITIES } from '../domain/schemas.js';
import type { Broker, Client, Flag, IsoDate, Policy, TermDiff } from '../domain/types.js';
import type { Summary } from '../compare/summary.js';
import type { EmailAddress, EmailDraft } from './eml.js';
import { POLICY_TYPE_LABELS } from './labels.js';
import { clientEmail, insurerEmail } from './templates/emailTemplates.js';

export interface EmailInput {
  runDate: IsoDate;
  client: Client;
  broker: Broker;
  policy: Policy;
  diffs: readonly TermDiff[];
  flags: readonly Flag[];
  summary: Summary;
}

export interface EmailDrafts {
  client: EmailDraft;
  insurer: EmailDraft;
}

/** 'Bellbird Mutual Assurance Ltd' -> 'bellbird-mutual-assurance-ltd' (ASCII only). */
function addressSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'insurer'
  );
}

/** Placeholder insurer address on the reserved example.com domain (synthetic project; D-056). */
export function insurerPlaceholderAddress(insurerName: string): EmailAddress {
  return { name: insurerName, email: `renewals+${addressSlug(insurerName)}@example.com` };
}

const MEDIUM_RANK = SEVERITIES.indexOf('medium');

export function buildEmails(input: EmailInput): EmailDrafts {
  const from: EmailAddress = { name: input.broker.name, email: input.broker.email };
  const policyTypeLabel = POLICY_TYPE_LABELS[input.policy.type];
  const client = clientEmail({
    contactName: input.client.contactName,
    brokerName: input.broker.name,
    policyTypeLabel,
    insurerName: input.policy.insurerName,
    expiryDate: input.policy.expiryDate,
    headline: input.summary.headline,
    hasChanges: input.diffs.length > 0,
  });
  const insurer = insurerEmail({
    clientName: input.client.name,
    brokerName: input.broker.name,
    policyTypeLabel,
    expiryDate: input.policy.expiryDate,
    flags: input.flags.filter((flag) => SEVERITIES.indexOf(flag.severity) >= MEDIUM_RANK),
    diffs: input.diffs,
  });
  return {
    client: { from, to: { name: input.client.contactName, email: input.client.contactEmail }, subject: client.subject, body: client.body, runDate: input.runDate },
    insurer: { from, to: insurerPlaceholderAddress(input.policy.insurerName), subject: insurer.subject, body: insurer.body, runDate: input.runDate },
  };
}
