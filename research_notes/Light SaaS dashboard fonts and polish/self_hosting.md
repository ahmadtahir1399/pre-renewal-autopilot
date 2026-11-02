# Self-hosting web fonts on a no-JS, strict-CSP, server-rendered page (Node http, 127.0.0.1)

Research date: 2026-10-20. Current CSP under consideration:
`default-src 'none'; style-src 'self'; img-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`

## 1. What CSP change is needed (font-src 'self'), and is a @font-face url() an external resource?

### Takeaway
Yes, add `font-src 'self'`. Every font file fetched through `@font-face` is its own request with destination "font", and CSP checks it against `font-src`, falling back to `default-src`. Under the current `default-src 'none'`, all fonts are blocked even when the stylesheet itself is same-origin. No other directive needs to change. `style-src 'self'` already covers the external stylesheet that holds the `@font-face` rules. A `<link rel="preload" as="font">` is also checked against `font-src`.

### Cited Findings
- "The HTTP Content-Security-Policy (CSP) font-src directive specifies valid sources for fonts loaded using @font-face." If `font-src` is absent, "the user agent will look for the default-src directive." — [MDN: CSP font-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/font-src)
- The source values that apply to `font-src` include `'self'`, `<host-source>` and `<scheme-source>`. `'none'` means "No resources of this type may be loaded." MDN's example shows a `@font-face` src URL that doesn't match `font-src` being blocked. — [MDN: CSP font-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/font-src)
- In CSP Level 3's "Get the effective directive for request" algorithm (§6.8.1), destination `"font"` maps to `font-src`. Requests initiated by `prefetch`/`prerender` map to `default-src`. — [W3C CSP Level 3, Working Draft dated 16 Sep 2026](https://www.w3.org/TR/CSP3/)
- CSP3 §1.3 says `'self'` "now matches https: and wss: variants of the page's origin, even on pages whose scheme is http". So on `http://127.0.0.1:PORT`, `'self'` matches that exact origin, plus the https/wss upgrades. — [W3C CSP3](https://www.w3.org/TR/CSP3/)
- With preload, specifying `as` lets the browser "Apply the correct content security policy to the resource." — [MDN: rel=preload](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload)

### Inferences
- Minimal new policy: `default-src 'none'; style-src 'self'; font-src 'self'; img-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`.
- Keep `@font-face` in the external same-origin stylesheet, as the page already does. An inline `<style>` would need `'unsafe-inline'`, a nonce or a hash under `style-src`, so avoid it.
- The CSS is same-origin, but the font binary is still fetched separately and policed by `font-src`. "Same-origin" doesn't exempt it. `'self'` is the correct value.
- Don't use `data:` URIs for fonts. They would need `font-src data:`, which weakens the policy and defeats caching.
- `img-src 'none'` is unaffected by fonts. `connect-src` is not involved, because fonts aren't fetched through `connect-src`.

### Gaps
- I couldn't extract the text of CSP3 §6.1.4 (the font-src definition) from the truncated spec fetch. The destination-to-directive mapping above is from §6.8.1.

## 2. Best-practice @font-face declarations (2025-2026) and Baseline status

### Takeaway
Ship WOFF2 only. Use one variable-font file per subset with a `font-weight: 100 900` range, and declare `unicode-range` on each face. For a local tool, use `font-display: swap`; the file comes from loopback and is cached, so the swap window is effectively nil. `optional` is the performance-first choice for public sites. Fallback metric overrides are worth adding: `size-adjust` is Baseline widely available, but `ascent-override`/`descent-override`/`line-gap-override` are not supported in Safari, so treat those as progressive enhancement.

### Cited Findings
- WOFF2 uses Brotli and compresses about 30% better than WOFF. web.dev quotes the 2022 Web Almanac: "Use only WOFF2 and forget about everything else." — [web.dev: Best practices for fonts (Hempenius and Pollard, updated 2022-10-04)](https://web.dev/articles/font-best-practices)
- font-display periods: `block` = short block, infinite swap; `swap` = extremely small block, infinite swap; `fallback` = extremely small block, short swap; `optional` = extremely small block, no swap. MDN marks `font-display` "Baseline: Widely available" since January 2020. — [MDN: font-display](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/font-display)
- web.dev's guidance on font-display values:
  - `optional`: waits at most about 100ms and never causes a swap layout shift. web.dev recommends it when performance is the priority.
  - `swap`: shows text fast, but late arrival causes a shift.
  - `fallback`: about 100ms block, about 3s swap.
  - Suggested combination: `swap` for branding, `optional` for body text.
  — [web.dev](https://web.dev/articles/font-best-practices)
- `unicode-range` makes the browser download a face only if the page uses characters in that range. Pair it with subset files. — [web.dev](https://web.dev/articles/font-best-practices)
- Format hints:
  - `format()` is optional. If it's omitted, "the browser will download the resource and then detect the format."
  - The legacy `format("woff2-variations")` maps to the normalized `format(woff2) tech(variations)`.
  - When listing multiple sources, put constrained entries before unconstrained ones.
  - `src` is Baseline widely available since July 2015, with "Some parts of this feature may have varying levels of support".
  — [MDN: @font-face src](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/src)
- Fontsource's generated CSS for the Inter variable font uses `font-weight: 100 900`, `font-style: normal`, `font-display: swap`, `src: url(./files/inter-latin-wght-normal.woff2) format('woff2-variations')` and a `unicode-range`. — [jsDelivr: @fontsource-variable/inter@5.3.0/wght.css](https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/wght.css)
- `size-adjust` is "Baseline: Widely available" since September 2023. It scales all metrics, including glyph advances and the other override descriptors. MDN's example applies it to a `local()` fallback face. — [MDN: size-adjust](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/size-adjust)
- `ascent-override` has "Limited availability" (not Baseline). — [MDN: ascent-override](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/ascent-override)
- Caniuse lists Safari 3.1–27 and iOS Safari through 26.5 as not supporting `ascent-override`, and Chrome from 87. — [caniuse: ascent-override](https://caniuse.com/mdn-css_at-rules_font-face_ascent-override). The descent-override API has its own table. — [caniuse: descent-override](https://caniuse.com/mdn-api_cssfontfacedescriptors_descent-override)

### Inferences
Recommended declaration for a local tool. Font names are examples, and the file names include a content hash:

```css
@font-face {
  font-family: "Inter Variable";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("/assets/inter-latin-wght-normal.3f9a1c2b.woff2") format("woff2");
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
    U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215,
    U+FEFF, U+FFFD;
}
@font-face {
  font-family: "Inter Variable";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url("/assets/inter-latin-ext-wght-normal.<hash>.woff2") format("woff2");
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304,
    U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB,
    U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
}
/* Metric-matched fallback (values must be computed per font; these are placeholders) */
@font-face {
  font-family: "Inter Fallback";
  src: local("Arial");
  size-adjust: 107%;         /* Baseline */
  ascent-override: 90%;      /* ignored by Safari: progressive enhancement */
  descent-override: 22%;
  line-gap-override: 0%;
}
body { font-family: "Inter Variable", "Inter Fallback", system-ui, sans-serif; }
```

- Use `format("woff2")`. It is safe and widely understood. `format('woff2-variations')` is legacy but still works. `format(woff2) tech(variations)` is the newest syntax, but I didn't confirm `tech()` support across browsers, so the plain `format("woff2")` form is the conservative choice. Browsers detect variations from the file either way.
- No WOFF fallback is needed in 2025-2026. Every current browser supports WOFF2, and the package ships WOFF only for legacy browsers.
- `swap` vs `optional` for a localhost tool: the font arrives from loopback in well under 100ms, and after that from the immutable cache. Both behave almost identically in practice. `swap` guarantees the brand font always appears. `optional` could, in rare cold-start cases, leave the session in the fallback font. Recommendation: `swap`.
- Declare `font-style: normal` explicitly. If no italic face is declared, any `<em>` will be synthesized (faux-oblique). Either ship the italic file or set `font-synthesis` deliberately.
- I didn't find an authoritative source for the exact metric-override values for Inter or Geist against Arial. Tools like Capsize or Fontaine compute them. Leave this as a gap, or skip overrides entirely: on loopback, layout shift is negligible.

### Gaps
- I didn't confirm per-browser support for `tech(variations)` (MDN compat table not extracted).
- I didn't verify whether `font-weight` range syntax in `@font-face` has its own Baseline label. It is used universally by Fontsource and Google Fonts CSS.

## 3. Is `<link rel="preload" as="font" type="font/woff2" crossorigin>` needed or allowed?

### Takeaway
It is allowed with no JavaScript, because it's plain HTML, and `font-src 'self'` covers it. It is optional for this page. If used, the `crossorigin` attribute is mandatory even same-origin; without it the preload is fetched in a different mode and wasted, causing a double download.

### Cited Findings
- "font and fetch preloading requires the crossorigin attribute to be set". It must match the resource's CORS/credentials mode "even when the fetch is not cross-origin". Fonts "have to be fetched using anonymous-mode CORS". — [MDN: rel=preload](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload)
- The `type` attribute lets the browser skip unsupported types. MDN's example is `<link rel="preload" href="fonts/x.woff2" as="font" type="font/woff2" crossorigin />`. Preload has been Baseline widely available since January 2021. — [MDN: rel=preload](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload)
- Preload helps most when fonts are referenced from external stylesheets, which is this case. But preload ignores `unicode-range` and competes for bandwidth, so use it sparingly and for one format only. — [web.dev](https://web.dev/articles/font-best-practices)
- Destination `font` maps to `font-src` in CSP3, so a preload with `as="font"` is checked against `font-src`. — [W3C CSP3 §6.8.1](https://www.w3.org/TR/CSP3/)

### Inferences
- For a small local page with one external CSS file, preloading only the latin-subset file is a reasonable micro-optimisation. It removes one round-trip, which is about a millisecond on loopback, so it's not required. Never preload the latin-ext file: it would always download even though `unicode-range` would usually skip it.
- The preload `href` must exactly match the `@font-face` URL, including the hash, or it's wasted.
- A `Link: </assets/x.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin` HTTP response header is the equivalent with no markup change. This is standard Link-header preload behaviour, not separately verified here.

### Gaps
- I didn't find a primary source quoting the HTML spec's mapping of `as=font` to destination "font". This is inferred from MDN's statement that `as` determines the CSP applied, plus CSP3's mapping.

## 4. HTTP response headers for font files

### Takeaway
Serve `Content-Type: font/woff2`, `X-Content-Type-Options: nosniff` and `Cache-Control: public, max-age=31536000, immutable` on content-hashed URLs. The HTML itself should be `no-cache`. No `Access-Control-Allow-Origin` header is needed for same-origin fonts.

### Cited Findings
- `.woff2` maps to `font/woff2` and `.woff` to `font/woff`. — [MDN: Common MIME types](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/MIME_types/Common_types)
- MDN describes `immutable` this way: "the response will not be updated while it's fresh". The recommended pattern for hashed or versioned assets is `Cache-Control: max-age=31536000, immutable`, with `no-cache` on the referencing HTML. — [MDN: Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
- Fonts are fetched in anonymous-mode CORS. — [MDN: rel=preload](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel/preload)

### Inferences
- CORS: same-origin requests in `cors` mode succeed without `Access-Control-Allow-Origin`. That header only matters cross-origin. Don't add `Access-Control-Allow-Origin: *`; it's unnecessary and widens exposure. (I didn't re-fetch the Fetch spec to quote this; it's standard Fetch behaviour.)
- `nosniff` is harmless and recommended. It requires the Content-Type to be correct, so map the `.woff2` extension explicitly in the Node server rather than relying on a generic default like `application/octet-stream`.
- Node sketch, without a framework:
  - Compute the hash with `crypto.createHash('sha256').update(buf).digest('hex').slice(0,8)` at startup.
  - Serve `/assets/<name>.<hash>.woff2` from a whitelisted map. Don't do arbitrary path joins, to avoid traversal.
  - Write the headers: `200`, `Content-Type: font/woff2`, `Content-Length`, `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`.
  - Optionally add `Cross-Origin-Resource-Policy: same-origin`.
  - Return 404 on a hash mismatch.
- The CSS file that references the hashed fonts should itself be hashed, or `no-cache`, so a font update propagates.
- Don't compress WOFF2 with gzip or brotli. It's already Brotli-compressed internally (see the web.dev Brotli note in §2).

### Gaps
- I didn't verify `immutable` support per browser. MDN says unknown directives are ignored, so it's safe to send.

## 5. npm packages that ship the font files plus licence

### Takeaway
`@fontsource-variable/<name>` is the cleanest source. It has one WOFF2 per subset per axis, a `LICENSE` file, no install scripts, and its `exports` explicitly allows `./files/*.woff2`, so `require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')` works without a bundler. Alternatively, copy the 1–2 WOFF2 files plus the licence into the repo, which is simplest for a local tool.
- `geist`: the files are present, but the package is Next.js-oriented. It has a `next` peer dependency and its `exports` doesn't expose the font paths.
- `@ibm/plex-sans`: runs a telemetry `postinstall` script.

### Cited Findings (versions as of 2026-10-20 from `npm view` and jsDelivr metadata)

**`@fontsource-variable/inter` 5.3.0** (OFL-1.1; modified 2026-07-19; source font version v20)
- Contents: 58 files, 42 of them `.woff2`, with no `.woff`.
- Files: `files/inter-latin-wght-normal.woff2` (48,256 B) and `files/inter-latin-ext-wght-normal.woff2` (85,068 B).
- CSS: `index.css`, `wght.css`, `opsz.css` and `standard.css`.
- Includes `LICENSE` (4,477 B).
- The `exports` map includes `"./files/*.woff2"` and `"./LICENSE"`. Family name: `"Inter Variable"`. Subsets: cyrillic, cyrillic-ext, greek, greek-ext, latin, latin-ext, vietnamese. Axes: opsz, wght.
- Sources: [jsDelivr package.json](https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/package.json), [jsDelivr file listing](https://data.jsdelivr.com/v1/packages/npm/@fontsource-variable/inter@5.3.0?structure=flat), [README](https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/README.md)

**`@fontsource/inter` 5.3.0** (OFL-1.1, static weights)
- 420 files: 126 `.woff2` plus 126 `.woff`.
- One file per subset/weight/style, e.g. `files/inter-latin-400-normal.woff2` (23,664 B) and `inter-latin-ext-400-normal.woff2` (35,000 B).
- Per-weight CSS (`400.css` etc.) and per-subset CSS.
- Sources: [jsDelivr listing](https://data.jsdelivr.com/v1/packages/npm/@fontsource/inter@5.3.0?structure=flat)

**`@fontsource-variable/manrope` 5.3.0** (OFL-1.1)
- 6 `.woff2` files, e.g. `files/manrope-latin-wght-normal.woff2` (24,836 B) and `manrope-latin-ext-wght-normal.woff2` (15,120 B).
- Includes `LICENSE`, `index.css` and `wght.css`.
- Sources: [jsDelivr listing](https://data.jsdelivr.com/v1/packages/npm/@fontsource-variable/manrope@5.3.0?structure=flat)

**Other Fontsource variable packages**
- `@fontsource-variable/plus-jakarta-sans` 5.3.0, `@fontsource-variable/geist` 5.3.0 and `@fontsource/ibm-plex-sans` 5.3.0 all exist under OFL-1.1, from the same `fontsource/font-files` repo. — `npm view` (2026-10-20); licence headers: [plus-jakarta-sans LICENSE](https://cdn.jsdelivr.net/npm/@fontsource-variable/plus-jakarta-sans@5.3.0/LICENSE), [geist LICENSE](https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@5.3.0/LICENSE)

**`geist` 1.8.1** (Vercel official; licence field "SIL OPEN FONT LICENSE"; modified 2026-10-19)
- Contents: 106 files, 45 `.woff2` and 40 `.ttf`.
- Files: `dist/fonts/geist-sans/Geist-Variable.woff2` (69,492 B), `Geist-Regular.woff2`, and `dist/fonts/geist-mono/GeistMono-Variable.woff2` (71,236 B).
- Includes `LICENSE.txt`. The files are not subset; each covers the full character set.
- `exports` exposes only `./font`, `./font/sans`, `./font/mono` and similar JS modules, not the font file paths.
- It has a `peerDependencies: { next: ">=13.2.0" }`.
- Sources: [jsDelivr package.json](https://cdn.jsdelivr.net/npm/geist@1.8.1/package.json), [listing](https://data.jsdelivr.com/v1/packages/npm/geist@1.8.1?structure=flat)

**`inter-ui` 4.1.1** (OFL-1.1; community repackage by Philip Belesky; modified 2025-06-22)
- Contents: 76 `.woff2`.
- Files: `variable/InterVariable.woff2` (352,240 B, full) and `variable-latin/InterVariable-subset.woff2` (99,732 B).
- CSS: `inter-variable-latin.css`, `inter.css`.
- Includes `LICENSE.txt`.
- Sources: [listing](https://data.jsdelivr.com/v1/packages/npm/inter-ui@4.1.1?structure=flat)

**`@ibm/plex-sans` 1.1.0** (OFL-1.1, with Reserved Font Name "Plex")
- Contents: 112 `.woff2` and 16 `.woff`.
- `fonts/complete/woff2/IBMPlexSans-Regular.woff2` (63,020 B), plus split subsets, e.g. `fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2` (20,984 B), with `-Latin2`, `-Latin3`, `-Pi`, `-Greek` and `-Cyrillic` variants.
- Includes `LICENSE.txt` plus `license.txt` in each font directory.
- It has `"postinstall": "ibmtelemetry --config=telemetry.yml"` and depends on `@ibm/telemetry-js`.
- The umbrella `@ibm/plex` package is at 6.4.1.
- Sources: [jsDelivr package.json](https://cdn.jsdelivr.net/npm/@ibm/plex-sans@1.1.0/package.json), [listing](https://data.jsdelivr.com/v1/packages/npm/@ibm/plex-sans@1.1.0?structure=flat)

### Inferences
- For a no-bundler Node server, there are two options:
  - (a) **Vendor the files**, the most robust. Copy `inter-latin-wght-normal.woff2`, optionally the latin-ext file, and the `LICENSE` into `assets/fonts/` with an `OFL.txt` name, then commit them. This needs no runtime dependency.
  - (b) **Serve from `node_modules`** via `require.resolve()` or `import.meta.resolve()` on `@fontsource-variable/inter/files/...woff2`. This is permitted by its `exports` map. It is a devDependency-free runtime read, but it makes the package a production dependency.
- Don't use Fontsource's own `wght.css` as-is. It uses relative `./files/` URLs and `font-display: swap` with all 7 subsets. Hand-write the 1–2 `@font-face` rules instead.
- For `geist` and `@ibm/plex-sans`, resolving deep paths via `require.resolve` would be blocked by `exports` in geist's case. Reading by filesystem path still works, but it's brittle. Plex's telemetry postinstall is a supply-chain and privacy consideration. If Geist or Plex is wanted, prefer `@fontsource-variable/geist` or `@fontsource/ibm-plex-sans`. (Plex Sans variable availability on Fontsource is not verified here.)
- Size budget: Inter latin variable is about 47 KB, Manrope latin variable about 24 KB, and Geist full variable about 68 KB. Inter's latin subset is about 7x smaller than the full InterVariable (344 KB).

### Gaps
- I didn't verify whether `@fontsource-variable/ibm-plex-sans` exists, or its file list.
- I didn't verify the `inter-ui` `exports` map (only `main: inter.css` was seen).
- The geist package's LICENSE copyright is "2023 Vercel, in collaboration with basement.studio", while Fontsource's copy says "2024 The Geist Project Authors". Both are OFL with no RFN in the header line.

## 6. Subsetting: is Latin enough for English UI with names and NZD?

### Takeaway
The Fontsource "latin" subset covers English text, `$`, NZD formatting, curly quotes, en and em dashes, the ellipsis, bullets, the Euro sign, ™ and the minus sign. It does not cover Māori macron vowels (ā ē ī ō ū and their capitals, U+0100–017F), which are likely to appear in New Zealand names and place names. Those are in latin-ext. Ship both faces with `unicode-range`. latin-ext is then downloaded only on pages that actually contain such characters.

### Cited Findings
- Fontsource Inter latin `unicode-range`: `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD`. — [jsDelivr wght.css](https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/wght.css)
- latin-ext range: `U+0100-02BA, U+02BD-02C5, ..., U+1E00-1E9F, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF`. — [jsDelivr wght.css](https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/wght.css)
- web.dev recommends pairing `unicode-range` with subset files. — [web.dev](https://web.dev/articles/font-best-practices)

### Inferences
These are standard Unicode code points, not separately sourced.
- **In latin:**
  - U+2000–206F General Punctuation: ‘ ’ “ ” (U+2018–201D), – (U+2013), — (U+2014), … (U+2026), • (U+2022), thin and narrow no-break spaces (U+2009, U+202F)
  - U+0000–00FF: $ (U+0024), £, ¥, ©, ®, °, ×, ÷, the no-break space, and accented letters for Western European names (é, ü, ñ, ç, ø)
  - € (U+20AC), ™, − (U+2212), ↑ ↓
  - U+02BB (ʻokina), which suits Hawaiian rather than Māori
- **In latin-ext:**
  - Māori macrons: Ā ā (U+0100/0101), Ē ē (U+0112/0113), Ī ī (U+012A/012B), Ō ō (U+014C/014D), Ū ū (U+016A/016B)
  - Central and Eastern European letters (ł, ś, č, ő)
  - The Indian rupee sign ₹ (U+20B9) and most other currency symbols U+20A0–20C0 except €
- **Neither subset:** → (U+2192) and ✓ (U+2713) are not in Fontsource's latin range. They fall back to the system font. ← (U+2190) is also absent; only ↑ and ↓ are listed.
- The Inter latin-ext variable file is 85 KB, larger than latin's 48 KB. With `unicode-range` it costs nothing unless a macron appears. For a NZ insurance tool, client names are likely to contain macrons, so include it rather than risking mixed-font rendering inside a name.
- Combining U+0304 (combining macron) is listed in both ranges, so decomposed macrons also render.

### Gaps
- I didn't confirm that Inter's latin-ext file actually contains glyphs for every code point in its range. The `unicode-range` declares intent; glyph coverage is per font. This is likely for Inter, but not verified.

## 7. SIL OFL 1.1 obligations when redistributing font files in a repo

### Takeaway
Self-hosting is explicitly allowed. The licence text must accompany the font, so commit `OFL.txt` or `LICENSE` next to the `.woff2` files, keeping the original copyright line. Subsetting or format conversion counts as a Modified Version. That matters only for fonts with a Reserved Font Name:
- Inter, Geist, Manrope and Plus Jakarta Sans declare no RFN in their licence headers, so the unmodified Fontsource subsets can be used under their original names.
- IBM Plex reserves "Plex". A self-made subset of Plex must not be called "Plex" inside the font's naming tables. Using IBM's own pre-split files avoids this.

### Cited Findings
- FAQ version 1.1-update7 (Nov 2023), page last updated 12 Jan 2026. — [OFL FAQ](https://openfontlicense.org/ofl-faq/)
- FAQ 2.1: hosting webfonts on your own server is "recommended and explicitly allowed by the licensing model because it is distribution." — [OFL FAQ](https://openfontlicense.org/ofl-faq/)
- FAQ 1.10: the only situation where an OFL font can be distributed without the OFL text is when it's embedded in a document or bundled in a program. Otherwise, the licence must accompany the font, as a separate file or in the font metadata. A URL reference in metadata is "strongly recommend[ed] against". — [OFL FAQ](https://openfontlicense.org/ofl-faq/)
- FAQ 2.2 / 2.2.1: a format change is normally modification, so RFNs can't be used. WOFF can keep the name only if the data is unchanged except for WOFF compression and the metadata is omitted or identical. FAQ 2.6: subsetting is modification and "would not normally allow the use of RFNs". FAQ 2.5: optimized versions are Modified Versions. — [OFL FAQ](https://openfontlicense.org/ofl-faq/)
- FAQ 3.8 / 5.7: renaming is required only if RFNs are declared, and no names are reserved by default. — [OFL FAQ](https://openfontlicense.org/ofl-faq/)
- The licence headers show:
  - Inter: "Copyright 2016 The Inter Project Authors" (no RFN) — [LICENSE](https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/LICENSE)
  - Geist: "Copyright (c) 2023 Vercel, in collaboration with basement.studio" (no RFN) — [LICENSE.txt](https://cdn.jsdelivr.net/npm/geist@1.8.1/LICENSE.txt)
  - Manrope: "Copyright 2019 The Manrope Project Authors" (no RFN) — [LICENSE](https://cdn.jsdelivr.net/npm/@fontsource-variable/manrope@5.3.0/LICENSE)
  - Plus Jakarta Sans: "Copyright 2020 The Plus Jakarta Sans Project Authors" (no RFN) — [LICENSE](https://cdn.jsdelivr.net/npm/@fontsource-variable/plus-jakarta-sans@5.3.0/LICENSE)
  - IBM Plex: "Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"" — [LICENSE.txt](https://cdn.jsdelivr.net/npm/@ibm/plex-sans@1.1.0/LICENSE.txt)

### Inferences
- Practical checklist:
  - (1) Commit `assets/fonts/OFL.txt`, copied verbatim from the package's LICENSE including the copyright line.
  - (2) Optionally note the font name, version, source package and version in a short `assets/fonts/README` or `NOTICE`.
  - (3) Don't rename the internal font names, and don't sell the font by itself. The OFL forbids selling the font on its own, though that is not in the excerpts fetched here.
  - (4) The CSS `font-family` name in `@font-face` is just a local alias. It is not the font's internal name, so choosing "Inter Variable" or "AppSans" has no RFN implication.
- Fontsource's subsets are themselves Modified Versions, made by subsetting Google Fonts' builds. Since Inter, Geist, Manrope and Plus Jakarta Sans declare no RFN, that's fine. Fontsource ships the licence alongside each package.
- If the app is distributed to a client as a packaged program, FAQ 1.10's "bundled in a program" carve-out may apply. Including `OFL.txt` anyway is the safe default.

### Gaps
- I didn't read the full OFL licence text in this session; condition details such as "no sale by itself" come from general knowledge, not a quoted source.
- I didn't verify whether Fontsource's IBM Plex Sans subsets keep the "Plex" name internally, which would be an RFN question for Fontsource rather than for the user.
