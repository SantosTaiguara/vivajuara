-- Reverse of 009_iam (development/staging only): drops users, memberships, roles, assignments and tokens.
DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
DROP FUNCTION IF EXISTS plat_audit_append_only();
DROP TRIGGER IF EXISTS audit_log_defaults ON audit_log;
DROP FUNCTION IF EXISTS plat_audit_defaults();
DROP INDEX IF EXISTS audit_log_org_created_idx;
ALTER TABLE audit_log DROP COLUMN IF EXISTS outcome, DROP COLUMN IF EXISTS permission_key, DROP COLUMN IF EXISTS actor_type, DROP COLUMN IF EXISTS organization_id;
DROP TABLE IF EXISTS auth_tokens;
DROP TABLE IF EXISTS role_assignments;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS organization_memberships;
DROP TABLE IF EXISTS users;
