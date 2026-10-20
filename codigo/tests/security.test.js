'use strict';
// Topics 30 (users, permissions, authorization) and 31 (multi-tenant isolation) — frontend side.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

const VJ = { developmentId: 'viva-juara' };
const ORG = 'org_house7', ORG_B = 'org_imobx';
const fresh = (env) => { const App = load(); if (env) App.buildEnv = env; return App; };
/** registers a second organization (B) with its own development 'dev-b', as the server would teach it */
const withOrgB = App => App.tenancy.learnFromServer({ organizations: [{ id: ORG_B, slug: 'imob-x', displayName: 'Imobiliária X', status: 'ACTIVE' }],
  developmentOwners: { 'dev-b': ORG_B }, developmentVisibility: { 'dev-b': 'PRIVATE' } });
const me = (o = {}) => ({ authenticated: true, principal: { type: 'USER', id: 'u1', displayName: 'Ana', status: 'ACTIVE', authenticationMethod: 'DEV_TOKEN' },
  organizationId: ORG, organization: { id: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE', developments: [{ id: 'viva-juara', visibility: 'PUBLIC' }] },
  memberships: [{ organizationId: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE' }], roles: ['BROKER'],
  roleAssignments: [{ role: 'BROKER', organizationId: ORG, developmentId: null }], permissions: [], developmentPermissions: {}, policyVersion: 'iam-2026-10-08.1', ...o });
const asRole = (App, roles, extra = {}) => { const keys = [...new Set(roles.flatMap(r => App.permissions.grantsOf(r)))]; const r = App.authz.fromMe(me({ roles, permissions: keys, ...extra }), { developmentId: 'viva-juara' }); assert.ok(r.ok, JSON.stringify(r.errors)); return r.context; };
const ev = (App, ctx, permission, resource = VJ, context = {}) => App.authz.evaluate(ctx, { permission, resource, context: { connectivity: 'ONLINE', ...context } });
const clone = x => JSON.parse(JSON.stringify(x));
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// ------------------------------------------------------------ registry
test('permission registry, role templates and feature matrix validate (no typos, no unknown grants)', () => {
  const App = fresh();
  assert.deepEqual(clone(App.permissions.validate()), []);
  assert.ok(App.configs.security && App.configs.security.permissions && App.configs.security.roles && App.configs.security.features && App.configs.security.organizations);
  assert.equal(App.permissions.KEYS.LOT_PRICE_VIEW, 'lot.price.view');
  assert.throws(() => App.permissions.assertKnown('lot.prices.view'), /desconhecida/);
  assert.equal(App.permissions.riskOf('price_table.publish'), 'CRITICAL');
  assert.equal(App.permissions.riskOf('availability.write'), 'HIGH');
  for (const p of App.permissions.list()) if (p.anonymousAllowed) assert.ok(['LOW', 'MEDIUM'].includes(p.riskLevel), p.key);
  assert.ok(!App.permissions.roles().some(r => r.grants.includes('platform.cross_tenant')), 'platform permission never in a tenant role');
});
test('unknown permission is always denied', () => {
  const App = fresh(), d = App.authz.guard('lot.delete_everything', VJ);
  assert.equal(d.allowed, false); assert.equal(d.reason, 'UNKNOWN_PERMISSION');
});

// ------------------------------------------------------------ static public (visitor) context = today's panel
test('no server context → anonymous public visitor of House 7 / viva-juara, read-only', () => {
  const App = fresh(), A = App.authz, ctx = A.context();
  assert.equal(ctx.source, 'STATIC_PUBLIC'); assert.equal(ctx.principal.type, 'ANONYMOUS');
  assert.equal(ctx.tenant.organizationId, ORG); assert.equal(ctx.tenant.resolvedBy, 'PUBLIC_DEVELOPMENT');
  for (const k of ['development.view', 'lot.view', 'lot.price.view', 'lot.price_history.view', 'lot.availability.view', 'lot.analysis.view', 'lot.compare', 'lot.simulate', 'share.create', 'customer_profile.manage'])
    assert.ok(A.can(k, VJ), k);
  for (const k of ['availability.write', 'price_table.publish', 'analysis.preview', 'admin.audit.view']) assert.equal(A.guard(k, VJ).reason, 'AUTH_REQUIRED', k);
  assert.equal(A.guard('platform.cross_tenant').reason, 'PLATFORM_ONLY');
});
test('every existing panel action has a permission contract and stays allowed for the visitor (no regression)', () => {
  const App = fresh(), A = App.authz;
  const acts = new Set();
  const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|html)$/.test(f)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/data-act=\\?["']?([a-zA-Z][a-zA-Z-]*)/g)) acts.add(m[1]); } };
  walk(SRC);
  const app = fs.readFileSync(path.join(SRC, 'presentation/app.js'), 'utf8'), sw = app.indexOf('switch (act)');
  if (sw >= 0) for (const m of app.slice(sw, app.indexOf('\n  });', sw)).matchAll(/case '([a-zA-Z][a-zA-Z-]*)'/g)) acts.add(m[1]);
  assert.ok(acts.size > 40);
  const DS = { mode: 'broker', v: 'map', p: 'details', a: 'DETAILS' };
  assert.equal(A.action('view', { v: 'clients' }).id, 'customer.profile');
  const unmapped = [...acts].filter(a => A.action(a, DS).reason === 'UNMAPPED_ACTION');
  assert.deepEqual(unmapped, [], `add these data-act values to config/security/features.json (actions or uiOnlyActions): ${unmapped.join(', ')}`);
  // topic 33: resolving a provenance conflict needs provenance.resolveConflict (server role); the visitor is denied by design
  // topics 57/58/60/63: admin, deal, onboarding and Entorno actions need server permissions no role holds yet
  const DENIED_BY_DESIGN = ['prov-resolve', 'boOpen', 'boExitSupport', 'boNav', 'boOpenItem', 'boRefresh', 'boAction', 'boPreview', 'boCancel', 'boConfirm',
    'dealOpenProposal', 'dealOpenReservation', 'dealOpenClosing', 'dealRefresh', 'onboarding-publish', 'envPlace', 'envRoute', 'envOpenMaps'];
  for (const a of DENIED_BY_DESIGN) assert.equal(A.action(a, { mode: 'technical' }, VJ).allowed, false, a);
  for (const a of acts) if (!DENIED_BY_DESIGN.includes(a)) assert.ok(A.action(a, { mode: 'technical', v: 'compare', p: 'simulation', a: 'SIMULATE' }, VJ).allowed, a);
  for (const m of ['broker', 'client', 'technical', 'presentation']) assert.ok(A.uiMode(m, VJ).allowed, m);
  assert.equal(A.action('totallyNewAction').allowed, false);
});
test('localStorage, URL hash, store state and DOM never grant a permission; security modules never read them', () => {
  const vm = require('vm'), store = {};
  const ctx = { console, Intl, Date, Math, JSON, Map, Set, Promise, queueMicrotask, setTimeout, clearTimeout, AbortController, structuredClone, TextEncoder,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { hash: '#role=OWNER_ADMIN&permissions=availability.write,price_table.publish' }, history: { replaceState() {} }, fetch: async () => ({ ok: false, status: 404 }) };
  for (const k of ['role', 'roles', 'permissions', 'authz', 'user', 'ws:viva-juara:state']) store[k] = JSON.stringify({ role: 'OWNER_ADMIN', permissions: ['availability.write', 'price_table.publish'], presentationMode: 'technical' });
  ctx.window = ctx; vm.createContext(ctx);
  const { ORDER } = require('./harness.js');
  for (const f of ORDER) { const p = path.join(SRC, f); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx); if (f === 'prelude.js') vm.runInContext(require('../scripts/configBundle.js').bundle(), ctx); }
  const App = ctx.App;
  App.store.set({ presentationMode: 'technical', role: 'OWNER_ADMIN', permissions: ['availability.write'] });
  for (const k of ['availability.write', 'price_table.publish', 'admin.audit.view']) assert.equal(App.authz.guard(k, VJ, { connectivity: 'ONLINE' }).reason, 'AUTH_REQUIRED', k);
  assert.equal(App.authz.context().source, 'STATIC_PUBLIC');
  for (const f of ['security/organization.js', 'security/permissions.js', 'security/authorization.js', 'presentation/securityView.js']) {
    const code = stripComments(fs.readFileSync(path.join(SRC, f), 'utf8'));
    for (const bad of ['localStorage', 'sessionStorage', 'location', 'document.cookie', 'indexedDB', 'eval(', 'new Function']) assert.ok(!code.includes(bad), `${f} uses ${bad}`);
  }
});
test('no direct role checks in presentation components', () => {
  for (const f of fs.readdirSync(path.join(SRC, 'presentation')).filter(f => f.endsWith('.js'))) {
    const code = stripComments(fs.readFileSync(path.join(SRC, 'presentation', f), 'utf8'));
    assert.ok(!/\brole\s*===|\.roles\.includes\(|===\s*['"](ADMIN|OWNER_ADMIN|BROKER|PRICING_MANAGER|INVENTORY_MANAGER)['"]/.test(code), f);
  }
});

// ------------------------------------------------------------ golden scenarios (topic 30)
test('BrokerReadOnlyCommercial / BrokerCannotPublishPricing', () => {
  const App = fresh(), b = asRole(App, ['BROKER']);
  for (const k of ['lot.view', 'lot.price.view', 'lot.compare', 'lot.simulate', 'share.create']) assert.ok(ev(App, b, k).allowed, k);
  assert.equal(ev(App, b, 'price_table.publish').reason, 'NO_GRANT');
  assert.equal(ev(App, b, 'availability.write').reason, 'NO_GRANT');
});
test('PricingManagerPublishesVersion: allowed online with audit + reason obligations; OfflineCriticalWriteDenied', () => {
  const App = fresh(), pm = asRole(App, ['PRICING_MANAGER']);
  const d = ev(App, pm, 'price_table.publish');
  assert.equal(d.effect, 'ALLOW'); assert.equal(d.authoritative, false);
  assert.ok(d.obligations.includes('writeAuditEvent') && d.obligations.includes('requireReason') && d.obligations.includes('revalidateResourceState'));
  assert.ok(!ev(App, pm, 'price_table.publish', VJ, { reasonProvided: true }).obligations.includes('requireReason'));
  for (const c of ['OFFLINE', 'UNKNOWN', 'DEGRADED']) assert.equal(ev(App, pm, 'price_table.publish', VJ, { connectivity: c }).reason, 'OFFLINE', c);
  assert.ok(ev(App, pm, 'lot.view', VJ, { connectivity: 'OFFLINE' }).allowed, 'offline read stays allowed');
  assert.equal(ev(App, pm, 'availability.write').reason, 'NO_GRANT', 'pricing manager does not change availability');
});
test('InventoryManagerUpdatesAvailability / AvailabilityCapabilityAndPermission (two-layer decision)', () => {
  const App = fresh(), im = asRole(App, ['INVENTORY_MANAGER']);
  assert.ok(ev(App, im, 'availability.write').allowed);
  assert.equal(ev(App, im, 'availability.write', VJ, { domainCapability: false }).reason, 'DOMAIN_CAPABILITY_FALSE');
  assert.equal(App.authz.finalAction(true, ev(App, im, 'availability.write')), true);
  assert.equal(App.authz.finalAction(false, ev(App, im, 'availability.write')), false);
  assert.equal(App.authz.finalAction(true, ev(App, asRole(App, ['BROKER']), 'availability.write')), false);
  assert.equal(ev(App, im, 'price_table.publish').reason, 'NO_GRANT');
});
test('ViewerReadOnly / MarketingCannotManageCustomerProfile', () => {
  const App = fresh(), v = asRole(App, ['VIEWER']), mk = asRole(App, ['MARKETING']);
  assert.ok(ev(App, v, 'lot.view').allowed); assert.equal(ev(App, v, 'share.create').reason, 'NO_GRANT');
  assert.equal(ev(App, mk, 'customer_profile.manage').reason, 'NO_GRANT');
  assert.ok(ev(App, mk, 'share.create').allowed);
});
test('SuspendedUserDenied, no assignment = deny, revoked session', () => {
  const App = fresh();
  const s = App.authz.fromMe(me({ principal: { type: 'USER', id: 'u1', status: 'SUSPENDED' }, permissions: App.permissions.grantsOf('OWNER_ADMIN') }), { developmentId: 'viva-juara' }).context;
  assert.equal(ev(App, s, 'lot.view').reason, 'PRINCIPAL_INACTIVE');
  const none = App.authz.fromMe(me({ roles: [], permissions: [] }), { developmentId: 'viva-juara' }).context;
  assert.equal(ev(App, none, 'lot.view').reason, 'NO_GRANT');
  const rev = App.authz.fromMe(me({ permissions: ['lot.view'], session: { status: 'REVOKED' } })).context;
  assert.equal(ev(App, rev, 'lot.view').reason, 'SESSION_REVOKED');
});
test('session expiry: protected action denied, public reads continue (not data-destructive)', () => {
  const App = fresh(), t0 = Date.parse('2026-10-08T12:00:00Z');
  const c = App.authz.fromMe(me({ permissions: App.permissions.grantsOf('OWNER_ADMIN'), session: { status: 'ACTIVE', expiresAt: '2026-10-08T12:30:00Z' } }), { now: t0 }).context;
  assert.ok(ev(App, c, 'availability.write', VJ, { now: t0 }).allowed);
  const later = t0 + 3600e3;
  assert.equal(ev(App, c, 'availability.write', VJ, { now: later }).reason, 'SESSION_EXPIRED');
  assert.ok(ev(App, c, 'lot.price.view', VJ, { now: later }).allowed);
  assert.equal(App.authz.viewModel({ context: c, now: later }).sessionState, 'EXPIRED');
});
test('stale access context (policy revision TTL) blocks HIGH/CRITICAL until revalidated', () => {
  const App = fresh(), t0 = Date.parse('2026-10-08T12:00:00Z');
  const c = App.authz.fromMe(me({ permissions: App.permissions.grantsOf('OWNER_ADMIN') }), { now: t0, ttlMs: 60e3 }).context;
  assert.equal(ev(App, c, 'price_table.publish', VJ, { now: t0 + 120e3 }).reason, 'CONTEXT_STALE');
  assert.ok(ev(App, c, 'lot.view', VJ, { now: t0 + 120e3 }).allowed);
});
test('WrongDevelopmentDenied: development-scoped grant does not reach another development of the same org', () => {
  const App = fresh();
  App.tenancy.learnFromServer({ organizations: [], developmentOwners: { 'outro-dev': ORG } });
  const c = App.authz.fromMe(me({ permissions: [], developmentPermissions: { 'viva-juara': ['lot.view', 'availability.write'] } })).context;
  App.tenancy.learnFromServer({ organizations: [], developmentOwners: { 'outro-dev': ORG, 'viva-juara': ORG } });
  assert.ok(ev(App, c, 'availability.write').allowed);
  assert.equal(ev(App, c, 'availability.write', { developmentId: 'outro-dev' }).reason, 'OUT_OF_SCOPE');
});
test('role revoked / policy revision change: new context drops the permission immediately', () => {
  const App = fresh(), A = App.authz;
  A.setContext(asRole(App, ['INVENTORY_MANAGER']));
  assert.ok(A.can('availability.write', VJ, { connectivity: 'ONLINE' }));
  A.setContext(asRole(App, ['BROKER'], { policyVersion: 'iam-2026-10-08.2' }));
  assert.equal(A.can('availability.write', VJ, { connectivity: 'ONLINE' }), false);
  A.reset();
  assert.equal(A.context().source, 'STATIC_PUBLIC');
});
test('step-up hook for CRITICAL actions (future MFA) and REQUIRES_STEP_UP effect', () => {
  const App = fresh(), pm = asRole(App, ['PRICING_MANAGER']);
  const d = ev(App, pm, 'price_table.publish', VJ, { stepUpForCritical: true });
  assert.equal(d.effect, 'REQUIRES_STEP_UP'); assert.equal(d.allowed, false);
});
test('DevIdentityProvider cannot run in production (default build) and works in test', () => {
  const prod = fresh();
  assert.equal(prod.authz.environment(), 'production');
  assert.throws(() => prod.authz.DevIdentityProvider(), /produção/);
  assert.ok(prod.authz.securityEvents().some(e => e.type === 'DEV_AUTH_BLOCKED'));
  const App = fresh('test'), dev = App.authz.DevIdentityProvider();
  const r = dev.signIn({ userId: 'u9', organizationId: ORG, roles: ['INVENTORY_MANAGER'] });
  assert.ok(r.ok); assert.equal(App.authz.context().source, 'DEV');
  assert.ok(App.authz.can('availability.write', VJ, { connectivity: 'ONLINE' }));
  App.buildEnv = 'production';
  assert.throws(() => dev.signIn({ organizationId: ORG, roles: ['OWNER_ADMIN'] }), /produção/);
  dev.signOut(); assert.equal(App.authz.context().source, 'STATIC_PUBLIC');
});
test('RoleAssignmentPolicy: no self-escalation, no privilege escalation, fails closed without a registered manage permission', () => {
  const App = fresh(), b = asRole(App, ['BROKER']), owner = asRole(App, ['OWNER_ADMIN']);
  assert.equal(App.authz.canAssign({ targetUserId: 'u1', roleCode: 'OWNER_ADMIN', organizationId: ORG }, { context: b }).reason, 'SELF_ESCALATION');
  assert.equal(App.authz.canAssign({ targetUserId: 'u2', roleCode: 'PRICING_MANAGER', organizationId: ORG }, { context: b }).reason, 'PRIVILEGE_ESCALATION');
  assert.equal(App.authz.canAssign({ targetUserId: 'u2', roleCode: 'BROKER', organizationId: ORG }, { context: owner }).reason, 'ASSIGNMENT_MANAGE_NOT_REGISTERED');
  assert.equal(App.authz.canAssign({ targetUserId: 'u2', roleCode: 'PUBLIC_VISITOR', organizationId: ORG }, { context: owner }).allowed, false);
});

// ------------------------------------------------------------ /me contract + refresh
test('fromMe validates the server contract strictly', () => {
  const App = fresh(), A = App.authz;
  assert.equal(A.fromMe(null).ok, false);
  assert.equal(A.fromMe({ authenticated: true, principal: { type: 'ROOT', id: 'x' }, permissions: [] }).ok, false);
  assert.equal(A.fromMe({ authenticated: true, principal: { type: 'USER' }, permissions: [] }).ok, false);
  const r = A.fromMe(me({ permissions: ['lot.view', 'lot.teleport', 'platform.cross_tenant'] }));
  assert.ok(r.ok); assert.ok(r.warnings.includes('UNKNOWN_PERMISSION_DROPPED:lot.teleport')); assert.ok(r.warnings.includes('SYSTEM_PERMISSION_DROPPED:platform.cross_tenant'));
  assert.deepEqual(clone(r.context.grants.map(g => g.key)), ['lot.view']);
  const anon = A.fromMe({ authenticated: false, principal: { type: 'ANONYMOUS', id: null }, organizationId: null, organization: null, memberships: [], roles: [], permissions: ['lot.view', 'lot.price.view', 'availability.write'] }, { developmentId: 'viva-juara' });
  assert.ok(anon.ok); assert.equal(anon.context.principal.type, 'ANONYMOUS');
  assert.deepEqual(clone([...new Set(anon.context.grants.map(g => g.key))].sort()), ['lot.price.view', 'lot.view'], 'anonymous ∩ PUBLIC_VISITOR; never a write');
  const notMember = A.fromMe(me({ memberships: [], permissions: ['lot.view'] }));
  assert.ok(notMember.warnings.some(w => w.startsWith('TENANT_REJECTED:NO_MEMBERSHIP'))); assert.equal(notMember.context.grants.length, 0);
});
test('refresh(): GET /me with cookie credentials, ETag, X-Organization-Id; 401 → visitor; no baseUrl → static', async () => {
  const App = fresh(), A = App.authz, calls = [];
  const reply = (status, body, etag) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: k => k === 'ETag' ? etag : null } });
  let next = reply(200, me({ permissions: App.permissions.grantsOf('INVENTORY_MANAGER') }), 'W/"r1"');
  const f = async (url, init) => { calls.push({ url, init }); return next; };
  assert.equal((await A.refresh({ baseUrl: null })).reason, 'STATIC_PUBLIC');
  const r = await A.refresh({ baseUrl: 'https://api.example/api/v1/', fetch: f });
  assert.ok(r.ok); assert.equal(A.context().source, 'SERVER'); assert.equal(A.context().etag, 'W/"r1"');
  assert.equal(calls[0].url, 'https://api.example/api/v1/me'); assert.equal(calls[0].init.credentials, 'include');
  assert.ok(!('Authorization' in calls[0].init.headers), 'the SPA never holds a bearer token');
  next = reply(304, null);
  assert.equal((await A.refresh({ baseUrl: 'https://api.example/api/v1', fetch: f })).status, 304);
  assert.equal(calls[1].init.headers['If-None-Match'], 'W/"r1"'); assert.equal(calls[1].init.headers['X-Organization-Id'], ORG);
  assert.ok(A.can('availability.write', VJ, { connectivity: 'ONLINE' }));
  next = reply(401, { code: 'UNAUTHORIZED' });
  const u = await A.refresh({ baseUrl: 'https://api.example/api/v1', fetch: f });
  assert.equal(u.reason, 'SESSION_EXPIRED'); assert.equal(A.context().source, 'STATIC_PUBLIC');
  assert.equal(A.can('availability.write', VJ, { connectivity: 'ONLINE' }), false);
  const net = await A.refresh({ baseUrl: 'https://api.example/api/v1', fetch: async () => { throw new Error('down'); } });
  assert.equal(net.reason, 'NETWORK_ERROR');
  next = reply(200, { hello: 'world' });
  assert.equal((await A.refresh({ baseUrl: 'https://api.example/api/v1', fetch: f })).reason, 'CONTEXT_REJECTED');
});

// ------------------------------------------------------------ multi-tenant (topic 31)
test('baseline organization: House 7 operates viva-juara; legacy tenant id maps; ambiguity fails closed', () => {
  const App = fresh(), T = App.tenancy;
  assert.equal(T.organizationOfDevelopment('viva-juara'), ORG);
  assert.equal(T.canonicalOrgId('house7'), ORG);
  assert.equal(T.getOrganization(ORG).displayName, 'House 7 Imóveis');
  assert.equal(T.organizationOfDevelopment('nao-existe'), null);
  const lot = { identity: { id: 'VJ-QA-L0001', developmentId: 'viva-juara' } };
  assert.equal(T.resolveOrganizationId(lot).organizationId, ORG);
  assert.equal(T.resolveOrganizationId({ id: 'VJ-QA-L0001' }).organizationId, null, 'an id alone is never ownership');
  assert.equal(T.resolveOrganizationId({ organizationId: ORG_B, developmentId: 'viva-juara' }).conflict, true);
});
test('TenantResolver: explicit tenant, no first-organization fallback, membership required, status policy', () => {
  const App = fresh(), T = App.tenancy; withOrgB(App);
  assert.equal(T.resolveTenant({ principalType: 'USER', principalId: 'u1' }).reason, 'TENANT_UNRESOLVED');
  assert.equal(T.resolveTenant({ candidate: 'x y', principalType: 'USER' }).reason, 'TENANT_INVALID');
  assert.equal(T.resolveTenant({ candidate: 'org_nope', principalType: 'USER' }).reason, 'TENANT_NOT_FOUND');
  assert.equal(T.resolveTenant({ candidate: ORG_B, principalType: 'USER', memberships: [{ organizationId: ORG, status: 'ACTIVE' }] }).reason, 'NO_MEMBERSHIP');
  assert.equal(T.resolveTenant({ candidate: ORG, principalType: 'USER', memberships: [{ organizationId: ORG, status: 'REVOKED' }] }).reason, 'NO_MEMBERSHIP');
  assert.equal(T.resolveTenant({ candidate: ORG, principalType: 'USER', memberships: [{ organizationId: ORG, status: 'ACTIVE' }], activeDevelopmentId: 'dev-b' }).reason, 'TENANT_MISMATCH');
  const ok = T.resolveTenant({ candidate: ORG, principalType: 'USER', principalId: 'u1', memberships: [{ organizationId: ORG, status: 'ACTIVE' }] });
  assert.ok(ok.ok && Object.isFrozen(ok.tenantContext));
  assert.equal(T.resolveTenant({ principalType: 'ANONYMOUS', activeDevelopmentId: 'dev-b' }).reason, 'NOT_PUBLIC');
  App.tenancy.learnFromServer({ organizations: [{ id: ORG_B, slug: 'imob-x', displayName: 'X', status: 'DISABLED' }], developmentOwners: { 'dev-b': ORG_B } });
  assert.equal(T.resolveTenant({ candidate: ORG_B, principalType: 'USER', memberships: [{ organizationId: ORG_B, status: 'ACTIVE' }] }).reason, 'ORG_DISABLED');
});
test('TwoOrganizationsSamePlatform / CrossTenantDirectIdDenied / PlatformAdminExplicitCrossTenant', () => {
  const App = fresh(); withOrgB(App);
  const owner = asRole(App, ['OWNER_ADMIN']);
  App.tenancy.learnFromServer({ organizations: [{ id: ORG_B, slug: 'imob-x', displayName: 'Imobiliária X', status: 'ACTIVE' }], developmentOwners: { 'dev-b': ORG_B, 'viva-juara': ORG } });
  assert.ok(ev(App, owner, 'lot.price.view', VJ).allowed);
  for (const k of ['lot.view', 'lot.price.view', 'availability.write', 'customer_profile.manage', 'admin.audit.view']) {
    assert.equal(ev(App, owner, k, { developmentId: 'dev-b' }).reason, 'CROSS_TENANT', k);
    assert.equal(ev(App, owner, k, { organizationId: ORG_B, resourceId: 'cust-123' }).reason, 'CROSS_TENANT', 'knowing another tenant id is not access');
  }
  assert.equal(ev(App, owner, 'lot.view', { organizationId: ORG_B, developmentId: 'viva-juara' }).reason, 'TENANT_MISMATCH');
  assert.equal(ev(App, owner, 'lot.view', { developmentId: 'nao-existe' }).reason, 'TENANT_UNRESOLVED');
  assert.equal(ev(App, owner, 'platform.cross_tenant').reason, 'PLATFORM_ONLY', 'tenant OWNER_ADMIN is not platform admin');
  const sys = App.authz.fromMe({ authenticated: true, principal: { type: 'SYSTEM', id: 'job-1' }, organizationId: null, permissions: ['platform.cross_tenant'] }).context;
  assert.ok(ev(App, sys, 'platform.cross_tenant').allowed);
  withOrgB(App); // a new /me replaces what the client learned; re-teach org B for the next check
  assert.equal(ev(App, sys, 'lot.view', { developmentId: 'dev-b' }).reason, 'CROSS_TENANT', 'platform permission is not a blanket tenant grant');
});
test('SuspendedOrganization: reads allowed, writes denied', () => {
  const App = fresh();
  const c = App.authz.fromMe(me({ organization: { id: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'SUSPENDED' }, permissions: App.permissions.grantsOf('OWNER_ADMIN') })).context;
  assert.ok(c.tenant.readOnly);
  assert.ok(ev(App, c, 'lot.view').allowed);
  assert.equal(ev(App, c, 'availability.write').reason, 'ORG_SUSPENDED');
});
test('UserMultipleMemberships / OrganizationSwitch: server-validated switch resets tenant state, keeps UI prefs', async () => {
  const App = fresh(), A = App.authz;
  const both = [{ organizationId: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE' }, { organizationId: ORG_B, slug: 'imob-x', displayName: 'Imobiliária X', status: 'ACTIVE' }];
  const bodyFor = org => me({ organizationId: org, organization: org === ORG ? { id: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE', developments: [{ id: 'viva-juara', visibility: 'PUBLIC' }] }
    : { id: ORG_B, slug: 'imob-x', displayName: 'Imobiliária X', status: 'ACTIVE', developments: [{ id: 'dev-b', visibility: 'PRIVATE' }] }, memberships: both, permissions: App.permissions.grantsOf('BROKER') });
  const f = async (url, init) => { const org = init.headers['X-Organization-Id'] || ORG; return { ok: true, status: 200, json: async () => bodyFor(org), headers: { get: () => null } }; };
  await A.refresh({ baseUrl: 'https://api.example/api/v1', fetch: f });
  assert.equal(A.context().tenant.organizationId, ORG);
  assert.equal((await A.switchOrganization('org_ghost', { baseUrl: 'https://api.example/api/v1', fetch: f })).reason, 'NO_MEMBERSHIP');
  const initial = { developmentId: 'viva-juara', currentLotId: null, comparisonLotIds: [], customers: [], favorites: [], activeFilters: {}, theme: 'dark', leftCollapsed: false };
  const sw = await A.switchOrganization(ORG_B, { baseUrl: 'https://api.example/api/v1', fetch: f, initialState: initial });
  assert.ok(sw.ok); assert.equal(A.context().tenant.organizationId, ORG_B);
  assert.deepEqual(clone(sw.statePatch.comparisonLotIds), []); assert.deepEqual(clone(sw.statePatch.customers), []); assert.equal(sw.statePatch.currentLotId, null);
  assert.ok(!('theme' in sw.statePatch) && !('leftCollapsed' in sw.statePatch), 'global UI prefs preserved');
  assert.ok(A.securityEvents().some(e => e.type === 'TENANT_SWITCHED'));
  assert.equal(A.can('lot.view', VJ), false, 'previous tenant data is no longer readable');
  assert.ok(A.can('lot.view', { developmentId: 'dev-b' }));
});
test('cache / storage namespaces: tenant-less keys refused, same lot in two tenants never collides', () => {
  const App = fresh(), T = App.tenancy;
  assert.throws(() => T.scopedKey(null, 'lot', 'L0327'), /organizationId/);
  assert.notEqual(T.scopedKey(ORG, 'lot', 'L0327'), T.scopedKey(ORG_B, 'lot', 'L0327'));
  assert.equal(T.scopedKey({ organizationId: ORG }, 'lot', 'L0327'), 'org:org_house7:lot:L0327');
  assert.equal(T.storageKey(ORG, 'viva-juara'), 'ws:org:org_house7:dev:viva-juara:state');
  assert.equal(T.legacyStorageKey('viva-juara'), 'ws:viva-juara:state');
});
test('TenantScopedRepository + leak detector: foreign rows dropped (prod), thrown (strict dev/test); no context → error', async () => {
  const App = fresh(); withOrgB(App);
  const lots = [{ identity: { id: 'A1', developmentId: 'viva-juara' } }, { identity: { id: 'B1', developmentId: 'dev-b' } }];
  const raw = { lotsSync: () => lots, getLotById: id => lots.find(l => l.identity.id === id), getLots: async () => lots };
  const ctx = App.tenancy.TenantContext({ organizationId: ORG });
  const repo = App.tenancy.scopeRepository(raw, ctx);
  assert.deepEqual(clone(repo.lotsSync().map(l => l.identity.id)), ['A1']);
  assert.equal(repo.getLotById('B1'), null);
  assert.deepEqual(clone((await repo.getLots()).map(l => l.identity.id)), ['A1']);
  assert.throws(() => App.tenancy.scopeRepository(raw, ctx, { strict: true }).getLotById('B1'), /TENANT_LEAK/);
  assert.throws(() => App.tenancy.scopeRepository(raw, null), /TenantContext/);
  assert.throws(() => App.tenancy.TenantContext({}), /organizationId/);
});
test('real LotRepository scoped to House 7 keeps all 498 lots (baseline backfill by development)', async () => {
  const App = fresh(), repo = App.repos.LotRepository('viva-juara'); await repo.load();
  const scoped = App.tenancy.scopeRepository(repo, App.tenancy.TenantContext({ organizationId: ORG }), { strict: true });
  assert.equal(scoped.lotsSync().length, 498);
  assert.equal(App.tenancy.scopeRepository(repo, App.tenancy.TenantContext({ organizationId: ORG_B })).lotsSync().length, 0);
});

// ------------------------------------------------------------ audit / security events / data minimization
test('AuditEvent: organizationId mandatory, PII and secrets redacted, tenant admins see only their org', () => {
  const App = fresh(), A = App.authz; withOrgB(App);
  const e = A.audit.record({ action: 'availability.write', permissionKey: 'availability.write', resourceType: 'lot', resourceId: 'VJ-QA-L0001', developmentId: 'viva-juara', outcome: 'SUCCESS',
    beforeRef: { status: 'AVAILABLE', revision: 1042 }, afterRef: { status: 'RESERVED', revision: 1043 }, metadata: { customerName: 'Maria', phone: '27 99999', token: 'abc', nested: { email: 'x@y' }, reasonCode: 'SALE' } });
  assert.equal(e.organizationId, ORG); assert.equal(e.afterRef.revision, 1043);
  assert.ok(!JSON.stringify(e).includes('Maria') && !JSON.stringify(e).includes('abc') && !JSON.stringify(e).includes('x@y'));
  assert.deepEqual(clone(e.redactedFields.sort()), ['customerName', 'nested.email', 'phone', 'token']);
  assert.throws(() => A.audit.record({ action: 'x', resourceType: 'lot', outcome: 'MAYBE' }), /outcome/);
  A.audit.record({ action: 'lot.view', resourceType: 'lot', developmentId: 'dev-b', outcome: 'DENIED' });
  assert.ok(A.audit.events().every(x => x.organizationId === ORG));
  const anonNoTenant = A.publicContext({ developmentId: null });
  assert.throws(() => A.auditEvent({ action: 'x', resourceType: 'customer', outcome: 'SUCCESS' }, { context: anonNoTenant }), /organizationId/);
});
test('HIGH/CRITICAL denials emit a local AUTHZ_DENIED security event (no PII)', () => {
  const App = fresh();
  App.authz.guard('price_table.publish', VJ);
  const s = App.authz.securityEvents().find(e => e.type === 'AUTHZ_DENIED');
  assert.ok(s); assert.equal(s.data.permissionKey, 'price_table.publish'); assert.equal(s.organizationId, ORG);
});
test('maskCustomer keeps only ids, lot refs and flags', () => {
  const App = fresh();
  assert.deepEqual(JSON.parse(JSON.stringify(App.authz.maskCustomer({ id: 'c1', name: 'João', lots: ['A1'], profile: { quiet: 3 }, phone: '1' }))), { id: 'c1', lots: ['A1'], hasProfile: true, masked: true });
});

// ------------------------------------------------------------ guards / view model / view
test('feature guards: hide vs disable with explanation; AccessControlViewModel', () => {
  const App = fresh(), A = App.authz;
  const pub = A.feature('pricing.publish', VJ); assert.equal(pub.visible, false);
  const av = A.feature('availability.edit', VJ); assert.equal(av.visible, true); assert.equal(av.enabled, false); assert.match(av.message, /permissão/);
  assert.equal(A.feature('nao.existe').visible, false);
  assert.ok(A.route('compare', VJ).allowed); assert.equal(A.route('admin/pricing', VJ).allowed, false); assert.equal(A.route('admin/xyz').allowed, false);
  assert.ok(A.section('commercial', VJ).allowed);
  const vm = A.viewModel();
  assert.equal(vm.authenticated, false); assert.equal(vm.activeScope.organization.id, ORG); assert.ok(vm.limitation.includes('não constituem'));
  assert.equal(vm.featureAccess['availability.edit'].enabled, false); assert.equal(vm.featureAccess['lot.price'].enabled, true);
});
test('securityView renders chip, denied state, banner and guarded buttons (escaped, no new data-act)', () => {
  const App = fresh();
  new Function('App', fs.readFileSync(path.join(SRC, 'presentation/securityView.js'), 'utf8'))(App);
  const V = App.securityView, vm = App.authz.viewModel();
  const chip = V.contextChip(vm);
  assert.match(chip, /House 7 Imóveis · Visitante/); assert.ok(!/data-act/.test(chip));
  assert.match(V.deniedState(App.authz.guard('availability.write', VJ)), /Entre com sua conta/);
  const f = App.authz.feature('availability.edit', VJ);
  assert.match(V.attrs(f), /aria-disabled="true"/); assert.ok(!/\sdisabled[\s>]/.test(V.attrs(f)), 'stays focusable');
  assert.equal(V.attrs(App.authz.feature('lot.compare', VJ)), '');
  assert.equal(V.button(App.authz.feature('pricing.publish', VJ), { act: 'x', label: 'Publicar' }), '');
  assert.match(V.button(f, { label: '<b>' }), /&lt;b&gt;/);
  assert.equal(V.sessionBanner(vm), '');
  const css = fs.readFileSync(path.join(SRC, 'presentation/security.css'), 'utf8');
  assert.ok(/min-height:44px/.test(css) && !/#[0-9a-f]{3,6}\b/i.test(css.replace(/rgba\([^)]*\)/g, '')), 'tokens only, 44px touch targets');
});
test('docs list every registered permission', () => {
  const App = fresh(), doc = path.join(__dirname, '..', 'docs', 'PERMISSION_REGISTRY.md');
  if (!fs.existsSync(doc)) return;
  const md = fs.readFileSync(doc, 'utf8');
  for (const p of App.permissions.list()) assert.ok(md.includes('`' + p.key + '`'), p.key);
});
