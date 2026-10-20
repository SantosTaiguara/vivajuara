'use strict';
/* Topic 59 — privacy application service. Tenant comes ONLY from the authenticated principal (never from the body);
   every operation checks its permission key (deny by default); the rules are the shared domain (privacy.domain.js).
   A record of another organization answers NOT_FOUND (existence never revealed). Not legal advice: legal values in
   config are null until validated and the domain denies/flags accordingly (deadlines NOT_CONFIGURED, no approved basis). */
const crypto = require('crypto');
const { createPrivacyDomain } = require('./privacy.domain');

class PrivacyError extends Error {
  constructor(status, code, message, details = {}) { super(message); this.status = status; this.code = code; this.details = details; }
}
const STATUS = { NOT_FOUND: 404, PERMISSION_DENIED: 403, TENANT_CONTEXT_REQUIRED: 400, VALIDATION_ERROR: 400, REVISION_CONFLICT: 409 };
const fail = r => { throw new PrivacyError(STATUS[r.code] || 422, r.code, r.message, r.currentRevision != null ? { currentRevision: r.currentRevision } : {}); };
const okOr = r => (r && r.ok === false ? fail(r) : r);

function createPrivacyService({ repo, domain = createPrivacyDomain(), clock = () => new Date().toISOString(), idGen } = {}) {
  if (!repo) throw new Error('privacy repository required');
  const { workflow: W, core: C } = domain;
  const gen = idGen || (p => `${p}_${crypto.randomBytes(9).toString('hex')}`);
  const opts = (extra = {}) => ({ now: clock(), ...extra });

  function guard(principal, permission) {
    if (!principal || !principal.actorId) throw new PrivacyError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
    if (!principal.organizationId) throw new PrivacyError(400, 'TENANT_CONTEXT_REQUIRED', 'Organização ativa obrigatória.');
    if (!(principal.permissions || []).includes(permission)) throw new PrivacyError(403, 'PERMISSION_DENIED', 'Permissão negada.', { permission });
    return { organizationId: principal.organizationId, actorId: principal.actorId };
  }
  const audit = (ctx, entityType, entityId, action, details = {}) => repo.appendAudit({ organizationId: ctx.organizationId, entityType, entityId, action, actorId: ctx.actorId, details });
  const reid = (rec, prefix) => ({ ...rec, id: gen(prefix) });

  async function loadRequest(ctx, id) { const r = await repo.getRequest(ctx.organizationId, id); if (!r) throw new PrivacyError(404, 'NOT_FOUND', 'Solicitação não encontrada.'); return r; }

  return {
    /** registry summary: maturity, blockers, registers (codes and ids only) — privacy.registry.view */
    async registry(principal) { guard(principal, 'privacy.registry.view'); return C.compliancePackage(); },
    async metrics(principal) {
      const ctx = guard(principal, 'privacy.registry.view');
      return W.metrics({ requests: await repo.listRequests(ctx.organizationId), now: clock() });
    },
    // ---- data subject requests ----
    async createRequest(principal, body = {}) {
      const ctx = guard(principal, 'privacy.request.manage');
      const r = okOr(W.createRequest(ctx, { requestType: body.requestType, subjectRef: body.subjectRef, channel: body.channel, representative: body.representative }, opts({ actorId: ctx.actorId })));
      const req = reid(r.request, 'dsr'); await repo.insertRequest(req); await audit(ctx, 'REQUEST', req.id, 'RECEIVED', { requestType: req.requestType });
      return req;
    },
    async listRequests(principal, q = {}) { const ctx = guard(principal, 'privacy.request.manage'); return repo.listRequests(ctx.organizationId, { status: q.status }); },
    async getRequest(principal, id) { const ctx = guard(principal, 'privacy.request.manage'); return loadRequest(ctx, id); },
    async startVerification(principal, id, body = {}) {
      const ctx = guard(principal, 'privacy.request.manage'), r = await loadRequest(ctx, id);
      const v = reid(okOr(W.startVerification(r, body.method, opts())).verification, 'idv');
      await repo.insertVerification(ctx.organizationId, v);
      const t = okOr(W.transition(ctx, r, 'IDENTITY_VERIFICATION', opts({ expectedRevision: body.expectedRevision ?? r.revision, actorId: ctx.actorId })));
      const u = await repo.updateRequest(t.request, r.revision); if (u.conflict) fail({ code: 'REVISION_CONFLICT', message: 'A solicitação mudou.', currentRevision: u.currentRevision });
      await audit(ctx, 'REQUEST', id, 'IDENTITY_VERIFICATION', { method: v.method });
      return { request: u.request, verification: v };
    },
    async completeVerification(principal, id, body = {}) {
      const ctx = guard(principal, 'privacy.request.manage'), r = await loadRequest(ctx, id);
      const v0 = await repo.getVerification(ctx.organizationId, body.verificationId);
      if (!v0 || v0.requestId !== r.id) throw new PrivacyError(404, 'NOT_FOUND', 'Verificação não encontrada.');
      const v = okOr(W.completeVerification(v0, body.result, opts({ evidenceRef: body.evidenceRef }))).verification;
      await repo.updateVerification(ctx.organizationId, v); await audit(ctx, 'VERIFICATION', v.id, v.result);
      return v;
    },
    async transitionRequest(principal, id, body = {}) {
      const ctx = guard(principal, 'privacy.request.manage'), r = await loadRequest(ctx, id);
      const verification = body.verificationId ? await repo.getVerification(ctx.organizationId, body.verificationId) : null;
      const t = okOr(W.transition(ctx, r, body.to, opts({ expectedRevision: body.expectedRevision, verification, denialReasonCode: body.denialReasonCode, resolutionSummary: body.resolutionSummary, actorId: ctx.actorId })));
      const u = await repo.updateRequest(t.request, r.revision);
      if (u.conflict) fail({ code: 'REVISION_CONFLICT', message: 'A solicitação mudou.', currentRevision: u.currentRevision });
      await audit(ctx, 'REQUEST', id, body.to, body.denialReasonCode ? { denialReasonCode: body.denialReasonCode } : {});
      return u.request;
    },
    // ---- consent (append-only) ----
    async grantConsent(principal, body = {}) {
      const ctx = guard(principal, 'privacy.consent.manage');
      const rec = reid(okOr(W.grantConsent({ ...body, organizationId: ctx.organizationId }, opts())).record, 'cns');
      await repo.appendConsent(rec); await audit(ctx, 'CONSENT', rec.id, 'GRANTED', { purposeId: rec.purposeId, noticeVersionId: rec.noticeVersionId });
      return rec;
    },
    async withdrawConsent(principal, id) {
      const ctx = guard(principal, 'privacy.consent.manage'), cur = await repo.getConsent(ctx.organizationId, id);
      if (!cur) throw new PrivacyError(404, 'NOT_FOUND', 'Consentimento não encontrado.');
      const w = okOr(W.withdrawConsent(cur, opts()));
      await repo.appendConsent(w.record); await audit(ctx, 'CONSENT', id, 'WITHDRAWN', { purposeId: cur.purposeId });
      return w;
    },
    async listConsents(principal, subjectRef) {
      const ctx = guard(principal, 'privacy.consent.manage');
      if (!subjectRef || C.piiInKey(subjectRef)) throw new PrivacyError(400, 'VALIDATION_ERROR', 'subjectRef deve ser id opaco.');
      return repo.listConsents(ctx.organizationId, subjectRef);
    },
    // ---- legal hold / processing block / suppression ----
    async createLegalHold(principal, body = {}) {
      const ctx = guard(principal, 'privacy.legal_hold.manage');
      const h = reid(okOr(W.createLegalHold(ctx, body, opts({ actorId: ctx.actorId }))).hold, 'hold');
      await repo.saveHold(h); await audit(ctx, 'LEGAL_HOLD', h.id, 'ACTIVE'); return h;
    },
    async releaseLegalHold(principal, id) {
      const ctx = guard(principal, 'privacy.legal_hold.manage'), h = await repo.getHold(ctx.organizationId, id);
      if (!h) throw new PrivacyError(404, 'NOT_FOUND', 'Legal hold não encontrado.');
      const r = okOr(W.releaseLegalHold(ctx, h, opts({ actorId: ctx.actorId }))).hold;
      await repo.saveHold(r); await audit(ctx, 'LEGAL_HOLD', id, 'RELEASED'); return r;
    },
    async createBlock(principal, body = {}) {
      const ctx = guard(principal, 'privacy.request.manage');
      const b = reid(okOr(W.createBlock(body, opts())).block, 'blk');
      await repo.saveBlock(ctx.organizationId, b); await audit(ctx, 'BLOCK', b.id, 'ACTIVE'); return b;
    },
    async suppress(principal, body = {}) {
      const ctx = guard(principal, 'privacy.consent.manage');
      const s = okOr(W.suppression(body.contact, body.channel, body.purpose || 'MARKETING', body.reason || 'OPT_OUT', opts())).suppression;
      await repo.saveSuppression(ctx.organizationId, s); await audit(ctx, 'SUPPRESSION', s.normalizedContactHash.slice(0, 16), 'CREATED', { channel: s.channel });
      return { channel: s.channel, purpose: s.purpose, createdAt: s.createdAt }; // the contact (even hashed) is not echoed
    },
    async operationalState(principal, subjectRef) {
      const ctx = guard(principal, 'privacy.request.manage');
      return { subjectRef, state: W.operationalState(subjectRef, { holds: await repo.listHolds(ctx.organizationId), blocks: await repo.listBlocks(ctx.organizationId), tombstones: await repo.listTombstones(ctx.organizationId), now: clock() }) };
    },
    // ---- retention ----
    async retentionDryRun(principal, body = {}) {
      const ctx = guard(principal, 'privacy.retention.execute');
      const out = W.retentionDryRun(Array.isArray(body.records) ? body.records : [], opts({ holds: await repo.listHolds(ctx.organizationId) }));
      await audit(ctx, 'RETENTION', 'dry-run', 'DRY_RUN', { candidates: out.candidates }); return out;
    },
    async audit(principal) { const ctx = guard(principal, 'privacy.registry.view'); return repo.listAudit(ctx.organizationId); }
  };
}

module.exports = { createPrivacyService, PrivacyError };
