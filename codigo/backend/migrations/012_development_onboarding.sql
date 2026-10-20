-- 012_development_onboarding (topic 58): runtime records of the development onboarding / ingestion pipeline.
-- The rules live in the shared domain (plat/src/onboarding) and policy (plat/src/config/onboarding/onboardingPolicy.js);
-- file bytes live in the object store (storage_ref obj://…), never here. Every row is tenant-scoped (organization_id).
-- Nothing in this migration touches lots, prices, availability or published data: publishing only moves the onboarding pointer.
-- No PII: actor fields are opaque ids; PII columns detected in sources are never ingested.
-- Reverse: migrations/down/012_development_onboarding.down.sql

-- Caso de onboarding (máquina de estados no domínio; revision otimista no body).
CREATE TABLE onboarding_cases (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_cases_org_idx ON onboarding_cases (organization_id, onboarding_case_id, created_at);

-- SourceAsset imutável: checksum/storage_ref nunca mudam (trigger); só status/scan/supersededBy.
CREATE TABLE onboarding_source_assets (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  checksum         TEXT GENERATED ALWAYS AS (body->>'checksum') STORED CHECK (checksum ~ '^sha256:[0-9a-f]{64}$'),
  storage_ref      TEXT GENERATED ALWAYS AS (body->>'storageRef') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_source_assets_org_idx ON onboarding_source_assets (organization_id, onboarding_case_id, created_at);

-- IngestionBatch idempotente: (organization_id, fingerprint) único.
CREATE TABLE ingestion_batches (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  fingerprint      TEXT GENERATED ALWAYS AS (body->>'fingerprint') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ingestion_batches_org_idx ON ingestion_batches (organization_id, onboarding_case_id, created_at);

-- Resumo do run por batch (gate, contagens; nunca o dataset completo).
CREATE TABLE ingestion_runs (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ingestion_runs_org_idx ON ingestion_runs (organization_id, onboarding_case_id, created_at);

-- Versões do FieldMappingSet (uma linha por revisão).
CREATE TABLE field_mapping_sets (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX field_mapping_sets_org_idx ON field_mapping_sets (organization_id, onboarding_case_id, created_at);

-- DataConflict + resolução auditada.
CREATE TABLE onboarding_data_conflicts (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_data_conflicts_org_idx ON onboarding_data_conflicts (organization_id, onboarding_case_id, created_at);

-- Fila de revisão.
CREATE TABLE onboarding_review_items (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_review_items_org_idx ON onboarding_review_items (organization_id, onboarding_case_id, created_at);

-- Estado de publicação por caso: ponteiro, candidatos, aprovações, histórico.
CREATE TABLE onboarding_publications (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_publications_org_idx ON onboarding_publications (organization_id, onboarding_case_id, created_at);

-- Relatório de onboarding (append-only, reportChecksum).
CREATE TABLE onboarding_reports (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_reports_org_idx ON onboarding_reports (organization_id, onboarding_case_id, created_at);

-- Eventos de auditoria do onboarding (append-only, só ids).
CREATE TABLE onboarding_audit_events (
  id               TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  status           TEXT NULL,
  body             JSONB NOT NULL,
  onboarding_case_id TEXT GENERATED ALWAYS AS (body->>'onboardingCaseId') STORED,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX onboarding_audit_events_org_idx ON onboarding_audit_events (organization_id, onboarding_case_id, created_at);

CREATE UNIQUE INDEX ingestion_batches_fingerprint_uq ON ingestion_batches (organization_id, fingerprint) WHERE fingerprint IS NOT NULL AND status NOT IN ('SUPERSEDED', 'CANCELLED', 'FAILED');
CREATE UNIQUE INDEX onboarding_source_assets_checksum_uq ON onboarding_source_assets (organization_id, onboarding_case_id, checksum) WHERE status <> 'REJECTED';

-- immutability: source identity (checksum, object) never changes; reports and audit are append-only
CREATE FUNCTION plat_onboarding_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.body->>'checksum' IS DISTINCT FROM OLD.body->>'checksum' OR NEW.body->>'storageRef' IS DISTINCT FROM OLD.body->>'storageRef' THEN
    RAISE EXCEPTION 'SOURCE_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER onboarding_source_assets_immutable BEFORE UPDATE ON onboarding_source_assets FOR EACH ROW EXECUTE FUNCTION plat_onboarding_source_immutable();
CREATE FUNCTION plat_onboarding_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
CREATE TRIGGER onboarding_reports_append_only BEFORE UPDATE OR DELETE ON onboarding_reports FOR EACH ROW EXECUTE FUNCTION plat_onboarding_append_only();
CREATE TRIGGER onboarding_audit_events_append_only BEFORE UPDATE OR DELETE ON onboarding_audit_events FOR EACH ROW EXECUTE FUNCTION plat_onboarding_append_only();
