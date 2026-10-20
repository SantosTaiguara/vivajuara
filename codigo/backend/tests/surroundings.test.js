'use strict';
/* Topic 63 (Google Maps, Entorno, raio máximo de 8 km) — backend module, DB-FREE: in-memory repositories and a FAKE
   GOOGLE (records every request, answers Places/Routes fixtures). Nothing here talks to Google or to Postgres.
   Test coordinates are synthetic fixtures of a fictitious development (dev-fixture); they are NOT Viva Juara data. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const S = require('../src/modules/surroundings');
const { createSurroundingsService, createRateLimiter } = require('../src/modules/surroundings/surroundings.service');
const google = require('../src/modules/surroundings/google.provider');
const repo = require('../src/modules/surroundings/surroundings.repository');
const oa = require('../src/modules/surroundings/surroundings.openapi');
const { createRouter } = require('../src/shared/http/router');
const D = require('../../src/surroundings/surroundingsDomain.js');
const BASE = require('../../src/config/surroundings/surroundings.config.js');

const FAKE_KEY = 'fake-server-key-for-tests-only';
const ORG = 'org_fixture', DEV = 'dev-fixture';
const CENTER = { latitude: 1.25, longitude: 2.5 }; // synthetic
const clone = o => JSON.parse(JSON.stringify(o));

/** enabled test configuration: flag ON, validated synthetic center, numbers set only for the test */
function testCfg(over = {}) {
  const c = clone(BASE);
  c.featureFlag.enabled = true;
  c.rateLimit.placesRequestsPerMinute = 1000; c.rateLimit.routesRequestsPerMinute = 1000;
  c.providerPolicy.reviewedAt = '2026-10-16'; c.providerPolicy.reviewedBy = 'test';
  c.provider.http.backoffBaseMs = 1; c.provider.http.timeoutMs = 200;
  const vj = c.developments['viva-juara'];
  c.developments = { [DEV]: { ...clone(vj), location: { ...vj.location, developmentId: DEV, organizationId: ORG, name: 'Empreendimento de teste', center: { ...CENTER }, locationStatus: 'VALIDATED', sourceRef: 'fixture://test', validationMethod: 'OFFICIAL_COORDINATE', validatedBy: 'tester', validatedAt: '2026-10-16T00:00:00Z', googleMapsEnabled: true, version: 'loc-1' },
    intelligence: { ...vj.intelligence, enabled: true, routesEnabled: true }, viewport: { ...vj.viewport, developmentId: DEV } },
    'viva-juara': clone(vj) };
  c.locationChangePolicy.requireDistinctApprover = true;
  return Object.assign(c, over);
}
const at = (m, bearing = 45) => D.destination(CENTER, bearing, m);
const gPlace = (id, meters, o = {}) => ({ id, displayName: { text: o.name || `Local ${id}`, languageCode: 'pt-BR' }, location: at(meters, o.bearing), primaryType: 'supermarket', types: ['supermarket', 'store'], ...(o.noAddress ? {} : { formattedAddress: 'Rua de teste, 1' }), ...(o.rating === null ? {} : { rating: o.rating ?? 4.5, userRatingCount: 120 }) });

