'use strict';
// Hybrid execution (online + local cache + offline fallback): IndexedDB (fake-indexeddb) and MemoryBackend,
// atomic writes, manifest concurrency, corruption recovery, revision races, multi-development isolation,
// offline boot semantics, user-state sanitization and client-mode wording. No real network: fetch is injected.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
require('./node_modules/fake-indexeddb/auto');
const { load, DATA } = require('./harness.js');

const plain = x => JSON.parse(JSON.stringify(x));
const FILES = {}; // published files read once
const readDoc = u => JSON.parse(FILES[u] || (FILES[u] = fs.readFileSync(path.join(DATA, u), 'utf8')));
const COMMERCIAL = readDoc('commercial.json');
let DBN = 0;

/** a fresh App with an injected fetch (online switch, per-path overrides, a second development under outro/) */
function makeEnv() {
  const env = { online: true, calls: [], override: {} };
  env.fetch = async url => {
    const u = String(url).split('?')[0]; env.calls.push(u);
    if (!env.online) throw new TypeError('Failed to fetch');
    let doc;
    if (Object.prototype.hasOwnProperty.call(env.override, u)) doc = env.override[u];
    else {
      const outro = u.startsWith('outro/'), f = outro ? u.slice(6) : u;
      if (!fs.existsSync(path.join(DATA, f))) return { ok: false, status: 404, json: async () => null };
      doc = readDoc(f);
      if (outro) doc = Array.isArray(doc) ? doc.map(({ did, ...r }) => r) : { ...doc, developmentId: 'outro-dev' };
    }
    return { ok: true, status: 200, json: async () => plain(doc) };
  };
  env.App = load({ fetch: env.fetch, globals: { indexedDB, IDBKeyRange } });
  env.App.offline.net.sleep = async () => {}; // retries without real waiting
  env.win = () => {
    const ls = {};
    return { navigator: { get onLine() { return env.online; } }, addEventListener: (t, fn) => { (ls[t] = ls[t] || []).push(fn); }, fire: t => (ls[t] || []).forEach(fn => fn()) };
  };
  env.dbName = () => `ws-test-${process.pid}-${++DBN}`;
  env.idb = (name = env.dbName()) => env.App.offline.IdbBackend(indexedDB, name);
  env.hybrid = (backend, devId = 'viva-juara', win = env.win()) => env.App.offline.createHybrid(devId, { backend, win, syncOpts: { debounceMs: 0 } });
  /** boot online once and wait for the background cache write */
  env.seed = async (backend, devId) => { const h = await env.hybrid(backend, devId); await h.repo.load(); assert.equal(await h.source.pendingPersist, true); return h; };
  return env;
}
function addOutroDevelopment(App) {
  const vj = App.config.DEVELOPMENTS[0];
  App.config.DEVELOPMENTS.push({ ...vj, id: 'outro-dev', code: 'OD', name: 'Outro Empreendimento',
    assets: { ...vj.assets, manifest: 'outro/manifest.json', commercial: 'outro/commercial.json', lots: 'outro/lots.json' },
    priceTables: vj.priceTables.map(t => ({ ...t, developmentId: 'outro-dev' })) });
}
const commercialDoc = ({ revision, version, pricePerM2 }) => {
  const d = plain(COMMERCIAL);
  d.revision = revision;
  d.priceTables = d.priceTables.map(t => (t.id === d.currentPriceTableId ? { ...t, version: version || t.version, pricePerM2: pricePerM2 || t.pricePerM2 } : t));
  return d;
};
const B79 = 'VJ-QB-L0079', VER = '2026-10-06.1';
// BUG data/offline.js:131 — dangling else in MemoryBackend.write: the `else if (o.op === 'update')` and `else if (o.op === 'fail')`
// branches bind to the inner `if (inPrefix(...))` of the deletePrefix loop, so 'update' and 'fail' ops are silently ignored.
// Consequences: updateManifest() never writes (activate() then throws on a null manifest), putDynamicState() never records the
// revisions, and a simulated failure does not abort the batch. The IndexedDB backend is correct.
const MEM_BUG = 'BUG data/offline.js:131 — dangling else: MemoryBackend.write ignores update/fail ops (no manifest, activate() throws, no atomic abort)';
const BACKENDS = [['MemoryBackend', env => env.App.offline.MemoryBackend(), MEM_BUG], ['IndexedDB', env => env.idb(), null]];

// ------------------------------------------------------------------ IndexedDB stores
test('IndexedDB: database v1 is created with the six stores, compound key paths and indexes', async () => {
  const env = makeEnv(), name = env.dbName(), b = env.idb(name);
  assert.equal(b.kind, 'indexeddb');
  assert.equal(await b.get('metadata', '__probe__'), null);
  await b.close();
  const db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  try {
    assert.equal(db.version, 1);
    const STORES = env.App.offline.STORES;
    assert.deepEqual([...db.objectStoreNames].sort(), ['analysisLots', 'assetsMetadata', 'dynamicLots', 'metadata', 'staticLots', 'syncState']);
    const tx = db.transaction([...db.objectStoreNames], 'readonly');
    for (const [s, def] of Object.entries(STORES)) {
      const os = tx.objectStore(s);
      assert.deepEqual(plain(os.keyPath), plain(def.keyPath), s);
      assert.deepEqual([...os.indexNames].sort(), Object.keys(def.indexes || {}).sort(), `${s} indexes`);
      for (const [i, p] of Object.entries(def.indexes || {})) assert.deepEqual(plain(os.index(i).keyPath), plain(p), `${s}.${i}`);
    }
    assert.deepEqual(plain(STORES.staticLots.keyPath), ['developmentId', 'version', 'lotId']);
    assert.deepEqual(plain(STORES.dynamicLots.keyPath), ['developmentId', 'lotId']);
  } finally { db.close(); }
});

