'use strict';
// Topic 47 — lazy loading and progressive loading: resource identity, dependency graph, plans, coordinator (dedup,
// cancellation, stale protection, priority, retry), readiness, prefetch policy, budgets, and the wiring in data/offline.js
// (parallel first-visit requests, boot sync reuse, asset download dedup). Golden scenarios named after the spec (§302).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC, DATA, publishedStatus } = require('./harness.js');

const MODS = ['loading/resources.js', 'loading/coordinator.js', 'loading/planner.js', 'loading/loadingView.js', 'cache/cacheCore.js', 'cache/cacheManager.js'];
function boot(opts) { const App = load(opts); for (const f of MODS) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App); return App; }
const App = boot(), R = App.loading.resources, CO = App.loading.coordinator, PL = App.loading.planner, V = App.loadingView;
const ORG = 'house7', DEV = 'viva-juara';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const plain = x => JSON.parse(JSON.stringify(x));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
/** deferred promise helper */
const defer = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
const reg = R.ResourceRegistry({ organizationId: ORG, developmentId: DEV, manifest: MANIFEST, dev: App.config.DEVELOPMENTS[0] });

// ------------------------------------------------------------------ ResourceKey
test('ResourceKey: tenant required, "current" is never a version, URL is never identity, canonical serialization', () => {
  assert.throws(() => R.makeKey({ type: 'GEOMETRY_BUNDLE', resourceId: 'lots' }), e => e.code === 'TENANT_REQUIRED');
  assert.throws(() => R.makeKey({ organizationId: ORG, type: 'GEOMETRY_BUNDLE', resourceId: 'lots', version: 'current' }), e => e.code === 'POINTER_AS_VERSION');
  assert.throws(() => R.makeKey({ organizationId: ORG, type: 'GEOMETRY_BUNDLE', resourceId: 'https://x/lots.json' }), e => e.code === 'URL_AS_IDENTITY');
  assert.throws(() => R.makeKey({ organizationId: ORG, type: 'NOPE', resourceId: 'x' }), e => e.code === 'UNKNOWN_TYPE');
  const a = R.serializeResourceKey({ resourceId: 'L327', type: 'LOT_QUICK_VIEW', organizationId: ORG, developmentId: DEV });
  const b = R.serializeResourceKey({ developmentId: DEV, organizationId: ORG, type: 'LOT_QUICK_VIEW', resourceId: 'L327' });
  assert.equal(a, b, 'field order does not matter');
  assert.notEqual(a, R.serializeResourceKey({ organizationId: 'outra-org', developmentId: DEV, type: 'LOT_QUICK_VIEW', resourceId: 'L327' }), 'same resourceId in another tenant is another resource');
  // crafted ids cannot collide with the separator
  assert.notEqual(R.serializeResourceKey({ organizationId: ORG, type: 'LOT_QUICK_VIEW', resourceId: 'a|b' }), R.serializeResourceKey({ organizationId: ORG, type: 'LOT_QUICK_VIEW', resourceId: 'a', variant: 'b' }));
  assert.deepEqual(plain(R.parseResourceKey(a)), plain(R.makeKey({ organizationId: ORG, developmentId: DEV, type: 'LOT_QUICK_VIEW', resourceId: 'L327' })));
});

test('registry: every descriptor has a loader id, a security class and a known type; the graph is a DAG without missing dependencies', () => {
  const all = reg.types().map(t => reg.descriptor(t));
  for (const d of all) { assert.ok(d.loaderId, d.key.type); assert.ok(R.SecurityClass[d.securityClass], d.key.type); assert.ok(R.LoadCriticality[d.criticality]); assert.ok(R.LoadPriority[d.defaultPriority]); assert.ok(R.LoadTrigger[d.trigger]); }
  const g = R.ResourceDependencyGraph(all);
  assert.deepEqual(g.cycles(), []);
  assert.deepEqual(g.missing(), []);
  assert.equal(reg.descriptor('GEOMETRY_BUNDLE').resolveUrl(), 'lots.json');
  assert.equal(reg.descriptor('PRICING_SNAPSHOT').resolveUrl(), 'commercial.json');
  // a synthetic cycle is detected and blocks levels()
  const x = { key: R.makeKey({ organizationId: ORG, type: 'LOT_DETAIL_SECTION', resourceId: 'x' }), dependencies: [] }, y = { key: R.makeKey({ organizationId: ORG, type: 'LOT_PRICE_HISTORY', resourceId: 'y' }), dependencies: [] };
  x.dependencies = [y.key]; y.dependencies = [x.key];
  const gc = R.ResourceDependencyGraph([x, y]);
  assert.equal(gc.cycles().length > 0, true);
  assert.throws(() => gc.levels(), e => e.code === 'DEPENDENCY_CYCLE');
});

