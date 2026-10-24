'use strict';
// Topic 54 — preservation of the current strengths and non-regression.
// 1) CapabilityPreservationRegistry (config/governance/capabilities.json) is valid and every P0/P1 capability points to
//    golden categories / test files that exist; 2) the golden baseline (tests/golden/*.golden.json) is re-captured from the
//    real modules over the Viva Juara dataset and ANY drift fails, unless covered by a human-approved ParityException;
//    3) the golden files themselves are integrity-checked against baseline.json; 4) the snapshot is deterministic.
// To accept an intended change: register the exception (approvedBy/approvedAt/reason/pathPattern/evidence) in
// capabilities.json → parityExceptions, or re-capture with `node scripts/goldenBaseline.js --update` and record why in
// docs/LEGACY_PARITY_EXCEPTIONS.md. Never re-capture to make a red test green without that record.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const G = require('../scripts/governanceSources.js');
const GB = require('../scripts/goldenBaseline.js');
const C = G.mod('capabilityRegistry.js');

const REG = G.cfg('capabilities');
const TEST_FILES = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js'));
let App, current, base;
test.before(async () => { ({ App, snapshot: current } = await GB.captureCurrent()); base = GB.readBaseline(); });

test('registry: CapabilityPreservationRegistry is valid; golden/test references exist', () => {
  const v = C.validate(REG, { goldenCategories: [...App.governance.golden.CATEGORIES], testFiles: TEST_FILES });
  assert.deepEqual(v.errors, []);
});

test('registry: the P0 set covers what topic 54 §268 says can never regress', () => {
  const p0 = new Set(C.byPriority(REG).P0);
  for (const id of ['CAP-02-498-LOTES', 'CAP-03-SELECAO', 'CAP-09-QUICKVIEW', 'CAP-16-FINANCEIRO', 'CAP-26-DISPONIBILIDADE', 'CAP-27-PRECO', 'CAP-28-ALERTAS', 'CAP-13-SCORES']) assert.ok(p0.has(id), id);
  assert.ok(REG.capabilities.length >= 25, 'as 25 forças do tópico 54 + invariantes de dado');
  // every strength names where it lives today; each location's first token is a real file or folder of plat/src
  for (const c of REG.capabilities) for (const loc of c.currentLocation) {
    const f = loc.split(' ')[0].replace(/\*$/, '');
    assert.ok(fs.existsSync(path.join(G.SRC, f)) || fs.existsSync(path.join(G.ROOT, f)), `${c.capabilityId}: ${f} não existe`);
  }
});

test('golden files: integrity of tests/golden against baseline.json (a hand-edited fixture is detected)', () => {
  assert.equal(base.meta.lotCount, 498);
  for (const c of App.governance.golden.CATEGORIES) assert.equal(App.governance.golden.fingerprint(base.categories[c]), base.meta.categoryFingerprints[c], `tests/golden/${c}.golden.json foi alterado fora do script`);
});

for (const cat of ['dataset', 'lots', 'map', 'layers', 'filters', 'recommendations', 'finance', 'solar', 'quickview', 'share', 'comparison', 'search', 'texts']) {
  test(`golden ${cat}: no drift from the recorded baseline`, t => {
    const drifts = App.governance.golden.diff(base.categories[cat], current.categories[cat], '$.' + cat);
    const { blocking, excepted } = App.governance.golden.applyExceptions(drifts, REG.parityExceptions);
    for (const e of excepted) t.diagnostic(`exceção aprovada ${e.exception}: ${e.path}`);
    assert.deepEqual(blocking.slice(0, 20).map(d => `${d.path}: ${JSON.stringify(d.expected)} → ${JSON.stringify(d.actual)}`), [], `${blocking.length} diferença(s) em ${cat}`);
  });
}