function fakeGoogle({ places = [gPlace('PlaceAAAAAAAA1', 500), gPlace('PlaceAAAAAAAA2', 3500)], routes = { routes: [{ distanceMeters: 9400, duration: '754s' }] }, placesStatus = 200, routesStatus = 200, errorBody = null, hang = false } = {}) {
  const calls = [];
  return { calls, places: () => calls.filter(c => c.url.includes('places')), routes: () => calls.filter(c => c.url.includes('routes')),
    async request(url, init) {
      calls.push({ url, method: init.method, headers: { ...init.headers }, body: JSON.parse(init.body) });
      if (hang) return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      if (url.includes('places')) return placesStatus === 200 ? { status: 200, json: { places } } : { status: placesStatus, json: errorBody || { error: { code: placesStatus, message: 'internal provider detail', status: 'INTERNAL' } } };
      return routesStatus === 200 ? { status: 200, json: routes } : { status: routesStatus, json: { error: { message: 'internal' } } };
    } };
}
function setup({ cfg = testCfg(), g = fakeGoogle(), env = { GOOGLE_MAPS_API_KEY: FAKE_KEY, GOOGLE_MAPS_BROWSER_KEY: 'fake-browser-key' }, logger } = {}) {
  const locations = repo.createMemoryLocationRepository(cfg), placeRefs = repo.createMemoryPlaceRefRepository();
  const svc = S.create({ config: cfg, env, http: g, locations, placeRefs, logger, now: () => new Date('2026-10-16T12:00:00Z') });
  return { svc, g, cfg, locations, placeRefs };
}
const rejects = async (p, code) => { await assert.rejects(p, e => { assert.equal(e.code, code, `${e.code} ≠ ${code}`); return true; }); };
const q = (o = {}) => ({ organizationId: ORG, developmentId: DEV, actorKey: 'u1', category: 'SUPERMARKETS', radius: '8000', rank: 'DISTANCE', ...o });

// ------------------------------------------------------------------------------------------ repository data (Viva Juara)
test('Viva Juara: official coordinate validated by the owner from the KMZ (2026-10-18), flag OFF → no provider call, max radius 8000', async () => {
  const vj = BASE.developments['viva-juara'];
  assert.deepEqual(vj.location.center, { latitude: -20.145472, longitude: -40.211418 }); assert.equal(vj.location.locationStatus, 'VALIDATED');
  assert.equal(vj.location.validationMethod, 'OFFICIAL_KML_KMZ'); assert.equal(vj.location.validatedAt, '2026-10-18'); assert.equal(BASE.featureFlag.enabled, false);
  assert.equal(vj.location.maxNearbyRadiusMeters, 8000); assert.deepEqual(vj.intelligence.selectableRadiiMeters, [2000, 4000, 6000, 8000]);
  assert.ok(vj.location.candidateEvidence.every(e => !('latitude' in e) && !('center' in e)), 'pre-decision evidence stays referenced, never copied as a center');
  const g = fakeGoogle(); const { svc } = setup({ cfg: clone(BASE), g, env: {} });
  const conf = await svc.environmentMapConfig({ organizationId: 'org_house7', developmentId: 'viva-juara' });
  assert.equal(conf.enabled, false); assert.notEqual(conf.state, 'AVAILABLE'); assert.notEqual(conf.coordinateStatus, 'NOT_VALIDATED');
  await rejects(svc.nearbyPlaces({ ...q(), organizationId: 'org_house7', developmentId: 'viva-juara' }), 'GOOGLE_MAPS_NOT_CONFIGURED');
  assert.equal(g.calls.length, 0, 'flag OFF: zero provider calls');
});
test('golden §415/§416: coordinate missing or unverified → feature disabled, no provider request', async () => {
  for (const patch of [{ center: null }, { locationStatus: 'UNVERIFIED' }, { locationStatus: 'REJECTED' }, { validatedBy: null }]) {
    const cfg = testCfg(); Object.assign(cfg.developments[DEV].location, patch);
    const { svc, g } = setup({ cfg });
    await rejects(svc.nearbyPlaces(q()), 'GOOGLE_MAPS_LOCATION_UNVERIFIED');
    await rejects(svc.routeEstimate({ organizationId: ORG, developmentId: DEV, body: { providerPlaceId: 'PlaceAAAAAAAA1', travelMode: 'DRIVE' } }), 'GOOGLE_MAPS_LOCATION_UNVERIFIED');
    assert.equal(g.calls.length, 0);
    assert.equal((await svc.environmentMapConfig({ organizationId: ORG, developmentId: DEV })).center, null);
  }
});

