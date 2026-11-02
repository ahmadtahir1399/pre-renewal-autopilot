// Environment configuration, validated with Zod. Fails fast with ONE readable
// list of every problem. Secrets are optional at parse time: a command asks for
// the secrets it actually uses with requireEnv(), so nothing needs an LLM key or
// a Telegram token unless it really calls them.

import { existsSync } from 'node:fs';
import { z } from 'zod';
import { isValidIsoDate } from '../domain/dates.js';
import { ConfigError } from '../domain/errors.js';

/** Values of these variables are never echoed in error messages or logs. */
export const SECRET_ENV_KEYS = ['LLM_API_KEY', 'TELEGRAM_BOT_TOKEN', 'APPROVAL_WEB_TOKEN'] as const;

export const APPROVAL_CHANNEL_NAMES = ['web', 'telegram'] as const;
export type ApprovalChannelName = (typeof APPROVAL_CHANNEL_NAMES)[number];

const RUN_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const CHAT_ID_PATTERN = /^-?\d+$/;

function optionalText() {
  return z.string().optional();
}

function textWithDefault(defaultValue: string) {
  return z
    .string()
    .optional()
    .transform((raw) => raw ?? defaultValue);
}

function intVar(defaultValue: number, min: number, max: number) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return defaultValue;
      if (!/^-?\d+$/.test(raw)) {
        ctx.addIssue({ code: 'custom', message: 'must be a whole number' });
        return z.NEVER;
      }
      const value = Number(raw);
      if (value < min || value > max) {
        ctx.addIssue({ code: 'custom', message: `must be between ${min} and ${max}` });
        return z.NEVER;
      }
      return value;
    });
}

function boolVar(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return defaultValue;
      const normalized = raw.toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
      ctx.addIssue({ code: 'custom', message: 'must be true or false' });
      return z.NEVER;
    });
}

/** Optional decimal in [min, max]; unset stays undefined. */
function optionalDecimalVar(min: number, max: number) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return undefined;
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        ctx.addIssue({ code: 'custom', message: 'must be a number' });
        return z.NEVER;
      }
      const value = Number(raw);
      if (value < min || value > max) {
        ctx.addIssue({ code: 'custom', message: `must be between ${min} and ${max}` });
        return z.NEVER;
      }
      return value;
    });
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const EnvSchema = z.object({
  LLM_PROVIDER: optionalText(),
  LLM_API_KEY: optionalText(),
  LLM_MODEL: optionalText(),
  /** Added in Prompt 2 (D-031). Unset = not sent; some models reject a temperature setting. */
  LLM_TEMPERATURE: optionalDecimalVar(0, 2),
  /** Added in Prompt 2 (D-029). Live LLM calls happen only when this is true. */
  RUN_LIVE_LLM: boolVar(false),
  TELEGRAM_BOT_TOKEN: optionalText(),
  TELEGRAM_ALLOWED_CHAT_IDS: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return [] as string[];
      const ids = raw
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');
      const bad = ids.filter((id) => !CHAT_ID_PATTERN.test(id));
      if (bad.length > 0) {
        ctx.addIssue({ code: 'custom', message: 'must be a comma separated list of numeric chat ids' });
        return z.NEVER;
      }
      return ids;
    }),
  /** Prompt 4 Stage 8 (D-073): 'web' (default), 'telegram' or 'both'. */
  APPROVAL_CHANNELS: z
    .string()
    .optional()
    .transform((raw, ctx): ApprovalChannelName[] => {
      const value = (raw ?? 'web').toLowerCase();
      if (value === 'web') return ['web'];
      if (value === 'telegram') return ['telegram'];
      if (value === 'both') return ['web', 'telegram'];
      ctx.addIssue({ code: 'custom', message: 'must be web, telegram or both' });
      return z.NEVER;
    }),
  APPROVAL_WEB_PORT: intVar(8787, 1024, 65535),
  /** Optional; when empty, serve generates a random token at start. */
  APPROVAL_WEB_TOKEN: optionalText(),
  /**
   * Optional (Prompt 6 deployment). The ONE public HTTPS origin a TLS reverse proxy serves the page on,
   * e.g. https://203-0-113-7.sslip.io. The app still binds to 127.0.0.1 only; this just adds exactly one
   * accepted Host and Origin. Unset = loopback only (the default, unchanged behaviour).
   */
  APPROVAL_PUBLIC_ORIGIN: z
    .string()
    .optional()
    .transform((raw, ctx): string | undefined => {
      if (raw === undefined) return undefined;
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'must be an https origin such as https://203-0-113-7.sslip.io' });
        return z.NEVER;
      }
      const bare = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === '';
      if (url.protocol !== 'https:' || !bare || !url.hostname.includes('.') || url.hostname.includes('*') || raw.replace(/\/$/, '') !== url.origin) {
        ctx.addIssue({ code: 'custom', message: 'must be exactly one https origin with no path, query or wildcard, such as https://203-0-113-7.sslip.io' });
        return z.NEVER;
      }
      return url.origin;
    }),
  APPROVER_NAME: textWithDefault('broker'),
  /** Prompt 7 (D-F) upload limits. No secrets here. */
  UPLOAD_MAX_MB: intVar(10, 1, 50),
  UPLOAD_MAX_PAGES: intVar(30, 1, 200),
  UPLOAD_DAILY_LIMIT: intVar(10, 1, 200),
  UPLOAD_RETENTION_DAYS: intVar(7, 1, 365),
  ANALYSIS_TIMEOUT_SECONDS: intVar(180, 10, 1800),
  REMINDER_AFTER_HOURS: intVar(48, 1, 24 * 30),
  REMINDER_INTERVAL_HOURS: intVar(24, 1, 24 * 30),
  TIMEZONE: textWithDefault('Pacific/Auckland').refine(isValidTimeZone, {
    message: 'must be a valid IANA time zone such as Pacific/Auckland',
  }),
  RUN_TIME: textWithDefault('07:00').refine((value) => RUN_TIME_PATTERN.test(value), {
    message: 'must be a 24-hour time as HH:mm, e.g. 07:00',
  }),
  DB_PATH: textWithDefault('runtime/autopilot.db'),
  /** Added in Prompt 2 (D-028): read-only fixtures root (data/ and documents/). Never written. */
  FIXTURES_DIR: textWithDefault('fixtures'),
  /** Writable data directory; the status overlay lives at DATA_DIR/runtime/status-overlay.json (D-028). */
  DATA_DIR: textWithDefault('data'),
  OUTPUT_DIR: textWithDefault('output'),
  WINDOW_MIN_DAYS: intVar(84, 0, 3650),
  WINDOW_MAX_DAYS: intVar(112, 0, 3650),
  PREMIUM_MEDIUM_PCT: intVar(10, 0, 1000),
  PREMIUM_HIGH_PCT: intVar(25, 0, 1000),
  DRY_RUN: boolVar(false),
  AUTOPILOT_ENABLED: boolVar(true),
  REFERENCE_DATE: z
    .string()
    .optional()
    .refine((value) => value === undefined || isValidIsoDate(value), {
      message: 'must be a real calendar date as yyyy-mm-dd',
    }),
  USE_AI_SUMMARY: boolVar(false),
  // D-120: one targeted second reading for facts whose quote could not be confirmed on the page (live mode only).
  EXTRACT_REPAIR_PASS: boolVar(true),
  // D-123: public demo, NO sign-in (anyone with the address can use everything). Off by default.
  PUBLIC_DEMO: boolVar(false),
  MAX_CONCURRENCY: intVar(2, 1, 16),
});

