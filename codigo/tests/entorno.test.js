'use strict';
// Round 7 (2026-10-19): keyless Entorno map (OpenStreetMap base map, georeferenced plan, 2–8 km rings, Google Maps links).
// No network: projection math, the affine fit on the 498 real lots, capability states, the no-PII / no-key rules, the CSP host,
// the worker routing of tiles and the slippy map's tile budget/failure path on a tiny fake DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

const FILES = ['config/surroundings/surroundings.config.js', 'surroundings/surroundingsDomain.js', 'surroundings/geoMercator.js', 'surroundings/slippyMap.js', 'surroundings/entornoView.js'];
let App, G, D, E, CFG, LOTS;
const GATE = { lat: -20.145472, lon: -40.211418 };
test.before(async () => {
  App = load();
  for (const f of FILES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  G = App.surroundings.geo; D = App.surroundings.domain; E = App.surroundings.entorno; CFG = App.surroundings.config;
  const repo = App.repos.createLotRepository('viva-juara'); await repo.load(); LOTS = repo.lotsSync();
});

// ------------------------------------------------------------------------------------------ projection math
test('Web Mercator: lat/lon ↔ world pixel round trip at every zoom of the Entorno (11–18) and beyond', () => {
  const pts = [GATE, { lat: 0, lon: 0 }, { lat: -20.14228, lon: -40.21316 }, { lat: -20.14923, lon: -40.20275 }, { lat: 60.5, lon: 170.25 }, { lat: -84.9, lon: -179.9 }];
  for (let z = 0; z <= 20; z++) for (const p of pts) {
    const px = G.toPixel(p.lat, p.lon, z), back = G.fromPixel(px.x, px.y, z);
    assert.ok(Math.abs(back.lat - p.lat) < 1e-9 && Math.abs(back.lon - p.lon) < 1e-9, `z${z} ${p.lat},${p.lon}`);
    const again = G.toPixel(back.lat, back.lon, z); assert.ok(Math.abs(again.x - px.x) < 1e-6 && Math.abs(again.y - px.y) < 1e-6);
  }
  // independent OSM-wiki formula for the tile index of the gatehouse
  for (let z = 11; z <= 18; z++) {
    const n = 2 ** z, r = GATE.lat * Math.PI / 180;
    const tx = Math.floor((GATE.lon + 180) / 360 * n), ty = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    const px = G.toPixel(GATE.lat, GATE.lon, z); assert.deepEqual([Math.floor(px.x / 256), Math.floor(px.y / 256)], [tx, ty], `tile z${z}`);
  }
  assert.ok(Math.abs(G.metresPerPixel(0, 0) - 156543.03392804097) < 1e-6);
});

test('plan georeferencing: affine fit of the 498 lot centroids (plan pixels) to their KMZ lat/lon — every residual < 5 m', () => {
  assert.equal(LOTS.length, 498);
  const R = G.planGeoref(LOTS);
  assert.equal(R.residuals.n, 498, 'every lot has a polygon and a KMZ coordinate (nothing filled in)');
  assert.ok(R.residuals.maxMeters < 5, `max ${R.residuals.maxMeters}`);
  assert.ok(R.residuals.meanMeters < 0.5, `mean ${R.residuals.meanMeters}`);
  assert.ok(R.perLot.every(x => x.errorMeters < 5));
  // the same fit from the raw lots.json rows (fields p, lat, lon) gives the same transform
  const raw = LOTS.map(l => ({ id: l.identity.id, p: l.geometry.polygon, lat: l.location.latitude, lon: l.location.longitude }));
  const R2 = G.planGeoref(raw); R.planToNorm.forEach((v, i) => assert.ok(Math.abs(v - R2.planToNorm[i]) < 1e-12));
  // independent check: the plan frame corners land on the KMZ GroundOverlay LatLonBox (N -20.14228 S -20.14923 E -40.20275 W -40.21316)
  const nw = G.planToLatLon(R, 0, 0), se = G.planToLatLon(R, 2247, 1587);
  assert.ok(G.haversine(nw, { lat: -20.14228, lon: -40.21316 }) < 5, JSON.stringify(nw));
  assert.ok(G.haversine(se, { lat: -20.14923, lon: -40.20275 }) < 5, JSON.stringify(se));
  // the CSS matrix maps a plan point to the same pane pixel as the projection of its lat/lon
  const z = 17, ox = 1000, oy = 2000, m = G.cssMatrix(R.planToNorm, z, ox, oy).match(/matrix\((.*)\)/)[1].split(',').map(Number);
  const c = G.polygonCentroid(LOTS[0].geometry.polygon), ll = G.planToLatLon(R, c[0], c[1]), px = G.toPixel(ll.lat, ll.lon, z);
  assert.ok(Math.abs(m[0] * c[0] + m[2] * c[1] + m[4] - (px.x - ox)) < 0.01 && Math.abs(m[1] * c[0] + m[3] * c[1] + m[5] - (px.y - oy)) < 0.01);
  // too few lots → no fit (never extrapolated from 1–2 points)
  assert.equal(G.planGeoref(LOTS.slice(0, 2)), null);
});

test('area-weighted centroid and affine solver', () => {
  assert.deepEqual(G.polygonCentroid([[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]), [2, 1]);
  const tri = G.polygonCentroid([[0, 0], [6, 0], [0, 3]]); assert.ok(Math.abs(tri[0] - 2) < 1e-12 && Math.abs(tri[1] - 1) < 1e-12);
  const A = [2, 0.5, -1, 3, 10, -7], pairs = [[0, 0], [1, 0], [0, 1], [5, 7], [-3, 2]].map(s => ({ src: s, dst: G.applyAffine(A, s[0], s[1]) }));
  G.fitAffine(pairs).forEach((v, i) => assert.ok(Math.abs(v - A[i]) < 1e-9));
});

test('rings: 2/4/6/8 km geodesic circles around the gatehouse, radius exact on the ground and in Mercator pixels', () => {
  assert.deepEqual(CFG.environmentMap.ringsMeters, [2000, 4000, 6000, 8000]);
  for (const r of CFG.environmentMap.ringsMeters) {
    const pts = G.ring(GATE, r, 180); assert.equal(pts.length, 180);
    for (const p of pts) assert.ok(Math.abs(G.haversine(GATE, p) - r) < 0.01, `${r} m`);
    for (const z of [11, 15, 18]) { // on screen: north/east radius in pixels ≈ metres / ground resolution (Mercator scale)
      const c = G.toPixel(GATE.lat, GATE.lon, z), e = G.toPixel(pts[45].lat, pts[45].lon, z), n = G.toPixel(pts[0].lat, pts[0].lon, z);
      const expected = r / G.metresPerPixel(GATE.lat, z);
      assert.ok(Math.abs((e.x - c.x) / expected - 1) < 0.002, `east ${r} z${z}`);
      assert.ok(Math.abs((c.y - n.y) / expected - 1) < 0.01, `north ${r} z${z}`);
    }
  }
  const env = G.envelope(GATE, 8000); assert.ok(env.north > GATE.lat && env.south < GATE.lat && env.east > GATE.lon && env.west < GATE.lon);
});

test('tiles: only the visible ones plus at most one ring; URL template is strict', () => {
  const c = G.toPixel(GATE.lat, GATE.lon, 15);
  for (const [w, h] of [[320, 500], [768, 700], [1280, 800], [1700, 950]]) {
    const t = G.visibleTiles({ cx: c.x, cy: c.y, z: 15, width: w, height: h, margin: 5 });
    assert.ok(t.length <= (Math.ceil(w / 256) + 3) * (Math.ceil(h / 256) + 3), `${w}x${h}: ${t.length}`);
    assert.equal(new Set(t.map(x => x.key)).size, t.length);
    const none = G.visibleTiles({ cx: c.x, cy: c.y, z: 15, width: w, height: h, margin: 0 });
    assert.ok(none.length < t.length && none.length <= (Math.ceil(w / 256) + 1) * (Math.ceil(h / 256) + 1));
  }
  const p = CFG.baseMapProviders[0];
  assert.equal(G.tileUrl(p.tileUrlTemplate, { z: 15, x: 12088, y: 18310 }), 'https://tile.openstreetmap.org/15/12088/18310.png');
  assert.throws(() => G.tileUrl(p.tileUrlTemplate, { z: 15, x: '1/../..', y: 2 }));
  assert.equal(G.fitZoom(GATE, 2000, 1280, 700, { minZoom: 11, maxZoom: 18, paddingPx: 16 }), 14);
  assert.equal(G.fitZoom(GATE, 2000, 300, 400, { minZoom: 11, maxZoom: 18, paddingPx: 16 }), 13);
});

// ------------------------------------------------------------------------------------------ capability and config
test('capability: OSM base map AVAILABLE with the validated coordinate; Google features stay NOT_CONFIGURED', () => {
  const cap = D.capability('viva-juara', { browserKeyConfigured: false, serverKeyConfigured: false, online: true });
  assert.equal(cap.BASE_MAP, true); assert.equal(cap.baseMap.state, 'AVAILABLE'); assert.equal(cap.baseMap.provider, 'OSM');
  assert.deepEqual(cap.baseMap.center, GATE);
  assert.equal(cap.state, 'NOT_CONFIGURED'); assert.equal(cap.GOOGLE_MAPS_ENVIRONMENT, false); assert.equal(cap.NEARBY_PLACES, false); assert.equal(cap.ROUTE_ESTIMATES, false);
  assert.equal(CFG.featureFlag.enabled, false, 'the Google flag is untouched');
  const off = D.capability('viva-juara', { online: false });
  assert.equal(off.BASE_MAP, true); assert.equal(off.baseMap.offline, true); assert.match(off.baseMap.message, /sem conexão/);
  // a development without a validated coordinate gets nothing (never a centroid or an approximate point)
  const vj = CFG.developments['viva-juara'];
  CFG.developments.tmp = { ...vj, location: { ...vj.location, locationStatus: 'UNVERIFIED' } };
  try {
    const c2 = D.capability('tmp', {}); assert.equal(c2.BASE_MAP, false); assert.equal(c2.baseMap.state, 'NOT_VALIDATED'); assert.equal(c2.baseMap.center, null);
    assert.equal(D.externalLinks('tmp'), null);
    const html = E.html(E.viewModel('tmp', { lots: LOTS })); assert.match(html, /ainda não validada/); assert.doesNotMatch(html, /envvp|google\.com/);
  } finally { delete CFG.developments.tmp; }
  // a provider that would need a key is not a keyless base map
  const p = CFG.baseMapProviders[0], prev = p.requiresKey; p.requiresKey = true;
  try { assert.equal(D.capability('viva-juara', {}).baseMap.state, 'NOT_CONFIGURED'); } finally { p.requiresKey = prev; }
  assert.equal(D.capability('nope', {}).BASE_MAP, false);
});

test('OSM provider entry: tile usage policy and attribution are recorded', () => {
  const p = CFG.baseMapProviders.find(x => x.code === 'OSM');
  assert.equal(p.requiresKey, false); assert.equal(p.attribution.text, '© OpenStreetMap contributors'); assert.equal(p.attribution.url, 'https://www.openstreetmap.org/copyright');
  assert.equal(p.usagePolicy.maxPrefetchRings, 1); assert.equal(p.usagePolicy.bulkDownload, false); assert.equal(p.usagePolicy.serviceWorkerCache, false);
  assert.equal(p.origin, 'https://tile.openstreetmap.org'); assert.deepEqual([p.minZoom, p.maxZoom], [11, 18]);
});

test('Google Maps links: plain URLs to the official coordinate only (no user data, no key, no tracking)', () => {
  const L = D.externalLinks('viva-juara');
  assert.equal(L.openInMaps, 'https://www.google.com/maps/search/?api=1&query=-20.145472,-40.211418');
  assert.equal(L.directions, 'https://www.google.com/maps/dir/?api=1&destination=-20.145472,-40.211418');
  for (const u of Object.values(L)) { const q = new URL(u).searchParams; assert.deepEqual([...q.keys()].sort(), u.includes('/dir/') ? ['api', 'destination'] : ['api', 'query']); assert.doesNotMatch(u, /key=|origin=|utm_|client|lot|cliente/i); }
  const vm = E.viewModel('viva-juara', { lots: LOTS }), html = E.html(vm);
  for (const href of [L.openInMaps, L.directions]) assert.ok(html.includes(`href="${href.replace(/&/g, '&amp;')}" target="_blank" rel="noopener noreferrer"`), href);
  assert.match(html, />Abrir no Google Maps</); assert.match(html, />Como chegar</);
});

test('Entorno markup: attribution, rings copy, pending-places note; no place list, no Google script, no key', () => {
  const vm = E.viewModel('viva-juara', { lots: LOTS }), html = E.html(vm);
  assert.equal(vm.planOverlay, true, 'the plan is overlaid only because every residual is under the configured limit');
  assert.match(html, /<a href="https:\/\/www\.openstreetmap\.org\/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors<\/a>/);
  assert.match(html, /Locais próximos \(mercados, escolas, farmácias\) aparecem quando a chave do Google Maps for configurada\./);
  assert.match(html, /Círculos de 2, 4, 6 e 8 km em linha reta/); assert.match(html, /Mapa de fundo indisponível nesta visualização/);
  assert.match(html, /data-act="envTab" data-v="environment" aria-pressed="true"/);
  assert.doesNotMatch(html, /<script|maps\.googleapis|places\.googleapis|envplb|envlist|\btodos\b/i);
  for (const a of html.matchAll(/data-act="([a-zA-Z]+)"/g)) assert.ok(['envTab', 'envZoomIn', 'envZoomOut', 'envRecenter', 'envPlan', 'envAerial', 'envInfo', 'envRetryTiles'].includes(a[1]), a[1]);
  // pt-BR number in the computed residual label
  assert.match(html, /calculado: erro médio 0,3 m em 498 lotes/);
});

test('no secrets and no personal data in the Entorno sources and config', () => {
  for (const f of [...FILES, 'surroundings/surroundings.css']) {
    const s = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.doesNotMatch(s, /AIza[0-9A-Za-z_-]{20,}|[?&]key=|apikey|access_token/i, f);
    assert.doesNotMatch(s, /localStorage|sessionStorage|indexedDB|navigator\.geolocation|getCurrentPosition|document\.cookie/, f);
  }
  const src = fs.readFileSync(path.join(SRC, 'surroundings/entornoView.js'), 'utf8') + fs.readFileSync(path.join(SRC, 'surroundings/slippyMap.js'), 'utf8');
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, 'tiles are plain <img>; nothing else leaves the page');
});

// ------------------------------------------------------------------------------------------ security plumbing
test('CSP: img-src allows exactly one new host (tile.openstreetmap.org); wildcard image sources are HIGH', () => {
  const H = App.securityHardening, csp = H.buildCsp({ scriptHashes: ['AAAA'] });
  const img = csp.split(';').map(s => s.trim()).find(s => s.startsWith('img-src')).split(/\s+/).slice(1);
  assert.deepEqual(img, ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org']);
  assert.ok(!/maps\.googleapis|gstatic\.com\/maps/.test(csp));
  assert.equal(H.evaluateCsp(csp).filter(f => f.severity === 'HIGH').length, 0);
  assert.ok(H.evaluateCsp(csp.replace('https://tile.openstreetmap.org', 'https://*.openstreetmap.org')).some(f => f.code === 'WILDCARD_IMG'));
  assert.ok(H.evaluateCsp(csp.replace('img-src', 'img-src https:')).some(f => f.code === 'WILDCARD_IMG'));
});

test('Service Worker never handles (never caches) OSM tiles', () => {
  const RT = require('../src/pwa/swRouting.js'), ctx = { scopePath: '/', rules: RT.compile([]), precache: new Set() };
  const d = RT.classify({ method: 'GET', url: 'https://tile.openstreetmap.org/15/12088/18310.png', mode: 'no-cors', sameOrigin: false }, ctx);
  assert.equal(d.handle, false);
});

test('features: Entorno switch and map controls are uiOnly and allowed for the visitor in every mode', () => {
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config/security/features.json'), 'utf8'));
  for (const a of ['envTab', 'envZoomIn', 'envZoomOut', 'envRecenter', 'envPlan', 'envAerial', 'envInfo', 'envRetryTiles']) {
    assert.ok(F.uiOnlyActions[a], a);
    for (const mode of ['broker', 'client', 'technical']) assert.equal(App.authz.action(a, { mode, v: 'environment' }, { developmentId: 'viva-juara' }).allowed, true, `${a} ${mode}`);
  }
  const shell = fs.readFileSync(path.join(SRC, 'presentation/shell.html'), 'utf8');
  assert.match(shell, /<div class="edge l">.*data-act="envTab" data-v="lots" aria-pressed="true">Mapa de Lotes<\/button><button type="button" data-act="envTab" data-v="environment" aria-pressed="false">Entorno<\/button>/);
  assert.match(shell, /id="envView"[^>]*hidden/);
});

test('code split: the Entorno modules live only in the surroundings chunk; app.js loads it on the first open', () => {
  const CH = require('../scripts/chunks.js');
  for (const f of ['surroundings/geoMercator.js', 'surroundings/slippyMap.js', 'surroundings/entornoView.js']) assert.ok(CH.LAZY_ONLY.includes(f), f);
  const app = fs.readFileSync(path.join(SRC, 'presentation/app.js'), 'utf8');
  assert.match(app, /CK\.ensureAll\(\['surroundings'\]\)/);
  assert.doesNotMatch(app, /ACT_CHUNKS = \{[^}]*envTab/, 'switching back to the lot map never loads the chunk');
  assert.doesNotMatch(app, /tile\.openstreetmap/, 'no tile URL in the initial page code');
});

// ------------------------------------------------------------------------------------------ slippy map on a fake DOM
function fakeDom() {
  const made = [];
  class El {
    constructor(tag) { this.tagName = tag; this.style = {}; this.dataset = {}; this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false; this.className = ''; this.parent = null; made.push(this);
      this.classList = { add: c => { this.className += ' ' + c; }, remove: () => {}, contains: c => this.className.split(' ').includes(c) }; }
    appendChild(c) { c.parent = this; this.children.push(c); return c; } append(...cs) { cs.forEach(c => this.appendChild(c)); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
    setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k]; } removeAttribute(k) { delete this.attrs[k]; if (k === 'src') this._src = undefined; }
    set src(v) { this._src = v; } get src() { return this._src; }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); } removeEventListener() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  }
  const doc = { createElement: t => new El(t), createElementNS: (n, t) => new El(t), defaultView: { requestAnimationFrame: f => setTimeout(f, 0) } };
  const vp = new El('div'); vp.ownerDocument = doc; vp.clientWidth = 800; vp.clientHeight = 600;
  return { vp, made, imgs: () => made.filter(e => e.tagName === 'img' && e.parent) };
}
test('slippy map: requests only visible tiles + 1 ring, drops tiles out of view, stops on failure and shows FAILED', async () => {
  const S = App.surroundings.slippy, p = CFG.baseMapProviders[0], dom = fakeDom(), states = [];
  const m = S.create(dom.vp, { center: GATE, zoom: 15, minZoom: 11, maxZoom: 18, tileUrlTemplate: p.tileUrlTemplate, bounds: G.envelope(GATE, 10000), onTileStatus: s => states.push(s) });
  const first = dom.imgs(); const max = (Math.ceil(800 / 256) + 3) * (Math.ceil(600 / 256) + 3);
  assert.ok(first.length > 0 && first.length <= max, String(first.length));
  assert.ok(first.every(i => /^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/.test(i.src) && i.referrerPolicy === 'strict-origin-when-cross-origin' && i.alt === ''));
  assert.equal(m.tileStats().requested, first.length);
  first[0].onload(); assert.deepEqual(states, ['LOADING', 'OK']);
  m.zoomBy(1); const z16 = dom.imgs(); assert.ok(z16.every(i => /\/16\//.test(i.src)), 'old-zoom tiles are dropped'); assert.equal(m.getZoom(), 16);
  for (let i = 0; i < 10; i++) m.zoomBy(1); assert.equal(m.getZoom(), 18, 'max zoom 18');
  for (let i = 0; i < 20; i++) m.zoomBy(-1); assert.equal(m.getZoom(), 11, 'min zoom 11');
  m.destroy();
  // every tile fails (artifact viewer CSP, offline): FAILED after 3 errors without a single load, then no new request
  const d2 = fakeDom(), st2 = [];
  const m2 = S.create(d2.vp, { center: GATE, zoom: 15, minZoom: 11, maxZoom: 18, tileUrlTemplate: p.tileUrlTemplate, onTileStatus: s => st2.push(s) });
  for (const i of d2.imgs().slice(0, 3)) i.onerror();
  assert.equal(st2.at(-1), 'FAILED'); assert.equal(d2.imgs().length, 0);
  const before = m2.tileStats().requested; m2.zoomBy(1); assert.equal(m2.tileStats().requested, before, 'no request after FAILED');
  m2.retryTiles(); assert.ok(m2.tileStats().requested > 0 && d2.imgs().length > 0, 'retry asks again');
  m2.destroy();
});

// ------------------------------------------------------------------------------------------ 2026-10-20: Aérea ilustrativa (aerea_ampliada.webp)
const DASH = path.join(__dirname, '..', '..', 'dash');
function webpSize(file) { // RIFF/WEBP canvas size (VP8X, VP8L or VP8)
  const b = fs.readFileSync(file), t = b.toString('ascii', 12, 16);
  if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (t === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
}
test('Aérea ilustrativa: image size matches its plan rect (1 px = 1 unit) and the frame image keeps the lot-map frame', () => {
  const ao = CFG.environmentMap.aerialOverlay, dev = App.config.DEVELOPMENTS.find(d => d.id === 'viva-juara');
  assert.deepEqual(ao.planRect, { x: -113, y: -327, w: 2321, h: 2321 });
  assert.deepEqual(JSON.parse(JSON.stringify(dev.map.aerialWideRect || null)), JSON.parse(JSON.stringify(ao.planRect)), 'lot map and Entorno place the same image at the same plan rect');
  assert.equal(dev.assets.aerialWide, ao.asset);
  assert.deepEqual(webpSize(path.join(DASH, ao.asset)), { w: ao.planRect.w, h: ao.planRect.h });
  assert.deepEqual(webpSize(path.join(DASH, dev.assets.aerial)), { w: dev.map.width, h: dev.map.height });
  // the widened image covers the frame except a 39-unit east strip (outside the illustration), which the lot map fills mirrored
  assert.ok(ao.planRect.x <= 0 && ao.planRect.y <= 0 && ao.planRect.y + ao.planRect.h >= dev.map.height);
  assert.equal(dev.map.width - (ao.planRect.x + ao.planRect.w), 39);
  assert.match(fs.readFileSync(path.join(SRC, 'presentation/map.js'), 'utf8'), /translate\(\$\{2 \* EX\} 0\) scale\(-1 1\)/);
  const m = JSON.parse(fs.readFileSync(path.join(DASH, 'manifest.json'), 'utf8'));
  for (const f of [ao.asset, dev.assets.aerial]) assert.match((m.assets.find(a => a.path === f) || {}).checksum || '', /^[0-9a-f]{12}$/, `${f} versioned by checksum`);
});

test('Aérea ilustrativa: positioned by the plan affine composed with the image offset (same lat/lon as planta.webp)', () => {
  const R = G.planGeoref(LOTS), r = CFG.environmentMap.aerialOverlay.planRect, N = R.planToNorm;
  const off = [N[0], N[1], N[2], N[3], N[4] + N[0] * r.x + N[2] * r.y, N[5] + N[1] * r.x + N[3] * r.y];
  const ap = (M, x, y) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  for (const [px, py] of [[0, 0], [2247, 0], [0, 1587], [2247, 1587], [1100, 800]]) {
    const a = ap(N, px, py), b = ap(off, px - r.x, py - r.y); // plan point vs. the same point as an image pixel
    assert.ok(Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12);
  }
  // the CSS matrix the view writes: image pixel (113, 327) (= plan origin) lands where the plan's origin lands
  const z = 16, ox = 100, oy = 50, parse = s => s.slice(7, -1).split(',').map(Number);
  const mp = parse(G.cssMatrix(N, z, ox, oy)), ma = parse(G.cssMatrix(off, z, ox, oy));
  const p0 = ap(mp, 0, 0), a0 = ap(ma, -r.x, -r.y); assert.ok(Math.abs(p0[0] - a0[0]) < 0.01 && Math.abs(p0[1] - a0[1]) < 0.01);
  // image corners stay within ~1.5 km of the gatehouse (sanity: right place on Earth)
  for (const [ix, iy] of [[0, 0], [r.w, 0], [0, r.h], [r.w, r.h]]) { const [nx, ny] = ap(off, ix, iy), ll = G.unproject(nx, ny); assert.ok(G.haversine(ll, GATE) < 1500, JSON.stringify(ll)); }
});

test('Aérea ilustrativa markup: option next to Planta, illustrative label and note, no new network code', () => {
  const vm = E.viewModel('viva-juara', { lots: LOTS }), html = E.html(vm);
  assert.match(html, /data-act="envPlan" aria-pressed="true">Planta<\/button><button type="button" class="mbtn" data-act="envAerial" aria-pressed="false"[^>]*>Aérea ilustrativa<\/button>/);
  assert.match(html, /<p class="envillus" role="note" hidden>Entorno ilustrativo — arte da incorporadora, não é foto<\/p>/);
  assert.match(html, /não é foto nem geografia exata; lagoa e vias em posição aproximada/);
  assert.doesNotMatch(html, /aerea_ampliada/, 'no image URL in the markup: loaded only when chosen');
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config/security/features.json'), 'utf8')); assert.ok(F.uiOnlyActions.envAerial);
});

function fakeBox() {
  const dom = fakeDom(), stubs = new Map(), listeners = {}, doc = dom.vp.ownerDocument; doc.createDocumentFragment = () => doc.createElement('#fragment');
  const stub = sel => { if (!stubs.has(sel)) { const el = { sel, hidden: sel === '.envillus', value: '', textContent: '', attrs: {}, dataset: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; } }; const m = /data-act=(\w+)/.exec(sel); if (m) el.dataset.act = m[1]; stubs.set(sel, el); } return stubs.get(sel); };
  const box = { ownerDocument: dom.vp.ownerDocument, clientWidth: 1000, dataset: {}, innerHTML: '', contains: () => true,
    querySelector: sel => (sel === '.envvp' ? dom.vp : stub(sel)), addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {} };
  const click = act => listeners.click({ target: { closest: s => (s === '[data-lot]' ? null : stub(`[data-act=${act}]`)) } });
  return { dom, box, stub, click };
}
const tick = () => new Promise(r => setTimeout(r, 5));
test('Aérea ilustrativa on a fake DOM: lazy (no bytes until chosen), one overlay at a time, tiles failing → default to it', async () => {
  const f = fakeBox(); let asked = 0;
  const c = E.mount(f.box, { developmentId: 'viva-juara', lots: LOTS, planUrl: 'planta.webp', planSize: { w: 2247, h: 1587 }, aerialUrl: async () => { asked++; return 'blob:aer'; } });
  assert.equal(c.overlay(), 'plan', 'default overlay stays Planta');
  assert.equal(c.aerImg.src, undefined); assert.equal(asked, 0, 'lazy: nothing requested before it is chosen');
  f.click('envAerial'); await tick();
  assert.equal(c.overlay(), 'aerial'); assert.equal(asked, 1); assert.equal(c.aerImg.src, 'blob:aer');
  assert.equal(c.planImg.style.display, 'none'); assert.equal(c.aerImg.style.display, '');
  assert.equal(f.stub('.envillus').hidden, false, 'illustrative note shown with the image');
  assert.match(c.aerImg.style.transform || '', /^matrix\(/);
  f.click('envPlan'); assert.equal(c.overlay(), 'plan'); assert.equal(f.stub('.envillus').hidden, true);
  f.click('envPlan'); assert.equal(c.overlay(), 'none');
  c.destroy();
  // tiles blocked (artifact viewer): FAILED → Aérea ilustrativa by default
  const f2 = fakeBox(); let asked2 = 0;
  const c2 = E.mount(f2.box, { developmentId: 'viva-juara', lots: LOTS, planUrl: 'planta.webp', planSize: { w: 2247, h: 1587 }, aerialUrl: () => { asked2++; return 'aerea_ampliada.webp'; } });
  for (const i of f2.dom.imgs().filter(i => /openstreetmap/.test(i.src || '')).slice(0, 3)) i.onerror();
  await tick();
  assert.equal(f2.box.dataset.tiles, 'FAILED'); assert.equal(c2.overlay(), 'aerial'); assert.equal(asked2, 1); assert.equal(c2.aerImg.src, 'aerea_ampliada.webp');
  assert.ok(c2.map.getZoom() >= 15, 'reframed on the development (the 2 km fit would make the picture tiny)');
  c2.destroy();
});
