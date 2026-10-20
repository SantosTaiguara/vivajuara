'use strict';
// Round 6 — backoffice provider adapters (deals 57, onboarding 58, privacy 59, dataquality 61) in the admin shell (dash/admin.html).
// Contract of backoffice/backofficeCore.js: listInboxItems / listQueueItems / listApprovalTasks. Without a server → BACKEND_UNAVAILABLE,
// never data; queues without a server list contract → "contrato pendente"; with a (fake) server → projections without PII.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const BA = require('../scripts/buildAdmin.js');
const ORG = 'org_house7';
const HTML = BA.html({ check: false });
function adminApp(o = {}) {
  const js = HTML.slice(HTML.indexOf('<script>') + 8, HTML.lastIndexOf('</script>')), store = {};
  const ctx = { console, Intl, Date, Math, JSON, Map, Set, Promise, queueMicrotask, setTimeout, clearTimeout, AbortController, structuredClone, TextEncoder, URL, URLSearchParams,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { hash: '', href: 'https://painel.example/admin.html', search: '' }, history: { replaceState() {} }, fetch: async () => { throw new Error('no network'); } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(js, ctx, { filename: 'admin.html' });
  return ctx.App;
}
const OPS = ['backoffice.access', 'backoffice.inbox.view', 'backoffice.commercial.view', 'backoffice.data.view', 'backoffice.privacy.view'];
function signIn(App, perms = OPS) {
  const me = { authenticated: true, principal: { type: 'USER', id: 'u1', displayName: 'Ana', status: 'ACTIVE', authenticationMethod: 'GOOGLE_OIDC' }, organizationId: ORG,
    organization: { id: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE', developments: [{ id: 'viva-juara', visibility: 'PUBLIC' }] },
    memberships: [{ organizationId: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE' }], roles: [], roleAssignments: [], permissions: perms, developmentPermissions: {}, policyVersion: 'iam-2026-10-08.1' };
  const r = App.authz.fromMe(me, { developmentId: 'viva-juara' }); assert.ok(r.ok, JSON.stringify(r.errors)); App.authz.setContext(r.context, 'server');
}
const plain = x => JSON.parse(JSON.stringify(x));

test('admin.html bundles the adapters; the four providers are registered and implement the whole contract', () => {
  assert.ok(HTML.includes('/* ---- backoffice/backofficeAdapters.js ---- */'));
  const App = adminApp();
  for (const n of ['deals', 'onboarding', 'privacy', 'dataquality']) {
    const p = App.backoffice.provider(n); assert.equal(p.status, 'AVAILABLE', n);
    for (const m of ['listInboxItems', 'listQueueItems', 'listApprovalTasks']) assert.equal(typeof p.adapter[m], 'function', `${n}.${m}`);
  }
  assert.equal(App.deals.backofficeAdapter, App.backofficeAdapters.adapters.deals);
});

test('no server: every queue, the inbox and the approvals say BACKEND_UNAVAILABLE and carry zero items (never fake data)', async () => {
  const App = adminApp(); signIn(App); const B = App.backoffice;
  assert.equal(App.authz.backendBaseUrl(), null);
  for (const q of B.queues.visible()) { if (q.provider === 'documents' || q.provider === 'integrations') continue;
    const r = await B.queues.view(q.id, {}); assert.equal(r.providerStatus, 'BACKEND_UNAVAILABLE', q.id); assert.equal(r.items.length, 0); assert.match(r.providerMessage, /nenhum dado/); }
  const ib = await B.inbox.build(); assert.equal(ib.items.length, 0);
  for (const n of ['deals', 'onboarding', 'privacy', 'dataquality']) assert.equal(ib.providers[n].status, 'BACKEND_UNAVAILABLE', n);
  const ap = await B.approvals.list(); assert.equal(ap.tasks.length, 0); assert.equal(ap.providers.deals.status, 'BACKEND_UNAVAILABLE');
  const h = await App.adminApp.body('data'); assert.match(h, /data-provider-status="BACKEND_UNAVAILABLE"/); assert.doesNotMatch(h, /<tbody>/);
});

test('anonymous visitor still sees only "Acesso restrito" (adapters never run without a server-confirmed session)', async () => {
  const App = adminApp(); let calls = 0; App.backofficeAdapters.setFetch(async () => { calls++; return { ok: true, status: 200, json: async () => ({ data: [] }) }; });
  const r = { innerHTML: '', listeners: [], addEventListener(t, fn) { this.listeners.push(fn); }, querySelector: () => null };
  await App.adminApp.boot(r);
  assert.match(r.innerHTML, /Acesso restrito/); assert.doesNotMatch(r.innerHTML, /<button|<table|bo-queue/); assert.equal(calls, 0);
  const ib = await App.backoffice.inbox.build(); assert.equal(ib.allowed, false); assert.equal(calls, 0);
});

test('with a server: privacy requests and BLOCKING data-quality findings become items (ids, enums, dates; no subject data); missing contracts are explicit', async () => {
  const App = adminApp(); signIn(App);
  const dev = App.config.DEVELOPMENTS.find(d => d.id === 'viva-juara'), prevDs = dev.dataSource;
  dev.dataSource = { ...(prevDs || {}), useBackendData: true, apiBaseUrl: 'https://api.example' }; // the configured backend of the organization
  assert.equal(App.authz.backendBaseUrl(), 'https://api.example');
  const seen = [];
  App.backofficeAdapters.setFetch(async (url, init) => {
    seen.push({ url, org: init.headers['X-Organization-Id'], cred: init.credentials });
    if (url.endsWith('/api/v1/admin/privacy/requests')) return { ok: true, status: 200, json: async () => ({ data: [
      { id: 'dsr_1', organizationId: ORG, subjectRef: 'subj_maria_souza', requestType: 'ACCESS', status: 'RECEIVED', receivedAt: '2026-10-17T10:00:00Z' },
      { id: 'dsr_2', organizationId: 'org_other', requestType: 'DELETION', status: 'IN_REVIEW', receivedAt: '2026-10-17T10:00:00Z' },
      { id: 'dsr_3', organizationId: ORG, requestType: 'DELETION', status: 'COMPLETED', receivedAt: '2026-10-10T10:00:00Z' }] }) };
    if (url.includes('/api/v1/admin/data-quality/findings')) return { ok: true, status: 200, json: async () => ({ data: [
      { id: 'f_1', organizationId: ORG, ruleId: 'DQ-AV-001', severity: 'BLOCKING', status: 'OPEN', dataDomainId: 'availability', firstSeenAt: '2026-10-17T09:00:00Z' },
      { id: 'f_2', organizationId: ORG, ruleId: 'DQ-X', severity: 'WARNING', status: 'OPEN' }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
  const B = App.backoffice;
  const pr = await B.queues.view('privacy.subject_requests', {});
  assert.equal(pr.providerStatus, 'AVAILABLE'); assert.deepEqual(plain(pr.items.map(i => i.id).sort()), ['privacy:dsr_1', 'privacy:dsr_3']);
  const it = pr.items.find(i => i.id === 'privacy:dsr_1'); assert.equal(it.severity, 'INFO', 'no invented urgency'); assert.equal(it.status, 'OPEN'); assert.equal(it.dueAt, null, 'no deadline unless the server sends one');
  assert.doesNotMatch(JSON.stringify(plain(pr.items)), /maria|subj_/i, 'no subject reference in the projection');
  const dq = await B.queues.view('data.quality_blockers', {});
  assert.deepEqual(plain(dq.items.map(i => [i.id, i.severity])), [['dq:f_1', 'CRITICAL']]);
  for (const q of ['commercial.approvals', 'commercial.proposals', 'data.onboarding', 'data.conflicts', 'privacy.incidents']) {
    const r = await B.queues.view(q, {}); assert.equal(r.providerStatus, 'MODULE_NOT_INTEGRATED', q); assert.match(r.providerMessage, /contrato pendente/); assert.equal(r.items.length, 0); }
  assert.ok(seen.every(s => s.org === ORG && s.cred === 'include'));
  const ib = await B.inbox.build(); assert.deepEqual(plain(ib.items.map(i => i.id).sort()), ['dq:f_1', 'privacy:dsr_1'], 'resolved items leave the inbox');
  assert.equal(ib.providers.deals.status, 'MODULE_NOT_INTEGRATED');
  App.backofficeAdapters.setFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));
  assert.equal((await B.queues.view('privacy.subject_requests', {})).providerStatus, 'NOT_AUTHORIZED');
  App.backofficeAdapters.setFetch(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal((await B.queues.view('privacy.subject_requests', {})).providerStatus, 'BACKEND_UNAVAILABLE');
  dev.dataSource = prevDs;
});
