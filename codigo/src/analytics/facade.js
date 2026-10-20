/* analytics/facade.js — installs App.analytics on top of the topic-45 client, backwards compatible.

   App.analytics.track(evt, data) keeps working for every existing call site (app.js, comparisonDomain.js, offline.js),
   bound or unbound: the legacy name goes through the LegacyTrackingInventory (rename / payload transform), then the
   same validation, privacy, consent and dedupe as canonical producers. App.analytics.log still lists recent events
   ({ evt, data, t }), now validated and scrubbed. New code should call App.analytics.client.track(canonicalName,
   typedPayload, ctx). The default context provider reads only authoritative sources (authz tenant/principal, store,
   responsive profile) — never window.location.href, never tokens. Nothing is ever sent: every remote destination is
   off by policy (decisions D2/D3). Single owner of App.analytics (GAP-ARCH-10); replays what analytics/early.js buffered. */
App.analytics = (() => {
  const prev = App.analytics, ET = App.eventTracking;
  const appCtx = { appVersion: 'web', buildId: null, platform: 'WEB', featureFlags: null };
  const safe = f => { try { return f(); } catch (e) { return null; } };
  /** AnalyticsContextProvider: organization, user, development, route, device, app — the payload cannot override any of it */
  function context() {
    const az = safe(() => App.authz && App.authz.context()), st = safe(() => App.store && App.store.get()) || {};
    const devId = st.developmentId || null;
    const org = (az && az.tenant && az.tenant.organizationId) || safe(() => App.tenancy.organizationOfDevelopment(devId)) || null;
    const principal = az && az.principal, userId = principal && principal.type === 'USER' ? principal.id : null;
    const rp = safe(() => App.responsive && App.responsive.get && App.responsive.get());
    const fam = rp && rp.family, im = rp && rp.inputMode;
    const routeCode = st.presentationView ? 'PRESENTATION' : st.currentLotId ? 'LOT' : st.view ? String(st.view).toUpperCase() : 'MAP';
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    return { organizationId: org, userId, developmentId: devId, customerId: st.currentCustomerId || null, routeCode,
      deviceClass: fam === 'DESKTOP' || fam === 'TABLET' || fam === 'MOBILE' ? fam : 'UNKNOWN', viewportClass: rp && rp.layoutProfile, inputMode: im === 'HYBRID' ? 'MIXED' : im === 'TOUCH' || im === 'POINTER' ? im : undefined,
      locale: nav && nav.language, timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone), ...appCtx,
      platform: safe(() => typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ? 'PWA' : appCtx.platform };
  }
  const client = ET.createClient({ context });
  const bridge = ET.createBridge(client);
  // calls buffered by analytics/early.js before this module loaded go through the legacy path once (GAP-ARCH-10: single owner)
  const early = prev && (Array.isArray(prev.early) ? prev.early : Array.isArray(prev.log) ? prev.log : null);
  if (early) for (const x of early.splice ? early.splice(0) : early) client.track(x.evt, x.data, { legacy: true, occurredAt: x.t });
  /** legacy entry point — unbound-safe (comparisonDomain passes it around as a bare function) */
  const track = (evt, data) => client.track(evt, data, { legacy: true });
  let presentationSynced = false;
  /** syncDomainEvents() — idempotent pull of the presentation runtime's domain events into the bridge (safe to call often) */
  function syncDomainEvents() {
    const pm = App.presentationMode && App.presentationMode.domain; if (!pm || typeof pm.events !== 'function') return [];
    presentationSynced = true; return bridge.ingest(pm.events());
  }
  /** attachFavorites(service) — FavoriteAdded/FavoriteRemoved → favorite_added/favorite_removed (via the bridge) */
  const attachFavorites = service => bridge.attach(service);
  const api = {
    track, client, bridge, context,
    registry: () => ET.registry.current(), privacy: ET.privacy, semantic: App.semanticLayer,
    flush: () => client.flush(), setConsent: s => client.setConsent(s), setIdentity: i => client.setIdentity(i),
    setAppContext: o => { Object.assign(appCtx, o || {}); }, syncDomainEvents, attachFavorites, presentationSynced: () => presentationSynced,
    /** view(o) → "Métricas locais" view model (technical mode); html(vm) → markup */
    view: o => App.metricsView.viewModel({ ...(o || {}) }), html: vm => App.metricsView.html(vm)
  };
  Object.defineProperty(api, 'log', { enumerable: true, get: () => client.recent().map(r => ({ evt: r.legacyName || r.evt, data: r.data, t: r.t })) });
  return api;
})();
