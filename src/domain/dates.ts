// Date-only helpers. Dates are ISO 'yyyy-mm-dd' strings with no time of day.
// Internally a date becomes a whole "day number" computed with Date.UTC, so
// local time zones and daylight saving can never shift a result.

import type { IsoDate } from './types.js';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function splitIsoDate(value: string): DateParts | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month (UTC, so no DST effects).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function fromParts(parts: DateParts): IsoDate {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

function toDayNumber(value: IsoDate): number {
  const { year, month, day } = toParts(value);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromDayNumber(dayNumber: number): IsoDate {
  const date = new Date(dayNumber * MS_PER_DAY);
  return fromParts({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

function toParts(value: IsoDate): DateParts {
  const parts = splitIsoDate(value);
  if (!parts || !isRealDate(parts)) {
    throw new RangeError(`Invalid ISO date "${value}": expected a real calendar date as yyyy-mm-dd`);
  }
  return parts;
}

function isRealDate({ year, month, day }: DateParts): boolean {
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** True when value is a real calendar date in yyyy-mm-dd format (e.g. rejects 2026-02-29). */
export function isValidIsoDate(value: string): boolean {
  const parts = splitIsoDate(value);
  return parts !== null && isRealDate(parts);
}

/** Validate and return an ISO date. Throws RangeError for anything else. */
export function parseIsoDate(value: string): IsoDate {
  return fromParts(toParts(value));
}

/** Whole days from a to b (positive when b is later). daysBetween('2026-10-19', '2027-01-11') === 84. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

/** Add (or subtract, with a negative n) whole days. */
export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new RangeError(`addDays expects a whole number of days, got ${days}`);
  return fromDayNumber(toDayNumber(date) + days);
}

/**
 * Add whole years. 29 February becomes 28 February in a non-leap target year.
 * Addition (D-009): used for one-year periods of insurance.
 */
export function addYears(date: IsoDate, years: number): IsoDate {
  if (!Number.isInteger(years)) throw new RangeError(`addYears expects a whole number of years, got ${years}`);
  const { year, month, day } = toParts(date);
  const targetYear = year + years;
  return fromParts({ year: targetYear, month, day: Math.min(day, daysInMonth(targetYear, month)) });
}

/** True when expiry is between minDays and maxDays after today, both bounds INCLUSIVE. */
export function isWithinWindow(today: IsoDate, expiry: IsoDate, minDays: number, maxDays: number): boolean {
  const days = daysBetween(today, expiry);
  return days >= minDays && days <= maxDays;
}

/** One renewal cycle per policy per expiry date: "<policyId>:<expiryDate>". */
export function cycleKey(policyId: string, expiryDate: IsoDate): string {
  if (policyId.trim() === '' || policyId.includes(':')) {
    throw new RangeError(`Invalid policyId "${policyId}" for cycleKey: must be non-empty and contain no ':'`);
  }
  return `${policyId}:${parseIsoDate(expiryDate)}`;
}

/** Human date for documents and messages: '2027-01-17' -> '17 January 2027'. Addition (D-009). */
export function formatLongDate(date: IsoDate): string {
  const { year, month, day } = toParts(date);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** Source of "today". Inject fixedClock in tests and when REFERENCE_DATE is set. */
export interface Clock {
  today(): IsoDate;
}

export function fixedClock(date: IsoDate): Clock {
  const today = parseIsoDate(date);
  return { today: () => today };
}

/**
 * Today's calendar date in the given IANA time zone (e.g. Pacific/Auckland),
 * independent of the computer's local time zone.
 */
export function systemClock(timeZone: string, now: () => Date = () => new Date()): Clock {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return {
    today() {
      const parts = formatter.formatToParts(now());
      const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
      return fromParts({ year: get('year'), month: get('month'), day: get('day') });
    },
  };
}

/**
 * ADDITION (D-060): source of the current INSTANT (timestamps for audit rows, runs, reminders).
 * Inject it everywhere; tests use fixedInstantClock or a manual clock. Clock (above) stays date-only.
 */
export interface InstantClock {
  now(): Date;
}

export const systemInstantClock: InstantClock = { now: () => new Date() };

/** A clock that tests can move forward by hand. */
export function manualInstantClock(startIso: string): InstantClock & { advance(ms: number): void; set(iso: string): void } {
  let current = new Date(startIso).getTime();
  if (Number.isNaN(current)) throw new RangeError(`Invalid instant "${startIso}"`);
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
    set: (iso: string) => {
      current = new Date(iso).getTime();
    },
  };
}
