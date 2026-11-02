// DataSource backed by the JSON fixtures. Fixture files are NEVER modified:
// renewal-status changes go to a small overlay file under the writable data
// directory and are merged on every read (getPolicy and listPolicies).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DataSourceError } from '../domain/errors.js';
import {
  parseBrokers,
  parseClients,
  parsePolicies,
  parseWith,
  RenewalStatusSchema,
} from '../domain/schemas.js';
import type { Broker, Client, Policy, RenewalStatus } from '../domain/types.js';
import type { DataSource, DocumentPaths } from './datasource.js';

export interface LocalJsonSourceOptions {
  /** Read-only fixtures root containing data/ and documents/ (env FIXTURES_DIR). */
  fixturesDir: string;
  /** Writable data directory (env DATA_DIR). The overlay lives at <dataDir>/runtime/status-overlay.json. */
  dataDir: string;
}

const OverlaySchema = z.object({
  version: z.literal(1),
  statuses: z.record(z.string(), RenewalStatusSchema),
});
type Overlay = z.infer<typeof OverlaySchema>;

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export class LocalJsonSource implements DataSource {
  private readonly fixturesDir: string;
  readonly overlayPath: string;

  constructor(options: LocalJsonSourceOptions) {
    this.fixturesDir = path.resolve(options.fixturesDir);
    this.overlayPath = path.join(path.resolve(options.dataDir), 'runtime', 'status-overlay.json');
    // Guard (D-028): the one write must never land inside the read-only fixtures.
    if (isInside(this.overlayPath, this.fixturesDir)) {
      throw new DataSourceError(
        `The status overlay (${this.overlayPath}) must not be inside the fixtures directory (${this.fixturesDir})`,
      );
    }
    // Note: the constructor creates nothing. Only updateRenewalStatus writes.
  }

  async listPolicies(): Promise<Policy[]> {
    const overlay = this.readOverlay();
    return this.readPolicies().map((policy) => applyOverlay(policy, overlay));
  }

  async getPolicy(id: string): Promise<Policy | undefined> {
    const policy = this.readPolicies().find((p) => p.id === id);
    return policy ? applyOverlay(policy, this.readOverlay()) : undefined;
  }

  async getClient(id: string): Promise<Client | undefined> {
    return parseClients(this.readJson('clients.json'), 'clients.json').find((c) => c.id === id);
  }

  async getBroker(id: string): Promise<Broker | undefined> {
    return parseBrokers(this.readJson('brokers.json'), 'brokers.json').find((b) => b.id === id);
  }

  async getDocumentPaths(policyId: string): Promise<DocumentPaths> {
    if (!/^[a-z0-9-]+$/i.test(policyId)) throw new DataSourceError(`Invalid policy id "${policyId}"`);
    const result: DocumentPaths = {};
    for (const kind of ['expiring', 'renewal'] as const) {
      const filePath = path.join(this.fixturesDir, 'documents', policyId, `${kind}.pdf`);
      if (existsSync(filePath)) result[kind] = filePath;
    }
    return result;
  }

  /** THE ONLY WRITE: records a status in the overlay (atomic write: temp file, then rename). */
  async updateRenewalStatus(policyId: string, status: RenewalStatus): Promise<void> {
    if (!this.readPolicies().some((p) => p.id === policyId)) {
      throw new DataSourceError(`Cannot update status: unknown policy "${policyId}"`);
    }
    const validStatus = parseWith(RenewalStatusSchema, status, 'status');
    const overlay = this.readOverlay();
    const next: Overlay = { version: 1, statuses: { ...overlay.statuses, [policyId]: validStatus } };
    mkdirSync(path.dirname(this.overlayPath), { recursive: true });
    const tempPath = `${this.overlayPath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(tempPath, this.overlayPath);
  }

  private readPolicies(): Policy[] {
    return parsePolicies(this.readJson('policies.json'), 'policies.json');
  }

  private readJson(fileName: string): unknown {
    const filePath = path.join(this.fixturesDir, 'data', fileName);
    try {
      return JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
      throw new DataSourceError(`Cannot read ${filePath}`, { cause: error });
    }
  }

  private readOverlay(): Overlay {
    if (!existsSync(this.overlayPath)) return { version: 1, statuses: {} };
    try {
      return parseWith(OverlaySchema, JSON.parse(readFileSync(this.overlayPath, 'utf8')), 'status-overlay');
    } catch (error) {
      throw new DataSourceError(`Cannot read status overlay ${this.overlayPath}`, { cause: error });
    }
  }
}

function applyOverlay(policy: Policy, overlay: Overlay): Policy {
  const status = overlay.statuses[policy.id];
  return status === undefined ? policy : { ...policy, status };
}
