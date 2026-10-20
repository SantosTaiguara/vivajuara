'use strict';
/* Topic 30 — users, permissions, authorization.
   Part 1 (pure, no database): PermissionRegistry validity, deny by default, scopes, suspended principals, system-only
   permissions, final action = domain capability AND authorization, route policy matrix covers every route.
   Part 2 (database): GET /api/v1/me for anonymous / user / system, 401 for invalid / expired / revoked / suspended
   credentials, 403 PERMISSION_DENIED vs ALLOW per role, DENIED audit rows, audit listing scoped by organization,
   append-only audit, tokens stored only as sha256, ADMIN_API_TOKEN still works (no breaking change). */
const test = require('node:test');
const { describe, before, after } = test;
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { h, contract, TOKEN, DEV, client, provision, get, seedSecondTenant } = require('./support');
const reg = require('../src/modules/iam/permissions');
const authz = require('../src/modules/iam/authorization');
const { POLICIES } = require('../src/modules/iam/routePolicies');
const { newDevToken, DEV_TOKEN_RE } = require('../src/modules/iam/authentication');

// ---------------------------------------------------------------- pure
const user = (assignments, o = {}) => ({ type: 'USER', id: 'u1', userId: 'u1', status: o.status || 'ACTIVE', actorId: 'user:u1',
  memberships: o.memberships || [{ organizationId: 'org_house7', status: 'ACTIVE', organizationStatus: 'ACTIVE' }],
  assignments: assignments.map(([roleCode, developmentId = null, organizationId = 'org_house7']) => ({ roleCode, organizationId, developmentId })) });
const PUB = { type: 'development', organizationId: 'org_house7', developmentId: DEV, visibility: 'PUBLIC' };
const PRIV = { type: 'development', organizationId: 'org_house7', developmentId: 'dev-x', visibility: 'PRIVATE' };
const OTHER = { type: 'development', organizationId: 'org_test_b', developmentId: 'dev-b', visibility: 'PRIVATE' };
const SYSTEM = { type: 'SYSTEM', status: 'ACTIVE', memberships: [], assignments: [] };

test('registry: valid, dot-separated keys, grants only known non-system keys, required ids present', () => {
  assert.deepEqual(reg.validateRegistry(), []);
  for (const k of ['lot.price.view', 'price_table.publish', 'availability.write', 'customer_profile.manage', 'admin.audit.view', 'lot.price_history.view'])
    assert.ok(reg.BY_KEY.has(k), k);
  assert.throws(() => reg.assertKnown('lot.delete'), /unknown permission/);
  assert.throws(() => authz.decide(user([['OWNER_ADMIN']]), 'lots.view', PUB), /unknown permission/); // typo never silently allowed
  assert.equal(reg.ROLES.OWNER_ADMIN.includes('platform.cross_tenant'), false);
  assert.equal(reg.BY_KEY.get('price_table.publish').riskLevel, 'CRITICAL');
  const dto = reg.registryDto();
  assert.equal(dto.roles.length, 8);
  assert.equal(dto.permissions.length, reg.KEYS.length);
});

test('every registered route has a policy with a known permission (deny by default at startup)', () => {
  for (const [route, p] of Object.entries(POLICIES)) {
    assert.ok(reg.BY_KEY.has(p.permission), route);
    assert.ok([null, 'development', 'lot'].includes(p.resource), route);
  }
  for (const write of ['POST /api/v1/developments/:developmentId/price-tables', 'PATCH /api/v1/lots/:lotId/availability', 'POST /api/v1/developments/:developmentId/analysis/preview'])
    assert.equal(reg.BY_KEY.get(POLICIES[write].permission).publicRead, false, write);
});

test('decide: anonymous gets public reads on PUBLIC developments only; never writes', () => {
  assert.equal(authz.decide(authz.ANONYMOUS, 'lot.price.view', PUB).effect, 'ALLOW');
  const priv = authz.decide(authz.ANONYMOUS, 'lot.view', PRIV);
  assert.equal(priv.effect, 'DENY'); assert.equal(priv.notFound, true);
  for (const k of ['availability.write', 'price_table.publish', 'analysis.preview', 'admin.audit.view']) {
    assert.equal(authz.decide(authz.ANONYMOUS, k, PUB).effect, 'DENY', k);
    assert.equal(authz.decide(authz.ANONYMOUS, k, null).effect, 'DENY', k);
  }
});

