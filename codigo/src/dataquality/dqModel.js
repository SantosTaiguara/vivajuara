/* dataquality/dqModel.js — topic 61: data quality & operational governance, model layer (App.dataQuality.model).
   Vocabulary (closed enums), the effective policy (PLATFORM ← ORGANIZATION ← DEVELOPMENT, plat/config/dataquality/*.json),
   its validation, the DataDomainRegistry, ownership/stewardship/RACI resolution, the semantic catalog generated from the
   Field Registry (App.model.FIELDS, so the catalog never goes stale), the business glossary and known limitations.

   Rules held here (spec §42, §59, §67, §132, §279, §395, §484):
   - nothing invented: owner, steward, SLO target, exception duration, freshness threshold, tolerance = null means
     "necessita confirmação" / "não configurado", and every consumer refuses or degrades on null;
   - an ENFORCED rule of a HIGH/CRITICAL domain needs an owner; without one it runs as WARNING (RULE_UNOWNED);
     'SYSTEM:platform-invariant' marks structural invariants the code already enforces (it is not a human owner);
   - a more specific scope may ADD rules, never weaken a platform-mandatory one (severity/mode/status);
   - reconciliation of LOT_IDENTITY / GEOMETRY is automaticCorrection NEVER (config refused otherwise);
   - rule dependencies form a DAG (cycles refused).
   Pure: no DOM, no storage, no network. Records are plain frozen JSON. */
