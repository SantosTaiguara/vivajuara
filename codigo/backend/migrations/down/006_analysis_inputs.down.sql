-- Reverse of 006_analysis_inputs (development/staging only).
ALTER TABLE developments DROP CONSTRAINT IF EXISTS developments_current_analysis_input_fk;
ALTER TABLE developments DROP COLUMN IF EXISTS current_analysis_input_version;
DROP TABLE IF EXISTS lot_analysis_inputs;
DROP TABLE IF EXISTS analysis_input_versions;
