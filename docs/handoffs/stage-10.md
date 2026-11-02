# HANDOFF - STAGE 10 (README, demo, release)

Date: 2026-10-19. Status: done up to CHECKPOINT D (final commit and tag v1.0.0 wait for the user's "commit").
The README, report and final self-review are in docs/handoffs/prompt-5.md.

## Files
- README.md - pitch + disclaimer, GIF/video placeholders, problem, how it works + Mermaid, safety design, quick start, approval page, optional Telegram, configuration table (every env variable), generated evaluation lines, limits, structure, testing, licence (to be decided), credits
- docs/ARCHITECTURE.md - component diagram and one-morning sequence diagram (Mermaid), rendering notes
- docs/DEMO_SCRIPT.md - 85-second shot list, rules, what you should see (corrected after a real-browser run)
- docs/CASE_STUDY.md - 679 words, generated compact results block
- docs/RELEASE_CHECKLIST.md - release checklist, description and topics
- docs/RESULTS_SUMMARY.md - generated 10 lines (npm run results:summary)
- docs/private/NOTE_TO_AGENCY.md - GITIGNORED one-page note (owner name still a placeholder)
- docs/private/blocked-terms.txt - GITIGNORED blocked terms read by the hygiene scan
- docs/private/reference/ - GITIGNORED: the original guide and prompt pack, moved out of the public tree (D-134)
- scripts/demoReset.ts, scripts/demoWarm.ts, scripts/demo/demoPolicies.ts - demo:reset / demo:warm
- scripts/hygiene.ps1 - Select-String hygiene scan of tracked files and git history
- test/readme.test.ts - env table and `npm run` consistency
- Changed: .env.example (REFERENCE_DATE=2026-10-19), scripts/resultsSummary.ts (fills markers), scripts/eval/numbers.ts (ranges), scripts/eval/summaryLines.ts (compact lines), test/schemas.test.ts (reserved example domain), docs/LIMITS.md, docs/DECISIONS.md (D-134, D-135), docs/PROJECT_STATE.md, package.json (demo:reset, demo:warm).

## Checks run (real output)
- `npm test`: 24 files, 278 passed. `npm run typecheck`: no output. `npm run lint`: "Checked 142 files ... No fixes applied."
- `npm run docs:check-numbers`: "Every number was found in the evaluation JSON, fixtures/README.md or the allowlist." (README, CASE_STUDY, RESULTS_SUMMARY, private note). Two checker issues were found and fixed first: a rounded "4113" (now the traceable 4113.3) and number ranges ("60-90") that were skipped.
- Case study word count: 679 (`wc -w`) and 679 (PowerShell `Measure-Object -Word`).
- `powershell -ExecutionPolicy Bypass -File scripts\hygiene.ps1`: working tree clean for every blocked term, key and token shapes, non-example emails and forbidden files. HISTORY hits (explained, not removable without a rewrite): the project-path name in .vitest/json/output.json, scripts/runLocal.ps1, docs/MANUAL_TEST_APPROVAL.md in older commits; the word "State" (an English word, not the insurer) in older docs; a.person@gmail.com in an older test; commit author/committer emails; .vitest/json/output.json ever committed. docs/reference (private notes) is in history too (D-134).
- Clean clone (temp folder outside the project, branch at 239349f), README followed literally: npm ci (0 vulnerabilities; esbuild install script blocked, as the README says), Copy-Item .env.example .env (REFERENCE_DATE=2026-10-19), build exit 0, tests 278 passed, fixtures:verify OK 1281 checks, reset-demo seeded 1, run --fake-llm "new_pack=11 needs_attention=2 skipped_outside_window=1 skipped_already_processed=1", serve printed the 127.0.0.1 link, the link answered 303, the page showed 11 draft cards plus the pol-s07 and pol-s08 notices; stopped. No README fix was needed for the clone.
- demo:reset: fake mode (no cached live extraction in this worktree), statuses s01 low, s02 high, s03 high, s07 needs_attention; page on 127.0.0.1 with demo-token: 303 login, 3 cards, pol-s07 notice, wrong token 403.
- Real browser (built-in browser pane): clicked Approve on the flood card -> "/pack/3?done=approved", page text "Approved. The drafts were saved under output/approved and the renewal status was updated. Nothing was sent." and "Approved by broker ... (via web)"; `npm run status`: pol-s03 approved.

## Not done or not verified
- Demo video and GIF not recorded (user). Mermaid diagrams not rendered to images here.
- Owner name, agency name and licence still not given.
- Favicon requests from a real browser are audited as unauthorised_attempt (noise in `npm run audit -- --attempts`).
