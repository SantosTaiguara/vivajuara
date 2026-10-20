'use strict';
// Topic 48 — cache architecture: keys + partitions, policy registry, freshness vs domain freshness, strategies, ETag/304,
// pointer + immutable artifact, dependency invalidation, security lifecycle (logout, tenant, permission, share), integrity,
// atomic writes, schema migration, quota/eviction, persistent-store failure, multi-tab, reconnect, query fingerprints,
// diagnostics, the cache taxonomy and the Service Worker rules generated from the registry. Golden scenarios of §355.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
require('./node_modules/fake-indexeddb/auto');
const { load, SRC, DATA } = require('./harness.js');

const MODS = ['loading/resources.js', 'loading/coordinator.js', 'loading/planner.js', 'cache/cacheCore.js', 'cache/cacheManager.js'];
const App = load(); for (const f of MODS) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
const R = App.loading.resources, C = App.cache.core, M = App.cache.manager, CO = App.loading.coordinator;
const ORG = 'house7', DEV = 'viva-juara';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const PUB = { organizationId: ORG, principalScope: 'PUBLIC' };
const key = (type, o = {}, part = PUB, schema = '1') => C.makeCacheKey({ organizationId: o.org || ORG, developmentId: DEV, type, resourceId: o.id || type.toLowerCase(), version: o.version, variant: o.variant }, { ...part, organizationId: o.org || part.organizationId }, schema);
/** clock under test control */
function clock(t0 = Date.parse('2026-10-11T12:00:00Z')) { let t = t0; const f = () => t; f.advance = ms => { t += ms; }; return f; }
function mgr(o = {}) { const now = o.now || clock(); const kv = o.kv || M.memoryKv(); return { m: M.CacheManager({ now, persistent: o.noPersistent ? null : M.PersistentCacheStore(kv), ...o.extra }), kv, now }; }
const env = (value, meta = {}) => M.envelope(value, meta);

// ------------------------------------------------------------------ keys
test('CacheKey = ResourceKey + partition + schema; tenant, principal and schema change the key; tokens never enter keys', () => {
  const a = C.serializeCacheKey(key('LOT_QUICK_VIEW', { id: 'L327' }, { organizationId: ORG, principalScope: 'ORGANIZATION' }));
  assert.notEqual(a, C.serializeCacheKey(key('LOT_QUICK_VIEW', { id: 'L327', org: 'org-b' }, { organizationId: 'org-b', principalScope: 'ORGANIZATION' })), 'CacheTenantIsolation: same resourceId, other org');
  assert.notEqual(a, C.serializeCacheKey(key('LOT_QUICK_VIEW', { id: 'L327' }, { organizationId: ORG, principalScope: 'ORGANIZATION' }, '2')));
  assert.throws(() => C.makePartition({ organizationId: ORG, principalScope: 'USER' }), e => e.code === 'PRINCIPAL_REQUIRED');
  assert.throws(() => C.makePartition({ organizationId: ORG, principalScope: 'SHARE_SESSION', principalId: 'eyJhbGciOi.x.y' }), e => e.code === 'TOKEN_IN_KEY');
  assert.throws(() => C.makeCacheKey({ organizationId: ORG, type: 'LOT_QUICK_VIEW', resourceId: 'x' }, { organizationId: 'org-b' }), e => e.code === 'PARTITION_TENANT_MISMATCH');
  const ref = C.sharePartitionRef('st_secret_token_value');
  assert.match(ref, /^shr_[0-9a-f]{16}$/); assert.ok(!ref.includes('secret'));
  assert.throws(() => C.makeCacheKey({ organizationId: ORG, type: 'GEOMETRY_BUNDLE', resourceId: 'lots', version: 'current' }, PUB), e => e.code === 'POINTER_AS_VERSION');
});

test('CacheQueryCanonicalFingerprint: equivalent filters → same key; relevant change → other key; free text hashed', () => {
  const a = C.queryFingerprint({ status: ['AVAILABLE', 'UNKNOWN'], minArea: 300, text: 'Quadra B ' }, { unordered: ['status'] });
  const b = C.queryFingerprint({ text: 'quadra b', minArea: 300, status: ['UNKNOWN', 'AVAILABLE'], empty: '' }, { unordered: ['status'] });
  assert.equal(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, C.queryFingerprint({ status: ['AVAILABLE'], minArea: 300, text: 'Quadra B' }, { unordered: ['status'] }).fingerprint);
  assert.ok(!a.canonical.toLowerCase().includes('quadra'), 'no raw text in the fingerprint input kept');
});

