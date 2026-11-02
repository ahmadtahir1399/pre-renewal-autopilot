# Case study: Pre-Renewal Autopilot

A concept automation for insurance brokers, built as a portfolio project. All data is synthetic.

## Problem

Before a commercial policy renews, a broker compares the expiring policy with the renewal offer: premium,
excess, cover limit, dates and exclusions. Then they fill a comparison sheet and write to the client and the
insurer. The work is repetitive, and the costly mistakes are quiet ones: a new exclusion on the last page,
or a halved cover limit.

## Approach

Every morning the tool selects policies expiring in 84 to 112 days, reads both PDFs, compares the terms and
leaves a pack: a spreadsheet, a client draft and an insurer draft. A card on a local web page asks the broker
to Approve, Open or Skip. After approval it saves the drafts and updates the renewal status. Every step goes
into an audit log.

## Key decisions

- **Draft-only.** There is no sending code and no mail library. Drafts are hand-built `.eml` files that the
  broker opens and sends, or not.
- **Deterministic maths.** The AI model only turns page text into structured facts. Plain code computes
  every difference and grades it with fixed, configurable rules, so the same documents always give the
  same result, and the rules can be tested.
- **Verified quotes.** Every fact carries a page number and a short quote. Code checks that the quote and the
  value are on that page. When the check fails, the fact becomes "needs human check" instead of a guess.
- **Human approval.** Nothing counts until a person approves. One shared approval core serves the web page,
  the command line and an optional Telegram channel, so the rules cannot differ by channel.

## Safety

Documents are treated as untrusted data. One test policy contains "Ignore all previous instructions...",
and the evaluation checks that it is handled like any other policy. The data source is read-only except for
one status field. The approval page binds to this computer only and checks a token, CSRF and Origin.
Failure tests cover bad AI output, timeouts, damaged PDFs, a locked database and an unwritable folder. In
each case the affected policy ends in a safe state and the rest finish. A matrix test pushes hostile text
(formulas, script tags, header injection, control characters, very long text) through every output. It
found real gaps, which were fixed before release.

## Results

Measured with a real model on the synthetic set (15 scenarios, 28 readable documents, three repeats). All
data is synthetic, and I wrote the fixtures and answer keys from templates myself, so these numbers measure
this set only, not real policies. Generated from the [evaluation report](../reports/eval-2026-10-20-live.md):

<!-- results-short:start -->
- Field values exact: 672 of 672 (100.00%); source pages correct: 672 of 672 (100.00%) (28 documents x 3 repeats).
- Wrong value still at high confidence: 0 of 672.
- Exclusion keys found: 312 of 312 (100.00%); differences found end to end: 30 of 30 (100.00%), of which real: 30 of 30 (100.00%).
- Final status correct: 45 of 45 (100.00%).
- Cost: 0.0696 USD for 84 model calls.
<!-- results-short:end -->

The model's own confidence labels changed between repeats while its values did not. So the plain-code quote
check, not the model's confidence, is what triggers a human check.

## Limits

There is no OCR for scanned PDFs. It covers three policy types, English only and one document template
family. It serves one brokerage, the approval page works only on this computer, and Telegram has not been
tested against the real service. A perfect score on clean synthetic documents says little about messy real
ones. Real use would need a privacy and security review, client consent, hosting and data-residency choices,
and a written human-review process.

## What I would do next

Evaluate on real, permitted documents from several insurers. Add OCR with its own accuracy check. Give
exclusions a confidence level. Treat the model's "medium" confidence as a review signal. Add accounts and an
approval channel that works away from the desk without exposing the page to the internet.
