# Limits

Pre-Renewal Autopilot is a **concept project**. It uses synthetic (made-up) data only and prepares drafts
only. This page lists what it cannot do and what real use would need. It is not legal or insurance advice.

## What it cannot do (today)

- **Scanned PDFs.** There is no OCR. A PDF without a text layer is stopped as "needs attention"
  (pol-s08), never guessed.
- **Other policy types.** Only commercial property, public liability and business interruption are modelled.
- **Other languages.** Documents, prompts and drafts are English only.
- **Other document layouts.** All 30 test documents come from the same templates (a schedule page, cover,
  conditions, exclusions). Real insurers use many layouts, longer documents, tables, endorsements and
  schedules spread over several pages. None of that is tested.
- **The evaluation is synthetic only.** The fixtures were written by the project author from templates.
  The evaluation numbers measure that set, not real documents. 28 documents is a small sample.
- **Tested on Windows only.** Paths are built portably, but macOS and Linux were never run.
- **One brokerage.** No multi-tenancy, no user accounts, one approver.
- **The approval page works only on this computer** (it binds to 127.0.0.1). It is not reachable from a
  phone or another machine, by design.
- **Telegram is optional and unverified.** It needs this computer to reach the Telegram Bot API; that may
  be blocked in some countries or networks. The adapter was never run against the real API here.
- **No email is ever sent, by design.** The `.eml` files are drafts. Opening them as unsent drafts relies
  on the `X-Unsent: 1` header, which some mail apps ignore (not verified in any mail app).
- **Policy type changes are not compared** (there is no rule for them), and the policy number is not compared.
- **Exclusions have no confidence level.** A missed exclusions list looks like "removed" (info severity).
- **The model's own "medium" confidence raises no flag.** Only "low" (set by the model, or by the plain-code
  quote check when a quote or value is not on the stated page) creates a "needs human check" flag. In the
  live evaluation the model's confidence labels changed between repeats while its values did not, so the
  label is not a reliable signal on its own (see the evaluation report).
- **No insurance advice.** The drafts state facts from the documents; the broker decides what they mean.
  A short banned-phrase list blocks obvious advice wording in client drafts; it is not a guarantee.
- **`npm run build` does not copy the SQL migration files** into `dist/`. The project runs through `tsx`
  (the npm scripts), not from `dist/`.
- **Library notes.** `exceljs` was last published on 2024-12-20 and its `uuid` dependency is forced to a
  newer version with an npm override. `node:sqlite` is Node's built-in module; check its stability level
  for your Node version.
- **Dependency check for sending code.** No mail library is installed, so no sending transport is
  bundled. The check is a text scan (test/security/noSend.test.ts), not a proof.

## What real use would need

- A **privacy and security review** by qualified people, including how client documents are stored,
  how long they are kept, and who can see them.
- **Client consent** and a clear policy for sending client documents to an AI provider.
- **Hosting and data-residency choices**: where the documents, the database and the AI processing live.
- **A human review process**: who checks each pack, what "approved" means, and how mistakes are reported
  and fixed.
- **Real documents in the evaluation**, with permission, covering many insurers and layouts, and a much
  larger sample than 28 documents.
- **Accounts and access control** for more than one broker, and an approval channel that works away from
  the desk without exposing the page to the internet.

**Before making any claim about legal compliance, check New Zealand privacy obligations with a qualified
adviser.** This project does not state what the law requires.
