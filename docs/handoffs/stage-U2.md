# Handoff - Prompt 7 Stage U2 (intake, analysis service, CLI, samples) = CHECKPOINT A

Status: done, not committed. Built without questions at the user's request; every judgement call is a decision
(D-095 .. D-107). The web pages (U3) and the overview spreadsheet (U4) were built after this checkpoint in the
same session, because the user asked for no stops; this file still describes exactly what CHECKPOINT A covers.

## Files
- src/pipeline/processCase.ts - the per-case body shared by the nightly run and uploads (moved, D-099)
- src/pipeline/runPipeline.ts - calls processCase; teaches the nightly run rule U-4 (respectUploadOverride)
- src/state/runGate.ts - one run or analysis at a time, also inside one process (D-096)
- src/uploads/intake.ts - per-file door checks, random storage location, temp-then-rename writes
- src/uploads/identity.ts - rule U-2 checks (pure)
- src/uploads/knownDocuments.ts - fake-mode registry (sha256 -> answer key) and its reader
- src/uploads/manualSource.ts - DataSource wrapper that resolves manual policies/clients (read-only; refuses status writes for man- ids)
- src/uploads/analysisService.ts - analyseUpload, recoverInterruptedUploads
- src/uploads/retention.ts - delete one upload's PDFs, purge by age, remove matching cache entries
- src/uploads/repo.ts - setUploadPolicyId added
- src/approval/actions.ts - manual-origin approve / retry-sync never call updateRenewalStatus (U-1)
- src/approval/cards.ts, src/approval/dispatch.ts - U-3 wording for uploaded packs only
- src/documents/pdfText.ts - STANDARD_FONTS_DIR and hasMeaningfulText exported (no behaviour change)
- src/cli/index.ts, src/cli/context.ts, package.json - analyse, uploads:list, uploads:delete, uploads:purge, samples:make; run gate in run/serve; startup recovery in serve
- src/pipeline/report.ts - readable audit lines for the new event types
- scripts/makeSampleUploads.ts, samples/uploads/* - synthetic samples (D-107)
- test/uploadsIntake.test.ts, test/uploads.test.ts, test/uploadHelpers.ts - 40 new tests
- vitest.config.ts - testTimeout 30 s (D-095)
- docs/UPLOADS.md, docs/DECISIONS.md, docs/PROJECT_STATE.md - sections and decisions for U2

## Checks run here (real output)
1. Refactor first, BEFORE any new code: full suite 277/277 (after one re-run: two whole-pipeline tests had timed out
   at the 5 s default under parallel load; D-095), then `reset-demo` + `run --fake-llm` in scratch folders:
   `Totals: new_pack=11  needs_attention=2  skipped_outside_window=1  skipped_already_processed=1` with pol-s07
   "renewal document missing" and pol-s08 "document has no readable text (image-only scan)" - D-D exact.
2. After U2: `npm run typecheck` clean; `npm run lint` "Checked 146 files ... No fixes applied."; `npx vitest run`
   "Test Files 19 passed (19) / Tests 317 passed (317)"; `npm run fixtures:hash -- --check` OK (65bfa9e1...ecf).
3. `npm run samples:make` twice: combined fb01ebaf6afe9f42f9ec091008dcd76d31330cd1ef2bde85413cf43b972f4cf6 both times.
4. Code search (Grep, case-insensitive, over src/, scripts/, test/, package.json) for
   `smtp|sendmail|nodemailer|createTransport|sendMail|send-email|send_email|mailto:|:25\b|net.connect|tls.connect`:
   ONE hit, the comment in src/outputs/eml.ts saying there is no transport. No send capability exists.
5. `updateRenewalStatus(` in src/: called only in src/approval/actions.ts (approve after the manual guard, and
   retry-sync with `row.origin !== 'manual'`); the other hits are the interface and its implementations.

## CHECKPOINT A - what you should see when you run it yourself (PowerShell, project folder, fake mode)
```
npm run reset-demo
npm run run -- --fake-llm
npm run analyse -- samples/uploads/pol-s07-renewal.pdf --policy pol-s07 --confirm-synthetic --fake-llm
```
Expected (seen here in scratch folders): the FAKE LLM banner, then
`Upload 1: done` / `The pack is ready for your review. Nothing has been sent.` /
`Pack 12 for pol-s07 (version 1). Approve with: npm run approve -- 12` / `Tokens used: 0 in / 0 out`.
```
npm run audit -- pol-s07
```
Expected story after the nightly lines (documents_checked renewal MISSING, needs_attention, notice sent):
upload_received (attach mode, 1 file, consent given) -> analysis_started (expiring data source, renewal fe6b518075ac,
fake mode) -> documents_checked (both found) -> terms_extracted x2 -> comparison_done (overall risk info; 0 changes)
-> pack_written -> status_changed needs_attention -> drafted -> status_changed drafted -> in_review ->
manual_override_set -> analysis_finished (new_pack, pack version 1) -> notification_sent (pack 12, web).
```
npm run analyse -- samples/uploads/harbourview-expiring.pdf samples/uploads/harbourview-renewal.pdf --new --client "Harbourview Bakery Ltd" --broker brk-01 --confirm-synthetic --fake-llm
```
Expected: `Upload 2: done` and `Pack 13 for man-247381cca8e2 (version 1)`. `npm run status` lists man-247381cca8e2
in_review with risk high and 2 flags.

Unknown PDF in fake mode (any real-looking PDF that is not a sample, e.g. one you make yourself):
`npm run analyse -- --renewal <your.pdf> --policy pol-s01 --confirm-synthetic --fake-llm` -> `rejected
(unknown_in_fake_mode)` and "The renewal offer: This document is not one of the known sample documents...".
Also seen: not-a-pdf.pdf -> `rejected (not_a_pdf)`; scanned-expiring.pdf -> `rejected (empty_or_scanned)`;
no `--confirm-synthetic` -> `rejected (consent_missing)`. `npm run uploads:list` shows each job with its code.

## If you type "include live run"
Analysing the Harbourview pair live = 2 documents = 2 model calls (chat.completions, JSON mode) if both answers
validate; each document may be retried up to 2 more times on invalid output, so at most 6 calls (UPDATE: with the
later repair reading, D-120, at most 10); the OpenAI SDK may
also retry network/5xx errors up to 2 times per call. If the same bytes are already in .cache/extractions, 0 calls.
I will state this again and wait for your "go"; nothing live has been run.

## Known issues
- pdf.js prints "Unable to load font data ... standard_fonts/LiberationSans-*.ttf" warnings: this worktree's
  node_modules/pdfjs-dist has no standard_fonts folder. Pre-existing (readPdfText was not changed); text extraction
  still works. Check `node_modules/pdfjs-dist/standard_fonts` in your main checkout.
- File modes 0700/0600 are ignored on Windows (NTFS inherits from DATA_DIR).
- The AI call cannot be cancelled on time-out (D-102).
- Remind: type "commit" for "prompt 7a: upload intake and analysis service" (tag prompt-7a-done) when you are happy.
