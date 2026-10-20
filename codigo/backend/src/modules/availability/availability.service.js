'use strict';
/* GetAvailability / UpdateAvailability.
   Writes go through the SAME state machine as the frontend (App.availability), inside one
   transaction: lock → optimistic revision check (409) → transition (422) → status + history + audit. */
const repo = require('./availability.repository');
const lotsRepo = require('../lots/lots.repository');
const devRepo = require('../developments/developments.repository');
const { insertAudit } = require('../../shared/db/audit.repository');
const { withTransaction } = require('../../shared/db/pool');
const { validateObject } = require('../../shared/validation');
const { E } = require('../../shared/http/errors');
const { availabilitySnapshot, toAvailabilityState, toAvailabilityDto, UpdateAvailabilityRequestSchema, STATUSES } = require('./availability.dto');
const { sha256 } = require('../../shared/domain/checksum');

/** state machine codes → public API codes (docs/API_ERRORS.md) */
const TRANSITION_CODES = { INVALID_TRANSITION: 'INVALID_AVAILABILITY_TRANSITION' };

const API_SOURCE_ID = 'availability-api';

function createAvailabilityService({ pool, App, config, developments }) {
  const AV = App.availability;

  async function getSnapshot(devId, { lotId = null, versions = null } = {}) {
    const v = versions || await developments.getVersions(devId);
    const a = v.availability;
    return { etagToken: `availability-${devId}-r${a.revision}`, build: async () => availabilitySnapshot(App.domain.SCHEMA_VERSION, devId, a, await repo.findAll(pool, devId, lotId)) };
  }

  /** Writes need a configured admin token (ADMIN_API_TOKEN) and no kill switch (WRITES_ENABLED=false). */
  function assertWritesEnabled() {
    if (!config.writesEnabled) throw E.forbidden('WRITES_DISABLED', 'Escrita desabilitada neste ambiente (ADMIN_API_TOKEN não configurado)');
  }

  /** UpdateAvailabilityRequest → new state. Throws 403 (disabled), 400, 404, 409, 422. */
  async function updateAvailability(lotId, body, { requestId = null, actorId = null, actorType = null, permissionKey = null } = {}) {
    assertWritesEnabled();
    const cmd = validateObject(body, UpdateAvailabilityRequestSchema);
    // fields that only exist in some states are rejected instead of silently dropped
    const notAllowed = [];
    if (cmd.reservedUntil != null && cmd.status !== 'RESERVED') notAllowed.push({ field: 'reservedUntil', issue: 'only_for_RESERVED' });
    if (cmd.proposalId != null && cmd.status !== 'PROPOSAL') notAllowed.push({ field: 'proposalId', issue: 'only_for_PROPOSAL' });
    if (cmd.reason != null && !['BLOCKED', 'UNAVAILABLE'].includes(cmd.status)) notAllowed.push({ field: 'reason', issue: 'only_for_BLOCKED_or_UNAVAILABLE' });
    if (notAllowed.length) throw E.unprocessable('FIELD_NOT_ALLOWED', 'Campo não se aplica ao status informado', notAllowed);

    const ref = await lotsRepo.findLotRef(pool, lotId);
    if (!ref) throw E.lotNotFound(lotId);
    const devId = ref.development_id;

    return withTransaction(pool, async client => {
      const devRevision = await repo.lockDevelopmentRevision(client, devId); // serializes revisions per development
      const cur = await repo.lockLot(client, lotId);
      if (!cur) throw E.notFound('Lote sem registro de disponibilidade', { lotId }, 'LOT_NOT_FOUND');
      if (cur.revision !== cmd.expectedRevision) {
        throw E.conflict('REVISION_CONFLICT', 'O status foi alterado por outra operação; recarregue e tente novamente', { lotId, expectedRevision: cmd.expectedRevision, currentRevision: cur.revision, currentStatus: cur.status }, { currentRevision: cur.revision });
      }
      const dev = await devRepo.findById(client, devId);
      const policy = AV.policyOf({ availabilityPolicy: (dev.config && dev.config.availabilityPolicy) || {} });
      const before = toAvailabilityState(cur);
      const revision = devRevision + 1;
      const at = new Date().toISOString();
      const r = AV.transition(before, cmd.status, {
        at, sourceId: API_SOURCE_ID, revision, reservedUntil: cmd.reservedUntil ?? null, proposalId: cmd.proposalId ?? null,
        reason: cmd.reason ?? null, notes: cmd.notes ?? null, authorized: false // administrative reopen needs a user model (future)
      }, policy);
      if (!r.ok && r.error.code === 'STALE_REVISION') throw E.conflict('REVISION_CONFLICT', r.error.message, { lotId, currentRevision: cur.revision, reason: r.error.code }, { currentRevision: cur.revision });
      if (!r.ok) throw E.unprocessable(TRANSITION_CODES[r.error.code] || r.error.code, r.error.message, { lotId, from: r.error.from, to: r.error.to, reason: r.error.code });
      const { freshness, ...next } = r.state;
      const provenance = next.status === 'UNKNOWN' ? null
        : { 'availability.status': { status: 'CONFIRMED', sourceId: API_SOURCE_ID, method: 'declared', confidence: 'HIGH', updatedAt: at } };
      await repo.updateLot(client, lotId, { ...next, provenance });
      await repo.setDevelopmentRevision(client, devId, revision, at, API_SOURCE_ID);
      await repo.insertHistory(client, { developmentId: devId, lotId, fromStatus: before.status, toStatus: next.status, revision, changedAt: at, sourceId: API_SOURCE_ID,
        reason: next.reason, reservedUntil: next.reservedUntil, proposalId: next.proposalId, notes: next.notes, requestId });
      const { freshness: _f, ...oldValue } = before;
      await insertAudit(client, { actorId, actorType, permissionKey, action: 'AVAILABILITY_UPDATE', entityType: 'lot_availability', entityId: lotId, developmentId: devId, oldValue, newValue: next, requestId });
      const saved = (await repo.findAll(client, devId, lotId))[0];
      const state = toAvailabilityState(saved);
      // UpdateAvailabilityResponse: { lotId, status, revision, updatedAt } (§92) + v1.0 fields kept for compatibility
      return { lotId, developmentId: devId, status: state.status, revision: state.revision, updatedAt: state.updatedAt, developmentRevision: revision, availability: state };
    });
  }

  async function getHistory(lotId) {
    const ref = await lotsRepo.findLotRef(pool, lotId);
    if (!ref) throw E.lotNotFound(lotId);
    const rows = await repo.findHistory(pool, lotId);
    return rows.map(h => ({ fromStatus: h.from_status, toStatus: h.to_status, revision: h.revision, changedAt: devRepo.iso(h.changed_at), sourceId: h.source_id,
      reason: h.reason, reservedUntil: devRepo.iso(h.reserved_until), proposalId: h.proposal_id, notes: h.notes }));
  }

  /** GetLotAvailability → AvailabilityDto (public) + ETag per lot revision */
  async function getLotAvailability(lotId) {
    const ref = await lotsRepo.findLotRef(pool, lotId);
    if (!ref) throw E.lotNotFound(lotId);
    const row = (await repo.findAll(pool, ref.development_id, lotId))[0] || null;
    const data = toAvailabilityDto(lotId, row);
    return { etagToken: `availability-lot-${lotId}-r${data.revision}-${data.status}`, data, meta: {} };
  }

  /** AvailabilityManifest (topic 29 §69-72): revision + checksum + counts for cheap client sync. Built ONLY from the
      availability domain (lot_availability + development revision): no price field, no price version. Freshness comes
      from the development freshnessPolicy (availabilityMaxAgeMs / availabilityExpireAfterMs; null = no time limit: a value
      confirmed by the official source is FRESH when served). UNKNOWN is counted as UNKNOWN, never AVAILABLE. */
  async function getManifest(devId, now = new Date()) {
    const v = await developments.getVersions(devId);
    const [rows, dev] = await Promise.all([repo.findAll(pool, devId), devRepo.findById(pool, devId)]);
    const fp = (dev.config && dev.config.freshnessPolicy) || {};
    const maxAge = fp.availabilityMaxAgeMs ?? null, expire = fp.availabilityExpireAfterMs ?? null;
    const statusCounts = Object.fromEntries(STATUSES.map(s => [s, 0]));
    const freshnessCounts = { FRESH: 0, STALE: 0, EXPIRED: 0, UNKNOWN: 0 };
    const dataStateCounts = { VALID: 0, UNKNOWN_SOURCE: 0 };
    const canonical = [];
    for (const r of rows) {
      const status = STATUSES.includes(r.status) ? r.status : 'UNKNOWN';
      statusCounts[status]++;
      const at = r.updated_at ? new Date(r.updated_at).getTime() : null;
      let f = 'UNKNOWN';
      if (status !== 'UNKNOWN' && at != null) {
        const age = now.getTime() - at;
        f = expire != null && age > expire ? 'EXPIRED' : maxAge != null && age > maxAge ? 'STALE' : 'FRESH';
      }
      freshnessCounts[f]++;
      dataStateCounts[status !== 'UNKNOWN' && r.source_id ? 'VALID' : 'UNKNOWN_SOURCE']++;
      canonical.push(`${r.lot_id}:${status}:${r.revision}`);
    }
    const checksum = sha256(canonical.join('\n')); // stable order: rows sorted by lot_id
    const data = { developmentId: devId, revision: v.availability.revision, checksum, updatedAt: v.availability.updatedAt, sourceId: v.availability.sourceId,
      lotCount: rows.length, statusCounts, freshnessCounts, dataStateCounts,
      freshnessPolicy: { availabilityMaxAgeMs: maxAge, availabilityExpireAfterMs: expire }, generatedAt: now.toISOString() };
    return { etagToken: `availability-manifest-${devId}-r${v.availability.revision}-${checksum.slice(0, 12)}`, data, meta: {} };
  }

  return { getSnapshot, getManifest, assertWritesEnabled, updateAvailability, getHistory, getLotAvailability, API_SOURCE_ID };
}

module.exports = { createAvailabilityService, API_SOURCE_ID };
