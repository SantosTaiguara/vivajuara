'use strict';
/* LotRepository (static/structural data) + blocks + static versions. SQL only. */

/** Static rows of a development (optionally one lot). Polygon comes from the geometry column. */
async function findStaticRows(db, devId, lotId = null) {
  const { rows } = await db.query(
    `SELECT id, static, geometry FROM lots WHERE development_id = $1 AND ($2::text IS NULL OR id = $2) ORDER BY id`, [devId, lotId]);
  return rows;
}

async function findLotRef(db, lotId) {
  const { rows } = await db.query('SELECT id, development_id, code FROM lots WHERE id = $1', [lotId]);
  return rows[0] || null;
}

/** Bulk read model for the map: one query, no N+1 (lots + current analysis + current price + availability). */
async function findMapRows(db, devId, analysisVersionId, priceTableId) {
  const { rows } = await db.query(
    `SELECT l.id, l.code, b.code AS block_code, b.number AS block_number, l.lot_number, l.static->'geometry'->'areaM2' AS area_m2,
            l.geometry->'coordinates'->0 AS polygon, l.static->'geometry'->'centroid' AS centroid,
            la.status, lp.amount AS price, lp.price_per_m2, an.class, an.overall_score,
            ${THEMATIC_SQL}
       FROM lots l
       JOIN blocks b ON b.id = l.block_id
       LEFT JOIN lot_availability la ON la.lot_id = l.id
       LEFT JOIN lot_prices lp ON lp.lot_id = l.id AND lp.price_table_id = $3
       LEFT JOIN lot_analysis an ON an.lot_id = l.id AND an.analysis_version_id = $2::uuid
      WHERE l.development_id = $1
      ORDER BY b.code, l.lot_number`, [devId, analysisVersionId, priceTableId]);
  return rows;
}

/* ---------------------------------------------------------------- lot read model (quick view / lists / search / batch)
   One parameterized query per request whatever the number of lots (no N+1). Every selected value maps to one
   canonical fieldKey; filters and sort keys are whitelisted SQL fragments (never user text). Layers are joined
   on the development's current pointers unless explicit version ids are passed (dev-scoped calls pass the ids
   read for the ETag, so body and ETag describe the same versions). */
const THEMATIC_SQL = `an.data->'intelligence'->'scores' AS scores, an.data->'environmental'->'noiseLevel' AS noise_level,
            an.data->'environmental'->'privacyLevel' AS privacy_level, an.data->'mobility'->'estimatedTraffic' AS estimated_traffic,
            an.data->'mobility'->'gateProximity' AS gate_proximity, l.static->'surroundings'->'hasGreenRear' AS has_green_rear,
            l.static->'environmental'->'orientationRear' AS orientation_rear, l.static->'mobility'->'routeDistanceToLeisureM' AS route_distance_to_leisure_m,
            l.static->'environmental'->'frontBearingDeg' AS front_bearing_deg`;

const READ_MODEL_SQL = `SELECT l.id, l.development_id, l.code, b.code AS block_code, b.number AS block_number, l.lot_number,
            l.static->'identity'->'displayCode' AS display_code,
            l.static->'geometry'->'areaM2' AS area_m2, l.static->'geometry'->'frontM' AS front_m, l.static->'geometry'->'averageDepthM' AS average_depth_m,
            l.static->'geometry'->'isCorner' AS is_corner, l.static->'mobility'->'routeDistanceToGateM' AS route_distance_to_gate_m,
            l.static->'surroundings'->'hasGreenRear' AS has_green_rear,
            la.status, lp.amount AS price, lp.price_per_m2, lp.metadata->'commercial'->'currency' AS currency,
            lp.metadata->'commercial'->'priceTableVersion' AS price_table_version,
            an.class, an.data->'intelligence'->'scores' AS scores, an.data->'intelligence'->'notes' AS notes,
            an.data->'intelligence'->'highlights' AS highlights, an.data->'intelligence'->'alerts' AS alerts,
            an.data->'intelligence'->'analysisVersion' AS analysis_version,
            an.data->'environmental'->'quietScore' AS quiet_score, an.data->'environmental'->'privacyScore' AS privacy_score,
            an.data->'environmental'->'solarScore' AS solar_score, an.data->'environmental'->'viewScore' AS view_score,
            an.data->'environmental'->'noiseLevel' AS noise_level, an.data->'environmental'->'privacyLevel' AS privacy_level,
            an.data->'geometry'->'usableGeometryScore' AS usable_geometry_score, an.data->'mobility'->'estimatedTraffic' AS estimated_traffic`;

