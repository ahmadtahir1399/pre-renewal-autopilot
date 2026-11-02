# Manual test: upload, analysis and the overview spreadsheet (Prompt 7)

All commands are for **PowerShell** in the project folder (the one that holds package.json).
Nothing in this test sends any email. `.env` must contain `REFERENCE_DATE=2026-10-19`.
Every sample file is invented (samples\uploads). Fake mode costs nothing and needs no AI key.

## A. Set up (fake mode)

1. `npm run reset-demo` - you should see `Migrations applied: 001_initial, 002_uploads, 003_upload_reading` and `Seeded approved cycles: 1.`
2. `npm run run -- --fake-llm` - `Totals: new_pack=11  needs_attention=2  skipped_outside_window=1  skipped_already_processed=1`.
3. `npm run serve -- --fake-llm` - copy the printed `http://127.0.0.1:8787/?t=...` link into your browser.
   Keep this window open; use a second PowerShell window for the commands below.

## B. The upload page

4. **List page.** Top right: an **Analyse documents** button; the sidebar has an **Analyse documents** link. Under
   "Needs attention": Bluegum Freight Services Ltd (pol-s07) with **Upload the missing document**, and pol-s08's
   client with **Upload a readable copy** (its expiring PDF is a scan). At the bottom: **Overview spreadsheet**.
5. **Click "Upload the missing document" on pol-s07.** The upload page opens with the policy already chosen:
   "Renewal document missing: Bluegum Freight Services Ltd - Commercial Property (renews 2027-01-22)".
   You should also see: the yellow demo bar ending "Fake mode: only known sample documents can be analysed.",
   "PDF only, up to 10 MB and 30 pages each.", "Analyses today 0 of 10", "What happens next" (4 ticks), two cards
   ("Add a missing document to an existing policy", "Analyse a new policy") and an empty "Recent analyses".
   Both consent boxes read exactly: "These documents are made-up. Their contents are sent to the AI provider."

## C. Attach the missing renewal to pol-s07, then Approve

6. In the left card choose `samples\uploads\pol-s07-renewal.pdf` for **Renewal offer (PDF)**, tick the consent box,
   click **Analyse the document**. You land on "Analysis 1". It may show "Working on it" and refresh itself every
   2 seconds; in fake mode it is usually done at once: all five steps say **Done**, a green banner "The pack is
   ready", a strip with Overall risk **Info**, Changes 0.
7. **Extracted facts**: eight rows plus Key exclusions, two columns. The Expiring column header says "From the policy
   records", the Renewal column says "Uploaded". Each fact shows its value, a **Page 1** tag, a **High** confidence
   badge (word + tick shape + colour) and the quoted schedule line, e.g. "Policy number: TFU-CP-...".
   **Documents**: "Renewal offer pol-s07-renewal.pdf, 4 pages" and "Expiring policy - From the policy records".
   **Reading check** (right side): "16/16 facts confirmed word for word on the page they came from", "5 exclusions
   listed" (Harbourview: 5; pol-s07: its own count) and "Fake mode: the answer keys stood in for the AI; the same checks
   ran." **Activity**: documents received, analysis started (fake mode), status
   changes, analysis finished.
8. Click **Open the pack** -> the pack page shows "Source: Uploaded manually (analysis 1)". Click **Approve**.
   Then in PowerShell: `npm run status` shows pol-s07 `approved`;
   `Get-Content data\runtime\status-overlay.json` shows `"pol-s07": "approved"`;
   `Get-ChildItem output\approved\2026-10-19\bluegum-freight-services-ltd\pol-s07\v1` lists three files
   (comparison.xlsx, client-email.eml, insurer-email.eml).
9. `npm run audit -- pol-s07` reads as a story: nightly "renewal MISSING" -> needs attention -> upload received ->
   analysis started -> documents checked -> terms read x2 -> comparison -> pack written -> status needs_attention
   -> drafted -> in_review -> manual override set -> analysis finished -> card shown -> status approved -> approved.

## D. A new policy (Harbourview Bakery Ltd)

10. Back on **Analyse documents**, right card: Client name `Harbourview Bakery Ltd`, Contact name `Jo Baker`,
    Contact email `jo.baker@example.com`, Broker `Alex Morrow`, Expiring `samples\uploads\harbourview-expiring.pdf`,
    Renewal `samples\uploads\harbourview-renewal.pdf`, tick consent, **Analyse both documents**.
    Expected: done; Overall risk **High**; Changes 3; Needs your eye 2. On the list page a card
    "Harbourview Bakery Ltd" with an **Uploaded** chip, "Renews 3 December 2026 in 6 weeks" (outside the usual
    12-16 weeks, said honestly). Its pack shows cover limit 2,000,000 -> 1,000,000 (High), asbestos exclusion added
    (High), premium 3,200 -> 3,400 (Low). **Approve** it: `npm run status` shows it approved and
    `data\runtime\status-overlay.json` does NOT gain a new line (manual cases never touch the data source).

