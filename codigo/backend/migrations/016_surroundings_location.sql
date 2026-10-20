-- 016_surroundings_location (topic 63 — Google Maps, Entorno e raio máximo de 8 km).
-- Versioned official development center + its change workflow + Google Place ID references.
-- Provider-content policy: ONLY Place IDs are persisted (Google Maps Platform exempts Place IDs from caching restrictions).
-- No place name, coordinate, address, rating, review, route or ETA from Google is stored anywhere.
-- No row is seeded: the official Viva Juara coordinate is not validated yet and is never invented.
-- Reverse: migrations/down/016_surroundings_location.down.sql

-- DevelopmentLocationConfig versions. Exactly one current row per (organization, development).
CREATE TABLE development_locations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     TEXT NOT NULL REFERENCES organizations (id),
  development_id      TEXT NOT NULL REFERENCES developments (id),
  version             TEXT NOT NULL CHECK (version ~ '^loc-[0-9]{1,9}$'),
  latitude            NUMERIC(11, 8) NULL CHECK (latitude BETWEEN -90 AND 90),      -- full precision, not rounded (§491)
  longitude           NUMERIC(12, 8) NULL CHECK (longitude BETWEEN -180 AND 180),
  max_radius_m        INTEGER NOT NULL CHECK (max_radius_m > 0 AND max_radius_m <= 8000), -- product max (§332)
  location_status     TEXT NOT NULL CHECK (location_status IN ('UNVERIFIED', 'VALIDATED', 'REJECTED')),
  source_ref          TEXT NULL,
  validation_method   TEXT NULL CHECK (validation_method IS NULL OR validation_method IN ('OFFICIAL_GEOREFERENCE', 'OFFICIAL_KML_KMZ', 'OFFICIAL_COORDINATE', 'MANUAL_CONFIRMED', 'GEOCODED_AND_CONFIRMED')),
  validated_by        TEXT NULL,
  validated_at        TIMESTAMPTZ NULL,
  google_maps_enabled BOOLEAN NOT NULL DEFAULT false,
  change_id           UUID NULL,
  is_current          BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, development_id, version),
  -- a VALIDATED center always has coordinates and provenance (LI-DQ-001)
  CHECK (location_status <> 'VALIDATED' OR (latitude IS NOT NULL AND longitude IS NOT NULL AND source_ref IS NOT NULL AND validation_method IS NOT NULL AND validated_by IS NOT NULL AND validated_at IS NOT NULL))
);
CREATE UNIQUE INDEX development_locations_current_idx ON development_locations (organization_id, development_id) WHERE is_current;

-- DevelopmentLocationChange: DRAFT → REVIEW → APPROVED → PUBLISHED (audited; preview mandatory before approval).
CREATE TABLE development_location_changes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      TEXT NOT NULL REFERENCES organizations (id),
  development_id       TEXT NOT NULL REFERENCES developments (id),
  previous_latitude    NUMERIC(11, 8) NULL,
  previous_longitude   NUMERIC(12, 8) NULL,
  proposed_latitude    NUMERIC(11, 8) NOT NULL CHECK (proposed_latitude BETWEEN -90 AND 90),
  proposed_longitude   NUMERIC(12, 8) NOT NULL CHECK (proposed_longitude BETWEEN -180 AND 180),
  source_ref           TEXT NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 500),
  reason               TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  validation_method    TEXT NOT NULL CHECK (validation_method IN ('OFFICIAL_GEOREFERENCE', 'OFFICIAL_KML_KMZ', 'OFFICIAL_COORDINATE', 'MANUAL_CONFIRMED', 'GEOCODED_AND_CONFIRMED')),
  requested_by         TEXT NOT NULL,
  approved_by          TEXT NULL,
  preview_confirmed_by TEXT NULL,
  status               TEXT NOT NULL CHECK (status IN ('DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED')),
  base_version         TEXT NOT NULL,
  published_version    TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status NOT IN ('APPROVED', 'PUBLISHED') OR (approved_by IS NOT NULL AND preview_confirmed_by IS NOT NULL)),
  CHECK ((status = 'PUBLISHED') = (published_version IS NOT NULL))
);
CREATE INDEX development_location_changes_dev_idx ON development_location_changes (organization_id, development_id, status);

-- Place ID references (PLACE_ID_ONLY): which Place IDs a search of this development returned inside the circle, so a
-- route estimate can only target an in-scope destination (LI-DQ-007). Partitioned by organization and location version.
CREATE TABLE surroundings_place_refs (
  organization_id   TEXT NOT NULL REFERENCES organizations (id),
  development_id    TEXT NOT NULL REFERENCES developments (id),
  location_version  TEXT NOT NULL,
  provider          TEXT NOT NULL CHECK (provider IN ('GOOGLE')),
  provider_place_id TEXT NOT NULL CHECK (provider_place_id ~ '^[A-Za-z0-9_-]{10,300}$'),
  category_code     TEXT NOT NULL CHECK (category_code ~ '^[A-Z][A-Z_]{1,40}$'),
  within_max_radius BOOLEAN NOT NULL,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, development_id, location_version, provider_place_id)
);
