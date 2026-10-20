'use strict';
/* HTTP only: parse/validate params, call the service, choose cache policy and response schema. */
const v = require('../../shared/validation');
const { CACHE, envelope } = require('../../shared/http/respond');

const PAGE_SIZE_MAX = 100;

function registerDevelopmentRoutes(router, { developments, tenancy }) {
  router.get('/api/v1/developments', async ({ query, requestId, principal }) => {
    const q = v.parseQuery(query, { page: { type: 'int', min: 1, max: 100000, default: 1 }, pageSize: { type: 'int', min: 1, max: PAGE_SIZE_MAX, default: 20 } });
    const r = await developments.listDevelopments(q, tenancy.developmentScope(principal)); // topic 31: only visible developments
    return { status: 200, body: envelope(requestId, r), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'DevelopmentListResponse' };
  });
  router.get('/api/v1/developments/:developmentId', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await developments.getDevelopment(v.developmentId(params.developmentId));
    return { status: 200, body: envelope(requestId, r), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'DevelopmentResponse' };
  });
  router.get('/api/v1/developments/:developmentId/config', async ({ params, query }) => {
    v.queryAllowlist(query, []);
    const r = await developments.getConfig(v.developmentId(params.developmentId));
    return { status: 200, body: r.body, etagToken: r.etagToken, cache: CACHE.VERSIONED };
  });
  router.get('/api/v1/developments/:developmentId/manifest', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await developments.getManifest(v.developmentId(params.developmentId));
    return { status: 200, body: envelope(requestId, r), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'ManifestResponse' };
  });
  router.get('/api/v1/developments/:developmentId/sources', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await developments.listSources(v.developmentId(params.developmentId));
    return { status: 200, body: envelope(requestId, r), etagToken: r.etagToken, cache: CACHE.VERSIONED, schema: 'SourcesResponse' };
  });
}
module.exports = { registerDevelopmentRoutes };
