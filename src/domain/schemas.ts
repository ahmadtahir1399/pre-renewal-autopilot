// Zod schemas for every domain type, plus parse helpers that throw clear errors.
// The constant arrays below are the single source of truth for each enum;
// types.ts derives its union types from them.

import { z } from 'zod';
import { isValidIsoDate } from './dates.js';
import { DomainValidationError } from './errors.js';
import type {
  Broker,
  Client,
  ExtractedTerms,
  Fact,
  Flag,
  GroundTruth,
  Insurer,
  KeyExclusion,
  Pack,
  Policy,
  SeedState,
  TermDiff,
} from './types.js';

// ---------------------------------------------------------------------------
// Fixed vocabularies
// ---------------------------------------------------------------------------

export const POLICY_TYPES = ['commercial_property', 'public_liability', 'business_interruption'] as const;

export const RENEWAL_STATUSES = [
  'not_started',
  'drafted',
  'needs_attention',
  'in_review',
  'approved',
  'skipped',
] as const;

/** The fixed exclusion vocabulary. Comparison is by key, never by wording. */
export const EXCLUSION_KEYS = [
  'flood',
  'earthquake',
  'wear_and_tear',
  'gradual_deterioration',
  'theft_unattended_premises',
  'vacant_or_unoccupied_building',
  'cyber_event',
  'terrorism',
  'pollution',
  'asbestos',
  'subsidence_landslip',
  'contractual_liability',
  'professional_advice',
  'other',
] as const;

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

/** Ordered from least to most severe. */
export const SEVERITIES = ['info', 'low', 'medium', 'high'] as const;

export const CHANGE_KINDS = ['unchanged', 'increased', 'decreased', 'added', 'removed', 'changed'] as const;

export const SELECTION_SKIP_REASONS = ['outside_window', 'already_processed'] as const;

export const ATTENTION_REASONS = ['renewal_document_missing', 'expiring_document_unreadable'] as const;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const IsoDateSchema = z
  .string()
  .refine(isValidIsoDate, { message: 'must be a real calendar date in yyyy-mm-dd format' });

export const PolicyTypeSchema = z.enum(POLICY_TYPES);
export const RenewalStatusSchema = z.enum(RENEWAL_STATUSES);
export const ExclusionKeySchema = z.enum(EXCLUSION_KEYS);
export const ConfidenceSchema = z.enum(CONFIDENCE_LEVELS);
export const SeveritySchema = z.enum(SEVERITIES);
export const ChangeKindSchema = z.enum(CHANGE_KINDS);

const NonEmptyString = z.string().trim().min(1, { message: 'must not be empty' });
const PageNumber = z.number().int().min(1);
const Amount = z.number().finite().nonnegative();
/** Synthetic data rule: every email address uses the reserved example.com domain. */
const ExampleEmail = z.email().refine((value) => value.toLowerCase().endsWith('@example.com'), {
  message: 'must be an @example.com address (synthetic data only)',
});

/**
 * Fact<T> schema. Rules enforced:
 * - a found value (not null) must carry a source page (non-negotiable rule 2);
 * - a missing value (null) must have confidence 'low' (flagged, never guessed).
 */
export function factSchema<T extends z.ZodType>(valueSchema: T) {
  return z
    .object({
      value: valueSchema.nullable(),
      sourcePage: PageNumber.nullable(),
      sourceQuote: z.string().nullable(),
      confidence: ConfidenceSchema,
    })
    .superRefine((parsed, ctx) => {
      // Zod cannot carry the generic `value` key through inference here; the shape is fixed above.
      const fact = parsed as unknown as { value: unknown; sourcePage: number | null; confidence: string };
      if (fact.value !== null && fact.sourcePage === null) {
        ctx.addIssue({ code: 'custom', message: 'a found value must have a sourcePage', path: ['sourcePage'] });
      }
      if (fact.value === null && fact.confidence !== 'low') {
        ctx.addIssue({ code: 'custom', message: "a missing value must have confidence 'low'", path: ['confidence'] });
      }
    });
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export const ClientSchema = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
  contactName: NonEmptyString,
  contactEmail: ExampleEmail,
});

export const BrokerSchema = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
  email: ExampleEmail,
  telegramChatId: NonEmptyString.optional(),
});

