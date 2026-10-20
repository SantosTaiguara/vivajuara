'use strict';
/* AuthenticationService with two IdentityProviderAdapters (topic 30 §16-22, §152-155):
   - SystemCredentialProvider: ADMIN_API_TOKEN (and the deprecated WRITE_API_KEY) → SYSTEM principal (bootstrap platform
     operator, actor "admin"). Unchanged semantics from API 1.2 (constant-time sha256 comparison).
   - DevTokenProvider (AUTH_DEV_TOKENS=true, never in production): opaque tokens "plat_dev_<43 base64url chars>" issued by
     scripts/iam.js; only sha256(token) is stored (auth_tokens). Expired/revoked tokens and non-ACTIVE users → 401.
   No Authorization header → ANONYMOUS principal (public reads only). When no provider is configured at all, a presented
   header cannot be validated and is ignored (anonymous), exactly like API 1.2 reads.
   - Google OIDC session (W3 login, modules/auth): without an Authorization header, the session cookie is resolved by
     the injected `session` adapter (auth.service.authenticate). A bearer header always wins over the cookie, so the
     existing bearer/dev-token clients and tests behave exactly as before; dev tokens stay refused in production.
   Tokens are never logged, echoed or stored in clear. */
const crypto = require('crypto');
const { E } = require('../../shared/http/errors');
const repo = require('./iam.repository');
const { ANONYMOUS } = require('./authorization');

const BEARER_RE = /^Bearer ([\x21-\x7e]{1,4096})$/;
const DEV_TOKEN_RE = /^plat_dev_[A-Za-z0-9_-]{43}$/;
const sha256 = s => crypto.createHash('sha256').update(String(s), 'utf8');

/** new random dev token (256 bits) + its storage hash */
function newDevToken() {
  const token = 'plat_dev_' + crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token).digest('hex') };
}

function createAuthentication({ pool, config, session = null }) {
  const creds = config.writeAuth.credentials;
  const providersEnabled = creds.length > 0 || config.auth.devTokens;

  function systemPrincipal(presentedDigest) {
    let match = null;
    for (const c of creds) if (crypto.timingSafeEqual(presentedDigest, c.hash) && !match) match = c; // no early exit on the comparison
    if (!match) return null;
    return Object.freeze({ type: 'SYSTEM', id: `system:${match.actorId || match.principal}`, userId: null, displayName: 'Operador da plataforma', status: 'ACTIVE',
      actorId: match.actorId, idempotencyPrincipal: match.principal, authenticationMethod: match.kind, memberships: [], assignments: [] });
  }

  async function userPrincipal(token) {
    const row = await repo.findTokenUser(pool, sha256(token).digest('hex'));
    if (!row) throw E.unauthorized('Token inválido, expirado ou revogado');
    if (row.status !== 'ACTIVE') throw E.unauthorized('Usuário sem acesso ativo');
    const access = await repo.findAccess(pool, row.user_id);
    repo.touchToken(pool, row.token_id).catch(() => {}); // best effort
    return Object.freeze({ type: 'USER', id: row.user_id, userId: row.user_id, displayName: row.display_name, status: row.status, actorId: row.user_id,
      idempotencyPrincipal: `user:${row.user_id}`, authenticationMethod: 'DEV_TOKEN', tokenExpiresAt: row.expires_at.toISOString(), ...access });
  }

  /** authenticate(req) → PrincipalContext (ANONYMOUS when no credential). Throws 401 UNAUTHORIZED for a bad credential. */
  async function authenticate(req) {
    const h = req.headers.authorization;
    if (h == null || h === '') return session && session.enabled ? session.authenticate(req) : ANONYMOUS;
    if (!providersEnabled) return ANONYMOUS;
    const m = typeof h === 'string' ? BEARER_RE.exec(h) : null;
    if (!m) throw E.unauthorized();
    const sys = creds.length ? systemPrincipal(sha256(m[1]).digest()) : null;
    if (sys) return sys;
    if (config.auth.devTokens && DEV_TOKEN_RE.test(m[1])) return userPrincipal(m[1]);
    throw E.unauthorized();
  }

  return { authenticate, providersEnabled: providersEnabled || !!(session && session.enabled), checkCsrf: (req, p) => !!(session && session.checkCsrf(req, p)) };
}

module.exports = { createAuthentication, newDevToken, DEV_TOKEN_RE };
