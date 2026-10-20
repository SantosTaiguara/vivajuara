// Round 6 — code splitting of the public panel (build-time only; the tests keep loading every module in the harness ORDER).
// The split plan is loading/resources.js FEATURE_MODULES (lazy: true): those modules, plus their config folders, leave the
// inline page and are written as dash/chunks/<chunk>.<sha256/10>.js (+ .css when the feature has a stylesheet), loaded on first
// use by App.chunks (src/loading/chunkLoader.js) and precached by the Service Worker (scripts/pwaBuild.js).
//   split({ files, configs }) → { coreFiles, coreConfigs, chunks: [{ name, file, text, bytes, integrity, deps, css: [{ file, text }] }], manifest }
// Inside a chunk the modules keep the order they have in [...ORDER, ...UI] (same semantics as the single file); every chunk
// ends with App.chunks._done('<name>') so the loader knows it ran to the end.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
/** modules that exist only as lazy chunks of the public page (not in the harness ORDER nor in the build UI list) */
const LAZY_ONLY = ['config/surroundings/surroundings.config.js', 'surroundings/surroundingsDomain.js', 'surroundings/surroundingsView.js',
  'surroundings/geoMercator.js', 'surroundings/slippyMap.js', 'surroundings/entornoView.js']; // round 7: keyless Entorno map
/** the FEATURE_MODULES table, read from loading/resources.js itself (single source of truth for the split) */
function featureModules() {
  const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext('var App = { loading: {} };', ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'loading/resources.js'), 'utf8'), ctx, { filename: 'loading/resources.js' });
  return ctx.App.loading.resources;
}
const sha = (s, alg = 'sha256', enc = 'hex') => crypto.createHash(alg).update(s, 'utf8').digest(enc);
const marker = f => `/* ---- ${f} ---- */\n`;
function split({ files, configs }) {
  const R = featureModules(), lazy = new Map(R.FEATURE_MODULES.filter(m => m.lazy).map(m => [m.moduleId, m]));
  const coreFiles = [], byChunk = new Map([...lazy.keys()].map(k => [k, []]));
  for (const f of files) { const c = R.chunkOf(f); if (lazy.has(c)) byChunk.get(c).push(f); else coreFiles.push(f); }
  for (const f of LAZY_ONLY) { const c = R.chunkOf(f); if (!lazy.has(c)) throw new Error(`chunks: ${f} deveria ser de um chunk sob demanda`); if (!byChunk.get(c).includes(f) && fs.existsSync(path.join(SRC, f))) byChunk.get(c).push(f); }
  const coreConfigs = { ...configs }, chunks = [];
  for (const [name, mods] of byChunk) {
    const def = lazy.get(name), cfg = {};
    for (const sub of def.configs || []) if (Object.prototype.hasOwnProperty.call(coreConfigs, sub)) { cfg[sub] = coreConfigs[sub]; delete coreConfigs[sub]; }
    if (!mods.length && !Object.keys(cfg).length) continue;
    const body = (Object.keys(cfg).length ? marker(`configs (${name})`) + `Object.assign(App.configs, ${JSON.stringify(cfg)});\n` : '')
      + mods.map(f => marker(f) + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n')
      + `\n/* ---- chunk end ---- */\nApp.chunks._done(${JSON.stringify(name)});\n`;
    const text = `/* Viva Juara — chunk "${name}" (round 6 code splitting). Loaded on first use by App.chunks; precached by sw.js. */\n${body}`;
    const css = (def.css || []).filter(f => fs.existsSync(path.join(SRC, f))).map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    chunks.push({ name, modules: mods, file: `chunks/${name}.${sha(text).slice(0, 10)}.js`, text, bytes: Buffer.byteLength(text), integrity: 'sha384-' + sha(text, 'sha384', 'base64'),
      deps: (def.dependencies || []).filter(d => lazy.has(d)), css: css ? [{ file: `chunks/${name}.${sha(css).slice(0, 10)}.css`, text: css }] : [] });
  }
  const manifest = Object.fromEntries(chunks.map(c => [c.name, { file: c.file, integrity: c.integrity, bytes: c.bytes, deps: c.deps, css: c.css.map(x => x.file) }]));
  return { coreFiles, coreConfigs, chunks, manifest };
}
/** write(out, chunks) — replaces dash/chunks/ (stale hashed files of older builds are removed) */
function write(out, chunks) {
  const dir = path.join(out, 'chunks'); fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/\.(js|css)$/.test(f)) fs.unlinkSync(path.join(dir, f));
  for (const c of chunks) { fs.writeFileSync(path.join(out, c.file), c.text); for (const s of c.css) fs.writeFileSync(path.join(out, s.file), s.text); }
  return chunks.flatMap(c => [c.file, ...c.css.map(s => s.file)]);
}
module.exports = { split, write, featureModules, LAZY_ONLY };
