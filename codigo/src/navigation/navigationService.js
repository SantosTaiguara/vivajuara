/* navigation/navigationService.js — topic 53: NavigationState, NavigationService, route guard, context preservation,
   development/tenant switch plans, the navigation view model and the G-sequence shortcut matcher.
   Rules:
   - the route (store.view + the topic-43 envelope) is the only source of the current workspace; there is no separate
     activeMenu / selectedView / screenName. The workspace is DERIVED (FIND = map with the Encontrar panel open as an
     overlay; on docked profiles the panel is part of the map workspace and is flagged "open", not "current");
   - the service never mutates anything: plan() returns { patch, effects } for the shell to apply with store.set — the
     URL then follows through the existing NavigationCoordinator (no second URL serializer, §313–314);
   - a plan only touches view/drawerOpen: selection, comparison, filters, layer, camera and customer are preserved (§39–43);
   - denied target → safe redirect to MAP (or the first allowed workspace); MAP itself denied → no redirect (no loop);
   - no business logic here (§187); no PII: customerId is the opaque internal id, never a name. */
App.navigation = App.navigation || {};
App.navigation.state = (() => {
  const freeze = Object.freeze, R = () => App.navigation.registry;
  const VIEW_TO_WS = freeze({ map: 'MAP', compare: 'COMPARE', clients: 'CUSTOMERS', development: 'DEVELOPMENT' });
  const leftDocked = profile => !!(profile && profile.regions && profile.regions.left === 'DOCKED');
  /** is the Encontrar panel open? overlay profiles: the drawer; docked profiles: the docked panel not collapsed */
  const findOpen = (st, profile) => leftDocked(profile) ? !st.leftCollapsed : !!st.drawerOpen;
  /** workspaceOf(state, profile) — derived, never stored. Contextual overlays (lot details, comparison tray, sheet) keep MAP. */
  function workspaceOf(st = {}, profile) {
    const ws = VIEW_TO_WS[st.view] || 'MAP';
    if (ws === 'MAP' && !leftDocked(profile) && st.drawerOpen) return 'FIND';
    return ws;
  }
  /** derive(state, profile, { source }) → NavigationState (§191). Only ids; customerId is opaque (never a name). */
  function derive(st = {}, profile, o = {}) {
    const workspace = workspaceOf(st, profile);
    return freeze({ workspace, routeCode: R().item(workspace) ? R().item(workspace).routeCode : workspace, developmentId: st.developmentId || undefined,
      customerId: st.currentCustomerId || undefined, lotId: st.currentLotId || undefined, sectionId: workspace === 'MAP' && st.currentLotId ? (st.panel || 'quick') : undefined, source: o.source || undefined });
  }
  /** urlRouteOf(state) — the route code the topic-43 envelope carries for this state (LOT / COMPARE / MAP …), for logs */
  function urlRouteOf(st = {}) { if (st.view === 'compare' && (st.comparisonLotIds || []).length) return 'COMPARE'; if (st.currentLotId) return 'LOT'; return 'MAP'; }
  return freeze({ VIEW_TO_WS, workspaceOf, derive, findOpen, leftDocked, urlRouteOf });
})();

