-- 001_initial_schema: V2 schema (read-first). Hybrid model: structural columns are
-- indexed, extensible data lives in validated JSONB. Polygons are JSONB (GeoJSON
-- Polygon in plan units) until PostGIS is available: see docs/BACKEND_ARCHITECTURE.md.
-- Reverse: migrations/down/001_initial_schema.down.sql (development/staging only).

-- ---------------------------------------------------------------- developments
CREATE TABLE developments (
  id                          TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  tenant_id                   TEXT NULL,               -- multi-tenant ready; no tenant is hardcoded
  code                        TEXT NOT NULL,           -- short code used in lot ids (e.g. VJ)
  name                        TEXT NOT NULL,
  slug                        TEXT NOT NULL UNIQUE,
  status                      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  currency                    TEXT NOT NULL DEFAULT 'BRL',
  locale                      TEXT NOT NULL DEFAULT 'pt-BR',
  config                      JSONB NOT NULL DEFAULT '{}'::jsonb, -- map frame, POIs, policies, features (no secrets)
  current_static_version      TEXT NULL,
  current_analysis_version_id UUID NULL,
  current_price_table_id      TEXT NULL,
  availability_revision       BIGINT NOT NULL DEFAULT 0 CHECK (availability_revision >= 0),
  availability_updated_at     TIMESTAMPTZ NULL,
  availability_source_id      TEXT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX developments_tenant_idx ON developments (tenant_id);

-- ---------------------------------------------------------------- assets (metadata only; binaries stay in object storage)
CREATE TABLE assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  development_id TEXT NOT NULL REFERENCES developments (id),
  key            TEXT NOT NULL,      -- logical key (plan, aerial, logo, lots, routes, images)
  type           TEXT NOT NULL CHECK (type IN ('OFFICIAL_PLAN', 'AERIAL_IMAGE', 'KMZ', 'PDF', 'MARKETING_PLAN', 'VIDEO', 'LOGO', 'DATASET', 'OTHER')),
  storage_key    TEXT NOT NULL,      -- object storage key, never a local path
  content_type   TEXT NULL,
  size_bytes     BIGINT NULL CHECK (size_bytes IS NULL OR size_bytes >= 0),
  version        TEXT NOT NULL,
  checksum       TEXT NULL,          -- sha256 of the binary
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (development_id, key, version)
);
CREATE INDEX assets_development_idx ON assets (development_id);

-- ---------------------------------------------------------------- sources (provenance references)
CREATE TABLE sources (
  development_id TEXT NOT NULL REFERENCES developments (id),
  id             TEXT NOT NULL,
  type           TEXT NOT NULL,
  name           TEXT NOT NULL,
  version        TEXT NULL,
  source_date    DATE NULL,
  precision      TEXT NULL,
  description    TEXT NULL,
  asset_id       UUID NULL REFERENCES assets (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (development_id, id)
);

-- ---------------------------------------------------------------- static data (structural, versioned by staticDataVersion)
CREATE TABLE static_versions (
  development_id        TEXT NOT NULL REFERENCES developments (id),
  version               TEXT NOT NULL,
  schema_version        TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  checksum              TEXT NOT NULL,   -- sha256 over all lot checksums of the version
  lot_count             INTEGER NOT NULL CHECK (lot_count >= 0),
  source_file_checksum  TEXT NULL,       -- sha256 of the imported file (backup reference)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (development_id, version)
);

CREATE TABLE blocks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  development_id TEXT NOT NULL REFERENCES developments (id),
  code           TEXT NOT NULL,      -- block id as used in lot ids (A, B, ...)
  number         INTEGER NULL,
  name           TEXT NOT NULL,
  UNIQUE (development_id, code)
);
CREATE INDEX blocks_development_idx ON blocks (development_id);

