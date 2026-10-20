'use strict';
/* IdempotencyRepository: Idempotency-Key records of write requests (migration 004). SQL only.
   A key is scoped by principal (the authenticated actor) and stores the request hash and the final
   response (status, headers, JSON text) so that a retry gets the very same answer. */

/**
 * Claims (principal, key) for a new execution. Succeeds when the key is new, expired, or an abandoned
 * IN_PROGRESS record older than staleSeconds (the process died before completing it). Returns true when claimed.
 */
async function claim(db, r) {
  const { rows } = await db.query(
    `INSERT INTO idempotency_keys (principal, key, method, route, request_hash, request_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7))
     ON CONFLICT (principal, key) DO UPDATE SET method = EXCLUDED.method, route = EXCLUDED.route, request_hash = EXCLUDED.request_hash,
       state = 'IN_PROGRESS', status_code = NULL, response_body = NULL, response_headers = NULL, request_id = EXCLUDED.request_id,
       created_at = now(), completed_at = NULL, expires_at = EXCLUDED.expires_at
     WHERE idempotency_keys.expires_at <= now()
        OR (idempotency_keys.state = 'IN_PROGRESS' AND idempotency_keys.created_at < now() - make_interval(secs => $8))
     RETURNING key`,
    [r.principal, r.key, r.method, r.route, r.requestHash, r.requestId, r.ttlSeconds, r.staleSeconds]);
  return rows.length === 1;
}

async function find(db, principal, key) {
  const { rows } = await db.query(
    `SELECT principal, key, method, route, request_hash, state, status_code, response_body, response_headers, created_at, expires_at
       FROM idempotency_keys WHERE principal = $1 AND key = $2`, [principal, key]);
  return rows[0] || null;
}

async function complete(db, principal, key, { statusCode, body, headers }) {
  await db.query(
    `UPDATE idempotency_keys SET state = 'COMPLETED', status_code = $3, response_body = $4, response_headers = $5::jsonb, completed_at = now()
      WHERE principal = $1 AND key = $2 AND state = 'IN_PROGRESS'`,
    [principal, key, statusCode, body, JSON.stringify(headers || {})]);
}

/** Frees a key whose execution failed (nothing was committed): the client may retry, even with another body. */
async function release(db, principal, key) {
  await db.query(`DELETE FROM idempotency_keys WHERE principal = $1 AND key = $2 AND state = 'IN_PROGRESS'`, [principal, key]);
}

async function purgeExpired(db) {
  const { rowCount } = await db.query('DELETE FROM idempotency_keys WHERE expires_at <= now()');
  return rowCount;
}

module.exports = { claim, find, complete, release, purgeExpired };