// ------------------------------------------------------------------------------------------ radius
test('golden §411–§414: 12000/9000/10000/3000/0/-1/abc/8000.5 → LOCATION_RADIUS_INVALID with no call; 2/4/6/8 km → provider radius exactly that', async () => {
  const { svc, g } = setup();
  for (const r of ['12000', '9000', '10000', '3000', '0', '-1', 'abc', '8000.5', '', null, '50000']) await rejects(svc.nearbyPlaces(q({ radius: r })), 'LOCATION_RADIUS_INVALID');
  assert.equal(g.calls.length, 0, 'never call Google with an unsupported radius');
  for (const r of [2000, 4000, 6000, 8000]) {
    const out = await svc.nearbyPlaces(q({ radius: String(r) }));
    assert.equal(g.calls.at(-1).body.locationRestriction.circle.radius, r); assert.equal(out.effectiveRadiusMeters, r); assert.equal(out.requestedRadiusMeters, r);
  }
  assert.ok(g.calls.every(c => c.body.locationRestriction.circle.radius <= 8000));
});
test('the development max is the source of truth: a config above the approved 8000 m is refused, technical 50 km is never used', async () => {
  const cfg = testCfg(); cfg.developments[DEV].intelligence.maxRadiusMeters = 10000;
  const { svc, g } = setup({ cfg });
  await rejects(svc.nearbyPlaces(q()), 'GOOGLE_MAPS_NOT_CONFIGURED'); assert.equal(g.calls.length, 0);
  assert.throws(() => D.nearbyRequestBody({ center: CENTER, effectiveRadiusMeters: 9000, category: BASE.categories[0] }, BASE), /máximo/);
});

// ------------------------------------------------------------------------------------------ provider request
test('Nearby Search (New): POST, explicit FieldMask (no wildcard), ≤ 20 results, category types, DISTANCE default, pt-BR, key only in the request header', async () => {
  const { svc, g } = setup();
  await svc.nearbyPlaces(q({ rank: undefined, radius: '4000' }));
  const c = g.calls[0];
  assert.equal(c.method, 'POST'); assert.equal(c.url, 'https://places.googleapis.com/v1/places:searchNearby');
  assert.equal(c.headers['X-Goog-FieldMask'], 'places.id,places.displayName,places.location,places.primaryType,places.types,places.formattedAddress,places.rating,places.userRatingCount');
  assert.ok(!c.headers['X-Goog-FieldMask'].includes('*') && !/reviews|editorialSummary|OpeningHours|PhoneNumber|websiteUri/.test(c.headers['X-Goog-FieldMask']));
  assert.equal(c.headers['X-Goog-Api-Key'], FAKE_KEY);
  assert.ok(c.body.maxResultCount <= 20); assert.deepEqual(c.body.includedTypes, ['supermarket', 'grocery_store']); assert.equal(c.body.rankPreference, 'DISTANCE');
  assert.equal(c.body.languageCode, 'pt-BR'); assert.deepEqual(c.body.locationRestriction.circle.center, CENTER, 'center = validated development coordinate, not the user');
  assert.ok(!JSON.stringify(c.body).match(/customer|email|budget/i), 'no customer data sent to Google (§228)');
  assert.throws(() => D.fieldMask(['*']), /curinga/); assert.throws(() => D.fieldMask(['places.reviews'], BASE.provider.places.fieldMaskAllowlist), /allowlist/); assert.throws(() => D.fieldMask([]), /vazio/);
});
test('golden §423 + §558: unsupported category or a Google type from the client → LOCATION_CATEGORY_UNSUPPORTED, no call', async () => {
  const { svc, g } = setup();
  for (const c of ['supermarket', 'CASINOS', 'SUPERMARKETS;DROP', '', null]) await rejects(svc.nearbyPlaces(q({ category: c })), 'LOCATION_CATEGORY_UNSUPPORTED');
  await rejects(svc.nearbyPlaces(q({ rank: 'RELEVANCE' })), 'VALIDATION_ERROR');
  assert.equal(g.calls.length, 0);
});
test('category registry: every Google type is in the official Places (New) table A subset; an unknown type disables the category (LI-DQ-006)', () => {
  const reg = D.buildRegistry(BASE, 'viva-juara');
  assert.equal(reg.issues.length, 0); assert.equal(reg.enabled.length, 12);
  assert.equal(BASE.placeTypeTable.sourceUrl, 'https://developers.google.com/maps/documentation/places/web-service/place-types');
  const bad = clone(BASE); bad.categories[8].googleIncludedTypes = ['beach', 'praia_inventada'];
  const r2 = D.buildRegistry(bad); assert.equal(r2.byCode.BEACHES.status, 'DISABLED_INVALID_TYPES'); assert.equal(r2.issues[0].rule, 'LI-DQ-006');
  assert.equal(D.resolveCategory('BEACHES', r2).code, 'LOCATION_CATEGORY_UNSUPPORTED');
});

