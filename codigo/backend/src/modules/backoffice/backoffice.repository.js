'use strict';
/* Backoffice repositories (topic 60). Interface (async):
     commands:    findByIdempotency(org, actorId, key) → row|null ; insert(row)
     configs:     current(org, type, scope) → { version, revision, content }|null ; versions(org, type, scope) → [] ;
                  publish({ org, type, scope, content, contentHash, restoresVersion, changeRef, publishedBy, expectedRevision }) → { version, revision } | { conflict, currentRevision }
                  getChange(id) → change|null ; markChange(id, status)
     assignments: get(org, ref) → row|null ; upsert(row, expectedRevision) → { revision } | { conflict, currentRevision }
     support:     active(org, now) → [] ; insert(row) → row ; end(id, status)
     emergency:   active(org, now) → [] ; insert(row) → row ; release(id, by, at)
   createMemoryBackofficeRepository() is used by the DB-free tests; createPgBackofficeRepository(pool) maps the same
   interface to migration 014 (not exercised here: no database password in this environment). */
const crypto = require('crypto');
const clone = x => JSON.parse(JSON.stringify(x));

function createMemoryBackofficeRepository() {
  const commands = [], versions = [], current = new Map(), changes = new Map(), assignments = new Map(), support = [], emergency = [];
  const ck = (o, t, s) => `${o}|${t}|${s}`;
  return {
    _state: { commands, versions, current, changes, assignments, support, emergency },
    commands: {
      async findByIdempotency(org, actorId, key) { return commands.find(c => c.organizationId === org && c.actorId === actorId && c.idempotencyKey === key) || null; },
      async insert(row) { commands.push(clone(row)); return row; }
    },
    configs: {
      async current(org, type, scope) { const c = current.get(ck(org, type, scope)); if (!c) return null; const v = versions.find(x => x.organizationId === org && x.configType === type && x.scopeRef === scope && x.version === c.version); return { version: c.version, revision: c.revision, content: clone(v.content) }; },
      async versions(org, type, scope) { return versions.filter(x => x.organizationId === org && x.configType === type && x.scopeRef === scope).map(clone); },
      async publish(r) {
        const k = ck(r.org, r.type, r.scope), c = current.get(k);
        if (c && r.expectedRevision != null && String(c.revision) !== String(r.expectedRevision)) return { conflict: true, currentRevision: String(c.revision) };
        const version = (c ? Math.max(...versions.filter(x => ck(x.organizationId, x.configType, x.scopeRef) === k).map(x => x.version)) : 0) + 1;
        versions.push(Object.freeze({ organizationId: r.org, configType: r.type, scopeRef: r.scope, version, content: clone(r.content), contentHash: r.contentHash, restoresVersion: r.restoresVersion || null, changeRef: r.changeRef || null, publishedBy: r.publishedBy, publishedAt: r.at }));
        const revision = c ? c.revision + 1 : 1; current.set(k, { version, revision });
        return { version, revision };
      },
      async getChange(id) { return changes.has(id) ? clone(changes.get(id)) : null; },
      async putChange(ch) { changes.set(ch.id, clone(ch)); },
      async markChange(id, status) { const c = changes.get(id); if (c) c.status = status; }
    },
    assignments: {
      async get(org, ref) { return assignments.has(`${org}|${ref}`) ? clone(assignments.get(`${org}|${ref}`)) : null; },
      async upsert(row, expectedRevision) {
        const k = `${row.organizationId}|${row.workItemRef}`, cur = assignments.get(k);
        if (cur && expectedRevision != null && String(cur.revision) !== String(expectedRevision)) return { conflict: true, currentRevision: String(cur.revision) };
        const revision = cur ? cur.revision + 1 : 1; assignments.set(k, { ...clone(row), revision }); return { revision };
      }
    },
    support: {
      async active(org, now) { return support.filter(s => s.targetOrganizationId === org && s.status === 'ACTIVE' && s.expiresAt > now).map(clone); },
      async insert(row) { const r = { id: crypto.randomUUID(), ...row }; support.push(r); return clone(r); },
      async end(id, status) { const s = support.find(x => x.id === id); if (s) s.status = status; return !!s; },
      async get(id) { const s = support.find(x => x.id === id); return s ? clone(s) : null; }
    },
    emergency: {
      async active(org, now) { return emergency.filter(e => e.organizationId === org && e.status === 'ACTIVE' && e.expiresAt > now).map(clone); },
      async insert(row) { const r = { id: crypto.randomUUID(), ...row }; emergency.push(r); return clone(r); },
      async release(id, by, at) { const e = emergency.find(x => x.id === id); if (!e || e.status !== 'ACTIVE') return false; e.status = 'RELEASED'; e.releasedBy = by; e.releasedAt = at; return true; },
      async get(id) { const e = emergency.find(x => x.id === id); return e ? clone(e) : null; }
    }
  };
}