// ------------------------------------------------------------------ registry
test('CachePolicyRegistry: one policy per resource type, no universal TTL, sensitive never persists, unknown → NO_CACHE', () => {
  assert.deepEqual(C.validateRegistry(), { ok: true, errors: [] });
  const ttls = new Set(Object.values(C.POLICIES).map(p => `${p.strategy}:${p.softTtlMs}:${p.hardTtlMs}`));
  assert.ok(ttls.size > 5, 'different TTLs per resource type');
  for (const t of ['CUSTOMER_SUMMARY', 'CUSTOMER_PROFILE', 'JOURNEY_TIMELINE', 'SHARE_RESOURCE', 'RECOMMENDATION_RESULT', 'PRESENTATION_SNAPSHOT', 'DOCUMENT_PREVIEW']) {
    const p = C.getPolicy(t); assert.equal(p.persistentEnabled, false, t); assert.equal(p.strategy, 'MEMORY_ONLY', t); assert.equal(p.clearOnLogout, true, t);
  }
  assert.equal(C.getPolicy('AUTH_TOKEN').strategy, 'NO_CACHE');
  assert.equal(C.getPolicy('SOMETHING_NEW').strategy, 'NO_CACHE');
  assert.equal(C.getPolicy('GEOMETRY_BUNDLE').strategy, 'IMMUTABLE_VERSIONED');
  assert.equal(C.getPolicy('PRICING_SNAPSHOT').strategy, 'NETWORK_FIRST');
  assert.equal(C.getPolicy('AVAILABILITY_SNAPSHOT').strategy, 'NETWORK_FIRST');
  assert.notEqual(C.getPolicy('PRICING_SNAPSHOT').strategy, 'STALE_WHILE_REVALIDATE');
  assert.equal(C.getPolicy('GEOMETRY_BUNDLE', { persistentUnavailable: true }).persistentEnabled, false);
});

test('freshness: cache freshness is technical and separate from domain freshness (a fresh copy of stale data stays labelled)', () => {
  const pol = C.getPolicy('DOCUMENT_METADATA'), t = Date.parse('2026-10-11T12:00:00Z');
  const e = { key: key('DOCUMENT_METADATA'), value: 1, ...C.stamp(pol, t) };
  assert.equal(C.evaluateFreshness(e, pol, t + 1000), 'FRESH');
  assert.equal(C.evaluateFreshness(e, pol, t + pol.softTtlMs + 1), 'STALE_REVALIDATABLE');
  assert.equal(C.evaluateFreshness(e, pol, t + pol.hardTtlMs + 1), 'STALE_REVALIDATABLE', 'within maxStale');
  assert.equal(C.evaluateFreshness(e, pol, t + pol.hardTtlMs + pol.maxStaleMs + 1), 'EXPIRED');
  // a just-downloaded availability snapshot whose source says STALE: cache FRESH, domain STALE → still labelled
  const u = C.useDecision({ policy: C.getPolicy('AVAILABILITY_SNAPSHOT'), status: 'HIT_FRESH', domainFreshness: 'STALE' });
  assert.ok(u.labels.includes(C.LABELS.AVAILABILITY_LAST_KNOWN));
  assert.deepEqual(C.availabilityDisplay('UNKNOWN', { cacheStatus: 'HIT_FRESH', domainFreshness: 'FRESH' }), { status: 'UNKNOWN', claimCurrent: false, label: 'Status não confirmado' });
  assert.equal(C.availabilityDisplay('AVAILABLE', { cacheStatus: 'HIT_STALE', domainFreshness: 'STALE' }).claimCurrent, false, 'cached AVAILABLE is never "disponível agora"');
  assert.equal(C.priceDisplay(348000, { cacheStatus: 'HIT_STALE', domainFreshness: 'STALE' }).label, C.LABELS.PRICE_LAST_KNOWN);
  assert.equal(C.priceDisplay(null).label, 'Preço não disponível', 'null is never 0');
  assert.equal(C.priceDisplay(348000, { cacheStatus: 'HIT_FRESH', domainFreshness: 'FRESH' }).label, null);
});

// ------------------------------------------------------------------ immutable artifacts
test('CacheGeometryImmutableHit + CacheGeometryPointerUpgrade: V7 served from cache without network; V8 fetched once; V7 kept for history', async () => {
  const { m } = mgr(); let calls = 0;
  const loader = v => async () => { calls++; return env({ lots: v }, { checksum: C.fingerprintOf({ lots: v }) }); };
  const k7 = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' });
  assert.equal((await m.load(k7, loader('V7'))).cache.status, 'MISS');
  const hit = await m.load(k7, loader('V7'));
  assert.equal(hit.cache.status, 'HIT_FRESH'); assert.equal(calls, 1, 'no network payload on hit');
  const k8 = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V8' });
  await m.load(k8, loader('V8')); await m.load(k8, loader('V8'));
  assert.equal(calls, 2, 'V8 fetched once');
  assert.equal((await m.read(k7)).status, 'HIT_FRESH', 'V7 remains (historical / deep links)');
  // an unversioned "current" request is never persisted as an immutable artifact
  const r = await m.load(key('GEOMETRY_BUNDLE', { id: 'lots' }), async () => env({ x: 1 }));
  assert.ok(r.cache.warnings.includes('UNVERSIONED_NOT_PERSISTED'));
});

