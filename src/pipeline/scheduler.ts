// Daily scheduler for `serve`: runs at RUN_TIME in TIMEZONE (e.g. 07:00 Pacific/Auckland).
// Approach (D-065): a small setTimeout loop, no dependency. Time-zone offsets come from the
// runtime's IANA data via Intl.DateTimeFormat (used only to read the zone's wall clock; no
// locale-dependent formatting). Alternatives: croner, node-cron (VERIFY their IANA/DST handling).
// Everything is driven by an injected clock and timer so tests use fakes.

import { addDays, type InstantClock } from '../domain/dates.js';
import type { IsoDate } from '../domain/types.js';

export interface ZonedParts {
  date: IsoDate;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const date = `${String(value('year')).padStart(4, '0')}-${String(value('month')).padStart(2, '0')}-${String(value('day')).padStart(2, '0')}`;
  return { date, hour: value('hour'), minute: value('minute'), second: value('second') };
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const [y = 0, m = 1, d = 1] = p.date.split('-').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant when the wall clock in timeZone shows `date time`. If that local time does not exist
 * (spring-forward gap), the result falls just after the gap.
 */
export function zonedTimeToUtc(date: IsoDate, time: string, timeZone: string): Date {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(new Date(guess), timeZone);
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

/** The next run strictly after `now`. */
export function nextRunAt(now: Date, runTime: string, timeZone: string): Date {
  const today = zonedParts(now, timeZone).date;
  const candidate = zonedTimeToUtc(today, runTime, timeZone);
  return candidate.getTime() > now.getTime() ? candidate : zonedTimeToUtc(addDays(today, 1), runTime, timeZone);
}

export interface Timer {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realTimer: Timer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SchedulerOptions {
  clock: InstantClock;
  timer: Timer;
  runTime: string;
  timeZone: string;
  /** The daily job. The scheduler never runs two at once. */
  task: (scheduledFor: Date) => Promise<void>;
  /** Called when a tick arrives while the previous run is still going (the tick is skipped). */
  onOverlapSkipped?: (scheduledFor: Date) => void;
  onError?: (error: unknown) => void;
  log?: (line: string) => void;
}

export class DailyScheduler {
  private handle: unknown = null;
  private running: Promise<void> | null = null;
  private stopped = true;

  constructor(private readonly options: SchedulerOptions) {}

  /** Schedule the next run and return its time. */
  start(): Date {
    this.stopped = false;
    return this.scheduleNext();
  }

  private scheduleNext(): Date {
    const now = this.options.clock.now();
    const next = nextRunAt(now, this.options.runTime, this.options.timeZone);
    // setTimeout delays above ~24.8 days overflow; a daily schedule never gets close.
    this.handle = this.options.timer.setTimeout(() => this.tick(next), Math.max(0, next.getTime() - now.getTime()));
    this.options.log?.(`Next scheduled run: ${next.toISOString()} (${this.options.runTime} ${this.options.timeZone})`);
    return next;
  }

  private tick(scheduledFor: Date): void {
    if (this.stopped) return;
    if (this.running) {
      this.options.onOverlapSkipped?.(scheduledFor);
    } else {
      this.running = this.options
        .task(scheduledFor)
        .catch((error: unknown) => this.options.onError?.(error))
        .finally(() => {
          this.running = null;
        });
    }
    this.scheduleNext();
  }

  /** True while a scheduled run is in progress. */
  get isRunning(): boolean {
    return this.running !== null;
  }

  /** Stop scheduling; resolves when an in-flight run has finished (or after timeoutMs). */
  async stop(timeoutMs = 60_000): Promise<void> {
    this.stopped = true;
    if (this.handle !== null) this.options.timer.clearTimeout(this.handle);
    this.handle = null;
    if (this.running) {
      await Promise.race([this.running, new Promise<void>((resolve) => this.options.timer.setTimeout(resolve, timeoutMs))]);
    }
  }
}
