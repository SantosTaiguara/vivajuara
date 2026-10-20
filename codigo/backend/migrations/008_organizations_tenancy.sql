-- 008_organizations_tenancy (topic 31): Organization (tenant), baseline organization "House 7 Imóveis",
-- organization_id on every tenant-owned table (add nullable → backfill → validate → NOT NULL → composite FK),
-- tenant-scoped development slug, development visibility (PUBLIC resources are explicit) and the domain registry
-- foundation. Strategy: shared database + shared schema + organization_id (docs/MULTI_TENANCY.md).
-- Inserts that omit organization_id get it from the owning development (trigger); an explicit value that does not
-- match the development's organization is rejected by the composite foreign key (no cross-tenant reference).
-- Reverse: migrations/down/008_organizations_tenancy.down.sql

-- ---------------------------------------------------------------- organizations
CREATE TABLE organizations (
  id                TEXT PRIMARY KEY CHECK (id ~ '^org_[a-z0-9_]{2,60}$'), -- stable, globally unique, opaque to clients
  slug              TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'), -- navigational only, never a security boundary
  display_name      TEXT NOT NULL,
  legal_name        TEXT NULL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIAL', 'SUSPENDED', 'DISABLED', 'ARCHIVED')),
  plan_code         TEXT NULL,                    -- future entitlements; never a permission
  legacy_tenant_key TEXT NULL UNIQUE,             -- explicit map of the legacy developments.tenant_id / config tenantId
  default_locale    TEXT NOT NULL DEFAULT 'pt-BR',
  default_timezone  TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  currency          TEXT NOT NULL DEFAULT 'BRL',
  settings          JSONB NOT NULL DEFAULT '{}'::jsonb, -- OrganizationSettings (no secrets)
  branding          JSONB NOT NULL DEFAULT '{}'::jsonb, -- OrganizationBranding foundation (tokens only, never raw CSS)
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Baseline organization: the current single-tenant operation (agency of reference). Its public panel is public,
-- so developments it creates default to PUBLIC visibility (explicit organization setting, not an implicit fallback).
INSERT INTO organizations (id, slug, display_name, legacy_tenant_key, settings)
VALUES ('org_house7', 'house-7', 'House 7 Imóveis', 'house7', '{"defaultDevelopmentVisibility": "PUBLIC"}'::jsonb);

-- OrganizationDomain foundation (subdomain/custom domain → organization). Not used for resolution yet.
CREATE TABLE organization_domains (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  hostname         TEXT NOT NULL UNIQUE CHECK (hostname ~ '^[a-z0-9.-]{3,253}$'),
  type             TEXT NOT NULL CHECK (type IN ('PLATFORM_SUBDOMAIN', 'CUSTOM_DOMAIN')),
  status           TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'DISABLED')),
  verified_at      TIMESTAMPTZ NULL,
  is_primary       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX organization_domains_org_idx ON organization_domains (organization_id);

-- ---------------------------------------------------------------- developments: owner + visibility
ALTER TABLE developments
  ADD COLUMN organization_id TEXT NULL REFERENCES organizations (id),
  ADD COLUMN visibility      TEXT NULL CHECK (visibility IN ('PUBLIC', 'PRIVATE'));

-- backfill: only through the explicit legacy map (tenant_id 'house7') or rows without tenant (single-tenant era)
UPDATE developments d SET organization_id = o.id
  FROM organizations o WHERE o.id = 'org_house7' AND (d.tenant_id IS NULL OR d.tenant_id = o.legacy_tenant_key);
-- every read of the existing (single-tenant) panel was public: keep it so
UPDATE developments SET visibility = 'PUBLIC' WHERE visibility IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM developments WHERE organization_id IS NULL) THEN
    RAISE EXCEPTION 'developments with an unknown tenant_id: map them to an organization before migrating (no automatic merge)';
  END IF;
END $$;

-- new developments: organization from the explicit legacy tenant key when omitted (fail closed when unknown),
-- visibility from the organization setting (PRIVATE unless the organization says otherwise)
CREATE FUNCTION plat_development_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.tenant_id IS NOT NULL THEN
    SELECT id INTO NEW.organization_id FROM organizations WHERE legacy_tenant_key = NEW.tenant_id;
  END IF;
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'development % has no organization (tenant_id % is not mapped)', NEW.id, NEW.tenant_id USING ERRCODE = '23502';
  END IF;
  IF NEW.visibility IS NULL THEN
    SELECT CASE WHEN settings->>'defaultDevelopmentVisibility' = 'PUBLIC' THEN 'PUBLIC' ELSE 'PRIVATE' END INTO NEW.visibility
      FROM organizations WHERE id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER developments_defaults BEFORE INSERT ON developments FOR EACH ROW EXECUTE FUNCTION plat_development_defaults();

ALTER TABLE developments ALTER COLUMN organization_id SET NOT NULL, ALTER COLUMN visibility SET NOT NULL;
ALTER TABLE developments ADD CONSTRAINT developments_org_id_key UNIQUE (organization_id, id); -- target of composite FKs
-- slug unique per organization (two organizations may both have "viva")
ALTER TABLE developments DROP CONSTRAINT developments_slug_key;
ALTER TABLE developments ADD CONSTRAINT developments_org_slug_key UNIQUE (organization_id, slug);
CREATE INDEX developments_org_visibility_idx ON developments (organization_id, visibility);

-- ---------------------------------------------------------------- tenant-owned tables
CREATE FUNCTION plat_organization_from_development() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.development_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM developments WHERE id = NEW.development_id;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lots', 'blocks', 'static_versions', 'sources', 'assets', 'analysis_versions', 'analysis_input_versions',
                           'price_tables', 'lot_availability', 'availability_history', 'import_runs']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN organization_id TEXT NULL', t);
    EXECUTE format('UPDATE %I x SET organization_id = d.organization_id FROM developments d WHERE d.id = x.development_id', t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN organization_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (organization_id, development_id) REFERENCES developments (organization_id, id)', t, t || '_org_development_fk');
    EXECUTE format('CREATE INDEX %I ON %I (organization_id, development_id)', t || '_org_development_idx', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION plat_organization_from_development()', t || '_organization', t);
  END LOOP;
END $$;
