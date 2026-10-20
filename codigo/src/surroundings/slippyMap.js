/* surroundings/slippyMap.js — round 7 (2026-10-19): a small self-written raster "slippy map" (App.surroundings.slippy). No library.
   - Web Mercator, 256-px tiles from the configured keyless provider (OpenStreetMap), drawn as <img> elements at integer
     zoom and integer CSS pixels (no resampling → crisp on HiDPI screens; no @2x tiles, which would quadruple the requests).
   - Requests stay modest (OSM tile usage policy): only the tiles in view plus at most one ring, nothing in advance, no bulk
     download, no Service Worker caching (the worker ignores cross-origin requests), tiles outside view are dropped.
   - Interaction: drag / one-finger pan (pointer events), wheel and pinch zoom in whole steps anchored on the pointer,
     keyboard (arrows pan, + / − zoom) on the focusable viewport; buttons are wired by the caller (zoomBy / recenter).
   - Failure: when tiles cannot load (offline, CSP of the host, blocked network) the tile pane hides, onTileStatus('FAILED')
     fires and no further tile is requested until retryTiles(); overlays keep working on the neutral background.
   create(viewportEl, opts) → { zoomBy, setZoom, recenter, addLayer, getView, retryTiles, tileStats, destroy } */
(function () {
  const G = () => (typeof App !== 'undefined' && App.surroundings && App.surroundings.geo) || require('./geoMercator.js');
  const TAP_PX = 6, WHEEL_STEP = 60, WHEEL_GAP_MS = 220, FAIL_AFTER = 3, FAIL_TIMEOUT_MS = 10000;

  function create(vp, o) {
    const g = G(), doc = vp.ownerDocument, win = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    const minZ = o.minZoom, maxZ = o.maxZoom, layers = [], tiles = new Map(), pointers = new Map(), off = [];
    let z = Math.max(minZ, Math.min(maxZ, Math.round(o.zoom))), W = 0, H = 0, origin = { x: 0, y: 0 }, raf = 0;
    let c = g.toPixel(o.center.lat, o.center.lon, z); // map centre in world pixels at zoom z
    let stats = { requested: 0, loaded: 0, failed: 0, status: 'IDLE' }, failTimer = 0, stopped = false;
    let drag = null, pinch = null, suppressClick = false, wheelAcc = 0, wheelAt = 0;

    const pane = doc.createElement('div'); pane.className = 'smpane';
    const tileEl = doc.createElement('div'); tileEl.className = 'smtiles'; tileEl.setAttribute('aria-hidden', 'true');
    pane.appendChild(tileEl); vp.appendChild(pane);
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); off.push(() => el.removeEventListener(ev, fn, opt)); };

    function setStatus(s) { if (stats.status === s) return; stats.status = s; if (o.onTileStatus) o.onTileStatus(s, { ...stats }); }
    function clampCenter() {
      if (!o.bounds) return;
      const a = g.toPixel(o.bounds.north, o.bounds.west, z), b = g.toPixel(o.bounds.south, o.bounds.east, z);
      c = { x: Math.max(a.x, Math.min(b.x, c.x)), y: Math.max(a.y, Math.min(b.y, c.y)) };
    }
    function view() {
      return { z, ox: origin.x, oy: origin.y, width: W, height: H, center: g.fromPixel(c.x, c.y, z),
        toPane: (lat, lon) => { const p = g.toPixel(lat, lon, z); return [p.x - origin.x, p.y - origin.y]; } };
    }
    function measure() { W = vp.clientWidth || 0; H = vp.clientHeight || 0; }
    function transformPane() {
      const tx = Math.round(origin.x - (c.x - W / 2)), ty = Math.round(origin.y - (c.y - H / 2));
      pane.style.transform = `translate3d(${tx}px,${ty}px,0)`;
    }
    function updateTiles() {
      const want = new Set();
      if (!stopped && W && H) {
        for (const t of g.visibleTiles({ cx: c.x, cy: c.y, z, width: W, height: H, margin: 1 })) {
          want.add(t.key); if (tiles.has(t.key)) continue;
          const img = doc.createElement('img');
          img.className = 'smtile'; img.alt = ''; img.width = 256; img.height = 256; img.draggable = false; img.decoding = 'async';
          img.referrerPolicy = o.referrerPolicy || 'strict-origin-when-cross-origin';
          img.style.left = (t.left - origin.x) + 'px'; img.style.top = (t.top - origin.y) + 'px';
          img.dataset.z = t.z; img.dataset.left = t.left; img.dataset.top = t.top;
          img.onload = () => { stats.loaded++; img.classList.add('ok'); clearTimeout(failTimer); tileEl.hidden = false; setStatus('OK'); };
          img.onerror = () => { stats.failed++; img.remove(); tiles.delete(t.key); if (!stats.loaded && stats.failed >= FAIL_AFTER) fail(); };
          stats.requested++; img.src = g.tileUrl(o.tileUrlTemplate, t);
          tiles.set(t.key, img); tileEl.appendChild(img);
        }
        if (stats.status === 'IDLE') { setStatus('LOADING'); clearTimeout(failTimer); failTimer = setTimeout(() => { if (!stats.loaded) fail(); }, FAIL_TIMEOUT_MS); }
      }
      for (const [k, img] of tiles) if (!want.has(k)) { img.onload = img.onerror = null; img.removeAttribute('src'); img.remove(); tiles.delete(k); }
    }
    function fail() { stopped = true; clearTimeout(failTimer); tileEl.hidden = true; for (const img of tiles.values()) { img.onload = img.onerror = null; img.removeAttribute('src'); img.remove(); } tiles.clear(); setStatus('FAILED'); }
    function reset() { // full re-render at the current zoom: new origin, tiles re-placed, layers redrawn
      measure(); clampCenter();
      origin = { x: Math.round(c.x - W / 2), y: Math.round(c.y - H / 2) };
      for (const img of tiles.values()) if (+img.dataset.z !== z) { img.onload = img.onerror = null; img.removeAttribute('src'); img.remove(); }
      for (const [k, img] of tiles) if (+img.dataset.z !== z) tiles.delete(k); else { img.style.left = (+img.dataset.left - origin.x) + 'px'; img.style.top = (+img.dataset.top - origin.y) + 'px'; }
      transformPane(); updateTiles();
      const v = view(); for (const l of layers) l.render(v);
      if (o.onView) o.onView(v);
    }
    function schedule() { if (raf) return; raf = (win && win.requestAnimationFrame ? win.requestAnimationFrame : f => setTimeout(f, 16))(() => { raf = 0; clampCenter(); transformPane(); updateTiles(); if (o.onView) o.onView(view()); }); }
    function panBy(dx, dy) { c = { x: c.x + dx, y: c.y + dy }; schedule(); }
    /** setZoom(nz, anchor) — anchor = viewport point [px, py] that stays fixed (default: centre) */
    function setZoom(nz, anchor) {
      nz = Math.max(minZ, Math.min(maxZ, Math.round(nz))); if (nz === z) return false;
      const ax = anchor ? anchor[0] - W / 2 : 0, ay = anchor ? anchor[1] - H / 2 : 0, k = Math.pow(2, nz - z);
      c = { x: (c.x + ax) * k - ax, y: (c.y + ay) * k - ay }; z = nz; reset(); return true;
    }
    const zoomBy = (d, anchor) => setZoom(z + d, anchor);
    function recenter(center, zoom) { const cz = zoom != null ? Math.max(minZ, Math.min(maxZ, Math.round(zoom))) : z; z = cz; c = g.toPixel(center.lat, center.lon, z); reset(); }
    const local = e => { const r = vp.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    on(vp, 'pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      if (e.target.closest && e.target.closest('button,a,input,label')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) { drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, captured: false }; suppressClick = false; }
      else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; drag = null; suppressClick = true; }
    });
    on(vp, 'pointermove', e => {
      const p = pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, r = vp.getBoundingClientRect();
        const mid = [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
        if (d / pinch.d >= Math.SQRT2) { if (setZoom(z + 1, mid)) pinch.d = d; else pinch.d = d; }
        else if (d / pinch.d <= Math.SQRT1_2) { if (setZoom(z - 1, mid)) pinch.d = d; else pinch.d = d; }
        e.preventDefault(); return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved >= TAP_PX && !drag.captured) { drag.captured = true; suppressClick = true; vp.classList.add('dragging'); try { vp.setPointerCapture(e.pointerId); } catch (x) { /* already released */ } }
      if (drag.captured) { panBy(-dx, -dy); e.preventDefault(); }
    });
    const up = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (drag && drag.id === e.pointerId) { if (drag.captured) { vp.classList.remove('dragging'); reset(); } drag = null; }
    };
    on(vp, 'pointerup', up); on(vp, 'pointercancel', up); on(vp, 'lostpointercapture', e => { if (drag && drag.id === e.pointerId) up(e); });
    on(vp, 'click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
    on(vp, 'wheel', e => {
      e.preventDefault();
      const now = Date.now(); wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (Math.abs(wheelAcc) < WHEEL_STEP || now - wheelAt < WHEEL_GAP_MS) return;
      wheelAt = now; const d = wheelAcc < 0 ? 1 : -1; wheelAcc = 0; zoomBy(d, local(e));
    }, { passive: false });
    on(vp, 'keydown', e => {
      if (e.target !== vp) return;
      const step = 80, k = e.key;
      if (k === 'ArrowLeft') panBy(-step, 0); else if (k === 'ArrowRight') panBy(step, 0); else if (k === 'ArrowUp') panBy(0, -step); else if (k === 'ArrowDown') panBy(0, step);
      else if (k === '+' || k === '=') zoomBy(1); else if (k === '-' || k === '_') zoomBy(-1);
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    let ro = null;
    if (win && win.ResizeObserver) { ro = new win.ResizeObserver(() => { const w = vp.clientWidth, h = vp.clientHeight; if (w !== W || h !== H) reset(); }); ro.observe(vp); }

    const api = {
      zoomBy, setZoom, recenter, getView: view, getZoom: () => z, minZoom: minZ, maxZoom: maxZ,
      /** addLayer({ mount(pane), render(view) }) — overlays live in the pane, so a pan only moves the pane */
      addLayer(l) { if (l.mount) l.mount(pane); layers.push(l); if (W) l.render(view()); return l; },
      retryTiles() { stopped = false; stats = { requested: 0, loaded: 0, failed: 0, status: 'IDLE' }; tileEl.hidden = false; reset(); },
      tileStats: () => ({ ...stats, inDom: tiles.size }),
      refresh: reset,
      destroy() { clearTimeout(failTimer); if (ro) ro.disconnect(); off.forEach(f => f()); for (const img of tiles.values()) { img.onload = img.onerror = null; img.removeAttribute('src'); } tiles.clear(); pane.remove(); }
    };
    reset();
    return api;
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.slippy = api; }
})();
