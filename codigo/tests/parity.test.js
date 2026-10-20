'use strict';
// Parity: the current Fit, Recommendation, Explanation and Filter modules against verbatim copies of the
// versions that existed before topic 13–17 follow-ups (tests/parity/legacy/*.js). New result fields are allowed;
// every field the previous version returned must be identical (ranking, tiers, scores, counts, order, codes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const H = require('./harness.js');

const LEGACY = { 'intelligence/fit.js': 'fit.js', 'intelligence/recommendation.js': 'recommendation.js', 'intelligence/explanation.js': 'explanation.js', 'filters/filters.js': 'filters.js' };
/** same loader as harness.load, with the four modules replaced by their legacy copies (new-only modules skipped) */
function loadLegacy() {
  const ctx = { console, Intl, Date, Math, JSON, Map, Set, Promise, queueMicrotask, setTimeout, clearTimeout, AbortController, structuredClone, TextEncoder,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { hash: '' }, history: { replaceState() {} },
    fetch: async url => { const f = path.join(H.DATA, url); if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => null }; return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) }; } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of H.ORDER) {
    if (f === 'intelligence/reasonCodes.js') continue;
    const p = LEGACY[f] ? path.join(__dirname, 'parity', 'legacy', LEGACY[f]) : path.join(H.SRC, f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: 'legacy:' + f });
    if (f === 'prelude.js') vm.runInContext(require('../scripts/configBundle.js').bundle(), ctx, { filename: 'configs' });
  }
  return ctx.App;
}
const plain = x => x === undefined ? x : JSON.parse(JSON.stringify(x, (k, v) => v instanceof Set ? [...v].sort() : v instanceof Map ? [...v.entries()] : v));
/** every field of `a` (legacy) is in `b` (current) with the same value; `b` may have more fields */
function sub(a, b, p = '$') {
  if (a === null || typeof a !== 'object') { assert.deepEqual(b, a, p); return; }
  assert.ok(b !== null && typeof b === 'object', p + ' missing');
  if (Array.isArray(a)) { assert.ok(Array.isArray(b), p + ' not array'); assert.equal(b.length, a.length, p + '.length'); a.forEach((x, i) => sub(x, b[i], `${p}[${i}]`)); return; }
  for (const k of Object.keys(a)) sub(a[k], b[k], `${p}.${k}`);
}

