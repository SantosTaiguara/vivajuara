/* privacy/privacyWorkflow.js — topic 59 workflows over App.privacy.core (pure, no I/O, no clock unless opts.now):
   PrivacyNoticeVersion · ConsentRecord (grant / withdraw → ConsentWithdrawalResult, history never deleted) ·
   CommunicationPreference + ContactSuppression · DataSubjectRequest state machine + IdentityVerification + deadline from the
   PrivacyDeadlineRegistry (null → NOT_CONFIGURED) · routing · SubjectDataLocator discovery · SubjectAccessPackage (checksum,
   redaction) · correction/deletion propagation · DeletionPlan (legal hold, retention, review) · idempotent execution with
   DeletionTombstone (never the deleted value) · re-import guard · LegalHold · ProcessingBlock · operational state ·
   retention dry-run · vendor approval / offboarding · integration field allowlist · PrivacyIncidentCase + notification deadline ·
   privacy metrics (aggregate, no identity). Every result is { ok, ... } or { ok:false, code, message }. Not legal advice. */
App.privacy = App.privacy || {};
App.privacy.workflow = (() => {
  const C = () => App.privacy.core;
  const arr = x => (Array.isArray(x) ? x : []);
  const fz = o => Object.freeze(o);
  const err = (code, message, extra = {}) => fz({ ok: false, code, message, ...extra });
  const tnow = o => (o && o.now != null ? +new Date(o.now) : Date.now());
  const iso = t => new Date(t).toISOString();
  let seq = 0;
  const idOf = (prefix, o) => (o && o.idGen ? o.idGen(prefix) : `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const sha = s => (App.integrity && App.integrity.sha256 ? App.integrity.sha256(String(s)) : 'fnv' + C().hash32(String(s)));
  const canon = v => (App.integrity && App.integrity.canonicalSerialize ? App.integrity.canonicalSerialize(v) : JSON.stringify(v));
  const L = () => C().config().lifecycle || {}, G = () => C().config().governance || {}, T = () => C().config().thirdParties || {};
  const sameTenant = (ctx, rec) => !!(ctx && ctx.organizationId && rec && rec.organizationId === ctx.organizationId);

  // ------------------------------------------------------------------ notices (§41–43)
  /** createNotice({ organizationId, noticeType, version, content, approvedBy, effectiveFrom }) — checksum of the exact text; immutable */
  function createNotice(i = {}, o = {}) {
    if (!(G().noticeTypes || []).includes(i.noticeType)) return err('INVALID_NOTICE_TYPE', 'Tipo de aviso inválido.');
    if (!i.organizationId || !i.version || typeof i.content !== 'string' || !i.content.trim()) return err('VALIDATION_ERROR', 'Aviso exige organização, versão e texto.');
    return fz({ ok: true, notice: fz({ id: idOf('ntc', o), organizationId: i.organizationId, noticeType: i.noticeType, version: i.version, contentRef: i.contentRef || null,
      effectiveFrom: i.effectiveFrom || null, retiredAt: null, approvedBy: i.approvedBy || null, checksum: 'sha256:' + sha(i.content) }) });
  }
  /** supersedeNotice(old, newInput) — the old version is retired, never edited (§43) */
  function supersedeNotice(old, i = {}, o = {}) {
    const n = createNotice({ ...i, organizationId: old.organizationId, noticeType: old.noticeType }, o); if (!n.ok) return n;
    if (n.notice.version === old.version) return err('NOTICE_VERSION_EXISTS', 'Versão de aviso já existe: crie uma nova versão.');
    return fz({ ok: true, notice: n.notice, retired: fz({ ...old, retiredAt: iso(tnow(o)) }) });
  }

  // ------------------------------------------------------------------ consent (§31–40)
  /** grantConsent({ organizationId, subjectRef, purposeId, notice, noticeText, captureMethod, evidenceRef, actorContext, expiresAt }) */
  function grantConsent(i = {}, o = {}) {
    if (!i.purposeId || i.purposeId === 'ALL' || Array.isArray(i.purposeId)) return err('GENERIC_CONSENT_FORBIDDEN', 'Consentimento precisa de uma finalidade específica.');
    const p = C().purpose(i.purposeId); if (!p) return err('UNKNOWN_PURPOSE', 'Finalidade desconhecida.');
    const a = C().approvedBasis(i.purposeId);
    if (!a) return err('NO_APPROVED_BASIS', 'Finalidade sem base legal validada.');
    if (a.legalBasisCode !== 'CONSENT' && a.legalBasisCode !== 'LGPD_ART11_CONSENT') return err('CONSENT_NOT_LEGAL_BASIS', 'Consentimento só existe quando é o fundamento validado desta finalidade (§31).');
    if (!i.subjectRef || !i.organizationId) return err('VALIDATION_ERROR', 'Titular e organização obrigatórios.');
    if (!i.notice || !i.notice.id || !i.notice.checksum) return err('NOTICE_REQUIRED', 'Consentimento exige a versão do aviso aceita.');
    if (i.notice.organizationId !== i.organizationId) return err('CROSS_TENANT_DENIED', 'Aviso de outra organização.');
    if (typeof i.noticeText !== 'string' || 'sha256:' + sha(i.noticeText) !== i.notice.checksum) return err('NOTICE_CHECKSUM_MISMATCH', 'O texto apresentado não confere com a versão do aviso.');
    if (!['WEB', 'MOBILE', 'PHYSICAL_FORM', 'CLIENT_PORTAL', 'OTHER'].includes(i.captureMethod)) return err('VALIDATION_ERROR', 'Meio de coleta inválido.');
    if (!i.evidenceRef && !i.actorContext) return err('EVIDENCE_REQUIRED', 'Clique simples sem evidência/contexto não é consentimento (§557).');
    const t = tnow(o);
    return fz({ ok: true, record: fz({ id: idOf('cns', o), organizationId: i.organizationId, dataSubjectId: i.subjectRef, purposeId: i.purposeId, noticeVersionId: i.notice.id,
      status: 'GRANTED', capturedAt: iso(t), withdrawnAt: null, expiresAt: i.expiresAt || null, captureMethod: i.captureMethod, evidenceRef: i.evidenceRef || null, actorContext: i.actorContext || null,
      consentTextChecksum: i.notice.checksum, version: '1' }) });
  }
  /** withdrawConsent(record, { activities, now }) → { record (WITHDRAWN, same id: history kept by the append-only store), result: ConsentWithdrawalResult } */
  function withdrawConsent(rec, o = {}) {
    if (!rec || rec.status !== 'GRANTED') return err('CONSENT_NOT_ACTIVE', 'Consentimento não está ativo.');
    const core = C(), pur = core.purpose(rec.purposeId), t = tnow(o);
    const acts = arr(o.activities || (core.config().registries || {}).processingActivities);
    const stopped = acts.filter(a => a.purposeRef === rec.purposeId).map(a => a.id);
    const retained = [];
    for (const k of arr(pur && pur.dataCategoryIds)) {
      const other = arr((core.config().registries || {}).purposes).find(p => p.id !== rec.purposeId && arr(p.dataCategoryIds).includes(k) && core.approvedBasis(p.id) && core.approvedBasis(p.id).legalBasisCode !== 'CONSENT');
      if (other) retained.push(fz({ categoryId: k, retentionReason: `Mantido para a finalidade ${other.id} (base ${core.approvedBasis(other.id).legalBasisCode}); o uso para ${rec.purposeId} para.` }));
    }
    const ret = core.retention(pur && pur.retentionPolicyRef);
    const deletionJobsCreated = ret && ret.duration != null && ret.approvedBy && ret.retentionTrigger === 'CONSENT_WITHDRAWAL' ? [idOf('deljob', o)] : [];
    return fz({ ok: true, record: fz({ ...rec, status: 'WITHDRAWN', withdrawnAt: iso(t), version: String(+rec.version + 1 || 2) }),
      result: fz({ consentId: rec.id, stoppedProcessingActivities: fz(stopped), retainedDataCategories: fz(retained), deletionJobsCreated: fz(deletionJobsCreated), retentionStatus: deletionJobsCreated.length ? 'SCHEDULED' : 'PRIVACY_REVIEW_REQUIRED' }) });
  }

  // ------------------------------------------------------------------ communication preferences + suppression (§166–173)
  const normContact = (channel, v) => channel === 'EMAIL' ? String(v || '').trim().toLowerCase() : String(v || '').replace(/\D/g, '');
  /** suppression(contact, channel, purpose, reason) → ContactSuppression (only a domain-separated hash of the contact) */
  function suppression(contact, channel, purpose, reason, o = {}) {
    const n = normContact(channel, contact); if (!n) return err('VALIDATION_ERROR', 'Contato vazio.');
    return fz({ ok: true, suppression: fz({ normalizedContactHash: sha('privacy-suppression|' + channel + '|' + n), channel, purpose, reason, createdAt: iso(tnow(o)) }) });
  }
  const isSuppressed = (list, contact, channel, purpose) => { const h = sha('privacy-suppression|' + channel + '|' + normContact(channel, contact)); return arr(list).some(s => s.normalizedContactHash === h && s.channel === channel && (s.purpose === purpose || s.purpose === 'ALL')); };
  /** canContact({ preferences, suppressions, subjectRef, contact, channel, purpose }) → { allowed, reason, label } — broker signal (§295) */
  function canContact(i = {}) {
    const ch = { WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', SMS: 'SMS', PHONE: 'Telefone' }[i.channel] || i.channel, pu = { MARKETING: 'Marketing', SERVICE: 'Atendimento', TRANSACTIONAL: 'Transacional' }[i.purpose] || i.purpose;
    const out = (allowed, reason) => fz({ allowed, reason, label: `${pu} ${ch}: ${allowed ? 'permitido' : 'não permitido'}` });
    if (i.purpose === 'MARKETING' && i.contact && isSuppressed(i.suppressions, i.contact, i.channel, 'MARKETING')) return out(false, 'SUPPRESSED');
    const pref = arr(i.preferences).filter(p => p.subjectRef === i.subjectRef && p.channel === i.channel && p.purpose === i.purpose).sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).pop();
    if (i.purpose === 'MARKETING') return pref && pref.state === 'ALLOWED' && pref.basisRef ? out(true, 'ALLOWED') : out(false, pref ? (pref.state === 'ALLOWED' ? 'NO_BASIS_REF' : pref.state) : 'UNKNOWN');
    // §170: transactional/service messages are not stopped by a marketing opt-out
    return pref && pref.state === 'NOT_ALLOWED' ? out(false, 'NOT_ALLOWED') : out(true, pref ? pref.state : 'NOT_MARKETING');
  }

  // ------------------------------------------------------------------ data subject requests (§69–89, §323–332)
  const REQUEST_TYPES = fz(['CONFIRM_PROCESSING', 'ACCESS', 'CORRECTION', 'ANONYMIZATION', 'BLOCKING', 'DELETION', 'PORTABILITY', 'SHARING_INFORMATION', 'CONSENT_INFORMATION', 'CONSENT_WITHDRAWAL', 'OBJECTION', 'AUTOMATED_DECISION_REVIEW', 'OTHER']);
  const TRANSITIONS = fz({
    RECEIVED: ['IDENTITY_VERIFICATION', 'CANCELLED', 'DENIED_WITH_REASON'],
    IDENTITY_VERIFICATION: ['IN_REVIEW', 'DENIED_WITH_REASON', 'CANCELLED'],
    IN_REVIEW: ['ACTION_REQUIRED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'DENIED_WITH_REASON', 'CANCELLED'],
    ACTION_REQUIRED: ['IN_REVIEW', 'COMPLETED', 'PARTIALLY_COMPLETED', 'DENIED_WITH_REASON', 'CANCELLED'],
    COMPLETED: [], PARTIALLY_COMPLETED: [], DENIED_WITH_REASON: [], CANCELLED: []
  });
  const TERMINAL = fz(['COMPLETED', 'PARTIALLY_COMPLETED', 'DENIED_WITH_REASON', 'CANCELLED']);
  /** addBusinessDays(fromMs, n, holidays[]) → { dueAt, warnings } — weekends skipped; holidays only if configured */
  function addBusinessDays(from, n, holidays) {
    const hs = new Set(arr(holidays)); let d = new Date(from), left = n;
    while (left > 0) { d = new Date(d.getTime() + 864e5); const wd = d.getUTCDay(), key = d.toISOString().slice(0, 10); if (wd !== 0 && wd !== 6 && !hs.has(key)) left--; }
    return { dueAt: d.toISOString(), warnings: hs.size ? [] : ['HOLIDAYS_NOT_CONFIGURED'] };
  }
  /** computeDeadline(rule, fromIso) → { status: CONFIGURED | NOT_CONFIGURED, dueAt, warnings, legalRef } — never a default value */
  function computeDeadline(rule, from) {
    if (!rule) return fz({ status: 'NOT_CONFIGURED', dueAt: null, warnings: fz(['NO_RULE']), legalRef: null });
    const t = +new Date(from), cal = L().businessCalendar || {};
    if (Number.isFinite(rule.businessDays) && rule.businessDays >= 0) { const r = addBusinessDays(t, rule.businessDays, cal.holidays); return fz({ status: 'CONFIGURED', dueAt: r.dueAt, warnings: fz(r.warnings), legalRef: rule.legalRef || null, ruleVersion: rule.version || null }); }
    if (Number.isFinite(rule.calendarDays) && rule.calendarDays >= 0) return fz({ status: 'CONFIGURED', dueAt: iso(t + rule.calendarDays * 864e5), warnings: fz([]), legalRef: rule.legalRef || null, ruleVersion: rule.version || null });
    return fz({ status: 'NOT_CONFIGURED', dueAt: null, warnings: fz(['DEADLINE_NOT_CONFIGURED']), legalRef: rule.legalRef || null, referenceFromSpec: rule.referenceFromSpec || null });
  }
  const audit = (r, type, o, extra = {}) => fz([...arr(r.audit), fz({ type, at: iso(tnow(o)), actor: (o && o.actorId) || null, ...extra })]);
  /** createRequest(ctx, { requestType, subjectRef?, channel, representative? }) → DataSubjectRequest (status RECEIVED) */
  function createRequest(ctx, i = {}, o = {}) {
    if (!ctx || !ctx.organizationId) return err('TENANT_CONTEXT_REQUIRED', 'Organização obrigatória.');
    if (!REQUEST_TYPES.includes(i.requestType)) return err('VALIDATION_ERROR', 'Tipo de solicitação inválido.');
    if (i.subjectRef != null && C().piiInKey(i.subjectRef)) return err('VALIDATION_ERROR', 'subjectRef deve ser id opaco (nunca e-mail, telefone ou CPF).');
    const t = tnow(o), dl = computeDeadline(C().deadlineRuleFor(i.requestType), iso(t));
    const base = { id: idOf('dsr', o), organizationId: ctx.organizationId, subjectRef: i.subjectRef || null, requestType: i.requestType, status: 'RECEIVED', receivedAt: iso(t),
      dueAt: dl.dueAt, deadlineStatus: dl.status, channel: i.channel || 'OTHER', representative: i.representative ? fz({ kind: 'LEGAL_REPRESENTATIVE', proofRef: i.representative.proofRef || null }) : null,
      identityVerificationRef: null, assignedTo: null, completedAt: null, resolutionSummary: null, denialReasonCode: null, revision: '1', audit: [] };
    return fz({ ok: true, request: fz({ ...base, audit: audit(base, 'RECEIVED', o) }) });
  }
  /** transition(ctx, request, to, { expectedRevision, verification, denialReasonCode, resolutionSummary, actorId, now }) */
  function transition(ctx, r, to, o = {}) {
    if (!sameTenant(ctx, r)) return err('NOT_FOUND', 'Solicitação não encontrada.'); // cross-tenant: existence never revealed (§459)
    if (o.expectedRevision != null && String(o.expectedRevision) !== String(r.revision)) return err('REVISION_CONFLICT', 'A solicitação mudou.', { currentRevision: r.revision });
    if (!(TRANSITIONS[r.status] || []).includes(to)) return err('INVALID_TRANSITION', `Transição ${r.status} → ${to} não permitida.`);
    const patch = { status: to };
    if (r.status === 'IDENTITY_VERIFICATION' && to === 'IN_REVIEW') {
      const v = o.verification; if (!v || v.requestId !== r.id || v.result !== 'VERIFIED') return err('IDENTITY_NOT_VERIFIED', 'Identidade não verificada (§73).');
      patch.identityVerificationRef = v.id;
    }
    if (to === 'DENIED_WITH_REASON') {
      const ok = arr(G().denialReasons).some(d => d.code === o.denialReasonCode);
      if (!ok) return err('DENIAL_REASON_REQUIRED', 'Recusa exige motivo do registro versionado (§323–325).');
      patch.denialReasonCode = o.denialReasonCode;
    }
    if (TERMINAL.includes(to)) { patch.completedAt = iso(tnow(o)); patch.resolutionSummary = o.resolutionSummary || null; }
    if (o.assignedTo) patch.assignedTo = o.assignedTo;
    const next = { ...r, ...patch, revision: String(+r.revision + 1) };
    return fz({ ok: true, request: fz({ ...next, audit: audit(r, to, o) }) });
  }
  /** startVerification(request, method) / completeVerification(v, result, evidenceRef) — proportional to request risk (§73–76) */
  function startVerification(r, method, o = {}) {
    const risk = (L().requestRisk || {})[r.requestType] || 'MEDIUM', m = arr(L().identityVerificationMethods).find(x => x.code === method);
    if (!m) return err('UNKNOWN_VERIFICATION_METHOD', 'Método de verificação não configurado.');
    if (!arr(m.riskLevels).includes(risk)) return err('VERIFICATION_NOT_PROPORTIONAL', `Método ${method} não é adequado ao risco ${risk}.`);
    return fz({ ok: true, verification: fz({ id: idOf('idv', o), requestId: r.id, method, result: 'PENDING', evidenceRef: null, verifiedAt: null, retentionPolicyRef: 'RET_IDENTITY_VERIFICATION' }) });
  }
  function completeVerification(v, result, o = {}) {
    if (!v || v.result !== 'PENDING') return err('VERIFICATION_NOT_PENDING', 'Verificação já concluída.');
    if (!['VERIFIED', 'FAILED'].includes(result)) return err('VALIDATION_ERROR', 'Resultado inválido.');
    return fz({ ok: true, verification: fz({ ...v, result, evidenceRef: o.evidenceRef || null, verifiedAt: result === 'VERIFIED' ? iso(tnow(o)) : null }) });
  }
  /** route(request, { processingActivityId }) → HANDLE | FORWARD | COORDINATE (§416–418) */
  function route(r, o = {}) {
    const p = arr(T().rightsRequestRouting).find(x => x.processingActivityId === o.processingActivityId);
    return fz({ action: p ? p.action : 'HANDLE', responsiblePartyRef: p ? p.responsiblePartyRef : r.organizationId, configured: !!p });
  }
  /** discover(ctx, request, locators[]) → { ok, locations, searchedDomains } — each domain owns its locator (§80–82); requires verified identity */
  async function discover(ctx, r, locators, o = {}) {
    if (!sameTenant(ctx, r)) return err('NOT_FOUND', 'Solicitação não encontrada.');
    if (!r.identityVerificationRef) return err('IDENTITY_NOT_VERIFIED', 'Identidade não verificada.');
    if (!r.subjectRef) return err('SUBJECT_NOT_RESOLVED', 'Titular ainda não vinculado a um id interno.');
    const locations = [], searched = [], failed = [];
    for (const l of arr(locators)) {
      try { const found = await l.locate({ organizationId: ctx.organizationId }, r.subjectRef); searched.push(l.domain); for (const x of arr(found)) locations.push(fz({ domain: l.domain, ...x })); }
      catch (e) { failed.push(l.domain); }
    }
    return fz({ ok: true, locations: fz(locations), searchedDomains: fz(searched), failedDomains: fz(failed), request: fz({ ...r, audit: audit(r, 'SEARCHED', o, { domains: searched.length }) }) });
  }
  /** accessPackage(request, locations, { now }) → SubjectAccessPackage — third-party data excluded, internal-only fields redacted (§83–86) */
  function accessPackage(r, locations, o = {}) {
    if (!r.identityVerificationRef) return err('IDENTITY_NOT_VERIFIED', 'Identidade não verificada.');
    const domains = {}, excluded = [];
    for (const loc of arr(locations)) {
      if (loc.subjectRef && loc.subjectRef !== r.subjectRef) { excluded.push(fz({ reasonCode: 'THIRD_PARTY_DATA', domain: loc.domain })); continue; }
      const data = {};
      for (const [k, v] of Object.entries(loc.data || {})) {
        const f = C().field(k);
        if (f && !f.exportableToSubject) { excluded.push(fz({ reasonCode: 'NOT_EXPORTABLE', domain: loc.domain, fieldKey: k })); continue; }
        if (loc.otherSubjects && typeof v === 'string') { let s = v; for (const n of arr(loc.otherSubjects)) s = s.split(n).join('[outra pessoa]'); data[k] = s; } else data[k] = v;
      }
      (domains[loc.domain] = domains[loc.domain] || []).push(fz({ category: loc.dataCategoryId || null, data: fz(data) }));
    }
    const pkg = { requestId: r.id, subjectRef: r.subjectRef, generatedAt: iso(tnow(o)), domains: Object.entries(domains).map(([domain, records]) => fz({ domain, records: fz(records) })), excludedData: excluded, format: 'application/json' };
    return fz({ ok: true, package: fz({ ...pkg, checksum: 'sha256:' + sha(canon(pkg)) }) });
  }
  /** planCorrection(request, { fieldKey, systems }) → PrivacyCorrectionPropagation (the owner domain corrects; audit events are never edited, §87–89) */
  function planCorrection(r, i = {}) {
    if (!C().field(i.fieldKey)) return err('UNKNOWN_FIELD', 'Campo desconhecido.');
    if (!r.identityVerificationRef) return err('IDENTITY_NOT_VERIFIED', 'Identidade não verificada.');
    return fz({ ok: true, propagation: fz({ requestId: r.id, fieldKey: i.fieldKey, targets: fz(arr(i.systems).map(s => fz({ systemRef: s, status: 'PENDING', evidenceRef: null }))) }) });
  }
  const markTarget = (prop, systemRef, status, evidenceRef) => fz({ ...prop, targets: fz(prop.targets.map(x => x.systemRef === systemRef ? fz({ ...x, status, evidenceRef: evidenceRef || x.evidenceRef }) : x)) });
  const propagationDone = prop => arr(prop.targets).every(x => x.status === 'COMPLETED');

  // ------------------------------------------------------------------ legal holds, blocks, tombstones (§105–113)
  function createLegalHold(ctx, i = {}, o = {}) {
    if (!ctx || !ctx.organizationId) return err('TENANT_CONTEXT_REQUIRED', 'Organização obrigatória.');
    if (!i.reason || String(i.reason).trim().length < 5) return err('REASON_REQUIRED', 'Legal hold exige motivo.');
    if (!i.subjectRef && !arr(i.entityRefs).length) return err('VALIDATION_ERROR', 'Informe titular ou entidades.');
    return fz({ ok: true, hold: fz({ id: idOf('hold', o), organizationId: ctx.organizationId, subjectRef: i.subjectRef || null, entityRefs: fz(arr(i.entityRefs)), dataCategoryIds: fz(arr(i.dataCategoryIds)),
      allowedPurposeIds: fz(arr(i.allowedPurposeIds).length ? i.allowedPurposeIds : ['LEGAL_COMPLIANCE']), reason: i.reason, createdBy: (o && o.actorId) || null, createdAt: iso(tnow(o)), releasedBy: null, releasedAt: null, status: 'ACTIVE', retainedForDeletion: !!i.retainedForDeletion }) });
  }
  function releaseLegalHold(ctx, h, o = {}) {
    if (!sameTenant(ctx, h)) return err('NOT_FOUND', 'Legal hold não encontrado.');
    if (h.status !== 'ACTIVE') return err('HOLD_NOT_ACTIVE', 'Legal hold já liberado.');
    return fz({ ok: true, hold: fz({ ...h, status: 'RELEASED', releasedBy: (o && o.actorId) || null, releasedAt: iso(tnow(o)) }) });
  }
  const holdCovers = (h, subjectRef, categoryId) => h.status === 'ACTIVE' && (h.subjectRef === subjectRef) && (!arr(h.dataCategoryIds).length || arr(h.dataCategoryIds).includes(categoryId));
  function createBlock(i = {}, o = {}) {
    if (!i.subjectRef || !i.reason) return err('VALIDATION_ERROR', 'Bloqueio exige titular e motivo.');
    return fz({ ok: true, block: fz({ id: idOf('blk', o), subjectRef: i.subjectRef, dataCategoryId: i.dataCategoryId || null, processingPurposeIds: fz(arr(i.processingPurposeIds)), reason: i.reason, activeFrom: i.activeFrom || iso(tnow(o)), activeTo: i.activeTo || null }) });
  }
  /** tombstone — never carries the deleted value (§107) */
  const tombstone = (subjectRef, dataCategoryRef, reasonRef, o = {}) => fz({ subjectRef, dataCategoryRef, createdAt: iso(tnow(o)), expiresAt: null, reasonRef });
  /** guardImport({ subjectRef, contact, channel }, { tombstones, suppressions }) — stale connector/CSV cannot recreate a deleted subject (§279, §414, §456) */
  function guardImport(rec = {}, o = {}) {
    if (rec.subjectRef && arr(o.tombstones).some(t => t.subjectRef === rec.subjectRef && (!t.expiresAt || +new Date(t.expiresAt) > tnow(o)))) return fz({ accepted: false, reason: 'SUBJECT_DELETED_TOMBSTONE' });
    if (rec.contact && rec.channel && isSuppressed(o.suppressions, rec.contact, rec.channel, 'ALL')) return fz({ accepted: false, reason: 'CONTACT_SUPPRESSED' });
    return fz({ accepted: true, reason: 'OK' });
  }
  /** operationalState(subjectRef, { holds, blocks, pendingDeletion, review, now }) — §403 (internal only) */
  function operationalState(subjectRef, o = {}) {
    const S = C().OperationalState, t = tnow(o);
    if (arr(o.holds).some(h => h.status === 'ACTIVE' && h.subjectRef === subjectRef)) return S.LEGAL_HOLD;
    if (o.pendingDeletion) return S.DELETION_PENDING;
    if (arr(o.blocks).some(b => b.subjectRef === subjectRef && +new Date(b.activeFrom) <= t && (!b.activeTo || +new Date(b.activeTo) > t))) return S.PROCESSING_BLOCKED;
    if (o.review) return S.PRIVACY_REVIEW;
    return S.NORMAL;
  }

  // ------------------------------------------------------------------ deletion (§90–107, §300–312)
  /** planDeletion(request, { locations, holds }) → DeletionPlan; actions DELETE | ANONYMIZE | BLOCK | RETAIN, each with reason */
  function planDeletion(r, o = {}) {
    if (!['DELETION', 'ANONYMIZATION', 'CONSENT_WITHDRAWAL'].includes(r.requestType)) return err('INVALID_REQUEST_TYPE', 'Plano de eliminação só para eliminação/anonimização.');
    if (!r.identityVerificationRef) return err('IDENTITY_NOT_VERIFIED', 'Identidade não verificada.');
    const core = C(), actions = [];
    const seen = new Set();
    for (const loc of arr(o.locations)) {
      const cat = loc.dataCategoryId, key = loc.domain + '|' + cat; if (seen.has(key)) continue; seen.add(key);
      const hold = arr(o.holds).find(h => holdCovers(h, r.subjectRef, cat));
      if (hold) { actions.push(fz({ domain: loc.domain, dataCategory: cat, action: 'RETAIN', reason: 'LEGAL_HOLD', legalBasisRef: hold.id, explanation: `Mantido por legal hold: ${hold.reason}` })); continue; }
      const c = core.category(cat), ret = c && arr(c.retentionPolicyRefs).map(core.retention).find(Boolean);
      if (ret && ret.retainOnErasureRequest === true && ret.approvedBy && ret.legalRationale) { actions.push(fz({ domain: loc.domain, dataCategory: cat, action: 'RETAIN', reason: 'LEGAL_RETENTION_REQUIRED', legalBasisRef: ret.id, explanation: ret.legalRationale })); continue; }
      if (ret && ret.retainOnErasureRequest === false && ret.approvedBy) { actions.push(fz({ domain: loc.domain, dataCategory: cat, action: r.requestType === 'ANONYMIZATION' || ret.disposition === 'ANONYMIZE' ? 'ANONYMIZE' : 'DELETE', reason: 'ELIGIBLE', legalBasisRef: ret.id })); continue; }
      actions.push(fz({ domain: loc.domain, dataCategory: cat, action: 'RETAIN', reason: 'PRIVACY_REVIEW_REQUIRED', legalBasisRef: null, explanation: 'Retenção sem decisão jurídica: nada é apagado nem mantido "para sempre" sem revisão.' }));
    }
    const needsReview = actions.some(a => a.reason === 'PRIVACY_REVIEW_REQUIRED');
    return fz({ ok: true, plan: fz({ requestId: r.id, subjectRef: r.subjectRef, actions: fz(actions), approvedBy: null, status: needsReview ? 'REQUIRES_REVIEW' : 'READY_FOR_APPROVAL' }) });
  }
  const approvePlan = (plan, approver) => plan.status === 'REQUIRES_REVIEW' ? err('PLAN_REQUIRES_REVIEW', 'Há categorias sem decisão de retenção.') : !approver ? err('APPROVER_REQUIRED', 'Aprovação nominal obrigatória.') : fz({ ok: true, plan: fz({ ...plan, approvedBy: approver, status: 'APPROVED' }) });
  /** executePlan(plan, adapters{domain → { execute(actions) }}, { done: Set(actionKeys) }) — idempotent; returns tombstones + propagation */
  async function executePlan(plan, adapters, o = {}) {
    if (!plan || plan.status !== 'APPROVED' || !plan.approvedBy) return err('PLAN_NOT_APPROVED', 'Plano não aprovado.');
    const done = new Set(arr(o.alreadyDone)), targets = [], tombstones = [], newlyDone = [];
    for (const a of plan.actions) {
      const k = `${a.domain}|${a.dataCategory}|${a.action}`;
      if (a.action === 'RETAIN') { targets.push(fz({ systemRef: a.domain, action: 'RETAIN', status: 'COMPLETED', reason: a.reason })); continue; }
      if (done.has(k)) { targets.push(fz({ systemRef: a.domain, action: a.action, status: 'COMPLETED', evidenceRef: 'idempotent-skip' })); continue; }
      const ad = adapters && adapters[a.domain];
      if (!ad) { targets.push(fz({ systemRef: a.domain, action: a.action, status: 'FAILED', reason: 'NO_ADAPTER' })); continue; }
      try { const res = await ad.execute([a]); targets.push(fz({ systemRef: a.domain, action: a.action, status: 'COMPLETED', evidenceRef: (res && res.evidenceRef) || null })); newlyDone.push(k); tombstones.push(tombstone(plan.subjectRef, a.dataCategory, plan.requestId, o)); }
      catch (e) { targets.push(fz({ systemRef: a.domain, action: a.action, status: 'FAILED', reason: 'ADAPTER_ERROR' })); }
    }
    return fz({ ok: true, propagation: fz({ requestId: plan.requestId, targets: fz(targets) }), tombstones: fz(tombstones), done: fz([...done, ...newlyDone]), failed: targets.filter(x => x.status === 'FAILED').length });
  }
  /** retentionDryRun(records[{ domain, subjectRef, dataCategoryId, triggerAt }], { holds, blocks, now }) — §301 */
  function retentionDryRun(records, o = {}) {
    const core = C(), t = tnow(o), out = { candidates: 0, legalHolds: 0, blocked: 0, requiresReview: 0, notDue: 0, byDomain: {}, approvalRequired: true };
    for (const x of arr(records)) {
      const d = out.byDomain[x.domain] = out.byDomain[x.domain] || { candidates: 0, legalHolds: 0, requiresReview: 0 };
      const c = core.category(x.dataCategoryId), ret = c && arr(c.retentionPolicyRefs).map(core.retention).find(Boolean);
      if (!ret || ret.duration == null || !ret.approvedBy) { out.requiresReview++; d.requiresReview++; continue; }
      const due = addIso(x.triggerAt, ret.duration);
      if (due == null || due > t) { out.notDue++; continue; }
      if (arr(o.holds).some(h => holdCovers(h, x.subjectRef, x.dataCategoryId))) { out.legalHolds++; d.legalHolds++; continue; }
      if (arr(o.blocks).some(b => b.subjectRef === x.subjectRef)) out.blocked++;
      out.candidates++; d.candidates++;
    }
    const th = (L().retentionJobs || {}).highVolumeApprovalThreshold;
    out.approvalRequired = th == null ? true : out.candidates >= th;
    return fz(out);
  }
  function addIso(fromIso, dur) {
    const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(String(dur || '')); if (!m || !fromIso) return null;
    const d = new Date(fromIso); d.setUTCFullYear(d.getUTCFullYear() + (+m[1] || 0)); d.setUTCMonth(d.getUTCMonth() + (+m[2] || 0)); return d.getTime() + ((+m[3] || 0) * 7 + (+m[4] || 0)) * 864e5;
  }

  // ------------------------------------------------------------------ vendors, integrations, transfers (§119–136, §358–365)
  /** approveVendor(vendor, { transfers, roleAssessed }) — NO VENDOR REVIEW → NO SHARING; NO MECHANISM → NO TRANSFER (§460) */
  function approveVendor(v, o = {}) {
    const missing = [];
    if (!v.agreementRef) missing.push('AGREEMENT');
    if (!v.securityAssessmentRef) missing.push('SECURITY_ASSESSMENT');
    if (!v.processingRole) missing.push('PROCESSING_ROLE');
    const regions = arr(v.hostingRegions);
    if (!regions.length) missing.push('HOSTING_REGION_UNKNOWN');
    if (regions.some(r => r !== 'BR')) {
      const ok = arr(o.transfers).some(t => t.importerRef === v.id && t.status === 'ACTIVE' && t.mechanism && t.mechanismEvidenceRef && arr(T().transferMechanisms).includes(t.mechanism));
      if (!ok) missing.push('INTERNATIONAL_TRANSFER_MECHANISM');
    }
    if (missing.length) return err('VENDOR_NOT_APPROVABLE', 'Fornecedor não pode ser aprovado.', { missing: fz(missing) });
    return fz({ ok: true, vendor: fz({ ...v, status: 'APPROVED' }) });
  }
  /** regionChanged(vendor, newRegions) → vendor UNDER review (§364) */
  const regionChanged = (v, regions) => fz({ ...v, hostingRegions: fz(arr(regions)), status: v.status === 'APPROVED' ? 'PENDING_REVIEW' : v.status, reviewReason: 'HOSTING_REGION_CHANGED' });
  /** offboardVendor(vendor, checklist{ accessRevoked, tokensRevoked, dataReturnOrDeletionEvidenceRef }) — §360–361, §465 */
  function offboardVendor(v, c = {}) {
    const pending = [];
    if (!c.accessRevoked) pending.push('ACCESS_REVOKE'); if (!c.tokensRevoked) pending.push('TOKEN_REVOKE'); if (!c.dataReturnOrDeletionEvidenceRef) pending.push('DATA_RETURN_OR_DELETION_CONFIRMATION');
    const checklist = fz({ accessRevoked: !!c.accessRevoked, tokensRevoked: !!c.tokensRevoked, dataReturnOrDeletionEvidenceRef: c.dataReturnOrDeletionEvidenceRef || null, pending: fz(pending) });
    return fz({ ok: !pending.length, vendor: fz({ ...v, status: pending.length ? 'SUSPENDED' : 'TERMINATED' }), checklist, ...(pending.length ? { code: 'OFFBOARDING_INCOMPLETE' } : {}) });
  }
  /** filterOutbound(integrationId, record) — field allowlist, no blind sync (§127–129); vendor must be APPROVED */
  function filterOutbound(integrationId, record = {}) {
    const pol = arr(T().integrationPolicies).find(p => p.integrationId === integrationId), v = C().vendor(integrationId);
    if (!pol) return fz({ ok: false, code: 'NO_INTEGRATION_POLICY', payload: fz({}), dropped: fz(Object.keys(record)) });
    if (!v || v.status !== 'APPROVED') return fz({ ok: false, code: 'VENDOR_NOT_APPROVED', payload: fz({}), dropped: fz(Object.keys(record)) });
    const payload = {}, dropped = [];
    for (const [k, x] of Object.entries(record)) if (arr(pol.allowedDataFields).includes(k) && !arr(pol.prohibitedFields).includes(k)) payload[k] = x; else dropped.push(k);
    return fz({ ok: true, payload: fz(payload), dropped: fz(dropped) });
  }

  // ------------------------------------------------------------------ incidents (§242–254, §563)
  const INCIDENT_FLOW = fz({ ASSESSING: ['CONTAINING', 'NOTIFYING', 'REMEDIATING', 'CLOSED'], CONTAINING: ['NOTIFYING', 'REMEDIATING', 'CLOSED'], NOTIFYING: ['REMEDIATING', 'CLOSED'], REMEDIATING: ['CLOSED'], CLOSED: [] });
  /** fromSecurityIncident(securityIncident, { personalDataAffected, dataCategoryIds, approximateSubjectCount, controllerAwarenessAt }) → null (security only) | PrivacyIncidentCase */
  function fromSecurityIncident(si, i = {}, o = {}) {
    if (i.personalDataAffected === false) return fz({ ok: true, case: null, route: 'SECURITY_ONLY' });
    const c = { id: idOf('pinc', o), organizationId: si.organizationId, securityIncidentRef: si.id, discoveredAt: si.discoveredAt || iso(tnow(o)), controllerAwarenessAt: i.controllerAwarenessAt || null,
      personalDataAffected: i.personalDataAffected !== false, personalDataUncertain: i.personalDataAffected == null, dataCategoryIds: fz(arr(i.dataCategoryIds)), approximateSubjectCount: i.approximateSubjectCount ?? null,
      riskAssessmentRef: null, notificationDecision: 'PENDING', authorityNotificationRef: null, subjectNotificationRef: null, status: 'ASSESSING', notifications: fz([]) };
    return fz({ ok: true, case: fz(c), route: 'PRIVACY_CASE' });
  }
  function assessIncident(c, a = {}, o = {}) {
    if (!['YES', 'NO', 'UNCERTAIN'].includes(a.riskOrRelevantHarm) || !a.assessedBy) return err('VALIDATION_ERROR', 'Avaliação exige conclusão e responsável.');
    const ra = fz({ incidentId: c.id, dataTypes: fz(arr(a.dataTypes)), subjectGroups: fz(arr(a.subjectGroups)), confidentialityImpact: a.confidentialityImpact || null, integrityImpact: a.integrityImpact || null, availabilityImpact: a.availabilityImpact || null,
      potentialHarms: fz(arr(a.potentialHarms)), mitigations: fz(arr(a.mitigations)), riskOrRelevantHarm: a.riskOrRelevantHarm, assessedBy: a.assessedBy, assessedAt: iso(tnow(o)) });
    const decisionCode = a.riskOrRelevantHarm === 'YES' ? 'REQUIRED' : a.riskOrRelevantHarm === 'NO' ? 'NOT_REQUIRED' : 'PENDING';
    return fz({ ok: true, assessment: ra, case: fz({ ...c, riskAssessmentRef: 'ira_' + c.id, notificationDecision: decisionCode }) });
  }
  /** notificationDeadlines(case) → { authority, subjects } from the registry (§246–247, §461); start = controllerAwarenessAt */
  function notificationDeadlines(c) {
    const from = c.controllerAwarenessAt || c.discoveredAt;
    return fz({ from, authority: computeDeadline(C().deadlineRule('INCIDENT_NOTIFICATION_ANPD'), from), subjects: computeDeadline(C().deadlineRule('INCIDENT_NOTIFICATION_SUBJECTS'), from) });
  }
  function moveIncident(c, to, o = {}) {
    if (!(INCIDENT_FLOW[c.status] || []).includes(to)) return err('INVALID_TRANSITION', `Transição ${c.status} → ${to} não permitida.`);
    if (to === 'CLOSED' && c.notificationDecision === 'PENDING') return err('NOTIFICATION_DECISION_PENDING', 'Decida sobre a comunicação antes de encerrar.');
    if (to === 'CLOSED' && c.notificationDecision === 'REQUIRED' && (!c.authorityNotificationRef || !c.subjectNotificationRef)) return err('NOTIFICATION_EVIDENCE_REQUIRED', 'Registre a comunicação à ANPD e aos titulares.');
    return fz({ ok: true, case: fz({ ...c, status: to }) });
  }
  /** recordNotification(case, { target: AUTHORITY|SUBJECTS, content, channel, recipientScope, preliminary }) — evidence (§248–249) */
  function recordNotification(c, n = {}, o = {}) {
    if (!['AUTHORITY', 'SUBJECTS'].includes(n.target) || !n.content || !n.channel || !n.recipientScope) return err('VALIDATION_ERROR', 'Evidência exige destino, conteúdo, canal e escopo.');
    const ev = fz({ id: idOf('pnot', o), target: n.target, contentChecksum: 'sha256:' + sha(n.content), channel: n.channel, recipientScope: n.recipientScope, sentAt: iso(tnow(o)), preliminary: !!n.preliminary });
    return fz({ ok: true, notification: ev, case: fz({ ...c, notifications: fz([...arr(c.notifications), ev]), ...(n.target === 'AUTHORITY' ? { authorityNotificationRef: ev.id } : { subjectNotificationRef: ev.id }) }) });
  }

  // ------------------------------------------------------------------ metrics (§392–394: aggregate, no identity)
  function metrics({ requests = [], consents = [], incidents = [], vendors = [], now } = {}) {
    const t = now != null ? +new Date(now) : Date.now(), open = arr(requests).filter(r => !TERMINAL.includes(r.status));
    return fz({ data_subject_requests_open: open.length, data_subject_requests_overdue: open.filter(r => r.dueAt && +new Date(r.dueAt) < t).length, data_subject_requests_without_deadline: open.filter(r => !r.dueAt).length,
      consents_withdrawn: arr(consents).filter(c => c.status === 'WITHDRAWN').length, privacy_incidents_open: arr(incidents).filter(c => c.status !== 'CLOSED').length,
      vendor_reviews_due: arr(vendors).filter(v => v.status === 'PENDING_REVIEW').length });
  }

  return fz({ REQUEST_TYPES, TRANSITIONS, TERMINAL, INCIDENT_FLOW, createNotice, supersedeNotice, grantConsent, withdrawConsent, suppression, isSuppressed, canContact,
    addBusinessDays, computeDeadline, createRequest, transition, startVerification, completeVerification, route, discover, accessPackage, planCorrection, markTarget, propagationDone,
    createLegalHold, releaseLegalHold, createBlock, tombstone, guardImport, operationalState, planDeletion, approvePlan, executePlan, retentionDryRun,
    approveVendor, regionChanged, offboardVendor, filterOutbound, fromSecurityIncident, assessIncident, notificationDeadlines, moveIncident, recordNotification, metrics });
})();
