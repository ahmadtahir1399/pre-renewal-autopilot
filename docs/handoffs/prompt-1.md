# HANDOFF - PROMPT 1 (Foundation, domain model, synthetic fixtures)

Date: 2026-10-19. Read with docs/PRODUCT_BRIEF.md, docs/PROJECT_STATE.md and docs/DECISIONS.md.

## 1. Status
Done (Stage 1 and Stage 2). Not yet committed: waiting for the user to type "commit"
(message "prompt 1: foundation, domain model, synthetic fixtures", tag prompt-1-done).

## 2. Files
Root
- package.json - npm scripts (build, typecheck, test, lint, env:check, fixtures:generate|verify|hash), ESM
- package-lock.json - locked versions (pdf-lib version matters for byte-identical PDFs)
- tsconfig.json - strict typecheck for src, scripts, test; tsconfig.build.json - builds src to dist/
- vitest.config.ts - runs test/**/*.test.ts
- biome.json - light linter (recommended rules, uses .gitignore)
- .gitignore, .gitattributes (LF everywhere, PDFs binary), .editorconfig, .env.example (no values for secrets)
- reports/.gitkeep, templates/.gitkeep - placeholders

src
- src/*/README.md (12 folders) - single responsibility of each folder
- src/domain/types.ts - all domain types (fixed names)
- src/domain/schemas.ts - Zod schemas, fixed vocabularies, parse helpers, compile-time drift checks
- src/domain/dates.ts - date-only helpers and Clock
- src/domain/errors.ts - typed errors with stable codes; QuoteNotFoundWarning
- src/config/env.ts - Zod-validated env, one readable problem list, requireEnv for secrets
- src/config/logger.ts - JSON-lines logger with redaction and truncation

scripts
- scripts/checkEnv.ts - `npm run env:check`: validate config, print non-secret summary
- scripts/generateFixtures.ts - deterministic generator for fixtures/
- scripts/verifyFixtures.ts - independent checks (files, schemas, days table, quotes on pages, S08 no text, S14 injection)
- scripts/hashFixtures.ts - SHA-256 per file + combined; snapshot write / --check
- scripts/fixtures/scenarios.ts - the 15 scenarios with explicit values and hand-written expectations
- scripts/fixtures/catalog.ts - invented names, exclusion wordings (3 per key), clause wordings
- scripts/fixtures/documentModel.ts - builds the fixed 4-page content of each document
- scripts/fixtures/pdfWriter.ts - pdf-lib renderer (text PDF, image-only PDF)
- scripts/fixtures/bitmapFont.ts, png.ts - deterministic rasteriser for the S08 scan
- scripts/fixtures/expectations.ts - independent D-B/D-C reference for the answer key
- scripts/fixtures/pdfText.ts - plain-code PDF text reader (pdfjs-dist)
- scripts/fixtures/rng.ts, format.ts - seeded RNG; locale-independent money/percent formatting

test
- test/dates.test.ts, schemas.test.ts, env.test.ts, logger.test.ts - Stage 1 unit tests
- test/groundTruth.test.ts - answer keys vs a hand-typed copy of the scenario table

fixtures (generated)
- fixtures/data/{clients,brokers,insurers,policies,seed-state}.json
- fixtures/documents/pol-s01..pol-s15/{expiring,renewal}.pdf (29 PDFs; pol-s07 has no renewal)
- fixtures/ground-truth/pol-s01..pol-s15.json
- fixtures/README.md - scenario table; fixtures/fixtures.sha256 - hash snapshot

docs
- docs/PRODUCT_BRIEF.md - word-for-word rules and locked decisions
- docs/PROJECT_STATE.md - status, signatures, env vars, libraries, known issues
- docs/DECISIONS.md - D-A..D-D, D-001..D-027
- docs/reference/ - the original build guide PDF and prompt pack (background; lower precedence)
- docs/handoffs/prompt-1.md - this file

## 3. Exact public signatures
See docs/PROJECT_STATE.md, section "Public interfaces" (types.ts, schemas.ts, dates.ts, errors.ts, env.ts,
logger.ts, fixture file shapes, scripts/fixtures/pdfText.ts and expectations.ts). Key ones:
```ts
isWithinWindow(today: IsoDate, expiry: IsoDate, minDays: number, maxDays: number): boolean // inclusive
cycleKey(policyId: string, expiryDate: IsoDate): string // 'pol-s01:2027-01-17'
interface Clock { today(): IsoDate }; fixedClock(date); systemClock(timeZone, now?)
parseEnv(source): Env; requireEnv(env, keys): EnvWith<K>; loadEnvOrExit(): Env
createLogger(options?): Logger
parsePolicies / parseClients / parseBrokers / parseInsurers / parseSeedState / parseGroundTruth / parseExtractedTerms
class DocumentMissingError(policyId, documentKind); class DocumentUnreadableError(documentPath, reason)
class LlmOutputInvalidError(problems, attempts); class QuoteNotFoundWarning(field, sourcePage, message?)
```

## 4. Decisions and deviations
- ADDITIONS (smallest change, reported): Flag (D-003), Insurer (D-005), GroundTruth / SeedState / reason enums
  (D-006), addYears / formatLongDate / isValidIsoDate / fixedClock / systemClock (D-009),
  DomainValidationError and AutopilotError base (D-010, D-013).
- Diff field names and canonical order (D-008, D-014). Period rule = one 'periodStart' diff
  (expiring = old periodEnd, renewal = new periodStart). policyNumber/policyType not compared.
- Evaluation must compare field / change / severity / values and exclusion key + page, NOT the exact
  facts / message / title / summary wording (D-019).
- Non-pack scenarios have null diffs/flags/overallRisk; terms are given for all 28 readable PDFs (D-020).
- pol-s12 approval lives in seed-state.json only; policies.json is all not_started (D-027).
- Linter: Biome instead of ESLint (D-001). TypeScript resolved to 7.0.2 (see section 8).

## 5. Commands and expected output (PowerShell and bash are the same here)
```
npm install
npm run typecheck            -> no output, exit 0
npm run lint                 -> "Checked N files ... No fixes applied."
npm test                     -> "Test Files 5 passed (5)  Tests 68 passed (68)"
npm run build                -> no output, dist/ created
npm run env:check            -> one JSON line "Configuration OK" ... "presence":"LLM_API_KEY=not set, TELEGRAM_BOT_TOKEN=not set"
npm run fixtures:generate    -> "Generated 15 policies, 29 PDFs, 15 ground-truth files (reference date 2026-10-19)."
npm run fixtures:hash -- --check -> "fixtures:hash check OK - 50 files, combined 65bfa9e1...81ecf matches the snapshot"
npm run fixtures:verify      -> 15 "checked pol-sNN" lines, then "fixtures:verify OK - 1281 checks passed, 0 failures, 0 warnings"
```
Bad env (PowerShell): `$env:WINDOW_MIN_DAYS='abc'; $env:RUN_TIME='7am'; npm run env:check; Remove-Item Env:WINDOW_MIN_DAYS, Env:RUN_TIME`
-> "Configuration error: 2 problem(s) found" with one line per variable, exit code 1.

## 6. Test status
68 tests pass (dates 19 incl. 84/112/83/113 boundaries, leap years, month ends, DST, time-zone clock;
schemas 14; env 9; logger 5; ground truth 21). Nothing skipped. All run without any API key.

## 7. Environment variables
All 19 listed in docs/PROJECT_STATE.md with defaults. No Prompt 1 command needs LLM_* or TELEGRAM_*.
Secrets are optional at parse time; commands call requireEnv for what they use.

## 8. Libraries and versions (installed; please verify each in its official docs)
typescript 7.0.2, zod 4.6.7, vitest 5.0.5, tsx 4.23.15, @biomejs/biome 2.5.15, @types/node 24.x,
pdf-lib 1.17.1 (dev), pdfjs-dist 6.4.299. Runtime seen: Node 24.19.0, npm 12.0.2.
Verify yourself: `node --version`, `npm --version`, `npx tsc --version`, `npx vitest --version`,
`npx biome --version`, `npx tsx --version`. None of these were checked against official docs in this session.
TypeScript 7 is the native-compiler line; the tsconfig flags typecheck cleanly with it.

## 9. Known issues
- npm 12 printed "install-scripts" warnings (esbuild postinstall not approved). tsx and vitest still work.
- Byte-identical PDFs depend on the locked pdf-lib version. If it changes, regenerate, run fixtures:verify,
  and update the snapshot on purpose (`npm run fixtures:hash`).
- The image-only check uses pdf.js text extraction; there is no OCR anywhere (by design).

## 10. Notes for Prompt 2 (and later)
- Selection: use isWithinWindow (inclusive) with WINDOW_MIN_DAYS/WINDOW_MAX_DAYS and fixedClock(REFERENCE_DATE).
  Expected: 13 selected (S01-S08, S10, S11, S13, S14, S15), S09 skipped outside_window, S12 skipped
  already_processed because its cycleKey 'pol-s12:2027-01-19' is in seed-state.json.
- Missing documents are NOT a selection reason: S07 and S08 are selected and later become needs_attention.
- Data source: resolve doc paths with path.join(root, ...p.split('/')); never write fixtures/; status changes go to
  a runtime overlay (the one allowed write). Apply seed-state so pol-s12 reads as approved.
- PDF reading: scripts/fixtures/pdfText.ts shows working pdfjs-dist v6 usage in Node (plain folder path ending in
  "/" for standardFontDataUrl; destroy() on the loading task). pol-s08 expiring yields 0 characters on all pages
  -> DocumentUnreadableError.
- Quote check: every ground-truth sourceQuote is the exact printed line and verifyFixtures proves it is on the
  stated page after lowercasing + whitespace collapse. Use the same normalisation.
- Dates are printed as "17 January 2027"; amounts as "NZD 12,400.00" / "NZD 2,500"; premium line says
  "(excl. GST)". Distractors exist (date of issue; sub-limits on page 2). The LLM must map to yyyy-mm-dd and plain numbers.
- S14 page 3 contains the injection sentence; expected terms are normal and identical across both documents.
- Exclusions are on page 4 under "Section 4 - Exclusions", headed "4.N <title>". S13 includes a sanctions clause
  that maps to key 'other'. S04 rewords gradual_deterioration in the renewal (same key).
- Prompt 3: implement D-B/D-C in src/compare; scripts/fixtures/expectations.ts is the independent reference to test
  against (do not import it into src). Keep the D-014 order. Consider adding overallRisk to Pack only if needed
  (smallest change, record it).
- Prompt 4: final statuses per D-D; pol-s12 stays approved from seed state.
