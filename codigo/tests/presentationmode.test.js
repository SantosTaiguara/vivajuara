'use strict';
// Topic 41 — Modo de Apresentação: client-safe projection, definition/snapshot/session, preflight, golden scenarios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

const MODULES = ['presentationmode/policy.js', 'presentationmode/projection.js', 'presentationmode/domain.js', 'presentationmode/runtime.js', 'presentationmode/presentationView.js'];
let App, PM, P, PJ, D, RT, V, repo, lots, dev, byCode;
const DEV = 'viva-juara', ORG = 'house7', NOW = '2026-10-09T10:00:00.000Z';
const ctx = (o = {}) => ({ organizationId: ORG, userId: 'u1', can: () => true, now: NOW, ...o });
const clone = x => JSON.parse(JSON.stringify(x));
const deq = (a, b, m) => assert.deepEqual(clone(a), clone(b), m);
const json = x => JSON.stringify(x);
let srcBase;
const src = (extra = {}, over = {}) => ({ ...srcBase, resolve: ref => { const l = repo.resolve(ref); if (!l) return null; return over[l.identity.id] ? over[l.identity.id](clone(l)) : l; }, ...extra });
const ids = (...c) => c.map(x => byCode(x).identity.id);
const MARIA = { id: 'C55', organizationId: ORG, name: 'Maria Souza Lima', preferredName: 'Maria', email: 'maria@example.com', phone: '(27) 99999-1234', profileVersionId: 'pv3',
  profile: { objective: 'housing', preferences: [{ key: 'privacy', source: 'EXPLICIT' }, { key: 'leisure', source: 'EXPLICIT' }, { key: 'quiet', source: 'INFERRED' }], budgetMax: 300000, notes: 'cliente indecisa, perdeu outro negócio' } };

