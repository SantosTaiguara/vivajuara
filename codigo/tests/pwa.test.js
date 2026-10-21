'use strict';
// Topic 49 — PWA and offline experience: capability registry, web app manifest, request classifier + policy projection, the built
// Service Worker run in a vm (install/precache, activate, routing, offline fallbacks, pack fallback, versioned image cache, update
// messages), update coordinator, connectivity hysteresis, install prompt policy, offline packs (prepare/refresh/rollback/quota/tenant),
// offline mutations + sync, diagnostics/telemetry and the golden scenarios of §345.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
require('./node_modules/fake-indexeddb/auto');
const { load, SRC, DATA } = require('./harness.js');

const MODS = ['pwa/swRouting.js', 'pwa/webManifest.js', 'pwa/pwaCore.js', 'pwa/connectivity.js', 'pwa/update.js', 'pwa/offlinePack.js', 'pwa/sync.js', 'pwa/pwaView.js'];
function app() { const A = load(); for (const f of MODS) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(A); return A; }
const App = app();
const P = App.pwa, RT = P.routing, CORE = P.core, PK = P.pack, SY = P.sync;
const ORG = 'house7', DEV = 'viva-juara';
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const GOLDEN = new Set();
const golden = (name, fn) => test(name, async t => { for (const g of name.match(/Pwa[A-Za-z]+/g) || []) GOLDEN.add(g); await fn(t); });

// ------------------------------------------------------------------ fakes: Cache Storage + network
function FakeCaches() {
  const stores = new Map();
  const urlOf = r => typeof r === 'string' ? r : r.url;
  const strip = u => u.split('?')[0];
  function Cache() {
    const m = new Map(); // url → { body: Uint8Array, status, headers: [[k,v]] }
    return {
      async put(req, res) { const body = new Uint8Array(await res.arrayBuffer()); m.set(urlOf(req), { body, status: res.status, headers: [...res.headers.entries()] }); },
      async match(req, o = {}) { const u = urlOf(req); let v = m.get(u); if (!v && o.ignoreSearch) for (const [k, x] of m) if (strip(k) === strip(u)) { v = x; break; } return v ? new Response(v.body.slice(), { status: v.status, headers: v.headers }) : undefined; },
      async keys() { return [...m.keys()].map(url => ({ url })); }, async delete(req) { return m.delete(urlOf(req)); }, _m: m };
  }
  return { async open(n) { if (!stores.has(n)) stores.set(n, Cache()); return stores.get(n); }, async has(n) { return stores.has(n); }, async delete(n) { return stores.delete(n); }, async keys() { return [...stores.keys()]; },
    async match(req, o) { for (const c of stores.values()) { const r = await c.match(req, o); if (r) return r; } return undefined; }, _stores: stores };
}
const ORIGIN = 'https://app.test', SCOPE = ORIGIN + '/app/';
/** network serving a folder; online flag; per-path overrides */
function Network(dir, o = {}) {
  const net = { online: true, log: [], overrides: new Map(), dir };
  const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json' };
  net.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? new URL(input, SCOPE).href : input.url;
    net.log.push({ url, method: (init.method || input.method || 'GET'), cache: init.cache || input.cache });
    if (!net.online) throw new TypeError('Failed to fetch');
    const u = new URL(url); let rel = u.pathname.startsWith('/app/') ? u.pathname.slice(5) : u.pathname.slice(1);
    if (net.overrides.has(rel)) return net.overrides.get(rel)(u);
    if (rel === '' ) rel = 'index.html';
    const f = path.join(net.dir, rel);
    if (!f.startsWith(net.dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return new Response('nf', { status: 404, headers: { 'content-type': 'text/plain' } });
    return new Response(fs.readFileSync(f), { status: 200, headers: { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' } });
  };
  return net;
}
/** run a built sw.js in a vm, Service-Worker style */
function runWorker(swSource, { caches = FakeCaches(), net } = {}) {
  const handlers = {}, posted = [];
  const ctx = { console, URL, Request, Response, Headers, setTimeout, clearTimeout, Promise, JSON, Map, Set, caches, fetch: (...a) => net.fetch(...a),
    location: { origin: ORIGIN, href: SCOPE + 'sw.js' }, skipped: 0,
    registration: { scope: SCOPE, navigationPreload: null },
    clients: { claim: async () => { ctx.claimed = (ctx.claimed || 0) + 1; }, matchAll: async () => [{ postMessage: m => posted.push(m) }] },
    addEventListener: (t, fn) => { handlers[t] = fn; } };
  ctx.self = ctx; ctx.skipWaiting = () => { ctx.skipped++; };
  vm.createContext(ctx); vm.runInContext(swSource, ctx, { filename: 'sw.js' });
  const ext = () => { const e = { waits: [], waitUntil(p) { this.waits.push(p); } }; return e; };
  return {
    ctx, caches, posted, handlers,
    async install() { const e = ext(); handlers.install(e); return Promise.all(e.waits); },
    async activate() { const e = ext(); handlers.activate(e); return Promise.all(e.waits); },
    /** fetch event → Response | null (null = not handled: the browser goes to the network itself) */
    async fetch(rel, o = {}) {
      const url = /^https?:/.test(rel) ? rel : SCOPE + rel;
      const request = { url, method: o.method || 'GET', mode: o.mode || 'cors', cache: o.cache || 'default', headers: new Headers(o.headers || {}) };
      let p = null; handlers.fetch({ request, respondWith(x) { p = x; }, preloadResponse: undefined });
      return p ? await p : null;
    },
    message(data, port) { handlers.message({ data, ports: port ? [port] : [], source: { postMessage: m => posted.push(m) } }); }
  };
}
// a private build of the PWA files (never touches the shared dash): copy only what the worker and the packs need
function buildPwaDir(version = 'b1') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa49-'));
  for (const f of ['index.html', 'manifest.json', 'commercial.json', 'lots.json', 'analysis-input.json', 'planta.webp', 'aerea.webp', 'aerea_ampliada.webp', 'logo.png', 'routes.json', 'img_list.json']) if (fs.existsSync(path.join(DATA, f))) fs.copyFileSync(path.join(DATA, f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'img')); for (const f of fs.readdirSync(path.join(DATA, 'img')).slice(0, 3)) fs.copyFileSync(path.join(DATA, 'img', f), path.join(dir, 'img', f));
  const r = require('../scripts/pwaBuild.js').build({ out: dir, version });
  return { dir, ...r, sw: fs.readFileSync(path.join(dir, 'sw.js'), 'utf8') };
}
const B1 = buildPwaDir('b1aaaaaaaa');

// ------------------------------------------------------------------ capability registry
test('OfflineCapabilityRegistry: every feature declares its capability; commercial commits need the network; customer data is not offline', () => {
  assert.deepEqual(CORE.validateRegistry(), { ok: true, errors: [] });
  const c = code => CORE.getCapability(code).capability;
  assert.equal(c('APP_SHELL'), 'OFFLINE_SUPPORTED'); assert.equal(c('MAP'), 'OFFLINE_SUPPORTED');
  assert.equal(c('AVAILABILITY'), 'OFFLINE_LAST_KNOWN'); assert.equal(c('PRICING'), 'OFFLINE_LAST_KNOWN');
  assert.equal(c('RESERVATION'), 'ONLINE_REQUIRED'); assert.equal(c('PROPOSAL'), 'ONLINE_REQUIRED'); assert.equal(c('SHARED_LINK_OPEN'), 'ONLINE_REQUIRED');
  assert.equal(c('CUSTOMER'), 'UNAVAILABLE_OFFLINE'); assert.equal(c('DOCUMENTS'), 'UNAVAILABLE_OFFLINE');
  const present = new Set(['APP_SHELL', 'GEOMETRY_BUNDLE', 'BASE_MAP_MEDIUM', 'PRICING_SNAPSHOT', 'AVAILABILITY_SNAPSHOT']);
  assert.equal(CORE.evaluate('MAP', { connectivity: 'OFFLINE', present }).mode, 'OFFLINE_FULL');
  const av = CORE.evaluate('AVAILABILITY', { connectivity: 'OFFLINE', present });
  assert.equal(av.mode, 'LAST_KNOWN'); assert.equal(av.allowCommit, false); assert.match(av.message, /Última informação conhecida/);
  const tech = CORE.evaluate('TECHNICAL_EXPLANATION', { connectivity: 'OFFLINE', present });
  assert.equal(tech.available, false); assert.match(tech.message, /não foi baixado/, '§152: explains instead of hiding');
  assert.match(CORE.evaluate('RESERVATION', { connectivity: 'OFFLINE', present }).message, /Disponível quando online/);
  assert.equal(CORE.evaluate('NOPE', { connectivity: 'ONLINE' }).available, false, 'unknown feature: deny by default');
  const u = CORE.evaluate('PROPOSAL', { connectivity: 'UNKNOWN' }); assert.ok(u.available && u.confirmConnectionBeforeCommit, 'UNKNOWN: probe before committing');
});

// ------------------------------------------------------------------ manifest
test('Web App Manifest: valid, standalone, relative scope/start_url without secrets, 192/512/maskable icons that exist (§329)', () => {
  const m = JSON.parse(fs.readFileSync(path.join(B1.dir, 'manifest.webmanifest'), 'utf8'));
  assert.deepEqual(P.webManifest.validateWebManifest(m), { ok: true, errors: [] });
  assert.equal(m.display, 'standalone'); assert.equal(m.start_url, './'); assert.equal(m.scope, './'); assert.equal(m.short_name, 'House 7');
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(B1.dir, i.src)), i.src);
  const bad = { ...m, start_url: './?token=abc', scope: '/', shortcuts: [{ name: 'Cliente', url: './cliente/123' }], icons: m.icons.filter(i => i.purpose !== 'maskable') };
  const codes = P.webManifest.validateWebManifest(bad).errors.map(e => e.code);
  for (const c of ['UNSAFE_START_URL', 'SCOPE_TOO_WIDE', 'UNSAFE_SHORTCUT', 'ICON_MASKABLE']) assert.ok(codes.includes(c), c);
  assert.ok(P.webManifest.validateWebManifest({ ...m, start_url: './s/abcdefghijklmnop' }).errors.some(e => e.code === 'UNSAFE_START_URL'), 'share token never in start_url');
  assert.match(P.webManifest.headTags(), /rel="manifest" href="manifest.webmanifest"/);
});

// ------------------------------------------------------------------ classifier + policy projection
test('ServiceWorkerRequestClassifier: API/auth/share/mutations never cached nor answered with HTML; only the shell route gets the shell (§344)', () => {
  const rules = RT.compile(require('../scripts/cacheRules.js').rules(App));
  const ctx = { scopePath: '/app/', rules, precache: new Set(['offline.html', 'logo.png']) };
  const C = (rel, o = {}) => RT.classify({ method: 'GET', url: (o.abs || SCOPE) + rel, mode: 'cors', sameOrigin: true, ...o }, ctx);
  assert.equal(C('api/v1/lots').klass, 'SENSITIVE_DATA'); assert.equal(C('api/v1/lots').handle, false);
  assert.equal(C('api/v1/lots', { mode: 'navigate' }).handle, false, '/api/ navigation: no shell fallback');
  assert.equal(C('auth/callback').klass, 'AUTH'); assert.equal(C('lots.json', { hasAuthorization: true }).klass, 'AUTH');
  const share = C('s/AbCdEfGhIjKlMnOpQrStUv', { abs: ORIGIN + '/', mode: 'navigate' });
  assert.equal(share.klass, 'SHARE'); assert.equal(share.offline, 'SHARE_OFFLINE_PAGE'); assert.notEqual(share.offline, 'SHELL');
  assert.equal(C('lots.json', { method: 'POST' }).klass, 'MUTATION'); assert.equal(C('lots.json', { method: 'POST' }).handle, false);
  assert.equal(C('', { mode: 'navigate' }).offline, 'SHELL'); assert.equal(C('index.html', { mode: 'navigate' }).offline, 'SHELL');
  assert.equal(C('outra/rota', { mode: 'navigate' }).offline, 'OFFLINE_PAGE');
  assert.equal(C('commercial.json').handle, false, 'price: NETWORK_ONLY in the worker'); assert.equal(C('commercial.json').klass, 'DYNAMIC_DATA');
  assert.equal(C('manifest.json').handle, false); assert.equal(C('lots.json').offline, 'DATA_LAYER');
  assert.equal(C('analysis-input.json').offline, 'PACK'); assert.equal(C('analysis-input.json').versionRequired, true);
  assert.equal(C('img/01.webp').store, 'IMG'); assert.equal(C('planta.webp').store, null);
  assert.equal(C('lots.json', { cache: 'no-store', cacheMode: 'no-store' }).handle, false);
  assert.equal(C('x.json', { method: 'HEAD' }).handle, false, 'connectivity probe always reaches the network');
  assert.equal(C('https://fonts.example/x.woff2', { abs: '', sameOrigin: false }).handle, false, 'opaque third party never cached');
  assert.equal(C('logo.png').strategy, 'PRECACHE');
  const pols = require('../scripts/cacheRules.js').swPolicies(App);
  for (const p of pols) for (const f of ['routeMatcherId', 'offlineEligible', 'strategy', 'securityClass', 'versionRequired']) assert.ok(p[f] !== undefined, p.routeMatcherId + '.' + f);
  assert.ok(pols.filter(p => p.offlineEligible).every(p => p.securityClass === 'PUBLIC_SAFE'), 'only PUBLIC_SAFE resources may be offline in the worker');
  assert.equal(pols.find(p => p.resourceType === 'PRICING_SNAPSHOT').offlineSource, 'DATA_LAYER');
  // storable: status, set-cookie, content type
  assert.equal(RT.storable(new Response('x', { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }), 'JSON'), false);
  assert.equal(RT.storable(new Response('<p>', { status: 200, headers: { 'content-type': 'text/html' } }), 'JSON'), false, 'HTML never stored as JSON');
  assert.equal(RT.storable(new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }), 'JSON'), false);
  assert.deepEqual(RT.obsoleteCaches(['ws-shell-a', 'ws-shell-b', 'ws-img-1', 'ws-runtime-v1', 'ws-pack:house7:viva-juara:t1', 'ws-pack-index', 'ws:viva-juara:assets'], { shell: 'ws-shell-b', img: 'ws-img-1' }), ['ws-shell-a', 'ws-runtime-v1']);
});

