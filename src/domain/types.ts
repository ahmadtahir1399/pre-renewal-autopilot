// Shared domain vocabulary for Pre-Renewal Autopilot.
// These names are fixed after Prompt 1; later prompts rely on them exactly.
// Runtime validation lives in schemas.ts; both files must stay in sync
// (schemas.ts contains compile-time checks that fail if they drift).

import type {
  ATTENTION_REASONS,
  CHANGE_KINDS,
  CONFIDENCE_LEVELS,
  EXCLUSION_KEYS,
  POLICY_TYPES,
  RENEWAL_STATUSES,
  SELECTION_SKIP_REASONS,
  SEVERITIES,
} from './schemas.js';

/** Calendar date as an ISO string 'yyyy-mm-dd'. Never carries a time of day. */
export type IsoDate = string;

export type PolicyType = (typeof POLICY_TYPES)[number];
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];
export type ExclusionKey = (typeof EXCLUSION_KEYS)[number];
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface Client {
  id: string;
  name: string;
  contactName: string;
  contactEmail: string;
}

export interface Broker {
  id: string;
  name: string;
  email: string;
  telegramChatId?: string;
}

/** Addition (D-005): fixtures list insurers as their own records. Names only, no logos. */
export interface Insurer {
  id: string;
  name: string;
}

export interface Policy {
  id: string;
  clientId: string;
  brokerId: string;
  insurerName: string;
  type: PolicyType;
  /** ISO yyyy-mm-dd. The last day of the expiring period of insurance. */
  expiryDate: IsoDate;
  annualPremium: number;
  status: RenewalStatus;
  /** Project-root relative path with forward slashes (D-007). */
  expiringDocPath?: string;
  /** Project-root relative path with forward slashes (D-007). */
  renewalDocPath?: string;
}

/** One extracted fact. value is null when not found; never guessed. */
export interface Fact<T> {
  value: T | null;
  sourcePage: number | null;
  sourceQuote: string | null;
  confidence: Confidence;
}

export interface KeyExclusion {
  key: ExclusionKey;
  title: string;
  summary: string;
  sourcePage: number;
}

export interface ExtractedTerms {
  insurerName: Fact<string>;
  policyNumber: Fact<string>;
  policyType: Fact<PolicyType>;
  periodStart: Fact<IsoDate>;
  periodEnd: Fact<IsoDate>;
  annualPremium: Fact<number>;
  excess: Fact<number>;
  coverLimit: Fact<number>;
  keyExclusions: KeyExclusion[];
}

/** A value on one side of a TermDiff. Numbers are NZD amounts; strings are names, dates or exclusion keys. */
export type DiffValue = string | number | null;

export interface TermDiff {
  /** 'insurerName' | 'periodStart' | 'annualPremium' | 'excess' | 'coverLimit' | 'exclusion:<key>' (D-008). */
  field: string;
  expiring: DiffValue;
  renewal: DiffValue;
  change: ChangeKind;
  severity: Severity;
  /** Plain-English statement of the computed facts. Written by code, not the AI. */
  facts: string;
  expiringPage?: number;
  renewalPage?: number;
}

/** Addition to the guide's plan (D-003): something a broker must look at. See D-C. */
export interface Flag {
  field: string;
  severity: Severity;
  message: string;
}

export interface Pack {
  cycleKey: string;
  version: number;
  policyId: string;
  diffs: TermDiff[];
  flags: Flag[];
  xlsxPath: string;
  clientEmlPath: string;
  insurerEmlPath: string;
  summaryText: string;
  contentHash: string;
  /** ISO 8601 UTC timestamp, e.g. 2026-10-19T18:00:00.000Z. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Fixture-only types (additions, D-006). Used by the answer keys and seed state.
// ---------------------------------------------------------------------------

export type SelectionSkipReason = (typeof SELECTION_SKIP_REASONS)[number];
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export interface SeedStateRecord {
  policyId: string;
  cycleKey: string;
  status: 'approved';
}

export interface SeedState {
  records: SeedStateRecord[];
}

export interface GroundTruthDocument {
  /** Project-root relative path, or null when the document does not exist. */
  path: string | null;
  exists: boolean;
  /** null when the document does not exist. */
  hasTextLayer: boolean | null;
}

export interface GroundTruth {
  schemaVersion: 1;
  scenarioId: string;
  policyId: string;
  description: string;
  referenceDate: IsoDate;
  expiryDate: IsoDate;
  daysToExpiry: number;
  cycleKey: string;
  expectedSelection: {
    selected: boolean;
    skipReason: SelectionSkipReason | null;
  };
  documents: {
    expiring: GroundTruthDocument;
    renewal: GroundTruthDocument;
  };
  /** null for a document that is missing or has no text layer. */
  expectedTerms: {
    expiring: ExtractedTerms | null;
    renewal: ExtractedTerms | null;
  };
  expectedAttention: {
    reason: AttentionReason;
    message: string;
  } | null;
  expectsPack: boolean;
  /** null when no pack is expected (not selected, already processed, or needs attention). */
  expectedDiffs: TermDiff[] | null;
  expectedFlags: Flag[] | null;
  expectedOverallRisk: Severity | null;
  expectedFinalStatus: RenewalStatus;
  /** S14 only: the injected sentence and its page. */
  injectedInstruction: {
    page: number;
    text: string;
  } | null;
}
