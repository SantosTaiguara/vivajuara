'use strict';
/* Composition of the topic 63 module (location intelligence / Entorno). Wiring for src/app.js (not done here: shared file):
     const surroundingsModule = require('./modules/surroundings');
     const surroundings = surroundingsModule.create({ pool, logger });             // Postgres repos + real Google transport
     services.surroundings = surroundings;
     surroundingsModule.registerSurroundingsRoutes(router, services);
   plus ROUTE_POLICIES in modules/iam/routePolicies.js, the permission keys in modules/iam/permissions.js and the error
   codes in shared/http/errors.js (docs/RELATORIO_TOPICO_63.md). The server key is read from GOOGLE_MAPS_API_KEY on each
   provider call; it is never copied into the service, responses, logs or errors. */
const cfg = require('../../../../src/config/surroundings/surroundings.config.js');
const google = require('./google.provider');
const repo = require('./surroundings.repository');
const { createSurroundingsService, providerEnv } = require('./surroundings.service');
const { registerSurroundingsRoutes, ROUTE_POLICIES, PERMISSION } = require('./surroundings.controller');

/** create({ pool, logger, env, http, locations, placeRefs, now }) — every dependency injectable (tests use a fake Google http) */
function create({ pool = null, logger = null, env = process.env, http = null, locations = null, placeRefs = null, now, config = cfg } = {}) {
  const penv = providerEnv(env, config);
  const client = google.createGoogleHttpClient({ http: http || google.fetchHttp(), apiKey: () => env[config.provider.serverKeyEnv] || null, cfg: config });
  const svc = createSurroundingsService({ cfg: config, env: penv, logger, now,
    locations: locations || (pool ? repo.createPgLocationRepository(pool, config) : repo.createMemoryLocationRepository(config)),
    placeRefs: placeRefs || (pool ? repo.createPgPlaceRefRepository(pool) : repo.createMemoryPlaceRefRepository()),
    places: google.createGooglePlacesAdapter({ client, cfg: config }), routes: google.createGoogleRoutesAdapter({ client, cfg: config }) });
  return svc;
}

module.exports = { create, registerSurroundingsRoutes, ROUTE_POLICIES, PERMISSION, config: cfg };
