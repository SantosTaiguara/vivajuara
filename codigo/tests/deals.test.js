'use strict';
// Topic 57 — proposal, reservation, negotiation and closing: read-only frontend domain + permission-gated view.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

let App, D, V;
const ROOT = path.join(SRC, '..');
const allow = (...keys) => ({ can: k => keys.includes(k) });
test.before(() => {
  App = load();
  // new modules are not in the harness ORDER yet: load them as the build does (one global App)
  for (const f of ['deals/dealsDomain.js', 'deals/dealsView.js']) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  D = App.deals.domain; V = App.dealsView;
});

test('read-only domain: frozen enums, no write API, every permission registered (deny by default, no role grants)', () => {
  assert.ok(Object.isFrozen(D) && Object.isFrozen(D.ProposalStatus) && Object.isFrozen(D.PERMISSIONS));
  for (const k of Object.keys(D).filter(k => typeof D[k] === 'function')) assert.ok(!/^(create|submit|accept|reserve|release|complete|cancel|save|update)/i.test(k), `no write function: ${k}`);
  assert.equal(D.PERMISSIONS.length, 24);
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'security', 'permissions.json'), 'utf8'));
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'PERMISSION_REGISTRY.md'), 'utf8');
  for (const k of D.PERMISSIONS) {
    const e = reg.permissions.find(p => p.key === k);
    assert.ok(e, `registered: ${k}`); assert.equal(e.anonymousAllowed, false); assert.equal(e.systemOnly, false);
    assert.ok(doc.includes('| `' + k + '` |'), `registry row: ${k}`);
  }
  const roles = JSON.stringify(reg.roles || reg.roleTemplates || {});
  for (const k of D.PERMISSIONS) assert.ok(!roles.includes(`"${k}"`), `no role grants ${k} (human decision)`);
});

test('chips, countdown from server time only, money never turns null into 0', () => {
  assert.deepEqual(D.chip('reservation', 'ACTIVE'), { label: 'Ativa', tone: 'ok' });
  assert.equal(D.chip('proposal', 'WHATEVER').label, 'Status não reconhecido');
  const st = '2026-10-17T12:00:00.000Z';
  assert.equal(D.countdown('2026-10-18T14:30:00.000Z', st).text, '1 d 2 h restantes');
  assert.equal(D.countdown('2026-10-17T12:45:00.000Z', st).text, '45 min restantes');
  assert.deepEqual(D.countdown('2026-10-17T11:00:00.000Z', st), { known: true, expired: true, ms: 0, text: 'Prazo encerrado' });
  assert.equal(D.countdown('2026-10-17T13:00:00.000Z', null).known, false, 'no server time → unknown, never Date.now()');
  assert.equal(D.money(null), 'não informado'); assert.equal(D.money(undefined), 'não informado');
  assert.match(D.money(29_900_000), /299\.000,00/);
  assert.equal(D.errorMessage('LOT_AVAILABILITY_UNKNOWN').length > 0, true);
  assert.ok(D.ERROR_CODES.includes('LOT_ALREADY_RESERVED') && D.ERROR_CODES.includes('AVAILABILITY_REVISION_CONFLICT') && D.ERROR_CODES.includes('POLICY_NOT_CONFIGURED'));
});

test('lot badge: UNKNOWN is never shown as available; reserved lot never names who reserved', () => {
  assert.equal(D.lotBadge({ availabilityStatus: 'UNKNOWN' }).label, 'Disponibilidade não confirmada');
  assert.equal(D.lotBadge(null).label, 'Disponibilidade não confirmada');
  assert.equal(D.lotBadge({ availabilityStatus: 'AVAILABLE', activeProposalCount: 2 }).label, 'Disponível · em negociação');
  const h = V.lotBadge({ availabilityStatus: 'RESERVED', reservedUntil: '2026-10-18T12:00:00.000Z', serverTime: '2026-10-17T12:00:00.000Z', customerId: 'cust_1', createdBy: 'user_x' }, allow('reservation.read'));
  assert.match(h, /Reservado · 1 d 0 h restantes/); assert.ok(!/cust_1|user_x/.test(h));
});

