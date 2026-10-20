'use strict';
// Topic 35 — Analytical versioning: runs vs versions, input snapshots with only real dependencies, module graph and reuse,
// validation, atomic publication with optimistic concurrency, activation history, resolver, currentness, diff/impact,
// reproducibility and the legacy baseline parity. Nothing here may change a score (proved below).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC, DATA } = require('./harness.js');

const clone = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
const deq = (a, b, m) => assert.deepEqual(clone(a), clone(b), m);
const DOC = JSON.parse(fs.readFileSync(path.join(DATA, 'analysis-input.json'), 'utf8'));
const can = (...p) => x => p.includes(x);
let App, V, D, def, dev, cfg, lots, beforeLots, direct;
const ORG = { organizationId: 'house7' }, META = { organizationId: 'house7', developmentId: 'viva-juara' };

test.before(async () => {
  App = load();
  new Function('App', fs.readFileSync(path.join(SRC, 'versioning/analysisVersioning.js'), 'utf8'))(App);
  V = App.versioning; D = V.definitions('viva-juara'); def = D.definitions[0]; dev = App.config.DEVELOPMENTS[0]; cfg = App.methodology.current('viva-juara');
  const repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync(); beforeLots = lots.map(l => App.domain.serializeLot(l));
  direct = App.intelligence.analyzeDevelopment(DOC.lots, { methodology: App.methodology.compiled(cfg) });
});
const src = (o = {}) => ({ dev, inputDoc: DOC, methodologyConfig: cfg, ...o });
/** draft A1 from the current inputs */
function draft(repo, s = src(), o = {}) {
  const snap = V.inputSnapshot(def, s, { ...META, at: o.at || '2026-10-09T10:00:00Z' });
  const p = repo.plan(def, snap, { previousVersionId: o.prev });
  return repo.run(p, { inputs: s.inputDoc.lots, methodologyConfig: s.methodologyConfig, definition: def, at: o.at || '2026-10-09T10:00:00Z' });
}
const newRepo = () => V.repository(ORG, { policies: D.policies });