export const InsurerSchema = z.object({
  id: NonEmptyString,
  name: NonEmptyString,
});

export const PolicySchema = z.object({
  id: NonEmptyString,
  clientId: NonEmptyString,
  brokerId: NonEmptyString,
  insurerName: NonEmptyString,
  type: PolicyTypeSchema,
  expiryDate: IsoDateSchema,
  annualPremium: Amount,
  status: RenewalStatusSchema,
  expiringDocPath: NonEmptyString.optional(),
  renewalDocPath: NonEmptyString.optional(),
});

export const KeyExclusionSchema = z.object({
  key: ExclusionKeySchema,
  title: NonEmptyString,
  summary: NonEmptyString,
  sourcePage: PageNumber,
});

export const ExtractedTermsSchema = z.object({
  insurerName: factSchema(NonEmptyString),
  policyNumber: factSchema(NonEmptyString),
  policyType: factSchema(PolicyTypeSchema),
  periodStart: factSchema(IsoDateSchema),
  periodEnd: factSchema(IsoDateSchema),
  annualPremium: factSchema(Amount),
  excess: factSchema(Amount),
  coverLimit: factSchema(Amount),
  keyExclusions: z.array(KeyExclusionSchema),
});

const DiffValueSchema = z.union([z.string(), z.number().finite(), z.null()]);

export const TermDiffSchema = z.object({
  field: NonEmptyString,
  expiring: DiffValueSchema,
  renewal: DiffValueSchema,
  change: ChangeKindSchema,
  severity: SeveritySchema,
  facts: NonEmptyString,
  expiringPage: PageNumber.optional(),
  renewalPage: PageNumber.optional(),
});

export const FlagSchema = z.object({
  field: NonEmptyString,
  severity: SeveritySchema,
  message: NonEmptyString,
});

export const PackSchema = z.object({
  cycleKey: NonEmptyString,
  version: z.number().int().min(1),
  policyId: NonEmptyString,
  diffs: z.array(TermDiffSchema),
  flags: z.array(FlagSchema),
  xlsxPath: NonEmptyString,
  clientEmlPath: NonEmptyString,
  insurerEmlPath: NonEmptyString,
  summaryText: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/, { message: 'must be a lowercase hex SHA-256' }),
  createdAt: z.iso.datetime(),
});

// ---------------------------------------------------------------------------
// Fixture-only schemas (D-006)
// ---------------------------------------------------------------------------

export const SeedStateSchema = z.object({
  records: z.array(
    z.object({
      policyId: NonEmptyString,
      cycleKey: NonEmptyString,
      status: z.literal('approved'),
    }),
  ),
});

const GroundTruthDocumentSchema = z.object({
  path: NonEmptyString.nullable(),
  exists: z.boolean(),
  hasTextLayer: z.boolean().nullable(),
});

export const GroundTruthSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenarioId: z.string().regex(/^S\d{2}$/),
    policyId: z.string().regex(/^pol-s\d{2}$/),
    description: NonEmptyString,
    referenceDate: IsoDateSchema,
    expiryDate: IsoDateSchema,
    daysToExpiry: z.number().int(),
    cycleKey: NonEmptyString,
    expectedSelection: z.object({
      selected: z.boolean(),
      skipReason: z.enum(SELECTION_SKIP_REASONS).nullable(),
    }),
    documents: z.object({
      expiring: GroundTruthDocumentSchema,
      renewal: GroundTruthDocumentSchema,
    }),
    expectedTerms: z.object({
      expiring: ExtractedTermsSchema.nullable(),
      renewal: ExtractedTermsSchema.nullable(),
    }),
    expectedAttention: z
      .object({
        reason: z.enum(ATTENTION_REASONS),
        message: NonEmptyString,
      })
      .nullable(),
    expectsPack: z.boolean(),
    expectedDiffs: z.array(TermDiffSchema).nullable(),
    expectedFlags: z.array(FlagSchema).nullable(),
    expectedOverallRisk: SeveritySchema.nullable(),
    expectedFinalStatus: RenewalStatusSchema,
    injectedInstruction: z
      .object({
        page: PageNumber,
        text: NonEmptyString,
      })
      .nullable(),
  })
  .superRefine((gt, ctx) => {
    const packFields = [gt.expectedDiffs, gt.expectedFlags, gt.expectedOverallRisk];
    if (gt.expectsPack && packFields.some((field) => field === null)) {
      ctx.addIssue({ code: 'custom', message: 'expectsPack requires diffs, flags and overallRisk' });
    }
    if (!gt.expectsPack && packFields.some((field) => field !== null)) {
      ctx.addIssue({ code: 'custom', message: 'no pack expected, so diffs, flags and overallRisk must be null' });
    }
    if (gt.expectedSelection.selected !== (gt.expectedSelection.skipReason === null)) {
      ctx.addIssue({ code: 'custom', message: 'skipReason must be null exactly when selected is true' });
    }
  });

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/** One readable line per problem: "<label>.<path>: <message>". */
export function formatIssues(label: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return `${path ? `${label}.${path}` : label}: ${issue.message}`;
  });
}

