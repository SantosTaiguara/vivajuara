'use strict';
/* Topic 61 — DataQualityRepository interface (tables of migration 015) with two implementations:
   createMemoryDataQualityRepository() for DB-free tests, createPgDataQualityRepository(pool) for production.
   Every method is tenant-scoped: (organizationId, id). A record of another organization is simply not found.
   Collections: runs, findings, exceptions, incidents, certifications, reconciliations, changes, snapshots (append-only). */
const COLLECTIONS = Object.freeze(['runs', 'findings', 'exceptions', 'incidents', 'certifications', 'reconciliations', 'changes', 'snapshots']);
const clone = x => JSON.parse(JSON.stringify(x));

function createMemoryDataQualityRepository() {
  const data = Object.fromEntries(COLLECTIONS.map(c => [c, new Map()]));
  const key = (org, id) => `${org}\u0000${id}`;
  const col = c => { if (!data[c]) throw new Error(`unknown collection ${c}`); return data[c]; };
  return {
    kind: 'memory',
    async put(c, organizationId, rec) {
      if (!organizationId) throw new Error('organizationId required');
      const id = rec.id || rec.publicationId, k = key(organizationId, id);
      if (c === 'snapshots' && col(c).has(k)) throw new Error('dq_publication_snapshots is append-only');
      col(c).set(k, clone({ ...rec, organizationId })); return clone(col(c).get(k));
    },
    async get(c, organizationId, id) { const r = col(c).get(key(organizationId, id)); return r ? clone(r) : null; },
    async list(c, organizationId, filter = () => true) { return [...col(c).entries()].filter(([k]) => k.startsWith(organizationId + '\u0000')).map(([, v]) => clone(v)).filter(filter); }
  };
}

/** Postgres implementation (not exercised here: no DB password). Records are stored with their indexed columns + body JSONB. */
function createPgDataQualityRepository(pool) {
  const TABLE = { runs: 'dq_check_runs', findings: 'dq_findings', exceptions: 'dq_exceptions', incidents: 'dq_incidents', certifications: 'dq_certifications',
    reconciliations: 'dq_reconciliation_runs', changes: 'dq_change_requests', snapshots: 'dq_publication_snapshots' };
  const ID = c => (c === 'snapshots' ? 'publication_id' : 'id');
  return {
    kind: 'postgres',
    async put(c, organizationId, rec) {
      // column mapping per table is done by upsertSql(c, rec); kept minimal: body is the source of truth for reads
      const { sql, params } = upsertSql(TABLE[c], c, organizationId, rec);
      await pool.query(sql, params); return rec;
    },
    async get(c, organizationId, id) {
      const { rows } = await pool.query(`SELECT body FROM ${TABLE[c]} WHERE organization_id = $1 AND ${ID(c)} = $2`, [organizationId, id]);
      return rows[0] ? rows[0].body : null;
    },
    async list(c, organizationId, filter = () => true) {
      const { rows } = await pool.query(`SELECT body FROM ${TABLE[c]} WHERE organization_id = $1`, [organizationId]);
      return rows.map(r => r.body).filter(filter);
    }
  };
}
function upsertSql(table, c, org, r) {
  const b = JSON.stringify(r);
  switch (c) {
    case 'findings': return { sql: `INSERT INTO dq_findings (id, organization_id, development_id, data_domain_id, rule_id, rule_version, severity, effective_mode, status, failed_count, evaluated_count, sample_entity_refs, owner_ref, related_incident_id, detected_at, last_observed_at, body)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, failed_count = EXCLUDED.failed_count, sample_entity_refs = EXCLUDED.sample_entity_refs, last_observed_at = EXCLUDED.last_observed_at, owner_ref = EXCLUDED.owner_ref, body = EXCLUDED.body WHERE dq_findings.organization_id = EXCLUDED.organization_id`,
      params: [r.id, org, r.developmentId, r.dataDomainId, r.ruleId, r.ruleVersion, r.severity, r.effectiveMode, r.status, r.failedCount, r.evaluatedCount, r.sampleEntityRefs || [], r.ownerRef, r.relatedIncidentId, r.detectedAt, r.lastObservedAt, b] };
    case 'runs': return { sql: `INSERT INTO dq_check_runs (id, organization_id, development_id, trigger, scope_ref, rule_set_versions, policy_versions, status, results, started_at, completed_at, requested_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`, params: [r.id, org, r.developmentId || null, r.trigger, r.scopeRef, r.ruleSetVersions || [], JSON.stringify(r.policyVersions || {}), r.status, JSON.stringify(r.results || []), r.startedAt, r.completedAt, r.requestedBy || null] };
    case 'exceptions': return { sql: `INSERT INTO dq_exceptions (id, organization_id, finding_or_rule_ref, scope_ref, reason, risk, requested_by, approved_by, approved_at, expires_at, status, body)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO UPDATE SET approved_by = EXCLUDED.approved_by, approved_at = EXCLUDED.approved_at, status = EXCLUDED.status, body = EXCLUDED.body WHERE dq_exceptions.organization_id = EXCLUDED.organization_id`,
      params: [r.id, org, r.findingOrRuleRef, r.scopeRef, r.reason, r.risk, r.requestedBy, r.approvedBy, r.approvedAt, r.expiresAt, r.status, b] };
    case 'incidents': return { sql: `INSERT INTO dq_incidents (id, organization_id, development_id, title, severity, status, owner_ref, detected_at, resolved_at, body)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, resolved_at = EXCLUDED.resolved_at, body = EXCLUDED.body WHERE dq_incidents.organization_id = EXCLUDED.organization_id`,
      params: [r.id, org, r.developmentId, r.title, r.severity, r.status, r.ownerRef, r.detectedAt, r.resolvedAt, b] };
    case 'snapshots': return { sql: `INSERT INTO dq_publication_snapshots (publication_id, organization_id, fingerprint, rule_set_versions, check_run_refs, generated_at, body) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      params: [r.publicationId, org, r.fingerprint, r.ruleSetVersions, r.checkRunRefs, r.generatedAt, b] };
    default: throw new Error(`pg upsert for ${c} not implemented yet (memory repository only)`);
  }
}

module.exports = { COLLECTIONS, createMemoryDataQualityRepository, createPgDataQualityRepository };
