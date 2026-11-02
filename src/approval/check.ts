// check:approval - harmless readiness checks per configured channel. Never prints a token.

import { createServer } from 'node:net';
import { LOOPBACK } from './web/server.js';

export interface CheckResult {
  channel: string;
  pass: boolean;
  reason: string;
}

/** Web: can we bind the port on 127.0.0.1? (Released immediately.) */
export function checkWebPort(port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve({
        channel: 'web',
        pass: false,
        reason: error.code === 'EADDRINUSE' ? `port ${port} is already in use (is serve already running?)` : `cannot bind ${LOOPBACK}:${port} (${error.code ?? 'error'})`,
      });
    });
    server.listen(port, LOOPBACK, () => {
      server.close(() => resolve({ channel: 'web', pass: true, reason: `can bind ${LOOPBACK}:${port}; the page is reachable only on this computer` }));
    });
  });
}

/** Explain a Telegram failure in plain words. The token is scrubbed from any message. */
export function explainTelegramFailure(error: unknown, token: string): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const text = token ? raw.split(token).join('[token]') : raw;
  if (/401|unauthori[sz]ed/i.test(text)) return 'Telegram rejected the bot token (401 Unauthorized). Check TELEGRAM_BOT_TOKEN in .env.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|EAI_AGAIN|network|fetch failed|abort|timeout/i.test(text)) {
    return 'This computer could not reach api.telegram.org (network error or timeout). Telegram needs the computer running this automation to reach api.telegram.org, not just your phone; it may be blocked on your network or in your country.';
  }
  return `Telegram check failed: ${text.slice(0, 200)}`;
}
