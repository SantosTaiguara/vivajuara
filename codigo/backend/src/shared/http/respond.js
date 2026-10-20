'use strict';
/* Response writing: JSON (UTF-8), ETag revalidation (304), Cache-Control per data domain, brotli/gzip,
   and the v1 response envelope { data, meta } used by the endpoints added in contract 1.1. */
const zlib = require('zlib');
const { promisify } = require('util');
const { API_VERSION } = require('../contracts/schemas');
const gzip = promisify(zlib.gzip);
const brotli = promisify(zlib.brotliCompress);

/** Cache-Control per lifecycle domain (topic 7): static long, versioned per version, dynamic revalidated. */
const CACHE = Object.freeze({
  STATIC: 'public, max-age=86400, stale-while-revalidate=604800',
  VERSIONED: 'public, max-age=300, must-revalidate',
  DYNAMIC: 'no-cache',
  NONE: 'no-store',
  PRIVATE: 'private, no-store' // principal-specific representations (GET /me) and private developments
});

/** Weak ETag (the representation may be gzip-encoded). */
const etagOf = token => `W/"${token}"`;

function etagMatches(req, etag) {
  const h = req.headers['if-none-match'];
  if (!h || !etag) return false;
  if (h.trim() === '*') return true;
  const strip = t => t.trim().replace(/^W\//, '');
  return h.split(',').some(t => strip(t) === strip(etag));
}

/** true when Accept-Encoding lists `name` with q > 0 */
function accepts(header, name) {
  return String(header || '').split(',').some(part => {
    const [token, ...params] = part.trim().split(';').map(x => x.trim());
    if (token.toLowerCase() !== name) return false;
    const q = params.find(p => p.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
}

/** meta of the v1 envelope: apiVersion, requestId (= X-Request-Id), generatedAt (ISO 8601 UTC) + resource fields */
const metaOf = (requestId, extra = {}) => ({ apiVersion: API_VERSION, requestId, generatedAt: new Date().toISOString(), ...extra });
/** { data, meta } from a service result { data, meta } */
const envelope = (requestId, r) => ({ data: r.data, meta: metaOf(requestId, r.meta) });

async function sendJson(req, res, status, body, { etag = null, cache = CACHE.NONE, compression = true, headers = {} } = {}) {
  if (res.writableEnded || res.headersSent) return;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('Cache-Control', cache);
  if (etag) res.setHeader('ETag', etag);
  if (etag && status === 200 && etagMatches(req, etag)) { res.statusCode = 304; res.end(); return; }
  const payload = typeof body === 'function' ? await body() : body;
  if (res.writableEnded || res.headersSent) return; // request may have timed out while building the body
  let buf = Buffer.from(JSON.stringify(payload));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Vary', [res.getHeader('Vary'), 'Accept-Encoding'].filter(Boolean).join(', '));
  const ae = req.headers['accept-encoding'];
  if (compression && buf.length > 1024 && (accepts(ae, 'br') || accepts(ae, 'gzip'))) {
    const br = accepts(ae, 'br');
    buf = br ? await brotli(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }) : await gzip(buf);
    if (res.writableEnded || res.headersSent) return;
    res.setHeader('Content-Encoding', br ? 'br' : 'gzip');
  }
  res.setHeader('Content-Length', buf.length);
  res.statusCode = status;
  res.end(req.method === 'HEAD' ? undefined : buf);
}

module.exports = { CACHE, etagOf, etagMatches, sendJson, accepts, metaOf, envelope };
