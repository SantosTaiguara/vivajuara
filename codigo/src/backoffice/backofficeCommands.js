/* backoffice/backofficeCommands.js — App.backoffice.commands (topic 60 §138-160, §312-323): safe mutation contract.
   AdminCommandEnvelope<T> { commandId, actionCode, organizationId, resourceRef, expectedRevision?, idempotencyKey?, reason?, payload }
   Flow: build envelope → client precheck (UX only) → POST {api}/admin/commands/preview → show AdminActionPreview →
   confirm → POST {api}/admin/commands/execute (the server re-authenticates, re-authorizes, revalidates the revision and the
   preview token, runs the DOMAIN command, audits). The UI never invents a final domain result (§141): without a backend
   (static public panel) every command answers BACKEND_UNAVAILABLE. Offline → no critical write (§495).
   reason = { code: one of AdminReasonRegistry, text?: free complement } — text is never logged by the client. */
(() => {
  const B = App.backoffice, C = () => App.backofficeConfig, A = () => App.authz;
  const ERR = Object.freeze({
    UNKNOWN_ACTION: 'Ação administrativa desconhecida.', NOT_AUTHORIZED: 'Você não possui permissão para esta ação.',
    TENANT_REQUIRED: 'Selecione a organização ativa.', CROSS_TENANT: 'O recurso pertence a outra organização. Ação bloqueada.',
    REASON_REQUIRED: 'Informe o motivo (código) desta ação.', REASON_INVALID: 'Código de motivo inválido.', REASON_TEXT_REQUIRED: 'Descreva o motivo.',
    EXPECTED_REVISION_REQUIRED: 'Atualize o registro antes de agir (revisão atual ausente).', RESOURCE_REF_INVALID: 'Referência de recurso inválida.',
    PAYLOAD_INVALID: 'Dados do comando inválidos.', PREVIEW_REQUIRED: 'Veja o impacto (prévia) antes de confirmar.', PREVIEW_EXPIRED: 'A prévia expirou. Gere uma nova prévia.',
    PREVIEW_MISMATCH: 'A prévia não corresponde a este comando.', PREVIEW_BLOCKED: 'A prévia apontou bloqueios. A ação não pode ser executada.',
    STEP_UP_REQUIRED: 'Esta ação exige reautenticação forte, ainda não configurada neste ambiente.', OFFLINE: 'Ações administrativas exigem conexão.',
    BACKEND_UNAVAILABLE: 'Servidor administrativo não configurado neste painel. Nenhuma alteração foi feita.', NETWORK_ERROR: 'Falha de rede. Nada foi confirmado; tente de novo.',
    REVISION_CONFLICT: 'O registro mudou desde que você abriu.', SECOND_APPROVAL_REQUIRED: 'Esta ação exige aprovação de outra pessoa (approvalRef).',
    TYPED_CONFIRMATION_REQUIRED: 'Digite o identificador do recurso para confirmar.', SERVER_ERROR: 'O servidor recusou a ação.'
  });
  const RESOURCE_REF_RE = /^[a-z][a-z_]*:[A-Za-z0-9._:-]{1,128}$/; // "lot:VJ-QB-L0079", "config:org_house7/scoring" not allowed (no slash): safe ids only
  const nowMs = n => n == null ? Date.now() : (typeof n === 'number' ? n : new Date(n).getTime());
  const fail = (code, extra = {}) => Object.freeze({ ok: false, code, message: ERR[code] || code, ...extra });
  let seq = 0;
  const rid = p => `${p}_${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  /** envelope({ actionCode, resourceRef, expectedRevision, idempotencyKey, reason, payload }, { context }) → { ok, envelope } | error */
  function envelope(input = {}, o = {}) {
    const pol = B.actionPolicy(input.actionCode); if (!pol) return fail('UNKNOWN_ACTION');
    const ctx = o.context || A().context(), org = ctx && ctx.tenant && ctx.tenant.organizationId;
    if (!org) return fail('TENANT_REQUIRED');
    if (input.organizationId && input.organizationId !== org) return fail('CROSS_TENANT');
    if (typeof input.resourceRef !== 'string' || !RESOURCE_REF_RE.test(input.resourceRef) || B.PII_RE.test(input.resourceRef)) return fail('RESOURCE_REF_INVALID');
    if (pol.requiresExpectedRevision && (input.expectedRevision == null || input.expectedRevision === '')) return fail('EXPECTED_REVISION_REQUIRED');
    const r = validateReason(pol, input.reason); if (!r.ok) return r;
    if (input.payload != null && (typeof input.payload !== 'object' || Array.isArray(input.payload))) return fail('PAYLOAD_INVALID');
    const env = Object.freeze({ commandId: input.commandId || rid('cmd'), actionCode: pol.actionCode, organizationId: org, resourceRef: input.resourceRef,
      expectedRevision: input.expectedRevision == null ? null : String(input.expectedRevision), idempotencyKey: input.idempotencyKey || rid('idk'),
      reason: r.reason, payload: Object.freeze({ ...(input.payload || {}) }), approvalRef: input.approvalRef || null });
    return Object.freeze({ ok: true, envelope: env, policy: pol });
  }
  function validateReason(pol, reason) {
    if (!pol.requiresReason && !reason) return { ok: true, reason: null };
    if (!reason || !reason.code) return pol.requiresReason ? fail('REASON_REQUIRED') : { ok: true, reason: null };
    const def = C().reasonCodes.find(x => x.code === reason.code); if (!def) return fail('REASON_INVALID');
    const text = typeof reason.text === 'string' ? reason.text.trim().slice(0, 500) : '';
    if (def.requiresText && !text) return fail('REASON_TEXT_REQUIRED');
    return { ok: true, reason: Object.freeze({ code: def.code, text: text || null }) };
  }

  /** precheck(env, { context, connectivity, stepUpSatisfied }) — UX gate; the server is the authority (§146, §319) */
  function precheck(env, o = {}) {
    const pol = B.actionPolicy(env.actionCode); if (!pol) return fail('UNKNOWN_ACTION');
    const a = B.actionAvailability(env.actionCode, o);
    if (a.reason === 'OFFLINE') return fail('OFFLINE');
    if (!a.enabled) return fail('NOT_AUTHORIZED', { reason: a.reason });
    if (pol.requiresStepUp && !o.stepUpSatisfied) return fail('STEP_UP_REQUIRED', { stepUpPolicyStatus: C().policies.stepUpMethod.value == null ? C().PENDING : 'confirmado' });
    if (pol.requiresSecondApproval !== false && !env.approvalRef) return fail('SECOND_APPROVAL_REQUIRED', { policyStatus: pol.requiresSecondApproval == null ? C().PENDING : 'confirmado' });
    return Object.freeze({ ok: true, policy: pol });
  }

  // ------------------------------------------------------------------ transport (backend only; no PII in URL; CSRF per write)
  function transport(o = {}) {
    const base = o.baseUrl || A().backendBaseUrl(), f = o.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!base || !f) return null;
    return async (path, body) => {
      let csrf = null;
      try { const s = await f(`${base}/auth/session`, { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } }); const j = s && s.ok ? await s.json() : null; csrf = j && j.data ? j.data.csrfToken : null; } catch (_) { csrf = null; }
      const r = await f(`${base}${path}`, { method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), 'Idempotency-Key': body.envelope ? body.envelope.idempotencyKey : undefined },
        body: JSON.stringify(body) });
      let j = null; try { j = await r.json(); } catch (_) { j = null; }
      return { status: r.status, ok: r.ok, body: j };
    };
  }
  /** mapError(status, body) → user-facing error (what happened, what to do, request ID — never a stack, §321-322) */
  function mapError(status, body) {
    const b = body || {}, code = b.code || (status === 409 ? 'REVISION_CONFLICT' : 'SERVER_ERROR'), d = b.details || {};
    const reasonCode = d.reasonCode || null;
    const local = reasonCode && ERR[reasonCode] ? reasonCode : ERR[code] ? code : 'SERVER_ERROR';
    const out = { ok: false, code: local, serverCode: code, reasonCode, status, message: ERR[local], requestId: b.requestId || null,
      whatToDo: local === 'REVISION_CONFLICT' ? 'Atualize, compare as versões e refaça a ação se ainda fizer sentido.' : local === 'PREVIEW_EXPIRED' ? 'Gere uma nova prévia.' : local === 'NOT_AUTHORIZED' ? 'Peça acesso ao administrador da organização.' : 'Tente de novo; se persistir, informe o ID da requisição.' };
    if (local === 'REVISION_CONFLICT') out.conflict = conflictView({ yourRevision: d.expectedRevision, currentRevision: b.currentRevision != null ? b.currentRevision : d.currentRevision, diff: d.diff || [] });
    return Object.freeze(out);
  }
  /** conflictView — §152/312: "registro mudou desde que você abriu", your version vs current + diff, refresh action */
  function conflictView({ yourRevision = null, currentRevision = null, diff = [] } = {}) {
    return Object.freeze({ title: ERR.REVISION_CONFLICT, yourRevision: yourRevision == null ? null : String(yourRevision), currentRevision: currentRevision == null ? null : String(currentRevision),
      diff: (diff || []).map(c => Object.freeze({ field: c.field, yours: c.before === undefined ? null : c.before, current: c.after === undefined ? null : c.after, masked: !!c.masked })), actions: ['refresh'] });
  }

  /** preview(env, opts) → { ok, preview: AdminActionPreview + { previewToken, expiresAt } } | error */
  async function preview(env, o = {}) {
    const pc = precheck(env, o); if (!pc.ok) return pc;
    const t = o.transport || transport(o); if (!t) return fail('BACKEND_UNAVAILABLE');
    let r; try { r = await t('/admin/commands/preview', { envelope: env }); } catch (_) { return fail('NETWORK_ERROR'); }
    if (!r.ok) return mapError(r.status, r.body);
    const p = r.body && r.body.data; if (!p || p.actionCode !== env.actionCode) return fail('PREVIEW_MISMATCH');
    return Object.freeze({ ok: true, preview: Object.freeze({ ...p, auditNotice: 'Esta ação será registrada na auditoria.' }), receivedAt: new Date(nowMs(o.now)).toISOString() });
  }
  /** execute(env, preview, opts) — refuses locally an expired/blocked/mismatching preview; server revalidates everything */
  async function execute(env, pv, o = {}) {
    const pc = precheck(env, o); if (!pc.ok) return pc;
    const pol = pc.policy;
    if (pol.requiresPreview) {
      if (!pv || !pv.previewToken) return fail('PREVIEW_REQUIRED');
      if (pv.actionCode !== env.actionCode || (pv.expectedRevision != null && env.expectedRevision != null && String(pv.expectedRevision) !== String(env.expectedRevision))) return fail('PREVIEW_MISMATCH');
      if (pv.expiresAt && nowMs(pv.expiresAt) <= nowMs(o.now)) return fail('PREVIEW_EXPIRED');
      if (pv.allowed === false || (pv.blockers || []).length) return fail('PREVIEW_BLOCKED', { blockers: (pv.blockers || []).slice() });
    }
    if (pol.typedConfirmation && o.typedConfirmation !== env.resourceRef.split(':').slice(1).join(':')) return fail('TYPED_CONFIRMATION_REQUIRED');
    const t = o.transport || transport(o); if (!t) return fail('BACKEND_UNAVAILABLE');
    let r; try { r = await t('/admin/commands/execute', { envelope: env, previewToken: pv ? pv.previewToken : null }); } catch (_) { return fail('NETWORK_ERROR'); }
    if (!r.ok) return mapError(r.status, r.body);
    const d = r.body && r.body.data;
    return Object.freeze({ ok: true, result: d, authoritative: true, requestId: r.body && r.body.meta ? r.body.meta.requestId || null : null });
  }

  B.commands = Object.freeze({ ERR, RESOURCE_REF_RE, envelope, validateReason, precheck, preview, execute, transport, mapError, conflictView });
})();
