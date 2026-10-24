'use strict';
// Topic 39 — Customer domain. Golden scenarios named after the spec (§79).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC, publishedStatus } = require('./harness.js');

const MODULES = ['customer/customerDomain.js', 'customer/customerContext.js', 'customer/customerRepository.js', 'customer/customerView.js'];
let App, D, C, R, repo, lots, fitCfg, pol;
const ORG = 'org_house7', DEV = 'viva-juara', NOW = Date.parse('2026-10-09T12:00:00Z');
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m);
let n = 0; const idGen = p => `${p}_t${(++n).toString(36)}`;
const O = (x = {}) => ({ organizationId: ORG, now: NOW, idGen, actorId: 'usr_broker1', ...x });
const ALL = ['customer.read', 'customer.readAssigned', 'customer.create', 'customer.update', 'customer.archive', 'customer.assign', 'customer.profile.read', 'customer.profile.update', 'customer.contact.read', 'customer.contact.update', 'customer.merge', 'customer.duplicate.review', 'customer.privacy.read', 'customer.privacy.manage', 'customer.externalRef.manage'];
const canAll = k => ALL.includes(k), canOnly = (...ks) => k => ks.includes(k);
const P = (userId = 'usr_broker1', org = ORG) => ({ userId, organizationId: org, teamIds: [] });
const maria = (x = {}) => D.createCustomer({ displayName: 'Maria Souza', ...x }, O());

