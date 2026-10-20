'use strict';
/* Topic 61 — DataQualityService: the server side of /api/v1/admin/data-quality/* and /api/v1/admin/data-governance/*.
   Uses the SAME shared domain as the frontend (plat/src/dataquality via dataquality.loader.js) and a repository
   interface (dataquality.repository.js). DB-free testable with the memory repository.
   Every call: principal → permission (deny by default) → tenant scope (other organization = DQ_NOT_FOUND, no existence
   leak) → domain rule → persist → audit (critical actions only; automated rule runs are telemetry, not human audit).
   Rule runs are jobs: runChecks returns the run id; the stored run keeps summaries + sampled failures, never the dataset. */
const { attachDataQuality } = require('./dataquality.loader');

const PERMISSIONS = Object.freeze(['data_quality.read', 'data_quality.manage_findings', 'data_quality.run_checks', 'data_quality.manage_rules', 'data_quality.create_exception',
  'data_quality.approve_exception', 'data_quality.manage_incident', 'data_governance.manage_owner', 'data_governance.manage_contract', 'data_governance.certify']);
const HTTP = { DQ_PERMISSION_DENIED: 403, DQ_NOT_FOUND: 404 };
class DataQualityError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.status = HTTP[code] || 422; this.details = details; }
}
const MAX_SAMPLES = 10;

/** actorOf(principal) → { id, organizationId, can } — principal = { actorId, organizationId, permissions: string[] } */
const actorOf = p => (p ? { id: p.actorId, organizationId: p.organizationId, can: k => Array.isArray(p.permissions) && p.permissions.includes(k) } : null);

