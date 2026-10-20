'use strict';
// Topic 63 (Google Maps, Entorno, raio máximo de 8 km) — frontend domain, client controller, loader, map adapter and view.
// No network: a fake API client, a fake document and a fake google.maps namespace. Synthetic coordinates belong to a
// fictitious test development; Viva Juara has no validated coordinate and must render the not-validated state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

let App, D, CL, V, CFG;
const FILES = ['config/surroundings/surroundings.config.js', 'surroundings/surroundingsDomain.js', 'surroundings/surroundingsClient.js', 'surroundings/surroundingsView.js'];
test.before(() => {
  App = load();
  for (const f of FILES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  D = App.surroundings.domain; CL = App.surroundings.client; V = App.surroundingsView; CFG = App.surroundings.config;
});
const plain = o => JSON.parse(JSON.stringify(o));
const CENTER = { latitude: 1.25, longitude: 2.5 }, DEV = 'dev-fixture';
function enableFixture() { // mutates the loaded config of THIS vm only (tests own App)
  const vj = CFG.developments['viva-juara'];
  CFG.developments[DEV] = { location: { ...vj.location, developmentId: DEV, organizationId: 'org_fixture', name: 'Empreendimento de teste', center: { ...CENTER }, locationStatus: 'VALIDATED', sourceRef: 'fixture://test', validationMethod: 'OFFICIAL_COORDINATE', validatedBy: 't', validatedAt: '2026-10-16T00:00:00Z', googleMapsEnabled: true, version: 'loc-1' },
    intelligence: { ...vj.intelligence, enabled: true, routesEnabled: true }, viewport: { ...vj.viewport } };
  const prev = { flag: CFG.featureFlag.enabled, pl: CFG.rateLimit.placesRequestsPerMinute, rt: CFG.rateLimit.routesRequestsPerMinute, rev: CFG.providerPolicy.reviewedAt };
  Object.assign(CFG.featureFlag, { enabled: true }); CFG.rateLimit.placesRequestsPerMinute = 10; CFG.rateLimit.routesRequestsPerMinute = 10; CFG.providerPolicy.reviewedAt = '2026-10-16';
  return () => { CFG.featureFlag.enabled = prev.flag; CFG.rateLimit.placesRequestsPerMinute = prev.pl; CFG.rateLimit.routesRequestsPerMinute = prev.rt; CFG.providerPolicy.reviewedAt = prev.rev; delete CFG.developments[DEV]; };
}
const place = (id, m, o = {}) => ({ provider: 'GOOGLE', providerPlaceId: id, categoryCode: 'SUPERMARKETS', name: o.name || `Mercado ${id}`, location: D.destination(CENTER, 30, m), straightLineDistanceMeters: m, ...(o.rating === null ? {} : { rating: 4.6, userRatingCount: 1245 }), formattedAddress: o.addr });
const fakeDoc = () => { const scripts = []; return { scripts, createElement: () => ({ dataset: {} }), head: { appendChild: s => scripts.push(s) } }; };

// ------------------------------------------------------------------------------------------ Viva Juara today
test('Viva Juara: coordinate VALIDATED (owner, KMZ AC3 Portaria) but flag OFF and no key → only the not-configured state, no map container, no Google script', async () => {
  const cap = D.capability('viva-juara', { browserKeyConfigured: true, serverKeyConfigured: true });
  assert.equal(cap.state, 'NOT_CONFIGURED'); assert.equal(cap.coordinateStatus, 'VALIDATED');
  assert.equal(cap.GOOGLE_MAPS_ENVIRONMENT, false); assert.equal(cap.NEARBY_PLACES, false); assert.equal(cap.ROUTE_ESTIMATES, false);
  assert.ok(cap.reasons.includes('FEATURE_FLAG_OFF') && !cap.reasons.includes('LOCATION_NOT_VALIDATED'));
  const noKey = D.capability('viva-juara', { browserKeyConfigured: false, serverKeyConfigured: false });
  assert.equal(noKey.state, 'NOT_CONFIGURED'); assert.equal(noKey.GOOGLE_MAPS_ENVIRONMENT, false);
  const html = V.render(V.viewModel({ developmentId: 'viva-juara', capability: noKey }));
  assert.match(html, /Entorno ainda não configurado para este empreendimento\./); assert.doesNotMatch(html, /ainda não validada/);
  assert.ok(!/data-surroundings-map|envchip|<script|maps\.googleapis/.test(html));
  const doc = fakeDoc(), r = await CL.loader({ document: doc, capability: noKey, browserKey: 'fake-browser-key', win: {} }).load();
  assert.equal(r.ok, false); assert.equal(doc.scripts.length, 0, 'flag OFF: the Google script is never injected');
  assert.equal(CL.runtimeConfig('viva-juara').enabled, false, 'runtime config exists for the validated center but stays disabled (flag OFF)');
  assert.equal(V.tabs({ active: 'lots', showEnvironment: cap.GOOGLE_MAPS_ENVIRONMENT }).includes('Entorno'), false, 'Entorno tab hidden while the capability is off');
  assert.match(V.tabs({ active: 'lots', showEnvironment: true }), /Mapa de Lotes[\s\S]*Entorno/);
});
test('config: center = owner-validated KMZ AC3 Portaria (source, method, validator, date recorded), radii 2/4/6/8 km, max 8000, official place types, LI-DQ-001 passes', () => {
  const vj = CFG.developments['viva-juara'], loc = vj.location;
  assert.deepEqual(plain(loc.center), { latitude: -20.145472, longitude: -40.211418 }); assert.equal(loc.locationStatus, 'VALIDATED');
  assert.equal(loc.validationMethod, 'OFFICIAL_KML_KMZ'); assert.ok(D.VALIDATION_METHODS.includes(loc.validationMethod));
  assert.match(loc.sourceRef, /KMZ da incorporadora.*Quintas II.*AC3 Portaria/); assert.match(loc.validatedBy, /Edmilson Margon/); assert.equal(loc.validatedAt, '2026-10-18');
  assert.equal(loc.estimatedAccuracyMeters, 10); assert.equal(loc.googleMapsEnabled, false);
  assert.equal(D.locationReadiness(loc).coordinateStatus, 'VALIDATED');
  assert.equal(CFG.featureFlag.key, 'location_intelligence_google_maps'); assert.equal(CFG.featureFlag.enabled, false);
  const pol = D.radiusPolicy('viva-juara'); assert.deepEqual(plain(pol.selectableRadiiMeters), [2000, 4000, 6000, 8000]); assert.equal(pol.maxRadiusMeters, 8000);
  const dq = Object.fromEntries(D.dataQuality('viva-juara').map(r => [r.rule, r.pass]));
  assert.equal(dq['LI-DQ-001'], true); assert.equal(dq['LI-DQ-004'], true); assert.equal(dq['LI-DQ-006'], true);
  const table = new Set(CFG.placeTypeTable.types); for (const c of CFG.categories) for (const t of c.googleIncludedTypes) assert.ok(table.has(t), t);
  assert.equal(D.locationReadiness({ locationStatus: 'VALIDATED', center: { latitude: 91, longitude: 0 }, sourceRef: 's', validationMethod: 'OFFICIAL_COORDINATE', validatedBy: 'x', validatedAt: 'y' }).coordinateStatus, 'INVALID');
  assert.equal(D.locationReadiness({ ...plain(loc), validatedBy: null }).coordinateStatus, 'NOT_VALIDATED', 'without a validator the center is not usable');
});

// ------------------------------------------------------------------------------------------ domain rules
test('radius: only allowed values, never silently clamped (9000 → INVALID_RADIUS); effective = min(requested, max)', () => {
  const pol = D.radiusPolicy('viva-juara');
  for (const r of [2000, '4000', 6000, 8000]) assert.equal(D.resolveRadius(r, pol).effectiveRadiusMeters, Number(r));
  for (const r of [9000, 12000, 3000, 0, -2000, '8000m', null, 8000.5]) { const x = D.resolveRadius(r, pol); assert.equal(x.ok, false); assert.equal(x.reason, 'INVALID_RADIUS'); assert.equal(x.code, 'LOCATION_RADIUS_INVALID'); }
});
test('distance: Haversine (geodesic, not Euclidean degrees), strict post-filter with a technical tolerance only', () => {
  const p8 = D.destination(CENTER, 90, 8000); assert.ok(Math.abs(D.haversineMeters(CENTER, p8) - 8000) < 0.01);
  assert.ok(Math.abs(D.haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - 111195) < 5);
  const mk = (id, m) => ({ providerPlaceId: id, name: id, location: D.destination(CENTER, 10, m) });
  const f = D.postFilter([mk('PlaceIN000001', 7999), mk('PlaceEDGE00001', 8000.4), mk('PlaceOUT00001', 8100), mk('PlaceFAR000001', 8500)], CENTER, 8000, 1);
  assert.deepEqual(f.kept.map(p => p.providerPlaceId), ['PlaceIN000001', 'PlaceEDGE00001']); assert.equal(f.removed.length, 2);
  assert.equal(D.postFilter([mk('PlaceFAR000001', 8500)], CENTER, 8000, 1000).kept.length, 0, 'tolerance is capped: never 8.5 km');
  const b = D.boundsAround(CENTER, 8000); assert.ok(b.north > CENTER.latitude && b.south < CENTER.latitude && b.east > CENTER.longitude && b.west < CENTER.longitude);
});
test('formatting and copy: m/km, h/min, "Linha reta" vs "De carro", returned-count copy never claims the universe', () => {
  assert.equal(D.formatDistance(850), '850 m'); assert.equal(D.formatDistance(5200), '5,2 km'); assert.equal(D.formatDistance(null), 'não disponível');
  assert.equal(D.formatDuration(420), '7 min'); assert.equal(D.formatDuration(4320), '1 h 12 min'); assert.equal(D.parseDuration('754s'), 754); assert.equal(D.parseDuration('x'), null);
  assert.equal(D.formatRating(undefined), null); assert.equal(D.formatRating(4.6, 1245), '4,6 · 1.245 avaliações');
  const t = D.summaryText({ count: 5, categoryLabel: 'Supermercados', radiusMeters: 4000 }); assert.equal(t, 'A busca retornou 5 resultados de supermercados em até 4 km (linha reta).'); assert.ok(!/todos|existem/i.test(t));
  assert.match(D.routeText({ durationSeconds: 480 }), /aproximadamente 8 min de carro, conforme estimativa do provedor/);
  const s = D.environmentSummary({ developmentId: DEV, maxRadiusMeters: 8000, generatedAt: 'g', results: [{ categoryCode: 'SUPERMARKETS', places: [place('PlaceBBBBBBBB2', 3000), place('PlaceBBBBBBBB1', 1800)] }] });
  assert.equal(s.categories[0].resultCount, 2); assert.equal(s.categories[0].nearestPlace.providerPlaceId, 'PlaceBBBBBBBB1'); assert.equal(s.persisted, false);
});
test('deep link: semantic state only; unknown place / bad radius → PARTIAL restore without crash; maps URL has no key', () => {
  const reg = D.buildRegistry(CFG, 'viva-juara'), pol = D.radiusPolicy('viva-juara');
  assert.deepEqual(plain(D.linkState({ selectedCategory: 'SUPERMARKETS', selectedRadiusMeters: 4000, selectedPlaceId: 'PlaceCCCCCCCC1', pixelX: 3 })), { tab: 'environment', category: 'SUPERMARKETS', radius: '4000', selectedPlaceId: 'PlaceCCCCCCCC1' });
  const r = D.restoreLinkState({ category: 'SUPERMARKETS', radius: '9000', selectedPlaceId: 'PlaceCCCCCCCC1' }, { registry: reg, policy: pol });
  assert.equal(r.status, 'PARTIAL'); assert.equal(r.state.selectedRadiusMeters, 8000);
  const sel = D.restoreSelection(r.state, [place('PlaceDDDDDDDD1', 100)]); assert.equal(sel.status, 'PARTIAL'); assert.equal(sel.state.selectedPlaceId, undefined);
  const url = D.mapsUrl(place('PlaceDDDDDDDD1', 100)); assert.match(url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/); assert.match(url, /query_place_id=PlaceDDDDDDDD1$/); assert.ok(!/key=/.test(url));
  assert.deepEqual(plain(D.eventPayload('nearby_category_selected', { categoryCode: 'SUPERMARKETS', radiusMeters: 4000, name: 'x' })), { name: 'nearby_category_selected', props: { categoryCode: 'SUPERMARKETS', radiusBucket: '4km' } });
});

// ------------------------------------------------------------------------------------------ client controller (lazy, stale guard)
function fakeApi(handler) {
  const calls = { nearby: [], route: [] };
  return { calls, nearbyPlaces: o => { calls.nearby.push(o); return handler.nearby(o); }, routeEstimate: o => { calls.route.push(o); return handler.route(o); } };
}
const deferred = () => { let resolve; const p = new Promise(r => { resolve = r; }); return { p, resolve }; };
test('golden §436–§439: opening Entorno makes 0 Places calls; one category = 1 request; selecting a place = 0 route calls', async () => {
  const restore = enableFixture();
  try {
    const api = fakeApi({ nearby: async () => ({ ok: true, data: { places: [place('PlaceEEEEEEEE2', 3200), place('PlaceEEEEEEEE1', 900)] } }), route: async () => ({ ok: true, data: { distanceMeters: 4100, durationSeconds: 420 } }) });
    const reg = D.buildRegistry(CFG, DEV), pol = D.radiusPolicy(DEV), events = [];
    const c = CL.controller({ developmentId: DEV, client: api, policy: pol, registry: reg, track: (n, p) => events.push([n, p]) });
    await c.open(); assert.equal(api.calls.nearby.length, 0); assert.equal(c.state().phase, 'IDLE');
    await c.selectCategory('SUPERMARKETS'); assert.equal(api.calls.nearby.length, 1); assert.equal(c.state().phase, 'READY');
    assert.deepEqual(c.state().places.map(p => p.providerPlaceId), ['PlaceEEEEEEEE1', 'PlaceEEEEEEEE2']);
    assert.equal(c.selectPlace('PlaceEEEEEEEE2'), true); assert.equal(api.calls.route.length, 0);
    await c.requestRoute(); assert.equal(api.calls.route.length, 1); assert.equal(c.state().routePhase, 'READY');
    assert.ok(events.every(([, p]) => Object.keys(p).every(k => ['categoryCode', 'radiusBucket'].includes(k))), 'events carry no place name or user data');
    assert.equal((await c.selectCategory('supermarket')).code, 'LOCATION_CATEGORY_UNSUPPORTED');
  } finally { restore(); }
});
test('race §516: Market (A) then School (B); A finishes after B → A ignored, B stays', async () => {
  const restore = enableFixture();
  try {
    const a = deferred(), b = deferred();
    const api = fakeApi({ nearby: o => (o.categoryCode === 'SUPERMARKETS' ? a.p : b.p), route: async () => ({ ok: false, error: {} }) });
    const c = CL.controller({ developmentId: DEV, client: api, policy: D.radiusPolicy(DEV), registry: D.buildRegistry(CFG, DEV) });
    const pa = c.selectCategory('SUPERMARKETS'), pb = c.selectCategory('SCHOOLS');
    b.resolve({ ok: true, data: { places: [{ ...place('PlaceSCHOOL001', 700), name: 'Escola X' }] } }); await pb;
    a.resolve({ ok: true, data: { places: [place('PlaceMARKET001', 500)] } }); const ra = await pa;
    assert.equal(ra.ignored, true); assert.equal(c.state().selectedCategory, 'SCHOOLS'); assert.deepEqual(c.state().places.map(p => p.providerPlaceId), ['PlaceSCHOOL001']);
  } finally { restore(); }
});
test('golden §428 + §420: 8 km → 2 km drops places outside the smaller filter; route failure keeps the place and its straight-line distance', async () => {
  const restore = enableFixture();
  try {
    const api = fakeApi({ nearby: async o => ({ ok: true, data: { places: [place('PlaceFFFFFFFF1', 1500), place('PlaceFFFFFFFF2', 6500)].filter(p => p.straightLineDistanceMeters <= o.radiusMeters) } }), route: async () => ({ ok: false, error: { code: 'GOOGLE_ROUTES_UNAVAILABLE' } }) });
    const seen = []; const c = CL.controller({ developmentId: DEV, client: api, policy: D.radiusPolicy(DEV), registry: D.buildRegistry(CFG, DEV), onChange: s => seen.push(s.places.length) });
    await c.selectCategory('SUPERMARKETS'); assert.equal(c.state().places.length, 2);
    c.selectPlace('PlaceFFFFFFFF2');
    const p = c.selectRadius(2000); assert.equal(c.state().places.length, 1, 'immediately narrowed before the refresh'); assert.equal(c.state().selectedPlaceId, undefined); await p;
    assert.equal(api.calls.nearby.at(-1).radiusMeters, 2000, 'smaller radius requested directly, not 8000 + client filter (§82)');
    assert.equal((await c.selectRadius(9000)).code, 'LOCATION_RADIUS_INVALID');
    c.selectPlace('PlaceFFFFFFFF1'); await c.requestRoute();
    const st = c.state(); assert.equal(st.routePhase, 'ERROR'); assert.equal(st.selectedPlaceId, 'PlaceFFFFFFFF1'); assert.equal(st.places.length, 1);
    const html = V.render(V.viewModel({ developmentId: DEV, capability: D.capability(DEV, { browserKeyConfigured: true, serverKeyConfigured: true }), state: st }));
    assert.match(html, /Não foi possível calcular o trajeto agora/); assert.match(html, /Linha reta<\/dt><dd>1,5 km/);
  } finally { restore(); }
});
test('API client: semantic endpoints only, single-flight, no backend → null (static panel)', async () => {
  assert.equal(CL.api({ baseUrl: null, fetch: () => { throw new Error('no'); } }), null);
  const urls = []; const f = async (u, init) => { urls.push([u, init && init.method]); await new Promise(r => setTimeout(r, 5)); return { ok: true, json: async () => ({ data: { places: [] } }) }; };
  const a = CL.api({ baseUrl: 'https://api.example.test/', fetch: f });
  await Promise.all([a.nearbyPlaces({ developmentId: DEV, categoryCode: 'SUPERMARKETS', radiusMeters: 4000 }), a.nearbyPlaces({ developmentId: DEV, categoryCode: 'SUPERMARKETS', radiusMeters: 4000 })]);
  assert.equal(urls.length, 1); assert.equal(urls[0][0], `https://api.example.test/api/v1/developments/${DEV}/nearby-places?category=SUPERMARKETS&radius=4000&rank=DISTANCE`);
  await a.routeEstimate({ developmentId: DEV, providerPlaceId: 'PlaceGGGGGGGG1' }); assert.deepEqual(urls[1], [`https://api.example.test/api/v1/developments/${DEV}/route-estimates`, 'POST']);
  const bad = CL.api({ baseUrl: 'https://api.example.test', fetch: async () => ({ ok: false, status: 503, json: async () => ({ code: 'GOOGLE_PLACES_UNAVAILABLE', message: 'Dados do entorno temporariamente indisponíveis.' }) }) });
  const r = await bad.nearbyPlaces({ developmentId: DEV, categoryCode: 'SUPERMARKETS', radiusMeters: 2000 }); assert.equal(r.ok, false); assert.equal(r.error.code, 'GOOGLE_PLACES_UNAVAILABLE');
});

// ------------------------------------------------------------------------------------------ loader + Maps JS adapter
test('GoogleMapsLoader: injects the Maps JS script once (single-flight) only when available, with the browser key; failure allows a manual retry', async () => {
  const restore = enableFixture();
  try {
    const cap = D.capability(DEV, { browserKeyConfigured: true, serverKeyConfigured: true }); assert.equal(cap.state, 'AVAILABLE');
    assert.equal(D.capability(DEV, { browserKeyConfigured: false }).state, 'NOT_CONFIGURED');
    assert.equal(D.capability(DEV, { browserKeyConfigured: true, online: false }).state, 'OFFLINE');
    const doc = fakeDoc(), win = {}; const L = CL.loader({ document: doc, capability: cap, browserKey: 'fake-browser-key', win });
    const p1 = L.load(), p2 = L.load(); assert.equal(p1, p2); assert.equal(doc.scripts.length, 1);
    const src = doc.scripts[0].src; assert.match(src, /^https:\/\/maps\.googleapis\.com\/maps\/api\/js\?/); assert.match(src, /key=fake-browser-key/); assert.match(src, /language=pt-BR/);
    const cb = new URL(src).searchParams.get('callback'); win.google = { maps: {} }; win[cb](); assert.equal((await p1).ok, true);
    const doc2 = fakeDoc(), L2 = CL.loader({ document: doc2, capability: cap, browserKey: 'k', win: {} }); const f1 = L2.load(); doc2.scripts[0].onerror(); assert.equal((await f1).ok, false);
    L2.load(); assert.equal(doc2.scripts.length, 2, 'manual retry after a failed load'); assert.equal(L2.attempts(), 2);
    assert.equal((await CL.loader({ document: fakeDoc(), capability: cap, browserKey: null, win: {} }).load()).code, 'GOOGLE_MAPS_NOT_CONFIGURED');
  } finally { restore(); }
});
function fakeGoogle() {
  const made = { circles: [], markers: [], maps: [] };
  class Obj { constructor(o) { this.o = o; this.map = o.map; this.ls = []; } setMap(m) { this.map = m; } addListener(e, fn) { const l = { e, fn, remove: () => { l.removed = true; } }; this.ls.push(l); return l; } setZIndex(z) { this.z = z; } setOpacity(x) { this.op = x; } }
  return { made, maps: { Map: class extends Obj { constructor(el, o) { super(o); made.maps.push(this); } fitBounds(b) { this.bounds = b; } panTo(p) { this.center = p; } },
    Circle: class extends Obj { constructor(o) { super(o); made.circles.push(this); } setRadius(r) { this.o.radius = r; } }, Marker: class extends Obj { constructor(o) { super(o); made.markers.push(this); } } } };
}
test('Maps JS adapter: development marker, non-editable/non-draggable Circle, fitBounds of the radius, markers without duplicates, marker ↔ list', () => {
  const restore = enableFixture();
  try {
    const g = fakeGoogle(), sel = []; const rt = CL.runtimeConfig(DEV, { radiusMeters: 4000 });
    assert.equal(rt.activeRadiusMeters, 4000); assert.equal(rt.maxRadiusMeters, 8000); assert.equal(rt.developmentName, 'Empreendimento de teste'); assert.ok(!('key' in rt));
    const mv = CL.mapView({ google: g, element: {}, runtime: rt, onSelect: id => sel.push(id) });
    const c = g.made.circles[0]; assert.equal(c.o.editable, false); assert.equal(c.o.draggable, false); assert.equal(c.o.clickable, false); assert.equal(c.o.radius, 4000);
    assert.equal(g.made.maps[0].o.restriction.strictBounds, false); assert.ok(g.made.maps[0].bounds.north > CENTER.latitude);
    assert.equal(mv.setRadius(9000), false); assert.equal(mv.setRadius(2000), true); assert.equal(c.o.radius, 2000);
    const ps = [place('PlaceHHHHHHHH1', 500), place('PlaceHHHHHHHH2', 900)];
    mv.setPlaces(ps); mv.setPlaces(ps, 'PlaceHHHHHHHH1'); assert.equal(mv.markerCount(), 2); assert.equal(g.made.markers.length, 3, '1 development + 2 POIs, no duplicates');
    mv.setPlaces([ps[1]]); assert.equal(mv.markerCount(), 1);
    g.made.markers[2].ls[0].fn(); assert.deepEqual(sel, ['PlaceHHHHHHHH2']);
    mv.destroy(); assert.equal(c.map, null); assert.equal(mv.markerCount(), 0);
  } finally { restore(); }
});

// ------------------------------------------------------------------------------------------ view
test('view AVAILABLE: radius chips 2/4/6/8 only, category chips with text glyphs, accessible list, attribution, distinct loading/empty/error copy, escaping', () => {
  const restore = enableFixture();
  try {
    const cap = D.capability(DEV, { browserKeyConfigured: true, serverKeyConfigured: true });
    const vm = s => V.viewModel({ developmentId: DEV, capability: cap, state: { selectedRadiusMeters: 8000, rankPreference: 'DISTANCE', places: [], routePhase: 'IDLE', ...s } });
    const idle = V.render(vm({ phase: 'IDLE' }));
    assert.deepEqual([...idle.matchAll(/data-act="envRadius" data-v="(\d+)"/g)].map(m => m[1]), ['2000', '4000', '6000', '8000']);
    assert.match(idle, /data-surroundings-map/); assert.match(idle, /Selecione o que deseja encontrar no entorno\./); assert.match(idle, /Raio máximo do entorno: 8 km/); assert.match(idle, /Dados de locais: Google Maps/);
    assert.match(idle, /Área analisada — até 8 km/); assert.match(idle, /As distâncias em linha reta consideram a coordenada oficial/);
    assert.equal((idle.match(/data-act="envCategory"/g) || []).length, 12);
    const loading = V.render(vm({ phase: 'LOADING', selectedCategory: 'SUPERMARKETS' })), empty = V.render(vm({ phase: 'EMPTY', selectedCategory: 'SUPERMARKETS' })), error = V.render(vm({ phase: 'ERROR', selectedCategory: 'SUPERMARKETS' }));
    assert.match(loading, /Carregando locais\.\.\./); assert.match(empty, /Nenhum resultado retornado para esta busca\./); assert.match(error, /Dados do entorno temporariamente indisponíveis\./);
    assert.ok(!/temporariamente/.test(empty) && !/Nenhum resultado/.test(error), 'empty and unavailable are distinct');
    const ps = [place('PlaceIIIIIIII1', 2800, { name: '<b>Mercado</b>', rating: null }), place('PlaceIIIIIIII2', 5200)];
    const ready = V.render(vm({ phase: 'READY', selectedCategory: 'SUPERMARKETS', places: ps, selectedPlaceId: 'PlaceIIIIIIII1', summary: { text: D.summaryText({ count: 2, categoryLabel: 'Supermercados', radiusMeters: 8000 }) } }));
    assert.match(ready, /Locais encontrados no raio/); assert.ok(!/todos/i.test(ready)); assert.ok(!ready.includes('<b>Mercado</b>') && ready.includes('&lt;b&gt;Mercado&lt;/b&gt;'));
    assert.match(ready, /Linha reta: 2,8 km/); assert.match(ready, /Sem avaliação disponível/); assert.ok(!/Avaliação: 0/.test(ready)); assert.match(ready, /data-act="envRoute"/); assert.match(ready, /Abrir no Google Maps/); assert.match(ready, /rel="noopener noreferrer"/);
    const routed = V.render(vm({ phase: 'READY', selectedCategory: 'SUPERMARKETS', places: ps, selectedPlaceId: 'PlaceIIIIIIII2', routePhase: 'READY', route: { distanceMeters: 7100, durationSeconds: 660 } }));
    assert.match(routed, /De carro<\/dt><dd>7,1 km/); assert.match(routed, /Tempo estimado<\/dt><dd>11 min/); assert.match(routed, /o trajeto por vias pode ser maior/);
    assert.match(V.render(V.viewModel({ developmentId: DEV, capability: D.capability(DEV, { browserKeyConfigured: true, online: false }) })), /Entorno indisponível sem conexão/);
  } finally { restore(); }
});
test('security: the browser code never calls Places/Routes directly, never reads the server key, never stores provider content locally', () => {
  for (const f of ['surroundings/surroundingsClient.js', 'surroundings/surroundingsView.js', 'surroundings/surroundingsDomain.js']) {
    const s = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.ok(!/places\.googleapis|routes\.googleapis|X-Goog-Api-Key|GOOGLE_MAPS_API_KEY/.test(s), f);
    assert.ok(!/localStorage|sessionStorage|indexedDB|caches\.open/.test(s), f);
  }
  const all = FILES.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(all), 'no Google key literal in the frontend');
  assert.ok(!/navigator\.geolocation/.test(all), 'no user geolocation prompt (§225)');
});
