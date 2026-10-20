'use strict';
/* Topic 59 — HTTP adapter of the privacy admin API (NOT wired into src/app.js: see privacy.routes.js for the integration
   steps). All routes are admin, private, no-store. Domain refusals → 400/403/404/409/422; the domain code goes in
   details.reason. No personal value is ever logged or echoed in URLs (subjectRef is an opaque id). */
const { CACHE, envelope } = require('../../shared/http/respond');
const { PrivacyError } = require('./privacy.service');
const { BASE } = require('./privacy.routes');

const CODE = { 400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 409: 'REVISION_CONFLICT', 422: 'PRIVACY_RULE_DENIED' };
const principalOf = ctx => ctx.principal && { actorId: ctx.principal.actorId, organizationId: ctx.principal.organizationId, permissions: ctx.principal.permissions || [] };
const wrap = fn => async ctx => {
  try { const data = await fn(ctx); return { status: 200, body: envelope(ctx.requestId, { data, meta: {} }), cache: CACHE.NONE }; }
  catch (e) {
    if (!(e instanceof PrivacyError)) throw e;
    const err = new Error(e.message); err.status = e.status; err.code = e.code === 'TENANT_CONTEXT_REQUIRED' ? e.code : CODE[e.status] || 'PRIVACY_RULE_DENIED';
    err.details = { reason: e.code, ...e.details }; if (e.details && e.details.currentRevision != null) err.extra = { currentRevision: e.details.currentRevision };
    throw err;
  }
};
function registerPrivacyRoutes(router, { privacy: S }) {
  const P = principalOf, A = { admin: true };
  router.get(`${BASE}/registry`, wrap(ctx => S.registry(P(ctx))), A);
  router.get(`${BASE}/metrics`, wrap(ctx => S.metrics(P(ctx))), A);
  router.get(`${BASE}/audit`, wrap(ctx => S.audit(P(ctx))), A);
  router.get(`${BASE}/requests`, wrap(ctx => S.listRequests(P(ctx), { status: ctx.query.get('status') || undefined })), A);
  router.post(`${BASE}/requests`, wrap(async ctx => S.createRequest(P(ctx), await ctx.readBody())), A);
  router.get(`${BASE}/requests/:id`, wrap(ctx => S.getRequest(P(ctx), ctx.params.id)), A);
  router.post(`${BASE}/requests/:id/verification`, wrap(async ctx => S.startVerification(P(ctx), ctx.params.id, await ctx.readBody())), A);
  router.post(`${BASE}/requests/:id/verification/complete`, wrap(async ctx => S.completeVerification(P(ctx), ctx.params.id, await ctx.readBody())), A);
  router.post(`${BASE}/requests/:id/transition`, wrap(async ctx => S.transitionRequest(P(ctx), ctx.params.id, await ctx.readBody())), A);
  router.get(`${BASE}/consents`, wrap(ctx => S.listConsents(P(ctx), ctx.query.get('subjectRef'))), A);
  router.post(`${BASE}/consents`, wrap(async ctx => S.grantConsent(P(ctx), await ctx.readBody())), A);
  router.post(`${BASE}/consents/:id/withdraw`, wrap(ctx => S.withdrawConsent(P(ctx), ctx.params.id)), A);
  router.post(`${BASE}/suppressions`, wrap(async ctx => S.suppress(P(ctx), await ctx.readBody())), A);
  router.post(`${BASE}/legal-holds`, wrap(async ctx => S.createLegalHold(P(ctx), await ctx.readBody())), A);
  router.post(`${BASE}/legal-holds/:id/release`, wrap(ctx => S.releaseLegalHold(P(ctx), ctx.params.id)), A);
  router.post(`${BASE}/blocks`, wrap(async ctx => S.createBlock(P(ctx), await ctx.readBody())), A);
  router.get(`${BASE}/subjects/:subjectRef/state`, wrap(ctx => S.operationalState(P(ctx), ctx.params.subjectRef)), A);
  router.post(`${BASE}/retention/dry-run`, wrap(async ctx => S.retentionDryRun(P(ctx), await ctx.readBody())), A);
}
module.exports = { registerPrivacyRoutes };
