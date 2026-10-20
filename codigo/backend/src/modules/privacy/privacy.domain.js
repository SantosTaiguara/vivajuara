'use strict';
/* Topic 59 — loads the SAME privacy domain as the browser (plat/src/privacy/privacyCore.js + privacyWorkflow.js, plain
   scripts on a global App) into an isolated Node vm context, plus plat/config/privacy/*.json. One implementation of the
   rules for browser, tests and server. Not legal advice: every legal value stays null until validated, and the code denies. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FILES = ['prelude.js', 'documents/integrity.js', 'privacy/privacyCore.js', 'privacy/privacyWorkflow.js'];
const CONFIG_FILES = ['registries', 'lifecycle', 'thirdParties', 'governance', 'policies'];

function readPrivacyConfig(configDir = path.join(ROOT, 'config', 'privacy')) {
  const out = {};
  for (const k of CONFIG_FILES) { const p = path.join(configDir, k + '.json'); out[k] = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}; }
  return out;
}

/** createPrivacyDomain({ srcDir, configDir, config }) → { core, workflow, config } (frozen domain objects of the vm realm) */
function createPrivacyDomain({ srcDir = path.join(ROOT, 'src'), configDir, config } = {}) {
  const ctx = { console, Intl, Date, Math, JSON, Map, Set, Promise, URL, TextEncoder, queueMicrotask, setTimeout, clearTimeout };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of FILES) {
    const p = path.join(srcDir, f);
    if (!fs.existsSync(p)) throw new Error(`privacy domain source missing: ${f}`);
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  const App = ctx.App;
  if (!App || !App.privacy || !App.privacy.core || !App.privacy.workflow) throw new Error('privacy domain did not load');
  const cfg = config || readPrivacyConfig(configDir);
  vm.runInContext(`App.privacy.core.setConfig(${JSON.stringify(cfg)});`, ctx, { filename: 'privacy-config' });
  // results crossing the realm boundary are plain-copied so callers can deepStrictEqual / spread them
  const plain = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
  const toRealm = vm.runInContext('(s => JSON.parse(s))', ctx);
  const wrapAll = obj => { const out = {}; for (const k of Object.keys(obj)) out[k] = typeof obj[k] === 'function'
    ? (...a) => { const r = obj[k](...a.map(x => x === undefined ? x : toRealm(JSON.stringify(x)))); return r && typeof r.then === 'function' ? r.then(plain) : plain(r); }
    : plain(obj[k]); return Object.freeze(out); };
  return Object.freeze({ core: wrapAll(App.privacy.core), workflow: wrapAll(App.privacy.workflow), config: cfg, App });
}

module.exports = { createPrivacyDomain, readPrivacyConfig, FILES };
