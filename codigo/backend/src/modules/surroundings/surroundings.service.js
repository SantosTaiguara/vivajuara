'use strict';
/* Topic 63 application services (DB-free; repositories and providers injected):
     environmentMapConfig  — GET  /api/v1/developments/:id/environment-map-config (safe runtime config, never a key)
     nearbyPlaces          — GET  /api/v1/developments/:id/nearby-places?category&radius&rank
     routeEstimate         — POST /api/v1/developments/:id/route-estimates { providerPlaceId, travelMode: DRIVE, trafficMode? }
     proposeLocationChange / transitionLocationChange / publishLocationChange — coordinate governance (audited)
   Service responsibilities (§111): tenant validation → development validation → radius / category / rank validation →
   feature + validated location → server provider config (key, rate-limit policy, provider-terms review) → internal rate
   limit → single-flight → provider call with fixed FieldMask → mapping → Haversine post-filter → Place-ID-only persistence
   → telemetry. Any failure before the provider call means ZERO provider requests. */
const domain = require('../../../../src/surroundings/surroundingsDomain.js');
const { AppError } = require('../../shared/http/errors');

const err = (code, details) => { const e = domain.ERRORS[code] || { status: 400, message: code }; return new AppError(e.status, code, e.message, details || null); };
const validation = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);

/** fixed-window limiter per scope key; refuses to run without configured numbers (deny by default, §218) */
function createRateLimiter({ now = () => Date.now() } = {}) {
  const windows = new Map();
  return {
    check(key, perMinute) {
      if (!(perMinute > 0)) return { ok: false, notConfigured: true };
      const minute = Math.floor(now() / 60000), k = `${key}|${minute}`, n = (windows.get(k) || 0) + 1;
      windows.set(k, n); if (windows.size > 5000) for (const old of windows.keys()) { if (!old.endsWith(`|${minute}`)) windows.delete(old); }
      return n <= perMinute ? { ok: true } : { ok: false, retryAfterSeconds: 60 - Math.floor((now() % 60000) / 1000) };
    }
  };
}

/** usage telemetry: request counts per service (cost proxy, §212–§215) and provider latency; no PII in labels (§216) */
function createUsageTelemetry({ now = () => Date.now() } = {}) {
  const counters = {}, latency = [], usage = new Map();
  const inc = (name, n = 1) => { counters[name] = (counters[name] || 0) + n; };
  return {
    inc,
    provider: ({ service, statusClass, latencyMs }) => { inc(`google_${service.toLowerCase()}_request_total`); if (statusClass !== '2xx') inc('google_provider_error_total'); latency.push({ service, latencyMs }); if (latency.length > 500) latency.shift(); },
    usage({ service, organizationId, developmentId }) { const bucket = new Date(Math.floor(now() / 3600000) * 3600000).toISOString(), k = [service, organizationId, developmentId, bucket].join('|'); const m = usage.get(k) || { provider: 'GOOGLE_MAPS', service, organizationId, developmentId, requestCount: 0, timestampBucket: bucket }; m.requestCount++; usage.set(k, m); },
    snapshot: () => ({ counters: { ...counters }, usage: [...usage.values()].map(m => ({ ...m })), latencySamples: latency.length })
  };
}

