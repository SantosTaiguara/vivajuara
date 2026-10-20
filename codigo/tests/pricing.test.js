'use strict';
// Topic 28: price history as a series of published price table versions (fixtures, golden scenarios, wording, UI render).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm');
const { load, SRC } = require('./harness.js');

let App, PH, lots, PV;
const AS_OF = '2026-10-08';
test.before(async () => {
  App = load(); PH = App.priceHistory;
  const r = App.repos.LotRepository('viva-juara'); await r.load(); lots = r.lotsSync();
  vm.runInNewContext(fs.readFileSync(SRC + '/presentation/pricingView.js', 'utf8'), { App, Intl, Date, String, Object, Math });
  PV = App.pricingView;
});
const FORBIDDEN = /valoriz|rentabil|retorno|lucro|ganho|rendeu|garant|vai subir/i;
const LOT = { identity: { id: 'L1', code: 'Q1-L1' }, geometry: { areaM2: 250 } };
const LOT2 = { identity: { id: 'L2', code: 'Q1-L2' }, geometry: { areaM2: 500 } };
const V = (id, effectiveFrom, extra = {}) => ({ id, version: effectiveFrom, validFrom: effectiveFrom, developmentId: 'dev', currency: 'BRL', status: 'PUBLISHED', ...extra });
const vs = (...tables) => PH.versionsFrom({ priceTables: tables, developmentId: 'dev' });
const hist = (versions, lot = LOT, q = {}) => PH.buildLotHistory(versions, lot, { asOf: '2027-12-31', ...q });
const allText = vmObj => JSON.stringify(vmObj);
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), m);

