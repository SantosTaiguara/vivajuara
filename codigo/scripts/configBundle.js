// Bundles the methodology configs (plat/config/**) into one JS statement, so the
// single-file build and the Node harness load the same data: App.configs = {...}.
// Scoring versions: plat/config/scoring/<dev>/<N.N.json | N.N.N.json>; current.json names the file
// in use and its methodologyVersion, which must match the file (validated; the build fails otherwise).
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'config');
const VERSION_FILE = /^(\d+)\.(\d+)(?:\.(\d+))?\.json$/;
/** validateScoring(dir) → { current, versions, errors } for one development folder */
function validateScoring(d, dev) {
  const errors = [], versions = {}, E = (code, message) => errors.push({ code, developmentId: dev, message });
  const curPath = path.join(d, 'current.json');
  let cur = null;
  if (!fs.existsSync(curPath)) E('MISSING_CURRENT', `${dev}: current.json ausente`);
  else { try { cur = JSON.parse(fs.readFileSync(curPath, 'utf8')); } catch (e) { E('INVALID_CURRENT', `${dev}: current.json inválido (${e.message})`); } }
  for (const f of fs.readdirSync(d).filter(f => VERSION_FILE.test(f))) {
    let cfg; try { cfg = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { E('INVALID_VERSION_FILE', `${dev}/${f}: JSON inválido (${e.message})`); continue; }
    const [, a, b, c] = f.match(VERSION_FILE), v = cfg && cfg.methodologyVersion;
    if (typeof v !== 'string' || !/^\d+\.\d+\.\d+$/.test(v)) E('INVALID_VERSION', `${dev}/${f}: methodologyVersion ausente ou fora do semver`);
    else if (c != null ? v !== `${a}.${b}.${c}` : !v.startsWith(`${a}.${b}.`)) E('VERSION_FILE_MISMATCH', `${dev}/${f}: o nome do arquivo não confere com methodologyVersion ${v}`);
    versions[f] = cfg;
  }
  if (cur) {
    if (!cur.current || !versions[cur.current]) E('CURRENT_NOT_FOUND', `${dev}: current.json aponta para ${cur.current}, que não existe`);
    else if (!cur.methodologyVersion) E('CURRENT_VERSION_MISSING', `${dev}: current.json sem methodologyVersion`);
    else if (versions[cur.current].methodologyVersion !== cur.methodologyVersion) E('CURRENT_VERSION_MISMATCH', `${dev}: current.json diz ${cur.methodologyVersion}, ${cur.current} tem ${versions[cur.current].methodologyVersion}`);
  }
  return { current: cur && cur.current, versions, errors };
}
/** validate(root) → { ok, errors } without throwing */
function validate(root = ROOT) {
  const errors = [], dir = path.join(root, 'scoring');
  for (const dev of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (fs.statSync(path.join(dir, dev)).isDirectory()) errors.push(...validateScoring(path.join(dir, dev), dev).errors);
  return { ok: !errors.length, errors };
}
// Build profiles (round 5): 'full' (default: Node harness, tests, docs) bundles every config below; 'public' (dash/index.html,
// the static visitor) leaves out the admin-only configs and the permission/feature entries of the admin shell (topics 57-61),
// which the visitor can never use (unknown key = denied, so behaviour is identical) and which would push the page over the
// MAP_ROUTE JS budget; 'admin' (dash/admin.html) adds the admin-only folders (privacy, dataquality).
const ADMIN_ONLY_SUBS = ['deals'], ADMIN_EXTRA_SUBS = ['privacy', 'dataquality'];
const ADMIN_PERMISSION_RE = /^(backoffice|proposal|reservation|closing|contract|signature|sale|commercial_approval|data_quality|data_governance|development_onboarding|privacy)\.|^customer\.export_bulk$/;
/** publicSecurity(security) → copy without admin-shell permissions, the features that need them and the actions of those features */
function publicSecurity(sec) {
  if (!sec || !sec.permissions || !sec.features) return sec;
  const perms = sec.permissions.permissions.filter(p => !ADMIN_PERMISSION_RE.test(p.key)), keep = new Set(perms.map(p => p.key));
  const fm = sec.features, features = {}, actions = {};
  for (const [id, f] of Object.entries(fm.features || {})) if ((f.permissions || []).every(k => keep.has(k))) features[id] = f;
  const ok = id => Object.prototype.hasOwnProperty.call(features, id);
  for (const [act, a] of Object.entries(fm.actions || {})) if (typeof a === 'string' ? ok(a) : [a.default, ...Object.values(a.variants || {})].filter(Boolean).every(ok)) actions[act] = a;
  const keepMap = m => Object.fromEntries(Object.entries(m || {}).filter(([, id]) => ok(id)));
  // runtime only reads permission keys/flags and the KEYS of uiOnlyActions: their prose (docs/PERMISSION_REGISTRY.md) stays in the repo
  const lean = perms.map(({ description, ...p }) => p), uiOnly = Object.fromEntries(Object.keys(fm.uiOnlyActions || {}).map(k => [k, '']));
  const { secretsCatalog, ...rest } = sec; // names of server secrets: documentation, never used by the visitor page
  return { ...rest, permissions: { ...sec.permissions, permissions: lean }, features: { ...fm, features, actions, uiOnlyActions: uiOnly, routes: keepMap(fm.routes), detailSections: keepMap(fm.detailSections) } };
}
function read(root = ROOT, opts = {}) {
  const profile = opts.profile || 'full';
  const scoring = {}, dir = path.join(root, 'scoring'), errors = [];
  for (const dev of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const d = path.join(dir, dev); if (!fs.statSync(d).isDirectory()) continue;
    const r = validateScoring(d, dev); errors.push(...r.errors);
    scoring[dev] = { current: r.current, versions: r.versions };
  }
  if (errors.length) { const e = new Error('configs inválidas: ' + errors.map(x => x.message).join('; ')); e.code = 'INVALID_CONFIG_BUNDLE'; e.errors = errors; throw e; }
  const extra = {};
  for (const sub of ['fit', 'recommendation', 'filters', 'layers', 'quickview', 'compare', 'security', 'customer', 'journey', 'documents', 'provenance', 'confidence', 'rules', 'versioning', 'analytics', 'observability', 'decision', 'navigation', 'deals'].concat(profile === 'admin' ? ADMIN_EXTRA_SUBS : [])) {
    if (profile === 'public' && ADMIN_ONLY_SUBS.includes(sub)) continue;
    const d = path.join(root, sub); if (!fs.existsSync(d)) continue;
    extra[sub] = {}; for (const f of fs.readdirSync(d).filter(f => f.endsWith('.json'))) extra[sub][f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
  }
  if (profile === 'public' && extra.security) extra.security = publicSecurity(extra.security);
  return { scoring, ...extra };
}
const bundle = (root = ROOT, opts = {}) => `App.configs = ${JSON.stringify(read(root, opts))};`;
module.exports = { read, bundle, validate, publicSecurity, VERSION_FILE, ADMIN_PERMISSION_RE };
