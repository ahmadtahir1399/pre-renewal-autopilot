import { describe, expect, it } from 'vitest';
import { createLogger, isSecretKey, REDACTED } from '../src/config/logger.js';

function capture(level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
  const lines: string[] = [];
  const logger = createLogger({ level, sink: (line) => lines.push(line), now: () => new Date('2026-10-19T00:00:00Z') });
  return { logger, lines, entries: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe('logger redaction', () => {
  it('redacts secret-looking keys at any depth', () => {
    const { logger, entries } = capture();
    logger.info('starting', {
      token: 't-1',
      apiKey: 'k-1',
      LLM_API_KEY: 'k-2',
      password: 'p-1',
      nested: { client_secret: 's-1', list: [{ authorization: 'a-1' }] },
    });
    const [entry] = entries();
    expect(entry).toMatchObject({
      level: 'info',
      msg: 'starting',
      time: '2026-10-19T00:00:00.000Z',
      token: REDACTED,
      apiKey: REDACTED,
      LLM_API_KEY: REDACTED,
      password: REDACTED,
      nested: { client_secret: REDACTED, list: [{ authorization: REDACTED }] },
    });
  });

  it('keeps domain keys such as cycleKey and policyId', () => {
    expect(isSecretKey('cycleKey')).toBe(false);
    expect(isSecretKey('policyId')).toBe(false);
    expect(isSecretKey('key')).toBe(true);
    expect(isSecretKey('private-key')).toBe(true);
    const { logger, entries } = capture();
    logger.info('pack built', { cycleKey: 'pol-s01:2027-01-17' });
    expect(entries()[0]?.cycleKey).toBe('pol-s01:2027-01-17');
  });

  it('scrubs secret value shapes inside strings', () => {
    const { logger, lines } = capture();
    const fakeBotToken = `123456789:${'A'.repeat(35)}`;
    logger.warn(`call failed with ${fakeBotToken}`, { detail: 'Bearer abc.def.ghi' });
    expect(lines[0]).not.toContain(fakeBotToken);
    expect(lines[0]).not.toContain('abc.def.ghi');
  });

  it('truncates long strings so document text cannot leak into logs', () => {
    const { logger, entries } = capture();
    logger.info('page text', { text: 'x'.repeat(2000) });
    const text = entries()[0]?.text as string;
    expect(text.length).toBeLessThan(600);
    expect(text).toContain('[truncated 1500 chars]');
  });

  it('filters by level and supports child bindings', () => {
    const { logger, entries } = capture('warn');
    logger.info('hidden');
    logger.child({ runId: 'r1' }).error('shown');
    const all = entries();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ msg: 'shown', runId: 'r1' });
  });
});
