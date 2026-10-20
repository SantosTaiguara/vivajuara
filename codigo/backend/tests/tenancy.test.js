'use strict';
/* Topic 31 — multi-tenant isolation (shared schema + organization_id).
   Baseline: organization "House 7 Imóveis" (house-7, org_house7) owns viva-juara; every tenant-owned row was
   backfilled. A second organization (org_test_b) owns a PRIVATE development "dev-b" (same slug "viva-juara", allowed
   per organization). Cross-tenant reads and writes answer exactly like nonexistent resources (404); listings and the
   batch summary never reveal foreign rows; composite foreign keys reject a row whose organization differs from its
   development's; X-Organization-Id is only a selector validated against memberships; viva-juara public data is
   identical for anonymous, foreign users and the platform principal. */
const test = require('node:test');
const { describe, before, after } = test;
const assert = require('node:assert/strict');
const { h, contract, TOKEN, DEV, client, provision, get, seedSecondTenant } = require('./support');

const TENANT_TABLES = ['lots', 'blocks', 'static_versions', 'sources', 'assets', 'analysis_versions', 'analysis_input_versions', 'price_tables', 'lot_availability', 'availability_history', 'import_runs'];

describe('database (PostgreSQL)', () => {
  let db, srv, req, ownerA, ownerB, viewerB, publicBefore;
  const q = async (sql, p) => (await db.pool.query(sql, p)).rows;
  const PUBLIC_PATHS = [`/developments/${DEV}`, `/developments/${DEV}/config`, `/developments/${DEV}/map-lots`, `/developments/${DEV}/lots?limit=50`,
    `/developments/${DEV}/availability`, `/developments/${DEV}/commercial/price-tables/current`, '/lots/VJ-QB-L0079', '/lots/VJ-QB-L0079/analysis'];
  const strip = b => JSON.stringify(b && b.data !== undefined ? b.data : b);

  before(async () => {
    db = await h.setupDatabase('tenancy');
    srv = await h.startTestServer(db.url, { ADMIN_API_TOKEN: TOKEN, AUTH_DEV_TOKENS: 'true' }, { pool: db.pool });
    publicBefore = {};
    for (const p of PUBLIC_PATHS) publicBefore[p] = strip((await get(srv, p)).body);
    await seedSecondTenant(db.pool);
    req = client(srv);
    ownerA = await provision(db.pool, { organizationId: 'org_house7', displayName: 'Admin A', roles: [{ roleCode: 'OWNER_ADMIN' }] });
    ownerB = await provision(db.pool, { organizationId: 'org_test_b', displayName: 'Admin B', roles: [{ roleCode: 'OWNER_ADMIN' }] });
    viewerB = await provision(db.pool, { organizationId: 'org_test_b', displayName: 'Viewer B', roles: [{ roleCode: 'VIEWER' }] });
  });
  after(async () => { if (srv) await srv.close(); if (db) await db.pool.end(); });

  test('baseline: House 7 Imóveis owns viva-juara and every tenant-owned row (backfill complete, NOT NULL)', async () => {
    const [org] = await q("SELECT * FROM organizations WHERE id = 'org_house7'");
    assert.equal(org.slug, 'house-7'); assert.equal(org.display_name, 'House 7 Imóveis'); assert.equal(org.status, 'ACTIVE');
    const [dev] = await q("SELECT organization_id, visibility FROM developments WHERE id = $1", [DEV]);
    assert.deepEqual(dev, { organization_id: 'org_house7', visibility: 'PUBLIC' });
    for (const t of TENANT_TABLES) {
      const [r] = await q(`SELECT count(*)::int AS n, count(*) FILTER (WHERE organization_id IS DISTINCT FROM 'org_house7')::int AS bad FROM ${t} WHERE development_id = $1`, [DEV]);
      assert.equal(r.bad, 0, t);
      const [nn] = await q("SELECT is_nullable FROM information_schema.columns WHERE table_name = $1 AND column_name = 'organization_id'", [t]);
      assert.equal(nn.is_nullable, 'NO', t);
    }
    assert.equal((await q("SELECT count(*)::int AS n FROM lots WHERE organization_id = 'org_house7'"))[0].n, 498);
    assert.equal((await q("SELECT organization_id FROM lots WHERE id = 'TB-QA-L0001'"))[0].organization_id, 'org_test_b'); // filled by trigger
  });

  test('viva-juara public data is unchanged by the second tenant and identical for anonymous, foreign user and system', async () => {
    for (const p of PUBLIC_PATHS) {
      const anon = await get(srv, p);
      assert.equal(anon.r.status, 200, p + ' ' + anon.text.slice(0, 200));
      assert.equal(strip(anon.body), publicBefore[p], p);
      assert.equal(strip((await get(srv, p, { token: ownerB.token })).body), publicBefore[p], p + ' (org B user)');
      assert.equal(strip((await get(srv, p, { token: TOKEN })).body), publicBefore[p], p + ' (system)');
    }
    const map = (await get(srv, `/developments/${DEV}/map-lots`)).body;
    assert.equal(map.data.length, 498);
  });

  test('cross-tenant reads → 404 identical to nonexistent ids (anonymous and House 7 owner admin)', async () => {
    const pairs = [['/developments/dev-b', '/developments/nope-dev', 'DEVELOPMENT_NOT_FOUND'], ['/developments/dev-b/map-lots', '/developments/nope-dev/map-lots', 'DEVELOPMENT_NOT_FOUND'],
      ['/developments/dev-b/availability', '/developments/nope-dev/availability', 'DEVELOPMENT_NOT_FOUND'], ['/developments/dev-b/pricing/history', '/developments/nope-dev/pricing/history', 'DEVELOPMENT_NOT_FOUND'],
      ['/lots/TB-QA-L0001', '/lots/TB-QZ-L9999', 'LOT_NOT_FOUND'], ['/lots/TB-QA-L0001/availability/history', '/lots/TB-QZ-L9999/availability/history', 'LOT_NOT_FOUND']];
    for (const token of [null, ownerA.token]) for (const [foreign, missing, code] of pairs) {
      const a = await get(srv, foreign, { token }), b = await get(srv, missing, { token });
      contract.assertApiError(a.r, a.body, 404, code);
      contract.assertApiError(b.r, b.body, 404, code);
      assert.equal(a.body.message.replace(/dev-b|TB-QA-L0001/g, 'X'), b.body.message.replace(/nope-dev|TB-QZ-L9999/g, 'X'), foreign);
    }
  });

  test('cross-tenant writes → 404, nothing written; same writes inside the own tenant succeed', async () => {
    const before = await q('SELECT count(*)::int AS n FROM audit_log');
    const w1 = await req('PATCH', '/lots/TB-QA-L0001/availability', { status: 'RESERVED', expectedRevision: 0 }, { token: ownerA.token });
    contract.assertApiError(w1.r, w1.body, 404, 'LOT_NOT_FOUND');
    const w2 = await req('POST', '/developments/dev-b/price-tables?dryRun=true', { version: '2026-11-01', pricePerM2: 1 }, { token: ownerA.token });
    contract.assertApiError(w2.r, w2.body, 404, 'DEVELOPMENT_NOT_FOUND');
    const w3 = await req('PATCH', '/lots/VJ-QA-L0001/availability', { status: 'RESERVED', expectedRevision: 0 }, { token: ownerB.token });
    contract.assertApiError(w3.r, w3.body, 404, 'LOT_NOT_FOUND');
    assert.equal((await q("SELECT status FROM lot_availability WHERE lot_id = 'TB-QA-L0001'"))[0].status, 'UNKNOWN');
    assert.equal((await q("SELECT status FROM lot_availability WHERE lot_id = 'VJ-QA-L0001'"))[0].status, 'UNKNOWN');
    assert.equal((await q('SELECT count(*)::int AS n FROM audit_log'))[0].n, before[0].n);
    const own = await req('PATCH', '/lots/TB-QA-L0001/availability', { status: 'RESERVED', expectedRevision: 0 }, { token: ownerB.token });
    assert.equal(own.r.status, 200, own.text.slice(0, 300));
    const [a] = await q("SELECT organization_id, development_id FROM audit_log WHERE entity_id = 'TB-QA-L0001'");
    assert.deepEqual(a, { organization_id: 'org_test_b', development_id: 'dev-b' });
    const viewer = await req('PATCH', '/lots/TB-QA-L0001/availability', { status: 'BLOCKED', expectedRevision: 1, reason: 'OTHER' }, { token: viewerB.token });
    contract.assertApiError(viewer.r, viewer.body, 403, 'PERMISSION_DENIED'); // visible to the viewer → 403, not 404
  });

  test('members of org B see their private development; the listing is filtered per principal', async () => {
    const ids = async token => (await get(srv, '/developments', { token })).body.data.map(d => d.id).sort();
    assert.deepEqual(await ids(null), [DEV]);
    assert.deepEqual(await ids(ownerA.token), [DEV]);
    assert.deepEqual(await ids(viewerB.token), ['dev-b', DEV].sort());
    assert.deepEqual(await ids(TOKEN), ['dev-b', DEV].sort());
    const x = await get(srv, '/developments/dev-b', { token: viewerB.token });
    assert.equal(x.r.status, 200, x.text.slice(0, 300));
    assert.equal(x.body.data.organizationId, 'org_test_b'); assert.equal(x.body.data.visibility, 'PRIVATE');
    assert.match(x.r.headers.get('cache-control'), /private/); // private development never in a shared cache
    const l = await get(srv, '/lots/TB-QA-L0001', { token: viewerB.token });
    assert.equal(l.r.status, 200, l.text.slice(0, 300));
  });

  test('batch summary: foreign ids are reported as notFound, never returned', async () => {
    const body = { ids: ['VJ-QA-L0001', 'TB-QA-L0001', 'VJ-QZ-L9999'] };
    for (const token of [null, ownerA.token]) {
      const x = await req('POST', '/lots/batch-summary', body, { token });
      assert.equal(x.r.status, 200, x.text.slice(0, 300));
      assert.deepEqual(x.body.data.map(d => d.id), ['VJ-QA-L0001']);
      assert.deepEqual(x.body.meta.notFound.sort(), ['TB-QA-L0001', 'VJ-QZ-L9999']);
      assert.equal(x.text.includes('Empreendimento Teste B'), false);
    }
    const b = await req('POST', '/lots/batch-summary', body, { token: viewerB.token });
    assert.deepEqual(b.body.data.map(d => d.id).sort(), ['TB-QA-L0001', 'VJ-QA-L0001']);
  });

  test('database constraints: slug unique per organization; composite FK rejects a mismatched organization; unknown tenant key fails closed', async () => {
    await assert.rejects(q(`INSERT INTO developments (id, organization_id, code, name, slug) VALUES ('dup-slug', 'org_house7', 'DS', 'Dup', 'viva-juara')`), e => e.code === '23505');
    await assert.rejects(q("UPDATE lots SET organization_id = 'org_test_b' WHERE id = 'VJ-QA-L0001'"), e => e.code === '23503');
    await assert.rejects(q("UPDATE lot_availability SET organization_id = 'org_test_b' WHERE lot_id = 'VJ-QA-L0001'"), e => e.code === '23503');
    await assert.rejects(q(`INSERT INTO developments (id, tenant_id, code, name, slug) VALUES ('ghost', 'unknown-tenant', 'GH', 'Ghost', 'ghost')`), e => e.code === '23502');
    const [r] = await q(`INSERT INTO developments (id, tenant_id, code, name, slug) VALUES ('legacy-h7', 'house7', 'LH', 'Legacy', 'legacy-h7') RETURNING organization_id, visibility`);
    assert.deepEqual(r, { organization_id: 'org_house7', visibility: 'PUBLIC' }); // legacy tenant key map + organization default
    await q("DELETE FROM developments WHERE id = 'legacy-h7'");
  });

  test('X-Organization-Id is a validated selector, never a source of access', async () => {
    const bad = await get(srv, '/me', { token: ownerA.token, headers: { 'X-Organization-Id': 'house-7; DROP' } });
    contract.assertApiError(bad.r, bad.body, 400, 'VALIDATION_ERROR');
    const foreign = await get(srv, '/me', { token: ownerA.token, headers: { 'X-Organization-Id': 'org_test_b' } });
    contract.assertApiError(foreign.r, foreign.body, 404, 'ORGANIZATION_NOT_FOUND');
    const anon = await get(srv, '/me', { headers: { 'X-Organization-Id': 'org_house7' } });
    contract.assertApiError(anon.r, anon.body, 404, 'ORGANIZATION_NOT_FOUND');
    const own = await get(srv, '/me', { token: ownerB.token, headers: { 'X-Organization-Id': 'org_test_b' } });
    assert.equal(own.body.data.organizationId, 'org_test_b'); assert.equal(own.body.data.tenantResolvedBy, 'HEADER_SELECTOR');
    // the header never widens access to a resource: org A user + org B header on org B lot → still 404
    const x = await get(srv, '/lots/TB-QA-L0001', { token: ownerA.token, headers: { 'X-Organization-Id': 'org_test_b' } });
    contract.assertApiError(x.r, x.body, 404, 'LOT_NOT_FOUND');
  });

  test('a user with two memberships must select the organization', async () => {
    const both = await provision(db.pool, { organizationId: 'org_house7', displayName: 'Dois', roles: [{ roleCode: 'VIEWER' }] });
    await q("INSERT INTO organization_memberships (organization_id, user_id, status) VALUES ('org_test_b', $1, 'ACTIVE')", [both.userId]);
    const x = await get(srv, '/me', { token: both.token });
    assert.equal(x.body.data.organizationId, null); assert.equal(x.body.data.organizationSelectionRequired, true);
    assert.equal(x.body.data.memberships.length, 2);
    // membership without role grants nothing in org B: dev-b stays invisible
    const l = await get(srv, '/developments/dev-b', { token: both.token });
    contract.assertApiError(l.r, l.body, 404, 'DEVELOPMENT_NOT_FOUND');
  });
});