App.navigation.service = (() => {
  const freeze = Object.freeze, R = () => App.navigation.registry, S = () => App.navigation.state;
  const ACTIONS = freeze({ NAVIGATE_TO_MAP: 'MAP', NAVIGATE_TO_FIND: 'FIND', NAVIGATE_TO_COMPARE: 'COMPARE', NAVIGATE_TO_CUSTOMER: 'CUSTOMERS', NAVIGATE_TO_DEVELOPMENT: 'DEVELOPMENT' });
  const SOURCES = freeze(['PRIMARY_NAV', 'CONTEXT_ACTION', 'DEEP_LINK', 'BROWSER_HISTORY', 'SYSTEM_REDIRECT', 'SHORTCUT']);
  const EFFECT = freeze({ EXPAND_FIND_PANEL: 'EXPAND_FIND_PANEL', FOCUS_FIND: 'FOCUS_FIND', FOCUS_WORKSPACE: 'FOCUS_WORKSPACE', FOCUS_MAP: 'FOCUS_MAP', FOCUS_LOT: 'FOCUS_LOT', PICK_CUSTOMER: 'PICK_CUSTOMER', HISTORY_BACK: 'HISTORY_BACK' });
  /** state keys a navigation plan may write; everything else is preserved by construction */
  const NAV_KEYS = freeze(['view', 'drawerOpen']);
  let seq = 0;
  const nowIso = n => new Date(n == null ? Date.now() : n).toISOString();
  const toWs = target => R().WORKSPACES.includes(target) ? target : ACTIONS[target] || null;

  /** routeAccess(workspace, ctx) → RouteAccessDecision { allowed, reasonCode?, redirectRouteCode?, message? } */
  function routeAccess(ws, ctx = {}) {
    const it = R().item(ws);
    if (!it) return freeze({ allowed: false, reasonCode: 'UNKNOWN_ROUTE', redirectRouteCode: 'MAP' });
    const r = R().resolveItem(it, ctx);
    if (r.state === 'VISIBLE_ENABLED') return freeze({ allowed: true });
    const redirect = ws === 'MAP' ? null : (R().visiblePrimaryItems(ctx).find(i => i.state === 'VISIBLE_ENABLED' && i.id === 'MAP') || R().visiblePrimaryItems(ctx).find(i => i.state === 'VISIBLE_ENABLED' && i.id !== ws) || {}).id || null;
    return freeze({ allowed: false, reasonCode: r.disabledReason ? r.disabledReason.code : 'DENIED', redirectRouteCode: redirect || undefined, message: (r.disabledReason && r.disabledReason.message) || R().t('nav.denied') });
  }
  /** transition record (UI/observability context, not a business entity §346–347) */
  function transition(from, to, source, status, now) { seq += 1; return freeze({ id: 'nt_' + seq, from: from || undefined, to, source: SOURCES.includes(source) ? source : 'PRIMARY_NAV', requestedAt: nowIso(now), resolvedAt: status === 'REQUESTED' ? undefined : nowIso(now), status }); }
  /** logFields(transition) — observability fields only: routeCode / fromRouteCode / transitionType (never a URL, id or name) */
  const logFields = tr => freeze({ routeCode: tr.to, fromRouteCode: tr.from || null, transitionType: tr.source, status: tr.status });

  /** patchFor(workspace, state, profile) → { patch, effects } — only NAV_KEYS */
  function patchFor(ws, st, profile) {
    const docked = S().leftDocked(profile);
    switch (ws) {
      case 'MAP': return { patch: { view: 'map', drawerOpen: false }, effects: [EFFECT.FOCUS_MAP] };
      case 'FIND': return docked ? { patch: { view: 'map', drawerOpen: false }, effects: [EFFECT.EXPAND_FIND_PANEL, EFFECT.FOCUS_FIND] } : { patch: { view: 'map', drawerOpen: true }, effects: [EFFECT.FOCUS_FIND] };
      default: return { patch: { view: R().item(ws).view, drawerOpen: false }, effects: [EFFECT.FOCUS_WORKSPACE] };
    }
  }
  /** plan(target, state, { profile, authz, resource, permissions, entitlements, connectivity, packAvailable, source, now })
      → { ok, workspace, from, noop, decision, patch, effects, transition } — goToWorkspace (§185). */
  function plan(target, st = {}, o = {}) {
    const from = S().workspaceOf(st, o.profile), source = o.source || 'PRIMARY_NAV', ctx = { ...o, mode: o.mode || R().experienceMode(st) };
    let ws = toWs(target);
    if (!ws) return freeze({ ok: false, workspace: null, from, noop: true, decision: freeze({ allowed: false, reasonCode: 'UNKNOWN_ROUTE' }), patch: null, effects: [], transition: transition(from, String(target), source, 'FAILED', o.now) });
    let decision = routeAccess(ws, ctx), redirected = false;
    if (!decision.allowed) {
      // explicit user action on a denied item: stay and explain; system/deep-link/history: safe redirect (never a loop)
      if (source === 'PRIMARY_NAV' || source === 'CONTEXT_ACTION' || source === 'SHORTCUT' || !decision.redirectRouteCode || decision.redirectRouteCode === ws)
        return freeze({ ok: false, workspace: ws, from, noop: true, decision, patch: null, effects: [], transition: transition(from, ws, source, 'DENIED', o.now) });
      ws = decision.redirectRouteCode; redirected = true;
      const d2 = routeAccess(ws, ctx); if (!d2.allowed) return freeze({ ok: false, workspace: ws, from, noop: true, decision: d2, patch: null, effects: [], transition: transition(from, ws, 'SYSTEM_REDIRECT', 'DENIED', o.now) });
    }
    const { patch, effects } = patchFor(ws, st, o.profile);
    const changed = Object.keys(patch).filter(k => (st[k] ?? null) !== (patch[k] ?? null));
    const noop = !changed.length && !(ws === 'FIND' && S().leftDocked(o.profile) && st.leftCollapsed);
    return freeze({ ok: true, workspace: ws, from, noop, redirected, decision, patch: changed.length ? freeze(Object.fromEntries(changed.map(k => [k, patch[k]]))) : null,
      effects: freeze(effects.slice()), transition: transition(from, ws, redirected ? 'SYSTEM_REDIRECT' : source, 'RESOLVED', o.now) });
  }
  /** goToLot(lotId, state, opts) — keeps the MAP workspace (selecting a lot never opens a full page §290) */
  function goToLot(lotId, st = {}, o = {}) {
    const p = plan('MAP', st, { ...o, source: o.source || 'CONTEXT_ACTION' }); if (!p.ok || !lotId) return p;
    return freeze({ ...p, noop: false, patch: freeze({ ...(p.patch || {}), currentLotId: lotId, panel: o.panel || 'quick' }), effects: freeze([EFFECT.FOCUS_LOT]) });
  }
  /** goToCustomer(customerId, state, opts) — opaque id only; the shell applies the topic-39 switch patch (PICK_CUSTOMER) */
  function goToCustomer(customerId, st = {}, o = {}) {
    const p = plan('CUSTOMERS', st, { ...o, source: o.source || 'CONTEXT_ACTION' }); if (!p.ok) return p;
    return freeze({ ...p, noop: false, effects: freeze([...(customerId ? [EFFECT.PICK_CUSTOMER] : []), ...p.effects]), customerId: customerId || null });
  }
  const goBack = () => freeze({ ok: true, effects: freeze([EFFECT.HISTORY_BACK]) });

  /** onPermissionsChanged(state, ctx) — recompute; when the current workspace became unauthorized, a safe redirect plan */
  function onPermissionsChanged(st = {}, o = {}) {
    const cur = S().workspaceOf(st, o.profile), d = routeAccess(cur, { ...o, mode: R().experienceMode(st) });
    if (d.allowed) return null;
    return plan(cur, st, { ...o, source: 'SYSTEM_REDIRECT' });
  }
  /** preservationPolicy(kind) — NavigationContextPreservationPolicy ('default' | 'developmentSwitch' | 'tenantSwitch') */
  const preservationPolicy = (kind = 'default') => freeze({ ...((R().manifest().preservation || {})[kind] || R().manifest().preservation.default) });
  /** switchPatch(kind, state) — development switch (§68) / tenant switch: clears incompatible entity state, keeps safe global prefs, lands on MAP */
  function switchPatch(kind, st = {}, o = {}) {
    const pol = preservationPolicy(kind), p = { view: 'map', drawerOpen: false, panel: 'quick', modal: null, legendFocus: null, hoverLotId: null };
    if (!pol.preserveSelectedLot) Object.assign(p, { currentLotId: null });
    if (!pol.preserveComparison) Object.assign(p, { comparisonLotIds: [] });
    if (!pol.preserveFilters) Object.assign(p, { activeFilters: {}, recScope: null });
    if (!pol.preserveMapLayer) Object.assign(p, { activeMapLayer: null, previousMapLayer: null });
    if (!pol.preserveMapCamera) Object.assign(p, { mapViewport: null });
    if (!pol.preserveCustomer) Object.assign(p, { currentCustomerId: null, customers: [], favorites: [], preferences: {}, constraints: {}, activePreset: null, objective: null });
    if (!pol.preserveDevelopment && o.developmentId) p.developmentId = o.developmentId;
    for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
    return freeze(p);
  }
  /** developmentSwitchPlan(state, toDevelopmentId, { accessible(id) }) → { ok, patch, reason } */
  function developmentSwitchPlan(st, toDev, o = {}) {
    if (!toDev || (o.accessible && !o.accessible(toDev))) return freeze({ ok: false, reason: 'DEVELOPMENT_NOT_ACCESSIBLE', patch: null, landing: 'MAP' });
    if (toDev === st.developmentId) return freeze({ ok: true, reason: 'SAME_DEVELOPMENT', patch: null, landing: S().workspaceOf(st, o.profile) });
    return freeze({ ok: true, reason: null, patch: switchPatch('developmentSwitch', st, { developmentId: toDev }), landing: 'MAP' });
  }
  const tenantSwitchPlan = (st, o = {}) => freeze({ ok: true, patch: switchPatch('tenantSwitch', st, o), landing: 'MAP' });
  /** lastRouteRestore(savedState, ctx, { developmentAccessible }) → workspace to open on launch (PWA §138–140) */
  function lastRouteRestore(saved, o = {}) {
    if (!saved || (o.developmentAccessible && !o.developmentAccessible(saved.developmentId))) return 'MAP';
    const ws = S().workspaceOf(saved, o.profile);
    return routeAccess(ws, { ...o, mode: R().experienceMode(saved) }).allowed ? ws : 'MAP';
  }
  /** UnsavedChangesGuard (§301) — the shell asks before leaving only when there are real unsaved changes */
  const needsConfirm = guard => !!(guard && guard.hasUnsavedChanges && !guard.canAutoSave);

  /** viewModel(state, { profile, authz, resource, permissions, entitlements, connectivity, packAvailable, shared })
      → NavigationViewModel for menuView.update(): items with current/open/badge/state, placement, header layout */
  const accountOf = o => { try { const az = o.authz || App.authz; return az && az.account ? az.account.viewModel() : freeze({ visible: false }); } catch (_) { return freeze({ visible: false }); } };
  function viewModel(st = {}, o = {}) {
    const mode = R().experienceMode(st, o), ctx = { ...o, mode }, nav = S().derive(st, o.profile), pl = R().placement(o.profile);
    const fo = S().findOpen(st, o.profile), n = (st.comparisonLotIds || []).length;
    const items = R().getPrimaryItems(ctx).map(i => {
      const badge = i.badgeProviderId === 'comparisonCandidates' && n > 0 ? freeze({ count: n, label: R().t('nav.compare.badge', { n }), status: n === 1 ? 'DRAFT' : n <= 4 ? 'READY' : 'BLOCKED' }) : null;
      return freeze({ ...i, current: i.id === nav.workspace, open: i.id === 'FIND' && nav.workspace !== 'FIND' && nav.workspace === 'MAP' && fo, badge });
    });
    return freeze({ version: R().manifest().version, mode, workspace: nav.workspace, state: nav, placement: pl, items: freeze(items), visible: items.some(i => i.state !== 'HIDDEN'),
      header: R().headerLayout(o.profile, { hasCustomer: !!st.currentCustomerId }), hasCustomer: !!st.currentCustomerId, connectivity: o.connectivity || st.connectivity || 'UNKNOWN',
      // W3 login: account control ("Entrar com Google" / first name + "Sair"); { visible: false } without a configured backend
      account: accountOf(o) });
  }
  return freeze({ ACTIONS, SOURCES, EFFECT, NAV_KEYS, routeAccess, plan, goToWorkspace: plan, goToLot, goToCustomer, goBack, onPermissionsChanged, preservationPolicy, switchPatch,
    developmentSwitchPlan, tenantSwitchPlan, lastRouteRestore, needsConfirm, viewModel, logFields });
})();

