'use strict';
/* GetCurrentAnalysis: the published AnalysisVersion the development points to. */
const repo = require('./analysis.repository');
const { analysisSnapshot } = require('./analysis.dto');

function createAnalysisService({ pool, App, developments }) {
  const etagToken = (devId, a) => `analysis-${devId}-${a.version}-${a.checksum.slice(0, 16)}`;
  async function getCurrentSnapshot(devId, { lotId = null, versions = null } = {}) {
    const v = versions || await developments.getVersions(devId);
    const a = developments.requireLayer(v, 'analysis');
    return { etagToken: etagToken(devId, a), build: async () => analysisSnapshot(App.domain.SCHEMA_VERSION, devId, a, await repo.findLotAnalysis(pool, a.id, lotId)) };
  }
  return { getCurrentSnapshot };
}

module.exports = { createAnalysisService };
