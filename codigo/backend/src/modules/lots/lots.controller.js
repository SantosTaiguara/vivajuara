'use strict';
/* HTTP only: parse + validate input, call the use case, pick cache policy and response schema. No SQL, no rules. */
const v = require('../../shared/validation');
const { CACHE, envelope } = require('../../shared/http/respond');
const { E } = require('../../shared/http/errors');
const lq = require('./lots.query');

function registerLotRoutes(router, { lots, tenancy }, App) {
  router.get('/api/v1/developments/:developmentId/lots/static', async ({ params, query }) => {
    v.queryAllowlist(query, []);
    const r = await lots.getStaticSnapshot(v.developmentId(params.developmentId));
    return { status: 200, build: r.build, etagToken: r.etagToken, cache: CACHE.STATIC };
  });
  router.get('/api/v1/developments/:developmentId/map-lots', async ({ params, query }) => {
    v.queryAllowlist(query, []);
    const r = await lots.getMapLots(v.developmentId(params.developmentId));
    return { status: 200, build: r.build, etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'MapLotsResponse' };
  });
  router.get('/api/v1/developments/:developmentId/lots', async ({ params, query, requestId }) => {
    const devId = v.developmentId(params.developmentId);
    const { q, canonical } = lq.parseListQuery(query, App);
    const r = await lots.listLots(devId, q, canonical);
    return { status: 200, build: async () => envelope(requestId, await r.build()), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'LotListResponse' };
  });
  router.get('/api/v1/developments/:developmentId/lots/search', async ({ params, query, requestId }) => {
    const devId = v.developmentId(params.developmentId);
    const q = lq.parseSearchQuery(query);
    if (q.q == null) throw E.invalidFilter(400, 'Informe o termo de busca', [v.issue('q', 'required', { example: 'Q B L79' })]);
    const r = await lots.searchLots(devId, q.q, q.limit);
    return { status: 200, build: async () => envelope(requestId, await r.build()), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'LotSearchResponse' };
  });
  router.post('/api/v1/lots/batch-summary', async ({ query, requestId, readBody, principal }) => {
    v.queryAllowlist(query, []);
    const body = v.validateObject(await readBody(), lq.BatchSummaryRequestSchema);
    // topic 31: ids of developments the principal cannot see are reported exactly like nonexistent ids
    const unique = [...new Set(body.ids)];
    const visible = await tenancy.visibleLotIds(principal, unique);
    const r = await lots.batchSummary(unique.filter(id => visible.has(id)));
    r.meta = { requested: unique.length, found: r.data.length, notFound: unique.filter(id => !visible.has(id) || !r.data.some(d => d.id === id)) };
    return { status: 200, body: envelope(requestId, r), cache: CACHE.NONE, schema: 'BatchSummaryResponse' };
  });
  router.get('/api/v1/lots/:lotId', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await lots.getLotDetail(v.lotId(params.lotId));
    return {
      status: 200, etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'LotDetailResponse',
      build: async () => { const out = await r.build(); return { ...envelope(requestId, out), lot: out.lot, versions: out.versions }; }
    };
  });
  router.get('/api/v1/lots/:lotId/summary', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await lots.getLotSummary(v.lotId(params.lotId));
    return { status: 200, build: async () => envelope(requestId, await r.build()), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'LotQuickViewResponse' };
  });
  router.get('/api/v1/lots/:lotId/analysis', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await lots.getLotAnalysis(v.lotId(params.lotId));
    return { status: 200, build: async () => envelope(requestId, await r.build()), etagToken: r.etagToken, cache: CACHE.VERSIONED, schema: 'LotAnalysisResponse' };
  });
  router.get('/api/v1/lots/:lotId/commercial', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await lots.getLotCommercial(v.lotId(params.lotId));
    return { status: 200, build: async () => envelope(requestId, await r.build()), etagToken: r.etagToken, cache: CACHE.VERSIONED, schema: 'LotCommercialResponse' };
  });
  router.get('/api/v1/lots/:lotId/provenance', async ({ params, query, requestId }) => {
    const q = v.parseQuery(query, { fieldKey: { type: 'string', pattern: /^[a-zA-Z]+(\.[a-zA-Z0-9]+){1,3}$/, maxLength: 96 } });
    const r = await lots.getLotProvenance(v.lotId(params.lotId), q.fieldKey);
    return { status: 200, build: async () => envelope(requestId, await r.build()), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'LotProvenanceResponse' };
  });
}
module.exports = { registerLotRoutes };
