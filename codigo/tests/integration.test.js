'use strict';
// Topics 32–42 wired into the panel UI (app.js / panels.js / overlays.js): markup contracts, action contracts and the
// guided-presentation wiring with the same calls app.js makes. Nothing here may change a lot value, score, class or price.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');
const UI = ['presentation/dom.js', 'presentation/compareView.js', 'presentation/pricingView.js', 'presentation/securityView.js', 'presentation/dataTrustView.js', 'presentation/favoritesView.js',
  'customer/customerView.js', 'presentationmode/presentationView.js', 'share/sharedShellView.js', 'presentation/panels.js', 'presentation/overlays.js'];
let App, repo, dev, devCfg, lot, lots, before;
const actsIn = html => [...html.matchAll(/data-act="([a-zA-Z][a-zA-Z-]*)"/g)].map(m => m[1]);

test.before(async () => {
  App = load(); for (const f of UI) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  repo = App.repos.LotRepository('viva-juara'); await repo.load(); lots = repo.lotsSync(); lot = repo.getLotByCode('B79');
  dev = App.repos.DevelopmentRepository.getDevelopmentConfig('viva-juara'); devCfg = App.config.DEVELOPMENTS.find(d => d.id === 'viva-juara');
  before = lots.map(l => App.domain.serializeLot(l));
});
const x0 = (mode, extra = {}) => ({ repo, dev, cfg: dev.presentation, mode, priceTable: repo.commercialRepo.getPriceTable(), priceHistory: null, ...extra });
const st0 = (o = {}) => ({ ...App.store.INITIAL, customers: [], currentCustomerId: null, comparisonLotIds: [], favorites: [], preferences: {}, constraints: {}, openSections: { summary: true, construction: true, geometry: true }, detailSection: 'summary', sheet: 'mid', ...o });

test('clients overlay: tabs (topics 38–40) keep the summary content; favorites and journey panels come from app.js; every action has a contract', () => {
  const st = st0({ customers: [{ id: 'c1', name: 'Maria Souza', lots: [], profile: {} }], currentCustomerId: 'c1' });
  const plain = App.overlays.clients(st, x0('broker'));
  const sum = App.overlays.clients(st, x0('broker'), { tab: 'summary', tabsHtml: App.customerView.tabs('summary') });
  assert.ok(sum.includes('role="tablist"') && sum.includes(plain.slice(plain.indexOf('<p class="small">Os clientes'), plain.indexOf('</form>'))), 'summary tab = previous overlay');
  const fav = App.overlays.clients(st, x0('broker'), { tab: 'favorites', tabsHtml: App.customerView.tabs('favorites'), favHtml: '<section class="fav-panel">X</section>' });
  assert.match(fav, /fav-panel/); assert.match(fav, /aria-selected="true">Favoritos/);
  const jny = App.overlays.clients(st, x0('broker'), { tab: 'journey', tabsHtml: '', journeyHtml: App.customerView.journeyPanel({ available: false }) });
  assert.match(jny, /não fica disponível/);
  for (const t of ['profile', 'comparisons', 'recommendations']) assert.match(App.overlays.clients(st, x0('broker'), { tab: t, tabsHtml: '' }), /custpanel/);
  const all = [sum, fav, jny, ...['profile', 'comparisons', 'recommendations'].map(t => App.overlays.clients(st, x0('broker'), { tab: t, tabsHtml: App.customerView.tabs(t) }))].join('');
  for (const a of new Set(actsIn(all))) assert.notEqual(App.authz.action(a, { v: 'compare' }).reason, 'UNMAPPED_ACTION', a);
  assert.doesNotMatch(all, /@|\(\d{2}\)\s?\d/, 'no contact data');
});

