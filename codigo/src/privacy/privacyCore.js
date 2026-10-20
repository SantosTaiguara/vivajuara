/* privacy/privacyCore.js — topic 59 (LGPD, privacidade e ciclo de vida dos dados): registries + PrivacyPolicyService.
   Pure and synchronous (browser, Node harness and the backend vm alike). It EXECUTES the organization's approved
   privacy registries (plat/config/privacy/*.json); it never chooses or infers a legal basis, a retention period or a
   controller/operator role. Those stay null ("necessita validação jurídica") and, while null, the answer is DENY /
   PRIVACY_REVIEW_REQUIRED. This is engineering guardrail, not legal advice.
   Config: App.privacy.core.setConfig({ registries, lifecycle, thirdParties, governance, policies }) or App.configs.privacy.
   Exposes: enums · registry lookups · validate() · blockers() · maturity() · mayProcess/mayCollect/mayPersist/mayShare/
   mayExport · capability() (authz + privacy) · masking · log sanitizer · PII-in-URL/key checks · analytics payload check ·
   client-safe projection check · recommendation criterion allowlist · document extraction allowlist · minor review ·
   sensitive free-text warning · privacy change gate · privacy exceptions · compliance package. */
App.privacy = App.privacy || {};
App.privacy.core = (() => {
  let injected = null;
  const EMPTY = { registries: {}, lifecycle: {}, thirdParties: {}, governance: {}, policies: {} };
  const cfg = () => injected || (App.configs && App.configs.privacy) || EMPTY;
  const setConfig = c => { injected = c ? { ...EMPTY, ...c } : null; };
  const arr = x => (Array.isArray(x) ? x : []);
  const fz = o => Object.freeze(o);
  const sec = k => cfg()[k] || {};

  // ------------------------------------------------------------------ enums
  const Classification = fz({ NON_PERSONAL: 'NON_PERSONAL', PERSONAL: 'PERSONAL', SENSITIVE_PERSONAL: 'SENSITIVE_PERSONAL', ANONYMIZED: 'ANONYMIZED' });
  const SecurityClass = fz({ PUBLIC: 'PUBLIC', INTERNAL: 'INTERNAL', CONFIDENTIAL: 'CONFIDENTIAL', RESTRICTED: 'RESTRICTED' });
  const STAGES = fz(['LEAD', 'CUSTOMER', 'DECISION', 'PROPOSAL', 'RESERVATION', 'CLOSING']);
  const OperationalState = fz({ NORMAL: 'NORMAL', PROCESSING_BLOCKED: 'PROCESSING_BLOCKED', DELETION_PENDING: 'DELETION_PENDING', LEGAL_HOLD: 'LEGAL_HOLD', PRIVACY_REVIEW: 'PRIVACY_REVIEW' });
  const LifecycleState = fz(['ACTIVE', 'RESTRICTED', 'ARCHIVED', 'PENDING_DELETION', 'DELETED', 'ANONYMIZED', 'LEGAL_HOLD']);
  const Reason = fz({
    OK: 'OK', UNKNOWN_PURPOSE: 'UNKNOWN_PURPOSE', PURPOSE_NOT_ACTIVE: 'PURPOSE_NOT_ACTIVE', NO_APPROVED_BASIS: 'NO_APPROVED_BASIS', CATEGORY_NOT_ALLOWED_FOR_PURPOSE: 'CATEGORY_NOT_ALLOWED_FOR_PURPOSE',
    UNKNOWN_CATEGORY: 'UNKNOWN_CATEGORY', SENSITIVE_REQUIRES_ART11: 'SENSITIVE_REQUIRES_ART11', CONSENT_REQUIRED: 'CONSENT_REQUIRED', CONSENT_EXPIRED: 'CONSENT_EXPIRED', CONSENT_WITHDRAWN: 'CONSENT_WITHDRAWN',
    CONSENT_NOTICE_OUTDATED: 'CONSENT_NOTICE_OUTDATED', PROCESSING_BLOCKED: 'PROCESSING_BLOCKED', LEGAL_HOLD_PURPOSE_ONLY: 'LEGAL_HOLD_PURPOSE_ONLY', DELETED_SUBJECT: 'DELETED_SUBJECT',
    UNKNOWN_FIELD: 'UNKNOWN_FIELD', FIELD_NOT_FOR_PURPOSE: 'FIELD_NOT_FOR_PURPOSE', COLLECTION_STAGE_TOO_EARLY: 'COLLECTION_STAGE_TOO_EARLY', NEVER_PERSIST: 'NEVER_PERSIST',
    CUSTOMER_OFFLINE_NOT_APPROVED: 'CUSTOMER_OFFLINE_NOT_APPROVED', NOT_IN_SHARE: 'NOT_IN_SHARE', NOT_EXPORTABLE: 'NOT_EXPORTABLE', PERMISSION_DENIED: 'PERMISSION_DENIED',
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED', CROSS_TENANT: 'CROSS_TENANT', OUT_OF_SCOPE: 'OUT_OF_SCOPE', PRIVACY_REVIEW_REQUIRED: 'PRIVACY_REVIEW_REQUIRED'
  });
  const DENIED_TEXT = 'Não disponível'; // §483–484: never reveal that a hidden value exists

  // ------------------------------------------------------------------ registry lookups
  const R = () => sec('registries'), L = () => sec('lifecycle'), T = () => sec('thirdParties'), G = () => sec('governance'), P = () => sec('policies');
  const byId = (list, id, k = 'id') => arr(list).find(x => x && x[k] === id) || null;
  const category = id => byId(R().dataCategories, id);
  const purpose = id => byId(R().purposes, id);
  const assessment = id => byId(R().legalBasisAssessments, id);
  const assessmentOfPurpose = pid => { const p = purpose(pid); return p ? assessment(p.legalBasisAssessmentRef) : null; };
  const field = key => byId(R().personalFields, key, 'fieldKey');
  const retention = id => byId(L().retentionPolicies, id);
  const vendor = id => byId(T().vendors, id);
  const activity = id => byId(R().processingActivities, id);
  const deadlineRule = code => byId(L().deadlineRules, code, 'code');
  const deadlineRuleFor = requestType => arr(L().deadlineRules).find(r => r.requestType === requestType) || null;

  /** an assessment counts only when APPROVED with an explicit code and a named assessor (never inferred) */
  function approvedBasis(pid) {
    const a = assessmentOfPurpose(pid);
    if (!a || a.status !== 'APPROVED' || !a.legalBasisCode || !a.assessedBy) return null;
    const codes = R().legalBasisCodes || {};
    const list = a.dataClass === 'SENSITIVE_PERSONAL' ? arr(codes.sensitive) : arr(codes.personal);
    return list.includes(a.legalBasisCode) ? a : null;
  }

  // ------------------------------------------------------------------ validation + blockers
  /** validate(config?) → errors [{ code, ref, message }] — structural integrity of the registries */
  function validate(c) {
    const prev = injected; if (c) setConfig(c);
    try {
      const errs = [], E = (code, ref, message) => errs.push({ code, ref, message });
      const cats = arr(R().dataCategories), purs = arr(R().purposes), codes = R().legalBasisCodes || {};
      const catIds = new Set(cats.map(x => x.id)), purIds = new Set(purs.map(x => x.id)), retIds = new Set(arr(L().retentionPolicies).map(x => x.id));
      for (const k of cats) {
        if (!Classification[k.classification]) E('INVALID_CLASSIFICATION', k.id, k.classification);
        if (!SecurityClass[k.defaultSecurityClass]) E('INVALID_SECURITY_CLASS', k.id, k.defaultSecurityClass);
        for (const p of arr(k.allowedPurposes)) if (!purIds.has(p)) E('UNKNOWN_PURPOSE_REF', k.id, p);
        for (const r of arr(k.retentionPolicyRefs)) if (!retIds.has(r)) E('UNKNOWN_RETENTION_REF', k.id, r);
        if (k.classification === 'SENSITIVE_PERSONAL' && arr(k.allowedPurposes).length && !arr(k.specialHandling).includes('ART11_ASSESSMENT_REQUIRED')) E('SENSITIVE_WITHOUT_ART11_HANDLING', k.id, 'categoria sensível com finalidade exige avaliação do art. 11');
      }
      for (const p of purs) {
        if (/melhorar (os |nossos )?servi/i.test(p.description || '')) E('GENERIC_PURPOSE', p.id, 'finalidade genérica (§21)');
        if (!p.description || p.description.length < 20) E('PURPOSE_NOT_DETERMINED', p.id, 'descrição de finalidade ausente ou vaga');
        for (const k of arr(p.dataCategoryIds)) { if (!catIds.has(k)) E('UNKNOWN_CATEGORY_REF', p.id, k); else if (!arr(category(k).allowedPurposes).includes(p.id)) E('PURPOSE_BOUNDARY_MISMATCH', p.id, `${k} não lista ${p.id}`); }
        const a = assessment(p.legalBasisAssessmentRef);
        if (!a) E('MISSING_LEGAL_BASIS_ASSESSMENT', p.id, p.legalBasisAssessmentRef);
        else if (a.processingPurposeId !== p.id) E('ASSESSMENT_PURPOSE_MISMATCH', p.id, a.id);
        if (p.retentionPolicyRef && !retIds.has(p.retentionPolicyRef)) E('UNKNOWN_RETENTION_REF', p.id, p.retentionPolicyRef);
        if (p.id === 'ALL' || /accept.?all/i.test(p.id)) E('GENERIC_CONSENT_PURPOSE', p.id, 'finalidade genérica proibida (§36)');
      }
      for (const a of arr(R().legalBasisAssessments)) {
        if (a.legalBasisCode != null) {
          const ok = (a.dataClass === 'SENSITIVE_PERSONAL' ? arr(codes.sensitive) : arr(codes.personal)).includes(a.legalBasisCode);
          if (!ok) E('INVALID_LEGAL_BASIS_CODE', a.id, a.legalBasisCode);
        }
        if (a.status === 'APPROVED' && (!a.legalBasisCode || !a.assessedBy || !a.rationale)) E('APPROVED_WITHOUT_EVIDENCE', a.id, 'aprovação exige código, justificativa e responsável');
      }
      for (const r of arr(L().retentionPolicies)) {
        if (r.duration != null && !/^P(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?$/.test(r.duration)) E('INVALID_DURATION', r.id, r.duration);
        if (r.duration != null && !r.approvedBy) E('DURATION_WITHOUT_APPROVAL', r.id, 'prazo sem aprovação');
        if (/forever|para sempre|indefinid/i.test(String(r.duration || '') + String(r.legalRationale || ''))) E('FOREVER_RETENTION', r.id, '"guardar para sempre" não é aceito (§98)');
      }
      for (const f of arr(R().personalFields)) {
        if (!catIds.has(f.dataCategoryId)) E('UNKNOWN_CATEGORY_REF', f.fieldKey, f.dataCategoryId);
        for (const p of arr(f.purposeRefs)) if (!purIds.has(p)) E('UNKNOWN_PURPOSE_REF', f.fieldKey, p);
        if (f.collectionStage !== 'ANY' && !STAGES.includes(f.collectionStage)) E('INVALID_COLLECTION_STAGE', f.fieldKey, f.collectionStage);
      }
      for (const x of arr(R().processingActivities)) {
        if (!purIds.has(x.purposeRef)) E('UNKNOWN_PURPOSE_REF', x.id, x.purposeRef);
        for (const k of arr(x.dataCategoryIds)) if (!catIds.has(k)) E('UNKNOWN_CATEGORY_REF', x.id, k);
        for (const t of arr(x.internationalTransferRefs)) if (!byId(T().internationalTransfers, t)) E('UNKNOWN_TRANSFER_REF', x.id, t);
      }
      for (const c2 of arr(P().recommendationCriteria)) if (c2.allowed && c2.dataCategoryId && category(c2.dataCategoryId) && category(c2.dataCategoryId).classification === 'SENSITIVE_PERSONAL') E('SENSITIVE_RECOMMENDATION_CRITERION', c2.criterionId, 'critério sensível não pode ser permitido');
      for (const pr of arr(P().profiling)) if (pr.humanInTheLoop && !pr.humanInTheLoopEvidence) E('HUMAN_IN_THE_LOOP_WITHOUT_EVIDENCE', pr.id, '§157: não marcar revisão humana sem evidência');
      for (const ex of arr(G().privacyExceptions)) if (!ex.expiresAt) E('EXCEPTION_WITHOUT_EXPIRY', ex.id, '§527');
      return errs;
    } finally { if (c) injected = prev; }
  }

  /** blockers() → PrivacyBlocker[] — what keeps the organization from processing personal data today */
  function blockers() {
    const out = [], B = (code, severity, scopeRef, message, remediationAction) => out.push(fz({ code, severity, scopeRef, message, remediationAction }));
    for (const p of arr(R().purposes)) {
      if (!approvedBasis(p.id)) B('NO_APPROVED_BASIS', 'BLOCKING', p.id, `Finalidade "${p.name}" sem base legal validada.`, 'Jurídico/encarregado registra o LegalBasisAssessment aprovado.');
      const r = retention(p.retentionPolicyRef);
      if (!r || r.duration == null || !r.approvedBy) B('RETENTION_UNDEFINED', 'BLOCKING', p.id, `Retenção de "${p.name}" não definida (PRIVACY_REVIEW_REQUIRED).`, 'Jurídico define gatilho, prazo e destino.');
      if (!p.controllerRoleRef) B('CONTROLLER_ROLE_UNASSESSED', 'WARNING', p.id, `Papel controlador/operador de "${p.name}" não avaliado.`, 'Preencher a ControllerOperatorMatrix.');
    }
    for (const v of arr(T().vendors)) if (v.status !== 'APPROVED') B('VENDOR_UNREVIEWED', 'BLOCKING', v.id, `Fornecedor "${v.name}" sem revisão de privacidade.`, 'Contrato/DPA, avaliação de segurança e papel.');
    for (const t of arr(T().internationalTransfers)) if (!t.mechanism || !t.mechanismEvidenceRef) B('TRANSFER_WITHOUT_MECHANISM', 'BLOCKING', t.id, 'Possível transferência internacional sem mecanismo registrado.', 'Verificar região real e mecanismo da Res. CD/ANPD nº 19/2024.');
    const d = G().dpo || {};
    if (!d.publicDisplayName || !d.publicContactChannel || d.status !== 'ACTIVE') B('DPO_NOT_APPOINTED', 'WARNING', 'dpo', 'Encarregado não registrado.', 'Organização confirma o encarregado e o canal público.');
    if (!arr(G().notices).some(n => n.noticeType === 'GENERAL_PRIVACY' && n.approvedBy)) B('NOTICE_NOT_APPROVED', 'WARNING', 'notices', 'Aviso de privacidade não aprovado.', 'Controlador aprova o texto e a versão.');
    for (const r of arr(L().deadlineRules)) if (r.businessDays == null && r.calendarDays == null) B('DEADLINE_NOT_CONFIGURED', 'WARNING', r.code, `Prazo ${r.code} não configurado.`, 'Jurídico valida o prazo.');
    return out;
  }

  /** maturity() → { level: 'L0'…'L5', checks } — §490, computed from what is really in place */
  function maturity() {
    const purs = arr(R().purposes), b = blockers();
    const checks = {
      L1_inventory: arr(R().dataCategories).length > 0 && arr(R().personalFields).length > 0 && arr(R().processingActivities).length > 0,
      L2_purpose_basis_retention: purs.length > 0 && purs.every(p => approvedBasis(p.id)) && !b.some(x => x.code === 'RETENTION_UNDEFINED'),
      L3_workflows: !!(App.privacy.workflow) && !b.some(x => x.code === 'VENDOR_UNREVIEWED' || x.code === 'DPO_NOT_APPOINTED'),
      L4_automated_lifecycle: false, L5_measured: false
    };
    const level = !checks.L1_inventory ? 'L0' : !checks.L2_purpose_basis_retention ? 'L1' : !checks.L3_workflows ? 'L2' : !checks.L4_automated_lifecycle ? 'L3' : !checks.L5_measured ? 'L4' : 'L5';
    return fz({ level, checks: fz(checks), target: 'L3' });
  }

  // ------------------------------------------------------------------ PrivacyPolicyService
  const now0 = o => (o && o.now != null ? +new Date(o.now) : Date.now());
  const decision = (allowed, reasonCodes, extra = {}) => fz({ allowed, reasonCodes: fz(reasonCodes.length ? reasonCodes : [allowed ? Reason.OK : Reason.PRIVACY_REVIEW_REQUIRED]), ...extra });

  /** consentStatus(records, { subjectRef, purposeId, now, currentNoticeVersionId }) → 'VALID' | 'NONE' | 'WITHDRAWN' | 'EXPIRED' | 'NOTICE_OUTDATED' */
  function consentStatus(records, o = {}) {
    const mine = arr(records).filter(r => r.dataSubjectId === o.subjectRef && r.purposeId === o.purposeId).sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
    const last = mine.filter(r => r.status !== 'SUPERSEDED').pop();
    if (!last) return 'NONE';
    if (last.status === 'WITHDRAWN') return 'WITHDRAWN';
    if (last.status === 'EXPIRED' || (last.expiresAt && +new Date(last.expiresAt) <= now0(o))) return 'EXPIRED';
    if (o.currentNoticeVersionId && last.noticeVersionId !== o.currentNoticeVersionId && o.requireCurrentNotice) return 'NOTICE_OUTDATED';
    return last.status === 'GRANTED' ? 'VALID' : 'NONE';
  }
  const activeBlocks = (blocks, subjectRef, t) => arr(blocks).filter(b => b.subjectRef === subjectRef && +new Date(b.activeFrom) <= t && (!b.activeTo || +new Date(b.activeTo) > t));

  /** mayProcess({ purposeId, categoryIds, subjectRef, consents, blocks, holds, tombstones, now }) → { allowed, reasonCodes, basis } (§479, invariants §568) */
  function mayProcess(i = {}) {
    const reasons = [], p = purpose(i.purposeId), t = now0(i);
    if (!p) return decision(false, [Reason.UNKNOWN_PURPOSE]);
    if (p.activeTo && +new Date(p.activeTo) <= t) reasons.push(Reason.PURPOSE_NOT_ACTIVE);
    const a = approvedBasis(p.id);
    if (!a) reasons.push(Reason.NO_APPROVED_BASIS);
    for (const k of arr(i.categoryIds)) {
      const c = category(k);
      if (!c) { reasons.push(Reason.UNKNOWN_CATEGORY); continue; }
      if (c.classification === 'NON_PERSONAL') continue;
      if (!arr(c.allowedPurposes).includes(p.id) || !arr(p.dataCategoryIds).includes(k)) reasons.push(Reason.CATEGORY_NOT_ALLOWED_FOR_PURPOSE);
      if (c.classification === 'SENSITIVE_PERSONAL' && (!a || a.dataClass !== 'SENSITIVE_PERSONAL')) reasons.push(Reason.SENSITIVE_REQUIRES_ART11);
    }
    if (i.subjectRef) {
      if (arr(i.tombstones).some(x => x.subjectRef === i.subjectRef && (!x.dataCategoryRef || arr(i.categoryIds).includes(x.dataCategoryRef)))) reasons.push(Reason.DELETED_SUBJECT);
      const bl = activeBlocks(i.blocks, i.subjectRef, t).filter(b => !arr(b.processingPurposeIds).length || arr(b.processingPurposeIds).includes(p.id));
      if (bl.some(b => !b.dataCategoryId || arr(i.categoryIds).includes(b.dataCategoryId) || !arr(i.categoryIds).length)) reasons.push(Reason.PROCESSING_BLOCKED);
      // §110: a legal hold retains data for the hold only; it never authorizes other purposes when the data is held for deletion
      const holds = arr(i.holds).filter(h => h.status === 'ACTIVE' && h.subjectRef === i.subjectRef && h.retainedForDeletion);
      if (holds.length && !holds.every(h => arr(h.allowedPurposeIds || ['LEGAL_COMPLIANCE']).includes(p.id))) reasons.push(Reason.LEGAL_HOLD_PURPOSE_ONLY);
      if (a && (a.legalBasisCode === 'CONSENT' || a.legalBasisCode === 'LGPD_ART11_CONSENT')) {
        const st = consentStatus(i.consents, { subjectRef: i.subjectRef, purposeId: p.id, now: t, currentNoticeVersionId: i.currentNoticeVersionId, requireCurrentNotice: i.requireCurrentNotice });
        if (st === 'NONE') reasons.push(Reason.CONSENT_REQUIRED); else if (st === 'WITHDRAWN') reasons.push(Reason.CONSENT_WITHDRAWN); else if (st === 'EXPIRED') reasons.push(Reason.CONSENT_EXPIRED); else if (st === 'NOTICE_OUTDATED') reasons.push(Reason.CONSENT_NOTICE_OUTDATED);
      }
    }
    return decision(!reasons.length, [...new Set(reasons)], { basis: a ? a.legalBasisCode : null });
  }

  /** mayCollect(fieldKey, { purposeId, stage }) — NO PURPOSE → NO COLLECTION; progressive collection (§49) */
  function mayCollect(fieldKey, o = {}) {
    const f = field(fieldKey); if (!f) return decision(false, [Reason.UNKNOWN_FIELD]);
    const r = [];
    if (!arr(f.purposeRefs).includes(o.purposeId)) r.push(Reason.FIELD_NOT_FOR_PURPOSE);
    if (f.collectionStage !== 'ANY' && o.stage && STAGES.indexOf(o.stage) < STAGES.indexOf(f.collectionStage)) r.push(Reason.COLLECTION_STAGE_TOO_EARLY);
    const pr = mayProcess({ purposeId: o.purposeId, categoryIds: [f.dataCategoryId], now: o.now });
    r.push(...pr.reasonCodes.filter(x => x !== Reason.OK));
    return decision(!r.length, [...new Set(r)]);
  }
  /** mayPersist(fieldKeyOrCategory, location) — 'BROWSER' | 'OFFLINE' | 'SERVER' (§203–212, NEVER_PERSIST) */
  function mayPersist(ref, location) {
    const f = field(ref), catId = f ? f.dataCategoryId : ref, c = category(catId);
    if (!c) return decision(false, [Reason.UNKNOWN_FIELD]);
    if (c.classification === 'NON_PERSONAL') return decision(true, [Reason.OK]);
    const bs = P().browserStorage || {};
    if (location === 'BROWSER' || location === 'OFFLINE') {
      if (arr(bs.neverPersistCategories).includes(catId) || arr(c.specialHandling).includes('NEVER_PERSIST_BROWSER') || (f && arr(f.specialHandling).includes('NEVER_PERSIST_BROWSER'))) return decision(false, [Reason.NEVER_PERSIST]);
      if (location === 'OFFLINE' && ['IDENTITY', 'CONTACT', 'FINANCIAL_DECLARED', 'COMMERCIAL_HISTORY'].includes(catId) && !bs.customerOfflinePersistence) return decision(false, [Reason.CUSTOMER_OFFLINE_NOT_APPROVED]);
    }
    return decision(true, [Reason.OK]);
  }
  /** mayShare(fieldKey, recipientType) — client share = minimum client-safe projection (§198–202) */
  function mayShare(fieldKey, recipientType = 'CLIENT') {
    const f = field(fieldKey), c = f && category(f.dataCategoryId);
    if (!f) return decision(false, [Reason.UNKNOWN_FIELD]);
    const sh = [...arr(f.specialHandling), ...arr(c && c.specialHandling)];
    if (recipientType === 'CLIENT' && (sh.includes('NOT_IN_SHARE') || sh.includes('NOT_IN_CLIENT_MODE') || (c && c.defaultSecurityClass === 'RESTRICTED'))) return decision(false, [Reason.NOT_IN_SHARE]);
    if (recipientType === 'VENDOR') return decision(false, [Reason.PRIVACY_REVIEW_REQUIRED]);
    return decision(true, [Reason.OK]);
  }
  /** mayExport(fieldKey, { toSubject, bulk, permissions }) — bulk export needs customer.export_bulk (§233–234) */
  function mayExport(fieldKey, o = {}) {
    const f = field(fieldKey); if (!f) return decision(false, [Reason.UNKNOWN_FIELD]);
    if (o.toSubject) return decision(!!f.exportableToSubject, [f.exportableToSubject ? Reason.OK : Reason.NOT_EXPORTABLE]);
    if (o.bulk && !arr(o.permissions).includes('customer.export_bulk')) return decision(false, [Reason.PERMISSION_DENIED]);
    return decision(true, [Reason.OK]);
  }
  /** capability({ authenticated, tenantOk, permission, permissions, inScope, privacy }) → PrivacyCapability (§481–482) */
  function capability(i = {}) {
    const r = [];
    if (!i.authenticated) r.push(Reason.NOT_AUTHENTICATED);
    else if (i.tenantOk === false) r.push(Reason.CROSS_TENANT);
    else if (i.permission && !arr(i.permissions).includes(i.permission)) r.push(Reason.PERMISSION_DENIED);
    else if (i.inScope === false) r.push(Reason.OUT_OF_SCOPE);
    const pv = i.privacy || decision(false, [Reason.PRIVACY_REVIEW_REQUIRED]);
    if (!r.length && !pv.allowed) r.push(...pv.reasonCodes);
    const ok = !r.length;
    return fz({ canView: ok, canEdit: ok && !!i.edit, canExport: ok && !!i.export, canShare: ok && !!i.share, canUseForPurpose: ok, reasonCodes: fz(ok ? [Reason.OK] : [...new Set(r)]), message: ok ? null : DENIED_TEXT });
  }

  // ------------------------------------------------------------------ masking (§57–60)
  const digits = s => String(s == null ? '' : s).replace(/\D/g, '');
  const maskCpf = v => { const d = digits(v); return d.length === 11 ? `***.***.***-${d.slice(9)}` : v == null ? null : '***'; };
  const maskPhone = v => { const d = digits(v); if (!d) return v == null ? null : '***'; return d.length >= 8 ? `(**) *****-${d.slice(-4)}` : '****'; };
  const maskEmail = v => { const s = String(v == null ? '' : v); const m = /^([^@]+)@(.+)$/.exec(s); return m ? `${m[1][0]}***@${m[2]}` : v == null ? null : '***'; };
  const maskName = v => { const s = String(v == null ? '' : v).trim(); if (!s) return v == null ? null : ''; const p = s.split(/\s+/); return p.length === 1 ? p[0] : `${p[0]} ${p.slice(1).map(x => x[0] + '.').join(' ')}`; };
  const MASKERS = { 'customer.cpf': maskCpf, 'customer.phone': maskPhone, 'customer.email': maskEmail, 'customer.displayName': maskName, 'legacyCustomer.name': maskName };
  /** maskField(fieldKey, value, { permissions }) → { value, mode } — mode from DataMaskingPolicy + overrides; HIDDEN → "Não disponível" */
  function maskField(fieldKey, value, o = {}) {
    const f = field(fieldKey), pol = arr(P().masking).find(m => m.fieldKey === fieldKey || (f && m.id === f.maskingPolicyRef));
    let mode = pol ? pol.defaultMode : 'MASKED';
    if (pol) for (const [perm, m] of Object.entries(pol.permissionOverrides || {})) if (arr(o.permissions).includes(perm)) mode = m;
    if (value == null) return fz({ value: null, mode });
    if (mode === 'FULL') return fz({ value, mode });
    if (mode === 'HIDDEN') return fz({ value: DENIED_TEXT, mode });
    const fn = MASKERS[fieldKey] || (() => '***');
    return fz({ value: mode === 'PARTIAL' || mode === 'MASKED' ? fn(value) : '***', mode });
  }

  // ------------------------------------------------------------------ logs (§213–218) + value detectors
  const DETECT = fz({ EMAIL: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, CPF: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, PHONE_BR: /(?:\+?55[\s.-]?)?\(?\b[1-9]{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/, BEARER: /\bbearer\s+[A-Za-z0-9._~+\/-]+=*/i, JWT: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\./ });
  const detect = s => typeof s !== 'string' ? [] : Object.entries(DETECT).filter(([, re]) => re.test(s)).map(([k]) => k);
  const normKey = k => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const h32 = s => { let h = 0x811c9dc5; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  function logRule(key) {
    const n = normKey(key), rules = arr(P().logData);
    return rules.find(r => n === r.fieldClass) || rules.find(r => n.includes(r.fieldClass)) || null;
  }
  /** sanitizeForLog(value) → copy with DENY keys removed, REDACT replaced, HASH pseudonymized, PII values in strings redacted */
  function sanitizeForLog(v, depth = 0) {
    if (depth > 6) return '[profundidade]';
    if (Array.isArray(v)) return v.map(x => sanitizeForLog(x, depth + 1));
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, x] of Object.entries(v)) {
        const r = logRule(k);
        if (r && r.allowed === 'DENY') continue;
        if (r && r.allowed === 'REDACT') { out[k] = r.replacement || '[removido]'; continue; }
        if (r && r.allowed === 'HASH') { out[k] = x == null ? null : 'h_' + h32('log|' + x); continue; }
        out[k] = sanitizeForLog(x, depth + 1);
      }
      return out;
    }
    if (typeof v === 'string' && detect(v).length) return '[removido]';
    return v;
  }
  /** piiInUrl(url) → found detector codes and forbidden query keys (§63) */
  function piiInUrl(url) {
    const s = String(url || ''), found = new Set(detect(decodeSafe(s)));
    const q = s.split('?')[1] || '';
    for (const part of q.split('&')) { const k = normKey(part.split('=')[0]); if (['phone', 'telefone', 'cpf', 'email', 'customername', 'nome', 'name'].includes(k)) found.add('FORBIDDEN_PARAM:' + k); }
    return [...found];
  }
  function decodeSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  const piiInKey = key => detect(String(key || '')).length > 0 || /cpf|email|phone|telefone|customername/i.test(String(key || ''));

  /** analyticsPayloadCheck(payload) → { ok, findings } — reuses the topic 45 policy when loaded (App.eventTracking.privacy) */
  function analyticsPayloadCheck(payload) {
    const EP = App.eventTracking && App.eventTracking.privacy, findings = [];
    const walk = (o, path) => {
      if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${path}[${i}]`));
      if (o && typeof o === 'object') { for (const [k, x] of Object.entries(o)) { const p = path ? `${path}.${k}` : k; if (EP ? EP.isForbiddenKey(k) : /email|phone|cpf|name|notes|token|password/i.test(k)) findings.push({ path: p, code: 'FORBIDDEN_KEY' }); walk(x, p); } return; }
      if (typeof o === 'string') { const d = EP ? EP.detect(o).filter(c => c !== 'LONG_SECRET') : detect(o); for (const c of d) findings.push({ path, code: c }); }
    };
    walk(payload, '');
    return fz({ ok: !findings.length, findings: fz(findings) });
  }
  /** checkClientSafe(projection) → leaked forbidden keys / PII values (§198, §458, §472) */
  function checkClientSafe(projection) {
    const forbidden = new Set(arr(P().clientSafeForbiddenKeys).map(normKey)), leaks = [];
    const walk = (o, path) => {
      if (Array.isArray(o)) return o.forEach((x, i) => walk(x, `${path}[${i}]`));
      if (o && typeof o === 'object') { for (const [k, x] of Object.entries(o)) { const p = path ? `${path}.${k}` : k; if (forbidden.has(normKey(k)) && x != null && x !== '') leaks.push({ path: p, code: 'FORBIDDEN_KEY' }); walk(x, p); } return; }
      if (typeof o === 'string') for (const c of detect(o)) leaks.push({ path, code: c });
    };
    walk(projection, '');
    return fz({ ok: !leaks.length, leaks: fz(leaks) });
  }

  // ------------------------------------------------------------------ recommendation / documents / minors / free text
  /** evaluateCriterion(criterionId) → { allowed, reason } — every criterion must be allowlisted; sensitive traits never (§349–352, §463) */
  function evaluateCriterion(criterionId) {
    const n = normKey(criterionId);
    if (arr(P().sensitiveTraits).map(normKey).some(s => n === s || n.includes(s))) return fz({ allowed: false, reason: 'SENSITIVE_TRAIT', criterionId });
    const c = arr(P().recommendationCriteria).find(x => x.criterionId === criterionId);
    if (!c) return fz({ allowed: false, reason: 'NOT_ALLOWLISTED', criterionId });
    const cat = c.dataCategoryId && category(c.dataCategoryId);
    if (cat && cat.classification === 'SENSITIVE_PERSONAL') return fz({ allowed: false, reason: 'SENSITIVE_CATEGORY', criterionId });
    return fz({ allowed: !!c.allowed, reason: c.allowed ? (c.reviewedBy ? 'ALLOWLISTED' : 'ALLOWLISTED_PENDING_REVIEW') : 'DENIED_BY_POLICY', criterionId });
  }
  /** filterExtraction(documentType, extracted{}) → { kept, dropped, status } — only approved fields (§340–341, §467) */
  function filterExtraction(documentType, extracted = {}) {
    const pol = arr(P().documentExtraction).find(d => d.documentType === documentType), kept = {}, dropped = [];
    for (const [k, v] of Object.entries(extracted || {})) { if (pol && arr(pol.allowedFieldKeys).includes(k) && !arr(pol.prohibitedFieldKeys).includes(k)) kept[k] = v; else dropped.push(k); }
    return fz({ kept: fz(kept), dropped: fz(dropped), status: !pol ? 'NO_POLICY' : arr(pol.allowedFieldKeys).length ? 'FILTERED' : 'NOTHING_ALLOWED_YET' });
  }
  /** subjectReview({ birthDate, declaredMinor, now }) → NORMAL | PRIVACY_REVIEW_REQUIRED (§333–336, §466) */
  function subjectReview(s = {}) {
    let minor = !!s.declaredMinor;
    if (s.birthDate) { const b = new Date(s.birthDate), n = new Date(now0(s)); let age = n.getUTCFullYear() - b.getUTCFullYear(); if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) age--; if (age < 18) minor = true; }
    const pol = P().minorData || {};
    return fz({ status: minor ? (pol.validatedProcess ? 'MINOR_PROCESS' : 'PRIVACY_REVIEW_REQUIRED') : 'NORMAL', operationalState: minor && !pol.validatedProcess ? OperationalState.PRIVACY_REVIEW : OperationalState.NORMAL });
  }
  /** sensitiveTextWarning(text) → { warn, hints } — advisory only, never blocks (§163–164) */
  function sensitiveTextWarning(text) {
    const s = String(text || '').toLowerCase(), hints = arr(P().sensitiveTextHints).filter(h => s.includes(h.toLowerCase()));
    const pii = detect(String(text || ''));
    return fz({ warn: !!(hints.length || pii.length), hints: fz(hints), pii: fz(pii), message: hints.length || pii.length ? 'Registre somente informação necessária ao atendimento.' : null });
  }

  // ------------------------------------------------------------------ change gate + exceptions (§149–152, §525–528)
  /** assessChange(PrivacyChangeAssessment input) → { status: PASS | REVIEW_REQUIRED | BLOCKED, reasons } */
  function assessChange(c = {}) {
    const reasons = [];
    if (c.introducesSensitiveData) reasons.push('SENSITIVE_DATA');
    if (c.introducesProfiling) reasons.push('PROFILING');
    if (arr(c.newDataCategories).length) reasons.push('NEW_DATA_CATEGORIES');
    if (arr(c.newPurposes).length) reasons.push('NEW_PURPOSES');
    if (arr(c.newRecipients).length) reasons.push('NEW_RECIPIENTS');
    if (arr(c.newTransfers).length) reasons.push('NEW_TRANSFERS');
    if (c.changesRetention) reasons.push('RETENTION_CHANGE');
    const unknownVendor = arr(c.newRecipients).some(v => { const x = vendor(v); return !x || x.status !== 'APPROVED'; });
    const sensitiveCriterion = arr(c.recommendationCriteria).some(k => !evaluateCriterion(k).allowed);
    const blocked = sensitiveCriterion || (c.introducesSensitiveData && !c.riskAssessmentRef) || (arr(c.newTransfers).length && unknownVendor);
    return fz({ featureRef: c.featureRef || null, status: blocked ? 'BLOCKED' : reasons.length ? 'REVIEW_REQUIRED' : 'PASS', reasons: fz(reasons),
      requiresNoticeUpdate: arr(c.newPurposes).length > 0 || arr(c.newRecipients).length > 0, requiresConsentReview: arr(c.newPurposes).length > 0, requiresRiskAssessment: !!(c.introducesSensitiveData || c.introducesProfiling || arr(c.newTransfers).length) });
  }
  const NON_WAIVABLE = fz(['NO_APPROVED_BASIS', 'TRANSFER_WITHOUT_MECHANISM', 'SENSITIVE_DATA_WITHOUT_ASSESSMENT']);
  /** exceptionStatus(ex, now) → ACTIVE | EXPIRED | INVALID (no permanent temporary exception; legal blockers not waivable) */
  function exceptionStatus(ex, o = {}) {
    if (!ex || !ex.expiresAt || !ex.approvedBy || !ex.reason) return 'INVALID';
    if (NON_WAIVABLE.includes(ex.policyCode) && !ex.legalReviewRef) return 'INVALID';
    return +new Date(ex.expiresAt) > now0(o) ? 'ACTIVE' : 'EXPIRED';
  }

  // ------------------------------------------------------------------ compliance package (§531, internal only)
  function compliancePackage() {
    return fz({
      generatedFrom: { registries: R().version || null, lifecycle: L().version || null, thirdParties: T().version || null, governance: G().version || null, policies: P().version || null },
      notLegalAdvice: true,
      processingActivityRegister: arr(R().processingActivities).map(a => ({ id: a.id, name: a.name, purpose: a.purposeRef, categories: a.dataCategoryIds, systems: a.systems, recipients: a.recipients, basis: approvedBasis(a.purposeRef) ? approvedBasis(a.purposeRef).legalBasisCode : null, retention: a.retentionPolicyRef, status: a.status })),
      vendorRegister: arr(T().vendors).map(v => ({ id: v.id, name: v.name, status: v.status, role: v.processingRole, regions: v.hostingRegions })),
      transferRegister: arr(T().internationalTransfers).map(t => ({ id: t.id, importer: t.importerRef, destination: t.destinationCountryOrOrganization, mechanism: t.mechanism, status: t.status })),
      retentionMatrix: arr(L().retentionPolicies).map(r => ({ id: r.id, categories: r.dataCategoryIds, trigger: r.retentionTrigger, duration: r.duration, disposition: r.disposition, status: r.status })),
      policyIndex: arr(G().policyDocuments), blockers: blockers(), maturity: maturity()
    });
  }

  return fz({ setConfig, config: cfg, Classification, SecurityClass, STAGES, OperationalState, LifecycleState, Reason, DENIED_TEXT,
    category, purpose, assessment, assessmentOfPurpose, approvedBasis, field, retention, vendor, activity, deadlineRule, deadlineRuleFor,
    validate, blockers, maturity, consentStatus, mayProcess, mayCollect, mayPersist, mayShare, mayExport, capability,
    maskCpf, maskPhone, maskEmail, maskName, maskField, detect, sanitizeForLog, piiInUrl, piiInKey, analyticsPayloadCheck, checkClientSafe,
    evaluateCriterion, filterExtraction, subjectReview, sensitiveTextWarning, assessChange, exceptionStatus, NON_WAIVABLE, compliancePackage, hash32: h32 });
})();
