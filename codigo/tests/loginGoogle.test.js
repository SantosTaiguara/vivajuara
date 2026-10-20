'use strict';
// W3 login (Google OIDC, organization org_house7) — frontend side: App.authz.account + header control (navigation/menuView).
// Static public visitor mode (no backend configured = the published artifact) must not change at all: no control, no
// request, same decisions. Backend mode: principal from GET /me, "Entrar com Google" / first name + "Sair".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

const DEV = 'viva-juara', VJ = { developmentId: DEV }, ORG = 'org_house7', API = 'https://api.example.test/api/v1';
const NAV_FILES = ['navigation/navigationRegistry.js', 'navigation/navigationService.js', 'navigation/menuView.js'];
const fresh = ({ backend = false } = {}) => {
  const App = load();
  for (const f of NAV_FILES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  if (backend) Object.assign(App.config.DEVELOPMENTS.find(d => d.id === DEV).dataSource, { useBackendData: true, apiBaseUrl: API + '/' });
  return App;
};
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });
const meBody = (o = {}) => ({ authenticated: true, principal: { type: 'USER', id: 'google:0123456789abcdef', displayName: 'Ana Maria', status: 'ACTIVE', authenticationMethod: 'GOOGLE_OIDC' },
  organizationId: null, organization: null, organizationSelectionRequired: false, tenantResolvedBy: null, memberships: [], roles: [], roleAssignments: [],
  permissions: ['development.view', 'lot.view', 'lot.price.view', 'lot.price_history.view', 'lot.availability.view', 'lot.analysis.view', 'lot.compare', 'lot.simulate', 'share.create', 'customer_profile.manage'],
  publicPermissions: [], developmentPermissions: {}, policyVersion: 'iam-2026-10-08.1', session: { expiresAt: '2099-01-01T00:00:00.000Z' }, identityProvider: { status: 'CONFIGURED', mode: 'GOOGLE_OIDC' }, ...o });
