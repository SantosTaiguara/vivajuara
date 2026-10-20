/* customer/customerContext.js — topic 39: ActiveCustomerContext, CustomerContextGuard, deep-link rules, request
   sequencing (a late answer for Maria never overwrites João) and LegacyCustomerMigrationAdapter.

   Compatibility with state/store.js: the store keeps only `currentCustomerId` (an id, never the Customer object) and
   the legacy `customers: [{ id, name, lots, profile }]` list the current overlay uses. Every patch produced here
   touches only keys the app already has; filters (activeFilters), map viewport and current lot are never touched.
   The legacy record ids ('c' + base36 timestamp) are opaque, so they are kept as the canonical Customer ids:
   currentCustomerId keeps working and migration is idempotent by construction. */
App.customer = App.customer || {};
App.customer.context = (() => {
  const D = () => App.customer.domain;
  const nowIso = now => new Date(now == null ? Date.now() : now).toISOString();
  const SOURCES = Object.freeze(['CUSTOMER_LIST', 'SEARCH', 'DEEP_LINK', 'RECOMMENDATION', 'RESTORE']);
  /** keys a customer switch must never change (map-centric: the map, the lot and manual filters stay) */
  const PRESERVED_KEYS = Object.freeze(['mapViewport', 'currentLotId', 'activeFilters', 'activeMapLayer', 'backgroundLayer', 'favorites', 'comparisonLotIds', 'view']);
  /** keys derived from the customer's profile (the panel's "Ajustar prioridades" / "Exigências"), already per customer in app.js */
  const PROFILE_KEYS = Object.freeze(['preferences', 'constraints', 'activePreset', 'objective']);

  const empty = () => Object.freeze({ customerId: null, profileVersionId: undefined, selectedAt: undefined, source: 'RESTORE' });
  /** select(customerId, { source, profileVersionId, now }) → ActiveCustomerContext (session/UI state, not part of Customer) */
  function select(customerId, opts = {}) {
    if (customerId != null && (typeof customerId !== 'string' || D().looksLikePII(customerId))) return empty();
    return Object.freeze({ customerId: customerId || null, profileVersionId: opts.profileVersionId || undefined, selectedAt: customerId ? nowIso(opts.now) : undefined, source: SOURCES.includes(opts.source) ? opts.source : 'CUSTOMER_LIST' });
  }
  const fromStore = st => select(st && st.currentCustomerId || null, { source: 'RESTORE' });
  /** storePatch(ctx) — only the id goes into the global store */
  const storePatch = ctx => ({ currentCustomerId: ctx && ctx.customerId || null });

  /** guard(st, nextCustomerId, { comparison, recommendation, profileDirty, favoritesContextRef }) → CustomerContextGuard result.
      Never blocks map navigation; only reports what the switch affects and the safe options. */
  function guard(st = {}, nextId = null, info = {}) {
    const cur = st.currentCustomerId || null, warnings = [], options = [];
    if (cur === nextId) return Object.freeze({ changed: false, warnings: Object.freeze([]), options: Object.freeze([]) });
    const cmp = info.comparison, cmpCustomer = cmp ? (cmp.context && cmp.context.customerId) || null : (st.comparisonLotIds || []).length ? cur : null;
    if (cmpCustomer && cmpCustomer !== nextId && ((cmp && (cmp.candidateIds || []).length) || (st.comparisonLotIds || []).length)) {
      warnings.push('COMPARISON_BELONGS_TO_PREVIOUS_CUSTOMER');
      options.push({ id: 'KEEP_COMPARISON', label: 'Manter a comparação do cliente anterior' }, { id: 'NEW_COMPARISON', label: 'Criar nova comparação para o próximo cliente' }, { id: 'COPY_CANDIDATES', label: 'Copiar os lotes para o próximo cliente' });
    }
    if (info.recommendation && info.recommendation.customerId && info.recommendation.customerId !== nextId) warnings.push('RECOMMENDATION_OF_PREVIOUS_CUSTOMER');
    else if (st.recScope && cur) warnings.push('RECOMMENDATION_OF_PREVIOUS_CUSTOMER');
    if (info.profileDirty) { warnings.push('UNSAVED_PROFILE_CHANGES'); options.push({ id: 'SAVE_PROFILE', label: 'Salvar o perfil antes de trocar' }, { id: 'DISCARD_PROFILE', label: 'Descartar alterações do perfil' }); }
    if (info.favoritesContextRef && info.favoritesContextRef === cur) warnings.push('FAVORITES_IN_PREVIOUS_CONTEXT');
    return Object.freeze({ changed: true, previousCustomerId: cur, nextCustomerId: nextId, warnings: Object.freeze(warnings), options: Object.freeze(options.map(Object.freeze)), preserves: PRESERVED_KEYS, blocking: false });
  }
  /** switchPatch(st, nextId, { profileUi }) — the store patch of a switch: id + the next customer's own profile; recommendation scope is contextual
      and is dropped; filters/map/lot/comparison/favorites untouched (the comparison keeps its own customer refs). */
  function switchPatch(st = {}, nextId, opts = {}) {
    const p = { currentCustomerId: nextId || null, recScope: null };
    if (opts.profileUi) { p.preferences = { ...(opts.profileUi.preferences || {}) }; p.constraints = { ...(opts.profileUi.constraints || {}) }; p.activePreset = opts.profileUi.activePreset || null; p.objective = opts.profileUi.objective || null; }
    return p;
  }
  /** exitPatch() — "Sair do contexto do cliente": same keys app.js 'custClear' resets; filters stay */
  const exitPatch = () => ({ currentCustomerId: null, preferences: {}, constraints: {}, activePreset: null, objective: null, recScope: null });
  const EXIT_LABEL = 'Sair do contexto do cliente';
  /** logout / tenant switch: active context is cleared and the in-memory repository dropped */
  function clearOnSessionChange(repoStore) { try { if (repoStore && repoStore.clear) repoStore.clear(); } catch (_) { /* ignore */ } return exitPatch(); }

  const firstName = s => String(s || '').trim().split(/\s+/)[0] || '';
  /** header / chip text. Desktop: "Atendendo: Maria Souza"; mobile/tablet chip: "Maria". Never a phone or e-mail. */
  function headerLabel(summary, device = 'desktop', journeyStage = null) {
    if (!summary || !summary.displayName) return null;
    const name = D().looksLikePII(summary.displayName) ? 'Cliente' : summary.displayName;
    const base = device === 'desktop' ? `Atendendo: ${name}` : firstName(name);
    return journeyStage ? `${base} · ${journeyStage}` : base;
  }
  /** contextual labels: Fit is always named with whom it is for */
  const fitLabel = summary => summary && summary.displayName ? `Compatibilidade para ${firstName(summary.displayName)}` : 'Compatibilidade com o perfil';
  const favoriteLabel = summary => summary && summary.displayName ? `Favoritar para ${firstName(summary.displayName)}` : 'Favoritar';
  const useProfileLabel = 'Usar perfil para Encontrar';

  /** deep links: ?customerId=<opaque> only. phone/email/cpf (and any PII-looking value) are rejected. Authorization is re-checked on open. */
  const FORBIDDEN_PARAMS = Object.freeze(['phone', 'telefone', 'email', 'e-mail', 'cpf', 'cnpj', 'rg', 'name', 'nome', 'whatsapp']);
  function parseDeepLink(query) {
    const out = { customerId: null, rejected: [] };
    for (const part of String(query || '').replace(/^[?#]/, '').split('&').filter(Boolean)) {
      const [k, v = ''] = part.split('='); let val; try { val = decodeURIComponent(v); } catch (_) { val = ''; }
      if (FORBIDDEN_PARAMS.includes(k.toLowerCase())) { out.rejected.push(k); continue; }
      if (k === 'customerId') { if (val && /^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/.test(val) && !D().looksLikePII(val)) out.customerId = val; else out.rejected.push(k); }
    }
    return Object.freeze({ ...out, rejected: Object.freeze(out.rejected), requiresAuthorization: !!out.customerId });
  }
  const buildDeepLink = customerId => customerId && !D().looksLikePII(customerId) ? 'customerId=' + encodeURIComponent(customerId) : '';

  /** RequestSequencer: only the latest request's answer may change the context (Maria → João quickly) */
  function sequencer() {
    let last = 0;
    return Object.freeze({ next() { const t = ++last; return Object.freeze({ token: t, isCurrent: () => t === last }); }, accept(ticket, fn) { return ticket && ticket.isCurrent() ? fn() : undefined; } });
  }

  // ------------------------------------------------------------------ LegacyCustomerMigrationAdapter
  /** migrate(legacyCustomers, { organizationId, developmentId, existing: { customerIds, profileChecksums }, now }) →
      { customers, profiles, versions, favorites, report } — idempotent: already-migrated ids are skipped, nothing duplicated. */
  function migrate(legacy = [], opts = {}) {
    const org = opts.organizationId, dev = opts.developmentId || 'viva-juara', dom = D(), existing = new Set((opts.existing && opts.existing.customerIds) || []);
    const report = { recordsDiscovered: 0, customersCreated: 0, alreadyMigrated: 0, profilesMigrated: 0, contactPointsMigrated: 0, externalRefsMigrated: 0, duplicateCandidates: 0, unresolvedIdentities: [],
      unresolvedFavoriteContexts: [], legacyPiiStorageFound: [], dataNotMigrated: [], legacyUiContext: 0 };
    const customers = [], profiles = [], versions = [], favorites = [], seen = new Set();
    for (const [i, r] of (Array.isArray(legacy) ? legacy : []).entries()) {
      report.recordsDiscovered++;
      if (!r || typeof r !== 'object') { report.dataNotMigrated.push({ index: i, reason: 'NOT_AN_OBJECT' }); continue; }
      const id = typeof r.id === 'string' ? r.id : null;
      if (!id || dom.looksLikePII(id) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/.test(id)) { report.unresolvedIdentities.push({ index: i, reason: !id ? 'MISSING_ID' : 'ID_NOT_OPAQUE' }); continue; }
      if (seen.has(id)) { report.unresolvedIdentities.push({ index: i, customerId: id, reason: 'DUPLICATE_ID_IN_LEGACY' }); continue; } seen.add(id);
      if (existing.has(id)) { report.alreadyMigrated++; continue; }
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      if (name) report.legacyPiiStorageFound.push({ customerId: id, field: 'name', storage: 'localStorage ws:<dev>:state.prefs.customers' });
      for (const k of Object.keys(r)) if (!['id', 'name', 'lots', 'profile'].includes(k)) report.dataNotMigrated.push({ customerId: id, field: k, reason: 'UNKNOWN_LEGACY_FIELD' });
      const c = dom.createCustomer({ id, displayName: name || 'Cliente sem nome' }, { organizationId: org, now: opts.now, idGen: opts.idGen, actorId: 'migration' });
      if (!c.ok) { report.unresolvedIdentities.push({ customerId: id, reason: c.code }); continue; }
      let customer = c.customer;
      const p = r.profile && typeof r.profile === 'object' ? r.profile : null;
      if (p && (Object.keys(p.preferences || {}).length || Object.keys(p.constraints || {}).length)) {
        const prof = dom.createPreferenceProfile(customer, { now: opts.now, idGen: opts.idGen });
        const input = dom.fromUiState({ preferences: p.preferences, constraints: p.constraints }, { developmentId: dev });
        const v = dom.createProfileVersion({ profile: prof, input }, { developmentId: dev, now: opts.now, idGen: opts.idGen, actorId: 'migration' });
        if (v.ok) { profiles.push(v.profile); versions.push(v.version); report.profilesMigrated++; customer = dom.updateCustomer(customer, { currentPreferenceProfileVersionId: v.version.id }, { expectedRevision: customer.recordRevision, now: opts.now }).customer; }
        else report.dataNotMigrated.push({ customerId: id, field: 'profile', reason: v.code });
      }
      // the legacy objective/preset are the panel's score lens, not the customer's objective (LIVE/INVEST): kept as UI context, not mapped
      if (p && (p.objective || p.activePreset)) { report.legacyUiContext++; report.dataNotMigrated.push({ customerId: id, field: 'profile.objective/activePreset', reason: 'UI_LENS_NOT_CUSTOMER_OBJECTIVE' }); }
      for (const lotId of Array.isArray(r.lots) ? r.lots : []) {
        if (typeof lotId !== 'string' || (opts.resolveLot && !opts.resolveLot(lotId))) { report.unresolvedFavoriteContexts.push({ customerId: id, lotRef: typeof lotId === 'string' ? lotId : null, reason: 'LOT_NOT_FOUND' }); continue; }
        favorites.push(Object.freeze({ id: 'fav_' + App.methodology.checksum([id, lotId]), contextType: 'CUSTOMER', contextRef: id, lotId, source: 'LEGACY_CUSTOMER_LOTS' }));
      }
      customers.push(customer); report.customersCreated++;
    }
    const dups = dom.detectDuplicates({ customers, contacts: [] }, { organizationId: org, now: opts.now });
    report.duplicateCandidates = dups.length;
    return Object.freeze({ customers: Object.freeze(customers), profiles: Object.freeze(profiles), versions: Object.freeze(versions), favorites: Object.freeze(favorites), duplicateCandidates: dups, report: Object.freeze(report) });
  }
  /** legacyProfileUi(customerRecord) — the legacy record's panel state, for app.js 'custPick' (unchanged behaviour) */
  const legacyProfileUi = c => { const p = (c && c.profile) || {}; return { preferences: { ...(p.preferences || {}) }, constraints: { ...(p.constraints || {}) }, activePreset: p.activePreset || null, objective: p.objective || null }; };

  return Object.freeze({ SOURCES, PRESERVED_KEYS, PROFILE_KEYS, EXIT_LABEL, FORBIDDEN_PARAMS, empty, select, fromStore, storePatch, guard, switchPatch, exitPatch, clearOnSessionChange,
    headerLabel, fitLabel, favoriteLabel, useProfileLabel, parseDeepLink, buildDeepLink, sequencer, migrate, legacyProfileUi });
})();
