/* deeplink/linkRestoration.js — topic 43: LinkRestorationService (ordered, tolerant, partial restore, explicit typed patch) ·
   LinkRestorationTransaction (race protection: a late answer for link A never overwrites link B) ·
   LinkStateReferenceService (authenticated stateRef: in-memory reference of the backend contract; never public) ·
   NavigationHistoryPolicy + NavigationCoordinator (push for navigation, debounced replace for viewport, nothing for
   transient UI, no push while restoring from Back/Forward) · LinkStateExtractor (allow-list profiles over ApplicationState) ·
   LinkStateService (internal copy-link; EXTERNAL_SHARE is delegated to the ShareService of topic 42).

   A link never grants access: every branch that needs authorization (customer, journey, presentation) asks the injected
   authorizer, and the backend stays authoritative. The patch is built key by key (no deep merge of untrusted input),
   in the dependency order of §43, and never contains price, availability or any lot data (LIVE resolves current data). */
App.deeplink = App.deeplink || {};
App.deeplink.restoration = (() => {
  const freeze = Object.freeze, C = () => App.deeplink.codec;
  const w = (code, extra = {}) => freeze({ code, ...extra });
  const ORDER = freeze(['organization', 'development', 'route', 'customer', 'journey', 'filters', 'map', 'comparison', 'lot', 'viewport', 'presentation', 'ui']);

  // ---------------------------------------------------------------- transactions (race protection)
  function createTransactions(o = {}) {
    let active = null, seq = 0;
    const now = () => (o.now ? o.now() : new Date()).toISOString();
    return freeze({
      begin(envelope) { if (active && active.status === 'RUNNING') active.status = 'CANCELLED'; active = { id: 'lrt_' + (++seq), startedAt: now(), envelope, status: 'RUNNING' }; return active; },
      isActive: t => !!t && active === t && t.status === 'RUNNING',
      finish(t, status) { if (t && t.status === 'RUNNING') t.status = status; return t; },
      cancel() { if (active && active.status === 'RUNNING') active.status = 'CANCELLED'; },
      current: () => active
    });
  }

  /** restore(envelope, deps) → LinkRestoreResult (sync; the stateRef payload, if any, is passed as deps.refPayload).
      deps = { currentDevelopmentId, developmentExists(id), resolveLot(ref) → lot|null, layerRegistry (App.mapLayers.registry(dev)),
               mapDefaults, filters (App.filters), mapBounds {width,height}, detailSections [ids], context,
               authorize(permissionKey, resource) → boolean (customer/journey/presentation), presentation: { getSnapshot(id) → { stepIds, startStepId } | null },
               refPayload, refStatus } */
  function restore(env, deps = {}) {
    const warnings = [], skipped = [], restored = [], patch = {}, hints = {};
    const skip = (branch, code, extra) => { skipped.push(freeze({ branch, reason: code })); warnings.push(w(code, extra)); };
    const ok = b => restored.push(b);
    const fail = (code, errorState) => freeze({ status: 'FAILED', restoredBranches: freeze(restored), skippedBranches: freeze(skipped), warnings: freeze([...warnings, w(code)]), finalRoute: 'MAP', finalAppStatePatch: freeze({}), hints: freeze({}), errorState, message: C().MESSAGES[errorState] || C().MESSAGES.LINK_INVALID });
    if (!env || !env.state || !env.state.development) return fail('LINK_INVALID', 'LINK_INVALID');
    const context = env.context || deps.context || 'INTERNAL', internal = context === 'INTERNAL' || context === 'BOOKMARK';
    // 1. organization / tenant: the stateRef was already checked by the reference service (cross-tenant → NOT_FOUND)
    if (env.stateRef) {
      if (deps.refStatus && deps.refStatus !== 'OK') { const code = deps.refStatus === 'EXPIRED' ? 'STATE_REF_EXPIRED' : deps.refStatus === 'TIMEOUT' ? 'STATE_REF_TIMEOUT' : deps.refStatus === 'ACCESS_DENIED' ? 'STATE_REF_ACCESS_DENIED' : 'STATE_REF_NOT_FOUND'; skip('stateRef', code); }
      else if (deps.refPayload) ok('organization');
    }
    // the effective payload: inline state (path + params) plus, for a valid stateRef, its branches (path wins on route/resource)
    const st = {}, inl = env.state, ref = !env.stateRef || deps.refStatus !== 'OK' ? null : deps.refPayload || null;
    for (const b of Object.keys(C().BRANCHES)) { const v = inl[b] != null ? inl[b] : ref && ref[b] != null && !['development'].includes(b) ? ref[b] : null; if (v != null) st[b] = v; }
    // 2. development
    const dev = st.development.developmentId;
    if (deps.developmentExists && !deps.developmentExists(dev)) return fail('DEVELOPMENT_NOT_FOUND', 'RESOURCE_NOT_FOUND');
    if (deps.currentDevelopmentId && deps.currentDevelopmentId !== dev) return freeze({ ...fail('DEVELOPMENT_SWITCH_REQUIRED', 'RESOURCE_NOT_FOUND'), requiresDevelopment: dev });
    patch.developmentId = dev; ok('development');
    // 3. route / resource
    let route = env.route === 'DEVELOPMENT' ? 'MAP' : env.route;
    if (env.status === 'UNSUPPORTED_VERSION') warnings.push(w('LINK_VERSION_UNSUPPORTED'));
    ok('route');
    // 4. customer / journey — internal only, only after authorization, never inferred from filters
    let customerOk = false;
    if (st.customer) {
      if (!internal) skip('customer', 'CUSTOMER_ACCESS_DENIED');
      else if (!(deps.authorize && deps.authorize('customer.read', { type: 'CUSTOMER', id: st.customer.customerId }))) skip('customer', 'CUSTOMER_ACCESS_DENIED');
      else { patch.currentCustomerId = st.customer.customerId; customerOk = true; ok('customer'); }
    }
    if (st.journey) {
      if (!internal || !customerOk || !(deps.authorize && deps.authorize('journey.read', { type: 'JOURNEY', id: st.journey.journeyId }))) skip('journey', 'JOURNEY_ACCESS_DENIED');
      else { hints.journeyId = st.journey.journeyId; ok('journey'); }
    }
    // 5. filters (registry-validated: unknown keys / invalid values dropped; technical level internal only; customer-derived only from a stateRef with an authorized customer)
    if (st.filters && st.filters.values) {
      const F = deps.filters || App.filters, pol = C().FILTER_SHARE_POLICY, vals = {}, removed = [];
      for (const k of Object.keys(st.filters.values)) {
        if (C().UNSAFE_KEYS.includes(k)) continue;
        const v = st.filters.values[k];
        if (!F || !F.STATE_KEYS.includes(k)) { removed.push(k); continue; }
        if (pol.personalKeys.includes(k)) { removed.push(k); continue; }
        if (pol.customerDerivedKeys.includes(k) && !(customerOk && ref && ref.filters === st.filters)) { removed.push(k); continue; }
        vals[k] = Array.isArray(v) ? v.map(String) : typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
      }
      if (F) {
        const q = F.compile(vals).query, bad = new Set();
        for (const d of q.dropped || []) for (const sk of d.stateKeys || []) bad.add(sk);
        for (const c of q.conditions) { const def = F.BY[c.filterId]; if (def && def.level === 'TECHNICAL' && !pol.technicalLevelContexts.includes(context)) for (const sk of def.stateKeys) bad.add(sk); }
        for (const k of bad) if (k in vals) { delete vals[k]; removed.push(k); }
      }
      if (removed.length) warnings.push(w('FILTER_REMOVED', { count: removed.length }));
      if (Object.keys(vals).length) { patch.activeFilters = vals; ok('filters'); } else skip('filters', 'FILTER_REMOVED');
    }
    // 6. map layer / base / overlays (registry-validated; unknown layer → development default + warning)
    if (st.map) {
      const reg = deps.layerRegistry || (App.mapLayers && App.mapLayers.registry(dev)), defs = deps.mapDefaults || (App.mapLayers ? App.mapLayers.defaultState(dev) : {});
      const m = st.map; let any = false, partial = false;
      if (m.baseMapMode) { const b = App.mapLayers ? App.mapLayers.BASE_TO_STORE[m.baseMapMode] : String(m.baseMapMode).toLowerCase(); if (b) { patch.backgroundLayer = b; any = true; } }
      if (m.layerId) {
        const def = reg && reg.get(m.layerId), types = App.mapLayers ? App.mapLayers.TYPES : {};
        const av = def && App.mapLayers && App.mapLayers.isLayerAvailable ? App.mapLayers.isLayerAvailable(def, { mode: deps.presentationMode || 'broker', hasCustomer: customerOk || !!deps.hasCustomer }) : { available: !!def };
        if (def && (def.type === types.THEMATIC_PRIMARY || def.id === 'none') && av.available !== false) { patch.activeMapLayer = def.id; any = true; }
        else { patch.activeMapLayer = defs.primaryLayerId || null; partial = true; skip('map.layer', 'LAYER_UNAVAILABLE', { fallback: defs.primaryLayerId || null }); }
      }
      if (m.scoreKey && (patch.activeMapLayer === 'score' || (!m.layerId && defs.primaryLayerId === 'score'))) { patch.scoreKey = m.scoreKey; any = true; }
      if (Array.isArray(m.overlays)) { const okIds = m.overlays.filter(id => { const d = reg && reg.get(id); return d && d.toggle; }); if (okIds.length < m.overlays.length) { partial = true; skip('map.overlays', 'OVERLAY_UNAVAILABLE'); } patch.mapOverlays = okIds; any = true; }
      if (any || !partial) ok('map');
    }
    // 7. comparison (order kept, duplicates removed, max 4; ids resolved, missing reported; values recomputed by the Comparison domain)
    if (route === 'COMPARE') {
      const refs = (st.comparison && st.comparison.candidateLotIds) || [], ids = [], seen = new Set(); let missing = 0;
      for (const r of refs) { const l = deps.resolveLot ? deps.resolveLot(r) : null; if (!l) { missing++; continue; } if (!seen.has(l.identity.id)) { seen.add(l.identity.id); ids.push(l.identity.id); } }
      const max = C().SIZE_POLICY.maxComparisonCandidateCount;
      if (ids.length > max) warnings.push(w('COMPARISON_TRUNCATED', { max }));
      if (missing) skip('comparison.candidates', 'COMPARISON_LOT_NOT_FOUND', { count: missing });
      if (ids.length) { patch.comparisonLotIds = ids.slice(0, max); patch.view = 'compare'; ok('comparison'); if (st.comparison.activeSectionId) hints.comparisonSectionId = st.comparison.activeSectionId; }
      else { skip('comparison', 'COMPARISON_NOT_FOUND'); route = 'MAP'; patch.view = 'map'; }
    }
    // 8. selected lot (never before the development; a missing lot is never replaced by another one)
    if (route === 'LOT') {
      const r = st.lot && st.lot.selectedLotId, l = r && deps.resolveLot ? deps.resolveLot(r) : null;
      if (l && l.identity.developmentId && l.identity.developmentId !== dev) { skip('lot', 'LOT_NOT_FOUND'); patch.currentLotId = null; route = 'MAP'; hints.message = C().MESSAGES.LOT_NOT_FOUND; }
      else if (l) { patch.currentLotId = l.identity.id; patch.view = 'map'; ok('lot'); }
      else { skip('lot', 'LOT_NOT_FOUND'); patch.currentLotId = null; patch.view = 'map'; route = 'MAP'; hints.message = C().MESSAGES.LOT_NOT_FOUND; }
    }
    if (route === 'MAP' && env.route !== 'COMPARE' && !('view' in patch)) patch.view = 'map';
    // 9. viewport (map units, inside the development frame; otherwise reset)
    if (st.map && st.map.viewport) {
      const v = st.map.viewport, b = deps.mapBounds;
      if (route !== 'MAP') warnings.push(w('VIEWPORT_IGNORED_WITH_LOT_FOCUS'));
      else if (b && !(v.centerX >= 0 && v.centerX <= b.width && v.centerY >= 0 && v.centerY <= b.height && v.zoom > 0 && v.zoom <= 40)) skip('viewport', 'VIEWPORT_RESET');
      else { hints.viewport = freeze({ centerX: v.centerX, centerY: v.centerY, zoom: v.zoom }); ok('viewport'); }
    }
    // 10. presentation step (snapshot must exist and be authorized; invalid step → start step)
    if (route === 'PRESENTATION') {
      const p = st.presentation || {}, snap = deps.presentation && deps.presentation.getSnapshot ? deps.presentation.getSnapshot(p.snapshotId) : null;
      if (!snap) { skip('presentation', 'PRESENTATION_NOT_FOUND'); route = 'MAP'; patch.view = 'map'; }
      else if (!(deps.authorize && deps.authorize('presentation.read', { type: 'PRESENTATION', id: p.snapshotId }))) { skip('presentation', 'PRESENTATION_ACCESS_DENIED'); route = 'MAP'; patch.view = 'map'; }
      else {
        let step = p.stepId || null;
        if (step && !(snap.stepIds || []).includes(step)) { skip('presentation.step', 'PRESENTATION_STEP_NOT_FOUND'); step = snap.startStepId || null; }
        hints.presentation = freeze({ snapshotId: p.snapshotId, stepId: step || snap.startStepId || null, mode: 'SNAPSHOT' }); ok('presentation');
      }
    }
    // 11. UI hints (semantic panel only — never widths, sheet snap or scroll; the layout adapts per device)
    if (route === 'LOT' && st.ui && st.ui.panel) {
      if (st.ui.panel === 'details') {
        if (!deps.detailSections || deps.detailSections.includes(st.ui.detailSection)) { patch.panel = 'details'; patch.detailSection = st.ui.detailSection; ok('ui'); } else skip('ui', 'SECTION_NOT_FOUND');
      } else { patch.panel = st.ui.panel; ok('ui'); }
    }
    const status = skipped.length ? 'PARTIAL' : 'FULL';
    return freeze({ status, restoredBranches: freeze(restored), skippedBranches: freeze(skipped), warnings: freeze(warnings), finalRoute: route, finalAppStatePatch: freeze(patch), hints: freeze(hints),
      errorState: status === 'PARTIAL' ? 'PARTIAL_RESTORE' : null, message: hints.message || (status === 'PARTIAL' ? C().MESSAGES.PARTIAL_RESTORE : null) });
  }

  /** restoreAsync(envelope, deps, { transactions, references, authCtx, timeoutMs }) → Promise<LinkRestoreResult | { status: 'CANCELLED' }>
      Every await checks that this transaction is still the active one. */
  async function restoreAsync(env, deps = {}, o = {}) {
    const tx = o.transactions || defaultTx, t = tx.begin(env), t0 = Date.now();
    let refPayload = null, refStatus = null;
    if (env && env.stateRef) {
      if (!o.references) refStatus = 'NOT_FOUND';
      else {
        const timeout = o.timeoutMs || 4000;
        const r = await Promise.race([o.references.get(o.authCtx || {}, env.stateRef).then(x => ({ ok: true, x }), e => ({ ok: false, code: e && e.code })), new Promise(res => (o.setTimeout || setTimeout)(() => res({ ok: false, code: 'TIMEOUT' }), timeout))]);
        if (!tx.isActive(t)) return freeze({ status: 'CANCELLED', transactionId: t.id });
        if (r.ok) { refPayload = r.x.payload; refStatus = 'OK'; } else refStatus = r.code === 'STATE_REF_EXPIRED' ? 'EXPIRED' : r.code === 'TIMEOUT' ? 'TIMEOUT' : r.code === 'ACCESS_DENIED' ? 'ACCESS_DENIED' : 'NOT_FOUND';
      }
    }
    if (!tx.isActive(t)) return freeze({ status: 'CANCELLED', transactionId: t.id });
    const res = restore(env, { ...deps, refPayload, refStatus });
    tx.finish(t, res.status === 'FAILED' ? 'FAILED' : 'COMPLETED');
    return freeze({ ...res, transactionId: t.id, latencyMs: Date.now() - t0, stateRefUsed: !!env.stateRef });
  }
  const defaultTx = createTransactions();

  /** events for topics 44/45 (names + allow-listed fields only: no ids, no lot codes, no customer) */
  function eventsFor(decodeResult, restoreResult, navigationSource = 'URL_RESTORE') {
    const env = decodeResult && decodeResult.envelope, base = { routeCode: env ? env.route : null, deepLinkContext: env ? env.context : null, navigationSource, linkVersion: decodeResult ? decodeResult.linkVersion ?? null : null };
    const out = [{ evt: 'deep_link_opened', data: { ...base, decodeStatus: decodeResult ? decodeResult.status : 'INVALID', migrated: !!(decodeResult && decodeResult.migrationSteps && decodeResult.migrationSteps.length) } }];
    if (restoreResult && restoreResult.status && restoreResult.status !== 'CANCELLED') {
      out.push({ evt: 'deep_link_restored', data: { ...base, restoreStatus: restoreResult.status, stateRefUsed: !!restoreResult.stateRefUsed } });
      if (restoreResult.status === 'PARTIAL') out.push({ evt: 'deep_link_partial_restore', data: { ...base, partialRestoreReasons: [...new Set(restoreResult.skippedBranches.map(s => s.reason))] } });
    }
    return out.map(e => freeze({ evt: e.evt, data: freeze(e.data) }));
  }
  /** in-memory counters (observability names of §105); no PII */
  function createMetrics() {
    const c = Object.create(null); for (const m of C().METRICS) c[m] = m.endsWith('latency') ? [] : 0;
    return freeze({
      record(decodeResult, restoreResult) {
        if (decodeResult) { if (decodeResult.status === 'INVALID') c.deep_link_decode_failure_count++; if (decodeResult.status === 'UNSUPPORTED_VERSION') c.deep_link_unsupported_version_count++; c.link_security_rejection_count += decodeResult.securityRejections || 0; }
        if (restoreResult) { if (restoreResult.status === 'PARTIAL') c.deep_link_partial_restore_count++; if (restoreResult.skippedBranches && restoreResult.skippedBranches.some(s => s.reason === 'STATE_REF_EXPIRED')) c.state_ref_expired_count++; if (restoreResult.latencyMs != null) { c.link_restore_latency.push(restoreResult.latencyMs); if (c.link_restore_latency.length > 50) c.link_restore_latency.shift(); } }
      },
      snapshot: () => freeze(JSON.parse(JSON.stringify(c)))
    });
  }
  return freeze({ ORDER, restore, restoreAsync, createTransactions, eventsFor, createMetrics });
})();