CREATE TABLE lots (
  id                TEXT PRIMARY KEY CHECK (id ~ '^[A-Z0-9]+-Q[A-Z0-9]+-L[0-9]{4}$'),
  development_id    TEXT NOT NULL REFERENCES developments (id),
  block_id          UUID NOT NULL REFERENCES blocks (id),
  code              TEXT NOT NULL,                 -- short code (B79)
  lot_number        INTEGER NOT NULL CHECK (lot_number > 0),
  area_m2           NUMERIC(12, 2) NOT NULL CHECK (area_m2 > 0),
  latitude          DOUBLE PRECISION NULL,
  longitude         DOUBLE PRECISION NULL,
  static_version    TEXT NOT NULL,
  static            JSONB NOT NULL,                -- static layer of the canonical Lot, without the polygon
  geometry          JSONB NOT NULL CHECK (geometry->>'type' = 'Polygon'), -- GeoJSON Polygon, plan units, full precision
  checksum          TEXT NOT NULL,                 -- sha256 of the full static partial (stable JSON)
  geometry_checksum TEXT NOT NULL,                 -- sha256 of the polygon
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (development_id, code),
  FOREIGN KEY (development_id, static_version) REFERENCES static_versions (development_id, version)
);
CREATE INDEX lots_development_idx ON lots (development_id);
CREATE INDEX lots_block_idx ON lots (block_id);
CREATE INDEX lots_development_area_idx ON lots (development_id, area_m2);

-- ---------------------------------------------------------------- analysis (versioned; never overwritten once published)
CREATE TABLE analysis_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  development_id      TEXT NOT NULL REFERENCES developments (id),
  version             TEXT NOT NULL,
  generated_at        TIMESTAMPTZ NULL,
  methodology_version TEXT NULL,
  source_id           TEXT NULL,
  status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  checksum            TEXT NOT NULL,
  lot_count           INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at        TIMESTAMPTZ NULL,
  UNIQUE (development_id, version)
);
CREATE INDEX analysis_versions_development_idx ON analysis_versions (development_id, status);

CREATE TABLE lot_analysis (
  analysis_version_id UUID NOT NULL REFERENCES analysis_versions (id),
  lot_id              TEXT NOT NULL REFERENCES lots (id),
  class               TEXT NULL,
  overall_score       NUMERIC(5, 2) NULL,
  data                JSONB NOT NULL,   -- analysis layer: scores, class, rankings, alerts, highlights, environmental, mobility
  checksum            TEXT NOT NULL,
  PRIMARY KEY (analysis_version_id, lot_id)
);
CREATE INDEX lot_analysis_lot_idx ON lot_analysis (lot_id);
CREATE INDEX lot_analysis_class_idx ON lot_analysis (analysis_version_id, class);

