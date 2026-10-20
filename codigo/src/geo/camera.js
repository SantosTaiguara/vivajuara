/* geo/camera.js — topic 46: camera transform (world ↔ screen) for the SVG viewBox camera, viewport queries,
   semantic zoom buckets and the label policy. Pure math: the renderer passes a cached container rect, so pointer
   handlers never force a layout read. Matches SVG preserveAspectRatio="xMidYMid meet" exactly. No rotation
   (the plan is north-up; MapCameraState has no rotation field by design). */
App.geo = App.geo || {};
App.geo.camera = (() => {
  /** semantic zoom buckets used by the stylesheet (data-z): unchanged thresholds */
  const ZOOM_BUCKETS = Object.freeze({ farBelow: 1.7, midBelow: 4 });
  const bucketOf = k => (k < ZOOM_BUCKETS.farBelow ? 'far' : k < ZOOM_BUCKETS.midBelow ? 'mid' : 'near');
  /** MapLabelPolicy: what the CSS has always shown per bucket, plus priority rules for overlays */
  const LABEL_POLICY = Object.freeze({ minZoomForBlockLabel: 0, maxZoomForBlockLabel: ZOOM_BUCKETS.midBelow, minZoomForLotLabel: ZOOM_BUCKETS.farBelow, minZoomForAreaLabel: ZOOM_BUCKETS.midBelow,
    maxVisibleLabels: null, hideCollidingLabels: false, prioritizeSelected: true, prioritizeCompared: true, prioritizeRecommended: true,
    cullOffscreen: true, cullBufferRatio: 0.6, cullReason: 'Benchmark: cada escrita de viewBox refaz o layout de todo texto SVG exibido; em zoom médio/próximo os rótulos fora da tela (com margem) ficam display:none. Aplicado pelo renderer SVG (MapView.FLAGS.labelCulling).' });
  /** vb: {x,y,w,h} viewBox; rect: {left,top,width,height} of the svg element (client px) */
  function scaleOf(vb, rect) { return Math.max(vb.w / rect.width, vb.h / rect.height); }
  function frame(vb, rect) { const s = scaleOf(vb, rect); return { s, ox: (rect.width * s - vb.w) / 2, oy: (rect.height * s - vb.h) / 2 }; }
  /** client px → world (inverse camera transform) */
  function screenToWorld(cx, cy, vb, rect) { const { s, ox, oy } = frame(vb, rect); return { x: vb.x - ox + (cx - rect.left) * s, y: vb.y - oy + (cy - rect.top) * s, s }; }
  /** world → client px (camera transform) */
  function worldToScreen(x, y, vb, rect) { const { s, ox, oy } = frame(vb, rect); return [rect.left + (x - vb.x + ox) / s, rect.top + (y - vb.y + oy) / s]; }
  /** the world rectangle actually visible in the element (meet letterboxing included) */
  function visibleWorldBounds(vb, rect) { const { s, ox, oy } = frame(vb, rect); return { minX: vb.x - ox, minY: vb.y - oy, maxX: vb.x - ox + rect.width * s, maxY: vb.y - oy + rect.height * s }; }
  /** MapCameraState from a viewBox; fit = development fit viewBox (zoom 1) */
  const cameraState = (vb, fit) => ({ center: [vb.x + vb.w / 2, vb.y + vb.h / 2], zoom: fit.w / vb.w });
  /** ViewportSpatialQueryService */
  function viewportQuery(index, q) {
    const b = q.bounds, r = q.bufferRatio || 0, bw = (b.maxX - b.minX) * r, bh = (b.maxY - b.minY) * r;
    const vis = index.search(b), buf = r ? index.search({ minX: b.minX - bw, minY: b.minY - bh, maxX: b.maxX + bw, maxY: b.maxY + bh }) : vis;
    return { visibleFeatureIds: vis.map(h => h.lotId), bufferedFeatureIds: buf.map(h => h.lotId), zoom: q.zoom, bucket: q.zoom != null ? bucketOf(q.zoom) : null };
  }
  /** effective viewport after insets (panels, bottom sheet, tray, safe areas) in client px */
  function effectiveRect(rect, insets = {}) { const l = insets.left || 0, r = insets.right || 0, t = insets.top || 0, b = insets.bottom || 0; return { left: rect.left + l, top: rect.top + t, width: Math.max(1, rect.width - l - r), height: Math.max(1, rect.height - t - b) }; }
  /** is a world bbox fully inside the effective viewport? (fitLot / keep-visible checks use bbox, never full lot detail) */
  function bboxVisible(bbox, vb, rect, insets) { const e = effectiveRect(rect, insets), p0 = worldToScreen(bbox.minX, bbox.minY, vb, rect), p1 = worldToScreen(bbox.maxX, bbox.maxY, vb, rect); return p0[0] >= e.left && p0[1] >= e.top && p1[0] <= e.left + e.width && p1[1] <= e.top + e.height; }
  /** labels the policy shows at a zoom, with selected/compared/recommended first (for a future capped renderer) */
  function labelPlan(anchors, { zoom, selectedId, comparedIds = [], recommendedIds = [], visibleIds = null, policy = LABEL_POLICY } = {}) {
    const b = bucketOf(zoom), lotOn = zoom >= policy.minZoomForLotLabel, vis = visibleIds ? new Set(visibleIds) : null, cmp = new Set(comparedIds), rec = new Set(recommendedIds);
    const pri = a => (policy.prioritizeSelected && a.lotId === selectedId ? 0 : policy.prioritizeCompared && cmp.has(a.lotId) ? 1 : policy.prioritizeRecommended && rec.has(a.lotId) ? 2 : 3);
    let list = anchors.filter(a => (!vis || vis.has(a.lotId)) && (lotOn || pri(a) < 3)).map(a => ({ ...a, priority: pri(a), showArea: zoom >= policy.minZoomForAreaLabel }));
    list.sort((x, y) => x.priority - y.priority); if (policy.maxVisibleLabels != null) list = list.slice(0, policy.maxVisibleLabels);
    return { bucket: b, blockLabels: zoom < policy.maxZoomForBlockLabel, labels: list };
  }
  return Object.freeze({ ZOOM_BUCKETS, LABEL_POLICY, bucketOf, scaleOf, screenToWorld, worldToScreen, visibleWorldBounds, cameraState, viewportQuery, effectiveRect, bboxVisible, labelPlan });
})();
