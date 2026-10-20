-- Reverse of 013_privacy (development/staging only): drops every privacy runtime table.
-- Registries are config (plat/config/privacy) and are not affected.
DROP TABLE IF EXISTS privacy_incidents;
DROP TABLE IF EXISTS privacy_suppressions;
DROP TABLE IF EXISTS privacy_tombstones;
DROP TABLE IF EXISTS privacy_processing_blocks;
DROP TABLE IF EXISTS privacy_legal_holds;
DROP TRIGGER IF EXISTS privacy_audit_append_only ON privacy_audit;
DROP TRIGGER IF EXISTS privacy_consents_append_only ON privacy_consents;
DROP FUNCTION IF EXISTS plat_privacy_append_only();
DROP TABLE IF EXISTS privacy_audit;
DROP TABLE IF EXISTS privacy_consents;
DROP TABLE IF EXISTS privacy_identity_verifications;
DROP TABLE IF EXISTS privacy_requests;
