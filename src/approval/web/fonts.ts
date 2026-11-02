// Self-hosted Geist (SIL OFL 1.1, see fonts/OFL.txt and fonts/README.md). The files are read once,
// hashed into immutable URLs and served ONLY from this fixed whitelist: no request path ever reaches the
// file system. The page's CSP allows them with font-src 'self'.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface FontAsset {
  /** Public URL path, e.g. /assets/fonts/geist-latin-wght.0123456789ab.woff2 */
  path: string;
  body: Buffer;
  hash: string;
}

/** Fontsource's latin and latin-ext ranges (Maori macron vowels live in latin-ext). */
const SUBSETS = [
  {
    file: 'geist-latin-wght',
    range:
      'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  },
  {
    file: 'geist-latin-ext-wght',
    range:
      'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
  },
] as const;

function load(file: string): FontAsset {
  const body = readFileSync(new URL(`./fonts/${file}.woff2`, import.meta.url));
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
  return { path: `/assets/fonts/${file}.${hash}.woff2`, body, hash };
}

const LOADED = SUBSETS.map((subset) => ({ ...subset, asset: load(subset.file) }));

/** Exact-match whitelist used by the server's font route. */
export const FONT_ASSETS: ReadonlyMap<string, FontAsset> = new Map(LOADED.map(({ asset }) => [asset.path, asset]));

/** The latin file is the only one worth preloading (preload ignores unicode-range). */
export const PRELOAD_FONT_PATH = (LOADED[0] as (typeof LOADED)[number]).asset.path;

/** "App Sans" is a local alias; the font's own name is not changed. Geist is variable on weight 100-900. */
export const FONT_FACE_CSS = LOADED.map(
  ({ asset, range }) =>
    `@font-face{font-family:"App Sans";font-style:normal;font-weight:100 900;font-display:swap;src:url("${asset.path}") format("woff2");unicode-range:${range}}`,
).join('\n');
