'use strict';
/* GetPriceTable / GetCommercialSnapshot: the current PUBLISHED price table applied to every lot (atomic per table). */
const repo = require('./commercial.repository');
const { commercialSnapshot, priceTableDto } = require('./commercial.dto');
const { E } = require('../../shared/http/errors');

function createCommercialService({ pool, App, developments }) {
  const etagToken = (devId, c) => `commercial-${devId}-${c.priceTableId}-${c.version}-r${c.revision}-${c.checksum.slice(0, 16)}`;

  async function getCurrentSnapshot(devId, { lotId = null, versions = null } = {}) {
    const v = versions || await developments.getVersions(devId);
    const c = developments.requireLayer(v, 'commercial');
    return { etagToken: etagToken(devId, c), build: async () => commercialSnapshot(App.domain.SCHEMA_VERSION, devId, c, await repo.findLotPrices(pool, c.priceTableId, lotId)) };
  }

  async function getCurrentPriceTable(devId) {
    const v = await developments.getVersions(devId);
    const c = developments.requireLayer(v, 'commercial');
    const t = await repo.findTable(pool, c.priceTableId);
    if (!t) throw E.priceTableNotFound({ developmentId: devId, priceTableId: c.priceTableId });
    const plans = await repo.findPlans(pool, [t.id]);
    return { etagToken: etagToken(devId, c) + '-table', body: { ...priceTableDto(t, plans), status: t.status, currency: t.currency, revision: t.revision } };
  }

  /** GetPriceTable(devId, priceTableId): scoped to the development; DRAFT tables are not public (404). */
  async function getPriceTable(devId, priceTableId) {
    await developments.getVersions(devId); // 404 DEVELOPMENT_NOT_FOUND first
    const t = await repo.findTable(pool, priceTableId);
    if (!t || t.development_id !== devId || t.status === 'DRAFT') throw E.priceTableNotFound({ developmentId: devId, priceTableId });
    const plans = await repo.findPlans(pool, [t.id]);
    return {
      etagToken: `pricetable-${devId}-${t.id}-${t.version}-r${t.revision}-${String(t.checksum || '').slice(0, 16)}`,
      data: { ...priceTableDto(t, plans), status: t.status, currency: t.currency, revision: t.revision },
      meta: {}
    };
  }

  return { getCurrentSnapshot, getCurrentPriceTable, getPriceTable };
}

module.exports = { createCommercialService };
