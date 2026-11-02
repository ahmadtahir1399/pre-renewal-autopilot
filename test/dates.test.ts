import { describe, expect, it } from 'vitest';
import {
  addDays,
  addYears,
  cycleKey,
  daysBetween,
  fixedClock,
  formatLongDate,
  isValidIsoDate,
  isWithinWindow,
  parseIsoDate,
  systemClock,
} from '../src/domain/dates.js';

const REFERENCE_DATE = '2026-10-19';

describe('parseIsoDate / isValidIsoDate', () => {
  it('accepts real dates and rejects everything else', () => {
    expect(parseIsoDate('2026-10-19')).toBe('2026-10-19');
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
    expect(isValidIsoDate('2026-10-19T00:00:00Z')).toBe(false);
    expect(isValidIsoDate('19/10/2026')).toBe(false);
    expect(isValidIsoDate('2026-1-9')).toBe(false);
    expect(() => parseIsoDate('2026-02-30')).toThrow(RangeError);
  });

  it('knows leap years (including century rules)', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2000-02-29')).toBe(true);
    expect(isValidIsoDate('1900-02-29')).toBe(false);
  });
});

describe('daysBetween', () => {
  it('counts whole days, signed', () => {
    expect(daysBetween(REFERENCE_DATE, REFERENCE_DATE)).toBe(0);
    expect(daysBetween(REFERENCE_DATE, '2026-10-20')).toBe(1);
    expect(daysBetween('2026-10-20', REFERENCE_DATE)).toBe(-1);
  });

  it('handles leap years', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1);
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366);
    expect(daysBetween('2027-01-01', '2028-01-01')).toBe(365);
  });

  it('is not affected by daylight saving changes (NZ DST starts 2026-09-27, ends 2027-04-04)', () => {
    expect(daysBetween('2026-09-26', '2026-09-28')).toBe(2);
    expect(daysBetween('2027-04-03', '2027-04-05')).toBe(2);
  });
});

describe('addDays / addYears', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01');
  });

  it('matches the scenario expiry dates computed from the reference date', () => {
    expect(addDays(REFERENCE_DATE, 84)).toBe('2027-01-11');
    expect(addDays(REFERENCE_DATE, 90)).toBe('2027-01-17');
    expect(addDays(REFERENCE_DATE, 112)).toBe('2027-02-08');
    expect(addDays(REFERENCE_DATE, 140)).toBe('2027-03-08');
  });

  it('rejects fractional days', () => {
    expect(() => addDays(REFERENCE_DATE, 1.5)).toThrow(RangeError);
  });

  it('clamps 29 February when adding years', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
    expect(addYears('2026-10-19', 1)).toBe('2027-10-19');
    expect(addYears('2027-01-17', -1)).toBe('2026-01-17');
  });
});

describe('isWithinWindow (inclusive 84..112)', () => {
  const inWindow = (days: number) => isWithinWindow(REFERENCE_DATE, addDays(REFERENCE_DATE, days), 84, 112);

  it('includes exactly 84 days (12 weeks)', () => {
    expect(inWindow(84)).toBe(true);
  });

  it('includes exactly 112 days (16 weeks)', () => {
    expect(inWindow(112)).toBe(true);
  });

  it('excludes 83 and 113 days', () => {
    expect(inWindow(83)).toBe(false);
    expect(inWindow(113)).toBe(false);
  });

  it('excludes the past and far future', () => {
    expect(inWindow(-90)).toBe(false);
    expect(inWindow(140)).toBe(false);
    expect(inWindow(0)).toBe(false);
  });

  it('works with literal boundary dates', () => {
    expect(isWithinWindow(REFERENCE_DATE, '2027-01-11', 84, 112)).toBe(true);
    expect(isWithinWindow(REFERENCE_DATE, '2027-02-08', 84, 112)).toBe(true);
    expect(isWithinWindow(REFERENCE_DATE, '2027-01-10', 84, 112)).toBe(false);
    expect(isWithinWindow(REFERENCE_DATE, '2027-02-09', 84, 112)).toBe(false);
  });
});

describe('cycleKey', () => {
  it('joins policy id and expiry date', () => {
    expect(cycleKey('pol-s01', '2027-01-17')).toBe('pol-s01:2027-01-17');
  });

  it('rejects bad input', () => {
    expect(() => cycleKey('pol-s01', '2027-02-30')).toThrow(RangeError);
    expect(() => cycleKey('', '2027-01-17')).toThrow(RangeError);
    expect(() => cycleKey('pol:s01', '2027-01-17')).toThrow(RangeError);
  });
});

describe('formatLongDate', () => {
  it('formats for documents', () => {
    expect(formatLongDate('2027-01-17')).toBe('17 January 2027');
    expect(formatLongDate('2028-02-29')).toBe('29 February 2028');
  });
});

describe('Clock', () => {
  it('fixedClock returns the injected date', () => {
    expect(fixedClock(REFERENCE_DATE).today()).toBe(REFERENCE_DATE);
    expect(() => fixedClock('not-a-date')).toThrow(RangeError);
  });

  it('systemClock uses the given time zone, not the computer local time', () => {
    // 2026-10-19 12:30 UTC is already 2026-10-20 01:30 in Auckland (NZDT, UTC+13).
    const late = systemClock('Pacific/Auckland', () => new Date('2026-10-19T12:30:00Z'));
    expect(late.today()).toBe('2026-10-20');
    const early = systemClock('Pacific/Auckland', () => new Date('2026-10-19T10:00:00Z'));
    expect(early.today()).toBe('2026-10-19');
    const utc = systemClock('UTC', () => new Date('2026-10-19T12:30:00Z'));
    expect(utc.today()).toBe('2026-10-19');
  });
});
