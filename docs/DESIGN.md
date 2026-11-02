# Design System: Pre-Renewal Autopilot approval page

Status: BUILT (Prompt 6), extended for uploads (Prompt 7, section 16), REDESIGNED light and blue with GSAP motion
(Prompt 8, section 17, D-125). Where sections 1-15 disagree with section 17, section 17 wins.
Scope: the local approval page (src/approval/web) and, secondarily, the comparison spreadsheet styling.
Checklist of every page and state: docs/UI_INVENTORY.md.

## 1. Personality

**Calm. Exact. Accountable.**

A quiet, well-lit desk at 9am: ten folders, each with one clear note on top saying what changed, where it is
written, and what signing will do. The broker should be able to trust the page before reading a paragraph.

Design read (taste-skill format): an Operate-mode work tool for one insurance broker reviewing about ten renewals,
in a trust-first, regulated-adjacent language, built with native HTML and one stylesheet (no framework, no JS).
Dials: VARIANCE 3 (predictable, aligned), MOTION 1 (static; state changes only), DENSITY 5 (a working list,
not an airy gallery and not a cockpit).

Not a startup landing page (no hero, no gradients, no marketing copy), not a dev tool (no monospace costume, no
jargon in the main view), not a banking clone (no brand blue, no borrowed identity).

## 2. Colour tokens (as built; source of truth: src/approval/web/tokens.ts)

