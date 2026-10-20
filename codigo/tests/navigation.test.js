'use strict';
// Topic 53 — compact menu and navigation architecture. Golden scenarios named after §252 of the spec.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { load, SRC } = require('./harness.js');

const DEV = 'viva-juara', VJ = { developmentId: DEV }, ORG = 'org_house7';
const NAV_FILES = ['navigation/navigationRegistry.js', 'navigation/navigationService.js', 'navigation/menuView.js'];
const fresh = () => { const App = load(); for (const f of NAV_FILES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App); return App; };
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg);
let App, N, REG, SVC, ST, VIEW, repo;
test.before(async () => { App = fresh(); N = App.navigation; REG = N.registry; SVC = N.service; ST = N.state; VIEW = N.view; repo = App.repos.LotRepository(DEV); await repo.load(); });

const me = (o = {}) => ({ authenticated: true, principal: { type: 'USER', id: 'u1', displayName: 'Ana', status: 'ACTIVE', authenticationMethod: 'DEV_TOKEN' },
  organizationId: ORG, organization: { id: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE', developments: [{ id: DEV, visibility: 'PUBLIC' }] },
  memberships: [{ organizationId: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE' }], roles: ['BROKER'],
  roleAssignments: [{ role: 'BROKER', organizationId: ORG, developmentId: null }], permissions: [], developmentPermissions: {}, policyVersion: 'iam-2026-10-08.1', ...o });
/** authorization context for a role template — the menu only ever sees permissions, never the role code */
const asRole = roles => { const keys = [...new Set(roles.flatMap(r => App.permissions.grantsOf(r)))]; const r = App.authz.fromMe(me({ roles, permissions: keys }), { developmentId: DEV }); assert.ok(r.ok); return r.context; };
const ctxOf = (roles, o = {}) => ({ authz: App.authz, authContext: asRole(roles), resource: VJ, connectivity: 'ONLINE', ...o });
const prof = (w, h) => App.responsive.resolve({ viewportWidth: w, viewportHeight: h, pointerType: w < 1280 ? 'COARSE' : 'FINE' });
const DESKTOP = () => prof(1400, 900), MOBILE = () => prof(390, 844);
const base = (o = {}) => ({ ...App.store.INITIAL, activeMapLayer: 'availability', backgroundLayer: 'plan', ...o });
const stateOf = items => Object.fromEntries(items.map(i => [i.id, i.state]));
const idOf = code => repo.getLotByCode(code).identity.id;

// ====================================================================== contract (§243)
test('NavigationManifest is bundled and passes the navigation contract (routes, labels, order, icons, placements, permissions, codec routes)', () => {
  assert.ok(App.configs.navigation && App.configs.navigation.manifest, 'config/navigation/manifest.json bundled by configBundle');
  deq(REG.validate({ iconIds: Object.keys(VIEW.ICONS), codecRoutes: Object.keys(App.deeplink.codec.AppRouteCode) }), []);
  for (const id of REG.ICON_IDS) assert.ok(VIEW.ICONS[id], 'icon registry covers ' + id);
});
test('the contract catches broken manifests (duplicate order, unknown feature, label used as route, 6th item, missing workspace)', () => {
  const A2 = fresh(), m = A2.configs.navigation.manifest;
  m.primaryItems[1].order = 1; m.primaryItems[2].feature = 'nope.feature'; m.messages['nav.customers'] = 'CUSTOMERS';
  m.primaryItems.push({ ...m.primaryItems[0], id: 'SOLAR', order: 6 }); m.primaryItems = m.primaryItems.filter(i => i.id !== 'DEVELOPMENT');
  const codes = A2.navigation.registry.validate().map(e => e.code);
  for (const c of ['DUPLICATE_ORDER', 'UNKNOWN_FEATURE', 'LABEL_AS_ROUTE', 'UNKNOWN_WORKSPACE', 'UNREACHABLE_WORKSPACE', 'WORKSPACE_WITHOUT_ITEM']) assert.ok(codes.includes(c), c);
});
test('information architecture: exactly 5 task-oriented primary items in the work order; Map is the default; labels pt-BR via message keys', () => {
  const it = REG.items();
  deq(it.map(i => i.id), ['MAP', 'FIND', 'COMPARE', 'CUSTOMERS', 'DEVELOPMENT']);
  deq(it.map(i => REG.t(i.labelKey)), ['Mapa', 'Encontrar', 'Comparar', 'Clientes', 'Empreendimento']);
  assert.equal(it.find(i => i.isDefault).id, 'MAP');
  for (const i of it) assert.notEqual(REG.t(i.labelKey), i.routeCode, 'label is never the route code');
  // §18 / §354: tools are not promoted to the primary menu
  const prim = it.map(i => (i.id + ' ' + REG.t(i.labelKey)).toLowerCase()).join(' ');
  for (const w of ['solar', 'financ', 'score', 'ranking', 'proveni', 'alert', 'document', 'favorit', 'apresenta', 'admin', 'dashboard', 'home', 'mais']) assert.ok(!prim.includes(w), w + ' is not primary');
  for (const w of ['Solar / Sol no lote', 'Simular (financeiro)', 'Scores', 'Rankings / recomendações', 'Documentos', 'Favoritos', 'Apresentação guiada'])
    assert.notEqual(REG.LEGACY_INVENTORY.find(x => x.label === w).migrationAction, 'KEEP_PRIMARY', w);
});

// ====================================================================== permissions / entitlements (§30–32, §111–117, §248)
test('NavUnauthorizedCustomersHidden + permission matrix by role templates (resolved through permissions, not role codes)', () => {
  const B = stateOf(REG.getPrimaryItems(ctxOf(['BROKER']))), V = stateOf(REG.getPrimaryItems(ctxOf(['VIEWER']))), A = stateOf(REG.getPrimaryItems(ctxOf(['ANALYST'])));
  deq(B, { MAP: 'VISIBLE_ENABLED', FIND: 'VISIBLE_ENABLED', COMPARE: 'VISIBLE_ENABLED', CUSTOMERS: 'VISIBLE_ENABLED', DEVELOPMENT: 'VISIBLE_ENABLED' });
  assert.equal(V.CUSTOMERS, 'HIDDEN', 'viewer without customer_profile.manage: Clientes hidden'); assert.equal(A.CUSTOMERS, 'HIDDEN');
  for (const r of ['PRICING_MANAGER', 'INVENTORY_MANAGER', 'COMMERCIAL_MANAGER', 'OWNER_ADMIN']) assert.equal(REG.getPrimaryItems(ctxOf([r])).filter(i => i.state === 'VISIBLE_ENABLED').length, 5, r + ': five items, no admin item');
  // formal NavigationContext (permissions array) gives the same answer; lot.compare has deny:"disable" → visible with a reason
  const viewerKeys = App.permissions.grantsOf('VIEWER').filter(k => k !== 'lot.compare');
  const f = REG.getPrimaryItems({ permissions: viewerKeys }), cmp = f.find(i => i.id === 'COMPARE');
  assert.equal(cmp.state, 'VISIBLE_DISABLED'); assert.match(cmp.disabledReason.message, /comparar/); assert.equal(f.find(i => i.id === 'CUSTOMERS').state, 'HIDDEN');
  // no authority at all → deny by default
  assert.ok(REG.getPrimaryItems({}).every(i => i.state === 'HIDDEN'));
});
test('entitlement ≠ permission: an item needing an entitlement is hidden until the tenant has it (no ghost items §117)', () => {
  const it = { ...REG.item('FIND'), entitlement: 'recommendation_v2' };
  assert.equal(REG.resolveItem(it, ctxOf(['OWNER_ADMIN'])).state, 'HIDDEN');
  assert.equal(REG.resolveItem(it, ctxOf(['OWNER_ADMIN'], { entitlements: ['recommendation_v2'] })).state, 'VISIBLE_ENABLED');
  assert.equal(REG.resolveItem({ ...REG.item('MAP'), enabled: false }, ctxOf(['OWNER_ADMIN'])).state, 'HIDDEN');
});
test('NavAdminSectionsPermissionScoped: Empreendimento shows admin sections only with the permission; broker sees none; offline disables online-only', () => {
  const ids = (roles, o) => REG.workspaceSections('DEVELOPMENT', ctxOf(roles, o)).map(s => s.id);
  const basic = ['overview', 'documents', 'rules', 'commercial', 'data'];
  deq(ids(['BROKER']), basic);
  deq(ids(['PRICING_MANAGER']), [...basic, 'pricing']);
  deq(ids(['INVENTORY_MANAGER']), [...basic, 'availability'], 'availability.edit has deny:"disable" but admin sections are hidden when denied');
  deq(ids(['OWNER_ADMIN']), [...basic, 'analyses', 'availability', 'pricing', 'audit']);
  const off = REG.workspaceSections('DEVELOPMENT', ctxOf(['OWNER_ADMIN'], { connectivity: 'OFFLINE' }));
  assert.ok(off.filter(s => ['availability', 'pricing', 'audit', 'analyses'].includes(s.id)).every(s => s.state !== 'VISIBLE_ENABLED'), 'online-only admin sections not enabled offline');
  deq(REG.workspaceSections('CUSTOMERS', ctxOf(['BROKER'])).map(s => s.id), ['summary', 'journey', 'profile', 'favorites', 'comparisons', 'recommendations']);
});
test('workspace sections match the tabs the shell renders today (customerView.TABS) and contextual actions match the QuickView action list', () => {
  const tabs = [...fs.readFileSync(path.join(SRC, 'customer/customerView.js'), 'utf8').match(/TABS = Object\.freeze\(\[(.*?)\]\);/)[1].matchAll(/\['(\w+)'/g)].map(m => m[1]);
  deq(REG.workspace('CUSTOMERS').sections.map(s => s.id).sort(), tabs.slice().sort());
  const qv = [...fs.readFileSync(path.join(SRC, 'quickview/quickview.js'), 'utf8').matchAll(/\bA\('(\w+)'/g)].map(m => m[1]);
  deq(REG.contextualActions().map(a => a.id).sort(), qv.slice().sort(), 'every QuickView action has a ContextualActionDefinition');
  const g = REG.contextualFor('broker', ctxOf(['BROKER']));
  deq(g.PRIMARY.map(a => a.id), ['primary', 'details', 'compare', 'simulate']);
  assert.ok(g.SECONDARY.some(a => a.id === 'solar') && g.SECONDARY.some(a => a.id === 'favorite'), 'Solar and Favoritar are contextual');
  assert.ok(!REG.contextualFor('client', ctxOf(['BROKER'])).OVERFLOW.some(a => a.id === 'provenance'), 'technical provenance not offered in client mode');
  assert.ok(REG.contextualFor('technical', ctxOf(['BROKER'])).OVERFLOW.some(a => a.id === 'provenance'));
});

// ====================================================================== responsive placement (§70–89, §246)
test('NavBrokerMobileBottomNav / NavTabletPortraitBottomNav / NavTabletLandscapeRail / desktop: one registry, placement by responsive profile', () => {
  const cases = [[320, 640, 'MOBILE', 'BOTTOM_NAV'], [390, 844, 'MOBILE', 'BOTTOM_NAV'], [768, 1024, 'TABLET_PORTRAIT', 'BOTTOM_NAV'], [1024, 768, 'TABLET_LANDSCAPE', 'TOP_NAV'], [1200, 800, 'TABLET_LARGE', 'TOP_NAV'], [1400, 900, 'DESKTOP', 'TOP_NAV'], [1920, 1080, 'DESKTOP', 'TOP_NAV']];
  for (const [w, h, lp, pl] of cases) { const p = prof(w, h); assert.equal(p.layoutProfile, lp, `${w}x${h}`); assert.equal(REG.placement(p).primaryPlacement, pl, `${w}x${h}`); }
  // the same items in every container
  const ids = p => REG.visiblePrimaryItems(ctxOf(['BROKER'])).map(i => i.id) && SVC.viewModel(base(), { ...ctxOf(['BROKER']), profile: p }).items.map(i => i.id);
  deq(ids(MOBILE()), ids(DESKTOP()));
  // rail implemented but off by product decision; switching it on moves desktop/tablet-landscape to LEFT_RAIL
  const A2 = fresh(); A2.configs.navigation.manifest.density.railEnabled = true;
  assert.equal(A2.navigation.registry.placement(prof(1400, 900)).primaryPlacement, 'LEFT_RAIL');
  assert.equal(A2.navigation.registry.placement(prof(1024, 768)).primaryPlacement, 'LEFT_RAIL');
  assert.equal(A2.navigation.registry.placement(prof(390, 844)).primaryPlacement, 'BOTTOM_NAV');
  assert.equal(REG.placement(null).primaryPlacement, 'BOTTOM_NAV', 'broken profile falls back to a reachable bottom nav');
});
test('header overflow rules per profile: phones keep brand/development/search inline, the rest goes to "Mais"; desktop keeps mode/present/sync inline', () => {
  const m = REG.headerLayout('MOBILE'), d = REG.headerLayout('DESKTOP'), tl = REG.headerLayout('TABLET_LANDSCAPE');
  deq(m.inline, ['brand', 'development', 'search']); deq(m.overflow.sort(), ['access', 'mode', 'present', 'sync']); deq(m.none, ['shortcuts']); deq(m.hiddenUntilActive, ['customer']);
  deq(d.inline, ['brand', 'development', 'search', 'sync', 'mode', 'present']); deq(d.overflow.sort(), ['access', 'shortcuts']);
  assert.ok(tl.overflow.includes('sync') && tl.inline.includes('mode'));
  assert.ok(REG.headerLayout('MOBILE', { hasCustomer: true }).tools.find(t => t.id === 'customer').visible);
  assert.ok(!REG.headerLayout('MOBILE', { hasCustomer: false }).tools.find(t => t.id === 'customer').visible);
});

// ====================================================================== no feature loss (§352 43): everything reachable today stays reachable
/** header controls of the shell before topic 53 (frozen from src/presentation/shell.html, 2026-10-11) */
const LEGACY_HEADER = [
  { elementId: 'devSel' }, { act: 'view', variant: 'map' }, { act: 'view', variant: 'compare' }, { act: 'view', variant: 'clients' }, { act: 'view', variant: 'development' },
  { elementId: 'q' }, { elementId: 'secChip' }, { elementId: 'syncInd', act: 'view', variant: 'development' }, { elementId: 'custBtn', act: 'view', variant: 'clients' },
  { elementId: 'custClr', act: 'custClear', whenActive: true }, { act: 'mode', variant: 'broker' }, { act: 'mode', variant: 'client' }, { act: 'mode', variant: 'technical' }, { act: 'present' }
];
test('the frozen legacy inventory matches the old shell header while it is still there', () => {
  const shell = fs.readFileSync(path.join(SRC, 'presentation/shell.html'), 'utf8'), m = shell.match(/<header class="hd">([\s\S]*?)<\/header>/);
  if (!m) return; // already integrated: the fixture above is the record
  const h = m[1], found = [];
  for (const x of h.matchAll(/<(button|select|input|div)\b([^>]*)>/g)) {
    const a = x[2], g = k => (a.match(new RegExp(`${k}="([^"]*)"`)) || [])[1];
    if (g('data-act')) found.push(`${g('data-act')}:${g('data-v') || g('data-mode') || ''}`); else if (g('id') && ['devSel', 'q', 'secChip'].includes(g('id'))) found.push(g('id'));
  }
  const want = LEGACY_HEADER.map(c => c.act ? `${c.act}:${c.variant || ''}` : c.elementId);
  deq(found.slice().sort(), want.slice().sort());
});
test('no feature loss: every legacy header control stays reachable in every layout profile (with and without a customer), and every reachable control exists in the new markup', () => {
  const html = VIEW.headerHtml();
  for (const lp of REG.LAYOUT_PROFILES) for (const hasCustomer of [false, true]) {
    const reach = REG.reachableControls(lp, { ...ctxOf(['BROKER']), hasCustomer });
    for (const c of LEGACY_HEADER) assert.ok(REG.covers(c, reach), `${lp} customer=${hasCustomer}: ${JSON.stringify(c)} unreachable`);
    for (const r of reach) {
      if (r.elementId) assert.ok(html.includes(`id="${r.elementId}"`), `markup has #${r.elementId}`);
      else if (r.act === 'nav') assert.ok(html.includes(`data-act="nav" data-ws="${r.variant}"`), `markup has nav ${r.variant}`);
      else if (r.act === 'mode') assert.ok(html.includes(`data-act="mode" data-mode="${r.variant}"`));
      else if (r.act === 'present' || r.act === 'shortcutHelp' || r.act === 'custClear') assert.ok(html.includes(`data-act="${r.act}"`));
    }
  }
  // the legacy shell ids app.js depends on are all present exactly once
  for (const id of ['devSel', 'devSub', 'q', 'sugg', 'secChip', 'syncInd', 'custBtn', 'custClr']) assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
  assert.ok(/class="nav pnav"[\s\S]*class="cnt"/.test(html), '.nav .cnt kept (renderHeader compatibility)');
  // gains: mode Técnico, Apresentar and the access chip are now reachable on phones (they were CSS-hidden < 420 / < 700 / < 1440 px)
  const mob = REG.reachableControls('MOBILE', ctxOf(['BROKER']));
  for (const c of [{ act: 'mode', variant: 'technical' }, { act: 'present' }, { elementId: 'secChip' }]) assert.ok(REG.covers(c, mob));
  assert.ok(REG.reachableControls('MOBILE', ctxOf(['BROKER'])).some(r => r.act === 'nav' && r.variant === 'FIND'), 'Encontrar is a primary item');
});
test('feature-matrix integration: data-act="nav" variants map to the same features as the legacy data-act="view" (coordinator adds them to features.json)', () => {
  const v = App.configs.security.features.actions.view.variants;
  const want = { MAP: v.map, FIND: App.configs.security.features.actions.openFind, COMPARE: v.compare, CUSTOMERS: v.clients, DEVELOPMENT: v.development };
  for (const i of REG.items()) assert.equal(i.feature, want[i.id], i.id);
});

// ====================================================================== state, service, preservation (§39–44, §183–196, §245)
test('NavBrokerDesktopDefaultMap: initial state → MAP current, no badge, workspace derived from the route (no separate menu state)', () => {
  const vm = SVC.viewModel(base(), { ...ctxOf(['BROKER']), profile: DESKTOP() });
  assert.equal(vm.workspace, 'MAP'); deq(vm.items.filter(i => i.current).map(i => i.id), ['MAP']); assert.ok(vm.items.every(i => !i.badge)); assert.equal(vm.placement.primaryPlacement, 'TOP_NAV');
  deq(Object.keys(ST.derive(base(), DESKTOP())).sort(), ['customerId', 'developmentId', 'lotId', 'routeCode', 'sectionId', 'source', 'workspace'].sort());
  // contextual overlays keep MAP active (§286–288)
  assert.equal(ST.workspaceOf(base({ currentLotId: idOf('B79'), panel: 'details' }), DESKTOP()), 'MAP');
  assert.equal(ST.workspaceOf(base({ comparisonLotIds: [idOf('B79'), idOf('A1')] }), DESKTOP()), 'MAP', 'comparison tray on the map is not the Compare workspace');
  assert.equal(ST.workspaceOf(base({ drawerOpen: true }), MOBILE()), 'FIND'); assert.equal(ST.workspaceOf(base({ drawerOpen: true }), DESKTOP()), 'MAP');
});
test('NavCompareBadgeThree: badge = candidate count (none at 0; DRAFT 1; READY 2–4; BLOCKED > 4)', () => {
  const b = n => SVC.viewModel(base({ comparisonLotIds: Array.from({ length: n }, (_, i) => 'x' + i) }), { ...ctxOf(['BROKER']), profile: MOBILE() }).items.find(i => i.id === 'COMPARE').badge;
  assert.equal(b(0), null); assert.equal(b(1).status, 'DRAFT'); deq([b(3).count, b(3).status, b(3).label], [3, 'READY', '3 lotes na comparação']); assert.equal(b(5).status, 'BLOCKED');
  assert.ok(SVC.viewModel(base(), ctxOf(['BROKER'])).items.filter(i => i.id !== 'COMPARE').every(i => !i.badge), 'no noisy badges on other items');
});
const apply = (st, p) => ({ ...st, ...(p.patch || {}) });
const PRESERVED = ['developmentId', 'currentLotId', 'comparisonLotIds', 'activeFilters', 'activeMapLayer', 'mapViewport', 'currentCustomerId', 'panel', 'backgroundLayer'];
test('NavMapToComparePreservesSelection: map → compare → map keeps development, lot, comparison, filters, layer, camera and customer', () => {
  const st0 = base({ currentLotId: idOf('B79'), comparisonLotIds: [idOf('B79'), idOf('A1')], activeFilters: { areaMin: 300 }, activeMapLayer: 'noise', mapViewport: { centerX: 1, centerY: 2, zoom: 3 }, currentCustomerId: 'cust_1' });
  const p1 = SVC.plan('COMPARE', st0, { ...ctxOf(['BROKER']), profile: DESKTOP() }); assert.ok(p1.ok); deq(p1.patch, { view: 'compare' });
  const st1 = apply(st0, p1), p2 = SVC.plan('MAP', st1, { ...ctxOf(['BROKER']), profile: DESKTOP() }), st2 = apply(st1, p2);
  for (const k of PRESERVED) deq(st2[k], st0[k], k);
  assert.equal(ST.workspaceOf(st1, DESKTOP()), 'COMPARE'); assert.equal(ST.workspaceOf(st2, DESKTOP()), 'MAP');
  for (const p of [p1, p2]) assert.ok(Object.keys(p.patch || {}).every(k => SVC.NAV_KEYS.includes(k)), 'plans only write navigation keys');
  assert.equal(SVC.preservationPolicy().preserveComparison, true);
  // same workspace again: no-op, no history churn
  assert.equal(SVC.plan('MAP', st2, { ...ctxOf(['BROKER']), profile: DESKTOP() }).noop, true);
});
test('NavCustomerContextToFind: with a customer, Clientes → Encontrar → Mapa keeps the customer (opaque id) and the selection', () => {
  const st0 = base({ view: 'clients', currentCustomerId: 'cust_7', customers: [{ id: 'cust_7', name: 'Maria Souza', lots: [] }], currentLotId: idOf('A1') });
  const pf = SVC.plan('FIND', st0, { ...ctxOf(['BROKER']), profile: MOBILE() }); deq(pf.patch, { view: 'map', drawerOpen: true }); deq(pf.effects, ['FOCUS_FIND']);
  const st1 = apply(st0, pf); assert.equal(ST.workspaceOf(st1, MOBILE()), 'FIND');
  const st2 = apply(st1, SVC.plan('MAP', st1, { ...ctxOf(['BROKER']), profile: MOBILE() })); assert.equal(st2.drawerOpen, false); assert.equal(st2.currentCustomerId, 'cust_7'); assert.equal(st2.currentLotId, idOf('A1'));
  // docked profiles: Encontrar expands and focuses the docked panel; Map stays current, Find is flagged "open"
  const pd = SVC.plan('FIND', base({ leftCollapsed: true }), { ...ctxOf(['BROKER']), profile: DESKTOP() }); deq(pd.effects, ['EXPAND_FIND_PANEL', 'FOCUS_FIND']); assert.equal(pd.noop, false);
  const vm = SVC.viewModel(base({ leftCollapsed: false }), { ...ctxOf(['BROKER']), profile: DESKTOP() }); assert.ok(vm.items.find(i => i.id === 'FIND').open); assert.equal(vm.workspace, 'MAP');
  // no PII in the navigation state
  const ns = JSON.stringify(ST.derive(st1, MOBILE())); assert.ok(!/Maria|Souza/.test(ns)); assert.match(ns, /cust_7/);
  const gc = SVC.goToCustomer('cust_7', base(), ctxOf(['BROKER'])); assert.ok(gc.effects.includes('PICK_CUSTOMER')); deq(gc.patch, { view: 'clients' });
});
test('NavFindResultToMap: "Ver no mapa" goes to the lot inside the Map workspace (no full page)', () => {
  const st0 = base({ drawerOpen: true }), p = SVC.goToLot(idOf('B79'), st0, { ...ctxOf(['BROKER']), profile: MOBILE() });
  deq(p.patch, { drawerOpen: false, currentLotId: idOf('B79'), panel: 'quick' }); deq(p.effects, ['FOCUS_LOT']); assert.equal(ST.workspaceOf(apply(st0, p), MOBILE()), 'MAP');
});
test('NavDevelopmentSwitchClearsIncompatibleState / NavTenantSwitchClearsTenantState', () => {
  const st0 = base({ currentLotId: idOf('B79'), comparisonLotIds: [idOf('B79')], activeFilters: { block: 'B' }, currentCustomerId: 'cust_1', customers: [{ id: 'cust_1', name: 'X', lots: [] }], view: 'compare', presentationMode: 'technical', scoreKey: 'family' });
  const d = SVC.developmentSwitchPlan(st0, 'dev-2', { accessible: id => id === 'dev-2' });
  assert.ok(d.ok); assert.equal(d.landing, 'MAP');
  deq([d.patch.currentLotId, d.patch.comparisonLotIds, d.patch.activeFilters, d.patch.view, d.patch.developmentId], [null, [], {}, 'map', 'dev-2']);
  assert.ok(!('currentCustomerId' in d.patch) && !('presentationMode' in d.patch) && !('scoreKey' in d.patch), 'customer context and safe global prefs preserved');
  assert.equal(SVC.developmentSwitchPlan(st0, 'dev-x', { accessible: () => false }).ok, false, 'no access → refused, back to a safe selector');
  const t = SVC.tenantSwitchPlan(st0); deq([t.patch.currentCustomerId, t.patch.customers, t.patch.currentLotId], [null, [], null]); assert.equal(t.landing, 'MAP');
});
test('route guard: denied primary click stays and explains; deep link / history / permission change redirect safely to MAP; MAP denied → no loop', () => {
  const viewer = ctxOf(['VIEWER']), st = base({ view: 'clients' });
  const click = SVC.plan('CUSTOMERS', base(), { ...viewer, profile: DESKTOP() }); assert.equal(click.ok, false); assert.equal(click.patch, null); assert.equal(click.transition.status, 'DENIED');
  const link = SVC.plan('CUSTOMERS', base(), { ...viewer, profile: DESKTOP(), source: 'DEEP_LINK' }); assert.ok(link.ok); assert.equal(link.workspace, 'MAP'); assert.ok(link.redirected); assert.equal(link.transition.source, 'SYSTEM_REDIRECT');
  const re = SVC.onPermissionsChanged(st, { ...viewer, profile: DESKTOP() }); assert.ok(re && re.ok); deq(re.patch, { view: 'map' });
  assert.equal(SVC.onPermissionsChanged(st, { ...ctxOf(['BROKER']), profile: DESKTOP() }), null, 'still authorized: nothing to do');
  const none = SVC.plan('MAP', base(), { profile: DESKTOP(), source: 'DEEP_LINK' }); assert.equal(none.ok, false); assert.equal(none.decision.redirectRouteCode, undefined, 'no redirect loop');
  deq(SVC.routeAccess('COMPARE', ctxOf(['BROKER'])), { allowed: true });
  assert.equal(SVC.plan('ADMIN', base(), ctxOf(['OWNER_ADMIN'])).ok, false, 'unknown workspace');
  // observability fields carry route codes only
  deq(Object.keys(SVC.logFields(link.transition)).sort(), ['fromRouteCode', 'routeCode', 'status', 'transitionType']);
});
test('NavOfflineMapEnabled / NavOfflineCustomersOnlineRequired: offline states are explained, never shown as fully enabled', () => {
  const off = o => stateOf(REG.getPrimaryItems(ctxOf(['BROKER'], { connectivity: 'OFFLINE', ...o })));
  deq(off({ packAvailable: true }), { MAP: 'VISIBLE_ENABLED', FIND: 'VISIBLE_ENABLED', COMPARE: 'VISIBLE_ENABLED', CUSTOMERS: 'VISIBLE_ENABLED', DEVELOPMENT: 'VISIBLE_ENABLED' }, 'customers are device-local today → FULL');
  assert.equal(REG.offlineCapability('DEVELOPMENT', { connectivity: 'OFFLINE' }).state, 'LAST_KNOWN');
  assert.equal(off({ packAvailable: false }).MAP, 'VISIBLE_DISABLED');
  const c = REG.getPrimaryItems(ctxOf(['BROKER'], { connectivity: 'OFFLINE', deviceLocal: false })).find(i => i.id === 'CUSTOMERS');
  assert.equal(c.state, 'VISIBLE_DISABLED'); assert.equal(c.offline.state, 'ONLINE_REQUIRED'); assert.match(c.disabledReason.message, /conexão/);
  const p = SVC.plan('CUSTOMERS', base(), { ...ctxOf(['BROKER'], { connectivity: 'OFFLINE', deviceLocal: false }), profile: MOBILE() }); assert.equal(p.ok, false); assert.match(p.decision.message, /conexão/);
  assert.equal(REG.offlineCapability('CUSTOMERS', { connectivity: 'ONLINE', deviceLocal: false }).state, 'FULL');
});
test('NavDeepLinkLotSelection / NavBackForwardRestoresWorkspace: the topic-43 codec is the only URL serializer; the workspace follows the restored state', () => {
  const C = App.deeplink.codec, RS = App.deeplink.restoration, SV = App.deeplink.service, dev = App.repos.DevelopmentRepository.getDevelopmentConfig(DEV);
  const deps = { currentDevelopmentId: DEV, developmentExists: id => !!App.repos.DevelopmentRepository.getDevelopment(id), resolveLot: r => repo.resolve(r), mapBounds: dev.map, detailSections: (dev.presentation.detailSections || []).map(s => s.id), authorize: () => false };
  const codeOf = id => repo.getLotById(id).identity.code;
  const roundTrip = st => { const e = C.encode(SV.extract(st, { codeOf })); assert.ok(e.ok); const d = C.decode(e.hash); const r = RS.restore(d.envelope, deps); return { ...base(), ...r.finalAppStatePatch }; };
  const lot = roundTrip(base({ currentLotId: idOf('B79') })); assert.equal(lot.currentLotId, idOf('B79')); assert.equal(ST.workspaceOf(lot, MOBILE()), 'MAP'); assert.equal(ST.derive(lot, MOBILE()).lotId, idOf('B79'));
  const cmp = roundTrip(base({ view: 'compare', comparisonLotIds: [idOf('B79'), idOf('A1')] })); assert.equal(ST.workspaceOf(cmp, DESKTOP()), 'COMPARE');
  const map = roundTrip(base()); assert.equal(ST.workspaceOf(map, DESKTOP()), 'MAP');
  for (const i of REG.items()) assert.ok(App.deeplink.codec.AppRouteCode[REG.URL_ROUTE[i.id]], i.id + ' has a codec route code');
  assert.equal(ST.urlRouteOf(base({ currentLotId: 'x' })), 'LOT');
});
test('PWA launch: last route restored only while still valid (authorized, development accessible); otherwise MAP', () => {
  assert.equal(SVC.lastRouteRestore(base({ view: 'clients' }), { ...ctxOf(['BROKER']), profile: DESKTOP() }), 'CUSTOMERS');
  assert.equal(SVC.lastRouteRestore(base({ view: 'clients' }), { ...ctxOf(['VIEWER']), profile: DESKTOP() }), 'MAP');
  assert.equal(SVC.lastRouteRestore(base({ view: 'compare', developmentId: 'gone' }), { ...ctxOf(['BROKER']), profile: DESKTOP(), developmentAccessible: () => false }), 'MAP');
  assert.equal(SVC.lastRouteRestore(null, {}), 'MAP');
  assert.equal(SVC.needsConfirm({ hasUnsavedChanges: true, canAutoSave: false }), true); assert.equal(SVC.needsConfirm({ hasUnsavedChanges: false }), false); assert.equal(SVC.needsConfirm({ hasUnsavedChanges: true, canAutoSave: true }), false);
});
test('NavPresentationModeReducedNavigation / NavSharedRuntimeNoInternalNavigation / client & technical modes keep the five items', () => {
  const vm = SVC.viewModel(base({ presentationView: true }), { ...ctxOf(['BROKER']), profile: DESKTOP() });
  assert.equal(vm.mode, 'PRESENTATION'); assert.equal(vm.visible, false); assert.ok(vm.items.every(i => i.state === 'HIDDEN'));
  const sh = SVC.viewModel(base(), { ...ctxOf(['BROKER']), profile: MOBILE(), shared: true }); assert.equal(sh.mode, 'SHARED'); assert.equal(sh.visible, false);
  assert.ok(!/pnav|data-act="nav"/.test(fs.readFileSync(path.join(SRC, 'share/sharedShellView.js'), 'utf8')), 'the shared shell has no internal menu');
  for (const m of ['client', 'technical']) assert.equal(SVC.viewModel(base({ presentationMode: m }), ctxOf(['BROKER'])).items.filter(i => i.state === 'VISIBLE_ENABLED').length, 5, m + ' mode does not alter the primary nav (§214)');
});
test('NavKeyboardPrimaryNavigation: G-sequences (g m, g e, g 3, g c, g 5), never while typing, with modifiers or after the timeout', () => {
  let t = 0; const M = N.shortcuts.createSequenceMatcher({ now: () => t, timeoutMs: 1000 });
  const k = (key, o = {}) => M.handle({ key, target: o.target || { tagName: 'BODY' }, ...o });
  const seq = (a, b) => { k(a); return k(b); };
  deq([seq('g', 'm').target, seq('g', 'e').target, seq('g', '3').target, seq('g', 'c').target, seq('g', '4').target, seq('g', '5').target, seq('g', '1').target], ['MAP', 'FIND', 'COMPARE', 'CUSTOMERS', 'CUSTOMERS', 'DEVELOPMENT', 'MAP']);
  assert.equal(k('g').state, 'ARMED'); t += 1500; assert.equal(k('m').state, null, 'timeout'); t = 0;
  k('g'); assert.equal(k('c', { target: { tagName: 'INPUT' } }).state, null, 'never while typing');
  k('g'); assert.equal(k('c', { ctrlKey: true }).state, null, 'never with modifiers');
  assert.equal(k('m').state, null, 'a bare m is left to the topic-22 registry');
  assert.equal(N.shortcuts.list().length, 5);
  // the single-key registry (topic 22) does not use g, and ignores events the sequence handler preventDefault()s
  assert.ok(!App.shortcuts.REGISTRY.some(s => s.key === 'g'));
  assert.equal(App.shortcuts.match({ key: 'm', defaultPrevented: true, target: { tagName: 'BODY' } }, { family: 'DESKTOP' }), null);
});
test('NavScreenReaderActiveItem: landmark, aria-current target, decorative icons, full accessible labels, touch-sized targets declared', () => {
  const html = VIEW.headerHtml();
  assert.match(html, /<nav class="nav pnav" id="pnav" aria-label="Navegação principal">/);
  assert.equal((html.match(/data-act="nav" data-ws="/g) || []).length, 6, '5 items + brand link to the default workspace');
  for (const svg of html.match(/<svg[^>]*>/g)) assert.match(svg, /aria-hidden="true"/);
  assert.match(html, /<span class="nfull">Empreendimento<\/span><span class="nshort" aria-hidden="true">Empreend\.<\/span>/, 'the short label is visual only');
  assert.match(html, /class="brand"[^>]*aria-label="Ir para o mapa"/);
  assert.match(html, /class="nmorebtn" aria-expanded="false" aria-controls="navMore"/);
  assert.ok(!/aria-current/.test(html), 'aria-current is set at runtime from the derived workspace only');
  const css = fs.readFileSync(path.join(SRC, 'presentation/navigation.css'), 'utf8');
  assert.match(css, /aria-current=page\]::after/, 'active state is not colour-only'); assert.match(css, /safe-area-inset-bottom/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:48px/, 'bottom nav targets ≥ 48 px');
});
test('navigation.css is inert until the compact header is in the shell (every rule is scoped)', () => {
  const css = fs.readFileSync(path.join(SRC, 'presentation/navigation.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const sels = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m => m[1].trim()).filter(s => s && !s.startsWith('@'));
  assert.ok(sels.length > 30);
  for (const s of sels) for (const part of s.split(',')) assert.ok(/\.cnav|html\[data-nav/.test(part), 'unscoped selector: ' + part);
});
test('scripts/navHeader.js prints the header and its --check accepts the shell (old header until integration, or an identical compact header)', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'navHeader.js')], { encoding: 'utf8' });
  assert.equal(out.trim(), VIEW.headerHtml().trim());
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'navHeader.js'), '--check'], { encoding: 'utf8' });
});
test('the reachability check has teeth: dropping an item or hiding a tool makes a legacy control unreachable', () => {
  const A2 = fresh(), R2 = A2.navigation.registry, m = A2.configs.navigation.manifest, c = { authz: A2.authz, resource: VJ };
  m.headerTools.find(t => t.id === 'mode').placement.MOBILE = 'NONE';
  m.primaryItems = m.primaryItems.filter(i => i.id !== 'DEVELOPMENT');
  const reach = R2.reachableControls('MOBILE', c);
  assert.equal(R2.covers({ act: 'mode', variant: 'broker' }, reach), false);
  assert.equal(R2.covers({ act: 'view', variant: 'development' }, reach), false, 'the conditional sync indicator is not a route to Empreendimento');
  assert.equal(R2.covers({ act: 'view', variant: 'development' }, R2.reachableControls('DESKTOP', c)), false);
});
