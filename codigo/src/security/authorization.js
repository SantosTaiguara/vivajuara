/* security/authorization.js — App.authz (topic 30 + 31, frontend side).
   AuthorizationService / PolicyEvaluator / PermissionGuard / ActionGuard / RouteGuard / AccessControlViewModel,
   AuditLogService + SecurityEvent (diagnostic, local), IdentityProviderAdapter contracts.

   THE FRONTEND IS NEVER THE AUTHORITY. Decisions here only decide what the UI shows (UX + early deny).
   Every protected write is re-authorized by the backend (authenticate → resolve tenant → membership →
   authorize → domain rule → execute → audit). Deny by default: no explicit grant in a compatible scope → DENY.

   Where the context comes from:
   - SERVER: GET {apiBaseUrl}/me (HttpOnly cookie / backend session; ETag; short TTL). The only source of
     user identity, memberships and effective permissions.
   - STATIC_PUBLIC: no server context (today's static panel) → anonymous "visitante/apresentação" context:
     PUBLIC_VISITOR grants on PUBLIC developments only (map, lots, preço de tabela, simulação, comparação,
     perfil de cliente local, links sem PII). No write is ever allowed in it.
   - DEV: DevIdentityProvider, only when App.buildEnv is explicitly 'development' or 'test' (never in the
     shipped build, where App.buildEnv is unset → production → disabled).
   localStorage, sessionStorage, URL/hash and DOM are NEVER read for identity or permissions.
   Loads before utils/i18n; App.store / App.api / App.tenancy are resolved lazily at call time. */
