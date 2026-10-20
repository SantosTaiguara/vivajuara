'use strict';
/* Topic 58 — builds a backend App context that also holds the onboarding pipeline (plat/src/onboarding/*.js and its policy
   plat/src/config/onboarding/onboardingPolicy.js). Same code as the browser/tests (no duplicated rules). Everything is
   evaluated inside the vm realm through createAppContext({ files }) — no `new Function` in app code. */
const path = require('path');
const { createAppContext, BACKEND_ORDER } = require('../../shared/domain/sharedDomain');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEPENDENCIES = ['documents/integrity.js', 'security/hardening.js', 'geo/geometry.js', 'geo/spatialIndex.js'];
const FILES = ['config/onboarding/onboardingPolicy.js', 'onboarding/onboardingModel.js', 'onboarding/sourceIntake.js', 'onboarding/parsers.js', 'onboarding/mapping.js',
  'onboarding/canonical.js', 'onboarding/geometryIngest.js', 'onboarding/commercialImport.js', 'onboarding/quality.js', 'onboarding/publication.js', 'onboarding/orchestrator.js'];

/** createOnboardingApp({ srcDir }) → App with App.onboarding.* (fresh, isolated context) */
function createOnboardingApp({ srcDir = path.join(ROOT, 'src') } = {}) {
  const files = [...BACKEND_ORDER, ...DEPENDENCIES.filter(f => !BACKEND_ORDER.includes(f)), ...FILES];
  const App = createAppContext({ srcDir, files });
  if (!App.onboarding || !App.onboarding.orchestrator) throw new Error('onboarding domain did not load');
  return App;
}
module.exports = { createOnboardingApp, FILES, DEPENDENCIES };
