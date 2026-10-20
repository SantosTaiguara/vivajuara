'use strict';
/* Repositories of the Google login (W3), each with two implementations behind the same interface:
   - SessionStore  (auth_sessions, auth_used_nonces — migration 010): server-side sessions keyed by sha256(session id);
     the raw session id only exists in the browser cookie. One-time nonces block ID-token replay.
   - IdentityStore (users, organization_memberships, role_assignments from 009 + organization_invitations from 010):
     Google subject → internal user; pending invitations (by sha256 of the normalized e-mail, never the e-mail itself)
     are turned into membership + role assignment at login, in one transaction. No invitation → no user row and no
     permission (deny by default; the session is pseudonymous).
   - AuditSink: login / logout / denied events in audit_log (append-only) — ids only, never e-mail, name or token.
   createPg*(pool) for production; createMemory*() for the DB-free tests and local experiments. */
const { withTransaction } = require('../../shared/db/pool');
const { insertAudit } = require('../../shared/db/audit.repository');

const iso = d => (d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString());
const ms = d => (d == null ? null : d instanceof Date ? d.getTime() : new Date(d).getTime());

// ---------------------------------------------------------------------------------------------- sessions
const sessionRow = r => (r ? { id: r.id, sessionHash: r.session_hash, userId: r.user_id, subjectHash: r.subject_hash, provider: r.provider, displayName: r.display_name,
  createdAt: ms(r.created_at), lastSeenAt: ms(r.last_seen_at), idleExpiresAt: ms(r.idle_expires_at), absoluteExpiresAt: ms(r.absolute_expires_at), revokedAt: ms(r.revoked_at) } : null);

