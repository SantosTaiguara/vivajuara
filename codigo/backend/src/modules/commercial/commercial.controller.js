'use strict';
/* HTTP only: current commercial snapshot, current price table, price table by id (with payment plans)
   and the admin command that publishes a new price table version (?dryRun=true → per-lot diff, nothing written). */
const v = require('../../shared/validation');
const { CACHE, envelope } = require('../../shared/http/respond');

function registerCommercialRoutes(router, { commercial, priceTables }) {
  router.get('/api/v1/developments/:developmentId/commercial/current', async ({ params, query }) => {
    v.queryAllowlist(query, []);
    const r = await commercial.getCurrentSnapshot(v.developmentId(params.developmentId));
    return { status: 200, build: r.build, etagToken: r.etagToken, cache: CACHE.VERSIONED };
  });
  router.get('/api/v1/developments/:developmentId/commercial/price-tables/current', async ({ params, query }) => {
    v.queryAllowlist(query, []);
    const r = await commercial.getCurrentPriceTable(v.developmentId(params.developmentId));
    return { status: 200, body: r.body, etagToken: r.etagToken, cache: CACHE.VERSIONED, schema: 'PriceTableDto' };
  });
  router.get('/api/v1/developments/:developmentId/price-tables/:priceTableId', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await commercial.getPriceTable(v.developmentId(params.developmentId), v.priceTableId(params.priceTableId));
    return { status: 200, body: envelope(requestId, r), etagToken: r.etagToken, cache: CACHE.VERSIONED, schema: 'PriceTableResponse' };
  });
  router.post('/api/v1/developments/:developmentId/price-tables', async ({ params, query, requestId, readBody, auth }) => {
    const dryRun = v.booleanFlag(query, 'dryRun');
    const devId = v.developmentId(params.developmentId);
    const body = await readBody();
    const r = await priceTables.publish(devId, body, { dryRun, actorId: auth.actorId, actorType: auth.actorType, permissionKey: auth.permissionKey, requestId });
    return { status: r.status, body: envelope(requestId, r), cache: CACHE.NONE, schema: 'PriceTablePublicationResponse', headers: r.location ? { Location: r.location } : undefined };
  }, { write: true, idempotent: true, largeBody: true });
}
module.exports = { registerCommercialRoutes };
