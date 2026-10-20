-- Reverse of 008_organizations_tenancy (development/staging only). Fails if a second organization reuses a
-- development slug (the global unique constraint cannot be restored): resolve that by hand first.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['lots', 'blocks', 'static_versions', 'sources', 'assets', 'analysis_versions', 'analysis_input_versions',
                           'price_tables', 'lot_availability', 'availability_history', 'import_runs']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_organization', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_org_development_fk');
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS organization_id', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS plat_organization_from_development();
DROP TRIGGER IF EXISTS developments_defaults ON developments;
DROP FUNCTION IF EXISTS plat_development_defaults();
ALTER TABLE developments DROP CONSTRAINT IF EXISTS developments_org_slug_key;
ALTER TABLE developments DROP CONSTRAINT IF EXISTS developments_org_id_key;
DROP INDEX IF EXISTS developments_org_visibility_idx;
ALTER TABLE developments ADD CONSTRAINT developments_slug_key UNIQUE (slug);
ALTER TABLE developments DROP COLUMN IF EXISTS visibility, DROP COLUMN IF EXISTS organization_id;
DROP TABLE IF EXISTS organization_domains;
DROP TABLE IF EXISTS organizations;