// ------------------------------------------------------------------ plans
test('LazyMapColdBoot: manifest, geometry bundle and price table in ONE parallel level; no thematic extras, no technical input, no customer data', () => {
  const plan = PL.buildPlan({ context: 'MAP_ROUTE', organizationId: ORG, developmentId: DEV, manifest: MANIFEST, structuralCached: false, backgroundLayer: 'plan' });
  assert.deepEqual(plan.required.map(k => k.type), ['MAP_BOOTSTRAP', 'GEOMETRY_BUNDLE', 'PRICING_SNAPSHOT']);
  const geo = plan.required.find(k => k.type === 'GEOMETRY_BUNDLE');
  assert.equal(geo.version, `${MANIFEST.staticVersion}+${MANIFEST.analysisVersion}`, 'concrete version from the pointer');
  const ds = PL.descriptorsOf(plan, { organizationId: ORG, developmentId: DEV, manifest: MANIFEST });
  const levels = R.ResourceDependencyGraph(plan.required.map(k => ds.get(R.serializeResourceKey(k)))).levels();
  assert.equal(levels.length, 1, 'no waterfall: the three start together');
  const all = [...plan.required, ...plan.deferred, ...plan.speculative].map(k => k.type);
  for (const t of ['TECHNICAL_ANALYSIS_INPUT', 'BASE_MAP_HIGH', 'MOBILITY_ROUTES', 'GALLERY_IMAGE', 'CUSTOMER_SUMMARY', 'JOURNEY_TIMELINE', 'LOT_PRICE_HISTORY']) assert.ok(!all.includes(t), t + ' not on map boot');
  assert.deepEqual(plan.speculative, []);
  assert.ok(plan.deferred.some(k => k.type === 'BASE_MAP_MEDIUM'));
  assert.ok(!plan.deferred.some(k => k.type === 'AVAILABILITY_SNAPSHOT'), 'no availability feed announced → nothing to load (all lots stay UNKNOWN)');
  // warm boot: geometry from the versioned cache; pointer and price revalidated after INTERACTIVE
  const warm = PL.buildPlan({ context: 'MAP_ROUTE', organizationId: ORG, developmentId: DEV, manifest: MANIFEST, structuralCached: true, backgroundLayer: 'aerial' });
  assert.deepEqual(warm.required.map(k => k.type), ['GEOMETRY_BUNDLE']);
  assert.deepEqual(warm.deferred.map(k => k.type).slice(0, 2), ['MAP_BOOTSTRAP', 'PRICING_SNAPSHOT']);
  assert.ok(warm.deferred.some(k => k.type === 'BASE_MAP_HIGH') && !warm.deferred.some(k => k.type === 'BASE_MAP_MEDIUM'));
});

test('deep link to a lot: QuickView is planned together with the map core (no wait for FULLY_ENHANCED)', () => {
  const plan = PL.buildPlan({ context: 'MAP_ROUTE', organizationId: ORG, developmentId: DEV, manifest: MANIFEST, lotId: 'VJ-QB-L0079' });
  assert.ok(plan.required.some(k => k.type === 'LOT_QUICK_VIEW' && k.resourceId === 'VJ-QB-L0079'));
});

test('LazyPriceHistoryOnDemand / sections: selection loads the QuickView only; sections and technical input only when opened', () => {
  const p = PL.buildPlan({ context: 'LOT_SELECTION', organizationId: ORG, developmentId: DEV, manifest: MANIFEST, lotId: 'VJ-QB-L0079' });
  assert.deepEqual(p.required.map(k => k.type), ['LOT_QUICK_VIEW']); assert.deepEqual(p.deferred, []);
  const t = PL.buildPlan({ context: 'LOT_SELECTION', organizationId: ORG, developmentId: DEV, manifest: MANIFEST, lotId: 'VJ-QB-L0079', openSection: 'technical' });
  const tech = t.deferred.find(k => k.type === 'TECHNICAL_ANALYSIS_INPUT');
  assert.ok(tech, 'technical input deferred when the section opens');
  const a = MANIFEST.assets.find(x => x.path === 'analysis-input.json');
  if (a) assert.equal(tech.version, a.checksum, 'versioned by the manifest checksum');
  assert.ok(!t.deferred.some(k => k.type === 'LOT_PRICE_HISTORY'));
});

test('LazyComparisonSummaryFirst / LazyComparisonSectionOnDemand / LazyCustomerSummaryBeforeTimeline', () => {
  const c = PL.buildPlan({ context: 'COMPARISON_ROUTE', organizationId: ORG, developmentId: DEV, comparisonId: 'cmp1' });
  assert.deepEqual(c.required.map(k => k.type), ['COMPARISON_SESSION']); assert.deepEqual(c.deferred, []);
  const c2 = PL.buildPlan({ context: 'COMPARISON_ROUTE', organizationId: ORG, developmentId: DEV, comparisonId: 'cmp1', openGroups: ['ENVIRONMENTAL'] });
  assert.deepEqual(c2.deferred.map(k => k.variant), ['ENVIRONMENTAL']);
  const cu = PL.buildPlan({ context: 'CUSTOMER_ROUTE', organizationId: ORG, developmentId: DEV, customerId: 'c55' });
  assert.deepEqual(cu.required.map(k => k.type), ['CUSTOMER_SUMMARY', 'JOURNEY_SUMMARY']); assert.deepEqual(cu.deferred, []);
  assert.ok(!cu.required.some(k => k.type === 'GEOMETRY_BUNDLE'), 'customer route does not load the map bundle');
  assert.equal(PL.buildPlan({ context: 'CUSTOMER_ROUTE', organizationId: ORG, developmentId: DEV, customerId: 'c55', timelineVisible: true }).deferred[0].type, 'JOURNEY_TIMELINE');
});

