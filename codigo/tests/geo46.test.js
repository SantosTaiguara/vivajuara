'use strict';
// Topic 46 — geospatial map performance: geometry pipeline, validation, spatial index, hit testing, camera,
// LOD, budgets, repository. Golden scenarios named after the spec sections. Browser before/after measurements
// and native-hit parity live in docs/MAP_PERFORMANCE_BASELINE_REPORT.md (Playwright, not part of npm test).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

const DEV = 'viva-juara';
const GEO_MODULES = ['geo/geometry.js', 'geo/spatialIndex.js', 'geo/hitTest.js', 'geo/camera.js', 'geo/perf.js', 'geo/repository.js'];
let App, G, SI, HT, CAM, PERF, REPO, lots, dev, bundle, index, svc, polysBefore;
test.before(async () => {
  App = load();
  // not in the harness ORDER yet: load them the way the build will (one global App)
  for (const f of GEO_MODULES) if (!(App.geo && App.geo[path.basename(f, '.js')])) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  G = App.geo.geometry; SI = App.geo.spatialIndex; HT = App.geo.hitTest; CAM = App.geo.camera; PERF = App.geo.perf; REPO = App.geo.repository;
  const repo = App.repos.createLotRepository(DEV); await repo.load(); lots = repo.lotsSync();
  dev = App.repos.DevelopmentRepository.getDevelopment(DEV);
  polysBefore = JSON.stringify(lots.map(l => [l.identity.id, l.geometry.polygon, l.geometry.centroid, l.geometry.bounds]));
  bundle = G.buildBundle({ organizationId: dev.tenantId, developmentId: DEV, dev, lots, sourceGeometryVersion: dev.staticDataVersion });
  index = SI.build(bundle.features.filter(f => f.ring));
  svc = HT.create(bundle.features, index);
});
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg);
// deterministic PRNG for reproducible fuzzing
const rng = seed => () => ((seed = Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5 | 0) >>> 0) / 4294967296;
const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
const lotOf = (id, polygon) => ({ identity: { id, blockId: 'Z', lotNumber: id }, geometry: { polygon } });

test('§6/§7/§8 manifest: 498 features, versioned source/render geometry, explicit local CRS (no EPSG invented)', () => {
  const m = bundle.manifest;
  assert.equal(m.featureCount, 498); assert.equal(bundle.features.filter(f => f.geometryState === 'VALID').length, 498);
  assert.equal(m.developmentId, DEV); assert.equal(m.organizationId, dev.tenantId);
  assert.equal(m.sourceGeometryVersion, dev.staticDataVersion); assert.match(m.renderGeometryVersion, /^2026-10-06\.1\+quantize-0\.1@/);
  assert.equal(m.coordinateReference.type, 'PIXEL_SPACE'); assert.equal(m.coordinateReference.epsgCode, undefined); assert.equal(m.coordinateReference.metersPerUnitStatus, 'estimado');
  assert.equal(m.transform.transformType, 'IDENTITY'); assert.match(m.sourceChecksum, /^[0-9a-f]{8}$/); assert.match(m.renderChecksum, /^[0-9a-f]{8}$/);
  deq(m.developmentBounds, { minX: 0, minY: 0, maxX: dev.map.width, maxY: dev.map.height });
  const again = G.buildBundle({ organizationId: dev.tenantId, developmentId: DEV, dev, lots, sourceGeometryVersion: dev.staticDataVersion });
  assert.equal(again.manifest.sourceChecksum, m.sourceChecksum, 'checksum is deterministic'); assert.equal(again.manifest.renderChecksum, m.renderChecksum);
});

