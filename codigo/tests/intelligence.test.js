'use strict';
// IntelligenceEngine (topic 12) and configurable methodology (topic 13): golden parity with the published
// analysis, determinism, batch/single consistency, missing data, config validation, diff, impact and lifecycle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, DATA, SRC } = require('./harness.js');

const RAW = JSON.parse(fs.readFileSync(path.join(DATA, 'lots.json'), 'utf8'));
const INPUT = JSON.parse(fs.readFileSync(path.join(DATA, 'analysis-input.json'), 'utf8'));
const clone = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
const deq = (a, b, m) => assert.deepEqual(clone(a), clone(b), m); // values cross the vm realm
let App, cfg, comp, out, repo, byId;
test.before(async () => {
  App = load();
  cfg = App.methodology.current('viva-juara');
  comp = App.methodology.compile(cfg);
  out = App.intelligence.analyzeDevelopment(INPUT.lots, { methodology: comp, inputVersion: INPUT.inputVersion });
  repo = App.repos.LotRepository('viva-juara'); await repo.load();
  byId = new Map(repo.lotsSync().map(l => [l.identity.id, l]));
});

test('golden: engine reproduces all 45 analysis fields of the 498 published lots (zero diff)', () => {
  const p = App.analysisText.parity(out.results, INPUT.lots, RAW);
  assert.equal(p.lots, 498);
  deq(p.diffs.slice(0, 5), []);
  assert.equal(p.identical, 498);
});

test('parity with the canonical lots: scores, class, rankings, highlights and alert types', () => {
  for (const r of out.results) {
    const l = byId.get(r.lotId);
    for (const k of ['housing', 'investment', 'family', 'premium', 'overall']) assert.equal(r.scores[k], l.intelligence.scores[k], `${r.code} ${k}`);
    assert.equal(r.class, l.intelligence.class, r.code);
    deq(clone(r.rankings), clone(l.intelligence.rankings), r.code);
    deq(r.highlights.map(h => h.type), l.intelligence.highlights.map(h => h.type), r.code);
    const sorted = App.rules.sortAlerts(r.alerts); // the canonical lot orders alerts by severity; the engine keeps rule order
    deq(sorted.map(a => a.type), l.intelligence.alerts.map(a => a.type), r.code);
    deq(sorted.map(a => a.severity), l.intelligence.alerts.map(a => a.severity), r.code);
  }
});

test('class distribution follows the percentile bands (A+ 5%, A 20%, B 40%, C 25%, D 10%)', () => {
  deq(clone(out.report.classes), { A_PLUS: 25, A: 100, B: 199, C: 125, D: 49 });
  assert.equal(out.report.errors, 0);
  deq(clone(out.report.status), { COMPLETE: 498 });
});

test('determinism and order independence: same input, same output, whatever the order', () => {
  const again = App.intelligence.analyzeDevelopment(INPUT.lots, { methodology: comp, inputVersion: INPUT.inputVersion });
  assert.equal(JSON.stringify(again.results), JSON.stringify(out.results));
  const shuffled = INPUT.lots.slice().reverse(); [shuffled[3], shuffled[200]] = [shuffled[200], shuffled[3]];
  const s = App.intelligence.analyzeDevelopment(shuffled, { methodology: comp, inputVersion: INPUT.inputVersion });
  assert.equal(JSON.stringify(s.results), JSON.stringify(out.results));
});

test('batch vs single: analyzeLot against the development reference gives the same class and rankings', () => {
  for (const i of INPUT.lots.filter((x, k) => k % 7 === 0)) {
    const one = App.intelligence.analyzeLot(i, { methodology: comp, reference: out.reference, inputVersion: INPUT.inputVersion });
    const b = out.results.find(r => r.lotId === i.lotId);
    assert.equal(one.class, b.class, i.code); deq(clone(one.rankings), clone(b.rankings), i.code);
    deq(clone(one.scores), clone(b.scores));
  }
  const alone = App.intelligence.analyzeLot(INPUT.lots[0], { methodology: comp });
  assert.equal(alone.class, 'UNKNOWN');
  assert.ok(alone.diagnostics.some(d => d.code === 'REQUIRES_DEVELOPMENT_CONTEXT'));
  assert.equal(alone.provenance.phase2, 'NOT_RUN');
});