/** Postgres implementation of the same interface (migration 014). Statements are parameterized; no dynamic SQL. */
function createPgBackofficeRepository(pool) {
  const one = async (sql, p) => (await pool.query(sql, p)).rows[0] || null;
  const ts = v => v == null ? null : new Date(v).toISOString();
  return {
    commands: {
      async findByIdempotency(org, actorId, key) {
        const r = await one('SELECT command_id, request_hash, outcome, result FROM admin_commands WHERE organization_id = $1 AND actor_id = $2 AND idempotency_key = $3', [org, actorId, key]);
        return r && { commandId: r.command_id, requestHash: r.request_hash, outcome: r.outcome, result: r.result };
      },
      async insert(c) {
        await pool.query(`INSERT INTO admin_commands (command_id, organization_id, action_code, resource_ref, actor_id, actor_type, reason_code, expected_revision, new_revision, approval_ref, idempotency_key, request_hash, outcome, result, request_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [c.commandId, c.organizationId, c.actionCode, c.resourceRef, c.actorId, c.actorType, c.reasonCode, c.expectedRevision, c.newRevision, c.approvalRef, c.idempotencyKey, c.requestHash, c.outcome, JSON.stringify(c.result || {}), c.requestId]);
        return c;
      }
    },
    configs: {
      async current(org, type, scope) {
        const r = await one('SELECT c.version, c.revision, v.content FROM admin_config_current c JOIN admin_config_versions v USING (organization_id, config_type, scope_ref, version) WHERE c.organization_id = $1 AND c.config_type = $2 AND c.scope_ref = $3', [org, type, scope]);
        return r && { version: r.version, revision: Number(r.revision), content: r.content };
      },
      async versions(org, type, scope) { return (await pool.query('SELECT version, content, restores_version, published_by, published_at FROM admin_config_versions WHERE organization_id = $1 AND config_type = $2 AND scope_ref = $3 ORDER BY version', [org, type, scope])).rows; },
      async publish(r) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const cur = (await client.query('SELECT version, revision FROM admin_config_current WHERE organization_id = $1 AND config_type = $2 AND scope_ref = $3 FOR UPDATE', [r.org, r.type, r.scope])).rows[0];
          if (cur && r.expectedRevision != null && String(cur.revision) !== String(r.expectedRevision)) { await client.query('ROLLBACK'); return { conflict: true, currentRevision: String(cur.revision) }; }
          const max = (await client.query('SELECT COALESCE(max(version), 0) AS v FROM admin_config_versions WHERE organization_id = $1 AND config_type = $2 AND scope_ref = $3', [r.org, r.type, r.scope])).rows[0].v;
          const version = Number(max) + 1;
          await client.query('INSERT INTO admin_config_versions (organization_id, config_type, scope_ref, version, content, content_hash, restores_version, change_ref, published_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [r.org, r.type, r.scope, version, JSON.stringify(r.content), r.contentHash, r.restoresVersion || null, r.changeRef || null, r.publishedBy]);
          const rev = (await client.query(`INSERT INTO admin_config_current (organization_id, config_type, scope_ref, version) VALUES ($1,$2,$3,$4)
            ON CONFLICT (organization_id, config_type, scope_ref) DO UPDATE SET version = EXCLUDED.version, revision = admin_config_current.revision + 1 RETURNING revision`, [r.org, r.type, r.scope, version])).rows[0].revision;
          await client.query('COMMIT');
          return { version, revision: Number(rev) };
        } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
      },
      async getChange(id) { const r = await one('SELECT * FROM admin_config_changes WHERE id = $1', [id]); return r && { id: r.id, organizationId: r.organization_id, configType: r.config_type, scopeRef: r.scope_ref, status: r.status, requestedBy: r.requested_by, approvedBy: r.approved_by, proposedContent: r.proposed_content }; },
      async putChange(c) { await pool.query('INSERT INTO admin_config_changes (id, organization_id, config_type, scope_ref, current_version, proposed_content, status, requested_by, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [c.id, c.organizationId, c.configType, c.scopeRef, c.currentVersion || null, JSON.stringify(c.proposedContent), c.status, c.requestedBy, c.approvedBy || null]); },
      async markChange(id, status) { await pool.query('UPDATE admin_config_changes SET status = $2, updated_at = now() WHERE id = $1', [id, status]); }
    },
    assignments: {
      async get(org, ref) { const r = await one('SELECT * FROM admin_work_assignments WHERE organization_id = $1 AND work_item_ref = $2', [org, ref]); return r && { organizationId: r.organization_id, workItemRef: r.work_item_ref, assignedToUserId: r.assigned_to_user, assignedToTeamId: r.assigned_to_team, status: r.status, revision: Number(r.revision) }; },
      async upsert(row, expectedRevision) {
        const r = await one(`INSERT INTO admin_work_assignments (organization_id, work_item_ref, assigned_to_user, assigned_to_team, assigned_by, status) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (organization_id, work_item_ref) DO UPDATE SET assigned_to_user = EXCLUDED.assigned_to_user, assigned_to_team = EXCLUDED.assigned_to_team, assigned_by = EXCLUDED.assigned_by, status = EXCLUDED.status, assigned_at = now(), revision = admin_work_assignments.revision + 1
          WHERE $7::bigint IS NULL OR admin_work_assignments.revision = $7::bigint RETURNING revision`, [row.organizationId, row.workItemRef, row.assignedToUserId, row.assignedToTeamId, row.assignedBy, row.status, expectedRevision == null ? null : Number(expectedRevision)]);
        if (r) return { revision: Number(r.revision) };
        const cur = await this.get(row.organizationId, row.workItemRef); return { conflict: true, currentRevision: cur ? String(cur.revision) : null };
      }
    },
    support: {
      async active(org, now) { return (await pool.query("SELECT id, support_user_id, target_organization_id, target_user_id, reason_code, started_at, expires_at, read_only, approved_by, status FROM admin_support_sessions WHERE target_organization_id = $1 AND status = 'ACTIVE' AND expires_at > $2", [org, new Date(now)])).rows
        .map(r => ({ id: r.id, supportUserId: r.support_user_id, targetOrganizationId: r.target_organization_id, targetUserId: r.target_user_id, reason: r.reason_code, startedAt: ts(r.started_at), expiresAt: Date.parse(ts(r.expires_at)), readOnly: r.read_only, approvedBy: r.approved_by, status: r.status })); },
      async insert(s) { const r = await one('INSERT INTO admin_support_sessions (support_user_id, target_organization_id, target_user_id, reason_code, started_at, expires_at, read_only, approved_by, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [s.supportUserId, s.targetOrganizationId, s.targetUserId, s.reason, new Date(s.startedAt), new Date(s.expiresAt), s.readOnly, s.approvedBy, s.status]); return { ...s, id: r.id }; },
      async end(id, status) { return (await pool.query('UPDATE admin_support_sessions SET status = $2 WHERE id = $1 AND status = \'ACTIVE\'', [id, status])).rowCount > 0; },
      async get(id) { const r = await one('SELECT * FROM admin_support_sessions WHERE id = $1', [id]); return r && { id: r.id, supportUserId: r.support_user_id, targetOrganizationId: r.target_organization_id, status: r.status }; }
    },
    emergency: {
      async active(org, now) { return (await pool.query("SELECT * FROM admin_emergency_controls WHERE organization_id = $1 AND status = 'ACTIVE' AND expires_at > $2", [org, new Date(now)])).rows
        .map(r => ({ id: r.id, organizationId: r.organization_id, controlType: r.control_type, scopeRef: r.scope_ref, reason: r.reason_code, activatedBy: r.activated_by, activatedAt: ts(r.activated_at), expiresAt: Date.parse(ts(r.expires_at)), status: r.status })); },
      async insert(e) { const r = await one('INSERT INTO admin_emergency_controls (organization_id, control_type, scope_ref, reason_code, activated_by, activated_at, expires_at, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [e.organizationId, e.controlType, e.scopeRef, e.reason, e.activatedBy, new Date(e.activatedAt), new Date(e.expiresAt), e.status]); return { ...e, id: r.id }; },
      async release(id, by, at) { return (await pool.query("UPDATE admin_emergency_controls SET status = 'RELEASED', released_by = $2, released_at = $3 WHERE id = $1 AND status = 'ACTIVE'", [id, by, new Date(at)])).rowCount > 0; },
      async get(id) { const r = await one('SELECT * FROM admin_emergency_controls WHERE id = $1', [id]); return r && { id: r.id, organizationId: r.organization_id, controlType: r.control_type, status: r.status, activatedBy: r.activated_by }; }
    }
  };
}

module.exports = { createMemoryBackofficeRepository, createPgBackofficeRepository };
