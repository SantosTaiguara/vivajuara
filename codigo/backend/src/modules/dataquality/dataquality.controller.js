'use strict';
/* Topic 61 — HTTP routes (NOT wired into src/app.js yet: the integrator adds registerDataQualityRoutes + ROUTE_POLICIES and
   the permission keys to modules/iam/permissions.js). All admin, private, no-store; domain refusals → 422/403/404 with the DQ code
   in details.reason. Writes need Idempotency-Key like the other admin routes. */
const { CACHE, envelope } = require('../../shared/http/respond');
const { DataQualityError } = require('./dataquality.service');

const BASE = '/api/v1/admin/data-quality', GOV = '/api/v1/admin/data-governance';
const ROUTE_POLICIES = Object.freeze({
  [`GET ${BASE}/health`]: { permission: 'data_quality.read' }, [`GET ${BASE}/findings`]: { permission: 'data_quality.read' }, [`GET ${BASE}/findings/:id`]: { permission: 'data_quality.read' },
  [`POST ${BASE}/findings/:id/acknowledge`]: { permission: 'data_quality.manage_findings' }, [`POST ${BASE}/findings/:id/resolve`]: { permission: 'data_quality.manage_findings' },
  [`POST ${BASE}/exceptions`]: { permission: 'data_quality.create_exception' }, [`POST ${BASE}/exceptions/:id/approve`]: { permission: 'data_quality.approve_exception' },
  [`GET ${BASE}/rules`]: { permission: 'data_quality.read' }, [`POST ${BASE}/rules/:id/run`]: { permission: 'data_quality.run_checks' }, [`POST ${BASE}/gates/evaluate`]: { permission: 'data_quality.run_checks' },
  [`GET ${BASE}/incidents`]: { permission: 'data_quality.read' }, [`POST ${BASE}/incidents`]: { permission: 'data_quality.manage_incident' },
  [`GET ${GOV}/contracts`]: { permission: 'data_quality.read' }, [`GET ${GOV}/catalog`]: { permission: 'data_quality.read' }
});
const principalOf = ctx => ctx.principal && { actorId: ctx.principal.actorId, organizationId: ctx.principal.organizationId, permissions: ctx.principal.permissions || [] };
const wrap = fn => async ctx => {
  try { const data = await fn(ctx); return { status: 200, body: envelope(ctx.requestId, { data, meta: {} }), cache: CACHE.NONE }; }
  catch (e) { if (e instanceof DataQualityError) { const err = new Error(e.message); err.status = e.status; err.code = e.status === 403 ? 'PERMISSION_DENIED' : e.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR'; err.details = { reason: e.code, ...e.details }; throw err; } throw e; }
};
function registerDataQualityRoutes(router, { dataQuality: S }) {
  const dev = ctx => ctx.query.get('developmentId') || 'viva-juara';
  router.get(`${BASE}/health`, wrap(ctx => S.health(principalOf(ctx), { developmentId: dev(ctx) })), { admin: true });
  router.get(`${BASE}/findings`, wrap(ctx => S.listFindings(principalOf(ctx), Object.fromEntries(['domain', 'severity', 'ruleId', 'status', 'ownerRef', 'developmentId'].map(k => [k, ctx.query.get(k)]).filter(([, v]) => v)))), { admin: true });
  router.get(`${BASE}/findings/:id`, wrap(ctx => S.getFinding(principalOf(ctx), ctx.params.id)), { admin: true });
  router.post(`${BASE}/findings/:id/acknowledge`, wrap(ctx => S.acknowledgeFinding(principalOf(ctx), ctx.params.id)), { admin: true });
  router.post(`${BASE}/findings/:id/resolve`, wrap(async ctx => S.resolveFinding(principalOf(ctx), ctx.params.id, await ctx.readBody())), { admin: true });
  router.post(`${BASE}/exceptions`, wrap(async ctx => S.createException(principalOf(ctx), await ctx.readBody())), { admin: true });
  router.post(`${BASE}/exceptions/:id/approve`, wrap(ctx => S.approveException(principalOf(ctx), ctx.params.id)), { admin: true });
  router.get(`${BASE}/rules`, wrap(ctx => S.listRules(principalOf(ctx), { developmentId: dev(ctx) })), { admin: true });
  router.post(`${BASE}/rules/:id/run`, wrap(async ctx => S.runChecks(principalOf(ctx), { developmentId: dev(ctx), ruleIds: [ctx.params.id], input: (await ctx.readBody()) || {} })), { admin: true });
  router.post(`${BASE}/gates/evaluate`, wrap(async ctx => S.evaluateGate(principalOf(ctx), await ctx.readBody())), { admin: true });
  router.get(`${BASE}/incidents`, wrap(ctx => S.listIncidents(principalOf(ctx))), { admin: true });
  router.post(`${BASE}/incidents`, wrap(async ctx => S.createIncident(principalOf(ctx), await ctx.readBody())), { admin: true });
  router.get(`${GOV}/contracts`, wrap(ctx => S.contracts(principalOf(ctx), { developmentId: dev(ctx) })), { admin: true });
  router.get(`${GOV}/catalog`, wrap(ctx => S.catalog(principalOf(ctx), { developmentId: dev(ctx) })), { admin: true });
}
module.exports = { registerDataQualityRoutes, ROUTE_POLICIES, BASE, GOV };