const W = {};
test.before(async () => {
  for (const [k, App] of [['old', loadLegacy()], ['new', H.load()]]) {
    const repo = App.repos.LotRepository('viva-juara'); await repo.load();
    W[k] = { App, lots: repo.lotsSync(), fitCfg: App.fit.cfgOf('viva-juara'), pol: App.recommendation.policyOf('viva-juara') };
  }
});
const withStatus = (l, status) => ({ ...l, availability: { ...l.availability, status } });
const DV = { analysisVersion: 'a1', priceTableVersion: 't1', availabilityRevision: 0, staticVersion: 's1' };
/** each scenario builds its request inside one App (lots, profile and constraints from that realm) */
const SCENARIOS = {
  unknownAll: w => ({ profile: { privacy: 3 } }),
  mixed: w => ({ profile: { privacy: 3, quiet: 2 }, lots: w.lots.map((l, i) => withStatus(l, ['AVAILABLE', 'SOLD', 'UNKNOWN', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'UNAVAILABLE'][i % 7])) }),
  mixedProposal: w => ({ profile: { solar: 3, view: 1 }, lots: w.lots.map((l, i) => withStatus(l, i % 2 ? 'PROPOSAL' : 'AVAILABLE')), availabilityPolicy: { proposalCountsAsOfferable: true } }),
  budgetCorner: w => ({ profile: { privacy: 3 }, all: true, constraints: [['budgetMax', 300000], ['noCorner', true]] }),
  budgetTiny: w => ({ profile: { privacy: 3 }, all: true, constraints: [['budgetMax', 1000]] }),
  greenNull: w => { const ls = w.lots.map(l => withStatus(l, 'AVAILABLE')); ls[0] = { ...ls[0], surroundings: { ...ls[0].surroundings, hasGreenRear: null } }; return { profile: { privacy: 3 }, lots: ls, constraints: [['greenRear', true]] }; },
  areaConflict: w => ({ profile: { privacy: 3 }, all: true, constraints: [['areaMin', 500], ['areaMax', 400]] }),
  scopeB: w => ({ profile: { privacy: 3 }, all: true, scope: { blockIds: ['B'] } }),
  scopeIds: w => ({ profile: { quiet: 3 }, all: true, scope: { lotIds: w.lots.slice(0, 30).map(l => l.identity.id) } }),
  offline: w => ({ profile: { privacy: 3 }, all: true, offline: true }),
  constraintsOnly: w => ({ profile: {}, all: true, constraints: [['budgetMax', 320000]] }),
  empty: w => ({ profile: {} }),
  stale: w => ({ profile: { privacy: 3, priceQuality: 2 }, all: true, constraints: [['budgetMax', 400000]], commercialFreshness: 'STALE' }),
  staleAvail: w => ({ profile: { privacy: 3 }, all: true, availabilityFreshness: 'STALE' }),
  budgetArea: w => ({ profile: { investment: 3, area: 1 }, build: { budgetMax: 330000, areaMin: 300, areaMax: 450 }, all: true, constraints: [['areaMin', 300], ['maxGateRoute', 400], ['blocks', ['A', 'B', 'C', 'D']], ['maxNoise', ['VERY_LOW', 'LOW', 'MEDIUM']]] }),
  green: w => ({ profile: { green: 3 }, all: true }),
  tie: w => ({ profile: { green: 3, noCorner: 2 }, all: true, constraints: [['greenRear', true]] })
};
for (const p of ['moradia', 'invest', 'silencio', 'privados', 'sol', 'custo', 'premium', 'familia', 'verde']) SCENARIOS['preset_' + p] = w => ({ template: p, all: true });
function request(w, name) {
  const s = SCENARIOS[name](w), A = w.App;
  const prefs = s.template ? w.fitCfg.templates.find(t => t.id === s.template).preferences : s.profile;
  const profile = A.fit.buildProfile({ preferences: prefs, templateId: s.template || null, ...(s.build || {}) });
  const lots = s.lots || (s.all ? w.lots.map(l => withStatus(l, 'AVAILABLE')) : w.lots);
  return { developmentId: 'viva-juara', profile, constraints: (s.constraints || []).map(([k, v]) => A.recommendation.constraint(k, v, w.pol)), lots, scope: s.scope || null, policy: w.pol, fitCfg: w.fitCfg,
    availabilityPolicy: s.availabilityPolicy || {}, commercialFreshness: s.commercialFreshness || null, availabilityFreshness: s.availabilityFreshness || null, offline: !!s.offline, dataVersions: DV };
}

