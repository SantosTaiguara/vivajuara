'use strict';
// Topic 43 — deep links and shareable state. Golden scenarios named after §124 of the spec.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

let App, C, RS, REF, NAV, SVC, repo, lots;
const DEV = 'viva-juara';
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg);
const codes = r => r.map(x => x.code);
test.before(async () => {
  App = load();
  for (const f of ['deeplink/linkStateCodec.js', 'deeplink/linkRestoration.js']) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  C = App.deeplink.codec; RS = App.deeplink.restoration; REF = App.deeplink.references; NAV = App.deeplink.navigation; SVC = App.deeplink.service;
  repo = App.repos.LotRepository(DEV); await repo.load(); lots = repo.lotsSync();
});
const codeOf = id => { const l = repo.getLotById(id); return l ? l.identity.code : id; };
const idOf = code => repo.getLotByCode(code).identity.id;
const dev = () => App.repos.DevelopmentRepository.getDevelopmentConfig(DEV);
const deps = (o = {}) => ({ currentDevelopmentId: DEV, developmentExists: id => !!App.repos.DevelopmentRepository.getDevelopment(id), resolveLot: r => repo.resolve(r), mapBounds: dev().map,
  detailSections: (dev().presentation.detailSections || []).map(s => s.id), authorize: () => false, ...o });
const open = (hash, o = {}) => { const d = C.decode(hash, o.decode); return { d, r: RS.restore(d.envelope, deps(o.deps)) }; };
const baseState = (o = {}) => ({ ...App.store.INITIAL, activeMapLayer: 'availability', backgroundLayer: 'plan', ...o });
const STORE_KEYS = ['currentLotId', 'panel', 'detailSection', 'comparisonLotIds', 'backgroundLayer', 'activeMapLayer', 'scoreKey', 'mapOverlays', 'activeFilters'];
const pick = (o, keys = STORE_KEYS) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));

// ====================================================================== backward compatibility with links produced today
const LEGACY_STATES = () => [
  baseState(),
  baseState({ currentLotId: idOf('B79') }),
  baseState({ currentLotId: idOf('B79'), panel: 'details', detailSection: 'geometry' }),
  baseState({ currentLotId: idOf('A1'), panel: 'simulation' }),
  baseState({ currentLotId: idOf('A1'), panel: 'solar', activeMapLayer: 'score', scoreKey: 'investment' }),
  baseState({ view: 'compare', comparisonLotIds: [idOf('B79'), idOf('A1')] }),
  baseState({ view: 'compare', comparisonLotIds: [idOf('A1'), idOf('A2'), idOf('A3'), idOf('B79')], backgroundLayer: 'aerial' }),
  baseState({ activeMapLayer: 'noise', mapOverlays: ['recommendation'] }),
  baseState({ activeMapLayer: 'price', mapOverlays: [] , backgroundLayer: 'hybrid' }),
  baseState({ activeFilters: { statuses: ['AVAILABLE', 'UNKNOWN'], priceMax: 300000, noCorner: true } }),
  baseState({ currentLotId: idOf('B79'), activeMapLayer: 'score', scoreKey: 'family', activeFilters: { areaMin: 300, rearOrientation: ['NE', 'N'], block: 'B' } }),
  baseState({ activeFilters: { classMin: 'A', scoreKey: 'housing', scoreMin: 80 } })
];
test('backward compatibility: every link App.router produces today decodes to the same store patch as App.router.parse', () => {
  for (const s of LEGACY_STATES()) {
    const tok = App.router.token(s, codeOf), hash = '#' + tok;
    const legacy = App.router.parse(hash, r => repo.resolve(r)), { d, r } = open(hash);
    assert.ok(['VALID', 'VALID_WITH_WARNINGS'].includes(d.status), tok + ' ' + d.status);
    assert.equal(d.linkVersion, 0, 'no v param = legacy grammar v0'); deq(d.migrationSteps, ['0→1']);
    assert.equal(r.status, 'FULL', tok + ' ' + JSON.stringify(r.skippedBranches));
    deq(pick(r.finalAppStatePatch), pick(legacy), tok);
    if (legacy.view) assert.equal(r.finalAppStatePatch.view, legacy.view);
  }
});
test('backward compatibility: the canonical v1 link is the legacy token plus v=1 (same path, same params, same order)', () => {
  for (const s of LEGACY_STATES()) {
    const tok = App.router.token(s, codeOf), d = C.decode('#' + tok), e = C.encode(d.envelope);
    const [p, q] = tok.split('?');
    assert.equal(e.hash, '#' + p + '?v=1' + (q ? '&' + q : ''), tok);
  }
});
test('forward compatibility: links written by the v1 codec are still understood by the old App.router (it ignores v/vp/sec/step)', () => {
  for (const s of LEGACY_STATES()) {
    const e = SVC.extract(s, { codeOf }), h = C.encode(e).hash;
    deq(pick(App.router.parse(h, r => repo.resolve(r))), pick(App.router.parse('#' + App.router.token(s, codeOf), r => repo.resolve(r))), h);
  }
});
test('backward compatibility: comparisonDomain deep link tokens and services/share.deepLink links decode', () => {
  const D = App.compare.domain; let s = D.createSession(DEV); s = D.addCandidate(s, 'B79', { resolve: r => repo.resolve(r) }).session; s = D.addCandidate(s, 'A1', { resolve: r => repo.resolve(r) }).session;
  const link = App.services.share.deepLink(dev().shareUrl, D.deepLinkToken(s, codeOf));
  const { d, r } = open(link);
  assert.equal(d.envelope.route, 'COMPARE'); deq(r.finalAppStatePatch.comparisonLotIds, [idOf('B79'), idOf('A1')]); assert.equal(r.finalAppStatePatch.view, 'compare');
  assert.equal(C.decode(App.services.share.deepLink('https://a/b', 'viva-juara.lots.A1')).envelope.route, 'LOT');
});
test('backward compatibility: a legacy link with a canonical technical id (VJ-QB-L0079) resolves to the same lot; the codec never rewrites lot ids', () => {
  const { d, r } = open('#viva-juara.lots.VJ-QB-L0079');
  assert.equal(d.envelope.state.lot.selectedLotId, 'VJ-QB-L0079'); assert.equal(r.finalAppStatePatch.currentLotId, 'VJ-QB-L0079');
});