var App = (typeof App !== 'undefined' && App) || (typeof globalThis !== 'undefined' && globalThis.App) || {};
App.dataQuality = App.dataQuality || {};
App.dataQuality.model = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const Dimension = E('COMPLETENESS', 'VALIDITY', 'UNIQUENESS', 'CONSISTENCY', 'REFERENTIAL_INTEGRITY', 'FRESHNESS', 'TIMELINESS', 'PROVENANCE_COVERAGE',
    'VERSION_COMPATIBILITY', 'DOMAIN_COHERENCE', 'GEOMETRY_INTEGRITY', 'AUTHORITY_AGREEMENT');
  const Severity = E('INFO', 'WARNING', 'ERROR', 'BLOCKING');
  const SEVERITY_ORDER = Object.freeze({ INFO: 0, WARNING: 1, ERROR: 2, BLOCKING: 3 });
  const RuleScope = E('FIELD', 'ENTITY', 'DATASET', 'RELATIONSHIP', 'PUBLICATION', 'STREAM');
  const ExecutionMode = E('ON_WRITE', 'ON_PUBLISH', 'SCHEDULED', 'EVENT_DRIVEN', 'ON_DEMAND');
  const RuleStatus = E('DRAFT', 'ACTIVE', 'RETIRED');
  const EnforcementMode = E('SHADOW', 'WARNING', 'ENFORCED');
  const MODE_ORDER = Object.freeze({ SHADOW: 0, WARNING: 1, ENFORCED: 2 });
  const Criticality = E('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  const Trigger = E('WRITE', 'PUBLISH', 'SCHEDULE', 'EVENT', 'MANUAL');
  const RunStatus = E('RUNNING', 'PASSED', 'PASSED_WITH_WARNINGS', 'FAILED', 'ERROR');
  const ResultStatus = E('PASSED', 'FAILED', 'CHECK_FAILED', 'NOT_EVALUATED', 'SKIPPED');
  const FindingStatus = E('OPEN', 'ACKNOWLEDGED', 'IN_REMEDIATION', 'RESOLVED', 'ACCEPTED_EXCEPTION', 'FALSE_POSITIVE');
  const HealthStatus = E('HEALTHY', 'DEGRADED', 'CRITICAL', 'UNKNOWN');
  const FreshnessStatus = E('FRESH', 'STALE_FOR_DISPLAY', 'STALE_FOR_DECISION', 'STALE_FOR_TRANSACTION', 'UNKNOWN');
  const Use = E('DISPLAY', 'DECISION', 'TRANSACTION');
  const GateDecision = E('PASS', 'BLOCK', 'REVIEW');
  const IncidentSeverity = E('SEV4', 'SEV3', 'SEV2', 'SEV1');
  const IncidentStatus = E('OPEN', 'INVESTIGATING', 'MITIGATING', 'MONITORING', 'RESOLVED', 'CLOSED');
  const RootCause = E('SOURCE_ERROR', 'MAPPING_ERROR', 'TRANSFORM_ERROR', 'PIPELINE_BUG', 'MANUAL_OVERRIDE', 'EXTERNAL_SYNC', 'SCHEMA_CHANGE', 'POLICY_ERROR', 'UNKNOWN');
  const RemediationType = E('SOURCE_FIX', 'REIMPORT', 'DATA_REPAIR', 'ROLLBACK', 'RECOMPUTE', 'CONFIG_CHANGE', 'POLICY_CHANGE');
  const ActionStatus = E('PENDING', 'IN_PROGRESS', 'DONE', 'FAILED');
  const ExceptionStatus = E('ACTIVE', 'EXPIRED', 'REVOKED', 'PENDING_APPROVAL');
  const ExceptionRisk = E('LOW', 'MEDIUM', 'HIGH');
  const CertificationLevel = E('UNVERIFIED', 'VALIDATED', 'CERTIFIED', 'CERTIFIED_WITH_LIMITATIONS');
  const CertificationStatus = E('ACTIVE', 'EXPIRED', 'REVOKED');
  const AutoCorrection = E('NEVER', 'SAFE_ONLY', 'ALLOWED');
  const ReconciliationStatus = E('MATCH', 'DIFFERENCES', 'FAILED');
  const ChangeType = E('SCHEMA', 'SEMANTICS', 'SOURCE', 'RULE', 'MAPPING', 'UNIT', 'ENUM', 'IDENTITY');
  const ChangeStatus = E('DRAFT', 'REVIEW', 'APPROVED', 'REJECTED', 'IMPLEMENTED');
  const ContractStatus = E('DRAFT', 'ACTIVE', 'DEPRECATED', 'RETIRED');
  const Compatibility = E('BACKWARD', 'FORWARD', 'FULL', 'NONE');
  const ResolutionType = E('DATA_FIXED', 'SOURCE_FIXED', 'RULE_FIXED', 'FALSE_POSITIVE', 'EXCEPTION_APPROVED');
  const PolicyScope = E('PLATFORM', 'ORGANIZATION', 'DEVELOPMENT');
  const RACI_ACTIVITIES = Object.freeze(['RULE_CHANGE', 'SOURCE_CHANGE', 'PUBLICATION', 'QUALITY_EXCEPTION', 'INCIDENT_RESPONSE', 'RECONCILIATION', 'DATA_REPAIR', 'CERTIFICATION']);
  const NEVER_AUTOCORRECT_DOMAINS = Object.freeze(['LOT_IDENTITY', 'GEOMETRY']);
  const SYSTEM_OWNER = 'SYSTEM:platform-invariant';
  const NC = 'NECESSITA_CONFIRMACAO';
  const PERMISSIONS = Object.freeze({ READ: 'data_quality.read', MANAGE_FINDINGS: 'data_quality.manage_findings', RUN_CHECKS: 'data_quality.run_checks', MANAGE_RULES: 'data_quality.manage_rules',
    CREATE_EXCEPTION: 'data_quality.create_exception', APPROVE_EXCEPTION: 'data_quality.approve_exception', MANAGE_INCIDENT: 'data_quality.manage_incident',
    MANAGE_OWNER: 'data_governance.manage_owner', MANAGE_CONTRACT: 'data_governance.manage_contract', CERTIFY: 'data_governance.certify' });
  const ERRORS = E('DQ_CONFIG_MISSING', 'DQ_UNKNOWN_EVALUATOR', 'DQ_DUPLICATE_RULE', 'DQ_RULE_DEPENDENCY_CYCLE', 'DQ_RULE_DEPENDENCY_UNKNOWN', 'DQ_PLATFORM_RULE_WEAKENED',
    'DQ_AUTOCORRECT_FORBIDDEN', 'DQ_INVALID_ENUM', 'DQ_RULESET_UNKNOWN_RULE', 'DQ_GATE_UNKNOWN_RULE', 'DQ_EXCEPTION_POLICY_WITHOUT_LIMIT', 'DQ_TENANT_MISMATCH',
    'DQ_RULE_VERSION_REQUIRED', 'DQ_RULE_NOT_ACTIVE', 'DQ_PROMOTION_INVALID', 'DQ_DRY_RUN_REQUIRED', 'DQ_OWNER_REQUIRED', 'DQ_PERMISSION_DENIED', 'DQ_REASON_REQUIRED',
    'DQ_INVALID_TRANSITION', 'DQ_EXCEPTION_NOT_ALLOWED', 'DQ_EXCEPTION_EXPIRY_REQUIRED', 'DQ_EXCEPTION_TOO_LONG', 'DQ_POLICY_NOT_CONFIGURED', 'DQ_EVIDENCE_REQUIRED',
    'DQ_VERIFICATION_REQUIRED', 'DQ_RCA_REQUIRED', 'DQ_REMEDIATION_INCOMPLETE', 'DQ_PREVENTION_REQUIRED', 'DQ_POSTMORTEM_REQUIRED', 'DQ_OPEN_BLOCKING_FINDINGS',
    'DQ_CERTIFICATION_EXPIRY_REQUIRED', 'DQ_IMPACT_ASSESSMENT_REQUIRED', 'DQ_BREAKING_CHANGE_NEEDS_MAJOR', 'DQ_RECONCILIATION_REQUIRED', 'DQ_NOT_FOUND', 'DQ_SOURCE_AUTHORITY_UNDEFINED');

  const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
  const isConfigured = v => v !== null && v !== undefined && v !== '';

  // ------------------------------------------------------------------ configuration (bundled App.configs.dataquality, or injected)
  let injected = null;
  /** setConfig({ platform, org_house7, 'viva-juara', … }) — tests / backend inject the JSON of plat/config/dataquality */
  const setConfig = cfg => { injected = cfg || null; cache.clear(); };
  const rawConfig = () => injected || (App.configs && App.configs.dataquality) || null;
  const orgOf = developmentId => {
    const T = App.tenancy;
    if (T && T.organizationOfDevelopment) { try { const o = T.organizationOfDevelopment(developmentId); if (o) return T.canonicalOrgId ? T.canonicalOrgId(o) : o; } catch (e) { /* unknown dev */ } }
    return null;
  };
  const cache = new Map();
  /** policy(developmentId) → effective, validated, frozen policy (PLATFORM ← ORGANIZATION ← DEVELOPMENT) */
  function policy(developmentId = 'viva-juara') {
    if (cache.has(developmentId)) return cache.get(developmentId);
    const cfg = rawConfig();
    if (!cfg || !cfg.platform) { const e = new Error('configuração de qualidade de dados ausente (config/dataquality)'); e.code = ERRORS.DQ_CONFIG_MISSING; throw e; }
    const dev = cfg[developmentId] || null;
    const organizationId = (dev && dev.organizationId) || orgOf(developmentId);
    const org = organizationId ? (cfg[organizationId] || Object.values(cfg).find(c => c && c.scope === 'ORGANIZATION' && c.organizationId === organizationId) || null) : null;
    const p = merge(cfg.platform, org, dev, developmentId, organizationId);
    const v = validatePolicy(p);
    p.validation = v;
    freeze(p); cache.set(developmentId, p); return p;
  }
  function merge(platform, org, dev, developmentId, organizationId) {
    const rules = new Map();
    for (const [scope, layer] of [['PLATFORM', platform], ['ORGANIZATION', org], ['DEVELOPMENT', dev]]) {
      for (const r of (layer && layer.rules) || []) {
        const prev = rules.get(r.id);
        rules.set(r.id, { ...clone(r), policyScope: scope, overrides: prev ? prev.policyScope : null, _previous: prev ? clone(prev) : null });
      }
    }
    const list = (k, ...layers) => layers.flatMap(l => (l && l[k]) || []).map(clone);
    return {
      developmentId, organizationId,
      policyVersions: { PLATFORM: platform.policyVersion, ORGANIZATION: org ? org.policyVersion : null, DEVELOPMENT: dev ? dev.policyVersion : null },
      evidence: clone(platform.evidence || { maxSampleRefs: 10 }),
      domains: clone(platform.domains || []),
      rules: [...rules.values()],
      ruleSets: list('ruleSets', platform, org, dev),
      gates: list('gates', platform, org, dev),
      glossary: list('glossary', platform, org, dev),
      incidentSeverityPolicy: clone(platform.incidentSeverityPolicy || null), recommendationReadinessPolicy: clone(platform.recommendationReadinessPolicy || null),
      ownership: list('ownership', org), raci: list('raci', org), exceptionPolicies: list('exceptionPolicies', org, dev), slos: list('slos', org, dev),
      alertPolicies: list('alertPolicies', org), certificationPolicy: clone((org && org.certificationPolicy) || null),
      volumeExpectations: list('volumeExpectations', dev), freshnessPolicies: list('freshnessPolicies', dev), reconciliationPolicies: list('reconciliationPolicies', dev),
      contracts: list('contracts', dev), knownLimitations: list('knownLimitations', dev), dataDebt: list('dataDebt', dev),
      baselines: clone((dev && dev.baselines) || null)
    };
  }
  /** evaluator ids known to the engine (registered by dqEngine.js); unknown → config error */
  const evaluatorIds = () => (App.dataQuality.evaluators && App.dataQuality.evaluators.ids()) || null;
  function validatePolicy(p) {
    const errors = [], warnings = [], err = (code, ref, message) => errors.push({ code, ref, message }), warn = (code, ref, message) => warnings.push({ code, ref, message });
    const ids = new Set(), evs = evaluatorIds();
    const enumOk = (val, en) => Object.prototype.hasOwnProperty.call(en, val);
    for (const r of p.rules) {
      if (ids.has(r.id)) err(ERRORS.DQ_DUPLICATE_RULE, r.id, 'regra duplicada'); ids.add(r.id);
      for (const [k, en] of [['dimension', Dimension], ['severity', Severity], ['scope', RuleScope], ['executionMode', ExecutionMode], ['status', RuleStatus], ['enforcementMode', EnforcementMode]])
        if (!enumOk(r[k], en)) err(ERRORS.DQ_INVALID_ENUM, r.id, `${k} inválido: ${r[k]}`);
      if (evs && !evs.includes(r.evaluatorRef)) err(ERRORS.DQ_UNKNOWN_EVALUATOR, r.id, `avaliador desconhecido: ${r.evaluatorRef}`);
      if (!r.version) err(ERRORS.DQ_RULE_VERSION_REQUIRED, r.id, 'regra sem versão');
      const prev = r._previous;
      if (prev && prev.platformMandatory) {
        if (SEVERITY_ORDER[r.severity] < SEVERITY_ORDER[prev.severity] || MODE_ORDER[r.enforcementMode] < MODE_ORDER[prev.enforcementMode] || r.status !== 'ACTIVE' || !r.platformMandatory)
          err(ERRORS.DQ_PLATFORM_RULE_WEAKENED, r.id, `escopo ${r.policyScope} não pode enfraquecer regra obrigatória da plataforma`);
      }
      const dom = p.domains.find(d => d.id === r.dataDomainId);
      if (!dom) err(ERRORS.DQ_INVALID_ENUM, r.id, `domínio desconhecido: ${r.dataDomainId}`);
      if (r.enforcementMode === 'ENFORCED' && !isConfigured(r.ownerRef) && dom && ['HIGH', 'CRITICAL'].includes(dom.criticality))
        warn('RULE_UNOWNED', r.id, 'regra ENFORCED de domínio crítico sem owner: executa como WARNING até haver owner');
    }
    for (const r of p.rules) for (const d of r.dependsOn || []) if (!ids.has(d)) err(ERRORS.DQ_RULE_DEPENDENCY_UNKNOWN, r.id, `dependência desconhecida: ${d}`);
    // DAG
    const state = new Map(), byId = new Map(p.rules.map(r => [r.id, r]));
    const visit = (id, stack) => { if (state.get(id) === 2) return; if (state.get(id) === 1) { err(ERRORS.DQ_RULE_DEPENDENCY_CYCLE, id, `ciclo: ${[...stack, id].join(' → ')}`); return; }
      state.set(id, 1); for (const d of ((byId.get(id) || {}).dependsOn || [])) if (byId.has(d)) visit(d, [...stack, id]); state.set(id, 2); };
    for (const r of p.rules) visit(r.id, []);
    for (const s of p.ruleSets) for (const id of s.ruleIds) if (!ids.has(id)) err(ERRORS.DQ_RULESET_UNKNOWN_RULE, s.id, `regra desconhecida: ${id}`);
    for (const g of p.gates) for (const id of [...g.requiredRuleRefs, ...(g.optionalRuleRefs || [])]) if (!ids.has(id)) err(ERRORS.DQ_GATE_UNKNOWN_RULE, g.id, `regra desconhecida: ${id}`);
    for (const rp of p.reconciliationPolicies) {
      if (!enumOk(rp.automaticCorrection, AutoCorrection)) err(ERRORS.DQ_INVALID_ENUM, rp.id, 'automaticCorrection inválido');
      if (NEVER_AUTOCORRECT_DOMAINS.includes(rp.dataDomainId) && !rp.derivedArtifact && rp.automaticCorrection !== 'NEVER')
        err(ERRORS.DQ_AUTOCORRECT_FORBIDDEN, rp.id, 'identidade/geometria nunca têm correção automática');
      if (rp.automaticCorrection === 'ALLOWED') warn('AUTOCORRECT_ALLOWED', rp.id, 'correção automática liberada exige revisão');
    }
    for (const ep of p.exceptionPolicies) if (ep.exceptionAllowed && !isConfigured(ep.maxDuration)) err(ERRORS.DQ_EXCEPTION_POLICY_WITHOUT_LIMIT, ep.ruleId, 'exceção permitida sem duração máxima');
    for (const d of p.domains) if (!isConfigured(d.sourceOfTruthRef) && d.active) warn('SOURCE_AUTHORITY_UNDEFINED', d.id, 'domínio ativo sem fonte de autoridade: confiança UNKNOWN');
    for (const o of ownershipMatrix(p)) if (o.active && ['HIGH', 'CRITICAL'].includes(o.criticality) && !o.owner) warn('OWNER_UNASSIGNED', o.dataDomainId, 'domínio crítico sem owner (necessita confirmação)');
    return freeze({ ok: errors.length === 0, errors, warnings });
  }

  // ------------------------------------------------------------------ registries
  const domain = (p, id) => p.domains.find(d => d.id === id) || null;
  const rule = (p, id) => p.rules.find(r => r.id === id) || null;
  /** effectiveMode(rule, policy) → { mode, reason } — unowned ENFORCED rule of a HIGH/CRITICAL domain runs as WARNING */
  function effectiveMode(r, p) {
    if (r.status !== 'ACTIVE') return { mode: 'SHADOW', reason: 'RULE_NOT_ACTIVE' };
    const dom = domain(p, r.dataDomainId);
    if (r.enforcementMode === 'ENFORCED' && !isConfigured(r.ownerRef) && dom && ['HIGH', 'CRITICAL'].includes(dom.criticality)) return { mode: 'WARNING', reason: 'RULE_UNOWNED' };
    return { mode: r.enforcementMode, reason: null };
  }
  /** ownershipMatrix(policy) → one row per domain; unassigned = NECESSITA_CONFIRMACAO (never a guessed person) */
  function ownershipMatrix(p) {
    return p.domains.map(d => {
      const o = p.ownership.find(x => x.dataDomainId === d.id) || {};
      return { dataDomainId: d.id, name: d.name, criticality: d.criticality, active: d.active, sourceOfTruthRef: d.sourceOfTruthRef || null,
        sourceAuthorityStatus: d.sourceOfTruthRef ? 'DECLARED' : NC,
        owner: o.owner || null, ownerStatus: o.owner ? 'ASSIGNED' : NC, steward: o.steward || null, stewardStatus: o.steward ? 'ASSIGNED' : NC,
        technicalOwner: o.technicalOwner || null, technicalOwnerStatus: o.technicalOwner ? 'ASSIGNED' : NC,
        rules: p.rules.filter(r => r.dataDomainId === d.id).map(r => r.id) };
    });
  }
  /** raciMatrix(policy) → rows for critical domains × activities; unfilled = NECESSITA_CONFIRMACAO */
  const raciMatrix = p => p.raci.map(r => ({ ...r, status: r.accountableRef ? 'DEFINED' : NC }));
  /** semanticCatalog() → DataSemanticDefinition per Field Registry field (generated, never hand-copied) */
  function semanticCatalog(p) {
    const F = (App.model && App.model.FIELDS) || [];
    const domOf = f => ({ IDENTITY: 'LOT_IDENTITY', GEOMETRY: 'GEOMETRY', COMMERCIAL: 'PRICING', AVAILABILITY: 'AVAILABILITY', INTELLIGENCE: 'ANALYSIS' })[f.domain] || 'DEVELOPMENT';
    return (Array.isArray(F) ? F : Object.values(F)).map(f => ({
      fieldKey: f.key, label: f.label, businessDefinition: f.meaning || null, dataType: f.type, unit: f.unit || null,
      nullMeaning: f.nullable ? (f.key.startsWith('availability.') ? 'null/UNKNOWN = sem informação da fonte; nunca disponível' : 'null = não disponível / não informado; nunca 0') : 'nunca nulo',
      allowedValues: f.enum || null, sourceAuthorityRef: f.sourceId || null, ownerRef: null, ownerStatus: NC, version: (App.model.SCHEMA_VERSION || '1.0'),
      priority: f.priority, dataDomainId: domOf(f), dynamicType: f.dynamicType, provenanceRequired: !!f.provenanceRequired,
      unitDeclared: f.type !== 'number' || !!f.unit
    }));
  }
  /** criticalFields() → P0 fields of the catalog */
  const criticalFields = p => semanticCatalog(p).filter(f => f.priority === 'P0');
  const glossary = p => p.glossary.map(g => ({ ...g, reviewStatus: 'PROPOSTO — revisão humana' }));
  const knownLimitations = p => p.knownLimitations.filter(k => k.status === 'ACTIVE');
  /** clientSafeLimitations(policy) → only the client-safe sentence (no governance jargon, §231/§304) */
  const clientSafeLimitations = p => knownLimitations(p).filter(k => k.clientSafeMessage).map(k => ({ id: k.id, text: k.clientSafeMessage }));
  /** sourceAuthorityMatrix(policy) → domain → declared authority (from config/developments.js sources) */
  function sourceAuthorityMatrix(p) {
    const D = App.config && App.config.DEVELOPMENTS, d = D ? (Array.isArray(D) ? D.find(x => x.id === p.developmentId) : D[p.developmentId]) : null;
    const sources = (d && d.sources) || [];
    return p.domains.map(d => { const s = sources.find(x => x.id === d.sourceOfTruthRef) || null;
      return { dataDomainId: d.id, authoritativeSourceRef: d.sourceOfTruthRef || null, sourceName: s ? s.name : null, sourceType: s ? s.type : null, sourceDate: s ? s.date : null,
        status: d.sourceOfTruthRef ? 'DECLARED' : NC, trust: d.sourceOfTruthRef ? 'DECLARED_AUTHORITY' : 'UNKNOWN' }; });
  }

  return {
    Dimension, Severity, SEVERITY_ORDER, RuleScope, ExecutionMode, RuleStatus, EnforcementMode, MODE_ORDER, Criticality, Trigger, RunStatus, ResultStatus, FindingStatus,
    HealthStatus, FreshnessStatus, Use, GateDecision, IncidentSeverity, IncidentStatus, RootCause, RemediationType, ActionStatus, ExceptionStatus, ExceptionRisk,
    CertificationLevel, CertificationStatus, AutoCorrection, ReconciliationStatus, ChangeType, ChangeStatus, ContractStatus, Compatibility, ResolutionType, PolicyScope,
    RACI_ACTIVITIES, NEVER_AUTOCORRECT_DOMAINS, SYSTEM_OWNER, NC, PERMISSIONS, ERRORS,
    setConfig, rawConfig, policy, validatePolicy, effectiveMode, domain, rule, ownershipMatrix, raciMatrix, semanticCatalog, criticalFields, glossary,
    knownLimitations, clientSafeLimitations, sourceAuthorityMatrix, isConfigured, clone, freeze
  };
})();
