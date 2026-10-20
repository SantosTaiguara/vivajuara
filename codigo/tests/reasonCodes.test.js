'use strict';
// ReasonCodeDefinition catalog (App.reasonCodes): every code the engines can emit has a definition with Portuguese
// labels per mode; client labels never show codes or jargon. Checked statically (string literals of the engine
// sources + codes in the configs) and dynamically (codes collected from real engine outputs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

let App, R, lots, fitCfg, pol;
test.before(async () => {
  App = load(); R = App.reasonCodes;
  const repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync();
  fitCfg = App.fit.cfgOf('viva-juara'); pol = App.recommendation.policyOf('viva-juara');
});
const withStatus = (l, status) => ({ ...l, availability: { ...l.availability, status } });

test('every definition is complete: category, severity, modes and both labels', () => {
  const all = R.list(); assert.ok(all.length > 150);
  for (const d of all) {
    assert.ok(R.CATEGORIES.includes(d.category), d.code); assert.ok(R.SEVERITIES.includes(d.severity), d.code);
    assert.ok(d.modes.length && d.modes.every(m => m === 'client' || m === 'broker'), d.code);
    assert.ok(typeof d.label.client === 'string' && d.label.client.length > 3, d.code); assert.ok(typeof d.label.broker === 'string' && d.label.broker.length > 3, d.code);
    assert.ok(Object.isFrozen(d));
    if (d.template) for (const m of ['client', 'broker']) for (const [, n] of (d.template[m] || '').matchAll(/\{(\w+)\}/g)) assert.ok((d.params || []).some(p => p.name === n), `${d.code} template param ${n} declared`);
  }
});
test('client labels never show internal codes, field keys or engine jargon', () => {
  const bad = [/\b[A-Z0-9]+_[A-Z0-9_]+\b/, /\b[a-z]+\.[a-z]+[A-Za-z]*\b/, /\b(fit|fitScore|match|matcher|constraint|coverage|null|undefined|NaN|PRIMARY|STALE|UNKNOWN)\b/i, /[<>]/];
  for (const d of R.list()) {
    const texts = [d.label.client, d.template && d.template.client].filter(Boolean);
    for (const t of texts) for (const re of bad) assert.ok(!re.test(t), `${d.code}: "${t}" ${re}`);
  }
});
test('label(code, mode, params) formats values by type; unknown code → null, never the code', () => {
  const sp = t => t && t.replace(/\s/g, ' '); // Intl uses non-breaking spaces
  assert.equal(sp(R.label('PRICE_ABOVE_MAX', 'client', { actual: 350000, expected: 300000 })), 'Preço de R$ 350.000, acima do orçamento de R$ 300.000.');
  assert.equal(R.label('PRICE_ABOVE_MAX', 'client'), 'Acima do orçamento.', 'missing params → plain label');
  assert.equal(sp(R.label('AREA_BELOW_MIN', 'broker', { actual: 291.78, expected: 300 })), 'Área 291,78 m² < mínimo 300,00 m².');
  assert.equal(R.label('LOW_FIT_COVERAGE', 'client', { actual: 0.4 }), 'Só 40% das suas preferências puderam ser avaliadas.');
  assert.equal(R.label('NOPE_CODE', 'client'), null); assert.equal(R.get('NOPE_CODE'), null);
  assert.equal(R.label('MATCH_PRIVACY'), 'Atende ao perfil: Privacidade.', 'label from the Fit config, client by default');
  assert.ok(R.visibleIn('AVAILABILITY_UNKNOWN', 'client') && !R.visibleIn('INVALID_METRIC_KEY', 'client') && R.visibleIn('INVALID_METRIC_KEY', 'broker'));
  assert.ok(R.list({ category: 'PAIRWISE' }).every(d => d.category === 'PAIRWISE'));
  assert.equal(R.matchCode('lowTraffic'), 'MATCH_LOW_TRAFFIC');
});