test('decide: role matrix — broker cannot publish prices, pricing manager can, inventory manager writes availability only', () => {
  assert.equal(authz.decide(user([['BROKER']]), 'price_table.publish', PUB).effect, 'DENY');
  assert.equal(authz.decide(user([['BROKER']]), 'price_table.publish', PUB).notFound, false); // visible → 403, not 404
  assert.equal(authz.decide(user([['BROKER']]), 'availability.write', PUB).effect, 'DENY');
  const pm = authz.decide(user([['PRICING_MANAGER']]), 'price_table.publish', PUB);
  assert.equal(pm.effect, 'ALLOW'); assert.deepEqual(pm.obligations, ['writeAuditEvent']);
  assert.equal(pm.matchedAssignments[0].roleCode, 'PRICING_MANAGER');
  assert.equal(authz.decide(user([['INVENTORY_MANAGER']]), 'availability.write', PUB).effect, 'ALLOW');
  assert.equal(authz.decide(user([['INVENTORY_MANAGER']]), 'price_table.publish', PUB).effect, 'DENY');
  assert.equal(authz.decide(user([['VIEWER']]), 'admin.audit.view', { ...PRIV, type: 'organization', developmentId: null }).effect, 'DENY');
  assert.equal(authz.decide(user([['OWNER_ADMIN']]), 'admin.audit.view', { ...PRIV, type: 'organization', developmentId: null }).effect, 'ALLOW');
});

test('decide: development-scoped assignment grants only on that development', () => {
  const u = user([['PRICING_MANAGER', DEV]]);
  assert.equal(authz.decide(u, 'price_table.publish', PUB).effect, 'ALLOW');
  const other = authz.decide(u, 'price_table.publish', PRIV);
  assert.equal(other.effect, 'DENY'); assert.equal(other.notFound, true); // cannot even see the private development
  assert.equal(authz.decide(u, 'price_table.publish', null).effect, 'ALLOW'); // route-level: granted somewhere
  assert.deepEqual(authz.effectivePermissions(u, 'org_house7', null), []);
  assert.ok(authz.effectivePermissions(u, 'org_house7', DEV).includes('price_table.publish'));
});

test('decide: cross-tenant is DENY + notFound even for an owner admin; system principal is allowed everywhere', () => {
  const d = authz.decide(user([['OWNER_ADMIN']]), 'lot.view', OTHER);
  assert.equal(d.effect, 'DENY'); assert.equal(d.notFound, true); assert.deepEqual(d.reasons, ['TENANT_MISMATCH']);
  // assignments of an organization without active membership grant nothing
  const forged = user([['OWNER_ADMIN', null, 'org_test_b']]);
  assert.equal(authz.decide(forged, 'lot.view', OTHER).effect, 'DENY');
  assert.equal(authz.decide(SYSTEM, 'price_table.publish', OTHER).effect, 'ALLOW');
  assert.equal(authz.decide(SYSTEM, 'platform.cross_tenant', null).effect, 'ALLOW');
  assert.equal(authz.decide(user([['OWNER_ADMIN']]), 'platform.cross_tenant', null).effect, 'DENY');
});

test('decide: suspended user, revoked membership or suspended organization → deny', () => {
  assert.equal(authz.decide(user([['OWNER_ADMIN']], { status: 'SUSPENDED' }), 'availability.write', PUB).effect, 'DENY');
  assert.equal(authz.decide(user([['OWNER_ADMIN']], { memberships: [{ organizationId: 'org_house7', status: 'REVOKED', organizationStatus: 'ACTIVE' }] }), 'availability.write', PUB).effect, 'DENY');
  assert.equal(authz.decide(user([['OWNER_ADMIN']], { memberships: [{ organizationId: 'org_house7', status: 'ACTIVE', organizationStatus: 'SUSPENDED' }] }), 'availability.write', PUB).effect, 'DENY');
});

