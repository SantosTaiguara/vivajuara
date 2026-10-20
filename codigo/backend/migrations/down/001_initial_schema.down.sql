-- Reverse of 001_initial_schema (development/staging only: drops all V2 data).
-- In production, prefer a new forward migration and restore from backup if needed.
ALTER TABLE IF EXISTS developments
  DROP CONSTRAINT IF EXISTS developments_current_analysis_fk,
  DROP CONSTRAINT IF EXISTS developments_current_price_table_fk,
  DROP CONSTRAINT IF EXISTS developments_current_static_fk;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS availability_history;
DROP TABLE IF EXISTS lot_availability;
DROP TABLE IF EXISTS lot_prices;
DROP TABLE IF EXISTS payment_plans;
DROP TABLE IF EXISTS price_tables;
DROP TABLE IF EXISTS lot_analysis;
DROP TABLE IF EXISTS analysis_versions;
DROP TABLE IF EXISTS lots;
DROP TABLE IF EXISTS blocks;
DROP TABLE IF EXISTS static_versions;
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS developments;
