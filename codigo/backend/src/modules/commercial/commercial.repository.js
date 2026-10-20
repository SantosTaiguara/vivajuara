'use strict';
/* PriceTableRepository: price tables, payment plans and per-lot prices. SQL only. */

const TABLE_COLS = `id, development_id, version, name, currency, price_per_m2, down_payment_default, valid_from, valid_until, status, source_id, issued_on, revision, checksum`;

async function findTable(db, id) {
  const { rows } = await db.query(`SELECT ${TABLE_COLS} FROM price_tables WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function listTables(db, devId, { status = null } = {}) {
  const { rows } = await db.query(
    `SELECT ${TABLE_COLS} FROM price_tables WHERE development_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at, id`, [devId, status]);
  return rows;
}

async function findPlans(db, tableIds) {
  const { rows } = await db.query(`SELECT price_table_id, code, position, rules FROM payment_plans WHERE price_table_id = ANY($1::text[]) ORDER BY price_table_id, position`, [tableIds]);
  return rows;
}

async function findLotPrices(db, tableId, lotId = null) {
  const { rows } = await db.query(
    `SELECT lot_id, metadata FROM lot_prices WHERE price_table_id = $1 AND ($2::text IS NULL OR lot_id = $2) ORDER BY lot_id`, [tableId, lotId]);
  return rows;
}

async function insertTable(db, t) {
  const { rows } = await db.query(
    `INSERT INTO price_tables (id, development_id, version, name, currency, price_per_m2, down_payment_default, valid_from, valid_until, status, source_id, issued_on, revision, checksum, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CASE WHEN $10 = 'PUBLISHED' THEN now() END)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [t.id, t.developmentId, t.version, t.name, t.currency, t.pricePerM2, t.downPaymentDefault, t.validFrom, t.validUntil, t.status, t.sourceId, t.issuedOn, t.revision, t.checksum]);
  return rows.length ? 'created' : 'exists';
}

async function upsertPlans(db, tableId, plans) {
  const { rows } = await db.query(
    `INSERT INTO payment_plans (price_table_id, code, position, name, type, down_payment_percent, installments, monthly_rate, annual_payments, discount_percent, rules)
     SELECT $1, x.code, x.position, x.name, x.type, x.down_payment_percent, x.installments, x.monthly_rate, x.annual_payments, x.discount_percent, x.rules
       FROM jsonb_to_recordset($2::jsonb) AS x(code text, position int, name text, type text, down_payment_percent numeric, installments int,
            monthly_rate numeric, annual_payments int, discount_percent numeric, rules jsonb)
     ON CONFLICT (price_table_id, code) DO UPDATE SET position = EXCLUDED.position, name = EXCLUDED.name, type = EXCLUDED.type,
       down_payment_percent = EXCLUDED.down_payment_percent, installments = EXCLUDED.installments, monthly_rate = EXCLUDED.monthly_rate,
       annual_payments = EXCLUDED.annual_payments, discount_percent = EXCLUDED.discount_percent, rules = EXCLUDED.rules
     WHERE payment_plans.rules IS DISTINCT FROM EXCLUDED.rules OR payment_plans.position IS DISTINCT FROM EXCLUDED.position
     RETURNING code, (xmax = 0) AS inserted`, [tableId, JSON.stringify(plans)]);
  const created = rows.filter(r => r.inserted).length;
  return { created, updated: rows.length - created, unchanged: plans.length - rows.length };
}

async function upsertLotPrices(db, tableId, items) {
  const { rows } = await db.query(
    `INSERT INTO lot_prices (price_table_id, lot_id, amount, currency, price_per_m2, discount_rules, metadata, checksum)
     SELECT $1, x.lot_id, x.amount, x.currency, x.price_per_m2, x.discount_rules, x.metadata, x.checksum
       FROM jsonb_to_recordset($2::jsonb) AS x(lot_id text, amount numeric, currency text, price_per_m2 numeric, discount_rules jsonb, metadata jsonb, checksum text)
     ON CONFLICT (price_table_id, lot_id) DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency, price_per_m2 = EXCLUDED.price_per_m2,
       discount_rules = EXCLUDED.discount_rules, metadata = EXCLUDED.metadata, checksum = EXCLUDED.checksum
     WHERE lot_prices.checksum IS DISTINCT FROM EXCLUDED.checksum
     RETURNING lot_id, (xmax = 0) AS inserted`, [tableId, JSON.stringify(items)]);
  const created = rows.filter(r => r.inserted).length;
  return { created, updated: rows.length - created, unchanged: items.length - rows.length };
}


// ---------------------------------------------------------------- publication (POST /developments/{id}/price-tables)

/** Row lock on the development: serializes publications (and pointer changes) per development. */
async function lockDevelopment(db, devId) {
  const { rows } = await db.query('SELECT id, current_price_table_id FROM developments WHERE id = $1 FOR UPDATE', [devId]);
  return rows[0] || null;
}

/** Existing table with the same id (any development) or the same version in this development. */
async function findConflicting(db, devId, id, version) {
  const { rows } = await db.query('SELECT id, development_id, version FROM price_tables WHERE id = $1 OR (development_id = $2 AND version = $3) ORDER BY id', [id, devId, version]);
  return rows;
}

async function insertPublishedTable(db, t) {
  const { rows } = await db.query(
    `INSERT INTO price_tables (id, development_id, version, name, currency, price_per_m2, down_payment_default, valid_from, valid_until, status, source_id, issued_on,
                               revision, checksum, published_at, published_by, change_reason, pricing_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PUBLISHED', $10, $11, $12, $13, now(), $14, $15, $16)
     RETURNING published_at`,
    [t.id, t.developmentId, t.version, t.name, t.currency, t.pricePerM2, t.downPaymentDefault, t.validFrom, t.validUntil, t.sourceId, t.issuedOn, t.revision, t.checksum,
      t.publishedBy, t.changeReason, t.pricingMode]);
  return rows[0];
}

/** the table that stops being current keeps its rows (still readable by id) and becomes ARCHIVED */
async function archiveTable(db, id) {
  await db.query(`UPDATE price_tables SET status = 'ARCHIVED', archived_at = now() WHERE id = $1 AND status = 'PUBLISHED'`, [id]);
}

async function setCurrentPriceTable(db, devId, id) {
  await db.query('UPDATE developments SET current_price_table_id = $2, updated_at = now() WHERE id = $1', [devId, id]);
}

module.exports = { findTable, listTables, findPlans, findLotPrices, insertTable, upsertPlans, upsertLotPrices, lockDevelopment, findConflicting, insertPublishedTable, archiveTable, setCurrentPriceTable };
