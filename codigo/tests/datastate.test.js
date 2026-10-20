'use strict';
// Topic 37 — unknown data states with graceful degradation. Golden scenarios named after the spec (§516).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

let App, D, repo, lots, lot0;
const DEV = 'viva-juara';
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m);
const clone = l => JSON.parse(JSON.stringify(l));
test.before(async () => {
  App = load();
  for (const f of ['datastate/dataState.js', 'favorites/favorites.js', 'presentation/favoritesView.js']) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  D = App.dataState; repo = App.repos.LotRepository(DEV); await repo.load(); lots = repo.lotsSync(); lot0 = lots[0];
});
const set = (l, p, v) => { const ks = p.split('.'); let o = l; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = v; return l; };

// ---------------------------------------------------------------- axes and vocabularies
test('five orthogonal axes exist and are not folded into one enum; RESTRICTED/HIDDEN are projections only', () => {
  deq(Object.keys(D.CanonicalDataState), ['KNOWN', 'UNKNOWN', 'NOT_AVAILABLE', 'NOT_APPLICABLE', 'PENDING', 'CONFLICTED', 'INVALID', 'ERROR', 'PARTIAL']);
  deq(Object.keys(D.FreshnessState), ['CURRENT', 'STALE', 'EXPIRED', 'UNKNOWN', 'NOT_APPLICABLE']);
  deq(Object.keys(D.UiLoadState), ['NOT_REQUESTED', 'LOADING', 'LOADED', 'FAILED']);
  assert.ok(!('RESTRICTED' in D.CanonicalDataState) && !('STALE' in D.CanonicalDataState) && !('OFFLINE' in D.CanonicalDataState) && !('LOADING' in D.CanonicalDataState));
  assert.ok('RESTRICTED' in D.ProjectedDataState && 'HIDDEN' in D.ProjectedDataState);
  for (const r of Object.values(D.REASONS)) { assert.ok(r.allowedStates.length); assert.ok(r.labels.CLIENT && r.labels.BROKER && r.labels.TECHNICAL === r.code); for (const s of r.allowedStates) assert.ok(D.CanonicalDataState[s]); }
  for (const k of ['SOURCE_NOT_PROVIDED', 'SOURCE_NOT_INGESTED', 'NOT_MEASURED', 'MISSING_REQUIRED_INPUT', 'NOT_APPLICABLE_BY_DOMAIN', 'PENDING_IMPORT', 'CONFLICT_UNRESOLVED', 'VALIDATION_FAILED', 'PROCESSING_FAILED', 'LEGACY_UNCLASSIFIED']) assert.ok(D.REASONS[k], k);
  deq(Object.keys(D.NOT_AVAILABLE_REASON_ALIGNMENT), Object.keys(D.REASONS), 'one code per meaning (alignment with topic 33)');
});