test('missing data: never turned into 0; score blocked, status PARTIAL, missing input listed', () => {
  const i = clone(INPUT.lots[10]); i.environmental.frontBearingDeg = null;
  const r = App.intelligence.analyzeLot(i, { methodology: comp });
  assert.equal(r.notes.solar, null);
  assert.equal(r.scores.housing, null); assert.equal(r.scores.overall, null);
  assert.equal(r.criteriaResults.housing.status, 'INSUFFICIENT_DATA');
  assert.equal(r.status, 'PARTIAL');
  assert.ok(r.missingInputs.includes('environmental.frontBearingDeg'));
  assert.notEqual(r.notes.quiet, null, 'other criteria still computed');
  const j = clone(INPUT.lots[11]); j.geometry.areaM2 = null;
  const rj = App.intelligence.analyzeLot(j, { methodology: comp });
  assert.ok(rj.alerts.some(a => a.type === 'MISSING_AREA'));
  assert.ok(rj.criteriaTrace.liquidity.some(s => s.reason === 'DECLARED_MISSING_VALUE'), 'the declared 6,5 for unknown area is traced');
});

test('results are JSON-safe: no NaN, no Infinity, frozen, inputs not mutated', () => {
  const s = JSON.stringify(out.results);
  assert.ok(!/NaN|Infinity/.test(s));
  const frozen = App.domain.deepFreeze(clone(INPUT.lots.slice(0, 20)));
  assert.doesNotThrow(() => App.intelligence.analyzeDevelopment(frozen, { methodology: comp }));
  assert.ok(Object.isFrozen(out.results[0]) && Object.isFrozen(out.results[0].scores));
  assert.throws(() => App.intelligence.analyzeDevelopment([INPUT.lots[0], INPUT.lots[0]], { methodology: comp }), e => e.code === 'DUPLICATE_LOT');
  assert.throws(() => App.intelligence.analyzeLot(INPUT.lots[0], {}), e => e.code === 'MISSING_METHODOLOGY');
});

test('provenance and versions on every result', () => {
  const r = out.results[0];
  assert.equal(r.methodologyVersion, '1.0.0'); assert.equal(r.analysisVersion, `1.0.0+${comp.checksum}`);
  assert.equal(r.provenance.inputVersion, INPUT.inputVersion); assert.match(r.provenance.inputChecksum, /^[0-9a-f]{8}$/);
  assert.equal(r.generatedAt, null, 'the engine never reads the clock');
});

test('explanations: contributions add up to the unrounded score', () => {
  for (const r of out.results.slice(0, 50)) for (const c of Object.values(r.criteriaResults)) {
    const sum = c.criteria.reduce((a, x) => a + x.contribution, 0);
    assert.ok(Math.abs(sum - c.raw) < 1e-9, `${r.code} ${c.scoreId}`);
    assert.equal(c.coverage, 1);
  }
});

test('module pipeline: dependency order is valid, criteria graph has no cycles', () => {
  deq(App.intelligence.moduleOrder().slice(-2), ['classification', 'ranking']);
  deq(comp.criteria.map(c => c.id).indexOf('liquidity') > comp.criteria.map(c => c.id).indexOf('quiet'), true);
});

