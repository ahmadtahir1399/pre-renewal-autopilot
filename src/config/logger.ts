// Small structured logger: one JSON object per line on stderr.
// Redacts values whose key looks secret (token, key, secret, password, ...) and
// known secret value shapes, and truncates long strings so full document text
// can never end up in a log.

import { escapeUnsafe } from '../domain/text.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Receives each finished JSON line. Defaults to stderr. */
  sink?: (line: string) => void;
  /** Injectable clock for tests. Timestamps are ISO 8601 UTC. */
  now?: () => Date;
  bindings?: LogFields;
  /** Strings longer than this are truncated. Default 500. */
  maxStringLength?: number;
}

export const REDACTED = '[REDACTED]';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Secret-looking key names. 'key' matches as a whole word or suffix such as
 * api_key / apiKey / LLM_API_KEY / private-key, but NOT domain names like
 * cycleKey (decision D-011).
 */
const SECRET_KEY_PATTERN =
  /(token|secret|passw(or)?d|pwd|authorization|cookie|credential|api[-_]?key|private[-_]?key|access[-_]?key|^key$|[-_]key$)/i;

/** Secret value shapes, redacted wherever they appear in a string. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, // Telegram bot token shape
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // common LLM API key prefix
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function scrubString(value: string, maxLength: number): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, REDACTED);
  if (out.length > maxLength) out = `${out.slice(0, maxLength)}... [truncated ${out.length - maxLength} chars]`;
  // FIX (D-130): bidi overrides and other control characters become visible \uXXXX markers.
  return escapeUnsafe(out);
}

/** Deep copy of value with secrets redacted. Exported for tests. */
export function redact(value: unknown, maxLength = 500, depth = 0): unknown {
  if (depth > 8) return '[too deep]';
  if (typeof value === 'string') return scrubString(value, maxLength);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return {
      name: value.name,
      message: scrubString(value.message, maxLength),
      ...(code === undefined ? {} : { code }),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, maxLength, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = isSecretKey(key) ? REDACTED : redact(item, maxLength, depth + 1);
  }
  return out;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};
  const maxLength = options.maxStringLength ?? 500;

  function write(entryLevel: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const entry = {
      time: now().toISOString(),
      level: entryLevel,
      msg: scrubString(message, maxLength),
      ...(redact({ ...bindings, ...fields }, maxLength) as LogFields),
    };
    sink(JSON.stringify(entry));
  }

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (childBindings) => createLogger({ ...options, bindings: { ...bindings, ...childBindings } }),
  };
}
