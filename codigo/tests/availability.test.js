'use strict';
// Availability: transition matrix of the state machine, UNKNOWN default without a feed, feed application, client/broker labels.
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness.js');

const plain = x => JSON.parse(JSON.stringify(x));
const codes = list => plain(list).map(e => e.code);
const AT = '2026-10-07T12:00:00.000Z';

let App, AV;
test.before(() => { App = load(); AV = App.availability; });
const freshRepo = async () => { const r = App.repos.LotRepository('viva-juara'); await r.load(); return r; };

// ------------------------------------------------------------------ transition matrix (the contract, written out explicitly)
const STATUSES = ['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN'];
const ALLOWED = {
  UNKNOWN: ['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN'],
  AVAILABLE: ['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN'],
  RESERVED: ['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNKNOWN'],
  PROPOSAL: ['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNKNOWN'],
  BLOCKED: ['AVAILABLE', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN'],
  UNAVAILABLE: ['AVAILABLE', 'BLOCKED', 'UNAVAILABLE', 'UNKNOWN'],
  SOLD: ['SOLD', 'UNKNOWN']
};

test('TRANSITIONS table is frozen and matches the documented contract', () => {
  assert.ok(Object.isFrozen(AV.TRANSITIONS));
  assert.deepEqual(Object.keys(AV.TRANSITIONS).sort(), STATUSES.slice().sort());
  for (const from of STATUSES) {
    const expected = ALLOWED[from].filter(s => s !== from && s !== 'UNKNOWN').sort();
    assert.deepEqual(plain(AV.TRANSITIONS[from]).sort(), expected, from);
  }
  assert.deepEqual(plain(AV.TRANSITIONS.SOLD), []);
});

for (const from of STATUSES) for (const to of STATUSES) {
  const ok = ALLOWED[from].includes(to);
  test(`canTransition ${from} → ${to}: ${ok ? 'allowed' : 'rejected'}`, () => {
    const r = AV.canTransition(from, to);
    assert.equal(r.ok, ok);
    if (!ok) assert.equal(typeof r.reason, 'string');
    // transition() agrees with canTransition() and never mutates its input
    const state = Object.freeze({ ...AV.EMPTY(), status: from, revision: 4 });
    const t = AV.transition(state, to, { at: AT, sourceId: 'test', reason: to === 'BLOCKED' || to === 'UNAVAILABLE' ? 'OTHER' : undefined });
    assert.equal(t.ok, ok);
    assert.equal(state.status, from);
    if (ok) {
      assert.equal(t.state.status, to);
      assert.equal(t.state.revision, 5);
      assert.equal(t.state.updatedAt, AT);
      assert.deepEqual(plain(t.history), { fromStatus: from, toStatus: to, changedAt: AT, sourceId: 'test', reason: t.state.reason, revision: 5 });
    } else {
      assert.equal(t.error.code, 'INVALID_TRANSITION');
      assert.equal(t.error.from, from);
      assert.equal(t.error.to, to);
    }
  });
}

test('SOLD → AVAILABLE is rejected by default with an explicit message', () => {
  const r = AV.canTransition('SOLD', 'AVAILABLE');
  assert.equal(r.ok, false);
  assert.match(r.reason, /correção administrativa/);
  assert.equal(AV.DEFAULT_POLICY.allowSoldReopen, false);
  assert.equal(AV.policyOf(App.config.DEVELOPMENTS[0]).allowSoldReopen, false);
});

test('SOLD → AVAILABLE only as an authorized administrative correction with a reason, when the policy allows it', () => {
  const pol = { ...AV.DEFAULT_POLICY, allowSoldReopen: true };
  assert.equal(AV.canTransition('SOLD', 'AVAILABLE', { authorized: true, reason: 'OTHER' }).ok, false, 'default policy still blocks');
  assert.equal(AV.canTransition('SOLD', 'AVAILABLE', { authorized: false, reason: 'OTHER' }, pol).ok, false);
  assert.equal(AV.canTransition('SOLD', 'AVAILABLE', { authorized: true }, pol).ok, false);
  const ok = AV.canTransition('SOLD', 'AVAILABLE', { authorized: true, reason: 'OTHER' }, pol);
  assert.deepEqual(plain(ok), { ok: true, exceptional: true });
  // the exception is only for SOLD → AVAILABLE
  assert.equal(AV.canTransition('SOLD', 'RESERVED', { authorized: true, reason: 'OTHER' }, pol).ok, false);
  const t = AV.transition({ ...AV.EMPTY(), status: 'SOLD', revision: 1 }, 'AVAILABLE', { authorized: true, reason: 'OTHER', at: AT }, pol);
  assert.equal(t.ok, true);
  assert.equal(t.exceptional, true);
  assert.equal(t.state.reason, 'OTHER');
  assert.ok(App.lifecycle.log.some(e => e.event === 'sold lot reopened'));
});

test('transition: revision ordering, state-specific fields and validation', () => {
  const base = { ...AV.EMPTY(), status: 'AVAILABLE', revision: 5 };
  const stale = AV.transition(base, 'RESERVED', { revision: 5 });
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'STALE_REVISION');
  assert.equal(AV.transition(base, 'RESERVED', { revision: 4 }).error.code, 'STALE_REVISION');
  assert.equal(AV.transition(base, 'RESERVED', { revision: 6 }).state.revision, 6);
  // reservedUntil only in RESERVED, proposalId only in PROPOSAL, reason only in BLOCKED/UNAVAILABLE
  const res = AV.transition(base, 'RESERVED', { reservedUntil: '2026-10-10T00:00:00Z', proposalId: 'P1', reason: 'OTHER', at: AT }).state;
  assert.equal(res.reservedUntil, '2026-10-10T00:00:00Z'); assert.equal(res.proposalId, null); assert.equal(res.reason, null);
  const prop = AV.transition(base, 'PROPOSAL', { reservedUntil: '2026-10-10T00:00:00Z', proposalId: 'P1', at: AT }).state;
  assert.equal(prop.proposalId, 'P1'); assert.equal(prop.reservedUntil, null);
  const blk = AV.transition(base, 'BLOCKED', { reason: 'LEGAL_HOLD', at: AT }).state;
  assert.equal(blk.reason, 'LEGAL_HOLD');
  // leaving RESERVED clears the reservation
  const back = AV.transition(res, 'AVAILABLE', { at: AT }).state;
  assert.equal(back.reservedUntil, null);
  // invalid reason / timestamp / target
  assert.equal(AV.transition(base, 'BLOCKED', { reason: 'BECAUSE', at: AT }).error.code, 'INVALID_STATE');
  assert.equal(AV.transition(base, 'RESERVED', { at: 'not a date' }).error.code, 'INVALID_STATE');
  assert.equal(AV.transition(base, 'GONE', { at: AT }).error.code, 'INVALID_TRANSITION');
  // a missing state starts from UNKNOWN
  const first = AV.transition(null, 'SOLD', { at: AT });
  assert.equal(first.ok, true); assert.equal(first.history.fromStatus, 'UNKNOWN'); assert.equal(first.state.revision, 1);
});

