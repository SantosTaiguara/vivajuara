'use strict';
// Regression against the legacy dashboard: every one of the 498 composed canonical lots is compared with the raw
// lots.json record; finance is compared with the legacy dashboard's own payment code (dash/index_v1.html);
// Field Registry completeness and the legacy field mapping.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { load, DATA } = require('./harness.js');

const plain = x => JSON.parse(JSON.stringify(x));
const RAW = JSON.parse(fs.readFileSync(path.join(DATA, 'lots.json'), 'utf8'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));
const COMMERCIAL = JSON.parse(fs.readFileSync(path.join(DATA, 'commercial.json'), 'utf8'));

/** The legacy dashboard's price constant and payment plans, executed from its own source (not re-typed here). */
function legacyFinance() {
  const html = fs.readFileSync(path.join(DATA, 'index_v1.html'), 'utf8');
  const consts = html.match(/const PM2 = [\s\S]*?let PVA = 0;[^\n]*\n/);
  const plans = html.match(/function plans\(l,pct\)\{[\s\S]*?\n\}\n/);
  assert.ok(consts && plans, 'legacy finance code found in index_v1.html');
  const ctx = { Math, brl2: v => String(v) };
  vm.createContext(ctx);
  vm.runInContext(`${consts[0]}\n${plans[0]}\nthis.PM2 = PM2; this.plans = plans;`, ctx);
  return { PM2: ctx.PM2, plans: ctx.plans };
}
const LEG = legacyFinance();

const MAP = {
  cls: { 'A+': 'A_PLUS', A: 'A', B: 'B', C: 'C', D: 'D' }
};
const DISTANCES = { dport: 'location.distanceToGateLinearM', dclube: 'location.distanceToClubLinearM', dpark: 'location.distanceToGreenAreaM', dplay: 'location.distanceToPlaygroundM',
  dpraca: 'location.distanceToSquareM', dav: 'location.distanceToExternalRoadM', deeeb: 'location.distanceToTechnicalAreaM', rport: 'mobility.routeDistanceToGateM', rclube: 'mobility.routeDistanceToLeisureM' };
const SCORES = { sm: 'housing', si: 'investment', sf: 'family', sp: 'premium', sg: 'overall' };
const NOTES = { priv: 'environmental.privacyScore', sil: 'environmental.quietScore', sol: 'environmental.solarScore', vista: 'environmental.viewScore', geo: 'geometry.usableGeometryScore',
  laz: 'intelligence.notes.leisure', port: 'intelligence.notes.gate', flux: 'intelligence.notes.lowTraffic', liq: 'intelligence.notes.liquidity', val: 'intelligence.notes.relativeValue', pq: 'intelligence.notes.priceQuality' };

let App, repo, byCode;
test.before(async () => {
  App = load();
  repo = App.repos.LotRepository('viva-juara');
  await repo.load();
  byCode = new Map(repo.lotsSync().map(l => [l.identity.code, l]));
});

// ------------------------------------------------------------------ dataset-level invariants
test('dataset: 498 lots, one canonical lot per legacy record (same codes and ids)', () => {
  assert.equal(RAW.length, 498);
  assert.equal(repo.lotsSync().length, 498);
  assert.equal(MANIFEST.lotCount, 498);
  assert.deepEqual([...byCode.keys()].sort(), RAW.map(r => r.id).sort());
  for (const r of RAW) assert.equal(byCode.get(r.id).identity.id, r.did, r.id);
});

test('checksums: FNV-1a of the static and analysis snapshots match the published manifest', () => {
  const cs = App.offline.checksum(repo.getLayers().static.lots), ca = App.offline.checksum(repo.getLayers().analysis.lots);
  assert.equal(cs, MANIFEST.checksums.static);
  assert.equal(ca, MANIFEST.checksums.analysis);
  assert.equal(repo.getLayers().static.staticDataVersion, MANIFEST.staticVersion);
  assert.equal(repo.getLayers().analysis.analysisVersion, MANIFEST.analysisVersion);
  assert.equal(repo.getLayers().commercial.priceTableVersion, MANIFEST.priceTableVersion);
  assert.equal(repo.getLayers().commercial.revision, MANIFEST.commercialRevision);
  // and the build function produces the same manifest checksums
  const m = App.offline.buildManifest({ dev: App.config.DEVELOPMENTS[0], layers: repo.getLayers(), assets: [], appVersion: 'test', generatedAt: 'x' });
  assert.deepEqual(plain(m.checksums), MANIFEST.checksums);
  assert.equal(m.lotCount, 498);
});