-- ---------------------------------------------------------------- commercial (price tables are versioned and applied atomically)
CREATE TABLE price_tables (
  id                  TEXT PRIMARY KEY,
  development_id      TEXT NOT NULL REFERENCES developments (id),
  version             TEXT NOT NULL,
  name                TEXT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'BRL',
  price_per_m2        NUMERIC(14, 2) NOT NULL CHECK (price_per_m2 >= 0),
  down_payment_default NUMERIC(6, 4) NOT NULL CHECK (down_payment_default >= 0 AND down_payment_default <= 1),
  valid_from          DATE NULL,
  valid_until         DATE NULL,
  status              TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  source_id           TEXT NULL,
  issued_on           DATE NULL,        -- business date of the table (config createdAt)
  revision            INTEGER NOT NULL DEFAULT 1,
  checksum            TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at        TIMESTAMPTZ NULL,
  UNIQUE (development_id, version),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX price_tables_development_idx ON price_tables (development_id, status);

CREATE TABLE payment_plans (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_table_id       TEXT NOT NULL REFERENCES price_tables (id),
  code                 TEXT NOT NULL,
  position             INTEGER NOT NULL,
  name                 TEXT NOT NULL,
  type                 TEXT NOT NULL,      -- PRICE, PRICE_ANNUAL, INSTALLMENTS
  down_payment_percent NUMERIC(6, 3) NULL,
  installments         INTEGER NULL,
  monthly_rate         NUMERIC(10, 6) NULL,
  annual_payments      INTEGER NULL,
  discount_percent     NUMERIC(6, 3) NULL,
  rules                JSONB NOT NULL,     -- full plan definition as used by the finance service (lossless)
  UNIQUE (price_table_id, code)
);
CREATE INDEX payment_plans_table_idx ON payment_plans (price_table_id);

CREATE TABLE lot_prices (
  price_table_id TEXT NOT NULL REFERENCES price_tables (id),
  lot_id         TEXT NOT NULL REFERENCES lots (id),
  amount         NUMERIC(14, 2) NULL CHECK (amount IS NULL OR amount >= 0),
  currency       TEXT NOT NULL DEFAULT 'BRL',
  price_per_m2   NUMERIC(14, 2) NULL,
  discount_rules JSONB NULL,
  metadata       JSONB NOT NULL,           -- commercial layer of the canonical Lot
  checksum       TEXT NOT NULL,
  PRIMARY KEY (price_table_id, lot_id)
);
CREATE INDEX lot_prices_lot_idx ON lot_prices (lot_id);

-- ---------------------------------------------------------------- availability (dynamic; optimistic concurrency by revision)
CREATE TABLE lot_availability (
  lot_id         TEXT PRIMARY KEY REFERENCES lots (id),
  development_id TEXT NOT NULL REFERENCES developments (id),
  status         TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (status IN ('AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN')),
  revision       BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at     TIMESTAMPTZ NULL,         -- business timestamp of the status
  source_id      TEXT NULL,
  reserved_until TIMESTAMPTZ NULL,
  proposal_id    TEXT NULL,
  reason         TEXT NULL CHECK (reason IS NULL OR reason IN ('TECHNICAL_REVIEW', 'COMMERCIAL_HOLD', 'LEGAL_HOLD', 'INTERNAL_BLOCK', 'NOT_RELEASED', 'DATA_VALIDATION', 'OTHER')),
  notes          TEXT NULL,
  provenance     JSONB NULL,
  row_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reserved_until IS NULL OR status = 'RESERVED'),
  CHECK (proposal_id IS NULL OR status = 'PROPOSAL')
);
CREATE INDEX lot_availability_status_idx ON lot_availability (status);
CREATE INDEX lot_availability_development_status_idx ON lot_availability (development_id, status);

CREATE TABLE availability_history (
  id             BIGSERIAL PRIMARY KEY,
  development_id TEXT NOT NULL REFERENCES developments (id),
  lot_id         TEXT NOT NULL REFERENCES lots (id),
  from_status    TEXT NOT NULL,
  to_status      TEXT NOT NULL,
  revision       BIGINT NOT NULL,
  changed_at     TIMESTAMPTZ NOT NULL,
  source_id      TEXT NULL,
  reason         TEXT NULL,
  reserved_until TIMESTAMPTZ NULL,
  proposal_id    TEXT NULL,
  notes          TEXT NULL,
  request_id     TEXT NULL
);
CREATE INDEX availability_history_lot_idx ON availability_history (lot_id, changed_at DESC);

-- ---------------------------------------------------------------- audit (prepared; actor_id stays NULL until users exist)
CREATE TABLE audit_log (
  id             BIGSERIAL PRIMARY KEY,
  actor_id       TEXT NULL,
  action         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  development_id TEXT NULL REFERENCES developments (id),
  old_value      JSONB NULL,
  new_value      JSONB NULL,
  request_id     TEXT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_created_idx ON audit_log (created_at);

-- ---------------------------------------------------------------- current-version pointers
ALTER TABLE developments
  ADD CONSTRAINT developments_current_analysis_fk FOREIGN KEY (current_analysis_version_id) REFERENCES analysis_versions (id),
  ADD CONSTRAINT developments_current_price_table_fk FOREIGN KEY (current_price_table_id) REFERENCES price_tables (id),
  ADD CONSTRAINT developments_current_static_fk FOREIGN KEY (id, current_static_version) REFERENCES static_versions (development_id, version);
