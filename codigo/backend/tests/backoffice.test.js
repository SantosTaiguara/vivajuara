'use strict';
/* Topic 60 — backoffice admin commands, DB-FREE: memory repository + memory audit sink; authentication reuses
   modules/iam/authentication.js (ADMIN_API_TOKEN → SYSTEM; session adapter → USER, like the Google cookie session) and
   authorization reuses modules/iam/authorization.js. Nothing here talks to Postgres or Google. */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');

const { createRouter } = require('../src/shared/http/router');
const { toErrorResponse, E } = require('../src/shared/http/errors');
const { createAuthentication } = require('../src/modules/iam/authentication');
const { ANONYMOUS } = require('../src/modules/iam/authorization');
const { createMemoryAuditSink } = require('../src/modules/auth/auth.repository');
const { createMemoryBackofficeRepository } = require('../src/modules/backoffice/backoffice.repository');
const { createBackofficeService } = require('../src/modules/backoffice/backoffice.service');
const { registerBackofficeRoutes, ROUTES } = require('../src/modules/backoffice/backoffice.controller');
const { CFG, BO_PERMISSIONS } = require('../src/modules/backoffice/backoffice.policy');

const ORG = 'org_house7', ORG_B = 'org_imobx';
const ADMIN = 'test-admin-token-0123456789abcdef0123456789';
const T0 = Date.parse('2026-10-17T12:00:00Z');
const user = (id, roles, o = {}) => Object.freeze({ type: 'USER', id, userId: id, displayName: 'Op', status: 'ACTIVE', actorId: id, idempotencyPrincipal: `user:${id}`, authenticationMethod: 'GOOGLE_OIDC', viaSession: true,
  memberships: [{ organizationId: o.org || ORG, status: 'ACTIVE', organizationStatus: 'ACTIVE' }], assignments: roles.map(r => ({ roleCode: r, organizationId: o.org || ORG, developmentId: null })), assuranceLevel: o.assurance || 1 });
// explicit, test-only grants (production default is EMPTY: no role gets backoffice access until a human decides)
const GRANTS = { OPS: ['backoffice.access', 'backoffice.inbox.view', 'backoffice.queue.assign', 'backoffice.integration.view', 'backoffice.observability.view'],
  CONFIG: ['backoffice.access', 'backoffice.config.view', 'backoffice.config.publish'], SUPPORT: ['backoffice.access', 'backoffice.support_session.start'],
  SEC: ['backoffice.access', 'backoffice.emergency.activate', 'backoffice.observability.view'] };

function setup(o = {}) {
  let t = o.t0 || T0; const now = () => t;
  const repo = createMemoryBackofficeRepository(), audit = createMemoryAuditSink();
  const svc = createBackofficeService({ repo, audit, now, previewKey: 'preview-key-for-tests-only-0123456789', roleGrants: o.grants === undefined ? GRANTS : o.grants,
    stepUpVerifier: p => (p.assuranceLevel || 0) >= 2, env: { SESSION_SECRET: 'x'.repeat(40), DATABASE_URL: '' }, configSchemas: { 'Workflow Policies': c => (c && typeof c === 'object' ? [] : ['objeto']) } });
  return { svc, repo, audit, advance: ms => { t += ms; }, now };
}
const env = (actionCode, resourceRef, o = {}) => ({ envelope: { actionCode, organizationId: o.org || ORG, resourceRef, expectedRevision: o.rev, idempotencyKey: o.key || 'idem-' + crypto.randomBytes(6).toString('hex'), reason: o.reason, payload: o.payload || {}, approvalRef: o.approvalRef } });
const rejects = async (p, status, reasonCode) => { try { await p; } catch (e) { assert.equal(e.status, status, `${e.code}/${e.details && e.details.reasonCode}`); if (reasonCode) assert.equal(e.details && e.details.reasonCode, reasonCode); return e; } assert.fail('expected rejection'); };