// ------------------------------------------------------------------------------------------ mapping + post-filter
test('golden §417/§418: 7,999 m kept, 8,100 m removed by the Haversine post-filter; invalid results dropped; own DTO only', async () => {
  const g = fakeGoogle({ places: [gPlace('PlaceKEEP00001', 7999), gPlace('PlaceDROP00001', 8100, { bearing: 200 }), { id: 'PlaceNONAME01', location: at(100) }, gPlace('bad id', 50), gPlace('PlaceNEAR00001', 150, { rating: null, noAddress: true })] });
  const { svc } = setup({ g });
  const out = await svc.nearbyPlaces(q());
  assert.deepEqual(out.places.map(p => p.providerPlaceId), ['PlaceNEAR00001', 'PlaceKEEP00001'], 'sorted by straight-line distance');
  const near = out.places[0];
  assert.ok(Math.abs(near.straightLineDistanceMeters - 150) < 0.5); assert.ok(!('rating' in near) || near.rating === undefined, 'rating absent, never 0'); assert.equal(near.formattedAddress, undefined);
  assert.ok(!('displayName' in near) && !('id' in near), 'Google field names stay in the adapter');
  assert.equal(out.resultCount, 2); assert.match(out.summaryText, /A busca retornou 2 resultados de supermercados em até 8 km/); assert.ok(!/todos/i.test(out.summaryText));
  assert.equal(out.attribution.text, 'Dados de locais: Google Maps'); assert.equal(out.persisted, false); assert.equal(out.freshness.status, 'CURRENT');
});
test('golden §427: empty provider answer is an empty result, not a provider error', async () => {
  const { svc } = setup({ g: fakeGoogle({ places: [] }) });
  const out = await svc.nearbyPlaces(q()); assert.equal(out.places.length, 0); assert.match(out.summaryText, /não retornou/);
});
test('Place IDs only are persisted (PLACE_ID_ONLY), partitioned by organization and location version', async () => {
  const { svc, placeRefs } = setup();
  await svc.nearbyPlaces(q());
  const all = placeRefs._all(); assert.equal(all.length, 2);
  for (const r of all) { assert.deepEqual(Object.keys(r).sort(), ['categoryCode', 'developmentId', 'locationVersion', 'organizationId', 'provider', 'providerPlaceId', 'recordedAt', 'withinMaxRadius']); assert.equal(r.locationVersion, 'loc-1'); }
  assert.equal(D.contentPolicy('PLACE_RESULT', BASE).persistenceMode, 'NO_PERSIST'); assert.equal(D.contentPolicy('REVIEW', BASE).persistenceMode, 'NO_PERSIST');
});

