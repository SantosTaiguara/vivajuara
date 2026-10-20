'use strict';
/* PostgreSQL access. Only repositories use this module; all SQL is parameterized. */
const { Pool } = require('pg');

// Return BIGINT/NUMERIC as JS numbers where safe: revisions are small counters and
// prices fit in a double. JSONB values are parsed by pg itself.
const types = require('pg').types;
types.setTypeParser(20, v => (v == null ? null : Number(v)));   // int8
types.setTypeParser(1700, v => (v == null ? null : Number(v))); // numeric
types.setTypeParser(1082, v => v);                              // date → 'YYYY-MM-DD' (no timezone shift)

function createPool(dbCfg, logger) {
  const pool = new Pool({
    connectionString: dbCfg.connectionString,
    max: dbCfg.max,
    idleTimeoutMillis: dbCfg.idleTimeoutMillis,
    connectionTimeoutMillis: dbCfg.connectionTimeoutMillis,
    statement_timeout: dbCfg.statementTimeoutMs,
    ssl: dbCfg.ssl ? { rejectUnauthorized: true } : undefined,
    application_name: 'plat-backend'
  });
  pool.on('error', err => logger && logger.error('db pool error', { errorCode: 'DB_POOL_ERROR', detail: err.code || err.message }));
  return pool;
}

/** Runs fn(client) inside BEGIN/COMMIT; rolls back on any error. */
async function withTransaction(pool, fn, { isolation = 'READ COMMITTED' } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation === 'SERIALIZABLE' ? 'SERIALIZABLE' : 'READ COMMITTED'}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection may be gone */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTransaction };
