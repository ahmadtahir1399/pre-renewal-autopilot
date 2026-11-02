# HANDOFF - PROMPT 2 (Renewal selection + policy extraction with quote verification)

Date: 2026-10-19. Read with docs/PRODUCT_BRIEF.md, docs/PROJECT_STATE.md (full signatures) and docs/DECISIONS.md.

## 1. Status
Done (Stage 3 and Stage 4, including the live check). Not yet committed: waiting for the user to type
"commit" (message "prompt 2: selection and policy extraction with quote verification", tag prompt-2-done).
Gate notes from the start of Prompt 2: Prompt 1 was committed as "feat: add shared domain types..." and the
prompt-1-done tag does not exist. Everything else passed (typecheck, 68 tests, verify, hash 65bfa9e1...81ecf).

## 2. Files
Changed
- src/config/env.ts - FIXTURES_DIR, RUN_LIVE_LLM, LLM_TEMPERATURE added; DATA_DIR default 'fixtures/data' -> 'data' (D-028/029/031)
- .env.example, .gitignore (/data/ anchored), package.json (list:due, extract:one, live:check; openai dep), test/env.test.ts, scripts/checkEnv.ts
- docs/PROJECT_STATE.md, docs/DECISIONS.md (D-028 ... D-043)

New - Stage 3
- src/data/datasource.ts - DataSource interface; documents that updateRenewalStatus is the only write
- src/data/localJsonSource.ts - fixtures + status overlay (DATA_DIR/runtime/status-overlay.json), atomic write, guard against writing inside fixtures
- src/data/seedState.ts - loadSeedState, processedCycleKeysFrom
- src/data/notionSource.ts - optional stub; lists Notion API details to verify
- src/selection/renewalWindow.ts - selectRenewals (inclusive window, stable sort, missing-document comment)
- src/selection/groupByClient.ts - stable client grouping
- scripts/listDue.ts - `npm run list:due`
- test/dataSource.test.ts, test/selection.test.ts

New - Stage 4
- src/documents/pdfText.ts - per-page text (pdfjs-dist), DocumentMissingError / DocumentUnreadableError
- src/documents/prompts/extractTerms.ts - prompt v1, delimiters, ignore-instructions sentence, delimiter hardening
- src/documents/extractTerms.ts - LLM extraction validated by Zod
- src/documents/verifyQuotes.ts - plain-code quote / value / date / page checks with typed warnings
- src/documents/cache.ts - ExtractionCache, JSON-file cache under .cache/extractions, memory cache
- src/documents/index.ts - readPolicyTerms (cache -> read -> extract -> verify -> store)
- src/llm/client.ts - LlmClient, shared retry runner, OpenAiLlmClient, createLlmClient
- src/llm/fakeClient.ts - FakeLlmClient (queued responses, records calls, same retry path)
- scripts/extractOne.ts - `npm run extract:one -- <policyId> <expiring|renewal>` (live; needs RUN_LIVE_LLM=1)
- scripts/liveCheck.ts - `npm run live:check` (live; 8 documents vs answer keys; writes reports/live-check-prompt2.json)
- test/extraction.test.ts

## 3. Exact public signatures
In docs/PROJECT_STATE.md, sections "src/data", "src/selection", "src/llm", "src/documents". Most used later:
```ts
new LocalJsonSource({ fixturesDir, dataDir })        // DataSource; updateRenewalStatus is the only write
selectRenewals({ policies, today, minDays, maxDays, processedCycleKeys, clientNameById }): { candidates, skipped }
groupByClient(candidates, clientNameById): ClientGroup[]
loadSeedState(fixturesDir): SeedState; processedCycleKeysFrom(seed): Set<string>
createLlmClient(env): LlmClient                      // LLM_PROVIDER=openai, LLM_API_KEY, LLM_MODEL
readPolicyTerms(pdfPath, { llm, cache?, maxRetries?, policyId?, documentKind? }):
  Promise<{ terms: ExtractedTerms; warnings: ExtractionWarning[]; usage: LlmUsage; fromCache: boolean }>
interface ExtractionWarning { code; field; sourcePage: number | null; message }
```

## 4. Prompt version and model
EXTRACT_PROMPT_VERSION = 'v1'. Model: gpt-5.4-nano-2026-03-17 (OpenAI, Chat Completions, JSON mode, temperature not sent).

## 5. Decisions and deviations (details in DECISIONS.md)
- D-028 GAP FIX: FIXTURES_DIR added and DATA_DIR default changed to 'data', because the old default put the overlay inside fixtures/.
- D-029 RUN_LIVE_LLM; D-031 LLM_TEMPERATURE (only sent when set).
- D-030 ADDITION: clientNameById for the client-name tie-break; locale-free comparison.
- D-032 DataSource is async; unknown ids -> undefined; absolute document paths; overlay format; atomic write.
- D-033 seed state read by its own helper; LocalJsonSource does not apply it to statuses.
- D-035/036/037 OpenAI SDK 7.39.0; LlmClient.model added; JSON mode + Zod + 2 retries with feedback.
- D-038 HARDENING: delimiters removed from document text, '<<<'/'>>>' runs broken, fake [PAGE n] labels defused.
- D-040 typed ExtractionWarning (7 codes). Prompt 1's QuoteNotFoundWarning class is unused.
- D-041 cache stores verified result + usage only; on a hit `usage` is the original spend.
- D-043 model chosen from the user's models list (lightest tier, dated snapshot).