test('customer header label: "Atendendo: <nome>" on desktop, first name on phones, never a phone/e-mail', () => {
  const C = App.customer.context;
  assert.equal(C.headerLabel({ displayName: 'Maria Souza' }, 'desktop'), 'Atendendo: Maria Souza');
  assert.equal(C.headerLabel({ displayName: 'Maria Souza' }, 'mobile'), 'Maria');
  assert.equal(C.headerLabel({ displayName: '27 99999-1234' }, 'desktop'), 'Atendendo: Cliente');
  const st = { currentCustomerId: 'c1', comparisonLotIds: ['x'], activeFilters: { block: 'B' }, currentLotId: 'L', favorites: ['L'] };
  const p = C.switchPatch(st, 'c2', { profileUi: C.legacyProfileUi({ profile: { preferences: { quiet: 3 } } }) });
  for (const k of ['activeFilters', 'currentLotId', 'favorites', 'comparisonLotIds', 'mapViewport']) assert.ok(!(k in p), k + ' untouched by a customer switch');
  assert.ok(C.guard(st, 'c2', {}).warnings.includes('COMPARISON_BELONGS_TO_PREVIOUS_CUSTOMER'));
});

test('lot details: data-state reason only for missing values (known wording unchanged); provenance badges only where app.js supplies them (technical)', () => {
  const d = App.vm.detailsVM(lot, { cfg: dev.presentation, mode: 'broker', dev, priceTable: repo.commercialRepo.getPriceTable(), openSections: st0().openSections });
  const trustStub = { badgeHtml: (l, k, mode) => mode === 'technical' ? ` <span class="dt-badge" data-act="prov-open" data-path="${k}">B</span>` : '', docsHtml: mode => `<div class="dtwrap">docs:${mode}</div>` };
  const broker = App.panels.details(d, st0(), x0('broker', { trust: trustStub })), tech = App.panels.details(d, st0(), x0('technical', { trust: trustStub }));
  assert.doesNotMatch(broker, /data-act="prov-open"/); assert.match(tech, /data-act="prov-open" data-path="geometry\.areaM2"/);
  assert.match(broker, /docs:broker/); assert.match(tech, /docs:technical/);
  const known = d.sections.flatMap(s => s.fields).filter(f => f.isAvailable);
  for (const f of known.slice(0, 20)) assert.ok(broker.includes(`<dd>${App.ui.esc(f.formattedValue)}<button`), 'known value wording unchanged: ' + f.key);
  const missing = d.sections.filter(s => ['summary', 'construction', 'geometry'].includes(s.id)).flatMap(s => s.fields).filter(f => !f.isAvailable);
  if (missing.length) assert.match(broker, /<small class="ndr">/);
  assert.ok(missing.length > 0); assert.doesNotMatch(App.panels.details(d, st0(), x0('broker')), /dtwrap|dt-badge/, 'without app.js trust wiring nothing extra is rendered');
});

test('technical explanation: analysis version line (topic 35) only when app.js passes it (technical mode)', () => {
  const ex = { status: 'COMPLETE', value: 70, methodologyVersion: '1.0.0', factors: [], classBand: null };
  const v = { analysisVersion: '2026-10-06', methodologyVersion: '1.0.0', inputVersion: 'm1', published: null, fingerprint: 'abc123' };
  assert.match(App.panels.techExplainPopover(ex, {}, lot, { scoreKey: 'housing', versioning: v }), /impressão digital <code>abc123<\/code>/);
  assert.match(App.panels.techExplainPopover(ex, {}, lot, { scoreKey: 'housing', versioning: v }), /sem versão publicada/);
  assert.doesNotMatch(App.panels.techExplainPopover(ex, {}, lot, { scoreKey: 'housing' }), /impressão digital/);
  const V = App.versioning, defs = V.definitions('viva-juara');
  const fp = V.fingerprint({ dev: devCfg, methodologyConfig: App.methodology.current('viva-juara'), inputDoc: null, dataVersions: repo.getDataVersions(), availabilityRevision: 0 });
  assert.equal(typeof fp.combined, 'string');
  assert.equal(V.readModel(V.repository({ organizationId: devCfg.tenantId }, { policies: defs.policies }), defs.definitions[0].id, { mode: 'technical' }).available, false, 'nothing published by the panel');
});

