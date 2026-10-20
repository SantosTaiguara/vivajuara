'use strict';
/* Topic 58 — onboarding application service. The rules live in the shared domain (App.onboarding.*); this layer only:
   maps the authenticated principal, keeps one workspace per organization (tenant isolation: another organization's
   case is NOT_FOUND), decodes uploads, persists every produced record through the repository and turns domain refusals
   into OnboardingError (status + code). Authorization is injected and denies by default (no permission list → 403).
   Malware scanning is injected; without a scanner a source stays scan NOT_CONFIGURED and is never parsed.
   Nothing here touches the published lots/prices/availability: publishing only moves the onboarding pointer
   (an `activator` adapter, injected, is the only thing that could write elsewhere). */
const { createOnboardingApp } = require('./onboarding.loader');

const PERMISSIONS = Object.freeze(['development_onboarding.read', 'development_onboarding.create', 'development_onboarding.upload_source', 'development_onboarding.map_schema',
  'development_onboarding.resolve_conflict', 'development_onboarding.review_geometry', 'development_onboarding.publish', 'development_onboarding.rollback']);
const STATUS = { PERMISSION_DENIED: 403, CROSS_TENANT_DENIED: 404, NOT_FOUND: 404, UNAUTHENTICATED: 401 };
const statusOf = code => STATUS[code] || (/CONFLICT|REVISION|DUPLICATE|IDEMPOTEN/.test(code) ? 409 : 422);

class OnboardingError extends Error {
  constructor(code, details, refs) { super(code); this.code = code; this.status = statusOf(code); this.details = { ...(details ? { detail: String(details) } : {}), ...(refs || {}) }; }
}
const MAX_UPLOAD_BYTES = 52428800; // hard transport cap; per-type limits come from the onboarding policy