test('§6/§132 canonical geometry is never mutated; render path data is byte-identical to what the map always drew', () => {
  assert.equal(JSON.stringify(lots.map(l => [l.identity.id, l.geometry.polygon, l.geometry.centroid, l.geometry.bounds])), polysBefore);
  for (const l of lots) assert.equal(bundle.features.find(f => f.lotId === l.identity.id).pathData, 'M' + l.geometry.polygon.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z');
  // featureIndex is internal; every feature carries the canonical lot id
  assert.deepEqual(bundle.features.map(f => f.lotId), lots.map(l => l.identity.id));
});

test('§12/§13/§14 bbox, centroid and label anchor are precomputed; anchors lie inside their polygon', () => {
  for (const f of bundle.features) {
    const l = lots[f.featureIndex], b = l.geometry.bounds;
    assert.ok(Math.abs(f.bbox.minX - b.x) < 1e-6 && Math.abs(f.bbox.maxY - (b.y + b.h)) < 1e-6, `bbox ${f.lotId}`);
    deq(f.centroid, l.geometry.centroid);
    assert.ok(G.pointInRing(f.labelAnchor[0], f.labelAnchor[1], f.ring), `anchor inside ${f.lotId}`);
  }
  // concave lot: the centroid falls outside, the anchor does not
  const L = [[0, 0], [30, 0], [30, 4], [4, 4], [4, 30], [0, 30], [0, 0]], f = G.featureOf(lotOf('L', L), 0);
  assert.equal(G.pointInRing(f.centroid[0], f.centroid[1], f.ring), false); assert.equal(f.labelAnchorSource, 'POLYLABEL'); assert.ok(G.pointInRing(f.labelAnchor[0], f.labelAnchor[1], f.ring));
});

test('§15/§16 validation: real data clean; broken inputs are reported, never repaired or invented', () => {
  const v = G.validate(lots, { dev, features: bundle.features });
  assert.equal(v.ok, true); assert.equal(v.errors, 0); assert.equal(v.featureCount, 498);
  const bow = [[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]];
  const bad = [lotOf('A', square(10, 10, 5)), lotOf('A', square(30, 10, 5)), lotOf('B', []), lotOf('C', [[0, 0], [NaN, 1], [2, 2]]), lotOf('D', bow), lotOf('E', square(10, 10, 5)), lotOf('F', square(5000, 10, 5))];
  const r = G.validate(bad, { dev }), codes = r.issues.map(i => i.code + ':' + (i.lotId || '-'));
  for (const c of ['DUPLICATE_LOT_ID:A', 'EMPTY_POLYGON:B', 'NON_FINITE:C', 'SELF_INTERSECTION:D', 'DUPLICATE_GEOMETRY:E', 'OUTSIDE_DEVELOPMENT:F']) assert.ok(codes.includes(c), c);
  assert.equal(r.ok, false);
  const fb = G.featureOf(bad[2], 2), fc = G.featureOf(bad[3], 3), fd = G.featureOf(bad[4], 4);
  assert.equal(fb.geometryState, 'MISSING'); assert.equal(fb.ring, null, 'no fictitious polygon');
  assert.equal(fc.geometryState, 'INVALID'); assert.equal(fc.ring, null);
  deq(fd.ring, bow.slice(0, 4), 'the self-intersecting ring is kept as the source gave it');
});

test('§17/§100 compatibility report: missing/orphan/duplicate → DEGRADED; version mismatch flagged; nothing remapped', () => {
  const ids = lots.map(l => l.identity.id);
  assert.equal(G.compatibility(ids, bundle.features.map(f => f.lotId)).status, 'READY');
  const r = G.compatibility(ids, [...ids.slice(1), 'VJ-ORPHAN', ids[5]]);
  assert.equal(r.status, 'DEGRADED'); deq(r.missing, [ids[0]]); deq(r.orphan, ['VJ-ORPHAN']); deq(r.duplicate, [ids[5]]);
  assert.equal(G.compatibility(ids, ids, { expectedVersion: 'a', bundleVersion: 'b' }).status, 'VERSION_MISMATCH');
});

test('§116 spatial index = brute force (no false negatives) on real lots and synthetic 1k/5k/10k datasets', () => {
  const ref = SI.bruteForce(bundle.features.filter(f => f.ring)), rnd = rng(46);
  assert.equal(index.size, 498); assert.equal(index.type, 'STATIC_PACKED_RTREE');
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * dev.map.width, y = rnd() * dev.map.height, w = rnd() * 300, h = rnd() * 300, b = { minX: x, minY: y, maxX: x + w, maxY: y + h };
    deq(index.search(b), ref.search(b)); deq(index.queryPoint([x, y], 2), ref.queryPoint([x, y], 2));
  }
  for (const n of [1000, 5000, 10000]) {
    const side = Math.ceil(Math.sqrt(n)), items = [];
    for (let i = 0; i < n; i++) { const x = (i % side) * 12, y = Math.floor(i / side) * 12; items.push({ featureIndex: i, lotId: 'S' + i, bbox: { minX: x, minY: y, maxX: x + 10, maxY: y + 10 } }); }
    const ix = SI.build(items), bf = SI.bruteForce(items);
    for (let i = 0; i < 200; i++) { const x = rnd() * side * 12, y = rnd() * side * 12, b = { minX: x, minY: y, maxX: x + 60, maxY: y + 60 }; deq(ix.search(b), bf.search(b)); }
    assert.ok(ix.buildMs < 2000, `build ${n} in ${ix.buildMs.toFixed(1)} ms`);
    const t0 = performance.now(); for (let i = 0; i < 500; i++) ix.queryPoint([rnd() * side * 12, rnd() * side * 12]); const per = (performance.now() - t0) / 500;
    assert.ok(per < PERF.BUDGET.maxHitTestMs, `point query ${n}: ${per.toFixed(3)} ms`);
  }
  // nearest by bbox distance
  const nn = index.nearest(bundle.features[10].centroid, 1); assert.equal(nn[0].lotId, bundle.features[10].lotId);
});

