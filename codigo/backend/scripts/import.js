#!/usr/bin/env node
'use strict';
/* Import CLI (ImportDevelopmentDataService).
   node scripts/import.js [--file ../../dash/lots.json] [--development viva-juara] [--dry-run] [--backup-dir backups] [--report-file reports/x.json] [--analysis-input <file>] [--json]
   Exit code: 0 ok, 1 validation/conflict/database error. */
const fs = require('fs');
const path = require('path');
const { loadConfig, ROOT } = require('../src/shared/config');
const { createPool } = require('../src/shared/db/pool');
const { getSharedApp } = require('../src/shared/domain/sharedDomain');
const { importDevelopmentData } = require('../src/modules/imports/importDevelopmentData.service');

function arg(name, def) { const i = process.argv.indexOf(name); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; }

async function main() {
  const config = loadConfig();
  const file = path.resolve(arg('--file', path.join(ROOT, '..', '..', 'dash', 'lots.json')));
  const developmentId = arg('--development', 'viva-juara');
  const dryRun = process.argv.includes('--dry-run');
  const backupDir = path.resolve(arg('--backup-dir', path.join(ROOT, 'backups')));
  const pool = createPool(config.db);
  let report;
  try {
    report = await importDevelopmentData({ pool, App: getSharedApp(config.sharedSrcDir, config.sharedConfigDir), file, developmentId, dryRun, backupDir, analysisInputFile: arg('--analysis-input', undefined) && path.resolve(arg('--analysis-input')) });
  } finally { await pool.end(); }
  const reportFile = arg('--report-file', null);
  if (reportFile) { fs.mkdirSync(path.dirname(path.resolve(reportFile)), { recursive: true }); fs.writeFileSync(path.resolve(reportFile), JSON.stringify(report, null, 2)); }
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`import ${report.dryRun ? '(DRY-RUN, nothing written) ' : ''}${report.status}  development=${report.developmentId} file=${report.file} sha256=${report.fileChecksum.slice(0, 16)}…`);
    console.log(`records=${report.total} validLots=${report.validLots}  lots: created=${report.created} updated=${report.updated} unchanged=${report.unchanged}  errors=${report.errors.length} warnings=${report.warnings.length}`);
    for (const [k, v] of Object.entries(report.entities)) console.log(`  ${k.padEnd(16)} created=${v.created} updated=${v.updated} unchanged=${v.unchanged}`);
    if (Object.keys(report.warningsByCode).length) console.log('  warnings by code:', JSON.stringify(report.warningsByCode));
    if (report.analysisInput) console.log(`  analysisInput: ${report.analysisInput.status || ''}${report.analysisInput.inputVersion ? ' version=' + report.analysisInput.inputVersion : ''}`);
    if (report.backup) console.log(`  backup: ${report.backup.key} (${report.backup.reused ? 'already existed' : 'created'}, sha256 verified)`);
    for (const e of report.errors.slice(0, 20)) console.log(`  ERROR ${e.code}${e.lotId ? ' ' + e.lotId : ''}: ${e.message || ''}`);
    console.log(`  duration=${report.durationMs} ms`);
  }
  if (report.status !== 'OK') process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exit(1); });
