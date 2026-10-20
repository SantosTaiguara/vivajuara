// Reads plat/src (every .js, relative paths) and the governance configs for the topic 52/54/55 tests and doc generator.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src'), CFG = path.join(ROOT, 'config', 'governance');
function sources(dir = SRC) {
  const out = {};
  (function walk(d) { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) out[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8'); } })(dir);
  return out;
}
const cfg = name => JSON.parse(fs.readFileSync(path.join(CFG, name + '.json'), 'utf8'));
const mod = name => require(path.join(SRC, 'governance', name));
module.exports = { ROOT, SRC, CFG, sources, cfg, mod };