## 6. Commands and expected output (PowerShell)
```
npm run typecheck                -> no output
npm test                         -> "Test Files 8 passed (8)  Tests 111 passed (111)"
npm run list:due                 -> 13 candidates grouped by client; "Skipped: pol-s09 (outside_window), pol-s12 (already_processed)"
npm run fixtures:hash -- --check -> combined 65bfa9e1...81ecf matches the snapshot
$env:RUN_LIVE_LLM='1'; npm run extract:one -- pol-s01 expiring; Remove-Item Env:RUN_LIVE_LLM
$env:RUN_LIVE_LLM='1'; npm run live:check; Remove-Item Env:RUN_LIVE_LLM
                                 -> 8 lines "differences=0 warnings=0", "totalDifferences": 0 (CACHE on reruns)
```
Without RUN_LIVE_LLM=1 both live scripts print "Refusing to run..." and exit 1.

## 7. Test status
111 tests pass with no API key and no network: dates 19, schemas 14, env 9, logger 5, ground truth 21,
data source 12, selection 11, extraction 20. Nothing skipped. Live calls exist only in scripts gated by RUN_LIVE_LLM.

## 8. Environment variables
New: FIXTURES_DIR (fixtures), RUN_LIVE_LLM (false), LLM_TEMPERATURE (unset). Changed default: DATA_DIR (data).
Used now: LLM_PROVIDER=openai, LLM_API_KEY (secret, .env only), LLM_MODEL=gpt-5.4-nano-2026-03-17.
Not needed until Prompt 4: TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_CHAT_IDS.

## 9. Libraries and versions (verify each in its official docs)
openai 7.39.0 (new; names used were read from its installed .d.ts: OpenAI({apiKey, timeout, maxRetries}),
chat.completions.create({model, messages, response_format, temperature}), choices[0].message.content,
usage.prompt_tokens / usage.completion_tokens, models.list()). pdfjs-dist 6.4.299 (alternatives: unpdf, pdf-parse).
zod 4.6.7 (z.toJSONSchema used). Others unchanged from Prompt 1.

## 10. Live results vs ground truth (task 11)
Run on 2026-10-19 with gpt-5.4-nano-2026-03-17, prompt v1. Compared exactly: value and sourcePage of all 8 facts,
presence of page + quote, and the multiset of exclusion key@page. Titles/summaries not compared (free text).

| Document | Source | Input tokens | Output tokens | Differences | Warnings | Low confidence |
| -------- | ------ | ------------ | ------------- | ----------- | -------- | -------------- |
| pol-s01 expiring | live (extract:one) | 2343 | 465 | 0 | 0 | none |
| pol-s01 renewal | live | 2362 | 456 | 0 | 0 | none |
| pol-s03 expiring | live | 2316 | 421 | 0 | 0 | none |
| pol-s03 renewal | live | 2377 | 457 | 0 | 0 | none |
| pol-s04 expiring | live | 2291 | 438 | 0 | 0 | none |
| pol-s04 renewal | live | 2312 | 424 | 0 | 0 | none |
| pol-s14 expiring | live | 2292 | 429 | 0 | 0 | none |
| pol-s14 renewal | live | 2311 | 433 | 0 | 0 | none |
| Total | | 18604 | 3523 | 0 | 0 | |

- Differing fields: NONE. Every fact had a page and a quote, and verifyQuotes accepted every quote, number and date.
- pol-s14: normal values extracted (identical to the answer key); the injected sentence had no effect.
- pol-s04: the reworded exclusion mapped to gradual_deterioration in both documents (keys: gradual_deterioration, cyber_event, terrorism).
- pol-s03 renewal: flood correctly listed (flood, wear_and_tear, gradual_deterioration, vacant_or_unoccupied_building).
- Second run: 8/8 cache hits, 0 new tokens, 0 LLM calls.
- No retries were needed (each document's usage matches a single call).
- Costs were not calculated (prices not checked).
- Honest limit: 8 of 28 readable PDFs, one run each, clean synthetic layouts. Prompt 5 should measure all 28 and repeat runs.

## 11. Known issues
- SECURITY: an OpenAI API key was pasted into the chat on 2026-10-19. It was never written by me to any file or log; the user should revoke it and use a new key in .env.
- Prompt 1 commit message/tag differ from the plan (see section 1).
- npm "install-scripts" warnings persist (esbuild); tools work.
- reports/live-check-prompt2.json and .cache/ are gitignored, so the live evidence lives only in this handoff.

## 12. Notes for Prompt 3
- Input to the comparison engine: readPolicyTerms(...).terms for each side. A fact with confidence 'low' (or null)
  must produce NO computed difference plus a medium "needs human check" flag naming the field (D-B).
  Carry ExtractionWarning codes into the pack/flags so the broker sees why.
- Reference implementation to test against (do not import into src): scripts/fixtures/expectations.ts
  (computeExpectedComparison). Keep the D-014 diff order and the period rule shape.
- Evaluate on field / change / severity / values; facts and message text are free wording (D-019).
- Premium thresholds come from env PREMIUM_MEDIUM_PCT / PREMIUM_HIGH_PCT; compare unrounded percentages (D-023).
- Pack has no overallRisk field; add it only if needed (smallest change, record it).
- Outputs (.xlsx, .eml) go under OUTPUT_DIR; drafts only, no sending code. Never put document text in logs.
- For Prompt 4: DataSource.updateRenewalStatus is the only write; seed SQLite from loadSeedState so pol-s12 ends approved;
  pol-s07 (DocumentMissingError on renewal) and pol-s08 (DocumentUnreadableError on expiring) -> needs_attention.
