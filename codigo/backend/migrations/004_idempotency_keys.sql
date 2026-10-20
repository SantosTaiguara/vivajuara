-- 004_idempotency_keys: Idempotency-Key records of write requests (POST/PATCH). One row per (principal, key):
-- request hash + final response, kept until expires_at (IDEMPOTENCY_TTL_SECONDS, default 24 h).
-- The response is stored as JSON text so a replay is byte-identical. Never stores credentials.
-- Reverse: migrations/down/004_idempotency_keys.down.sql
CREATE TABLE idempotency_keys (
  principal        TEXT NOT NULL,                 -- actor of the write token ("admin"), never the token itself
  key              TEXT NOT NULL CHECK (key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  method           TEXT NOT NULL,
  route            TEXT NOT NULL,                 -- route template (no ids)
  request_hash     TEXT NOT NULL,                 -- sha256 over method, path, canonical query and body
  state            TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (state IN ('IN_PROGRESS', 'COMPLETED')),
  status_code      INTEGER NULL,
  response_body    TEXT NULL,
  response_headers JSONB NULL,
  request_id       TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (principal, key),
  CHECK (state = 'IN_PROGRESS' OR (status_code IS NOT NULL AND response_body IS NOT NULL))
);
CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);
