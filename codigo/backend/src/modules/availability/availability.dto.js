'use strict';
/* Availability DTOs.
   - AvailabilitySnapshotDto = { kind:'availability', schemaVersion, developmentId, revision, updatedAt, sourceId, lots: { [id]: { availability, provenance? } } }.
   - UpdateAvailabilityRequest (command DTO): { status, expectedRevision, reason?, reservedUntil?, proposalId?, notes? } — whitelisted. */
const iso = d => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

function toAvailabilityState(r) {
  return {
    status: r.status, updatedAt: iso(r.updated_at), sourceId: r.source_id, revision: r.revision, reservedUntil: iso(r.reserved_until),
    proposalId: r.proposal_id, reason: r.reason, notes: r.notes, freshness: r.status === 'UNKNOWN' ? 'UNKNOWN' : 'FRESH'
  };
}

/** AvailabilityDto (public): no proposalId, no notes. A lot without a record is UNKNOWN (never AVAILABLE). */
function toAvailabilityDto(lotId, r) {
  if (!r) return { lotId, status: 'UNKNOWN', updatedAt: null, revision: 0, reservedUntil: null, freshnessSource: null };
  return { lotId, status: r.status || 'UNKNOWN', updatedAt: iso(r.updated_at), revision: r.revision, reservedUntil: iso(r.reserved_until), freshnessSource: r.status && r.status !== 'UNKNOWN' ? r.source_id ?? null : null };
}

function availabilitySnapshot(schemaVersion, devId, v, rows) {
  const lots = {};
  for (const r of rows) {
    lots[r.lot_id] = { availability: toAvailabilityState(r) };
    if (r.provenance && Object.keys(r.provenance).length) lots[r.lot_id].provenance = r.provenance;
  }
  return { kind: 'availability', schemaVersion, developmentId: devId, revision: v.revision, updatedAt: v.updatedAt, sourceId: v.sourceId, lots };
}

const STATUSES = ['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN'];
const REASONS = ['TECHNICAL_REVIEW', 'COMMERCIAL_HOLD', 'LEGAL_HOLD', 'INTERNAL_BLOCK', 'NOT_RELEASED', 'DATA_VALIDATION', 'OTHER'];
const UpdateAvailabilityRequestSchema = {
  status: { type: 'string', required: true, enum: STATUSES },
  expectedRevision: { type: 'integer', required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  reason: { type: 'string', nullable: true, enum: REASONS },
  reservedUntil: { type: 'string', nullable: true, format: 'date-time' },
  proposalId: { type: 'string', nullable: true, maxLength: 64, pattern: /^[A-Za-z0-9._:-]+$/ },
  notes: { type: 'string', nullable: true, maxLength: 500 }
};

module.exports = { toAvailabilityState, toAvailabilityDto, availabilitySnapshot, UpdateAvailabilityRequestSchema, STATUSES, REASONS };