test('golden invariants (Viva Juara fixture): 498 lots, unique ids, every status UNKNOWN except the 21 developer lots (UNAVAILABLE), never offerable, R$ 1.196/m², every anchor hits its own lot', () => {
  const d = current.categories.dataset, f = current.categories.filters, r = current.categories.recommendations, m = current.categories.map;
  assert.equal(d.lotCount, 498); assert.equal(d.uniqueIds, 498); assert.equal(m.featureCount, 498);
  assert.deepEqual(d.availabilityStatusCounts, { UNKNOWN: 477, UNAVAILABLE: 21 });
  assert.equal(f['status-available'].count, 0, 'UNKNOWN nunca vira AVAILABLE');
  assert.equal(f['only-offerable'].count, 0);
  for (const id of ['privacy', 'privacy-solar-quiet', 'green']) assert.equal(r.engine[id].recommended, 0, 'sem lote disponível confirmado, nada é recomendado');
  for (const p of Object.values(r.legacyPresets)) assert.equal(p.commercialCount, 0);
  assert.deepEqual(d.pricePerM2Values, [1196]); assert.deepEqual(d.priceTableVersions, ['2026-10-06']); assert.equal(d.nullPriceCount, 0);
  assert.deepEqual(m.anchorHitMismatches, []);
  for (const l of Object.values(current.categories.lots)) assert.equal(Math.round(l.geometry.areaM2 * 1196 * 100) / 100, Math.round(l.commercial.price * 100) / 100, l.code);
});

test('golden: share text never claims "Disponível" for an unconfirmed status and keeps the uncertainty footer', () => {
  for (const [k, s] of Object.entries(current.categories.share)) {
    assert.ok(!/\nDisponível\n/.test(s.text), k);
    assert.match(s.text, /Disponibilidade sujeita a confirmação/, k);
    assert.ok(s.text.includes(current.categories.texts['share.footer']), k);
    if (k.endsWith(':client')) assert.doesNotMatch(s.text, /Score Moradia/, k);
  }
});

test('golden: capture is deterministic (same fingerprints on a second run with a fresh harness)', async () => {
  const again = (await GB.captureCurrent()).snapshot;
  assert.deepEqual(again.meta.categoryFingerprints, current.meta.categoryFingerprints);
});

test('golden: the comparison is not vacuous — a changed price, colour, filter result or text is reported with its path', () => {
  const g = App.governance.golden, clone = x => JSON.parse(JSON.stringify(x));
  const lots = clone(current.categories.lots); lots.A1.commercial.price += 0.01;
  assert.deepEqual(g.diff(current.categories.lots, lots, '$.lots').map(d => d.path), ['$.lots.A1.commercial.price']);
  const layers = clone(current.categories.layers); const c0 = Object.keys(layers.class.lotsByColor)[0]; layers.class.lotsByColor[c0].pop();
  assert.ok(g.diff(current.categories.layers, layers).some(d => d.path.includes('lotsByColor')));
  const share = clone(current.categories.share); const k = Object.keys(share)[0]; share[k].text = share[k].text.replace('IGP-M', 'IPCA');
  assert.equal(g.diff(current.categories.share, share).length, 1);
  // an approved exception only covers its own path pattern
  const ex = [{ capabilityId: 'CAP-27-PRECO', reason: 'DATA_CORRECTION', approvedBy: 'teste', approvedAt: '2026-10-11', pathPattern: '^\\$\\.lots\\.A1\\.commercial\\.price$', evidenceRefs: ['x'] }];
  const res = g.applyExceptions(g.diff(current.categories.lots, lots, '$.lots'), ex);
  assert.equal(res.blocking.length, 0); assert.equal(res.excepted.length, 1);
  assert.equal(g.applyExceptions(g.diff(current.categories.lots, lots, '$.lots'), [{ ...ex[0], approvedBy: null }]).blocking.length, 1, 'exceção sem aprovação não vale');
});

test('cutover gate: P0 needs green tests, zero golden drift (or approved exception) and a migration signoff', () => {
  assert.deepEqual(C.cutoverGate(REG, 'CAP-16-FINANCEIRO', { testsPassing: true, goldenDrift: 0 }).blockers, ['P0_REQUIRES_MIGRATION_SIGNOFF']);
  assert.equal(C.cutoverGate(REG, 'CAP-16-FINANCEIRO', { testsPassing: true, goldenDrift: 0, signoff: { by: 'produto', at: '2026-10-11' } }).allowed, true);
  assert.ok(C.cutoverGate(REG, 'CAP-16-FINANCEIRO', { testsPassing: true, goldenDrift: 3, signoff: { by: 'x', at: 'y' } }).blockers.includes('GOLDEN_DRIFT_WITHOUT_APPROVED_EXCEPTION'));
  assert.ok(C.cutoverGate(REG, 'CAP-07-LAYERS', { testsPassing: true, goldenDrift: null }).blockers.includes('GOLDEN_NOT_RUN'));
  assert.deepEqual(C.touchedBy(REG, ['services/finance.js']).map(c => c.capabilityId), ['CAP-16-FINANCEIRO']);
});
