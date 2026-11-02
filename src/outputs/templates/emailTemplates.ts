// Editable wording for the two DRAFT emails. Bump TEMPLATE_VERSION when wording changes
// (Prompt 4 includes it in each pack's input hash).
//
// Rules: friendly, plain English, short. Only facts from the deterministic comparison.
// The CLIENT email gives no insurance advice, makes no promises and states no risk level.
// Numbered lists are avoided on purpose: list numbers would look like unchecked figures.

import { describeField, EXCLUSION_LABELS, formatAmount } from '../../compare/format.js';
import { formatLongDate } from '../../domain/dates.js';
import type { ExclusionKey, Flag, TermDiff } from '../../domain/types.js';

export const TEMPLATE_VERSION = 't1';

export const FOOTER_PLACEHOLDER = '[Brokerage name and contact details]';

export interface ClientEmailContext {
  contactName: string;
  brokerName: string;
  policyTypeLabel: string;
  insurerName: string;
  expiryDate: string;
  /** Up to three sentences from buildSummary().headline. */
  headline: string[];
  hasChanges: boolean;
}

export interface InsurerEmailContext {
  clientName: string;
  brokerName: string;
  policyTypeLabel: string;
  expiryDate: string;
  /** HIGH and MEDIUM flags, in priority order. */
  flags: readonly Flag[];
  diffs: readonly TermDiff[];
}

export interface EmailText {
  subject: string;
  body: string;
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function signOff(brokerName: string): string[] {
  return ['Kind regards,', brokerName, FOOTER_PLACEHOLDER];
}

export function clientEmail(ctx: ClientEmailContext): EmailText {
  const changes = ctx.hasChanges
    ? [
        'We have received the renewal offer and compared it with your current policy. The main changes are:',
        '',
        ...ctx.headline.map((line) => `- ${line}`),
      ]
    : ['We have received the renewal offer and compared it with your current policy. We found no changes to the main terms.'];
  const body = [
    `Hi ${firstName(ctx.contactName)},`,
    '',
    `Your ${ctx.policyTypeLabel} insurance with ${ctx.insurerName} is due for renewal on ${formatLongDate(ctx.expiryDate)}.`,
    '',
    ...changes,
    '',
    'Has anything changed in your business since the policy started? For example your premises, the work you do, your turnover or the value of your equipment. Please let us know so we can take it into account before the renewal.',
    '',
    'We will be in touch once we have reviewed the renewal terms with you in mind.',
    '',
    ...signOff(ctx.brokerName),
  ].join('\n');
  return { subject: `Your ${ctx.policyTypeLabel} insurance renewal - ${formatLongDate(ctx.expiryDate)}`, body };
}

/** One specific question per HIGH/MEDIUM flag, using only the computed values. */
export function questionFor(flag: Flag, diffs: readonly TermDiff[]): string {
  const diff = diffs.find((d) => d.field === flag.field);
  if (!diff) {
    return `Please confirm the ${describeField(flag.field).toLowerCase()} in the renewal offer, as we could not confirm it from the documents.`;
  }
  const amount = (value: string | number | null) => (typeof value === 'number' ? formatAmount(value) : String(value));
  const moved = diff.change === 'increased' ? 'increased' : 'reduced';
  if (diff.field === 'annualPremium') return `Please confirm the reason the annual premium has ${moved} from ${amount(diff.expiring)} to ${amount(diff.renewal)}.`;
  if (diff.field === 'excess') return `Please confirm the reason the excess has ${moved} from ${amount(diff.expiring)} to ${amount(diff.renewal)}.`;
  if (diff.field === 'coverLimit') return `Please confirm the reason the cover limit has ${moved} from ${amount(diff.expiring)} to ${amount(diff.renewal)}.`;
  if (diff.field === 'insurerName') return `Please confirm the insurer for the renewal: the renewal offer names ${diff.renewal}, while the current policy is with ${diff.expiring}.`;
  if (diff.field === 'periodStart') return `Please confirm the renewal start date: the renewal offer starts on ${diff.renewal}, but the current policy ends on ${diff.expiring}.`;
  if (diff.field.startsWith('exclusion:other:')) {
    const title = diff.field.slice('exclusion:other:'.length);
    return diff.change === 'added'
      ? `Please explain the new exclusion "${title}" in the renewal offer.`
      : `Please confirm that the exclusion "${title}" has been removed from the renewal offer.`;
  }
  if (diff.field.startsWith('exclusion:')) {
    const label = EXCLUSION_LABELS[diff.field.slice('exclusion:'.length) as ExclusionKey];
    return diff.change === 'added'
      ? `Please confirm the reason the ${label} exclusion has been added to the renewal.`
      : `Please confirm that the ${label} exclusion has been removed from the renewal.`;
  }
  return `Please confirm the change to the ${describeField(diff.field).toLowerCase()}.`;
}

export function insurerEmail(ctx: InsurerEmailContext): EmailText {
  const questions = ctx.flags.map((flag) => `- ${questionFor(flag, ctx.diffs)}`);
  const ask =
    questions.length > 0
      ? ['Before we discuss it with our client, please could you help with the following:', '', ...questions]
      : ['Please confirm the renewal terms set out in your renewal offer so we can present them to our client.'];
  const body = [
    'Hello,',
    '',
    `We are reviewing the renewal offer for ${ctx.clientName} (${ctx.policyTypeLabel}, current period ending ${formatLongDate(ctx.expiryDate)}).`,
    '',
    ...ask,
    '',
    'Thank you.',
    '',
    ...signOff(ctx.brokerName),
  ].join('\n');
  return { subject: `Renewal query - ${ctx.clientName} - ${ctx.policyTypeLabel} - ${formatLongDate(ctx.expiryDate)}`, body };
}
