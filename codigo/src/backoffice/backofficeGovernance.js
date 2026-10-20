/* backoffice/backofficeGovernance.js — App.backoffice.governance (topic 60): pure, DB-free domain rules the console uses.
   - ConfigurationChange (§119-123, §231-236): versioned, diff mandatory, published versions immutable, rollback = new version;
   - ChangeSet / diff with masking of sensitive values (§449-451);
   - FeatureFlagDefinition governance (§124-129): owner/scope/purpose/sunset, high-risk flags restricted;
   - SupportSession (§93-97, §404): formal, time-bound, read-only by default, banner, audited, auto-expires;
   - EmergencyControl (§292-297): reason, actor, scope, start, expiry — never indefinite;
   - Export (§176-183, §405): preview (rows/fields/filters/classification), reason, CSV formula-injection sanitizing;
   - Secret display (§100-101): configured / missing / expiring only;
   - Jobs (§112-116): retry only for retry-safe jobs; replay needs preview + reason + idempotency analysis;
   - AccessChangePreview (§88-90), AvailabilityOverrideRequest (§50-52), DataRepairCommand (§269-272), AuditEventView (§131-136);
   - admin search scope + URL safety (§165-170, §330-334, §517-518).
   Nothing here mutates domain state: results are proposals that go through App.backoffice.commands. */
