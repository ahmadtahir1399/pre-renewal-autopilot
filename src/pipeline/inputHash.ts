// Idempotency key for one case: if none of these inputs change, the pack would not change.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { CompareConfig } from '../compare/compareTerms.js';

export interface InputHashParts {
  expiringPath?: string;
  renewalPath?: string;
  extractPromptVersion: string;
  modelName: string;
  compareRulesVersion: string;
  compareConfig: CompareConfig;
  templateVersion: string;
}

/** sha256 of the file bytes, or the literal "missing". */
export function fileHashOrMissing(filePath: string | undefined): string {
  if (!filePath || !existsSync(filePath)) return 'missing';
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function computeInputHash(parts: InputHashParts): string {
  const canonical = JSON.stringify({
    expiring: fileHashOrMissing(parts.expiringPath),
    renewal: fileHashOrMissing(parts.renewalPath),
    extractPromptVersion: parts.extractPromptVersion,
    modelName: parts.modelName,
    compareRulesVersion: parts.compareRulesVersion,
    premiumMediumPct: parts.compareConfig.premiumMediumPct,
    premiumHighPct: parts.compareConfig.premiumHighPct,
    templateVersion: parts.templateVersion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
