'use strict';
// Topic 50 — platform security regression suite (frontend + shared pure code + backend pure middleware/validation; no DB).
// Golden scenarios of §346 that can run locally, the stored-XSS findings of the topic-50 audit, CSP/headers, storage policy,
// redaction, uploads/archives, SSRF, rate limits, high-risk actions, idempotency, webhooks, secrets and supply chain.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const { load, SRC } = require('./harness.js');
const PLAT = path.join(__dirname, '..');
const H_SRC = fs.readFileSync(path.join(SRC, 'security/hardening.js'), 'utf8');
const UI = ['presentation/dom.js', 'presentation/compareView.js', 'presentation/pricingView.js', 'presentation/securityView.js', 'presentation/dataTrustView.js', 'presentation/favoritesView.js',
  'customer/customerView.js', 'presentationmode/presentationView.js', 'share/sharedShellView.js', 'presentation/panels.js', 'presentation/overlays.js'];
// hardening is in the harness ORDER (vm realm); re-install it in this realm so deepStrictEqual compares same-realm objects
const withH = App => { new Function('App', H_SRC)(App); return App; };
const fresh = () => withH(load());
const clone = x => JSON.parse(JSON.stringify(x));
const P = tag => `"><img src=x onerror="window.__xss='${tag}'">`;
const XSS_RE = /<img src=x|onerror=|<svg onload/i;

/** a restored-state payload with markup in every field the audit found rendered without esc() */
function poisoned() {
  const f = {}; for (const k of ['areaMin', 'areaMax', 'pricePerM2Min', 'pricePerM2Max', 'frontMin', 'frontMax', 'depthMin', 'depthMax', 'q', 'block']) f[k] = P(k);
  f.statuses = [P('st'), 'AVAILABLE']; f.priceMin = '450000';
  return { activeFilters: f, constraints: { areaMin: P('ca'), areaMax: '700', budgetMax: P('cb'), noCorner: true, blocks: ['B', P('blk')] }, preferences: { quiet: 3, privacy: P('pp'), view: 9 },
    solar: { season: P('ss'), hour: P('h'), onMap: true }, simulation: { downPaymentPct: P('dp'), planId: 'P144', expanded: false }, baseMapBlend: P('bl'), layerOpacities: { a: 0.5, b: P('op') },
    currentLotId: P('lot'), comparisonLotIds: ['VJ-QB-L0079', P('c')], favorites: ['B79', P('f')], scoreKey: P('sk'),
    customers: [{ id: 'c1', name: '<b>Ana</b>', lots: ['VJ-QB-L0079', P('cl')], profile: { preferences: { quiet: P('x') }, constraints: { areaMin: P('pa') }, activePreset: null, objective: null } }, { id: P('bad'), name: 'x', lots: [] }] };
}

// ------------------------------------------------------------ registries
test('topic-50 registries load and validate (threat model covers every required flow, policies well formed)', () => {
  const App = fresh(), H = App.securityHardening, s = App.configs.security;
  for (const k of ['browserPolicy', 'threatModel', 'dataClassification', 'highRiskActions', 'rateLimits', 'securityEvents', 'uploadPolicy', 'tokenTypes', 'secretsCatalog', 'legacyInventory']) assert.ok(s[k], k);
  assert.deepEqual(clone(H.validate()), []);
  assert.deepEqual(clone(App.permissions.validate()), [], 'topic-30 registry still valid');
  const tm = H.threatModel(); assert.ok(tm.threats.length >= 15);
  for (const flow of tm.requiredFlows) assert.ok(tm.threats.some(t => t.flows.includes(flow)), flow);
  for (const t of H.tokenTypes()) assert.ok(t.type && t.where, t.type);
  assert.equal(new Set(H.tokenTypes().map(t => t.type)).size, H.tokenTypes().length, 'one role per token type');
  assert.equal(H.classificationOf('ApiSecret'), 'SECRET'); assert.equal(H.classificationOf('CustomerDocument'), 'RESTRICTED'); assert.equal(H.classificationOf('nope'), null);
  for (const sct of s.secretsCatalog.secrets) assert.ok(!('value' in sct) && !('secret' in sct), 'SecretMetadata never holds the value');
});

// ------------------------------------------------------------ output encoding
test('SecurityXssCustomerNoteEscaped: escapeHtml neutralizes text and attribute contexts; safeUrl only allows https/relative', () => {
  const { escapeHtml, safeUrl, isMarkupFree, safeToken } = fresh().securityHardening;
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml(`" onfocus='x' \``), '&quot; onfocus=&#39;x&#39; &#96;');
  assert.equal(escapeHtml(null), ''); assert.equal(escapeHtml(0), '0');
  assert.equal(safeUrl('javascript:alert(1)'), null); assert.equal(safeUrl('data:text/html,<b>'), null); assert.equal(safeUrl('//evil.example/x'), null);
  assert.equal(safeUrl('https://u:p@evil.example/'), null); assert.equal(safeUrl('img/01.webp'), 'img/01.webp');
  assert.equal(safeUrl('https://wa.me/?text=oi'), 'https://wa.me/?text=oi');
  assert.equal(safeUrl('https://x.example/', { allowHosts: ['wa.me'] }), null);
  assert.ok(isMarkupFree('Quadra B, lote 79')); assert.ok(!isMarkupFree('a"b')); assert.ok(!isMarkupFree('x onload=1'));
  assert.ok(safeToken('VJ-QB-L0079')); assert.ok(!safeToken('<b>')); assert.ok(!safeToken(''));
});

