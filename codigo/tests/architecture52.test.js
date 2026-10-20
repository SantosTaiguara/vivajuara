'use strict';
// Topic 52 — architecture fitness functions over the real modules of plat/src.
// The dependency graph is read from the App.<namespace> references (no imports in this single-file app). Every finding is
// reported; the known-violation baseline in config/governance/architecture.json (each entry tied to a GAP-ARCH id in
// docs/ARCHITECTURE_GAP_REPORT.md) only separates registered debt from NEW violations, which fail the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const G = require('../scripts/governanceSources.js');
const A = G.mod('architectureConformance.js');

const manifest = G.cfg('architecture');
const SOURCES = G.sources();
const result = A.evaluate({ manifest, sources: SOURCES });
const rat = A.ratchet(result.findings, (manifest.knownViolations || []).map(k => k.key));
const fmt = f => `${f.rule} ${f.file}${f.line ? ':' + f.line : ''} — ${f.detail}`;

test('architecture: no NEW violation of the dependency rules (registered debt is reported, not hidden)', t => {
  for (const f of rat.known) t.diagnostic('registrada: ' + fmt(f));
  for (const f of rat.warnings) t.diagnostic('aviso: ' + fmt(f));
  for (const k of rat.fixed) t.diagnostic('corrigida (remover do baseline knownViolations): ' + k);
  assert.deepEqual(rat.blocking.map(fmt), [], 'violações novas de arquitetura');
});

test('architecture: every registered violation names a gap of the gap report', () => {
  const report = fs.readFileSync(path.join(G.ROOT, 'docs', 'ARCHITECTURE_GAP_REPORT.md'), 'utf8');
  for (const k of manifest.knownViolations) { assert.match(k.gapId, /^GAP-ARCH-\d\d$/, k.key); assert.ok(report.includes(k.gapId), `${k.gapId} ausente do ARCHITECTURE_GAP_REPORT.md`); }
});

test('architecture: every module of the current code base (as of topic 52) is placed in a bounded context and a layer', () => {
  const unclassified = result.findings.filter(f => f.rule === 'UNCLASSIFIED_MODULE').map(f => f.file);
  // modules added later by other topics are warnings until the manifest places them (see test above); the inventory itself must be complete
  const inventory = fs.readFileSync(path.join(G.ROOT, 'docs', 'CURRENT_ARCHITECTURE_INVENTORY.md'), 'utf8');
  for (const [file, m] of result.modules) assert.ok(manifest.layers[m.layer], `${file}: camada ${m.layer} desconhecida`);
  for (const file of Object.keys(SOURCES)) if (!unclassified.includes(file)) assert.ok(inventory.includes('`' + file + '`'), `${file} ausente do CURRENT_ARCHITECTURE_INVENTORY.md (rode node scripts/governanceDocs.js)`);
});

test('architecture: domain layer never touches DOM, storage or network (zero tolerance, not ratcheted)', () => {
  const bad = result.findings.filter(f => ['DOMAIN_NO_STORAGE', 'NO_NETWORK_OUTSIDE_INFRA'].includes(f.rule) && (result.modules.get(f.file) || {}).layer === 'domain')
    .concat(result.findings.filter(f => f.rule === 'DOMAIN_NO_DOM' && (result.modules.get(f.file) || {}).layer === 'domain'));
  assert.deepEqual(bad.map(fmt), []);
});

test('architecture: views never mutate canonical lot data nor write to repositories', () => {
  assert.deepEqual(result.findings.filter(f => f.rule === 'PRESENTATION_NO_DOMAIN_MUTATION').map(fmt), []);
});

test('invariant 2 — price never defines availability: domain/availability.js does not depend on pricing or the financial service', () => {
  const deps = [...(result.graph.get('domain/availability.js') || new Map()).keys()];
  for (const d of deps) assert.ok(!['pricing', 'financial'].includes((result.modules.get(d) || {}).context), `availability → ${d}`);
  const { code } = A.strip(SOURCES['domain/availability.js']);
  assert.doesNotMatch(code, /App\.priceHistory|App\.services\.finance/);
});

