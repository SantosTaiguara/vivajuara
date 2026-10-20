'use strict';
/* Lot DTOs.
   - StaticSnapshotDto: exactly the frontend lifecycle snapshot { kind:'static', schemaVersion, developmentId, staticDataVersion, createdAt, lots }.
   - MapLotDto (alias LotSummaryDto): lean read model for the map (no 70-field payload).
   - LotQuickViewDto: summary for Quick View, lists, search and batch (no polygon, no provenance).
   - LotDetailDto: sections of the canonical Lot composed by the shared LotComposer, minus internal fields,
     plus provenanceSummary. LotProvenanceDto: attribute-level provenance (registry default + lot override).
   Mappers only read canonical fieldKeys; they never recompute scores, classes, prices or rankings. */

/** DB row → static partial of the canonical Lot (polygon restored from the GeoJSON column, full precision). */
function toStaticPartial(row) {
  const s = row.static;
  s.geometry = { ...(s.geometry || {}), polygon: row.geometry.coordinates[0] };
  return s;
}

/** static partial → { static (without polygon), geometry (GeoJSON Polygon) } for storage. */
function splitStaticPartial(partial) {
  const { polygon, ...geomRest } = partial.geometry || {};
  return { static: { ...partial, geometry: geomRest }, geometry: { type: 'Polygon', coordinates: [polygon] } };
}

function staticSnapshot(schemaVersion, devId, v, rows) {
  const lots = {};
  for (const r of rows) lots[r.id] = toStaticPartial(r);
  return { kind: 'static', schemaVersion, developmentId: devId, staticDataVersion: v.version, createdAt: v.createdAt, lots };
}

const nul = v => (v === undefined ? null : v);
const STATUS_UNKNOWN = 'UNKNOWN';

/** thematic layer values (services/layers.js) — key = last segment of the fieldKey */
function thematicValues(r, mapScoreKeys) {
  return {
    scores: scoresOf(r.scores, mapScoreKeys),
    noiseLevel: nul(r.noise_level), privacyLevel: nul(r.privacy_level), estimatedTraffic: nul(r.estimated_traffic), gateProximity: nul(r.gate_proximity),
    hasGreenRear: nul(r.has_green_rear), orientationRear: nul(r.orientation_rear), routeDistanceToLeisureM: nul(r.route_distance_to_leisure_m), frontBearingDeg: nul(r.front_bearing_deg)
  };
}
const scoresOf = (scores, keys) => Object.fromEntries(keys.map(k => [k, scores && scores[k] != null ? scores[k] : null]));

/** MapLotDto. availability without a row is UNKNOWN (never AVAILABLE); missing analysis → class UNKNOWN, scores null. */
function toMapLotDto(r, { mapScoreKeys }) {
  const status = r.status || STATUS_UNKNOWN;
  return {
    id: r.id, code: r.code, blockId: r.block_code, blockNumber: r.block_number, lotNumber: r.lot_number,
    areaM2: nul(r.area_m2), status, availabilityStatus: status, price: r.price ?? null, pricePerM2: r.price_per_m2 ?? null,
    class: r.class || 'UNKNOWN', overallScore: r.overall_score ?? null, polygon: r.polygon, centroid: r.centroid ?? null,
    thematicValues: thematicValues(r, mapScoreKeys)
  };
}
const toLotSummaryDto = r => toMapLotDto(r, { mapScoreKeys: ['housing', 'investment', 'family', 'premium'] }); // v1.0 name

/** read-model row → partial canonical Lot (only the fields the quick view needs) */
function partialLot(r) {
  return {
    identity: { id: r.id, code: r.code, developmentId: r.development_id, blockId: r.block_code, blockNumber: r.block_number, lotNumber: r.lot_number, displayCode: r.display_code },
    geometry: { areaM2: nul(r.area_m2), frontM: nul(r.front_m), averageDepthM: nul(r.average_depth_m), isCorner: nul(r.is_corner), usableGeometryScore: nul(r.usable_geometry_score) },
    environmental: { quietScore: nul(r.quiet_score), privacyScore: nul(r.privacy_score), solarScore: nul(r.solar_score), viewScore: nul(r.view_score), noiseLevel: nul(r.noise_level), privacyLevel: nul(r.privacy_level) },
    mobility: { routeDistanceToGateM: nul(r.route_distance_to_gate_m), estimatedTraffic: nul(r.estimated_traffic) },
    surroundings: { hasGreenRear: nul(r.has_green_rear) },
    commercial: { price: r.price ?? null, pricePerM2: r.price_per_m2 ?? null, currency: nul(r.currency), priceTableVersion: nul(r.price_table_version) },
    intelligence: { class: r.class || 'UNKNOWN', scores: r.scores || {}, notes: r.notes || {}, highlights: r.highlights || [], alerts: r.alerts || [], analysisVersion: nul(r.analysis_version) },
    availability: { status: r.status || STATUS_UNKNOWN }
  };
}

