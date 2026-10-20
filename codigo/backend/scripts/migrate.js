#!/usr/bin/env node
'use strict';
/* Migration CLI: up | status | check | down --confirm (down refused in production). */
const { loadConfig } = require('../src/shared/config');
const { createPool } = require('../src/shared/db/pool');
const migrator = require('../src/shared/db/migrator');

async function main() {
  const cmd = process.argv[2] || 'status';
  const config = loadConfig();
  const pool = createPool(config.db);
  try {
    if (cmd === 'up') {
      const applied = await migrator.up(pool, { log: m => console.log(m) });
      console.log(applied.length ? `${applied.length} migration(s) applied` : 'schema up to date');
    } else if (cmd === 'status' || cmd === 'check') {
      const rows = await migrator.status(pool);
      for (const r of rows) console.log(`${r.version}  ${r.state.padEnd(12)} ${r.reversible ? 'reversible' : 'forward-only'}  ${r.name}${r.appliedAt ? '  ' + r.appliedAt.toISOString() : ''}`);
      if (cmd === 'check') {
        const bad = rows.filter(r => r.state !== 'applied');
        if (bad.length) { console.error(`migration check failed: ${bad.map(r => `${r.name}=${r.state}`).join(', ')}`); process.exitCode = 1; }
        else console.log('migration check ok');
      }
    } else if (cmd === 'down') {
      if (config.isProduction) throw new Error('down is disabled in production: write a new forward migration and/or restore a backup');
      if (!process.argv.includes('--confirm')) throw new Error('down drops data; re-run with --confirm');
      const name = await migrator.down(pool, { log: m => console.log(m) });
      console.log(name ? `reverted ${name}` : 'nothing to revert');
    } else throw new Error(`unknown command ${cmd} (use up | status | check | down --confirm)`);
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