test('pickBackend: IndexedDB when it opens, memory when it is missing or broken; createHybrid uses IndexedDB by default', async () => {
  const env = makeEnv();
  assert.equal((await env.App.offline.pickBackend({})).kind, 'indexeddb');
  const broken = { open() { throw new Error('SecurityError'); } };
  assert.equal((await env.App.offline.pickBackend({ indexedDB: broken })).kind, 'memory');
  const noIdb = load({ fetch: env.fetch }); // no indexedDB global (private mode / old browser)
  const mb = await noIdb.offline.pickBackend({});
  assert.equal(mb.kind, 'memory'); assert.equal(mb.persistent, false);
  const h = await env.App.offline.createHybrid('viva-juara', { win: env.win(), indexedDB });
  assert.equal(h.backend.kind, 'indexeddb');
});

// ------------------------------------------------------------------ atomic writes
for (const [name, mk, bug] of BACKENDS) {
  const opt = {};
  test(`${name}: a batch with a failing op writes nothing`, opt, async () => {
    const env = makeEnv(), b = mk(env);
    await assert.rejects(b.write([{ op: 'put', store: 'metadata', value: { key: 'a', value: 1 } }, { op: 'fail' }, { op: 'put', store: 'metadata', value: { key: 'b', value: 2 } }]));
    assert.equal(await b.get('metadata', 'a'), null);
    assert.equal(await b.get('metadata', 'b'), null);
  });

  test(`${name}: atomic snapshot write — simulateFailure leaves nothing stored and nothing active`, opt, async () => {
    const env = makeEnv(), b = mk(env), O = env.App.offline;
    const repo = env.App.repos.LotRepository('viva-juara'); await repo.load();
    const st = repo.getLayers().static, local = O.LocalCacheRepository('viva-juara', b);
    await assert.rejects(local.putStaticSnapshot(st, { simulateFailure: true }));
    assert.equal(await local.getStaticSnapshot(VER), null);
    assert.equal((await b.getAllPrefix('staticLots', ['viva-juara', VER])).length, 0);
    assert.equal(await b.get('metadata', `viva-juara:static:${VER}`), null);
    assert.equal(await local.getManifest(), null);
    // a successful write is stored but not active until activate()
    await local.putStaticSnapshot(st);
    assert.equal(await local.getManifest(), null);
    const r = await local.getStaticSnapshot(VER);
    assert.equal(Object.keys(r.snap.lots).length, 498);
    assert.equal(O.checksum(r.snap.lots), O.checksum(st.lots));
    const m = await local.activate('static', VER);
    assert.equal(m.currentStaticVersion, VER);
    // a failed write of the next version keeps the active one intact
    await assert.rejects(local.putStaticSnapshot({ ...st, staticDataVersion: 'v2' }, { simulateFailure: true }));
    assert.equal((await b.getAllPrefix('staticLots', ['viva-juara', 'v2'])).length, 0);
    assert.equal((await local.getManifest()).currentStaticVersion, VER);
    assert.equal(Object.keys((await local.getStaticSnapshot(VER)).snap.lots).length, 498);
  });

  test(`${name}: activate keeps current + previous versions and removes older ones`, opt, async () => {
    const env = makeEnv(), b = mk(env), O = env.App.offline;
    const repo = env.App.repos.LotRepository('viva-juara'); await repo.load();
    const st = repo.getLayers().static, local = O.LocalCacheRepository('viva-juara', b);
    for (const v of ['v1', 'v2', 'v3']) { await local.putStaticSnapshot({ ...st, staticDataVersion: v }); await local.activate('static', v); }
    const m = await local.getManifest();
    assert.equal(m.currentStaticVersion, 'v3'); assert.equal(m.previousStaticVersion, 'v2');
    assert.equal((await b.getAllPrefix('staticLots', ['viva-juara', 'v1'])).length, 0);
    assert.equal(await local.getStaticSnapshot('v1'), null);
    assert.equal((await b.getAllPrefix('staticLots', ['viva-juara', 'v2'])).length, 498);
    // discarding the current version falls back to the previous one (local rollback)
    await local.discard('static', 'v3');
    const m2 = await local.getManifest();
    assert.equal(m2.currentStaticVersion, 'v2'); assert.equal(m2.previousStaticVersion, null);
  });

  // ---------------------------------------------------------------- manifest concurrency (regression of the lost-update bug)
  test(`${name}: updateManifest — concurrent activate() and putDynamicState() never lose each other's fields`, opt, async () => {
    const env = makeEnv(), b = mk(env), local = env.App.offline.LocalCacheRepository('viva-juara', b);
    const dyn = (kind, rev) => ({ kind, schemaVersion: '1.0', developmentId: 'viva-juara', revision: rev, priceTableVersion: 'p' + rev, updatedAt: null,
      lots: { [B79]: kind === 'commercial' ? { commercial: { price: rev } } : { availability: { status: 'UNKNOWN' } } } });
    for (let i = 1; i <= 25; i++) {
      await Promise.all([
        local.activate('static', 's' + i, { tag: i }),
        local.putDynamicState(dyn('commercial', i), dyn('availability', i), { confirmedAt: 'c' + i }),
        local.activate('analysis', 'a' + i)
      ]);
      const m = await local.getManifest();
      assert.equal(m.currentStaticVersion, 's' + i, `round ${i}: static pointer`);
      assert.equal(m.previousStaticVersion, i > 1 ? 's' + (i - 1) : null, `round ${i}: previous pointer`);
      assert.equal(m.currentAnalysisVersion, 'a' + i, `round ${i}: analysis pointer`);
      assert.equal(m.currentCommercialRevision, i, `round ${i}: commercial revision`);
      assert.equal(m.currentAvailabilityRevision, i, `round ${i}: availability revision`);
      assert.equal(m.lastSuccessfulSyncAt, 'c' + i, `round ${i}: last sync`);
      assert.equal(m.remote && m.remote.tag, i, `round ${i}: remote manifest`);
    }
    // a burst of overlapping writers: every field still holds a value one of them wrote
    await Promise.all(Array.from({ length: 20 }, (_, i) => [local.activate('static', 'b' + i), local.putDynamicState(dyn('commercial', 100 + i), dyn('availability', 200 + i)), local.activate('analysis', 'x' + i)]).flat());
    const m = await local.getManifest();
    assert.match(m.currentStaticVersion, /^b\d+$/);
    assert.match(m.currentAnalysisVersion, /^x\d+$/);
    assert.ok(m.currentCommercialRevision >= 100 && m.currentCommercialRevision < 120);
    assert.ok(m.currentAvailabilityRevision >= 200 && m.currentAvailabilityRevision < 220);
    // read-modify-write is atomic: 40 concurrent increments → 40
    await Promise.all(Array.from({ length: 40 }, () => local.updateManifest(x => { x.counter = (x.counter || 0) + 1; })));
    const m2 = await local.getManifest();
    assert.equal(m2.counter, 40);
    assert.match(m2.currentStaticVersion, /^b\d+$/);
    assert.ok(m2.currentCommercialRevision >= 100);
  });
}

