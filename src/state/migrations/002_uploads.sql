-- 002_uploads (Prompt 7, D-F): manual uploads, manual clients and policies, overview exports,
-- plus case origin and pack input source. Never edit 001. Timestamps come from the injected clock.

ALTER TABLE cases ADD COLUMN origin TEXT NOT NULL DEFAULT 'data_source' CHECK (origin IN ('data_source', 'manual'));
ALTER TABLE packs ADD COLUMN input_source TEXT NOT NULL DEFAULT 'data_source' CHECK (input_source IN ('data_source', 'upload'));

CREATE TABLE uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('attach', 'new')),
  policy_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'validating', 'extracting', 'comparing', 'done', 'failed', 'rejected')),
  failure_code TEXT,
  failure_message TEXT,
  expiring_doc_id INTEGER,
  renewal_doc_id INTEGER,
  case_id INTEGER REFERENCES cases (id),
  pack_id INTEGER REFERENCES packs (id),
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX uploads_by_started ON uploads (started_at);

CREATE TABLE uploaded_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id INTEGER NOT NULL REFERENCES uploads (id),
  side TEXT NOT NULL CHECK (side IN ('expiring', 'renewal')),
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  page_count INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (upload_id, side)
);

CREATE TABLE manual_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE manual_policies (
  policy_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES manual_clients (id),
  broker_id TEXT NOT NULL,
  insurer_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('commercial_property', 'public_liability', 'business_interruption')),
  expiry_date TEXT NOT NULL,
  annual_premium REAL,
  created_at TEXT NOT NULL
);

CREATE TABLE exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('overview')),
  filters TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  row_count INTEGER NOT NULL
);

-- The facts read from each document of a job (shown on the job page as 'Extracted facts'). Same content the
-- extraction cache already stores (values, page numbers, short quotes, confidence, warnings); never full text.
CREATE TABLE upload_terms (
  upload_id INTEGER NOT NULL REFERENCES uploads (id),
  side TEXT NOT NULL CHECK (side IN ('expiring', 'renewal')),
  source TEXT NOT NULL CHECK (source IN ('upload', 'data_source')),
  terms_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (upload_id, side)
);
