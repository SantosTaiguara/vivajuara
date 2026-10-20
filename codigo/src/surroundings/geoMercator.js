/* surroundings/geoMercator.js — round 7 (2026-10-19): projection math of the keyless Entorno map (App.surroundings.geo).
   Pure functions, no DOM, no network. Used by slippyMap.js / entornoView.js and by tests/entorno.test.js.
   - Web Mercator (EPSG:3857): normalized world coordinates x, y ∈ [0, 1); world pixel at zoom z = normalized × 256 × 2^z.
   - Tiles: the OSM "slippy map" scheme (z/x/y, 256 px). visibleTiles() lists only the tiles in view plus at most 1 ring.
   - Distances: haversine on the mean Earth radius; rings are geodesic circles (spherical destination point) projected to Mercator.
   - Plan georeferencing: least-squares affine from the lots' plan-pixel polygon centroids (area-weighted) to their KMZ
     latitude/longitude, fitted in Mercator metres. Residuals are reported in metres (haversine), never hidden. */
(function () {
  const TILE = 256, R_MERC = 6378137, R_MEAN = 6371008.8, MAX_LAT = 85.0511287798, D2R = Math.PI / 180;
  const clampLat = lat => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  /** project(lat, lon) → normalized Web Mercator { x, y } (y grows southwards) */
  function project(lat, lon) {
    const s = Math.sin(clampLat(lat) * D2R);
    return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
  }
  /** unproject(x, y) → { lat, lon } */
  function unproject(x, y) {
    return { lat: 90 - 360 * Math.atan(Math.exp((y - 0.5) * 2 * Math.PI)) / Math.PI, lon: x * 360 - 180 };
  }
  const worldSize = z => TILE * Math.pow(2, z);
  /** toPixel(lat, lon, z) → world pixel { x, y } at zoom z; fromPixel is its inverse */
  function toPixel(lat, lon, z) { const p = project(lat, lon), S = worldSize(z); return { x: p.x * S, y: p.y * S }; }
  function fromPixel(px, py, z) { const S = worldSize(z); return unproject(px / S, py / S); }
  /** metresPerPixel(lat, z) — ground resolution of a 256-px Mercator tile pyramid at that latitude */
  const metresPerPixel = (lat, z) => (2 * Math.PI * R_MERC * Math.cos(lat * D2R)) / worldSize(z);
  /** EPSG:3857 metres ↔ normalized */
  const toMerc = (lat, lon) => { const p = project(lat, lon); return { X: (p.x - 0.5) * 2 * Math.PI * R_MERC, Y: (0.5 - p.y) * 2 * Math.PI * R_MERC }; };
  const mercToNorm = (X, Y) => ({ x: X / (2 * Math.PI * R_MERC) + 0.5, y: 0.5 - Y / (2 * Math.PI * R_MERC) });

  /** haversine({lat,lon}, {lat,lon}) → metres */
  function haversine(a, b) {
    const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
    return 2 * R_MEAN * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /** destination({lat,lon}, bearingDeg, metres) → { lat, lon } on the sphere (same radius as haversine) */
  function destination(c, bearingDeg, metres) {
    const d = metres / R_MEAN, t = bearingDeg * D2R, f1 = c.lat * D2R, l1 = c.lon * D2R;
    const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
    return { lat: f2 / D2R, lon: ((l2 / D2R + 540) % 360) - 180 };
  }
  /** ring(center, metres, n) → n points of a geodesic circle (north first, clockwise) */
  function ring(center, metres, n = 128) {
    const out = []; for (let i = 0; i < n; i++) out.push(destination(center, (360 * i) / n, metres)); return out;
  }
  /** envelope(center, metres) → { north, south, east, west } of the circle */
  function envelope(center, metres) {
    return { north: destination(center, 0, metres).lat, south: destination(center, 180, metres).lat, east: destination(center, 90, metres).lon, west: destination(center, 270, metres).lon };
  }

  /** polygonCentroid([[x,y],…]) → area-weighted centroid [x, y] (closed or open ring); vertex mean when the area is 0 */
  function polygonCentroid(p) {
    const n = p.length; if (!n) return null;
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % n], c = x0 * y1 - x1 * y0; A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c; }
    if (Math.abs(A) < 1e-12) return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
    return [cx / (3 * A), cy / (3 * A)];
  }
  function solve3(M, v) { // Gauss-Jordan with partial pivoting
    const A = M.map((r, i) => [...r, v[i]]);
    for (let i = 0; i < 3; i++) {
      let m = i; for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k;
      [A[i], A[m]] = [A[m], A[i]]; if (Math.abs(A[i][i]) < 1e-12) return null;
      for (let k = 0; k < 3; k++) if (k !== i) { const f = A[k][i] / A[i][i]; for (let j = i; j <= 3; j++) A[k][j] -= f * A[i][j]; }
    }
    return A.map((r, i) => r[3] / r[i]);
  }
  /** fitAffine([{ src: [x, y], dst: [X, Y] }]) → [a, b, c, d, e, f] with X = a·x + c·y + e, Y = b·x + d·y + f (CSS matrix order).
      Source coordinates are centred before the normal equations (numerical stability); null with < 3 pairs or degenerate input. */
  function fitAffine(pairs) {
    if (!pairs || pairs.length < 3) return null;
    const mx = pairs.reduce((s, q) => s + q.src[0], 0) / pairs.length, my = pairs.reduce((s, q) => s + q.src[1], 0) / pairs.length;
    const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], vX = [0, 0, 0], vY = [0, 0, 0];
    for (const q of pairs) { const r = [q.src[0] - mx, q.src[1] - my, 1]; for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; vX[i] += r[i] * q.dst[0]; vY[i] += r[i] * q.dst[1]; } }
    const sx = solve3(M, vX), sy = solve3(M, vY); if (!sx || !sy) return null;
    return [sx[0], sy[0], sx[1], sy[1], sx[2] - sx[0] * mx - sx[1] * my, sy[2] - sy[0] * mx - sy[1] * my];
  }
  const applyAffine = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  /** lotGeo(lot) → { id, polygon, lat, lon } from a domain lot (geometry.polygon, location.latitude/longitude) or a raw lots.json row (p, lat, lon) */
  function lotGeo(l) {
    if (!l) return null;
    if (l.geometry || l.location) return { id: l.identity ? l.identity.id : l.id, code: l.identity ? l.identity.code : l.id, polygon: l.geometry && l.geometry.polygon, lat: l.location && l.location.latitude, lon: l.location && l.location.longitude };
    return { id: l.id, code: l.id, polygon: l.p, lat: l.lat, lon: l.lon };
  }
  /** planGeoref(lots) → { planToMerc: affine plan unit → EPSG:3857 metres, planToNorm: affine plan unit → normalized Mercator,
      residuals: { n, meanMeters, maxMeters, worstId }, perLot } — only lots that carry both a polygon and a KMZ lat/lon are used
      (nothing is filled in). null when fewer than 3 lots qualify. */
  function planGeoref(lots) {
    const rows = [];
    for (const raw of lots || []) {
      const g = lotGeo(raw); if (!g || !Array.isArray(g.polygon) || g.polygon.length < 3 || typeof g.lat !== 'number' || typeof g.lon !== 'number' || !isFinite(g.lat) || !isFinite(g.lon)) continue;
      const c = polygonCentroid(g.polygon), m = toMerc(g.lat, g.lon); rows.push({ id: g.id, c, lat: g.lat, lon: g.lon, src: c, dst: [m.X, m.Y] });
    }
    const A = fitAffine(rows); if (!A) return null;
    const K = 2 * Math.PI * R_MERC, N = [A[0] / K, -A[1] / K, A[2] / K, -A[3] / K, A[4] / K + 0.5, 0.5 - A[5] / K];
    let sum = 0, max = 0, worstId = null; const perLot = [];
    for (const r of rows) {
      const [X, Y] = applyAffine(A, r.c[0], r.c[1]), n = mercToNorm(X, Y), ll = unproject(n.x, n.y), e = haversine(ll, { lat: r.lat, lon: r.lon });
      sum += e; if (e > max) { max = e; worstId = r.id; } perLot.push({ id: r.id, errorMeters: e });
    }
    return { planToMerc: A, planToNorm: N, residuals: { n: rows.length, meanMeters: sum / rows.length, maxMeters: max, worstId }, perLot };
  }
  /** planToLatLon(georef, x, y) → { lat, lon } of a plan point */
  function planToLatLon(G, x, y) { const [nx, ny] = applyAffine(G.planToNorm, x, y); return unproject(nx, ny); }
  /** cssMatrix(planToNorm, z, ox, oy) → 'matrix(a,b,c,d,e,f)' mapping plan units to pane pixels (world pixel at z minus origin) */
  function cssMatrix(N, z, ox, oy) {
    const S = worldSize(z), m = [N[0] * S, N[1] * S, N[2] * S, N[3] * S, N[4] * S - ox, N[5] * S - oy];
    return `matrix(${m.map(v => +v.toFixed(6)).join(',')})`;
  }

  /** visibleTiles({ cx, cy, z, width, height, margin }) → [{ z, x, y, key, left, top }] — the tiles that intersect the viewport
      centred on world pixel (cx, cy), plus `margin` rings (0 or 1; never more). left/top are world pixels of the tile corner. */
  function visibleTiles({ cx, cy, z, width, height, margin = 1 }) {
    const m = Math.max(0, Math.min(1, margin | 0)), n = Math.pow(2, z);
    const x0 = Math.floor((cx - width / 2) / TILE) - m, x1 = Math.floor((cx + width / 2 - 1e-9) / TILE) + m;
    const y0 = Math.max(0, Math.floor((cy - height / 2) / TILE) - m), y1 = Math.min(n - 1, Math.floor((cy + height / 2 - 1e-9) / TILE) + m);
    const out = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const wx = ((x % n) + n) % n; out.push({ z, x: wx, y, key: `${z}/${wx}/${y}`, left: x * TILE, top: y * TILE }); }
    return out;
  }
  /** tileUrl(template, t) → URL from the provider template ({z}/{x}/{y} only; integers checked) */
  function tileUrl(template, t) {
    if (![t.z, t.x, t.y].every(v => Number.isInteger(v) && v >= 0)) throw new Error('tileUrl: coordenadas inválidas');
    return String(template).replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
  }
  /** fitZoom(center, metres, width, height, { minZoom, maxZoom, paddingPx }) → largest integer zoom where the circle fits */
  function fitZoom(center, metres, width, height, o = {}) {
    const lo = o.minZoom != null ? o.minZoom : 0, hi = o.maxZoom != null ? o.maxZoom : 19, pad = o.paddingPx || 0;
    const e = envelope(center, metres);
    for (let z = hi; z >= lo; z--) { const a = toPixel(e.north, e.west, z), b = toPixel(e.south, e.east, z); if (b.x - a.x <= width - 2 * pad && b.y - a.y <= height - 2 * pad) return z; }
    return lo;
  }

  const api = { TILE, R_MERC, R_MEAN, MAX_LAT, project, unproject, worldSize, toPixel, fromPixel, metresPerPixel, toMerc, mercToNorm, haversine, destination, ring, envelope,
    polygonCentroid, fitAffine, applyAffine, lotGeo, planGeoref, planToLatLon, cssMatrix, visibleTiles, tileUrl, fitZoom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.geo = api; }
})();
