/* presentation/app.js — composition root of the browser app.
   Boot (topic 10): app shell → saved user state → map frame → data (cache first, network otherwise) →
   render → background sync (version check + dynamic revalidation) → plan image from the asset cache.
   Components never talk to IndexedDB, Cache Storage or the Service Worker: they read the store and the
   selectors; the data layer (App.offline) owns every cache. */
App.main = async function main() {
  const { $, esc, toast, popover, closePop, copy } = App.ui, store = App.store, F = App.fmt, t = App.i18n.t;
  const R = App.repos, AV = App.availability, FL = App.services.filtering, LY = App.services.layers, ML = App.mapLayers, MS = App.mobileSheet, FX = App.filters;
  const RS = App.responsive, WK = App.workspace, SC = App.shortcuts;
  /** topic 51: errors go to the local observability provider (redacted, grouped, support code); console only in development */
  const obsInstrument = (k, ...a) => { try { const I = App.observability && App.observability.platform && App.observability.platform.instrument; if (I && typeof I[k] === 'function') return I[k](...a); } catch (e) { /* telemetry never breaks the app */ } return null; };
  const report = (e, area) => { try { if (App.observability && App.observability.platform) { App.observability.platform.report(e, area || 'Global'); return; } } catch (x) { /* fall through */ } console.error(e); };
  // round 6: code splitting. Features outside the first paint of the map arrive as chunks (App.chunks, loading/chunkLoader.js).
  // needChunk(name): true when its modules are loaded, otherwise starts the load (the onReady listener below re-renders).
  const CK = App.chunks && App.chunks.split() ? App.chunks : null;
  const chunkReady = name => !CK || CK.isLoaded(name), needChunk = name => !CK || CK.need(name), chunkHas = name => !CK || CK.has(name);
  // composition root injects the ports infrastructure must not reach on its own (GAP-ARCH-24 observability context/access, GAP-ARCH-25 PWA analytics sink)
  try { const OC = App.observability && App.observability.core; if (OC && OC.setContextSources) OC.setContextSources({ state: () => store.get(), auth: () => App.authz && App.authz.context(), profile: () => RS.get() }); } catch (e) { /* telemetry never breaks the app */ }
  try { const OP0 = App.observability && App.observability.platform; if (OP0 && OP0.setAccessCheck) OP0.setAccessCheck(() => !App.authz || App.authz.uiMode('technical').allowed); } catch (e) { /* deny by default */ }
  try { if (App.pwa && App.pwa.core && App.pwa.core.setSinks && App.analytics.client) App.pwa.core.setSinks({ analytics: App.analytics.client }); } catch (e) { /* product events stay off */ }
  let prof = RS.get() || RS.init() || RS.resolve({ viewportWidth: 1280, viewportHeight: 800 });
  // topic 53: compact navigation — one registry; placement (bottom / top / rail) and header overflow per responsive profile
  const NAVI = App.navigation, NAVV = NAVI && NAVI.view;
  if (NAVV) { NAVV.applyProfile(prof); NAVV.bind(document); }
  const navCtx = () => ({ profile: prof, authz: App.authz, resource: { developmentId: devId }, connectivity: store.get().connectivity });
  const hashDev = String(location.hash || '').replace(/^#/, '').split(/[.?]/)[0];
  const devId = R.DevelopmentRepository.getDevelopment(hashDev) ? hashDev : 'viva-juara';
  const dev = R.DevelopmentRepository.getDevelopmentConfig(devId), cfg = dev.presentation;
  const ws = $('ws');
  let lastSelectSource = 'DEEP_LINK', vpT = null, swState = null, shareLots = [], devInfoCache = { images: [] }, lastPanelKey = '', playRaf = 0, lastModel = null, techAnalysis = null, suspendedSnap = null, lotOpener = null, focusLotTitle = false, lastLiveLot = null, backMarker = false, poppedAt = 0, techVersioning = null;
  const techGuard = App.quickView.requestGuard();
  store.restore(devId);
  if (!store.get().activeMapLayer) store.set({ activeMapLayer: dev.map.defaultLayer }, { silent: true });
  if (!store.get().backgroundLayer) store.set({ backgroundLayer: dev.map.defaultBackground }, { silent: true });

  // ---------- header basics (before data: fast start)
  $('devSel').innerHTML = R.DevelopmentRepository.getDevelopments().map(d => `<option value="${esc(d.id)}"${d.id === devId ? ' selected' : ''}>${esc(d.name)}</option>`).join('');
  $('devSub').textContent = dev.city;
  const map = App.MapView.create($('center'), dev, {
    onSelect: id => { if (id) selectLot(id, { from: 'map' }); else if (store.get().drawerOpen) store.set({ drawerOpen: false }); else if (store.get().legendFocus) store.set({ legendFocus: null }); else if (isSmall() && store.get().currentLotId) store.set({ sheet: MS.TO_STORE[MS.onMapTapEmpty(MS.FROM_STORE[store.get().sheet])] || store.get().sheet }); },
    onMapDrag: () => { if (isSmall() && store.get().currentLotId) { const nx = MS.TO_STORE[MS.onMapDrag(MS.FROM_STORE[store.get().sheet])]; if (nx && nx !== store.get().sheet) store.set({ sheet: nx }); } },
    onHover: (id, e) => hover(id, e),
    onPoi: id => openPoi(id),
    onViewport: () => { backLotBtn(); saveViewport(); },
    onBackgroundError: what => mapMsg(`Não foi possível carregar a ${what}. Os lotes continuam navegáveis.`, 'warn')
  });
  /** the lot panel is a bottom sheet (phones, tablet portrait, compact tablets); decided by the responsive profile, not by one width */
  const isSmall = () => prof.regions.right === 'SHEET';
  const mapMsg = (txt, tone) => { const m = $('mapmsg'); if (!txt) { m.hidden = true; return; } m.className = 'mapmsg ' + (tone || ''); m.innerHTML = txt; m.hidden = false; };
  mapMsg('Carregando o empreendimento…');

  // ---------- data layer (hybrid: cache + network)
  // ---------- topic 49: PWA (update coordinator, connectivity service, offline pack, install policy). Nothing here changes a value.
  const PW = App.pwa && App.pwa.core && App.pwaView ? App.pwa : null;
  const authOrg = (() => { try { const c = App.authz ? App.authz.context() : null; return (c && c.tenant && c.tenant.organizationId) || 'org_house7'; } catch (e) { return 'org_house7'; } })();
  let CONN = null, UPD = null, INST = null, SYNC = null, PACK = null, pwaHint = null, packBusy = null, packMsg = null;
  try { if (PW && PW.pack) PACK = PW.pack.OfflinePackManager({ organizationId: authOrg, developmentId: devId, onCommitted: () => { if (H && H.sync) H.sync.sync('offline-pack').catch(() => {}); } }); } catch (e) { report(e, 'Pwa'); PACK = null; }
  /** the published files stay the source; only while the browser is offline, a READY offline pack answers (prices STALE, availability UNKNOWN) */
  function packFallbackRemote(primary, commercialRepo) {
    if (!PACK || !PW.pack.packRemote || !primary || primary.kind === 'offline-pack') return primary;
    const pack = PW.pack.packRemote(PACK, dev, commercialRepo), offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
    const wrap = k => async (...a) => { try { return await primary[k](...a); } catch (e) { if (!offline()) throw e; try { return await pack[k](...a); } catch (e2) { throw e; } } };
    const out = { ...primary }; for (const k of ['getManifest', 'getStructural', 'getCommercial']) if (typeof primary[k] === 'function') out[k] = wrap(k); return out;
  }
  let H;
  try { H = await App.offline.createHybrid(devId, { wrapRemote: packFallbackRemote }); }
  catch (e) { report(e, 'DataLayer'); const repo = R.createLotRepository(devId); H = { repo, source: { origin: 'REMOTE', lastLoad: null }, connectivity: App.offline.Connectivity(), sync: null, local: null, assets: null, backend: { kind: 'none' } }; }
  if (PW && PW.connectivity) { try { CONN = PW.connectivity.ConnectivityService({ probe: PW.connectivity.httpProbe('manifest.json') }); CONN.attach(H.connectivity); } catch (e) { report(e, 'Pwa'); CONN = null; } }
  if (PW && PW.sync) { try { SYNC = PW.sync.SyncCoordinator({ auth: () => ({ organizationId: authOrg, userId: 'device', authenticated: false }) }); } catch (e) { SYNC = null; } }
  if (PW) { try { INST = PW.core.InstallPromptController({}); } catch (e) { INST = null; } }
  const repo = H.repo, sel = App.selectors(repo, dev), spatial = R.SpatialRepository(devId), assetsRepo = R.AssetRepository(devId);
  try { await repo.load(); }
  catch (e) {
    report(e, 'DataLayer');
    mapMsg(e.code === 'FIRST_VISIT_OFFLINE' ? `<b>Sem conexão.</b> ${esc(e.message)}<br><button class="btn sm" data-act="reload">Tentar de novo</button>` : `<b>Não foi possível carregar os lotes.</b> ${esc(e.message)}<br><button class="btn sm" data-act="reload">Tentar de novo</button>`, 'error');
    document.addEventListener('click', ev => { if (ev.target.closest('[data-act=reload]')) location.reload(); });
    return;
  }
  mapMsg(null);
  const priceTable = () => repo.commercialRepo.getPriceTable();
  // price-table history (topic 28): built from the published table versions; one version today, so no change is computed
  const priceHist = (() => { try { return App.priceHistory.forDevelopment(devId, { repository: App.priceHistory.PriceHistoryRepository(devId, { commercialRepo: repo.commercialRepo }) }); } catch (e) { report(e, 'PriceHistory'); return null; } })();
  const lots0 = repo.lotsSync();
  map.init(lots0);

  // saved state must match the data that loaded (lots removed, filters renamed, viewport out of bounds)
  resolveBlock();
  function resolveBlock() { const resolve = ref => repo.resolve(ref); resolve.blockExists = b => repo.getBlocks().includes(b);
    const reg = ML.registry(devId);
    const dropped = store.sanitize({ resolve, filterKeys: Object.keys(FL.EMPTY), statuses: App.enums.AVAILABILITY_ORDER, layers: reg.primary.map(d => d.id), backgrounds: ['plan', 'aerial', 'hybrid'],
      overlays: reg.overlays.filter(o => o.toggle).map(o => o.id), constraintKeys: Object.keys(sel.recPolicy.constraints),
      plans: (priceTable() || { plans: [] }).plans.map(p => p.id), scoreKeys: ['housing', 'investment', 'family', 'premium', 'overall'], map: dev.map });
    if (dropped.length) App.lifecycle.note('user state sanitized', { dropped }); }
  // topic 43: the URL is decoded (versioned codec; links without v= are the old grammar, migrated losslessly), then restored
  // in dependency order against the loaded data. The patch never carries price, availability or customer data.
  const DL = App.deeplink, codeOf = id => { const l = repo.getLotById(id); return l ? l.identity.code : id; };
  const dlDeps = () => ({ currentDevelopmentId: devId, developmentExists: id => !!R.DevelopmentRepository.getDevelopment(id), resolveLot: ref => repo.resolve(ref),
    mapBounds: dev.map, detailSections: (cfg.detailSections || []).map(s => s.id), presentationMode: store.get().presentationMode,
    authorize: (k, res) => !!(App.authz && App.authz.can && App.authz.can(k, res)) });
  /** decode + restore one hash; null when there is nothing to restore or the link failed (the current screen stays) */
  function restoreHash(hash) {
    const dec = hash && hash !== '#' ? DL.codec.decode(hash) : null;
    const res = dec && dec.envelope ? DL.restoration.restore({ ...dec.envelope, status: dec.status }, dlDeps()) : null;
    let patch = res && res.status !== 'FAILED' ? { ...res.finalAppStatePatch } : null;
    // a plain map link (#<dev>) keeps the overlay the session had open, as the router of topics 10–24 did
    if (patch && ['MAP', 'DEVELOPMENT'].includes(dec.envelope.route) && patch.view === 'map') delete patch.view;
    return { dec, res, patch };
  }
  /** topics 44/45: deep-link observability, catalog fields only (route code, status, counts; never ids, codes or the URL) */
  function trackDeepLink(dec, res, source) {
    if (!dec || !App.analytics.client) return;
    const routeCode = dec.envelope ? dec.envelope.route : 'MAP', c = App.analytics.client, nav = { navigationSource: source };
    c.track('deep_link_opened', { routeCode, linkKind: 'INTERNAL' }, nav);
    if (!res) return;
    const warningCount = Math.min(100, (res.warnings || []).length);
    c.track('deep_link_restored', { routeCode, restoreStatus: res.status, stateRefUsed: false, warningCount }, nav);
    if (res.status === 'PARTIAL') c.track('deep_link_partial_restore', { routeCode, warningCount, droppedKeys: [...new Set(res.skippedBranches.map(s => String(s.branch).replace(/\W+/g, '_')))].slice(0, 20) }, nav);
  }
  const boot0 = restoreHash(location.hash), fromHash = boot0.patch;
  if (fromHash) store.set({ ...fromHash }, { silent: true });
  // topic 21: a deep link to a lot opens the summary half way; otherwise the last snap (never EXPANDED without context)
  { const st0 = store.get(), saved = MS.FROM_STORE[st0.sheet] || 'MINIMIZED';
    const snap = fromHash && fromHash.currentLotId ? 'INTERMEDIATE' : MS.initialSnap({ hasLot: !!st0.currentLotId, saved });
    store.set({ sheet: MS.TO_STORE[snap] || 'min' }, { silent: true }); }
  store.set({ dataRevision: 1, loadOrigin: H.source.origin, connectivity: H.connectivity.get() }, { silent: true });
  // topic 43: one coordinator decides push / replace / nothing for every URL write. Small screens never push (the back marker
  // of topic 21 owns the history there); Back/Forward never push; the first write after a link is a replace.
  /** a filter value the privacy policy rejects (e.g. a phone typed in the search) leaves the filters out of the URL, never the lot */
  const encodeUrl = e => { const r = DL.codec.encode(e); if (r.ok || !e.state || !e.state.filters) return r; const st2 = { ...e.state }; delete st2.filters; return DL.codec.encode({ ...e, state: st2 }); };
  const nav = DL.navigation.createCoordinator({ history, location, encode: encodeUrl, pushNavigational: !isSmall() });
  let navSrc = 'URL_RESTORE', lastRoute = null;
  function syncUrl(st, source) {
    const env = DL.service.extract(st, { codeOf }), r = nav.update(env, { source });
    const rc = env.route === 'MAP' && st.view && st.view !== 'map' ? String(st.view).toUpperCase() : env.route;
    if (rc !== lastRoute) { lastRoute = rc; if (App.analytics.client) App.analytics.client.track('route_viewed', { routeCode: rc, navigationSource: source }); }
    return r;
  }
  map.setViewport(store.get().mapViewport);
  if (store.get().currentLotId && !store.get().mapViewport) map.focusLot(store.get().currentLotId);

  // ---------- background image through the asset cache (plan P0, aerial lazy)
  const remoteManifest = () => (H.source.lastLoad && H.source.lastLoad.manifest && (H.source.lastLoad.manifest.remote || H.source.lastLoad.manifest)) || null;
  if (H.assets) H.assets.setManifest(remoteManifest());
  const bgUrls = { plan: null, aerial: null };
  async function applyBackground() {
    const mode = store.get().backgroundLayer;
    const need = mode === 'plan' ? ['plan'] : mode === 'aerial' ? ['aerial'] : ['plan', 'aerial'];
    for (const k of need) if (!bgUrls[k]) bgUrls[k] = H.assets ? await H.assets.get(dev.assets[k]) : dev.assets[k];
    map.setBackground(mode, bgUrls, store.get().baseMapBlend);
  }
  applyBackground();

  // ---------- workspace layout (topics 22 and 23): panels, widths, collapse, comparison tray, profile changes.
  // Layout only: nothing here changes the lot, customer, filters, layer or comparison, and nothing recalculates data.
  const layout = (() => {
    const legacy = (store.storage.get(store.keyOf(devId)) || {}).prefs || {}; // before the layout schema: leftCollapsed lived in the app state
    let family = prof.family, prefs = WK.loadPrefs(devId, family, store.storage, legacy), wsl = null, saveT2 = null, dragging = false;
    const vw = () => $('ws').clientWidth || window.innerWidth;
    const prof2 = () => prof.family === 'DESKTOP' ? 'DESKTOP' : 'TABLET';
    function fromPrefs() {
      const hasLot = !!store.get().currentLotId;
      if (family === 'TABLET') { const l = prefs.landscape || {}; return WK.desktopState({ leftPanel: { collapsed: true }, rightPanel: { collapsed: !hasLot || l.rightPanelCollapsed }, panelSizes: { left: null, right: l.rightPanelWidth }, activeLeftSection: l.lastLeftDrawerSection }); }
      return WK.desktopState({ leftPanel: { collapsed: prefs.leftCollapsed }, rightPanel: { collapsed: !hasLot, pinned: prefs.rightPinned }, panelSizes: { left: prefs.leftWidth, right: prefs.rightWidth }, bottomBar: { collapsed: prefs.bottomBarCollapsed }, activeLeftSection: prefs.lastLeftSection });
    }
    wsl = fromPrefs();
    /** saved at the end of a change (drag end, toggle), debounced; never per frame (§46–47) */
    function persist() {
      clearTimeout(saveT2); saveT2 = setTimeout(() => {
        if (family === 'TABLET') { prefs = { ...prefs, landscape: { ...prefs.landscape, rightPanelWidth: wsl.panelSizes.right, rightPanelCollapsed: wsl.rightPanel.collapsed && !!store.get().currentLotId, lastLeftDrawerSection: wsl.activeLeftSection },
          portrait: { ...prefs.portrait, lastSnapState: MS.FROM_STORE[store.get().sheet] || null, legendExpanded: store.get().legendExpanded } }; }
        else prefs = { ...prefs, leftWidth: wsl.panelSizes.left, rightWidth: wsl.panelSizes.right, leftCollapsed: wsl.leftPanel.collapsed, rightPinned: wsl.rightPanel.pinned, lastLeftSection: wsl.activeLeftSection, bottomBarCollapsed: wsl.bottomBar.collapsed };
        prefs = WK.savePrefs(devId, family, prefs, store.storage) || prefs;
      }, 300);
    }
    function widths() { const st = store.get(); return WK.effectiveWidths(wsl, { viewportWidth: vw(), profile: prof2(), details: st.panel === 'details' && !!st.currentLotId }); }
    /** writes the grid widths and the collapsed classes; the map keeps its centre on container resize (SVG viewBox), so no camera jump */
    function apply() {
      const st = store.get(), e = widths(), leftDocked = prof.regions.left === 'DOCKED', rightDocked = prof.regions.right === 'DOCKED';
      const lw = leftDocked && !wsl.leftPanel.collapsed ? e.left : 0, rw = rightDocked && !wsl.rightPanel.collapsed ? e.right : 0;
      if (!dragging) { ws.style.setProperty('--lw', lw + 'px'); ws.style.setProperty('--rw', rw + 'px'); }
      const lc = leftDocked && wsl.leftPanel.collapsed, rc = rightDocked && wsl.rightPanel.collapsed;
      if (st.leftCollapsed !== lc || st.rightCollapsed !== rc) store.set({ leftCollapsed: lc, rightCollapsed: rc }, { silent: true });
      if (NAVV && st.leftCollapsed !== lc) NAVV.update(NAVI.service.viewModel(store.get(), navCtx())); // topic 53: Encontrar "open" mark follows the docked panel
      ws.classList.toggle('lc', lc); ws.classList.toggle('rc', rc);
      ws.dataset.mode = WK.layoutModeOf(wsl, { presentation: !!st.presentationView, fullMap: st.fullMap, details: st.panel === 'details' });
      const cur = st.currentLotId ? repo.getLotById(st.currentLotId) : null;
      const pl = $('pcolL'), pr = $('pcolR');
      if (pl) { pl.hidden = !leftDocked; pl.setAttribute('aria-expanded', String(!wsl.leftPanel.collapsed)); pl.setAttribute('aria-label', wsl.leftPanel.collapsed ? 'Abrir o painel Encontrar' : 'Recolher o painel Encontrar'); pl.textContent = wsl.leftPanel.collapsed ? '›' : '‹'; }
      if (pr) { pr.hidden = !rightDocked || (!cur && wsl.rightPanel.collapsed); pr.setAttribute('aria-expanded', String(!wsl.rightPanel.collapsed)); pr.setAttribute('aria-label', wsl.rightPanel.collapsed ? (cur ? `Abrir o painel do lote ${cur.identity.displayCode}` : 'Abrir o painel do lote') : 'Recolher o painel do lote'); pr.textContent = wsl.rightPanel.collapsed ? '‹' : '›'; }
      for (const [id, which, w, docked] of [['rszL', 'left', lw, leftDocked], ['rszR', 'right', rw, rightDocked]]) {
        const r = $(id); if (!r) continue; const lim = WK.widthLimits(which, { viewportWidth: vw(), otherWidth: which === 'left' ? rw : lw, profile: prof2() });
        r.hidden = !docked || !w || (which === 'left' && !leftDocked); r.setAttribute('aria-valuenow', String(w)); r.setAttribute('aria-valuemin', String(lim.min)); r.setAttribute('aria-valuemax', String(lim.max));
      }
    }
    const set = (next, why) => { wsl = next; apply(); persist(); if (why) App.analytics.track(why); };
    const afterPanelChange = () => { setTimeout(() => keepLotVisible('panelOpen'), 230); };
    return {
      apply, get: () => wsl,
      toggleLeft() { set(WK.coordinator.toggleLeft(wsl), wsl.leftPanel.collapsed ? 'desktop_panel_opened' : 'desktop_panel_collapsed'); if (!wsl.leftPanel.collapsed) { const f = $('left').querySelector('input,button,select'); if (f && document.activeElement === document.body) f.focus({ preventScroll: true }); } },
      toggleRight() { const open = wsl.rightPanel.collapsed; set(open ? WK.coordinator.openRight(wsl, store.get().currentLotId ? 'LOT' : 'EMPTY') : WK.coordinator.closeRight(wsl, { manual: true }), open ? 'desktop_panel_opened' : 'desktop_panel_collapsed'); if (open) afterPanelChange();
        const pr = $('pcolR'); if (pr && document.activeElement && !document.activeElement.isConnected) pr.focus(); },
      toggleBottomBar() { set(WK.coordinator.toggleBottomBar(wsl), 'comparison_bar_toggled'); renderCmpBar(store.get()); },
      onLot(st, source) { const before = wsl.rightPanel.collapsed; set(st.currentLotId ? WK.coordinator.onLotSelect(wsl, { source }) : WK.coordinator.onLotClear(wsl)); if (before && !wsl.rightPanel.collapsed) afterPanelChange(); },
      onDetails(st) { set(st.panel === 'details' ? WK.coordinator.onDetailsOpen(wsl) : WK.coordinator.onDetailsClose(wsl, !!st.currentLotId)); },
      resizeStart() { dragging = true; ws.classList.add('resizing'); },
      /** live drag: CSS variable only (no store, no render, no data) */
      resizeLive(which, width) { const other = which === 'left' ? parseFloat(ws.style.getPropertyValue('--rw')) || 0 : parseFloat(ws.style.getPropertyValue('--lw')) || 0;
        const w = WK.clampWidth(which, width, { viewportWidth: vw(), otherWidth: other, profile: prof2() }); ws.style.setProperty(which === 'left' ? '--lw' : '--rw', w + 'px'); return w; },
      resizeEnd(which, width) { dragging = false; ws.classList.remove('resizing'); const other = which === 'left' ? widths().right : widths().left;
        set(WK.coordinator.resizePanel(wsl, which, width, { viewportWidth: vw(), otherWidth: wsl[which === 'left' ? 'rightPanel' : 'leftPanel'].collapsed ? 0 : other, profile: prof2() }), 'desktop_panel_resized'); setTimeout(() => keepLotVisible('resizeEnd'), 60); },
      /** profile change (rotation, split screen, window resize): the Quick View keeps its meaning in the new container (§82–84) */
      onProfileChange(prev, next) {
        const st = store.get(), detailsOpen = st.panel === 'details';
        if (prev && WK.isSheetProfile(prev.layoutProfile) !== WK.isSheetProfile(next.layoutProfile) && st.currentLotId) {
          const fromState = WK.isSheetProfile(prev.layoutProfile) ? (MS.FROM_STORE[st.sheet] || 'MINIMIZED') : (wsl.rightPanel.collapsed ? 'COLLAPSED' : (wsl.rightPanel.activeTab || 'NORMAL'));
          const to = WK.mapQuickViewStateAcrossLayouts(fromState, prev.layoutProfile, next.layoutProfile, { detailsOpen });
          if (WK.isSheetProfile(next.layoutProfile)) store.set({ sheet: MS.TO_STORE[to] || 'mid' });
          else wsl = to === 'COLLAPSED' ? WK.coordinator.closeRight(wsl, { manual: false }) : { ...WK.coordinator.openRight(wsl, detailsOpen ? 'DETAILS' : 'LOT'), rightPanel: { ...wsl.rightPanel, collapsed: false, activeTab: to }, panelSizes: { ...wsl.panelSizes, right: next.family === 'TABLET' ? null : wsl.panelSizes.right } };
        }
        if (prev && prev.family !== next.family) { family = next.family; prefs = WK.loadPrefs(devId, family, store.storage, legacy); const keepRight = wsl.rightPanel; wsl = { ...fromPrefs(), rightPanel: { ...fromPrefs().rightPanel, collapsed: keepRight.collapsed, activeTab: keepRight.activeTab } }; }
        if (next.regions.left === 'DOCKED' && st.drawerOpen) store.set({ drawerOpen: false });
        apply(); App.analytics.track('layout_profile_changed', { from: prev && prev.layoutProfile, to: next.layoutProfile });
      },
      persist
    };
  })();
  // ---------- topics 32–42 (integration). UI only: nothing here changes a lot value, score, class, colour, price or availability.
  const authCtx = App.authz ? App.authz.context() : null, ORG = (authCtx && authCtx.tenant && authCtx.tenant.organizationId) || 'org_house7', TEN = { organizationId: ORG, activeDevelopmentId: devId };
  const cfgDev = (App.config.DEVELOPMENTS || []).find(d => d.id === devId) || null;
  /** opaque per-device id for the device-local favorites namespace and presentation sessions (not an identity, not authorization) */
  const deviceId = (() => { let v = null; try { v = localStorage.getItem('vj-device-id'); } catch (e) { /* private mode */ }
    if (!v || !/^dev_[a-z0-9]{6,32}$/.test(v)) { v = 'dev_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); try { localStorage.setItem('vj-device-id', v); } catch (e) { /* private mode */ } } return v; })();
  /** topics 32–34: documents, provenance and data confidence, built lazily for the opened lot only (never all 498 at boot) */
  const trust = (() => {
    let docs = null, prov = null, conf = null; const loaded = new Set(), confBy = new Map();
    // static panel: the technical mode (gated by mode.technical) may read the catalog/provenance metadata the bundle already ships.
    // Read keys only: never download, manage, restricted documents or conflict resolution (those stay with the server).
    const READ = ['document.read', 'provenance.read', 'provenance.technical.read', 'confidence.technical.read'];
    const tech = mode => mode === 'technical' && (!App.authz || App.authz.uiMode('technical').allowed);
    function access(mode) {
      const t = tech(mode), base = App.documentServices && App.authz ? App.documentServices.accessFromAuthz(t ? 'TECHNICAL' : mode === 'client' ? 'CLIENT' : 'BROKER') : { mode: 'BROKER', can: () => false };
      return { ...base, organizationId: base.organizationId || ORG, can: (k, r) => (t && READ.includes(k)) || base.can(k, r) === true };
    }
    function docsVM(mode) {
      if (!App.documentServices) return null;
      if (!docs) { docs = App.documentServices.createService({}); App.documentServices.seedLegacy(docs, devId); }
      return App.documentServices.relatedDocuments(docs, TEN, { targetType: 'DEVELOPMENT', targetId: devId }, access(mode));
    }
    function provOf(lot) {
      if (!App.provenanceServices || !App.provenanceMigration || !lot) return null;
      if (!prov) prov = App.provenanceServices.createService({});
      if (!loaded.has(lot.identity.id)) { App.provenanceMigration.load(prov, TEN, [lot], devId, { validate: false }); loaded.add(lot.identity.id); }
      return prov;
    }
    const record = (lot, path) => { const p = provOf(lot); return p ? p.repo.current(TEN, 'LOT', lot.identity.id, path) : null; };
    const projection = (lot, path, mode) => { const p = provOf(lot); return p ? p.project(TEN, record(lot, path), { mode: 'TECHNICAL', access: access(mode) }) : null; };
    const lineage = (lot, path, mode) => { const p = provOf(lot); return p ? p.lineageViewModel(TEN, 'LOT', lot.identity.id, path, { access: access(mode) }) : null; };
    function confidence(lot, path, mode) {
      const p = provOf(lot); if (!p || !App.dataConfidenceServices) return null;
      if (!conf) conf = App.dataConfidenceServices.createService({ provenance: p, developmentId: devId });
      let rs = confBy.get(lot.identity.id); if (!rs) { rs = conf.evaluateEntity(TEN, 'LOT', lot, { asOf: new Date().toISOString() }); confBy.set(lot.identity.id, rs); }
      return rs[path] ? conf.project(TEN, rs[path], { mode: 'TECHNICAL', access: access(mode) }) : null;
    }
    /** technical mode only: provenance badge (opens the drilldown); '' elsewhere or without a record */
    function badgeHtml(lot, path, mode) {
      if (!tech(mode)) return '';
      if (!App.dataTrustView) { needChunk('technical'); return ''; }
      try { const p = projection(lot, path, mode); return p && p.ok !== false && !p.untracked ? ' ' + App.dataTrustView.badge(p, { attributePath: path, drilldown: true }) : ''; } catch (e) { report(e, 'DataTrust'); return ''; }
    }
    function docsHtml(mode) {
      if (!App.dataTrustView) { needChunk('technical'); return ''; }
      try { const vm = docsVM(mode); if (!vm) return ''; if (mode === 'client' && !vm.count) return '';
        let h = App.dataTrustView.relatedDocuments(vm);
        if (!vm.count && !tech(mode)) { const all = docsVM('technical'); if (all && all.count && App.authz.uiMode('technical').visible) h += `<p class="dt-muted">${all.count} documentos do empreendimento estão catalogados e aguardam revisão e publicação; a lista aparece no modo Técnico.</p>`; }
        return `<div class="dtwrap">${h}</div>`; } catch (e) { report(e, 'DataTrust'); return ''; }
    }
    function provPopover(lot, path, mode) {
      const p = projection(lot, path, mode), ln = lineage(lot, path, mode);
      return `<div class="poph"><b>Origem do dado</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${App.ui.icon('close')}</button></div>${App.dataTrustView.drilldown(p, ln && ln.ok ? ln : null)}<div class="acts2"><button class="btn sm" data-act="conf-open" data-path="${esc(path)}">Confiança do dado (técnico)</button></div>`;
    }
    function confPopover(lot, path, mode) {
      const c = confidence(lot, path, mode), html = c ? App.dataTrustView.confidencePanel(c) : '';
      return `<div class="poph"><b>Confiança do dado</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${App.ui.icon('close')}</button></div>${html || `<p class="small">${esc(c && c.message ? c.message : 'Sem avaliação de confiança para este campo.')}</p>`}`;
    }
    function historyPopover(lot, path) {
      const p = provOf(lot), h = p ? p.repo.history(TEN, 'LOT', lot.identity.id, path) : [];
      return `<div class="poph"><b>Histórico da origem</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${App.ui.icon('close')}</button></div>${h.length ? `<ul class="small">${h.map(r => `<li><code>${esc(r.provenanceKind)}</code> · ${esc(r.evidenceState)} · ${esc(r.status)}${r.recordedAt ? ' · ' + esc(F.formatDate(r.recordedAt)) : ''}</li>`).join('')}</ul>` : '<p class="small">Sem histórico registrado.</p>'}`;
    }
    function docPopover(docId, mode) {
      const vm = docs ? App.documentServices.detailViewModel(docs, TEN, docId, access(mode)) : null, d = vm && vm.ok ? vm.vm : null;
      const body = d ? `<dl><dt>Documento</dt><dd>${esc(d.document.title)}</dd><dt>Tipo</dt><dd>${esc(d.document.typeLabel)} · ${esc(d.document.authorityLabel)}</dd><dt>Versão publicada</dt><dd>${d.currentVersion ? esc(d.currentVersion.label) : 'Nenhuma (aguardando revisão)'}</dd>${d.versionHistory.length ? `<dt>Versões</dt><dd>${d.versionHistory.map(v => esc(`v${v.versionNumber} — ${v.statusLabel}`)).join('<br>')}</dd>` : ''}</dl><p class="small muted">A visualização do arquivo requer o servidor de documentos; este painel mostra só o catálogo.</p>`
        : '<p class="small">Documento indisponível para este acesso.</p>';
      return `<div class="poph"><b>Documento</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${App.ui.icon('close')}</button></div>${body}`;
    }
    const reset = () => { prov = null; conf = null; loaded.clear(); confBy.clear(); };
    return { access, badgeHtml, docsHtml, provPopover, confPopover, historyPopover, docPopover, reset, loadedCount: () => loaded.size };
  })();
  /** topic 47: gallery images reserve their 16:10 box and load lazily at low priority (never critical for the map route) */
  const galImgAttrs = () => App.loading && App.loading.planner ? App.loading.planner.imageAttrs({ width: 320, height: 200 }) : 'loading="lazy"';
  /** topic 37 helper: a value is missing only when null/undefined/'' (a real 0 is a value) */
  const orDash = v => v == null || v === '' ? '—' : v;
  /** topic 38: favorites domain service (device-local namespace), legacy migration, store bridge; booted after the first render */
  let favSvc = null, favBridge = null, favToastT = null;
  async function bootFavorites(o = {}) {
    if (CK && !CK.isLoaded('favorites')) { try { await CK.ensure('favorites'); } catch (e) { App.lifecycle.note('favorites chunk unavailable', { reason: e && e.code || 'ERROR' }); return; } }
    if (!App.favorites || !App.favorites.createService) return;
    try {
      let idb = null; try { idb = window.indexedDB || null; } catch (e) { idb = null; }
      let ls = null; try { ls = window.localStorage || null; } catch (e) { ls = null; }
      const svc = App.favorites.createService({ organizationId: ORG, userId: deviceId, developmentId: devId, deviceId, backend: App.favorites.pickBackend({ indexedDB: idb, storage: ls }),
        resolveLot: ref => repo.resolve(ref), resolveLots: ids => ids.map(x => repo.resolve(x)) });
      await svc.ready;
      await App.favorites.migrateLegacy(svc, { restored: o.fresh ? null : store.restoredFavorites(), storage: o.fresh ? null : ls, resolveLot: ref => repo.resolve(ref) });
      for (const id of store.get().favorites || []) if (!svc.isFavorite(id)) svc.add(id, { source: 'OTHER' }); // stars set before the service was ready
      favSvc = svc; favBridge = App.favorites.bindStore(store, svc);
      if (App.analytics.attachFavorites) { try { App.analytics.attachFavorites(svc); } catch (e) { report(e, 'Favorites'); } } // favorite_added/removed, local buffer only
      if (store.get().view === 'clients') renderOverlay(store.get());
    } catch (e) { report(e, 'Favorites'); App.lifecycle.note('favorites service unavailable', { reason: e && e.code || 'ERROR' }); favSvc = null; favBridge = null; }
  }
  function htmlToast(html, ms = 5000) { const tt = $('toast'); if (!tt) return; tt.innerHTML = html; tt.hidden = false; clearTimeout(favToastT); favToastT = setTimeout(() => { tt.hidden = true; }, ms); }
  function favItems(st) {
    if (!favSvc || !favBridge) return null;
    try { const r = favSvc.listItems({ context: favBridge.context(), sort: 'RECENTLY_ADDED' }, { mode: st.presentationMode }); return r && r.ok ? r.items : []; } catch (e) { report(e, 'Favorites'); return []; }
  }
  /** topics 39/40: clients workspace tab (UI only) and journey availability (server-side; the static panel has no session) */
  let custTab = 'summary';
  const journeyAvailable = () => !!(App.authz && App.journey && App.journey.services && App.authz.can('journey.read'));
  /** topic 41: guided presentation (definition → preflight → immutable snapshot → session); the "Apresentar" button is unchanged */
  const pm = { repo: null, def: null, src: null, sessionId: null, paused: false, startedPresentation: false, fromDecision: false };
  const pmCtx = () => ({ organizationId: cfgDev ? cfgDev.tenantId : null, userId: deviceId, developmentId: devId, now: new Date().toISOString() });
  if (App.presentationMode && App.presentationMode.runtime && App.presentationMode.runtime.bindAuth) { try { App.presentationMode.runtime.bindAuth(); } catch (e) { report(e, 'PresentationRuntime'); } }
  // ---------- topic 56: customer decision ("O que mostrar a este cliente — e por quê"). Orchestrates the recommendation the panel
  // already computed (same inputs, rank, tier and Fit); nothing is recalculated, persisted or sent. Session + selection live in memory
  // and reset when the customer changes. Local device permissions only (policy permissions.localDevice); sharing stays denied.
  const dec = { session: null, shortlist: null, mode: 'DISCOVER', progress: {}, customerId: undefined, rev: 0, memoKey: null, memoRec: null, memo: null, fromDecision: false };
  const DECT = { organizationId: ORG, developmentId: devId, localDevice: true, userId: deviceId };
  const decOn = () => !!(App.decision && App.decision.services && App.decision.domain && App.decisionView);
  /** round 6: the decision chunk is loaded the first time there is something to decide (a profile or a customer) */
  const decReady = st => decOn() || (CK && (st.currentCustomerId || sel.selectRecommendation(st)) ? (needChunk('decision'), false) : false);
  function decReset(custId) { Object.assign(dec, { session: null, shortlist: null, mode: 'DISCOVER', progress: {}, customerId: custId, rev: dec.rev + 1, memoKey: null, memoRec: null, memo: null }); }
  /** { ctx, r, cust } for the current state, or null (no profile and no customer → the Encontrar panel stays as before) */
  function decCompute(st) {
    if (!decReady(st)) return null;
    const cust = st.customers.find(c => c.id === st.currentCustomerId) || null, cid = cust ? cust.id : null;
    if (cid !== dec.customerId) decReset(cid);
    const rec = sel.selectRecommendation(st); if (!rec && !cust) return null;
    const key = [dec.rev, dec.mode, st.connectivity, st.dataRevision, st.objective || '', JSON.stringify(st.preferences || {}), JSON.stringify(st.constraints || {})].join('|');
    if (key === dec.memoKey && rec === dec.memoRec && dec.memo) return dec.memo;
    const DD = App.decision.domain, dv = repo.getDataVersions();
    const ctx = DD.buildContext({ organizationId: ORG, developmentId: devId, customer: cust ? { customerId: cust.id } : null, ui: { preferences: st.preferences, constraints: st.constraints, objective: st.objective }, dataVersions: dv });
    const r = App.decision.services.orchestrate({ context: ctx, lots: sel.selectLots(st), recommendation: rec, freshness: sel.selectFreshness(st), dataVersions: dv, priceTable: sel.selectCurrentPriceTable(), availabilityPolicy: sel.policy,
      offline: st.connectivity === 'OFFLINE', mode: dec.mode, shortlist: dec.shortlist, progress: dec.progress });
    dec.memoKey = key; dec.memoRec = rec; dec.memo = { ctx, r, cust };
    return dec.memo;
  }
  const custFavCtx = cu => cu ? { type: 'CUSTOMER', ref: cu.id, label: 'Favoritos de ' + String(cu.name).trim().split(/\s+/)[0] } : null;
  /** Encontrar: broker panel above the recommendation list; client mode gets the client-safe list (no score, codes, budget or notes) */
  function decisionHtml(st) {
    if (st.presentationView || !decReady(st)) return '';
    try {
      const d = decCompute(st); if (!d) return '';
      const S = App.decision.services;
      // lots the broker included although they break a criterion are not in the result: their cards are rebuilt from the exclusion detail (breach visible)
      const extraCandidates = dec.shortlist ? dec.shortlist.candidateIds.filter(id => !d.r.candidateSummaries.some(c => c.lotId === id))
        .map(id => S.forLot(d.r, id, { lots: sel.selectLots(st), context: d.ctx, priceTable: sel.selectCurrentPriceTable(), availabilityPolicy: sel.policy })).filter(Boolean) : [];
      if (st.presentationMode === 'client') return App.decisionView.clientList(S.clientSafe(d.r, { shortlist: dec.shortlist, candidates: extraCandidates }));
      const fc = custFavCtx(d.cust), favoriteIds = fc && favSvc ? d.r.candidateSummaries.map(c => c.lotId).filter(id => { try { return favSvc.isFavorite(id, fc); } catch (e) { return false; } }) : [];
      const cl = d.cust ? (App.customer && App.customer.context ? App.customer.context.headerLabel({ displayName: d.cust.name }, 'desktop') : d.cust.name) : null;
      return App.decisionView.panel(S.viewModel(d.r, { context: d.ctx, shortlist: dec.shortlist, customerLabel: cl, favoriteIds, comparisonIds: st.comparisonLotIds, mode: st.presentationMode, extraCandidates }));
    } catch (e) { report(e, 'Decision'); return ''; }
  }
  /** Quick View "Para este cliente" (only while a customer is being served; never in the presentation view) */
  function decisionQv(st, lotId) {
    if (!st.currentCustomerId || st.presentationView || !decReady(st)) return '';
    try { const d = decCompute(st); return d ? App.decisionView.quickView(App.decision.services.quickViewBlock(d.r, lotId, st.presentationMode)) : ''; } catch (e) { report(e, 'Decision'); return ''; }
  }
  function decRerender() { const st = store.get(); guard('find', () => renderFind(st)); guard('lot', () => renderLot(st)); }
  /** session + shortlist are created lazily, on the first curation (the suggestion is shown without creating anything) */
  function decEnsure(d) {
    const DD = App.decision.domain;
    if (!dec.session) { const s = DD.startSession(DECT, { developmentId: devId, context: d.ctx }); if (!s.ok) return s; const at = DD.attachResult(s.session, d.r); if (!at.ok) return at; dec.session = at.session; decTrack('decision_session_started', d.r); }
    if (!dec.shortlist) { const c = DD.createShortlist(dec.session, d.r); if (!c.ok) return c; dec.shortlist = c.shortlist; dec.rev++; decTrack('shortlist_created', d.r); }
    return { ok: true };
  }
  /** aggregate-only local analytics (no profile, budget, customer id or notes); silently skipped when the event is not registered */
  function decTrack(name, r) { try { const RG = App.eventTracking && App.eventTracking.registry; if (App.analytics.client && RG && RG.current().isRegistered(name)) App.analytics.client.track(name, App.decision.services.analyticsPayload(r)); } catch (e) { /* not registered (decision D56-5) */ } }
  function decShortlist(a) {
    const st = store.get(), d = decCompute(st); if (!d) return;
    const DD = App.decision.domain, S = App.decision.services, id = a.dataset.id, lot0 = repo.getLotById(id); if (!lot0) return;
    const e0 = decEnsure(d); if (!e0.ok) return toast(e0.message || 'Seleção indisponível.');
    const op = a.dataset.op === 'remove' ? 'REMOVE_FROM_SHORTLIST' : 'PROMOTE_TO_SHORTLIST', ack = a.dataset.ack === '1';
    if (op === 'PROMOTE_TO_SHORTLIST' && dec.shortlist.candidateIds.includes(id)) { if (ack) closeModal(); decRerender(); return toast(`${lot0.identity.displayCode} já está na seleção.`); }
    if (op === 'REMOVE_FROM_SHORTLIST' && !dec.shortlist.candidateIds.includes(id)) { decRerender(); return; }
    const reasonCode = ack ? (($('dcsReason') || {}).value || undefined) : undefined, note = ack ? (($('dcsNote') || {}).value || '').trim() || undefined : undefined;
    const opts = { context: d.ctx, tenant: DECT, candidate: S.forLot(d.r, id, { lots: sel.selectLots(st), context: d.ctx, priceTable: sel.selectCurrentPriceTable(), availabilityPolicy: sel.policy }), lotExists: true };
    const res = DD.applyOverride(dec.shortlist, { action: op, lotId: id, reasonCode, note, acknowledgeWarning: ack }, opts);
    if (!res.ok) {
      if (!ack && (res.code === 'REASON_REQUIRED' || res.code === 'WARNING_NOT_ACKNOWLEDGED')) { // sensitive inclusion: reason + confirmation; the breach stays visible
        const probe = res.breaches ? res : DD.applyOverride(dec.shortlist, { action: op, lotId: id, reasonCode: 'CUSTOMER_REQUESTED' }, opts), pol = DD.policyOf(devId);
        const reasons = (pol.overrideReasonCodes || []).map(code => ({ code, label: (pol.overrideReasonLabels || {})[code] || code }));
        $('modal').innerHTML = pmBox('Incluir na seleção', App.decisionView.overrideConfirm({ lotId: id, lotCode: lot0.identity.displayCode, breaches: probe.breaches || [], reasons }));
        $('modal').hidden = false; store.set({ modal: 'decOverride' }, { silent: true }); const f = $('dcsReason'); if (f) f.focus();
        return;
      }
      return toast(res.message || 'Não foi possível atualizar a seleção.');
    }
    dec.shortlist = res.shortlist; dec.rev++; if (ack) closeModal();
    decRerender(); toast(op === 'REMOVE_FROM_SHORTLIST' ? `${lot0.identity.displayCode} saiu da seleção.` : `${lot0.identity.displayCode} entrou na seleção${res.warnings && res.warnings.length ? ' (critério não atendido continua visível)' : ''}.`);
  }
  function decFavCust(a) {
    const st = store.get(), cu = st.customers.find(c => c.id === st.currentCustomerId) || null, id = a.dataset.id;
    if (!cu) return toast('Selecione um cliente para guardar favoritos dele.');
    if (!favSvc) return toast('Favoritos indisponíveis agora.');
    const r = favSvc.toggle(id, { context: custFavCtx(cu), source: 'OTHER' });
    if (!r || r.ok === false) return toast('Não foi possível atualizar o favorito agora.');
    dec.rev++; decRerender(); toast(favSvc.isFavorite(id, custFavCtx(cu)) ? 'Favoritado para o cliente.' : 'Removido dos favoritos do cliente.');
  }
  function decCompare() {
    const d = decCompute(store.get()); if (!d) return; const ids = d.r.shortlistIds.slice(0, App.services.comparison.MAX_LOTS);
    if (ids.length < 2) return toast('A seleção precisa de pelo menos 2 lotes para comparar.');
    dec.progress = { ...dec.progress, compared: true }; dec.rev++; store.set({ comparisonLotIds: ids, view: 'compare', drawerOpen: false });
  }
  function decRefresh() {
    dec.memoKey = null; dec.rev++; const d = decCompute(store.get()); if (!d) return;
    if (dec.session) { const at = App.decision.domain.attachResult(dec.session, d.r, { refreshReason: 'MANUAL_REFRESH' }); if (at.ok) dec.session = at.session; }
    decTrack('recommendation_generated', d.r); decRerender(); toast('Recomendação atualizada com os dados atuais.');
  }

  // ---------- rendering
  const ctx = () => {
    const st = store.get();
    const cust = st.customers.find(c => c.id === st.currentCustomerId) || null, fit = sel.selectFit(st);
    return { st, sel, repo, dev, cfg, mode: st.presentationMode, priceTable: priceTable(), objective: st.objective, prefs: st.preferences, ranking: sel.selectRanking(st),
      favorites: new Set(st.favorites), compareIds: st.comparisonLotIds, filteredIds: sel.selectFilteredLotIds(st), openSections: st.openSections, simulation: st.simulation,
      customerName: cust ? cust.name : undefined, fitById: fit, recommendation: sel.selectRecommendation(st), customer: fit ? { id: cust ? cust.id : 'working-profile', name: cust ? cust.name : null } : null,
      filterActive: sel.selectFilterActive(st), filterQuery: sel.selectFilterQuery(st).query, filterCtx: { policy: sel.policy, favorites: new Set(st.favorites), fit, developmentId: devId },
      activeLayerId: st.activeMapLayer, priceHistory: priceHist, view: st.view, connectivity: st.connectivity, showRoute: st.showRoute, presentation: !!st.presentationView, trust,
      decisionHtml: () => decisionHtml(st), decisionQv: lotId => decisionQv(st, lotId) };
  };
  let solarSvc = App.services.solar.make(dev.geo);
  function renderMap(st) {
    const filterActive = sel.selectFilterActive(st), filtered = sel.selectFilteredLotIds(st);
    if (st.panel === 'solar' && st.currentLotId && st.solar.onMap && dev.features.solarAnalysis) { // solar "now" view while the solar analysis is open
      const lv = LY.solarNow(sel.selectLots(st), solarSvc, st.solar.season, st.solar.hour);
      map.paint(lv.colorOf); map.setMarks({ sel: st.currentLotId, cmp: new Set(st.comparisonLotIds), fav: new Set(st.favorites), dim: filterActive ? filtered : null }); map.setPins({ cmp: st.comparisonLotIds, top: [] });
      lastModel = null; renderSolarLegend(lv);
    } else {
      let m;
      try { m = sel.selectRenderModel(st); } catch (e) { report(e, 'MapRenderer'); mapMsg('Não foi possível carregar esta camada.', 'warn'); return; }
      lastModel = m; map.render(m); renderLegend(st, m);
    }
    const cnt = $('mapCount'); cnt.hidden = !filterActive; cnt.textContent = `${F.number(filtered.size)} ${filtered.size === 1 ? 'lote' : 'lotes'} no filtro`;
    backLotBtn();
  }
  function renderSolarLegend(lv) {
    $('legend').innerHTML = `<div class="lh"><b>${esc(lv.title)}</b></div><div class="items">${lv.classes.map(c => `<span class="it"><i class="sw" style="background:${c.color}"></i>${esc(c.label)} <span class="count">${F.number(c.count)}</span></span>`).join('')}</div>${lv.note ? `<div class="note">${esc(lv.note)}</div>` : ''}`;
  }
  /** smart legend (topic 19): same scale and values as the map; hover/click only highlight; filtering is an explicit button */
  /** topic 19 §143: phones start with the legend as a chip ("Preço ▾"); tablets/desktop start expanded; an explicit toggle wins */
  const legendOpen = st => st.legendExpanded == null ? prof.regions.legend === 'EXPANDED' : st.legendExpanded; // tablets start compact (topic 23 §30, §119)
  function renderLegend(st, m) {
    const ae = document.activeElement, refocus = ae && $('legend').contains(ae) ? { act: ae.dataset.act, k: ae.dataset.k } : null;
    const lg = $('legend'), mode = st.presentationMode, cur = st.currentLotId ? repo.getLotById(st.currentLotId) : null;
    let vm;
    try { vm = App.legend.viewModel(sel.selectLegend(st), { mode, selectedCode: cur ? cur.identity.displayCode : null, customerLabel: (ctx().customer || {}).name || null }); }
    catch (e) { report(e, 'Legend'); vm = { title: m.def.label, error: 'Legenda indisponível.', items: [], overlays: [], warnings: [] }; }
    const open = legendOpen(st), focus = st.legendFocus && st.legendFocus.layerId === m.def.id ? st.legendFocus.itemKey : null;
    let h = `<div class="lh"><button class="mbtn sm" data-act="layers" aria-haspopup="dialog" aria-label="Visualizar por: ${esc(vm.title)}. Trocar camada">${App.ui.icon('layers')} ${esc(vm.title)} ▾</button>${m.def.id !== 'none' ? `<button class="lbtn small" data-act="legendToggle" aria-expanded="${open}">${open ? 'Recolher' : 'Legenda'}</button>` : ''}</div>`;
    if (vm.error) h += `<div class="note">${esc(vm.error)}</div>`;
    else if (open && m.def.id !== 'none') {
      h += `<div class="items" role="list" aria-label="Legenda: ${esc(vm.title)}">${vm.items.map(it => `<span class="itw" role="listitem"><button class="it${it.selected ? ' selit' : ''}${focus === it.key ? ' foc' : ''}${it.pattern ? ' pat' : ''}" data-act="legendItem" data-k="${esc(it.key)}" aria-pressed="${focus === it.key}" aria-label="${esc(it.aria)}"${it.disabled ? ' disabled' : ''}><i class="sw${it.pattern ? ' ' + esc(it.pattern.replace('pattern.', 'p-')) : ''}" style="background:${it.color}"></i>${esc(it.label)}${it.count ? ` <span class="count">${esc(it.count)}</span>` : ''}${it.selected && vm.selected && vm.selected.code ? ` <span class="selmark">◆ ${esc(vm.selected.code)}</span>` : ''}</button>${it.filterAction && focus === it.key ? `<button class="lbtn small" data-act="legendFilter" data-k="${esc(it.key)}">${esc(it.filterAction.label)}</button>` : ''}</span>`).join('')}</div>`;
      if (vm.selected && (!vm.items.some(i => i.selected) || vm.selected.text.startsWith('Lote selecionado'))) h += `<div class="note sel">${esc(vm.selected.text)}</div>`;
      if (vm.selected && Number.isFinite(vm.selected.position)) h += `<div class="lpos" aria-hidden="true"><i style="left:${Math.max(0, Math.min(100, vm.selected.position * 100)).toFixed(1)}%"></i></div>`;
      if (vm.filterSummary) h += `<div class="note">${esc(vm.filterSummary)} A escala não muda com o filtro.</div>`;
      for (const w of vm.warnings) h += `<div class="note warn">${esc(w)}</div>`;
      if (vm.coverage) h += `<div class="note">${esc(vm.coverage)}</div>`;
      if (vm.note) h += `<div class="note">${esc(vm.note)}</div>`;
      for (const o of vm.overlays) h += `<div class="lsec"><b>${esc(o.title)}</b> ${o.items.map(i => o.id === 'comparison' ? `<span class="pinlbl">${i.number}</span> ${esc((repo.getLotById(i.lotId) || { identity: { displayCode: '' } }).identity.displayCode)}` : `<span class="it0">${esc(i.label)}${i.count ? ' · ' + esc(i.count) : ''}</span>`).join(' ')}</div>`;
      if (mode !== 'client' && vm.technical && st.presentationMode === 'technical') h += `<div class="note">Escala ${esc(vm.technical.scaleType)} · ${esc(vm.technical.domainSource)} · versão ${esc(orDash(vm.technical.dataVersion))}</div>`;
      if (m.def.id === 'availability' && mode === 'client' && st.connectivity !== 'ONLINE' && sel.selectHasAvailabilityFeed(st)) h += '<div class="note">Disponibilidade sujeita a confirmação.</div>';
    }
    lg.innerHTML = h;
    if (refocus && refocus.act) { const n = [...lg.querySelectorAll(`[data-act="${refocus.act}"]`)].find(b => (b.dataset.k || null) === (refocus.k || null)) || lg.querySelector('[data-act=legendToggle]'); if (n) n.focus({ preventScroll: true }); }
    const live = $('mapLive'), msg = focus ? (() => { const it = vm.items.find(i => i.key === focus); return it ? `Destacando ${it.label}${it.count ? ' (' + it.count + ')' : ''} no mapa.` : ''; })() : `Mapa por ${vm.title}.`;
    if (live && live.dataset.m !== msg) { live.dataset.m = msg; live.textContent = msg; }
  }
  let lastZero = false;
  function renderFind(st) { const fr0 = sel.selectFilterResult(st), zero = !!(fr0.diagnostics && fr0.diagnostics.zeroResult); if (zero && !lastZero) App.analytics.track('filter_zero_result', { n: sel.selectFilterQuery(st).query.conditions.length }); lastZero = zero;
    const box = $('left'), sc = box.querySelector('.pb'), top = sc ? sc.scrollTop : 0; box.innerHTML = App.panels.find(st, ctx()); const nb = box.querySelector('.pb'); if (nb) nb.scrollTop = top; }
  function renderLot(st) {
    const rp = $('rp'), sc = rp.querySelector('.pb'), top = sc ? sc.scrollTop : 0, x = ctx(), lot = sel.selectCurrentLot(st);
    $('right').dataset.sheet = lot ? st.sheet : 'min'; applySheetHeight(lot ? st.sheet : 'min');
    if (!lot) { rp.innerHTML = App.panels.empty(st, x); lastLiveLot = null; return; }
    const q = App.vm.quickViewVM(lot, x);
    if (st.panel === 'details') rp.innerHTML = App.panels.details(App.vm.detailsVM(lot, x), st, x);
    else if (st.panel === 'simulation') { const s = App.vm.simulationVM(lot, x); rp.innerHTML = App.panels.simulation(s, q, st, x); if (st.simulation.expanded) App.panels.drawChart(s); }
    else if (st.panel === 'solar') { rp.innerHTML = App.panels.solar(q, st, x); App.panels.drawSun(lot, st.solar, solarSvc); }
    else rp.innerHTML = App.panels.quick(q, st, x);
    const nb = rp.querySelector('.pb'); if (nb && sameLotPanel(st)) nb.scrollTop = top;
    if (focusLotTitle) { focusLotTitle = false; const h2 = $('lotTitle'); if (h2) h2.focus({ preventScroll: true }); }
    if (lastLiveLot !== lot.identity.id) { lastLiveLot = lot.identity.id; const live = $('sheetLive'); if (live) live.textContent = `${F.formatLotTitle(lot.identity.blockId, lot.identity.lotNumber)} selecionado.`; }
  }
  const sameLotPanel = st => { const k = st.currentLotId + '|' + st.panel; const same = k === lastPanelKey; lastPanelKey = k; return same; };
  /** header search: the placeholder adapts to the box width (1024–1700 px headers truncated "Buscar lote (B79) ou quadra");
      markup and aria-label stay the same (navHeader --check), only the visible hint gets shorter */
  const SEARCH_PH = ['Buscar lote (B79) ou quadra', 'Buscar lote ou quadra', 'Buscar lote'];
  let phCanvas = null, phEl = null, phObs = null;
  function fitSearchPlaceholder() {
    try { const q = $('q'); if (!q || !q.clientWidth) return; const cs = getComputedStyle(q);
      const avail = q.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0) - 6;
      phCanvas = phCanvas || document.createElement('canvas'); const g = phCanvas.getContext('2d'); if (!g) return; g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const pick = SEARCH_PH.find(x => g.measureText(x).width <= avail) || SEARCH_PH[SEARCH_PH.length - 1]; if (q.placeholder !== pick) q.placeholder = pick; } catch (e) { /* cosmetic only */ }
  }
  function watchSearchPlaceholder() {
    const q = $('q'); if (q && q !== phEl) { phEl = q; try { if (phObs) phObs.disconnect(); if (typeof ResizeObserver !== 'undefined') { phObs = new ResizeObserver(() => fitSearchPlaceholder()); phObs.observe(q); } } catch (e) { /* no observer: resize/render calls still fit it */ } }
    fitSearchPlaceholder();
  }
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSearchPlaceholder).catch(() => {}); } catch (e) { /* no font API */ }
  function renderHeader(st) {
    if (NAVV) NAVV.update(NAVI.service.viewModel(st, navCtx())); // topic 53: aria-current, badge, permission/offline state
    watchSearchPlaceholder();
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(st.presentationMode === b.dataset.mode)));
    const cu = st.customers.find(x => x.id === st.currentCustomerId);
    // topic 39: context label ("Atendendo: Maria Souza" on desktop, "Maria" on phones/tablets); never a phone or e-mail
    if (cu) needChunk('customer'); // "Atendendo: …" label comes from the customer chunk; "Cliente: …" until it arrives
    const cl = cu && App.customer && App.customer.context ? App.customer.context.headerLabel({ displayName: cu.name }, prof.family === 'DESKTOP' ? 'desktop' : 'mobile') : null;
    $('custBtn').innerHTML = cu ? (cl ? `<b>${esc(cl)}</b>` : `Cliente: <b>${esc(cu.name)}</b>`) : 'Sem cliente'; $('custBtn').setAttribute('aria-label', cu ? `${cl || 'Cliente: ' + cu.name}. Abrir clientes` : 'Sem cliente. Abrir clientes'); $('custClr').hidden = !cu;
    // access context (topics 30/31): organization · role chip; UI modes are not roles, but a mode can need a permission
    if (App.authz && App.securityView) { const avm = App.authz.viewModel(); $('secChip').innerHTML = App.securityView.contextChip(avm); $('secBanner').innerHTML = App.securityView.sessionBanner(avm);
      document.querySelectorAll('[data-act=mode]').forEach(b => { b.hidden = !App.authz.uiMode(b.dataset.mode).visible; }); document.querySelectorAll('[data-act=present]').forEach(b => { b.hidden = b.classList.contains('presexit') ? b.hidden : !App.authz.uiMode('presentation').visible; }); }
    const fc = FL.activeCount(st.activeFilters); const fb = $('openFind').querySelector('.cnt'); fb.textContent = fc; fb.hidden = !fc;
  }
  function renderNet(st) {
    const info = H.sync ? H.sync.info() : {}, vm = App.vm.connectivityVM({ connectivity: st.connectivity, sync: info, freshness: repo.getFreshness(), mode: st.presentationMode, loadOrigin: st.loadOrigin });
    const nb = $('netbar'), uvm = UPD ? PW.update.viewModel(UPD.getState()) : null;
    if (uvm) { nb.className = 'netbar pwaup ' + uvm.tone; nb.innerHTML = App.pwaView.updateBanner(uvm); nb.hidden = false; } // topic 49: only the user activates a new version
    else if (st.appUpdate === true) { nb.className = 'netbar info'; nb.innerHTML = `Nova versão disponível. <button class="lbtn" data-act="appUpdate">Atualizar</button>`; nb.hidden = false; }
    else if (vm.banner) { nb.className = 'netbar ' + vm.banner.tone; nb.innerHTML = esc(vm.banner.text) + (st.connectivity !== 'OFFLINE' && H.sync ? ` <button class="lbtn" data-act="refresh">Tentar de novo</button>` : ''); nb.hidden = false; }
    else if (pwaHint && st.presentationMode !== 'client' && !st.presentationView) { nb.className = 'netbar pwaup info'; nb.innerHTML = App.pwaView.installHint(pwaHint); nb.hidden = false; }
    else nb.hidden = true;
    // topic 49: connectivity chip from the ConnectivityService (hysteresis + probe); hidden while online with nothing pending
    const ci = CONN && st.presentationMode !== 'client' ? PW.connectivity.indicator(CONN.getState(), { syncing: st.syncState === 'SYNCING' }) : null;
    const si = $('syncInd');
    if (ci && ci.visible) { si.hidden = false; si.dataset.state = ci.state; si.innerHTML = App.pwaView.connectivityChip(ci); si.setAttribute('aria-label', `${ci.label}${ci.detail ? '. ' + ci.detail : ''} Abrir dados do empreendimento`); }
    else if (vm.indicator) { si.hidden = false; si.dataset.state = vm.indicator.state; si.textContent = vm.indicator.text; si.removeAttribute('aria-label'); } else si.hidden = true;
  }
  function renderCmpBar(st) {
    const ids = st.comparisonLotIds, lots = repo.getLotsByIds(ids);
    // comparison tray (topic 22 §71–75): hidden without lots, compact chips (code, preço de tabela, área), can be minimised
    const bar = $('cmpbar'), mini = layout.get().bottomBar.collapsed; bar.classList.toggle('empty', !lots.length); bar.classList.toggle('mini', mini && !!lots.length);
    bar.innerHTML = !lots.length ? '' : `<span class="lbl">Comparação <small>(${lots.length} de ${App.services.comparison.MAX_LOTS})</small></span>${mini ? '' : `<div class="lots">${lots.map((l, i) => `<span class="cmpchip"><span class="pinlbl">${i + 1}</span><button class="open" data-act="goLot" data-id="${l.identity.id}" title="Abrir o lote no mapa">${esc(l.identity.displayCode)}<small>${esc(l.commercial.price != null ? F.formatBRLShort(l.commercial.price) : F.ND)} · ${esc(l.geometry.areaM2 != null ? F.formatSquareMeters(l.geometry.areaM2, 0) : F.ND)}</small></button><button data-act="cmpRemove" data-id="${l.identity.id}" aria-label="Remover ${esc(l.identity.displayCode)} da comparação">×</button></span>`).join('')}</div>${lots.length < 2 ? '<span class="hint">Adicione mais um lote para comparar lado a lado.</span>' : ''}`}<span class="sp"></span>${lots.length >= 2 ? `<button class="btn pri" data-act="view" data-v="compare">Comparar ${lots.length} lotes</button>` : ''}<button class="lbtn small" data-act="cmpBarToggle" aria-expanded="${!mini}">${mini ? 'Mostrar' : 'Minimizar'}</button>`;
    const fab = $('cmpFab'); fab.hidden = lots.length < 2; fab.textContent = `Comparar ${lots.length}`;
  }
  async function devInfo() {
    const st = store.get(), fr = repo.getFreshnessState();
    const info = { freshness: fr, versions: repo.getDataVersions() || {}, sync: H.sync ? H.sync.info() : {}, connectivity: st.connectivity, origin: st.loadOrigin, backend: H.backend && H.backend.kind,
      report: repo.getQualityReport(), estimate: await App.offline.storageEstimate(), cachesSupported: typeof caches !== 'undefined', sw: swState, images: devInfoCache.images };
    try { info.planCached = H.assets ? await H.assets.has(dev.assets.plan) : false; } catch (e) { info.planCached = false; }
    info.offlineReady = !!(swState && swState.registered && info.planCached && info.backend === 'indexeddb' && st.loadOrigin);
    try { info.images = devInfoCache.images = await assetsRepo.getImages(); } catch (e) { /* offline */ }
    // topic 48: wording for values served from this device's copy (null when the source confirmed them: today's text stays)
    if (App.cache && App.cache.core && st.loadOrigin === 'CACHE') {
      const CC = App.cache.core, pt = priceTable(), av = fr && fr.availability;
      const pd = CC.priceDisplay(pt ? (pt.pricePerM2 != null ? pt.pricePerM2 : pt.id || 'table') : null, { cacheStatus: 'HIT_STALE', domainFreshness: fr && fr.commercial ? fr.commercial.status : 'UNKNOWN' });
      const ad = CC.availabilityDisplay(av && av.status === 'UNKNOWN' ? 'UNKNOWN' : av ? 'KNOWN' : null, { cacheStatus: 'HIT_STALE', domainFreshness: av ? av.status : 'UNKNOWN' });
      info.cacheLabels = { price: pd.label, availability: ad.label };
    }
    return info;
  }
  async function renderOverlay(st) {
    const ov = $('overlay'), x = ctx();
    if (st.view === 'map') { ov.hidden = true; ov.innerHTML = ''; return; }
    ov.hidden = false;
    // round 6: the view's chunks first (short loading state; an error offers a retry and keeps the map working)
    const want = overlayChunks(st), missing = want.filter(n => !chunkReady(n));
    if (missing.length) {
      if (missing.some(n => CK.failed(n))) { ov.innerHTML = overlayHead(st) + `<div class="ob"><div class="pb regerr" role="alert"><p>Não foi possível carregar esta parte do painel agora. Verifique a conexão; o mapa continua funcionando.</p><button class="btn sm" data-act="retryRegion">Tentar de novo</button></div></div>`; return; }
      ov.innerHTML = overlayHead(st) + `<div class="ob">${App.loadingView ? App.loadingView.skeleton('section', { label: 'Carregando esta parte do painel…' }) : '<p class="small">Carregando…</p>'}</div>`;
      missing.forEach(needChunk); return; // the chunk listener renders the view when its code is in
    }
    if (st.view === 'compare') {
      const lots = sel.selectComparisonLots(st);
      if (!lots.length || !App.compareView) { ov.innerHTML = App.overlays.compare(lots.length ? App.vm.comparisonVM(lots, x) : null, st, x); return; }
      // topics 24–25: comparison domain + per-criterion evaluation (no overall winner); the list stays in the store
      try {
        const r = App.compareView.view({ developmentId: devId, lotIds: st.comparisonLotIds, resolve: ref => repo.resolve(ref),
          audience: st.presentationMode === 'client' ? 'client' : st.presentationView ? 'presentation' : st.presentationMode === 'technical' ? 'technical' : 'broker',
          scoreKey: st.scoreKey, fitById: sel.selectFit(st), customerProfile: sel.selectProfile(st), recommendation: sel.selectRecommendation(st),
          filter: { active: sel.selectFilterActive(st), matchedIds: sel.selectFilteredLotIds(st) }, activeLayerId: st.activeMapLayer });
        ov.innerHTML = `<div class="oh"><h2>Comparar lotes</h2><span class="small">${lots.length} de ${App.services.comparison.MAX_LOTS}</span><span class="sp"></span>${pmButton('comparison', lots.length)}<button class="btn" data-act="view" data-v="map">${App.ui.icon('close')} Voltar ao mapa</button></div><div class="ob">${r.html}</div>`;
        App.compareView.bind(ov);
      } catch (e) { report(e, 'Comparison'); ov.innerHTML = App.overlays.compare(App.vm.comparisonVM(lots, x), st, x); }
    }
    else if (st.view === 'clients') ov.innerHTML = App.overlays.clients(st, x, clientsExtra(st, x));
    else if (st.view === 'development') {
      const info = await devInfo(); if (store.get().view !== 'development') return;
      ov.innerHTML = App.overlays.development(st, x, info);
      ov.querySelectorAll('img[data-src]').forEach(img => { img.src = img.dataset.src; });
      const ob = ov.querySelector('.ob'), mh = st.presentationMode === 'technical' ? metricsInner() : '';
      const env = st.presentationMode === 'technical' ? envHtml() : ''; // round 6 / topic 63: Localização & Entorno (technical mode only; flag OFF → state notice, no Google script)
      if (ob && env) ob.insertAdjacentHTML('beforeend', `<section class="sec envsec" id="envSec" aria-label="Localização e Entorno">${env}</section>`);
      if (ob && PACK && st.presentationMode !== 'client') { ob.insertAdjacentHTML('beforeend', `<section class="sec" id="pwaSec" aria-label="Uso offline" aria-busy="true"><p class="small">Verificando o uso offline…</p></section>`); renderPack(); }
      if (ob && mh) ob.insertAdjacentHTML('beforeend', `<section class="sec amwrap" id="amSec">${mh}</section>`);
      const oh = st.presentationMode === 'technical' ? obsInner(info) : ''; // topic 51: "Saúde da plataforma", next to "Métricas locais"
      if (ob && oh) ob.insertAdjacentHTML('beforeend', `<section class="sec amwrap" id="obsSec">${oh}</section>`);
    }
  }
  /** round 6: chunks a view needs before it can render (lazy parts of the panel) */
  function overlayChunks(st) {
    if (!CK) return [];
    if (st.view === 'compare') return st.comparisonLotIds.length ? ['comparison'] : [];
    if (st.view === 'clients') return ['customer'];
    if (st.view === 'development') return st.presentationMode === 'technical' ? ['technical', 'privacy', 'surroundings'] : ['technical', 'privacy'];
    return [];
  }
  /** round 6: actions whose code is in a chunk (they wait for it on first use) */
  const ACT_CHUNKS = { pmStart: ['presentation'], pmGo: ['presentation'], pmResume: ['presentation'], decPresent: ['decision', 'presentation'], custTab: ['customer'], custPick: ['customer'],
    cmpMove: ['comparison'], cmpProfile: ['comparison'], decMode: ['decision'], decShortlist: ['decision'], decFavCust: ['decision'], decCompareShortlist: ['decision'], decRefresh: ['decision'],
    'prov-open': ['technical'], 'conf-open': ['technical'], 'prov-history': ['technical'], 'doc-preview': ['technical'], techExplain: ['technical'], favCtx: ['favorites'],
    privacyExport: ['privacy'], privacyEraseLocal: ['privacy'], privacyEraseConfirm: ['privacy'] };
  const OV_TITLE = { compare: 'Comparar lotes', clients: 'Clientes', development: 'Empreendimento' };
  const overlayHead = st => `<div class="oh"><h2>${esc(OV_TITLE[st.view] || dev.name)}</h2><span class="sp"></span><button class="btn" data-act="view" data-v="map">${App.ui.icon('close')} Voltar ao mapa</button></div>`;
  /** topic 63 in the public panel: capability only. Coordinate validated (KMZ AC3 Portaria), flag OFF and no key → "não configurado". */
  function envHtml() {
    const S = App.surroundings, V = App.surroundingsView; if (!S || !S.domain || !V) return '';
    try {
      const cap = S.domain.capability(devId, { browserKeyConfigured: false, serverKeyConfigured: false, online: typeof navigator === 'undefined' ? true : navigator.onLine !== false });
      return (cap.GOOGLE_MAPS_ENVIRONMENT ? V.tabs({ active: 'lots', showEnvironment: true }) : '') + V.render(V.viewModel({ developmentId: devId, capability: cap, state: null }));
    } catch (e) { report(e, 'Surroundings'); return ''; }
  }
  // ---------- round 7 (2026-10-19): "Mapa de Lotes | Entorno" for everyone. Entorno = keyless OpenStreetMap base map + georeferenced
  // plan + rings + Google Maps links (surroundings chunk, loaded on the first open only). It sits over the lot map (#envView) and
  // never touches it: the lot map keeps its camera, layers and colours underneath.
  let envOn = false, envCtl = null;
  function envSync() { document.querySelectorAll('[data-act=envTab]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.v === 'environment') === envOn))); }
  async function setEnv(on) {
    const box = $('envView'); if (!box) return;
    if (!on) { envOn = false; envSync(); if (envCtl) { envCtl.destroy(); envCtl = null; } box.hidden = true; box.innerHTML = ''; return; }
    if (CK && !CK.isLoaded('surroundings')) { try { await CK.ensureAll(['surroundings']); } catch (x) { toast('Não foi possível carregar o Entorno agora. Verifique a conexão e tente de novo.'); return; } }
    const E = App.surroundings && App.surroundings.entorno; if (!E) { toast('Entorno indisponível neste navegador.'); return; }
    envOn = true; envSync(); if (store.get().view !== 'map') store.set({ view: 'map' });
    box.hidden = false;
    try {
      if (!bgUrls.plan) bgUrls.plan = H.assets ? await H.assets.get(dev.assets.plan) : dev.assets.plan;
      if (!envOn) return;
      if (envCtl) envCtl.destroy();
      envCtl = E.mount(box, { developmentId: devId, lots: repo.lotsSync(), planUrl: bgUrls.plan, planSize: { w: dev.map.width, h: dev.map.height }, online: navigator.onLine !== false,
        onLot: id => selectLot(id, { from: 'map' }) });
      const vp = box.querySelector('.envvp'); if (vp) vp.focus({ preventScroll: true });
    } catch (e) { report(e, 'Surroundings'); box.innerHTML = `<div class="envbar">${E.switchHtml('environment')}</div><p class="small" role="alert">Não foi possível abrir o Entorno.</p>`; }
  }
  // ---------- topic 49: "Uso offline" in Empreendimento (explicit offline pack; installing the app ≠ data available offline)
  const effConn = () => (CONN ? CONN.get() : store.get().connectivity) || 'UNKNOWN';
  /** "Disponível quando online" for a feature the OfflineCapabilityRegistry blocks right now; '' when it can be offered */
  function pwaNotice(featureCode, present) { if (!PW) return ''; try { return App.pwaView.unavailableNotice(PW.core.evaluate(featureCode, { connectivity: effConn(), present })); } catch (e) { return ''; } }
  async function renderPack() {
    const box = $('pwaSec'); if (!box || !PACK) return;
    try {
      const st = store.get(), usage = await PACK.storageUsage(), offline = effConn() === 'OFFLINE';
      let offer = '';
      if (!offline && !usage.packs.some(p => p.developmentId === devId)) { let est = null; try { est = await PACK.estimate(packBusy ? packBusy.profile : 'STANDARD'); } catch (e) { est = null; } offer = App.pwaView.packOffer(dev.name, est, { busy: !!packBusy }); }
      else if (offline && !usage.packs.length) offer = `<p class="pwa-note" role="note">Disponível quando online: preparar o uso offline precisa da conexão.</p>`;
      const inst = INST ? App.pwaView.installEntry(INST.getState(), INST.capabilities, INST.manualInstructions()) : '';
      let h = App.pwaView.storagePanel(usage, { offer }) + (packMsg ? `<p class="small" role="status">${esc(packMsg)}</p>` : '');
      h += `<div class="pwa-actions">${inst}${UPD ? '<button type="button" class="lbtn" data-act="pwaCheckUpdate">Verificar atualização do aplicativo</button>' : ''}</div>`;
      if (SYNC) { const pend = await SYNC.getPending().catch(() => []); h += App.pwaView.syncQueue(pend || []); }
      if (st.presentationMode === 'technical') h += `<details class="am-d"><summary>Diagnóstico do aplicativo offline</summary>${App.pwaView.diagnostics(PW.core.pwaDiagnostics({ swState: swState && swState.registered ? (swState.controlled ? 'ACTIVATED' : 'INSTALLED') : 'NONE', sw: UPD ? UPD.getState().swInfo : null, connectivity: effConn(), capabilities: PW.core.detectCapabilities(), packs: usage.packs, storageEstimate: usage.estimatedQuotaBytes ? { usage: usage.estimatedUsageBytes, quota: usage.estimatedQuotaBytes } : null }))}</details>`;
      h += await pvCenter();
      if ($('pwaSec') === box) { box.innerHTML = h; box.removeAttribute('aria-busy'); }
    } catch (e) { report(e, 'Pwa'); box.innerHTML = '<p class="small">Uso offline indisponível neste navegador.</p>'; }
  }
  // ---------- round 5 / topic 59: "Dados neste aparelho" (device-local privacy center: what this browser keeps, export, erase). No server.
  const PVf = () => App.privacy && App.privacy.device; // privacy chunk (round 6): resolved when used
  let pvLS = null, pvWiped = false; try { pvLS = window.localStorage; } catch (e) { pvLS = null; }
  async function pvNames() { try { return window.indexedDB && indexedDB.databases ? (await indexedDB.databases()).map(d => d.name).filter(Boolean) : []; } catch (e) { return []; } }
  async function pvCenter() {
    if (!PVf() || !App.privacyView) return '';
    try { const open = !!document.querySelector('#pvD[open]'); return `<details class="am-d" id="pvD"${open ? ' open' : ''}><summary>Dados neste aparelho</summary>${App.privacyView.center(PVf().centerVM({ scan: PVf().scan({ localStorage: pvLS, indexedDBNames: await pvNames() }) }))}</details>`; } catch (e) { report(e, 'Privacy'); return ''; }
  }
  async function pvErase(scope) {
    store.set(PVf().STORE_PATCH, { silent: true }); // in-memory state first, otherwise the next save writes the personal fields back
    if (favSvc) { const s0 = favSvc; if (favBridge) favBridge.unbind(); favSvc = null; favBridge = null; try { await s0.dispose({ purge: true }); } catch (e) { /* storage unavailable */ } }
    try { const org = App.analytics.context ? App.analytics.context().organizationId : null; if (org && App.analytics.client) App.analytics.client.clearLocal(org); } catch (e) { /* no buffer */ }
    if (scope === 'ALL') { pvWiped = true; await new Promise(r => setTimeout(r, 300)); } // the pending store save runs before the wipe
    let r = null; try { r = await PVf().eraseLocal({ scope, localStorage: pvLS, indexedDB: window.indexedDB || null, indexedDBNames: await pvNames(), caches: scope === 'ALL' && window.caches ? caches : null }); } catch (e) { report(e, 'Privacy'); }
    if (scope === 'ALL') return location.reload();
    closeModal(); bootFavorites({ fresh: true }); toast(r && r.ok ? 'Dados pessoais apagados deste aparelho.' : 'Parte dos dados não pôde ser apagada.'); renderOverlay(store.get());
  }
  async function packRun(kind, arg) {
    if (!PACK) return toast('Uso offline indisponível neste navegador.');
    if (kind !== 'remove' && effConn() === 'OFFLINE') return toast('Disponível quando online.');
    if (packBusy && kind !== 'remove') return toast('Já existe uma preparação em andamento.');
    const hi = !!(document.querySelector('#pwaSec [data-pwa-opt=highres]') || {}).checked, profile = kind === 'prepare' ? (hi ? 'FULL_MAP' : (arg || 'STANDARD')) : null;
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (kind !== 'remove') { packBusy = { kind, profile, ac }; packMsg = null; renderPack(); }
    let r;
    try { r = kind === 'prepare' ? await PACK.prepare(profile, { includeHighRes: hi, signal: ac && ac.signal }) : kind === 'refresh' ? await PACK.refresh(arg || PACK.packId, { signal: ac && ac.signal }) : await PACK.remove(arg || PACK.packId, 'user'); }
    catch (e) { report(e, 'Pwa'); r = { ok: false, message: 'Não foi possível concluir agora.' }; }
    packBusy = null;
    packMsg = r && r.ok ? (kind === 'remove' ? 'Dados offline removidos deste aparelho.' : kind === 'refresh' && r.unchanged ? 'Os dados offline já estão atualizados.' : 'Pronto: este empreendimento está disponível offline neste aparelho.') : ((r && r.message) || 'Não foi possível concluir agora.');
    toast(packMsg); renderPack();
  }
  /** topics 44/45: "Métricas locais" (technical mode only): this device's buffer, nothing is sent anywhere */
  let amRange = 'session';
  function metricsInner() {
    if (!App.analytics.view || !App.analytics.html) return '';
    try { return App.analytics.html(App.analytics.view({ range: amRange })); } catch (e) { report(e, 'AnalyticsDashboard'); return ''; }
  }
  function refreshMetrics(focusSel) {
    const sec = $('amSec'); if (!sec) return; sec.innerHTML = metricsInner();
    const f = focusSel && sec.querySelector(focusSel); if (f) f.focus({ preventScroll: true });
  }
  /** topic 51: "Saúde da plataforma" (technical mode only): this tab's logs, error groups, measurements and local alerts; nothing is sent */
  const obsInput = info => ({ lotCount: repo.lotsSync().length, devInfo: info, mapDiagnostics: App.MapView.diagnostics ? App.MapView.diagnostics() : null, loadingDiagnostics: techLoad && techLoad.coord ? techLoad.coord.diagnostics() : null });
  function obsInner(info) {
    const OP = App.observability && App.observability.platform; if (!OP) return '';
    try { return OP.html(OP.viewModel(obsInput(info))); } catch (e) { report(e, 'Observability'); return ''; }
  }
  async function refreshObs(focusSel) {
    const sec = $('obsSec'); if (!sec) return; const info = await devInfo(); if (!$('obsSec')) return;
    sec.innerHTML = obsInner(info); const f = focusSel && sec.querySelector(focusSel); if (f) f.focus({ preventScroll: true });
  }
  /** topic 41 entry point: guided presentation from the comparison or the favorites (hidden when the presentation mode is not allowed) */
  const pmButton = (src, n) => n && chunkHas('presentation') && (!App.authz || App.authz.uiMode('presentation').visible) ? `<button class="btn" data-act="pmStart" data-src="${src}">Apresentação guiada</button>` : '';
  /** clients overlay (topics 38–40): tab, favorites list, journey panel; the summary tab is the previous overlay content */
  function clientsExtra(st, x) {
    const cu = st.customers.find(c => c.id === st.currentCustomerId) || null, items = favItems(st), client = st.presentationMode === 'client';
    const tab = App.customerView ? custTab : 'summary';
    let favHtml = '';
    if (tab === 'favorites') {
      if (!items) favHtml = '<p class="muted">Carregando favoritos…</p>';
      else {
        const ctx0 = favBridge.context(), ctxBtns = cu ? `<div class="seg favctx" role="group" aria-label="Contexto dos favoritos"><button data-act="favCtx" data-ctx="PERSONAL" aria-pressed="${ctx0.type !== 'CUSTOMER'}">Meus favoritos</button><button data-act="favCtx" data-ctx="CUSTOMER" aria-pressed="${ctx0.type === 'CUSTOMER'}">Favoritos de ${esc(String(cu.name).trim().split(/\s+/)[0])}</button></div>` : '';
        favHtml = ctxBtns + App.favoritesView.list(items, { context: ctx0, client }) + (items.some(i => !i.orphan) ? `<div class="acts2">${pmButton('favorites', items.length)}</div>` : '');
      }
    }
    const journeyHtml = tab === 'journey' && App.customerView ? pwaNotice('JOURNEY') + App.customerView.journeyPanel({ available: journeyAvailable() && !!cu, summary: null, canCreate: false }) : '';
    return { tab, tabsHtml: App.customerView ? App.customerView.tabs(tab) : '', favHtml, journeyHtml, recommendation: tab === 'recommendations' ? sel.selectRecommendation(st) : null };
  }
  function renderShell(st) {
    ws.classList.toggle('lc', st.leftCollapsed); ws.classList.toggle('dr', st.drawerOpen); ws.classList.toggle('fm', st.fullMap);
    ws.classList.toggle('client', st.presentationMode === 'client'); ws.classList.toggle('haslot', !!st.currentLotId);
    ws.classList.toggle('pres', !!st.presentationView); ws.classList.toggle('tech', st.presentationMode === 'technical');
    document.querySelectorAll('[data-act=present]').forEach(b => b.setAttribute('aria-pressed', String(!!st.presentationView))); document.querySelector('.presexit').hidden = !st.presentationView;
    document.querySelectorAll('[data-act=bg]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.b === st.backgroundLayer)));
    $('fullBtn').setAttribute('aria-pressed', String(st.fullMap));
    layout.apply();
  }
  /** mobile bottom sheet (topic 21): snap heights come from the visible map height (dvh / visual viewport), never one fixed pixel value */
  const sheetEnv = () => { const c = $('center').getBoundingClientRect(), vv = window.visualViewport, layoutH = window.innerHeight, visH = vv ? vv.height : layoutH;
    const kb = MS.keyboardAdjust({ layoutHeight: layoutH, visualHeight: visH, sheetHeight: 0 }); return { mapH: Math.max(0, c.height + (isSmall() ? 0 : 0)), orientation: MS.orientationOf(window.innerWidth, window.innerHeight), keyboard: kb }; };
  /** env(safe-area-inset-bottom) measured once per orientation (iPhone home bar): the minimized sheet grows by it */
  let safeBottom = 0;
  const probeSafeArea = () => { try { const d = document.createElement('div'); d.style.cssText = 'position:fixed;bottom:0;left:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none'; document.body.appendChild(d); safeBottom = Math.round(d.getBoundingClientRect().height) || 0; d.remove(); } catch (e) { safeBottom = 0; } };
  probeSafeArea();
  function sheetHeights() { const e = sheetEnv(); return MS.heights(e.mapH, { orientation: e.orientation, safeAreaBottom: NAVV && NAVV.placement() === 'BOTTOM_NAV' ? 0 : safeBottom, ...(prof.family === 'TABLET' ? { config: WK.TABLET_SNAP_CONFIG } : {}) }); } // tablets: own, less aggressive snaps (topic 23 §33–36)
  function applySheetHeight(snapStore) {
    const r = $('right'); if (!isSmall()) { r.style.removeProperty('--sheet-h'); return; }
    const snap = MS.FROM_STORE[snapStore] || 'MINIMIZED', h = sheetHeights(), e = sheetEnv();
    let px = h[snap]; if (e.keyboard.keyboardOpen) px = MS.keyboardAdjust({ layoutHeight: window.innerHeight, visualHeight: window.visualViewport.height, sheetHeight: px }).sheetHeight;
    r.style.setProperty('--sheet-h', px + 'px'); r.dataset.snap = snap; ws.classList.toggle('kb', e.keyboard.keyboardOpen);
    const live = $('sheetLive'); if (live && store.get().currentLotId && live.dataset.s !== snap) { live.dataset.s = snap; const l = repo.getLotById(store.get().currentLotId); live.textContent = MS.announce(snap, l ? 'lote ' + l.identity.displayCode : 'lote'); }
  }
  /** bottom sheet height for the controls that float above it (phones and tablets) */
  function measureSheet() { const f = () => ws.style.setProperty('--sheet-h-now', (isSmall() ? Math.round($('right').getBoundingClientRect().height) : 0) + 'px'); requestAnimationFrame(f); setTimeout(f, 260); }
  /** camera policy: never leave the selected lot behind the sheet */
  function keepLotVisible(reason) {
    const st = store.get(); if (!st.currentLotId || st.view !== 'map') return;
    if (!isSmall()) { // desktop / docked tablet panel (topic 22 §79–83, topic 23 §98): smallest pan that keeps the lot out from under the floating controls
      const pol = prof.family === 'DESKTOP' ? WK.DESKTOP_CAMERA : WK.TABLET_CAMERA;
      if (!WK.shouldAdjust({ reason, lastManualPanAt: map.lastManualPan(), now: Date.now(), policy: pol })) return;
      setTimeout(() => { const id = store.get().currentLotId; if (!id) return; const b = map.lotScreenBounds(id), r = map.box.getBoundingClientRect(), mi = mapInsets(r);
        const mv = WK.panToReveal(b, { mapWidth: r.width, mapHeight: r.height, insets: WK.viewportInsets({ topControls: mi.top, rightControls: mi.right }), padding: pol.padding || pol.minPadding }); if (mv) map.panBy(mv.dx, mv.dy, pol.animationDuration); }, 240);
      return;
    }
    if (!MS.shouldAutoCenter({ reason, lastManualPanAt: map.lastManualPan(), now: Date.now() })) return;
    const go = () => { const b = map.lotScreenBounds(st.currentLotId), r = map.box.getBoundingClientRect(), sh = sheetHeights()[MS.FROM_STORE[store.get().sheet] || 'MINIMIZED'];
      const mv = MS.fitLotIntoVisibleMapArea(b, { mapWidth: r.width, mapHeight: r.height, sheetHeight: sh, insets: mapInsets(r) }); if (mv) map.panBy(mv.dx, mv.dy, MS.CAMERA.animationDuration); };
    setTimeout(go, 240);
  }
  /** floating controls measured on screen (search/Encontrar row on top, zoom column on the right), with the old fixed values as fallback */
  function mapInsets(r) {
    const of = $('openFind').getBoundingClientRect(), z = document.querySelector('.zoom'), zr = z ? z.getBoundingClientRect() : null;
    const top = of.height ? Math.max(0, Math.round(of.bottom - r.top)) : 56, right = zr && zr.width ? Math.max(0, Math.min(80, Math.round(r.right - zr.left))) : 56;
    return { top, right };
  }
  let profRaf = 0;
  /** viewport / container / orientation change: re-resolve the responsive profile (hysteresis inside), then layout only */
  const onViewportChange = () => { if (profRaf) return; profRaf = requestAnimationFrame(() => { profRaf = 0;
    const r = RS.refresh(); prof = r.profile; nav.setPushNavigational(!isSmall()); if (NAVV && r.changed) { NAVV.applyProfile(prof); renderHeader(store.get()); } if (r.changed) layout.onProfileChange(r.previous, r.profile); else layout.apply();
    fitSearchPlaceholder(); measureSheet(); applySheetHeight(store.get().currentLotId ? store.get().sheet : 'min'); if (r.changed) { renderLot(store.get()); renderMap(store.get()); keepLotVisible('rotate'); } }); };
  window.addEventListener('resize', onViewportChange);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', () => setTimeout(() => { probeSafeArea(); onViewportChange(); }, 120));
  /** "Voltar ao lote": shown when the selected lot is off screen or hidden behind the bottom sheet */
  function lotInView(id) {
    if (!map.isVisible(id)) return false; if (!isSmall()) return true;
    const b = map.lotScreenBounds(id), r = map.box.getBoundingClientRect(), sh = $('right').getBoundingClientRect().height; if (!b) return true;
    return (b.y0 + b.y1) / 2 < r.height - sh;
  }
  function backLotBtn() { const st = store.get(), b = $('backLot'); b.hidden = !st.currentLotId || st.view !== 'map' || lotInView(st.currentLotId); }
  function saveViewport() { clearTimeout(vpT); vpT = setTimeout(() => store.set({ mapViewport: map.viewport() }, { silent: true }), 300); }

  const MAP_KEYS = ['dataRevision', 'activeFilters', 'favorites', 'preferences', 'constraints', 'recScope', 'currentCustomerId', 'currentLotId', 'comparisonLotIds', 'activeMapLayer', 'scoreKey', 'mapOverlays', 'layerOpacities', 'legendFocus', 'legendExpanded', 'presentationMode', 'panel', 'connectivity', 'backgroundLayer'];
  const FIND_KEYS = ['dataRevision', 'recShowAll', 'activeFilters', 'favorites', 'preferences', 'constraints', 'recScope', 'activePreset', 'filterLevels', 'currentLotId', 'currentCustomerId', 'presentationMode', 'drawerOpen', 'comparisonLotIds', 'objective', 'connectivity', 'customers'];
  const LOT_KEYS = ['priceHistoryFrom', 'dataRevision', 'currentLotId', 'panel', 'detailSection', 'openSections', 'simulation', 'favorites', 'comparisonLotIds', 'preferences', 'constraints', 'recScope', 'activeFilters', 'presentationMode', 'presentationView', 'showRoute', 'sheet', 'objective', 'activeMapLayer', 'currentCustomerId', 'view'];
  const any = (keys, list) => list.some(k => keys.has(k));
  /** error boundary per region (topic 22 §174–177, topic 23 §246): a failing panel shows a message, the map keeps working */
  function guard(name, fn) {
    try { return fn(); } catch (e) {
      if (name === 'lot') obsInstrument('quickView', null, { error: e }); else report(e, 'Panels'); App.lifecycle.note('panel render failed', { region: name });
      const box = name === 'find' ? $('left') : name === 'lot' ? $('rp') : name === 'overlay' ? $('overlay') : name === 'cmpbar' ? $('cmpbar') : null;
      if (box) box.innerHTML = `<div class="pb regerr" role="alert"><p>Não foi possível mostrar esta parte agora. O mapa continua funcionando.</p><button class="btn sm" data-act="retryRegion">Tentar de novo</button></div>`;
    }
  }
  function render(keys, st) {
    if (keys.has('currentLotId')) layout.onLot(st, lastSelectSource);
    else if (keys.has('panel') && st.currentLotId) layout.onDetails(st);
    renderShell(st);
    if (keys.has('solar') && keys.size === 1 && st.panel === 'solar') { const lot = sel.selectCurrentLot(st); if (lot) { App.panels.drawSun(lot, st.solar, solarSvc); document.querySelectorAll('[data-act=season]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === st.solar.season))); } renderMap(st); return; }
    if (any(keys, MAP_KEYS) || keys.has('solar')) guard('map', () => renderMap(st));
    if (any(keys, FIND_KEYS)) guard('find', () => renderFind(st));
    if (any(keys, LOT_KEYS)) { const tq = performance.now(); guard('lot', () => renderLot(st)); if (keys.has('currentLotId') && st.currentLotId) obsInstrument('quickView', performance.now() - tq); measureSheet(); }
    if (any(keys, ['comparisonLotIds', 'dataRevision', 'presentationView'])) guard('cmpbar', () => renderCmpBar(st));
    if (any(keys, ['view', 'comparisonLotIds', 'customers', 'currentCustomerId', 'presentationMode', 'presentationView', 'connectivity', 'syncState', 'dataRevision'])) Promise.resolve(guard('overlay', () => renderOverlay(st))).catch(e => guard('overlay', () => { throw e; }));
    if (any(keys, ['view', 'comparisonLotIds', 'presentationMode', 'customers', 'currentCustomerId', 'activeFilters', 'drawerOpen', 'leftCollapsed', 'connectivity', 'presentationView'])) renderHeader(st);
    if (any(keys, ['connectivity', 'syncState', 'dataRevision', 'presentationMode', 'appUpdate', 'loadOrigin'])) renderNet(st);
    if (keys.has('backgroundLayer') || keys.has('baseMapBlend')) applyBackground();
    if (keys.has('sheet')) { keepLotVisible('expand'); setTimeout(backLotBtn, 280); if (prof.family === 'TABLET') layout.persist(); }
    ensureBackMarker(st);
    if (keys.has('drawerOpen') && isSmall()) sheetCoord(st);
    if (keys.has('showRoute') || keys.has('currentLotId')) drawRoute(st);
    const src = navSrc || 'USER_ACTION'; navSrc = null; syncUrl(st, src);
  }
  store.subscribe(render);
  // round 6: a chunk that arrives re-renders the regions that may use it (find panel, lot panel, header, open view); a failed chunk
  // shows the region's retry, never a loop
  if (CK) CK.onReady((name, ok) => {
    if (!ok) { const st = store.get(); if (overlayChunks(st).includes(name)) guard('overlay', () => renderOverlay(st)); return; }
    if (name === 'presentation' && App.presentationMode && App.presentationMode.runtime && App.presentationMode.runtime.bindAuth) { try { App.presentationMode.runtime.bindAuth(); } catch (e) { report(e, 'PresentationRuntime'); } }
    const st = store.get(); guard('find', () => renderFind(st)); guard('lot', () => renderLot(st)); renderHeader(st);
    if (st.view !== 'map') Promise.resolve(guard('overlay', () => renderOverlay(st))).catch(e => guard('overlay', () => { throw e; }));
  });
  if (App.authz) App.authz.subscribe(() => { renderHeader(store.get()); // topic 53: a workspace that lost its permission redirects safely
    if (NAVI && NAVI.service.onPermissionsChanged) { try { const p = NAVI.service.onPermissionsChanged(store.get(), navCtx()); if (p && p.patch) store.set(p.patch); } catch (e) { report(e, 'Navigation'); } } });
  const all = new Set(Object.keys(store.get())); render(all, store.get());
  // topic 51: release marker (build id of this page) and the map-ready measurement (geo/perf diagnostics, not re-measured)
  { const OP = App.observability && App.observability.platform, bid = (document.querySelector('meta[name="app-build-id"]') || {}).content;
    if (OP) { try { OP.setRelease({ appVersion: bid && bid !== '__APP_BUILD_ID__' ? bid : 'dev', buildId: bid || null }); } catch (e) { /* telemetry */ } }
    requestAnimationFrame(() => obsInstrument('mapReady', App.MapView.diagnostics ? App.MapView.diagnostics() : null)); }
  // topics 43–45: the link outcome is told once (partial restore / lot not found), then app_opened + deep-link events, local only
  if (boot0.res && boot0.res.message) toast(boot0.res.message);
  if (App.analytics.client) {
    const standalone = (() => { try { return matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; } })();
    App.analytics.client.track('app_opened', { entryType: boot0.dec && boot0.dec.envelope && boot0.dec.envelope.route !== 'MAP' ? 'DEEP_LINK' : standalone ? 'PWA' : 'DIRECT' });
    trackDeepLink(boot0.dec, boot0.res, 'URL_RESTORE');
  }
  bootFavorites();
  // a customer favorites context belongs to that customer: switching or leaving the customer goes back to "Meus favoritos"
  store.subscribe(keys => { if (!keys.has('currentCustomerId') || !favBridge) return; const c0 = favBridge.context();
    if (c0 && c0.type === 'CUSTOMER' && c0.ref !== store.get().currentCustomerId) queueMicrotask(() => { if (favBridge) favBridge.setContext(App.favorites.PERSONAL); }); });
  repo.subscribe(() => trust.reset()); // new data revision: provenance/confidence are rebuilt for the next opened lot

  async function drawRoute(st) {
    const lot = sel.selectCurrentLot(st);
    if (!lot || !st.showRoute) { map.setRoute(null); return; }
    try {
      const r = await spatial.getRoutes(lot); if (!r || store.get().currentLotId !== lot.identity.id) return;
      const gate = st.showRoute === 'gate', pts = gate ? r.toGate : r.toLeisure, dist = gate ? lot.mobility.routeDistanceToGateM : lot.mobility.routeDistanceToLeisureM;
      map.setRoute(pts, `${gate ? 'Portaria' : 'Clube'} · ${F.formatMeters(dist)} de carro`);
    } catch (e) { toast('Rota indisponível sem conexão.'); store.set({ showRoute: null }); }
  }

  // ---------- actions
  function selectLot(id, o = {}) {
    const l = repo.resolve(id); if (!l) return false;
    const st = store.get(), small = isSmall();
    if (o.from === 'search' || o.from === 'list' || o.from === 'keyboard') { const ae = document.activeElement;
      lotOpener = ae && ae !== document.body ? { el: ae.dataset && ae.dataset.act === 'sugg' ? $('q') : ae, sel: ae.dataset && ae.dataset.id && ae.dataset.act !== 'sugg' ? `[data-act="${ae.dataset.act}"][data-id="${CSS.escape(ae.dataset.id)}"]` : null } : null; focusLotTitle = true; }
    else if (!st.currentLotId) lotOpener = null;
    const snap = small ? MS.TO_STORE[MS.onLotSelect(st.currentLotId ? MS.FROM_STORE[st.sheet] : 'HIDDEN', { source: o.from })] : st.sheet;
    store.set({ currentLotId: l.identity.id, panel: st.currentLotId === l.identity.id ? st.panel : 'quick', showRoute: null, view: 'map', sheet: snap, drawerOpen: small && o.from !== 'map' ? false : st.drawerOpen, explain: null });
    if (o.center) map.focusLot(l.identity.id);
    keepLotVisible('select');
    App.analytics.track('lot_selected', { code: l.identity.code, from: o.from });
    if (INST) { INST.recordRelevantUse(); if (!pwaHint) { const sg = INST.shouldSuggest({ clientFacing: store.get().presentationMode === 'client', presentation: !!store.get().presentationView }); if (sg.suggest) { INST.markSuggested(); pwaHint = sg.reason; renderNet(store.get()); } } }
    lastSelectSource = { map: 'MAP_CLICK', search: 'SEARCH', list: 'RECOMMENDATION', keyboard: 'SHORTCUT', link: 'DEEP_LINK' }[o.from] || 'MAP_CLICK';
    return true;
  }
  const setFilter = (k, v) => { const f = { ...store.get().activeFilters }; if (v == null || v === '' || v === false || (Array.isArray(v) && !v.length)) delete f[k]; else f[k] = v; store.set({ activeFilters: f }); App.analytics.track('filter_changed', { k }); };
  function toggleCompare(id) {
    const ids = store.get().comparisonLotIds;
    if (ids.includes(id)) store.set({ comparisonLotIds: ids.filter(x => x !== id) });
    else if (ids.length >= App.services.comparison.MAX_LOTS) toast('A comparação aceita até 4 lotes.');
    else store.set({ comparisonLotIds: [...ids, id] });
  }
  function sheetCoord(st) {
    if (st.drawerOpen && st.currentLotId && suspendedSnap == null) { suspendedSnap = st.sheet; if (st.sheet !== 'min') store.set({ sheet: 'min' }); }
    else if (!st.drawerOpen && suspendedSnap != null) { const s0 = suspendedSnap; suspendedSnap = null; if (store.get().currentLotId) store.set({ sheet: s0 }); }
  }
  function closeLot() {
    store.set({ currentLotId: null, showRoute: null, panel: 'quick', explain: null });
    const o = lotOpener; lotOpener = null; if (!o) return;
    const n = o.el && document.contains(o.el) ? o.el : o.sel ? document.querySelector(o.sel) : $('q'); if (n) n.focus({ preventScroll: true });
  }
  /** presentation (topic 15): a clean client view on the broker's screen; the previous mode comes back on exit */
  function togglePresentation(on) {
    const st = store.get(), want = on == null ? !st.presentationView : on; if (want === !!st.presentationView) return;
    if (want) store.set({ presentationView: true, modeBeforePresentation: st.presentationMode, presentationMode: 'client', drawerOpen: false, legendFocus: null });
    else store.set({ presentationView: false, presentationMode: st.modeBeforePresentation || 'broker', modeBeforePresentation: null });
    closePop(); App.analytics.track(want ? 'presentation_started' : 'presentation_ended');
  }
  /** per-customer profile: preferences and constraints are kept on the customer record (name, lots and profile only; no contact data) */
  const custProfile = st => ({ preferences: { ...st.preferences }, constraints: { ...st.constraints }, activePreset: st.activePreset || null, objective: st.objective || null });
  function saveCustomerProfile() { const st = store.get(); if (!st.currentCustomerId) return; store.set({ customers: st.customers.map(c => c.id === st.currentCustomerId ? { ...c, profile: custProfile(st) } : c) }, { silent: true }); }
  /** star toggle: favorites domain when ready (removal can be undone), the legacy store array otherwise */
  function toggleFav(id, source) {
    if (!favSvc || !favBridge) { const f = store.get().favorites; store.set({ favorites: f.includes(id) ? f.filter(x => x !== id) : [...f, id] }); return; }
    const ctx0 = favBridge.context(), was = favSvc.isFavorite(id, ctx0), r = favSvc.toggle(id, { context: ctx0, source: source || 'QUICK_VIEW' });
    if (!r || r.ok === false) { toast('Não foi possível atualizar o favorito agora.'); return; }
    if (was) htmlToast(App.favoritesView.undoToast(id)); else { const tt = $('toast'); if (tt && tt.querySelector('.fav-toast')) tt.hidden = true; }
    if (store.get().view === 'clients') renderOverlay(store.get());
  }
  function openShare(lots) {
    const st = store.get(), x = ctx();
    if (!lots.length) return;
    shareLots = lots.map(l => l.identity.id);
    const s = App.vm.shareVM(lots, { dev, customerName: x.customerName, mode: st.presentationMode });
    $('modal').innerHTML = App.overlays.share(s, x); $('modal').hidden = false; store.set({ modal: 'share' }, { silent: true });
    { const nt = pwaNotice('SHARE_CREATE'), pb = $('modal').querySelector('.pb'); if (nt && pb) pb.insertAdjacentHTML('afterbegin', nt); } // topic 49: WhatsApp / links need the network
    App.analytics.track('share_opened', { n: lots.length });
  }
  // ---------- topic 41: guided presentation (preflight → snapshot → audience + presenter); runs in memory on this device
  function pmSources(kind) {
    const D = App.presentationMode.domain, c = pmCtx(), st = store.get();
    if (kind === 'comparison') {
      const ids = st.comparisonLotIds.slice(); if (!ids.length) return null;
      const CD = App.compare.domain, EV = App.compare.evaluation, R = ref => repo.resolve(ref);
      const ses = CD.createSession(devId, { candidateIds: ids, resolve: R }), snap = CD.buildSnapshot(ses, { resolve: R, now: c.now });
      const cmp = { sessionId: ses.id, snapshot: snap, evaluation: EV.evaluate(snap, { audience: 'presentation' }) };
      const def = D.applyTemplate(D.fromComparison(c, { session: { id: ses.id, candidateIds: cmp.evaluation.candidateIds }, developmentId: devId, title: 'Comparação de lotes' }), 'COMPARISON', c);
      return { def, src: D.sourcesFromRepo(repo, cfgDev, { comparison: cmp }) };
    }
    if (kind === 'decision') { // topic 56: the presentation takes its own snapshot from the selection (never the live ranking)
      const d = decCompute(st); if (!d || !d.r.shortlistIds.length) return null;
      const pi = App.decision.services.presentationInput(dec.shortlist || d.r.shortlistIds);
      const def = D.applyTemplate(D.fromFavorites(c, { collection: pi.collection, developmentId: devId, title: pi.title }), 'SHORTLIST', c);
      return { def, src: D.sourcesFromRepo(repo, cfgDev) };
    }
    const items = (favItems(st) || []).filter(i => !i.orphan); if (!items.length) return null;
    const def = D.applyTemplate(D.fromFavorites(c, { collection: { id: 'fav-' + (favBridge ? favBridge.context().type.toLowerCase() : 'personal'), lotIds: items.map(i => i.lotId) }, developmentId: devId, title: 'Lotes selecionados' }), 'SHORTLIST', c);
    return { def, src: D.sourcesFromRepo(repo, cfgDev) };
  }
  const pmBox = (title, body) => `<div class="box pmbox" role="dialog" aria-modal="true" aria-labelledby="pmT"><div class="ph"><h2 id="pmT">${esc(title)}</h2><button class="btn sm x" data-act="closeModal" aria-label="Fechar">${App.ui.icon('close')}</button></div><div class="pb">${body}</div></div>`;
  function pmStart(kind) {
    if (!App.presentationMode || !App.presentationView || !cfgDev) return toast('Apresentação guiada indisponível.');
    if (pm.sessionId && pm.paused) return pmResume();
    try {
      const k = kind === 'favorites' || kind === 'decision' ? kind : 'comparison', r = pmSources(k); if (!r) return toast(k === 'favorites' ? 'Nenhum favorito para apresentar.' : k === 'decision' ? 'A seleção para o cliente está vazia.' : 'Adicione lotes à comparação.');
      pm.fromDecision = k === 'decision';
      pm.def = r.def; pm.src = r.src; pm.repo = pm.repo || App.presentationMode.domain.createRepository();
      const pf = App.presentationMode.domain.preflight(pm.def, pm.src, pmCtx());
      closePop(); $('modal').innerHTML = pmBox('Preparar apresentação', `${App.presentationView.preflight(pf)}<p class="small">A apresentação usa uma cópia fixa dos dados de agora (preço de tabela, situação e análise). Nada é enviado ao cliente nem salvo em servidor.</p>
        <div class="acts2"><button class="btn pri" data-act="pmGo"${pf.status === 'FAIL' ? ' disabled' : ''}>Iniciar apresentação</button><button class="btn" data-act="closeModal">Cancelar</button></div>`);
      $('modal').hidden = false; store.set({ modal: 'pmPreflight' }, { silent: true }); const b = $('modal').querySelector('[data-act=pmGo]:not([disabled])') || $('modal').querySelector('[data-act=closeModal]'); if (b) b.focus();
      App.analytics.track('guided_presentation_preflight', { src: kind, status: pf.status });
    } catch (e) { report(e, 'PresentationRuntime'); toast('Não foi possível preparar a apresentação.'); }
  }
  function pmGo() {
    if (!pm.def || !pm.repo) return;
    try {
      const D = App.presentationMode.domain, RT = App.presentationMode.runtime, c = pmCtx();
      const sn = D.createSnapshot(pm.repo, pm.def, pm.src, c, { expectedDefinitionRevision: pm.def.recordRevision }); if (!sn.ok) return toast('A verificação bloqueou esta apresentação.');
      const ss = RT.start(pm.repo, c, sn.snapshot.id, { mode: 'GUIDED', deviceProfile: prof.family }); if (!ss.ok) return toast('Não foi possível iniciar a apresentação.');
      pm.sessionId = ss.session.id; pm.paused = false; pmRender(); App.analytics.track('guided_presentation_started');
      if (pm.fromDecision && dec.session) { const tr = App.decision.domain.transition(dec.session, 'PRESENTED', { reasonCode: 'PRESENTATION_STARTED' }); if (tr.ok) dec.session = tr.session; }
    } catch (e) { report(e, 'PresentationRuntime'); toast('Não foi possível iniciar a apresentação.'); }
  }
  function pmRender() {
    const RT = App.presentationMode.runtime, V = App.presentationView;
    const body = `<div class="pmwrap">${V.audience(RT.audienceView(pm.sessionId))}${V.presenter(RT.presenterControlState(pm.sessionId, pmCtx()))}</div>`;
    const ae = document.activeElement, keep = ae && $('modal').contains(ae) ? ae.dataset.act : null;
    $('modal').innerHTML = pmBox('Apresentação guiada', body); $('modal').hidden = false; store.set({ modal: 'pm' }, { silent: true }); pmResumeBtn();
    const f = (keep && $('modal').querySelector(`[data-act="${keep}"]:not([disabled])`)) || $('modal').querySelector('[data-act=pmNext]:not([disabled])') || $('modal').querySelector('[data-act=pmPrev]:not([disabled])'); if (f) f.focus({ preventScroll: true });
  }
  function pmResumeBtn() { const b = $('pmResume'); if (b) b.hidden = !(pm.sessionId && pm.paused); }
  function pmPause() { if (!pm.sessionId) return; pm.paused = true; pmResumeBtn(); }
  function pmResume() { if (!pm.sessionId) return; pm.paused = false; pmRender(); }
  function pmStop() { pm.sessionId = null; pm.paused = false; pm.def = null; pm.src = null; pmResumeBtn(); if (pm.startedPresentation) { pm.startedPresentation = false; togglePresentation(false); } }
  /** topics 44/45: presentation domain events → local analytics buffer (idempotent pull; nothing leaves the device) */
  const pmSync = () => { try { if (App.analytics.syncDomainEvents) App.analytics.syncDomainEvents(); } catch (e) { report(e, 'AnalyticsDashboard'); } };
  function pmAction(act, a) {
    if (!pm.sessionId) return;
    const RT = App.presentationMode.runtime, c = pmCtx(), id = pm.sessionId;
    try {
      if (act === 'pmPrev') RT.previous(id, c); else if (act === 'pmNext') RT.next(id, c); else if (act === 'pmStep' && a.dataset.step) RT.goTo(id, a.dataset.step, c);
      else if (act === 'pmLot' || act === 'pmMap') { // back to the map in the clean client view; the session waits ("Voltar à apresentação")
        if (act === 'pmLot' && a.dataset.lot) RT.jumpToLot(id, a.dataset.lot, c); else RT.returnToMap(id);
        $('modal').hidden = true; $('modal').innerHTML = ''; store.set({ modal: null }, { silent: true }); pmPause();
        if (!store.get().presentationView) { pm.startedPresentation = true; togglePresentation(true); }
        if (act === 'pmLot' && a.dataset.lot) selectLot(a.dataset.lot, { center: true, from: 'list' }); else store.set({ view: 'map' });
        return;
      }
      else if (act === 'pmFeedback') { const r = RT.recordFeedback(id, { type: a.dataset.type, lotRef: a.dataset.lot, recordedBy: 'PRESENTER' }, c); toast(r && r.ok ? 'Registrado nesta apresentação.' : 'Não foi possível registrar.'); return; }
      else if (act === 'pmComplete') { RT.markCompleted(id, c); toast('Apresentação marcada como concluída.'); }
      else if (act === 'pmEnd') { RT.end(id, c); closeModal(); pmStop(); toast('Apresentação encerrada.'); return; }
      pmRender();
    } catch (e) { if (e && e.code === 'SESSION_ENDED') { closeModal(); pmStop(); } else { report(e, 'PresentationRuntime'); toast(e && e.message ? e.message : 'Ação indisponível nesta etapa.'); } }
  }
  /** common area popup: name, area and the launch-material photos whose title matches the area (dev.poiImages) */
  async function openPoi(id) {
    const p = (dev.pois || []).find(x => x.id === id); if (!p) return;
    const cfg0 = dev.poiImages || {};
    if (!devInfoCache.images.length && (cfg0[p.type] || []).length) {
      $('modal').innerHTML = `<div class="box poibox" role="dialog" aria-modal="true" aria-label="${esc(p.name)}"><div class="ph"><h2>${esc(p.name)}</h2><button class="btn sm x" data-act="closeModal" aria-label="Fechar">${App.ui.icon('close')}</button></div><div class="pb"><p class="small muted">Carregando imagens…</p></div></div>`; $('modal').hidden = false;
      try { devInfoCache.images = await assetsRepo.getImages(); } catch (e) { /* offline */ }
      if ($('modal').hidden) return; // closed while loading
    }
    const cfg = dev.poiImages || {}, titles = cfg[p.type] || [];
    const pics = devInfoCache.images.map((im, i) => ({ im, i })).filter(({ im }) => titles.some(t => String(im.title || '').toLowerCase().startsWith(t.toLowerCase())));
    const gal = pics.length ? `<div class="gal poigal">${pics.map(({ im, i }) => `<figure><button class="galb" data-act="lightbox" data-i="${i}" aria-label="Ampliar ${esc(im.title)}"><img src="${esc(im.src)}" alt="${esc(im.title)}" ${galImgAttrs()}></button><figcaption>${esc(im.title)}</figcaption></figure>`).join('')}</div><p class="small muted">${esc(cfg.note || 'Imagens ilustrativas de divulgação.')}</p>`
      : `<p class="small">${titles.length && !devInfoCache.images.length ? 'Imagens indisponíveis no momento (sem conexão).' : 'Sem imagens desta área no material de lançamento.'}</p>`;
    $('modal').innerHTML = `<div class="box poibox" role="dialog" aria-modal="true" aria-labelledby="poiT"><div class="ph"><h2 id="poiT">${esc(p.name)}</h2><button class="btn sm x" data-act="closeModal" aria-label="Fechar">${App.ui.icon('close')}</button></div><div class="pb"><p class="small">Área comum ${esc(p.id)} · ${esc(p.areaM2 != null ? F.formatSquareMeters(p.areaM2, 2) : F.ND)} <span class="muted">(planta oficial)</span></p>${gal}</div></div>`;
    $('modal').hidden = false; store.set({ modal: 'poi' }, { silent: true }); const c = $('modal').querySelector('[data-act=closeModal]'); if (c) c.focus();
  }
  function closeModal() { const wasPm = store.get().modal === 'pm'; $('modal').hidden = true; $('modal').innerHTML = ''; store.set({ modal: null }, { silent: true }); if (wasPm) pmPause(); }
  async function refresh(scope) {
    if (!H.sync) return toast('Atualização indisponível neste modo.');
    toast('Atualizando dados comerciais…', 1500);
    const r = await H.sync.sync('manual', { scope: scope || 'dynamic' });
    const st = H.sync.info().state;
    toast(st === 'SUCCESS' ? 'Dados atualizados.' : st === 'OFFLINE' ? 'Sem conexão: mantendo os últimos dados conhecidos.' : st === 'PARTIAL' ? 'Parte dos dados não pôde ser confirmada.' : 'Não foi possível atualizar agora.');
    return r;
  }
  function clearLocalDialog() {
    $('modal').innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="clT"><div class="ph"><h2 id="clT">Limpar dados locais</h2><button class="btn sm x" data-act="closeModal" aria-label="Fechar">${App.ui.icon('close')}</button></div><div class="pb">
      <p>Apaga a cópia deste empreendimento salva no aparelho (lotes, análise, últimos preços e status, imagens). O mapa continua aberto com os dados já carregados; na próxima abertura tudo vem da internet.</p>
      <div class="acts2"><button class="btn pri" data-act="clearLocalGo" data-p="keep">Apagar dados, manter preferências</button><button class="btn" data-act="clearLocalGo" data-p="all">Apagar também filtros, favoritos e clientes</button></div></div></div>`;
    $('modal').hidden = false;
  }

  document.addEventListener('click', async e => {
    const a = e.target.closest('[data-act]'); if (!a) { if (!e.target.closest('#pop')) closePop(); if (!e.target.closest('.gs')) $('sugg').hidden = true; return; }
    const act = a.dataset.act, st = store.get(), lot = sel.selectCurrentLot(st);
    if (a.tagName === 'FORM') return;
    if (a.dataset.ak) App.analytics.track('quick_action', { k: a.dataset.ak, tier: a.dataset.tier || null });
    // authorization (topic 30): deny by default for unknown actions; this is UX only, the backend decides for real
    if (App.authz) { const g = App.authz.action(act, a.dataset, lot || { developmentId: devId }); if (!g.allowed) { if (g.visible !== false) toast(g.message); return; } }
    // round 6: an action whose code lives in a chunk waits for it (first use only; precached by the worker for offline)
    const needs = CK && ACT_CHUNKS[act];
    if (needs && needs.some(n => !CK.isLoaded(n))) { a.setAttribute('aria-busy', 'true'); try { await CK.ensureAll(needs); } catch (x) { toast('Não foi possível carregar esta parte do painel. Verifique a conexão e tente de novo.'); return; } finally { a.removeAttribute('aria-busy'); } }
    switch (act) {
      case 'view': store.set({ view: a.dataset.v, drawerOpen: false }); closePop(); break;
      case 'nav': { // topic 53: primary navigation through the NavigationService (route guard + context preservation)
        const p = NAVI.service.plan(a.dataset.ws, st, { ...navCtx(), source: a.closest('.pnav') ? 'PRIMARY_NAV' : 'CONTEXT_ACTION' });
        if (!p.ok) { toast((p.decision && p.decision.message) || 'Área indisponível.'); break; }
        if (p.patch) store.set(p.patch); closePop();
        for (const fx of p.effects) {
          if (fx === 'EXPAND_FIND_PANEL' && layout.get().leftPanel.collapsed) layout.toggleLeft();
          else if (fx === 'FOCUS_FIND') setTimeout(() => { const f = [...$('left').querySelectorAll('input,select,button')].find(x => x.offsetParent !== null && !x.disabled); if (f) f.focus({ preventScroll: true }); }, 60);
        }
        break; }
      case 'mode': if (st.presentationView) store.set({ presentationView: false, modeBeforePresentation: null }); store.set({ presentationMode: a.dataset.mode }); App.analytics.track('mode', { m: a.dataset.mode }); break;
      case 'present': togglePresentation(); break;
      case 'openFind': if (a.closest('.dcs')) { const pr = $('left').querySelector('details.prefs'); if (pr) { pr.open = true; pr.scrollIntoView({ block: 'start', behavior: 'smooth' }); const f = pr.querySelector('select,input'); if (f) f.focus({ preventScroll: true }); } break; }
        if (st.view !== 'map' && a.closest('#overlay')) { store.set({ view: 'map' }); if (prof.regions.left === 'DOCKED') { if (layout.get().leftPanel.collapsed) layout.toggleLeft(); } else store.set({ drawerOpen: true }); break; }
        if (prof.regions.left === 'DOCKED') layout.toggleLeft(); else store.set({ drawerOpen: !st.drawerOpen }); break;
      case 'toggleRight': layout.toggleRight(); break;
      case 'cmpBarToggle': layout.toggleBottomBar(); break;
      case 'custClear': saveCustomerProfile(); store.set({ currentCustomerId: null, preferences: {}, constraints: {}, activePreset: null, objective: null, recScope: null }); App.analytics.track('customer_cleared'); break;
      case 'shortcutHelp': showShortcuts(); break;
      case 'envTab': setEnv(a.dataset.v === 'environment'); break; // round 7: lot map ↔ Entorno (the chunk loads on the first open)
      case 'retryRegion': if (CK) CK.retryFailed(); render(new Set(Object.keys(store.get())), store.get()); break;
      case 'closeFind': store.set({ drawerOpen: false }); break;
      case 'clearAll': store.set({ activeFilters: {}, legendFocus: null }); App.analytics.track('filters_cleared'); break;
      case 'clearProfile': store.set({ preferences: {}, constraints: {}, activePreset: null, recScope: null }); break;
      case 'fchip': { const d = FX.BY[a.dataset.id]; if (d) { const nf = FX.without(st.activeFilters, d.id); if (Array.isArray(nf.includeUnknown)) { nf.includeUnknown = nf.includeUnknown.filter(k => k !== d.id); if (!nf.includeUnknown.length) delete nf.includeUnknown; }
        store.set({ activeFilters: nf }); App.analytics.track(a.dataset.sugg ? 'filter_suggestion_applied' : 'filter_removed', { id: d.id }); } break; }
      case 'incUnknown': { const k = a.dataset.id, cur = Array.isArray(st.activeFilters.includeUnknown) ? st.activeFilters.includeUnknown : []; setFilter('includeUnknown', cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k]); break; }
      case 'filtersToConstraints': { const c = App.panels.FL_TO_CONS(st.activeFilters); store.set({ constraints: { ...st.constraints, ...c } }); toast('Exigências do cliente atualizadas a partir dos filtros.'); App.analytics.track('filters_saved_as_constraints', { n: Object.keys(c).length }); break; }
      case 'flevel': store.set({ filterLevels: { ...st.filterLevels, [a.dataset.l]: !st.filterLevels[a.dataset.l] } }); break;
      case 'recScope': store.set({ recScope: st.recScope ? null : { lotIds: [...sel.selectFilteredLotIds(st)].sort(), filterHash: sel.selectFilterQuery(st).query.hash, appliedAt: null } }); App.analytics.track('recommendation_scope', { on: !st.recScope }); break;
      case 'recShowReview': store.set({ recShowAll: !st.recShowAll }); break;
      case 'explain': if (a.dataset.id || lot) openExplain(a, a.dataset.id || lot.identity.id); break;
      case 'techExplain': if (lot) openTechExplain(a, lot); break;
      case 'loadRetry': if (a.dataset.k === 'TECHNICAL_ANALYSIS_INPUT' && lot) { const b = techAnchor && techAnchor.isConnected ? techAnchor : document.querySelector('#rp [data-act=techExplain]'); if (b) openTechExplain(b, lot); } break;
      case 'analyticsRange': if (a.dataset.range) amRange = a.dataset.range; refreshMetrics(`[data-act=analyticsRange][data-range="${CSS.escape(amRange)}"]`); break;
      case 'analyticsRefresh': refreshMetrics('[data-act=analyticsRefresh]'); break;
      case 'obsRefresh': await refreshObs('[data-act=obsRefresh]'); break;
      case 'obsCopyDiagnostic': { const OP = App.observability && App.observability.platform; if (!OP) break; const info = await devInfo();
        const ok = await copy(OP.diagnosticText({ devInfo: info, mapDiagnostics: App.MapView.diagnostics ? App.MapView.diagnostics() : null, lotCount: repo.lotsSync().length, loadingDiagnostics: techLoad && techLoad.coord ? techLoad.coord.diagnostics() : null }));
        toast(ok ? 'Diagnóstico técnico copiado (sem dados de clientes).' : 'Não foi possível copiar.'); break; }
      case 'obsClear': { const OP = App.observability && App.observability.platform; if (OP) OP.clear(); toast('Diagnóstico desta aba apagado.'); await refreshObs('[data-act=obsRefresh]'); break; }
      case 'analyticsClear': { const org = App.analytics.context ? App.analytics.context().organizationId : null, n = org && App.analytics.client ? App.analytics.client.clearLocal(org) : 0;
        toast(n ? `Eventos deste aparelho apagados (${n}).` : 'Não há eventos para apagar neste aparelho.'); refreshMetrics('[data-act=analyticsClear]'); break; }
      case 'legendItem': { const k = a.dataset.k, cur = st.legendFocus; store.set({ legendFocus: cur && cur.itemKey === k && cur.layerId === st.activeMapLayer ? null : { layerId: (lastModel && lastModel.def.id) || st.activeMapLayer, itemKey: k } }); break; }
      case 'legendFilter': { const lm = sel.selectLegend(st), it = lm.sections[0] && lm.sections[0].items.find(i => i.key === a.dataset.k); if (it && it.filterAction) {
        const patch = { ...it.filterAction.patch }; // a status from the legend joins the statuses already chosen (union), never replaces them
        if (Array.isArray(patch.statuses) && Array.isArray(st.activeFilters.statuses)) patch.statuses = [...new Set([...st.activeFilters.statuses, ...patch.statuses])];
        store.set({ activeFilters: { ...st.activeFilters, ...patch }, legendFocus: null }); map.highlight([]); toast('Filtro aplicado. Veja o chip em Encontrar.'); App.analytics.track('legend_filter_action', { layer: lm.layerId }); } break; }
      case 'overlay': { const r = ML.toggleOverlay(ML.fromStore(st), a.dataset.id, { developmentId: devId }); if (r.ok) { store.set(ML.toStorePatch(r.state)); App.analytics.track('overlay_toggled', { id: a.dataset.id }); } break; }
      case 'layersReset': store.set({ ...ML.toStorePatch(ML.resetLayersToDevelopmentDefault(devId)), legendFocus: null }); closePop(); break;
      case 'sheetUp': store.set({ sheet: MS.TO_STORE[MS.next(MS.FROM_STORE[st.sheet] || 'MINIMIZED', 1)] }); break;
      case 'sheetDown': store.set({ sheet: MS.TO_STORE[MS.next(MS.FROM_STORE[st.sheet] || 'INTERMEDIATE', -1)] }); break;
      case 'copyId': if (lot) { const ok = await copy(lot.identity.id); toast(ok ? 'ID copiado.' : 'Não foi possível copiar.'); } break;
      case 'fmToggle': { const k = a.dataset.k, v = a.dataset.v, cur = Array.isArray(st.activeFilters[k]) ? st.activeFilters[k] : []; setFilter(k, cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]); break; }
      case 'status': { const s = a.dataset.s, cur = (st.activeFilters.statuses || []); setFilter('statuses', cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s]); break; }
      case 'preset': { const p = App.services.recommendation.PRESETS.find(x => x.id === a.dataset.id); if (!p) break; if (st.activePreset === p.id) store.set({ activePreset: null, preferences: {}, objective: null }); else store.set({ activePreset: p.id, preferences: { ...p.prefs }, objective: p.objective || st.objective }); App.analytics.track('preset', { id: p.id }); break; }
      case 'clearPrefs': store.set({ preferences: {}, activePreset: null }); break;
      case 'goLot': e.preventDefault(); selectLot(a.dataset.id, { center: true, from: 'list' }); break;
      case 'closeLot': closeLot(); break;
      case 'panel': closePop(); if (!lot) break; store.set({ panel: a.dataset.p, ...(a.dataset.sec ? { openSections: { ...st.openSections, [a.dataset.sec]: true }, detailSection: a.dataset.sec } : {}), sheet: isSmall() && st.sheet === 'min' ? 'mid' : st.sheet }); break;
      case 'primary': if (!lot) break; if (a.dataset.a === 'SIMULATE') store.set({ panel: 'simulation' }); else if (a.dataset.a === 'CONFIRM_AVAILABILITY') popover(a, App.overlays.confirmInfo(st.presentationMode)); else store.set({ panel: 'details' }); break;
      case 'fav': { const id = a.dataset.id || (lot && lot.identity.id); if (id) toggleFav(id, a.closest('.fav-panel') ? 'OTHER' : a.closest('.toast') ? 'OTHER' : 'QUICK_VIEW'); break; }
      case 'cmp': { const id = a.dataset.id || (lot && lot.identity.id); if (id) { toggleCompare(id); if (a.dataset.id && st.view === 'clients') renderOverlay(store.get()); } break; }
      case 'favCtx': if (favBridge) { const cu = st.customers.find(c => c.id === st.currentCustomerId);
        favBridge.setContext(a.dataset.ctx === 'CUSTOMER' && cu ? { type: 'CUSTOMER', ref: cu.id, label: 'Favoritos de ' + String(cu.name).trim().split(/\s+/)[0] } : App.favorites.PERSONAL); renderOverlay(store.get()); } break;
      case 'custTab': custTab = (App.customerView.TABS.find(([id]) => id === a.dataset.tab) || ['summary'])[0]; renderOverlay(store.get()); { const b = $('overlay').querySelector(`[data-act=custTab][data-tab="${custTab}"]`); if (b) b.focus(); } break;
      case 'prov-open': if (lot && a.dataset.path) popover(a, trust.provPopover(lot, a.dataset.path, st.presentationMode)); break;
      case 'conf-open': if (lot && a.dataset.path) popover(a, trust.confPopover(lot, a.dataset.path, st.presentationMode)); break;
      case 'prov-history': if (lot && a.dataset.path) popover(a, trust.historyPopover(lot, a.dataset.path)); break;
      case 'prov-resolve': toast('Resolver conflitos de origem requer o servidor da organização.'); break;
      case 'doc-preview': if (a.dataset.doc) popover(a, trust.docPopover(a.dataset.doc, st.presentationMode)); break;
      case 'doc-download': toast('O download de documentos requer o servidor de documentos.'); break;
      case 'pmStart': await pmStart(a.dataset.src); pmSync(); break;
      case 'pmGo': await pmGo(); pmSync(); break;
      case 'pmResume': await pmResume(); pmSync(); break;
      case 'pmPrev': case 'pmNext': case 'pmStep': case 'pmLot': case 'pmMap': case 'pmFeedback': case 'pmComplete': case 'pmEnd': pmAction(act, a); pmSync(); break;
      case 'cmpMove': case 'cmpProfile': { const h = App.compareView.handle(a, store.get()); if (h.patch) store.set(h.patch); if (h.rerender) renderOverlay(store.get()); break; }
      case 'cmpRemove': e.stopPropagation(); toggleCompare(a.dataset.id); break;
      // topic 56: decision panel (selection in memory; nothing is reserved, sent or proposed)
      case 'decMode': if (App.decision && App.decision.domain.WorkspaceMode[a.dataset.mode]) { dec.mode = a.dataset.mode; dec.rev++; if (dec.session) dec.session = App.decision.domain.setMode ? App.decision.domain.setMode(dec.session, dec.mode) : dec.session; decRerender(); const b = $('left').querySelector(`[data-act=decMode][data-mode="${CSS.escape(dec.mode)}"]`); if (b) b.focus({ preventScroll: true }); } break;
      case 'decShortlist': decShortlist(a); break;
      case 'decFavCust': decFavCust(a); break;
      case 'decCompareShortlist': decCompare(); break;
      case 'decPresent': await pmStart('decision'); pmSync(); break;
      case 'decRefresh': decRefresh(); break;
      case 'cmpClear': store.set({ comparisonLotIds: [], view: 'map' }); break;
      case 'share': if (lot) openShare([lot]); break;
      case 'shareCmp': openShare(sel.selectComparisonLots(st)); break;
      case 'shareCust': { const c = st.customers.find(x => x.id === st.currentCustomerId); if (c) openShare(repo.getLotsByIds(c.lots)); break; }
      case 'route': store.set({ showRoute: st.showRoute === a.dataset.r ? null : a.dataset.r }); break;
      case 'sec': { const s = a.dataset.s, open = !st.openSections[s]; store.set({ openSections: { ...st.openSections, [s]: open }, detailSection: s }); break; }
      case 'secJump': { const s = a.dataset.s; store.set({ openSections: { ...st.openSections, [s]: true }, detailSection: s }); requestAnimationFrame(() => { const n = document.getElementById('sec-' + s); if (n) n.scrollIntoView({ block: 'start', behavior: 'smooth' }); }); break; }
      case 'prov': if (lot) popover(a, App.panels.provPopover(lot, a.dataset.k, ctx())); break;
      case 'closePop': closePop(); break;
      case 'simExpand': store.set({ simulation: { ...st.simulation, expanded: true } }); break;
      case 'season': store.set({ solar: { ...st.solar, season: a.dataset.s } }); break;
      case 'hourPreset': stopPlay(); store.set({ solar: { ...st.solar, hour: +a.dataset.h } }); break;
      case 'play': togglePlay(); break;
      case 'layers': openLayers(a); break;
      case 'legendToggle': { const o = !legendOpen(st); store.set({ legendExpanded: o, legendFocus: null }); App.analytics.track(o ? 'legend_expanded' : 'legend_collapsed'); break; }
      case 'bg': store.set({ backgroundLayer: a.dataset.b }); App.analytics.track('base_map_changed', { b: a.dataset.b }); if (!$('pop').hidden && $('pop').querySelector('.layers')) openLayers(null); break;
      case 'zoomIn': map.zoomBy(1 / 1.4); break;
      case 'zoomOut': map.zoomBy(1.4); break;
      case 'fit': map.fitAll(); break;
      case 'backLot': if (st.currentLotId) { map.focusLot(st.currentLotId, false); keepLotVisible('select'); setTimeout(backLotBtn, 520); } break;
      case 'full': store.set({ fullMap: !st.fullMap }); setTimeout(() => map.zoomBy(1), 260); break;
      case 'closeModal': closeModal(); break;
      case 'copyText': { const ok = await copy($('shareText').value); toast(ok ? 'Texto copiado.' : 'Não foi possível copiar.'); break; }
      case 'copyLink': { // topic 43: internal link through the LinkStateService (allow-list profile, no customer, no price, no PII)
        const one = shareLots.length === 1, many = shareLots.length > 1;
        const r = await DL.service.createLink({ appState: { ...store.get(), view: many ? 'compare' : 'map', comparisonLotIds: many ? shareLots.slice() : [], currentLotId: one ? shareLots[0] : null, panel: 'quick' },
          codeOf, base: dev.shareUrl, profile: many ? 'COMPARISON_CONTEXT' : 'LOT_CONTEXT' });
        const ok = !!(r.ok && await copy(r.link)); toast(ok ? 'Link copiado.' : 'Não foi possível copiar.');
        if (ok && App.analytics.client) App.analytics.client.track('internal_link_copied', { routeCode: r.routeCode || 'MAP', includesFilters: false });
        break; }
      case 'refresh': refresh(a.closest('.card') ? 'all' : 'dynamic').then(() => store.get().view === 'development' && renderOverlay(store.get())); break;
      case 'clearLocal': clearLocalDialog(); break;
      case 'privacyExport': if (PVf()) { const r = PVf().exportLocal({ localStorage: pvLS, indexedDBNames: await pvNames() }), txt = JSON.stringify(r.package, null, 2);
        // inside the claude.ai viewer a plain download link does nothing: save through the downloads capability (the viewer confirms)
        const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
        if (dl) { try { await dl.save({ filename: r.filename, data: txt }); toast('Arquivo com os dados deste aparelho gerado.'); } catch (x) { toast('Download não concluído.'); } break; }
        const u = URL.createObjectURL(new Blob([txt], { type: 'application/json' })), l = document.createElement('a');
        l.href = u; l.download = r.filename; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(u), 1e3); toast('Arquivo com os dados deste aparelho gerado.'); } break;
      case 'privacyEraseLocal': if (PVf()) { $('modal').innerHTML = `<div class="box" aria-modal="true">${App.privacyView.confirmErase(a.dataset.scope)}</div>`; $('modal').hidden = false; const c = $('modal').querySelector('[data-act=closeModal]'); if (c) c.focus(); } break;
      case 'privacyEraseConfirm': if (PVf()) await pvErase(a.dataset.scope === 'ALL' ? 'ALL' : 'PERSONAL'); break;
      case 'clearLocalGo': {
        try { if (H.local) await H.local.clear(); if (H.assets) await H.assets.clear(); } catch (x2) { /* storage unavailable */ }
        if (a.dataset.p === 'all') {
          if (favSvc) { const s0 = favSvc; if (favBridge) favBridge.unbind(); favSvc = null; favBridge = null; try { await s0.dispose({ purge: true }); } catch (x3) { /* storage unavailable */ } }
          store.clearSaved(devId, { keepPrefs: false }); store.set({ activeFilters: {}, favorites: [], customers: [], currentCustomerId: null, preferences: {}, activePreset: null }); bootFavorites({ fresh: true }); }
        else store.clearSaved(devId, { keepPrefs: true });
        closeModal(); toast('Dados locais apagados.'); renderOverlay(store.get()); break;
      }
      case 'appUpdate': if (swState) { swState.userAcceptedUpdate = true; swState.accept && swState.accept(); } break;
      // topic 49: update banner (user-confirmed only), install, offline pack
      case 'pwaUpdateNow': if (UPD) { const r = await UPD.activateWaitingVersion('USER_CONFIRMED'); if (!r.ok && r.code === 'BLOCKED') toast('A atualização será aplicada ao concluir ' + r.blockers.map(b => b.label).join(', ') + '.'); renderNet(store.get()); } break;
      case 'pwaUpdateLater': if (UPD) { UPD.later(); store.set({ appUpdate: UPD.getState().state + ':later' }); renderNet(store.get()); } break;
      case 'pwaReload': if (UPD) UPD.reloadNow(); else location.reload(); break;
      case 'pwaCheckUpdate': if (UPD) { const r = await UPD.checkForUpdate('MANUAL'); store.set({ appUpdate: r.state + (r.hiddenUntilNextCheck ? ':later' : '') + ':' + Date.now() }); renderNet(store.get()); toast(r.state === 'UPDATE_AVAILABLE' ? 'Nova versão disponível.' : r.error === 'CHECK_FAILED' ? 'Não foi possível verificar agora.' : 'Você já está na versão mais recente.'); } else toast('Atualização automática indisponível neste navegador.'); break;
      case 'pwaInstall': if (INST) { const r = await INST.promptInstall(); pwaHint = null; renderNet(store.get()); if (r.outcome === 'MANUAL_INSTRUCTIONS') toast(r.instructions, 6000); else if (r.outcome === 'UNAVAILABLE') toast('Este navegador não oferece a instalação agora.'); } break;
      case 'pwaInstallDismiss': if (INST) INST.dismiss(); pwaHint = null; renderNet(store.get()); break;
      case 'pwaOpenStorage': store.set({ view: 'development' }); setTimeout(() => { const n = $('pwaSec'); if (n) n.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 400); break;
      case 'pwaPackPrepare': packRun('prepare', a.dataset.profile); break;
      case 'pwaPackRefresh': packRun('refresh', a.dataset.id); break;
      case 'pwaPackRemove': packRun('remove', a.dataset.id); break;
      case 'pwaPackCancel': if (packBusy && packBusy.ac) packBusy.ac.abort(); break;
      case 'pwaSyncRetry': if (SYNC) { try { await SYNC.syncPending(); } catch (x) { /* no transport */ } renderPack(); } break;
      case 'pwaConflictDiscard': if (SYNC && a.dataset.id) { try { await SYNC.discard(a.dataset.id); } catch (x) { /* gone */ } renderPack(); } break;
      case 'custPick': { const c = st.customers.find(x => x.id === a.dataset.id); saveCustomerProfile();
        if (App.customer && App.customer.context) { // topic 39: guard (never blocks the map) + switch patch (filters, map, lot, comparison and favorites untouched)
          const CC = App.customer.context, g = CC.guard(st, a.dataset.id, {});
          store.set(c ? CC.switchPatch(st, a.dataset.id, { profileUi: CC.legacyProfileUi(c) }) : { currentCustomerId: a.dataset.id });
          if (g.warnings.includes('COMPARISON_BELONGS_TO_PREVIOUS_CUSTOMER')) toast('A comparação aberta continua com os lotes do atendimento anterior.');
        } else store.set({ currentCustomerId: a.dataset.id, ...(c ? { preferences: { ...((c.profile || {}).preferences || {}) }, constraints: { ...((c.profile || {}).constraints || {}) }, activePreset: (c.profile || {}).activePreset || null, objective: (c.profile || {}).objective || null, recScope: null } : {}) });
        break; }
      case 'custDel': store.set({ customers: st.customers.filter(c => c.id !== a.dataset.id), currentCustomerId: null }); break;
      case 'custAddLot': if (st.currentLotId && st.currentCustomerId) { store.set({ customers: st.customers.map(c => c.id === st.currentCustomerId ? { ...c, lots: [...new Set([...c.lots, st.currentLotId])] } : c) }); toast('Lote guardado para o cliente.'); } break;
      case 'custRemoveLot': e.stopPropagation(); store.set({ customers: st.customers.map(c => c.id === st.currentCustomerId ? { ...c, lots: c.lots.filter(x => x !== a.dataset.id) } : c) }); break;
      case 'custCompare': { const c = st.customers.find(x => x.id === st.currentCustomerId); if (c) store.set({ comparisonLotIds: c.lots.slice(0, 4), view: 'compare' }); break; }
      case 'lightbox': { const im = devInfoCache.images[+a.dataset.i]; if (im) { $('modal').innerHTML = App.overlays.lightbox({ ...im, url: im.src }); $('modal').hidden = false; } break; }
      case 'sugg': { $('sugg').hidden = true; $('q').value = ''; const k = a.dataset.k;
        if (k === 'block') { setFilter('block', a.dataset.id); map.flash(repo.lotsSync().filter(l => l.identity.blockId === a.dataset.id).map(l => l.identity.id)); }
        else if (selectLot(a.dataset.id, { center: true, from: 'search' })) map.flash([repo.resolve(a.dataset.id).identity.id]);
        App.analytics.track('search_result_opened', { k }); break; }
      case 'reload': location.reload(); break;
    }
  });
  document.addEventListener('change', e => {
    const n = e.target, st = store.get();
    if (n.dataset.f) { const k = n.dataset.f; let v = n.type === 'checkbox' ? n.checked : n.value; if (['priceMin', 'priceMax', 'areaMin', 'areaMax', 'pricePerM2Min', 'pricePerM2Max', 'frontMin', 'frontMax', 'depthMin', 'depthMax'].includes(k)) v = v === '' || !Number.isFinite(+v) ? null : +v;
      else if (['fitCoverageMin', 'fitConfidenceMin'].includes(k)) v = v === '' ? null : +v; else if (k === 'q') v = String(v).trim().slice(0, 40) || null; setFilter(k, v); }
    else if (n.dataset.pref) { const p = { ...st.preferences, [n.dataset.pref]: +n.value }; if (!p[n.dataset.pref]) delete p[n.dataset.pref]; store.set({ preferences: p, activePreset: null }); }
    else if (n.dataset.cons) { const k = n.dataset.cons; let v = n.type === 'checkbox' ? n.checked : n.value === '' ? null : +n.value; const c = { ...st.constraints }; if (v == null || v === false || Number.isNaN(v)) delete c[k]; else c[k] = v; store.set({ constraints: c }); App.analytics.track('constraint_changed', { k }); }
    else if (n.dataset.fm) { const vals = [...document.querySelectorAll(`[data-fm="${n.dataset.fm}"]:checked`)].map(x => x.value); setFilter(n.dataset.fm, vals); }
    else if (n.name === 'layer') { const r = ML.setPrimaryLayer(ML.fromStore(st), n.value, { developmentId: devId, mode: st.presentationMode, fit: sel.selectFit(st), lots: sel.selectLots(st), features: dev.features }); if (r.ok) { store.set({ ...ML.toStorePatch(r.state), legendFocus: null }); App.analytics.track('map_layer_changed', { id: n.value }); } else toast(r.reason); openLayers(null); }
    else if (n.dataset.in === 'scoreKey') { store.set({ scoreKey: n.value }); if (!$('pop').hidden && $('pop').querySelector('.layers')) openLayers(null); }
    else if (n.dataset.in === 'opacity') { const r = ML.setLayerOpacity(ML.fromStore(st), st.activeMapLayer, +n.value / 100, { developmentId: devId }); if (r.ok) { store.set({ layerOpacities: r.state.layerOpacities }); App.analytics.track('layer_opacity_changed', { id: st.activeMapLayer }); } }
    else if (n.dataset.in === 'blend') { const r = ML.setBaseMapBlend(ML.fromStore(st), +n.value / 100); if (r.ok) store.set({ baseMapBlend: r.state.baseMapBlend }); }
    else if (n.dataset.in === 'plan') store.set({ simulation: { ...st.simulation, planId: n.value } });
    else if (n.dataset.in === 'dp' || n.dataset.in === 'dpn') store.set({ simulation: { ...st.simulation, downPaymentPct: Math.max(0, Math.min(100, Math.round(+n.value || 0))) } });
    else if (n.matches && n.matches('[data-pv-period]')) { const lot = sel.selectCurrentLot(st), vm = lot && priceHist && priceHist.viewModel(lot, { mode: st.presentationMode }); const o = vm && (vm.periodOptions || []).find(p => p.id === n.value); store.set({ priceHistoryFrom: o ? o.from || null : null }); }
    else if (n.dataset.in === 'solarMap') store.set({ solar: { ...st.solar, onMap: n.checked } });
    else if (n.id === 'devSel' && n.value !== devId) { location.hash = n.value; location.reload(); }
  });
  store.subscribe(keys => { if (keys.has('preferences') || keys.has('constraints') || keys.has('activePreset') || keys.has('objective')) saveCustomerProfile(); });
  // topic 56: simulating a lot of the selection counts as progress for the suggested next step (never automatic beyond the text)
  store.subscribe(keys => { const st = store.get(); if (keys.has('panel') && st.panel === 'simulation' && dec.memo && !dec.progress.simulated && dec.memo.r.shortlistIds.includes(st.currentLotId)) { dec.progress = { ...dec.progress, simulated: true }; dec.rev++; } });
  document.addEventListener('input', e => {
    const n = e.target, st = store.get();
    if (n.dataset.in === 'hour') { stopPlay(); store.set({ solar: { ...st.solar, hour: +n.value } }); }
    else if (n.dataset.in === 'dp') { // live preview without rebuilding the slider
      const pct = +n.value, lot = sel.selectCurrentLot(st); store.set({ simulation: { ...st.simulation, downPaymentPct: pct } }, { silent: true });
      const s = lot && App.vm.simulationVM(lot, { ...ctx(), simulation: { ...st.simulation, downPaymentPct: pct } }); if (!s || !s.available) return;
      const num = document.querySelector('[data-in=dpn]'); if (num) num.value = pct;
      const k = document.querySelector('#rp .kpi3'); if (k) k.innerHTML = `<div><span>Preço</span><b>${esc(s.price)}</b></div><div><span>Entrada</span><b>${esc(s.downPayment)}</b></div><div><span>Saldo</span><b>${esc(s.financed)}</b></div>`;
      document.querySelectorAll('#rp .plan').forEach((pl, i) => { const p = s.plans[i]; if (p) pl.querySelector('.pv').innerHTML = `${esc(p.main)}${p.annual ? `<br><small>${esc(p.annual)}</small>` : ''}<br><small>Total ${esc(p.total)}</small>`; });
    }
    else if (n.dataset.in === 'shareName') { const lots = repo.getLotsByIds(shareLots), s = App.vm.shareVM(lots, { dev, customerName: n.value.trim(), mode: st.presentationMode }); $('shareText').value = s.text; const w = document.querySelector('#modal a.btn.pri'); if (w) w.href = s.whatsapp; }
    else if (n.id === 'q') suggest(n.value);
  });
  document.addEventListener('submit', e => {
    const f = e.target; if (f.dataset.act !== 'custAdd') return; e.preventDefault();
    const name = (new FormData(f).get('name') || '').toString().trim().slice(0, 60); if (!name) return;
    const c = { id: 'c' + Date.now().toString(36), name, lots: store.get().currentLotId ? [store.get().currentLotId] : [], profile: custProfile(store.get()) };
    store.set({ customers: [...store.get().customers, c], currentCustomerId: c.id });
  });
  // search with suggestions
  function suggest(q) {
    const box = $('sugg'), r = repo.searchLots(q);
    if (!q.trim() || r.kind === 'none') { box.hidden = true; return; }
    const items = r.kind === 'block' ? [{ k: 'block', id: r.block, label: `Quadra ${r.block}`, sub: `${r.lots.length} lotes` }] : [];
    for (const l of (r.lots || []).slice(0, 8 - items.length)) items.push({ k: 'lot', id: l.identity.id, label: F.formatLotTitle(l.identity.blockId, l.identity.lotNumber), sub: `${F.formatSquareMeters(l.geometry.areaM2, 0)} · ${t('AvailabilityStatus', l.availability.status)}` });
    box.innerHTML = items.length ? items.map((it, i) => `<button data-act="sugg" data-k="${it.k}" data-id="${esc(it.id)}" role="option" aria-selected="${i === 0}"><span>${esc(it.label)}</span><small>${esc(it.sub)}</small></button>`).join('') : `<div class="empty">Nenhum lote encontrado.</div>`;
    box.hidden = false;
  }
  $('q').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const b = $('sugg').querySelector('[aria-selected=true]') || $('sugg').querySelector('button'); if (b) b.click(); else toast('Lote não encontrado.'); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const bs = [...$('sugg').querySelectorAll('button')]; if (!bs.length) return; e.preventDefault(); let i = bs.findIndex(b => b.getAttribute('aria-selected') === 'true'); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, j) => b.setAttribute('aria-selected', String(i === j))); }
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('span[role=button][data-act]')) { e.preventDefault(); e.target.click(); return; }
    if (e.key !== 'Escape') return;
    const st = store.get();
    if (st.legendFocus) store.set({ legendFocus: null }); else if (!$('pop').hidden) closePop(); else if (st.presentationView && $('modal').hidden) togglePresentation(false); else if (!$('modal').hidden) closeModal(); else if (!$('sugg').hidden) $('sugg').hidden = true;
    else if (st.view !== 'map') store.set({ view: 'map' }); else if (envOn) { setEnv(false); const b = document.querySelector('.edge [data-act=envTab][data-v=environment]'); if (b) b.focus({ preventScroll: true }); } else if (st.drawerOpen) store.set({ drawerOpen: false }); else if (st.panel !== 'quick') { store.set({ panel: 'quick' }); const t0 = lotOpener && lotOpener.el; if (t0 && document.contains(t0)) t0.focus({ preventScroll: true }); } else if (st.currentLotId && isSmall()) closeLot(); // desktop: Esc closes transient UI only, never the selection (topic 22 §229)
  });
  // keyboard shortcuts (topic 22 §101–107; tablets with a keyboard get the essential subset, topic 23 §164)
  document.addEventListener('keydown', e => {
    const id = SC.match(e, { family: prof.family }); if (!id || id === 'closeTransient') return;
    const st = store.get(), lot = sel.selectCurrentLot(st);
    if (!$('modal').hidden && id !== 'help') return; // a dialog is open: shortcuts wait
    e.preventDefault(); App.analytics.track('desktop_shortcut_used', { id });
    switch (id) {
      case 'focusSearch': case 'commandSearch': $('q').focus(); $('q').select(); break;
      case 'openFilters': if (prof.regions.left === 'DOCKED') { if (layout.get().leftPanel.collapsed) layout.toggleLeft(); const f = $('left').querySelector('input,select,button'); if (f) f.focus(); } else store.set({ drawerOpen: !st.drawerOpen }); break;
      case 'openLayers': { const b = $('legend').querySelector('[data-act=layers]'); if (b) { openLayers(b); const f = $('pop').querySelector('input,button'); if (f) f.focus(); } break; }
      case 'compareCurrent': if (lot) { toggleCompare(lot.identity.id); toast(store.get().comparisonLotIds.includes(lot.identity.id) ? `${lot.identity.displayCode} na comparação.` : `${lot.identity.displayCode} fora da comparação.`); } else toast('Selecione um lote primeiro.'); break;
      case 'openDetails': if (lot) { focusLotTitle = true; store.set({ panel: 'details' }); } else toast('Selecione um lote primeiro.'); break;
      case 'toggleLeft': if (prof.regions.left === 'DOCKED') layout.toggleLeft(); break;
      case 'toggleRight': if (prof.regions.right === 'DOCKED') layout.toggleRight(); break;
      case 'mapFocus': store.set({ fullMap: !st.fullMap }); break;
      case 'help': showShortcuts(); break;
    }
  });
  function showShortcuts() {
    const rows = SC.list(prof.family).map(s => `<tr><th scope="row"><kbd>${esc(SC.keyLabel(s))}</kbd></th><td>${esc(s.label)}</td></tr>`).join('');
    $('modal').innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="scT"><div class="ph"><h2 id="scT">Atalhos de teclado</h2><button class="btn sm x" data-act="closeModal" aria-label="Fechar">${App.ui.icon('close')}</button></div><div class="pb"><table class="xt sct">${rows}</table><p class="small muted">Os atalhos não funcionam enquanto você digita em um campo. Esc fecha menus e painéis temporários sem tirar a seleção do lote.</p></div></div>`;
    $('modal').hidden = false; store.set({ modal: 'shortcuts' }, { silent: true }); const c = $('modal').querySelector('[data-act=closeModal]'); if (c) c.focus();
  }
  // panel resizers (topic 22 §39–47, §114–115): pointer drag updates one CSS variable per frame; the width is saved on release.
  // Keyboard: ←/→ 16 px (Shift: 48), Home/End min/max, Enter collapses. role=separator with aria-valuenow/min/max.
  for (const [id, which] of [['rszL', 'left'], ['rszR', 'right']]) {
    const r = $(id); if (!r) continue; let x0 = null, w0 = 0, w = 0, raf2 = 0;
    const dir = which === 'left' ? 1 : -1, cur = () => parseFloat(ws.style.getPropertyValue(which === 'left' ? '--lw' : '--rw')) || 0;
    r.addEventListener('pointerdown', e => { x0 = e.clientX; w0 = w = cur(); r.setPointerCapture(e.pointerId); layout.resizeStart(); e.preventDefault(); });
    r.addEventListener('pointermove', e => { if (x0 == null) return; const want = w0 + dir * (e.clientX - x0); if (raf2) return; raf2 = requestAnimationFrame(() => { raf2 = 0; w = layout.resizeLive(which, want); r.setAttribute('aria-valuenow', String(w)); }); });
    const end = () => { if (x0 == null) return; x0 = null; if (raf2) { cancelAnimationFrame(raf2); raf2 = 0; } layout.resizeEnd(which, w); };
    r.addEventListener('pointerup', end); r.addEventListener('pointercancel', end); r.addEventListener('lostpointercapture', end);
    r.addEventListener('keydown', e => {
      const step = e.shiftKey ? 48 : 16, lim = { min: +r.getAttribute('aria-valuemin'), max: +r.getAttribute('aria-valuemax') }, now = cur();
      let to = null;
      if (e.key === 'ArrowLeft') to = now - dir * step; else if (e.key === 'ArrowRight') to = now + dir * step; else if (e.key === 'Home') to = lim.min; else if (e.key === 'End') to = lim.max;
      else if (e.key === 'Enter') { e.preventDefault(); if (which === 'left') layout.toggleLeft(); else layout.toggleRight(); return; }
      if (to == null) return; e.preventDefault(); layout.resizeStart(); w = layout.resizeLive(which, to); layout.resizeEnd(which, w); r.focus();
    });
  }
  window.addEventListener('hashchange', () => {
    if (Date.now() - poppedAt < 400) return; // the back button already handled this step (popstate)
    // in-tab hash changes are mostly Back/Forward over our own entries: route_viewed (BROWSER_HISTORY) records them, not deep_link_*
    const rh = restoreHash(location.hash), p = rh.patch; if (!p) return; // invalid / other development: the screen stays (the selector reloads for a switch)
    if (rh.res.message) toast(rh.res.message);
    const before = store.get().currentLotId, lotChanged = p.currentLotId && p.currentLotId !== before;
    const sheet = lotChanged && isSmall() ? { sheet: MS.TO_STORE[MS.onLotSelect(before ? MS.FROM_STORE[store.get().sheet] : 'HIDDEN', { source: 'link' })] || 'mid' } : {};
    lastSelectSource = 'DEEP_LINK'; store.set({ ...p, ...sheet });
    syncUrl(store.get(), 'BROWSER_HISTORY'); // Back/Forward or a typed hash: the browser already made the entry; the coordinator only records it
    if (p.currentLotId) { map.focusLot(p.currentLotId, false); if (lotChanged) keepLotVisible('select'); }
  });
  /** browser / Android back on small screens (topic 21): one history entry while something is open; back closes the top layer
      (modal → popover → drawer → overlay view → details → expanded sheet → lot), never leaves the app by surprise */
  function ensureBackMarker(st) {
    if (!isSmall() || backMarker || !(st.currentLotId || st.drawerOpen || st.view !== 'map' || st.presentationView)) return;
    try { history.pushState({ vjBack: 1 }, '', location.href); backMarker = true; } catch (e) { /* sandboxed frame */ }
  }
  window.addEventListener('popstate', () => {
    if (!backMarker) return; backMarker = false; poppedAt = Date.now();
    const st = store.get();
    if (!$('modal').hidden) closeModal();
    else if (!$('pop').hidden) closePop();
    else if (st.drawerOpen) store.set({ drawerOpen: false });
    else if (st.view !== 'map') store.set({ view: 'map' });
    else if (st.presentationView) togglePresentation(false);
    else if (st.currentLotId) {
      const r = MS.onBack({ detailsOpen: st.panel !== 'quick', snap: MS.FROM_STORE[st.sheet] || 'MINIMIZED' });
      if (r.handled) store.set(r.closeDetails ? { panel: 'quick' } : { sheet: MS.TO_STORE[r.snap] || 'mid' }); else closeLot();
    }
    const s2 = store.get(); syncUrl(s2, 'URL_RESTORE'); ensureBackMarker(s2); // the entry under the marker is older: replace it with the current state
  });
  // legend hover / keyboard focus: highlight the lots of that item on the map (same render model; never filters)
  const legendHi = e => { const b = e.target.closest && e.target.closest('[data-act=legendItem]'); if (!b || !lastModel) return; map.highlight(ML.lotsForItem(lastModel, b.dataset.k, store.get().presentationMode)); };
  const legendLo = e => { const b = e.target.closest && e.target.closest('[data-act=legendItem]'); if (b) map.highlight([]); };
  $('legend').addEventListener('mouseover', legendHi); $('legend').addEventListener('focusin', legendHi);
  $('legend').addEventListener('mouseout', legendLo); $('legend').addEventListener('focusout', legendLo);
  // tooltip (desktop hover)
  function hover(id, e) {
    const tip = $('tip'), st = store.get();
    if (!prof.capabilities.hover) { tip.hidden = true; return; } // touch: no hover dependency; a tap opens the Quick View
    if (!id || st.hoverLotId === id && !tip.hidden) { if (!id) tip.hidden = true; if (id) moveTip(e); return; }
    const l = repo.getLotById(id); if (!l) { tip.hidden = true; return; }
    const lines = lastModel ? ML.tooltip(l, lastModel, st.presentationMode) : App.vm.tooltipVM(l, {});
    const r = sel.selectRanking(st), ri = r && r.byId.get(id); if (ri && ri.fitScore != null) lines.push(`${Math.round(ri.fitScore)}% compatível${ri.review ? ' (a confirmar)' : ''}`);
    tip.innerHTML = lines.map((x, i) => i ? esc(x) : `<b>${esc(x)}</b>`).join('<br>');
    tip.hidden = false; store.set({ hoverLotId: id }, { silent: true }); moveTip(e);
  }
  function moveTip(e) { const tip = $('tip'), r = map.box.getBoundingClientRect(); tip.style.left = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.min(e.clientY - r.top + 14, r.height - tip.offsetHeight - 8) + 'px'; }
  // solar animation: draws directly, commits the hour at the end
  function togglePlay() {
    if (playRaf) return stopPlay();
    const st = store.get(), d = solarSvc.day(st.solar.season); let hh = st.solar.hour; if (hh >= d.sunset - 0.1 || hh < d.sunrise) hh = Math.ceil(d.sunrise * 4) / 4;
    const b = document.getElementById('sunPlay'); if (b) b.textContent = '❚❚';
    let last = performance.now();
    const step = tt => { const dt = (tt - last) / 1000; last = tt; hh += dt * 1.6; if (hh >= d.sunset) { hh = d.sunset; store.set({ solar: { ...store.get().solar, hour: Math.round(hh * 4) / 4 } }); return stopPlay(); }
      store.set({ solar: { ...store.get().solar, hour: hh } }); playRaf = requestAnimationFrame(step); };
    playRaf = requestAnimationFrame(step);
  }
  function stopPlay() { if (playRaf) cancelAnimationFrame(playRaf); playRaf = 0; const b = document.getElementById('sunPlay'); if (b) b.textContent = '▶'; }
  // bottom sheet drag (phones and tablets): live height while dragging (no store writes per frame), snap on release by position + velocity.
  // The velocity is smoothed over the last ~100 ms of movement, so a short flick and a slow release are told apart reliably.
  (() => {
    const hdl = $('handle'), right = $('right'), rp = $('rp'); let y0 = null, h0 = 0, samples = [], moved = 0;
    const velocity = () => { const n = samples.length; if (n < 2) return 0; const lastS = samples[n - 1]; let i = n - 1; while (i > 0 && lastS.t - samples[i - 1].t <= 100) i--; const f = samples[i]; const dt = lastS.t - f.t; return dt > 0 ? (f.y - lastS.y) / dt : 0; };
    const begin = y => { y0 = y; h0 = right.getBoundingClientRect().height; samples = [{ y, t: performance.now() }]; moved = 0; right.classList.add('dragging'); };
    const move = y => { if (y0 == null) return; samples.push({ y, t: performance.now() }); if (samples.length > 12) samples.shift(); moved = Math.max(moved, Math.abs(y0 - y));
      const hs = sheetHeights(); right.style.setProperty('--sheet-h', Math.max(hs.MINIMIZED * 0.8, Math.min(hs.EXPANDED, h0 + (y0 - y))) + 'px'); };
    const finish = (y, tapToggles) => {
      if (y0 == null) return; right.classList.remove('dragging');
      const dy = y0 - y; y0 = null;
      if (moved < 8) { if (tapToggles) store.set({ sheet: { min: 'mid', mid: 'full', full: 'min' }[store.get().sheet] || 'mid' }); else applySheetHeight(store.get().sheet); return; }
      const target = MS.resolveSnapTarget(h0 + dy, velocity(), sheetHeights());
      const snap = MS.TO_STORE[target] || 'min';
      if (snap === store.get().sheet) applySheetHeight(snap); else store.set({ sheet: snap });
      App.analytics.track('sheet_snap', { s: target });
    };
    const cancel = () => { if (y0 != null) { y0 = null; right.classList.remove('dragging'); applySheetHeight(store.get().sheet); } };
    hdl.addEventListener('pointerdown', e => { begin(e.clientY); hdl.setPointerCapture(e.pointerId); });
    hdl.addEventListener('pointermove', e => move(e.clientY));
    hdl.addEventListener('pointerup', e => finish(e.clientY, true)); hdl.addEventListener('pointercancel', cancel);
    hdl.addEventListener('keydown', e => { if (e.key === 'ArrowUp') { e.preventDefault(); store.set({ sheet: MS.TO_STORE[MS.next(MS.FROM_STORE[store.get().sheet], 1)] }); } else if (e.key === 'ArrowDown') { e.preventDefault(); store.set({ sheet: MS.TO_STORE[MS.next(MS.FROM_STORE[store.get().sheet], -1)] }); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const cur = MS.FROM_STORE[store.get().sheet]; store.set({ sheet: MS.TO_STORE[cur === 'EXPANDED' ? 'INTERMEDIATE' : MS.next(cur, 1)] }); } }); // Enter/Space: open one step, or back from expanded
    // content drag with scroll hand-off (topic 21): pulling down at the top of the content, or pushing up before the sheet is
    // expanded, moves the sheet; otherwise the content scrolls. Form controls, sliders and charts never start a sheet drag.
    let tStart = null;
    rp.addEventListener('touchstart', e => {
      tStart = null; if (!isSmall() || !store.get().currentLotId || e.touches.length !== 1) return;
      if (e.target.closest('input,select,textarea,[data-nodrag],.chart,canvas,.tblwrap')) return;
      const sc = rp.querySelector('.pb'); tStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, top: sc ? sc.scrollTop : 0, engaged: false };
    }, { passive: true });
    rp.addEventListener('touchmove', e => {
      if (!tStart) return; const tt = e.touches[0], dx = tt.clientX - tStart.x, dy = tt.clientY - tStart.y;
      if (!tStart.engaged) {
        if (Math.abs(dy) < 8 || Math.abs(dx) > Math.abs(dy)) { if (Math.abs(dx) > 12) tStart = null; return; }
        const snap = store.get().sheet, down = dy > 0;
        if ((down && tStart.top <= 0 && snap !== 'min') || (!down && snap !== 'full')) { tStart.engaged = true; begin(tStart.y); } else { tStart = null; return; }
      }
      e.preventDefault(); move(tt.clientY);
    }, { passive: false });
    rp.addEventListener('touchend', e => { if (tStart && tStart.engaged) finish(e.changedTouches[0].clientY, false); tStart = null; });
    rp.addEventListener('touchcancel', () => { if (tStart && tStart.engaged) cancel(); tStart = null; });
  })();
  // ---------- layers popover, explanations
  function openLayers(anchor) {
    const st = store.get(), menu = ML.menu({ developmentId: devId, mode: st.presentationMode, fit: sel.selectFit(st), lots: sel.selectLots(st), features: dev.features });
    const h = `<div class="poph"><b>Visualizar o mapa</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${App.ui.icon('close')}</button></div>` + App.panels.layerMenu(st, menu);
    if (anchor) popover(anchor, h); else { const p = $('pop'); if (!p.hidden) { const sc = p.scrollTop; p.innerHTML = h; p.scrollTop = sc; } }
  }
  function openExplain(anchor, lotId) {
    const st = store.get(), rec = sel.selectRecommendation(st); if (!rec) return;
    const e = App.explanation.explainLot(rec, lotId), items = [...rec.recommendations, ...rec.reviewCandidates], i = items.findIndex(x => x.lotId === lotId);
    const above = i > 0 ? App.explanation.comparePair(rec, items[i - 1].lotId, lotId) : null;
    popover(anchor, App.panels.explainPopover(e, above, { mode: st.presentationMode, repo, fitCfg: sel.fitCfg, aboveLot: i > 0 ? repo.getLotById(items[i - 1].lotId) : null }));
  }
  /** topic 35 (technical mode): which analysis produced the scores — published version (read model) and the input fingerprint. Read-only. */
  function analysisVersionInfo(doc) {
    if (!App.versioning) return null;
    try {
      const V = App.versioning, defs = V.definitions(devId), def = defs && defs.definitions && defs.definitions[0];
      const fp = V.fingerprint({ dev: cfgDev, methodologyConfig: App.methodology.current(devId), inputDoc: doc, dataVersions: repo.getDataVersions(), availabilityRevision: (repo.getDataVersions() || {}).availabilityRevision || 0 });
      const rm = def ? V.readModel(V.repository({ organizationId: cfgDev ? cfgDev.tenantId : ORG }, { policies: defs.policies }), def.id, { mode: 'technical' }) : { available: false };
      return { fingerprint: String(fp.combined || '').slice(0, 16), methodologyVersion: fp.methodology && fp.methodology.methodologyVersion, inputVersion: doc.inputVersion || null, published: rm.available ? rm.label : null, analysisVersion: (repo.getDataVersions() || {}).analysisVersion || null };
    } catch (e) { report(e, 'Versioning'); return null; }
  }
  /** topics 47/48: analysis-input.json goes through the LoadCoordinator (dedup, priority, bounded retry, never throws) and the
      CacheManager (memory L1, keyed by tenant + development + the manifest checksum; never persisted here — decision of topic 49) */
  const techLoad = (() => {
    const LR = App.loading && App.loading.resources, LC = App.loading && App.loading.coordinator, CM = App.cache && App.cache.manager, CC = App.cache && App.cache.core;
    if (!LR || !LC || !CM || !CC) return null;
    try {
      const reg = LR.ResourceRegistry({ organizationId: ORG, developmentId: devId, dev });
      const json = async ({ url, signal }) => { const res = await fetch(url, { signal }); if (!res.ok) { const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; } return res.json(); };
      const coord = LC.LoadCoordinator({ organizationId: ORG, developmentId: devId, loaders: { json }, cache: CM.CacheManager({}) });
      const version = () => { const m = remoteManifest(); const a = m && (m.assets || []).find(x => x.path === 'analysis-input.json'); return (a && a.checksum) || (m && m.analysisVersion) || 'bundled'; };
      const desc = () => reg.descriptor('TECHNICAL_ANALYSIS_INPUT', { version: version() });
      const cacheKey = d => CC.makeCacheKey(d.key, { organizationId: ORG, principalScope: 'PUBLIC' }, '1');
      const request = (origin = 'USER_REQUEST') => { const d = desc(); return coord.request(d, { origin, cacheKey: cacheKey(d), scopeId: origin === 'PREFETCH' ? 'prefetch:technical' : 'popover:technical' }); };
      // prefetch by intent on the "Como o score foi calculado" button (hover dwell, focus, touchstart); Save-Data/slow links skip it
      const intents = App.loading.planner.PrefetchIntentService({ onPrefetch: () => { request('PREFETCH'); }, env: () => App.loading.planner.connectionEnv() });
      return { request, intent: kind => { if (!techAnalysis) intents.signal(kind, desc()); }, coord };
    } catch (e) { report(e, 'Loading'); return null; }
  })();
  for (const [ev, kind] of [['pointerover', 'hover'], ['pointerout', 'hoverEnd'], ['focusin', 'focus'], ['touchstart', 'touchstart']])
    document.addEventListener(ev, e => { if (techLoad && e.target.closest && e.target.closest('[data-act=techExplain]')) techLoad.intent(kind); }, { passive: true });
  let techAnchor = null;
  const techHead = () => `<div class="poph"><b>Como o score foi calculado</b><button class="btn sm" data-act="closePop" aria-label="Fechar">${App.ui.icon('close')}</button></div>`;
  /** technical score explanation: lazily loads the measured inputs and re-runs the published methodology (identical scores) */
  async function openTechExplain(anchor, lot) {
    const st = store.get(), token = techGuard.begin(lot.identity.id); techAnchor = anchor;
    popover(anchor, techHead() + (App.loadingView ? App.loadingView.skeleton('technical') : '<p class="small">Carregando as medições…</p>'));
    const failHtml = r => techHead() + (App.loadingView && r ? App.loadingView.resourceStatus(r, { what: 'as medições', userRequested: true, retryAct: 'loadRetry', retryKey: 'TECHNICAL_ANALYSIS_INPUT' })
      : '<p class="small">Não foi possível carregar as medições agora. O score publicado continua valendo.</p>');
    try {
      if (!techAnalysis) {
        let doc;
        if (techLoad) { const r = await techLoad.request(); if (r.state !== 'READY' && r.state !== 'PARTIAL') { if (r.state !== 'CANCELLED' && r.state !== 'DISCARDED_STALE' && techGuard.isCurrent(token, store.get().currentLotId)) popover(anchor, failHtml(r)); return; } doc = r.data; }
        else { const res = await fetch('analysis-input.json'); if (!res.ok) throw new Error('HTTP ' + res.status); doc = await res.json(); }
        const meth = App.methodology.compiled(App.methodology.current(devId));
        if (!techAnalysis) { techAnalysis = App.intelligence.analyzeDevelopment(doc.lots, { methodology: meth, inputVersion: doc.inputVersion, generatedAt: null }); techVersioning = analysisVersionInfo(doc); }
      }
      if (!techGuard.isCurrent(token, store.get().currentLotId)) { obsInstrument('quickView', null, { staleDiscarded: true }); return; } // the user moved to another lot meanwhile
      const r = techAnalysis.results.find(x => x.lotId === lot.identity.id);
      const ex = App.explanation.explainTechnical(r, st.scoreKey || 'housing', techAnalysis.reference);
      popover(anchor, App.panels.techExplainPopover(ex, r, lot, { scoreKey: st.scoreKey || 'housing', versioning: st.presentationMode === 'technical' ? techVersioning : null }));
    } catch (err) { report(err, 'QuickView'); if (techGuard.isCurrent(token, store.get().currentLotId)) popover(anchor, failHtml(null)); }
  }

  // ---------- live data: repository changes, connectivity, sync
  repo.subscribe(() => store.set({ dataRevision: store.get().dataRevision + 1 }));
  H.connectivity.subscribe(s => store.set({ connectivity: s }));
  if (H.sync) {
    H.sync.subscribe(info => { store.set({ syncState: info.state }); if (info.state === 'SUCCESS' || info.state === 'ERROR' || info.state === 'PARTIAL') SYNC && SYNC.pendingInfo().then(p => obsInstrument('syncResult', { pending: p.count, failed: info.state === 'ERROR', conflict: false })).catch(() => {}); if (info.state === 'SUCCESS' && H.assets) H.assets.setManifest(remoteManifest() || (H.local && null)); });
    await H.sync.restore(); H.sync.start();
    H.sync.sync('boot').then(async () => {
      try { const m = H.local && await H.local.getManifest(); if (m && m.remote && H.assets) { H.assets.setManifest(m.remote); if (!bgUrls.plan || bgUrls.plan === dev.assets.plan) { bgUrls.plan = await H.assets.get(dev.assets.plan); if (store.get().backgroundLayer !== 'aerial') map.setBackground(store.get().backgroundLayer, bgUrls); } } } catch (e) { /* cache unavailable */ }
    });
  }
  // Service Worker: app shell + HTTP assets only (no business rule), progressive enhancement.
  // Topic 49: PwaUpdateCoordinator — a new version WAITS; only the user's "Atualizar agora" activates it (blockers: guided presentation
  // step, pending changes with another queue schema); one controlled reload; mixed versions → "Atualização requer reinício".
  if (CONN) CONN.subscribe(s => { renderNet(store.get()); obsInstrument('connectivity', s.effectiveState); });
  if (dev.offline && dev.offline.serviceWorker) {
    const swc = typeof navigator !== 'undefined' && navigator.serviceWorker ? navigator.serviceWorker : null;
    if (PW && PW.update) {
      try {
        UPD = PW.update.PwaUpdateCoordinator({ container: swc, activity: () => (pm.sessionId && !pm.paused ? ['PRESENTATION_STEP_ACTIVE'] : []), pendingMutations: () => (SYNC ? SYNC.pendingInfo() : { count: 0, schemaVersion: null }),
          saveState: () => store.save(), onChange: st2 => { if (st2.state === 'UPDATE_AVAILABLE') obsInstrument('sw', 'UPDATE_AVAILABLE'); store.set({ appUpdate: st2.state + (st2.hiddenUntilNextCheck ? ':later' : '') }); } });
        UPD.register('sw.js').then(us => { const reg = UPD.registration;
          swState = { supported: !!us.supported, registered: !!reg, controlled: !!(swc && swc.controller), scope: reg ? reg.scope : undefined, error: us.error || null, state: us.state, compatibility: us.compatibility };
          App.lifecycle.note('service worker', { registered: swState.registered, controlled: swState.controlled, state: us.state, compatibility: us.compatibility });
          if (reg) UPD.checkForUpdate('APP_START'); renderNet(store.get()); });
        UPD.attachTriggers();
      } catch (e) { report(e, 'Pwa'); UPD = null; }
    }
    if (!UPD) App.offline.registerServiceWorker({ url: 'sw.js', onUpdate: accept => { swState = swState || {}; swState.accept = accept; store.set({ appUpdate: true }); } }).then(s => { swState = Object.assign(swState || {}, s); App.lifecycle.note('service worker', s); });
  }
  window.addEventListener('beforeunload', () => { if (!pvWiped) store.save(); }); // not after "Apagar tudo deste aparelho"
  // topic 50: a page restored from the back/forward cache after a logout must not show protected content without revalidating
  let authRevalAt = Date.now();
  window.addEventListener('pageshow', ev => {
    const SH = App.securityHardening; if (!SH || !App.authz) return;
    try { const c = App.authz.context(), authed = !!(c && c.session && c.session.status === 'ACTIVE');
      if (SH.onPageShow({ persisted: !!(ev && ev.persisted), authenticated: authed, lastRevalidatedAt: authRevalAt }) !== 'REVALIDATE') return;
      authRevalAt = Date.now(); Promise.resolve(App.authz.refresh({ organizationId: ORG })).then(() => renderHeader(store.get()), e => report(e, 'Security')); } catch (e) { report(e, 'Security'); }
  });
  App.debugInfo = () => ({ responsive: prof, freshness: repo.getFreshnessState(), versions: repo.getDataVersions(), sync: H.sync && H.sync.info(), connectivity: H.connectivity.get(), origin: H.source.origin, backend: H.backend && H.backend.kind, sw: swState, log: App.lifecycle.log.slice(-20) });
};
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', () => App.main()) : App.main();
