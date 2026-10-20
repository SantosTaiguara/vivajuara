'use strict';
// Cleanup round 2026-10-12: TD-12 (one price formula), GAP-ARCH-10/24/25 (single analytics owner, injected ports).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

let App, repo, lots;
test.before(async () => { App = load(); repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync(); });

test('TD-12: one price formula; all 498 lots keep the byte-identical price and down payment (old inline formula)', () => {
  const F = App.pricing.formula; assert.equal(lots.length, 498);
  const t = repo.commercialRepo.getPriceTable(); assert.equal(t.pricePerM2, 1196);
  for (const l of lots) {
    const a = l.geometry.areaM2, old = Math.round(a * t.pricePerM2 * 100) / 100;
    assert.equal(l.commercial.price, old, l.identity.code); assert.equal(F.lotPrice(a, t.pricePerM2), old);
    assert.equal(l.commercial.downPaymentDefaultValue, Math.round(old * l.commercial.downPaymentDefaultPercent) / 100);
  }
  assert.equal(F.lotPrice(null, 1196), null, 'null is never 0'); assert.equal(F.lotPrice(300, null), null); assert.equal(F.pricePerM2Of(1000, 0), null);
  // the four call sites use it and no longer carry their own copy
  for (const f of ['data/repositories.js', 'domain/lot.js', 'pricing/priceHistory.js', 'provenance/provenanceServices.js']) {
    const s = fs.readFileSync(path.join(SRC, f), 'utf8'); assert.match(s, /App\.pricing\.formula/, f); assert.doesNotMatch(s, /areaM2 \* [\w.]*pricePerM2 \* 100|area \* v\.pricePerM2/, f);
  }
});

test('GAP-ARCH-10: App.analytics has one owner; calls made before the facade loads are buffered and replayed once', () => {
  const vm = require('vm'), ctx = { console, Date, Math, JSON, Map, Set, Promise };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'prelude.js'), 'utf8') + '\n' + fs.readFileSync(path.join(SRC, 'analytics/early.js'), 'utf8'), ctx);
  vm.runInContext("App.analytics.track('x_early', { a: 1 })", ctx);
  assert.equal(vm.runInContext('App.analytics.early.length', ctx), 1);
  assert.doesNotMatch(fs.readFileSync(path.join(SRC, 'state/store.js'), 'utf8'), /App\.analytics\s*=/, 'store.js no longer assigns App.analytics');
  assert.ok(App.analytics.client && typeof App.analytics.track === 'function', 'facade installed over the placeholder');
});

test('GAP-ARCH-25: PWA product events go to the injected sink only; GAP-ARCH-24: observability access is denied until injected', () => {
  const C = App.pwa.core, got = [];
  assert.equal(C.setSinks({ analytics: { track: (n, d) => got.push(n) } }), true);
  const name = C.PRODUCT_EVENTS[0]; C.emit(name, { profile: 'STANDARD' }); assert.deepEqual(got, [name]);
  for (const f of ['pwa/pwaCore.js']) assert.doesNotMatch(fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''), /App\.analytics/);
  const P = App.observability.platform; P.setAccessCheck(null); assert.equal(P.viewModel({}).allowed, false, 'deny by default');
  P.setAccessCheck(() => true); assert.notEqual(P.viewModel({}).allowed, false); P.setAccessCheck(null);
  const OC = App.observability.core; OC.setContextSources({ state: () => ({ developmentId: 'viva-juara', currentLotId: 'x' }) });
  const c = OC.defaultContext(); assert.equal(c.developmentId, 'viva-juara'); assert.equal(c.routeCode, 'LOT');
});
