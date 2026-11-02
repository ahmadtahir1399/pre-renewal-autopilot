# Handoff - Prompt 7: manual upload, manual analysis and spreadsheet creation (D-F)

Status: BUILT, NOT COMMITTED. Built without stopping at CHECKPOINT A or asking questions, because the user asked for
that ("just build it please ask no question"); every judgement call is a written decision (D-F, D-088 .. D-118).
Stage notes: docs/handoffs/stage-U1.md, stage-U2.md (= CHECKPOINT A), stage-U3.md; this file covers U4 and the whole.
Prompt 6 is also uncommitted in the same worktree (docs/handoffs/prompt-6.md).

## Commit (only when you type "commit")
Prompt 6 and Prompt 7 touch the same files (server.ts, views.ts, html.ts, styles.ts...), so the stages cannot be
committed separately after the fact without hand-splitting hunks. Options: (a) one commit "prompt 7: manual upload,
analysis and spreadsheet creation" (it includes the Prompt 6 redesign) with tags prompt-6-done, prompt-7a-done and
prompt-7-done on it; or (b) I split it by hand into "prompt 6: approval page redesign" and "prompt 7: ..." with
`git add -p` and you check both. Decide which; nothing has been committed or tagged.

## Files (new unless marked)
- src/pipeline/processCase.ts - per-case body shared by the nightly run and uploads (refactor, D-099)
- src/pipeline/runPipeline.ts (changed) - calls processCase; U-4 respected
- src/state/migrations/002_uploads.sql - origin, input_source, uploads, uploaded_documents, upload_terms, manual_clients, manual_policies, exports
- src/state/repo.ts, audit.ts (changed) - origin/inputSource, 11 audit types
- src/state/runGate.ts - one run or analysis at a time, in-process too (D-096)
- src/uploads/model.ts, errors.ts, repo.ts - states, typed codes, repositories, daily-limit counter
- src/uploads/intake.ts - door checks, random storage, temp-then-rename
- src/uploads/identity.ts - U-2
- src/uploads/knownDocuments.ts - fake-mode registry + reader
- src/uploads/manualSource.ts - DataSource wrapper for manual records (read-only)
- src/uploads/analysisService.ts - analyseUpload, recoverInterruptedUploads
- src/uploads/retention.ts - delete, purge, cache entries
- src/outputs/buildOverviewXlsx.ts, overview.ts - overview spreadsheet model, workbook, createOverview
- src/outputs/buildXlsx.ts, writePack.ts (changed) - 'Uploaded manually' row; cell guard strips bidi/control (D-114)
- src/compare/format.ts (changed) - normaliseTitle strips bidi/C1 (D-114)
- src/approval/actions.ts, cards.ts, dispatch.ts (changed) - U-1 manual approve; U-3 card wording
- src/approval/web/multipart.ts, uploadViews.ts, src/types/busboy.d.ts - upload pages, busboy reader, typings
- src/approval/web/server.ts, views.ts, html.ts, present.ts, auditView.ts, styles.ts, tokens.ts (changed) - routes, entry points, CSS, audit sentences, escapeHtml strips control characters (D-110)
- src/cli/index.ts, context.ts (changed); package.json (busboy, scripts analyse, uploads:*, overview, samples:make, ui:states)
- src/config/env.ts, .env.example (changed) - UPLOAD_* and ANALYSIS_TIMEOUT_SECONDS
- src/documents/pdfText.ts (changed) - two exports only
- src/pipeline/report.ts (changed) - readable CLI audit lines for upload events
- scripts/makeSampleUploads.ts, samples/uploads/* - synthetic samples (+ README, samples.sha256)
- scripts/renderUiStates.ts - renders 31 page states
- tests: test/uploadsRepo.test.ts, uploadsIntake.test.ts, uploads.test.ts, uploadHelpers.ts, webUploads.test.ts, overview.test.ts, security/uploads.test.ts
- test/state.test.ts (ONE line: expected migration list, D-092); test/webUi.test.ts (Prompt 6 test: invisible characters written as escapes, same values, D-118); vitest.config.ts (timeout, D-095)
- docs: UPLOADS.md, MANUAL_TEST_UPLOAD.md, PROMPT5_NOTES.md, DESIGN.md (updated + section 16), UI_INVENTORY.md (section 7), DECISIONS.md, PRODUCT_BRIEF.md (D-F), PROJECT_STATE.md, handoffs

## Exact public signatures
```ts
analyseUpload(request: AnalyseUploadRequest, deps: AnalysisDeps): Promise<AnalysisResult>
// AnalyseUploadRequest = { mode: 'attach' | 'new'; policyId?; newPolicy?: { clientName; contactName?; contactEmail?; brokerId };
//   files: { expiring?: { bytes: Uint8Array; clientFilename? }; renewal?: {...} }; consent: boolean; actor: AuditActor; onStarted?(job) }
// AnalysisDeps = { db; clock; dataSource; reader: TermsReader | null; knownDocuments?; compareConfig; outputDir; templatePath?;
//   runtimeDir; lockPath; timeZone; today(); limits: UploadLimits; dailyLimit; timeoutMs; onPacksReady? }
// AnalysisResult = { job: UploadRow; outcome: RunOutcome | null; message: string }
processCase(deps: ProcessCaseDeps, input: ProcessCaseInput): Promise<ProcessCaseResult>
createOverview(input: { filters: OverviewFilters; runDate: IsoDate; actor: AuditActor }, deps: OverviewDeps): Promise<OverviewResult>
validatePdfUpload(file: IncomingFile, limits: UploadLimits): Promise<ValidatedPdf>
checkIdentity({ expiring, renewal, policy? }): UploadFailureCode | null
deleteUploadFiles(deps, uploadId, actor); purgeOldUploads(deps, retentionDays, { dryRun, actor }); recoverInterruptedUploads(db, clock, opts)
WebApprovalServer.enableUploads(options: UploadsWebOptions); WebApprovalServer.enableExports(deps: OverviewDeps)
```
Error codes (one union `UploadErrorCode`, plain messages in UPLOAD_ERROR_MESSAGES): rejected at the door - not_a_pdf,
too_large, too_many_pages, encrypted, corrupted, empty_or_scanned, wrong_number_of_files, duplicate_side,
unknown_in_fake_mode, daily_limit_reached, busy, consent_missing, policy_not_found, invalid_input, ai_not_configured;
failed later - type_not_supported, document_mismatch, identity_unreadable, type_disagreement, extraction_failed,
timed_out, interrupted, unexpected (D-090: the four U-2 codes are failures, as U-2 says).
Audit types: upload_received, upload_rejected, analysis_started, analysis_finished, analysis_failed,
analysis_interrupted, manual_case_created, manual_override_set, overview_created, upload_deleted, upload_purged.

## Rules U-1..U-7 (docs/UPLOADS.md section 2) - where they are enforced
U-1 actions.ts (manual approve/retry-sync skip the data source) + ManualAwareSource refuses status writes for man- ids;
U-2 identity.ts (+ no case for new mode); U-3 cards.ts renewalTimingLine, present.ts timingText, overview timing;
U-4 processCase respectUploadOverride (nightly only) + manual_override_set audit; U-5 repo.ts manualPolicyId;
U-6 escapeHtml, normaliseTitle, guardCellText, sanitizeHeaderText, the matrix; U-7 consent tick wording (exact).

## Commands and what you should see (fake mode; all seen here)
reset-demo -> "Migrations applied: 001_initial, 002_uploads, 003_upload_reading"; run --fake-llm -> D-D totals; analyse pol-s07 renewal ->
"Upload 1: done", "Pack 12 for pol-s07 (version 1)"; analyse --new Harbourview -> "Pack 13 for man-247381cca8e2";
a second nightly run -> "pol-s07 unchanged_skip ... manual upload in place (in_review)"; overview -> "Created 1: 14
renewal(s)." + path (same content again: "Unchanged, same content as export 1"); approve 13 -> "Approved. The drafts
were saved. This case was uploaded by hand, so no data-source record was changed. Nothing was sent."
Browser steps: docs/MANUAL_TEST_UPLOAD.md.

## Test status (run here, real output, final)
- `npx tsc -p tsconfig.json --noEmit` exit 0; `npx biome lint .` exit 0 ("Checked 155 files ... No fixes applied.")
- `npx vitest run`: "Test Files 22 passed (22) / Tests 349 passed (349)" (Prompt 6 end: 257).
- Attack-surface matrix: 16 sinks x 7 inputs, every cell PASS (printed by test/security/uploads.test.ts).
- `npm run fixtures:hash -- --check`: OK, combined 65bfa9e1...ecf (unchanged). Old pack hash tests unchanged and green.
- `npm run check:contrast`: 55 pairs, all pass. `npm run ui:states`: 31 states; Select-String scan clean (stage-U3 / UI_INVENTORY).
- `npm audit`: "found 0 vulnerabilities".
- Code search, Grep case-insensitive over src/, scripts/, test/, package.json for
  smtp|sendmail|nodemailer|createTransport|sendMail|send-email|send_email|mailto:|:25\b|net.connect|tls.connect:
  one hit, the comment in src/outputs/eml.ts saying there is no transport.
- `updateRenewalStatus(` in src/: only src/approval/actions.ts (approve, after the manual guard; retry-sync with
  `row.origin !== 'manual'`), plus the interface and its implementations (LocalJsonSource, Notion stub,
  ManualAwareSource which refuses man- ids).
- Browser (built-in Chromium pane): meta refresh under the unchanged CSP (4 reloads in ~7 s, no console errors);
  upload page, Harbourview job page, hostile job page and the list page with the overview form looked right; two
  copy issues found and fixed (D-117). The preview may need restarting to show those two fixes.

## Libraries
busboy 1.6.0 (new, exact; MIT; dependency streamsearch 1.1.0; last published 2022-04-19 - please judge "maintained";
alternatives: formidable 3.5.4, multer). Typings written locally (no @types package). Everything else unchanged
(exceljs 4.4.0, pdfjs-dist 6.4.299, pdf-lib 1.17.1 for samples, zod 4.6.7, ...).

## Known issues / not done
- The live run was NOT done (needs your "include live run" + "go"; 2 calls minimum, at most 10 with the repair reading, for Harbourview).
- No automatic purge timer inside serve: run `npm run uploads:purge` (or schedule it).
- Limits listed in docs/UPLOADS.md "Security notes" (PDF parser attacks untested, AI call not cancellable, Windows
  file modes, browser behaviour on early 413, no keyboard/screen-reader/Firefox/Safari check by hand).
- pdf.js prints "Unable to load font data ... standard_fonts" warnings in this worktree (pre-existing; the folder is
  missing from node_modules/pdfjs-dist here); text extraction works.
- The Oracle demo VM was redeployed on 2026-10-21 at the user's request (same link and token; fresh synthetic demo
  data; the previous version kept in /opt/pra/app-prev). Uploads stay local-only and are hidden on the public link (D-122).
- Step 0 (skill-finder) ran late, at Stage U3 (stage-U3.md says what it changed: nothing structural).
- PRIVACY (for Prompt 5): two files committed in earlier prompts still contain the absolute project path, which
  includes a blocked private name: docs/MANUAL_TEST_APPROVAL.md line 3 and scripts/runLocal.ps1 line 2. Prompt 7's
  own files were checked and cleaned (no absolute paths, no private names).

## Notes for Prompt 5
docs/PROMPT5_NOTES.md (env table, commands, routes, audit types, tests, LIMITS items, the extra demo beat).
Open a FRESH session for Prompt 5 and start by reading docs/handoffs/prompt-7.md.

## Enhancement after CHECKPOINT B (2026-10-21, user: "make the AI part strongest") - D-119, D-120, D-121
- The AI still only extracts (Prompt 7 ban on AI decisions kept). What got stronger is how its reading is CHECKED:
  1. src/documents/consistency.ts - plain-code checks ACROSS facts (period length and order, premium/excess vs cover
     limit, non-positive amounts). Catches the classic misread "cover limit taken as the premium", which the quote
     check alone lets through because that number IS printed on the page (test proves it).
  2. readPolicyTerms: ONE targeted second reading for facts that could not be confirmed (fields + fixed reasons, no
     document text in the request; same system prompt and hardening). A repaired fact is accepted only if it passes
     every check again; otherwise the first reading stays, uncertain. Switch: EXTRACT_REPAIR_PASS (default true).
     The main extraction prompt is unchanged (EXTRACT_PROMPT_VERSION stays v1), so cache keys and nightly input
     hashes are unchanged; older cache entries keep their first reading.
  3. Job page "Reading check" panel: facts confirmed word for word, confirmed on a second reading, uncertain, not
     found, exclusions, token counts; each repaired fact says "Confirmed on a second reading".
- New: src/documents/consistency.ts, src/state/migrations/003_upload_reading.sql (upload_terms.repaired_json),
  test/readingChecks.test.ts (12 tests). Changed: src/documents/index.ts (checkTerms, repairProblems, mergeRepair),
  prompts/extractTerms.ts (buildRepairPrompt), verifyQuotes.ts (2 warning codes), cache.ts (repairedFields),
  readers.ts / context.ts (repair option), knownDocuments.ts (checkTerms), processCase.ts (audit `repaired` count only
  when > 0), uploads repo/service, uploadViews.ts + styles.ts (panel), auditView.ts / report.ts (wording),
  env.ts / .env.example (EXTRACT_REPAIR_PASS), test/state.test.ts + test/uploadsRepo.test.ts (migration lists),
  test/webUploads.test.ts (panel text).
- Checks run: tsc exit 0; biome lint exit 0; vitest 23 files / 361 tests passed; attack-surface matrix 16 rows all
  PASS; fixtures hash unchanged; check:contrast all pass; browser: the panel renders (16/16) with no overflow.
- Live behaviour of the repair reading is tested only with scripted fake answers; how often it rescues real model
  readings can only be measured with a live run (needs "include live run" + "go").

## Live run (2026-10-21, after the user's "include live run" and "go"; run ONCE)
- What: `analyseUpload` (new mode) on samples/uploads/harbourview-expiring.pdf + harbourview-renewal.pdf, model
  gpt-5.4-nano-2026-03-17 from the main .env (loaded by Node, never printed), scratch database/output and an empty
  scratch extraction cache (fresh reading). A temporary script counted every HTTP request; it was deleted afterwards.
- Calls: 2 requests (stated range 2-10). Tokens: 4,579 in / 799 out (expiring 2,268 / 392; renewal 2,311 / 407).
  No validation retry, no repair reading needed (0 warnings on both documents).
- Result: job done, pack prepared, "Nothing has been sent."
- Field by field vs harbourview-*.truth.json: all 16 facts SAME (value and page), all confidence high; exclusions
  identical (expiring pollution, contractual_liability; renewal + asbestos, all page 4). Comparison identical to fake
  mode: cover limit 2,000,000 -> 1,000,000 (high), asbestos added (high), premium 3,200 -> 3,400 (low); 2 flags.
- The one difference: for the expiring policy type the model quoted the page subtitle "Larchmont Harbour Insurance Ltd
  - Public Liability Insurance" instead of the schedule line "Policy type: Public Liability" in the truth file. The quote
  is on the cited page and the value is right, so it was confirmed (D-019: evaluation compares values and pages, not
  quote wording).
- What this does NOT show: the documents are clean synthetic layouts, so this says little about messy real PDFs, and
  the repair reading was not exercised live (nothing needed repair). Its behaviour is covered by fake-answer tests only.

## Public demo (D-123, D-124), 2026-10-21
The Oracle VM runs `serve --fake-llm --live-uploads` with PUBLIC_DEMO=true, UPLOAD_DAILY_LIMIT=25 and the LLM
settings from the user's .env (root-only /etc/pra/env, never printed): no sign-in, visitors can upload their own PDFs
and get a live AI analysis (25 per day shared), and a systemd timer resets everything at 06:30 New Zealand time.
Tests: test/publicDemo.test.ts. PUBLIC_DEMO is off by default; never turn it on for real client data.