// ---------------------------------------------------------------- static: string literals and config codes
/** structural vocabularies that are not reason codes (statuses, stages, factor types, directions, categories) */
const NOT_CODES = new Set([
  'AGAINST', 'FOR', 'ASC', 'DESC', 'BRL', 'METERS', 'AVAILABILITY_LIST', // directions, units, label param types
  'POSITIVE', 'NEGATIVE', 'CONSTRAINT_PASS', 'CONSTRAINT_FAIL', 'CONSTRAINT_UNKNOWN', 'DATA_QUALITY', 'CONTRIBUTION', 'EXCLUSION', // factorType
  'PASS', 'FAIL', 'ELIGIBLE', 'INELIGIBLE', 'REVIEW', 'RECOMMENDED', 'NOT_LISTED', 'INVALID', 'WARNING', 'DEFAULT', 'POLICY', 'BROKER', // statuses, standings, sources, audience
  'SYSTEM_ELIGIBILITY', 'HARD_CONSTRAINT', 'FIT_THRESHOLD', 'EXPLICIT_SCOPE', 'MISSING_IDENTITY', 'MISSING_AVAILABILITY', 'FULL_MATCH', // stages and reasons inside diagnostics
  'MISSING_IN_HIGHER', 'MISSING_IN_LOWER', 'HIGHER', 'LOWER', 'EQUIVALENT', // pairwise relations
  'REVIEW_REASON', 'CONSTRAINT_WARNING', 'PREFERENCE', 'RECOMMENDATION', 'PER_FILTER', // factor origins, scopes
  'AVAILABILITY', 'COMMERCIAL_DATA', 'CONSTRAINT_DATA', 'FIT_DATA' // review categories (codes are REVIEW_<category>)
]);
const PREFIXES = { MATCH_: () => Object.keys(fitCfg.preferences).map(k => R.matchCode(k)), REVIEW_: () => App.recommendation.REVIEW_CATEGORIES.map(c => 'REVIEW_' + c), TIER_: () => App.recommendation.TIERS.filter(t => t !== 'REVIEW_REQUIRED').map(t => 'TIER_' + t) };
test('static: every upper-case string literal of the engines is a defined code or a declared vocabulary', () => {
  const vocab = new Set(NOT_CODES);
  for (const e of Object.values(App.enums)) if (e && typeof e === 'object' && !Array.isArray(e)) Object.keys(e).forEach(k => vocab.add(k));
  [...App.recommendation.OPERATORS, ...App.recommendation.ON_UNKNOWN, ...App.fit.TYPES, ...App.fit.SOURCES, ...App.fit.STATUS, ...App.filters.OPERATORS, ...App.filters.NULL_POLICIES].forEach(x => vocab.add(x));
  for (const d of App.filters.DEFS) [d.level, d.controlType, d.dataType, d.dynamicType, d.operator].forEach(x => x && vocab.add(x));
  const missing = [];
  for (const f of ['intelligence/recommendation.js', 'intelligence/explanation.js', 'intelligence/fit.js', 'filters/filters.js']) {
    const s = fs.readFileSync(path.join(SRC, f), 'utf8');
    for (const [, lit] of s.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) {
      if (vocab.has(lit) || R.has(lit)) continue;
      if (PREFIXES[lit]) { for (const c of PREFIXES[lit]()) if (!R.has(c)) missing.push(`${f}: ${c}`); continue; }
      missing.push(`${f}: ${lit}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});
test('static: every failCode / unknownCode of every recommendation policy and every MATCH_<preference> has a definition', () => {
  for (const p of Object.values(App.configs.recommendation)) for (const [k, d] of Object.entries(p.constraints)) { assert.ok(R.has(d.failCode), k + ' ' + d.failCode); assert.ok(R.has(d.unknownCode), k + ' ' + d.unknownCode); }
  for (const c of Object.values(App.configs.fit)) for (const k of Object.keys(c.preferences)) assert.ok(R.has(R.matchCode(k)), k);
});

// ---------------------------------------------------------------- dynamic: codes collected from engine outputs
test('dynamic: every code in recommendation, explanation, comparison, Fit and filter outputs is defined', () => {
  const seen = new Set(), add = c => { if (c != null) seen.add(c); };
  const C = (k, v) => App.recommendation.constraint(k, v, pol);
  const mixed = lots.map((l, i) => withStatus(l, ['AVAILABLE', 'SOLD', 'UNKNOWN', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'UNAVAILABLE'][i % 7]));
  mixed[0] = { ...mixed[0], surroundings: { ...mixed[0].surroundings, hasGreenRear: null } };
  mixed[7] = { ...mixed[7], commercial: { ...mixed[7].commercial, price: null } };
  mixed[14] = { ...mixed[14], identity: { ...mixed[14].identity, developmentId: 'other' } };
  const reqs = [
    { profile: { privacy: 3, quiet: 2, premium: 2, priceQuality: 2 }, constraints: [C('budgetMax', 400000), C('greenRear', true), C('noCorner', true)] },
    { profile: { privacy: 3 }, constraints: [C('budgetMax', 1000)] },
    { profile: { solar: 3, view: 1 }, constraints: [C('areaMin', 300), C('areaMax', 330), C('maxGateRoute', 300), C('blocks', ['A', 'B']), C('maxNoise', ['VERY_LOW'])], commercialFreshness: 'STALE', availabilityFreshness: 'STALE', offline: true },
    { profile: { privacy: 3 }, constraints: [C('areaMin', 500), C('areaMax', 400)] },
    { profile: {}, constraints: [] }, { profile: {}, constraints: [C('budgetMax', 320000)] },
    { profile: { green: 3, noCorner: 2 }, build: { budgetMax: 250000, areaMin: 450 }, scope: { blockIds: ['B', 'C'] } }
  ];
  const fitMap = new Map(App.fit.fitLots(App.fit.buildProfile({ preferences: { privacy: 3, quiet: 2 } }), lots, fitCfg).map(f => [f.lotId, f]));
  let prev = null;
  for (const q of reqs) {
    const profile = App.fit.buildProfile({ preferences: q.profile, ...(q.build || {}) });
    const r = App.recommendation.recommend({ developmentId: 'viva-juara', profile, constraints: q.constraints, lots: mixed, scope: q.scope || null, policy: pol, fitCfg, availabilityPolicy: {}, commercialFreshness: q.commercialFreshness, availabilityFreshness: q.availabilityFreshness, offline: q.offline, dataVersions: {} });
    add(r.status); Object.keys(r.exclusionSummary).forEach(add); r.warnings.forEach(add); r.diagnostics.forEach(d => add(d.code));
    for (const x of [...r.recommendations, ...r.reviewCandidates]) { add(x.tier); x.keyReasonCodes.forEach(add); x.reviewReasons.forEach(add); x.warnings.forEach(add); add(x.primaryReviewReason); x.constraintResults.forEach(c => add(c.reasonCode)); if (x.fit) { x.fit.warnings.forEach(w => add(w.code)); x.fit.preferenceMatches.forEach(m => add(m.reasonCode)); } }
    for (const e of r.excluded) { add(e.reasonCode); e.constraintResults.forEach(c => add(c.reasonCode)); }
    Object.keys(r.reviewSummary.byPrimaryReason).forEach(add); Object.keys(r.reviewSummary.byCategory).forEach(c => add('REVIEW_' + c));
    const ids = [...r.recommendations, ...r.reviewCandidates].map(x => x.lotId).slice(0, 4).concat(r.excluded.slice(0, 3).map(x => x.lotId), r.overflow.eligibleLotIds.slice(0, 1), r.overflow.reviewLotIds.slice(0, 1), ['nope']);
    for (const id of ids) {
      const e = App.explanation.explainLot(r, id);
      e.summaryReasonCodes.forEach(add); e.diagnostics.forEach(d => add(d.code));
      for (const f of [...e.positiveFactors, ...e.negativeFactors, ...e.constraintFactors, ...e.exclusionFactors, ...e.dataQualityFactors]) add(f.reasonCode);
      for (const mode of ['client', 'broker']) { const vm = App.explanation.viewModel(e, { mode }); add(vm.headline.code); assert.ok(vm.headline.text, `${id} ${mode} headline text`); }
    }
    if (ids.length >= 3) { const cm = App.explanation.compareMany(r, ids.slice(0, 4), { fit: fitMap }); cm.summaryReasonCodes.forEach(add); cm.warnings.forEach(add); cm.preferences.forEach(p => add(p.reasonCode)); cm.pairs.forEach(p => { p.summaryReasonCodes.forEach(add); p.warnings.forEach(add); }); }
    add(App.explanation.compareMany(r, ids.slice(0, 1)).summaryReasonCodes[0]);
    if (prev) App.explanation.rankChange(prev, r).forEach(c => c.changeReasons.forEach(add));
    prev = r;
  }
  // Fit: warnings, failures, profile and config validation
  const p = App.fit.buildProfile({ preferences: { privacy: 3, premium: 2, priceQuality: 2, green: 2 }, budgetMax: 250000, areaMin: 450, areaMax: 300 });
  App.fit.validateProfile(p, fitCfg, { lots }).errors.concat(App.fit.validateProfile(p, fitCfg, { lots }).warnings).forEach(w => add(w.code));
  App.fit.validateConfig({ ...fitCfg, kind: 'x', scale: 0, preferences: { a: { type: 'EVAL', fieldKey: 'x.y' } } }).errors.forEach(e => add(e.code));
  const broken = { ...fitCfg, preferences: { ...fitCfg.preferences, privacy: { ...fitCfg.preferences.privacy, scaleMax: 0 } } };
  App.fit.fitLot(App.fit.buildProfile({ preferences: { privacy: 3 } }, broken), lots[0], broken, App.fit.contextFor(lots)).warnings.forEach(w => add(w.code));
  App.fit.fitLot(App.fit.buildProfile({ preferences: {} }), lots[0], fitCfg, App.fit.contextFor(lots)).warnings.forEach(w => add(w.code));
  // filters: warnings, errors, dropped, diagnostics
  const F = App.filters, fs0 = [{ fitMin: 70, noiseMax: 'LOUD', priceMax: 400000, statuses: ['AVAILABLE'] }, { areaMin: 500, areaMax: 300, includeUnknown: ['price'] }, { scoreKey: 'premium', scoreMin: 70, q: 'B7' }, { fitMin: 150, dataStatusField: 'x.y', dataStatus: ['UNKNOWN'] }, { shapes: ['UNKNOWN', 'NOPE'] }];
  for (const s of fs0) for (const mode of ['client', 'broker']) {
    const c = F.compile(s, { mode }); c.errors.forEach(e => add(e.code)); c.query.dropped.forEach(d => add(d.code));
    const r = F.run(lots, c.query, { freshness: { commercial: { status: 'STALE' }, availability: { status: 'STALE' } } }); r.warnings.forEach(w => add(w.code)); add(r.diagnostics.code); r.diagnostics.suggestions.forEach(x => add(x.code));
  }
  F.run(lots, { ...F.compile({}).query, developmentId: 'x' }, { developmentId: 'viva-juara' }).warnings.forEach(w => add(w.code));
  F.run(lots, { version: 99, conditions: [] }).warnings.forEach(w => add(w.code));
  F.migrateQuery({ conditions: [] }).warnings.forEach(w => add(w.code));
  add(F.serializeChecked({ q: 'B7' }, { maxLength: 2 }).code);
  const undefinedCodes = [...seen].filter(c => !R.has(c)).sort();
  assert.deepEqual(undefinedCodes, []);
  assert.ok(seen.size > 60, 'enough codes collected: ' + seen.size);
});