// ------------------------------------------------------------ the audit's stored-XSS findings
test('scrubRestoredState types every restored value: markup dropped, numeric strings coerced, legit values kept, INITIAL untouched', () => {
  const App = fresh(), H = App.securityHardening, before = clone(App.store.INITIAL), st = { ...clone(App.store.INITIAL), ...poisoned() };
  const r = H.scrubRestoredState(st, App.store.INITIAL);
  assert.ok(!XSS_RE.test(JSON.stringify({ ...st, customers: st.customers.map(c => ({ ...c, name: '' })) })), 'no markup survives outside the escaped customer name');
  assert.equal(st.activeFilters.priceMin, 450000, 'numeric string → number');
  assert.equal(st.activeFilters.areaMin, undefined); assert.equal(st.activeFilters.block, undefined); assert.deepEqual(st.activeFilters.statuses, ['AVAILABLE']);
  assert.equal(st.constraints.areaMax, 700); assert.equal(st.constraints.noCorner, true); assert.deepEqual(st.constraints.blocks, ['B']); assert.equal(st.constraints.areaMin, undefined);
  assert.deepEqual(st.preferences, { quiet: 3 });
  assert.equal(st.solar.hour, App.store.INITIAL.solar.hour); assert.equal(st.solar.season, App.store.INITIAL.solar.season);
  assert.equal(st.simulation.downPaymentPct, App.store.INITIAL.simulation.downPaymentPct); assert.equal(st.baseMapBlend, App.store.INITIAL.baseMapBlend);
  assert.deepEqual(st.layerOpacities, { a: 0.5 }); assert.equal(st.currentLotId, null); assert.deepEqual(st.comparisonLotIds, ['VJ-QB-L0079']); assert.deepEqual(st.favorites, ['B79']);
  assert.equal(st.customers.length, 1); assert.deepEqual(st.customers[0].lots, ['VJ-QB-L0079']); assert.deepEqual(st.customers[0].profile.preferences, {}); assert.deepEqual(st.customers[0].profile.constraints, {});
  assert.deepEqual(r.piiFields, ['customers[].name'], 'PII in localStorage is reported (decision D50-1), not silently deleted');
  assert.ok(r.dropped.includes('activeFilters.areaMin') && r.dropped.includes('solar.hour'));
  assert.deepEqual(clone(App.store.INITIAL), before);
  // a clean state is a no-op
  const ok = { ...clone(App.store.INITIAL), activeFilters: { areaMin: 300, statuses: ['AVAILABLE'], q: 'B7', noCorner: true }, constraints: { budgetMax: 500000 }, preferences: { quiet: 2 } };
  const copy = clone(ok); assert.deepEqual(H.scrubRestoredState(ok).dropped, []); assert.deepEqual(ok, copy);
});
test('store.restore() runs the scrub (hook): a poisoned ws:<dev>:state is typed before the first render', () => {
  const App = fresh(), key = App.store.keyOf('viva-juara');
  App.store.storage.set(key, { v: App.store.STATE_VERSION, savedAt: '2026-10-12T00:00:00Z', prefs: poisoned(), session: {} });
  const st = App.store.restore('viva-juara');
  assert.equal(st.activeFilters.areaMin, undefined); assert.equal(st.activeFilters.priceMin, 450000); assert.equal(st.solar.hour, App.store.INITIAL.solar.hour);
  assert.ok(!XSS_RE.test(JSON.stringify(st.activeFilters) + JSON.stringify(st.constraints) + JSON.stringify(st.solar)));
  // without the hardening module the store keeps working (the hook is optional)
  const B = load(); B.store.storage.set(key, { v: B.store.STATE_VERSION, prefs: { activeFilters: { areaMin: 300 } }, session: {} }); assert.equal(B.store.restore('viva-juara').activeFilters.areaMin, 300);
});
test('render fuzz: the Find panel rendered from a scrubbed poisoned state contains no injected markup', async () => {
  const App = fresh(); for (const f of UI) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  const repo = App.repos.LotRepository('viva-juara'); await repo.load();
  const dev = App.repos.DevelopmentRepository.getDevelopmentConfig('viva-juara'), sel = App.selectors(repo, dev);
  const st = { ...clone(App.store.INITIAL), ...poisoned(), filterLevels: { ADVANCED: true, TECHNICAL: true }, presentationMode: 'technical' };
  App.securityHardening.scrubRestoredState(st, App.store.INITIAL);
  const html = App.panels.find(st, { sel, repo, dev, cfg: dev.presentation, mode: 'technical', st });
  assert.ok(html.length > 1000); assert.ok(!XSS_RE.test(html));
  const cv = App.customerView ? JSON.stringify(Object.keys(App.customerView)) : ''; assert.ok(cv.length >= 0);
});
test('PATCH P1: panels.js escapes value="${…}" even for an unscrubbed state', async () => {
  const App = fresh(); for (const f of UI) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  const repo = App.repos.LotRepository('viva-juara'); await repo.load();
  const dev = App.repos.DevelopmentRepository.getDevelopmentConfig('viva-juara'), sel = App.selectors(repo, dev);
  const st = { ...clone(App.store.INITIAL), activeFilters: { areaMin: P('a') }, constraints: { areaMin: P('c') }, filterLevels: { ADVANCED: true } };
  // escaped payload text ("&quot;&gt;&lt;img … onerror=") stays inert inside the attribute: assert no attribute breakout and no raw tag
  const html = App.panels.find(st, { sel, repo, dev, cfg: dev.presentation, mode: 'broker', st });
  assert.ok(!/"><img|<img src=x/.test(html)); assert.ok(html.includes('value="&quot;&gt;&lt;img'));
});
test('static scan: no NEW un-escaped value="${…}" interpolation in views (known findings are the P1 baseline)', () => {
  const scan = require('../scripts/securityScan.js');
  const KNOWN = new Set(['f.areaMin', 'f.areaMax', 'f.pricePerM2Min', 'f.pricePerM2Max', 'f.frontMin', 'f.frontMax', 'f.depthMin', 'f.depthMax', 'c.areaMin', 'c.areaMax', 'so.hour',
    // typed numbers/ids from registries (not free-form state): reviewed, safe
    'Math.round((st.baseMapBlend ?? 0.42) * 100)', 'Math.round(op * 100)', 's.downPaymentPct', 'd.id', 'p.id']);
  const files = []; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (p.endsWith('.js')) files.push(p); } })(SRC);
  const found = scan.scanValueAttributes(files).map(f => f.expr.replace(/\s*\?\?\s*''$/, ''));
  const fresh_ = found.filter(e => !KNOWN.has(e));
  assert.deepEqual(fresh_, [], 'new un-escaped value attribute: wrap it in esc()');
});
test('deep links never carry markup into state (hash payloads rejected by the codec; filters revalidated)', () => {
  const App = fresh(), DL = App.deeplink;
  const deps = { currentDevelopmentId: 'viva-juara', developmentExists: () => true, resolveLot: () => null, mapBounds: {}, detailSections: [], presentationMode: 'broker', authorize: () => true };
  const enc = encodeURIComponent;
  for (const h of ['#viva-juara?v=1&f=' + enc('a0:' + P('a')), '#viva-juara?v=1&f=' + enc('q:' + P('q')), '#viva-juara.lots.' + enc(P('l')), '#viva-juara?v=1&layer=' + enc(P('y')), '#' + enc(P('d'))]) {
    const dec = DL.codec.decode(h); if (!dec || !dec.envelope) continue;
    const res = DL.restoration.restore({ ...dec.envelope, status: dec.status }, deps);
    assert.ok(!XSS_RE.test(JSON.stringify(res.finalAppStatePatch || {})), h);
  }
});

