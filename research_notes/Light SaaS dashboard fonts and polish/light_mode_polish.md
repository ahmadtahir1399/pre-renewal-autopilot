# Light-mode visual polish practices for modern SaaS work dashboards (2025-2026)

Scope note: general, numeric, CSS-level principles for a server-rendered, no-JS, no-web-font approval page (renewal list with risk badges and Approve/Skip buttons; detail page with comparison table, flags, activity timeline). Values below come from public design-system docs (Radix, Primer, Carbon, Atlassian, Tailwind v4.3, shadcn/ui), Linear's own redesign write-ups, Stripe's color-system post, and design-rule commentary. Brand-specific palettes are deliberately not reproduced. Several requested sources (Stripe Dashboard internals, Mercury, Ramp, Attio, Tailwind UI, Polaris, Atlassian typography) produced no usable primary material in this pass; see Gaps.

## 1. Background vs surface vs subtle-surface greys (lightness steps, warm vs cool, number of steps, Radix 12-step roles)

### Takeaway
Light-mode neutrals are a 12-ish step scale where the first 2 steps are backgrounds, steps 3-5 are component fills (rest/hover/pressed), 6-8 are borders, and 11-12 are text; page-vs-card separation is tiny (about 1.5-3.5 OKLCH lightness points), borders sit about 7-8 points below white, and the 2025-2026 trend is toward a slightly warmer, very low-chroma grey rather than blue-tinted "slate".

