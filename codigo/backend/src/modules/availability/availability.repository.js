'use strict';
/* AvailabilityRepository: current status per lot, history and the development revision counter. SQL only. */

const COLS = 'lot_id, status, revision, updated_at, source_id, reserved_until, proposal_id, reason, notes, provenance';

async function findAll(db, devId, lotId = null) {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM lot_availability WHERE development_id = $1 AND ($2::text IS NULL OR lot_id = $2) ORDER BY lot_id`, [devId, lotId]);
  return rows;
}

/** Row lock on the development: serializes the availability revision counter. */
async function lockDevelopmentRevision(client, devId) {
  const { rows } = await client.query('SELECT availability_revision FROM developments WHERE id = $1 FOR UPDATE', [devId]);
  return rows[0] ? rows[0].availability_revision : null;
}

async function lockLot(client, lotId) {
  const { rows } = await client.query(`SELECT ${COLS}, development_id FROM lot_availability WHERE lot_id = $1 FOR UPDATE`, [lotId]);
  return rows[0] || null;
}

async function updateLot(client, lotId, s) {
  await client.query(
    `UPDATE lot_availability SET status = $2, revision = $3, updated_at = $4, source_id = $5, reserved_until = $6, proposal_id = $7,
            reason = $8, notes = $9, provenance = $10::jsonb, row_updated_at = now()
      WHERE lot_id = $1`,
    [lotId, s.status, s.revision, s.updatedAt, s.sourceId, s.reservedUntil, s.proposalId, s.reason, s.notes, s.provenance ? JSON.stringify(s.provenance) : null]);
}

async function setDevelopmentRevision(client, devId, revision, updatedAt, sourceId) {
  await client.query('UPDATE developments SET availability_revision = $2, availability_updated_at = $3, availability_source_id = $4 WHERE id = $1', [devId, revision, updatedAt, sourceId]);
}

async function insertHistory(client, h) {
  await client.query(
    `INSERT INTO availability_history (development_id, lot_id, from_status, to_status, revision, changed_at, source_id, reason, reserved_until, proposal_id, notes, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [h.developmentId, h.lotId, h.fromStatus, h.toStatus, h.revision, h.changedAt, h.sourceId, h.reason, h.reservedUntil, h.proposalId, h.notes, h.requestId]);
}

async function findHistory(db, lotId, limit = 50) {
  const { rows } = await db.query(
    `SELECT from_status, to_status, revision, changed_at, source_id, reason, reserved_until, proposal_id, notes FROM availability_history
      WHERE lot_id = $1 ORDER BY changed_at DESC, id DESC LIMIT $2`, [lotId, limit]);
  return rows;
}

/** Import: inserts missing rows; updates only rows never touched by the API (revision 0) whose content differs. */
async function upsertInitial(db, devId, items) {
  const { rows } = await db.query(
    `INSERT INTO lot_availability (lot_id, development_id, status, revision, updated_at, source_id, reserved_until, proposal_id, reason, notes, provenance)
     SELECT x.lot_id, $1, x.status, 0, x.updated_at, x.source_id, x.reserved_until, x.proposal_id, x.reason, x.notes, x.provenance
       FROM jsonb_to_recordset($2::jsonb) AS x(lot_id text, status text, updated_at timestamptz, source_id text, reserved_until timestamptz,
            proposal_id text, reason text, notes text, provenance jsonb)
     ON CONFLICT (lot_id) DO UPDATE SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, source_id = EXCLUDED.source_id,
       reserved_until = EXCLUDED.reserved_until, proposal_id = EXCLUDED.proposal_id, reason = EXCLUDED.reason, notes = EXCLUDED.notes,
       provenance = EXCLUDED.provenance, row_updated_at = now()
     WHERE lot_availability.revision = 0
       AND (lot_availability.status, lot_availability.updated_at, lot_availability.source_id, lot_availability.reserved_until, lot_availability.proposal_id,
            lot_availability.reason, lot_availability.notes, lot_availability.provenance)
           IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.updated_at, EXCLUDED.source_id, EXCLUDED.reserved_until, EXCLUDED.proposal_id,
            EXCLUDED.reason, EXCLUDED.notes, EXCLUDED.provenance)
     RETURNING lot_id, (xmax = 0) AS inserted`, [devId, JSON.stringify(items)]);
  const managed = await db.query('SELECT count(*)::int AS n FROM lot_availability WHERE development_id = $1 AND revision > 0', [devId]);
  const created = rows.filter(r => r.inserted).length;
  return { created, updated: rows.length - created, unchanged: items.length - rows.length, managedByApi: managed.rows[0].n };
}

module.exports = { findAll, lockDevelopmentRevision, lockLot, updateLot, setDevelopmentRevision, insertHistory, findHistory, upsertInitial };
