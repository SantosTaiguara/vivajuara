-- Reverse of 015_data_quality (development/staging only): drops every data quality runtime table.
-- The rules and policies are config (plat/config/dataquality) and are not affected.
DROP TRIGGER IF EXISTS dq_publication_snapshots_immutable ON dq_publication_snapshots;
DROP TABLE IF EXISTS dq_publication_snapshots;
DROP FUNCTION IF EXISTS plat_dq_snapshot_immutable();
DROP TABLE IF EXISTS dq_change_requests;
DROP TABLE IF EXISTS dq_reconciliation_runs;
DROP TABLE IF EXISTS dq_certifications;
DROP TABLE IF EXISTS dq_incidents;
DROP TABLE IF EXISTS dq_exceptions;
DROP TABLE IF EXISTS dq_findings;
DROP TABLE IF EXISTS dq_check_runs;
