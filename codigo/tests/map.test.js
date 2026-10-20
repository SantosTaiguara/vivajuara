'use strict';
// Map layers (topic 18), smart legend (19), Lot Quick View (20), mobile bottom sheet (21) and the map deep link.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness.js');
let App, repo, lots, ML, LG, byCode, dev;
test.before(async () => {
  App = load(); repo = App.repos.LotRepository('viva-juara'); await repo.load();
  lots = repo.lotsSync(); ML = App.mapLayers; LG = App.legend; byCode = new Map(lots.map(l => [l.identity.code, l]));
  dev = App.repos.DevelopmentRepository.getDevelopmentConfig('viva-juara');
});
const SCORE_KEYS = ['housing', 'investment', 'family', 'premium', 'overall'];
const model = (layer, { layerState, ...extra } = {}) => ML.buildRenderModel({ developmentId: 'viva-juara', lots, mode: 'broker', filter: { active: false }, freshness: repo.getFreshnessState(), dataVersions: {},
  layerState: { ...ML.defaultState(), primaryLayerId: layer, ...(layerState || {}) }, ...extra });
const fitFor = prefs => { const p = App.fit.buildProfile({ preferences: prefs }); return new Map(App.fit.fitLots(p, lots, App.fit.cfgOf('viva-juara')).map(f => [f.lotId, f])); };

// ------------------------------------------------------------------ topic 18: layers
test('layer parity: every lot keeps exactly the colour of the previous layer service', () => {
  const LY = App.services.layers;
  for (const d of LY.DEFS) for (const sk of d.id === 'score' ? SCORE_KEYS : ['housing']) {
    const old = LY.compute(d.id, lots, { scoreKey: sk }), m = model(d.id, { layerState: { layerSettings: { score: { scoreKey: sk } } } });
    for (const l of lots) assert.equal(m.lotStylesById.get(l.identity.id).fill, old.colorOf.get(l.identity.id), `${d.id}/${sk} ${l.identity.code}`);
  }
});
test('the scale is built on the full dataset: a filter dims lots but never changes bins or colours', () => {
  const matched = new Set(lots.filter(l => l.commercial.price != null && l.commercial.price <= 320000).map(l => l.identity.id));
  for (const layer of ['price', 'area', 'score', 'noise']) {
    const a = model(layer), b = model(layer, { filter: { active: true, matchedIds: matched } });
    assert.deepEqual(b.scale.items.map(i => [i.key, i.min, i.max, i.color]), a.scale.items.map(i => [i.key, i.min, i.max, i.color]), layer);
    for (const l of lots) {
      const sa = a.lotStylesById.get(l.identity.id), sb = b.lotStylesById.get(l.identity.id);
      assert.equal(sb.fill, sa.fill); assert.equal(sb.classes.includes('dim'), !matched.has(l.identity.id), `${layer} ${l.identity.code}`);
    }
  }
});
test('availability layer: UNKNOWN is never drawn or counted as AVAILABLE', () => {
  const m = model('availability'), lg = LG.build({ model: m, lots, filter: { active: false }, mode: 'broker', developmentId: 'viva-juara' });
  const items = new Map(lg.sections[0].items.map(i => [i.key, i]));
  const unknown = lots.filter(l => l.availability.status === 'UNKNOWN').length;
  assert.equal(items.get('AVAILABLE').totalCount, lots.filter(l => l.availability.status === 'AVAILABLE').length);
  assert.equal(items.get('UNKNOWN').totalCount, unknown);
  for (const l of lots) if (l.availability.status === 'UNKNOWN') assert.notEqual(m.values.get(l.identity.id).binKey, 'AVAILABLE');
});
test('fit layer needs a customer: unavailable (with reason) without one, falls back without changing anything', () => {
  const menu = ML.menu({ developmentId: 'viva-juara', mode: 'broker' }), fit = menu.groups.flatMap(g => g.items).find(i => i.id === 'fit');
  assert.ok(fit && fit.disabled && /cliente/i.test(fit.reason));
  const m = model('fit');
  assert.equal(m.layerError, 'LAYER_UNAVAILABLE'); assert.notEqual(m.primaryLayerId, 'fit');
  const withFit = model('fit', { fit: fitFor({ quiet: 3 }), fitKey: 'q3' });
  assert.equal(withFit.layerError, null); assert.equal(withFit.primaryLayerId, 'fit');
  for (const l of lots) assert.ok(withFit.values.get(l.identity.id).value == null || withFit.values.get(l.identity.id).value >= 0);
});
test('client mode hides technical layers and the URL state round-trips', () => {
  const ids = ML.menu({ developmentId: 'viva-juara', mode: 'client' }).groups.flatMap(g => g.items.map(i => i.id));
  for (const id of ids) assert.ok(ML.registry('viva-juara').get(id).clientVisible, id);
  const s = { ...ML.defaultState(), baseMapMode: 'AERIAL', primaryLayerId: 'noise' }, q = ML.serialize(s, ML.defaultState());
  const p = ML.parse(q); assert.equal(p.baseMapMode, 'AERIAL'); assert.equal(p.primaryLayerId, 'noise');
  assert.deepEqual(JSON.parse(JSON.stringify(ML.parse('base=nope&score=evil&layer=%%'))), {});
});