test('definitions: LOT_INTELLIGENCE_BASE declares its real dependencies (no price table, no availability)', () => {
  assert.equal(def.code, 'LOT_INTELLIGENCE_BASE');
  assert.ok(!def.dependencyDomains.includes('PRICE_TABLE_VERSION') && !def.dependencyDomains.includes('AVAILABILITY_REVISION'));
  // the methodology really reads no price/availability input
  const inputs = new Set(cfg.criteria.flatMap(c => c.steps.flatMap(App.methodology.stepInputs)));
  assert.ok(![...inputs].some(k => /price|commercial|availability/i.test(k)));
});
test('module graph: DAG from the engine pipeline, cycle detection, cross-entity scope for classification/ranking', () => {
  const g = V.moduleGraph();
  deq(g.order.slice(0, 5), ['geometry', 'location', 'mobility', 'environmental', 'surroundings']);
  assert.ok(g.order.indexOf('criteria') < g.order.indexOf('scoring') && g.order.indexOf('overall') < g.order.indexOf('classification'));
  deq(g.nodes.filter(n => n.computationScope === 'CROSS_ENTITY').map(n => n.moduleId), ['classification', 'ranking']);
  assert.throws(() => V.topo([{ moduleId: 'a' }, { moduleId: 'b' }], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]), e => e.code === 'CYCLE');
  assert.equal(V.moduleGraph().checksum, g.checksum);
});
test('fingerprint: methodology, configs, static data, measurements, price table and engine refs — read-only, deterministic', () => {
  const f = V.fingerprint({ dev, methodologyConfig: cfg, inputDoc: DOC, dataVersions: lots[0].metadata.dataVersions, availabilityRevision: 0 });
  assert.equal(f.methodology.methodologyVersion, '1.0.0'); assert.equal(f.priceTable.version, '2026-10-06'); assert.equal(f.staticData.id, '2026-10-06.1');
  assert.equal(f.measurements.id, 'measurements-2026-10-06'); assert.equal(f.measurements.entityCount, 498); assert.equal(f.engine.engineVersion, App.intelligence.ENGINE_VERSION);
  assert.ok(f.configs.some(c => c.configType === 'rules') || f.configs.length > 3);
  assert.equal(V.fingerprint({ dev, methodologyConfig: cfg, inputDoc: DOC, availabilityRevision: 0 }).combined, V.fingerprint({ dev, methodologyConfig: cfg, inputDoc: DOC, availabilityRevision: 0 }).combined);
  assert.notEqual(V.fingerprint({ dev, methodologyConfig: cfg, inputDoc: DOC, availabilityRevision: 1 }).combined, V.fingerprint({ dev, methodologyConfig: cfg, inputDoc: DOC, availabilityRevision: 0 }).combined);
  assert.equal(dev.priceTables[0].pricePerM2, 1196);
});
test('input snapshot: immutable, only real dependencies (no price table / availability refs)', () => {
  const s = V.inputSnapshot(def, src({ availabilityRevision: 7 }), META);
  deq(s.dynamicDataRefs, []); assert.ok(!JSON.stringify(s).includes('PRICE_TABLE_VERSION') && !JSON.stringify(s).includes('AVAILABILITY_REVISION'));
  assert.equal(s.entityCount, 498); assert.equal(s.dependencyFingerprints.length, 14);
  assert.throws(() => { s.entityCount = 1; }, TypeError);
  assert.equal(V.inputSnapshot(def, src({ availabilityRevision: 8 }), META).checksum, s.checksum, 'availability change: same snapshot');
});
test('run ≠ version: a successful run creates a DRAFT; latest moves, current published does not; outputs equal the engine (no score change)', () => {
  const repo = newRepo(), { run, version } = draft(repo);
  assert.equal(run.status, 'SUCCEEDED'); assert.equal(version.lifecycleStatus, 'DRAFT'); assert.equal(version.label, 'A1');
  const p = repo.pointer(def.id); assert.equal(p.latestVersionId, version.id); assert.equal(p.currentPublishedVersionId, null);
  assert.equal(repo.resolve(def.id), null, 'normal experience sees no draft');
  assert.throws(() => repo.resolve(def.id, { mode: 'LATEST' }), e => e.code === 'DRAFT_NOT_ALLOWED');
  assert.equal(repo.resolve(def.id, { mode: 'LATEST', technical: true }).id, version.id);
  const rs = repo.resultSet(version.id);
  deq(rs.entities.map(e => [e.entityId, e.outputs.scores, e.outputs.class, e.outputs.rankings]), direct.results.map(r => [r.lotId, r.scores, r.class, r.rankings]));
  deq(lots.map(l => App.domain.serializeLot(l)), beforeLots);
});
test('golden run failed: engine failure → FAILED run, no version, current pointer untouched', () => {
  const repo = newRepo(), { version: a1 } = draft(repo); repo.validate(a1.id);
  repo.publish(a1.id, { can: can('analysis.publish'), reason: 'baseline', expectedCurrentVersionId: null, at: '2026-10-09T10:05:00Z' }, def);
  const snap = V.inputSnapshot(def, src(), META), p = repo.plan(def, snap, { previousVersionId: a1.id });
  const out = repo.run(p, { inputs: DOC.lots, methodologyConfig: cfg, definition: def, engine: { analyzeDevelopment() { throw Object.assign(new Error('boom'), { code: 'ENGINE_FAILED' }); } } });
  assert.equal(out.run.status, 'FAILED'); assert.equal(out.version, null); assert.equal(repo.pointer(def.id).currentPublishedVersionId, a1.id);
  const drift = repo.run(p, { inputs: DOC.lots.slice(1), methodologyConfig: cfg, definition: def });
  assert.equal(drift.run.status, 'FAILED'); deq(drift.run.errors.map(e => e.code), ['INPUT_SNAPSHOT_MISMATCH']);
  const other = JSON.parse(JSON.stringify(cfg)); other.scores[0].criteria[0].weight += 0.01;
  assert.equal(repo.run(p, { inputs: DOC.lots, methodologyConfig: other, definition: def }).run.errors[0].code, 'METHODOLOGY_SNAPSHOT_MISMATCH');
});
test('validation + publication: validate → VALIDATED (immutable); publish atomically; permission, reason and impact review required', () => {
  const repo = newRepo(), { version } = draft(repo);
  assert.throws(() => repo.publish(version.id, { can: can('analysis.publish'), reason: 'x', expectedCurrentVersionId: null }, def), e => e.code === 'PUBLICATION_BLOCKED');
  const rep = repo.validate(version.id); assert.equal(rep.status, 'PASS'); assert.equal(rep.criticalErrorCount, 0);
  assert.throws(() => { repo.version(version.id).label = 'X'; }, TypeError);
  assert.throws(() => repo.publish(version.id, { reason: 'x', expectedCurrentVersionId: null }, def), e => e.code === 'FORBIDDEN');
  const d = repo.decision(version.id, { can: can('analysis.publish'), expectedCurrentVersionId: null }, def); deq(d.blockers, ['MISSING_REASON']);
  const out = repo.publish(version.id, { can: can('analysis.publish'), reason: 'baseline', by: 'user:analyst', expectedCurrentVersionId: null, at: '2026-10-09T10:05:00Z' }, def);
  assert.equal(out.pointer.currentPublishedVersionId, version.id); assert.equal(repo.resolve(def.id).id, version.id); assert.equal(repo.currentStatus(version.id), 'CURRENT');
  assert.ok(repo.events().some(e => e.type === 'ANALYSIS_VERSION_PUBLISHED' && !('entities' in e)));
  const { version: a2 } = draft(repo, src(), { prev: version.id, at: '2026-10-09T11:00:00Z' }); repo.validate(a2.id);
  assert.deepEqual(repo.decision(a2.id, { can: can('analysis.publish'), reason: 'x', expectedCurrentVersionId: version.id }, def).blockers, ['IMPACT_REVIEW_REQUIRED']);
});
test('golden concurrent publication: A expects A1 while B already published A2 → ANALYSIS_CURRENT_VERSION_CONFLICT', () => {
  const repo = newRepo(), { version: a1 } = draft(repo); repo.validate(a1.id);
  repo.publish(a1.id, { can: can('analysis.publish'), reason: 'r', expectedCurrentVersionId: null, at: '2026-10-09T10:00:00Z' }, def);
  const { version: a2 } = draft(repo, src(), { prev: a1.id }); repo.validate(a2.id);
  const { version: a3 } = draft(repo, src(), { prev: a1.id }); repo.validate(a3.id);
  const ok = { can: can('analysis.publish'), reason: 'r', impactReviewed: true };
  repo.publish(a3.id, { ...ok, expectedCurrentVersionId: a1.id, at: '2026-10-09T11:00:00Z' }, def); // user B
  assert.throws(() => repo.publish(a2.id, { ...ok, expectedCurrentVersionId: a1.id }, def), e => e.code === 'ANALYSIS_CURRENT_VERSION_CONFLICT'); // user A
  assert.equal(repo.pointer(def.id).currentPublishedVersionId, a3.id); assert.equal(repo.currentStatus(a1.id), 'SUPERSEDED'); assert.equal(repo.currentStatus(a2.id), 'NEVER_ACTIVE');
});
test('golden historical report + rollback: AS_OF follows activation intervals; reactivation keeps every version', () => {
  const repo = newRepo(), ok = { can: can('analysis.publish', 'analysis.activate'), reason: 'r', impactReviewed: true };
  const { version: a1 } = draft(repo); repo.validate(a1.id); repo.publish(a1.id, { ...ok, expectedCurrentVersionId: null, at: '2026-10-09T10:00:00Z' }, def);
  const reportRef = { LOT_INTELLIGENCE_BASE: a1.id, createdAt: '2026-10-09T10:30:00Z' };
  const { version: a2 } = draft(repo, src(), { prev: a1.id }); repo.validate(a2.id); repo.publish(a2.id, { ...ok, expectedCurrentVersionId: a1.id, at: '2026-10-09T15:00:00Z' }, def);
  assert.equal(repo.resolve(def.id, { mode: 'AS_OF', at: reportRef.createdAt }).id, a1.id, 'old report still resolves to A1');
  assert.equal(repo.resolve(def.id, { mode: 'AS_OF', at: '2026-10-09T16:00:00Z' }).id, a2.id);
  assert.throws(() => repo.activate(a1.id, { can: can('analysis.publish'), reason: 'x', expectedCurrentVersionId: a2.id }), e => e.code === 'FORBIDDEN');
  repo.activate(a1.id, { ...ok, expectedCurrentVersionId: a2.id, at: '2026-10-09T18:00:00Z', by: 'user:admin' });
  assert.equal(repo.resolve(def.id).id, a1.id); assert.equal(repo.version(a2.id).lifecycleStatus, 'PUBLISHED');
  deq(repo.activations(def.id).map(a => [a.versionId, a.action]), [[a1.id, 'PUBLISH'], [a2.id, 'PUBLISH'], [a1.id, 'ACTIVATE']]);
  assert.equal(repo.resolve(def.id, { mode: 'AS_OF', at: '2026-10-09T17:00:00Z' }).id, a2.id);
  assert.throws(() => repo.archive(a1.id), e => e.code === 'INVALID_TRANSITION');
});
test('golden currentness: availability change irrelevant → CURRENT_INPUTS; price change irrelevant to this definition; measurements change → INPUTS_CHANGED; methodology → METHODOLOGY_SUPERSEDED', () => {
  const repo = newRepo(), { version } = draft(repo); repo.validate(version.id);
  assert.equal(repo.currentness(version.id, src({ availabilityRevision: 1043 }), def).status, 'CURRENT_INPUTS');
  const dev2 = { ...dev, priceTables: [{ ...dev.priceTables[0], version: '2026-11-01', pricePerM2: 1300 }] };
  assert.equal(repo.currentness(version.id, src({ dev: dev2 }), def).status, 'CURRENT_INPUTS', 'this analysis does not read the price table');
  const doc2 = { ...DOC, inputVersion: 'measurements-2026-10-20', lots: DOC.lots.map((l, i) => i ? l : { ...l, location: { ...l.location, distanceToParkingM: l.location.distanceToParkingM + 3 } }) };
  const c = repo.currentness(version.id, src({ inputDoc: doc2 }), def); assert.equal(c.status, 'INPUTS_CHANGED');
  const cfg2 = { ...JSON.parse(JSON.stringify(cfg)), methodologyVersion: '1.1.0' }; cfg2.levels = cfg2.levels; cfg2.alerts[0].when.lt = 4.5;
  assert.equal(repo.currentness(version.id, src({ methodologyConfig: cfg2 }), def).status, 'METHODOLOGY_SUPERSEDED');
  // a definition that does depend on the price table sees the change (selective, not universal)
  const priced = { ...def, id: 'def:priced', dependencyDomains: [...def.dependencyDomains, 'PRICE_TABLE_VERSION'] }, r2 = newRepo();
  const s = V.inputSnapshot(priced, src(), META), p = r2.plan(priced, s), { version: pv } = r2.run(p, { inputs: DOC.lots, methodologyConfig: cfg, definition: priced });
  assert.equal(r2.currentness(pv.id, src({ dev: dev2 }), priced).status, 'INPUTS_CHANGED');
  assert.equal(r2.currentness(pv.id, src({ availabilityRevision: 99 }), priced).status, 'CURRENT_INPUTS');
});
test('golden module reuse: only location inputs changed → reuse geometry/mobility/environmental/surroundings, recompute location and downstream', () => {
  const repo = newRepo(), { version: a1 } = draft(repo);
  const doc2 = { ...DOC, inputVersion: 'm2', lots: DOC.lots.map((l, i) => i ? l : { ...l, location: { ...l.location, distanceToParkingM: l.location.distanceToParkingM + 3 } }) };
  const s2 = V.inputSnapshot(def, src({ inputDoc: doc2 }), META), p = repo.plan(def, s2, { previousVersionId: a1.id });
  const act = Object.fromEntries(p.modulePlans.map(m => [m.moduleId, m.action]));
  deq(['geometry', 'mobility', 'environmental', 'surroundings'].map(m => act[m]), ['REUSE', 'REUSE', 'REUSE', 'REUSE']);
  assert.equal(act.location, 'RECOMPUTE'); deq(p.modulePlans.find(m => m.moduleId === 'location').reasonCodes, ['INPUT_CHANGED']);
  assert.equal(act.ranking, 'RECOMPUTE'); deq(p.modulePlans.find(m => m.moduleId === 'criteria').reasonCodes, ['UPSTREAM_CHANGED']);
  const { version: a2 } = repo.run(p, { inputs: doc2.lots, methodologyConfig: cfg, definition: def });
  deq(a2.determinism, [], 'reused module outputs are identical when recomputed');
  const geo = id => repo.version(id).moduleResultRefs.map(x => repo.moduleResultSet(x)).find(m => m.moduleId === 'geometry').id;
  assert.equal(geo(a2.id), geo(a1.id));
  const same = repo.plan(def, V.inputSnapshot(def, src(), META), { previousVersionId: a1.id }); deq(same.recomputeModuleIds, []);
  deq(repo.plan(def, V.inputSnapshot(def, src(), META), { previousVersionId: a1.id, forceRebuild: true }).modulePlans[0].reasonCodes, ['FORCED_REBUILD']);
  const rp = repo.refreshPlan(a1.id, src({ inputDoc: doc2 }), def); assert.equal(rp.recommendedAction, 'RECOMPUTE'); assert.ok(rp.affectedModuleIds.includes('location') && !rp.affectedModuleIds.includes('geometry'));
  assert.equal(repo.refreshPlan(a1.id, src({ availabilityRevision: 5 }), def).recommendedAction, 'NO_ACTION');
});
test('diff and impact: methodology candidate reports class transitions and causes from metadata only', () => {
  const repo = newRepo(), { version: a1 } = draft(repo);
  const cfg2 = JSON.parse(JSON.stringify(cfg)); cfg2.methodologyVersion = '1.1.0'; cfg2.scores.find(s => s.id === 'housing').criteria[0].weight += 0.05; cfg2.scores.find(s => s.id === 'housing').criteria[1].weight -= 0.05;
  const s2 = V.inputSnapshot(def, src({ methodologyConfig: cfg2 }), META), { version: a2 } = repo.run(repo.plan(def, s2, { previousVersionId: a1.id }), { inputs: DOC.lots, methodologyConfig: cfg2, definition: def });
  const d = repo.diff(a1.id, a2.id); assert.ok(d.changedEntityCount > 0); deq(d.causeSummary.causes, ['METHODOLOGY_CHANGED']);
  assert.ok(d.moduleDiffs.find(m => m.moduleId === 'geometry').reused);
  const im = repo.impact(a2.id, a1.id); assert.equal(im.changedEntityCount, d.changedEntityCount); assert.ok(im.largestChanges.length > 0);
  assert.equal(repo.diff(a1.id, a1.id).changedEntityCount, 0);
});
test('reproducibility + determinism: computed version PARTIAL without runtime/artifact refs, FULL-capable with them; legacy baseline never FULL', () => {
  const repo = newRepo(), { version } = draft(repo); assert.equal(repo.reproducibility(version.id).status, 'PARTIAL');
  const s = V.inputSnapshot(def, src({ engine: { runtimeVersion: process.version, artifactChecksum: 'abc' } }), META);
  const { version: v2 } = repo.run(repo.plan(def, s), { inputs: DOC.lots, methodologyConfig: cfg, definition: def });
  assert.equal(repo.reproducibility(v2.id).status, 'FULL'); assert.equal(v2.contentChecksum, version.contentChecksum, 'same outputs, different execution refs');
  const dc = V.determinismCheck(DOC.lots, cfg); assert.equal(dc.deterministic, true);
  const b = repo.registerBaseline(V.legacyBaseline(lots, { def, dev, organizationId: 'house7' }));
  assert.equal(b.origin, 'MIGRATED_LEGACY'); assert.equal(repo.reproducibility(b.id).status, 'PARTIAL');
});
test('golden legacy migration parity: published lots.json baseline vs engine candidate — zero mismatches (notes at published precision)', () => {
  const repo = newRepo(), base = V.legacyBaseline(lots, { def, dev, organizationId: 'house7' }), b = repo.registerBaseline(base), { version } = draft(repo);
  const par = V.parity(repo.resultSet(b.id), repo.resultSet(version.id));
  assert.equal(par.comparedEntityCount, 498); assert.equal(par.mismatchCount, 0, JSON.stringify(par.mismatchItems.slice(0, 3)));
  assert.equal(par.exactMatchCount + par.toleranceMatchCount, par.comparedAttributeCount);
  repo.validate(version.id);
  assert.ok(repo.decision(version.id, { can: can('analysis.publish'), reason: 'r', expectedCurrentVersionId: null, migration: true }, def).blockers.includes('PARITY_REQUIRED'));
  repo.publish(version.id, { can: can('analysis.publish'), reason: 'migração', expectedCurrentVersionId: null, migration: true, parityReport: par }, def);
  assert.equal(repo.resolve(def.id).id, version.id);
});
test('tenant isolation and read model by mode (client minimal, technical full)', () => {
  assert.throws(() => V.repository({}), e => e.code === 'TENANT_REQUIRED');
  const repo = newRepo(), other = V.repository({ organizationId: 'other' });
  const snap = V.inputSnapshot(def, src(), META); assert.throws(() => other.plan(def, snap), e => e.code === 'TENANT_MISMATCH');
  const { version } = draft(repo); repo.validate(version.id); repo.publish(version.id, { can: can('analysis.publish'), reason: 'r', expectedCurrentVersionId: null }, def);
  const client = V.readModel(repo, def.id, { mode: 'client', latestSources: src(), def }), tech = V.readModel(repo, def.id, { mode: 'technical', latestSources: src(), def });
  deq(client, { available: true, stale: false, note: null });
  assert.equal(tech.versionId, version.id); assert.equal(tech.currentness, 'CURRENT_INPUTS'); assert.equal(tech.reproducibility, 'PARTIAL');
  const doc2 = { ...DOC, inputVersion: 'm9' }; assert.equal(V.readModel(repo, def.id, { mode: 'broker', latestSources: src({ inputDoc: doc2 }), def }).stale, true);
});
test('invariants: versioning never changes scores, classes, rankings, lots or prices', () => {
  const again = App.intelligence.analyzeDevelopment(DOC.lots, { methodology: App.methodology.compiled(cfg) });
  deq(again.results.map(r => [r.scores, r.class, r.rankings]), direct.results.map(r => [r.scores, r.class, r.rankings]));
  deq(lots.map(l => App.domain.serializeLot(l)), beforeLots);
  assert.equal(dev.priceTables[0].pricePerM2, 1196);
});
