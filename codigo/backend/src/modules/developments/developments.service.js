'use strict';
/* Application services: GetDevelopment, GetDevelopmentConfig, current-version lookup. */
const repo = require('./developments.repository');
const commercialRepo = require('../commercial/commercial.repository');
const { priceTableDto } = require('../commercial/commercial.dto');
const { E } = require('../../shared/http/errors');
const { checksumOf, sha256 } = require('../../shared/domain/checksum');
const { toDevelopmentDto, toManifestDto, toSourceDto } = require('./developments.dto');

const LAYER_NOT_FOUND = { static: 'STATIC_VERSION_NOT_FOUND', analysis: 'ANALYSIS_NOT_FOUND', commercial: 'PRICE_TABLE_NOT_FOUND' };

function createDevelopmentsService({ pool, App }) {
  /** Current version pointers of a development; 404 when it does not exist. */
  async function getVersions(devId) {
    const v = await repo.findVersions(pool, devId);
    if (!v) throw E.developmentNotFound(devId);
    return v;
  }

  function requireLayer(v, layer) {
    if (!v[layer]) throw E.notFound(`Nenhuma versão ${layer} publicada para este empreendimento`, { developmentId: v.developmentId, layer }, LAYER_NOT_FOUND[layer]);
    return v[layer];
  }

  /** Public summary of the version pointers (embedded in several DTOs). */
  const versionsDto = v => ({
    staticVersion: v.static ? v.static.version : null,
    analysisVersion: v.analysis ? v.analysis.version : null,
    priceTableId: v.commercial ? v.commercial.priceTableId : null,
    priceTableVersion: v.commercial ? v.commercial.version : null,
    availabilityRevision: v.availability.revision
  });

  /** DevelopmentConfigDto: the frontend DevelopmentConfig, rebuilt from the database (sources and price tables from their tables). */
  async function getConfig(devId) {
    const d = await repo.findById(pool, devId);
    if (!d) throw E.developmentNotFound(devId);
    const [v, sources, tables] = await Promise.all([getVersions(devId), repo.listSources(pool, devId), commercialRepo.listTables(pool, devId, { status: 'PUBLISHED' })]);
    const plans = tables.length ? await commercialRepo.findPlans(pool, tables.map(t => t.id)) : [];
    const body = {
      id: d.id, code: d.code, tenantId: d.tenant_id, name: d.name, slug: d.slug, status: d.status, currency: d.currency, locale: d.locale,
      ...d.config,
      staticDataVersion: v.static ? v.static.version : null,
      analysisVersion: v.analysis ? v.analysis.version : null,
      priceTables: tables.map(t => priceTableDto(t, plans)),
      currentPriceTableId: d.current_price_table_id,
      sources: sources.map(toSourceDto),
      versions: versionsDto(v)
    };
    return { body, etagToken: 'config-' + checksumOf(body).slice(0, 24) };
  }

  /** ListDevelopments (paginated, one query) */
  async function listDevelopments({ page, pageSize }, scope = null) {
    const { total, rows } = await repo.findSummaries(pool, { limit: pageSize, offset: (page - 1) * pageSize, scope });
    const data = rows.map(toDevelopmentDto);
    return { etagToken: 'developments-' + checksumOf({ data, total, page, pageSize }).slice(0, 24), data, meta: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) } };
  }

  /** GetDevelopment → DevelopmentDto (one query) */
  async function getDevelopment(devId) {
    const { rows } = await repo.findSummaries(pool, { id: devId });
    if (!rows.length) throw E.developmentNotFound(devId);
    const data = toDevelopmentDto(rows[0]);
    return { etagToken: 'development-' + checksumOf(data).slice(0, 24), data, meta: {} };
  }

  /** GetManifest → current versions of every layer (ETag from the version pointers) */
  async function getManifest(devId) {
    const v = await getVersions(devId);
    const token = [v.static && v.static.checksum, v.analysis && v.analysis.checksum, v.commercial && `${v.commercial.priceTableId}${v.commercial.revision}${v.commercial.checksum}`, v.availability.revision].join('|');
    return { etagToken: `manifest-${devId}-` + sha256(token).slice(0, 24), data: toManifestDto(devId, v, App ? App.domain.SCHEMA_VERSION : null), meta: { versions: versionsDto(v) } };
  }

  /** ListSources → data source catalog (provenance) */
  async function listSources(devId) {
    await getVersions(devId); // 404 for unknown development
    const data = (await repo.listSources(pool, devId)).map(toSourceDto);
    return { etagToken: 'sources-' + checksumOf(data).slice(0, 24), data, meta: {} };
  }

  return { getVersions, requireLayer, versionsDto, getConfig, listDevelopments, getDevelopment, getManifest, listSources };
}

module.exports = { createDevelopmentsService };
