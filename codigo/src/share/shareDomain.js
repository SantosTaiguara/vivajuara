/* share/shareDomain.js — topic 42: ShareService domain (frontend side + reference implementation of the contracts).
   ShareDefinition · SharePolicy (versioned registry) · ShareGrant (+ derived EXPIRED) · ShareTokenRecord (hash only) ·
   ShareArtifactRef · ShareAccessDecision (+ capabilities) · ShareAccessSession · ShareRevocationRecord ·
   ShareFreshnessPolicy · SharePasscodePolicy · ShareRateLimitPolicy · SharePreviewMetadataPolicy · ShareAssetAccessPolicy ·
   ShareReusePolicy · ShareSafetyDependency · ShareEntryPoint (+ validated initial view state) · ShareActionEvent /
   ShareAccessRecord · permissions · legacy link inventory.

   THE FRONTEND IS NEVER THE AUTHORITY FOR A SHARE. Issuing, hashing, expiry, revocation, one-time consumption, passcode
   and rate limits are enforced by the backend (docs/SHARE_*.md, backend/src/modules/share/tokens.js). This module
   gives the UI the same rules (to show correct states and never build an unsafe link) and an in-memory reference used
   by the tests. A share token held by the browser is a bearer secret for the backend, never an authorization the
   frontend trusts. Share URLs carry only an opaque token: no customer id, no PII, no lot id, no price, no query params. */