test('validateState: required fields and state-only fields', () => {
  const E = AV.EMPTY();
  assert.deepEqual(codes(AV.validateState(E)), []);
  assert.deepEqual(codes(AV.validateState(null)), ['UNKNOWN_ENUM']);
  assert.deepEqual(codes(AV.validateState({ ...E, status: 'MAYBE' })), ['UNKNOWN_ENUM']);
  assert.deepEqual(codes(AV.validateState({ ...E, status: 'AVAILABLE', reservedUntil: AT })), ['FIELD_NOT_ALLOWED']);
  assert.deepEqual(codes(AV.validateState({ ...E, status: 'RESERVED', proposalId: 'x' })), ['FIELD_NOT_ALLOWED']);
  assert.deepEqual(codes(AV.validateState({ ...E, status: 'BLOCKED', reason: 'NOPE' })), ['UNKNOWN_ENUM']);
  assert.deepEqual(codes(AV.validateState({ ...E, status: 'SOLD', updatedAt: 'yesterday' })), ['INVALID_TIMESTAMP']);
  assert.deepEqual(codes(AV.validateState({ ...E, status: 'SOLD', revision: -1 })), ['INVALID_REVISION']);
  assert.deepEqual(codes(AV.validateState({ ...E, status: 'SOLD', revision: 1.5 })), ['INVALID_REVISION']);
});

