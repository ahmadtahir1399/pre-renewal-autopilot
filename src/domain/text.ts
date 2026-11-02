// Display-text hygiene shared by every output sink (FIX, Prompt 5, D-130). Client names come from the
// data source and policy numbers, exclusion titles and quotes come from untrusted documents, so any
// of them may carry control characters, bidirectional overrides or huge lengths. Found by the
// attack-surface matrix (test/security/attackSurface.test.ts).
// Characters are tested by NUMERIC code point on purpose: this file contains no raw control or bidi
// characters (a raw bidi character in source code is itself a known attack, "Trojan Source").

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;

/** C0 controls except TAB / LF / CR, DEL, C1 controls, and bidi overrides / isolates (U+202A-202E, U+2066-2069). */
export function isUnsafeCodePoint(code: number): boolean {
  if (code < 0x20) return code !== TAB && code !== LF && code !== CR;
  if (code >= 0x7f && code <= 0x9f) return true;
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

function isBreak(code: number): boolean {
  return code === TAB || code === LF || code === CR || code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR;
}

/** Multi-line text: line endings become LF, unsafe characters are removed. */
export function cleanText(value: string): string {
  let out = '';
  for (const char of value.replace(/\r\n?/g, '\n')) {
    if (!isUnsafeCodePoint(char.codePointAt(0) ?? 0)) out += char;
  }
  return out;
}

/** One line: unsafe characters removed, line breaks and tabs become one space, trimmed, clamped. */
export function cleanLine(value: string, maxLength = 200): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (isBreak(code)) out += ' ';
    else if (!isUnsafeCodePoint(code)) out += char;
  }
  return clamp(out.replace(/ {2,}/g, ' ').trim(), maxLength);
}

/** Cut to maxLength characters (code points), ending with "..." when cut. */
export function clamp(value: string, maxLength: number): string {
  const chars = Array.from(value);
  return chars.length <= maxLength ? value : `${chars.slice(0, Math.max(0, maxLength - 3)).join('')}...`;
}

/** Escaped form for logs: each unsafe character (and U+2028 / U+2029) becomes a visible \uXXXX marker. */
export function escapeUnsafe(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    out += isUnsafeCodePoint(code) || code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR ? `\\u${code.toString(16).padStart(4, '0')}` : char;
  }
  return out;
}
