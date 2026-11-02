// Shared helpers for the security tests.

import { request } from 'node:http';

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

export function httpGet(port: number, urlPath: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path: urlPath, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function loginCookie(port: number, token: string): Promise<string> {
  const reply = await httpGet(port, `/?t=${encodeURIComponent(token)}`);
  return String(reply.headers['set-cookie'] ?? '').split(';')[0] ?? '';
}

/** C0 controls except TAB and LF, DEL, C1 controls. CR is checked separately where CRLF is legal. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the point of this pattern is to find control characters
export const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
/** Bidirectional overrides and isolates (can visually reorder text: "Evil<RLO>gnp.exe" shows as "Evilexe.png"). */
export const BIDI_CONTROLS = new RegExp(`[${String.fromCodePoint(0x202a)}-${String.fromCodePoint(0x202e)}${String.fromCodePoint(0x2066)}-${String.fromCodePoint(0x2069)}]`);

export function unsafeCharsIn(text: string, options: { allowCrLf?: boolean } = {}): string | null {
  const stripped = options.allowCrLf ? text.replace(/\r\n/g, '\n') : text;
  if (stripped.includes('\r')) return 'contains a bare CR';
  const control = CONTROL_CHARS.exec(stripped);
  if (control) return `contains control character U+${control[0].charCodeAt(0).toString(16).padStart(4, '0')}`;
  const bidi = BIDI_CONTROLS.exec(stripped);
  if (bidi) return `contains bidi control U+${bidi[0].charCodeAt(0).toString(16).padStart(4, '0')}`;
  return null;
}
