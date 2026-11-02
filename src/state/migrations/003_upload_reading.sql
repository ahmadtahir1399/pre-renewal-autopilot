-- 003_upload_reading (Prompt 7 enhancement, D-120): which facts of a job's document were confirmed by the
-- targeted second reading. JSON array of field names. Older rows default to none.
ALTER TABLE upload_terms ADD COLUMN repaired_json TEXT NOT NULL DEFAULT '[]';
