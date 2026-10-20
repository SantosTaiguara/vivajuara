'use strict';
/* Tenant ownership lookups (topic 31): which organization owns a development / lot, and the visibility filter used by
   listings. The owner always comes from the resource (server-side), never from a client-provided id. SQL only. */

async function findDevelopmentOwner(db, devId) {
  const { rows } = await db.query('SELECT id, organization_id, visibility FROM developments WHERE id = $1', [devId]);
  return rows[0] ? { developmentId: rows[0].id, organizationId: rows[0].organization_id, visibility: rows[0].visibility } : null;
}

async function findLotOwner(db, lotId) {
  const { rows } = await db.query(
    `SELECT l.id, l.development_id, l.organization_id, d.visibility FROM lots l JOIN developments d ON d.id = l.development_id WHERE l.id = $1`, [lotId]);
  return rows[0] ? { lotId: rows[0].id, developmentId: rows[0].development_id, organizationId: rows[0].organization_id, visibility: rows[0].visibility } : null;
}

async function findLotOwners(db, lotIds) {
  if (!lotIds.length) return [];
  const { rows } = await db.query(
    `SELECT l.id, l.development_id, l.organization_id, d.visibility FROM lots l JOIN developments d ON d.id = l.development_id WHERE l.id = ANY($1::text[])`, [lotIds]);
  return rows.map(r => ({ lotId: r.id, developmentId: r.development_id, organizationId: r.organization_id, visibility: r.visibility }));
}

module.exports = { findDevelopmentOwner, findLotOwner, findLotOwners };
