/* state/store.js — ApplicationState (single source of truth for the UI), the
   router (hash tokens) and an analytics hook. Components read through selectors
   and change state only through store.set / actions. ApplicationState never holds
   lot data: lots live in the LotRepository (dataRevision tells when they changed).
   Persisted state carries a schema version; an incompatible version is discarded. */
App.store = (() => {
  // UserStateCache (topic 10): small, non-critical, per development. localStorage is used because the state
  // is restored synchronously before the first paint and stays under a few KB. It is never a source for
  // price, status, reservation, permissions or identity. Session state (current lot, comparison, viewport)
  // is kept apart from persistent preferences and is validated against the loaded data (sanitize).
  const STATE_VERSION = 3, LEGACY_KEY = 'ws-state', keyOf = dev => `ws:${dev}:state`;
  const INITIAL = {
    developmentId: 'viva-juara', dataRevision: 0, currentLotId: null, hoverLotId: null, comparisonLotIds: [], currentCustomerId: null, customers: [], favorites: [],
    activeFilters: {}, preferences: {}, constraints: {}, recScope: null, activePreset: null, objective: null, commercialRanking: false, filterLevels: { ADVANCED: false, TECHNICAL: false },
    activeMapLayer: null, previousMapLayer: null, scoreKey: 'housing', backgroundLayer: null, mapOverlays: ['recommendation', 'comparison', 'references'], baseMapBlend: 0.42, layerOpacities: {}, legendFocus: null, legendExpanded: null, explain: null, recShowAll: false, locationMode: false, showRoute: null, distanceTo: null, activePriceTableId: null, priceHistoryFrom: null,
    simulation: { downPaymentPct: 12, planId: 'P144', expanded: false }, solar: { season: 'ver', hour: 9, onMap: true },
    mapViewport: null, presentationMode: 'broker', presentationView: false, modeBeforePresentation: null, view: 'map', panel: 'quick', detailSection: 'summary', openSections: { summary: true },
    connectivity: 'UNKNOWN', syncState: 'IDLE', loadOrigin: null, appUpdate: false, leftCollapsed: false, rightCollapsed: false, drawerOpen: false, sheet: 'min', fullMap: false, legendOpen: true, mapOverlay: null, compareFull: false, menu: null, modal: null
  };
  const SESSION = ['currentLotId', 'comparisonLotIds', 'mapViewport', 'view', 'panel', 'detailSection', 'openSections', 'sheet', 'fullMap', 'compareFull', 'currentCustomerId', 'recScope'];
  const TRANSIENT = ['connectivity', 'syncState', 'loadOrigin', 'appUpdate', 'drawerOpen', 'mapOverlay', 'dataRevision', 'hoverLotId', 'menu', 'modal', 'showRoute', 'distanceTo', 'locationMode', 'legendFocus', 'explain', 'recShowAll', 'presentationView', 'modeBeforePresentation', 'leftCollapsed', 'rightCollapsed', 'priceHistoryFrom'];
  // leftCollapsed / rightCollapsed mirror the workspace layout (layout/workspace.js), which keeps its own preferences per device family
  let state = { ...INITIAL }, subs = [], pending = new Set(), scheduled = false, saveT = null;
  // topic 38: the raw favorites array as restored (before sanitize() drops ids it cannot resolve), so the favorites
  // domain (favorites/favorites.js) can migrate it losslessly and report unresolved ids instead of losing them.
  let restoredFavorites = null;
  const storage = {
    get(k) { try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };
  function restore(devId = INITIAL.developmentId) {
    state.developmentId = devId;
    const saved = storage.get(keyOf(devId));
    const take = obj => { for (const k of Object.keys(INITIAL)) if (obj && k in obj && !TRANSIENT.includes(k) && k !== 'developmentId') state[k] = obj[k]; };
    if (saved && saved.v === STATE_VERSION) { take(saved.prefs); take(saved.session); }
    else {
      const v2 = storage.get(LEGACY_KEY);
      if (v2 && v2.v === 2 && v2.s && (v2.s.developmentId || devId) === devId) take(v2.s); // previous version of this workspace
      else { // the first dashboard's keys, once
        const favs = storage.get('vj-favs'), ent = storage.get('vj-ent'), s = storage.get('vj-sun-s'), h = storage.get('vj-sun-h'), sel = storage.get('vj-sel'), bg = storage.get('vj-bg2');
        if (Array.isArray(favs)) state.favorites = favs;
        if (typeof ent === 'number') state.simulation = { ...state.simulation, downPaymentPct: ent };
        if (s) state.solar = { ...state.solar, season: s }; if (typeof h === 'number') state.solar = { ...state.solar, hour: h };
        if (typeof sel === 'string') state.currentLotId = sel; if (bg === true) state.backgroundLayer = 'aerial';
      }
    }
    // topic 50: restored values are typed before anything renders them (localStorage is never trusted; defence in depth for the views)
    try { if (App.securityHardening) App.securityHardening.scrubRestoredState(state, INITIAL); } catch (e) { /* the scrub never blocks the boot */ }
    restoredFavorites = Object.freeze({ ids: Object.freeze(Array.isArray(state.favorites) ? state.favorites.slice() : []), savedAt: (saved && saved.v === STATE_VERSION && saved.savedAt) || null, developmentId: devId });
    // ids saved by older versions may be short codes (B79): sanitize() resolves or drops them after the lots load
    TRANSIENT.forEach(k => { state[k] = INITIAL[k]; });
    return state;
  }
  /** sanitize(ctx): the saved state must match the data that was actually loaded (topic 10, items 101–104).
      Lots that no longer exist are dropped, filters with unknown keys or values are discarded, the viewport
      must fall inside the map, layers and plans must exist. Returns what was dropped. */
  function sanitize({ resolve, filterKeys, statuses, layers, backgrounds, plans, scoreKeys, map, overlays, constraintKeys }) {
    const dropped = [], patch = {}, id = ref => { const l = ref && resolve(ref); return l ? l.identity.id : null; };
    if (state.currentLotId) { const v = id(state.currentLotId); if (v !== state.currentLotId) { patch.currentLotId = v; if (!v) dropped.push('currentLotId'); } }
    for (const k of ['comparisonLotIds', 'favorites']) {
      const arr = Array.isArray(state[k]) ? state[k] : [], ok = [...new Set(arr.map(id).filter(Boolean))];
      if (ok.length !== arr.length || ok.some((x, i) => x !== arr[i])) { patch[k] = k === 'comparisonLotIds' ? ok.slice(0, 4) : ok; if (ok.length < arr.length) dropped.push(k); }
    }
    const f = state.activeFilters && typeof state.activeFilters === 'object' ? state.activeFilters : {}, nf = {};
    for (const [k, v] of Object.entries(f)) {
      if (!filterKeys.includes(k)) { dropped.push('filter:' + k); continue; }
      if (k === 'statuses') { const ok = (Array.isArray(v) ? v : []).filter(x => statuses.includes(x)); if (ok.length) nf[k] = ok; continue; }
      if (k === 'block' && v && !resolve.blockExists(v)) { dropped.push('filter:block'); continue; }
      nf[k] = v;
    }
    if (JSON.stringify(nf) !== JSON.stringify(f)) patch.activeFilters = nf;
    if (state.activeMapLayer && !layers.includes(state.activeMapLayer)) { patch.activeMapLayer = null; dropped.push('activeMapLayer'); }
    if (state.previousMapLayer && !layers.includes(state.previousMapLayer)) patch.previousMapLayer = null;
    if (state.backgroundLayer && !backgrounds.includes(state.backgroundLayer)) { patch.backgroundLayer = null; dropped.push('backgroundLayer'); }
    if (overlays && Array.isArray(state.mapOverlays)) { const ok = state.mapOverlays.filter(o => overlays.includes(o)); if (ok.length !== state.mapOverlays.length) { patch.mapOverlays = ok; dropped.push('mapOverlays'); } }
    else if (overlays) patch.mapOverlays = INITIAL.mapOverlays.slice();
    if (constraintKeys && state.constraints && typeof state.constraints === 'object') { const c = {}; for (const [k, v] of Object.entries(state.constraints)) if (constraintKeys.includes(k)) c[k] = v; else dropped.push('constraint:' + k); if (Object.keys(c).length !== Object.keys(state.constraints).length) patch.constraints = c; }
    if (state.recScope && !(Array.isArray(state.recScope.lotIds))) { patch.recScope = null; dropped.push('recScope'); }
    if (state.scoreKey && !scoreKeys.includes(state.scoreKey)) patch.scoreKey = INITIAL.scoreKey;
    const sim = state.simulation || {};
    if (!plans.includes(sim.planId) || !(sim.downPaymentPct >= 0 && sim.downPaymentPct <= 100)) patch.simulation = { ...INITIAL.simulation, ...(plans.includes(sim.planId) ? { planId: sim.planId } : {}), ...(sim.downPaymentPct >= 0 && sim.downPaymentPct <= 100 ? { downPaymentPct: sim.downPaymentPct } : {}) };
    const vp = state.mapViewport;
    if (vp && !(vp.k > 0 && vp.k < 40 && Number.isFinite(vp.x) && Number.isFinite(vp.y) && vp.x >= -map.width && vp.x <= map.width * 2 && vp.y >= -map.height && vp.y <= map.height * 2)) { patch.mapViewport = null; dropped.push('mapViewport'); }
    if (Object.keys(patch).length) set(patch);
    return dropped;
  }
  const get = () => state;
  function set(patch, opts = {}) {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) { if (state[k] !== v) { changed = true; pending.add(k); } }
    if (!changed) return;
    state = { ...state, ...patch };
    if (!opts.silent && !scheduled) { scheduled = true; queueMicrotask(flush); }
    clearTimeout(saveT); saveT = setTimeout(save, 250);
  }
  function flush() { scheduled = false; const keys = pending; pending = new Set(); subs.forEach(fn => { try { fn(keys, state); } catch (e) { console.error(e); } }); }
  function save() {
    const prefs = {}, session = {};
    for (const k of Object.keys(INITIAL)) if (!TRANSIENT.includes(k) && k !== 'developmentId') (SESSION.includes(k) ? session : prefs)[k] = state[k];
    storage.set(keyOf(state.developmentId), { v: STATE_VERSION, savedAt: new Date().toISOString(), prefs, session });
  }
  /** "Limpar dados locais" keeps preferences unless asked */
  function clearSaved(devId, { keepPrefs = true } = {}) {
    const saved = storage.get(keyOf(devId));
    try { if (keepPrefs && saved) storage.set(keyOf(devId), { ...saved, session: {} }); else localStorage.removeItem(keyOf(devId)); localStorage.removeItem(LEGACY_KEY); } catch (e) { /* private mode */ }
  }
  const subscribe = fn => { subs.push(fn); return () => { subs = subs.filter(f => f !== fn); }; };
  return { INITIAL, STATE_VERSION, SESSION, TRANSIENT, keyOf, get, set, subscribe, restore, sanitize, save, clearSaved, storage, flushNow: flush, restoredFavorites: () => restoredFavorites };
})();

