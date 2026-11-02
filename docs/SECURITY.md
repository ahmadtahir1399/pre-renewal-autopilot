# Security notes (attack surface)

Concept project, synthetic data only. This note lists where untrusted text enters, where it can land,
the guard at each place, and what is **not** guarded or tested. Tests: `npm run test:security`
(test/security/ plus the web tests in test/web.test.ts) and `npm run test:failure`.

## Where untrusted text enters

| Source | Why untrusted | Examples |
| --- | --- | --- |
| Policy PDFs | Written by third parties; may contain instructions aimed at the AI | pol-s14 page 3: "Ignore all previous instructions..." |
| AI model output | The model can be wrong or be steered by the document | values, page numbers, quotes, exclusion titles and summaries |
| Data source records | Client names and insurer names are free text | a client name containing CR/LF or markup |
| HTTP requests to the approval page | Anything on this computer can send them | forged POSTs, wrong tokens, odd Host headers |
| Telegram button presses (optional channel) | Any Telegram user who finds the bot | presses from chats that are not allowed |

## Where it can land, and the guard

| Sink | Guard | Test |
| --- | --- | --- |
| The extraction prompt | Document text sits between fixed delimiters; delimiter strings, runs of `<<<`/`>>>` and fake `[PAGE n]` labels are removed before sending (D-038); the prompt says the text is data | `injection.test.ts` (delimiter break-out) |
| Decisions (status, flags, severity, risk) | Only plain-code compare rules decide; the model's text never does. Quotes and summaries are never read by `src/compare`; status changes use fixed literals | `injection.test.ts` (11 scenarios x 3 injected texts; whole pipeline) |
| Extracted values | Every quote is checked against its page in plain code; failures lower confidence, which becomes a "needs human check" flag, never a computed difference (D-040, D-B) | extraction tests; failure test "empty page" |
| xlsx cells | Every string is a text cell (format `@`), formula starters get a leading apostrophe (also after cleaning), control and bidi characters removed (D-053, D-130) | attack-surface matrix |
| .eml headers | Control characters become spaces, bidi removed, non-ASCII RFC 2047-encoded, length clamped to 200, addresses must match a strict pattern (D-055, D-130) | attack-surface matrix |
| .eml bodies | `text/plain` only, control and bidi characters removed, long words split so no line passes 998 characters (D-130) | attack-surface matrix |
| summary.txt | One-line fields cannot break a line; control and bidi characters removed (D-130) | attack-surface matrix |
| Web page HTML | Every dynamic string escaped (control and bidi removed first); strict CSP (`default-src 'none'`); no scripts | attack-surface matrix; web tests |
| Telegram text | Plain text (no `parse_mode`), one clean line per field, clamped to 4096 characters (D-130) | attack-surface matrix (via FakeNotifier) |
| Audit log | Details are small JSON (2000 chars, 300 per string), secret-shaped values and keys rejected (D-063) | attack-surface matrix; audit tests |
| Logs | Secret keys and value shapes redacted, strings truncated at 500, control and bidi characters shown as `\uXXXX` (D-011, D-130) | logger tests; attack-surface matrix |
| Output paths | Folder names are slugs (`a-z`, `0-9`, `-`, max 60), resolved and checked inside OUTPUT_DIR | attack-surface matrix; outputs tests |
| Approval page access | Binds to 127.0.0.1 only; Host check; random token; HttpOnly SameSite=Strict cookie; CSRF token plus Origin check on every POST; GET never changes state (D-078, D-087) | web tests (real HTTP) |
| Approvals | One shared core validates every action; unknown chats, unknown packs, repeated or out-of-state decisions are refused and audited | `unauthorised.test.ts`; approval tests |
| Data source | Read-only except `updateRenewalStatus(..., 'approved')`, called only from the approval core; fixtures never written | `readOnly.test.ts` |
| Email sending | None exists. No mail library is installed (hand-built `.eml`, D-054); a scan finds no sending API in our code or in production dependencies | `noSend.test.ts` |
| Secrets | Only in `.env` (gitignored); never logged, stored or shown | `secrets.test.ts` (sentinel values scanned everywhere) |

## Not guarded, or not tested

- **The model can still be fooled into a wrong value.** Quote checking catches values that are not on
  the stated page, but a wrong value whose quote IS on the page (for example a sub-limit read as the
  cover limit) passes the check. The evaluation report counts how often this happened on the synthetic set.
- **Exclusions carry no confidence.** If the model misses the whole exclusions list, the removals show
  only as "info". Exclusion recall is measured in the evaluation report.
- **The live injection check covers one document pair (pol-s14) and a few phrasings.** It does not
  prove resistance to every injection.
- **The approval page is plain HTTP on 127.0.0.1.** Anything running on the same computer under any user
  can reach the port; it still needs the token. There is no TLS and no user accounts.
- **Telegram** was never exercised against the real Bot API from here.
- **Mail apps** were not tested with hostile `.eml` files (only the files themselves were checked).
- **Unicode look-alike characters** (homoglyphs) are not normalised; only control and bidi characters are removed.
- **Denial of service** (huge PDFs, many requests) is not tested.
- **Dependencies**: `npm audit` is run and reviewed by hand; no automated supply-chain checks.