// ------------------------------------------------------------------ topic 19: legend
test('legend invariants: every lot is counted once (total and filtered) on every layer', () => {
  const matched = new Set(lots.filter((l, i) => i % 3 === 0).map(l => l.identity.id));
  for (const layer of ['availability', 'price', 'pricePerM2', 'area', 'class', 'score', 'noise', 'privacy', 'sun', 'forest', 'traffic', 'gate', 'leisure']) {
    const m = model(layer, { filter: { active: true, matchedIds: matched } }), lg = LG.build({ model: m, lots, filter: { active: true, matchedIds: matched }, mode: 'broker', developmentId: 'viva-juara' });
    const its = lg.sections[0].items;
    assert.equal(its.reduce((s, i) => s + i.totalCount, 0), lots.length, layer);
    assert.equal(its.reduce((s, i) => s + (i.filteredCount || 0), 0), matched.size, layer);
    assert.ok(lg.invariant.ok, layer);
    assert.deepEqual(its.filter(i => !i.bucket).map(i => i.color), m.scale.items.map(i => i.color), `${layer}: legend uses the map scale`);
  }
});
test('legend filter action selects exactly the lots of that bin (price and area)', () => {
  for (const layer of ['price', 'area']) {
    const m = model(layer), lg = LG.build({ model: m, lots, filter: { active: false }, mode: 'broker', developmentId: 'viva-juara' });
    for (const it of lg.sections[0].items.filter(i => i.filterAction)) {
      const got = App.filters.run(lots, App.filters.compile(it.filterAction.patch).query).matchedIds;
      const exp = lots.filter(l => m.values.get(l.identity.id).binKey === it.key).map(l => l.identity.id);
      assert.equal(got.size, exp.length, `${layer} ${it.key}`); for (const id of exp) assert.ok(got.has(id));
    }
  }
});
test('legend focus never changes filters; the selected lot is marked in its bin', () => {
  const st0 = { ...App.store.INITIAL, activeFilters: { priceMax: 400000 } }, f0 = JSON.stringify(st0.activeFilters);
  const s1 = LG.focus(LG.defaultState(), 'price', 'p0'); assert.equal(JSON.stringify(st0.activeFilters), f0); assert.ok(s1);
  const b79 = byCode.get('B79'), m = model('price', { selectedLotId: b79.identity.id });
  const lg = LG.build({ model: m, lots, filter: { active: false }, selectedLotId: b79.identity.id, mode: 'broker', developmentId: 'viva-juara' });
  const selected = lg.sections[0].items.filter(i => i.selected);
  assert.equal(selected.length, 1); assert.equal(selected[0].key, m.values.get(b79.identity.id).binKey);
});

