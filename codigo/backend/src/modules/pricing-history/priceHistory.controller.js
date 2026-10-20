'use strict';
/* HTTP only: read-only price history (topic 28). Permission lot.price_history.view (public on PUBLIC developments). */
const v = require('../../shared/validation');
const { CACHE, envelope } = require('../../shared/http/respond');

function registerPriceHistoryRoutes(router, { priceHistory }) {
  router.get('/api/v1/developments/:developmentId/lots/:lotId/price-history', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await priceHistory.lotHistory(v.developmentId(params.developmentId), v.lotId(params.lotId));
    return { status: 200, body: envelope(requestId, r), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'LotPriceHistoryResponse' };
  });
  router.get('/api/v1/developments/:developmentId/pricing/history', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await priceHistory.developmentHistory(v.developmentId(params.developmentId));
    return { status: 200, body: envelope(requestId, r), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'DevelopmentPriceHistoryResponse' };
  });
}

module.exports = { registerPriceHistoryRoutes };
