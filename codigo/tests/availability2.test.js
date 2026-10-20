'use strict';
// Topic 29: availability fully independent of price — Price × Availability matrix, offerability/capabilities,
// snapshot/manifest/change set/events, validators, feed adapter, independent caches, filters, recommendation, Fit, share, UI blocks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), vm = require('vm');
const { load, SRC } = require('./harness.js');

let App, AV, PH, PV, lots, byId, fitCfg, pol;
const NOW = Date.parse('2026-10-08T12:00:00Z'), AT = '2026-10-08T11:00:00.000Z';
test.before(async () => {
  App = load(); AV = App.availability; PH = App.priceHistory;
  const r = App.repos.LotRepository('viva-juara'); await r.load(); lots = r.lotsSync(); byId = new Map(lots.map(l => [l.identity.id, l]));
  vm.runInNewContext(fs.readFileSync(SRC + '/presentation/pricingView.js', 'utf8'), { App, Intl, Date, String, Object, Math });
  PV = App.pricingView; fitCfg = App.fit.cfgOf('viva-juara'); pol = App.recommendation.policyOf('viva-juara');
});
const plain = x => JSON.parse(JSON.stringify(x));
const deq = (a, b, m) => assert.deepEqual(plain(a), plain(b), m);
/** a lot with a given status/freshness and price state, everything else from a real lot */
function mk(status, price = 'VALID', o = {}) {
  const l = lots[o.i || 0], amount = price === 'VALID' ? l.commercial.price : null;
  return { ...l, availability: { ...AV.EMPTY(), status, freshness: status === 'UNKNOWN' ? 'UNKNOWN' : o.freshness || 'FRESH', updatedAt: status === 'UNKNOWN' ? null : AT, sourceId: status === 'UNKNOWN' ? null : 'sales-mirror', revision: 7, dataState: o.dataState,
      reservedUntil: status === 'RESERVED' ? o.reservedUntil || '2026-12-01T00:00:00Z' : null },
    commercial: { ...l.commercial, price: amount, priceStatus: price === 'VALID' || price === 'MISSING' ? undefined : price, pricePerM2: price === 'VALID' ? l.commercial.pricePerM2 : null } };
}
const ctx = (l, mode = 'broker') => AV.composeCommercialContext(l, { mode, now: NOW });

// ------------------------------------------------------------------ the matrix (spec §7 and §288–298)
const MATRIX = [
  ['AVAILABLE', 'VALID', 'OFFERABLE', true], ['AVAILABLE', 'MISSING', 'OFFERABLE', false], ['AVAILABLE', 'WITHHELD', 'OFFERABLE', false], ['AVAILABLE', 'CONFLICTED', 'OFFERABLE', false],
  ['RESERVED', 'VALID', 'NOT_OFFERABLE', true], ['PROPOSAL', 'VALID', 'NOT_OFFERABLE', true], ['BLOCKED', 'VALID', 'NOT_OFFERABLE', true], ['SOLD', 'VALID', 'NOT_OFFERABLE', true],
  ['UNAVAILABLE', 'VALID', 'NOT_OFFERABLE', true], ['UNKNOWN', 'VALID', 'NEEDS_CONFIRMATION', true], ['UNKNOWN', 'MISSING', 'NEEDS_CONFIRMATION', false]];
