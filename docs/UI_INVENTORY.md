# UI INVENTORY - approval page (before Prompt 6)

Written 2026-10-19 at the start of Prompt 6 (UI polish), from the code (src/approval/web/*) and from a live look at
the running page (reset-demo, run --fake-llm, serve --fake-llm on 127.0.0.1:8799 with a throwaway token; states
created with the CLI: approve 7, skip 5, run --fake-llm --force --only pol-s04). This is the checklist for the
redesign: every state below must be designed and viewed, not only the happy path.

Gate result: `npm run typecheck` exit 0; `npm test` 15 files, 226 tests passed.

## 1. Routes (src/approval/web/server.ts) - UNCHANGED by Prompt 6

| Method | Path | Auth | Result today |
| ------ | ---- | ---- | ------------ |
| GET | `/?t=<token>` | token (constant-time) | 303 to `/` + `Set-Cookie: pra_session=...; HttpOnly; SameSite=Strict; Path=/`; bad token -> bare 403 |
| GET | `/` | session cookie | HTML list page |
| GET | `/pack/<id>` | session cookie | HTML pack page; optional `?done=<key>` shows a fixed result message |
| GET | `/pack/<id>/open` | session cookie | xlsx attachment (path from DB only); refused -> bare text 404 with a fixed message |
| POST | `/pack/<id>/approve` | cookie + CSRF field `csrf` + Origin | 303 to `/pack/<id>?done=<key>` |
| POST | `/pack/<id>/skip` | cookie + CSRF field `csrf` + Origin | 303 to `/pack/<id>?done=<key>` |
| any | Host not `127.0.0.1:<port>` / `localhost:<port>` | - | bare 403 `Forbidden` (audited) |
| GET | anything else | session | bare text 404 `Not found` |
| POST | anything else | session | bare text 404 |
| other methods | - | session | bare text 405 |
| POST | body > 4 KB | - | bare text 413 `Too large` |
| any | handler not started | - | bare text 503 `Not accepting actions` |
| any | thrown error | - | bare text 500 `Internal error` |

`?done=` keys: approved, approve_sync, skipped, already_done, superseded, wrong_state, not_found, not_allowed.
There is no 400 page today (malformed ids fall to 404 through the route regex).

## 2. Headers today (every response, `headers()`)

```
Content-Security-Policy: default-src 'none'; style-src 'sha256-QL3jrhA2G2jTRsMLLVYPRIX9L68PnlutP213SX2mfm8='; img-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin          (D-087; NOT no-referrer - see note)
X-Frame-Options: DENY
Cache-Control: no-store
```
Note: CSS is an inline `<style>` block allowed by its sha256 hash. Any change to the CSS changes the hash and
therefore the CSP string. Referrer-Policy is `same-origin` on purpose (D-087: under `no-referrer` real browsers send
`Origin: null` on the page's own POSTs and every Approve was refused). The web test asserts `same-origin`.

## 3. Pages and what they look like today

| Page | Title / h1 | Content today | Problems seen |
| ---- | ---------- | ------------- | ------------- |
| List `/` | "Renewals waiting for your decision" | one muted line ("Drafts only ..."); a card per in_review pack (title, bullet list of card lines, "Details \| Open spreadsheet", Approve, Skip); "Needs attention" section; "Recently decided" section | no summary counts; no header/landmarks; order is by policy id, not urgency or risk; risk is a plain text line "Overall risk: HIGH"; severity in bullets is "[HIGH]" text only; every card looks the same; needs-attention cards show the policy id (`pol-s07`) instead of the client; reason starts lower-case ("renewal document missing."); pol-s12 (seeded approved, no pack) is invisible; no empty-state design beyond one sentence |
| Pack `/pack/<id>` | client - policy type (+ "(version N)") | same card bullets; "All differences" as a bullet list of sentences with a coloured severity chip; "Flags (N items need your eye)" list; "Open the comparison spreadsheet" link; Approve/Skip or a decision line; "Back to all renewals" | no expiring vs renewal table; source pages only appear when the sentence happens to include them; differences and flags repeat the same sentence; no audit trail; no run/mode context; result message at the top is easy to miss |
| Not found (pack page) | "Not found" | "No such pack. Back" | rendered with HTTP **200**, not 404 |
| 403 | - | text/plain `Forbidden` | unstyled; no hint on what to do (open the launch URL again) |
| 404 (other paths) | - | text/plain `Not found` | unstyled |
| 405 / 413 / 500 / 503 | - | text/plain one-liners | unstyled |

## 4. Every state a card / page can be in

| # | State | Where | How it shows today |
| - | ----- | ----- | ------------------ |
| S1 | In review (waiting for a decision) | list + pack | card with Approve + Skip buttons |
| S2 | In review, no changes found (pol-s04, s13, s14) | list + pack | "No changes found between ..." line; "No changes found." / "Nothing needs your eye." |
| S3 | In review, version 2+ | list + pack | title suffix " (version 2)" only |
| S4 | Approved (just now, `?done=approved`) | pack | blue message box at the top + "Approved by <name> at <yyyy-mm-dd hh:mm:ss> UTC (via web)" line at the bottom; buttons gone |
| S5 | Approved, sync failed (`?done=approve_sync`; pack sync_state status_sync_failed) | pack | message "Approved, but saving the drafts or updating the status failed. Run: npm run retry-sync"; on a later visit NOTHING shows the failure (sync_state is not displayed anywhere) |
| S6 | Approved, copy failed (sync_state copy_failed) | pack | same as S5: message only right after the click; not shown later |
| S7 | Skipped (`?done=skipped`) | pack | message box + "Skipped by ..." line |
| S8 | Already decided (`?done=already_done`, double submit) | pack | "This was already decided. Nothing changed." + decision line. Not an error page. |
| S9 | Wrong state (`?done=wrong_state`, e.g. approve after skip) | pack | "This renewal is not waiting for a decision. Nothing changed." |
| S10 | Superseded pack (old version, `/pack/<oldId>`) | pack | "This pack was replaced by version 2." at the bottom; NO link to the new version; the "Open the comparison spreadsheet" link is still shown but Open is refused for superseded packs (bare 404 text) |
| S11 | Superseded result (`?done=superseded`) | pack | "This pack was replaced by a newer version. Nothing changed." |
| S12 | Decided cards on the list ("Recently decided") | list | green left border + decision line + Details/Open links |
| S13 | Needs attention notice (pol-s07 renewal document missing; pol-s08 image-only scan) | list | red left border, `pol-s07: needs attention`, reason + "No comparison was prepared; check the documents by hand." No buttons (correct, D-080) |
| S14 | Seeded approved without a pack (pol-s12) | - | not shown at all |
| S15 | Empty: nothing waiting | list | "Nothing is waiting for a decision." |
| S16 | Fake-LLM mode (`serve --fake-llm` / data from `run --fake-llm`) | - | banner printed in the TERMINAL only; the page shows nothing |
| S17 | `?done=not_found` / `?done=not_allowed` | pack | fixed message keys exist; reachable only in edge cases (shutdown -> not_allowed) |
| S18 | Shutting down (handler null -> 503) | any POST / Open | bare text 503 |
| S19 | Hostile document text (S14 injected instruction, `exclusion:other:` titles) | list + pack | escaped by escapeHtml (tested) |

## 5. Existing tests that touch the HTML (all in test/web.test.ts; test/approval.test.ts asserts card TEXT only)

| Test | What it asserts about the HTML / responses |
| ---- | ------------------------------------------ |
| wrong token: bare 403 | `reply.text` is exactly `Forbidden`; audit details `{reason, method, path}` |
| missing cookie: 403 | status 403 for `/` and `/pack/1` |
| bad Host header | 403 with a valid cookie; 200 for `localhost:<port>` |
| token sets cookie | 303, `Location: /`, exact cookie format |
| strict security headers and no JavaScript | CSP contains `default-src 'none'` and `form-action 'self'`, NOT `script-src`, `unsafe-inline` or `http(s):`; nosniff; Referrer-Policy `same-origin`; no `<script`; exactly 11 matches of `>Approve<` on the list page |
| POST needs CSRF AND Origin | 403s + audit reasons; csrf scraped with `/name="csrf" value="([a-f0-9]+)"/` |
| GET never changes state | GET approve/skip -> 404 |
| full demo flow | 303 Location `/pack/<id>?done=approved`; page contains `Approved. The drafts were saved`; matches `Approved by Alex Morrow at 2026-10-18 18:00:00 UTC \(via web\)`; does NOT contain `/pack/<id>/approve`; second POST -> `?done=already_done` |
| skip over HTTP | Location `?done=skipped` |
| Open streams the DB file | exact Content-Disposition; bad paths 404 |
| escapes hostile document text | list and pack page: no `<script>`, contains `&lt;script&gt;alert(1)&lt;/script&gt;` |
| token never appears anywhere | file + audit scan |

Constraints these put on the redesign: keep the hidden field exactly `name="csrf" value="<hex>"` (attribute order),
the button text `Approve` directly inside the element (`>Approve<`) exactly once per waiting pack on the list, the
sentences "Approved. The drafts were saved" and "Approved by <name> at <yyyy-mm-dd hh:mm:ss> UTC (via <channel>)",
and no `/pack/<id>/approve` text once decided. The bare `Forbidden` body is asserted exactly.

## 6. Other observations
- Running in this worktree prints pdfjs "Unable to load font data" warnings: node_modules is resolved from the main
  checkout, so pdfjs looks for fonts at a path that does not exist here. Harmless for the fake-LLM run (environment
  artefact of the worktree, not a product bug).
- `serve` killed with a forced stop leaves `data/runtime/serve.lock`; the next serve takes it over (D-065).
- Audit times are ISO UTC; the CLI timeline prints raw JSON for some detail types (notification_sent, approved).

## 7. Prompt 7 additions: upload and analysis pages

New routes (existing routes, field names and handler contracts unchanged): `GET /analysis/new[?policy=<id>]`,
`POST /analysis` (multipart), `GET /analysis/<id>`, `POST /analysis/<id>/delete`; later (Stage U4)
`POST /exports`, `GET /exports/<id>`, `GET /exports/<id>/download`. Without `enableUploads()` (no serve wiring) every
/analysis path answers 404, so the Prompt 6 pages are byte-identical.

Every state below is designed (docs/DESIGN.md section 16), rendered through the real server by `npm run ui:states`
(saved to docs/ui-screens/states/, git-ignored) and covered by test/webUploads.test.ts. Status = HTTP status seen.

| State | File (ui:states) | Status |
| ----- | ---------------- | ------ |
| Empty upload page | upload-empty | 200 |
| Attach preselected from a notice (?policy=pol-s07) | upload-attach-preselected | 200 |
| Upload page with recent analyses | upload-with-recent | 200 |
| Validation error (invalid contact email), text kept | upload-validation-error | 400 |
| Consent not ticked | reject-consent-missing | 400 |
| Not a PDF | reject-not-a-pdf | 415 |
| Scanned / no text | reject-empty-or-scanned | 400 |
| Damaged PDF | reject-corrupted | 400 |
| Wrong number of files | reject-wrong-number-of-files | 400 |
| Two files for one side | reject-duplicate-side | 400 |
| Policy not found | reject-policy-not-found | 400 |
| Fake-mode refusal (unknown document) | reject-unknown-in-fake-mode | 400 |
| Busy (run or analysis in progress) | reject-busy | 429 |
| Daily limit reached | reject-daily-limit | 429 |
| Too large (declared or streamed) | (tests only) | 413 |
| Encrypted / too many pages | (tests: intake matrix) | 400 |
| AI not configured | upload-ai-not-configured | 200 |
| Job running (self-refresh every 2 s) | job-running | 200 |
| Job done, no flags (pol-s07 renewal) | job-done-no-flags | 200 |
| Job done with flags (Harbourview) | job-done-with-flags | 200 |
| Job done, hostile pair (everything escaped) | job-done-hostile | 200 |
| Job failed: identity unreadable | job-failed-identity | 200 |
| Job interrupted | job-interrupted | 200 |
| Job page of a refused upload | job-rejected | 200 |
| Uploaded files deleted | job-files-deleted | 200 |
| Pack page of an uploaded pack | pack-hostile | 200 |
| List page with upload entry points | list-with-uploads | 200 |
| Unknown job id | error-404-unknown-job | 404 |
| No session | error-403-no-session | 403 |
| Through the public HTTPS origin | error-uploads-local-only | 403 |

Select-String scan of all 28 saved files (2026-10-21): `<script` 0, `<style` 0, `\sstyle\s*=` 0, external
`https?://` 0, protocol-relative URLs 0; `\son[a-z]+\s*=` 1 hit, which is the hostile FILENAME shown as escaped text
(`&lt;img src=x onerror=alert(1)&gt;.pdf`), not an attribute (the tag-scoped test check passes on that page).
`http-equiv="refresh"` only in job-running. Every file has `<html lang="en">`.

Keyboard-only path (by design; Tab order follows the DOM): skip link -> sidebar links (incl. Analyse documents) ->
attach form (policy select, expiring file, renewal file, consent tick, Analyse button) -> new-policy form (client,
contact name, contact email, broker, expiring file, renewal file, consent, Analyse) -> recent analyses links. Native
controls only, so Space/Enter/arrow keys work as the browser provides. NOT verified by me with a real keyboard; the
focus ring styles are the Prompt 6 ones (2px --focus).

Stage U4 added three states (also rendered by `npm run ui:states`, 31 files in total; Select-String rescan on
2026-10-21: script 0, style tags 0, style attributes 0, external URLs 0, on-handlers inside a tag 0, lang missing 0,
meta refresh only in job-running):

| State | File (ui:states) | Status |
| ----- | ---------------- | ------ |
| Overview created (export page) | export-created | 200 |
| Overview: no cases match (no file) | export-no-cases | 200 |
| Unknown export id | error-404-unknown-export | 404 |