// ====================================================================== codec
test('codec: round-trip of every branch (lot, layer, filters, comparison, viewport, presentation step) is stable', () => {
  const envs = [
    SVC.extract(baseState({ currentLotId: idOf('B79'), panel: 'details', detailSection: 'comfort', activeMapLayer: 'sun' }), { codeOf }),
    SVC.extract(baseState({ activeFilters: { statuses: ['AVAILABLE'], areaMin: 280 } }), { codeOf, viewport: { centerX: 1124.4, centerY: 793.6, zoom: 1.756 } }),
    SVC.extract(baseState({ view: 'compare', comparisonLotIds: [idOf('A2'), idOf('A1')] }), { codeOf, comparisonSectionId: 'comfort' }),
    SVC.extract(baseState(), { profile: 'PRESENTATION_CONTEXT', presentation: { snapshotId: 'prs_abc123def', stepId: 'st3' } })
  ];
  for (const env of envs) {
    const e1 = C.encode(env); assert.ok(e1.ok, JSON.stringify(e1.errors));
    const d = C.decode(e1.hash); assert.equal(d.status, 'VALID', e1.hash + JSON.stringify(d.warnings));
    const e2 = C.encode(d.envelope); assert.equal(e2.hash, e1.hash, 'round trip is a fixed point');
    deq(d.envelope.state, e1.envelope.state);
  }
  assert.match(C.encode(envs[1]).hash, /vp=1124,794,1\.76/);
});
test('codec: canonical ordering — parameter order and redundant defaults do not change the canonical link', () => {
  const a = C.decode('#viva-juara?layer=noise&base=aerial&ov=references,recommendation&v=1'), b = C.decode('#viva-juara?v=1&base=AERIAL&ov=recommendation,references&layer=noise');
  assert.equal(C.encode(a.envelope).hash, C.encode(b.envelope).hash);
  assert.equal(C.encode(C.decode('#viva-juara?v=1&layer=availability&base=plant&ov=comparison,recommendation,references').envelope).hash, '#viva-juara?v=1', 'defaults removed');
});
test('codec: invalid enum / malformed values are dropped with warnings; the rest of the link survives', () => {
  const d = C.decode('#viva-juara.lots.B79?v=1&base=satellite&layer=no-such!&score=luxury&vp=abc');
  assert.equal(d.status, 'VALID_WITH_WARNINGS'); assert.equal(d.envelope.state.lot.selectedLotId, 'B79'); assert.equal(d.envelope.state.map, undefined);
  assert.equal(codes(d.warnings).filter(c => c === 'PARAM_INVALID').length, 4);
  for (const bad of ['', '#', '#.lots.B79', '#VIVA JUARA', '#<script>']) assert.equal(C.decode(bad).status, 'INVALID', bad);
});
test('codec: oversized payload and huge arrays are rejected', () => {
  assert.equal(C.decode('#viva-juara?f=' + 'x'.repeat(7000)).status, 'INVALID');
  const many = Array.from({ length: 20 }, (_, i) => 'A' + (i + 1)).join('~');
  const d = C.decode('#viva-juara.compare.' + many); assert.ok(codes(d.errors).includes('COMPARISON_TOO_MANY_CANDIDATES')); assert.equal(d.envelope.route, 'MAP');
  assert.ok(codes(C.decode('#viva-juara?' + Array.from({ length: 20 }, (_, i) => 'k' + i + '=1').join('&')).errors).includes('TOO_MANY_PARAMS'));
});
test('codec: DeepLinkLegacyV1Migrated — a v1 link opened by a v2 codec is migrated by a pure registered step; v=9 is UNSUPPORTED_VERSION (route/resource only)', () => {
  const codec2 = C.createCodec({ currentVersion: 2, migrations: { ...C.MIGRATIONS, 1: raw => { const params = new Map(raw.params); if (params.get('layer') === 'oldscore') params.set('layer', 'score'); return { ...raw, params }; } } });
  const d = codec2.decode('#viva-juara?v=1&layer=oldscore&score=premium');
  assert.equal(d.migratedFromVersion, 1); deq(d.migrationSteps, ['1→2']); assert.ok(codes(d.warnings).includes('STATE_VERSION_MIGRATED'));
  assert.equal(d.envelope.state.map.layerId, 'score'); assert.equal(d.envelope.version, 2);
  const u = C.decode('#viva-juara.lots.B79.geometry?v=9&layer=futurelayer&f=zz');
  assert.equal(u.status, 'UNSUPPORTED_VERSION'); assert.equal(u.envelope.state.lot.selectedLotId, 'B79'); assert.equal(u.envelope.state.map, undefined, 'params of an unknown version are never reinterpreted');
  const r = RS.restore(u.envelope, deps()); assert.equal(r.finalAppStatePatch.currentLotId, idOf('B79'));
});
test('codec: route and panel aliases are controlled (lote/comparar/simulacao); unknown routes fall back to the map', () => {
  assert.equal(C.encode(C.decode('#viva-juara.lote.B79.simulacao').envelope).hash, '#viva-juara.lots.B79.simular?v=1');
  assert.equal(C.encode(C.decode('#viva-juara.comparar.A1~A2').envelope).hash, '#viva-juara.compare.A1~A2?v=1');
  const d = C.decode('#viva-juara.admin.x'); assert.equal(d.envelope.route, 'MAP'); assert.ok(codes(d.warnings).includes('ROUTE_UNKNOWN'));
  const c2 = C.createCodec({ aliases: { layers: { ruido: 'noise' } } }); assert.equal(c2.decode('#viva-juara?v=1&layer=ruido').envelope.state.map.layerId, 'noise');
});