// ------------------------------------------------------------------ boot paths
test('first visit offline → FIRST_VISIT_OFFLINE, nothing composed, connectivity OFFLINE', async () => {
  const env = makeEnv(); env.online = false;
  const h = await env.hybrid(env.idb());
  await assert.rejects(h.repo.load(), e => e.code === 'FIRST_VISIT_OFFLINE' && /primeira vez/.test(e.message) && e.cause && e.cause.code === 'NETWORK');
  assert.equal(h.repo.lotsSync().length, 0);
  assert.ok(Object.values(h.repo.getDataState()).every(s => s === 'error'));
  assert.equal(h.connectivity.get(), 'OFFLINE');
});

test('first visit online: REMOTE origin, commercial FRESH (confirmed now), cache written in the background', async () => {
  const env = makeEnv(), b = env.idb();
  const h = await env.hybrid(b);
  const lots = await h.repo.load();
  assert.equal(lots.length, 498);
  assert.equal(h.source.origin, 'REMOTE');
  assert.equal(h.repo.getFreshness().commercial, 'FRESH');
  assert.equal(h.repo.getFreshness().availability, 'UNKNOWN');
  assert.equal(h.connectivity.get(), 'ONLINE');
  assert.equal(await h.source.pendingPersist, true);
  const m = await h.local.getManifest();
  assert.equal(m.currentStaticVersion, VER);
  assert.equal(m.currentAnalysisVersion, '2026-10-06');
  assert.equal(m.currentCommercialRevision, 1);
  assert.equal(m.remote.checksums.static, readDoc('manifest.json').checksums.static);
  assert.ok(!env.App.lifecycle.log.some(e => e.event === 'checksum mismatch'));
});

test('offline boot from cache → origin CACHE, commercial STALE on every lot (never FRESH without network confirmation)', async () => {
  const env = makeEnv(), b = env.idb();
  const first = await env.seed(b);
  const priceBefore = first.repo.getLotById(B79).commercial.price;
  env.online = false;
  const h = await env.hybrid(b);
  const lots = await h.repo.load();
  assert.equal(h.source.origin, 'CACHE');
  assert.equal(lots.length, 498);
  assert.equal(h.connectivity.get(), 'OFFLINE');
  assert.equal(h.repo.getFreshness().commercial, 'STALE');
  assert.equal(h.repo.getFreshnessState().commercial.source, 'CACHE');
  assert.ok(lots.every(l => l.metadata.freshness.commercial === 'STALE'));
  assert.ok(lots.every(l => l.availability.status === 'UNKNOWN' && l.availability.freshness !== 'FRESH'));
  assert.equal(h.repo.getLotById(B79).commercial.price, priceBefore);
  assert.deepEqual(plain(h.repo.getLotById(B79)), plain({ ...plain(first.repo.getLotById(B79)), metadata: { ...plain(first.repo.getLotById(B79).metadata), freshness: { commercial: 'STALE', availability: 'UNKNOWN' } } }));
  // a sync while offline cannot confirm anything
  const r = await h.sync.sync('manual');
  assert.equal(r.manifest, 'error');
  assert.equal(h.sync.info().state, 'OFFLINE');
  assert.equal(h.repo.getFreshness().commercial, 'STALE');
  assert.ok(h.repo.lotsSync().every(l => l.metadata.freshness.commercial !== 'FRESH'));
});

