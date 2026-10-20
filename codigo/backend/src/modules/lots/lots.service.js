'use strict';
/* Lot use cases (application services):
   GetLots (static snapshot) · GetMapLots (lean read model) · ListLots (filters/sort/pagination) · SearchLots ·
   GetLotSummary / BatchLotSummary (quick view) · GetLotDetail · GetLotAnalysis · GetLotCommercial · GetLotProvenance.
   - List-type use cases run ONE read-model query whatever the number of lots (no N+1).
   - Lot-scoped views are mapped from the canonical Lot composed server-side by App.lifecycle.composeOne +
     App.domain.LotFactory (the same code as the frontend), so every view shows the same values.
   - Partial failure (§141): without analysis/commercial the lot still composes (class UNKNOWN, null scores/prices)
     and meta.unavailableLayers says so; availability without a record is UNKNOWN, never AVAILABLE. */
const repo = require('./lots.repository');
const commercialRepo = require('../commercial/commercial.repository');
const { staticSnapshot, toMapLotDto, toQuickViewDto, toLotDetailDto, toProvenanceDto } = require('./lots.dto');
const { E } = require('../../shared/http/errors');
const { sha256 } = require('../../shared/domain/checksum');

function createLotsService({ pool, App, developments, analysis, commercial, availability }) {
  if (!App.services || !App.services.search) throw new Error('Shared domain without App.services.search (services/finding.js): search parsing must be central');
  const plain = o => JSON.parse(JSON.stringify(o));
  const scoreKeys = App.model.FIELDS.filter(f => f.key.startsWith('intelligence.scores.')).map(f => f.key.split('.')[2]);
  const ctx = { scoreKeys, mapScoreKeys: scoreKeys.filter(k => k !== 'overall'), criteriaFields: plain(App.model.CRITERIA_FIELDS), get: App.model.get };
  const staticToken = (devId, s) => `static-${devId}-${s.version}-${s.checksum.slice(0, 16)}`;
  /** combined token of every layer a composed view depends on */
  const combinedToken = (prefix, parts) => `${prefix}-` + sha256(parts.join('|')).slice(0, 24);
  const layerTokens = (devId, v) => [v.static ? staticToken(devId, v.static) : '-', v.analysis ? v.analysis.id + v.analysis.checksum : '-',
    v.commercial ? `${v.commercial.priceTableId}${v.commercial.revision}${v.commercial.checksum}` : '-', `r${v.availability.revision}`];
  const unavailableLayers = v => ['analysis', 'commercial'].filter(k => !v[k]);
  const pointerIds = v => ({ analysisVersionId: v.analysis ? v.analysis.id : null, priceTableId: v.commercial ? v.commercial.priceTableId : null });
  const versionMeta = v => ({ versions: developments.versionsDto(v), unavailableLayers: unavailableLayers(v) });

  async function getStaticSnapshot(devId, { lotId = null, versions = null } = {}) {
    const v = versions || await developments.getVersions(devId);
    const s = developments.requireLayer(v, 'static');
    return { etagToken: staticToken(devId, s), build: async () => staticSnapshot(App.domain.SCHEMA_VERSION, devId, s, await repo.findStaticRows(pool, devId, lotId)) };
  }

  async function getMapLots(devId) {
    const v = await developments.getVersions(devId);
    developments.requireLayer(v, 'static');
    return {
      etagToken: combinedToken('map', layerTokens(devId, v)),
      build: async () => {
        const p = pointerIds(v);
        const rows = await repo.findMapRows(pool, devId, p.analysisVersionId, p.priceTableId);
        return { developmentId: devId, versions: developments.versionsDto(v), count: rows.length, lots: rows.map(r => toMapLotDto(r, ctx)) };
      }
    };
  }

  /** central search parsing (App.services.search.parse — the frontend's own parser) over a minimal identity index */
  async function searchIds(devId, q) {
    const idx = await repo.findIdentityIndex(pool, devId);
    const all = idx.map(r => ({ identity: { id: r.id, code: r.code, blockId: r.block_code, lotNumber: r.lot_number } }));
    const res = App.services.search.parse(q, { blocks: [...new Set(idx.map(r => r.block_code))], all, byCode: new Map(all.map(l => [l.identity.code, l])) });
    return { kind: res.kind, ids: res.lots.map(l => l.identity.id) };
  }

  /** ListLots: q = parsed query (lots.query.js). Natural order = block, lot number. */
  async function listLots(devId, q, canonicalQuery) {
    const v = await developments.getVersions(devId);
    developments.requireLayer(v, 'static');
    return {
      etagToken: combinedToken('lots', [...layerTokens(devId, v), canonicalQuery]),
      build: async () => {
        const ids = q.search ? (await searchIds(devId, q.search)).ids : null;
        const filters = { developmentId: devId, ids, status: q.status, block: q.block, minArea: q.minArea, maxArea: q.maxArea, minPrice: q.minPrice, maxPrice: q.maxPrice,
          class: q.class, minHousingScore: q.minHousingScore, noiseLevel: q.noiseLevel, privacyLevel: q.privacyLevel, corner: q.corner };
        const { total, rows } = await repo.findReadModel(pool, { filters, sortBy: q.sortBy, sortDirection: q.sortDirection, limit: q.pageSize, offset: (q.page - 1) * q.pageSize, ...pointerIds(v) });
        const applied = Object.fromEntries(Object.entries(q).filter(([k, val]) => !['page', 'pageSize', 'sortBy', 'sortDirection'].includes(k) && val != null));
        return { data: rows.map(r => toQuickViewDto(r, ctx)), meta: { total, page: q.page, pageSize: q.pageSize, totalPages: Math.ceil(total / q.pageSize), sortBy: q.sortBy, sortDirection: q.sortDirection, filters: applied, ...versionMeta(v) } };
      }
    };
  }

  /** SearchLots: "327", "L327", "Q B L79", "B79", "VJ-QB-L0079" … parsed by the shared search service. */
  async function searchLots(devId, q, limit) {
    const v = await developments.getVersions(devId);
    developments.requireLayer(v, 'static');
    return {
      etagToken: combinedToken('search', [...layerTokens(devId, v), q, String(limit)]),
      build: async () => {
        const res = await searchIds(devId, q);
        const ids = res.ids.slice(0, limit);
        const rows = ids.length ? (await repo.findReadModel(pool, { filters: { developmentId: devId, ids }, ...pointerIds(v) })).rows : [];
        const byId = new Map(rows.map(r => [r.id, r]));
        return { data: ids.filter(id => byId.has(id)).map(id => toQuickViewDto(byId.get(id), ctx)), meta: { q, kind: res.kind, total: res.ids.length, limit, truncated: res.ids.length > ids.length, ...versionMeta(v) } };
      }
    };
  }

  async function getLotSummary(lotId) {
    const ref = await repo.findLotRef(pool, lotId);
    if (!ref) throw E.lotNotFound(lotId);
    const v = await developments.getVersions(ref.development_id);
    return {
      etagToken: combinedToken('summary', [lotId, ...layerTokens(ref.development_id, v)]),
      build: async () => {
        const { rows } = await repo.findReadModel(pool, { filters: { ids: [lotId] }, ...pointerIds(v) });
        if (!rows.length) throw E.lotNotFound(lotId);
        return { data: toQuickViewDto(rows[0], ctx), meta: versionMeta(v) };
      }
    };
  }

  /** BatchLotSummary: ids (validated, ≤ 100) → quick views in the requested order; unknown ids listed in notFound. One query. */
  async function batchSummary(ids) {
    const unique = [...new Set(ids)];
    const { rows } = await repo.findReadModel(pool, { filters: { ids: unique } });
    const byId = new Map(rows.map(r => [r.id, r]));
    return { data: unique.filter(id => byId.has(id)).map(id => toQuickViewDto(byId.get(id), ctx)), meta: { requested: unique.length, found: byId.size, notFound: unique.filter(id => !byId.has(id)) } };
  }

  /** prepares the composition of one canonical Lot: cheap pointer reads now, layer reads + composition in compose() */
  async function prepareLot(lotId) {
    const ref = await repo.findLotRef(pool, lotId);
    if (!ref) throw E.lotNotFound(lotId);
    const devId = ref.development_id;
    const v = await developments.getVersions(devId);
    const parts = await Promise.all([
      getStaticSnapshot(devId, { lotId, versions: v }),
      v.analysis ? analysis.getCurrentSnapshot(devId, { lotId, versions: v }) : null,
      v.commercial ? commercial.getCurrentSnapshot(devId, { lotId, versions: v }) : null,
      availability.getSnapshot(devId, { lotId, versions: v })
    ]);
    async function compose() {
      const [st, an, co, av] = await Promise.all(parts.map(p => (p ? p.build() : null)));
      const r = App.domain.LotFactory.create(App.lifecycle.composeOne(lotId, { static: st, analysis: an, commercial: co, availability: av }));
      if (!r.success) { const err = new Error('Composed lot failed validation'); err.details = plain(r.errors); throw err; }
      return plain(r.lot);
    }
    return { devId, v, etagToken: combinedToken('lot', [lotId, ...parts.map(p => (p ? p.etagToken : '-'))]), compose };
  }

  /** GetLotDetail → { data: LotDetailDto, lot (v1.0 canonical Lot, deprecated), versions (deprecated) } */
  async function getLotDetail(lotId) {
    const p = await prepareLot(lotId);
    return {
      etagToken: p.etagToken,
      build: async () => { const lot = await p.compose(); return { data: toLotDetailDto(lot, App.model), meta: versionMeta(p.v), lot, versions: developments.versionsDto(p.v) }; }
    };
  }

  async function getLotAnalysis(lotId) {
    const p = await prepareLot(lotId);
    const a = developments.requireLayer(p.v, 'analysis');
    return {
      etagToken: combinedToken('lot-analysis', [lotId, a.id, a.checksum, p.v.static ? p.v.static.checksum : '-']),
      build: async () => {
        const lot = await p.compose();
        const { analysisVersion, ...intel } = lot.intelligence;
        return { data: { lotId, generatedAt: a.generatedAt, ...intel, analysisVersion: analysisVersion ?? a.version }, meta: { versions: developments.versionsDto(p.v) } };
      }
    };
  }

  async function getLotCommercial(lotId) {
    const p = await prepareLot(lotId);
    const c = developments.requireLayer(p.v, 'commercial');
    return {
      etagToken: combinedToken('lot-commercial', [lotId, c.priceTableId, c.version, String(c.revision), c.checksum]),
      build: async () => {
        const [lot, plans] = await Promise.all([p.compose(), commercialRepo.findPlans(pool, [c.priceTableId])]);
        const wanted = new Set(lot.commercial.availablePlans || []);
        return { data: { lotId, ...lot.commercial, plans: plans.filter(x => wanted.has(x.code)).map(x => x.rules) }, meta: { versions: developments.versionsDto(p.v) } };
      }
    };
  }

  async function getLotProvenance(lotId, fieldKey = null) {
    if (fieldKey && !App.model.getStoredFields().some(f => f.key === fieldKey)) throw E.unprocessable('INVALID_FIELD_KEY', 'fieldKey inexistente no Field Registry', [{ field: 'fieldKey', reason: 'unknown_field_key', value: fieldKey.slice(0, 64) }]);
    const p = await prepareLot(lotId);
    return {
      etagToken: combinedToken('lot-provenance', [p.etagToken, fieldKey || '*']),
      build: async () => ({ data: toProvenanceDto(await p.compose(), App.model, fieldKey), meta: { versions: developments.versionsDto(p.v) } })
    };
  }

  return { getStaticSnapshot, getMapLots, listLots, searchLots, getLotSummary, batchSummary, getLotDetail, getLotAnalysis, getLotCommercial, getLotProvenance };
}

module.exports = { createLotsService };
