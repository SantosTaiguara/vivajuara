// Builds the SEPARATE admin shell: dash/admin.html (round 5, topic 60 §6-7). Run by scripts/build.js, or alone: node scripts/buildAdmin.js
// Not linked from the public panel (App.backofficeView.entryLink() is '' for the visitor) and never cached by the public worker.
// It bundles only the base modules the admin domains need (prelude, configs with the 'admin' profile, security/authz, domain
// model, integrity, geometry) plus backoffice/*, deals/*, onboarding/*, dataquality/*, privacy/* and surroundings/*.
// Deny by default: without a server-confirmed session the page shows only "Acesso restrito" (src/admin/adminApp.js).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const SRC = path.join(__dirname, '..', 'src'), OUT_DEFAULT = path.join(__dirname, '..', '..', 'dash');
const { ORDER } = require('../tests/harness.js');
const BASE = ['prelude.js', 'domain/enums.js', 'domain/model.js', 'domain/rules.js', 'domain/lot.js', 'domain/availability.js', 'config/developments.js', 'config/presentation.js',
  'security/organization.js', 'security/permissions.js', 'security/authorization.js', 'security/hardening.js', 'utils/i18n.js', 'utils/formatters.js', 'data/legacyAdapter.js',
  'documents/integrity.js', 'geo/geometry.js', 'geo/spatialIndex.js', 'analytics/registry.js'];
const ADMIN = [
  'config/backoffice/backofficeConfig.js', 'backoffice/backofficeCore.js', 'backoffice/backofficeCommands.js', 'backoffice/backofficeGovernance.js',
  'deals/dealsDomain.js',
  'config/onboarding/onboardingPolicy.js', 'onboarding/onboardingModel.js', 'onboarding/sourceIntake.js', 'onboarding/parsers.js', 'onboarding/mapping.js', 'onboarding/canonical.js',
  'onboarding/geometryIngest.js', 'onboarding/commercialImport.js', 'onboarding/quality.js', 'onboarding/publication.js', 'onboarding/orchestrator.js',
  'dataquality/dqModel.js', 'dataquality/dqEngine.js', 'dataquality/dqWorkflow.js',
  'privacy/privacyCore.js', 'privacy/privacyWorkflow.js', 'privacy/deviceData.js',
  'config/surroundings/surroundings.config.js', 'surroundings/surroundingsDomain.js', 'surroundings/surroundingsClient.js',
  'backoffice/backofficeAdapters.js']; // round 6: provider adapters (server only; BACKEND_UNAVAILABLE without it)
const UI = ['backoffice/backofficeView.js', 'deals/dealsView.js', 'onboarding/onboardingView.js', 'dataquality/dqView.js', 'privacy/privacyView.js', 'surroundings/surroundingsView.js', 'admin/adminApp.js'];
const CSS = ['admin/admin.css', 'surroundings/surroundings.css'];
/** files() → the ordered module list (base modules keep the panel's ORDER) */
const files = () => [...ORDER.filter(f => BASE.includes(f)), ...ADMIN, ...UI].filter(f => fs.existsSync(path.join(SRC, f)));
function html(o = {}) {
  const list = files();
  if (o.check !== false) for (const f of list) execFileSync(process.execPath, ['--check', path.join(SRC, f)]);
  const js = list.map(f => `/* ---- ${f} ---- */\n` + fs.readFileSync(path.join(SRC, f), 'utf8') + (f === 'prelude.js' ? '\n/* ---- configs (plat/config, admin profile) ---- */\n' + require('./configBundle.js').bundle(undefined, { profile: 'admin' }) : '')).join('\n');
  const css = CSS.filter(f => fs.existsSync(path.join(SRC, f))).map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>Console administrativo · Viva Juara</title>
<style>
${css}
</style>
</head>
<body>
<div class="adm" id="adm" aria-live="polite"><p class="adm-load">Verificando acesso…</p></div>
<script>
${js.replace(/<\/script/gi, '<\\/script')}
</script>
</body>
</html>
`;
}
function build(o = {}) {
  const out = o.out || OUT_DEFAULT, h = html(o);
  fs.writeFileSync(path.join(out, 'admin.html'), h);
  return { file: path.join(out, 'admin.html'), bytes: Buffer.byteLength(h), modules: files().length };
}
module.exports = { build, html, files, BASE, ADMIN, UI };
if (require.main === module) { const r = build(); console.log('built admin', r.modules, 'modules,', (r.bytes / 1024).toFixed(0), 'KB'); }
