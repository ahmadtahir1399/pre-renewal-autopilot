// Builds the content of one policy document (expiring policy or renewal offer)
// as four fixed pages of blocks. Rendering to PDF happens in pdfWriter.ts.
// FIXED LAYOUT: page 1 schedule, page 2 cover sections, page 3 conditions, page 4 exclusions.

import { addDays, addYears, formatLongDate } from '../../src/domain/dates.js';
import { EXCLUSION_KEYS } from '../../src/domain/schemas.js';
import type { ExclusionKey, IsoDate, PolicyType } from '../../src/domain/types.js';
import {
  BROKERAGE_NAME,
  CLIENT_ADDRESSES,
  CLIENTS,
  CONDITIONS,
  COVER_LIMIT_LABELS,
  COVER_SECTIONS,
  EXCLUSION_CATALOG,
  INSURERS,
  POLICY_TYPE_CODES,
  POLICY_TYPE_LABELS,
} from './catalog.js';
import { formatNzd } from './format.js';
import { createRng } from './rng.js';
import { FIXTURE_SEED, REFERENCE_DATE, type ScenarioSpec } from './scenarios.js';

export const PAGE_COUNT = 4;
export const SCHEDULE_PAGE = 1;
export const CONDITIONS_PAGE = 3;
export const EXCLUSIONS_PAGE = 4;

export type DocumentKind = 'expiring' | 'renewal';

export type Block =
  | { kind: 'title'; text: string }
  | { kind: 'subtitle'; text: string }
  | { kind: 'heading'; text: string }
  /** A single unwrapped line. Schedule rows use this so each quote stays on one line. */
  | { kind: 'line'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'spacer' };

export interface DocumentPage {
  blocks: Block[];
}

/** One schedule fact: its value and the exact printed line (the answer-key quote). */
export interface PrintedFact<T> {
  value: T;
  line: string;
}

export interface PrintedExclusion {
  key: ExclusionKey;
  title: string;
  text: string;
  wordingIndex: number;
}

export interface BuiltDocument {
  kind: DocumentKind;
  policyId: string;
  pages: DocumentPage[];
  schedule: {
    insurerName: PrintedFact<string>;
    policyNumber: PrintedFact<string>;
    policyType: PrintedFact<PolicyType>;
    periodStart: PrintedFact<IsoDate>;
    periodEnd: PrintedFact<IsoDate>;
    annualPremium: PrintedFact<number>;
    excess: PrintedFact<number>;
    coverLimit: PrintedFact<number>;
  };
  exclusions: PrintedExclusion[];
  footerLabel: string;
}

/** Per-policy random choices. Drawn in a fixed order so every run is identical. */
interface PolicyChoices {
  policyNumber: string;
  exclusionWording: Record<ExclusionKey, number>;
  coverWording: number[];
  conditionWording: number[];
}

function choicesFor(spec: ScenarioSpec): PolicyChoices {
  const rng = createRng(`${FIXTURE_SEED}/${spec.policyId}`);
  const insurer = INSURERS[spec.insurerIndex];
  if (!insurer) throw new Error(`No insurer at index ${spec.insurerIndex}`);
  const policyNumber = `${insurer.code}-${POLICY_TYPE_CODES[spec.type]}-${rng.int(100000, 999999)}`;
  const exclusionWording = {} as Record<ExclusionKey, number>;
  for (const key of EXCLUSION_KEYS) {
    exclusionWording[key] = rng.int(0, EXCLUSION_CATALOG[key].wordings.length - 1);
  }
  const coverWording = COVER_SECTIONS[spec.type].map(() => rng.int(0, 1));
  const conditionWording = CONDITIONS.map(() => rng.int(0, 1));
  return { policyNumber, exclusionWording, coverWording, conditionWording };
}

export function expiryDateOf(spec: ScenarioSpec): IsoDate {
  return addDays(REFERENCE_DATE, spec.days);
}

/** Expiring period: one year ending on expiryDate. Renewal: starts expiryDate + offset, runs one year. */
export function periodFor(spec: ScenarioSpec, kind: DocumentKind): { start: IsoDate; end: IsoDate } {
  const expiry = expiryDateOf(spec);
  if (kind === 'expiring') {
    return { start: addDays(addYears(expiry, -1), 1), end: expiry };
  }
  const start = addDays(expiry, spec.renewalStartOffsetDays);
  return { start, end: addDays(addYears(start, 1), -1) };
}

function pick(pair: [string, string, string], index: number | undefined): string {
  return index === 1 ? pair[2] : pair[1];
}

