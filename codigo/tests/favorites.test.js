'use strict';
// Topic 38 — favorites as a formal domain. Golden scenarios named after the spec (§566).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
require('./node_modules/fake-indexeddb/auto');
const { load, SRC } = require('./harness.js');

let App, F, repo, lots, byCode;
const DEV = 'viva-juara', ORG = 'house7';
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m);
const clone = l => JSON.parse(JSON.stringify(l));
test.before(async () => {
  App = load();
  for (const f of ['datastate/dataState.js', 'favorites/favorites.js', 'presentation/favoritesView.js']) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  F = App.favorites; repo = App.repos.LotRepository(DEV); await repo.load(); lots = repo.lotsSync(); byCode = c => repo.getLotByCode(c);
});
let tick = 0;
const clock = () => `2026-10-09T10:${String(Math.floor(tick / 60) % 60).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}.000Z`;
/** a service over the real repository with optional per-lot overrides (sold, price change, deleted…) */
function svc(o = {}) {
  const over = o.over || {}, gone = new Set(o.gone || []), calls = { batch: 0, single: 0 };
  const resolveLot = ref => { calls.single++; const l = repo.resolve(ref); if (!l || gone.has(l.identity.id)) return null; return over[l.identity.id] ? over[l.identity.id](clone(l)) : l; };
  const resolveLots = ids => { calls.batch++; return ids.map(id => { const l = repo.resolve(id); if (!l || gone.has(id)) return null; return over[id] ? over[id](clone(l)) : l; }); };
  const s = F.createService({ organizationId: o.org || ORG, userId: o.user || 'U12', developmentId: DEV, backend: o.backend || F.memoryBackend(), resolveLot, resolveLots, now: clock, remote: o.remote, authorize: o.authorize, deviceId: o.deviceId });
  s.calls = calls; return s;
}
const idOf = c => byCode(c).identity.id;
const memStorage = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, dump: () => m }; };

// ---------------------------------------------------------------- identity, idempotency, lifecycle
test('PersonalFavoriteFromMap: FavoriteRecord ACTIVE with canonical lot id, tenant + user scope, source MAP, LOCAL_ONLY before a backend', async () => {
  const s = await svc().ready, r = s.add('B79', { source: 'MAP' });
  assert.equal(r.ok, true); assert.equal(r.created, true);
  const f = r.favorite; assert.equal(f.entityId, idOf('B79')); assert.equal(f.entityType, 'LOT'); assert.equal(f.organizationId, ORG); assert.equal(f.userId, 'U12'); assert.equal(f.developmentId, DEV);
  assert.equal(f.contextType, 'PERSONAL'); assert.equal(f.lifecycleStatus, 'ACTIVE'); assert.equal(f.source, 'MAP'); assert.equal(f.recordRevision, 1); assert.equal(f.syncState, 'LOCAL_ONLY'); assert.equal(f.snapshotRef, null);
  assert.equal(byCode('B79').isFavorite, undefined, 'canonical Lot untouched (no isFavorite)'); assert.ok(!('favorite' in byCode('B79')));
});
test('PersonalFavoriteFromQuickView + idempotency: same lot/user/context → one active record; add twice, remove twice, idempotencyKey replay', async () => {
  const s = await svc().ready, a = s.add('A1', { source: 'QUICK_VIEW', idempotencyKey: 'k1' }), b = s.add(idOf('A1'));
  assert.equal(b.existing, true); assert.equal(b.favorite.id, a.favorite.id); assert.equal(s.list().items.length, 1);
  assert.equal(s.add('A1', { idempotencyKey: 'k1' }).idempotent, true);
  const r1 = s.remove('A1'), r2 = s.remove('A1');
  assert.equal(r1.ok, true); assert.equal(r1.favorite.lifecycleStatus, 'REMOVED'); assert.equal(r2.ok, true); assert.equal(r2.unchanged, true); assert.equal(r2.code, 'FAVORITE_ALREADY_REMOVED');
  assert.equal(s.remove('A2').ok, true, 'removing a never-favorited lot does not fail');
  const re = s.add('A1'); assert.equal(re.reactivated, true); assert.equal(re.favorite.id, a.favorite.id, 'same logical record reactivated'); assert.equal(re.favorite.recordRevision, 3);
  deq(s.transitions().map(t => [t.fromStatus, t.toStatus, t.reasonCode]), [[null, 'ACTIVE', 'USER_ADDED'], ['ACTIVE', 'REMOVED', 'USER_REMOVED'], ['REMOVED', 'ACTIVE', 'USER_RESTORED']]);
  assert.equal(s.add('ZZ999').code, 'FAVORITE_ENTITY_NOT_FOUND'); assert.equal(s.list().items.length, 1);
  assert.equal(s.validate(new Set(lots.map(l => l.identity.id))).ok, true);
});
test('CustomerFavoriteContext + SameLotPersonalAndCustomerFavorite: contexts coexist; contextRef is an opaque id (no PII); explicit copy', async () => {
  const s = await svc().ready, cust = { type: 'CUSTOMER', ref: 'C55', label: 'Favoritos de Maria' };
  const p = s.add('B79'), c = s.add('B79', { context: cust, source: 'CLIENT_PROFILE' });
  assert.notEqual(p.favorite.id, c.favorite.id); assert.equal(c.favorite.contextRef, 'C55'); assert.equal(s.list().items.length, 2);
  assert.equal(s.list({ context: cust }).items.length, 1); assert.equal(s.list({ context: F.PERSONAL }).items.length, 1);
  assert.equal(s.add('A1', { context: { type: 'CUSTOMER', ref: 'maria@example.com' } }).code, 'FAVORITE_INVALID_CONTEXT', 'emails/names are never a contextRef');
  assert.equal(s.add('A1', { context: { type: 'CUSTOMER' } }).code, 'FAVORITE_INVALID_CONTEXT');
  assert.ok(!JSON.stringify(c.favorite).includes('Maria'), 'context label is UI state, not persisted');
  const cp = s.copyToContext(p.favorite.id, { type: 'CUSTOMER', ref: 'C77' }); assert.equal(cp.ok, true); assert.equal(s.get(p.favorite.id).lifecycleStatus, 'ACTIVE', 'personal stays');
  assert.equal(s.isFavorite(idOf('B79'), { type: 'CUSTOMER', ref: 'C77' }), true);
  // customer archived later (topic 39): the favorite is retained, its context resolution is reported
  const rm = s.readModels(s.list({ context: cust }).items, { contextResolver: () => 'CONTEXT_ARCHIVED' }); assert.equal(rm[0].contextResolution, 'CONTEXT_ARCHIVED'); assert.equal(rm[0].isFavorite, true);
});
test('SESSION favorites are memory-only by default (never persisted)', async () => {
  const backend = F.memoryBackend(), s = await svc({ backend }).ready;
  s.add('A1', { context: { type: 'SESSION', ref: 'sess1' } }); s.add('A2'); await s.flush();
  const raw = await backend.load(s.namespace); assert.equal(raw.favorites.length, 1); assert.equal(raw.favorites[0].entityId, idOf('A2'));
  assert.equal(s.isFavorite(idOf('A1'), { type: 'SESSION', ref: 'sess1' }), true);
});

