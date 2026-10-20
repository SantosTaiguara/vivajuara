'use strict';
// Topics 44 (analytics semantic layer: metrics, funnels, cohorts, quality) and 45 (event tracking: catalog, envelope,
// identity/sessions, privacy/consent, dedupe, buffer/retry/offline, destinations, bridge). Golden scenarios named after the specs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { IDBFactory } = require('./node_modules/fake-indexeddb');
const { load, SRC } = require('./harness.js');

const MODULES = ['registry', 'privacy', 'client', 'semantic', 'metricsView', 'facade'];
const loadAll = () => { const A = load(); for (const f of MODULES) new Function('App', fs.readFileSync(path.join(SRC, 'analytics', f + '.js'), 'utf8'))(A); return A; };
let App, ET, S;
const ORG = 'org_house7', ORG_B = 'org_outra', DEV = 'viva-juara';
const T0 = Date.parse('2026-10-11T15:00:00Z');
const deq = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), msg);
test.before(() => { App = loadAll(); ET = App.eventTracking; S = App.semanticLayer; });

/** fresh client with a controllable clock and context */
function mk(o = {}) {
  const clock = { t: o.t || T0 }, ctx = { organizationId: ORG, developmentId: DEV, deviceClass: 'DESKTOP', ...(o.ctx || {}) };
  let seed = o.seed || 12345; const random = o.random || (() => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }); // mulberry32
  const c = ET.createClient({ now: () => clock.t, random, context: () => ctx, environment: o.environment || 'production', transports: o.transports, destinations: o.destinations, persistence: o.persistence, policy: o.policy });
  return { c, clock, ctx };
}
const remoteOn = (extra = {}) => ({ FIRST_PARTY_INGESTION: { enabled: true }, ...extra });

// =========================================================================== topic 45 — catalog, registry, contracts
test('registry: every catalog/legacy contract passes (names, versions, PII, sampling, destinations, producer policy) and purposes reference real metrics', () => {
  const r = ET.registry.current();
  deq(r.contractErrors({ metricCodes: [...S.current().metrics.keys()] }), []);
  assert.ok(r.list().length >= 80);
  for (const d of r.list()) { assert.match(d.name, ET.registry.NAME_RE); assert.ok(d.triggerSemantics); }
  // a broken catalog is caught
  const bad = ET.registry.build({ defaults: App.configs.analytics.events.defaults, events: [
    { name: 'click', version: 1, category: 'MAP', description: 'x', trigger: 'x', properties: { email: { type: 'STRING', description: 'e' } } },
    { name: 'share_opened', version: 1, category: 'SHARE', description: 'x', trigger: 'x', producer: 'SERVER', sources: ['WEB_CLIENT'], priority: 'CRITICAL', sampling: { mode: 'RANDOM', rate: 0.5 }, properties: {} },
    { name: 'lot_selected', version: 3, category: 'MAP', description: 'x', trigger: 'x', properties: {} }], legacy: [{ legacyName: 'x', canonicalName: 'nope', migrationAction: 'MAP', severity: 'LOW' }] });
  const codes = bad.contractErrors().map(e => e.code);
  for (const c of ['BAD_NAME', 'BANNED_NAME', 'FORBIDDEN_PROPERTY', 'SERVER_EVENT_FROM_CLIENT', 'SAMPLED_CONVERSION', 'NON_MONOTONIC_VERSION', 'LEGACY_TARGET_UNKNOWN']) assert.ok(codes.includes(c), c);
});

/** first argument of every App.analytics.track(...) call in a source text */
function trackArgs(src) {
  const out = []; let i = 0;
  while ((i = src.indexOf('App.analytics.track(', i)) >= 0) {
    let j = i + 'App.analytics.track('.length, depth = 0, k = j;
    for (; k < src.length; k++) { const ch = src[k]; if (ch === '(' || ch === '{' || ch === '[') depth++; else if (ch === ')' || ch === '}' || ch === ']') { if (!depth) break; depth--; } else if (ch === ',' && !depth) break; }
    out.push(src.slice(j, k).trim()); i = k;
  }
  return out;
}
test('LegacyTrackingInventory: no call site in the code base uses an unregistered event name (app.js incl. ternaries and the workspace helper, comparisonDomain, offline, any other file)', () => {
  const r = ET.registry.current(), names = new Set(), files = [];
  const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== 'analytics') walk(p); } else if (f.endsWith('.js')) files.push(p); } };
  walk(SRC);
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const a of trackArgs(src)) {
      const lits = [...a.matchAll(/'([a-z][a-z0-9_]*)'/g)].map(m => m[1]);
      if (lits.length) { lits.forEach(n => names.add(n)); continue; }
      assert.ok(a === 'why' || (a === 'evt' && /offline\.js$/.test(f)), `${path.relative(SRC, f)}: dynamic event name "${a}" must be a known wrapper`);
      for (const line of src.split('\n').filter(l => /set\(WK\.coordinator/.test(l))) for (const m of line.matchAll(/'([a-z]+_[a-z_]+)'/g)) names.add(m[1]);
    }
    if (/comparisonDomain\.js$/.test(f)) { for (const m of src.matchAll(/emit\('([a-z_]+)'/g)) names.add(m[1]); for (const m of src.matchAll(/'(comparison_[a-z_]+)'/g)) names.add(m[1]); }
    if (/offline\.js$/.test(f)) for (const m of src.matchAll(/\btrack\('([a-z_]+)'/g)) names.add(m[1]);
  }
  assert.ok(names.size >= 40, `found ${names.size}`);
  for (const n of ['desktop_panel_opened', 'desktop_panel_collapsed', 'desktop_panel_resized', 'comparison_bar_toggled', 'presentation_started', 'share_opened', 'mode', 'preset', 'comparison_started', 'offline_exit', 'sync_failed']) assert.ok(names.has(n), n);
  const missing = [...names].filter(n => !r.isRegistered(n));
  deq(missing, [], 'unregistered event names at call sites');
  // every legacy name resolves to a browser-producible, published canonical event
  for (const n of names) { const { def } = r.resolveName(n, { legacy: true }); assert.ok(def && def.sources.includes('WEB_CLIENT') && def.status === 'PUBLISHED', n); }
  // no vendor SDK call anywhere (topic 45 §67)
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\bgtag\(|\bfbq\(|dataLayer\.push|mixpanel\.|amplitude\.|posthog\.|hotjar|clarity\(/, f);
});

test('backwards compatibility: App.analytics.track keeps working (bound and unbound) for every legacy call shape; renames and payload transforms apply; log keeps { evt, data, t }', () => {
  const A = loadAll(), tr = A.analytics.track; // unbound, as comparisonDomain uses it
  const calls = [['desktop_panel_opened'], ['desktop_panel_collapsed'], ['comparison_bar_toggled'], ['layout_profile_changed', { from: undefined, to: 'DESKTOP' }], ['filter_zero_result', { n: 3 }],
    ['lot_selected', { code: 'A1', from: 'map' }], ['filter_changed', { k: 'areaM2' }], ['presentation_started'], ['presentation_ended'], ['share_opened', { n: 3 }], ['guided_presentation_preflight', { src: 'shortlist', status: 'PASS' }],
    ['guided_presentation_started'], ['quick_action', { k: 'quickview_fav', tier: null }], ['mode', { m: 'technical' }], ['customer_cleared'], ['filters_cleared'], ['filter_suggestion_applied', { id: 'corner' }], ['filter_removed', { id: 'status' }],
    ['filters_saved_as_constraints', { n: 2 }], ['recommendation_scope', { on: true }], ['legend_filter_action', { layer: 'availability' }], ['overlay_toggled', { id: 'solar' }], ['preset', { id: 'family' }], ['legend_expanded'], ['legend_collapsed'],
    ['base_map_changed', { b: 'satellite' }], ['search_result_opened', { k: 'lot' }], ['constraint_changed', { k: 'budgetMax' }], ['map_layer_changed', { id: 'price' }], ['layer_opacity_changed', { id: 'price' }], ['desktop_shortcut_used', { id: 'toggleLeft' }], ['sheet_snap', { s: 'mid' }],
    ['comparison_started', { developmentId: DEV }], ['comparison_candidate_added', { count: 1, lotId: 'VJ-QA-L0001', source: 'MAP', developmentId: DEV }], ['comparison_candidate_removed', { count: 0, lotId: 'VJ-QA-L0001', developmentId: DEV }], ['comparison_cleared', { count: 0, developmentId: DEV }],
    ['comparison_profile_changed', { count: 2, metricProfileId: 'BROKER_STANDARD', developmentId: DEV }], ['comparison_opened', { count: 2, metricProfileId: 'BROKER_STANDARD', developmentId: DEV }], ['comparison_shared', { count: 2, developmentId: DEV }],
    ['offline_entered', { why: 'browser' }], ['offline_exit', { why: 'browser' }], ['cache_miss', { what: 'static' }], ['cache_miss', { asset: 'tiles/12/a.png' }], ['stale_dynamic_used', { why: 'manifest' }], ['sync_failed', { reason: 'HTTP 500', error: 'TypeError: fetch failed at https://x' }]];
  const res = calls.map(([n, d]) => [n, tr(n, d)]);
  for (const [n, r] of res) assert.ok(['ACCEPTED', 'SAMPLED_OUT'].includes(r.status), `${n}: ${r.status} ${r.reason || ''} ${JSON.stringify(r.issues || '')}`);
  const by = Object.fromEntries(res.map(([n, r]) => [n, r]));
  assert.equal(by.share_opened.eventName, 'share_dialog_opened', 'client share dialog never counts as share_opened');
  assert.equal(by.presentation_started.eventName, 'presentation_view_entered');
  assert.equal(by.guided_presentation_started.eventName, 'guided_presentation_launched');
  assert.equal(by.mode.eventName, 'ui_mode_changed'); assert.equal(by.preset.eventName, 'recommendation_preset_toggled'); assert.equal(by.offline_exit.eventName, 'offline_exited');
  const evs = A.analytics.client.events({ organizationId: ORG });
  const lot = evs.find(e => e.eventName === 'lot_selected'); deq(lot.payload, { selectionSource: 'MAP' }); assert.equal(lot.entity.lotRef, 'A1'); assert.equal(lot.entity.developmentId, DEV);
  deq(evs.find(e => e.eventName === 'filter_applied').payload, { mode: 'QUICK', fieldKeys: ['areaM2'] });
  const cmp = evs.find(e => e.eventName === 'comparison_candidate_added'); deq(cmp.payload, { candidateCount: 1, source: 'MAP' }); assert.equal(cmp.entity.lotId, 'VJ-QA-L0001');
  deq(evs.find(e => e.eventName === 'sync_failed').payload, { reason: 'HTTP_500' }, 'free-text error message is dropped, only the code stays');
  deq(evs.find(e => e.eventName === 'customer_constraint_changed').payload, { fieldKey: 'budgetMax' }, 'only the field name, never the budget value');
  const log = A.analytics.log; assert.ok(Array.isArray(log) && log.length >= 40);
  assert.deepEqual(Object.keys(log[0]).sort(), ['data', 'evt', 't']); assert.ok(log.some(x => x.evt === 'share_opened'), 'log keeps the caller-facing name');
  assert.equal(A.analytics.client.quarantined(ORG).length, 0);
});

test('schema: known accepted, unknown/unsupported version quarantined, missing property, invalid enum, payload too large, forbidden/unknown field (strict) — never silently discarded', () => {
  const { c } = mk();
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } }).status, 'ACCEPTED');
  const q = (n, p, x) => c.track(n, p, x);
  assert.equal(q('button_clicked', {}).reason, 'UNKNOWN_EVENT');
  assert.equal(q('lot_selected', { selectionSource: 'MAP' }, { version: 9 }).reason, 'UNSUPPORTED_VERSION');
  const miss = q('filter_applied', { fieldKeys: ['a'] }); assert.equal(miss.reason, 'SCHEMA_INVALID'); assert.ok(miss.issues.some(i => i.code === 'MISSING_REQUIRED' && i.path === 'mode'));
  assert.equal(q('lot_selected', { selectionSource: 'HOVER' }).reason, 'INVALID_ENUM');
  assert.equal(q('filter_applied', { mode: 'QUICK', fieldKeys: Array.from({ length: 30 }, (_, i) => 'f' + i) }).reason, 'SCHEMA_INVALID');
  const big = ET.createClient({ now: () => T0, context: () => ({ organizationId: ORG }), policy: { ...App.configs.analytics.policy, payload: { ...App.configs.analytics.policy.payload, maxEventBytes: 300 } } });
  assert.equal(big.track('filter_applied', { mode: 'QUICK', fieldKeys: ['a'] }).reason, 'PAYLOAD_TOO_LARGE');
  assert.equal(q('lot_selected', { selectionSource: 'MAP', email: 'a@b.com' }).reason, 'PRIVACY_VIOLATION');
  assert.equal(q('lot_selected', { selectionSource: 'MAP', color: 'red' }).reason, 'SCHEMA_INVALID', 'strict: unknown property rejected');
  const leg = c.track('lot_selected', { code: 'B2', from: 'map', color: 'red' }, { legacy: true }); assert.equal(leg.status, 'ACCEPTED'); assert.ok(leg.warnings.some(w => w.code === 'UNKNOWN_PROPERTY'), 'legacy: dropped with a recorded warning');
  const qs = c.quarantined(ORG); assert.equal(qs.length, 7); assert.ok(qs.every(x => x.reason && x.at));
  assert.equal(c.health().quarantined, 7); assert.equal(c.health().captured, 9);
});