// ------------------------------------------------------------------------------------------ errors, retry, outage
test('golden §419: Places outage → bounded retry (2 attempts) then provider-neutral GOOGLE_PLACES_UNAVAILABLE; no raw error or key leaks', async () => {
  const logs = []; const logger = { info: (m, f) => logs.push(f), warn: (m, f) => logs.push(f), error: (m, f) => logs.push(f) };
  const g = fakeGoogle({ placesStatus: 503 }); const { svc } = setup({ g, logger });
  await assert.rejects(svc.nearbyPlaces(q()), e => { assert.equal(e.code, 'GOOGLE_PLACES_UNAVAILABLE'); assert.equal(e.status, 503); assert.equal(e.message, 'Dados do entorno temporariamente indisponíveis.'); assert.ok(!JSON.stringify(e.details).includes('internal provider detail')); return true; });
  assert.equal(g.calls.length, 2);
  assert.ok(!JSON.stringify(logs).includes(FAKE_KEY), 'key never logged');
});
test('error mapping: quota 429 → QUOTA_EXCEEDED (no retry), 403 → AUTH_ERROR, 400 → INVALID_REQUEST, timeout → UNAVAILABLE', async () => {
  const cases = [[{ placesStatus: 429, errorBody: { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } } }, 'GOOGLE_PLACES_QUOTA_EXCEEDED', 1], [{ placesStatus: 429 }, 'GOOGLE_PROVIDER_RATE_LIMIT', 2],
    [{ placesStatus: 403 }, 'GOOGLE_PROVIDER_AUTH_ERROR', 1], [{ placesStatus: 400 }, 'GOOGLE_PLACES_INVALID_REQUEST', 1], [{ hang: true }, 'GOOGLE_PLACES_UNAVAILABLE', 2]];
  for (const [o, code, n] of cases) { const g = fakeGoogle(o); const { svc } = setup({ g }); await rejects(svc.nearbyPlaces(q()), code); assert.equal(g.calls.length, n, code); }
});
test('server key missing, rate-limit numbers null or provider terms not reviewed → GOOGLE_MAPS_NOT_CONFIGURED, no call', async () => {
  const variants = [{ env: {} }, { cfg: (() => { const c = testCfg(); c.rateLimit.placesRequestsPerMinute = null; return c; })() }, { cfg: (() => { const c = testCfg(); c.providerPolicy.reviewedAt = null; return c; })() }];
  for (const v of variants) { const g = fakeGoogle(); const { svc } = setup({ ...v, g }); await assert.rejects(svc.nearbyPlaces(q()), e => e.code === 'GOOGLE_MAPS_NOT_CONFIGURED' && Array.isArray(e.details.missing)); assert.equal(g.calls.length, 0); }
});
test('internal rate limit per user and single-flight dedupe of identical in-flight searches', async () => {
  const cfg = testCfg(); cfg.rateLimit.placesRequestsPerMinute = 1;
  const g = fakeGoogle(); const { svc } = setup({ cfg, g });
  const [a, b] = await Promise.all([svc.nearbyPlaces(q()), svc.nearbyPlaces(q())]);
  assert.equal(g.calls.length, 1, 'single-flight'); assert.equal(a, b);
  await rejects(svc.nearbyPlaces(q({ radius: '4000' })), 'LOCATION_RATE_LIMITED');
  const rl = createRateLimiter(); assert.equal(rl.check('k', null).notConfigured, true);
});
test('golden §431: tenant A cannot read development B (same answer as non-existent)', async () => {
  const { svc, g } = setup();
  await rejects(svc.nearbyPlaces(q({ organizationId: 'org_other' })), 'DEVELOPMENT_NOT_FOUND');
  await rejects(svc.environmentMapConfig({ organizationId: 'org_other', developmentId: DEV }), 'DEVELOPMENT_NOT_FOUND');
  await rejects(svc.nearbyPlaces(q({ organizationId: null })), 'TENANT_CONTEXT_REQUIRED');
  assert.equal(g.calls.length, 0);
});