// ---------------------------------------------------------------- golden scenarios
test('KnownZeroValue: 0 stays KNOWN 0 where the field allows it; price 0 is INVALID (never a value)', () => {
  const l = lots.find(x => x.mobility.vehiclesPassingEstimate === 0);
  const r = D.resolve(l, 'mobility.vehiclesPassingEstimate'); assert.equal(r.value, 0); assert.equal(r.canonicalState, 'KNOWN'); assert.equal(r.display.primaryText, '0');
  deq(D.toDto(r, 'VALUE_ONLY'), { attributePath: 'mobility.vehiclesPassingEstimate', value: 0, state: 'KNOWN' });
  const p = D.resolve(set(clone(lot0), 'commercial.price', 0), 'commercial.price'); assert.equal(p.canonicalState, 'INVALID'); assert.equal(p.value, null); assert.notEqual(p.display.primaryText, 'R$ 0');
});
test('KnownFalseBoolean: false shows "Não", never "Não informado"; null shows "Não informado"-like state, never "Não"', () => {
  const r = D.resolve(lot0, 'geometry.isCorner'); assert.equal(r.value, false); assert.equal(r.canonicalState, 'KNOWN'); assert.equal(r.display.primaryText, 'Não');
  deq(D.toDto(r, 'SUMMARY'), { attributePath: 'geometry.isCorner', value: false, state: 'KNOWN', freshness: 'NOT_APPLICABLE' });
  const u = D.resolve(set(clone(lot0), 'geometry.isCorner', null), 'geometry.isCorner', { mode: 'client' });
  assert.equal(u.canonicalState, 'UNKNOWN'); assert.equal(u.reasonCode, 'LEGACY_UNCLASSIFIED'); assert.equal(u.value, null);
  assert.equal(u.display.primaryText, 'Informação não disponível'); assert.notEqual(u.display.primaryText, 'Não');
});
test('UnknownLegacyNull: a null with no recoverable reason is UNKNOWN / LEGACY_UNCLASSIFIED (honest), never NOT_APPLICABLE', () => {
  const r = D.resolve(lot0, 'identity.externalCode'); assert.equal(r.canonicalState, 'UNKNOWN'); assert.equal(r.reasonCode, 'LEGACY_UNCLASSIFIED');
  assert.ok(D.validateState(null, 'UNKNOWN', { attributePath: 'identity.externalCode', reasonCode: 'LEGACY_UNCLASSIFIED' }).warnings.some(w => w.code === 'LEGACY_UNCLASSIFIED_NULL'));
  assert.equal(D.resolve(lot0, 'surroundings.appNearby').canonicalState, 'UNKNOWN', 'APP próxima: mata não é APP — não vira "Não"');
});
test('NotAvailableSourceNotProvided: setbacks are NOT_AVAILABLE only because the regulation is missing (evidence), with broker/technical wording', () => {
  const r = D.resolve(lot0, 'construction.frontSetbackM', { mode: 'broker' });
  assert.equal(r.canonicalState, 'NOT_AVAILABLE'); assert.equal(r.reasonCode, 'SOURCE_NOT_PROVIDED'); assert.equal(r.display.primaryText, 'Não disponível'); assert.equal(r.display.ariaText, 'Recuo frontal: não disponível.');
  assert.equal(D.resolve(lot0, 'construction.frontSetbackM', { mode: 'technical' }).display.secondaryText, 'NOT_AVAILABLE / SOURCE_NOT_PROVIDED');
  const withReg = set(clone(lot0), 'construction.regulationStatus', 'AVAILABLE');
  assert.equal(D.resolve(withReg, 'construction.frontSetbackM').reasonCode, 'LEGACY_UNCLASSIFIED', 'without the evidence the reason is not invented');
  deq(D.toDto(r), { attributePath: 'construction.frontSetbackM', value: null, state: 'NOT_AVAILABLE', reasonCode: 'SOURCE_NOT_PROVIDED', freshness: 'NOT_APPLICABLE' });
});
test('NotApplicableDomainCase: NOT_APPLICABLE only by explicit domain rule (block number by letter; reservedUntil for a SOLD lot)', () => {
  const r = D.resolve(lot0, 'identity.blockNumber'); assert.equal(r.canonicalState, 'NOT_APPLICABLE'); assert.equal(r.display.primaryText, 'Não se aplica'); deq(r.display.actionIds, []);
  assert.equal(D.resolve(lot0, 'availability.reservedUntil').canonicalState, 'UNKNOWN', 'status UNKNOWN: cannot know whether it applies');
  const sold = set(clone(lot0), 'availability.status', 'SOLD');
  assert.equal(D.resolve(sold, 'availability.reservedUntil').canonicalState, 'NOT_APPLICABLE');
  assert.equal(D.resolve(sold, 'availability.proposalId').canonicalState, 'UNKNOWN', 'a sold lot may have a proposal reference');
});
test('PendingImport / PendingAnalysis: PENDING comes from a state record (domain), not from UI loading; UI FAILED does not mutate it', () => {
  const idx = D.createIndex('house7');
  idx.put(D.createRecord({ organizationId: 'house7', developmentId: DEV, entityId: lot0.identity.id, attributePath: 'construction.frontSetbackM', canonicalState: 'PENDING', reasonCode: 'PENDING_IMPORT', recordedAt: '2026-10-09T00:00:00Z' }));
  idx.put(D.createRecord({ organizationId: 'house7', developmentId: DEV, entityId: lot0.identity.id, attributePath: 'environmental.solarScore', canonicalState: 'PENDING', reasonCode: 'PENDING_ANALYSIS', recordedAt: '2026-10-09T00:00:00Z' }));
  const r = D.resolve(lot0, 'construction.frontSetbackM', { index: idx, mode: 'client' }); assert.equal(r.canonicalState, 'PENDING'); assert.equal(r.display.primaryText, 'Em atualização');
  assert.equal(D.resolve(lot0, 'environmental.solarScore', { index: idx }).value, null, 'pending analysis value is not used as current');
  const known = D.resolve(lot0, 'commercial.price'), loading = D.withLoad(known, 'LOADING'), failed = D.withLoad(known, 'FAILED');
  assert.equal(loading.skeleton, true); assert.equal(failed.resolved.canonicalState, 'KNOWN', 'request failure ≠ canonical ERROR'); assert.equal(failed.uiLoadState, 'FAILED');
  assert.equal(idx.transitions().length, 2); assert.equal(idx.transitions()[0].toState, 'PENDING');
});
test('UnresolvedConflict: CONFLICTED keeps value null (no candidate used) and blocks the share of a critical field', () => {
  const idx = D.createIndex('house7');
  idx.put(D.createRecord({ organizationId: 'house7', entityId: lot0.identity.id, attributePath: 'geometry.areaM2', canonicalState: 'CONFLICTED', reasonCode: 'CONFLICT_UNRESOLVED', metadata: { candidates: [250, 255] } }));
  const r = D.resolve(lot0, 'geometry.areaM2', { index: idx, mode: 'broker' });
  assert.equal(r.value, null); assert.equal(r.display.primaryText, 'Dados divergentes — confirmar'); deq(r.display.actionIds, ['viewSource', 'requestConfirmation']);
  assert.equal(D.validateState(250, 'CONFLICTED', { attributePath: 'geometry.areaM2', reasonCode: 'CONFLICT_UNRESOLVED' }).errors[0].code, 'CONFLICTED_WITH_UNRESOLVED_OPERATIONAL_VALUE');
  const conflictedPrice = clone(lot0); conflictedPrice.commercial.price = null; conflictedPrice.commercial.conflict = true;
  assert.equal(D.shareLine('Preço', D.resolve(conflictedPrice, 'commercial.price')).blocked, true);
  assert.equal(D.evaluateRange(r, { min: 200 }), 'UNKNOWN');
});
test('InvalidParsedValue / ProcessingError: invalid values are not consumed; ERROR is technical, the client sees a neutral text', () => {
  const raw = D.observeRaw({ a: 'abc' }, 'a'); const n = D.normalizeObservation(raw, { parse: v => { const x = Number(v); if (!Number.isFinite(x)) throw new Error('NaN'); return x; } });
  assert.equal(n.canonicalDataState, 'INVALID'); assert.equal(n.canonicalValue, null); assert.equal(n.reasonCode, 'VALIDATION_FAILED');
  const out = D.derive({ a: D.resolve(lot0, 'geometry.areaM2') }, () => { throw new Error('boom'); });
  assert.equal(out.dataState, 'ERROR'); assert.equal(out.reasonCode, 'PROCESSING_FAILED');
  const idx = D.createIndex('house7'); idx.put(D.createRecord({ organizationId: 'house7', entityId: lot0.identity.id, attributePath: 'environmental.solarScore', canonicalState: 'ERROR', reasonCode: 'PROCESSING_FAILED' }));
  assert.equal(D.resolve(lot0, 'environmental.solarScore', { index: idx, mode: 'client' }).display.primaryText, 'Informação temporariamente indisponível');
  assert.equal(D.resolve(lot0, 'environmental.solarScore', { index: idx, mode: 'technical' }).display.secondaryText, 'ERROR / PROCESSING_FAILED');
  assert.ok(!/ERROR|PROCESSING/.test(JSON.stringify(D.resolve(lot0, 'environmental.solarScore', { index: idx, mode: 'client' }).display)), 'no raw technical code to the client');
});
test('PartialCompositeGeometry: PARTIAL needs child states; composite summary is PARTIAL while children keep their own states', () => {
  const idx = D.createIndex('house7');
  idx.put(D.createRecord({ organizationId: 'house7', entityId: lot0.identity.id, attributePath: 'construction.easements', canonicalState: 'PARTIAL', completeness: 'PARTIAL', metadata: { children: { frontage: 'KNOWN', depth: 'UNKNOWN', rearWidth: 'KNOWN' } } }));
  const r = D.resolve(lot0, 'construction.easements', { index: idx }); assert.equal(r.canonicalState, 'PARTIAL'); assert.equal(r.completeness, 'PARTIAL');
  assert.equal(idx.get(lot0.identity.id, 'construction.easements').metadata.children.depth, 'UNKNOWN');
  assert.ok(D.validateState([], 'PARTIAL', { attributePath: 'construction.easements' }).warnings.some(w => w.code === 'PARTIAL_COMPOSITE_VALUE'));
});
test('KnownButStalePrice: STALE keeps the value (KNOWN + STALE) and adds "confirmar"; EXPIRED is not usable for comparisons', () => {
  const l = clone(lot0); l.metadata.freshness.commercial = 'STALE';
  const r = D.resolve(l, 'commercial.price', { mode: 'broker' });
  assert.equal(r.canonicalState, 'KNOWN'); assert.equal(r.freshness, 'STALE'); assert.equal(r.value, lot0.commercial.price);
  assert.equal(r.display.primaryText, App.fmt.formatBRL(lot0.commercial.price)); assert.equal(r.display.stateLabel, 'Desatualizado — confirmar');
  assert.match(r.display.ariaText, /Informação desatualizada; confirmar condição atual/);
  assert.equal(D.resolve(l, 'commercial.price', { mode: 'client' }).display.stateLabel, 'Confirmar condição atual');
  assert.match(D.shareLine('Preço de tabela', r).text, /\(confirmar condição atual\)$/);
  const e = clone(lot0); e.metadata.freshness.commercial = 'EXPIRED'; assert.equal(D.isUsable(D.resolve(e, 'commercial.price')), false); assert.equal(D.isKnownValue(D.resolve(e, 'commercial.price')), true);
  assert.equal(D.diagnostics([l]).staleKnownCount > 0, true);
});
test('KnownButRestrictedField / HiddenSensitiveField: access is a projection; canonical unchanged; HIDDEN leaks nothing', () => {
  const r = D.resolve(lot0, 'commercial.price', { access: { 'commercial.price': 'REDACTED' } });
  assert.equal(r.projectedState, 'RESTRICTED'); assert.equal(r.value, null); assert.equal(r.canonicalState, null, 'existence of a known value not revealed'); assert.equal(r.reasonCode, null);
  assert.equal(lot0.commercial.price > 0, true, 'source not altered'); assert.equal(D.canonicalStateOf(lot0, 'commercial.price').canonicalState, 'KNOWN');
  deq(D.toDto(r), { attributePath: 'commercial.price', value: null, projectedState: 'RESTRICTED' });
  const n = clone(lot0); n.availability.notes = 'nota interna';
  assert.equal(D.resolve(n, 'availability.notes', { mode: 'client' }), null, 'HIDDEN → field absent');
  assert.equal(D.toDto(D.resolve(n, 'availability.notes', { mode: 'client' })), undefined);
  deq(D.resolveMany(n, ['availability.notes', 'commercial.price'], { mode: 'client' }).hasOwnProperty('availability.notes'), false);
  assert.equal(D.facetCounts([D.resolve(n, 'availability.notes', { mode: 'client', keepHidden: true })]).total, 0, 'hidden values are not counted');
  assert.equal(D.evaluateConstraint(r, '<=', 300000), 'UNKNOWN', 'restricted is not treated as absent-and-passing');
  assert.notEqual(D.cacheKey({ organizationId: 'o', developmentId: DEV, entityId: 'x', attributePath: 'p', projectionScope: 'client' }), D.cacheKey({ organizationId: 'o', developmentId: DEV, entityId: 'x', attributePath: 'p' }));
});
test('UnknownNumericFilter: unknown area is UNKNOWN (not 0, not a fail); EXCLUDE by default, INCLUDE/SEPARATE_BUCKET explicit; facets keep the count', () => {
  const u = D.resolve(set(clone(lot0), 'geometry.areaM2', null), 'geometry.areaM2'), k = D.resolve(lot0, 'geometry.areaM2');
  assert.equal(D.evaluateRange(u, { min: 300 }), 'UNKNOWN'); assert.equal(D.evaluateRange(u, { max: 1000 }), 'UNKNOWN', 'null never passes as 0 ≤ max');
  assert.equal(D.evaluateRange(k, { min: 1 }), 'MATCH');
  deq(D.applyFilterPolicy('UNKNOWN'), { included: false, evaluation: 'UNKNOWN', warning: false, bucket: 'UNKNOWN' });
  assert.equal(D.applyFilterPolicy('UNKNOWN', 'INCLUDE_WITH_WARNING').warning, true); assert.equal(D.applyFilterPolicy('UNKNOWN', 'SEPARATE_BUCKET').bucket, 'SEM_DADO');
  deq(D.facetCounts([u, k, D.resolve(lot0, 'identity.blockNumber')]), { total: 3, known: 1, unknown: 1, notAvailable: 0, notApplicable: 1, conflicted: 0, pending: 0, invalid: 0, error: 0, partial: 0, restricted: 0 });
  // existing filter module already keeps unknown apart (no regression): area min with unknown area excluded and counted as unknown
  const FX = App.filters, noArea = set(clone(lot0), 'geometry.areaM2', null), q = FX.compile({ areaMin: 1 }, { developmentId: DEV });
  const res = FX.run([noArea, lots[1]], q.query || q, { policy: App.availability.DEFAULT_POLICY, developmentId: DEV });
  assert.equal(res.matchedIds.has(noArea.identity.id), false, 'unknown area does not silently pass a range'); assert.equal(res.matchedIds.has(lots[1].identity.id), true);
});
test('UnknownBooleanConstraint: UNKNOWN never becomes false/FAIL; NOT_APPLICABLE separate; the rule engine receives UNKNOWN', () => {
  const u = D.resolve(set(clone(lot0), 'geometry.isCorner', null), 'geometry.isCorner');
  assert.equal(D.evaluateEquals(u, true), 'UNKNOWN'); assert.equal(D.evaluateEquals(u, false), 'UNKNOWN');
  assert.equal(D.evaluateEquals(D.resolve(lot0, 'geometry.isCorner'), false), 'MATCH');
  assert.equal(D.evaluateConstraint(D.resolve(set(clone(lot0), 'geometry.areaM2', null), 'geometry.areaM2'), '>=', 300), 'UNKNOWN');
  assert.equal(D.evaluateConstraint(D.resolve(set(clone(lot0), 'commercial.price', null), 'commercial.price'), '<=', 300000), 'UNKNOWN');
  assert.equal(D.evaluateConstraint(D.resolve(lot0, 'identity.blockNumber'), '>=', 1), 'NOT_APPLICABLE');
  deq(D.toRuleOperand(D.resolve(lot0, 'construction.frontSetbackM')), { status: 'UNKNOWN', value: null, dataState: 'NOT_AVAILABLE', reasonCode: 'SOURCE_NOT_PROVIDED' });
  assert.equal(D.toRuleOperand(D.resolve(lot0, 'geometry.isCorner')).value, false);
  // recommendation (topic 15) keeps UNKNOWN for an unknown price — not a silent pass
  const R = App.recommendation, pol = R.policyOf(DEV), c = R.constraint('budgetMax', 300000, pol);
  assert.equal(R.evaluateConstraint(c, set(clone(lot0), 'commercial.price', null), pol, {}).status, 'UNKNOWN');
});
test('ComparatorInsufficientData: an unknown candidate never wins/loses numerically; one valid value → INSUFFICIENT_DATA (topic 25 unchanged)', () => {
  const a = D.resolve(lot0, 'commercial.price'), b = D.resolve(set(clone(lots[1]), 'commercial.price', null), 'commercial.price');
  deq(D.comparability([{ id: 'A', resolved: a }, { id: 'B', resolved: b }]), { status: 'INSUFFICIENT_DATA', validCount: 1, noDataIds: ['B'] });
  assert.equal(D.toComparisonValueStatus(b), 'UNKNOWN'); assert.equal(D.toComparisonValueStatus(D.resolve(lot0, 'construction.frontSetbackM')), 'NO_DATA'); assert.equal(D.toComparisonValueStatus(a), 'VALID');
  const EV = App.compare.evaluation, DM = App.compare.domain, m = DM.metric('price');
  const V = (id, raw) => ({ candidateId: id, metricId: 'price', rawValue: raw, valueStatus: raw == null ? 'NO_DATA' : 'VALID', comparableState: 'COMPARABLE', freshness: null, confidence: 'HIGH', provenanceSummary: null, versionRef: 'v1', unit: m.unit });
  const ev = EV.evaluateCriterion(m, [V('A', 299000), V('B', null)], { audience: 'broker', reg: EV.registry(DEV), evaluationProfileId: 'BROKER_STANDARD', contextMode: 'GENERAL', hasCustomer: false, customerProfile: null, availabilityPolicy: App.availability.DEFAULT_POLICY, context: DM.normalizeContext() });
  assert.equal(ev.evaluationStatus, 'INSUFFICIENT_DATA'); deq([...ev.winnerCandidateIds], []);
  // sort: unknown LAST with no ±Infinity sentinel, stable tie-breaker
  const items = [{ id: 'B', resolved: b }, { id: 'A', resolved: a }, { id: 'C', resolved: D.resolve(lots[2], 'commercial.price') }];
  deq(D.sortWithUnknown(items, 'asc').map(i => i.id).slice(-1), ['B']); deq(D.sortWithUnknown(items, 'desc').map(i => i.id).slice(-1), ['B']);
  deq(D.sortWithUnknown(items, 'asc', { unknown: 'FIRST' })[0].id, 'B'); assert.equal(D.sortWithUnknown(items, 'asc', { unknown: 'SEPARATE' }).unknown[0].id, 'B');
  assert.ok(!/Infinity/.test(fs.readFileSync(path.join(SRC, 'datastate/dataState.js'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').replace(/no ±Infinity sentinel/g, '')));
});
test('ShareUnknownSafely: no false factual claim ("Recuo frontal: 0 m"); NOT_APPLICABLE omitted; hidden never mentioned', () => {
  const s = D.shareLine('Recuo frontal', D.resolve(lot0, 'construction.frontSetbackM'));
  assert.equal(s.text, 'Recuo frontal: informação ainda não disponível'); assert.ok(!/0\s?m/.test(s.text));
  assert.equal(D.shareLine('Número da quadra', D.resolve(lot0, 'identity.blockNumber')).text, null);
  assert.equal(D.shareLine('Observação', D.resolve(lot0, 'availability.notes', { mode: 'client' })).text, null);
  assert.match(D.shareLine('Preço de tabela', D.resolve(set(clone(lot0), 'commercial.price', null), 'commercial.price')).text, /confirmar com o corretor/, 'critical field: caveat');
  deq(D.exportCells(D.resolve(lot0, 'construction.frontSetbackM'), { technical: true }), { value: '', state: 'NOT_AVAILABLE', reason: 'SOURCE_NOT_PROVIDED', freshness: 'NOT_APPLICABLE' });
  deq(D.exportCells(D.resolve(lot0, 'construction.frontSetbackM', { mode: 'client' })), { value: 'Informação ainda não disponível' });
});
test('OfflineKnownStale: offline is a connectivity context; the cached known value stays KNOWN (+ STALE), never UNKNOWN', () => {
  const l = clone(lot0); l.metadata.freshness.commercial = 'STALE';
  const r = D.resolve(l, 'commercial.price', { offline: true });
  assert.equal(r.canonicalState, 'KNOWN'); assert.equal(r.freshness, 'STALE'); assert.equal(r.connectivity.offline, true); assert.equal(r.value, lot0.commercial.price);
});

// ---------------------------------------------------------------- raw layer, validator, index, policies
test('raw presence: missing key ≠ explicit null ≠ empty string; sentinels only where configured ("-" is content elsewhere)', () => {
  deq(['a', 'b', 'c', 'd'].map(k => D.observeRaw({ b: null, c: '', d: 0 }, k).rawPresenceState), ['MISSING_KEY', 'NULL_VALUE', 'EMPTY_STRING', 'PRESENT']);
  const fech = D.normalizeObservation(D.observeRaw({ fech: 'Não informado – necessita confirmação' }, 'fech'));
  assert.equal(fech.rawPresenceState, 'SENTINEL'); assert.equal(fech.canonicalDataState, 'NOT_AVAILABLE'); assert.equal(fech.reasonCode, 'SOURCE_NOT_PROVIDED');
  assert.equal(D.observeRaw({ x: '-' }, 'x').rawPresenceState, 'PRESENT'); assert.equal(D.observeRaw({ fech: 'N/A' }, 'fech').rawPresenceState, 'PRESENT', 'N/A is not a global sentinel');
  const st = D.normalizeObservation(D.observeRaw({ st: null }, 'st')); assert.equal(st.canonicalDataState, 'UNKNOWN'); assert.equal(st.reasonCode, 'SOURCE_NOT_INGESTED');
  const nul = D.normalizeObservation(D.observeRaw({ nt: null }, 'nt')); assert.equal(nul.reasonCode, 'LEGACY_UNCLASSIFIED');
  assert.equal(D.normalizeObservation(D.observeRaw({ e: '' }, 'e')).canonicalDataState, 'INVALID', 'empty string does not silently become null');
  assert.equal(D.normalizeObservation(D.observeRaw({ z: 0 }, 'z')).canonicalValue, 0);
  assert.equal(D.normalizeObservation(D.observeRaw({}, 'gone')).canonicalDataState, 'UNKNOWN');
});
test('invariant validator: every error code reachable; known empty collection allowed only where configured', () => {
  const codes = r => r.errors.map(e => e.code);
  assert.ok(codes(D.validateState(null, null)).includes('DATA_STATE_MISSING'));
  assert.ok(codes(D.validateState(null, 'KNOWN', { attributePath: 'geometry.areaM2' })).includes('KNOWN_VALUE_MISSING'));
  assert.ok(codes(D.validateState(5, 'UNKNOWN', { attributePath: 'geometry.areaM2' })).includes('UNKNOWN_WITH_OPERATIONAL_VALUE'));
  assert.ok(codes(D.validateState(5, 'NOT_APPLICABLE', { attributePath: 'identity.blockNumber', reasonCode: 'NOT_APPLICABLE_BY_DOMAIN' })).includes('NOT_APPLICABLE_WITH_VALUE'));
  assert.ok(codes(D.validateState(5, 'INVALID', { attributePath: 'geometry.areaM2', reasonCode: 'VALIDATION_FAILED' })).includes('INVALID_WITH_OPERATIONAL_VALUE'));
  assert.ok(codes(D.validateState(null, 'NOT_APPLICABLE', { attributePath: 'geometry.areaM2', reasonCode: 'NOT_APPLICABLE_BY_DOMAIN' })).includes('STATE_NOT_ALLOWED_FOR_FIELD'));
  assert.ok(codes(D.validateState(null, 'NOT_AVAILABLE', { attributePath: 'construction.frontSetbackM' })).includes('REASON_REQUIRED'));
  assert.ok(codes(D.validateState(null, 'UNKNOWN', { reasonCode: 'MADE_UP' })).includes('UNKNOWN_REASON_CODE'));
  assert.ok(codes(D.validateState(10, 'KNOWN', { record: { valueFingerprint: D.fingerprint(9) } })).includes('VALUE_STATE_FINGERPRINT_MISMATCH'));
  assert.ok(D.validateState([], 'KNOWN', { attributePath: 'construction.easements' }).ok);
  assert.ok(D.validateState(0, 'KNOWN', { attributePath: 'geometry.rearEdgesM' }).warnings.some(w => w.code === 'ZERO_REQUIRES_REVIEW'));
  assert.ok(codes(D.validateState(0, 'KNOWN', { attributePath: 'commercial.price' })).includes('KNOWN_VALUE_MISSING'));
});
test('field policies come from the Field Registry, validate cleanly and carry registry refs; contradictions are caught', () => {
  for (const f of App.model.getStoredFields()) { const p = D.fieldPolicy(f.key); const v = D.validatePolicy(p); assert.ok(v.ok, f.key + ' ' + JSON.stringify(v.errors)); assert.ok(p.nullRequiresExplicitState); }
  assert.equal(D.fieldPolicy('geometry.isCorner').allowKnownFalse, true); assert.equal(D.fieldPolicy('commercial.price').allowKnownZero, false); assert.equal(D.fieldPolicy('location.distanceToGateLinearM').allowKnownZero, true);
  assert.equal(D.validatePolicy({ attributePath: 'geometry.isCorner', fieldType: 'boolean', allowedStates: ['KNOWN'], allowKnownZero: true }).errors[0].code, 'KNOWN_ZERO_FOR_NON_NUMBER');
  assert.equal(D.validatePolicy({ attributePath: 'x', allowedStates: ['KNOWN'], unknownDisplayPolicy: 'SHOW_VALUE' }).errors[0].code, 'UNKNOWN_DISPLAY_SHOWS_VALUE');
  assert.equal(D.fieldRegistryRefs('commercial.price').freshnessPolicyId, 'fresh:commercial');
  assert.equal(D.freshnessOf(lot0, 'geometry.areaM2'), 'NOT_APPLICABLE'); assert.equal(D.freshnessOf(lot0, 'commercial.price'), 'CURRENT'); assert.equal(D.resolve(lot0, 'availability.status').freshness, 'UNKNOWN');
});
test('state index: tenant isolation (cross-tenant read/write DENY), transitions on state change only', () => {
  const idx = D.createIndex('house7'), id = lot0.identity.id;
  assert.equal(idx.put(D.createRecord({ organizationId: 'other-org', entityId: id, attributePath: 'geometry.areaM2', canonicalState: 'PENDING', reasonCode: 'PENDING_IMPORT' })).code, 'TENANT_MISMATCH');
  idx.put(D.createRecord({ organizationId: 'house7', entityId: id, attributePath: 'geometry.areaM2', canonicalState: 'UNKNOWN', reasonCode: 'LEGACY_UNCLASSIFIED' }));
  idx.put(D.createRecord({ organizationId: 'house7', entityId: id, attributePath: 'geometry.areaM2', canonicalState: 'PENDING', reasonCode: 'PENDING_IMPORT' }));
  idx.put(D.createRecord({ organizationId: 'house7', entityId: id, attributePath: 'geometry.areaM2', canonicalState: 'PENDING', reasonCode: 'PENDING_IMPORT' }));
  idx.put(D.createRecord({ organizationId: 'house7', entityId: id, attributePath: 'geometry.areaM2', canonicalState: 'KNOWN' }));
  deq(idx.transitions().map(t => t.toState), ['UNKNOWN', 'PENDING', 'KNOWN']);
  assert.equal(idx.get(id, 'geometry.areaM2', { organizationId: 'other-org' }).denied, true);
  assert.equal(D.resolve(lot0, 'geometry.areaM2', { index: idx, organizationId: 'other-org' }).value, null, 'cross-tenant read never returns the value');
});
test('derived value: price per m² with unknown area is NOT_AVAILABLE / MISSING_REQUIRED_INPUT, never price/0', () => {
  const noArea = set(clone(lot0), 'geometry.areaM2', null);
  const out = D.derive({ price: D.resolve(noArea, 'commercial.price'), area: D.resolve(noArea, 'geometry.areaM2') }, ({ price, area }) => price / area);
  assert.equal(out.value, null); assert.equal(out.dataState, 'NOT_AVAILABLE'); assert.equal(out.reasonCode, 'MISSING_REQUIRED_INPUT'); assert.equal(out.trace.blockedBy, 'area');
  const ok = D.derive({ price: D.resolve(lot0, 'commercial.price'), area: D.resolve(lot0, 'geometry.areaM2') }, ({ price, area }) => price / area);
  assert.equal(ok.dataState, 'KNOWN'); assert.ok(Math.abs(ok.value - 1196) < 0.01, 'R$ 1.196/m² table unchanged');
});
test('map and legend: unknown values get the neutral no-data style, never the lowest bucket; counts by state', () => {
  const binOf = v => v < 300000 ? 0 : 1;
  const u = D.mapBucket(D.resolve(set(clone(lot0), 'commercial.price', null), 'commercial.price'), binOf);
  assert.equal(u.bucket, null); assert.equal(u.style.token, 'map-nodata'); assert.equal(u.style.legend, 'Sem dado'); assert.notEqual(u.style.pattern, 'none');
  assert.equal(D.mapBucket(D.resolve(lot0, 'identity.blockNumber'), binOf).style.legend, 'Não se aplica');
  deq(D.legendCounts(lots.map(l => D.resolve(l, 'availability.status'))), { withData: 0, noData: 498, conflicted: 0, notApplicable: 0 });
});
test('availability adapter: UNKNOWN status is UNKNOWN data (value null), never AVAILABLE; a known status keeps its value', () => {
  for (const l of lots) { const r = D.resolve(l, 'availability.status'); assert.notEqual(r.value, 'AVAILABLE'); assert.equal(r.canonicalState, 'UNKNOWN'); }
  const s = set(clone(lot0), 'availability.status', 'RESERVED'); const r = D.resolve(s, 'availability.status'); assert.equal(r.value, 'RESERVED'); assert.equal(r.canonicalState, 'KNOWN');
  const c = clone(lot0); c.availability.dataState = 'CONFLICTED'; assert.equal(D.resolve(c, 'availability.status').canonicalState, 'CONFLICTED');
  assert.equal(App.fmt.formatAvailability('UNKNOWN'), 'Status não confirmado');
});
test('migration parity: every KNOWN value is identical to the canonical Lot (zero delta); inventory + impact report are complete', () => {
  const p = D.parity(lots); assert.equal(p.mismatches.length, 0); assert.equal(p.checked, p.unchanged); assert.ok(p.checked > 40000);
  const inv = D.legacyNullInventory(lots), byPath = Object.fromEntries(inv.map(i => [i.attributePath + '|' + i.rawRepresentations[0], i]));
  assert.equal(byPath['construction.frontSetbackM|null'].occurrenceCount, 498); assert.equal(byPath['identity.externalCode|null'].requiresHumanReview, true);
  assert.equal(byPath['surroundings.rearCondition|"UNKNOWN"'].occurrenceCount, 30, 'the 30 "Não informado – necessita confirmação" sentinels');
  assert.equal(byPath['construction.easements|[]'].proposedCanonicalState, 'KNOWN'); assert.equal(byPath['geometry.rearEdgesM|0'].requiresHumanReview, true);
  assert.ok(!byPath['availability.freshness|"UNKNOWN"'], 'freshness UNKNOWN is a value of another axis, not missing data');
  for (const i of inv) { assert.ok(i.proposedCanonicalState); assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(i.migrationClassificationCertainty)); }
  const rep = D.impactReport(lots, { now: '2026-10-09T00:00:00Z' }); assert.equal(rep.knownValuesUnchanged, p.unchanged); assert.ok(rep.unresolvedMappings > 0);
  const d = D.diagnostics(lots); assert.equal(d.stateMissingCount, 0); assert.equal(d.trackedAttributeCount, d.knownCount + d.unknownCount + d.notAvailableCount + d.notApplicableCount + d.pendingCount + d.conflictedCount + d.invalidCount + d.errorCount + d.partialCount);
  const cov = D.coverage(lots, ['construction.frontSetbackM']); deq(cov[0].countsByState, { NOT_AVAILABLE: 498 });
});
test('the resolver does not mutate the canonical Lot and the domain holds no UI strings', () => {
  const before = JSON.stringify(lots[5]); for (const f of App.model.getStoredFields()) D.resolve(lots[5], f.key, { mode: 'client', provenance: true }); assert.equal(JSON.stringify(lots[5]), before);
  const rec = D.createRecord({ organizationId: 'house7', entityId: 'x', attributePath: 'p', canonicalState: 'UNKNOWN', reasonCode: 'LEGACY_UNCLASSIFIED' });
  assert.ok(!/[ãçéíóú]/i.test(JSON.stringify(rec)), 'records carry codes only');
  const html = App.favoritesView.dataValue('Recuo frontal', D.resolve(lot0, 'construction.frontSetbackM'));
  assert.match(html, /data-state="NOT_AVAILABLE"/); assert.match(html, /aria-label="Recuo frontal: não disponível\."/);
  assert.equal(App.favoritesView.dataValue('Obs', D.resolve(lot0, 'availability.notes', { mode: 'client' })), '');
});