test('privacy: phone, email, CPF, auth/share token, full URL rejected; raw customer search query omitted; budget bucketed; payload cannot override tenant/user; quarantine never stores the offending value', () => {
  const { c } = mk(), P = ET.privacy;
  for (const v of ['ligue (48) 99999-1234', 'fulano@exemplo.com', '123.456.789-09', 'Bearer abc.def.ghi', 'https://viva.app/s/AbCdEf123456789xyz', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig']) {
    const r = c.track('search_result_opened', { resultKind: v }); assert.equal(r.reason, 'PRIVACY_VIOLATION', v);
  }
  for (const k of ['phone', 'email', 'cpf', 'authToken', 'shareToken', 'password', 'passcode', 'notes', 'fullName', 'url']) assert.ok(P.isForbiddenKey(k), k);
  assert.equal(c.track('customer_search_used', { resultCountBucket: '2_5', query: 'Maria Souza' }).reason, 'PRIVACY_VIOLATION', 'strict: raw query rejected');
  const leg = mk().c; // the legacy path drops it instead
  const r2 = leg.track('customer_search_used', { resultCountBucket: '2_5', query: 'Maria Souza' }, { legacy: true });
  assert.equal(r2.status, 'ACCEPTED'); assert.equal(JSON.stringify(leg.events({ organizationId: ORG })).includes('Maria'), false);
  assert.equal(P.bucket(312450, [250000, 300000, 350000, 400000], { unit: 'K' }), '300K_350K'); assert.equal(P.bucket(null, [1, 2]), null, 'null stays null, never 0');
  assert.equal(P.countBucket(0), '0'); assert.equal(P.countBucket(7), '6_20');
  const o = c.track('lot_selected', { selectionSource: 'MAP', organizationId: ORG_B }); assert.equal(o.reason, 'SCHEMA_INVALID'); assert.ok(o.issues.some(i => i.code === 'RESERVED_CONTEXT_KEY'));
  const all = JSON.stringify(c.quarantined(ORG)); for (const v of ['99999', 'fulano', '456.789', 'AbCdEf123456789xyz', 'Maria']) assert.ok(!all.includes(v), v);
  deq(P.scrub({ a: 'ok', email: 'x@y.com', nested: { note: 'oi', b: 'liga 48 99999-1234' } }).value, { a: 'ok', nested: { b: '[removido]' } });
  deq(P.extractCampaign('https://x.com/?utm_source=Instagram&utm_campaign=Lançamento 2026&token=abc&utm_medium=paid'), { utm_source: 'instagram', utm_medium: 'paid', utm_campaign: 'lan_amento_2026' });
  assert.match(P.redact('cliente-1', 'HASH'), /^h_[0-9a-f]{8}$/);
});

test('identity: anonymous vs logged-in; logout removes userId and rotates the product session; user switch never stitches; Customer ≠ User (customerId only on pseudonymous events)', () => {
  const { c, ctx } = mk({ ctx: { customerId: 'cus_123' } });
  c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } });
  let e = c.events({ organizationId: ORG }).pop(); assert.equal(e.actor.actorType, 'ANONYMOUS'); assert.ok(e.actor.anonymousId); assert.equal(e.actor.userId, undefined); assert.equal(e.actor.customerId, undefined, 'no customer id on NONE-class events');
  const s0 = c.session().id;
  c.setIdentity({ userId: 'usr_ana', organizationId: ORG });
  c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A2' } }); e = c.events({ organizationId: ORG }).pop();
  assert.equal(e.actor.actorType, 'USER'); assert.equal(e.actor.userId, 'usr_ana'); assert.equal(e.actor.anonymousId, undefined);
  c.track('customer_context_selected', {}); e = c.events({ organizationId: ORG }).pop(); assert.equal(e.actor.customerId, 'cus_123'); assert.equal(e.actor.userId, 'usr_ana', 'User and Customer stay distinct fields');
  const s1 = c.session().id; assert.equal(s1, s0, 'login does not stitch/rotate by itself (stitching off by policy)');
  deq(c.setIdentity({ userId: 'usr_bia', organizationId: ORG }), { rotated: true, reason: 'USER_SWITCH' }); assert.notEqual(c.session().id, s1, 'user switch → new session');
  deq(c.setIdentity({ userId: null, organizationId: ORG }), { rotated: true, reason: 'LOGOUT' });
  c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A3' } }); e = c.events({ organizationId: ORG }).pop(); assert.equal(e.actor.userId, undefined); assert.equal(e.actor.actorType, 'ANONYMOUS');
  void ctx;
});