function createDataQualityService({ App, repo, audit = async () => {}, now = () => Date.now() }) {
  if (!App.dataQuality || !App.dataQuality.workflow) attachDataQuality(App);
  const DQ = App.dataQuality, W = DQ.workflow, E = DQ.engine, M = DQ.model;
  const need = (principal, perm) => { const a = actorOf(principal); if (!a || !a.can(perm)) throw new DataQualityError('DQ_PERMISSION_DENIED', `permissão ${perm} necessária`, { permission: perm }); return a; };
  const unwrap = r => { if (!r.ok) throw new DataQualityError(r.code, r.message); return r.record; };
  const found = async (c, org, id) => { const r = await repo.get(c, org, id); if (!r) throw new DataQualityError('DQ_NOT_FOUND', 'registro não encontrado'); return r; };
  const slimRun = r => ({ ...r, results: r.results.map(x => ({ ...x, failures: (x.failures || []).slice(0, MAX_SAMPLES) })) });

  return {
    PERMISSIONS,
    /** runChecks — POST /admin/data-quality/rules/:id/run (ruleIds=[id]) or full rule set; returns { runId, status } */
    async runChecks(principal, { developmentId, input = {}, ruleIds, ruleSetIds, trigger = 'MANUAL' }) {
      const a = need(principal, 'data_quality.run_checks');
      const p = M.policy(developmentId);
      if (p.organizationId !== a.organizationId) throw new DataQualityError('DQ_NOT_FOUND', 'empreendimento não encontrado');
      const ids = ruleIds || (ruleSetIds ? undefined : p.rules.filter(r => r.status === 'ACTIVE' && r.executionMode !== 'EVENT_DRIVEN').map(r => r.id)); // transaction rules run in their gates
      const run = E.runSafely({ input: { ...input, developmentId, now: input.now ?? now() }, ruleIds: ids, ruleSetIds, trigger });
      await repo.put('runs', a.organizationId, { ...slimRun(run), developmentId, requestedBy: a.id });
      for (const f of run.findings) { const prev = await repo.get('findings', a.organizationId, f.id); await repo.put('findings', a.organizationId, W.refreshFinding(prev, f, now())); }
      return { runId: run.id, status: run.status, findings: run.findings.length };
    },
    async health(principal, { developmentId, input = {} }) {
      const a = need(principal, 'data_quality.read');
      const r = E.assess({ ...input, developmentId, now: input.now ?? now() });
      if (r.policy.organizationId !== a.organizationId) throw new DataQualityError('DQ_NOT_FOUND', 'empreendimento não encontrado');
      return { health: r.health, scorecard: r.scorecard, slos: r.slos.map(s => ({ id: s.id, metricCode: s.metricCode, observedBaseline: s.observedBaseline, target: s.target, status: s.evaluation.status })), metrics: r.metrics };
    },
    async listFindings(principal, q = {}) {
      const a = need(principal, 'data_quality.read'), t = now();
      return repo.list('findings', a.organizationId, f => (!q.domain || f.dataDomainId === q.domain) && (!q.severity || f.severity === q.severity) && (!q.ruleId || f.ruleId === q.ruleId)
        && (!q.developmentId || f.developmentId === q.developmentId) && (!q.status || f.status === q.status) && (!q.ownerRef || f.ownerRef === q.ownerRef) && (!q.minAgeMs || t - Date.parse(f.detectedAt) >= q.minAgeMs));
    },
    async getFinding(principal, id) { const a = need(principal, 'data_quality.read'); return found('findings', a.organizationId, id); },
    async acknowledgeFinding(principal, id) {
      const a = need(principal, 'data_quality.manage_findings'), f = await found('findings', a.organizationId, id);
      return repo.put('findings', a.organizationId, unwrap(W.acknowledge(f, a, { now: now() })));
    },
    async resolveFinding(principal, id, { resolution, verificationRunId }) {
      const a = need(principal, 'data_quality.manage_findings'), f = await found('findings', a.organizationId, id);
      const v = verificationRunId ? await repo.get('runs', a.organizationId, verificationRunId) : null;
      const rec = unwrap(W.resolveFinding(f, a, { resolution, verificationRun: v, now: now() }));
      await audit({ action: 'DQ_FINDING_RESOLVE', organizationId: a.organizationId, actorId: a.id, ref: id });
      return repo.put('findings', a.organizationId, rec);
    },
    async createException(principal, { developmentId, ...cmd }) {
      const a = need(principal, 'data_quality.create_exception');
      return repo.put('exceptions', a.organizationId, unwrap(W.requestException(M.policy(developmentId), { ...cmd, now: now() }, a)));
    },
    async approveException(principal, id) {
      const a = actorOf(principal); if (!a) throw new DataQualityError('DQ_PERMISSION_DENIED', 'autenticação necessária');
      const x = await found('exceptions', a.organizationId, id), rec = unwrap(W.approveException(x, a, { now: now() }));
      await audit({ action: 'DQ_EXCEPTION_APPROVE', organizationId: a.organizationId, actorId: a.id, ref: id });
      return repo.put('exceptions', a.organizationId, rec);
    },
    async listRules(principal, { developmentId }) {
      const a = need(principal, 'data_quality.read'), p = M.policy(developmentId);
      if (p.organizationId !== a.organizationId) throw new DataQualityError('DQ_NOT_FOUND', 'empreendimento não encontrado');
      return p.rules.map(r => ({ id: r.id, version: r.version, name: r.name, dataDomainId: r.dataDomainId, dimension: r.dimension, severity: r.severity, ...M.effectiveMode(r, p), ownerRef: r.ownerRef, status: r.status, policyScope: r.policyScope }));
    },
    async listIncidents(principal) { const a = need(principal, 'data_quality.read'); return repo.list('incidents', a.organizationId); },
    async createIncident(principal, cmd) { const a = need(principal, 'data_quality.manage_incident'); return repo.put('incidents', a.organizationId, unwrap(W.createIncident(cmd, a, { now: now() }))); },
    async contracts(principal, { developmentId }) { need(principal, 'data_quality.read'); return M.policy(developmentId).contracts; },
    async catalog(principal, { developmentId }) {
      need(principal, 'data_quality.read'); const p = M.policy(developmentId);
      return { fields: M.semanticCatalog(p), ownership: M.ownershipMatrix(p), sourceAuthority: M.sourceAuthorityMatrix(p), glossary: M.glossary(p), knownLimitations: M.knownLimitations(p) };
    },
    /** evaluateGate — server-side quality gate for onboarding/publication (topic 58 calls it before publishing a batch) */
    async evaluateGate(principal, input) {
      const a = need(principal, 'data_quality.run_checks');
      const r = DQ.evaluateGate({ ...input, organizationId: a.organizationId, now: input.now ?? now() });
      return r;
    }
  };
}

module.exports = { createDataQualityService, DataQualityError, PERMISSIONS, actorOf };