// ------------------------------------------------------------ storage policy
test('storage policy: tokens/secrets/PII patterns in web storage are findings; allowed keys pass', () => {
  const H = fresh().securityHardening;
  const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghijklmnop'].join('.');
  const f = H.auditStorage({ 'ws:viva-juara:state': JSON.stringify({ v: 3, prefs: { customers: [{ id: 'c1', name: 'Ana', lots: [] }] } }), 'vj-device-id': 'dev_abc123', 'auth_token': 'Bearer ' + jwt, 'x': JSON.stringify({ email: 'ana@exemplo.com.br' }) });
  const by = c => f.filter(x => x.code === c).map(x => x.key);
  assert.deepEqual(by('CUSTOMER_NAME'), ['ws:viva-juara:state']); assert.deepEqual(by('BEARER_OR_JWT'), ['auth_token']); assert.deepEqual(by('EMAIL'), ['x']);
  assert.ok(by('KEY_NOT_IN_POLICY').includes('auth_token') && !by('KEY_NOT_IN_POLICY').includes('vj-device-id') && !by('KEY_NOT_IN_POLICY').includes('ws:viva-juara:state'));
  // works over a Storage-like object as well
  const S = { _: { k: 'Bearer abcdefghijklmnop' }, get length() { return 1; }, key: i => 'k', getItem: k => S._[k] };
  assert.ok(H.auditStorage(S).some(x => x.code === 'BEARER_OR_JWT'));
});
test('no frontend module writes a token/secret to web storage and authorization never reads storage', () => {
  const scan = require('../scripts/securityScan.js');
  const files = []; (function w(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (p.endsWith('.js')) files.push(p); } })(SRC);
  assert.deepEqual(scan.scanCode(files), []);
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  for (const f of ['security/authorization.js', 'security/organization.js', 'security/permissions.js', 'security/hardening.js']) assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(strip(fs.readFileSync(path.join(SRC, f), 'utf8'))), f);
});

// ------------------------------------------------------------ redaction / events
test('SecurityShareTokenNeverLogged: redaction of Authorization, cookies, ShareToken, signed URLs, CPF, e-mail, phone, notes', () => {
  const H = fresh().securityHardening, tok = 'A'.repeat(20) + 'b'.repeat(23);
  const t = H.redactText(`GET /s/${tok} Authorization: Bearer abc.def.ghi123 cpf 123.456.789-09 ana@x.com.br (27) 99999-1234 https://b.example/f.pdf?X-Amz-Signature=deadbeef&x=1`);
  for (const bad of [tok, 'abc.def.ghi123', '123.456.789-09', 'ana@x.com.br', '99999-1234', 'deadbeef']) assert.ok(!t.includes(bad), bad);
  assert.match(t, /\/s\/\[token\]/); assert.match(t, /x=1/);
  const r = H.redactRecord({ headers: { authorization: 'Bearer x', cookie: 'sid=1', 'set-cookie': 'a', accept: 'json' }, password: 'p', body: { note: 'cliente pediu desconto' }, customer: { id: 'c1', cpf: '1' }, msg: 'ok' });
  assert.equal(r.value.headers.authorization, '[redacted]'); assert.equal(r.value.headers.cookie, '[redacted]'); assert.equal(r.value.headers.accept, 'json');
  assert.equal(r.value.password, '[redacted]'); assert.equal('body' in r.value, false); assert.deepEqual(r.value.customer, { id: 'c1' }); assert.equal(r.value.msg, 'ok');
});
test('SecurityEvent: registered types only, redacted metadata, no raw token, separate from product analytics', () => {
  const App = fresh(), H = App.securityHardening;
  assert.equal(H.securityEvent('NOT_A_TYPE', {}), null);
  const e = H.securityEvent('TOKEN_REPLAY', { organizationId: 'org_house7', resourceType: 'SHARE', resourceId: '<x>', token: 'secret-token', url: '/s/' + 'x'.repeat(43), sourceIpHash: 'zz' }, { now: 0 });
  assert.equal(e.severity, 'HIGH'); assert.equal(e.metadata.token, '[redacted]'); assert.equal(e.metadata.url, '/s/[token]'); assert.equal(e.resourceId, null); assert.equal(e.sourceIpHash, null);
  assert.ok(!JSON.stringify(e).includes('secret-token'));
  assert.ok(H.securityEvents().some(x => x.eventId === e.eventId));
  assert.ok(!/App\.analytics/.test(H_SRC), 'hardening never talks to analytics');
});

