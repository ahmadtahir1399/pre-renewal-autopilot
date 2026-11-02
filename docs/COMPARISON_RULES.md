# Comparison rules (rules version r1)

How Pre-Renewal Autopilot decides what changed between the **expiring policy** and the **renewal offer**,
and how serious each change is. Everything here is plain code in `src/compare/compareTerms.ts`
(`COMPARE_RULES`); the AI never does any of this maths or grading. If this page and the code ever
disagree, the code is wrong or this page is out of date: fix one and bump `COMPARE_RULES_VERSION`.

## Severity levels
`info` (worth knowing) < `low` < `medium` (needs a look) < `high` (act before renewal).

## Settings you can change
| Setting | Default | Meaning |
| ------- | ------- | ------- |
| PREMIUM_MEDIUM_PCT | 10 | A premium increase of at least this percent is **medium** |
| PREMIUM_HIGH_PCT | 25 | A premium increase of at least this percent is **high** |

Both must be whole numbers. "At least" is exact: an increase of exactly 10.0% is medium, 9.99% is low.

## The rules
| What | How it is compared | How it is graded |
| ---- | ------------------ | ---------------- |
| Insurer | Names compared ignoring capital letters and extra spaces | Any change of insurer = **medium** |
| Period of insurance | The renewal should start the day after the current policy ends. Gap = days from (current end + 1 day) to renewal start | More than 1 day early or late = **medium**. **This is an assumption** (decision D-B), not an industry rule |
| Annual premium | Percent change = (renewal - expiring) / expiring x 100, using the figures printed in the two documents, calculated exactly | Decrease = **info**; increase below 10% = **low**; 10% or more = **medium**; 25% or more = **high** (thresholds above). If the current premium is 0, no percentage is possible: **needs human check (medium)** |
| Excess | Amounts compared exactly | Increase = **medium**; decrease = **info** |
| Cover limit (sum insured / limit of indemnity) | Amounts compared exactly | Decrease = **high**; increase = **info** |
| Exclusions | Each exclusion is mapped to one key from a fixed list (flood, earthquake, wear and tear, ...). The two lists of keys are compared; repeats are ignored. The same exclusion reworded but with the same key is **not** a change | New key in the renewal = **high**; key no longer in the renewal = **info** |
| Exclusions outside the fixed list (key "other") | Compared by their title, ignoring capital letters and extra spaces | Added or removed = **medium** and **needs human check** |
| Policy number | Not compared (renewal numbers can legitimately change) | - |
| Policy type | Not compared: there is no agreed rule yet (see the Prompt 3 handoff) | - |

## When a fact is missing or uncertain
If a figure could not be read from either document, or the reader was not confident (for example the quoted
text was not found on the stated page), the system **does not compare it and does not guess**. Instead it
raises one **medium "needs human check"** item naming that field.

## What becomes a flag
- Every change graded **medium** or **high**, and every **needs human check** item, becomes a flag.
- A field never gets two flags.
- **Overall risk** = the most serious grade among all changes and flags; **info** when nothing is above info
  (including when nothing changed).

## Order
Most serious first. Within the same grade: insurer, period, premium, excess, cover limit, then exclusions in
the fixed list order.

## Wording
Every sentence (in the spreadsheet, the summary and the draft emails) is produced by code from the figures,
for example: "Annual premium increases from 12,400 to 13,144 (+744, +6.0 percent)." Exclusions use a fixed
label per key; text written by the AI reader is never used, except the title of an "other" exclusion.