// ---------------------------------------------------------------- collections
test('FavoriteAddedToTwoCollections + remove from one: membership many-to-many; removing membership never unfavorites; archive keeps favorites', async () => {
  const s = await svc().ready, f = s.add('B79').favorite;
  const fin = s.createCollection({ title: 'Finalistas' }).collection, sab = s.createCollection({ title: 'Mostrar sábado' }).collection;
  assert.equal(fin.visibility, 'PRIVATE', 'private by default'); assert.equal(fin.lifecycleStatus, 'ACTIVE');
  s.addToCollection(fin.id, f.id); s.addToCollection(sab.id, f.id); assert.equal(s.addToCollection(fin.id, f.id).existing, true, 'duplicate membership is idempotent');
  deq(s.get(f.id).collectionIds, [fin.id, sab.id]);
  s.removeFromCollection(fin.id, f.id);
  assert.equal(s.get(f.id).lifecycleStatus, 'ACTIVE'); assert.equal(s.collectionItems(sab.id).length, 1); assert.equal(s.collectionItems(fin.id).length, 0);
  s.archiveCollection(sab.id); assert.equal(s.get(f.id).lifecycleStatus, 'ACTIVE'); assert.equal(s.listCollections().length, 1); assert.equal(s.listCollections({ includeArchived: true }).length, 2);
  s.deleteCollection(fin.id); assert.equal(s.get(f.id).lifecycleStatus, 'ACTIVE');
  assert.equal(s.addToCollection(fin.id, f.id).code, 'FAVORITE_COLLECTION_NOT_FOUND');
  assert.equal(s.addToCollection(sab.id, 'A2').code, 'FAVORITE_NOT_FOUND', 'collection does not favorite silently');
  assert.equal(s.addToCollection(sab.id, 'A2', { ensureFavorite: true }).ok, true); assert.equal(s.isFavorite(idOf('A2')), true);
  assert.equal(s.createCollection({ title: 'Pública', visibility: 'LINK_SHARED' }).ok, true);
  const noShare = await svc({ authorize: p => p !== F.PERMISSIONS.share }).ready; assert.equal(noShare.createCollection({ title: 'X', visibility: 'LINK_SHARED' }).code, 'FAVORITE_PERMISSION_DENIED');
});
test('FavoriteRemovedButCollectionPreservedHistorically: live view hides removed favorites, historical view keeps them; manual reorder', async () => {
  const s = await svc().ready, c = s.createCollection({ title: 'Opções para João', contextType: 'CUSTOMER', contextRef: 'C55' }).collection;
  const a = s.add('A1').favorite, b = s.add('A2').favorite, d = s.add('A3').favorite; [a, b, d].forEach(f => s.addToCollection(c.id, f.id));
  assert.equal(s.reorder(c.id, [d.id, a.id, b.id]).ok, true); deq(s.collectionItems(c.id).map(x => x.favorite.id), [d.id, a.id, b.id]);
  assert.equal(s.reorder(c.id, [d.id, a.id]).code, 'FAVORITE_INVALID_ORDER'); assert.equal(s.getCollection(c.id).recordRevision, 2);
  deq(s.list({ collectionId: c.id, sort: 'MANUAL' }).items.map(f => f.id), [d.id, a.id, b.id]);
  s.remove(a.id);
  deq(s.collectionItems(c.id).map(x => x.favorite.id), [d.id, b.id]); deq(s.collectionItems(c.id, { live: false }).map(x => x.favorite.id), [d.id, a.id, b.id]);
  assert.equal(s.renameCollection(c.id, 'Novo', { expectedRevision: 1 }).code, 'FAVORITE_REVISION_CONFLICT');
});
test('FavoriteCollectionSnapshotShare: snapshot freezes membership and refs; share projection has no notes, no owner, no context ref', async () => {
  const s = await svc().ready, c = s.createCollection({ title: 'Mostrar sábado', visibility: 'CUSTOMER_SHARED' }).collection;
  const f = s.add('B79', { note: 'cliente prefere fundos para a mata (interno)' }).favorite; s.addToCollection(c.id, f.id, { note: 'mostrar primeiro' }); s.addToCollection(c.id, s.add('A1').favorite.id);
  const snap = s.snapshotCollection(c.id, { purpose: 'PRESENTATION' }).snapshot;
  assert.equal(snap.itemRefs.length, 2); assert.equal(snap.itemRefs[0].lotId, idOf('B79')); assert.equal(snap.itemRefs[0].priceTableVersionId, '2026-10-06'); assert.equal(snap.itemRefs[0].availabilityStatus, 'UNKNOWN');
  s.remove(f.id); assert.equal(snap.itemRefs.length, 2, 'old snapshot reproducible'); assert.equal(s.snapshotCollection(c.id).snapshot.itemRefs.length, 1, 'live collection follows current state');
  assert.match(snap.checksum, /^[0-9a-f]{8}$/);
  const sh = s.shareProjection(c.id).projection, txt = JSON.stringify(sh);
  assert.ok(!/interno|mostrar primeiro|U12|ownerUserId|note/.test(txt)); deq(Object.keys(sh), ['title', 'snapshotChecksum', 'items']);
  const priv = s.createCollection({ title: 'Privada' }).collection; assert.equal(s.shareProjection(priv.id).code, 'FAVORITE_PERMISSION_DENIED', 'no accidental public link');
});

