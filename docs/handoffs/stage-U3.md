# Handoff - Prompt 7 Stage U3 (web pages for upload and analysis)

Status: done, not committed. Decisions D-108 .. D-113.

## Step 0 (skills) - done LATE, at the start of this stage's write-up, not before Stage U1
skill-finder (.claude/skills/skill-finder/SKILL.md) on "build accessible, secure, server-rendered upload and results
pages with no JavaScript". Searched: project .claude/skills (1 SKILL.md), ~/.claude/skills (synced buckets) and
~/.claude/plugins/marketplaces: 52 SKILL.md files. Ranked: frontend-design (3, plugin marketplace cache: available
on disk; read in full), xlsx (2, synced user skill; for the U4 overview spreadsheet), claude-security (2, a scan
workflow; not read for building). Everything else 0. What frontend-design changed: nothing structural (the pages
were already built to docs/DESIGN.md, which wins over its "be distinctive" push); confirmed: buttons name what
happens, failure states give direction, no all-caps labels, numbered steps only because progress is a sequence.
docs/DESIGN.md was read before the pages were built (Prompt 6 design, now updated to match what shipped).

## Files
- src/approval/web/multipart.ts - busboy reader for POST /analysis (CSRF first, whitelists, limits, streamed cap)
- src/types/busboy.d.ts - minimal local typings (no @types install)
- src/approval/web/uploadViews.ts - upload page and job page (pure, escaped)
- src/approval/web/server.ts - /analysis routes, enableUploads(), upload links on list/pack pages, fake-mode for uploaded packs
- src/approval/web/views.ts, html.ts, present.ts, auditView.ts, styles.ts, tokens.ts - entry points, chrome options (refresh, fake note, nav link), U-3 timing, audit sentences for upload events, CSS for forms/steps/facts, 3 contrast pairs; escapeHtml drops control characters (D-110)
- src/uploads/repo.ts, src/uploads/analysisService.ts, src/state/migrations/002_uploads.sql - upload_terms (D-108), onStarted hook
- src/cli/context.ts, src/cli/index.ts - serve enables uploads with the dispatcher; listBrokersFor
- scripts/renderUiStates.ts, package.json (ui:states) - render all 28 states
- test/webUploads.test.ts - 20 HTTP tests
- docs/DESIGN.md (sections 2-4, 11, 14 updated to the shipped design; section 16 new), docs/UI_INVENTORY.md (section 7), docs/UPLOADS.md (web section), docs/DECISIONS.md

## Library
busboy 1.6.0 (exact), MIT, dependency streamsearch 1.1.0, last published 2022-04-19 (please judge whether that is
"maintained" for you; it is widely used and small). Alternatives named: formidable 3.5.4 (last modified 2026-03-15),
multer (Express-only). `npm audit` after install: "found 0 vulnerabilities". npm also printed its existing
install-scripts warning for esbuild (unchanged, P1 known issue).

## Checks run here (real output)
- `npm run typecheck` clean; `npm run lint` "Checked 151 files ... No fixes applied."
- `npx vitest run`: "Test Files 20 passed (20) / Tests 337 passed (337)".
- `npm run check:contrast`: "Checked 55 pairs ... All contrast checks passed."
- `npm run ui:states`: 28 states saved with the expected statuses (200/400/403/404/415/429).
- Select-String over those 28 files: script 0, style tags 0, style attributes 0, external URLs 0, `on...=` 1 (the
  escaped hostile filename text, not an attribute); meta refresh only in job-running.
- CSP: unchanged; the new pages send exactly `default-src 'none'; style-src 'self'; font-src 'self'; img-src 'none';
  form-action 'self'; frame-ancestors 'none'; base-uri 'none'` (asserted in tests).
- Meta refresh in a real browser (built-in Chromium pane, temporary server, real CSP): 4 reloads in ~7 s, no console
  errors. Temporary script deleted afterwards.

## Could not verify
- Keyboard-only use with a real keyboard; screen reader output; Firefox/Safari rendering. The keyboard path is
  described in docs/UI_INVENTORY.md section 7.
- How a browser behaves when the server closes the connection after refusing a large upload mid-stream (Node test
  clients receive the 413; browsers may show a connection error instead of the page).

## Known issues
- The old ui:preview server started earlier in this session ran Prompt 6 code; restart `npm run ui:preview` to see
  the upload pages.