test('LazyPresentationCurrentAndNextStep / LazyPresentationDeepLinkDirectStep / Save-Data', () => {
  const p = PL.buildPlan({ context: 'PRESENTATION_ROUTE', organizationId: ORG, developmentId: DEV, presentationSnapshotId: 'ps1', presentationStep: 4, presentationStepCount: 10 });
  assert.deepEqual(p.required.map(k => k.variant || k.type), ['PRESENTATION_SNAPSHOT', 'step:4']);
  assert.deepEqual(p.speculative.map(k => k.variant), ['step:5']);
  const deep = PL.buildPlan({ context: 'PRESENTATION_ROUTE', organizationId: ORG, developmentId: DEV, presentationSnapshotId: 'ps1', presentationStep: 8, presentationStepCount: 10 });
  assert.ok(!deep.required.some(k => ['step:0', 'step:1'].includes(k.variant)), 'step 8 directly, not step 1 then navigate');
  const sd = PL.buildPlan({ context: 'PRESENTATION_ROUTE', organizationId: ORG, developmentId: DEV, presentationSnapshotId: 'ps1', presentationStep: 4, saveData: true });
  assert.deepEqual(sd.speculative, []);
  const last = PL.buildPlan({ context: 'PRESENTATION_ROUTE', organizationId: ORG, developmentId: DEV, presentationSnapshotId: 'ps1', presentationStep: 9, presentationStepCount: 10 });
  assert.deepEqual(last.speculative, []);
});

test('LazyShareMinimalRuntime: share plan is minimal and can never contain customer/journey/admin resources', () => {
  const s = PL.buildPlan({ context: 'SHARE_ROUTE', organizationId: ORG, developmentId: DEV, shareSessionRef: 'shr_1', presentationSnapshotId: 'ps1', presentationStep: 2 });
  assert.deepEqual(s.required.map(k => k.type), ['SHARE_RESOURCE', 'PRESENTATION_STEP_ASSET']);
  for (const k of s.required) assert.ok(!PL.SHARE_FORBIDDEN.has(k.type));
  assert.ok(!s.required.some(k => /tok|Bearer/.test(k.resourceId)), 'no token in keys');
});

// ------------------------------------------------------------------ coordinator
function makeCoord(loaders, o = {}) { return CO.LoadCoordinator({ organizationId: ORG, developmentId: DEV, loaders, sleep: async () => {}, ...o }); }
const qv = id => reg.descriptor('LOT_QUICK_VIEW', { resourceId: id });

test('dedup: the same QuickView requested twice while in flight → one load, two consumers', async () => {
  let calls = 0; const d = defer();
  const c = makeCoord({ compose: async () => { calls++; return d.p; } });
  const a = c.request(qv('L1')), b = c.request(qv('L1'));
  await tick(); d.resolve({ lot: 'L1' });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(ra.state, 'READY'); assert.equal(rb.state, 'READY'); assert.deepEqual(rb.data, { lot: 'L1' });
  assert.equal(c.diagnostics().queue.deduplicated, 1);
});

test('LazyLotRapidSelectionCancellation: 327 → 145 → 201, only 201 commits; late answers are cancelled or discarded', async () => {
  const pend = {};
  const c = makeCoord({ compose: ({ key }) => { const d = defer(); pend[key.resourceId] = d; return d.p; } });
  let cur = null; const select = id => { const s = c.scopes.replace(cur, 'lot:' + id, { kind: 'ENTITY', parent: `dev:${ORG}:${DEV}` }); cur = s.id; return c.request(qv(id), { scopeId: s.id }); };
  const r327 = select('327'); await tick(); const r145 = select('145'); await tick(); const r201 = select('201'); await tick();
  pend['327'] && pend['327'].resolve({ id: '327' }); pend['145'] && pend['145'].resolve({ id: '145' }); pend['201'].resolve({ id: '201' });
  const [a, b, z] = await Promise.all([r327, r145, r201]);
  assert.ok(['CANCELLED', 'DISCARDED_STALE'].includes(a.state)); assert.equal(a.data, undefined);
  assert.ok(['CANCELLED', 'DISCARDED_STALE'].includes(b.state)); assert.equal(b.data, undefined);
  assert.equal(z.state, 'READY'); assert.deepEqual(z.data, { id: '201' });
});

test('stale-result protection when cancellation does not reach the loader: the old answer is DISCARDED_STALE, never committed', async () => {
  const d = defer();
  const desc = reg.descriptor('LOT_DETAIL_SECTION', { resourceId: 'price', abortWhenUnused: false });
  const c = makeCoord({ compose: () => d.p });
  c.openScope('layer:price', 'VIEWPORT');
  const p = c.request(desc, { scopeId: 'layer:price' });
  await tick();
  // the scope is replaced but the loader ignores abort and answers later (non-cancellable resource)
  c.scopes.replace('layer:price', 'layer:noise', { kind: 'VIEWPORT' });
  d.resolve({ layer: 'price' });
  const r = await p;
  assert.ok(['DISCARDED_STALE', 'CANCELLED'].includes(r.state));
  assert.equal(r.data, undefined);
});