test('invariant 16 — no raw secret in frontend code', () => {
  const RX = /(api[_-]?key|secret|password|passwd|private[_-]?key|bearer)\s*[:=]\s*['"`][A-Za-z0-9+/_\-]{16,}['"`]/i;
  const hits = Object.entries(SOURCES).filter(([f, s]) => !f.startsWith('governance/') && RX.test(s)).map(([f]) => f);
  assert.deepEqual(hits, []);
});

test('logical context graph: cycles are reported (new ones as warnings), and the core contexts stay outside them', t => {
  const known = new Set(manifest.knownViolations.filter(k => k.key.startsWith('CONTEXT_CYCLE|')).map(k => k.key.split('|')[1]));
  for (const c of result.cycles) if (!known.has(c.join(' ↔ '))) t.diagnostic('ciclo novo (aviso): ' + c.join(' ↔ '));
  assert.ok(result.cycles.every(c => c.length >= 2));
  for (const core of ['analysis', 'availability', 'pricing', 'filters', 'map', 'recommendation']) assert.ok(!result.cycles.some(c => c.length > 2 && c.includes(core)), `${core} entrou num ciclo de contextos`);
  assert.ok(!result.cycles.some(c => c.includes('lot') && c.includes('customer')), 'Lot nunca depende de Customer');
});

test('architecture manifest: modular monolith v1 and its documents exist', () => {
  assert.equal(manifest.primaryStyle, 'MODULAR_MONOLITH');
  assert.match(manifest.architectureVersion, /^\d+\.\d+$/);
  for (const d of manifest.documentRefs) assert.ok(fs.existsSync(path.join(G.ROOT, d)), d);
  const ctxs = new Set(manifest.modules.map(m => m.context));
  for (const fb of manifest.forbiddenContextDependencies) { assert.ok(ctxs.has(fb.from), fb.from); assert.ok(ctxs.has(fb.to), fb.to); }
});

// ------------------------------------------------------------------ the fitness function itself is not vacuous
const MINI = {
  layers: { domain: { mayDependOn: ['domain', 'shared'], noDom: true, noStorage: true, noNetwork: true }, application: { mayDependOn: ['domain', 'application'], noDom: true, noNetwork: true },
    presentation: { mayDependOn: ['domain', 'application', 'presentation'], noStorage: true, noNetwork: true, noDomainMutation: true }, infrastructure: { mayDependOn: ['domain'], mayNameRawFiles: true }, shared: { mayDependOn: [] } },
  modules: [{ path: 'd/', context: 'lot', layer: 'domain' }, { path: 'd/avail.js', context: 'availability', layer: 'domain' }, { path: 'p/', context: 'pricing', layer: 'domain' }, { path: 'a/', context: 'app', layer: 'application' }, { path: 'v/', context: 'ui', layer: 'presentation' }, { path: 'i/', context: 'data', layer: 'infrastructure' }],
  forbiddenContextDependencies: [{ from: 'availability', to: 'pricing', reason: 'x' }],
  rules: { UNCLASSIFIED_MODULE: { severity: 'WARNING' }, CONTEXT_CYCLE: { severity: 'WARNING' } }
};
test('fitness function: detects each rule on synthetic modules and ignores comments, strings and look-alike properties', () => {
  const r = A.evaluate({ manifest: MINI, sources: {
    'd/lot.js': "App.lot = (() => { /* document.title */ const s = 'localStorage'; const t = `fetch(${1})`; const c = { document: 1 }; return c.document; })();",
    'd/avail.js': 'App.avail = (() => App.price.x)();',
    'p/price.js': 'App.price = { x: 1 };',
    'd/bad.js': 'App.bad = (() => { localStorage.getItem("k"); fetch("lots.json"); document.body; return App.svc; })();',
    'a/svc.js': 'App.svc = (() => ({ el: () => document.getElementById("x") }))();',
    'v/view.js': 'App.view = (l => { l.commercial.price = 0; repo.applyAvailabilityUpdate({}); return App.svc; });',
    'v/view2.js': 'App.lot = 1;',
    'i/repo.js': 'App.repo = (() => fetch("lots.json"))();',
    'x/new.js': 'App.newThing = 1;'
  } });
  const has = (rule, file) => r.findings.some(f => f.rule === rule && f.file === file);
  assert.ok(!r.findings.some(f => f.file === 'd/lot.js'), 'comentário, string e propriedade .document não são violações');
  assert.ok(has('FORBIDDEN_CONTEXT', 'd/avail.js'));
  assert.ok(has('DOMAIN_NO_STORAGE', 'd/bad.js') && has('NO_NETWORK_OUTSIDE_INFRA', 'd/bad.js') && has('DOMAIN_NO_DOM', 'd/bad.js'));
  assert.ok(has('LAYER_DIRECTION', 'd/bad.js'), 'domain → application');
  assert.ok(has('RAW_JSON_ONLY_IN_DATA', 'd/bad.js') && !has('RAW_JSON_ONLY_IN_DATA', 'i/repo.js'));
  assert.ok(has('DOMAIN_NO_DOM', 'a/svc.js'));
  assert.equal(r.findings.filter(f => f.rule === 'PRESENTATION_NO_DOMAIN_MUTATION' && f.file === 'v/view.js').length, 2);
  assert.ok(has('NAMESPACE_OWNERSHIP', 'v/view2.js'));
  assert.ok(r.findings.some(f => f.rule === 'UNCLASSIFIED_MODULE' && f.file === 'x/new.js' && f.severity === 'WARNING'));
  const rr = A.ratchet(r.findings, [A.keyOf(r.findings.find(f => f.file === 'd/avail.js'))]);
  assert.ok(rr.known.length === 1 && rr.blocking.length > 0 && !rr.blocking.some(f => f.file === 'd/avail.js'));
});
test('lexer: regex literals and nested templates do not desynchronise string detection', () => {
  const { code, strings } = A.strip("const r = /['\"`]/g; const h = `<b>${x ? `<i>${'document.x'}</i>` : ''}</b>`; document.y;");
  assert.match(code, /document\.y/);
  assert.ok(!/document\.x/.test(code));
  assert.ok(strings.includes('document.x'));
});
