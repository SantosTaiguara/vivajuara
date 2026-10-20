'use strict';
/* Google provider for topic 63 (server side only). Layers (spec §266–§271, §397–§398):
     GoogleHttpClient       → base URL, auth header (X-Goog-Api-Key), X-Goog-FieldMask, timeout, bounded retry, error mapping, telemetry
     GooglePlacesClient / GooglePlacesProviderAdapter  → Places API (New) searchNearby → NearbyPlace DTOs (Google field names stay here)
     GoogleRoutesClient / GoogleRoutesProviderAdapter  → Routes API computeRoutes → RouteSummary DTO (duration "123s" parsed here)
   The key comes from the server environment (GOOGLE_MAPS_API_KEY) through a getter; it is never logged, never returned,
   never part of an error. `http` is injected ({ request(url, { method, headers, body, signal }) → { status, json } }), so the
   tests use a fake Google and nothing here runs a real network call unless the default fetch client is passed in. */
const domain = require('../../../../src/surroundings/surroundingsDomain.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const QUOTA_RE = /quota|RESOURCE_EXHAUSTED/i;

/** fetchHttp(): default transport over global fetch (only used in production wiring) */
const fetchHttp = () => ({
  async request(url, { method, headers, body, signal }) {
    const r = await fetch(url, { method, headers, body, signal });
    let json = null; try { json = await r.json(); } catch (_) { json = null; }
    return { status: r.status, json };
  }
});

class ProviderError extends Error {
  constructor(code, { transient = false, status = null, service = null } = {}) { super(code); this.code = code; this.transient = transient; this.providerStatus = status; this.service = service; }
}

/** GoogleHttpClient — the only place that talks HTTP to Google */
function createGoogleHttpClient({ http, apiKey, cfg, telemetry = null, sleepFn = sleep }) {
  const H = cfg.provider.http;
  async function post(service, url, body, fieldMask) {
    const key = typeof apiKey === 'function' ? apiKey() : apiKey;
    if (!key) throw new ProviderError('GOOGLE_MAPS_NOT_CONFIGURED', { service });
    if (!fieldMask || fieldMask.includes('*')) throw new ProviderError('GOOGLE_PLACES_INVALID_REQUEST', { service }); // never a wildcard (§34)
    let attempt = 0, last = null;
    while (attempt < Math.max(1, H.maxAttempts)) {
      attempt++;
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), H.timeoutMs), t0 = Date.now();
      let res = null, err = null;
      try { res = await http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask }, body: JSON.stringify(body), signal: ctl.signal }); }
      catch (e) { err = e; } finally { clearTimeout(timer); }
      const timeout = !!err && (err.name === 'AbortError' || ctl.signal.aborted);
      if (telemetry) telemetry.provider({ service, statusClass: res ? `${String(res.status)[0]}xx` : timeout ? 'timeout' : 'network', latencyMs: Date.now() - t0 });
      if (res && res.status >= 200 && res.status < 300) return res.json || {};
      const reason = res && res.json && res.json.error && QUOTA_RE.test(`${res.json.error.status || ''} ${res.json.error.message || ''}`) && (res.status === 429 || res.status === 403) ? 'QUOTA' : null;
      const n = domain.normalizeProviderError({ service, status: res ? res.status : null, network: !!err && !timeout, timeout, reason });
      last = new ProviderError(n.code, { transient: n.transient, status: res ? res.status : null, service });
      const retryable = n.transient && (err ? H.retryOn.includes('NETWORK') : H.retryOn.includes(res.status));
      if (!retryable || attempt >= H.maxAttempts) break;
      await sleepFn(H.backoffBaseMs * 2 ** (attempt - 1)); // bounded exponential backoff (§182, §183)
    }
    throw last;
  }
  return { post };
}

/** GoogleNearbySearchResponse → NearbyPlace[] (provider DTO never leaves this function, §93, §270) */
function mapNearbyResponse(json, categoryCode) {
  const places = json && Array.isArray(json.places) ? json.places : [];
  return places.map(p => ({
    provider: 'GOOGLE', providerPlaceId: p && p.id, categoryCode,
    name: p && p.displayName && typeof p.displayName.text === 'string' ? p.displayName.text : null,
    primaryType: p && typeof p.primaryType === 'string' ? p.primaryType : undefined,
    types: p && Array.isArray(p.types) ? p.types.filter(t => typeof t === 'string').slice(0, 20) : undefined,
    location: p && p.location ? { latitude: p.location.latitude, longitude: p.location.longitude } : null,
    formattedAddress: p && typeof p.formattedAddress === 'string' ? p.formattedAddress : undefined, // missing → absent, never invented (§336)
    rating: p && typeof p.rating === 'number' ? p.rating : undefined,                              // missing → absent, never 0 (§335)
    userRatingCount: p && Number.isInteger(p.userRatingCount) ? p.userRatingCount : undefined
  }));
}

/** GooglePlacesProviderAdapter implements NearbyPlacesProvider.searchNearby */
function createGooglePlacesAdapter({ client, cfg }) {
  const mask = domain.placesFieldMask(cfg);
  return {
    providerCode: 'GOOGLE_MAPS', fieldMask: mask,
    async searchNearby({ center, effectiveRadiusMeters, category, rank }) {
      const body = domain.nearbyRequestBody({ center, effectiveRadiusMeters, category, rank }, cfg);
      const json = await client.post('PLACES', cfg.provider.places.endpoint, body, mask);
      return { places: mapNearbyResponse(json, category.code), request: { radius: body.locationRestriction.circle.radius, maxResultCount: body.maxResultCount, includedTypes: body.includedTypes, rankPreference: body.rankPreference } };
    }
  };
}

/** GoogleRoutesProviderAdapter implements RouteProvider.computeRoute */
function createGoogleRoutesAdapter({ client, cfg }) {
  return {
    providerCode: 'GOOGLE_MAPS',
    async computeRoute({ center, providerPlaceId, trafficMode }) {
      const body = domain.routeRequestBody({ center, providerPlaceId, trafficMode }, cfg);
      const json = await client.post('ROUTES', cfg.provider.routes.endpoint, body, domain.routesFieldMask(cfg));
      const r = json && Array.isArray(json.routes) ? json.routes[0] : null;
      const durationSeconds = r ? domain.parseDuration(r.duration) : null;
      if (!r || !Number.isFinite(r.distanceMeters) || durationSeconds == null) throw new ProviderError('GOOGLE_ROUTES_UNAVAILABLE', { service: 'ROUTES' });
      return { mode: 'DRIVE', distanceMeters: r.distanceMeters, durationSeconds, trafficAware: body.routingPreference === 'TRAFFIC_AWARE' };
    }
  };
}

/** GoogleMapsProviderAdapter implements ExternalMapProvider.getMapRuntimeConfig (no key, §264, §403) */
function createGoogleMapsAdapter({ cfg, mapId = null }) {
  return { providerCode: 'GOOGLE_MAPS', async getMapRuntimeConfig(ctx) { return { enabled: !!ctx.enabled, clientMapId: mapId || undefined, developmentCenter: ctx.center, activeRadiusMeters: ctx.radiusMeters, maxRadiusMeters: ctx.maxRadiusMeters, viewportBounds: domain.boundsAround(ctx.center, ctx.maxRadiusMeters) }; } };
}

module.exports = { fetchHttp, ProviderError, createGoogleHttpClient, mapNearbyResponse, createGooglePlacesAdapter, createGoogleRoutesAdapter, createGoogleMapsAdapter };
