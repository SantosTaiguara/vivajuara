'use strict';
/* Loads the platform's shared domain modules (plat/src, plain browser scripts that
   register on a global App) into a Node vm context. The backend reuses the SAME
   normalizer, lifecycle composer, LotFactory and availability state machine as the
   frontend, so rules are never duplicated with different behavior.
   NOTE: objects created inside the vm belong to another realm; compare them through
   App.domain.serializeLot / JSON, not with assert.deepStrictEqual. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Non-UI modules needed server-side, in dependency order (subset of tests/harness.js ORDER).
// intelligence/math.js: domain/rules.js ranks with App.imath (topic 12); missing files are skipped.
// intelligence/{normalization,methodology,engine,textAdapter}.js: the IntelligenceEngine (topic 12) and the configurable
// methodology (topic 13), same files and order as the frontend; App.configs (scoring) is injected after prelude.js.
const INTELLIGENCE = ['intelligence/normalization.js', 'intelligence/methodology.js', 'intelligence/engine.js', 'intelligence/textAdapter.js'];
const BACKEND_ORDER = ['prelude.js', 'domain/enums.js', 'domain/model.js', 'intelligence/math.js', 'domain/rules.js', 'domain/lot.js', 'domain/availability.js',
  'config/developments.js', 'config/presentation.js', 'utils/i18n.js', 'utils/formatters.js', 'data/lifecycle.js', 'data/legacyAdapter.js', 'data/repositories.js',
  ...INTELLIGENCE, 'filters/filters.js', 'services/finding.js'];
// Optional modules: the API needs only App.services.search (lot search parsing stays central, §115), which
// finding.js defines first. A failure later in these files (UI-side services evolving) must not take the
// whole backend down: it is recorded in loadErrors and the API checks for what it needs at startup.
// The intelligence modules are optional too: without them only the analysis preview answers 503 INTELLIGENCE_UNAVAILABLE.
const OPTIONAL = new Set(['filters/filters.js', 'services/finding.js', ...INTELLIGENCE]);

/** Methodology configs of plat/config (same shape as plat/scripts/configBundle.js builds for the browser):
    { scoring: { <developmentId>: { current: '<file>.json', versions: { '<x.y>.json': config } } } }. */
function readSharedConfigs(configDir) {
  const scoring = {}, dir = configDir && path.join(configDir, 'scoring');
  if (!dir || !fs.existsSync(dir)) return { scoring };
  for (const dev of fs.readdirSync(dir).sort()) {
    const d = path.join(dir, dev), cur = path.join(d, 'current.json');
    if (!fs.existsSync(cur)) continue;
    const versions = {};
    for (const f of fs.readdirSync(d).filter(f => /^\d+\.\d+\.json$/.test(f)).sort()) versions[f] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
    scoring[dev] = { current: JSON.parse(fs.readFileSync(cur, 'utf8')).current, versions };
  }
  return { scoring };
}

/** createAppContext({ srcDir, files, fetch }) → App (a fresh, isolated context each call) */
function createAppContext({ srcDir, files = BACKEND_ORDER, fetch, extraGlobals = {}, configDir } = {}) {
  if (!srcDir || !fs.existsSync(path.join(srcDir, 'prelude.js'))) throw new Error(`Shared domain source not found at ${srcDir} (SHARED_SRC_DIR)`);
  const store = {};
  const ctx = {
    console, Intl, Date, Math, JSON, Map, Set, Promise, queueMicrotask, setTimeout, clearTimeout, URL, AbortController,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { hash: '' }, history: { replaceState() {} },
    fetch: fetch || (async () => { throw new Error('fetch is not available in the backend domain context'); }),
    ...extraGlobals
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const loadErrors = [];
  const cfgDir = configDir === undefined ? path.resolve(srcDir, '..', 'config') : configDir;
  for (const f of files) {
    const p = path.join(srcDir, f);
    if (!fs.existsSync(p)) continue;
    try { vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f }); }
    catch (e) { if (!OPTIONAL.has(f)) throw e; loadErrors.push({ file: f, message: e.message }); }
    // like the browser bundle and tests/harness.js: configs exist before any module reads them (JSON evaluated inside the realm)
    if (f === 'prelude.js' && ctx.App && !ctx.App.configs) {
      try { vm.runInContext(`App.configs = ${JSON.stringify(readSharedConfigs(cfgDir))};`, ctx, { filename: 'configs' }); }
      catch (e) { loadErrors.push({ file: 'configs', message: e.message }); }
    }
  }
  // JSON → objects of the vm realm (inputs handed to the engine behave exactly as in the browser)
  REALM_PARSE.set(ctx.App, vm.runInContext('(s => JSON.parse(s))', ctx));
  if (!ctx.App || !ctx.App.repos || !ctx.App.lifecycle) throw new Error('Shared domain did not load (App.repos / App.lifecycle missing)');
  LOAD_ERRORS.set(ctx.App, loadErrors);
  return ctx.App;
}

const LOAD_ERRORS = new WeakMap();
const REALM_PARSE = new WeakMap();
/** deep copy of a JSON value into the App's realm */
const toRealm = (App, value) => REALM_PARSE.get(App)(JSON.stringify(value));
/** optional modules that failed to load in this App context (empty when everything loaded) */
const loadErrorsOf = App => LOAD_ERRORS.get(App) || [];

let singleton = null;
/** Server-wide App (read-only use: composition, validation, state machine). */
function getSharedApp(srcDir, configDir) {
  if (!singleton) singleton = createAppContext({ srcDir, configDir: configDir || undefined });
  return singleton;
}

module.exports = { createAppContext, getSharedApp, loadErrorsOf, toRealm, readSharedConfigs, BACKEND_ORDER, INTELLIGENCE };