function createOnboardingService({ App = createOnboardingApp(), repo, authorize, scanner = null, extractor = null, now = () => Date.now() } = {}) {
  if (!repo) throw new Error('repository required');
  const O = App.onboarding, workspaces = new Map();
  const clock = () => new Date(now()).toISOString();
  const authz = authorize || ((p, permission) => !!(p && Array.isArray(p.permissions) && p.permissions.includes(permission)));
  const ws = org => { if (!workspaces.has(org)) workspaces.set(org, O.orchestrator.createWorkspace({ organizationId: org, clock, authorize: authz, scanner, extractor })); return workspaces.get(org); };
  const principalOf = p => { if (!p || !p.actorId || !p.organizationId) throw new OnboardingError('UNAUTHENTICATED'); return { id: p.actorId, organizationId: p.organizationId, permissions: [...(p.permissions || [])] }; };
  const unwrap = r => { if (!r || !r.ok) throw new OnboardingError(r ? r.code : 'NOT_FOUND', r && r.details, r && r.refs); if (r.value == null) throw new OnboardingError('NOT_FOUND'); return r.value; };
  const plain = v => JSON.parse(JSON.stringify(v));
  async function persistCase(w, p, caseId) {
    const c = unwrap(w.getCase(p, caseId)); await repo.put('cases', p.organizationId, c);
    for (const s of unwrap(w.listSources(p, caseId))) await repo.put('sources', p.organizationId, s);
    for (const r of unwrap(w.reviewQueue(p, caseId))) await repo.put('reviews', p.organizationId, r);
    const pub = w.publicationState(p, caseId); if (pub.ok && pub.value) await repo.put('publications', p.organizationId, { id: caseId, ...plain(pub.value) });
    return c;
  }
  const call = async (principal, fn) => { const p = principalOf(principal), w = ws(p.organizationId), r = fn(w, p); return { p, w, r, v: unwrap(r) }; };

  return {
    PERMISSIONS,
    async createCase(principal, identity) { const { p, w, v } = await call(principal, (w, p) => w.createCase(p, { ...identity, organizationId: p.organizationId })); await persistCase(w, p, v.id); return plain(v); },
    async getCase(principal, caseId) { const { v } = await call(principal, (w, p) => w.getCase(p, caseId)); return plain(v); },
    async cancelCase(principal, caseId) { const { p, w, v } = await call(principal, (w, p) => w.cancelCase(p, caseId)); await persistCase(w, p, caseId); return plain(v); },
    async uploadSource(principal, caseId, body = {}) {
      const b64 = typeof body.contentBase64 === 'string' ? body.contentBase64 : '';
      if (!b64 || b64.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4) throw new OnboardingError(b64 ? 'FILE_TOO_LARGE' : 'SOURCE_FILE_UNSUPPORTED');
      const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
      const { p, w, v } = await call(principal, (w, p) => w.uploadSource(p, caseId, { sourceType: body.sourceType, purpose: body.purpose, filename: body.filename, bytes, declaredMime: body.declaredMime, metadata: body.metadata, supersedesId: body.supersedesId }));
      await persistCase(w, p, caseId); return plain(v);
    },
    async listSources(principal, caseId) { const { v } = await call(principal, (w, p) => w.listSources(p, caseId)); return plain(v); },
    async declareAuthority(principal, caseId, body) { const { p, w, v } = await call(principal, (w, p) => w.declareAuthority(p, caseId, body || {})); await persistCase(w, p, caseId); return plain(v); },
    async discover(principal, sourceAssetId) { const { v } = await call(principal, (w, p) => w.discover(p, sourceAssetId)); return plain(v); },
    async updateMappings(principal, sourceAssetId, { change, expectedRevision } = {}) {
      const { p, v } = await call(principal, (w, p) => w.updateMappings(p, sourceAssetId, change || {}, expectedRevision));
      await repo.put('mappings', p.organizationId, { id: `${sourceAssetId}:${v.revision}`, ...plain(v) }); return plain(v);
    },
    async createBatch(principal, caseId, body) { const { p, w, v } = await call(principal, (w, p) => w.createBatch(p, caseId, body || {})); await repo.put('batches', p.organizationId, v); await persistCase(w, p, caseId); return plain(v); },
    /** runBatch: DRY_RUN | VALIDATE_ONLY | BUILD_CANDIDATE. existingLots/currentPrices/… are server-side reads injected by the caller, never client input. */
    async runBatch(principal, batchId, { runMode = 'DRY_RUN' } = {}, serverInputs = {}) {
      const { p, w, r, v } = await call(principal, (w, p) => w.runBatch(p, batchId, { ...serverInputs, runMode }));
      const b = unwrap(w.getBatch(p, batchId)); await repo.put('batches', p.organizationId, b);
      await repo.put('runs', p.organizationId, { id: batchId, status: b.status, summary: plain(v.quality ? v.quality.summary : null), gate: plain(v.quality ? v.quality.gate : null), plainSummary: plain(v.plainSummary || []) });
      for (const c of unwrap(w.conflicts(p))) await repo.put('conflicts', p.organizationId, c);
      await persistCase(w, p, b.onboardingCaseId);
      return { batchId, status: b.status, quality: plain(v.quality.summary), gate: plain(v.quality.gate), plainSummary: plain(v.plainSummary || []), candidatePublicationId: r.candidate ? r.candidate.id : null, candidateError: r.candidateError ? r.candidateError.code : undefined };
    },
    async getBatch(principal, batchId) { const { v } = await call(principal, (w, p) => w.getBatch(p, batchId)); return plain(v); },
    async progress(principal, batchId) { const { v } = await call(principal, (w, p) => w.progress(p, batchId)); return plain(v); },
    async reviewQueue(principal, caseId) { const { v } = await call(principal, (w, p) => w.reviewQueue(p, caseId)); return plain(v); },
    async resolveReview(principal, reviewId, body) { const { p, v } = await call(principal, (w, p) => w.resolveReview(p, reviewId, body || {})); await repo.put('reviews', p.organizationId, v); return plain(v); },
    async resolveConflict(principal, conflictId, body) { const { p, v } = await call(principal, (w, p) => w.resolveConflict(p, conflictId, body || {})); await repo.put('conflicts', p.organizationId, v); return plain(v); },
    async approveGeometryMatch(principal, batchId, featureId) { const { v } = await call(principal, (w, p) => w.approveGeometryMatch(p, batchId, featureId)); return plain(v); },
    async decide(principal, caseId, publicationId, body = {}) { const { p, w, v } = await call(principal, (w, p) => w.decide(p, caseId, publicationId, { approve: body.approve === true, reason: body.reason })); await persistCase(w, p, caseId); return plain(v); },
    async publish(principal, caseId, publicationId, body = {}, { activator } = {}) {
      const { p, w, v } = await call(principal, (w, p) => w.publish(p, caseId, publicationId, { expectedPointerRevision: body.expectedPointerRevision, activator }));
      await persistCase(w, p, caseId); if (!v.idempotent) await repo.put('audit', p.organizationId, { id: `pub:${v.publicationId}:${v.publicationNumber}`, status: 'PUBLISHED', at: clock(), by: p.id }); return plain(v);
    },
    async rollback(principal, caseId, body = {}) { const { p, w, v } = await call(principal, (w, p) => w.rollback(p, caseId, body)); await persistCase(w, p, caseId); return plain(v); },
    async publicationState(principal, caseId) { const { v } = await call(principal, (w, p) => w.publicationState(p, caseId)); return plain(v); },
    /** audit / security events carry ids only (no file contents, no PII) */
    audit(principal) { const p = principalOf(principal); if (!authz(p, 'development_onboarding.read')) throw new OnboardingError('PERMISSION_DENIED'); return plain(ws(p.organizationId).audit()); },
    securityEvents(principal) { const p = principalOf(principal); if (!authz(p, 'development_onboarding.read')) throw new OnboardingError('PERMISSION_DENIED'); return plain(ws(p.organizationId).securityEvents()); }
  };
}
module.exports = { createOnboardingService, OnboardingError, PERMISSIONS, MAX_UPLOAD_BYTES };
