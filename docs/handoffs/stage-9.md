# HANDOFF - STAGE 9 (Evaluation and hardening)

Date: 2026-10-19 (live run dated 2026-10-20, the real date in Pacific/Auckland; the pipeline used the
fixed reference date 2026-10-19). Status: DONE, checkpoint C, not committed.

## Live evaluation (run after the user typed "go")
Command: `RUN_LIVE_LLM=1 npx tsx scripts/evaluate.ts --mode live --confirm --repeats 3` (exit 0).
Model gpt-5.4-nano-2026-03-17, prompt v1, rules r1, 28 documents x 3 repeats. Report:
reports/eval-2026-10-20-live.md and .json (committable); raw results reports/raw/2026-10-20-live-v1-r{1,2,3}.json (ignored).
- Calls: 84 HTTP responses (1 per read), 0 validation retries, 0 failed calls, 0 rate limits, 0 timeouts, 0 backoff retries.
- Field values 672 of 672; source pages 672 of 672; quote check 672 of 672; wrong value at high confidence 0.
- Exclusion keys: precision 312 of 312, recall 312 of 312, pages 312 of 312 (pol-s04 reworded and pol-s15 removed: correct in all repeats).
- Differences end to end: 30 of 30 found, 30 of 30 real; overall risk 33 of 33; flags exact 33 of 33.
- Selection 45 of 45; final status 45 of 45 (pol-s07, pol-s08 needs_attention; pol-s09 outside window; pol-s12 already processed, approved).
- Typed-error checks 6 of 6 (pol-s07 renewal document_missing, pol-s08 expiring document_unreadable, 0 model calls each).
- Live prompt injection (pol-s14): PASS in all 3 repeats (16 of 16 facts, exclusions, diffs, flags, status exact).
- Run-to-run: no document changed a value or a page across repeats. Confidence labels DID change: 36 facts were "medium"
  (11, 15 and 10 per repeat), all correct, on different documents each repeat; "medium" raises no flag (LIMITS.md).
- Tokens 195351 in (cached by the provider: 0, 46592, 48384 per repeat) and 38089 out; cost 0.069586 USD in total
  (0.0289534, 0.02039309, 0.02023928 per repeat), mean 0.0016665 USD per policy; mean 4113.3 ms per document (3227-6168).
- Failures listed: none. Prompt revisions: none (v1 is final: there was no measured error to fix; revising would be unjustified).
- Verified it is real model output, not the answer key: all 312 exclusion summaries are worded differently from the answer keys;
  the planted-error test (test/eval.test.ts) proves the scorer counts misses.
- `npm run results:summary` wrote docs/RESULTS_SUMMARY.md; `npm run docs:check-numbers`: every number traced (one rounding
  mismatch, "4113", was caught first and the summary now prints the traceable 4113.3).

## What the live report does NOT prove
Real documents (one author, one template family, clean layouts); scanned, long or multi-schedule documents; other
languages or policy types; injection resistance in general (one document, one phrasing); a statistical error rate
(84 reads of 28 documents). A perfect score on this set is a plumbing-and-prompt check, not a claim about real use.

## Files
- scripts/evaluate.ts - entry point: `eval:fake` (plumbing only) and `eval:live` (plan + stop; paid run only with RUN_LIVE_LLM=1 and --confirm; --resume, --report-only, --date, --repeats)
- scripts/eval/types.ts - shared evaluation types
- scripts/eval/score.ts - normalisation and scoring (facts, pages, exclusions, diffs, flags, scenarios), formatRatio (counts, never rounded up)
- scripts/eval/live.ts - live measurement through readPolicyTerms with the cache disabled, backoff, raw save per document, resume
- scripts/eval/pipelineReplay.ts - the real pipeline in a throwaway folder with a fake or replay reader
- scripts/eval/aggregate.ts - headline, per-field, per-repeat, spread, failures, dangerous cases, timing, cost, pol-s14 injection check
- scripts/eval/render.ts - markdown reports (fake: "PLUMBING CHECK - accuracy not measured"; live: every version side by side)
- scripts/eval/pricing.ts - the user's prices and the cost formula
- scripts/eval/summaryLines.ts, scripts/resultsSummary.ts - the 10-line summary generated from the live JSON (writes docs/RESULTS_SUMMARY.md)
- scripts/eval/numbers.ts, scripts/checkNumbers.ts - `docs:check-numbers` (unmatched numbers listed, exit 1)
- src/domain/text.ts - display-text hygiene shared by every sink (D-130)
- test/eval.test.ts - scoring, plan, measurement, replay, end-to-end report with planted errors, summary/number checks (17 tests)
- test/failure/failure.test.ts - failure injection (10 tests)
- test/security/{injection,attackSurface,noSend,secrets,readOnly,unauthorised}.test.ts + support.ts - security tests (23 tests; `test:security` also re-runs test/web.test.ts: 36 total)
- docs/SECURITY.md - attack-surface note; docs/LIMITS.md - honest limits
- Changed: src/llm/client.ts (D-126), src/pipeline/runPipeline.ts (D-129, D-131), src/state/audit.ts (policy_not_saved),
  src/outputs/{buildXlsx,eml,writePack}.ts, src/approval/{cards,web/html}.ts, src/config/logger.ts (D-130),
  test/pipeline.test.ts and test/outputs.test.ts (new outcome key; one extra guard assertion), package.json (6 scripts),
  .gitignore (D-128), docs/MANUAL_TEST_APPROVAL.md and scripts/runLocal.ps1 (absolute path removed), DECISIONS.md, PROJECT_STATE.md.