const invited = roles => meBody({ principal: { type: 'USER', id: '7d0c3f7e-1111-4222-8333-944445555666', displayName: 'Carla Souza', status: 'ACTIVE', authenticationMethod: 'GOOGLE_OIDC' },
  organizationId: ORG, organization: { id: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE', developments: [{ id: DEV, slug: DEV, name: 'Viva Juara', visibility: 'PUBLIC' }] },
  tenantResolvedBy: 'SINGLE_MEMBERSHIP', memberships: [{ organizationId: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE' }], roles,
  roleAssignments: roles.map(r => ({ role: r, organizationId: ORG, developmentId: null })) });

test('static public mode (no backend): no account control, no request, decisions unchanged', async () => {
  const App = fresh(), A = App.authz;
  assert.equal(A.backendBaseUrl(), null);
  assert.deepEqual({ ...A.account.viewModel() }, { visible: false });
  let calls = 0;
  const r = await A.account.start({ search: '?login=erro', fetch: async () => { calls++; return reply(500, null); } });
  assert.equal(r.skipped, true); assert.equal(calls, 0, 'nothing is requested without a backend');
  assert.equal(A.account.loginUrl('https://x.example/'), null);
  assert.equal((await A.account.logout()).reason, 'STATIC_PUBLIC');
  assert.equal(App.navigation.view.accountHtml(A.account.viewModel()), '');
  const vm = App.navigation.service.viewModel(App.store.get(), { authz: A, resource: VJ });
  assert.equal(vm.account.visible, false);
  assert.equal(A.context().source, 'STATIC_PUBLIC');
  assert.ok(A.can('lot.view', VJ)); assert.equal(A.can('availability.write', VJ, { connectivity: 'ONLINE' }), false);
  // the static header markup is exactly what the registry prints (shell.html is checked by scripts/navHeader.js --check)
  assert.ok(!App.navigation.view.headerHtml().includes('nacct'));
});

test('data-acts authLogin/authLogout are mapped (UI-only: the server decides identity and permissions)', () => {
  const App = fresh(), A = App.authz;
  for (const act of ['authLogin', 'authLogout']) { const g = A.action(act, {}, VJ); assert.equal(g.allowed, true, act); assert.equal(g.reason, 'UI_ONLY', act); }
  const src = fs.readFileSync(path.join(SRC, 'navigation/menuView.js'), 'utf8');
  for (const act of [...src.matchAll(/data-act="(auth\w+)"/g)].map(m => m[1])) assert.ok(App.permissions.featureOfAction(act) === '', act);
});

test('backend mode, not invited: signed in with Google, first name + "Sair", only public permissions; ?login= notice', async () => {
  const App = fresh({ backend: true }), A = App.authz, calls = [];
  assert.equal(A.backendBaseUrl(), API);
  const f = async (url, init) => { calls.push({ url, init }); return reply(200, meBody()); };
  const p = A.account.start({ search: '?login=negado', fetch: f });
  assert.equal(A.account.viewModel().visible, false, 'nothing shown while /me loads (no flash of the login button)');
  await p;
  assert.equal(calls[0].url, API + '/me'); assert.equal(calls[0].init.credentials, 'include');
  const vm = A.account.viewModel();
  assert.equal(vm.visible, true); assert.equal(vm.authenticated, true); assert.equal(vm.firstName, 'Ana'); assert.equal(vm.limited, true);
  assert.equal(vm.notice, A.account.NOTICES.negado);
  // deny by default: the public visitor's rights only (map, prices, simulation, compare), never an organization write
  assert.ok(A.can('lot.view', VJ)); assert.ok(A.can('lot.price.view', VJ)); assert.ok(A.can('lot.compare', VJ));
  assert.equal(A.can('availability.write', VJ, { connectivity: 'ONLINE' }), false);
  assert.equal(A.can('price_table.publish', VJ, { connectivity: 'ONLINE' }), false);
  assert.equal(A.uiMode('technical').allowed, A.uiMode('technical', VJ, { context: A.publicContext({ developmentId: DEV }) }).allowed, 'same modes as a visitor');
  const html = App.navigation.view.accountHtml(vm);
  assert.match(html, /<span class="nacct-name" data-limited="1"[^>]*>Ana<\/span>/); assert.match(html, /data-act="authLogout"[^>]*>Sair</);
  const nav = App.navigation.service.viewModel(App.store.get(), { authz: A, resource: VJ });
  assert.equal(nav.account.firstName, 'Ana');
  // started once only
  await A.account.start({ fetch: f }); assert.equal(calls.length, 1);
});

test('backend mode, invited BROKER of org_house7: organization permissions come from /me', async () => {
  const App = fresh({ backend: true }), A = App.authz;
  const keys = App.permissions.grantsOf('BROKER');
  await A.account.start({ fetch: async () => reply(200, invited(['BROKER'])) });
  // fromMe keeps only the known keys the server sent: send the broker grants
  await A.refresh({ fetch: async () => reply(200, { ...invited(['BROKER']), permissions: keys }) });
  const vm = A.account.viewModel();
  assert.equal(vm.firstName, 'Carla'); assert.equal(vm.limited, false);
  assert.equal(A.context().tenant.organizationId, ORG);
  assert.ok(A.can('lot.view', VJ));
  assert.equal(A.can('availability.write', VJ, { connectivity: 'ONLINE' }), false, 'BROKER does not write availability');
});

test('anonymous in backend mode: "Entrar com Google" → GET {api}/auth/google/start?returnTo=<panel url>', async () => {
  const App = fresh({ backend: true }), A = App.authz;
  await A.account.start({ search: '?login=erro', fetch: async () => reply(200, { authenticated: false, principal: { type: 'ANONYMOUS', id: null }, permissions: [] }) });
  const vm = A.account.viewModel();
  assert.equal(vm.authenticated, false); assert.equal(vm.loginLabel, 'Entrar com Google'); assert.equal(vm.notice, A.account.NOTICES.erro);
  const html = App.navigation.view.accountHtml(vm);
  assert.match(html, /data-act="authLogin"/); assert.match(html, /Entrar com Google/); assert.match(html, /role="status"/);
  const url = A.account.loginUrl('https://painel.example.test/#viva-juara.lots.B79');
  assert.equal(url, API + '/auth/google/start?returnTo=' + encodeURIComponent('https://painel.example.test/#viva-juara.lots.B79'));
  assert.equal(A.account.viewModel().notice, null, 'notice cleared when trying again');
  assert.equal(A.account.loginUrl('javascript:alert(1)'), API + '/auth/google/start', 'non-http returnTo dropped');
});

test('logout: CSRF token fetched just in time and sent as X-CSRF-Token; context back to the visitor; token never kept', async () => {
  const App = fresh({ backend: true }), A = App.authz, calls = [];
  await A.account.start({ fetch: async () => reply(200, invited(['BROKER'])) });
  const CSRF = 'csrf-token-abcdefghijklmnopqrstuvwxyz0123456789';
  const f = async (url, init) => { calls.push({ url, init }); return url.endsWith('/auth/session') ? reply(200, { data: { authenticated: true, csrfToken: CSRF } }) : reply(200, { data: { revoked: true } }); };
  const r = await A.account.logout({ fetch: f });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.map(c => [c.init.method, c.url]), [['GET', API + '/auth/session'], ['POST', API + '/auth/logout']]);
  assert.equal(calls[1].init.headers['X-CSRF-Token'], CSRF); assert.ok(calls.every(c => c.init.credentials === 'include'));
  assert.equal(A.context().principal.type, 'ANONYMOUS');
  assert.equal(A.account.viewModel().authenticated, false);
  assert.ok(!JSON.stringify(A.context()).includes(CSRF) && !JSON.stringify(A.securityEvents()).includes(CSRF));
  // network failure: still logged out locally
  await A.account.start({ fetch: async () => reply(200, invited(['BROKER'])) });
  await A.refresh({ fetch: async () => reply(200, invited(['BROKER'])) });
  const down = await A.account.logout({ fetch: async () => { throw new Error('offline'); } });
  assert.equal(down.ok, false); assert.equal(A.context().principal.type, 'ANONYMOUS');
});

test('GET /me answered in the API envelope { data, meta } is unwrapped', async () => {
  const App = fresh({ backend: true }), A = App.authz;
  await A.account.start({ fetch: async () => reply(200, { data: meBody(), meta: { requestId: 'r1' } }) });
  const vm = A.account.viewModel();
  assert.equal(vm.authenticated, true); assert.equal(vm.firstName, 'Ana'); assert.equal(A.context().principal.type, 'USER');
});

test('account markup escapes the display name (no HTML from the identity provider)', () => {
  const App = fresh();
  const html = App.navigation.view.accountHtml({ visible: true, authenticated: true, firstName: '<img src=x onerror=alert(1)>', limited: false, logoutLabel: 'Sair', ariaLabel: 'Sair "x"' });
  assert.ok(!html.includes('<img')); assert.match(html, /&lt;img/);
});