// ====================================================================== privacy / security
test('privacy: phone / email / CPF / customer ids / tokens are rejected and never come back out of the codec', () => {
  const bad = ['phone=27999998888', 'email=a%40b.com', 'cpf=123.456.789-09', 'customerId=cus_abc123', 'cliente=Maria', 'token=abc', 'nome=Jo%C3%A3o', 'journeyId=jny_1234'];
  for (const p of bad) {
    const d = C.decode('#viva-juara.lots.B79?v=1&' + p);
    assert.ok(d.errors.length, p); assert.ok(d.securityRejections >= 1);
    const out = C.encode(d.envelope).hash; assert.equal(out, '#viva-juara.lots.B79?v=1', p);
  }
  // PII smuggled inside a valid key's value
  for (const v of ['f=' + encodeURIComponent('tx:joao%40mail.com'), 'f=' + encodeURIComponent('tx:27999998888'), 'step=' + encodeURIComponent('a@b.com')]) {
    const d = C.decode('#viva-juara?v=1&' + v); assert.ok(codes(d.errors).includes('PII_REJECTED'), v); assert.equal(d.envelope.state.filters, undefined);
  }
});
test('privacy: DeepLinkSensitiveStateUsesStateRef — customer context never goes inline; with a stateRef service it moves to an authenticated ref', async () => {
  const st = baseState({ currentLotId: idOf('B79'), currentCustomerId: 'cus_k3j9x2', activeFilters: { fitMin: 70, statuses: ['AVAILABLE'] } });
  const plain = await SVC.createLink({ appState: st, codeOf, profile: 'CUSTOMER_CONTEXT', base: 'https://x/app' });
  assert.ok(plain.ok); assert.ok(!plain.link.includes('cus_')); assert.ok(!/ft%3A|ft:/.test(plain.link), 'customer-derived filter not inline');
  assert.ok(codes(plain.warnings).includes('SENSITIVE_STATE_OMITTED'));
  const refs = REF.createService(), auth = { organizationId: 'org_h7', userId: 'u1', can: k => k.startsWith('link.') };
  const withRef = await SVC.createLink({ appState: st, codeOf, profile: 'CUSTOMER_CONTEXT', base: 'https://x/app', references: refs, authCtx: auth });
  assert.ok(withRef.stateRefUsed); assert.match(withRef.hash, /^#viva-juara\.lots\.B79\?v=1&s=LS[0-9A-Za-z]+$/); assert.ok(!withRef.link.includes('cus_'));
  // reopening: customer restored only after authorization; fit filter comes back from the ref
  const d = C.decode(withRef.hash);
  const r = await RS.restoreAsync(d.envelope, deps({ authorize: k => k === 'customer.read' }), { references: refs, authCtx: auth, transactions: RS.createTransactions() });
  assert.equal(r.status, 'FULL'); assert.equal(r.finalAppStatePatch.currentCustomerId, 'cus_k3j9x2'); deq(r.finalAppStatePatch.activeFilters, { fitMin: 70, statuses: ['AVAILABLE'] });
  const denied = await RS.restoreAsync(d.envelope, deps(), { references: refs, authCtx: auth, transactions: RS.createTransactions() });
  assert.equal(denied.status, 'PARTIAL'); assert.equal(denied.finalAppStatePatch.currentCustomerId, undefined); assert.ok(codes(denied.warnings).includes('CUSTOMER_ACCESS_DENIED'));
  assert.ok(!('fitMin' in (denied.finalAppStatePatch.activeFilters || {})), 'customer-derived filter needs the authorized customer');
});
test('privacy: legacy links carrying customer-derived (ft) or free-text (tx) filters are read without them; favorites-only is never linked', () => {
  const f = encodeURIComponent('st:AVAILABLE;ft:80;tx:Maria Souza;fv:1');
  const d = C.decode('#viva-juara?f=' + f); deq(d.envelope.state.filters.values, { statuses: ['AVAILABLE'] });
  for (const c of ['FILTER_SENSITIVE_IGNORED', 'FILTER_FREE_TEXT_IGNORED', 'FILTER_PERSONAL_IGNORED']) assert.ok(codes(d.warnings).includes(c), c);
  assert.ok(C.decode('#viva-juara?f=' + encodeURIComponent('tx:B79')).envelope.state.filters.values.q === 'B79', 'a lot code search is fine');
});
test('security: prototype pollution, unexpected nesting, script strings and deep merge are refused', () => {
  const d = C.decode('#viva-juara?__proto__=x&constructor=y&prototype=z&v=1');
  assert.equal(codes(d.errors).filter(c => c === 'PROTOTYPE_POLLUTION_REJECTED').length, 3); assert.equal(({}).x, undefined);
  const env = JSON.parse('{"schema":"link-state","version":1,"context":"INTERNAL","route":"MAP","state":{"development":{"developmentId":"viva-juara"},"__proto__":{"polluted":1},"map":{"layerId":"x","evil":{"a":{"b":{"c":{"d":1}}}}}}}');
  const v = C.validate(env); assert.ok(!v.ok); assert.ok(codes(v.errors).includes('PROTOTYPE_POLLUTION_REJECTED')); assert.ok(codes(v.errors).includes('BRANCH_KEY_UNKNOWN'));
  assert.equal(({}).polluted, undefined);
  assert.ok(codes(C.decode('#viva-juara?v=1&step=' + encodeURIComponent('<b>')).errors).includes('PII_REJECTED'));
  assert.ok(codes(C.decode('#viva-juara?v=1&step=' + encodeURIComponent('<script>alert(1)</script>')).errors).includes('PARAM_TOO_LONG'));
  assert.ok(codes(C.decode('#viva-juara?v=1&f=' + encodeURIComponent('p1:eval(1)')).errors).includes('PII_REJECTED'));
  // the restore patch is built key by key: an extra key in a branch never reaches the store patch
  const r = RS.restore({ ...C.decode('#viva-juara.lots.B79').envelope, state: { development: { developmentId: DEV }, lot: { selectedLotId: 'B79', drawerOpen: true } } }, deps());
  assert.deepEqual(Object.keys(r.finalAppStatePatch).sort(), ['currentLotId', 'developmentId', 'view']);
});
test('security: URL does not grant access — presentation needs authorization; stateRef is cross-tenant NOT_FOUND (DeepLinkCrossTenantDenied); no public stateRef', async () => {
  const pres = { getSnapshot: id => id === 'prs_abc123def' ? { stepIds: ['st1', 'st2', 'st3'], startStepId: 'st1' } : null };
  const no = open('#viva-juara.presentation.prs_abc123def?v=1&step=st2', { deps: { presentation: pres } }).r;
  assert.ok(codes(no.warnings).includes('PRESENTATION_ACCESS_DENIED')); assert.equal(no.hints.presentation, undefined); assert.equal(no.finalRoute, 'MAP');
  const refs = REF.createService(), a = { organizationId: 'org_a', userId: 'u1', can: () => true }, b = { organizationId: 'org_b', userId: 'u1', can: () => true };
  const ref = await refs.create(a, { payload: { development: { developmentId: DEV } }, access: 'ORGANIZATION' });
  await assert.rejects(refs.get(b, ref.id), e => e.code === 'NOT_FOUND');
  await assert.rejects(refs.get({ organizationId: 'org_a', userId: 'u2', can: () => false }, ref.id), e => e.code === 'ACCESS_DENIED');
  await assert.rejects(refs.create({ organizationId: 'org_a', can: () => false }, { payload: {} }), e => e.code === 'ACCESS_DENIED', 'deny by default');
  await assert.rejects(refs.create(a, { context: 'SHARE_ENTRY', payload: {} }), e => e.code === 'STATE_REF_NOT_PUBLIC');
  await assert.rejects(refs.create(a, { payload: { customer: { customerId: 'cus_1234', phone: '27999998888' } } }), e => e.code === 'INVALID_PAYLOAD');
  const owner = await refs.create(a, { payload: { development: { developmentId: DEV } } });
  await assert.rejects(refs.get({ ...a, userId: 'u9' }, owner.id), e => e.code === 'ACCESS_DENIED', 'OWNER_ONLY by default');
  assert.equal(C.decode('https://x/s/' + 'a'.repeat(43) + '?lot=B79').status, 'INVALID', 'share URLs are not internal links');
});

// ====================================================================== restoration
test('restoration golden: DeepLinkToLot / DeepLinkToLotWithLayer / DeepLinkToFilteredMap / DeepLinkToComparison', () => {
  let { r } = open('#viva-juara.lots.B79'); assert.equal(r.status, 'FULL'); assert.equal(r.finalRoute, 'LOT'); assert.equal(r.finalAppStatePatch.currentLotId, idOf('B79'));
  ({ r } = open('#viva-juara.lots.B79.geometry?v=1&layer=score&score=premium')); deq(pick(r.finalAppStatePatch), { currentLotId: idOf('B79'), panel: 'details', detailSection: 'geometry', activeMapLayer: 'score', scoreKey: 'premium' });
  ({ r } = open('#viva-juara?v=1&f=' + encodeURIComponent('st:AVAILABLE;a0:300'))); deq(r.finalAppStatePatch.activeFilters, { statuses: ['AVAILABLE'], areaMin: 300 }); assert.equal(r.finalRoute, 'MAP');
  ({ r } = open('#viva-juara.compare.B79~A1~B79?v=1&sec=comfort')); deq(r.finalAppStatePatch.comparisonLotIds, [idOf('B79'), idOf('A1')]); assert.equal(r.hints.comparisonSectionId, 'comfort');
});
test('restoration golden: DeepLinkPartialRestoreMissingLayer — lot restored, layer falls back to the development default, PARTIAL', () => {
  const { r } = open('#viva-juara.lots.B79?v=1&layer=legacypricescore');
  assert.equal(r.status, 'PARTIAL'); assert.equal(r.finalAppStatePatch.currentLotId, idOf('B79')); assert.equal(r.finalAppStatePatch.activeMapLayer, 'availability');
  assert.ok(codes(r.warnings).includes('LAYER_UNAVAILABLE')); assert.ok(r.message);
});
test('restoration golden: DeepLinkPartialRestoreMissingLot — no silent redirect to another lot; map + message', () => {
  const { r } = open('#viva-juara.lots.Z999?v=1&layer=noise');
  assert.equal(r.status, 'PARTIAL'); assert.equal(r.finalAppStatePatch.currentLotId, null); assert.equal(r.finalRoute, 'MAP'); assert.equal(r.finalAppStatePatch.activeMapLayer, 'noise');
  assert.equal(r.message, 'O lote deste link não está mais disponível na base atual.');
  const c = open('#viva-juara.compare.A1~Z999').r; deq(c.finalAppStatePatch.comparisonLotIds, [idOf('A1')]); assert.ok(codes(c.warnings).includes('COMPARISON_LOT_NOT_FOUND'));
});
test('restoration: removed filter, unknown overlay, out-of-frame viewport and unknown detail section are partial, never fatal', () => {
  const r = open('#viva-juara?v=1&ov=recommendation,ghost&vp=99999,5,2&f=' + encodeURIComponent('st:NOPE;zz:1')).r;
  assert.equal(r.status, 'PARTIAL'); for (const c of ['FILTER_REMOVED', 'OVERLAY_UNAVAILABLE', 'VIEWPORT_RESET']) assert.ok(codes(r.warnings).includes(c), c);
  deq(r.finalAppStatePatch.mapOverlays, ['recommendation']); assert.equal(r.hints.viewport, undefined);
  const s = open('#viva-juara.lots.B79.nosection').r; assert.ok(codes(s.warnings).includes('SECTION_NOT_FOUND')); assert.equal(s.finalAppStatePatch.currentLotId, idOf('B79'));
  const ok = open('#viva-juara?v=1&vp=1100,800,2').r; deq(ok.hints.viewport, { centerX: 1100, centerY: 800, zoom: 2 });
});
test('restoration: other / unknown development fails safely (the lot is never restored before the development)', () => {
  const r = open('#outro-empreendimento.lots.B79').r; assert.equal(r.status, 'FAILED'); deq(r.finalAppStatePatch, {});
  const r2 = RS.restore(C.decode('#viva-juara.lots.B79').envelope, deps({ currentDevelopmentId: 'outro' })); assert.equal(r2.status, 'FAILED'); assert.equal(r2.requiresDevelopment, DEV);
  deq(RS.ORDER.slice(0, 3), ['organization', 'development', 'route']);
});
test('restoration golden: DeepLinkToPresentationStep — authorized snapshot opens at the step; an invalid step falls back to the start step', () => {
  const pres = { getSnapshot: id => id === 'prs_abc123def' ? { stepIds: ['st1', 'st2', 'st3'], startStepId: 'st1' } : null }, can = k => k === 'presentation.read';
  const a = open('#viva-juara.presentation.prs_abc123def?v=1&step=st3', { deps: { presentation: pres, authorize: can } }).r; deq(a.hints.presentation, { snapshotId: 'prs_abc123def', stepId: 'st3', mode: 'SNAPSHOT' });
  const b = open('#viva-juara.presentation.prs_abc123def?v=1&step=st9', { deps: { presentation: pres, authorize: can } }).r; assert.equal(b.hints.presentation.stepId, 'st1'); assert.ok(codes(b.warnings).includes('PRESENTATION_STEP_NOT_FOUND'));
});
test('restoration golden: DeepLinkToCustomerInternal / DeepLinkToJourneyInternal — only through an authorized stateRef', async () => {
  const refs = REF.createService(), auth = { organizationId: 'org_h7', userId: 'u1', can: () => true };
  const ref = await refs.create(auth, { payload: { customer: { customerId: 'cus_abc999' }, journey: { journeyId: 'jny_xyz777' } } });
  const d = C.decode('#viva-juara?v=1&s=' + ref.id); assert.equal(d.status, 'VALID');
  const both = await RS.restoreAsync(d.envelope, deps({ authorize: () => true }), { references: refs, authCtx: auth, transactions: RS.createTransactions() });
  assert.equal(both.finalAppStatePatch.currentCustomerId, 'cus_abc999'); assert.equal(both.hints.journeyId, 'jny_xyz777');
  const onlyCustomer = await RS.restoreAsync(d.envelope, deps({ authorize: k => k === 'customer.read' }), { references: refs, authCtx: auth, transactions: RS.createTransactions() });
  assert.equal(onlyCustomer.hints.journeyId, undefined); assert.ok(codes(onlyCustomer.warnings).includes('JOURNEY_ACCESS_DENIED'));
  const inline = C.decode('#viva-juara?v=1&customer=cus_abc999'); assert.ok(codes(inline.errors).includes('FORBIDDEN_PARAM'));
});
test('restoration golden: DeepLinkStateRefExpired — expired / revoked ref restores the development only', async () => {
  let t = Date.parse('2026-10-11T12:00:00Z'); const refs = REF.createService({ now: () => new Date(t) }), auth = { organizationId: 'o', userId: 'u', can: () => true };
  const ref = await refs.create(auth, { payload: { map: { layerId: 'noise' } }, persistenceClass: 'EPHEMERAL' });
  t += 2 * 86400 * 1000;
  const r = await RS.restoreAsync(C.decode('#viva-juara.lots.B79?v=1&s=' + ref.id).envelope, deps(), { references: refs, authCtx: auth, transactions: RS.createTransactions() });
  assert.equal(r.status, 'PARTIAL'); assert.ok(codes(r.warnings).includes('STATE_REF_EXPIRED')); assert.equal(r.finalAppStatePatch.currentLotId, idOf('B79')); assert.equal(r.finalAppStatePatch.activeMapLayer, undefined);
  const m = RS.createMetrics(); m.record(null, r); assert.equal(m.snapshot().state_ref_expired_count, 1);
});
test('restoration golden: DeepLinkRaceCancelled — link A then B quickly: the late answer for A is ignored; stateRef timeout is reported', async () => {
  const tx = RS.createTransactions(), auth = { organizationId: 'o', userId: 'u', can: () => true };
  let release; const slow = { get: () => new Promise(res => { release = () => res({ payload: { map: { layerId: 'noise' } } }); }) };
  const pA = RS.restoreAsync(C.decode('#viva-juara?v=1&s=LSaaaaaaaa').envelope, deps(), { references: slow, authCtx: auth, transactions: tx, timeoutMs: 5000 });
  const rB = await RS.restoreAsync(C.decode('#viva-juara.lots.A1').envelope, deps(), { transactions: tx });
  release(); const rA = await pA;
  assert.equal(rA.status, 'CANCELLED'); assert.equal(rB.finalAppStatePatch.currentLotId, idOf('A1'));
  const never = { get: () => new Promise(() => {}) };
  const rt = await RS.restoreAsync(C.decode('#viva-juara?v=1&s=LSbbbbbbbb').envelope, deps(), { references: never, authCtx: auth, transactions: RS.createTransactions(), timeoutMs: 5 });
  assert.ok(codes(rt.warnings).includes('STATE_REF_TIMEOUT')); assert.equal(rt.status, 'PARTIAL');
});
test('restoration golden: DeepLinkMobileSemanticRestore — the same link gives the same semantic patch on every device; the layout decides the container', () => {
  const h = '#viva-juara.lots.B79.comfort?v=1&layer=noise', a = open(h).r, b = open(h, { deps: { device: 'MOBILE' } }).r;
  deq(a.finalAppStatePatch, b.finalAppStatePatch);
  for (const k of ['sheet', 'leftCollapsed', 'rightCollapsed', 'drawerOpen', 'mapViewport']) assert.ok(!(k in a.finalAppStatePatch), k);
  assert.equal(App.mobileSheet.initialSnap({ hasLot: !!a.finalAppStatePatch.currentLotId, saved: 'EXPANDED' }), 'INTERMEDIATE');
});
test('restoration: technical filters are internal only; a PRESENTATION-context link drops them', () => {
  const f = encodeURIComponent('sk:housing;sm:80;st:AVAILABLE');
  const internal = open('#viva-juara?v=1&f=' + f).r; deq(internal.finalAppStatePatch.activeFilters, { scoreKey: 'housing', scoreMin: 80, statuses: ['AVAILABLE'] });
  const env = { ...C.decode('#viva-juara?v=1&f=' + f).envelope, context: 'PRESENTATION' }, pr = RS.restore(env, deps()); deq(pr.finalAppStatePatch.activeFilters, { statuses: ['AVAILABLE'] });
});

// ====================================================================== share entry (topic 42 boundary)
test('share entry golden: DeepLinkShareScopeRejectsOtherLot / DeepLinkExternalRejectsCustomerId — appended params can only narrow the grant', () => {
  const scope = { allowedLotRefs: ['B79', 'A1'], allowedStepIds: ['st1', 'st2'], startStepId: 'st1' };
  const ok = C.shareEntryState('/s/TOKEN?step=st2&lot=B79', scope); assert.ok(ok.ok); deq(ok.state, { step: 'st2', lotRef: 'B79' });
  const other = C.shareEntryState('/s/TOKEN?lot=C10', scope); assert.ok(!other.ok); assert.ok(codes(other.rejected).includes('LOT_OUT_OF_SCOPE')); deq(other.state, { step: 'st1' });
  const cust = C.shareEntryState({ customerId: 'cus_1', resourceId: 'prs_other', priceVersion: '2025', step: 'st1' }, scope);
  assert.equal(codes(cust.rejected).filter(c => c === 'SCOPE_EXPANSION_REJECTED').length, 3); deq(cust.state, { step: 'st1' });
  const step = C.shareEntryState('step=st7', scope); assert.ok(codes(step.warnings).includes('PRESENTATION_STEP_NOT_FOUND')); assert.equal(step.state.step, 'st1'); assert.ok(step.startAtDefault);
  assert.ok(codes(C.shareEntryState({ __proto__: null, constructor: 'x' }, scope).rejected).includes('PROTOTYPE_POLLUTION_REJECTED'));
});
test('share entry: EXTERNAL_SHARE intent is delegated to the ShareService; the codec refuses to write SHARE_ENTRY links', async () => {
  const r = await SVC.createLink({ intent: 'EXTERNAL_SHARE', appState: baseState() }); assert.equal(r.delegate, 'SHARE_SERVICE'); assert.equal(r.link, undefined);
  assert.ok(!C.encode(SVC.extract(baseState()), { context: 'SHARE_ENTRY' }).ok);
  assert.equal(C.decode('#viva-juara', { context: 'SHARE_ENTRY' }).status, 'INVALID');
});

// ====================================================================== browser history
function fakeBrowser() {
  const stack = [{ hash: '' }]; let i = 0; const timers = [];
  const location = { get hash() { return stack[i].hash; } };
  const history = { state: null, pushState(_, __, h) { stack.splice(i + 1); stack.push({ hash: h }); i++; }, replaceState(_, __, h) { stack[i] = { hash: h }; }, back() { i--; } };
  return { stack, location, history, timers, setTimeout: (fn, ms) => { timers.push(fn); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; }, runTimers: () => { const t = timers.splice(0); t.forEach(f => f && f()); }, idx: () => i };
}
test('history golden: DeepLinkBackForwardNavigation — lot selection pushes, map pan replaces (debounced), Back returns the previous lot, no recursive push', () => {
  const B = fakeBrowser(), nav = NAV.createCoordinator({ history: B.history, location: B.location, encode: e => C.encode(e), setTimeout: B.setTimeout, clearTimeout: B.clearTimeout });
  const env = (s, vp) => SVC.extract(baseState(s), { codeOf, viewport: vp });
  assert.equal(nav.update(env({}), { source: 'URL_RESTORE' }).action, 'REPLACE');
  for (let k = 0; k < 100; k++) nav.update(env({}, { centerX: 1000 + k, centerY: 700, zoom: 1.5 }));
  assert.equal(B.stack.length, 1, '100 pans → no history entries'); B.runTimers(); assert.match(B.location.hash, /vp=1099,700,1\.5/);
  assert.equal(nav.update(env({ currentLotId: idOf('B79') })).action, 'PUSH');
  assert.equal(nav.update(env({ currentLotId: idOf('B79'), activeMapLayer: 'noise' })).action, 'REPLACE', 'layer change replaces');
  assert.equal(nav.update(env({ currentLotId: idOf('A1') })).action, 'PUSH');
  assert.equal(B.stack.length, 3);
  B.history.back(); // popstate → the app restores from location.hash with source BROWSER_HISTORY
  const back = C.decode(B.location.hash); const r = RS.restore(back.envelope, deps()); assert.equal(r.finalAppStatePatch.currentLotId, idOf('B79'));
  const res = nav.update(env({ currentLotId: idOf('B79'), activeMapLayer: 'noise' }), { source: 'BROWSER_HISTORY' });
  assert.equal(res.action, 'NONE'); assert.equal(B.stack.length, 3, 'no push while handling Back');
  // refresh: the same URL restores the same semantic state
  const again = RS.restore(C.decode(B.location.hash).envelope, deps()); deq(again.finalAppStatePatch, r.finalAppStatePatch);
  // transient UI never reaches the URL
  const h0 = B.location.hash; nav.update(env({ currentLotId: idOf('B79'), activeMapLayer: 'noise', hoverLotId: idOf('A2'), sheet: 'full', drawerOpen: true, rightCollapsed: true })); assert.equal(B.location.hash, h0);
  assert.ok(NAV.TRANSIENT_KEYS.includes('sheet') && NAV.TRANSIENT_KEYS.includes('hoverLotId'));
});
test('history: pushNavigational=false (small screens keep their own back marker) only replaces', () => {
  const B = fakeBrowser(), nav = NAV.createCoordinator({ history: B.history, location: B.location, encode: e => C.encode(e), pushNavigational: false });
  nav.update(SVC.extract(baseState(), { codeOf })); nav.update(SVC.extract(baseState({ currentLotId: idOf('B79') }), { codeOf }));
  assert.equal(B.stack.length, 1); assert.equal(B.location.hash, '#viva-juara.lots.B79?v=1');
});

// ====================================================================== service / extractor / observability / inventory
test('service: copy-link uses the allow-list extractor (not location.href) and never includes pixel layout, sheet snap or store internals', async () => {
  const st = baseState({ currentLotId: idOf('B79'), mapViewport: { x: 10, y: 20, k: 2 }, sheet: 'full', leftCollapsed: true, preferences: { budget: 1 }, customers: [{ name: 'Maria' }] });
  const r = await SVC.createLink({ appState: st, codeOf, base: dev().shareUrl + '#old-hash' });
  assert.equal(r.link, dev().shareUrl + '#viva-juara.lots.B79?v=1'); assert.equal(r.routeCode, 'LOT');
  deq(SVC.copiedEvent(r, 'LOT_CONTEXT'), { evt: 'internal_link_copied', data: { routeCode: 'LOT', profile: 'LOT_CONTEXT', stateRefUsed: false, intent: 'INTERNAL_REFERENCE' } });
  const min = await SVC.createLink({ appState: st, codeOf, profile: 'MAP_MINIMAL' }); assert.equal(min.hash, '#viva-juara?v=1');
});
test('observability: events carry route/context/status only — no lot codes, ids, URLs or customer data', () => {
  const d = C.decode('#viva-juara.lots.B79?v=1&layer=gone'), r = RS.restore(d.envelope, deps()), evs = RS.eventsFor(d, r);
  deq(evs.map(e => e.evt), ['deep_link_opened', 'deep_link_restored', 'deep_link_partial_restore']);
  const txt = JSON.stringify(evs); assert.ok(!/B79|VJ-|cus_|https?:/.test(txt), txt);
  for (const e of evs) for (const k of Object.keys(e.data)) assert.ok(['routeCode', 'deepLinkContext', 'navigationSource', 'linkVersion', 'decodeStatus', 'migrated', 'restoreStatus', 'stateRefUsed', 'partialRestoreReasons'].includes(k), k);
  const m = RS.createMetrics(); m.record(C.decode('#'), null); m.record(C.decode('#viva-juara?phone=27999998888'), r);
  const s = m.snapshot(); assert.equal(s.deep_link_decode_failure_count, 1); assert.equal(s.deep_link_partial_restore_count, 1); assert.equal(s.link_security_rejection_count, 1);
  deq(C.EVENTS, ['deep_link_opened', 'deep_link_restored', 'deep_link_partial_restore', 'internal_link_copied', 'saved_view_opened']);
});
test('registry / inventory: RouteRegistry, LinkStateRegistry and legacy inventory are complete and well-formed', () => {
  for (const code of Object.keys(C.AppRouteCode)) assert.ok(C.ROUTE[code], code);
  assert.ok(C.ROUTE.SHARED_PRESENTATION.allowedContexts.every(c => c === 'SHARE_ENTRY'));
  for (const r of ['CUSTOMER', 'JOURNEY']) assert.equal(C.ROUTE[r].status, 'STATE_REF_ONLY');
  for (const f of C.FIELDS) { assert.ok(f.key && f.privacy && f.maxLength && typeof f.parse === 'function'); assert.ok(!C.FORBIDDEN_KEY.test(f.key), f.key); }
  for (const i of C.LEGACY_ROUTE_INVENTORY) { assert.ok(['INTERNAL_NAV', 'EXTERNAL_SHARE', 'TEMP_STATE', 'UNKNOWN'].includes(i.purpose)); assert.ok(['KEEP', 'MIGRATE', 'DEPRECATE', 'REPLACE'].includes(i.migrationAction)); }
  assert.ok(Object.isFrozen(C.SIZE_POLICY) && C.SIZE_POLICY.maxComparisonCandidateCount === 4);
});
test('regression: decoding/restoring never mutates lots, prices, availability or the store', () => {
  const before = JSON.stringify(lots.slice(0, 20)), st0 = JSON.stringify(App.store.get());
  for (const h of ['#viva-juara.lots.B79?v=1&layer=price', '#viva-juara.compare.A1~B79', '#viva-juara?f=' + encodeURIComponent('p1:300000')]) RS.restore(C.decode(h).envelope, deps());
  assert.equal(JSON.stringify(lots.slice(0, 20)), before); assert.equal(JSON.stringify(App.store.get()), st0);
  assert.ok(lots.every(l => l.availability.status === 'UNKNOWN'));
});