test('EMPTY state is UNKNOWN with no timestamp, source or freshness', () => {
  assert.deepEqual(plain(AV.EMPTY()), { status: 'UNKNOWN', updatedAt: null, sourceId: null, revision: 0, reservedUntil: null, proposalId: null, reason: null, notes: null, freshness: 'UNKNOWN' });
  assert.notEqual(AV.EMPTY(), AV.EMPTY()); // a new object every time
});

// ------------------------------------------------------------------ policy-derived flags
test('policy flags: offerable, visible, recommendable, simulable, primary action', () => {
  const P = AV.DEFAULT_POLICY;
  assert.deepEqual(STATUSES.filter(s => AV.isOfferable(s)), ['AVAILABLE']);
  assert.equal(AV.isOfferable('PROPOSAL', { ...P, proposalCountsAsOfferable: true }), true);
  assert.equal(AV.isOfferable('UNKNOWN'), false);
  assert.equal(AV.isEligibleForRecommendation('UNKNOWN'), false);
  assert.equal(AV.isEligibleForRecommendation('AVAILABLE'), true);
  assert.ok(STATUSES.every(s => AV.isVisibleOnMap(s)));
  assert.equal(AV.isVisibleOnMap('SOLD', { ...P, soldVisibleOnMap: false }), false);
  assert.equal(AV.isVisibleOnMap('UNKNOWN', { ...P, unknownVisibleOnMap: false }), false);
  assert.deepEqual(plain(AV.simulationEligibility('AVAILABLE')), { allowed: true, sellAllowed: true, warning: null });
  const u = AV.simulationEligibility('UNKNOWN');
  assert.equal(u.allowed, true); assert.equal(u.sellAllowed, false); assert.match(u.warning, /sujeita a confirmação/);
  assert.equal(AV.simulationEligibility('SOLD').sellAllowed, false);
  assert.equal(AV.simulationEligibility('SOLD', { ...P, simulateNonOfferable: false }).allowed, false);
  assert.equal(AV.primaryAction('AVAILABLE'), 'SIMULATE');
  assert.equal(AV.primaryAction('UNKNOWN'), 'CONFIRM_AVAILABILITY');
  assert.equal(AV.primaryAction('SOLD'), 'DETAILS');
  const now = Date.parse(AT);
  assert.equal(AV.isReservationExpired({ status: 'RESERVED', reservedUntil: '2026-10-07T11:00:00Z' }, now), true);
  assert.equal(AV.isReservationExpired({ status: 'RESERVED', reservedUntil: '2026-10-07T13:00:00Z' }, now), false);
  assert.equal(AV.isReservationExpired({ status: 'SOLD', reservedUntil: '2026-10-07T11:00:00Z' }, now), false);
});

// ------------------------------------------------------------------ UNKNOWN default without a feed
test('no availability feed: all 498 lots UNKNOWN (never AVAILABLE), freshness UNKNOWN', async () => {
  const repo = await freshRepo();
  const lots = repo.lotsSync();
  assert.equal(lots.length, 498);
  assert.deepEqual(plain(AV.counts(lots)), { AVAILABLE: 0, RESERVED: 0, PROPOSAL: 0, BLOCKED: 0, SOLD: 0, UNAVAILABLE: 0, UNKNOWN: 498 });
  for (const l of lots) {
    assert.equal(l.availability.status, 'UNKNOWN');
    assert.equal(l.availability.freshness, 'UNKNOWN');
    assert.equal(l.availability.updatedAt, null);
    assert.equal(App.model.getFieldProvenance(l, 'availability.status').status, 'UNKNOWN');
  }
  const av = repo.getLayers().availability;
  assert.equal(av.revision, 0);
  assert.equal(av.updatedAt, null);
  assert.equal(repo.getFreshness().availability, 'UNKNOWN');
  const sel = App.selectors(repo, App.config.DEVELOPMENTS[0]);
  const st = { ...App.store.INITIAL, dataRevision: 1 };
  assert.equal(sel.selectHasAvailabilityFeed(st), false);
  assert.equal(sel.selectOfferableLotIds(st).size, 0);
  // the offline helper used when no last-known value exists also yields UNKNOWN
  const u = App.offline.unknownAvailability({ id: 'viva-juara' }, repo.getLayers().static);
  assert.ok(Object.values(u.lots).every(x => x.availability.status === 'UNKNOWN'));
});

