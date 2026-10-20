/* governance/capabilityRegistry.js — topic 54: CapabilityPreservationRegistry.
   The registry (plat/config/governance/capabilities.json) lists the current strengths of the product with priority
   (P0–P3), preservation level, current/target location, golden tests, metrics, allowed changes and forbidden
   regressions. This module validates it and answers the questions of a migration review:
     - which capabilities does a change touch (by file)?  touchedBy(registry, files)
     - may this capability be cut over?                   cutoverGate(registry, capabilityId, evidence)
     - which differences are approved?                    exceptionsFor(registry, capabilityId)
   Pure: no DOM, no storage, no network. The Node test passes the JSON and the list of golden categories/test files. */
var App = (typeof App !== 'undefined' && App) || (typeof globalThis !== 'undefined' && globalThis.App) || {};
App.governance = App.governance || {};
App.governance.capabilities = (() => {
  const PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);
  const LEVELS = Object.freeze(['EXACT_PARITY', 'SEMANTIC_PARITY', 'UX_CONTINUITY', 'PERFORMANCE_PARITY', 'DATA_PARITY', 'IMPROVE_ONLY']);
  const CATEGORIES = Object.freeze(['MAP', 'SEARCH', 'FILTER', 'LAYER', 'LOT_CONTEXT', 'COMPARISON', 'RECOMMENDATION', 'FINANCIAL', 'SOLAR', 'PROVENANCE', 'CLIENT', 'SHARE', 'DOCUMENT', 'PERFORMANCE', 'OFFLINE', 'DATA_QUALITY', 'CALCULATION', 'OTHER']);
  const MIGRATION_MODES = Object.freeze(['LEGACY_ONLY', 'SHADOW', 'CANARY', 'NEW_WITH_FALLBACK', 'NEW_ONLY', 'LEGACY_REMOVED']);
  const STATUSES = Object.freeze(['PRESERVED', 'AT_RISK', 'REGRESSED', 'IMPROVED', 'RETIRED_APPROVED']);
  const LEGACY_CLASSES = Object.freeze(['PRESERVE_AS_IS_TEMPORARILY', 'PRESERVE_BEHAVIOR_REIMPLEMENT', 'REFACTOR_IN_PLACE', 'REPLACE_WITH_ADAPTER', 'DEPRECATE', 'REMOVE']);
  const EXCEPTION_REASONS = Object.freeze(['KNOWN_BUG', 'SECURITY_FIX', 'DATA_CORRECTION', 'ACCESSIBILITY_FIX', 'PERFORMANCE_FIX', 'APPROVED_SEMANTIC_CHANGE']);
  const KLB_CLASSES = Object.freeze(['INTENDED', 'BUG', 'AMBIGUOUS', 'UNVERIFIED']);

  /** validate(registry, { goldenCategories, testFiles }) → { ok, errors: [{ code, capabilityId, message }] } */
  function validate(reg, { goldenCategories = null, testFiles = null } = {}) {
    const errors = [], E = (code, capabilityId, message) => errors.push({ code, capabilityId, message });
    if (!reg || !Array.isArray(reg.capabilities)) return { ok: false, errors: [{ code: 'INVALID_REGISTRY', capabilityId: null, message: 'capabilities ausente' }] };
    const ids = new Set();
    for (const c of reg.capabilities) {
      const id = c.capabilityId;
      if (!id || ids.has(id)) E('DUPLICATE_OR_MISSING_ID', id, 'capabilityId ausente ou repetido'); ids.add(id);
      if (!c.name || !c.currentBehavior) E('MISSING_TEXT', id, 'name/currentBehavior obrigatórios');
      if (!PRIORITIES.includes(c.priority)) E('INVALID_PRIORITY', id, String(c.priority));
      if (!LEVELS.includes(c.preservationLevel)) E('INVALID_LEVEL', id, String(c.preservationLevel));
      if (!CATEGORIES.includes(c.category)) E('INVALID_CATEGORY', id, String(c.category));
      if (!MIGRATION_MODES.includes(c.migrationMode)) E('INVALID_MIGRATION_MODE', id, String(c.migrationMode));
      if (!STATUSES.includes(c.status)) E('INVALID_STATUS', id, String(c.status));
      if (c.legacyClassification && !LEGACY_CLASSES.includes(c.legacyClassification)) E('INVALID_LEGACY_CLASS', id, c.legacyClassification);
      if (!Array.isArray(c.currentLocation) || !c.currentLocation.length) E('MISSING_LOCATION', id, 'currentLocation vazio');
      if (!Array.isArray(c.forbiddenRegressions) || !c.forbiddenRegressions.length) E('MISSING_FORBIDDEN', id, 'forbiddenRegressions vazio');
      const tests = c.goldenTests || [];
      if ((c.priority === 'P0' || c.priority === 'P1') && !tests.length) E('NO_TEST', id, `${c.priority} sem golden/teste`);
      if (c.preservationLevel === 'EXACT_PARITY' && c.category !== 'PERFORMANCE' && !tests.some(t => t.startsWith('golden:'))) E('EXACT_WITHOUT_GOLDEN', id, 'EXACT_PARITY exige golden');
      for (const t of tests) {
        const [kind, ref] = t.split(':');
        if (kind === 'golden') { if (goldenCategories && !goldenCategories.includes(ref)) E('UNKNOWN_GOLDEN', id, ref); }
        else if (kind === 'test') { if (testFiles && !testFiles.includes(ref.split('#')[0])) E('UNKNOWN_TEST_FILE', id, ref); }
        else E('INVALID_TEST_REF', id, t);
      }
      if (c.status === 'RETIRED_APPROVED' && c.priority !== 'P3') E('RETIRE_NOT_P3', id, 'só P3 pode ser retirada (com aprovação)');
    }
    for (const x of reg.parityExceptions || []) {
      if (!ids.has(x.capabilityId)) E('EXCEPTION_UNKNOWN_CAPABILITY', x.capabilityId, 'exceção sem capacidade');
      if (!EXCEPTION_REASONS.includes(x.reason)) E('EXCEPTION_INVALID_REASON', x.capabilityId, String(x.reason));
      if (!x.approvedBy || !x.approvedAt) E('EXCEPTION_NOT_APPROVED', x.capabilityId, 'exceção sem aprovação humana registrada');
      if (!x.pathPattern) E('EXCEPTION_NO_PATH', x.capabilityId, 'exceção precisa de pathPattern do golden');
      if (!(x.evidenceRefs || []).length) E('EXCEPTION_NO_EVIDENCE', x.capabilityId, 'evidenceRefs vazio');
    }
    for (const k of reg.knownLegacyBehaviors || []) {
      if (!ids.has(k.capabilityId)) E('KLB_UNKNOWN_CAPABILITY', k.capabilityId, k.id);
      if (!KLB_CLASSES.includes(k.classification)) E('KLB_INVALID_CLASS', k.capabilityId, k.id);
    }
    return { ok: !errors.length, errors };
  }

  const byPriority = reg => Object.fromEntries(PRIORITIES.map(p => [p, reg.capabilities.filter(c => c.priority === p).map(c => c.capabilityId)]));
  /** touchedBy(registry, ['map/layers.js', …]) → capabilities whose currentLocation mentions one of the files (review list for a change) */
  const touchedBy = (reg, files) => reg.capabilities.filter(c => (c.currentLocation || []).some(loc => files.some(f => loc.split(' ')[0] === f || loc.startsWith(f) || f.startsWith(loc.split(' ')[0].replace(/\*$/, ''))))).map(c => ({ capabilityId: c.capabilityId, priority: c.priority, preservationLevel: c.preservationLevel, goldenTests: c.goldenTests }));
  const exceptionsFor = (reg, id) => (reg.parityExceptions || []).filter(x => x.capabilityId === id);
  /** cutoverGate(registry, id, { goldenDrift: n, testsPassing: bool, signoff: { by, at } | null, shadowMismatchRate }) → { allowed, blockers } */
  function cutoverGate(reg, id, ev = {}) {
    const c = reg.capabilities.find(x => x.capabilityId === id); if (!c) return { allowed: false, blockers: ['CAPABILITY_UNKNOWN'] };
    const b = [];
    if (!ev.testsPassing) b.push('TESTS_NOT_PASSING');
    if (ev.goldenDrift == null) b.push('GOLDEN_NOT_RUN');
    else if (ev.goldenDrift > 0 && ['EXACT_PARITY', 'DATA_PARITY'].includes(c.preservationLevel)) b.push('GOLDEN_DRIFT_WITHOUT_APPROVED_EXCEPTION');
    if (c.priority === 'P0' && !(ev.signoff && ev.signoff.by && ev.signoff.at)) b.push('P0_REQUIRES_MIGRATION_SIGNOFF');
    if (c.priority === 'P0' && ev.shadowMismatchRate != null && ev.shadowMismatchRate > 0) b.push('SHADOW_MISMATCH');
    return { allowed: !b.length, blockers: b, priority: c.priority, preservationLevel: c.preservationLevel };
  }
  /** rows for CAPABILITY_PRESERVATION_MATRIX.md */
  const matrixRows = reg => reg.capabilities.map(c => ({ id: c.capabilityId, name: c.name, priority: c.priority, level: c.preservationLevel, current: c.currentLocation.join('; '), target: c.targetLocation, golden: c.goldenTests.join(', '), mode: c.migrationMode, status: c.status }));

  return Object.freeze({ PRIORITIES, LEVELS, CATEGORIES, MIGRATION_MODES, STATUSES, LEGACY_CLASSES, EXCEPTION_REASONS, KLB_CLASSES, validate, byPriority, touchedBy, exceptionsFor, cutoverGate, matrixRows });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = App.governance.capabilities;
