'use strict';
// Round 6 — code splitting of the public panel. The split is a build-time concern: the harness keeps loading every module in
// ORDER. These tests check that (1) the core part of the plan loads alone and the chunks, loaded afterwards, give the same App
// as the single file; (2) App.chunks (loading/chunkLoader.js) dedups, honours dependencies and SRI, reports failures without
// retry loops; (3) the worker precaches the chunks and the CSP allows them; (4) the Entorno chunk stays OFF for the visitor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), crypto = require('crypto');
const { ORDER, SRC, DATA } = require('./harness.js');
const CH = require('../scripts/chunks.js'), CB = require('../scripts/configBundle.js');

function context() {
  const store = {};
  const ctx = { console, Intl, Date, Math, JSON, Map, Set, Promise, queueMicrotask, setTimeout, clearTimeout, AbortController, structuredClone, TextEncoder, URL, URLSearchParams,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, location: { hash: '' }, history: { replaceState() {} },
    fetch: async () => ({ ok: false, status: 404, json: async () => null }) };
  ctx.window = ctx; vm.createContext(ctx); return ctx;
}
const run = (ctx, code, filename) => vm.runInContext(code, ctx, { filename });
const files = () => ORDER.filter(f => fs.existsSync(path.join(SRC, f)));
/** two-level shape of App (namespaces and their members), the contract the split must preserve */
const shape = App => Object.keys(App).sort().map(k => k + (App[k] && typeof App[k] === 'object' && k !== 'configs' && k !== 'CHUNK_MANIFEST' ? '{' + Object.keys(App[k]).sort().join(',') + '}' : ''));

test('split plan: core loads alone (no lazy namespace), the chunks complete it to exactly the single-file App', () => {
  const configs = CB.read(undefined, { profile: 'public' }), plan = CH.split({ files: files(), configs });
  // single file (same modules, same order, public configs)
  const full = context();
  for (const f of [...files(), ...CH.LAZY_ONLY]) { run(full, fs.readFileSync(path.join(SRC, f), 'utf8'), f); if (f === 'prelude.js') run(full, `App.configs = ${JSON.stringify(configs)};`, 'configs'); }
  // split: core first, then every chunk (dependencies first), like App.chunks does
  const sp = context();
  for (const f of plan.coreFiles) { run(sp, fs.readFileSync(path.join(SRC, f), 'utf8'), f); if (f === 'prelude.js') run(sp, `App.configs = ${JSON.stringify(plan.coreConfigs)};`, 'configs'); }
  run(sp, fs.readFileSync(path.join(SRC, 'loading/chunkLoader.js'), 'utf8'), 'loading/chunkLoader.js');
  for (const ns of ['compare', 'customer', 'journey', 'decision', 'presentationMode', 'share', 'documentServices', 'provenance', 'dataConfidence', 'versioning', 'favorites', 'surroundings']) assert.equal(sp.App[ns], undefined, `${ns} is not in the core`);
  for (const k of ['compare', 'journey', 'documents', 'provenance', 'confidence', 'versioning', 'decision', 'customer']) assert.equal(sp.App.configs[k], undefined, `configs.${k} travels with its chunk`);
  assert.ok(sp.App.services.comparison && sp.App.services.share && sp.App.integrity && sp.App.priceHistory, 'small shared modules stay in the core');
  const done = new Set(), order = [];
  const visit = c => { if (done.has(c.name)) return; for (const d of c.deps) visit(plan.chunks.find(x => x.name === d)); run(sp, c.text, c.file); done.add(c.name); order.push(c.name); };
  for (const c of plan.chunks) visit(c);
  assert.ok(order.indexOf('comparison') < order.indexOf('presentation'), 'presentation needs comparison first');
  for (const c of plan.chunks) assert.equal(sp.App.chunks.isLoaded(c.name), true); // without a manifest in this vm every chunk counts as loaded
  delete sp.App.chunks; delete full.App.chunks;
  assert.deepEqual(shape(sp.App), shape(full.App));
  assert.deepEqual(JSON.parse(JSON.stringify(sp.App.configs)), JSON.parse(JSON.stringify(full.App.configs)), 'configs reassembled');
  // behaviour, not only shape: the comparison domain and the decision services answer the same in both
  assert.equal(JSON.stringify(sp.App.compare.domain.metric('area') || null), JSON.stringify(full.App.compare.domain.metric('area') || null));
  assert.deepEqual(Object.keys(sp.App.decision.services).sort(), Object.keys(full.App.decision.services).sort());
});

