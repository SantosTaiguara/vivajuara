'use strict';
/* UserDirectoryRepository + AssignmentRepository + TokenRepository + AuditQuery (topic 30). SQL only, parameterized.
   Tokens are looked up by their sha256 (hex); the raw token never reaches the database. */

const iso = d => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

/** active (not revoked, not expired) token → user row, or null */
async function findTokenUser(db, tokenHash) {
  const { rows } = await db.query(
    `SELECT t.id AS token_id, t.expires_at, t.last_used_at, u.id AS user_id, u.status, u.display_name
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > now()`, [tokenHash]);
  return rows[0] || null;
}

/** last_used_at at most once per 5 minutes per token (no write on every request) */
async function touchToken(db, tokenId) {
  await db.query(`UPDATE auth_tokens SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '5 minutes')`, [tokenId]);
}

/** memberships (with organization data) and currently effective assignments of a user */
async function findAccess(db, userId) {
  const [m, a] = await Promise.all([
    db.query(
      `SELECT m.organization_id, m.status, o.slug, o.display_name, o.status AS organization_status
         FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1 ORDER BY o.slug`, [userId]),
    db.query(
      `SELECT role_code, organization_id, development_id FROM role_assignments
        WHERE user_id = $1 AND status = 'ACTIVE' AND (effective_from IS NULL OR effective_from <= now()) AND (effective_to IS NULL OR effective_to > now())
        ORDER BY organization_id, development_id NULLS FIRST, role_code`, [userId])
  ]);
  return {
    memberships: m.rows.map(r => ({ organizationId: r.organization_id, slug: r.slug, displayName: r.display_name, status: r.status, organizationStatus: r.organization_status })),
    assignments: a.rows.map(r => ({ roleCode: r.role_code, organizationId: r.organization_id, developmentId: r.development_id }))
  };
}

async function findOrganization(db, id) {
  const { rows } = await db.query('SELECT id, slug, display_name, status, default_locale, default_timezone, currency FROM organizations WHERE id = $1', [id]);
  return rows[0] || null;
}

async function listOrganizationDevelopments(db, orgId) {
  const { rows } = await db.query('SELECT id, slug, name, visibility FROM developments WHERE organization_id = $1 ORDER BY id', [orgId]);
  return rows;
}

// ---------------------------------------------------------------- administration (scripts/iam.js and tests; no HTTP route yet)
async function createOrganization(db, o) {
  await db.query(`INSERT INTO organizations (id, slug, display_name, status, settings) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [o.id, o.slug, o.displayName, o.status || 'ACTIVE', JSON.stringify(o.settings || {})]);
}
async function createUser(db, u) {
  const { rows } = await db.query(`INSERT INTO users (display_name, status, external_identity_id) VALUES ($1, $2, $3) RETURNING id`,
    [u.displayName, u.status || 'ACTIVE', u.externalIdentityId || null]);
  return rows[0].id;
}
async function setUserStatus(db, userId, status) { await db.query('UPDATE users SET status = $2, updated_at = now() WHERE id = $1', [userId, status]); }
async function addMembership(db, orgId, userId, status = 'ACTIVE') {
  await db.query(`INSERT INTO organization_memberships (organization_id, user_id, status, activated_at) VALUES ($1, $2, $3, CASE WHEN $3 = 'ACTIVE' THEN now() END)
                  ON CONFLICT (organization_id, user_id) DO UPDATE SET status = EXCLUDED.status`, [orgId, userId, status]);
}
async function assignRole(db, a) {
  const { rows } = await db.query(
    `INSERT INTO role_assignments (user_id, role_code, organization_id, development_id, assigned_by, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [a.userId, a.roleCode, a.organizationId, a.developmentId || null, a.assignedBy || null, a.effectiveFrom || null, a.effectiveTo || null]);
  return rows[0].id;
}
async function revokeAssignment(db, id) { await db.query(`UPDATE role_assignments SET status = 'REVOKED' WHERE id = $1`, [id]); }
async function insertToken(db, t) {
  const { rows } = await db.query(`INSERT INTO auth_tokens (user_id, token_hash, label, expires_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [t.userId, t.tokenHash, t.label || null, t.expiresAt]);
  return rows[0].id;
}
async function revokeToken(db, tokenHash) { await db.query('UPDATE auth_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash]); }

// ---------------------------------------------------------------- audit query (GET /api/v1/admin/audit-events)
/** organizationId null = every organization (platform principal only); keyset pagination by id */
async function listAuditEvents(db, { organizationId = null, allOrganizations = false, limit = 50, beforeId = null }) {
  const { rows } = await db.query(
    `SELECT id, created_at, actor_type, actor_id, action, permission_key, outcome, entity_type, entity_id, organization_id, development_id, request_id
       FROM audit_log
      WHERE ($1::boolean OR organization_id = $2) AND ($3::bigint IS NULL OR id < $3)
      ORDER BY id DESC LIMIT $4`, [allOrganizations, organizationId, beforeId, limit]);
  return rows.map(r => ({ id: Number(r.id), occurredAt: iso(r.created_at), actorType: r.actor_type, actorId: r.actor_id, action: r.action, permissionKey: r.permission_key,
    outcome: r.outcome, resourceType: r.entity_type, resourceId: r.entity_id, organizationId: r.organization_id, developmentId: r.development_id, requestId: r.request_id }));
}

module.exports = { findTokenUser, touchToken, findAccess, findOrganization, listOrganizationDevelopments, createOrganization, createUser, setUserStatus, addMembership,
  assignRole, revokeAssignment, insertToken, revokeToken, listAuditEvents };
