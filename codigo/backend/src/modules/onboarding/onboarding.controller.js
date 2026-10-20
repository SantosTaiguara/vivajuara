'use strict';
/* Topic 58 — HTTP routes (NOT wired into src/app.js: the integrator adds registerOnboardingRoutes + ROUTE_POLICIES to the
   router/routePolicies and the permission keys to modules/iam/permissions.js). Admin only, private, no-store; domain
   refusals → 401/403/404/409/422 with the domain code in details.reason. Writes need Idempotency-Key like other admin routes.
   Server inputs of a run (existing lots, current prices/availability, bounds) come from `serverInputs(ctx, batchId)`,
   never from the request body. */
const { CACHE, envelope } = require('../../shared/http/respond');
const { OnboardingError } = require('./onboarding.service');
const { ROUTES, BASE } = require('./onboarding.openapi');

const toExpress = p => p.replace(/\{(\w+)\}/g, ':$1');
const ROUTE_POLICIES = Object.freeze(Object.fromEntries(ROUTES.map(([m, p, , permission]) => [`${m.toUpperCase()} ${toExpress(p)}`, { permission }])));
const principalOf = ctx => ctx.principal && { actorId: ctx.principal.actorId, organizationId: ctx.principal.organizationId, permissions: ctx.principal.permissions || [] };
const wrap = fn => async ctx => {
  try { const data = await fn(ctx); return { status: 200, body: envelope(ctx.requestId, { data, meta: {} }), cache: CACHE.NONE }; }
  catch (e) {
    if (!(e instanceof OnboardingError)) throw e;
    const err = new Error(e.message); err.status = e.status;
    err.code = { 401: 'UNAUTHORIZED', 403: 'PERMISSION_DENIED', 404: 'NOT_FOUND', 409: 'CONFLICT' }[e.status] || 'VALIDATION_ERROR';
    err.details = { reason: e.code, ...e.details }; throw err;
  }
};
function registerOnboardingRoutes(router, { onboarding: S, serverInputs = async () => ({}), activator } = {}) {
  const P = principalOf, body = ctx => ctx.readBody().then(b => b || {});
  const h = {
    [`POST ${BASE}/cases`]: async ctx => S.createCase(P(ctx), await body(ctx)),
    [`GET ${BASE}/cases/:caseId`]: ctx => S.getCase(P(ctx), ctx.params.caseId),
    [`POST ${BASE}/cases/:caseId/cancel`]: ctx => S.cancelCase(P(ctx), ctx.params.caseId),
    [`GET ${BASE}/cases/:caseId/sources`]: ctx => S.listSources(P(ctx), ctx.params.caseId),
    [`POST ${BASE}/cases/:caseId/sources`]: async ctx => S.uploadSource(P(ctx), ctx.params.caseId, await body(ctx)),
    [`POST ${BASE}/cases/:caseId/authority`]: async ctx => S.declareAuthority(P(ctx), ctx.params.caseId, await body(ctx)),
    [`POST ${BASE}/sources/:sourceId/discover`]: ctx => S.discover(P(ctx), ctx.params.sourceId),
    [`PATCH ${BASE}/sources/:sourceId/mappings`]: async ctx => S.updateMappings(P(ctx), ctx.params.sourceId, await body(ctx)),
    [`POST ${BASE}/cases/:caseId/batches`]: async ctx => { const b = await body(ctx); return S.createBatch(P(ctx), ctx.params.caseId, { batchType: b.batchType, sourceAssetIds: b.sourceAssetIds }); },
    [`POST ${BASE}/batches/:batchId/run`]: async ctx => S.runBatch(P(ctx), ctx.params.batchId, { runMode: (await body(ctx)).runMode }, await serverInputs(ctx, ctx.params.batchId)),
    [`GET ${BASE}/batches/:batchId`]: ctx => S.getBatch(P(ctx), ctx.params.batchId),
    [`GET ${BASE}/batches/:batchId/progress`]: ctx => S.progress(P(ctx), ctx.params.batchId),
    [`GET ${BASE}/cases/:caseId/review-items`]: ctx => S.reviewQueue(P(ctx), ctx.params.caseId),
    [`POST ${BASE}/review-items/:reviewId/resolve`]: async ctx => S.resolveReview(P(ctx), ctx.params.reviewId, await body(ctx)),
    [`POST ${BASE}/conflicts/:conflictId/resolve`]: async ctx => S.resolveConflict(P(ctx), ctx.params.conflictId, await body(ctx)),
    [`POST ${BASE}/batches/:batchId/geometry-matches/:featureId/approve`]: ctx => S.approveGeometryMatch(P(ctx), ctx.params.batchId, ctx.params.featureId),
    [`GET ${BASE}/cases/:caseId/publication`]: ctx => S.publicationState(P(ctx), ctx.params.caseId),
    [`POST ${BASE}/cases/:caseId/publications/:publicationId/decision`]: async ctx => S.decide(P(ctx), ctx.params.caseId, ctx.params.publicationId, await body(ctx)),
    [`POST ${BASE}/cases/:caseId/publications/:publicationId/activate`]: async ctx => S.publish(P(ctx), ctx.params.caseId, ctx.params.publicationId, await body(ctx), { activator }),
    [`POST ${BASE}/cases/:caseId/rollback`]: async ctx => S.rollback(P(ctx), ctx.params.caseId, await body(ctx))
  };
  for (const [k, fn] of Object.entries(h)) { const [m, p] = k.split(' '); router[m.toLowerCase()](p, wrap(fn), { admin: true }); }
  return Object.keys(h);
}
module.exports = { registerOnboardingRoutes, ROUTE_POLICIES };
