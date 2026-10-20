-- 002_import_runs: one row per real (non dry-run) import, with the full report.
-- Reverse: migrations/down/002_import_runs.down.sql
CREATE TABLE import_runs (
  id                   BIGSERIAL PRIMARY KEY,
  development_id       TEXT NOT NULL REFERENCES developments (id),
  source_file          TEXT NOT NULL,        -- file name only (no absolute paths)
  source_file_checksum TEXT NOT NULL,
  backup_key           TEXT NULL,
  report               JSONB NOT NULL,
  started_at           TIMESTAMPTZ NOT NULL,
  finished_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX import_runs_development_idx ON import_runs (development_id, finished_at DESC);
