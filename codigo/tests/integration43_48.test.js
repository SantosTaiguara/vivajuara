'use strict';
// Topics 43–48 wired into the panel UI (app.js / overlays.js): the same calls app.js makes, checked as contracts.
// 43: every link the old router wrote opens identically through codec + restoration; URLs never carry customer/price data.
// 44/45: the "Métricas locais" markup only uses mapped actions; nothing is sent. 47/48: analysis-input through the
// coordinator + cache (one fetch, retry markup with the old wording), gallery image attributes, cache wording rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');
const UI = ['presentation/dom.js', 'presentation/compareView.js', 'presentation/pricingView.js', 'presentation/securityView.js', 'presentation/dataTrustView.js', 'presentation/favoritesView.js',
  'customer/customerView.js', 'presentationmode/presentationView.js', 'share/sharedShellView.js', 'presentation/panels.js', 'presentation/overlays.js', 'loading/loadingView.js'];
let App, repo, dev, DL, before;
const DEV = 'viva-juara';
const actsIn = html => [...html.matchAll(/data-act="([a-zA-Z][a-zA-Z-]*)"/g)].map(m => m[1]);

test.before(async () => {
  App = load(); for (const f of UI) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  repo = App.repos.LotRepository(DEV); await repo.load();
  dev = App.repos.DevelopmentRepository.getDevelopmentConfig(DEV); DL = App.deeplink;
  before = repo.lotsSync().map(l => App.domain.serializeLot(l));
});
const codeOf = id => { const l = repo.getLotById(id); return l ? l.identity.code : id; };
const deps = () => ({ currentDevelopmentId: DEV, developmentExists: id => !!App.repos.DevelopmentRepository.getDevelopment(id), resolveLot: ref => repo.resolve(ref),
  mapBounds: dev.map, detailSections: (dev.presentation.detailSections || []).map(s => s.id), authorize: (k, r) => !!(App.authz && App.authz.can && App.authz.can(k, r)) });
/** app.js restoreHash() */
function restoreHash(hash) {
  const dec = DL.codec.decode(hash), res = dec.envelope ? DL.restoration.restore({ ...dec.envelope, status: dec.status }, deps()) : null;
  const patch = res && res.status !== 'FAILED' ? { ...res.finalAppStatePatch } : null;
  if (patch && ['MAP', 'DEVELOPMENT'].includes(dec.envelope.route) && patch.view === 'map') delete patch.view;
  return { dec, res, patch };
}
const KEYS = ['currentLotId', 'comparisonLotIds', 'panel', 'detailSection', 'activeMapLayer', 'backgroundLayer', 'scoreKey', 'mapOverlays'];
const base = o => ({ ...App.store.INITIAL, developmentId: DEV, activeMapLayer: dev.map.defaultLayer, backgroundLayer: dev.map.defaultBackground, ...o });

test('topic 43: every hash the old router wrote (lot, section, simulation, solar, comparison, layer, score, base, overlays) restores the same state', () => {
  const states = [
    base({}), base({ currentLotId: 'VJ-QB-L0079' }), base({ currentLotId: 'VJ-QB-L0079', panel: 'details', detailSection: 'intelligence' }),
    base({ currentLotId: 'VJ-QB-L0079', panel: 'simulation' }), base({ currentLotId: 'VJ-QB-L0012', panel: 'solar' }),
    base({ view: 'compare', comparisonLotIds: ['VJ-QB-L0079', 'VJ-QB-L0012', 'VJ-QA-L0005'] }),
    base({ currentLotId: 'VJ-QB-L0079', activeMapLayer: 'score', scoreKey: 'investment' }), base({ activeMapLayer: 'class', backgroundLayer: 'aerial' }),
    base({ activeMapLayer: 'availability', mapOverlays: [] })
  ];
  for (const s of states) {
    const old = '#' + App.router.token(s, codeOf), a = App.router.parse(old, ref => repo.resolve(ref)), b = restoreHash(old);
    assert.ok(b.patch, old);
    for (const k of KEYS) if (a[k] !== undefined) assert.deepEqual(b.patch[k], a[k], `${old} → ${k}`);
    if (a.view) assert.equal(b.patch.view, a.view, old);
    if (a.currentLotId) assert.equal(b.patch.view, 'map', old);
    // the coordinator's canonical hash (what app.js writes now) reopens the same state too
    const enc = DL.codec.encode(DL.service.extract(s, { codeOf }));
    assert.ok(enc.ok, old); const c = restoreHash(enc.hash);
    for (const k of ['currentLotId', 'comparisonLotIds', 'panel', 'detailSection']) if (a[k] !== undefined) assert.deepEqual(c.patch[k], a[k], `${enc.hash} → ${k}`);
    assert.equal(App.router.parse(enc.hash, ref => repo.resolve(ref)).currentLotId, a.currentLotId, 'v=1 links stay readable by the old grammar');
  }
});