## E. Refusals (each is clear, kind and keeps your typed text, never your files)

11. **Hostile pair**: new policy, client name `<b>Test</b> & "Co"`, files `hostile-expiring.pdf` +
    `hostile-renewal.pdf`. It is analysed; every name and text shows literally (you see `<b>Test</b>`, nothing turns
    bold, no popup). In Extracted facts, Key exclusions on the renewal shows "Other exclusion" with the quoted title
    `=HYPERLINK("#ref","Open schedule") ...`. The instruction sentence inside the PDF changed nothing: risk **High**
    (premium +30%) and the flags come only from the comparison rules.
12. **Scanned**: new policy with `scanned-expiring.pdf` as expiring + `harbourview-renewal.pdf` -> "Not accepted" -
    "The expiring policy: That PDF has no readable text. It may be a scan or a picture; scanned documents are not
    supported (no OCR)." Your client name is still filled in; the file fields are empty.
13. **Not a PDF**: attach `not-a-pdf.pdf` to pol-s01 as the renewal -> "The renewal offer: That file is not a PDF."
14. **Unknown document in fake mode**: attach any other PDF of yours to pol-s01 as the renewal -> "...not one of the known sample documents.
    In fake mode only the sample PDFs can be analysed; real analysis needs the live AI model."
15. **Oversize** (make a file yourself):
    `$b = New-Object byte[] (11MB); [IO.File]::WriteAllBytes("$env:TEMP\big.pdf", $b)` then upload `big.pdf`.
    Expected: "That file is too large." (HTTP 413). HONEST NOTE: the server stops reading early; some browsers then
    show a connection error instead of the page. Either way nothing is stored (`npm run uploads:list`).
16. **Consent unticked**: the browser itself stops the form ("Please tick this box" - the box is `required`). The
    server's own refusal ("Please confirm that the documents are made-up...") is covered by automated tests.
17. **Wrong token**: in a private window open `http://127.0.0.1:8787/analysis/new` -> "Sign-in link needed" (403).
    `npm run audit -- --attempts` lists the refused request (reason only, never a token).
18. **Double submit**: submit the Harbourview pair again -> a new analysis that says "These are the same documents as
    before, so nothing changed. The existing pack is still the current one." (same pack, no duplicate). Clicking
    Analyse twice very fast may instead give "Another analysis or the nightly run is in progress." for the second.

## F. Delete the files

19. On any finished analysis click **Delete the uploaded PDFs**. The page then says "The uploaded PDFs were deleted
    ... The pack, the drafts and the audit trail are kept." `npm run uploads:list` still lists the job;
    `Get-ChildItem data\runtime\uploads` no longer has that job's folder. `npm run uploads:purge -- --dry-run`
    lists what would go after 7 days (nothing yet).

## G. The overview spreadsheet

20. List page, bottom: **Overview spreadsheet**, keep "In review" and "Approved" ticked and "Include uploaded (manual)
    cases" ticked, click **Create overview spreadsheet** -> "The overview spreadsheet is ready" with the number of
    renewals listed. Click **Download overview.xlsx** and open it in Excel or LibreOffice.
    Expected: NO repair prompt; three sheets Overview, Flags, Notes; the header row stays when you scroll; risk words
    (High/Medium/Low/Info) are coloured AND written; Harbourview shows "in 6 weeks" and "Uploaded manually"; pol-s12
    shows "(no pack)"; Notes says "Drafts only. Nothing has been sent." and "Synthetic data only"; print preview is
    landscape, one page wide.
21. Click Create again with the same ticks -> "Nothing had changed since the last overview with these filters, so the
    same spreadsheet is offered again." Untick everything except "Skipped" -> "No cases match" and no file.
22. Same from the command line: `npm run overview` prints the file path (or "Unchanged, same content as export N").

## H. Optional live run (only after you type "include live run" and then "go")

Needs LLM_PROVIDER / LLM_API_KEY / LLM_MODEL in .env. Stop serve, start `npm run serve` (no --fake-llm), upload the
Harbourview pair. Expected cost: 2 model calls when both readings are confirmed at once; a document whose facts cannot all be confirmed gets ONE targeted second reading (D-120); with validation retries the worst case is 5 calls per document, 10 for the pair. Compare the
Extracted facts with `samples\uploads\harbourview-*.truth.json`. Without the LLM settings the upload page shows
"AI reading is not configured" and no forms.

Things I could not check for you: how it looks to you (taste), keyboard-only use, screen readers, and Firefox/Safari.