test('an empty feed in lots.json (st present) is mapped; a known status gets provenance and a timestamp', () => {
  const RAW = require('fs').readFileSync(require('path').join(require('./harness.js').DATA, 'lots.json'), 'utf8');
  const raw = JSON.parse(RAW).slice(0, 3);
  raw[0].st = 'VENDIDO'; raw[1].st = 'reservado';
  const dev = App.config.DEVELOPMENTS[0];
  const res = App.repos.buildSnapshotsFromLegacy(raw, dev, App.repos.CommercialRepository('viva-juara'), AT);
  const av = res.layers.availability;
  assert.equal(av.updatedAt, AT); // a feed exists now
  assert.equal(av.sourceId, 'lots.json');
  const st = Object.values(av.lots).map(x => x.availability.status);
  assert.deepEqual(plain(st), ['SOLD', 'RESERVED', 'UNKNOWN']);
});

// ------------------------------------------------------------------ feed application through the repository
test('applyAvailabilityFeed: valid moves applied as one new revision, FRESH, with provenance; absent lots keep their state', async () => {
  const repo = await freshRepo();
  const r1 = repo.applyAvailabilityFeed({ B79: { status: 'AVAILABLE' }, A1: { status: 'RESERVED', reservedUntil: '2026-10-20T00:00:00Z' } }, { updatedAt: AT, sourceId: 'crm' });
  assert.equal(r1.applied, true);
  assert.deepEqual(plain(r1.change.changedLotIds).sort(), ['VJ-QA-L0001', 'VJ-QB-L0079']);
  const b = repo.getLotByCode('B79');
  assert.equal(b.availability.status, 'AVAILABLE');
  assert.equal(b.availability.freshness, 'FRESH');
  assert.equal(b.availability.revision, 1);
  assert.equal(b.availability.sourceId, 'crm');
  assert.equal(b.provenance['availability.status'].status, 'CONFIRMED');
  assert.equal(repo.getLotByCode('A1').availability.reservedUntil, '2026-10-20T00:00:00Z');
  assert.equal(repo.getLotByCode('A2').availability.status, 'UNKNOWN');
  assert.equal(repo.getFreshness().availability, 'FRESH');
  const r2 = repo.applyAvailabilityFeed({ B79: { status: 'SOLD' } }, { updatedAt: AT });
  assert.equal(r2.applied, true);
  assert.equal(repo.getLotByCode('B79').availability.status, 'SOLD');
  assert.equal(repo.getLotByCode('A1').availability.status, 'RESERVED'); // absent from the feed → last known state
  assert.equal(repo.getLayers().availability.revision, 2);
});

test('applyAvailabilityFeed: SOLD → AVAILABLE rejected, nothing applied; an invalid move rejects the whole feed atomically', async () => {
  const repo = await freshRepo();
  repo.applyAvailabilityFeed({ B79: { status: 'SOLD' } }, { updatedAt: AT });
  const r = repo.applyAvailabilityFeed({ A1: { status: 'AVAILABLE' }, B79: { status: 'AVAILABLE' } }, { updatedAt: AT });
  assert.equal(r.applied, false);
  assert.deepEqual(codes(r.errors), ['INVALID_TRANSITION']);
  assert.equal(r.errors[0].lotId, 'VJ-QB-L0079');
  assert.equal(repo.getLotByCode('B79').availability.status, 'SOLD');
  assert.equal(repo.getLotByCode('A1').availability.status, 'UNKNOWN', 'the valid move in the same feed is not applied either');
  assert.equal(repo.getLayers().availability.revision, 1);
  const orphan = repo.applyAvailabilityFeed({ Z999: { status: 'SOLD' } }, { updatedAt: AT });
  assert.equal(orphan.applied, false); assert.deepEqual(codes(orphan.errors), ['ORPHAN_LOT']);
});

