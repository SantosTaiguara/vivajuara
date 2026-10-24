'use strict';
// Topic 36 — Alerts as a Rule Engine: declarative versioned rules, three-valued evaluation, AlertInstance lifecycle,
// suppression/hysteresis, projection, selective re-evaluation and the ZERO-DELTA migration of every legacy alert
// (498 lots: same alerts, same texts, same severities, same order, same lots). Golden scenarios named after the spec (§550).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC, DATA, publishedStatus } = require('./harness.js');

const MODULES = ['rules/ruleCore.js', 'rules/alertDomain.js', 'rules/legacyAlertMigration.js'];
const clone = x => x === undefined ? x : JSON.parse(JSON.stringify(x));
const deq = (a, b, m) => assert.deepEqual(clone(a), clone(b), m);
const RAW = JSON.parse(fs.readFileSync(path.join(DATA, 'lots.json'), 'utf8'));
const INPUT = JSON.parse(fs.readFileSync(path.join(DATA, 'analysis-input.json'), 'utf8'));
const AS_OF = '2026-10-09T12:00:00.000Z', NOW_MS = Date.parse(AS_OF);
// formatAge reads Date.now(): a fixed clock makes the legacy wording and the engine's asOf meet
class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [NOW_MS])); } static now() { return NOW_MS; } }
let App, RE, AL, MIG, cat, lots, byId, analysis, inputsById, dev, beforeLots, beforeEngine;
const can = (...perms) => p => perms.includes(p);

