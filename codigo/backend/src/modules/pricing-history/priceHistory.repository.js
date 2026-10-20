'use strict';
/* PriceHistoryRepository (topic 28): reads published price table versions (PUBLISHED + ARCHIVED; drafts never enter
   a history) and their per-lot prices. Read-only, SQL only. The development id passed here was already authorized
   for the request's tenant (tenancy guard); queries are always bounded by development_id. */
const iso = d => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

async function listPublishedVersions(db, devId) {
  const { rows } = await db.query(
    `SELECT id, version, status, currency, valid_from, valid_until, issued_on, published_at, archived_at, created_at, source_id, checksum, pricing_mode, change_reason
       FROM price_tables WHERE development_id = $1 AND status IN ('PUBLISHED', 'ARCHIVED') ORDER BY created_at, id`, [devId]);
  return rows.map(r => ({ priceTableId: r.id, version: r.version, status: r.status, currency: r.currency, validFrom: r.valid_from, validUntil: r.valid_until,
    issuedOn: r.issued_on, publishedAt: iso(r.published_at || r.created_at), archivedAt: iso(r.archived_at), sourceId: r.source_id, checksum: r.checksum,
    pricingMode: r.pricing_mode, changeReason: r.change_reason }));
}

/** lot prices of the given versions (one lot or all lots) → Map(tableId → Map(lotId → { amount, pricePerM2, currency })) */
async function findPrices(db, devId, tableIds, lotId = null) {
  const out = new Map(tableIds.map(id => [id, new Map()]));
  if (!tableIds.length) return out;
  const { rows } = await db.query(
    `SELECT lp.price_table_id, lp.lot_id, lp.amount, lp.price_per_m2, lp.currency
       FROM lot_prices lp JOIN price_tables pt ON pt.id = lp.price_table_id
      WHERE pt.development_id = $1 AND lp.price_table_id = ANY($2::text[]) AND ($3::text IS NULL OR lp.lot_id = $3)`, [devId, tableIds, lotId]);
  for (const r of rows) out.get(r.price_table_id).set(r.lot_id, { amount: r.amount, pricePerM2: r.price_per_m2, currency: r.currency });
  return out;
}

async function findLot(db, devId, lotId) {
  const { rows } = await db.query('SELECT id, area_m2 FROM lots WHERE id = $1 AND development_id = $2', [lotId, devId]);
  return rows[0] || null;
}

async function countLots(db, devId) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM lots WHERE development_id = $1', [devId]);
  return rows[0].n;
}

module.exports = { listPublishedVersions, findPrices, findLot, countLots };