test('LazyRapidLayerSwitch: availability → price → noise; the late price answer cannot replace noise', async () => {
  const pend = {}; const c = makeCoord({ compose: ({ key }) => { const d = defer(); pend[key.variant] = d; return d.p; } });
  let scope = null; const pick = layer => { const s = c.scopes.replace(scope, 'layer:' + layer, { kind: 'VIEWPORT' }); scope = s.id; return c.request(reg.descriptor('LOT_DETAIL_SECTION', { resourceId: 'layer', variant: layer }), { scopeId: s.id }); };
  const price = pick('price'); await tick(); const noise = pick('noise'); await tick();
  pend.noise.resolve('noise-values'); if (pend.price) pend.price.resolve('price-values');
  const [rp, rn] = await Promise.all([price, noise]);
  assert.notEqual(rp.state, 'READY'); assert.equal(rn.state, 'READY'); assert.equal(rn.data, 'noise-values');
});

test('LazyPrefetchPreemptedByUserAction: a user action preempts running speculative work; IMMEDIATE runs before queued NORMAL', async () => {
  const order = []; const hold = defer();
  const c = makeCoord({ json: ({ key, signal }) => new Promise((res, rej) => { order.push(key.type); if (key.type === 'TECHNICAL_ANALYSIS_INPUT') { signal.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))); return; } res(key.type); }) }, { budget: { maxNetworkHighPriority: 1, maxNetworkNormalPriority: 1 } });
  const pre = c.request(reg.descriptor('TECHNICAL_ANALYSIS_INPUT'), { origin: 'PREFETCH' });
  await tick();
  const user = c.request(reg.descriptor('PRICING_SNAPSHOT'), { priority: 'IMMEDIATE' });
  const [rp, ru] = await Promise.all([pre, user]);
  assert.equal(rp.state, 'CANCELLED', 'speculative load cancelled by the critical request');
  assert.equal(ru.state, 'READY');
  // ordering: with a single normal slot busy, a later IMMEDIATE starts before the queued NORMAL
  const seen = []; const slow = defer();
  const c2 = makeCoord({ compose: ({ key }) => { seen.push(key.resourceId); return key.resourceId === 'n1' ? slow.p : Promise.resolve(key.resourceId); } }, { budget: { maxNetworkHighPriority: 1, maxNetworkNormalPriority: 1 } });
  const n1 = c2.request(reg.descriptor('LOT_DETAIL_SECTION', { resourceId: 'n1' }), { priority: 'NORMAL' });
  const n2 = c2.request(reg.descriptor('LOT_DETAIL_SECTION', { resourceId: 'n2' }), { priority: 'NORMAL' });
  const im = c2.request(reg.descriptor('LOT_QUICK_VIEW', { resourceId: 'im' }), { priority: 'IMMEDIATE' });
  await tick(5); slow.resolve('n1'); await Promise.all([n1, n2, im]);
  assert.ok(seen.indexOf('im') < seen.indexOf('n2'), 'IMMEDIATE before the queued NORMAL: ' + seen.join(','));
  void hold;
});

test('bounded retry: 403 never retried; network errors retried up to the failure policy; versioned 404 refreshes the pointer once', async () => {
  let n = 0;
  const c = makeCoord({ json: async () => { n++; const e = new Error('HTTP 403'); e.status = 403; throw e; } });
  const r = await c.request(reg.descriptor('PRICING_SNAPSHOT'));
  assert.equal(r.state, 'ERROR'); assert.equal(r.error.code, 'FORBIDDEN'); assert.equal(n, 1);
  n = 0;
  const c2 = makeCoord({ json: async () => { n++; const e = new Error('Failed to fetch'); e.code = 'NETWORK'; e.network = true; throw e; } });
  const r2 = await c2.request(reg.descriptor('PRICING_SNAPSHOT'));
  assert.equal(r2.state, 'ERROR'); assert.equal(r2.error.code, 'NETWORK'); assert.equal(n, 1 + R.failurePolicy('PRICING_SNAPSHOT').maxAutomaticRetries);
  // LazyVersionMismatchRefreshOnce: 404 of a versioned artifact → refresh pointer → retry with the new version, once
  const seen = []; let refreshes = 0;
  const c3 = makeCoord({ json: async ({ key }) => { seen.push(key.version); const e = new Error('HTTP 404'); e.status = 404; throw e; } },
    { hooks: { refreshPointer: async k => { refreshes++; return R.makeKey({ ...k, version: 'v2' }); } } });
  const r3 = await c3.request(reg.descriptor('GEOMETRY_BUNDLE', { version: 'v1' }));
  assert.equal(r3.state, 'ERROR'); assert.equal(r3.error.code, 'NOT_FOUND'); assert.equal(refreshes, 1); assert.deepEqual(seen, ['v1', 'v2'], 'one refresh, one retry, no loop');
});

