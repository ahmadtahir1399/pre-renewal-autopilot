import { describe, expect, it } from 'vitest';
import { parseEnv, requireEnv } from '../src/config/env.js';
import { ConfigError } from '../src/domain/errors.js';

function problemsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('parseEnv', () => {
  it('applies every default when nothing is set (no secrets required)', () => {
    const env = parseEnv({});
    expect(env).toMatchObject({
      TIMEZONE: 'Pacific/Auckland',
      RUN_TIME: '07:00',
      DB_PATH: 'runtime/autopilot.db',
      FIXTURES_DIR: 'fixtures',
      DATA_DIR: 'data',
      RUN_LIVE_LLM: false,
      OUTPUT_DIR: 'output',
      WINDOW_MIN_DAYS: 84,
      WINDOW_MAX_DAYS: 112,
      PREMIUM_MEDIUM_PCT: 10,
      PREMIUM_HIGH_PCT: 25,
      DRY_RUN: false,
      AUTOPILOT_ENABLED: true,
      USE_AI_SUMMARY: false,
      MAX_CONCURRENCY: 2,
      TELEGRAM_ALLOWED_CHAT_IDS: [],
      APPROVAL_CHANNELS: ['web'],
      APPROVAL_WEB_PORT: 8787,
      APPROVER_NAME: 'broker',
      REMINDER_AFTER_HOURS: 48,
      REMINDER_INTERVAL_HOURS: 24,
    });
    expect(env.APPROVAL_WEB_TOKEN).toBeUndefined();
    expect(env.APPROVAL_PUBLIC_ORIGIN).toBeUndefined();
    expect(parseEnv({ APPROVAL_PUBLIC_ORIGIN: 'https://203-0-113-7.sslip.io' }).APPROVAL_PUBLIC_ORIGIN).toBe('https://203-0-113-7.sslip.io');
    expect(parseEnv({ APPROVAL_PUBLIC_ORIGIN: 'https://203-0-113-7.sslip.io/' }).APPROVAL_PUBLIC_ORIGIN).toBe('https://203-0-113-7.sslip.io');
    expect(parseEnv({ APPROVAL_PUBLIC_ORIGIN: '   ' }).APPROVAL_PUBLIC_ORIGIN).toBeUndefined();
    for (const bad of ['http://203-0-113-7.sslip.io', 'https://x.example/path', 'https://x.example/?q=1', 'https://user:pw@x.example', 'https://*.example.com', 'https://localhost', 'not a url', 'https://a.example,https://b.example']) {
      expect(() => parseEnv({ APPROVAL_PUBLIC_ORIGIN: bad }), bad).toThrow();
    }
    expect(parseEnv({ APPROVAL_CHANNELS: 'Both' }).APPROVAL_CHANNELS).toEqual(['web', 'telegram']);
    expect(() => parseEnv({ APPROVAL_CHANNELS: 'email' })).toThrow();
    expect(env.LLM_API_KEY).toBeUndefined();
    expect(env.REFERENCE_DATE).toBeUndefined();
  });

  it('treats empty and blank strings as not set', () => {
    const env = parseEnv({ LLM_PROVIDER: '', WINDOW_MIN_DAYS: '   ', REFERENCE_DATE: '' });
    expect(env.LLM_PROVIDER).toBeUndefined();
    expect(env.WINDOW_MIN_DAYS).toBe(84);
  });

  it('parses provided values', () => {
    const env = parseEnv({
      LLM_PROVIDER: 'some-provider',
      TELEGRAM_ALLOWED_CHAT_IDS: '111, -222 ,333',
      DRY_RUN: 'TRUE',
      AUTOPILOT_ENABLED: '0',
      REFERENCE_DATE: '2026-10-19',
      MAX_CONCURRENCY: '4',
    });
    expect(env.LLM_PROVIDER).toBe('some-provider');
    expect(env.TELEGRAM_ALLOWED_CHAT_IDS).toEqual(['111', '-222', '333']);
    expect(env.DRY_RUN).toBe(true);
    expect(env.AUTOPILOT_ENABLED).toBe(false);
    expect(env.REFERENCE_DATE).toBe('2026-10-19');
    expect(env.MAX_CONCURRENCY).toBe(4);
  });

  it('rejects a bad number with a readable message', () => {
    const problems = problemsOf(() => parseEnv({ WINDOW_MIN_DAYS: 'abc' }));
    expect(problems).toEqual(['WINDOW_MIN_DAYS: must be a whole number (got "abc")']);
  });

  it('reports ALL problems in one list', () => {
    const problems = problemsOf(() =>
      parseEnv({
        WINDOW_MAX_DAYS: '12.5',
        RUN_TIME: '7am',
        TIMEZONE: 'Mars/Olympus',
        DRY_RUN: 'maybe',
        REFERENCE_DATE: '2026-02-30',
        TELEGRAM_ALLOWED_CHAT_IDS: '123,abc',
        MAX_CONCURRENCY: '0',
      }),
    );
    expect(problems).toHaveLength(7);
    for (const key of [
      'WINDOW_MAX_DAYS',
      'RUN_TIME',
      'TIMEZONE',
      'DRY_RUN',
      'REFERENCE_DATE',
      'TELEGRAM_ALLOWED_CHAT_IDS',
      'MAX_CONCURRENCY',
    ]) {
      expect(problems.some((p) => p.startsWith(`${key}:`))).toBe(true);
    }
  });

  it('checks cross-field rules', () => {
    const problems = problemsOf(() =>
      parseEnv({ WINDOW_MIN_DAYS: '120', WINDOW_MAX_DAYS: '84', PREMIUM_MEDIUM_PCT: '30' }),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('WINDOW_MIN_DAYS');
    expect(problems[1]).toContain('PREMIUM_MEDIUM_PCT');
  });

  it('never echoes a secret value in the error message', () => {
    const error = (() => {
      try {
        parseEnv({ TELEGRAM_BOT_TOKEN: 'fake-token-value-for-test', WINDOW_MIN_DAYS: 'x' });
      } catch (e) {
        return e as ConfigError;
      }
      throw new Error('expected failure');
    })();
    expect(error.message).not.toContain('fake-token-value-for-test');
  });
});

describe('requireEnv', () => {
  it('lists every missing variable a command needs', () => {
    const env = parseEnv({});
    const problems = problemsOf(() => requireEnv(env, ['LLM_API_KEY', 'LLM_MODEL']));
    expect(problems).toEqual([
      'LLM_API_KEY: is required for this command but is not set',
      'LLM_MODEL: is required for this command but is not set',
    ]);
  });

  it('passes when the variables are present', () => {
    const env = parseEnv({ LLM_PROVIDER: 'p', LLM_MODEL: 'm' });
    const checked = requireEnv(env, ['LLM_PROVIDER', 'LLM_MODEL']);
    expect(checked.LLM_MODEL).toBe('m');
  });
});
