/* onboarding/geometryIngest.js — topic 58 §84–111: geometry pipeline.
   - GeometrySourceDescriptor with an explicit coordinate reference (topic 46 types). Coordinates stay in the reference
     they came in: plan/pixel stays PIXEL_SPACE, lon/lat stays EPSG:4326, out-of-range values are UNKNOWN. Nothing is ever
     converted to WGS84 without an APPROVED GeometryTransform (never fake WGS84, §88).
   - A raster image is never geometry and a base map is never lot polygons (§91–92).
   - Validation (§99): ring, self-intersection, zero area, duplicate, overlap, bounds — via App.geo.geometry primitives.
   - Matching (§94–98): SOURCE_ID / BLOCK_LOT are deterministic; SPATIAL needs a shared reference and human approval;
     every published polygon maps to exactly one lot; unmatched polygons and lots without polygons are reported.
   - Repairs are derived records with both checksums; the source geometry is never overwritten (§100–101).
   - Alignment (§102–108): affine fit from anchors with residual metrics; PROPOSED until a human approves it.
   - GeometryBundle / SpatialIndex / MapLotIndex built from validated drafts (§109–111, §180–182).
   Pure. Depends on App.geo.geometry, App.geo.spatialIndex (optional), App.onboarding.model. */
App.onboarding = App.onboarding || {};
App.onboarding.geometry = (() => {
  const M = App.onboarding.model, G = App.geo.geometry;
  const freeze = o => Object.freeze(o);
  const polyOf = d => d.polygon || (d.attributes && Array.isArray(d.attributes['geometry.polygon']) ? d.attributes['geometry.polygon'] : null);
  const finite = n => typeof n === 'number' && Number.isFinite(n);

  /** coordinate reference descriptor from a string ('PIXEL_SPACE/plan', 'EPSG:4326', 'UNKNOWN', 'LOCAL_PLAN/…') */
  function crsOf(ref) {
    const s = String(ref || 'UNKNOWN');
    if (/^EPSG:\d+$/.test(s)) return freeze({ type: 'EPSG', ref: s, epsgCode: Number(s.slice(5)) });
    const t = s.split('/')[0];
    return freeze({ type: M.CoordinateRefType[t] ? t : 'UNKNOWN', ref: M.CoordinateRefType[t] ? s : 'UNKNOWN', epsgCode: undefined });
  }
  /** describeSource(asset, parsedSource, { authoritative }) → ok(GeometrySourceDescriptor) | fail(GEOMETRY_RASTER_NOT_GEOMETRY) */
  function describeSource(asset, ps, { authoritative = false } = {}) {
    if (asset.sourceType === 'IMAGE' || asset.purpose === 'BASE_MAP') return M.fail('GEOMETRY_RASTER_NOT_GEOMETRY', 'mapa base/imagem: registre como BASE_MAP, não como polígonos', { sourceAssetId: asset.id });
    const declared = asset.metadata && (asset.metadata.coordinateReference || asset.metadata.crs);
    const parsedRef = ps && ps.metadata && ps.metadata.coordinateReference;
    // a declared reference must agree with what the parser could verify; disagreement → UNKNOWN (reviewed), never the "nicer" one
    const ref = declared && parsedRef && parsedRef !== 'UNKNOWN' && declared !== parsedRef ? 'UNKNOWN' : declared || parsedRef || 'UNKNOWN';
    const types = new Set((ps ? ps.records : []).map(r => r.geometry ? (r.geometry.type === 'Polygon' ? 'POLYGON' : r.geometry.type === 'MultiPolygon' ? 'MULTIPOLYGON' : r.geometry.type === 'Point' ? 'POINT' : 'LINE') : null).filter(Boolean));
    return M.ok(freeze({ sourceAssetId: asset.id, coordinateReference: ref, crs: crsOf(ref), geometryType: types.size === 1 ? [...types][0] : types.size ? 'MIXED' : 'POLYGON', authoritative: !!authoritative,
      sourceVersion: asset.metadata && asset.metadata.sourceVersion || String(asset.version || 1), notes: declared && parsedRef && declared !== parsedRef && parsedRef !== 'UNKNOWN' ? `declarado ${declared} ≠ verificado ${parsedRef}` : undefined }));
  }

  // ------------------------------------------------------------------ features
  /** featureDraft(id, points, properties, crsRef) → GeometryFeatureDraft (+ derived metrics; geometry untouched) */
  function featureDraft(sourceFeatureId, points, properties = {}, crsRef = 'UNKNOWN', extra = {}) {
    const raw = Array.isArray(points) ? points : null;
    const okPts = raw && raw.length >= 3 && raw.every(p => Array.isArray(p) && finite(p[0]) && finite(p[1]));
    const ring = okPts ? G.openRing(raw) : null, bb = ring && ring.length >= 3 ? G.bbox(ring) : null;
    return freeze({ sourceFeatureId, geometry: freeze({ type: 'Polygon', coordinates: raw ? [raw] : null }), properties: freeze({ ...properties }), bbox: bb ? [bb.minX, bb.minY, bb.maxX, bb.maxY] : undefined,
      centroid: ring && ring.length >= 3 ? G.centroid(ring) : undefined, candidateLotId: extra.candidateLotId, matchConfidence: extra.matchConfidence, coordinateReference: crsRef, ring,
      geometryChecksum: raw ? M.checksum(raw) : null, sourceRecordRef: extra.sourceRecordRef || null });
  }
  /** featuresFromRecords(normalizedRecords, descriptor) — polygon from the mapped geometry.polygon field */
  function featuresFromRecords(records, descriptor, candidateIdOf) {
    return freeze(records.filter(r => 'geometry.polygon' in r.values).map(r => featureDraft(`${r.sourceAssetId}#${r.recordRef}`, r.values['geometry.polygon'], {}, descriptor.coordinateReference,
      { candidateLotId: candidateIdOf ? candidateIdOf(r) : undefined, sourceRecordRef: r.recordRef, matchConfidence: undefined })));
  }

  // ------------------------------------------------------------------ validation (§99)
  /** validateFeatures(features, { bounds:{minX,minY,maxX,maxY} }) → issues[{ severity:'BLOCKING'|'ERROR'|'WARNING', code, featureId, detail }] */
  function validateFeatures(features, { bounds = null, overlapEps = 0.5 } = {}) {
    const issues = [], push = (severity, code, featureId, detail) => issues.push(freeze({ severity, code, featureId, detail: detail || null }));
    const keys = new Map(), valid = [];
    for (const f of features) {
      const raw = f.geometry.coordinates && f.geometry.coordinates[0];
      if (!raw) { push('BLOCKING', 'EMPTY_POLYGON', f.sourceFeatureId); continue; }
      if (!f.ring) { push('BLOCKING', 'NON_FINITE', f.sourceFeatureId); continue; }
      const distinct = new Set(f.ring.map(p => p[0] + ',' + p[1])).size;
      if (distinct < 3) { push('BLOCKING', 'INVALID_RING', f.sourceFeatureId, 'menos de 3 vértices distintos'); continue; }
      const area = Math.abs(G.signedArea(f.ring));
      if (!(area > 0)) { push('BLOCKING', 'ZERO_AREA', f.sourceFeatureId); continue; }
      const si = G.selfIntersections(f.ring); if (si.length) push('BLOCKING', 'SELF_INTERSECTION', f.sourceFeatureId, `${si.length} cruzamento(s)`);
      const k = f.ring.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).sort().join(';');
      if (keys.has(k)) push('BLOCKING', 'DUPLICATE_GEOMETRY', f.sourceFeatureId, `igual a ${keys.get(k)}`); else keys.set(k, f.sourceFeatureId);
      if (bounds && (f.bbox[0] < bounds.minX || f.bbox[1] < bounds.minY || f.bbox[2] > bounds.maxX || f.bbox[3] > bounds.maxY)) push('WARNING', 'OUTSIDE_EXPECTED_BOUNDS', f.sourceFeatureId);
      valid.push(f);
    }
    // overlap: a vertex clearly inside another polygon (beyond eps; shared edges between neighbours are fine)
    const idx = App.geo.spatialIndex ? App.geo.spatialIndex.build(valid.map((f, i) => ({ bbox: { minX: f.bbox[0], minY: f.bbox[1], maxX: f.bbox[2], maxY: f.bbox[3] }, featureIndex: i, lotId: f.sourceFeatureId }))) : null;
    const seenPair = new Set();
    for (const f of valid) {
      const cands = idx ? idx.search({ minX: f.bbox[0], minY: f.bbox[1], maxX: f.bbox[2], maxY: f.bbox[3] }).map(h => valid[h.featureIndex]).filter(Boolean) : valid;
      for (const g of cands) {
        if (g === f) continue; const pair = [f.sourceFeatureId, g.sourceFeatureId].sort().join('|'); if (seenPair.has(pair)) continue; seenPair.add(pair);
        if (f.ring.some(p => G.signedDist(p[0], p[1], g.ring) > overlapEps) || g.ring.some(p => G.signedDist(p[0], p[1], f.ring) > overlapEps)) push('ERROR', 'OVERLAP', f.sourceFeatureId, `sobrepõe ${g.sourceFeatureId}`);
      }
    }
    return freeze(issues);
  }

  // ------------------------------------------------------------------ matching (§94–98)
  /** matchFeatures(features, drafts, { lotCrsRef, approvedTransform }) → { matches[], unmatchedFeatures[], lotsWithoutGeometry[], duplicateMatches[] } */
  function matchFeatures(features, drafts, { lotCrsRef = null } = {}) {
    const ids = new Set(drafts.map(d => d.canonicalLotId)), byExt = new Map(drafts.filter(d => d.sourceExternalId != null).map(d => [String(d.sourceExternalId), d.canonicalLotId]));
    const matches = [], unmatched = [];
    for (const f of features) {
      let lotId = null, method = null, confidence = null;
      if (f.candidateLotId && ids.has(f.candidateLotId)) { lotId = f.candidateLotId; method = 'BLOCK_LOT'; confidence = 'HIGH'; }
      else if (f.properties && f.properties.id != null && ids.has(String(f.properties.id))) { lotId = String(f.properties.id); method = 'SOURCE_ID'; confidence = 'HIGH'; }
      else if (f.properties && f.properties.id != null && byExt.has(String(f.properties.id))) { lotId = byExt.get(String(f.properties.id)); method = 'SOURCE_ID'; confidence = 'MEDIUM'; }
      else if (lotCrsRef && f.coordinateReference === lotCrsRef && f.centroid) {
        const hit = drafts.filter(d => polyOf(d) && G.pointInRing(f.centroid[0], f.centroid[1], G.openRing(polyOf(d))));
        if (hit.length === 1) { lotId = hit[0].canonicalLotId; method = 'SPATIAL'; confidence = 'MEDIUM'; }
      }
      if (!lotId) { unmatched.push(f.sourceFeatureId); continue; }
      matches.push(freeze({ geometryFeatureId: f.sourceFeatureId, lotId, matchMethod: method, confidence, approved: confidence === 'HIGH' && method !== 'SPATIAL', approvalBasis: confidence === 'HIGH' && method !== 'SPATIAL' ? 'DETERMINISTIC_KEY' : null }));
    }
    const per = new Map(); matches.forEach(m => per.set(m.lotId, [...(per.get(m.lotId) || []), m.geometryFeatureId]));
    const duplicateMatches = [...per].filter(([, fs]) => fs.length > 1).map(([lotId, fs]) => freeze({ lotId, features: freeze(fs) }));
    const lotsWithoutGeometry = drafts.filter(d => !per.has(d.canonicalLotId)).map(d => d.canonicalLotId);
    return freeze({ matches: freeze(matches), unmatchedFeatures: freeze(unmatched), lotsWithoutGeometry: freeze(lotsWithoutGeometry), duplicateMatches: freeze(duplicateMatches) });
  }
  /** a reviewer approves a non-deterministic match (MANUAL / SPATIAL) — recorded, never implicit */
  const approveMatch = (m, by, at) => by ? M.ok(freeze({ ...m, approved: true, approvalBasis: 'HUMAN', approvedBy: by, approvedAt: at })) : M.fail('VALIDATION_ERROR', 'aprovador obrigatório');

  // ------------------------------------------------------------------ repair (§100–101)
  function repairRecord(feature, issueCode, repairMethod, repairedPoints, approvedBy) {
    if (!feature.geometry.coordinates) return M.fail('GEOMETRY_INVALID', 'sem geometria de origem');
    return M.ok(freeze({ featureId: feature.sourceFeatureId, issueCode, repairMethod, sourceGeometryChecksum: M.checksum(feature.geometry.coordinates[0]), repairedGeometryChecksum: M.checksum(repairedPoints),
      repairedGeometry: freeze({ type: 'Polygon', coordinates: [repairedPoints] }), approvedBy: approvedBy || undefined, derived: true }));
  }

  // ------------------------------------------------------------------ alignment (§102–106): affine least squares from anchors
  function solve3(A, b) { // Gaussian elimination 3x3
    const m = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 3; c++) { let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r; if (Math.abs(m[p][c]) < 1e-12) return null; [m[c], m[p]] = [m[p], m[c]];
      for (let r = 0; r < 3; r++) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k]; } }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  }
  /** fitAffine({ anchors:[{ id, source:[x,y], target:[x,y], kind }], sourceRef, targetRef }) → ok(GeometryTransform PROPOSED + residuals) | fail */
  function fitAffine({ anchors = [], sourceRef, targetRef }) {
    if (anchors.length < 3) return M.fail('GEOMETRY_ALIGNMENT_FAILED', 'mínimo 3 pontos de controle');
    const ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    for (const a of anchors) { const r = [a.source[0], a.source[1], 1]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) ata[i][j] += r[i] * r[j]; bx[i] += r[i] * a.target[0]; by[i] += r[i] * a.target[1]; } }
    const px = solve3(ata, bx), py = solve3(ata, by);
    if (!px || !py) return M.fail('GEOMETRY_ALIGNMENT_FAILED', 'pontos de controle colineares');
    const apply = p => [px[0] * p[0] + px[1] * p[1] + px[2], py[0] * p[0] + py[1] * p[1] + py[2]];
    const residuals = anchors.map(a => { const q = apply(a.source); return freeze({ anchorId: a.id || null, residual: Math.hypot(q[0] - a.target[0], q[1] - a.target[1]) }); });
    const rms = Math.sqrt(residuals.reduce((s, r) => s + r.residual * r.residual, 0) / residuals.length);
    return M.ok(freeze({ id: M.id('gtx', sourceRef, targetRef, anchors.map(a => [a.source, a.target])), sourceCoordinateRef: sourceRef, targetCoordinateRef: targetRef, transformType: 'AFFINE',
      matrix: freeze([px[0], py[0], px[1], py[1], px[2], py[2]]), anchorCount: anchors.length, residuals: freeze(residuals), anchorResidualRms: rms, anchorResidualMax: Math.max(...residuals.map(r => r.residual)),
      status: 'PROPOSED', approvedBy: null, approvedAt: null, valueState: 'calculado', version: '1.0.0' }));
  }
  /** human approval of a visual alignment (§105, §108); without it the transform cannot be used */
  const approveTransform = (t, by, at, note) => by ? M.ok(freeze({ ...t, status: 'APPROVED', approvedBy: by, approvedAt: at, note: note || null })) : M.fail('VALIDATION_ERROR', 'alinhamento exige aprovação humana');
  /** transformPoints(points, transform) — refuses anything not APPROVED; result keeps the target reference + "calculado" state */
  function transformPoints(points, t) {
    if (!t || t.status !== 'APPROVED') return M.fail('GEOMETRY_ALIGNMENT_FAILED', 'transformação não aprovada: coordenadas permanecem na referência de origem');
    const [a, b, c, d, e, f] = t.matrix;
    return M.ok(freeze({ coordinateReference: t.targetCoordinateRef, valueState: 'calculado', points: points.map(p => [a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f]) }));
  }
  /** centroid / edge deltas between two versions of the same features (§106, §344) */
  function geometryDelta(before, after) {
    const out = []; const b = new Map(before.map(f => [f.lotId, f]));
    for (const f of after) { const o = b.get(f.lotId); if (!o) continue; if (o.geometryChecksum !== f.geometryChecksum) out.push(freeze({ lotId: f.lotId, centroidDelta: o.centroid && f.centroid ? Math.hypot(o.centroid[0] - f.centroid[0], o.centroid[1] - f.centroid[1]) : null })); }
    return freeze(out);
  }

  // ------------------------------------------------------------------ bundle + indexes (§109–111, §180–182)
  /** buildArtifacts({ drafts (with polygon), dev, crsRef, sourceGeometryVersion, organizationId }) → { manifest, bundleChecksum, spatialIndexInfo, mapLotIndex } */
  function buildArtifacts({ drafts, dev, crsRef, sourceGeometryVersion, organizationId, developmentId }) {
    const lots = drafts.filter(polyOf).map(d => ({ identity: { id: d.canonicalLotId }, geometry: { polygon: polyOf(d), centroid: null, bounds: null } }));
    const bundle = G.buildBundle({ organizationId, developmentId, dev, lots, sourceGeometryVersion });
    const crs = crsOf(crsRef);
    const manifest = freeze({ ...bundle.manifest, coordinateReference: crs.type === 'PIXEL_SPACE' && dev ? G.crsFor(dev) : freeze({ type: crs.type, ref: crs.ref, epsgCode: crs.epsgCode }), sourceRefs: freeze(drafts.filter(polyOf).length ? ['onboarding: GeometryFeatureDraft aprovado → geometry.polygon'] : []) });
    const si = App.geo.spatialIndex ? App.geo.spatialIndex.build(bundle.features.filter(f => f.ring).map(f => ({ bbox: f.bbox, lotId: f.lotId, featureIndex: f.featureIndex }))) : null;
    const mapLotIndex = freeze(drafts.map(d => freeze({ lotId: d.canonicalLotId, blockCode: d.blockCode, lotNumber: d.lotNumber, aliases: freeze([d.canonicalLotId, `Q${d.blockCode} L${d.lotNumber}`, `${d.blockCode}${d.lotNumber}`, `L${d.lotNumber}`]) })));
    return freeze({ manifest, features: bundle.features, labelAnchors: bundle.labelAnchors, bundleChecksum: M.checksum({ s: manifest.sourceChecksum, r: manifest.renderChecksum }),
      spatialIndexInfo: si ? freeze({ type: si.type, version: si.version, size: si.size }) : null, mapLotIndex, mapLotIndexChecksum: M.checksum(mapLotIndex) });
  }

  return freeze({ crsOf, describeSource, featureDraft, featuresFromRecords, validateFeatures, matchFeatures, approveMatch, repairRecord, fitAffine, approveTransform, transformPoints, geometryDelta, buildArtifacts });
})();
