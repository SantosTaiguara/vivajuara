/* dataquality/dqWorkflow.js — topic 61: governed workflows over the quality records (App.dataQuality.workflow).
   Finding lifecycle, exceptions (reason + approval + expiry), rule versioning and rollout (SHADOW → WARNING → ENFORCED
   with dry-run), incidents SEV1–SEV4 (impact, RCA, remediation, verification, postmortem), remediation plans, data change
   requests, source authority change (requires reconciliation), data contracts (compatibility + consumer impact) and
   certification (expiry + invalidation).

   Every mutating function is pure: (record, command, actor) → { ok, record | code, message } and never edits its input.
   actor = { id, organizationId, can(permission) → boolean } — deny by default (no actor / no can → DENIED).
   The frontend is never the authority: the backend re-checks the permission and the tenant before persisting.
   No PII: actor ids are opaque refs; evidence keeps entity refs and counts, never personal data. */
var App = (typeof App !== 'undefined' && App) || (typeof globalThis !== 'undefined' && globalThis.App) || {};
App.dataQuality = App.dataQuality || {};
App.dataQuality.workflow = (() => {
  const M = App.dataQuality.model, EN = App.dataQuality.engine, P = M.PERMISSIONS, ER = M.ERRORS;
  const ok = (record, extra = {}) => ({ ok: true, record: M.freeze(M.clone(record)), ...extra });
  const no = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
  const toMs = t => t == null ? null : typeof t === 'number' ? t : Date.parse(t);
  const iso = ms => new Date(ms).toISOString();
  const nowOf = o => toMs(o && o.now) ?? Date.now();
  const allowed = (actor, perm) => !!(actor && typeof actor.can === 'function' && actor.can(perm) === true);
  const sameTenant = (actor, rec) => !rec.organizationId || !actor || actor.organizationId === rec.organizationId;
  const guard = (actor, perm, rec) => !allowed(actor, perm) ? no(ER.DQ_PERMISSION_DENIED, `permissão ${perm} necessária`, { permission: perm })
    : rec && !sameTenant(actor, rec) ? no(ER.DQ_NOT_FOUND, 'registro não encontrado') : null; // other tenant = not found (no existence leak)
  const audit = (rec, action, actor, now, extra = {}) => [...(rec.history || []), { action, actorRef: actor ? actor.id : null, at: iso(now), ...extra }];

  // ------------------------------------------------------------------ findings (§54, §55, §383–§386)
  const FINDING_TRANSITIONS = Object.freeze({ OPEN: ['ACKNOWLEDGED', 'IN_REMEDIATION', 'FALSE_POSITIVE', 'ACCEPTED_EXCEPTION', 'RESOLVED'], ACKNOWLEDGED: ['IN_REMEDIATION', 'FALSE_POSITIVE', 'ACCEPTED_EXCEPTION', 'RESOLVED'],
    IN_REMEDIATION: ['RESOLVED', 'ACCEPTED_EXCEPTION', 'FALSE_POSITIVE'], RESOLVED: ['OPEN'], ACCEPTED_EXCEPTION: ['OPEN'], FALSE_POSITIVE: ['OPEN'] });
  function transitionFinding(f, to, actor, o = {}) {
    const g = guard(actor, P.MANAGE_FINDINGS, f); if (g) return g;
    if (!(FINDING_TRANSITIONS[f.status] || []).includes(to)) return no(ER.DQ_INVALID_TRANSITION, `${f.status} → ${to} não permitido`);
    const now = nowOf(o);
    if (to === 'FALSE_POSITIVE' && !(o.reason && String(o.reason).trim().length >= 10)) return no(ER.DQ_REASON_REQUIRED, 'falso positivo exige motivo (mínimo 10 caracteres)');
    if (to === 'ACCEPTED_EXCEPTION') { const x = o.exception; if (!x || EN.exceptionState(x, now) !== 'ACTIVE' || ![f.id, f.ruleId].includes(x.findingOrRuleRef)) return no(ER.DQ_EXCEPTION_NOT_ALLOWED, 'exceção ativa e aprovada exigida'); }
    if (to === 'RESOLVED') {
      const r = o.resolution || {};
      if (!M.ResolutionType[r.resolutionType] || r.resolutionType === 'FALSE_POSITIVE' || r.resolutionType === 'EXCEPTION_APPROVED') return no(ER.DQ_EVIDENCE_REQUIRED, 'tipo de resolução inválido');
      if (!Array.isArray(r.evidenceRefs) || !r.evidenceRefs.length) return no(ER.DQ_EVIDENCE_REQUIRED, 'resolução exige evidência');
      const v = o.verificationRun; // re-run of the rule after the fix (§385)
      const res = v && (v.results || []).find(x => x.ruleId === f.ruleId);
      if (!res || res.status !== 'PASSED' && !(res.status === 'FAILED' && !(res.failures || []).some(x => (f.sampleEntityRefs || []).includes(x.entityRef)))) return no(ER.DQ_VERIFICATION_REQUIRED, 'a regra precisa ser reexecutada e passar para resolver');
      return ok({ ...f, status: 'RESOLVED', resolution: { findingId: f.id, resolutionType: r.resolutionType, evidenceRefs: r.evidenceRefs, verificationRunRef: v.id, resolvedBy: actor.id, resolvedAt: iso(now) }, resolvedAt: iso(now),
        history: audit(f, 'RESOLVE', actor, now) }, { audit: { action: 'DQ_FINDING_RESOLVE', ref: f.id } });
    }
    return ok({ ...f, status: to, ...(to === 'FALSE_POSITIVE' ? { falsePositiveReason: o.reason } : {}), ...(to === 'ACCEPTED_EXCEPTION' ? { exceptionRef: o.exception.id } : {}),
      ...(o.assigneeRef ? { ownerRef: o.assigneeRef } : {}), history: audit(f, to, actor, now, o.reason ? { reason: o.reason } : {}) });
  }
  const acknowledge = (f, actor, o) => transitionFinding(f, 'ACKNOWLEDGED', actor, o);
  const startRemediation = (f, actor, o) => transitionFinding(f, 'IN_REMEDIATION', actor, o);
  const resolveFinding = (f, actor, o) => transitionFinding(f, 'RESOLVED', actor, o);
  const markFalsePositive = (f, actor, o) => transitionFinding(f, 'FALSE_POSITIVE', actor, o);
  /** refreshFinding(previous, observed, now) → same id observed again: lastObservedAt moves, a RESOLVED/FALSE_POSITIVE finding that re-fails is reopened */
  function refreshFinding(prev, observed, now) {
    if (!prev) return observed;
    const reopen = ['RESOLVED'].includes(prev.status);
    return M.freeze({ ...prev, lastObservedAt: observed.lastObservedAt || iso(now), failedCount: observed.failedCount, failedEntityCount: observed.failedEntityCount, sampleEntityRefs: observed.sampleEntityRefs, samples: observed.samples,
      status: reopen ? 'OPEN' : prev.status, reopenedAt: reopen ? iso(now) : prev.reopenedAt || null });
  }

  // ------------------------------------------------------------------ exceptions (§56–§60, §230, §365)
  /** requestException(policy, cmd, actor) → PENDING_APPROVAL exception; refuses non-waivable rules, missing reason/expiry, too long */
  function requestException(p, cmd, actor) {
    const g = guard(actor, P.CREATE_EXCEPTION); if (g) return g;
    const r = M.rule(p, cmd.ruleId); if (!r) return no(ER.DQ_NOT_FOUND, 'regra desconhecida');
    const pol = EN.exceptionAllowedFor(p, r);
    if (!pol.allowed) return no(pol.reason, pol.reason === ER.DQ_POLICY_NOT_CONFIGURED ? 'política de exceção não configurada para esta regra (necessita confirmação)' : 'esta regra não aceita exceção');
    if (!(cmd.reason && String(cmd.reason).trim().length >= 10)) return no(ER.DQ_REASON_REQUIRED, 'exceção exige motivo');
    const now = nowOf(cmd), exp = toMs(cmd.expiresAt);
    if (exp == null || Number.isNaN(exp) || exp <= now) return no(ER.DQ_EXCEPTION_EXPIRY_REQUIRED, 'toda exceção expira: informe expiresAt futuro');
    if (exp - now > pol.maxDurationMs) return no(ER.DQ_EXCEPTION_TOO_LONG, 'prazo acima do máximo da política');
    if (!M.ExceptionRisk[cmd.risk]) return no(ER.DQ_INVALID_ENUM, 'risco inválido');
    return ok({ id: cmd.id || 'dqx_' + EN.fingerprint([cmd.findingOrRuleRef || r.id, cmd.scopeRef, now]), organizationId: actor.organizationId, findingOrRuleRef: cmd.findingOrRuleRef || r.id, ruleId: r.id,
      scopeRef: cmd.scopeRef || null, reason: cmd.reason, risk: cmd.risk, compensatingControls: cmd.compensatingControls || [], requestedBy: actor.id, requestedAt: iso(now),
      approvedBy: null, approvedAt: null, expiresAt: iso(exp), status: 'PENDING_APPROVAL', requiredApprovalPermission: pol.permission, history: audit({}, 'REQUEST', actor, now) });
  }
  /** approveException(exception, actor) → ACTIVE; approver ≠ requester; permission data_quality.approve_exception (or the rule's) */
  function approveException(x, actor, o = {}) {
    const g = guard(actor, x.requiredApprovalPermission || P.APPROVE_EXCEPTION, x); if (g) return g;
    if (x.status !== 'PENDING_APPROVAL') return no(ER.DQ_INVALID_TRANSITION, 'exceção não está aguardando aprovação');
    if (actor.id === x.requestedBy) return no(ER.DQ_PERMISSION_DENIED, 'quem pede não aprova a própria exceção');
    const now = nowOf(o); if (toMs(x.expiresAt) <= now) return no(ER.DQ_EXCEPTION_EXPIRY_REQUIRED, 'exceção já expirada');
    return ok({ ...x, status: 'ACTIVE', approvedBy: actor.id, approvedAt: iso(now), history: audit(x, 'APPROVE', actor, now) }, { audit: { action: 'DQ_EXCEPTION_APPROVE', ref: x.id } });
  }
  function revokeException(x, actor, o = {}) {
    const g = guard(actor, P.APPROVE_EXCEPTION, x); if (g) return g;
    if (!(o.reason && o.reason.length >= 5)) return no(ER.DQ_REASON_REQUIRED, 'revogação exige motivo');
    const now = nowOf(o); return ok({ ...x, status: 'REVOKED', revokedAt: iso(now), revokedReason: o.reason, history: audit(x, 'REVOKE', actor, now) });
  }
  /** exceptionView(x, now) → status derived at read time: an expired exception is never shown as ACTIVE (§469 item 37) */
  const exceptionView = (x, now) => M.freeze({ ...M.clone(x), status: EN.exceptionState(x, toMs(now) ?? Date.now()) });

  // ------------------------------------------------------------------ rules: versioning and rollout (§42, §272–§279, §403–§406)
  const THRESHOLD_KEYS = ['thresholdConfig', 'severity', 'evaluatorRef', 'dimension', 'scope'];
  const bump = v => { const [a, b, c] = String(v || '0.0.0').split('.').map(Number); return `${a}.${b + 1}.0`; };
  /** reviseRule(rule, changes, actor) → NEW version (original untouched); an ACTIVE rule is never edited in place */
  function reviseRule(r, changes, actor, o = {}) {
    const g = guard(actor, P.MANAGE_RULES); if (g) return g;
    if (changes.version && changes.version === r.version && THRESHOLD_KEYS.some(k => k in changes)) return no(ER.DQ_RULE_VERSION_REQUIRED, 'mudança de regra exige nova versão');
    const now = nowOf(o), next = { ...M.clone(r), ...M.clone(changes), version: changes.version && changes.version !== r.version ? changes.version : bump(r.version), status: 'DRAFT',
      enforcementMode: 'SHADOW', previousVersion: r.version, dryRunRef: null, changedBy: actor.id, changedAt: iso(now) };
    delete next._previous;
    return ok(next, { audit: { action: 'DQ_RULE_REVISE', ref: r.id, from: r.version, to: next.version } });
  }
  /** promoteRule(rule, toMode, { dryRun, approvedBy }, policy, actor) → one step at a time; ENFORCED needs a dry-run, an owner on critical domains and,
      when the dry-run would fail records, an explicit approval reference (§447: a rule that would fail 80% stays SHADOW/REVIEW) */
  function promoteRule(r, toMode, o, p, actor) {
    const g = guard(actor, P.MANAGE_RULES); if (g) return g;
    const from = M.MODE_ORDER[r.enforcementMode], to = M.MODE_ORDER[toMode];
    if (to == null || to !== from + 1) return no(ER.DQ_PROMOTION_INVALID, `promoção só um passo por vez (${r.enforcementMode} → ${toMode})`);
    const d = o && o.dryRun;
    if (!d || d.ruleId !== r.id || d.ruleVersion !== r.version) return no(ER.DQ_DRY_RUN_REQUIRED, 'dry-run da mesma versão exigido antes de promover');
    if (toMode === 'ENFORCED') {
      const dom = M.domain(p, r.dataDomainId);
      if (!M.isConfigured(r.ownerRef) && dom && ['HIGH', 'CRITICAL'].includes(dom.criticality)) return no(ER.DQ_OWNER_REQUIRED, 'regra crítica sem owner não pode ser ENFORCED');
      if (d.status === 'CHECK_FAILED') return no(ER.DQ_DRY_RUN_REQUIRED, 'dry-run não executou (UNKNOWN)');
      if (d.wouldFail > 0 && !(o.approvedBy && o.approvedBy !== actor.id)) return no(ER.DQ_PROMOTION_INVALID, `${d.text}: revisão e aprovação de outra pessoa exigidas antes de bloquear produção`, { recommendedMode: d.recommendedMode });
    }
    const now = nowOf(o);
    return ok({ ...M.clone(r), enforcementMode: toMode, status: 'ACTIVE', dryRunRef: d.dryRunRef, promotedBy: actor.id, promotedAt: iso(now), promotionApprovedBy: o.approvedBy || null }, { audit: { action: 'DQ_RULE_PUBLISH', ref: r.id, mode: toMode } });
  }

  // ------------------------------------------------------------------ incidents (§108–§129, §387–§392)
  const INCIDENT_TRANSITIONS = Object.freeze({ OPEN: ['INVESTIGATING'], INVESTIGATING: ['MITIGATING', 'MONITORING', 'RESOLVED'], MITIGATING: ['MONITORING', 'RESOLVED'], MONITORING: ['RESOLVED', 'MITIGATING'], RESOLVED: ['CLOSED', 'INVESTIGATING'], CLOSED: [] });
  /** suggestSeverity({ affectedCapabilities, affectedDomains, liveTransaction }) → SEV suggestion from the versioned policy (a human confirms) */
  function suggestSeverity(o, p) {
    const sev = o.liveTransaction ? 'SEV1' : (o.affectedCapabilities || []).some(c => /RECOMMENDATION|PROPOSAL|RESERVATION|PRICING/.test(c)) ? 'SEV2' : o.workaround ? 'SEV3' : 'SEV4';
    return { severity: sev, policyVersion: p && p.incidentSeverityPolicy ? p.incidentSeverityPolicy.version : null, confirmed: false };
  }
  function createIncident(cmd, actor, o = {}) {
    const g = guard(actor, P.MANAGE_INCIDENT); if (g) return g;
    if (!M.IncidentSeverity[cmd.severity]) return no(ER.DQ_INVALID_ENUM, 'severidade SEV1–SEV4 exigida');
    if (!cmd.title || !(cmd.affectedDomains || []).length) return no(ER.DQ_INVALID_ENUM, 'título e domínios afetados exigidos');
    const now = nowOf(o);
    return ok({ id: cmd.id || 'dqi_' + EN.fingerprint([cmd.title, actor.organizationId, now]), organizationId: actor.organizationId, developmentId: cmd.developmentId || null, title: cmd.title, severity: cmd.severity,
      affectedDomains: cmd.affectedDomains, affectedCapabilities: cmd.affectedCapabilities || [], findingRefs: cmd.findingRefs || [], status: 'OPEN', detectedAt: iso(toMs(cmd.detectedAt) ?? now), startedAt: cmd.startedAt || null,
      resolvedAt: null, ownerRef: cmd.ownerRef || actor.id, impactAssessment: null, rootCause: null, remediationPlan: null, verificationRunRef: null, postmortem: null, customerImpactReview: null,
      history: audit({}, 'DETECTED', actor, now) });
  }
  const assessImpact = (inc, a, actor, o = {}) => { const g = guard(actor, P.MANAGE_INCIDENT, inc); if (g) return g; const now = nowOf(o);
    const ia = { incidentId: inc.id, affectedEntityCount: a.affectedEntityCount ?? 0, affectedLotIds: (a.affectedLotIds || []).slice(0, 500), affectedCustomerDecisionSessions: a.affectedCustomerDecisionSessions || [], affectedProposals: a.affectedProposals || [],
      affectedPresentations: a.affectedPresentations || [], firstBadVersion: a.firstBadVersion || null, lastKnownGoodVersion: a.lastKnownGoodVersion || null, businessImpact: a.businessImpact || [], customerImpact: a.customerImpact || [], internalOnly: true };
    const needsCustomerReview = ia.customerImpact.length > 0 || ia.affectedProposals.length > 0 || ia.affectedPresentations.length > 0;
    return ok({ ...inc, impactAssessment: ia, customerImpactReview: needsCustomerReview ? { status: 'PENDING', handoff: 'negócio/privacidade/suporte (não decidido pela equipe técnica)' } : null, history: audit(inc, 'IMPACT_ASSESSED', actor, now) }); };
  const recordRootCause = (inc, rca, actor, o = {}) => { const g = guard(actor, P.MANAGE_INCIDENT, inc); if (g) return g;
    if (!M.RootCause[rca.rootCauseCategory]) return no(ER.DQ_INVALID_ENUM, 'categoria de causa raiz inválida');
    if (!rca.description) return no(ER.DQ_RCA_REQUIRED, 'descrição da causa raiz exigida');
    return ok({ ...inc, rootCause: { incidentId: inc.id, rootCauseCategory: rca.rootCauseCategory, description: rca.description, contributingFactors: rca.contributingFactors || [], detectionGap: rca.detectionGap || '', preventionActions: rca.preventionActions || [], blameless: true },
      history: audit(inc, 'RCA_RECORDED', actor, nowOf(o)) }); };
  /** createRemediationPlan(ref, actions, verificationPlan) → plan; every action has an owner and a type */
  function createRemediationPlan(cmd, actor, o = {}) {
    const g = guard(actor, P.MANAGE_INCIDENT); if (g) return g;
    if (!(cmd.actions || []).length) return no(ER.DQ_REMEDIATION_INCOMPLETE, 'plano sem ações');
    for (const a of cmd.actions) if (!M.RemediationType[a.actionType] || !a.targetRef || !a.ownerRef) return no(ER.DQ_REMEDIATION_INCOMPLETE, 'ação exige tipo, alvo e owner');
    if (!(cmd.verificationPlan || []).length) return no(ER.DQ_VERIFICATION_REQUIRED, 'remediação sem verificação é incompleta');
    const now = nowOf(o);
    return ok({ id: cmd.id || 'dqp_' + EN.fingerprint([cmd.incidentOrFindingRef, now]), incidentOrFindingRef: cmd.incidentOrFindingRef, organizationId: actor.organizationId,
      actions: cmd.actions.map(a => ({ actionCode: a.actionCode || a.actionType, targetRef: a.targetRef, actionType: a.actionType, ownerRef: a.ownerRef, status: a.status || 'PENDING' })), verificationPlan: cmd.verificationPlan, createdAt: iso(now) });
  }
  const setActionStatus = (plan, idx, status, actor) => { const g = guard(actor, P.MANAGE_INCIDENT, plan); if (g) return g; if (!M.ActionStatus[status] || !plan.actions[idx]) return no(ER.DQ_INVALID_ENUM, 'ação/status inválido');
    return ok({ ...plan, actions: plan.actions.map((a, i) => i === idx ? { ...a, status } : a) }); };
  function transitionIncident(inc, to, actor, o = {}, p) {
    const g = guard(actor, P.MANAGE_INCIDENT, inc); if (g) return g;
    if (!(INCIDENT_TRANSITIONS[inc.status] || []).includes(to)) return no(ER.DQ_INVALID_TRANSITION, `${inc.status} → ${to} não permitido`);
    const now = nowOf(o), material = ((p && p.incidentSeverityPolicy && p.incidentSeverityPolicy.materialSeverities) || ['SEV1', 'SEV2']).includes(inc.severity);
    const pm = ((p && p.incidentSeverityPolicy && p.incidentSeverityPolicy.postmortemSeverities) || ['SEV1', 'SEV2']).includes(inc.severity);
    let next = { ...inc, status: to };
    if (to === 'RESOLVED' || (to === 'CLOSED' && !(inc.status === 'RESOLVED' && inc.verificationRunRef))) { // RESOLVED → CLOSED keeps the verification already recorded
      const plan = o.remediationPlan || inc.remediationPlan, v = o.verificationRun;
      if (!plan || plan.actions.some(a => a.status !== 'DONE')) return no(ER.DQ_REMEDIATION_INCOMPLETE, 'todas as ações do plano precisam estar concluídas');
      const findingRules = new Set(o.verifiedRuleIds || []);
      if (!v || ['ERROR', 'RUNNING'].includes(v.status) || (v.results || []).some(r => findingRules.has(r.ruleId) && r.status !== 'PASSED')) return no(ER.DQ_VERIFICATION_REQUIRED, 'reexecute as regras: a verificação precisa passar (erro de execução = UNKNOWN, nunca passa)');
      if (material && !inc.rootCause) return no(ER.DQ_RCA_REQUIRED, 'incidente material exige causa raiz');
      if (material && !(inc.rootCause.preventionActions || []).length) return no(ER.DQ_PREVENTION_REQUIRED, 'incidente material exige ação de prevenção');
      next = { ...next, remediationPlan: plan, verificationRunRef: v.id, resolvedAt: inc.resolvedAt || iso(now) };
    }
    if (to === 'CLOSED') {
      if (pm && !(o.postmortem || inc.postmortem)) return no(ER.DQ_POSTMORTEM_REQUIRED, 'SEV1/SEV2 exigem postmortem');
      if (inc.customerImpactReview && inc.customerImpactReview.status === 'PENDING') return no(ER.DQ_INVALID_TRANSITION, 'revisão de impacto no cliente pendente (negócio/privacidade)');
      next.postmortem = o.postmortem || inc.postmortem || null;
    }
    return ok({ ...next, history: audit(inc, to, actor, now) }, to === 'CLOSED' ? { audit: { action: 'DQ_INCIDENT_CLOSE', ref: inc.id } } : {});
  }
  const postmortem = (inc, pm) => ({ incidentId: inc.id, whatHappened: pm.whatHappened, impact: pm.impact, rootCause: inc.rootCause ? inc.rootCause.description : null, whyDetectionFailed: pm.whyDetectionFailed,
    whatFixed: pm.whatFixed, prevention: pm.prevention || (inc.rootCause ? inc.rootCause.preventionActions : []), blameless: true });

  // ------------------------------------------------------------------ change governance (§161–§174, §265–§270)
  const CHANGE_TRANSITIONS = Object.freeze({ DRAFT: ['REVIEW'], REVIEW: ['APPROVED', 'REJECTED'], APPROVED: ['IMPLEMENTED'], REJECTED: [], IMPLEMENTED: [] });
  const OWNER_APPROVAL_TYPES = ['IDENTITY', 'UNIT', 'SEMANTICS', 'SOURCE', 'ENUM'];
  function transitionChange(cr, to, actor, o = {}, p) {
    const g = guard(actor, P.MANAGE_CONTRACT, cr); if (g) return g;
    if (!(CHANGE_TRANSITIONS[cr.status] || []).includes(to)) return no(ER.DQ_INVALID_TRANSITION, `${cr.status} → ${to} não permitido`);
    if (to === 'REVIEW' && !cr.impactAssessmentRef) return no(ER.DQ_IMPACT_ASSESSMENT_REQUIRED, 'mudança estrutural/semântica exige avaliação de impacto');
    if (to === 'APPROVED') {
      if (actor.id === cr.proposedBy) return no(ER.DQ_PERMISSION_DENIED, 'quem propõe não aprova');
      if (OWNER_APPROVAL_TYPES.includes(cr.changeType)) { const own = p && M.ownershipMatrix(p).find(x => x.dataDomainId === cr.dataDomainId);
        if (!own || !own.owner) return no(ER.DQ_OWNER_REQUIRED, 'mudança de alto impacto exige aprovação do owner do domínio (owner não atribuído)');
        if (own.owner !== actor.id) return no(ER.DQ_PERMISSION_DENIED, 'aprovação do owner do domínio exigida'); }
    }
    return ok({ ...cr, status: to, history: audit(cr, to, actor, nowOf(o)) });
  }
  const createChangeRequest = (cmd, actor, o = {}) => { const g = guard(actor, P.MANAGE_CONTRACT); if (g) return g; if (!M.ChangeType[cmd.changeType]) return no(ER.DQ_INVALID_ENUM, 'tipo de mudança inválido');
    return ok({ id: cmd.id || 'dqc_' + EN.fingerprint([cmd.dataDomainId, cmd.changeType, cmd.description, nowOf(o)]), organizationId: actor.organizationId, dataDomainId: cmd.dataDomainId, changeType: cmd.changeType, description: cmd.description,
      impactAssessmentRef: cmd.impactAssessmentRef || null, proposedBy: actor.id, status: 'DRAFT', history: audit({}, 'DRAFT', actor, nowOf(o)) }); };
  /** sourceAuthorityChange(request, to, { cutoverReport }, actor) → APPROVED only with a MATCH cutover report (§267–§270, §450) */
  function transitionSourceAuthorityChange(req, to, actor, o = {}) {
    const g = guard(actor, P.MANAGE_CONTRACT, req); if (g) return g;
    const T = { DRAFT: ['REVIEW'], REVIEW: ['APPROVED'], APPROVED: ['IMPLEMENTED'], IMPLEMENTED: [] };
    if (!(T[req.status] || []).includes(to)) return no(ER.DQ_INVALID_TRANSITION, `${req.status} → ${to} não permitido`);
    if (to === 'REVIEW' && (!req.impactAssessmentRef || !req.migrationPlanRef)) return no(ER.DQ_IMPACT_ASSESSMENT_REQUIRED, 'impacto e plano de migração exigidos');
    if (to === 'APPROVED') { const rep = o.cutoverReport;
      if (!rep || rep.dataDomainId !== req.dataDomainId) return no(ER.DQ_RECONCILIATION_REQUIRED, 'troca de fonte de autoridade exige reconciliação antiga × nova');
      if (rep.decision !== 'PASS') return no(ER.DQ_RECONCILIATION_REQUIRED, rep.message, { cutoverReport: rep }); }
    return ok({ ...req, status: to, cutoverReportRef: o.cutoverReport ? o.cutoverReport.reconciliationRunId : req.cutoverReportRef || null, history: audit(req, to, actor, nowOf(o)) }, to === 'APPROVED' ? { audit: { action: 'DQ_SOURCE_AUTHORITY_CHANGE', ref: req.dataDomainId } } : {});
  }

  // ------------------------------------------------------------------ data contracts (§78–§86, §171–§174)
  const major = v => Number(String(v || '0').split('.')[0]);
  /** contractCompatibility(contract, candidateFields) → { breaking, changes[], impactedConsumers, requiredVersion } */
  function contractCompatibility(c, nextFields, nextVersion) {
    const cur = new Map(c.fields.map(f => [f.fieldKey, f])), nxt = new Map(nextFields.map(f => [f.fieldKey, f])), changes = [];
    for (const [k, f] of cur) { const n = nxt.get(k);
      if (!n) { changes.push({ kind: 'FIELD_REMOVED', fieldKey: k, breaking: true }); continue; }
      if (n.type !== f.type) changes.push({ kind: 'TYPE_CHANGED', fieldKey: k, breaking: true, detail: `${f.type} → ${n.type}` });
      if ((n.unit || null) !== (f.unit || null)) changes.push({ kind: 'UNIT_CHANGED', fieldKey: k, breaking: true, detail: `${f.unit || '—'} → ${n.unit || '—'}` });
      if (!f.nullable && n.nullable) changes.push({ kind: 'NULLABILITY_CHANGED', fieldKey: k, breaking: true });
      if (f.allowedValues && n.allowedValues) { const add = n.allowedValues.filter(v => !f.allowedValues.includes(v)), rem = f.allowedValues.filter(v => !n.allowedValues.includes(v));
        if (rem.length) changes.push({ kind: 'ENUM_VALUE_REMOVED', fieldKey: k, breaking: true, detail: rem.join(', ') });
        if (add.length) changes.push({ kind: 'ENUM_VALUE_ADDED', fieldKey: k, breaking: c.compatibilityPolicy === 'FULL' || c.compatibilityPolicy === 'FORWARD', reviewRequired: true, detail: add.join(', ') }); } }
    for (const [k, n] of nxt) if (!cur.has(k)) changes.push({ kind: 'FIELD_ADDED', fieldKey: k, breaking: !n.nullable && ['FORWARD', 'FULL'].includes(c.compatibilityPolicy) });
    const breaking = changes.some(x => x.breaking);
    const versionOk = !breaking || (nextVersion && major(nextVersion) > major(c.schemaVersion));
    return { contractId: c.id, fromVersion: c.schemaVersion, toVersion: nextVersion || null, breaking, changes, impactedConsumers: breaking || changes.some(x => x.reviewRequired) ? c.consumerRefs.slice() : [],
      migrationRequired: breaking, decision: !versionOk ? 'BLOCK' : breaking || changes.some(x => x.reviewRequired) ? 'REVIEW' : 'PASS',
      code: versionOk ? null : ER.DQ_BREAKING_CHANGE_NEEDS_MAJOR };
  }

  // ------------------------------------------------------------------ certification (§87–§94, §232–§235)
  /** certify(scope, { run, findings, limitations, expiresAt, level }, policy, actor) → DataCertification */
  function certify(cmd, p, actor, o = {}) {
    const g = guard(actor, P.CERTIFY); if (g) return g;
    const run = cmd.run, now = nowOf(o);
    if (!run || run.status === 'ERROR' || run.status === 'RUNNING') return no(ER.DQ_VERIFICATION_REQUIRED, 'certificação exige execução concluída das regras (erro = UNKNOWN)');
    const open = (cmd.findings || run.findings || []).filter(f => !['RESOLVED', 'ACCEPTED_EXCEPTION', 'FALSE_POSITIVE'].includes(f.status) && f.severity === 'BLOCKING' && f.effectiveMode === 'ENFORCED');
    if (open.length) return no(ER.DQ_OPEN_BLOCKING_FINDINGS, `${open.length} finding(s) bloqueante(s) aberto(s)`);
    const dom = M.domain(p, cmd.dataDomainId);
    if (dom && dom.dynamic && dom.freshnessMode === 'CLOCK') return no(ER.DQ_CERTIFICATION_EXPIRY_REQUIRED, 'dado dinâmico usa frescor/currentness, não certificação');
    const exp = cmd.expiresAt != null ? toMs(cmd.expiresAt) : null;
    if (exp != null && exp <= now) return no(ER.DQ_CERTIFICATION_EXPIRY_REQUIRED, 'validade no passado');
    const lim = cmd.limitations || [], warned = (run.results || []).some(r => r.status === 'FAILED' && r.effectiveMode !== 'SHADOW' && r.severity !== 'INFO');
    const level = lim.length || warned ? 'CERTIFIED_WITH_LIMITATIONS' : 'CERTIFIED';
    return ok({ id: 'dqcert_' + EN.fingerprint([cmd.scopeRef, run.id, now]), organizationId: actor.organizationId, scopeRef: cmd.scopeRef, scopeVersion: cmd.scopeVersion || null, certificationLevel: level, ruleSetVersion: (run.ruleSetVersions || []).join(','),
      sourceAuthorityRef: (dom && dom.sourceOfTruthRef) || null, qualitySnapshotRef: run.id, limitations: lim, certifiedBy: actor.id, certifiedAt: iso(now), expiresAt: exp != null ? iso(exp) : null,
      expiryStatus: exp != null ? 'SET' : M.NC, status: 'ACTIVE' }, { audit: { action: 'DQ_CERTIFICATION', ref: cmd.scopeRef } });
  }
  /** certificationView(cert, { now, currentScopeVersion }) → EXPIRED after expiresAt or when a newer version of the scope is published (§233–§235) */
  function certificationView(c, o = {}) {
    const now = toMs(o.now) ?? Date.now();
    let status = c.status;
    if (status === 'ACTIVE' && c.expiresAt && toMs(c.expiresAt) <= now) status = 'EXPIRED';
    if (status === 'ACTIVE' && o.currentScopeVersion && c.scopeVersion && o.currentScopeVersion !== c.scopeVersion) status = 'EXPIRED';
    return M.freeze({ ...M.clone(c), status, invalidatedBy: status === 'EXPIRED' && o.currentScopeVersion && c.scopeVersion !== o.currentScopeVersion ? o.currentScopeVersion : null });
  }

  return { FINDING_TRANSITIONS, INCIDENT_TRANSITIONS, CHANGE_TRANSITIONS, transitionFinding, acknowledge, startRemediation, resolveFinding, markFalsePositive, refreshFinding,
    requestException, approveException, revokeException, exceptionView, reviseRule, promoteRule, suggestSeverity, createIncident, assessImpact, recordRootCause,
    createRemediationPlan, setActionStatus, transitionIncident, postmortem, createChangeRequest, transitionChange, transitionSourceAuthorityChange, contractCompatibility, certify, certificationView };
})();