test('LazyTenantSwitchIsolation / LazyDevelopmentSwitchIsolation: late answers of the old context are discarded; old keys are refused', async () => {
  const d = defer();
  const c = makeCoord({ compose: () => d.p });
  const p = c.request(reg.descriptor('LOT_QUICK_VIEW', { resourceId: 'L1', abortWhenUnused: false }));
  await tick();
  c.switchContext({ organizationId: 'org-b', developmentId: 'dev-b' });
  d.resolve({ from: 'org A' });
  const r = await p;
  assert.ok(['DISCARDED_STALE', 'CANCELLED'].includes(r.state)); assert.equal(r.data, undefined);
  const r2 = await c.request(reg.descriptor('LOT_QUICK_VIEW', { resourceId: 'L1' }));
  assert.equal(r2.state, 'ERROR'); assert.equal(r2.error.code, 'FORBIDDEN', 'a key of the previous tenant is never served in the new one');
  const regB = R.ResourceRegistry({ organizationId: 'org-b', developmentId: 'dev-b' });
  const c3 = CO.LoadCoordinator({ organizationId: 'org-b', developmentId: 'dev-b', loaders: { compose: async () => 'b' } });
  assert.equal((await c3.request(regB.descriptor('LOT_QUICK_VIEW', { resourceId: 'L1' }))).state, 'READY');
  // the dedup registry never merges two tenants: different serialized keys
  assert.notEqual(R.serializeResourceKey(regB.descriptor('LOT_QUICK_VIEW', { resourceId: 'L1' }).key), R.serializeResourceKey(reg.descriptor('LOT_QUICK_VIEW', { resourceId: 'L1' }).key));
});

test('version coherence: a result built against another analysis version is rejected (no silent mixed versions)', async () => {
  const c = makeCoord({ compose: async () => ({ data: { v: 1 }, builtAgainst: { analysisVersion: 'A14', geometryVersion: 'G1' } }) });
  const r = await c.request(qv('L1'), { expectedVersions: { analysisVersion: 'A15', geometryVersion: 'G1' } });
  assert.equal(r.state, 'ERROR'); assert.equal(r.error.code, 'VERSION_MISMATCH');
  const ok = await c.request(qv('L2'), { expectedVersions: { analysisVersion: 'A14' } });
  assert.equal(ok.state, 'READY'); assert.deepEqual(ok.data, { v: 1 });
  assert.equal(R.validateCompatibility('PRICING_SNAPSHOT', {}, { analysisVersion: 'A15' }).status, 'COMPATIBLE', 'versions the resource does not consume are ignored');
});

test('LazyOptionalFailureDegradesGracefully: optional failure is isolated, carries its failure policy and the route stays ready', async () => {
  const c = makeCoord({ json: async ({ key }) => { if (key.type === 'TECHNICAL_ANALYSIS_INPUT') { const e = new Error('HTTP 500'); e.status = 500; throw e; } return key.type; } });
  const [ok, bad] = await Promise.all([c.request(reg.descriptor('PRICING_SNAPSHOT')), c.request(reg.descriptor('TECHNICAL_ANALYSIS_INPUT'))]);
  assert.equal(ok.state, 'READY'); assert.equal(bad.state, 'ERROR');
  assert.equal(bad.failure.behavior, 'SHOW_RETRY'); assert.match(bad.failure.message, /score publicado continua valendo/);
  assert.equal(c.diagnostics().lazy.optionalFailureCount, 1);
  const html = V.resourceStatus(bad, { what: 'as medições', userRequested: true, retryAct: 'loadRetry' });
  assert.match(html, /role="alert"/); assert.match(html, /data-act="loadRetry"/);
  assert.equal(V.resourceStatus({ ...bad, failure: R.failurePolicy('GALLERY_IMAGE') }, { retryAct: 'x' }).includes('data-act'), false, 'no retry where the policy does not allow it');
});

test('execute(plan): independent required resources start together; deferred after; prefetch refused for restricted resources', async () => {
  const started = [], gates = {};
  const c = makeCoord({ json: ({ key }) => { started.push(key.type); const d = defer(); gates[key.type] = d; return d.p; }, 'asset-cache': async () => 'img', 'service-worker': async () => 'sw', compose: async () => 'x' });
  const plan = PL.buildPlan({ context: 'MAP_ROUTE', organizationId: ORG, developmentId: DEV, manifest: MANIFEST });
  const h = c.execute(plan, { descriptors: PL.descriptorsOf(plan, { organizationId: ORG, developmentId: DEV, manifest: MANIFEST }) });
  await tick(5);
  assert.deepEqual(started.sort(), ['GEOMETRY_BUNDLE', 'MAP_BOOTSTRAP', 'PRICING_SNAPSHOT'], 'all three in flight before any answers');
  Object.values(gates).forEach(g => g.resolve('ok'));
  const req = await h.required; assert.ok(req.every(r => r.state === 'READY'));
  const def = await h.deferred; assert.ok(def.every(r => r && r.state === 'READY'));
  const share = await c.request(reg.descriptor('SHARE_RESOURCE'), { origin: 'PREFETCH' });
  assert.equal(share.state, 'CANCELLED', 'restricted resources are never prefetched');
});

