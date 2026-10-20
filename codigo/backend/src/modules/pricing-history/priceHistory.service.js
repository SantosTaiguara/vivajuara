'use strict';
/* PriceHistoryApplicationService (topic 28): loads published versions (repository), builds the series with the pure
   domain functions and exposes API DTOs. ETag = development + current price table pointer + version count: a new
   publication changes it (version-based invalidation); closed history never changes because versions are immutable. */
const repo = require('./priceHistory.repository');
const domain = require('./priceHistory.domain');
const { E } = require('../../shared/http/errors');
const { sha256 } = require('../../shared/domain/checksum');

function createPriceHistoryService({ pool, developments }) {
  async function context(devId) {
    const v = await developments.getVersions(devId); // 404 DEVELOPMENT_NOT_FOUND
    const versions = await repo.listPublishedVersions(pool, devId);
    const token = sha256([devId, v.commercial ? v.commercial.priceTableId : '-', ...versions.map(x => `${x.priceTableId}:${x.checksum}:${x.status}`)].join('|')).slice(0, 24);
    return { v, versions, token };
  }

  async function lotHistory(devId, lotId) {
    const lot = await repo.findLot(pool, devId, lotId);
    if (!lot) throw E.lotNotFound(lotId); // also when the lot exists in another development
    const { v, versions, token } = await context(devId);
    const prices = await repo.findPrices(pool, devId, versions.map(x => x.priceTableId), lotId);
    const byTable = new Map([...prices].map(([id, m]) => [id, m.get(lotId)]).filter(([, p]) => p));
    const data = domain.buildLotHistory({ developmentId: devId, lotId, areaM2: lot.area_m2, versions, pricesByTable: byTable,
      currentPriceTableId: v.commercial ? v.commercial.priceTableId : null });
    return { etagToken: `price-history-${lotId}-${token}`, data, meta: { versions: developments.versionsDto(v) } };
  }

  async function developmentHistory(devId) {
    const { v, versions, token } = await context(devId);
    const [prices, lotCount] = await Promise.all([repo.findPrices(pool, devId, versions.map(x => x.priceTableId)), repo.countLots(pool, devId)]);
    const data = domain.buildDevelopmentHistory({ developmentId: devId, versions, pricesByTable: prices, lotCount, currentPriceTableId: v.commercial ? v.commercial.priceTableId : null });
    return { etagToken: `price-history-dev-${devId}-${token}`, data, meta: { versions: developments.versionsDto(v) } };
  }

  return { lotHistory, developmentHistory };
}

module.exports = { createPriceHistoryService };