// ------------------------------------------------------------------ the worker itself
golden('PwaFirstInstall + PwaAppShellOfflineBoot: precache the shell, no skipWaiting on install, shell served offline, API never HTML', async () => {
  const net = Network(B1.dir), w = runWorker(B1.sw, { net });
  await w.install();
  assert.equal(w.ctx.skipped, 0, 'install never activates by itself (§38)');
  const shell = await (await w.caches.open('ws-shell-b1aaaaaaaa')).match(SCOPE);
  assert.ok(shell && /app-build-id|<title>/.test(await shell.text()));
  assert.ok(await (await w.caches.open('ws-shell-b1aaaaaaaa')).match(SCOPE + 'offline.html'));
  assert.ok(!net.log.some(l => /lots\.json|commercial\.json|planta|aerea|analysis-input/.test(l.url)), 'precache is minimal: no data, maps or high-res (§31)');
  await w.activate();
  assert.equal(w.ctx.claimed, 1); assert.ok(w.posted.some(m => m.name === 'sw_activate_success'));
  net.online = false;
  const r = await w.fetch('', { mode: 'navigate' });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /html/);
  assert.equal(await w.fetch('api/v1/lots'), null, 'API: not answered by the worker → plain network error, never the shell');
  const nf = await w.fetch('img/nao-existe.webp'); assert.equal(nf.type, 'error', 'missing asset offline stays an asset failure');
  net.online = true;
  const r404 = await w.fetch('img/nao-existe.webp'); assert.equal(r404.status, 404, 'static asset failure stays a failure online (no HTML)');
});

test('install fails (and the old worker stays) when a required precache entry fails; optional entries do not block', async () => {
  const net = Network(B1.dir); net.overrides.set('offline.html', () => new Response('x', { status: 500, headers: { 'content-type': 'text/html' } }));
  const w = runWorker(B1.sw, { net });
  await assert.rejects(w.install());
  assert.equal(await w.caches.has('ws-shell-b1aaaaaaaa'), false, 'failed install leaves no half shell');
  const net2 = Network(B1.dir); net2.overrides.set('icons/icon-512.png', () => new Response('x', { status: 404 }));
  const w2 = runWorker(B1.sw, { net: net2 }); await w2.install();
  assert.ok(await (await w2.caches.open('ws-shell-b1aaaaaaaa')).match(SCOPE));
});

