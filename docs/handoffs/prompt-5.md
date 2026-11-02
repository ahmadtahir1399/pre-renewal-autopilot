# HANDOFF - PROMPT 5 (Evaluation, hardening, README, demo, release)

Date: 2026-10-19. Branch claude/pre-renewal-autopilot-ebe21f (worktree), to be merged into master after v1.0.0.
Stage handoffs with full evidence: docs/handoffs/stage-9.md, docs/handoffs/stage-10.md.

## 1. Status
- Stage 9 DONE, committed 0282937, tag stage-9-done.
- Stage 10 DONE up to checkpoint D: intermediate commit 239349f; final commit "stage 10: docs, demo, release" and tag v1.0.0 wait for the user's "commit".
- NOT ready to show until docs/RELEASE_CHECKLIST.md is fully ticked (video, licence, history decision, second review).

## 2. Files (one line each; details in the stage handoffs)
- scripts/evaluate.ts + scripts/eval/* - fake (plumbing) and live evaluation, replay design, reports
- scripts/resultsSummary.ts, scripts/checkNumbers.ts (+ eval/summaryLines.ts, eval/numbers.ts) - generated results, number tracing
- scripts/demoReset.ts, scripts/demoWarm.ts, scripts/demo/demoPolicies.ts - demo data set
- scripts/hygiene.ps1 - hygiene scan (blocked terms read from the gitignored docs/private/blocked-terms.txt)
- src/domain/text.ts - display-text hygiene used by every sink
- test/eval.test.ts, test/failure/*, test/security/*, test/readme.test.ts - new tests
- reports/eval-2026-10-20-live.md / .json - the committed final live report
- README.md, docs/ARCHITECTURE.md, docs/DEMO_SCRIPT.md, docs/CASE_STUDY.md, docs/RELEASE_CHECKLIST.md, docs/SECURITY.md, docs/LIMITS.md, docs/RESULTS_SUMMARY.md
- docs/private/ (GITIGNORED): NOTE_TO_AGENCY.md, blocked-terms.txt, reference/ (moved out of the public tree, D-134)

## 3. Commands and expected output (PowerShell, project folder)
```
npm ci                                  -> "found 0 vulnerabilities" (esbuild install-script warning is harmless)
Copy-Item .env.example .env             -> REFERENCE_DATE=2026-10-19 is already set
npm test                                -> "Test Files 24 passed", "Tests 278 passed"
npm run test:failure                    -> 10 passed
npm run test:security                   -> 36 passed; the attack-surface matrix prints 63 PASS cells
npm run eval:fake                       -> "PLUMBING CHECK - accuracy not measured" ... "failures 0" ... "PASS"
npm run eval:live                       -> prints the plan (28 documents, 3 repeats, 84 expected calls) and STOPS
npm run eval:live -- --report-only --date 2026-10-20  -> rebuilds the live report from reports/raw (no calls)
npm run results:summary                 -> 10 lines; updates docs/RESULTS_SUMMARY.md and the README / case study / note blocks
npm run docs:check-numbers              -> "Every number was found in the evaluation JSON, fixtures/README.md or the allowlist."
npm run demo:warm                       -> lists uncached demo documents and STOPS (live only with RUN_LIVE_LLM=1 and -- --confirm)
npm run demo:reset                      -> "Extraction source used: ..." then serves http://127.0.0.1:8787/?t=demo-token
powershell -ExecutionPolicy Bypass -File scripts\hygiene.ps1   -> PASS for the working tree; HISTORY hits listed in section 9
```

## 4. Decisions and deviations (DECISIONS.md D-126 ... D-135)
D-126 LLM measurement hooks; D-127 replay design; D-128 .gitignore (final live report committable; raw, fake, private, .vitest ignored);
D-129 SQLite busy behaviour + unsaved folder removal (new outcome failed_not_saved, new audit type policy_not_saved);
D-130 display-text hygiene at every sink; D-131 damaged-PDF reason; D-132 pricing (typed by the user, USD assumed);
D-133 licence undecided; D-134 reference docs moved to docs/private (they contain private notes); D-135 .env.example
REFERENCE_DATE, hygiene terms file, generated result blocks, demo scripts. No prompt revision (v1 final: no measured error).
Deviation: the evaluation date in file names is 2026-10-20 (the real date in Pacific/Auckland); the pipeline used 2026-10-19.

## 5. Test status
278 tests pass with no key and no network (Prompt 1-4: 226; Prompt 5: eval 17, failure 10, security 23, readme 2). The web
tests are re-run by test:security. Live calls happen only in eval:live / demo:warm / extract:one / live:check, each gated.

## 6. Environment variables
No new variables. .env.example now sets REFERENCE_DATE=2026-10-19. demo:reset sets REFERENCE_DATE and
APPROVAL_WEB_TOKEN=demo-token for its own process only (values already in the environment win over .env; verified).

## 7. Libraries and versions (installed; verify in the official docs)
Unchanged from Prompt 4: typescript 7.0.2, zod 4.6.7, vitest 5.0.5, tsx 4.23.15, @biomejs/biome 2.5.15, pdfjs-dist 6.4.299,
pdf-lib 1.17.1, exceljs 4.4.0 (uuid override 11.1.1), openai 7.39.0, grammy 1.46.0, node:sqlite (Node 24.19.0).
Newly used names, read from installed types only: openai `APIError.status`, `APIConnectionTimeoutError`, `RateLimitError`,
`APIConnectionError`, `usage.prompt_tokens_details.cached_tokens`; grammY's "1-4096 characters" message limit. VERIFY these.
npm audit: "found 0 vulnerabilities" (nothing to upgrade).

## 8. Final report headline (reports/eval-2026-10-20-live.md; generated lines in docs/RESULTS_SUMMARY.md)
gpt-5.4-nano-2026-03-17, prompt v1, 28 synthetic documents x 3 repeats, 84 calls, 0 retries, 0 failed calls:
field values 672 of 672, pages 672 of 672, quote check 672 of 672, wrong-at-high-confidence 0, exclusion keys 312 of 312,
differences 30 of 30 found and 30 of 30 real, final status 45 of 45, pol-s14 injection PASS x3, 36 facts at "medium"
confidence (all correct, varying between repeats), cost 0.069586 USD. Synthetic set written by the author: not real-world accuracy.

## 9. Known issues
- GIT HISTORY (decision for the user): earlier commits contain docs/reference (private notes about a third party), the
  project-path name (three files), .vitest/json/output.json, an old test email and your commit emails. Options: rewrite
  history (for example with git filter-repo; verify the tool), or publish a fresh repository from a clean snapshot.
- Licence, agency-owner name and agency name not given (README says "Licence: to be decided"; note has a placeholder;
  add the names to docs/private/blocked-terms.txt).
- The model's "medium" confidence raises no flag (D-B flags only low); labels varied between repeats.
- Favicon requests from a real browser are audited as unauthorised_attempt (noise in audit --attempts).
- Windows only; macOS and Linux untested. Telegram never run against the real API. X-Unsent unverified in mail apps.
- Mermaid diagrams not rendered to images here. Demo video and GIF not recorded.
- `npm run build` compiles but dist/ lacks the SQL migrations; the project runs through tsx.

## 10. FINAL SELF-REVIEW (adversarial)

| Item | Result | Evidence |
| --- | --- | --- |
| Rule 1 Draft-only | PASS | test/security/noSend.test.ts (code + every production dependency); no mail library; approve copies files only (approval tests, real-browser approve) |
| Rule 2 Page per fact; uncertain flagged, never guessed | PASS, with a gap | schema requires a page for a found value (D-010); verifyQuotes; failure test "empty page" -> low + needs-human-check; live pages 672 of 672. GAP: model "medium" passes with no flag |
| Rule 3 Numbers by plain code | PASS | src/compare pure; test/security/injection.test.ts (11 scenarios x 3 injected texts unchanged; structural scan) |
| Rule 4 Read-only except status | PASS | test/security/readOnly.test.ts (only updateRenewalStatus('approved'); only the overlay changes; fixtures hash equal) |
| Rule 5 Idempotent | PASS | pipeline tests (second run unchanged_skip x13; versioning; unique indexes) |
| Rule 6 Every action audited | PASS, with notes | audit tests; failures audited (test/failure); DB-locked failure audited at run end or stderr. Notes: dry run writes no audit by design (D-069); favicon noise |
| Rule 7 Synthetic only; documents untrusted | PASS for data; history issue | fixtures synthetic markers; pol-s14 live PASS x3; matrix 63 PASS. History holds private reference notes (not client data) |
| DoD: daily run finds, reads, compares, builds, asks | PASS | eval:fake; live eval; clean clone; demo:reset |
| DoD: Approve saves + updates; Skip and Open work; nothing sent | PASS | approval tests; test/security/readOnly; real-browser Approve (stage-10.md) |
| DoD: kill switch, dry run, audit, idempotency tested | PASS | test/pipeline.test.ts |
| DoD: evaluation report on 15 scenarios, measured, honest failure list | PASS | reports/eval-2026-10-20-live.md (failure table empty; "does NOT prove" section; confidence finding) |
| DoD: README, architecture diagram, demo script, demo, note, case study | PARTIAL | all documents exist; the 60-90 second demo VIDEO is not recorded; diagrams not rendered to images |

README vs report gaps found and fixed: "Windows, macOS or Linux" (only Windows tested) -> corrected. Remaining tension: the
README's "uncertain facts are flagged" is true for low confidence and quote failures, but the report shows the model labels
some correct facts "medium", which are not flagged; LIMITS.md states this.

Known risks: a perfect score on self-written synthetic documents can be over-read; the live set is one template family;
publishing the current history would expose private notes; exceljs maintenance; node:sqlite stability level; one machine.

Ten most important fixes, in priority order:
1. Decide the git-history question before publishing anything (rewrite or fresh repository).
2. Choose and add a licence.
3. Record the demo video and GIF; replace the README placeholders.
4. Evaluate on real, permitted documents from several insurers and layouts; the current numbers cannot speak to that.
5. Decide whether model "medium" confidence should raise a review flag (changes locked rule D-B; needs your call).
6. Add an exclusions confidence or a "no exclusions section found" check, so a missed list cannot look like removals.
7. Answer /favicon.ico before the session check so real browsers stop adding unauthorised_attempt noise.
8. Run the test suite on macOS and Linux (or CI) before claiming them.
9. Check X-Unsent in Outlook and Thunderbird; test Telegram live only if you will show it.
10. Re-check exceljs maintenance and node:sqlite stability; re-run npm audit at release.

Next: paste README.md, reports/eval-2026-10-20-live.md and this table into a FRESH chat for an independent second review.

## Hygiene checklist (PowerShell; the blocked terms live only in docs\private\blocked-terms.txt)
```
powershell -ExecutionPolicy Bypass -File scripts\hygiene.ps1
# Individual checks it runs (Select-String), for reference:
$terms = Get-Content docs\private\blocked-terms.txt | Where-Object { $_ -match '^[iw]:' } | ForEach-Object { $_.Substring(2) }
git ls-files | Select-String -SimpleMatch -Pattern $terms -List                              # blocked terms, tracked files
git rev-list --all | ForEach-Object { git grep -I -l -i -F -e 'TERM' $_ }                      # one term, whole history
git ls-files | Select-String -Pattern 'sk-[A-Za-z0-9_-]{16,}'                                  # API-key shapes
git ls-files | Select-String -Pattern '\b\d{6,12}:[A-Za-z0-9_-]{30,}\b'                        # bot-token shapes
git ls-files | Select-String -Pattern '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -AllMatches   # emails (keep example.com only)
git ls-files | Select-String -Pattern '^(\.env$|\.cache/|runtime/|output/|data/|reports/raw/|docs/private/|\.vitest/)'
git log --all --name-only --pretty=format: | Select-String -Pattern '^(\.env$|\.cache/|runtime/|output/|reports/raw/|docs/private/|docs/reference/|\.vitest/)' | Sort-Object -Unique
```