test('CacheChecksumCorruptionRecovery: corrupted entry is CORRUPT → deleted → refetched; never used as stale fallback', async () => {
  const { m, kv } = mgr(); let calls = 0;
  const k = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' });
  const loader = async () => { calls++; return env({ lots: 'V7' }, { checksum: C.fingerprintOf({ lots: 'V7' }) }); };
  await m.load(k, loader);
  m.memory.clear();
  const sk = C.serializeCacheKey(k), rec = kv._raw.get(sk); rec.entry.value = { lots: 'tampered' }; kv._raw.set(sk, rec);
  const look = await m.read(k);
  assert.equal(look.status, 'CORRUPT'); assert.equal(look.value, undefined, 'never rendered');
  assert.equal(kv._raw.has(sk), false, 'deleted');
  const r = await m.load(k, loader);
  assert.deepEqual(r.value, { lots: 'V7' }); assert.equal(calls, 2);
  // a payload that does not match its own checksum is rejected and the old good copy stays
  const bad = await m.load(k, async () => env({ lots: 'X' }, { checksum: 'deadbeef' })).catch(e => e);
  assert.equal((await m.read(k)).status, 'HIT_FRESH'); void bad;
  const k2 = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V9' });
  await assert.rejects(m.load(k2, async () => env({ lots: 'X' }, { checksum: 'deadbeef' })), e => e.code === 'CHECKSUM_MISMATCH');
  assert.equal((await m.read(k2)).status, 'MISS');
  assert.equal((await m.inspect()).corruptionCount >= 2, true);
});

test('CacheAnalysisImmutableVersion + CacheHistoricalPriceVersion: A15/PT12 immutable; activation of A16/PT13 keeps old versions readable', async () => {
  const { m } = mgr();
  for (const [t, v] of [['ANALYSIS_VERSION', 'A15'], ['ANALYSIS_VERSION', 'A16'], ['PRICE_TABLE_VERSION', 'PT12'], ['PRICE_TABLE_VERSION', 'PT13']]) await m.load(key(t, { id: t, version: v }), async () => env({ v }, { checksum: C.fingerprintOf({ v }) }));
  await m.handleEvent({ eventType: 'PriceTableActivated', organizationId: ORG, developmentId: DEV, newVersionRefs: { priceTableVersion: 'PT13' } });
  await m.handleEvent({ eventType: 'AnalysisVersionActivated', organizationId: ORG, developmentId: DEV, newVersionRefs: { analysisVersion: 'A16' } });
  assert.deepEqual((await m.read(key('PRICE_TABLE_VERSION', { id: 'PRICE_TABLE_VERSION', version: 'PT12' }))).value, { v: 'PT12' }, 'historical simulation still reads PT12');
  assert.deepEqual((await m.read(key('ANALYSIS_VERSION', { id: 'ANALYSIS_VERSION', version: 'A15' }))).value, { v: 'A15' }, 'report pinned to A15 stays reproducible');
});

// ------------------------------------------------------------------ dynamic commercial data
test('CacheAvailabilityFresh / CacheAvailabilityStaleFallback / CacheAvailabilityReserveRequiresNetwork', async () => {
  const { m } = mgr(); let online = true, rev = 884;
  const k = key('AVAILABILITY_SNAPSHOT', { id: 'sales-mirror' });
  const loader = async () => { if (!online) { const e = new Error('Failed to fetch'); e.code = 'NETWORK'; throw e; } return env({ revision: rev, lots: { L1: 'AVAILABLE', L2: 'UNKNOWN' } }); };
  const r1 = await m.load(k, loader); assert.equal(r1.cache.source, 'NETWORK'); assert.equal(r1.value.revision, 884);
  rev = 885; const r2 = await m.load(k, loader); assert.equal(r2.value.revision, 885, 'network first: soft TTL short, the new revision replaces');
  online = false;
  const r3 = await m.load(k, loader, { actionIntent: 'VIEW' });
  assert.equal(r3.cache.status, 'HIT_STALE'); assert.ok(r3.cache.warnings.includes('AVAILABILITY_LAST_KNOWN')); assert.ok(r3.cache.labels.includes(C.LABELS.AVAILABILITY_LAST_KNOWN));
  assert.ok(r3.cache.restrictions.includes('RESERVE') && r3.cache.restrictions.includes('SHARE_AVAILABLE_NOW'));
  assert.equal(r3.value.lots.L2, 'UNKNOWN', 'UNKNOWN stays UNKNOWN');
  await assert.rejects(m.load(k, loader, { actionIntent: 'RESERVE' }), /Failed to fetch/, 'reserve never uses the last-known copy');
  await assert.rejects(m.load(k, loader, { actionIntent: 'SHARE' }), /Failed to fetch/);
  online = true; const r4 = await m.load(k, loader, { actionIntent: 'RESERVE' }); assert.equal(r4.cache.source, 'NETWORK');
});

