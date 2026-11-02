# HANDOFF - PROMPT 3 (Comparison engine + xlsx + draft emails)

Date: 2026-10-19. Read with docs/PRODUCT_BRIEF.md, docs/PROJECT_STATE.md (full signatures), docs/DECISIONS.md
and docs/COMPARISON_RULES.md. No LLM is used anywhere in this prompt.

## 1. Status
Done (Stage 5 and Stage 6). Not yet committed: waiting for the user to type "commit"
(message "prompt 3: comparison engine and draft outputs", tag prompt-3-done). Visual checks in Excel and a
mail app are the user's to confirm.
Gate notes: Prompt 2 was committed with the literal message `git commit -m "prompt 2: ..."`; no tags exist yet.
The Prompt 2 live check had 0 differences, so nothing from it affects this prompt (tests use answer-key terms).

## 2. Files
New - Stage 5
- src/compare/compareTerms.ts - pure engine: rules table (COMPARE_RULES), exact premium grading, flags, deriveOverallRisk
- src/compare/format.ts - hand-written number formatting, fixed exclusion labels, one sentence function per field type
- src/compare/summary.ts - buildSummary (headline top 3, details all)
- docs/COMPARISON_RULES.md - broker-readable rules table (date rule marked as an assumption)
- test/compare.test.ts - 11 answer-key scenarios + every rule, boundary and edge case

New - Stage 6
- src/outputs/xlsxLayout.ts - sheet names, headers, widths, severity fills, fixed workbook properties
- scripts/makeTemplate.ts + templates/comparison.xlsx - the styled, frozen-header template (`npm run template:make`)
- src/outputs/buildXlsx.ts - pure workbook model (injection-guarded) + template renderer
- src/outputs/eml.ts - hand-built RFC 5322 drafts (encoding, folding, NZ date, header-injection guard)
- src/outputs/templates/emailTemplates.ts - editable client/insurer wording, TEMPLATE_VERSION
- src/outputs/buildEml.ts - builds both drafts from the comparison
- src/outputs/factCheck.ts - assertEmailFactsMatch, banned-phrase lint
- src/outputs/labels.ts - policy type labels, month names
- src/outputs/writePack.ts - writes the pack folder, content hash, immutability, safe slugs, path guard
- scripts/buildOne.ts - `npm run build:one -- <policyId>` (answer-key terms, real engine, no AI)
- test/outputs.test.ts - xlsx contents, eml headers/bodies, fact checks, injection guards, hashing, slugs

Changed: package.json (exceljs, uuid override, template:make, build:one), docs/PROJECT_STATE.md, docs/DECISIONS.md
(D-044 ... D-059). Removed templates/.gitkeep (the folder now holds the template).

## 3. Exact public signatures (full list in PROJECT_STATE.md)
```ts
const COMPARE_RULES_VERSION = 'r1'
interface CompareConfig { premiumMediumPct: number; premiumHighPct: number }        // whole percents
interface CompareResult { diffs: TermDiff[]; flags: Flag[]; overallRisk: Severity }
function compareTerms(expiring: ExtractedTerms, renewal: ExtractedTerms, config: CompareConfig): CompareResult
function deriveOverallRisk(diffs: readonly TermDiff[], flags: readonly Flag[]): Severity
function buildSummary(diffs: readonly TermDiff[]): { headline: string[]; details: string[] }
const TEMPLATE_VERSION = 't1'
interface WritePackInput { runDate: IsoDate; version: number; client: Client; broker: Broker; policy: Policy;
  terms: { expiring: ExtractedTerms; renewal: ExtractedTerms }; comparison: CompareResult; summary: Summary;
  outputDir: string; templatePath?: string; allowOverwrite?: boolean }
interface WritePackResult { paths: PackPaths; contentHash: string; written: boolean }
interface PackPaths { dir; xlsx; clientEml; insurerEml; summaryTxt; manifest }   // strings
function writePack(input: WritePackInput): Promise<WritePackResult>   // throws PackConflictError, EmailFactMismatchError
```
PATH CONVENTION: PackPaths are RELATIVE to OUTPUT_DIR with '/' separators:
`<runDate>/<clientSlug>/<policyId>/v<version>/{comparison.xlsx, client-email.eml, insurer-email.eml, summary.txt, pack.json}`.
Resolve with `path.join(OUTPUT_DIR, ...p.split('/'))`.

