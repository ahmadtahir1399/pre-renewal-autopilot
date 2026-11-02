# Demo script (60-90 seconds)

Concept project, made-up data, drafts only. Rehearse once with a stopwatch and write your real timing at
the bottom before recording.

## Before recording

1. Optional, for real AI extraction on camera: `npm run demo:warm` shows how many demo documents are not yet
   cached. Only after you confirm that call count: run it again with `RUN_LIVE_LLM=1` and `-- --confirm`.
2. Run `npm run demo:reset`. It prints **which extraction source it used**: (a) cached live extraction, or
   (b) FAKE LLM with a loud banner. If it says (b), you must say so in the video (shot 1).
3. It ends by starting the approval page. Open `http://127.0.0.1:8787/?t=demo-token` in a browser on this
   computer. `demo-token` is a throwaway token for the demo only; no real secret is ever on screen.
4. Keep a terminal and the browser side by side. Close anything showing real names, mail or files.
5. Have `reports/eval-2026-10-20-live.md` (or the README "Evaluation" section) open in a tab.

## Shot list (total 85 seconds)

| Time | Seconds | On screen | Click / command | Say (plain words) |
| --- | --- | --- | --- | --- |
| 0:00-0:10 | 10 | Title slide or README top: "Concept project, made-up data, drafts only" | - | "Before a commercial policy renews, a broker compares the old policy with the new offer line by line. This concept does that overnight. Everything here is made-up data, and it only prepares drafts." (If fake mode: "Today the AI step is replaced by answer keys, so you are seeing the plumbing.") |
| 0:10-0:20 | 10 | Approval page: three cards and one "needs attention" notice | Scroll the page once | "Each morning it leaves one card per renewal due in 12 to 16 weeks: what changed, the risk, and how many items need my eye. Nothing has been sent." |
| 0:20-0:35 | 15 | The third card, "[HIGH] New exclusion in the renewal: Flood (renewal page 4)" (pol-s03): its Details page, then the spreadsheet | On that card click **Details**, then **Open the comparison spreadsheet** (Comparison sheet, "Source pages" column) | "Here the renewal adds a flood exclusion. It is marked HIGH, and the source page is shown, so I can check the exact page of the offer in one click. The maths and the comparison are plain code, not the AI." |
| 0:35-0:50 | 15 | The pack page after Approve: "Approved. The drafts were saved under output/approved and the renewal status was updated. Nothing was sent." and "Approved by broker ... (via web)" | Click **Approve** on the flood card; in the terminal `npm run status` | "When I approve, it saves the spreadsheet and both draft emails and marks the renewal approved. It still does not email anyone: I send the drafts myself." |
| 0:50-1:02 | 12 | Terminal | `npm run audit -- pol-s03` | "Every step is in the audit log: what was read, what was compared, which pack was written, and that I approved it, with the time." |
| 1:02-1:12 | 10 | The pol-s07 "needs attention" notice | Point at it | "This policy has no renewal document. Instead of guessing, it stops: no pack, nothing sent, just a notice to check it by hand." |
| 1:12-1:25 | 13 | The evaluation summary (README "Evaluation" or the report) | Scroll to the headline | Read the first two generated lines, then: "That is on synthetic documents I wrote myself from templates, so it shows the system works end to end, not how it handles real policies." |

Total: 10 + 10 + 15 + 15 + 12 + 10 + 13 = 85 seconds.

## Rules for the recording

- If the demo used fake mode, say it in shot 1 and leave the banner visible for a moment.
- No real data on screen: only the synthetic fixtures. Check the browser tabs, terminal history and taskbar.
- The token on screen is `demo-token`, a throwaway value set only for the demo process.
- Rehearse once, time it, and keep it under 90 seconds.
- Optional 5-second Telegram clip ONLY if `npm run check:approval` passed on your machine with Telegram
  configured. Otherwise leave Telegram out entirely.

## What you should see

- `npm run demo:reset`: "Extraction source: ...", four runs (pol-s01 low, pol-s02 high, pol-s03 high, pol-s07
  needs_attention "renewal document missing"), a status table, then "Approval page (this computer only): ...".
- The page: three waiting cards, titled by client and policy type (the policy id is not on the card; two say
  "Ironbark Joinery Ltd - Commercial Property", so pick by the change: +6.0 percent premium is pol-s01, the
  halved cover limit is pol-s02, the flood exclusion is pol-s03), and a "Needs attention" section for pol-s07.
- After Approve (checked in a real browser in Prompt 5): the pack page says "Approved. The drafts were saved
  under output/approved and the renewal status was updated. Nothing was sent." and "Approved by broker ...
  (via web)"; `npm run status` shows pol-s03 approved.

My rehearsal timing: ____ seconds (fill in before recording).
