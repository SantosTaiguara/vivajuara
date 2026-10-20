-- 009_iam (topic 30): users (minimal profile, no e-mail/phone: the identity provider is a pending decision),
-- organization memberships (topic 31), system role templates, role assignments scoped to organization or
-- organization+development, hashed dev/test access tokens (never plaintext) and the audit log extension
-- (organization, actor type, permission, outcome; append-only). Permission keys and role grants live in the code
-- registry (src/modules/iam/permissions.js, versioned by policyVersion); a test keeps the role codes below in sync.
-- Reverse: migrations/down/009_iam.down.sql

CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_identity_id TEXT NULL UNIQUE,          -- subject at the future IdP (OIDC "sub"); NULL for dev/test users
  status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED', 'DISABLED', 'ARCHIVED')),
  display_name         TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  locale               TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at        TIMESTAMPTZ NULL,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE organization_memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL REFERENCES organizations (id),
  user_id         UUID NOT NULL REFERENCES users (id),
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'ARCHIVED')),
  invited_at      TIMESTAMPTZ NULL,
  activated_at    TIMESTAMPTZ NULL,
  suspended_at    TIMESTAMPTZ NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX organization_memberships_user_idx ON organization_memberships (user_id);

-- System role templates (role_type SYSTEM). Custom roles per organization are future (organization_id NOT NULL).
CREATE TABLE roles (
  code            TEXT PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]{1,62}$'),
  organization_id TEXT NULL REFERENCES organizations (id),
  role_type       TEXT NOT NULL CHECK (role_type IN ('SYSTEM', 'CUSTOM')),
  label_key       TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  system_managed  BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role_type = 'SYSTEM') = (organization_id IS NULL))
);
INSERT INTO roles (code, role_type, label_key) VALUES
  ('OWNER_ADMIN', 'SYSTEM', 'role.owner_admin'),
  ('COMMERCIAL_MANAGER', 'SYSTEM', 'role.commercial_manager'),
  ('PRICING_MANAGER', 'SYSTEM', 'role.pricing_manager'),
  ('INVENTORY_MANAGER', 'SYSTEM', 'role.inventory_manager'),
  ('BROKER', 'SYSTEM', 'role.broker'),
  ('MARKETING', 'SYSTEM', 'role.marketing'),
  ('ANALYST', 'SYSTEM', 'role.analyst'),
  ('VIEWER', 'SYSTEM', 'role.viewer');

-- RoleAssignment: always inside one organization (membership required by FK); optionally narrowed to one development
-- of that same organization (composite FK: a role in organization A can never point at a development of B).
CREATE TABLE role_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users (id),
  role_code       TEXT NOT NULL REFERENCES roles (code),
  organization_id TEXT NOT NULL,
  development_id  TEXT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SCHEDULED', 'EXPIRED', 'REVOKED')),
  effective_from  TIMESTAMPTZ NULL,
  effective_to    TIMESTAMPTZ NULL,
  assigned_by     TEXT NULL,                     -- actor id (user uuid or "admin"), never a name
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES organization_memberships (organization_id, user_id),
  FOREIGN KEY (organization_id, development_id) REFERENCES developments (organization_id, id),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from)
);
CREATE INDEX role_assignments_user_idx ON role_assignments (user_id, organization_id);
CREATE UNIQUE INDEX role_assignments_unique_active ON role_assignments (user_id, role_code, organization_id, COALESCE(development_id, '')) WHERE status = 'ACTIVE';

-- Dev/test access tokens (DevTokenProvider, AUTH_DEV_TOKENS=true; refused in production). Only the sha256 of the
-- token is stored; the token is shown once by scripts/iam.js. A revoked or expired token authenticates nothing.
CREATE TABLE auth_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id),
  token_hash   TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  label        TEXT NULL CHECK (label IS NULL OR length(label) <= 80),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id);

-- ---------------------------------------------------------------- audit log: tenant, actor type, permission, outcome
ALTER TABLE audit_log
  ADD COLUMN organization_id TEXT NULL REFERENCES organizations (id), -- NULL only for platform-level events
  ADD COLUMN actor_type      TEXT NULL CHECK (actor_type IN ('SYSTEM', 'USER', 'SERVICE', 'ANONYMOUS')),
  ADD COLUMN permission_key  TEXT NULL,
  ADD COLUMN outcome         TEXT NOT NULL DEFAULT 'SUCCESS' CHECK (outcome IN ('SUCCESS', 'DENIED', 'FAILED', 'CANCELLED'));
UPDATE audit_log a SET organization_id = d.organization_id FROM developments d WHERE d.id = a.development_id;
UPDATE audit_log SET actor_type = CASE WHEN actor_id = 'admin' THEN 'SYSTEM' WHEN actor_id IS NULL THEN 'SYSTEM' ELSE 'USER' END WHERE actor_type IS NULL;
CREATE INDEX audit_log_org_created_idx ON audit_log (organization_id, created_at DESC, id DESC);

CREATE FUNCTION plat_audit_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.development_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM developments WHERE id = NEW.development_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_log_defaults BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION plat_audit_defaults();

-- append-only: the application never edits or deletes audit events
CREATE FUNCTION plat_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION plat_audit_append_only();
