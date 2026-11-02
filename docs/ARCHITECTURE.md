# Architecture

Concept project, synthetic data only, drafts only. One Node.js process (`npm run serve`) holds the daily
scheduler, the local approval page and (optionally) the Telegram adapter. Everything else is plain modules
under `src/`, each with one job (see the README in each folder).

## Components

```mermaid
flowchart TB
  subgraph Inputs
    DS[(Data source<br/>LocalJsonSource<br/>read-only + status overlay)]
    PDF[Policy PDFs<br/>expiring + renewal]
  end
  subgraph Daily run [Pipeline - src/pipeline]
    SCH[DailyScheduler<br/>RUN_TIME, TIMEZONE] --> KS{Kill switch<br/>PAUSE / AUTOPILOT_ENABLED}
    KS --> SEL[selectRenewals<br/>84-112 days, idempotency]
    SEL --> TXT[readPdfText<br/>page text, scan check]
    TXT --> LLM[LLM extraction<br/>JSON + page + quote]
    LLM --> VQ[verifyQuotes<br/>plain code]
    VQ --> CMP[compareTerms<br/>plain-code rules]
    CMP --> OUT[writePack<br/>xlsx, 2 draft .eml, summary]
  end
  subgraph State [SQLite - src/state]
    DB[(cases, packs, runs,<br/>notifications, approvals)]
    AUD[(audit_events)]
  end
  subgraph Approval [src/approval]
    DISP[Dispatcher<br/>cards, reminders, outbox]
    WEB[Web page<br/>127.0.0.1 only]
    TG[Telegram adapter<br/>optional]
    CORE[Approval core<br/>validate, decide, audit]
  end
  DS --> SEL
  PDF --> TXT
  OUT --> DB
  SEL & LLM & CMP & OUT --> AUD
  DB --> DISP
  DISP --> WEB
  DISP -.-> TG
  WEB --> CORE
  TG -.-> CORE
  CLI[CLI approve / skip] --> CORE
  CORE --> DB
  CORE --> AUD
  CORE -->|after Approve: the only write| DS
```

Key boundaries:
- The AI model only turns page text into JSON. It never compares, grades or decides.
- `src/compare` is pure code with no I/O; the same input always gives the same differences and flags.
- `src/outputs` writes files only. There is no sending code anywhere.
- `updateRenewalStatus` is called only by the approval core, only with "approved".
- Each policy is processed on its own: one failure marks that policy "needs attention" and the run continues.

## One morning run

```mermaid
sequenceDiagram
  autonumber
  participant S as Scheduler
  participant P as Pipeline
  participant D as Data source
  participant AI as AI model
  participant C as Compare (plain code)
  participant O as Outputs
  participant DB as SQLite + audit
  participant W as Approval page
  actor B as Broker
  S->>P: 07:00 run (unless paused)
  P->>DB: run_started
  P->>D: list policies (read-only)
  P->>P: select 84-112 days, skip already processed
  loop each selected policy
    P->>D: document paths
    P->>AI: page text as data (expiring, renewal)
    AI-->>P: terms JSON with pages and quotes
    P->>P: check every quote on its page
    P->>C: compare expiring vs renewal
    C-->>P: differences, flags, overall risk
    P->>O: write xlsx + 2 draft .eml + summary
    P->>DB: one transaction: pack, status in_review, audit
  end
  P->>DB: run_finished
  P->>W: one card per pack (notices for missing documents)
  B->>W: Open (spreadsheet) / Approve / Skip
  W->>DB: approval + status approved + audit
  W->>D: updateRenewalStatus(approved)
  Note over O,B: Nothing is sent by the tool. The broker decides whether to send the drafts from their own mail app.
```

## Rendering the diagrams to images

- GitHub and many Markdown viewers render `mermaid` code blocks directly.
- To export a PNG or SVG: paste a diagram into the Mermaid Live Editor (mermaid.live) and use its export
  button, or use the Mermaid command-line tool (`@mermaid-js/mermaid-cli`, command `mmdc`). Check the
  current Mermaid docs for the exact install and export commands.
- Not verified here: I did not render these diagrams to images in this environment. The syntax follows
  Mermaid's flowchart and sequence diagram forms; check them once in the Live Editor before publishing.
