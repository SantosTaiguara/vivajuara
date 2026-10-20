'use strict';
/* docs/openapi.json is generated from code (npm run openapi) and must never drift from it:
   same file as a fresh render, every registered route documented and vice versa, every $ref resolvable,
   every documented error code in the catalog with a matching status, and the Markdown docs in step. No database needed. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

const DOCS = path.join(h.BACKEND, 'docs');
const { render, FILE } = require(path.join(h.BACKEND, 'scripts/openapi'));
const { createApp } = require(path.join(h.BACKEND, 'src/app'));
const { ERROR_CATALOG } = require(path.join(h.BACKEND, 'src/shared/http/errors'));
const { buildSchemas, CONTRACT_VERSION } = require(path.join(h.BACKEND, 'src/shared/contracts/schemas'));
const { createLogger } = require(path.join(h.BACKEND, 'src/shared/logging/logger'));

const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const toOpenApiPath = template => template.replace(/:([A-Za-z]+)/g, '{$1}');

function registeredRoutes() {
  const pool = { query: async () => { throw new Error('no database in this test'); }, on() {}, end: async () => {} };
  const config = h.testConfig('postgres://unused@127.0.0.1:1/none');
  const app = createApp({ config, pool, logger: createLogger({ level: 'silent' }), App: h.sharedApp() });
  app.close();
  return app.router.routes.map(r => `${r.method.toLowerCase()} ${toOpenApiPath(r.template)}`).sort();
}

test('docs/openapi.json is valid JSON, OpenAPI 3.0, and identical to a fresh render (npm run openapi)', () => {
  assert.match(doc.openapi, /^3\.0\.\d+$/);
  assert.equal(doc.info.version, CONTRACT_VERSION);
  assert.equal(render(), fs.readFileSync(FILE, 'utf8'), 'docs/openapi.json is out of date: run `npm run openapi` in backend/');
  assert.equal(render(), render(), 'render is deterministic');
});

test('every registered route is documented, and every documented operation exists', () => {
  const routes = registeredRoutes();
  const documented = Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).filter(m => METHODS.includes(m)).map(m => `${m} ${p}`)).sort();
  assert.deepEqual(routes.filter(r => !documented.includes(r)), [], 'routes missing in openapi.json');
  assert.deepEqual(documented.filter(r => !routes.includes(r)), [], 'documented operations without a route');
  // path parameters declared for each templated segment
  for (const [p, ops] of Object.entries(doc.paths)) {
    const names = [...p.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
    for (const [m, op] of Object.entries(ops)) {
      if (!METHODS.includes(m)) continue;
      const declared = (op.parameters || []).map(x => (x.$ref ? doc.components.parameters[x.$ref.split('/').pop()] : x)).filter(x => x && x.in === 'path').map(x => x.name);
      assert.deepEqual(declared.sort(), [...names].sort(), `${m} ${p} path parameters`);
      assert.ok(op.responses && Object.keys(op.responses).some(s => /^[23]\d\d$/.test(s)), `${m} ${p} has a success response`);
    }
  }
});

test('every $ref resolves; every DTO schema from the code is published', () => {
  const missing = [];
  const walk = (node, at) => {
    if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${at}[${i}]`));
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      const target = node.$ref.replace(/^#\//, '').split('/').reduce((o, k) => (o == null ? o : o[k]), doc);
      if (target === undefined) missing.push(`${at}: ${node.$ref}`);
    }
    for (const [k, v] of Object.entries(node)) walk(v, `${at}.${k}`);
  };
  walk(doc, '#');
  assert.deepEqual(missing, []);
  const code = buildSchemas(h.sharedApp());
  for (const name of Object.keys(code)) assert.deepEqual(doc.components.schemas[name], JSON.parse(JSON.stringify(code[name])), `schema ${name} differs from code`);
});

test('documented error codes exist in the catalog with a matching status; the catalog is published', () => {
  for (const [p, ops] of Object.entries(doc.paths)) {
    for (const [m, op] of Object.entries(ops)) {
      if (!METHODS.includes(m)) continue;
      for (const [status, r] of Object.entries(op.responses)) {
        if (Number(status) < 400) continue;
        const ref = r.content && r.content['application/json'].schema.$ref;
        assert.equal(ref, '#/components/schemas/ApiError', `${m} ${p} ${status} uses ApiError`);
        for (const code of r.description.split(',').map(s => s.trim())) {
          assert.ok(ERROR_CATALOG[code], `${m} ${p} ${status}: ${code} not in ERROR_CATALOG`);
          assert.ok([].concat(ERROR_CATALOG[code].status).includes(Number(status)), `${m} ${p}: ${code} documented as ${status}, catalog ${ERROR_CATALOG[code].status}`);
        }
        if (status === '429' || status === '503') assert.ok(r.headers['Retry-After'], `${m} ${p} ${status} documents Retry-After`);
      }
    }
  }
  assert.deepEqual(Object.keys(doc['x-error-catalog']).sort(), Object.keys(ERROR_CATALOG).sort());
  const apiError = doc.components.schemas.ApiError;
  for (const k of ['code', 'message', 'details', 'requestId', 'timestamp', 'traceId']) assert.ok(apiError.properties[k], `ApiError.${k}`);
});

test('Markdown docs: API_ERRORS lists every catalog code, CHANGELOG has the current version, ARCHITECTURE exists; no secrets', () => {
  const errors = fs.readFileSync(path.join(DOCS, 'API_ERRORS.md'), 'utf8');
  for (const code of Object.keys(ERROR_CATALOG)) assert.ok(errors.includes('`' + code + '`'), `API_ERRORS.md misses ${code}`);
  const changelog = fs.readFileSync(path.join(DOCS, 'API_CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes(CONTRACT_VERSION), `API_CHANGELOG.md misses ${CONTRACT_VERSION}`);
  const arch = fs.readFileSync(path.join(DOCS, 'API_ARCHITECTURE.md'), 'utf8');
  for (const p of Object.keys(doc.paths)) assert.ok(arch.includes(p.replace('/api/v1', '')), `API_ARCHITECTURE.md misses ${p}`);
  const SECRET = /(postgres(ql)?:\/\/[^\s:@/]+:[^\s@/]+@)|(api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9]{16,})|(BEGIN [A-Z ]*PRIVATE KEY)/i;
  for (const f of ['API_ERRORS.md', 'API_CHANGELOG.md', 'API_ARCHITECTURE.md', 'openapi.json']) assert.ok(!SECRET.test(fs.readFileSync(path.join(DOCS, f), 'utf8')), `${f} looks like it contains a secret`);
});
