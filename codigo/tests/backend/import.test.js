'use strict';
/* Import: dry-run writes nothing, first run creates 498 lots, second run is a no-op (idempotent),
   backup with checksum, validation before writing, immutable published versions. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const h = require('./helpers');

let db, tmp;
const count = async table => Number((await db.pool.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
const run = (opts = {}) => h.importDevelopmentData({ pool: db.pool, App: db.App, file: h.LOTS_FILE, developmentId: 'viva-juara', backupDir: path.join(tmp, 'backups'), assetDir: h.DATA, ...opts });

test.before(async () => {
  db = await h.setupDatabase('import', { importData: false });
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-import-'));
});
test.after(async () => { if (db) await db.pool.end(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

test('dry-run reports what would be created and writes nothing (no rows, no backup)', async () => {
  const r = await run({ dryRun: true });
  assert.equal(r.status, 'OK', JSON.stringify(r.errors));
  assert.equal(r.dryRun, true);
  assert.equal(r.total, 498);
  assert.equal(r.created, 498);
  assert.equal(r.errors.length, 0);
  for (const t of ['developments', 'lots', 'lot_analysis', 'lot_prices', 'lot_availability', 'audit_log', 'import_runs']) assert.equal(await count(t), 0, t);
  assert.equal(r.backup, null);
  assert.equal(fs.existsSync(path.join(tmp, 'backups')), false);
});

test('first import creates 498 lots with every layer and backs up the original file', async () => {
  const r = await run();
  assert.equal(r.status, 'OK', JSON.stringify(r.errors));
  assert.deepEqual([r.created, r.updated, r.unchanged], [498, 0, 0]);
  for (const t of ['lots', 'lot_analysis', 'lot_prices', 'lot_availability']) assert.equal(await count(t), 498, t);
  assert.equal(await count('blocks'), r.entities.blocks.created);
  assert.equal(await count('import_runs'), 1);
  const sum = require('crypto').createHash('sha256').update(fs.readFileSync(h.LOTS_FILE)).digest('hex');
  assert.equal(r.fileChecksum, sum);
  assert.equal(r.backup.checksum, sum);
  assert.ok(fs.existsSync(r.backup.path));
  assert.ok(fs.readFileSync(r.backup.path + '.sha256', 'utf8').startsWith(sum));
  const dev = (await db.pool.query('SELECT current_static_version, current_analysis_version_id, current_price_table_id FROM developments WHERE id = $1', ['viva-juara'])).rows[0];
  assert.ok(dev.current_static_version && dev.current_analysis_version_id && dev.current_price_table_id);
});

test('second import is idempotent: 0 created, 0 updated, nothing duplicated', async () => {
  const r = await run();
  assert.equal(r.status, 'OK', JSON.stringify(r.errors));
  assert.deepEqual([r.created, r.updated, r.unchanged], [0, 0, 498]);
  for (const [k, v] of Object.entries(r.entities)) assert.deepEqual([k, v.created, v.updated], [k, 0, 0]);
  assert.equal(await count('lots'), 498);
  assert.equal(await count('lot_analysis'), 498);
  assert.equal(await count('analysis_versions'), 1);
  assert.equal(await count('price_tables'), 1);
  assert.equal(r.backup.reused, true);
});

test('validation runs before writing: a duplicated id aborts the import', async () => {
  const raw = h.readJson(h.LOTS_FILE);
  raw.push({ ...raw[0] });
  const file = path.join(tmp, 'dup.json'); fs.writeFileSync(file, JSON.stringify(raw));
  const runsBefore = await count('import_runs');
  const r = await run({ file });
  assert.equal(r.status, 'FAILED');
  assert.ok(r.errors.some(e => e.code === 'DUPLICATE_ID'));
  assert.equal(await count('lots'), 498);
  assert.equal(await count('import_runs'), runsBefore);
});

test('an invalid polygon is rejected by the shared LotFactory validation', async () => {
  const raw = h.readJson(h.LOTS_FILE);
  const polyKey = Object.keys(raw[0]).find(k => Array.isArray(raw[0][k]) && Array.isArray(raw[0][k][0]));
  assert.ok(polyKey, 'legacy polygon field');
  raw[0][polyKey] = [[0, 0]];
  const file = path.join(tmp, 'badpoly.json'); fs.writeFileSync(file, JSON.stringify(raw));
  const r = await run({ file, dryRun: true });
  assert.equal(r.status, 'FAILED');
  assert.ok(r.errors.some(e => e.code === 'LOT_REJECTED' || e.code === 'INVALID_POLYGON' || e.code === 'RECORD_SKIPPED'), JSON.stringify(r.errors.slice(0, 3)));
});

test('changed static data under the same staticDataVersion is a conflict (history is not overwritten)', async () => {
  const raw = h.readJson(h.LOTS_FILE);
  raw[0].a = raw[0].a + 1;
  const file = path.join(tmp, 'changed.json'); fs.writeFileSync(file, JSON.stringify(raw));
  const before = (await db.pool.query('SELECT static FROM lots ORDER BY id LIMIT 1')).rows[0].static.geometry.areaM2;
  const r = await run({ file });
  assert.equal(r.status, 'FAILED');
  assert.ok(r.errors.some(e => e.code === 'STATIC_VERSION_CONFLICT'), JSON.stringify(r.errors));
  const after = (await db.pool.query('SELECT static FROM lots ORDER BY id LIMIT 1')).rows[0].static.geometry.areaM2;
  assert.equal(after, before);
});