test('CachePricingCurrentPointer: price is network-first; offline the last table comes back ONLY with its label; no SWR, no silent freshness', async () => {
  const { m } = mgr(); let online = true;
  const k = key('PRICING_SNAPSHOT', { id: 'commercial' });
  const loader = async () => { if (!online) throw Object.assign(new Error('offline'), { code: 'NETWORK' }); return env({ priceTableVersion: '2026-10-06', pricePerM2: 1196 }); };
  let calls = 0; const counted = async (...a) => { calls++; return loader(...a); };
  await m.load(k, counted); await m.load(k, counted);
  assert.equal(calls, 2, 'every view revalidates the pointer (soft TTL 0)');
  online = false;
  const r = await m.load(k, counted, { actionIntent: 'SIMULATE' });
  assert.equal(r.cache.status, 'HIT_STALE'); assert.deepEqual(r.cache.labels, [C.LABELS.PRICE_LAST_KNOWN]); assert.equal(r.value.pricePerM2, 1196, 'the price itself is untouched');
  await assert.rejects(m.load(k, counted, { actionIntent: 'PROPOSE' }));
  // pricing invalidation does not touch availability or geometry
  await m.load(key('AVAILABILITY_SNAPSHOT', { id: 'sales-mirror' }), async () => env({ revision: 1 }));
  await m.load(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }), async () => env({ g: 1 }));
  await m.handleEvent({ eventType: 'PriceTableActivated', organizationId: ORG, developmentId: DEV });
  assert.notEqual((await m.read(key('AVAILABILITY_SNAPSHOT', { id: 'sales-mirror' }))).status, 'MISS');
  assert.equal((await m.read(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }))).status, 'HIT_FRESH');
  assert.equal((await m.read(k)).status, 'MISS', 'current price pointer invalidated');
});

test('CacheQuickViewDependencyInvalidation: availability 885 → 886 makes the composite stale; no cross-customer reuse', async () => {
  const { m } = mgr();
  const deps = av => C.dependencyFingerprint([{ resourceType: 'ANALYSIS_VERSION', resourceId: 'a', version: 'A15' }, { resourceType: 'PRICE_TABLE_VERSION', resourceId: 'p', version: 'PT13' }, { resourceType: 'AVAILABILITY_SNAPSHOT', resourceId: 'av', revision: av }]);
  const k = key('LOT_QUICK_VIEW', { id: 'L327' }, { organizationId: ORG, principalScope: 'ORGANIZATION' });
  let calls = 0; const loader = av => async () => { calls++; return env({ lot: 'L327', av }, { dependencyFingerprint: deps(av) }); };
  await m.load(k, loader(885), { expectedContext: { dependencyFingerprint: deps(885) } });
  await m.load(k, loader(885), { expectedContext: { dependencyFingerprint: deps(885) } });
  assert.equal(calls, 1, 'same dependencies → memory hit');
  const r = await m.load(k, loader(886), { expectedContext: { dependencyFingerprint: deps(886) } });
  assert.equal(calls, 2); assert.equal(r.value.av, 886, 'recomposed with the new availability');
  assert.equal(C.dependencyFingerprint([{ resourceType: 'A', resourceId: '1' }, { resourceType: 'B', resourceId: '2' }]), C.dependencyFingerprint([{ resourceType: 'B', resourceId: '2' }, { resourceType: 'A', resourceId: '1' }]));
  const kc1 = key('RECOMMENDATION_RESULT', { id: 'r' }, { organizationId: ORG, principalScope: 'CUSTOMER_CONTEXT', principalId: 'c55' });
  const kc2 = key('RECOMMENDATION_RESULT', { id: 'r' }, { organizationId: ORG, principalScope: 'CUSTOMER_CONTEXT', principalId: 'c56' });
  await m.load(kc1, async () => env({ for: 'c55' }));
  assert.equal((await m.read(kc2)).status, 'MISS', 'another customer never reads it');
});

// ------------------------------------------------------------------ security lifecycle
test('CacheCustomerMemoryOnly + CacheUserLogoutPurge: customer data never reaches L2; logout removes it; the next user cannot read it', async () => {
  const { m, kv } = mgr();
  const kc = key('CUSTOMER_SUMMARY', { id: 'c55' }, { organizationId: ORG, principalScope: 'CUSTOMER_CONTEXT', principalId: 'c55' });
  await m.load(kc, async () => env({ name: 'Cliente C55' }));
  assert.equal([...kv._raw.values()].some(r => JSON.stringify(r).includes('C55')), false, 'no IndexedDB by default');
  await m.load(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }), async () => env({ g: 1 }));
  await m.logout({ organizationId: ORG });
  assert.equal((await m.read(kc)).status, 'MISS');
  assert.equal((await m.read(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }))).status, 'HIT_FRESH', 'public artifacts may survive logout');
});

test('CachePermissionRevocation + CacheShareRevocation + privacy deletion: removed immediately, not at TTL', async () => {
  const { m } = mgr();
  const kp = key('PERMISSIONS', { id: 'u1' }, { organizationId: ORG, principalScope: 'USER', principalId: 'u1', permissionRevision: '7' });
  const kd = key('DOCUMENT_METADATA', { id: 'd1' }, { organizationId: ORG, principalScope: 'ORGANIZATION', permissionRevision: '7' });
  await m.load(kp, async () => env({ can: ['customer.read'] })); await m.load(kd, async () => env({ title: 'x' }));
  await m.permissionRevisionChanged({ organizationId: ORG, principalId: 'u1', permissionRevision: '8' });
  assert.equal((await m.read(kp)).status, 'MISS'); assert.equal((await m.read(kd)).status, 'MISS');
  const ref = C.sharePartitionRef('share-session-1');
  const ks = key('SHARE_RESOURCE', { id: 'snap' }, { organizationId: ORG, principalScope: 'SHARE_SESSION', principalId: ref });
  await m.load(ks, async () => env({ step: 1 }));
  assert.equal((await m.load(ks, async () => env({ step: 2 }))).value.step, 2, 'share resources revalidate the grant on every use (no stale grant)');
  await m.shareRevoked({ organizationId: ORG, shareSessionRef: ref });
  assert.equal((await m.read(ks)).status, 'MISS');
  const kcu = key('CUSTOMER_PROFILE', { id: 'c9' }, { organizationId: ORG, principalScope: 'CUSTOMER_CONTEXT', principalId: 'c9' });
  await m.load(kcu, async () => env({ p: 1 })); await m.privacyDeletion({ organizationId: ORG, customerId: 'c9' });
  assert.equal((await m.read(kcu)).status, 'MISS');
});