// ---------------------------------------------------------------- shared math & normalizers
test('shared math reproduces Python semantics', () => {
  const M = App.imath;
  assert.equal(M.roundHalfEven(2.5), 2); assert.equal(M.roundHalfEven(3.5), 4); assert.ok(M.roundHalfEven(-0.5) === 0); assert.equal(M.roundHalfEven(68.50000001), 69);
  assert.equal(M.toFixedPy(0.125, 2), '0.12'); assert.equal(M.toFixedPy(8.25, 1), '8.2'); assert.equal(M.toFixedPy(8.75, 1), '8.8'); assert.equal(M.toFixedPy(24.5, 0), '24');
  assert.equal(M.pyMod(-10, 360), 350); assert.equal(M.angDiff(350, 10), 20); assert.equal(M.sector(359, ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']), 'N');
  const r = M.competitionRank([{ key: 'a', value: 9 }, { key: 'b', value: 9 }, { key: 'c', value: 7 }, { key: 'd', value: null }]);
  deq([r.get('a').position, r.get('b').position, r.get('c').position, r.has('d')], [1, 1, 3, false]);
});

test('normalizers: threshold applies only the first band; unknown enum is reported, never guessed', () => {
  const N = App.inormalize, read = o => k => o[k] ?? null;
  const th = N.get('THRESHOLD').run(10, { input: 'd', bands: [{ lt: 50, delta: -4 }, { lt: 100, delta: -3 }] }, read({ d: 20 }));
  assert.equal(th.value, 6);
  assert.equal(N.get('THRESHOLD').run(10, { input: 'd', bands: [{ lt: 50, delta: -4 }] }, read({ d: 80 })).value, 10);
  deq(N.get('THRESHOLD').run(10, { input: 'd', bands: [] }, read({})).missing, ['d']);
  assert.ok(N.get('ENUM_MAPPING').run(null, { input: 't', map: { LOW: 8 } }, read({ t: 'ODD' })).unknownEnum);
  assert.equal(N.get('LINEAR').run(null, { input: 'r', from: 10, drop: 7, start: 150, span: 850 }, read({ r: 1000 })).value, 3);
  assert.equal(N.get('CAP').run(12, { min: 0, max: 10 }).value, 10);
  assert.equal(N.get('COSINE_ORIENTATION').run(null, { input: 'b', targetDeg: 20, base: 3, amplitude: 7 }, read({ b: 20 })).value, 10);
  assert.equal(N.get('PIECEWISE_VALUE').run(null, { input: 'a', missing: 6.5, pieces: [{ lte: 300, value: 8 }] }, read({})).value, 6.5);
  assert.equal(N.has('EVAL'), false);
});

test('no dynamic code: intelligence modules never use eval or Function', () => {
  for (const f of fs.readdirSync(path.join(SRC, 'intelligence'))) {
    const s = fs.readFileSync(path.join(SRC, 'intelligence', f), 'utf8');
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(s), f);
  }
});

// ---------------------------------------------------------------- config validation
const bad = (mut, code) => { const c = clone(cfg); mut(c); const v = App.methodology.validate(c); assert.equal(v.ok, false, code); assert.ok(v.errors.some(e => e.code === code), `${code}: ${JSON.stringify(v.errors)}`); };
test('config validation rejects invalid methodologies', () => {
  bad(c => { c.criteria[0].steps[0].op = 'EVAL'; }, 'UNKNOWN_NORMALIZER');
  bad(c => { c.scores[0].criteria[0].weight = -0.25; }, 'NEGATIVE_WEIGHT');
  bad(c => { c.scores[0].criteria[0].weight = 0.3; }, 'WEIGHT_SUM');
  bad(c => { c.criteria[1].steps[1].bands.reverse(); }, 'THRESHOLD_ORDER');
  bad(c => { c.scores[0].criteria[0].criterion = 'nope'; }, 'UNKNOWN_CRITERION');
  bad(c => { c.criteria[0].fieldKey = 'x.y'; }, 'UNKNOWN_FIELD_KEY');
  bad(c => { c.classification.bands[4].below = 1; }, 'CLASS_BOUNDARY');
  bad(c => { c.criteria.find(x => x.id === 'solar').steps.push({ op: 'WEIGHTED_SUM', terms: [{ input: 'liquidity', weight: 1 }] }); }, 'CYCLE');
  bad(c => { c.criteria[0].steps[0].input = 'location.unknown'; }, 'UNKNOWN_INPUT');
  bad(c => { c.status = 'LIVE'; }, 'INVALID_STATUS');
  bad(c => { c.scores[0].missingPolicy = 'USE_DEFAULT'; }, 'INVALID_MISSING_POLICY');
  bad(c => { c.lotAdjustments[0].reason = ''; }, 'MISSING_REASON');
  assert.throws(() => App.methodology.compile({ ...clone(cfg), criteria: [] }), e => e.code === 'INVALID_CONFIG');
});

test('checksum is stable and changes with any parameter', () => {
  const a = App.methodology.checksum(cfg), c = clone(cfg);
  assert.equal(App.methodology.checksum(clone(cfg)), a);
  c.scores[0].criteria[0].weight = 0.26; assert.notEqual(App.methodology.checksum(c), a);
});

test('diff names what changed by id (weights, thresholds, criteria added)', () => {
  const c = clone(cfg);
  c.scores[0].criteria[0].weight = 0.3; c.scores[0].criteria[1].weight = 0.15;
  c.criteria.find(x => x.id === 'quiet').steps[1].bands[0].lt = 60;
  c.criteria.push({ id: 'extra', label: 'x', steps: [{ op: 'FIXED_SCALE', value: 5 }] });
  const d = App.methodology.diff(cfg, c);
  assert.ok(d.some(x => x.kind === 'WEIGHT_CHANGED' && x.path === 'scores[housing].criteria[quiet].weight' && x.from === 0.25 && x.to === 0.3));
  assert.ok(d.some(x => x.kind === 'THRESHOLD_CHANGED' && /criteria\[quiet\]/.test(x.path)));
  assert.ok(d.some(x => x.kind === 'CRITERION_ADDED' && x.path === 'criteria[extra]'));
  deq(App.methodology.diff(cfg, clone(cfg)), []);
});

test('diff sees a lot adjustment change (adjustments share a criterion)', () => {
  const c = clone(cfg); c.lotAdjustments[0].delta = -2;
  const d = App.methodology.diff(cfg, c);
  assert.ok(d.length >= 1 && d.some(x => /N8/.test(x.path) || x.from === -1 && x.to === -2), JSON.stringify(d));
});

test('impact report: identical config changes nothing; a weight change is measured before publishing', () => {
  const same = App.methodology.impact(cfg, clone(cfg), INPUT.lots);
  assert.equal(same.changedLots, 0); assert.equal(same.massChange, false);
  const c = clone(cfg); c.methodologyVersion = '1.1.0'; c.status = 'DRAFT';
  c.scores[0].criteria[0].weight = 0.35; c.scores[0].criteria[1].weight = 0.1;
  const imp = App.methodology.impact(cfg, c, INPUT.lots);
  assert.ok(imp.scores.housing.changed > 0);
  assert.ok(imp.changedLots > 0 && imp.configDiff.length === 4);
  assert.equal(Object.values(imp.classDistribution.candidate).reduce((a, b) => a + b, 0), 498);
});

test('lifecycle: published configs are immutable; rollback keeps the newer version', () => {
  const reg = App.methodology.registry([cfg]);
  assert.equal(reg.current().methodologyVersion, '1.0.0');
  assert.throws(() => reg.update('1.0.0', { changeReason: 'x' }), e => e.code === 'PUBLISHED_IMMUTABLE');
  assert.throws(() => reg.add(clone(cfg)), e => e.code === 'PUBLISHED_IMMUTABLE');
  const draft = clone(cfg); draft.methodologyVersion = '1.1.0'; draft.status = 'DRAFT'; delete draft.publishedAt;
  reg.add(draft);
  assert.throws(() => reg.publish('1.1.0'), e => e.code === 'INVALID_TRANSITION');
  reg.markValidated('1.1.0'); reg.publish('1.1.0', { reason: 'teste', at: '2026-10-07T00:00:00Z' });
  assert.equal(reg.current().methodologyVersion, '1.1.0');
  assert.throws(() => reg.update('1.1.0', {}), e => e.code === 'PUBLISHED_IMMUTABLE');
  reg.setCurrent('1.0.0', { reason: 'rollback' });
  assert.equal(reg.current().methodologyVersion, '1.0.0');
  assert.equal(reg.get('1.1.0').status, 'PUBLISHED', 'rollback does not delete the newer version');
  assert.throws(() => reg.archive('1.0.0'), e => e.code === 'INVALID_TRANSITION');
  assert.equal(reg.archive('1.1.0').status, 'ARCHIVED');
  deq(reg.audit().map(a => a.action), ['ADD', 'ADD', 'VALIDATE', 'PUBLISH', 'SET_CURRENT', 'ARCHIVE']);
});

// ---------------------------------------------------------------- missing-data policy and the config bundle
test('ZERO_CONTRIBUTION is rejected unless every criterion of the score carries a justification', () => {
  const c = clone(cfg); c.scores[0].missingPolicy = 'ZERO_CONTRIBUTION';
  const v = App.methodology.validate(c); assert.equal(v.ok, false);
  assert.equal(v.errors.filter(e => e.code === 'MISSING_JUSTIFICATION').length, c.scores[0].criteria.length);
  c.scores[0].criteria.forEach((x, i) => { if (i % 2) x.justification = 'ausência medida como zero por norma do loteamento'; else c.criteria.find(k => k.id === x.criterion).justification = 'dado obrigatório em projeto aprovado'; });
  assert.equal(App.methodology.validate(c).ok, true, 'justification on the score entry or on the criterion');
  c.scores[0].criteria[0].justification = '   '; c.criteria.find(k => k.id === c.scores[0].criteria[0].criterion).justification = '';
  assert.ok(App.methodology.validate(c).errors.some(e => e.code === 'MISSING_JUSTIFICATION'), 'blank text is no justification');
  assert.equal(App.methodology.validate(cfg).ok, true, 'the published config (BLOCK_SCORE) is unaffected');
});
test('config bundle: N.N.json and N.N.N.json versions; current.json must point to a file with the same methodologyVersion', () => {
  const os = require('os'), B = require('../scripts/configBundle.js');
  assert.equal(B.validate().ok, true);
  const mk = (files, current) => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgb-')), d = path.join(root, 'scoring', 'dev'); fs.mkdirSync(d, { recursive: true });
    for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(d, f), JSON.stringify({ ...clone(cfg), methodologyVersion: v }));
    fs.writeFileSync(path.join(d, 'current.json'), JSON.stringify(current)); return root; };
  const ok = mk({ '1.0.json': '1.0.0', '1.1.2.json': '1.1.2' }, { current: '1.1.2.json', methodologyVersion: '1.1.2' });
  const read = B.read(ok); assert.deepEqual(Object.keys(read.scoring.dev.versions).sort(), ['1.0.json', '1.1.2.json']); assert.equal(read.scoring.dev.current, '1.1.2.json');
  const codes = root => B.validate(root).errors.map(e => e.code);
  assert.deepEqual(codes(mk({ '1.1.2.json': '1.1.2' }, { current: '1.1.2.json', methodologyVersion: '1.1.3' })), ['CURRENT_VERSION_MISMATCH']);
  assert.deepEqual(codes(mk({ '1.1.2.json': '1.1.2' }, { current: '2.0.json', methodologyVersion: '2.0.0' })), ['CURRENT_NOT_FOUND']);
  assert.deepEqual(codes(mk({ '1.1.2.json': '1.1.2' }, { current: '1.1.2.json' })), ['CURRENT_VERSION_MISSING']);
  assert.deepEqual(codes(mk({ '1.2.json': '1.3.0' }, { current: '1.2.json', methodologyVersion: '1.3.0' })), ['VERSION_FILE_MISMATCH']);
  assert.throws(() => B.read(mk({ '1.1.2.json': '1.1.2' }, { current: '1.1.2.json', methodologyVersion: '9.9.9' })), e => e.code === 'INVALID_CONFIG_BUNDLE');
});
