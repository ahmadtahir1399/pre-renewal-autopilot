# Open-licence UI typefaces for a calm, data-dense B2B/finance approval dashboard (2025-2026)

Method note (applies to every "measured" figure below): On 2026-10-20 I pulled metadata from the Fontsource API, downloaded Fontsource's Latin WOFF2 files from jsDelivr, and downloaded the full variable TTFs from the google/fonts GitHub repo. I then checked them with fontTools 4.67.0: GSUB/GPOS feature tags, stylistic-set names, OS/2 x-height and cap height, and the advance widths of the default digits. I also built Latin subsets myself with pyftsubset: weight axis only, every other axis pinned to its default, WOFF2 output. These are first-hand measurements of the cited files, not numbers anyone published. The sources are:
- Fontsource metadata: `https://api.fontsource.org/v1/fonts/<id>` and `https://api.fontsource.org/v1/variable/<id>`
- Fontsource files: `https://cdn.jsdelivr.net/fontsource/fonts/<id>:vf@latest/latin-wght-normal.woff2` and `.../<id>@latest/latin-<weight>-normal.woff2`
- Full fonts: `https://github.com/google/fonts/tree/main/ofl/<dir>`

The runtime constraint (no Google Fonts or CDN) only limits where the files are served from. Every candidate below can be downloaded once and served from your own origin.

## 1. Licence: exact terms and whether you can bundle and self-host

### Takeaway
Every candidate is licensed SIL OFL 1.1, including all 12 requested plus Inter Tight, Source Sans 3, Work Sans, Red Hat Text and Noto Sans. The OFL allows bundling the files with a project and serving them from your own server. The one restriction to flag is Reserved Font Names (RFNs): IBM Plex ("Plex"), Mona Sans ("Mona"), Hubot Sans ("Hubot") and Source Sans 3 ("Source") have them. That matters if you subset or modify the files and then distribute them under the original name.