// ---------------------------------------------------------------- live state, read models
test('SoldLotRemainsFavorite / blocked / unknown availability / unknown price: favorite stays ACTIVE with the current status', async () => {
  const b79 = idOf('B79'), a1 = idOf('A1'), a2 = idOf('A2');
  const s = await svc({ over: { [b79]: l => { l.availability.status = 'SOLD'; return l; }, [a1]: l => { l.availability.status = 'BLOCKED'; return l; }, [a2]: l => { l.commercial.price = null; return l; } } }).ready;
  ['B79', 'A1', 'A2', 'A3'].forEach(c => s.add(c));
  const rms = s.readModels(s.list().items), by = Object.fromEntries(rms.map(r => [r.lotId, r]));
  assert.equal(by[b79].isFavorite, true); assert.equal(by[b79].currentAvailability.label, 'Vendido'); assert.ok(by[b79].stateFlags.includes('SOLD')); assert.ok(by[b79].warnings.includes('FAVORITE_ENTITY_SOLD'));
  assert.ok(by[a1].stateFlags.includes('UNAVAILABLE')); assert.ok(by[a1].warnings.includes('FAVORITE_ENTITY_BLOCKED'));
  assert.equal(by[idOf('A3')].currentAvailability.status, 'UNKNOWN'); assert.equal(by[idOf('A3')].currentAvailability.label, 'Status não confirmado');
  assert.ok(by[a2].stateFlags.includes('PRICE_UNKNOWN')); assert.notEqual(by[a2].currentCommercial.price, 0); assert.equal(by[a2].currentCommercial.price, null); assert.match(by[a2].currentCommercial.priceLabel, /Informação não disponível|Dado desconhecido/);
  assert.equal(s.list().items.every(f => f.lifecycleStatus === 'ACTIVE'), true);
  const sum = s.statusSummary(s.list().items); assert.equal(sum.sold, 1); assert.equal(sum.blocked, 1); assert.equal(sum.unknown, 2); assert.equal(sum.price.unknownCount, 1); assert.equal(sum.price.knownCount, 3); assert.ok(sum.price.min > 0);
  const html = App.favoritesView.list(s.listItems().items, { context: F.PERSONAL }); assert.match(html, /Vendido/); assert.match(html, /4 favoritos/); assert.match(html, /data-act="goLot"/);
});
test('FavoritePriceChanged / FavoriteAvailabilityChanged: change flags only against a captured baseline; never invented', async () => {
  const b79 = idOf('B79'); let price = byCode('B79').commercial.price, status = 'UNKNOWN';
  const s = await svc({ over: { [b79]: l => { l.commercial.price = price; l.availability.status = status; return l; } } }).ready;
  const withBase = s.add('B79', { snapshotRef: s.captureSnapshotRef(byCode('B79')) }).favorite, noBase = s.add('B79', { context: { type: 'CUSTOMER', ref: 'C1' } }).favorite;
  price = price + 10000; status = 'RESERVED';
  const [a, b] = s.readModels([s.get(withBase.id), s.get(noBase.id)]);
  assert.ok(a.stateFlags.includes('PRICE_CHANGED')); assert.ok(a.stateFlags.includes('STATUS_CHANGED')); assert.ok(a.stateFlags.includes('RESERVED')); assert.equal(a.currentCommercial.price, price, 'read model is live');
  assert.ok(!b.stateFlags.includes('PRICE_CHANGED') && !b.stateFlags.includes('STATUS_CHANGED'), 'no baseline → no change claimed');
  assert.equal(s.list().items.length, 2, 'price/status change never duplicates a favorite');
});
test('orphaned lot: not silently deleted; reported as ENTITY_NOT_FOUND / ORPHANED', async () => {
  const gone = [idOf('A3')], s0 = await svc().ready; s0.add('A3'); const rec = s0.list().items[0];
  const s = await svc({ gone }).ready; const rm = s.readModels([rec])[0];
  assert.equal(rm.entityResolution, 'ENTITY_NOT_FOUND'); assert.ok(rm.stateFlags.includes('ORPHANED')); assert.equal(rm.currentCommercial.priceLabel, 'Lote não encontrado na versão atual');
  assert.equal(s0.validate(new Set(lots.map(l => l.identity.id).filter(id => id !== gone[0]))).warnings[0].code, 'FAVORITE_ORPHANED_ENTITY');
  assert.equal(s0.list().items.length, 1);
});
test('read models are batched (no N+1), sorted by current price with unknown LAST (topic 37), client projection hides notes/ids', async () => {
  const a2 = idOf('A2'), s = await svc({ over: { [a2]: l => { l.commercial.price = null; return l; } } }).ready;
  const codes = ['A1', 'A2', 'A3', 'A4', 'A5', 'B79']; codes.forEach(c => s.add(c, { note: 'nota ' + c }));
  s.calls.batch = 0; s.calls.single = 0;
  const items = s.listItems({ sort: 'CURRENT_PRICE_ASC' }).items;
  assert.equal(s.calls.batch, 1); assert.equal(s.calls.single, 0, 'one batch request for 6 favorites');
  assert.equal(items[items.length - 1].lotId, a2, 'unknown price last, not cheapest'); const prices = items.slice(0, -1).map(i => byCode(lots.find(l => l.identity.id === i.lotId).identity.code).commercial.price);
  assert.deepEqual(prices, [...prices].sort((x, y) => x - y));
  assert.equal(s.listItems({ sort: 'CURRENT_PRICE_DESC' }).items.slice(-1)[0].lotId, a2);
  const client = s.readModels(s.list().items, { mode: 'CLIENT' }); assert.ok(client.every(r => r.notePreview === undefined && r.favoriteId === undefined && r.favoriteContext.ref === null)); deq(client[0].actions, []);
  const tech = s.readModels(s.list().items, { mode: 'TECHNICAL' })[0]; assert.equal(tech.technical.syncState, 'LOCAL_ONLY');
  assert.equal(s.readModels(s.list().items)[0].notePreview.startsWith('nota'), true, 'internal mode shows the note preview');
  deq(s.listItems({ sort: 'LOT_ID' }).items.map(i => i.lotId), [...s.list().items.map(f => f.entityId)].sort((x, y) => x.localeCompare(y, 'pt-BR', { numeric: true })));
});