## 4. Decisions and deviations (details in DECISIONS.md)
- D-044 'other' exclusions compared by normalised title (from this prompt's D-B text; PRODUCT_BRIEF is silent, so it is an addition).
- D-045 sort = severity first, then field order (supersedes D-014's order; all 11 answer keys unchanged).
- D-046 pol-s06: the prompt said gap "= 30" but its formula gives 29. The sentence states both
  ("starts ... 30 days after the expiring period ends ... leaving a gap of 29 days without cover").
- D-047 sentence style ("Annual premium increases from 12,400 to 13,144 (+744, +6.0 percent).").
- D-048 insurer names compared case/space-insensitively; zero expiring premium -> needs human check; whole-percent thresholds.
- D-049 overallRisk is NOT on Pack: derive it with deriveOverallRisk(pack.diffs, pack.flags).
- D-050 exceljs 4.4.0 + uuid override; D-051/052 template + pure model; D-053 spreadsheet injection guard;
  D-054 hand-built RFC 5322 (nodemailer rejected: it ships SMTP/sendmail); D-055 header injection guard;
  D-056 insurer placeholder address; D-057 relative paths + pack.json manifest; D-058 writePack refuses
  drafts that fail the fact check or phrase lint; D-059 email wording rules.
- Additions beyond the spec: Comparison sheet column 7 "Details"; Summary sheet rows Status/Policy/Insurer/Key changes;
  pack.json manifest file.

## 5. Commands and expected output (PowerShell)
```
npm run typecheck                    -> no output
npm test                             -> "Test Files 10 passed (10)  Tests 162 passed (162)"
npm run build:one -- pol-s15         -> "pol-s15: overallRisk=high diffs=3 flags=1 written=..." + contentHash f1a7e2121cb9...
npm run build:one -- pol-s02         -> "pol-s02: overallRisk=high diffs=1 flags=1 written=..." + contentHash 6a3f8e37a7f4...
npm run template:make                -> rewrites templates/comparison.xlsx (only needed if the layout changes)
Invoke-Item "output\2026-10-19\quarry-lane-print-works-ltd\pol-s15\v1\comparison.xlsx"
```
A second build:one with the same input prints written=false and the same contentHash.

## 6. Test status
162 tests pass, no API key, no network: compare 34, outputs 17, plus 111 from Prompts 1-2. Nothing skipped.
All 11 pack scenarios match the answer keys exactly (field, expiring, renewal, change, severity, pages; flags; overallRisk);
pol-s09 and pol-s12 identical terms give no diffs.

## 7. Environment variables
No new variables. Used: PREMIUM_MEDIUM_PCT, PREMIUM_HIGH_PCT (CompareConfig), OUTPUT_DIR, REFERENCE_DATE (run date in build:one).
USE_AI_SUMMARY stays false; the AI polish is not built.

## 8. Libraries and versions (verify in the official docs)
exceljs 4.4.0 (MIT; last npm publish 2024-12-20). Verified here only from its installed index.d.ts and by tests:
readFile/writeBuffer, worksheet views {state:'frozen', ySplit}, fills, fonts, numFmt, created/modified.
NOT verified: that Excel opens the file without a repair prompt (user check), long-term maintenance.
uuid 11.1.1 forced via "overrides" (advisory GHSA-w5hq-g745-h8pq in uuid < 11.1.1). npm audit: 0 vulnerabilities.
No mail library (hand-built RFC 5322).

## 9. Known issues
- policyType mismatch between documents is not a rule (D-B has none). Decide one before relying on it.
- X-Unsent: 1 is not verified in any mail app (see checkpoint notes).
- keyExclusions have no confidence; a reader that misses the exclusions list makes them look "removed" (info only).
- The client email repeats summary sentences verbatim, including page references; acceptable but could be smoothed.
- .xlsx bytes are not byte-identical between runs (zip entry timestamps); the content hash uses text on purpose.
- Agency-owner design questions are still "not asked yet".

## 10. Notes for Prompt 4
- overallRisk is DERIVED, not stored on Pack: deriveOverallRisk(pack.diffs, pack.flags).
- Pack.xlsxPath / clientEmlPath / insurerEmlPath = PackPaths values (relative to OUTPUT_DIR). Pack.contentHash = writePack's contentHash.
  Pack.summaryText = buildSummaryText(...) or summary.headline joined.
- inputHash for idempotency should include: both ExtractedTerms (or their extraction cache keys), COMPARE_RULES_VERSION,
  TEMPLATE_VERSION, EXTRACT_PROMPT_VERSION, CompareConfig, model name.
- Versions are immutable: a changed rerun must use version + 1 (writePack throws PackConflictError otherwise).
- writePack can throw EmailFactMismatchError: treat as needs_attention + audit event, never send anyway (nothing sends).
- Telegram "Open" should read the relative paths under OUTPUT_DIR; never expose absolute paths in messages.
- The pipeline must pass the run date in (clock in the pipeline layer only), and thresholds from env.
