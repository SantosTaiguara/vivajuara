// Service Worker routing table generated from the cache policy registry (topic 48), so sw.js and the app share one taxonomy.
// Topic 49 adds the ServiceWorkerResourcePolicy projection (request class, offline source, version requirement, security class).
// rules(App?) → [{ id, test (RegExp source on the pathname), strategy: BYPASS | CACHE_FIRST | NETWORK_FIRST | NETWORK_ONLY, keep?, resourceType?,
//                  klass, swStrategy, offline, versionRequired, securityClass, maxEntries? }]
// swPolicies(App?) → ServiceWorkerResourcePolicy[] (§17): { resourceType, routeMatcherId, offlineEligible, strategy, maxAgeSeconds?, maxEntries?, securityClass, versionRequired, offlineSource }
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
/** App with the loading/cache modules (they are not in the harness ORDER until the integrator adds them) */
function appWithCache(App) {
  App = App || require('../tests/harness.js').load();
  for (const f of ['loading/resources.js', 'cache/cacheCore.js']) if (!(f.startsWith('loading') ? App.loading && App.loading.resources : App.cache && App.cache.core)) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  return App;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** policy → worker strategy. Data with a domain label (price, availability) and version pointers are NETWORK_ONLY in the worker:
    their last-known copy lives in IndexedDB with its freshness, never in an anonymous Cache Storage response. */
function swStrategy(pol) {
  if (pol.strategy === 'NO_CACHE' || pol.strategy === 'NETWORK_ONLY' || pol.strategy === 'MEMORY_ONLY') return 'NETWORK_ONLY';
  if (pol.persistentStore === 'INDEXED_DB' || pol.domainLabel) return 'NETWORK_ONLY';
  if (pol.persistentStore !== 'CACHE_STORAGE') return 'NETWORK_ONLY';
  if (pol.strategy === 'IMMUTABLE_VERSIONED') return 'CACHE_FIRST';
  return 'NETWORK_FIRST';
}
/** request class of a resource type (§193) */
function klassOf(type, pol) {
  if (/^(GALLERY_IMAGE|BASE_MAP_|APP_FONT|APP_SHELL)/.test(type)) return 'STATIC_ASSET';
  if (pol.domainLabel || type === 'MAP_BOOTSTRAP') return 'DYNAMIC_DATA'; // price/availability values and version pointers
  if (pol.strategy === 'IMMUTABLE_VERSIONED' || pol.persistentStore === 'CACHE_STORAGE') return 'VERSIONED_DATA';
  return 'DYNAMIC_DATA';
}
/** where the resource may come from when the network fails (topic 49 decision table):
    - domain-labelled data (price, availability) and version pointers: the data layer's IndexedDB copy with its freshness label, never the worker;
    - GEOMETRY_BUNDLE: data layer too (it is validated against the manifest checksums there);
    - immutable PUBLIC_SAFE artifacts with a checksum (analysis input, base maps, gallery): an explicitly prepared offline pack, exact version only;
    - NETWORK_FIRST runtime copies (routes, gallery index): the runtime cache, then the pack. */
function offlineOf(type, pol, sc) {
  if (sc !== 'PUBLIC_SAFE') return 'NONE';
  if (pol.domainLabel || type === 'MAP_BOOTSTRAP' || type === 'GEOMETRY_BUNDLE') return pol.persistentStore === 'INDEXED_DB' ? 'DATA_LAYER' : 'NONE';
  if (pol.strategy === 'IMMUTABLE_VERSIONED') return 'PACK';
  if (pol.persistentStore === 'CACHE_STORAGE') return 'RUNTIME_THEN_PACK';
  return 'NONE';
}
function rules(App0) {
  const App = appWithCache(App0), C = App.cache.core, dev = App.config.DEVELOPMENTS[0], a = dev.assets;
  const byPath = [[a.routes, 'MOBILITY_ROUTES'], [a.images, 'GALLERY_INDEX'], [a.commercial, 'PRICING_SNAPSHOT'], [a.manifest, 'MAP_BOOTSTRAP'], [a.lots, 'GEOMETRY_BUNDLE'], ['analysis-input.json', 'TECHNICAL_ANALYSIS_INPUT']];
  const meta = t => { const p = C.getPolicy(t), sc = C.securityClassOf(t); return { klass: klassOf(t, p), offline: offlineOf(t, p, sc), versionRequired: !!(p.requireVersionMatch || p.strategy === 'IMMUTABLE_VERSIONED'), securityClass: sc }; };
  const out = [{ id: 'never-api', test: '/api/', strategy: 'BYPASS', klass: 'SENSITIVE_DATA', swStrategy: 'NO_STORE', offline: 'NONE', versionRequired: false, securityClass: 'RESTRICTED' }];
  for (const [p, t] of byPath) if (p) { const s = swStrategy(C.getPolicy(t)); out.push({ id: t.toLowerCase(), test: '/' + esc(p) + '$', strategy: s, resourceType: t, swStrategy: s, ...meta(t) }); }
  // images: one CACHE_FIRST rule; only /img/ (gallery) is kept by the worker, in a cache named after the image revisions (versioned, §33)
  out.push({ id: 'images', test: '\\.(webp|png|jpg|jpeg|svg|woff2?)$', strategy: swStrategy(C.getPolicy('BASE_MAP_MEDIUM')), keep: '/img/', resourceType: 'GALLERY_IMAGE', swStrategy: 'CACHE_FIRST', maxEntries: 60, ...meta('GALLERY_IMAGE') });
  out.push({ id: 'other-json', test: '\\.json$', strategy: 'NETWORK_ONLY', klass: 'DYNAMIC_DATA', swStrategy: 'NETWORK_ONLY', offline: 'NONE', versionRequired: false, securityClass: 'RESTRICTED' });
  return out;
}
/** ServiceWorkerResourcePolicy projection (§17), one row per routed resource type */
function swPolicies(App0) {
  const App = appWithCache(App0), C = App.cache.core;
  return rules(App).map(r => {
    const pol = r.resourceType ? C.getPolicy(r.resourceType) : null;
    const maxAge = pol && pol.hardTtlMs != null ? Math.round(pol.hardTtlMs / 1000) : undefined;
    return { resourceType: r.resourceType || null, routeMatcherId: r.id, offlineEligible: r.offline !== 'NONE', strategy: r.swStrategy, maxAgeSeconds: maxAge, maxEntries: r.maxEntries,
      securityClass: r.securityClass, versionRequired: r.versionRequired, offlineSource: r.offline };
  });
}
module.exports = { rules, swPolicies, swStrategy, klassOf, offlineOf, appWithCache };
if (require.main === module) console.log(JSON.stringify(process.argv[2] === 'policies' ? swPolicies() : rules(), null, 1));