// ---------------------------------------------------------------- separation from other domains
test('favorite does not change Recommendation, Fit, Availability, winner or the canonical Lot; selection/comparison are not favorites', async () => {
  const before = JSON.stringify(lots.slice(0, 20)), st0 = lots.map(l => l.availability.status).join();
  const pol = App.recommendation.policyOf(DEV);
  const rec = () => JSON.stringify(App.recommendation.recommend ? App.recommendation.recommend({ lots, constraints: [], policy: pol, fit: null, developmentId: DEV }) : null);
  const r0 = (() => { try { return rec(); } catch (e) { return 'n/a'; } })();
  const s = await svc().ready; lots.slice(0, 30).forEach(l => s.add(l.identity.id));
  assert.equal(JSON.stringify(lots.slice(0, 20)), before); assert.equal(lots.map(l => l.availability.status).join(), st0);
  assert.equal((() => { try { return rec(); } catch (e) { return 'n/a'; } })(), r0);
  for (const f of ['intelligence/recommendation.js', 'intelligence/fit.js', 'compare/criterionWinner.js', 'services/scoring.js', 'domain/availability.js']) assert.ok(!/favorit/i.test(fs.readFileSync(path.join(SRC, f), 'utf8')), f + ' does not read favorites');
  // store: currentLotId and comparisonLotIds are never migrated to favorites
  const storage = memStorage({ 'vj-sel': JSON.stringify('A1'), 'ws:viva-juara:state': JSON.stringify({ v: 3, savedAt: '2026-10-01T00:00:00.000Z', prefs: { favorites: [] }, session: { currentLotId: idOf('A1'), comparisonLotIds: [idOf('A2'), idOf('A3')] } }) });
  const m = await F.migrateLegacy(await svc().ready, { storage, resolveLot: repo.resolve });
  assert.equal(m.migrated, 0);
});