### Cited Findings
- Fontsource API lists the licence as `OFL-1.1` for Inter, Geist, Manrope, Plus Jakarta Sans, IBM Plex Sans, Public Sans, Figtree, Onest, Instrument Sans, Mona Sans, Hubot Sans, DM Sans, Schibsted Grotesk, Inter Tight, Source Sans 3, Work Sans, Red Hat Text and Noto Sans (queried 2026-10-20) — [Fontsource API, e.g. Inter](https://api.fontsource.org/v1/fonts/inter)
- The METADATA.pb file for each font in the google/fonts repo says `license: "OFL"` and names the upstream repo. Inter is at rsms/inter, Geist at vercel/geist-font, Manrope at googlefonts/manrope, Plus Jakarta Sans at tokotype/PlusJakartaSans, IBM Plex Sans at googlefonts/plex, Public Sans at uswds/public-sans, Figtree at erikdkennedy/figtree, Onest at simpals/onest, Instrument Sans at Instrument/instrument-sans, Mona Sans at github/mona-sans, Hubot Sans at github/hubot-sans, DM Sans at googlefonts/dm-fonts, and Schibsted Grotesk at schibsted/schibsted-grotesk — [google/fonts repo, ofl/ directory](https://github.com/google/fonts/tree/main/ofl)
- RFNs as written in each font's OFL.txt in google/fonts:
  - IBM Plex: "Copyright © 2017 IBM Corp. with Reserved Font Name 'Plex'" — [ofl/ibmplexsans/OFL.txt](https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsans/OFL.txt)
  - Mona Sans: "with Reserved Font Name 'Mona'" — [ofl/monasans/OFL.txt](https://raw.githubusercontent.com/google/fonts/main/ofl/monasans/OFL.txt)
  - Hubot Sans: "with Reserved Font Name 'Hubot'" — [ofl/hubotsans/OFL.txt](https://raw.githubusercontent.com/google/fonts/main/ofl/hubotsans/OFL.txt)
  - Source Sans 3: "with Reserved Font Name 'Source'", and "Source is a trademark of Adobe" — [ofl/sourcesans3/OFL.txt](https://raw.githubusercontent.com/google/fonts/main/ofl/sourcesans3/OFL.txt)
  - No RFN in the OFL.txt copyright lines for Inter, Inter Tight, Geist, Manrope, Plus Jakarta Sans, Public Sans, Figtree, Onest, Instrument Sans, DM Sans, Schibsted Grotesk, Work Sans or Red Hat Text — [google/fonts ofl/](https://github.com/google/fonts/tree/main/ofl)
- Inter: "free and open source", under SIL OFL 1.1 — [rsms.me/inter](https://rsms.me/inter/)
- Geist: SIL OFL. Vercel offers it three ways: the npm package `geist`, Google Fonts / `next/font/google`, and a .zip of OTF, WOFF2 and variable files from the GitHub releases — [vercel.com/font](https://vercel.com/font)
- Mona Sans: SIL OFL 1.1. The repo recommends `Mona Sans.woff2` for web use — [github.com/github/mona-sans](https://github.com/github/mona-sans) (via search summary)
- Public Sans: SIL OFL 1.1. The repo ships webfonts, OTFs, variable fonts and sources — [uswds/public-sans README](https://raw.githubusercontent.com/uswds/public-sans/develop/README.md) (via search summary)
- Figtree: OFL, per the Google Fonts and Figma pages. One third-party site (fontalternatives.com) wrongly calls it a premium font that needs a commercial licence. The official pages contradict that — [Google Fonts Figtree about](https://fonts.google.com/specimen/Figtree/about); contradicted by [fontalternatives.com Figtree vs Inter](https://fontalternatives.com/compare/figtree-vs-inter/)

### Inferences
- The OFL allows using, bundling, embedding and redistributing the fonts with software, including commercial software. It does not allow selling the fonts on their own. A self-hosted `/fonts/*.woff2` folder inside the project, with the OFL.txt kept next to it, is the standard compliant setup.
- The OFL treats a subset or otherwise modified font as a "Modified Version". A Modified Version may not use a Reserved Font Name. So if you subset IBM Plex, Mona, Hubot or Source yourself, the safest choices are: (a) serve the unmodified upstream or Fontsource-published files, or (b) give the subset a different internal family name. My reading of the RFN clause is that the CSS `font-family` alias is not covered, but check the OFL FAQ before relying on that. Fonts without an RFN have no such concern.
- None of the candidates has a licence restriction that would block this project.

### Gaps
- I did not fetch the official OFL FAQ (openfontlicense.org) text on whether web subsetting counts as a Modified Version. The inference above comes from the OFL's RFN clause and should be checked there.
- I did not check whether upstream repos (for example vercel/geist-font releases or rsms/inter releases) add their own trademark notes beyond OFL.txt.

## 2. Tabular figures and other useful OpenType features (tnum, zero, case, ss/cv disambiguation)

### Takeaway
Most candidates have `tnum`. The exceptions are DM Sans, which has no tnum at all, and IBM Plex Sans and Source Sans 3, whose default digits are already tabular. The biggest practical finding is that Fontsource and Google-Fonts-API Latin files strip `zero`, `case` and every ss/cv feature. They keep only basic features such as tnum/pnum/frac. To get slashed zero or the I/l/1 disambiguation sets, self-host files built from upstream or full fonts. Inter is the most complete, followed by Geist, IBM Plex Sans, Source Sans 3, Mona/Hubot and Figtree.

### Cited Findings
**Full fonts (google/fonts repo TTFs; measured GSUB/GPOS tags):**

| Font (version) | tnum | default digits tabular? | zero | case | disambiguation / useful sets |
|---|---|---|---|---|---|
| Inter 4.001 (GF build) | yes | no (proportional) | yes | yes | ss01 "Open digits", ss02 "Disambiguation", ss04 "Disambiguation (no slashed zero)", cv01 "Alternate one", cv05 "Lower-case L with tail", cv08 "Upper-case i with serif", cv09 "Flat-top three", plus cv02–cv04 open 4/6/9, cv11 single-storey a, ss03 round quotes, ss05–ss08 circled/squared chars, `cpsp`, `dlig`, `frac`, `sups` |
| Inter Tight 3.004 | yes | no | yes | yes | ss01 open digits, ss02 Disambiguation, ss04 Disambiguation (no slashed zero), cv01–cv11 |
| Geist 1.800 | yes | no | no | yes | ss03 "Alt l", ss05 "Alt I", ss09 "Alt numbers", ss01/ss02 alt a, ss04 alt R, ss06 alt G, ss07 alt arrows, ss08 rounded dot, `dlig`, `sups` |
| Manrope 4.505 | yes | no | no | yes | no ss/cv |
| Plus Jakarta Sans 2.071 | yes | no | no | yes | ss01–ss03 (Lancip/Lurus/Lingkar alternates, stylistic, not disambiguation), `cpsp` |
| IBM Plex Sans 3.201 | no tag | **yes** (no pnum either) | yes | no | ss03 "slashed number zero", ss04 "dotted number zero", ss01 simple a, ss02 simple g, `onum`/`lnum`, `salt` |
| Public Sans 2.001 | yes | no | no | no | ss01 (unnamed), `onum`/`lnum`, `salt` |
| Figtree 2.002 | yes | no | no | yes | ss02 "Disambiguation", ss01 single-storey a, `sups`/`subs` |
| Onest 2.001 | yes | no | no | yes | ss01/ss02 (unnamed), `salt` |
| Instrument Sans 1.000 | yes | no | no | yes | ss01–ss12 (round dots, single-storey a, alt y/K/R/M/G/J/Q/2/&, ss12 "Alternate Currency"). None targets I/l/1 |
| Mona Sans 2.000 | yes | no | no | yes | ss02 "Wider uppercase I", ss03 "Lowercase l with tail", ss04 "Lowercase l with top serif", ss08 "Tabular zero with straight bar", ss01 square dots, ss05/ss06 double-storey a/g |
| Hubot Sans 2.000 | yes | no | no | yes | ss02 "Alternate lowercase l", ss04 "Serifless uppercase I", ss01 rounded dots, ss03 alt r |
| DM Sans 4.004 | **no** | no | no | yes | ss07 "Alternative Numbers", ss01–ss08 (alt a/g/u/y/Q, roundel) |
| Schibsted Grotesk 1.100 | yes | no | yes | yes | no ss/cv, `dlig` |
| Source Sans 3 3.052 | no tag | **yes** (pnum available) | yes | yes | ss01 "Serifed I", ss05 "Simple l", ss10 "Dotted zero", ss09 "Capital figures", cv01–cv19, `onum`, `smcp` |
| Work Sans 2.012 | yes | no | yes | yes | ss01–ss06 (unnamed), `swsh`, `smcp` |
| Red Hat Text 1.030 | yes | no | yes | yes | ss01/ss02 (unnamed) |

Sources: measured from the google/fonts TTFs, e.g. [ofl/inter](https://github.com/google/fonts/tree/main/ofl/inter), [ofl/geist](https://github.com/google/fonts/tree/main/ofl/geist), [ofl/ibmplexsans](https://github.com/google/fonts/tree/main/ofl/ibmplexsans), [ofl/monasans](https://github.com/google/fonts/tree/main/ofl/monasans), [ofl/dmsans](https://github.com/google/fonts/tree/main/ofl/dmsans), [ofl/sourcesans3](https://github.com/google/fonts/tree/main/ofl/sourcesans3).

- **Fontsource and Google-API Latin files lose most of these features.** In all 18 Fontsource `latin-wght-normal.woff2` files, the GSUB tags were limited to calt/ccmp/dnom/frac/liga/locl/numr/pnum/tnum/rvrn/cswh. No file had `zero`, `case`, `ss**` or `cv**`. For example, Inter's Fontsource file had only `calt, ccmp, dnom, frac, locl, numr, pnum, tnum`. The DM Sans Fontsource file also has no tnum, and neither do IBM Plex Sans or Source Sans 3, whose digits are tabular by default — measured from [Fontsource/jsDelivr Inter VF](https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2) and siblings
- Vercel confirms the same thing for Geist. The npm and .zip versions support `font-feature-settings`; Google Fonts does not, and it also serves only a partial glyph set — [vercel.com/font](https://vercel.com/font)
- Inter's own descriptions of the features:
  - `tnum` gives fixed-width figures for aligning numeric columns.
  - `zero` gives a slashed zero to tell 0 from o.
  - `case` gives forms that suit capitals and numbers.
  - ss02 and ss04 are disambiguation sets: ss02 includes the slashed zero, ss04 does not.
  - cv01–cv13 include an alternate one, lowercase L with a tail, and flat-top three. The full GF build also has cv14 "Alternate capital sharp S".
  — [rsms.me/inter](https://rsms.me/inter/)
- Public Sans lists tabular (monospaced) numerals as a feature and names "good data design with tabular figures" as a design goal. Its FONTLOG records italic tabular figures and currency glyphs added in v1.007 — [uswds/public-sans README](https://raw.githubusercontent.com/uswds/public-sans/develop/README.md); [Public Sans FONTLOG (npm mirror)](https://cdn.jsdelivr.net/npm/public-sans@0.1.7-1/FONTLOG.txt) (via search summary)
- Mona Sans README lists stylistic sets ss01, ss03 and ss05, and seven ligatures — [github.com/github/mona-sans](https://github.com/github/mona-sans) (via search summary). The GF 2.0 build has ss01–ss08 (measured above).

### Inferences
- For money columns, `font-variant-numeric: tabular-nums` works on Fontsource files of every candidate with a tnum tag. On IBM Plex Sans and Source Sans 3 the digits are already tabular. On DM Sans it does nothing, so DM Sans is a poor fit for aligned amounts.
- For "0 vs O" and "I/l/1" distinctness in policy numbers and IDs:
  - Inter: `font-feature-settings: 'ss02'`, or `'zero','cv05','cv08'`.
  - Geist: `'ss03','ss05'`.
  - IBM Plex Sans: `'ss03'` (Plex's lowercase l and capital I may also be distinct by default; not verified).
  - Source Sans 3: `'ss01','zero'`.
  - Mona Sans: `'ss03'` or `'ss04'`, plus `'ss02'`.
  - Figtree: `'ss02'`.
  - All of these need self-built or upstream WOFF2s, not Fontsource files.
- Self-subsetting from the upstream or google/fonts TTF with `pyftsubset --layout-features='*' --flavor=woff2` keeps these features. Section 3 gives the size cost.

### Gaps
- I did not test which glyphs ss02 in Figtree or ss01/ss02 in Onest and Red Hat Text actually change (the sets are unnamed or only generically named in the fonts).
- I did not visually check whether IBM Plex Sans's default l and I are already distinct. The Plex upstream (github.com/IBM/plex) was not fetched.
- Upstream release builds can be newer than the google/fonts builds measured here and may have more features: Inter 4.1, the Geist releases on GitHub, and Mona Sans from github/mona-sans. Not measured.

## 3. Variable font availability, axes, and approximate Latin WOFF2 sizes

### Takeaway
Every candidate ships as a variable font. Only Inter (opsz 14–32) and DM Sans (opsz 9–40) have an optical-size axis. IBM Plex Sans, Instrument Sans, Mona/Hubot Sans and Noto Sans have a width axis. Latin weight-axis-only VF WOFF2s range from about 20 KB (Figtree) to about 49 KB (Work Sans). Inter is about 47 KB from Fontsource, and about 67 KB if you keep every OpenType feature. For three static weights the totals run about 34–73 KB.

### Cited Findings
- Fontsource axes (min–max), queried 2026-10-20 — [Fontsource variable API, e.g. Inter](https://api.fontsource.org/v1/variable/inter):
  - Inter: wght 100–900, opsz 14–32, ital
  - Geist: wght 100–900, ital
  - Manrope: wght 200–800 (no italic)
  - Plus Jakarta Sans: wght 200–800, ital
  - IBM Plex Sans: wght 100–700, wdth 75–100, ital
  - Public Sans: wght 100–900, ital
  - Figtree: wght 300–900, ital
  - Onest: wght 100–900 (no italic)
  - Instrument Sans: wght 400–700, wdth 75–100, ital
  - Mona Sans: wght 200–900, wdth 75–125, ital
  - Hubot Sans: wght 200–900, wdth 75–125, ital
  - DM Sans: wght 100–1000, opsz 9–40, ital
  - Schibsted Grotesk: wght 400–900, ital
  - Inter Tight: wght 100–900, ital
  - Source Sans 3: wght 200–900, ital
  - Work Sans: wght 100–900, ital
  - Red Hat Text: wght 300–700, ital
  - Noto Sans: wght 100–900, wdth 62.5–100, ital
- Inter 4.0 turned the separate Inter Display designs into an `opsz` axis in the variable font. They are also published as a static "Inter Display" family — [rsms/inter releases](https://github.com/rsms/inter/releases); [v4.0-beta9f notes](https://newreleases.io/project/github/rsms/inter/release/v4.0-beta9f). Inter's latest release is 4.1, dated 2024-11-16 — [Wikipedia: Inter (typeface)](https://en.wikipedia.org/wiki/Inter_(typeface)). Fontsource and google/fonts ship build 4.001 (measured name table).
- Inter's optical sizes run from "text" to "display". The display designs are meant for large sizes — [rsms.me/inter](https://rsms.me/inter/)
- Geist ships nine weights from Thin to Ultra Black. The .zip includes variable files. Geist Pixel is a separate variable family with an `ELSH` axis — [vercel.com/font](https://vercel.com/font)
- Mona and Hubot have weight, width and slant axes — [GitHub blog: Introducing Mona Sans and Hubot Sans](https://github.blog/news-insights/company-news/introducing-mona-sans-and-hubot-sans/) (via search summary)

**Measured Latin WOFF2 sizes (KB = bytes/1024).** Column A is the Fontsource weight-axis VF, normal style. Column B is three Fontsource statics (400+500+600). Column C is my own Latin subset of the full google/fonts TTF, weight axis only, keeping all layout features (ss/cv/zero/case), with the size using pyftsubset's default features in brackets:

| Font | A: Fontsource VF | B: 3 statics | Single static 400 | C: self-subset VF, all features [defaults] |
|---|---|---|---|---|
| Figtree | 19.7 | 33.6 | 11.1 | 20.4 [19.0] |
| Manrope | 24.3 | 41.3 | 13.8 | 23.8 [23.2] |
| Public Sans | 26.2 | 42.9 | 14.3 | 26.2 [24.5] |
| Plus Jakarta Sans | 26.7 | 35.5 | 11.5 | 32.8 [24.5] |
| Source Sans 3 | 28.2 | 45.9 | 15.3 | 49.7 [27.6] |
| Geist | 28.7 | 38.7 | 12.7 | 32.1 [27.2] |
| Instrument Sans | 29.4 | 50.3 | 16.5 | 37.6 [27.5] |
| Red Hat Text | 29.4 | 43.7 | 14.1 | 30.5 [28.7] |
| Onest | 33.0 | 44.4 | 14.4 | 36.7 [30.0] |
| Noto Sans | 35.0 | 39.2 | 12.8 | n/m |
| DM Sans | 36.1 | 41.6 | 13.9 | 39.4 [35.0] |
| Mona Sans | 38.9 | 61.3 | 20.5 | 48.1 [36.7] |
| Inter Tight | 43.8 | 65.7 | 21.5 | 54.8 [43.1] |
| IBM Plex Sans | 44.6 | 69.4 | 22.1 | 46.7 [43.4] |
| Schibsted Grotesk | 45.7 | 73.0 | 23.8 | 48.0 [42.9] |
| Inter | 47.1 | 70.7 | 23.1 | 67.5 [44.4] |
| Hubot Sans | 47.2 | 61.1 | 20.4 | 54.9 [40.8] |
| Work Sans | 49.1 | 60.3 | 19.4 | 75.8 [46.1] |

Sources: measured from [Fontsource/jsDelivr files](https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2) and [google/fonts TTFs](https://github.com/google/fonts/tree/main/ofl). "n/m" means not measured.

### Inferences
- For a page that needs 400/500/600 plus headings at 20–32px, one weight-axis VF beats three statics for every candidate except Plus Jakarta Sans and Noto Sans, where three statics are smaller.
- Inter is the heaviest mainstream choice once you keep all features (about 67 KB), but that is still one small file per style.
- Inter's opsz axis (text 14 to display 32) lines up almost exactly with the 12–15px body and 20–32px heading ranges. With `font-optical-sizing: auto` the browser picks the right optical size by itself, but only if the served file keeps the opsz axis. The Fontsource `latin-wght` file I measured is weight-only. Its fuller axis file, `latin-full-normal.woff2`, returned 404 at that URL, so take the opsz file from rsms/inter releases or subset the google/fonts `Inter[opsz,wght].ttf` yourself.
- Italic doubles the payload. A dashboard that never uses italic can skip it.

### Gaps
- I did not measure the size of a Latin subset of Inter with opsz kept (wght+opsz), or upstream rsms Inter 4.1 `InterVariable.woff2` sizes.
- I did not determine the Fontsource file naming for multi-axis VFs (`latin-full-normal` returned 404 for these fonts).

## 4. Legibility at small UI sizes (x-height, spacing, glyph distinctness, designer guidance)

### Takeaway
Measured x-height as a share of the em puts Inter and Inter Tight highest (0.546), then Manrope (0.540), Plus Jakarta Sans and Noto Sans (0.536), and Geist (0.530). Source Sans 3 (0.478), Red Hat Text (0.488), Figtree and Work Sans (0.500) and DM Sans (0.504) are lowest. Inter is the only candidate whose designer documents UI-focused small-size detailing (tall x-height, ink traps) and a full disambiguation toolkit. IBM Plex has Carbon's published dense-UI guidance behind it.

### Cited Findings
- Measured OS/2 x-height and cap-height divided by units-per-em:
  - Inter and Inter Tight: x 0.546, cap 0.728, x/cap 0.75
  - Manrope: x 0.540, cap 0.720
  - Plus Jakarta Sans: x 0.536, cap 0.745
  - Noto Sans: x 0.536
  - Geist: x 0.530, cap 0.710
  - Onest: x 0.527
  - Schibsted Grotesk: x 0.527
  - Public Sans: x 0.517
  - Mona Sans: x 0.517
  - Hubot Sans: x 0.516
  - IBM Plex Sans: x 0.516, cap 0.698
  - Instrument Sans: x 0.510
  - DM Sans: x 0.504
  - Figtree: x 0.500
  - Work Sans: x 0.500
  - Red Hat Text: x 0.488
  - Source Sans 3: x 0.478, cap 0.660
  — measured from the [Fontsource Latin VF files](https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2) and siblings
- Inter's "text" optical size has a tall x-height for lowercase legibility, plus contrast-enhancing details such as ink traps and bridges. Inter is described as general-purpose, "from detailed user interfaces" to signage — [rsms.me/inter](https://rsms.me/inter/)
- Carbon (IBM) builds on IBM Plex. Its "productive" type set is for dense, task-focused product UI and uses a 14px base. The "expressive" set uses 16px. Carbon advises against fluid type in product UI — [Carbon typography overview](https://carbondesignsystem.com/elements/typography/overview/); [Carbon v10 productive](https://v10.carbondesignsystem.com/guidelines/typography/productive)
- Figtree: Google Fonts and Figma describe it as "clean yet friendly" for web and mobile apps. A reviewer credits its legibility at small sizes to a large x-height, generous apertures and uniform strokes. Note that this reviewer's "large x-height" claim does not match my measured 0.500, which is low for this set — [Google Fonts Figtree about](https://fonts.google.com/specimen/Figtree/about); [pimpmytype Figtree](https://pimpmytype.com/font/figtree) (via search summary)
- Geist's stated intent is simplicity, minimalism and speed, drawing on Swiss design, with a focus on "precision, clarity, and functionality". It began as a monospace for coding readability — [vercel.com/font](https://vercel.com/font)
- Public Sans is "strong, neutral" and built for federal government websites. It is a fork of Libre Franklin — [uswds/public-sans README](https://raw.githubusercontent.com/uswds/public-sans/develop/README.md) (via search summary)
- Mona Sans is described as a versatile grotesque inspired by industrial-era grotesques — [GitHub blog](https://github.blog/news-insights/company-news/introducing-mona-sans-and-hubot-sans/) (via search summary)

### Inferences
- At 12–13px, a higher x-height (Inter, Manrope, Plus Jakarta Sans, Geist) makes lowercase look larger at the same font-size. Source Sans 3 and Red Hat Text will look a size smaller at the same px and may need 1px more.
- Inter's x/cap of 0.75 is about the same as Geist, Manrope and Plex. It differs mainly in absolute size per em, so Inter set at 13px reads close to others at 14px.
- For a finance approval page, the most direct legibility controls are disambiguation sets (section 2) plus tnum. Inter, Geist, Plex, Source Sans 3, Mona Sans and Figtree have them.

### Gaps
- I did not retrieve Inter's published "dynamic metrics" / size-dependent tracking guidance. It was not in the first 100k characters of rsms.me/inter that I read.
- I did not find published small-size guidance from the designers of Manrope, Plus Jakarta Sans, Onest, Instrument Sans or Schibsted Grotesk.
- Default letter-spacing (sidebearings) was not measured. OS/2 x-height is the font's self-reported value and was not checked against outlines.

## 5. Overuse / "AI default" perception and calm vs trendy (2025-2026 commentary)

### Takeaway
In 2025–2026 commentary, Inter is the font most often named as the generic or "AI slop" default. Geist increasingly appears in lists of AI defaults too. The commentary is practitioner opinion, not measured data. Its usual advice is that the problem is a font nobody chose rather than a bad font, and it recommends IBM Plex Sans, Geist or Inter Tight as body alternatives.

### Cited Findings
- aiskill.market (Duke Harewood, 2026-06-07) argues:
  - Coding agents default to Inter, Roboto, Arial and Space Grotesk because these fonts carry no brand identity and are the most common in training data.
  - That makes output look generic and machine-made.
  - The fonts are fine in themselves; the problem is that nobody chose them.
  - It suggests Geist or IBM Plex Sans as the body face to replace Inter, and Inter Tight to replace Arial/Helvetica.
  — [Banning Inter: Why Font Defaults Are the Slop Tell](https://aiskill.market/blog/banning-inter-the-font-tell)
- A blog lists "purple gradients, Inter type, and grids of icon boxes" as a recognisable AI aesthetic and attributes it to LLMs reproducing the median Tailwind tutorial — [Why Your AI Keeps Building the Same Purple Gradient Website (prg.sh)](https://scour.ing/@emschwartz/p/https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website) (via search summary; undated in snippet)
- A community Claude "typography expert" skill explicitly retires "overused AI-design defaults (Inter, Roboto, Montserrat, Poppins, Fraunces, Geist, Söhne...)" — [claudeskills.info typography-expert](https://claudeskills.info/zh/skills/curiositech/some_claude_skills/typography-expert/) (via search summary; a community list, not independent evidence)
- Startup-branding guides call Inter "the default tech workhorse". One asks why almost every modern startup looks typographically similar, and suggests letting spacing, colour and weight do the styling, or pairing Inter with a serif for headings. These sources are often font-alternative or vendor sites with a commercial interest — [fontalternatives.com startup pairings](https://fontalternatives.com/blog/font-pairings-startup-branding-free-alternatives/); [UX Planet: Your product looks amateur](https://uxplanet.org/your-product-looks-amateur-its-probably-your-fonts-7b61fea6b363) (via search summary)

### Inferences
- Inter on a client-facing approval page reads as competent and neutral, but in 2026 it may also read as "default/template".
- The commentary names Geist as an alternative to Inter and also as an AI default. Both readings exist.
- The commentary repeatedly offers IBM Plex Sans as the more distinctive but still serious option. That, and its corporate (IBM) and dense-UI (Carbon) heritage, suggest it would read as calm and institutional, a plausible fit for insurance and finance.
- Public Sans (US government) and Source Sans 3 (Adobe) are likely to read as neutral and institutional rather than trendy. This is an inference from their origins; I found no 2025–2026 commentary on them.
- Plus Jakarta Sans, Manrope, DM Sans, Onest and Instrument Sans carry more geometric or "startup marketing" personality. I found no direct sourced commentary, so treat this as unverified opinion.

### Gaps
- I found no rigorous 2025–2026 data on font prevalence (no usage-share study of SaaS or AI-generated sites).
- I found no sourced 2025–2026 commentary specifically on Manrope, Plus Jakarta Sans, Onest, Instrument Sans, Schibsted Grotesk or DM Sans fatigue. Typewolf was not fetched.

## 6. Notable products and design systems using each font (evidence of dense-UI suitability)

### Takeaway
The best-documented dense-UI pedigrees are:
- IBM Plex: IBM Carbon's productive type set.
- Public Sans: USWDS, the default for US federal sites.
- Geist: Vercel's own product and developer typeface.
- Mona/Hubot Sans: GitHub's brand and homepage.
- Inter: cited by its designer for computer interfaces, NASA instrumentation and medical equipment.

The others are mostly Google-Fonts-distributed faces from agencies and companies (Instrument, Schibsted, Simpals, Tokotype, Colophon). I found little sourced evidence of their use in dense product UI.

### Cited Findings
- Inter: rsms.me says it is used in computer interfaces, advertising, airports, NASA instrumentation and medical equipment — [rsms.me/inter](https://rsms.me/inter/)
- IBM Plex: the IBM Carbon Design System's typography is built on IBM Plex. The `@carbon/type` package provides Plex font faces and productive and expressive token sets — [Carbon typography overview](https://carbondesignsystem.com/elements/typography/overview/); [Carbon type package](https://github.com/lee-chase/carbon/blob/main/packages/type) (fork; via search summary)
- Geist: designed by Vercel "for developers and designers" and distributed through `next/font`. The designers listed on Google Fonts include Guillermo Rauch and Evil Rabbit (Vercel). It was added to Google Fonts on 2024-10-02 — [vercel.com/font](https://vercel.com/font); [google/fonts ofl/geist METADATA](https://github.com/google/fonts/tree/main/ofl/geist)
- Public Sans: created by USWDS "for use across federal government websites" — [uswds/public-sans README](https://raw.githubusercontent.com/uswds/public-sans/develop/README.md) (via search summary)
- Mona Sans: Fonts In Use documents the GitHub homepage (2022) using Mona Sans. GitHub designed Mona Sans with Degarism as a primary typeface across mediums — [Fonts In Use: GitHub homepage 2022](https://fontsinuse.com/uses/50805/github-homepage-2022); [GitHub blog](https://github.blog/news-insights/company-news/introducing-mona-sans-and-hubot-sans/) (via search summary)
- Origins from google/fonts METADATA (designer, upstream repo, date added to Google Fonts) — [google/fonts ofl/](https://github.com/google/fonts/tree/main/ofl):

| Font | Designer / origin | Upstream repo | Added |
|---|---|---|---|
| Figtree | Erik Kennedy (UX/UI designer) | — | 2022-07-21 |
| Onest | Dmitri Voloshin, Andrey Kudryavtsev | simpals/onest | 2023-09-06 |
| Instrument Sans | Rodrigo Fuenzalida, Jordan Egstad | Instrument/instrument-sans | 2023-04-13 |
| Schibsted Grotesk | Bakken & Bæck, Henrik Kongsvoll | schibsted/schibsted-grotesk | 2023-03-03 |
| Plus Jakarta Sans | Tokotype | — | 2022-03-24 |
| Manrope | Mikhail Sharanda | — | 2019-10-03 |
| DM Sans | Colophon Foundry | — | 2019-06-12 |
| Red Hat Text | MCKL | RedHatOfficial/RedHatFont | — |
| Source Sans 3 | Paul D. Hunt | adobe-fonts | — |

### Inferences
- For "calm, precise, finance-grade", three candidates have the strongest documented institutional, dense-UI lineage: IBM Plex Sans (Carbon productive, 14px base), Public Sans (USWDS, explicit data-design goal for tabular figures) and Inter (UI-first, the richest disambiguation features). Geist is a credible modern alternative with a precise, Swiss-inspired brief. Mona Sans, from GitHub, is a credible but more brand-flavoured option.
- Here is a likely top-3 for the designer to weigh, based on tnum, disambiguation features, size, and low "AI default" risk:
  - IBM Plex Sans: tabular digits by default, slashed or dotted zero via ss03/ss04, Carbon dense-UI pedigree. Watch the RFN if you subset.
  - Inter with its opsz axis: the best feature set and an opsz range that matches the 14–32px design ranges, but it carries the "default" perception risk.
  - Public Sans or Geist: Public Sans is neutral, institutional and small (26 KB VF). Geist has a high x-height, ss03/ss05 for l/I, and a 29–32 KB VF, but it is also starting to be named as an AI default.
  - DM Sans should be excluded for this use because it has no tnum.

### Gaps
- Fonts In Use, Typewolf and similar sites were not searched for factual product usage of Manrope, Plus Jakarta Sans, Onest, Instrument Sans, Schibsted Grotesk or DM Sans, so I have no sourced dense-UI usage examples for them.
- No verified list of named companies using Inter or Geist in product UI was fetched. Known examples from memory were left out because they are unsourced.