test.before(async () => {
  App = load(); repo = App.repos.LotRepository(DEV); await repo.load(); lots = repo.lotsSync(); byCode = c => repo.getLotByCode(c);
  for (const f of MODULES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  PM = App.presentationMode; P = PM.policy; PJ = PM.projection; D = PM.domain; RT = PM.runtime; V = App.presentationView;
  dev = App.config.DEVELOPMENTS.find(d => d.id === DEV);
  srcBase = D.sourcesFromRepo(repo, dev);
});
const make = (input = {}, c = ctx()) => D.createDefinition(c, { developmentId: DEV, title: 'Opções para você', lotIds: ids('A1', 'A2', 'A3'), ...input });
const withTpl = (code, input, opts) => { const d = make(input); return D.applyTemplate(d, code, ctx(), opts); };
const snapOf = (def, s = src(), r = D.createRepository(), c = ctx()) => ({ r, res: D.createSnapshot(r, def, s, c, { expectedDefinitionRevision: def.recordRevision }) });

// ---------------------------------------------------------------- policy
test('client mode is deny by default: same visible set as before, new unclassified fields hidden', () => {
  const cfg = App.presentationConfig(dev);
  assert.equal(cfg.isFieldVisible('commercial.price', 'client'), true);
  assert.equal(cfg.isFieldVisible('intelligence.scores.housing', 'client'), false);
  assert.equal(cfg.isFieldVisible('some.newField', 'client'), false, 'unclassified → hidden');
  assert.equal(cfg.isFieldVisible('some.newField', 'broker'), true);
  assert.equal(P.isAllowedPath(null, 'commercial.price'), true); assert.equal(P.isAllowedPath(null, 'commercial.priceTableId'), false);
  assert.equal(P.isAllowedPath(null, 'provenance.x'), false); assert.equal(P.isAllowedPath(null, 'availability.notes'), false); assert.equal(P.isAllowedPath(null, 'whatever'), false);
});
test('projectLot builds a new object without internal paths (not hidden: removed)', () => {
  const { value, removed } = P.projectLot(byCode('A1'));
  assert.ok(!('intelligence' in value) && !('provenance' in value) && !('metadata' in value));
  assert.ok(!('id' in value.identity) && value.identity.code === 'A1');
  assert.ok(!('priceTableId' in value.commercial) && value.commercial.price != null);
  assert.ok(removed.includes('intelligence') && removed.includes('identity.id'));
});
test('policy versions are immutable and can only tighten', () => {
  assert.throws(() => P.derive(P.current(), {}), /versão/);
  const p2 = P.derive(P.current(), { version: 'client-safe-41.2.0', removeAllowed: ['commercial.price'] });
  assert.equal(P.isAllowedPath(p2, 'commercial.price'), false); assert.equal(P.isAllowedPath(P.current(), 'commercial.price'), true);
  assert.throws(() => P.transform('ARBITRARY_FN', 1), /transform/);
});
test('customer label policy: preferred/first name only; email/number never becomes a label', () => {
  assert.equal(P.customerLabel(MARIA), 'Maria'); assert.equal(P.customerLabel({ name: 'João Pedro Alves' }, 'FIRST_NAME'), 'João');
  assert.equal(P.customerLabel(MARIA, 'ANONYMOUS'), null); assert.equal(P.customerLabel({ name: 'joao@x.com' }), null);
});
test('leak scanner finds PII, internal keys, technical provenance, internal ids, markup and unsafe claims', () => {
  const codes = P.scanPayload({ a: 'fale com maria@example.com', b: { notes: 'x' }, c: 'SourceRef=DOC_48/PAGE_2', d: 'VJ-QA-L0001', e: '<b>x</b>', f: 'rentabilidade garantida', g: '(27) 99999-1234', h: { customerId: 'C55' } }).map(x => x.code);
  for (const c of ['PII_EMAIL', 'INTERNAL_FIELD', 'TECHNICAL_PROVENANCE', 'INTERNAL_LOT_ID', 'HTML_MARKUP', 'UNSAFE_CLAIM', 'PII_PHONE', 'PII_FIELD']) assert.ok(codes.includes(c), c);
  deq(P.scanPayload({ text: 'R$ 807.420', area: '675,10 m²', when: '09/10/2026, 10:00' }), []);
});

// ---------------------------------------------------------------- projections
test('ClientSafeStaleAvailability: AVAILABLE+STALE and UNKNOWN never show "Disponível"; AVAILABLE+FRESH does', () => {
  const l = clone(byCode('A1'));
  assert.equal(PJ.availability(l).state, 'STATUS_CONFIRMATION_REQUIRED', 'all 498 lots are UNKNOWN');
  l.availability = { ...l.availability, status: 'AVAILABLE', freshness: 'STALE' };
  const st = PJ.availability(l); assert.equal(st.state, 'STATUS_CONFIRMATION_REQUIRED'); assert.equal(st.label, 'Disponibilidade sujeita a confirmação.');
  l.availability.freshness = 'FRESH'; assert.equal(PJ.availability(l).state, 'AVAILABLE_CONFIRMED');
  assert.equal(PJ.availability(l, { offline: true }).state, 'STATUS_CONFIRMATION_REQUIRED', 'offline never claims current availability');
  for (const [s, e] of [['RESERVED', 'RESERVED'], ['PROPOSAL', 'IN_PROPOSAL'], ['SOLD', 'SOLD'], ['BLOCKED', 'UNAVAILABLE']]) { l.availability.status = s; assert.equal(PJ.availability(l).state, e); }
});
test('ClientSafeUnknownPrice + table price only: null price is "Preço não disponível" (never R$ 0); stale price keeps caveat; conflict hides value', () => {
  const pt = srcBase.priceTable, l = clone(byCode('A1'));
  const ok = PJ.price(l, { priceTable: pt, commercialFreshness: 'FRESH' });
  assert.equal(ok.kind, 'TABLE_PRICE'); assert.equal(ok.value, l.commercial.price); assert.equal(ok.pricePerM2Text, App.fmt.formatPricePerM2(1196)); assert.match(ok.tableLabel, /Tabela de lançamento · 06\/10\/2026/);
  l.commercial.price = null; const nd = PJ.price(l, { priceTable: pt }); assert.equal(nd.state, 'NOT_AVAILABLE'); assert.equal(nd.value, null); assert.doesNotMatch(json(nd), /R\$ 0|sob consulta/);
  const s = clone(byCode('A1')); s.metadata.freshness = { commercial: 'STALE' };
  const st = PJ.price(s, { priceTable: pt }); assert.equal(st.state, 'CURRENT_WITH_CAVEAT'); assert.equal(st.caveat, 'Condição sujeita a confirmação.'); assert.doesNotMatch(json(st), /garantido/);
  const c = clone(byCode('A1')); c.commercial.priceTableId = 'outra-tabela'; const cf = PJ.price(c, { priceTable: pt }); assert.equal(cf.state, 'CONFLICTED'); assert.equal(cf.value, null);
});
test('lot card: factual highlights from the lot engine, client-safe alerts (INFO hidden, no ids/sourceIds), no lot id', () => {
  const c = PJ.lotCard(byCode('A1'), { priceTable: srcBase.priceTable });
  assert.equal(c.lotRef, 'A1'); assert.equal(c.identityLabel, 'Quadra A · Lote 1');
  deq(c.keyHighlights.map(h => h.text), byCode('A1').intelligence.highlights.slice(0, 3).map(h => h.title));
  assert.ok(!c.clientSafeAlerts.some(a => /sol da tarde/i.test(a.title || '')), 'INFO alert hidden');
  deq(P.scanPayload(c), []); assert.doesNotMatch(json(c), /VJ-QA|analysis-v1|sourceId|fieldKey/);
});
test('fit wording: "Alta compatibilidade" only above the recommendation policy; percent only if policy allows; never chance/probabilidade', () => {
  const hi = PJ.fitSummary({ fitScore: 92, status: 'COMPLETE' }), lo = PJ.fitSummary({ fitScore: 40, status: 'PARTIAL' });
  assert.equal(hi.label, 'Alta compatibilidade'); assert.equal(hi.percentText, null); assert.notEqual(lo.label, 'Alta compatibilidade'); assert.ok(lo.caveat);
  const pol = P.derive(P.current(), { version: 'client-safe-41.1.1', showFitPercent: true });
  assert.equal(PJ.fitSummary({ fitScore: 92, status: 'COMPLETE' }, { policy: pol }).percentText, '92% de aderência');
  assert.doesNotMatch(json([hi, lo]), /chance|probabilidade/i); assert.equal(PJ.fitSummary({ fitScore: null, status: 'FAILED' }), null);
});
test('customer objective: only explicit preferences; budget minimized by default; no notes', () => {
  const o = PJ.customerObjective(MARIA.profile);
  assert.equal(o.objective, 'Objetivo: Morar'); assert.equal(o.priorities, 'Prioridades: privacidade, proximidade do lazer'); assert.equal(o.budget, null);
  assert.doesNotMatch(json(o), /indecisa|silêncio/);
});
test('map projection: safe layers only (no class/score/fit), no technical controls, text alternative', () => {
  const m = PJ.map({ developmentId: DEV, lots: [byCode('A1'), byCode('A2')] });
  assert.ok(m.safeLayers.includes('availability')); for (const x of ['class', 'score', 'fit']) assert.ok(!m.safeLayers.includes(x), x);
  assert.ok(!m.controls.includes('FILTER_BUILDER') && m.deniedControls.includes('PROVENANCE_INSPECTOR'));
  deq(m.presentedLotRefs, ['A1', 'A2']); assert.equal(m.textAlternative.length, 2); assert.ok(!m.safeOverlays.includes('filterDim'));
});

// ---------------------------------------------------------------- definition
test('definition: draft, edit, optimistic concurrency, reorder (curated ≠ rank), template, archive; org from context', () => {
  let d = make({ organizationId: 'evil' }); assert.equal(d.organizationId, ORG); assert.equal(d.lifecycleStatus, 'DRAFT'); assert.equal(d.recordRevision, 1); assert.ok(Object.isFrozen(d));
  d = D.revise(d, { title: 'Novo título' }, 1, ctx()); assert.equal(d.recordRevision, 2);
  assert.throws(() => D.revise(d, { title: 'x' }, 1, ctx()), e => e.code === 'REVISION_CONFLICT', 'two brokers on the same draft → conflict');
  assert.throws(() => D.revise(d, { organizationId: 'x' }, 2, ctx()), e => e.code === 'FIELD_NOT_EDITABLE');
  const order = [...d.lotIds].reverse(); d = D.reorderLots(d, order, ctx()); deq(d.lotIds, order);
  assert.throws(() => D.reorderLots(d, order.slice(1), ctx()), e => e.code === 'INVALID_ORDER');
  d = D.applyTemplate(d, 'SHORTLIST', ctx()); assert.ok(d.contentBlocks.some(b => b.type === 'LOT_HIGHLIGHT')); assert.ok(!d.contentBlocks.some(b => b.type === 'COMPARISON'), 'no comparison source → not auto-added');
  assert.equal(d.storyline.steps.length, d.contentBlocks.length); assert.match(d.templateRef, /^SHORTLIST@/);
  assert.equal(D.archive(d, ctx()).lifecycleStatus, 'ARCHIVED');
  assert.throws(() => D.revise(D.archive(d, ctx()), { title: 'x' }, d.recordRevision + 1, ctx()), e => e.code === 'ARCHIVED');
  assert.throws(() => make({}, ctx({ can: () => false })), e => e.code === 'FORBIDDEN');
  assert.throws(() => make({ purpose: 'PUBLISHED' }), e => e.code === 'INVALID_DEFINITION');
});
test('block registry: every block type has a schema; unknown config keys, HTML and wrong types are rejected', () => {
  deq(Object.keys(D.BLOCK_REGISTRY).sort(), Object.keys(P.BlockType).sort());
  deq(D.validateBlockConfig({ type: 'CUSTOM', config: { text: 'ok' } }), []);
  assert.equal(D.validateBlockConfig({ type: 'CUSTOM', config: { text: '<script>x</script>' } })[0].code, 'INVALID_CONFIG_VALUE');
  assert.equal(D.validateBlockConfig({ type: 'MAP', config: { anything: 1 } })[0].code, 'UNKNOWN_CONFIG_KEY');
  assert.equal(D.validateBlockConfig({ type: 'LOT_HIGHLIGHT', config: {} })[0].code, 'MISSING_CONFIG');
  assert.equal(D.validateBlockConfig({ type: 'SLIDE_HTML', config: {} })[0].code, 'UNSUPPORTED_BLOCK');
});

// ---------------------------------------------------------------- preflight
test('preflight: all good PASS_WITH_WARNINGS (availability unconfirmed for every lot), unsupported block, internal block FAIL', () => {
  const d = withTpl('SHORTLIST');
  const r = D.preflight(d, src(), ctx()); assert.equal(r.status, 'PASS_WITH_WARNINGS'); assert.ok(r.warnings.every(w => w.code === 'AVAILABILITY_UNCONFIRMED'));
  assert.equal(r.resolvedVersionRefs.priceTableVersionId, 'lancamento-2026-10@2026-10-06'); assert.equal(r.resolvedVersionRefs.clientSafePolicyVersion, P.POLICY_VERSION);
  const u = D.revise(d, { contentBlocks: [...d.contentBlocks, { id: 'bx', type: 'SLIDE_HTML', enabled: true, config: {}, order: 99 }] }, d.recordRevision, ctx());
  assert.equal(D.preflight(u, src(), ctx()).blockingIssues[0].code, 'UNSUPPORTED_BLOCK');
});
test('PresentationPreflightBlocksPIILeak: internal notes block, contact data in free text, unsafe claim → FAIL, non-overridable, no snapshot', () => {
  const d = withTpl('GENERAL_PRESENTATION');
  const notes = D.revise(d, { contentBlocks: [...d.contentBlocks, { id: 'bn', type: 'CUSTOMER_INTERNAL_NOTES', enabled: true, config: {}, order: 9 }] }, d.recordRevision, ctx());
  const r = D.preflight(notes, src(), ctx({ overrides: [{ issueCode: 'PII_OR_INTERNAL_DATA_EXPOSURE', reason: 'quero mostrar' }] }));
  assert.equal(r.status, 'FAIL'); assert.equal(r.blockingIssues[0].code, 'PII_OR_INTERNAL_DATA_EXPOSURE'); assert.equal(r.blockingIssues[0].overridable, false);
  const repoP = D.createRepository(); assert.equal(D.createSnapshot(repoP, notes, src(), ctx(), { expectedDefinitionRevision: notes.recordRevision }).code, 'PREFLIGHT_FAILED');
  const txt = D.revise(d, { contentBlocks: [...d.contentBlocks, { id: 'bc', type: 'CUSTOM', enabled: true, config: { text: 'Ligue para (27) 99999-1234' }, order: 9 }] }, d.recordRevision, ctx());
  assert.equal(D.preflight(txt, src(), ctx()).blockingIssues[0].code, 'PII_OR_INTERNAL_DATA_EXPOSURE');
  const claim = D.revise(d, { contentBlocks: [...d.contentBlocks, { id: 'bc', type: 'CUSTOM', enabled: true, config: { text: 'Valorização garantida em 2 anos: rentabilidade garantida!' }, order: 9 }] }, d.recordRevision, ctx());
  assert.ok(D.preflight(claim, src(), ctx()).blockingIssues.some(i => i.code === 'UNSAFE_CLAIM'));
  assert.ok(D.auditLog().some(a => a.type === 'PresentationPreflightBlocked'));
});
test('preflight: "disponível agora" claim with unconfirmed availability blocks; lot from another dev / missing lot blocks; cross-tenant blocks', () => {
  const d = make({ contentBlocks: [{ id: 'b1', type: 'AVAILABILITY_STATUS', enabled: true, config: { claim: 'AVAILABLE_NOW' }, order: 1 }], storyline: { steps: [{ id: 'st1', blockId: 'b1', order: 1 }], startStepId: 'st1' } });
  assert.equal(D.preflight(d, src(), ctx()).blockingIssues[0].code, 'AVAILABILITY_CLAIM_UNSUPPORTED');
  const m = make({ lotIds: ['VJ-QZ-L9999'] }); assert.equal(D.preflight(m, src(), ctx()).blockingIssues[0].code, 'LOT_NOT_FOUND');
  const other = src({}, { [ids('A1')[0]]: l => { l.identity.developmentId = 'outro'; return l; } });
  assert.ok(D.preflight(make(), other, ctx()).blockingIssues.some(i => i.code === 'WRONG_DEVELOPMENT'));
  assert.equal(D.preflight(make(), src(), ctx({ organizationId: 'other-org' })).blockingIssues[0].code, 'CROSS_TENANT');
});
test('preflight: customer access, missing recommendation ref / profile version, mixed comparison version, invalid simulation', () => {
  const d = make({ customerId: 'C55' });
  assert.equal(D.preflight(d, src(), ctx()).blockingIssues[0].code, 'CUSTOMER_ACCESS_DENIED');
  assert.equal(D.preflight(d, src({ customer: MARIA, canAccessCustomer: () => false }), ctx()).blockingIssues[0].code, 'CUSTOMER_ACCESS_DENIED');
  assert.notEqual(D.preflight(d, src({ customer: MARIA }), ctx()).status, 'FAIL');
  const rd = make({ recommendationResultId: 'R11', contentBlocks: [{ id: 'b1', type: 'RECOMMENDATION_SUMMARY', enabled: true, criticality: 'IMPORTANT', config: {}, order: 1 }], storyline: { steps: [{ id: 'st1', blockId: 'b1', order: 1 }] } });
  assert.equal(D.preflight(rd, src(), ctx()).blockingIssues[0].code, 'RECOMMENDATION_REF_MISSING');
  assert.equal(D.preflight(rd, src({ recommendation: { id: 'R11', result: { recommendations: [] } } }), ctx()).blockingIssues[0].code, 'RECOMMENDATION_PROFILE_VERSION_MISSING');
  const cd = make({ contentBlocks: [{ id: 'b1', type: 'COMPARISON', enabled: true, criticality: 'CRITICAL', config: {}, order: 1 }], storyline: { steps: [{ id: 'st1', blockId: 'b1', order: 1 }] } });
  const cmp = comparisonSource(['A1', 'A2']);
  assert.equal(D.preflight(cd, src({ comparison: { ...cmp, snapshot: { ...cmp.snapshot, id: 'other' } } }), ctx()).blockingIssues[0].code, 'COMPARISON_VERSION_MISMATCH');
  const fd = make({ purpose: 'FINANCIAL_REVIEW', contentBlocks: [{ id: 'b1', type: 'FINANCIAL_SIMULATION', enabled: true, criticality: 'CRITICAL', config: { lotId: ids('A1')[0], simulationRef: 'S1' }, order: 1 }], storyline: { steps: [{ id: 'st1', blockId: 'b1', order: 1 }] } });
  assert.equal(D.preflight(fd, src(), ctx()).blockingIssues[0].code, 'SIMULATION_REF_INVALID');
  assert.equal(D.preflight(fd, src({ simulations: { S1: { result: sim('A1'), lotId: ids('A1')[0] } } }), ctx()).blockingIssues[0].code, 'SIMULATION_VERSION_MISSING');
});
test('override policy: stale price on a critical financial block can be overridden only with permission + reason (audited); PII never', () => {
  const stale = { [ids('A1')[0]]: l => { l.metadata.freshness = { commercial: 'STALE' }; return l; } };
  const fd = make({ purpose: 'FINANCIAL_REVIEW', contentBlocks: [{ id: 'b1', type: 'FINANCIAL_SIMULATION', enabled: true, criticality: 'CRITICAL', config: { lotId: ids('A1')[0], simulationRef: 'S1' }, order: 1 }], storyline: { steps: [{ id: 'st1', blockId: 'b1', order: 1 }] } });
  const s = src({ simulations: { S1: { result: sim('A1'), lotId: ids('A1')[0], version: 'fin-1', status: 'EXACT' } } }, stale);
  assert.equal(D.preflight(fd, s, ctx()).blockingIssues[0].code, 'PRICE_STALE_FINANCIAL');
  assert.equal(D.preflight(fd, s, ctx({ can: () => true, overrides: [{ issueCode: 'PRICE_STALE_FINANCIAL' }] })).status, 'FAIL', 'reason required');
  assert.equal(D.preflight(fd, s, { organizationId: ORG, now: NOW, overrides: [{ issueCode: 'PRICE_STALE_FINANCIAL', reason: 'confirmado com a construtora' }] }).status, 'FAIL', 'no local grant for override');
  const ok = D.preflight(fd, s, ctx({ overrides: [{ issueCode: 'PRICE_STALE_FINANCIAL', reason: 'confirmado com a construtora' }] }));
  assert.notEqual(ok.status, 'FAIL'); assert.ok(ok.warnings.find(w => w.code === 'PRICE_STALE_FINANCIAL').overridden);
  assert.ok(D.auditLog().some(a => a.type === 'PresentationPreflightOverridden' && a.issueCode === 'PRICE_STALE_FINANCIAL'));
});

// ---------------------------------------------------------------- snapshot
test('PresentationSnapshotImmutable: frozen, create-only, deterministic checksum, exact version refs, revision-bound', () => {
  const d = withTpl('SHORTLIST'); const { r, res } = snapOf(d);
  assert.ok(res.ok); const s = res.snapshot; assert.ok(Object.isFrozen(s) && Object.isFrozen(s.audience.blocks[0].payload));
  assert.throws(() => { 'use strict'; s.audience.title = 'x'; }); assert.throws(() => r.saveSnapshot(ctx(), s), e => e.code === 'SNAPSHOT_IMMUTABLE');
  assert.equal(D.verify(s), true); assert.equal(s.definitionRevision, d.recordRevision); assert.equal(s.status, 'READY_WITH_WARNINGS');
  const again = D.createSnapshot(D.createRepository(), d, src(), ctx({ now: '2026-10-09T11:00:00.000Z' }), { expectedDefinitionRevision: d.recordRevision }).snapshot;
  assert.equal(again.checksum, s.checksum, 'same content + refs → same checksum'); assert.notEqual(again.id, s.id);
  assert.equal(D.createSnapshot(r, d, src(), ctx(), { expectedDefinitionRevision: d.recordRevision - 1 }).code, 'DEFINITION_REVISION_CONFLICT');
  assert.equal(D.createSnapshot(r, d, src(), ctx(), { expectedDefinitionRevision: d.recordRevision, clientSafePolicyVersion: 'old' }).code, 'POLICY_VERSION_MISMATCH');
  const d2 = D.revise(d, { title: 'Outro' }, d.recordRevision, ctx()); assert.equal(s.audience.title, 'Opções para você', 'definition edit does not touch the snapshot');
  assert.equal(r.getSnapshot(ctx({ organizationId: 'other' }), s.id), null, 'cross-tenant → null'); void d2;
});
test('snapshot audience: no PII, no presenter notes/hints, no internal ids/sources, data-state semantics preserved', () => {
  const d0 = make({ customerId: 'C55' }); let d = D.applyTemplate(d0, 'INITIAL_OPTIONS', ctx());
  d = D.revise(d, { storyline: { ...d.storyline, steps: d.storyline.steps.map(s => ({ ...s, presenterHint: 'falar do desconto se ela hesitar' })) } }, d.recordRevision, ctx());
  const { res } = snapOf(d, src({ customer: MARIA }));
  assert.ok(res.ok, res.code); const a = json(res.snapshot.audience);
  for (const bad of ['maria@example.com', '99999-1234', 'Souza', 'C55', 'indecisa', 'desconto se', 'presenterHint', 'VJ-QA-L', 'analysis-v1', 'sourceId', 'pv3', '300.000']) assert.ok(!a.includes(bad), bad);
  assert.equal(res.snapshot.audience.customerLabel, 'Maria'); assert.equal(res.snapshot.customerRef.customerId, 'C55', 'internal ref kept outside the audience');
  assert.ok(!('email' in res.snapshot.customerRef) && !('phone' in res.snapshot.customerRef));
  assert.match(a, /Disponibilidade sujeita a confirmação/); assert.doesNotMatch(a, /"Disponível"/);
});
test('PresentationLiveRefresh: LIVE re-resolves current refs on each refresh, never mutates a snapshot, discards stale responses', () => {
  const d = withTpl('SHORTLIST'); const { res } = snapOf(d); const before = json(res.snapshot);
  const l1 = D.liveProjection(d, src(), ctx()); assert.equal(l1.dataMode, 'LIVE'); assert.ok(l1.versionRefs.availabilityRevision);
  const fresh = src({}, { [ids('A1')[0]]: l => { l.availability = { ...l.availability, status: 'AVAILABLE', freshness: 'FRESH', revision: 5 }; return l; } });
  const l2 = D.liveProjection(d, fresh, ctx());
  assert.notEqual(l2.versionRefs.availabilityRevision, l1.versionRefs.availabilityRevision); assert.match(json(l2.audience), /"label":"Disponível"/);
  assert.equal(json(res.snapshot), before, 'snapshot untouched');
  const lv = D.createLiveView(), s1 = lv.begin(), s2 = lv.begin();
  assert.equal(lv.apply(s2, l2).applied, true); assert.equal(lv.apply(s1, l1).reason, 'STALE_RESPONSE'); assert.equal(lv.current(), l2);
});
test('freshness evaluator: old snapshot warns "preparada há X dias", version change warns, snapshot not mutated; safety ≠ freshness', () => {
  const { res } = snapOf(withTpl('SHORTLIST')); const s = res.snapshot;
  const f = D.freshness(s, { now: '2026-10-14T10:00:00.000Z' }); assert.equal(f.ageDays, 5); assert.match(f.warnings[0], /preparada há 5 dias/);
  assert.equal(D.freshness(s, { now: NOW }).commercialDataMayBeOutdated, false);
  assert.deepEqual(clone(D.freshness(s, { now: NOW, currentVersionRefs: { ...s.versionRefs, priceTableVersionId: 'nova@2027' } }).changedRefs), ['priceTableVersionId']);
  assert.equal(D.safety.get(ORG, s.id).status, 'SAFE');
});

// ---------------------------------------------------------------- golden: sources
// all 498 lots are UNKNOWN, so the real engine returns NO_ELIGIBLE_LOTS: the presentation consumes a RecommendationResult with the engine's shape
function recResult() {
  const real = App.recommendation.recommend({ developmentId: DEV, profile: App.fit.buildProfile({ preferences: { privacy: 3, leisure: 2 } }, App.fit.cfgOf(DEV)), constraints: [], lots, policy: App.recommendation.policyOf(DEV), fitCfg: App.fit.cfgOf(DEV), availabilityPolicy: {}, dataVersions: {} });
  assert.equal(real.recommendations.length, 0, 'UNKNOWN is never recommended as AVAILABLE');
  return { status: 'SUCCESS', recommendations: ids('B79', 'A2', 'A1').map((lotId, i) => ({ lotId, rank: i + 1, tier: i ? 'STRONG_MATCH' : 'PRIMARY', fitScore: 90 - i * 5, coverage: 1, fitConfidence: 'HIGH',
    keyReasonCodes: [i === 0 ? 'TOP_FIT' : null, 'MEETS_ALL_REQUIRED_CONSTRAINTS', 'INTERNAL_DEBUG_CODE'].filter(Boolean), rankingTrace: { tieBreak: 'lotId' } })) };
}
function comparisonSource(codes) {
  const CD = App.compare.domain, EV = App.compare.evaluation, R = ref => repo.resolve(ref);
  const s = CD.createSession(DEV, { candidateIds: codes, resolve: R }), snap = CD.buildSnapshot(s, { resolve: R, now: NOW });
  return { sessionId: s.id, snapshot: snap, evaluation: EV.evaluate(snap, { audience: 'presentation' }) };
}
function sim(code) { const l = byCode(code), pt = srcBase.priceTable; return App.services.finance.simulate({ price: l.commercial.price, downPaymentPct: 12, plans: pt.plans.filter(p => l.commercial.availablePlans.includes(p.id)) }); }

test('PresentationFromRecommendation: exact result referenced, rank preserved, client reasons only, no trace/tie-break/codes', () => {
  const rr = recResult(); assert.ok(rr.recommendations.length >= 3);
  const d0 = D.fromRecommendation(ctx(), { recommendation: { id: 'R11', result: rr }, developmentId: DEV, title: 'Recomendações', max: 3 });
  deq(d0.lotIds, rr.recommendations.slice(0, 3).map(r => r.lotId)); assert.equal(d0.recommendationResultId, 'R11');
  const d = D.applyTemplate(d0, 'INITIAL_OPTIONS', ctx());
  const { res } = snapOf(d, src({ recommendation: { id: 'R11', result: rr, profileVersionId: 'pv3' } }));
  assert.ok(res.ok, res.code); assert.equal(res.snapshot.versionRefs.recommendationResultId, 'R11');
  const blk = res.snapshot.audience.blocks.find(b => b.type === 'RECOMMENDATION_SUMMARY').payload;
  deq(blk.items.map(i => i.card.lotRef), rr.recommendations.slice(0, 3).map(r => repo.getLotById(r.lotId).identity.code), 'rank order');
  assert.equal(blk.items[0].positionLabel, 'Opção 1');
  const a = json(blk); for (const bad of ['TOP_FIT', 'MEETS_ALL', 'tieBreak', 'rankingTrace', 'keyReasonCodes']) assert.ok(!a.includes(bad), bad);
  assert.ok(blk.items[0].reasons.length > 0);
});
test('PresentationFromFavoriteCollection: exact membership captured; later collection change does not alter the snapshot', () => {
  const coll = { id: 'F1', lotIds: ids('B79', 'A1', 'A1') };
  const d = D.applyTemplate(D.fromFavorites(ctx(), { collection: coll, developmentId: DEV, title: 'Favoritos' }), 'SHORTLIST', ctx());
  deq(d.lotIds, ids('B79', 'A1')); const { res } = snapOf(d); coll.lotIds.push(ids('A2')[0]);
  deq(res.snapshot.lotRefs.map(l => l.lotRef), ['B79', 'A1']);
});
test('PresentationFromComparison + ComparisonInsufficientDataPresentation: no new winner logic, insufficient data preserved, safe highlights only', () => {
  const cmp = comparisonSource(['A1', 'A2', 'B79']);
  const d = D.applyTemplate(D.fromComparison(ctx(), { session: { id: cmp.sessionId, candidateIds: cmp.evaluation.candidateIds }, developmentId: DEV, title: 'Comparação' }), 'COMPARISON', ctx());
  const { res } = snapOf(d, src({ comparison: cmp })); assert.ok(res.ok, res.code);
  const c = res.snapshot.audience.blocks.find(b => b.type === 'COMPARISON').payload, ev = cmp.evaluation;
  const safe = App.compare.evaluation.highlights(ev, { audience: 'presentation' }).reduce((n, h) => n + h.metricIds.length, 0);
  assert.equal(c.safeHighlights.length, safe, 'highlights come from topic 25, not recalculated');
  for (const sct of c.comparisonSections) { const r = ev.metricResults[ev.metricOrder[c.comparisonSections.indexOf(sct)]];
    if (r.evaluationStatus === 'INSUFFICIENT_DATA') { assert.equal(sct.outcome, 'NO_DATA'); assert.equal(sct.text, 'Não há dados suficientes para comparar este critério.'); }
    if (r.evaluationStatus === 'CONTEXT_REQUIRED') assert.notEqual(sct.outcome, 'HIGHLIGHT'); }
  assert.doesNotMatch(json(c), /Vencedor|vencedor|WINNER/);
  assert.equal(res.snapshot.versionRefs.comparisonSnapshotId, cmp.snapshot.id);
});
test('FinancialPresentation + ProjectedFinancialScenarioPresentation: exact simulation, projected labelled, unknown IGP-M not invented, table price only', () => {
  const s1 = sim('A1');
  const f = PJ.financial({ result: s1, status: 'PROJECTED', version: 'fin-1' });
  assert.equal(f.statusLabel, 'Projeção'); assert.equal(f.statusText, 'Fluxo projetado conforme premissas informadas.');
  assert.ok(f.caveats.some(c => /IGP-M/.test(c))); assert.equal(f.basePrice.text, App.fmt.formatBRL(byCode('A1').commercial.price));
  assert.equal(f.plans[0].installments, `${s1.plans[0].main.count}x de ${App.fmt.formatBRL(s1.plans[0].main.value, true)}`, 'same numbers as the simulation service');
  assert.doesNotMatch(json(f), /total|garantid/i, 'no discounted totals / no guarantee');
  const ex = PJ.financial({ result: s1, status: 'EXACT', version: 'fin-1' }); assert.notEqual(ex.statusLabel, 'Projeção');
  const d = make({ purpose: 'FINANCIAL_REVIEW', lotIds: ids('A1') }); const dd = D.applyTemplate(d, 'FINANCIAL_REVIEW', ctx(), { simulationRefs: { [ids('A1')[0]]: 'S1' } });
  const { res } = snapOf(dd, src({ simulations: { S1: { result: s1, lotId: ids('A1')[0], version: 'fin-1', status: 'PROJECTED' } } }));
  assert.ok(res.ok, res.code); deq(res.snapshot.versionRefs.financialSimulationResultIds, ['S1']);
});
test('InvestmentPresentation: table price variation wording, never ROI/valorização', () => {
  const d = D.applyTemplate(make({ purpose: 'INVESTMENT_REVIEW' }), 'INVESTMENT_REVIEW', ctx());
  const { res } = snapOf(d); assert.ok(res.ok, res.code);
  const inv = res.snapshot.audience.blocks.find(b => b.type === 'INVESTMENT_CONTEXT').payload;
  assert.match(inv.caveat, /não representa valorização nem rentabilidade/); assert.ok(inv.items.every(i => i.pricePerM2Text === App.fmt.formatPricePerM2(1196)));
});

// ---------------------------------------------------------------- session / runtime
test('InitialOptionsGuidedPresentation: guided navigation, free jump allowed (guided ≠ rigid), lot jump, return to map, session never alters snapshot', () => {
  const d = withTpl('SHORTLIST'); const { r, res } = snapOf(d); const before = json(res.snapshot);
  const st = RT.start(r, ctx(), res.snapshot.id, { mode: 'GUIDED', deviceProfile: 'TABLET' }); assert.ok(st.ok);
  let s = RT.next(st.session.id, ctx()); assert.equal(s.currentStepId, 'st2'); s = RT.previous(s.id, ctx()); assert.equal(s.currentStepId, 'st1');
  s = RT.goTo(s.id, 'st4', ctx()); assert.equal(s.currentStepId, 'st4');
  s = RT.jumpToLot(s.id, 'A2', ctx()); assert.ok(s.viewedLotRefs.includes('A2'));
  assert.throws(() => RT.jumpToLot(s.id, 'Z9', ctx()), e => e.code === 'LOT_NOT_IN_PRESENTATION');
  s = RT.returnToMap(s.id); assert.equal(s.runtimeFlags.mapOpen, true);
  const av = RT.audienceView(s.id); assert.doesNotMatch(json(av), /presenterHint/); assert.doesNotMatch(json(av), /notes|controls|warnings/);
  const pc = RT.presenterControlState(s.id, ctx({ can: k => k !== 'presentation.internalNotes.read' })); assert.equal(pc.presenterNotesVisible, false); assert.ok(!pc.controls.includes('ADD_PRESENTER_NOTE'));
  assert.equal(json(res.snapshot), before);
  assert.equal(RT.layoutFor('TABLET').navigation, 'bottom'); deq(RT.restorePayload(s.id), { snapshotId: res.snapshot.id, currentStepId: s.currentStepId, mode: 'GUIDED' });
  const html = V.audience(av); assert.match(html, /<main/); assert.match(html, /aria-live="polite"/); assert.doesNotMatch(html, /VJ-QA-L/);
});
test('PresentationFeedbackIntent + PresentationJourneyCompletionEvent: intents recorded, profile untouched, completion explicit, no auto stage move', () => {
  const d = D.applyTemplate(make({ customerId: 'C55', journeyId: 'J90' }), 'SHORTLIST', ctx());
  const s0 = src({ customer: MARIA, journey: { id: 'J90', organizationId: ORG, customerId: 'C55', stage: 'NEGOTIATING' } });
  const { r, res } = snapOf(d, s0); assert.ok(res.ok, res.code); assert.doesNotMatch(json(res.snapshot.audience), /NEGOTIATING/);
  const profBefore = json(MARIA.profile), sess = RT.start(r, ctx(), res.snapshot.id).session;
  const f = RT.recordFeedback(sess.id, { type: 'LIKED', lotRef: 'A1', recordedBy: 'CUSTOMER' }, ctx());
  assert.ok(f.ok); assert.equal(f.intent.type, 'LIKED'); assert.equal(f.intent.lotId, ids('A1')[0]); assert.equal(f.profileChanged, false); assert.equal(f.favoriteChanged, false);
  assert.equal(f.journeyEvent.type, 'PRESENTATION_FEEDBACK_RECORDED');
  const dis = RT.recordFeedback(sess.id, { type: 'DISLIKED', lotRef: 'A2' }, ctx()); assert.equal(dis.nextAction, null, 'DISLIKED never becomes a constraint');
  assert.equal(RT.recordFeedback(sess.id, { type: 'VISIT_INTEREST', lotRef: 'A3' }, ctx()).nextAction.reservation, false);
  assert.equal(json(MARIA.profile), profBefore);
  // reaching the last step is not completion
  let x = sess; for (let i = 0; i < 10; i++) x = RT.next(x.id, ctx());
  const notDone = RT.outcome(x.id); assert.equal(notDone.completed, false);
  RT.markCompleted(x.id, ctx()); const e = RT.end(x.id, ctx());
  assert.equal(e.session.state, 'ENDED'); deq(e.journeyEvents.map(j => j.type), ['PRESENTATION_COMPLETED']); assert.equal(e.journeyEvents[0].journeyId, 'J90');
  assert.equal(e.stageSuggestions[0].autoApply, false); assert.equal(e.outcome.feedbackCount, 3); assert.ok(e.outcome.interestedLotIds.includes(ids('A1')[0]));
  assert.throws(() => RT.next(x.id, ctx()), e2 => e2.code === 'SESSION_ENDED');
});
test('PresentationSnapshotRevokedBySafetyPolicy + permission loss: revoked/review snapshots cannot start; immutable content does not override authorization', () => {
  const { r, res } = snapOf(withTpl('SHORTLIST')); const id = res.snapshot.id;
  assert.equal(RT.start(r, ctx({ can: () => false }), id).code, 'FORBIDDEN');
  D.safety.mark(ORG, id, 'REVIEW_REQUIRED', ['DATA_CORRECTION'], ctx()); assert.equal(RT.start(r, ctx(), id).code, 'SNAPSHOT_REVIEW_REQUIRED');
  D.safety.mark(ORG, id, 'REVOKED', ['SECURITY_POLICY_CHANGE'], ctx()); assert.equal(RT.start(r, ctx(), id).code, 'SNAPSHOT_REVOKED');
  assert.equal(D.verify(r.getSnapshot(ctx(), id)), true, 'content not mutated by revocation');
  assert.equal(RT.exportRequest(res.snapshot, { format: 'PDF' }, ctx()).code, 'SNAPSHOT_NOT_SAFE');
});
test('policy evolution: a stricter policy that flags old content marks REVIEW_REQUIRED without mutating the snapshot', () => {
  const { res } = snapOf(withTpl('SHORTLIST')); const s = res.snapshot;
  assert.equal(D.safety.reevaluate(s, {}).status, 'SAFE');
  const r2 = D.safety.reevaluate(s, { policy: { ...P.current(), version: 'client-safe-41.2.0', deniedBlockTypes: ['LOT_HIGHLIGHT'] } });
  assert.equal(r2.status, 'REVIEW_REQUIRED'); assert.equal(D.verify(s), true);
});
test('PresentationTenantIsolation: other tenant cannot read definitions/snapshots/sessions; ids reveal nothing', () => {
  const r = D.createRepository(), d = withTpl('SHORTLIST'); r.saveDefinition(ctx(), d, 0);
  assert.equal(r.getDefinition(ctx({ organizationId: 'org2' }), d.id), null);
  assert.throws(() => r.saveDefinition(ctx({ organizationId: 'org2' }), d, 1), e => e.code === 'CROSS_TENANT');
  const { res } = snapOf(d, src(), r); assert.equal(RT.start(r, ctx({ organizationId: 'org2' }), res.snapshot.id).code, 'NOT_FOUND');
  assert.equal(r.listByCustomer(ctx({ organizationId: 'org2' }), 'C55').length, 0);
});
test('PresentationOfflineSnapshot: offline only with explicit cache policy, never claims current availability; LIVE offline fallback is explicit; logout/tenant switch clears private state', () => {
  const { r, res } = snapOf(withTpl('SHORTLIST')); const s = res.snapshot;
  assert.equal(RT.offlineView(s, { online: false, cached: true }).allowed, false, 'default policy: no customer snapshot cache');
  const v = RT.offlineView(s, { online: false, cached: true, policy: { allowSnapshotCache: true }, now: NOW });
  assert.equal(v.allowed, true); assert.equal(v.currentAvailabilityClaimed, false); assert.match(v.banner, /Dados da apresentação preparados em/);
  assert.equal(RT.liveFallback({ online: false }).mode, 'BLOCKED');
  assert.equal(RT.liveFallback({ online: false, policy: 'USE_LAST_SAFE_SNAPSHOT', lastSafeSnapshot: s }).snapshotId, s.id);
  assert.match(RT.liveFallback({ online: false, policy: 'ALLOW_PARTIAL_WITH_WARNING' }).notice, /Sem conexão/);
  const sess = RT.start(r, ctx(), s.id).session; RT.cache.set({ organizationId: ORG, snapshotId: s.id, clientSafePolicyVersion: s.clientSafePolicyVersion }, { x: 1 });
  RT.bindAuth(); App.authz.reset('logout');
  assert.equal(RT.getSession(sess.id), null); assert.equal(RT.cache.size(), 0);
});
test('theme: versioned UI tokens only (no business logic, no script); overlay coordinator keeps one dominant overlay; export only from snapshot', () => {
  deq(RT.validateTheme(RT.DEFAULT_THEME), []);
  const bad = RT.validateTheme({ ...RT.DEFAULT_THEME, layoutTokens: { priceColor: 'red', bg: 'url(javascript:alert(1))' } });
  assert.ok(bad.includes('BUSINESS_KEY:priceColor') && bad.some(x => x.startsWith('UNSAFE_TOKEN')));
  const oc = RT.createOverlayCoordinator(); oc.open('COMPARISON'); assert.equal(oc.open('FINANCIAL').replaced, 'COMPARISON'); assert.equal(oc.current(), 'FINANCIAL');
  assert.equal(RT.exportRequest(withTpl('SHORTLIST'), { format: 'PDF' }).code, 'SNAPSHOT_REQUIRED');
  const { res } = snapOf(withTpl('SHORTLIST')); assert.equal(RT.exportRequest(res.snapshot, { format: 'PRINT' }, ctx()).request.audience, 'CLIENT');
  assert.equal(RT.internalRoute(res.snapshot.id), '/presentations/' + res.snapshot.id); assert.doesNotMatch(RT.internalRoute(res.snapshot.id), /C55|customer/);
});
test('events and audit carry opaque refs only; legacy inventory classifies the old presentation mode', () => {
  for (const e of [...D.events(), ...D.auditLog()]) assert.doesNotMatch(json(e), /Maria|@|99999|indecisa/);
  assert.ok(RT.LEGACY_INVENTORY.some(i => i.hidesControlsOnly && i.classification === 'UI_ONLY'));
  assert.ok(RT.LEGACY_INVENTORY.some(i => i.exposesInternalPayload));
});
test('regression: presentation does not change lots, scores, prices or availability', () => {
  const before = json(lots.map(l => [l.identity.id, l.intelligence.scores, l.commercial.price, l.availability.status]));
  snapOf(D.applyTemplate(make(), 'INITIAL_OPTIONS', ctx()));
  assert.equal(json(lots.map(l => [l.identity.id, l.intelligence.scores, l.commercial.price, l.availability.status])), before);
  assert.equal(lots.length, 498); assert.ok(lots.every(l => l.availability.status === 'UNKNOWN'));
});
