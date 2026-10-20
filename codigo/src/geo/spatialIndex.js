/* geo/spatialIndex.js — topic 46: static packed R-tree (STR bulk load, Flatbush-style, no dependency).
   Built once per render geometry version; immutable afterwards. Bbox candidates only — the exact test belongs
   to the caller (hitTest.js). featureIndex is internal and never a lot ID; hits always carry the canonical lotId.
   search(bounds) and queryPoint(point, tolerance) are O(log n + k). A brute-force reference is kept for tests. */
App.geo = App.geo || {};
App.geo.spatialIndex = (() => {
  const VERSION = 'str-rtree@1.0.0', TYPE = 'STATIC_PACKED_RTREE';
  /** items: [{ featureIndex, lotId, bbox:{minX,minY,maxX,maxY} }] */
  function build(items, { nodeSize = 16 } = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const leaves = items.filter(i => i && i.bbox && Number.isFinite(i.bbox.minX)).map(i => ({ ...i.bbox, item: i }));
    let level = leaves, levels = [leaves];
    // STR: sort by x into vertical slices, then by y inside each slice, pack nodeSize per node
    while (level.length > nodeSize) {
      const n = level.length, P = Math.ceil(n / nodeSize), S = Math.ceil(Math.sqrt(P)), cx = b => (b.minX + b.maxX) / 2, cy = b => (b.minY + b.maxY) / 2;
      const sx = level.slice().sort((a, b) => cx(a) - cx(b) || cy(a) - cy(b)), per = S * nodeSize, next = [];
      for (let s = 0; s < n; s += per) {
        const slice = sx.slice(s, s + per).sort((a, b) => cy(a) - cy(b) || cx(a) - cx(b));
        for (let k = 0; k < slice.length; k += nodeSize) { const ch = slice.slice(k, k + nodeSize); next.push({ minX: Math.min(...ch.map(c => c.minX)), minY: Math.min(...ch.map(c => c.minY)), maxX: Math.max(...ch.map(c => c.maxX)), maxY: Math.max(...ch.map(c => c.maxY)), children: ch }); }
      }
      level = next; levels.push(level);
    }
    const root = { minX: Math.min(...level.map(c => c.minX)), minY: Math.min(...level.map(c => c.minY)), maxX: Math.max(...level.map(c => c.maxX)), maxY: Math.max(...level.map(c => c.maxY)), children: level };
    const buildMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    const hit = it => ({ featureIndex: it.featureIndex, lotId: it.lotId });
    const inter = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    function search(b) {
      const out = []; if (!leaves.length || !inter(root, b)) return out; const st = [root];
      while (st.length) { const n = st.pop(); for (const c of n.children) if (inter(c, b)) { if (c.item) out.push(hit(c.item)); else st.push(c); } }
      return out.sort((x, y) => x.featureIndex - y.featureIndex);
    }
    const queryPoint = (p, tol = 0) => search({ minX: p[0] - tol, minY: p[1] - tol, maxX: p[0] + tol, maxY: p[1] + tol });
    /** k nearest by bbox distance (best-first) */
    function nearest(p, k = 1, maxDist = Infinity) {
      const d2 = b => { const dx = Math.max(b.minX - p[0], 0, p[0] - b.maxX), dy = Math.max(b.minY - p[1], 0, p[1] - b.maxY); return dx * dx + dy * dy; };
      const q = [{ n: root, d: d2(root) }], out = [], m2 = maxDist * maxDist;
      while (q.length && out.length < k) {
        let i = 0; for (let j = 1; j < q.length; j++) if (q[j].d < q[i].d) i = j; const { n, d } = q.splice(i, 1)[0]; if (d > m2) break;
        if (n.item) { out.push({ ...hit(n.item), bboxDistance: Math.sqrt(d) }); continue; }
        for (const c of n.children) q.push({ n: c, d: d2(c) });
      }
      return out;
    }
    return Object.freeze({ type: TYPE, version: VERSION, size: leaves.length, depth: levels.length, nodeSize, buildMs, bounds: leaves.length ? { minX: root.minX, minY: root.minY, maxX: root.maxX, maxY: root.maxY } : null, search, queryPoint, nearest });
  }
  /** reference implementation for correctness tests (no false negatives allowed in the index) */
  function bruteForce(items) {
    const inter = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    const search = b => items.filter(i => i && i.bbox && inter(i.bbox, b)).map(i => ({ featureIndex: i.featureIndex, lotId: i.lotId })).sort((x, y) => x.featureIndex - y.featureIndex);
    return { type: 'BRUTE_FORCE', search, queryPoint: (p, t = 0) => search({ minX: p[0] - t, minY: p[1] - t, maxX: p[0] + t, maxY: p[1] + t }) };
  }
  return Object.freeze({ VERSION, TYPE, build, bruteForce });
})();