/** Parse or throw a DomainValidationError that lists every problem. */
export function parseWith<T extends z.ZodType>(schema: T, data: unknown, label: string): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new DomainValidationError(label, formatIssues(label, result.error));
  }
  return result.data;
}

export const parseClient = (data: unknown, label = 'client'): Client => parseWith(ClientSchema, data, label);
export const parseBroker = (data: unknown, label = 'broker'): Broker => parseWith(BrokerSchema, data, label);
export const parseInsurer = (data: unknown, label = 'insurer'): Insurer => parseWith(InsurerSchema, data, label);
export const parsePolicy = (data: unknown, label = 'policy'): Policy => parseWith(PolicySchema, data, label);
export const parseExtractedTerms = (data: unknown, label = 'extractedTerms'): ExtractedTerms =>
  parseWith(ExtractedTermsSchema, data, label);
export const parseTermDiff = (data: unknown, label = 'termDiff'): TermDiff => parseWith(TermDiffSchema, data, label);
export const parseFlag = (data: unknown, label = 'flag'): Flag => parseWith(FlagSchema, data, label);
export const parsePack = (data: unknown, label = 'pack'): Pack => parseWith(PackSchema, data, label);
export const parseSeedState = (data: unknown, label = 'seedState'): SeedState =>
  parseWith(SeedStateSchema, data, label);
export const parseGroundTruth = (data: unknown, label = 'groundTruth'): GroundTruth =>
  parseWith(GroundTruthSchema, data, label);

export const parseClients = (data: unknown, label = 'clients'): Client[] => parseWith(z.array(ClientSchema), data, label);
export const parseBrokers = (data: unknown, label = 'brokers'): Broker[] => parseWith(z.array(BrokerSchema), data, label);
export const parseInsurers = (data: unknown, label = 'insurers'): Insurer[] =>
  parseWith(z.array(InsurerSchema), data, label);
export const parsePolicies = (data: unknown, label = 'policies'): Policy[] =>
  parseWith(z.array(PolicySchema), data, label);

// ---------------------------------------------------------------------------
// Compile-time drift checks: typecheck fails if a schema and its type disagree.
// ---------------------------------------------------------------------------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type SchemaTypeChecks = [
  Assert<Same<z.infer<typeof ClientSchema>, Client>>,
  Assert<Same<z.infer<typeof BrokerSchema>, Broker>>,
  Assert<Same<z.infer<typeof InsurerSchema>, Insurer>>,
  Assert<Same<z.infer<typeof PolicySchema>, Policy>>,
  Assert<Same<z.infer<ReturnType<typeof factSchema<z.ZodNumber>>>, Fact<number>>>,
  Assert<Same<z.infer<typeof KeyExclusionSchema>, KeyExclusion>>,
  Assert<Same<z.infer<typeof ExtractedTermsSchema>, ExtractedTerms>>,
  Assert<Same<z.infer<typeof TermDiffSchema>, TermDiff>>,
  Assert<Same<z.infer<typeof FlagSchema>, Flag>>,
  Assert<Same<z.infer<typeof PackSchema>, Pack>>,
  Assert<Same<z.infer<typeof SeedStateSchema>, SeedState>>,
  Assert<Same<z.infer<typeof GroundTruthSchema>, GroundTruth>>,
];
