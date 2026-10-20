'use strict';
/* Repositories of topic 63 (interfaces + in-memory implementation for DB-free tests + Postgres implementation over
   migration 016). Tenant isolation lives here too: every read takes organizationId and a development of another
   organization is simply "not found" (§188, §431, §555).
     DevelopmentLocationRepository: get(organizationId, developmentId) → { location, intelligence, viewport } | null
                                    publish(organizationId, location, change, audit) · createChange · getChange · saveChange
     PlaceRefRepository:            upsert(refs[]) · has({ organizationId, developmentId, locationVersion, providerPlaceId })
   Only Place IDs (+ our own derived scope facts) are persisted. Never names, coordinates, addresses, ratings or reviews. */
const crypto = require('crypto');
const clone = o => JSON.parse(JSON.stringify(o));

function createMemoryLocationRepository(cfg) {
  const rows = new Map(), changes = new Map(), audit = [];
  for (const [id, d] of Object.entries(cfg.developments)) rows.set(id, clone(d));
  return {
    async get(organizationId, developmentId) { const r = rows.get(developmentId); return r && r.location.organizationId === organizationId ? clone(r) : null; },
    async createChange(organizationId, change) { const id = change.id || `lc_${crypto.randomBytes(8).toString('hex')}`; changes.set(id, { ...clone(change), id, organizationId }); return clone(changes.get(id)); },
    async getChange(organizationId, id) { const c = changes.get(id); return c && c.organizationId === organizationId ? clone(c) : null; },
    async saveChange(organizationId, change) { const c = changes.get(change.id); if (!c || c.organizationId !== organizationId) return null; changes.set(change.id, { ...clone(change), organizationId }); return clone(change); },
    async publish(organizationId, location, change, event) {
      const r = rows.get(location.developmentId); if (!r || r.location.organizationId !== organizationId) return null;
      r.location = clone(location); changes.set(change.id, { ...clone(change), organizationId }); audit.push(clone(event)); return clone(r);
    },
    _audit: audit,
    _set(developmentId, patch) { const r = rows.get(developmentId); rows.set(developmentId, { ...r, ...clone(patch), location: { ...r.location, ...clone(patch.location || {}) }, intelligence: { ...r.intelligence, ...clone(patch.intelligence || {}) } }); }
  };
}

function createMemoryPlaceRefRepository() {
  const refs = new Map();
  const k = r => [r.organizationId, r.developmentId, r.locationVersion, r.providerPlaceId].join('|');
  return {
    async upsert(list) { for (const r of list) refs.set(k(r), { provider: r.provider, providerPlaceId: r.providerPlaceId, categoryCode: r.categoryCode, organizationId: r.organizationId, developmentId: r.developmentId, locationVersion: r.locationVersion, withinMaxRadius: r.withinMaxRadius === true, recordedAt: r.recordedAt }); return list.length; },
    async has(q) { const r = refs.get(k(q)); return !!r && r.withinMaxRadius; },
    _all: () => [...refs.values()]
  };
}