test('online boot from cache is STALE until the sync confirms the source; going offline makes it STALE again', async () => {
  const env = makeEnv(), b = env.idb();
  await env.seed(b);
  const win = env.win(), h = await env.hybrid(b, 'viva-juara', win);
  h.sync.start();
  await h.repo.load();
  assert.equal(h.source.origin, 'CACHE');
  assert.equal(h.repo.getFreshness().commercial, 'STALE');
  const r = await h.sync.sync('boot');
  assert.equal(r.commercial, 'confirmed');
  assert.equal(r.static, 'current'); assert.equal(r.analysis, 'current');
  assert.equal(h.sync.info().state, 'SUCCESS');
  assert.equal(h.repo.getFreshness().commercial, 'FRESH');
  assert.ok(h.repo.lotsSync().every(l => l.metadata.freshness.commercial === 'FRESH'));
  // browser goes offline → dynamic data marked STALE immediately
  env.online = false; win.fire('offline');
  assert.equal(h.connectivity.get(), 'OFFLINE');
  assert.equal(h.repo.getFreshness().commercial, 'STALE');
  assert.equal(h.sync.info().state, 'OFFLINE');
  // back online → reconnect sync confirms again
  env.online = true; win.fire('online');
  await h.sync.sync('manual'); // joins the reconnect sync already running
  assert.equal(h.repo.getFreshness().commercial, 'FRESH');
});

test('MemoryBackend (private mode): the hybrid cache write succeeds and a second source on the same backend boots from CACHE', {}, async () => {
  const env = makeEnv(), mem = env.App.offline.MemoryBackend();
  const h = await env.hybrid(mem);
  await h.repo.load();
  assert.equal(await h.source.pendingPersist, true);
  env.online = false;
  const h2 = await env.hybrid(mem);
  await h2.repo.load();
  assert.equal(h2.source.origin, 'CACHE');
});

test('sync lock: concurrent sync() calls share one run', async () => {
  const env = makeEnv(), b = env.idb();
  const h = await env.seed(b);
  const p1 = h.sync.sync('manual'), p2 = h.sync.sync('manual');
  assert.equal(p1, p2);
  await p1;
});

test('a failed cache write (quota) never breaks the online app and never activates a partial copy', async () => {
  const env = makeEnv(), mem = env.App.offline.MemoryBackend();
  const full = { ...mem, write: async () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } };
  const h = await env.hybrid(full);
  assert.equal((await h.repo.load()).length, 498);
  assert.equal(await h.source.pendingPersist, false);
  assert.ok(env.App.lifecycle.log.some(e => e.event === 'cache write failed' && e.quota === true));
  env.online = false;
  await assert.rejects((await env.hybrid(full)).repo.load(), e => e.code === 'FIRST_VISIT_OFFLINE');
});

// ------------------------------------------------------------------ corruption
test('corrupted cache row (changed value) → version discarded, reloaded from the remote source, cache repaired', async () => {
  const env = makeEnv(), b = env.idb();
  await env.seed(b);
  const rows = await b.getAllPrefix('staticLots', ['viva-juara', VER]);
  const row = rows.find(r => r.lotId === B79);
  row.data.geometry.areaM2 = 999999;
  await b.write([{ op: 'put', store: 'staticLots', value: row }]);
  const h = await env.hybrid(b);
  await h.repo.load();
  assert.equal(h.source.origin, 'REMOTE');
  assert.equal(h.repo.getLotById(B79).geometry.areaM2, 291.78, 'the corrupted value is never shown');
  assert.ok(env.App.lifecycle.log.some(e => e.event === 'cache discarded' && e.kind === 'static' && e.version === VER));
  assert.equal(await h.source.pendingPersist, true);
  env.online = false;
  const h2 = await env.hybrid(b);
  await h2.repo.load();
  assert.equal(h2.source.origin, 'CACHE');
  assert.equal(h2.repo.getLotById(B79).geometry.areaM2, 291.78);
});

test('corrupted cache (missing row) → CACHE_CORRUPT on read; offline it is refused rather than shown', async () => {
  const env = makeEnv(), b = env.idb();
  await env.seed(b);
  await b.write([{ op: 'delete', store: 'staticLots', key: ['viva-juara', VER, B79] }]);
  const local = env.App.offline.LocalCacheRepository('viva-juara', b);
  await assert.rejects(local.getStaticSnapshot(VER), e => e.code === 'CACHE_CORRUPT' && /497 de 498/.test(e.message));
  env.online = false;
  const h = await env.hybrid(b);
  await assert.rejects(h.repo.load(), e => e.code === 'FIRST_VISIT_OFFLINE');
  assert.equal((await local.getManifest()).currentStaticVersion, null);
});