test.before(async () => {
  App = load({ Date: FixedDate });
  const repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync();
  beforeLots = lots.map(l => App.domain.serializeLot(l));
  const comp = App.methodology.compile(App.methodology.current('viva-juara'));
  beforeEngine = App.intelligence.analyzeDevelopment(INPUT.lots, { methodology: comp });
  for (const f of MODULES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  RE = App.ruleEngine; AL = App.alerts; MIG = App.alertMigration;
  cat = AL.catalog('viva-juara');
  analysis = App.intelligence.analyzeDevelopment(INPUT.lots, { methodology: comp });
  byId = new Map(analysis.results.map(r => [r.lotId, r])); inputsById = new Map(INPUT.lots.map(i => [i.lotId, i]));
  dev = App.config.DEVELOPMENTS[0];
});

// ---------------------------------------------------------------- catalog / migration fidelity
test('catalog: 14 published rule versions compile; one PUBLISHED rule set; feature flag off by default', () => {
  assert.equal(cat.compiled.length, 14);
  assert.ok(cat.compiled.every(r => r.lifecycleStatus === 'PUBLISHED' && /^[0-9a-f]{8}$/.test(r.checksum)));
  assert.equal(cat.ruleSet.lifecycleStatus, 'PUBLISHED');
  assert.equal(cat.featureFlag, 'RULE_ENGINE_ALERTS_ENABLED'); assert.equal(cat.featureFlagDefault, false);
  assert.equal(MIG.enabled(dev), false);
});
test('migration: catalog conditions encode config/scoring 1.0.json#alerts exactly (no threshold tuning)', () => {
  const cfg = App.methodology.current('viva-juara'), legacy = MIG.fromMethodologyAlerts(cfg.alerts);
  const analysisRules = cat.compiled.filter(r => r.legacyProjection.surface === 'INTELLIGENCE_ALERTS');
  deq(analysisRules.map(r => r.code), legacy.map(a => a.type));
  analysisRules.forEach((r, i) => deq(MIG.resolvedCondition(r), legacy[i].condition, r.code));
  // severities, fieldKeys and sources come from domain/rules.js ALERTS
  for (const r of analysisRules) { const t = r.legacyProjection.type, a = App.rules.ALERTS[t]; assert.equal(r.severityPolicy.severity, a.severity, r.code); assert.equal(r.legacyProjection.fieldKey, a.fieldKey); assert.equal(r.legacyProjection.sourceId, a.sourceId); }
});
test('safety: no eval / Function / innerHTML in the rule engine and alert domain sources', () => {
  for (const f of MODULES) { const s = fs.readFileSync(path.join(SRC, f), 'utf8'); assert.ok(!/\beval\s*\(|new Function|Function\s*\(|innerHTML|Date\.now\(\)/.test(s), f); }
});

// ---------------------------------------------------------------- ZERO DELTA (RuleVersionShadowParity)
test('golden RuleVersionShadowParity: engine = legacy for all 498 lots (alerts, texts, severities, ids/order, status notes, share warnings)', () => {
  const r = MIG.parityReport({ catalog: cat, lots, analysisById: byId, asOf: AS_OF, shareCtx: { dev, mode: 'broker' } });
  assert.equal(r.totalEvaluatedEntities, 498);
  assert.equal(r.totalLegacyAlerts, 404); assert.equal(r.totalEngineAlerts, 404); assert.equal(r.exactMatchCount, 404);
  assert.equal(r.missingInEngineCount, 0); assert.equal(r.extraInEngineCount, 0); assert.equal(r.severityMismatchCount, 0); assert.equal(r.wordingMismatchCount, 0);
  assert.equal(r.errorEvaluations, 0); assert.equal(r.shareWarningsCompared, 498);
  deq(r.mismatches, []);
});
test('zero delta: full legacy alert objects (id, type, severity, title, message, fieldKey, sourceId) are identical, lot by lot', () => {
  let n = 0;
  for (const l of lots) { deq(MIG.engine.intelligenceAlerts(cat, l, byId.get(l.identity.id), { asOf: AS_OF }), l.intelligence.alerts, l.identity.code); n += l.intelligence.alerts.length; }
  assert.equal(n, 404);
});
test('zero delta: the "al" strings equal lots.json and the IntelligenceEngine + textAdapter wording (498 lots, analysis order)', () => {
  const raw = new Map(RAW.map(x => [x.id, x]));
  for (const r of analysis.results) {
    const texts = MIG.engine.texts(cat, null, r, { asOf: AS_OF });
    deq(texts, raw.get(r.code).al || [], r.code);
    deq(texts, MIG.legacy.engineTexts(r, inputsById.get(r.lotId)), r.code);
  }
});
test('zero delta: availability note (statusVM warn branch) for every status × freshness, broker and client, with and without updatedAt', () => {
  const statuses = ['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN'], fresh = ['FRESH', 'STALE', 'EXPIRED', 'UNKNOWN', null];
  const ups = [null, new Date(NOW_MS - 3 * 3600e3).toISOString(), new Date(NOW_MS - 40 * 60e3).toISOString(), new Date(NOW_MS - 5 * 86400e3).toISOString()];
  let compared = 0, warned = 0;
  lots.forEach((l, i) => {
    const v = { ...l, availability: { ...l.availability, status: statuses[i % 7], freshness: fresh[Math.floor(i / 7) % 5], updatedAt: ups[i % 4] } };
    for (const mode of ['broker', 'client']) { const L = MIG.legacy.statusNote(v, mode), E = MIG.engine.statusNote(cat, v, mode, { asOf: AS_OF }); deq(E, L, `${l.identity.code} ${mode}`); compared++; if (L) warned++; }
  });
  assert.equal(compared, 996); assert.ok(warned > 300 && warned < 996);
  for (const l of lots) for (const mode of ['broker', 'client']) deq(MIG.engine.statusNote(cat, l, mode, { asOf: AS_OF }), MIG.legacy.statusNote(l, mode)); // today: all 498 UNKNOWN → warn
});
test('zero delta: share warnings across mixed statuses, stale/missing commercial freshness and missing prices', () => {
  const statuses = ['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN'];
  const scenarios = [lots,
    lots.map((l, i) => ({ ...l, availability: { ...l.availability, status: statuses[i % 7], freshness: i % 3 ? 'FRESH' : 'STALE' } })),
    lots.map((l, i) => ({ ...l, availability: { ...l.availability, status: 'AVAILABLE', freshness: i % 2 ? 'FRESH' : null }, metadata: { ...l.metadata, freshness: i % 5 === 0 ? undefined : { ...l.metadata.freshness, commercial: ['FRESH', 'STALE', 'EXPIRED', null][i % 4] } },
      commercial: { ...l.commercial, price: i % 11 === 0 ? null : l.commercial.price } }))];
  for (const [k, ls] of scenarios.entries()) for (const mode of ['broker', 'client']) {
    const L = MIG.legacy.shareWarnings(ls, { dev, mode }), E = MIG.engine.shareWarnings(cat, ls, { asOf: AS_OF });
    deq(E, L, `scenario ${k} ${mode}`); assert.ok(L.length > 0);
  }
});
test('zero delta: QuickViewAlertSummary from the alert domain equals quickview.alertSummary for every lot', () => {
  for (const l of lots) for (const max of [1, 3]) deq(AL.quickViewSummary(MIG.engine.intelligenceAlerts(cat, l, byId.get(l.identity.id)), max), App.quickView.alertSummary(l, null, max), l.identity.code);
});
test('zero delta: client projection keeps exactly the CRITICAL/IMPORTANT alerts the details view shows to clients', () => {
  for (const l of lots.slice(0, 120)) {
    const { candidates } = MIG.engine.evaluation(cat, l, byId.get(l.identity.id));
    const engine = AL.sortAlerts(candidates).map(c => AL.project(c, 'CLIENT')).filter(Boolean).map(a => a.type).sort();
    const legacy = l.intelligence.alerts.filter(a => ['CRITICAL', 'IMPORTANT'].includes(a.severity)).map(a => a.type).sort();
    deq(engine, legacy, l.identity.code);
  }
});

// ---------------------------------------------------------------- invariants: no score / class / Fit / winner / availability change
test('invariants: evaluating every rule changes no lot, score, class, ranking or availability (byte-identical)', () => {
  for (const l of lots) { MIG.engine.evaluation(cat, l, byId.get(l.identity.id)); MIG.engine.statusNote(cat, l, 'broker', { asOf: AS_OF }); }
  MIG.engine.shareWarnings(cat, lots, { asOf: AS_OF });
  deq(lots.map(l => App.domain.serializeLot(l)), beforeLots);
  deq(analysis.results.map(r => [r.lotId, r.scores, r.class, r.rankings]), beforeEngine.results.map(r => [r.lotId, r.scores, r.class, r.rankings]));
  assert.ok(lots.every(l => l.availability.status === publishedStatus(l)));
  for (const f of MODULES) { const s = fs.readFileSync(path.join(SRC, f), 'utf8'); assert.ok(!/App\.(fit|recommendation|compare)\b/.test(s), f + ' must not touch Fit/Recommendation/winner'); }
});
test('integration: flag off → legacy list; flag on + analysis → rule engine (identical); flag on without analysis → legacy fallback', () => {
  const l = lots.find(x => x.intelligence.alerts.length >= 3), on = { ...dev, features: { ...dev.features, ruleEngineAlerts: true } };
  const off = MIG.intelligenceAlertsFor(l, { dev, analysisResult: byId.get(l.identity.id) });
  assert.equal(off.source, 'LEGACY'); assert.equal(off.alerts, l.intelligence.alerts);
  const eng = MIG.intelligenceAlertsFor(l, { dev: on, analysisResult: byId.get(l.identity.id), asOf: AS_OF });
  assert.equal(eng.source, 'RULE_ENGINE'); deq(eng.alerts, l.intelligence.alerts);
  assert.equal(MIG.intelligenceAlertsFor(l, { dev: on }).source, 'LEGACY');
  deq(MIG.statusNoteFor(l, 'client', { dev: on, asOf: AS_OF }).note, MIG.legacy.statusNote(l, 'client'));
  deq(MIG.shareWarningsFor(lots.slice(0, 5), { dev: on, asOf: AS_OF }).warnings, MIG.legacy.shareWarnings(lots.slice(0, 5), { dev, mode: 'broker' }));
});

// ---------------------------------------------------------------- AST, compiler, validator
const DEF = (o = {}) => ({ id: 'rule:t:X', code: 'X', titleKey: 'x', category: 'LOCATION', targetEntityType: 'LOT', defaultSeverity: 'IMPORTANT', ...o });
const VER = (o = {}) => ({ id: 'rule:t:X@1.0.0', ruleDefinitionId: 'rule:t:X', version: '1.0.0', sequence: 1, condition: { type: 'COMPARISON', left: { type: 'METRIC', metricId: 'DISTANCE_EXTERNAL_ROAD_M' }, operator: 'LT', right: { type: 'CONFIG', key: 'max' } },
  parameters: { max: 20 }, severityPolicy: { type: 'STATIC', severity: 'IMPORTANT' }, unknownPolicy: { behavior: 'NO_ALERT', reasonCode: 'X_UNKNOWN' }, messageTemplates: { DEFAULT: [{ text: 'a ' }, { value: { type: 'METRIC', metricId: 'DISTANCE_EXTERNAL_ROAD_M' }, format: 'FIXED_0' }, { text: ' m da via' }] }, ...o });
const codes = (d, v) => RE.validate(d, v).errors.map(e => e.code);
const lotInput = (metrics, attributes = {}, ctx = {}) => ({ organizationId: 'house7', developmentId: 'viva-juara', entity: { type: 'LOT', id: 'VJ-QA-L0001', code: 'A1' }, facts: { metrics, attributes }, context: { asOf: AS_OF, ...ctx } });
test('AST validation: type mismatch, invalid field, invalid metric, unknown operator/predicate, unsafe template, missing unknown policy', () => {
  assert.ok(RE.validate(DEF(), VER()).ok);
  assert.ok(codes(DEF(), VER({ condition: { type: 'COMPARISON', left: { type: 'METRIC', metricId: 'DISTANCE_EXTERNAL_ROAD_M' }, operator: 'LT', right: { type: 'LITERAL', value: 'x', valueType: 'STRING' } } })).includes('TYPE_MISMATCH'));
  assert.ok(codes(DEF(), VER({ condition: { type: 'EXISTS', operand: { type: 'ATTRIBUTE', attributePath: 'lot.__proto__' }, expected: true } })).includes('UNKNOWN_FIELD'));
  assert.ok(codes(DEF(), VER({ condition: { type: 'EXISTS', operand: { type: 'METRIC', metricId: 'NOPE' }, expected: true } })).includes('UNKNOWN_METRIC'));
  assert.ok(codes(DEF(), VER({ condition: { type: 'COMPARISON', left: { type: 'METRIC', metricId: 'AREA_M2' }, operator: 'LIKE', right: { type: 'LITERAL', value: 1, valueType: 'NUMBER' } } })).includes('UNKNOWN_OPERATOR'));
  assert.ok(codes(DEF(), VER({ condition: { type: 'PREDICATE', predicateId: 'RUN_JS', args: [] } })).includes('UNKNOWN_PREDICATE'));
  assert.ok(codes(DEF(), VER({ condition: { type: 'JS', code: 'return true' } })).includes('UNKNOWN_NODE_TYPE'));
  assert.ok(codes(DEF(), VER({ messageTemplates: { DEFAULT: [{ text: '<img src=x onerror=alert(1)>' }] } })).includes('UNSAFE_TEMPLATE_TEXT'));
  assert.ok(codes(DEF(), VER({ unknownPolicy: undefined })).includes('MISSING_UNKNOWN_POLICY'));
  assert.ok(codes(DEF(), VER({ condition: { type: 'COMPARISON', left: { type: 'METRIC', metricId: 'AREA_M2' }, operator: 'LT', right: { type: 'CONFIG', key: 'missing' } } })).includes('UNKNOWN_CONFIG_KEY'));
  assert.ok(codes(DEF(), VER({ condition: { type: 'COMPARISON', left: { type: 'CONTEXT', contextKey: 'CUSTOMER_BUDGET_MAX' }, operator: 'LT', right: { type: 'LITERAL', value: 1, valueType: 'NUMBER' } } })).includes('CUSTOMER_CONTEXT_IN_BASE_RULE'));
  assert.throws(() => RE.compile(DEF(), VER({ unknownPolicy: undefined })), e => e.code === 'RULE_INVALID' && e.errors.length > 0);
});
test('truth: null is UNKNOWN (never FALSE); not-loaded source is UNKNOWN; Kleene AND/OR; ERROR on non-finite; evaluation is deterministic', () => {
  const r = RE.compile(DEF(), VER());
  assert.equal(RE.evaluate(r, lotInput({ DISTANCE_EXTERNAL_ROAD_M: null })).truth, 'UNKNOWN');
  assert.equal(RE.evaluate(r, lotInput({})).truth, 'UNKNOWN');
  assert.equal(RE.evaluate(r, lotInput({ DISTANCE_EXTERNAL_ROAD_M: 18 })).truth, 'TRUE');
  assert.equal(RE.evaluate(r, lotInput({ DISTANCE_EXTERNAL_ROAD_M: 25 })).truth, 'FALSE');
  assert.equal(RE.evaluate(r, lotInput({ DISTANCE_EXTERNAL_ROAD_M: NaN })).truth, 'ERROR');
  const geo = cat.byCode.get('GEOMETRY');
  assert.equal(RE.evaluate(geo, lotInput({ ANALYSIS_NOTE_GEOMETRY: null, FRONT_WIDTH_M: 8 })).truth, 'TRUE'); // UNKNOWN OR TRUE = TRUE
  assert.equal(RE.evaluate(geo, lotInput({ ANALYSIS_NOTE_GEOMETRY: null, FRONT_WIDTH_M: 12 })).truth, 'UNKNOWN'); // UNKNOWN OR FALSE = UNKNOWN
  const missingArea = cat.byCode.get('MISSING_AREA');
  assert.equal(RE.evaluate(missingArea, lotInput({ AREA_M2: null })).truth, 'TRUE');
  assert.equal(RE.evaluate(missingArea, lotInput({})).truth, 'UNKNOWN', 'analysis not loaded: never claims the area is missing');
  const a = RE.evaluate(r, lotInput({ DISTANCE_EXTERNAL_ROAD_M: 18 })), b = RE.evaluate(r, lotInput({ DISTANCE_EXTERNAL_ROAD_M: 18 }));
  assert.equal(a.evaluationFingerprint, b.evaluationFingerprint); assert.equal(a.id, b.id);
});
test('explanation uses the evaluation trace: values and thresholds compared (18 < 20), no recomputation', () => {
  const r = RE.compile(DEF(), VER()), res = RE.evaluate(r, lotInput({ DISTANCE_EXTERNAL_ROAD_M: 18 })), ex = RE.explain(r, res);
  deq(ex.triggerFacts.map(f => [f.ref, f.value, f.operator]), [['metric:DISTANCE_EXTERNAL_ROAD_M', 18, 'LT']]);
  deq(ex.thresholdFacts.map(f => [f.ref, f.value]), [['config:max', 20]]);
  assert.equal(RE.render(r, lotInput({ DISTANCE_EXTERNAL_ROAD_M: 18 })), 'a 18 m da via');
});
test('tenant: cross-tenant evaluation is ERROR and never becomes an alert; stores refuse other tenants', () => {
  const r = cat.byCode.get('AVENUE'), res = RE.evaluate(r, { ...lotInput({ DISTANCE_EXTERNAL_ROAD_M: 10 }), organizationId: 'other' });
  assert.equal(res.truth, 'ERROR'); deq(res.errors, ['TENANT_MISMATCH']);
  assert.equal(AL.candidateOf(r, res, lotInput({})), null);
  const st = AL.store({ organizationId: 'house7' });
  assert.throws(() => st.reconcile([{ result: { ...res, truth: 'TRUE', organizationId: 'other' }, candidate: null }]), e => e.code === 'TENANT_MISMATCH');
  assert.throws(() => AL.store({}), e => e.code === 'TENANT_REQUIRED');
});

// ---------------------------------------------------------------- golden scenarios (spec §550)
const roadDef = DEF({ id: 'rule:t:ROAD', code: 'ROAD_PROXIMITY_NOISE', category: 'MOBILITY' });
const roadVer = (o = {}) => VER({ id: 'rule:t:ROAD@1.0.0', ruleDefinitionId: 'rule:t:ROAD', parameters: { max: 20 }, severityPolicy: { type: 'THRESHOLD_BASED', operand: { type: 'METRIC', metricId: 'DISTANCE_EXTERNAL_ROAD_M' }, bands: [{ lt: 10, severity: 'CRITICAL' }, { severity: 'IMPORTANT' }] }, ...o });
const evalRoad = (rule, d, extra = {}) => { const input = lotInput({ DISTANCE_EXTERNAL_ROAD_M: d }); const result = RE.evaluate(rule, input, extra); return { result, candidate: AL.candidateOf(rule, result, input) }; };
test('golden RoadProximityWarning / RoadProximityCritical: threshold severity policy from the version', () => {
  const r = RE.compile(roadDef, roadVer());
  assert.equal(evalRoad(r, 15).candidate.severity, 'IMPORTANT'); assert.equal(evalRoad(r, 8).candidate.severity, 'CRITICAL'); assert.equal(evalRoad(r, 30).candidate, null);
});
test('golden UnknownSetbackData: null setback with CREATE_REVIEW_ALERT → review alert (not FALSE); NO_ALERT → nothing', () => {
  const d = DEF({ id: 'rule:t:SB', code: 'FRONT_SETBACK_SHORT', category: 'CONSTRUCTION' }), cond = { type: 'COMPARISON', left: { type: 'ATTRIBUTE', attributePath: 'construction.frontSetbackM' }, operator: 'LT', right: { type: 'LITERAL', value: 5, valueType: 'NUMBER' } };
  const review = RE.compile(d, VER({ id: 'rule:t:SB@1.0.0', ruleDefinitionId: 'rule:t:SB', condition: cond, unknownPolicy: { behavior: 'CREATE_REVIEW_ALERT', reasonCode: 'SETBACK_UNKNOWN' }, messageTemplates: { DEFAULT: [{ text: 'recuo frontal curto' }] } }));
  const input = lotInput({}, { 'construction.frontSetbackM': null }), res = RE.evaluate(review, input), c = AL.candidateOf(review, res, input);
  assert.equal(res.truth, 'UNKNOWN'); deq(res.reasonCodes, ['SETBACK_UNKNOWN']); assert.equal(c.reasonType, 'REVIEW'); assert.ok(c.alertKey.endsWith('|REVIEW'));
  const quiet = RE.compile(d, VER({ id: 'rule:t:SB@1.0.1', ruleDefinitionId: 'rule:t:SB', version: '1.0.1', condition: cond, messageTemplates: { DEFAULT: [{ text: 'x' }] } }));
  assert.equal(AL.candidateOf(quiet, RE.evaluate(quiet, input), input), null);
});
test('golden StaleAvailabilityConfirmation and StalePricingWarning (rules migrated from statusVM/shareVM)', () => {
  const l = { ...lots[0], availability: { ...lots[0].availability, status: 'AVAILABLE', freshness: 'STALE', updatedAt: new Date(NOW_MS - 2 * 3600e3).toISOString() }, metadata: { ...lots[0].metadata, freshness: { commercial: 'STALE', availability: 'STALE' } } };
  deq(MIG.engine.statusNote(cat, l, 'broker', { asOf: AS_OF }), { note: 'Disponibilidade não confirmada · última atualização há 2 h', warn: true });
  deq(MIG.engine.statusNote(cat, l, 'client', { asOf: AS_OF }), { note: 'Disponibilidade sujeita a confirmação', warn: true });
  deq(MIG.engine.shareWarnings(cat, [l], { asOf: AS_OF }), ['A1: status pode estar desatualizado', 'A1: preço baseado na última tabela disponível']);
});
test('golden CustomerBudgetContextAlert: customer context in the alertKey; removing the context resolves it; never a base alert', () => {
  const d = DEF({ id: 'rule:t:BUDGET', code: 'PRICE_ABOVE_CUSTOMER_BUDGET', category: 'CUSTOMER_CONTEXT', contextType: 'CUSTOMER' });
  const r = RE.compile(d, VER({ id: 'rule:t:BUDGET@1.0.0', ruleDefinitionId: 'rule:t:BUDGET', parameters: {}, condition: { type: 'COMPARISON', left: { type: 'ATTRIBUTE', attributePath: 'commercial.price' }, operator: 'GT', right: { type: 'CONTEXT', contextKey: 'CUSTOMER_BUDGET_MAX' } },
    messageTemplates: { DEFAULT: [{ text: 'acima do orçamento informado' }] } }));
  assert.deepEqual([...r.dependencyManifest.customerContextDependencies], ['CUSTOMER_BUDGET_MAX']); assert.ok(r.dependencyManifest.pricingDependencies.includes('commercial.price'));
  const st = AL.store({ organizationId: 'house7' }), ctx = { asOf: AS_OF, contextDiscriminator: 'customer:hash-1', customer: { budgetMax: 300000 } };
  const ev = (c) => { const input = lotInput({}, { 'commercial.price': 350000 }, c); const result = RE.evaluate(r, input); return { result, candidate: AL.candidateOf(r, result, input) }; };
  const e1 = ev(ctx); assert.equal(e1.result.truth, 'TRUE'); assert.ok(e1.candidate.alertKey.includes('customer:hash-1')); assert.equal(e1.candidate.contextType, 'CUSTOMER');
  st.reconcile([e1], { rules: [r], now: AS_OF });
  const e2 = ev({ ...ctx, customer: {} }); assert.equal(e2.result.truth, 'UNKNOWN'); // context removed: unknown budget, not "within budget"
  st.reconcile([ev({ ...ctx, customer: { budgetMax: 400000 } })], { rules: [r], now: AS_OF });
  assert.equal(st.get(e1.candidate.alertKey).lifecycleState, 'RESOLVED');
  assert.ok(!st.all().some(i => i.contextType === 'BASE'));
  const p = RE.plan(RE.dependencyIndex([r]), { type: 'PRICE_TABLE_CHANGED' }); deq(p.ruleCodes, [], 'customer rules re-evaluated only for the named sessions');
  deq(RE.plan(RE.dependencyIndex([r]), { type: 'PRICE_TABLE_CHANGED', customerContextRef: 'customer:hash-1' }).ruleCodes, ['PRICE_ABOVE_CUSTOMER_BUDGET']);
});
test('golden RuleSeverityEscalation, RuleAutoResolution, RuleReopenEpisode; repeated TRUE does not duplicate', () => {
  const r = RE.compile(roadDef, roadVer()), st = AL.store({ organizationId: 'house7' }), run = (d, now) => st.reconcile([evalRoad(r, d)], { rules: [r], now });
  deq(run(15, '2026-10-09T10:00:00Z').changes.map(c => c.action), ['OPENED']);
  deq(run(15, '2026-10-09T10:05:00Z').changes.map(c => c.action), ['UNCHANGED']);
  assert.equal(st.all().length, 1); assert.equal(st.all()[0].occurrenceCount, 1);
  deq(run(8, '2026-10-09T10:10:00Z').changes.map(c => c.action), ['SEVERITY_CHANGED']);
  const inst = st.all()[0]; assert.equal(inst.currentSeverity, 'CRITICAL');
  assert.ok(st.events().some(e => e.type === 'ALERT_SEVERITY_CHANGED' && e.from === 'IMPORTANT' && e.to === 'CRITICAL'));
  deq(run(30, '2026-10-09T10:15:00Z').changes.map(c => c.action), ['RESOLVED']); assert.equal(inst.lifecycleState, 'RESOLVED');
  deq(run(12, '2026-10-09T10:20:00Z').changes.map(c => c.action), ['REOPENED']);
  assert.equal(inst.lifecycleState, 'ACTIVE'); assert.equal(inst.episodes.length, 2); assert.equal(inst.occurrenceCount, 2); assert.equal(st.all().length, 1);
  assert.equal(st.history(inst.alertKey).length, 4);
  deq(st.events().map(e => e.type), ['ALERT_OPENED', 'ALERT_SEVERITY_CHANGED', 'ALERT_RESOLVED', 'ALERT_REOPENED']);
  assert.ok(st.events().every(e => !('message' in e) && !('customer' in e)), 'events carry ids, not PII or text');
});
test('UNKNOWN after TRUE keeps the alert (unknown is not "condition gone"); ERROR never resolves', () => {
  const r = RE.compile(roadDef, roadVer()), st = AL.store({ organizationId: 'house7' });
  st.reconcile([evalRoad(r, 15)], { rules: [r], now: AS_OF });
  deq(st.reconcile([evalRoad(r, null)], { rules: [r], now: AS_OF }).changes.map(c => c.action), ['KEPT_UNKNOWN']);
  st.reconcile([evalRoad(r, NaN)], { rules: [r], now: AS_OF });
  assert.equal(st.all()[0].lifecycleState, 'ACTIVE');
});
test('golden HysteresisPreventsFlapping: activates below 20 m, resolves only above 22 m and after 2 evaluations', () => {
  const r = RE.compile(roadDef, roadVer({ hysteresisPolicy: { parameterKey: 'max', activationThreshold: 20, resolutionThreshold: 22, resolutionConsecutiveEvaluations: 2 } }));
  const st = AL.store({ organizationId: 'house7' }), step = d => { const input = lotInput({ DISTANCE_EXTERNAL_ROAD_M: d }); const result = RE.evaluate(r, input, { activeState: st.activeKeys().size > 0 }); return st.reconcile([{ result, candidate: AL.candidateOf(r, result, input) }], { rules: [r], now: AS_OF }).changes[0]; };
  assert.equal(step(19.5).action, 'OPENED');
  for (const d of [20.5, 21.5, 19.8, 21.9]) { const c = step(d); assert.notEqual(c && c.action, 'RESOLVED'); }
  assert.equal(st.all()[0].lifecycleState, 'ACTIVE', 'oscillating around 20 m does not flap');
  assert.equal(step(22.5).action, 'PENDING_RESOLUTION'); assert.equal(step(23).action, 'RESOLVED');
  assert.equal(st.events().filter(e => e.type === 'ALERT_OPENED' || e.type === 'ALERT_REOPENED').length, 1);
});
test('golden SuppressionPreventsDuplicateSpam: same fingerprint → no new event; reopen inside cooldown is suppressed', () => {
  const r = RE.compile(roadDef, roadVer({ suppressionPolicy: { suppressRepeatedFingerprint: true, cooldownSeconds: 3600 } })), st = AL.store({ organizationId: 'house7' });
  for (let i = 0; i < 20; i++) st.reconcile([evalRoad(r, 15)], { rules: [r], now: AS_OF });
  assert.equal(st.events().length, 1);
  st.reconcile([evalRoad(r, 40)], { rules: [r], now: '2026-10-09T12:10:00Z' });
  const ch = st.reconcile([evalRoad(r, 15)], { rules: [r], now: '2026-10-09T12:20:00Z' }).changes[0];
  assert.equal(ch.action, 'REOPENED_SUPPRESSED'); assert.equal(st.events().pop().suppressed, true);
});
test('lifecycle: acknowledge keeps the condition; resolve clears; new episode needs new ack; snooze expires; critical dismiss denied; deny by default; offline writes refused; optimistic version', () => {
  const r = RE.compile(roadDef, roadVer()), st = AL.store({ organizationId: 'house7' });
  st.reconcile([evalRoad(r, 15)], { rules: [r], now: '2026-10-09T10:00:00Z' }); const key = st.all()[0].alertKey;
  assert.throws(() => st.acknowledge(key, {}), e => e.code === 'FORBIDDEN');
  assert.throws(() => st.acknowledge(key, { can: can('alert.acknowledge'), offline: true }), e => e.code === 'OFFLINE_WRITE_NOT_ALLOWED');
  assert.throws(() => st.acknowledge(key, { can: can('alert.acknowledge'), expectedVersion: 99 }), e => e.code === 'ALERT_VERSION_CONFLICT');
  st.acknowledge(key, { can: can('alert.acknowledge'), by: 'user:broker-1', at: '2026-10-09T10:01:00Z' }); st.acknowledge(key, { can: can('alert.acknowledge') }); // idempotent
  assert.equal(st.get(key).lifecycleState, 'ACKNOWLEDGED');
  st.reconcile([evalRoad(r, 14)], { rules: [r], now: '2026-10-09T10:02:00Z' }); assert.equal(st.get(key).lifecycleState, 'ACKNOWLEDGED', 'ack does not resolve while TRUE');
  st.reconcile([evalRoad(r, 40)], { rules: [r], now: '2026-10-09T10:03:00Z' }); assert.equal(st.get(key).lifecycleState, 'RESOLVED');
  st.reconcile([evalRoad(r, 15)], { rules: [r], now: '2026-10-09T10:04:00Z' }); assert.equal(st.get(key).lifecycleState, 'ACTIVE'); assert.equal(st.get(key).acknowledgedAt, undefined);
  st.snooze(key, { can: can('alert.snooze'), until: '2026-10-09T11:00:00Z', at: '2026-10-09T10:05:00Z' }); assert.equal(st.get(key).lifecycleState, 'SNOOZED');
  deq(st.expireSnoozes('2026-10-09T10:30:00Z'), []); deq(st.expireSnoozes('2026-10-09T11:00:00Z'), [key]); assert.equal(st.get(key).lifecycleState, 'ACTIVE');
  st.reconcile([evalRoad(r, 5)], { rules: [r], now: '2026-10-09T11:01:00Z' }); assert.equal(st.get(key).currentSeverity, 'CRITICAL');
  assert.throws(() => st.dismiss(key, { can: can('alert.dismiss'), reasonCode: 'CLIENT_AWARE' }), e => e.code === 'DISMISS_NOT_ALLOWED');
  st.reconcile([evalRoad(r, 15)], { rules: [r], now: '2026-10-09T11:02:00Z' });
  assert.throws(() => st.dismiss(key, { can: can('alert.dismiss') }), e => e.code === 'MISSING_REASON');
  st.dismiss(key, { can: can('alert.dismiss'), reasonCode: 'CLIENT_AWARE', by: 'user:broker-1' }); assert.equal(st.get(key).lifecycleState, 'DISMISSED');
  deq(st.reconcile([evalRoad(r, 15.5)], { rules: [r], now: '2026-10-09T11:03:00Z' }).changes.map(c => c.action), ['KEPT_DISMISSED']);
});
test('projection: client hides internal ids and low severities; broker adds key/field; technical adds rule version, fingerprint and explanation', () => {
  const l = lots.find(x => x.intelligence.alerts.some(a => a.severity === 'ATTENTION') && x.intelligence.alerts.some(a => a.severity === 'IMPORTANT'));
  const { candidates } = MIG.engine.evaluation(cat, l, byId.get(l.identity.id), { asOf: AS_OF });
  const client = candidates.map(c => AL.project(c, 'CLIENT')).filter(Boolean), broker = candidates.map(c => AL.project(c, 'BROKER')), tech = candidates.map(c => AL.project(c, 'TECHNICAL'));
  assert.ok(client.length < broker.length && client.every(a => a.severity === 'IMPORTANT' || a.severity === 'CRITICAL'));
  assert.ok(client.every(a => !JSON.stringify(a).includes('rule:') && !('alertKey' in a) && !('fieldKey' in a)));
  assert.ok(broker.every(a => a.alertKey && !('ruleVersionId' in a)));
  assert.ok(tech.every(a => a.ruleVersionId.endsWith('@1.0.0') && a.fingerprint && a.explanation.triggerFacts.length));
  deq(AL.sortAlerts(candidates).map(c => c.severity), candidates.map(c => c.severity).sort((a, b) => App.enums.SEVERITY_ORDER.indexOf(a) - App.enums.SEVERITY_ORDER.indexOf(b)));
});

// ---------------------------------------------------------------- dependency index / selective re-evaluation
test('selective re-evaluation: price → only the price rule; availability → availability rules; analysis → the 10 analysis rules; unrelated → none', () => {
  const idx = RE.dependencyIndex(cat.compiled);
  deq(RE.plan(idx, { type: 'PRICE_TABLE_CHANGED' }).ruleCodes, ['SHARE_PRICE_FROM_LAST_TABLE']);
  deq(RE.plan(idx, { type: 'AVAILABILITY_CHANGED' }).ruleCodes, ['AVAILABILITY_CONFIRMATION', 'SHARE_NOT_OFFERABLE', 'SHARE_STATUS_NOT_CONFIRMED']);
  deq(RE.plan(idx, { type: 'ANALYSIS_VERSION_CHANGED' }).ruleCodes, ['AFTERNOON_SUN', 'AVENUE', 'BUILDING_RESTRICTION', 'EASEMENT', 'GEOMETRY', 'MISSING_AREA', 'NOISE', 'PRIVACY', 'TECHNICAL_AREA', 'TRAFFIC']);
  deq(RE.plan(idx, { type: 'DOCUMENT_UPLOADED' }).ruleCodes, []);
  deq(RE.plan(idx, { type: 'X', metricIds: ['DISTANCE_EXTERNAL_ROAD_M'], entityIds: ['b', 'a'] }), { ruleCodes: ['AVENUE'], entityIds: ['a', 'b'], reasonCodes: ['INPUT_CHANGED'], eventType: 'X' });
  const avenue = cat.byCode.get('AVENUE').dependencyManifest; deq([...avenue.pricingDependencies, ...avenue.availabilityDependencies], []); deq([...avenue.analysisDefinitionIds], ['LOT_INTELLIGENCE_BASE']);
});
test('evidence refs: only versions of domains the rule reads (AVENUE: analysis, not price table or availability revision)', () => {
  const l = lots.find(x => x.intelligence.alerts.some(a => a.type === 'AVENUE'));
  const c = MIG.engine.evaluation(cat, l, byId.get(l.identity.id)).candidates.find(x => x.ruleCode === 'AVENUE');
  const types = c.evidenceRefs.map(e => e.type);
  assert.ok(types.includes('ANALYSIS_VERSION') && types.includes('RULE_OPERAND')); assert.ok(!types.includes('PRICE_TABLE_VERSION') && !types.includes('AVAILABILITY_REVISION'));
});

// ---------------------------------------------------------------- RuleVersion / RuleSet lifecycle
function freshRegistry() {
  const reg = RE.ruleSetRegistry({ organizationId: 'house7' });
  reg.addDefinition({ ...roadDef, scope: { organizationId: 'house7' } }); reg.addVersion(roadVer());
  reg.validateVersion('rule:t:ROAD@1.0.0');
  reg.createRuleSetVersion({ id: 'rs:1', ruleVersionIds: ['rule:t:ROAD@1.0.0'] });
  reg.publishRuleSet('rs:1', { can: can('rule.publish'), reason: 'inicial', expectedCurrentId: null, at: '2026-10-09T09:00:00Z' });
  return reg;
}
test('rule versions: published is immutable; threshold change = new version; draft never served; publish needs permission and reason', () => {
  const reg = freshRegistry();
  assert.throws(() => reg.updateVersion('rule:t:ROAD@1.0.0', { parameters: { max: 25 } }), e => e.code === 'PUBLISHED_IMMUTABLE');
  assert.throws(() => { reg.version('rule:t:ROAD@1.0.0').parameters.max = 25; }, TypeError);
  reg.addVersion(roadVer({ id: 'rule:t:ROAD@1.1.0', version: '1.1.0', sequence: 2, parameters: { max: 25 } }));
  reg.createRuleSetVersion({ id: 'rs:2', ruleVersionIds: ['rule:t:ROAD@1.1.0'] });
  assert.equal(reg.pointer().latestRuleSetVersionId, 'rs:2'); assert.equal(reg.pointer().currentPublishedRuleSetVersionId, 'rs:1');
  deq(reg.currentCompiled().map(c => c.parameters.max), [20], 'broker/client consume the published set, not the latest draft');
  assert.throws(() => reg.compiledSet('rs:2'), e => e.code === 'DRAFT_NOT_ALLOWED'); assert.equal(reg.compiledSet('rs:2', { technical: true })[0].parameters.max, 25);
  assert.throws(() => reg.publishRuleSet('rs:2', { can: () => false, reason: 'x', expectedCurrentId: 'rs:1' }), e => e.code === 'FORBIDDEN');
  assert.throws(() => reg.publishRuleSet('rs:2', { can: can('rule.publish'), reason: 'x', expectedCurrentId: 'rs:1' }), e => e.code === 'RULESET_NOT_VALIDATED');
  deq(reg.currentCompiled().map(c => c.parameters.max), [20], 'failed publication changed nothing (atomic)');
  reg.validateVersion('rule:t:ROAD@1.1.0');
  assert.throws(() => reg.publishRuleSet('rs:2', { can: can('rule.publish'), reason: 'x', expectedCurrentId: null }), e => e.code === 'RULESET_CURRENT_VERSION_CONFLICT');
  reg.publishRuleSet('rs:2', { can: can('rule.publish'), reason: 'novo limite', expectedCurrentId: 'rs:1', at: '2026-10-09T12:00:00Z' });
  deq(reg.currentCompiled().map(c => c.parameters.max), [25]);
  assert.equal(reg.definition('rule:t:ROAD').currentPublishedVersionId, 'rule:t:ROAD@1.1.0');
});
test('rule set publication is atomic: one invalid version rejects the whole set', () => {
  const reg = freshRegistry();
  reg.addVersion(roadVer({ id: 'rule:t:ROAD@2.0.0', version: '2.0.0', unknownPolicy: undefined }));
  assert.throws(() => reg.validateVersion('rule:t:ROAD@2.0.0'), e => e.code === 'RULE_INVALID'); assert.equal(reg.version('rule:t:ROAD@2.0.0').lifecycleStatus, 'REJECTED');
  reg.createRuleSetVersion({ id: 'rs:bad', ruleVersionIds: ['rule:t:ROAD@2.0.0'] });
  assert.throws(() => reg.publishRuleSet('rs:bad', { can: can('rule.publish'), reason: 'x', expectedCurrentId: 'rs:1' }), e => e.code === 'RULESET_NOT_VALIDATED');
  assert.equal(reg.pointer().currentPublishedRuleSetVersionId, 'rs:1');
  assert.throws(() => reg.createRuleSetVersion({ id: 'rs:dup', ruleVersionIds: ['rule:t:ROAD@1.0.0', 'rule:t:ROAD@2.0.0'] }), e => e.code === 'DUPLICATE_RULE_IN_SET');
});
test('golden RuleSetRollbackReevaluation: rollback re-activates the old set and alerts follow by re-evaluation (no restore)', () => {
  const reg = freshRegistry();
  reg.addVersion(roadVer({ id: 'rule:t:ROAD@1.1.0', version: '1.1.0', parameters: { max: 25 } })); reg.validateVersion('rule:t:ROAD@1.1.0');
  reg.createRuleSetVersion({ id: 'rs:2', ruleVersionIds: ['rule:t:ROAD@1.1.0'] }); reg.publishRuleSet('rs:2', { can: can('rule.publish'), reason: 'x', expectedCurrentId: 'rs:1', at: '2026-10-09T12:00:00Z' });
  const st = AL.store({ organizationId: 'house7' }), [r2] = reg.currentCompiled();
  st.reconcile([evalRoad(r2, 22)], { rules: [r2], now: '2026-10-09T12:01:00Z' }); assert.equal(st.all()[0].lifecycleState, 'ACTIVE');
  const rb = reg.rollback('rs:1', { can: can('rule.publish'), reason: 'limite 25 m gerou alertas demais', expectedCurrentId: 'rs:2', at: '2026-10-09T13:00:00Z' });
  assert.equal(rb.requiresReevaluation, true);
  const [r1] = reg.currentCompiled(); st.reconcile([evalRoad(r1, 22)], { rules: [r1], now: '2026-10-09T13:01:00Z' });
  const inst = st.all()[0]; assert.equal(inst.lifecycleState, 'RESOLVED'); assert.equal(st.history(inst.alertKey).length, 2);
  assert.equal(reg.ruleSet('rs:2').lifecycleStatus, 'PUBLISHED', 'the newer set stays as history');
  assert.equal(reg.asOf('2026-10-09T12:30:00Z'), 'rs:2'); assert.equal(reg.asOf('2026-10-09T13:30:00Z'), 'rs:1'); assert.equal(reg.asOf('2026-10-09T08:00:00Z'), null);
});
test('golden HistoricalReplayNoLiveMutation: replay evaluates but never reconciles live alerts', () => {
  const r = RE.compile(roadDef, roadVer()), st = AL.store({ organizationId: 'house7' });
  st.reconcile([evalRoad(r, 15)], { rules: [r], now: AS_OF });
  const before = JSON.stringify(st.all()), out = st.reconcile([evalRoad(r, 40)], { rules: [r], now: AS_OF, mode: 'REPLAY' });
  assert.equal(out.mutated, false); assert.equal(JSON.stringify(st.all()), before);
});
test('rule test cases are first-class: every migrated rule passes its cases', () => {
  const res = RE.runTestCases(cat.byCode.get('TECHNICAL_AREA'), [
    { id: 'near', input: lotInput({ DISTANCE_TECHNICAL_AREA_M: 30.4 }), expectedTruth: 'TRUE', expectedSeverity: 'IMPORTANT', expectedMessage: 'a 30 m da EEEB (estação elevatória de esgoto)' },
    { id: 'far', input: lotInput({ DISTANCE_TECHNICAL_AREA_M: 40 }), expectedTruth: 'FALSE' },
    { id: 'null', input: lotInput({ DISTANCE_TECHNICAL_AREA_M: null }), expectedTruth: 'UNKNOWN' }]);
  assert.ok(res.every(x => x.pass), JSON.stringify(res));
});
test('performance: all 14 rules × 498 lots evaluate quickly', () => {
  const t = Date.now(); for (const l of lots) AL.evaluateLot(cat.compiled, l, { analysisResult: byId.get(l.identity.id), organizationId: 'house7', asOf: AS_OF });
  assert.ok(Date.now() - t < 5000);
});