/** LotQuickViewDto. criteria come from App.model.CRITERIA_FIELDS (one mapping for the whole platform). */
function toQuickViewDto(r, { scoreKeys, criteriaFields, get }) {
  const l = partialLot(r);
  return {
    id: l.identity.id, code: l.identity.code, displayCode: l.identity.displayCode, developmentId: l.identity.developmentId, blockId: l.identity.blockId,
    blockNumber: l.identity.blockNumber, lotNumber: l.identity.lotNumber,
    areaM2: l.geometry.areaM2, frontM: l.geometry.frontM, averageDepthM: l.geometry.averageDepthM, isCorner: l.geometry.isCorner,
    availabilityStatus: l.availability.status,
    price: l.commercial.price, pricePerM2: l.commercial.pricePerM2, currency: l.commercial.currency, priceTableVersion: l.commercial.priceTableVersion,
    class: l.intelligence.class, scores: scoresOf(l.intelligence.scores, scoreKeys),
    criteria: Object.fromEntries(Object.entries(criteriaFields).map(([k, key]) => [k, get(l, key) ?? null])),
    noiseLevel: l.environmental.noiseLevel, privacyLevel: l.environmental.privacyLevel, estimatedTraffic: l.mobility.estimatedTraffic,
    routeDistanceToGateM: l.mobility.routeDistanceToGateM, hasGreenRear: l.surroundings.hasGreenRear,
    highlights: l.intelligence.highlights.map(h => ({ type: h.type, title: h.title, weight: h.weight ?? null })),
    alerts: l.intelligence.alerts.map(a => ({ type: a.type, severity: a.severity, title: a.title, fieldKey: a.fieldKey ?? null })),
    analysisVersion: l.intelligence.analysisVersion
  };
}

const DETAIL_SECTIONS = ['identity', 'geometry', 'location', 'surroundings', 'mobility', 'environmental', 'construction', 'commercial', 'intelligence'];
/** internal availability fields never exposed by public DTOs (notes = internal note; proposalId = sensitive reference) */
const PRIVATE_AVAILABILITY = ['notes', 'proposalId'];

/** Attribute-level provenance of every stored field (registry default, overridden by the lot's own provenance). */
function fieldProvenance(lot, model) {
  const own = lot.provenance || {};
  return model.getStoredFields().map(f => {
    const p = model.getFieldProvenance(lot, f.key);
    return { fieldKey: f.key, domain: f.domain, status: p.status, sourceId: nul(p.sourceId), method: nul(p.method), confidence: nul(p.confidence),
      precision: nul(p.precision), updatedAt: nul(p.updatedAt), notes: nul(p.notes), lotSpecific: Object.prototype.hasOwnProperty.call(own, f.key) };
  });
}

function provenanceSummary(lot, model) {
  const fields = fieldProvenance(lot, model), byStatus = {}, byConfidence = {};
  for (const f of fields) { byStatus[f.status] = (byStatus[f.status] || 0) + 1; const c = f.confidence || 'NONE'; byConfidence[c] = (byConfidence[c] || 0) + 1; }
  return {
    totalFields: fields.length, lotSpecificFields: fields.filter(f => f.lotSpecific).length, byStatus, byConfidence,
    toConfirm: fields.filter(f => f.status === 'TO_CONFIRM').map(f => f.fieldKey), lowConfidence: fields.filter(f => f.confidence === 'LOW').map(f => f.fieldKey),
    href: `/api/v1/lots/${encodeURIComponent(lot.identity.id)}/provenance`
  };
}

/** LotDetailDto from a composed canonical Lot (plain JSON). Values are copied, never recomputed. */
function toLotDetailDto(lot, model) {
  const out = {};
  for (const s of DETAIL_SECTIONS) out[s] = lot[s];
  const availability = { ...lot.availability };
  for (const k of PRIVATE_AVAILABILITY) delete availability[k];
  out.availability = availability;
  out.provenanceSummary = provenanceSummary(lot, model);
  out.metadata = lot.metadata;
  return out;
}

function toProvenanceDto(lot, model, fieldKey = null) {
  const fields = fieldProvenance(lot, model).filter(f => !fieldKey || f.fieldKey === fieldKey);
  return { lotId: lot.identity.id, fields };
}

module.exports = { toStaticPartial, splitStaticPartial, staticSnapshot, toLotSummaryDto, toMapLotDto, toQuickViewDto, toLotDetailDto, toProvenanceDto, PRIVATE_AVAILABILITY };