test('finalAction = domain capability AND authorization', () => {
  const allow = authz.decide(user([['INVENTORY_MANAGER']]), 'availability.write', PUB);
  assert.deepEqual(authz.finalAction(allow, true), { allowed: true, reason: null });
  assert.deepEqual(authz.finalAction(allow, false), { allowed: false, reason: 'DOMAIN_CAPABILITY_FALSE' });
  assert.equal(authz.finalAction(authz.decide(user([['BROKER']]), 'availability.write', PUB), true).allowed, false);
});

test('dev tokens: 256-bit random, prefixed, only the sha256 hex is meant to be stored', () => {
  const a = newDevToken(), b = newDevToken();
  assert.match(a.token, DEV_TOKEN_RE); assert.notEqual(a.token, b.token);
  assert.equal(a.tokenHash, crypto.createHash('sha256').update(a.token).digest('hex'));
  assert.equal(a.tokenHash.includes(a.token), false);
});

test('AUTH_DEV_TOKENS=true is refused in production', () => {
  const { loadConfig } = require('../src/shared/config');
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x@127.0.0.1/x', AUTH_DEV_TOKENS: 'true', CORS_ORIGINS: 'https://a.test' }, { useDotEnv: false }), /AUTH_DEV_TOKENS/);
});

// ---------------------------------------------------------------- database
let db, srv, req, users = {};
const q = async (sql, p) => (await db.pool.query(sql, p)).rows;

describe('database (PostgreSQL)', () => {
before(async () => {
  db = await h.setupDatabase('iam');
  await seedSecondTenant(db.pool);
  srv = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN, AUTH_DEV_TOKENS: 'true' }, { pool: db.pool });
  req = client(srv);
  const mk = (displayName, roleCode, o = {}) => provision(db.pool, { organizationId: 'org_house7', displayName, roles: [{ roleCode, developmentId: o.dev || null }], ...o });
  users.broker = await mk('Corretor Teste', 'BROKER');
  users.pricing = await mk('Gestor de Preço', 'PRICING_MANAGER');
  users.inventory = await mk('Estoque', 'INVENTORY_MANAGER');
  users.owner = await mk('Admin House 7', 'OWNER_ADMIN');
  users.expired = await mk('Expirado', 'OWNER_ADMIN', { ttlSeconds: -60 });
  users.suspended = await mk('Suspenso', 'OWNER_ADMIN', { status: 'SUSPENDED' });
  users.ownerB = await provision(db.pool, { organizationId: 'org_test_b', displayName: 'Admin B', roles: [{ roleCode: 'OWNER_ADMIN' }] });
});
after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

test('GET /me anonymous: public permissions only, no organization, private no-store', async () => {
  const x = await get(srv, '/me');
  assert.equal(x.r.status, 200, x.text.slice(0, 300));
  contract.assertSchema(x.body, 'MeResponse');
  const d = x.body.data;
  assert.equal(d.authenticated, false); assert.equal(d.principal.type, 'ANONYMOUS');
  assert.equal(d.organizationId, null);
  assert.deepEqual(d.permissions, [...reg.PUBLIC_VISITOR].sort());
  assert.equal(d.permissions.includes('price_table.publish'), false);
  assert.equal(d.identityProvider.status, 'NOT_CONFIGURED'); // W3: provider decided (Google); not configured in this test server
  assert.match(x.r.headers.get('cache-control'), /no-store/);
});

