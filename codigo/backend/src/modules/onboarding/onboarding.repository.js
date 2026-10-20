'use strict';
/* Topic 58 — OnboardingRepository (tables of migration 012). Two implementations with the same interface:
   createMemoryOnboardingRepository() for DB-free tests and createPgOnboardingRepository(pool) for production
   (not exercised here: no database). Every call is tenant-scoped (organizationId, id): another organization's
   record is simply not found. source_assets, onboarding_reports and publication_events are append-only. */
const COLLECTIONS = Object.freeze({
  cases: 'onboarding_cases', sources: 'onboarding_source_assets', batches: 'ingestion_batches', runs: 'ingestion_runs',
  mappings: 'field_mapping_sets', conflicts: 'onboarding_data_conflicts', reviews: 'onboarding_review_items',
  publications: 'onboarding_publications', reports: 'onboarding_reports', audit: 'onboarding_audit_events'
});
const APPEND_ONLY = new Set(['sources', 'reports', 'audit']);
const clone = x => JSON.parse(JSON.stringify(x));

function createMemoryOnboardingRepository() {
  const data = Object.fromEntries(Object.keys(COLLECTIONS).map(c => [c, new Map()]));
  const col = c => { if (!data[c]) throw new Error(`unknown collection ${c}`); return data[c]; };
  const key = (org, id) => `${org}\u0000${id}`;
  return {
    kind: 'memory',
    async put(c, organizationId, rec) {
      if (!organizationId || !rec || !rec.id) throw new Error('organizationId and id required');
      const k = key(organizationId, rec.id), prev = col(c).get(k);
      if (prev && APPEND_ONLY.has(c) && c !== 'sources') throw new Error(`${COLLECTIONS[c]} is append-only`);
      // a source asset is immutable: only its lifecycle columns (status, scan, supersededBy/At) may change, never checksum/bytes
      if (prev && c === 'sources' && (prev.checksum !== rec.checksum || prev.storageRef !== rec.storageRef)) throw new Error('SOURCE_IMMUTABLE');
      col(c).set(k, clone({ ...rec, organizationId })); return clone(col(c).get(k));
    },
    async get(c, organizationId, id) { const r = col(c).get(key(organizationId, id)); return r ? clone(r) : null; },
    async list(c, organizationId, filter = () => true) { return [...col(c).entries()].filter(([k]) => k.startsWith(organizationId + '\u0000')).map(([, v]) => clone(v)).filter(filter); }
  };
}

/** Postgres implementation: indexed columns + body JSONB (see 012_development_onboarding.sql). */
function createPgOnboardingRepository(pool) {
  const T = c => { if (!COLLECTIONS[c]) throw new Error(`unknown collection ${c}`); return COLLECTIONS[c]; };
  return {
    kind: 'pg',
    async put(c, organizationId, rec) {
      const conflict = APPEND_ONLY.has(c) && c !== 'sources' ? 'DO NOTHING' : 'DO UPDATE SET body = EXCLUDED.body, status = EXCLUDED.status, updated_at = now()';
      const r = await pool.query(`INSERT INTO ${T(c)} (id, organization_id, status, body) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (id) ${conflict} RETURNING body`,
        [rec.id, organizationId, rec.status || null, JSON.stringify({ ...rec, organizationId })]);
      return r.rows[0] ? r.rows[0].body : null;
    },
    async get(c, organizationId, id) { const r = await pool.query(`SELECT body FROM ${T(c)} WHERE organization_id = $1 AND id = $2`, [organizationId, id]); return r.rows[0] ? r.rows[0].body : null; },
    async list(c, organizationId, filter = () => true) { const r = await pool.query(`SELECT body FROM ${T(c)} WHERE organization_id = $1 ORDER BY created_at, id`, [organizationId]); return r.rows.map(x => x.body).filter(filter); }
  };
}
module.exports = { createMemoryOnboardingRepository, createPgOnboardingRepository, COLLECTIONS };