test('catalog: backoffice.* keys mirror the frontend registry; actions reference known reason codes; production grants are empty', () => {
  assert.ok(BO_PERMISSIONS.has('backoffice.access') && BO_PERMISSIONS.size >= 20);
  for (const a of CFG.actions) if (a.permission.startsWith('backoffice.')) assert.ok(BO_PERMISSIONS.has(a.permission), a.permission);
  const { svc } = setup({ grants: {} });
  assert.deepEqual(svc.authz.roleGrants, {});
  assert.deepEqual(svc.handlers(), ['config.publish', 'config.rollback', 'emergency.activate', 'emergency.release', 'support_session.end', 'support_session.start', 'workitem.assign']);
});

test('AdminHomeShowsOnlyAuthorizedQueues (server): navigation by permission; anonymous 401; no grants → nothing; cross-tenant 404', () => {
  const { svc } = setup();
  assert.throws(() => svc.navigation(ANONYMOUS, ORG), e => e.status === 401);
  assert.deepEqual(svc.navigation(user('u1', ['BROKER']), ORG), []);
  assert.deepEqual(svc.navigation(user('u1', ['OPS']), ORG).map(i => i.id), ['overview', 'operations', 'approvals', 'integrations', 'observability']);
  assert.throws(() => svc.navigation(user('u1', ['OPS']), ORG_B), e => e.status === 404);
  const none = setup({ grants: {} }).svc;
  // decision 2026-10-18 (Edmilson): OWNER_ADMIN holds every backoffice.* key through the IAM registry even with an empty grant map
  assert.ok(none.navigation(user('u1', ['OWNER_ADMIN']), ORG).length > 0, 'OWNER_ADMIN sees the console (decision 2026-10-18)');
  assert.deepEqual(none.navigation(user('u1', ['COMMERCIAL_MANAGER']), ORG), [], 'no other IAM role has a backoffice key');
  assert.ok(none.navigation({ type: 'SYSTEM', id: 'system:admin', status: 'ACTIVE' }, ORG).some(i => i.id === 'audit'), 'platform principal (ADMIN_API_TOKEN) sees the admin areas');
});

test('authorization golden (§400): user without the action permission is rejected by the backend on a direct API attempt, and audited', async () => {
  const { svc, audit } = setup();
  await rejects(svc.preview(user('u1', ['OPS']), env('availability.override', 'lot:VJ-QB-L0079', { rev: '5', reason: { code: 'DATA_CORRECTION' } })), 403, 'NOT_AUTHORIZED');
  assert.ok(audit.events.some(e => e.outcome === 'DENIED' && e.newValue.permission === 'availability.write'));
  await rejects(svc.execute(ANONYMOUS, env('workitem.assign', 'workitem:apr_1', { payload: { assignedToUserId: 'u3' } })), 401);
  await rejects(svc.execute(user('u1', ['OPS']), env('db.update', 'lot:x')), 422, 'UNKNOWN_ACTION');
});

test('AdminCrossTenantDenied: command for another organization → 404, no existence leak, audited', async () => {
  const { svc, audit } = setup();
  await rejects(svc.execute(user('u1', ['OPS']), env('workitem.assign', 'workitem:apr_1', { org: ORG_B, payload: { assignedToUserId: 'u3' } })), 404, 'TENANT_MISMATCH');
  assert.ok(audit.events.some(e => e.outcome === 'DENIED' && e.organizationId === ORG_B));
});