test('GET /me user: single membership resolves the organization; roles, permissions and developments; never the token', async () => {
  const x = await get(srv, '/me', { token: users.pricing.token });
  assert.equal(x.r.status, 200, x.text.slice(0, 300));
  contract.assertSchema(x.body, 'MeResponse');
  const d = x.body.data;
  assert.equal(d.principal.type, 'USER'); assert.equal(d.principal.authenticationMethod, 'DEV_TOKEN');
  assert.equal(d.organizationId, 'org_house7'); assert.equal(d.tenantResolvedBy, 'SINGLE_MEMBERSHIP');
  assert.equal(d.organization.slug, 'house-7'); assert.equal(d.organization.displayName, 'House 7 Imóveis');
  assert.deepEqual(d.organization.developments.map(v => v.id), [DEV]); // org B's development is not listed
  assert.deepEqual(d.roles, ['PRICING_MANAGER']);
  assert.ok(d.permissions.includes('price_table.publish')); assert.equal(d.permissions.includes('availability.write'), false);
  assert.ok(d.session.expiresAt);
  assert.equal(x.text.includes(users.pricing.token), false);
  assert.match(x.r.headers.get('vary') || '', /Authorization/);
});

test('GET /me system (ADMIN_API_TOKEN): all permissions, no organization', async () => {
  const x = await get(srv, '/me', { token: TOKEN });
  const d = x.body.data;
  assert.equal(d.principal.type, 'SYSTEM'); assert.equal(d.principal.authenticationMethod, 'ADMIN_API_TOKEN');
  assert.deepEqual(d.permissions, [...reg.KEYS].sort());
  assert.equal(x.text.includes(TOKEN), false);
});

test('401: malformed, unknown, expired, revoked token and suspended user', async () => {
  const revoked = await provision(db.pool, { organizationId: 'org_house7', displayName: 'Revogado', roles: [{ roleCode: 'VIEWER' }] });
  await q('UPDATE auth_tokens SET revoked_at = now() WHERE id = $1', [revoked.tokenId]);
  for (const t of ['plat_dev_' + 'A'.repeat(43), 'not a token', users.expired.token, revoked.token, users.suspended.token]) {
    const x = await get(srv, '/me', { token: t });
    contract.assertApiError(x.r, x.body, 401, 'UNAUTHORIZED');
    assert.ok(x.r.headers.get('www-authenticate'));
  }
  const bad = await fetch(srv.api + '/me', { headers: { Authorization: 'Basic abc' } });
  assert.equal(bad.status, 401);
});

test('403 PERMISSION_DENIED: broker publishing a price table (dry-run); denial audited without PII; nothing written', async () => {
  const before = (await q('SELECT count(*)::int AS n FROM price_tables'))[0].n;
  const x = await req('POST', `/developments/${DEV}/price-tables?dryRun=true`, { version: '2026-11-01', pricePerM2: 1250 }, { token: users.broker.token });
  contract.assertApiError(x.r, x.body, 403, 'PERMISSION_DENIED');
  assert.equal((await q('SELECT count(*)::int AS n FROM price_tables'))[0].n, before);
  const rows = await q("SELECT * FROM audit_log WHERE outcome = 'DENIED' AND actor_id = $1", [users.broker.userId]);
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].permission_key, 'price_table.publish'); assert.equal(rows[0].actor_type, 'USER');
  assert.equal(rows[0].organization_id, 'org_house7');
  assert.equal(JSON.stringify(rows[0]).includes('Corretor Teste'), false); // display name never in the audit log
});

test('ALLOW: pricing manager dry-run, inventory manager availability write (audited with actor + permission)', async () => {
  const dry = await req('POST', `/developments/${DEV}/price-tables?dryRun=true`, { version: '2026-11-01', pricePerM2: 1250 }, { token: users.pricing.token });
  assert.equal(dry.r.status, 200, dry.text.slice(0, 300));
  const inv = await req('PATCH', '/lots/VJ-QA-L0003/availability', { status: 'RESERVED', expectedRevision: 0 }, { token: users.inventory.token });
  assert.equal(inv.r.status, 200, inv.text.slice(0, 300));
  const a = await q("SELECT * FROM audit_log WHERE entity_id = 'VJ-QA-L0003' AND outcome = 'SUCCESS'");
  assert.equal(a.length, 1);
  assert.equal(a[0].actor_id, users.inventory.userId); assert.equal(a[0].actor_type, 'USER');
  assert.equal(a[0].permission_key, 'availability.write'); assert.equal(a[0].organization_id, 'org_house7');
  const denied = await req('PATCH', '/lots/VJ-QA-L0004/availability', { status: 'RESERVED', expectedRevision: 0 }, { token: users.pricing.token });
  contract.assertApiError(denied.r, denied.body, 403, 'PERMISSION_DENIED');
});