(() => {
  const B = App.backoffice, C = () => App.backofficeConfig;
  const nowMs = n => n == null ? Date.now() : (typeof n === 'number' ? n : new Date(n).getTime());
  const iso = n => new Date(nowMs(n)).toISOString();
  const fail = (code, message, extra = {}) => Object.freeze({ ok: false, code, message, ...extra });
  const SENSITIVE_KEY = /(secret|token|password|senha|apikey|api_key|pepper|private|cpf|email|e-mail|phone|telefone|credential|database_url)/i;

  // ------------------------------------------------------------------ ChangeSet / diff
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  /** diff(before, after, { mask }) → [{ field, before, after, masked }] sorted by field; deep, dotted paths */
  function diff(before, after, opts = {}, prefix = '', out = []) {
    const keys = new Set([...Object.keys(isObj(before) ? before : {}), ...Object.keys(isObj(after) ? after : {})]);
    for (const k of [...keys].sort()) {
      const f = prefix ? `${prefix}.${k}` : k, a = isObj(before) ? before[k] : undefined, b = isObj(after) ? after[k] : undefined;
      if (isObj(a) && isObj(b)) { diff(a, b, opts, f, out); continue; }
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      const masked = opts.mask !== false && (SENSITIVE_KEY.test(k) || (opts.sensitiveFields || []).includes(f));
      out.push(Object.freeze({ field: f, before: masked ? (a === undefined ? null : '••••') : (a === undefined ? null : a), after: masked ? (b === undefined ? null : '••••') : (b === undefined ? null : b), masked }));
    }
    return out;
  }
  const changeSet = ({ id, domain, resourceRef, fromVersion = null, toVersion = null, before, after, createdBy, now, sensitiveFields }) =>
    Object.freeze({ id: id || `cs_${nowMs(now).toString(36)}`, domain, resourceRef, fromVersion, toVersion, changes: Object.freeze(diff(before, after, { sensitiveFields })), createdBy, createdAt: iso(now) });

  // ------------------------------------------------------------------ ConfigurationChange state machine
  const CONFIG_STATUS = Object.freeze({ DRAFT: 'DRAFT', REVIEW: 'REVIEW', APPROVED: 'APPROVED', PUBLISHED: 'PUBLISHED', REJECTED: 'REJECTED', ROLLED_BACK: 'ROLLED_BACK' });
  const CONFIG_TRANSITIONS = Object.freeze({ DRAFT: ['REVIEW'], REVIEW: ['APPROVED', 'REJECTED', 'DRAFT'], APPROVED: ['PUBLISHED', 'REJECTED'], PUBLISHED: ['ROLLED_BACK'], REJECTED: [], ROLLED_BACK: [] });
  // review kind per config type (§350-354): who must look before publishing
  const REVIEW_KIND = Object.freeze({ 'Field Registry': 'TECHNICAL_IMPACT_ANALYSIS', 'Layer Registry': 'MAP_PREVIEW', 'Scoring Config': 'SHADOW_TEST', 'Privacy Policies': 'LEGAL_REVIEW', 'Workflow Policies': 'BUSINESS_REVIEW', 'Feature Flags': 'OWNER_REVIEW' });
  /** proposeConfigChange({ configType, scopeRef, currentVersion, current, proposed, requestedBy, schema? }) → ConfigurationChange (DRAFT) */
  function proposeConfigChange(o = {}) {
    if (!C().configCategories.includes(o.configType)) return fail('CONFIG_TYPE_UNKNOWN', 'Tipo de configuração desconhecido.');
    if (!o.scopeRef || !o.requestedBy) return fail('CONFIG_CHANGE_INVALID', 'Escopo e solicitante são obrigatórios.');
    if (typeof o.schema === 'function') { const errs = o.schema(o.proposed) || []; if (errs.length) return fail('CONFIG_SCHEMA_INVALID', 'Configuração não passa na validação de schema; não pode ser publicada.', { errors: errs }); } // §230-233
    else if (o.schema !== null) return fail('CONFIG_SCHEMA_MISSING', 'Sem schema de validação: configuração livre não pode ser publicada (§581).');
    const changes = diff(o.current, o.proposed);
    if (!changes.length) return fail('CONFIG_NO_CHANGES', 'Nenhuma diferença em relação à versão atual.');
    const cur = String(o.currentVersion || '0'), next = String(Number.isFinite(+cur) ? +cur + 1 : cur + '.1');
    return Object.freeze({ ok: true, change: Object.freeze({ id: o.id || `cfgchg_${nowMs(o.now).toString(36)}`, configType: o.configType, scopeRef: o.scopeRef, currentVersion: cur, proposedVersion: next,
      diffRef: `diff:${cur}->${next}`, diff: Object.freeze(changes), requestedBy: o.requestedBy, approvalRef: null, status: CONFIG_STATUS.DRAFT, reviewKind: REVIEW_KIND[o.configType] || 'STANDARD_REVIEW', createdAt: iso(o.now) }) });
  }
  /** transitionConfig(change, to, { actorId, approvalRef }) — SoD: the requester never approves its own change */
  function transitionConfig(change, to, o = {}) {
    if (!change || !CONFIG_TRANSITIONS[change.status]) return fail('CONFIG_CHANGE_INVALID', 'Mudança inválida.');
    if (!CONFIG_TRANSITIONS[change.status].includes(to)) return fail('INVALID_CONFIG_TRANSITION', `Transição ${change.status} → ${to} não permitida.`, { from: change.status, to });
    if (to === 'APPROVED' && B.approvals.separationOfDuties() && o.actorId === change.requestedBy) return fail('SELF_APPROVAL_FORBIDDEN', B.ERR.SELF_APPROVAL_FORBIDDEN);
    if (to === 'PUBLISHED' && !change.approvalRef && !o.approvalRef) return fail('APPROVAL_REQUIRED', 'Publicação exige aprovação registrada.');
    return Object.freeze({ ok: true, change: Object.freeze({ ...change, status: to, approvalRef: o.approvalRef || change.approvalRef, updatedAt: iso(o.now) }) });
  }
  /** editPublished — published versions are immutable (§123/454): always refused, the UI offers "Criar nova versão" */
  const editPublished = () => fail('PUBLISHED_VERSION_IMMUTABLE', 'Versão publicada não pode ser editada.', { action: 'Criar nova versão' });
  /** rollbackPlan(versions[], targetVersion) — restore creates a NEW current version pointing to old content (§455) */
  function rollbackPlan(versions, targetVersion, o = {}) {
    const cur = (versions || []).find(v => v.current), tgt = (versions || []).find(v => String(v.version) === String(targetVersion));
    if (!cur || !tgt) return fail('ROLLBACK_TARGET_NOT_FOUND', 'Versão alvo inexistente.');
    if (tgt === cur) return fail('ROLLBACK_SAME_VERSION', 'A versão alvo já é a atual.');
    if (tgt.rollbackSafe === false) return fail('ROLLBACK_NOT_SUPPORTED', 'Reversão não suportada para esta versão.');
    const max = Math.max(...versions.map(v => +v.version).filter(Number.isFinite));
    return Object.freeze({ ok: true, fromVersion: String(cur.version), restoresContentOf: String(tgt.version), newVersion: String(Number.isFinite(max) ? max + 1 : `${tgt.version}-restore`),
      diff: Object.freeze(diff(cur.content, tgt.content)), dynamicDomainsUntouched: ['availability', 'reservations', 'proposals'], createdAt: iso(o.now) });
  }
  /** impactAnalysis shape (§349) — computed by the server; the client only validates that one exists before publish */
  const impactRequired = configType => ['Field Registry', 'Scoring Config', 'Layer Registry'].includes(configType);

  // ------------------------------------------------------------------ Feature flags (§124-129)
  const FLAG_SCOPES = ['GLOBAL', 'ORGANIZATION', 'DEVELOPMENT', 'USER'];
  /** reviewFlag(def, now) → { ok, errors[], warnings[] } */
  function reviewFlag(def = {}, now) {
    const errors = [], warnings = [];
    if (!def.id) errors.push('FLAG_ID_MISSING');
    if (!FLAG_SCOPES.includes(def.scope)) errors.push('FLAG_SCOPE_INVALID');
    if (!def.owner) errors.push('FLAG_OWNER_MISSING');
    if (!def.purpose) errors.push('FLAG_PURPOSE_MISSING');
    if (!def.riskLevel) errors.push('FLAG_RISK_MISSING');
    if (def.migration && !def.expiresAt) errors.push('MIGRATION_FLAG_WITHOUT_SUNSET'); // §129
    if (!def.expiresAt) warnings.push('FLAG_WITHOUT_SUNSET');
    else if (nowMs(def.expiresAt) <= nowMs(now)) warnings.push('FLAG_EXPIRED');
    else { const d = C().policies.featureFlagSunsetWarningDays.value; if (d != null && nowMs(def.expiresAt) - nowMs(now) <= d * 864e5) warnings.push('FLAG_SUNSET_SOON'); }
    return Object.freeze({ ok: !errors.length, errors, warnings, requiresRestrictedPermission: ['HIGH', 'CRITICAL'].includes(def.riskLevel) });
  }

  // ------------------------------------------------------------------ SupportSession
  const SUPPORT_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', EXPIRED: 'EXPIRED', REVOKED: 'REVOKED' });
  /** validateSupportRequest({ supportUserId, targetOrganizationId, targetUserId?, reason, minutes, readOnly, approvedBy }) */
  function validateSupportRequest(r = {}) {
    const max = C().policies.supportSessionMaxMinutes.value;
    if (max == null) return fail('SUPPORT_POLICY_NOT_CONFIGURED', 'Duração máxima de sessão de suporte não configurada (necessita confirmação).');
    if (!r.supportUserId || !r.targetOrganizationId) return fail('SUPPORT_SESSION_INVALID', 'Suporte e organização alvo são obrigatórios.');
    if (!r.reason || !r.reason.code) return fail('REASON_REQUIRED', 'Informe o motivo.');
    if (!Number.isFinite(r.minutes) || r.minutes <= 0 || r.minutes > max) return fail('SUPPORT_DURATION_INVALID', `Duração deve ser de 1 a ${max} minutos.`);
    const needApproval = C().policies.supportSessionRequiresApproval.value !== false; // null → requires
    if (needApproval && (!r.approvedBy || r.approvedBy === r.supportUserId)) return fail('SUPPORT_APPROVAL_REQUIRED', 'Sessão de suporte exige aprovação de outra pessoa.');
    if (r.readOnly === false && !r.writeJustified) return fail('SUPPORT_WRITE_NOT_ALLOWED', 'Sessão de suporte é somente leitura por padrão.');
    return Object.freeze({ ok: true });
  }
  /** supportState(session, now) → effective status (auto-expiry) */
  function supportState(s, now) {
    if (!s) return null;
    const status = s.status === 'REVOKED' ? 'REVOKED' : nowMs(s.expiresAt) <= nowMs(now) ? 'EXPIRED' : s.status;
    return Object.freeze({ ...s, status, active: status === 'ACTIVE', remainingMs: status === 'ACTIVE' ? nowMs(s.expiresAt) - nowMs(now) : 0 });
  }
  /** supportBanner(session, now) → banner model or null — no invisible impersonation (§96) */
  function supportBanner(s, now) {
    const st = supportState(s, now); if (!st || !st.active) return null;
    return Object.freeze({ text: C().shell.supportBannerText, readOnly: st.readOnly !== false, expiresAt: st.expiresAt, targetOrganizationId: st.targetOrganizationId, audited: true,
      detail: `${st.readOnly !== false ? 'Somente leitura' : 'Com escrita autorizada'} · expira ${new Date(st.expiresAt).toISOString().slice(11, 16)} UTC · todo acesso é auditado` });
  }

  // ------------------------------------------------------------------ EmergencyControl
  const EMERGENCY_TYPES = Object.freeze({ DISABLE_PUBLIC_SHARE: 'Desativar compartilhamento público', DISABLE_RESERVATION_WRITES: 'Desativar escritas de reserva', DISABLE_EXTERNAL_SYNC: 'Desativar sincronização externa', FORCE_LOGOUT_TENANT: 'Forçar logout da organização' });
  function validateEmergency(r = {}, now) {
    if (!EMERGENCY_TYPES[r.controlType]) return fail('EMERGENCY_TYPE_UNKNOWN', 'Controle de emergência desconhecido.');
    if (!r.scopeRef) return fail('EMERGENCY_SCOPE_REQUIRED', 'Informe o escopo.');
    if (!r.reason || !r.reason.code) return fail('REASON_REQUIRED', 'Informe o motivo.');
    if (!r.expiresAt) return fail('EMERGENCY_EXPIRY_REQUIRED', 'Controle de emergência não pode ser indefinido (§296).');
    if (nowMs(r.expiresAt) <= nowMs(now)) return fail('EMERGENCY_EXPIRY_INVALID', 'A expiração deve ser futura.');
    const max = C().policies.emergencyControlMaxHours.value;
    if (max != null && nowMs(r.expiresAt) - nowMs(now) > max * 36e5) return fail('EMERGENCY_EXPIRY_TOO_LONG', `Máximo de ${max} h.`);
    return Object.freeze({ ok: true, effect: r.controlType === 'DISABLE_PUBLIC_SHARE' ? { publicShare: 'DISABLED', internalApp: 'ACTIVE' } : { [r.controlType]: 'ACTIVE' } });
  }
  const emergencyState = (c, now) => c ? Object.freeze({ ...c, status: c.status === 'RELEASED' || (c.expiresAt && nowMs(c.expiresAt) <= nowMs(now)) ? 'RELEASED' : 'ACTIVE' }) : null;

  // ------------------------------------------------------------------ Export
  const CLASS_ORDER = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };
  /** exportPreview({ domain, rows, fields:[{key, classification}], filters }) → preview (rows count, fields, filters, classification) */
  function exportPreview(o = {}) {
    if (!Number.isInteger(o.rows) || o.rows < 0) return fail('EXPORT_INVALID', 'Contagem de linhas inválida.');
    const fields = (o.fields || []).map(f => ({ key: f.key, classification: CLASS_ORDER[f.classification] != null ? f.classification : 'RESTRICTED' })); // unknown → most restrictive
    const top = fields.reduce((m, f) => CLASS_ORDER[f.classification] > CLASS_ORDER[m] ? f.classification : m, 'PUBLIC');
    return Object.freeze({ ok: true, domain: o.domain, rows: o.rows, fields, filters: (o.filters || []).slice(), privacyClassification: top,
      requiresReason: CLASS_ORDER[top] >= CLASS_ORDER.CONFIDENTIAL || o.rows > 0 && o.bulk === true, auditRequired: CLASS_ORDER[top] >= CLASS_ORDER.CONFIDENTIAL,
      linkTtlPolicy: C().policies.exportLinkTtlMinutes.value == null ? C().PENDING : C().policies.exportLinkTtlMinutes.value, serverSide: CLASS_ORDER[top] >= CLASS_ORDER.CONFIDENTIAL });
  }
  /** csvCell(v) — formula-injection safe (§180): leading = + - @ tab CR are prefixed with ' ; quotes escaped */
  function csvCell(v) {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  const csv = (header, rows) => [header.map(csvCell).join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n');

  // ------------------------------------------------------------------ secrets / integrations
  const SECRET_STATUS = Object.freeze({ CONFIGURED: 'configurado', MISSING: 'ausente', EXPIRING: 'expirando' });
  /** secretsView(serverList) — keeps only { name, status }; anything else (a value!) is discarded */
  function secretsView(list) {
    const allowed = new Set(C().secretNames), out = [];
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || !allowed.has(s.name)) continue;
      const st = ['CONFIGURED', 'MISSING', 'EXPIRING'].includes(s.status) ? s.status : 'MISSING';
      out.push(Object.freeze({ name: s.name, status: st, label: SECRET_STATUS[st] }));
    }
    for (const n of C().secretNames) if (!out.some(x => x.name === n)) out.push(Object.freeze({ name: n, status: 'UNKNOWN', label: 'não disponível' }));
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const INTEGRATION_STATUS = ['HEALTHY', 'DEGRADED', 'FAILED', 'DISABLED'];
  const integrationHealth = h => h && INTEGRATION_STATUS.includes(h.status) ? Object.freeze({ integrationId: h.integrationId, status: h.status, lastSuccessfulSyncAt: h.lastSuccessfulSyncAt || null,
    lastFailureAt: h.lastFailureAt || null, errorCode: h.errorCode || null, freshness: h.freshness || null, authorityMode: h.authorityMode || 'não disponível', syncWinsWithoutPolicy: false }) : null;

  // ------------------------------------------------------------------ jobs
  /** jobActions(job) → { retry, replay } availability (§113-116) */
  function jobActions(job = {}) {
    const retry = job.retrySafe === true || job.idempotent === true;
    return Object.freeze({
      retry: Object.freeze({ visible: retry && ['FAILED', 'DEAD_LETTER'].includes(job.status), reason: retry ? null : 'JOB_NOT_RETRY_SAFE' }),
      replay: Object.freeze({ visible: job.status === 'DEAD_LETTER' && job.idempotencyAnalysis === 'SAFE', reason: job.status !== 'DEAD_LETTER' ? 'NOT_IN_DLQ' : job.idempotencyAnalysis === 'SAFE' ? null : 'UNSAFE_REPLAY_BLOCKED', requiresPreview: true, requiresReason: true })
    });
  }

  // ------------------------------------------------------------------ access changes (§88-91)
  /** accessChangePreview(userId, currentPermissions[], proposedPermissions[], scopes[]) → AccessChangePreview */
  function accessChangePreview(userId, cur = [], next = [], scopes = []) {
    const P = App.permissions, a = new Set(cur), b = new Set(next);
    const unknown = [...b].filter(k => !P.has(k));
    if (unknown.length) return fail('UNKNOWN_PERMISSION', 'Permissão inexistente no registro.', { unknown });
    const added = [...b].filter(k => !a.has(k)).sort(), removed = [...a].filter(k => !b.has(k)).sort();
    const high = added.filter(k => ['HIGH', 'CRITICAL'].includes(P.riskOf(k)) || P.get(k).systemOnly);
    return Object.freeze({ ok: true, userId, addedPermissions: added, removedPermissions: removed, newHighRiskPermissions: high, affectedScopes: scopes.slice(),
      effectiveCapabilities: [...b].sort(), requiresApproval: high.length > 0, systemOnlyBlocked: added.some(k => P.get(k).systemOnly) });
  }

  // ------------------------------------------------------------------ availability override (§50-52, §458)
  function validateOverride(r = {}, now) {
    if (!r.lotId) return fail('LOT_REQUIRED', 'Informe o lote.');
    if (!r.requestedStatus) return fail('STATUS_REQUIRED', 'Informe o status pretendido.');
    if (!r.reason || !r.reason.code) return fail('REASON_REQUIRED', 'Override manual exige motivo.');
    if (r.expectedRevision == null || r.expectedRevision === '') return fail('EXPECTED_REVISION_REQUIRED', 'Override manual exige a revisão atual (nunca um simples dropdown).');
    if (r.expiresAt && nowMs(r.expiresAt) <= nowMs(now)) return fail('OVERRIDE_EXPIRY_INVALID', 'A expiração do override deve ser futura.');
    if (App.availability && App.availability.STATUS && !Object.prototype.hasOwnProperty.call(App.availability.STATUS, r.requestedStatus)) return fail('STATUS_INVALID', 'Status desconhecido.');
    return Object.freeze({ ok: true, request: Object.freeze({ lotId: r.lotId, requestedStatus: r.requestedStatus, reason: r.reason, expectedRevision: String(r.expectedRevision), expiresAt: r.expiresAt || null, requestedBy: r.requestedBy || null, approvalRef: r.approvalRef || null }) });
  }
  const overrideWarning = (ov, now) => ov && ov.expiresAt && nowMs(ov.expiresAt) > nowMs(now) ? `Override manual ativo até ${new Date(ov.expiresAt).toISOString().slice(11, 16)} UTC` : ov && !ov.expiresAt ? 'Override manual ativo (sem expiração)' : null;

  // ------------------------------------------------------------------ data repair (§267-276)
  function validateRepair(r = {}) {
    if (!r.repairType || !r.targetRef) return fail('REPAIR_INVALID', 'Tipo e alvo do reparo são obrigatórios.');
    if (!r.reason || !r.reason.code) return fail('REASON_REQUIRED', 'Reparo exige motivo.');
    if (!Array.isArray(r.sourceEvidenceRefs) || !r.sourceEvidenceRefs.length) return fail('EVIDENCE_REQUIRED', 'Reparo exige evidência de origem.');
    if (r.mode !== 'DRY_RUN' && !r.dryRunRef) return fail('DRY_RUN_REQUIRED', 'Execute o dry-run antes do reparo.');
    return Object.freeze({ ok: true, kind: r.derived ? 'REBUILD_DERIVED' : 'MUTATE_SOURCE' });
  }

  // ------------------------------------------------------------------ audit view (read-only, minimal)
  const AUDIT_FIELDS = ['id', 'action', 'permissionKey', 'resourceType', 'resourceId', 'organizationId', 'developmentId', 'timestamp', 'outcome', 'reasonCode', 'requestId', 'actorPrincipalType'];
  /** auditView(events, { actor?, domain?, action?, resource?, from?, to?, severity? }) → read-only projection (no metadata/before/after) */
  function auditView(events, f = {}) {
    return (events || []).filter(e => (!f.action || e.action === f.action) && (!f.resource || e.resourceType === f.resource) && (!f.actor || e.actorUserId === f.actor)
      && (!f.from || e.timestamp >= f.from) && (!f.to || e.timestamp <= f.to) && (!f.domain || String(e.action || '').startsWith(f.domain)))
      .map(e => Object.freeze(Object.fromEntries(AUDIT_FIELDS.map(k => [k, e[k] == null ? null : e[k]]))));
  }

  // ------------------------------------------------------------------ search & URL safety
  const SEARCH_CATEGORIES = ['lot', 'customer', 'proposal', 'reservation', 'closing', 'document', 'user', 'batch', 'publication'];
  /** searchRequest(term, { category, organizationId }) → { ok, request, persistInUrl } — sensitive terms never go to the URL */
  function searchRequest(term, o = {}) {
    if (!o.organizationId) return fail('SEARCH_SCOPE_REQUIRED', 'Busca administrativa exige organização (§165).');
    if (o.crossTenant) return fail('CROSS_TENANT_SEARCH_DENIED', 'Busca entre organizações é proibida por padrão.');
    if (o.category && !SEARCH_CATEGORIES.includes(o.category)) return fail('SEARCH_CATEGORY_INVALID', 'Categoria inválida.');
    const t = String(term || '').trim().slice(0, 120), sensitive = B.PII_RE.test(t);
    return Object.freeze({ ok: true, request: Object.freeze({ method: 'POST', body: { term: t, category: o.category || null, organizationId: o.organizationId } }), persistInUrl: false, sensitive, auditRequired: sensitive });
  }
  /** safeAdminRoute(route) — deep links carry safe ids only (no PII, no free text) */
  const safeAdminRoute = r => typeof r === 'string' && /^\/admin(\/[A-Za-z0-9_.-]+)*$/.test(r) && !B.PII_RE.test(r);

  B.governance = Object.freeze({ diff, changeSet, CONFIG_STATUS, CONFIG_TRANSITIONS, REVIEW_KIND, proposeConfigChange, transitionConfig, editPublished, rollbackPlan, impactRequired,
    FLAG_SCOPES, reviewFlag, SUPPORT_STATUS, validateSupportRequest, supportState, supportBanner, EMERGENCY_TYPES, validateEmergency, emergencyState,
    exportPreview, csvCell, csv, SECRET_STATUS, secretsView, integrationHealth, jobActions, accessChangePreview, validateOverride, overrideWarning, validateRepair,
    auditView, SEARCH_CATEGORIES, searchRequest, safeAdminRoute,
    MATURITY: Object.freeze(['L0 — operações manuais dispersas', 'L1 — visibilidade administrativa somente leitura', 'L2 — comandos de domínio seguros', 'L3 — filas/aprovações/auditoria', 'L4 — operações por política', 'L5 — autoatendimento governado']) });
})();
