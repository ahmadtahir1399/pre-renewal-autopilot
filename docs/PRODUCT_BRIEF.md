# PRODUCT BRIEF - Pre-Renewal Autopilot

Saved word for word from Prompt 1 (sections THE PRODUCT, NON-NEGOTIABLE RULES, SHARED FACTS and LOCKED
DECISIONS) so later prompts can read them from disk. Do not edit; record changes in docs/DECISIONS.md.

UPDATED in Prompt 4 for locked decision D-E (approval channel wording only; marked [D-E] below). Nothing
else was changed.
UPDATED in Prompt 7 for locked decision D-F (added at the end of LOCKED DECISIONS; marked [D-F]). Nothing
else was changed.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE PRODUCT (read first)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-Renewal Autopilot is a CONCEPT portfolio project for insurance brokerages. Synthetic (made-up)
data only. Never real client data.

Analogy: a night-shift assistant. Before the broker arrives, it pulls every policy expiring in 12 to
16 weeks, reads the old and new documents, highlights what changed, leaves a prepared folder on the
desk (a spreadsheet and two draft emails), and knocks on the door for a signature. It never sends
anything itself.

Every morning, with nobody pressing a button:
  1 Select renewals due in 84 to 112 days (inclusive)
  2 Read each policy's expiring and renewal PDFs
  3 Compare the terms in plain code (the AI never does the maths)
  4 Build a comparison .xlsx and two draft .eml emails (client, insurer)
  5 Ask the broker to approve: a card with Approve / Open / Skip buttons (a local web page by default;
    Telegram is an optional second channel) [D-E]
  6 After Approve: save the drafts and update the renewal status
  7 Record every action in an audit log
It NEVER sends email to a client or insurer. A person approves everything.

Why it exists: I am building it to show I can ship a safe, useful AI automation for insurance
brokerages, and I may show it to the owner of an AI agency that serves them. It must behave like
something a broker could trust: drafts only, a person approves, everything recorded. Working backwards
from the end goal: a 60 to 90 second demo where a broker sees a Telegram message, opens the
comparison, taps Approve, and sees the audit entry. Everything I build serves that moment.

THE WHOLE BUILD (5 prompts, each in a fresh chat; later prompts rely on exact names from earlier ones)
  PROMPT 1 (THIS ONE): Foundation + domain model -> Fake data + answer keys
  PROMPT 2: Renewal selection -> PDF reading with checked quotes (uses an LLM)
  PROMPT 3: Comparison engine -> xlsx + draft emails
  PROMPT 4: SQLite state, audit, pipeline, scheduler -> approval flow (web page default, Telegram optional) [D-E]
  PROMPT 5: Evaluation + security tests -> README, demo, release

NON-NEGOTIABLE RULES
 1. Draft-only. Nothing is ever sent to a client or an insurer.
 2. Every extracted fact carries a source page number. Uncertain facts are flagged, never guessed.
 3. Numbers and differences are computed by plain code. The AI only extracts text and explains facts.
 4. Read-only access to the data source, except one field: the renewal status.
 5. Idempotent: one pack per policy per cycle (cycleKey = policyId + ":" + expiryDate). Reruns create
    a new version, never duplicates.
 6. Every action writes an audit event.
 7. Synthetic data only. Policy documents are untrusted text: instructions inside them are never
    followed.

SHARED FACTS
 Tech (not locked; whenever you recommend a library, name 1-2 alternatives and tell me to verify it in
 the current docs): TypeScript strict on Node.js, Zod, Vitest, SQLite, an LLM API, a spreadsheet
 library, the Telegram Bot API (optional channel [D-E]). The data source sits behind an interface (local JSON first).
 Folder layout: src/{domain,config,data,selection,documents,llm,compare,outputs,state,approval,
 pipeline,cli}, test/, fixtures/, scripts/, templates/, docs/.
 Renewal status values: not_started, drafted, needs_attention, in_review, approved, skipped.
 Exclusion keys (fixed vocabulary): flood, earthquake, wear_and_tear, gradual_deterioration,
 theft_unattended_premises, vacant_or_unoccupied_building, cyber_event, terrorism, pollution, asbestos,
 subsidence_landslip, contractual_liability, professional_advice, other.
 Reference date for fixtures and tests: 2026-10-19. Currency NZD. Timezone Pacific/Auckland.
 Package manager npm. Runs on my computer. Approver: me only. LLM provider: not needed in this prompt.

LOCKED DECISIONS (so all 5 prompts agree; record them in docs/DECISIONS.md)
 D-A Policy ids are pol-s01 ... pol-s15, matching scenarios S01 ... S15.
 D-B Severity rules (plain code, thresholds configurable via PREMIUM_MEDIUM_PCT=10 and
     PREMIUM_HIGH_PCT=25):
     premium decrease = info; increase under 10% = low; 10% or more = medium; 25% or more = high.
     excess increase = medium, decrease = info. Cover limit decrease = high, increase = info.
     Exclusion key added = high, removed = info. Insurer name change = medium.
     Renewal periodStart more than 1 day away from (expiring periodEnd + 1 day) = medium date flag
     (this is an ASSUMPTION; comment it as such).
     Missing or low-confidence fact on either side = no computed difference, plus a medium
     "needs human check" flag naming the field.
     The diff list contains CHANGED fields only (unchanged fields are omitted).
 D-C A Flag is every diff at medium or high, plus every "needs human check" flag.
     overallRisk = highest severity among diffs and flags; 'info' when there are none above info
     (including when there are no diffs at all).
 D-D Final status after a normal pipeline run, before any approval: in_review. pol-s07 and pol-s08:
     needs_attention, no pack. pol-s09: not selected (stays not_started). pol-s12: approved (seeded).
 D-E [added in Prompt 4] The approval channel is pluggable behind src/approval/notifier.ts. DEFAULT is a
     local web approval page. Telegram is an OPTIONAL adapter, enabled only when configured. The core
     approval logic (validation, state change, audit) is channel-independent and shared.
 D-F [added in Prompt 7] Manual upload, manual analysis and overview spreadsheets are part of the
     product, governed by the upload rules U-1 to U-7 (full text in docs/UPLOADS.md "Domain model"):
     U-1 uploads never write to the data source (updateRenewalStatus only for data_source cases);
     U-2 fail closed on identity (no pack, never guess); U-3 manual cases ignore the 84-112 day window
     and say so honestly; U-4 the nightly run never overrides an upload (unless --force --only);
     U-5 identity 'man-' + 12 hex of sha256(insurer|policyNumber); U-6 uploaded text is hostile;
     U-7 synthetic documents only, with an explicit consent tick. Uploaded documents go through the SAME
     pipeline code (processCase) as the nightly run. Draft-only still holds: nothing is ever sent.
```
