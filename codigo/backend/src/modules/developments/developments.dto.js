'use strict';
/* Development DTOs (contract 1.1).
   - DevelopmentDto: public summary + current version pointers + owner organization id and visibility (API 1.3, topic 31;
     no legacy tenant id, no internal config).
   - ManifestDto: current versions of every layer (clients compare it to decide what to refetch).
   - SourceDto: data source catalog entry (provenance). */
const iso = d => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

function toDevelopmentDto(r) {
  return {
    id: r.id, code: r.code, name: r.name, slug: r.slug, status: r.status, currency: r.currency, locale: r.locale,
    currentStaticVersion: r.current_static_version ?? null, currentAnalysisVersion: r.analysis_version ?? null,
    currentPriceTableId: r.current_price_table_id ?? null, currentPriceTableVersion: r.price_table_version ?? null,
    availabilityRevision: r.availability_revision, updatedAt: iso(r.updated_at),
    organizationId: r.organization_id, visibility: r.visibility
  };
}

function toManifestDto(devId, v, fallbackSchemaVersion) {
  return {
    developmentId: devId, schemaVersion: (v.static && v.static.schemaVersion) || fallbackSchemaVersion,
    staticVersion: v.static ? v.static.version : null, analysisVersion: v.analysis ? v.analysis.version : null,
    priceTableId: v.commercial ? v.commercial.priceTableId : null, priceTableVersion: v.commercial ? v.commercial.version : null,
    availabilityRevision: v.availability.revision, generatedAt: new Date().toISOString()
  };
}

const toSourceDto = s => ({ id: s.id, type: s.type, name: s.name, version: s.version ?? null, date: s.source_date ?? null, precision: s.precision ?? null, description: s.description ?? null });

module.exports = { toDevelopmentDto, toManifestDto, toSourceDto };
