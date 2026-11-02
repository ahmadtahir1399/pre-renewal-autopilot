# Handoff - Prompt 6 (approval page redesign) and the public-origin deployment option

Status: done, NOT committed (written late, during Prompt 7; Prompt 7 is built on top in the same worktree).
Commit message when you type "commit" for Prompt 6 alone is no longer possible without Prompt 7's files; see the
Prompt 7 handoff for the suggested commit order.

## What changed
- A light, calm SaaS look for the approval page: sidebar shell, top bar with run date and "Drafts only", KPI strip,
  risk-sorted list rows, pack page with decision panel, "Needs your eye" flags, changes table with source pages,
  activity timeline from the audit log, technical details disclosure, designed error pages, FAKE-LLM honesty bar.
- Light mode only; IBM Plex Sans (SIL OFL 1.1) self-hosted as two variable WOFF2 subsets; CSP gained
  `font-src 'self'` (D-088). Stylesheet served at a content-hashed /assets URL (`style-src 'self'`, no inline style).
- Spreadsheet styling aligned to the page tokens (cell values and content hashes unchanged).
- `run_started` records `fakeLlm`, so the FAKE-LLM bar shows whenever displayed data came from a fake run.
- Deployment option APPROVAL_PUBLIC_ORIGIN (D-089): one extra https Host/Origin accepted behind a TLS reverse proxy,
  Secure cookie on that host; the server still binds 127.0.0.1. Used for the Oracle Cloud demo VM
  (an sslip.io HTTPS address; kept out of the repo), which runs the Prompt 6 version (not Prompt 7).

## Files
- docs/DESIGN.md - design system (updated in Prompt 7 to match what shipped)
- docs/UI_INVENTORY.md - pages, routes, states (section 7 added in Prompt 7)
- src/approval/web/tokens.ts, styles.ts, fonts.ts, fonts/ - tokens + contrast pairs, stylesheet, font whitelist and files (+ OFL.txt)
- src/approval/web/html.ts, views.ts, present.ts, auditView.ts - shell, pure views, wording, whitelisted audit sentences
- src/approval/web/server.ts - stylesheet/font routes, designed error pages, public origin, fake-mode detection
- src/config/env.ts, .env.example, src/cli/context.ts, src/cli/index.ts, src/pipeline/runPipeline.ts - APPROVAL_PUBLIC_ORIGIN, fakeLlm in run_started
- src/outputs/xlsxLayout.ts, buildXlsx.ts, scripts/makeTemplate.ts, templates/comparison.xlsx - spreadsheet styling
- scripts/checkContrast.ts (`npm run check:contrast`), scripts/previewUi.ts (`npm run ui:preview`)
- test/webUi.test.ts (new), test/web.test.ts (2 assertions updated to the designed 403 page and the new decision sentence, both still exact), test/env.test.ts
- .gitattributes (`*.woff2 binary`), .claude/skills/skill-finder/SKILL.md, research_notes/ and reports/ (font research)

## Checks (as last run in Prompt 7, which includes all of Prompt 6's tests)
typecheck clean, lint clean, full suite green (see prompt-7.md), check:contrast all pass, fixtures hash unchanged.

## Known issues
- The demo VM keeps running Prompt 6; Oracle may reclaim idle Always Free VMs; the ephemeral IP survives stop/start
  but not termination; depends on sslip.io; the shared demo state is visible to anyone with the link.
- research_notes/ is not git-ignored (decide whether to commit it).