/** Postgres implementation (migration 016). Not exercised by the DB-free tests (no Postgres password in this environment). */
function createPgLocationRepository(pool, cfg) {
  const rowOf = (r, base) => ({ ...clone(base), location: { ...base.location, organizationId: r.organization_id, center: r.latitude == null ? null : { latitude: Number(r.latitude), longitude: Number(r.longitude) }, maxNearbyRadiusMeters: r.max_radius_m, locationStatus: r.location_status,
    sourceRef: r.source_ref, validationMethod: r.validation_method, validatedBy: r.validated_by, validatedAt: r.validated_at && new Date(r.validated_at).toISOString(), googleMapsEnabled: r.google_maps_enabled, version: r.version } });
  return {
    async get(organizationId, developmentId) {
      const base = cfg.developments[developmentId]; if (!base) return null;
      const { rows } = await pool.query(`SELECT * FROM development_locations WHERE organization_id = $1 AND development_id = $2 AND is_current`, [organizationId, developmentId]);
      return rows[0] ? rowOf(rows[0], base) : base.location.organizationId === organizationId ? clone(base) : null;
    },
    async createChange(organizationId, c) {
      const { rows } = await pool.query(`INSERT INTO development_location_changes (organization_id, development_id, previous_latitude, previous_longitude, proposed_latitude, proposed_longitude, source_ref, reason, validation_method, requested_by, status, base_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'DRAFT',$11) RETURNING id`, [organizationId, c.developmentId, c.previousCenter && c.previousCenter.latitude, c.previousCenter && c.previousCenter.longitude, c.proposedCenter.latitude, c.proposedCenter.longitude, c.sourceRef, c.reason, c.validationMethod, c.requestedBy, c.baseVersion]);
      return { ...c, id: rows[0].id, organizationId };
    },
    async getChange(organizationId, id) {
      const { rows } = await pool.query(`SELECT * FROM development_location_changes WHERE organization_id = $1 AND id = $2`, [organizationId, id]); const r = rows[0]; if (!r) return null;
      return { id: r.id, organizationId, developmentId: r.development_id, previousCenter: r.previous_latitude == null ? null : { latitude: Number(r.previous_latitude), longitude: Number(r.previous_longitude) }, proposedCenter: { latitude: Number(r.proposed_latitude), longitude: Number(r.proposed_longitude) },
        sourceRef: r.source_ref, reason: r.reason, validationMethod: r.validation_method, requestedBy: r.requested_by, approvedBy: r.approved_by, previewConfirmedBy: r.preview_confirmed_by, status: r.status, baseVersion: r.base_version, version: r.published_version };
    },
    async saveChange(organizationId, c) { await pool.query(`UPDATE development_location_changes SET status = $3, approved_by = $4, preview_confirmed_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2`, [organizationId, c.id, c.status, c.approvedBy, c.previewConfirmedBy]); return c; },
    async publish(organizationId, loc, change, event) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE development_locations SET is_current = false WHERE organization_id = $1 AND development_id = $2 AND is_current`, [organizationId, loc.developmentId]);
        await client.query(`INSERT INTO development_locations (organization_id, development_id, version, latitude, longitude, max_radius_m, location_status, source_ref, validation_method, validated_by, validated_at, google_maps_enabled, change_id, is_current)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true)`, [organizationId, loc.developmentId, loc.version, loc.center.latitude, loc.center.longitude, loc.maxNearbyRadiusMeters, loc.locationStatus, loc.sourceRef, loc.validationMethod, loc.validatedBy, loc.validatedAt, !!loc.googleMapsEnabled, change.id]);
        await client.query(`UPDATE development_location_changes SET status = 'PUBLISHED', published_version = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [organizationId, change.id, loc.version]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      return this.get(organizationId, loc.developmentId).then(r => (r && event ? r : r));
    }
  };
}

function createPgPlaceRefRepository(pool) {
  return {
    async upsert(list) {
      for (const r of list) await pool.query(`INSERT INTO surroundings_place_refs (organization_id, development_id, location_version, provider, provider_place_id, category_code, within_max_radius)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (organization_id, development_id, location_version, provider_place_id) DO UPDATE SET category_code = EXCLUDED.category_code, last_seen_at = now()`,
        [r.organizationId, r.developmentId, r.locationVersion, r.provider, r.providerPlaceId, r.categoryCode, r.withinMaxRadius === true]);
      return list.length;
    },
    async has(q) { const { rows } = await pool.query(`SELECT 1 FROM surroundings_place_refs WHERE organization_id = $1 AND development_id = $2 AND location_version = $3 AND provider_place_id = $4 AND within_max_radius`, [q.organizationId, q.developmentId, q.locationVersion, q.providerPlaceId]); return rows.length > 0; }
  };
}

module.exports = { createMemoryLocationRepository, createMemoryPlaceRefRepository, createPgLocationRepository, createPgPlaceRefRepository };