// ---------------------------------------------------------------- legacy migration (lossless) + old store API
test('FavoriteLegacyMigration + FavoriteLegacyUnknownLot: legacy arrays (short codes and ids) → PERSONAL / MIGRATION; unknown ids reported, not lost; idempotent', async () => {
  const storage = memStorage({ 'vj-favs': JSON.stringify(['B79', 'A1', 'Q99-L999']), 'ws-state': JSON.stringify({ v: 2, s: { developmentId: DEV, favorites: [idOf('A1'), 'A2'] } }),
    'ws:viva-juara:state': JSON.stringify({ v: 3, savedAt: '2026-10-01T12:00:00.000Z', prefs: { favorites: [idOf('A3'), 'VJ-QZ-L0999'] }, session: {} }) });
  const backend = F.memoryBackend(), s = await svc({ backend }).ready;
  const rep = await F.migrateLegacy(s, { storage, resolveLot: repo.resolve });
  assert.equal(rep.completed, true); assert.equal(rep.migrated, 4); assert.equal(rep.duplicates, 1); assert.equal(rep.legacyCount, 7);
  deq(rep.unresolved.map(u => [u.code, u.legacyRef]).sort(), [['UNRESOLVED_LEGACY_FAVORITE', 'Q99-L999'], ['UNRESOLVED_LEGACY_FAVORITE', 'VJ-QZ-L0999']]);
  const items = s.list({ sort: 'OLDEST_FIRST' }).items; assert.ok(items.every(f => f.source === 'MIGRATION' && f.contextType === 'PERSONAL'));
  deq(new Set(items.map(f => f.entityId)), new Set([idOf('A3'), idOf('A1'), idOf('A2'), idOf('B79')]));
  assert.equal(items.find(f => f.entityId === idOf('A3')).createdAt, '2026-10-01T12:00:00.000Z', 'legacy savedAt preserved'); assert.equal(items.find(f => f.entityId === idOf('B79')).metadata.timestampSource, 'MIGRATION_TIME');
  assert.equal(s.migrationVersion(), 1); assert.equal(s.unresolvedLegacy().length, 2, 'kept in the repository');
  const again = await F.migrateLegacy(s, { storage, resolveLot: repo.resolve }); assert.equal(again.skipped, true); assert.equal(s.list().items.length, 4, 'reload does not duplicate');
  const reloaded = await svc({ backend }).ready; assert.equal(reloaded.list().items.length, 4); assert.equal(reloaded.migrationVersion(), 1);
  assert.equal((await F.migrateLegacy(reloaded, { storage, resolveLot: repo.resolve })).skipped, true);
  assert.equal(s.diagnostics().legacyMigratedCount, 4); assert.equal(s.diagnostics().unresolvedLegacyCount, 2);
});
test('migration marker only after a successful import: a failing backend keeps the migration pending', async () => {
  const bad = { kind: 'broken', load: async () => null, save: async () => { throw new Error('quota'); }, remove: async () => {} };
  const s = await svc({ backend: bad }).ready, rep = await F.migrateLegacy(s, { storage: memStorage({ 'vj-favs': JSON.stringify(['B79']) }), resolveLot: repo.resolve });
  assert.equal(rep.completed, false); assert.equal(rep.error, 'PERSIST_FAILED'); assert.equal(s.migrationVersion(), 0);
});
test('store.js keeps the legacy array API: restore captures the raw favorites before sanitize drops unknown ids → lossless migration; bindStore mirrors the projection', async () => {
  const A = load(); for (const f of ['datastate/dataState.js', 'favorites/favorites.js']) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(A);
  const r = A.repos.LotRepository(DEV); await r.load();
  const st = A.store; st.storage.set('vj-favs', ['B79', 'Q99-L999', 'A1']); st.restore(DEV);
  deq(st.get().favorites, ['B79', 'Q99-L999', 'A1']); deq(st.restoredFavorites().ids, ['B79', 'Q99-L999', 'A1']);
  st.sanitize({ resolve: Object.assign(x => r.resolve(x), { blockExists: () => true }), filterKeys: [], statuses: [], layers: [], backgrounds: [], plans: ['P144'], scoreKeys: ['housing'], map: { width: 1000, height: 1000 } });
  deq(st.get().favorites, [r.resolve('B79').identity.id, r.resolve('A1').identity.id], 'old behaviour: the store drops the unknown id …');
  const s = await A.favorites.createService({ organizationId: ORG, userId: 'U12', developmentId: DEV, backend: A.favorites.memoryBackend(), resolveLot: r.resolve, resolveLots: ids => ids.map(r.resolve), now: clock }).ready;
  const rep = await A.favorites.migrateLegacy(s, { restored: st.restoredFavorites(), resolveLot: r.resolve });
  assert.equal(rep.unresolved[0].legacyRef, 'Q99-L999', '… but the favorites domain kept and reported it'); assert.equal(rep.migrated, 2);
  const bridge = A.favorites.bindStore(st, s); await new Promise(res => setTimeout(res, 5));
  deq(st.get().favorites, s.setProjection().lotIds.slice());
  // old UI path: app.js toggleFav writes the array → becomes add/remove commands on the domain
  st.set({ favorites: [...st.get().favorites, r.resolve('A2').identity.id] }); await new Promise(res => setTimeout(res, 5));
  assert.equal(s.isFavorite(r.resolve('A2').identity.id), true);
  st.set({ favorites: st.get().favorites.filter(x => x !== r.resolve('B79').identity.id) }); await new Promise(res => setTimeout(res, 5));
  assert.equal(s.isFavorite(r.resolve('B79').identity.id), false); assert.equal(s.list({ lifecycleStatus: ['REMOVED'] }).items.length, 1, 'soft remove');
  // domain path updates the store array (map overlay, "Só favoritos", Quick View keep reading store.favorites)
  s.add('A3'); await new Promise(res => setTimeout(res, 5)); assert.ok(st.get().favorites.includes(r.resolve('A3').identity.id));
  // filters / comparison / selection changes never touch favorites
  const n = st.get().favorites.length; st.set({ activeFilters: { statuses: ['AVAILABLE'] }, comparisonLotIds: [], currentLotId: null, activeMapLayer: 'price' }); await new Promise(res => setTimeout(res, 5));
  assert.equal(st.get().favorites.length, n); assert.equal(s.list().items.length, n);
  bridge.unbind();
});