test('CacheTenantIsolation: tenant switch clears the old tenant\'s session data; public immutable artifacts keep their own tenant key', async () => {
  const { m } = mgr();
  const qa = key('LOT_QUICK_VIEW', { id: 'L1' }, { organizationId: ORG, principalScope: 'ORGANIZATION' });
  const ga = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' });
  await m.load(qa, async () => env({ a: 1 })); await m.load(ga, async () => env({ g: 1 }));
  await m.switchTenant('org-b');
  assert.equal((await m.read(qa)).status, 'MISS');
  assert.equal((await m.read(ga)).status, 'HIT_FRESH');
  assert.equal((await m.read(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7', org: 'org-b' }, { organizationId: 'org-b', principalScope: 'PUBLIC' }))).status, 'MISS', 'never reused under the wrong tenant key');
  await assert.rejects(m.invalidate({ resourceTypes: ['X'] }), e => e.code === 'TENANT_REQUIRED');
});

// ------------------------------------------------------------------ HTTP validation / SWR
test('CacheEtag304Revalidation: If-None-Match sent; 304 refreshes freshness without a new payload; a new ETag downloads', async () => {
  const pol = C.getPolicy('DOCUMENT_METADATA'), now = clock(), { m } = mgr({ now });
  const k = key('DOCUMENT_METADATA', { id: 'docs' }, { organizationId: ORG, principalScope: 'ORGANIZATION' });
  const sent = []; let etag = 'abc', payloads = 0;
  const loader = async ({ etag: inm }) => { sent.push(inm || null); if (inm && inm === etag) return { notModified: true }; payloads++; return env({ list: etag }, { etag }); };
  await m.load(k, loader); now.advance(pol.hardTtlMs + pol.maxStaleMs + 1);
  const r = await m.load(k, loader);
  assert.equal(r.cache.source, 'NETWORK_304'); assert.equal(payloads, 1); assert.deepEqual(sent, [null, 'abc']);
  assert.equal((await m.read(k)).status, 'HIT_FRESH', 'validatedAt/staleAt/expiresAt refreshed');
  etag = 'def'; now.advance(pol.hardTtlMs + pol.maxStaleMs + 1);
  const r2 = await m.load(k, loader); assert.equal(r2.value.list, 'def'); assert.equal(payloads, 2);
  assert.equal(m.metrics.by().DOCUMENT_METADATA.revalidation304, 1);
});

test('CacheStaleWhileRevalidateSingleFlight: stale served at once, ONE background revalidation for five readers, new value commits', async () => {
  const pol = C.getPolicy('DOCUMENT_METADATA'), now = clock(), { m } = mgr({ now });
  const k = key('DOCUMENT_METADATA', { id: 'docs' }, { organizationId: ORG, principalScope: 'ORGANIZATION' });
  let calls = 0, v = 1; const gate = []; const loader = async () => { calls++; if (calls > 1) await new Promise(r => gate.push(r)); return env({ v }); };
  await m.load(k, loader); now.advance(pol.softTtlMs + 1); v = 2;
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => m.load(k, loader)));
  assert.ok(rs.every(r => r.cache.status === 'HIT_STALE' && r.value.v === 1));
  assert.equal(calls, 2, 'single flight');
  gate.forEach(f => f()); await tick(5);
  assert.equal((await m.read(k)).value.v, 2);
  // a policy that does not allow SWR blocks for the network (price)
  const kp = key('PRICING_SNAPSHOT', { id: 'commercial' }); let pc = 0;
  await m.load(kp, async () => { pc++; return env({ p: pc }); }); const rp = await m.load(kp, async () => { pc++; return env({ p: pc }); });
  assert.equal(rp.cache.source, 'NETWORK'); assert.equal(rp.value.p, 2);
});

// ------------------------------------------------------------------ integrity / atomic / schema
test('CacheAtomicWriteRollback: interrupted write never activates staging; old committed entry stays; leftovers cleaned', async () => {
  const kv = M.memoryKv(), st = M.PersistentCacheStore(kv), now = Date.parse('2026-10-11T12:00:00Z');
  const k = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }), pol = C.getPolicy('GEOMETRY_BUNDLE');
  const e1 = { key: k, value: { g: 'old' }, resourceVersion: 'V7', checksum: C.fingerprintOf({ g: 'old' }), ...C.stamp(pol, now), securityClass: 'PUBLIC_SAFE' };
  await st.put(e1);
  const t = await st.write([{ ...e1, value: { g: 'new' } }], { interruptAfterStaging: true });
  assert.equal(t.status, 'FAILED');
  assert.deepEqual((await st.get(k)).value, { g: 'old' }, 'old good entry untouched');
  await assert.rejects(st.write([{ ...e1, value: { g: 'new' } }], { crashOnCommit: true }));
  assert.deepEqual((await st.get(k)).value, { g: 'old' });
  assert.equal(await st.recover(), 1, 'staging leftover removed on start');
  assert.equal([...kv._raw.keys()].filter(x => x.startsWith('stg|')).length, 0);
});