test('§115/§23 hit test: every lot centroid and label anchor hits its own lot; outside → NONE', () => {
  let ok = 0;
  for (const f of bundle.features) { if (svc.hitTest(f.centroid).lotId === f.lotId) ok++; assert.equal(svc.hitTest(f.labelAnchor).status, 'EXACT'); }
  assert.equal(ok, 498);
  assert.equal(svc.hitTest([-50, -50]).status, 'NONE'); assert.equal(svc.hitTest([dev.map.width + 10, 10]).status, 'NONE');
  const t0 = performance.now(); for (const f of bundle.features) svc.hitTest(f.labelAnchor); const per = (performance.now() - t0) / 498;
  assert.ok(per < PERF.BUDGET.maxHitTestMs, `${per.toFixed(3)} ms per hit`);
});

test('§25 shared edge: deterministic by paint order (topmost painted wins, like the SVG target); never by ranking or price', () => {
  const two = [lotOf('W', square(0, 0, 10)), lotOf('E', square(10, 0, 10))], fs2 = two.map(G.featureOf), ix = SI.build(fs2), h = HT.create(fs2, ix);
  const onEdge = [10, 5], half = () => 0.3;
  assert.equal(h.hitTest(onEdge, { strokeHalfWidth: half }).lotId, 'E', 'no paint order: later featureIndex (painted later) wins');
  assert.equal(h.hitTest(onEdge, { strokeHalfWidth: half, paintOrder: id => (id === 'W' ? 2 : 1) }).lotId, 'W', 'W re-appended on top (selected)');
  // inside W but within E's stroke band: E is on top, so E wins (what the browser does)
  const r = h.hitTest([9.8, 5], { strokeHalfWidth: half, maxStrokeHalfWidth: 0.3 }); assert.equal(r.lotId, 'E'); assert.equal(r.status, 'EDGE_NEAR');
  // the result never depends on context fields other than geometry/paint order/stroke
  deq(h.hitTest([5, 5], { ranking: ['E'], price: { E: 1 } }), h.hitTest([5, 5], {}));
});