test('corrupted analysis checksum → analysis discarded, full reload from remote', async () => {
  const env = makeEnv(), b = env.idb();
  await env.seed(b);
  const rows = await b.getAllPrefix('analysisLots', ['viva-juara', '2026-10-06']);
  rows[0].data.intelligence.scores.housing = 1;
  await b.write([{ op: 'put', store: 'analysisLots', value: rows[0] }]);
  const h = await env.hybrid(b);
  await h.repo.load();
  assert.equal(h.source.origin, 'REMOTE');
  assert.ok(env.App.lifecycle.log.some(e => e.event === 'cache discarded' && e.kind === 'analysis'));
});

test('corrupted dynamic state → discarded; boot from cache uses the bundled table (STALE), never a corrupted price', async () => {
  const env = makeEnv(), b = env.idb();
  await env.seed(b);
  const rows = await b.getAllPrefix('dynamicLots', ['viva-juara']);
  const row = rows.find(r => r.lotId === B79);
  row.commercial.commercial.injected = 1; // a field outside the registry
  row.commercial.commercial.price = 1;
  await b.write([{ op: 'put', store: 'dynamicLots', value: row }]);
  env.online = false;
  const h = await env.hybrid(b);
  await h.repo.load();
  assert.equal(h.source.origin, 'CACHE');
  assert.ok(env.App.lifecycle.log.some(e => e.event === 'cache discarded' && e.kind === 'dynamic'));
  assert.equal(h.repo.getLayers().commercial.source, 'BUNDLED');
  assert.equal(h.repo.getFreshness().commercial, 'STALE');
  assert.equal(h.repo.getLotById(B79).commercial.price, Math.round(291.78 * 1196 * 100) / 100);
  assert.equal((await b.getAllPrefix('dynamicLots', ['viva-juara'])).length, 0);
});

// ------------------------------------------------------------------ commercial revision race
test('commercial revision race at the repository: an older revision never overwrites a newer one', async () => {
  const env = makeEnv();
  const repo = env.App.repos.LotRepository('viva-juara'); await repo.load();
  const cur = repo.getLayers().commercial;
  const older = { ...plain(cur), priceTableVersion: '2026-09-01', revision: 0 };
  older.lots[B79].commercial.price = 1;
  assert.deepEqual(plain(repo.applyCommercialUpdate(older)), { applied: false, reason: 'revisão antiga' });
  assert.equal(repo.getLotById(B79).commercial.price, cur.lots[B79].commercial.price);
  const newer = { ...plain(cur), priceTableVersion: '2026-11-01', revision: 2 };
  newer.lots[B79].commercial.price = 400000; newer.lots[B79].commercial.pricePerM2 = Math.round(400000 / 291.78 * 100) / 100;
  assert.equal(repo.applyCommercialUpdate(newer).applied, true);
  assert.equal(repo.getLotById(B79).commercial.price, 400000);
  assert.equal(repo.getLotById(B79).geometry.areaM2, 291.78);
});

test('commercial revision race through sync: newer applied and cached, a late older response ignored', async () => {
  const env = makeEnv(), b = env.idb();
  const h = await env.seed(b);
  assert.equal((await h.sync.sync('boot')).commercial, 'confirmed');
  env.override['commercial.json'] = commercialDoc({ revision: 3, version: '2026-11-01', pricePerM2: 1300 });
  const r1 = await h.sync.sync('manual');
  assert.equal(r1.commercial, 'updated');
  assert.equal(h.repo.getLotById(B79).commercial.price, Math.round(291.78 * 1300 * 100) / 100);
  assert.equal(h.repo.getFreshness().commercial, 'FRESH');
  env.override['commercial.json'] = commercialDoc({ revision: 2, version: '2026-10-20', pricePerM2: 1000 });
  const r2 = await h.sync.sync('manual');
  assert.equal(r2.commercial, 'ignored-old');
  assert.equal(h.repo.getLotById(B79).commercial.price, Math.round(291.78 * 1300 * 100) / 100);
  assert.equal((await h.local.getManifest()).currentCommercialRevision, 3);
  // the cache holds the newest table: an offline boot shows it (as STALE)
  env.online = false;
  const h2 = await env.hybrid(b);
  await h2.repo.load();
  assert.equal(h2.repo.getLotById(B79).commercial.price, Math.round(291.78 * 1300 * 100) / 100);
  assert.equal(h2.repo.getFreshness().commercial, 'STALE');
});

// BUG data/repositories.js:92 — apply() returns 'mesma versão' before looking at the revision (line 95), so a commercial.json
// whose revision changes without a new priceTableVersion is never applied; SyncManager (data/offline.js:540) then throws
// 'tabela comercial rejeitada', reports commercial 'error' and marks the (still current) prices STALE.
test('a newer commercial revision of the same table version is applied',
  {}, async () => {
    const env = makeEnv(), b = env.idb();
    const h = await env.seed(b);
    env.override['commercial.json'] = commercialDoc({ revision: 2, pricePerM2: 1250 }); // same version 2026-10-06, corrected price
    const r = await h.sync.sync('manual');
    assert.equal(r.commercial, 'updated');
    assert.equal(h.repo.getLotById(B79).commercial.price, Math.round(291.78 * 1250 * 100) / 100);
    assert.equal(h.repo.getFreshness().commercial, 'FRESH');
  });