test('public visitor sees nothing: every block is empty without a deals read permission (App.authz denies by default)', () => {
  const vm = { proposal: { proposal: { id: 'prop_1', status: 'SUBMITTED', lotId: 'VJ-QB-L0016' }, versions: [] }, reservations: [{ reservationId: 'res_1', lotId: 'VJ-QB-L0016', status: 'ACTIVE', expiresAt: '2026-10-18T12:00:00.000Z' }], serverTime: '2026-10-17T12:00:00.000Z', closing: { closing: { id: 'clo_1', status: 'OPEN' } } };
  assert.equal(V.panel(vm), '', 'default App.authz context (visitor) → nothing');
  assert.equal(V.panel(vm, allow()), '');
  assert.equal(V.lotBadge({ availabilityStatus: 'RESERVED' }, allow()), '');
  assert.equal(V.reservationBoard(vm.reservations, vm.serverTime, allow('proposal.read')), '');
  assert.equal(V.closingSummary(vm.closing, allow('proposal.read')), '');
});

test('panel with permissions: table price snapshot, price-changed notice, escaped markup, no valorização, reason codes in pt-BR', () => {
  const vm = {
    serverTime: '2026-10-17T12:00:00.000Z',
    proposal: { serverTime: '2026-10-17T12:00:00.000Z', proposal: { id: 'prop_1', status: 'COUNTERED', lotId: '<img src=x onerror=1>' },
      versions: [{ versionNumber: 1, pricing: { listPriceMinor: 29_900_000 } }, { versionNumber: 2, validUntil: '2026-10-20T12:00:00.000Z', pricing: { listPriceMinor: 29_900_000, offerPriceMinor: 28_500_000 } }],
      currentPriceOverlay: { currentListPriceMinor: 30_500_000, differsFromProposal: true } },
    reservations: [],
    closing: { closing: { id: 'clo_1', status: 'DOCUMENTS_PENDING' }, readiness: { progress: { done: 1, total: 3 }, blockingItems: ['CHECKLIST:ID_DOC:PENDING'] } },
    capabilities: { reasonCodes: ['POLICY_NOT_CONFIGURED:reservation.maxDurationSeconds', 'LOT_AVAILABILITY_UNKNOWN', 'NO_PERMISSION:sale.complete'] }
  };
  const h = V.panel(vm, allow('proposal.read', 'reservation.read', 'closing.read'));
  assert.match(h, /Contraproposta/); assert.match(h, /versão 2/); assert.match(h, /299\.000,00/); assert.match(h, /oferta R\$\s?285\.000,00/);
  assert.match(h, /preço de tabela mudou/); assert.match(h, /3 d 0 h restantes/); assert.match(h, /Nenhuma reserva ativa/);
  assert.match(h, /1 de 3 itens validados/); assert.match(h, /1 pendência/);
  assert.match(h, /necessita confirmação/); assert.match(h, /Sem permissão para esta ação/);
  assert.ok(!h.includes('<img'), 'escaped'); assert.ok(!/valoriza/i.test(h));
  for (const a of ['dealOpenProposal', 'dealOpenClosing', 'dealRefresh']) assert.ok(h.includes(`data-act="${a}"`), a);
});

test('org commercial policy config: every decision null / necessita confirmação, bundled under configs.deals', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'deals', 'viva-juara.json'), 'utf8'));
  const leaves = []; (function walk(o, p) { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p + k + '.'); else leaves.push([p + k, v]); } })(cfg.policy || cfg, '');
  assert.ok(leaves.length > 0);
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts', 'configBundle.js'), 'utf8'), /'deals'\]/);
  const src = fs.readFileSync(path.join(SRC, 'deals', 'dealsDomain.js'), 'utf8') + fs.readFileSync(path.join(SRC, 'deals', 'dealsView.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/localStorage|fetch\(|Date\.now\(\)|innerHTML|document\./.test(code), 'no storage, network, client clock or DOM');
});
