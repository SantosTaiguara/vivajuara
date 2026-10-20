// Golden baseline (topic 54): captures the current product outputs over the Viva Juara dataset into tests/golden/.
//   node scripts/goldenBaseline.js            → compares with the stored baseline and prints the drift (exit 1 on drift)
//   node scripts/goldenBaseline.js --update   → rewrites tests/golden/*.golden.json (only after a human-approved change:
//                                                 record the reason in docs/LEGACY_PARITY_EXCEPTIONS.md / DATA_PARITY_REPORT.md)
const fs = require('fs'), path = require('path');
const { load, DATA, SRC } = require('../tests/harness.js');
const ROOT = path.join(__dirname, '..'), GOLDEN = path.join(ROOT, 'tests', 'golden');
const SPEC = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'governance', 'golden.json'), 'utf8'));

/** a Date whose "now" is the baseline's fixed clock (so freshness/relative texts are reproducible) */
function fixedDate(iso) {
  const T = new Date(iso).getTime();
  return class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } };
}
const readJson = f => { const p = path.join(DATA, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };

async function captureCurrent() {
  const App = load({ Date: fixedDate(SPEC.fixedClock) });
  new Function('App', fs.readFileSync(path.join(SRC, 'governance', 'goldenBaseline.js'), 'utf8'))(App);
  const repo = App.repos.LotRepository(SPEC.developmentId); await repo.load();
  const dev = App.repos.DevelopmentRepository.getDevelopmentConfig(SPEC.developmentId);
  const files = Object.fromEntries(SPEC.dataFiles.map(f => [f, readJson(f)]));
  return { App, snapshot: App.governance.golden.capture(App, { repo, dev, spec: SPEC, files, manifest: readJson('manifest.json') }) };
}
function readBaseline() {
  const meta = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'baseline.json'), 'utf8')), categories = {};
  for (const f of meta.fixtureRefs) { const c = path.basename(f).replace('.golden.json', ''); categories[c] = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
  return { meta, categories };
}
function write(snapshot) {
  fs.mkdirSync(GOLDEN, { recursive: true });
  // one top-level entry per line: small, reviewable diffs (one lot / one layer / one scenario per line)
  const lines = o => '{\n' + Object.keys(o).map(k => JSON.stringify(k) + ': ' + JSON.stringify(o[k])).join(',\n') + '\n}\n';
  for (const [c, data] of Object.entries(snapshot.categories)) fs.writeFileSync(path.join(GOLDEN, `${c}.golden.json`), lines(data));
  const meta = { ...snapshot.meta, createdAt: SPEC.fixedClock, appVersion: 'single-file build (plat/src) — topics 1–56', knownExceptions: [] };
  fs.writeFileSync(path.join(GOLDEN, 'baseline.json'), JSON.stringify(meta, null, 1) + '\n');
}
module.exports = { SPEC, GOLDEN, captureCurrent, readBaseline, fixedDate };

if (require.main === module) (async () => {
  const { App, snapshot } = await captureCurrent();
  if (process.argv.includes('--update')) { write(snapshot); console.log('golden baseline escrito em', GOLDEN, snapshot.meta.categoryFingerprints); return; }
  const base = readBaseline(); let total = 0;
  for (const c of App.governance.golden.CATEGORIES) { const d = App.governance.golden.diff(base.categories[c], snapshot.categories[c], '$'); total += d.length; if (d.length) { console.log(`✗ ${c}: ${d.length} diferença(s)`); d.slice(0, 15).forEach(x => console.log('   ', x.path, JSON.stringify(x.expected), '→', JSON.stringify(x.actual))); } else console.log(`✓ ${c}`); }
  if (total) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
