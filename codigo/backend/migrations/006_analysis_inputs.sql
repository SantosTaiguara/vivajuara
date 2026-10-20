-- 006_analysis_inputs: measurements consumed by the IntelligenceEngine (LotAnalysisInput, analysis-input.json),
-- versioned by inputVersion and immutable once imported. The backend runs the same engine as the frontend
-- over these rows (analysis preview) — full precision, never the rounded values shown in the UI.
-- Reverse: migrations/down/006_analysis_inputs.down.sql
CREATE TABLE analysis_input_versions (
  development_id       TEXT NOT NULL REFERENCES developments (id),
  version              TEXT NOT NULL,                -- inputVersion (e.g. measurements-2026-10-06)
  schema_version       TEXT NOT NULL,
  checksum             TEXT NOT NULL,                -- sha256 over all lot checksums of the version
  lot_count            INTEGER NOT NULL CHECK (lot_count >= 0),
  source_ids           JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_file_checksum TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (development_id, version)
);

CREATE TABLE lot_analysis_inputs (
  development_id TEXT NOT NULL,
  input_version  TEXT NOT NULL,
  lot_id         TEXT NOT NULL REFERENCES lots (id),
  data           JSONB NOT NULL,                     -- LotAnalysisInput of the lot (lossless)
  checksum       TEXT NOT NULL,
  PRIMARY KEY (development_id, input_version, lot_id),
  FOREIGN KEY (development_id, input_version) REFERENCES analysis_input_versions (development_id, version)
);
CREATE INDEX lot_analysis_inputs_lot_idx ON lot_analysis_inputs (lot_id);

ALTER TABLE developments ADD COLUMN current_analysis_input_version TEXT NULL;
ALTER TABLE developments ADD CONSTRAINT developments_current_analysis_input_fk
  FOREIGN KEY (id, current_analysis_input_version) REFERENCES analysis_input_versions (development_id, version);
