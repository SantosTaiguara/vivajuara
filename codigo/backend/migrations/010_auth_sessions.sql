-- 010_auth_sessions (W3 login — decisions: identity provider = Google OIDC, organization = org_house7):
-- server-side cookie sessions, one-time ID-token nonces and e-mail invitations to an organization.
-- PII minimization: no e-mail, no raw Google subject and no token is stored. Sessions are keyed by sha256(session id)
-- (the id only lives in the HttpOnly cookie); subjects and e-mails are stored as domain-separated sha256 hashes
-- (users.external_identity_id = 'google:' || sha256(sub), see src/modules/auth/auth.service.js).
-- Reverse: migrations/down/010_auth_sessions.down.sql

-- Sessions (Google OIDC). user_id NULL = authenticated Google account that was never invited: no organization, no
-- permission beyond the public ones (deny by default). Idle timeout slides up to the absolute timeout.
CREATE TABLE auth_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_hash        TEXT NOT NULL UNIQUE CHECK (session_hash ~ '^[0-9a-f]{64}$'),
  user_id             UUID NULL REFERENCES users (id),
  subject_hash        TEXT NOT NULL CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  provider            TEXT NOT NULL CHECK (provider IN ('google')),
  display_name        TEXT NULL CHECK (display_name IS NULL OR length(display_name) <= 60), -- first name of a not-invited account (header only)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at     TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ NULL,
  revoked_reason      TEXT NULL CHECK (revoked_reason IS NULL OR revoked_reason IN ('LOGOUT', 'ROTATED', 'ADMIN', 'USER_DISABLED', 'EXPIRED')),
  CHECK (idle_expires_at <= absolute_expires_at),
  CHECK (absolute_expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions (absolute_expires_at);

-- One-time use of the OIDC nonce: a replayed ID token (same nonce) is refused. Rows expire with the token.
CREATE TABLE auth_used_nonces (
  nonce_hash TEXT PRIMARY KEY CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_used_nonces_expiry_idx ON auth_used_nonces (expires_at);

-- Invitations (no auto-provisioning of roles): an admin invites a verified Google e-mail to an organization with one
-- role (organization-wide or for one development of that same organization). Accepted at the next Google login of that
-- e-mail: ACTIVE membership + role assignment, in one transaction. Only sha256 of the normalized e-mail is kept.
CREATE TABLE organization_invitations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  email_hash       TEXT NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  role_code        TEXT NOT NULL REFERENCES roles (code),
  development_id   TEXT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  invited_by       TEXT NULL,                    -- actor id ("admin" CLI or user uuid), never a name
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ NULL,
  accepted_user_id UUID NULL REFERENCES users (id),
  FOREIGN KEY (organization_id, development_id) REFERENCES developments (organization_id, id),
  CHECK (expires_at > created_at),
  CHECK ((status = 'ACCEPTED') = (accepted_at IS NOT NULL AND accepted_user_id IS NOT NULL))
);
CREATE INDEX organization_invitations_pending_idx ON organization_invitations (email_hash) WHERE status = 'PENDING';
CREATE UNIQUE INDEX organization_invitations_pending_unique ON organization_invitations (organization_id, email_hash, role_code, COALESCE(development_id, '')) WHERE status = 'PENDING';