test('price table: config, published commercial.json and the legacy dashboard agree (R$ 1.196/m², entrada 12%)', () => {
  const cfg = App.config.DEVELOPMENTS[0].priceTables[0], pub = COMMERCIAL.priceTables.find(t => t.id === COMMERCIAL.currentPriceTableId);
  assert.equal(LEG.PM2, 1196);
  assert.equal(cfg.pricePerM2, LEG.PM2);
  assert.equal(pub.pricePerM2, LEG.PM2);
  assert.equal(cfg.downPaymentDefault, 0.12);
  assert.equal(pub.downPaymentDefault, 0.12);
  assert.deepEqual(plain(cfg.plans.map(p => p.id)), ['P144', 'P144A', 'I18', 'I36']);
  for (const p of cfg.plans) {
    const q = pub.plans.find(x => x.id === p.id);
    for (const k of ['kind', 'months', 'rate', 'discount', 'annualCount', 'firstAnnualMonth']) assert.equal(q[k], p[k], `${p.id}.${k}`);
    if (p.monthlyShare != null) assert.ok(Math.abs(q.monthlyShare - p.monthlyShare) < 1e-12);
  }
  const P = Object.fromEntries(cfg.plans.map(p => [p.id, p]));
  assert.equal(P.P144.rate, 0.008); assert.equal(P.P144.months, 144);
  assert.equal(P.I18.discount, 0.10); assert.equal(P.I36.discount, 0.05);
});

// ------------------------------------------------------------------ per-lot comparison, all 498 lots
test('every lot: area, price = area × 1196, down payment, pricePerM2 equal the legacy values', () => {
  for (const r of RAW) {
    const l = byCode.get(r.id), c = l.commercial;
    assert.equal(l.geometry.areaM2, r.a, r.id);
    const legacyPrice = r.a * LEG.PM2;
    assert.equal(c.price, Math.round(legacyPrice * 100) / 100, `${r.id} price`);
    assert.ok(Math.abs(c.price - legacyPrice) < 0.005, `${r.id} price ≈ legacy`);
    assert.equal(c.pricePerM2, 1196);
    assert.equal(c.currency, 'BRL');
    assert.equal(c.downPaymentDefaultPercent, 12);
    assert.ok(Math.abs(c.downPaymentDefaultValue - legacyPrice * 0.12) < 0.01, `${r.id} entrada`);
    assert.deepEqual(plain(c.availablePlans), ['P144', 'P144A', 'I18', 'I36']);
  }
});

test('every lot: scores, class, notes and liquidity equal the legacy analysis', () => {
  for (const r of RAW) {
    const l = byCode.get(r.id);
    for (const [k, s] of Object.entries(SCORES)) assert.equal(l.intelligence.scores[s], r[k], `${r.id} ${k}`);
    assert.equal(l.intelligence.class, MAP.cls[r.cl], `${r.id} cl`);
    for (const [k, key] of Object.entries(NOTES)) assert.equal(App.model.get(l, key), r.nt[k], `${r.id} nt.${k}`);
    assert.equal(App.i18n.L.LevelF[l.intelligence.liquidity], r.liq, `${r.id} liq`);
    assert.equal(App.i18n.L.Level[l.environmental.noiseLevel], r.ruido, `${r.id} ruido`);
    assert.equal(App.i18n.L.LevelF[l.environmental.privacyLevel], r.priv, `${r.id} priv`);
  }
});

test('class distribution and score ordering are preserved', () => {
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const legacy = count(RAW, r => MAP.cls[r.cl]), now = count(repo.lotsSync(), l => l.intelligence.class);
  assert.deepEqual(plain(now), legacy);
  // rankings derived from the same scores: the best housing lot in legacy is ranked 1
  const best = RAW.reduce((a, b) => (b.sm > a.sm ? b : a));
  assert.equal(byCode.get(best.id).intelligence.rankings.find(x => x.type === 'HOUSING').position, 1);
});

