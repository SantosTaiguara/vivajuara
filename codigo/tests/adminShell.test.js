'use strict';
// Round 5 integration — the SEPARATE admin shell (dash/admin.html, scripts/buildAdmin.js, src/admin/adminApp.js) and the public
// page boundary: the anonymous / static visitor sees only "Acesso restrito" (no queue, no data, no action button), localStorage
// or the URL never grant access, and dash/index.html bundles no backoffice/deals/onboarding/dataquality module.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { DATA, SRC, ORDER } = require('./harness.js');
const BA = require('../scripts/buildAdmin.js'), CB = require('../scripts/configBundle.js');
const ADMIN_ONLY = /^(backoffice|deals|onboarding|dataquality|surroundings|admin)\/|^config\/(backoffice|onboarding|surroundings)\/|^privacy\/(privacyCore|privacyWorkflow)\.js$/;
const ORG = 'org_house7';

/** runs the admin page's script in a vm, with a seeded (hostile) localStorage and URL */
function adminApp(o = {}) {
  const html = o.html || BA.html({ check: false });
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const store = { ...(o.storage || {}) };
  const ctx = { console, Intl, Date, Math, JSON, Map, Set, Promise, queueMicrotask, setTimeout, clearTimeout, AbortController, structuredClone, TextEncoder, URL, URLSearchParams,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { hash: o.hash || '', href: 'https://painel.example/admin.html' + (o.search || '') + (o.hash || ''), search: o.search || '' }, history: { replaceState() {} },
    fetch: async () => { throw new Error('no network in the static admin shell'); } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(js, ctx, { filename: 'admin.html' });
  return ctx.App;
}
const root = () => ({ innerHTML: '', listeners: [], addEventListener(t, fn) { this.listeners.push(fn); }, querySelector: () => null });
function assertRestricted(h) {
  assert.match(h, /Acesso restrito/);
  assert.doesNotMatch(h, /<button|data-act=|<table|bo-queue|bo-nav|bo-home|bo-approvals|<input|<select|<form/i, 'no queue, no data, no action button');
  assert.doesNotMatch(h, /\d+ itens|Urgente|Aprovações pendentes|proposta|reserva/i, 'no counts or existence hints (§514)');
}

test('admin.html builds as a complete page: own document, noindex, admin config profile, every admin domain bundled', () => {
  const h = BA.html({ check: false });
  assert.match(h, /^<!doctype html>/); assert.match(h, /<meta name="robots" content="noindex,nofollow">/); assert.match(h, /<title>Console administrativo · Viva Juara<\/title>/);
  for (const f of ['backoffice/backofficeCore.js', 'backoffice/backofficeView.js', 'deals/dealsDomain.js', 'onboarding/orchestrator.js', 'dataquality/dqEngine.js', 'privacy/privacyCore.js', 'privacy/privacyView.js', 'surroundings/surroundingsDomain.js', 'surroundings/surroundingsView.js', 'admin/adminApp.js'])
    assert.ok(h.includes(`/* ---- ${f} ---- */`), f);
  assert.ok(!h.includes('/* ---- presentation/app.js ---- */') && !h.includes('/* ---- presentation/map.js ---- */'), 'not the map panel');
  assert.doesNotMatch(h, /<script[^>]+src=|<link[^>]+href="https?:/i, 'no external script or stylesheet');
  const App = adminApp({ html: h });
  for (const k of ['privacy', 'dataquality', 'deals', 'security']) assert.ok(App.configs[k], `configs.${k}`);
  assert.deepEqual(JSON.parse(JSON.stringify(App.permissions.validate())), []);
});

test('anonymous static visitor: only "Acesso restrito", no queue, no data, no action buttons; no backend call succeeds', async () => {
  const App = adminApp(), r = root();
  await App.adminApp.boot(r);
  assertRestricted(r.innerHTML);
  assert.match(r.innerHTML, /servidor administrativo não conectado/);
  assert.equal(r.listeners.length, 0, 'no click handler without an allowed context');
  assert.equal(App.backoffice.shellContext().allowed, false);
  assert.deepEqual(JSON.parse(JSON.stringify(App.backoffice.navigation.getItems())), []);
  assert.equal(App.backofficeView.entryLink(), '', 'entry link hidden for the visitor');
  const env = App.backoffice.commands.envelope ? App.backoffice.commands : null;
  if (env && env.preview) { const p = await env.preview({ actionCode: 'reservation.release' }); assert.equal(p.ok, false); }
  assertRestricted(App.adminApp.render({ context: App.backoffice.shellContext() }));
});

test('localStorage and the URL never grant access to the admin shell (deny by default)', async () => {
  const forged = JSON.stringify({ principal: { type: 'USER', id: 'x' }, roles: ['OWNER_ADMIN'], permissions: ['backoffice.access', 'backoffice.inbox.view'], organizationId: ORG });
  const App = adminApp({ storage: { 'ws:viva-juara:state': forged, authz: forged, session: forged, 'vj-role': 'OWNER_ADMIN', token: 'eyJhbGciOiJub25lIn0.e30.' },
    hash: '#/admin?role=OWNER_ADMIN&permissions=backoffice.access', search: '?admin=1&role=OWNER_ADMIN' });
  const r = root(); await App.adminApp.boot(r);
  assertRestricted(r.innerHTML);
  assert.equal(App.authz.context().principal.type, App.authz.PRINCIPAL_TYPE.ANONYMOUS);
});

test('a server-confirmed context with backoffice.access renders the shell with honest unavailable states, never fake data', async () => {
  const App = adminApp();
  const me = { authenticated: true, principal: { type: 'USER', id: 'u1', displayName: 'Ana', status: 'ACTIVE', authenticationMethod: 'GOOGLE_OIDC' }, organizationId: ORG,
    organization: { id: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE', developments: [{ id: 'viva-juara', visibility: 'PUBLIC' }] },
    memberships: [{ organizationId: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE' }], roles: [], roleAssignments: [],
    permissions: ['backoffice.access', 'backoffice.inbox.view', 'backoffice.commercial.view'], developmentPermissions: {}, policyVersion: 'iam-2026-10-08.1' };
  const r0 = App.authz.fromMe(me, { developmentId: 'viva-juara' }); assert.ok(r0.ok, JSON.stringify(r0.errors));
  App.authz.setContext(r0.context, 'server');
  const ctx = App.backoffice.shellContext(); assert.equal(ctx.allowed, true);
  const home = await App.adminApp.body('overview');
  assert.match(home, /Áreas indisponíveis/); assert.match(home, /não integrado|não disponível|Servidor administrativo indisponível/);
  assert.doesNotMatch(home, /<tbody>/, 'no item rows without a provider');
  assert.match(home, /Entorno ainda não configurado para este empreendimento/i, 'Entorno: coordinate validated, flag OFF / no key → honest NOT_CONFIGURED state'); assert.doesNotMatch(home, /data-surroundings-map|maps\.googleapis/);
  const h = App.adminApp.render({ context: ctx, nav: App.backoffice.navigation.getItems(), active: 'overview', body: home });
  assert.match(h, /data-shell="admin"/); assert.match(h, /Visão Geral/);
  const q = await App.adminApp.body('commercial'); assert.match(q, /bo-unavailable|não integrado|não disponível/); assert.doesNotMatch(q, /<tbody>/);
});

test('public page boundary: index.html bundles no backoffice/deals/onboarding/dataquality/surroundings module, nor the admin-only permissions', () => {
  for (const f of ORDER) assert.doesNotMatch(f, ADMIN_ONLY, `ORDER must not carry ${f}`);
  const build = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'build.js'), 'utf8');
  assert.match(build, /profile: 'public'/);
  const ui = (build.match(/const UI = \[([^\]]+)\]/) || [])[1] || ''; for (const f of ui.match(/'[^']+'/g) || []) assert.doesNotMatch(f.slice(1, -1), ADMIN_ONLY, f);
  const html = path.join(DATA, 'index.html');
  if (fs.existsSync(html)) {
    const s = fs.readFileSync(html, 'utf8');
    for (const m of s.matchAll(/\/\* ---- (.+?) ---- \*\//g)) assert.doesNotMatch(m[1], ADMIN_ONLY, `index.html carries ${m[1]}`);
    assert.doesNotMatch(s, /data-act="boOpen"|admin\.html/, 'the public panel does not link the admin shell');
    assert.doesNotMatch(s, /"backoffice\.access"|"proposal\.read"/, 'admin-only permission keys are not shipped to the visitor');
  }
});

test('public config profile: same anonymous decisions, valid registry, no admin-only entries', () => {
  const pub = CB.read(undefined, { profile: 'public' }), full = CB.read();
  assert.ok(!pub.deals && !pub.privacy && !pub.dataquality);
  assert.ok(pub.security.permissions.permissions.every(p => !CB.ADMIN_PERMISSION_RE.test(p.key)));
  assert.ok(!pub.security.secretsCatalog && full.security.secretsCatalog);
  for (const k of Object.keys(full.security.features.uiOnlyActions)) assert.ok(Object.prototype.hasOwnProperty.call(pub.security.features.uiOnlyActions, k), k);
  // load the panel modules with the public bundle and compare the visitor's feature decisions with the full bundle
  const run = bundle => { const ctx = { console, Intl, Date, Math, JSON, Map, Set, Promise, queueMicrotask, setTimeout, clearTimeout, URL, URLSearchParams, structuredClone, TextEncoder,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { hash: '' }, history: { replaceState() {} }, fetch: async () => ({ ok: false, status: 404, json: async () => null }) };
    ctx.window = ctx; vm.createContext(ctx);
    for (const f of ['prelude.js', 'domain/enums.js', 'domain/model.js', 'config/developments.js', 'security/organization.js', 'security/permissions.js', 'security/authorization.js']) {
      vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }); if (f === 'prelude.js') vm.runInContext(bundle, ctx); }
    return ctx.App; };
  const P = run(CB.bundle(undefined, { profile: 'public' })), F = run(CB.bundle());
  assert.deepEqual(JSON.parse(JSON.stringify(P.permissions.validate())), []);
  for (const id of Object.keys(P.permissions.features())) assert.equal(P.authz.feature ? P.authz.feature(id).allowed : null, F.authz.feature ? F.authz.feature(id).allowed : null, id);
  for (const act of ['privacyExport', 'privacyEraseLocal', 'privacyEraseConfirm']) assert.equal(P.permissions.featureOfAction(act), '', `${act} stays a UI-only control`);
  for (const act of ['boOpen', 'dealOpenProposal', 'onboarding-publish']) assert.equal(P.permissions.featureOfAction(act), null, `${act} unknown → denied in the public page`);
});