for (const [status, price, offer, simulable] of MATRIX) test(`matrix ${status} × price ${price}: status kept, price kept, offerability ${offer}, simulation ${simulable ? 'possible' : 'blocked by price'}`, () => {
  const l = mk(status, price), c = ctx(l);
  assert.equal(c.availability.status, status, 'the price never changes the status');
  assert.equal(c.price.status, price, 'the status never changes the price');
  if (price === 'VALID') assert.equal(c.price.amount, lots[0].commercial.price); else assert.equal(c.price.amount, null);
  assert.equal(c.offerability.offerability, offer);
  assert.equal(c.simulation.allowed, simulable); if (price !== 'VALID') assert.equal(c.simulation.blockedBy, 'PRICE');
  assert.equal(c.capabilities.canCompare, true); assert.equal(c.capabilities.canShowPriceHistory, true);
  assert.equal(c.versionRefs.availabilityRevision, 7); assert.equal(c.versionRefs.priceTableVersion, '2026-10-06');
  // presentation: two blocks, the status is always rendered
  const vmo = PV.commercialVM(l, { mode: 'broker', now: NOW }), html = PV.renderCommercialBlocks(vmo);
  assert.match(html, /class="pv-block pv-status"/); assert.ok(html.includes(PV.esc(vmo.availability.label)));
  if (status === 'UNKNOWN') assert.equal(vmo.availability.label, 'A confirmar');
  if (price === 'WITHHELD') assert.equal(vmo.price.text, 'Consulte condição comercial');
  if (price === 'MISSING') assert.equal(vmo.price.text, 'Preço não disponível');
  if (price === 'CONFLICTED') assert.match(vmo.price.text, /divergência/);
});
test('offerability does not read the price: same result with and without price for every status/freshness', () => {
  for (const s of AV.ORDER) for (const f of ['FRESH', 'STALE', 'EXPIRED']) {
    const a = AV.offerability(mk(s, 'VALID', { freshness: f })), b = AV.offerability(mk(s, 'MISSING', { freshness: f }));
    deq(a, b, s + f); deq(AV.capabilitiesOf(mk(s, 'VALID', { freshness: f })), AV.capabilitiesOf(mk(s, 'MISSING', { freshness: f })));
  }
});
test('UNKNOWN is never OFFERABLE (any freshness, any price, any policy flag)', () => {
  for (const f of ['FRESH', 'STALE', 'EXPIRED', 'UNKNOWN']) for (const p of [{}, { proposalCountsAsOfferable: true }, { staleOfferability: 'CONDITIONAL' }]) {
    const o = AV.offerability({ ...AV.EMPTY(), status: 'UNKNOWN', freshness: f, sourceId: 'x', updatedAt: AT }, { policy: p });
    assert.notEqual(o.offerability, 'OFFERABLE'); assert.ok(o.requiresConfirmation);
  }
});
test('stale/expired AVAILABLE: NEEDS_CONFIRMATION by default, CONDITIONAL by policy; never shared as "Disponível"', () => {
  assert.equal(AV.offerability(mk('AVAILABLE', 'VALID', { freshness: 'STALE' })).offerability, 'NEEDS_CONFIRMATION');
  assert.equal(AV.offerability(mk('AVAILABLE', 'VALID', { freshness: 'STALE' }), { policy: { staleOfferability: 'CONDITIONAL' } }).offerability, 'CONDITIONAL');
  assert.equal(AV.offerability(mk('AVAILABLE', 'VALID', { freshness: 'EXPIRED' })).offerability, 'NEEDS_CONFIRMATION');
  assert.equal(PV.shareStatusText(mk('AVAILABLE', 'VALID', { freshness: 'STALE' })), 'Último status conhecido: disponível. Confirmar disponibilidade.');
  assert.equal(PV.shareStatusText(mk('AVAILABLE', 'VALID')), 'Disponível'); assert.equal(PV.shareStatusText(mk('UNKNOWN')), 'Disponibilidade a confirmar.');
  assert.equal(AV.capabilitiesOf(mk('AVAILABLE', 'VALID', { freshness: 'STALE' })).canShareAsAvailable, false);
  const v = PV.availabilityVM(mk('AVAILABLE', 'VALID', { freshness: 'STALE' }), { mode: 'client' }); assert.ok(!/^Disponível$/.test(v.label)); assert.match(v.badgeStyleToken, /av-stale/);
});
test('PROPOSAL follows the policy (CONDITIONAL when it counts as offerable); expired reservation needs confirmation', () => {
  assert.equal(AV.offerability(mk('PROPOSAL'), { policy: { proposalCountsAsOfferable: true } }).offerability, 'CONDITIONAL');
  assert.equal(AV.offerability(mk('RESERVED', 'VALID', { reservedUntil: '2026-10-01T00:00:00Z' }), { now: NOW }).offerability, 'NEEDS_CONFIRMATION');
});
test('capabilities: semantic only; no reservation in the read-only frontend; SOLD can still be compared and simulated (consultative)', () => {
  const sold = AV.capabilitiesOf(mk('SOLD')); assert.equal(sold.canCompare, true); assert.equal(sold.canSimulate, true); assert.equal(sold.simulationConsultative, true); assert.equal(sold.canRecommend, false);
  const av = AV.capabilitiesOf(mk('AVAILABLE')); assert.equal(av.canRecommend, true); assert.equal(av.canReserve, false); assert.ok(av.reasons.includes('READ_ONLY_NO_AUTHORITATIVE_BACKEND'));
  assert.equal(AV.capabilitiesOf(mk('AVAILABLE'), { policy: { authoritativeWrites: true } }).canReserve, true);
});
test('price display policy: SOLD keeps its price in the domain; "último preço de tabela" for broker/technical, hidden for client by default', () => {
  const s = mk('SOLD');
  assert.equal(ctx(s, 'technical').price.amount, lots[0].commercial.price); assert.equal(ctx(s, 'client').price.amount, lots[0].commercial.price);
  assert.equal(PV.priceVM(ctx(s, 'broker'), 'broker').label, 'Último preço de tabela'); assert.equal(PV.priceVM(ctx(s, 'client'), 'client').hidden, true);
  assert.equal(PV.renderPriceBlock(PV.priceVM(ctx(s, 'client'), 'client')), '');
  assert.equal(PV.priceVM(ctx(mk('UNKNOWN'), 'client'), 'client').label, 'Preço de tabela'); // "Status a confirmar, preço atual R$ Y"
  assert.equal(AV.priceDisplayFor('SOLD', 'client', { priceDisplay: { default: 'SHOW', SOLD: 'SHOW' } }), 'SHOW');
});
test('client mode: BLOCKED reads "Indisponível no momento", internal reason hidden; technical mode shows revision/source/dataState', () => {
  const b = { ...mk('BLOCKED'), availability: { ...mk('BLOCKED').availability, reason: 'LEGAL_HOLD' } };
  const c = PV.availabilityVM(b, { mode: 'client' }); assert.equal(c.label, 'Indisponível no momento'); assert.equal(c.reason, null); assert.equal(c.technicalMeta, null);
  const t = PV.availabilityVM(b, { mode: 'technical' }); assert.equal(t.reason, 'Pendência jurídica'); deq(t.technicalMeta, { revision: 7, sourceId: 'sales-mirror', dataState: 'VALID', resolutionMode: 'CURRENT', updatedAt: AT });
});

