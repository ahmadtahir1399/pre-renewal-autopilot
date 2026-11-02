# Manual test: approval flow (web page default, Telegram optional)

All commands are for **PowerShell** in the project folder (the folder that contains `package.json`).
Nothing in this test sends any email. `.env` must contain `REFERENCE_DATE=2026-10-19`.

Pack ids are given by the run (packs are built two at a time, so ids are not in policy order).
Always read the pack id from `npm run status` (column **Pack**, e.g. `#7 v1` means pack id 7).

## A. Web page (default)

1. **Reset the demo.**
   `npm run reset-demo`
   You should see `Seeded approved cycles: 1.`

2. **Run the pipeline on the demo set.**
   `npm run run -- --fake-llm`
   You should see the FAKE LLM banner and `Totals: new_pack=11  needs_attention=2  skipped_outside_window=1  skipped_already_processed=1`.

3. **Find the pack ids.**
   `npm run status`
   11 rows `in_review` with a pack, `pol-s07` and `pol-s08` `needs_attention`, `pol-s12` `approved`.
   Note the pack id for `pol-s02` (call it P2) and `pol-s05` (call it P5).

4. **Start the approval page.**
   `npm run serve`
   It prints `Approval page (this computer only): http://127.0.0.1:8787/?t=...`.
   Copy that whole link into your browser (Chrome, Edge or Firefox on THIS computer).
   The address bar changes to `http://127.0.0.1:8787/` (the token is now a cookie).
   Leave this terminal open. Use a SECOND PowerShell window for the checks below.

5. **Look at the cards.** You should see 11 cards under "Renewals waiting for your decision",
   each with: client and policy type, "Renews in N weeks (date)", "Overall risk: ...", up to three
   changes tagged [HIGH]/[MEDIUM]/[LOW]/[INFO], "N items need your eye" (or "Nothing needs your eye"),
   and Approve / Skip buttons. Below: "Needs attention" for pol-s07 and pol-s08 (no buttons).

6. **Open a comparison.** On the pol-s15 card click **Open spreadsheet**.
   The browser downloads `comparison-pol-s15-v1.xlsx`. Open it: four sheets (Summary, Comparison,
   Flags, Sources). Nothing changed in the database:
   `npm run status` still shows pol-s15 `in_review`.

7. **Approve one (pol-s02).** Before clicking, check:
   `Test-Path output\approved` -> `False`
   `Get-Content data\runtime\status-overlay.json` -> file not found.
   Click **Details** on the Ironbark Joinery Ltd - Public Liability card, then **Approve**.
   You should see: "Approved. The drafts were saved under output/approved and the renewal status was
   updated. Nothing was sent." and "Approved by broker at ... UTC (via web)" with no buttons.
   Then check (second window):
   - `npm run status` -> pol-s02 `approved`, Sync `ok`
   - `Get-ChildItem -Recurse output\approved` -> `comparison.xlsx`, `client-email.eml`, `insurer-email.eml`
     under `output\approved\2026-10-19\ironbark-joinery-ltd\pol-s02\v1\`
   - `Get-Content data\runtime\status-overlay.json` -> `"pol-s02": "approved"`
   - `npm run approve -- P2` (replace P2) -> `already_done: Already approved. Nothing changed.`

8. **Try approving it again in the browser.** Use the browser Back button to the pack page with the
   Approve button (if still shown) and click it, or reload `/`: the card is now under "Recently decided".
   A second Approve shows "This was already decided. Nothing changed." `npm run audit -- pol-s02`
   shows exactly ONE `approved` event (and an `approval_ignored` for the repeat).

9. **Skip one (pol-s05).** Open its Details and click **Skip**: "Skipped. Nothing was saved and the
   data source was not changed." `npm run status` -> pol-s05 `skipped`. The overlay file still only
   lists pol-s02. No `output\approved\...\pol-s05` folder exists.

10. **Try a bad token.** In a private/incognito window open `http://127.0.0.1:8787/?t=wrong`.
    You should see a bare page with the single word `Forbidden` (HTTP 403).
    Check it with `npm run audit -- --attempts`: a row `unauthorised_attempt` with
    `{"reason":"bad token","method":"GET","path":"/"}` (the token itself is never stored).

11. **Read the story.** `npm run audit -- pol-s02` reads top to bottom: documents_checked,
    terms_extracted x2, comparison_done (overall risk high), pack_written, status_changed
    not_started -> drafted, drafted -> in_review, notification_sent, opened (if you opened it),
    status_changed in_review -> approved, approved.

12. **Stop the server.** In the serve window press **Ctrl+C**. You should see "Shutting down..." and
    "Stopped cleanly.".

13. **No channel at all (fallback).** The CLI always works:
    `npm run approve -- <packId>` / `npm run skip -- <packId>`. If a channel fails to send, see
    `output\outbox\pending-approvals.md` for every waiting pack with the exact commands.

## B. Telegram (optional)

Telegram needs THIS computer (the one running the automation) to reach `api.telegram.org`, not just your
phone. It may be blocked on your network or in your country; the web page does not need it.

1. In Telegram, open **@BotFather**, send `/newbot`, follow the steps, and copy the token it gives you.
2. Send any message to your new bot, then find your numeric chat id (for example with a
   "user info" bot, or as described in the official Bot API docs). VERIFY the method in the current docs.
3. Edit `.env` YOURSELF (never paste the token into a chat):
   `APPROVAL_CHANNELS=both`, `TELEGRAM_BOT_TOKEN=<token>`, `TELEGRAM_ALLOWED_CHAT_IDS=<your chat id>`.
4. `npm run check:approval`
   - `telegram: PASS - token authenticates as @YourBot; 1 allowed chat id(s)` = ready.
   - `could not reach api.telegram.org (network error or timeout)` = this computer cannot reach Telegram
     (blocked network/country, proxy, firewall). Nothing is wrong with the project; use the web page.
   - `rejected the bot token (401 Unauthorized)` = the token in `.env` is wrong.
5. `npm run reset-demo`, then `npm run serve` (keep it open), then in a second window
   `npm run run -- --fake-llm`. Your phone receives 11 cards and 2 notices.
6. Tap **Open** on one card: you receive the xlsx as a document. Tap **Approve**: the message is edited
   to show APPROVED and the buttons disappear. Tap **Skip** on another: SKIPPED.
7. From a different Telegram account (not in the allowed list) tapping a button does nothing except
   "Not allowed." and an `unauthorised_attempt` audit row.