test('a late older commercial revision of the same table version is ignored without marking current prices STALE',
  {}, async () => {
    const env = makeEnv(), b = env.idb();
    const h = await env.seed(b);
    env.override['commercial.json'] = commercialDoc({ revision: 5 });
    await h.sync.sync('manual');
    env.override['commercial.json'] = commercialDoc({ revision: 4, pricePerM2: 900 });
    const r = await h.sync.sync('manual');
    assert.equal(r.commercial, 'ignored-old');
    assert.equal(h.repo.getFreshness().commercial, 'FRESH');
  });

// ------------------------------------------------------------------ multi-development isolation
test('multi-development isolation: two developments in one database never see each other; clear() clears only one', async () => {
  const env = makeEnv(); addOutroDevelopment(env.App);
  const b = env.idb();
  const A = await env.seed(b, 'viva-juara');
  const B = await env.seed(b, 'outro-dev');
  await A.sync.sync('boot'); await B.sync.sync('boot');
  assert.ok(A.repo.lotsSync().every(l => l.identity.id.startsWith('VJ-') && l.identity.developmentId === 'viva-juara'));
  assert.ok(B.repo.lotsSync().every(l => l.identity.id.startsWith('OD-') && l.identity.developmentId === 'outro-dev'));
  assert.equal(B.repo.lotsSync().length, 498);
  const rowsA = await b.getAllPrefix('staticLots', ['viva-juara', VER]), rowsB = await b.getAllPrefix('staticLots', ['outro-dev', VER]);
  assert.equal(rowsA.length, 498); assert.equal(rowsB.length, 498);
  assert.ok(rowsA.every(r => r.lotId.startsWith('VJ-'))); assert.ok(rowsB.every(r => r.lotId.startsWith('OD-')));
  assert.ok((await b.getAllPrefix('dynamicLots', ['outro-dev'])).every(r => r.lotId.startsWith('OD-')));
  assert.equal((await A.local.getManifest()).developmentId, 'viva-juara');
  assert.equal((await B.local.getManifest()).developmentId, 'outro-dev');
  const snapB = await B.local.getStaticSnapshot(VER);
  assert.ok(Object.keys(snapB.snap.lots).every(id => id.startsWith('OD-')));
  assert.ok(await B.local.getSyncState());
  // clear() of A
  await A.local.clear();
  assert.equal(await A.local.getManifest(), null);
  assert.equal(await A.local.getSyncState(), null);
  for (const s of ['staticLots', 'analysisLots']) assert.equal((await b.getAllPrefix(s, ['viva-juara', s === 'staticLots' ? VER : '2026-10-06'])).length, 0, s);
  assert.equal((await b.getAllPrefix('dynamicLots', ['viva-juara'])).length, 0);
  assert.equal((await B.local.getManifest()).currentStaticVersion, VER);
  assert.ok(await B.local.getSyncState());
  assert.equal((await b.getAllPrefix('staticLots', ['outro-dev', VER])).length, 498);
  assert.equal((await b.getAllPrefix('dynamicLots', ['outro-dev'])).length, 498);
  // offline: B still boots from its cache, A is a first visit again
  env.online = false;
  const B2 = await env.hybrid(b, 'outro-dev');
  await B2.repo.load();
  assert.equal(B2.source.origin, 'CACHE');
  assert.ok(B2.repo.lotsSync().every(l => l.identity.id.startsWith('OD-')));
  await assert.rejects((await env.hybrid(b, 'viva-juara')).repo.load(), e => e.code === 'FIRST_VISIT_OFFLINE');
});

test('multi-development isolation: a snapshot cached for one development fails validation under another', async () => {
  const env = makeEnv(), b = env.idb(), O = env.App.offline, L = env.App.lifecycle;
  const repo = env.App.repos.LotRepository('viva-juara'); await repo.load();
  const a = O.LocalCacheRepository('dev-a', b), c = O.LocalCacheRepository('dev-c', b);
  await a.putStaticSnapshot(L.snapshot('static', 'dev-a', { staticDataVersion: 'v1' }, repo.getLayers().static.lots));
  await a.activate('static', 'v1');
  assert.equal(await c.getStaticSnapshot('v1'), null);
  assert.equal(await c.getManifest(), null);
  // rows copied under the other namespace are refused (development mismatch)
  const meta = await b.get('metadata', 'dev-a:static:v1');
  const rows = await b.getAllPrefix('staticLots', ['dev-a', 'v1']);
  await b.write([{ op: 'put', store: 'metadata', value: { ...meta, key: 'dev-c:static:v1' } }, ...rows.map(r => ({ op: 'put', store: 'staticLots', value: { ...r, developmentId: 'dev-c' } }))]);
  await assert.rejects(c.getStaticSnapshot('v1'), e => e.code === 'CACHE_CORRUPT' && /DEVELOPMENT_MISMATCH/.test(e.message));
  await c.clear();
  assert.equal((await b.getAllPrefix('staticLots', ['dev-a', 'v1'])).length, 498);
  assert.equal((await a.getManifest()).currentStaticVersion, 'v1');
});

