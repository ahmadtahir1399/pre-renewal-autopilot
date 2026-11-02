# HANDOFF - PROMPT 4 (State, audit, pipeline, scheduler, CLI + approval flow)

Date: 2026-10-19. Read with docs/PRODUCT_BRIEF.md (now includes D-E), docs/PROJECT_STATE.md (FULL signatures),
docs/DECISIONS.md (D-E, D-060 ... D-086) and docs/MANUAL_TEST_APPROVAL.md.

## 1. Status
Done: Stage 7 (committed 16bf461, tag stage-7-done) and Stage 8 (NOT yet committed; waiting for "commit":
"prompt 4: pipeline, audit, scheduler and approval flow", tag prompt-4-done). Approval channel: web (the user left
the field blank). The Telegram adapter is built and type-checked but was never run against the real Bot API.
Before Prompt 4 started, Prompt 3 was committed (674184b, tag prompt-3-done) at the user's request.

## 2. Files
Stage 7
- src/state/migrations/001_initial.sql - schema (runs, cases, packs, notifications, audit_events, approvals)
- src/state/db.ts - node:sqlite open (rollback journal), read-only open, migrations, transaction helpers
- src/state/statusMachine.ts - allowed + forced transitions, InvalidTransitionError
- src/state/audit.ts - event type union, guarded recordAudit / listAudit
- src/state/repo.ts - typed cases / packs / runs / approvals access; transitionCase always audits
- src/state/lockFile.ts - PID lock with stale detection
- src/pipeline/runPipeline.ts - the run: selection, idempotency, per-policy isolation, one-transaction commit, dry run
- src/pipeline/readers.ts - LLM reader, cache-only reader (dry run), ground-truth reader (--fake-llm)
- src/pipeline/inputHash.ts - idempotency hash
- src/pipeline/killSwitch.ts - AUTOPILOT_ENABLED / PAUSE file
- src/pipeline/scheduler.ts - daily scheduler with NZ DST handling
- src/pipeline/demo.ts - reset-demo + seeding
- src/pipeline/report.ts - run summary, status and audit tables
- src/cli/index.ts, src/cli/context.ts - CLI commands and wiring
- src/domain/dates.ts - ADDITION InstantClock (D-060)
- test/state.test.ts, test/pipeline.test.ts, test/scheduler.test.ts
Stage 8
- src/approval/notifier.ts - Notifier interface, ActionRequest/ActionResult, FakeNotifier
- src/approval/actions.ts - the shared approval core (only caller of updateRenewalStatus), retry-sync
- src/approval/cards.ts - deterministic card / notice / reminder text
- src/approval/dispatch.ts - card dispatch, never-send-twice, superseded cards, notices, reminders, outbox fallback
- src/approval/web/server.ts, html.ts, webNotifier.ts - local web approval page (127.0.0.1 only)
- src/approval/telegram/telegramNotifier.ts - optional Telegram adapter (grammY)
- src/approval/check.ts - check:approval helpers
- src/approval/serve.ts - ordered shutdown
- src/config/env.ts - APPROVAL_* and REMINDER_* variables (D-073)
- docs/MANUAL_TEST_APPROVAL.md - step-by-step manual test
- test/helpers.ts, test/approval.test.ts, test/web.test.ts
Changed: package.json (scripts; grammy dependency), .env.example, docs/PRODUCT_BRIEF.md (D-E wording),
docs/PROJECT_STATE.md, docs/DECISIONS.md. The user's .env got REFERENCE_DATE=2026-10-19 (non-secret line).