// ------------------------------------------------------------------------------------------ routes
test('routes on demand: only a place returned in scope; DRIVE, minimal FieldMask, origin = center; road distance may exceed 8 km', async () => {
  const { svc, g } = setup();
  await rejects(svc.routeEstimate({ organizationId: ORG, developmentId: DEV, body: { providerPlaceId: 'PlaceAAAAAAAA1', travelMode: 'DRIVE' } }), 'LOCATION_PLACE_NOT_IN_SCOPE');
  assert.equal(g.routes().length, 0, 'no route before a search returned the place');
  await svc.nearbyPlaces(q());
  assert.equal(g.routes().length, 0, 'searching never computes routes (§135)');
  const r = await svc.routeEstimate({ organizationId: ORG, developmentId: DEV, body: { providerPlaceId: 'PlaceAAAAAAAA2', travelMode: 'DRIVE' } });
  const c = g.routes()[0];
  assert.equal(c.url, 'https://routes.googleapis.com/directions/v2:computeRoutes'); assert.equal(c.headers['X-Goog-FieldMask'], 'routes.distanceMeters,routes.duration');
  assert.equal(c.body.travelMode, 'DRIVE'); assert.deepEqual(c.body.origin.location.latLng, CENTER); assert.equal(c.body.destination.placeId, 'PlaceAAAAAAAA2');
  assert.deepEqual(r.routeSummary, { mode: 'DRIVE', distanceMeters: 9400, durationSeconds: 754, trafficAware: false, computedAt: '2026-10-16T12:00:00.000Z' });
  assert.ok(r.routeSummary.distanceMeters > 8000, 'route can exceed 8 km while the destination is inside the circle (§530)');
  assert.equal(r.labels.distance, 'De carro'); assert.equal(r.labels.duration, 'Tempo estimado'); assert.equal(r.persisted, false);
});
test('golden §420: Routes outage → GOOGLE_ROUTES_UNAVAILABLE (place stays, Places unaffected); bad bodies → VALIDATION_ERROR', async () => {
  const g = fakeGoogle({ routesStatus: 500 }); const { svc } = setup({ g });
  const out = await svc.nearbyPlaces(q());
  await rejects(svc.routeEstimate({ organizationId: ORG, developmentId: DEV, body: { providerPlaceId: 'PlaceAAAAAAAA1', travelMode: 'DRIVE' } }), 'GOOGLE_ROUTES_UNAVAILABLE');
  assert.equal(out.places.length, 2);
  for (const body of [{ providerPlaceId: 'PlaceAAAAAAAA1', travelMode: 'WALK' }, { providerPlaceId: 'PlaceAAAAAAAA1', travelMode: 'DRIVE', url: 'https://x' }, { providerPlaceId: '../x', travelMode: 'DRIVE' }, null, [1]])
    await rejects(svc.routeEstimate({ organizationId: ORG, developmentId: DEV, body }), 'VALIDATION_ERROR');
  const cfg = testCfg(); cfg.developments[DEV].intelligence.routesEnabled = false;
  const s2 = setup({ cfg }); await s2.svc.nearbyPlaces(q());
  await rejects(s2.svc.routeEstimate({ organizationId: ORG, developmentId: DEV, body: { providerPlaceId: 'PlaceAAAAAAAA1', travelMode: 'DRIVE' } }), 'GOOGLE_MAPS_NOT_CONFIGURED');
});

