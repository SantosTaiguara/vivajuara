'use strict';
/* HTTP only: asset metadata list. */
const v = require('../../shared/validation');
const { CACHE } = require('../../shared/http/respond');

function registerAssetRoutes(router, { assets }) {
  router.get('/api/v1/developments/:developmentId/assets', async ({ params, query }) => {
    v.queryAllowlist(query, []);
    const r = await assets.list(v.developmentId(params.developmentId));
    return { status: 200, body: r.body, etagToken: r.etagToken, cache: CACHE.VERSIONED };
  });
}
module.exports = { registerAssetRoutes };