golden('PwaSharedRouteNotAvailableOffline: /s/<token> never gets the internal app, online or offline; navigations of share are never stored', async () => {
  const net = Network(B1.dir); const w = runWorker(B1.sw, { net }); await w.install(); await w.activate();
  net.overrides.set('s/AbCdEfGhIjKlMnOpQrStUv', () => new Response('<html>SHARE_RUNTIME_PAGE_MARKER</html>', { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'sid=1' } }));
  const online = await w.fetch(ORIGIN + '/app/s/AbCdEfGhIjKlMnOpQrStUv', { mode: 'navigate' });
  assert.match(await online.text(), /SHARE_RUNTIME_PAGE_MARKER/);
  const shell = await (await w.caches.open('ws-shell-b1aaaaaaaa')).match(SCOPE); assert.doesNotMatch(await shell.text(), /SHARE_RUNTIME_PAGE_MARKER/, 'share page never overwrites the shell');
  net.online = false;
  const off = await w.fetch(ORIGIN + '/app/s/AbCdEfGhIjKlMnOpQrStUv', { mode: 'navigate' });
  const html = await off.text();
  assert.equal(off.status, 503); assert.match(html, /Link compartilhado indisponível offline/); assert.doesNotMatch(html, /app-build-id|<script/);
  assert.equal(await w.fetch(ORIGIN + '/app/s/AbCdEfGhIjKlMnOpQrStUv/data.json'), null, 'share sub-resources: network only');
  const other = await w.fetch('relatorio', { mode: 'navigate' }); assert.match(await other.text(), /não está disponível offline/);
});

test('worker security: Authorization, auth paths, POST, no-store and Set-Cookie responses never enter Cache Storage', async () => {
  const net = Network(B1.dir); const w = runWorker(B1.sw, { net }); await w.install(); await w.activate();
  assert.equal(await w.fetch('routes.json', { headers: { authorization: 'Bearer abc' } }), null);
  assert.equal(await w.fetch('auth/session'), null); assert.equal(await w.fetch('routes.json', { method: 'POST' }), null);
  net.overrides.set('routes.json', () => new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } }));
  await w.fetch('routes.json'); await tick(5);
  assert.equal(await (await w.caches.open('ws-runtime-v2')).match(SCOPE + 'routes.json'), undefined, 'Set-Cookie response not stored (§192)');
  net.overrides.set('routes.json', () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await w.fetch('routes.json'); await tick(5);
  assert.equal(await (await w.caches.open('ws-runtime-v2')).match(SCOPE + 'routes.json'), undefined, 'unexpected content type not stored (§203)');
  net.overrides.delete('routes.json'); await w.fetch('routes.json'); await tick(5);
  assert.ok(await (await w.caches.open('ws-runtime-v2')).match(SCOPE + 'routes.json'), 'a clean JSON response is kept for offline');
  net.online = false; const r = await w.fetch('routes.json'); assert.equal(r.status, 200);
  const all = []; for (const [n, c] of w.caches._stores) for (const k of c._m.keys()) all.push(n + ' ' + k);
  assert.ok(!all.some(x => /commercial\.json|manifest\.json|api\/|auth|Bearer/i.test(x)), 'price, pointers, API and auth never in Cache Storage: ' + all.join(', '));
});

test('topic-48 deferral: gallery images are cached per exact revision (ws-img-1, ?v=<checksum>); activate prunes old revisions and the unversioned legacy cache', async () => {
  const caches = FakeCaches(), net = Network(B1.dir);
  const legacy = await caches.open('ws-runtime-v1'); await legacy.put(SCOPE + 'img/01.webp', new Response('old', { headers: { 'content-type': 'image/webp' } }));
  const assets = await caches.open('ws:viva-juara:assets'); await assets.put(SCOPE + 'planta.webp?v=old', new Response('plan', { headers: { 'content-type': 'image/webp' } }));
  const w = runWorker(B1.sw, { caches, net }); await w.install(); await w.activate();
  assert.equal(await caches.has('ws-runtime-v1'), false, 'legacy unversioned runtime cache removed');
  assert.equal(await caches.has('ws:viva-juara:assets'), true, 'the app asset cache is never touched by the worker');
  const img = fs.readdirSync(path.join(B1.dir, 'img'))[0], rev = B1.revisions['img/' + img];
  await w.fetch('img/' + img); await tick(5);
  const keys = (await (await caches.open('ws-img-1')).keys()).map(k => k.url);
  assert.deepEqual(keys, [SCOPE + 'img/' + img + '?v=' + rev]);
  // planta.webp from the network, NOT the stale asset-cache copy (no global caches.match with ignoreSearch anymore)
  const plan = await w.fetch('planta.webp'); assert.notEqual(await plan.text(), 'plan');
  // next build changes that image → the old revision is pruned on activate
  const c = await caches.open('ws-img-1'); await c.put(SCOPE + 'img/' + img + '?v=000000000000', new Response('x', { headers: { 'content-type': 'image/webp' } }));
  const w2 = runWorker(B1.sw, { caches, net }); await w2.activate();
  assert.deepEqual((await (await caches.open('ws-img-1')).keys()).map(k => k.url), [SCOPE + 'img/' + img + '?v=' + rev]);
});