// ------------------------------------------------------------------ user state
function sanitizeCtx(App, repo) {
  const resolve = ref => repo.resolve(ref); resolve.blockExists = blk => repo.getBlocks().includes(blk);
  return { resolve, filterKeys: Object.keys(App.services.filtering.EMPTY), statuses: App.enums.AVAILABILITY_ORDER, layers: App.services.layers.DEFS.map(d => d.id),
    backgrounds: ['plan', 'aerial', 'hybrid'], plans: repo.commercialRepo.getPriceTable().plans.map(p => p.id), scoreKeys: ['housing', 'investment', 'family', 'premium', 'overall'], map: App.config.DEVELOPMENTS[0].map };
}

test('store.sanitize: unknown lots, filters, layers, plans and viewport are dropped; short codes resolved to ids', async () => {
  const App = load();
  const repo = App.repos.LotRepository('viva-juara'); await repo.load();
  const S = App.store;
  S.set({ currentLotId: 'B79', comparisonLotIds: [B79, 'NOPE-1', 'A1', B79], favorites: ['Z999', 'b79'], activeFilters: { statuses: ['SOLD', 'BOGUS'], oldFilter: 3, block: 'ZZ', areaMin: 300 },
    activeMapLayer: 'bogus-layer', backgroundLayer: 'satellite', scoreKey: 'luck', simulation: { downPaymentPct: 150, planId: 'P999' }, mapViewport: { k: 0, x: 1, y: 1 } }, { silent: true });
  const dropped = plain(S.sanitize(sanitizeCtx(App, repo)));
  const st = S.get();
  assert.equal(st.currentLotId, B79);
  assert.deepEqual(plain(st.comparisonLotIds), [B79, 'VJ-QA-L0001']);
  assert.deepEqual(plain(st.favorites), [B79]);
  assert.deepEqual(plain(st.activeFilters), { statuses: ['SOLD'], areaMin: 300 });
  assert.equal(st.activeMapLayer, null);
  assert.equal(st.backgroundLayer, null);
  assert.equal(st.scoreKey, 'housing');
  assert.deepEqual(plain(st.simulation), plain(S.INITIAL.simulation));
  assert.equal(st.mapViewport, null);
  for (const d of ['comparisonLotIds', 'favorites', 'filter:oldFilter', 'filter:block', 'activeMapLayer', 'backgroundLayer', 'mapViewport']) assert.ok(dropped.includes(d), d);
  // a lot that no longer exists
  S.set({ currentLotId: 'VJ-QZ-L0001' }, { silent: true });
  assert.ok(plain(S.sanitize(sanitizeCtx(App, repo))).includes('currentLotId'));
  assert.equal(S.get().currentLotId, null);
  // valid state is kept as is
  S.set({ comparisonLotIds: [B79], favorites: [B79], activeFilters: { statuses: ['AVAILABLE'] }, activeMapLayer: App.services.layers.DEFS[0].id, simulation: { downPaymentPct: 20, planId: 'I18', expanded: false }, mapViewport: { k: 2, x: 10, y: 10 } }, { silent: true });
  assert.deepEqual(plain(S.sanitize(sanitizeCtx(App, repo))), []);
  assert.equal(S.get().simulation.planId, 'I18');
});

test('store.restore: per-development key and schema version; transient state (connectivity, origin) never restored', () => {
  const App = load(), S = App.store;
  S.storage.set(S.keyOf('viva-juara'), { v: S.STATE_VERSION, prefs: { favorites: [B79], connectivity: 'ONLINE', loadOrigin: 'CACHE', syncState: 'SUCCESS' }, session: { currentLotId: 'B79' } });
  const st = S.restore('viva-juara');
  assert.deepEqual(plain(st.favorites), [B79]);
  assert.equal(st.currentLotId, 'B79');
  assert.equal(st.connectivity, 'UNKNOWN');
  assert.equal(st.loadOrigin, null);
  assert.equal(st.syncState, 'IDLE');
  const App2 = load(), S2 = App2.store;
  S2.storage.set(S2.keyOf('viva-juara'), { v: 1, prefs: { favorites: [B79] } }); // incompatible version → discarded
  assert.deepEqual(plain(S2.restore('viva-juara').favorites), []);
  assert.notEqual(S.keyOf('viva-juara'), S.keyOf('outro-dev'));
});

// ------------------------------------------------------------------ client-mode wording
const MACHINE_KEYS = new Set(['code', 'freshness', 'status', 'dataStatus', 'type', 'severity', 'id', 'key', 'fieldKey', 'sourceId', 'method', 'confidence', 'rawValue', 'unit', 'priority',
  'kind', 'color', 'tone', 'state', 'whatsapp', 'lotId', 'src']);
