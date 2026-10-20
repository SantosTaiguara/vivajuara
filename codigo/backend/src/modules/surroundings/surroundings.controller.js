'use strict';
/* HTTP routes of topic 63 (semantic proxy only — there is no generic Google relay, §114–§115, §561):
     GET  /api/v1/developments/:developmentId/environment-map-config     development.location_environment.read
     GET  /api/v1/developments/:developmentId/nearby-places?category&radius&rank   development.location_environment.read
     POST /api/v1/developments/:developmentId/route-estimates            development.location_environment.read
   Only category, radius and rank are accepted in the query (anything else → 400 VALIDATION_ERROR, so ?googleType=… or
   ?fieldMask=… never reach the provider). Organization = the owner resolved by the tenancy guard (access.resource),
   never a client-supplied value. Responses: { data, meta }, Cache-Control no-store for provider content (§317).
   NOT wired into src/app.js yet (shared file; see docs/RELATORIO_TOPICO_63.md for the integration recipe). */
const v = require('../../shared/validation');
const { CACHE, envelope } = require('../../shared/http/respond');
const { AppError } = require('../../shared/http/errors');

const PERMISSION = 'development.location_environment.read';
const ROUTE_POLICIES = Object.freeze({
  'GET /api/v1/developments/:developmentId/environment-map-config': { permission: PERMISSION, resource: 'development' },
  'GET /api/v1/developments/:developmentId/nearby-places': { permission: PERMISSION, resource: 'development' },
  'POST /api/v1/developments/:developmentId/route-estimates': { permission: PERMISSION, resource: 'development' }
});

function orgOf(ctx) {
  const o = ctx.access && ctx.access.resource && ctx.access.resource.organizationId;
  if (!o) throw new AppError(400, 'TENANT_CONTEXT_REQUIRED', 'Organização do empreendimento não resolvida');
  return o;
}
const actorOf = ctx => (ctx.principal && (ctx.principal.actorId || ctx.principal.idempotencyPrincipal)) || 'anonymous';

function registerSurroundingsRoutes(router, { surroundings }) {
  router.get('/api/v1/developments/:developmentId/environment-map-config', async ctx => {
    v.queryAllowlist(ctx.query, []);
    const developmentId = v.developmentId(ctx.params.developmentId);
    const data = await surroundings.environmentMapConfig({ organizationId: orgOf(ctx), developmentId });
    return { status: 200, body: envelope(ctx.requestId, { data, meta: {} }), cache: CACHE.PRIVATE };
  });
  router.get('/api/v1/developments/:developmentId/nearby-places', async ctx => {
    v.queryAllowlist(ctx.query, ['category', 'radius', 'rank']);
    for (const k of ['category', 'radius', 'rank']) if (ctx.query.getAll(k).length > 1) throw new AppError(400, 'VALIDATION_ERROR', 'Parâmetro repetido', [{ field: k, reason: 'duplicate' }]);
    const developmentId = v.developmentId(ctx.params.developmentId);
    const data = await surroundings.nearbyPlaces({ organizationId: orgOf(ctx), developmentId, actorKey: actorOf(ctx), requestId: ctx.requestId,
      category: ctx.query.get('category'), radius: ctx.query.get('radius'), rank: ctx.query.get('rank') });
    return { status: 200, body: envelope(ctx.requestId, { data, meta: {} }), cache: CACHE.NONE };
  });
  router.post('/api/v1/developments/:developmentId/route-estimates', async ctx => {
    v.queryAllowlist(ctx.query, []);
    const developmentId = v.developmentId(ctx.params.developmentId);
    const body = await ctx.readBody();
    const data = await surroundings.routeEstimate({ organizationId: orgOf(ctx), developmentId, actorKey: actorOf(ctx), requestId: ctx.requestId, body });
    return { status: 200, body: envelope(ctx.requestId, { data, meta: {} }), cache: CACHE.NONE };
  }, { csrf: true });
}

module.exports = { registerSurroundingsRoutes, ROUTE_POLICIES, PERMISSION };