test('parity: recommendation results keep every previous field (ranking, tiers, fit, counts, order, codes)', () => {
  for (const name of Object.keys(SCENARIOS)) {
    const a = plain(W.old.App.recommendation.recommend(request(W.old, name))), b = plain(W.new.App.recommendation.recommend(request(W.new, name)));
    const { diagnostics: da, ...ra } = a, { diagnostics: db, ...rb } = b;
    sub(ra, rb, name);
    sub(da, db.slice(0, da.length), name + ' diagnostics (previous entries first, unchanged)');
  }
});
test('parity: Fit scores, coverage, confidence and matches are identical for valid profiles', () => {
  const profiles = [{ quiet: 3, family: 2, lowTraffic: 2 }, { investment: 3 }, { green: 3, premium: 2, view: 1 }, { quiet: 3, solar: 2, area: 1 }, { privacy: 3, nearGate: 2, awayFromAvenue: 1, noCorner: 2 }];
  for (const [i, prefs] of profiles.entries()) for (const stale of [null, 'STALE']) {
    const run = w => w.App.fit.fitLots(w.App.fit.buildProfile({ preferences: prefs, budgetMax: i === 1 ? 330000 : null, areaMin: i === 2 ? 300 : null, areaMax: i === 2 ? 420 : null }), w.lots, w.fitCfg, { commercialFreshness: stale, priceTableVersion: 'p1', analysisVersion: 'a1' });
    assert.deepEqual(plain(run(W.new)), plain(run(W.old)), JSON.stringify(prefs) + stale);
  }
});
test('parity: explanation factors, preference table and pairwise codes are unchanged for ranked lots', () => {
  for (const name of ['mixed', 'budgetCorner', 'preset_privados', 'preset_sol', 'tie', 'stale', 'unknownAll', 'constraintsOnly']) {
    const ra = W.old.App.recommendation.recommend(request(W.old, name)), rb = W.new.App.recommendation.recommend(request(W.new, name));
    const ids = [...ra.recommendations, ...ra.reviewCandidates].map(x => x.lotId);
    for (const id of ids.slice(0, 8)) {
      const ea = plain(W.old.App.explanation.explainLot(ra, id)), eb = plain(W.new.App.explanation.explainLot(rb, id));
      for (const k of ['scope', 'status', 'rank', 'tier', 'fitScore', 'summaryReasonCodes', 'positiveFactors', 'negativeFactors', 'allPositive', 'allNegative', 'constraintFactors', 'confidence', 'coverage', 'preferenceTable', 'versions']) sub(ea[k], eb[k], `${name} ${id} ${k}`);
    }
    for (let i = 0; i + 1 < Math.min(ids.length, 6); i++) sub(plain(W.old.App.explanation.comparePair(ra, ids[i], ids[i + 1])), plain(W.new.App.explanation.comparePair(rb, ids[i], ids[i + 1])), `${name} pair ${i}`);
    sub(plain(W.old.App.explanation.rankingTrace(ra)), plain(W.new.App.explanation.rankingTrace(rb)), name + ' trace');
  }
});
test('parity: filters match the same lots with the same hash, errors and facets', () => {
  const states = [{}, { priceMax: 350000 }, { priceMin: 400000, priceMax: 600000 }, { areaMin: 300, areaMax: 450 }, { block: 'B' }, { classMin: 'A' }, { trafficMax: 'LOW' }, { greenBehind: true }, { noCorner: true },
    { noNoiseAlert: true }, { favoritesOnly: true }, { statuses: ['UNKNOWN'] }, { statuses: ['AVAILABLE'] }, { onlyOfferable: true }, { shapes: ['UNKNOWN', 'RECTANGULAR'] }, { rearOrientation: ['N', 'NE'] }, { noiseMax: 'MEDIUM' },
    { privacyMin: 'HIGH' }, { gateMaxM: 400, clubMaxM: 500 }, { scoreKey: 'premium', scoreMin: 70 }, { alertsExclude: ['AVENUE'] }, { fitMin: 60 }, { dataStatusField: 'surroundings.hasGreenRear', dataStatus: ['UNKNOWN', 'CALCULATED'] },
    { classMin: 'B', greenBehind: true, priceMax: 450000, noCorner: true, trafficMax: 'MEDIUM' }, { areaMin: 500, areaMax: 300, noiseMax: 'LOUD', statuses: ['NOPE'] }, { block: 'B', statuses: ['UNKNOWN'], shapes: ['RECTANGULAR'] }];
  for (const w of [W.old, W.new]) { w.fav = new Set(w.lots.slice(0, 40).map(l => l.identity.id)); w.fit = new Map(w.lots.map((l, i) => [l.identity.id, { fitScore: i % 100 }])); }
  for (const s of states) for (const mode of [undefined, 'client', 'broker']) {
    const run = w => { const c = w.App.filters.compile(s, { mode }), ctx = { favorites: w.fav, fit: w.fit, policy: {} }; const r = w.App.filters.run(w.lots, c.query, ctx); return { hash: c.query.hash, conds: plain(c.query.conditions), errors: plain(c.errors), ids: [...r.matchedIds].sort(), warnings: plain(r.warnings), facets: plain(w.App.filters.facets(w.lots, c.query, ctx)), ser: w.App.filters.serialize(s) }; };
    const a = run(W.old), b = run(W.new);
    assert.equal(b.hash, a.hash, JSON.stringify(s)); assert.deepEqual(b.ids, a.ids, JSON.stringify(s)); assert.deepEqual(b.errors, a.errors, JSON.stringify(s)); assert.deepEqual(b.warnings, a.warnings, JSON.stringify(s));
    sub(a.conds, b.conds, JSON.stringify(s)); sub(a.facets, b.facets, JSON.stringify(s) + ' facets'); assert.equal(b.ser, a.ser);
  }
});
