'use strict';
/* AnalysisSnapshotDto = { kind:'analysis', schemaVersion, developmentId, analysisVersion, generatedAt, sourceId, status, lots }. */
function analysisSnapshot(schemaVersion, devId, v, rows) {
  const lots = {};
  for (const r of rows) lots[r.lot_id] = r.data;
  return { kind: 'analysis', schemaVersion, developmentId: devId, analysisVersion: v.version, generatedAt: v.generatedAt, sourceId: v.sourceId, status: v.status, lots };
}
module.exports = { analysisSnapshot };