test('§24 tolerance: exact hits first; fallback is OFF today (gap tap selects nothing), opt-in nearest/ambiguous when enabled', () => {
  const two = [lotOf('W', square(0, 0, 10)), lotOf('E', square(14, 0, 10))], fs2 = two.map(G.featureOf), h = HT.create(fs2, SI.build(fs2));
  assert.equal(h.hitTest([12, 5], { pointerType: 'touch', worldPerPx: 0.5 }).status, 'NONE');
  const on = { ...HT.TOLERANCE, fallbackEnabled: true };
  assert.equal(h.hitTest([11, 5], { pointerType: 'touch', worldPerPx: 0.5, tolerancePolicy: on }).lotId, 'W');
  const amb = h.hitTest([12, 5], { pointerType: 'touch', worldPerPx: 0.5, tolerancePolicy: on }); assert.equal(amb.status, 'AMBIGUOUS'); deq(amb.candidateLotIds, ['E', 'W']);
  assert.equal(h.hitTest([5, 5], { pointerType: 'touch', worldPerPx: 0.5, tolerancePolicy: on }).status, 'EXACT');
  assert.equal(h.hitTest([12, 5], { pointerType: 'mouse', worldPerPx: 0.5, tolerancePolicy: on }).status, 'NONE', 'pointerPx = 0');
});

test('§121/§122 gesture classifier keeps the old 6 px rule for every input mode', () => {
  for (const t of ['mouse', 'touch', 'pen']) { assert.equal(HT.classify({ pointerType: t, movedPx: 5.9 }), 'TAP'); assert.equal(HT.classify({ pointerType: t, movedPx: 6 }), 'PAN'); }
  assert.equal(HT.classify({ activePointers: 2, movedPx: 0 }), 'PINCH'); assert.equal(HT.classify({ kind: 'wheel' }), 'WHEEL_ZOOM');
  assert.equal(HT.classify({ movedPx: 0, sinceLastTapMs: 120 }), 'DOUBLE_TAP'); assert.ok(HT.selects('TAP') && !HT.selects('PAN') && !HT.selects('PINCH'));
});

test('§56/§57 camera: world↔screen round trip, meet letterboxing, same zoom buckets as the stylesheet', () => {
  const vb = { x: 120, y: 60, w: 1940, h: 1500 }, rect = { left: 300, top: 60, width: 1100, height: 840 };
  for (const [x, y] of [[120, 60], [1000, 700], [2060, 1560]]) { const s = CAM.worldToScreen(x, y, vb, rect), w = CAM.screenToWorld(s[0], s[1], vb, rect); assert.ok(Math.abs(w.x - x) < 1e-9 && Math.abs(w.y - y) < 1e-9); }
  const c = CAM.worldToScreen(vb.x + vb.w / 2, vb.y + vb.h / 2, vb, rect); assert.ok(Math.abs(c[0] - 850) < 1e-9 && Math.abs(c[1] - 480) < 1e-9, 'centred (xMidYMid)');
  const vis = CAM.visibleWorldBounds(vb, rect); assert.ok(vis.minY <= vb.y && vis.maxY >= vb.y + vb.h);
  assert.equal(CAM.bucketOf(1), 'far'); assert.equal(CAM.bucketOf(1.69), 'far'); assert.equal(CAM.bucketOf(1.7), 'mid'); assert.equal(CAM.bucketOf(3.99), 'mid'); assert.equal(CAM.bucketOf(4), 'near');
  deq(CAM.cameraState(vb, vb), { center: [1090, 810], zoom: 1 });
  const e = CAM.effectiveRect(rect, { bottom: 300, right: 100 }); assert.equal(e.height, 540); assert.equal(e.width, 1000);
});

test('§26 viewport query: visible ⊆ buffered, equal to a brute-force bbox scan', () => {
  const b = { minX: 600, minY: 400, maxX: 1000, maxY: 700 }, q = CAM.viewportQuery(index, { bounds: b, zoom: 5, bufferRatio: 0.5 });
  const brute = bundle.features.filter(f => f.bbox.minX <= b.maxX && f.bbox.maxX >= b.minX && f.bbox.minY <= b.maxY && f.bbox.maxY >= b.minY).map(f => f.lotId).sort();
  deq([...q.visibleFeatureIds].sort(), brute); assert.ok(q.visibleFeatureIds.every(id => q.bufferedFeatureIds.includes(id))); assert.equal(q.bucket, 'near');
});