test('CacheSchemaMigrationInvalidate: compatible migration kept; no migration → invalidated; failing migration → invalidated', async () => {
  const migs = C.SchemaMigrationRegistry();
  migs.register({ resourceType: 'DOCUMENT_METADATA', fromSchemaVersion: '1', toSchemaVersion: '2', migrate: v => ({ ...v, migrated: true }) });
  migs.register({ resourceType: 'SEARCH_INDEX', fromSchemaVersion: '1', toSchemaVersion: '2', migrate: () => { throw new Error('x'); } });
  const { m } = mgr({ extra: { migrations: migs } });
  const k1 = key('DOCUMENT_METADATA', { id: 'd' }, { organizationId: ORG, principalScope: 'ORGANIZATION' });
  await m.load(k1, async () => env({ a: 1 }));
  const r = await m.read(key('DOCUMENT_METADATA', { id: 'd' }, { organizationId: ORG, principalScope: 'ORGANIZATION' }, '2'));
  assert.deepEqual(r.value, { a: 1, migrated: true });
  assert.equal((await m.read(k1)).status, 'MISS', 'the old-schema copy moved to the new key');
  // no migration: the new schema simply misses (refetch); the orphan old-schema entry is removed on APP_UPDATE
  const k2 = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' });
  await m.load(k2, async () => env({ g: 1 }));
  assert.equal((await m.read(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }, PUB, '2'))).status, 'MISS');
  const { m: mu } = mgr({ extra: { migrations: migs, schemaVersions: { GEOMETRY_BUNDLE: '2' } } });
  await mu.load(k2, async () => env({ g: 1 }));
  const res = await mu.maintenance('APP_UPDATE'); assert.equal(res.removedSchema, 1);
  assert.equal((await mu.read(k2)).status, 'MISS');
  // failing migration → INVALID (the cache is disposable), never a half-migrated value
  const k3 = key('SEARCH_INDEX', { id: 'lots' }); await m.load(k3, async () => env({ s: 1 }));
  assert.equal((await m.read(key('SEARCH_INDEX', { id: 'lots' }, PUB, '2'))).status, 'INVALID');
});

