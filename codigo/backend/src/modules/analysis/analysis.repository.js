'use strict';
/* AnalysisRepository: analysis versions and per-lot analysis (JSONB). SQL only. */

async function findLotAnalysis(db, versionId, lotId = null) {
  const { rows } = await db.query(
    `SELECT lot_id, data FROM lot_analysis WHERE analysis_version_id = $1 AND ($2::text IS NULL OR lot_id = $2) ORDER BY lot_id`, [versionId, lotId]);
  return rows;
}

async function findVersion(db, devId, version) {
  const { rows } = await db.query('SELECT id, version, status, checksum, lot_count FROM analysis_versions WHERE development_id = $1 AND version = $2', [devId, version]);
  return rows[0] || null;
}

/** Inserts a version (or returns the existing one). Published versions are immutable: the service checks checksums. */
async function insertVersion(db, v) {
  const { rows } = await db.query(
    `INSERT INTO analysis_versions (development_id, version, generated_at, methodology_version, source_id, status, checksum, lot_count, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $6 = 'PUBLISHED' THEN now() END)
     ON CONFLICT (development_id, version) DO NOTHING
     RETURNING id`,
    [v.developmentId, v.version, v.generatedAt, v.methodologyVersion, v.sourceId, v.status, v.checksum, v.lotCount]);
  return rows[0] ? rows[0].id : null;
}

async function upsertLotAnalysis(db, versionId, items) {
  const { rows } = await db.query(
    `INSERT INTO lot_analysis (analysis_version_id, lot_id, class, overall_score, data, checksum)
     SELECT $1, x.lot_id, x.class, x.overall_score, x.data, x.checksum
       FROM jsonb_to_recordset($2::jsonb) AS x(lot_id text, class text, overall_score numeric, data jsonb, checksum text)
     ON CONFLICT (analysis_version_id, lot_id) DO UPDATE SET class = EXCLUDED.class, overall_score = EXCLUDED.overall_score, data = EXCLUDED.data, checksum = EXCLUDED.checksum
     WHERE lot_analysis.checksum IS DISTINCT FROM EXCLUDED.checksum
     RETURNING lot_id, (xmax = 0) AS inserted`, [versionId, JSON.stringify(items)]);
  const created = rows.filter(r => r.inserted).length;
  return { created, updated: rows.length - created, unchanged: items.length - rows.length };
}

// ---------------------------------------------------------------- engine inputs (LotAnalysisInput, migration 006)

async function findInputVersion(db, devId, version) {
  const { rows } = await db.query('SELECT version, schema_version, checksum, lot_count, source_ids FROM analysis_input_versions WHERE development_id = $1 AND version = $2', [devId, version]);
  return rows[0] || null;
}

async function insertInputVersion(db, v) {
  const { rows } = await db.query(
    `INSERT INTO analysis_input_versions (development_id, version, schema_version, checksum, lot_count, source_ids, source_file_checksum)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) ON CONFLICT (development_id, version) DO NOTHING RETURNING version`,
    [v.developmentId, v.version, v.schemaVersion, v.checksum, v.lotCount, JSON.stringify(v.sourceIds || []), v.sourceFileChecksum]);
  return rows.length ? 'created' : 'unchanged';
}

async function upsertLotInputs(db, devId, version, items) {
  const { rows } = await db.query(
    `INSERT INTO lot_analysis_inputs (development_id, input_version, lot_id, data, checksum)
     SELECT $1, $2, x.lot_id, x.data, x.checksum FROM jsonb_to_recordset($3::jsonb) AS x(lot_id text, data jsonb, checksum text)
     ON CONFLICT (development_id, input_version, lot_id) DO UPDATE SET data = EXCLUDED.data, checksum = EXCLUDED.checksum
     WHERE lot_analysis_inputs.checksum IS DISTINCT FROM EXCLUDED.checksum
     RETURNING lot_id, (xmax = 0) AS inserted`, [devId, version, JSON.stringify(items)]);
  const created = rows.filter(r => r.inserted).length;
  return { created, updated: rows.length - created, unchanged: items.length - rows.length };
}

async function setCurrentInputVersion(db, devId, version) {
  const { rowCount } = await db.query(
    'UPDATE developments SET current_analysis_input_version = $2 WHERE id = $1 AND current_analysis_input_version IS DISTINCT FROM $2', [devId, version]);
  return rowCount ? 'updated' : 'unchanged';
}

/** current engine inputs of a development: { version, schemaVersion, sourceIds, checksum, lots: [data] } | null (two statements) */
async function findCurrentInputs(db, devId) {
  const { rows: v } = await db.query(
    `SELECT iv.version, iv.schema_version, iv.source_ids, iv.checksum FROM developments d
       JOIN analysis_input_versions iv ON iv.development_id = d.id AND iv.version = d.current_analysis_input_version WHERE d.id = $1`, [devId]);
  if (!v.length) return null;
  const { rows } = await db.query('SELECT lot_id, data FROM lot_analysis_inputs WHERE development_id = $1 AND input_version = $2 ORDER BY lot_id', [devId, v[0].version]);
  return { version: v[0].version, schemaVersion: v[0].schema_version, sourceIds: v[0].source_ids, checksum: v[0].checksum, lots: rows.map(r => r.data) };
}

module.exports = { findLotAnalysis, findVersion, insertVersion, upsertLotAnalysis, findInputVersion, insertInputVersion, upsertLotInputs, setCurrentInputVersion, findCurrentInputs };
