/* surroundings/entornoView.js — round 7 (2026-10-19): the "Entorno" surface of the public panel (App.surroundings.entorno).
   Owner's request (Edmilson, 2026-10-19): see the region around the development. Keyless: OpenStreetMap base map
   (slippyMap.js) + overlays built only from data the panel already has:
   - the lot plan (planta.webp) georeferenced by the affine fit of the lots' plan centroids to their KMZ lat/lon
     (geoMercator.planGeoref), applied as a CSS matrix; user opacity control; lot outlines (tap → existing lot details);
   - 2026-10-20: "Aérea ilustrativa" (aerea_ampliada.webp, plan rect environmentMap.aerialOverlay.planRect, 1 px = 1 plan unit)
     positioned by the same affine; loaded only when chosen, or by default when the tiles fail (artifact viewer). Outside the
     development it is the developer's illustration (not a photo, not exact geography): the UI says so whenever it is shown;
, the validated official coordinate of surroundings.config.js;
   - 2/4/6/8 km straight-line rings around it;
   - plain Google Maps links (search / directions) to that coordinate — no key, nothing about the user is sent.
   Nearby places are NOT listed: they need the Google key (topic 63 path, still NOT_CONFIGURED).
   Separate surface: it never draws into the lot map (#map) and never changes its camera, layers or colours.
   Delegated data-acts (uiOnly): envTab (lots|environment), envZoomIn, envZoomOut, envRecenter, envPlan, envAerial, envInfo, envRetryTiles.
   html(vm) → markup string · viewModel(developmentId, { lots, online }) · mount(box, ctx) → controller { destroy, map, georef } */
