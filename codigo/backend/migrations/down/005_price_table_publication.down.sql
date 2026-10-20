-- Reverse of 005_price_table_publication (development/staging only). Tables priced only per lot get 0 as
-- table-level price per m² so the NOT NULL constraint can be restored.
ALTER TABLE price_tables DROP COLUMN IF EXISTS pricing_mode, DROP COLUMN IF EXISTS change_reason, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS published_by;
UPDATE price_tables SET price_per_m2 = 0 WHERE price_per_m2 IS NULL;
ALTER TABLE price_tables ALTER COLUMN price_per_m2 SET NOT NULL;