// ------------------------------------------------------------------ freshness, sources, conflicts
test('freshness policy: never upgrades to FRESH; time limits make STALE/EXPIRED; UNKNOWN status → UNKNOWN freshness', () => {
  const a = { ...AV.EMPTY(), status: 'AVAILABLE', updatedAt: '2026-10-01T00:00:00Z', freshness: 'FRESH', sourceId: 's' };
  assert.equal(AV.evaluateFreshness(a, {}, NOW), 'FRESH');
  assert.equal(AV.evaluateFreshness(a, { staleAfterMs: 86400000 }, NOW), 'STALE');
  assert.equal(AV.evaluateFreshness(a, { staleAfterMs: 86400000, expireAfterMs: 3 * 86400000 }, NOW), 'EXPIRED');
  assert.equal(AV.evaluateFreshness({ ...a, freshness: 'STALE' }, {}, NOW), 'STALE');
  assert.equal(AV.evaluateFreshness({ ...a, status: 'UNKNOWN' }, {}, NOW), 'UNKNOWN');
  const fp = AV.freshnessPolicyOf(App.config.DEVELOPMENTS[0]); assert.equal(fp.expireAfterMs, null); // no universal TTL hard-coded
});
test('ConflictedAvailabilitySources: no silent resolution without an authoritative source; explicit policy resolves', () => {
  const obs = [{ sourceId: 'a', status: 'AVAILABLE', updatedAt: '2026-10-08T10:00:00Z' }, { sourceId: 'b', status: 'SOLD', updatedAt: '2026-10-08T11:00:00Z' }];
  const r = AV.resolveSources(obs); assert.equal(r.status, 'UNKNOWN'); assert.equal(r.dataState, 'CONFLICTED'); assert.equal(r.candidates.length, 2);
  const w = AV.resolveSources(obs, { conflictResolutionMode: 'AUTHORITATIVE_SOURCE_WINS', authoritativeSources: ['a'] }); assert.equal(w.status, 'AVAILABLE'); assert.ok(w.warnings.includes('CONFLICT_RESOLVED_BY_AUTHORITY'));
  const c = { ...mk('UNKNOWN'), availability: { ...AV.EMPTY(), status: 'UNKNOWN', dataState: 'CONFLICTED' } };
  assert.equal(AV.offerability(c).offerability, 'NEEDS_CONFIRMATION'); assert.equal(PV.availabilityVM(c).label, 'Status com divergência — confirmar');
  assert.equal(AV.resolveSources([{ sourceId: 'a', status: 'SOLD' }, { sourceId: 'b', status: 'SOLD' }]).dataState, 'VALID');
});

