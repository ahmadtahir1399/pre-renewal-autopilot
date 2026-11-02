// OPTIONAL STUB. A Notion-backed DataSource is out of scope unless the user says
// "include Notion". Every method throws so nothing can silently depend on it.
//
// DESIGN NOTE - Notion API details to VERIFY in the current official Notion docs
// before building this (deliberately not guessed here):
//  1. Authentication: integration token type, required headers (incl. any API version
//     header), and how the integration is granted access to a database.
//  2. Database query: endpoint, filter/sort syntax, pagination fields and page size limits.
//  3. Page property update: how to set a select/status property (used ONLY for the renewal
//     status, keeping the one-write rule), and the exact property value shape.
//  4. File attachment download: how file properties expose URLs, whether those URLs expire,
//     and how to download them safely to a local cache for PDF reading.
//  Also verify rate limits and error codes, and keep the token in .env only (never logged).

import type { Broker, Client, Policy, RenewalStatus } from '../domain/types.js';
import type { DataSource, DocumentPaths } from './datasource.js';

const NOT_IMPLEMENTED = 'NotionSource is not implemented (optional; see the design note in src/data/notionSource.ts)';

export class NotionSource implements DataSource {
  async listPolicies(): Promise<Policy[]> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getPolicy(_id: string): Promise<Policy | undefined> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getClient(_id: string): Promise<Client | undefined> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getBroker(_id: string): Promise<Broker | undefined> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async getDocumentPaths(_policyId: string): Promise<DocumentPaths> {
    throw new Error(NOT_IMPLEMENTED);
  }
  async updateRenewalStatus(_policyId: string, _status: RenewalStatus): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  }
}
