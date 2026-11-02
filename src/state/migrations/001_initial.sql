-- 001_initial: runs, cases, packs, notifications, audit_events, approvals.
-- All timestamps are ISO 8601 UTC strings written by the application from its injected clock,
-- never by a database default. Pack paths are RELATIVE to OUTPUT_DIR with '/' separators.

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  today TEXT NOT NULL,
  dry_run INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'finished', 'blocked', 'failed')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_id TEXT NOT NULL,
  cycle_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('not_started', 'drafted', 'needs_attention', 'in_review', 'approved', 'skipped')),
  input_hash TEXT,
  current_version INTEGER NOT NULL DEFAULT 0,
  attention_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES cases (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
  content_hash TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  paths TEXT NOT NULL,
  pack_json TEXT NOT NULL,
  run_id TEXT REFERENCES runs (id),
  sync_state TEXT NOT NULL DEFAULT 'ok' CHECK (sync_state IN ('ok', 'status_sync_failed', 'copy_failed')),
  created_at TEXT NOT NULL,
  UNIQUE (case_id, version)
);

-- At most one active pack per case, enforced by the database.
CREATE UNIQUE INDEX packs_one_active_per_case ON packs (case_id) WHERE status = 'active';

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id INTEGER REFERENCES packs (id),
  case_id INTEGER NOT NULL REFERENCES cases (id),
  channel TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pack', 'reminder', 'notice')),
  cause TEXT,
  external_message_id TEXT,
  sent_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Never send the same pack card to the same channel twice.
CREATE UNIQUE INDEX notifications_one_card_per_pack_channel ON notifications (pack_id, channel) WHERE kind = 'pack';
-- One notice per case, channel and cause.
CREATE UNIQUE INDEX notifications_one_notice_per_cause ON notifications (case_id, channel, cause) WHERE kind = 'notice';

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  run_id TEXT,
  policy_id TEXT,
  cycle_key TEXT,
  actor TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX audit_events_by_policy ON audit_events (policy_id, id);

CREATE TABLE approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_id INTEGER NOT NULL REFERENCES packs (id),
  action TEXT NOT NULL CHECK (action IN ('approve', 'skip')),
  actor TEXT NOT NULL,
  channel TEXT NOT NULL,
  at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
