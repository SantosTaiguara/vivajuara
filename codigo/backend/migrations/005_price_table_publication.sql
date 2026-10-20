-- 005_price_table_publication: publication of new price table versions through the API
-- (POST /api/v1/developments/{id}/price-tables). Who/when published, when a table stopped being current,
-- and tables priced per lot (no single price per m²). Existing rows are not changed.
-- Reverse: migrations/down/005_price_table_publication.down.sql
ALTER TABLE price_tables ALTER COLUMN price_per_m2 DROP NOT NULL;
ALTER TABLE price_tables
  ADD COLUMN published_by  TEXT NULL,             -- actor of the write token ("admin"); NULL for imported tables
  ADD COLUMN archived_at   TIMESTAMPTZ NULL,      -- when a newer table became current
  ADD COLUMN change_reason TEXT NULL,
  ADD COLUMN pricing_mode  TEXT NOT NULL DEFAULT 'PER_M2' CHECK (pricing_mode IN ('PER_M2', 'PER_LOT', 'MIXED'));