test('sessions: product session rolls over after 30 min of inactivity; presentation and share access sessions are separate ids; no universal session', () => {
  const { c, clock } = mk();
  c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } }); const s1 = c.session().id;
  clock.t += 29 * 60000; c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A2' } }); assert.equal(c.session().id, s1);
  clock.t += 31 * 60000; c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A3' } }); assert.notEqual(c.session().id, s1, 'inactivity rollover');
  c.track('presentation_started', {}, { source: 'DOMAIN_BRIDGE', presentationSessionId: 'pss_1' });
  const e = c.events({ organizationId: ORG }).pop(); assert.equal(e.session.presentationSessionId, 'pss_1'); assert.notEqual(e.session.productSessionId, 'pss_1');
  assert.equal(e.session.shareAccessSessionId, undefined); assert.equal(e.session.journeyId, undefined);
});

test('dedupe: duplicate eventId, duplicate idempotency key (bridge retry), legitimate repeated lot selection A→B→A, same lot re-render ignored, SESSION_ONCE, ENTITY_WINDOW', () => {
  const { c, clock } = mk();
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' }, eventId: 'evt-1' }).status, 'ACCEPTED');
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'B9' }, eventId: 'evt-1' }).status, 'DUPLICATE', 'same eventId');
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'B9' } }).status, 'ACCEPTED');
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } }).status, 'ACCEPTED', 'A→B→A counts again');
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } }).status, 'DUPLICATE', 'same lot again (re-render / double effect) is not a new selection');
  const k = { source: 'DOMAIN_BRIDGE', idempotencyKey: 'fav_1|favorite_added|v1' };
  assert.equal(c.track('favorite_added', { contextType: 'PERSONAL', source: 'QUICK_VIEW' }, k).status, 'ACCEPTED');
  assert.equal(c.track('favorite_added', { contextType: 'PERSONAL', source: 'QUICK_VIEW' }, k).status, 'DUPLICATE', 'domain bridge retry');
  assert.equal(c.track('app_opened', { entryType: 'DIRECT' }).status, 'ACCEPTED'); assert.equal(c.track('app_opened', { entryType: 'DIRECT' }).status, 'DUPLICATE', 'SESSION_ONCE');
  assert.equal(c.track('filter_applied', { mode: 'QUICK', fieldKeys: ['area'] }).status, 'ACCEPTED');
  clock.t += 400; assert.equal(c.track('filter_applied', { mode: 'QUICK', fieldKeys: ['area'] }).status, 'DUPLICATE', 'typing in the same field within 1 s');
  assert.equal(c.track('filter_applied', { mode: 'QUICK', fieldKeys: ['price'] }).status, 'ACCEPTED', 'other field');
  clock.t += 5000; assert.equal(c.track('filter_applied', { mode: 'QUICK', fieldKeys: ['area'] }).status, 'ACCEPTED', 'after the window');
  assert.equal(c.health().duplicated, 5);
});

test('transport: batch, network failure → bounded retry with backoff, 429, 500, 400 not retried (quarantined), partial reject, reconnect flush; at-least-once (server dedupe) — never exactly-once', async () => {
  const tt = ET.createTestTransport([{ status: 'RETRY', errorCode: 'NETWORK' }, { status: 'RETRY', errorCode: '429' }, { status: 'RETRY', errorCode: '5XX' }, { status: 'OK', duplicated: [] }]);
  const { c, clock } = mk({ destinations: remoteOn(), transports: { FIRST_PARTY_INGESTION: tt } });
  c.setConsent('GRANTED');
  for (let i = 0; i < 3; i++) c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A' + i } });
  assert.equal(c.outbox(ORG).length, 3);
  let s = await c.flush(); assert.equal(s.retried, 3); assert.equal(c.outbox(ORG).length, 3);
  s = await c.flush(); assert.equal(s.batches, 0, 'not due yet (backoff)');
  for (let i = 0; i < 3; i++) { clock.t += 120000; s = await c.flush(); }
  assert.equal(tt.batches.length, 4); assert.equal(c.outbox(ORG).length, 0); assert.equal(c.health().acceptedRemote, 3);
  assert.ok(tt.batches[0][0].eventId && tt.batches[0][0].occurredAt && tt.batches[0][0].capturedAt && tt.batches[0][0].schemaVersion);
  // 400 → no retry, quarantine
  const t400 = ET.createTestTransport([{ status: 'REJECTED', errorCode: '400' }]); const m2 = mk({ destinations: remoteOn(), transports: { FIRST_PARTY_INGESTION: t400 } }); m2.c.setConsent('GRANTED');
  m2.c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } }); s = await m2.c.flush();
  assert.equal(s.rejected, 1); assert.equal(m2.c.outbox(ORG).length, 0); assert.equal(m2.c.quarantined(ORG)[0].reason, 'SERVER_REJECTED');
  // partial reject + server duplicate
  const tp = ET.createTestTransport([b => ({ status: 'OK', accepted: [b[0].eventId], duplicated: [b[1].eventId], rejected: [{ eventId: b[2].eventId, reason: 'SCHEMA_INVALID' }] })]);
  const m3 = mk({ destinations: remoteOn(), transports: { FIRST_PARTY_INGESTION: tp } }); m3.c.setConsent('GRANTED');
  for (let i = 0; i < 3; i++) m3.c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'B' + i } });
  s = await m3.c.flush(); assert.equal(s.accepted, 1); assert.equal(s.duplicated, 1); assert.equal(s.rejected, 1); assert.equal(m3.c.outbox(ORG).length, 0);
  // retry exhausted → dropped and counted (no infinite retry)
  const tf = ET.createTestTransport(Array(10).fill({ status: 'RETRY', errorCode: 'NETWORK' })); const m4 = mk({ destinations: remoteOn(), transports: { FIRST_PARTY_INGESTION: tf } }); m4.c.setConsent('GRANTED');
  m4.c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'C1' } });
  for (let i = 0; i < 6; i++) { await m4.c.flush(); m4.clock.t += 3600000; }
  assert.equal(tf.batches.length, 5); assert.equal(m4.c.health().droppedByReason.RETRY_EXHAUSTED, 1); assert.ok(m4.c.diagnostics().some(d => d.code === 'analytics_transport_failure'));
  // offline → reconnect flush
  const to = ET.createTestTransport(); const m5 = mk({ destinations: remoteOn(), transports: { FIRST_PARTY_INGESTION: to } }); m5.c.setConsent('GRANTED');
  await m5.c.setOnline(false); m5.c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'D1' } });
  assert.equal((await m5.c.flush()).reason, 'OFFLINE'); assert.equal(to.batches.length, 0);
  await m5.c.setOnline(true); assert.equal(to.batches.length, 1, 'EventOfflineBufferedAndFlushed');
  // HTTP transport classification
  const http = ET.createHttpTransport({ fetch: async () => ({ status: 503, json: async () => ({}) }) }); assert.equal((await http.send([])).errorCode, '5XX');
  assert.equal((await ET.createHttpTransport({ fetch: async () => { throw new Error('x'); } }).send([])).errorCode, 'NETWORK');
  assert.equal((await ET.createHttpTransport({ fetch: async () => ({ status: 400, json: async () => ({}) }) }).send([])).status, 'REJECTED');
});

test('default policy: nothing leaves the device — every remote destination is off, flush sends nothing, GA/Meta are mapping-only', async () => {
  const { c } = mk({ transports: { FIRST_PARTY_INGESTION: ET.createTestTransport(), GOOGLE_ANALYTICS: ET.createTestTransport() } });
  c.setConsent('GRANTED');
  const r = c.track('comparison_opened', { candidateCount: 2 }); assert.equal(r.status, 'ACCEPTED');
  deq(Object.fromEntries(Object.entries(r.deliveries).map(([k, d]) => [k, d.errorCode])), { FIRST_PARTY_INGESTION: 'DESTINATION_DISABLED' });
  assert.equal(c.outbox(ORG).length, 0); assert.equal((await c.flush()).sent, 0);
  for (const d of c.destinations()) if (d.code !== 'LOCAL_BUFFER') assert.equal(d.enabled, false, d.code);
  deq(c.health().remoteDestinationsEnabled, []);
  const pol = App.configs.analytics.policy.destinations; assert.equal(pol.GOOGLE_ANALYTICS.enabled, false); assert.equal(pol.META_PIXEL.enabled, false); assert.ok(pol.GOOGLE_ANALYTICS.decisionRef && pol.META_PIXEL.decisionRef);
});

