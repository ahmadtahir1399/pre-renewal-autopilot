# Notes for Prompt 5 (evaluation, security tests, README, demo, release)

Prompt 7 (manual upload, analysis and overview spreadsheets, locked decision D-F) ran BEFORE Prompt 5. There is no
README yet; these are the facts Prompt 5's README, configuration table, evaluation, security matrix, LIMITS.md and
DEMO_SCRIPT must include. Full detail: docs/UPLOADS.md, docs/handoffs/prompt-7.md.

## Configuration table additions
| Variable | Default | Purpose |
| -------- | ------- | ------- |
| UPLOAD_MAX_MB | 10 | max size per uploaded PDF (1..50) |
| UPLOAD_MAX_PAGES | 30 | max pages per uploaded PDF (1..200) |
| UPLOAD_DAILY_LIMIT | 10 | analyses started per local day (1..200) |
| UPLOAD_RETENTION_DAYS | 7 | stored PDFs kept this long (uploads:purge) |
| ANALYSIS_TIMEOUT_SECONDS | 180 | per analysis (10..1800) |
| EXTRACT_REPAIR_PASS | true | live reading: one targeted second reading for unconfirmed facts (D-120) |
| APPROVAL_PUBLIC_ORIGIN | (unset) | Prompt 6 deploy option: one extra https origin behind a reverse proxy (uploads are refused through it) |

## Commands
`npm run analyse -- <expiring.pdf> [<renewal.pdf>] (--policy <id> | --new --client <name> --broker <id>
[--contact-name <n>] [--contact-email <e>]) --confirm-synthetic [--fake-llm]`, `npm run uploads:list`,
`npm run uploads:delete -- <id>`, `npm run uploads:purge -- [--dry-run]`,
`npm run overview -- [--status in_review,approved] [--no-manual]`, `npm run samples:make`, `npm run ui:states`.

## Routes
GET /analysis/new, POST /analysis (multipart), GET /analysis/<id>, POST /analysis/<id>/delete, POST /exports,
GET /exports/<id>, GET /exports/<id>/download. Existing routes unchanged; CSP unchanged.

## Audit event types (new)
upload_received, upload_rejected, analysis_started, analysis_finished, analysis_failed, analysis_interrupted,
manual_case_created, manual_override_set, overview_created, upload_deleted, upload_purged; unchanged_skip may carry
reason manual_override_in_place.

## Tests (new files)
test/uploadsRepo.test.ts (state machine, repos, daily-limit day/DST, migration upgrade), test/uploadsIntake.test.ts
(validation matrix incl. a hand-built encrypted PDF, U-2, U-3, registry, run gate), test/uploads.test.ts (service end
to end), test/webUploads.test.ts (HTTP: multipart security, states, full browser-less flow), test/overview.test.ts,
test/security/uploads.test.ts (attack-surface matrix 16 sinks x 7 inputs, sentinel secrets, data source untouched).

## Evaluation ideas
- Extraction accuracy on the Harbourview pair and the pol-s07 renewal vs samples/uploads/*.truth.json (live only).
- The hostile pair: confirm in live mode that the instruction sentence changes nothing (fake mode proves the code
  path; only a live run tests the model).

## LIMITS.md items
PDF parser attacks (decompression bombs, parser bugs) untested; parsing is in-process and a synchronous step cannot
be interrupted; the AI call cannot be cancelled on time-out; synthetic-only is a promise (consent tick), not a check;
Windows file modes ignored; a browser may show a connection error instead of the 413 page for a large upload;
keyboard/screen-reader/Firefox/Safari not checked by hand; busboy last published 2022-04-19; no OCR, no batches, no
fact editing.

## Extra demo beat (suggested)
From the pol-s07 "Upload the missing document" notice, upload samples\uploads\pol-s07-renewal.pdf, watch the job
page tick through its steps, open the pack (it says "Uploaded manually"), click Approve, and show the audit line. In
fake mode the yellow bar says "Fake mode: only known sample documents can be analysed." on screen.

## AI reading checks (added after CHECKPOINT B)
Evaluate in live mode how often the repair reading turns an unconfirmed fact into a confirmed one, and whether the
consistency checks ever fire on real-looking documents (false alarms). Tests: test/readingChecks.test.ts.
Live baseline (2026-10-21, one run): Harbourview pair, 2 requests, 4,579 in / 799 out tokens, 16/16 facts and 5/5
exclusions equal to the truth files, 0 warnings, no repair reading (details in docs/handoffs/prompt-7.md).
