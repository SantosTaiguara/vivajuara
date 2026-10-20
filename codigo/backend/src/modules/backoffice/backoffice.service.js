'use strict';
/* Admin Application Service (topic 60 §138-160, §583-585). Every administrative mutation goes through ONE pipeline:
     authenticate (caller) → resolve tenant → authorize → policy (reason code, step-up, second approval) →
     domain handler: load resource → validate state → expectedRevision → (execute only) preview token + idempotency →
     apply DOMAIN command → audit → events → result.
   No generic "edit DB": an actionCode without a registered DomainCommandHandler is ACTION_NOT_SUPPORTED. Handlers of
   other modules (reservations, pricing, privacy, onboarding, data quality) register themselves with registerHandler();
   this module ships handlers only for what the admin layer owns (work assignment, versioned config, support sessions,
   emergency controls).
   DomainCommandHandler { actionCode, load({ resourceRef, organizationId, envelope }) → { exists, organizationId, revision, state },
     validate({ envelope, current, principal, now }) → { blockers[], warnings[], affectedEntities[], currentStateSummary, proposedStateSummary, requiredApprovals[] },
     apply({ envelope, current, principal, now }) → { newRevision, result, events[] } }
   Preview token: HMAC-SHA256(previewKey, commandHash|actor|org|expiresAt), short-lived; execute revalidates EVERYTHING
   anyway (§146) — the token only proves the user saw this exact preview. Without previewKey no preview can be issued
   (PREVIEW_UNAVAILABLE): fail closed. Step-up: no MFA mechanism exists yet → stepUpVerifier defaults to "not satisfied". */
const crypto = require('crypto');
const { E } = require('../../shared/http/errors');
const { CFG, ACTIONS, REASONS, RESOURCE_REF_RE, IDEMPOTENCY_KEY_RE, PII_RE, policyValue } = require('./backoffice.policy');
const { createAdminAuthz } = require('./backoffice.authz');

const sha256 = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
const canonical = v => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
const reject = (status, code, reasonCode, message, details = {}) => { const e = status === 403 ? E.forbidden(code, message) : status === 404 ? E.notFound(message, null, code) : status === 409 ? E.conflict(code, message) : status === 400 ? E.badRequest(message) : E.unprocessable(code, message); e.details = { reasonCode, ...details }; return e; };