function createPgSessionStore(pool) {
  return {
    kind: 'postgres',
    async insert(s) {
      await pool.query(`INSERT INTO auth_sessions (id, session_hash, user_id, subject_hash, provider, display_name, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`, [s.id, s.sessionHash, s.userId, s.subjectHash, s.provider, s.displayName, iso(s.createdAt), iso(s.idleExpiresAt), iso(s.absoluteExpiresAt)]);
    },
    async findByHash(hash) {
      const { rows } = await pool.query('SELECT * FROM auth_sessions WHERE session_hash = $1', [hash]);
      return sessionRow(rows[0]);
    },
    async touch(hash, { lastSeenAt, idleExpiresAt }) {
      await pool.query('UPDATE auth_sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE session_hash = $1 AND revoked_at IS NULL', [hash, iso(lastSeenAt), iso(idleExpiresAt)]);
    },
    async revoke(hash, reason, at) {
      await pool.query('UPDATE auth_sessions SET revoked_at = $3, revoked_reason = $2 WHERE session_hash = $1 AND revoked_at IS NULL', [hash, reason, iso(at)]);
    },
    async revokeUser(userId, reason, at) {
      const r = await pool.query('UPDATE auth_sessions SET revoked_at = $3, revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, reason, iso(at)]);
      return r.rowCount || 0;
    },
    /** true the first time a nonce is seen (INSERT … ON CONFLICT DO NOTHING); false = replay */
    async markNonceUsed(nonceHash, expiresAt) {
      const r = await pool.query('INSERT INTO auth_used_nonces (nonce_hash, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [nonceHash, iso(expiresAt)]);
      return r.rowCount === 1;
    },
    async purgeExpired(at) {
      const a = await pool.query("DELETE FROM auth_sessions WHERE absolute_expires_at < $1::timestamptz - interval '30 days'", [iso(at)]);
      const b = await pool.query('DELETE FROM auth_used_nonces WHERE expires_at < $1', [iso(at)]);
      return (a.rowCount || 0) + (b.rowCount || 0);
    }
  };
}

function createMemorySessionStore() {
  const sessions = new Map(), nonces = new Map();
  return {
    kind: 'memory', sessions, nonces,
    async insert(s) { if (sessions.has(s.sessionHash)) throw new Error('duplicate session'); sessions.set(s.sessionHash, { ...s, lastSeenAt: s.createdAt, revokedAt: null }); },
    async findByHash(hash) { const s = sessions.get(hash); return s ? { ...s } : null; },
    async touch(hash, { lastSeenAt, idleExpiresAt }) { const s = sessions.get(hash); if (s && !s.revokedAt) Object.assign(s, { lastSeenAt, idleExpiresAt }); },
    async revoke(hash, reason, at) { const s = sessions.get(hash); if (s && !s.revokedAt) Object.assign(s, { revokedAt: at, revokedReason: reason }); },
    async revokeUser(userId, reason, at) { let n = 0; for (const s of sessions.values()) if (s.userId === userId && !s.revokedAt) { Object.assign(s, { revokedAt: at, revokedReason: reason }); n++; } return n; },
    async markNonceUsed(nonceHash, expiresAt) { if (nonces.has(nonceHash)) return false; nonces.set(nonceHash, expiresAt); return true; },
    async purgeExpired(at) { let n = 0; for (const [k, v] of nonces) if (v < at) { nonces.delete(k); n++; } return n; }
  };
}

// ---------------------------------------------------------------------------------------------- identities
function createPgIdentityStore(pool) {
  const accessOf = async (db, userId) => require('../iam/iam.repository').findAccess(db, userId);
  return {
    kind: 'postgres',
    async findUserByExternalId(ext) {
      const { rows } = await pool.query('SELECT id, status, display_name FROM users WHERE external_identity_id = $1', [ext]);
      return rows[0] ? { id: rows[0].id, status: rows[0].status, displayName: rows[0].display_name } : null;
    },
    async findUser(id) {
      const { rows } = await pool.query('SELECT id, status, display_name FROM users WHERE id = $1', [id]);
      return rows[0] ? { id: rows[0].id, status: rows[0].status, displayName: rows[0].display_name } : null;
    },
    async findPendingInvitations(emailHash, at) {
      const { rows } = await pool.query(`SELECT id, organization_id, role_code, development_id FROM organization_invitations
        WHERE email_hash = $1 AND status = 'PENDING' AND expires_at > $2 ORDER BY created_at`, [emailHash, iso(at)]);
      return rows.map(r => ({ id: r.id, organizationId: r.organization_id, roleCode: r.role_code, developmentId: r.development_id }));
    },
    /** creates the user when needed, then membership ACTIVE + role assignment per invitation; marks them ACCEPTED */
    async acceptInvitations({ userId, externalIdentityId, displayName, invitations, at }) {
      return withTransaction(pool, async db => {
        let id = userId, created = false;
        if (!id) {
          const r = await db.query(`INSERT INTO users (display_name, status, external_identity_id, last_login_at) VALUES ($1, 'ACTIVE', $2, $3)
            ON CONFLICT (external_identity_id) DO UPDATE SET updated_at = now() RETURNING id, (xmax = 0) AS inserted`, [displayName, externalIdentityId, iso(at)]);
          id = r.rows[0].id; created = r.rows[0].inserted;
        }
        let accepted = 0;
        for (const inv of invitations) {
          const lock = await db.query(`UPDATE organization_invitations SET status = 'ACCEPTED', accepted_at = $2, accepted_user_id = $3
            WHERE id = $1 AND status = 'PENDING' AND expires_at > $2 RETURNING id`, [inv.id, iso(at), id]);
          if (!lock.rowCount) continue; // accepted concurrently or revoked meanwhile
          await db.query(`INSERT INTO organization_memberships (organization_id, user_id, status, invited_at, activated_at) VALUES ($1, $2, 'ACTIVE', $3, $3)
            ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'ACTIVE', activated_at = COALESCE(organization_memberships.activated_at, EXCLUDED.activated_at)`, [inv.organizationId, id, iso(at)]);
          await db.query(`INSERT INTO role_assignments (user_id, role_code, organization_id, development_id, assigned_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [id, inv.roleCode, inv.organizationId, inv.developmentId, 'invitation:' + inv.id]);
          accepted++;
        }
        return { userId: id, created, accepted };
      });
    },
    async recordLogin(userId, displayName, at) {
      await pool.query('UPDATE users SET last_login_at = $2, display_name = COALESCE($3, display_name), updated_at = now() WHERE id = $1', [userId, iso(at), displayName]);
    },
    findAccess: userId => accessOf(pool, userId),
    async createInvitation(i) {
      const { rows } = await pool.query(`INSERT INTO organization_invitations (organization_id, email_hash, role_code, development_id, invited_by, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, expires_at`, [i.organizationId, i.emailHash, i.roleCode, i.developmentId || null, i.invitedBy || null, iso(i.expiresAt)]);
      return { id: rows[0].id, expiresAt: iso(rows[0].expires_at) };
    },
    async listInvitations(organizationId) {
      const { rows } = await pool.query(`SELECT id, organization_id, left(email_hash, 12) AS email_hash_prefix, role_code, development_id, status, created_at, expires_at, accepted_at
        FROM organization_invitations WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 500`, [organizationId]);
      return rows.map(r => ({ id: r.id, organizationId: r.organization_id, emailHashPrefix: r.email_hash_prefix, roleCode: r.role_code, developmentId: r.development_id,
        status: r.status, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at), acceptedAt: iso(r.accepted_at) }));
    },
    async revokeInvitation(id) {
      const r = await pool.query(`UPDATE organization_invitations SET status = 'REVOKED' WHERE id = $1 AND status = 'PENDING'`, [id]);
      return r.rowCount === 1;
    }
  };
}

/** in-memory IdentityStore. organizations: [{ id, slug, displayName, status }] (org_house7 by default) */
function createMemoryIdentityStore({ organizations = [{ id: 'org_house7', slug: 'house-7', displayName: 'House 7 Imóveis', status: 'ACTIVE' }] } = {}) {
  const users = new Map(), memberships = [], assignments = [], invitations = new Map(), orgs = new Map(organizations.map(o => [o.id, o]));
  let seq = 0;
  const uuid = () => require('crypto').randomUUID();
  return {
    kind: 'memory', users, memberships, assignments, invitations,
    async findUserByExternalId(ext) { for (const u of users.values()) if (u.externalIdentityId === ext) return { id: u.id, status: u.status, displayName: u.displayName }; return null; },
    async findUser(id) { const u = users.get(id); return u ? { id: u.id, status: u.status, displayName: u.displayName } : null; },
    async findPendingInvitations(emailHash, at) {
      return [...invitations.values()].filter(i => i.emailHash === emailHash && i.status === 'PENDING' && i.expiresAt > at).sort((a, b) => a.seq - b.seq)
        .map(i => ({ id: i.id, organizationId: i.organizationId, roleCode: i.roleCode, developmentId: i.developmentId }));
    },
    async acceptInvitations({ userId, externalIdentityId, displayName, invitations: invs, at }) {
      let id = userId, created = false;
      if (!id) { id = uuid(); users.set(id, { id, externalIdentityId, displayName, status: 'ACTIVE', lastLoginAt: at }); created = true; }
      let accepted = 0;
      for (const ref of invs) {
        const inv = invitations.get(ref.id); if (!inv || inv.status !== 'PENDING' || inv.expiresAt <= at) continue;
        Object.assign(inv, { status: 'ACCEPTED', acceptedAt: at, acceptedUserId: id });
        const m = memberships.find(x => x.organizationId === inv.organizationId && x.userId === id);
        if (m) m.status = 'ACTIVE'; else memberships.push({ organizationId: inv.organizationId, userId: id, status: 'ACTIVE' });
        if (!assignments.some(a => a.userId === id && a.roleCode === inv.roleCode && a.organizationId === inv.organizationId && (a.developmentId || null) === (inv.developmentId || null) && a.status === 'ACTIVE'))
          assignments.push({ userId: id, roleCode: inv.roleCode, organizationId: inv.organizationId, developmentId: inv.developmentId || null, status: 'ACTIVE' });
        accepted++;
      }
      return { userId: id, created, accepted };
    },
    async recordLogin(userId, displayName, at) { const u = users.get(userId); if (u) { u.lastLoginAt = at; if (displayName) u.displayName = displayName; } },
    async findAccess(userId) {
      return {
        memberships: memberships.filter(m => m.userId === userId).map(m => { const o = orgs.get(m.organizationId) || { slug: m.organizationId, displayName: m.organizationId, status: 'ACTIVE' };
          return { organizationId: m.organizationId, slug: o.slug, displayName: o.displayName, status: m.status, organizationStatus: o.status }; }),
        assignments: assignments.filter(a => a.userId === userId && a.status === 'ACTIVE').map(a => ({ roleCode: a.roleCode, organizationId: a.organizationId, developmentId: a.developmentId }))
      };
    },
    async createInvitation(i) {
      if (!orgs.has(i.organizationId)) throw new Error('organization not found');
      const id = uuid(); invitations.set(id, { id, seq: ++seq, organizationId: i.organizationId, emailHash: i.emailHash, roleCode: i.roleCode, developmentId: i.developmentId || null,
        invitedBy: i.invitedBy || null, status: 'PENDING', expiresAt: ms(i.expiresAt), createdAt: Date.now() });
      return { id, expiresAt: iso(i.expiresAt) };
    },
    async listInvitations(organizationId) { return [...invitations.values()].filter(i => i.organizationId === organizationId).map(i => ({ id: i.id, organizationId: i.organizationId, emailHashPrefix: i.emailHash.slice(0, 12), roleCode: i.roleCode, developmentId: i.developmentId, status: i.status, expiresAt: iso(i.expiresAt) })); },
    async revokeInvitation(id) { const i = invitations.get(id); if (!i || i.status !== 'PENDING') return false; i.status = 'REVOKED'; return true; },
    /** test helper: change a user's status (suspend / disable) */
    setUserStatus(id, status) { const u = users.get(id); if (u) u.status = status; }
  };
}

// ---------------------------------------------------------------------------------------------- audit
function createPgAuditSink(pool, logger) {
  return { async write(e) { try { await insertAudit(pool, e); } catch (_) { logger && logger.warn('audit write failed', { errorCode: 'AUDIT_WRITE_FAILED', action: e.action }); } } };
}
function createMemoryAuditSink() { const events = []; return { events, async write(e) { events.push({ ...e }); } }; }

module.exports = { createPgSessionStore, createMemorySessionStore, createPgIdentityStore, createMemoryIdentityStore, createPgAuditSink, createMemoryAuditSink };