// ------------------------------------------------------------------ App.chunks with a fake document
function loaderEnv(manifest, behave = {}) {
  const ctx = context(), appended = [];
  const el = tag => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; } });
  ctx.document = { baseURI: 'https://painel.example/', head: { appendChild: e => { appended.push(e); setTimeout(() => (behave[e.src || e.href] || behave.default || 'ok') === 'fail' ? e.onerror && e.onerror() : (e.tag === 'script' && (behave[e.src] !== 'incomplete') && ctx.App.chunks._done(e.attrs['data-chunk']), e.onload && e.onload()), 1); } },
    createElement: el, querySelector: () => null };
  ctx.location = { origin: 'https://painel.example', hash: '' };
  run(ctx, 'var App = {};', 'prelude'); if (manifest) run(ctx, `App.CHUNK_MANIFEST = ${JSON.stringify(manifest)};`, 'manifest');
  run(ctx, fs.readFileSync(path.join(SRC, 'loading/chunkLoader.js'), 'utf8'), 'loading/chunkLoader.js');
  return { CK: ctx.App.chunks, appended };
}
const MF = { comparison: { file: 'chunks/comparison.0123456789.js', integrity: 'sha384-AAA', bytes: 10, deps: [], css: [] },
  presentation: { file: 'chunks/presentation.0123456789.js', integrity: 'sha384-BBB', bytes: 10, deps: ['comparison'], css: [] },
  surroundings: { file: 'chunks/surroundings.0123456789.js', integrity: 'sha384-CCC', bytes: 10, deps: [], css: ['chunks/surroundings.0123456789.css'] } };

test('App.chunks without a manifest (tests, unsplit build): everything is loaded, ensure resolves, nothing is appended', async () => {
  const { CK, appended } = loaderEnv(null);
  assert.equal(CK.split(), false); assert.equal(CK.isLoaded('comparison'), true); assert.equal(CK.need('technical'), true);
  await CK.ensure('anything'); assert.equal(appended.length, 0);
});

test('App.chunks: dependencies first, one script per chunk (in-flight dedup), SRI on same origin, css before code, onReady', async () => {
  const { CK, appended } = loaderEnv(MF), seen = [];
  CK.onReady((n, ok) => seen.push(n + ':' + ok));
  assert.equal(CK.isLoaded('presentation'), false); assert.equal(CK.has('presentation'), true); assert.equal(CK.has('admin'), false);
  await Promise.all([CK.ensure('presentation'), CK.ensure('presentation'), CK.ensure('comparison')]);
  assert.deepEqual(appended.map(e => e.src), ['chunks/comparison.0123456789.js', 'chunks/presentation.0123456789.js']);
  assert.equal(appended[0].integrity, 'sha384-AAA'); assert.equal(appended[0].attrs['data-chunk'], 'comparison');
  assert.deepEqual(seen, ['comparison:true', 'presentation:true']);
  assert.equal(CK.isLoaded('presentation'), true); assert.equal(CK.need('comparison'), true);
  assert.equal(CK.need('surroundings'), false, 'need() starts the load and answers false');
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(appended.slice(2).map(e => e.tag + ':' + (e.src || e.href)), ['link:chunks/surroundings.0123456789.css', 'script:chunks/surroundings.0123456789.js']);
  assert.equal(CK.isLoaded('surroundings'), true);
  await assert.rejects(CK.ensure('admin'), e => e.code === 'CHUNK_UNKNOWN');
  assert.equal(CK.status().presentation.state, 'READY');
});

test('App.chunks: a failed chunk rejects (CHUNK_LOAD_FAILED), need() does not loop, retryFailed() allows a new attempt; a cut file is CHUNK_INCOMPLETE', async () => {
  const behave = { 'chunks/comparison.0123456789.js': 'fail' }, { CK, appended } = loaderEnv(MF, behave), seen = [];
  CK.onReady((n, ok, e) => seen.push(`${n}:${ok}:${e ? e.code : ''}`));
  await assert.rejects(CK.ensure('presentation'), e => e.code === 'CHUNK_LOAD_FAILED' && e.chunk === 'comparison');
  assert.equal(CK.failed('comparison'), true); assert.ok(seen.includes('comparison:false:CHUNK_LOAD_FAILED'));
  const n = appended.length; assert.equal(CK.need('comparison'), false); await new Promise(r => setTimeout(r, 10));
  assert.equal(appended.length, n, 'no automatic retry (offline without cache would loop)');
  delete behave['chunks/comparison.0123456789.js']; CK.retryFailed();
  await CK.ensure('presentation'); assert.equal(CK.isLoaded('presentation'), true);
  const b2 = { 'chunks/comparison.0123456789.js': 'incomplete' }, L2 = loaderEnv(MF, b2);
  await assert.rejects(L2.CK.ensure('comparison'), e => e.code === 'CHUNK_INCOMPLETE');
});

test('cross-origin host: no integrity attribute (SRI would need CORS); same file name', async () => {
  const { CK, appended } = loaderEnv({ comparison: { ...MF.comparison, file: 'https://cdn.other.example/chunks/comparison.0123456789.js' } });
  await CK.ensure('comparison'); assert.equal(appended[0].integrity, undefined);
});