// ------------------------------------------------------------------------------------------ runtime config + coordinate governance
test('environment-map-config: safe runtime config, bounds derived from the 8 km circle, never a key', async () => {
  const { svc } = setup();
  const c = await svc.environmentMapConfig({ organizationId: ORG, developmentId: DEV });
  assert.equal(c.enabled, true); assert.equal(c.state, 'AVAILABLE'); assert.deepEqual(c.center, CENTER); assert.equal(c.maxRadiusMeters, 8000);
  assert.ok(Math.abs(D.haversineMeters(CENTER, { latitude: c.viewportBounds.north, longitude: CENTER.longitude }) - 8000) < 1);
  assert.equal(c.categories.length, 12); assert.equal(c.routesEnabled, true); assert.equal(c.provenance.validatedBy, 'tester');
  const s = JSON.stringify(c); assert.ok(!s.includes(FAKE_KEY) && !s.includes('fake-browser-key') && !/apiKey|X-Goog/i.test(s));
});
test('golden §432 + §383: coordinate change DRAFT → REVIEW → APPROVED (preview + distinct approver) → PUBLISHED, audited; new version invalidates scope', async () => {
  const { svc, g, locations } = setup();
  await svc.nearbyPlaces(q());
  await rejects(svc.proposeLocationChange({ organizationId: ORG, developmentId: DEV, actorId: 'u1', input: { proposedCenter: { latitude: 95, longitude: 0 }, sourceRef: 'x', reason: 'y', validationMethod: 'OFFICIAL_COORDINATE' } }), 'LOCATION_CHANGE_INVALID');
  await rejects(svc.proposeLocationChange({ organizationId: ORG, developmentId: DEV, actorId: 'u1', input: { proposedCenter: { latitude: 1.26, longitude: 2.5 }, reason: 'y', validationMethod: 'LLM_GUESS' } }), 'LOCATION_CHANGE_INVALID');
  const ch = await svc.proposeLocationChange({ organizationId: ORG, developmentId: DEV, actorId: 'u1', input: { proposedCenter: { latitude: 1.26, longitude: 2.5 }, sourceRef: 'fixture://kmz-v2', reason: 'Correção oficial', validationMethod: 'OFFICIAL_KML_KMZ' } });
  assert.equal(ch.status, 'DRAFT'); assert.deepEqual(ch.previousCenter, CENTER);
  await svc.transitionLocationChange({ organizationId: ORG, changeId: ch.id, to: 'REVIEW', actorId: 'u1' });
  await rejects(svc.transitionLocationChange({ organizationId: ORG, changeId: ch.id, to: 'APPROVED', actorId: 'u2' }), 'LOCATION_CHANGE_INVALID'); // preview mandatory
  await rejects(svc.transitionLocationChange({ organizationId: ORG, changeId: ch.id, to: 'APPROVED', actorId: 'u1', previewConfirmed: true }), 'LOCATION_CHANGE_INVALID'); // requester ≠ approver
  await rejects(svc.publishLocationChange({ organizationId: ORG, changeId: ch.id, actorId: 'u2' }), 'LOCATION_CHANGE_INVALID');
  await svc.transitionLocationChange({ organizationId: ORG, changeId: ch.id, to: 'APPROVED', actorId: 'u2', previewConfirmed: true });
  const audits = []; const pub = await svc.publishLocationChange({ organizationId: ORG, changeId: ch.id, actorId: 'u2', audit: e => audits.push(e) });
  assert.equal(pub.location.version, 'loc-2'); assert.equal(pub.location.validatedBy, 'u2'); assert.equal(audits[0].event, 'DEVELOPMENT_LOCATION_CENTER_CHANGED'); assert.equal(locations._audit.length, 1);
  await rejects(svc.routeEstimate({ organizationId: ORG, developmentId: DEV, body: { providerPlaceId: 'PlaceAAAAAAAA1', travelMode: 'DRIVE' } }), 'LOCATION_PLACE_NOT_IN_SCOPE'); // old version refs no longer count
  await svc.nearbyPlaces(q()); assert.deepEqual(g.places().at(-1).body.locationRestriction.circle.center, { latitude: 1.26, longitude: 2.5 });
  const cfg = testCfg(); cfg.locationChangePolicy.requireDistinctApprover = null; const s2 = setup({ cfg });
  const c2 = await s2.svc.proposeLocationChange({ organizationId: ORG, developmentId: DEV, actorId: 'u1', input: { proposedCenter: { latitude: 1.26, longitude: 2.5 }, sourceRef: 's', reason: 'r', validationMethod: 'OFFICIAL_COORDINATE' } });
  await s2.svc.transitionLocationChange({ organizationId: ORG, changeId: c2.id, to: 'REVIEW', actorId: 'u1' });
  await rejects(s2.svc.transitionLocationChange({ organizationId: ORG, changeId: c2.id, to: 'APPROVED', actorId: 'u2', previewConfirmed: true }), 'LOCATION_POLICY_NOT_CONFIGURED');
});

