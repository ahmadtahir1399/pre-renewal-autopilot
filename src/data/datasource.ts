// The door to the brokerage data. Everything that reads clients, brokers or
// policies goes through this interface so the source can be swapped later
// (local JSON today; a Notion adapter is stubbed).
//
// ACCESS RULE (non-negotiable rule 4): the data source is READ-ONLY except for
// ONE write, updateRenewalStatus. No other method may create, change or delete
// any data, and no other code may write to the underlying store.

import type { Broker, Client, Policy, RenewalStatus } from '../domain/types.js';

/** Absolute paths of a policy's documents. A key is absent when that file does not exist. */
export interface DocumentPaths {
  expiring?: string;
  renewal?: string;
}

export interface DataSource {
  /** Every policy, with any renewal-status change already applied. */
  listPolicies(): Promise<Policy[]>;
  /** One policy with any status change applied, or undefined if the id is unknown. */
  getPolicy(id: string): Promise<Policy | undefined>;
  getClient(id: string): Promise<Client | undefined>;
  getBroker(id: string): Promise<Broker | undefined>;
  /** Paths only for documents that exist. A missing file is undefined, never an error. */
  getDocumentPaths(policyId: string): Promise<DocumentPaths>;
  /** THE ONLY WRITE. Changes nothing but the renewal status of one policy. */
  updateRenewalStatus(policyId: string, status: RenewalStatus): Promise<void>;
}