// ---------------------------------------------------------------- offline, sync, conflicts
test('FavoriteOfflineAddAndSync / FavoriteOfflineRemoveAndSync: queued locally, replayed in order, SYNCED with server revision', async () => {
  const remote = F.createMemoryRemote(), s = await svc({ remote }).ready;
  const f = s.add('B79').favorite; assert.equal(f.syncState, 'PENDING_UPLOAD'); assert.equal(s.pendingMutations().length, 1);
  s.add('A1'); s.remove('A1');
  const r = await s.sync(); assert.equal(r.ok, true); assert.equal(r.sent, 3); assert.equal(s.pendingMutations().length, 0);
  assert.equal(s.get(f.id).syncState, 'SYNCED'); assert.ok(s.get(f.id).serverRevision >= 1);
  assert.equal(remote.state(s.list({ lifecycleStatus: ['REMOVED'] }).items[0].id).lifecycleStatus, 'REMOVED');
  // offline: network failure keeps the queue, order preserved, retry later
  s.remove('B79'); const down = { apply: async () => { throw new Error('offline'); } };
  const r2 = await s.sync(down); assert.equal(r2.failed, 1); assert.equal(s.pendingMutations().length, 1); assert.equal(s.get(f.id).syncState, 'PENDING_DELETE');
  const r3 = await s.sync(remote); assert.equal(r3.sent, 1); assert.equal(remote.state(f.id).lifecycleStatus, 'REMOVED');
  assert.equal(s.diagnostics().pendingSyncCount, 0);
});
test('sync conflicts: note on top of a newer server write is NOT overwritten (NOTE_NOTE / DELETE_UPDATE); toggles follow server order', async () => {
  const remote = F.createMemoryRemote(), s = await svc({ remote }).ready, f = s.add('B79').favorite; await s.sync();
  remote.serverEdit(f.id, { note: 'nota do outro aparelho' }); // device B
  s.updateNote(f.id, 'nota deste aparelho');
  const r = await s.sync(); assert.equal(r.conflicts, 1); assert.equal(s.conflicts()[0].conflictType, 'NOTE_NOTE'); assert.equal(s.conflicts()[0].resolution, null);
  assert.equal(s.get(f.id).note, 'nota deste aparelho', 'local note kept'); assert.equal(remote.state(f.id).note, 'nota do outro aparelho', 'remote note kept'); assert.equal(s.get(f.id).syncState, 'CONFLICT');
  assert.equal(s.diagnostics().syncConflictCount, 1);
  s.resolveConflict(s.conflicts()[0].id, 'KEEP_LOCAL'); await s.sync(); assert.equal(remote.state(f.id).note, 'nota deste aparelho');
  // §647: device A removes, device B edits the note
  const g = s.add('A1').favorite; await s.sync(); remote.serverEdit(g.id, { lifecycleStatus: 'REMOVED' });
  s.updateNote(g.id, 'B editou'); await s.sync(); assert.equal(s.conflicts().slice(-1)[0].conflictType, 'DELETE_UPDATE');
  // toggle conflict: another device re-added after this device's base → server order wins, no client clock involved
  const h = s.add('A2').favorite; await s.sync(); remote.serverEdit(h.id, { lifecycleStatus: 'ARCHIVED' });
  s.remove(h.id); const t = await s.sync(); assert.equal(t.conflicts, 1); assert.equal(s.get(h.id).lifecycleStatus, 'ARCHIVED'); assert.equal(s.conflicts().slice(-1)[0].resolution, 'SERVER_REVISION');
  // optimistic concurrency on notes locally
  assert.equal(s.updateNote(h.id, 'x', { expectedRevision: 1 }).code, 'FAVORITE_REVISION_CONFLICT');
});
test('replay only under the same principal; a server permission rejection marks the mutation FAILED (never applied to another account)', async () => {
  const s = await svc({ remote: F.createMemoryRemote() }).ready; s.add('B79');
  assert.equal((await s.sync(undefined, { principal: { organizationId: ORG, userId: 'U99' } })).code, 'FAVORITE_USER_MISMATCH'); assert.equal(s.pendingMutations().length, 1);
  const deny = { apply: async () => ({ ok: false, code: 'FAVORITE_PERMISSION_DENIED' }) }, r = await s.sync(deny);
  assert.equal(r.failed, 1); assert.equal(s.pendingMutations()[0].error, 'FAVORITE_PERMISSION_DENIED'); assert.equal(s.list().items[0].syncState, 'ERROR');
});