export function buildDocument(spec: ScenarioSpec, kind: DocumentKind): BuiltDocument {
  const choices = choicesFor(spec);
  const insurer = INSURERS[spec.insurerIndex];
  const client = CLIENTS[spec.clientIndex];
  if (!insurer || !client) throw new Error(`Bad insurer or client index for ${spec.id}`);
  const terms = kind === 'expiring' ? spec.expiring : spec.renewal;
  const period = periodFor(spec, kind);
  const limitLabel = COVER_LIMIT_LABELS[spec.type];
  const issueDate = kind === 'expiring' ? addDays(period.start, -14) : addDays(REFERENCE_DATE, -14);

  const schedule: BuiltDocument['schedule'] = {
    insurerName: { value: insurer.name, line: `Insurer: ${insurer.name}` },
    policyNumber: { value: choices.policyNumber, line: `Policy number: ${choices.policyNumber}` },
    policyType: { value: spec.type, line: `Policy type: ${POLICY_TYPE_LABELS[spec.type]}` },
    periodStart: { value: period.start, line: `Period start: ${formatLongDate(period.start)}` },
    periodEnd: { value: period.end, line: `Period end: ${formatLongDate(period.end)}` },
    annualPremium: {
      value: terms.premium,
      line: `Annual premium (excl. GST): ${formatNzd(terms.premium, 2)}`,
    },
    excess: { value: terms.excess, line: `Excess: ${formatNzd(terms.excess, 0)} each and every claim` },
    coverLimit: {
      value: terms.coverLimit,
      line: `${limitLabel.label}: ${formatNzd(terms.coverLimit, 0)}${limitLabel.suffix}`,
    },
  };

  const exclusions: PrintedExclusion[] = terms.exclusions.map((key) => {
    const base = choices.exclusionWording[key];
    const count = EXCLUSION_CATALOG[key].wordings.length;
    const reword = kind === 'renewal' && spec.rewordInRenewal.includes(key);
    const wordingIndex = reword ? (base + 1) % count : base;
    const wording = EXCLUSION_CATALOG[key].wordings[wordingIndex];
    if (!wording) throw new Error(`No wording ${wordingIndex} for ${key}`);
    return { key, title: wording.title, text: wording.text, wordingIndex };
  });

  const page1: Block[] = [
    { kind: 'title', text: kind === 'expiring' ? 'POLICY SCHEDULE' : 'RENEWAL OFFER - POLICY SCHEDULE' },
    { kind: 'subtitle', text: `${insurer.name} - ${POLICY_TYPE_LABELS[spec.type]} Insurance` },
    { kind: 'spacer' },
    {
      kind: 'paragraph',
      text:
        kind === 'expiring'
          ? 'This schedule forms part of your policy wording and must be read together with it.'
          : 'We are pleased to offer renewal of this policy on the terms set out below. This offer is not a confirmation of cover until it has been accepted.',
    },
    { kind: 'spacer' },
    { kind: 'heading', text: 'Section 1 - Policy schedule' },
    { kind: 'line', text: schedule.insurerName.line },
    { kind: 'line', text: schedule.policyNumber.line },
    { kind: 'line', text: schedule.policyType.line },
    { kind: 'line', text: `Insured: ${client.name}` },
    { kind: 'line', text: `Situation: ${CLIENT_ADDRESSES[client.id] ?? 'Kestrel Bay'}` },
    { kind: 'line', text: `Broker: ${BROKERAGE_NAME}` },
    { kind: 'line', text: schedule.periodStart.line },
    { kind: 'line', text: schedule.periodEnd.line },
    { kind: 'line', text: schedule.annualPremium.line },
    { kind: 'line', text: schedule.excess.line },
    { kind: 'line', text: schedule.coverLimit.line },
    { kind: 'spacer' },
    { kind: 'line', text: `Date of issue: ${formatLongDate(issueDate)}` },
  ];

  const page2: Block[] = [{ kind: 'heading', text: 'Section 2 - What is covered' }];
  COVER_SECTIONS[spec.type].forEach((section, index) => {
    page2.push({ kind: 'heading', text: `2.${index + 1} ${section[0]}` });
    page2.push({ kind: 'paragraph', text: pick(section, choices.coverWording[index]) });
  });

  const page3: Block[] = [{ kind: 'heading', text: 'Section 3 - General conditions' }];
  CONDITIONS.forEach((condition, index) => {
    page3.push({ kind: 'heading', text: `3.${index + 1} ${condition[0]}` });
    page3.push({ kind: 'paragraph', text: pick(condition, choices.conditionWording[index]) });
    // S14: the injected instruction sits in plain body text in the middle of page 3.
    if (condition[0] === 'Disclosure' && spec.injectedInstruction !== null) {
      page3.push({ kind: 'paragraph', text: spec.injectedInstruction });
    }
  });

  const page4: Block[] = [
    { kind: 'heading', text: 'Section 4 - Exclusions' },
    {
      kind: 'paragraph',
      text: 'The following exclusions apply to this policy in addition to any exclusion stated elsewhere in the policy wording.',
    },
  ];
  exclusions.forEach((exclusion, index) => {
    page4.push({ kind: 'heading', text: `4.${index + 1} ${exclusion.title}` });
    page4.push({ kind: 'paragraph', text: exclusion.text });
  });

  return {
    kind,
    policyId: spec.policyId,
    pages: [{ blocks: page1 }, { blocks: page2 }, { blocks: page3 }, { blocks: page4 }],
    schedule,
    exclusions,
    footerLabel: `Policy number ${choices.policyNumber}`,
  };
}
