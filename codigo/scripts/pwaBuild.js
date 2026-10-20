// Topic 49 — PWA build step. Writes, next to index.html:
//   manifest.webmanifest   Web App Manifest (src/pwa/webManifest.js, validated: the build fails on an unsafe manifest)
//   icons/*.png            192, 512 and maskable 512 (src/pwa/icons)
//   offline.html           static offline fallback page (no script; markers filled by the worker)
//   (round 6) the lazy chunks dash/chunks/*.js|css named in the page's App.CHUNK_MANIFEST are precached as APP_CHUNK (required)
//   sw.js                  src/sw.template.js + pwa/swRouting.js (inlined) + routing table (scripts/cacheRules.js) + PrecacheManifest + asset revisions
//   precache-manifest.json the PrecacheManifest (§32) for diagnostics and tests
// Run by scripts/build.js after build-data.js (the asset revisions come from the published files). Usage: node scripts/pwaBuild.js <outDir> <buildId>
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const SRC = path.join(__dirname, '..', 'src');
const WM = require('../src/pwa/webManifest.js');
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12); // same digest as build-data.js checksums
const SW_META = { cacheSchemaVersion: '1', offlinePackSchemaVersion: '1', apiCompatibilityVersion: '1', queueSchemaVersion: '1' }; // keep in step with App.pwa.core.VERSIONS

/** revisions of every published file the worker may route: data assets from manifest.json (checksums) + images found on disk */
function assetRevisions(out) {
  const rev = {};
  try { for (const a of JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')).assets || []) if (a && a.path && a.checksum) rev[a.path] = a.checksum; } catch (e) { /* no data manifest */ }
  const walk = (dir, pre) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f), r = pre + f; if (fs.statSync(p).isDirectory()) walk(p, r + '/'); else if (/\.(webp|png|jpe?g|svg)$/i.test(f) && !rev[r]) rev[r] = sha(fs.readFileSync(p)); } };
  walk(path.join(out, 'img'), 'img/'); walk(path.join(out, 'icons'), 'icons/');
  for (const f of ['logo.png', 'planta.webp', 'aerea.webp']) if (!rev[f] && fs.existsSync(path.join(out, f))) rev[f] = sha(fs.readFileSync(path.join(out, f)));
  return rev;
}
/** PrecacheManifest: app shell + offline fallback + essential static assets only (§30, §31, §48). Never maps, data, documents, high-res. */
function precacheManifest(out, version) {
  const E = (url, assetType, required, expect) => { const f = path.join(out, url === './' ? 'index.html' : url); if (!fs.existsSync(f)) return null; const b = fs.readFileSync(f);
    return { url, revision: url === './' ? version : sha(b), assetType, bytes: b.length, required, expect }; };
  return [E('./', 'APP_SHELL', true, 'SHELL'), E('offline.html', 'OFFLINE_FALLBACK', true, 'PAGE'), E('manifest.webmanifest', 'WEB_APP_MANIFEST', false, null),
    E('icons/icon-192.png', 'ICON', false, 'IMAGE'), E('icons/icon-512.png', 'ICON', false, 'IMAGE'), E('icons/icon-maskable-512.png', 'ICON', false, 'IMAGE'), E('logo.png', 'ESSENTIAL_STATIC_ASSET', false, 'IMAGE'),
    // round 6: the lazy code chunks of this build (dash/chunks/<chunk>.<hash>.js/.css) are part of the app shell: required, so a view
    // opened for the first time offline still has its code. Content-hashed names: a new build precaches new files, never stale code.
    ...chunkFiles(out).map(f => E(f, 'APP_CHUNK', true, /\.css$/.test(f) ? 'STYLE' : 'SCRIPT'))].filter(Boolean);
}
/** chunk files referenced by the page's App.CHUNK_MANIFEST (only those: a stale file left in the folder is never precached) */
function chunkFiles(out) {
  try {
    const page = fs.readFileSync(path.join(out, 'index.html'), 'utf8'), m = page.match(/App\.CHUNK_MANIFEST = (\{.*?\});\n/);
    if (!m) return [];
    return Object.values(JSON.parse(m[1])).flatMap(e => [...(e.css || []), e.file]).filter(f => /^chunks\/[a-z]+\.[0-9a-f]{10}\.(js|css)$/.test(f) && fs.existsSync(path.join(out, f)));
  } catch (e) { return []; }
}
function build({ out, version, rules = null, branding = {} }) {
  if (!out || !version) throw new Error('pwaBuild: out e version são obrigatórios');
  // 1. web app manifest (validated) + icons + offline page
  const manifest = WM.buildWebManifest(branding), v = WM.validateWebManifest(manifest);
  if (!v.ok) throw new Error('manifest.webmanifest inválido: ' + v.errors.map(e => e.message).join('; '));
  fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 1));
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC, 'pwa', 'icons'))) fs.copyFileSync(path.join(SRC, 'pwa', 'icons', f), path.join(out, 'icons', f));
  fs.copyFileSync(path.join(SRC, 'pwa', 'offline.html'), path.join(out, 'offline.html'));
  // 2. worker
  const precache = precacheManifest(out, version), rev = assetRevisions(out);
  const table = rules || require('./cacheRules.js').rules();
  const routing = fs.readFileSync(path.join(SRC, 'pwa', 'swRouting.js'), 'utf8');
  const sw = fs.readFileSync(path.join(SRC, 'sw.template.js'), 'utf8')
    .replace('__VERSION__', version)
    .replace('__SW_META__', JSON.stringify(SW_META))
    .replace('__PRECACHE__', JSON.stringify(precache))
    .replace('__ASSET_REV__', JSON.stringify(rev))
    .replace('/*__SW_ROUTING__*/', () => '/* ---- pwa/swRouting.js ---- */\n' + routing)
    .replace('__CACHE_RULES__', JSON.stringify(table));
  fs.writeFileSync(path.join(out, 'sw.js'), sw);
  execFileSync(process.execPath, ['--check', path.join(out, 'sw.js')]);
  fs.writeFileSync(path.join(out, 'precache-manifest.json'), JSON.stringify({ kind: 'precache-manifest', appShellVersion: version, serviceWorkerBuildId: version, ...SW_META, entries: precache }, null, 1));
  return { precache, revisions: rev, manifest, swBytes: Buffer.byteLength(sw) };
}
module.exports = { build, precacheManifest, assetRevisions, chunkFiles, SW_META, sha };
if (require.main === module) { const r = build({ out: path.resolve(process.argv[2]), version: process.argv[3] || 'dev' }); console.log('pwa', r.precache.length, 'precache entries,', Object.keys(r.revisions).length, 'revisions, sw', r.swBytes, 'bytes'); }
