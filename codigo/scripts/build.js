// Builds the artifact: dash/index.html (title first, inline CSS + core JS, shell markup) + dash/chunks/*.js (round 6, lazy chunks),
// dash/sw.js + PWA files (scripts/pwaBuild.js), dash/manifest.json, dash/commercial.json and dash/admin.html (scripts/buildAdmin.js).
// The public page bundles the configs with the 'public' profile (scripts/configBundle.js: no admin-only permissions/configs). Run from plat/: node scripts/build.js
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const SRC = path.join(__dirname, '..', 'src'), OUT = path.join(__dirname, '..', '..', 'dash');
const { ORDER } = require('../tests/harness.js');
const UI = ['presentation/dom.js', 'navigation/menuView.js', 'presentation/compareView.js', 'presentation/pricingView.js', 'presentation/securityView.js', 'presentation/dataTrustView.js', 'presentation/favoritesView.js', 'customer/customerView.js', 'decision/decisionView.js', 'presentationmode/presentationView.js', 'share/sharedShellView.js', 'loading/loadingView.js', 'loading/chunkLoader.js', 'pwa/pwaView.js', 'privacy/deviceData.js', 'privacy/privacyView.js', 'presentation/map.js', 'presentation/panels.js', 'presentation/overlays.js', 'presentation/app.js'];
const all = [...ORDER, ...UI].filter(f => fs.existsSync(path.join(SRC, f)));
// round 6: code splitting (scripts/chunks.js, plan = loading/resources.js FEATURE_MODULES). Modules not needed for the first paint of
// the map route go to dash/chunks/<chunk>.<hash>.js (loaded on first use by App.chunks, precached by sw.js); the page keeps the rest.
const SPLIT = require('./chunks.js').split({ files: all, configs: require('./configBundle.js').read(undefined, { profile: 'public' }) });
const files = SPLIT.coreFiles;
const js = files.map(f => `/* ---- ${f} ---- */\n` + fs.readFileSync(path.join(SRC, f), 'utf8') + (f === 'prelude.js' ? '\n/* ---- configs (plat/config) ---- */\n' + `App.configs = ${JSON.stringify(SPLIT.coreConfigs)};` + '\n/* ---- chunk manifest (round 6) ---- */\n' + `App.CHUNK_MANIFEST = ${JSON.stringify(SPLIT.manifest)};` : '')).join('\n');
for (const f of [...all, ...require('./chunks.js').LAZY_ONLY]) if (fs.existsSync(path.join(SRC, f))) execFileSync(process.execPath, ['--check', path.join(SRC, f)]);
// styles.css first, then any module stylesheet (presentation/*.css) in name order.
const css = ['styles.css', ...fs.readdirSync(path.join(SRC, 'presentation')).filter(f => f.endsWith('.css') && f !== 'styles.css').sort()]
  .map(f => fs.readFileSync(path.join(SRC, 'presentation', f), 'utf8')).join('\n');
const shell = fs.readFileSync(path.join(SRC, 'presentation/shell.html'), 'utf8');
const html = `<title>Mapa de Lotes Viva Juara</title>
<meta name="description" content="Mapa interativo dos 498 lotes do Viva Juara: preço, área, análise, simulação e comparação.">
${require('../src/pwa/webManifest.js').headTags()}
<meta name="app-build-id" content="__APP_BUILD_ID__">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600;700&display=swap">
<style>
${css}
</style>
${shell}
<script>
${js.replace(/<\/script/gi, '<\\/script')}
</script>
`;
// topic 49: the build id is the hash of the page with a placeholder; the page then carries it (<meta name="app-build-id">) so the app can
// detect a mixed app/worker version. The worker (sw.js), manifest.webmanifest, icons and offline.html are written by scripts/pwaBuild.js.
const version = crypto.createHash('sha256').update(html).digest('hex').slice(0, 10);
require('./chunks.js').write(OUT, SPLIT.chunks);
fs.writeFileSync(path.join(OUT, 'index.html'), html.replace('__APP_BUILD_ID__', version));
execFileSync(process.execPath, [path.join(__dirname, 'build-data.js'), version], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
require('./pwaBuild.js').build({ out: OUT, version });
// round 5: the separate admin shell (dash/admin.html, not linked from the public panel) — scripts/buildAdmin.js
const adm = require('./buildAdmin.js').build({ out: OUT });
console.log('built admin.html', adm.modules, 'modules,', (adm.bytes / 1024).toFixed(0), 'KB');
console.log('built', files.length, 'modules,', (html.length / 1024).toFixed(0), 'KB, version', version);
// bundle analysis (topic 47 analyzeBundle on the page + the chunk files): initial JS vs the MAP_ROUTE budget, chunk list
{ const A = require('../tests/harness.js').load(); new Function('App', fs.readFileSync(path.join(SRC, 'loading/planner.js'), 'utf8'))(A);
  const an = A.loading.planner.analyzeBundle(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8')), b = A.loading.planner.BUDGETS.MAP_ROUTE;
  console.log(`initial JS ${an.jsBytes} bytes (budget ${b.maxInitialJsBytes}), CSS ${an.cssBytes} (budget ${b.maxInitialCssBytes}); ${SPLIT.chunks.length} lazy chunks:`);
  for (const c of SPLIT.chunks) console.log(`  ${c.file}  ${c.bytes} bytes  ${c.modules.length} modules${c.deps.length ? '  deps ' + c.deps.join(',') : ''}${c.css.length ? '  + ' + c.css.map(x => x.file).join(',') : ''}`); }