const JARGON = /\bSTALE\b|\bCACHE\b|IndexedDB|\bcache\b|snapshot|checksum|\bFRESH\b|\bEXPIRED\b|Service Worker/i;
function displayedStrings(vm, out = [], key = '') {
  if (vm == null || typeof vm === 'function') return out;
  if (typeof vm === 'string') { if (!MACHINE_KEYS.has(key)) out.push(`${key}: ${vm}`); return out; }
  if (typeof vm !== 'object' || vm instanceof Set || vm instanceof Map || key === 'provenance') return out; // provenance: evidence object, rendered field by field

  for (const [k, v] of Object.entries(vm)) displayedStrings(v, out, Array.isArray(vm) ? key : k);
  return out;
}
async function offlineClientFixture() {
  const env = makeEnv(), b = env.idb();
  await env.seed(b);
  env.online = false;
  const h = await env.hybrid(b);
  await h.repo.load();
  const at = new Date(Date.now() - 3 * 3600e3).toISOString();
  assert.equal(h.repo.applyAvailabilityFeed({ B79: { status: 'AVAILABLE' }, A1: { status: 'RESERVED', reservedUntil: '2026-12-01T00:00:00Z' }, A2: { status: 'BLOCKED', reason: 'LEGAL_HOLD' }, A3: { status: 'SOLD' }, A4: { status: 'PROPOSAL' } }, { updatedAt: at }).applied, true);
  h.repo.touch('availability', { stale: true }); // cannot be confirmed offline
  const App = env.App, devCfg = App.repos.DevelopmentRepository.getDevelopmentConfig('viva-juara');
  const sel = App.selectors(h.repo, devCfg), st = { ...App.store.INITIAL, dataRevision: 1, preferences: { quiet: 3, privacy: 2 } };
  const ctx = { cfg: devCfg.presentation, mode: 'client', objective: null, prefs: st.preferences, ranking: sel.selectRanking(st), favorites: new Set(), compareIds: [], filteredIds: sel.selectFilteredLotIds(st),
    dev: devCfg, priceTable: h.repo.commercialRepo.getPriceTable(), openSections: { summary: true }, simulation: st.simulation };
  return { env, h, App, ctx };
}

test('client mode: status, price, quick view, comparison, simulation, share and connectivity never show technical jargon', async () => {
  const { h, App, ctx } = await offlineClientFixture();
  const lots = h.repo.lotsSync(), V = App.vm, out = [];
  assert.equal(h.repo.getFreshness().commercial, 'STALE');
  assert.equal(h.repo.getLotById(B79).availability.freshness, 'STALE');
  for (const l of lots) { displayedStrings(V.statusVM(l, 'client'), out); out.push(String(V.priceNote(l, 'client'))); displayedStrings(V.tooltipVM(l, ctx), out); }
  const sample = ['B79', 'A1', 'A2', 'A3', 'A4', 'A5', 'C10'].map(c => h.repo.getLotByCode(c));
  for (const l of sample) {
    displayedStrings(V.quickViewVM(l, ctx), out);
    displayedStrings(V.simulationVM(l, ctx), out);
  }
  displayedStrings(V.comparisonVM(sample.slice(0, 4), ctx), out);
  displayedStrings(V.shareVM(sample, ctx), out);
  for (const connectivity of ['ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN']) for (const state of ['IDLE', 'SYNCING', 'SUCCESS', 'PARTIAL', 'ERROR', 'OFFLINE'])
    for (const commercial of ['FRESH', 'STALE', 'EXPIRED', 'UNKNOWN']) {
      const vm = V.connectivityVM({ connectivity, sync: { state, lastSuccessfulSyncAt: new Date().toISOString() }, freshness: { commercial, availability: 'STALE' }, mode: 'client', loadOrigin: 'CACHE' });
      assert.equal(vm.indicator, null, 'no sync indicator for clients');
      displayedStrings(vm, out);
    }
  assert.ok(out.length > 1000);
  const bad = out.filter(s => JARGON.test(s));
  assert.deepEqual([...new Set(bad)], []);
  // the client wording that replaces it is present
  assert.ok(out.some(s => /sujeit[oa] a confirmação/.test(s)));
  // and the broker view does name the cached origin (the check above is not vacuous)
  const broker = V.connectivityVM({ connectivity: 'ONLINE', sync: { state: 'IDLE' }, freshness: {}, mode: 'broker', loadOrigin: 'CACHE' });
  assert.match(broker.indicator.text, /salvos neste aparelho/);
});

// BUG domain/model.js:172 and :177 — the registry "meaning" of availability.status ("UNKNOWN nunca vira AVAILABLE") and
// availability.freshness ("FRESH, STALE ou UNKNOWN … snapshot de disponibilidade") is shown to clients: fieldVM.helpText
// (presentation/viewmodels.js:52, rendered as "O que é" in panels.js:150) and the client glossary (overlays.js:53).
test('client mode: field help texts and glossary never show technical jargon',
  {}, async () => {
    const { h, App, ctx } = await offlineClientFixture();
    const out = [];
    for (const c of ['B79', 'A1', 'A2']) displayedStrings(App.vm.detailsVM(h.repo.getLotByCode(c), ctx), out);
    displayedStrings(App.vm.glossary(['geometry.areaM2', 'commercial.price', 'availability.status', 'environmental.noiseLevel', 'environmental.privacyLevel', 'mobility.estimatedTraffic', 'environmental.northSunSide', 'surroundings.rearNeighborType']), out);
    const bad = out.filter(s => JARGON.test(s) || /\b(UNKNOWN|AVAILABLE)\b/.test(s));
    assert.deepEqual([...new Set(bad)], []);
  });
