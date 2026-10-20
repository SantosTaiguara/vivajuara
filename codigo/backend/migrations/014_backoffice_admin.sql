-- 014_backoffice_admin (topic 60 — backoffice operacional / console administrativo).
-- Persists only what the admin layer itself owns: command log (idempotency + lineage), immutable configuration versions
-- and their change requests, work assignments/claims, support sessions and emergency controls.
-- Domain state (reservations, prices, availability, privacy requests…) is NEVER stored here: admin commands call the
-- domain services of their modules. No PII: actors are user ids, reasons are structured codes; free-text reasons are
-- not persisted (they complement the code in the UI only). Append-only tables have no UPDATE/DELETE path in the code.
-- Reverse: migrations/down/014_backoffice_admin.down.sql

-- AdminCommandEnvelope log: one row per executed (or refused-after-validation) command. idempotency_key + request_hash
-- make execute idempotent; the stored result is replayed for the same key and refused for a different body.
CREATE TABLE admin_commands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id       TEXT NOT NULL CHECK (length(command_id) BETWEEN 4 AND 128),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  action_code      TEXT NOT NULL CHECK (action_code ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  resource_ref     TEXT NOT NULL CHECK (length(resource_ref) <= 160),
  actor_id         TEXT NOT NULL,
  actor_type       TEXT NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM')),
  reason_code      TEXT NULL CHECK (reason_code IS NULL OR reason_code IN ('DATA_CORRECTION', 'CUSTOMER_REQUEST', 'COMMERCIAL_EXCEPTION', 'SECURITY_RESPONSE', 'PRIVACY_REQUEST', 'ROLLBACK', 'SYSTEM_RECOVERY', 'OTHER')),
  expected_revision TEXT NULL,
  new_revision     TEXT NULL,
  approval_ref     TEXT NULL,
  idempotency_key  TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash     TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  outcome          TEXT NOT NULL CHECK (outcome IN ('EXECUTED', 'REJECTED')),
  result           JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id       TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, actor_id, idempotency_key)
);
CREATE INDEX admin_commands_org_created_idx ON admin_commands (organization_id, created_at DESC);
CREATE INDEX admin_commands_resource_idx ON admin_commands (organization_id, resource_ref);

-- Versioned configuration (§119-123): published versions are immutable; "current" is a pointer; rollback inserts a new
-- version that restores old content (restores_version).
CREATE TABLE admin_config_versions (
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  config_type      TEXT NOT NULL CHECK (length(config_type) <= 64),
  scope_ref        TEXT NOT NULL CHECK (length(scope_ref) <= 160),
  version          INTEGER NOT NULL CHECK (version >= 1),
  content          JSONB NOT NULL,
  content_hash     TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  restores_version INTEGER NULL,
  change_ref       TEXT NULL,
  published_by     TEXT NOT NULL,
  published_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, config_type, scope_ref, version)
);
CREATE TABLE admin_config_current (
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  config_type      TEXT NOT NULL,
  scope_ref        TEXT NOT NULL,
  version          INTEGER NOT NULL,
  revision         BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, config_type, scope_ref),
  FOREIGN KEY (organization_id, config_type, scope_ref, version) REFERENCES admin_config_versions (organization_id, config_type, scope_ref, version)
);
CREATE TABLE admin_config_changes (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 4 AND 128),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  config_type      TEXT NOT NULL,
  scope_ref        TEXT NOT NULL,
  current_version  INTEGER NULL,
  proposed_content JSONB NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'REJECTED', 'ROLLED_BACK')),
  requested_by     TEXT NOT NULL,
  approved_by      TEXT NULL CHECK (approved_by IS NULL OR approved_by <> requested_by), -- separation of duties
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WorkAssignment / WorkClaim (§196-207). Assignment is not authorization.
CREATE TABLE admin_work_assignments (
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  work_item_ref    TEXT NOT NULL CHECK (length(work_item_ref) <= 160),
  assigned_to_user TEXT NULL,
  assigned_to_team TEXT NULL,
  assigned_by      TEXT NOT NULL,
  assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT NOT NULL CHECK (status IN ('ASSIGNED', 'UNASSIGNED', 'COMPLETED')),
  claimed_by       TEXT NULL,
  claim_expires_at TIMESTAMPTZ NULL,
  revision         BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (organization_id, work_item_ref)
);

-- SupportSession (§95-97): formal, time-bound, read-only by default, approved by someone else.
CREATE TABLE admin_support_sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  support_user_id        TEXT NOT NULL,
  target_organization_id TEXT NOT NULL REFERENCES organizations (id),
  target_user_id         TEXT NULL,
  reason_code            TEXT NOT NULL,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at             TIMESTAMPTZ NOT NULL,
  read_only              BOOLEAN NOT NULL DEFAULT true,
  approved_by            TEXT NULL CHECK (approved_by IS NULL OR approved_by <> support_user_id),
  status                 TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  CHECK (expires_at > started_at)
);
CREATE INDEX admin_support_sessions_active_idx ON admin_support_sessions (target_organization_id) WHERE status = 'ACTIVE';

-- EmergencyControl (§292-297): never indefinite (expires_at NOT NULL).
CREATE TABLE admin_emergency_controls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  control_type     TEXT NOT NULL CHECK (control_type IN ('DISABLE_PUBLIC_SHARE', 'DISABLE_RESERVATION_WRITES', 'DISABLE_EXTERNAL_SYNC', 'FORCE_LOGOUT_TENANT')),
  scope_ref        TEXT NOT NULL,
  reason_code      TEXT NOT NULL,
  activated_by     TEXT NOT NULL,
  activated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  released_by      TEXT NULL,
  released_at      TIMESTAMPTZ NULL,
  status           TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED')),
  CHECK (expires_at > activated_at)
);
CREATE INDEX admin_emergency_active_idx ON admin_emergency_controls (organization_id, control_type) WHERE status = 'ACTIVE';
