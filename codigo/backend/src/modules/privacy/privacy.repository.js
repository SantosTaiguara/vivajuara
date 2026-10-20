'use strict';
/* Topic 59 — privacy repositories. Same interface for memory (tests, no Postgres) and Postgres (migration 013).
   Every read is tenant-scoped: a record of another organization is simply not found. Consents and audit are append-only.
   Requests use optimistic concurrency (expectedRevision). */
const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));

function createMemoryPrivacyRepository() {
  const requests = new Map(), verifications = new Map(), consents = [], audit = [], holds = new Map(), blocks = new Map(), tombstones = new Map(), suppressions = new Map();
  const own = (m, org, id) => { const r = m.get(id); return r && r.organizationId === org ? clone(r) : null; };
  return {
    async insertRequest(r) { requests.set(r.id, clone(r)); return clone(r); },
    async getRequest(org, id) { return own(requests, org, id); },
    async listRequests(org, { status } = {}) { return [...requests.values()].filter(r => r.organizationId === org && (!status || r.status === status)).map(clone); },
    /** updateRequest(next, expectedRevision) → { ok } | { conflict, currentRevision } */
    async updateRequest(next, expectedRevision) {
      const cur = requests.get(next.id);
      if (!cur || cur.organizationId !== next.organizationId) return { notFound: true };
      if (String(cur.revision) !== String(expectedRevision)) return { conflict: true, currentRevision: cur.revision };
      requests.set(next.id, clone(next)); return { ok: true, request: clone(next) };
    },
    async insertVerification(org, v) { verifications.set(v.id, { ...clone(v), organizationId: org }); return clone(v); },
    async getVerification(org, id) { const v = own(verifications, org, id); if (v) delete v.organizationId; return v; },
    async updateVerification(org, v) { verifications.set(v.id, { ...clone(v), organizationId: org }); return clone(v); },
    async appendConsent(c) { consents.push(clone(c)); return clone(c); },
    /** latest record per consent id (history kept: rows are never overwritten) */
    async listConsents(org, subjectRef) {
      const last = new Map(); for (const c of consents) if (c.organizationId === org && c.dataSubjectId === subjectRef) last.set(c.id, c);
      return [...last.values()].map(clone);
    },
    async consentHistory(org, id) { return consents.filter(c => c.organizationId === org && c.id === id).map(clone); },
    async getConsent(org, id) { const h = consents.filter(c => c.organizationId === org && c.id === id); return h.length ? clone(h[h.length - 1]) : null; },
    async appendAudit(e) { audit.push(clone({ ...e, at: e.at || new Date().toISOString() })); },
    async listAudit(org) { return audit.filter(a => a.organizationId === org).map(clone); },
    async saveHold(h) { holds.set(h.id, clone(h)); return clone(h); },
    async getHold(org, id) { return own(holds, org, id); },
    async listHolds(org) { return [...holds.values()].filter(h => h.organizationId === org).map(clone); },
    async saveBlock(org, b) { blocks.set(b.id, { ...clone(b), organizationId: org }); return clone(b); },
    async listBlocks(org) { return [...blocks.values()].filter(b => b.organizationId === org).map(clone); },
    async saveTombstone(org, t) { tombstones.set(`${org}|${t.subjectRef}|${t.dataCategoryRef}`, { ...clone(t), organizationId: org }); return clone(t); },
    async listTombstones(org) { return [...tombstones.values()].filter(t => t.organizationId === org).map(clone); },
    async saveSuppression(org, s) { suppressions.set(`${org}|${s.normalizedContactHash}|${s.channel}|${s.purpose}`, { ...clone(s), organizationId: org }); return clone(s); },
    async listSuppressions(org) { return [...suppressions.values()].filter(s => s.organizationId === org).map(clone); }
  };
}