// ------------------------------------------------------------ CSP / headers
test('CSP: strict policy (hash, no unsafe-eval/unsafe-inline scripts), meta variant drops header-only directives, evaluator flags weak policies', () => {
  const H = fresh().securityHardening, csp = H.buildCsp({ scriptHashes: ['abc='], styleHashes: ['def='], connect: ['https://api.example.com/v1', 'javascript:x'] });
  assert.match(csp, /script-src 'self' 'sha256-abc='/); assert.match(csp, /style-src-elem [^;]*'sha256-def='/); assert.match(csp, /connect-src 'self' https:\/\/api\.example\.com/);
  assert.match(csp, /object-src 'none'/); assert.match(csp, /base-uri 'none'/); assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/unsafe-eval/.test(csp)); assert.ok(!/script-src[^;]*unsafe-inline/.test(csp)); assert.ok(!/javascript/.test(csp));
  assert.deepEqual(H.evaluateCsp(csp), []);
  const meta = H.buildCsp({ scriptHashes: ['abc='], mode: 'meta' }); assert.ok(!/frame-ancestors|report-uri/.test(meta));
  const codes = H.evaluateCsp("script-src * 'unsafe-eval' 'unsafe-inline'").map(f => f.code);
  for (const c of ['UNSAFE_EVAL', 'UNSAFE_INLINE_SCRIPT', 'WILDCARD_SCRIPT', 'OBJECT_SRC_MISSING', 'BASE_URI_MISSING', 'FRAME_ANCESTORS_MISSING']) assert.ok(codes.includes(c), c);
  assert.deepEqual(H.evaluateCsp('').map(f => f.code).slice(0, 1), ['CSP_MISSING']);
  const hd = H.securityHeaders({ csp }); for (const k of ['X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options', 'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy']) assert.ok(hd[k], k);
  assert.equal(H.securityHeaders({ route: 'share' })['Cache-Control'], 'no-store'); assert.equal(H.securityHeaders({ route: 'share' })['Referrer-Policy'], 'no-referrer');
  assert.equal(H.securityHeaders({ route: 'sw' })['Cache-Control'], 'no-cache');
});
test('scripts/securityHeaders.js hashes exactly the inline <script>/<style> text the browser hashes', () => {
  const { inlineHashes, headersFile } = require('../scripts/securityHeaders.js'), crypto = require('crypto');
  const html = '<title>x</title><style>a{b:c}</style><div></div><script>App.x = 1;</script>';
  const h = inlineHashes(html); assert.deepEqual(h.scripts, [crypto.createHash('sha256').update('App.x = 1;').digest('base64')]); assert.equal(h.styles.length, 1);
  const out = headersFile({ html }); assert.ok(out.csp.includes(`'sha256-${h.scripts[0]}'`)); assert.equal(out.findings.length, 0); assert.match(out.text, /^\/\n  X-Content-Type-Options: nosniff/m); assert.match(out.meta, /^<meta http-equiv="Content-Security-Policy"/);
});
test('the shipped panel source has no inline event handler attributes, no eval/new Function in app code, no javascript: URLs', () => {
  const src = UI.concat(['presentation/app.js', 'presentation/map.js', 'loading/loadingView.js', 'analytics/metricsView.js']).map(f => fs.existsSync(path.join(SRC, f)) ? fs.readFileSync(path.join(SRC, f), 'utf8') : '').join('\n');
  assert.ok(!/<[a-z][^>]*\son(click|load|error|input|change|submit|mouseover|focus)\s*=/i.test(src), 'inline handlers would require script-src unsafe-inline');
  assert.ok(!/(^|[^.\w])eval\s*\(|new Function\s*\(/.test(src)); assert.ok(!/javascript:/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
});

// ------------------------------------------------------------ uploads / archives / CSV
test('SecurityMaliciousSvgBlocked / upload pipeline: allow-list, double extension, MIME×magic bytes, executables, size', () => {
  const H = fresh().securityHardening, b = s => Buffer.from(s, 'latin1'), pdf = b('%PDF-1.7\n...'), png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.equal(H.sniffMime(pdf), 'application/pdf'); assert.equal(H.sniffMime(png), 'image/png'); assert.equal(H.sniffMime(b('<?xml version="1.0"?><svg onload="x">')), 'image/svg+xml'); assert.equal(H.sniffMime(b('MZ\x90\x00')), 'application/x-msdownload');
  assert.equal(H.checkUpload({ filename: 'contrato.pdf', size: 1000, declaredMime: 'application/pdf', bytes: pdf }).ok, true);
  const er = o => H.checkUpload({ size: 1000, ...o }).errors;
  assert.ok(er({ filename: 'invoice.pdf.exe', bytes: b('MZ\x90') }).includes('DOUBLE_EXTENSION'));
  assert.ok(er({ filename: 'invoice.pdf.exe', bytes: b('MZ\x90') }).includes('EXECUTABLE_CONTENT'));
  assert.ok(er({ filename: 'logo.svg', bytes: b('<svg><script>alert(1)</script></svg>') }).includes('SVG_NOT_ALLOWED'));
  assert.ok(er({ filename: 'foto.png', declaredMime: 'image/png', bytes: pdf }).includes('MAGIC_BYTES_MISMATCH'), 'fake MIME');
  assert.ok(er({ filename: 'foto.png', declaredMime: 'text/html', bytes: png }).includes('DECLARED_MIME_MISMATCH'));
  assert.ok(H.checkUpload({ filename: 'a.pdf', size: 26214401, bytes: pdf }).errors.includes('FILE_TOO_LARGE'));
  assert.deepEqual(H.checkUpload({ filename: 'a.pdf', size: 1, bytes: pdf }, 'nope').errors, ['UPLOAD_POLICY_UNKNOWN']);
});
test('SecurityDocumentPathTraversalBlocked / SecurityZipBombRejected: filename is metadata only; zip slip, bomb, nesting, count', () => {
  const H = fresh().securityHardening;
  assert.equal(H.normalizeFilename('../../etc/passwd'), 'passwd'); assert.equal(H.normalizeFilename('C:\\x\\..\\y.pdf'), 'y.pdf'); assert.equal(H.normalizeFilename('.htaccess'), 'htaccess'); assert.equal(H.normalizeFilename(''), 'arquivo');
  assert.ok(H.checkArchive([{ name: 'doc.kml', compressedSize: 1000, uncompressedSize: 5000 }, { name: 'files/a.png', compressedSize: 100, uncompressedSize: 100 }]).ok);
  for (const n of ['../evil.kml', '/etc/x', 'a\\..\\b', 'C:/x']) assert.ok(H.checkArchive([{ name: n, compressedSize: 1, uncompressedSize: 1 }]).errors.includes('ZIP_SLIP'), n);
  assert.ok(H.checkArchive([{ name: 'doc.kml', compressedSize: 1000, uncompressedSize: 500 * 1024 * 1024 }]).errors.includes('COMPRESSION_RATIO'));
  assert.ok(H.checkArchive([{ name: 'doc.kml', compressedSize: 10e6, uncompressedSize: 60e6 }, { name: 'b.kml', compressedSize: 10e6, uncompressedSize: 60e6 }]).errors.includes('UNCOMPRESSED_TOO_LARGE'));
  assert.ok(H.checkArchive([{ name: 'inner.kmz', compressedSize: 1, uncompressedSize: 1 }]).errors.includes('NESTED_ARCHIVE'));
  assert.ok(H.checkArchive(Array.from({ length: 201 }, (_, i) => ({ name: `f${i}`, compressedSize: 1, uncompressedSize: 1 }))).errors.includes('TOO_MANY_ENTRIES'));
});
test('CSV export escaping neutralizes spreadsheet formulas', () => {
  const { csvCell } = fresh().securityHardening;
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`); assert.equal(csvCell('+SUM(A1)'), "'+SUM(A1)"); assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('-12'), '-12'); assert.equal(csvCell('-12,5'), '"-12,5"'); assert.equal(csvCell(null), ''); assert.equal(csvCell('a;b'), '"a;b"');
});

// ------------------------------------------------------------ SSRF / webhooks / idempotency / rate limits
test('SecuritySsrfPrivateIpBlocked: outbound URL policy', () => {
  const { checkOutboundUrl: c } = fresh().securityHardening;
  for (const [u, r] of [['http://169.254.169.254/latest/meta-data', 'PROTOCOL_NOT_ALLOWED'], ['https://169.254.169.254/', 'IP_PRIVATE'], ['https://0x7f000001/', 'IP_PRIVATE'], ['https://2130706433/', 'IP_PRIVATE'],
    ['https://[::1]/', 'IP_PRIVATE'], ['https://[::ffff:127.0.0.1]/', 'IP_PRIVATE'], ['https://[fd00::1]/', 'IP_PRIVATE'], ['https://10.1.2.3/', 'IP_PRIVATE'], ['https://192.168.0.1/', 'IP_PRIVATE'], ['https://172.20.0.1/', 'IP_PRIVATE'],
    ['https://localhost/', 'HOST_INTERNAL'], ['https://metadata.google.internal/', 'HOST_INTERNAL'], ['https://user:pw@example.com/', 'CREDENTIALS_IN_URL'], ['https://example.com:8443/', 'PORT_NOT_ALLOWED'], ['file:///etc/passwd', 'PROTOCOL_NOT_ALLOWED'], ['nota url', 'URL_INVALID']])
    assert.equal(c(u).reason, r, u);
  assert.equal(c('https://example.com/x.kmz').ok, true); assert.equal(c('https://8.8.8.8/').ok, true);
  assert.equal(c('https://example.com/', { allowHosts: ['docs.example.org'] }).reason, 'HOST_NOT_ALLOWED');
});
test('SecurityWebhookReplayRejected and SecurityIdempotencyPayloadMismatchRejected', () => {
  const H = fresh().securityHardening, seen = new Set(), now = 1_700_000_000_000;
  assert.equal(H.checkWebhook({ signatureValid: false, timestampSeconds: now / 1000, eventId: 'e1', now }, {}, seen).reason, 'INVALID_SIGNATURE');
  assert.equal(H.checkWebhook({ signatureValid: true, timestampSeconds: now / 1000 - 3600, eventId: 'e1', now }, {}, seen).reason, 'TIMESTAMP_OUT_OF_WINDOW');
  assert.equal(H.checkWebhook({ signatureValid: true, timestampSeconds: now / 1000, eventId: 'e1', now }, {}, seen).ok, true);
  assert.equal(H.checkWebhook({ signatureValid: true, timestampSeconds: now / 1000, eventId: 'e1', now }, {}, seen).reason, 'REPLAY');
  const idem = H.idempotency({ ttlSeconds: 60 }), k = 'k'.repeat(24), base = { key: k, tenantId: 'org_house7', userId: 'u1', endpoint: 'POST /price-tables', now };
  assert.equal(idem.check({ ...base, payload: { a: 1, b: [2] } }).outcome, 'NEW');
  assert.equal(idem.check({ ...base, payload: { b: [2], a: 1 } }).outcome, 'REPLAY', 'canonical payload');
  assert.equal(idem.check({ ...base, payload: { a: 2 } }).outcome, 'PAYLOAD_MISMATCH');
  assert.equal(idem.check({ ...base, userId: 'u2', payload: { a: 2 } }).outcome, 'NEW', 'scoped per user');
  assert.equal(idem.check({ ...base, payload: { a: 2 }, now: now + 61000 }).outcome, 'NEW', 'expired');
  assert.equal(idem.check({ ...base, key: 'short' }).outcome, 'INVALID_KEY');
});
test('SecurityLoginRateLimit: per-category policies (login strict, unknown policy fails closed)', () => {
  const H = fresh().securityHardening, rl = H.createRateLimiter('auth.login'), d = { ip: '203.0.113.9', account: 'h1' }, t = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(rl.check(d, t + i).allowed, true);
  const no = rl.check(d, t + 10); assert.equal(no.allowed, false); assert.equal(no.action, 'REJECT'); assert.ok(no.retryAfterSeconds >= 1 && no.retryAfterSeconds <= 60);
  assert.equal(rl.check({ ...d, account: 'h2' }, t + 11).allowed, true, 'separate key');
  assert.equal(rl.check(d, t + 61000).allowed, true, 'window reset');
  assert.equal(H.createRateLimiter('nope').check({}).allowed, false);
  assert.equal(H.createRateLimiter('search').policy.action, 'THROTTLE');
});

// ------------------------------------------------------------ high-risk actions / authz
test('SecurityPricingPublishStepUp / SecurityAvailabilityOverrideAudit: HighRiskActionPolicy order permission → step-up → reason → revision', () => {
  const H = fresh().securityHardening, E = H.DECISION, pp = ['price_table.publish'];
  assert.equal(H.evaluateHighRisk('PRICING_PUBLISH', { allowedPermissions: [] }).reasons[0], 'NO_GRANT');
  assert.equal(H.evaluateHighRisk('PRICING_PUBLISH', { allowedPermissions: pp, authStrength: 'PASSWORD_ONLY', sessionAgeMs: 1000 }).effect, E.REQUIRES_STEP_UP);
  assert.equal(H.evaluateHighRisk('PRICING_PUBLISH', { allowedPermissions: pp, authStrength: 'MFA_VERIFIED', sessionAgeMs: 3600000 }).effect, E.REQUIRES_STEP_UP, 'stale session');
  assert.equal(H.evaluateHighRisk('PRICING_PUBLISH', { allowedPermissions: pp, authStrength: 'MFA_VERIFIED', sessionAgeMs: 1000 }).reasons[0], 'REASON_REQUIRED');
  assert.equal(H.evaluateHighRisk('PRICING_PUBLISH', { allowedPermissions: pp, authStrength: 'MFA_VERIFIED', sessionAgeMs: 1000, reason: 'Tabela outubro' }).reasons[0], 'EXPECTED_REVISION_REQUIRED');
  const ok = H.evaluateHighRisk('PRICING_PUBLISH', { allowedPermissions: pp, authStrength: 'MFA_VERIFIED', sessionAgeMs: 1000, reason: 'Tabela outubro', expectedRevision: 7 });
  assert.equal(ok.effect, E.ALLOW); assert.deepEqual([...ok.obligations], ['writeAuditEvent']);
  const av = H.evaluateHighRisk('AVAILABILITY_OVERRIDE', { allowedPermissions: ['availability.write'], reason: 'Reserva confirmada', expectedRevision: 3 });
  assert.equal(av.effect, E.ALLOW); assert.ok(av.obligations.includes('writeAuditEvent'));
  assert.equal(H.evaluateHighRisk('AVAILABILITY_OVERRIDE', { allowedPermissions: ['availability.write'], expectedRevision: 3 }).reasons[0], 'REASON_REQUIRED');
  assert.equal(H.evaluateHighRisk('USER_ROLE_CHANGE', { allowedPermissions: ['assignment.manage'], authStrength: 'RECENT_REAUTH', sessionAgeMs: 1 }).reasons[0], 'PERMISSION_NOT_REGISTERED', 'proposed permission fails closed');
  assert.equal(H.evaluateHighRisk('UNKNOWN_ACTION', {}).effect, E.DENY);
});
test('SecurityTenantCrossAccessDenied + SecurityCustomerFieldMasking + localStorage is never authorization (frontend side)', () => {
  const App = fresh(), A = App.authz;
  const keys = App.permissions.grantsOf('BROKER');
  const r = A.fromMe({ authenticated: true, principal: { type: 'USER', id: 'u1', status: 'ACTIVE' }, organizationId: 'org_house7', memberships: [{ organizationId: 'org_house7', status: 'ACTIVE' }], roles: ['BROKER'], permissions: keys }, { developmentId: 'viva-juara' });
  App.tenancy.learnFromServer({ organizations: [{ id: 'org_b', slug: 'b', displayName: 'B', status: 'ACTIVE' }], developmentOwners: { 'dev-b': 'org_b' }, developmentVisibility: { 'dev-b': 'PRIVATE' } });
  assert.equal(A.evaluate(r.context, { permission: 'lot.view', resource: { developmentId: 'dev-b' }, context: { connectivity: 'ONLINE' } }).reason, 'CROSS_TENANT');
  assert.deepEqual(clone(A.maskCustomer({ id: 'c1', name: 'Ana', phone: '27999991234', lots: ['x'] })), { id: 'c1', lots: ['x'], hasProfile: false, masked: true });
  App.store.storage.set('ws:role', 'OWNER_ADMIN'); assert.equal(A.can('price_table.publish', { developmentId: 'viva-juara' }), false, 'deny by default');
});

// ------------------------------------------------------------ config validator / BFCache / logout
test('SecurityConfigValidator fails closed in production', () => {
  const H = fresh().securityHardening, prod = { env: 'production' };
  assert.deepEqual(H.validateSecurityConfig({ ...prod, corsOrigins: ['https://app.example.com'], auth: { devTokens: false }, adminTokenLength: 64, shareEnabled: true, sharePepperLength: 32, cookie: { secure: true, httpOnly: true, sameSite: 'Lax' }, trustProxy: true, proxyHops: 1 }).errors, []);
  const e = H.validateSecurityConfig({ ...prod, corsOrigins: ['*', 'http://app.example.com'], corsCredentials: true, auth: { devTokens: true }, adminTokenLength: 10, shareEnabled: true, cookie: { secure: false, httpOnly: false, sameSite: 'None' }, debugEndpoints: true, tenantEnforcement: false, csp: "script-src 'unsafe-eval'" }).errors;
  for (const c of ['CORS_WILDCARD_IN_PRODUCTION', 'CORS_WILDCARD_WITH_CREDENTIALS', 'CORS_HTTP_ORIGIN_IN_PRODUCTION', 'DEBUG_AUTH_PROVIDER_IN_PRODUCTION', 'ADMIN_TOKEN_TOO_SHORT', 'SHARE_SIGNING_SECRET_MISSING', 'COOKIE_NOT_SECURE', 'COOKIE_NOT_HTTPONLY', 'COOKIE_SAMESITE_WEAK', 'DEBUG_ENDPOINTS_IN_PRODUCTION', 'TENANT_ENFORCEMENT_DISABLED', 'CSP_UNSAFE_EVAL']) assert.ok(e.includes(c), c);
  assert.ok(H.validateSecurityConfig({ env: 'development', corsOrigins: ['*'], trustProxy: true }).warnings.includes('TRUST_PROXY_WITHOUT_HOP_COUNT'));
});
test('Logout + BFCache: pageshow(persisted) revalidates an authenticated session; logout plan revokes server-side first and purges sensitive caches', () => {
  const App = fresh(), H = App.securityHardening;
  assert.equal(H.onPageShow({ persisted: true, authenticated: true, lastRevalidatedAt: 0, now: 1 }), 'REVALIDATE');
  assert.equal(H.onPageShow({ persisted: true, authenticated: false }), 'NONE');
  assert.equal(H.onPageShow({ persisted: false, authenticated: true, lastRevalidatedAt: 0, now: 120000 }), 'REVALIDATE');
  const steps = H.logoutPlan(); assert.match(steps[0], /revoga/); assert.ok(steps.some(s => /purgar/.test(s)) && steps.some(s => /BFCache/.test(s)));
  for (const k of ['customers', 'currentCustomerId', 'favorites', 'activeFilters']) assert.ok(App.tenancy.TENANT_SENSITIVE_STATE.includes(k), k);
  assert.equal(App.authz.reset('logout').principal.type, 'ANONYMOUS');
});
test('SecurityServiceWorkerNoAuthCache: the worker never answers/stores other origins, /api/, Authorization, auth/share routes, no-store or Set-Cookie responses', () => {
  const routingFile = path.join(SRC, 'pwa/swRouting.js');
  if (fs.existsSync(routingFile)) { // topic 49 classifier: the same file is inlined into sw.js
    const R = require(routingFile), o = 'https://app.example', ctx = { scopePath: '/', rules: [], precache: new Set(['index.html']) };
    const c = (url, x = {}) => R.classify({ method: 'GET', url: o + url, mode: 'cors', sameOrigin: true, ...x }, ctx);
    assert.equal(c('/x.png', { sameOrigin: false }).handle, false);
    assert.equal(c('/api/v1/me').handle, false); assert.equal(c('/api/v1/me').store, null);
    assert.equal(c('/img/a.webp', { hasAuthorization: true }).handle, false);
    assert.equal(c('/data.json', { cacheMode: 'no-store' }).store, null);
    assert.equal(c('/data.json', { method: 'POST' }).handle, false);
    const share = c('/s/' + 'a'.repeat(43), { mode: 'navigate' }); assert.notEqual(share.offline, R.OfflineSource.SHELL); assert.equal(share.store, null);
    const res = (h, x = {}) => ({ status: 200, ok: true, type: 'basic', headers: new Map(Object.entries(h)), ...x });
    assert.equal(R.storable(res({ 'cache-control': 'no-store' })), false); assert.equal(R.storable(res({ 'set-cookie': 'a=1' })), false);
    assert.equal(R.storable(res({}, { type: 'opaque' })), false); assert.equal(R.storable(res({}, { status: 500, ok: false })), false);
  } else {
    const sw = fs.readFileSync(path.join(SRC, 'sw.template.js'), 'utf8');
    assert.match(sw, /origin !== self\.location\.origin/); assert.match(sw, /authorization/i); assert.match(sw, /\/api\//); assert.match(sw, /no-store/);
  }
  assert.match(fs.readFileSync(path.join(SRC, 'sw.template.js'), 'utf8'), /SKIP_WAITING/, 'activation only on an explicit message');
});

// ------------------------------------------------------------ backend pure pieces (no DB)
test('backend (pure): CORS allow-list, mass-assignment and injection-shaped ids rejected, production config fail-closed', () => {
  const mw = require('../backend/src/shared/http/middleware.js'), V = require('../backend/src/shared/validation/index.js'), { loadConfig } = require('../backend/src/shared/config/index.js');
  const res = () => { const h = {}; return { h, setHeader: (k, v) => { h[k] = v; } }; };
  const r1 = res(); assert.throws(() => mw.applyCors({ headers: { origin: 'https://evil.example' }, method: 'OPTIONS' }, r1, ['https://app.example.com']), e => e.status === 403);
  assert.equal(r1.h['Access-Control-Allow-Origin'], undefined);
  const r2 = res(); mw.applyCors({ headers: { origin: 'https://app.example.com' }, method: 'GET' }, r2, ['https://app.example.com']); assert.equal(r2.h['Access-Control-Allow-Origin'], 'https://app.example.com');
  assert.equal(r2.h['Access-Control-Allow-Credentials'], undefined, 'no credentialed CORS');
  const r3 = res(); mw.securityHeaders(r3, { hsts: true }); assert.equal(r3.h['X-Content-Type-Options'], 'nosniff'); assert.match(r3.h['Content-Security-Policy'], /default-src 'none'/); assert.ok(r3.h['Strict-Transport-Security']);
  assert.throws(() => V.validateObject({ status: 'SOLD', expectedRevision: 1, organization_id: 'org_b' }, require('../backend/src/modules/availability/availability.dto.js').UpdateAvailabilityRequestSchema), e => e.details.some(d => d.reason === 'unknown_field'));
  for (const bad of ["VJ-QB-L0079' OR 1=1--", 'VJ-QB-L0079;DROP TABLE lots', '../../etc/passwd']) assert.throws(() => V.lotId(bad), e => e.status === 400, bad);
  const base = { DATABASE_URL: 'postgres://u@localhost/db', NODE_ENV: 'production' };
  assert.throws(() => loadConfig({ ...base, CORS_ORIGINS: '*' }, { useDotEnv: false }), /not allowed in production/);
  assert.throws(() => loadConfig({ ...base, AUTH_DEV_TOKENS: 'true' }, { useDotEnv: false }), /not allowed in production/);
  assert.throws(() => loadConfig({ ...base, ADMIN_API_TOKEN: 'short' }, { useDotEnv: false }), /at least 32/);
  const ok = loadConfig({ ...base, CORS_ORIGINS: 'https://app.example.com', ADMIN_API_TOKEN: 'z'.repeat(40) }, { useDotEnv: false });
  assert.ok(!JSON.stringify(ok).includes('z'.repeat(40)), 'the raw admin token never lives in the config object');
  const tokens = require('../backend/src/modules/share/share.tokens.js'), t = tokens.generateToken();
  assert.match(t, tokens.TOKEN_RE); assert.notEqual(t, tokens.generateToken()); assert.equal(tokens.redactToken(`/s/${t}`), '/s/[token]');
  assert.throws(() => tokens.hashToken(t, 'short'), /PEPPER|curto/);
  const hp = tokens.hashPasscode('1234'); assert.ok(tokens.verifyPasscode('1234', hp)); assert.ok(!tokens.verifyPasscode('1235', hp)); assert.ok(!JSON.stringify(hp).includes('1234'));
});
test('PATCH B1: clientIp() uses the right-most X-Forwarded-For hop added by the trusted proxy', () => {
  const mw = require('../backend/src/shared/http/middleware.js');
  // the client controls the left-most entry; with one trusted proxy the right-most entry is the real client
  assert.equal(mw.clientIp({ headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }, socket: { remoteAddress: '10.0.0.2' } }, true), '203.0.113.7');
});

// ------------------------------------------------------------ secrets / supply chain (CI gate)
test('Secrets: the scanner finds planted secrets (without echoing them) and the repository + built panel are clean', () => {
  const scan = require('../scripts/securityScan.js'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec50-'));
  const planted = ['AKIA' + 'ABCDEFGHIJKLMNOP', '-----BEGIN ' + 'PRIVATE KEY-----', 'postgres://admin:' + 'hunter2pw' + '@db.internal/x', 'ADMIN_API_TOKEN=' + 'Q'.repeat(10) + 'w8e7r6t5y4u3i2o1'];
  fs.writeFileSync(path.join(dir, 'leak.js'), planted.join('\n'));
  fs.writeFileSync(path.join(dir, 'fixture.js'), "const k = { WRITE_API_KEY: 'legacy-key-for-test' }; // postgres://USER:PASSWORD@HOST/DB");
  const f = scan.scanSecrets([path.join(dir, 'leak.js'), path.join(dir, 'fixture.js')]);
  assert.deepEqual(f.map(x => x.rule), ['AWS_ACCESS_KEY', 'PRIVATE_KEY', 'DB_URL_WITH_PASSWORD', 'ASSIGNED_SECRET']);
  assert.ok(!JSON.stringify(f).includes('hunter2pw'));
  fs.rmSync(dir, { recursive: true, force: true });
  const r = scan.run();
  assert.deepEqual(r.secrets, [], 'no secret in src/config/scripts/backend/docs/dash');
  assert.deepEqual(r.blocking, [], 'CI gate: no CRITICAL/HIGH finding');
});
test('SecurityDependencyCriticalVulnerabilityBlocksRelease: dependency inventory (lockfiles, registry, integrity, install scripts)', () => {
  const inv = require('../scripts/securityScan.js').dependencyInventory();
  assert.ok(inv.packages.some(p => p.name === 'pg'), 'backend runtime dependency inventoried');
  assert.ok(inv.packages.every(p => !p.resolvedHost || p.resolvedHost === 'registry.npmjs.org'));
  assert.deepEqual(inv.findings.filter(f => f.severity === 'HIGH' || f.severity === 'CRITICAL'), []);
  const be = JSON.parse(fs.readFileSync(path.join(PLAT, 'backend/package.json'), 'utf8')); assert.deepEqual(Object.keys(be.dependencies), ['pg'], 'a new runtime dependency needs security review (§242)');
  const html = path.join(PLAT, '..', 'dash', 'index.html');
  if (fs.existsSync(html)) { const ext = [...new Set([...fs.readFileSync(html, 'utf8').matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:\/\/[^/"]+)/g)].map(m => m[1]))]; assert.deepEqual(ext.filter(o => !/fonts\.googleapis\.com$/.test(o)), [], 'only the approved third party (D50-3)'); }
});