// ------------------------------------------------------------------ snapshot / manifest / change set / events / diagnostics
test('real data: snapshot of 498 lots, all UNKNOWN (UNKNOWN_SOURCE), offerable 0, status counts never read pricing', () => {
  const s = AV.snapshotFromLots(lots, { developmentId: 'viva-juara', revision: 0 });
  assert.equal(s.statusCounts.UNKNOWN, 498); assert.equal(s.dataStateCounts.UNKNOWN_SOURCE, 498);
  const noPrice = AV.snapshotFromLots(lots.map(l => ({ ...l, commercial: { ...l.commercial, price: null } })), { developmentId: 'viva-juara', revision: 0 });
  assert.equal(noPrice.checksum, s.checksum); deq(noPrice.statusCounts, s.statusCounts);
  const d = AV.diagnostics(s); assert.equal(d.offerableCount, 0); assert.equal(d.unknownCount, 498); assert.equal(d.availableCount, 0);
});
test('checksum: stable order (lotId-sorted), changes when a status changes; manifest sync', () => {
  const st = { L2: { status: 'SOLD', sourceId: 's', updatedAt: AT }, L1: { status: 'AVAILABLE', sourceId: 's', updatedAt: AT, freshness: 'FRESH' } };
  const a = AV.buildSnapshot({ developmentId: 'd', revision: 3 }, st), b = AV.buildSnapshot({ developmentId: 'd', revision: 3 }, { L1: st.L1, L2: st.L2 });
  assert.equal(a.checksum, b.checksum); assert.ok(Object.isFrozen(a));
  const c = AV.buildSnapshot({ developmentId: 'd', revision: 4 }, { ...st, L1: { ...st.L1, status: 'RESERVED' } }); assert.notEqual(c.checksum, a.checksum);
  const ma = AV.manifestOf(a), mc = AV.manifestOf(c, a); assert.equal(AV.needsSync(ma, AV.manifestOf(b)), false); assert.equal(AV.needsSync(ma, mc), true); assert.equal(mc.changedLotCountSincePrevious, 1);
});
test('change set + events: status/freshness/conflict flags, never a price flag; events carry no price; invalidation spares Fit and price', () => {
  const a = AV.buildSnapshot({ developmentId: 'd', revision: 1 }, { L1: { status: 'AVAILABLE', sourceId: 's', freshness: 'FRESH', updatedAt: AT }, L2: { status: 'AVAILABLE', sourceId: 's', freshness: 'FRESH', updatedAt: AT } });
  const b = AV.buildSnapshot({ developmentId: 'd', revision: 2 }, { L1: { status: 'RESERVED', sourceId: 's', freshness: 'FRESH', updatedAt: AT }, L2: { status: 'UNKNOWN', dataState: 'CONFLICTED' } });
  const cs = AV.diff(a, b, { now: NOW }); deq(cs.changedLotIds, ['L1', 'L2']); assert.equal(cs.summary.transitions['AVAILABLE->RESERVED'], 1);
  assert.ok(cs.changes[1].flags.includes('CONFLICT_DETECTED')); assert.ok(!Object.keys(AV.ChangeFlag).some(f => /PRICE/.test(f)));
  const ev = AV.eventsOf(cs); assert.equal(ev[0].type, 'AvailabilityRevisionPublished'); assert.ok(ev.some(e => e.type === 'AvailabilityStatusChanged' && e.lotId === 'L1'));
  for (const e of ev) assert.ok(!/price|amount|valor|preco/i.test(JSON.stringify(e)));
  const inv = AV.invalidationOf(cs); assert.equal(inv.fit, false); assert.equal(inv.price, false); assert.equal(inv.priceHistory, false); deq(inv.comparisonStatusCells, ['L1', 'L2']);
});
test('AvailabilityChangeNoPriceChange / PriceChangeNoAvailabilityChange: revisions are independent', async () => {
  const repo = App.repos.LotRepository('viva-juara'); await repo.load();
  const v0 = repo.getDataVersions(), l0 = repo.lotsSync()[0];
  const r = repo.applyAvailabilityFeed({ [l0.identity.id]: { status: 'AVAILABLE' } }, { updatedAt: AT, sourceId: 'sales-mirror' }); assert.ok(r.applied, JSON.stringify(r.errors || r.reason));
  const v1 = repo.getDataVersions(), l1 = repo.lotsSync().find(l => l.identity.id === l0.identity.id);
  assert.equal(v1.priceTableVersion, v0.priceTableVersion); assert.equal(l1.commercial.price, l0.commercial.price); assert.notEqual(v1.availabilityRevision, v0.availabilityRevision);
  const t = { ...App.config.DEVELOPMENTS[0].priceTables[0], id: 'tabela-2027', version: '2027-01-10', createdAt: '2027-01-10', pricePerM2: 1300 };
  const r2 = repo.applyPriceTable(t); assert.ok(r2.applied !== false);
  const v2 = repo.getDataVersions(), l2 = repo.lotsSync().find(l => l.identity.id === l0.identity.id);
  assert.equal(v2.availabilityRevision, v1.availabilityRevision); assert.equal(l2.availability.status, 'AVAILABLE'); assert.equal(l2.availability.revision, l1.availability.revision); assert.notEqual(l2.commercial.price, l1.commercial.price);
  // the new published version feeds the history automatically (no manual entry) and the status does not erase it
  const h = PH.forDevelopment('viva-juara', { repository: { listPublishedVersions: () => PH.versionsFrom({ priceTables: [App.config.DEVELOPMENTS[0].priceTables[0], t] }), complete: true } }).lotHistory(l2, { asOf: '2027-02-01' });
  assert.equal(h.pointCount, 2); assert.equal(PH.summarize(h).calculationStatus, 'CALCULATED');
});

