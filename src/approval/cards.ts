// Card text, built ONLY from stored data (pack diffs/flags, policy, client). Deterministic.
// Model free text never appears here, except the normalised title of an 'other' exclusion
// (already inside the deterministic diff sentences).

import { deriveOverallRisk } from '../compare/compareTerms.js';
import { daysBetween } from '../domain/dates.js';
import { clamp, cleanLine } from '../domain/text.js';
import type { Client, IsoDate, Pack, Policy } from '../domain/types.js';
import { POLICY_TYPE_LABELS } from '../outputs/labels.js';
import type { NoticeCard, PackCard } from './notifier.js';

/** Whole weeks, rounded down. */
export function weeksUntil(today: IsoDate, date: IsoDate): number {
  return Math.floor(daysBetween(today, date) / 7);
}

/**
 * U-3 (Prompt 7): uploaded cases ignore the 84-112 day window, so the date line must be honest for any date:
 * 'Renews in N weeks (date)' (whole weeks, rounded down), 'Renews in N days (date)' under a week,
 * 'Renews today (date)', 'Expired N days ago (date)'.
 */
export function renewalTimingLine(today: IsoDate, expiryDate: IsoDate): string {
  const days = daysBetween(today, expiryDate);
  if (days < 0) return `Expired ${-days} ${days === -1 ? 'day' : 'days'} ago (${expiryDate})`;
  if (days === 0) return `Renews today (${expiryDate})`;
  if (days < 7) return `Renews in ${days} ${days === 1 ? 'day' : 'days'} (${expiryDate})`;
  const weeks = Math.floor(days / 7);
  return `Renews in ${weeks} ${weeks === 1 ? 'week' : 'weeks'} (${expiryDate})`;
}

export const UPLOADED_CARD_LINE = 'Uploaded manually: analysed from documents the broker added.';

export function attentionLine(flagCount: number): string {
  if (flagCount === 0) return 'Nothing needs your eye';
  return `${flagCount} ${flagCount === 1 ? 'item needs' : 'items need'} your eye`;
}

export interface CardInput {
  packId: number;
  caseId: number;
  pack: Pack;
  policy: Policy;
  client: Client;
  today: IsoDate;
  /** The pack was prepared from uploaded documents (U-3 wording + an origin line). Default false = unchanged card. */
  uploaded?: boolean;
}

/** Telegram Bot API text limit, 1-4096 characters (read from the installed grammY types; VERIFY). */
const MAX_MESSAGE = 4096;

export function buildPackCard(input: CardInput): PackCard {
  const { pack, policy, client } = input;
  const risk = deriveOverallRisk(pack.diffs, pack.flags);
  // FIX (D-130): every line is one clean line and the whole text stays within the 4096-character limit.
  const title = `${cleanLine(client.name, 120)} - ${POLICY_TYPE_LABELS[policy.type]}${pack.version > 1 ? ` (version ${pack.version})` : ''}`;
  const changes =
    pack.diffs.length === 0
      ? ['No changes found between the expiring policy and the renewal offer.']
      : pack.diffs.slice(0, 3).map((diff) => cleanLine(`[${diff.severity.toUpperCase()}] ${diff.facts}`, 600));
  const lines = [
    input.uploaded ? renewalTimingLine(input.today, policy.expiryDate) : `Renews in ${weeksUntil(input.today, policy.expiryDate)} weeks (${policy.expiryDate})`,
    ...(input.uploaded ? [UPLOADED_CARD_LINE] : []),
    `Overall risk: ${risk.toUpperCase()}`,
    ...changes,
    attentionLine(pack.flags.length),
    'Draft only: nothing has been sent.',
  ];
  return { packId: input.packId, caseId: input.caseId, policyId: policy.id, version: pack.version, title, lines, text: clamp([title, ...lines].join('\n'), MAX_MESSAGE) };
}

export function buildNoticeCard(input: { caseId: number; policy: Policy; client: Client; reason: string }): NoticeCard {
  const text = [
    `${cleanLine(input.client.name, 120)} - ${POLICY_TYPE_LABELS[input.policy.type]}: needs attention`,
    `Reason: ${cleanLine(input.reason, 300)}.`,
    'No comparison was prepared. Please check the documents for this renewal by hand.',
  ].join('\n');
  return { caseId: input.caseId, policyId: input.policy.id, cause: input.reason, text };
}

export function buildReminderText(card: PackCard, waitingHours: number): string {
  return clamp(`Reminder: still waiting for your decision (${Math.floor(waitingHours / 24)} days).\n${card.text}`, MAX_MESSAGE);
}
