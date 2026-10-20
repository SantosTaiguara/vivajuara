'use strict';
/* Process entry point: env config → server; graceful shutdown on SIGTERM/SIGINT. */
const { loadConfig } = require('./shared/config');
const { createLogger } = require('./shared/logging/logger');
const { startServer } = require('./app');

async function main() {
  let config;
  try { config = loadConfig(); } catch (e) { process.stderr.write(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', msg: 'invalid configuration', detail: e.message }) + '\n'); process.exit(1); }
  const logger = createLogger({ level: config.logLevel, production: config.isProduction });
  const srv = await startServer({ config, logger });
  let stopping = false;
  const stop = async signal => {
    if (stopping) return; stopping = true;
    logger.info('shutting down', { signal });
    const force = setTimeout(() => process.exit(1), 10000); force.unref();
    await srv.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('unhandledRejection', e => logger.error('unhandled rejection', { detail: e && e.message }));
}

main().catch(e => { process.stderr.write(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', msg: 'startup failed', detail: e.message }) + '\n'); process.exit(1); });
