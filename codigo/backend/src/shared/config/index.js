'use strict';
/* Environment-based configuration. Every setting comes from process.env (optionally
   seeded from a local .env file that is never committed). No secrets have defaults. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..', '..');

/** Minimal .env loader (KEY=VALUE per line, # comments). Real env vars always win. */
function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const bool = (v, d) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
const int = (v, d, name) => {
  if (v == null || v === '') return d;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid integer for ${name}: ${v}`);
  return n;
};
const list = v => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : []);
/** Only the sha256 of a credential is kept in memory: the raw token never lives in the config object (nor in logs). */
const tokenHash = t => crypto.createHash('sha256').update(String(t), 'utf8').digest();
const ADMIN_TOKEN_MIN_LENGTH_PRODUCTION = 32;

/** Write credentials (topic 9 §91/§194, until a user model exists):
    - ADMIN_API_TOKEN (preferred): Bearer token of the operator; actor recorded as "admin".
    - WRITE_API_KEY (legacy, deprecated): honoured only with WRITES_ENABLED=true; actor stays null (no identity).
    No credential configured ⇒ writes are disabled (403 WRITES_DISABLED). WRITES_ENABLED=false is a kill switch. */
function writeAuthOf(env) {
  const credentials = [];
  if (env.ADMIN_API_TOKEN) credentials.push({ hash: tokenHash(env.ADMIN_API_TOKEN), actorId: 'admin', principal: 'admin', kind: 'ADMIN_API_TOKEN' });
  const legacyOn = /^(1|true|yes|on)$/i.test(String(env.WRITES_ENABLED || ''));
  if (legacyOn && env.WRITE_API_KEY) credentials.push({ hash: tokenHash(env.WRITE_API_KEY), actorId: null, principal: 'write-api-key', kind: 'WRITE_API_KEY' });
  const killSwitch = env.WRITES_ENABLED != null && env.WRITES_ENABLED !== '' && !legacyOn;
  return Object.freeze({ credentials: Object.freeze(credentials.map(Object.freeze)), enabled: credentials.length > 0 && !killSwitch, killSwitch, legacyRequested: legacyOn && !env.WRITE_API_KEY && !env.ADMIN_API_TOKEN });
}

/** Placeholder values (copied from .env.example or a guide) count as missing: fail closed instead of running with them. */
const PLACEHOLDER_RE = /^(|<.*>|.*(cole[-_ ]?aqui|placeholder|changeme|change[-_]me|seu[-_]|your[-_]).*)$/i;
const present = v => v != null && !PLACEHOLDER_RE.test(String(v).trim());
const SESSION_SECRET_MIN_LENGTH = 32;

/** Google OIDC login + cookie session (W3 login, decision D-IDP = Google, organization org_house7).
    Enabled when AUTH_GOOGLE_ENABLED=true, or by default as soon as GOOGLE_CLIENT_ID is set. When enabled, every required
    value must be present and valid, otherwise loadConfig throws (fail closed, in every environment). Secrets are kept in
    non-enumerable properties (JSON.stringify / logging the config never prints them); SESSION_SECRET is used only to
    derive keys (HKDF) and never stored raw. */
function oidcOf(env, nodeEnv, corsOrigins) {
  const isProduction = nodeEnv === 'production';
  const enabled = bool(env.AUTH_GOOGLE_ENABLED, present(env.GOOGLE_CLIENT_ID));
  const cookieSecure = bool(env.AUTH_COOKIE_SECURE, true);
  const allowedHd = list(env.ALLOWED_HD).map(s => s.toLowerCase());
  const cookieDomain = present(env.COOKIE_DOMAIN) ? String(env.COOKIE_DOMAIN).trim().toLowerCase() : null;
  const appUrl = present(env.AUTH_APP_URL) ? String(env.AUTH_APP_URL).trim() : null;
  const errors = [];
  if (enabled) {
    if (!present(env.GOOGLE_CLIENT_ID)) errors.push('GOOGLE_CLIENT_ID');
    else if (!/^[A-Za-z0-9._-]{8,200}\.apps\.googleusercontent\.com$/.test(String(env.GOOGLE_CLIENT_ID).trim()) && isProduction) errors.push('GOOGLE_CLIENT_ID (formato *.apps.googleusercontent.com)');
    if (!present(env.GOOGLE_CLIENT_SECRET)) errors.push('GOOGLE_CLIENT_SECRET');
    if (!present(env.AUTH_REDIRECT_URL)) errors.push('AUTH_REDIRECT_URL');
    else {
      let u = null; try { u = new URL(String(env.AUTH_REDIRECT_URL).trim()); } catch (_) { /* invalid */ }
      if (!u || !/^https?:$/.test(u.protocol) || u.hash || u.search) errors.push('AUTH_REDIRECT_URL (URL absoluta, sem query nem fragmento)');
      else if (isProduction && u.protocol !== 'https:') errors.push('AUTH_REDIRECT_URL (https obrigatório em produção)');
    }
    if (!present(env.SESSION_SECRET) || String(env.SESSION_SECRET).length < SESSION_SECRET_MIN_LENGTH) errors.push(`SESSION_SECRET (pelo menos ${SESSION_SECRET_MIN_LENGTH} caracteres aleatórios)`);
    if (appUrl) { try { if (!/^https?:$/.test(new URL(appUrl).protocol)) errors.push('AUTH_APP_URL'); } catch (_) { errors.push('AUTH_APP_URL'); } }
    if (cookieDomain && !/^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(cookieDomain)) errors.push('COOKIE_DOMAIN');
    if (isProduction && !cookieSecure) errors.push('AUTH_COOKIE_SECURE=false não é permitido em produção');
  }
  if (errors.length) throw new Error(`Login Google habilitado, mas a configuração está incompleta ou inválida: ${errors.join(', ')} (ver docs/AUTH_GOOGLE_OIDC.md)`);
  const idle = int(env.AUTH_SESSION_IDLE_SECONDS, 2 * 3600, 'AUTH_SESSION_IDLE_SECONDS');
  const absolute = int(env.AUTH_SESSION_ABSOLUTE_SECONDS, 12 * 3600, 'AUTH_SESSION_ABSOLUTE_SECONDS');
  if (enabled && (idle < 60 || absolute < idle)) throw new Error('AUTH_SESSION_IDLE_SECONDS must be ≥ 60 and ≤ AUTH_SESSION_ABSOLUTE_SECONDS');
  const out = {
    enabled,
    provider: 'google',
    clientId: enabled ? String(env.GOOGLE_CLIENT_ID).trim() : null,
    redirectUrl: enabled ? String(env.AUTH_REDIRECT_URL).trim() : null,
    allowedHd: Object.freeze(allowedHd),
    appUrl,
    // where the callback may send the browser back to: AUTH_APP_URL + CORS_ORIGINS (never "*"); anything else → AUTH_APP_URL
    returnOrigins: Object.freeze([...new Set([...(appUrl ? [new URL(appUrl).origin] : []), ...corsOrigins.filter(o => o !== '*')])]),
    // Google endpoints are fixed in production; the overrides exist only for a local fake IdP (development/test)
    authorizationEndpoint: (!isProduction && env.GOOGLE_AUTHORIZATION_ENDPOINT) || 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: (!isProduction && env.GOOGLE_TOKEN_ENDPOINT) || 'https://oauth2.googleapis.com/token',
    jwksUri: (!isProduction && env.GOOGLE_JWKS_URI) || 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: Object.freeze(['https://accounts.google.com', 'accounts.google.com']),
    session: Object.freeze({
      idleTimeoutSeconds: idle,
      absoluteTimeoutSeconds: absolute,
      cookieSecure,
      cookieDomain,
      // __Host- prefix (Secure, Path=/, no Domain) unless a shared parent domain is configured
      cookieName: cookieSecure && !cookieDomain ? '__Host-plat_session' : 'plat_session',
      loginCookieName: 'plat_oauth',
      loginTtlSeconds: int(env.AUTH_LOGIN_TTL_SECONDS, 600, 'AUTH_LOGIN_TTL_SECONDS')
    })
  };
  // secrets: non-enumerable (never serialized); SESSION_SECRET → derived 32-byte keys only
  const master = enabled ? crypto.createHash('sha256').update(String(env.SESSION_SECRET), 'utf8').digest() : null;
  const derive = info => (master ? Buffer.from(crypto.hkdfSync('sha256', master, Buffer.from('plat-auth-v1'), Buffer.from(info), 32)) : null);
  Object.defineProperty(out, 'clientSecret', { value: enabled ? String(env.GOOGLE_CLIENT_SECRET).trim() : null, enumerable: false });
  Object.defineProperty(out, 'keys', { value: Object.freeze({ loginState: derive('login-state'), csrf: derive('csrf') }), enumerable: false });
  return Object.freeze(out);
}

/** loadConfig(env) → frozen config object. Throws on invalid or unsafe combinations. */
function loadConfig(env = process.env, { useDotEnv = true } = {}) {
  if (useDotEnv && env === process.env) loadDotEnv();
  const nodeEnv = env.NODE_ENV || 'development';
  const cfg = {
    env: nodeEnv,
    isProduction: nodeEnv === 'production',
    host: env.HOST || '127.0.0.1',
    port: int(env.PORT, 8080, 'PORT'),
    serviceVersion: env.SERVICE_VERSION || require(path.join(ROOT, 'package.json')).version,
    db: {
      connectionString: env.DATABASE_URL || null,
      max: int(env.DB_POOL_MAX, 10, 'DB_POOL_MAX'),
      idleTimeoutMillis: int(env.DB_IDLE_TIMEOUT_MS, 30000, 'DB_IDLE_TIMEOUT_MS'),
      connectionTimeoutMillis: int(env.DB_CONNECT_TIMEOUT_MS, 5000, 'DB_CONNECT_TIMEOUT_MS'),
      statementTimeoutMs: int(env.DB_STATEMENT_TIMEOUT_MS, 10000, 'DB_STATEMENT_TIMEOUT_MS'),
      ssl: bool(env.DB_SSL, false)
    },
    corsOrigins: list(env.CORS_ORIGINS),
    rateLimit: { windowMs: int(env.RATE_LIMIT_WINDOW_MS, 60000, 'RATE_LIMIT_WINDOW_MS'), max: int(env.RATE_LIMIT_MAX, 300, 'RATE_LIMIT_MAX'), policies: bool(env.RATE_LIMIT_POLICIES, nodeEnv !== 'test') }, // B2: per-category policies (on by default; off by default only under NODE_ENV=test, where the DB suites run hundreds of writes)
    requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 15000, 'REQUEST_TIMEOUT_MS'),
    bodyLimitBytes: int(env.BODY_LIMIT_BYTES, 16 * 1024, 'BODY_LIMIT_BYTES'),
    writeAuth: writeAuthOf(env),
    // Topic 30: scoped user tokens of the DevTokenProvider (hashed in auth_tokens). Local/test only: refused in production
    // (fail closed). The real identity provider (OIDC) is a pending decision (docs/IAM_ARCHITECTURE.md).
    auth: Object.freeze({
      devTokens: bool(env.AUTH_DEV_TOKENS, false),
      devTokenTtlSeconds: int(env.AUTH_DEV_TOKEN_TTL_SECONDS, 30 * 24 * 3600, 'AUTH_DEV_TOKEN_TTL_SECONDS')
    }),
    // Admin write routes accept larger bodies (per-lot price tables, methodology configs); read/batch routes keep BODY_LIMIT_BYTES.
    adminBodyLimitBytes: int(env.ADMIN_BODY_LIMIT_BYTES, 256 * 1024, 'ADMIN_BODY_LIMIT_BYTES'),
    // Idempotency-Key retention (default 24 h).
    idempotencyTtlSeconds: int(env.IDEMPOTENCY_TTL_SECONDS, 24 * 3600, 'IDEMPOTENCY_TTL_SECONDS'),
    // Availability change stream (Server-Sent Events).
    sse: Object.freeze({
      heartbeatMs: int(env.SSE_HEARTBEAT_MS, 15000, 'SSE_HEARTBEAT_MS'),
      pollIntervalMs: int(env.SSE_POLL_INTERVAL_MS, 5000, 'SSE_POLL_INTERVAL_MS'), // safety net next to LISTEN/NOTIFY; 0 = off
      listen: bool(env.SSE_LISTEN, true),
      maxClients: int(env.SSE_MAX_CLIENTS, 200, 'SSE_MAX_CLIENTS'),
      retryMs: int(env.SSE_RETRY_MS, 3000, 'SSE_RETRY_MS'),
      maxLotsPerEvent: int(env.SSE_MAX_LOTS_PER_EVENT, 500, 'SSE_MAX_LOTS_PER_EVENT')
    }),
    trustProxy: bool(env.TRUST_PROXY, false),
    compression: bool(env.COMPRESSION, true),
    // Output (DTO) validation against the contract schemas: on outside production by default (§62).
    validateResponses: bool(env.VALIDATE_RESPONSES, nodeEnv !== 'production'),
    retryAfterSeconds: int(env.RETRY_AFTER_SECONDS, 5, 'RETRY_AFTER_SECONDS'),
    assetBaseUrl: (env.ASSET_BASE_URL || '').replace(/\/+$/, ''),
    sharedSrcDir: env.SHARED_SRC_DIR ? path.resolve(env.SHARED_SRC_DIR) : path.resolve(ROOT, '..', 'src'),
    // Methodology configs (plat/config: scoring/<development>/<version>.json) loaded next to the shared domain.
    sharedConfigDir: env.SHARED_CONFIG_DIR ? path.resolve(env.SHARED_CONFIG_DIR) : null,
    logLevel: env.LOG_LEVEL || 'info',
    // Round 5 (topics 57-63): one flag per module, all OFF by default. Off = the module's routes, OpenAPI paths, jobs and
    // permission keys do not exist for clients (the API is exactly the pre-round-5 one). On = routes exist behind their
    // permissions (granted to OWNER_ADMIN only, decision 2026-10-18); each module still refuses while its policy is null.
    features: Object.freeze({
      deals: bool(env.FEATURE_DEALS, false),
      onboarding: bool(env.FEATURE_ONBOARDING, false),
      privacy: bool(env.FEATURE_PRIVACY, false),
      backoffice: bool(env.FEATURE_BACKOFFICE, false),
      dataQuality: bool(env.FEATURE_DATA_QUALITY, false),
      surroundings: bool(env.FEATURE_SURROUNDINGS, false)
    }),
    // deals expiry worker (FEATURE_DEALS only): interval of the server-clock sweep; 0 = not scheduled
    dealsExpiryIntervalMs: int(env.DEALS_EXPIRY_INTERVAL_MS, 60000, 'DEALS_EXPIRY_INTERVAL_MS'),
    // explicit role grants of explicit-grant-only (round 5) keys beyond the role templates (npm run iam -- grant … --confirm)
    roleGrantsFile: env.IAM_ROLE_GRANTS_FILE ? path.resolve(env.IAM_ROLE_GRANTS_FILE) : path.join(ROOT, 'config', 'iam', 'role-grants.json')
  };
  cfg.oidc = oidcOf(env, nodeEnv, cfg.corsOrigins);
  // writes need at least one credential source (ADMIN_API_TOKEN / legacy key, dev user tokens or Google sessions) and no kill switch
  cfg.writesEnabled = cfg.writeAuth.enabled || ((cfg.auth.devTokens || cfg.oidc.enabled) && !cfg.writeAuth.killSwitch);
  if (!cfg.db.connectionString) throw new Error('DATABASE_URL is required (see .env.example)');
  if (cfg.idempotencyTtlSeconds < 60) throw new Error('IDEMPOTENCY_TTL_SECONDS must be at least 60');
  if (cfg.isProduction) {
    if (cfg.corsOrigins.includes('*')) throw new Error('CORS_ORIGINS="*" is not allowed in production');
    if (cfg.auth.devTokens) throw new Error('AUTH_DEV_TOKENS=true is not allowed in production (dev/test identity provider only)');
    if (cfg.writeAuth.legacyRequested) throw new Error('WRITES_ENABLED=true requires ADMIN_API_TOKEN in production');
    if (env.ADMIN_API_TOKEN && String(env.ADMIN_API_TOKEN).length < ADMIN_TOKEN_MIN_LENGTH_PRODUCTION) throw new Error(`ADMIN_API_TOKEN must have at least ${ADMIN_TOKEN_MIN_LENGTH_PRODUCTION} characters in production`);
  }
  return Object.freeze(cfg);
}

module.exports = { loadConfig, loadDotEnv, tokenHash, ROOT };