test('work assignment: execute is idempotent (same key replays, other body → IDEMPOTENCY_KEY_REUSED); stale revision → CONFLICT, not overwrite', async () => {
  const { svc, repo } = setup(), u = user('u1', ['OPS']);
  const c1 = env('workitem.assign', 'workitem:apr_1', { key: 'idem-assign-0001', payload: { assignedToUserId: 'u3' } });
  const r1 = await svc.execute(u, c1);
  assert.equal(r1.outcome, 'EXECUTED'); assert.equal(r1.newRevision, '1');
  const r2 = await svc.execute(u, c1); assert.equal(r2.replayed, true); assert.equal(repo._state.commands.length, 1);
  await rejects(svc.execute(u, { envelope: { ...c1.envelope, payload: { assignedToUserId: 'u4' } } }), 409);
  // R5/R6 analogue: someone else assigned meanwhile (revision 1 → 2); a command built on revision 1 is refused
  await svc.execute(u, env('workitem.assign', 'workitem:apr_1', { rev: '1', payload: { assignedToUserId: 'u5' } }));
  const e = await rejects(svc.execute(u, env('workitem.assign', 'workitem:apr_1', { rev: '1', payload: { assignedToUserId: 'u6' } })), 409, 'REVISION_CONFLICT');
  assert.equal(e.details.currentRevision, '2');
  assert.equal((await repo.assignments.get(ORG, 'apr_1')).assignedToUserId, 'u5', 'last write did not win');
  await rejects(svc.execute(u, env('workitem.assign', 'workitem:apr_2', { payload: {} })), 422, 'PREVIEW_BLOCKED');
});

test('AdminConfigVersionPublish + AdminDevelopmentRollback analogue: approved change by another person, preview token, immutable versions, rollback = new version', async () => {
  const { svc, repo, advance, audit } = setup(), req = user('u1', ['CONFIG']), pub = user('u2', ['CONFIG']);
  const ref = 'config:Workflow_Policies:org_house7';
  await repo.configs.putChange({ id: 'chg_1', organizationId: ORG, configType: 'Workflow Policies', scopeRef: 'org_house7', proposedContent: { notify: 'x' }, status: 'APPROVED', requestedBy: 'u1', approvedBy: 'u1' });
  await rejects(svc.preview(pub, env('config.publish', ref, { rev: '0', payload: { changeId: 'chg_1' } })), 400, 'REASON_REQUIRED');
  const bad = await svc.preview(pub, env('config.publish', ref, { rev: '0', reason: { code: 'DATA_CORRECTION' }, payload: { changeId: 'chg_1' } }));
  assert.equal(bad.allowed, false); assert.deepEqual(bad.blockers, ['SEPARATION_OF_DUTIES']);
  await repo.configs.putChange({ id: 'chg_2', organizationId: ORG, configType: 'Workflow Policies', scopeRef: 'org_house7', proposedContent: { notify: 'y' }, status: 'APPROVED', requestedBy: 'u1', approvedBy: 'u3' });
  const c = env('config.publish', ref, { rev: '0', reason: { code: 'DATA_CORRECTION' }, payload: { changeId: 'chg_2' } });
  await rejects(svc.execute(pub, c), 422, 'PREVIEW_REQUIRED');
  const pv = await svc.preview(pub, c);
  assert.equal(pv.allowed, true); assert.ok(pv.previewToken && pv.expiresAt);
  await rejects(svc.execute(req, { ...c, previewToken: pv.previewToken }), 422, 'PREVIEW_MISMATCH'); // token bound to the actor
  await rejects(svc.execute(pub, { envelope: { ...c.envelope, payload: { changeId: 'chg_1' } }, previewToken: pv.previewToken }), 422, 'PREVIEW_MISMATCH');
  advance(301e3); await rejects(svc.execute(pub, { ...c, previewToken: pv.previewToken }), 422, 'PREVIEW_EXPIRED'); advance(-301e3);
  const r = await svc.execute(pub, { ...c, previewToken: pv.previewToken });
  assert.equal(r.result.version, 1); assert.equal((await repo.configs.getChange('chg_2')).status, 'PUBLISHED');
  assert.ok(svc.events().some(e => e.type === 'ReleaseMarker'), 'audit + release marker emitted (§402)');
  assert.ok(audit.events.some(e => e.action === 'ADMIN_CONFIG_PUBLISH' && e.outcome === 'SUCCESS' && !JSON.stringify(e).includes('"y"')), 'audit minimized: no content');
  await repo.configs.putChange({ id: 'chg_3', organizationId: ORG, configType: 'Workflow Policies', scopeRef: 'org_house7', proposedContent: { notify: 'z' }, status: 'APPROVED', requestedBy: 'u1', approvedBy: 'u3' });
  const c3 = env('config.publish', ref, { rev: '1', reason: { code: 'DATA_CORRECTION' }, payload: { changeId: 'chg_3' } });
  await svc.execute(pub, { ...c3, previewToken: (await svc.preview(pub, c3)).previewToken });
  const rb = env('config.rollback', ref, { rev: '2', reason: { code: 'ROLLBACK' }, payload: { targetVersion: 1 } });
  const rpv = await svc.preview(pub, rb); assert.ok(rpv.warnings.includes('DYNAMIC_DOMAINS_NOT_ROLLED_BACK'));
  const rr = await svc.execute(pub, { ...rb, previewToken: rpv.previewToken });
  assert.deepEqual(rr.result, { version: 3, restoresVersion: 1 });
  assert.deepEqual((await repo.configs.current(ORG, 'Workflow Policies', 'org_house7')).content, { notify: 'y' });
  assert.equal((await repo.configs.versions(ORG, 'Workflow Policies', 'org_house7')).length, 3, 'nothing overwritten');
  assert.ok(Object.isFrozen(repo._state.versions[0]));
});