test('applyAvailabilityFeed: authorized reopening of a sold lot is allowed only with the development policy', async () => {
  const repo = await freshRepo();
  repo.applyAvailabilityFeed({ B79: { status: 'SOLD' } }, { updatedAt: AT });
  assert.equal(repo.applyAvailabilityFeed({ B79: { status: 'AVAILABLE', reason: 'OTHER' } }, { updatedAt: AT, authorized: true }).applied, false);
  const dev = App.config.DEVELOPMENTS[0], saved = dev.availabilityPolicy;
  dev.availabilityPolicy = { ...saved, allowSoldReopen: true };
  try {
    const r = repo.applyAvailabilityFeed({ B79: { status: 'AVAILABLE', reason: 'OTHER' } }, { updatedAt: AT, authorized: true });
    assert.equal(r.applied, true);
    assert.equal(repo.getLotByCode('B79').availability.status, 'AVAILABLE');
  } finally { dev.availabilityPolicy = saved; }
});

test('applyAvailabilityUpdate: an older or equal revision never overwrites a newer one', async () => {
  const repo = await freshRepo();
  repo.applyAvailabilityFeed({ B79: { status: 'RESERVED' } }, { updatedAt: AT });
  const cur = repo.getLayers().availability;
  const older = { ...plain(cur), revision: 0 };
  older.lots['VJ-QB-L0079'] = { availability: { ...AV.EMPTY(), status: 'AVAILABLE', updatedAt: AT } };
  assert.deepEqual(plain(repo.applyAvailabilityUpdate(older)), { applied: false, reason: 'revisão antiga' });
  assert.deepEqual(plain(repo.applyAvailabilityUpdate({ ...older, revision: cur.revision })), { applied: false, reason: 'revisão antiga' });
  assert.equal(repo.getLotByCode('B79').availability.status, 'RESERVED');
});

test('applyAvailabilityUpdate: a snapshot with a forbidden transition is rejected and the current layer marked stale', async () => {
  const repo = await freshRepo();
  repo.applyAvailabilityFeed({ B79: { status: 'SOLD' } }, { updatedAt: AT });
  const next = plain(repo.getLayers().availability); next.revision = 9;
  next.lots['VJ-QB-L0079'].availability.status = 'RESERVED';
  const r = repo.applyAvailabilityUpdate(next);
  assert.equal(r.applied, false);
  assert.ok(codes(r.errors).includes('INVALID_TRANSITION'));
  assert.equal(repo.getLotByCode('B79').availability.status, 'SOLD');
  assert.equal(repo.getLayers().availability.stale, true);
});

test('touch(stale): last known statuses stay, freshness becomes STALE (cannot be confirmed now)', async () => {
  const repo = await freshRepo();
  repo.applyAvailabilityFeed({ B79: { status: 'AVAILABLE' } }, { updatedAt: AT });
  const t = repo.touch('availability', { stale: true });
  assert.equal(t.changed, true);
  const b = repo.getLotByCode('B79');
  assert.equal(b.availability.status, 'AVAILABLE');
  assert.equal(b.availability.freshness, 'STALE');
  assert.equal(repo.getLotByCode('A1').availability.freshness, 'UNKNOWN'); // unknown stays unknown
  const back = repo.touch('availability', { stale: false, source: 'REMOTE', confirmedAt: new Date().toISOString() });
  assert.equal(back.changed, true);
  assert.equal(repo.getLotByCode('B79').availability.freshness, 'FRESH');
});

// BUG (design gap) domain/availability.js:62 + :16 — "losing confirmation" (any → UNKNOWN) is always allowed and UNKNOWN → AVAILABLE is
// always allowed, so a SOLD lot reaches AVAILABLE in two feed revisions without authorization or allowSoldReopen.
test('a SOLD lot cannot be laundered back to AVAILABLE through UNKNOWN without an authorized correction',
  {}, async () => {
    const repo = await freshRepo();
    assert.equal(repo.applyAvailabilityFeed({ B79: { status: 'SOLD' } }, { updatedAt: AT }).applied, true);
    repo.applyAvailabilityFeed({ B79: { status: 'UNKNOWN' } }, { updatedAt: AT });
    repo.applyAvailabilityFeed({ B79: { status: 'AVAILABLE' } }, { updatedAt: AT });
    assert.notEqual(repo.getLotByCode('B79').availability.status, 'AVAILABLE');
  });