function createBackofficeService({ repo, audit, now = () => Date.now(), previewKey = null, previewTtlSeconds = 300, roleGrants = {}, stepUpVerifier = () => false, env = process.env, configSchemas = {}, logger = null }) {
  const authz = createAdminAuthz({ roleGrants });
  const handlers = new Map();
  const metrics = { admin_command_total: 0, admin_command_failed_total: 0, support_session_total: 0, config_publish_total: 0, bulk_export_total: 0 }; // no user labels (§380)
  const events = []; // outbox projection (in memory; a real outbox table is a later phase)

  function registerHandler(h) {
    if (!h || !ACTIONS.has(h.actionCode) || typeof h.load !== 'function' || typeof h.validate !== 'function' || typeof h.apply !== 'function') throw new Error(`invalid DomainCommandHandler ${h && h.actionCode}`);
    handlers.set(h.actionCode, h); return h;
  }

  // ------------------------------------------------------------------ envelope validation (§139)
  function parseEnvelope(body) {
    const env = body && body.envelope;
    if (!env || typeof env !== 'object') throw reject(400, 'VALIDATION_ERROR', 'ENVELOPE_INVALID', 'Corpo deve conter { envelope }');
    const pol = ACTIONS.get(env.actionCode);
    if (!pol) throw reject(422, 'ADMIN_COMMAND_REJECTED', 'UNKNOWN_ACTION', 'Ação administrativa desconhecida (não há edição genérica de banco)');
    if (typeof env.organizationId !== 'string' || !/^org_[a-z0-9_]{1,60}$/.test(env.organizationId)) throw reject(400, 'VALIDATION_ERROR', 'TENANT_REQUIRED', 'organizationId obrigatório');
    if (typeof env.resourceRef !== 'string' || !RESOURCE_REF_RE.test(env.resourceRef) || PII_RE.test(env.resourceRef)) throw reject(400, 'VALIDATION_ERROR', 'RESOURCE_REF_INVALID', 'resourceRef inválido');
    if (pol.requiresExpectedRevision && (env.expectedRevision == null || env.expectedRevision === '')) throw reject(400, 'VALIDATION_ERROR', 'EXPECTED_REVISION_REQUIRED', 'expectedRevision obrigatório para esta ação');
    if (env.idempotencyKey != null && !IDEMPOTENCY_KEY_RE.test(env.idempotencyKey)) throw reject(400, 'VALIDATION_ERROR', 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey inválida');
    if (env.payload != null && (typeof env.payload !== 'object' || Array.isArray(env.payload))) throw reject(400, 'VALIDATION_ERROR', 'PAYLOAD_INVALID', 'payload deve ser objeto');
    let reason = null;
    if (env.reason && env.reason.code) {
      const def = REASONS.get(env.reason.code); if (!def) throw reject(400, 'VALIDATION_ERROR', 'REASON_INVALID', 'Código de motivo inválido');
      if (def.requiresText && !(typeof env.reason.text === 'string' && env.reason.text.trim())) throw reject(400, 'VALIDATION_ERROR', 'REASON_TEXT_REQUIRED', 'Descreva o motivo');
      reason = { code: def.code }; // free text is never persisted nor logged (§393)
    } else if (pol.requiresReason) throw reject(400, 'VALIDATION_ERROR', 'REASON_REQUIRED', 'Esta ação exige motivo');
    return { pol, env: Object.freeze({ commandId: String(env.commandId || crypto.randomUUID()).slice(0, 128), actionCode: pol.actionCode, organizationId: env.organizationId, resourceRef: env.resourceRef,
      expectedRevision: env.expectedRevision == null ? null : String(env.expectedRevision), idempotencyKey: env.idempotencyKey || null, reason, payload: env.payload || {}, approvalRef: env.approvalRef || null }) };
  }
  const commandHash = env => sha256(canonical({ a: env.actionCode, o: env.organizationId, r: env.resourceRef, x: env.expectedRevision, p: env.payload, rc: env.reason && env.reason.code, ap: env.approvalRef }));
  const actorOf = p => p.type === 'SYSTEM' ? p.id : p.userId || p.id;

  async function auditWrite(principal, env, outcome, requestId, extra = {}) {
    if (!audit) return;
    await audit.write({ actorId: principal.userId || null, actorType: principal.type, action: 'ADMIN_' + env.actionCode.toUpperCase().replace(/\./g, '_'), entityType: env.resourceRef.split(':')[0], entityId: env.resourceRef.split(':').slice(1).join(':'),
      organizationId: env.organizationId, outcome, requestId, newValue: { actionCode: env.actionCode, reasonCode: env.reason ? env.reason.code : null, expectedRevision: env.expectedRevision, ...extra } }); // minimized (§135)
  }

  // ------------------------------------------------------------------ shared gate: tenant → authorization → policy
  async function gate(principal, pol, env, requestId) {
    if (!principal || principal.type === 'ANONYMOUS') throw E.unauthorized();
    if (!authz.isMember(principal, env.organizationId)) { await auditWrite(principal, env, 'DENIED', requestId, { reason: 'TENANT_MISMATCH' }); throw reject(404, 'ORGANIZATION_NOT_FOUND', 'TENANT_MISMATCH', 'Organização não encontrada'); }
    for (const key of ['backoffice.access', pol.permission]) {
      const d = authz.decide(principal, key, env.organizationId, new Date(now()));
      if (d.effect !== 'ALLOW') {
        await auditWrite(principal, env, 'DENIED', requestId, { reason: d.reasons[0], permission: key });
        if (d.reasons[0] === 'TENANT_MISMATCH') throw reject(404, 'ORGANIZATION_NOT_FOUND', d.reasons[0], 'Organização não encontrada');
        throw reject(403, 'PERMISSION_DENIED', 'NOT_AUTHORIZED', 'Você não possui permissão para esta ação', { permission: key });
      }
    }
    if (pol.requiresStepUp && !stepUpVerifier(principal, pol)) throw reject(403, 'PERMISSION_DENIED', 'STEP_UP_REQUIRED', 'Esta ação exige reautenticação forte (não configurada neste ambiente)');
    if (pol.requiresSecondApproval !== false && !env.approvalRef) throw reject(403, 'PERMISSION_DENIED', 'SECOND_APPROVAL_REQUIRED', 'Esta ação exige aprovação de outra pessoa');
    const h = handlers.get(pol.actionCode);
    if (!h) throw reject(422, 'ADMIN_COMMAND_REJECTED', 'ACTION_NOT_SUPPORTED', 'Ação sem comando de domínio registrado neste servidor');
    const current = await h.load({ resourceRef: env.resourceRef, organizationId: env.organizationId, envelope: env });
    if (!current || !current.exists || current.organizationId !== env.organizationId) throw reject(404, 'NOT_FOUND', 'RESOURCE_NOT_FOUND', 'Recurso não encontrado');
    return { h, current };
  }
  const revisionConflict = (env, current) => { const e = E.conflict('REVISION_CONFLICT', 'O registro mudou desde que você abriu', { reasonCode: 'REVISION_CONFLICT', expectedRevision: env.expectedRevision, currentRevision: String(current.revision), diff: current.diff || [] }, { currentRevision: String(current.revision) }); return e; };

  // ------------------------------------------------------------------ preview (§142-145)
  async function preview(principal, body, { requestId } = {}) {
    const t0 = now();
    const { pol, env } = parseEnvelope(body);
    const { h, current } = await gate(principal, pol, env, requestId);
    if (env.expectedRevision != null && current.revision != null && String(current.revision) !== env.expectedRevision) throw revisionConflict(env, current);
    const v = await h.validate({ envelope: env, current, principal, now: now() });
    if (!previewKey) throw reject(422, 'ADMIN_COMMAND_REJECTED', 'PREVIEW_UNAVAILABLE', 'Prévia indisponível: chave de prévia não configurada no servidor');
    const expiresAt = new Date(now() + previewTtlSeconds * 1000).toISOString();
    const token = signPreview(env, actorOf(principal), expiresAt);
    return { actionCode: env.actionCode, allowed: !(v.blockers || []).length, warnings: v.warnings || [], blockers: v.blockers || [], affectedEntities: v.affectedEntities || [env.resourceRef],
      currentStateSummary: v.currentStateSummary ?? null, proposedStateSummary: v.proposedStateSummary ?? null, requiredApprovals: v.requiredApprovals || [], expectedRevision: current.revision == null ? null : String(current.revision),
      previewToken: token, expiresAt, auditLevel: pol.auditLevel, durationMs: now() - t0 };
  }
  function signPreview(env, actor, expiresAt) {
    const msg = `${commandHash(env)}|${actor}|${env.organizationId}|${expiresAt}`;
    return Buffer.from(expiresAt).toString('base64url') + '.' + crypto.createHmac('sha256', previewKey).update(msg).digest('base64url');
  }
  function verifyPreview(token, env, actor) {
    if (!previewKey || typeof token !== 'string' || !token.includes('.')) return 'PREVIEW_REQUIRED';
    const [b, sig] = token.split('.'); let expiresAt; try { expiresAt = Buffer.from(b, 'base64url').toString(); } catch (_) { return 'PREVIEW_MISMATCH'; }
    const want = crypto.createHmac('sha256', previewKey).update(`${commandHash(env)}|${actor}|${env.organizationId}|${expiresAt}`).digest('base64url');
    const a = Buffer.from(sig || ''), w = Buffer.from(want);
    if (a.length !== w.length || !crypto.timingSafeEqual(a, w)) return 'PREVIEW_MISMATCH';
    return Date.parse(expiresAt) > now() ? null : 'PREVIEW_EXPIRED';
  }

  // ------------------------------------------------------------------ execute (§140, §146, §150-151)
  async function execute(principal, body, { requestId } = {}) {
    metrics.admin_command_total++;
    try {
      const { pol, env } = parseEnvelope(body);
      if (!env.idempotencyKey) throw reject(400, 'VALIDATION_ERROR', 'IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey obrigatória em execute');
      const actor = actorOf(principal || {});
      const hash = commandHash(env);
      if (principal && principal.type !== 'ANONYMOUS') {
        const prev = await repo.commands.findByIdempotency(env.organizationId, actor, env.idempotencyKey);
        if (prev) { if (prev.requestHash !== hash) throw E.conflict('IDEMPOTENCY_KEY_REUSED', 'idempotencyKey já usada com outro comando'); if (prev.outcome === 'EXECUTED') return { ...prev.result, replayed: true }; }
      }
      const { h, current } = await gate(principal, pol, env, requestId); // re-authorize, re-load (never trust the preview)
      if (env.expectedRevision != null && current.revision != null && String(current.revision) !== env.expectedRevision) { await auditWrite(principal, env, 'FAILED', requestId, { reason: 'REVISION_CONFLICT' }); throw revisionConflict(env, current); }
      if (pol.requiresPreview) { const bad = verifyPreview(body.previewToken, env, actor); if (bad) throw reject(422, 'ADMIN_COMMAND_REJECTED', bad, bad === 'PREVIEW_EXPIRED' ? 'A prévia expirou' : 'Prévia ausente ou não corresponde ao comando'); }
      const v = await h.validate({ envelope: env, current, principal, now: now() });
      if ((v.blockers || []).length) { await auditWrite(principal, env, 'FAILED', requestId, { reason: 'BLOCKED', blockers: v.blockers }); throw reject(422, 'ADMIN_COMMAND_REJECTED', 'PREVIEW_BLOCKED', 'Estado atual impede a ação', { blockers: v.blockers }); }
      const r = await h.apply({ envelope: env, current, principal, now: now() });
      if (r && r.conflict) { const c = { ...current, revision: r.currentRevision }; throw revisionConflict(env, c); }
      const result = { commandId: env.commandId, actionCode: env.actionCode, outcome: 'EXECUTED', resourceRef: env.resourceRef, previousRevision: current.revision == null ? null : String(current.revision), newRevision: r.newRevision == null ? null : String(r.newRevision), result: r.result || null };
      await repo.commands.insert({ commandId: env.commandId, organizationId: env.organizationId, actionCode: env.actionCode, resourceRef: env.resourceRef, actorId: actor, actorType: principal.type, reasonCode: env.reason ? env.reason.code : null,
        expectedRevision: env.expectedRevision, newRevision: result.newRevision, approvalRef: env.approvalRef, idempotencyKey: env.idempotencyKey, requestHash: hash, outcome: 'EXECUTED', result, requestId: requestId || null });
      await auditWrite(principal, env, 'SUCCESS', requestId, { previousRevision: result.previousRevision, newRevision: result.newRevision, auditLevel: pol.auditLevel });
      for (const e of (r.events || [])) events.push({ ...e, organizationId: env.organizationId, at: new Date(now()).toISOString() });
      return result;
    } catch (e) { metrics.admin_command_failed_total++; throw e; }
  }

  // ------------------------------------------------------------------ read models
  /** navigation(principal, organizationId) — server-side mirror of AdminNavigationRegistry (deny by default) */
  function navigation(principal, organizationId) {
    if (!principal || principal.type === 'ANONYMOUS') throw E.unauthorized();
    if (!authz.isMember(principal, organizationId)) throw reject(404, 'ORGANIZATION_NOT_FOUND', 'TENANT_MISMATCH', 'Organização não encontrada');
    const ok = k => authz.decide(principal, k, organizationId).effect === 'ALLOW';
    return CFG.navigation.filter(i => i.requiredPermissions.every(ok)).map(i => ({ id: i.id, label: i.label, route: i.route, order: i.order, badgeSource: i.badgeSource || null }));
  }
  function requireView(principal, organizationId, key) {
    if (!principal || principal.type === 'ANONYMOUS') throw E.unauthorized();
    if (!authz.isMember(principal, organizationId)) throw reject(404, 'ORGANIZATION_NOT_FOUND', 'TENANT_MISMATCH', 'Organização não encontrada');
    for (const k of ['backoffice.access', key]) if (authz.decide(principal, k, organizationId).effect !== 'ALLOW') throw reject(403, 'PERMISSION_DENIED', 'NOT_AUTHORIZED', 'Você não possui permissão para esta área', { permission: k });
  }
  /** secretsStatus — names the backend reads; status only (configured/missing), never a value or a hint of it (§100-101) */
  function secretsStatus(principal, organizationId) {
    requireView(principal, organizationId, 'backoffice.integration.view');
    return CFG.secretNames.map(name => ({ name, status: typeof env[name] === 'string' && env[name].length > 0 ? 'CONFIGURED' : 'MISSING' }));
  }
  async function activeSupportSessions(principal, organizationId) {
    if (!principal || principal.type === 'ANONYMOUS') throw E.unauthorized();
    if (!authz.isMember(principal, organizationId)) throw reject(404, 'ORGANIZATION_NOT_FOUND', 'TENANT_MISMATCH', 'Organização não encontrada');
    return (await repo.support.active(organizationId, now())).map(s => ({ id: s.id, targetOrganizationId: s.targetOrganizationId, readOnly: s.readOnly, startedAt: s.startedAt, expiresAt: new Date(s.expiresAt).toISOString(), status: 'ACTIVE', banner: CFG.shell.supportBannerText }));
  }
  async function activeEmergencyControls(principal, organizationId) {
    requireView(principal, organizationId, 'backoffice.observability.view');
    return (await repo.emergency.active(organizationId, now())).map(c => ({ id: c.id, controlType: c.controlType, scopeRef: c.scopeRef, reasonCode: c.reason, activatedAt: c.activatedAt, expiresAt: new Date(c.expiresAt).toISOString(), status: 'ACTIVE' }));
  }
  /** isControlActive(org, type) — used by other modules (e.g. Share) to honor an emergency control */
  const isControlActive = async (org, type) => (await repo.emergency.active(org, now())).some(c => c.controlType === type);

  // ------------------------------------------------------------------ built-in handlers (admin-owned resources)
  const refId = ref => ref.split(':').slice(1).join(':');
  registerHandler({ actionCode: 'workitem.assign',
    async load({ resourceRef, organizationId }) { const cur = await repo.assignments.get(organizationId, refId(resourceRef)); return { exists: true, organizationId, revision: cur ? String(cur.revision) : null, state: cur }; },
    async validate({ envelope }) { const p = envelope.payload; return { blockers: !p.assignedToUserId && !p.assignedToTeamId ? ['ASSIGNEE_REQUIRED'] : [], warnings: ['ASSIGNMENT_IS_NOT_AUTHORIZATION'], affectedEntities: [envelope.resourceRef], proposedStateSummary: { status: 'ASSIGNED' } }; },
    async apply({ envelope, principal, current }) {
      const r = await repo.assignments.upsert({ organizationId: envelope.organizationId, workItemRef: refId(envelope.resourceRef), assignedToUserId: envelope.payload.assignedToUserId || null, assignedToTeamId: envelope.payload.assignedToTeamId || null, assignedBy: actorOf(principal), status: 'ASSIGNED' }, current.revision);
      return r.conflict ? r : { newRevision: r.revision, result: { status: 'ASSIGNED' }, events: [{ type: 'WorkItemAssigned', ref: envelope.resourceRef }] };
    } });

  // config.publish: resourceRef "config:<type>:<scope>", payload { changeId } (an APPROVED ConfigurationChange by someone else)
  const cfgKey = ref => { const [, type, ...scope] = ref.split(':'); return { type: (type || '').replace(/_/g, ' '), scope: scope.join(':') }; };
  const configLoad = async ({ resourceRef, organizationId }) => { const k = cfgKey(resourceRef); const cur = await repo.configs.current(organizationId, k.type, k.scope); return { exists: CFG.configCategories.includes(k.type), organizationId, revision: cur ? String(cur.revision) : null, state: cur, key: k }; };
  registerHandler({ actionCode: 'config.publish', load: configLoad,
    async validate({ envelope, current, principal }) {
      const blockers = [], ch = envelope.payload.changeId ? await repo.configs.getChange(envelope.payload.changeId) : null;
      if (!ch || ch.organizationId !== envelope.organizationId || ch.configType !== current.key.type || ch.scopeRef !== current.key.scope) blockers.push('CONFIG_CHANGE_NOT_FOUND');
      else {
        if (ch.status !== 'APPROVED') blockers.push('CONFIG_CHANGE_NOT_APPROVED');
        if (!ch.approvedBy || ch.approvedBy === ch.requestedBy) blockers.push('SEPARATION_OF_DUTIES');
        const schema = configSchemas[current.key.type];
        if (typeof schema !== 'function') blockers.push('CONFIG_SCHEMA_MISSING'); else { const errs = schema(ch.proposedContent) || []; if (errs.length) blockers.push('CONFIG_SCHEMA_INVALID'); }
      }
      return { blockers, warnings: [], affectedEntities: [envelope.resourceRef], currentStateSummary: current.state ? { version: current.state.version } : null, proposedStateSummary: { version: current.state ? current.state.version + 1 : 1 }, change: ch, actor: actorOf(principal) };
    },
    async apply({ envelope, current, principal }) {
      const ch = await repo.configs.getChange(envelope.payload.changeId);
      const r = await repo.configs.publish({ org: envelope.organizationId, type: current.key.type, scope: current.key.scope, content: ch.proposedContent, contentHash: sha256(canonical(ch.proposedContent)), changeRef: ch.id, publishedBy: actorOf(principal), expectedRevision: current.revision, at: new Date(now()).toISOString() });
      if (r.conflict) return r;
      await repo.configs.markChange(ch.id, 'PUBLISHED'); metrics.config_publish_total++;
      return { newRevision: r.revision, result: { version: r.version }, events: [{ type: 'ConfigurationPublished', ref: envelope.resourceRef, version: r.version }, { type: 'ReleaseMarker', ref: envelope.resourceRef }] };
    } });
  // config.rollback: payload { targetVersion } → new version restoring old content (never overwrites)
  registerHandler({ actionCode: 'config.rollback', load: configLoad,
    async validate({ envelope, current }) {
      const vs = current.state ? await repo.configs.versions(envelope.organizationId, current.key.type, current.key.scope) : [];
      const tgt = vs.find(v => v.version === Number(envelope.payload.targetVersion));
      const blockers = !current.state ? ['NOTHING_TO_ROLLBACK'] : !tgt ? ['ROLLBACK_TARGET_NOT_FOUND'] : tgt.version === current.state.version ? ['ROLLBACK_SAME_VERSION'] : [];
      return { blockers, warnings: ['DYNAMIC_DOMAINS_NOT_ROLLED_BACK'], affectedEntities: [envelope.resourceRef], currentStateSummary: current.state ? { version: current.state.version } : null, proposedStateSummary: tgt ? { restoresVersion: tgt.version } : null };
    },
    async apply({ envelope, current, principal }) {
      const vs = await repo.configs.versions(envelope.organizationId, current.key.type, current.key.scope), tgt = vs.find(v => v.version === Number(envelope.payload.targetVersion));
      const r = await repo.configs.publish({ org: envelope.organizationId, type: current.key.type, scope: current.key.scope, content: tgt.content, contentHash: sha256(canonical(tgt.content)), restoresVersion: tgt.version, publishedBy: actorOf(principal), expectedRevision: current.revision, at: new Date(now()).toISOString() });
      return r.conflict ? r : { newRevision: r.revision, result: { version: r.version, restoresVersion: tgt.version }, events: [{ type: 'ConfigurationRolledBack', ref: envelope.resourceRef }] };
    } });
  // support_session.start: resourceRef "organization:<orgId>", payload { minutes, targetUserId?, approvedBy, readOnly }
  registerHandler({ actionCode: 'support_session.start',
    async load({ resourceRef, organizationId }) { return { exists: refId(resourceRef) === organizationId, organizationId, revision: null, state: null }; },
    async validate({ envelope, principal }) {
      const max = policyValue('supportSessionMaxMinutes'), p = envelope.payload, blockers = [];
      if (max == null) blockers.push('SUPPORT_POLICY_NOT_CONFIGURED');
      else if (!Number.isInteger(p.minutes) || p.minutes < 1 || p.minutes > max) blockers.push('SUPPORT_DURATION_INVALID');
      if (policyValue('supportSessionRequiresApproval') !== false && (!p.approvedBy || p.approvedBy === actorOf(principal))) blockers.push('SUPPORT_APPROVAL_REQUIRED');
      if (p.readOnly === false) blockers.push('SUPPORT_WRITE_NOT_ALLOWED');
      return { blockers, warnings: ['SUPPORT_ACCESS_AUDITED'], affectedEntities: [envelope.resourceRef], proposedStateSummary: { readOnly: true, minutes: p.minutes } };
    },
    async apply({ envelope, principal }) {
      const t = now(), s = await repo.support.insert({ supportUserId: actorOf(principal), targetOrganizationId: envelope.organizationId, targetUserId: envelope.payload.targetUserId || null, reason: envelope.reason.code,
        startedAt: new Date(t).toISOString(), expiresAt: t + envelope.payload.minutes * 60000, readOnly: true, approvedBy: envelope.payload.approvedBy, status: 'ACTIVE' });
      metrics.support_session_total++;
      return { newRevision: null, result: { supportSessionId: s.id, expiresAt: new Date(s.expiresAt).toISOString(), banner: CFG.shell.supportBannerText }, events: [{ type: 'SupportSessionStarted', ref: envelope.resourceRef }] };
    } });
  registerHandler({ actionCode: 'support_session.end',
    async load({ resourceRef, organizationId }) { const s = await repo.support.get(refId(resourceRef)); return { exists: !!s, organizationId: s ? s.targetOrganizationId : null, revision: null, state: s }; },
    async validate({ current }) { return { blockers: current.state.status !== 'ACTIVE' ? ['SUPPORT_SESSION_NOT_ACTIVE'] : [], warnings: [] }; },
    async apply({ envelope }) { await repo.support.end(refId(envelope.resourceRef), 'REVOKED'); return { result: { status: 'REVOKED' }, events: [{ type: 'SupportSessionEnded', ref: envelope.resourceRef }] }; } });
  // emergency.activate: resourceRef "organization:<orgId>", payload { controlType, scopeRef, expiresAt }
  const EMERGENCY = ['DISABLE_PUBLIC_SHARE', 'DISABLE_RESERVATION_WRITES', 'DISABLE_EXTERNAL_SYNC', 'FORCE_LOGOUT_TENANT'];
  registerHandler({ actionCode: 'emergency.activate',
    async load({ resourceRef, organizationId }) { return { exists: refId(resourceRef) === organizationId, organizationId, revision: null, state: null }; },
    async validate({ envelope }) {
      const p = envelope.payload, blockers = [], exp = Date.parse(p.expiresAt || ''), max = policyValue('emergencyControlMaxHours');
      if (!EMERGENCY.includes(p.controlType)) blockers.push('EMERGENCY_TYPE_UNKNOWN');
      if (!Number.isFinite(exp)) blockers.push('EMERGENCY_EXPIRY_REQUIRED'); else if (exp <= now()) blockers.push('EMERGENCY_EXPIRY_INVALID'); else if (max != null && exp - now() > max * 3600e3) blockers.push('EMERGENCY_EXPIRY_TOO_LONG');
      if (await isControlActive(envelope.organizationId, p.controlType)) blockers.push('EMERGENCY_ALREADY_ACTIVE');
      return { blockers, warnings: p.controlType === 'DISABLE_PUBLIC_SHARE' ? ['PUBLIC_SHARE_LINKS_STOP_WORKING', 'INTERNAL_APP_STAYS_ACTIVE'] : [], affectedEntities: [envelope.resourceRef], proposedStateSummary: { controlType: p.controlType, status: 'ACTIVE' } };
    },
    async apply({ envelope, principal }) {
      const c = await repo.emergency.insert({ organizationId: envelope.organizationId, controlType: envelope.payload.controlType, scopeRef: envelope.payload.scopeRef || envelope.resourceRef, reason: envelope.reason.code, activatedBy: actorOf(principal), activatedAt: new Date(now()).toISOString(), expiresAt: Date.parse(envelope.payload.expiresAt), status: 'ACTIVE' });
      return { result: { emergencyControlId: c.id, status: 'ACTIVE' }, events: [{ type: 'EmergencyControlActivated', ref: envelope.resourceRef, controlType: c.controlType }] };
    } });
  registerHandler({ actionCode: 'emergency.release',
    async load({ resourceRef }) { const c = await repo.emergency.get(refId(resourceRef)); return { exists: !!c, organizationId: c ? c.organizationId : null, revision: c ? c.status : null, state: c }; },
    async validate({ current }) { return { blockers: current.state.status !== 'ACTIVE' ? ['EMERGENCY_NOT_ACTIVE'] : [], warnings: [] }; },
    async apply({ envelope, principal }) { const ok = await repo.emergency.release(refId(envelope.resourceRef), actorOf(principal), new Date(now()).toISOString()); return ok ? { newRevision: 'RELEASED', result: { status: 'RELEASED' }, events: [{ type: 'EmergencyControlReleased', ref: envelope.resourceRef }] } : { conflict: true, currentRevision: 'RELEASED' }; } });

  return { preview, execute, registerHandler, handlers: () => [...handlers.keys()].sort(), navigation, secretsStatus, activeSupportSessions, activeEmergencyControls, isControlActive, metrics: () => ({ ...metrics }), events: () => events.slice(), authz, commandHash };
}

module.exports = { createBackofficeService, canonical };
