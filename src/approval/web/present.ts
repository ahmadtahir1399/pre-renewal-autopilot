// Plain-English presentation helpers for the approval page. Pure, deterministic, no locale or clock:
// dates use the hand-written formatLongDate, amounts the hand-written formatAmount. Nothing here
// computes a new number; values are stored ones, shown in words.

import { describeField, EXCLUSION_LABELS, formatAmount } from '../../compare/format.js';
import { formatLongDate, isValidIsoDate } from '../../domain/dates.js';
import type { ChangeKind, DiffValue, RenewalStatus, TermDiff } from '../../domain/types.js';

export const STATUS_LABELS: Record<RenewalStatus, string> = {
  not_started: 'Not started',
  drafted: 'Drafted',
  needs_attention: 'Needs attention',
  in_review: 'In review',
  approved: 'Approved',
  skipped: 'Skipped',
};

export function statusLabel(status: string): string {
  return (STATUS_LABELS as Record<string, string>)[status] ?? 'Unknown';
}

/** '2026-10-19T17:51:10.123Z' -> '19 October 2026, 17:51 UTC'. String slicing only (no Date locale). */
export function formatInstant(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match || !isValidIsoDate(match[1] as string)) return 'Unknown time';
  return `${formatLongDate(match[1] as string)}, ${match[2]}:${match[3]} UTC`;
}

/** '... on 18 October 2026 at 18:00 UTC'. */
export function formatOnAt(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match || !isValidIsoDate(match[1] as string)) return 'at an unknown time';
  return `on ${formatLongDate(match[1] as string)} at ${match[2]}:${match[3]} UTC`;
}

const CHANNELS: Record<string, string> = { web: 'web page', cli: 'command line', telegram: 'Telegram' };

export function channelLabel(channel: string): string {
  return CHANNELS[channel] ?? 'unknown channel';
}

/** Audit actor -> who did it, in words. */
export function actorLabel(actor: string, approverName: string): string {
  if (actor === 'system') return 'Autopilot';
  if (actor === 'broker:web') return `${approverName} (web page)`;
  if (actor === 'broker:cli') return `${approverName} (command line)`;
  if (actor.startsWith('broker:telegram:')) return `${approverName} (Telegram)`;
  return 'Unknown';
}

/** "Approved by <name> on <date> at <time> UTC (web page)". */
export function decisionSentence(action: 'approve' | 'skip', approverName: string, at: string, channel: string): string {
  return `${action === 'approve' ? 'Approved' : 'Skipped'} by ${approverName} ${formatOnAt(at)} (${channelLabel(channel)})`;
}

const ATTENTION_SENTENCES: Record<string, string> = {
  'renewal document missing': 'The renewal document is missing.',
  'expiring document missing': 'The expiring policy document is missing.',
  'document has no readable text (image-only scan)': 'One of the documents is a scanned image with no readable text.',
  'the AI reader returned invalid output': 'The AI reader could not read the documents reliably. The next run will try again.',
};

/** Stored attention reason -> one plain sentence. Unknown reasons never echo their text. */
export function attentionSentence(reason: string | null): string {
  if (reason && ATTENTION_SENTENCES[reason]) return ATTENTION_SENTENCES[reason] as string;
  if (reason?.startsWith('unexpected error')) return 'Something unexpected went wrong while preparing this renewal. The next run will try again.';
  return 'This renewal needs a manual check.';
}

const CHANGE_WORDS: Record<ChangeKind, string> = {
  unchanged: 'Unchanged',
  increased: 'Increased',
  decreased: 'Decreased',
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
};

export function changeWord(change: string): string {
  return (CHANGE_WORDS as Record<string, string>)[change] ?? 'Changed';
}

/** Row label for a diff field. The period rule compares continuity, so it is called "Cover period". */
export function fieldLabel(field: string): string {
  return field === 'periodStart' ? 'Cover period' : describeField(field);
}

/** A stored diff value in words: amounts with thousands separators, ISO dates long, exclusion keys labelled. */
export function displayValue(diff: TermDiff, side: 'expiring' | 'renewal'): string {
  const value: DiffValue = diff[side];
  if (value === null) return diff.field.startsWith('exclusion:') ? 'Not in this policy' : 'Not found';
  if (typeof value === 'number') return formatAmount(value);
  if (diff.field === 'periodStart' && isValidIsoDate(value)) {
    return side === 'expiring' ? `Ends ${formatLongDate(value)}` : `Starts ${formatLongDate(value)}`;
  }
  if (diff.field.startsWith('exclusion:') && !diff.field.startsWith('exclusion:other:') && value in EXCLUSION_LABELS) {
    return `Present: ${EXCLUSION_LABELS[value as keyof typeof EXCLUSION_LABELS]}`;
  }
  if (diff.field.startsWith('exclusion:other:')) return `Present: "${value}"`;
  return value;
}

/** Source pages for a diff, one entry per side that has one. */
export function sourcePages(diff: TermDiff): string[] {
  const pages: string[] = [];
  if (diff.expiringPage !== undefined) pages.push(`Expiring page ${diff.expiringPage}`);
  if (diff.renewalPage !== undefined) pages.push(`Renewal page ${diff.renewalPage}`);
  return pages;
}

/** U-3 (Prompt 7), uploaded packs only: 'in 6 weeks', 'in 5 days', 'today', 'expired 10 days ago'. */
export function timingText(daysUntil: number): string {
  if (daysUntil < 0) return `expired ${plural(-daysUntil, 'day', 'days')} ago`;
  if (daysUntil === 0) return 'today';
  if (daysUntil < 7) return `in ${plural(daysUntil, 'day', 'days')}`;
  const weeks = Math.floor(daysUntil / 7);
  return `in ${plural(weeks, 'week', 'weeks')}`;
}

/** Whole weeks until renewal, in words. */
export function weeksText(weeks: number): string {
  if (weeks <= 0) return 'this week';
  return `in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