test('AdminSupportSessionExpires: refused while the duration policy is undecided; with a policy it is read-only, approved by another person, expires and is audited', async () => {
  const { svc } = setup(), s = user('s1', ['SUPPORT']);
  const c = env('support_session.start', 'organization:org_house7', { reason: { code: 'CUSTOMER_REQUEST' }, payload: { minutes: 30, approvedBy: 'u9' } });
  const pv = await svc.preview(s, c);
  assert.equal(pv.allowed, false); assert.ok(pv.blockers.includes('SUPPORT_POLICY_NOT_CONFIGURED'));
  // the policy value is frozen config (null = necessita confirmação); the human decision is emulated by a handler with 60 min
  assert.equal(CFG.policies.supportSessionMaxMinutes.value, null);
  const { svc: s2, repo, advance, audit } = setup();
  s2.registerHandler({ ...svcHandler(repo), actionCode: 'support_session.start' });
  const pv2 = await s2.preview(s, c);
  assert.equal(pv2.allowed, true);
  const r = await s2.execute(s, { ...c, previewToken: pv2.previewToken });
  assert.equal(r.result.banner, 'Sessão de suporte ativa');
  assert.equal((await s2.activeSupportSessions(s, ORG)).length, 1);
  assert.ok(audit.events.some(e => e.action === 'ADMIN_SUPPORT_SESSION_START' && e.outcome === 'SUCCESS'));
  advance(31 * 60e3);
  assert.equal((await s2.activeSupportSessions(s, ORG)).length, 0, 'auto-expired');
});
/** a support handler equal to the built-in one but with a decided max duration of 60 min (stands in for the human decision) */
function svcHandler(repo) {
  return {
    async load({ resourceRef, organizationId }) { return { exists: resourceRef === 'organization:' + organizationId, organizationId, revision: null }; },
    async validate({ envelope, principal }) { const p = envelope.payload; const b = []; if (!(p.minutes >= 1 && p.minutes <= 60)) b.push('SUPPORT_DURATION_INVALID'); if (!p.approvedBy || p.approvedBy === principal.userId) b.push('SUPPORT_APPROVAL_REQUIRED'); return { blockers: b, warnings: ['SUPPORT_ACCESS_AUDITED'] }; },
    async apply({ envelope, principal, now }) { const s = await repo.support.insert({ supportUserId: principal.userId, targetOrganizationId: envelope.organizationId, reason: envelope.reason.code, startedAt: new Date(now).toISOString(), expiresAt: now + envelope.payload.minutes * 60e3, readOnly: true, approvedBy: envelope.payload.approvedBy, status: 'ACTIVE' }); return { result: { supportSessionId: s.id, banner: 'Sessão de suporte ativa' } }; }
  };
}

