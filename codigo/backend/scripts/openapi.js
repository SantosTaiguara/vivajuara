'use strict';
/* Regenerates docs/openapi.json (server with every FEATURE_* flag off) and docs/openapi.features.json (same contract +
   the round-5 module paths, each marked x-feature-flag / x-disabled-by-default) from the code contracts.
   Usage: node scripts/openapi.js           → writes both files
          node scripts/openapi.js --check   → exit 1 when either file is out of date (CI) */
const fs = require('fs');
const path = require('path');
const { createAppContext } = require('../src/shared/domain/sharedDomain');
const { buildOpenApi } = require('./lib/openapiDoc');

const FILE = path.resolve(__dirname, '..', 'docs', 'openapi.json');
const FEATURES_FILE = path.resolve(__dirname, '..', 'docs', 'openapi.features.json');
const SRC = process.env.SHARED_SRC_DIR ? path.resolve(process.env.SHARED_SRC_DIR) : path.resolve(__dirname, '..', '..', 'src');

function render({ features = false } = {}) {
  const App = createAppContext({ srcDir: SRC });
  const base = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  return JSON.stringify(buildOpenApi({ App, base, features }), null, 2) + '\n';
}
const renderFeatures = () => render({ features: true });

if (require.main === module) {
  const out = render(), feat = renderFeatures();
  if (process.argv.includes('--check')) {
    const same = fs.readFileSync(FILE, 'utf8') === out;
    const sameF = fs.existsSync(FEATURES_FILE) && fs.readFileSync(FEATURES_FILE, 'utf8') === feat;
    process.stdout.write(same ? 'docs/openapi.json is up to date\n' : 'docs/openapi.json is OUT OF DATE: run npm run openapi\n');
    process.stdout.write(sameF ? 'docs/openapi.features.json is up to date\n' : 'docs/openapi.features.json is OUT OF DATE: run npm run openapi\n');
    process.exit(same && sameF ? 0 : 1);
  }
  fs.writeFileSync(FILE, out);
  fs.writeFileSync(FEATURES_FILE, feat);
  process.stdout.write(`wrote ${path.relative(process.cwd(), FILE)} (${Object.keys(JSON.parse(out).paths).length} paths) and ${path.relative(process.cwd(), FEATURES_FILE)} (${Object.keys(JSON.parse(feat).paths).length} paths, round-5 modules behind FEATURE_* flags)\n`);
}

module.exports = { render, renderFeatures, FILE, FEATURES_FILE };
