'use strict';
/* Round-5 wiring (topics 57, 58, 59, 60, 61, 63) — DB-FREE.
   1. IAM snapshot: every pre-existing role is byte-identical to the pre-round-5 code (fixtures/iamRoleSnapshot.pre_r5.json,
      generated before any change); OWNER_ADMIN = its old set + exactly the round-5 keys (decision 2026-10-18, Edmilson);
      no other role holds a round-5 key; /iam/registry DTO and SYSTEM effective keys unchanged with every flag off.
   2. Flags off: same route list and same OpenAPI (paths/components/info/tags) as before (fixtures/apiSurface.pre_r5.json);
      no deals expiry job.
   3. Flags on: every new route exists; anonymous → 401, other roles → 403 PERMISSION_DENIED, ADMIN_API_TOKEN → 403,
      OWNER_ADMIN passes the permission gate (the module may still refuse on its own policies / missing database).
   Fake pool: answers the dev-token, membership, organization and development-owner lookups; everything else is
   ECONNREFUSED (→ 503 DATABASE_UNAVAILABLE). Nothing talks to Postgres or Google. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { loadConfig } = require('../src/shared/config');
const { createApp } = require('../src/app');
const { createAppContext } = require('../src/shared/domain/sharedDomain');
const { createLogger } = require('../src/shared/logging/logger');
const { newDevToken } = require('../src/modules/iam/authentication');
const reg = require('../src/modules/iam/permissions');
const authz = require('../src/modules/iam/authorization');
const round5 = require('../src/modules/iam/round5');
const roleGrants = require('../src/modules/iam/roleGrants');
const { ERROR_CATALOG } = require('../src/shared/http/errors');
const { render, renderFeatures } = require('../scripts/openapi');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const App = createAppContext({ srcDir: SRC });
const SNAP = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'iamRoleSnapshot.pre_r5.json'), 'utf8'));
const SURFACE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'apiSurface.pre_r5.json'), 'utf8'));
const ADMIN = 'test-admin-token-0123456789abcdef0123456789';
const ORG = 'org_house7';
const ALL_ON = { FEATURE_DEALS: '1', FEATURE_ONBOARDING: '1', FEATURE_PRIVACY: '1', FEATURE_BACKOFFICE: '1', FEATURE_DATA_QUALITY: '1', FEATURE_SURROUNDINGS: '1' };
const R5 = new Set(round5.ROUND5_KEYS);
const toOpenApi = t => t.replace(/:([A-Za-z]+)/g, '{$1}');

// ------------------------------------------------------------------------------------------ 1. IAM snapshot
test('pre-existing roles are byte-identical; OWNER_ADMIN = old set + every round-5 key (decision 2026-10-18); no other role holds a round-5 key', () => {
  assert.deepEqual(reg.validateRegistry(), []);
  assert.deepEqual(Object.keys(reg.ROLES), Object.keys(SNAP.roles), 'same role codes, same order');
  for (const [role, keys] of Object.entries(SNAP.roles)) {
    if (role === 'OWNER_ADMIN') continue;
    assert.equal(JSON.stringify(reg.ROLES[role]), JSON.stringify(keys), `${role} byte-identical`);
    assert.ok(!reg.ROLES[role].some(k => R5.has(k)), `${role} holds no round-5 key`);
  }
  const owner = reg.ROLES.OWNER_ADMIN;
  assert.equal(JSON.stringify(owner.filter(k => !R5.has(k))), JSON.stringify(SNAP.roles.OWNER_ADMIN), 'OWNER_ADMIN pre-existing part unchanged');
  assert.deepEqual([...owner.filter(k => R5.has(k))].sort(), [...R5].sort(), 'OWNER_ADMIN holds exactly the round-5 keys in addition');
  assert.equal(owner.includes('platform.cross_tenant'), false);
  assert.deepEqual(Object.keys(reg.TEMPLATE_EXPLICIT_HOLDERS), ['OWNER_ADMIN']);
  assert.equal(reg.TEMPLATE_EXPLICIT_HOLDERS.OWNER_ADMIN.decidedOn, '2026-10-18');
  // registry / public / SYSTEM views unchanged
  assert.equal(reg.POLICY_VERSION, SNAP.policyVersion);
  assert.deepEqual([...reg.KEYS], SNAP.keys);
  assert.deepEqual([...reg.PUBLIC_VISITOR], SNAP.publicVisitor);
  assert.deepEqual(authz.effectivePermissions({ type: 'SYSTEM' }, 'org_x'), SNAP.systemEffective);
  assert.equal(JSON.stringify(reg.registryDto()), JSON.stringify(SNAP.registryDto), 'registry DTO byte-identical with every flag off');
  assert.equal(JSON.stringify(reg.registryDto({ enabled: new Set() })), JSON.stringify(SNAP.registryDto));
  const on = reg.registryDto({ enabled: new Set(['FEATURE_DEALS']) });
  assert.ok(on.permissions.some(p => p.key === 'proposal.read') && !on.permissions.some(p => p.key === 'backoffice.access'));
  assert.ok(on.roles.find(r => r.code === 'OWNER_ADMIN').permissions.includes('sale.complete'));
  assert.ok(!on.roles.find(r => r.code === 'COMMERCIAL_MANAGER').permissions.some(k => R5.has(k)));
});

test('round-5 keys: 77, explicitGrantOnly, mapped to one feature flag, in sync with the frontend mirror config/security/permissions.json', () => {
  assert.equal(R5.size, 77);
  for (const k of R5) { const p = reg.BY_KEY.get(k); assert.ok(p && p.explicitGrantOnly && p.feature && !p.publicRead && !p.systemOnly, k); }
  for (const k of reg.KEYS) assert.equal(reg.BY_KEY.get(k).explicitGrantOnly, false, k);
  const PATTERN = /^(proposal|reservation|closing|contract|signature|sale|commercial_approval|development_onboarding|privacy|backoffice|data_quality|data_governance)\.|^customer\.export_bulk$|^development\.location_environment\.|^development\.location\.validate$/;
  const mirror = [...round5.mirrorMeta().keys()].filter(k => PATTERN.test(k)).sort();
  assert.deepEqual(mirror, [...R5].sort());
  for (const k of R5) assert.equal(reg.BY_KEY.get(k).riskLevel, round5.mirrorMeta().get(k).riskLevel, k);
  // the module permission lists are covered
  assert.deepEqual(require('../src/modules/deals/deals.controller').DEALS_PERMISSIONS.map(p => p.key).filter(k => !R5.has(k)), []);
  assert.deepEqual(require('../src/modules/privacy/privacy.routes').PERMISSIONS.map(p => p[0]).filter(k => !R5.has(k)), []);
  assert.deepEqual(require('../src/modules/dataquality/dataquality.service').PERMISSIONS.filter(k => !R5.has(k)), []);
});

test('authorization: OWNER_ADMIN allowed on round-5 keys, other roles denied, anonymous denied; explicit grants are per organization and validated', () => {
  const user = (role, org = ORG) => ({ type: 'USER', id: 'u1', status: 'ACTIVE', actorId: 'u1', memberships: [{ organizationId: org, status: 'ACTIVE', organizationStatus: 'ACTIVE' }], assignments: [{ roleCode: role, organizationId: org, developmentId: null }] });
  const res = { type: 'organization', organizationId: ORG, developmentId: null, visibility: 'PRIVATE' };
  for (const k of R5) {
    assert.equal(authz.decide(user('OWNER_ADMIN'), k, res).effect, 'ALLOW', k);
    for (const role of Object.keys(reg.ROLES).filter(r => r !== 'OWNER_ADMIN')) assert.equal(authz.decide(user(role), k, res).effect, 'DENY', `${role} ${k}`);
    assert.equal(authz.decide(authz.ANONYMOUS, k, null).effect, 'DENY', k);
  }
  // explicit grant file: refused without --confirm, refused for template keys and for OWNER_ADMIN, scoped to its organization
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'grants-')), 'role-grants.json');
  assert.throws(() => roleGrants.grant(file, { roleCode: 'BROKER', permission: 'proposal.read', organizationId: ORG, decisionRef: 'x' }), /--confirm/);
  assert.throws(() => roleGrants.grant(file, { roleCode: 'BROKER', permission: 'lot.view', organizationId: ORG, decisionRef: 'x', confirm: true }), /templates/);
  assert.throws(() => roleGrants.grant(file, { roleCode: 'OWNER_ADMIN', permission: 'proposal.read', organizationId: ORG, decisionRef: 'x', confirm: true }), /template/);
  assert.throws(() => roleGrants.grant(file, { roleCode: 'BROKER', permission: 'proposal.read', organizationId: ORG, confirm: true }), /decisionRef/);
  assert.equal(roleGrants.grant(file, { roleCode: 'BROKER', permission: 'proposal.read', organizationId: ORG, decisionRef: 'teste 2026-10-18', confirm: true }).added, true);
  const prev = reg.installExplicitGrants(roleGrants.loadRoleGrants(file));
  try {
    assert.equal(authz.decide(user('BROKER'), 'proposal.read', res).effect, 'ALLOW');
    assert.equal(authz.decide(user('BROKER'), 'proposal.create', res).effect, 'DENY');
    assert.equal(authz.decide(user('BROKER', 'org_other'), 'proposal.read', { ...res, organizationId: 'org_other' }).effect, 'DENY', 'grant is per organization');
    assert.equal(JSON.stringify(reg.ROLES.BROKER), JSON.stringify(SNAP.roles.BROKER), 'templates untouched by explicit grants');
  } finally { reg.installExplicitGrants(prev); }
  assert.equal(roleGrants.revoke(file, { roleCode: 'BROKER', permission: 'proposal.read', organizationId: ORG }), 1);
  assert.throws(() => reg.installExplicitGrants([{ roleCode: 'BROKER', permission: 'lot.view', organizationId: ORG, decisionRef: 'x' }]), /not an explicit-grant/);
  assert.deepEqual(roleGrants.loadRoleGrants(path.join(__dirname, '..', 'config', 'iam', 'role-grants.json')), [], 'shipped grant file is empty');
});

// ------------------------------------------------------------------------------------------ app under test
function fakePool(users) {
  const err = () => { const e = new Error('connect ECONNREFUSED (no database in this test)'); e.code = 'ECONNREFUSED'; return e; };
  return {
    async query(sql, params = []) {
      if (/FROM auth_tokens t JOIN users u/.test(sql)) { const u = users.get(params[0]); return { rows: u ? [{ token_id: 't-' + u.id, expires_at: new Date(Date.now() + 3600e3), last_used_at: null, user_id: u.id, status: 'ACTIVE', display_name: u.role }] : [] }; }
      if (/UPDATE auth_tokens SET last_used_at/.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM organization_memberships m JOIN organizations o/.test(sql)) return { rows: [{ organization_id: ORG, status: 'ACTIVE', slug: 'house-7', display_name: 'House 7', organization_status: 'ACTIVE' }] };
      if (/FROM role_assignments/.test(sql)) { const u = [...users.values()].find(x => x.id === params[0]); return { rows: u ? [{ role_code: u.role, organization_id: ORG, development_id: null }] : [] }; }
      if (/SELECT id, organization_id, visibility FROM developments WHERE id = \$1/.test(sql)) return { rows: params[0] === 'viva-juara' ? [{ id: 'viva-juara', organization_id: ORG, visibility: 'PUBLIC' }] : [] };
      if (/FROM organizations WHERE id = \$1/.test(sql)) return { rows: params[0] === ORG ? [{ id: ORG, slug: 'house-7', display_name: 'House 7', status: 'ACTIVE', default_locale: 'pt-BR', default_timezone: 'America/Sao_Paulo', currency: 'BRL' }] : [] };
      if (/FROM developments WHERE organization_id = \$1/.test(sql)) return { rows: params[0] === ORG ? [{ id: 'viva-juara', slug: 'viva-juara', name: 'Viva Juara', visibility: 'PUBLIC' }] : [] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [], rowCount: 1 };
      throw err();
    },
    on() {}, end: async () => {}, connect: async () => { throw err(); }
  };
}

async function withApp(env, fn) {
  const users = new Map(), tokens = {};
  for (const role of ['OWNER_ADMIN', 'COMMERCIAL_MANAGER', 'BROKER', 'VIEWER']) { const t = newDevToken(); tokens[role] = t.token; users.set(t.tokenHash, { id: crypto.randomUUID(), role }); }
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://unused@127.0.0.1:1/none', HOST: '127.0.0.1', PORT: '0', RATE_LIMIT_MAX: '1000000', SHARED_SRC_DIR: SRC,
    ADMIN_API_TOKEN: ADMIN, AUTH_DEV_TOKENS: 'true', DEALS_EXPIRY_INTERVAL_MS: '3600000', ...env }, { useDotEnv: false });
  const app = createApp({ config, pool: fakePool(users), logger: createLogger({ level: 'silent' }), App });
  const server = http.createServer(app.handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, p, token) => {
    const r = await fetch(base + p, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'Idempotency-Key': 'idem-' + crypto.randomBytes(6).toString('hex') } : {}) }, body: method !== 'GET' ? '{}' : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: r.status, json };
  };
  try { await fn({ app, req, tokens, config }); } finally { await app.close(); await new Promise(r => server.close(r)); server.closeAllConnections && server.closeAllConnections(); }
}
const routeList = app => app.router.routes.map(r => `${r.method} ${toOpenApi(r.template)}`).sort();
const sample = tpl => tpl.replace(/:developmentId/g, 'viva-juara').replace(/:([A-Za-z]+)/g, (_, n) => `${n.slice(0, 3).toLowerCase()}_000000000001`);

// ------------------------------------------------------------------------------------------ 2. flags off
test('all flags off (default): same routes and OpenAPI as before round 5; no deals job; config defaults OFF', async () => {
  const c = loadConfig({ DATABASE_URL: 'postgres://u@h/d' }, { useDotEnv: false });
  assert.deepEqual({ ...c.features }, { deals: false, onboarding: false, privacy: false, backoffice: false, dataQuality: false, surroundings: false });
  await withApp({}, async ({ app, req }) => {
    assert.deepEqual(routeList(app), SURFACE.routes);
    assert.deepEqual(app.features.enabled, []);
    assert.deepEqual(app.features.jobs, []);
    assert.equal((await req('GET', '/api/v1/proposals/pro_000000000001')).status, 404, 'round-5 route does not exist');
    const reg1 = await req('GET', '/api/v1/iam/registry');
    assert.equal(reg1.status, 200);
    assert.equal(JSON.stringify(reg1.json.data), JSON.stringify(SNAP.registryDto), 'GET /iam/registry unchanged');
  });
  const doc = JSON.parse(render());
  const core = { openapi: doc.openapi, info: doc.info, servers: doc.servers, tags: doc.tags, paths: doc.paths, components: doc.components };
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex'), SURFACE.openapiCoreSha256, 'docs/openapi.json paths/components/info/tags byte-identical');
  for (const [k, v] of Object.entries(SURFACE.errorCatalog)) assert.deepEqual(doc['x-error-catalog'][k], v, k);
  for (const k of Object.keys(doc['x-error-catalog']).filter(k => !SURFACE.errorCatalog[k])) assert.ok(doc['x-error-catalog'][k]['x-feature-flag'], `${k}: new catalog entries are feature-marked`);
});

// ------------------------------------------------------------------------------------------ 3. flags on
test('all flags on: routes = openapi.features.json; anonymous 401, other roles 403, ADMIN_API_TOKEN 403, OWNER_ADMIN passes the gate', async () => {
  const fdoc = JSON.parse(renderFeatures());
  const featureOps = Object.entries(fdoc.paths).flatMap(([p, ops]) => Object.entries(ops).filter(([, o]) => o['x-feature-flag']).map(([m, o]) => ({ key: `${m.toUpperCase()} ${p}`, flag: o['x-feature-flag'] })));
  assert.equal(new Set(featureOps.map(o => o.key)).size, featureOps.length);
  for (const o of featureOps) assert.equal(fdoc.paths[o.key.split(' ')[1]][o.key.split(' ')[0].toLowerCase()]['x-disabled-by-default'], true, o.key);
  await withApp(ALL_ON, async ({ app, req, tokens }) => {
    assert.deepEqual(app.features.enabled.sort(), Object.keys(ALL_ON).sort());
    assert.deepEqual(app.features.jobs.map(j => j.name), ['deals.runExpiry'], 'expiry job only with FEATURE_DEALS');
    assert.deepEqual(routeList(app), [...SURFACE.routes, ...featureOps.map(o => o.key)].sort(), 'registered routes = base + feature-flagged paths');
    const fresh = app.router.routes.filter(r => r.meta.feature);
    assert.equal(fresh.length, featureOps.length);
    for (const r of fresh) {
      const p = sample(r.template), perm = r.meta.permission;
      assert.ok(R5.has(perm), `${r.method} ${r.template}: round-5 permission (${perm})`);
      assert.equal(round5.FEATURE_OF.get(perm), r.meta.feature, `${r.template}: permission of its own module`);
      const anon = await req(r.method, p, null);
      assert.equal(anon.status, 401, `${r.method} ${r.template} anonymous: ${anon.status} ${anon.json && anon.json.code}`);
      for (const role of ['COMMERCIAL_MANAGER', 'BROKER', 'VIEWER']) {
        const d = await req(r.method, p, tokens[role]);
        assert.equal(d.status, 403, `${r.method} ${r.template} ${role}: ${d.status} ${d.json && d.json.code}`);
        assert.equal(d.json.code, 'PERMISSION_DENIED'); assert.equal(d.json.details.permission, perm);
      }
      const sys = await req(r.method, p, ADMIN);
      assert.equal(sys.status, 403, `${r.method} ${r.template} ADMIN_API_TOKEN`); assert.equal(sys.json.code, 'PERMISSION_DENIED');
      const own = await req(r.method, p, tokens.OWNER_ADMIN);
      assert.ok(own.status !== 401 && !(own.status === 403 && own.json && own.json.code === 'PERMISSION_DENIED'), `${r.method} ${r.template} OWNER_ADMIN passes the gate: ${own.status} ${JSON.stringify(own.json && [own.json.code, own.json.details])}`);
      assert.notEqual(own.status, 500, `${r.method} ${r.template} OWNER_ADMIN: no internal error (${JSON.stringify(own.json)})`);
      if (own.json && own.json.code) assert.ok(ERROR_CATALOG[own.json.code], `${own.json.code} cataloged`);
    }
    // GET /me lists round-5 keys for OWNER_ADMIN only when the module is on
    const me = await req('GET', '/api/v1/me', tokens.OWNER_ADMIN);
    assert.ok(me.json.data.permissions.includes('sale.complete') && me.json.data.permissions.includes('backoffice.access'));
    const broker = await req('GET', '/api/v1/me', tokens.BROKER);
    assert.ok(!broker.json.data.permissions.some(k => R5.has(k)));
  });
  await withApp({ FEATURE_SURROUNDINGS: '1' }, async ({ app, req, tokens }) => {
    assert.deepEqual(app.features.enabled, ['FEATURE_SURROUNDINGS']);
    assert.deepEqual(app.features.jobs, [], 'no deals job without FEATURE_DEALS');
    const me = await req('GET', '/api/v1/me', tokens.OWNER_ADMIN);
    assert.ok(me.json.data.permissions.includes('development.location_environment.read') && !me.json.data.permissions.includes('sale.complete'), 'keys of modules that are off stay hidden');
  });
});

test('deals expiry job: server clock sweep over active organizations, failure-tolerant (no database → logged, no throw)', async () => {
  await withApp({ FEATURE_DEALS: '1' }, async ({ app }) => {
    const job = app.features.jobs[0];
    assert.equal(job.name, 'deals.runExpiry'); assert.equal(job.intervalMs, 3600000);
    await job.run(); // organizations query fails (no DB): swallowed and logged
  });
});

test('openapi.features.json: every documented code is cataloged with its status; every $ref resolves; secrets catalog has the Google Maps names only', () => {
  const fdoc = JSON.parse(renderFeatures());
  for (const [p, ops] of Object.entries(fdoc.paths)) for (const [m, o] of Object.entries(ops)) for (const [st, r] of Object.entries(o.responses || {})) {
    if (Number(st) < 400) continue;
    for (const code of r.description.split(',').map(s => s.trim()).filter(Boolean)) {
      assert.ok(ERROR_CATALOG[code], `${m} ${p} ${st}: ${code}`);
      assert.ok([].concat(ERROR_CATALOG[code].status).includes(Number(st)), `${m} ${p}: ${code} ${st} vs ${ERROR_CATALOG[code].status}`);
    }
  }
  const missing = [];
  const walk = (n, at) => { if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${at}[${i}]`)); if (!n || typeof n !== 'object') return;
    if (typeof n.$ref === 'string' && n.$ref.replace(/^#\//, '').split('/').reduce((o, k) => (o == null ? o : o[k]), fdoc) === undefined) missing.push(`${at} ${n.$ref}`);
    for (const [k, v] of Object.entries(n)) walk(v, `${at}.${k}`); };
  walk(fdoc, '#');
  assert.deepEqual(missing, []);
  assert.deepEqual(fdoc.components.schemas.ApiError.properties.code.enum, Object.keys(ERROR_CATALOG));
  const secrets = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'security', 'secretsCatalog.json'), 'utf8')).secrets;
  for (const n of ['GOOGLE_MAPS_API_KEY', 'GOOGLE_MAPS_BROWSER_KEY']) { const s = secrets.find(x => x.secretId === n); assert.ok(s, n); assert.ok(!('value' in s) && !('secret' in s)); }
});