// ------------------------------------------------------------------ labels: client vs broker (App.vm.statusVM)
const lotWith = a => ({ identity: { code: 'B79' }, availability: { ...AV.EMPTY(), ...a } });
const recent = () => new Date(Date.now() - 5 * 60e3).toISOString();

test('statusVM: every status has a Portuguese label and a color, in both modes', () => {
  const labels = { AVAILABLE: 'Disponível', RESERVED: 'Reservado', PROPOSAL: 'Em proposta', BLOCKED: 'Bloqueado', SOLD: 'Vendido', UNAVAILABLE: 'Indisponível', UNKNOWN: 'Status não confirmado' };
  for (const s of STATUSES) for (const mode of ['broker', 'client']) {
    const vm = App.vm.statusVM(lotWith({ status: s, freshness: s === 'UNKNOWN' ? 'UNKNOWN' : 'FRESH', updatedAt: s === 'UNKNOWN' ? null : recent() }), mode);
    assert.equal(vm.code, s);
    assert.equal(vm.label, labels[s], `${s}/${mode}`);
    assert.ok(vm.color, `${s} color`);
    assert.equal(vm.offerable, s === 'AVAILABLE');
  }
});

test('statusVM: UNKNOWN never reads as available; wording differs by mode', () => {
  const b = App.vm.statusVM(lotWith({ status: 'UNKNOWN' }), 'broker');
  const c = App.vm.statusVM(lotWith({ status: 'UNKNOWN' }), 'client');
  assert.equal(b.warn, true); assert.equal(c.warn, true);
  assert.equal(b.note, 'Sem espelho de vendas: confirme com a loteadora');
  assert.equal(c.note, 'Disponibilidade sujeita a confirmação');
  assert.doesNotMatch(c.label, /^Disponível/);
});

test('statusVM: AVAILABLE not confirmed now → qualified label (client and broker wording)', () => {
  for (const f of ['STALE', 'EXPIRED']) {
    const b = App.vm.statusVM(lotWith({ status: 'AVAILABLE', freshness: f, updatedAt: recent() }), 'broker');
    const c = App.vm.statusVM(lotWith({ status: 'AVAILABLE', freshness: f, updatedAt: recent() }), 'client');
    assert.equal(b.label, 'Disponível, não confirmado agora');
    assert.equal(c.label, 'Disponível (sujeito a confirmação)');
    assert.equal(c.note, 'Disponibilidade sujeita a confirmação');
    assert.match(b.note, f === 'STALE' ? /^Disponibilidade não confirmada · última atualização/ : /^Informação vencida, confirme antes de oferecer/);
    assert.equal(b.warn, true); assert.equal(c.warn, true);
  }
  const fresh = App.vm.statusVM(lotWith({ status: 'AVAILABLE', freshness: 'FRESH', updatedAt: recent() }), 'broker');
  assert.equal(fresh.label, 'Disponível'); assert.equal(fresh.warn, false); assert.match(fresh.note, /^Atualizado /);
  assert.equal(App.vm.statusVM(lotWith({ status: 'AVAILABLE', freshness: 'FRESH', updatedAt: recent() }), 'client').note, null);
});

test('statusVM: internal details (reason, reservation deadline) are hidden in client mode', () => {
  const blk = lotWith({ status: 'BLOCKED', freshness: 'FRESH', updatedAt: recent(), reason: 'LEGAL_HOLD', notes: 'interno' });
  assert.equal(App.vm.statusVM(blk, 'broker').reason, 'Pendência jurídica');
  assert.equal(App.vm.statusVM(blk, 'client').reason, null);
  const res = lotWith({ status: 'RESERVED', freshness: 'FRESH', updatedAt: recent(), reservedUntil: '2026-10-20T15:00:00Z' });
  assert.equal(typeof App.vm.statusVM(res, 'broker').reservedUntil, 'string');
  assert.equal(App.vm.statusVM(res, 'client').reservedUntil, null);
  for (const mode of ['broker', 'client']) assert.doesNotMatch(JSON.stringify(App.vm.statusVM(blk, mode)), /interno/);
});