test('share modal (topic 42): managed links shown as "requer servidor", no new action, WhatsApp text and link unchanged', () => {
  const s = App.vm.shareVM([lot], { dev, customerName: 'Maria', mode: 'broker' });
  const h = App.overlays.share(s, { customerName: 'Maria' });
  assert.match(h, /class="shmgmt"/); assert.match(h, /exigem o servidor da organização/);
  assert.ok(h.includes(`href="${App.ui.esc(s.whatsapp)}"`)); assert.ok(h.includes(App.ui.esc(s.text)));
  assert.deepEqual([...new Set(actsIn(h))].sort(), ['closeModal', 'copyLink', 'copyText']);
  assert.doesNotMatch(h, /\/s\/[A-Za-z0-9]/, 'no public share token link is generated without the backend');
});

test('documents (topic 32): visitor sees no unpublished document; the technical read adapter lists the catalog without download', () => {
  const DS = App.documentServices, svc = DS.createService({}); DS.seedLegacy(svc, 'viva-juara');
  const T = { organizationId: App.authz.context().tenant.organizationId };
  assert.equal(DS.relatedDocuments(svc, T, { targetType: 'DEVELOPMENT', targetId: 'viva-juara' }, DS.accessFromAuthz('BROKER')).count, 0);
  const READ = ['document.read', 'provenance.read', 'provenance.technical.read', 'confidence.technical.read'];
  const tech = { ...DS.accessFromAuthz('TECHNICAL'), organizationId: T.organizationId, can: k => READ.includes(k) };
  const vm = DS.relatedDocuments(svc, T, { targetType: 'DEVELOPMENT', targetId: 'viva-juara' }, tech);
  assert.equal(vm.count, 10); assert.ok(vm.cards.every(c => !c.actions.some(a => a.id === 'doc-download' && a.enabled)), 'no download in the static panel');
  const html = App.dataTrustView.relatedDocuments(vm); for (const a of new Set(actsIn(html))) assert.notEqual(App.authz.action(a, {}).reason, 'UNMAPPED_ACTION', a);
});

test('provenance + confidence for one opened lot (topics 33/34): lazy, SHADOW, and the lots stay byte-identical', () => {
  const T = { organizationId: App.authz.context().tenant.organizationId }, acc = { organizationId: T.organizationId, mode: 'TECHNICAL', can: k => ['provenance.technical.read', 'confidence.technical.read', 'document.read'].includes(k) };
  const ps = App.provenanceServices.createService({}); App.provenanceMigration.load(ps, T, [lot], 'viva-juara', { validate: false });
  assert.equal(new Set(ps.repo.currentAll(T).map(r => r.entityId)).size, 1, 'only the opened lot');
  const p = ps.project(T, ps.repo.current(T, 'LOT', lot.identity.id, 'geometry.areaM2'), { mode: 'TECHNICAL', access: acc });
  assert.match(App.dataTrustView.badge(p, { attributePath: 'geometry.areaM2', drilldown: true }), /data-act="prov-open"/);
  assert.equal(ps.project(T, ps.repo.current(T, 'LOT', lot.identity.id, 'geometry.areaM2'), { mode: 'TECHNICAL', access: App.documentServices.accessFromAuthz('TECHNICAL') }).ok, false, 'visitor without the technical adapter is denied');
  const cs = App.dataConfidenceServices.createService({ provenance: ps, developmentId: 'viva-juara' }), rs = cs.evaluateEntity(T, 'LOT', lot, { asOf: '2026-10-09T12:00:00.000Z' });
  const c = cs.project(T, rs['geometry.areaM2'], { mode: 'TECHNICAL', access: acc }); assert.equal(c.shadow, true); assert.match(App.dataTrustView.confidencePanel(c), /não é probabilidade/);
  assert.equal(cs.project(T, rs['geometry.areaM2'], { mode: 'BROKER' }).visible, false);
  assert.deepEqual(lots.map(l => App.domain.serializeLot(l)), before);
});