// ======================================================================== stateRef (authenticated, never public)
App.deeplink.references = (() => {
  const freeze = Object.freeze, C = () => App.deeplink.codec;
  const err = (code, message) => { const e = new Error(message || code); e.code = code; return e; };
  /** TTL per persistence class (seconds). Defaults are a proposal (human decision listed in the report). */
  const POLICY = freeze({ ttlSeconds: freeze({ EPHEMERAL: 86400, SESSION: 7 * 86400, BOOKMARK: 180 * 86400 }), accessScopes: freeze(['OWNER_ONLY', 'ORGANIZATION', 'ASSIGNED_TEAM']), defaultAccess: 'OWNER_ONLY',
    allowedContexts: freeze(['INTERNAL', 'BOOKMARK']), permissions: freeze({ create: 'link.stateRef.create', read: 'link.stateRef.read', revoke: 'link.stateRef.revoke' }) });
  const PERMISSIONS = freeze(['link.internal.create', 'link.stateRef.create', 'link.stateRef.read', 'link.stateRef.revoke', 'savedView.create', 'savedView.shareTeam']);
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const canonicalJson = x => JSON.stringify(x, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(kk => [kk, v[kk]])) : v);
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  function randomId(n = 12) {
    const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null, b = new Uint8Array(n);
    if (c) c.getRandomValues(b); else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return 'LS' + Array.from(b, x => ALNUM[x % 62]).join('');
  }
  /** createService({ now, idGen }) — reference implementation of LinkStateReferenceRepository + Service (backend: POST/GET/revoke /api/v1/link-states) */
  function createService(o = {}) {
    const rows = new Map(), now = () => (o.now ? o.now() : new Date());
    const can = (ctx, k) => !!(ctx && typeof ctx.can === 'function' && ctx.can(k)); // deny by default
    const sameOrg = (ctx, r) => !!(ctx && ctx.organizationId && ctx.organizationId === r.organizationId);
    async function create(ctx, input = {}) {
      if (!can(ctx, POLICY.permissions.create)) throw err('ACCESS_DENIED');
      if (!ctx.organizationId) throw err('TENANT_REQUIRED');
      const context = input.context || 'INTERNAL';
      if (!POLICY.allowedContexts.includes(context)) throw err('STATE_REF_NOT_PUBLIC', 'stateRef é interno; compartilhamento externo usa o ShareService.');
      const access = input.access || POLICY.defaultAccess; if (!POLICY.accessScopes.includes(access)) throw err('INVALID_ACCESS_SCOPE');
      const pc = input.persistenceClass || 'SESSION'; if (!POLICY.ttlSeconds[pc]) throw err('INVALID_PERSISTENCE_CLASS');
      const payload = input.payload || {};
      const v = C().validate({ schema: C().SCHEMA, version: C().CURRENT_VERSION, context, route: input.route || 'MAP', state: payload }, { context, allowSensitive: true });
      if (!v.ok) throw Object.assign(err('INVALID_PAYLOAD'), { issues: v.errors });
      const id = o.idGen ? o.idGen() : randomId(), created = now();
      const rec = freeze({ id, organizationId: ctx.organizationId, context, payload: freeze(JSON.parse(JSON.stringify(payload))), schemaVersion: C().CURRENT_VERSION, createdBy: ctx.userId || null,
        createdAt: created.toISOString(), expiresAt: new Date(created.getTime() + POLICY.ttlSeconds[pc] * 1000).toISOString(), lifecycleStatus: 'ACTIVE', checksum: fnv(canonicalJson(payload)), accessPolicyRef: access, persistenceClass: pc, teamId: input.teamId || null });
      rows.set(id, rec);
      return freeze({ id, expiresAt: rec.expiresAt, persistenceClass: pc, accessPolicyRef: access });
    }
    /** get(ctx, id) → { payload, ... } — cross-tenant and unknown ids look the same (NOT_FOUND) */
    async function get(ctx, id) {
      if (!C().ID.stateRef.test(String(id || ''))) throw err('NOT_FOUND');
      const r = rows.get(id);
      if (!r || !sameOrg(ctx, r)) throw err('NOT_FOUND');
      if (!can(ctx, POLICY.permissions.read)) throw err('ACCESS_DENIED');
      if (r.accessPolicyRef === 'OWNER_ONLY' && r.createdBy !== (ctx.userId || null)) throw err('ACCESS_DENIED');
      if (r.accessPolicyRef === 'ASSIGNED_TEAM' && !(ctx.teamIds || []).includes(r.teamId) && r.createdBy !== ctx.userId) throw err('ACCESS_DENIED');
      if (r.lifecycleStatus === 'REVOKED') throw err('STATE_REF_REVOKED');
      if (r.lifecycleStatus === 'EXPIRED' || Date.parse(r.expiresAt) <= now().getTime()) throw err('STATE_REF_EXPIRED');
      if (fnv(canonicalJson(r.payload)) !== r.checksum) throw err('STATE_REF_INTEGRITY');
      return freeze({ id: r.id, context: r.context, payload: r.payload, schemaVersion: r.schemaVersion, expiresAt: r.expiresAt });
    }
    async function revoke(ctx, id) {
      const r = rows.get(id); if (!r || !sameOrg(ctx, r)) throw err('NOT_FOUND');
      if (!can(ctx, POLICY.permissions.revoke) || (r.createdBy !== ctx.userId && !can(ctx, 'link.stateRef.revoke.any'))) throw err('ACCESS_DENIED');
      rows.set(id, freeze({ ...r, lifecycleStatus: 'REVOKED' })); return true;
    }
    return freeze({ create, get, revoke, _size: () => rows.size });
  }
  return freeze({ POLICY, PERMISSIONS, createService, checksum: p => fnv(canonicalJson(p)) });
})();