export type Env = z.output<typeof EnvSchema>;
export type EnvKey = keyof Env;

const ENV_KEYS = Object.keys(EnvSchema.shape) as EnvKey[];

/** Trim every known variable; treat empty strings as "not set". Unknown variables are ignored. */
function normalize(source: Record<string, string | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    const trimmed = source[key]?.trim();
    out[key] = trimmed === undefined || trimmed === '' ? undefined : trimmed;
  }
  return out;
}

function describeValue(key: string, raw: string | undefined): string {
  if (raw === undefined) return '';
  if ((SECRET_ENV_KEYS as readonly string[]).includes(key)) return ' (value hidden)';
  return ` (got "${raw}")`;
}

function crossFieldProblems(env: Env): string[] {
  const problems: string[] = [];
  if (env.WINDOW_MIN_DAYS > env.WINDOW_MAX_DAYS) {
    problems.push(
      `WINDOW_MIN_DAYS: must not be greater than WINDOW_MAX_DAYS (${env.WINDOW_MIN_DAYS} > ${env.WINDOW_MAX_DAYS})`,
    );
  }
  if (env.PREMIUM_MEDIUM_PCT >= env.PREMIUM_HIGH_PCT) {
    problems.push(
      `PREMIUM_MEDIUM_PCT: must be lower than PREMIUM_HIGH_PCT (${env.PREMIUM_MEDIUM_PCT} >= ${env.PREMIUM_HIGH_PCT})`,
    );
  }
  return problems;
}

/** Parse an environment object. Throws ConfigError listing EVERY problem at once. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const normalized = normalize(source);
  const result = EnvSchema.safeParse(normalized);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const key = String(issue.path[0] ?? 'env');
      return `${key}: ${issue.message}${describeValue(key, normalized[key])}`;
    });
    throw new ConfigError(problems);
  }
  const problems = crossFieldProblems(result.data);
  if (problems.length > 0) throw new ConfigError(problems);
  return result.data;
}

type OptionalEnvKey = {
  [K in EnvKey]-?: undefined extends Env[K] ? K : never;
}[EnvKey];

export type EnvWith<K extends OptionalEnvKey> = Env & { [P in K]-?: NonNullable<Env[P]> };

/** Require variables that a specific command needs (e.g. secrets). Lists all missing ones at once. */
export function requireEnv<K extends OptionalEnvKey>(env: Env, keys: readonly K[]): EnvWith<K> {
  const missing = keys.filter((key) => env[key] === undefined);
  if (missing.length > 0) {
    throw new ConfigError(missing.map((key) => `${key}: is required for this command but is not set`));
  }
  return env as EnvWith<K>;
}

/** Load .env from the project root if present (existing variables win), then parse process.env. */
export function loadEnv(envFilePath = '.env'): Env {
  if (existsSync(envFilePath)) {
    process.loadEnvFile(envFilePath);
  }
  return parseEnv(process.env);
}

/** For command entry points: print the readable problem list and exit with code 1 on bad config. */
export function loadEnvOrExit(envFilePath = '.env'): Env {
  try {
    return loadEnv(envFilePath);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\nFix these in your .env file (see .env.example) and run again.\n`);
      process.exit(1);
    }
    throw error;
  }
}
