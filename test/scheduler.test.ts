import { describe, expect, it } from 'vitest';
import { manualInstantClock } from '../src/domain/dates.js';
import { DailyScheduler, nextRunAt, type Timer, zonedParts, zonedTimeToUtc } from '../src/pipeline/scheduler.js';

const NZ = 'Pacific/Auckland';
const HOUR = 3_600_000;

/** Fake timer driven by a manual clock: advanceTo() fires due callbacks in time order. */
function fakeTimer(clock: ReturnType<typeof manualInstantClock>) {
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timer: Timer = {
    setTimeout(fn, ms) {
      const id = ++seq;
      pending.set(id, { at: clock.now().getTime() + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  async function advanceTo(iso: string) {
    const target = new Date(iso).getTime();
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      clock.set(new Date(due[1].at).toISOString());
      due[1].fn();
      await new Promise((resolve) => setImmediate(resolve));
    }
    clock.set(new Date(target).toISOString());
  }
  return { timer, advanceTo, pendingCount: () => pending.size };
}

describe('time-zone arithmetic', () => {
  it('converts NZ wall-clock time to UTC in summer and winter', () => {
    expect(zonedTimeToUtc('2026-10-19', '07:00', NZ).toISOString()).toBe('2026-10-18T18:00:00.000Z'); // NZDT +13
    expect(zonedTimeToUtc('2026-07-01', '07:00', NZ).toISOString()).toBe('2026-06-30T19:00:00.000Z'); // NZST +12
    expect(zonedParts(new Date('2026-10-18T18:00:00Z'), NZ)).toEqual({ date: '2026-10-19', hour: 7, minute: 0, second: 0 });
  });

  it('finds the next 07:00 run strictly after now', () => {
    expect(nextRunAt(new Date('2026-10-18T17:59:59Z'), '07:00', NZ).toISOString()).toBe('2026-10-18T18:00:00.000Z');
    expect(nextRunAt(new Date('2026-10-18T18:00:00Z'), '07:00', NZ).toISOString()).toBe('2026-10-19T18:00:00.000Z');
  });

  it('handles the DST changeover days (clocks forward 27 Sep 2026, back 4 Apr 2027)', () => {
    const before = nextRunAt(new Date('2026-09-25T20:00:00Z'), '07:00', NZ); // after 07:00 NZST on 26 Sep
    expect(before.toISOString()).toBe('2026-09-26T18:00:00.000Z'); // 27 Sep 07:00 NZDT
    expect(before.getTime() - new Date('2026-09-25T19:00:00Z').getTime()).toBe(23 * HOUR); // the short day
    const after = nextRunAt(new Date('2027-04-02T19:00:00Z'), '07:00', NZ); // after 07:00 NZDT on 3 Apr
    expect(after.toISOString()).toBe('2027-04-03T19:00:00.000Z'); // 4 Apr 07:00 NZST
    expect(after.getTime() - new Date('2027-04-02T18:00:00Z').getTime()).toBe(25 * HOUR); // the long day
  });

  it('moves a non-existent local time (inside the spring-forward gap) to just after the gap', () => {
    const result = zonedTimeToUtc('2026-09-27', '02:30', NZ);
    expect(zonedParts(result, NZ).hour).toBe(3);
  });
});

describe('DailyScheduler', () => {
  it('fires once per day at 07:00 NZ time, across a DST changeover', async () => {
    const clock = manualInstantClock('2026-09-25T12:00:00Z');
    const { timer, advanceTo } = fakeTimer(clock);
    const fired: string[] = [];
    const scheduler = new DailyScheduler({ clock, timer, runTime: '07:00', timeZone: NZ, task: async (at) => void fired.push(at.toISOString()) });
    scheduler.start();
    await advanceTo('2026-09-28T12:00:00Z');
    expect(fired).toEqual(['2026-09-25T19:00:00.000Z', '2026-09-26T18:00:00.000Z', '2026-09-27T18:00:00.000Z']);
    await scheduler.stop();
  });

  it('skips (and reports) a tick while the previous run is still going', async () => {
    const clock = manualInstantClock('2026-10-18T12:00:00Z');
    const { timer, advanceTo } = fakeTimer(clock);
    let release: () => void = () => {};
    const skipped: string[] = [];
    let runs = 0;
    const scheduler = new DailyScheduler({
      clock,
      timer,
      runTime: '07:00',
      timeZone: NZ,
      task: () => {
        runs++;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      onOverlapSkipped: (at) => skipped.push(at.toISOString()),
    });
    scheduler.start();
    await advanceTo('2026-10-18T18:00:01Z');
    expect(runs).toBe(1);
    expect(scheduler.isRunning).toBe(true);
    await advanceTo('2026-10-19T18:00:01Z'); // next day, still running
    expect(runs).toBe(1);
    expect(skipped).toEqual(['2026-10-19T18:00:00.000Z']);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    await advanceTo('2026-10-20T18:00:01Z');
    expect(runs).toBe(2);
    release();
    await scheduler.stop();
  });

  it('stop() cancels the next tick', async () => {
    const clock = manualInstantClock('2026-10-18T12:00:00Z');
    const { timer, advanceTo, pendingCount } = fakeTimer(clock);
    let runs = 0;
    const scheduler = new DailyScheduler({ clock, timer, runTime: '07:00', timeZone: NZ, task: async () => void runs++ });
    scheduler.start();
    await scheduler.stop();
    expect(pendingCount()).toBe(0);
    await advanceTo('2026-10-20T00:00:00Z');
    expect(runs).toBe(0);
  });
});