golden('PwaServiceWorkerUpdateWaiting + PwaSafeUpdateActivation (worker side): new build keeps data caches, swaps the shell only after SKIP_WAITING', async () => {
  const caches = FakeCaches(), net = Network(B1.dir);
  const w1 = runWorker(B1.sw, { caches, net }); await w1.install(); await w1.activate();
  const pack = await caches.open('ws-pack:house7:viva-juara:t1'); await pack.put(SCOPE + '__pack__/lots.json?v=x', new Response('{}'));
  const B2 = buildPwaDir('b2bbbbbbbb');
  const net2 = Network(B2.dir), w2 = runWorker(B2.sw, { caches, net: net2 });
  await w2.install();
  assert.equal(w2.ctx.skipped, 0);
  assert.ok(await caches.has('ws-shell-b1aaaaaaaa') && await caches.has('ws-shell-b2bbbbbbbb'), 'while waiting both shells exist: the open tab keeps working on v1');
  w2.message({ type: 'SKIP_WAITING' }); assert.equal(w2.ctx.skipped, 1, 'only the page message (user accepted) activates it');
  await w2.activate();
  assert.equal(await caches.has('ws-shell-b1aaaaaaaa'), false); assert.ok(await caches.has('ws-pack:house7:viva-juara:t1'), 'updating code never invalidates offline data (§35)');
  let got = null; w2.message({ type: 'GET_VERSION' }, { postMessage: m => { got = m; } });
  assert.deepEqual({ ...got }, { type: 'SW_VERSION', serviceWorkerBuildId: 'b2bbbbbbbb', cacheSchemaVersion: '1', offlinePackSchemaVersion: '1', apiCompatibilityVersion: '1', queueSchemaVersion: '1' });
  fs.rmSync(B2.dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ offline packs
const MANIFEST_DIR = B1.dir;
function packEnv(o = {}) {
  const dir = o.dir || MANIFEST_DIR, net = Network(dir), store = o.store || PK.MemoryPackStore();
  let principal = { organizationId: o.org || ORG, userId: 'u1', authenticated: true, canPrepareOffline: true, lastValidatedAt: Date.now() };
  const events = [];
  const m = PK.OfflinePackManager({ organizationId: o.org || ORG, developmentId: DEV, store, fetchFn: (u, i) => net.fetch(u, i), quota: o.quota || (async () => ({ usage: 0, quota: 500 * 1024 * 1024 })),
    auth: () => principal, emit: (n, d) => events.push([n, d]), security: o.security, authPolicy: o.authPolicy, now: o.now, onCommitted: o.onCommitted });
  return { m, net, store, events, setPrincipal: p => { principal = { ...principal, ...p }; } };
}
golden('PwaPrepareBasicDevelopmentPack + PwaPrepareStandardDevelopmentPack: exact versions, checksums validated, atomic commit, READY', async () => {
  const { m, net, events } = packEnv();
  assert.equal((await m.inspect()).state, 'NOT_PREPARED');
  const est = await m.estimate('BASIC'); assert.match(est.bytesLabel, /^Estimativa: /); assert.ok(est.bytes > 1e6);
  const basic = await m.prepare('BASIC');
  assert.equal(basic.ok, true, basic.message); assert.equal(basic.state, 'READY'); assert.equal(basic.transaction.status, 'COMMITTED');
  const keys = basic.record.definition.resourceKeys; assert.ok(keys.every(k => k.version && k.version !== 'current'), '§62: never a pointer');
  assert.deepEqual(Object.keys(basic.record.resources).sort(), ['lots.json', 'planta.webp']);
  assert.ok(net.log.every(l => l.cache === 'no-store'), 'pack downloads bypass the worker and the HTTP cache');
  const std = await m.prepare('STANDARD');
  assert.equal(std.ok, true); assert.ok(std.record.resources['analysis-input.json'], 'topic-48 deferral: analysis input stored offline, versioned by checksum');
  assert.equal(std.record.resources['analysis-input.json'].checksum, JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, 'manifest.json'))).assets.find(a => a.path === 'analysis-input.json').checksum);
  assert.ok(!std.record.resources['aerea.webp'], 'high-res is opt-in (§70)');
  assert.equal(std.record.availability.domainFreshness, 'NOT_AVAILABLE', 'no sales mirror: availability never stored as current');
  assert.ok(std.downloadedBytes < std.bytes, 'STANDARD after BASIC reuses unchanged entries');
  const r = await m.read('analysis-input.json'); assert.ok(Array.isArray(r.data.lots) || r.data.lots, 'readable'); assert.equal(r.checksum, std.record.resources['analysis-input.json'].checksum);
  assert.ok(events.some(e => e[0] === 'offline_pack_prepare_success') && events.some(e => e[0] === 'offline_pack_enabled'));
  assert.ok(events.every(([, d]) => !JSON.stringify(d).includes('http')), 'no URL in telemetry');
  const full = await m.prepare('FULL_MAP'); assert.equal(full.ok, true); assert.ok(full.record.resources['aerea.webp'] && full.record.resources['aerea_ampliada.webp'] && full.record.resources['img_list.json']);
  // only 3 gallery images are published in this test folder: optional extras missing → PARTIAL (usable, never shown as READY, §279)
  assert.equal(full.state, 'PARTIAL'); assert.ok(full.record.skipped.length > 0 && full.record.skipped.every(p => /^img\//.test(p)));
  assert.equal((await m.inspect()).state, 'PARTIAL'); assert.ok((await m.read('analysis-input.json')), 'what is present stays usable');
});

golden('PwaPackInterruptedDownloadRollback + PwaPackChecksumFailureRollback: old pack stays READY, staging removed', async () => {
  const { m, net, store } = packEnv();
  assert.equal((await m.prepare('BASIC')).ok, true);
  const before = await store.readIndex();
  net.overrides.set('analysis-input.json', () => { throw new TypeError('Failed to fetch'); });
  const r1 = await m.prepare('STANDARD');
  assert.equal(r1.ok, false); assert.equal(r1.code, 'DOWNLOAD_FAILED'); assert.equal(r1.transaction.status, 'ROLLED_BACK'); assert.equal(r1.state, 'READY');
  net.overrides.set('analysis-input.json', () => new Response('{"tampered":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
  const r2 = await m.prepare('STANDARD');
  assert.equal(r2.code, 'CHECKSUM_MISMATCH'); assert.equal(r2.transaction.status, 'FAILED');
  assert.deepEqual(await store.readIndex(), before, 'index untouched');
  assert.deepEqual((await store.listCaches()).sort(), [before.packs['pack:house7:viva-juara'].cacheName], 'no staging leftover');
  assert.equal((await m.inspect('pack:house7:viva-juara', { verify: true })).state, 'READY');
});

golden('PwaStorageQuotaInsufficient: refused before any download, with the needed size', async () => {
  const { m, net } = packEnv({ quota: async () => ({ usage: 99 * 1024 * 1024, quota: 100 * 1024 * 1024 }) });
  const r = await m.prepare('FULL_MAP');
  assert.equal(r.ok, false); assert.equal(r.code, 'INSUFFICIENT_STORAGE'); assert.match(r.message, /São necessários cerca de .* MB e há cerca de/);
  assert.equal(net.log.filter(l => !/manifest\.json/.test(l.url)).length, 0, 'nothing downloaded (§60)');
  const est = await m.estimate('FULL_MAP'); assert.ok(est.quota.insufficient);
});

golden('PwaOfflinePackRefreshDelta: only changed resources are downloaded; diff flags; checkForUpdates → UPDATE_AVAILABLE', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa49d-')); fs.cpSync(MANIFEST_DIR, dir, { recursive: true });
  const { m, net } = packEnv({ dir });
  assert.equal((await m.prepare('STANDARD')).ok, true);
  // publish a new analysis input (A15 → A16) and a new price revision pointer
  const ai = JSON.parse(fs.readFileSync(path.join(dir, 'analysis-input.json'))); ai.inputVersion = 'A16'; fs.writeFileSync(path.join(dir, 'analysis-input.json'), JSON.stringify(ai));
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'))); const a = man.assets.find(x => x.path === 'analysis-input.json');
  a.checksum = require('../scripts/pwaBuild.js').sha(fs.readFileSync(path.join(dir, 'analysis-input.json'))); a.bytes = fs.statSync(path.join(dir, 'analysis-input.json')).size; man.commercialRevision = 2;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man));
  const chk = await m.checkForUpdates();
  assert.equal(chk.state, 'UPDATE_AVAILABLE'); assert.equal(chk.diff.analysisVersionChanged, true); assert.equal(chk.diff.geometryVersionChanged, false); assert.equal(chk.diff.pricingVersionChanged, true);
  assert.deepEqual(chk.diff.changed.map(c => c.resourceId), ['analysis-input.json']); assert.match(chk.message, /Atualização disponível · /);
  assert.equal((await m.inspect()).state, 'UPDATE_AVAILABLE');
  net.log.length = 0;
  const r = await m.refresh();
  assert.equal(r.ok, true); assert.deepEqual(net.log.map(l => path.basename(new URL(l.url).pathname)).sort(), ['analysis-input.json', 'manifest.json'], 'delta only (§133)');
  assert.equal((await m.inspect()).state, 'READY'); assert.equal((await m.read('analysis-input.json')).data.inputVersion, 'A16');
  fs.rmSync(dir, { recursive: true, force: true });
});

golden('PwaTenantSwitchIsolation + PwaAccessRevokedOnReconnect + PwaLogoutSensitivePurge: org A pack invisible in org B; revocation removes; logout policy', async () => {
  const store = PK.MemoryPackStore();
  const A = packEnv({ store }); assert.equal((await A.m.prepare('BASIC')).ok, true);
  A.setPrincipal({ organizationId: 'org-b' });
  assert.deepEqual(await A.m.list(), [], 'pack of org A not listed for org B');
  assert.equal(await A.m.read('lots.json'), null, 'nor readable');
  assert.equal((await A.m.inspect()).access.reason, 'OTHER_ORGANIZATION');
  assert.equal((await A.m.prepare('BASIC')).code, 'PERMISSION_DENIED');
  A.setPrincipal({ organizationId: ORG });
  // offline for longer than maxOfflineSessionAgeMs: no instantaneous revocation, but a bounded window (§290–§292)
  A.setPrincipal({ lastValidatedAt: Date.now() - 8 * 24 * 3600e3 });
  assert.equal((await A.m.inspect(undefined, { offline: true })).access.reason, 'REVALIDATION_REQUIRED');
  assert.equal(await A.m.read('lots.json', { offline: true }), null);
  A.setPrincipal({ lastValidatedAt: Date.now() });
  assert.equal((await A.m.onLogout()).kept, true, 'organization-safe pack may stay after logout (default policy)');
  const strict = packEnv({ store, security: { allowOrganizationPackPersistenceAfterLogout: false } });
  assert.equal((await strict.m.onLogout()).removed, 1, 'shared-device policy purges on logout (§78)');
  assert.equal((await A.m.prepare('BASIC')).ok, true);
  assert.equal((await A.m.onAccessRevoked(ORG)).removed, 1); assert.equal((await A.m.inspect()).state, 'NOT_PREPARED');
  assert.deepEqual(await store.listCaches(), []);
});

test('pack security + integrity: only PUBLIC_SAFE resources, PARTIAL never shown as READY, incompatible schema → UPDATE_REQUIRED, maintenance removes orphans', async () => {
  const { m, store } = packEnv();
  assert.equal((await m.prepare('BASIC')).ok, true);
  const idx = await store.readIndex(), rec = idx.packs['pack:house7:viva-juara'];
  assert.ok(Object.values(rec.resources).every(r => r.securityClass === 'PUBLIC_SAFE'));
  assert.ok(!JSON.stringify(rec).match(/customer|cliente|token|journey/i), 'no customer/share/auth data in the generic pack (§75)');
  store._caches.get(rec.cacheName).delete(RT.packEntryKey('planta.webp', rec.resources['planta.webp'].checksum));
  const st = await m.inspect(undefined, { verify: true }); assert.equal(st.state, 'PARTIAL'); assert.deepEqual(st.missing, ['planta.webp']);
  rec.packSchemaVersion = '0'; await store.writeIndex(idx); assert.equal((await m.inspect()).state, 'UPDATE_REQUIRED');
  await store.put('ws-pack:house7:viva-juara:orphan', 'x', 'y', new Uint8Array([1]), 'x');
  assert.equal((await m.maintenance()).deleted, 1);
  assert.throws(() => PK.resolveResources('BASIC', { developmentId: DEV, assets: [{ path: 'planta.webp', checksum: 'a' }], staticVersion: 's', analysisVersion: 'a' }, App.config.DEVELOPMENTS[0]), e => e.code === 'VERSION_UNRESOLVED', 'missing exact version: refused, never "current"');
});

golden('PwaOfflineMapBrowse + PwaOfflineLotSearch + PwaOfflineLotQuickView + PwaOfflineAvailabilityLastKnown + PwaOfflinePriceVersion: first boot offline from a READY pack', async () => {
  const { m } = packEnv(); assert.equal((await m.prepare('STANDARD')).ok, true);
  const A2 = app(); // a fresh app instance: empty data-layer cache, network down
  const dev = A2.repos.DevelopmentRepository.getDevelopment(DEV), cr = A2.repos.CommercialRepository(DEV);
  const H = await A2.offline.createHybrid(DEV, { backend: A2.offline.MemoryBackend(), remote: PK.packRemote(m, dev, cr), connectivity: A2.offline.Connectivity(null) });
  const res = await H.source.loadLayers();
  assert.equal(Object.keys(res.layers.static.lots).length, 498, 'map geometry available offline');
  assert.equal(res.layers.commercial.source, 'OFFLINE_PACK'); assert.equal(res.layers.commercial.stale, true, 'price from the pack is never confirmed');
  assert.equal(res.layers.availability ? Object.values(res.layers.availability.lots).every(l => l.availability.status === 'UNKNOWN') : true, true, 'availability stays UNKNOWN');
  const lot = Object.values(res.layers.static.lots).find(l => l.identity && l.identity.code); assert.ok(lot, 'lot searchable by code');
  const av = PK.availabilityOffline('AVAILABLE', { downloadedAt: '2026-10-10T20:20:00Z', revision: 884 });
  assert.equal(av.claimCurrent, false); assert.deepEqual(av.lines.slice(0, 3), ['Última informação conhecida', 'Modo offline', 'Confirme disponibilidade ao reconectar']);
  assert.equal(PK.availabilityOffline('UNKNOWN').lines[0], 'Status não confirmado');
  const pr = PK.pricingOffline({ priceTableVersion: '2026-10-06' }, { name: 'Tabela de lançamento', version: '2026-10-06' });
  assert.match(pr.label, /Tabela de lançamento · versão 2026-10-06/); assert.equal(pr.warning, 'Modo offline — confirme a tabela atual antes de proposta'); assert.equal(pr.validity, 'Vigência: não disponível');
  const qv = PK.quickViewOffline({ offline: true, downloadedAt: '2026-10-10T20:20:00Z', missingSections: ['priceHistoryDetail'] });
  assert.equal(qv.badge, 'Modo offline'); assert.equal(qv.unavailable[0].text, 'Disponível quando online', '§150: no infinite spinner');
  const present = await m.presentResources();
  assert.equal(PK.layerOfflineStatus({ id: 'availability' }, present).text, 'Dados de disponibilidade podem estar desatualizados');
  assert.equal(PK.layerOfflineStatus({ id: 'score' }, present).status, 'AVAILABLE_OFFLINE');
  assert.equal(CORE.evaluate('TECHNICAL_EXPLANATION', { connectivity: 'OFFLINE', present }).mode, 'READ_ONLY');
});

golden('PwaNoOfflinePack + PwaDeepLinkOfflineAvailable + PwaDeepLinkOfflineUnavailable: explicit messages, never an empty map nor a silent redirect', () => {
  assert.deepEqual({ ...PK.NO_PACK_MESSAGE }, { title: 'Você está offline.', text: 'Nenhum empreendimento foi preparado para uso offline.' });
  const html = App.pwaView.offlineHome([PK.developmentCard({ id: DEV, name: 'Viva Juara' }, { state: 'NOT_PREPARED' })]);
  assert.match(html, /Nenhum empreendimento foi preparado/);
  const ctx = { presentLotIds: new Set(['L327']), presentVersions: new Set(['2026-10-06']) };
  assert.equal(PK.deepLinkOffline({ lotId: 'L327' }, ctx).available, true);
  const miss = PK.deepLinkOffline({ lotId: 'L999' }, ctx);
  assert.equal(miss.available, false); assert.equal(miss.title, 'Este conteúdo não está disponível offline.'); assert.equal(miss.text, 'Conecte-se para carregar.'); assert.equal(miss.redirect, null);
  assert.equal(PK.deepLinkOffline({ lotId: 'L327', version: '2026-10-06' }, ctx).reason, 'VERSION_IN_PACK');
  assert.equal(PK.deepLinkOffline({ lotId: 'L327', version: '2025-01-01' }, ctx).reason, 'VERSION_NOT_IN_PACK');
});

golden('PwaPresentationOfflinePack + PwaFinancialOfflineWarning: client-safe immutable pack; simulation stamped and warned, no invented index', () => {
  const pp = PK.buildPresentationPack({ title: 'Seleção', steps: [{ lotId: 'L1', presenterNotes: 'fechar hoje', note: 'x', price: 1 }], customerName: 'Ana', internal: { margin: 3 } }, { clientFacing: true });
  const s = JSON.stringify(pp);
  assert.ok(!/fechar hoje|Ana|margin/.test(s), 'no presenter notes nor customer data (§173)'); assert.ok(Object.isFrozen(pp.snapshot.steps[0]));
  assert.ok(pp.version);
  const f = PK.financialOfflineStamp({ installment: 1234 }, { priceTableVersion: '2026-10-06', paymentPlanVersion: 'P144', now: () => Date.parse('2026-10-11T10:00:00Z') });
  assert.equal(f.offline, true); assert.equal(f.calculationMode, 'OFFLINE_LAST_KNOWN_TABLE'); assert.equal(f.generatedAt, '2026-10-11T10:00:00.000Z');
  assert.deepEqual(f.warnings, ['Simulação baseada na última tabela armazenada.', 'Confirme condições atuais antes de proposta.']);
  assert.deepEqual(f.indexation, { value: null, label: 'não disponível' }, 'no fabricated index (§166, §343)');
});

// ------------------------------------------------------------------ mutations + sync
function syncEnv(o = {}) {
  let who = { organizationId: ORG, userId: 'uA', authenticated: true, can: () => true };
  const server = { versions: new Map(), applied: [], seen: new Set(), down: false };
  const transport = async env => { if (server.down) throw new TypeError('offline'); if (server.seen.has(env.idempotencyKey)) return { status: 'DUPLICATE' }; server.seen.add(env.idempotencyKey); server.applied.push(env); return { status: 'APPLIED' }; };
  const s = SY.SyncCoordinator({ store: o.store || SY.MemoryMutationStore(), auth: () => who, transport: o.noTransport ? null : transport, revalidate: async e => ({ currentVersion: server.versions.get(e.entityId) }), policies: o.policies, emit: () => {} });
  return { s, server, as: p => { who = { ...who, ...p }; } };
}
golden('PwaOfflineReservationDenied: reservation, proposal, availability/price/permission changes and share are online-only; no generic POST queue', async () => {
  const { s } = syncEnv();
  for (const t of ['lot.reserve', 'proposal.submit', 'availability.change', 'price.change', 'price_table.publish', 'permission.change', 'share.create', 'share.revoke', 'journey.stage_change', 'customer.edit', 'whatever.post']) {
    const r = await s.enqueue({ mutationType: t, entityType: 'lot', entityId: 'L327', payload: {} });
    assert.equal(r.ok, false, t); assert.equal(r.code, 'ONLINE_REQUIRED'); assert.match(r.message, /precisa de conexão/);
  }
  assert.equal((await s.getPending()).length, 0);
  assert.equal((await s.enqueue({ mutationType: 'customer.note_draft', entityType: 'customer', entityId: 'c1', payload: { text: 'x' } })).code, 'QUEUE_DISABLED', 'drafts need domain approval');
  assert.equal((await s.enqueue({ mutationType: 'comparison.local', entityType: 'comparison', entityId: 'x' })).local, true, 'LOCAL_OFFLINE_COMPARISON is never synced');
  assert.equal(s.classify('analytics'), 'ANALYTICS_BUFFER'); assert.equal((await s.enqueue({ kind: 'analytics', mutationType: 'favorite.set' })).code, 'NOT_A_BUSINESS_MUTATION');
});

golden('PwaOfflineFavoriteQueued + PwaSyncFavoriteOnReconnect + PwaBrowserWithoutBackgroundSync: desired-state, idempotent, synced on reconnect/foreground', async () => {
  const { s, server } = syncEnv({ store: SY.IdbMutationStore(indexedDB, 'ws-pwa-queue-test-' + Date.now()) });
  assert.equal((await s.enqueue(SY.favoriteMutation('L327', true))).queued, true);
  assert.equal((await s.enqueue(SY.favoriteMutation('L327', false))).queued, true);
  const pend = await s.getPending(); assert.equal(pend.length, 1, 'UNSET replaces SET: desired final state, not a counter'); assert.equal(pend[0].payload.desiredState, 'UNSET_FAVORITE');
  assert.equal((await s.enqueue(SY.favoriteMutation('L327', false))).duplicate, true);
  server.down = true; const r0 = await s.syncPending('manual'); assert.equal(r0.failed, 1); assert.equal(r0.pending, 1, 'network failure keeps the queue');
  server.down = false;
  // no Background Sync: the reconnect trigger of the ConnectivityService drives the sync
  const conn = P.connectivity.ConnectivityService({ win: null, probe: async () => true });
  const off = s.attachTriggers({ win: null, connectivity: conn, registration: {} });
  await conn.probeNow('reconnect'); await tick(10);
  assert.equal(server.applied.length, 1); assert.equal((await s.getPending()).length, 0);
  // duplicate retry is harmless
  const again = await s.enqueue(SY.favoriteMutation('L328', true)); server.seen.add(again.idempotencyKey);
  const r = await s.syncPending(); assert.equal(r.duplicates, 1); assert.equal(server.applied.length, 1, 'retry never duplicates the action (§306)');
  off(); conn.dispose();
});

golden('PwaSyncConflictReview: base version changed on the server → USER_REVIEW_REQUIRED, no last-write-wins; same entity keeps order', async () => {
  const { s, server } = syncEnv({ policies: { 'presentation.feedback': SY.policyOf('presentation.feedback') && { ...SY.POLICIES['presentation.feedback'], enabled: true } } });
  server.versions.set('snap1', '14');
  await s.enqueue({ mutationType: 'presentation.feedback', entityType: 'presentation', entityId: 'snap1', baseVersion: 12, payload: { step: 1, liked: true } });
  await s.enqueue({ mutationType: 'presentation.feedback', entityType: 'presentation', entityId: 'snap1', baseVersion: 12, payload: { step: 2, liked: false } });
  await s.enqueue({ mutationType: 'presentation.feedback', entityType: 'presentation', entityId: 'snap2', payload: { step: 1 } });
  const r = await s.syncPending();
  assert.equal(r.conflicts.length, 1); assert.equal(r.conflicts[0].resolution, 'USER_REVIEW_REQUIRED'); assert.equal(r.conflicts[0].currentVersion, '14');
  assert.match(r.conflicts[0].message, /alterada no servidor enquanto você estava offline/);
  assert.equal(server.applied.length, 1, 'independent entity synced; the second mutation of snap1 waits behind the conflict');
  assert.equal((await s.getPending()).length, 2);
  const c = (await s.getPending()).find(p => p.conflictState === 'USER_REVIEW_REQUIRED');
  assert.equal((await s.resolveConflict(c.mutationId, 'DISCARD')).ok, true);
});

test('queue isolation: user B never sees nor syncs user A\'s queue; logout pauses; secrets refused; expired mutations dropped; permission revoked → rejected', async () => {
  let t = Date.parse('2026-10-11T10:00:00Z');
  const store = SY.MemoryMutationStore();
  let who = { organizationId: ORG, userId: 'uA', authenticated: true, can: () => true };
  const applied = [];
  const s = SY.SyncCoordinator({ store, auth: () => who, transport: async e => { applied.push(e); return { status: 'APPLIED' }; }, now: () => t, emit: () => {} });
  await s.enqueue(SY.favoriteMutation('L1', true));
  who = { ...who, userId: 'uB' };
  assert.deepEqual(await s.getPending(), []); assert.equal((await s.syncPending()).synced, 0); assert.equal(applied.length, 0, 'never as the wrong user (§186)');
  assert.equal((await s.discard((await store.listPartition(ORG + '|uA'))[0].mutationId)).ok, false);
  who = { ...who, userId: 'uA', authenticated: false };
  assert.equal((await s.syncPending()).reason, 'NOT_AUTHENTICATED');
  who = { ...who, authenticated: true };
  assert.equal((await s.enqueue({ mutationType: 'favorite.set', entityType: 'favorite', entityId: 'x', payload: { authToken: 'abc' } })).code, 'SECRET_IN_PAYLOAD');
  assert.equal((await s.enqueue({ mutationType: 'favorite.set', entityType: 'favorite', entityId: 'y', payload: { v: 'eyJhbGciOiJIUzI1NiJ9.e30.x' } })).code, 'SECRET_IN_PAYLOAD');
  t += 31 * 24 * 3600e3;
  const r = await s.syncPending(); assert.equal(r.expired.length, 1);
  await s.enqueue(SY.favoriteMutation('L2', true)); who = { ...who, can: () => false };
  assert.equal((await s.syncPending()).rejected[0].reason, 'PERMISSION_REVOKED');
  const noT = syncEnv({ noTransport: true }); assert.equal((await noT.s.enqueue(SY.favoriteMutation('L3', true))).code, 'NO_TRANSPORT', 'no backend yet: nothing piles up silently');
});

// ------------------------------------------------------------------ connectivity
function fakeTimers() { const q = []; return { set: (fn, ms) => { const h = { fn, ms }; q.push(h); return h; }, clear: h => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); }, q, run: async () => { const h = q.shift(); if (h) { h.fn(); await tick(1); } return h; } }; }
function fakeWin(online = true) { const L = {}; return { navigator: { onLine: online }, addEventListener: (t, f) => { (L[t] = L[t] || []).push(f); }, removeEventListener() {}, fire: t => (L[t] || []).forEach(f => f()), document: null }; }
test('ConnectivityService: browser hint ≠ reachability; DEGRADED when the backend fails while the browser says online; hysteresis; bounded probing', async () => {
  const win = fakeWin(true), T = fakeTimers(); let up = true; const probes = [];
  const c = P.connectivity.ConnectivityService({ win, probe: async () => { probes.push(1); return up; }, timers: T });
  assert.equal(c.get(), 'UNKNOWN');
  c.report(true); assert.equal(c.get(), 'ONLINE');
  c.report(false, { network: true }); assert.equal(c.get(), 'ONLINE', 'one failed request does not flip the UI (§308)');
  c.report(false, { network: true }); assert.equal(c.get(), 'DEGRADED'); assert.equal(c.getState().browserHint, 'ONLINE');
  assert.equal(T.q.length, 1, 'bounded probe scheduled only while degraded'); assert.equal(T.q[0].ms, 5000);
  up = false; await T.run(); await T.run(); assert.equal(c.get(), 'OFFLINE', 'backend unreachable while the browser says online');
  assert.ok(T.q.length === 1 && T.q[0].ms === 60000, 'backoff grows (5 s → 15 s → 60 s)');
  win.navigator.onLine = false; win.fire('offline'); assert.equal(c.get(), 'OFFLINE');
  assert.equal(T.q.length, 0, 'no probing while the browser itself is offline');
  up = true; win.navigator.onLine = true; win.fire('online'); assert.equal(c.get(), 'DEGRADED', 'OFFLINE → DEGRADED → ONLINE'); await tick(5);
  assert.equal(c.get(), 'ONLINE', 'probe confirms the return (§310)'); assert.ok(c.getState().lastSuccessfulBackendContactAt);
  assert.equal(T.q.length, 0, 'never polling while ONLINE');
  assert.equal(await c.ensureOnline(), true);
  const vm1 = P.connectivity.indicator({ effectiveState: 'OFFLINE' }); assert.equal(vm1.label, 'Offline'); assert.equal(vm1.visible, true);
  assert.equal(P.connectivity.indicator({ effectiveState: 'DEGRADED' }).label, 'Conexão instável');
  assert.equal(P.connectivity.indicator({ effectiveState: 'ONLINE' }, { syncing: true }).label, 'Sincronizando');
  assert.match(P.connectivity.indicator({ effectiveState: 'ONLINE' }, { pendingCount: 3 }).pending, /3 alterações aguardando sincronização/);
  // the data layer's raw reports feed the service
  const legacy = App.offline.Connectivity(null); const c2 = P.connectivity.ConnectivityService({ win: null, timers: fakeTimers() }); c2.attach(legacy);
  legacy.report('manifest', true); assert.equal(c2.get(), 'ONLINE');
  c.dispose(); c2.dispose();
});