test('§52/§53 label plan: lot labels from mid zoom; selected/compared/recommended first', () => {
  const anchors = bundle.labelAnchors, sel = anchors[3].lotId, cmp = [anchors[7].lotId], recIds = [anchors[9].lotId];
  const far = CAM.labelPlan(anchors, { zoom: 1, selectedId: sel, comparedIds: cmp, recommendedIds: recIds });
  deq(far.labels.map(l => l.lotId), [sel, cmp[0], recIds[0]], 'far: only prioritised labels'); assert.equal(far.blockLabels, true);
  const near = CAM.labelPlan(anchors, { zoom: 5, selectedId: sel, comparedIds: cmp });
  assert.equal(near.labels.length, 498); assert.equal(near.labels[0].lotId, sel); assert.equal(near.labels[1].lotId, cmp[0]); assert.equal(near.blockLabels, false); assert.equal(near.labels[0].showArea, true);
  assert.equal(CAM.labelPlan(anchors, { zoom: 5, policy: { ...CAM.LABEL_POLICY, maxVisibleLabels: 50 } }).labels.length, 50);
});

test('§27/§29/§117 LOD: derived, versioned, OFF by default; count, validity and bounds preserved', () => {
  assert.equal(G.LOD_POLICY.enabled, false); assert.equal(G.lodForZoom(1), 2); assert.equal(G.lodForZoom(10), 2);
  const shared = G.sharedVertices(bundle.features); let v0 = 0, vAll = 0;
  for (const f of bundle.features) {
    const r0 = G.lodRing(f, 0, shared); vAll += f.ring.length; v0 += r0.length;
    assert.ok(r0.length >= 3); deq(G.bbox(r0), f.bbox, `bounds kept ${f.lotId}`); assert.ok(Math.abs(G.signedArea(r0)) > 0);
    for (const q of f.ring) if (shared.has(q[0].toFixed(1) + ',' + q[1].toFixed(1))) assert.ok(r0.some(p => p[0] === q[0] && p[1] === q[1]), 'shared vertex kept');
    deq(G.lodRing(f, 2, shared), f.ring, 'LOD2 = full fidelity');
  }
  assert.ok(v0 < vAll, `LOD0 ${v0} < ${vAll} vertices`);
  assert.equal(bundle.manifest.lodLevels.length, 3); assert.ok(bundle.manifest.lodLevels.every(l => l.featureCount === 498 && l.algorithmId && l.algorithmVersion));
});

test('§70 adjacency graph: static, symmetric, versioned', () => {
  const a = G.adjacency(bundle.features, index, { developmentId: DEV, geometryVersion: bundle.manifest.renderGeometryVersion });
  let edges = 0; for (const [id, ns] of Object.entries(a.neighborsByLotId)) for (const n of ns) { edges++; assert.ok(a.neighborsByLotId[n].includes(id), `${id}↔${n}`); }
  assert.ok(edges > 498, 'lots have neighbours'); assert.match(a.methodVersion, /^shared-edge-within-eps@/); assert.match(a.checksum, /^[0-9a-f]{8}$/);
});