test('vendor destinations (when a human enables them): GA/Meta mapping, consent denied skips, provider failure preserves the canonical event, no Customer/Journey ids leak', async () => {
  const ga = ET.createTestTransport(Array(10).fill({ status: 'RETRY', errorCode: '5XX' })), fp = ET.createTestTransport(), meta = ET.createTestTransport();
  const pol = JSON.parse(JSON.stringify(App.configs.analytics.policy));
  pol.destinations.GOOGLE_ANALYTICS.enabled = true; pol.destinations.META_PIXEL.enabled = true; pol.destinations.FIRST_PARTY_INGESTION.enabled = true;
  const cat = JSON.parse(JSON.stringify(App.configs.analytics.events)); const lot = cat.events.find(e => e.name === 'lot_selected'); lot.destinations = ['LOCAL_BUFFER', 'FIRST_PARTY_INGESTION', 'GOOGLE_ANALYTICS'];
  const pc = cat.events.find(e => e.name === 'presentation_completed'); pc.destinations = ['LOCAL_BUFFER', 'FIRST_PARTY_INGESTION', 'META_PIXEL'];
  const c = ET.createClient({ now: () => T0, policy: pol, registry: ET.registry.build(cat), context: () => ({ organizationId: ORG, customerId: 'cus_1', journeyId: 'jou_1' }), transports: { FIRST_PARTY_INGESTION: fp, GOOGLE_ANALYTICS: ga, META_PIXEL: meta } });
  let r = c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1', customerId: 'cus_1' } }); assert.equal(r.deliveries.GOOGLE_ANALYTICS.errorCode, 'CONSENT', 'UNKNOWN consent: third parties skipped');
  c.setConsent('GRANTED');
  r = c.track('lot_selected', { selectionSource: 'LIST' }, { entity: { lotRef: 'A2', customerId: 'cus_1' } }); assert.equal(r.deliveries.GOOGLE_ANALYTICS.status, 'PENDING');
  r = c.track('presentation_completed', { purpose: 'SHORTLIST' }, { source: 'DOMAIN_BRIDGE', presentationSessionId: 'pss_9' }); assert.equal(r.deliveries.META_PIXEL.status, 'PENDING');
  await c.flush();
  deq(ga.batches[0][0], { name: 'lot_selected', params: { selectionSource: 'LIST' }, route: null }); deq(meta.batches[0][0], { name: 'PresentationCompleted', params: { purpose: 'SHORTLIST' }, route: null });
  assert.ok(!JSON.stringify(ga.batches).includes('cus_1') && !JSON.stringify(meta.batches).includes('jou_1'), 'no Customer/Journey ids to third parties');
  assert.equal(fp.batches.flat().length, 2, 'first-party got the canonical events (after consent) even though GA failed');
  assert.ok(c.events({ organizationId: ORG }).some(e => e.entity.lotRef === 'A2'), 'EventVendorFailureCanonicalPreserved');
  assert.equal(c.outbox(ORG).length, 1, 'only the GA delivery is still pending retry');
  c.setConsent('DENIED'); assert.equal(c.outbox(ORG).length, 0, 'consent revoked before flush: pending removed');
});

test('offline: optional persistence (IndexedDB) keeps the outbox across reloads, very old events expire, buffer limit evicts LOW before CRITICAL, consent revoked before flush purges', async () => {
  const idb = ET.idbPersistence(new IDBFactory(), 'vj-test');
  const pol = JSON.parse(JSON.stringify(App.configs.analytics.policy)); pol.destinations.FIRST_PARTY_INGESTION.enabled = true; pol.buffer.persistOffline = true;
  const a = ET.createClient({ now: () => T0, policy: pol, context: () => ({ organizationId: ORG }), persistence: idb, transports: { FIRST_PARTY_INGESTION: ET.createTestTransport() } });
  a.setConsent('GRANTED'); await a.setOnline(false);
  a.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } }); a.track('comparison_opened', { candidateCount: 2 });
  await new Promise(r => setTimeout(r, 30));
  const tb = ET.createTestTransport();
  const b = ET.createClient({ now: () => T0 + 3600000, policy: pol, context: () => ({ organizationId: ORG }), persistence: idb, transports: { FIRST_PARTY_INGESTION: tb } }); b.setConsent('GRANTED');
  deq(await b.restore(ORG), { restored: 2 }); await b.flush(); assert.equal(tb.batches[0].length, 2, 'restored after reload and flushed');
  const c2 = ET.createClient({ now: () => T0 + 8 * 86400000, policy: pol, context: () => ({ organizationId: ORG }), persistence: idb });
  await idb.save(ORG, a.outbox(ORG)); deq(await c2.restore(ORG), { restored: 0 }); assert.equal(c2.health().droppedByReason.OFFLINE_EXPIRED, 2, 'max offline age');
  // priority eviction (EventPriorityBufferEviction)
  const small = JSON.parse(JSON.stringify(App.configs.analytics.policy)); small.buffer.maxLocalEventsPerOrganization = 3;
  const e = ET.createClient({ now: () => T0, policy: small, context: () => ({ organizationId: ORG }) });
  e.track('presentation_completed', {}, { source: 'DOMAIN_BRIDGE', presentationSessionId: 'p1' });
  e.track('legend_expanded', {}); e.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } }); e.track('legend_collapsed', {}); e.track('comparison_opened', { candidateCount: 2 });
  deq(e.events({ organizationId: ORG }).map(x => x.eventName), ['presentation_completed', 'lot_selected', 'comparison_opened']);
  assert.equal(e.health().droppedByReason.LOCAL_BUFFER_OVERFLOW, 2); assert.ok(e.health().truncatedBefore);
  // consent revoked before flush (EventConsentRevokedBeforeFlush)
  const f = mk({ destinations: remoteOn(), transports: { FIRST_PARTY_INGESTION: ET.createTestTransport() } }); f.c.setConsent('GRANTED');
  f.c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } }); f.c.track('offline_entered', { reason: 'browser' });
  const rv = f.c.setConsent('DENIED'); assert.equal(rv.purged, 2, 'product event removed from buffer and outbox');
  deq(f.c.events({ organizationId: ORG }).map(x => x.eventName), ['offline_entered'], 'technical telemetry (not consent-dependent) stays local');
  assert.equal(f.c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A2' } }).status, 'NOT_CAPTURED');
  assert.equal((await f.c.flush()).sent, 0);
});

test('multi-tenant: payload/ctx org mismatch denied, buffers isolated per organization, tenant switch never re-labels pending events, reads require a tenant', () => {
  const { c, ctx } = mk();
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { organizationId: ORG_B, entity: { lotRef: 'A1' } }).reason, 'TENANT_MISMATCH', 'cross-tenant injection denied');
  c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } });
  c.setIdentity({ organizationId: ORG }); const s = c.session().id;
  c.setIdentity({ organizationId: ORG_B }); assert.notEqual(c.session().id, s, 'tenant switch rotates the session'); ctx.organizationId = ORG_B;
  c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'Z9' } });
  deq(c.events({ organizationId: ORG }).map(e => e.entity.lotRef), ['A1']); deq(c.events({ organizationId: ORG_B }).map(e => e.entity.lotRef), ['Z9']);
  assert.ok(c.events({ organizationId: ORG_B }).every(e => e.organizationId === ORG_B));
  assert.throws(() => c.events({}), /organizationId/);
  const u = ET.createClient({ now: () => T0, context: () => ({}) }); assert.equal(u.track('legend_expanded', {}).reason, 'TENANT_UNRESOLVED');
});

test('timestamps: occurredAt ≠ capturedAt; late arrival accepted with its occurrence time; impossible future quarantined; too old expires (counted)', () => {
  const { c } = mk();
  const mon = '2026-10-05T13:00:00Z';
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { occurredAt: mon, entity: { lotRef: 'A1' } }).status, 'ACCEPTED');
  const e = c.events({ organizationId: ORG }).pop(); assert.equal(e.occurredAt, new Date(mon).toISOString()); assert.equal(e.capturedAt, new Date(T0).toISOString(), 'EventLateArrivalAccepted');
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { occurredAt: T0 + 3600000, entity: { lotRef: 'A2' } }).reason, 'INVALID_TIMESTAMP');
  assert.equal(c.track('lot_selected', { selectionSource: 'MAP' }, { occurredAt: T0 - 30 * 86400000, entity: { lotRef: 'A3' } }).reason, 'EXPIRED');
  assert.equal(c.health().droppedByReason.EXPIRED, 1);
});

