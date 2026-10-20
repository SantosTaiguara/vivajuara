/* governance/roadmap.js — topic 55: the implementation roadmap as data (plat/config/governance/roadmap.json).
   RoadmapPhaseDefinition + RoadmapDependency (HARD / SOFT / VALIDATION / OPTIONAL), mapped to topics 1–56 and to the
   open human decisions. validate() enforces the honesty rules of the roadmap:
     - dependency graph is acyclic and only names known phases;
     - a DONE phase has its HARD dependencies DONE or VALIDATING, and its VALIDATION dependencies DONE
       (validation dependency = may be implemented, may not be cut over before the other is validated);
     - an IN_PROGRESS / VALIDATING / DONE phase never HARD-depends on a NOT_STARTED phase;
     - a BLOCKED phase names at least one blocker, every blocker is a registered decision;
     - every topic 1–56 is mapped to at least one phase (topics without a received spec are flagged, not hidden).
   Pure: data in, report out. */
var App = (typeof App !== 'undefined' && App) || (typeof globalThis !== 'undefined' && globalThis.App) || {};
App.governance = App.governance || {};
App.governance.roadmap = (() => {
  const STATUS = Object.freeze(['NOT_STARTED', 'READY', 'IN_PROGRESS', 'BLOCKED', 'VALIDATING', 'DONE']);
  const DEP_TYPES = Object.freeze(['HARD', 'SOFT', 'VALIDATION', 'OPTIONAL']);
  const STARTED = new Set(['IN_PROGRESS', 'VALIDATING', 'DONE']);

  function validate(r) {
    const errors = [], E = (code, ref, message) => errors.push({ code, ref, message });
    const byId = new Map();
    for (const p of r.phases) { if (byId.has(p.phaseId)) E('DUPLICATE_PHASE', p.phaseId, ''); byId.set(p.phaseId, p); if (!STATUS.includes(p.status)) E('INVALID_STATUS', p.phaseId, p.status); if (!(p.qualityGates || []).length) E('NO_QUALITY_GATE', p.phaseId, ''); for (const g of p.qualityGates || []) if (!(r.qualityGates || []).includes(g)) E('UNKNOWN_GATE', p.phaseId, g); if (!r.waves.some(w => w.waveId === p.waveId)) E('UNKNOWN_WAVE', p.phaseId, p.waveId); }
    const decisions = new Set((r.decisions || []).map(d => d.decisionId));
    for (const d of r.dependencies) {
      if (!byId.has(d.fromPhaseId) || !byId.has(d.toPhaseId)) { E('UNKNOWN_PHASE_IN_DEPENDENCY', `${d.fromPhaseId}→${d.toPhaseId}`, ''); continue; }
      if (!DEP_TYPES.includes(d.type)) E('INVALID_DEP_TYPE', `${d.fromPhaseId}→${d.toPhaseId}`, d.type);
      const from = byId.get(d.fromPhaseId), to = byId.get(d.toPhaseId);
      if (to.status === 'DONE' && d.type === 'HARD' && !['DONE', 'VALIDATING'].includes(from.status)) E('DONE_WITH_OPEN_HARD_DEPENDENCY', to.phaseId, `${from.phaseId} está ${from.status}`);
      if (to.status === 'DONE' && d.type === 'VALIDATION' && from.status !== 'DONE' && from.status !== 'VALIDATING') E('DONE_BEFORE_VALIDATION_DEPENDENCY', to.phaseId, `${from.phaseId} está ${from.status}`);
      if (STARTED.has(to.status) && d.type === 'HARD' && from.status === 'NOT_STARTED') E('STARTED_ON_NOT_STARTED_HARD_DEPENDENCY', to.phaseId, `${from.phaseId} não iniciada`);
    }
    for (const p of r.phases) {
      if (p.status === 'BLOCKED' && !(p.blockers || []).length) E('BLOCKED_WITHOUT_BLOCKER', p.phaseId, '');
      for (const b of p.blockers || []) if (!decisions.has(b)) E('UNKNOWN_DECISION', p.phaseId, b);
    }
    const cyc = cycles(r); for (const c of cyc) E('DEPENDENCY_CYCLE', c.join('→'), '');
    const mapped = new Set(r.phases.flatMap(p => p.topics || []));
    for (let t = 1; t <= 56; t++) if (!mapped.has(t)) E('TOPIC_NOT_MAPPED', String(t), (r.topics || {})[t] || '');
    return { ok: !errors.length, errors };
  }
  /** cycles over all dependency types (Kahn: phases left over are in or behind a cycle) */
  function cycles(r) {
    const ids = r.phases.map(p => p.phaseId), indeg = new Map(ids.map(i => [i, 0])), out = new Map(ids.map(i => [i, []]));
    for (const d of r.dependencies) if (out.has(d.fromPhaseId) && indeg.has(d.toPhaseId)) { out.get(d.fromPhaseId).push(d.toPhaseId); indeg.set(d.toPhaseId, indeg.get(d.toPhaseId) + 1); }
    const q = ids.filter(i => !indeg.get(i)), seen = new Set();
    while (q.length) { const v = q.shift(); seen.add(v); for (const w of out.get(v)) { indeg.set(w, indeg.get(w) - 1); if (!indeg.get(w)) q.push(w); } }
    const left = ids.filter(i => !seen.has(i)); return left.length ? [left] : [];
  }
  /** topological order (stable: phase id order among ready phases) */
  function order(r) {
    const num = id => id.split('.').map(Number), cmp = (a, b) => { const x = num(a), y = num(b); return x[0] - y[0] || x[1] - y[1]; };
    const ids = r.phases.map(p => p.phaseId).sort(cmp), indeg = new Map(ids.map(i => [i, 0])), out = new Map(ids.map(i => [i, []]));
    for (const d of r.dependencies) if (out.has(d.fromPhaseId) && indeg.has(d.toPhaseId)) { out.get(d.fromPhaseId).push(d.toPhaseId); indeg.set(d.toPhaseId, indeg.get(d.toPhaseId) + 1); }
    const ready = ids.filter(i => !indeg.get(i)), res = [];
    while (ready.length) { ready.sort(cmp); const v = ready.shift(); res.push(v); for (const w of out.get(v)) { indeg.set(w, indeg.get(w) - 1); if (!indeg.get(w)) ready.push(w); } }
    return res;
  }
  /** status per wave: counts and the share of DONE phases (an indicator, never a velocity KPI) */
  const waveStatus = r => r.waves.map(w => { const ps = r.phases.filter(p => p.waveId === w.waveId), c = Object.fromEntries(STATUS.map(s => [s, ps.filter(p => p.status === s).length])); return { waveId: w.waveId, name: w.name, phases: ps.length, ...c }; });
  /** next actionable phases: not DONE, not BLOCKED, every HARD dependency DONE/VALIDATING */
  function nextActionable(r) {
    const byId = new Map(r.phases.map(p => [p.phaseId, p]));
    return r.phases.filter(p => ['NOT_STARTED', 'READY', 'IN_PROGRESS'].includes(p.status) && r.dependencies.filter(d => d.toPhaseId === p.phaseId && d.type === 'HARD').every(d => ['DONE', 'VALIDATING'].includes((byId.get(d.fromPhaseId) || {}).status))).map(p => p.phaseId);
  }
  /** maturity level (topic 55 §317): highest level whose waves are all DONE/VALIDATING */
  function maturity(r) {
    const LEVELS = [['L0', 'Legacy app understood', ['W0']], ['L1', 'Canonical data', ['W1']], ['L2', 'Modular client', ['W2']], ['L3', 'Authoritative backend', ['W3']], ['L4', 'Explainable intelligence', ['W4']], ['L5', 'Customer-centric platform', ['W5']], ['L6', 'Shareable/offline platform', ['W6', 'W7']], ['L7', 'Multi-tenant product', ['W8']]];
    let reached = null; const detail = [];
    for (const [id, name, waves] of LEVELS) {
      const ps = r.phases.filter(p => waves.includes(p.waveId)), ok = ps.filter(p => ['DONE', 'VALIDATING'].includes(p.status)).length;
      detail.push({ level: id, name, phases: ps.length, doneOrValidating: ok });
      if (ok === ps.length && (reached === null || reached === LEVELS.findIndex(l => l[0] === id) - 1)) reached = LEVELS.findIndex(l => l[0] === id);
    }
    return { level: reached == null ? null : LEVELS[reached][0], name: reached == null ? null : LEVELS[reached][1], detail };
  }
  /** Mermaid graph of HARD/VALIDATION dependencies (ROADMAP_DEPENDENCY_GRAPH.md is generated from this) */
  function mermaid(r, { types = ['HARD', 'VALIDATION'] } = {}) {
    const node = id => 'P' + id.replace('.', '_'), byId = new Map(r.phases.map(p => [p.phaseId, p]));
    const cls = { DONE: 'done', VALIDATING: 'val', IN_PROGRESS: 'prog', BLOCKED: 'blk', READY: 'ready', NOT_STARTED: 'ns' };
    const lines = ['flowchart TD'];
    for (const w of r.waves) { lines.push(`  subgraph ${w.waveId}["${w.waveId} · ${w.name}"]`); for (const p of r.phases.filter(x => x.waveId === w.waveId)) lines.push(`    ${node(p.phaseId)}["${p.phaseId} ${p.name}"]:::${cls[p.status]}`); lines.push('  end'); }
    for (const d of r.dependencies.filter(x => types.includes(x.type))) if (byId.has(d.fromPhaseId) && byId.has(d.toPhaseId)) lines.push(`  ${node(d.fromPhaseId)} ${d.type === 'HARD' ? '-->' : '-.->'} ${node(d.toPhaseId)}`);
    lines.push('  classDef done fill:#dff0d8,stroke:#3c763d', '  classDef val fill:#e8f4fb,stroke:#31708f', '  classDef prog fill:#fcf8e3,stroke:#8a6d3b', '  classDef blk fill:#f2dede,stroke:#a94442', '  classDef ready fill:#f5f5f5,stroke:#777', '  classDef ns fill:#ffffff,stroke:#bbb');
    return lines.join('\n');
  }
  return Object.freeze({ STATUS, DEP_TYPES, validate, cycles, order, waveStatus, nextActionable, maturity, mermaid });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = App.governance.roadmap;