// ------------------------------------------------------------------ build outputs: worker precache, CSP, Entorno
test('worker: every chunk of the page is precached (APP_CHUNK, required, expected type); a chunk request is answered from the precache', () => {
  const page = path.join(DATA, 'index.html'); if (!fs.existsSync(page)) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'split6-'));
  for (const f of ['index.html', 'manifest.json', 'logo.png']) if (fs.existsSync(path.join(DATA, f))) fs.copyFileSync(path.join(DATA, f), path.join(dir, f));
  const mf = JSON.parse(fs.readFileSync(page, 'utf8').match(/App\.CHUNK_MANIFEST = (\{.*?\});\n/)[1]);
  fs.mkdirSync(path.join(dir, 'chunks')); for (const e of Object.values(mf)) for (const f of [e.file, ...e.css]) fs.copyFileSync(path.join(DATA, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'chunks', 'stale.0000000000.js'), '/* old build */');
  const r = require('../scripts/pwaBuild.js').build({ out: dir, version: 'split6test' });
  const chunks = r.precache.filter(e => e.assetType === 'APP_CHUNK');
  assert.deepEqual(chunks.map(e => e.url).sort(), Object.values(mf).flatMap(e => [e.file, ...e.css]).sort(), 'exactly the chunks of the page (never a stale file)');
  for (const e of chunks) { assert.equal(e.required, true); assert.equal(e.expect, /\.css$/.test(e.url) ? 'STYLE' : 'SCRIPT'); assert.ok(e.revision && e.bytes > 0); }
  const RT = require('../src/pwa/swRouting.js'), ctx = { scopePath: '/', rules: RT.compile([]), precache: new Set(r.precache.map(p => p.url.replace(/^\.\//, ''))) };
  const d = RT.classify({ method: 'GET', url: 'https://app.example/' + chunks[0].url, mode: 'no-cors', sameOrigin: true }, ctx);
  assert.equal(d.strategy, 'PRECACHE'); assert.equal(d.handle, true);
  const mk = type => ({ status: 200, ok: true, type: 'basic', headers: { get: k => (k === 'content-type' ? type : null) } });
  assert.equal(RT.storable(mk('text/javascript'), 'SCRIPT'), true); assert.equal(RT.storable(mk('text/html'), 'SCRIPT'), false, 'an HTML error page is never cached as code');
  assert.equal(RT.storable(mk('text/css; charset=utf-8'), 'STYLE'), true);
});

test('CSP: same-origin chunks allowed (script-src \'self\' + their sha384), no unsafe-inline/eval, no HIGH finding', () => {
  const page = path.join(DATA, 'index.html'); if (!fs.existsSync(page)) return;
  const html = fs.readFileSync(page, 'utf8'), SH = require('../scripts/securityHeaders.js'), out = SH.headersFile({ html });
  const script = out.csp.split(';').map(s => s.trim()).find(s => s.startsWith('script-src')).split(/\s+/);
  assert.ok(script.includes("'self'")); assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'") && !script.includes('*') && !script.includes('https:'));
  const mf = JSON.parse(html.match(/App\.CHUNK_MANIFEST = (\{.*?\});\n/)[1]);
  for (const e of Object.values(mf)) assert.ok(script.includes(`'${e.integrity}'`), e.file);
  assert.equal(out.findings.filter(f => f.severity === 'HIGH').length, 0);
  assert.ok(SH.chunkHashes(html).every(h => /^'sha384-/.test(h)));
});

test('Entorno chunk in the public panel: flag OFF, coordinate validated from the KMZ, no key → NOT_CONFIGURED notice only; tab hidden; no Google loader', () => {
  const ctx = context(); run(ctx, 'var App = {};', 'prelude');
  for (const f of CH.LAZY_ONLY) run(ctx, fs.readFileSync(path.join(SRC, f), 'utf8'), f);
  const S = ctx.App.surroundings, V = ctx.App.surroundingsView;
  assert.equal(S.client, undefined, 'the Maps JS loader (surroundingsClient) is not part of the public chunk');
  const cap = S.domain.capability('viva-juara', { browserKeyConfigured: false, serverKeyConfigured: false, online: true });
  assert.equal(cap.state, 'NOT_CONFIGURED'); assert.equal(cap.coordinateStatus, 'VALIDATED'); assert.equal(cap.GOOGLE_MAPS_ENVIRONMENT, false);
  const html = V.render(V.viewModel({ developmentId: 'viva-juara', capability: cap, state: null }));
  assert.match(html, /Entorno ainda não configurado/); assert.doesNotMatch(html, /data-surroundings-map|<script|maps\.googleapis/);
  assert.equal(V.tabs({ active: 'lots', showEnvironment: cap.GOOGLE_MAPS_ENVIRONMENT }).includes('Entorno'), false);
  const app = fs.readFileSync(path.join(SRC, 'presentation/app.js'), 'utf8');
  assert.match(app, /presentationMode === 'technical' \? envHtml\(\)/, 'Empreendimento shows the Entorno state in the technical mode only');
});