## 3. Exact public signatures
All are in docs/PROJECT_STATE.md under "src/state", "src/pipeline", "src/cli" and "src/approval". Key ones:
```ts
// Notifier and the core
interface Notifier { channel; start(handler); stop(); sendPack(card); sendNotice(card); markResolved(ref, text); sendReminder(card) }
type ActionHandler = (req: { action: 'approve'|'open'|'skip'; packId: number; actor: AuditActor; channel: 'web'|'telegram'|'cli' }) => Promise<ActionResult>
type ActionResult = ok | already_done | superseded(currentVersion) | not_found | not_allowed | wrong_state(status)
createApprovalCore({ db, clock, dataSource, outputDir, allowedTelegramChatIds, copyFile? }): { handleAction, retrySync, stopAccepting }
// Pipeline
runPipeline({ today, dryRun, only?, force?, deps: PipelineDeps }): Promise<RunSummary>
PipelineDeps { dataSource; db; reader: TermsReader; clock: InstantClock; compareConfig; outputDir; dataDir; templatePath?;
  maxConcurrency; autopilotEnabled; windowMinDays?; windowMaxDays?; print?; onPacksReady?; newRunId?; beforeCommit? }
RunSummary { runId; today; dryRun; blocked; blockedReason?; counts: Record<RunOutcome, number>; rows: RunRow[]; totalTokens; totalDurationMs }
RunOutcome = new_pack | new_version | unchanged_skip | needs_attention | skipped_outside_window | skipped_already_processed | failed_kept_previous
// Status machine
canTransition(from, to, { force? }); assertTransition(policyId, from, to, { force? }); ALLOWED_TRANSITIONS; FORCED_TRANSITIONS
// Audit
createAuditLog(db, clock): { recordAudit(input): number; listAudit(policyId): AuditEvent[] }; listAllAudit(db); assertSafeDetails(details)
```
AUDIT EVENT TYPES: run_started, run_finished, run_blocked_pause, policy_skipped_outside_window,
policy_skipped_already_processed, documents_checked, terms_extracted, comparison_done, pack_written, status_changed,
needs_attention, unchanged_skip, pack_superseded, notification_sent, notification_failed, reminder_sent, approved,
skipped, approval_ignored, unauthorised_attempt, status_sync_failed, status_sync_retried, forced_rerun, demo_reset,
seeded, plus ADDITIONS run_failed, policy_failed, run_skipped_overlap, opened, copy_failed.
DB SCHEMA + MIGRATIONS: src/state/migrations/001_initial.sql (details in PROJECT_STATE.md). Applied ids are
recorded in schema_migrations. journal_mode = DELETE (not WAL; D-066).
PATH CONVENTION: packs.paths and Pack.xlsxPath / clientEmlPath / insurerEmlPath are RELATIVE to OUTPUT_DIR with '/'
separators; approved copies live at OUTPUT_DIR/approved/<same relative path>; resolve with resolveInside(OUTPUT_DIR, rel).

## 4. Decisions and deviations (details in DECISIONS.md)
- D-E (locked): pluggable channel; web page is the default, Telegram optional; PRODUCT_BRIEF wording updated (D-086).
- D-060 InstantClock; D-061 node:sqlite; D-062 case stays in_review when a pack is superseded; D-063 extra audit
  types and the token-count guard fix; D-064 seeding inserts approved directly; D-065 scheduler + locks;
  D-066 rollback journal (WAL broke dry-run zero writes); D-067 deterministic vs transient failures;
  D-068 half-state handling; D-069 dry run; D-070 REFERENCE_DATE in .env; D-071 CLI; D-072 schema additions.
- D-073 env; D-074 Notifier/ActionResult; D-075 Open allowed on any active pack, audits 'opened'; D-076 Skip never
  writes the data source; D-077 approve order + copy_failed; D-078 web security; D-079 Telegram; D-080 notices
  without buttons; D-081 dispatch/fallback; D-082 reminders; D-083 serve shutdown; D-084 audit --attempts;
  D-085 card wording.

## 5. Commands and expected output (PowerShell, project folder)
```
npm run reset-demo            -> "Seeded approved cycles: 1."
npm run run -- --fake-llm     -> FAKE LLM banner; Totals: new_pack=11 needs_attention=2 skipped_outside_window=1 skipped_already_processed=1
npm run run -- --fake-llm     -> (again) Totals: unchanged_skip=13 skipped_outside_window=1 skipped_already_processed=1
npm run run -- --dry-run --fake-llm  -> "DRY RUN (nothing was written)"; no file changes
npm run status                -> 11 in_review with packs; pol-s07/s08 needs_attention; pol-s12 approved
npm run audit -- pol-s02      -> timeline: documents_checked ... status_changed drafted -> in_review (+ approval events)
npm run audit -- --attempts   -> refused / unauthorised attempts
npm run pause / npm run resume  -> run prints "Run blocked: PAUSE file present (data\PAUSE)"
npm run serve                 -> prints "Approval page (this computer only): http://127.0.0.1:8787/?t=..." and the next run time
npm run approve -- <packId>   -> "ok: Approved. ... Nothing was sent."; again -> "already_done: ..."
npm run skip -- <packId>      -> "ok: Skipped. ..."
npm run retry-sync            -> "Nothing to retry ..." or per-pack OK / FAILED
npm run check:approval        -> "web: PASS - can bind 127.0.0.1:8787 ..."
```

