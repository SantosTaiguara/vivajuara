'use strict';
// Topic 42 — ShareService: opaque revocable tokens over client-safe snapshots. Golden scenarios named after the spec.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');
const BT = require('../backend/src/modules/share/share.tokens.js');

const MODULES = ['presentationmode/policy.js', 'presentationmode/projection.js', 'presentationmode/domain.js', 'presentationmode/runtime.js', 'presentationmode/presentationView.js', 'share/shareDomain.js', 'share/shareService.js', 'share/sharedShellView.js'];
let App, S, SS, D, repo, prepo, dev, src, svc;
const DEV = 'viva-juara', ORG = 'house7', NOW = '2026-10-09T10:00:00.000Z', ORIGIN = 'https://share.house7.example';
const at = (days = 0, mins = 0) => new Date(Date.parse(NOW) + days * 86400000 + mins * 60000).toISOString();
const ctx = (o = {}) => ({ organizationId: ORG, userId: 'u1', can: () => true, now: NOW, ...o });
const json = x => JSON.stringify(x);
const ids = (...c) => c.map(x => repo.getLotByCode(x).identity.id);
const MARIA = { id: 'C55', organizationId: ORG, name: 'Maria Souza', preferredName: 'Maria', email: 'maria@example.com', phone: '(27) 99999-1234', profile: { objective: 'housing', preferences: [] } };

