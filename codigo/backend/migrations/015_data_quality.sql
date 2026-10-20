-- 015_data_quality (topic 61): data quality & operational governance records. The rules, rule sets, domains, gates and
-- policies live in versioned config (plat/config/dataquality/*.json) and the shared domain (plat/src/dataquality/*.js);
-- this migration only persists what is produced at runtime: check runs (summary + sampled evidence, never full
-- datasets), grouped findings, exceptions (always with expiry), incidents, remediation plans, certifications,
-- reconciliation runs, change requests and publication quality snapshots. Every row is tenant-scoped
-- (organization_id); a finding/incident of another organization is never readable (the service answers 404).
-- No PII: actor columns hold opaque ids; evidence holds entity refs and counts only.
-- Reverse: migrations/down/015_data_quality.down.sql

CREATE TABLE dq_check_runs (
  id               TEXT PRIMARY KEY CHECK (id ~ '^dqr_[A-Za-z0-9_]+$'),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  development_id   TEXT NULL,
  trigger          TEXT NOT NULL CHECK (trigger IN ('WRITE', 'PUBLISH', 'SCHEDULE', 'EVENT', 'MANUAL')),
  scope_ref        TEXT NOT NULL,
  rule_set_versions TEXT[] NOT NULL DEFAULT '{}',
  policy_versions  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status           TEXT NOT NULL CHECK (status IN ('RUNNING', 'PASSED', 'PASSED_WITH_WARNINGS', 'FAILED', 'ERROR')),
  results          JSONB NOT NULL DEFAULT '[]'::jsonb,       -- DataQualityCheckResult[] with sampled failures only
  started_at       TIMESTAMPTZ NOT NULL,
  completed_at     TIMESTAMPTZ NULL,
  requested_by     TEXT NULL
);
CREATE INDEX dq_check_runs_scope_idx ON dq_check_runs (organization_id, development_id, started_at DESC);

CREATE TABLE dq_findings (
  id                TEXT PRIMARY KEY CHECK (id ~ '^dqf_[A-Za-z0-9_]+$'),
  organization_id   TEXT NOT NULL REFERENCES organizations (id),
  development_id    TEXT NULL,
  data_domain_id    TEXT NOT NULL,
  rule_id           TEXT NOT NULL,
  rule_version      TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'BLOCKING')),
  effective_mode    TEXT NOT NULL CHECK (effective_mode IN ('SHADOW', 'WARNING', 'ENFORCED')),
  status            TEXT NOT NULL CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'IN_REMEDIATION', 'RESOLVED', 'ACCEPTED_EXCEPTION', 'FALSE_POSITIVE')),
  failed_count      INTEGER NOT NULL CHECK (failed_count >= 0),
  evaluated_count   INTEGER NOT NULL CHECK (evaluated_count >= 0),
  sample_entity_refs TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(sample_entity_refs) <= 50),
  owner_ref         TEXT NULL,
  related_incident_id TEXT NULL,
  detected_at       TIMESTAMPTZ NOT NULL,
  last_observed_at  TIMESTAMPTZ NOT NULL,
  body              JSONB NOT NULL,                          -- full record (samples, lineage, resolution, history)
  CHECK (status <> 'FALSE_POSITIVE' OR body ? 'falsePositiveReason')
);
CREATE INDEX dq_findings_queue_idx ON dq_findings (organization_id, status, severity, data_domain_id);

CREATE TABLE dq_exceptions (
  id               TEXT PRIMARY KEY CHECK (id ~ '^dqx_[A-Za-z0-9_]+$'),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  finding_or_rule_ref TEXT NOT NULL,
  scope_ref        TEXT NULL,
  reason           TEXT NOT NULL CHECK (length(reason) >= 10),
  risk             TEXT NOT NULL CHECK (risk IN ('LOW', 'MEDIUM', 'HIGH')),
  requested_by     TEXT NOT NULL,
  approved_by      TEXT NULL,
  approved_at      TIMESTAMPTZ NULL,
  expires_at       TIMESTAMPTZ NOT NULL,                     -- every exception expires (never NULL)
  status           TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'EXPIRED', 'REVOKED')),
  body             JSONB NOT NULL,
  CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CHECK ((status = 'ACTIVE') <= (approved_by IS NOT NULL))
);
CREATE INDEX dq_exceptions_active_idx ON dq_exceptions (organization_id, finding_or_rule_ref) WHERE status = 'ACTIVE';

CREATE TABLE dq_incidents (
  id               TEXT PRIMARY KEY CHECK (id ~ '^dqi_[A-Za-z0-9_]+$'),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  development_id   TEXT NULL,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  severity         TEXT NOT NULL CHECK (severity IN ('SEV1', 'SEV2', 'SEV3', 'SEV4')),
  status           TEXT NOT NULL CHECK (status IN ('OPEN', 'INVESTIGATING', 'MITIGATING', 'MONITORING', 'RESOLVED', 'CLOSED')),
  owner_ref        TEXT NOT NULL,
  detected_at      TIMESTAMPTZ NOT NULL,
  resolved_at      TIMESTAMPTZ NULL,
  body             JSONB NOT NULL                            -- impact assessment, RCA, remediation plan, verification, postmortem
);
CREATE INDEX dq_incidents_open_idx ON dq_incidents (organization_id, status, severity);

CREATE TABLE dq_certifications (
  id               TEXT PRIMARY KEY CHECK (id ~ '^dqcert_[A-Za-z0-9_]+$'),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  scope_ref        TEXT NOT NULL,
  scope_version    TEXT NULL,
  certification_level TEXT NOT NULL CHECK (certification_level IN ('UNVERIFIED', 'VALIDATED', 'CERTIFIED', 'CERTIFIED_WITH_LIMITATIONS')),
  status           TEXT NOT NULL CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  certified_by     TEXT NOT NULL,
  certified_at     TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NULL,
  body             JSONB NOT NULL
);

CREATE TABLE dq_reconciliation_runs (
  id               TEXT PRIMARY KEY CHECK (id ~ '^dqrec_[A-Za-z0-9_]+$'),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  policy_id        TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('MATCH', 'DIFFERENCES', 'FAILED')),
  matched          INTEGER NOT NULL DEFAULT 0, mismatched INTEGER NOT NULL DEFAULT 0,
  missing_platform INTEGER NOT NULL DEFAULT 0, missing_source INTEGER NOT NULL DEFAULT 0,
  at               TIMESTAMPTZ NOT NULL,
  body             JSONB NOT NULL                            -- sampled mismatches + proposed (never applied) corrections
);

CREATE TABLE dq_change_requests (
  id               TEXT PRIMARY KEY CHECK (id ~ '^(dqc|dqsa)_[A-Za-z0-9_]+$'),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  kind             TEXT NOT NULL CHECK (kind IN ('DATA_CHANGE', 'SOURCE_AUTHORITY_CHANGE')),
  data_domain_id   TEXT NOT NULL,
  change_type      TEXT NULL CHECK (change_type IS NULL OR change_type IN ('SCHEMA', 'SEMANTICS', 'SOURCE', 'RULE', 'MAPPING', 'UNIT', 'ENUM', 'IDENTITY')),
  status           TEXT NOT NULL CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'IMPLEMENTED')),
  proposed_by      TEXT NOT NULL,
  body             JSONB NOT NULL
);

-- Publication quality snapshots are immutable: they explain why a publication was allowed (historical reproducibility).
CREATE TABLE dq_publication_snapshots (
  publication_id   TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  fingerprint      TEXT NOT NULL,
  rule_set_versions TEXT[] NOT NULL,
  check_run_refs   TEXT[] NOT NULL,
  generated_at     TIMESTAMPTZ NOT NULL,
  body             JSONB NOT NULL
);
CREATE FUNCTION plat_dq_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'dq_publication_snapshots is append-only (% refused)', TG_OP;
END $$;
CREATE TRIGGER dq_publication_snapshots_immutable BEFORE UPDATE OR DELETE ON dq_publication_snapshots
  FOR EACH ROW EXECUTE FUNCTION plat_dq_snapshot_immutable();