// ------------------------------------------------------------------ validators, feed adapter, caches, resolver
test('transition validator: optimistic concurrency (REVISION_CONFLICT), reason required, SOLD reopen blocked, read-only warning', () => {
  const cur = { ...AV.EMPTY(), status: 'AVAILABLE', revision: 100, sourceId: 's', updatedAt: AT };
  assert.equal(AV.validateTransition(cur, 'RESERVED', { expectedRevision: 100 }).allowed, true);
  const c = AV.validateTransition(cur, 'RESERVED', { expectedRevision: 99 }); assert.equal(c.allowed, false); assert.equal(c.errors[0].code, 'REVISION_CONFLICT');
  assert.ok(AV.validateTransition(cur, 'BLOCKED', { expectedRevision: 100 }).errors.some(e => e.code === 'REASON_REQUIRED'));
  assert.ok(AV.validateTransition({ ...cur, status: 'SOLD' }, 'AVAILABLE', { expectedRevision: 100 }).errors.some(e => e.code === 'INVALID_TRANSITION'));
  assert.ok(AV.validateTransition(cur, 'RESERVED', { expectedRevision: 100 }).warnings.includes('READ_ONLY_NO_AUTHORITATIVE_BACKEND'));
});
test('batch validator: unknown lot, duplicates, invalid status, monotonic revision, illegal transition, idempotent duplicate batch, price ignored', () => {
  const cur = AV.buildSnapshot({ developmentId: 'd', revision: 5 }, { L1: { status: 'SOLD', sourceId: 's', updatedAt: AT } }); cur.lastSourceHash; // frozen
  const known = new Set(['L1', 'L2']);
  const bad = AV.validateBatch({ revision: 5, items: [{ lotId: 'L9', status: 'AVAILABLE' }, { lotId: 'L2', status: 'XX' }, { lotId: 'L2', status: 'SOLD' }, { lotId: 'L1', status: 'AVAILABLE' }] }, { knownLotIds: known, current: cur });
  const codes = bad.errors.map(e => e.code); for (const c of ['UNKNOWN_LOT', 'UNKNOWN_ENUM', 'DUPLICATE_LOT', 'INVALID_TRANSITION', 'REVISION_NOT_MONOTONIC']) assert.ok(codes.includes(c), c);
  const ok = AV.validateBatch({ revision: 6, items: [{ lotId: 'L2', status: 'RESERVED', price: 1 }] }, { knownLotIds: known, current: cur }); assert.ok(ok.ok); assert.ok(ok.warnings.includes('PRICE_FIELD_IGNORED'));
  const dup = AV.validateBatch({ revision: 6, sourceRef: { sourceHash: 'h1' }, items: [] }, { current: { ...cur, lastSourceHash: 'h1' } }); assert.equal(dup.duplicate, true); assert.equal(dup.apply, false);
});
test('feed adapter: legacy codes mapped, unknown codes → UNKNOWN with warning, price columns ignored (pricing untouched)', () => {
  const f = AV.adaptFeed([{ lot: 'A1', situacao: 'Disponível', preco: 1 }, { lot: 'A2', status: 'VEND' }, { lot: 'A3', st: 'talvez' }], { sourceId: 'planilha', sourceType: 'OFFICIAL_SPREADSHEET' },
    { revision: 2, resolveLotId: c => (lots.find(l => l.identity.code === c) || {}).identity?.id || null });
  deq(f.items.map(i => i.status), ['AVAILABLE', 'SOLD', 'UNKNOWN']); assert.ok(f.items.every(i => !('price' in i) && !('preco' in i)));
  deq(f.warnings.map(w => w.code).sort(), ['PRICE_FIELD_IGNORED', 'UNKNOWN_STATUS_CODE']); assert.equal(f.sourceRef.sourceType, 'OFFICIAL_SPREADSHEET');
});
test('caches are independent: clearing the price history cache keeps the availability cache and vice versa', () => {
  const ac = AV.createCache(), pc = PH.createCache(), snap = AV.snapshotFromLots(lots, { developmentId: 'viva-juara', revision: 3 });
  ac.put(snap); const svc = PH.createService({ developmentId: 'viva-juara', versions: PH.forDevelopment('viva-juara').versions(), cache: pc }); svc.lotHistory(lots[0], { asOf: '2026-10-08' });
  pc.clear(); assert.equal(ac.size(), 1); assert.equal(ac.latestKnownRevision('viva-juara'), 3);
  svc.lotHistory(lots[0], { asOf: '2026-10-08' }); ac.clear(); assert.equal(pc.size(), 1); assert.equal(ac.current('viva-juara'), null);
});
test('resolver: CURRENT / EXPLICIT_REVISION / OFFLINE_LAST_KNOWN (never FRESH offline, warning)', () => {
  const ac = AV.createCache(), s = AV.buildSnapshot({ developmentId: 'd', revision: 9 }, { L1: { status: 'AVAILABLE', freshness: 'FRESH', sourceId: 's', updatedAt: AT } }); ac.put(s);
  assert.equal(AV.resolve(s, { lotId: 'L1' }).freshness, 'FRESH');
  const off = AV.resolve(ac, { developmentId: 'd', lotId: 'L1', offline: true }); assert.equal(off.resolutionMode, 'OFFLINE_LAST_KNOWN'); assert.equal(off.freshness, 'STALE'); assert.ok(off.warnings.includes('OFFLINE_LAST_KNOWN_STATUS'));
  assert.equal(AV.offerability(off).offerability, 'NEEDS_CONFIRMATION');
  assert.equal(AV.resolve(ac, { developmentId: 'd', lotId: 'L1', revision: 9 }).resolutionMode, 'EXPLICIT_REVISION');
  assert.equal(AV.resolve(ac, { developmentId: 'd', lotId: 'L1', revision: 8 }).status, 'UNKNOWN'); // unknown revision: nothing invented
  assert.equal(AV.resolve(s, { lotId: 'L404' }).status, 'UNKNOWN');
});

