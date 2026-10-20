// Topic 50: security gate for CI / pre-commit (no dependencies).
//   node scripts/securityScan.js            → report (JSON) and exit 1 on CRITICAL/HIGH findings
// Checks: (1) secret scanning over the repository and the built panel; (2) forbidden code patterns (eval, new Function,
// document.write, dangerouslySetInnerHTML, tokens in web storage, shell exec with interpolation, SQL built from input);
// (3) un-escaped value="${...}" attribute interpolation in view templates (DOM XSS); (4) dependency inventory from the
// lockfiles (install scripts, non-registry sources, git/http deps). Findings never print the secret itself.
const fs = require('fs'), path = require('path');
const PLAT = path.join(__dirname, '..');
const SKIP_DIR = new Set(['node_modules', 'node_modules_dev', '.git', 'backups', 'reports', '.pgdata', '.pgrun', 'img']);
const TEXT_EXT = /\.(js|mjs|cjs|json|sql|md|html|css|sh|env|example|yml|yaml|txt|ts)$/i;
const SECRET_RULES = [
  ['AWS_ACCESS_KEY', /\bAKIA[0-9A-Z]{16}\b/, 'CRITICAL'],
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, 'CRITICAL'],
  ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'CRITICAL'],
  ['SLACK_TOKEN', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, 'CRITICAL'],
  ['GOOGLE_API_KEY', /\bAIza[0-9A-Za-z_-]{35}\b/, 'HIGH'],
  ['OPENAI_STYLE_KEY', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/, 'CRITICAL'],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, 'HIGH'],
  ['DB_URL_WITH_PASSWORD', /\bpostgres(?:ql)?:\/\/[^:\s/'"`<>]+:(?!PASSWORD@|password@|\$\{|<)[^@\s'"`<>]{3,}@/i, 'CRITICAL'],
  ['DEV_TOKEN', /\bplat_dev_[A-Za-z0-9_-]{43}\b/, 'HIGH'],
  ['ASSIGNED_SECRET', /\b(?:ADMIN_API_TOKEN|WRITE_API_KEY|SHARE_TOKEN_PEPPER|CLIENT_SECRET|API_KEY|SECRET_KEY)\s*[:=]\s*['"]?(?![<$]|example|changeme|\s|$)[A-Za-z0-9_\-+/=]{16,}/, 'HIGH']
];
const CODE_RULES = [
  ['EVAL', /(^|[^.\w])eval\s*\(/, 'HIGH'],
  ['NEW_FUNCTION_IN_APP', /\bnew Function\s*\(/, 'HIGH'],
  ['DOCUMENT_WRITE', /\bdocument\.write(ln)?\s*\(/, 'HIGH'],
  ['DANGEROUSLY_SET_INNER_HTML', /dangerouslySetInnerHTML/, 'HIGH'],
  ['TOKEN_IN_WEB_STORAGE', /(localStorage|sessionStorage)\.setItem\(\s*['"`][^'"`]*(token|secret|password|auth|session)[^'"`]*['"`]/i, 'CRITICAL'],
  ['SHELL_EXEC_INTERPOLATED', /\b(exec|execSync)\s*\(\s*`[^`]*\$\{/, 'HIGH'],
  ['STRING_TIMER', /\bset(Timeout|Interval)\s*\(\s*['"`]/, 'MEDIUM'],
  ['JAVASCRIPT_URL', /href\s*=\s*["'`]\s*javascript:/i, 'HIGH']
];
/** obvious fixtures/placeholders are not secrets (test-only values must say so) */
const FIXTURE_RE = /test|example|fake|dummy|sample|placeholder|changeme|x{8,}/i;
const VALUE_ATTR_RE = /\bvalue="\$\{(?!\s*(?:esc|App\.ui\.esc|App\.securityHardening\.escapeHtml|encodeURIComponent)\()([^}]{1,80})\}"/g;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (TEXT_EXT.test(e.name) || e.name === '.env') out.push(p);
  }
  return out;
}
const rel = p => path.relative(PLAT, p).split(path.sep).join('/');
/** scanSecrets(files) → [{ file, line, rule, severity }] — never returns the matched value */
function scanSecrets(files) {
  const f = [];
  for (const file of files) {
    if (fs.statSync(file).size > 8 * 1024 * 1024) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((l, i) => { for (const [rule, re, severity] of SECRET_RULES) { const m = re.exec(l); if (m && !FIXTURE_RE.test(m[0])) f.push({ file: rel(file), line: i + 1, rule, severity }); } });
    if (path.basename(file) === '.env') f.push({ file: rel(file), line: 0, rule: 'DOTENV_FILE_PRESENT', severity: 'HIGH' });
  }
  return f;
}
/** scanCode(files) — forbidden patterns in shipped JavaScript (tests and this scanner excluded by the caller) */
function scanCode(files) {
  const f = [];
  for (const file of files.filter(x => /\.js$/.test(x))) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((l, i) => { if (COMMENT_LINE.test(l)) return; for (const [rule, re, severity] of CODE_RULES) if (re.test(l.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, m => rule === 'EVAL' || rule === 'NEW_FUNCTION_IN_APP' ? '""' : m))) f.push({ file: rel(file), line: i + 1, rule, severity }); });
  }
  return f;
}
/** scanValueAttributes(files) → un-escaped value="${…}" interpolations in templates */
function scanValueAttributes(files) {
  const f = [];
  for (const file of files.filter(x => /\.js$/.test(x))) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((l, i) => { for (const m of l.matchAll(VALUE_ATTR_RE)) f.push({ file: rel(file), line: i + 1, rule: 'UNESCAPED_VALUE_ATTRIBUTE', expr: m[1].trim(), severity: 'HIGH' }); });
  }
  return f;
}
/** dependencyInventory() → { packages: [{ lockfile, name, version, installScript, resolvedHost }], findings } */
function dependencyInventory() {
  const locks = [path.join(PLAT, 'backend/package-lock.json'), path.join(PLAT, 'tests/package-lock.json')].filter(fs.existsSync);
  const packages = [], findings = [];
  for (const lf of locks) {
    const j = JSON.parse(fs.readFileSync(lf, 'utf8'));
    for (const [k, v] of Object.entries(j.packages || {})) {
      if (!k) continue;
      const name = k.replace(/^.*node_modules\//, ''), host = v.resolved ? (() => { try { return new URL(v.resolved).host; } catch (e) { return 'invalid'; } })() : null;
      packages.push({ lockfile: rel(lf), name, version: v.version, dev: !!v.dev, installScript: !!v.hasInstallScript, resolvedHost: host, integrity: !!v.integrity });
      if (v.hasInstallScript) findings.push({ file: rel(lf), rule: 'INSTALL_SCRIPT', package: name, severity: 'MEDIUM' });
      if (host && host !== 'registry.npmjs.org') findings.push({ file: rel(lf), rule: 'NON_REGISTRY_SOURCE', package: name, severity: 'HIGH' });
      if (v.resolved && !v.integrity) findings.push({ file: rel(lf), rule: 'MISSING_INTEGRITY', package: name, severity: 'MEDIUM' });
    }
  }
  return { packages, findings };
}
function run() {
  const repoFiles = [...walk(path.join(PLAT, 'src')), ...walk(path.join(PLAT, 'config')), ...walk(path.join(PLAT, 'scripts')), ...walk(path.join(PLAT, 'backend')), ...walk(path.join(PLAT, 'docs')), ...walk(path.join(PLAT, '..', 'dash'))]
    .filter(f => !/scripts[\\/]securityScan\.js$/.test(f));
  const appJs = [...walk(path.join(PLAT, 'src')), ...walk(path.join(PLAT, 'backend', 'src'))];
  const secrets = scanSecrets(repoFiles), code = scanCode(appJs), valueAttrs = scanValueAttributes(walk(path.join(PLAT, 'src'))), deps = dependencyInventory();
  const blocking = [...secrets, ...code, ...deps.findings].filter(x => x.severity === 'CRITICAL' || x.severity === 'HIGH');
  return { scannedFiles: repoFiles.length, secrets, code, valueAttrs, dependencies: { count: deps.packages.length, packages: deps.packages.map(p => `${p.name}@${p.version}`), findings: deps.findings }, blocking };
}
module.exports = { run, scanSecrets, scanCode, scanValueAttributes, dependencyInventory, SECRET_RULES, CODE_RULES };
if (require.main === module) { const r = run(); console.log(JSON.stringify(r, null, 1)); process.exit(r.blocking.length ? 1 : 0); }
