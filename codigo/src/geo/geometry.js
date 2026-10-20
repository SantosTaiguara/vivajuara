/* geo/geometry.js — topic 46: canonical vs render geometry, derived metrics, validation, manifest and bundle.
   The canonical geometry is the lot's geometry.polygon as loaded (plan pixel space of the official plan raster).
   Everything here is DERIVED and read-only: nothing mutates lot.geometry, nothing "repairs" a polygon silently,
   and a lot without a valid polygon never gets an invented one. Render geometry = canonical coordinates quantised
   to 0.1 unit (the precision the SVG path has always used); LOD levels are derived, versioned artifacts that stay
   OFF until a benchmark asks for them (MAP_GEOMETRY_LOD_POLICY.md). Pure functions; no DOM. */
App.geo = App.geo || {};
App.geo.geometry = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const GeometryState = E('VALID', 'MISSING', 'INVALID', 'CONFLICTED');
  const MapGeometryState = E('LOADING', 'READY', 'DEGRADED', 'MISSING', 'INVALID', 'VERSION_MISMATCH', 'ERROR');
  const Severity = E('ERROR', 'WARNING', 'INFO');
  const Issue = E('EMPTY_POLYGON', 'NON_FINITE', 'INVALID_RING', 'ZERO_AREA', 'SELF_INTERSECTION', 'DUPLICATE_LOT_ID', 'MISSING_LOT_ID',
    'INVALID_BBOX', 'OUTSIDE_DEVELOPMENT', 'DUPLICATE_GEOMETRY', 'DECLARED_BOUNDS_MISMATCH', 'CENTROID_OUTSIDE', 'VERSION_MISMATCH');
  const SOURCE_PRECISION = 1; // decimals of the path the renderer has always drawn ('toFixed(1)')
  const RENDER_ALGO = Object.freeze({ id: 'quantize-0.1', version: '1.0.0' });
  const LOD_ALGO = Object.freeze({ id: 'douglas-peucker-locked-vertices', version: '1.0.0' });
  const ANCHOR_ALGO = Object.freeze({ id: 'centroid-if-inside-else-polylabel', version: '1.0.0' });
  const ADJ_ALGO = Object.freeze({ id: 'shared-edge-within-eps', version: '1.0.0', eps: 0.6 });

  /** CoordinateReferenceDescriptor: the plan is a raster in pixel space with a scale; never pretend WGS84 */
  const crsFor = dev => Object.freeze({ type: 'PIXEL_SPACE', units: 'PIXEL', epsgCode: undefined,
    metersPerUnit: dev && dev.map && dev.map.metersPerUnit != null ? dev.map.metersPerUnit : null,
    metersPerUnitStatus: dev && dev.map && dev.map.metersPerUnit != null ? 'estimado' : 'não disponível',
    description: 'Coordenadas em pixels da planta oficial rasterizada (origem no canto superior esquerdo, y para baixo). Não georreferenciado: sem EPSG.' });
  /** GeometryTransform: plan pixel space → SVG user space is the identity (the plan image is drawn at 0,0 with its own size) */
  const IDENTITY_TRANSFORM = Object.freeze({ id: 'plan-to-svg', sourceCoordinateRef: 'PIXEL_SPACE/plan', targetCoordinateRef: 'SVG_USER_SPACE', transformType: 'IDENTITY', matrix: [1, 0, 0, 1, 0, 0], version: '1.0.0' });

  // ---------- primitives
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  /** canonical rings come closed (first = last) or open; the math works on the open ring */
  function openRing(p) { if (!Array.isArray(p)) return []; const n = p.length; if (n > 1 && p[0][0] === p[n - 1][0] && p[0][1] === p[n - 1][1]) return p.slice(0, n - 1); return p.slice(); }
  function signedArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % n]; a += x0 * y1 - x1 * y0; } return a / 2; }
  function bbox(r) { let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity; for (const [x, y] of r) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; } return { minX, minY, maxX, maxY }; }
  /** area-weighted centroid; falls back to vertex mean on a degenerate ring */
  function centroid(r) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = r.length; i < n; i++) { const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % n], f = x0 * y1 - x1 * y0; a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f; }
    if (Math.abs(a) < 1e-9) { let sx = 0, sy = 0; for (const [x, y] of r) { sx += x; sy += y; } return [sx / r.length, sy / r.length]; }
    return [cx / (3 * a), cy / (3 * a)];
  }
  /** even-odd ray casting; a point exactly on an edge may go either way — callers use distance for edges */
  function pointInRing(x, y, r) { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
  function segDist2(px, py, ax, ay, bx, by) { let dx = bx - ax, dy = by - ay; const l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; dx = ax + t * dx - px; dy = ay + t * dy - py; return dx * dx + dy * dy; }
  function distToRing(x, y, r) { let m = Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const d = segDist2(x, y, r[j][0], r[j][1], r[i][0], r[i][1]); if (d < m) m = d; } return Math.sqrt(m); }
  /** signed distance: > 0 inside, < 0 outside */
  const signedDist = (x, y, r) => (pointInRing(x, y, r) ? 1 : -1) * distToRing(x, y, r);
  function segmentsCross(a, b, c, d) {
    const o = (p, q, s) => Math.sign((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]));
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0; // proper crossing only (touching/collinear is reported as ring issue elsewhere)
  }
  function selfIntersections(r) { const n = r.length, out = []; for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segmentsCross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) out.push([i, j]); } return out; }
  /** polylabel (pole of inaccessibility), grid refinement; precision in plan units */
  function polylabel(r, precision = 0.5) {
    const b = bbox(r), w = b.maxX - b.minX, h = b.maxY - b.minY, size = Math.min(w, h); if (!size) return [b.minX, b.minY];
    const cell = (x, y, s) => ({ x, y, s, d: signedDist(x, y, r), max: 0 });
    const withMax = c => (c.max = c.d + c.s * Math.SQRT2, c);
    const q = []; let half = size / 2;
    for (let x = b.minX; x < b.maxX; x += size) for (let y = b.minY; y < b.maxY; y += size) q.push(withMax(cell(x + half, y + half, half)));
    const c0 = centroid(r); let best = withMax(cell(c0[0], c0[1], 0)); const bb = withMax(cell(b.minX + w / 2, b.minY + h / 2, 0)); if (bb.d > best.d) best = bb;
    let guard = 0;
    while (q.length && guard++ < 20000) {
      let k = 0; for (let i = 1; i < q.length; i++) if (q[i].max > q[k].max) k = i; const c = q.splice(k, 1)[0];
      if (c.d > best.d) best = c; if (c.max - best.d <= precision) continue;
      half = c.s / 2; for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) q.push(withMax(cell(c.x + dx * half, c.y + dy * half, half)));
    }
    return [best.x, best.y];
  }
  /** FNV-1a 32-bit, hex: deterministic checksum of a canonical string (not a security hash) */
  function checksum(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  const ringKey = (r, dec = SOURCE_PRECISION) => r.map(([x, y]) => x.toFixed(dec) + ',' + y.toFixed(dec)).join(';');
  /** the exact SVG path data the renderer has always produced (render geometry, quantised 0.1) */
  const pathData = p => 'M' + p.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z';

  // ---------- LOD (derived; topology-aware by locking shared and extreme vertices)
  function simplifyRing(r, tol, locked) {
    if (r.length <= 4 || !(tol > 0)) return r.slice();
    const keep = new Uint8Array(r.length); keep[0] = 1; keep[r.length - 1] = 1;
    for (let i = 0; i < r.length; i++) if (locked && locked(r[i], i)) keep[i] = 1;
    const st = [[0, r.length - 1]], t2 = tol * tol;
    while (st.length) {
      const [a, b] = st.pop(); let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) { if (keep[i]) { st.push([a, i], [i, b]); md = -2; break; } const d = segDist2(r[i][0], r[i][1], r[a][0], r[a][1], r[b][0], r[b][1]); if (d > md) { md = d; mi = i; } }
      if (md === -2) continue; if (mi >= 0 && md > t2) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    const out = r.filter((_, i) => keep[i]); return out.length >= 3 ? out : r.slice();
  }
  const LOD_LEVELS = Object.freeze([
    Object.freeze({ level: 0, maxZoom: 1.7, tolerance: 1.5 }),
    Object.freeze({ level: 1, minZoom: 1.7, maxZoom: 4, tolerance: 0.5 }),
    Object.freeze({ level: 2, minZoom: 4, tolerance: 0 })
  ]);
  const LOD_POLICY = Object.freeze({ enabled: false, reason: 'Benchmark (MAP_PERFORMANCE_BASELINE_REPORT.md): 498 caminhos SVG com ~3,7 mil vértices não são gargalo; LOD fica desligado e o mapa desenha sempre LOD2 (fidelidade total).', levels: LOD_LEVELS });

  // ---------- features
  /** LotGeometryFeature + RenderGeometryFeature for one lot (or a MISSING/INVALID descriptor; never a fictitious polygon) */
  function featureOf(lot, featureIndex) {
    const id = lot && lot.identity && lot.identity.id, g = (lot && lot.geometry) || {}, raw = g.polygon;
    if (!Array.isArray(raw) || raw.length < 3) return { featureIndex, lotId: id, geometryState: GeometryState.MISSING, ring: null };
    if (!raw.every(q => Array.isArray(q) && finite(q[0]) && finite(q[1]))) return { featureIndex, lotId: id, geometryState: GeometryState.INVALID, ring: null };
    const ring = openRing(raw); if (ring.length < 3) return { featureIndex, lotId: id, geometryState: GeometryState.INVALID, ring: null };
    const bb = bbox(ring), area = Math.abs(signedArea(ring));
    const c = Array.isArray(g.centroid) && finite(g.centroid[0]) && finite(g.centroid[1]) ? [g.centroid[0], g.centroid[1]] : centroid(ring);
    const cInside = pointInRing(c[0], c[1], ring), clearance = cInside ? distToRing(c[0], c[1], ring) : 0;
    const anchor = cInside && clearance >= 1 ? c : polylabel(ring, 0.25);
    return { featureIndex, lotId: id, geometryState: area > 0 ? GeometryState.VALID : GeometryState.INVALID, ring, bbox: bb, centroid: c, labelAnchor: [+anchor[0].toFixed(2), +anchor[1].toFixed(2)],
      labelAnchorSource: anchor === c ? 'CENTROID' : 'POLYLABEL', canonicalAreaUnits2: area, canonicalGeometryRef: `lot:${id}#geometry.polygon`, pathData: pathData(raw), sourceKey: ringKey(raw) };
  }
  function developmentBounds(dev) { const m = dev && dev.map; return m ? { minX: 0, minY: 0, maxX: m.width, maxY: m.height } : null; }

  /** GeometryValidationService: reports only; never repairs */
  function validate(lots, { dev, features } = {}) {
    const issues = [], push = (severity, code, lotId, detail) => issues.push({ severity, code, lotId: lotId ?? null, detail: detail || null });
    const feats = features || lots.map(featureOf), seen = new Map(), geoSeen = new Map(), devB = developmentBounds(dev);
    for (const f of feats) {
      if (!f.lotId) { push(Severity.ERROR, Issue.MISSING_LOT_ID, null, `featureIndex ${f.featureIndex}`); continue; }
      if (seen.has(f.lotId)) push(Severity.ERROR, Issue.DUPLICATE_LOT_ID, f.lotId); seen.set(f.lotId, f);
      if (f.geometryState === GeometryState.MISSING) { push(Severity.ERROR, Issue.EMPTY_POLYGON, f.lotId); continue; }
      if (f.geometryState === GeometryState.INVALID && !f.ring) { push(Severity.ERROR, Issue.NON_FINITE, f.lotId); continue; }
      if (!(f.canonicalAreaUnits2 > 0)) push(Severity.ERROR, Issue.ZERO_AREA, f.lotId);
      const b = f.bbox; if (!(b.maxX > b.minX && b.maxY > b.minY)) push(Severity.ERROR, Issue.INVALID_BBOX, f.lotId);
      if (devB && (b.minX < devB.minX || b.minY < devB.minY || b.maxX > devB.maxX || b.maxY > devB.maxY)) push(Severity.WARNING, Issue.OUTSIDE_DEVELOPMENT, f.lotId);
      const si = selfIntersections(f.ring); if (si.length) push(Severity.WARNING, Issue.SELF_INTERSECTION, f.lotId, `${si.length} cruzamento(s) de arestas na geometria oficial; não corrigido`);
      if (geoSeen.has(f.sourceKey)) push(Severity.WARNING, Issue.DUPLICATE_GEOMETRY, f.lotId, `mesma geometria de ${geoSeen.get(f.sourceKey)}`); else geoSeen.set(f.sourceKey, f.lotId);
      const lot = lots[f.featureIndex], db = lot && lot.geometry && lot.geometry.bounds;
      if (db && (Math.abs(db.x - b.minX) > 0.05 || Math.abs(db.y - b.minY) > 0.05 || Math.abs(db.x + db.w - b.maxX) > 0.05 || Math.abs(db.y + db.h - b.maxY) > 0.05)) push(Severity.WARNING, Issue.DECLARED_BOUNDS_MISMATCH, f.lotId);
      if (f.labelAnchorSource === 'POLYLABEL') push(Severity.INFO, Issue.CENTROID_OUTSIDE, f.lotId, 'centróide fora do polígono ou junto à borda; rótulo usa ponto interno (polylabel)');
    }
    const count = s => issues.filter(i => i.severity === s).length;
    return { ok: count(Severity.ERROR) === 0, featureCount: feats.length, validCount: feats.filter(f => f.geometryState === GeometryState.VALID).length, errors: count(Severity.ERROR), warnings: count(Severity.WARNING), infos: count(Severity.INFO), issues };
  }

  /** GeometryCompatibilityReport: canonical lot IDs ↔ geometry feature IDs. A mismatch is DEGRADED, never remapped. */
  function compatibility(lotIds, featureIds, { expectedVersion, bundleVersion } = {}) {
    const L = new Set(lotIds), count = new Map(); for (const id of featureIds) count.set(id, (count.get(id) || 0) + 1);
    const missing = lotIds.filter(id => !count.has(id)), orphan = [...count.keys()].filter(id => !L.has(id)), duplicate = [...count].filter(([, n]) => n > 1).map(([id]) => id);
    const versionMismatch = expectedVersion != null && bundleVersion != null && expectedVersion !== bundleVersion;
    const status = versionMismatch ? MapGeometryState.VERSION_MISMATCH : missing.length || orphan.length || duplicate.length ? MapGeometryState.DEGRADED : MapGeometryState.READY;
    return { status, lotCount: L.size, featureCount: featureIds.length, missing, orphan, duplicate, versionMismatch, diagnostics: status === 'READY' ? [] : [`${missing.length} sem geometria, ${orphan.length} geometria órfã, ${duplicate.length} duplicada${versionMismatch ? ', versão divergente' : ''}`] };
  }

  /** LotAdjacencyGraph (static, derived): lots whose boundaries run within eps over a shared stretch */
  function adjacency(features, index, { developmentId, geometryVersion } = {}) {
    const eps = ADJ_ALGO.eps, out = {}, valid = features.filter(f => f.ring);
    const near = (a, b) => { let hits = 0; for (const p of a.ring) if (distToRing(p[0], p[1], b.ring) <= eps) { if (++hits >= 2) return true; } for (const p of b.ring) if (distToRing(p[0], p[1], a.ring) <= eps) { if (++hits >= 2) return true; } return false; };
    for (const f of valid) {
      const cand = index ? index.search({ minX: f.bbox.minX - eps, minY: f.bbox.minY - eps, maxX: f.bbox.maxX + eps, maxY: f.bbox.maxY + eps }).map(h => features[h.featureIndex]) : valid;
      out[f.lotId] = cand.filter(g => g !== f && g.ring && near(f, g)).map(g => g.lotId).sort();
    }
    return { developmentId, geometryVersion, neighborsByLotId: out, methodVersion: `${ADJ_ALGO.id}@${ADJ_ALGO.version}`, checksum: checksum(JSON.stringify(out)) };
  }

  /** GeometryManifest + GeometryBundle for one development (multi-tenant keyed by organizationId/developmentId) */
  function buildBundle({ organizationId = null, developmentId, dev, lots, sourceGeometryVersion, generatedAt = null }) {
    const features = lots.map(featureOf);
    const srcStr = features.map(f => f.lotId + ':' + (f.sourceKey || f.geometryState)).join('|');
    const sourceChecksum = checksum(srcStr), renderChecksum = checksum(features.map(f => f.lotId + ':' + (f.pathData || '-')).join('|'));
    const renderGeometryVersion = `${sourceGeometryVersion || 'unversioned'}+${RENDER_ALGO.id}@${RENDER_ALGO.version}`;
    const lodLevels = LOD_LEVELS.map(l => ({ ...l, algorithmId: l.level === 2 ? RENDER_ALGO.id : LOD_ALGO.id, algorithmVersion: l.level === 2 ? RENDER_ALGO.version : LOD_ALGO.version, featureCount: features.filter(f => f.ring).length, checksum: null }));
    const manifest = { organizationId, developmentId, sourceGeometryVersion: sourceGeometryVersion || null, renderGeometryVersion, coordinateReference: crsFor(dev), transform: IDENTITY_TRANSFORM,
      featureCount: features.length, developmentBounds: developmentBounds(dev), lodLevels, lodPolicy: { enabled: LOD_POLICY.enabled }, spatialIndexVersion: App.geo.spatialIndex ? App.geo.spatialIndex.VERSION : null,
      labelAnchorAlgorithm: `${ANCHOR_ALGO.id}@${ANCHOR_ALGO.version}`, sourceChecksum, renderChecksum, generatedAt, sourceRefs: ['lots.json → Lot.geometry.polygon (canônico)'] };
    return { manifest, features, labelAnchors: features.filter(f => f.ring).map(f => ({ lotId: f.lotId, at: f.labelAnchor, source: f.labelAnchorSource })), developmentBounds: manifest.developmentBounds };
  }
  /** LOD ring for one feature, derived on demand (shared vertices across lots and bbox extremes locked → no gaps on shared corners, bounds preserved) */
  function lodRing(feature, level, sharedVertexKeys) {
    const L = LOD_LEVELS.find(l => l.level === level); if (!feature.ring || !L || !L.tolerance) return feature.ring;
    const b = feature.bbox, key = q => q[0].toFixed(1) + ',' + q[1].toFixed(1);
    return simplifyRing(feature.ring, L.tolerance, q => q[0] === b.minX || q[0] === b.maxX || q[1] === b.minY || q[1] === b.maxY || (sharedVertexKeys && sharedVertexKeys.has(key(q))));
  }
  function sharedVertices(features) { const n = new Map(); for (const f of features) if (f.ring) for (const k of new Set(f.ring.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)))) n.set(k, (n.get(k) || 0) + 1); return new Set([...n].filter(([, c]) => c > 1).map(([k]) => k)); }
  const lodForZoom = k => (LOD_POLICY.enabled ? (LOD_LEVELS.find(l => (l.minZoom == null || k >= l.minZoom) && (l.maxZoom == null || k < l.maxZoom)) || LOD_LEVELS[2]).level : 2);

  return Object.freeze({ GeometryState, MapGeometryState, Severity, Issue, RENDER_ALGO, LOD_ALGO, ANCHOR_ALGO, ADJ_ALGO, LOD_LEVELS, LOD_POLICY, IDENTITY_TRANSFORM,
    crsFor, openRing, signedArea, bbox, centroid, pointInRing, distToRing, signedDist, selfIntersections, polylabel, checksum, pathData, simplifyRing,
    featureOf, developmentBounds, validate, compatibility, adjacency, buildBundle, lodRing, sharedVertices, lodForZoom });
})();
