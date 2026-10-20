/* geo/perf.js — topic 46: MapPerformanceBudget, technical performance marks, long-task observer and MapDiagnostics.
   Technical telemetry only: it stays in this tab (performance timeline + an in-memory ring buffer), carries no lot
   price, customer or user data, is never sent anywhere and is not Product Analytics (topic 45). Pan frames,
   mousemove, hover and zoom ticks are never tracked as events. */
App.geo = App.geo || {};
App.geo.perf = (() => {
  /** reference targets (spec §73), with margin; validated on the device matrix in MAP_PERFORMANCE_TEST_MATRIX.md */
  const BUDGET = Object.freeze({ targetFpsDuringGesture: 50, maxInteractionLatencyMs: 100, maxLayerSwitchLatencyMs: 100, maxFilterVisualUpdateMs: 100,
    maxHitTestMs: 10, maxLongTaskMs: 50, maxGeometryDecodeMs: 50, maxGeometryBundleBytes: 2 * 1024 * 1024, maxFirstRenderMs: 150, maxIndexBuildMs: 20 });
  const MARKS = Object.freeze(['map_geometry_load', 'map_geometry_decode', 'map_index_build', 'map_first_render', 'map_interactive', 'map_layer_switch', 'map_hit_test', 'map_filter_visual_update', 'map_render']);
  const P = () => (typeof performance !== 'undefined' ? performance : null);
  const now = () => { const p = P(); return p ? p.now() : Date.now(); };
  /** ring buffer of durations per measure name (p50/p95 for diagnostics) */
  function createRecorder({ size = 120, emitMeasures = true } = {}) {
    const buf = new Map(), longTasks = []; let obs = null;
    function record(name, ms) { const a = buf.get(name) || []; a.push(ms); if (a.length > size) a.shift(); buf.set(name, a); }
    /** time a synchronous block; also leaves a `performance.measure` (name must be one of MARKS) */
    function time(name, fn) {
      const t0 = now(); try { return fn(); } finally { const ms = now() - t0; record(name, ms); const p = P(); if (emitMeasures && p && p.measure) { try { p.measure(name, { start: t0, duration: ms }); } catch (e) { /* old browsers: buffer only */ } } }
    }
    function stats(name) { const a = (buf.get(name) || []).slice().sort((x, y) => x - y); if (!a.length) return null; const at = q => a[Math.min(a.length - 1, Math.floor(q * a.length))]; return { n: a.length, last: buf.get(name)[buf.get(name).length - 1], p50: at(0.5), p95: at(0.95), max: a[a.length - 1] }; }
    function observeLongTasks() {
      try { if (typeof PerformanceObserver === 'undefined' || obs) return false; obs = new PerformanceObserver(l => { for (const e of l.getEntries()) { longTasks.push({ at: e.startTime, ms: e.duration }); if (longTasks.length > 50) longTasks.shift(); } }); obs.observe({ type: 'longtask', buffered: false }); return true; } catch (e) { obs = null; return false; }
    }
    function disconnect() { try { if (obs) obs.disconnect(); } catch (e) { /* ignore */ } obs = null; buf.clear(); longTasks.length = 0; }
    return { record, time, stats, observeLongTasks, longTasks: () => longTasks.slice(), disconnect, names: () => [...buf.keys()] };
  }
  /** budget check: material regressions only (no microsecond thresholds) */
  function checkBudget(measured, budget = BUDGET) {
    const rows = [['hit test p95', measured.hitTestP95Ms, budget.maxHitTestMs], ['layer switch', measured.layerSwitchMs, budget.maxLayerSwitchLatencyMs], ['interaction', measured.interactionMs, budget.maxInteractionLatencyMs],
      ['first render', measured.firstRenderMs, budget.maxFirstRenderMs], ['index build', measured.indexBuildMs, budget.maxIndexBuildMs], ['long task', measured.longTaskMaxMs, budget.maxLongTaskMs]];
    const results = rows.filter(r => r[1] != null).map(([k, v, max]) => ({ metric: k, value: v, budget: max, ok: v <= max }));
    return { ok: results.every(r => r.ok), results };
  }
  /** MapDiagnostics (technical-only) */
  function diagnostics(base) { return Object.freeze({ developmentId: base.developmentId, geometryVersion: base.geometryVersion || null, rendererType: base.rendererType || 'SVG', featureCount: base.featureCount || 0,
    visibleFeatureCount: base.visibleFeatureCount ?? null, spatialIndexType: base.spatialIndexType || null, geometryLoadMs: base.geometryLoadMs ?? null, geometryDecodeMs: base.geometryDecodeMs ?? null,
    firstRenderMs: base.firstRenderMs ?? null, lastLayerSwitchMs: base.lastLayerSwitchMs ?? null, lastHitTestMs: base.lastHitTestMs ?? null, memoryEstimateBytes: base.memoryEstimateBytes ?? null,
    readiness: base.readiness || null, lastRender: base.lastRender || null, hitShadow: base.hitShadow || null, warnings: (base.warnings || []).slice() }); }
  /** rough memory estimate of the derived geometry (vertices × 2 numbers × 8 bytes + per-feature overhead) */
  const memoryEstimate = features => features.reduce((s, f) => s + (f.ring ? f.ring.length * 16 + 200 : 64), 0);
  /** Progressive readiness (spec §107) */
  const Readiness = Object.freeze({ SHELL_READY: 'SHELL_READY', BASE_MAP_READY: 'BASE_MAP_READY', GEOMETRY_READY: 'GEOMETRY_READY', INTERACTIVE: 'INTERACTIVE', FULLY_ENHANCED: 'FULLY_ENHANCED' });
  return Object.freeze({ BUDGET, MARKS, Readiness, createRecorder, checkBudget, diagnostics, memoryEstimate, now });
})();