(function () {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = () => (typeof App !== 'undefined' && App.surroundings) || {};
  const D = () => S().domain || require('./surroundingsDomain.js');
  const C = () => S().config || require('../config/surroundings/surroundings.config.js');
  const G = () => S().geo || require('./geoMercator.js');
  const SL = () => S().slippy || require('./slippyMap.js');
  const NS = 'http://www.w3.org/2000/svg';
  const fmtM = m => (m < 10 ? m.toFixed(1) : String(Math.round(m))).replace('.', ',');

  /** switchHtml(active) — the "Mapa de Lotes | Entorno" switch (same markup as the one in the lot map's top-left corner) */
  function switchHtml(active) {
    const b = (v, label) => `<button type="button" data-act="envTab" data-v="${v}" aria-pressed="${active === v}">${esc(label)}</button>`;
    return `<div class="seg envseg" role="group" aria-label="Mapa de Lotes ou Entorno">${b('lots', 'Mapa de Lotes')}${b('environment', 'Entorno')}</div>`;
  }

  /** viewModel(developmentId, { lots, online }) → plain object (no DOM). lots = domain lots or lots.json rows. */
  function viewModel(developmentId, o = {}) {
    const Cf = C(), Dm = D(), dev = Cf.developments[developmentId], em = Cf.environmentMap;
    const bm = Dm.baseMap(developmentId, { online: o.online !== false }, Cf), prov = Dm.baseMapProvider(Cf);
    const georef = o.lots ? G().planGeoref(o.lots) : null, maxRes = em.planOverlay.maxResidualMeters;
    const planOk = !!(em.planOverlay.enabled && georef && georef.residuals.maxMeters <= maxRes), ao = em.aerialOverlay;
    const aerial = planOk && ao && ao.enabled ? { label: ao.label, badge: ao.badge, note: ao.note, planRect: { ...ao.planRect }, opacity: ao.defaultOpacity, asset: ao.asset } : null;
    return { developmentId, name: dev ? dev.location.name : '', baseMap: bm, provider: prov, links: Dm.externalLinks(developmentId, Cf),
      rings: em.ringsMeters.slice(), ringLabel: em.ringLabel, gate: em.gate, georef, planOverlay: planOk, planOpacity: em.planOverlay.defaultOpacity,
      lotMinZoom: em.planOverlay.lotPolygonsMinZoom, aerial, copy: em.copy, googleState: Dm.capability(developmentId, { online: o.online !== false }, Cf).state,
      boundsRadiusMeters: em.boundsRadiusMeters + em.boundsMarginMeters, initialFitRadiusMeters: em.initialFitRadiusMeters };
  }

  /** html(vm) → the Entorno surface. Unavailable base map (no validated coordinate / no provider) → state message only. */
  function html(vm) {
    const cp = vm.copy;
    if (!vm.baseMap.available) return `<div class="envbar">${switchHtml('environment')}</div><div class="envcard"><p class="envmsg" role="status">${esc(vm.baseMap.message || cp.notValidated)}</p></div>`;
    const res = vm.georef && vm.planOverlay ? `Planta posicionada pelo KMZ da incorporadora (calculado: erro médio ${fmtM(vm.georef.residuals.meanMeters)} m em ${vm.georef.residuals.n} lotes).` : 'Planta não sobreposta: ajuste ao KMZ indisponível.';
    const a = vm.provider.attribution;
    return `<div class="envbar">${switchHtml('environment')}</div>
<div class="envvp" tabindex="0" role="region" aria-roledescription="mapa" aria-label="Mapa do entorno de ${esc(vm.name)}: arraste ou use as setas para mover, + e − para aproximar ou afastar">
  <div class="envfail" role="status" hidden><b>${esc(cp.tilesFailed)}</b><span>${esc(cp.tilesFailedHint)}</span><button type="button" class="btn sm" data-act="envRetryTiles">Tentar de novo</button></div>
  <div class="envctl"><button type="button" class="mbtn" data-act="envZoomIn" aria-label="Aproximar o entorno">+</button><button type="button" class="mbtn" data-act="envZoomOut" aria-label="Afastar o entorno">−</button><button type="button" class="mbtn" data-act="envRecenter" aria-label="Centralizar na portaria" title="Centralizar na portaria">⌂</button></div>
  ${vm.planOverlay ? `<div class="envplan" role="group" aria-label="Sobreposição no mapa do entorno"><button type="button" class="mbtn" data-act="envPlan" aria-pressed="true">Planta</button>${vm.aerial ? `<button type="button" class="mbtn" data-act="envAerial" aria-pressed="false" title="${esc(vm.aerial.badge)}">${esc(vm.aerial.label)}</button>` : ''}<label class="envop"><span class="vh">Opacidade da sobreposição</span><input type="range" min="0" max="100" step="5" value="${esc(Math.round(vm.planOpacity * 100))}" aria-label="Opacidade da planta"></label></div>` : ''}
  ${vm.aerial ? `<p class="envillus" role="note" hidden>${esc(vm.aerial.badge)}</p>` : ''}
  <p class="envattr"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.text)}</a></p>
</div>
<div class="envcard" id="envCard">
  <div class="envch"><p class="envct"><b>Entorno de ${esc(vm.name)}</b><span class="small"> · ${esc(vm.gate.label)} (${esc(vm.gate.ref)}), coordenada oficial validada</span></p><button type="button" class="lbtn small envinfo" data-act="envInfo" aria-expanded="true" aria-controls="envMore">Ocultar detalhes</button></div>
  <div class="envbtns"><a class="btn sm" href="${esc(vm.links.openInMaps)}" target="_blank" rel="noopener noreferrer">${esc(cp.openInMaps)}</a><a class="btn sm" href="${esc(vm.links.directions)}" target="_blank" rel="noopener noreferrer">${esc(cp.directions)}</a></div>
  <div id="envMore" class="envmore"><p class="small"><span class="envlg" aria-hidden="true"></span>${esc(cp.rings)} (${esc(vm.ringLabel.toLowerCase())}; o trajeto por vias é maior). ${esc(res)}</p>
  ${vm.aerial ? `<p class="small envnote envaernote">${esc(vm.aerial.note)}</p>` : ''}
  <p class="small envnote">${esc(cp.nearbyPending)}</p></div>
</div>`;
  }

  /** planToNorm composed with the image's plan offset (image pixel → plan unit = pixel + rect origin; 1 px = 1 unit) */
  const offsetAffine = (N, r) => [N[0], N[1], N[2], N[3], N[4] + N[0] * r.x + N[2] * r.y, N[5] + N[1] * r.x + N[3] * r.y];

  /** mount(box, { developmentId, lots, planUrl, planSize: { w, h }, aerialUrl: string | () => string | Promise<string>, online, onLot(id) }) → controller */
  function mount(box, ctx) {
    const vm = viewModel(ctx.developmentId, { lots: ctx.lots, online: ctx.online });
    box.innerHTML = html(vm);
    if (!vm.baseMap.available) return { vm, map: null, georef: vm.georef, destroy() { box.innerHTML = ''; } };
    const doc = box.ownerDocument, g = G(), vp = box.querySelector('.envvp'), failBox = box.querySelector('.envfail'), center = vm.baseMap.center, prov = vm.provider;
    const size = () => ({ w: vp.clientWidth || 600, h: vp.clientHeight || 400 });
    const fitZ = () => { const s = size(); return g.fitZoom(center, vm.initialFitRadiusMeters, s.w, s.h, { minZoom: prov.minZoom, maxZoom: prov.maxZoom, paddingPx: 16 }); };
    // tiles failing (artifact viewer CSP, blocked network) → default to the illustrated aerial so the surroundings still show
    let ready = false, tilesFailed = false, userChose = false;
    const map = SL().create(vp, { center, zoom: fitZ(), minZoom: prov.minZoom, maxZoom: prov.maxZoom, tileUrlTemplate: prov.tileUrlTemplate, referrerPolicy: prov.usagePolicy.referrerPolicy,
      bounds: g.envelope(center, vm.boundsRadiusMeters), onTileStatus: s => { failBox.hidden = s !== 'FAILED'; box.dataset.tiles = s; if (s === 'FAILED') { tilesFailed = true; if (ready) autoAerial(); } } });

    // ---- plan image (CSS matrix) and lot outlines (same affine, SVG)
    let planImg = null, planOn = true, opacity = vm.planOpacity, lotG = null, lotsDrawn = false;
    let aerImg = null, aerOn = false, aerOpacity = vm.aerial ? vm.aerial.opacity : 1, aerRequested = false, aerFailed = false;
    const aerN = vm.aerial && vm.georef ? offsetAffine(vm.georef.planToNorm, vm.aerial.planRect) : null;
    const svg = doc.createElementNS(NS, 'svg'); svg.setAttribute('class', 'envsvg'); svg.setAttribute('width', '1'); svg.setAttribute('height', '1'); svg.setAttribute('aria-hidden', 'true');
    const ringsG = doc.createElementNS(NS, 'g'); ringsG.setAttribute('class', 'envrings');
    const gateG = doc.createElementNS(NS, 'g'); gateG.setAttribute('class', 'envgate');
    if (vm.planOverlay) {
      planImg = doc.createElement('img'); planImg.className = 'envplanimg'; planImg.alt = ''; planImg.draggable = false; planImg.decoding = 'async';
      planImg.style.width = ctx.planSize.w + 'px'; planImg.style.height = ctx.planSize.h + 'px'; planImg.style.opacity = String(opacity);
      if (ctx.planUrl) planImg.src = ctx.planUrl;
      lotG = doc.createElementNS(NS, 'g'); lotG.setAttribute('class', 'envlots');
    }
    if (vm.aerial && aerN) { // element now, image bytes only when chosen (lazy)
      aerImg = doc.createElement('img'); aerImg.className = 'envplanimg envaerimg'; aerImg.alt = ''; aerImg.draggable = false; aerImg.decoding = 'async';
      aerImg.style.width = vm.aerial.planRect.w + 'px'; aerImg.style.height = vm.aerial.planRect.h + 'px'; aerImg.style.opacity = String(aerOpacity); aerImg.style.display = 'none';
      aerImg.onerror = () => { aerFailed = true; aerImg.style.display = 'none'; const n = box.querySelector('.envillus'); if (n) { n.hidden = false; n.textContent = 'Aérea ilustrativa indisponível agora.'; } if (!userChose && planImg) setOverlay('plan'); else map.refresh(); };
    }
    const ringPts = vm.rings.map(r => ({ r, pts: g.ring(center, r, 180), top: g.destination(center, 90, r) })); // label on the east side (clear of the top-left switch)
    function drawLots() {
      if (lotsDrawn || !lotG) return; lotsDrawn = true;
      const frag = doc.createDocumentFragment();
      for (const raw of ctx.lots || []) {
        const l = g.lotGeo(raw); if (!l || !Array.isArray(l.polygon) || l.polygon.length < 3) continue;
        const p = doc.createElementNS(NS, 'path');
        p.setAttribute('d', 'M' + l.polygon.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z');
        p.setAttribute('data-lot', l.id); p.setAttribute('vector-effect', 'non-scaling-stroke');
        const t = doc.createElementNS(NS, 'title'); t.textContent = `Lote ${l.code}`; p.appendChild(t); frag.appendChild(p);
      }
      lotG.appendChild(frag);
    }
    map.addLayer({
      mount(pane) { if (aerImg) pane.appendChild(aerImg); if (planImg) pane.appendChild(planImg); svg.append(...[lotG, ringsG, gateG].filter(Boolean)); pane.appendChild(svg); },
      render(v) {
        if (planImg && vm.georef) {
          const m = g.cssMatrix(vm.georef.planToNorm, v.z, v.ox, v.oy); planImg.style.transform = m; lotG.setAttribute('transform', m.replace(/,/g, ' '));
          if (aerImg && aerOn) aerImg.style.transform = g.cssMatrix(aerN, v.z, v.ox, v.oy);
          const showLots = (planOn || aerOn) && v.z >= vm.lotMinZoom; if (showLots) drawLots(); lotG.style.display = showLots ? '' : 'none';
        }
        let h = '';
        for (const R of ringPts) {
          const d = 'M' + R.pts.map(q => v.toPane(q.lat, q.lon).map(n => n.toFixed(1)).join(' ')).join('L') + 'Z', [tx, ty] = v.toPane(R.top.lat, R.top.lon);
          h += `<path d="${d}"/><text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="middle">${R.r / 1000} km</text>`;
        }
        ringsG.innerHTML = h;
        const [gx, gy] = v.toPane(center.lat, center.lon);
        gateG.innerHTML = `<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="7"/><circle class="in" cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="2.5"/><text x="${(gx + 11).toFixed(1)}" y="${(gy + 4).toFixed(1)}">${esc(vm.gate.label)}</text>`;
      }
    });

    // ---- overlay choice: Planta | Aérea ilustrativa (one at a time; pressing the active one hides it)
    async function loadAerial() {
      if (aerRequested || !aerImg) return; aerRequested = true;
      try { const u = typeof ctx.aerialUrl === 'function' ? await ctx.aerialUrl() : ctx.aerialUrl; aerImg.src = u || vm.aerial.asset; } catch (e) { aerImg.src = vm.aerial.asset; }
    }
    function setOverlay(which) {
      planOn = which === 'plan' && !!planImg; aerOn = which === 'aerial' && !!aerImg && !aerFailed;
      if (planImg) planImg.style.display = planOn ? '' : 'none';
      if (aerImg) { aerImg.style.display = aerOn ? '' : 'none'; if (aerOn) loadAerial(); }
      const bp = box.querySelector('[data-act=envPlan]'), ba = box.querySelector('[data-act=envAerial]'), note = box.querySelector('.envillus'), rg = box.querySelector('.envop input');
      if (bp) bp.setAttribute('aria-pressed', String(planOn)); if (ba) ba.setAttribute('aria-pressed', String(aerOn));
      if (note && !aerFailed) note.hidden = !aerOn;
      if (rg) { rg.value = String(Math.round((aerOn ? aerOpacity : opacity) * 100)); rg.setAttribute('aria-label', aerOn ? 'Opacidade da aérea ilustrativa' : 'Opacidade da planta'); }
      box.dataset.overlay = planOn ? 'plan' : aerOn ? 'aerial' : 'none';
      map.refresh();
    }
    // tiles failed: show the illustrated aerial and frame the development (plan frame centre, its width), since the tiles are gone
    function autoAerial() {
      if (userChose || !aerImg || aerOn) return; setOverlay('aerial');
      const W = ctx.planSize ? ctx.planSize.w : 2247, H = ctx.planSize ? ctx.planSize.h : 1587, cy = H / 2;
      const mid = g.planToLatLon(vm.georef, W / 2, cy), half = g.haversine(g.planToLatLon(vm.georef, 0, cy), g.planToLatLon(vm.georef, W, cy)) / 2, s = size();
      map.recenter(mid, g.fitZoom(mid, half, s.w, s.h, { minZoom: prov.minZoom, maxZoom: prov.maxZoom, paddingPx: 8 }));
    }

    // ---- controls (local handlers; the global dispatcher only checks the uiOnly permission and has no case for them)
    const onClick = e => {
      const lot = e.target.closest && e.target.closest('[data-lot]');
      if (lot && ctx.onLot) { ctx.onLot(lot.getAttribute('data-lot')); return; }
      const a = e.target.closest && e.target.closest('[data-act]'); if (!a || !box.contains(a)) return;
      const act = a.dataset.act;
      if (act === 'envZoomIn') map.zoomBy(1); else if (act === 'envZoomOut') map.zoomBy(-1);
      else if (act === 'envRecenter') map.recenter(center, fitZ());
      else if (act === 'envRetryTiles') { failBox.hidden = true; map.retryTiles(); }
      else if (act === 'envPlan' && planImg) { userChose = true; setOverlay(planOn ? null : 'plan'); }
      else if (act === 'envAerial' && aerImg) { userChose = true; setOverlay(aerOn ? null : 'aerial'); }
      else if (act === 'envInfo') { const more = box.querySelector('#envMore'), open = a.getAttribute('aria-expanded') !== 'true'; a.setAttribute('aria-expanded', String(open)); more.hidden = !open; a.textContent = open ? 'Ocultar detalhes' : 'Mostrar detalhes'; }
    };
    const onInput = e => {
      if (e.target.type !== 'range') return; const v = Math.max(0, Math.min(1, +e.target.value / 100));
      if (aerOn && aerImg) { aerOpacity = v; aerImg.style.opacity = String(v); } else if (planImg) { opacity = v; planImg.style.opacity = String(opacity); }
    };
    box.addEventListener('click', onClick); box.addEventListener('input', onInput);
    if ((box.clientWidth || 1000) < 600) { const b = box.querySelector('[data-act=envInfo]'); if (b) onClick({ target: b }); } // phones: details folded, the map keeps the room
    ready = true; if (tilesFailed) autoAerial();
    return { vm, map, georef: vm.georef, planImg, get aerImg() { return aerImg; }, overlay: () => (planOn ? 'plan' : aerOn ? 'aerial' : 'none'), setOverlay: w => { userChose = true; setOverlay(w); }, destroy() { box.removeEventListener('click', onClick); box.removeEventListener('input', onInput); map.destroy(); box.innerHTML = ''; } };
  }

  const api = { viewModel, html, mount, switchHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.entorno = api; }
})();
