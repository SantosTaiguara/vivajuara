'use strict';
/* Tiny forward-only migration runner.
   - migrations/NNN_name.sql are applied in order, each in its own transaction.
   - schema_migrations records version, checksum and timing; an applied file whose
     checksum changed is an error (never edit an applied migration: add a new one).
   - migrations/down/NNN_name.down.sql documents/implements the reverse step for
     development and staging. Production rollback prefers a new forward migration. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.resolve(__dirname, '..', '..', '..', 'migrations');
const LOCK_ID = 7_209_001; // pg_advisory_lock key: one migrator at a time

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function listMigrations(dir = DIR) {
  return fs.readdirSync(dir).filter(f => /^\d{3,}_[a-z0-9_]+\.sql$/.test(f)).sort().map(f => {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const down = path.join(dir, 'down', f.replace(/\.sql$/, '.down.sql'));
    return { version: f.split('_')[0], name: f.replace(/\.sql$/, ''), file: f, sql, checksum: sha256(sql), downFile: fs.existsSync(down) ? down : null };
  });
}

async function ensureTable(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(), execution_ms INTEGER NOT NULL)`);
}

async function status(pool, dir = DIR) {
  const client = await pool.connect();
  try {
    await ensureTable(client);
    const applied = new Map((await client.query('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version')).rows.map(r => [r.version, r]));
    const files = listMigrations(dir);
    const rows = files.map(m => {
      const a = applied.get(m.version);
      return { version: m.version, name: m.name, state: !a ? 'pending' : a.checksum !== m.checksum ? 'modified' : 'applied', appliedAt: a ? a.applied_at : null, reversible: !!m.downFile };
    });
    for (const [v, a] of applied) if (!files.find(m => m.version === v)) rows.push({ version: v, name: a.name, state: 'missing-file', appliedAt: a.applied_at, reversible: false });
    return rows;
  } finally { client.release(); }
}

async function up(pool, { dir = DIR, log = () => {} } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await ensureTable(client);
    const done = new Map((await client.query('SELECT version, checksum FROM schema_migrations')).rows.map(r => [r.version, r.checksum]));
    for (const m of listMigrations(dir)) {
      if (done.has(m.version)) {
        if (done.get(m.version) !== m.checksum) throw new Error(`Migration ${m.file} was modified after being applied (checksum mismatch)`);
        continue;
      }
      const t0 = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (version, name, checksum, execution_ms) VALUES ($1, $2, $3, $4)', [m.version, m.name, m.checksum, Date.now() - t0]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.file} failed: ${e.message}`);
      }
      applied.push(m.name); log(`applied ${m.name} (${Date.now() - t0} ms)`);
    }
    return applied;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch (_) { /* ignore */ }
    client.release();
  }
}

/** Reverts the latest applied migration using its .down.sql (development/staging only). */
async function down(pool, { dir = DIR, log = () => {} } = {}) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await ensureTable(client);
    const last = (await client.query('SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1')).rows[0];
    if (!last) return null;
    const m = listMigrations(dir).find(x => x.version === last.version);
    if (!m || !m.downFile) throw new Error(`Migration ${last.name} has no down script; write a new forward migration instead`);
    await client.query('BEGIN');
    try {
      await client.query(fs.readFileSync(m.downFile, 'utf8'));
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [m.version]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    log(`reverted ${m.name}`);
    return m.name;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]); } catch (_) { /* ignore */ }
    client.release();
  }
}

module.exports = { up, down, status, listMigrations, DIR };
