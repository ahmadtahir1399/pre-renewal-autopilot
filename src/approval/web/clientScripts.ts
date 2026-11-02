// The page's ONLY scripts (Prompt 8, D-125): the motion boot, GSAP 3 core + ScrollTrigger (self-hosted from
// the gsap npm package, "Standard no-charge" licence) and the motion layer in client/. Like the fonts, each file
// is read once at start-up, hashed into an immutable URL and served ONLY from this fixed whitelist: no request
// path ever reaches the file system. The CSP allows them with script-src 'self' (no inline script, no other
// origin). The pages work fully without them: they add motion, never content or behaviour.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

export interface ScriptAsset {
  /** Public URL path, e.g. /assets/js/gsap.0123456789ab.js */
  path: string;
  body: Buffer;
  hash: string;
  /** false only for boot.js, which must run before the first paint. */
  defer: boolean;
}

const require = createRequire(import.meta.url);

function load(name: string, file: URL | string, defer: boolean): ScriptAsset {
  const body = readFileSync(file);
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
  return { path: `/assets/js/${name}.${hash}.js`, body, hash, defer };
}

/** In page order: boot (blocking, tiny), then the deferred three, which run in this order. */
export const PAGE_SCRIPTS: readonly ScriptAsset[] = [
  load('boot', new URL('./client/boot.js', import.meta.url), false),
  load('gsap', require.resolve('gsap/dist/gsap.min.js'), true),
  load('scrolltrigger', require.resolve('gsap/dist/ScrollTrigger.min.js'), true),
  load('motion', new URL('./client/motion.js', import.meta.url), true),
];

/** Exact-match whitelist used by the server's script route. */
export const SCRIPT_ASSETS: ReadonlyMap<string, ScriptAsset> = new Map(PAGE_SCRIPTS.map((asset) => [asset.path, asset]));

/** The <script> tags for <head>: external, same-origin, no inline code and no event-handler attributes. */
export const SCRIPT_TAGS = PAGE_SCRIPTS.map((asset) => `<script src="${asset.path}"${asset.defer ? ' defer' : ''}></script>`).join('');
