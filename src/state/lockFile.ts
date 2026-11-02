// Single-instance / no-overlap lock that survives crashes: a file holding the owner's PID.
// A lock whose PID is no longer running is stale and is taken over.

import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export class LockHeldError extends Error {
  constructor(
    readonly lockPath: string,
    readonly ownerPid: number,
  ) {
    super(`Another process (PID ${ownerPid}) holds ${lockPath}. If that process crashed, the lock is cleared automatically once its PID is gone.`);
    this.name = 'LockHeldError';
  }
}

/** process.kill(pid, 0) checks existence without sending a signal (also works on Windows per Node docs; VERIFY). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface Lock {
  readonly path: string;
  release(): void;
}

export interface LockOptions {
  pid?: number;
  isAlive?: (pid: number) => boolean;
  nowIso?: () => string;
}

export function acquireLock(lockPath: string, options: LockOptions = {}): Lock {
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? isProcessAlive;
  mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(lockPath, JSON.stringify({ pid, startedAt: options.nowIso?.() ?? null }), { flag: 'wx' });
      return {
        path: lockPath,
        release() {
          try {
            const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number };
            if (owner.pid === pid) unlinkSync(lockPath);
          } catch {
            // already gone
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      let ownerPid = Number.NaN;
      try {
        ownerPid = Number((JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: number }).pid);
      } catch {
        // unreadable lock file: treat as stale
      }
      if (Number.isInteger(ownerPid) && ownerPid !== pid && isAlive(ownerPid)) throw new LockHeldError(lockPath, ownerPid);
      unlinkSync(lockPath); // stale (crashed owner) or our own leftover: take it over
    }
  }
  throw new Error(`Could not acquire ${lockPath}`);
}