// ======================================================================== browser history
App.deeplink.navigation = (() => {
  const freeze = Object.freeze;
  const ActionClass = freeze({ NAVIGATIONAL: 'NAVIGATIONAL', STATEFUL_REPLACE: 'STATEFUL_REPLACE', TRANSIENT: 'TRANSIENT', NON_URL: 'NON_URL' });
  const NavigationSource = freeze({ USER_ACTION: 'USER_ACTION', URL_RESTORE: 'URL_RESTORE', BROWSER_HISTORY: 'BROWSER_HISTORY', PROGRAMMATIC: 'PROGRAMMATIC' });
  /** store keys that never reach the URL */
  const TRANSIENT_KEYS = freeze(['hoverLotId', 'legendFocus', 'sheet', 'drawerOpen', 'leftCollapsed', 'rightCollapsed', 'menu', 'modal', 'mapOverlay', 'explain', 'showRoute', 'distanceTo', 'openSections', 'compareFull', 'fullMap']);
  const NON_URL_KEYS = freeze(['preferences', 'constraints', 'objective', 'favorites', 'customers', 'simulation', 'solar', 'layerOpacities', 'baseMapBlend', 'presentationMode', 'filterLevels', 'activePriceTableId']);
  /** classify(prevEnvelope, nextEnvelope) → ActionClass */
  function classify(prev, next) {
    if (!next) return ActionClass.NON_URL;
    if (!prev) return ActionClass.NAVIGATIONAL;
    const ps = prev.state || {}, ns = next.state || {}, j = x => JSON.stringify(x == null ? null : x);
    if (prev.route !== next.route) return ActionClass.NAVIGATIONAL;
    if (j(ps.development) !== j(ns.development) || j(ps.lot) !== j(ns.lot) || j(ps.comparison && ps.comparison.candidateLotIds) !== j(ns.comparison && ns.comparison.candidateLotIds)) return ActionClass.NAVIGATIONAL;
    if (j(ps.customer) !== j(ns.customer) || j(ps.presentation) !== j(ns.presentation) || prev.stateRef !== next.stateRef) return ActionClass.NAVIGATIONAL;
    return ActionClass.STATEFUL_REPLACE;
  }
  const viewportOnly = (prev, next) => { if (!prev) return false; const a = { ...(prev.state.map || {}) }, b = { ...(next.state.map || {}) }; delete a.viewport; delete b.viewport; return JSON.stringify(a) === JSON.stringify(b) && JSON.stringify({ ...prev.state, map: null }) === JSON.stringify({ ...next.state, map: null }); };

  /** createCoordinator({ history, location, encode(envelope) → hash, debounceMs, pushNavigational, setTimeout, clearTimeout })
      update(envelope, { source }) decides push / replace / nothing. While source is BROWSER_HISTORY nothing is pushed. */
  function createCoordinator(o = {}) {
    const H = o.history, L = o.location, debounceMs = o.debounceMs ?? 300, st = (o.setTimeout || setTimeout), ct = (o.clearTimeout || clearTimeout);
    let last = null, lastHash = null, timer = null, pushNav = o.pushNavigational !== false;
    const log = [];
    const write = (kind, hash) => { try { if (kind === 'push') H.pushState(H.state == null ? null : H.state, '', hash); else H.replaceState(H.state == null ? null : H.state, '', hash); log.push(kind); } catch (e) { /* sandboxed frame */ } };
    const flush = () => { if (timer) { ct(timer.id); const t = timer; timer = null; write('replace', t.hash); } };
    function update(env, opts = {}) {
      const source = opts.source || 'USER_ACTION';
      const r = o.encode(env); if (!r || !r.ok) return { action: 'NONE', reason: 'ENCODE_FAILED' };
      const hash = r.hash, prev = last;
      if (hash === lastHash && (!L || L.hash === hash)) { last = r.envelope; return { action: 'NONE', hash }; }
      if (source === 'BROWSER_HISTORY') { if (timer) { ct(timer.id); timer = null; } last = r.envelope; lastHash = hash; return { action: 'NONE', hash, reason: 'BROWSER_HISTORY' }; }
      if (source === 'URL_RESTORE') { flush(); write('replace', hash); last = r.envelope; lastHash = hash; return { action: 'REPLACE', hash }; }
      const cls = classify(prev, r.envelope);
      last = r.envelope; lastHash = hash;
      if (cls === 'NAVIGATIONAL' && pushNav && prev) { if (timer) { ct(timer.id); timer = null; } write('push', hash); return { action: 'PUSH', hash, actionClass: cls }; }
      if (viewportOnly(prev, r.envelope) && debounceMs > 0) { if (timer) ct(timer.id); const id = st(() => { const t = timer; timer = null; if (t) write('replace', t.hash); }, debounceMs); timer = { id, hash }; return { action: 'REPLACE_DEBOUNCED', hash, actionClass: cls }; }
      flush(); write('replace', hash); return { action: 'REPLACE', hash, actionClass: cls };
    }
    return freeze({ update, flush, setPushNavigational: v => { pushNav = !!v; }, current: () => ({ envelope: last, hash: lastHash }), log: () => log.slice() });
  }
  return freeze({ ActionClass, NavigationSource, TRANSIENT_KEYS, NON_URL_KEYS, classify, createCoordinator });
})();