/** Postgres implementation over a `{ query(sql, params) }` client (pool). Not exercised by the unit tests (no DB here). */
function createPgPrivacyRepository(db) {
  const rows = async (sql, p) => (await db.query(sql, p)).rows;
  const rec = r => r && r.record;
  return {
    async insertRequest(r) { await db.query(`INSERT INTO privacy_requests (id, organization_id, subject_ref, request_type, status, revision, received_at, due_at, record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [r.id, r.organizationId, r.subjectRef, r.requestType, r.status, +r.revision, r.receivedAt, r.dueAt, r]); return r; },
    async getRequest(org, id) { return rec((await rows(`SELECT record FROM privacy_requests WHERE organization_id=$1 AND id=$2`, [org, id]))[0]) || null; },
    async listRequests(org, { status } = {}) { return (await rows(`SELECT record FROM privacy_requests WHERE organization_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY received_at`, [org, status || null])).map(rec); },
    async updateRequest(next, expectedRevision) {
      const r = await rows(`UPDATE privacy_requests SET status=$3, revision=$4, due_at=$5, record=$6, updated_at=now() WHERE organization_id=$1 AND id=$2 AND revision=$7 RETURNING record`, [next.organizationId, next.id, next.status, +next.revision, next.dueAt, next, +expectedRevision]);
      if (r.length) return { ok: true, request: r[0].record };
      const cur = await rows(`SELECT revision FROM privacy_requests WHERE organization_id=$1 AND id=$2`, [next.organizationId, next.id]);
      return cur.length ? { conflict: true, currentRevision: String(cur[0].revision) } : { notFound: true };
    },
    async insertVerification(org, v) { await db.query(`INSERT INTO privacy_identity_verifications (id, organization_id, request_id, method, result, evidence_ref, verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [v.id, org, v.requestId, v.method, v.result, v.evidenceRef, v.verifiedAt]); return v; },
    async getVerification(org, id) { const r = (await rows(`SELECT id, request_id AS "requestId", method, result, evidence_ref AS "evidenceRef", verified_at AS "verifiedAt" FROM privacy_identity_verifications WHERE organization_id=$1 AND id=$2`, [org, id]))[0]; return r ? { ...r, verifiedAt: r.verifiedAt && new Date(r.verifiedAt).toISOString(), retentionPolicyRef: 'RET_IDENTITY_VERIFICATION' } : null; },
    async updateVerification(org, v) { await db.query(`UPDATE privacy_identity_verifications SET result=$3, evidence_ref=$4, verified_at=$5 WHERE organization_id=$1 AND id=$2`, [org, v.id, v.result, v.evidenceRef, v.verifiedAt]); return v; },
    async appendConsent(c) { await db.query(`INSERT INTO privacy_consents (id, organization_id, subject_ref, purpose_id, notice_version_id, consent_text_checksum, status, record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [c.id, c.organizationId, c.dataSubjectId, c.purposeId, c.noticeVersionId, c.consentTextChecksum, c.status, c]); return c; },
    async listConsents(org, subjectRef) { return (await rows(`SELECT DISTINCT ON (id) record FROM privacy_consents WHERE organization_id=$1 AND subject_ref=$2 ORDER BY id, seq DESC`, [org, subjectRef])).map(rec); },
    async consentHistory(org, id) { return (await rows(`SELECT record FROM privacy_consents WHERE organization_id=$1 AND id=$2 ORDER BY seq`, [org, id])).map(rec); },
    async getConsent(org, id) { return rec((await rows(`SELECT record FROM privacy_consents WHERE organization_id=$1 AND id=$2 ORDER BY seq DESC LIMIT 1`, [org, id]))[0]) || null; },
    async appendAudit(e) { await db.query(`INSERT INTO privacy_audit (organization_id, entity_type, entity_id, action, actor_id, details) VALUES ($1,$2,$3,$4,$5,$6)`, [e.organizationId, e.entityType, e.entityId, e.action, e.actorId || null, e.details || {}]); },
    async listAudit(org) { return rows(`SELECT entity_type AS "entityType", entity_id AS "entityId", action, actor_id AS "actorId", at, details FROM privacy_audit WHERE organization_id=$1 ORDER BY seq`, [org]); },
    async saveHold(h) { await db.query(`INSERT INTO privacy_legal_holds (id, organization_id, subject_ref, status, record, created_at, released_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, record=EXCLUDED.record, released_at=EXCLUDED.released_at`, [h.id, h.organizationId, h.subjectRef, h.status, h, h.createdAt, h.releasedAt]); return h; },
    async getHold(org, id) { return rec((await rows(`SELECT record FROM privacy_legal_holds WHERE organization_id=$1 AND id=$2`, [org, id]))[0]) || null; },
    async listHolds(org) { return (await rows(`SELECT record FROM privacy_legal_holds WHERE organization_id=$1`, [org])).map(rec); },
    async saveBlock(org, b) { await db.query(`INSERT INTO privacy_processing_blocks (id, organization_id, subject_ref, record, active_from, active_to) VALUES ($1,$2,$3,$4,$5,$6)`, [b.id, org, b.subjectRef, b, b.activeFrom, b.activeTo]); return b; },
    async listBlocks(org) { return (await rows(`SELECT record FROM privacy_processing_blocks WHERE organization_id=$1`, [org])).map(rec); },
    async saveTombstone(org, t) { await db.query(`INSERT INTO privacy_tombstones (id, organization_id, subject_ref, data_category_ref, reason_ref, expires_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [t.id, org, t.subjectRef, t.dataCategoryRef, t.reasonRef, t.expiresAt]); return t; },
    async listTombstones(org) { return rows(`SELECT id, subject_ref AS "subjectRef", data_category_ref AS "dataCategoryRef", reason_ref AS "reasonRef", created_at AS "createdAt", expires_at AS "expiresAt" FROM privacy_tombstones WHERE organization_id=$1`, [org]); },
    async saveSuppression(org, s) { await db.query(`INSERT INTO privacy_suppressions (organization_id, normalized_contact_hash, channel, purpose, reason) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [org, s.normalizedContactHash, s.channel, s.purpose, s.reason]); return s; },
    async listSuppressions(org) { return rows(`SELECT normalized_contact_hash AS "normalizedContactHash", channel, purpose, reason FROM privacy_suppressions WHERE organization_id=$1`, [org]); }
  };
}

module.exports = { createMemoryPrivacyRepository, createPgPrivacyRepository };
