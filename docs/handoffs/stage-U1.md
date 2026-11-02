# Handoff - Prompt 7 Stage U1 (domain model, rules, storage)

Status: done, not committed (the user types "commit" later). Built without questions at the user's request
("just build it please ask no question"); every judgement call is a written decision (D-F, D-090..D-094).

## Files
- docs/UPLOADS.md - "Current state" (gate facts) and "Domain model" (nouns, modes, UploadJob state diagram, U-1..U-7)
- src/state/migrations/002_uploads.sql - cases.origin, packs.input_source, tables uploads, uploaded_documents, manual_clients, manual_policies, exports
- src/state/repo.ts - CaseOrigin / InputSource, CaseRow.origin, PackRow.inputSource, optional origin / inputSource on insert
- src/state/audit.ts - 11 new audit event types
- src/config/env.ts, .env.example - UPLOAD_MAX_MB, UPLOAD_MAX_PAGES, UPLOAD_DAILY_LIMIT, UPLOAD_RETENTION_DAYS, ANALYSIS_TIMEOUT_SECONDS
- src/uploads/model.ts - modes, states, transitions, InvalidUploadTransitionError
- src/uploads/errors.ts - UploadErrorCode union with plain messages, UploadRejectedError, UploadFailedError
- src/uploads/repo.ts - upload, stored-document, manual client/policy and export repositories; daily-limit counter
- test/uploadsRepo.test.ts - state machine (every pair), codes, repositories, U-5 ids, day boundary + both DST days, 001 -> 002 upgrade
- test/state.test.ts - ONE line changed: expected applied migrations now `['001_initial', '002_uploads']` (D-092)
- docs/DECISIONS.md, docs/PRODUCT_BRIEF.md, docs/PROJECT_STATE.md - D-F and U1 decisions, status, signatures, env

## Checks (run here, real output)
- `npm run typecheck` - no errors
- `npx biome lint src test` - "Checked 82 files ... No fixes applied."
- `npx vitest run` - "Test Files 17 passed (17) / Tests 277 passed (277)"
- `npm run fixtures:hash -- --check` - "fixtures:hash check OK - 50 files, combined 65bfa9e1...ecf matches the snapshot"

## Decisions and deviations
- D-090: the four U-2 codes are FAILURE codes (job `failed`), although the prompt lists them under UploadRejectedError.
- D-091: the daily limit counts jobs that entered `extracting` on the local TIMEZONE day.
- D-092: the only edit to an existing test (the exact migration list).

## Known issues
- None new in U1. The upgrade test inserts raw 001-era rows with SQL (pack_json is a placeholder), so it checks
  columns and row preservation, not pack parsing.