const READ_MODEL_FROM = `FROM lots l
       JOIN blocks b ON b.id = l.block_id
       JOIN developments d ON d.id = l.development_id
       LEFT JOIN lot_availability la ON la.lot_id = l.id
       LEFT JOIN lot_prices lp ON lp.lot_id = l.id AND lp.price_table_id = COALESCE($1::text, d.current_price_table_id)
       LEFT JOIN lot_analysis an ON an.lot_id = l.id AND an.analysis_version_id = COALESCE($2::uuid, d.current_analysis_version_id)`;

/** canonical filter → SQL predicate (whitelist). Values always travel as parameters. */
const FILTER_SQL = {
  developmentId: p => `l.development_id = ${p}`,
  ids: p => `l.id = ANY(${p}::text[])`,
  status: p => `COALESCE(la.status, 'UNKNOWN') = ANY(${p}::text[])`,                              // availability.status (no row = UNKNOWN)
  block: p => `b.code = ANY(${p}::text[])`,                                                       // identity.blockId
  minArea: p => `l.area_m2 >= ${p}`, maxArea: p => `l.area_m2 <= ${p}`,                           // geometry.areaM2 (indexed column, same value)
  minPrice: p => `lp.amount >= ${p}`, maxPrice: p => `lp.amount <= ${p}`,                         // commercial.price (null never matches)
  class: p => `COALESCE(an.class, 'UNKNOWN') = ANY(${p}::text[])`,                                // intelligence.class
  minHousingScore: p => `(an.data->'intelligence'->'scores'->>'housing')::numeric >= ${p}`,       // intelligence.scores.housing
  noiseLevel: p => `COALESCE(an.data->'environmental'->>'noiseLevel', 'UNKNOWN') = ANY(${p}::text[])`,
  privacyLevel: p => `COALESCE(an.data->'environmental'->>'privacyLevel', 'UNKNOWN') = ANY(${p}::text[])`,
  corner: p => `(l.static->'geometry'->>'isCorner')::boolean = ${p}`                             // geometry.isCorner
};

/** sortBy → SQL expression (whitelist). null = natural order (block, lot number). */
const SORT_SQL = {
  code: null,
  price: 'lp.amount',
  areaM2: 'l.area_m2',
  housingScore: "(an.data->'intelligence'->'scores'->>'housing')::numeric",
  distanceToGateM: "(l.static->'mobility'->>'routeDistanceToGateM')::numeric"
};

/**
 * findReadModel(db, { filters, sortBy, sortDirection, limit, offset, analysisVersionId, priceTableId })
 * → { total, rows }. Single statement: filtered set (CTE) + total count + requested page.
 */
async function findReadModel(db, { filters = {}, sortBy = 'code', sortDirection = 'asc', limit = null, offset = 0, analysisVersionId = null, priceTableId = null } = {}) {
  const params = [priceTableId, analysisVersionId];
  const where = [];
  for (const [k, v] of Object.entries(filters)) {
    if (v == null) continue;
    if (!FILTER_SQL[k]) throw new Error(`unsupported filter ${k}`);
    params.push(v);
    where.push(FILTER_SQL[k](`$${params.length}`));
  }
  if (!(sortBy in SORT_SQL)) throw new Error(`unsupported sort ${sortBy}`);
  const dir = sortDirection === 'desc' ? 'DESC' : 'ASC';
  const sortExpr = SORT_SQL[sortBy];
  const order = alias => (sortExpr ? `${alias}sort_key ${dir} NULLS LAST, ${alias}block_code, ${alias}lot_number, ${alias}id` : `${alias}block_code ${dir}, ${alias}lot_number ${dir}, ${alias}id`);
  params.push(limit, offset);
  const { rows } = await db.query(
    `WITH f AS (${READ_MODEL_SQL}, ${sortExpr || 'NULL::numeric'} AS sort_key
       ${READ_MODEL_FROM}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}),
     t AS (SELECT count(*)::int AS total FROM f)
     SELECT t.total, p.* FROM t
       LEFT JOIN LATERAL (SELECT * FROM f ORDER BY ${order('')} LIMIT $${params.length - 1} OFFSET $${params.length}) p ON true
      ORDER BY ${order('p.')}`, params);
  const total = rows.length ? rows[0].total : 0;
  return { total, rows: rows.filter(r => r.id != null) };
}

