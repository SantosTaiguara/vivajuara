/* surroundings/surroundingsDomain.js — topic 63: location intelligence domain (Entorno, raio máximo de 8 km).
   Pure functions, no I/O, no provider SDK. Shared by the browser (App.surroundings.domain) and the backend
   (require('…/src/surroundings/surroundingsDomain.js')), so both apply the same radius, category, distance and copy rules.

   Invariants (spec §648): center = VALIDATED coordinate only · max radius 8000 m · client never widens it · Google
   technical max ≠ product max · explicit FieldMask, never '*' · ≤ 20 results · route on demand · straight line ≠ road ·
   only Place IDs may be persisted · attribution never removed · no verified coordinate → no environment map. */
(function () {
  const DOMAIN_VERSION = '63.1.0';
  const EARTH_RADIUS_M = 6371008.8; // IUGG mean Earth radius (Haversine on a sphere)
  const RANKS = Object.freeze(['DISTANCE', 'POPULARITY']);
  const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;
  const CATEGORY_RE = /^[A-Z][A-Z_]{1,40}$/;

  /** Provider-neutral error catalog (§180). status = HTTP status the backend answers with. */
  const ERRORS = Object.freeze({
    GOOGLE_MAPS_NOT_CONFIGURED: { status: 503, message: 'Entorno ainda não configurado para este empreendimento.' },
    GOOGLE_MAPS_LOCATION_UNVERIFIED: { status: 409, message: 'Coordenada oficial do empreendimento ainda não validada.' },
    GOOGLE_PLACES_UNAVAILABLE: { status: 503, message: 'Dados do entorno temporariamente indisponíveis.' },
    GOOGLE_PLACES_QUOTA_EXCEEDED: { status: 503, message: 'Dados do entorno temporariamente indisponíveis.' },
    GOOGLE_PLACES_INVALID_REQUEST: { status: 502, message: 'Dados do entorno temporariamente indisponíveis.' },
    GOOGLE_ROUTES_UNAVAILABLE: { status: 503, message: 'Não foi possível calcular o trajeto agora.' },
    GOOGLE_ROUTES_QUOTA_EXCEEDED: { status: 503, message: 'Não foi possível calcular o trajeto agora.' },
    GOOGLE_PROVIDER_AUTH_ERROR: { status: 503, message: 'Dados do entorno temporariamente indisponíveis.' },
    GOOGLE_PROVIDER_RATE_LIMIT: { status: 503, message: 'Dados do entorno temporariamente indisponíveis.' },
    LOCATION_CATEGORY_UNSUPPORTED: { status: 422, message: 'Categoria de entorno não suportada.' },
    LOCATION_RADIUS_INVALID: { status: 422, message: 'Raio não permitido. Use 2, 4, 6 ou 8 km.' },
    LOCATION_PLACE_NOT_IN_SCOPE: { status: 422, message: 'Este local não foi retornado por uma busca do entorno deste empreendimento. Refaça a busca.' },
    LOCATION_POLICY_NOT_CONFIGURED: { status: 409, message: 'Política de validação de coordenada ainda não definida.' },
    LOCATION_CHANGE_INVALID: { status: 422, message: 'Alteração de coordenada inválida.' },
    LOCATION_RATE_LIMITED: { status: 429, message: 'Muitas consultas ao entorno; tente novamente em instantes.' }
  });

  const cfgOf = c => c || (typeof App !== 'undefined' && App && App.surroundings && App.surroundings.config) || (typeof require === 'function' ? require('../config/surroundings/surroundings.config.js') : null);
  const fail = (code, details) => ({ ok: false, code, message: (ERRORS[code] || {}).message || code, details: details || null });
  const isNum = v => typeof v === 'number' && Number.isFinite(v);

  // ------------------------------------------------------------------ coordinates (§7–§13, LI-DQ-001..003)
  /** validateCoordinate({latitude, longitude}) → issues[] (empty = valid). No rounding (§491). */
  function validateCoordinate(p) {
    const issues = [];
    if (!p || typeof p !== 'object') return [{ rule: 'LI-DQ-001', reason: 'MISSING' }];
    if (!isNum(p.latitude) || p.latitude < -90 || p.latitude > 90) issues.push({ rule: 'LI-DQ-002', reason: 'LATITUDE_OUT_OF_RANGE' });
    if (!isNum(p.longitude) || p.longitude < -180 || p.longitude > 180) issues.push({ rule: 'LI-DQ-003', reason: 'LONGITUDE_OUT_OF_RANGE' });
    return issues;
  }
  /** locationReadiness(DevelopmentLocationConfig) → { ready, coordinateStatus: VALIDATED | NOT_VALIDATED | REJECTED | INVALID, code, message } */
  function locationReadiness(loc, cfg) {
    const C = cfgOf(cfg);
    if (!loc) return { ready: false, coordinateStatus: 'NOT_VALIDATED', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated };
    if (loc.locationStatus === 'REJECTED') return { ready: false, coordinateStatus: 'REJECTED', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated };
    if (loc.locationStatus !== 'VALIDATED' || !loc.center) return { ready: false, coordinateStatus: 'NOT_VALIDATED', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated };
    const issues = validateCoordinate(loc.center);
    if (issues.length) return { ready: false, coordinateStatus: 'INVALID', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated, issues };
    if (!loc.sourceRef || !loc.validationMethod || !loc.validatedBy || !loc.validatedAt) return { ready: false, coordinateStatus: 'NOT_VALIDATED', code: 'GOOGLE_MAPS_LOCATION_UNVERIFIED', message: C.copy.notValidated, issues: [{ rule: 'LI-DQ-001', reason: 'PROVENANCE_MISSING' }] };
    return { ready: true, coordinateStatus: 'VALIDATED', code: null, message: null };
  }
  /** provenance(loc) → answers "de onde veio, quem validou, qual versão" (§13) without exposing anything secret */
  const provenance = loc => loc ? { developmentId: loc.developmentId, version: loc.version, locationStatus: loc.locationStatus, sourceRef: loc.sourceRef || null, validationMethod: loc.validationMethod || null, validatedBy: loc.validatedBy || null, validatedAt: loc.validatedAt || null } : null;

  // ------------------------------------------------------------------ geodesy (§122–§129, §493–§499)
  /** haversineMeters(a, b) → great-circle distance in meters (full precision, never rounded before filtering) */
  function haversineMeters(a, b) {
    const R = Math.PI / 180, dLat = (b.latitude - a.latitude) * R, dLng = (b.longitude - a.longitude) * R;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * R) * Math.cos(b.latitude * R) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  /** destination(center, bearingDeg, meters) → point (used by tests/fixtures and bounds) */
  function destination(c, bearingDeg, d) {
    const R = Math.PI / 180, δ = d / EARTH_RADIUS_M, θ = bearingDeg * R, φ1 = c.latitude * R, λ1 = c.longitude * R;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    return { latitude: φ2 / R, longitude: ((λ2 / R + 540) % 360) - 180 };
  }
  /** boundsAround(center, radius) → GeoBounds {north, south, east, west} enclosing the circle (viewport rule §63, §68) */
  function boundsAround(c, r) {
    const n = destination(c, 0, r), s = destination(c, 180, r), e = destination(c, 90, r), w = destination(c, 270, r);
    const dLng = Math.max(Math.abs(e.longitude - c.longitude), Math.abs(c.longitude - w.longitude)) * 1.0005; // small widening: meridians converge
    return { north: n.latitude, south: s.latitude, east: c.longitude + dLng, west: c.longitude - dLng };
  }

  // ------------------------------------------------------------------ radius policy (§2–§4, §81–§86, §411–§414)
  function radiusPolicy(developmentId, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId];
    if (!d) return null;
    const max = Math.min(d.location.maxNearbyRadiusMeters, d.intelligence.maxRadiusMeters, C.radius.productMaxMeters);
    return { developmentId, maxRadiusMeters: max, selectableRadiiMeters: d.intelligence.selectableRadiiMeters.filter(r => r > 0 && r <= max), defaultRadiusMeters: d.intelligence.defaultRadiusMeters, toleranceMeters: C.radius.boundaryToleranceMeters };
  }
  /** resolveRadius(requested, policy) → { ok, requestedRadiusMeters, effectiveRadiusMeters } | INVALID_RADIUS. Never clamps silently (§412). */
  function resolveRadius(requested, policy) {
    const s = typeof requested === 'number' ? String(requested) : typeof requested === 'string' ? requested.trim() : '';
    if (!/^\d{1,6}$/.test(s)) return { ...fail('LOCATION_RADIUS_INVALID', { reason: 'INVALID_RADIUS', allowedRadiiMeters: policy.selectableRadiiMeters }), reason: 'INVALID_RADIUS' };
    const r = Number(s);
    if (!(r > 0) || r > policy.maxRadiusMeters || !policy.selectableRadiiMeters.includes(r)) return { ...fail('LOCATION_RADIUS_INVALID', { reason: 'INVALID_RADIUS', requested: r, allowedRadiiMeters: policy.selectableRadiiMeters, maxRadiusMeters: policy.maxRadiusMeters }), reason: 'INVALID_RADIUS' };
    return { ok: true, requestedRadiusMeters: r, effectiveRadiusMeters: Math.min(r, policy.maxRadiusMeters) };
  }

  // ------------------------------------------------------------------ category registry (§44–§53, LI-DQ-006)
  /** buildRegistry(cfg) → { categories (validated), byCode, issues }. A category with a type outside the official table is DISABLED. */
  function buildRegistry(cfg, developmentId) {
    const C = cfgOf(cfg), table = new Set(C.placeTypeTable.types), issues = [];
    const enabledCodes = developmentId && C.developments[developmentId] ? new Set(C.developments[developmentId].intelligence.enabledCategoryCodes) : null;
    const categories = C.categories.map(c => {
      const bad = [...(c.googleIncludedTypes || []), ...(c.googleExcludedTypes || [])].filter(t => !table.has(t));
      if (bad.length) issues.push({ rule: 'LI-DQ-006', categoryCode: c.code, reason: 'UNSUPPORTED_PROVIDER_TYPE', types: bad });
      if (!c.googleIncludedTypes || !c.googleIncludedTypes.length) issues.push({ rule: 'LI-DQ-006', categoryCode: c.code, reason: 'NO_PROVIDER_TYPE' });
      const usable = c.enabled && !bad.length && c.googleIncludedTypes && c.googleIncludedTypes.length > 0 && (!enabledCodes || enabledCodes.has(c.code));
      return Object.freeze({ ...c, maxResults: Math.min(c.maxResults, C.provider.places.maxResultCountCap), status: usable ? 'ENABLED' : bad.length ? 'DISABLED_INVALID_TYPES' : 'DISABLED' });
    }).sort((a, b) => a.displayOrder - b.displayOrder);
    const byCode = Object.fromEntries(categories.map(c => [c.code, c]));
    return { categories, byCode, enabled: categories.filter(c => c.status === 'ENABLED'), issues };
  }
  /** resolveCategory(code, registry) → { ok, category } | LOCATION_CATEGORY_UNSUPPORTED. Category codes only — never a Google type from the client (§558). */
  function resolveCategory(code, registry) {
    if (typeof code !== 'string' || !CATEGORY_RE.test(code)) return fail('LOCATION_CATEGORY_UNSUPPORTED', { category: typeof code === 'string' ? code.slice(0, 40) : null });
    const c = registry.byCode[code];
    if (!c || c.status !== 'ENABLED') return fail('LOCATION_CATEGORY_UNSUPPORTED', { category: code });
    return { ok: true, category: c };
  }
  const resolveRank = (rank, cfg) => { const C = cfgOf(cfg); if (rank == null || rank === '') return { ok: true, rank: C.provider.places.defaultRank }; return RANKS.includes(rank) ? { ok: true, rank } : { ok: false, code: 'VALIDATION_ERROR', details: { field: 'rank', allowed: RANKS } }; };

  // ------------------------------------------------------------------ field masks (§33–§37, §143–§144, §425)
  /** fieldMask(list, allowlist) → header value. Throws on '*', empty, or a field outside the allowlist (cost control). */
  function fieldMask(list, allowlist) {
    if (!Array.isArray(list) || !list.length) throw Object.assign(new Error('FieldMask vazio'), { code: 'FIELD_MASK_INVALID' });
    for (const f of list) {
      if (typeof f !== 'string' || f.includes('*')) throw Object.assign(new Error('FieldMask com curinga é proibido'), { code: 'FIELD_MASK_WILDCARD' });
      if (allowlist && !allowlist.includes(f)) throw Object.assign(new Error(`campo fora da allowlist: ${f}`), { code: 'FIELD_MASK_NOT_ALLOWED' });
    }
    return list.join(',');
  }
  const placesFieldMask = cfg => { const P = cfgOf(cfg).provider.places; return fieldMask(P.fieldMask, P.fieldMaskAllowlist); };
  const routesFieldMask = (cfg, { polyline = false } = {}) => { const R = cfgOf(cfg).provider.routes; return fieldMask(polyline && R.polylineEnabled ? [...R.fieldMask, 'routes.polyline.encodedPolyline'] : R.fieldMask, R.fieldMaskAllowlist); };

  // ------------------------------------------------------------------ provider request builders (adapter input, §31–§32, §139)
  /** nearbyRequestBody → Places API (New) searchNearby body. Radius already validated; capped again defensively. */
  function nearbyRequestBody({ center, effectiveRadiusMeters, category, rank }, cfg) {
    const C = cfgOf(cfg), P = C.provider.places;
    if (!(effectiveRadiusMeters > 0) || effectiveRadiusMeters > C.radius.productMaxMeters) throw Object.assign(new Error('raio acima do máximo do produto'), { code: 'LOCATION_RADIUS_INVALID' });
    const body = { includedTypes: [...category.googleIncludedTypes], maxResultCount: Math.max(1, Math.min(category.maxResults, P.maxResultCountCap)),
      locationRestriction: { circle: { center: { latitude: center.latitude, longitude: center.longitude }, radius: effectiveRadiusMeters } },
      rankPreference: RANKS.includes(rank) ? rank : P.defaultRank, languageCode: P.languageCode, regionCode: P.regionCode };
    if (category.googleExcludedTypes && category.googleExcludedTypes.length) body.excludedTypes = [...category.googleExcludedTypes];
    return body;
  }
  /** routeRequestBody → Routes API computeRoutes body: origin = Development.center (never the user, §229) */
  function routeRequestBody({ center, providerPlaceId, trafficMode }, cfg) {
    const R = cfgOf(cfg).provider.routes, tm = R.trafficModes.includes(trafficMode) ? trafficMode : R.defaultTrafficMode;
    return { origin: { location: { latLng: { latitude: center.latitude, longitude: center.longitude } } }, destination: { placeId: providerPlaceId },
      travelMode: 'DRIVE', routingPreference: tm, computeAlternativeRoutes: false, languageCode: R.languageCode, units: R.units };
  }

  // ------------------------------------------------------------------ results (§92, §122–§129, §255–§258, §333–§336)
  /** validPlace: Place ID + name + location are mandatory to be shown (§333) */
  const validPlace = p => !!p && typeof p.providerPlaceId === 'string' && PLACE_ID_RE.test(p.providerPlaceId) && typeof p.name === 'string' && p.name.trim() !== '' && !validateCoordinate(p.location).length;
  /** withDistances(places, center) → adds straightLineDistanceMeters (full precision) */
  const withDistances = (places, center) => places.map(p => ({ ...p, straightLineDistanceMeters: haversineMeters(center, p.location) }));
  /** postFilter: strict defensive filter (§125). Tolerance is technical (≈1 m), never a wider business radius (§128). */
  function postFilter(places, center, effectiveRadiusMeters, toleranceMeters = 1) {
    const kept = [], removed = [];
    for (const p of withDistances(places.filter(validPlace), center)) (p.straightLineDistanceMeters <= effectiveRadiusMeters + Math.min(Math.max(toleranceMeters, 0), 5) ? kept : removed).push(p);
    return { kept, removed, invalid: places.length - kept.length - removed.length };
  }
  /** sortPlaces: DISTANCE → by straight line (deterministic, id as tie-break); POPULARITY → provider order preserved (§256–§257) */
  const sortPlaces = (places, rank) => rank === 'POPULARITY' ? places.slice() : places.slice().sort((a, b) => a.straightLineDistanceMeters - b.straightLineDistanceMeters || (a.providerPlaceId < b.providerPlaceId ? -1 : 1));
  /** narrowToRadius: 8 km → 2 km in the UI removes places outside the smaller filter (§428) */
  const narrowToRadius = (places, radius) => places.filter(p => p.straightLineDistanceMeters <= radius);

  // ------------------------------------------------------------------ copy & formatting (§130–§133, §156–§158, §339–§342, §497–§502, §536)
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }), nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  /** formatDistance: < 1 km → meters; ≥ 1 km → one decimal km (display only) */
  const formatDistance = m => !isNum(m) ? 'não disponível' : m < 1000 ? `${nf0.format(Math.round(m))} m` : `${nf1.format(Math.round(m / 100) / 10)} km`;
  /** formatDuration: seconds → "7 min" / "1 h 12 min" */
  function formatDuration(s) {
    if (!isNum(s) || s < 0) return 'não disponível';
    const min = Math.max(1, Math.round(s / 60)); if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), r = min % 60; return r ? `${h} h ${r} min` : `${h} h`;
  }
  const formatRadius = m => `${nf0.format(m / 1000)} km`;
  /** parseDuration: Google "123s" / "123.5s" → seconds (adapter responsibility, kept here so both sides agree, §501) */
  const parseDuration = v => { const m = /^(\d+(?:\.\d+)?)s$/.exec(String(v || '')); return m ? Number(m[1]) : null; };
  const formatRating = (rating, count) => !isNum(rating) ? null : `${nf1.format(rating)}${isNum(count) ? ` · ${new Intl.NumberFormat('pt-BR').format(count)} avaliações` : ''}`;
  /** summaryText: actual returned count, never the total universe (§157, §340, §536) */
  function summaryText({ count, categoryLabel, radiusMeters }) {
    const lab = String(categoryLabel || 'locais').toLowerCase();
    if (!count) return `A busca não retornou ${lab} no raio selecionado (${formatRadius(radiusMeters)}).`;
    return `A busca retornou ${count} ${count === 1 ? 'resultado' : 'resultados'} de ${lab} em até ${formatRadius(radiusMeters)} (linha reta).`;
  }
  const nearestText = (place, categoryLabel) => place ? `${categoryLabel} mais próximo encontrado: ${formatDistance(place.straightLineDistanceMeters)} em linha reta.` : null;
  const routeText = route => route ? `aproximadamente ${formatDuration(route.durationSeconds)} de carro, conforme estimativa do provedor no momento da consulta` : null;
  /** environmentSummary → NearbyEnvironmentSummary (§161): generated on demand, not persisted (§163) */
  function environmentSummary({ developmentId, maxRadiusMeters, results, generatedAt }) {
    return { developmentId, generatedAt, maxRadiusMeters, persisted: false,
      categories: results.map(r => { const n = r.places.length ? sortPlaces(r.places, 'DISTANCE')[0] : null;
        return { categoryCode: r.categoryCode, resultCount: r.places.length, nearestPlace: n ? { providerPlaceId: n.providerPlaceId, name: n.name, straightLineDistanceMeters: n.straightLineDistanceMeters } : undefined }; }) };
  }

  // ------------------------------------------------------------------ cache keys, content policy (§98–§104, §186–§188, §309–§318, §432)
  /** requestKey: tenant-partitioned and invalidated by location/category versions */
  const requestKey = k => ['GOOGLE', k.organizationId, k.developmentId, k.locationVersion, k.categoryCode, k.categoryVersion, k.radiusMeters, k.rankPreference].map(v => String(v == null ? '-' : v)).join('|');
  const contentPolicy = (contentType, cfg) => cfgOf(cfg).contentPolicies.find(p => p.contentType === contentType) || { contentType, persistenceMode: 'NO_PERSIST', maxTtlSeconds: null, attributionRequired: true };
  /** persistablePlaceRef(place) → the only thing that may be stored long-term: the Place ID (+ our own derived scope facts) */
  const persistablePlaceRef = (place, ctx) => ({ provider: 'GOOGLE', providerPlaceId: place.providerPlaceId, categoryCode: ctx.categoryCode, developmentId: ctx.developmentId, organizationId: ctx.organizationId, locationVersion: ctx.locationVersion, withinMaxRadius: true });

  // ------------------------------------------------------------------ provider errors (§180–§184, §219, §565)
  /** normalizeProviderError({ service: 'PLACES'|'ROUTES', status, network, timeout, reason }) → { code, transient } */
  function normalizeProviderError(e) {
    const svc = e.service === 'ROUTES' ? 'ROUTES' : 'PLACES';
    if (e.network || e.timeout) return { code: `GOOGLE_${svc}_UNAVAILABLE`, transient: true };
    const s = e.status;
    if (s === 401 || s === 403) return { code: e.reason === 'QUOTA' ? `GOOGLE_${svc}_QUOTA_EXCEEDED` : 'GOOGLE_PROVIDER_AUTH_ERROR', transient: false };
    if (s === 429) return { code: e.reason === 'QUOTA' ? `GOOGLE_${svc}_QUOTA_EXCEEDED` : 'GOOGLE_PROVIDER_RATE_LIMIT', transient: e.reason !== 'QUOTA' };
    if (s === 400 || s === 404) return { code: svc === 'PLACES' ? 'GOOGLE_PLACES_INVALID_REQUEST' : 'GOOGLE_ROUTES_UNAVAILABLE', transient: false };
    if ([500, 502, 503, 504].includes(s)) return { code: `GOOGLE_${svc}_UNAVAILABLE`, transient: true };
    return { code: `GOOGLE_${svc}_UNAVAILABLE`, transient: false };
  }

  // ------------------------------------------------------------------ capability gating (§274–§280) and data quality (§326)
  /** capability({ developmentId, env: { serverKeyConfigured, browserKeyConfigured, online } }) → flags + reasons */
  function capability(developmentId, env = {}, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId], reasons = [];
    if (!d) return { GOOGLE_MAPS_ENVIRONMENT: false, NEARBY_PLACES: false, ROUTE_ESTIMATES: false, reasons: ['DEVELOPMENT_NOT_CONFIGURED'], state: 'NOT_CONFIGURED', message: C.copy.notConfigured, BASE_MAP: false, baseMap: baseMap(developmentId, env, C) };
    const loc = locationReadiness(d.location, C);
    if (!C.featureFlag.enabled) reasons.push('FEATURE_FLAG_OFF');
    if (!d.intelligence.enabled || !d.location.googleMapsEnabled) reasons.push('DEVELOPMENT_DISABLED');
    if (!loc.ready) reasons.push('LOCATION_NOT_VALIDATED');
    if (d.intelligence.maxRadiusMeters !== d.intelligence.approvedMaxRadiusMeters || d.intelligence.maxRadiusMeters > C.radius.productMaxMeters) reasons.push('MAX_RADIUS_NOT_APPROVED');
    if (env.emergencyDisabled) reasons.push('EMERGENCY_DISABLED');
    const map = !reasons.length && !!env.browserKeyConfigured;
    if (!reasons.length && !env.browserKeyConfigured) reasons.push('BROWSER_KEY_NOT_CONFIGURED');
    const server = !!env.serverKeyConfigured && C.rateLimit.placesRequestsPerMinute != null && !!C.providerPolicy.reviewedAt;
    const nearby = map && server && buildRegistry(C, developmentId).enabled.length > 0;
    const routes = nearby && d.intelligence.routesEnabled && C.rateLimit.routesRequestsPerMinute != null;
    const offline = env.online === false;
    const state = offline ? 'OFFLINE' : !loc.ready ? 'NOT_VALIDATED' : !map ? 'NOT_CONFIGURED' : 'AVAILABLE';
    const bm = baseMap(developmentId, env, C);
    return { GOOGLE_MAPS_ENVIRONMENT: map && !offline, NEARBY_PLACES: nearby && !offline, ROUTE_ESTIMATES: routes && !offline, reasons, state, coordinateStatus: loc.coordinateStatus,
      message: state === 'OFFLINE' ? C.copy.offline : state === 'NOT_VALIDATED' ? C.copy.notValidated : state === 'NOT_CONFIGURED' ? C.copy.notConfigured : null,
      BASE_MAP: bm.available, baseMap: bm };
  }
  // ------------------------------------------------------------------ round 7: keyless base map (OpenStreetMap) of the Entorno
  /** baseMapProvider(cfg) → the enabled keyless provider named by environmentMap.baseMapProvider, or null */
  function baseMapProvider(cfg) {
    const C = cfgOf(cfg), em = C.environmentMap, list = C.baseMapProviders || [];
    const p = em && list.find(x => x.code === em.baseMapProvider);
    return p && p.enabled && p.requiresKey === false && /^https:\/\/[a-z0-9.-]+\/\{z\}\/\{x\}\/\{y\}\.png$/.test(p.tileUrlTemplate) && p.attribution && p.attribution.required && p.attribution.text ? p : null;
  }
  /** baseMap(developmentId, env) → { available, state: AVAILABLE | NOT_VALIDATED | NOT_CONFIGURED, provider, center, offline, message }.
      Independent of the Google flag/keys: it needs only the validated official coordinate and a keyless provider. Offline
      keeps it AVAILABLE (plan, rings and links still work); the tiles then fail and the view says so. */
  function baseMap(developmentId, env = {}, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId], p = baseMapProvider(C), em = C.environmentMap || {};
    if (!d) return { available: false, state: 'NOT_CONFIGURED', provider: null, center: null, offline: env.online === false, message: C.copy.notConfigured };
    const loc = locationReadiness(d.location, C);
    if (!loc.ready) return { available: false, state: 'NOT_VALIDATED', provider: p ? p.code : null, center: null, offline: env.online === false, message: C.copy.notValidated };
    if (!p) return { available: false, state: 'NOT_CONFIGURED', provider: null, center: null, offline: env.online === false, message: C.copy.notConfigured };
    return { available: true, state: 'AVAILABLE', provider: p.code, center: { lat: d.location.center.latitude, lon: d.location.center.longitude }, offline: env.online === false,
      message: env.online === false ? (em.copy && em.copy.offline) || C.copy.offline : null };
  }
  /** externalLinks(developmentId) → { openInMaps, directions } built ONLY from the validated official coordinate (no user data,
      no key, no place id, no tracking parameter); null when the coordinate is not validated */
  function externalLinks(developmentId, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId], L = C.environmentMap && C.environmentMap.externalLinks;
    if (!d || !L || !locationReadiness(d.location, C).ready) return null;
    const lat = d.location.center.latitude, lon = d.location.center.longitude, f = v => Number(v).toFixed(6);
    const fill = t => t.replace('{lat}', f(lat)).replace('{lon}', f(lon));
    return { openInMaps: fill(L.search), directions: fill(L.directions) };
  }
  /** dataQuality(developmentId) → LI-DQ-001..006 results (LI-DQ-005/007 run per request) */
  function dataQuality(developmentId, cfg) {
    const C = cfgOf(cfg), d = C.developments[developmentId], loc = d && d.location, reg = buildRegistry(C, developmentId);
    const center = loc && loc.center, cIssues = center ? validateCoordinate(center) : [];
    return [
      { rule: 'LI-DQ-001', label: 'Centro validado', pass: !!loc && locationReadiness(loc, C).ready },
      { rule: 'LI-DQ-002', label: 'Latitude válida', pass: !!center && !cIssues.some(i => i.rule === 'LI-DQ-002'), notApplicable: !center },
      { rule: 'LI-DQ-003', label: 'Longitude válida', pass: !!center && !cIssues.some(i => i.rule === 'LI-DQ-003'), notApplicable: !center },
      { rule: 'LI-DQ-004', label: 'Raio máximo ≤ 8.000 m aprovado', pass: !!d && d.intelligence.maxRadiusMeters <= C.radius.productMaxMeters && d.intelligence.maxRadiusMeters === d.intelligence.approvedMaxRadiusMeters && d.intelligence.selectableRadiiMeters.every(r => r > 0 && r <= d.intelligence.maxRadiusMeters) },
      { rule: 'LI-DQ-006', label: 'Categorias com tipos oficiais', pass: !reg.issues.length, issues: reg.issues }
    ];
  }

  // ------------------------------------------------------------------ deep link (§367–§371, §452)
  /** linkState(state) → semantic params only (no key, no PII, no pixels) */
  function linkState(s) {
    const out = { tab: 'environment' };
    if (s.selectedCategory && CATEGORY_RE.test(s.selectedCategory)) out.category = s.selectedCategory;
    if (isNum(s.selectedRadiusMeters)) out.radius = String(s.selectedRadiusMeters);
    if (s.selectedPlaceId && PLACE_ID_RE.test(s.selectedPlaceId)) out.selectedPlaceId = s.selectedPlaceId;
    return out;
  }
  /** restoreLinkState(params, { registry, policy }) → { state, status: COMPLETE | PARTIAL, issues } */
  function restoreLinkState(params, { registry, policy }) {
    const issues = [], st = { selectedCategory: undefined, selectedRadiusMeters: policy.defaultRadiusMeters, selectedPlaceId: undefined, rankPreference: 'DISTANCE', routeVisible: false };
    if (params.radius != null) { const r = resolveRadius(params.radius, policy); if (r.ok) st.selectedRadiusMeters = r.effectiveRadiusMeters; else issues.push('RADIUS_IGNORED'); }
    if (params.category != null) { const c = resolveCategory(params.category, registry); if (c.ok) st.selectedCategory = c.category.code; else issues.push('CATEGORY_IGNORED'); }
    if (params.selectedPlaceId != null) { if (PLACE_ID_RE.test(String(params.selectedPlaceId))) st.selectedPlaceId = String(params.selectedPlaceId); else issues.push('PLACE_IGNORED'); }
    return { state: st, status: issues.length ? 'PARTIAL' : 'COMPLETE', issues };
  }
  /** restoreSelection(state, places) → selected place kept only if still returned; otherwise PARTIAL with a message (§370, §429) */
  function restoreSelection(state, places) {
    if (!state.selectedPlaceId) return { state, status: 'COMPLETE', message: null };
    if (places.some(p => p.providerPlaceId === state.selectedPlaceId)) return { state, status: 'COMPLETE', message: null };
    return { state: { ...state, selectedPlaceId: undefined, routeVisible: false }, status: 'PARTIAL', message: 'O local do link não apareceu nesta busca; mostramos os resultados atuais.' };
  }

  // ------------------------------------------------------------------ external link (§362–§366, §587–§590)
  /** mapsUrl(place) → official Maps URLs search link; no key, no redirect parameter, no customer data */
  function mapsUrl(place) {
    if (!validPlace(place)) return null;
    const q = `${place.location.latitude},${place.location.longitude}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}&query_place_id=${encodeURIComponent(place.providerPlaceId)}`;
  }

  // ------------------------------------------------------------------ analytics payload (§286–§288)
  const radiusBucket = m => isNum(m) ? `${Math.round(m / 1000)}km` : 'unknown';
  const eventPayload = (name, { categoryCode, radiusMeters } = {}) => ({ name, props: { ...(categoryCode && CATEGORY_RE.test(categoryCode) ? { categoryCode } : {}), ...(isNum(radiusMeters) ? { radiusBucket: radiusBucket(radiusMeters) } : {}) } });

  // ------------------------------------------------------------------ DevelopmentLocationChange state machine (§383–§388, §392)
  const CHANGE_FLOW = Object.freeze({ DRAFT: ['REVIEW'], REVIEW: ['APPROVED', 'DRAFT'], APPROVED: ['PUBLISHED'], PUBLISHED: [] });
  const METHODS = Object.freeze(['OFFICIAL_GEOREFERENCE', 'OFFICIAL_KML_KMZ', 'OFFICIAL_COORDINATE', 'MANUAL_CONFIRMED', 'GEOCODED_AND_CONFIRMED']);
  /** createLocationChange → DRAFT. A coordinate always comes with an official sourceRef and a reason; never generated. */
  function createLocationChange({ current, proposedCenter, sourceRef, reason, validationMethod, requestedBy, id }) {
    const issues = validateCoordinate(proposedCenter);
    if (!sourceRef || typeof sourceRef !== 'string') issues.push({ reason: 'SOURCE_REF_REQUIRED' });
    if (!reason || typeof reason !== 'string') issues.push({ reason: 'REASON_REQUIRED' });
    if (!METHODS.includes(validationMethod)) issues.push({ reason: 'VALIDATION_METHOD_INVALID' });
    if (!requestedBy) issues.push({ reason: 'REQUESTED_BY_REQUIRED' });
    if (issues.length) return fail('LOCATION_CHANGE_INVALID', { issues });
    return { ok: true, change: { id: id || null, developmentId: current.developmentId, previousCenter: current.center || null, proposedCenter: { latitude: proposedCenter.latitude, longitude: proposedCenter.longitude },
      sourceRef, reason, validationMethod, requestedBy, approvedBy: null, previewConfirmedBy: null, status: 'DRAFT', baseVersion: current.version, version: null } };
  }
  /** transitionLocationChange(change, to, { actor, previewConfirmed }, cfg) → { ok, change } — approval needs preview (§392) and a configured approver policy */
  function transitionLocationChange(change, to, { actor, previewConfirmed } = {}, cfg) {
    const C = cfgOf(cfg);
    if (!(CHANGE_FLOW[change.status] || []).includes(to)) return fail('LOCATION_CHANGE_INVALID', { from: change.status, to });
    if (!actor) return fail('LOCATION_CHANGE_INVALID', { reason: 'ACTOR_REQUIRED' });
    if (to === 'APPROVED') {
      if (C.locationChangePolicy.previewRequired && !previewConfirmed) return fail('LOCATION_CHANGE_INVALID', { reason: 'PREVIEW_REQUIRED' });
      if (C.locationChangePolicy.requireDistinctApprover == null) return fail('LOCATION_POLICY_NOT_CONFIGURED', { field: 'locationChangePolicy.requireDistinctApprover' });
      if (C.locationChangePolicy.requireDistinctApprover && actor === change.requestedBy) return fail('LOCATION_CHANGE_INVALID', { reason: 'APPROVER_MUST_DIFFER' });
      return { ok: true, change: { ...change, status: 'APPROVED', approvedBy: actor, previewConfirmedBy: actor } };
    }
    return { ok: true, change: { ...change, status: to } };
  }
  /** publishLocationChange(location, change, { at }) → new VALIDATED DevelopmentLocationConfig version (old caches invalidated by version) */
  function publishLocationChange(location, change, { at, actor }) {
    if (change.status !== 'APPROVED') return fail('LOCATION_CHANGE_INVALID', { reason: 'NOT_APPROVED' });
    if (change.baseVersion !== location.version) return fail('LOCATION_CHANGE_INVALID', { reason: 'STALE_BASE_VERSION', currentVersion: location.version });
    const n = Number(String(location.version).replace(/^loc-/, '')) || 0, version = `loc-${n + 1}`;
    return { ok: true, change: { ...change, status: 'PUBLISHED', version }, location: { ...location, center: { ...change.proposedCenter }, locationStatus: 'VALIDATED', sourceRef: change.sourceRef, validationMethod: change.validationMethod, validatedBy: change.approvedBy, validatedAt: at, version },
      audit: { event: 'DEVELOPMENT_LOCATION_CENTER_CHANGED', developmentId: location.developmentId, fromVersion: location.version, toVersion: version, actor: actor || change.approvedBy, at } };
  }

  const api = { DOMAIN_VERSION, EARTH_RADIUS_M, RANKS, PLACE_ID_RE, ERRORS, CHANGE_FLOW, VALIDATION_METHODS: METHODS,
    validateCoordinate, locationReadiness, provenance, haversineMeters, destination, boundsAround, radiusPolicy, resolveRadius, buildRegistry, resolveCategory, resolveRank,
    fieldMask, placesFieldMask, routesFieldMask, nearbyRequestBody, routeRequestBody, validPlace, withDistances, postFilter, sortPlaces, narrowToRadius,
    formatDistance, formatDuration, formatRadius, parseDuration, formatRating, summaryText, nearestText, routeText, environmentSummary,
    requestKey, contentPolicy, persistablePlaceRef, normalizeProviderError, capability, baseMap, baseMapProvider, externalLinks, dataQuality, linkState, restoreLinkState, restoreSelection, mapsUrl,
    radiusBucket, eventPayload, createLocationChange, transitionLocationChange, publishLocationChange };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof App !== 'undefined' && App) { App.surroundings = App.surroundings || {}; App.surroundings.domain = api; }
})();