// ======================================================================== extractor + LinkStateService (copy link)
App.deeplink.service = (() => {
  const freeze = Object.freeze, C = () => App.deeplink.codec;
  const PROFILES = freeze({
    MAP_MINIMAL: freeze(['development', 'route']),
    MAP_WITH_FILTERS: freeze(['development', 'route', 'lot', 'comparison', 'ui', 'map', 'filters']),
    LOT_CONTEXT: freeze(['development', 'route', 'lot', 'ui', 'map']),
    COMPARISON_CONTEXT: freeze(['development', 'route', 'comparison', 'map']),
    CUSTOMER_CONTEXT: freeze(['development', 'route', 'lot', 'comparison', 'ui', 'map', 'filters', 'customer']),
    PRESENTATION_CONTEXT: freeze(['development', 'route', 'presentation'])
  });
  /** extract(appState, { profile, codeOf, viewport, presentation, context }) → LinkStateEnvelope. Allow-list: reads named store keys only. */
  function extract(s, o = {}) {
    const profile = PROFILES[o.profile || 'MAP_WITH_FILTERS'], codeOf = o.codeOf || (x => x), has = b => profile.includes(b), st = { development: { developmentId: s.developmentId } };
    let route = 'MAP';
    if (o.presentation && o.presentation.snapshotId && has('presentation')) { route = 'PRESENTATION'; st.presentation = { snapshotId: o.presentation.snapshotId, ...(o.presentation.stepId ? { stepId: o.presentation.stepId } : {}) }; }
    else if (s.view === 'compare' && Array.isArray(s.comparisonLotIds) && s.comparisonLotIds.length && has('comparison')) { route = 'COMPARE'; st.comparison = { candidateLotIds: s.comparisonLotIds.map(codeOf) }; if (o.comparisonSectionId) st.comparison.activeSectionId = o.comparisonSectionId; }
    else if (s.currentLotId && has('lot')) { route = 'LOT'; st.lot = { selectedLotId: codeOf(s.currentLotId) }; if (has('ui') && (s.panel === 'details' || s.panel === 'simulation' || s.panel === 'solar')) st.ui = s.panel === 'details' ? { panel: 'details', detailSection: s.detailSection } : { panel: s.panel }; }
    if (has('map') && s.activeMapLayer) {
      const ML = App.mapLayers, base = ML && ML.STORE_TO_BASE ? ML.STORE_TO_BASE[s.backgroundLayer] || 'PLANT' : null;
      st.map = { layerId: s.activeMapLayer, ...(base ? { baseMapMode: base } : {}), scoreKey: s.scoreKey || 'housing', overlays: Array.isArray(s.mapOverlays) ? s.mapOverlays.slice() : [] };
      if (o.viewport && route === 'MAP') st.map.viewport = { centerX: o.viewport.centerX, centerY: o.viewport.centerY, zoom: o.viewport.zoom };
    }
    if (has('filters') && s.activeFilters && App.filters && App.filters.isActive(s.activeFilters)) st.filters = { filterSchemaVersion: App.filters.STATE_VERSION, values: { ...s.activeFilters } };
    if (has('customer') && s.currentCustomerId) st.customer = { customerId: s.currentCustomerId };
    return { schema: C().SCHEMA, version: C().CURRENT_VERSION, context: o.context || 'INTERNAL', route, state: st };
  }
  /** split(envelope) → { inline, sensitive } — sensitive branches never go inline */
  function split(env) {
    const inline = { ...env, state: {} }, sensitive = {};
    for (const [b, v] of Object.entries(env.state || {})) { if (v == null) continue; if (C().BRANCHES[b] && C().BRANCHES[b].privacy === 'SENSITIVE') sensitive[b] = v; else inline.state[b] = v; }
    return { inline, sensitive };
  }
  /** createLink({ intent, appState, base, codeOf, profile, viewport, presentation, references, authCtx, persistenceClass, codec })
      → Promise<{ ok, link, hash, intent, stateRefUsed, warnings } | { ok:false, delegate:'SHARE_SERVICE' }> */
  async function createLink(o = {}) {
    const intent = o.intent || 'INTERNAL_REFERENCE', codec = o.codec || C();
    if (intent === 'EXTERNAL_SHARE') return freeze({ ok: false, intent, delegate: 'SHARE_SERVICE', code: 'USE_SHARE_SERVICE', message: 'Compartilhar com cliente usa o link seguro do ShareService (tópico 42).' });
    if (o.authCtx && typeof o.authCtx.can === 'function' && o.authCtx.denyInternalLinks && !o.authCtx.can('link.internal.create')) return freeze({ ok: false, intent, code: 'ACCESS_DENIED' });
    const env = extract(o.appState, { profile: o.profile, codeOf: o.codeOf, viewport: o.viewport, presentation: o.presentation, context: intent === 'BOOKMARK' ? 'BOOKMARK' : 'INTERNAL', comparisonSectionId: o.comparisonSectionId });
    const { inline, sensitive } = split(env), warnings = [];
    let r = codec.encode(inline, { base: o.base }), useRef = Object.keys(sensitive).length > 0 || intent === 'HANDOFF' || (r.ok && r.warnings.some(x => x.code === 'FILTERS_TOO_LONG')) || (!r.ok && r.overflow);
    if (useRef) {
      if (!o.references) {
        if (Object.keys(sensitive).length) warnings.push({ code: 'SENSITIVE_STATE_OMITTED', branches: Object.keys(sensitive) });
        if (intent === 'HANDOFF') warnings.push({ code: 'HANDOFF_WITHOUT_STATE_REF' });
      } else {
        try {
          const payload = { ...inline.state, ...sensitive }, ref = await o.references.create(o.authCtx, { context: intent === 'BOOKMARK' ? 'BOOKMARK' : 'INTERNAL', route: env.route, payload, persistenceClass: o.persistenceClass || (intent === 'BOOKMARK' ? 'BOOKMARK' : intent === 'HANDOFF' ? 'SESSION' : 'EPHEMERAL') });
          const routeOnly = { ...inline, state: { development: inline.state.development, ...(inline.state.lot ? { lot: inline.state.lot } : {}), ...(inline.state.comparison ? { comparison: { candidateLotIds: inline.state.comparison.candidateLotIds } } : {}), ...(inline.state.presentation ? { presentation: { snapshotId: inline.state.presentation.snapshotId } } : {}) }, stateRef: ref.id };
          r = codec.encode(routeOnly, { base: o.base });
          return freeze({ ok: r.ok, link: r.link, hash: r.hash, intent, routeCode: env.route, stateRefUsed: true, stateRefExpiresAt: ref.expiresAt, warnings: freeze(warnings) });
        } catch (e) { warnings.push({ code: e.code === 'ACCESS_DENIED' ? 'STATE_REF_NOT_ALLOWED' : 'STATE_REF_FAILED' }); if (Object.keys(sensitive).length) warnings.push({ code: 'SENSITIVE_STATE_OMITTED', branches: Object.keys(sensitive) }); }
      }
    }
    if (!r.ok && r.overflow) { const noFilters = { ...inline, state: { ...inline.state } }; delete noFilters.state.filters; r = codec.encode(noFilters, { base: o.base }); warnings.push({ code: 'FILTERS_TOO_LONG' }); }
    return freeze({ ok: r.ok, link: r.link, hash: r.hash, intent, routeCode: env.route, stateRefUsed: false, warnings: freeze([...warnings, ...(r.warnings || [])]), errors: r.errors });
  }
  /** copyLinkEvent(result, profile) — internal_link_copied (no ids, no URL) */
  const copiedEvent = (res, profile) => freeze({ evt: 'internal_link_copied', data: freeze({ routeCode: res.routeCode || null, profile: profile || 'MAP_WITH_FILTERS', stateRefUsed: !!res.stateRefUsed, intent: res.intent }) });
  return freeze({ PROFILES, extract, split, createLink, copiedEvent });
})();
