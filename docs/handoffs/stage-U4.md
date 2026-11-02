# Handoff - Prompt 7 Stage U4 (spreadsheets, hardening, docs) = CHECKPOINT B

Status: done, not committed. Decisions D-114 .. D-118. Full picture and final test output: docs/handoffs/prompt-7.md.

## Files
- src/outputs/buildOverviewXlsx.ts, src/outputs/overview.ts - overview model/workbook and createOverview
- src/outputs/buildXlsx.ts, writePack.ts, src/pipeline/processCase.ts - 'Source | Uploaded manually' Summary row for uploaded packs only
- src/approval/web/server.ts, views.ts, uploadViews.ts, styles.ts - /exports routes, list-page form, export pages
- src/cli/index.ts, package.json - `overview` command
- src/compare/format.ts, src/outputs/buildXlsx.ts - bidi/control stripping found by the matrix (D-114)
- test/overview.test.ts, test/security/uploads.test.ts - overview and the attack-surface matrix
- scripts/renderUiStates.ts - 3 more states (31)
- docs/UPLOADS.md (final sections), MANUAL_TEST_UPLOAD.md, PROMPT5_NOTES.md, handoffs/prompt-6.md, handoffs/prompt-7.md

## How old hashes stayed identical
The origin row is added to the workbook MODEL only when `uploaded` is true; nightly packs never pass it, so their model
text (the content-hash input) is unchanged. Proof: the existing outputs/pipeline hash tests pass unchanged, a new
test shows `buildWorkbookModel({...input, uploaded: false})` equals the model without the flag, and the fixtures hash
and D-D outcomes are unchanged.

## Attack-surface matrix (printed by the test; all PASS after D-114)
Sinks: xlsx comparison cells, xlsx overview cells, .eml headers and bodies (client, insurer), summary.txt, web job
page, pack page, list page, upload page, notifier text, audit details, log lines, output and upload paths, client and
contact name at the door. Inputs: formula, script, crlf, markup, long (10,000), control_rtl, traversal.
The first run had 4 FAIL cells (control_rtl in .eml bodies, summary.txt, notifier text) -> fixed (D-114) -> all PASS.