// ------------------------------------------------------------------------------------------ HTTP controller (semantic proxy only)
test('controller: only category/radius/rank accepted; ?googleType / ?fieldMask / ?url → 400 before any provider call; envelope, no-store', async () => {
  const { svc, g } = setup(); const router = createRouter();
  S.registerSurroundingsRoutes(router, { surroundings: svc });
  assert.deepEqual(router.routes.map(r => `${r.method} ${r.template}`).sort(), Object.keys(S.ROUTE_POLICIES).sort());
  const run = async (method, url, body) => { const u = new URL(url, 'http://x'); const { route, params } = router.match(method, u.pathname); return route.handler({ params, query: u.searchParams, requestId: 'rq1', access: { resource: { organizationId: ORG } }, principal: { actorId: 'u1' }, readBody: async () => body }); };
  for (const extra of ['googleType=casino', 'fieldMask=*', 'url=https://evil', 'radius=4000']) await rejects(run('GET', `/api/v1/developments/${DEV}/nearby-places?category=SUPERMARKETS&radius=8000&${extra}`), 'VALIDATION_ERROR');
  assert.equal(g.calls.length, 0);
  const out = await run('GET', `/api/v1/developments/${DEV}/nearby-places?category=SUPERMARKETS&radius=2000`);
  assert.equal(out.status, 200); assert.equal(out.cache, 'no-store'); assert.equal(out.body.data.effectiveRadiusMeters, 2000); assert.equal(out.body.meta.requestId, 'rq1');
  const rt = await run('POST', `/api/v1/developments/${DEV}/route-estimates`, { providerPlaceId: 'PlaceAAAAAAAA1', travelMode: 'DRIVE' }); assert.equal(rt.body.data.routeSummary.mode, 'DRIVE');
  assert.ok(Object.values(S.ROUTE_POLICIES).every(p => p.permission === 'development.location_environment.read' && p.resource === 'development'));
});
test('OpenAPI fragment: three semantic paths, every error code in the module catalog, schemas without any key field', () => {
  const P = {}; oa.addPaths((p, m, o) => { (P[p] = P[p] || {})[m] = o; }, { DEV: ['DevelopmentId'], queryParam: (name, s) => ({ name, in: 'query', schema: s }) });
  assert.deepEqual(Object.keys(P).sort(), ['/api/v1/developments/{developmentId}/environment-map-config', '/api/v1/developments/{developmentId}/nearby-places', '/api/v1/developments/{developmentId}/route-estimates']);
  const own = new Set([...oa.ERROR_CODES, 'VALIDATION_ERROR', 'TENANT_CONTEXT_REQUIRED', 'UNAUTHORIZED', 'PERMISSION_DENIED', 'DEVELOPMENT_NOT_FOUND', 'CSRF_TOKEN_INVALID']);
  for (const ops of Object.values(P)) for (const o of Object.values(ops)) for (const codes of Object.values(o.errors)) for (const c of codes) assert.ok(own.has(c), c);
  assert.ok(!/apiKey|api_key|X-Goog-Api-Key/i.test(JSON.stringify(oa.schemas)));
  assert.equal(oa.schemas.NearbyPlacesResult.properties.places.maxItems, 20);
});
test('migration 016: forward + down scripts, no seeded coordinate, Place IDs only', () => {
  const dir = path.join(__dirname, '..', 'migrations'), up = fs.readFileSync(path.join(dir, '016_surroundings_location.sql'), 'utf8');
  assert.ok(fs.existsSync(path.join(dir, 'down', '016_surroundings_location.down.sql')));
  assert.ok(!/INSERT\s+INTO/i.test(up), 'no seed: the official coordinate is never invented');
  const refs = up.slice(up.indexOf('CREATE TABLE surroundings_place_refs')); assert.ok(!/latitude|longitude|name|address|rating|review/i.test(refs.replace(/within_max_radius/g, '')));
  assert.match(up, /max_radius_m > 0 AND max_radius_m <= 8000/);
});
test('no Google key in source: backend module reads GOOGLE_MAPS_API_KEY from env only; no AIza-style literal anywhere in the module or config', () => {
  const files = [...fs.readdirSync(path.join(__dirname, '..', 'src', 'modules', 'surroundings')).map(f => path.join(__dirname, '..', 'src', 'modules', 'surroundings', f)), path.join(__dirname, '..', '..', 'src', 'config', 'surroundings', 'surroundings.config.js')];
  for (const f of files) assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(fs.readFileSync(f, 'utf8')), f);
  assert.equal(BASE.provider.serverKeyEnv, 'GOOGLE_MAPS_API_KEY');
  const g = fakeGoogle(); const c = google.createGoogleHttpClient({ http: g, apiKey: () => null, cfg: testCfg() });
  return assert.rejects(c.post('PLACES', 'https://places.googleapis.com/v1/places:searchNearby', {}, 'places.id'), e => e.code === 'GOOGLE_MAPS_NOT_CONFIGURED' && g.calls.length === 0);
});