test('every lot: alerts carry the same title and message as the legacy text (no alert lost or invented)', () => {
  const T = App.legacy.MAP.alert;
  for (const r of RAW) {
    const l = byCode.get(r.id), al = r.al || [];
    assert.equal(l.intelligence.alerts.length, al.length, r.id);
    const rebuilt = plain(l.intelligence.alerts.map(a => `ATENÇÃO — ${a.title}: ${a.message}`)).sort();
    assert.deepEqual(rebuilt, al.slice().sort(), r.id);
    for (const a of l.intelligence.alerts) {
      assert.equal(a.type, T[a.title], `${r.id} ${a.title}`);
      assert.equal(a.severity, App.rules.ALERTS[a.type].severity);
    }
    assert.equal(l.construction.nonBuildableRearToConfirm, al.some(s => /RESTRIÇÃO CONSTRUTIVA/.test(s)), r.id);
    assert.equal(l.construction.easements.length, al.filter(s => /SERVIDÃO/.test(s)).length, r.id);
  }
});

test('every lot: distances, routes, coordinates and measurements equal the legacy values', () => {
  for (const r of RAW) {
    const l = byCode.get(r.id);
    for (const [k, key] of Object.entries(DISTANCES)) assert.equal(App.model.get(l, key), r[k], `${r.id} ${k}`);
    assert.equal(l.location.latitude, r.lat);
    assert.equal(l.location.longitude, r.lon);
    assert.equal(l.mobility.vehiclesPassingEstimate, r.flow);
    assert.equal(l.environmental.frontBearingDeg, r.az);
    assert.equal(l.geometry.frontM, r.fr != null ? r.fr : r.wf, `${r.id} fr`);
    assert.equal(l.geometry.frontBoxWidthM, r.wf);
    assert.equal(l.geometry.rearM, r.wb);
    assert.equal(l.geometry.averageDepthM, r.dp);
    assert.equal(l.geometry.leftDepthM, r.sideE);
    assert.equal(l.geometry.rightDepthM, r.sideD);
    assert.equal(l.geometry.frontEdgesM, r.edgeF);
    assert.equal(l.geometry.rearEdgesM, r.edgeB);
    assert.deepEqual(plain(l.geometry.polygon), r.p, `${r.id} polygon`);
    assert.equal(l.surroundings.hasGreenRear, r.mata === 'Sim');
    assert.equal(l.surroundings.sewageStationNearby, r.deeeb < 40);
    assert.equal(l.mobility.nearMainAccess, r.rport < 200);
    assert.equal(l.identity.blockId, r.q);
    assert.equal(l.identity.lotNumber, r.n);
  }
});

test('every lot: centroid is inside the polygon bounds (replaces the legacy vertex mean "c")', () => {
  for (const r of RAW) {
    const g = byCode.get(r.id).geometry, b = g.bounds;
    assert.ok(g.centroid[0] >= b.x - 1e-6 && g.centroid[0] <= b.x + b.w + 1e-6, r.id);
    assert.ok(g.centroid[1] >= b.y - 1e-6 && g.centroid[1] <= b.y + b.h + 1e-6, r.id);
    // close to the legacy vertex mean (same polygon)
    assert.ok(Math.hypot(g.centroid[0] - r.c[0], g.centroid[1] - r.c[1]) < Math.max(b.w, b.h), r.id);
  }
});

// ------------------------------------------------------------------ finance vs the legacy dashboard
const SAMPLE = (() => {
  const codes = RAW.filter((_, i) => i % 50 === 0).map(r => r.id);
  const min = RAW.reduce((a, b) => (b.a < a.a ? b : a)), max = RAW.reduce((a, b) => (b.a > a.a ? b : a));
  return [...new Set(['B79', min.id, max.id, ...codes])];
})();
const LEG_NAME = { P144: 'Normal 144x', P144A: 'Normal com anuais', I18: 'Investidor 18x', I36: 'Investidor 36x' };
const close = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

