/* surroundings/surroundingsClient.js — topic 63, browser side of the Entorno (App.surroundings.client).
   - api(...): the ONLY network path for POIs/routes: the platform's semantic endpoints (never Google directly, never a
     generic proxy). GET /api/v1/developments/:id/nearby-places?category&radius&rank, POST …/route-estimates,
     GET …/environment-map-config. Single-flight per request key; AbortController for stale searches.
   - controller(...): EnvironmentMapState + LocationSearchTransaction (stale result guard: A finishes after B → A ignored).
   - loader(...): GoogleMapsLoader singleton. Injects the Maps JS script at most once and ONLY when the capability says
     the environment map is available (flag ON + validated coordinate + browser key provisioned). Never on boot.
   - mapView(...): Maps JS adapter (google namespace injected): development marker, non-editable Circle, fitBounds of the
     radius envelope, POI markers derived from state (no duplicates), list ↔ marker selection. No business rule here.
   Nothing here stores provider content in browser storage or in the Service Worker (§317, §318). */
(function () {
  const D = () => (typeof App !== 'undefined' && App.surroundings && App.surroundings.domain) || require('./surroundingsDomain.js');
  const C = () => (typeof App !== 'undefined' && App.surroundings && App.surroundings.config) || require('../config/surroundings/surroundings.config.js');

  // ------------------------------------------------------------------ semantic API client
  /** api({ baseUrl, fetch, organizationId }) → { environmentConfig, nearbyPlaces, routeEstimate, inFlight } */
  function api({ baseUrl, fetch: f, organizationId = null }) {
    if (!baseUrl) return null; // static panel: no backend, no Entorno data
    const inflight = new Map();
    const headers = () => ({ Accept: 'application/json', ...(organizationId ? { 'X-Organization-Id': organizationId } : {}) });
    const base = String(baseUrl).replace(/\/$/, '');
    async function call(url, init) {
      let res;
      try { res = await f(url, { credentials: 'include', ...init, headers: { ...headers(), ...(init && init.headers) } }); }
      catch (e) { if (e && e.name === 'AbortError') throw e; return { ok: false, error: { code: 'GOOGLE_PLACES_UNAVAILABLE', message: C().copy.unavailable } }; }
      const body = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, status: res.status, error: { code: (body && body.code) || 'GOOGLE_PLACES_UNAVAILABLE', message: (body && body.message) || C().copy.unavailable } };
      return { ok: true, data: body && body.data !== undefined ? body.data : body };
    }
    const enc = encodeURIComponent;
    return {
      environmentConfig: developmentId => call(`${base}/api/v1/developments/${enc(developmentId)}/environment-map-config`),
      /** nearbyPlaces: single-flight on (development, category, radius, rank) */
      nearbyPlaces({ developmentId, categoryCode, radiusMeters, rank = 'DISTANCE', signal }) {
        const key = [developmentId, categoryCode, radiusMeters, rank].join('|');
        if (inflight.has(key)) return inflight.get(key);
        const q = `category=${enc(categoryCode)}&radius=${enc(radiusMeters)}&rank=${enc(rank)}`;
        const p = call(`${base}/api/v1/developments/${enc(developmentId)}/nearby-places?${q}`, { signal }).finally(() => inflight.delete(key));
        inflight.set(key, p); return p;
      },
      /** routeEstimate: one route per interaction (§151), DRIVE only */
      routeEstimate: ({ developmentId, providerPlaceId, trafficMode }) => call(`${base}/api/v1/developments/${enc(developmentId)}/route-estimates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerPlaceId, travelMode: 'DRIVE', ...(trafficMode ? { trafficMode } : {}) }) }),
      inFlight: () => inflight.size
    };
  }

  // ------------------------------------------------------------------ state controller
  /** controller({ developmentId, client, policy, registry, onChange, track }) — EnvironmentMapState + stale guard */
  function controller({ developmentId, client, policy, registry, onChange = () => {}, track = null, now = () => new Date().toISOString() }) {
    const Dm = D();
    let seq = 0, current = null, aborter = null;
    const state = { selectedCategory: undefined, selectedRadiusMeters: policy.defaultRadiusMeters, selectedPlaceId: undefined, rankPreference: 'DISTANCE', routeVisible: false,
      phase: 'IDLE', places: [], allPlaces: [], error: null, route: null, routePhase: 'IDLE', routeError: null, summary: null, linkStatus: 'COMPLETE', linkMessage: null, generatedAt: null };
    const emit = () => onChange({ ...state });
    const ev = (name, extra) => { if (track) { const e = Dm.eventPayload(name, extra); track(e.name, e.props); } };
    async function search() {
      if (!state.selectedCategory || !client) return;
      const cat = registry.byCode[state.selectedCategory];
      const tx = { id: `tx_${++seq}`, developmentId, categoryCode: state.selectedCategory, radiusMeters: state.selectedRadiusMeters, contextRevision: String(seq), startedAt: now() };
      current = tx; if (aborter) aborter.abort(); aborter = typeof AbortController !== 'undefined' ? new AbortController() : null;
      Object.assign(state, { phase: 'LOADING', error: null, route: null, routePhase: 'IDLE', routeError: null }); emit();
      let r;
      try { r = await client.nearbyPlaces({ developmentId, categoryCode: tx.categoryCode, radiusMeters: tx.radiusMeters, rank: state.rankPreference, signal: aborter && aborter.signal }); }
      catch (e) { if (current !== tx) return { ignored: true, tx }; r = { ok: false, error: { code: 'GOOGLE_PLACES_UNAVAILABLE', message: C().copy.unavailable } }; }
      if (current !== tx) return { ignored: true, tx }; // stale result guard (§450, §516)
      if (!r.ok) { Object.assign(state, { phase: 'ERROR', places: [], allPlaces: [], error: r.error }); emit(); return { ok: false, tx }; }
      const d = r.data || {}, places = Array.isArray(d.places) ? d.places.filter(Dm.validPlace) : [];
      const sorted = Dm.sortPlaces(Dm.narrowToRadius(places, tx.radiusMeters), state.rankPreference);
      const sel = Dm.restoreSelection(state, sorted);
      Object.assign(state, sel.state, { phase: sorted.length ? 'READY' : 'EMPTY', places: sorted, allPlaces: sorted, generatedAt: d.generatedAt || null,
        linkStatus: sel.status === 'PARTIAL' ? 'PARTIAL' : state.linkStatus, linkMessage: sel.message || state.linkMessage,
        summary: { text: Dm.summaryText({ count: sorted.length, categoryLabel: cat ? cat.label : '', radiusMeters: tx.radiusMeters }), nearest: Dm.nearestText(sorted[0], cat ? cat.label.replace(/s$/, '') : '') } });
      emit(); return { ok: true, tx };
    }
    return {
      state: () => ({ ...state }),
      /** open: Entorno entered. Lazy: no Places call unless a category is already selected (deep link) (§54, §437) */
      open(link) {
        if (link) { const r = Dm.restoreLinkState(link, { registry, policy }); Object.assign(state, r.state, { linkStatus: r.status, linkMessage: r.status === 'PARTIAL' ? 'Parte do link não pôde ser restaurada.' : null }); }
        ev('environment_map_opened', { radiusMeters: state.selectedRadiusMeters }); emit();
        return state.selectedCategory ? search() : Promise.resolve({ ok: true, idle: true });
      },
      selectCategory(code) {
        const r = Dm.resolveCategory(code, registry); if (!r.ok) return Promise.resolve(r);
        state.selectedCategory = code; state.selectedPlaceId = undefined; ev('nearby_category_selected', { categoryCode: code, radiusMeters: state.selectedRadiusMeters });
        return search();
      },
      selectRadius(m) {
        const r = Dm.resolveRadius(m, policy); if (!r.ok) return Promise.resolve(r);
        const shrink = r.effectiveRadiusMeters <= state.selectedRadiusMeters && state.phase !== 'ERROR';
        state.selectedRadiusMeters = r.effectiveRadiusMeters; ev('nearby_radius_selected', { categoryCode: state.selectedCategory, radiusMeters: r.effectiveRadiusMeters });
        if (shrink && state.allPlaces.length) { // smaller filter: drop places outside it immediately (§428), then refresh with the smaller radius (§82)
          state.places = Dm.narrowToRadius(state.allPlaces, r.effectiveRadiusMeters);
          if (state.selectedPlaceId && !state.places.some(p => p.providerPlaceId === state.selectedPlaceId)) { state.selectedPlaceId = undefined; state.route = null; }
          emit();
        }
        return state.selectedCategory ? search() : (emit(), Promise.resolve({ ok: true }));
      },
      selectRank(rank) { if (!D().RANKS.includes(rank)) return Promise.resolve({ ok: false, code: 'VALIDATION_ERROR' }); state.rankPreference = rank; return search(); },
      /** selectPlace: list ↔ marker sync. No route call here (explicit-route UX, §439) */
      selectPlace(id) { if (!state.places.some(p => p.providerPlaceId === id)) return false; state.selectedPlaceId = id; state.route = null; state.routePhase = 'IDLE'; state.routeError = null; ev('nearby_place_selected', { categoryCode: state.selectedCategory }); emit(); return true; },
      /** requestRoute: on demand, one route, failure keeps the place and its straight-line distance (§420) */
      async requestRoute() {
        const id = state.selectedPlaceId; if (!id || !client) return { ok: false };
        state.routePhase = 'LOADING'; state.routeError = null; emit(); ev('route_estimate_requested', { categoryCode: state.selectedCategory });
        const r = await client.routeEstimate({ developmentId, providerPlaceId: id });
        if (state.selectedPlaceId !== id) return { ignored: true };
        if (!r.ok) { state.routePhase = 'ERROR'; state.routeError = { code: r.error.code, message: C().copy.routeFailed }; emit(); return { ok: false }; }
        state.route = r.data; state.routePhase = 'READY'; state.routeVisible = true; emit(); return { ok: true };
      },
      link: () => Dm.linkState(state),
      /** close: leaving Entorno cancels pending work (§446) */
      close() { current = null; if (aborter) aborter.abort(); aborter = null; }
    };
  }

  // ------------------------------------------------------------------ GoogleMapsLoader (singleton, single-flight, §467–§471)
  /** loader({ document, capability, browserKey, mapId }) → { load(), loaded(), attempts() } — refuses unless the capability allows it */
  function loader({ document: doc, capability, browserKey, mapId = null, timeoutMs = 15000, win = (typeof window !== 'undefined' ? window : {}) }) {
    let promise = null, attempts = 0;
    const cfg = C().provider.mapsJs;
    function load() {
      if (!capability || !capability.GOOGLE_MAPS_ENVIRONMENT) return Promise.resolve({ ok: false, code: capability && capability.state === 'NOT_VALIDATED' ? 'GOOGLE_MAPS_LOCATION_UNVERIFIED' : 'GOOGLE_MAPS_NOT_CONFIGURED' });
      if (!browserKey) return Promise.resolve({ ok: false, code: 'GOOGLE_MAPS_NOT_CONFIGURED' });
      if (win.google && win.google.maps) return Promise.resolve({ ok: true, google: win.google });
      if (promise) return promise;
      attempts++;
      promise = new Promise(resolve => {
        const cb = `__vjMapsReady${attempts}`, s = doc.createElement('script');
        const q = new URLSearchParams({ key: browserKey, v: cfg.version, libraries: cfg.libraries.join(','), language: cfg.language, region: cfg.region, loading: 'async', callback: cb });
        if (mapId) q.set('map_ids', mapId);
        const t = setTimeout(() => done({ ok: false, code: 'GOOGLE_MAPS_LOAD_TIMEOUT' }), timeoutMs);
        function done(r) { clearTimeout(t); try { delete win[cb]; } catch (_) { win[cb] = undefined; } if (!r.ok) promise = null; resolve(r); } // failure → manual retry allowed
        win[cb] = () => done({ ok: true, google: win.google });
        s.src = `${cfg.scriptOrigin}${cfg.loaderPath}?${q.toString()}`; s.async = true; s.defer = true; s.dataset.loader = 'surroundings';
        s.onerror = () => done({ ok: false, code: 'GOOGLE_MAPS_LOAD_FAILED' });
        doc.head.appendChild(s);
      });
      return promise;
    }
    return { load, attempts: () => attempts };
  }

  // ------------------------------------------------------------------ Maps JS view adapter
  /** mapView({ google, element, runtime: { developmentCenter, developmentName, activeRadiusMeters, maxRadiusMeters, viewportBounds, strictBounds, mapId, paddingPx }, onSelect }) */
  function mapView({ google, element, runtime, onSelect = () => {} }) {
    const Dm = D(), g = google.maps;
    const center = { lat: runtime.developmentCenter.latitude, lng: runtime.developmentCenter.longitude };
    const maxB = Dm.boundsAround(runtime.developmentCenter, runtime.maxRadiusMeters);
    const map = new g.Map(element, { center, mapId: runtime.mapId || undefined, clickableIcons: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
      restriction: { latLngBounds: maxB, strictBounds: !!runtime.strictBounds }, gestureHandling: 'cooperative' });
    // the circle communicates; the backend enforces (§59, §60). Never editable nor draggable (§58)
    const circle = new g.Circle({ map, center, radius: runtime.activeRadiusMeters, clickable: false, draggable: false, editable: false, strokeWeight: 2, fillOpacity: 0.06 });
    const devMarker = new g.Marker({ map, position: center, title: runtime.developmentName, label: { text: '◎', fontWeight: '700' }, zIndex: 1000 });
    const fit = r => map.fitBounds(Dm.boundsAround(runtime.developmentCenter, r), runtime.paddingPx || 32);
    fit(runtime.activeRadiusMeters);
    let markers = new Map(); const listeners = [];
    return {
      map, circle,
      setRadius(r) { if (r > runtime.maxRadiusMeters) return false; circle.setRadius(r); fit(r); return true; },
      /** setPlaces: markers derive from the current places state; repeated searches never duplicate markers (§517, §518) */
      setPlaces(places, selectedId, glyph = '•') {
        const keep = new Set(places.map(p => p.providerPlaceId));
        for (const [id, m] of markers) if (!keep.has(id)) { m.setMap(null); markers.delete(id); }
        for (const p of places) {
          let m = markers.get(p.providerPlaceId);
          if (!m) { m = new g.Marker({ map, position: { lat: p.location.latitude, lng: p.location.longitude }, title: p.name, label: { text: glyph } }); listeners.push(m.addListener('click', () => onSelect(p.providerPlaceId))); markers.set(p.providerPlaceId, m); }
          m.setZIndex(p.providerPlaceId === selectedId ? 900 : 1);
          if (m.setOpacity) m.setOpacity(!selectedId || p.providerPlaceId === selectedId ? 1 : 0.7);
        }
        return markers.size;
      },
      focus(place) { if (place) map.panTo({ lat: place.location.latitude, lng: place.location.longitude }); },
      markerCount: () => markers.size, developmentMarker: devMarker,
      destroy() { listeners.forEach(l => l && l.remove && l.remove()); for (const m of markers.values()) m.setMap(null); markers = new Map(); circle.setMap(null); devMarker.setMap(null); }
    };
  }

  /** runtimeConfig(developmentId, { mapId }) → GoogleMapsRuntimeConfig from the validated location (null when not ready). Never a key. */
  function runtimeConfig(developmentId, { mapId = null, radiusMeters = null, mobile = false } = {}) {
    const Dm = D(), Cf = C(), d = Cf.developments[developmentId]; if (!d) return null;
    const ready = Dm.locationReadiness(d.location, Cf); if (!ready.ready) return null;
    const pol = Dm.radiusPolicy(developmentId, Cf), r = radiusMeters && Dm.resolveRadius(radiusMeters, pol).ok ? radiusMeters : pol.defaultRadiusMeters;
    return { enabled: Cf.featureFlag.enabled && d.intelligence.enabled, clientMapId: mapId || undefined, developmentCenter: { ...d.location.center }, developmentName: d.location.name, activeRadiusMeters: r, maxRadiusMeters: pol.maxRadiusMeters,
      viewportBounds: Dm.boundsAround(d.location.center, pol.maxRadiusMeters), strictBounds: d.viewport.strictBounds, paddingPx: mobile ? d.viewport.paddingPx.mobile : d.viewport.paddingPx.desktop };
  }

  const api_ = { api, controller, loader, mapView, runtimeConfig };
  if (typeof module !== 'undefined' && module.exports) module.exports = api_;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.client = api_; }
})();