test('step-up required + AdminEmergencyShareDisable: without step-up refused; with it the public Share is disabled at scope, internal app stays active; never indefinite', async () => {
  const { svc } = setup();
  const c = env('emergency.activate', 'organization:org_house7', { reason: { code: 'SECURITY_RESPONSE' }, payload: { controlType: 'DISABLE_PUBLIC_SHARE', expiresAt: '2026-10-17T18:00:00Z' } });
  await rejects(svc.preview(user('k1', ['SEC']), c), 403, 'STEP_UP_REQUIRED');
  const strong = user('k1', ['SEC'], { assurance: 2 });
  const noExp = env('emergency.activate', 'organization:org_house7', { reason: { code: 'SECURITY_RESPONSE' }, payload: { controlType: 'DISABLE_PUBLIC_SHARE' } });
  assert.ok((await svc.preview(strong, noExp)).blockers.includes('EMERGENCY_EXPIRY_REQUIRED'));
  const pv = await svc.preview(strong, c);
  assert.ok(pv.warnings.includes('INTERNAL_APP_STAYS_ACTIVE'));
  await svc.execute(strong, { ...c, previewToken: pv.previewToken });
  assert.equal(await svc.isControlActive(ORG, 'DISABLE_PUBLIC_SHARE'), true);
  assert.equal(await svc.isControlActive(ORG, 'DISABLE_RESERVATION_WRITES'), false);
  assert.equal((await svc.activeEmergencyControls(strong, ORG))[0].controlType, 'DISABLE_PUBLIC_SHARE');
  assert.ok((await svc.preview(strong, env('emergency.activate', 'organization:org_house7', { reason: { code: 'SECURITY_RESPONSE' }, payload: { controlType: 'DISABLE_PUBLIC_SHARE', expiresAt: '2026-10-17T19:00:00Z' } }))).blockers.includes('EMERGENCY_ALREADY_ACTIVE'));
});

test('secrets: status only (configured/missing), never a value; second approval needed for permission changes while policy is undecided', async () => {
  const { svc } = setup();
  const s = svc.secretsStatus(user('u1', ['OPS']), ORG);
  assert.deepEqual(s.find(x => x.name === 'SESSION_SECRET'), { name: 'SESSION_SECRET', status: 'CONFIGURED' });
  assert.equal(s.find(x => x.name === 'DATABASE_URL').status, 'MISSING');
  assert.ok(!JSON.stringify(s).includes('xxxx'));
  assert.throws(() => svc.secretsStatus(user('u1', ['CONFIG']), ORG), e => e.status === 403);
  const sys = { type: 'SYSTEM', id: 'system:admin', status: 'ACTIVE' };
  await rejects(svc.preview({ ...sys, assuranceLevel: 2 }, env('permission.change', 'user:u9', { rev: '1', reason: { code: 'SECURITY_RESPONSE' } })), 403, 'SECOND_APPROVAL_REQUIRED');
  await rejects(svc.preview({ ...sys, assuranceLevel: 2 }, env('permission.change', 'user:u9', { rev: '1', reason: { code: 'SECURITY_RESPONSE' }, approvalRef: 'apr_1' })), 422, 'ACTION_NOT_SUPPORTED');
});