// ------------------------------------------------------------------ update coordinator
function fakeSW() {
  const L = {}; const fire = (t, e) => (L[t] || []).slice().forEach(f => f(e));
  const container = { controller: null, addEventListener: (t, f, o) => { const g = o && o.once ? (e => { L[t] = L[t].filter(x => x !== g); f(e); }) : f; (L[t] = L[t] || []).push(g); }, fire };
  const worker = (id, o = {}) => { const W = { id, state: 'installing', info: { serviceWorkerBuildId: id, cacheSchemaVersion: '1', apiCompatibilityVersion: '1', offlinePackSchemaVersion: '1', queueSchemaVersion: o.queue || '1' }, msgs: [], L: {},
    addEventListener: (t, f) => { (W.L[t] = W.L[t] || []).push(f); }, setState: s => { W.state = s; (W.L.statechange || []).forEach(f => f()); },
    postMessage: m => { W.msgs.push(m); if (m.type === 'SKIP_WAITING' && !o.stuck) { reg.active = W; reg.waiting = null; container.controller = W; fire('controllerchange'); } } }; return W; };
  const RL = {};
  const reg = { waiting: null, installing: null, active: null, updates: 0, addEventListener: (t, f) => { (RL[t] = RL[t] || []).push(f); },
    async update() { reg.updates++; if (reg.next) { const w = reg.next; reg.next = null; reg.installing = w; (RL.updatefound || []).forEach(f => f()); reg.installing = null; reg.waiting = w; w.setState('installed'); await tick(1); } } };
  container.register = async () => reg;
  return { container, reg, worker };
}
golden('PwaServiceWorkerUpdateWaiting + PwaSafeUpdateActivation + PwaUpdateWithPendingMutations: user-confirmed, blockers respected, queue preserved, one reload', async () => {
  const { container, reg, worker } = fakeSW();
  const v1 = worker('aaaaaaaa01'); v1.state = 'activated'; reg.active = v1; container.controller = v1;
  let activity = [], reloads = 0, saved = 0, pending = { count: 2, schemaVersion: '1' }; const tel = [];
  const U = P.update.PwaUpdateCoordinator({ container, app: { appBuildId: 'aaaaaaaa01', ...CORE.VERSIONS }, activity: () => activity, pendingMutations: async () => pending, saveState: () => { saved++; },
    reload: () => { reloads++; }, versionOf: async w => w && w.info, emit: (n, d) => tel.push(n), now: () => 1e12 });
  await U.register('sw.js');
  assert.equal(U.getState().state, 'UP_TO_DATE'); assert.equal(U.getState().compatibility, 'MATCH');
  reg.next = worker('bbbbbbbb02');
  await U.checkForUpdate('APP_START');
  assert.equal(U.getState().state, 'UPDATE_AVAILABLE'); assert.ok(tel.includes('sw_update_available'));
  assert.deepEqual(P.update.viewModel(U.getState()).actions.map(a => a.label), ['Atualizar agora', 'Depois']);
  assert.equal((await U.activateWaitingVersion('SAFE_AUTO')).code, 'AUTO_ACTIVATION_DISABLED', 'autoActivate NEVER by default');
  await U.checkForUpdate('FOREGROUND'); assert.equal(reg.updates, 1, 'automatic checks are rate limited (§312)');
  activity = ['PROPOSAL_IN_PROGRESS'];
  const b = await U.activateWaitingVersion('USER_CONFIRMED');
  assert.equal(b.code, 'BLOCKED'); assert.equal(U.getState().state, 'ACTIVATION_PENDING');
  assert.match(P.update.viewModel(U.getState()).text, /quando você concluir a proposta em andamento/);
  assert.equal(reg.waiting.msgs.length, 0, 'nothing sent while a critical action is running (§43)');
  activity = [];
  const ok = await U.activityChanged();
  assert.equal(ok.ok, true); assert.equal(ok.pendingMutationCount, 2, 'pending queue survives the update (§218)');
  assert.equal(saved, 1); assert.equal(reloads, 1, 'one controlled reload');
  container.fire('controllerchange'); assert.equal(reloads, 1, 'never a second reload');
});

