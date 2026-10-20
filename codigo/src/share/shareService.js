/* share/shareService.js — topic 42: ShareApplicationService · ShareGrantService · ShareTokenService · ShareAccessService ·
   ShareChannelService (+ ShareMessageTemplate) · ShareResourceResolver · ShareRevocationService · ShareSafetyService ·
   ShareAssetService · ShareSnapshotFactory (LotShareSnapshot) — as ONE in-memory reference instance (createShareService).

   This is the executable contract the backend implements (same flows, same codes): in the browser it never decides
   who may see a share. Raw tokens exist only in the issuance result; the store keeps tokenHash + a 4-char prefix.
   Access is "grant valid AND resource safe AND fresh enough AND passcode/count/rate ok"; revocation wins immediately
   (sessions, cache and assets). The resolver returns only client-safe audience payloads (PresentationSnapshot.audience
   or a LotShareSnapshot), never a canonical object. Channels build payloads; nothing is sent automatically. */
App.share = App.share || {};
App.share.service = (() => {
  const S = App.share.domain;
  const err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });
  const nowMs = o => Date.parse((o && o.now) || new Date().toISOString());
  const iso = ms => new Date(ms).toISOString();
  const freeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
  const PM = () => App.presentationMode || {};

  // ---------------------------------------------------------------- message templates (escaped, allow-listed variables; no prices/status by default)
  const TEMPLATES = freeze({
    WHATSAPP: { id: 'tpl_whatsapp_default', channel: 'WHATSAPP', language: 'pt-BR', audienceType: 'CUSTOMER', version: '1.0.0', status: 'ACTIVE', allowedVariables: ['shareUrl', 'organizationName', 'recipientFirstName', 'presenterName', 'expiresAt'],
      template: 'Preparei uma apresentação com algumas opções para você.\nAcesse pelo link abaixo:\n{shareUrl}' },
    EMAIL: { id: 'tpl_email_default', channel: 'EMAIL', language: 'pt-BR', audienceType: 'CUSTOMER', version: '1.0.0', status: 'ACTIVE', allowedVariables: ['shareUrl', 'organizationName', 'recipientFirstName', 'presenterName', 'expiresAt'],
      subject: 'Apresentação {organizationName}', template: 'Olá,\n\nPreparei uma seleção de lotes para você. Acesse pelo link:\n{shareUrl}\n\nO link expira em {expiresAt}.' },
    NATIVE_SHARE: { id: 'tpl_native_default', channel: 'NATIVE_SHARE', language: 'pt-BR', audienceType: 'CUSTOMER', version: '1.0.0', status: 'ACTIVE', allowedVariables: ['shareUrl', 'organizationName'],
      template: 'Preparei uma seleção de lotes para você. Acesse pelo link.' }
  });
  const COMMERCIAL_FACT = /R\$\s?\d|\d+[.,]\d{3}|dispon[ií]ve(l|is)|reservad|vendid|desconto|pre[çc]o|valoriza|rentabil/i;
  function validateTemplate(t, o = {}) {
    const errors = [], vars = [...String(t.template || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]).concat([...String(t.subject || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]));
    for (const v of vars) if (!t.allowedVariables.includes(v)) errors.push('VARIABLE_NOT_ALLOWED:' + v);
    if (!o.allowCommercialFacts && (COMMERCIAL_FACT.test(t.template) || COMMERCIAL_FACT.test(t.subject || ''))) errors.push('COMMERCIAL_FACT_IN_TEMPLATE');
    if (/<\s*\/?\s*[a-z][^>]*>|javascript:/i.test(t.template + (t.subject || ''))) errors.push('MARKUP_NOT_ALLOWED');
    return errors;
  }
  const clean = (v, max = 60) => String(v == null ? '' : v).replace(/[<>\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
  function renderTemplate(t, vars = {}, o = {}) {
    const errors = validateTemplate(t, o); if (errors.length) throw err('INVALID_TEMPLATE', errors.join(', '), { errors });
    const safe = { shareUrl: vars.shareUrl, organizationName: clean(vars.organizationName), presenterName: clean(vars.presenterName, 40), expiresAt: vars.expiresAt ? clean(App.fmt ? App.fmt.formatDateTime(vars.expiresAt) : vars.expiresAt) : '',
      recipientFirstName: o.allowRecipientName ? clean(String(vars.recipientFirstName || '').split(/\s+/)[0], 30).replace(/[@\d]/g, '') : '' };
    const fill = s => String(s || '').replace(/\{(\w+)\}/g, (_, k) => safe[k] == null ? '' : safe[k]).replace(/\n{3,}/g, '\n\n');
    return { text: fill(t.template), subject: t.subject ? fill(t.subject) : null };
  }
  const QR_WARNING = 'O QR Code contém o link de acesso: quem tiver a imagem acessa o conteúdo até o link expirar ou ser revogado.';
  const canNativeShare = nav => !!(nav && typeof nav.share === 'function');

  function createShareService(cfg = {}) {
    const origin = cfg.origin || 'https://share.example.invalid', org = cfg.organization || { name: 'House 7' };
    const presentationRepo = cfg.presentationRepo || null;
    const definitions = new Map(), grants = new Map(), tokens = new Map(), sessions = new Map(), revocations = [], records = [], events = [], audits = [], deps = [], passcodes = new Map(), lotSnaps = new Map();
    const tenantInactive = new Set(), cache = new Map(), rate = new Map(), safety = new Map();
    const tick = o => nowMs({ now: (o && o.now) || (cfg.clock ? cfg.clock() : undefined) });
    const ev = (type, data, o) => { const e = freeze({ type, at: iso(tick(o)), ...data }); (S.ACTION_EVENTS.includes(type) ? events : audits).push(e); return e; };
    const record = (g, sessionId, result, reasonCode, o, ua) => { const r = freeze({ id: S.opaque('sar'), shareGrantId: g ? g.id : null, accessSessionId: sessionId || null, result, reasonCode: reasonCode || null, occurredAt: iso(tick(o)), userAgentClass: ua || null }); records.push(r); return r; };
    const dto = (g, o) => g ? freeze({ id: g.id, shareDefinitionId: g.shareDefinitionId, resourceType: g.resourceType, accessMode: g.accessMode, audienceType: g.audienceType, policyVersionRef: g.policyVersionRef, status: S.effectiveStatus(g, o), issuedAt: g.issuedAt,
      expiresAt: g.expiresAt, revokedAt: g.revokedAt, accessCount: g.accessCount, maxAccessCount: g.maxAccessCount, lastAccessAt: g.lastAccessAt, capabilities: g.capabilities, tokenPrefix: tokenPrefixOf(g.id) }) : null; // never the raw token
    const tokenPrefixOf = gid => { for (const t of tokens.values()) if (t.shareGrantId === gid) return t.tokenPrefix; return null; };

    // ------------------------------------------------------------ resource resolver (client-safe only)
    function resourceSafety(g, o) {
      if (g.resourceType === 'PRESENTATION_SNAPSHOT') { const r = PM().domain ? PM().domain.safety.get(g.organizationId, g.resourceId) : null; return r ? r.status : null; }
      const r = safety.get(g.organizationId + '|' + g.resourceId); return r || null;
    }
    function resolve(g, o = {}) {
      if (g.resourceType === 'PRESENTATION_SNAPSHOT') {
        if (!presentationRepo) return null;
        const snap = presentationRepo.getSnapshot({ organizationId: g.organizationId }, g.resourceId); // tenant from the grant, never from the request
        if (!snap || (g.resourceVersionRef && snap.checksum !== g.resourceVersionRef)) return null; // a grant never silently points to another version
        const fr = PM().domain.freshness(snap, { now: o.now, currentVersionRefs: o.currentVersionRefs || cfg.currentVersionRefs || null });
        const availabilityStale = (snap.warnings || []).some(w => w.code === 'AVAILABILITY_STALE' || w.code === 'AVAILABILITY_UNCONFIRMED'), pricingStale = (snap.warnings || []).some(w => w.code === 'PRICE_STALE');
        return { title: snap.audience.title, content: snap.audience, freshness: { ...fr, availabilityStale, pricingStale }, lotRefs: snap.audience.lots.map(l => l.lotRef), stepIds: snap.audience.storyline.steps.map(s => s.id) };
      }
      if (g.resourceType === 'LOT_SNAPSHOT') {
        const s = lotSnaps.get(g.resourceId); if (!s || s.organizationId !== g.organizationId || (g.resourceVersionRef && s.checksum !== g.resourceVersionRef)) return null;
        const age = tick(o) - Date.parse(s.generatedAt);
        return { title: s.content.identity.label, content: s.content, freshness: { commercialDataMayBeOutdated: age >= 86400000, availabilityStale: s.content.availability.state === 'STATUS_CONFIRMATION_REQUIRED', pricingStale: s.content.price.state === 'CURRENT_WITH_CAVEAT', warnings: [] }, lotRefs: [s.content.identity.lotRef], stepIds: [] };
      }
      return null; // DOCUMENT and others: no client-safe resolver yet → unavailable (deny by default)
    }
    /** canRead(ctx, artifact): the user can share only what they can read now */
    function canRead(ctx, a) {
      if (a.resourceType === 'PRESENTATION_SNAPSHOT') { if (!presentationRepo || !PM().domain.can(ctx, 'presentation.read')) return false; return !!presentationRepo.getSnapshot(ctx, a.resourceId); }
      if (a.resourceType === 'LOT_SNAPSHOT') { const s = lotSnaps.get(a.resourceId); return !!(s && s.organizationId === ctx.organizationId); }
      return false;
    }
    function artifactOf(ctx, input) {
      const a = { resourceType: input.resourceType, resourceId: input.resourceId, organizationId: ctx.organizationId };
      if (a.resourceType === 'PRESENTATION_SNAPSHOT' && presentationRepo) { const s = presentationRepo.getSnapshot(ctx, a.resourceId); if (s) { a.versionRef = s.checksum; a.contentChecksum = s.checksum; a.clientSafe = !!s.audience; const sf = PM().domain.safety.get(s.organizationId, s.id); a.safetyStatus = sf ? sf.status : null; } }
      if (a.resourceType === 'LOT_SNAPSHOT') { const s = lotSnaps.get(a.resourceId); if (s && s.organizationId === ctx.organizationId) { a.versionRef = s.checksum; a.contentChecksum = s.checksum; a.clientSafe = true; a.safetyStatus = safety.get(s.organizationId + '|' + s.id) || 'SAFE'; } }
      return a;
    }

    // ------------------------------------------------------------ issue / rotate / revoke / suspend
    async function issue(ctx, input = {}) {
      const a = artifactOf(ctx, input);
      const cap = S.externalShareCapability(ctx, a, { canReadResource: canRead(ctx, a) });
      if (!cap.allowed) { ev('ShareAccessDenied', { organizationId: ctx.organizationId, reasonCode: cap.reasons[0] }, ctx); return { ok: false, code: cap.reasons.includes('NO_SHARE_PERMISSION') ? 'FORBIDDEN' : cap.reasons.includes('RESOURCE_NOT_SAFE') ? 'RESOURCE_NOT_SAFE' : 'RESOURCE_NOT_SHAREABLE', reasons: cap.reasons }; }
      if (!input.forceNew) {
        const active = [...grants.values()].find(g => g.organizationId === ctx.organizationId && g.resourceId === a.resourceId && S.effectiveStatus(g, ctx) === 'ACTIVE' && sameBinding(definitions.get(g.shareDefinitionId), input.audienceBinding));
        if (active) return { ok: false, code: 'ACTIVE_GRANT_EXISTS', message: S.REUSE_POLICY.askUser, existing: dto(active, ctx) }; // never silently issue infinite links
      }
      let def = input.shareDefinitionId ? definitions.get(input.shareDefinitionId) : null;
      if (def && (def.organizationId !== ctx.organizationId || def.resourceId !== a.resourceId)) return { ok: false, code: 'NOT_FOUND' };
      if (!def) { def = S.createDefinition(ctx, { artifact: a, audienceType: input.audienceType, accessMode: input.accessMode, audienceBinding: input.audienceBinding, title: null }); ev('ShareDefinitionCreated', { organizationId: def.organizationId, shareDefinitionId: def.id }, ctx); }
      if (def.lifecycleStatus === 'DRAFT') { def = freeze({ ...def, lifecycleStatus: 'ACTIVE', recordRevision: def.recordRevision + 1 }); }
      definitions.set(def.id, def);
      if (input.accessMode === 'TOKEN_PLUS_PASSCODE') { const pc = checkPasscodeShape(input.passcode); if (pc) return { ok: false, code: pc }; }
      const g = S.buildGrant({ ...def, resourceVersionRef: a.versionRef }, ctx, { accessMode: input.accessMode, audienceType: input.audienceType, ttlSeconds: input.ttlSeconds, maxAccessCount: input.maxAccessCount, validFrom: input.validFrom, safetyStatusRef: a.safetyStatus });
      const token = S.generateToken(), tokenHash = await S.hashToken(token, cfg.pepper || '');
      if (input.accessMode === 'TOKEN_PLUS_PASSCODE') { if (input.passcode === token) return { ok: false, code: 'PASSCODE_EQUALS_TOKEN' }; passcodes.set(g.id, { ...(await hashPasscode(input.passcode)), failures: 0, lockedUntil: 0 }); }
      grants.set(g.id, g);
      tokens.set(tokenHash, freeze({ id: S.opaque('sht'), organizationId: g.organizationId, shareGrantId: g.id, tokenHash, tokenPrefix: token.slice(0, 4), createdAt: g.issuedAt, lastUsedAt: null, revokedAt: null }));
      if (g.resourceType === 'PRESENTATION_SNAPSHOT') addDependency(g.id, 'PRESENTATION_SNAPSHOT', g.resourceId, 'SAFE');
      addDependency(g.id, 'ORGANIZATION', g.organizationId, 'ACTIVE');
      if (def.audienceBinding && def.audienceBinding.customerId) addDependency(g.id, 'CUSTOMER', def.audienceBinding.customerId, 'ACCESSIBLE');
      ev('ShareGrantIssued', { organizationId: g.organizationId, shareGrantId: g.id, resourceType: g.resourceType }, ctx); ev('share_created', { shareGrantId: g.id, resourceType: g.resourceType }, ctx);
      const url = S.shareUrl(origin, token);
      return { ok: true, grant: dto(g, ctx), url, token, expiresAt: g.expiresAt, journeyEvent: null }; // ShareGrantCreateResultDto: the only time the raw token exists
    }
    const sameBinding = (def, b) => { const x = def && def.audienceBinding, cx = x ? x.customerId || null : null, cb = b ? b.customerId || null : null; return cx === cb; };
    function getGrant(ctx, id) { const g = grants.get(id); return g && g.organizationId === ctx.organizationId && S.can(ctx, 'share.read') ? dto(g, ctx) : null; } // IDOR: other tenant → null
    const listGrants = (ctx, defId) => S.can(ctx, 'share.read') ? [...grants.values()].filter(g => g.organizationId === ctx.organizationId && g.shareDefinitionId === defId).map(g => dto(g, ctx)) : [];
    function own(ctx, id, perm) { const g = grants.get(id); if (!g || g.organizationId !== ctx.organizationId) throw err('NOT_FOUND', 'Link não encontrado.'); if (!S.can(ctx, perm)) throw err('FORBIDDEN', 'Sem permissão.'); return g; }
    function revoke(ctx, id, reasonCode = 'USER_REVOKED', note) {
      const g = own(ctx, id, 'share.revoke'), r = S.revoke(g, ctx, reasonCode, note);
      grants.set(id, r.grant); if (r.record) revocations.push(r.record);
      for (const t of tokens.values()) if (t.shareGrantId === id) tokens.set(t.tokenHash, freeze({ ...t, revokedAt: r.grant.revokedAt }));
      invalidate(id, 'REVOKED');
      ev('ShareGrantRevoked', { organizationId: g.organizationId, shareGrantId: id, reasonCode }, ctx); ev('share_revoked', { shareGrantId: id }, ctx);
      return dto(r.grant, ctx);
    }
    function suspend(ctx, id) { const g = own(ctx, id, 'share.suspend'), n = S.suspend(g, ctx); grants.set(id, n); invalidate(id, 'REVOKED'); ev('ShareGrantSuspended', { organizationId: g.organizationId, shareGrantId: id }, ctx); return dto(n, ctx); }
    function resume(ctx, id) { const g = own(ctx, id, 'share.suspend'), n = S.resume(g, ctx); grants.set(id, n); ev('ShareGrantResumed', { organizationId: g.organizationId, shareGrantId: id }, ctx); return dto(n, ctx); }
    function changeExpiry(ctx, id, at) { const g = own(ctx, id, 'share.issue'), n = S.changeExpiry(g, ctx, at); grants.set(id, n); invalidate(id); return dto(n, ctx); }
    /** rotate: new grant + new token for the same resource version; the old grant is revoked (never mutated to a new secret) */
    async function rotate(ctx, id, o = {}) {
      const g = own(ctx, id, 'share.issue'), def = definitions.get(g.shareDefinitionId);
      const r = await issue(ctx, { resourceType: g.resourceType, resourceId: g.resourceId, accessMode: g.accessMode, audienceType: g.audienceType, shareDefinitionId: def.id, forceNew: true, ttlSeconds: o.ttlSeconds, passcode: o.passcode, audienceBinding: def.audienceBinding });
      if (r.ok && o.revokeOld !== false) revoke(ctx, id, 'OTHER', 'rotação de link');
      return r;
    }
    function invalidate(grantId, sessionStatus) {
      cache.delete(grantId);
      if (sessionStatus) for (const [k, s] of sessions) if (s.shareGrantId === grantId && s.status === 'ACTIVE') sessions.set(k, freeze({ ...s, status: sessionStatus }));
    }

    // ------------------------------------------------------------ passcode (hashed with salt + KDF; rate-limited; independent from the token)
    function checkPasscodeShape(p) {
      const s = String(p || '');
      if (s.length < S.SHARE_PASSCODE_POLICY.minLength) return 'PASSCODE_TOO_SHORT';
      if (/@/.test(s) || /^\+?\d{10,13}$/.test(s.replace(/[\s()-]/g, '')) || /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(s)) return 'PASSCODE_LOOKS_LIKE_PII'; // never email/phone/CPF as password
      return null;
    }
    async function hashPasscode(p, salt) {
      const c = crypto, sl = salt || c.getRandomValues(new Uint8Array(16));
      const key = await c.subtle.importKey('raw', new TextEncoder().encode(String(p)), 'PBKDF2', false, ['deriveBits']);
      const bits = await c.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sl, iterations: cfg.pbkdf2Iterations || 210000 }, key, 256);
      return { salt: sl, hash: Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2, '0')).join('') };
    }
    const eqConst = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

    // ------------------------------------------------------------ rate limiting (by an opaque client ref; never raw IP storage)
    function limited(clientRef, kind, o) {
      if (!clientRef) return false;
      const k = clientRef + '|' + kind, now = tick(o), xs = (rate.get(k) || []).filter(t => now - t < 60000);
      rate.set(k, xs); const max = kind === 'invalid' ? S.RATE_LIMIT_POLICY.maxInvalidTokenAttemptsPerMinute : S.RATE_LIMIT_POLICY.maxAttemptsPerMinute;
      return xs.length >= max;
    }
    const hit = (clientRef, kind, o) => { if (!clientRef) return; const k = clientRef + '|' + kind; rate.set(k, [...(rate.get(k) || []), tick(o)]); };

    // ------------------------------------------------------------ access (exchange token → short session; then the token can leave the URL)
    async function exchange(token, o = {}) {
      const ua = o.userAgentClass || null, deny = (g, code, pub, sessionId) => { record(g, sessionId, 'DENIED', code, o, ua); if (g) ev(code.startsWith('PASSCODE') ? 'SharePasscodeFailed' : code.startsWith('RESOURCE') ? 'ShareSafetyBlocked' : 'ShareAccessDenied', { organizationId: g.organizationId, shareGrantId: g.id, reasonCode: code }, o);
        return { ok: false, publicError: pub, message: S.PUBLIC_MESSAGES[pub](org.name), headers: S.SECURITY_HEADERS }; };
      if (limited(o.clientRef, 'all', o) || limited(o.clientRef, 'invalid', o)) return deny(null, 'RATE_LIMITED', 'LINK_INVALID_OR_UNAVAILABLE');
      hit(o.clientRef, 'all', o);
      if (!S.TOKEN_RE.test(String(token || ''))) { hit(o.clientRef, 'invalid', o); return deny(null, 'TOKEN_FORMAT', 'LINK_INVALID_OR_UNAVAILABLE'); }
      const th = await S.hashToken(token, cfg.pepper || ''), tr = tokens.get(th);
      const g0 = tr ? grants.get(tr.shareGrantId) : null;
      if (!g0) { hit(o.clientRef, 'invalid', o); return deny(null, 'TOKEN_NOT_FOUND', 'LINK_INVALID_OR_UNAVAILABLE'); }
      const preview = S.isPreviewBot(ua);
      if (preview) { record(g0, null, 'DENIED', 'PREVIEW_METADATA_ONLY', o, ua); return { ok: false, preview: true, metadata: S.previewMetadata('GENERIC', org), headers: S.SECURITY_HEADERS }; } // never consumes, never content
      let pc = { attempted: false, verified: false, locked: false };
      if (g0.accessMode === 'TOKEN_PLUS_PASSCODE') {
        const st = passcodes.get(g0.id) || {};
        pc.locked = st.lockedUntil > tick(o);
        if (!pc.locked && o.passcode != null) {
          pc.attempted = true;
          const h = await hashPasscode(o.passcode, st.salt); pc.verified = eqConst(h.hash, st.hash || '');
          if (!pc.verified) { st.failures = (st.failures || 0) + 1; if (st.failures >= S.SHARE_PASSCODE_POLICY.maxAttempts) { st.lockedUntil = tick(o) + S.SHARE_PASSCODE_POLICY.lockoutSeconds * 1000; st.failures = 0; } passcodes.set(g0.id, st); }
          else { st.failures = 0; passcodes.set(g0.id, st); }
        }
      }
      if (g0.accessMode === 'ONE_TIME_TOKEN' && !o.confirm) return { ok: false, requiresConfirmation: true, message: 'Toque em "Abrir apresentação" para continuar. Este link pode ser aberto uma única vez.', headers: S.SECURITY_HEADERS }; // human confirmation before consuming
      // --- atomic section: no await between re-read and write (the backend uses a transaction / compare-and-set)
      const g = grants.get(g0.id), res = resolve(g, o);
      const d = S.evaluateAccess({ grant: g, now: o.now || (cfg.clock && cfg.clock()), tenantActive: !tenantInactive.has(g.organizationId), safetyStatus: res ? resourceSafety(g, o) : null, freshness: res ? res.freshness : null, passcode: pc, consume: true });
      if (!d.allowed) return deny(g, d.denialReasonCodes[d.denialReasonCodes.length - 1], d.publicError);
      if (!res) return deny(g, 'RESOURCE_MISSING', 'RESOURCE_UNAVAILABLE');
      const n = freeze({ ...g, accessCount: g.accessCount + 1, lastAccessAt: iso(tick(o)), lifecycleStatus: g.accessMode === 'ONE_TIME_TOKEN' ? 'CONSUMED' : g.lifecycleStatus, recordRevision: g.recordRevision + 1 });
      grants.set(g.id, n); tokens.set(th, freeze({ ...tr, lastUsedAt: n.lastAccessAt }));
      const exp = Math.min(tick(o) + S.SESSION_TTL_SECONDS * 1000, g.expiresAt ? Date.parse(g.expiresAt) : Infinity);
      const sess = freeze({ id: S.opaque('shs'), shareGrantId: g.id, startedAt: iso(tick(o)), lastActivityAt: iso(tick(o)), expiresAt: iso(exp), accessContext: { userAgentClass: ua, locale: o.locale || null }, status: 'ACTIVE', csrf: S.opaque('csrf'), passcodeVerified: pc.verified });
      sessions.set(sess.id, sess);
      record(n, sess.id, 'ALLOWED', null, o, ua); ev('share_opened', { shareGrantId: g.id }, o); ev('share_session_started', { shareGrantId: g.id }, o);
      // ShareAccessBootstrapDto: the session ref goes into a short-lived HttpOnly cookie on the backend; the page then replaces /s/<token> with a clean route
      return { ok: true, sessionRef: sess.id, csrfToken: sess.csrf, expiresAt: sess.expiresAt, cleanRoute: '/shared/view', headers: S.SECURITY_HEADERS, warnings: d.resourceFreshnessWarnings, journeyEvent: S.journeyEventFor('RESOURCE_OPENED', n) };
    }
    function liveSession(ref, o) {
      const s = sessions.get(ref); if (!s) return { error: 'LINK_INVALID_OR_UNAVAILABLE' };
      if (s.status !== 'ACTIVE' || tick(o) >= Date.parse(s.expiresAt)) { if (s.status === 'ACTIVE') sessions.set(ref, freeze({ ...s, status: 'EXPIRED' })); return { error: 'LINK_INVALID_OR_UNAVAILABLE' }; }
      const g = grants.get(s.shareGrantId), res = g ? resolve(g, o) : null;
      const d = S.evaluateAccess({ grant: g ? { ...g, lifecycleStatus: g.lifecycleStatus === 'CONSUMED' ? 'ACTIVE' : g.lifecycleStatus, maxAccessCount: null } : null, now: o.now || (cfg.clock && cfg.clock()), tenantActive: g ? !tenantInactive.has(g.organizationId) : false,
        safetyStatus: g && res ? resourceSafety(g, o) : null, freshness: res ? res.freshness : null, passcode: { attempted: true, verified: s.passcodeVerified }, existingSession: true });
      if (!d.allowed || !res) { sessions.set(ref, freeze({ ...s, status: 'REVOKED' })); record(g, ref, 'DENIED', d.denialReasonCodes[d.denialReasonCodes.length - 1] || 'RESOURCE_MISSING', o); return { error: d.publicError || 'RESOURCE_UNAVAILABLE' }; }
      sessions.set(ref, freeze({ ...s, lastActivityAt: iso(tick(o)) }));
      return { session: s, grant: g, res, decision: d };
    }
    /** resource(sessionRef) → SharedResourceDto (client-safe content; refresh inside the session never increments the access count) */
    function resource(ref, o = {}) {
      const L = liveSession(ref, o); if (L.error) return { ok: false, publicError: L.error, message: S.PUBLIC_MESSAGES[L.error](org.name), headers: S.SECURITY_HEADERS };
      const { grant: g, res, decision: d } = L;
      const hit = cache.get(g.id); if (hit && hit.checksum === (g.resourceVersionRef || null)) { ev('share_resource_viewed', { shareGrantId: g.id }, o); return { ok: true, resource: hit.vm, headers: S.SECURITY_HEADERS, cached: true }; }
      const vm = freeze({ resourceType: g.resourceType, title: res.title, content: res.content, capabilities: d.allowedCapabilities, warnings: [...new Set([...(res.freshness.warnings || []), ...d.resourceFreshnessWarnings])],
        expiresAt: g.expiresAt, freshness: { commercialDataMayBeOutdated: !!res.freshness.commercialDataMayBeOutdated }, safetyStatus: resourceSafety(g, o), branding: { organizationName: org.name, logoAssetRef: org.logoAssetRef || null, themeRef: null, contactCta: org.contactCta || { label: 'Falar com corretor', channel: 'NONE' } },
        watermark: S.WATERMARK_POLICY.enabled ? { type: S.WATERMARK_POLICY.type } : null });
      cache.set(g.id, { checksum: g.resourceVersionRef || null, vm });
      ev('share_resource_viewed', { shareGrantId: g.id }, o);
      return { ok: true, resource: vm, headers: S.SECURITY_HEADERS };
    }
    function asset(ref, assetInput, o = {}) {
      const L = liveSession(ref, o); if (L.error) return { ok: false, publicError: L.error };
      return { ok: true, access: S.assetAccess(assetInput, L.grant, o) }; // assets never increment the access count
    }
    /** feedback(sessionRef, input): scoped to the share session; any customerId sent by the browser is ignored */
    function feedback(ref, input = {}, o = {}) {
      const L = liveSession(ref, o); if (L.error) return { ok: false, publicError: L.error };
      if (!input.csrfToken || input.csrfToken !== L.session.csrf) return { ok: false, publicError: 'LINK_INVALID_OR_UNAVAILABLE', reason: 'CSRF' };
      if (!L.decision.allowedCapabilities.includes('SUBMIT_FEEDBACK')) return { ok: false, publicError: 'RESOURCE_UNAVAILABLE', reason: 'CAPABILITY' };
      if (!['LIKED', 'MORE_INFO', 'VISIT_INTEREST', 'COMPARE', 'FINANCIAL_INTEREST'].includes(input.type)) return { ok: false, reason: 'INVALID_FEEDBACK_TYPE' };
      if (input.lotRef && !L.res.lotRefs.includes(input.lotRef)) return { ok: false, reason: 'LOT_NOT_IN_RESOURCE' };
      const def = definitions.get(L.grant.shareDefinitionId), binding = def && def.audienceBinding;
      const intent = freeze({ id: S.opaque('sfi'), shareGrantId: L.grant.id, accessSessionId: ref, type: input.type, lotRef: input.lotRef || null, customerId: binding ? binding.customerId : null, recordedBy: 'CUSTOMER', recordedAt: iso(tick(o)) }); // binding resolved server-side
      ev('share_feedback_submitted', { shareGrantId: L.grant.id, feedbackType: input.type }, o);
      return { ok: true, intent, profileChanged: false, journeyEvent: S.journeyEventFor('FEEDBACK_SUBMITTED', L.grant) };
    }

    // ------------------------------------------------------------ channels (payloads only; never sends)
    function channelPayload(ctx, input = {}) {
      if (!S.can(ctx, 'share.channel.generate')) return { ok: false, code: 'FORBIDDEN' };
      const g = grants.get(input.grantId); if (!g || g.organizationId !== ctx.organizationId) return { ok: false, code: 'NOT_FOUND' };
      const pol = Object.values(S.POLICIES).find(p => S.policyRef(p) === g.policyVersionRef);
      if (!S.ChannelType[input.channel] || !pol.allowedChannelTypes.includes(input.channel)) return { ok: false, code: 'CHANNEL_NOT_ALLOWED' };
      const issues = S.validateShareUrl(input.url); if (issues.length) return { ok: false, code: 'UNSAFE_SHARE_URL', issues };
      const vars = { shareUrl: input.url, organizationName: org.name, presenterName: input.presenterName, recipientFirstName: input.recipientFirstName, expiresAt: g.expiresAt };
      const warn = g.accessMode === 'TOKEN' ? ['Quem receber este link poderá abri-lo até expirar ou ser revogado; o link não é pessoal.'] : [];
      const base = { channel: input.channel, url: input.url, expiresAt: g.expiresAt };
      let out;
      if (input.channel === 'COPY_LINK') out = { ...base, warnings: warn };
      else if (input.channel === 'WHATSAPP') { const r = renderTemplate(input.template || TEMPLATES.WHATSAPP, vars, { allowRecipientName: !!input.allowRecipientName }); out = { ...base, message: r.text, actionUrl: 'https://wa.me/?text=' + encodeURIComponent(r.text), warnings: warn }; } // no phone, nothing sent
      else if (input.channel === 'EMAIL') { const r = renderTemplate(input.template || TEMPLATES.EMAIL, vars, { allowRecipientName: !!input.allowRecipientName }); out = { ...base, title: r.subject, message: r.text, actionUrl: 'mailto:?subject=' + encodeURIComponent(r.subject || '') + '&body=' + encodeURIComponent(r.text), warnings: warn }; }
      else if (input.channel === 'NATIVE_SHARE') { const r = renderTemplate(TEMPLATES.NATIVE_SHARE, vars); out = { ...base, title: `Apresentação ${org.name}`, message: r.text, fallback: 'COPY_LINK', warnings: warn }; }
      else if (input.channel === 'QR_CODE') out = { ...base, qrData: input.url, textAlternative: input.url, warnings: [...warn, QR_WARNING] };
      else return { ok: false, code: 'CHANNEL_NOT_ALLOWED' };
      ev(input.channel === 'COPY_LINK' ? 'share_created' : 'share_created', { shareGrantId: g.id, channel: input.channel }, ctx);
      return { ok: true, payload: freeze(out), journeyEvent: S.journeyEventFor(input.channel === 'COPY_LINK' ? 'LINK_COPIED' : 'DELIVERY_REQUESTED', g) }; // never "PRESENTATION_SHARED" from a payload alone
    }
    const markAsSent = (ctx, grantId) => { const g = grants.get(grantId); return g && g.organizationId === ctx.organizationId ? S.journeyEventFor('MARKED_AS_SENT', g) : null; };

    // ------------------------------------------------------------ safety dependencies (selective invalidation)
    function addDependency(shareGrantId, dependencyType, dependencyRef, requiredStatus) { deps.push(freeze({ shareGrantId, dependencyType, dependencyRef, requiredStatus })); }
    /** onDomainEvent: PresentationSnapshotRevoked · OrganizationSuspended/Reactivated · CustomerAccessChanged · SharePolicyArchived */
    function onDomainEvent(e = {}) {
      const affected = new Set();
      if (e.type === 'PresentationSnapshotRevoked' || e.type === 'PresentationSnapshotSafetyChanged') for (const d of deps) if (d.dependencyType === 'PRESENTATION_SNAPSHOT' && d.dependencyRef === e.snapshotId) affected.add(d.shareGrantId);
      if (e.type === 'OrganizationSuspended') { tenantInactive.add(e.organizationId); for (const d of deps) if (d.dependencyType === 'ORGANIZATION' && d.dependencyRef === e.organizationId) affected.add(d.shareGrantId); }
      if (e.type === 'OrganizationReactivated') tenantInactive.delete(e.organizationId);
      if (e.type === 'CustomerAccessChanged') for (const d of deps) if (d.dependencyType === 'CUSTOMER' && d.dependencyRef === e.customerId) { affected.add(d.shareGrantId); const g = grants.get(d.shareGrantId); if (g && g.lifecycleStatus === 'ACTIVE') grants.set(g.id, S.suspend(g)); }
      if (e.type === 'LotSnapshotRevoked') { safety.set(e.organizationId + '|' + e.snapshotId, 'REVOKED'); for (const g of grants.values()) if (g.resourceId === e.snapshotId) affected.add(g.id); }
      for (const id of affected) invalidate(id, 'REVOKED');
      return [...affected];
    }
    if (PM().domain && PM().domain.safety && PM().domain.safety.onChange) PM().domain.safety.onChange(onDomainEvent);

    // ------------------------------------------------------------ ShareSnapshotFactory: LotShareSnapshot (client-safe projection, immutable)
    function createLotSnapshot(ctx, lot, src = {}) {
      if (!S.can(ctx, 'share.create')) return { ok: false, code: 'FORBIDDEN' };
      const PJ = PM().projection, D = PM().domain; if (!PJ || !lot) return { ok: false, code: 'NOT_AVAILABLE' };
      const pctx = { policy: PM().policy.current(), priceTable: src.priceTable || null, commercialFreshness: (src.freshness || {}).commercial || 'UNKNOWN' };
      const card = PJ.lotCard(lot, pctx);
      const content = { identity: { lotRef: card.lotRef, label: card.identityLabel }, availability: card.availability, price: card.price, keyMetrics: ['geometry.areaM2', 'geometry.frontM', 'environmental.orientationFront', 'mobility.routeDistanceToLeisureM'].map(k => PJ.value(lot, k, pctx)).filter(Boolean),
        highlights: card.keyHighlights, alerts: card.clientSafeAlerts };
      const leaks = PM().policy.scanPayload(content); if (leaks.length) return { ok: false, code: 'REDACTION_ERROR', leaks };
      const pt = src.priceTable, versionRefs = { priceTableVersionId: pt ? `${pt.id}@${pt.version}` : null, analysisVersion: (lot.intelligence || {}).analysisVersion || null, clientSafePolicyVersion: pctx.policy.version, availabilityRevision: String(lot.availability.revision ?? '') };
      const generatedAt = iso(tick(ctx)), sum = D.checksum({ content, versionRefs });
      const snap = freeze({ id: S.opaque('lss'), organizationId: ctx.organizationId, lotId: lot.identity.id, developmentId: lot.identity.developmentId, content, versionRefs, generatedAt, checksum: sum });
      lotSnaps.set(snap.id, snap); safety.set(snap.organizationId + '|' + snap.id, 'SAFE');
      return { ok: true, snapshot: snap };
    }

    return Object.freeze({ issue, rotate, revoke, suspend, resume, changeExpiry, getGrant, listGrants, exchange, resource, asset, feedback, channelPayload, markAsSent, onDomainEvent, createLotSnapshot, canNativeShare,
      // inspection for tests/ops (no raw tokens anywhere)
      _store: () => ({ tokens: [...tokens.values()], grants: [...grants.values()], sessions: [...sessions.values()], records: records.slice(), events: events.slice(), audits: audits.slice(), revocations: revocations.slice(), deps: deps.slice() }) });
  }

  return Object.freeze({ createShareService, TEMPLATES, validateTemplate, renderTemplate, canNativeShare, QR_WARNING });
})();