/** Minimal identity index of a development (search parsing). */
async function findIdentityIndex(db, devId) {
  const { rows } = await db.query(
    `SELECT l.id, l.code, b.code AS block_code, l.lot_number FROM lots l JOIN blocks b ON b.id = l.block_id WHERE l.development_id = $1 ORDER BY b.code, l.lot_number`, [devId]);
  return rows;
}

// ---------------------------------------------------------------- import side

async function upsertStaticVersion(db, v) {
  const { rows } = await db.query(
    `INSERT INTO static_versions (development_id, version, schema_version, status, checksum, lot_count, source_file_checksum)
     VALUES ($1, $2, $3, 'PUBLISHED', $4, $5, $6)
     ON CONFLICT (development_id, version) DO UPDATE SET checksum = EXCLUDED.checksum, lot_count = EXCLUDED.lot_count,
       schema_version = EXCLUDED.schema_version, source_file_checksum = EXCLUDED.source_file_checksum
     WHERE (static_versions.checksum, static_versions.lot_count, static_versions.schema_version) IS DISTINCT FROM (EXCLUDED.checksum, EXCLUDED.lot_count, EXCLUDED.schema_version)
     RETURNING (xmax = 0) AS inserted`,
    [v.developmentId, v.version, v.schemaVersion, v.checksum, v.lotCount, v.sourceFileChecksum]);
  return rows[0] ? (rows[0].inserted ? 'created' : 'updated') : 'unchanged';
}

async function findStaticVersion(db, devId, version) {
  const { rows } = await db.query('SELECT version, checksum, lot_count FROM static_versions WHERE development_id = $1 AND version = $2', [devId, version]);
  return rows[0] || null;
}

/** Blocks are upserted in bulk; returns { created, updated, unchanged, ids: Map(code → uuid) }. */
async function upsertBlocks(db, devId, blocks) {
  const { rows } = await db.query(
    `INSERT INTO blocks (development_id, code, number, name)
     SELECT $1, x.code, x.number, x.name FROM jsonb_to_recordset($2::jsonb) AS x(code text, number int, name text)
     ON CONFLICT (development_id, code) DO UPDATE SET number = EXCLUDED.number, name = EXCLUDED.name
     WHERE (blocks.number, blocks.name) IS DISTINCT FROM (EXCLUDED.number, EXCLUDED.name)
     RETURNING code, (xmax = 0) AS inserted`, [devId, JSON.stringify(blocks)]);
  const all = await db.query('SELECT id, code FROM blocks WHERE development_id = $1', [devId]);
  const created = rows.filter(r => r.inserted).length;
  return { created, updated: rows.length - created, unchanged: blocks.length - rows.length, ids: new Map(all.rows.map(r => [r.code, r.id])) };
}

/** Lots upserted in one statement; only rows whose checksum changed are touched. */
async function upsertLots(db, devId, lots) {
  const { rows } = await db.query(
    `INSERT INTO lots (id, development_id, block_id, code, lot_number, area_m2, latitude, longitude, static_version, static, geometry, checksum, geometry_checksum)
     SELECT x.id, $1, x.block_id, x.code, x.lot_number, x.area_m2, x.latitude, x.longitude, x.static_version, x.static, x.geometry, x.checksum, x.geometry_checksum
       FROM jsonb_to_recordset($2::jsonb) AS x(id text, block_id uuid, code text, lot_number int, area_m2 numeric, latitude float8, longitude float8,
            static_version text, static jsonb, geometry jsonb, checksum text, geometry_checksum text)
     ON CONFLICT (id) DO UPDATE SET block_id = EXCLUDED.block_id, code = EXCLUDED.code, lot_number = EXCLUDED.lot_number, area_m2 = EXCLUDED.area_m2,
       latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, static_version = EXCLUDED.static_version, static = EXCLUDED.static,
       geometry = EXCLUDED.geometry, checksum = EXCLUDED.checksum, geometry_checksum = EXCLUDED.geometry_checksum, updated_at = now()
     WHERE lots.development_id = EXCLUDED.development_id
       AND (lots.checksum, lots.static_version) IS DISTINCT FROM (EXCLUDED.checksum, EXCLUDED.static_version)
     RETURNING id, (xmax = 0) AS inserted`, [devId, JSON.stringify(lots)]);
  const created = rows.filter(r => r.inserted).map(r => r.id);
  const updated = rows.filter(r => !r.inserted).map(r => r.id);
  return { created, updated, unchanged: lots.length - rows.length };
}

module.exports = { findStaticRows, findLotRef, findMapRows, findReadModel, findIdentityIndex, FILTER_SQL, SORT_SQL, upsertStaticVersion, findStaticVersion, upsertBlocks, upsertLots };