test('update coordinator: incompatible queue schema blocks; activation timeout keeps the old version; mixed version → RELOAD_REQUIRED; no SW support → online app', async () => {
  const { container, reg, worker } = fakeSW();
  const v1 = worker('aaaaaaaa01'); reg.active = v1; container.controller = v1;
  const U = P.update.PwaUpdateCoordinator({ container, app: { appBuildId: 'aaaaaaaa01', ...CORE.VERSIONS }, pendingMutations: async () => ({ count: 1, schemaVersion: '1' }), versionOf: async w => w && w.info, reload: () => {} });
  await U.register(); reg.next = worker('bbbbbbbb02', { queue: '2' }); await U.checkForUpdate();
  const r = await U.activateWaitingVersion('USER_CONFIRMED');
  assert.equal(r.code, 'BLOCKED'); assert.equal(r.blockers[0].code, 'QUEUE_SCHEMA_INCOMPATIBLE', '§219: synchronize first, never drop the queue');
  const f = fakeSW(); const w1 = f.worker('aaaaaaaa01'); f.reg.active = w1; f.container.controller = w1;
  const U2 = P.update.PwaUpdateCoordinator({ container: f.container, app: { appBuildId: 'aaaaaaaa01', ...CORE.VERSIONS }, versionOf: async w => w && w.info, policy: { activationTimeoutMs: 20 }, reload: () => {} });
  await U2.register(); f.reg.next = f.worker('cccccccc03', { stuck: true }); await U2.checkForUpdate();
  assert.equal((await U2.activateWaitingVersion()).code, 'ACTIVATION_TIMEOUT'); assert.equal(U2.getState().state, 'UPDATE_FAILED');
  assert.match(P.update.viewModel(U2.getState()).text, /versão atual continua funcionando/);
  // another tab activated a newer worker with a different cache schema
  const g = fakeSW(); const x1 = g.worker('aaaaaaaa01'); g.reg.active = x1; g.container.controller = x1;
  const U3 = P.update.PwaUpdateCoordinator({ container: g.container, app: { appBuildId: 'aaaaaaaa01', ...CORE.VERSIONS }, versionOf: async w => w && w.info, reload: () => {} });
  await U3.register(); const x2 = g.worker('dddddddd04'); x2.info.cacheSchemaVersion = '2'; g.container.controller = x2; g.container.fire('controllerchange'); await tick(2);
  assert.equal(U3.getState().state, 'RELOAD_REQUIRED'); assert.equal(P.update.viewModel(U3.getState()).text, 'Atualização requer reinício.');
  assert.deepEqual(CORE.compatibility({ appBuildId: 'a', ...CORE.VERSIONS }, { serviceWorkerBuildId: 'b', ...CORE.VERSIONS }).status, 'TOLERATED');
  const U4 = P.update.PwaUpdateCoordinator({ container: null }); const s4 = await U4.register(); assert.equal(s4.supported, false); assert.equal(P.update.viewModel(s4), null);
});

