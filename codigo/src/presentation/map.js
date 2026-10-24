/* presentation/map.js — MapView: the operational core (SVG renderer adapter).
   Polygons are created once; later updates only change fills and outline classes (no rebuild).
   Semantic zoom: block letters far, lot numbers mid, areas near. Pan, wheel zoom and pinch;
   a drag never selects. Fill = active thematic layer; outlines = interaction state.
   Topic 46 (performance): geometry, IDs, colours and hit results are unchanged. What changed:
   - camera: a pan only translates one wrapper group (#gCam); the viewBox is rewritten when the scale changes
     or after the gesture settles — a viewBox write makes Chrome re-lay out every SVG text label (~25 ms at
     near zoom on a desktop, ~80 ms on a 4× slower CPU), a translate does not (~0.2 ms);
   - camera writes are coalesced to one per animation frame; pointer handlers do not read layout (cached rects);
   - lot labels outside the buffered viewport are culled (display:none) at mid/near zoom, so a zoom step lays
     out only what can be seen; the label policy itself (which labels per zoom bucket) is the same CSS as before;
   - render(): unchanged dirty checks per lot; the z-order pass skips DOM moves that would leave the same order;
   - derived geometry (App.geo, when loaded): bbox, label anchors, validation, a static R-tree, viewport queries
     and a shadow hit test that is checked against the browser's native hit on every click (diagnostics only:
     the lot selected is still the one the browser hit, as before). */