test('HTTP: routes reuse iam authentication (bearer ADMIN_API_TOKEN / session principal), CSRF on cookie writes, private no-store, error envelope without stack', async () => {
  const { svc } = setup();
  const router = createRouter(); registerBackofficeRoutes(router, { backoffice: svc });
  assert.equal(router.routes.length, ROUTES.length);
  const sessions = new Map([['cookie-ops', user('u1', ['OPS'])]]);
  const session = { enabled: true, authenticate: async req => sessions.get((req.headers.cookie || '').replace('sid=', '')) || ANONYMOUS, checkCsrf: req => req.headers['x-csrf-token'] === 'csrf-ok' };
  const authn = createAuthentication({ pool: null, config: { writeAuth: { credentials: [{ hash: crypto.createHash('sha256').update(ADMIN).digest(), actorId: 'admin', principal: 'admin', kind: 'ADMIN_API_TOKEN' }] }, auth: { devTokens: false } }, session });
  const server = http.createServer(async (req, res) => {
    const requestId = 'req_' + crypto.randomBytes(4).toString('hex');
    try {
      const url = new URL(req.url, 'http://x'); const { route, params } = router.match(req.method, url.pathname);
      let principal = await authn.authenticate(req);
      if (principal.viaSession && req.method !== 'GET' && !authn.checkCsrf(req, principal)) throw E.forbidden('CSRF_TOKEN_INVALID', 'csrf');
      let body = ''; for await (const ch of req) body += ch;
      const out = await route.handler({ req, params, query: url.searchParams, requestId, principal, readBody: async () => JSON.parse(body || '{}') });
      res.writeHead(out.status, { 'Content-Type': 'application/json', 'Cache-Control': out.cache }); res.end(JSON.stringify(out.body));
    } catch (e) { const r = toErrorResponse(e, requestId); res.writeHead(r.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(r.body)); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { headers = {}, body } = {}) => { const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, cache: r.headers.get('cache-control'), json: await r.json() }; };
  try {
    assert.equal((await call('GET', '/api/v1/admin/backoffice/navigation')).status, 401);
    const nav = await call('GET', '/api/v1/admin/backoffice/navigation', { headers: { Cookie: 'sid=cookie-ops' } });
    assert.equal(nav.status, 200); assert.equal(nav.cache, 'private, no-store'); assert.ok(nav.json.data.some(i => i.id === 'overview'));
    const sys = await call('GET', '/api/v1/admin/backoffice/secrets-status', { headers: { Authorization: 'Bearer ' + ADMIN, 'X-Organization-Id': ORG } });
    assert.equal(sys.status, 200); assert.ok(sys.json.data.every(s => Object.keys(s).sort().join() === 'name,status'));
    const c = env('workitem.assign', 'workitem:apr_9', { payload: { assignedToUserId: 'u3' } });
    assert.equal((await call('POST', '/api/v1/admin/commands/execute', { headers: { Cookie: 'sid=cookie-ops' }, body: c })).json.code, 'CSRF_TOKEN_INVALID');
    const ok = await call('POST', '/api/v1/admin/commands/execute', { headers: { Cookie: 'sid=cookie-ops', 'X-CSRF-Token': 'csrf-ok' }, body: c });
    assert.equal(ok.status, 200); assert.equal(ok.json.data.outcome, 'EXECUTED');
    const denied = await call('POST', '/api/v1/admin/commands/preview', { headers: { Cookie: 'sid=cookie-ops', 'X-CSRF-Token': 'csrf-ok' }, body: env('config.publish', 'config:Workflow_Policies:org_house7', { rev: '0', reason: { code: 'DATA_CORRECTION' } }) });
    assert.equal(denied.status, 403); assert.equal(denied.json.code, 'PERMISSION_DENIED'); assert.ok(denied.json.requestId); assert.ok(!JSON.stringify(denied.json).includes('at '), 'no stack');
  } finally { server.close(); }
});

test('metrics have no user labels; audit never carries free-text reasons', async () => {
  const { svc, audit } = setup();
  await svc.execute(user('u1', ['OPS']), env('workitem.assign', 'workitem:apr_1', { reason: { code: 'OTHER', text: 'cliente Fulano pediu' }, payload: { assignedToUserId: 'u3' } }));
  assert.ok(!JSON.stringify(audit.events).includes('Fulano'));
  const m = svc.metrics(); assert.equal(m.admin_command_total, 1); assert.ok(Object.keys(m).every(k => /^[a-z_]+$/.test(k)));
});