App.router = (() => {
  const PANEL_SUFFIX = { simulation: 'simular', solar: 'sol' };
  /** token grammar (plain anchors only): <dev> | <dev>.lots.<code>[.<section>|.simular|.sol] | <dev>.compare.<code>~<code>…
      URLs carry the short lot code (B79), the store carries the technical id; `resolve` translates. */
  /** token grammar (plain anchors only): <dev> | <dev>.lots.<code>[.<section>|.simular|.sol] | <dev>.compare.<code>~<code>…
      optionally followed by ?base=…&layer=…&score=…&ov=…&f=… (map view and filters: ids and values only, never data).
      URLs carry the short lot code (B79), the store carries the technical id; `resolve` translates. */
  function parse(hash, resolve) {
    const full = String(hash || '').replace(/^#/, ''); if (!full) return null;
    const [h, q] = full.split('?'), p = h.split('.'), out = { developmentId: p[0] }, id = c => { const l = resolve(c); return l ? l.identity.id : null; };
    if (p[1] === 'lots' && p[2]) {
      out.currentLotId = id(p[2]);
      if (p[3] === 'simular') out.panel = 'simulation'; else if (p[3] === 'sol') out.panel = 'solar';
      else if (p[3]) { out.panel = 'details'; out.detailSection = p[3]; }
    } else if (p[1] === 'compare' && p[2]) { out.comparisonLotIds = p[2].split('~').map(id).filter(Boolean).slice(0, 4); out.view = 'compare'; }
    if (q) {
      const ml = App.mapLayers ? App.mapLayers.parse(q) : {};
      if (ml.baseMapMode) out.backgroundLayer = App.mapLayers.BASE_TO_STORE[ml.baseMapMode];
      if (ml.primaryLayerId && App.mapLayers.registry(out.developmentId).get(ml.primaryLayerId)) out.activeMapLayer = ml.primaryLayerId; // unknown layer ids in a link are dropped
      if (ml.layerSettings) out.scoreKey = ml.layerSettings.score.scoreKey;
      if (ml.activeOverlayIds) out.mapOverlays = ml.activeOverlayIds;
      const f = q.split('&').find(x => x.startsWith('f='));
      if (f && App.filters) { try { const r = App.filters.parse(decodeURIComponent(f.slice(2))); out.activeFilters = r && r.state ? r.state : r; } catch (e) { /* invalid filter link: ignored */ } }
    }
    return out;
  }
  function token(s, codeOf) {
    let base;
    if (s.view === 'compare' && s.comparisonLotIds.length) base = `${s.developmentId}.compare.${s.comparisonLotIds.map(codeOf).join('~')}`;
    else if (s.currentLotId) { const suf = s.panel === 'details' ? '.' + s.detailSection : PANEL_SUFFIX[s.panel] ? '.' + PANEL_SUFFIX[s.panel] : ''; base = `${s.developmentId}.lots.${codeOf(s.currentLotId)}${suf}`; }
    else base = s.developmentId;
    const q = [];
    if (App.mapLayers && s.activeMapLayer) { const m = App.mapLayers.serialize(App.mapLayers.fromStore(s), App.mapLayers.defaultState(s.developmentId)); if (m) q.push(m); }
    if (App.filters && s.activeFilters && App.filters.isActive(s.activeFilters)) { // links longer than the filter module's limit leave the filters out of the URL (they stay applied on screen; nothing is cut in the middle)
      const c = App.filters.serializeChecked ? App.filters.serializeChecked(s.activeFilters) : { value: App.filters.serialize(s.activeFilters) }; if (c.value) q.push('f=' + encodeURIComponent(c.value)); }
    return q.length ? base + '?' + q.join('&') : base;
  }
  function write(s, codeOf) { try { const t = '#' + token(s, codeOf); if (location.hash !== t) history.replaceState(history.state, '', t); } catch (e) { /* sandboxed frame */ } }
  return { parse, token, write };
})();

/* App.analytics is owned by analytics/facade.js only (GAP-ARCH-10); calls made before it loads are buffered by the
   kernel placeholder in prelude.js and replayed once by the facade. */
