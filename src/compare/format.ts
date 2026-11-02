// Deterministic sentence building. One function per field type; the SAME sentences
// are used for TermDiff.facts, the summary, the spreadsheet and the emails.
// Hand-written number formatting: no Intl, no locale, no currency symbols.

import type { ExclusionKey, IsoDate } from '../domain/types.js';

/** Fixed broker-facing label per exclusion key. Model-written titles are never used (except 'other'). */
export const EXCLUSION_LABELS: Record<ExclusionKey, string> = {
  flood: 'Flood',
  earthquake: 'Earthquake',
  wear_and_tear: 'Wear and tear',
  gradual_deterioration: 'Gradual deterioration',
  theft_unattended_premises: 'Theft from unattended premises',
  vacant_or_unoccupied_building: 'Vacant or unoccupied buildings',
  cyber_event: 'Cyber events',
  terrorism: 'Terrorism',
  pollution: 'Pollution',
  asbestos: 'Asbestos',
  subsidence_landslip: 'Subsidence and landslip',
  contractual_liability: 'Contractual liability',
  professional_advice: 'Professional advice',
  other: 'Other exclusion',
};

/** Broker-facing names for compared fields. */
export const FIELD_LABELS: Record<string, string> = {
  insurerName: 'Insurer',
  policyNumber: 'Policy number',
  policyType: 'Policy type',
  periodStart: 'Period start',
  periodEnd: 'Period end',
  annualPremium: 'Annual premium',
  excess: 'Excess',
  coverLimit: 'Cover limit',
};

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 12400 -> '12,400'; 13144.5 -> '13,144.50'; -555 -> '-555'.
 * Whole numbers show no decimals; anything else shows exactly two.
 */
export function formatAmount(value: number): string {
  const sign = value < 0 ? '-' : '';
  const cents = Math.round(Math.abs(value) * 100);
  const whole = groupThousands(String(Math.floor(cents / 100)));
  const fraction = cents % 100;
  return fraction === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
}

/** Signed change: '+744', '-5,000,000'. */
export function formatSignedAmount(delta: number): string {
  return `${delta < 0 ? '-' : '+'}${formatAmount(Math.abs(delta))}`;
}

/**
 * Percent change to one decimal, computed with integer arithmetic on cents
 * (round half away from zero). Returns e.g. '+6.0', '-50.0'. expiring must not be 0.
 */
export function formatPercentChange(expiring: number, renewal: number): string {
  const from = Math.round(expiring * 100);
  const delta = Math.round(renewal * 100) - from;
  const numerator = Math.abs(delta) * 1000; // tenths of a percent
  const tenths = Math.floor((2 * numerator + from) / (2 * from));
  const sign = delta < 0 ? '-' : '+';
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** 'other' exclusions are compared and shown by this normalised title. */
export function normaliseTitle(title: string): string {
  return (
    title
      // biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately strips control characters from untrusted titles
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      // Prompt 7 (D-114): bidirectional embedding / override / isolate controls can make hostile text read backwards.
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  );
}

const direction = (from: number, to: number) => (to > from ? 'increases' : 'decreases');

export function premiumSentence(from: number, to: number): string {
  return `Annual premium ${direction(from, to)} from ${formatAmount(from)} to ${formatAmount(to)} (${formatSignedAmount(to - from)}, ${formatPercentChange(from, to)} percent).`;
}

export function excessSentence(from: number, to: number): string {
  return `Excess ${direction(from, to)} from ${formatAmount(from)} to ${formatAmount(to)} (${formatSignedAmount(to - from)}).`;
}

export function coverLimitSentence(from: number, to: number): string {
  const percent = from === 0 ? '' : `, ${formatPercentChange(from, to)} percent`;
  return `Cover limit ${direction(from, to)} from ${formatAmount(from)} to ${formatAmount(to)} (${formatSignedAmount(to - from)}${percent}).`;
}

export function insurerSentence(from: string, to: string): string {
  return `Insurer changes from ${from} to ${to}.`;
}

/**
 * Period continuity. offsetDays = days from (expiring end + 1) to renewal start.
 * Positive = days without cover; negative = overlapping days.
 */
export function periodSentence(expiringEnd: IsoDate, continuousStart: IsoDate, renewalStart: IsoDate, offsetDays: number): string {
  if (offsetDays > 0) {
    return `Renewal period starts ${renewalStart}, ${offsetDays + 1} days after the expiring period ends on ${expiringEnd}; continuous cover would start ${continuousStart}, leaving a gap of ${offsetDays} days without cover.`;
  }
  return `Renewal period starts ${renewalStart}, ${Math.abs(offsetDays)} days before continuous cover would start (${continuousStart}); the expiring period ends ${expiringEnd}, so the periods overlap by ${Math.abs(offsetDays)} days.`;
}

export function exclusionAddedSentence(key: ExclusionKey, page: number | undefined): string {
  return `New exclusion in the renewal: ${EXCLUSION_LABELS[key]}${page === undefined ? '' : ` (renewal page ${page})`}.`;
}

export function exclusionRemovedSentence(key: ExclusionKey, page: number | undefined): string {
  return `Exclusion no longer in the renewal: ${EXCLUSION_LABELS[key]}${page === undefined ? '' : ` (expiring page ${page})`}.`;
}

export function otherExclusionSentence(change: 'added' | 'removed', normalisedTitle: string, page: number | undefined): string {
  const where = page === undefined ? '' : ` (${change === 'added' ? 'renewal' : 'expiring'} page ${page})`;
  return change === 'added'
    ? `New exclusion in the renewal that is not in the standard list: "${normalisedTitle}"${where}.`
    : `Exclusion not in the standard list is no longer in the renewal: "${normalisedTitle}"${where}.`;
}

/** Human field name for a diff/flag field id ('exclusion:flood' -> 'Exclusion: Flood'). */
export function describeField(field: string): string {
  if (field.startsWith('exclusion:other:')) return `Exclusion (other): ${field.slice('exclusion:other:'.length)}`;
  if (field.startsWith('exclusion:')) {
    const key = field.slice('exclusion:'.length) as ExclusionKey;
    return `Exclusion: ${EXCLUSION_LABELS[key] ?? key}`;
  }
  return FIELD_LABELS[field] ?? field;
}

export function needsCheckSentence(field: string, sides: string): string {
  return `Needs human check: ${describeField(field).toLowerCase()} is missing or uncertain in the ${sides} document, so no difference was calculated.`;
}

export function zeroPremiumSentence(): string {
  return 'Needs human check: the expiring annual premium is zero, so a percentage change cannot be calculated.';
}
