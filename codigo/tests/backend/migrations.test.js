'use strict';
/* Migration runner: forward apply, idempotent re-run, reversibility (down scripts), and refusal
   to run when an applied migration file was edited. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('./helpers');

let pool, tmp;
test.before(async () => {
  const url = await h.freshDatabase('migrations');
  pool = h.createPool(h.testConfig(url).db);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-mig-'));
});
test.after(async () => { if (pool) await pool.end(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

const tables = async () => (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map(r => r.tablename);

test('up applies every migration once; a second up is a no-op', async () => {
  const files = h.migrator.listMigrations();
  assert.deepEqual(await h.migrator.up(pool), files.map(f => f.name));
  assert.deepEqual(await h.migrator.up(pool), []);
  const st = await h.migrator.status(pool);
  assert.ok(st.every(r => r.state === 'applied' && r.reversible));
  for (const t of ['developments', 'blocks', 'lots', 'static_versions', 'analysis_versions', 'lot_analysis', 'price_tables', 'payment_plans', 'lot_prices',
    'lot_availability', 'availability_history', 'sources', 'assets', 'audit_log', 'import_runs', 'organizations', 'organization_domains', 'users', 'organization_memberships', 'roles', 'role_assignments', 'auth_tokens', 'schema_migrations']) assert.ok((await tables()).includes(t), t);
});

test('every migration is reversible in development (down to empty, then up again)', async () => {
  const n = h.migrator.listMigrations().length;
  for (let i = 0; i < n; i++) assert.ok(await h.migrator.down(pool));
  assert.deepEqual(await tables(), ['schema_migrations']);
  assert.equal((await h.migrator.up(pool)).length, n);
});

test('an applied migration that was edited is refused (checksum mismatch)', async () => {
  for (const f of fs.readdirSync(h.migrator.DIR)) if (f.endsWith('.sql')) fs.copyFileSync(path.join(h.migrator.DIR, f), path.join(tmp, f));
  const first = fs.readdirSync(tmp).filter(f => f.endsWith('.sql')).sort()[0];
  fs.appendFileSync(path.join(tmp, first), '\n-- edited after being applied\n');
  await assert.rejects(h.migrator.up(pool, { dir: tmp }), /modified after being applied/);
  assert.equal((await h.migrator.status(pool, tmp)).find(r => r.name + '.sql' === first).state, 'modified');
});