// ------------------------------------------------------------------ quota / failure / maintenance
test('CacheQuotaEviction: high watermark → evict unused prefetch, old high-res and non-current first; current geometry and active entries protected', async () => {
  const { m } = mgr({ extra: { budget: { maxTotalBytes: 2000, maxBytesByResourceType: {} } } });
  const big = n => 'x'.repeat(n);
  await m.load(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V8' }), async () => env({ s: big(300) }));
  await m.load(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }), async () => env({ s: big(300) }));
  await m.load(key('TECHNICAL_ANALYSIS_INPUT', { id: 'analysis-input', version: 'c1' }), async () => env({ s: big(300) }), { origin: 'PREFETCH' });
  await m.load(key('BASE_MAP_HIGH', { id: 'aerial', version: 'c2' }), async () => env({ s: big(200) }));
  const active = new Set([C.serializeCacheKey(key('BASE_MAP_HIGH', { id: 'aerial', version: 'c2' }))]);
  const r = await m.evictToLowWatermark({ isCurrent: e => e.key.resource.version !== 'V7', activeKeys: active });
  assert.ok(r.removed >= 1 && r.afterBytes <= 2000 * 0.7, JSON.stringify(r));
  assert.equal((await m.read(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V8' }))).status, 'HIT_FRESH', 'current geometry protected');
  assert.equal((await m.read(key('BASE_MAP_HIGH', { id: 'aerial', version: 'c2' }))).status, 'HIT_FRESH', 'active entry protected');
  const order = C.evictionCandidates([
    { key: key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V8' }), sizeBytes: 10 },
    { key: key('TECHNICAL_ANALYSIS_INPUT', { id: 'ai', version: 'c' }), sizeBytes: 10, origin: 'PREFETCH' },
    { key: key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V6' }), sizeBytes: 10 }], { isCurrent: e => e.key.resource.version !== 'V6' }).map(c => c.key.resource.version);
  assert.deepEqual(order, ['c', 'V6', 'V8']);
});

test('CachePersistentStoreUnavailable + quota write failure: degrade to memory + network, never crash', async () => {
  const kv = M.memoryKv(); const { m } = mgr({ kv });
  const k = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' });
  kv._failNext(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
  const r = await m.load(k, async () => env({ g: 1 }));
  assert.deepEqual(r.value, { g: 1 }, 'the app keeps working');
  const { m: m2 } = mgr({ noPersistent: true });
  assert.deepEqual((await m2.load(k, async () => env({ g: 2 }))).value, { g: 2 });
  assert.equal((await m2.read(k)).status, 'HIT_FRESH', 'memory still works');
  const broken = { get: async () => { throw new Error('IDB gone'); }, all: async () => { throw new Error('IDB gone'); }, tx: async () => { throw new Error('IDB gone'); } };
  const m3 = M.CacheManager({ persistent: M.PersistentCacheStore(broken) });
  assert.deepEqual((await m3.load(k, async () => env({ g: 3 }))).value, { g: 3 });
  assert.equal(m3.isDegraded(), true);
  assert.ok((await m3.inspect()).warnings.includes('PERSISTENT_DEGRADED'));
  assert.equal(M.detectCapabilities({}).indexedDb, false);
});

test('IndexedDB L2 (ws-cache-l2, separate from ws-cache v1): commit, read back after restart, maintenance removes expired', async () => {
  const name = `l2-${process.pid}-${Date.now()}`, now = clock();
  const m = M.CacheManager({ now, persistent: M.PersistentCacheStore(M.idbKv(indexedDB, name)) });
  const k = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' });
  await m.load(k, async () => env({ g: 1 }, { checksum: C.fingerprintOf({ g: 1 }) }));
  const m2 = M.CacheManager({ now, persistent: M.PersistentCacheStore(M.idbKv(indexedDB, name)) });
  const r = await m2.read(k); assert.equal(r.status, 'HIT_FRESH'); assert.equal(r.source, 'INDEXED_DB'); assert.deepEqual(r.value, { g: 1 });
  const kb = key('MAP_BOOTSTRAP', { id: 'manifest' });
  await m2.load(kb, async () => env({ v: 1 }));
  now.advance(31 * 24 * 3600e3);
  const res = await m2.maintenance('IDLE');
  assert.equal(res.removedExpired >= 1, true);
  assert.equal((await m2.read(k)).status, 'HIT_FRESH', 'immutable artifacts do not expire');
});

// ------------------------------------------------------------------ coherence / reconnect
test('CacheMultiTabInvalidation: only metadata crosses tabs; tab B invalidates availability-related memory and logs out with A', async () => {
  const bus = new Set();
  class FakeBC { constructor() { this.onmessage = null; bus.add(this); } postMessage(d) { for (const o of bus) if (o !== this && o.onmessage) o.onmessage({ data: JSON.parse(JSON.stringify(d)) }); } close() { bus.delete(this); } }
  const mk = () => M.CacheManager({ channelFactory: onMessage => M.CoherenceChannel({ BroadcastChannelImpl: FakeBC, onMessage }) });
  const A = mk(), B = mk();
  const kq = key('LOT_QUICK_VIEW', { id: 'L1' }, { organizationId: ORG, principalScope: 'ORGANIZATION' }), kg = key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' });
  await B.load(kq, async () => env({ q: 1 })); await B.load(kg, async () => env({ g: 1 }));
  await A.handleEvent({ eventType: 'AvailabilityRevisionPublished', organizationId: ORG, developmentId: DEV, newVersionRefs: { availabilityRevision: 886 } });
  await tick(5);
  assert.equal((await B.read(kq)).status, 'MISS'); assert.equal((await B.read(kg)).status, 'HIT_FRESH');
  const kc = key('CUSTOMER_SUMMARY', { id: 'c1' }, { organizationId: ORG, principalScope: 'CUSTOMER_CONTEXT', principalId: 'c1' });
  await B.load(kc, async () => env({ n: 'x' })); await A.logout({ organizationId: ORG }); await tick(5);
  assert.equal((await B.read(kc)).status, 'MISS', 'logout broadcast');
  const ch = M.CoherenceChannel({ BroadcastChannelImpl: null });
  const s = ch.sanitize({ type: 'CACHE_INVALIDATE', organizationId: ORG, resourceTypes: ['X'], value: { customer: 'C55' }, token: 'secret' });
  assert.deepEqual(Object.keys(s).sort(), ['organizationId', 'resourceTypes', 'type']);
  assert.equal(ch.sanitize({ type: 'PAYLOAD', data: 1 }), null);
});

test('CacheReconnectDynamicRevalidation: after offline/background, availability and price are due for revalidation; geometry is not refetched', async () => {
  const pol = C.getPolicy('DOCUMENT_METADATA'); void pol;
  const { m } = mgr(); let geo = 0;
  await m.load(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }), async () => { geo++; return env({ g: 1 }); });
  await m.load(key('AVAILABILITY_SNAPSHOT', { id: 'sales-mirror' }), async () => env({ r: 1 }));
  assert.deepEqual(m.markDueForRevalidation({ hiddenForMs: 1000 }), [], 'short background: nothing');
  assert.deepEqual(m.onReconnect(), ['AVAILABILITY_SNAPSHOT']);
  await m.load(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }), async () => { geo++; return env({ g: 1 }); });
  assert.equal(geo, 1);
});

// ------------------------------------------------------------------ coordinator integration, manifests, diagnostics, SW rules
test('LoadCoordinator → CacheManager: coordinator owns priority/dedup, the cache owns reuse; second request is a cache hit', async () => {
  const cache = M.CacheManager({ persistent: M.PersistentCacheStore(M.memoryKv()) }); let calls = 0;
  const reg = R.ResourceRegistry({ organizationId: ORG, developmentId: DEV, dev: App.config.DEVELOPMENTS[0] });
  const coord = CO.LoadCoordinator({ organizationId: ORG, developmentId: DEV, cache, loaders: { json: async ({ etag }) => { calls++; return env({ n: calls }, { etag: 'e1' }); } } });
  const d = reg.descriptor('TECHNICAL_ANALYSIS_INPUT', { version: 'chk1' }), ck = key('TECHNICAL_ANALYSIS_INPUT', { id: 'analysis-input', version: 'chk1' });
  const [a, b] = await Promise.all([coord.request(d, { cacheKey: ck }), coord.request(d, { cacheKey: ck })]);
  assert.equal(calls, 1); assert.equal(a.state, 'READY'); assert.deepEqual(b.data, { n: 1 });
  const c = await coord.request(d, { cacheKey: ck });
  assert.equal(c.cache.status, 'HIT_FRESH'); assert.equal(calls, 1);
});

test('ResourceVersionManifest from manifest.json ≠ CacheManifest; pointer moves emit selective events', () => {
  const v1 = C.resourceVersionManifest(MANIFEST, ORG);
  assert.equal(v1.geometryVersion, MANIFEST.staticVersion); assert.equal(v1.analysisVersion, MANIFEST.analysisVersion); assert.equal(v1.availabilityRevision, undefined);
  assert.match(v1.checksum, /^[0-9a-f]{16}$/);
  const v2 = C.resourceVersionManifest({ ...MANIFEST, analysisVersion: '2026-11-01', commercialRevision: 2 }, ORG);
  assert.deepEqual(C.versionEvents(v1, v2).map(e => e.eventType), ['AnalysisVersionActivated', 'PriceTableActivated']);
  assert.deepEqual(C.versionEvents(v1, v1), []);
  const cm = C.cacheManifest([{ key: key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }), sizeBytes: 5 }], { organizationId: ORG });
  assert.equal(cm.kind, 'cache-manifest-local'); assert.equal(cm.entriesByResourceType.GEOMETRY_BUNDLE.count, 1); assert.notEqual(cm.kind, MANIFEST.kind);
});

test('diagnostics: hit/miss/stale metrics by resource type; inspector never shows principal ids, values or tokens', async () => {
  const { m } = mgr();
  const kc = key('CUSTOMER_SUMMARY', { id: 'c55' }, { organizationId: ORG, principalScope: 'CUSTOMER_CONTEXT', principalId: 'c55' });
  await m.load(kc, async () => env({ name: 'Maria' })); await m.read(kc);
  await m.load(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }), async () => env({ g: 1 })); await m.read(key('GEOMETRY_BUNDLE', { id: 'lots', version: 'V7' }));
  const d = await m.inspect(), s = JSON.stringify(d);
  assert.ok(!s.includes('c55') && !s.includes('Maria'), 'no sensitive ids or values');
  assert.equal(d.hitRateByResourceType.GEOMETRY_BUNDLE, 0.5);
  assert.ok(d.rows.some(r => r.kind === 'IMMUTABLE ARTIFACT'));
});

