-- Reverse of 014_backoffice_admin (development/staging only): drops the admin-layer tables. Domain data is untouched
-- (the backoffice never stored any). The append-only audit_log rows written by admin commands are kept.
DROP TABLE IF EXISTS admin_emergency_controls;
DROP TABLE IF EXISTS admin_support_sessions;
DROP TABLE IF EXISTS admin_work_assignments;
DROP TABLE IF EXISTS admin_config_changes;
DROP TABLE IF EXISTS admin_config_current;
DROP TABLE IF EXISTS admin_config_versions;
DROP TABLE IF EXISTS admin_commands;