App.share = App.share || {};
App.share.domain = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const ResourceType = E('PRESENTATION_SNAPSHOT', 'LOT_SNAPSHOT', 'FAVORITE_COLLECTION_SNAPSHOT', 'COMPARISON_SNAPSHOT', 'RECOMMENDATION_RESULT', 'FINANCIAL_SIMULATION_RESULT', 'DOCUMENT', 'CUSTOM_CLIENT_SAFE_RESOURCE');
  const AudienceType = E('CUSTOMER', 'CUSTOMER_GROUP', 'AUTHENTICATED_INTERNAL', 'AUTHENTICATED_EXTERNAL', 'PUBLIC_LINK');
  const AccessMode = E('AUTHENTICATED', 'TOKEN', 'TOKEN_PLUS_PASSCODE', 'ONE_TIME_TOKEN');
  const DefinitionStatus = E('DRAFT', 'ACTIVE', 'ARCHIVED');
  const GrantStatus = E('ACTIVE', 'EXPIRED', 'REVOKED', 'CONSUMED', 'SUSPENDED');
  const Capability = E('VIEW', 'PRINT', 'DOWNLOAD', 'RESHARE', 'OPEN_MAP', 'OPEN_COMPARISON', 'OPEN_FINANCIAL', 'SUBMIT_FEEDBACK');
  const ChannelType = E('COPY_LINK', 'NATIVE_SHARE', 'WHATSAPP', 'EMAIL', 'QR_CODE', 'INTERNAL', 'OTHER');
  const RevocationReason = E('USER_REVOKED', 'CUSTOMER_REQUEST', 'RESOURCE_REVOKED', 'SECURITY_POLICY_CHANGE', 'DATA_CORRECTION', 'SHARE_CREATED_IN_ERROR', 'CUSTOMER_RELATIONSHIP_ENDED', 'OTHER');
  const PreviewMode = E('GENERIC', 'RESOURCE_SAFE', 'DISABLED');
  const AssetAccess = E('PROXY_AUTHORIZED', 'SHORT_LIVED_SIGNED_URL', 'PUBLIC_STATIC_SAFE_ASSET');
  const RecipientConstraint = E('NONE', 'PASSCODE', 'AUTHENTICATED_IDENTITY', 'EMAIL_CHALLENGE');
  /** client-facing errors are generic: invalid / expired / revoked / suspended / consumed / cross-tenant all look the same */
  const PublicError = E('LINK_INVALID_OR_UNAVAILABLE', 'PASSCODE_REQUIRED', 'PASSCODE_INVALID', 'ACCESS_LIMIT_REACHED', 'RESOURCE_UNAVAILABLE');
  const PUBLIC_MESSAGES = Object.freeze({
    LINK_INVALID_OR_UNAVAILABLE: org => `Este link não está mais disponível. Entre em contato com a ${org || 'imobiliária'} para receber uma versão atualizada.`,
    PASSCODE_REQUIRED: () => 'Digite o código de acesso para ver este conteúdo.', PASSCODE_INVALID: () => 'Código de acesso incorreto.',
    ACCESS_LIMIT_REACHED: org => `Este link atingiu o limite de acessos. Entre em contato com a ${org || 'imobiliária'}.`,
    RESOURCE_UNAVAILABLE: () => 'Esta apresentação precisa ser atualizada antes de ser exibida.'
  });
  const POLICY_REGISTRY_VERSION = 'share-42.1.0';
  const DAY = 86400;
  const err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });
  const nowMs = o => Date.parse((o && o.now) || new Date().toISOString());
  const iso = ms => new Date(ms).toISOString();
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };

  // ---------------------------------------------------------------- SharePolicy registry (versioned; TTLs are per content, never universal)
  const P = (code, o) => freeze({ id: 'shp_' + code.toLowerCase(), organizationId: null, code, version: '1.0.0', status: 'ACTIVE', allowNoExpiry: false, allowDownload: false, allowPrint: true, allowReshare: false,
    requireCurrentSafetyStatus: true, requireFreshnessCheck: true, allowedChannelTypes: ['COPY_LINK', 'NATIVE_SHARE', 'WHATSAPP', 'EMAIL', 'QR_CODE'], maxAccessCount: null,
    passcodePolicyRef: 'passcode-default', rateLimitPolicyRef: 'rate-default', cachePolicyRef: 'private-no-store', previewMetadata: 'GENERIC', reviewRequiredBehavior: 'SUSPEND',
    allowedAudienceTypes: ['CUSTOMER', 'CUSTOMER_GROUP', 'PUBLIC_LINK'], allowedAccessModes: ['TOKEN', 'TOKEN_PLUS_PASSCODE', 'ONE_TIME_TOKEN'],
    capabilities: ['VIEW', 'PRINT', 'OPEN_MAP', 'OPEN_COMPARISON', 'OPEN_FINANCIAL', 'SUBMIT_FEEDBACK'], ...o });
  const POLICIES = freeze({
    PRESENTATION_CUSTOMER: P('PRESENTATION_CUSTOMER', { allowedResourceTypes: ['PRESENTATION_SNAPSHOT'], defaultTtlSeconds: 7 * DAY, maxTtlSeconds: 30 * DAY,
      freshness: { resourceType: 'PRESENTATION_SNAPSHOT', staleBehavior: 'ALLOW_WITH_WARNING', availabilityBehavior: 'ALLOW_WITH_CAVEAT', pricingBehavior: 'ALLOW_WITH_CAVEAT', financialBehavior: 'ALLOW_SNAPSHOT' } }),
    LOT_CUSTOMER: P('LOT_CUSTOMER', { allowedResourceTypes: ['LOT_SNAPSHOT', 'FAVORITE_COLLECTION_SNAPSHOT', 'COMPARISON_SNAPSHOT'], defaultTtlSeconds: 7 * DAY, maxTtlSeconds: 30 * DAY, capabilities: ['VIEW', 'PRINT', 'OPEN_MAP', 'OPEN_COMPARISON', 'SUBMIT_FEEDBACK'],
      freshness: { resourceType: 'LOT_SNAPSHOT', staleBehavior: 'ALLOW_WITH_WARNING', availabilityBehavior: 'ALLOW_WITH_CAVEAT', pricingBehavior: 'ALLOW_WITH_CAVEAT', financialBehavior: 'ALLOW_SNAPSHOT' } }),
    FINANCIAL_CUSTOMER: P('FINANCIAL_CUSTOMER', { allowedResourceTypes: ['FINANCIAL_SIMULATION_RESULT'], defaultTtlSeconds: 2 * DAY, maxTtlSeconds: 7 * DAY, capabilities: ['VIEW', 'PRINT', 'OPEN_FINANCIAL'],
      freshness: { resourceType: 'FINANCIAL_SIMULATION_RESULT', staleBehavior: 'REQUIRE_REFRESH', availabilityBehavior: 'BLOCK_IF_STALE', pricingBehavior: 'BLOCK_IF_STALE', financialBehavior: 'BLOCK_IF_EXPIRED' } }),
    DOCUMENT_DENY: P('DOCUMENT_DENY', { allowedResourceTypes: [], defaultTtlSeconds: 0, maxTtlSeconds: 0, allowedChannelTypes: [], capabilities: [], freshness: null, note: 'Documentos só com classificação permitida (Document Domain ainda inexistente).' })
  });
  const policyFor = resourceType => Object.values(POLICIES).find(p => p.status === 'ACTIVE' && p.allowedResourceTypes.includes(resourceType)) || null;
  const policyRef = p => `${p.code}@${p.version}`;
  const SHARE_PASSCODE_POLICY = freeze({ minLength: 6, maxAttempts: 5, lockoutSeconds: 900, hashAlgorithmRef: 'scrypt-N16384-r8-p1 (backend) · PBKDF2-SHA256-210000 (reference)' });
  const RATE_LIMIT_POLICY = freeze({ maxAttemptsPerMinute: 30, maxInvalidTokenAttemptsPerMinute: 10, maxPasscodeAttempts: 5, lockoutSeconds: 900 });
  const SESSION_TTL_SECONDS = 30 * 60; // short-lived share session (never longer than the grant)
  const SECURITY_HEADERS = freeze({ 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
  const REUSE_POLICY = freeze({ reuseActiveGrantForSameResource: false, requireSameAudienceBinding: true, requireSamePolicyVersion: true, requireSameExpiryPolicy: false, askUser: 'Já existe um link ativo. Copiar existente ou criar novo?' });
  const WATERMARK_POLICY = freeze({ enabled: false, type: 'GENERIC', showTimestamp: true });

  // ---------------------------------------------------------------- permissions (resource.read ≠ share.issue)
  const PERMISSIONS = freeze({ 'share.read': 'share.create', 'share.create': 'share.create', 'share.issue': 'share.create', 'share.revoke': 'share.create', 'share.suspend': 'share.create', 'share.channel.generate': 'share.create',
    'share.extendExpiry': null, 'share.viewAccessHistory': null, 'share.overridePolicy': null }); // null = never granted locally (backend registry first)
  function can(ctx, key) {
    if (!(key in PERMISSIONS)) return false;
    if (ctx && typeof ctx.can === 'function') return ctx.can(key) === true;
    const k = PERMISSIONS[key]; if (!k) return false;
    try { return !!(App.authz && App.authz.can(k)); } catch (e) { return false; }
  }
  /** ExternalShareCapability: Tenant AND share permission AND resource read AND policy; a raw technical object is never externally shareable */
  function externalShareCapability(ctx, artifact, o = {}) {
    const reasons = [];
    if (!artifact || !ResourceType[artifact.resourceType]) reasons.push('UNSUPPORTED_RESOURCE');
    else if (!policyFor(artifact.resourceType)) reasons.push('NO_POLICY_FOR_RESOURCE');
    if (!ctx || !ctx.organizationId || (artifact && artifact.organizationId !== ctx.organizationId)) reasons.push('CROSS_TENANT');
    if (!can(ctx, 'share.issue')) reasons.push('NO_SHARE_PERMISSION');
    if (!(o.canReadResource === true)) reasons.push('NO_RESOURCE_ACCESS');
    if (artifact && artifact.safetyStatus && artifact.safetyStatus !== 'SAFE') reasons.push('RESOURCE_NOT_SAFE');
    if (artifact && artifact.clientSafe !== true) reasons.push('NOT_CLIENT_SAFE');
    return freeze({ allowed: !reasons.length, reasons });
  }

  // ---------------------------------------------------------------- token (cryptographic, opaque; raw value returned once)
  function rng(n) {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (!c || !c.getRandomValues) throw err('TOKEN_RNG_UNAVAILABLE', 'Gerador criptográfico indisponível: link não emitido.'); // never Math.random
    return c.getRandomValues(new Uint8Array(n));
  }
  const b64url = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(bytes).toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  /** generateToken() → 32 random bytes (256 bits) as base64url (43 chars). Not derived from any id. */
  const generateToken = () => b64url(rng(32));
  /** hashToken(token, pepper?) → hex SHA-256 (reference). The backend uses HMAC-SHA256 with a server-side pepper. */
  async function hashToken(token, pepper = '') {
    const c = typeof crypto !== 'undefined' ? crypto : null; if (!c || !c.subtle) throw err('HASH_UNAVAILABLE', 'Hash indisponível.');
    const d = await c.subtle.digest('SHA-256', new TextEncoder().encode(pepper + ':' + token));
    return Array.from(new Uint8Array(d), x => x.toString(16).padStart(2, '0')).join('');
  }
  /** redactToken(text): removes any token-looking secret from text before it reaches logs/analytics */
  const redactToken = s => String(s == null ? '' : s).replace(/\/s\/[A-Za-z0-9_-]{20,}/g, '/s/[token]').replace(/\b[A-Za-z0-9_-]{43}\b/g, '[token]');

  // ---------------------------------------------------------------- share URL (opaque token only; nothing else)
  const URL_FORBIDDEN = Object.freeze([
    { code: 'QUERY_PARAMS', re: /\?/ }, { code: 'FRAGMENT_STATE', re: /#./ }, { code: 'PII_EMAIL', re: /[A-Z0-9._%+-]+(@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/i },
    { code: 'PII_PHONE', re: /(?:\+|%2B)?55\d{10,11}|\(?\b\d{2}\)?[\s-]?9\d{4}[-\s]?\d{4}\b/ }, { code: 'PII_CPF', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/ },
    { code: 'CUSTOMER_ID', re: /customer|cliente|\bcus_|\bC\d{2,}\b/i }, { code: 'INTERNAL_LOT_ID', re: /\b[A-Z]{1,4}-Q[A-Z0-9]{1,4}-L\d{4}\b/ },
    { code: 'COMMERCIAL_VALUE', re: /price|preco|valor|R\$|\b\d{5,}\b/i }, { code: 'INTERNAL_RESOURCE_ID', re: /\b(prs|prd|pss|shd|shg)_[a-z0-9]+/i }
  ]);
  /** validateShareUrl(url) → [{ code }] (empty = safe). Applied to every URL the channel service emits. */
  function validateShareUrl(url) {
    const out = [], s = String(url || '');
    const m = s.match(/^(https:\/\/[A-Za-z0-9.-]+(?::\d+)?)(\/[^?#]*)?\/s\/([A-Za-z0-9_-]+)$/);
    if (!m) out.push({ code: 'NOT_A_SHARE_URL' });
    else if (!TOKEN_RE.test(m[3])) out.push({ code: 'TOKEN_FORMAT' });
    const path = m ? (m[1].replace(/^https:\/\/[^/]+/, '') + (m[2] || '')) : s; // origin is trusted config; token itself is random
    for (const f of URL_FORBIDDEN) if (f.re.test(path) || (!m && f.re.test(s))) out.push({ code: f.code });
    return out;
  }
  /** shareUrl(origin, token): https origin only, no path params, no query; throws if anything unsafe slips in */
  function shareUrl(origin, token) {
    const o = String(origin || '').replace(/\/+$/, '');
    if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(\/[A-Za-z0-9._-]+)*$/.test(o)) throw err('INVALID_SHARE_ORIGIN', 'Origem de compartilhamento inválida (https, sem parâmetros).');
    const u = `${o}/s/${token}`, v = validateShareUrl(u);
    if (v.length) throw err('UNSAFE_SHARE_URL', 'URL de compartilhamento insegura: ' + v.map(x => x.code).join(', '), { issues: v });
    return u;
  }

  // ---------------------------------------------------------------- ShareDefinition / ShareGrant (pure lifecycle)
  function opaque(prefix) { return prefix + '_' + Array.from(rng(10), x => x.toString(16).padStart(2, '0')).join(''); }
  function createDefinition(ctx, input = {}) {
    if (!can(ctx, 'share.create')) throw err('FORBIDDEN', 'Você não possui permissão para compartilhar.');
    const a = input.artifact || {};
    if (!ResourceType[a.resourceType]) throw err('UNSUPPORTED_RESOURCE', 'Tipo de recurso não compartilhável.');
    const pol = input.policyCode ? POLICIES[input.policyCode] : policyFor(a.resourceType);
    if (!pol || !pol.allowedResourceTypes.includes(a.resourceType)) throw err('POLICY_DENIES_RESOURCE', 'A política não permite compartilhar este recurso.');
    if (a.organizationId !== ctx.organizationId) throw err('CROSS_TENANT', 'Recurso de outra organização.');
    const at = iso(nowMs(ctx));
    return freeze({ id: opaque('shd'), organizationId: ctx.organizationId, resourceType: a.resourceType, resourceId: a.resourceId, resourceVersionRef: a.versionRef || null, audienceType: input.audienceType || 'CUSTOMER',
      accessMode: input.accessMode || 'TOKEN', policyId: pol.id, policyVersionRef: policyRef(pol), title: input.title || null, description: null, lifecycleStatus: 'DRAFT', createdAt: at, updatedAt: at, createdBy: ctx.userId || null, updatedBy: null, recordRevision: 1,
      audienceBinding: input.audienceBinding ? { customerId: input.audienceBinding.customerId || null, customerGroupRef: input.audienceBinding.customerGroupRef || null, enforceBinding: !!input.audienceBinding.enforceBinding } : null }); // never a token
  }
  /** issueGrant(def, ctx, opts) → ShareGrant (pure; token generation/hashing happens in the service) */
  function buildGrant(def, ctx, o = {}) {
    if (def.lifecycleStatus === 'ARCHIVED') throw err('DEFINITION_ARCHIVED', 'Compartilhamento arquivado não emite novos links.');
    const pol = Object.values(POLICIES).find(p => p.id === def.policyId);
    if (!pol || pol.status !== 'ACTIVE') throw err('POLICY_NOT_ACTIVE', 'Política de compartilhamento inativa.');
    const mode = o.accessMode || def.accessMode, aud = o.audienceType || def.audienceType;
    if (!pol.allowedAccessModes.includes(mode)) throw err('ACCESS_MODE_NOT_ALLOWED', 'Modo de acesso não permitido pela política.');
    if (!pol.allowedAudienceTypes.includes(aud)) throw err('AUDIENCE_NOT_ALLOWED', 'Público não permitido pela política.');
    const now = nowMs(ctx), ttl = o.ttlSeconds == null ? pol.defaultTtlSeconds : o.ttlSeconds;
    if (ttl === Infinity || ttl === 0 || ttl == null) { if (!pol.allowNoExpiry) throw err('EXPIRY_REQUIRED', 'Este tipo de link precisa expirar.'); }
    else if (!(ttl > 0) || ttl > pol.maxTtlSeconds) throw err('TTL_OUT_OF_POLICY', `Validade máxima: ${Math.round(pol.maxTtlSeconds / DAY)} dias.`);
    const validFrom = o.validFrom ? Date.parse(o.validFrom) : now;
    return freeze({ id: opaque('shg'), organizationId: def.organizationId, shareDefinitionId: def.id, resourceType: def.resourceType, resourceId: def.resourceId, resourceVersionRef: def.resourceVersionRef,
      accessMode: mode, audienceType: aud, policyVersionRef: policyRef(pol), lifecycleStatus: 'ACTIVE', issuedAt: iso(now), issuedBy: ctx.userId || null, validFrom: iso(validFrom),
      expiresAt: ttl > 0 && ttl !== Infinity ? iso(validFrom + ttl * 1000) : null, revokedAt: null, revokedBy: null, revocationReasonCode: null,
      maxAccessCount: mode === 'ONE_TIME_TOKEN' ? 1 : o.maxAccessCount ?? pol.maxAccessCount ?? null, accessCount: 0, lastAccessAt: null, safetyStatusRef: o.safetyStatusRef || null, recordRevision: 1,
      capabilities: pol.capabilities.filter(c => c !== 'DOWNLOAD' || pol.allowDownload).filter(c => c !== 'PRINT' || pol.allowPrint).filter(c => c !== 'RESHARE' || pol.allowReshare) });
  }
  /** effectiveStatus(grant, now): EXPIRED derived from the clock (backend clock is authoritative; client clock never trusted) */
  function effectiveStatus(g, o = {}) {
    if (g.lifecycleStatus !== 'ACTIVE') return g.lifecycleStatus;
    const now = nowMs(o);
    if (g.expiresAt && now >= Date.parse(g.expiresAt)) return 'EXPIRED';
    if (g.maxAccessCount != null && g.accessCount >= g.maxAccessCount) return g.accessMode === 'ONE_TIME_TOKEN' ? 'CONSUMED' : 'ACTIVE';
    return 'ACTIVE';
  }
  const mutateGrant = (g, patch, expectedRevision) => { if (expectedRevision != null && expectedRevision !== g.recordRevision) throw err('REVISION_CONFLICT', 'O link foi alterado. Recarregue.'); return freeze({ ...g, ...patch, recordRevision: g.recordRevision + 1 }); };
  function revoke(g, ctx, reasonCode = 'USER_REVOKED', note) {
    if (!RevocationReason[reasonCode]) throw err('INVALID_REASON', reasonCode);
    if (g.lifecycleStatus === 'REVOKED') return { grant: g, record: null };
    const at = iso(nowMs(ctx));
    return { grant: mutateGrant(g, { lifecycleStatus: 'REVOKED', revokedAt: at, revokedBy: ctx.userId || null, revocationReasonCode: reasonCode }), record: freeze({ id: opaque('shr'), shareGrantId: g.id, reasonCode, revokedAt: at, revokedBy: ctx.userId || null, note: note ? String(note).slice(0, 200) : null }) };
  }
  const suspend = (g, ctx) => g.lifecycleStatus === 'ACTIVE' ? mutateGrant(g, { lifecycleStatus: 'SUSPENDED' }) : g;
  const resume = (g, ctx) => g.lifecycleStatus === 'SUSPENDED' ? mutateGrant(g, { lifecycleStatus: 'ACTIVE' }) : g;
  /** changeExpiry: shortening is always allowed; extending needs share.extendExpiry (never granted locally) and stays within policy */
  function changeExpiry(g, ctx, expiresAtIso) {
    const pol = Object.values(POLICIES).find(p => policyRef(p) === g.policyVersionRef), next = Date.parse(expiresAtIso), cur = g.expiresAt ? Date.parse(g.expiresAt) : Infinity;
    if (!(next > nowMs(ctx))) throw err('INVALID_EXPIRY', 'Data de expiração inválida.');
    if (next > cur && !can(ctx, 'share.extendExpiry')) throw err('FORBIDDEN', 'Estender a validade exige permissão.');
    if (pol && next - Date.parse(g.validFrom || g.issuedAt) > pol.maxTtlSeconds * 1000) throw err('TTL_OUT_OF_POLICY', 'Validade acima do máximo da política.');
    return mutateGrant(g, { expiresAt: iso(next) });
  }

  // ---------------------------------------------------------------- access decision (pure)
  /** evaluateAccess({ grant, now, tenantActive, safetyStatus, freshness, passcode: { required, verified, locked }, rateLimited, preview, consume }) → ShareAccessDecision */
  function evaluateAccess(i = {}) {
    const g = i.grant, reasons = [], pol = g ? Object.values(POLICIES).find(p => policyRef(p) === g.policyVersionRef) : null;
    const deny = (code, pub) => freeze({ allowed: false, denialReasonCodes: [...reasons, code], publicError: pub, grantStatus: g ? effectiveStatus(g, i) : null, requiresPasscode: pub === 'PASSCODE_REQUIRED' || pub === 'PASSCODE_INVALID',
      remainingAccessCount: null, resourceSafetyStatus: i.safetyStatus || null, resourceFreshnessWarnings: [], allowedCapabilities: [], consumesAccess: false });
    if (i.rateLimited) return deny('RATE_LIMITED', 'LINK_INVALID_OR_UNAVAILABLE');
    if (!g) return deny('TOKEN_NOT_FOUND', 'LINK_INVALID_OR_UNAVAILABLE');
    if (i.tenantActive === false) return deny('TENANT_SUSPENDED', 'LINK_INVALID_OR_UNAVAILABLE');
    const st = effectiveStatus(g, i);
    if (st !== 'ACTIVE') return deny('GRANT_' + st, 'LINK_INVALID_OR_UNAVAILABLE');
    if (g.validFrom && nowMs(i) < Date.parse(g.validFrom)) return deny('NOT_YET_VALID', 'LINK_INVALID_OR_UNAVAILABLE');
    if (!pol) return deny('POLICY_MISSING', 'LINK_INVALID_OR_UNAVAILABLE');
    if (pol.requireCurrentSafetyStatus) {
      if (i.safetyStatus === 'REVOKED' || i.safetyStatus == null) return deny('RESOURCE_SAFETY_' + (i.safetyStatus || 'UNKNOWN'), 'RESOURCE_UNAVAILABLE');
      if (i.safetyStatus === 'REVIEW_REQUIRED' && pol.reviewRequiredBehavior !== 'WARN') return deny('RESOURCE_SAFETY_REVIEW_REQUIRED', 'RESOURCE_UNAVAILABLE'); // customer-facing default: suspend until reviewed
    }
    const warnings = [], fr = i.freshness || {}, fp = pol.freshness || {};
    if (pol.requireFreshnessCheck && fr.commercialDataMayBeOutdated) {
      if (fp.staleBehavior === 'BLOCK' || fp.staleBehavior === 'REQUIRE_REFRESH') return deny('RESOURCE_STALE', 'RESOURCE_UNAVAILABLE');
      warnings.push('Valores e disponibilidade devem ser confirmados.');
    }
    if (fr.availabilityStale) { if (fp.availabilityBehavior === 'BLOCK_IF_STALE') return deny('AVAILABILITY_STALE', 'RESOURCE_UNAVAILABLE'); warnings.push('Disponibilidade sujeita a confirmação.'); }
    if (fr.pricingStale) { if (fp.pricingBehavior === 'BLOCK_IF_STALE') return deny('PRICING_STALE', 'RESOURCE_UNAVAILABLE'); warnings.push('Condição sujeita a confirmação.'); }
    if (fr.financialExpired && fp.financialBehavior === 'BLOCK_IF_EXPIRED') return deny('FINANCIAL_EXPIRED', 'RESOURCE_UNAVAILABLE');
    if (g.accessMode === 'TOKEN_PLUS_PASSCODE') {
      const pc = i.passcode || {};
      if (pc.locked) return deny('PASSCODE_LOCKED', 'PASSCODE_INVALID');
      if (!pc.attempted) return deny('PASSCODE_REQUIRED', 'PASSCODE_REQUIRED');
      if (!pc.verified) return deny('PASSCODE_INVALID', 'PASSCODE_INVALID');
    }
    if (g.maxAccessCount != null && g.accessCount >= g.maxAccessCount) return deny('ACCESS_LIMIT', 'ACCESS_LIMIT_REACHED');
    const preview = !!i.preview; // messaging-app preview bots: metadata only, never consume, never content
    const consumes = !preview && !!i.consume && !i.existingSession;
    return freeze({ allowed: true, denialReasonCodes: [], publicError: null, grantStatus: st, requiresPasscode: false, remainingAccessCount: g.maxAccessCount != null ? g.maxAccessCount - g.accessCount - (consumes ? 1 : 0) : null,
      resourceSafetyStatus: i.safetyStatus, resourceFreshnessWarnings: warnings, allowedCapabilities: preview ? [] : (g.capabilities || []).slice(), consumesAccess: consumes, previewOnly: preview });
  }
  /** isPreviewBot(userAgentClass) — link-preview fetchers (WhatsApp, Slack, Telegram, Facebook, iMessage…) */
  const isPreviewBot = ua => /whatsapp|facebookexternalhit|slackbot|telegrambot|twitterbot|linkedinbot|discordbot|skypeuripreview|applebot|googlebot|bingbot|preview|crawler|spider|bot\b/i.test(String(ua || ''));
  /** previewMetadata(mode, org): generic by default (no customer name, no price, no image) */
  function previewMetadata(mode = 'GENERIC', org = {}) {
    if (mode === 'DISABLED') return freeze({ title: null, description: null, image: null, robots: 'noindex, nofollow' });
    return freeze({ title: `Apresentação ${org.name || ''}`.trim(), description: `Conteúdo compartilhado pela ${org.name || 'imobiliária'}.`, image: null, robots: 'noindex, nofollow' });
  }

  // ---------------------------------------------------------------- assets
  /** assetAccess(asset, grant, now) — customer-specific assets are proxied through the share session; only generic theme assets are public */
  function assetAccess(asset, g, o = {}) {
    if (!asset) return freeze({ mode: null, allowed: false });
    if (asset.generic === true && asset.customerSpecific !== true) return freeze({ mode: 'PUBLIC_STATIC_SAFE_ASSET', allowed: true, cache: 'public, max-age=31536000, immutable' });
    if (asset.signed === true && g) { const left = g.expiresAt ? Date.parse(g.expiresAt) - nowMs(o) : Infinity; return freeze({ mode: 'SHORT_LIVED_SIGNED_URL', allowed: left > 0, ttlSeconds: Math.max(0, Math.min(300, Math.floor(left / 1000) - 1)), cache: 'private, no-store' }); }
    return freeze({ mode: 'PROXY_AUTHORIZED', allowed: true, cache: 'private, no-store' });
  }

  // ---------------------------------------------------------------- entry point / initial view state (schema-validated, client-safe)
  const VIEW_KEYS = Object.freeze({ step: v => typeof v === 'string' && /^st\d{1,3}$/.test(v), lotRef: v => typeof v === 'string' && /^[A-Z]{1,3}\d{1,4}$/.test(v),
    comparisonSection: v => ['summary', 'location', 'comfort', 'commercial', 'technical'].includes(v), mapViewportPreset: v => ['overview', 'presented', 'lot'].includes(v) });
  function validateInitialViewState(s, allowed = {}) {
    if (s == null) return { ok: true, value: null };
    if (typeof s !== 'object' || Array.isArray(s)) return { ok: false, code: 'INVALID_VIEW_STATE' };
    const out = {};
    for (const [k, v] of Object.entries(s)) {
      if (!VIEW_KEYS[k] || !VIEW_KEYS[k](v)) return { ok: false, code: 'INVALID_VIEW_STATE', key: k };
      if (k === 'lotRef' && allowed.lotRefs && !allowed.lotRefs.includes(v)) return { ok: false, code: 'LOT_NOT_IN_RESOURCE', key: k };
      if (k === 'step' && allowed.stepIds && !allowed.stepIds.includes(v)) return { ok: false, code: 'STEP_NOT_IN_RESOURCE', key: k };
      out[k] = v;
    }
    return { ok: true, value: freeze(out) };
  }
  const ROUTE_OF = freeze({ PRESENTATION_SNAPSHOT: 'PRESENTATION', LOT_SNAPSHOT: 'LOT', COMPARISON_SNAPSHOT: 'COMPARISON', FINANCIAL_SIMULATION_RESULT: 'FINANCIAL', DOCUMENT: 'DOCUMENT', FAVORITE_COLLECTION_SNAPSHOT: 'LOT' });
  function entryPoint(artifact, initialViewState, allowed) {
    const v = validateInitialViewState(initialViewState, allowed); if (!v.ok) throw err(v.code, 'Estado inicial inválido.');
    return freeze({ routeType: ROUTE_OF[artifact.resourceType] || 'PRESENTATION', resourceRef: { resourceType: artifact.resourceType, resourceId: artifact.resourceId, versionRef: artifact.versionRef || null, contentChecksum: artifact.contentChecksum || null }, initialViewState: v.value });
  }

  // ---------------------------------------------------------------- events (Topic 44/45 boundary) + Journey boundary
  const ACTION_EVENTS = Object.freeze(['share_created', 'share_opened', 'share_session_started', 'share_resource_viewed', 'share_feedback_submitted', 'share_expired', 'share_revoked']);
  const AUDIT_EVENTS = Object.freeze(['ShareDefinitionCreated', 'ShareGrantIssued', 'ShareGrantRevoked', 'ShareGrantExpired', 'ShareGrantSuspended', 'ShareGrantResumed', 'ShareAccessDenied', 'SharePasscodeFailed', 'ShareSafetyBlocked', 'SharePolicyOverridden']);
  /** journey boundary: only an intentional delivery becomes PRESENTATION_SHARED (copy link alone is LINK_COPIED, never "sent") */
  const JOURNEY_MAP = freeze({ SHARE_GRANT_CREATED: null, LINK_COPIED: null, DELIVERY_REQUESTED: null, DELIVERY_CONFIRMED: 'PRESENTATION_SHARED', MARKED_AS_SENT: 'PRESENTATION_SHARED', RESOURCE_OPENED: 'PRESENTATION_OPENED', FEEDBACK_SUBMITTED: 'PRESENTATION_FEEDBACK' });
  const journeyEventFor = (action, grant) => JOURNEY_MAP[action] && grant && grant.resourceType === 'PRESENTATION_SNAPSHOT' ? freeze({ type: JOURNEY_MAP[action], shareGrantId: grant.id, resourceId: grant.resourceId }) : null;

  // ---------------------------------------------------------------- management view (internal; never the raw token)
  function linkStatusVM(g, o = {}) {
    const st = effectiveStatus(g, o), F = App.fmt, left = g.expiresAt ? Date.parse(g.expiresAt) - nowMs(o) : null;
    const label = st === 'ACTIVE' ? (left != null && left < 3 * DAY * 1000 ? `Expira em ${Math.max(1, Math.ceil(left / 3600000))} h` : 'Ativo') : { EXPIRED: 'Expirado', REVOKED: 'Revogado', SUSPENDED: 'Suspenso', CONSUMED: 'Consumido' }[st];
    return freeze({ shareGrantId: g.id, resource: { PRESENTATION_SNAPSHOT: 'Apresentação', LOT_SNAPSHOT: 'Lote', COMPARISON_SNAPSHOT: 'Comparação', FINANCIAL_SIMULATION_RESULT: 'Simulação', FAVORITE_COLLECTION_SNAPSHOT: 'Seleção' }[g.resourceType] || 'Recurso',
      created: F ? F.formatDateTime(g.issuedAt) : g.issuedAt, expires: g.expiresAt ? (F ? F.formatDateTime(g.expiresAt) : g.expiresAt) : 'Sem expiração', status: st, statusLabel: label,
      accessMode: { TOKEN: 'Link', TOKEN_PLUS_PASSCODE: 'Link + código', ONE_TIME_TOKEN: 'Link de uso único', AUTHENTICATED: 'Acesso com login' }[g.accessMode], lastAccess: g.lastAccessAt ? (F ? F.formatDateTime(g.lastAccessAt) : g.lastAccessAt) : 'Nunca acessado',
      accessCount: g.accessCount, maskedLink: o.tokenPrefix ? `…/s/${o.tokenPrefix}••••` : '…/s/••••', actions: st === 'ACTIVE' ? ['CREATE_NEW_LINK', 'REVOKE', 'SUSPEND'] : st === 'SUSPENDED' ? ['RESUME', 'REVOKE', 'CREATE_NEW_LINK'] : ['CREATE_NEW_LINK'] });
  }

  // ---------------------------------------------------------------- legacy link inventory (what existed before topic 42)
  const LEGACY_INVENTORY = freeze([
    { location: 'presentation/app.js shareLink() → services/share.js deepLink(dev.shareUrl, token)', resourceType: 'LOT/COMPARISON (deep link interno)', currentUrlPattern: '<artifact>#viva-juara.lots.<code> | #viva-juara.compare.<code>~<code>',
      exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false, migrationAction: 'WRAP', severity: 'LOW', notes: 'Deep link interno sobre dados públicos (códigos curtos). Para cliente usar App.share (link opaco); o deep link continua para uso interno.' },
    { location: 'presentation/viewmodels.js shareVM → services/share.js whatsappUrl (wa.me/?text=)', resourceType: 'mensagem com lotes', currentUrlPattern: 'https://wa.me/?text=Olá, <nome>! … Preço … Disponível … [Score se não-cliente]',
      exposesInternalIds: false, exposesPII: true, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false, migrationAction: 'REPLACE', severity: 'MEDIUM', notes: 'Nome do cliente digitado e preço/status no texto da URL do WhatsApp; fora do modo cliente inclui score e classe. Substituir pelo payload de canal genérico (sem preço/status por padrão).' },
    { location: 'compare/comparisonDomain.js sharePayload/deepLinkToken', resourceType: 'COMPARISON (deep link interno)', currentUrlPattern: '<artifact>#<dev>.compare.<code>~<code>',
      exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false, migrationAction: 'WRAP', severity: 'LOW', notes: 'Somente códigos curtos; sem cliente. Compartilhamento externo deve virar COMPARISON_SNAPSHOT + ShareGrant.' },
    { location: 'state/store.js App.router (hash ?base=&layer=&f=)', resourceType: 'estado de mapa/filtros (deep link interno)', currentUrlPattern: '#<dev>.lots.<code>?layer=…&f=<filtros>',
      exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false, migrationAction: 'REVIEW', severity: 'LOW', notes: 'Filtros podem conter faixa de orçamento escolhida para um cliente; não usar como link externo. Tópico 43 formaliza estado compartilhável.' },
    { location: 'presentation/dom.js copy() (clipboard)', resourceType: 'ação do usuário', currentUrlPattern: null, exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false,
      migrationAction: 'WRAP', severity: 'LOW', notes: 'Cópia só por ação explícita (ok). Reutilizado por COPY_LINK.' },
    { location: 'presentation/overlays.js botão "PDF (em breve)"', resourceType: 'export', currentUrlPattern: null, exposesInternalIds: false, exposesPII: false, reliesOnObscurity: false, hasExpiry: false, hasRevocation: false,
      migrationAction: 'REVIEW', severity: 'LOW', notes: 'Desativado. Export deve partir de PresentationSnapshot (tópico 41 exportRequest).' }
  ]);

  return freeze({ ResourceType, AudienceType, AccessMode, DefinitionStatus, GrantStatus, Capability, ChannelType, RevocationReason, PreviewMode, AssetAccess, RecipientConstraint, PublicError, PUBLIC_MESSAGES,
    POLICY_REGISTRY_VERSION, POLICIES, policyFor, policyRef, SHARE_PASSCODE_POLICY, RATE_LIMIT_POLICY, SESSION_TTL_SECONDS, SECURITY_HEADERS, REUSE_POLICY, WATERMARK_POLICY, PERMISSIONS, can, externalShareCapability,
    generateToken, hashToken, redactToken, TOKEN_RE, validateShareUrl, shareUrl, opaque, createDefinition, buildGrant, effectiveStatus, revoke, suspend, resume, changeExpiry, evaluateAccess, isPreviewBot, previewMetadata,
    assetAccess, validateInitialViewState, entryPoint, ACTION_EVENTS, AUDIT_EVENTS, JOURNEY_MAP, journeyEventFor, linkStatusVM, LEGACY_INVENTORY });
})();
