'use strict';
/* Idempotency-Key for mutating routes (POST/PATCH marked { idempotent: true }).
   - The key is optional; when present it must match ^[A-Za-z0-9._:-]{8,128}$ (400 VALIDATION_ERROR otherwise).
   - Scope: (principal of the write token, key). The request hash covers method, path, canonical query and body.
   - Same key + same request (within IDEMPOTENCY_TTL_SECONDS, default 24 h) → the stored response is replayed
     byte for byte (same status, body and Location), with the header Idempotent-Replayed: true. The handler does
     not run again.
   - Same key + different request → 409 IDEMPOTENCY_KEY_REUSED; same key while the first execution is still
     running → 409 IDEMPOTENCY_REQUEST_IN_PROGRESS (Retry-After).
   - Only successful (2xx) responses are stored. A failed execution releases the key (nothing was committed),
     so the client can correct the request and retry. Expired keys are purged opportunistically. */
const crypto = require('crypto');
const repo = require('../db/idempotency.repository');
const { stableStringify } = require('../domain/checksum');
const { E } = require('./errors');
const { issue } = require('../validation');

const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const PURGE_EVERY_MS = 60 * 1000;
const REPLAYED_HEADERS = ['Location'];

function requestHash({ method, pathname, query, body }) {
  const q = [...query.entries()].sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return crypto.createHash('sha256').update(stableStringify({ method, pathname, query: q, body })).digest('hex');
}

function createIdempotency({ pool, config, logger }) {
  let lastPurge = 0;
  const staleSeconds = Math.max(30, Math.ceil((config.requestTimeoutMs * 2) / 1000));

  function keyOf(req) {
    const raw = req.headers['idempotency-key'];
    if (raw === undefined) return null;
    if (typeof raw !== 'string' || !KEY_RE.test(raw)) throw E.badRequest('Idempotency-Key inválida', [issue('Idempotency-Key', 'format', { expected: KEY_RE.source })]);
    return raw;
  }

  /**
   * handle({ req, url, routeTemplate, principal, requestId, readBody, execute, resolve })
   *   execute() → route output { status, body|build, headers, ... }; resolve(out) → final JSON payload.
   * Returns a route output whose body is the final payload (fresh or replayed).
   */
  async function handle({ req, url, routeTemplate, principal, requestId, readBody, execute, resolve }) {
    const key = keyOf(req);
    if (key == null) return null; // no header: normal execution
    const body = await readBody();
    const hash = requestHash({ method: req.method, pathname: url.pathname, query: url.searchParams, body });
    if (Date.now() - lastPurge > PURGE_EVERY_MS) {
      lastPurge = Date.now();
      repo.purgeExpired(pool).catch(e => logger.warn('idempotency purge failed', { errorCode: 'IDEMPOTENCY_PURGE_FAILED', detail: e.code || e.message }));
    }
    const claimed = await repo.claim(pool, { principal, key, method: req.method, route: routeTemplate, requestHash: hash, requestId, ttlSeconds: config.idempotencyTtlSeconds, staleSeconds });
    if (!claimed) {
      const rec = await repo.find(pool, principal, key);
      if (!rec) throw E.conflict('IDEMPOTENCY_REQUEST_IN_PROGRESS', 'Requisição com esta Idempotency-Key em andamento; tente novamente', { idempotencyKey: key });
      if (rec.request_hash !== hash) {
        throw E.conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key já usada com outra requisição; gere uma nova chave', { idempotencyKey: key, method: rec.method, route: rec.route, expiresAt: rec.expires_at.toISOString() });
      }
      if (rec.state !== 'COMPLETED') {
        const err = E.conflict('IDEMPOTENCY_REQUEST_IN_PROGRESS', 'Requisição com esta Idempotency-Key em andamento; tente novamente', { idempotencyKey: key });
        err.retryAfterSeconds = 1;
        throw err;
      }
      const headers = { ...(rec.response_headers || {}), 'Idempotent-Replayed': 'true' };
      return { status: rec.status_code, body: JSON.parse(rec.response_body), headers, cache: 'no-store', replayed: true };
    }
    let out, payload;
    try {
      out = await execute();
      payload = await resolve(out);
    } catch (e) {
      await repo.release(pool, principal, key).catch(() => {});
      throw e;
    }
    if (out.status >= 200 && out.status < 300) {
      const headers = Object.fromEntries(Object.entries(out.headers || {}).filter(([k]) => REPLAYED_HEADERS.includes(k)));
      try { await repo.complete(pool, principal, key, { statusCode: out.status, body: JSON.stringify(payload), headers }); }
      catch (e) { logger.error('idempotency record not stored', { requestId, errorCode: 'IDEMPOTENCY_STORE_FAILED', detail: e.code || e.message }); }
    } else await repo.release(pool, principal, key).catch(() => {});
    return { ...out, build: undefined, body: payload, schema: undefined };
  }

  return { handle, keyOf };
}

module.exports = { createIdempotency, requestHash, KEY_RE };