test('cache taxonomy + legacy inventory describe every physical cache; the Service Worker rules come from the registry', () => {
  for (const t of C.CacheTaxonomy) for (const f of ['id', 'layer', 'store', 'holds', 'key', 'version', 'invalidation', 'security']) assert.ok(t[f] != null, t.id + '.' + f);
  assert.ok(C.CacheTaxonomy.some(t => /ws-cache v1/.test(t.store)) && C.CacheTaxonomy.some(t => /ws-runtime-v1/.test(t.store)));
  assert.ok(C.LegacyCacheInventory.some(i => i.migrationAction === 'ADD_VERSION' && /img/.test(i.location)));
  const rules = require('../scripts/cacheRules.js').rules(App);
  const by = Object.fromEntries(rules.filter(r => r.resourceType).map(r => [r.resourceType, r.strategy]));
  assert.equal(by.PRICING_SNAPSHOT, 'NETWORK_ONLY', 'price never in an anonymous Cache Storage response');
  assert.equal(by.MAP_BOOTSTRAP, 'NETWORK_ONLY'); assert.equal(by.GEOMETRY_BUNDLE, 'NETWORK_ONLY'); assert.equal(by.TECHNICAL_ANALYSIS_INPUT, 'NETWORK_ONLY');
  assert.equal(by.MOBILITY_ROUTES, 'NETWORK_FIRST'); assert.equal(by.GALLERY_IMAGE, 'CACHE_FIRST');
  assert.equal(rules[0].strategy, 'BYPASS');
  const sw = path.join(DATA, 'sw.js');
  if (fs.existsSync(sw)) { const src = fs.readFileSync(sw, 'utf8'); if (!src.includes('__CACHE_RULES__') && src.includes('COMPILED')) assert.ok(src.includes('"pricing_snapshot"')); }
  // the template runs without a build (fallback table) and refuses to cache non-OK responses
  const tpl = fs.readFileSync(path.join(SRC, 'sw.template.js'), 'utf8');
  assert.ok(/storable/.test(tpl) && /no-store/.test(tpl) && /authorization/.test(tpl));
});
