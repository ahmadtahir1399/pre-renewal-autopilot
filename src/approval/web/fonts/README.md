# Approval page font: Geist (self-hosted)

Served by the approval page itself from `/assets/fonts/<name>.<hash>.woff2` (CSP `font-src 'self'`). No CDN at runtime.
Prompt 8 replaced IBM Plex Sans with Geist (the type system dealt for the page's "achromatic ledger" style).

| File | Bytes | sha256 | Source |
| ---- | ----- | ------ | ------ |
| geist-latin-wght.woff2 | 29400 | 19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1 | npm `@fontsource-variable/geist@5.3.0`, `files/geist-latin-wght-normal.woff2` |
| geist-latin-ext-wght.woff2 | 16512 | 824f485b5d26e2f2da3c2b236132ece1bc8e4e43373452950bb0e40548b4313f | npm `@fontsource-variable/geist@5.3.0`, `files/geist-latin-ext-wght-normal.woff2` |
| OFL.txt | 4486 | 71609cbb5c78b5870d712eab73a31d76622635c6ed034ab5cee3b9ecbda8685f | npm `@fontsource-variable/geist@5.3.0`, `LICENSE` |

Licence: SIL Open Font License 1.1, Copyright 2024 The Geist Project Authors. The files are used unmodified (the
subsets were made by the distributor, Fontsource). The CSS family name used by the stylesheet ("App Sans") is only a
local alias.

Variable weight axis (100-900). The latin file covers English text, currency, curly quotes and dashes; the latin-ext
file covers Maori macron vowels (U+0100-017F) and is only downloaded by the browser when a page contains such
characters (unicode-range). The package is a devDependency only so the files can be refreshed; at runtime the copies
in this folder are served.
