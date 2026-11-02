# Release checklist (v1.0.0)

Tick each item yourself. The project is ready to show only when every box is ticked.

- [ ] Tests green: `npm test`, `npm run test:failure`, `npm run test:security`, `npm run typecheck`, `npm run lint`.
- [ ] `npm run eval:fake` passes (plumbing only).
- [ ] Final live evaluation report committed: `reports/eval-2026-10-20-live.md` and `.json`; you have read its failure and confidence tables.
- [ ] `npm run results:summary` re-run, and `npm run docs:check-numbers` shows no unmatched number (or each one reviewed).
- [ ] README commands verified on a clean clone (install, tests, fixtures:verify, reset-demo, run --fake-llm, serve answers on `127.0.0.1`).
- [ ] Repository clean: `git status` shows nothing to commit; no `.env`, `.cache`, `runtime`, `output`, `data`, `reports/raw` or `docs/private` tracked.
- [ ] Hygiene scans clean, including git history (the PowerShell checklist in docs/handoffs/prompt-5.md); every hit explained or removed.
- [ ] `npm audit` reviewed; any upgrade decided by you (no `npm audit fix --force`).
- [ ] Licence decided and added (currently "to be decided").
- [ ] Demo video recorded from docs/DEMO_SCRIPT.md, timed under 90 seconds, and linked in the README (GIF too).
- [ ] Tag `v1.0.0` on the released commit.
- [ ] Repository description, for example: "Concept: draft-only pre-renewal comparison packs for insurance brokers (synthetic data, human approval, audit log)".
- [ ] Topics, for example: `insurance`, `automation`, `llm`, `human-in-the-loop`, `typescript`, `nodejs`, `sqlite`, `document-extraction`, `portfolio`.
- [ ] A pinned note or the description says: concept project, synthetic data only, drafts only.
- [ ] The final self-review (docs/handoffs/prompt-5.md) done, and a second review in a fresh chat with the README, the report and the self-review table.