for (const pct of [12, 0, 30]) {
  test(`finance (${pct}% entrada): totals, installments and schedules match the legacy dashboard for ${SAMPLE.length} sample lots`, () => {
    const t = repo.commercialRepo.getPriceTable();
    for (const code of SAMPLE) {
      const l = byCode.get(code), raw = RAW.find(r => r.id === code);
      const sim = App.services.finance.simulate({ price: l.commercial.price, downPaymentPct: pct, plans: t.plans });
      const leg = LEG.plans(raw, pct);
      assert.ok(close(sim.price, leg.price), `${code} price`);
      assert.ok(close(sim.downPayment, leg.ent), `${code} entrada`);
      assert.ok(close(sim.financed, leg.sal), `${code} saldo`);
      for (const p of sim.plans) {
        const lp = leg.list.find(x => x.k === LEG_NAME[p.id]);
        assert.ok(lp, `${code} ${p.id} exists in legacy`);
        assert.ok(close(p.total, lp.total), `${code} ${p.id} total ${p.total} vs ${lp.total}`);
        for (const k of [0, 1, 11, 12, 18, 23, 36, 37, 131, 144, 145]) assert.ok(close(p.at(k), lp.sched(k)), `${code} ${p.id} month ${k}`);
        const sumSchedule = Array.from({ length: p.months + 1 }, (_, k) => p.at(k)).reduce((a, b) => a + b, 0);
        assert.ok(close(sumSchedule, p.total), `${code} ${p.id} schedule sums to total`);
        const yr = App.services.finance.yearly(p);
        assert.ok(close(yr[yr.length - 1].cumulative, p.total), `${code} ${p.id} yearly cumulative`);
      }
    }
  });
}

test('finance: B79 plan structure (Price 0,8% a.m., 18x −10%, 36x −5%, entrada 12%)', () => {
  const l = byCode.get('B79'), price = l.commercial.price, t = repo.commercialRepo.getPriceTable();
  assert.equal(price, 348968.88); // 291.78 m² × R$ 1.196
  const sim = App.services.finance.simulate({ price, downPaymentPct: 12, plans: t.plans });
  const P = Object.fromEntries(sim.plans.map(p => [p.id, p]));
  const dp = price * 0.12, fin = price - dp, F = 0.008 / (1 - Math.pow(1.008, -144));
  assert.ok(close(sim.downPayment, dp));
  assert.ok(close(P.P144.monthly, fin * F));
  assert.ok(close(P.P144.total, dp + fin * F * 144));
  assert.ok(close(P.I18.total, price * 0.9));
  assert.ok(close(P.I18.monthly, (price * 0.9 - dp) / 18));
  assert.ok(close(P.I36.total, price * 0.95));
  assert.ok(close(P.I36.monthly, (price * 0.95 - dp) / 36));
  assert.equal(P.P144A.annualCount, 11);
  assert.ok(P.P144A.annual > 0 && P.P144A.monthly < P.P144.monthly);
  // the plan's present value equals the financed balance (no money created or lost)
  const pv = P.P144A.monthly / F + P.P144A.annual * App.services.finance.annualPV(0.008, 11, 11);
  assert.ok(close(pv, fin, 0.05));
  assert.equal(App.services.finance.simulate({ price: null, downPaymentPct: 12, plans: t.plans }), null);
});

// ------------------------------------------------------------------ Field Registry completeness
test('Field Registry: every field has a domain, a label, a meaning and a valid default provenance', () => {
  const M = App.model, E = App.enums, dev = App.config.DEVELOPMENTS[0], sources = new Set(dev.sources.map(s => s.id));
  const keys = new Set();
  for (const f of M.FIELDS) {
    assert.ok(!keys.has(f.key), `duplicate ${f.key}`); keys.add(f.key);
    assert.ok(Object.isFrozen(f), f.key);
    assert.ok(M.DOMAINS[f.domain], `${f.key} domain ${f.domain}`);
    assert.ok(typeof f.label === 'string' && f.label.length, `${f.key} label`);
    assert.ok(typeof f.meaning === 'string' && f.meaning.length, `${f.key} meaning`);
    assert.ok(['P0', 'P1', 'P2', 'P3'].includes(f.priority), `${f.key} priority`);
    assert.ok(['STATIC', 'VERSIONED', 'DYNAMIC'].includes(f.dynamicType), `${f.key} dynamicType`);
    assert.ok(['string', 'number', 'boolean', 'enum', 'array', 'geometry', 'date', 'datetime'].includes(f.type), `${f.key} type`);
    // provenance
    assert.ok(E.DataStatus[f.status], `${f.key} status ${f.status}`);
    if (f.sourceId) assert.ok(sources.has(f.sourceId), `${f.key} source ${f.sourceId}`);
    if (f.confidence) assert.ok(E.Confidence[f.confidence], `${f.key} confidence`);
    if (f.method) assert.ok(App.i18n.L.Method[f.method], `${f.key} method ${f.method} has a label`);
    if (f.status !== 'UNKNOWN') assert.ok(f.method, `${f.key}: a known status needs a method`);
    if (f.enum) assert.ok(E[f.enum], `${f.key} enum`);
    for (const d of f.dependsOn || []) assert.ok(M.field(d), `${f.key} dependsOn ${d}`);
  }
  assert.ok(keys.size > 100);
});