test.before(async () => {
  App = load(); repo = App.repos.LotRepository(DEV); await repo.load();
  for (const f of MODULES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  S = App.share.domain; SS = App.share.service; D = App.presentationMode.domain;
  dev = App.config.DEVELOPMENTS.find(d => d.id === DEV); src = D.sourcesFromRepo(repo, dev, { customer: MARIA });
  prepo = D.createRepository();
});
const fresh = (o = {}) => SS.createShareService({ origin: ORIGIN, organization: { name: 'House 7' }, presentationRepo: prepo, pepper: 'test-pepper-0123456789', pbkdf2Iterations: 2000, ...o });
function snapshot(input = {}) {
  let d = D.createDefinition(ctx(), { developmentId: DEV, title: 'Seleção para você', lotIds: ids('A1', 'A2'), customerId: 'C55', ...input });
  d = D.applyTemplate(d, 'SHORTLIST', ctx());
  const r = D.createSnapshot(prepo, d, src, ctx(), { expectedDefinitionRevision: d.recordRevision }); assert.ok(r.ok, r.code);
  return { def: d, snap: r.snapshot };
}
const issue = (s, o = {}, c = ctx()) => svc.issue(c, { resourceType: 'PRESENTATION_SNAPSHOT', resourceId: s.id, forceNew: true, ...o });
const tokenOf = url => url.split('/s/')[1];

test.beforeEach(() => { svc = fresh(); });

// ---------------------------------------------------------------- token security
test('token: CSPRNG, 256 bits, opaque, unique; no Math.random fallback; never derived from ids', () => {
  const xs = new Set(Array.from({ length: 200 }, () => S.generateToken()));
  assert.equal(xs.size, 200); for (const t of xs) assert.match(t, S.TOKEN_RE);
  const prev = globalThis.crypto; Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try { assert.throws(() => S.generateToken(), e => e.code === 'TOKEN_RNG_UNAVAILABLE'); } finally { Object.defineProperty(globalThis, 'crypto', { value: prev, configurable: true }); }
});
test('SharePresentationSnapshotToCustomer: URL is /s/<token> only; store keeps hash+prefix, raw token only in the issuance result', async () => {
  const { snap } = snapshot(); const r = await issue(snap);
  assert.ok(r.ok, r.code); assert.match(r.url, /^https:\/\/share\.house7\.example\/s\/[A-Za-z0-9_-]{43}$/);
  for (const bad of ['C55', 'maria', '99999', 'VJ-QA', snap.id, 'customer', 'price', '?']) assert.ok(!r.url.toLowerCase().includes(bad.toLowerCase()), bad);
  const st = svc._store(), tok = tokenOf(r.url);
  assert.ok(!json(st).includes(tok), 'raw token never stored, logged or evented');
  assert.equal(st.tokens[0].tokenHash, await S.hashToken(tok, 'test-pepper-0123456789')); assert.equal(st.tokens[0].tokenPrefix, tok.slice(0, 4));
  const g = svc.getGrant(ctx(), r.grant.id); assert.ok(!json(g).includes(tok)); assert.equal(g.status, 'ACTIVE');
  assert.equal(r.grant.capabilities.includes('RESHARE'), false); assert.equal(r.grant.capabilities.includes('DOWNLOAD'), false);
  const ex = await svc.exchange(tok, { now: NOW }); assert.ok(ex.ok); assert.equal(ex.cleanRoute, '/shared/view'); assert.equal(ex.headers['Referrer-Policy'], 'no-referrer');
  const res = svc.resource(ex.sessionRef, { now: NOW }); assert.ok(res.ok);
  assert.equal(json(res.resource.content), json(snap.audience), 'content = snapshot audience payload');
  for (const bad of ['maria@example.com', '99999', 'C55', 'VJ-QA-L', 'sourceId', 'presenterHint', 'provenance', 'Souza']) assert.ok(!json(res.resource).includes(bad), bad);
  assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
});
test('URL validator rejects PII, ids, prices, query params; share origin must be https without params', () => {
  const t = S.generateToken();
  assert.deepEqual(S.validateShareUrl(`${ORIGIN}/s/${t}`), []);
  for (const u of [`${ORIGIN}/share?customerId=C55&lot=327&price=299000`, `${ORIGIN}/customer/C55/s/${t}`, `${ORIGIN}/s/${t}?x=1`, `${ORIGIN}/maria@x.com/s/${t}`, `${ORIGIN}/VJ-QA-L0001/s/${t}`, `http://x.com/s/${t}`])
    assert.ok(S.validateShareUrl(u).length > 0, u);
  assert.throws(() => S.shareUrl('http://x.com', t), e => e.code === 'INVALID_SHARE_ORIGIN'); assert.throws(() => S.shareUrl(ORIGIN + '?a=1', t));
  assert.equal(S.redactToken(`abriu ${ORIGIN}/s/${t}`), `abriu ${ORIGIN}/s/[token]`);
});
test('invalid / expired / revoked / suspended tokens share one generic public error (no enumeration)', async () => {
  const { snap } = snapshot(); const r = await issue(snap, { ttlSeconds: 3600 }); const tok = tokenOf(r.url);
  const msgs = [];
  msgs.push(await svc.exchange(S.generateToken(), { now: NOW })); msgs.push(await svc.exchange('short', { now: NOW }));
  msgs.push(await svc.exchange(tok, { now: at(0, 61) }));
  svc.suspend(ctx(), r.grant.id); msgs.push(await svc.exchange(tok, { now: NOW })); svc.resume(ctx(), r.grant.id);
  assert.ok((await svc.exchange(tok, { now: NOW })).ok);
  svc.revoke(ctx(), r.grant.id, 'USER_REVOKED'); msgs.push(await svc.exchange(tok, { now: NOW }));
  for (const m of msgs) { assert.equal(m.ok, false); assert.equal(m.publicError, 'LINK_INVALID_OR_UNAVAILABLE'); assert.match(m.message, /Este link não está mais disponível/); }
  assert.equal(new Set(msgs.map(m => m.message)).size, 1);
  const reasons = svc._store().records.filter(x => x.result === 'DENIED').map(x => x.reasonCode); // internal log keeps the exact reason
  for (const c of ['TOKEN_NOT_FOUND', 'TOKEN_FORMAT', 'GRANT_EXPIRED', 'GRANT_SUSPENDED', 'GRANT_REVOKED']) assert.ok(reasons.includes(c), c);
});
test('SharePresentationWithExpiry: finite TTL per policy, max enforced, no-expiry denied, client clock not trusted', async () => {
  const { snap } = snapshot(); const r = await issue(snap);
  assert.equal(r.expiresAt, at(7)); // presentation default 7 days
  await assert.rejects(issue(snap, { ttlSeconds: 31 * 86400 }), e => e.code === 'TTL_OUT_OF_POLICY');
  await assert.rejects(issue(snap, { ttlSeconds: Infinity }), e => e.code === 'EXPIRY_REQUIRED');
  assert.equal(S.policyFor('FINANCIAL_SIMULATION_RESULT').defaultTtlSeconds < S.policyFor('PRESENTATION_SNAPSHOT').defaultTtlSeconds, true, 'financial expires sooner');
  assert.throws(() => svc.changeExpiry(ctx({ can: undefined }), r.grant.id, at(10)), e => e.code === 'FORBIDDEN', 'extending needs share.extendExpiry (never granted locally; only a backend decision via ctx.can)');
  assert.ok(svc.changeExpiry(ctx({ can: k => k !== 'share.extendExpiry' }), r.grant.id, at(3)).expiresAt === at(3), 'shortening is fine');
});
test('SharePresentationRevoked: revocation is immediate for new access, active sessions, cache and assets; channel URL stays but is unusable', async () => {
  const { snap } = snapshot(); const r = await issue(snap); const tok = tokenOf(r.url);
  const ex = await svc.exchange(tok, { now: NOW }); assert.ok(svc.resource(ex.sessionRef, { now: NOW }).ok); assert.ok(svc.resource(ex.sessionRef, { now: NOW }).cached);
  svc.revoke(ctx(), r.grant.id, 'CUSTOMER_REQUEST');
  assert.equal(svc.resource(ex.sessionRef, { now: NOW }).publicError, 'LINK_INVALID_OR_UNAVAILABLE');
  assert.equal(svc.asset(ex.sessionRef, { id: 'img1', customerSpecific: true }, { now: NOW }).ok, false);
  assert.equal((await svc.exchange(tok, { now: NOW })).publicError, 'LINK_INVALID_OR_UNAVAILABLE');
  assert.equal(svc._store().revocations[0].reasonCode, 'CUSTOMER_REQUEST');
  assert.equal(S.validateShareUrl(r.url).length, 0, 'the URL itself is still well-formed — it just no longer authorizes');
});
test('SharePresentationSafetyRevoked: grant ACTIVE + snapshot REVOKED → RESOURCE_UNAVAILABLE; REVIEW_REQUIRED suspends by default', async () => {
  const { snap } = snapshot(); const r = await issue(snap); const tok = tokenOf(r.url);
  const ex = await svc.exchange(tok, { now: NOW }); assert.ok(ex.ok);
  D.safety.mark(ORG, snap.id, 'REVIEW_REQUIRED', ['DATA_CORRECTION']);
  assert.equal((await svc.exchange(tok, { now: NOW })).publicError, 'RESOURCE_UNAVAILABLE');
  assert.equal(svc.resource(ex.sessionRef, { now: NOW }).ok, false, 'active session re-evaluated');
  D.safety.mark(ORG, snap.id, 'REVOKED', ['SECURITY_POLICY_CHANGE']);
  const x = await svc.exchange(tok, { now: NOW }); assert.equal(x.publicError, 'RESOURCE_UNAVAILABLE'); assert.match(x.message, /precisa ser atualizada/);
  assert.equal(svc.getGrant(ctx(), r.grant.id).status, 'ACTIVE', 'grant status alone is not enough');
  const r2 = await issue(snap); assert.equal(r2.ok, false); assert.equal(r2.code, 'RESOURCE_NOT_SAFE');
});
test('ShareOneTimeLink + ShareBotPreviewDoesNotConsumeToken: preview bots get generic metadata only; consumption needs human confirmation', async () => {
  const { snap } = snapshot(); const r = await issue(snap, { accessMode: 'ONE_TIME_TOKEN' }); const tok = tokenOf(r.url);
  const bot = await svc.exchange(tok, { now: NOW, userAgentClass: 'WhatsApp/2.23 preview' });
  assert.equal(bot.preview, true); assert.equal(bot.metadata.title, 'Apresentação House 7'); assert.equal(bot.metadata.robots, 'noindex, nofollow'); assert.doesNotMatch(json(bot), /Maria|R\$|Seleção para você/);
  const pending = await svc.exchange(tok, { now: NOW }); assert.equal(pending.requiresConfirmation, true);
  assert.equal(svc.getGrant(ctx(), r.grant.id).accessCount, 0, 'not consumed by bot nor by the interstitial');
  const ok = await svc.exchange(tok, { now: NOW, confirm: true }); assert.ok(ok.ok);
  assert.ok(svc.resource(ok.sessionRef, { now: NOW }).ok, 'refresh inside the session works');
  assert.equal((await svc.exchange(tok, { now: NOW, confirm: true })).publicError, 'LINK_INVALID_OR_UNAVAILABLE');
  assert.equal(svc.getGrant(ctx(), r.grant.id).status, 'CONSUMED');
});
test('ShareConcurrentOneTimeAccess: two simultaneous confirmations → exactly one session', async () => {
  const { snap } = snapshot(); const r = await issue(snap, { accessMode: 'ONE_TIME_TOKEN' }); const tok = tokenOf(r.url);
  const xs = await Promise.all([svc.exchange(tok, { now: NOW, confirm: true }), svc.exchange(tok, { now: NOW, confirm: true }), svc.exchange(tok, { now: NOW, confirm: true })]);
  assert.equal(xs.filter(x => x.ok).length, 1); assert.equal(svc.getGrant(ctx(), r.grant.id).accessCount, 1);
});
test('ShareTokenPlusPasscode: hashed + salted, independent from token, wrong code counted, lockout; email/phone refused as passcode', async () => {
  const { snap } = snapshot();
  assert.equal((await issue(snap, { accessMode: 'TOKEN_PLUS_PASSCODE', passcode: 'maria@example.com' })).code, 'PASSCODE_LOOKS_LIKE_PII');
  assert.equal((await issue(snap, { accessMode: 'TOKEN_PLUS_PASSCODE', passcode: '27999991234' })).code, 'PASSCODE_LOOKS_LIKE_PII');
  assert.equal((await issue(snap, { accessMode: 'TOKEN_PLUS_PASSCODE', passcode: '123' })).code, 'PASSCODE_TOO_SHORT');
  const r = await issue(snap, { accessMode: 'TOKEN_PLUS_PASSCODE', passcode: 'lagoa-482' }); const tok = tokenOf(r.url);
  assert.ok(!json(svc._store()).includes('lagoa-482'));
  assert.equal((await svc.exchange(tok, { now: NOW })).publicError, 'PASSCODE_REQUIRED');
  assert.equal((await svc.exchange(tok, { now: NOW, passcode: 'errado-1' })).publicError, 'PASSCODE_INVALID');
  assert.ok((await svc.exchange(tok, { now: NOW, passcode: 'lagoa-482' })).ok);
  for (let i = 0; i < 5; i++) await svc.exchange(tok, { now: NOW, passcode: 'errado-' + i });
  const locked = await svc.exchange(tok, { now: NOW, passcode: 'lagoa-482' }); assert.equal(locked.publicError, 'PASSCODE_INVALID', 'locked even with the right code');
  assert.ok((await svc.exchange(tok, { now: at(0, 16), passcode: 'lagoa-482' })).ok, 'lockout expires');
  assert.ok(svc._store().audits.some(a => a.type === 'SharePasscodeFailed'));
});
test('rate limiting: invalid-token attempts per client ref are limited (generic error), without storing raw IPs', async () => {
  for (let i = 0; i < 10; i++) await svc.exchange(S.generateToken(), { now: NOW, clientRef: 'h:abc' });
  const { snap } = snapshot(); const r = await issue(snap);
  assert.equal((await svc.exchange(tokenOf(r.url), { now: NOW, clientRef: 'h:abc' })).publicError, 'LINK_INVALID_OR_UNAVAILABLE');
  assert.ok((await svc.exchange(tokenOf(r.url), { now: at(0, 2), clientRef: 'h:abc' })).ok, 'window slides');
  assert.ok(!json(svc._store().records).match(/\d+\.\d+\.\d+\.\d+/));
});
test('access count: counts session starts only; refresh and assets do not increment; max count denies', async () => {
  const { snap } = snapshot(); const r = await issue(snap, { maxAccessCount: 2 }); const tok = tokenOf(r.url);
  const a = await svc.exchange(tok, { now: NOW }); svc.resource(a.sessionRef, { now: NOW }); svc.resource(a.sessionRef, { now: NOW }); svc.asset(a.sessionRef, { id: 'logo', generic: true }, { now: NOW });
  assert.equal(svc.getGrant(ctx(), r.grant.id).accessCount, 1);
  assert.ok((await svc.exchange(tok, { now: NOW })).ok);
  const x = await svc.exchange(tok, { now: NOW }); assert.equal(x.publicError, 'ACCESS_LIMIT_REACHED');
  const sessionExpired = svc.resource(a.sessionRef, { now: at(0, 31) }); assert.equal(sessionExpired.ok, false, 'share sessions are short-lived');
});
test('ShareStaleAvailabilityWithWarning + ShareBlockedByStaleCommercialPolicy: presentation shows caveat; financial policy blocks stale', async () => {
  const { snap } = snapshot(); const r = await issue(snap); const ex = await svc.exchange(tokenOf(r.url), { now: at(2) });
  assert.ok(ex.ok); assert.ok(ex.warnings.includes('Disponibilidade sujeita a confirmação.'));
  const res = svc.resource(ex.sessionRef, { now: at(2) }); assert.ok(res.resource.warnings.some(w => /preparada há 2 dias/.test(w))); assert.equal(res.resource.freshness.commercialDataMayBeOutdated, true);
  const fin = S.buildGrant({ id: 'shd_x', organizationId: ORG, resourceType: 'FINANCIAL_SIMULATION_RESULT', resourceId: 'S1', accessMode: 'TOKEN', audienceType: 'CUSTOMER', policyId: S.POLICIES.FINANCIAL_CUSTOMER.id, lifecycleStatus: 'ACTIVE' }, ctx());
  assert.equal(S.evaluateAccess({ grant: fin, now: NOW, safetyStatus: 'SAFE', freshness: { commercialDataMayBeOutdated: true } }).publicError, 'RESOURCE_UNAVAILABLE');
  assert.equal(S.evaluateAccess({ grant: fin, now: NOW, safetyStatus: 'SAFE', freshness: { pricingStale: true } }).denialReasonCodes.slice(-1)[0], 'PRICING_STALE');
  assert.equal(S.evaluateAccess({ grant: fin, now: NOW, safetyStatus: 'SAFE', freshness: {} }).allowed, true);
  assert.equal(S.buildGrant({ id: 'x', organizationId: ORG, resourceType: 'FINANCIAL_SIMULATION_RESULT', policyId: S.POLICIES.FINANCIAL_CUSTOMER.id, accessMode: 'TOKEN', audienceType: 'CUSTOMER', lifecycleStatus: 'ACTIVE' }, ctx()).expiresAt, at(2));
});
test('ShareCustomerSafeLotSnapshot: lot share uses a client-safe snapshot (no canonical lot, no internal id, table price only)', async () => {
  const lot = repo.getLotByCode('B79'); const ls = svc.createLotSnapshot(ctx(), lot, src);
  assert.ok(ls.ok); assert.ok(Object.isFrozen(ls.snapshot)); assert.equal(ls.snapshot.content.identity.lotRef, 'B79');
  assert.doesNotMatch(json(ls.snapshot.content), /VJ-Q|intelligence|scores|provenance|sourceId/); assert.equal(ls.snapshot.content.price.kind, 'TABLE_PRICE');
  assert.equal(ls.snapshot.content.availability.state, 'STATUS_CONFIRMATION_REQUIRED');
  const r = await svc.issue(ctx(), { resourceType: 'LOT_SNAPSHOT', resourceId: ls.snapshot.id }); assert.ok(r.ok, r.code);
  const ex = await svc.exchange(tokenOf(r.url), { now: NOW }); const res = svc.resource(ex.sessionRef, { now: NOW });
  assert.equal(json(res.resource.content), json(ls.snapshot.content));
  svc.onDomainEvent({ type: 'LotSnapshotRevoked', organizationId: ORG, snapshotId: ls.snapshot.id });
  assert.equal(svc.resource(ex.sessionRef, { now: NOW }).ok, false);
});
test('ShareComparisonSnapshot / raw objects / ShareDocumentDeniedByClassification: only client-safe resources with a resolver are shareable', async () => {
  for (const t of ['DOCUMENT', 'RECOMMENDATION_RESULT', 'CUSTOM_CLIENT_SAFE_RESOURCE']) { const r = await svc.issue(ctx(), { resourceType: t, resourceId: 'x' }); assert.equal(r.ok, false, t); }
  assert.deepEqual([...S.POLICIES.DOCUMENT_DENY.allowedResourceTypes], []);
  assert.equal((await svc.issue(ctx(), { resourceType: 'LOT', resourceId: ids('A1')[0] })).ok, false, 'canonical Lot is never shareable');
  assert.ok(S.policyFor('COMPARISON_SNAPSHOT'), 'comparison snapshots have a policy (resolver pending a ComparisonShareSnapshot factory)');
});
test('ShareCopyLink + ShareWhatsAppPayload + ShareEmailPayload + ShareQRCode + native fallback: payloads only, no price/status/PII by default', async () => {
  const { snap } = snapshot(); const r = await issue(snap);
  const cp = svc.channelPayload(ctx(), { grantId: r.grant.id, channel: 'COPY_LINK', url: r.url }); assert.equal(cp.payload.url, r.url); assert.equal(cp.journeyEvent, null, 'copy ≠ sent');
  const wa = svc.channelPayload(ctx(), { grantId: r.grant.id, channel: 'WHATSAPP', url: r.url, recipientFirstName: 'Maria Souza' });
  assert.match(wa.payload.message, /^Preparei uma apresentação com algumas opções para você\.\nAcesse pelo link abaixo:\nhttps:/); assert.ok(wa.payload.actionUrl.startsWith('https://wa.me/?text='));
  assert.doesNotMatch(wa.payload.message, /Maria|R\$|Disponível|\d{3}\.\d{3}/); assert.doesNotMatch(wa.payload.actionUrl, /phone=|\d{10,}/);
  const em = svc.channelPayload(ctx(), { grantId: r.grant.id, channel: 'EMAIL', url: r.url }); assert.ok(em.payload.actionUrl.startsWith('mailto:?subject=')); assert.equal(em.payload.title, 'Apresentação House 7');
  const qr = svc.channelPayload(ctx(), { grantId: r.grant.id, channel: 'QR_CODE', url: r.url }); assert.equal(qr.payload.qrData, r.url); assert.equal(qr.payload.textAlternative, r.url); assert.ok(qr.payload.warnings.includes(SS.QR_WARNING));
  const nat = svc.channelPayload(ctx(), { grantId: r.grant.id, channel: 'NATIVE_SHARE', url: r.url }); assert.equal(nat.payload.fallback, 'COPY_LINK');
  assert.equal(SS.canNativeShare({}), false); assert.equal(SS.canNativeShare({ share() {} }), true);
  assert.equal(svc.channelPayload(ctx(), { grantId: r.grant.id, channel: 'WHATSAPP', url: `${ORIGIN}/share?customerId=C55` }).code, 'UNSAFE_SHARE_URL');
  assert.equal(svc.channelPayload(ctx({ can: () => false }), { grantId: r.grant.id, channel: 'COPY_LINK', url: r.url }).code, 'FORBIDDEN');
  assert.ok(wa.payload.warnings.some(w => /não é pessoal/.test(w)), 'ShareLinkForwardingLimitation stated, no DRM promise');
  assert.deepEqual(SS.validateTemplate({ template: 'Lote 327 disponível por R$ 299 mil {shareUrl}', allowedVariables: ['shareUrl'] }), ['COMMERCIAL_FACT_IN_TEMPLATE']);
  assert.ok(SS.validateTemplate({ template: '{customerPhone}', allowedVariables: ['shareUrl'] })[0].startsWith('VARIABLE_NOT_ALLOWED'));
  assert.throws(() => SS.renderTemplate({ template: '<b>{shareUrl}</b>', allowedVariables: ['shareUrl'] }, { shareUrl: 'u' }), e => e.code === 'INVALID_TEMPLATE');
  const named = SS.renderTemplate(SS.TEMPLATES.WHATSAPP.template ? { ...SS.TEMPLATES.WHATSAPP, template: 'Olá, {recipientFirstName}! {shareUrl}' } : null, { shareUrl: 'u', recipientFirstName: 'Maria <script> Souza' }, { allowRecipientName: true });
  assert.equal(named.text, 'Olá, Maria! u', 'first name only, escaped, only when policy allows');
  assert.equal(svc.markAsSent(ctx(), r.grant.id).type, 'PRESENTATION_SHARED');
});
test('ShareTokenRotation + version stability: new grant/token for the same snapshot; old revoked; corrected snapshot needs a new share', async () => {
  const { def, snap } = snapshot(); const r = await issue(snap); const old = tokenOf(r.url);
  const r2 = await svc.rotate(ctx(), r.grant.id); assert.ok(r2.ok); assert.notEqual(tokenOf(r2.url), old); assert.notEqual(r2.grant.id, r.grant.id);
  assert.equal(svc.getGrant(ctx(), r.grant.id).status, 'REVOKED'); assert.equal((await svc.exchange(old, { now: NOW })).ok, false);
  const ex = await svc.exchange(tokenOf(r2.url), { now: NOW }); assert.equal(json(svc.resource(ex.sessionRef, { now: NOW }).resource.content), json(snap.audience));
  const d2 = D.revise(def, { title: 'Versão corrigida' }, def.recordRevision, ctx()); const s2 = D.createSnapshot(prepo, d2, src, ctx(), { expectedDefinitionRevision: d2.recordRevision }).snapshot;
  assert.equal(svc.resource(ex.sessionRef, { now: NOW }).resource.content.title, 'Seleção para você', 'old link stays on the old snapshot');
  const r3 = await issue(s2); assert.notEqual(r3.grant.id, r2.grant.id);
});
test('duplicate share prevention: an active grant for the same resource/binding asks instead of silently issuing', async () => {
  const { snap } = snapshot(); assert.ok((await svc.issue(ctx(), { resourceType: 'PRESENTATION_SNAPSHOT', resourceId: snap.id })).ok);
  const again = await svc.issue(ctx(), { resourceType: 'PRESENTATION_SNAPSHOT', resourceId: snap.id });
  assert.equal(again.code, 'ACTIVE_GRANT_EXISTS'); assert.equal(again.message, 'Já existe um link ativo. Copiar existente ou criar novo?'); assert.ok(!('token' in again.existing));
});
test('ShareCrossTenantDenied + permissions: other tenant, no share.issue, no resource access, IDOR on management, tenant suspension', async () => {
  const { snap } = snapshot();
  assert.equal((await issue(snap, {}, ctx({ organizationId: 'org2' }))).ok, false);
  assert.equal((await issue(snap, {}, ctx({ can: k => !k.startsWith('share.') }))).code, 'FORBIDDEN');
  assert.equal((await issue(snap, {}, ctx({ can: k => k !== 'presentation.read' }))).ok, false, 'cannot share what you cannot read');
  const r = await issue(snap);
  assert.equal(svc.getGrant(ctx({ organizationId: 'org2' }), r.grant.id), null); assert.throws(() => svc.revoke(ctx({ organizationId: 'org2' }), r.grant.id), e => e.code === 'NOT_FOUND');
  assert.equal(S.PERMISSIONS['share.overridePolicy'], null); assert.equal(S.can({}, 'share.unknown'), false);
  svc.onDomainEvent({ type: 'OrganizationSuspended', organizationId: ORG });
  assert.equal((await svc.exchange(tokenOf(r.url), { now: NOW })).publicError, 'LINK_INVALID_OR_UNAVAILABLE');
  svc.onDomainEvent({ type: 'OrganizationReactivated', organizationId: ORG }); assert.ok((await svc.exchange(tokenOf(r.url), { now: NOW })).ok);
});
test('ShareFeedbackIntent: scoped to session + CSRF, forged customerId ignored, capability-gated, profile untouched', async () => {
  const { snap } = snapshot(); const r = await issue(snap, { audienceBinding: { customerId: 'C55' } }); const ex = await svc.exchange(tokenOf(r.url), { now: NOW });
  assert.equal(svc.feedback(ex.sessionRef, { type: 'LIKED', lotRef: 'A1' }, { now: NOW }).reason, 'CSRF');
  const f = svc.feedback(ex.sessionRef, { type: 'LIKED', lotRef: 'A1', customerId: 'C99', csrfToken: ex.csrfToken }, { now: NOW });
  assert.ok(f.ok); assert.equal(f.intent.customerId, 'C55', 'binding resolved server-side'); assert.equal(f.profileChanged, false); assert.equal(f.journeyEvent.type, 'PRESENTATION_FEEDBACK');
  assert.equal(svc.feedback(ex.sessionRef, { type: 'LIKED', lotRef: 'Z9', csrfToken: ex.csrfToken }, { now: NOW }).reason, 'LOT_NOT_IN_RESOURCE');
  assert.equal(svc.feedback(ex.sessionRef, { type: 'HARD_CONSTRAINT', csrfToken: ex.csrfToken }, { now: NOW }).reason, 'INVALID_FEEDBACK_TYPE');
  assert.equal(json(MARIA.profile), json({ objective: 'housing', preferences: [] }));
});
test('assets: customer-specific via proxy with session; generic logo public; signed URLs shorter than the grant', async () => {
  const { snap } = snapshot(); const r = await issue(snap, { ttlSeconds: 3600 });
  const g = svc._store().grants.find(x => x.id === r.grant.id);
  assert.equal(S.assetAccess({ generic: true }, g).mode, 'PUBLIC_STATIC_SAFE_ASSET');
  assert.equal(S.assetAccess({ customerSpecific: true, generic: true }, g).mode, 'PROXY_AUTHORIZED');
  const sg = S.assetAccess({ signed: true }, g, { now: NOW }); assert.equal(sg.mode, 'SHORT_LIVED_SIGNED_URL'); assert.ok(sg.ttlSeconds <= 300);
  assert.equal(svc.asset('nope', { id: 'x' }, { now: NOW }).ok, false, 'private asset requires a share session');
});
test('entry point: initial view state is schema-validated and client-safe (no arbitrary app state)', () => {
  const a = { resourceType: 'PRESENTATION_SNAPSHOT', resourceId: 'prs_1' };
  assert.equal(S.entryPoint(a, { step: 'st2', lotRef: 'A1' }, { lotRefs: ['A1'], stepIds: ['st2'] }).routeType, 'PRESENTATION');
  assert.throws(() => S.entryPoint(a, { filters: { budget: 300000 } }), e => e.code === 'INVALID_VIEW_STATE');
  assert.throws(() => S.entryPoint(a, { lotRef: 'B79' }, { lotRefs: ['A1'] }), e => e.code === 'LOT_NOT_IN_RESOURCE');
});
test('management view and shared shell: masked link only, statuses, no admin UI, generic OG/noindex', async () => {
  const { snap } = snapshot(); const r = await issue(snap); const g = svc._store().grants.find(x => x.id === r.grant.id);
  const vm = S.linkStatusVM(g, { now: NOW, tokenPrefix: r.grant.tokenPrefix }); assert.equal(vm.statusLabel, 'Ativo'); assert.ok(!json(vm).includes(tokenOf(r.url)));
  assert.equal(S.linkStatusVM(g, { now: at(6, 1) }).statusLabel.startsWith('Expira em'), true);
  const ex = await svc.exchange(tokenOf(r.url), { now: NOW }); const html = App.sharedShellView.shell(svc.resource(ex.sessionRef, { now: NOW }).resource);
  assert.match(html, /House 7/); assert.doesNotMatch(html, /data-act="(mode|present|shareCust|customer|devSel)"/); assert.doesNotMatch(html, /Maria Souza|maria@/);
  assert.match(App.sharedShellView.headMeta(S.previewMetadata('GENERIC', { name: 'House 7' })), /noindex, nofollow/);
  assert.match(App.sharedShellView.links([vm]), /Revogar/);
});
test('legacy link inventory flags the WhatsApp text with customer name/price (REPLACE) and internal deep links (WRAP)', () => {
  const wa = S.LEGACY_INVENTORY.find(x => /whatsappUrl/.test(x.location)); assert.equal(wa.migrationAction, 'REPLACE'); assert.equal(wa.exposesPII, true);
  assert.ok(S.LEGACY_INVENTORY.filter(x => x.migrationAction === 'WRAP').length >= 2);
  // the existing services/share.js API is untouched (additive topic)
  assert.equal(App.services.share.deepLink('https://a/b', 'viva-juara.lots.A1'), 'https://a/b#viva-juara.lots.A1');
});
test('backend token module: HMAC with pepper, constant-time verify, scrypt passcode, no pepper → refuses', () => {
  const t = BT.generateToken(); assert.match(t, BT.TOKEN_RE);
  const h = BT.hashToken(t, 'pepper-0123456789abcdef'); assert.equal(h.length, 64); assert.ok(BT.verifyTokenHash(t, h, 'pepper-0123456789abcdef')); assert.ok(!BT.verifyTokenHash(BT.generateToken(), h, 'pepper-0123456789abcdef'));
  assert.notEqual(BT.hashToken(t, 'other-pepper-0123456789'), h);
  const saved = process.env.SHARE_TOKEN_PEPPER; delete process.env.SHARE_TOKEN_PEPPER;
  try { assert.throws(() => BT.hashToken(t), e => e.code === 'SHARE_PEPPER_MISSING'); } finally { if (saved != null) process.env.SHARE_TOKEN_PEPPER = saved; }
  const p = BT.hashPasscode('lagoa-482'); assert.ok(BT.verifyPasscode('lagoa-482', p)); assert.ok(!BT.verifyPasscode('lagoa-483', p)); assert.notEqual(BT.hashPasscode('lagoa-482').salt, p.salt);
  assert.equal(BT.redactToken('/s/' + t), '/s/[token]');
});
test('events: analytics boundary has no tokens/PII; copy link does not claim "sent"', async () => {
  const { snap } = snapshot(); const r = await issue(snap); const ex = await svc.exchange(tokenOf(r.url), { now: NOW }); svc.resource(ex.sessionRef, { now: NOW });
  const st = svc._store(); const types = st.events.map(e => e.type);
  for (const t of ['share_created', 'share_opened', 'share_session_started', 'share_resource_viewed']) assert.ok(types.includes(t), t);
  assert.ok(!json(st.events).includes(tokenOf(r.url))); assert.doesNotMatch(json([st.events, st.audits, st.records]), /Maria|maria@|99999/);
  assert.equal(S.journeyEventFor('LINK_COPIED', { resourceType: 'PRESENTATION_SNAPSHOT' }), null);
});