// ------------------------------------------------------------------ readiness
test('LazyMapInteractiveBeforeHighRes: geometry → INTERACTIVE without base map; high-res failure keeps lower quality', () => {
  const m = PL.MapReadiness();
  m.update('APP_SHELL', 'READY'); m.update('DEVELOPMENT_CONFIG', 'READY');
  assert.equal(m.snapshot().state, 'SHELL_READY');
  m.update('GEOMETRY_BUNDLE', 'READY');
  let s = m.snapshot();
  assert.ok(s.reached.includes('INTERACTIVE') && !s.reached.includes('BASE_MAP_READY'), 'interactive before the base map');
  assert.ok(m.can('CAN_SELECT_LOT')); assert.ok(!m.can('CAN_SHOW_QUICKVIEW'), 'QuickView waits for the price table to settle');
  m.update('PRICING_SNAPSHOT', 'ERROR'); // last table, labelled
  assert.ok(m.can('CAN_SHOW_QUICKVIEW'));
  m.update('BASE_MAP_HIGH', 'ERROR');
  s = m.snapshot(); assert.ok(!s.capabilities.includes('CAN_SHOW_AERIAL_HIGH_RES')); assert.ok(s.capabilities.includes('CAN_PAN_ZOOM')); assert.equal(s.state, 'FULLY_ENHANCED'); assert.ok(s.degraded.includes('BASE_MAP_HIGH'));
  const plan = PL.buildPlan({ context: 'MAP_ROUTE', organizationId: ORG, developmentId: DEV, manifest: MANIFEST });
  const pr = PL.loadProgress(plan, k => (k.type === 'GEOMETRY_BUNDLE' ? 'READY' : 'LOADING'), 'GEOMETRY_READY');
  assert.deepEqual([pr.blockingReady, pr.blockingTotal], [1, 3]);
});

// ------------------------------------------------------------------ prefetch
test('LazySaveDataDisablesPrefetch + hover storm + touch path: prefetch is policy-driven, dwell-debounced and never restricted', () => {
  const d = reg.descriptor('TECHNICAL_ANALYSIS_INPUT');
  assert.equal(PL.prefetchDecision(d, { saveData: true }).reason, 'SAVE_DATA');
  assert.equal(PL.prefetchDecision(d, { effectiveType: '2g' }).reason, 'SLOW_CONNECTION_HINT');
  assert.equal(PL.prefetchDecision(reg.descriptor('CUSTOMER_PROFILE'), {}).reason, 'NOT_PREFETCHABLE');
  assert.equal(PL.prefetchDecision({ ...reg.descriptor('RECOMMENDATION_EXPLANATION') }, {}).reason, 'RESTRICTED_RESOURCE');
  assert.equal(PL.prefetchDecision(d, { criticalPending: true }).reason, 'CRITICAL_QUEUE_BUSY');
  assert.equal(PL.prefetchDecision(d, {}).allowed, true);
  const fired = [], timers = [];
  const svc = PL.PrefetchIntentService({ onPrefetch: x => fired.push(x.key.type), setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: id => { timers[id - 1] = null; } });
  for (let i = 0; i < 20; i++) svc.signal('hover', d); // hover storm
  assert.equal(timers.length, 1, 'one dwell timer, no avalanche'); assert.deepEqual(fired, []);
  svc.signal('hoverEnd', d); timers.forEach(t => t && t()); assert.deepEqual(fired, [], 'moving away cancels');
  const r = svc.signal('touchstart', d); assert.equal(r.allowed, true); assert.deepEqual(fired, ['TECHNICAL_ANALYSIS_INPUT'], 'touch works without hover');
  assert.equal(svc.signal('focus', d).reason, 'ALREADY_PREFETCHED');
  const svc2 = PL.PrefetchIntentService({ onPrefetch: x => fired.push('B'), env: () => ({ saveData: true }) });
  assert.equal(svc2.signal('focus', d).reason, 'SAVE_DATA');
  assert.equal(PL.connectionEnv({ connection: { saveData: true, effectiveType: '4g' } }).saveData, true);
  assert.equal(PL.connectionEnv(null).saveData, false);
});

// ------------------------------------------------------------------ projections / assets / budgets
test('MapBootstrap and MapLotIndex are minimal projections (no price, no detail sections, no customer data)', async () => {
  const b = PL.mapBootstrap({ organizationId: ORG, developmentId: DEV, manifest: MANIFEST });
  assert.equal(b.mapLotIndexRef.version, `${MANIFEST.staticVersion}+${MANIFEST.analysisVersion}`);
  assert.equal(b.availabilitySnapshotRef, null);
  assert.ok(!JSON.stringify(b).includes('current'));
  const repo = App.repos.LotRepository(DEV); await repo.load();
  const idx = PL.mapLotIndex(repo.lotsSync());
  assert.equal(idx.length, 498);
  const keys = new Set(idx.flatMap(Object.keys));
  for (const k of keys) assert.ok(['lotId', 'blockCode', 'lotNumber', 'area', 'geometryFeatureIndex', 'searchableLabel', 'quickFlags'].includes(k), k);
  const byId = new Map(repo.lotsSync().map(l => [l.identity.id, l]));
  assert.ok(idx.every(i => publishedStatus(byId.get(i.lotId)) === 'UNKNOWN' ? i.quickFlags.includes('STATUS_UNKNOWN') : !i.quickFlags.includes('STATUS_UNKNOWN')), 'UNKNOWN lots flagged, never AVAILABLE');
  assert.ok(JSON.stringify(idx).length < 120000, 'index is a fraction of lots.json');
});

