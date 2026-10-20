-- 013_privacy (topic 59): LGPD runtime records. Registries (categories, purposes, legal basis assessments, retention,
-- deadlines, vendors, transfers, DPO) are versioned config in plat/config/privacy/*.json and stay null/DRAFT until legal
-- validation (this is not legal advice). This migration persists only runtime records: data subject requests (optimistic
-- revision), identity verifications, append-only consent records and audit, legal holds, processing blocks, deletion
-- tombstones, contact suppressions and privacy incidents. Every row is tenant-scoped (organization_id).
-- No plain PII: subject_ref is an opaque id; suppressions keep only a hash of the normalized contact; tombstones keep the opaque subject id; record JSONB never holds contact data.
-- Reverse: migrations/down/013_privacy.down.sql

CREATE TABLE privacy_requests (
  id               TEXT PRIMARY KEY CHECK (id ~ '^dsr_[A-Za-z0-9_]+$'),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  subject_ref      TEXT NULL,
  request_type     TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('RECEIVED', 'IDENTITY_VERIFICATION', 'IN_REVIEW', 'ACTION_REQUIRED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'DENIED_WITH_REASON', 'CANCELLED')),
  revision         INTEGER NOT NULL DEFAULT 1,
  received_at      TIMESTAMPTZ NOT NULL,
  due_at           TIMESTAMPTZ NULL,                       -- null while the deadline rule is not legally validated
  record           JSONB NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX privacy_requests_org_status ON privacy_requests (organization_id, status);

CREATE TABLE privacy_identity_verifications (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  request_id       TEXT NOT NULL REFERENCES privacy_requests (id),
  method           TEXT NOT NULL,
  result           TEXT NOT NULL CHECK (result IN ('PENDING', 'VERIFIED', 'FAILED')),
  evidence_ref     TEXT NULL,                              -- reference only, never the document itself
  verified_at      TIMESTAMPTZ NULL
);

CREATE TABLE privacy_consents (
  seq              BIGSERIAL PRIMARY KEY,
  id               TEXT NOT NULL,
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  subject_ref      TEXT NOT NULL,
  purpose_id       TEXT NOT NULL,
  notice_version_id TEXT NOT NULL,
  consent_text_checksum TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('GRANTED', 'WITHDRAWN', 'EXPIRED')),
  record           JSONB NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX privacy_consents_subject ON privacy_consents (organization_id, subject_ref, purpose_id, seq DESC);

CREATE TABLE privacy_audit (
  seq              BIGSERIAL PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  entity_type      TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  action           TEXT NOT NULL,
  actor_id         TEXT NULL,
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  details          JSONB NOT NULL DEFAULT '{}'::jsonb      -- codes and ids only
);

CREATE OR REPLACE FUNCTION plat_privacy_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'privacy record is append-only (%)', TG_TABLE_NAME; END $$;
CREATE TRIGGER privacy_consents_append_only BEFORE UPDATE OR DELETE ON privacy_consents FOR EACH ROW EXECUTE FUNCTION plat_privacy_append_only();
CREATE TRIGGER privacy_audit_append_only BEFORE UPDATE OR DELETE ON privacy_audit FOR EACH ROW EXECUTE FUNCTION plat_privacy_append_only();

CREATE TABLE privacy_legal_holds (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  subject_ref      TEXT NULL,
  status           TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED')),
  record           JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  released_at      TIMESTAMPTZ NULL
);

CREATE TABLE privacy_processing_blocks (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  subject_ref      TEXT NOT NULL,
  record           JSONB NOT NULL,
  active_from      TIMESTAMPTZ NOT NULL,
  active_to        TIMESTAMPTZ NULL
);

CREATE TABLE privacy_tombstones (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  subject_ref      TEXT NOT NULL,                          -- opaque id only: blocks re-import without keeping the data
  data_category_ref TEXT NULL,
  reason_ref       TEXT NOT NULL,                          -- request id that caused the deletion
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NULL,
  UNIQUE (organization_id, subject_ref, data_category_ref)
);

CREATE TABLE privacy_suppressions (
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  normalized_contact_hash TEXT NOT NULL,
  channel          TEXT NOT NULL,
  purpose          TEXT NOT NULL,
  reason           TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, normalized_contact_hash, channel, purpose)
);

CREATE TABLE privacy_incidents (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NOT NULL,
  record           JSONB NOT NULL,
  revision         INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
