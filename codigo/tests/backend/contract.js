'use strict';
/* Contract-test helpers: validate live responses against docs/openapi.json (components.schemas),
   count SQL statements per request (N+1 checks) and assert the ApiError shape. */
const assert = require('node:assert/strict');
const path = require('path');
const h = require('./helpers');
const { validate } = require(path.join(h.BACKEND, 'src/shared/validation/schema'));

let spec = null;
const openapi = () => (spec = spec || h.readJson(path.join(h.BACKEND, 'docs', 'openapi.json')));

/** asserts that `body` matches components.schemas[name] of docs/openapi.json */
function assertSchema(body, name) {
  const schemas = openapi().components.schemas;
  assert.ok(schemas[name], `schema ${name} missing in openapi.json`);
  const errors = validate(body, schemas[name], schemas);
  assert.deepEqual(errors, [], `${name}: ${JSON.stringify(errors.slice(0, 5))}`);
}

const STACK_RE = /\bat [^\s]+ \(?[^\s]*\.js:\d+/;
/** ApiError { code, message, details, requestId, traceId, timestamp } + documented schema, no internals */
function assertApiError(res, body, status, code) {
  assert.equal(res.status, status, JSON.stringify(body));
  assert.equal(body.code, code, JSON.stringify(body));
  assertSchema(body, 'ApiError');
  assert.equal(body.requestId, res.headers.get('x-request-id'));
  assert.equal(body.traceId, body.requestId);
  assert.ok(body.timestamp.endsWith('Z'));
  const text = JSON.stringify(body);
  assert.ok(!STACK_RE.test(text), 'stack trace leaked');
  assert.ok(!/node_modules|\/src\/|SELECT |INSERT |postgres|pg_|syntax error/i.test(text), `internal detail leaked: ${text.slice(0, 200)}`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('etag'), null);
}

/** pg Pool wrapper that counts statements (the server receives it as its pool) */
function countingPool(pool) {
  const counter = { n: 0, statements: [] };
  const wrapped = {
    query: (...a) => { counter.n++; counter.statements.push(String(typeof a[0] === 'string' ? a[0] : a[0].text).replace(/\s+/g, ' ').slice(0, 80)); return pool.query(...a); },
    connect: (...a) => pool.connect(...a),
    on: (...a) => pool.on(...a),
    end: async () => {}
  };
  return { pool: wrapped, counter, reset: () => { counter.n = 0; counter.statements = []; } };
}

module.exports = { openapi, assertSchema, assertApiError, countingPool, validate };
