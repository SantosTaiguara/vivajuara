// Topic 50: Content-Security-Policy + security headers for the built single-file panel.
// Round 7 (2026-10-19): img-src gains exactly one third-party host, https://tile.openstreetmap.org (keyless Entorno base map,
// config/security/browserPolicy.json); evaluateCsp() flags any wildcard image source as HIGH, so --check fails on it.
// Reads dash/index.html, hashes the inline <script>/<style> blocks (sha256) and prints the headers a static host must send,
// in the Netlify/Cloudflare-Pages "_headers" format. It never edits the page: the meta-tag variant is printed for reference only,
// because a meta CSP is ignored when the host wraps the page into <body>, and frame-ancestors/report-uri never work in a meta tag.
//   node scripts/securityHeaders.js            → prints _headers
//   node scripts/securityHeaders.js --write    → writes dash/_headers
//   node scripts/securityHeaders.js --meta     → prints the <meta http-equiv> variant
//   node scripts/securityHeaders.js --check    → exits 1 when the computed policy has HIGH findings
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
/** inlineHashes(html) → { scripts: [b64], styles: [b64] } — exactly the text content the browser hashes */
function inlineHashes(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => sha(m[1]));
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => sha(m[1]));
  return { scripts, styles };
}
/** round 6: SRI hashes of the lazy chunks named in the page (App.CHUNK_MANIFEST). The chunks are same-origin files, already allowed by
    script-src 'self'; their sha384 hashes are listed too, so a host may drop 'self' later (CSP3 hash match of SRI-tagged external scripts)
    and the loader sets the same value as integrity="" (a tampered chunk never runs). */
function chunkHashes(html) {
  const m = String(html || '').match(/App\.CHUNK_MANIFEST = (\{.*?\});\n/); if (!m) return [];
  try { return Object.values(JSON.parse(m[1])).map(e => e.integrity).filter(h => /^sha384-[A-Za-z0-9+/=]+$/.test(h)).map(h => `'${h}'`); } catch (e) { return []; }
}
/** loads App.securityHardening with the bundled configs (same code the browser runs) */
function hardening() {
  const ctx = { console, URL }; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext('var App = {};', ctx);
  vm.runInContext(require('./configBundle.js').bundle(), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/security/hardening.js'), 'utf8'), ctx);
  return ctx.App.securityHardening;
}
/** headersFile({ html, connect }) → text of a _headers file (app, sw, data JSON) */
function headersFile({ html, connect = [], adminHtml = null } = {}) {
  const H = hardening(), { styles } = inlineHashes(html), scripts = [...inlineHashes(html).scripts, ...chunkHashes(html)];
  const csp = H.buildCsp({ scriptHashes: scripts, styleHashes: styles, connect, mode: 'header' });
  const block = (route, h) => [route, ...Object.entries(h).map(([k, v]) => `  ${k}: ${v}`)].join('\n');
  return { csp, findings: H.evaluateCsp(csp), text: [block('/', H.securityHeaders({ csp })), block('/index.html', H.securityHeaders({ csp })), block('/sw.js', H.securityHeaders({ route: 'sw' })),
    block('/*.json', { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' })].concat(adminHtml ? [adminBlock(H, adminHtml, connect, block)] : []).join('\n\n') + '\n', meta: `<meta http-equiv="Content-Security-Policy" content="${H.buildCsp({ scriptHashes: scripts, styleHashes: styles, connect, mode: 'meta' })}">` };
}
/** round 5: the separate admin shell (dash/admin.html) gets its own hashed CSP, no-store and noindex */
function adminBlock(H, adminHtml, connect, block) {
  const a = inlineHashes(adminHtml), csp = H.buildCsp({ scriptHashes: a.scripts, styleHashes: a.styles, connect, mode: 'header' });
  return block('/admin.html', { ...H.securityHeaders({ csp }), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
}
module.exports = { inlineHashes, chunkHashes, headersFile, hardening };
if (require.main === module) {
  const f = path.join(ROOT, '..', 'dash', 'index.html');
  if (!fs.existsSync(f)) { console.error('dash/index.html não existe: rode node scripts/build.js'); process.exit(2); }
  const adm = path.join(ROOT, '..', 'dash', 'admin.html');
  const out = headersFile({ html: fs.readFileSync(f, 'utf8'), adminHtml: fs.existsSync(adm) ? fs.readFileSync(adm, 'utf8') : null });
  if (process.argv.includes('--check')) { const high = out.findings.filter(x => x.severity === 'HIGH'); console.log(high.length ? 'CSP com problemas: ' + JSON.stringify(high) : 'CSP ok'); process.exit(high.length ? 1 : 0); }
  if (process.argv.includes('--meta')) { console.log(out.meta); process.exit(0); }
  if (process.argv.includes('--write')) { fs.writeFileSync(path.join(ROOT, '..', 'dash', '_headers'), out.text); console.log('dash/_headers escrito'); }
  else process.stdout.write(out.text);
}
