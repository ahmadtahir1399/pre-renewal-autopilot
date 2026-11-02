// A DataSource wrapper that also resolves MANUAL records (policies 'man-...', clients 'mcl-...') from the
// database, so the approval page, the dispatcher and the approval core can show manual cases (Prompt 7, D-F).
// It never writes anything. U-1: updateRenewalStatus for a manual policy is refused (there is no record to update).
// listPolicies() returns ONLY the data source's policies, so the nightly run never selects a manual case.

import type { DataSource, DocumentPaths } from '../data/datasource.js';
import type { Broker, Client, Policy, RenewalStatus } from '../domain/types.js';
import type { Db } from '../state/db.js';
import { all } from '../state/db.js';
import { getManualClient, getManualPolicy, listManualPolicies, type ManualPolicyRow } from './repo.js';

export const MANUAL_POLICY_PREFIX = 'man-';
export const MANUAL_CLIENT_PREFIX = 'mcl-';
/** Draft-only placeholders when the broker gave no contact details (synthetic, D-012). */
export const DEFAULT_CONTACT_NAME = 'Client contact';
export const DEFAULT_CONTACT_EMAIL = 'client@example.com';

export function isManualPolicyId(id: string): boolean {
  return id.startsWith(MANUAL_POLICY_PREFIX);
}

export class ManualPolicyWriteError extends Error {
  readonly code = 'manual_policy_write';
  constructor() {
    super('A manual case has no data-source record; the renewal status is kept in the database only (U-1).');
    this.name = 'ManualPolicyWriteError';
  }
}

function caseStatusFor(db: Db, policyId: string): RenewalStatus {
  const row = all(db, 'SELECT status FROM cases WHERE policy_id = ? ORDER BY id DESC LIMIT 1', policyId)[0];
  return row ? (String(row.status) as RenewalStatus) : 'not_started';
}

export function manualPolicyToPolicy(db: Db, row: ManualPolicyRow): Policy {
  return {
    id: row.policyId,
    clientId: row.clientId,
    brokerId: row.brokerId,
    insurerName: row.insurerName,
    type: row.type,
    expiryDate: row.expiryDate,
    // The Policy shape needs a number; an unread premium is stored as null and shown as 0 here only
    // (the comparison uses the extracted facts, never this field).
    annualPremium: row.annualPremium ?? 0,
    status: caseStatusFor(db, row.policyId),
  };
}

export class ManualAwareSource implements DataSource {
  constructor(
    private readonly inner: DataSource,
    private readonly db: Db,
  ) {}

  listPolicies(): Promise<Policy[]> {
    return this.inner.listPolicies();
  }

  /** Manual policies only (for the upload page and the overview). */
  async listManualPolicies(): Promise<Policy[]> {
    return listManualPolicies(this.db).map((row) => manualPolicyToPolicy(this.db, row));
  }

  async getPolicy(id: string): Promise<Policy | undefined> {
    if (!isManualPolicyId(id)) return this.inner.getPolicy(id);
    const row = getManualPolicy(this.db, id);
    return row ? manualPolicyToPolicy(this.db, row) : undefined;
  }

  async getClient(id: string): Promise<Client | undefined> {
    if (!id.startsWith(MANUAL_CLIENT_PREFIX)) return this.inner.getClient(id);
    const row = getManualClient(this.db, id);
    if (!row) return undefined;
    return { id: row.id, name: row.name, contactName: row.contactName ?? DEFAULT_CONTACT_NAME, contactEmail: row.contactEmail ?? DEFAULT_CONTACT_EMAIL };
  }

  getBroker(id: string): Promise<Broker | undefined> {
    return this.inner.getBroker(id);
  }

  /** A manual policy has no data-source documents; its documents are the stored uploads. */
  async getDocumentPaths(policyId: string): Promise<DocumentPaths> {
    if (isManualPolicyId(policyId)) return {};
    return this.inner.getDocumentPaths(policyId);
  }

  async updateRenewalStatus(policyId: string, status: RenewalStatus): Promise<void> {
    if (isManualPolicyId(policyId)) throw new ManualPolicyWriteError();
    return this.inner.updateRenewalStatus(policyId, status);
  }
}
