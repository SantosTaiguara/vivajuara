'use strict';
/* Shared helpers for backend tests: one throwaway database per test file (files may run in parallel),
   migrations + import, an in-process server, and frontend App contexts (vm) for the client side.
   Requires a reachable PostgreSQL (TEST_DATABASE_ADMIN_URL, default postgres://postgres@127.0.0.1:5432/postgres). */
const fs = require('fs');
const path = require('path');
const BACKEND = path.resolve(__dirname, '..', '..', 'backend');
const SRC = path.resolve(__dirname, '..', '..', 'src');
const DATA = path.resolve(__dirname, '..', '..', '..', 'dash');
const { Client } = require(path.join(BACKEND, 'node_modules', 'pg'));
const { loadConfig } = require(path.join(BACKEND, 'src/shared/config'));
const { createPool } = require(path.join(BACKEND, 'src/shared/db/pool'));
const migrator = require(path.join(BACKEND, 'src/shared/db/migrator'));
const { startServer } = require(path.join(BACKEND, 'src/app'));
const { createLogger } = require(path.join(BACKEND, 'src/shared/logging/logger'));
const { createAppContext } = require(path.join(BACKEND, 'src/shared/domain/sharedDomain'));
const { importDevelopmentData } = require(path.join(BACKEND, 'src/modules/imports/importDevelopmentData.service'));
const { FRONTEND_ORDER, useBackend, fileFetch, comparable, runShadowCompare } = require(path.join(BACKEND, 'scripts/lib/shadowCompare'));
const { stableStringify } = require(path.join(BACKEND, 'src/shared/domain/checksum'));

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://postgres@127.0.0.1:5432/postgres';
const LOTS_FILE = path.join(DATA, 'lots.json');

function dbUrl(name) { const u = new URL(ADMIN_URL); u.pathname = '/' + name; return u.toString(); }

/** Drops and recreates plat_test_<name>; returns its connection string. */
async function freshDatabase(name) {
  const db = `plat_test_${name}`;
  const c = new Client({ connectionString: ADMIN_URL });
  try { await c.connect(); } catch (e) { throw new Error(`PostgreSQL not reachable at ${ADMIN_URL} (${e.message}). Start it or set TEST_DATABASE_ADMIN_URL.`); }
  try {
    await c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${db}`);
  } finally { await c.end(); }
  return dbUrl(db);
}

function testConfig(databaseUrl, env = {}) {
  return loadConfig({ NODE_ENV: 'test', DATABASE_URL: databaseUrl, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'silent', RATE_LIMIT_MAX: '100000',
    CORS_ORIGINS: 'http://allowed.test', SHARED_SRC_DIR: SRC, ...env }, { useDotEnv: false });
}

const sharedApp = () => createAppContext({ srcDir: SRC });

/** fresh DB + migrations (+ import unless importData=false) → { url, pool, App, importReport } */
async function setupDatabase(name, { importData = true, backupDir = null } = {}) {
  const url = await freshDatabase(name);
  const pool = createPool(testConfig(url).db);
  await migrator.up(pool);
  const App = sharedApp();
  let importReport = null;
  if (importData) importReport = await importDevelopmentData({ pool, App, file: LOTS_FILE, developmentId: 'viva-juara', dryRun: false, backupDir, assetDir: DATA });
  return { url, pool, App, importReport };
}

async function startTestServer(databaseUrl, env = {}, { pool = null } = {}) {
  const config = testConfig(databaseUrl, env);
  const srv = await startServer({ config, pool, logger: createLogger({ level: 'silent' }), App: sharedApp() });
  return { ...srv, api: srv.url + '/api/v1', config };
}

/** frontend App context (src modules + data/apiSource.js) with a given fetch */
function frontendApp(fetchImpl) { return createAppContext({ srcDir: SRC, files: FRONTEND_ORDER, fetch: fetchImpl }); }
function jsonApp() { return frontendApp(fileFetch(DATA)); }

async function jsonLots() {
  const App = jsonApp();
  const lots = await App.repos.createLotRepository('viva-juara').load();
  return { App, lots, byId: new Map(lots.map(l => [l.identity.id, l])) };
}

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

module.exports = { BACKEND, SRC, DATA, LOTS_FILE, ADMIN_URL, freshDatabase, setupDatabase, startTestServer, testConfig, sharedApp, frontendApp, jsonApp, jsonLots,
  useBackend, fileFetch, comparable, runShadowCompare, stableStringify, importDevelopmentData, migrator, createPool, readJson };