### Cited Findings
- Radix 12-step role assignment: 1 = app background; 2 = subtle background (cards, code blocks, striped tables, sidebars, canvas) and "can be used interchangeably with step 1"; 3 = UI element background (also hover for transparent-by-default components); 4 = hovered element bg; 5 = pressed/selected bg; 6 = subtle borders on non-interactive elements (sidebars, headers, cards, alerts, separators); 7 = subtle borders on interactive components; 8 = stronger borders on interactive components and focus rings; 9 = solid backgrounds (highest chroma); 10 = hover for solid backgrounds; 11 = low-contrast text; 12 = high-contrast text — [Radix Colors: Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- Radix guarantees steps 11 and 12 on a step-2 background of the same scale reach APCA Lc 60 and Lc 90 respectively — [Radix Colors: Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- Most Radix step-9 colours are designed for white text; Sky, Mint, Lime, Yellow, Amber step 9/10 are designed for dark text — [Radix Colors: Understanding the scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- Radix neutral choice: pure gray "will work well with any hue"; a "natural pairing" picks the tinted grey closest to the accent hue (mauve/purple, slate/blue, sage/green, olive/lime, sand/yellow); warns saturated greys for app backgrounds can clash with many colourful badges — [Radix Colors: Composing a palette](https://www.radix-ui.com/colors/docs/palette-composition/composing-a-palette)
- shadcn/ui default light tokens (OKLCH, zero chroma): background L=1.0 (white), card L=1.0, muted L=0.97, border/input L=0.922, ring L=0.708, muted-foreground L=0.556, foreground L=0.145; radius 0.625rem (10px). Base-colour options listed: Neutral, Stone, Zinc, Mauve, Olive, Mist, Taupe — [shadcn/ui Theming](https://ui.shadcn.com/docs/theming)
- Tailwind v4.3 neutral lightness steps (OKLCH): gray-50 L 98.5%, gray-100 96.7%, gray-200 92.8%, gray-500 55.1%, gray-900 21%; gray/slate hue ~248-265 (cool, blue-tinted; slate higher chroma, e.g. slate-200 C 0.013), stone hue ~49-106 with chroma <=0.003 (warm). Neutral families: slate, gray, zinc, neutral, stone, mauve, olive, mist, taupe — [Tailwind CSS Colors](https://tailwindcss.com/docs/colors)
- Linear's 2024 redesign moved theme generation from HSL to LCH so equal lightness reads equally bright, reduced themes to three inputs (base, accent, contrast), limited how much blue "chrome" feeds into neutrals for "a more neutral and timeless appearance", built elevation largely from black/white opacities, and raised content contrast — [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui); [Linear changelog 2024-03-20](https://linear.app/changelog/2024-03-20-new-linear-ui)
- Linear's later refresh shifted default light and dark palettes from a cool blue-leaning hue to "a warmer, less saturated gray", noting too-warm looks muddy and required iteration — [Linear: Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- Atlassian elevation: sunken (recessed backdrop for grouping, e.g. Kanban columns), default (flat baseline), raised (movable cards, always paired with raised shadow), overlay (modals, dropdowns); flat cards on the default surface should use a border rather than lift — [Atlassian Elevation](https://atlassian.design/foundations/elevation)
- Design rule: avoid pure black and pure white; tint greys with the interface hue at under 5% HSB saturation; use warm or cool tints, not both — [Anthony Hobday, Visual design rules you can safely follow](https://anthonyhobday.com/sideprojects/saferules/)
- Stripe moved to a perceptually uniform model (CIELAB) because HSL lightness misrepresents perceived brightness (yellows look lighter, blues darker) — [Stripe: Designing accessible color systems](https://stripe.com/blog/accessible-color-systems)

### Inferences
- A practical light ramp derived from the above: page bg ~L 97-98.5% (or white with grey sunken areas), card/surface L 100%, subtle fill/hover ~L 96-97%, pressed/selected ~L 94-95%, hairline border ~L 91-93%, stronger/interactive border ~L 85-88%, tertiary text ~L 55-60%, secondary ~L 40-50%, primary ~L 14-22%. Chroma for neutrals should stay below ~0.01 (OKLCH) to avoid the "slate/Bootstrap blue-grey" look; a hue in the 60-100 range (warm) or a near-zero chroma reads more current per Linear's refresh.
- Two background conventions exist: Radix/shadcn put white at the app background and use step 2 for cards/sidebars; many dashboards invert (grey page, white cards). Radix explicitly says steps 1 and 2 are interchangeable, so either works; pick one and keep it consistent.
- 10-12 neutral steps is the norm (Radix 12, Tailwind 11 stops 50-950); a product page typically actively uses 6-8 of them.
- For an approval page with many coloured risk badges, Radix's warning implies keeping the page neutral very low chroma so badges carry the colour.

### Gaps
- No primary numeric source found for Stripe Dashboard, Mercury, Ramp, Attio or Vercel surface hex/lightness values (Vercel's public design.md lists surface token roles — primary, secondary, contrast — but no values). Exact Radix gray hex values were not fetched in this pass.

## 2. Borders and shadows (hairline colour/alpha, ring + soft shadow card recipe, elevation levels, radius scales)

### Takeaway
The modern card recipe is a 1px low-alpha ring (often drawn as `box-shadow: 0 0 0 1px` so it does not affect layout) plus one or two very soft, tight shadows at 5-10% black; elevation increases blur and offset rather than opacity. Restraint is the trend: fewer dividers, lower-contrast separators, borders over shadows for flat content. Radii cluster at ~3-4px (small chips), 6-8px (controls, default), 10-12px (cards/panels), and full (pills).

### Cited Findings
- Tailwind v4.3 shadow scale: 2xs `0 1px rgb(0 0 0/0.05)`; xs `0 1px 2px 0 rgb(0 0 0/0.05)`; sm `0 1px 3px 0 rgb(0 0 0/0.1), 0 1px 2px -1px rgb(0 0 0/0.1)`; md `0 4px 6px -1px rgb(0 0 0/0.1), 0 2px 4px -2px rgb(0 0 0/0.1)`; lg `0 10px 15px -3px .../0.1, 0 4px 6px -4px .../0.1`; xl `0 20px 25px -5px .../0.1, 0 8px 10px -6px .../0.1`; 2xl `0 25px 50px -12px rgb(0 0 0/0.25)`; inset-shadow-2xs `inset 0 1px rgb(0 0 0/0.05)`; ring = `0 0 0 1px` — [Tailwind CSS box-shadow](https://tailwindcss.com/docs/box-shadow)
- Radix Themes 6-step shadow scale: shadow-1 inset (recessed); shadow-2/3 for classic Card panels; shadow-4/5 small overlays (popover, hover card); shadow-6 dialogs — [Radix Themes Shadows](https://www.radix-ui.com/themes/docs/theme/shadows). In source, every level starts with a 1px ring (`0 0 0 1px var(--gray-a3)` at shadow-2), adds a 0.5px black-a1 hairline and 1-2px offset layered shadows; higher levels add 12-16px then 40-64px blurs with negative spread so the shadow tucks under the element; ring colour uses alpha greys (with a color-mix variant) — [radix-ui/themes shadow.css](https://github.com/radix-ui/themes/blob/main/packages/radix-ui-themes/src/styles/tokens/shadow.css)
- Primer radius tokens: small 3px, medium 6px (default), large 12px, full 9999px; border widths thin 1px, thick 2px, thicker 4px — [Primer Size primitives](https://primer.style/foundations/primitives/size)
- shadcn/ui default `--radius` is 0.625rem (10px) — [shadcn/ui Theming](https://ui.shadcn.com/docs/theming)
- Carbon tags use 16px radius (full pill at their heights) — [Carbon Tag style](https://carbondesignsystem.com/components/tag/style/)
- Atlassian: raised elevation should not be used to group content when a border or whitespace would do; borders are the default scroll indicator for sticky headers/footers; flat cards on default surface take a border — [Atlassian Elevation](https://atlassian.design/foundations/elevation)
- Vercel's public design guidance rejects "ornamental shadows and fake depth" and says to build structure with spacing, alignment and borders only where needed; light-surface border scale has three steps (subtle, default, strong) — [Vercel design.md](https://vercel.com/design.md)
- Linear's refresh used fewer dividing lines; remaining ones have rounded ends and lower contrast — [Linear: Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- Design rules: shadow blur roughly 2x offset; a 1px border on light UI should be darker than both container and background; keep structural elements and shadows as low-contrast as possible; nested radius = outer radius minus gap — [Anthony Hobday, safe rules](https://anthonyhobday.com/sideprojects/saferules/)
- Refactoring UI's "use fewer borders" tactic: replace borders with shadows, background contrast, or extra spacing (reported via secondary summaries, not the book text) — [Refactoring UI principles summary](https://alexanderweichart.de/5_Archive/3_Resources/Library/Refactoring-UI/Refactoring-UI-design-principles)

### Inferences
- Recommended card recipe for this page (no JS): `border: 1px solid` neutral at ~L 91-93% (or `rgb(0 0 0 / 0.08)` alpha) plus `box-shadow: 0 1px 2px rgb(0 0 0 / 0.04-0.06)`; avoid md+ shadows on in-flow content; reserve larger shadows (12-24px blur) for overlays only. Three elevation levels is enough for a server-rendered page: flat (border only), raised card (ring + xs shadow), overlay (ring + lg shadow).
- Radius scale: 4px for badges/inline chips (or full for pills), 6px for buttons/inputs, 8-12px for cards and the table container; inner elements in a padded card should use a smaller radius (outer minus padding rule).
- Hairline alpha borders (black at 6-10%) adapt to whichever surface they sit on, which is why Radix and Linear use alpha-based neutrals.

### Gaps
- No primary source on exact hairline alpha used by Stripe/Linear/Vercel; the 6-10% alpha range is inferred from Radix gray-a3 usage and Tailwind 5-10% shadow alphas, not quoted.

## 3. Typography for dense UI (sizes, scale, weights, letter-spacing, tabular numbers, line-heights, text colour hierarchy)

### Takeaway
Dense B2B UI uses 13-14px body/table text (Primer body-medium 14px/1.5; Carbon table rows 14px), 12px for captions/metadata, 16-20px for section titles and 20-32px for page titles, with weights 400/500/600 only. Headings get slight negative tracking (about -0.01 to -0.02em at 16-32px per Inter's dynamic metrics); numbers in tables use `font-variant-numeric: tabular-nums`. Text hierarchy is 2-3 levels, carried by lightness, not by many sizes.

### Cited Findings
- Primer type tokens: body large 1rem/1.5, body medium 0.875rem (14px)/1.5, body small 0.75rem (12px)/1.625; caption 12px/1.25/400; title small 16px/1.5/600, title medium 20px/1.625/600, title large 32px/1.5/600; display 40px/500; code block 13px/1.5. Weights: light 300, normal 400, medium 500, semibold 600. Font stack falls back through -apple-system, BlinkMacSystemFont, 'Segoe UI', Noto Sans, Helvetica, Arial, sans-serif; monospace `ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace` — [Primer typography primitives](https://primer.style/product/primitives/typography/)
- Primer guidance: rem units for zoom accessibility; unitless line-heights aligned to a 4px grid; avoid colour as the primary means of emphasis; lines about 80 characters or less — [Primer Typography foundations](https://primer.style/foundations/typography)
- Carbon data table: column header 14px SemiBold 600 (heading-compact-01); row text 14px Regular 400 (body-compact-01); table title 20px Regular — [Carbon Data table style](https://carbondesignsystem.com/components/data-table/style/)
- Vercel's public guidance: four weight tokens only (regular, heading, medium, semibold), variable fonts loaded 400-600, "custom weights are not allowed"; monospace only for code, paths, IDs, timestamps; prose measure 60-68 characters; label 12px/16px and copy 13px/18px tokens — [Vercel design.md](https://vercel.com/design.md)
- Linear: display variant of its sans for headings, regular text variant elsewhere (no sizes given) — [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- Inter dynamic-metrics tracking formula: tracking(em) = -0.0223 + 0.185 x e^(-0.1745 x size_px). Values: 12px +0.0005em, 13px -0.0032em, 14px -0.0062em, 16px -0.011em, 20px -0.0167em, 24px -0.0195em, 32px -0.0216em — [Inter dynamic metrics (archived v3 site)](https://d.rsms.me/inter-website/v3/dynmetrics/)
- Inter OpenType features useful in UI: `tnum` (tabular figures, same width across weights), `zero` (slashed zero), `case` (case-sensitive punctuation), `cv11`, `ss01` (open digits) — [Inter](https://rsms.me/inter/)
- General rule: tighter letter-spacing for larger text, looser for smaller text — [Anthony Hobday, safe rules](https://anthonyhobday.com/sideprojects/saferules/)
- Radix: step 11 = low-contrast text (APCA Lc 60), step 12 = high-contrast text (Lc 90) on step 2 — [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- shadcn: foreground L 0.145 vs muted-foreground L 0.556 — a two-level text hierarchy — [shadcn/ui Theming](https://ui.shadcn.com/docs/theming)
- Linear's refresh: inactive nav text muted, sidebar "several levels dimmer" so content draws the eye; guiding principle "Don't compete for attention you haven't earned." — [Linear: Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- A secondary (non-Stripe) guide claims 13-14px as typical SaaS default UI sizes, 400 for cells, 500 for headers/buttons, 600 for headings, 11px uppercase column labels — [frontend-design-saas reference (third-party)](https://mcpservers.org/tr/agent-skills/cloudflare/frontend-design-saas). Treat as low-confidence; not verified against Stripe.

### Inferences
- Without web fonts, a system stack (`system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`) is the realistic choice; Segoe UI and SF both support `font-variant-numeric: tabular-nums`. Inter's tracking curve is font-specific but is a reasonable proxy: in px, about -0.1px at 14px, -0.18px at 16px, -0.33px at 20px, -0.47px at 24px, -0.7px at 32px; body text at 12-14px should get 0 tracking.
- Weight 450 is only available with variable fonts; with system fonts on Windows (Segoe UI) stick to 400/600 (500 may render as 400 or 600 depending on installed faces), so 600 for headings/labels and 400 body is the safest pairing.
- Suggested scale for the page: 12px meta/caption, 13px table cells and badges, 14px body, 16px card/section titles (600), 20-24px page title (600, negative tracking). Ratio roughly 1.125-1.2 at the small end.
- Text colours: primary ~L 15-22%, secondary ~L 40-48% (must pass 4.5:1 on white), tertiary/placeholder ~L 55-60% (only for non-essential text; ~L 55% is near the 4.5:1 limit on white).

### Gaps
- No primary source for Atlassian or Polaris type values (fetches failed). Inter's line-height formula was not shown on the archived page.

## 4. Tables and list rows (row height, padding, header styling, zebra vs hairlines, hover, number alignment)

### Takeaway
Row heights come in a 24/32/40/48/64px ladder; 40px (default) or 48px (comfortable) suits a ~10-row approval list. Horizontal cell padding is ~16px; headers are small, same row height, and semibold or muted; zebra striping and hover use the next neutral step up; numeric columns and their headers are right-aligned with tabular figures.

### Cited Findings
- Carbon row heights: xs 24px, sm 32px, md 40px, lg 48px, xl 64px; column header matches row size; 16px padding before/after text and between columns; header 14px semibold; zebra rows use `$layer-accent`; row hover uses `$layer-hover`; xl rows top-align with 16px padding-top — [Carbon Data table style](https://carbondesignsystem.com/components/data-table/style/)
- Radix: step 2 is for striped tables; step 3 doubles as hover for transparent-by-default rows; step 4 hovered element; step 5 selected — [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- Vercel guidance: right-align numeric columns and their headers; body cells align to first text baseline; bottom-align only multi-line headers; keep short row labels on one line; "normal" density by default, compact only for dense lookup — [Vercel design.md](https://vercel.com/design.md)
- Inter `tnum` exists specifically for comparing columns of numbers across rows — [Inter](https://rsms.me/inter/)
- Atlassian: overflow shadows reserved for tables that rely on borders to separate cells where a border might be missed; borders are the default scroll indicator — [Atlassian Elevation](https://atlassian.design/foundations/elevation)

### Inferences
- For the renewal list: 44-48px rows (enough for a two-line client name + policy meta at 13/12px), 12-16px horizontal padding, 1px hairline between rows (border step ~L 92-94%) rather than zebra; hover = subtle fill (~L 97-98%) via CSS `:hover` (no JS). Zebra is more useful for wide comparison tables with many numeric columns (the detail page) than for short action lists.
- Header row: 12px, weight 500-600, secondary text colour, sentence case is the more modern pattern; if uppercase is used, keep it 11-12px with +0.02-0.06em tracking (common practice; no primary source found). Header bg either transparent with a bottom border or the subtle step 2.
- Put Approve/Skip in a right-aligned, fixed-width last column so buttons line up row to row.

### Gaps
- No primary source found for sentence-case vs uppercase header guidance, or exact uppercase tracking values.

## 5. Status badges / pills (soft tint + darker text + dot/icon, sizing, radius, accessibility)

### Takeaway
Badges use a light tint background, a mid-tone border (optional) and a dark text of the same hue; heights 18-24px, 12px type, 4-8px horizontal padding, pill or small radius; meaning must also be carried by text/icon, not colour alone.

### Cited Findings
- Carbon tag colour pairing in light themes: text/icon at step 70, border at step 40, background at step 20 (dark text on light tint); sizes sm 18px, md 24px, lg 32px; 12px regular type (label-01); horizontal padding 8px (sm/md) or 12px (lg); 16px icons; 16px radius; titles ideally under 20 characters — [Carbon Tag style](https://carbondesignsystem.com/components/tag/style/)
- Stripe: colours organised in levels with uniform contrast across hues; any two colours five levels apart pass small-text contrast, four apart for icons/large text; each text colour passes on white and on the lightest tint of any hue; badge colours at the lightest level were hard to distinguish, so both background and text were shifted up one level — [Stripe: Designing accessible color systems](https://stripe.com/blog/accessible-color-systems)
- Radix: step 3-4 tinted backgrounds with step 11 text is the standard soft-badge pairing (step 11 guaranteed Lc 60 on step 2); amber/yellow solid steps need dark text — [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- Vercel guidance: use colour only for meaning and pair it with a non-colour cue; do not use pills for ordinary metadata — [Vercel design.md](https://vercel.com/design.md)
- Primer: avoid colour as the primary method of emphasis — [Primer Typography](https://primer.style/foundations/typography)

### Inferences
- Badge recipe for risk levels: height 20-22px, padding 0 8px, font 12px/500, radius 4-6px (or 999px pill), background = hue step ~3 (very light tint, L ~94-97%), text = hue step ~11 (L ~35-45%), optional 1px border at hue step ~6-7 at low alpha, and a 6px dot or 12-14px icon plus the text label ("High risk", "Review", "OK"). Shape/icon differences (e.g. filled dot vs triangle) give a non-colour cue.
- Reserve red/amber for genuinely actionable states; neutral grey badges for informational metadata, per Vercel's "colour only for meaning".

### Gaps
- Carbon's accessibility section content was not returned; no primary numeric source on dot size.

## 6. Buttons (primary/secondary/ghost, heights, inner highlights, focus rings)

### Takeaway
Control heights follow a 24/28/32/40/48 ladder with 32px as the medium default and 36-40px for primary page actions; horizontal padding 12px (8 condensed, 16 spacious). Primary = solid accent (step 9, hover step 10); secondary = white/neutral fill with 1px border; ghost = transparent with step-3/4 hover. Focus = 2px solid ring with at least 3:1 change in contrast, typically offset 2px.

### Cited Findings
- Primer control heights: xsmall 24px, small 28px, medium 32px, large 40px, xlarge 48px; block padding 2/4/6/10/14px; inline padding 8 (condensed) / 12 (normal) / 16 (spacious); focus outline 2px with -2px offset — [Primer Size primitives](https://primer.style/foundations/primitives/size)
- Radix: step 9 solid background, step 10 its hover; step 3/4/5 rest/hover/pressed for neutral components; step 7 subtle interactive border, step 8 stronger border and focus rings — [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)
- Tailwind ring utility `0 0 0 Npx`; `inset-shadow-2xs` `inset 0 1px rgb(0 0 0/0.05)` usable as a subtle inner edge — [Tailwind box-shadow](https://tailwindcss.com/docs/box-shadow)
- Radix Themes shadow-1 combines an inset ring with soft inset highlights for recessed controls — [radix-ui/themes shadow.css](https://github.com/radix-ui/themes/blob/main/packages/radix-ui-themes/src/styles/tokens/shadow.css)
- WCAG 2.2 SC 2.4.13 Focus Appearance (AAA): indicator at least as large as a 2 CSS px perimeter, and 3:1 contrast between focused and unfocused pixels; focus indicators also fall under 1.4.11 Non-text Contrast — [W3C Understanding Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)
- shadcn ring token L 0.708 (neutral) — [shadcn/ui Theming](https://ui.shadcn.com/docs/theming)
- Linear: buttons were harmonised with the new LCH themes (no specifics) — [Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)

### Inferences
- For Approve/Skip in rows: 32px height, 12px horizontal padding, 13px/500-600 text, 6px radius. Approve = solid accent (or a dark neutral) with white text; Skip = secondary (white bg, 1px border ~L 85-88%, primary text) or ghost. Keep only one solid button per row to preserve hierarchy.
- Subtle polish without JS: primary button `box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1-0.15), 0 1px 2px rgb(0 0 0 / 0.08)`; secondary `0 1px 2px rgb(0 0 0 / 0.04)`; pressed state uses `:active` with step 5 or a translateY(0.5px). (Common practice; the inner-highlight alpha range is not from a primary source.)
- Focus: `:focus-visible { outline: 2px solid <accent ~step 8-9>; outline-offset: 2px; }` satisfies 2.4.13's 2px perimeter if the colour contrasts 3:1 with the unfocused state.

### Gaps
- No primary source for "inner highlight" values on primary buttons in Stripe/Linear/Vercel.

## 7. Spacing, max-widths, sidebar widths, page headers, KPI/stat tiles

### Takeaway
Spacing is a 4px-based scale (2, 4, 6, 8, 12, 16, 20, 24, 32...); within-group gaps 4-12px, between-group 24-32px, section breaks 32-48px. Outer padding should be at least inner padding. Chrome (nav, sidebars) should recede; stat tiles should be quiet, labelled, and not hero-sized.

### Cited Findings
- Primer size scale: 2, 4, 6, 8, 12, 16, 20, 24 px and up to 128 — [Primer Size primitives](https://primer.style/foundations/primitives/size)
- Primer line-heights align to a 4px grid — [Primer Typography](https://primer.style/foundations/typography)
- Vercel spacing tokens 1,2,3,4,5,6,8,10,12,16 (skipping 7, 9, 11, 13-15); within group 2-4, between groups 6-8, major sections 8-12, 16 reserved for chapter breaks; 12/6/4 column grid; three peers in one row — [Vercel design.md](https://vercel.com/design.md)
- Carbon table header block: 16px margin-top, 24px margin-bottom, 16px side padding — [Carbon Data table style](https://carbondesignsystem.com/components/data-table/style/)
- Rules: base spacing on a scale; measure spacing between points of high contrast; outer padding >= inner padding — [Anthony Hobday, safe rules](https://anthonyhobday.com/sideprojects/saferules/)
- Linear: navigation and orientation elements recede (dimmer sidebar, smaller icons, more vertical padding, compact tab bar) while task content stays prominent; density kept but chrome weight reduced — [Linear: Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- Vercel: monochrome by default, colour only for meaning; no badges for ordinary metadata — [Vercel design.md](https://vercel.com/design.md)

### Inferences
- Content max-width: a list/table page reads well at ~960-1200px; detail prose at 60-80ch (Primer 80ch, Vercel 60-68ch). Page gutter 24-32px desktop, 16px mobile.
- Page header pattern: title (20-24px/600) + one-line muted subtitle (13-14px) on the left, primary actions right-aligned, 24px below the header before content; optional breadcrumb 12-13px muted above.
- KPI tiles that avoid the "hero metric" cliché: small label first (12-13px muted), value at 20-24px/600 with tabular figures (not 40px+), optional one-line context ("3 due this week") in tertiary text; no gradients or coloured icon blobs; tiles share one bordered container split by hairlines rather than separate floating cards. For ~10 renewals, a simple inline summary line ("10 renewals - 3 high risk - 2 awaiting docs") may beat tiles entirely.

### Gaps
- No primary source found for typical sidebar widths (commonly cited 220-280px, unverified) or content max-widths from the named brands.

## 8. What makes light mode feel "premium" vs "generic Bootstrap"

### Takeaway
Cited commentary converges on: perceptually uniform, low-chroma neutrals (not blue-grey defaults); fewer, lower-contrast borders and dividers; very soft or no shadows; restrained colour used only for meaning; strong but limited contrast hierarchy where chrome recedes and content leads; consistent scales (spacing, radius, type) and tight optical alignment.

### Cited Findings
- Linear: LCH colour generation, reduced blue in neutrals for a "timeless" look, elevation via black/white opacities, increased content contrast, aligned labels/icons/buttons on shared axes — [Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- Linear refresh: warmer, less saturated grey; fewer and softer separators; reduced icon usage and removed coloured icon backgrounds; chrome dimmed so content is not competing — [Linear: Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- Vercel: reject ornamental shadows and fake depth; design in monochrome; colour only for meaning with a non-colour cue; restrained, consistent radii — [Vercel design.md](https://vercel.com/design.md)
- Stripe: perceptual colour model so hues of the same level have equal contrast; predictable text-on-tint rules — [Stripe: Designing accessible color systems](https://stripe.com/blog/accessible-color-systems)
- Hobday: avoid pure black/white; tint greys slightly; high contrast for important things, low for structure; align everything; nested radius rule — [Anthony Hobday, safe rules](https://anthonyhobday.com/sideprojects/saferules/)
- Refactoring UI (via summaries): fewer borders; use spacing, background contrast or shadow instead — [Refactoring UI summary](https://alexanderweichart.de/5_Archive/3_Resources/Library/Refactoring-UI/Refactoring-UI-design-principles)
- Atlassian: don't use raised elevation to group content when a border or whitespace would do; it adds noise — [Atlassian Elevation](https://atlassian.design/foundations/elevation)

### Inferences
- "Generic Bootstrap" markers to remove: saturated blue-grey neutrals, #DEE2E6-style borders on every element, 0.25rem radius everywhere, medium-strength drop shadows on in-flow cards, fully saturated solid badges (white text on bright red/green), uppercase bold headers with heavy rules, uniform 16px text everywhere, and colour used decoratively.
- "Premium" markers to add: near-neutral or slightly warm greys with 1-3 L-point surface steps, alpha hairlines, 13-14px dense text with 2-3 lightness-based text levels, tabular numbers, slight negative tracking on headings, soft-tint badges with dot/icon, one solid primary action per context, consistent 4px spacing and radius scale, and generous whitespace between groups (24-32px) despite dense rows.

### Gaps
- No primary design commentary from Stripe Dashboard, Mercury, Ramp, Attio or Tailwind UI teams was found in this pass; their "premium" qualities are covered only indirectly. Refactoring UI was cited through secondary summaries, not the book itself.