App.MapView = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, at = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) if (v != null) e.setAttribute(k, v); return e; };
  const POI_ICON = { GATE: 'P', CLUB: 'C', PARK: '♣', SQUARE: '•', PLAYGROUND: '★', PUMP_STATION: 'E', PARKING: 'E', ADMIN: 'A' };
  /** migration flags (spec §125); flip to false to fall back to the pre-topic-46 behaviour of one mechanism */
  const FLAGS = { cameraTranslate: true, labelCulling: true, bulkNoTransition: true, shadowHitTest: true };
  const LABEL_BUFFER = 0.6;          // culled-label margin, as a fraction of the visible world size on each side
  const SETTLE_MS = 350;             // commit the viewBox this long after the last translate-only camera move
  const BULK_DIRTY = 60;             // a render that recolours more lots than this skips the per-lot fill transition
  let last = null;                   // most recent view, for technical diagnostics (App.MapView.diagnostics())

  function create(root, dev, cb) {
    const box = root.querySelector('.svgbox'), svg = box.querySelector('svg'), pins = box.querySelector('.pins');
    const g = { bg: svg.querySelector('#gBg'), lots: svg.querySelector('#gLots'), ovl: svg.querySelector('#gOvl'), route: svg.querySelector('#gRoute'), lbl: svg.querySelector('#gLbl'), blk: svg.querySelector('#gBlk'), poi: svg.querySelector('#gPoi') };
    // camera group: every layer moves together; ids and order of the layer groups are unchanged
    let cam = svg.querySelector('#gCam');
    if (!cam) { cam = el('g', { id: 'gCam' }); for (const k of ['bg', 'lots', 'ovl', 'route', 'lbl', 'blk', 'poi']) if (g[k]) cam.appendChild(g[k]); svg.appendChild(cam); }
    const VB0 = { ...dev.map.fit }, MIN_W = 120, MAX_W = VB0.w * 1.35;
    const GEO = App.geo && App.geo.geometry && App.geo.spatialIndex ? App.geo : null, PERF = App.geo && App.geo.perf ? App.geo.perf : null;
    const rec = PERF ? PERF.createRecorder() : null, time = (name, fn) => (rec ? rec.time(name, fn) : fn());
    const HT = App.geo && App.geo.hitTest, PAN_PX = HT ? HT.PAN_THRESHOLD_PX : { mouse: 6, pen: 6, touch: 6 };
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null, on = (t, ev, fn, o = {}) => t.addEventListener(ev, fn, ac ? { ...o, signal: ac.signal } : o);
    let pinSpec = { cmp: [], top: [] }, vb = { ...VB0 }, nodes = new Map(), lotsById = new Map(), labelsById = new Map(), fillOpacity = 0.55, marks = { sel: null, cmp: new Set(), fav: new Set(), dim: null }, raf = 0;
    let geo = null, readiness = PERF ? PERF.Readiness.SHELL_READY : 'SHELL_READY', lastRender = null, shadow = { checks: 0, agree: 0, mismatches: [] }, destroyed = false;

    // ---------- camera state: vb = logical camera; vbC = viewBox committed to the DOM; the difference is a translate on #gCam
    let vbC = null, camDirty = false, camRaf = 0, settleT = 0, zKey = null, scaleKey = null, rectCache = null;
    const rects = () => { if (!rectCache) { const s = svg.getBoundingClientRect(), b = box.getBoundingClientRect(); rectCache = { svg: { left: s.left, top: s.top, width: s.width, height: s.height }, box: { left: b.left, top: b.top, width: b.width, height: b.height } }; } return rectCache; };
    const invalidateRects = () => { rectCache = null; };
    const frameOf = (v, r) => { const s = Math.max(v.w / r.width, v.h / r.height); return { s, ox: (r.width * s - v.w) / 2, oy: (r.height * s - v.h) / 2 }; };
    function writeCamera(force) {
      camDirty = false; rects(); // read the element rect before the camera write (the rect does not depend on the viewBox)
      const sameScale = vbC && vbC.w === vb.w && vbC.h === vb.h;
      if (FLAGS.cameraTranslate && sameScale && !force) {
        const tx = vbC.dx - +vb.x.toFixed(1), ty = vbC.dy - +vb.y.toFixed(1); // drawn origin = the 0.1-rounded camera origin, exactly what a viewBox write would draw
        cam.setAttribute('transform', `translate(${+tx.toFixed(1)} ${+ty.toFixed(1)})`);
        clearTimeout(settleT); settleT = setTimeout(() => { if (!destroyed && camDirty === false && (vbC.x !== vb.x || vbC.y !== vb.y)) writeCamera(true); }, SETTLE_MS);
      } else {
        clearTimeout(settleT);
        svg.setAttribute('viewBox', `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`); // same rounding as always
        vbC = { ...vb, dx: +vb.x.toFixed(1), dy: +vb.y.toFixed(1) };
        if (cam.hasAttribute('transform')) cam.removeAttribute('transform');
      }
      const k = VB0.w / vb.w, z = k < 1.7 ? 'far' : k < 4 ? 'mid' : 'near';
      if (z !== zKey) { svg.dataset.z = z; zKey = z; }
      cullLabels(z);
      schedulePins(); scale();
    }
    /** gestures: one camera write per frame */
    function requestCamera() { camDirty = true; if (camRaf) return; camRaf = requestAnimationFrame(() => { camRaf = 0; if (camDirty && !destroyed) writeCamera(false); }); }
    /** programmatic camera changes write immediately (callers may read screen bounds right after) */
    function setVB() { if (camRaf) { cancelAnimationFrame(camRaf); camRaf = 0; } writeCamera(false); }

    // ---------- label culling (lot number + area texts outside the buffered viewport are not laid out)
    let culledBounds = null, shownLabels = null;
    function cullLabels(z) {
      if (!FLAGS.labelCulling || !geo || !geo.index || z === 'far') return; // far: the stylesheet hides lot labels anyway
      const r = rects().svg; if (!r.width) return;
      const { s, ox, oy } = frameOf(vb, r), vis = { minX: vb.x - ox, minY: vb.y - oy, maxX: vb.x - ox + r.width * s, maxY: vb.y - oy + r.height * s };
      if (culledBounds && vis.minX >= culledBounds.minX && vis.minY >= culledBounds.minY && vis.maxX <= culledBounds.maxX && vis.maxY <= culledBounds.maxY && culledBounds.w === vb.w) return;
      const bw = (vis.maxX - vis.minX) * LABEL_BUFFER, bh = (vis.maxY - vis.minY) * LABEL_BUFFER;
      const b = { minX: vis.minX - bw, minY: vis.minY - bh, maxX: vis.maxX + bw, maxY: vis.maxY + bh, w: vb.w };
      const want = new Set(geo.index.search(b).map(h => h.lotId));
      for (const [id, pair] of labelsById) { const show = want.has(id), was = shownLabels ? shownLabels.has(id) : true; if (show !== was) for (const t of pair) t.style.display = show ? '' : 'none'; }
      shownLabels = want; culledBounds = b;
    }
    function uncullAll() { for (const pair of labelsById.values()) for (const t of pair) if (t.style.display) t.style.display = ''; shownLabels = null; culledBounds = null; }

    // ---------- background (plan / aerial / hybrid)
    const imgPlan = el('image', { x: 0, y: 0, width: dev.map.width, height: dev.map.height, preserveAspectRatio: 'none', class: 'bgplan' });
    const imgAer = el('image', { x: 0, y: 0, width: dev.map.width, height: dev.map.height, preserveAspectRatio: 'none', class: 'bgaer' });
    // widened aerial ends at x = WR.x + WR.w (2208) while the frame is 2247 wide: the east strip repeats the image mirrored
    // (same href, no extra download), as the frame image aerea.webp does; a nested <svg> viewport clips it to the strip
    const WR0 = dev.map.aerialWideRect, EX = WR0 ? WR0.x + WR0.w : 0, EW = WR0 ? Math.max(0, dev.map.width - EX) : 0;
    const aerEdge = EW > 0 ? el('svg', { x: EX, y: WR0.y, width: EW, height: WR0.h, viewBox: `${EX} ${WR0.y} ${EW} ${WR0.h}`, overflow: 'hidden', class: 'bgaer-edge', 'aria-hidden': 'true' }) : null;
    const imgAerE = aerEdge ? el('image', { x: WR0.x, y: WR0.y, width: WR0.w, height: WR0.h, preserveAspectRatio: 'none', transform: `translate(${2 * EX} 0) scale(-1 1)` }) : null;
    if (aerEdge) { aerEdge.appendChild(imgAerE); aerEdge.style.display = 'none'; }
    g.bg.append(...[imgAer, aerEdge, imgPlan].filter(Boolean));
    let bgState = { mode: null };
    function setBackground(mode, urls, blend = 0.42) {
      bgState = { mode };
      const fail = what => cb.onBackgroundError && cb.onBackgroundError(what);
      // widened aerial (dev.map.aerialWideRect, illustrative surroundings) when available; on error fall back once to the frame image
      const WR = dev.map.aerialWideRect, frameRect = { x: 0, y: 0, w: dev.map.width, h: dev.map.height };
      const setAer = (href, r) => { const wide = r !== frameRect; if (aerEdge) { aerEdge.style.display = wide && (mode === 'aerial' || mode === 'hybrid') ? '' : 'none'; if (wide && imgAerE.getAttribute('href') !== href) imgAerE.setAttribute('href', href); }
        if (imgAer.getAttribute('href') === href) return; imgAer.setAttribute('x', r.x); imgAer.setAttribute('y', r.y); imgAer.setAttribute('width', r.w); imgAer.setAttribute('height', r.h); imgAer.setAttribute('href', href); };
      imgPlan.onerror = () => fail('planta');
      imgAer.onerror = () => { if (imgAer.dataset.wide === '1' && dev.assets.aerial) { imgAer.dataset.wide = '0'; setAer(urls.aerial || dev.assets.aerial, frameRect); } else fail('imagem aérea'); };
      if (mode === 'aerial' || mode === 'hybrid') {
        if (urls.aerialWide && WR && imgAer.dataset.wide !== '0') { imgAer.dataset.wide = '1'; setAer(urls.aerialWide, WR); }
        else if (urls.aerial) setAer(urls.aerial, frameRect);
        imgAer.style.display = '';
        if (aerEdge) aerEdge.style.display = imgAer.dataset.wide === '1' ? '' : 'none';
      } else { imgAer.style.display = 'none'; if (aerEdge) aerEdge.style.display = 'none'; }
      // beyond the widened picture (tall phone viewports, zoomed out): the picture's mean edge colour instead of a white band
      svg.style.background = (mode === 'aerial' || mode === 'hybrid') && WR ? '#566a48' : '';
      if (mode === 'plan' || mode === 'hybrid') { if (urls.plan && imgPlan.getAttribute('href') !== urls.plan) imgPlan.setAttribute('href', urls.plan); imgPlan.style.display = ''; imgPlan.style.opacity = mode === 'hybrid' ? String(blend) : '1'; } else imgPlan.style.display = 'none';
      fillOpacity = mode === 'plan' ? 0.55 : 0.8;
      svg.style.setProperty('--fo', fillOpacity);
      if (readiness === 'SHELL_READY') readiness = 'BASE_MAP_READY';
    }

    // ---------- geometry, created once
    function init(lots) {
      const t0 = performance.now();
      g.lots.textContent = ''; g.ovl.textContent = ''; g.lbl.textContent = ''; g.blk.textContent = ''; g.poi.textContent = ''; nodes = new Map(); lotsById = new Map(); labelsById = new Map(); shownLabels = null; culledBounds = null;
      geo = null; clearTimeout(geoT); const gen = ++geoGen;
      const draw = () => {
        const fl = document.createDocumentFragment(), fx = document.createDocumentFragment();
        for (const l of lots) {
          const id = l.identity.id, p = l.geometry.polygon; if (!p || p.length < 3) continue; // no geometry → no shape (never invented)
          const d = 'M' + p.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z';
          const path = el('path', { d, class: 'lot', 'data-id': id, 'aria-label': `Quadra ${l.identity.blockId}, lote ${l.identity.lotNumber}` });
          fl.append(path);
          const [cx, cy] = l.geometry.centroid, b = l.geometry.bounds, small = Math.min(b.w, b.h);
          const fs = Math.max(5.5, Math.min(10, small * 0.42));
          const tn = el('text', { x: cx.toFixed(1), y: (cy + fs * 0.1).toFixed(1), class: 'ln', 'font-size': fs.toFixed(1) }); tn.textContent = l.identity.lotNumber;
          const ta = el('text', { x: cx.toFixed(1), y: (cy + fs * 0.95).toFixed(1), class: 'la', 'font-size': (fs * 0.5).toFixed(1) }); ta.textContent = l.geometry.areaM2 != null ? App.fmt.number(l.geometry.areaM2, 0) + ' m²' : '';
          fx.append(tn, ta);
          nodes.set(id, path); lotsById.set(id, l); labelsById.set(id, [tn, ta]);
        }
        g.lots.append(fl); g.lbl.append(fx);
        strikeUnavailable(lots);
        // block letters at the block's centre
        const blocks = new Map();
        for (const l of lots) { const k = l.identity.blockId, e = blocks.get(k) || { n: 0, x: 0, y: 0 }; e.n++; e.x += l.geometry.centroid[0]; e.y += l.geometry.centroid[1]; blocks.set(k, e); }
        for (const [k, e] of blocks) { const t = el('text', { x: (e.x / e.n).toFixed(1), y: (e.y / e.n + 14).toFixed(1), class: 'bl' }); t.textContent = k; g.blk.append(t); }
        for (const p of dev.pois) {
          const gg = el('g', { class: 'poi z' + p.zoom, transform: `translate(${p.at[0]} ${p.at[1]})`, 'data-poi': p.id, role: 'button', tabindex: '0', 'aria-label': `${p.name}: ver informações e imagens da área` });
          gg.append(el('circle', { r: 9, class: 'pc ' + p.type }));
          const ic = el('text', { class: 'pi', y: 3.6 }); ic.textContent = POI_ICON[p.type] || '•';
          const tx = el('text', { class: 'pt', y: 22 }); tx.textContent = p.name;
          const ti = el('title'); ti.textContent = `${p.name} (${p.id}, ${App.fmt.formatSquareMeters(p.areaM2)})`;
          gg.append(ic, tx, ti); g.poi.append(gg);
        }
      };
      time('map_first_render', draw);
      readiness = 'GEOMETRY_READY';
      vbC = null; setVB();
      readiness = 'INTERACTIVE'; // geometry + native hit testing + selection work from here
      initMs = performance.now() - t0;
      // derived geometry (bundle, validation, spatial index) after the first paint; an error here never blocks the map (error boundary)
      if (GEO) geoT = setTimeout(() => { if (destroyed || gen !== geoGen) return; buildGeo(lots); }, 0);
    }
    let initMs = null, geoT = 0, geoGen = 0;
    /** lots withheld from sale (status UNAVAILABLE, e.g. kept by the developer) are struck through in red on every layer;
        the marks sit in #gOvl above the fills, ignore the pointer, and leave the thematic fill and hit test untouched */
    function strikeUnavailable(lots) {
      g.ovl.textContent = '';
      const hit = lots.filter(l => l.availability && l.availability.status === 'UNAVAILABLE' && l.geometry.polygon && l.geometry.polygon.length >= 3);
      if (!hit.length) return;
      const defs = el('defs'), pat = el('pattern', { id: 'vjStrike', patternUnits: 'userSpaceOnUse', width: 5, height: 5, patternTransform: 'rotate(45)' });
      pat.append(el('line', { x1: 0, y1: 0, x2: 0, y2: 5, class: 'strk-l' })); defs.append(pat);
      const fo = document.createDocumentFragment(); fo.append(defs);
      for (const l of hit) {
        const p = l.geometry.polygon, b = l.geometry.bounds;
        const d = 'M' + p.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z';
        const gg = el('g', { class: 'strk', 'data-id': l.identity.id, 'aria-hidden': 'true' });
        gg.append(el('path', { d, class: 'strk-h', fill: 'url(#vjStrike)' }));
        if (b) { // one bold stroke across the lot, clipped to its outline
          const cp = el('clipPath', { id: 'vjStrikeC-' + l.identity.id }); cp.append(el('path', { d })); defs.append(cp);
          gg.append(el('line', { x1: b.x.toFixed(1), y1: (b.y + b.h).toFixed(1), x2: (b.x + b.w).toFixed(1), y2: b.y.toFixed(1), class: 'strk-x', 'clip-path': `url(#vjStrikeC-${l.identity.id})` }));
        }
        fo.append(gg);
      }
      g.ovl.append(fo);
    }
    function buildGeo(lots) {
      try {
        const bundle = time('map_geometry_decode', () => GEO.geometry.buildBundle({ organizationId: dev.tenantId || null, developmentId: dev.id, dev, lots, sourceGeometryVersion: dev.staticDataVersion }));
        const index = time('map_index_build', () => GEO.spatialIndex.build(bundle.features.filter(f => f.ring)));
        const validation = GEO.geometry.validate(lots, { dev, features: bundle.features });
        const compat = GEO.geometry.compatibility(lots.map(l => l.identity.id), bundle.features.filter(f => f.ring).map(f => f.lotId));
        geo = { bundle, index, validation, compat, byId: new Map(bundle.features.map(f => [f.lotId, f])), ht: HT ? HT.create(bundle.features, index) : null };
        readiness = 'FULLY_ENHANCED';
        if (zKey) cullLabels(zKey);
      } catch (e) { if (App.observability && App.observability.platform) App.observability.platform.report(e, 'MapRenderer'); else console.error('geo pipeline', e); geo = null; }
    }

    // ---------- fills and outlines (selective updates)
    function paint(colorOf) { for (const [id, n] of nodes) { const c = colorOf.get(id); if (n.__c !== c) { n.style.fill = c || '#cdd2c9'; n.__c = c; } } }
    const MODEL_ONLY = ['rec', 'rev', 'lfocus', 'lfade', 'stale', 'conf', 'unk'];
    function setMarks(m) {
      const cls = (n, k, on) => { if (n.classList.contains(k) !== on) n.classList.toggle(k, on); };
      const prevSel = marks.sel; marks = { ...marks, ...m };
      // legacy paint path (solar "now" view): drop the classes only a MapRenderModel sets, and force the next render to restyle every lot
      if ('dim' in m || 'fav' in m || 'cmp' in m) for (const [id, n] of nodes) { cls(n, 'dim', !!(marks.dim && !marks.dim.has(id))); cls(n, 'fav', marks.fav.has(id)); cls(n, 'cmp', marks.cmp.has(id)); for (const k of MODEL_ONLY) cls(n, k, false); n.__k = null; }
      if (prevSel && nodes.get(prevSel)) cls(nodes.get(prevSel), 'sel', false);
      if (marks.sel && nodes.get(marks.sel)) { const n = nodes.get(marks.sel); cls(n, 'sel', true); if (g.lots.lastChild !== n) g.lots.appendChild(n); } // on top
      for (const id of marks.cmp) { const n = nodes.get(id); if (n && id !== marks.sel) g.lots.insertBefore(n, nodes.get(marks.sel) && marks.sel ? nodes.get(marks.sel) : null); }
      schedulePins();
    }

    // ---------- MapRenderModel (topic 18): the renderer only draws what the model resolved (fill, outline classes, aria, pins)
    const STYLE_CLASSES = ['dim', 'sel', 'cmp', 'fav', 'rec', 'rev', 'lfocus', 'lfade', 'stale', 'conf', 'unk'];
    let lastModel = null, bulkRaf = 0;
    function render(model) {
      const t0 = performance.now(), prevLayer = lastModel && lastModel.layerMetadata ? lastModel.layerMetadata.layerId : null;
      lastModel = model;
      svg.style.setProperty('--fo', model.baseMap.fillOpacity);
      let selNode = null, dFill = 0, dCls = 0, dAria = 0, moved = 0;
      // many recolours at once (layer switch, filter): no 498 simultaneous fill transitions
      if (FLAGS.bulkNoTransition) { let n = 0; for (const [id, nd] of nodes) { const s = model.lotStylesById.get(id); if (s && nd.__c !== s.fill && ++n > BULK_DIRTY) break; } if (n > BULK_DIRTY) { svg.classList.add('bulk'); cancelAnimationFrame(bulkRaf); bulkRaf = requestAnimationFrame(() => { bulkRaf = requestAnimationFrame(() => { bulkRaf = 0; svg.classList.remove('bulk'); }); }); } }
      for (const [id, n] of nodes) {
        const s = model.lotStylesById.get(id); if (!s) continue;
        if (n.__c !== s.fill) { n.style.fill = s.fill; n.__c = s.fill; dFill++; }
        const op = s.fillOpacity !== model.baseMap.fillOpacity ? String(s.fillOpacity) : '';
        if (n.__op !== op) { n.style.fillOpacity = op; n.__op = op; }
        const key = s.classes.join(' ');
        if (n.__k !== key) { for (const k of STYLE_CLASSES) { const on = s.classes.includes(k); if (n.classList.contains(k) !== on) n.classList.toggle(k, on); } n.__k = key; dCls++; }
        const aria = s.ariaLabelParts.join(', '); if (n.__a !== aria) { n.setAttribute('aria-label', aria); n.__a = aria; dAria++; }
        if (s.classes.includes('sel')) selNode = n;
      }
      // z-order inside the lot group: comparison/recommendation above the rest, selected on top (style precedence).
      // Same final order as always; when the tail of the group already has that order nothing is moved.
      const pri = []; for (const [id, n] of nodes) { const s = model.lotStylesById.get(id); if (s && (s.classes.includes('cmp') || s.classes.includes('rec') || s.classes.includes('rev')) && n !== selNode) pri.push(n); }
      const want = selNode ? [...pri, selNode] : pri; let ok = true;
      for (let i = want.length - 1, c = g.lots.lastChild; i >= 0; i--, c = c && c.previousSibling) if (c !== want[i]) { ok = false; break; }
      if (!ok) { for (const n of pri) if (n.nextSibling) { g.lots.appendChild(n); moved++; } if (selNode) { g.lots.appendChild(selNode); moved++; } }
      g.poi.style.display = model.referenceFeatures.visible ? '' : 'none';
      pinSpec = { model: model.overlayFeatures.pins }; schedulePins();
      const ms = performance.now() - t0, layer = model.layerMetadata ? model.layerMetadata.layerId : null;
      lastRender = { ms: +ms.toFixed(2), dirtyFill: dFill, dirtyClass: dCls, dirtyAria: dAria, moved, layerId: layer };
      if (rec) { rec.record('map_render', ms); if (prevLayer !== layer) { rec.record('map_layer_switch', ms); try { performance.measure('map_layer_switch', { start: t0, duration: ms }); } catch (e) { /* buffer only */ } } }
    }
    /** screen bounds of a lot (for the mobile camera policy) and a pan in screen pixels — from the precomputed bbox */
    function lotScreenBounds(id) {
      const l = lotsById.get(id); if (!l) return null; const b = l.geometry.bounds; if (!b) return null;
      const p0 = toScreen(b.x, b.y), p1 = toScreen(b.x + b.w, b.y + b.h); if (!p0 || !p1) return null;
      return { x0: Math.min(p0[0], p1[0]), y0: Math.min(p0[1], p1[1]), x1: Math.max(p0[0], p1[0]), y1: Math.max(p0[1], p1[1]) };
    }
    let panAnim = 0;
    function panBy(dx, dy, ms = 0) {
      invalidateRects();
      const s = toSvg(0, 0).s, tx = -dx * s, ty = -dy * s;
      if (!ms || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) { vb.x += tx; vb.y += ty; setVB(); return; }
      cancelAnimationFrame(panAnim); const x0 = vb.x, y0 = vb.y, t0 = performance.now();
      const step = now => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); vb.x = x0 + tx * e; vb.y = y0 + ty * e; setVB(); if (k < 1) panAnim = requestAnimationFrame(step); };
      panAnim = requestAnimationFrame(step);
    }

    // ---------- pins (HTML over the map): comparison 1–4, ranking top 5

    function setPins(spec) { pinSpec = spec; schedulePins(); }
    function schedulePins() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; if (!destroyed) drawPins(); }); }
    /** world → px relative to the map box (camera transform; no layout read while the rect cache is valid) */
    function toScreen(x, y) { const R = rects(), r = R.svg; if (!r.width || !r.height) return null; const { s, ox, oy } = frameOf(vb, r); return [r.left + (x - vb.x + ox) / s - R.box.left, r.top + (y - vb.y + oy) / s - R.box.top]; }
    let pinsHtml = null;
    function drawPins() {
      let h = '';
      const at = (id, cls, label, title) => { const l = lotsById.get(id); if (!l) return ''; const s = toScreen(...l.geometry.centroid); if (!s) return ''; return `<span class="pin ${cls}" style="left:${s[0].toFixed(0)}px;top:${s[1].toFixed(0)}px" title="${App.ui.esc(title)}">${label}</span>`; };
      if (pinSpec.model) for (const p of pinSpec.model) h += at(p.lotId, p.kind === 'cmp' ? 'cmp' : p.kind === 'rev' ? 'top rev' : 'top', p.label, p.title);
      else {
        (pinSpec.top || []).forEach((id, i) => { if (!(pinSpec.cmp || []).includes(id)) h += at(id, 'top', i + 1, `${i + 1}º no ranking`); });
        (pinSpec.cmp || []).forEach((id, i) => { h += at(id, 'cmp', i + 1, `Comparação ${i + 1}`); });
      }
      if (h !== pinsHtml) { pins.innerHTML = h; pinsHtml = h; }
      cb.onViewport && cb.onViewport(viewport());
    }

    // ---------- route to gate / club
    function setRoute(pts, label) {
      g.route.textContent = '';
      if (!pts || pts.length < 2) return;
      g.route.append(el('polyline', { points: pts.map(p => p.join(',')).join(' '), class: 'rt-casing' }), el('polyline', { points: pts.map(p => p.join(',')).join(' '), class: 'rt' }));
      const e = pts[pts.length - 1]; g.route.append(el('circle', { cx: e[0], cy: e[1], r: 6, class: 'rt-end' }));
      if (label) { const t = el('text', { x: e[0] + 9, y: e[1] - 8, class: 'rt-lbl' }); t.textContent = label; g.route.append(t); }
    }

    // ---------- viewport
    function viewport() { return { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2, k: VB0.w / vb.w }; }
    function setViewport(v) { if (!v) return fitAll(); invalidateRects(); const w = VB0.w / v.k, h = w * VB0.h / VB0.w; vb = { x: v.x - w / 2, y: v.y - h / 2, w, h }; setVB(); }
    function fitAll() { invalidateRects(); vb = { ...VB0 }; setVB(); }
    /** client px → world (inverse camera transform) */
    function toSvg(cx, cy) { const r = rects().svg; const { s, ox, oy } = frameOf(vb, r); return { x: vb.x - ox + (cx - r.left) * s, y: vb.y - oy + (cy - r.top) * s, s }; }
    function zoomAt(f, cx, cy, gesture) { const p = toSvg(cx, cy); const nw = Math.max(MIN_W, Math.min(MAX_W, vb.w * f)); const k = nw / vb.w; vb = { x: p.x - (p.x - vb.x) * k, y: p.y - (p.y - vb.y) * k, w: nw, h: vb.h * k }; if (gesture) requestCamera(); else setVB(); }
    function zoomBy(f) { invalidateRects(); const r = rects().box; zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); }
    function focusLot(id, zoom = true) {
      const l = lotsById.get(id); if (!l) return;
      invalidateRects();
      const [cx, cy] = l.geometry.centroid, w = zoom ? Math.min(vb.w, 620) : vb.w, h = w * VB0.h / VB0.w;
      vb = { x: cx - w / 2, y: cy - h / 2, w, h }; setVB();
    }
    /** transient emphasis outside the MapRenderModel (it never changes colours or filters):
        flash = search result pulse for a few seconds; highlight = lots of the legend item under the pointer */
    let flashT = 0, hl = new Set();
    function flash(ids, ms = 2600) {
      clearTimeout(flashT); for (const n of nodes.values()) if (n.classList.contains('srch')) n.classList.remove('srch');
      for (const id of ids || []) { const n = nodes.get(id); if (n) n.classList.add('srch'); }
      flashT = setTimeout(() => { for (const id of ids || []) { const n = nodes.get(id); if (n) n.classList.remove('srch'); } }, ms);
    }
    function highlight(ids) {
      for (const id of hl) { const n = nodes.get(id); if (n) n.classList.remove('lhov'); }
      hl = new Set(ids || []); for (const id of hl) { const n = nodes.get(id); if (n) n.classList.add('lhov'); }
      svg.classList.toggle('hashl', hl.size > 0);
    }
    function isVisible(id) { const l = lotsById.get(id); if (!l) return true; const s = toScreen(...l.geometry.centroid), r = rects().box; return !!s && s[0] > 0 && s[1] > 0 && s[0] < r.width && s[1] < r.height; }
    function scale() {
      const sc = root.querySelector('.scale'); if (!sc) return;
      const r = rects().svg; if (!r.width) return;
      const s = Math.max(vb.w / r.width, vb.h / r.height), mpp = s * dev.map.metersPerUnit;
      const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(m => m / mpp >= 60) || 1000, px = nice / mpp;
      const h = `<i style="width:${px.toFixed(0)}px"></i><span>${nice} m</span>`; if (h !== scaleKey) { sc.innerHTML = h; scaleKey = h; }
    }

    // ---------- hit testing: the browser's native hit (event target) decides, as before; the spatial service shadows it
    const lotOrder = () => { const o = new Map(); let i = 0; for (const c of g.lots.children) o.set(c, i++); return o; };
    /** MapHitTestService at a client point, emulating the SVG paint order and stroke widths of the candidates */
    function hitTestAt(clientX, clientY, pointerType = 'mouse') {
      if (!geo || !geo.ht) return null;
      // the drawn transform (rounded viewBox + camera translate), so the world point is exactly the one the browser hit-tests
      const m = g.lots.getScreenCTM(), inv = m && m.inverse(), w = inv ? { x: inv.a * clientX + inv.c * clientY + inv.e, y: inv.b * clientX + inv.d * clientY + inv.f, s: Math.hypot(inv.a, inv.b) } : toSvg(clientX, clientY);
      const ord = lotOrder(), sw = new Map();
      const strokeHalf = id => { if (!sw.has(id)) { const n = nodes.get(id); sw.set(id, n ? (parseFloat(getComputedStyle(n).strokeWidth) || 0) / 2 : 0); } return sw.get(id); };
      return time('map_hit_test', () => geo.ht.hitTest([w.x, w.y], { strokeHalfWidth: strokeHalf, maxStrokeHalfWidth: 2, paintOrder: id => ord.get(nodes.get(id)) ?? -1, worldPerPx: w.s, pointerType }));
    }
    function shadowCheck(e, nativeId) {
      if (!FLAGS.shadowHitTest || !geo || !geo.ht) return;
      try {
        const r = hitTestAt(e.clientX, e.clientY, e.pointerType), id = r && (r.status === 'EXACT' || r.status === 'EDGE_NEAR') ? r.lotId : null;
        shadow.checks++; if (id === nativeId) shadow.agree++; else { shadow.mismatches.push({ nativeId, serviceId: id, status: r && r.status }); if (shadow.mismatches.length > 20) shadow.mismatches.shift(); }
      } catch (err) { /* diagnostics only */ }
    }

    // ---------- pointer: pan, pinch, wheel; a drag never selects
    const pts = new Map(); let moved = 0, pinch0 = null, lastManualPanAt = 0, lastWheelAt = 0, downType = 'mouse';
    on(box, 'wheel', e => { e.preventDefault(); const t = performance.now(); if (t - lastWheelAt > 200) invalidateRects(); lastWheelAt = t; zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY, true); }, { passive: false });
    on(box, 'pointerdown', e => {
      if (e.target.closest('button,.legend,.pin,a,input,select')) return;
      if (!pts.size) invalidateRects();
      box.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; downType = e.pointerType || 'mouse';
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), w: vb.w }; }
      box.classList.add('drag');
    });
    on(box, 'pointermove', e => {
      if (!pts.size && e.pointerType === 'mouse') {
        const t = e.target.closest && e.target.closest('.lot');
        cb.onHover && cb.onHover(t ? t.dataset.id : null, e);
      }
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId), cur = { x: e.clientX, y: e.clientY }; pts.set(e.pointerId, cur);
      if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); zoomAt(pinch0.w * pinch0.d / d / vb.w, (a.x + b.x) / 2, (a.y + b.y) / 2, true); moved += 10; lastManualPanAt = Date.now(); if (cb.onMapDrag) cb.onMapDrag(); return; } // a pinch is a manual camera move too
      const s = toSvg(0, 0).s; vb.x -= (cur.x - prev.x) * s; vb.y -= (cur.y - prev.y) * s; moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y); requestCamera(); lastManualPanAt = Date.now();
      const th = PAN_PX[downType] ?? 6;
      if (moved > th && cb.onMapDrag) cb.onMapDrag();
      if (moved > th) cb.onHover && cb.onHover(null, e);
    });
    const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; if (!pts.size) box.classList.remove('drag'); };
    on(box, 'pointerup', e => {
      const click = moved < (PAN_PX[downType] ?? 6) && pts.size === 1; end(e);
      if (!click) return;
      if (camDirty || cam.hasAttribute('transform')) { if (camRaf) { cancelAnimationFrame(camRaf); camRaf = 0; } writeCamera(true); } // hit-test exactly the viewBox the pre-topic-46 renderer would have drawn
      const t = document.elementFromPoint(e.clientX, e.clientY), lot = t && t.closest && t.closest('.lot'), poi = t && t.closest && t.closest('.poi');
      if (poi && cb.onPoi) { cb.onPoi(poi.dataset.poi); return; } // common area (club, gate, squares…): its own popup, the lot selection stays
      const id = lot ? lot.dataset.id : null;
      shadowCheck(e, id);
      cb.onSelect && cb.onSelect(id);
    });
    on(box, 'pointercancel', end);
    // a drag over the labels must not start a text selection: a selected label would turn the next drag into a native
    // text drag (pointercancel, the map stops panning). Labels are not selectable content; panels are unaffected.
    on(svg, 'selectstart', e => e.preventDefault());
    on(svg, 'keydown', e => { const poi = e.target.closest && e.target.closest('.poi'); if (poi && (e.key === 'Enter' || e.key === ' ') && cb.onPoi) { e.preventDefault(); cb.onPoi(poi.dataset.poi); } });
    on(box, 'pointerleave', e => cb.onHover && cb.onHover(null, e));
    on(window, 'resize', invalidateRects); on(window, 'scroll', invalidateRects, { passive: true, capture: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { invalidateRects(); culledBounds = null; scale(); schedulePins(); if (zKey) cullLabels(zKey); }) : null;
    if (ro) ro.observe(box);
    if (rec) rec.observeLongTasks();

    // ---------- spatial queries, diagnostics and cleanup
    function viewportQuery(bufferRatio = 0) {
      if (!geo || !App.geo.camera) return null; const r = rects().svg; if (!r.width) return null;
      return App.geo.camera.viewportQuery(geo.index, { bounds: App.geo.camera.visibleWorldBounds(vb, r), zoom: VB0.w / vb.w, bufferRatio });
    }
    function diagnostics() {
      const st = n => (rec ? rec.stats(n) : null), vq = (() => { try { return viewportQuery(); } catch (e) { return null; } })();
      const base = { developmentId: dev.id, geometryVersion: geo ? geo.bundle.manifest.renderGeometryVersion : null, rendererType: 'SVG', featureCount: nodes.size, visibleFeatureCount: vq ? vq.visibleFeatureIds.length : null,
        spatialIndexType: geo ? geo.index.type : null, geometryDecodeMs: st('map_geometry_decode') && +st('map_geometry_decode').last.toFixed(2), firstRenderMs: st('map_first_render') && +st('map_first_render').last.toFixed(2),
        lastLayerSwitchMs: st('map_layer_switch') && +st('map_layer_switch').last.toFixed(2), lastHitTestMs: st('map_hit_test') && +st('map_hit_test').last.toFixed(3),
        memoryEstimateBytes: geo && PERF ? PERF.memoryEstimate(geo.bundle.features) : null, readiness, lastRender, hitShadow: { ...shadow, mismatches: shadow.mismatches.slice() },
        warnings: [...(geo ? geo.compat.diagnostics : ['pipeline geoespacial indisponível: mapa em modo nativo']), ...(geo && geo.validation.errors ? [`${geo.validation.errors} erro(s) de geometria`] : [])] };
      const d = PERF ? PERF.diagnostics(base) : base;
      return { ...d, initMs: initMs != null ? +initMs.toFixed(1) : null, indexBuildMs: geo ? +geo.index.buildMs.toFixed(2) : null, flags: { ...FLAGS }, labelsShown: shownLabels ? shownLabels.size : nodes.size, timings: rec ? Object.fromEntries(rec.names().map(n => [n, st(n)])) : null,
        manifest: geo ? geo.bundle.manifest : null, validation: geo ? { ok: geo.validation.ok, errors: geo.validation.errors, warnings: geo.validation.warnings, infos: geo.validation.infos } : null, compatibility: geo ? geo.compat.status : null };
    }
    function destroy() {
      destroyed = true; if (ac) ac.abort(); if (ro) ro.disconnect(); if (rec) rec.disconnect();
      cancelAnimationFrame(raf); cancelAnimationFrame(camRaf); cancelAnimationFrame(panAnim); cancelAnimationFrame(bulkRaf); clearTimeout(settleT); clearTimeout(flashT); clearTimeout(geoT);
      nodes = new Map(); lotsById = new Map(); labelsById = new Map(); geo = null; lastModel = null; shownLabels = null; if (last === view) last = null;
    }
    const geometry = () => (geo ? { manifest: geo.bundle.manifest, feature: id => geo.byId.get(id) || null, index: geo.index } : null);

    const view = { init, paint, setMarks, setPins, render, flash, highlight, lotScreenBounds, panBy, lastManualPan: () => lastManualPanAt, setRoute, setBackground, fitAll, focusLot, zoomBy, viewport, setViewport, isVisible, toScreen, box,
      hitTestAt, viewportQuery, diagnostics, geometry, destroy, uncullLabels: uncullAll };
    last = view;
    return view;
  }
  return { create, FLAGS, diagnostics: () => (last ? last.diagnostics() : null), current: () => last };
})();