/** G-sequence shortcuts (§119–122): "g" then a key, within timeoutMs, never while typing or with a modifier.
    handle(event) → { state: 'ARMED' | 'MATCH' | null, target?, shortcut? }. The caller preventDefault()s the second key so
    the single-key registry of topic 22 (m, c, …) does not also fire (it ignores defaultPrevented events). */
App.navigation.shortcuts = (() => {
  const freeze = Object.freeze, R = () => App.navigation.registry;
  const typing = t => App.shortcuts && App.shortcuts.isTyping ? App.shortcuts.isTyping(t) : !!t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '');
  function createSequenceMatcher(o = {}) {
    const timeoutMs = o.timeoutMs ?? 1200, now = o.now || (() => Date.now());
    let armedAt = null;
    function handle(e) {
      if (!e || e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) { armedAt = null; return { state: null }; }
      const k = String(e.key || '').toLowerCase(), t = now();
      if (armedAt != null && t - armedAt <= timeoutMs) {
        armedAt = null;
        const s = R().shortcuts().find(x => [x.keys, x.altKeys].filter(Boolean).some(ks => ks.length === 2 && ks[0] === 'g' && ks[1] === k));
        return s ? freeze({ state: 'MATCH', target: s.target, shortcut: s.id }) : { state: null };
      }
      if (k === 'g' && !e.shiftKey) { armedAt = t; return { state: 'ARMED' }; }
      armedAt = null; return { state: null };
    }
    return freeze({ handle, reset: () => { armedAt = null; } });
  }
  const list = () => R().shortcuts().map(s => freeze({ id: s.id, keys: s.keys.join(' então '), altKeys: s.altKeys ? s.altKeys.join(' então ') : null, label: R().t(s.descriptionKey), target: s.target }));
  return freeze({ createSequenceMatcher, list });
})();