function createSurroundingsService({ cfg, locations, placeRefs, places = null, routes = null, env = {}, logger = null, telemetry = createUsageTelemetry(), rateLimiter = createRateLimiter(), now = () => new Date() }) {
  const inflight = new Map();
  const log = (level, msg, fields) => { if (logger && logger[level]) logger[level](msg, fields); };

  async function load(organizationId, developmentId) {
    if (!organizationId) throw new AppError(400, 'TENANT_CONTEXT_REQUIRED', 'Organização ativa não resolvida');
    const rec = await locations.get(organizationId, developmentId);
    if (!rec) throw new AppError(404, 'DEVELOPMENT_NOT_FOUND', 'Empreendimento não encontrado', { developmentId }); // same answer as non-existent (§556)
    return rec;
  }
  const cfgWith = (developmentId, rec) => ({ ...cfg, developments: { ...cfg.developments, [developmentId]: rec } });
  const capabilityOf = (developmentId, rec) => domain.capability(developmentId, { browserKeyConfigured: !!env.browserKeyConfigured, serverKeyConfigured: !!env.serverKeyConfigured, emergencyDisabled: !!env.emergencyDisabled }, cfgWith(developmentId, rec));

  /** feature + location gate shared by places and routes (golden §415/§416: disabled, no provider request) */
  function gate(developmentId, rec, service) {
    const C = cfgWith(developmentId, rec);
    if (!cfg.featureFlag.enabled || env.emergencyDisabled || !rec.intelligence.enabled || !rec.location.googleMapsEnabled) throw err('GOOGLE_MAPS_NOT_CONFIGURED', { reason: !cfg.featureFlag.enabled ? 'FEATURE_FLAG_OFF' : env.emergencyDisabled ? 'EMERGENCY_DISABLED' : 'DEVELOPMENT_DISABLED' });
    const ready = domain.locationReadiness(rec.location, C);
    if (!ready.ready) throw err('GOOGLE_MAPS_LOCATION_UNVERIFIED', { coordinateStatus: ready.coordinateStatus });
    if (rec.intelligence.maxRadiusMeters !== rec.intelligence.approvedMaxRadiusMeters || rec.intelligence.maxRadiusMeters > cfg.radius.productMaxMeters) throw err('GOOGLE_MAPS_NOT_CONFIGURED', { reason: 'MAX_RADIUS_NOT_APPROVED' });
    const perMinute = service === 'ROUTES' ? cfg.rateLimit.routesRequestsPerMinute : cfg.rateLimit.placesRequestsPerMinute;
    const missing = [!env.serverKeyConfigured && 'SERVER_KEY', perMinute == null && 'RATE_LIMIT_POLICY', !cfg.providerPolicy.reviewedAt && 'PROVIDER_TERMS_REVIEW', service === 'ROUTES' && !rec.intelligence.routesEnabled && 'ROUTES_DISABLED', !(service === 'ROUTES' ? routes : places) && 'PROVIDER_ADAPTER'].filter(Boolean);
    if (missing.length) throw err('GOOGLE_MAPS_NOT_CONFIGURED', { missing });
    return perMinute;
  }
  function limit(service, perMinute, { organizationId, developmentId, actorKey }) {
    const scope = cfg.rateLimit.scope, key = `${service}|${scope === 'USER' ? `${organizationId}|${actorKey || 'anonymous'}` : scope === 'ORGANIZATION' ? organizationId : `${organizationId}|${developmentId}`}`;
    const r = rateLimiter.check(key, perMinute);
    if (!r.ok) { const e = err(r.notConfigured ? 'GOOGLE_MAPS_NOT_CONFIGURED' : 'LOCATION_RATE_LIMITED', r.notConfigured ? { missing: ['RATE_LIMIT_POLICY'] } : { retryAfterSeconds: r.retryAfterSeconds }); if (r.retryAfterSeconds) e.retryAfterSeconds = r.retryAfterSeconds; throw e; }
  }
  const providerFailure = (e, service) => { const code = e && domain.ERRORS[e.code] ? e.code : `GOOGLE_${service}_UNAVAILABLE`; telemetry.inc(`${service.toLowerCase()}_errors`); return err(code); }; // provider-neutral, no raw error (§181, §565)

  async function environmentMapConfig({ organizationId, developmentId }) {
    const rec = await load(organizationId, developmentId), C = cfgWith(developmentId, rec), cap = capabilityOf(developmentId, rec);
    const ready = domain.locationReadiness(rec.location, C), pol = domain.radiusPolicy(developmentId, C), reg = domain.buildRegistry(C, developmentId);
    telemetry.inc('maps_config_requests');
    return {
      enabled: cap.GOOGLE_MAPS_ENVIRONMENT, state: cap.state, coordinateStatus: ready.coordinateStatus, message: cap.message,
      center: ready.ready ? { ...rec.location.center } : null, // never a guessed center (§9, §10)
      locationVersion: rec.location.version, maxRadiusMeters: pol.maxRadiusMeters, selectableRadiiMeters: pol.selectableRadiiMeters, defaultRadiusMeters: pol.defaultRadiusMeters,
      viewportBounds: ready.ready ? domain.boundsAround(rec.location.center, pol.maxRadiusMeters) : null, strictBounds: rec.viewport.strictBounds,
      categories: cap.NEARBY_PLACES ? reg.enabled.map(c => ({ code: c.code, label: c.label, iconKey: c.iconKey })) : [],
      nearbyPlacesEnabled: cap.NEARBY_PLACES, routesEnabled: cap.ROUTE_ESTIMATES, mapId: env.mapId || undefined, attribution: { ...cfg.attribution }, provenance: domain.provenance(rec.location)
    };
  }

  async function nearbyPlaces({ organizationId, developmentId, actorKey, category, radius, rank, requestId }) {
    const rec = await load(organizationId, developmentId), C = cfgWith(developmentId, rec);
    const pol = domain.radiusPolicy(developmentId, C);
    const rr = domain.resolveRadius(radius, pol); if (!rr.ok) throw err('LOCATION_RADIUS_INVALID', rr.details);
    const rc = domain.resolveCategory(category, domain.buildRegistry(C, developmentId)); if (!rc.ok) throw err('LOCATION_CATEGORY_UNSUPPORTED', rc.details);
    const rk = domain.resolveRank(rank, C); if (!rk.ok) throw validation('Ordenação inválida', [{ field: 'rank', reason: 'enum', allowed: domain.RANKS }]);
    const perMinute = gate(developmentId, rec, 'PLACES');
    const center = rec.location.center, cat = rc.category, loc = rec.location;
    const key = `${organizationId}|${domain.requestKey({ organizationId, developmentId, locationVersion: loc.version, categoryCode: cat.code, categoryVersion: cat.version, radiusMeters: rr.effectiveRadiusMeters, rankPreference: rk.rank })}`;
    if (inflight.has(key)) { telemetry.inc('places_single_flight_hits'); return inflight.get(key); }
    limit('PLACES', perMinute, { organizationId, developmentId, actorKey });
    const p = (async () => {
      telemetry.inc('places_requests'); telemetry.usage({ service: 'PLACES_NEARBY', organizationId, developmentId });
      let out;
      try { out = await places.searchNearby({ center, effectiveRadiusMeters: rr.effectiveRadiusMeters, category: cat, rank: rk.rank }); }
      catch (e) { log('warn', 'surroundings provider error', { requestId, developmentId, categoryCode: cat.code, errorCode: e && e.code }); throw providerFailure(e, 'PLACES'); }
      const f = domain.postFilter(out.places, center, rr.effectiveRadiusMeters, cfg.radius.boundaryToleranceMeters);
      if (f.removed.length || f.invalid) log('info', 'surroundings post-filter', { requestId, developmentId, categoryCode: cat.code, removedOutsideRadius: f.removed.length, invalidResults: f.invalid });
      const sorted = domain.sortPlaces(f.kept, rk.rank).map(pl => ({ ...pl, categoryCode: cat.code }));
      const generatedAt = now().toISOString();
      await placeRefs.upsert(sorted.map(pl => ({ ...domain.persistablePlaceRef(pl, { categoryCode: cat.code, developmentId, organizationId, locationVersion: loc.version }), recordedAt: generatedAt }))); // Place IDs only (§94, §101)
      return { developmentId, center: { ...center }, locationVersion: loc.version, requestedRadiusMeters: rr.requestedRadiusMeters, effectiveRadiusMeters: rr.effectiveRadiusMeters, maxRadiusMeters: pol.maxRadiusMeters,
        categoryCode: cat.code, categoryVersion: cat.version, rankPreference: rk.rank, resultLimit: cat.maxResults, resultCount: sorted.length, places: sorted, provider: 'GOOGLE', generatedAt,
        freshness: { provider: 'GOOGLE', fetchedAt: generatedAt, categoryCode: cat.code, radiusMeters: rr.effectiveRadiusMeters, status: 'CURRENT' }, persisted: false,
        summaryText: domain.summaryText({ count: sorted.length, categoryLabel: cat.label, radiusMeters: rr.effectiveRadiusMeters }), attribution: { ...cfg.attribution } };
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function routeEstimate({ organizationId, developmentId, actorKey, body, requestId }) {
    const rec = await load(organizationId, developmentId);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw validation('Corpo inválido');
    const unknown = Object.keys(body).filter(k => !['providerPlaceId', 'travelMode', 'trafficMode'].includes(k));
    if (unknown.length) throw validation('Campos não suportados', unknown.map(field => ({ field, reason: 'unknown_field' })));
    if (typeof body.providerPlaceId !== 'string' || !domain.PLACE_ID_RE.test(body.providerPlaceId)) throw validation('providerPlaceId inválido', [{ field: 'providerPlaceId', reason: 'format' }]);
    if (body.travelMode !== 'DRIVE') throw validation('travelMode inválido', [{ field: 'travelMode', reason: 'enum', allowed: ['DRIVE'] }]);
    if (body.trafficMode != null && !cfg.provider.routes.trafficModes.includes(body.trafficMode)) throw validation('trafficMode inválido', [{ field: 'trafficMode', reason: 'enum', allowed: cfg.provider.routes.trafficModes }]);
    const perMinute = gate(developmentId, rec, 'ROUTES');
    // LI-DQ-007: the destination must be a place this development's search returned inside the circle (no arbitrary routing)
    if (!(await placeRefs.has({ organizationId, developmentId, locationVersion: rec.location.version, providerPlaceId: body.providerPlaceId }))) throw err('LOCATION_PLACE_NOT_IN_SCOPE', { rule: 'LI-DQ-007' });
    limit('ROUTES', perMinute, { organizationId, developmentId, actorKey });
    telemetry.inc('routes_requests'); telemetry.usage({ service: 'ROUTES', organizationId, developmentId });
    let r;
    try { r = await routes.computeRoute({ center: rec.location.center, providerPlaceId: body.providerPlaceId, trafficMode: body.trafficMode }); }
    catch (e) { log('warn', 'surroundings provider error', { requestId, developmentId, errorCode: e && e.code }); throw providerFailure(e, 'ROUTES'); }
    const computedAt = now().toISOString();
    return { developmentId, providerPlaceId: body.providerPlaceId, routeSummary: { ...r, computedAt }, persisted: false, labels: { distance: 'De carro', duration: 'Tempo estimado' },
      note: 'O local está dentro do raio de 8 km; o trajeto por vias pode ser maior.', attribution: { ...cfg.attribution } };
  }

  // -------------------------------------------------------------- coordinate governance (development.location.validate)
  async function proposeLocationChange({ organizationId, developmentId, actorId, input }) {
    const rec = await load(organizationId, developmentId);
    const r = domain.createLocationChange({ current: rec.location, proposedCenter: input && input.proposedCenter, sourceRef: input && input.sourceRef, reason: input && input.reason, validationMethod: input && input.validationMethod, requestedBy: actorId });
    if (!r.ok) throw err(r.code, r.details);
    return locations.createChange(organizationId, r.change);
  }
  async function transitionLocationChange({ organizationId, changeId, to, actorId, previewConfirmed }) {
    const c = await locations.getChange(organizationId, changeId); if (!c) throw new AppError(404, 'NOT_FOUND', 'Alteração não encontrada');
    const r = domain.transitionLocationChange(c, to, { actor: actorId, previewConfirmed }, cfg); if (!r.ok) throw err(r.code, r.details);
    return locations.saveChange(organizationId, r.change);
  }
  async function publishLocationChange({ organizationId, changeId, actorId, audit = null }) {
    const c = await locations.getChange(organizationId, changeId); if (!c) throw new AppError(404, 'NOT_FOUND', 'Alteração não encontrada');
    const rec = await load(organizationId, c.developmentId);
    const r = domain.publishLocationChange(rec.location, c, { at: now().toISOString(), actor: actorId }); if (!r.ok) throw err(r.code, r.details);
    const saved = await locations.publish(organizationId, r.location, r.change, r.audit);
    if (audit) await audit(r.audit); // audited: center coordinate changed (§383)
    return { change: r.change, location: domain.provenance(saved.location), audit: r.audit };
  }

  return { environmentMapConfig, nearbyPlaces, routeEstimate, proposeLocationChange, transitionLocationChange, publishLocationChange, telemetry, inFlight: () => inflight.size };
}

/** env → provider presence flags only; the key itself is read lazily by the HTTP client and never stored on the service */
function providerEnv(env = process.env, cfg) {
  return { serverKeyConfigured: !!env[cfg.provider.serverKeyEnv], browserKeyConfigured: !!env[cfg.provider.browserKeyEnv], mapId: env[cfg.provider.mapIdEnv] || null, emergencyDisabled: env.GOOGLE_MAPS_EMERGENCY_DISABLED === 'true' };
}

module.exports = { createSurroundingsService, createRateLimiter, createUsageTelemetry, providerEnv };
