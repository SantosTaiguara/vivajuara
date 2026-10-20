'use strict';
/* HTTP only: current published analysis snapshot (versioned cache) and the admin analysis preview (impact report, never published). */
const v = require('../../shared/validation');
const { CACHE, envelope } = require('../../shared/http/respond');

function registerAnalysisRoutes(router, { analysis, analysisPreview }) {
  router.get('/api/v1/developments/:developmentId/analysis/current', async ({ params, query }) => {
    v.queryAllowlist(query, []);
    const r = await analysis.getCurrentSnapshot(v.developmentId(params.developmentId));
    return { status: 200, build: r.build, etagToken: r.etagToken, cache: CACHE.VERSIONED };
  });
  router.post('/api/v1/developments/:developmentId/analysis/preview', async ({ params, query, requestId, readBody }) => {
    v.queryAllowlist(query, []);
    const devId = v.developmentId(params.developmentId);
    const r = await analysisPreview.preview(devId, await readBody());
    return { status: 200, body: envelope(requestId, r), cache: CACHE.NONE, schema: 'AnalysisPreviewResponse' };
  }, { admin: true, idempotent: true, largeBody: true });
}
module.exports = { registerAnalysisRoutes };