// ------------------------------------------------------------------ the real data: one version
test('real data: exactly one published version (2026-10-06, R$ 1.196/m²), effective date inferred from the issue date', () => {
  const inv = PH.forDevelopment('viva-juara').inventory();
  assert.equal(inv.count, 1); deq([...inv.priceTypes], ['LIST_PRICE']); assert.equal(inv.first, '2026-10-06');
  deq([...inv.inferredEffectiveDates], ['lancamento-2026-10']);
});
test('SinglePricePoint (real lots): one point, change NOT_CALCULABLE (never 0%), quality LOW, no quick view line', () => {
  const svc = PH.forDevelopment('viva-juara');
  for (const l of lots.slice(0, 40)) {
    const h = svc.lotHistory(l, { asOf: AS_OF }), s = PH.summarize(h);
    assert.equal(h.pointCount, 1); assert.equal(s.calculationStatus, 'NOT_CALCULABLE');
    assert.equal(s.relativeChange, null); assert.equal(s.absoluteChange, null); assert.equal(s.changeCount, 0);
    assert.equal(h.quality.level, 'LOW'); assert.ok(h.quality.warnings.includes('SINGLE_VERSION'));
    assert.equal(PH.quickViewSummary(h).visible, false);
  }
});
test('250 m² lot at R$ 1.196/m² is R$ 299.000 in the history', () => {
  const t = App.config.DEVELOPMENTS[0].priceTables[0], h = hist(PH.versionsFrom({ priceTables: [t] }), LOT);
  assert.equal(h.series.points[0].amountMinor, 29900000); assert.equal(h.series.points[0].pricePerM2Minor, 119600);
});
test('current consistency: last valid point = lot.commercial.price for all 498 lots (PricingResolver current)', () => {
  const svc = PH.forDevelopment('viva-juara');
  assert.equal(lots.length, 498);
  for (const l of lots) { const c = svc.consistency(l, { asOf: AS_OF }); assert.ok(c.consistent, l.identity.id + ' ' + c.reason); }
  const changed = { ...lots[0], commercial: { ...lots[0].commercial, price: lots[0].commercial.price + 1 } };
  assert.equal(PH.checkCurrentConsistency(svc.lotHistory(lots[0], { asOf: AS_OF }), changed).reason, 'AMOUNT_MISMATCH');
});
test('real view model wording: "variação do preço de tabela", disclaimer present, no forbidden claim, "não pode ser calculada"', () => {
  const svc = PH.forDevelopment('viva-juara');
  for (const mode of ['client', 'broker', 'technical', 'presentation']) {
    const vmo = svc.viewModel(lots[3], { asOf: AS_OF, mode });
    assert.equal(vmo.summary.title, 'Variação do preço de tabela'); assert.equal(vmo.disclaimer, PH.DISCLAIMER);
    assert.match(vmo.summary.relativeChange.text, /não pode ser calculada/i); assert.equal(vmo.summary.relativeChange.dataStatus, 'UNKNOWN');
    assert.ok(!FORBIDDEN.test(allText(vmo)), mode);
    assert.equal(vmo.chart.seriesType, 'STEP'); assert.equal(vmo.chart.smoothing, false); assert.equal(vmo.chart.interpolation, 'NONE');
    if (mode === 'technical') assert.ok(vmo.technicalDetails.versions[0].checksum); else assert.equal(vmo.technicalDetails, null);
    if (mode === 'client' || mode === 'presentation') assert.equal(vmo.summary.cagrNominal, null);
  }
});
test('HistoricalShare: share text uses "preço de tabela", keeps the disclaimer, makes no transaction or future claim', () => {
  const svc = PH.forDevelopment('viva-juara'), t = PH.shareText(svc.lotHistory(lots[0], { asOf: AS_OF }), { lotLabel: 'Q A · L 1' });
  assert.match(t, /Preço de tabela do lote Q A · L 1/); assert.match(t, /única versão publicada/); assert.ok(t.includes(PH.DISCLAIMER)); assert.ok(!FORBIDDEN.test(t));
  const two = hist(vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-07-01', { pricePerM2: 1100 })));
  const t2 = PH.shareText(two, { to: '2026-12-31' }); assert.match(t2, /passou de R\$\s?250\.000 para R\$\s?275\.000/); assert.match(t2, /variação nominal da tabela de \+10,0%/); assert.ok(!FORBIDDEN.test(t2));
});
test('real development index: base 100, single point, change NOT_CALCULABLE, internal-index label, coverage 498/498', () => {
  const idx = PH.forDevelopment('viva-juara').index(lots, { asOf: AS_OF });
  assert.equal(idx.points.length, 1); assert.equal(idx.points[0].indexValue, 100); assert.equal(idx.change.calculationStatus, 'NOT_CALCULABLE');
  assert.match(idx.label, /Índice interno/); assert.match(idx.coverageText, /498 de 498/);
});

// ------------------------------------------------------------------ fixtures (spec §236)
test('TwoVersionIncrease: absolute and relative delta, INCREASE event', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-07-01', { pricePerM2: 1100 }))), s = PH.summarize(h, { to: '2026-12-31' });
  assert.equal(s.absoluteChange, 2500000); assert.ok(Math.abs(s.relativeChange - 0.1) < 1e-12); assert.equal(s.changeCount, 1);
  deq(h.series.changeEvents.map(e => e.changeType), ['INITIAL', 'INCREASE']);
  assert.equal(h.series.changeEvents[1].reason, 'UNKNOWN_REASON'); // never inferred
});
test('TwoVersionDecrease: negative delta, DECREASE event, not assumed to be a promotion', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-07-01', { pricePerM2: 900 }))), s = PH.summarize(h);
  assert.equal(s.absoluteChange, -2500000); assert.ok(Math.abs(s.relativeChange + 0.1) < 1e-12);
  assert.equal(h.series.changeEvents[1].changeType, 'DECREASE'); assert.ok(!s.warnings.includes('PROMOTION_IN_PERIOD'));
});
test('UnchangedVersion: two versions with the same price → 0% (calculated), not a repricing', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-07-01', { pricePerM2: 1000 }))), s = PH.summarize(h);
  assert.equal(s.calculationStatus, 'CALCULATED'); assert.equal(s.relativeChange, 0); assert.equal(s.changeCount, 0);
  assert.equal(h.series.changeEvents[1].changeType, 'UNCHANGED');
});
test('ThreeStepHistory: ordered by effectiveFrom regardless of input order; intervals chain', () => {
  const h = hist(vs(V('c', '2026-09-01', { pricePerM2: 1200 }), V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-05-01', { pricePerM2: 1100 })));
  deq(h.series.points.map(p => p.priceTableVersionId), ['a', 'b', 'c']);
  deq(h.series.intervals.map(i => [i.startAt, i.endAt]), [['2026-01-01', '2026-05-01'], ['2026-05-01', '2026-09-01'], ['2026-09-01', null]]);
  assert.equal(PH.summarize(h).changeCount, 2);
});
test('HistoryWithGap: validity ends before the next version → explicit MISSING interval, no interpolation, resolver returns MISSING', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricePerM2: 1000, validUntil: '2026-03-01' }), V('b', '2026-06-01', { pricePerM2: 1200 })));
  const gap = h.series.intervals.find(i => i.status === 'MISSING');
  deq([gap.startAt, gap.endAt, gap.amountMinor], ['2026-03-01', '2026-06-01', null]);
  assert.equal(PH.resolveAt(h, '2026-04-15').status, 'MISSING');
  const lk = PH.resolveAt(h, '2026-04-15', 'LAST_KNOWN_BEFORE'); assert.equal(lk.point.priceTableVersionId, 'a'); assert.ok(lk.fallback); assert.ok(lk.warnings.includes('LAST_KNOWN_FALLBACK'));
  assert.ok(h.quality.warnings.includes('GAPS'));
  const ch = PH.chartViewModel(h, PH.summarize(h)); assert.equal(ch.gapSegments.length, 1); assert.equal(ch.gapSegments[0].tooltip, 'Sem preço publicado disponível neste período.');
});
test('HistoryWithWithheld: withheld is not zero and not a decrease', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 300000 } }), V('b', '2026-04-01', { pricingMode: 'PER_LOT', lotPrices: { L1: { status: 'WITHHELD' } } }),
    V('c', '2026-08-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 330000 } })));
  const p = h.series.points[1]; assert.equal(p.pointStatus, 'WITHHELD'); assert.equal(p.amountMinor, null);
  deq(h.series.changeEvents.map(e => e.changeType), ['INITIAL', 'WITHHELD', 'RESTORED']);
  assert.ok(!h.series.changeEvents.some(e => e.changeType === 'DECREASE'));
});
test('HistoryWithConflict: conflicted point kept but excluded from deltas; quality flags it', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 300000 } }), V('b', '2026-04-01', { pricingMode: 'PER_LOT', lotPrices: { L1: { status: 'CONFLICTED', amount: 1 } } })));
  assert.equal(h.series.points[1].pointStatus, 'CONFLICTED'); assert.equal(h.series.changeEvents[1].changeType, 'CONFLICTED');
  assert.equal(PH.calculateDelta(h.series.points[0], h.series.points[1]).calculationStatus, 'NOT_CALCULABLE');
  assert.ok(h.quality.warnings.includes('CONFLICTED_POINTS'));
  assert.equal(PH.summarize(h).calculationStatus, 'NOT_CALCULABLE'); // the conflicted price is current: no change is claimed
});
test('PromotionStartEnd: promotional price type is a separate series; promotion reason marked, never inferred from a decrease', () => {
  const list = [V('a', '2026-01-01', { pricePerM2: 1000 }), V('p', '2026-03-01', { pricePerM2: 900, priceType: 'PROMOTIONAL_PRICE' })];
  const h = hist(vs(...list)); assert.equal(h.pointCount, 1); assert.equal(h.promotionalSeries.length, 1); assert.equal(h.promotionalSeries[0].priceType, 'PROMOTIONAL_PRICE');
  const m = hist(vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-03-01', { pricePerM2: 900, reasonCode: 'PROMOTION' }), V('c', '2026-05-01', { pricePerM2: 1000 })));
  deq(m.series.changeEvents.map(e => e.changeType), ['INITIAL', 'PROMOTION_START', 'PROMOTION_END']);
  assert.ok(PH.summarize(m).warnings.includes('PROMOTION_IN_PERIOD'));
});
test('CorrectionVersion: a correction is not a repricing (changeCount 0, repricing-only change 0, warning)', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-02-01', { pricePerM2: 1010, reasonCode: 'CORRECTION' }))), s = PH.summarize(h);
  assert.equal(h.series.changeEvents[1].changeType, 'CORRECTION'); assert.equal(s.changeCount, 0);
  assert.equal(s.repricingChangeExcludingCorrections, 0); assert.ok(s.warnings.includes('CORRECTION_IN_PERIOD'));
});
test('FuturePriceTableExcluded: a version effective after asOf is not in the series', () => {
  const versions = vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2027-03-01', { pricePerM2: 1200 }));
  assert.equal(hist(versions, LOT, { asOf: '2026-12-31' }).pointCount, 1); assert.equal(hist(versions, LOT, { asOf: '2027-03-01' }).pointCount, 2);
});
test('AsOfDateHistory and PUBLISHED_AS_OF (knowledge date): correct historical price; DRAFT never enters', () => {
  const versions = vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-06-01', { pricePerM2: 1100, publishedAt: '2026-07-15T10:00:00Z' }), V('d', '2026-03-01', { pricePerM2: 5, status: 'DRAFT' }));
  const h = hist(versions);
  assert.equal(h.pointCount, 2);
  assert.equal(PH.resolveAt(h, '2026-05-31').point.priceTableVersionId, 'a'); assert.equal(PH.resolveAt(h, '2026-06-01').point.priceTableVersionId, 'b');
  assert.equal(PH.resolveAt(h, '2025-12-31').reason, 'BEFORE_FIRST_KNOWN');
  assert.equal(PH.resolveAt(h, '2026-07-01', 'PUBLISHED_AS_OF').point.priceTableVersionId, 'a'); // b was effective but not yet published
  assert.equal(hist(versions, LOT, { asOfKnowledgeDate: '2026-07-01' }).pointCount, 1);
  assert.equal(PH.resolveAt(h, null, 'EXPLICIT_VERSION', { versionId: 'b' }).point.amountMinor, 27500000);
});
test('PricePerM2History: area basis is the canonical static area; per-lot table derives R$/m²', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricingMode: 'PER_LOT', lotPrices: { L2: 600000 } })), LOT2);
  assert.equal(h.pricePerM2.areaPolicy, 'STATIC_CANONICAL_AREA'); assert.equal(h.pricePerM2.points[0].pricePerM2Minor, 120000); assert.equal(h.pricePerM2.points[0].areaM2, 500);
});
test('CAGR: days/year normalization; zero start and short periods are not calculable', () => {
  const r = PH.calculateCagr(100, 121, 730); assert.ok(Math.abs(r.value - 0.1) < 1e-9);
  assert.equal(PH.calculateCagr(0, 121, 730).value, null); assert.equal(PH.calculateCagr(100, 121, 30).reason, 'SHORT_PERIOD');
  const h = hist(vs(V('a', '2025-01-01', { pricePerM2: 1000 }), V('b', '2027-01-01', { pricePerM2: 1210 })), LOT, { asOf: '2027-01-01' });
  assert.ok(Math.abs(PH.summarize(h, { mode: 'broker' }).cagrNominal - 0.1) < 0.001); assert.equal(PH.summarize(h, { mode: 'client' }).cagrNominal, null);
});
test('zero start price: absolute delta only, no percentage', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 0 } }), V('b', '2026-06-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 100 } })));
  const d = PH.calculateDelta(h.series.points[0], h.series.points[1]); assert.equal(d.absoluteDeltaMinor, 10000); assert.equal(d.relativeDeltaPct, null); assert.ok(d.warnings.includes('ZERO_START'));
});
test('mixed currency: a version in another currency is INVALID and never part of a delta', () => {
  const h = hist(vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-06-01', { pricePerM2: 200, currency: 'USD' })));
  assert.equal(h.series.points[1].pointStatus, 'INVALID'); assert.ok(h.quality.warnings.includes('MIXED_CURRENCY'));
});
test('custom period without a known start price: NOT_CALCULABLE, no fake start value; period options disabled accordingly', () => {
  const h = hist(vs(V('a', '2026-06-01', { pricePerM2: 1000 }), V('b', '2026-09-01', { pricePerM2: 1100 })), LOT, { asOf: '2026-10-01' });
  const s = PH.summarize(h, { from: '2026-01-01' }); assert.equal(s.calculationStatus, 'NOT_CALCULABLE'); assert.equal(s.initialKnownPrice, null); assert.ok(s.warnings.includes('NO_START_PRICE'));
  const opts = Object.fromEntries(PH.periodOptions(h).map(o => [o.id, o.enabled])); assert.equal(opts.D30, true); assert.equal(opts.M6, false);
});
test('SameLotBasketIndex + MixEffectScenario: lots added in a later version do not move the index; median is robust to outliers', () => {
  const big = { identity: { id: 'L9' }, geometry: { areaM2: 2000 } }, basket = [LOT, LOT2, big];
  const versions = vs(V('a', '2026-01-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 100, L2: 200 } }), V('b', '2026-06-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 110, L2: 220, L9: 5000 } }));
  const idx = PH.developmentIndex(versions, basket, { asOf: '2026-12-31' });
  assert.ok(Math.abs(idx.points[1].indexValue - 110) < 1e-9); assert.equal(idx.points[1].eligibleLotCount, 2); assert.ok(idx.warnings.includes('LOW_COVERAGE'));
  const out = vs(V('a', '2026-01-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 100, L2: 100, L9: 100 } }), V('b', '2026-06-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 110, L2: 110, L9: 1000 } }));
  assert.ok(Math.abs(PH.developmentIndex(out, basket, { asOf: '2026-12-31' }).points[1].indexValue - 110) < 1e-9);
});
test('HistoricalPriceComparison: common basket, added lots apart, removed price is not a decrease', () => {
  const versions = vs(V('a', '2026-01-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 100, L2: 200 } }), V('b', '2026-06-01', { pricingMode: 'PER_LOT', lotPrices: { L1: 120, L2: null, L9: 50 } }));
  const c = PH.compareDates(versions, [LOT, LOT2, { identity: { id: 'L9' }, geometry: { areaM2: 1 } }], '2026-02-01', '2026-07-01');
  assert.equal(c.commonLotCount, 1); deq([...c.added], ['L9']); assert.equal(c.removed[0].lotId, 'L2'); assert.equal(c.lotChanges[0].changeType, 'INCREASE');
  const same = PH.forDevelopment('viva-juara').compare(lots.slice(0, 10), '2026-10-06', AS_OF);
  assert.equal(same.developmentSummary.calculationStatus, 'NOT_CALCULABLE'); assert.ok(same.warnings.includes('SAME_VERSION_BOTH_DATES'));
});
test('comparison metrics: INFORMATIONAL (no winner), same period required, missing start not comparable', () => {
  const versions = vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-06-01', { pricePerM2: 1100 }));
  const svc = PH.createService({ developmentId: 'dev', versions });
  const r = svc.comparisonMetrics([LOT, LOT2], { to: '2026-12-31' });
  assert.ok(r.comparable); for (const m of r.metrics) { assert.equal(m.semantics, 'INFORMATIONAL'); assert.equal(m.better, null); }
  const pctM = r.metrics.find(m => m.key === 'priceChangePctPeriod'); assert.ok(Math.abs(pctM.values[0] - 0.1) < 1e-12);
  const h1 = hist(versions, LOT, { asOf: '2026-12-31' }), h2 = hist(versions, LOT2, { asOf: '2026-08-01' });
  const diff = PH.comparisonMetrics([h1, h2]); assert.equal(diff.comparable, false); assert.ok(diff.reasons.includes('DIFFERENT_PERIOD'));
  const real = PH.forDevelopment('viva-juara').comparisonMetrics(lots.slice(0, 3), { to: AS_OF });
  assert.ok(real.metrics.find(m => m.key === 'priceChangePctPeriod').values.every(v => v === null)); // single version: nothing to compare
});
test('cache: same versions → same entry; a new published version updates current history; closed periods stay cached', () => {
  const v1 = vs(V('a', '2026-01-01', { pricePerM2: 1000 })), svc = PH.createService({ developmentId: 'dev', versions: v1 });
  const h1 = svc.lotHistory(LOT, { asOf: '2026-05-01' }); assert.equal(svc.lotHistory(LOT, { asOf: '2026-05-01' }), h1);
  svc.setVersions(vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-06-01', { pricePerM2: 1100 })));
  assert.equal(svc.lotHistory(LOT, { asOf: '2026-05-01' }), h1); // closed period: version b is not included → same key
  const cur = svc.lotHistory(LOT, { asOf: '2026-07-01' }); assert.equal(cur.pointCount, 2);
  const corr = vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('c', '2026-01-01', { pricePerM2: 1001, reasonCode: 'CORRECTION', retroactive: true, publishedAt: '2026-08-01' }));
  svc.setVersions(corr); assert.notEqual(svc.lotHistory(LOT, { asOf: '2026-05-01' }), h1); // retroactive correction in the period → new key
  const c = PH.createCache(); assert.ok(!/client|broker|mode/.test(c.keyOf('dev', 'L1', v1, { asOf: '2026-05-01', mode: 'client' })));
});
test('OfflinePartialHistory: flagged, quality capped, banner text in VM and render', () => {
  const svc = PH.createService({ developmentId: 'dev', versions: vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-06-01', { pricePerM2: 1100 })), offlinePartial: true });
  const h = svc.lotHistory(LOT, { asOf: '2026-12-31' }); assert.ok(h.offlinePartial); assert.ok(h.quality.warnings.includes('OFFLINE_PARTIAL_HISTORY')); assert.equal(h.quality.level, 'LOW');
  const vmo = PH.viewModel(h, { mode: 'broker' }); assert.ok(vmo.warnings.includes('Histórico parcial disponível offline.'));
  assert.match(PV.renderHistorySection(vmo), /Histórico parcial disponível offline/);
});
test('API repository: reads PriceTableDto list; on failure falls back to local versions and flags incomplete', async () => {
  const dto = { id: 't1', developmentId: 'viva-juara', version: '2026-10-06', name: 'x', sourceId: 's', createdAt: '2026-10-06', validFrom: null, validUntil: null, pricePerM2: 1196, downPaymentDefault: 0.12, plans: [], status: 'PUBLISHED', currency: 'BRL', revision: 1 };
  const ok = PH.ApiPriceHistoryRepository('viva-juara', { baseUrl: 'https://api', fetch: async u => ({ ok: true, json: async () => ({ data: [dto, { ...dto, id: 't0', status: 'DRAFT' }] }), url: u }) });
  const v = await ok.listPublishedVersions(); assert.equal(v.length, 1); assert.equal(v[0].source.kind, 'API'); assert.ok(ok.complete);
  const local = PH.PriceHistoryRepository('viva-juara'), bad = PH.ApiPriceHistoryRepository('viva-juara', { baseUrl: 'https://api', fetch: async () => { throw new Error('offline'); }, fallback: local });
  assert.equal((await bad.listPublishedVersions()).length, 1); assert.equal(bad.complete, false);
});
test('DTO: LotPriceHistoryDto shape, amounts in reais, change null when not calculable', () => {
  const d = PH.toLotPriceHistoryDto(PH.forDevelopment('viva-juara').lotHistory(lots[0], { asOf: AS_OF }));
  deq(Object.keys(d), ['lotId', 'priceType', 'currency', 'series', 'summary', 'quality', 'versionRefs', 'methodologyVersion']);
  assert.equal(d.series[0].amount, lots[0].commercial.price); assert.equal(d.summary.relativeChange, null); assert.equal(d.summary.calculationStatus, 'NOT_CALCULABLE');
});
test('analytics events carry no PII', () => {
  deq(PH.analyticsEvent('price_history_opened', { lotId: 'L1', customerName: 'Fulano', phone: '1' }), { name: 'price_history_opened', lotId: 'L1', period: null, mode: null });
  assert.equal(PH.analyticsEvent('unknown'), null);
});

// ------------------------------------------------------------------ golden scenarios (spec §269)
test('golden: LotPriceIncreaseFromLaunch / LotPriceDecreaseAndRecovery / ClientSafeHistoricalSummary', () => {
  const inc = hist(vs(V('a', '2026-08-01', { pricePerM2: 1000 }), V('b', '2026-10-01', { pricePerM2: 1054 })), LOT, { asOf: '2026-12-01' });
  assert.equal(PH.quickViewSummary(inc).text, '+5,4% desde 08/2026');
  const incHigh = hist(vs(V('a', '2026-08-01', { pricePerM2: 1000 }), V('b', '2026-10-01', { pricePerM2: 1054 })), LOT, { asOf: '2026-12-01', policy: { ...PH.DEFAULT_POLICY, quickView: { minQuality: 'LOW', minValidPoints: 2 } } });
  const q2 = PH.quickViewSummary(incHigh, { policy: { ...PH.DEFAULT_POLICY, quickView: { minQuality: 'LOW', minValidPoints: 2 } } });
  assert.equal(q2.visible, true); assert.equal(q2.text, '+5,4% desde 08/2026'); assert.equal(q2.label, 'Variação da tabela');
  assert.match(PV.renderQuickViewPriceChange(q2), /Variação da tabela<\/span> \+5,4% desde 08\/2026/); assert.equal(PV.renderQuickViewPriceChange(PH.quickViewSummary(hist(vs(V('a', '2026-08-01', { pricePerM2: 1 }))))), '');
  const dr = hist(vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-04-01', { pricePerM2: 900 }), V('c', '2026-08-01', { pricePerM2: 1000 })));
  deq(dr.series.changeEvents.map(e => e.changeType), ['INITIAL', 'DECREASE', 'INCREASE']); assert.equal(PH.summarize(dr).relativeChange, 0); assert.equal(PH.summarize(dr).changeCount, 2);
  const client = PH.viewModel(dr, { mode: 'client' }); assert.ok(!FORBIDDEN.test(allText(client))); assert.equal(client.summary.cagrNominal, null);
});
test('quality: two versions with validFrom → HIGH; inferred effective date → MEDIUM; quick view hidden below MEDIUM', () => {
  const h = hist(vs(V('a', '2026-08-01', { pricePerM2: 1000 }), V('b', '2026-10-01', { pricePerM2: 1054 })), LOT, { asOf: '2026-12-01' });
  assert.equal(h.quality.level, 'HIGH'); assert.equal(PH.quickViewSummary(h).visible, true);
  const inf = hist(vs({ id: 'a', createdAt: '2026-08-01', pricePerM2: 1000 }, { id: 'b', createdAt: '2026-10-01', pricePerM2: 1054 }), LOT, { asOf: '2026-12-01' });
  assert.equal(inf.quality.level, 'MEDIUM'); assert.ok(inf.quality.warnings.includes('EFFECTIVE_DATE_INFERRED'));
});

// ------------------------------------------------------------------ render (accessibility, step chart)
test('step chart: only H/V path commands (no curves), single version draws one step, gaps dashed with text', () => {
  const vmo = PH.forDevelopment('viva-juara').viewModel(lots[0], { asOf: AS_OF, mode: 'broker' }), svg = PV.renderStepChart(vmo.chart);
  const d = svg.match(/class="pv-step" d="([^"]*)"/)[1]; assert.ok(/^M[\d. ]+( [HV][\d.]+)+$/.test(d), d); assert.ok(!/[CQSTA]/.test(d));
  assert.match(svg, /data-interpolation="NONE"/); assert.match(svg, /Única versão publicada/);
  const g = PH.viewModel(hist(vs(V('a', '2026-01-01', { pricePerM2: 1000, validUntil: '2026-03-01' }), V('b', '2026-06-01', { pricePerM2: 1200 }))), { mode: 'broker' });
  assert.match(PV.renderStepChart(g.chart), /class="pv-gap"[^>]*><title>Sem preço publicado disponível neste período\./);
});
test('accessible table: every point as text ("Em 6 de outubro de 2026, preço de tabela R$ …"), gaps as text, change announced', () => {
  const vmo = PH.forDevelopment('viva-juara').viewModel(lots[0], { asOf: AS_OF });
  assert.match(vmo.accessibleRows[0].text, /^Em 6 de outubro de 2026, preço de tabela R\$\s?807\.420\.$/);
  const html = PV.renderHistorySection(vmo); assert.match(html, /<table class="pv-table">/); assert.match(html, /<caption>/); assert.ok(html.includes(App.pricingView.esc(PH.DISCLAIMER)));
  const two = PH.accessibleRows(hist(vs(V('a', '2026-01-01', { pricePerM2: 1000, validUntil: '2026-03-01' }), V('b', '2026-06-01', { pricePerM2: 1100 }))));
  assert.ok(two.some(r => /sem preço registrado neste período/.test(r.text))); assert.match(two[two.length - 1].change, /^Variação de \+10,0% em relação à versão anterior/);
});
test('price history renders for every presentation mode without forbidden wording; markers are text symbols, not colour only', () => {
  const versions = vs(V('a', '2026-01-01', { pricePerM2: 1000 }), V('b', '2026-05-01', { pricePerM2: 900 }), V('c', '2026-08-01', { pricePerM2: 1100 }));
  for (const mode of ['client', 'broker', 'technical', 'presentation']) { const html = PV.renderHistorySection(PH.viewModel(hist(versions), { mode })); assert.ok(!FORBIDDEN.test(html), mode); assert.match(html, /▲/); assert.match(html, /▼/); }
});