test('assets: lazy images reserve dimensions; only critical visible images are eager', () => {
  const lazy = PL.imageAttrs({ width: 320, height: 240 });
  assert.match(lazy, /loading="lazy"/); assert.match(lazy, /width="320"/); assert.match(lazy, /decoding="async"/);
  assert.match(PL.imageAttrs({ critical: true, visible: true }), /loading="eager"/);
  const sk = V.skeleton('quickview');
  assert.match(sk, /aria-busy="true"/); assert.match(sk, /role="status"/); assert.ok(!/R\$|Dispon/.test(sk), 'no fake default values');
});

test('LazyDocumentViewerDynamicImport / code splitting: heavy features are outside the map core; bundle budget on the built page', () => {
  assert.equal(R.chunkOf('documents/documentServices.js'), 'technical');
  assert.equal(R.chunkOf('documents/integrity.js'), 'core', 'integrity is shared by core modules: stays in the page');
  assert.equal(R.chunkOf('customer/customerDomain.js'), 'customer');
  assert.equal(R.chunkOf('journey/journeyDomain.js'), 'customer');
  assert.equal(R.chunkOf('presentation/map.js'), 'core');
  assert.equal(R.chunkOf('presentation/securityView.js'), 'core');
  assert.equal(R.chunkOf('share/shareDomain.js'), 'presentation', 'share runtime travels with the guided presentation (round 6)');
  assert.equal(R.chunkOf('services/comparison.js'), 'core'); assert.equal(R.chunkOf('compare/comparisonDomain.js'), 'comparison');
  assert.equal(R.chunkOf('surroundings/surroundingsView.js'), 'surroundings'); assert.equal(R.chunkOf('config/surroundings/surroundings.config.js'), 'surroundings');
  assert.equal(R.chunkOf('config/developments.js'), 'core');
  const lazy = new Set(R.FEATURE_MODULES.filter(m => m.lazy).map(m => m.moduleId));
  assert.deepEqual([...lazy].sort(), ['comparison', 'customer', 'decision', 'favorites', 'presentation', 'privacy', 'surroundings', 'technical']);
  const html = path.join(DATA, 'index.html');
  if (fs.existsSync(html)) {
    const page = fs.readFileSync(html, 'utf8'), an = PL.analyzeBundle(page), B = PL.BUDGETS.MAP_ROUTE;
    assert.ok(an.moduleCount > 50);
    for (const m of an.modules) assert.ok(!lazy.has(m.chunk), `${m.file} (${m.chunk}) must not be inline: it is a lazy chunk`);
    const b = PL.checkBudget(an, B, { criticalDataBytes: 732700, dataRequestsUntilInteractive: 3, duplicateDataRequests: 0 });
    assert.equal(b.ok, true, JSON.stringify(b.violations));
    assert.equal(B.maxInitialJsBytes, 3400000, 'the budget is not raised');
    assert.ok(an.jsBytes <= B.baseline.preSplitJsBytes * (1 - B.minSplitReduction), `initial JS ${an.jsBytes} must stay ≥ 25 % below the pre-split ${B.baseline.preSplitJsBytes}`);
    const mf = JSON.parse((page.match(/App\.CHUNK_MANIFEST = (\{.*?\});\n/) || [])[1] || 'null');
    assert.ok(mf && Object.keys(mf).length === lazy.size, 'the page carries the chunk manifest');
    const chunks = PL.analyzeChunks(mf, f => fs.existsSync(path.join(DATA, f)) ? fs.readFileSync(path.join(DATA, f), 'utf8') : null);
    for (const c of chunks) {
      assert.match(c.file, new RegExp(`^chunks/${c.name}\\.[0-9a-f]{10}\\.js$`)); assert.ok(c.bytes > 0 && c.bytes <= B.maxLazyChunkBytes, `${c.file} ${c.bytes}`);
      const t = fs.readFileSync(path.join(DATA, c.file), 'utf8');
      assert.equal('sha384-' + require('crypto').createHash('sha384').update(t, 'utf8').digest('base64'), mf[c.name].integrity, 'SRI of the published file');
      assert.ok(t.trimEnd().endsWith(`App.chunks._done(${JSON.stringify(c.name)});`), 'chunk announces it ran to the end');
      for (const f of c.modules) assert.equal(R.chunkOf(f), c.name, `${f} belongs to ${c.name}`);
      assert.doesNotMatch(t, /<script|\beval\(|createElement\(['"]script/, 'chunks are plain code of this build and inject no script');
      if (c.name === 'surroundings') assert.ok(!c.modules.includes('surroundings/surroundingsClient.js'), 'the Google Maps loader is not shipped to the public panel');
    }
    assert.ok(an.byChunk.core > 0);
  }
  assert.equal(PL.checkBudget({ jsBytes: 4e6, cssBytes: 0 }, PL.BUDGETS.MAP_ROUTE, { duplicateDataRequests: 2 }).violations.length, 2);
});

// ------------------------------------------------------------------ wiring in data/offline.js
require('./node_modules/fake-indexeddb/auto');
function env() {
  const e = { calls: [], gates: {}, delay: {} };
  e.fetch = async url => {
    const u = String(url).split('?')[0]; e.calls.push(u);
    if (e.gates[u]) await e.gates[u];
    const f = path.join(DATA, u); if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => null };
    const txt = fs.readFileSync(f, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt) };
  };
  e.App = boot({ fetch: e.fetch, globals: { indexedDB, IDBKeyRange } }); e.App.offline.net.sleep = async () => {};
  return e;
}
let DBN = 0;
test('first visit: manifest, lots and commercial are requested in parallel (no waterfall) and the result is unchanged', async () => {
  const e = env(); let open; e.gates['manifest.json'] = new Promise(r => { open = r; });
  const h = await e.App.offline.createHybrid(DEV, { backend: e.App.offline.IdbBackend(indexedDB, `lz-${process.pid}-${++DBN}`), syncOpts: { debounceMs: 0 } });
  const p = h.repo.load();
  await tick(20);
  assert.deepEqual(e.calls.filter(u => u.endsWith('.json')).sort(), ['commercial.json', 'lots.json', 'manifest.json'], 'lots and commercial left before the manifest answered');
  open();
  const lots = await p;
  assert.equal(lots.length, 498); assert.equal(h.source.origin, 'REMOTE');
  assert.equal(h.repo.getFreshness().commercial, 'FRESH'); assert.equal(h.repo.getFreshness().availability, 'FRESH', 'lots.json now carries the developer lots status');
  assert.ok(h.repo.lotsSync().every(l => l.availability.status === publishedStatus(l)));
  assert.equal(await h.source.pendingPersist, true);
});

test('boot sync right after a confirmed first visit reuses it: no second manifest/commercial request; cached boot still revalidates', async () => {
  const e = env(), b = e.App.offline.IdbBackend(indexedDB, `lz-${process.pid}-${++DBN}`);
  const h = await e.App.offline.createHybrid(DEV, { backend: b, syncOpts: { debounceMs: 0 } });
  await h.repo.load(); await h.source.pendingPersist;
  const before = e.calls.length;
  const r = await h.sync.sync('boot');
  assert.equal(e.calls.length, before, 'no duplicate request');
  assert.equal(r.manifest, 'reused'); assert.equal(r.commercial, 'confirmed'); assert.equal(r.static, 'current'); assert.equal(r.availability, 'no-feed');
  assert.equal(h.sync.info().state, 'SUCCESS'); assert.equal(h.repo.getFreshness().commercial, 'FRESH');
  // a manual sync always asks the source
  await h.sync.sync('manual'); assert.ok(e.calls.slice(before).includes('commercial.json'));
  // a boot from the cache (STALE) is never "reused": the source is asked
  const h2 = await e.App.offline.createHybrid(DEV, { backend: b, syncOpts: { debounceMs: 0 } });
  await h2.repo.load(); assert.equal(h2.source.origin, 'CACHE'); assert.equal(h2.repo.getFreshness().commercial, 'STALE');
  const n2 = e.calls.length; const r2 = await h2.sync.sync('boot');
  assert.equal(r2.manifest, 'ok'); assert.ok(e.calls.slice(n2).includes('commercial.json')); assert.equal(h2.repo.getFreshness().commercial, 'FRESH');
  // the reuse window is bounded
  const h3 = await e.App.offline.createHybrid(DEV, { backend: e.App.offline.MemoryBackend(), syncOpts: { debounceMs: 0, bootReuseMs: 0 } });
  await h3.repo.load(); h3.source.lastLoad.at -= 10; const n3 = e.calls.length;
  assert.equal((await h3.sync.sync('boot')).manifest, 'ok'); assert.ok(e.calls.length > n3);
});

test('asset cache: concurrent requests for the same image → one download (was 3× planta.webp on the first visit)', async () => {
  const e = env(); let downloads = 0; const store = new Map();
  const cachesApi = { open: async () => ({ match: async k => store.get(String(k)) || null, put: async (k, r) => { store.set(String(k), r); }, keys: async () => [...store.keys()].map(url => ({ url })), delete: async k => store.delete(String(k.url || k)) }) };
  const fetchFn = async () => { downloads++; await tick(5); return { ok: true, status: 200, blob: async () => ({ size: 10, type: 'image/webp' }) }; };
  global.Response = global.Response || class { constructor(b) { this.b = b; } async blob() { return this.b; } };
  const ac = e.App.offline.AssetCache(e.App.config.DEVELOPMENTS[0], { cachesApi, fetchFn, toUrl: () => 'blob:x' });
  ac.setManifest(MANIFEST);
  const urls = await Promise.all([ac.get('planta.webp'), ac.get('planta.webp'), ac.get('planta.webp')]);
  assert.equal(downloads, 1); assert.deepEqual(urls, ['blob:x', 'blob:x', 'blob:x']);
  assert.equal(await ac.get('planta.webp'), 'blob:x'); assert.equal(downloads, 1);
});

test('legacy load inventory lists the eager loads, duplicates and waterfalls found (and what was fixed)', () => {
  const inv = R.LegacyLoadInventory;
  assert.ok(inv.some(i => i.duplicated && /planta/.test(i.notes)));
  assert.ok(inv.some(i => i.duplicated && /manifest\.json e commercial\.json/.test(i.notes)));
  assert.ok(inv.some(i => /cascata/.test(i.notes)));
  assert.ok(inv.every(i => ['KEEP', 'DEFER', 'BATCH', 'SPLIT', 'PREFETCH', 'MOVE_TO_COORDINATOR', 'REMOVE', 'REVIEW'].includes(i.migrationAction)));
});
