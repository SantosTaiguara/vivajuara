-- Reverse of 012_development_onboarding (development/staging only): drops the onboarding runtime tables.
-- Published lots/prices/availability are not affected (this migration never touched them).
DROP TRIGGER IF EXISTS onboarding_audit_events_append_only ON onboarding_audit_events;
DROP TRIGGER IF EXISTS onboarding_reports_append_only ON onboarding_reports;
DROP TRIGGER IF EXISTS onboarding_source_assets_immutable ON onboarding_source_assets;
DROP TABLE IF EXISTS onboarding_audit_events;
DROP TABLE IF EXISTS onboarding_reports;
DROP TABLE IF EXISTS onboarding_publications;
DROP TABLE IF EXISTS onboarding_review_items;
DROP TABLE IF EXISTS onboarding_data_conflicts;
DROP TABLE IF EXISTS field_mapping_sets;
DROP TABLE IF EXISTS ingestion_runs;
DROP TABLE IF EXISTS ingestion_batches;
DROP TABLE IF EXISTS onboarding_source_assets;
DROP TABLE IF EXISTS onboarding_cases;
DROP FUNCTION IF EXISTS plat_onboarding_append_only();
DROP FUNCTION IF EXISTS plat_onboarding_source_immutable();
