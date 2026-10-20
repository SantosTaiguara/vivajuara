/* geo/hitTest.js — topic 46: MapHitTestService, HitTestTolerancePolicy and MapGestureClassifier.
   Flow: world point → spatial index (bbox candidates) → exact test (point-in-polygon + stroke band) → result.
   It reproduces what the SVG renderer's native hit test returns: the topmost painted lot whose fill OR stroke
   covers the point (paint order supplied by the renderer, stroke half-width per lot in world units).
   Exact/stroke hits always win over the tolerance fallback; ties never use Recommendation, Fit, ranking or price:
   the deterministic order is paint order, then the higher featureIndex (later in document = painted on top).
   Today the SVG renderer keeps using event.target (spec §21); this service backs viewport queries, shadow
   verification, keyboard/list focus, and a future Canvas/WebGL renderer. */
App.geo = App.geo || {};
App.geo.hitTest = (() => {
  const G = () => App.geo.geometry;
  const Status = Object.freeze({ EXACT: 'EXACT', EDGE_NEAR: 'EDGE_NEAR', AMBIGUOUS: 'AMBIGUOUS', NONE: 'NONE' });
  /** HitTestTolerancePolicy (screen px). The fallback is OFF today: a tap in a gap selects nothing, as it always has. */
  const TOLERANCE = Object.freeze({ pointerPx: 0, touchPx: 10, penPx: 4, fallbackEnabled: false, ambiguityEpsPx: 1 });
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /** features: bundle.features (ring/bbox per featureIndex); index: App.geo.spatialIndex.build(...) */
  function create(features, index) {
    let last = { ms: null, candidates: 0 }, count = 0;
    /** ctx: { strokeHalfWidth(lotId)→world units, paintOrder(lotId)→number (higher = on top), maxStrokeHalfWidth, worldPerPx, pointerType, tolerancePolicy } */
    function hitTest(pt, ctx = {}) {
      const t0 = now(), g = G(), x = pt[0], y = pt[1];
      const maxStroke = ctx.maxStrokeHalfWidth != null ? ctx.maxStrokeHalfWidth : 0;
      const pol = ctx.tolerancePolicy || TOLERANCE, wpp = ctx.worldPerPx || 0;
      const tolPx = !pol.fallbackEnabled ? 0 : ctx.pointerType === 'touch' ? pol.touchPx : ctx.pointerType === 'pen' ? pol.penPx : pol.pointerPx;
      const tol = tolPx * wpp, pad = Math.max(maxStroke, tol);
      const cand = index.queryPoint(pt, pad), covering = [], nearBy = [];
      for (const h of cand) {
        const f = features[h.featureIndex]; if (!f || !f.ring) continue;
        const inside = g.pointInRing(x, y, f.ring), d = g.distToRing(x, y, f.ring), sw = ctx.strokeHalfWidth ? ctx.strokeHalfWidth(f.lotId) : 0;
        if (inside || d <= sw) covering.push({ f, inside, d }); else if (tol && d <= tol) nearBy.push({ f, d });
      }
      let res;
      if (covering.length) {
        const ord = ctx.paintOrder || (() => 0);
        covering.sort((a, b) => ord(b.f.lotId) - ord(a.f.lotId) || b.f.featureIndex - a.f.featureIndex);
        const top = covering[0];
        res = { status: top.inside ? Status.EXACT : Status.EDGE_NEAR, lotId: top.f.lotId, coveredBy: covering.length };
      } else if (nearBy.length) {
        nearBy.sort((a, b) => a.d - b.d || a.f.featureIndex - b.f.featureIndex);
        const eps = (pol.ambiguityEpsPx || 0) * wpp;
        const tied = nearBy.filter(n => n.d - nearBy[0].d <= eps);
        res = tied.length > 1 ? { status: Status.AMBIGUOUS, candidateLotIds: tied.map(n => n.f.lotId).sort() } : { status: Status.EDGE_NEAR, lotId: nearBy[0].f.lotId, viaTolerance: true };
      } else res = { status: Status.NONE };
      last = { ms: now() - t0, candidates: cand.length }; count++;
      return res;
    }
    return { hitTest, stats: () => ({ ...last, count }) };
  }

  /** MapGestureClassifier. Pan threshold per input mode (the 6 px every input used before topic 46). */
  const PAN_THRESHOLD_PX = Object.freeze({ mouse: 6, pen: 6, touch: 6 });
  const DOUBLE_TAP_MS = 300;
  const Gesture = Object.freeze({ TAP: 'TAP', PAN: 'PAN', PINCH: 'PINCH', WHEEL_ZOOM: 'WHEEL_ZOOM', DOUBLE_TAP: 'DOUBLE_TAP' });
  /** input: { kind:'pointer'|'wheel', pointerType, activePointers, movedPx, sinceLastTapMs } */
  function classify(i) {
    if (i.kind === 'wheel') return Gesture.WHEEL_ZOOM;
    if ((i.activePointers || 1) >= 2) return Gesture.PINCH;
    const th = PAN_THRESHOLD_PX[i.pointerType] ?? PAN_THRESHOLD_PX.mouse;
    if ((i.movedPx || 0) >= th) return Gesture.PAN;
    return i.sinceLastTapMs != null && i.sinceLastTapMs < DOUBLE_TAP_MS ? Gesture.DOUBLE_TAP : Gesture.TAP;
  }
  /** a lot is selected only by a TAP (or the second tap of a DOUBLE_TAP, which today behaves as a tap) */
  const selects = g => g === Gesture.TAP || g === Gesture.DOUBLE_TAP;
  return Object.freeze({ Status, TOLERANCE, PAN_THRESHOLD_PX, DOUBLE_TAP_MS, Gesture, create, classify, selects });
})();