// ---------------------------------------------------------------- tenancy, privacy, persistence
test('FavoriteTenantIsolation: same user in two organizations → separate namespaces; other users denied; tenant switch/logout leave no overlay', async () => {
  const backend = F.memoryBackend(), a = await svc({ backend, org: 'house7' }).ready, b = await svc({ backend, org: 'other-org' }).ready;
  a.add('B79'); await a.flush();
  assert.equal(b.list().items.length, 0); assert.equal(b.setProjection().lotIds.length, 0); assert.notEqual(a.namespace, b.namespace);
  assert.equal(a.list({ organizationId: 'other-org' }).code, 'FAVORITE_TENANT_MISMATCH');
  assert.equal(a.list({ userId: 'U77' }).code, 'FAVORITE_PERMISSION_DENIED', 'manager without favorite.readOthers is denied');
  const other = await svc({ backend, user: 'U77' }).ready; assert.equal(other.list().items.length, 0, 'another user does not see private favorites');
  const c = b.createCollection({ title: 'X' }).collection; assert.equal(a.addToCollection(c.id, a.list().items[0].id).code, 'FAVORITE_COLLECTION_NOT_FOUND', 'cross-tenant collection membership denied');
  assert.throws(() => F.createService({ organizationId: '', userId: 'U12', developmentId: DEV }), /principal/);
  await a.dispose({ purge: true }); assert.equal(a.add('A1').code, 'FAVORITE_PERMISSION_DENIED'); assert.equal(a.setProjection().lotIds.length, 0);
  assert.equal(await backend.load(a.namespace), null, 'logout with purge removes the namespace from the device');
  assert.equal((await svc({ backend, org: 'house7' }).ready).list().items.length, 0);
});
test('no PII and no notes in events; FavoriteSetProjection is light (ids only) and its cache key carries tenant/user/context/revision', async () => {
  const s = await svc().ready, evs = []; s.subscribe(e => evs.push(e));
  const f = s.add('B79', { note: 'telefone do cliente 11 9999-0000', context: { type: 'CUSTOMER', ref: 'C55' } }).favorite; s.updateNote(f.id, 'outra nota'); s.remove(f.id); s.restore(f.id);
  assert.ok(evs.length >= 3); assert.ok(evs.every(e => !JSON.stringify(e).includes('telefone') && !('note' in e)));
  deq(Object.keys(evs[0]).sort(), ['contextType', 'developmentId', 'favoriteId', 'lotId', 'organizationId', 'source', 'timestamp', 'type', 'userId']);
  const p = s.setProjection({ type: 'CUSTOMER', ref: 'C55' }); deq([...p.lotIds], [idOf('B79')]); assert.equal(typeof p.revision, 'string');
  const k1 = s.projectionCacheKey({ type: 'CUSTOMER', ref: 'C55' }); s.add('A1', { context: { type: 'CUSTOMER', ref: 'C55' } }); assert.notEqual(s.projectionCacheKey({ type: 'CUSTOMER', ref: 'C55' }), k1, 'mutation invalidates');
  assert.ok(k1.startsWith('house7|U12|CUSTOMER|C55|viva-juara|'));
  assert.equal(s.setProjection(F.PERSONAL).lotIds.length, 0, 'favorites filter is context-aware');
  // filter "Só favoritos" composes the id set (no isFavorite on the Lot)
  const FX = App.filters, q = FX.compile({ favoritesOnly: true }, { developmentId: DEV }), res = FX.run(lots, q.query || q, { policy: App.availability.DEFAULT_POLICY, favorites: new Set(p.lotIds), developmentId: DEV });
  deq([...res.matchedIds], [idOf('B79')]);
});
test('backends: IndexedDB persists the namespace across service instances; localStorage-like fallback; pickBackend order', async () => {
  const idb = F.idbBackend(indexedDB, 'fav-test-' + Date.now());
  const s1 = await svc({ backend: idb }).ready; s1.add('B79'); const c = s1.createCollection({ title: 'Finalistas' }).collection; s1.addToCollection(c.id, s1.list().items[0].id); await s1.flush();
  const s2 = await svc({ backend: idb }).ready; assert.equal(s2.list().items.length, 1); assert.equal(s2.collectionItems(c.id).length, 1); assert.equal(s2.backendKind, 'indexeddb');
  const ls = memStorage(), s3 = await svc({ backend: F.storageBackend(ls) }).ready; s3.add('A1'); await s3.flush(); assert.ok(Object.keys(ls.dump())[0].startsWith('fav:v1:house7:U12:viva-juara'));
  assert.equal(F.pickBackend({ indexedDB }).kind, 'indexeddb'); assert.equal(F.pickBackend({ storage: ls }).kind, 'local-storage'); assert.equal(F.pickBackend().kind, 'memory');
});
test('UI: star toggle is a persistent, accessible toggle; empty states; undo uses the existing "fav" action (re-add = restore same record)', async () => {
  const V = App.favoritesView;
  const off = V.toggleButton({ lotId: 'VJ-QB-L0079', isFavorite: false }), on = V.toggleButton({ lotId: 'VJ-QB-L0079', isFavorite: true, contextLabel: 'Favoritos de Maria' });
  assert.match(off, /aria-pressed="false"/); assert.match(off, /aria-label="Adicionar lote aos favoritos"/); assert.match(off, /☆ Favoritar/);
  assert.match(on, /aria-pressed="true"/); assert.match(on, /Remover lote dos favoritos — Favoritos de Maria/); assert.match(on, /★ Favoritado/);
  assert.match(V.list([], {}), /Você ainda não favoritou nenhum lote/); assert.match(V.list([], { context: { type: 'CUSTOMER', ref: 'C1', label: 'Favoritos de Maria' } }), /Nenhum lote favoritado para este cliente/);
  assert.match(V.undoToast('VJ-QB-L0079'), /data-act="fav"/);
  const s = await svc().ready, f = s.add('B79').favorite; s.toggle('B79'); assert.equal(s.get(f.id).lifecycleStatus, 'REMOVED'); s.toggle('B79'); assert.equal(s.get(f.id).lifecycleStatus, 'ACTIVE'); assert.equal(s.list().items.length, 1);
  assert.ok(!/<script|localStorage/.test(fs.readFileSync(path.join(SRC, 'presentation/favoritesView.js'), 'utf8')));
  assert.match(V.list(s.listItems({}, { mode: 'CLIENT' }).items, { client: true }), /fav-list/);
});