## Fixes, each with the failing test that proved it
| Fix | Evidence before the fix |
| --- | --- |
| D-129: a database lock no longer aborts the whole run; that policy ends `failed_not_saved` with no half state, audit written late or to stderr | test/failure "a lock during one policy's writes": `Error: database is locked` thrown from `recordAudit` at runPipeline.ts:240 (the run_failed audit), other policies never completed |
| D-129: a failed save after the files were written removes the unsaved version folder (and empty parents) | test/failure "the commit transaction fails": with the cleanup disabled, the folder `output/2026-10-19/fernvale-veterinary-clinic-ltd/pol-s10` remained; with only the version folder removed, the empty `pol-s10` folder remained |
| D-131: a damaged PDF is no longer called an image-only scan | test/failure "a corrupted PDF": received note "document has no readable text (image-only scan)" |
| D-130: control characters, bidi overrides, CRLF and huge lengths cleaned at every sink | attack-surface matrix: 11 FAIL cells (xlsx bidi; .eml header line of 10001 chars; .eml body line over 998 and U+0000; summary.txt bare CR and U+0000; web HTML U+0000; Telegram text bare CR, 10191 chars, U+0000; log line bidi U+202E) |
| D-130 follow-up: the xlsx guard checks the original AND the cleaned text | existing test/outputs "SPREADSHEET INJECTION GUARD" failed after the first D-130 change ('\rx' lost its apostrophe because cleaning turned CR into LF) |

## Commands and real results (this session)
- `npm run typecheck` - no output (pass). `npm run lint` - "Checked 138 files ... No fixes applied."
- `npm test` - "Test Files 23 passed (23), Tests 276 passed (276)".
- `npm run test:failure` - 10 passed. `npm run test:security` - 7 files, 36 passed; matrix 63 of 63 PASS.
- `npm run eval:fake` - "selection 15/15, status 15/15, packs 11/11, risk 11/11, flags exact 11/11, files 11/11, failures 0 ... PASS in 1654 ms."
- `npm run eval:live` (no --confirm) - prints the plan (28 documents, 3 repeats, 84 expected calls, worst case 252 plus backoff re-reads) and stops; no call made. The live run itself: see the top of this file.
- `npm run fixtures:hash -- --check` - matches the snapshot. `npm audit` - "found 0 vulnerabilities".

## Security findings worth knowing
- No mail library is installed (D-054). The scan of our code and of every production dependency finds no
  sending API (createTransport, sendMail, smtp, sendmail, nodemailer, emailjs, mailgun, sendgrid, postmark,
  mailjet, sparkpost, mandrill, Amazon SES, Microsoft Graph sendMail, Gmail send, raw outbound sockets, SMTP commands).
- SQLite under a real lock (probe): RESERVED lock -> reads continue, writes wait busy_timeout then fail "database is locked"; EXCLUSIVE -> reads fail too.
- Secrets: sentinel key, bot token and web token never appeared in the database, console output, output/, data/, reports/, web replies or audit rows.

## Known issues
- The model's medium confidence raises no human-check flag (by the locked rule D-B only low does); labels varied between repeats.
- Provider-side prompt caching made repeats 2 and 3 cheaper; per-repeat cost is shown, not only the total.
- npm audit: found 0 vulnerabilities (nothing to review; no versions changed).
- Git HISTORY contains the absolute project path (with a blocked name) in three earlier files; the working tree is fixed; `.vitest/` must be untracked at commit; rewriting history is the user's decision.
- Licence, agency-owner name and agency name were left as placeholders.
