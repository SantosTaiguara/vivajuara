#!/usr/bin/env node
'use strict';
/* Shadow comparison CLI: JSON vs API for every lot, writes a reconciliation report.
   node scripts/shadow-compare.js [--api http://127.0.0.1:8080/api/v1] [--development viva-juara] [--data-dir ../../dash] [--detail-sample 25] [--out reports/]
   Exit code 1 when parity fails. Requires the server to be running. */
const fs = require('fs');
const path = require('path');
const { ROOT } = require('../src/shared/config');
const { runShadowCompare } = require('./lib/shadowCompare');

function arg(name, def) { const i = process.argv.indexOf(name); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def; }

async function main() {
  const apiBaseUrl = arg('--api', process.env.SHADOW_API_BASE_URL || 'http://127.0.0.1:8080/api/v1').replace(/\/+$/, '');
  const res = await runShadowCompare({
    apiBaseUrl, developmentId: arg('--development', 'viva-juara'),
    dataDir: path.resolve(arg('--data-dir', path.join(ROOT, '..', '..', 'dash'))),
    srcDir: path.resolve(process.env.SHARED_SRC_DIR || path.join(ROOT, '..', 'src')),
    detailSample: Number(arg('--detail-sample', 25))
  });
  const outDir = path.resolve(arg('--out', path.join(ROOT, 'reports')));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = res.summary.at.replace(/[:.]/g, '-');
  const jsonFile = path.join(outDir, `shadow-compare-${stamp}.json`), csvFile = path.join(outDir, `shadow-compare-${stamp}.csv`);
  fs.writeFileSync(jsonFile, JSON.stringify(res, null, 2));
  const header = 'lotId,identical,area,price,status,scores,class,alerts,distances,geometryChecksumJson,geometryChecksumApi,geometryMatch,diff';
  fs.writeFileSync(csvFile, [header, ...res.lots.map(r => [r.lotId, r.identical, r.area, r.price, r.status, r.scores, r.class, r.alerts, r.distances,
    r.geometryChecksum && r.geometryChecksum.json, r.geometryChecksum && r.geometryChecksum.api, r.geometryChecksum && r.geometryChecksum.match, (r.diff || []).join('|')].join(','))].join('\n') + '\n');
  const s = res.summary;
  console.log(`shadow compare ${s.parity ? 'PARITY OK' : 'PARITY FAILED'}  json=${s.jsonLots} api=${s.apiLots} compared=${s.comparedLots}`);
  console.log(`  identical=${s.identical} area=${s.area} price=${s.price} status=${s.status} scores=${s.scores} class=${s.class} alerts=${s.alerts} distances=${s.distances} geometry=${s.geometryChecksum}`);
  console.log(`  map-lots: ${s.mapLots.count} lots, ${s.mapLots.mismatches} mismatches; lot detail sample: ${s.detailSample.checked} checked, ${s.detailSample.mismatches} mismatches`);
  console.log(`  api layer states: ${JSON.stringify(s.apiLayerStates)}  excluded: ${s.excludedFromComparison.join('; ')}`);
  console.log(`  report: ${path.relative(process.cwd(), jsonFile)} and .csv  (${s.durationMs} ms)`);
  for (const r of res.lots.filter(x => !x.identical).slice(0, 10)) console.log(`  DIFF ${r.lotId}: ${(r.diff || [r.missingIn]).join(', ')}`);
  if (!s.parity) process.exitCode = 1;
}
main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
