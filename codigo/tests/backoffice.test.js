'use strict';
// Topic 60 — backoffice operacional / console administrativo (frontend side). Golden admin scenarios (§399-408).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

const FILES = ['config/backoffice/backofficeConfig.js', 'backoffice/backofficeCore.js', 'backoffice/backofficeCommands.js', 'backoffice/backofficeGovernance.js', 'backoffice/backofficeView.js'];
const ORG = 'org_house7', T0 = Date.parse('2026-10-17T12:00:00Z');
function fresh() {
  const App = load();
  for (const f of FILES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  return App;
}
const BO_ALL = ['backoffice.access', 'backoffice.inbox.view', 'backoffice.queue.assign', 'backoffice.approval.decide', 'backoffice.commercial.view', 'backoffice.data.view', 'backoffice.privacy.view',
  'backoffice.config.view', 'backoffice.config.publish', 'backoffice.integration.view', 'backoffice.export.create', 'backoffice.emergency.activate', 'backoffice.support_session.start', 'admin.audit.view', 'availability.write', 'provenance.resolveConflict'];
const me = (perms, o = {}) => ({ authenticated: true, principal: { type: 'USER', id: o.id || 'u1', displayName: 'Ana', status: 'ACTIVE', authenticationMethod: 'GOOGLE_OIDC' },
  organizationId: ORG, organization: { id: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE', developments: [{ id: 'viva-juara', visibility: 'PUBLIC' }] },
  memberships: [{ organizationId: ORG, slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE' }], roles: [], roleAssignments: [], permissions: perms, developmentPermissions: {}, policyVersion: 'iam-2026-10-08.1' });
const ctxOf = (App, perms, o) => { const r = App.authz.fromMe(me(perms, o), { developmentId: 'viva-juara', now: Date.now() } /* context freshness is real time (a fixed T0 goes stale after 24 h) */); assert.ok(r.ok, JSON.stringify(r.errors)); return r.context; };
const clone = x => JSON.parse(JSON.stringify(x));
const item = (id, o = {}) => ({ id, organizationId: ORG, type: o.type || 'approval', domain: 'commercial', severity: o.severity || 'MEDIUM', status: o.status || 'OPEN', title: o.title || `Item ${id}`,
  queueId: o.queueId || 'commercial.approvals', createdAt: '2026-10-16T10:00:00Z', updatedAt: o.updatedAt || '2026-10-16T10:00:00Z', dueAt: o.dueAt || null, overdue: !!o.overdue, actionRoute: o.route || `/admin/commercial/approvals/${id}` });
const dealsAdapter = (o = {}) => ({ id: 'deals', version: 'test', listInboxItems: () => o.inbox || [item('apr_1', { severity: 'HIGH' }), item('apr_2', { severity: 'CRITICAL', overdue: true })],
  listQueueItems: () => ({ items: o.queue || [item('apr_1'), item('apr_3', { status: 'WAITING' })], lastUpdatedAt: '2026-10-17T11:59:00Z' }),
  listApprovalTasks: () => o.tasks || [{ id: 'task_1', organizationId: ORG, domain: 'commercial', entityRef: 'proposal:prop_1', approvalType: 'DISCOUNT', requestedBy: 'u2', requestedAt: '2026-10-16T09:00:00Z', severity: 'HIGH', summary: 'Desconto acima da alçada na proposta prop_1', contextRefs: [], decisionActions: ['APPROVE', 'REJECT'] }] });
/** fake transport: records calls, answers like the backend contract */
function fakeServer(handler) { const calls = []; const t = async (p, body) => { calls.push({ path: p, body: clone(body) }); return handler(p, body); }; t.calls = calls; return t; }
const okPreview = env => ({ ok: true, status: 200, body: { data: { actionCode: env.actionCode, allowed: true, warnings: [], blockers: [], affectedEntities: [env.resourceRef], currentStateSummary: {}, proposedStateSummary: {}, requiredApprovals: [], expectedRevision: env.expectedRevision, previewToken: 'pv.tok', expiresAt: '2026-10-17T12:05:00Z' } } });

test('config validates: navigation/queues/actions reference registered permissions or are reported as unregistered', () => {
  const App = fresh();
  assert.deepEqual(clone(App.backoffice.validateConfig()), []);
  assert.deepEqual(clone(App.permissions.validate()), []);
  // domain permissions of other topics not registered yet → always denied (listed for the coordinator)
  for (const k of ['publication.publish', 'tenant.manage']) assert.ok(App.backoffice.unregisteredPermissions().includes(k), k);
  for (const k of App.permissions.list().filter(p => p.key.startsWith('backoffice.'))) assert.ok(!App.permissions.roles().some(r => r.grants.includes(k.key)), `no role grant for ${k.key}`);
  for (const [k, p] of Object.entries(App.backofficeConfig.policies)) assert.equal(p.value, null, `${k} undecided → null`);
});

test('AdminHomeShowsOnlyAuthorizedQueues: visitor sees no entry at all; navigation is permission-driven, deny by default', async () => {
  const App = fresh(), BO = App.backoffice, V = App.backofficeView;
  const pub = App.authz.context();
  assert.equal(pub.principal.type, 'ANONYMOUS');
  assert.equal(BO.entryVisible({ context: pub }), false);
  assert.equal(V.entryLink({ context: pub }), '');
  assert.deepEqual(clone(BO.navigation.getItems({ context: pub })), []);
  assert.equal(BO.shellContext({ context: pub }).allowed, false);
  // a broker (no backoffice permission) → nothing either
  const broker = ctxOf(App, App.permissions.grantsOf('BROKER'));
  assert.equal(BO.entryVisible({ context: broker }), false);
  assert.deepEqual(clone(BO.navigation.getItems({ context: broker })), []);
  // backoffice.access + commercial only
  const ops = ctxOf(App, ['backoffice.access', 'backoffice.inbox.view', 'backoffice.commercial.view']);
  const ids = BO.navigation.getItems({ context: ops }).map(i => i.id);
  assert.deepEqual(ids, ['overview', 'operations', 'approvals', 'commercial']);
  assert.match(V.entryLink({ context: ops }), /data-act="boOpen"/);
  assert.equal(BO.navigation.routeAccess('/admin/privacy/requests', { context: ops }).allowed, false);
  assert.equal(BO.navigation.routeAccess('/admin/commercial/approvals', { context: ops }).allowed, true);
  assert.equal(BO.navigation.routeAccess('/admin/../../db', { context: ops }).allowed, false);
  assert.deepEqual(BO.queues.visible({ context: ops }).map(q => q.provider).filter((v, i, a) => a.indexOf(v) === i), ['deals']);
  const sh = BO.shellContext({ context: ops });
  assert.equal(sh.tenantLabel, 'Organização ativa: House 7 Imóveis');
  // inbox: provider missing → "módulo não disponível", never counts of hidden areas
  const r = await BO.inbox.build({ context: ops, now: T0 });
  assert.equal(r.allowed, true); assert.equal(r.items.length, 0);
  assert.equal(r.providers.deals.status, 'MODULE_UNAVAILABLE'); assert.equal(r.providers.deals.message, 'Módulo não disponível.');
  assert.ok(!('privacy' in r.providers), 'privacy provider not even queried');
  App.deals = {}; assert.equal(BO.provider('deals').status, 'MODULE_NOT_INTEGRATED');
  App.deals = { backofficeAdapter: dealsAdapter() };
  const r2 = await BO.inbox.build({ context: ops, now: T0 });
  assert.deepEqual(r2.items.map(i => i.id), ['apr_2', 'apr_1'], 'CRITICAL first');
  assert.deepEqual(r2.sections.urgent.map(i => i.id), ['apr_2']);
  const html = V.home(r2);
  assert.match(html, /Urgente/); assert.match(html, /Crítica/); assert.match(html, /não é fonte de verdade/);
});

test('inbox projection drops other tenants, PII summaries, unknown queues and unsafe routes; dedupes', async () => {
  const App = fresh(), BO = App.backoffice;
  const ops = ctxOf(App, ['backoffice.access', 'backoffice.inbox.view', 'backoffice.commercial.view']);
  App.deals = { backofficeAdapter: dealsAdapter({ inbox: [item('a'), { ...item('b'), organizationId: 'org_other' }, item('c', { title: 'Cliente joao@example.com pediu' }), item('d', { queueId: 'privacy.incidents' }),
    item('e', { route: 'javascript:alert(1)' }), item('a', { updatedAt: '2026-10-17T00:00:00Z', severity: 'HIGH' }), item('f', { status: 'RESOLVED' })] }) };
  const r = await BO.inbox.build({ context: ops, now: T0 });
  assert.deepEqual(r.items.map(i => i.id).sort(), ['a', 'e']);
  assert.equal(r.items.find(i => i.id === 'a').severity, 'HIGH', 'newest wins');
  assert.equal(r.items.find(i => i.id === 'e').actionRoute, null);
  // provider throwing → PROVIDER_ERROR, no stack
  App.deals = { backofficeAdapter: { listInboxItems() { throw new Error('boom at /srv/x.js:1'); } } };
  const r2 = await BO.inbox.build({ context: ops, now: T0 });
  assert.equal(r2.providers.deals.status, 'PROVIDER_ERROR'); assert.ok(!JSON.stringify(r2).includes('boom'));
});

test('work queue: allowlisted filters/sort/page size, actions hidden without permission, bulk refused while limit is not configured', async () => {
  const App = fresh(), BO = App.backoffice;
  App.deals = { backofficeAdapter: dealsAdapter() };
  const ops = ctxOf(App, ['backoffice.access', 'backoffice.inbox.view', 'backoffice.commercial.view']);
  assert.equal((await BO.queues.view('commercial.approvals', { filters: [{ field: 'title', op: 'like', value: '%' }] }, { context: ops })).code, 'FILTER_NOT_ALLOWED');
  assert.equal((await BO.queues.view('commercial.approvals', { sort: 'customerName:asc' }, { context: ops })).code, 'SORT_NOT_ALLOWED');
  assert.equal((await BO.queues.view('commercial.approvals', { pageSize: 1000 }, { context: ops })).code, 'PAGE_SIZE_EXCEEDED');
  assert.equal((await BO.queues.view('privacy.subject_requests', {}, { context: ops })).code, 'NOT_AUTHORIZED');
  const v = await BO.queues.view('commercial.approvals', { filters: [{ field: 'status', op: 'eq', value: 'OPEN' }] }, { context: ops });
  assert.equal(v.ok, true); assert.deepEqual(v.items.map(i => i.id), ['apr_1']);
  assert.deepEqual(v.actions.map(a => a.actionCode), [], 'no assign / decide permission → actions hidden');
  const ops2 = ctxOf(App, ['backoffice.access', 'backoffice.inbox.view', 'backoffice.commercial.view', 'backoffice.queue.assign']);
  const v2 = await BO.queues.view('commercial.reservations_expiring', {}, { context: ops2 });
  assert.deepEqual(v2.actions.map(a => a.actionCode), ['workitem.assign'], 'reservation.release is not registered → never shown');
  const b = BO.bulk.evaluate('workitem.assign', [{ status: 'OPEN' }], { context: ops2 });
  assert.equal(b.code, 'BULK_LIMIT_NOT_CONFIGURED');
  assert.equal(BO.bulk.evaluate('reservation.release', [{ status: 'OPEN' }]).code, 'BULK_DISABLED');
  assert.match(App.backofficeView.queue(v2), /Reservas próximas de expirar/);
});

test('AdminCommercialApprovalSeparationOfDuties + AdminCommercialApprovalAccepted', async () => {
  const App = fresh(), BO = App.backoffice;
  App.deals = { backofficeAdapter: dealsAdapter() };
  const approver = ctxOf(App, ['backoffice.access', 'backoffice.inbox.view', 'backoffice.commercial.view', 'backoffice.approval.decide'], { id: 'u1' });
  const requester = ctxOf(App, ['backoffice.access', 'backoffice.inbox.view', 'backoffice.commercial.view', 'backoffice.approval.decide'], { id: 'u2' });
  const list = await BO.approvals.list({ context: approver });
  assert.equal(list.tasks.length, 1);
  assert.equal(BO.approvals.separationOfDuties(), true, 'policy null → requester cannot approve');
  assert.equal(BO.approvals.canDecide(list.tasks[0], 'commercial.approval.decide', { context: requester, connectivity: 'ONLINE' }).code, 'SELF_APPROVAL_FORBIDDEN');
  assert.equal(BO.approvals.canDecide(list.tasks[0], 'commercial.approval.decide', { context: approver, connectivity: 'ONLINE' }).ok, true);
  // decision goes through the command contract: reason required, preview, execute — result comes from the server
  const C = BO.commands;
  assert.equal(C.envelope({ actionCode: 'commercial.approval.decide', resourceRef: 'proposal:prop_1', expectedRevision: '7', payload: { decision: 'APPROVE' } }, { context: approver }).code, 'REASON_REQUIRED');
  const e = C.envelope({ actionCode: 'commercial.approval.decide', resourceRef: 'proposal:prop_1', expectedRevision: '7', reason: { code: 'COMMERCIAL_EXCEPTION' }, payload: { decision: 'APPROVE', taskId: 'task_1' } }, { context: approver });
  assert.equal(e.ok, true); assert.equal(e.envelope.organizationId, ORG);
  const srv = fakeServer((p, body) => p.endsWith('/preview') ? okPreview(body.envelope) : { ok: true, status: 200, body: { data: { outcome: 'EXECUTED', newRevision: '8' }, meta: { requestId: 'req_1' } } });
  const pv = await C.preview(e.envelope, { context: approver, connectivity: 'ONLINE', transport: srv });
  assert.equal(pv.ok, true); assert.match(App.backofficeView.preview(pv, BO.actionPolicy('commercial.approval.decide')), /será registrada na auditoria/);
  const ex = await C.execute(e.envelope, pv.preview, { context: approver, connectivity: 'ONLINE', transport: srv, now: T0 });
  assert.equal(ex.ok, true); assert.equal(ex.result.newRevision, '8'); assert.equal(srv.calls[1].body.previewToken, 'pv.tok');
});

test('AdminReasonRegistry + no backend → BACKEND_UNAVAILABLE (UI never invents a result); offline → no critical write', async () => {
  const App = fresh(), C = App.backoffice.commands;
  const ctx = ctxOf(App, ['backoffice.access', 'availability.write']);
  assert.equal(C.envelope({ actionCode: 'availability.override', resourceRef: 'lot:VJ-QB-L0079', expectedRevision: '5', reason: { code: 'NOPE' } }, { context: ctx }).code, 'REASON_INVALID');
  assert.equal(C.envelope({ actionCode: 'availability.override', resourceRef: 'lot:VJ-QB-L0079', expectedRevision: '5', reason: { code: 'OTHER' } }, { context: ctx }).code, 'REASON_TEXT_REQUIRED');
  assert.equal(C.envelope({ actionCode: 'availability.override', resourceRef: 'lot:VJ-QB-L0079', reason: { code: 'DATA_CORRECTION' } }, { context: ctx }).code, 'EXPECTED_REVISION_REQUIRED');
  assert.equal(C.envelope({ actionCode: 'availability.override', resourceRef: 'customer:ana@x.com', expectedRevision: '5', reason: { code: 'DATA_CORRECTION' } }, { context: ctx }).code, 'RESOURCE_REF_INVALID');
  assert.equal(C.envelope({ actionCode: 'db.update', resourceRef: 'lot:x' }, { context: ctx }).code, 'UNKNOWN_ACTION', 'no generic edit-DB command');
  const e = C.envelope({ actionCode: 'availability.override', resourceRef: 'lot:VJ-QB-L0079', expectedRevision: '5', reason: { code: 'DATA_CORRECTION' }, payload: { requestedStatus: 'RESERVED' } }, { context: ctx });
  assert.equal((await C.preview(e.envelope, { context: ctx, connectivity: 'ONLINE' })).code, 'BACKEND_UNAVAILABLE');
  assert.equal((await C.preview(e.envelope, { context: ctx, connectivity: 'OFFLINE' })).code, 'OFFLINE');
});

test('AdminAvailabilityOverrideRevisionConflict: R5 vs R6 → conflict with current diff, never overwrite', async () => {
  const App = fresh(), C = App.backoffice.commands, V = App.backofficeView;
  const ctx = ctxOf(App, ['backoffice.access', 'availability.write']);
  const e = C.envelope({ actionCode: 'availability.override', resourceRef: 'lot:VJ-QB-L0079', expectedRevision: '5', reason: { code: 'DATA_CORRECTION' }, payload: { requestedStatus: 'RESERVED' } }, { context: ctx }).envelope;
  const srv = fakeServer((p, body) => p.endsWith('/preview') ? okPreview(body.envelope)
    : { ok: false, status: 409, body: { code: 'REVISION_CONFLICT', message: 'x', currentRevision: '6', requestId: 'req_c', details: { expectedRevision: '5', diff: [{ field: 'status', before: 'UNKNOWN', after: 'RESERVED' }] } } });
  const pv = await C.preview(e, { context: ctx, connectivity: 'ONLINE', transport: srv });
  const ex = await C.execute(e, pv.preview, { context: ctx, connectivity: 'ONLINE', transport: srv, now: T0 });
  assert.equal(ex.ok, false); assert.equal(ex.code, 'REVISION_CONFLICT'); assert.equal(ex.conflict.currentRevision, '6'); assert.equal(ex.requestId, 'req_c');
  const html = V.error(ex);
  assert.match(html, /O registro mudou desde que você abriu/); assert.match(html, /Sua versão/); assert.ok(!/409/.test(html));
  // stale preview / mismatching revision refused locally
  assert.equal((await C.execute(e, { ...pv.preview, expiresAt: '2026-10-17T11:00:00Z' }, { context: ctx, connectivity: 'ONLINE', transport: srv, now: T0 })).code, 'PREVIEW_EXPIRED');
  assert.equal((await C.execute({ ...e, expectedRevision: '4' }, pv.preview, { context: ctx, connectivity: 'ONLINE', transport: srv, now: T0 })).code, 'PREVIEW_MISMATCH');
  assert.equal((await C.execute(e, null, { context: ctx, connectivity: 'ONLINE', transport: srv, now: T0 })).code, 'PREVIEW_REQUIRED');
  assert.equal((await C.execute(e, { ...pv.preview, blockers: ['LOT_SOLD'] }, { context: ctx, connectivity: 'ONLINE', transport: srv, now: T0 })).code, 'PREVIEW_BLOCKED');
  const G = App.backoffice.governance;
  assert.equal(G.validateOverride({ lotId: 'VJ-QB-L0079', requestedStatus: 'RESERVED', reason: { code: 'DATA_CORRECTION' } }).code, 'EXPECTED_REVISION_REQUIRED');
  assert.match(G.overrideWarning({ expiresAt: '2026-10-17T14:00:00Z' }, T0), /Override manual ativo até 14:00/);
});

test('step-up required: CRITICAL actions listed by the spec are blocked while no step-up method exists', async () => {
  const App = fresh(), C = App.backoffice.commands;
  const ctx = ctxOf(App, ['backoffice.access', 'backoffice.emergency.activate', 'price_table.publish']);
  const e = C.envelope({ actionCode: 'emergency.activate', resourceRef: 'organization:org_house7', reason: { code: 'SECURITY_RESPONSE' }, payload: { controlType: 'DISABLE_PUBLIC_SHARE' } }, { context: ctx }).envelope;
  const r = await C.preview(e, { context: ctx, connectivity: 'ONLINE', transport: fakeServer(() => okPreview(e)) });
  assert.equal(r.code, 'STEP_UP_REQUIRED'); assert.equal(r.stepUpPolicyStatus, 'necessita confirmação');
  // permission change needs a second approval while the policy is undecided (fail closed)
  const c2 = ctxOf(App, ['backoffice.access', 'backoffice.access_admin.change']);
  const e2 = C.envelope({ actionCode: 'permission.change', resourceRef: 'user:u9', expectedRevision: '1', reason: { code: 'SECURITY_RESPONSE' } }, { context: c2 }).envelope;
  assert.equal(C.precheck(e2, { context: c2, connectivity: 'ONLINE', stepUpSatisfied: true }).code, 'SECOND_APPROVAL_REQUIRED');
});

test('AdminCrossTenantDenied: envelope for another organization and cross-tenant search are refused', () => {
  const App = fresh(), G = App.backoffice.governance;
  const ctx = ctxOf(App, ['backoffice.access', 'availability.write']);
  assert.equal(App.backoffice.commands.envelope({ actionCode: 'availability.override', organizationId: 'org_imobx', resourceRef: 'lot:X-1', expectedRevision: '1', reason: { code: 'DATA_CORRECTION' } }, { context: ctx }).code, 'CROSS_TENANT');
  assert.equal(G.searchRequest('B79', {}).code, 'SEARCH_SCOPE_REQUIRED');
  assert.equal(G.searchRequest('B79', { organizationId: ORG, crossTenant: true }).code, 'CROSS_TENANT_SEARCH_DENIED');
  const s = G.searchRequest('123.456.789-09', { organizationId: ORG, category: 'customer' });
  assert.equal(s.persistInUrl, false); assert.equal(s.request.method, 'POST'); assert.equal(s.auditRequired, true);
  assert.equal(G.safeAdminRoute('/admin/proposals/prop_x'), true);
  assert.equal(G.safeAdminRoute('/admin/customers/ana@x.com'), false);
});

test('AdminUserPermissionEscalationPreview: added/removed/high-risk highlighted; unknown or system permission refused', () => {
  const App = fresh(), G = App.backoffice.governance;
  const p = G.accessChangePreview('u9', ['lot.view', 'share.create'], ['lot.view', 'availability.write', 'price_table.publish'], ['org_house7']);
  assert.deepEqual(clone(p.addedPermissions), ['availability.write', 'price_table.publish']);
  assert.deepEqual(clone(p.removedPermissions), ['share.create']);
  assert.deepEqual(clone(p.newHighRiskPermissions), ['availability.write', 'price_table.publish']);
  assert.equal(p.requiresApproval, true);
  assert.equal(G.accessChangePreview('u9', [], ['lot.teleport']).code, 'UNKNOWN_PERMISSION');
  assert.equal(G.accessChangePreview('u9', [], ['platform.cross_tenant']).systemOnlyBlocked, true);
});

test('AdminConfigVersionPublish + rollback: diff mandatory, schema required, SoD, published immutable, restore = new version', () => {
  const App = fresh(), G = App.backoffice.governance;
  const schema = c => c.reservationHours === undefined ? ['reservationHours obrigatório'] : [];
  assert.equal(G.proposeConfigChange({ configType: 'Workflow Policies', scopeRef: 'org_house7', currentVersion: '3', current: { a: 1 }, proposed: { a: 2 }, requestedBy: 'u1' }).code, 'CONFIG_SCHEMA_MISSING');
  assert.equal(G.proposeConfigChange({ configType: 'Workflow Policies', scopeRef: 'org_house7', currentVersion: '3', current: { a: 1 }, proposed: { a: 2 }, requestedBy: 'u1', schema }).code, 'CONFIG_SCHEMA_INVALID');
  const r = G.proposeConfigChange({ configType: 'Workflow Policies', scopeRef: 'org_house7', currentVersion: '3', current: { reservationHours: null, notify: { channel: 'x' } }, proposed: { reservationHours: null, notify: { channel: 'y' }, apiToken: 'abc' }, requestedBy: 'u1', schema, now: T0 });
  assert.equal(r.ok, true); assert.equal(r.change.proposedVersion, '4'); assert.equal(r.change.reviewKind, 'BUSINESS_REVIEW');
  assert.deepEqual(clone(r.change.diff), [{ field: 'apiToken', before: null, after: '••••', masked: true }, { field: 'notify.channel', before: 'x', after: 'y', masked: false }]);
  let c = G.transitionConfig(r.change, 'REVIEW').change;
  assert.equal(G.transitionConfig(c, 'PUBLISHED').code, 'INVALID_CONFIG_TRANSITION');
  assert.equal(G.transitionConfig(c, 'APPROVED', { actorId: 'u1' }).code, 'SELF_APPROVAL_FORBIDDEN');
  c = G.transitionConfig(c, 'APPROVED', { actorId: 'u2', approvalRef: 'apr_9' }).change;
  c = G.transitionConfig(c, 'PUBLISHED').change; assert.equal(c.status, 'PUBLISHED');
  assert.equal(G.editPublished(c).code, 'PUBLISHED_VERSION_IMMUTABLE');
  const rb = G.rollbackPlan([{ version: 3, content: { a: 1 } }, { version: 4, content: { a: 2 }, current: true }], '3');
  assert.equal(rb.newVersion, '5'); assert.equal(rb.restoresContentOf, '3'); assert.ok(rb.dynamicDomainsUntouched.includes('availability'));
  assert.match(App.backofficeView.configChange(r.change), /••••/); assert.ok(!App.backofficeView.configChange(r.change).includes('abc'));
});

test('AdminFeatureFlagSunsetWarning + AdminEmergencyShareDisable + AdminSupportSessionExpires', () => {
  const App = fresh(), G = App.backoffice.governance, V = App.backofficeView;
  assert.deepEqual(clone(G.reviewFlag({ id: 'f', scope: 'GLOBAL', owner: 'x', purpose: 'y', riskLevel: 'LOW', expiresAt: '2026-10-01T00:00:00Z' }, T0).warnings), ['FLAG_EXPIRED']);
  assert.ok(G.reviewFlag({ id: 'f', scope: 'GLOBAL', purpose: 'y', riskLevel: 'LOW', migration: true }, T0).errors.includes('MIGRATION_FLAG_WITHOUT_SUNSET'));
  assert.ok(G.reviewFlag({ id: 'f', scope: 'GLOBAL', purpose: 'y', riskLevel: 'LOW' }, T0).errors.includes('FLAG_OWNER_MISSING'));
  assert.equal(G.validateEmergency({ controlType: 'DISABLE_PUBLIC_SHARE', scopeRef: 'org_house7', reason: { code: 'SECURITY_RESPONSE' } }, T0).code, 'EMERGENCY_EXPIRY_REQUIRED');
  const em = G.validateEmergency({ controlType: 'DISABLE_PUBLIC_SHARE', scopeRef: 'org_house7', reason: { code: 'SECURITY_RESPONSE' }, expiresAt: '2026-10-17T18:00:00Z' }, T0);
  assert.deepEqual(clone(em.effect), { publicShare: 'DISABLED', internalApp: 'ACTIVE' });
  assert.match(V.emergencyStrip([{ controlType: 'DISABLE_PUBLIC_SHARE', scopeRef: 'org_house7', status: 'ACTIVE', expiresAt: '2026-10-17T18:00:00Z' }]), /Desativar compartilhamento público/);
  assert.equal(G.validateSupportRequest({ supportUserId: 's1', targetOrganizationId: ORG, reason: { code: 'CUSTOMER_REQUEST' }, minutes: 30 }).code, 'SUPPORT_POLICY_NOT_CONFIGURED');
  const s = { id: 'sup_1', supportUserId: 's1', targetOrganizationId: ORG, reason: 'CUSTOMER_REQUEST', startedAt: '2026-10-17T11:50:00Z', expiresAt: '2026-10-17T12:20:00Z', readOnly: true, status: 'ACTIVE' };
  const b = G.supportBanner(s, T0);
  assert.equal(b.text, 'Sessão de suporte ativa'); assert.match(V.supportBanner(b), /Sessão de suporte ativa/);
  assert.equal(G.supportBanner(s, Date.parse('2026-10-17T12:21:00Z')), null, 'auto-expires');
  assert.equal(G.supportState(s, Date.parse('2026-10-17T12:21:00Z')).status, 'EXPIRED');
});

test('AdminBulkExportAudited (client part) + CSV formula injection + secrets status only', () => {
  const App = fresh(), G = App.backoffice.governance, V = App.backofficeView;
  const p = G.exportPreview({ domain: 'customers', rows: 120, fields: [{ key: 'name', classification: 'CONFIDENTIAL' }, { key: 'x' }], filters: ['status=ACTIVE'] });
  assert.equal(p.privacyClassification, 'RESTRICTED'); assert.equal(p.requiresReason, true); assert.equal(p.auditRequired, true); assert.equal(p.linkTtlPolicy, 'necessita confirmação');
  assert.equal(G.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"'); assert.equal(G.csvCell('+1'), "'+1"); assert.equal(G.csvCell(null), '');
  const sv = G.secretsView([{ name: 'GOOGLE_CLIENT_SECRET', status: 'MISSING', value: 'should-never-show' }, { name: 'SESSION_SECRET', status: 'CONFIGURED' }, { name: 'RANDOM', status: 'CONFIGURED' }]);
  assert.ok(!JSON.stringify(sv).includes('should-never-show')); assert.ok(!sv.some(s => s.name === 'RANDOM'));
  assert.equal(sv.find(s => s.name === 'DATABASE_URL').label, 'não disponível');
  assert.ok(!V.secrets(sv).includes('should-never-show'));
});

test('AdminIntegrationRetrySafeJob + AdminUnsafeJobReplayBlocked + audit view read-only + data repair dry-run', () => {
  const App = fresh(), G = App.backoffice.governance;
  assert.equal(G.jobActions({ status: 'FAILED', retrySafe: true }).retry.visible, true);
  assert.equal(G.jobActions({ status: 'FAILED', retrySafe: false }).retry.visible, false);
  assert.equal(G.jobActions({ status: 'DEAD_LETTER', idempotencyAnalysis: 'UNKNOWN' }).replay.reason, 'UNSAFE_REPLAY_BLOCKED');
  const ev = G.auditView([{ id: 'a1', action: 'config.publish', resourceType: 'config', timestamp: '2026-10-17T10:00:00Z', outcome: 'SUCCESS', metadata: { secret: 'x' }, beforeRef: 'b' }], { action: 'config.publish' });
  assert.equal(ev.length, 1); assert.ok(!('metadata' in ev[0]) && !('beforeRef' in ev[0])); assert.ok(Object.isFrozen(ev[0]));
  assert.equal(G.validateRepair({ repairType: 'FIX_AREA', targetRef: 'lot:x', reason: { code: 'DATA_CORRECTION' }, sourceEvidenceRefs: ['src:1'] }).code, 'DRY_RUN_REQUIRED');
  assert.equal(G.validateRepair({ repairType: 'REBUILD_INDEX', targetRef: 'idx:x', reason: { code: 'SYSTEM_RECOVERY' }, sourceEvidenceRefs: ['src:1'], mode: 'DRY_RUN', derived: true }).kind, 'REBUILD_DERIVED');
});

test('assignment ≠ authorization; claims inform; views escape everything; published panel unchanged for the visitor', () => {
  const App = fresh(), BO = App.backoffice, V = App.backofficeView;
  assert.equal(BO.assignments.checkAssigneeCanAct(['lot.view'], 'availability.override').flag, 'ACCESS_CONFIGURATION_ISSUE');
  assert.equal(BO.assignments.claimState({ claim: { claimedBy: 'u2', expiresAt: '2026-10-17T13:00:00Z' } }, 'u1', T0).code, 'CLAIM_HELD');
  assert.equal(BO.assignments.claimState({ claim: { claimedBy: 'u2', expiresAt: '2026-10-17T11:00:00Z' } }, 'u1', T0).claimed, false);
  const html = V.itemsTable([BO.inbox.normalizeItem(item('x', { title: '<img src=x onerror=alert(1)>' }), 'commercial', ORG)], { caption: 'T' });
  assert.ok(!html.includes('<img')); assert.match(html, /<caption>T<\/caption>/); assert.match(html, /scope="col"/);
  assert.match(V.denied(), /Acesso negado/);
  // new modules are not part of the harness ORDER / build: the shipped panel has no App.backoffice
  const plain = load(); assert.equal(plain.backoffice, undefined);
  const css = path.join(SRC, 'backoffice/backoffice.css');
  if (fs.existsSync(css)) assert.ok(!/#[0-9a-f]{3,6}\b/i.test(fs.readFileSync(css, 'utf8')), 'tokens only');
});
