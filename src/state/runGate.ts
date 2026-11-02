// One pipeline run OR one upload analysis at a time (Prompt 7, D-096).
// acquireLock (lockFile.ts) only stops OTHER processes: it takes over a lock held by its own PID. Inside one
// `serve` process the scheduler and an upload analysis share the PID, so this gate also remembers which lock
// files THIS process holds and refuses a second holder with RunGateBusyError.

import { acquireLock, type Lock, LockHeldError, type LockOptions } from './lockFile.js';

const heldInProcess = new Set<string>();

/** The gate is held by this same process (an analysis or a run is already in progress here). */
export class RunGateBusyError extends LockHeldError {
  constructor(lockPath: string) {
    super(lockPath, process.pid);
    this.name = 'RunGateBusyError';
    this.message = 'An analysis or a pipeline run is already in progress in this process.';
  }
}

export function acquireRunGate(lockPath: string, options: LockOptions = {}): Lock {
  if (heldInProcess.has(lockPath)) throw new RunGateBusyError(lockPath);
  const lock = acquireLock(lockPath, options);
  heldInProcess.add(lockPath);
  let released = false;
  return {
    path: lock.path,
    release() {
      if (released) return;
      released = true;
      heldInProcess.delete(lockPath);
      lock.release();
    },
  };
}

/** For a scheduled run: wait (polling) while THIS process is busy, up to maxWaitMs. Other errors are rethrown. */
export async function acquireRunGateWaiting(
  lockPath: string,
  options: { maxWaitMs: number; pollMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<Lock | null> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = options.pollMs ?? 2000;
  let waited = 0;
  for (;;) {
    try {
      return acquireRunGate(lockPath);
    } catch (error) {
      if (!(error instanceof RunGateBusyError) || waited >= options.maxWaitMs) {
        if (error instanceof RunGateBusyError) return null;
        throw error;
      }
    }
    await sleep(pollMs);
    waited += pollMs;
  }
}
