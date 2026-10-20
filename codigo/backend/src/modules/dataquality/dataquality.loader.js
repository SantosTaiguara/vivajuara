'use strict';
/* Topic 61 — attaches the shared data-quality domain (plat/src/dataquality/*.js, plain browser scripts on a global App)
   and its policy (plat/config/dataquality/*.json) to an App context: the backend's createAppContext() App or the
   frontend test harness App. One implementation of the rules for browser, tests and server (no duplicated logic).
   The modules are NOT in the browser build (page budget): the backoffice/technical chunk loads them when it exists.

   attachDataQuality(App, { srcDir, configDir, files }) → App.dataQuality (evaluateGate, engine, workflow, model)
   readDataQualityConfig(configDir) → { platform, org_house7, 'viva-juara', … } */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FILES = ['dataquality/dqModel.js', 'dataquality/dqEngine.js', 'dataquality/dqWorkflow.js'];
const VIEW = 'dataquality/dqView.js';

function readDataQualityConfig(configDir = path.join(ROOT, 'config', 'dataquality')) {
  const out = {};
  for (const f of fs.readdirSync(configDir).filter(f => f.endsWith('.json')).sort()) out[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(configDir, f), 'utf8'));
  return out;
}

function attachDataQuality(App, { srcDir = path.join(ROOT, 'src'), configDir, files = FILES, withView = false } = {}) {
  if (!App) throw new Error('App context required');
  for (const f of withView ? [...files, VIEW] : files) vm.compileFunction(fs.readFileSync(path.join(srcDir, f), 'utf8'), ['App'], { filename: f })(App); // trusted repo file, same semantics as a plain script
  App.dataQuality.model.setConfig(readDataQualityConfig(configDir));
  return App.dataQuality;
}

module.exports = { attachDataQuality, readDataQualityConfig, FILES, VIEW };