App.authz = (() => {
  const EFFECT = Object.freeze({ ALLOW: 'ALLOW', DENY: 'DENY', REQUIRES_STEP_UP: 'REQUIRES_STEP_UP', REQUIRES_APPROVAL: 'REQUIRES_APPROVAL' });
  const PRINCIPAL_TYPE = Object.freeze({ ANONYMOUS: 'ANONYMOUS', USER: 'USER', SERVICE: 'SERVICE', SYSTEM: 'SYSTEM' });
  const USER_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', INVITED: 'INVITED', SUSPENDED: 'SUSPENDED', DISABLED: 'DISABLED', ARCHIVED: 'ARCHIVED' });
  const SESSION_STATUS = Object.freeze({ NONE: 'NONE', ACTIVE: 'ACTIVE', EXPIRED: 'EXPIRED', REVOKED: 'REVOKED', INVALID: 'INVALID' });
  const ASSIGNMENT_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', SCHEDULED: 'SCHEDULED', EXPIRED: 'EXPIRED', REVOKED: 'REVOKED' });
  const AUTH_METHODS = Object.freeze(['PASSWORD', 'MAGIC_LINK', 'GOOGLE', 'MICROSOFT', 'OIDC', 'MFA', 'PASSKEY', 'OTHER_PROVIDER', 'DEV_TOKEN', 'ADMIN_API_TOKEN']);
  const SOURCE = Object.freeze({ STATIC_PUBLIC: 'STATIC_PUBLIC', SERVER: 'SERVER', DEV: 'DEV' });
  const AUDIT_OUTCOME = Object.freeze({ SUCCESS: 'SUCCESS', DENIED: 'DENIED', FAILED: 'FAILED', CANCELLED: 'CANCELLED' });
  const SECURITY_EVENT = Object.freeze(['LOGIN_SUCCESS', 'LOGIN_FAILURE', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'AUTHZ_DENIED', 'MFA_REQUIRED', 'SUSPICIOUS_ACCESS',
    'ROLE_CHANGED', 'USER_SUSPENDED', 'TENANT_SWITCHED', 'TENANT_LEAK_BLOCKED', 'CONTEXT_REJECTED', 'DEV_AUTH_BLOCKED']);
  /** Reason codes → pt-BR message (UI). Messages never reveal whether a hidden resource exists. */
  const REASONS = Object.freeze({
    ALLOWED: 'Permitido.',
    UNKNOWN_PERMISSION: 'Ação não reconhecida.',
    NO_CONTEXT: 'Contexto de acesso indisponível.',
    AUTH_REQUIRED: 'Entre com sua conta para usar esta função.',
    PRINCIPAL_INACTIVE: 'Seu acesso está suspenso ou desativado.',
    SESSION_EXPIRED: 'Sua sessão expirou. Entre novamente para continuar.',
    SESSION_REVOKED: 'Sua sessão foi encerrada. Entre novamente para continuar.',
    PLATFORM_ONLY: 'Função restrita à operação da plataforma.',
    TENANT_UNRESOLVED: 'Não foi possível identificar a organização deste recurso.',
    TENANT_MISMATCH: 'Este recurso não pertence à organização ativa.',
    CROSS_TENANT: 'Este recurso não pertence à organização ativa.',
    NO_MEMBERSHIP: 'Você não faz parte desta organização.',
    NOT_PUBLIC: 'Este conteúdo não é público.',
    ORG_DISABLED: 'Organização desativada.',
    ORG_SUSPENDED: 'Organização suspensa: somente leitura.',
    NO_GRANT: 'Você não possui permissão para esta ação.',
    OUT_OF_SCOPE: 'Você não possui permissão neste empreendimento.',
    DOMAIN_CAPABILITY_FALSE: 'Ação indisponível no estado atual do lote.',
    OFFLINE: 'Esta ação exige conexão com o servidor.',
    CONTEXT_STALE: 'Permissões desatualizadas. Reconecte para revalidar.',
    STEP_UP_REQUIRED: 'Confirme sua identidade para continuar.',
    UNMAPPED_ACTION: 'Ação sem contrato de permissão.',
    UNKNOWN_FEATURE: 'Função não reconhecida.'
  });
  const LIMITATION = 'Permissões na interface reduzem erro operacional, mas não constituem barreira de segurança autoritativa para dados/writes críticos. O servidor revalida toda ação protegida.';
  const DEFAULT_TTL_MS = 5 * 60 * 1000;
  const PII_KEYS = /^(name|nome|displayname|fullname|customername|customer|email|e-mail|phone|telefone|whatsapp|cpf|cnpj|rg|document|address|endereco|token|accesstoken|refreshtoken|password|senha|authorization|cookie|secret)$/i;

  const T = () => App.tenancy, P = () => App.permissions;
  const nowMs = n => n == null ? Date.now() : (typeof n === 'number' ? n : new Date(n).getTime());
  const iso = n => new Date(nowMs(n)).toISOString();
  const env = () => (App.buildEnv === 'development' || App.buildEnv === 'test') ? App.buildEnv : 'production';

  // ------------------------------------------------------------------ PrincipalContext builders
  function publicDevelopments() { const d = (App.configs && App.configs.security && App.configs.security.organizations || {}).developments || {}; return Object.keys(d).filter(k => d[k].visibility === 'PUBLIC'); }
  /** publicContext({ developmentId, now, allowedKeys? }) — anonymous visitor. allowedKeys narrows it (server said so). */
  function publicContext({ developmentId = null, now, allowedKeys = null, source = SOURCE.STATIC_PUBLIC } = {}) {
    const keys = P().grantsOf('PUBLIC_VISITOR').filter(k => P().isAnonymousAllowed(k) && (!allowedKeys || allowedKeys.includes(k)));
    const grants = [];
    for (const dev of publicDevelopments()) { const org = T().organizationOfDevelopment(dev); if (org) for (const k of keys) grants.push(Object.freeze({ key: k, organizationId: org, developmentId: dev })); }
    const r = developmentId ? T().resolveTenant({ principalType: 'ANONYMOUS', activeDevelopmentId: developmentId, now }) : { ok: false };
    return Object.freeze({ source, principal: Object.freeze({ type: PRINCIPAL_TYPE.ANONYMOUS, id: null, displayName: null, status: USER_STATUS.ACTIVE, authenticationMethod: null, sessionId: null, assuranceLevel: 0 }),
      session: Object.freeze({ status: SESSION_STATUS.NONE, expiresAt: null }), tenant: r.ok ? r.tenantContext : null, memberships: Object.freeze([]), roles: Object.freeze(['PUBLIC_VISITOR']),
      roleAssignments: Object.freeze([]), grants: Object.freeze(grants), policyVersion: P().policyVersion(), etag: null, loadedAt: iso(now), expiresAt: null, warnings: Object.freeze([]) });
  }

  /** fromMe(body, { now, etag, ttlMs, developmentId }) → { ok, context, errors, warnings } — validates GET /api/v1/me strictly. */
  function fromMe(body, { now, etag = null, ttlMs = DEFAULT_TTL_MS, developmentId = null, source = SOURCE.SERVER } = {}) {
    const errors = [], warnings = [], fail = () => ({ ok: false, context: null, errors, warnings });
    if (!body || typeof body !== 'object') { errors.push('BODY_INVALID'); return fail(); }
    const pr = body.principal;
    if (typeof body.authenticated !== 'boolean') errors.push('AUTHENTICATED_MISSING');
    if (!pr || typeof pr !== 'object' || !PRINCIPAL_TYPE[pr.type]) errors.push('PRINCIPAL_INVALID');
    if (!Array.isArray(body.permissions)) errors.push('PERMISSIONS_MISSING');
    if (errors.length) return fail();
    const known = body.permissions.filter(k => { const ok = P().has(k); if (!ok) warnings.push('UNKNOWN_PERMISSION_DROPPED:' + k); return ok; });
    if (!body.authenticated || pr.type === PRINCIPAL_TYPE.ANONYMOUS) {
      const ctx = publicContext({ developmentId, now, allowedKeys: known, source });
      return { ok: true, context: Object.freeze({ ...ctx, etag, expiresAt: iso(nowMs(now) + ttlMs), warnings: Object.freeze(warnings) }), errors, warnings };
    }
    if (!pr.id || typeof pr.id !== 'string') { errors.push('PRINCIPAL_ID_MISSING'); return fail(); }
    const memberships = (Array.isArray(body.memberships) ? body.memberships : []).filter(m => m && T().validId(m.organizationId))
      .map(m => Object.freeze({ id: m.id || null, organizationId: m.organizationId, slug: m.slug || null, displayName: m.displayName || null, status: m.status || 'ACTIVE' }));
    const orgId = body.organizationId;
    // Teach tenancy which orgs exist and which developments they own (server is the source; bundle is the static fallback).
    const orgs = memberships.map(m => ({ id: m.organizationId, slug: m.slug, displayName: m.displayName, status: 'ACTIVE' }));
    if (body.organization && T().validId(body.organization.id)) orgs.push({ ...body.organization });
    const owners = {}, vis = {};
    for (const a of body.roleAssignments || []) if (a && a.developmentId && T().validId(a.organizationId)) owners[a.developmentId] = a.organizationId;
    if (T().validId(orgId)) {
      for (const d of Object.keys(body.developmentPermissions || {})) owners[d] = owners[d] || orgId;
      for (const d of (body.organization && body.organization.developments) || []) { const id = d && typeof d === 'object' ? d.id : d; if (T().validId(id)) { owners[id] = orgId; if (d && d.visibility) vis[id] = d.visibility; } }
      // UX-only alias: a bundled organization with the same slug maps its bundled developments to the server id
      // when the server did not list them. Slug is never a security boundary; the backend revalidates every call.
      const slug = body.organization && body.organization.slug;
      const bundled = slug ? T().listOrganizations().find(o => o.slug === slug && o.id !== orgId) : null;
      if (bundled) for (const d of T().developmentsOf(bundled.id)) owners[d] = owners[d] || orgId;
    }
    T().learnFromServer({ organizations: orgs, developmentOwners: owners, developmentVisibility: vis });
    const grants = [], sysOk = pr.type === PRINCIPAL_TYPE.SYSTEM;
    const add = (k, dev) => { const p = P().get(k); if (!p) return; if (p.systemOnly && !sysOk) { warnings.push('SYSTEM_PERMISSION_DROPPED:' + k); return; } grants.push(Object.freeze({ key: k, organizationId: p.systemOnly ? null : orgId, developmentId: dev || null })); };
    let tenant = null;
    if (T().validId(orgId)) {
      const r = T().resolveTenant({ candidate: orgId, memberships, principalId: pr.id, principalType: pr.type, activeDevelopmentId: developmentId && T().organizationOfDevelopment(developmentId) === orgId ? developmentId : null,
        resolvedBy: T().RESOLVED_BY.SERVER_SESSION, accessPolicyRevision: body.policyVersion || null, now });
      if (r.ok) { tenant = r.tenantContext; for (const k of known) add(k, null); for (const [d, ks] of Object.entries(body.developmentPermissions || {})) for (const k of ks || []) if (P().has(k)) add(k, d); }
      else warnings.push('TENANT_REJECTED:' + r.reason);
    } else if (sysOk) for (const k of known) add(k, null);
    const sess = body.session || {};
    return { ok: true, errors, warnings, context: Object.freeze({ source,
      principal: Object.freeze({ type: pr.type, id: pr.id, displayName: pr.displayName || null, status: pr.status || USER_STATUS.ACTIVE, authenticationMethod: pr.authenticationMethod || null,
        sessionId: sess.id || null, assuranceLevel: typeof pr.assuranceLevel === 'number' ? pr.assuranceLevel : 1 }),
      session: Object.freeze({ status: sess.status || SESSION_STATUS.ACTIVE, expiresAt: sess.expiresAt || null }),
      tenant, memberships: Object.freeze(memberships), roles: Object.freeze([...(body.roles || [])]), roleAssignments: Object.freeze([...(body.roleAssignments || [])].map(a => Object.freeze({ ...a }))),
      grants: Object.freeze(grants), policyVersion: body.policyVersion || P().policyVersion(), etag, loadedAt: iso(now), expiresAt: iso(nowMs(now) + ttlMs), warnings: Object.freeze(warnings) }) };
  }

  // ------------------------------------------------------------------ PolicyEvaluator (pure)
  function decision(effect, permissionKey, reasons, extra = {}) {
    return Object.freeze({ effect, allowed: effect === EFFECT.ALLOW, permissionKey, reason: reasons[0], reasons: Object.freeze(reasons), message: REASONS[reasons[0]] || REASONS.NO_GRANT,
      matchedGrants: Object.freeze(extra.matchedGrants || []), obligations: Object.freeze(extra.obligations || []), policyVersion: extra.policyVersion || P().policyVersion(),
      organizationId: extra.organizationId || null, developmentId: extra.developmentId || null, evaluatedAt: extra.evaluatedAt || iso(), authoritative: false });
  }
  /** evaluate(ctx, { permission, resource, context: { domainCapability, connectivity, reasonProvided, now, stepUpForCritical } }) → AuthorizationDecision */
  function evaluate(ctx, req = {}) {
    const key = req.permission, c = req.context || {}, now = nowMs(c.now), at = iso(now), perm = P().get(key);
    const D = (r, x = {}) => decision(EFFECT.DENY, key, [r], { evaluatedAt: at, policyVersion: ctx && ctx.policyVersion, ...x });
    if (!perm) return D('UNKNOWN_PERMISSION');
    if (!ctx || !ctx.principal) return D('NO_CONTEXT');
    const pr = ctx.principal, anon = pr.type === PRINCIPAL_TYPE.ANONYMOUS;
    if (!anon && pr.status !== USER_STATUS.ACTIVE) return D('PRINCIPAL_INACTIVE');
    if (!anon && ctx.session && (ctx.session.status === SESSION_STATUS.REVOKED || ctx.session.status === SESSION_STATUS.INVALID)) return D('SESSION_REVOKED');
    if (!anon && ctx.session && (ctx.session.status === SESSION_STATUS.EXPIRED || (ctx.session.expiresAt && nowMs(ctx.session.expiresAt) <= now))) {
      // expired session: only what an anonymous visitor could do on this resource remains
      const pub = evaluate(publicContext({ now }), { ...req, context: { ...c, now } });
      return pub.allowed ? pub : D('SESSION_EXPIRED');
    }
    if (!anon && pr.type !== PRINCIPAL_TYPE.SYSTEM && !ctx.tenant && !perm.systemOnly) {
      // W3 login: signed in (e.g. Google) but with no active organization (account not invited yet, or selection
      // pending) → only what an anonymous visitor could do on this resource; never an organization permission
      const pub = evaluate(publicContext({ developmentId: activeDevelopmentId(), now }), { ...req, context: { ...c, now } });
      return pub.allowed ? pub : D('NO_MEMBERSHIP');
    }
    if (perm.systemOnly) {
      if (pr.type !== PRINCIPAL_TYPE.SYSTEM) return D('PLATFORM_ONLY');
      const g = ctx.grants.find(x => x.key === key && x.organizationId == null);
      return g ? decision(EFFECT.ALLOW, key, ['ALLOWED'], { evaluatedAt: at, matchedGrants: [g], obligations: ['writeAuditEvent'], policyVersion: ctx.policyVersion }) : D('NO_GRANT');
    }
    const target = req.resource || (ctx.tenant && ctx.tenant.activeDevelopmentId ? { developmentId: ctx.tenant.activeDevelopmentId } : null);
    const res = T().resolveOrganizationId(target);
    if (res.conflict) return D('TENANT_MISMATCH', { developmentId: res.developmentId });
    if (!res.organizationId) return D('TENANT_UNRESOLVED', { developmentId: res.developmentId });
    const org = res.organizationId, dev = res.developmentId, X = { organizationId: org, developmentId: dev };
    if (anon) {
      if (!perm.anonymousAllowed) return D('AUTH_REQUIRED', X);
      if (!dev || T().developmentVisibility(dev) !== 'PUBLIC') return D('NOT_PUBLIC', X);
    } else {
      if (!ctx.tenant || ctx.tenant.organizationId !== org) return D('CROSS_TENANT', X);
      const m = (ctx.memberships || []).find(x => x.organizationId === org);
      if (!m || m.status !== T().MEMBERSHIP_STATUS.ACTIVE) return D('NO_MEMBERSHIP', X);
    }
    const o = T().getOrganization(org), write = perm.onlineRequired || P().RISK_ORDER[perm.riskLevel] >= P().RISK_ORDER.HIGH;
    if (!o || o.status === 'DISABLED' || o.status === 'ARCHIVED') return D('ORG_DISABLED', X);
    if (o.status === 'SUSPENDED' && write) return D('ORG_SUSPENDED', X);
    const sameKey = ctx.grants.filter(g => g.key === key);
    const matched = sameKey.filter(g => g.organizationId === org && (g.developmentId == null || g.developmentId === dev));
    if (!matched.length) return D(sameKey.length ? 'OUT_OF_SCOPE' : 'NO_GRANT', X);
    if (c.domainCapability === false) return D('DOMAIN_CAPABILITY_FALSE', X);
    const connectivity = c.connectivity != null ? c.connectivity : currentConnectivity();
    if (perm.onlineRequired && connectivity !== 'ONLINE') return D('OFFLINE', X);
    if (write && !anon && ctx.expiresAt && nowMs(ctx.expiresAt) <= now) return D('CONTEXT_STALE', X);
    const obligations = [];
    if (P().auditRequired(key)) obligations.push('writeAuditEvent');
    if (perm.reasonRequired && !c.reasonProvided) obligations.push('requireReason');
    if (perm.onlineRequired) obligations.push('revalidateResourceState');
    if (perm.key === 'customer_profile.manage' || perm.resource.startsWith('customer')) obligations.push('maskSensitiveFields');
    if (perm.riskLevel === 'CRITICAL' && c.stepUpForCritical && !(pr.assuranceLevel >= 2))
      return decision(EFFECT.REQUIRES_STEP_UP, key, ['STEP_UP_REQUIRED'], { evaluatedAt: at, matchedGrants: matched, obligations, policyVersion: ctx.policyVersion, ...X });
    return decision(EFFECT.ALLOW, key, ['ALLOWED'], { evaluatedAt: at, matchedGrants: matched, obligations, policyVersion: ctx.policyVersion, ...X });
  }
  /** Two-layer final decision (§127): DomainValidity AND UserAuthorization. */
  const finalAction = (domainCapability, dec) => !!(dec && dec.allowed && domainCapability === true);

  // ------------------------------------------------------------------ service state (session-scoped, in memory only)
  let current = null, subs = [];
  function currentConnectivity() { try { return (App.store && App.store.get().connectivity) || 'UNKNOWN'; } catch (_) { return 'UNKNOWN'; } }
  function activeDevelopmentId() {
    try { const d = App.store && App.store.get().developmentId; if (d) return d; } catch (_) { /* store not loaded yet */ }
    const pub = publicDevelopments(); return pub.length === 1 ? pub[0] : null; // never "first of many"
  }
  function context() { if (!current) current = publicContext({ developmentId: activeDevelopmentId() }); return current; }
  function setContext(ctx, why = 'set') {
    const prevOrg = current && current.tenant ? current.tenant.organizationId : null;
    current = ctx;
    const org = ctx && ctx.tenant ? ctx.tenant.organizationId : null;
    if (prevOrg && org && prevOrg !== org) securityEvent('TENANT_SWITCHED', { from: prevOrg, to: org });
    for (const f of subs.slice()) { try { f(ctx, { why, tenantChanged: prevOrg !== org }); } catch (_) { /* a subscriber never breaks authz */ } }
    return ctx;
  }
  function subscribe(f) { subs.push(f); return () => { subs = subs.filter(x => x !== f); }; }
  /** logout / session loss: back to the anonymous public context; caller clears tenant-sensitive state. */
  function reset(why = 'logout') { T().forgetServer(); return setContext(publicContext({ developmentId: activeDevelopmentId() }), why); }

  /** refresh({ fetch, baseUrl, organizationId, now }) → { ok, status, context, reason } — GET {baseUrl}/me. No baseUrl → STATIC_PUBLIC. */
  async function refresh(opts = {}) {
    const dev = (() => { try { return App.config.DEVELOPMENTS.find(d => d.id === activeDevelopmentId()); } catch (_) { return null; } })();
    const baseUrl = opts.baseUrl !== undefined ? opts.baseUrl : (dev && dev.dataSource && dev.dataSource.useBackendData ? dev.dataSource.apiBaseUrl : null);
    if (!baseUrl) { if (!current || current.source !== SOURCE.STATIC_PUBLIC) reset('static'); return { ok: true, status: null, context: context(), reason: 'STATIC_PUBLIC' }; }
    const f = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    const headers = { Accept: 'application/json' };
    if (current && current.etag && !opts.organizationId) headers['If-None-Match'] = current.etag;
    if (opts.organizationId) { if (!T().validId(opts.organizationId)) return { ok: false, status: null, context: context(), reason: 'TENANT_INVALID' }; headers['X-Organization-Id'] = opts.organizationId; }
    else if (current && current.tenant) headers['X-Organization-Id'] = current.tenant.organizationId;
    let res;
    try { res = await f(baseUrl.replace(/\/$/, '') + '/me', { method: 'GET', credentials: 'include', headers }); }
    catch (_) { return { ok: false, status: null, context: context(), reason: 'NETWORK_ERROR' }; } // keep context; it goes stale (no new grants)
    if (res.status === 304 && current) { setContext(Object.freeze({ ...current, loadedAt: iso(opts.now), expiresAt: iso(nowMs(opts.now) + DEFAULT_TTL_MS) }), 'revalidated'); return { ok: true, status: 304, context: current }; }
    if (res.status === 401) { securityEvent('SESSION_EXPIRED', {}); reset('unauthenticated'); return { ok: false, status: 401, context: current, reason: 'SESSION_EXPIRED' }; }
    if (res.status === 404 && opts.organizationId) return { ok: false, status: 404, context: context(), reason: 'NO_MEMBERSHIP' };
    if (!res.ok) return { ok: false, status: res.status, context: context(), reason: 'SERVER_ERROR' };
    let body; try { body = await res.json(); } catch (_) { body = null; }
    const etag = res.headers && typeof res.headers.get === 'function' ? res.headers.get('ETag') : null;
    // the API answers in its { data, meta } envelope; tolerate a bare body too (dev tokens, older fixtures)
    const payload = body && body.data && typeof body.data === 'object' && 'principal' in body.data ? body.data : body;
    const r = fromMe(payload, { now: opts.now, etag, developmentId: activeDevelopmentId() });
    if (!r.ok) { securityEvent('CONTEXT_REJECTED', { errors: r.errors }); reset('rejected'); return { ok: false, status: res.status, context: current, reason: 'CONTEXT_REJECTED', errors: r.errors }; }
    setContext(r.context, 'server');
    return { ok: true, status: res.status, context: current, warnings: r.warnings };
  }
  /** switchOrganization(orgId, { fetch, baseUrl, initialState }) → { ok, reason, statePatch } — server validates membership; the
      caller applies statePatch (tenant data reset, UI prefs kept) BEFORE rendering anything of the new tenant. */
  async function switchOrganization(orgId, opts = {}) {
    const ctx = context();
    if (!ctx.memberships.some(m => m.organizationId === orgId && m.status === 'ACTIVE')) return { ok: false, reason: 'NO_MEMBERSHIP', statePatch: null };
    const r = await refresh({ ...opts, organizationId: orgId });
    if (!r.ok || !current.tenant || current.tenant.organizationId !== orgId) return { ok: false, reason: r.reason || 'TENANT_UNRESOLVED', statePatch: null };
    let initial = opts.initialState; try { if (!initial && App.store && App.store.INITIAL) initial = App.store.INITIAL; } catch (_) { /* none */ }
    return { ok: true, reason: null, statePatch: T().switchPatch(initial || {}) };
  }

  // ------------------------------------------------------------------ guards (PermissionGuard / ActionGuard / RouteGuard)
  const ctxOpts = o => ({ connectivity: o.connectivity, domainCapability: o.domainCapability, reasonProvided: o.reasonProvided, now: o.now, stepUpForCritical: o.stepUpForCritical });
  /** can(permission, resource?, opts?) → boolean (ALLOW only) */
  const can = (permission, resource, opts = {}) => evaluate(opts.context || context(), { permission, resource, context: ctxOpts(opts) }).allowed;
  /** guard(permission, resource?, opts?) → { allowed, effect, reason, message, obligations, decision } */
  function guard(permission, resource, opts = {}) {
    const d = evaluate(opts.context || context(), { permission, resource, context: ctxOpts(opts) });
    if (!d.allowed && P().has(permission) && P().RISK_ORDER[P().riskOf(permission)] >= P().RISK_ORDER.HIGH && !opts.silent) securityEvent('AUTHZ_DENIED', { permissionKey: permission, reasonCode: d.reason, organizationId: d.organizationId, developmentId: d.developmentId });
    return { allowed: d.allowed, effect: d.effect, reason: d.reason, message: d.message, obligations: d.obligations, decision: d };
  }
  /** feature(id, resource?, opts?) → { id, allowed, visible, enabled, deny, reason, message, ariaLabel, permissions } */
  function feature(id, resource, opts = {}) {
    const f = P().feature(id);
    if (!f) return Object.freeze({ id, allowed: false, visible: false, enabled: false, deny: 'hide', reason: 'UNKNOWN_FEATURE', message: REASONS.UNKNOWN_FEATURE, ariaLabel: null, permissions: [] });
    let deny = null;
    for (const k of f.permissions) { const g = guard(k, resource, opts); if (!g.allowed) { deny = g; break; } }
    const allowed = !deny, visible = allowed || f.deny === 'disable';
    const message = allowed ? null : (deny.reason === 'NO_GRANT' || deny.reason === 'OUT_OF_SCOPE' || deny.reason === 'AUTH_REQUIRED' ? f.message : deny.message);
    return Object.freeze({ id, allowed, visible, enabled: allowed, deny: f.deny, reason: allowed ? 'ALLOWED' : deny.reason, message, ariaLabel: allowed ? null : message, permissions: f.permissions.slice() });
  }
  /** action(act, dataset?, resource?, opts?) — ActionGuard for data-act controls. Unknown action → DENY (no contract). */
  function action(act, dataset = {}, resource, opts = {}) {
    const fid = P().featureOfAction(act, dataset);
    if (fid === '') return Object.freeze({ id: null, action: act, allowed: true, visible: true, enabled: true, deny: null, reason: 'UI_ONLY', message: null, ariaLabel: null, permissions: [] });
    if (fid == null) return Object.freeze({ id: null, action: act, allowed: false, visible: false, enabled: false, deny: 'hide', reason: 'UNMAPPED_ACTION', message: REASONS.UNMAPPED_ACTION, ariaLabel: null, permissions: [] });
    return Object.freeze({ ...feature(fid, resource, opts), action: act });
  }
  /** route(name, resource?) — RouteGuard ('map' | 'compare' | 'development' | 'admin/…'). */
  function route(name, resource, opts = {}) { const fid = P().routes()[name]; return fid ? feature(fid, resource, opts) : Object.freeze({ id: null, allowed: false, visible: false, enabled: false, deny: 'hide', reason: 'UNKNOWN_FEATURE', message: REASONS.UNKNOWN_FEATURE }); }
  const section = (sectionId, resource, opts = {}) => { const fid = P().sectionFeature(sectionId); return fid ? feature(fid, resource, opts) : feature('__none__'); };
  /** uiMode(mode) — UI modes (broker/client/technical/presentation) are NOT roles; they are allowed only if the feature behind them is. */
  const uiMode = (mode, resource, opts = {}) => feature('mode.' + mode, resource, opts);

  /** AccessControlViewModel (no PII beyond the principal's own display name). */
  function viewModel(opts = {}) {
    const ctx = opts.context || context(), dev = opts.developmentId || (ctx.tenant && ctx.tenant.activeDevelopmentId) || activeDevelopmentId();
    const res = dev ? { developmentId: dev } : null, orgId = res ? T().resolveOrganizationId(res).organizationId : (ctx.tenant && ctx.tenant.organizationId);
    const featureAccess = {}; for (const id of Object.keys(P().features())) { const f = feature(id, res, { ...opts, context: ctx, silent: true }); featureAccess[id] = { visible: f.visible, enabled: f.enabled, reason: f.reason, message: f.message }; }
    const permissions = P().list().map(p => p.key).filter(k => evaluate(ctx, { permission: k, resource: res, context: ctxOpts({ ...opts, connectivity: 'ONLINE' }) }).allowed);
    const anon = ctx.principal.type === PRINCIPAL_TYPE.ANONYMOUS, warnings = [];
    if (ctx.source === SOURCE.STATIC_PUBLIC) warnings.push('Acesso público de visitante: somente leitura.');
    if (ctx.source === SOURCE.DEV) warnings.push('Identidade de desenvolvimento (não é login real).');
    if (ctx.expiresAt && nowMs(ctx.expiresAt) <= nowMs(opts.now)) warnings.push(REASONS.CONTEXT_STALE);
    const roleLabels = ctx.roles.map(r => (P().role(r) || { label: r }).label);
    const sessionState = anon ? 'ANONYMOUS' : (ctx.session.expiresAt && nowMs(ctx.session.expiresAt) <= nowMs(opts.now) ? SESSION_STATUS.EXPIRED : ctx.session.status);
    return Object.freeze({ source: ctx.source, authenticated: !anon,
      principalSummary: { type: ctx.principal.type, displayName: anon ? 'Visitante' : (ctx.principal.displayName || 'Usuário'), roleSummary: roleLabels.join(', ') },
      activeScope: { organization: orgId ? T().summary(orgId) : null, developmentId: dev || null, memberships: ctx.memberships.map(m => ({ organizationId: m.organizationId, displayName: m.displayName, status: m.status })) },
      permissions, featureAccess, warnings, sessionState, policyVersion: ctx.policyVersion, limitation: LIMITATION });
  }

  // ------------------------------------------------------------------ minimal data projections
  /** maskCustomer(c) → projection without PII (for audit, analytics, share links). Keeps id, lot ids, preferences. */
  function maskCustomer(c) {
    if (!c || typeof c !== 'object') return null;
    return { id: c.id || null, lots: Array.isArray(c.lots) ? c.lots.slice() : [], hasProfile: !!c.profile, masked: true };
  }
  /** redact(obj) → { value, redacted[] } removes PII/secret keys recursively. */
  function redact(obj, path = '', out = []) {
    if (Array.isArray(obj)) return { value: obj.map((v, i) => redact(v, `${path}[${i}]`, out).value), redacted: out };
    if (!obj || typeof obj !== 'object') return { value: obj, redacted: out };
    const v = {};
    for (const [k, x] of Object.entries(obj)) { if (PII_KEYS.test(k)) { out.push(path ? `${path}.${k}` : k); continue; } v[k] = redact(x, path ? `${path}.${k}` : k, out).value; }
    return { value: v, redacted: out };
  }

  // ------------------------------------------------------------------ AuditLogService (diagnostic only, not security-grade) + SecurityEvent
  const auditLog = [], secLog = [], MAX = 200; let seq = 0;
  /** AuditEvent { id, actorUserId, actorPrincipalType, action, permissionKey, resourceType, resourceId, organizationId, developmentId,
      timestamp, outcome, reasonCode, requestId, correlationId, beforeRef, afterRef, versionRefs, metadata } — references, never PII. */
  function auditEvent(e = {}, opts = {}) {
    const ctx = opts.context || context();
    if (!AUDIT_OUTCOME[e.outcome]) throw Object.assign(new Error('AuditEvent.outcome inválido'), { code: 'AUDIT_INVALID' });
    if (!e.action || !e.resourceType) throw Object.assign(new Error('AuditEvent exige action e resourceType'), { code: 'AUDIT_INVALID' });
    const r = T().resolveOrganizationId({ organizationId: e.organizationId || undefined, developmentId: e.developmentId || undefined });
    const orgId = r.organizationId || (ctx.tenant && ctx.tenant.organizationId) || null;
    if (!orgId && e.permissionKey !== 'platform.cross_tenant') throw Object.assign(new Error('AuditEvent de recurso tenant-owned exige organizationId'), { code: 'TENANT_UNRESOLVED' });
    const meta = redact(e.metadata || {}), refs = redact({ beforeRef: e.beforeRef || null, afterRef: e.afterRef || null, versionRefs: e.versionRefs || null });
    return Object.freeze({ id: `aud-${nowMs(opts.now).toString(36)}-${(++seq).toString(36)}`, actorUserId: ctx.principal.id, actorPrincipalType: ctx.principal.type,
      action: e.action, permissionKey: e.permissionKey || null, resourceType: e.resourceType, resourceId: e.resourceId || null, organizationId: orgId,
      developmentId: e.developmentId || r.developmentId || null, timestamp: iso(opts.now), outcome: e.outcome, reasonCode: e.reasonCode || null,
      requestId: e.requestId || null, correlationId: e.correlationId || null, ...refs.value, policyVersion: ctx.policyVersion, metadata: meta.value,
      redactedFields: [...meta.redacted, ...refs.redacted], authoritative: false });
  }
  const audit = Object.freeze({
    record(e, opts) { const ev = auditEvent(e, opts); auditLog.push(ev); if (auditLog.length > MAX) auditLog.shift(); return ev; },
    /** events visible to the active org only (tenant admins never see other tenants' events) */
    events(opts = {}) { const ctx = opts.context || context(), org = ctx.tenant && ctx.tenant.organizationId; return auditLog.filter(e => e.organizationId === org); },
    clear() { auditLog.length = 0; }
  });
  function securityEvent(type, data = {}, opts = {}) {
    if (!SECURITY_EVENT.includes(type)) return null;
    let ctx = null; try { ctx = opts.context || current; } catch (_) { ctx = null; }
    const ev = Object.freeze({ type, at: iso(opts.now), principalType: ctx ? ctx.principal.type : null, actorUserId: ctx ? ctx.principal.id : null,
      organizationId: data.organizationId || (ctx && ctx.tenant ? ctx.tenant.organizationId : null), data: redact(data).value });
    secLog.push(ev); if (secLog.length > MAX) secLog.shift();
    return ev;
  }

  // ------------------------------------------------------------------ RoleAssignmentPolicy (no escalation; the backend is the authority)
  /** canAssign({ targetUserId, roleCode, organizationId, developmentId }, opts) → AuthorizationDecision-like */
  function canAssign(req = {}, opts = {}) {
    const ctx = opts.context || context(), D = r => decision(EFFECT.DENY, 'role.assign', [r]);
    const role = P().role(req.roleCode);
    if (!role || (role.principalTypes || []).includes('ANONYMOUS')) return D('NO_GRANT');
    if (ctx.principal.type === PRINCIPAL_TYPE.ANONYMOUS) return D('AUTH_REQUIRED');
    if (req.targetUserId && req.targetUserId === ctx.principal.id) return D('SELF_ESCALATION');
    const res = { organizationId: req.organizationId, developmentId: req.developmentId };
    const missing = role.grants.filter(k => !evaluate(ctx, { permission: k, resource: res, context: { connectivity: 'ONLINE', now: opts.now } }).allowed);
    if (missing.length) return decision(EFFECT.DENY, 'role.assign', ['PRIVILEGE_ESCALATION'], { obligations: missing.map(k => 'missing:' + k) });
    // Registry has no assignment-management permission yet (backend decision) → fail closed.
    const managePerm = opts.managePermission || 'assignment.manage';
    if (!P().has(managePerm)) return D('ASSIGNMENT_MANAGE_NOT_REGISTERED');
    return evaluate(ctx, { permission: managePerm, resource: res, context: { connectivity: 'ONLINE', now: opts.now } });
  }

  // ------------------------------------------------------------------ IdentityProviderAdapter
  /** backendBaseUrl() → apiBaseUrl of the active development when backend mode is configured (useBackendData + apiBaseUrl), else null.
      null = the static public visitor panel (the published artifact): no login control, no request, nothing changes. */
  function backendBaseUrl() {
    try {
      const dev = App.config.DEVELOPMENTS.find(d => d.id === activeDevelopmentId());
      const ds = dev && dev.dataSource;
      return ds && ds.useBackendData && typeof ds.apiBaseUrl === 'string' && /^https?:\/\//.test(ds.apiBaseUrl) ? ds.apiBaseUrl.replace(/\/+$/, '') : null;
    } catch (_) { return null; }
  }
  /** ServerSessionProvider (W3 login, decision D-IDP = Google OIDC). The session lives in the backend (HttpOnly cookie set by
      GET {base}/auth/google/callback); the SPA never sees or stores a token. The CSRF token is fetched right before a
      write and kept only in this call (never in storage, URL, state or the context). */
  function ServerSessionProvider({ baseUrl, fetch: f } = {}) {
    const http = () => f || (typeof fetch === 'function' ? fetch : null);
    return Object.freeze({ kind: 'SERVER_SESSION', provider: 'google', getSession: o => refresh({ ...(o || {}), baseUrl, fetch: f }),
      /** loginUrl(returnTo) → full-page navigation target (the caller assigns location; the API answers 302 to Google) */
      loginUrl(returnTo) { const r = typeof returnTo === 'string' && returnTo.length <= 2048 && /^https?:\/\//.test(returnTo) ? returnTo : ''; return `${baseUrl}/auth/google/start${r ? '?returnTo=' + encodeURIComponent(r) : ''}`; },
      login(returnTo) { return { ok: true, url: this.loginUrl(returnTo) }; },
      /** logout() → POST {base}/auth/logout with X-CSRF-Token; the local context goes back to the public visitor even if the call fails */
      async logout() {
        const h = http(); let ok = false;
        try {
          if (h) {
            const s = await h(`${baseUrl}/auth/session`, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } });
            const tok = s && s.ok ? ((await s.json()) || {}).data : null;
            const r = await h(`${baseUrl}/auth/logout`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json', ...(tok && tok.csrfToken ? { 'X-CSRF-Token': tok.csrfToken } : {}) } });
            ok = !!(r && r.ok);
          }
        } catch (_) { ok = false; }
        securityEvent('SESSION_REVOKED', { reasonCode: ok ? 'LOGOUT' : 'LOGOUT_LOCAL_ONLY' });
        reset('logout');
        return { ok };
      } });
  }
  /** AccountService (header "Entrar com Google" / "<primeiro nome> · Sair"). Visible only in backend mode. */
  const account = (() => {
    let started = false, resolved = false, notice = null, busy = false, provider = null;
    const NOTICES = Object.freeze({ erro: 'Não foi possível entrar com o Google. Tente de novo.', negado: 'Esta conta Google não tem acesso a este painel.' });
    const prov = () => { const b = backendBaseUrl(); if (!b) return null; if (!provider || provider.baseUrl !== b) provider = Object.assign(Object.create(null), { baseUrl: b, p: ServerSessionProvider({ baseUrl: b }) }); return provider.p; };
    /** start({ search }) — once: reads the ?login= notice left by the callback (UI message only, never identity) and loads /me */
    function start(o = {}) {
      if (started || !backendBaseUrl()) return Promise.resolve({ ok: true, skipped: true });
      started = true;
      const m = /[?&]login=(erro|negado)\b/.exec(String(o.search || ''));
      if (m) { notice = NOTICES[m[1]]; securityEvent('LOGIN_FAILURE', { reasonCode: m[1] === 'negado' ? 'DENIED' : 'FAILED' }); }
      const done = r => { resolved = true; setContext(context(), 'account'); return r; }; // subscribers re-render the header once
      return refresh({ fetch: o.fetch }).then(r => { const c = context(); if (r && r.ok && c.principal.type !== PRINCIPAL_TYPE.ANONYMOUS) securityEvent('LOGIN_SUCCESS', {}); return done(r); },
        () => done({ ok: false, reason: 'NETWORK_ERROR' }));
    }
    /** viewModel() → { visible, authenticated, firstName, limited, busy, notice, loginLabel, logoutLabel, ariaLabel } */
    function viewModel(opts = {}) {
      if (!backendBaseUrl() || (started && !resolved)) return Object.freeze({ visible: false }); // no flash of "Entrar" while /me loads
      const c = opts.context || context(), anon = !c || c.principal.type === PRINCIPAL_TYPE.ANONYMOUS;
      const firstName = anon ? null : (String(c.principal.displayName || '').trim().split(/\s+/)[0] || 'Usuário').slice(0, 24);
      const limited = !anon && c.principal.type === PRINCIPAL_TYPE.USER && !c.tenant;
      return Object.freeze({ visible: true, authenticated: !anon, firstName, limited, busy, notice,
        loginLabel: 'Entrar com Google', logoutLabel: 'Sair',
        ariaLabel: anon ? 'Entrar com sua conta Google' : `Conectado como ${firstName}${limited ? ' (sem acesso de organização)' : ''}. Sair` });
    }
    /** loginUrl(returnTo) → where the browser must go (null in static mode) */
    function loginUrl(returnTo) { const p = prov(); notice = null; return p ? p.loginUrl(returnTo) : null; }
    async function logout(o = {}) {
      const b = backendBaseUrl(); if (!b || busy) return { ok: false, reason: b ? 'BUSY' : 'STATIC_PUBLIC' };
      busy = true;
      try { return await (o.fetch ? ServerSessionProvider({ baseUrl: b, fetch: o.fetch }) : prov()).logout(); } finally { busy = false; }
    }
    return Object.freeze({ start, viewModel, loginUrl, logout, NOTICES, _reset: () => { started = false; resolved = false; notice = null; busy = false; provider = null; } });
  })();
  /** DevIdentityProvider: local/test only; refuses in production (App.buildEnv unset in the shipped build). */
  function DevIdentityProvider() {
    if (env() === 'production') { securityEvent('DEV_AUTH_BLOCKED', {}); throw Object.assign(new Error('DevIdentityProvider desabilitado em produção'), { code: 'DEV_AUTH_DISABLED' }); }
    return Object.freeze({ kind: 'DEV',
      /** signIn({ userId, displayName, organizationId, roles: ['BROKER'], developmentId?, status?, memberships?, sessionExpiresAt?, now? }) */
      signIn(o = {}) {
        if (env() === 'production') throw Object.assign(new Error('DevIdentityProvider desabilitado em produção'), { code: 'DEV_AUTH_DISABLED' });
        const keys = [...new Set((o.roles || []).flatMap(r => P().grantsOf(r)))];
        const memberships = o.memberships || [{ organizationId: o.organizationId, status: 'ACTIVE' }];
        const body = { authenticated: true, principal: { type: 'USER', id: o.userId || 'dev-user', displayName: o.displayName || 'Dev', status: o.status || 'ACTIVE', authenticationMethod: 'DEV_TOKEN' },
          organizationId: o.organizationId, memberships, roles: o.roles || [], roleAssignments: (o.roles || []).map(r => ({ role: r, organizationId: o.organizationId, developmentId: o.developmentId || null })),
          permissions: o.developmentId ? [] : keys, developmentPermissions: o.developmentId ? { [o.developmentId]: keys } : {}, policyVersion: P().policyVersion(),
          session: { status: 'ACTIVE', expiresAt: o.sessionExpiresAt || null } };
        const r = fromMe(body, { now: o.now, developmentId: o.developmentId || activeDevelopmentId(), source: SOURCE.DEV });
        if (r.ok && !o.dryRun) setContext(r.context, 'dev');
        return r;
      },
      signOut() { reset('logout'); return { ok: true }; } });
  }

  return Object.freeze({ EFFECT, PRINCIPAL_TYPE, USER_STATUS, SESSION_STATUS, ASSIGNMENT_STATUS, AUTH_METHODS, SOURCE, AUDIT_OUTCOME, SECURITY_EVENT, REASONS, LIMITATION,
    environment: env, publicContext, fromMe, evaluate, finalAction, context, setContext, subscribe, reset, refresh, switchOrganization,
    can, guard, feature, action, route, section, uiMode, viewModel, maskCustomer, redact, audit, auditEvent, securityEvent,
    securityEvents: () => secLog.slice(), canAssign, ServerSessionProvider, DevIdentityProvider, backendBaseUrl, account });
})();
