/* navigation/navigationRegistry.js — topic 53: compact navigation, one registry for every device.
   NavigationManifest (config/navigation/manifest.json, bundled in App.configs.navigation.manifest) declares the five
   primary workspaces (PrimaryNavItem), the workspace sections (WorkspaceNavDefinition), the contextual actions
   (ContextualActionDefinition), the header tools with their overflow rule per responsive layout profile, the placement
   per profile (NavigationPlacementResolver), offline capability (OfflineNavCapability), preservation policies and the
   G-sequence shortcuts. This module only reads, validates and resolves it:
   - visibility = feature enabled AND tenant entitled AND user authorized (App.authz / App.permissions; never a role code);
   - permanently unauthorized → HIDDEN; temporarily unavailable (offline, deny:"disable") → VISIBLE_DISABLED with a reason;
   - admin sections are hidden when denied (a broker never sees administrative structure);
   - placement comes from the ResponsiveProfile (topics 22/23), never from the user agent;
   - the label is never the route code; route codes are stable and language independent.
   No DOM here (menuView.js renders); no URL serializer here (topic 43 owns it). */
App.navigation = App.navigation || {};
App.navigation.registry = (() => {
  const freeze = Object.freeze;
  const WORKSPACES = freeze(['MAP', 'FIND', 'COMPARE', 'CUSTOMERS', 'DEVELOPMENT']);
  const NAV_ITEM_STATE = freeze({ VISIBLE_ENABLED: 'VISIBLE_ENABLED', VISIBLE_DISABLED: 'VISIBLE_DISABLED', HIDDEN: 'HIDDEN' });
  const PRIMARY_PLACEMENTS = freeze(['BOTTOM_NAV', 'LEFT_RAIL', 'TOP_NAV']);
  const MOBILE_PLACEMENTS = freeze(['BOTTOM_NAV', 'OVERFLOW']);
  const DESKTOP_PLACEMENTS = freeze(['PRIMARY_RAIL', 'TOP_NAV']);
  const LAYOUT_PROFILES = freeze(['MOBILE', 'TABLET_COMPACT', 'TABLET_PORTRAIT', 'TABLET_LANDSCAPE', 'TABLET_LARGE', 'DESKTOP']);
  const TOOL_PLACEMENTS = freeze(['INLINE', 'INLINE_WHEN_ACTIVE', 'OVERFLOW', 'NONE']);
  const OFFLINE_STATES = freeze(['FULL', 'READ_ONLY', 'LAST_KNOWN', 'ONLINE_REQUIRED']);
  const EXPERIENCE_MODES = freeze(['BROKER', 'CLIENT', 'TECHNICAL', 'PRESENTATION', 'SHARED']);
  const ACTION_PRIORITIES = freeze(['PRIMARY', 'SECONDARY', 'OVERFLOW']);
  const PRESERVATION_KEYS = freeze(['preserveDevelopment', 'preserveSelectedLot', 'preserveCustomer', 'preserveComparison', 'preserveFilters', 'preserveMapLayer', 'preserveMapCamera']);
  /** store.view values of the shell (topics 10–24) — kept as they are; the workspace is derived from them */
  const VIEWS = freeze(['map', 'compare', 'clients', 'development']);
  /** primary workspace → route code of the topic-43 codec (FIND reserved there; CUSTOMERS only through a stateRef) */
  const URL_ROUTE = freeze({ MAP: 'MAP', FIND: 'FIND', COMPARE: 'COMPARE', CUSTOMERS: 'CUSTOMER', DEVELOPMENT: 'DEVELOPMENT' });
  /** icon ids the menu view knows (menuView.js ICONS must cover them; tested) */
  const ICON_IDS = freeze(['map', 'find', 'compare', 'users', 'building', 'more', 'calc', 'list', 'cmp', 'heart', 'share', 'sun', 'route', 'info', 'copy']);
  const MAX_PRIMARY = 5;

  const manifest = () => (App.configs && App.configs.navigation && App.configs.navigation.manifest) || null;
  const M = () => { const m = manifest(); if (!m) throw Object.assign(new Error('NavigationManifest ausente (config/navigation/manifest.json)'), { code: 'NAV_MANIFEST_MISSING' }); return m; };
  /** t(key, vars) — message lookup (pt-BR today; i18n later changes labels, never route codes) */
  function t(key, vars) { const s = (M().messages || {})[key]; if (s == null) return key; return vars ? String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] == null ? '' : String(vars[k])) : s; }
  const items = () => (M().primaryItems || []).slice().sort((a, b) => a.order - b.order);
  const item = id => items().find(i => i.id === id) || null;
  const workspace = id => (M().workspaces || []).find(w => w.workspaceId === id) || null;
  const contextualActions = () => (M().contextualActions || []).slice();
  const headerTools = () => (M().headerTools || []).slice();
  const shortcuts = () => (M().shortcuts || []).filter(s => s.enabledByDefault !== false);
  const itemOfView = view => items().find(i => i.view === view && !i.panel) || null;
  const layoutOf = p => { const lp = typeof p === 'string' ? p : p && p.layoutProfile; return LAYOUT_PROFILES.includes(lp) ? lp : 'TABLET_COMPACT'; };

  // ------------------------------------------------------------------ NavigationPermissionResolver
  /** accessOf(featureId, ctx) → { allowed, visible, reason, message } — App.authz when present (the shell), else a formal
      NavigationContext { permissions: [...] } evaluated against the feature matrix. No feature / no authority → deny. */
  function accessOf(featureId, ctx = {}) {
    if (!featureId) return { allowed: true, visible: true, reason: 'NO_FEATURE_REQUIRED', message: null };
    const A = ctx.authz;
    if (A && typeof A.feature === 'function') {
      const f = A.feature(featureId, ctx.resource || null, { silent: true, context: ctx.authContext || undefined, connectivity: ctx.connectivity && ctx.connectivity !== 'UNKNOWN' ? ctx.connectivity : undefined });
      return { allowed: !!f.allowed, visible: !!f.visible, reason: f.reason || (f.allowed ? 'ALLOWED' : 'DENIED'), message: f.allowed ? null : (f.message || t('nav.denied')) };
    }
    if (Array.isArray(ctx.permissions)) {
      const P = App.permissions, f = P && P.feature(featureId);
      if (!f) return { allowed: false, visible: false, reason: 'UNKNOWN_FEATURE', message: t('nav.denied') };
      const ok = f.permissions.every(k => ctx.permissions.includes(k));
      return { allowed: ok, visible: ok || f.deny === 'disable', reason: ok ? 'ALLOWED' : 'NO_GRANT', message: ok ? null : (f.message || t('nav.denied')) };
    }
    return { allowed: false, visible: false, reason: 'NO_AUTHORITY', message: t('nav.denied') }; // deny by default
  }
  const entitled = (it, ctx) => !it.entitlement || (Array.isArray(ctx.entitlements) && ctx.entitlements.includes(it.entitlement));
  const flagOn = (it, ctx) => !it.featureFlag || !!({ ...(M().featureFlags || {}), ...(ctx.flags || {}) })[it.featureFlag];

  // ------------------------------------------------------------------ OfflineNavCapability
  /** offlineCapability(itemId, { connectivity, packAvailable, deviceLocal }) → { navItemId, state, messageKey? } */
  function offlineCapability(itemId, o = {}) {
    const it = item(itemId); if (!it) return freeze({ navItemId: itemId, state: 'ONLINE_REQUIRED', messageKey: 'nav.offline.onlineRequired' });
    if (o.connectivity !== 'OFFLINE') return freeze({ navItemId: itemId, state: 'FULL' });
    let state = it.offline || 'ONLINE_REQUIRED';
    if (it.offlineWithoutPack && o.packAvailable === false) state = it.offlineWithoutPack;
    if (it.offlineWhenDeviceLocal) { const dl = o.deviceLocal != null ? !!o.deviceLocal : !!(App.permissions && (App.permissions.feature(it.feature) || {}).deviceLocal); if (dl) state = it.offlineWhenDeviceLocal; }
    const messageKey = state === 'ONLINE_REQUIRED' ? 'nav.offline.onlineRequired' : state === 'LAST_KNOWN' ? 'nav.offline.lastKnown' : state === 'READ_ONLY' ? 'nav.offline.readOnly' : undefined;
    return freeze({ navItemId: itemId, state, ...(messageKey ? { messageKey } : {}) });
  }

  // ------------------------------------------------------------------ mode policy
  /** experienceMode(st) → BROKER | CLIENT | TECHNICAL | PRESENTATION | SHARED (UI modes are not roles) */
  function experienceMode(st = {}, o = {}) {
    if (o.shared) return 'SHARED';
    if (st.presentationView) return 'PRESENTATION';
    return ({ broker: 'BROKER', client: 'CLIENT', technical: 'TECHNICAL', presentation: 'PRESENTATION' })[st.presentationMode] || 'BROKER';
  }
  const modePolicy = mode => ((M().modePolicies || {})[mode]) || { primaryNav: 'FULL' };

  /** resolveItem(item, ctx) → PrimaryNavItem with state / disabledReason / offline */
  function resolveItem(it, ctx = {}) {
    const mode = ctx.mode || 'BROKER', pol = modePolicy(mode);
    const base = { id: it.id, labelKey: it.labelKey, label: t(it.labelKey), shortLabel: it.shortLabelKey ? t(it.shortLabelKey) : t(it.labelKey), iconId: it.iconId, routeCode: it.routeCode,
      order: it.order, view: it.view, panel: it.panel || null, mobilePlacement: it.mobilePlacement, desktopPlacement: it.desktopPlacement, badgeProviderId: it.badgeProviderId || null, feature: it.feature };
    const hide = code => freeze({ ...base, state: NAV_ITEM_STATE.HIDDEN, disabledReason: freeze({ code, messageKey: code === 'MODE' ? 'nav.label' : 'nav.denied' }), offline: null });
    if (it.enabled === false) return hide('DISABLED_BY_CONFIG');
    if (!flagOn(it, ctx)) return hide('FLAG_OFF');
    if (!entitled(it, ctx)) return hide('NOT_ENTITLED');
    if (pol.primaryNav === 'NONE' || (pol.hiddenItems || []).includes(it.id)) return hide('MODE');
    const acc = accessOf(it.feature, ctx);
    if (!acc.allowed && !acc.visible) return hide(acc.reason || 'DENIED');
    const off = offlineCapability(it.id, { connectivity: ctx.connectivity, packAvailable: ctx.packAvailable, deviceLocal: ctx.deviceLocal });
    if (!acc.allowed) return freeze({ ...base, state: NAV_ITEM_STATE.VISIBLE_DISABLED, disabledReason: freeze({ code: acc.reason || 'DENIED', messageKey: 'nav.denied', message: acc.message }), offline: off });
    if (off.state === 'ONLINE_REQUIRED') return freeze({ ...base, state: NAV_ITEM_STATE.VISIBLE_DISABLED, disabledReason: freeze({ code: 'OFFLINE_UNAVAILABLE', messageKey: off.messageKey, message: t(off.messageKey) }), offline: off });
    return freeze({ ...base, state: NAV_ITEM_STATE.VISIBLE_ENABLED, disabledReason: null, offline: off });
  }
  /** NavigationRegistry.getPrimaryItems(context) — every item with its state (HIDDEN included, so callers can test) */
  const getPrimaryItems = (ctx = {}) => items().map(it => resolveItem(it, ctx));
  /** visiblePrimaryItems(ctx) — what a container renders */
  const visiblePrimaryItems = (ctx = {}) => getPrimaryItems(ctx).filter(i => i.state !== NAV_ITEM_STATE.HIDDEN);

  /** workspaceSections(workspaceId, ctx) — WorkspaceNavDefinition filtered by permission/capability; admin sections hidden when denied */
  function workspaceSections(workspaceId, ctx = {}) {
    const w = workspace(workspaceId); if (!w) return [];
    return w.sections.slice().sort((a, b) => a.order - b.order).map(s => {
      const acc = accessOf(s.feature || s.capability || null, ctx), off = s.online && ctx.connectivity === 'OFFLINE';
      const state = !entitled(s, ctx) ? 'HIDDEN' : !acc.allowed ? (s.admin || !acc.visible ? 'HIDDEN' : 'VISIBLE_DISABLED') : off ? 'VISIBLE_DISABLED' : 'VISIBLE_ENABLED';
      return freeze({ id: s.id, labelKey: s.labelKey, label: t(s.labelKey), order: s.order, admin: !!s.admin, handler: s.handler || null, state,
        reason: state === 'VISIBLE_ENABLED' ? null : !acc.allowed ? acc.reason : off ? 'OFFLINE_UNAVAILABLE' : 'NOT_ENTITLED', emptyStateKey: s.emptyStateKey || null });
    }).filter(s => s.state !== 'HIDDEN');
  }
  /** contextual actions for a lot in a UI mode, grouped by priority (PRIMARY / SECONDARY / OVERFLOW) */
  function contextualFor(mode = 'broker', ctx = {}) {
    const out = { PRIMARY: [], SECONDARY: [], OVERFLOW: [] };
    for (const a of contextualActions()) {
      if (!(a.availableModes || []).includes(mode)) continue;
      const fid = App.permissions ? App.permissions.featureOfAction(a.handlerId, a.dataset || {}) : null;
      if (fid && !accessOf(fid, ctx).allowed) continue;
      out[a.priority].push(freeze({ id: a.id, label: t(a.labelKey), iconId: a.iconId || null, handlerId: a.handlerId, priority: a.priority }));
    }
    return freeze(out);
  }

  // ------------------------------------------------------------------ NavigationPlacementResolver + header overflow
  /** placement(responsiveProfile) → { primaryPlacement, showLabels, layoutProfile, family } */
  function placement(profile) {
    const lp = layoutOf(profile), p = (M().placement || {})[lp] || { primaryPlacement: 'BOTTOM_NAV', showLabels: true }, d = M().density || {};
    let primaryPlacement = p.primaryPlacement;
    if (d.railEnabled && primaryPlacement === 'TOP_NAV') primaryPlacement = 'LEFT_RAIL';
    const density = lp === 'DESKTOP' ? d.desktopMode : lp.startsWith('TABLET_L') ? d.tabletLandscapeMode : d.mobileMode;
    return freeze({ primaryPlacement, showLabels: p.showLabels !== false, layoutProfile: lp, family: lp === 'MOBILE' ? 'MOBILE' : lp === 'DESKTOP' ? 'DESKTOP' : 'TABLET', density: density || null });
  }
  /** headerLayout(profile, { hasCustomer }) → { tools: [{ id, placement, visible }], inline, overflow, hiddenUntilActive, none } */
  function headerLayout(profile, o = {}) {
    const lp = layoutOf(profile), tools = headerTools().map(h => {
      const pl = (h.placement || {})[lp] || 'INLINE';
      return freeze({ id: h.id, placement: pl, visible: pl === 'INLINE' || pl === 'OVERFLOW' || (pl === 'INLINE_WHEN_ACTIVE' && !!o.hasCustomer), controls: h.controls || [], fallbackItem: h.fallbackItem || null });
    });
    const by = p => tools.filter(x => x.placement === p).map(x => x.id);
    return freeze({ layoutProfile: lp, tools: freeze(tools), inline: by('INLINE'), overflow: by('OVERFLOW'), hiddenUntilActive: by('INLINE_WHEN_ACTIVE'), none: by('NONE') });
  }

  // ------------------------------------------------------------------ reachability (no feature loss)
  /** reachableControls(profile, ctx) → [{ act, variant, elementId, via }] — every control a user can reach in that profile.
      via: PRIMARY_NAV | HEADER | OVERFLOW | WHEN_ACTIVE (with fallbackItem) */
  function reachableControls(profile, ctx = {}) {
    const out = [], nav = visiblePrimaryItems(ctx);
    for (const i of nav) { out.push({ act: 'nav', variant: i.id, via: 'PRIMARY_NAV', workspace: i.id }); if (i.view && !i.panel) out.push({ act: 'view', variant: i.view, via: 'PRIMARY_NAV', workspace: i.id }); if (i.panel === 'find') out.push({ act: 'openFind', variant: null, via: 'PRIMARY_NAV', workspace: i.id }); }
    const hl = headerLayout(profile, ctx);
    for (const tl of hl.tools) {
      if (tl.placement === 'NONE') continue;
      const via = tl.placement === 'OVERFLOW' ? 'OVERFLOW' : tl.placement === 'INLINE_WHEN_ACTIVE' ? 'WHEN_ACTIVE' : 'HEADER';
      for (const c of tl.controls) out.push({ act: c.act || null, variant: c.variant || null, elementId: c.elementId || null, via, tool: tl.id, fallbackItem: tl.fallbackItem, conditional: !!c.conditional });
    }
    return out;
  }
  /** covers(legacyControl, reachable) — a legacy header control stays reachable if the same act+variant (or element id)
      is reachable, or it is a WHEN_ACTIVE control whose destination is covered by a primary item. */
  function covers(legacy, reach) {
    return reach.some(r => {
      if (legacy.elementId && r.elementId === legacy.elementId && (r.via !== 'WHEN_ACTIVE' || legacy.whenActive)) return true;
      // a control that only shows in some states (sync indicator, customer chip) never counts as the route to its destination
      if (legacy.act && r.act === legacy.act && (r.variant || null) === (legacy.variant || null) && r.via !== 'WHEN_ACTIVE' && !r.conditional) return true;
      return false;
    }) || (legacy.act === 'custClear' && reach.some(r => r.elementId === 'custClr')); // only exists while a customer is active, and so does its slot
  }

  // ------------------------------------------------------------------ contract validation (NavigationContractTests §243)
  /** validate({ iconIds, codecRoutes }) → errors [{ code, message }] */
  function validate(o = {}) {
    const errs = [], E = (code, message) => errs.push({ code, message }), m = manifest();
    if (!m) { E('NAV_MANIFEST_MISSING', 'config/navigation/manifest.json'); return errs; }
    if (!m.version) E('NO_VERSION', 'manifest.version');
    const msgs = m.messages || {}, icons = o.iconIds || ICON_IDS, P = App.permissions;
    const its = m.primaryItems || [], ids = new Set(), orders = new Set();
    if (its.length > MAX_PRIMARY) E('PRIMARY_MENU_OVERLOAD', `${its.length} itens > ${MAX_PRIMARY}`);
    for (const i of its) {
      if (!WORKSPACES.includes(i.id)) E('UNKNOWN_WORKSPACE', i.id);
      if (ids.has(i.id)) E('DUPLICATE_ITEM', i.id); ids.add(i.id);
      if (orders.has(i.order)) E('DUPLICATE_ORDER', `${i.id}: ${i.order}`); orders.add(i.order);
      if (!i.routeCode || !/^[A-Z_]+$/.test(i.routeCode)) E('INVALID_ROUTE_CODE', i.id);
      if (!msgs[i.labelKey]) E('MISSING_LABEL', `${i.id}: ${i.labelKey}`);
      if (i.shortLabelKey && !msgs[i.shortLabelKey]) E('MISSING_LABEL', `${i.id}: ${i.shortLabelKey}`);
      if (msgs[i.labelKey] && msgs[i.labelKey] === i.routeCode) E('LABEL_AS_ROUTE', i.id);
      if (!icons.includes(i.iconId)) E('UNKNOWN_ICON', `${i.id}: ${i.iconId}`);
      if (!MOBILE_PLACEMENTS.includes(i.mobilePlacement)) E('INVALID_MOBILE_PLACEMENT', i.id);
      if (!DESKTOP_PLACEMENTS.includes(i.desktopPlacement)) E('INVALID_DESKTOP_PLACEMENT', i.id);
      if (!VIEWS.includes(i.view)) E('UNKNOWN_VIEW', `${i.id}: ${i.view}`);
      if (P && i.feature && !P.feature(i.feature)) E('UNKNOWN_FEATURE', `${i.id}: ${i.feature}`);
      if (!OFFLINE_STATES.includes(i.offline)) E('INVALID_OFFLINE_STATE', i.id);
      if (o.codecRoutes && !o.codecRoutes.includes(URL_ROUTE[i.id])) E('ROUTE_NOT_IN_CODEC', `${i.id} → ${URL_ROUTE[i.id]}`);
    }
    for (const w of WORKSPACES) if (!ids.has(w)) E('UNREACHABLE_WORKSPACE', w);
    if (its.filter(i => i.isDefault).length !== 1) E('DEFAULT_WORKSPACE', 'exatamente um item padrão');
    if ((its.find(i => i.isDefault) || {}).id !== 'MAP') E('DEFAULT_NOT_MAP', 'o workspace padrão é o Mapa');
    for (const w of m.workspaces || []) {
      if (!ids.has(w.workspaceId)) E('WORKSPACE_WITHOUT_ITEM', w.workspaceId);
      const sid = new Set(), so = new Set();
      if ((w.sections || []).length > 9) E('TOO_MANY_SECTIONS', w.workspaceId);
      for (const s of w.sections || []) {
        if (sid.has(s.id)) E('DUPLICATE_SECTION', `${w.workspaceId}.${s.id}`); sid.add(s.id);
        if (so.has(s.order)) E('DUPLICATE_SECTION_ORDER', `${w.workspaceId}.${s.id}`); so.add(s.order);
        if (!msgs[s.labelKey]) E('MISSING_LABEL', `${w.workspaceId}.${s.id}`);
        for (const f of [s.feature, s.capability]) if (f && P && !P.feature(f)) E('UNKNOWN_FEATURE', `${w.workspaceId}.${s.id}: ${f}`);
      }
    }
    for (const a of m.contextualActions || []) {
      if (!ACTION_PRIORITIES.includes(a.priority)) E('INVALID_PRIORITY', a.id);
      if (!msgs[a.labelKey]) E('MISSING_LABEL', a.id);
      if (a.iconId && !icons.includes(a.iconId)) E('UNKNOWN_ICON', `${a.id}: ${a.iconId}`);
      if (P && P.featureOfAction(a.handlerId, {}) == null) E('UNKNOWN_HANDLER', `${a.id}: ${a.handlerId}`);
    }
    for (const h of m.headerTools || []) {
      for (const lp of LAYOUT_PROFILES) if (!TOOL_PLACEMENTS.includes((h.placement || {})[lp])) E('TOOL_PLACEMENT', `${h.id}@${lp}`);
      if (!msgs[h.labelKey]) E('MISSING_LABEL', h.id);
      for (const c of h.controls || []) if (c.act && c.act !== 'nav' && P && P.featureOfAction(c.act, { [((P.actions()[c.act] || {}).variantKey) || '_']: c.variant }) == null) E('UNKNOWN_HANDLER', `${h.id}: ${c.act}`);
    }
    for (const lp of LAYOUT_PROFILES) if (!PRIMARY_PLACEMENTS.includes(((m.placement || {})[lp] || {}).primaryPlacement)) E('PLACEMENT', lp);
    for (const [k, pol] of Object.entries(m.preservation || {})) for (const key of PRESERVATION_KEYS) if (typeof pol[key] !== 'boolean') E('PRESERVATION_POLICY', `${k}.${key}`);
    const seq = new Map();
    for (const s of m.shortcuts || []) {
      if (!WORKSPACES.includes(s.target)) E('SHORTCUT_TARGET', s.id);
      if (!msgs[s.descriptionKey]) E('MISSING_LABEL', s.id);
      for (const keys of [s.keys, s.altKeys].filter(Boolean)) { const k = keys.join(' ').toLowerCase(); if (seq.has(k)) E('SHORTCUT_CONFLICT', `${seq.get(k)} × ${s.id}`); seq.set(k, s.id); }
    }
    for (const mode of EXPERIENCE_MODES) if (!(m.modePolicies || {})[mode]) E('MODE_POLICY', mode);
    return errs;
  }

  // ------------------------------------------------------------------ LegacyNavigationInventory (§253–264)
  const L = (location, label, destination, usageType, shouldRemainPrimary, targetWorkspace, migrationAction, notes) => freeze({ location, label, destination, usageType, shouldRemainPrimary, targetWorkspace, migrationAction, notes });
  const LEGACY_INVENTORY = freeze([
    L('header .nav', 'Mapa', 'view=map', 'PRIMARY', true, 'MAP', 'KEEP_PRIMARY', 'Padrão; data-act=view → data-act=nav data-ws=MAP'),
    L('header .nav', 'Comparar (n)', 'view=compare', 'PRIMARY', true, 'COMPARE', 'KEEP_PRIMARY', 'Badge = candidatos (0 → sem badge)'),
    L('header .nav', 'Clientes', 'view=clients', 'PRIMARY', true, 'CUSTOMERS', 'KEEP_PRIMARY', 'Oculto sem customer_profile.manage'),
    L('header .nav', 'Empreendimento', 'view=development', 'PRIMARY', true, 'DEVELOPMENT', 'KEEP_PRIMARY', 'Seções administrativas por permissão'),
    L('mapa .edge.l', '⌕ Encontrar (n)', 'openFind (painel esquerdo/gaveta)', 'SECONDARY', true, 'FIND', 'KEEP_PRIMARY', 'Promovido a item primário; o botão do mapa continua'),
    L('header', 'Seletor de empreendimento', 'devSel → recarrega com #<dev>', 'ADMIN', false, null, 'REVIEW', 'Seletor ≠ menu primário (§67); fica no header'),
    L('header', 'Busca de lote/quadra', '#q + sugestões', 'CONTEXTUAL', false, 'MAP', 'MOVE_TO_WORKSPACE', 'Search ≠ navigation; continua no header (gatilho de busca)'),
    L('header', 'Indicador de sincronização', 'view=development', 'CONTEXTUAL', false, 'DEVELOPMENT', 'REVIEW', 'Indicador global de conectividade; no "Mais" no celular'),
    L('header', 'Chip do cliente / ×', 'view=clients / custClear', 'CONTEXTUAL', false, 'CUSTOMERS', 'REVIEW', 'Chip de contexto, não item de navegação (§93)'),
    L('header', 'Corretor / Cliente / Técnico', 'presentationMode', 'CONTEXTUAL', false, null, 'REVIEW', 'Modo de exibição; no "Mais" no celular (antes: Técnico invisível < 420 px)'),
    L('header', 'Apresentar', 'presentationView', 'CONTEXTUAL', false, null, 'MOVE_TO_CONTEXTUAL', 'No "Mais" no celular (antes: invisível < 700 px)'),
    L('header', 'Contexto de acesso (organização · papel)', 'secChip', 'ADMIN', false, null, 'MOVE_TO_ADMIN', 'No menu "Mais" em todos os perfis (antes: só ≥ 1440 px)'),
    L('QuickView', 'Solar / Sol no lote', 'panel=solar', 'CONTEXTUAL', false, 'MAP', 'MOVE_TO_CONTEXTUAL', 'Já contextual (nunca foi menu primário nesta base)'),
    L('QuickView / Lote', 'Simular (financeiro)', 'panel=simulation', 'CONTEXTUAL', false, 'MAP', 'MOVE_TO_CONTEXTUAL', 'Já contextual; também em Comparar'),
    L('QuickView / Ficha', 'Scores', 'details / technical', 'CONTEXTUAL', false, 'MAP', 'MOVE_TO_CONTEXTUAL', 'Lote, comparação, recomendação e modo técnico'),
    L('Encontrar', 'Rankings / recomendações', 'painel Encontrar', 'SECONDARY', false, 'FIND', 'MOVE_TO_WORKSPACE', 'Encontrar / Recommendation / Técnico'),
    L('Empreendimento / Técnico', 'Análises / versões', 'view=development', 'SECONDARY', false, 'DEVELOPMENT', 'MOVE_TO_WORKSPACE', 'Seção "Análises" (analysis.preview)'),
    L('Empreendimento / Ficha', 'Documentos', 'doc-preview', 'CONTEXTUAL', false, 'DEVELOPMENT', 'MOVE_TO_WORKSPACE', 'Biblioteca em Empreendimento; documento do lote no contexto'),
    L('Clientes / filtro', 'Favoritos', 'custTab=favorites / filtro', 'CONTEXTUAL', false, 'CUSTOMERS', 'MOVE_TO_CONTEXTUAL', 'Coleção/estado do usuário'),
    L('Comparar / Clientes / Favoritos', 'Apresentação guiada', 'pmStart', 'CONTEXTUAL', false, 'CUSTOMERS', 'MOVE_TO_CONTEXTUAL', 'Resultado de trabalho, não destino'),
    L('rodapé', 'Barra de comparação / FAB', 'view=compare', 'CONTEXTUAL', false, 'COMPARE', 'REVIEW', 'Bandeja no mapa: o item ativo continua MAP (§287)'),
    L('modal', 'Atalhos de teclado (?)', 'shortcutHelp', 'CONTEXTUAL', false, null, 'REVIEW', 'Também no menu "Mais" (desktop/tablet)')
  ]);
  /** legacy URL grammar — all still decoded by the topic-43 codec; nothing to redirect today */
  const LEGACY_ROUTES = freeze([
    freeze({ legacy: '#<dev>', target: 'MAP', redirect: false, notes: 'gramática v0 do roteador (tópicos 10/18/20/24), migrada sem perda pelo codec' }),
    freeze({ legacy: '#<dev>/lots/<lot>[/<seção>|/simular|/sol]', target: 'MAP (lote selecionado)', redirect: false, notes: 'Solar/Simular = painel contextual do lote (§264)' }),
    freeze({ legacy: '#<dev>/compare/<a>~<b>…', target: 'COMPARE', redirect: false, notes: '' }),
    freeze({ legacy: '#<dev>/presentation/<id>', target: 'PRESENTATION (fora do menu)', redirect: false, notes: '' }),
    freeze({ legacy: 'store.view = clients | development (sessão)', target: 'CUSTOMERS | DEVELOPMENT', redirect: false, notes: 'restaurado do estado de sessão, não da URL' })
  ]);

  return freeze({ WORKSPACES, NAV_ITEM_STATE, PRIMARY_PLACEMENTS, MOBILE_PLACEMENTS, DESKTOP_PLACEMENTS, LAYOUT_PROFILES, TOOL_PLACEMENTS, OFFLINE_STATES, EXPERIENCE_MODES, ACTION_PRIORITIES,
    PRESERVATION_KEYS, VIEWS, URL_ROUTE, ICON_IDS, MAX_PRIMARY, LEGACY_INVENTORY, LEGACY_ROUTES,
    manifest, t, items, item, itemOfView, workspace, contextualActions, headerTools, shortcuts, accessOf, offlineCapability, experienceMode, modePolicy,
    resolveItem, getPrimaryItems, visiblePrimaryItems, workspaceSections, contextualFor, placement, headerLayout, reachableControls, covers, validate, layoutOf });
})();