test('Field Registry: per-lot provenance resolves to a valid status for every field of every lot', () => {
  const E = App.enums;
  for (const l of repo.lotsSync()) for (const f of App.model.FIELDS) {
    const p = App.model.getFieldProvenance(l, f.key);
    assert.ok(E.DataStatus[p.status], `${l.identity.code} ${f.key}`);
    if (p.confidence != null) assert.ok(E.Confidence[p.confidence], `${l.identity.code} ${f.key} confidence`);
  }
});

test('legacy mapping: every legacy field of lots.json is mapped to the registry or explicitly listed as unmapped', () => {
  const LG = App.legacy, M = App.model;
  const legacyKeys = new Set(); RAW.forEach(r => Object.keys(r).forEach(k => legacyKeys.add(k)));
  for (const k of legacyKeys) assert.ok(Object.prototype.hasOwnProperty.call(LG.LEGACY_KEYS, k), `legacy key ${k} has a mapping entry`);
  const explicitlyUnmapped = Object.entries(LG.LEGACY_KEYS).filter(([, v]) => v == null).map(([k]) => k);
  assert.deepEqual(explicitlyUnmapped, ['c']); // vertex mean, replaced by geometry.centroid
  for (const [k, target] of Object.entries(LG.LEGACY_KEYS)) {
    if (target == null) continue;
    const f = M.field(target), prefix = M.FIELDS.some(x => x.key.startsWith(target + '.'));
    assert.ok(f || prefix, `${k} → ${target} exists in the registry`);
    if (f) assert.ok(String(f.legacy).split(/[\s/(]+/).includes(k), `${target}.legacy mentions ${k} (${f.legacy})`);
  }
  // nt.* notes
  const ntKeys = new Set(); RAW.forEach(r => Object.keys(r.nt || {}).forEach(k => ntKeys.add(k)));
  for (const k of ntKeys) {
    const target = LG.NOTE_KEYS[k];
    assert.ok(target && M.field(target), `nt.${k} mapped`);
    assert.match(M.field(target).legacy, new RegExp(`nt\\.${k}\\b`));
  }
  // reverse: every registry legacy reference points to a real legacy key (or nt.* / routes.json)
  for (const f of M.FIELDS) {
    if (!f.legacy) continue;
    const tokens = f.legacy.split(/[\s/(]+/).filter(t => /^[a-zA-Z_.:]+$/.test(t) && !/^(sempre|nulo|substituído|SERVIDÃO|RESTRIÇÃO|CONSTRUTIVA)$/.test(t));
    for (const t of tokens) {
      if (t.startsWith('nt.')) assert.ok(LG.NOTE_KEYS[t.slice(3)], `${f.key}: ${t}`);
      else if (t.startsWith('routes.json')) continue;
      else assert.ok(legacyKeys.has(t), `${f.key}: legacy token ${t} exists in lots.json`);
    }
  }
  // nothing unexpected was reported by the import
  assert.deepEqual(plain(repo.getQualityReport().unmappedLegacyFields), []);
});

test('legacy wording maps are total for the current dataset (no value falls back to null)', () => {
  const LG = App.legacy.MAP;
  const checks = { forma: LG.shape, pos: LG.pos, efic: LG.efic, mconf: LG.conf, conf: LG.conf, fundo: LG.rear, fech: LG.closure, vista: LG.view, portc: LG.gate, via: LG.road,
    lazer: LG.northSun, quartos: LG.eastSide, cl: LG.cls, fc: LG.level, ruido: LG.level, priv: LG.level, liq: LG.level, vzE: LG.side, vzD: LG.side, fs: LG.dir, bs: LG.dir };
  for (const [k, map] of Object.entries(checks)) {
    const values = new Set(RAW.map(r => r[k]).filter(v => v != null && v !== ''));
    for (const v of values) assert.ok(Object.prototype.hasOwnProperty.call(map, v), `${k}: "${v}" mapped`);
  }
});