test('sampling: deterministic sampling only on low-value telemetry (cache_hit 25%); conversions never sampled; sampled-out is counted', () => {
  const { c, clock } = mk(); let out = 0;
  for (let i = 0; i < 200; i++) { c.rotateSession('TEST'); clock.t += 1; if (c.track('cache_hit', { durationMs: 3 }).status === 'SAMPLED_OUT') out++; }
  assert.ok(out > 100 && out < 190, `sampled out ${out}`); assert.equal(c.health().sampledOut, out);
  for (const d of ET.registry.current().list()) if (['CRITICAL', 'HIGH'].includes(d.priority)) assert.equal(d.sampling.mode, 'NONE', d.name);
});

test('share: share_opened only from the server after a valid access; client attempt rejected; bot preview excluded; token never in the event', () => {
  const { c } = mk(), br = ET.createBridge(c);
  assert.equal(c.track('share_opened', {}).reason, 'PRODUCER_NOT_ALLOWED', 'browser cannot emit the server-authoritative open');
  const res = br.ingest([{ type: 'share_opened', at: '2026-10-11T14:00:00Z', shareGrantId: 'shg_1', token: 'tok_SECRET_abcdefghijklmnopqrstuvwxyz0123' }, { type: 'share_opened', at: '2026-10-11T14:01:00Z', shareGrantId: 'shg_2', preview: true }]);
  assert.equal(res[0].status, 'ACCEPTED'); assert.equal(res[1].status, 'EXCLUDED', 'EventShareBotPreviewExcluded');
  const e = c.recent().length; assert.ok(e >= 1);
  assert.equal(JSON.stringify(c.events({ organizationId: ORG })).includes('SECRET'), false); assert.equal(JSON.stringify(c.outbox(ORG)).includes('SECRET'), false);
  assert.equal(br.ingest({ type: 'share_opened', at: '2026-10-11T14:00:00Z', shareGrantId: 'shg_1' })[0].status, 'DUPLICATE', 'server retry dedupes by idempotency key');
});

test('presentation (bridge): started once per session, step first view only, explicit completion, feedback without notes; the UI launch click is not presentation_started', () => {
  const { c } = mk(), br = ET.createBridge(c), at = i => new Date(T0 - 600000 + i * 1000).toISOString();
  const evs = [{ type: 'PresentationStarted', at: at(0), organizationId: ORG, snapshotId: 'psn_1', sessionId: 'pss_1' }, { type: 'PresentationStepViewed', at: at(1), organizationId: ORG, sessionId: 'pss_1', stepId: 'st1' },
    { type: 'PresentationStepViewed', at: at(2), organizationId: ORG, sessionId: 'pss_1', stepId: 'st2' }, { type: 'PresentationStepViewed', at: at(3), organizationId: ORG, sessionId: 'pss_1', stepId: 'st1' },
    { type: 'PresentationFeedbackRecorded', at: at(4), organizationId: ORG, sessionId: 'pss_1', feedbackId: 'pfi_1', type2: 'x', notes: 'cliente disse que achou caro', presenterNotes: 'segredo' },
    { type: 'PresentationCompleted', at: at(5), organizationId: ORG, sessionId: 'pss_1', snapshotId: 'psn_1' }, { type: 'PresentationEnded', at: at(6), organizationId: ORG, sessionId: 'pss_1' }];
  const r = br.ingest(evs); br.ingest(evs); // re-sync is idempotent
  deq(r.map(x => x.status), ['ACCEPTED', 'ACCEPTED', 'ACCEPTED', 'DUPLICATE', 'ACCEPTED', 'ACCEPTED', 'NOT_MAPPED']);
  const names = c.events({ organizationId: ORG }).map(e => e.eventName);
  deq(names, ['presentation_started', 'presentation_step_viewed', 'presentation_step_viewed', 'presentation_feedback_recorded', 'presentation_completed'], 'EventPresentationStepViewedOnce / EventPresentationCompletedServerSide');
  assert.ok(!JSON.stringify(c.events({ organizationId: ORG })).match(/caro|segredo/), 'no presenter notes / free text');
  assert.equal(c.track('guided_presentation_started', undefined, { legacy: true }).eventName, 'guided_presentation_launched');
  assert.equal(c.track('presentation_started', {}).reason, 'PRODUCER_NOT_ALLOWED', 'browser click cannot claim a PresentationSession start');
});

test('deep link: full and partial restore, stateRefUsed, never a full URL in routeCode', () => {
  const { c } = mk();
  assert.equal(c.track('deep_link_restored', { routeCode: 'LOT', restoreStatus: 'FULL', stateRefUsed: false }).status, 'ACCEPTED', 'EventDeepLinkRestored');
  assert.equal(c.track('deep_link_restored', { routeCode: 'LOT', restoreStatus: 'PARTIAL', stateRefUsed: true, warningCount: 2 }).status, 'ACCEPTED');
  assert.equal(c.track('deep_link_partial_restore', { routeCode: 'LOT', warningCount: 2, droppedKeys: ['f', 'cmp'] }).status, 'ACCEPTED');
  assert.equal(c.track('deep_link_restored', { routeCode: 'https://viva.app/#lot=A1&f=x', restoreStatus: 'FULL', stateRefUsed: false }).reason, 'PRIVACY_VIOLATION');
  assert.equal(c.events({ organizationId: ORG }).filter(e => e.payload.stateRefUsed === true).length, 1);
});

