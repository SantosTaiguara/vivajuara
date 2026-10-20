-- 003_sources_position: keep the editorial order of sources (as listed in the development config).
-- Reverse: migrations/down/003_sources_position.down.sql
ALTER TABLE sources ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