golden('PwaBrowserWithoutServiceWorker: capability detection by feature, no SW → online app, no crash; diagnostics say so', () => {
  const caps = CORE.detectCapabilities({ navigator: {}, matchMedia: () => ({ matches: false }) });
  assert.equal(caps.serviceWorker, false); assert.equal(caps.backgroundSync, false); assert.equal(caps.storageEstimate, false); assert.equal(caps.installPrompt, false);
  const d = CORE.pwaDiagnostics({ capabilities: caps, app: { appBuildId: 'x', ...CORE.VERSIONS } });
  assert.match(d.warnings.join(' '), /funciona normalmente online/); assert.equal(d.compatibility, 'NO_WORKER');
  const ios = CORE.detectCapabilities({ navigator: { standalone: false, serviceWorker: {} }, matchMedia: () => ({ matches: false }) });
  assert.equal(ios.manualInstallOnly, true, 'iOS-like: instructions, decided by features not User-Agent');
});

// ------------------------------------------------------------------ install prompt policy
test('InstallPromptController: no nagging — not in the first session/seconds, never in front of a client, once per session, 30-day cool-down; menu works', async () => {
  const L = {}, store = new Map(); let t = 0;
  const win = { navigator: { serviceWorker: {} }, onbeforeinstallprompt: null, matchMedia: () => ({ matches: false }), addEventListener: (k, f) => { L[k] = f; } };
  const storage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  const mk = () => CORE.InstallPromptController({ win, storage, now: () => t });
  let c = mk(); assert.equal(c.getState(), 'NOT_INSTALLABLE');
  let prompted = 0; const evt = { preventDefault() { this.prevented = true; }, prompt: async () => { prompted++; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
  L.beforeinstallprompt(evt); assert.ok(evt.prevented, 'browser banner deferred: we decide when'); assert.equal(c.getState(), 'INSTALL_PROMPT_DEFERRED');
  c.recordRelevantUse(); t = 60000;
  assert.equal(c.shouldSuggest().reason, 'FIRST_SESSION');
  c = mk(); L.beforeinstallprompt(evt); t = 60000 + 5000; c.recordRelevantUse();
  assert.equal(c.shouldSuggest().reason, 'TOO_EARLY', 'not in the first seconds (§27)');
  t += 60000; assert.equal(c.shouldSuggest({ clientFacing: true }).reason, 'CLIENT_CONTEXT');
  assert.equal(c.shouldSuggest().suggest, true); c.markSuggested(); assert.equal(c.shouldSuggest().reason, 'ALREADY_SUGGESTED');
  const out = await c.promptInstall(); assert.equal(out.outcome, 'DISMISSED'); assert.equal(prompted, 1);
  c = mk(); L.beforeinstallprompt(evt); t += 3600e3; c.recordRelevantUse(); assert.equal(c.shouldSuggest().reason, 'COOLDOWN');
  L.appinstalled(); assert.equal(c.getState(), 'INSTALLED'); assert.equal(c.shouldSuggest().reason, 'INSTALLED');
  assert.match(App.pwaView.installEntry('INSTALLED'), /Aplicativo instalado neste aparelho/);
  assert.match(App.pwaView.installEntry('NOT_INSTALLABLE', { manualInstallOnly: true }), /Adicionar à Tela de Início/);
});

// ------------------------------------------------------------------ telemetry, diagnostics, views
test('telemetry: technical vs product channels, scrubbed (no URL, token, lot or customer fields); diagnostics and views are accessible', () => {
  const tech = [], prod = [];
  CORE.emit('sw_update_available', { build: 'abc', url: 'https://x/s/token', lotId: 'L1', customerName: 'Ana' }, { observability: { emit: (n, d) => tech.push([n, d]) } });
  assert.deepEqual(tech, [['pwa.sw_update_available', { build: 'abc' }]]);
  CORE.emit('offline_pack_enabled', { profile: 'STANDARD', reason: 'https://evil' }, { analytics: { track: (n, d) => prod.push([n, d]) } });
  assert.deepEqual(prod, [['offline_pack_enabled', { profile: 'STANDARD' }]]);
  assert.equal(CORE.emit('random_event', {}).ok, false);
  const d = CORE.pwaDiagnostics({ swState: 'ACTIVATED', app: { appBuildId: 'a1', ...CORE.VERSIONS }, sw: { serviceWorkerBuildId: 'a1', ...CORE.VERSIONS }, connectivity: 'ONLINE', packs: [{ state: 'READY' }, { state: 'UPDATE_AVAILABLE' }], pendingMutationCount: 3, storageEstimate: { usage: 90, quota: 100 } });
  assert.equal(d.activeOfflinePackCount, 2); assert.equal(d.compatibility, 'MATCH'); assert.ok(d.warnings.some(w => /quase cheio/.test(w)));
  const html = App.pwaView.diagnostics(d) + App.pwaView.updateBanner(P.update.viewModel({ supported: true, state: 'UPDATE_AVAILABLE', blockers: [] }))
    + App.pwaView.storagePanel({ packs: [{ packId: 'pack:house7:viva-juara', developmentId: 'viva-juara', bytes: 3e6, state: 'READY', lastUpdatedAt: '2026-10-10T10:42:00Z' }], estimatedUsageBytes: 5e6, estimatedQuotaBytes: 1e9, persistent: true })
    + App.pwaView.syncQueue([{ mutationId: 'm1', conflictState: 'USER_REVIEW_REQUIRED' }, { mutationId: 'm2', conflictState: 'NO_CONFLICT' }]);
  assert.match(html, /role="status"/); assert.match(html, /data-act="pwaUpdateNow"/); assert.match(html, /Armazenamento offline/); assert.match(html, /2 alterações aguardando sincronização/);
  assert.match(html, /estimativa/); assert.doesNotMatch(html, /Service Worker|cache miss|revision mismatch/i, '§221: no technical terms for users');
  assert.match(App.pwaView.packOffer('Viva Juara', { profile: 'STANDARD', bytesLabel: 'Estimativa: 2,4 MB', label: 'Padrão' }), /Disponibilizar Viva Juara offline/);
  assert.match(App.pwaView.connectivityChip(P.connectivity.indicator({ effectiveState: 'OFFLINE' })), /Offline/);
  assert.equal(App.pwaView.esc('<img onerror=1>'), '&lt;img onerror=1&gt;');
  assert.ok(CORE.LegacyPwaInventory.some(i => i.risk === 'HIGH' && i.migrationAction === 'REPLACE'));
  assert.equal(CORE.BROWSER_SUPPORT.length, 6);
});

test('build wiring: sw.js inlines the shared classifier and the generated table; PrecacheManifest is minimal; page carries the manifest link and build id', () => {
  assert.ok(B1.sw.includes('WS_ROUTING') && B1.sw.includes('"technical_analysis_input"') && B1.sw.includes('COMPILED'));
  assert.ok(!/__(VERSION|PRECACHE|ASSET_REV|SW_META|CACHE_RULES)__/.test(B1.sw.replace(/\/\*[\s\S]*?\*\//g, '')), 'all placeholders filled');
  const pm = JSON.parse(fs.readFileSync(path.join(B1.dir, 'precache-manifest.json'), 'utf8'));
  assert.deepEqual(pm.entries.map(e => e.assetType).sort(), ['APP_SHELL', 'ESSENTIAL_STATIC_ASSET', 'ICON', 'ICON', 'ICON', 'OFFLINE_FALLBACK', 'WEB_APP_MANIFEST']);
  for (const e of pm.entries) assert.ok(e.url && e.revision && e.bytes > 0);
  assert.ok(!pm.entries.some(e => /json$|webp$/.test(e.url) && e.url !== 'manifest.webmanifest'), 'no data, maps, high-res or documents in the precache (§31)');
  const build = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build.js'), 'utf8');
  assert.match(build, /headTags\(\)/); assert.match(build, /app-build-id/); assert.match(build, /pwaBuild\.js'\)\.build/);
});

test('golden scenarios of §345 are all covered', () => {
  const all = ['PwaFirstInstall', 'PwaAppShellOfflineBoot', 'PwaNoOfflinePack', 'PwaPrepareBasicDevelopmentPack', 'PwaPrepareStandardDevelopmentPack', 'PwaOfflineMapBrowse', 'PwaOfflineLotSearch', 'PwaOfflineLotQuickView',
    'PwaOfflineAvailabilityLastKnown', 'PwaOfflinePriceVersion', 'PwaOfflineReservationDenied', 'PwaOfflineFavoriteQueued', 'PwaSyncFavoriteOnReconnect', 'PwaSyncConflictReview', 'PwaTenantSwitchIsolation', 'PwaLogoutSensitivePurge',
    'PwaOfflinePackRefreshDelta', 'PwaPackInterruptedDownloadRollback', 'PwaPackChecksumFailureRollback', 'PwaStorageQuotaInsufficient', 'PwaServiceWorkerUpdateWaiting', 'PwaSafeUpdateActivation', 'PwaUpdateWithPendingMutations',
    'PwaBrowserWithoutBackgroundSync', 'PwaBrowserWithoutServiceWorker', 'PwaSharedRouteNotAvailableOffline', 'PwaPresentationOfflinePack', 'PwaFinancialOfflineWarning', 'PwaDeepLinkOfflineAvailable', 'PwaDeepLinkOfflineUnavailable', 'PwaAccessRevokedOnReconnect'];
  const src = fs.readFileSync(__filename, 'utf8');
  for (const g of all) assert.ok(src.includes(`golden('${g}`) || new RegExp(`golden\\('[^']*\\b${g}\\b`).test(src), g);
});

test.after(() => { try { fs.rmSync(B1.dir, { recursive: true, force: true }); } catch (e) { /* tmp */ } });