LIGHT MODE ONLY (user's choice after the first draft; the dark theme in the draft was removed). Quiet, very slightly
warm near-neutral greys, one green-teal accent for the primary action, links, focus and the approved state, four
severity roles that never borrow the accent, a light sidebar. No gradients anywhere.

| Token | Hex | Use |
| ----- | --- | --- |
| bg / surface / surface-sunken / surface-raised | #F7F7F5 / #FFFFFF / #F3F3F1 / #FFFFFF | page, cards, table headers and quiet bands, decision panel |
| border / border-strong | #E2E2DE / #8A8984 | decorative hairlines / control outlines (inputs, secondary buttons) |
| text / text-muted | #1B1B19 / #5E5D58 | body / secondary |
| accent / accent-hover / on-accent | #0F6F5C / #0B5949 / #FFFFFF | primary button, links, focus ring |
| accent-tint / accent-ink | #E5F2EE / #0A4A3D | approved banner, done steps, High confidence |
| sev high tint/ink/glyph | #FCE9E6 / #8E1D17 / #C0352A | |
| sev medium tint/ink/glyph | #FCF1DA / #6B4500 / #A86A00 | |
| sev low tint/ink/glyph | #E7EFF9 / #1C4A80 / #2F63A6 | also Medium confidence |
| sev info tint/ink/glyph | #EFEFEC / #45443F / #6F6E68 | |
| mode-bar bg/text | #FCF1DA / #5A3A00 | the FAKE-LLM honesty bar |
| warn tint/ink/edge | #FCF1DA / #6B4500 / #A86A00 | sync problems, rejections, consent box, Low confidence, stopped step |
| sidebar bg/text/muted/active/border | #F0F0ED / #1B1B19 / #5E5D58 / #FFFFFF / #E2E2DE | |

### 2.1 Contrast (computed by `npm run check:contrast`, WCAG 2.x formula)

Every foreground/background pair the stylesheet uses is listed in CONTRAST_PAIRS (tokens.ts) and checked: text
4.5:1, controls / focus / meaningful shapes 3:1, decorative hairlines a 1.2 visibility floor only. Last run (Prompt 7,
2026-10-21): 55 pairs, all pass (lowest control pair: border-strong on surface-sunken 3.15:1, the file input outline).

### 2.2 The one deliberate exception
`--border` hairlines separate content (card edges, table rows). They do not identify a control, so WCAG 1.4.11 does
not apply to them. Every CONTROL is identified by something at 3:1 or more: a filled accent button, a 3:1
`--border-strong` outline, or link colour.

## 3. Typography (as built)

IBM Plex Sans (SIL OFL 1.1), self-hosted as two variable WOFF2 subsets (latin, latin-ext) under
`/assets/fonts/<name>.<hash12>.woff2`, alias "App Sans", with a system-font fallback stack. The CSP gained
`font-src 'self'` for this (user's choice, D-088). Base size 14px (`--fs-sm`), scale tokens `--fs-2xs` 12px up to
`--fs-3xl` 28px. `font-variant-numeric: tabular-nums` on every amount, date column and count; sentence case
everywhere; `text-wrap: balance` on headings. Monospace only for hashes inside the Technical details disclosure.

## 4. Spacing, radii, shadows, motion (as built)

- Spacing tokens on a 4px grid: --space-1 4px ... --space-9 64px; page gutter 16px narrow, 32px from 48rem.
- Radii: 6px controls and badges, 8px inner panels, 12px cards and banners, pill only for status pills.
- Shadows: hairline rings and one soft level (`--shadow-1`, `--shadow-2`), tinted to the ink hue.
- Motion: 120ms background-colour transitions and a 1px press on buttons only; removed under
  `prefers-reduced-motion: reduce`.

## 5. Severity design (never colour alone)

Every severity mark is three things at once: a WORD, a SHAPE and a COLOUR.

| Severity | Word shown | Shape (CSS-drawn, `clip-path` on a pseudo-element) | Colour role |
| -------- | ---------- | -------------------------------------------------- | ----------- |
| high | High | solid triangle | --sev-high-* |
| medium | Medium | solid diamond | --sev-medium-* |
| low | Low | solid circle | --sev-low-* |
| info | Info | hollow ring | --sev-info-* |

- The word is real text in the badge (tests assert it wherever a badge renders). The shape is decoration
  (`::before`, no text content), so screen readers hear only the word.
- The overall risk badge reuses the same marks, larger, with the label "Overall risk" before it.
- Grayscale / colour-blind: shape + word survive. Forced-colors (Windows High Contrast): backgrounds are overridden
  by the browser (confirmed on MDN), so the glyph gets `forced-color-adjust: none` with `background: CanvasText`
  and the badge gets a 1px `CanvasText` border; the word always remains.
- `clip-path` with basic shapes: MDN Baseline "widely available" since January 2020 (checked). Not checked per
  browser version beyond that badge.

## 6. Components (all states)

**App header** (`<header>`): product name "Pre-Renewal Autopilot" (links to the list), a quiet label "Concept
project - synthetic data", and a mode strip: "Run date 19 October 2026", "Drafts only: nothing is ever sent to a
client or an insurer", "Approver: <APPROVER_NAME>". Skip link "Skip to main content" is the first focusable element.

**FAKE-LLM bar** (required whenever fake mode is on): a full-width bar ABOVE the header, `--mode-bar-*` colours,
`role="note"`, text: "Demo mode: the policy terms on this page come from the answer keys, not from live AI reading of
the documents." Not dismissable, printed too. Absent when fake mode is off. (How the page knows: question 1.)

**Summary strip** (list page): four counts in one row (wraps on narrow): "Waiting for you 10", "Approved 1",
"Skipped 1", "Needs attention 2". Numbers tabular, label below number, each a link to its section. Not a hero metric.

**Policy card** (list): `<article>` on --surface with hairline and --shadow-1. Top row: client name (h3) + policy
type; right: overall risk badge. Second row: "Renews 25 January 2027, in 14 weeks". Body: up to three change lines,
each a severity badge + the stored sentence. "1 item needs your eye" line when flags exist. Footer row: Approve
(primary), Open spreadsheet (secondary), Skip (tertiary), "See all changes" link. States: in review (above);
decided (no buttons; resolved line "Approved by ... on ..."; Open still offered); sync failed (warn line); version
2+ ("Version 2" chip next to the title).

**Change row / diff table** (pack page): `<table>` with `<caption>` "What changed between the expiring policy and the
renewal offer. Amounts in NZD." Columns (`<th scope="col">`): Item, Expiring, Renewal, Change, Severity, Source.
Each row has `id="change-<n>"`; the row header (`<th scope="row">`) is the field label. Values come from the stored
diff (amounts via `formatAmount`, dates via `formatLongDate`, exclusions via the existing labels; nothing is
recomputed). Change column = the stored change kind in words ("Increased", "Decreased", "Added", "Removed",
"Changed"). Source = "Expiring page 4", "Renewal page 4" or "Page not recorded" (shown, never hidden). The stored
sentence sits under each row as the plain-English explanation. Empty: "No differences found between the expiring
policy and the renewal offer." Narrow screens: rows become stacked label/value blocks (CSS only), still a table to
assistive tech.

**Flag list**: `<ol>` of "Needs your eye" items: severity badge, field label, message, and a link "Go to the change"
(`#change-<n>`); the target row highlights via `:target` (outline in --focus). Empty: "Nothing needs your eye."

**Buttons** (real `<button>` inside a `<form method="post">` with the hidden `csrf` field; markup kept exactly as the
tests scrape it):
- Approve, primary: --accent fill, --on-accent text, 44px min height.
- Open spreadsheet, secondary: it is a GET download, so an `<a>` styled as a button with a --border-strong outline.
- Skip, tertiary: text-style button with underline on hover, --text-muted, same 44px hit area.
- States: hover (accent-hover / sunken fill), focus-visible (2px --focus outline, 2px offset), active (1px down),
  disabled (not used today; style defined, 3:1 exemption applies), already done (buttons removed, resolved banner
  shown instead). `:focus-visible` is MDN Baseline widely available since March 2022 (checked).

**Resolved banner** (after Approve/Skip and on any decided pack): --accent-tint panel with a check-shape glyph
(approved) or a neutral dash-shape glyph (skipped), `role="status"`, heading "Approved" or "Skipped", the existing
result sentence, the decision line "Approved by <name> on 18 October 2026 at 18:00 UTC (web page)", and the
link "Back to all renewals". Double submit: heading "Already approved", "Nothing changed.", same decision line.

**Notice card** (needs_attention): calm, --surface with an info glyph, client name and policy type (not the policy id),
reason in plain words ("The renewal document is missing." / "The expiring policy is a scanned image with no
readable text."), then "No comparison was prepared. Please check the documents for this renewal by hand." No buttons.

**Sync-failure banner**: --warn-tint, medium glyph, "Approved, but the drafts were not copied" or "Approved, but the
renewal status was not updated", "Nothing was sent. Run npm run retry-sync on this computer to finish." Shown on the
pack page and as a line on the decided card for as long as the stored sync state is not ok.

**Superseded message**: on an old version: "This is version 1. Version 2 replaced it." + link "Open version 2". The
Open spreadsheet link is hidden there (Open is refused for superseded packs today, so showing it was a dead end).

**Empty state** (nothing waiting): "Nothing is waiting for your decision." + "New renewals appear here after the next
morning run." Decided and needs-attention sections still render below it.

**Error pages** (403, 404, 405, 413, 500, 503, plus a 400 template): one shared layout, a short title, one sentence
of what to do, a link back to the list (except 403). No request text is ever reflected. 403 text: "This page needs
your sign-in link. Open the link printed in the terminal where serve is running." (Whether 403 becomes HTML at all:
question 3.)

**Audit panel** ("Activity for this renewal", pack page, read-only): `<ol>` timeline, newest last, max 50 events of
the pack's cycle. Each item: time ("19 October 2026, 17:51 UTC"), event in plain words, actor ("Autopilot",
"<APPROVER_NAME> (web page)", "<APPROVER_NAME> (command line)", "Telegram"). Details JSON is never shown: a
whitelist per event type builds at most one short sentence from known keys and known enum values (for example
`status_changed` -> "Status changed from In review to Approved"; `comparison_done` -> "Comparison done: overall risk
High, 1 change, 1 flag"); unknown types render as "Recorded event" with no details; error texts are not shown
("Saving the drafts failed. See npm run audit for details."). Every string escaped and capped at 160 characters.
Empty: "No activity recorded yet."

**Details disclosure** (`<details><summary>Technical details</summary>`): policy id, renewal cycle, pack number and
version, created at, content hash, input hash, sync state. The only place these appear.

## 7. Layout

- List page: one column, max-width 60rem, centred container with left-aligned content; sections in decision order:
  "Waiting for your decision" (sorted High -> Info, then soonest renewal), "Needs attention", "Decided".
- Pack page: two columns from 64rem up (`grid-template-areas`): main column (title, risk, changes table, flags,
  details) at about 2fr; side column at about 1fr with the decision panel and the activity timeline. Below 64rem it is
  one column in reading order: title, decision panel, changes, flags, activity, details. The decision panel is not
  sticky (keeps print and zoom simple).
- Works from 320px to wide monitors: no fixed widths, no horizontal page scroll; the table collapses as described.
- Landmarks on every page: `header`, `nav` (breadcrumb "All renewals / <client>"), `main`, `footer` (one line:
  "Concept portfolio project. Synthetic data only. Drafts only: nothing is ever sent."). `lang="en"` and a `<title>`
  on every page; one h1 per page; no skipped heading levels.

## 8. Print (pack page in black and white)

`@media print`: white background, black text, hide forms/buttons/skip link/nav, keep the FAKE-LLM bar text, badges
keep word + shape (`print-color-adjust: exact` on the glyph only), table header repeats on each page, rows avoid
breaking inside, the activity timeline prints, the Details disclosure prints only if open, links print without URLs.

## 9. Content design

- Plain words in the main view. No "cycleKey", "inputHash", "pack_json", "in_review" (labels: "In review",
  "Approved", "Skipped", "Needs attention", "Not started", "Drafted").
- Dates: "25 January 2027" (`formatLongDate`); instants: "19 October 2026, 17:51 UTC" (hand-built from the stored
  ISO string; no Date locale methods). Relative: "in 14 weeks" (existing `weeksUntil`).
- Buttons say what happens: "Approve", "Skip", "Open spreadsheet". Results repeat the verb: "Approved", "Skipped".
- No exclamation marks, no apologies, no em dashes or en dashes anywhere in the UI (taste-skill rule; also avoids
  ambiguity in copied text). Hyphen with spaces is the only dash.

## 10. Demo moments this must serve

1. The list reads at a glance: summary strip + risk-sorted cards with a visible risk badge on each.
2. A flagged change and its source page in under 3 seconds: "Needs your eye" list -> "Go to the change" -> row
   highlighted with "Renewal page 4" in its own column.
3. Approve is unmistakable: the page reloads with a large resolved banner at the top, buttons gone, decision line,
   "Back to all renewals".
4. The audit trail is visible on the same page: the activity timeline shows "Approved by ... (web page)".

## 11. Mechanism inside the CSP

- CSS delivery: one stylesheet module (src/approval/web/styles.ts, a string constant, so `npm run build` needs no copy
  step) served at `GET /assets/app.<sha256-12>.css` with `Content-Type: text/css; charset=utf-8`, `nosniff`,
  `Cache-Control: public, max-age=31536000, immutable`, an `ETag` equal to the hash, and 304 on `If-None-Match`. The
  hash in the URL means a stale cache can never hide a change. The route sits behind the Host check but not behind
  the session (so 403/404 pages are styled too); CSS holds no data. Any other `/assets/...` path: 404.
- CSP (as built): `style-src 'self'` and `font-src 'self'`; the full header is in section 14. Fonts are served from a
  whitelist of exact paths (FONT_ASSETS); nothing from the request touches the disk.
- No inline `style=""` attributes anywhere (tests assert it); no `<style>` blocks; no `@import`; the only `url()`
  values are the self-hosted font files.
- Native features used for interactivity without JS: `<details>/<summary>` (Details disclosure), `:target`
  (highlight a change reached from a flag), `:focus-visible`, `prefers-reduced-motion`,
  `forced-colors`, `text-wrap: balance` (progressive; MDN Baseline widely available since March 2024 for `text-wrap`,
  `balance` not separately badged). NOT used: `:has()`, `light-dark()`, container queries (not needed; I have not
  verified their support for this page).
- Not verified by me: exact rendering in Firefox and Safari (only the built-in Chromium-based pane is available here);
  Windows High Contrast rendering; real printer output (print preview only).

## 12. Spreadsheet (secondary)

Same roles in exceljs styles: header fill = --surface-sunken, severity fills = the four tints with the severity word
already in the cell, ink = --text, column widths, frozen header rows, number formats only where the cell already
holds a number (the D-053 text guard stays), print setup landscape, fit to one page wide, repeat header rows. Cell
VALUES and the contentHash must not change (the hash uses the model text, D-052); proven by the existing hash tests.

## 13. Public-file hygiene

- `design-reference/` (third-party collection, brand write-ups of unknown licence) is gitignored and never copied into
  the repo. The reference was read from a local copy outside the repo.
- `docs/ui-screens/` (screenshots) is gitignored.
- No brand colours, logos, names or wording from the reference appear in the UI; every hex above was chosen here and
  checked by script.

## 14. Decisions that closed the draft's open questions

1. FAKE-LLM detection: `run_started` records `fakeLlm`; the bar shows when serve has `--fake-llm` or any displayed
   pack came from a fake run (Prompt 7: or from a fake-mode upload analysis).
2. CSP: `style-src 'self'` for the separately served stylesheet, plus `font-src 'self'` for the self-hosted fonts
   (D-088). Final header: `default-src 'none'; style-src 'self'; font-src 'self'; img-src 'none'; form-action 'self';
   frame-ancestors 'none'; base-uri 'none'`. Byte-identical from Prompt 6 on (Prompt 7 did not change it).
3. Error responses are designed HTML pages with fixed text; the wrong-token test asserts the exact page.
Also: light mode only (user's choice); Referrer-Policy `same-origin` (D-087); times in UTC.

## 15. Influences

| Source | What it changed here |
| ------ | -------------------- |
| design-taste-frontend ("tasteskill", closest match to "taste-design-skill"; read in full from AI-Doctor-Assistance/.agents/skills) | design read + dials (trust-first: 3/1/5); one accent locked; one radius rule; no em dashes; no pure black; no decorative dots or eyebrows; button/form contrast checks; copy self-audit; dark mode via tokens. Its React/Tailwind/icon-library/web-font defaults rejected (CSP, no JS). Its own section 13 says dashboards are out of scope, so only its general rules were used. |
| impeccable (SKILL.md, reference/operate.md, reference/craft-floor.md; AI-Doctor-Assistance/.claude/skills; its binary NOT run) | Operate mode; system fonts allowed; scale ratio about 1.2; motion conveys state only; every component state listed; no coloured border-left above 1px; no unicode glyphs as icons (CSS shapes instead); theme focus rings and numerals; light/dark chosen from the use scene. |
| frontend-design (official plugin marketplace cache) | design plan before code; restraint ("remove one accessory"); sentence case, no all-caps labels; plain-verb copy; failure and empty states give direction. |
| redesign-existing-projects | audit first (docs/UI_INVENTORY.md); tabular numbers; skip link; designed 404; back navigation everywhere; no exclamation marks. |
| minimalist-ui | 1px hairlines, restrained radii, desaturated tints with dark text for badges. Its web fonts, icon libraries, scroll animations and textures rejected. |
| stitch-design-taste | structure of this DESIGN.md (atmosphere, named roles with hex, typography, components, layout, motion, bans). Its perpetual motion and font bans rejected. |
| dataviz (session skill) | status colours are reserved and always paired with icon + label; text wears text tokens, not status colours; compute contrast instead of eyeballing. |
| xlsx (session skill) | spreadsheet: match the file's existing conventions; professional font; no formula changes. Its openpyxl tooling does not apply (exceljs). |
| Reference: README | it is a collection of DESIGN.md write-ups of 73 public websites (YAML tokens + prose). |
| Reference: ibm (read in full) | a DESIGN.md shape with token front-matter, component variants per state, do/don't and known gaps; hairline + surface change instead of shadows; 4px grid; sentence-case labels; 44-48px touch targets. Its blue, square corners and type were NOT used. |
| Reference: wise, cal, stripe (overview, do/don't, elevation read) | one accent reserved for the primary action; status palette separate from the brand colour; tabular figures for money; hierarchical radii; low-alpha tinted shadows. Their colours, fonts and shapes were NOT used. |

## 16. Prompt 7 components (upload door; same tokens, same rules)

**Upload page** (`/analysis/new`): page head "Analyse documents"; a meta strip (file limits from the real env values,
"Analyses today N of M", retention); "What happens next" checklist (checks, same reader, never guessed, nothing sent);
two side-by-side cards (one column below 72rem): "Add a missing document to an existing policy" and "Analyse a new
policy"; "Recent analyses" list. AI not configured: a warn banner instead of the forms.

**Form controls** (native, no JS): `.input` text/email/select (36px, 1px --border-strong outline, 6px radius, focus ring
2px --focus); `.file` native file input on a dashed sunken area with a styled `::file-selector-button`; the consent
tick sits in a warn-tinted box with the exact U-7 sentence as its label; labels above fields, "(optional)" in muted
text, hints linked by `aria-describedby`. The CSRF hidden field is the FIRST field in every form. Rejections
re-render the page with a warn banner ("Not accepted") inside the form's card; text fields keep their (escaped)
values; files are never kept.

**Progress steps** (job page): an ordered list of five steps (Received, Checked the files, Read the documents,
Compared the terms, Prepared the pack); each has a round CSS glyph AND a word: Done (check), In progress (ring,
`aria-current="step"`, accent tint), Waiting (dash), Stopped (diamond, warn tint). Five columns from 56rem, stacked
below. While running the page refreshes itself with `<meta http-equiv="refresh" content="2">` (not script; verified
in the browser pane under the unchanged CSP: four reloads in about seven seconds, no console errors).

**Result banner** (job page): reuses the banner component: "Working on it" (neutral ring), "The pack is ready"
(done check, link to the pack), "No pack was prepared" / "Not accepted" / "Interrupted" (warn diamond) with the plain
reason and what to try next.

**Extracted facts table**: rows = the eight facts + key exclusions; columns = Expiring policy / Renewal offer, each
column header saying "Uploaded" or "From the policy records". A cell shows the value, a "Page N" source tag, a
confidence badge (word + glyph + colour: High = check on accent tint, Medium = dot on low-severity tint, Low =
triangle on warn tint), the quote in muted small text (truncated to 120 characters, the full text in a
`<details>` "Show the full text"), and any verification warning in plain words on a warn tint. Document text is
escaped; control and bidi characters are removed by escapeHtml.

**Documents panel**: one row per stored PDF (side, sanitised display name, pages, size, deleted time) plus "From the
policy records" for the side that was not uploaded; "Delete the uploaded PDFs" (secondary button in a POST form with
CSRF; the confirmation text stands next to it because there is no script); the deleted state says what was kept.

**Entry points**: list page head "Analyse documents" (secondary button), sidebar link "Analyse documents", and on a
needs-attention notice "Upload the missing document" (preselects the policy). Uploaded packs show an "Uploaded" chip
in the list, honest timing words (U-3: "in 5 days", "today", "expired 10 days ago") and a "Source: Uploaded manually
(analysis N)" line on the pack page.

**Fake mode**: the honesty bar adds "Fake mode: only known sample documents can be analysed." on the upload pages.

**Uploads local only**: through the public HTTPS origin (APPROVAL_PUBLIC_ORIGIN) every /analysis route answers a
designed 403 "Uploads work on this computer only" (D-109).

**Reading check panel** (job page, side column, when a job is done): a list of count rows, each a big tabular number
and one plain sentence: confirmed word for word (accent tint), confirmed on a second reading (accent tint), uncertain
and not found (warn tint), exclusions (neutral). Below: token counts (live) or the fake-mode sentence. A repaired
fact cell carries the note "Confirmed on a second reading" in accent ink. Never colour alone: every row is a number
plus words.

## 17. Prompt 8 redesign: light, blue, animated (D-125)

**How it got here.** A first pass after the Stripe Dashboard's principles (gradient wash, four stat tiles, a filled
blue Approve on every row, Inter) was rejected by the user as generic. The taste skill's research script
(`draw.mjs --app --kind workspace`) then dealt the "achromatic ledger" style; the user asked for stronger colour, so
the shipped look keeps the ledger's structure in a light-blue identity.

**Structure (from the ledger style):** white cards with a 1px edge on a light ground, 8px card and 6px control radii,
no shadows on anything at rest, no gradients, no KPI tiles (one strip split by hairlines, the lead figure largest),
table headers in grey sentence case with no band, one filled primary per screen.

**Colour** (src/approval/web/tokens.ts; every step also published as `--blue-<n>` / `--gray-<n>`):
ground #F3F6FB, cards #FFFFFF, navy ink #0F1B3D, slate-blue secondary text #4E5B74, hairlines #D6DEEA. Brand blue
#2160E0 (hover #1A4DB8, outline #4F80EC, tint #EEF4FF, ink #173F91): the one filled primary per screen, the blue
outlined row actions, links, focus, the current page in the sidebar and the lead figure. Status, always as pale tint
+ dark ink of one hue and never the brand blue: High #FEEBEC / #A3161B, Medium #FFF3D6 / #7F4500, Low (teal)
#DEF7F1 / #0A5E52, Info #EBF0F8 / #3F4D68, approved/finished #E2F7EA / #11643A, warnings #FFF5DE / #7F4500.
Contrast: 67 pairs, all pass (`npm run check:contrast`).

**Type:** Geist (self-hosted, variable). 13 / 14 (base) / 15 / 16 / 24 / 30 px; weights 400, 500, 600.

**Components:** sidebar white behind one hairline, current page a light blue pill; the product mark is two bars of
different length (expiring policy against renewal offer); no top bar chrome (breadcrumb and run date as plain
text); the list page opens with one finding ("4 high-risk renewals are waiting. Soonest: ..."); the summary strip
leads with "Waiting for your decision" and the product's own element: one square per waiting renewal, coloured by
risk, worst first, with a word legend (pure markup, no inline styles). Row actions: Approve outlined in blue, Open
and Skip as text buttons; the pack page's Approve is the only filled button. Progress steps are one strip split by
hairlines. There are no charts, modals, dropdowns or toasts in this product, so none were added.

**Motion** (src/approval/web/client/motion.js, GSAP 3.15 + ScrollTrigger; one ease `power3.out`, 0.3-0.8 s,
transform and opacity only):
- page load: sidebar items, header, then content blocks and list rows stagger in (fade + small rise); the sidebar
  only on the first page of a visit, later pages animate the content only;
- the risk squares fill in one by one, worst first; the summary and quality figures count up from 0;
- below the fold: ScrollTrigger.batch reveals blocks and rows once as they enter;
- banner icons and progress ticks pop in; the current step pulses (CSS);
- the sidebar has one pill that slides to the hovered or focused link and back, positioned from layout offsets
  (not getBoundingClientRect) so links still sliding in cannot shift it;
- `<details>` content settles in when opened; page-to-page: CSS cross-document view transitions.
Safety: boot.js hides the regions before first paint only when an entrance will play, and never under reduced
motion, on a reload of the same address (the job page's meta refresh) or with storage blocked; motion.js hands
the hidden state to GSAP in the same frame; a CSS failsafe shows everything after 1.5 s if scripts never run;
printing restores anything not yet revealed; switching to reduced motion reverts every tween and ScrollTrigger.