test('topic 43: a plain map link keeps the open overlay; a missing lot falls back to the map with a message, never another lot', () => {
  assert.equal(restoreHash('#viva-juara').patch.view, undefined);
  const r = restoreHash('#viva-juara.lots.Z999');
  assert.equal(r.patch.currentLotId, null); assert.equal(r.res.status, 'PARTIAL'); assert.ok(r.res.message);
  assert.equal(restoreHash('#outro-empreendimento.lots.B79').patch, null, 'other development → current screen stays');
});

test('topic 43: URL sync and copy link never carry customer, price, availability or free text', async () => {
  const s = base({ currentLotId: 'VJ-QB-L0079', currentCustomerId: 'cust_maria', customers: [{ id: 'cust_maria', name: 'Maria Souza', lots: [] }], preferences: { budgetMax: 500000 },
    activeFilters: { q: 'Maria 11 99999-0000' } });
  assert.equal(DL.codec.encode(DL.service.extract(s, { codeOf })).ok, false, 'a phone-like filter value is refused by the codec');
  const encodeUrl = e => { const r = DL.codec.encode(e); if (r.ok || !e.state || !e.state.filters) return r; const st2 = { ...e.state }; delete st2.filters; return DL.codec.encode({ ...e, state: st2 }); }; // app.js
  const enc = encodeUrl(DL.service.extract(s, { codeOf }));
  assert.ok(enc.ok); assert.match(enc.hash, /^#viva-juara\.lots\.B79\?v=1/); assert.doesNotMatch(enc.hash, /cust|Maria|9999|500000|R\$|price|AVAILABLE/i);
  const r = await DL.service.createLink({ appState: { ...s, view: 'map', comparisonLotIds: [], panel: 'quick' }, codeOf, base: dev.shareUrl, profile: 'LOT_CONTEXT' });
  assert.ok(r.ok); assert.ok(r.link.startsWith(dev.shareUrl + '#viva-juara.lots.B79?v=1')); assert.doesNotMatch(r.link, /cust|Maria|9999|500000/);
  const cmp = await DL.service.createLink({ appState: { ...s, view: 'compare', comparisonLotIds: ['VJ-QB-L0079', 'VJ-QB-L0012'], currentLotId: null }, codeOf, base: dev.shareUrl, profile: 'COMPARISON_CONTEXT' });
  assert.match(cmp.link, /#viva-juara\.compare\.B79~B12\?v=1/);
});

test('topic 43: navigation coordinator — desktop pushes a lot change, small screens replace, Back/Forward never writes', () => {
  const mk = push => { const log = [], H = { state: null, pushState: (a, b, h) => { log.push(['push', h]); L.hash = h; }, replaceState: (a, b, h) => { log.push(['replace', h]); L.hash = h; } }, L = { hash: '' };
    return { log, nav: DL.navigation.createCoordinator({ history: H, location: L, encode: e => DL.codec.encode(e), pushNavigational: push }), L }; };
  const env = id => DL.service.extract(base({ currentLotId: id }), { codeOf });
  const d = mk(true); d.nav.update(env('VJ-QB-L0079'), { source: 'URL_RESTORE' }); d.nav.update(env('VJ-QB-L0012'), { source: 'USER_ACTION' });
  assert.deepEqual(d.log.map(x => x[0]), ['replace', 'push']);
  d.nav.update(env('VJ-QB-L0079'), { source: 'BROWSER_HISTORY' }); assert.equal(d.log.length, 2);
  const m = mk(false); m.nav.update(env('VJ-QB-L0079'), { source: 'URL_RESTORE' }); m.nav.update(env('VJ-QB-L0012'), { source: 'USER_ACTION' });
  assert.deepEqual(m.log.map(x => x[0]), ['replace', 'replace']);
});

test('topics 44/45: "Métricas locais" markup uses only mapped actions (technical mode), local banner, no remote destination on', () => {
  const org = App.analytics.context().organizationId || 'org_house7';
  App.analytics.client.track('app_opened', { entryType: 'DEEP_LINK' }, { organizationId: undefined });
  for (const range of ['session', 'today', '7d']) {
    const vm = App.analytics.view({ range, allowed: true, organizationId: org }), html = App.analytics.html(vm);
    assert.match(html, /Nada é enviado/); assert.match(html, new RegExp(`data-range="${range}" aria-pressed="true"`));
    for (const a of new Set(actsIn(html))) { const g = App.authz.action(a, { range }, { developmentId: DEV }); assert.notEqual(g.reason, 'UNMAPPED_ACTION', a); }
    assert.ok(vm.destinations.filter(d => d.remote).every(d => !d.enabled), 'every remote destination off');
  }
  assert.equal(App.analytics.view({ range: 'session', allowed: false }).allowed, false);
});

test('topics 44/45: the events app.js emits are in the catalog and accepted without PII (local buffer only)', () => {
  const org = App.analytics.context().organizationId;
  if (!org) return; // harness without tenant: the client quarantines (TENANT_UNRESOLVED) — covered by analytics.test.js
  const c = App.analytics.client, sent = [
    ['route_viewed', { routeCode: 'LOT', navigationSource: 'USER_ACTION' }], ['deep_link_opened', { routeCode: 'LOT', linkKind: 'INTERNAL' }],
    ['deep_link_restored', { routeCode: 'LOT', restoreStatus: 'FULL', stateRefUsed: false, warningCount: 0 }],
    ['deep_link_partial_restore', { routeCode: 'MAP', warningCount: 1, droppedKeys: ['lot'] }], ['internal_link_copied', { routeCode: 'LOT', includesFilters: false }]];
  for (const [n, d] of sent) { const r = c.track(n, d); assert.notEqual(r.status, 'QUARANTINED', n + ' ' + JSON.stringify(r)); }
});

test('topics 47/48: analysis-input through LoadCoordinator + CacheManager as app.js wires it — one fetch, cache hit, retry markup with the old wording', async () => {
  const LR = App.loading.resources, LC = App.loading.coordinator, CM = App.cache.manager, CC = App.cache.core, ORG = 'org_house7';
  let calls = 0, fail = true;
  const json = async () => { calls++; if (fail) { const e = new Error('HTTP 503'); e.status = 503; throw e; } return { inputVersion: 'x', lots: [] }; };
  const reg = LR.ResourceRegistry({ organizationId: ORG, developmentId: DEV, dev });
  const coord = LC.LoadCoordinator({ organizationId: ORG, developmentId: DEV, loaders: { json }, cache: CM.CacheManager({}), sleep: async () => {} });
  const req = origin => { const d = reg.descriptor('TECHNICAL_ANALYSIS_INPUT', { version: 'f57a4083e9f9' }); return coord.request(d, { origin, cacheKey: CC.makeCacheKey(d.key, { organizationId: ORG, principalScope: 'PUBLIC' }, '1') }); };
  const bad = await req('USER_REQUEST');
  assert.equal(bad.state, 'ERROR');
  const html = App.loadingView.resourceStatus(bad, { what: 'as medições', userRequested: true, retryAct: 'loadRetry', retryKey: 'TECHNICAL_ANALYSIS_INPUT' });
  assert.match(html, /Não foi possível carregar as medições agora\. O score publicado continua valendo\./);
  assert.match(html, /data-act="loadRetry" data-k="TECHNICAL_ANALYSIS_INPUT"/); assert.match(html, /role="alert"/);
  assert.notEqual(App.authz.action('loadRetry', { k: 'TECHNICAL_ANALYSIS_INPUT' }, { developmentId: DEV }).reason, 'UNMAPPED_ACTION');
  fail = false; calls = 0;
  const [a, b] = await Promise.all([req('PREFETCH'), req('USER_REQUEST')]);
  assert.equal(b.state, 'READY'); assert.deepEqual(b.data, { inputVersion: 'x', lots: [] }); assert.ok(calls <= 2 && a.state !== 'ERROR');
  const c = await req('USER_REQUEST'); assert.equal(c.cache.status, 'HIT_FRESH');
  assert.match(App.loadingView.skeleton('technical'), /aria-busy="true"[\s\S]*Carregando as medições…/);
});

test('topics 47/48: gallery images reserve their box and load lazily; cache wording rows only for values from the local copy', () => {
  const st = { ...App.store.INITIAL, presentationMode: 'broker' }, x = { repo, dev, cfg: dev.presentation, mode: 'broker' };
  const info = { freshness: repo.getFreshnessState(), versions: repo.getDataVersions() || {}, sync: {}, origin: 'CACHE', images: [{ src: 'img/01.webp', title: 'Portaria' }] };
  const h0 = App.overlays.development(st, x, info);
  assert.match(h0, /<img data-src="img\/01\.webp" alt="Portaria" width="320" height="200" loading="lazy" fetchpriority="low" decoding="async">/);
  assert.doesNotMatch(h0, /na cópia local<\/td>/, 'no labels passed → no new row (today\'s wording)');
  const CC = App.cache.core;
  assert.equal(CC.priceDisplay(1196, { cacheStatus: 'HIT_FRESH', domainFreshness: 'FRESH' }).label, null, 'confirmed price: no label');
  const labels = { price: CC.priceDisplay(1196, { cacheStatus: 'HIT_STALE', domainFreshness: 'STALE' }).label, availability: CC.availabilityDisplay('UNKNOWN').label };
  const h1 = App.overlays.development(st, x, { ...info, cacheLabels: labels });
  assert.match(h1, /Preço na cópia local<\/td><td>Preço de tabela da última tabela disponível — necessita confirmação/);
  assert.match(h1, /Status dos lotes na cópia local<\/td><td>Status não confirmado/);
  assert.doesNotMatch(h1, /Disponível/, 'UNKNOWN never shown as available');
});

test('topics 43–48 integration changed no lot value', () => {
  assert.deepEqual(repo.lotsSync().map(l => App.domain.serializeLot(l)), before);
});