// ------------------------------------------------------------------ consumers: filters, recommendation, Fit, comparison, finance
const withStatus = (l, status, price) => ({ ...l, availability: { ...l.availability, status, freshness: status === 'UNKNOWN' ? 'UNKNOWN' : 'FRESH' }, commercial: price === undefined ? l.commercial : { ...l.commercial, price } });
test('filters: status filter has no price dependency; price filter has no status dependency; combined only by explicit AND', () => {
  const F = App.filters, ls = lots.map((l, i) => withStatus(l, i % 2 ? 'AVAILABLE' : 'SOLD', i % 3 ? l.commercial.price : null));
  const run = (s, x = ls) => F.run(x, F.compile(s).query, {}).matchedIds;
  const st = run({ statuses: ['AVAILABLE'] }); assert.equal(st.size, ls.filter(l => l.availability.status === 'AVAILABLE').length); // includes AVAILABLE lots without price
  assert.ok(ls.some(l => l.availability.status === 'AVAILABLE' && l.commercial.price == null && st.has(l.identity.id)));
  const pr = run({ priceMax: 600000 }); assert.equal(pr.size, ls.filter(l => l.commercial.price != null && l.commercial.price <= 600000).length); // includes SOLD
  const both = run({ statuses: ['AVAILABLE'], priceMax: 600000 }); assert.equal(both.size, [...st].filter(id => pr.has(id)).length);
  assert.equal(run({}).size, ls.length);
});
test('recommendation: SOLD excluded (Fit preserved), UNKNOWN in review, AVAILABLE without price passes availability (budget cannot be confirmed)', () => {
  const p = App.fit.buildProfile({ preferences: { privacy: 3, quiet: 2 } }), fctx = App.fit.contextFor(lots), l = lots[10];
  assert.equal(App.fit.fitLot(p, withStatus(l, 'SOLD'), fitCfg, fctx).fitScore, App.fit.fitLot(p, withStatus(l, 'AVAILABLE'), fitCfg, fctx).fitScore);
  const ls = [withStatus(lots[10], 'SOLD'), withStatus(lots[11], 'UNKNOWN'), withStatus(lots[12], 'AVAILABLE', null)];
  const r = App.recommendation.recommend({ developmentId: 'viva-juara', profile: p, constraints: [App.recommendation.constraint('budgetMax', 2000000, pol)], lots: ls, policy: pol, fitCfg, availabilityPolicy: {}, dataVersions: {} });
  const ex = r.excluded.find(x => x.lotId === lots[10].identity.id); assert.equal(ex.reasonCode, 'SOLD');
  assert.ok(!r.recommendations.some(x => x.lotId === lots[11].identity.id)); // UNKNOWN never recommended as available
  const npId = lots[12].identity.id, inReview = r.reviewCandidates.some(x => x.lotId === npId), inExcluded = r.excluded.find(x => x.lotId === npId);
  assert.ok(inReview || (inExcluded && inExcluded.stage !== 'SYSTEM_ELIGIBILITY'), 'missing price never fails the availability stage');
});
test('comparison: a candidate stays when it becomes SOLD; status cell updates, price cell unchanged', () => {
  const before = [lots[0], lots[1]], after = [withStatus(lots[0], 'SOLD'), lots[1]];
  const rows = [{ key: 'status', get: x => x.availability.status }, { key: 'price', get: x => x.commercial.price, better: 'min' }];
  const a = App.services.comparison.compare(before, rows), b = App.services.comparison.compare(after, rows);
  assert.equal(b[0].values.length, 2); assert.equal(b[0].values[0], 'SOLD'); deq(b[1].values, a[1].values);
});
test('financial simulation: same formula result for SOLD and AVAILABLE; only capabilities/warnings change', () => {
  const plans = App.config.DEVELOPMENTS[0].priceTables[0].plans, s1 = App.services.finance.simulate({ price: lots[0].commercial.price, downPaymentPct: 12, plans });
  const s2 = App.services.finance.simulate({ price: withStatus(lots[0], 'SOLD').commercial.price, downPaymentPct: 12, plans });
  assert.equal(s1.plans[0].monthly, s2.plans[0].monthly);
  assert.equal(ctx(mk('SOLD')).simulation.consultative, true); assert.equal(ctx(mk('AVAILABLE')).simulation.consultative, false);
});
test('history survives SOLD: the price history of a sold lot is unchanged', () => {
  const svc = PH.forDevelopment('viva-juara');
  deq(PH.summarize(svc.lotHistory(withStatus(lots[0], 'SOLD'), { asOf: '2026-10-08' })), PH.summarize(svc.lotHistory(lots[0], { asOf: '2026-10-08' })));
});
test('accessibility: status is never colour-only (text label always rendered; stale has its own token and text)', () => {
  for (const s of AV.ORDER) for (const f of ['FRESH', 'STALE']) {
    const html = PV.renderStatusBlock(PV.availabilityVM(mk(s, 'VALID', { freshness: f }), { mode: 'broker' }));
    assert.match(html, /<\/span>[^<]+<\/p>/, s + f);
  }
  assert.ok(Object.values(PV.STATUS_LABEL).every(Boolean));
});
test('existing topic-8 API unchanged: exports kept, EMPTY UNKNOWN, isOfferable/AVAILABLE only', () => {
  for (const k of ['TRANSITIONS', 'DEFAULT_POLICY', 'ORDER', 'LEGACY_CODES', 'LEGACY_FLAGS', 'policyOf', 'normalizeAvailability', 'validateState', 'canTransition', 'transition', 'isOfferable', 'isSelectableForSale', 'isVisibleOnMap',
    'isEligibleForRecommendation', 'simulationEligibility', 'isReservationExpired', 'primaryAction', 'counts', 'EMPTY']) assert.ok(k in AV, k);
  assert.equal(AV.isOfferable('UNKNOWN'), false); assert.equal(AV.EMPTY().status, 'UNKNOWN');
});