test('generated artifacts: TypeScript types and catalog docs come from the same registry; fixtures validate; inventory lists every legacy name with an action', () => {
  const r = ET.registry.current(), ts = r.generateTypes();
  assert.match(ts, /export interface LotSelectedV1Payload \{\n  selectionSource: "MAP" \| "LIST"/);
  assert.match(ts, /"deep_link_restored@1": DeepLinkRestoredV1Payload;/);
  assert.equal(r.generateDocs().split('\n').filter(l => l.startsWith('| `')).length, r.list().length);
  const { c } = mk();
  for (const d of r.list().filter(d => d.sources.includes('WEB_CLIENT'))) { const res = c.track(d.name, r.fixture(d.name), { entity: { lotRef: 'X' + d.name } }); assert.ok(['ACCEPTED', 'DUPLICATE', 'SAMPLED_OUT'].includes(res.status), `${d.name}: ${res.reason}`); }
  const inv = r.inventory(); assert.equal(inv.length, r.legacy().length); assert.ok(inv.every(i => i.migrationAction && i.severity && i.location));
  assert.ok(inv.some(i => i.eventName === 'share_opened' && i.severity === 'HIGH' && i.duplicatesAnotherEvent));
});

// =========================================================================== topic 44 — semantic layer, metrics, funnels, cohorts
const RANGE = { from: '2026-10-01T03:00:00Z', to: '2026-11-01T03:00:00Z' };
const Q = (codes, extra = {}) => ({ organizationId: ORG, metricCodes: codes, timeRange: RANGE, grain: 'TOTAL', ...extra });
const total = (res, code) => res.series.find(s => s.metricCode === code).total;
const at = d => `2026-10-${String(d).padStart(2, '0')}T15:00:00Z`;

test('semantic registry: contracts pass; every rate has explicit numerator/denominator, NULL zero-denominator, timestamp basis, entity, version and lineage; no causal or "valorização" wording', () => {
  deq(S.current().contractErrors(), []);
  for (const m of S.current().list()) {
    assert.ok(m.entity && m.timestampBasis && m.version && m.lineage, m.code);
    if (['RATE', 'RATIO'].includes(m.measureType)) assert.equal(m.zeroDenominatorPolicy, 'NULL', m.code);
    deq(S.causalWordingIssues(m.name + ' ' + m.description), [], m.code); deq(S.pricingWordingIssues(m.name + ' ' + m.description), [], m.code);
  }
  deq(S.causalWordingIssues('A Recommendation aumentou vendas em 7 p.p.'), ['CAUSAL_CLAIM']); deq(S.pricingWordingIssues('ROI do lote'), ['PRICING_RETURN_CLAIM']);
  const b = S.current().bundle(); assert.ok(b.metricRegistryVersion && b.funnelRegistryVersion && b.dimensionRegistryVersion && b.transformationVersion && b.eventCatalogVersion);
});

const outcomes = (won, lost, o = {}) => [...Array(won)].map((_, i) => ({ organizationId: ORG, journeyId: 'jw' + i, outcomeType: 'CLOSED_WON', closedAt: at(10), sourceCode: o.src ? o.src(i, true) : 'META' }))
  .concat([...Array(lost)].map((_, i) => ({ organizationId: ORG, journeyId: 'jl' + i, outcomeType: 'CLOSED_LOST', closedAt: at(11), sourceCode: o.src ? o.src(i, false) : 'META' })));
test('AnalyticsJourneyWinRate + AnalyticsZeroDenominator: 6 won / 10 closed = 60%; 0 closed → N/A (null), never 0%; duplicated rows count once (distinct journeyId)', () => {
  let r = S.query(Q(['journey_win_rate', 'journey_loss_rate']), { events: [], facts: { FactJourneyOutcome: [...outcomes(6, 4), ...outcomes(6, 4)] } });
  deq(total(r, 'journey_win_rate'), { value: 0.6, numerator: 6, denominator: 10 }); assert.equal(total(r, 'journey_loss_rate').value, 0.4);
  assert.equal(r.metadata.quality.journey_win_rate.status, 'VALID'); assert.equal(r.metadata.timezone, 'America/Sao_Paulo');
  r = S.query(Q(['journey_win_rate']), { events: [], facts: { FactJourneyOutcome: [] } }); assert.equal(total(r, 'journey_win_rate').value, null);
  assert.equal(S.formatValue(S.current().metric('journey_win_rate'), null), 'N/A');
  r = S.query(Q(['journey_win_rate']), { events: [] }); assert.equal(r.metadata.quality.journey_win_rate.status, 'BLOCKED', 'no server facts on the device'); assert.equal(total(r, 'journey_win_rate').value, null);
});

test('AnalyticsShareOpenRate + AnalyticsShareTimeToFirstOpen: 100 grants, 70 opened (extra opens and bot previews do not count) = 70%; median time to first open', () => {
  const grants = [...Array(100)].map((_, i) => ({ organizationId: ORG, shareGrantId: 'g' + i, issuedAt: at(5) }));
  const opens = [...Array(70)].map((_, i) => ({ organizationId: ORG, shareGrantId: 'g' + i, shareAccessSessionId: 's' + i, openedAt: new Date(Date.parse(at(5)) + (i + 1) * 60000).toISOString() }))
    .concat([...Array(10)].map((_, i) => ({ organizationId: ORG, shareGrantId: 'g' + i, shareAccessSessionId: 'x' + i, openedAt: at(6) })), [{ organizationId: ORG, shareGrantId: 'g99', shareAccessSessionId: 'bot', openedAt: at(6), isBotPreview: true }]);
  const r = S.query(Q(['share_open_rate_by_issue_cohort', 'share_opens_in_period', 'share_time_to_first_open']), { events: [], facts: { FactShareGrant: grants, FactShareAccess: opens } });
  deq(total(r, 'share_open_rate_by_issue_cohort'), { value: 0.7, numerator: 70, denominator: 100 });
  assert.equal(total(r, 'share_opens_in_period').value, 80, 'opens in period is a different metric');
  assert.equal(total(r, 'share_time_to_first_open').value, 35.5 * 60, 'median of 1..70 minutes');
});

test('AnalyticsStageConversion + AnalyticsTimeInStage: A→B over journeys that entered A (dedup), stage model versions never mixed; completed duration ≠ current stage age', () => {
  const tr = (j, from, to, t, v = 'sm1') => ({ organizationId: ORG, journeyId: j, fromStageId: from, toStageId: to, stageModelVersionId: v, occurredAt: t });
  const rows = [tr('j1', 'NEW', 'QUAL', '2026-10-02T13:00:00Z'), tr('j1', 'QUAL', 'VISIT', '2026-10-02T17:00:00Z'), tr('j2', 'NEW', 'QUAL', '2026-10-03T13:00:00Z'), tr('j2', 'QUAL', 'NEW', '2026-10-03T14:00:00Z'), tr('j2', 'NEW', 'QUAL', '2026-10-03T15:00:00Z'),
    tr('j3', 'NEW', 'QUAL', '2026-10-04T10:00:00Z'), tr('j4', 'NEW', 'QUAL', '2026-10-04T10:00:00Z', 'sm2'), tr('j4', 'QUAL', 'VISIT', '2026-10-04T11:00:00Z', 'sm2')];
  const facts = { FactJourneyStageTransition: rows };
  let r = S.query(Q(['stage_conversion_rate'], { params: { stage_conversion_rate: { fromStage: 'QUAL', toStage: 'VISIT', stageModelVersionId: 'sm1' } } }), { events: [], facts });
  deq(total(r, 'stage_conversion_rate'), { value: 1 / 3, numerator: 1, denominator: 3 }, 'j2 re-entered QUAL but counts once; j4 (other model) excluded');
  r = S.query(Q(['completed_stage_duration'], { params: { completed_stage_duration: { stageId: 'QUAL', stageModelVersionId: 'sm1' } } }), { events: [], facts });
  assert.equal(total(r, 'completed_stage_duration').extra.n, 2); assert.equal(r.series[0].total.extra.p50, (4 * 3600 + 3600) / 2);
  r = S.query({ ...Q(['current_stage_age'], { params: { current_stage_age: { stageId: 'QUAL', stageModelVersionId: 'sm1' } } }), timeRange: { from: RANGE.from, to: '2026-10-05T10:00:00Z' } }, { events: [], facts });
  assert.equal(total(r, 'current_stage_age').extra.n, 2, 'j2 and j3 still in QUAL'); assert.equal(total(r, 'current_stage_age').extra.p50, ((24 * 3600) + (43 * 3600)) / 2);
  r = S.query(Q(['stage_conversion_rate']), { events: [], facts }); assert.equal(r.metadata.quality.stage_conversion_rate.status, 'BLOCKED', 'stages must be chosen explicitly');
});

test('AnalyticsMedianTimeToFirstContact + AnalyticsLateArrivingEvent: system/sync events excluded; a contact that arrived Wednesday counts on Monday (occurredAt)', () => {
  const acq = [{ organizationId: ORG, journeyId: 'j1', acquiredAt: '2026-10-05T12:00:00Z' }, { organizationId: ORG, journeyId: 'j2', acquiredAt: '2026-10-05T12:00:00Z' }, { organizationId: ORG, journeyId: 'j3', acquiredAt: '2026-10-05T12:00:00Z' }];
  const tp = [{ organizationId: ORG, journeyId: 'j1', occurredAt: '2026-10-05T12:10:00Z', meaningful: true, system: true }, { organizationId: ORG, journeyId: 'j1', occurredAt: '2026-10-05T13:00:00Z', meaningful: true, ingestedAt: '2026-10-07T10:00:00Z' },
    { organizationId: ORG, journeyId: 'j2', occurredAt: '2026-10-05T15:00:00Z', meaningful: true }];
  const r = S.query(Q(['median_time_to_first_contact']), { events: [], facts: { FactCustomerAcquisition: acq, FactJourneyTouchpoint: tp } });
  const t = total(r, 'median_time_to_first_contact'); assert.equal(t.extra.n, 2); assert.equal(t.extra.censored, 1, 'j3 has no contact yet'); assert.equal(t.value, (3600 + 3 * 3600) / 2);
});

test('AnalyticsRecommendationToVisit + AnalyticsRecommendationToWinAssociation + AnalyticsSourceWinRate: association wording; UNKNOWN source stays UNKNOWN; small sensitive groups suppressed; coverage 62% → DEGRADED', () => {
  const m = S.current().metric('recommendation_to_visit_rate'); assert.ok(m.associationOnly); assert.match(m.name, /^Jornadas com recomendação/); assert.ok(m.caveats.some(c => /não diz que a recomendação causou/.test(c)));
  const rec = [{ organizationId: ORG, journeyId: 'j1', generatedAt: at(3) }, { organizationId: ORG, journeyId: 'j2', generatedAt: at(3) }];
  const st = [{ organizationId: ORG, journeyId: 'j1', toStageCategory: 'VISIT', occurredAt: at(6) }, { organizationId: ORG, journeyId: 'j2', toStageCategory: 'VISIT', occurredAt: at(2) }];
  assert.equal(total(S.query(Q(['recommendation_to_visit_rate']), { events: [], facts: { FactRecommendation: rec, FactJourneyStageTransition: st } }), 'recommendation_to_visit_rate').value, 0.5, 'visit before the recommendation does not count');
  const facts = { FactJourneyOutcome: outcomes(6, 4, { src: (i, w) => w ? (i < 4 ? 'META' : 'REFERRAL') : (i < 3 ? 'META' : null) }) };
  const r = S.query(Q(['journey_win_rate'], { dimensions: ['sourceCode'] }), { events: [], facts });
  const g = Object.fromEntries(r.series[0].groups.map(x => [x.dimensions.sourceCode, x.value]));
  deq(Object.keys(g).sort(), ['META', 'REFERRAL', 'UNKNOWN']); assert.equal(g.UNKNOWN, 0, 'UNKNOWN is its own bucket, never redistributed'); assert.equal(g.META, 4 / 7);
  assert.equal(r.metadata.quality.journey_win_rate.status, 'VALID', '90% attribution coverage');
  const low = { FactJourneyOutcome: outcomes(5, 3, { src: (i, w) => w && i < 5 ? 'META' : null }) };
  const rl = S.query(Q(['journey_win_rate'], { dimensions: ['sourceCode'] }), { events: [], facts: low });
  assert.equal(rl.metadata.quality.journey_win_rate.status, 'DEGRADED'); assert.ok(Math.abs(rl.metadata.quality.journey_win_rate.coverage - 0.625) < 1e-9, 'AnalyticsDataQualityDegraded');
  const rb = S.query(Q(['journey_win_rate'], { dimensions: ['ownerUserId'] }), { events: [], facts: { FactJourneyOutcome: outcomes(6, 4).map((x, i) => ({ ...x, ownerUserId: i < 8 ? 'usr_a' : 'usr_b' })) } });
  const gb = Object.fromEntries(rb.series[0].groups.map(x => [x.dimensions.ownerUserId, x]));
  assert.equal(gb.usr_b.value, null); assert.equal(gb.usr_b.suppressed, true, 'small cohort suppression on a sensitive dimension'); assert.equal(gb.usr_a.value, 6 / 8);
});

test('AnalyticsCampaignCohort: late win stays in the acquisition cohort; immature cohorts flagged; won-of-acquired is not the win rate', () => {
  const acq = [{ journeyId: 'a', acquiredAt: '2026-09-29T12:00:00Z' }, { journeyId: 'b', acquiredAt: '2026-09-30T12:00:00Z' }, { journeyId: 'c', acquiredAt: '2026-10-08T12:00:00Z' }].map(x => ({ ...x, organizationId: ORG }));
  const out = [{ organizationId: ORG, journeyId: 'a', outcomeType: 'CLOSED_WON', closedAt: '2026-10-09T12:00:00Z' }];
  const r = S.cohort('journeys_by_acquisition_week', { organizationId: ORG, timeRange: { from: '2026-09-28T03:00:00Z', to: '2026-10-12T03:00:00Z' } }, { events: [], facts: { FactCustomerAcquisition: acq, FactJourneyOutcome: out }, now: () => T0 });
  deq(r.rows.map(x => [x.cohort, x.acquired, x.won, x.immature]), [['2026-W40', 2, 1, true], ['2026-W41', 1, 0, true]]); assert.match(r.caveat, /não é journey_win_rate/);
});

/** local product events through a real client */
function productClient() {
  const { c, clock } = mk({ t: Date.parse('2026-10-10T13:00:00Z') });
  const step = ms => { clock.t += ms; };
  // session 1: opens, filters, views 2 lots, compares, opens matrix, shares
  c.track('filter_applied', { mode: 'QUICK', fieldKeys: ['area'] }); step(20000); c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A1' } }); step(5000);
  c.track('lot_selected', { selectionSource: 'LIST' }, { entity: { lotRef: 'B2' } }); c.track('comparison_candidate_added', { candidateCount: 1 }); c.track('comparison_opened', { candidateCount: 2 }); c.track('share_dialog_opened', { lotCount: 2 });
  // session 2 (after 40 min): zero result then one lot after 60 s
  step(40 * 60000); c.track('filter_applied', { mode: 'QUICK', fieldKeys: ['price'] }); c.track('filter_zero_result', { filterCount: 3 }); step(60000); c.track('lot_selected', { selectionSource: 'SEARCH' }, { entity: { lotRef: 'A1' } });
  // session 3: only legend (no lot)
  step(40 * 60000); c.track('legend_expanded', {});
  return { c, clock };
}
test('product metrics from the local buffer: sessions, lot views, distinct lots, rates with explicit denominators, median time to first lot (censored sessions excluded), unwired producers are "não disponível" (not 0)', () => {
  const { c, clock } = productClient(), now = () => clock.t;
  const r = S.query(Q(['product_sessions', 'lot_views', 'distinct_lots_viewed', 'lot_views_per_session', 'filter_usage_rate', 'filter_zero_result_rate', 'comparison_usage_rate', 'avg_candidates_per_comparison', 'time_to_first_lot_selection', 'share_preparations', 'deep_link_restore_success_rate', 'presentation_completion_rate']), { client: c, now });
  assert.equal(total(r, 'product_sessions').value, 3); assert.equal(total(r, 'lot_views').value, 3); assert.equal(total(r, 'distinct_lots_viewed').value, 2);
  deq(total(r, 'lot_views_per_session'), { value: 1, numerator: 3, denominator: 3 }); deq(total(r, 'filter_usage_rate'), { value: 2 / 3, numerator: 2, denominator: 3 });
  deq(total(r, 'filter_zero_result_rate'), { value: 0.5, numerator: 1, denominator: 2 }); assert.equal(total(r, 'comparison_usage_rate').value, 1 / 3); assert.equal(total(r, 'avg_candidates_per_comparison').value, 2);
  const t = total(r, 'time_to_first_lot_selection'); assert.equal(t.extra.n, 2); assert.equal(t.extra.censored, 1); assert.equal(t.value, 40);
  assert.equal(total(r, 'share_preparations').value, 1);
  assert.equal(r.metadata.quality.deep_link_restore_success_rate.status, 'BLOCKED'); assert.ok(r.metadata.quality.deep_link_restore_success_rate.issueCodes.includes('PRODUCER_NOT_WIRED')); assert.equal(total(r, 'deep_link_restore_success_rate').value, null);
  c.markWired(['deep_link_restored']); const r2 = S.query(Q(['deep_link_restore_success_rate', 'deep_link_restores']), { client: c, now });
  assert.equal(total(r2, 'deep_link_restores').value, 0, 'wired but none yet → 0'); assert.equal(total(r2, 'deep_link_restore_success_rate').value, null, '0/0 → N/A');
  assert.equal(r.metadata.quality.product_sessions.status, 'VALID'); assert.equal(r.metadata.quality.product_sessions.label, 'calculado');
});

test('AnalyticsPresentationCompletionRate: cohort of started sessions ∩ explicit completion (reaching the last step is not completion)', () => {
  const { c } = mk(), br = ET.createBridge(c), t = i => new Date(T0 - 3600000 + i * 1000).toISOString();
  br.ingest([{ type: 'PresentationStarted', at: t(0), sessionId: 'p1' }, { type: 'PresentationStarted', at: t(1), sessionId: 'p2' }, { type: 'PresentationStarted', at: t(2), sessionId: 'p3' }, { type: 'PresentationStepViewed', at: t(3), sessionId: 'p2', stepId: 'last' }, { type: 'PresentationCompleted', at: t(4), sessionId: 'p1' }]);
  const r = S.query({ ...Q(['presentation_completion_rate', 'presentations_started']), timeRange: { from: '2026-10-11T00:00:00Z', to: '2026-10-12T00:00:00Z' } }, { client: c, now: () => T0 });
  deq(total(r, 'presentation_completion_rate'), { value: 1 / 3, numerator: 1, denominator: 3 }); assert.equal(total(r, 'presentations_started').value, 3);
  const f = S.funnel('presentation_runtime', { organizationId: ORG, timeRange: { from: '2026-10-11T00:00:00Z', to: '2026-10-12T00:00:00Z' } }, { client: c, now: () => T0 });
  deq(f.steps.map(s => s.count), [3, 1, 0], 'STRICT: p1 completed without a step view, so it stops at step 1');
});

test('AnalyticsJourneyFunnel + product funnel: one entity per step (3 presentations = 1), first achievement, conversion from previous/first, drop-off; steps are never summed', () => {
  const tr = (j, cat, d) => ({ organizationId: ORG, journeyId: j, toStageCategory: cat, occurredAt: at(d) });
  const rows = [tr('j1', 'NEW', 2), tr('j1', 'CONTACTED', 3), tr('j1', 'PROFILED', 4), tr('j1', 'RECOMMENDATION', 5), tr('j1', 'PRESENTATION', 6), tr('j1', 'PRESENTATION', 7), tr('j1', 'PRESENTATION', 8), tr('j1', 'VISIT', 9),
    tr('j2', 'NEW', 2), tr('j2', 'CONTACTED', 3), tr('j3', 'NEW', 4), tr('j3', 'CONTACTED', 3), { organizationId: ORG_B, journeyId: 'jx', toStageCategory: 'NEW', occurredAt: at(2) }];
  const f = S.funnel('commercial_journey', { organizationId: ORG, timeRange: RANGE }, { events: [], facts: { FactJourneyStageTransition: rows } });
  deq(f.steps.map(s => s.count), [3, 3, 1, 1, 1, 1, 0, 0], 'NON_STRICT: j3 contacted before NEW still counts; other tenant excluded');
  assert.equal(f.steps[2].conversionFromPrevious, 1 / 3); assert.equal(f.steps[2].dropOff, 2); assert.equal(f.steps[6].conversionFromFirst, 0); assert.match(f.note, /não se somam/);
  assert.equal(S.funnel('commercial_journey', { organizationId: ORG, timeRange: RANGE }, { events: [] }).quality.status, 'BLOCKED');
  const { c, clock } = productClient();
  const p = S.funnel('product_lot_exploration', { organizationId: ORG, timeRange: RANGE }, { client: c, now: () => clock.t });
  deq(p.steps.map(s => s.count), [3, 2, 1, 1, 1]); assert.equal(p.steps[1].conversionFromFirst, 2 / 3);
});

test('AnalyticsTimezoneBoundary + daily series: 01:30 UTC on the 11th is the 10th in São Paulo; buckets per local day; comparison uses equal windows', () => {
  assert.equal(S.localDate(Date.parse('2026-10-11T01:30:00Z'), 'America/Sao_Paulo'), '2026-10-10');
  deq(S.dimDate('2026-10-11'), { date: '2026-10-11', day: 11, week: '2026-W41', month: '2026-10', quarter: '2026-Q4', year: 2026, dayOfWeek: 7, isWeekend: true });
  const { c } = mk({ t: Date.parse('2026-10-11T12:00:00Z') });
  c.track('lot_selected', { selectionSource: 'MAP' }, { occurredAt: '2026-10-11T01:30:00Z', entity: { lotRef: 'A1' } });
  c.track('lot_selected', { selectionSource: 'MAP' }, { occurredAt: '2026-10-11T04:00:00Z', entity: { lotRef: 'A2' } });
  const r = S.query({ organizationId: ORG, metricCodes: ['lot_views'], timeRange: { from: '2026-10-10T03:00:00Z', to: '2026-10-12T03:00:00Z' }, grain: 'DAY', comparisonPeriod: 'previous_period' }, { client: c, now: () => Date.parse('2026-10-11T12:00:00Z') });
  deq(r.series[0].points.map(p => [p.key, p.value]), [['2026-10-10', 1], ['2026-10-11', 1]]);
  const cmp = r.series[0].comparison; assert.equal(cmp.equalWindow, true); assert.equal(cmp.value, 0); assert.equal(cmp.delta, 2);
});

test('AnalyticsBackfillIdempotent + AnalyticsMetricVersionChange + AnalyticsCrossTenantIsolation: same input twice → same aggregates; pinned unknown version refused; tenant required; other tenants never aggregated', () => {
  const { c, clock } = productClient(), evs = c.events({ organizationId: ORG }), now = () => clock.t, q = Q(['lot_views', 'filter_usage_rate'], { grain: 'DAY' });
  const a = S.backfill({ query: q, events: evs, now }), b = S.backfill({ query: q, events: [...evs, ...evs], now });
  deq(a.aggregates.map(x => [x.metricCode, x.periodStart, x.value, x.numerator, x.denominator]), b.aggregates.map(x => [x.metricCode, x.periodStart, x.value, x.numerator, x.denominator]));
  assert.equal(b.inputEvents, evs.length * 2); assert.equal(b.uniqueEvents, evs.length); assert.equal(a.dryRun, true); assert.ok(a.aggregates[0].sourceWatermark && a.transformationVersion);
  assert.throws(() => S.query(Q(['lot_views'], { metricVersions: { lot_views: '2.0.0' } }), { events: evs }), e => e.code === 'UNSUPPORTED_METRIC_VERSION');
  assert.throws(() => S.query({ metricCodes: ['lot_views'], timeRange: RANGE }, { events: evs }), e => e.code === 'TENANT_REQUIRED');
  const foreign = evs.map(e => ({ ...e, eventId: e.eventId + '-b', organizationId: ORG_B }));
  assert.equal(total(S.query(Q(['lot_views']), { events: [...evs, ...foreign], now }), 'lot_views').value, 3);
  assert.equal(total(S.query(Q(['journey_win_rate']), { events: [], facts: { FactJourneyOutcome: [...outcomes(1, 1), { organizationId: ORG_B, journeyId: 'zz', outcomeType: 'CLOSED_WON', closedAt: at(10) }] } }), 'journey_win_rate').value, 0.5);
  assert.throws(() => S.query(Q(['lot_views'], { dimensions: ['ownerUserId'] }), { events: evs }), e => e.code === 'DIMENSION_NOT_ALLOWED');
  assert.throws(() => S.query(Q(['lot_views'], { filters: [{ dimension: 'sql', in: ['1=1'] }] }), { events: evs }), e => e.code === 'UNKNOWN_DIMENSION', 'no raw expressions: filters only over registered dimensions');
  assert.throws(() => S.query(Q(['drop_table']), { events: evs }), e => e.code === 'UNKNOWN_METRIC');
  const g = S.query(Q(['lot_views'], { dimensions: ['selectionSource'] }), { events: evs, now });
  deq(Object.fromEntries(g.series[0].groups.map(x => [x.dimensions.selectionSource, x.value])), { LIST: 1, MAP: 1, SEARCH: 1 });
});

test('data quality metrics and states: drop / quarantine / sampled-out rates from tracker health; sampled sources and truncated buffers are flagged; consent denied → incomplete', () => {
  const small = JSON.parse(JSON.stringify(App.configs.analytics.policy)); small.buffer.maxLocalEventsPerOrganization = 2;
  const c = ET.createClient({ now: () => T0, policy: small, context: () => ({ organizationId: ORG }) });
  for (let i = 0; i < 4; i++) c.track('lot_selected', { selectionSource: 'MAP' }, { entity: { lotRef: 'A' + i } });
  c.track('lot_selected', { selectionSource: 'NOPE' });
  const r = S.query({ ...Q(['analytics_event_drop_rate', 'analytics_quarantine_rate', 'lot_views']), timeRange: { from: '2026-10-11T00:00:00Z', to: '2026-10-12T00:00:00Z' } }, { client: c, now: () => T0 });
  deq(total(r, 'analytics_event_drop_rate'), { value: 2 / 5, numerator: 2, denominator: 5 }); assert.equal(total(r, 'analytics_quarantine_rate').value, 1 / 5);
  assert.equal(r.metadata.quality.lot_views.status, 'INCOMPLETE'); assert.ok(r.metadata.quality.lot_views.issueCodes.includes('BUFFER_TRUNCATED')); assert.ok(r.metadata.quality.lot_views.issueCodes.includes('QUARANTINED_SOURCE_EVENTS'));
  c.setConsent('DENIED'); assert.equal(S.query(Q(['lot_views']), { client: c, now: () => T0 }).metadata.quality.lot_views.status, 'INCOMPLETE');
  const lm = S.legacyInventory(); assert.ok(lm.length && lm.every(x => x.migrationAction && x.semanticConfidence));
});

test('"Métricas locais" view model: technical-mode only, says nothing is sent, all remote destinations off, KPI cards carry definition/version/quality, commercial metrics "não disponível", escaped HTML with data-act hooks', () => {
  const A = loadAll();
  A.analytics.track('lot_selected', { code: 'A1', from: 'map' }); A.analytics.track('filter_changed', { k: 'area' }); A.analytics.track('nope_<b>', {});
  assert.equal(A.metricsView.viewModel({ allowed: false }).allowed, false);
  assert.equal(A.analytics.view().allowed, A.authz.uiMode('technical').allowed, 'gated by mode.technical (deny by default)');
  const vm = A.analytics.view({ allowed: true, range: 'today' });
  assert.equal(vm.organizationId, ORG); assert.match(vm.banner, /Nada é enviado/);
  assert.ok(vm.destinations.filter(d => d.remote).every(d => d.status === 'desligado' && d.reason));
  const lv = vm.kpis.find(k => k.code === 'lot_views'); deq([lv.valueText, lv.valueLabel, lv.version], ['1', 'calculado', '1.0.0']); assert.ok(lv.definition && lv.timeBasis);
  assert.ok(vm.commercial.every(k => k.valueText === 'não disponível' && k.issues.includes('precisa dos dados do servidor')));
  assert.equal(vm.quarantine[0].reason, 'UNKNOWN_EVENT'); assert.equal(vm.health.quarantined, 1); assert.equal(vm.consent.state, 'UNKNOWN');
  assert.ok(vm.decisions.length >= 6 && vm.decisions.some(d => d.id === 'D3'));
  const h = A.analytics.html(vm);
  for (const act of ['analyticsRefresh', 'analyticsRange', 'analyticsClear']) assert.ok(h.includes(`data-act="${act}"`), act);
  assert.ok(h.includes('nope_&lt;b&gt;'), 'escaped'); assert.ok(!h.includes('nope_<b>'));
  assert.match(h, /<caption>/); assert.doesNotMatch(h, /valoriza|causou|ROI/i);
  assert.match(A.analytics.html({ allowed: false, message: 'x' }), /Métricas locais/);
});

test('generated docs and TypeScript types are up to date with the registries (run node scripts/analyticsDocs.js after changing config/analytics)', () => {
  const { generate, DOCS } = require('../scripts/analyticsDocs.js');
  for (const [f, content] of Object.entries(generate())) assert.equal(fs.readFileSync(path.join(DOCS, f), 'utf8'), content, `${f} is stale`);
});