test('ADMIN_API_TOKEN keeps working for writes (no breaking change); anonymous writes → 401', async () => {
  const x = await req('PATCH', '/lots/VJ-QA-L0005/availability', { status: 'BLOCKED', expectedRevision: 0, reason: 'INTERNAL_BLOCK' });
  assert.equal(x.r.status, 200, x.text.slice(0, 300));
  const anon = await req('PATCH', '/lots/VJ-QA-L0006/availability', { status: 'RESERVED', expectedRevision: 0 }, { token: null });
  contract.assertApiError(anon.r, anon.body, 401, 'UNAUTHORIZED');
});

test('audit events: owner admin sees only its organization; viewer-level roles get 403; system sees all', async () => {
  // an audited write inside org B (owner B on its own lot)
  const w = await req('PATCH', '/lots/TB-QA-L0001/availability', { status: 'RESERVED', expectedRevision: 0 }, { token: users.ownerB.token });
  assert.equal(w.r.status, 200, w.text.slice(0, 300));
  const own = await get(srv, '/admin/audit-events?limit=200', { token: users.owner.token });
  assert.equal(own.r.status, 200, own.text.slice(0, 300));
  contract.assertSchema(own.body, 'AuditEventListResponse');
  assert.ok(own.body.data.length >= 1);
  for (const e of own.body.data) assert.equal(e.organizationId, 'org_house7');
  const b = await get(srv, '/admin/audit-events?limit=200', { token: users.ownerB.token });
  for (const e of b.body.data) assert.equal(e.organizationId, 'org_test_b');
  assert.equal(b.body.data.some(e => e.resourceId === 'VJ-QA-L0003'), false);
  const broker = await get(srv, '/admin/audit-events', { token: users.broker.token });
  contract.assertApiError(broker.r, broker.body, 403, 'PERMISSION_DENIED');
  const anon = await get(srv, '/admin/audit-events');
  contract.assertApiError(anon.r, anon.body, 401, 'UNAUTHORIZED');
  const sys = await get(srv, '/admin/audit-events?limit=200', { token: TOKEN });
  assert.equal(sys.r.status, 200);
  assert.ok(new Set(sys.body.data.map(e => e.organizationId)).size >= 2);
  const foreign = await get(srv, '/admin/audit-events', { token: users.owner.token, headers: { 'X-Organization-Id': 'org_test_b' } });
  contract.assertApiError(foreign.r, foreign.body, 404, 'ORGANIZATION_NOT_FOUND');
});

test('audit log is append-only; tokens are stored only as sha256 hashes', async () => {
  await assert.rejects(q('UPDATE audit_log SET action = action'), /append-only/i);
  await assert.rejects(q('DELETE FROM audit_log'), /append-only/i);
  const tokens = await q('SELECT token_hash FROM auth_tokens');
  assert.ok(tokens.length >= 7);
  for (const t of tokens) assert.match(t.token_hash, /^[0-9a-f]{64}$/);
  const dump = JSON.stringify(await q('SELECT * FROM auth_tokens')) + JSON.stringify(await q('SELECT * FROM users')) + JSON.stringify(await q('SELECT * FROM audit_log'));
  for (const u of Object.values(users)) assert.equal(dump.includes(u.token), false);
  const cols = (await q("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'")).map(r => r.column_name);
  for (const pii of ['email', 'phone', 'cpf', 'password']) assert.equal(cols.includes(pii), false, pii);
});

test('GET /iam/registry is public, versioned and matches the in-code registry', async () => {
  const x = await get(srv, '/iam/registry');
  assert.equal(x.r.status, 200);
  contract.assertSchema(x.body, 'IamRegistryResponse');
  assert.deepEqual(x.body.data, reg.registryDto());
  assert.ok(x.r.headers.get('etag'));
});
}); // describe database