test('§72/§124 budgets, recorder and diagnostics carry technical data only', () => {
  const rec = PERF.createRecorder({ emitMeasures: false });
  for (let i = 1; i <= 10; i++) rec.record('map_hit_test', i);
  const s = rec.stats('map_hit_test'); assert.equal(s.n, 10); assert.equal(s.max, 10); assert.equal(s.p50, 6);
  assert.equal(rec.time('map_render', () => 42), 42); assert.ok(rec.stats('map_render').n === 1);
  assert.equal(PERF.checkBudget({ hitTestP95Ms: 0.4, layerSwitchMs: 30 }).ok, true); assert.equal(PERF.checkBudget({ hitTestP95Ms: 25 }).ok, false);
  const d = PERF.diagnostics({ developmentId: DEV, featureCount: 498, warnings: [] });
  deq(Object.keys(d).sort(), ['developmentId', 'featureCount', 'firstRenderMs', 'geometryDecodeMs', 'geometryLoadMs', 'geometryVersion', 'hitShadow', 'lastHitTestMs', 'lastLayerSwitchMs', 'lastRender', 'memoryEstimateBytes', 'readiness', 'rendererType', 'spatialIndexType', 'visibleFeatureCount', 'warnings'].sort());
  assert.ok(PERF.memoryEstimate(bundle.features) > 0); assert.ok(!PERF.MARKS.some(m => /pan_frame|mousemove|hover/.test(m)), 'no per-frame events');
});

test('§97/§110/§111 repository: tenant-keyed, cross-tenant refused, stale loads cannot commit', async () => {
  const r = REPO.FullBundle({ organizationId: dev.tenantId, developmentId: DEV, dev, lotsProvider: () => lots, sourceGeometryVersion: dev.staticDataVersion });
  const m = await r.getManifest(dev.tenantId, DEV); assert.equal(m.featureCount, 498);
  assert.equal((await r.getGeometryBundle(dev.tenantId, DEV, m.renderGeometryVersion)).features.length, 498);
  await assert.rejects(r.getManifest('other-org', DEV), e => e.code === 'CROSS_TENANT_GEOMETRY');
  await assert.rejects(r.getManifest(dev.tenantId, 'other-dev'), e => e.code === 'CROSS_TENANT_GEOMETRY');
  await assert.rejects(r.getGeometryBundle(dev.tenantId, DEV, 'old'), e => e.code === 'VERSION_MISMATCH');
  assert.equal(r.key(), `${dev.tenantId}/${DEV}/${m.renderGeometryVersion}`);
  const g = REPO.createLoadGuard(), t1 = g.begin(DEV, 'v1'), t2 = g.begin('dev-b', 'v1');
  assert.equal(g.canCommit(t1, DEV, 'v1'), false, 'superseded request'); assert.equal(t1.signal.aborted, true); assert.equal(g.canCommit(t2, 'dev-b', 'v1'), true); assert.equal(g.canCommit(t2, DEV, 'v1'), false);
  const assets = REPO.baseMapAssets(dev); deq(assets.map(a => a.type), ['OFFICIAL_PLAN', 'AERIAL']); assert.ok(assets.every(a => a.alignmentTransformRef === 'plan-to-svg@1.0.0' && a.width === dev.map.width));
  deq(REPO.RENDERER_ADAPTER_METHODS, ['initialize', 'setGeometryBundle', 'setViewport', 'updateFeatureStates', 'updateLayerStyles', 'setLabels', 'destroy']);
});

test('§38/§132 map.js: same path formula, no global store in pointer handlers, migration flags, destroy()', () => {
  const src = fs.readFileSync(path.join(SRC, 'presentation/map.js'), 'utf8');
  new Function('App', src); // parses
  assert.ok(src.includes("const d = 'M' + p.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z';"), 'path formula unchanged');
  assert.ok(!/store\.(set|get)/.test(src), 'the map never touches the global store');
  for (const k of ['cameraTranslate', 'labelCulling', 'bulkNoTransition', 'shadowHitTest']) assert.ok(new RegExp(k + ': true').test(src), k);
  for (const k of ['destroy', 'diagnostics', 'hitTestAt', 'viewportQuery']) assert.ok(src.includes(k), k);
  // the stylesheet thresholds and the camera buckets agree
  assert.ok(src.includes("k < 1.7 ? 'far' : k < 4 ? 'mid' : 'near'")); assert.equal(CAM.ZOOM_BUCKETS.farBelow, 1.7); assert.equal(CAM.ZOOM_BUCKETS.midBelow, 4);
  assert.ok(fs.readFileSync(path.join(SRC, 'presentation/map46.css'), 'utf8').includes('svg#map.bulk .lot{transition:none}'));
});
