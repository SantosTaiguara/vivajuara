-- Reverse of 010_auth_sessions (development/staging only): drops sessions, used nonces and invitations.
-- Users created by accepted invitations (users.external_identity_id = 'google:…') and their memberships/role
-- assignments belong to 009 and are kept.
DROP TABLE IF EXISTS organization_invitations;
DROP TABLE IF EXISTS auth_used_nonces;
DROP TABLE IF EXISTS auth_sessions;
