// Generates the published data documents next to lots.json (run from plat/):
//   manifest.json   — CacheManifest: versions, checksums, assets (informs versions only; not a commercial source)
//   commercial.json — the current price table document (dynamic, network-first in the app)
// Usage: node scripts/build-data.js [appVersion]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { load, DATA } = require('../tests/harness.js');
(async () => {
  const App = load(), dev = App.config.DEVELOPMENTS.find(d => d.id === 'viva-juara');
  const cr = App.repos.CommercialRepository(dev.id);
  const res = App.repos.buildSnapshotsFromLegacy(JSON.parse(fs.readFileSync(path.join(DATA, 'lots.json'), 'utf8')), dev, cr, '2026-10-06T00:00:00.000Z');
  const commercial = { kind: 'commercial-source', schemaVersion: App.domain.SCHEMA_VERSION, developmentId: dev.id, revision: 1, updatedAt: '2026-10-06T00:00:00.000Z',
    currentPriceTableId: dev.currentPriceTableId, priceTables: dev.priceTables, note: 'Fonte comercial publicada. O aplicativo busca este arquivo na rede antes de usar a cópia salva.' };
  fs.writeFileSync(path.join(DATA, 'commercial.json'), JSON.stringify(commercial, null, 1));
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(path.join(DATA, f))).digest('hex').slice(0, 12);
  const A = (p, priority, strategy, kind) => fs.existsSync(path.join(DATA, p)) ? { path: p, checksum: sha(p), bytes: fs.statSync(path.join(DATA, p)).size, priority, strategy, kind } : null;
  const imgs = JSON.parse(fs.readFileSync(path.join(DATA, 'img_list.json'), 'utf8')).map(x => A(x.f, 'P3', 'on-demand', 'image'));
  const assets = [A('logo.png', 'P0', 'precache', 'image'), A('planta.webp', 'P0', 'cache-on-first-use', 'image'), A('lots.json', 'P0', 'indexeddb', 'data'),
    A('commercial.json', 'P1', 'network-first', 'data'), A('routes.json', 'P1', 'memory', 'data'), A('aerea.webp', 'P2', 'lazy', 'image'), A('img_list.json', 'P3', 'memory', 'data'), A('analysis-input.json', 'P3', 'on-demand', 'data'), ...imgs].filter(Boolean);
  const m = App.offline.buildManifest({ dev, layers: res.layers, assets, appVersion: process.argv[2] || 'dev', generatedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(DATA, 'manifest.json'), JSON.stringify(m, null, 1));
  console.log('manifest', JSON.stringify({ ...m, assets: m.assets.length }));
})().catch(e => { console.error(e); process.exit(1); });
