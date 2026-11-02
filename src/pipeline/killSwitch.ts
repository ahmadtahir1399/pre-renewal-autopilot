// Emergency stop: AUTOPILOT_ENABLED=false, or a file named PAUSE in DATA_DIR.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function pauseFilePath(dataDir: string): string {
  return path.join(dataDir, 'PAUSE');
}

export function pauseReason(autopilotEnabled: boolean, dataDir: string): string | null {
  if (!autopilotEnabled) return 'AUTOPILOT_ENABLED is false';
  if (existsSync(pauseFilePath(dataDir))) return `PAUSE file present (${pauseFilePath(dataDir)})`;
  return null;
}

export function pause(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(pauseFilePath(dataDir), 'Autopilot paused. Delete this file or run: npm run resume\n', 'utf8');
  return pauseFilePath(dataDir);
}

export function resume(dataDir: string): boolean {
  const file = pauseFilePath(dataDir);
  const existed = existsSync(file);
  rmSync(file, { force: true });
  return existed;
}