## 6. Test status
226 tests pass with no API key and no network (approval 20, web 13 over real HTTP on a random port, pipeline 13,
state 11, scheduler 7, plus 162 from Prompts 1-3). Nothing skipped. Not covered by automated tests: the real
Telegram Bot API, a live Ctrl+C on Windows, opening the page in a real browser (manual test).

## 7. Environment variables
New: APPROVAL_CHANNELS (web), APPROVAL_WEB_PORT (8787), APPROVAL_WEB_TOKEN (optional secret), APPROVER_NAME (broker),
REMINDER_AFTER_HOURS (48), REMINDER_INTERVAL_HOURS (24). TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_CHAT_IDS only when
telegram is configured. REFERENCE_DATE=2026-10-19 is set in the user's .env for the demo.

## 8. Libraries and versions (verify in the official docs)
- node:sqlite (built into Node 24.19.0): DatabaseSync, readOnly, enableForeignKeyConstraints, prepare/run/get/all,
  read from @types/node 24. VERIFY its stability level. Alternative: better-sqlite3 (needs native install scripts).
- grammy 1.46.0 (+ @grammyjs/types 5.0.0): Bot, InlineKeyboard, InputFile, bot.on('callback_query:data'),
  ctx.answerCallbackQuery, api.sendMessage / editMessageText / sendDocument / getMe, bot.start / stop / isRunning.
  Checked against installed types only. VERIFY: callback_data limit (types say 1-64 bytes), that editMessageText
  without reply_markup removes the inline keyboard, long-polling behaviour.
- Scheduler: no library; Intl.DateTimeFormat with timeZone for wall-clock reading. Alternatives: croner, node-cron.
- npm audit: 0 vulnerabilities (after Stage 8 install).

## 9. Known issues
- The web page is reachable only on this computer (127.0.0.1), not from a phone.
- Telegram never exercised against the real API; it may be unreachable from the user's location.
- Web sessions are in memory (restart serve -> open the new launch URL); cookie has no Secure flag (plain http on loopback).
- A CLI approve/skip does not edit an already-sent Telegram card (its buttons then return already_done).
- Clean Ctrl+C shutdown tested with fakes only; forced kill + stale-lock takeover tested live.
- `npm run build` does not copy src/state/migrations/*.sql into dist/ (the project runs via tsx).
- Pack ids are not in policy order (packs are built two at a time); always read them from `npm run status`.
- FIXED after commit (D-087): Referrer-Policy changed to same-origin; with no-referrer real browsers sent "Origin: null" and every Approve/Skip got 403. Prompt 5 should keep a real-browser check, because hand-built HTTP tests cannot reproduce browser Origin behaviour.
- Carried over: policyType mismatch is not a rule; keyExclusions have no confidence; X-Unsent unverified.

## 10. Notes for Prompt 5
- 15-scenario expected outcomes after `reset-demo` + `run --fake-llm`: new_pack + in_review for S01-S06, S10, S11, S13,
  S14, S15 (risks: s01 low; s02, s03, s15 high; s05, s06, s11 medium; s04, s10, s13, s14 info); S07 and S08
  needs_attention without a pack ("renewal document missing", "document has no readable text (image-only scan)");
  S09 skipped_outside_window; S12 skipped_already_processed (seeded approved). A second run: unchanged_skip x13.
- Evaluation with the REAL LLM: `run` without --fake-llm needs LLM_PROVIDER/LLM_API_KEY/LLM_MODEL; compare each pack's
  diffs/flags/derived overallRisk against fixtures/ground-truth (field/change/severity/values, D-019) and all 28 readable
  PDFs' extracted terms; repeat runs (cache key includes model + prompt version). Never call the LLM from unit tests.
- Security tests to include or extend: web Host/DNS rebinding, token (constant-time, cookie flags, never logged),
  CSRF + Origin on every POST, GET never mutates, path traversal on Open, HTML escaping of hostile titles, CSP headers,
  loopback-only bind, prompt injection (S14), spreadsheet formula injection, email header injection, audit details guard,
  updateRenewalStatus only from the approval core, no email-sending capability (code + dependency search).
- Audit event list: section 3. Use `npm run audit -- <policyId>` and `npm run audit -- --attempts` in the demo.
- The demo script and README must describe the LOCAL WEB PAGE as the primary approval channel and Telegram as an
  optional second channel (it needs this computer to reach api.telegram.org).
- Demo flow (60-90 s): reset-demo -> run --fake-llm (or a cached real run) -> serve -> open launch URL -> Open the
  pol-s02 comparison -> Approve -> show the "Approved by ..." card -> `npm run audit -- pol-s02`.
