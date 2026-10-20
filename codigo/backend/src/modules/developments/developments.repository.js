'use strict';
/* DevelopmentRepository + SourceRepository: SQL only (parameterized). `db` is a pg Pool or a transaction client. */

const iso = d => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

async function findById(db, id) {
  const { rows } = await db.query(
    `SELECT id, tenant_id, code, name, slug, status, currency, locale, config, current_static_version, current_analysis_version_id,
            current_price_table_id, availability_revision, availability_updated_at, availability_source_id, created_at, updated_at
       FROM developments WHERE id = $1`, [id]);
  return rows[0] || null;
}

/** One query for every current-version pointer (used for ETags before any heavy read). */
async function findVersions(db, id) {
  const { rows } = await db.query(
    `SELECT d.id, d.current_static_version, sv.checksum AS static_checksum, sv.created_at AS static_created_at, sv.schema_version,
            d.current_analysis_version_id, av.version AS analysis_version, av.checksum AS analysis_checksum, av.generated_at, av.source_id AS analysis_source_id, av.status AS analysis_status,
            d.current_price_table_id, pt.version AS price_table_version, pt.revision AS price_table_revision, pt.checksum AS price_table_checksum,
            pt.issued_on, pt.valid_from, pt.valid_until, pt.source_id AS price_table_source_id,
            d.availability_revision, d.availability_updated_at, d.availability_source_id
       FROM developments d
       LEFT JOIN static_versions sv ON sv.development_id = d.id AND sv.version = d.current_static_version
       LEFT JOIN analysis_versions av ON av.id = d.current_analysis_version_id
       LEFT JOIN price_tables pt ON pt.id = d.current_price_table_id
      WHERE d.id = $1`, [id]);
  const r = rows[0];
  if (!r) return null;
  return {
    developmentId: r.id,
    static: r.current_static_version ? { version: r.current_static_version, checksum: r.static_checksum, createdAt: iso(r.static_created_at), schemaVersion: r.schema_version } : null,
    analysis: r.current_analysis_version_id ? { id: r.current_analysis_version_id, version: r.analysis_version, checksum: r.analysis_checksum, generatedAt: iso(r.generated_at), sourceId: r.analysis_source_id, status: r.analysis_status } : null,
    commercial: r.current_price_table_id ? { priceTableId: r.current_price_table_id, version: r.price_table_version, revision: r.price_table_revision, checksum: r.price_table_checksum,
      issuedOn: r.issued_on, validFrom: r.valid_from, validUntil: r.valid_until, sourceId: r.price_table_source_id } : null,
    availability: { revision: r.availability_revision, updatedAt: iso(r.availability_updated_at), sourceId: r.availability_source_id }
  };
}

/** Development summaries (DevelopmentDto rows) with their current version pointers; one query, paginated, optional id. */
/** scope (topic 31): { all, organizationIds, developmentIds } — PUBLIC developments are always visible; null scope = unfiltered (internal use) */
async function findSummaries(db, { id = null, limit = null, offset = 0, scope = null } = {}) {
  const all = !scope || !!scope.all;
  const { rows } = await db.query(
    `WITH f AS (
       SELECT d.id, d.code, d.name, d.slug, d.status, d.currency, d.locale, d.current_static_version, av.version AS analysis_version,
              d.current_price_table_id, pt.version AS price_table_version, d.availability_revision,
              GREATEST(d.updated_at, d.availability_updated_at) AS updated_at, d.organization_id, d.visibility
         FROM developments d
         LEFT JOIN analysis_versions av ON av.id = d.current_analysis_version_id
         LEFT JOIN price_tables pt ON pt.id = d.current_price_table_id
        WHERE ($1::text IS NULL OR d.id = $1)
          AND ($4::boolean OR d.visibility = 'PUBLIC' OR d.organization_id = ANY($5::text[]) OR d.id = ANY($6::text[]))),
     t AS (SELECT count(*)::int AS total FROM f)
     SELECT t.total, p.* FROM t LEFT JOIN LATERAL (SELECT * FROM f ORDER BY id LIMIT $2 OFFSET $3) p ON true ORDER BY p.id`,
    [id, limit, offset, all, scope ? scope.organizationIds || [] : [], scope ? scope.developmentIds || [] : []]);
  return { total: rows.length ? rows[0].total : 0, rows: rows.filter(r => r.id != null) };
}

async function upsert(db, d) {
  const { rows } = await db.query(
    `INSERT INTO developments (id, tenant_id, code, name, slug, status, currency, locale, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, code = EXCLUDED.code, name = EXCLUDED.name, slug = EXCLUDED.slug,
       currency = EXCLUDED.currency, locale = EXCLUDED.locale, config = EXCLUDED.config, updated_at = now()
     WHERE (developments.tenant_id, developments.code, developments.name, developments.slug, developments.currency, developments.locale, developments.config)
       IS DISTINCT FROM (EXCLUDED.tenant_id, EXCLUDED.code, EXCLUDED.name, EXCLUDED.slug, EXCLUDED.currency, EXCLUDED.locale, EXCLUDED.config)
     RETURNING (xmax = 0) AS inserted`,
    [d.id, d.tenantId, d.code, d.name, d.slug, d.status || 'ACTIVE', d.currency, d.locale, JSON.stringify(d.config)]);
  return rows[0] ? (rows[0].inserted ? 'created' : 'updated') : 'unchanged';
}

async function setCurrentPointers(db, id, { staticVersion, analysisVersionId, priceTableId }) {
  await db.query(
    `UPDATE developments SET current_static_version = $2, current_analysis_version_id = $3, current_price_table_id = $4, updated_at = now()
      WHERE id = $1 AND (current_static_version, current_analysis_version_id, current_price_table_id) IS DISTINCT FROM ($2, $3::uuid, $4)`,
    [id, staticVersion, analysisVersionId, priceTableId]);
}

async function listSources(db, devId) {
  const { rows } = await db.query(
    `SELECT id, type, name, version, source_date, precision, description, asset_id FROM sources WHERE development_id = $1 ORDER BY position, id`, [devId]);
  return rows;
}

async function upsertSource(db, devId, s, position = 0) {
  const { rows } = await db.query(
    `INSERT INTO sources (development_id, id, type, name, version, source_date, precision, description, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (development_id, id) DO UPDATE SET type = EXCLUDED.type, name = EXCLUDED.name, version = EXCLUDED.version,
       source_date = EXCLUDED.source_date, precision = EXCLUDED.precision, description = EXCLUDED.description, position = EXCLUDED.position
     WHERE (sources.type, sources.name, sources.version, sources.source_date, sources.precision, sources.description, sources.position)
       IS DISTINCT FROM (EXCLUDED.type, EXCLUDED.name, EXCLUDED.version, EXCLUDED.source_date, EXCLUDED.precision, EXCLUDED.description, EXCLUDED.position)
     RETURNING (xmax = 0) AS inserted`,
    [devId, s.id, s.type, s.name, s.version ?? null, s.date ?? null, s.precision ?? null, s.description ?? null, position]);
  return rows[0] ? (rows[0].inserted ? 'created' : 'updated') : 'unchanged';
}

module.exports = { findById, findVersions, findSummaries, upsert, setCurrentPointers, listSources, upsertSource, iso };