test('guided presentation wiring (topic 41): comparison and favorites → preflight → snapshot → session, as app.js calls it; snapshot is client-safe', () => {
  const D = App.presentationMode.domain, RT = App.presentationMode.runtime, c = { organizationId: devCfg.tenantId, userId: 'dev_test01', developmentId: 'viva-juara', now: '2026-10-09T12:00:00.000Z' };
  const ids = ['B79', 'B12', 'A5'].map(k => repo.getLotByCode(k).identity.id), R = ref => repo.resolve(ref);
  const CD = App.compare.domain, EV = App.compare.evaluation, ses = CD.createSession('viva-juara', { candidateIds: ids, resolve: R }), snap = CD.buildSnapshot(ses, { resolve: R, now: c.now });
  const cmp = { sessionId: ses.id, snapshot: snap, evaluation: EV.evaluate(snap, { audience: 'presentation' }) };
  const runs = [
    { def: D.applyTemplate(D.fromComparison(c, { session: { id: ses.id, candidateIds: cmp.evaluation.candidateIds }, developmentId: 'viva-juara', title: 'Comparação de lotes' }), 'COMPARISON', c), src: D.sourcesFromRepo(repo, devCfg, { comparison: cmp }) },
    { def: D.applyTemplate(D.fromFavorites(c, { collection: { id: 'fav-personal', lotIds: ids }, developmentId: 'viva-juara', title: 'Lotes selecionados' }), 'SHORTLIST', c), src: D.sourcesFromRepo(repo, devCfg) }];
  for (const r of runs) {
    const pf = D.preflight(r.def, r.src, c); assert.notEqual(pf.status, 'FAIL', JSON.stringify(pf.blockingIssues));
    const pr = D.createRepository(), sn = D.createSnapshot(pr, r.def, r.src, c, { expectedDefinitionRevision: r.def.recordRevision }); assert.ok(sn.ok, sn.code);
    const s = RT.start(pr, c, sn.snapshot.id, { mode: 'GUIDED', deviceProfile: 'DESKTOP' }); assert.ok(s.ok);
    const html = App.presentationView.audience(RT.audienceView(s.session.id)) + App.presentationView.presenter(RT.presenterControlState(s.session.id, c));
    for (const a of new Set(actsIn(html))) assert.notEqual(App.authz.action(a, {}).reason, 'UNMAPPED_ACTION', a);
    assert.doesNotMatch(html, /VJ-Q[A-Z]-L\d{4}/, 'no internal lot id on the audience surface');
    assert.doesNotMatch(html, /Disponível agora|valoriza(ção|r) garantid/i);
    RT.next(s.session.id, c); RT.end(s.session.id, c);
  }
  for (const a of ['pmStart', 'pmGo', 'pmResume']) assert.equal(App.authz.action(a, {}).id, 'mode.presentation');
  assert.deepEqual(lots.map(l => App.domain.serializeLot(l)), before);
});

test('rule-engine alerts stay off (topic 36): the migration facade returns the legacy output', () => {
  assert.notEqual(!!(devCfg.features || {}).ruleEngineAlerts, true);
  const r = App.alertMigration.intelligenceAlertsFor(lot, { dev: devCfg }); assert.equal(r.source, 'LEGACY');
  assert.deepEqual(JSON.parse(JSON.stringify(r.alerts)), JSON.parse(JSON.stringify(App.alertMigration.legacy.intelligenceAlerts(lot))));
});

test('a real 0 is a value (topic 37): version/meta formatters in the panel no longer turn 0 into "—"', () => {
  const src = fs.readFileSync(path.join(SRC, 'presentation/compareView.js'), 'utf8') + fs.readFileSync(path.join(SRC, 'presentation/app.js'), 'utf8');
  assert.doesNotMatch(src, /\|\| '—'/);
  const fmtV = new Function(`return ${src.match(/const fmtV = (v => [^;]+);/)[1]}`)();
  assert.equal(fmtV(0), 0); assert.equal(fmtV(null), '—'); assert.equal(fmtV(''), '—'); assert.equal(fmtV(['a', 'b']), 'a / b (divergentes)');
});