test.before(async () => {
  App = load();
  for (const f of MODULES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  D = App.customer.domain; C = App.customer.context; R = App.customer.repo;
  repo = App.repos.LotRepository(DEV); await repo.load(); lots = repo.lotsSync();
  fitCfg = App.fit.cfgOf(DEV); pol = App.recommendation.policyOf(DEV);
});

// ---------------------------------------------------------------- domain core
test('MinimalPersonCustomer: name only is valid; id opaque, tenant mandatory, no phone/email/profile; lifecycle is administrative', () => {
  const r = maria();
  assert.equal(r.ok, true); const c = r.customer;
  assert.equal(c.type, 'PERSON'); assert.equal(c.lifecycleStatus, 'ACTIVE'); assert.equal(c.organizationId, ORG); assert.equal(c.recordRevision, 1);
  assert.equal(r.contactPoints.length, 0); assert.equal(c.currentPreferenceProfileVersionId, undefined);
  assert.ok(!/maria|souza/i.test(c.id), 'id is not built from the name'); assert.ok(Object.isFrozen(c));
  assert.equal(D.createCustomer({ displayName: 'X' }, { now: NOW }).code, 'MISSING_ORGANIZATION');
  assert.equal(D.createCustomer({ displayName: '  ' }, O()).code, 'MISSING_FIELD');
  assert.equal(D.createCustomer({ id: '48999991234', displayName: 'X' }, O()).code, 'PII_AS_ID');
  assert.equal(D.createCustomer({ id: 'maria@x.com', displayName: 'X' }, O()).code, 'INVALID_ID');
  deq(Object.keys(D.LifecycleStatus), ['ACTIVE', 'ARCHIVED', 'MERGED', 'DELETED'], 'no sales stage in the customer lifecycle');
  const u = D.updateCustomer(c, { displayName: 'Maria S. Souza', id: 'other' }, { expectedRevision: 1, now: NOW });
  assert.equal(u.customer.id, c.id, 'id immutable'); assert.equal(u.customer.recordRevision, 2);
  assert.equal(D.updateCustomer(c, { displayName: 'Y' }, { expectedRevision: 0 }).code, 'CUSTOMER_REVISION_CONFLICT');
  const a = D.archive(u.customer, { expectedRevision: 2, now: NOW }); assert.equal(a.customer.lifecycleStatus, 'ARCHIVED'); assert.equal(a.events[0].type, 'CustomerArchived');
});
test('OrganizationCustomer: ORGANIZATION type keeps organization details apart from identity', () => {
  const r = D.createCustomer({ type: 'ORGANIZATION', displayName: 'Construtora Exemplo', legalName: 'Construtora Exemplo Ltda', tradeName: 'Exemplo' }, O());
  assert.equal(r.customer.type, 'ORGANIZATION'); assert.equal(r.details.legalName, 'Construtora Exemplo Ltda'); assert.equal(r.details.firstName, undefined);
  assert.equal(D.createCustomer({ type: 'HOUSEHOLD', displayName: 'X' }, O()).code, 'INVALID_TYPE');
});
test('CustomerWithWhatsAppContact: normalized to E.164, never "fixed", presence ≠ verification; invalid stays UNPARSEABLE', () => {
  const r = maria({ contacts: [{ type: 'WHATSAPP', value: '(48) 99999-1234' }, { type: 'EMAIL', value: ' Maria@Example.COM ' }, { type: 'PHONE', value: '9999-123' }] });
  const [w, e, bad] = r.contactPoints;
  assert.equal(w.normalizedValue, '+5548999991234'); assert.equal(w.value, '(48) 99999-1234', 'original kept'); assert.equal(w.verificationStatus, 'UNVERIFIED');
  assert.equal(e.normalizedValue, 'Maria@example.com', 'domain lower-cased only'); assert.equal(e.verificationStatus, 'UNVERIFIED');
  assert.equal(bad.normalizationStatus, 'UNPARSEABLE'); assert.equal(bad.normalizedValue, undefined); assert.equal(bad.verificationStatus, 'UNVERIFIED', 'not marked VALID nor INVALID by guess');
  assert.equal(D.normalizePhone('48 3333-1234').normalizedValue, '+554833331234');
  assert.equal(D.normalizePhone('0800 123').status, 'UNPARSEABLE'); assert.equal(D.normalizePhone('abc').status, 'UNPARSEABLE'); assert.equal(D.normalizePhone('(48) 89999-1234').status, 'UNPARSEABLE', 'no mobile without 9');
  assert.equal(D.normalizeEmail('a@@b.com').status, 'UNPARSEABLE');
  const v = D.setVerification(w, 'VERIFIED', { method: 'OTP', now: NOW }); assert.equal(v.contact.verificationStatus, 'VERIFIED'); assert.equal(w.verificationStatus, 'UNVERIFIED', 'original untouched');
});
test('CustomerWithUnknownConsent: contact presence never implies consent; revoked wins; legal decision is recorded, not invented', () => {
  const r = maria({ contacts: [{ type: 'WHATSAPP', value: '48999991234' }] }), c = r.customer;
  assert.equal(D.consentOf(r.communicationPreferences, 'WHATSAPP'), 'UNKNOWN'); assert.equal(D.mayContact(r.communicationPreferences, 'WHATSAPP'), false);
  const g = D.setCommunicationPreference(c, { channel: 'WHATSAPP', consentStatus: 'GRANTED', purposeCode: 'SERVICE', sourceRef: 'form_1' }, O({ now: NOW }));
  const rv = D.setCommunicationPreference(c, { channel: 'WHATSAPP', consentStatus: 'REVOKED', purposeCode: 'SERVICE' }, O({ now: NOW + 1000 }));
  assert.equal(D.consentOf([g.preference], 'WHATSAPP'), 'GRANTED'); assert.equal(D.consentOf([g.preference, rv.preference], 'WHATSAPP'), 'REVOKED'); assert.ok(rv.preference.revokedAt);
  assert.equal(D.mayContact([g.preference, rv.preference], 'WHATSAPP'), false);
  assert.equal(D.setCommunicationPreference(c, { channel: 'WHATSAPP', consentStatus: 'YES' }, O()).code, 'INVALID_CONSENT');
  assert.equal(r.privacyProfile.dataClassification, 'STANDARD_PII'); assert.equal(r.privacyProfile.marketingCommunicationAllowed, undefined); assert.equal(r.privacyProfile.retentionPolicyRef, undefined, 'no legal retention invented');
});

// ---------------------------------------------------------------- assignment and access
test('CustomerAssignmentOwnerCollaborator: one active OWNER, collaborators; assignment ≠ RBAC (Tenant AND Permission AND Assignment AND Lifecycle)', () => {
  const c = maria().customer;
  const o1 = D.assign(c, { assigneeType: 'USER', assigneeId: 'usr_broker1', role: 'OWNER' }, O()), col = D.assign(c, { assigneeType: 'USER', assigneeId: 'usr_broker2', role: 'COLLABORATOR' }, O({ current: [o1.assignment] }));
  const o2 = D.assign(c, { assigneeType: 'USER', assigneeId: 'usr_broker3', role: 'OWNER' }, O({ current: [o1.assignment, col.assignment] }));
  assert.equal(o2.ended.length, 1); assert.equal(o2.ended[0].id, o1.assignment.id); assert.equal(o2.ended[0].status, 'ENDED');
  const asg = [o2.ended[0], col.assignment, o2.assignment];
  const dec = (p, can) => D.decideAccess({ customer: c, principal: p, assignments: asg, can });
  assert.equal(dec(P('usr_broker2'), canOnly('customer.readAssigned')).allowed, true, 'collaborator with readAssigned');
  assert.equal(dec(P('usr_broker1'), canOnly('customer.readAssigned')).reasonCodes[0], 'NOT_ASSIGNED', 'ended owner loses assignment-based access');
  assert.equal(dec(P('usr_broker2'), () => false).allowed, false, 'assignment without permission → deny');
  assert.equal(dec(P('usr_manager'), canOnly('customer.read')).allowed, true, 'org-wide read permission without assignment');
  assert.equal(dec(P('usr_broker2'), canOnly('customer.readAssigned')).accessLevel, 'SUMMARY');
  assert.equal(dec(P('usr_broker2'), canOnly('customer.readAssigned', 'customer.profile.read', 'customer.contact.read', 'customer.privacy.read')).accessLevel, 'FULL');
  assert.equal(D.assign(c, { assigneeType: 'USER', assigneeId: 'u1', role: 'BOSS' }, O()).code, 'INVALID_ROLE');
});
test('CustomerCrossTenantDenied: another organization sees NOT_FOUND (indistinguishable from absence); deleted/merged are not readable', () => {
  const c = maria().customer;
  const d = D.decideAccess({ customer: c, principal: P('usr_x', 'org_other'), can: canAll });
  assert.equal(d.allowed, false); assert.equal(d.accessLevel, 'NONE'); deq(d.reasonCodes, ['NOT_FOUND']);
  assert.equal(D.decideAccess({ customer: null, principal: P(), can: canAll }).reasonCodes[0], 'NOT_FOUND');
  assert.equal(D.decideAccess({ customer: { ...c, lifecycleStatus: 'DELETED' }, principal: P(), can: canAll }).allowed, false);
  const m = D.decideAccess({ customer: { ...c, lifecycleStatus: 'MERGED', mergedIntoCustomerId: 'cus_target' }, principal: P(), can: canAll }); assert.equal(m.allowed, false); assert.equal(m.canonicalCustomerId, 'cus_target');
  // permission keys not in the registry are denied by the authz adapter (deny by default)
  const can = D.canFromAuthz(App.authz.context(), { developmentId: DEV }); assert.equal(can('customer.read'), false); assert.equal(can('customer.contact.read'), false);
  const local = D.localDeviceCan(App.authz.context(), { developmentId: DEV }); assert.equal(local('customer.read'), true, 'static mode = the existing local customer list'); assert.equal(local('customer.contact.read'), false, 'contacts never in device mode');
});
test('CustomerPIIRedaction: projections cap by access level; SUMMARY has no contacts; STANDARD masks; logs/events/analytics carry no PII', () => {
  const r = maria({ contacts: [{ type: 'WHATSAPP', value: '48999991234' }, { type: 'EMAIL', value: 'maria@example.com' }] });
  const b = { customer: r.customer, details: r.details, contacts: r.contactPoints, privacy: r.privacyProfile };
  const summary = D.decideAccess({ customer: r.customer, principal: P(), can: canOnly('customer.read') }), std = D.decideAccess({ customer: r.customer, principal: P(), can: canOnly('customer.read', 'customer.profile.read') });
  const full = D.decideAccess({ customer: r.customer, principal: P(), can: canAll });
  const s = D.project(b, 'FULL', summary); assert.equal(s.mode, 'SUMMARY'); assert.equal(s.downgraded, true); assert.equal(s.contactPoints, undefined);
  assert.ok(!JSON.stringify(s).includes('99999') && !JSON.stringify(s).includes('@'));
  const st = D.project(b, 'FULL', std); assert.equal(st.mode, 'STANDARD'); assert.equal(st.contactPoints[0].value, '•••• 1234'); assert.equal(st.contactPoints[1].value, 'm•••@example.com'); assert.equal(st.privacyProjection, undefined);
  const f = D.project(b, 'FULL', full); assert.equal(f.contactPoints[0].value, '48999991234'); assert.equal(f.privacyProjection.dataClassification, 'STANDARD_PII');
  const cs = D.project(b, 'CLIENT_SAFE', full); deq(Object.keys(cs).sort(), ['displayName', 'downgraded', 'mode', 'objectiveLabel'].sort()); assert.equal(cs.displayName, 'Maria');
  const tech = D.project(b, 'TECHNICAL', full); assert.equal(tech.displayName, undefined); assert.ok(!JSON.stringify(tech).includes('99999'));
  for (const e of r.events) { const s2 = JSON.stringify(e); assert.ok(!/Maria|99999|example\.com/.test(s2), 'event without PII: ' + e.type); }
  deq(D.redactPII({ customerId: 'c1', displayName: 'Maria', note: 'x', q: '4899', free: 'ligar 48 99999-1234', nested: { email: 'a@b.co', ok: 1 } }), { customerId: 'c1', free: '[redacted]', nested: { ok: 1 } });
  deq(D.logEntry('customer.search', { customerId: 'c1' }), { operation: 'customer.search', customerId: 'c1', status: 'OK', correlationId: null, codes: [] });
  assert.equal(C.headerLabel({ displayName: 'Maria Souza' }), 'Atendendo: Maria Souza'); assert.equal(C.headerLabel({ displayName: 'Maria Souza' }, 'mobile'), 'Maria');
  assert.equal(C.headerLabel({ displayName: '48 99999-1234' }), 'Atendendo: Cliente', 'a phone typed as name never goes to the header');
});

// ---------------------------------------------------------------- profile
const newProfile = (c, input, prev, x = {}) => D.createProfileVersion({ profile: prev ? prev.profile : D.createPreferenceProfile(c, O()), previous: prev ? prev.version : null, input }, O({ developmentId: DEV, ...x }));
test('CustomerPreferenceProfileVersioning: V1 frozen; change → V2 superseding V1; same content → no new version; snapshot is minimal', () => {
  const c = maria().customer;
  const v1 = newProfile(c, { objective: 'LIVE', preferences: [{ key: 'quiet', importance: 'HIGH' }, { key: 'areaRange', importance: 'MEDIUM', target: { min: 250, max: 320 } }, { key: 'budget', importance: 'HIGH', target: 300000 }] });
  assert.equal(v1.ok, true); assert.equal(v1.version.version, 1); assert.ok(Object.isFrozen(v1.version) && Object.isFrozen(v1.version.preferences[0]));
  assert.throws(() => { 'use strict'; v1.version.preferences[0].importance = 'LOW'; });
  const same = newProfile(c, { objective: 'LIVE', preferences: [{ key: 'quiet', importance: 'HIGH' }, { key: 'areaRange', importance: 'MEDIUM', target: { min: 250, max: 320 } }, { key: 'budget', importance: 'HIGH', target: 300000 }] }, v1);
  assert.equal(same.unchanged, true); assert.equal(same.version.id, v1.version.id);
  const v2 = newProfile(c, { objective: 'LIVE', preferences: [{ key: 'quiet', importance: 'HIGH' }, { key: 'areaRange', importance: 'MEDIUM', target: { min: 250, max: 320 } }, { key: 'budget', importance: 'HIGH', target: 330000 }] }, v1);
  assert.equal(v2.version.version, 2); assert.equal(v2.version.supersedesVersionId, v1.version.id); assert.notEqual(v2.version.checksum, v1.version.checksum);
  assert.equal(v1.version.preferences.find(p => p.key === 'budget').target, 300000, 'V1 stays historical');
  const snap = D.createSnapshot(v2.version, c, 'RECOMMENDATION', O());
  deq(Object.keys(snap).sort(), ['createdAt', 'customerId', 'customerRevision', 'id', 'organizationId', 'preferenceChecksum', 'profileVersionId', 'purpose'].sort());
  assert.ok(!JSON.stringify(snap).includes('Maria'));
  assert.equal(newProfile(c, { preferences: [{ key: 'telepathy', importance: 'HIGH' }] }).code, 'UNSUPPORTED_PREFERENCE', 'only criteria the platform supports');
});
test('CustomerBudgetUnknown / UNDECIDED ≠ UNKNOWN / completeness is not confidence', () => {
  const c = maria().customer;
  const v = newProfile(c, { objective: 'UNDECIDED', budgetProfile: {} });
  assert.equal(v.version.budgetProfile.dataState, 'UNKNOWN'); assert.equal(v.version.budgetProfile.maximumPurchasePrice, undefined, 'unknown is absent, never 0');
  assert.equal(newProfile(c, { budgetProfile: { maximumPurchasePrice: 0 } }).code, 'INVALID_MONEY');
  assert.equal(v.version.objective, 'UNDECIDED'); deq(v.version.profileCompleteness.answered, ['objective'], 'UNDECIDED is an answer');
  const none = newProfile(c, {}); assert.equal(none.version.objective, undefined, 'no LIVE by default'); assert.equal(none.version.profileCompleteness.ratio, 0);
  const b = newProfile(c, { budgetProfile: { maximumPurchasePrice: { amount: 330000 } } }); assert.equal(b.version.budgetProfile.dataState, 'NEEDS_CONFIRMATION');
  assert.equal(D.objectiveLabel('UNDECIDED'), 'Ainda não decidiu');
});
test('CustomerHardConstraintExplicit: "Prefiro até 330 mil" is a preference, "Não aceito acima de 330 mil" a constraint; HIGH never becomes a constraint; suggestions stay inactive', () => {
  const c = maria().customer;
  const pref = newProfile(c, { preferences: [{ key: 'budget', importance: 'HIGH', target: 330000 }] });
  assert.equal(pref.version.hardConstraints.length, 0); deq(D.toRecommendationConstraints(pref.version), {});
  const hard = newProfile(c, { hardConstraints: [{ key: 'budgetMax', value: 330000, source: 'CUSTOMER_EXPLICIT' }] });
  assert.equal(hard.version.preferences.length, 0); deq(D.toRecommendationConstraints(hard.version), { budgetMax: 330000 });
  const sug = newProfile(c, { preferences: [{ key: 'solar', importance: 'MEDIUM', source: 'SYSTEM_SUGGESTED_UNCONFIRMED' }] });
  assert.equal(sug.version.preferences[0].active, false); assert.equal(sug.warnings[0].code, 'SUGGESTION_NOT_ACTIVATED');
  assert.equal(D.toFitProfile(sug.version).preferences.length, 0, 'inactive suggestion does not reach Fit');
  assert.equal(newProfile(c, { hardConstraints: [{ key: 'budgetMax', value: 1, source: 'SYSTEM_SUGGESTED_UNCONFIRMED' }] }).code, 'INVALID_SOURCE');
});
test('CustomerFitFromProfileSnapshot: Fit from the profile version = Fit from the same panel state (methodology unchanged); Base Score untouched', () => {
  const c = maria().customer, ui = { preferences: { quiet: 3, privacy: 2, solar: 1 } };
  const v = newProfile(c, D.fromUiState(ui, { developmentId: DEV }));
  assert.equal(v.version.preferences.every(p => p.source === 'BROKER_RECORDED'), true, 'typed by the broker, not marked as customer action');
  const fromVersion = D.toFitProfile(v.version, { developmentId: DEV }), fromPanel = App.fit.buildProfile({ id: c.id, developmentId: DEV, preferences: ui.preferences });
  assert.equal(fromVersion.profileVersion, fromPanel.profileVersion);
  const a = App.fit.fitLots(fromVersion, lots, fitCfg), b = App.fit.fitLots(fromPanel, lots, fitCfg);
  deq(a.map(x => [x.lotId, x.fitScore]), b.map(x => [x.lotId, x.fitScore]));
  deq(D.toUiState(v.version), { ...ui, constraints: {} }, 'round trip to the panel shape');
  const before = lots.map(l => l.intelligence.scores.housing); D.toFitProfile(v.version); deq(lots.map(l => l.intelligence.scores.housing), before);
  const snap = D.createSnapshot(v.version, c, 'FIT', O()), refs = D.resultRefs(snap, fromVersion);
  deq(Object.keys(refs).sort(), ['customerId', 'customerProfileVersion', 'profileSnapshotId', 'profileVersionId']);
});
test('CustomerRecommendationFromProfileSnapshot: recommendation records the exact version; a later V2 does not rewrite R(V1)', () => {
  const c = maria().customer;
  const v1 = newProfile(c, { preferences: [{ key: 'quiet', importance: 'HIGH' }], hardConstraints: [{ key: 'budgetMax', value: 300000 }] });
  const fp1 = D.toFitProfile(v1.version, { developmentId: DEV }), dv = { analysisVersion: 'a1', priceTableVersion: 't1', availabilityRevision: 0, staticVersion: 's1' };
  const rec = prof => App.recommendation.recommend({ developmentId: DEV, profile: prof, constraints: [], lots, policy: pol, fitCfg, availabilityPolicy: {}, dataVersions: dv });
  const r1 = rec(fp1), r1Ref = { ...D.resultRefs(D.createSnapshot(v1.version, c, 'RECOMMENDATION', O()), fp1), recommendationProfileVersion: r1.customerProfileVersion };
  assert.equal(r1.customerProfileVersion, fp1.profileVersion);
  const v2 = newProfile(c, { preferences: [{ key: 'quiet', importance: 'HIGH' }, { key: 'solar', importance: 'LOW' }], hardConstraints: [{ key: 'budgetMax', value: 330000 }] }, v1);
  const r2 = rec(D.toFitProfile(v2.version, { developmentId: DEV }));
  assert.notEqual(r2.customerProfileVersion, r1.customerProfileVersion); assert.equal(r1Ref.profileVersionId, v1.version.id, 'R(V1) keeps pointing to V1');
  // UNKNOWN is never AVAILABLE: no lot is promoted by the customer context
  assert.ok(lots.every(l => l.availability.status === publishedStatus(l)));
});

// ---------------------------------------------------------------- context
test('CustomerFavoritesByContext + context switch: id-only store patch, map/filters/lot preserved, Base Score unchanged, exit clears only profile keys', () => {
  const st = { ...App.store.INITIAL, currentCustomerId: 'c1', activeFilters: { areaMin: 300 }, currentLotId: 'lot_x', mapViewport: { k: 2, x: 1, y: 1 }, preferences: { quiet: 3 } };
  const ctx = C.select('c2', { source: 'CUSTOMER_LIST', now: NOW }); deq(C.storePatch(ctx), { currentCustomerId: 'c2' }, 'store keeps the id only');
  const patch = C.switchPatch(st, 'c2', { profileUi: { preferences: { solar: 2 } } });
  for (const k of C.PRESERVED_KEYS) assert.ok(!(k in patch), 'switch preserves ' + k);
  for (const k of Object.keys(patch)) assert.ok(k in App.store.INITIAL, 'patch only uses existing store keys: ' + k);
  assert.equal(patch.recScope, null, 'contextual recommendation scope is recalculated');
  const ex = C.exitPatch(); assert.ok(!('activeFilters' in ex)); assert.equal(ex.currentCustomerId, null); assert.equal(C.EXIT_LABEL, 'Sair do contexto do cliente');
  deq(D.favoriteContext('c2'), { contextType: 'CUSTOMER', contextRef: 'c2' });
  assert.equal(C.fitLabel({ displayName: 'Maria Souza' }), 'Compatibilidade para Maria'); assert.equal(C.favoriteLabel({ displayName: 'Maria Souza' }), 'Favoritar para Maria');
  assert.equal(C.select('48999991234').customerId, null, 'PII-looking id rejected');
  // tenant switch / logout: context cleared and in-memory repository dropped
  const store = R.MemoryCustomerStore(); store.of(ORG); const p2 = C.clearOnSessionChange(store); assert.equal(p2.currentCustomerId, null); deq(store.organizations(), []);
  assert.ok(App.tenancy.TENANT_SENSITIVE_STATE.includes('currentCustomerId') && App.tenancy.TENANT_SENSITIVE_STATE.includes('customers'));
});
test('CustomerSwitchGuardComparison: switching with a comparison of the previous customer offers keep/new/copy and never rewrites it', () => {
  const st = { currentCustomerId: 'c1', comparisonLotIds: ['a', 'b'], recScope: { lotIds: [] } };
  const session = Object.freeze({ candidateIds: ['a', 'b'], context: Object.freeze({ mode: 'CUSTOMER', customerId: 'c1', customerProfileVersion: 'pv1' }) });
  const g = C.guard(st, 'c2', { comparison: session, profileDirty: true, favoritesContextRef: 'c1' });
  assert.equal(g.blocking, false, 'never blocks the map');
  deq(g.warnings, ['COMPARISON_BELONGS_TO_PREVIOUS_CUSTOMER', 'RECOMMENDATION_OF_PREVIOUS_CUSTOMER', 'UNSAVED_PROFILE_CHANGES', 'FAVORITES_IN_PREVIOUS_CONTEXT']);
  deq(g.options.map(o => o.id), ['KEEP_COMPARISON', 'NEW_COMPARISON', 'COPY_CANDIDATES', 'SAVE_PROFILE', 'DISCARD_PROFILE']);
  assert.equal(session.context.customerId, 'c1', 'comparison untouched');
  const cc = D.comparisonContext('c2', 'cpv_2', 'fpv'); assert.equal(App.compare.domain.normalizeContext(cc).mode, 'CUSTOMER');
  assert.equal(C.guard(st, 'c1').changed, false);
});
test('deep links: ?customerId=<opaque> only; phone/email/cpf rejected; authorization re-checked on open', () => {
  const r = C.parseDeepLink('?customerId=cus_abc123&phone=48999991234&email=a%40b.com&cpf=1');
  assert.equal(r.customerId, 'cus_abc123'); deq(r.rejected, ['phone', 'email', 'cpf']); assert.equal(r.requiresAuthorization, true);
  assert.equal(C.parseDeepLink('customerId=48999991234').customerId, null);
  assert.equal(C.buildDeepLink('cus_abc'), 'customerId=cus_abc'); assert.equal(C.buildDeepLink('a@b.com'), '');
  // the app router never puts a customer in the URL
  const tok = App.router.token({ ...App.store.INITIAL, currentCustomerId: 'cus_abc' }, x => x); assert.ok(!tok.includes('cus_abc'));
});

// ---------------------------------------------------------------- duplicates and merge
test('CustomerDuplicateByPhoneReview: same phone → OPEN candidate, SUGGEST_ONLY; fuzzy name alone never auto-merges; same-tenant only', () => {
  const a = maria({ contacts: [{ type: 'PHONE', value: '48999991234' }] }), b = D.createCustomer({ displayName: 'Maria S.', contacts: [{ type: 'WHATSAPP', value: '+55 48 99999-1234' }] }, O());
  const other = D.createCustomer({ displayName: 'Maria Souza', contacts: [{ type: 'PHONE', value: '48999991234' }] }, O({ organizationId: 'org_other' }));
  const c = D.detectDuplicates({ customers: [a.customer, b.customer, other.customer], contacts: [...a.contactPoints, ...b.contactPoints, ...other.contactPoints] }, O());
  assert.equal(c.length, 1); assert.equal(c[0].status, 'OPEN'); assert.equal(c[0].action, 'SUGGEST_ONLY');
  assert.ok(c[0].matchSignals.some(s => s.signal === 'SAME_NORMALIZED_PHONE')); assert.ok(c[0].matchSignals.some(s => s.signal === 'SIMILAR_NAME'));
  const fuzzy = D.detectDuplicates({ customers: [maria().customer, D.createCustomer({ displayName: 'Maria Souza' }, O()).customer], contacts: [] }, O());
  assert.equal(fuzzy.length, 1); deq(fuzzy[0].matchSignals.map(s => s.strength), ['WEAK']);
  const nd = D.reviewDuplicate(c[0], 'NOT_DUPLICATE', O()).candidate;
  assert.equal(D.detectDuplicates({ customers: [a.customer, b.customer], contacts: [...a.contactPoints, ...b.contactPoints] }, O({ existing: [nd] })).length, 0, 'reviewed pair not reopened');
  // duplicate warning about a record the user cannot see does not leak details
  const w = D.duplicateWarning(c[0], c[0].customerIdA, () => false); deq(Object.keys(w).sort(), ['candidateId', 'code', 'message']); assert.equal(w.code, 'POTENTIAL_DUPLICATE_REQUIRES_REVIEW');
});
test('CustomerDuplicateByExternalRef + CustomerExternalMasterConflict: authority mode is never chosen automatically; external master needs field policy; conflicts carry fingerprints only', () => {
  let a = maria().customer;
  assert.equal(D.linkExternalRef(a, { provider: 'KENLO', externalId: 'K123' }, O()).code, 'AUTHORITY_MODE_REQUIRED');
  const l = D.linkExternalRef(a, { provider: 'KENLO', externalId: 'K123', authorityMode: 'EXTERNAL_MASTER' }, O()); a = l.customer;
  assert.equal(l.ref.syncStatus, 'NEVER_SYNCED'); assert.equal(D.linkExternalRef(a, { provider: 'KENLO', externalId: 'K999', authorityMode: 'EXTERNAL_MASTER' }, O()).code, 'EXTERNAL_REF_CONFLICT');
  const b = D.linkExternalRef(D.createCustomer({ displayName: 'M. Souza' }, O()).customer, { provider: 'KENLO', externalId: 'K123', authorityMode: 'REFERENCE_ONLY' }, O()).customer;
  const d = D.detectDuplicates({ customers: [a, b], contacts: [] }, O()); assert.ok(d[0].matchSignals.some(s => s.signal === 'SAME_EXTERNAL_REF' && s.strength === 'STRONG'));
  const ext = D.applyExternalChanges(a, { provider: 'KENLO', changes: { displayName: 'Maria Aparecida Souza' } }, O({ policies: [{ fieldPath: 'displayName', authority: 'MANUAL_REVIEW', provider: 'KENLO' }] }));
  assert.equal(ext.conflicts.length, 1); assert.equal(ext.conflicts[0].status, 'MANUAL_REVIEW'); assert.ok(!JSON.stringify(ext.conflicts).includes('Maria'), 'no raw value in conflict');
  assert.equal(D.applyExternalChanges(a, { provider: 'KENLO', changes: { displayName: 'Nova' } }, O({ policies: [] })).applied.displayName, 'Nova', 'external master applies by default');
  const h = D.linkExternalRef(maria().customer, { provider: 'CRMX', externalId: '1', authorityMode: 'HYBRID' }, O()).customer;
  assert.equal(D.applyExternalChanges(h, { provider: 'CRMX', changes: { displayName: 'Z' } }, O({ policies: [] })).conflicts[0].status, 'MANUAL_REVIEW', 'hybrid without field policy → no last-write-wins');
  // ingestion: same external ref matched, webhook retry idempotent, preference hints not applied
  const world = { customers: [a], contacts: [], ingestionKeys: new Map([['META:L9', a.id]]) };
  assert.equal(D.ingest({ sourceSystem: 'KENLO', sourceRecordId: 'K123', displayName: 'Maria' }, world, O()).action, 'MATCHED');
  assert.equal(D.ingest({ sourceSystem: 'META', sourceRecordId: 'L9' }, world, O()).action, 'REPLAY');
  const created = D.ingest({ sourceSystem: 'SITE', sourceRecordId: 'F1', displayName: 'João', phone: '48988887777', preferenceHints: { quiet: 3 } }, world, O());
  assert.equal(created.action, 'CREATED'); deq(created.ignored, ['PREFERENCE_HINTS_NOT_APPLIED']); assert.equal(created.created.customer.externalRefs[0].authorityMode, 'REFERENCE_ONLY');
});
test('CustomerMergeWithAlias + CustomerMergePreservesFavorites: explicit, audited, revision-checked; aliases collapse chains; snapshots not rewritten', () => {
  const A = D.createCustomer({ displayName: 'Maria Souza', contacts: [{ type: 'PHONE', value: '48999991234' }] }, O()), B = D.createCustomer({ displayName: 'Maria S.', contacts: [{ type: 'EMAIL', value: 'maria@x.com' }] }, O());
  const vB = newProfile(B.customer, { preferences: [{ key: 'quiet', importance: 'HIGH' }] }), Bc = D.updateCustomer(B.customer, { currentPreferenceProfileVersionId: vB.version.id }, { expectedRevision: 1, now: NOW }).customer;
  const snapB = D.createSnapshot(vB.version, Bc, 'FIT', O());
  const own = D.assign(Bc, { assigneeType: 'USER', assigneeId: 'usr_broker2', role: 'COLLABORATOR' }, O()).assignment;
  const world = { customers: [A.customer, Bc], contacts: [...A.contactPoints, ...B.contactPoints], assignments: [own], favorites: [{ id: 'f1', contextType: 'CUSTOMER', contextRef: Bc.id, lotId: 'lot1' }, { id: 'f2', contextType: 'PERSONAL', contextRef: 'usr_broker1', lotId: 'lot2' }], aliases: [{ aliasCustomerId: 'cus_old', canonicalCustomerId: Bc.id }], mergeRecords: [] };
  const cmd = { sourceCustomerIds: [Bc.id], targetCustomerId: A.customer.id, expectedRevisions: { [A.customer.id]: 1, [Bc.id]: 2 }, fieldDecisions: [], reasonCode: 'SAME_PERSON', idempotencyKey: 'm1' };
  assert.equal(D.merge({ ...cmd, expectedRevisions: { [A.customer.id]: 1, [Bc.id]: 1 } }, world, O()).code, 'CUSTOMER_REVISION_CONFLICT', 'stale revision blocks');
  assert.equal(D.merge(cmd, world, O()).code, 'PROFILE_DECISION_REQUIRED', 'profiles never merged silently');
  const m = D.merge({ ...cmd, fieldDecisions: [{ fieldPath: 'preferenceProfile', choice: 'ADOPT_SOURCE:' + Bc.id }] }, world, O());
  assert.equal(m.ok, true); assert.equal(m.sources[0].lifecycleStatus, 'MERGED'); assert.equal(m.target.recordRevision, 2); assert.equal(m.target.currentPreferenceProfileVersionId, vB.version.id);
  assert.equal(m.contacts.filter(c => c.customerId === A.customer.id).length, 2, 'contacts preserved');
  deq(m.favorites.find(f => f.id === 'f1'), { id: 'f1', contextType: 'CUSTOMER', contextRef: A.customer.id, lotId: 'lot1', originalContextRef: Bc.id }); assert.equal(m.favorites.find(f => f.id === 'f2').contextRef, 'usr_broker1', 'personal favorite untouched');
  assert.equal(m.assignments[0].customerId, A.customer.id);
  assert.equal(D.resolveAlias(m.aliases, Bc.id), A.customer.id); assert.equal(D.resolveAlias(m.aliases, 'cus_old'), A.customer.id, 'chain collapsed');
  assert.equal(m.record.reasonCode, 'SAME_PERSON'); assert.equal(m.record.performedBy, 'usr_broker1'); assert.equal(snapB.customerId, Bc.id, 'historical snapshot not rewritten');
  assert.equal(D.merge(cmd, { ...world, mergeRecords: [m.record] }, O()).replay, true, 'idempotent');
  assert.equal(D.merge({ ...cmd, idempotencyKey: 'm2' }, { ...world, customers: [A.customer, { ...Bc, organizationId: 'org_other' }] }, O()).code, 'CROSS_TENANT');
});
test('CustomerArchivedHistoricalRecommendation: archived customer stays readable (read-only) and its versions/refs remain', () => {
  const c = maria().customer, v = newProfile(c, { preferences: [{ key: 'quiet', importance: 'HIGH' }] });
  const a = D.archive(D.updateCustomer(c, { currentPreferenceProfileVersionId: v.version.id }, { expectedRevision: 1 }).customer, { expectedRevision: 2 }).customer;
  const d = D.decideAccess({ customer: a, principal: P(), can: canAll }); assert.equal(d.allowed, true); assert.equal(d.canWrite, false); assert.ok(d.reasonCodes.includes('ARCHIVED_READ_ONLY'));
  assert.equal(a.currentPreferenceProfileVersionId, v.version.id);
  const an = D.anonymize({ customer: a, contacts: [] }, { reasonCode: 'DATA_SUBJECT_REQUEST', now: NOW }); assert.equal(an.customer.lifecycleStatus, 'DELETED'); assert.equal(an.customer.id, a.id, 'logical, ids preserved');
  assert.equal(D.anonymize({ customer: a }, {}).code, 'REASON_REQUIRED');
});

// ---------------------------------------------------------------- repositories / services
test('services: deny by default, tenant isolation, search only shows visible customers, contact search needs permission, latest search wins, no PII in audit', async () => {
  const store = R.MemoryCustomerStore();
  const svc = R.services(store, { principal: P(), can: canAll, now: () => NOW, idGen });
  const r1 = await svc.application.create({ displayName: 'Maria Souza', contacts: [{ type: 'WHATSAPP', value: '48999991234' }] });
  const r2 = await svc.application.create({ displayName: 'Maria S.', contacts: [{ type: 'PHONE', value: '48999991234' }] });
  assert.equal(r2.ok, true); assert.equal(r2.duplicateWarnings.length, 1, 'created with a duplicate warning');
  const nobody = R.services(store, { principal: P('usr_x'), can: () => false });
  assert.equal((await nobody.application.get(r1.customerId)).code, 'NOT_FOUND'); assert.equal((await nobody.application.create({ displayName: 'X' })).code, 'NOT_FOUND');
  const otherOrg = R.services(store, { principal: P('usr_y', 'org_other'), can: canAll });
  assert.equal((await otherOrg.application.get(r1.customerId)).code, 'NOT_FOUND', 'IDOR across tenants');
  const assignedOnly = R.services(store, { principal: P('usr_broker2'), can: canOnly('customer.readAssigned') });
  assert.equal((await assignedOnly.search.search({ text: 'maria' })).results.length, 0, 'search never reveals invisible customers');
  assert.equal((await assignedOnly.search.search({ phone: '48999991234' })).code, 'CONTACT_SEARCH_NOT_ALLOWED');
  const found = await svc.search.search({ phone: '(48) 99999-1234' }); assert.equal(found.results.length, 2); assert.equal(found.results[0].contactPoints, undefined, 'summary only');
  // Maria → João quickly: the late answer is discarded
  let release; const slow = R.services(store, { principal: P(), can: canAll, delay: q => q.text === 'maria' ? new Promise(r => { release = r; }) : null });
  const p1 = slow.search.search({ text: 'maria' }), p2 = slow.search.search({ text: 'joão' }); while (!release) await new Promise(r => setTimeout(r, 1)); release();
  assert.equal((await p1).superseded, true); assert.equal((await p2).superseded, undefined);
  const audit = JSON.stringify(svc.audit()); assert.ok(!/Maria|99999|joão/i.test(audit), 'audit without PII');
  const v = await svc.profile.save(r1.customerId, { preferences: [{ key: 'quiet', importance: 'HIGH' }] }, { developmentId: DEV });
  assert.equal(v.ok, true); const s = await svc.profile.snapshot(r1.customerId, 'FIT', { developmentId: DEV }); assert.equal(s.refs.profileVersionId, v.version.id);
  assert.equal((await svc.profile.versions(r1.customerId)).length, 1);
  assert.equal((await svc.repos.profiles.appendVersion({ organizationId: ORG }, v.version)).code, 'IMMUTABLE_VERSION');
  const fav = await svc.favorites.add(r1.customerId, 'lot1'); assert.equal(fav.favorite.contextRef, r1.customerId);
  const scan = await svc.duplicates.scan(); assert.equal(scan.candidates.length, 1);
  const cur1 = await svc.repos.customers.getById({ organizationId: ORG }, r1.customerId), cur2 = await svc.repos.customers.getById({ organizationId: ORG }, r2.customerId);
  const mg = await svc.merge.merge({ sourceCustomerIds: [r1.customerId], targetCustomerId: r2.customerId, expectedRevisions: { [r1.customerId]: cur1.recordRevision, [r2.customerId]: cur2.recordRevision }, fieldDecisions: [{ fieldPath: 'preferenceProfile', choice: 'ADOPT_SOURCE:' + r1.customerId }], reasonCode: 'SAME_PERSON', idempotencyKey: 'k1' });
  assert.equal(mg.ok, true); assert.equal((await svc.favorites.list(r1.customerId)).length, 1, 'favorites resolve through the alias');
  assert.equal((await svc.application.get(r1.customerId)).view.summary.customerId, r2.customerId, 'old id resolves to the canonical customer');
  assert.equal((await svc.ingestion.ingest({ sourceSystem: 'SITE', sourceRecordId: 'F1', displayName: 'João' })).action, 'CREATED');
  assert.equal((await svc.ingestion.ingest({ sourceSystem: 'SITE', sourceRecordId: 'F1', displayName: 'João' })).action, 'REPLAY', 'webhook retry does not duplicate');
  store.clear(); assert.equal((await svc.application.get(r2.customerId)).code, 'NOT_FOUND', 'logout clears');
});
test('no customer PII in localStorage: services never write it; the legacy convenience copy is the only one and is reported', () => {
  const keys = []; const ls = App.window ? null : null; // the harness localStorage is the vm global
  const src = MODULES.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  assert.ok(!/localStorage\.setItem|indexedDB\.open|sessionStorage/.test(src), 'customer modules never persist to browser storage'); void keys; void ls;
  assert.ok(!/console\.(log|info|warn|error)\(/.test(src), 'no console logging of customer data');
});

// ---------------------------------------------------------------- legacy migration
test('LegacyCustomerMigrationAdapter: idempotent; keeps opaque ids (currentCustomerId still valid); lots → CUSTOMER favorites; UI lens not mapped to objective; report complete', () => {
  const legacy = [
    { id: 'cmg1abc2', name: 'Maria Souza', lots: [lots[0].identity.id, 'ghost'], profile: { preferences: { quiet: 3, solar: 1 }, constraints: { budgetMax: 330000 }, activePreset: 'silencio', objective: 'housing' } },
    { id: 'cmg1abc3', name: 'Maria S.', lots: [] }, { id: '48999991234', name: 'X' }, { name: 'sem id' }, { id: 'cmg1abc2', name: 'dup' }, { id: 'cmg1abc4', name: 'João', extra: 1 }];
  const r = C.migrate(legacy, { organizationId: ORG, developmentId: DEV, now: NOW, idGen, resolveLot: id => repo.resolve(id) });
  const rep = r.report;
  assert.equal(rep.recordsDiscovered, 6); assert.equal(rep.customersCreated, 3); assert.equal(rep.profilesMigrated, 1);
  deq(r.customers.map(c => c.id), ['cmg1abc2', 'cmg1abc3', 'cmg1abc4'], 'legacy ids kept');
  deq(rep.unresolvedIdentities.map(u => u.reason), ['ID_NOT_OPAQUE', 'MISSING_ID', 'DUPLICATE_ID_IN_LEGACY']);
  assert.equal(r.favorites.length, 1); assert.equal(r.favorites[0].contextType, 'CUSTOMER'); deq(rep.unresolvedFavoriteContexts.map(u => u.lotRef), ['ghost']);
  assert.ok(rep.dataNotMigrated.some(d => d.reason === 'UI_LENS_NOT_CUSTOMER_OBJECTIVE')); assert.ok(rep.dataNotMigrated.some(d => d.field === 'extra'));
  assert.equal(r.versions[0].objective, undefined, 'housing lens ≠ LIVE'); deq(D.toUiState(r.versions[0]), { preferences: { quiet: 3, solar: 1 }, constraints: { budgetMax: 330000 } });
  assert.equal(rep.legacyPiiStorageFound.length, 3); assert.equal(rep.duplicateCandidates, 1, 'Maria Souza ~ Maria S. suggested only');
  const again = C.migrate(legacy, { organizationId: ORG, developmentId: DEV, now: NOW, idGen, existing: { customerIds: r.customers.map(c => c.id) } });
  assert.equal(again.report.customersCreated, 0); assert.equal(again.report.alreadyMigrated, 3);
  deq(C.legacyProfileUi(legacy[0]), { preferences: { quiet: 3, solar: 1 }, constraints: { budgetMax: 330000 }, activePreset: 'silencio', objective: 'housing' });
});
test('regression guards: no valorização promise in customer texts; config bundled; view escapes and never shows contacts in the chip', () => {
  const texts = JSON.stringify(App.configs.customer) + MODULES.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('');
  assert.ok(!/valoriza(ç|c)ão garantida|vai valorizar|lucro garantido/i.test(texts));
  assert.equal(App.configs.customer.policy.defaults.duplicatePolicy.mode, 'SUGGEST_ONLY');
  const chip = App.customerView.contextChip({ label: C.headerLabel({ displayName: '<b>Maria</b>' }) }); assert.ok(chip.includes('&lt;b&gt;') && chip.includes('data-act="custClear"'));
  deq(App.customerView.TABS.map(t => t[1]), ['Resumo', 'Jornada', 'Perfil', 'Favoritos', 'Comparações', 'Recomendações']);
});
