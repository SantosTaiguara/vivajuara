'use strict';
// Topic 55 — the implementation roadmap as data (config/governance/roadmap.json): phases of waves 0–9, typed dependencies,
// quality gates, the mapping of topics 1–56 and the open human decisions. The tests keep the roadmap honest: no phase is
// DONE on top of an open HARD dependency, nothing BLOCKED without a registered decision, DONE claims point to files that exist.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const G = require('../scripts/governanceSources.js');
const R = G.mod('roadmap.js');
const RM = G.cfg('roadmap');

test('roadmap: valid (acyclic, typed dependencies, honest statuses, every topic 1–56 mapped)', () => {
  assert.deepEqual(R.validate(RM).errors, []);
  assert.equal(RM.waves.length, 10);
  assert.equal(R.order(RM).length, RM.phases.length, 'ordem topológica cobre todas as fases');
});

test('roadmap: topics without a received spec are flagged, not silently mapped as done', () => {
  assert.deepEqual(RM.specMissing, [26, 27]);
  for (const t of RM.specMissing) for (const p of RM.phases.filter(p => p.topics.includes(t))) assert.notEqual(p.status, 'DONE', `fase ${p.phaseId} (tópico ${t} sem spec)`);
});

test('roadmap: DONE phases point to deliverables that exist in the repository', () => {
  for (const p of RM.phases.filter(p => p.status === 'DONE')) for (const d of p.deliverables) {
    const f = d.split(' ')[0];
    if (/^(docs|config|tests|scripts)\//.test(f)) assert.ok(fs.existsSync(path.join(G.ROOT, f.replace(/\*.*$/, ''))), `${p.phaseId}: ${f}`);
    else if (/\.js$|\/$|\/\*$/.test(f)) assert.ok(fs.existsSync(path.join(G.SRC, f.replace(/\/?\*$/, ''))), `${p.phaseId}: ${f}`);
  }
});

test('roadmap: critical anti-patterns of topic 55 are encoded as dependencies', () => {
  const dep = (a, b) => RM.dependencies.find(d => d.fromPhaseId === a && d.toPhaseId === b);
  assert.ok(dep('3.2', '3.3') && dep('3.3', '3.4'), 'writes críticos só depois de authz');
  assert.ok(dep('3.4', '5.2'), 'Customer não antes de tenant');
  assert.equal(dep('6.2', '6.3').type, 'HARD', 'Share não antes de client-safe projection');
  assert.ok(dep('7.3', '7.4') && dep('7.5', '7.4'), 'Offline pack depois de cache/versão e segurança');
  assert.ok(dep('0.5', '9.1') && dep('9.1', '9.3'), 'remover legado só depois de paridade');
  assert.ok(dep('3.4', '8.2'), 'multi-tenant rollout depende de tenant');
});

test('roadmap: blocked phases and open decisions are consistent; current maturity is reported', t => {
  const blocked = RM.phases.filter(p => p.status === 'BLOCKED');
  assert.ok(blocked.length > 0);
  for (const p of blocked) assert.ok(p.blockers.length, p.phaseId);
  for (const d of RM.decisions) {
    assert.ok(['OPEN', 'DECIDED'].includes(d.status), d.decisionId);
    if (d.status === 'DECIDED') { assert.ok(d.decidedAt && d.outcome, d.decisionId); for (const p of RM.phases) assert.ok(!(p.blockers || []).includes(d.decisionId), `${p.phaseId} bloqueada por decisão já tomada ${d.decisionId}`); }
  }
  const m = R.maturity(RM); t.diagnostic(`maturidade: ${m.level} ${m.name}`); t.diagnostic('próximas fases acionáveis: ' + R.nextActionable(RM).join(', '));
  assert.ok(['L0', 'L1', 'L2'].includes(m.level), 'sem backend autoritativo a maturidade não passa de L2');
});

test('roadmap documents exist and the dependency graph doc is generated from the data', () => {
  for (const f of ['MASTER_IMPLEMENTATION_ROADMAP', 'ROADMAP_DEPENDENCY_GRAPH', 'ROADMAP_PHASE_DEFINITIONS', 'ROADMAP_ENTRY_EXIT_CRITERIA', 'ROADMAP_QUALITY_GATES', 'ROADMAP_CUTOVER_POLICY', 'ROADMAP_ROLLBACK_POLICY', 'ROADMAP_PARALLEL_WORKSTREAMS', 'ROADMAP_RISK_REGISTER', 'ROADMAP_DECISION_LOG', 'ROADMAP_STATUS_TEMPLATE', 'ROADMAP_MIGRATION_METRICS', 'ROADMAP_SIGNOFF_TEMPLATE', 'ROADMAP_LEGACY_SUNSET_PLAN'])
    assert.ok(fs.existsSync(path.join(G.ROOT, 'docs', f + '.md')), f);
  const graph = fs.readFileSync(path.join(G.ROOT, 'docs', 'ROADMAP_DEPENDENCY_GRAPH.md'), 'utf8');
  assert.ok(graph.includes(R.mermaid(RM)), 'ROADMAP_DEPENDENCY_GRAPH.md desatualizado: rode node scripts/governanceDocs.js');
});

test('validator rejects dishonest roadmaps (DONE over open dependency, cycle, BLOCKED without decision, unmapped topic)', () => {
  const clone = () => JSON.parse(JSON.stringify(RM));
  let r = clone(); r.phases.find(p => p.phaseId === '3.5').status = 'DONE';
  assert.ok(R.validate(r).errors.some(e => e.code === 'DONE_WITH_OPEN_HARD_DEPENDENCY'));
  r = clone(); r.dependencies.push({ fromPhaseId: '9.10', toPhaseId: '0.1', type: 'SOFT', reason: 'x' });
  assert.ok(R.validate(r).errors.some(e => e.code === 'DEPENDENCY_CYCLE'));
  r = clone(); r.phases.find(p => p.phaseId === '3.5').blockers = [];
  assert.ok(R.validate(r).errors.some(e => e.code === 'BLOCKED_WITHOUT_BLOCKER'));
  r = clone(); for (const p of r.phases) p.topics = p.topics.filter(t => t !== 44);
  assert.ok(R.validate(r).errors.some(e => e.code === 'TOPIC_NOT_MAPPED' && e.ref === '44'));
});