// ------------------------------------------------------------------ topic 20: quick view
const vmCtx = (extra = {}) => ({ dev, cfg: dev.presentation, mode: 'broker', objective: dev.presentation.defaultObjective, prefs: {}, favorites: new Set(), compareIds: [], view: 'map', filterActive: false, connectivity: 'ONLINE', ...extra });
test('quick view: highlights are capped per mode and never repeat a topic', () => {
  const qcfg = App.configs.quickview['viva-juara'], fit = fitFor({ quiet: 3, privacy: 2 });
  for (const mode of ['client', 'broker', 'technical']) for (const l of lots.slice(0, 80)) {
    const vm = App.vm.quickViewVM(l, vmCtx({ mode, fitById: fit, customer: { id: 'working-profile', name: null } }));
    assert.ok(vm.highlights.length <= qcfg.modes[mode].maxHighlights, mode);
    assert.equal(new Set(vm.highlights.map(h => h.topic)).size, vm.highlights.length);
    for (const h of vm.highlights) assert.ok(!/: [a-z][A-Za-z]+$/.test(h.labelKey), `raw preference key in "${h.labelKey}"`);
  }
});
test('quick view in client mode: no internal codes, no technical freshness, no customer label without a name', () => {
  const l = byCode.get('B79'), vm = App.vm.quickViewVM(l, vmCtx({ mode: 'client', fitById: fitFor({ quiet: 3 }), customer: { id: 'working-profile', name: null } }));
  assert.equal(vm.freshness, null); assert.equal(vm.context.customerLabel, null);
  const visible = JSON.stringify([vm.highlights.map(h => h.labelKey), vm.alerts, vm.status, vm.actions.filter(a => a.visible).map(a => a.labelKey)]);
  assert.ok(!/\b(STALE|UNKNOWN|FRESH|EXPIRED|LAYER_|FIT_STRENGTH)\b/.test(visible.replace(/"(status|severity|type|reasonCode|code|key|id|freshness)":"[^"]*"/g, '')), visible.slice(0, 300));
  const fit = vm.customerFit; if (fit) assert.ok(!/probabilidade|chance de compra/i.test(JSON.stringify(fit)));
});
test('quick view: a lot outside the filters stays selectable and explains why', () => {
  const l = lots.find(x => x.commercial.price > 400000), q = App.filters.compile({ priceMax: 300000 }).query;
  const vm = App.vm.quickViewVM(l, vmCtx({ filterActive: true, filteredIds: new Set(), filterQuery: q, filterCtx: {} }));
  assert.ok(vm.outsideFilter && vm.outsideFilter.reasons.length >= 1); assert.equal(vm.outsideFilter.reasons[0].filterId, 'price'); assert.equal(vm.id, l.identity.id);
});

// ------------------------------------------------------------------ topic 21: mobile sheet
test('sheet snaps: slow release → nearest, flick → next in that direction, expanded leaves map visible', () => {
  const MS = App.mobileSheet, h = MS.heights(844);
  assert.ok(h.MINIMIZED < h.INTERMEDIATE && h.INTERMEDIATE < h.EXPANDED); assert.ok(844 - h.EXPANDED >= MS.SNAP_CONFIG.minMapVisibleHeight);
  assert.equal(MS.resolveSnapTarget(h.INTERMEDIATE + 20, 0, h), 'INTERMEDIATE');
  assert.equal(MS.resolveSnapTarget(h.MINIMIZED + 30, 0.9, h), 'INTERMEDIATE');
  assert.equal(MS.resolveSnapTarget(h.INTERMEDIATE - 10, -0.9, h), 'MINIMIZED');
  assert.equal(MS.resolveSnapTarget(h.EXPANDED, NaN, h), 'EXPANDED');
  const land = MS.heights(390, { orientation: 'landscape' }); assert.ok(390 - land.EXPANDED >= MS.SNAP_CONFIG.minMapVisibleHeight);
});
test('sheet behaviour: selecting opens to intermediate, back collapses before closing', () => {
  const MS = App.mobileSheet;
  assert.equal(MS.onLotSelect('MINIMIZED'), 'INTERMEDIATE'); assert.equal(MS.onLotSelect('EXPANDED'), 'EXPANDED');
  assert.deepEqual(JSON.parse(JSON.stringify(MS.onBack({ snap: 'EXPANDED' }))), { handled: true, snap: 'INTERMEDIATE' });
  assert.equal(MS.onBack({ snap: 'INTERMEDIATE' }).handled, false);
  const c = MS.coordinator(); c.setQuickSnap('INTERMEDIATE'); c.open('FILTERS');
  assert.equal(c.state().quickSnap, 'MINIMIZED'); c.close('FILTERS'); assert.equal(c.state().quickSnap, 'INTERMEDIATE');
});
test('camera: a lot behind the sheet is moved into the visible map; a visible lot is left alone', () => {
  const MS = App.mobileSheet, env = { mapWidth: 390, mapHeight: 713, sheetHeight: 342 };
  assert.equal(MS.fitLotIntoVisibleMapArea({ x0: 150, y0: 100, x1: 180, y1: 130 }, env), null);
  const d = MS.fitLotIntoVisibleMapArea({ x0: 80, y0: 500, x1: 110, y1: 530 }, env);
  assert.ok(d && 530 + d.dy <= 713 - 342); assert.ok(500 + d.dy >= 0);
  assert.equal(MS.fitLotIntoVisibleMapArea(null, env), null);
});

// ------------------------------------------------------------------ deep link
test('deep link round trip: lot, base map, layer and filters', () => {
  const b79 = byCode.get('B79'), codeOf = id => repo.getLotById(id).identity.displayCode.replace(/^Q([A-Z]+) L(\d+)$/, '$1$2');
  const s = { ...App.store.INITIAL, developmentId: 'viva-juara', currentLotId: b79.identity.id, backgroundLayer: 'aerial', activeMapLayer: 'noise', activeFilters: { areaMin: 300 } };
  const t = App.router.token(s, codeOf); assert.match(t, /\?/);
  const resolve = c => lots.find(l => codeOf(l.identity.id) === c);
  const p = App.router.parse('#' + t, resolve);
  assert.equal(p.currentLotId, b79.identity.id); assert.equal(p.backgroundLayer, 'aerial'); assert.equal(p.activeMapLayer, 'noise');
  assert.deepEqual(JSON.parse(JSON.stringify(p.activeFilters)), { areaMin: 300 });
  const bad = App.router.parse('#viva-juara.lots.B79?layer=x&f=%%%', resolve); assert.equal(bad.activeMapLayer, undefined);
});
test('focusing a status bucket ("Sem dado") highlights exactly the lots in that bucket', () => {
  const full = fitFor({ quiet: 3 }), part = new Map([...full].slice(0, 300));
  const m0 = model('fit', { fit: part, fitKey: 'part' }), lg = LG.build({ model: m0, lots, filter: { active: false }, mode: 'broker', developmentId: 'viva-juara' });
  const bucket = lg.sections[0].items.find(i => i.bucket); assert.ok(bucket, 'a partial Fit map produces a bucket item');
  const m = model('fit', { fit: part, fitKey: 'part', legendFocus: { layerId: 'fit', itemKey: bucket.key } });
  const focused = lots.filter(l => m.lotStylesById.get(l.identity.id).classes.includes('lfocus')).length;
  assert.equal(focused, bucket.totalCount); assert.ok(focused > 0 && focused < lots.length);
});

// ------------------------------------------------------------------ pending items round (2026-10-08)
test('legend hover: lotsForItem returns exactly the lots the map paints for that item, and never filters', () => {
  for (const layer of ['availability', 'price', 'area', 'noise', 'score']) {
    const m = model(layer), seen = new Set();
    for (const it of m.scale.items) {
      const ids = ML.lotsForItem(m, it.key, 'broker');
      for (const id of ids) { assert.equal(ML.itemKeyOf(m.values.get(id), 'broker'), it.key); assert.ok(!seen.has(id)); seen.add(id); }
    }
    for (const [id, v] of m.values) if (!seen.has(id)) assert.ok(v.binKey == null, `${layer}: ${id} has a bin but no item`);
  }
  assert.equal(ML.lotsForItem(null, 'x').length, 0);
});
test('an unavailable layer falls back to the previous layer before the development default', () => {
  const m = model('fit', { layerState: { previousPrimaryLayerId: 'price' } });
  assert.equal(m.layerError, 'LAYER_UNAVAILABLE'); assert.equal(m.primaryLayerId, 'price');
  const m2 = model('fit', { layerState: { previousPrimaryLayerId: 'fit' } });
  assert.equal(m2.primaryLayerId, ML.cfgOf('viva-juara').defaultPrimaryLayer);
  const st = ML.fromStore({ activeMapLayer: 'noise', previousMapLayer: 'area', mapOverlays: [] });
  assert.equal(st.previousPrimaryLayerId, 'area'); assert.equal(ML.toStorePatch(st).previousMapLayer, 'area');
});
test('quick view actions: one primary, at most two secondary, the rest under "Mais ações"; presentation keeps only primary and share', () => {
  const l = byCode.get('B79');
  for (const mode of ['broker', 'technical', 'client']) {
    const vm = App.vm.quickViewVM(l, vmCtx({ mode })), vis = vm.actions.filter(a => a.visible !== false);
    assert.equal(vis.filter(a => a.tier === 'PRIMARY').length, 1, mode);
    assert.ok(vis.filter(a => a.tier === 'SECONDARY').length <= 2, mode);
    assert.equal(vis[0].tier, 'PRIMARY');
  }
  const p = App.vm.quickViewVM(l, vmCtx({ mode: 'client', presentation: true }));
  assert.equal(p.context.mode, 'PRESENTATION');
  assert.deepEqual([...new Set(p.actions.map(a => a.id))].sort(), ['primary', 'share'].filter(id => p.actions.some(a => a.id === id)).sort());
  const nonClient = App.vm.quickViewVM(l, vmCtx({ mode: 'broker', presentation: true }));
  assert.notEqual(nonClient.context.mode, 'PRESENTATION', 'presentation applies only in client mode');
});
test('quick view: facts carry provenance; estimated fields are listed for the broker and hidden from the client', () => {
  const l = byCode.get('B79'), b = App.vm.quickViewVM(l, vmCtx({ mode: 'broker' })), c = App.vm.quickViewVM(l, vmCtx({ mode: 'client' }));
  for (const f of b.facts) assert.ok(typeof f.status === 'string' && f.status.length, f.label);
  assert.ok(!c.facts.some(f => f.label === 'Formato' || f.label === 'Frente'), 'client sees no technical facts');
  assert.equal(b.provenanceSummary.estimatedFields, b.provenanceSummary.estimatedKeys.length);
  for (const f of b.facts) if (f.label === 'Esquina' && l.geometry.isCorner == null) assert.equal(f.value, 'Não disponível');
});
test('quick view: low coverage uses the configured minimum coverage, not a hard-coded value', () => {
  const l = byCode.get('B79'), fit = fitFor({ quiet: 3, privacy: 2 }), f = fit.get(l.identity.id), cfg = App.fit.cfgOf('viva-juara');
  const vm = App.vm.quickViewVM(l, vmCtx({ fitById: fit, customer: { id: 'working-profile', name: null } }));
  const min = Number.isFinite(cfg.minCoverage) ? cfg.minCoverage : 0.5;
  if (vm.customerFit && f.coverage != null) assert.equal(vm.customerFit.lowCoverage, f.coverage < min);
});
