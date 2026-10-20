/* journey/journeyDomain.js — topic 40: CustomerJourney, a commercial journey of one Customer for one development/intent.
   Mutable journey snapshot + append-only JourneyEvent log + append-only stage transition history (no event-sourcing framework).
   Stage model definition/versions (published = frozen + checksum) · transition graph · JourneyStageTransition ·
   JourneyEvent + event type registry + ingestion policy · acquisition context (first touch immutable) · touchpoints (no raw
   messages) · next actions (OVERDUE derived) · action/stage suggestions (never auto-applied by default) · attention state ·
   outcome WON/LOST (explicit; loss reason registry) · pause/resume · artifact links (refs only) · timeline projection ·
   corrections · CRM stage mapping / sync conflicts · legacy migration (no fabricated history) · board/query projections ·
   access decision.

   Hard rules: Customer ≠ Journey; Customer lifecycle ≠ stage; clicks/hover never become timeline; nothing is copied from
   Recommendation / Favorite / Comparison / Simulation / Document / Reservation (references only); the journey never
   changes a lot, its availability (all 498 lots are UNKNOWN today), price, score or Fit; it never promises valorização;
   no last-write-wins on stage (expectedRevision); no PII in events, links, board or logs. */
App.journey = App.journey || {};
App.journey.domain = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const JourneyType = E('PURCHASE', 'INVESTMENT', 'HOUSING', 'GENERAL_INTEREST');
  const LifecycleStatus = E('ACTIVE', 'PAUSED', 'CLOSED_WON', 'CLOSED_LOST', 'ARCHIVED');
  const StageCategory = E('NEW', 'ENGAGEMENT', 'QUALIFICATION', 'DISCOVERY', 'RECOMMENDATION', 'SHORTLIST', 'VISIT', 'NEGOTIATION', 'PROPOSAL', 'RESERVATION', 'WON', 'LOST', 'PAUSED', 'OTHER');
  const ModelStatus = E('DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED');
  const ActorType = E('USER', 'SYSTEM', 'INTEGRATION', 'CUSTOMER');
  const EventSource = E('MANUAL', 'DOMAIN_EVENT', 'CRM_SYNC', 'WEB_FORM', 'WHATSAPP', 'EMAIL', 'PHONE', 'IMPORT', 'SYSTEM', 'INTEGRATION');
  const Visibility = E('INTERNAL', 'ASSIGNED_TEAM', 'CLIENT_SAFE', 'TECHNICAL');
  const TouchpointType = E('CONTACT_ATTEMPT', 'CONVERSATION', 'MEETING', 'VISIT', 'FOLLOW_UP', 'OTHER');
  const Channel = E('WHATSAPP', 'PHONE', 'EMAIL', 'IN_PERSON', 'VIDEO', 'WEB', 'CRM', 'OTHER');
  const Direction = E('INBOUND', 'OUTBOUND', 'MUTUAL');
  const NextActionStatus = E('OPEN', 'COMPLETED', 'CANCELLED');
  const NextActionReadState = E('OPEN', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'CANCELLED');
  const AttentionState = E('ON_TRACK', 'ACTION_DUE', 'OVERDUE', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'PAUSED', 'CLOSED', 'UNKNOWN');
  const OutcomeType = E('WON', 'LOST');
  const ResourceType = E('FAVORITE_COLLECTION', 'COMPARISON_SESSION', 'RECOMMENDATION_RESULT', 'FINANCIAL_SIMULATION', 'DOCUMENT', 'PROPOSAL', 'RESERVATION', 'LOT', 'PRESENTATION', 'CUSTOMER_PROFILE_VERSION', 'OTHER');
  const SuggestionStatus = E('PENDING', 'ACCEPTED', 'DISMISSED', 'EXPIRED');
  const ProjectionMode = E('SUMMARY', 'BROKER', 'MANAGER', 'CLIENT_SAFE', 'TECHNICAL');
  const Sort = E('RECENT_ACTIVITY', 'OLDEST_ACTIVITY', 'NEXT_ACTION_DUE', 'CUSTOMER_NAME', 'STAGE_ORDER', 'CREATED_AT');
  const Errors = E('MISSING_ORGANIZATION', 'MISSING_CUSTOMER', 'INVALID_TYPE', 'ACTIVE_JOURNEY_EXISTS', 'NO_STAGE_MODEL', 'STAGE_MODEL_NOT_PUBLISHED', 'STAGE_MODEL_IMMUTABLE', 'STAGE_MODEL_MISMATCH', 'INVALID_STAGE_MODEL',
    'JOURNEY_REVISION_CONFLICT', 'JOURNEY_NOT_ACTIVE', 'JOURNEY_NOT_PAUSED', 'NO_GRANT', 'UNKNOWN_STAGE', 'SAME_STAGE', 'TRANSITION_NOT_ALLOWED', 'REASON_REQUIRED', 'INVALID_REASON', 'OUTCOME_REQUIRED',
    'UNKNOWN_EVENT_TYPE', 'SOURCE_NOT_ALLOWED', 'CUSTOMER_ACTOR_UNPROVEN', 'PAYLOAD_MISSING_FIELD', 'PAYLOAD_KEY_NOT_ALLOWED', 'RAW_CONTENT_NOT_ALLOWED', 'VISIBILITY_NOT_ALLOWED', 'OCCURRED_AT_IN_FUTURE', 'INVALID_DATE',
    'CONTAINS_CONTACT_DATA', 'INVALID_CHANNEL', 'INVALID_DIRECTION', 'INVALID_OUTCOME_CODE', 'INVALID_ACTION_TYPE', 'ACTION_NOT_OPEN', 'INVALID_RESOURCE', 'NOT_FOUND', 'CROSS_TENANT', 'OFFLINE_NOT_ALLOWED', 'EVENT_NOT_FOUND');
  const MESSAGES = Object.freeze({
    JOURNEY_REVISION_CONFLICT: 'A jornada foi alterada por outra pessoa. Recarregue antes de mudar a etapa.', TRANSITION_NOT_ALLOWED: 'Esta mudança de etapa não é permitida pelo modelo da jornada.',
    REASON_REQUIRED: 'Informe o motivo desta mudança.', OUTCOME_REQUIRED: 'Encerrar a jornada exige registrar o resultado (ganho ou perda).', ACTIVE_JOURNEY_EXISTS: 'Já existe uma jornada ativa deste cliente neste empreendimento.',
    JOURNEY_NOT_ACTIVE: 'A jornada não está ativa.', OFFLINE_NOT_ALLOWED: 'Esta ação exige conexão com o servidor.', NO_GRANT: 'Você não possui permissão para esta ação.', SELECTION_REQUIRED: 'Este cliente tem mais de uma jornada ativa: escolha qual usar.'
  });
  const RAW_KEYS = /^(message|messages|body|text|transcript|transcription|recording|audio|content|html|filename|fileName|file|blob|attachment|matrix|result|values|lots|lotData|price|prices|availability|status)$/;
  const cfg = () => (App.configs && App.configs.journey && App.configs.journey.policy) || {};
  const checksum = v => App.methodology.checksum(v);
  const ms = t => t == null ? Date.now() : typeof t === 'number' ? t : new Date(t).getTime();
  const iso = t => new Date(ms(t)).toISOString();
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  const plain = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  const fail = (code, extra = {}) => Object.freeze({ ok: false, code, message: MESSAGES[code] || code, ...extra });
  const piiLike = s => App.customer && App.customer.domain ? App.customer.domain.looksLikePII(s) : /[^\s@]+@[^\s@]+\.[^\s@]+|\d{8,}/.test(String(s).replace(/[\s().+\-/]/g, ''));
  let seq = 0;
  const newId = (prefix, opts = {}) => opts.idGen ? opts.idGen(prefix) : (App.customer && App.customer.domain ? App.customer.domain.newId(prefix) : `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}`);
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;

  // ------------------------------------------------------------------ registries (configurable, never hardcoded in the UI)
  let regCache = null;
  function registry() {
    const c = cfg(); if (regCache && regCache.src === c) return regCache;
    regCache = { src: c, events: new Map((c.eventTypes || []).map(e => [e.code, Object.freeze(e)])), ingestion: new Map((c.ingestionPolicies || []).map(p => [p.sourceEventType, Object.freeze(p)])),
      loss: new Set((c.lossReasons || []).map(r => r.code)), sources: new Set(c.sources || []), outcomes: new Set(c.touchpointOutcomes || []), actions: new Set(c.nextActionTypes || []),
      pause: new Set(c.pauseReasons || []), override: new Set(c.overrideReasons || []) };
    return regCache;
  }
  const eventType = code => registry().events.get(code) || null;
  const lossReasons = () => [...registry().loss].map(code => Object.freeze({ code, label: (cfg().lossReasonLabels || {})[code] || code }));
  const sources = () => [...registry().sources].map(code => Object.freeze({ code, label: (cfg().sourceLabels || {})[code] || code }));
  const automationPolicy = () => Object.freeze({ allowAutoStageTransition: false, trustedEventTypes: [], allowedTransitionIds: [], ...(cfg().automationPolicy || {}) });
  const offlinePolicy = () => Object.freeze({ allowSummaryCache: false, allowTimelineCache: false, allowNextActionCache: false, allowOfflineTouchpointQueue: false, allowOfflineStageTransition: false, ...(cfg().offlinePolicy || {}) });
  /** online-only operations (stage transition / outcome) under the offline policy */
  function requireOnline(op, connectivity) {
    const p = offlinePolicy(), online = connectivity === 'ONLINE';
    if (online) return null;
    if ((op === 'transition' || op === 'outcome') && !p.allowOfflineStageTransition) return fail(Errors.OFFLINE_NOT_ALLOWED);
    if (op === 'touchpoint' && !p.allowOfflineTouchpointQueue) return fail(Errors.OFFLINE_NOT_ALLOWED);
    return null;
  }

  // ------------------------------------------------------------------ stage models
  /** stageModels(orgId) → [{ definition, versions }] from config */
  const modelsOf = orgId => (cfg().stageModels || []).filter(m => m.definition.organizationId === orgId);
  /** currentModel(orgId) → the published JourneyStageModelVersion in use (frozen) or null */
  function currentModel(orgId) {
    const defId = ((cfg().organizations || {})[orgId] || {}).stageModelDefinitionId, m = modelsOf(orgId).find(x => x.definition.id === defId) || modelsOf(orgId)[0];
    if (!m) return null; const pubs = m.versions.filter(v => v.lifecycleStatus === 'PUBLISHED').sort((a, b) => b.version - a.version);
    return pubs[0] ? sealed(pubs[0]) : null;
  }
  const sealCache = new WeakMap();
  function sealed(v) { if (sealCache.has(v)) return sealCache.get(v); const s = deepFreeze({ ...plain(v), checksum: v.checksum || modelChecksum(v) }); sealCache.set(v, s); return s; }
  const modelChecksum = v => checksum({ stages: v.stages, transitions: v.transitions, entryStageId: v.entryStageId, wonStageIds: v.wonStageIds, lostStageIds: v.lostStageIds });
  function modelVersionById(orgId, id) { for (const m of modelsOf(orgId)) { const v = m.versions.find(x => x.id === id); if (v) return sealed(v); } return null; }
  const stageOf = (model, ref) => model && (model.stages.find(s => s.id === ref) || model.stages.find(s => s.code === ref)) || null;
  /** validateStageModel(version) → errors[] */
  function validateStageModel(v) {
    const errs = [], E2 = (code, m) => errs.push({ code, message: m }), ids = new Set();
    for (const s of v.stages || []) { if (ids.has(s.id)) E2('DUPLICATE_STAGE', s.id); ids.add(s.id); if (!StageCategory[s.category]) E2('INVALID_CATEGORY', s.id); }
    if (!ids.has(v.entryStageId)) E2('MISSING_ENTRY_STAGE', v.entryStageId);
    for (const id of [...(v.wonStageIds || []), ...(v.lostStageIds || [])]) { const s = (v.stages || []).find(x => x.id === id); if (!s || !s.terminal) E2('TERMINAL_STAGE_INVALID', id); }
    const tids = new Set();
    for (const t of v.transitions || []) {
      if (tids.has(t.id)) E2('DUPLICATE_TRANSITION', t.id); tids.add(t.id);
      if (!ids.has(t.fromStageId) || !ids.has(t.toStageId)) E2('TRANSITION_UNKNOWN_STAGE', t.id);
      const from = (v.stages || []).find(s => s.id === t.fromStageId); if (from && from.terminal) E2('TRANSITION_FROM_TERMINAL', t.id);
    }
    return errs;
  }
  /** draftFrom(published) → a new DRAFT version (the published one is never edited) */
  function draftFrom(published, opts = {}) { const d = plain(published); return { ...d, id: opts.id || newId('jsmv', opts), version: published.version + 1, lifecycleStatus: 'DRAFT', publishedAt: undefined, checksum: undefined, createdAt: iso(opts.now) }; }
  function editDraft(version, patch) { if (version.lifecycleStatus === 'PUBLISHED' || Object.isFrozen(version)) return fail(Errors.STAGE_MODEL_IMMUTABLE); return Object.freeze({ ok: true, version: { ...version, ...patch } }); }
  /** publish(draft) → frozen PUBLISHED version with checksum (validation first) */
  function publish(draft, opts = {}) {
    if (draft.lifecycleStatus === 'PUBLISHED') return fail(Errors.STAGE_MODEL_IMMUTABLE);
    const errors = validateStageModel(draft); if (errors.length) return fail(Errors.INVALID_STAGE_MODEL, { errors });
    return deepFreeze({ ok: true, version: { ...plain(draft), lifecycleStatus: 'PUBLISHED', publishedAt: iso(opts.now), checksum: modelChecksum(draft) } });
  }
  /** impactReport(oldV, newV, journeys) — before publishing a new model */
  function impactReport(oldV, newV, journeys = []) {
    const oc = new Map(oldV.stages.map(s => [s.code, s])), nc = new Map(newV.stages.map(s => [s.code, s]));
    const key = (v, t) => { const s = id => stageOf(v, id).code; return s(t.fromStageId) + '>' + s(t.toStageId) + (t.requireReason ? '!' : ''); };
    const ot = new Set(oldV.transitions.map(t => key(oldV, t))), nt = new Set(newV.transitions.map(t => key(newV, t)));
    const removed = [...oc.keys()].filter(c => !nc.has(c));
    const onModel = journeys.filter(j => j.stageModelVersionId === oldV.id && (j.lifecycleStatus === 'ACTIVE' || j.lifecycleStatus === 'PAUSED'));
    return deepFreeze({ stagesAdded: [...nc.keys()].filter(c => !oc.has(c)), stagesRemoved: removed, transitionsAdded: [...nt].filter(x => !ot.has(x)), transitionsRemoved: [...ot].filter(x => !nt.has(x)),
      terminalSemanticsChanged: [...oc.keys()].filter(c => nc.has(c) && (oc.get(c).terminal !== nc.get(c).terminal || oc.get(c).category !== nc.get(c).category)),
      journeysNeedingMigration: onModel.length, unmappableStages: removed.filter(c => onModel.some(j => stageOf(oldV, j.currentStageId).code === c)), autoMigration: false });
  }
  /** migrationPlan(oldV, newV, explicitMap { oldCode: newCode }) — same code maps by default; everything else needs review */
  function migrationPlan(oldV, newV, explicit = {}) {
    const mappings = [], unmapped = [];
    for (const s of oldV.stages) { const to = stageOf(newV, explicit[s.code] || s.code); if (to) mappings.push({ fromStageId: s.id, toStageId: to.id, fromCode: s.code, toCode: to.code, explicit: !!explicit[s.code] }); else unmapped.push(s.code); }
    return deepFreeze({ fromVersionId: oldV.id, toVersionId: newV.id, mappings, unmapped, requiresReview: true, approved: false });
  }
  /** applyMigrationPlan(journey, plan, { approvedBy }) → journey on the new model with a corrective transition (never silent) */
  function applyMigrationPlan(journey, plan, opts = {}) {
    if (!plan.approved && !opts.approvedBy) return fail('PLAN_NOT_APPROVED');
    if (journey.stageModelVersionId !== plan.fromVersionId) return fail(Errors.STAGE_MODEL_MISMATCH);
    const m = plan.mappings.find(x => x.fromStageId === journey.currentStageId); if (!m) return fail('UNMAPPED_STAGE');
    const now = iso(opts.now), rev = journey.recordRevision + 1;
    const t = { id: newId('jst', opts), organizationId: journey.organizationId, journeyId: journey.id, fromStageId: journey.currentStageId, toStageId: m.toStageId, stageModelVersionId: plan.toVersionId, reasonCode: 'STAGE_MODEL_MIGRATION', actorType: 'SYSTEM', actorRef: opts.approvedBy || null, occurredAt: now, recordRevisionAfter: rev };
    return deepFreeze({ ok: true, journey: { ...plain(journey), currentStageId: m.toStageId, stageModelVersionId: plan.toVersionId, recordRevision: rev, updatedAt: now }, transition: t });
  }

  // ------------------------------------------------------------------ journey aggregate
  const isOpen = j => j.lifecycleStatus === 'ACTIVE' || j.lifecycleStatus === 'PAUSED';
  /** createJourney(input, { organizationId, model, existing, actorId, now, can }) → { journey, transition, events } */
  function createJourney(input = {}, opts = {}) {
    const org = opts.organizationId || input.organizationId, can = opts.can || (() => false);
    if (!org) return fail(Errors.MISSING_ORGANIZATION);
    if (!input.customerId || !ID_RE.test(input.customerId)) return fail(Errors.MISSING_CUSTOMER);
    if (!can('journey.create')) return fail(Errors.NO_GRANT);
    const type = input.journeyType || 'PURCHASE'; if (!JourneyType[type]) return fail(Errors.INVALID_TYPE);
    const model = opts.model || currentModel(org); if (!model) return fail(Errors.NO_STAGE_MODEL); if (model.lifecycleStatus !== 'PUBLISHED') return fail(Errors.STAGE_MODEL_NOT_PUBLISHED);
    const u = Object.assign({ maxActivePerKey: 1 }, cfg().uniquenessPolicy || {}, opts.uniquenessPolicy || {});
    const same = (opts.existing || []).filter(j => j.organizationId === org && j.customerId === input.customerId && (j.developmentId || null) === (input.developmentId || null) && j.journeyType === type && isOpen(j));
    if (u.maxActivePerKey != null && same.length >= u.maxActivePerKey) return fail(Errors.ACTIVE_JOURNEY_EXISTS, { journeyIds: same.map(j => j.id) });
    const now = iso(opts.now), actor = opts.actorId || null, id = input.id || newId('jny', opts);
    const journey = { id, organizationId: org, customerId: input.customerId, developmentId: input.developmentId || undefined, productRef: input.productRef || undefined, journeyType: type, lifecycleStatus: 'ACTIVE',
      currentStageId: model.entryStageId, stageModelVersionId: model.id, ownerAssignmentRef: undefined, acquisitionContextId: undefined, currentNextActionId: undefined, currentOutcomeId: undefined,
      createdAt: now, updatedAt: now, startedAt: now, createdBy: actor, recordRevision: 1 };
    const transition = { id: newId('jst', opts), organizationId: org, journeyId: id, fromStageId: undefined, toStageId: model.entryStageId, stageModelVersionId: model.id, reasonCode: 'JOURNEY_CREATED', actorType: actor ? 'USER' : 'SYSTEM', actorRef: actor || undefined, occurredAt: now, recordRevisionAfter: 1 };
    const ev = makeEvent(journey, { type: 'JOURNEY_CREATED', source: 'MANUAL', actorType: actor ? 'USER' : 'SYSTEM', actorRef: actor, payload: { developmentId: input.developmentId || null, journeyType: type }, occurredAt: now, idempotencyKey: 'created:' + id }, opts);
    let assignment;
    if (input.ownerUserId) assignment = { id: newId('jas', opts), organizationId: org, journeyId: id, assigneeType: 'USER', assigneeId: input.ownerUserId, role: 'OWNER', status: 'ACTIVE', assignedAt: now, assignedBy: actor, copiedFromCustomerAssignmentId: input.customerAssignmentId || undefined };
    if (assignment) journey.ownerAssignmentRef = assignment.id;
    return deepFreeze({ ok: true, journey, transition, assignment, events: [ev.event] });
  }
  /** checks shared by every mutation */
  function guardMutation(journey, opts, perm) {
    if (opts.expectedRevision == null || opts.expectedRevision !== journey.recordRevision) return fail(Errors.JOURNEY_REVISION_CONFLICT, { currentRevision: journey.recordRevision });
    if (perm && !(opts.can || (() => false))(perm)) return fail(Errors.NO_GRANT);
    if (opts.connectivity != null) { const off = requireOnline(perm === 'journey.close' ? 'outcome' : perm === 'journey.transition' ? 'transition' : 'other', opts.connectivity); if (off) return off; }
    return null;
  }
  function cleanNote(note) { if (note == null) return { ok: true }; const n = String(note).trim().slice(0, 500); if (piiLike(n)) return fail(Errors.CONTAINS_CONTACT_DATA); return { ok: true, note: n || undefined }; }
  /** transition(journey, { toStageId, reasonCode, note, override }, { model, expectedRevision, can, actorId, viaOutcome, now }) →
      { journey, transition, event } — validate → insert transition → update currentStageId → revision+1 → append event (one unit) */
  function transition(journey, cmd = {}, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.transition'); if (g) return g;
    if (journey.lifecycleStatus !== 'ACTIVE') return fail(Errors.JOURNEY_NOT_ACTIVE);
    const model = opts.model || modelVersionById(journey.organizationId, journey.stageModelVersionId);
    if (!model || model.id !== journey.stageModelVersionId) return fail(Errors.STAGE_MODEL_MISMATCH);
    const to = stageOf(model, cmd.toStageId); if (!to) return fail(Errors.UNKNOWN_STAGE);
    if (to.id === journey.currentStageId) return fail(Errors.SAME_STAGE);
    if (to.terminal && !opts.viaOutcome) return fail(Errors.OUTCOME_REQUIRED);
    const can = opts.can || (() => false), reg = registry();
    let def = model.transitions.find(t => t.fromStageId === journey.currentStageId && t.toStageId === to.id && t.allowed !== false), override = false;
    if (!def) {
      if (!cmd.override) return fail(Errors.TRANSITION_NOT_ALLOWED);
      if (!can('journey.overrideTransition')) return fail(Errors.NO_GRANT);
      if (!cmd.reasonCode || !reg.override.has(cmd.reasonCode)) return fail(cmd.reasonCode ? Errors.INVALID_REASON : Errors.REASON_REQUIRED);
      override = true; def = { id: 'override', requireReason: true };
    }
    if (def.requiredPermission && !can(def.requiredPermission)) return fail(Errors.NO_GRANT);
    if (def.requireReason && !cmd.reasonCode) return fail(Errors.REASON_REQUIRED);
    if (def.requireOutcomeData && !opts.viaOutcome) return fail(Errors.OUTCOME_REQUIRED);
    const n = cleanNote(cmd.note); if (!n.ok) return n;
    const now = iso(opts.now), rev = journey.recordRevision + 1, actorType = opts.actorType || (opts.actorId ? 'USER' : 'SYSTEM');
    const tr = { id: newId('jst', opts), organizationId: journey.organizationId, journeyId: journey.id, fromStageId: journey.currentStageId, toStageId: to.id, stageModelVersionId: model.id, reasonCode: cmd.reasonCode || undefined, note: n.note,
      actorType, actorRef: opts.actorId || undefined, occurredAt: cmd.occurredAt ? iso(cmd.occurredAt) : now, sourceEventId: cmd.sourceEventId || undefined, recordRevisionAfter: rev, override: override || undefined };
    const next = { ...plain(journey), currentStageId: to.id, recordRevision: rev, updatedAt: now, updatedBy: opts.actorId || undefined };
    const ev = makeEvent(next, { type: 'STAGE_CHANGED', source: actorType === 'INTEGRATION' ? 'CRM_SYNC' : 'MANUAL', actorType, actorRef: opts.actorId, occurredAt: tr.occurredAt, subjectRef: { resourceType: 'STAGE_TRANSITION', resourceId: tr.id },
      payload: { fromStageId: tr.fromStageId, toStageId: tr.toStageId, transitionId: def.id, ...(cmd.reasonCode ? { reasonCode: cmd.reasonCode } : {}), ...(override ? { override: true } : {}) }, idempotencyKey: cmd.idempotencyKey || 'transition:' + tr.id }, opts);
    if (!ev.ok) return ev;
    return deepFreeze({ ok: true, journey: next, transition: tr, event: ev.event, audit: override ? { action: 'JourneyStageOverride', journeyId: journey.id, reasonCode: cmd.reasonCode } : { action: 'JourneyStageTransitioned', journeyId: journey.id } });
  }
  /** pause / resume: the stage is preserved; no new journey */
  function pause(journey, cmd = {}, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.pause'); if (g) return g;
    if (journey.lifecycleStatus !== 'ACTIVE') return fail(Errors.JOURNEY_NOT_ACTIVE);
    if (!cmd.reasonCode || !registry().pause.has(cmd.reasonCode)) return fail(cmd.reasonCode ? Errors.INVALID_REASON : Errors.REASON_REQUIRED);
    const now = iso(opts.now), rec = { id: newId('jpr', opts), journeyId: journey.id, reasonCode: cmd.reasonCode, pausedAt: now, pausedBy: opts.actorId || null, expectedResumeAt: cmd.expectedResumeAt ? iso(cmd.expectedResumeAt) : undefined };
    const next = { ...plain(journey), lifecycleStatus: 'PAUSED', pausedAt: now, recordRevision: journey.recordRevision + 1, updatedAt: now };
    const ev = makeEvent(next, { type: 'JOURNEY_PAUSED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, occurredAt: now, payload: { pauseRecordId: rec.id, reasonCode: cmd.reasonCode, ...(rec.expectedResumeAt ? { expectedResumeAt: rec.expectedResumeAt } : {}) }, idempotencyKey: 'pause:' + rec.id }, opts);
    return deepFreeze({ ok: true, journey: next, pauseRecord: rec, event: ev.event });
  }
  function resume(journey, pauseRecord, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.pause'); if (g) return g;
    if (journey.lifecycleStatus !== 'PAUSED') return fail(Errors.JOURNEY_NOT_PAUSED);
    const now = iso(opts.now), rec = { ...plain(pauseRecord), resumedAt: now, resumedBy: opts.actorId || null };
    const next = { ...plain(journey), lifecycleStatus: 'ACTIVE', pausedAt: undefined, recordRevision: journey.recordRevision + 1, updatedAt: now };
    const ev = makeEvent(next, { type: 'JOURNEY_RESUMED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, occurredAt: now, payload: { pauseRecordId: rec.id }, idempotencyKey: 'resume:' + rec.id + ':' + now }, opts);
    return deepFreeze({ ok: true, journey: next, pauseRecord: rec, event: ev.event });
  }
  /** closeOutcome(journey, { type: WON|LOST, reasonCode, relatedResourceRefs, note, override }, opts) — explicit only; the journey references the
      authoritative commercial resource (reservation/sale) and never changes it, nor the lot's availability */
  function closeOutcome(journey, cmd = {}, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.close'); if (g) return g;
    if (journey.lifecycleStatus !== 'ACTIVE') return fail(Errors.JOURNEY_NOT_ACTIVE);
    if (!OutcomeType[cmd.type]) return fail(Errors.INVALID_TYPE);
    if (!opts.actorId) return fail('EXPLICIT_ACTOR_REQUIRED'); // no automatic WON/LOST
    if (cmd.type === 'LOST' && (!cmd.reasonCode || !registry().loss.has(cmd.reasonCode))) return fail(cmd.reasonCode ? Errors.INVALID_REASON : Errors.REASON_REQUIRED);
    const refs = []; for (const r of cmd.relatedResourceRefs || []) { if (!r || !ResourceType[r.resourceType] || !ID_RE.test(String(r.resourceId || ''))) return fail(Errors.INVALID_RESOURCE); refs.push({ resourceType: r.resourceType, resourceId: String(r.resourceId), versionRef: r.versionRef || undefined }); }
    const model = opts.model || modelVersionById(journey.organizationId, journey.stageModelVersionId); if (!model) return fail(Errors.STAGE_MODEL_MISMATCH);
    const toStageId = (cmd.type === 'WON' ? model.wonStageIds : model.lostStageIds)[0];
    const t = transition(journey, { toStageId, reasonCode: cmd.reasonCode || (cmd.type === 'WON' ? 'WON' : undefined), note: cmd.note, override: cmd.override }, { ...opts, viaOutcome: true, connectivity: undefined });
    if (!t.ok) return t;
    const now = iso(opts.now), outcome = { id: newId('jout', opts), organizationId: journey.organizationId, journeyId: journey.id, type: cmd.type, reasonCode: cmd.reasonCode || 'WON', closedAt: now, actorUserId: opts.actorId, relatedResourceRefs: refs, note: t.transition.note };
    const next = { ...plain(t.journey), lifecycleStatus: cmd.type === 'WON' ? 'CLOSED_WON' : 'CLOSED_LOST', closedAt: now, currentOutcomeId: outcome.id };
    const ev = makeEvent(next, { type: cmd.type === 'WON' ? 'JOURNEY_WON' : 'JOURNEY_LOST', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, occurredAt: now, subjectRef: refs[0],
      payload: cmd.type === 'WON' ? { outcomeId: outcome.id, ...(refs.length ? { relatedResourceRefs: refs } : {}) } : { outcomeId: outcome.id, reasonCode: cmd.reasonCode }, idempotencyKey: 'outcome:' + outcome.id }, opts);
    return deepFreeze({ ok: true, journey: next, transition: t.transition, outcome, events: [t.event, ev.event], audit: { action: cmd.type === 'WON' ? 'JourneyClosedWon' : 'JourneyClosedLost', journeyId: journey.id } });
  }
  function archive(journey, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.update'); if (g) return g;
    const now = iso(opts.now); return deepFreeze({ ok: true, journey: { ...plain(journey), lifecycleStatus: 'ARCHIVED', recordRevision: journey.recordRevision + 1, updatedAt: now } });
  }

  // ------------------------------------------------------------------ events (append-only)
  /** makeEvent(journey, input, opts) → { ok, event } — registry-typed, minimal payload, INTERNAL by default */
  function makeEvent(journey, input = {}, opts = {}) {
    const def = eventType(input.type); if (!def) return fail(Errors.UNKNOWN_EVENT_TYPE);
    const source = input.source || 'MANUAL'; if (!EventSource[source]) return fail(Errors.SOURCE_NOT_ALLOWED);
    const allowedSrc = new Set([...(def.allowedSources || []), 'SYSTEM']); if (!allowedSrc.has(source) && !(source === 'IMPORT' && def.code === 'MIGRATED_TO_STAGE')) return fail(Errors.SOURCE_NOT_ALLOWED);
    const actorType = input.actorType || 'USER'; if (!ActorType[actorType]) return fail(Errors.SOURCE_NOT_ALLOWED);
    if (actorType === 'CUSTOMER' && !input.customerActionProven) return fail(Errors.CUSTOMER_ACTOR_UNPROVEN);
    const payload = {}, p = input.payload || {}, allowed = new Set([...(def.payload.required || []), ...(def.payload.allowed || [])]);
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) continue;
      if (RAW_KEYS.test(k) && !allowed.has(k)) return fail(Errors.RAW_CONTENT_NOT_ALLOWED, { key: k });
      if (!allowed.has(k)) return fail(Errors.PAYLOAD_KEY_NOT_ALLOWED, { key: k });
      if (typeof v === 'string' && piiLike(v) && !/Id$|Ids$|At$|For$/.test(k) && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(v)) return fail(Errors.CONTAINS_CONTACT_DATA, { key: k });
      payload[k] = plain(v);
    }
    for (const k of def.payload.required || []) if (payload[k] == null) return fail(Errors.PAYLOAD_MISSING_FIELD, { key: k });
    const vis = input.visibility || 'INTERNAL'; if (!Visibility[vis]) return fail(Errors.VISIBILITY_NOT_ALLOWED);
    if (vis === 'CLIENT_SAFE' && !def.clientVisible) return fail(Errors.VISIBILITY_NOT_ALLOWED);
    const now = ms(opts.now), occ = input.occurredAt != null ? ms(input.occurredAt) : now;
    if (!Number.isFinite(occ)) return fail(Errors.INVALID_DATE);
    if (occ > now + 5 * 60 * 1000) return fail(Errors.OCCURRED_AT_IN_FUTURE);
    if (input.subjectRef && (!input.subjectRef.resourceType || !ID_RE.test(String(input.subjectRef.resourceId || '')))) return fail(Errors.INVALID_RESOURCE);
    return deepFreeze({ ok: true, event: { id: newId('jev', opts), organizationId: journey.organizationId, journeyId: journey.id, customerId: journey.customerId, type: def.code, category: def.category,
      occurredAt: iso(occ), recordedAt: iso(now), actorType, actorRef: input.actorRef || undefined, source, subjectRef: input.subjectRef ? { resourceType: input.subjectRef.resourceType, resourceId: String(input.subjectRef.resourceId), versionRef: input.subjectRef.versionRef || undefined } : undefined,
      summaryCode: def.code, payload, visibility: vis, idempotencyKey: input.idempotencyKey || undefined, correlationId: input.correlationId || undefined } });
  }
  /** appendEvent(log, event) → { ok, log, duplicate } — idempotent by idempotencyKey; never mutates existing events */
  function appendEvent(log = [], ev) {
    if (ev.idempotencyKey && log.some(e => e.journeyId === ev.journeyId && e.idempotencyKey === ev.idempotencyKey)) return Object.freeze({ ok: true, duplicate: true, log });
    return Object.freeze({ ok: true, duplicate: false, log: Object.freeze([...log, ev]) });
  }
  /** correctEvent(log, originalEventId, { correctedSummaryCode, correctedPayload, reasonCode }, opts) — original preserved for audit */
  function correctEvent(log, originalId, cmd = {}, opts = {}) {
    const orig = (log || []).find(e => e.id === originalId); if (!orig) return fail(Errors.EVENT_NOT_FOUND);
    if (!cmd.reasonCode) return fail(Errors.REASON_REQUIRED);
    if (cmd.correctedPayload) { const t = makeEvent({ organizationId: orig.organizationId, id: orig.journeyId, customerId: orig.customerId }, { type: cmd.correctedSummaryCode || orig.type, source: orig.source, actorType: orig.actorType === 'CUSTOMER' ? 'USER' : orig.actorType, payload: cmd.correctedPayload, occurredAt: orig.occurredAt }, opts); if (!t.ok) return t; }
    const correction = { id: newId('jcor', opts), originalEventId: originalId, correctedSummaryCode: cmd.correctedSummaryCode || undefined, correctedPayload: cmd.correctedPayload ? plain(cmd.correctedPayload) : undefined, reasonCode: cmd.reasonCode, correctedBy: opts.actorId || null, correctedAt: iso(opts.now) };
    const ev = makeEvent({ organizationId: orig.organizationId, id: orig.journeyId, customerId: orig.customerId }, { type: 'EVENT_CORRECTED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, payload: { originalEventId: originalId, correctionId: correction.id, reasonCode: cmd.reasonCode }, idempotencyKey: 'correction:' + correction.id }, opts);
    return deepFreeze({ ok: true, correction, event: ev.event });
  }

  // ------------------------------------------------------------------ ingestion (domain events → timeline, by policy)
  /** resolveActiveJourney(journeys, { organizationId, customerId, developmentId }) → ActiveJourneyContext resolution */
  function resolveActiveJourney(journeys = [], q = {}) {
    const c = journeys.filter(j => j.organizationId === q.organizationId && j.customerId === q.customerId && (q.developmentId == null || j.developmentId === q.developmentId) && j.lifecycleStatus === 'ACTIVE' && (!q.journeyType || j.journeyType === q.journeyType));
    if (c.length === 1) return Object.freeze({ status: 'RESOLVED', journeyId: c[0].id, customerId: q.customerId, developmentId: c[0].developmentId, candidates: Object.freeze([c[0].id]) });
    return Object.freeze({ status: c.length ? 'SELECTION_REQUIRED' : 'NONE', journeyId: null, customerId: q.customerId || null, developmentId: q.developmentId, candidates: Object.freeze(c.map(j => j.id)), message: c.length ? MESSAGES.SELECTION_REQUIRED : undefined });
  }
  /** ingest(domainEvent, { journeys, log, now }) → { action: IGNORED|UNRESOLVED|DUPLICATE|COALESCED|APPENDED, reason, event, stageSuggestion, actionSuggestion }
      domainEvent = { id, type, organizationId, customerId, developmentId, journeyId?, contextType?, occurredAt, actorUserId?, payload, subjectRef? } */
  function ingest(de = {}, world = {}, opts = {}) {
    const R = (action, reason, extra = {}) => Object.freeze({ ok: true, action, reason, ...extra });
    const pol = registry().ingestion.get(de.type);
    if (!pol) return R('IGNORED', 'NO_INGESTION_POLICY');
    if (!pol.eligible) return R('IGNORED', pol.reason || 'NOT_ELIGIBLE');
    const cond = pol.condition || {};
    if (cond.contextType && de.contextType !== cond.contextType) return R('IGNORED', 'NOT_CUSTOMER_CONTEXT'); // e.g. a broker's personal favorite
    if (cond.requiresCustomer && !de.customerId && !de.journeyId) return R('IGNORED', 'NO_CUSTOMER_CONTEXT');
    if (cond.requiresExplicitPresentation && !(de.payload && de.payload.presentationConfirmed === true)) return R('IGNORED', 'PRESENTATION_NOT_CONFIRMED'); // generated ≠ presented
    const journeys = world.journeys || [];
    let journey = null;
    if (de.journeyId) { journey = journeys.find(j => j.id === de.journeyId) || null; if (!journey) return R('UNRESOLVED', 'JOURNEY_NOT_FOUND'); }
    else if (pol.journeyResolutionStrategy === 'EXPLICIT') return R('UNRESOLVED', 'EXPLICIT_JOURNEY_REQUIRED');
    else { const r = resolveActiveJourney(journeys, { organizationId: de.organizationId, customerId: de.customerId, developmentId: de.developmentId }); if (r.status !== 'RESOLVED') return R('UNRESOLVED', r.status === 'NONE' ? 'NO_ACTIVE_JOURNEY' : 'AMBIGUOUS_JOURNEY', { candidates: r.candidates }); journey = journeys.find(j => j.id === r.journeyId); }
    if (journey.organizationId !== de.organizationId) return R('IGNORED', 'CROSS_TENANT');
    if (de.customerId && journey.customerId !== de.customerId) return R('IGNORED', 'CUSTOMER_MISMATCH');
    const log = world.log || [], key = de.type + ':' + de.id, def = eventType(pol.eventType);
    if (log.some(e => e.journeyId === journey.id && e.idempotencyKey === key)) return R('DUPLICATE', 'ALREADY_INGESTED', { journeyId: journey.id });
    const subj = de.subjectRef || null;
    if (pol.deduplicationPolicy === 'COALESCE_BY_SUBJECT') {
      const win = (pol.coalesceWindowMinutes || 60) * 60000, at = ms(de.occurredAt || opts.now);
      const prev = log.filter(e => e.journeyId === journey.id && (e.type === pol.eventType || e.type === 'COMPARISON_CREATED') && e.subjectRef && subj && e.subjectRef.resourceId === subj.resourceId);
      if (prev.some(e => Math.abs(at - ms(e.occurredAt)) <= win)) return R('COALESCED', 'SAME_SUBJECT_WITHIN_WINDOW', { journeyId: journey.id });
    }
    const allowed = new Set([...(def.payload.required || []), ...(def.payload.allowed || [])]), payload = {};
    for (const [k, v] of Object.entries(de.payload || {})) if (allowed.has(k)) payload[k] = v; // minimization: only what the registry allows
    const source = de.type === 'CrmSyncCompleted' ? 'CRM_SYNC' : 'DOMAIN_EVENT';
    const m = makeEvent(journey, { type: pol.eventType, source, actorType: de.actorUserId ? 'USER' : 'SYSTEM', actorRef: de.actorUserId, occurredAt: de.occurredAt, subjectRef: subj || undefined, payload, idempotencyKey: key, correlationId: de.correlationId }, opts);
    if (!m.ok) return Object.freeze({ ok: false, action: 'REJECTED', reason: m.code, code: m.code });
    const sugg = suggestionsFor(journey, m.event, world.model || modelVersionById(journey.organizationId, journey.stageModelVersionId), opts);
    return Object.freeze({ ok: true, action: 'APPENDED', journeyId: journey.id, event: m.event, ...sugg });
  }
  /** stage / next-action suggestions for an event (PENDING; automation is off by default) */
  function suggestionsFor(journey, ev, model, opts = {}) {
    const def = eventType(ev.type), out = { stageSuggestion: null, actionSuggestion: null, autoTransitionEligible: false };
    if (def && def.stageSuggestion && model) {
      const to = stageOf(model, def.stageSuggestion), cur = stageOf(model, journey.currentStageId);
      if (to && cur && to.order > cur.order && !to.terminal) {
        const tr = model.transitions.find(t => t.fromStageId === cur.id && t.toStageId === to.id);
        out.stageSuggestion = deepFreeze({ id: newId('jss', opts), journeyId: journey.id, suggestedStageId: to.id, reasonCode: 'EVENT_' + ev.type, sourceEventId: ev.id, status: 'PENDING', createdAt: iso(opts.now), transitionId: tr ? tr.id : null });
        const ap = automationPolicy(); out.autoTransitionEligible = !!(ap.allowAutoStageTransition && tr && ap.trustedEventTypes.includes(ev.type) && ap.allowedTransitionIds.includes(tr.id));
      }
    }
    if (def && def.actionSuggestion && registry().actions.has(def.actionSuggestion.type)) out.actionSuggestion = deepFreeze({ id: newId('jas', opts), journeyId: journey.id, type: def.actionSuggestion.type, reasonCode: def.actionSuggestion.reasonCode || 'EVENT_' + ev.type,
      suggestedDueAt: def.actionSuggestion.inHours != null ? iso(ms(ev.occurredAt) + def.actionSuggestion.inHours * 3600000) : undefined, sourceEventId: ev.id, status: 'PENDING' });
    return out;
  }
  const decideSuggestion = (s, status, opts = {}) => ['ACCEPTED', 'DISMISSED', 'EXPIRED'].includes(status) ? deepFreeze({ ...plain(s), status, decidedAt: iso(opts.now), decidedBy: opts.actorId || null }) : fail('INVALID_STATUS');

  // ------------------------------------------------------------------ touchpoints, acquisition, artifact links
  /** recordTouchpoint(journey, input, opts) → { touchpoint, event? } — no raw conversation, summary ≤ 280 chars without contact data */
  function recordTouchpoint(journey, input = {}, opts = {}) {
    if (!(opts.can || (() => false))('journey.timeline.record')) return fail(Errors.NO_GRANT);
    for (const k of Object.keys(input)) if (RAW_KEYS.test(k)) return fail(Errors.RAW_CONTENT_NOT_ALLOWED, { key: k });
    if (!TouchpointType[input.type]) return fail(Errors.INVALID_TYPE);
    if (!Channel[input.channel]) return fail(Errors.INVALID_CHANNEL);
    if (!Direction[input.direction]) return fail(Errors.INVALID_DIRECTION);
    if (input.outcomeCode != null && !registry().outcomes.has(input.outcomeCode)) return fail(Errors.INVALID_OUTCOME_CODE);
    const summary = input.summary == null ? undefined : String(input.summary).trim().slice(0, 280);
    if (summary && piiLike(summary)) return fail(Errors.CONTAINS_CONTACT_DATA);
    if (input.externalRef != null && !ID_RE.test(String(input.externalRef))) return fail(Errors.INVALID_RESOURCE);
    const now = ms(opts.now), occ = input.occurredAt != null ? ms(input.occurredAt) : now; if (!Number.isFinite(occ)) return fail(Errors.INVALID_DATE);
    const tp = { id: newId('jtp', opts), organizationId: journey.organizationId, journeyId: journey.id, type: input.type, direction: input.direction, channel: input.channel, occurredAt: iso(occ), actorUserId: opts.actorId || undefined,
      externalRef: input.externalRef || undefined, outcomeCode: input.outcomeCode || undefined, summary, visibility: Visibility[input.visibility] && input.visibility !== 'CLIENT_SAFE' ? input.visibility : 'INTERNAL' };
    const evType = input.type === 'VISIT' ? 'VISIT_COMPLETED' : (input.type === 'CONVERSATION' || input.type === 'MEETING') ? 'CUSTOMER_CONTACTED' : null;
    let event;
    if (evType) {
      const src = input.channel === 'WHATSAPP' ? 'WHATSAPP' : input.channel === 'PHONE' ? 'PHONE' : input.channel === 'EMAIL' ? 'EMAIL' : 'MANUAL';
      const m = makeEvent(journey, { type: evType, source: evType === 'VISIT_COMPLETED' ? 'MANUAL' : src, actorType: 'USER', actorRef: opts.actorId, occurredAt: tp.occurredAt, subjectRef: { resourceType: 'TOUCHPOINT', resourceId: tp.id },
        payload: evType === 'VISIT_COMPLETED' ? { touchpointId: tp.id } : { touchpointId: tp.id, channel: tp.channel, direction: tp.direction, ...(tp.outcomeCode ? { outcomeCode: tp.outcomeCode } : {}) }, idempotencyKey: 'touchpoint:' + tp.id }, opts);
      if (!m.ok) return m; event = m.event;
    }
    return deepFreeze({ ok: true, touchpoint: tp, event, ...(event ? suggestionsFor(journey, event, opts.model || modelVersionById(journey.organizationId, journey.stageModelVersionId), opts) : {}) });
  }
  /** attribution touch: URLs are reduced to path (no query/fragment), referrer to its domain; unknown source → UNKNOWN */
  function normalizeTouch(t = {}) {
    const out = {}; if (t.occurredAt) out.occurredAt = iso(t.occurredAt);
    for (const k of ['source', 'medium', 'campaign', 'channel', 'provider', 'externalCampaignRef', 'externalAdRef']) if (t[k] != null) { const v = String(t[k]).trim().slice(0, 80); if (v && !piiLike(v)) out[k] = v; }
    if (t.landingPageRef) { const s = String(t.landingPageRef).split(/[?#]/)[0]; if (!piiLike(s)) out.landingPageRef = s.slice(0, 200); }
    if (t.referrerDomain || t.referrer) { const m = String(t.referrerDomain || t.referrer).match(/^(?:[a-z]+:\/\/)?([^/?#:]+)/i); if (m) out.referrerDomain = m[1].toLowerCase(); }
    return out;
  }
  function createAcquisition(journey, input = {}, opts = {}) {
    const code = input.primarySourceCode && registry().sources.has(input.primarySourceCode) ? input.primarySourceCode : 'UNKNOWN';
    return deepFreeze({ ok: true, acquisition: { id: newId('jacq', opts), organizationId: journey.organizationId, journeyId: journey.id, firstTouch: normalizeTouch(input.firstTouch), latestTouch: input.latestTouch ? normalizeTouch(input.latestTouch) : undefined,
      primarySourceCode: code, primaryAttributionRule: cfg().primaryAttributionRule || 'FIRST_TOUCH', externalLeadRef: input.externalLeadRef && ID_RE.test(String(input.externalLeadRef)) ? String(input.externalLeadRef) : undefined, capturedAt: iso(opts.now) },
      warnings: input.primarySourceCode && code === 'UNKNOWN' ? ['UNKNOWN_SOURCE_CODE'] : [] });
  }
  /** latest touch evolves; first touch never changes */
  const updateLatestTouch = (acq, touch) => deepFreeze({ ...plain(acq), latestTouch: normalizeTouch(touch) });
  /** linkArtifact(journey, { resourceType, resourceId, relationType, versionRef }, opts) — reference only, never a copy */
  function linkArtifact(journey, input = {}, opts = {}) {
    if (!(opts.can || (() => false))('journey.update')) return fail(Errors.NO_GRANT);
    for (const k of Object.keys(input)) if (!['resourceType', 'resourceId', 'relationType', 'versionRef'].includes(k)) return fail(Errors.RAW_CONTENT_NOT_ALLOWED, { key: k });
    if (!ResourceType[input.resourceType] || !ID_RE.test(String(input.resourceId || ''))) return fail(Errors.INVALID_RESOURCE);
    const ex = (opts.existing || []).find(l => l.journeyId === journey.id && l.resourceType === input.resourceType && l.resourceId === String(input.resourceId) && l.relationType === (input.relationType || 'RELATED'));
    if (ex) return Object.freeze({ ok: true, duplicate: true, link: ex });
    const link = { id: newId('jlk', opts), organizationId: journey.organizationId, journeyId: journey.id, resourceType: input.resourceType, resourceId: String(input.resourceId), versionRef: input.versionRef || undefined, relationType: input.relationType || 'RELATED', linkedAt: iso(opts.now), linkedBy: opts.actorId || undefined };
    const m = makeEvent(journey, { type: 'ARTIFACT_LINKED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, subjectRef: { resourceType: link.resourceType, resourceId: link.resourceId, versionRef: link.versionRef }, payload: { linkId: link.id, resourceType: link.resourceType, relationType: link.relationType }, idempotencyKey: 'link:' + link.id }, opts);
    return deepFreeze({ ok: true, link, event: m.event });
  }
  /** "Registrar como opção apresentada" (QuickView) — explicit broker action; opening the QuickView alone records nothing */
  function recordOptionPresented(journey, { lotId, recommendationResultId } = {}, opts = {}) {
    if (!(opts.can || (() => false))('journey.timeline.record')) return fail(Errors.NO_GRANT);
    return makeEvent(journey, { type: 'OPTION_PRESENTED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, subjectRef: { resourceType: 'LOT', resourceId: lotId }, payload: { lotId, ...(recommendationResultId ? { recommendationResultId } : {}) }, idempotencyKey: opts.idempotencyKey }, opts);
  }

  // ------------------------------------------------------------------ next actions and attention
  function createNextAction(journey, input = {}, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.nextAction.manage'); if (g) return g;
    if (!isOpen(journey)) return fail(Errors.JOURNEY_NOT_ACTIVE);
    if (!registry().actions.has(input.type)) return fail(Errors.INVALID_ACTION_TYPE);
    const title = String(input.title || '').trim().slice(0, 120) || actionLabel(input.type); if (piiLike(title)) return fail(Errors.CONTAINS_CONTACT_DATA);
    const d = cleanNote(input.description); if (!d.ok) return d;
    if (input.dueAt != null && !Number.isFinite(ms(input.dueAt))) return fail(Errors.INVALID_DATE);
    const now = iso(opts.now), a = { id: newId('jna', opts), organizationId: journey.organizationId, journeyId: journey.id, type: input.type, title, description: d.note, dueAt: input.dueAt != null ? iso(input.dueAt) : undefined,
      assigneeUserId: input.assigneeUserId || opts.actorId || undefined, status: 'OPEN', priority: ['LOW', 'NORMAL', 'HIGH'].includes(input.priority) ? input.priority : 'NORMAL', createdAt: now, createdBy: opts.actorId || null, recordRevision: 1, fromSuggestionId: input.fromSuggestionId || undefined };
    const primary = input.primary !== false, next = primary ? { ...plain(journey), currentNextActionId: a.id, recordRevision: journey.recordRevision + 1, updatedAt: now } : journey;
    const m = makeEvent(journey, { type: 'FOLLOW_UP_CREATED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, subjectRef: { resourceType: 'NEXT_ACTION', resourceId: a.id }, payload: { nextActionId: a.id, type: a.type, ...(a.dueAt ? { dueAt: a.dueAt } : {}) }, idempotencyKey: 'na:' + a.id }, opts);
    return deepFreeze({ ok: true, journey: next, nextAction: a, event: m.event });
  }
  function finishNextAction(journey, action, status, opts = {}) {
    if (!(opts.can || (() => false))('journey.nextAction.manage')) return fail(Errors.NO_GRANT);
    if (opts.expectedRevision !== action.recordRevision) return fail(Errors.JOURNEY_REVISION_CONFLICT, { currentRevision: action.recordRevision });
    if (action.status !== 'OPEN') return fail(Errors.ACTION_NOT_OPEN);
    const now = iso(opts.now), a = { ...plain(action), status, completedAt: now, completedBy: opts.actorId || null, completionReasonCode: opts.reasonCode || undefined, recordRevision: action.recordRevision + 1 };
    const m = makeEvent(journey, { type: status === 'COMPLETED' ? 'FOLLOW_UP_COMPLETED' : 'FOLLOW_UP_CANCELLED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, subjectRef: { resourceType: 'NEXT_ACTION', resourceId: a.id }, payload: { nextActionId: a.id, ...(opts.reasonCode ? { completionReasonCode: opts.reasonCode } : {}) }, idempotencyKey: 'na-end:' + a.id }, opts);
    return deepFreeze({ ok: true, nextAction: a, event: m.event });
  }
  const completeNextAction = (j, a, opts) => finishNextAction(j, a, 'COMPLETED', opts);
  const cancelNextAction = (j, a, opts) => finishNextAction(j, a, 'CANCELLED', opts);
  /** acceptSuggestion(journey, suggestion, opts) → creates the action from a PENDING suggestion (explicit) */
  function acceptSuggestion(journey, s, opts = {}) {
    if (s.status !== 'PENDING') return fail('SUGGESTION_NOT_PENDING');
    const r = createNextAction(journey, { type: s.type, dueAt: s.suggestedDueAt, fromSuggestionId: s.id }, opts); if (!r.ok) return r;
    return deepFreeze({ ...plain(r), suggestion: decideSuggestion(s, 'ACCEPTED', opts) });
  }
  const actionLabel = t => ({ CONTACT: 'Fazer contato', FOLLOW_UP: 'Retornar ao cliente', COMPLETE_PROFILE: 'Completar o perfil', PREPARE_RECOMMENDATION: 'Preparar opções', PRESENT_OPTIONS: 'Apresentar opções', SCHEDULE_VISIT: 'Agendar visita',
    FOLLOW_UP_VISIT: 'Retornar após a visita', PREPARE_SIMULATION: 'Preparar simulação', REQUEST_DOCUMENT: 'Solicitar documento', FOLLOW_UP_PROPOSAL: 'Acompanhar proposta', WAIT_CUSTOMER: 'Aguardar o cliente', OTHER: 'Próxima ação' })[t] || 'Próxima ação';
  /** readState(action, now) → OPEN | DUE_SOON | OVERDUE | COMPLETED | CANCELLED (OVERDUE is derived, never stored) */
  function readState(a, now) {
    if (!a) return null; if (a.status !== 'OPEN') return a.status;
    if (!a.dueAt) return 'OPEN'; const left = ms(a.dueAt) - ms(now), soon = (cfg().nextActionDueSoonHours || 24) * 3600000;
    return left < 0 ? 'OVERDUE' : left <= soon ? 'DUE_SOON' : 'OPEN';
  }
  /** activitySummary(events) → { lastMeaningfulEventAt, lastCustomerTouchAt, lastBrokerActionAt } — technical/sync events never count */
  function activitySummary(events = []) {
    const out = { lastMeaningfulEventAt: undefined, lastCustomerTouchAt: undefined, lastBrokerActionAt: undefined }, mx = (k, v) => { if (!out[k] || v > out[k]) out[k] = v; };
    for (const e of events) { const d = eventType(e.type); if (!d) continue; if (d.countsAsMeaningfulActivity) mx('lastMeaningfulEventAt', e.occurredAt); if (d.customerTouch) mx('lastCustomerTouchAt', e.occurredAt); if (d.brokerAction && e.actorType === 'USER') mx('lastBrokerActionAt', e.occurredAt); }
    return Object.freeze(out);
  }
  /** aging(journey, activity, nextAction, now, model) → { level: NONE|WARNING|CRITICAL, policy } — stage-specific (no universal "X days") */
  function aging(journey, act, na, now, model) {
    const st = stageOf(model || modelVersionById(journey.organizationId, journey.stageModelVersionId), journey.currentStageId), p = st && (cfg().agingPolicies || []).find(x => x.stageCode === st.code);
    if (!p) return Object.freeze({ level: 'NONE', policy: null });
    const base = p.basedOn === 'LAST_CUSTOMER_TOUCH' ? act.lastCustomerTouchAt : p.basedOn === 'NEXT_ACTION_DUE' ? na && na.status === 'OPEN' && na.dueAt : act.lastMeaningfulEventAt;
    if (!base) return Object.freeze({ level: 'NONE', policy: p, reason: 'NO_BASE_TIMESTAMP' });
    const h = (ms(now) - ms(base)) / 3600000;
    return Object.freeze({ level: p.criticalAfterHours != null && h >= p.criticalAfterHours ? 'CRITICAL' : p.warningAfterHours != null && h >= p.warningAfterHours ? 'WARNING' : 'NONE', policy: p });
  }
  /** attention(journey, { nextAction, events, now, model }) → JourneyAttentionState (operational projection, not lifecycle) */
  function attention(journey, ctx = {}) {
    if (journey.lifecycleStatus === 'PAUSED') return 'PAUSED';
    if (journey.lifecycleStatus !== 'ACTIVE') return 'CLOSED';
    const na = ctx.nextAction && ctx.nextAction.status === 'OPEN' ? ctx.nextAction : null, rs = readState(na, ctx.now);
    let s = !na ? 'UNKNOWN' : rs === 'OVERDUE' ? 'OVERDUE' : rs === 'DUE_SOON' ? 'ACTION_DUE' : na.type === 'WAIT_CUSTOMER' ? 'WAITING_CUSTOMER' : 'ON_TRACK';
    const ag = aging(journey, activitySummary(ctx.events || []), na, ctx.now, ctx.model);
    if (ag.level === 'CRITICAL' && (s === 'ON_TRACK' || s === 'UNKNOWN')) s = 'ACTION_DUE';
    return s;
  }

  // ------------------------------------------------------------------ projections
  const VIS_BY_MODE = Object.freeze({ BROKER: ['INTERNAL', 'ASSIGNED_TEAM', 'CLIENT_SAFE'], MANAGER: ['INTERNAL', 'ASSIGNED_TEAM', 'CLIENT_SAFE'], CLIENT_SAFE: ['CLIENT_SAFE'], TECHNICAL: ['INTERNAL', 'ASSIGNED_TEAM', 'CLIENT_SAFE', 'TECHNICAL'], SUMMARY: [] });
  function eventText(e, model, payload) {
    const d = eventType(e.type), title = d ? d.title : e.type;
    if (e.type === 'STAGE_CHANGED' && model) { const a = stageOf(model, payload.fromStageId), b = stageOf(model, payload.toStageId); return `${title}: ${a ? a.title : '—'} → ${b ? b.title : '—'}`; }
    if (e.type === 'JOURNEY_LOST' && payload.reasonCode) return `${title} (${(cfg().lossReasonLabels || {})[payload.reasonCode] || payload.reasonCode})`;
    if (e.type === 'MIGRATED_TO_STAGE') return `${title} — histórico anterior não disponível`;
    return title;
  }
  /** timeline(journey, { events, corrections, mode, cursor, limit, model }) → JourneyTimelineProjection (ordered by occurredAt; recordedAt only in TECHNICAL) */
  function timeline(journey, o = {}) {
    const mode = ProjectionMode[o.mode] ? o.mode : 'BROKER', vis = VIS_BY_MODE[mode], model = o.model || modelVersionById(journey.organizationId, journey.stageModelVersionId);
    const corr = new Map(); for (const c of o.corrections || []) corr.set(c.originalEventId, c);
    let items = (o.events || []).filter(e => e.journeyId === journey.id && e.organizationId === journey.organizationId && vis.includes(e.visibility));
    if (mode === 'CLIENT_SAFE') items = items.filter(e => (eventType(e.type) || {}).clientVisible);
    if (mode !== 'TECHNICAL') items = items.filter(e => e.type !== 'EVENT_CORRECTED' && e.type !== 'CRM_SYNC_COMPLETED');
    items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.recordedAt.localeCompare(a.recordedAt) || (a.id < b.id ? 1 : -1));
    const start = o.cursor ? Math.max(0, parseInt(String(o.cursor).replace(/^o:/, ''), 10) || 0) : 0, limit = o.limit || 50, page = items.slice(start, start + limit);
    const out = page.map(e => {
      const c = corr.get(e.id), payload = c && c.correctedPayload ? c.correctedPayload : e.payload, type = c && c.correctedSummaryCode ? c.correctedSummaryCode : e.type, d = eventType(type) || {};
      const it = { id: e.id, type, category: d.category || e.category, occurredAt: e.occurredAt, text: eventText({ ...e, type }, model, payload), corrected: !!c };
      if (mode === 'CLIENT_SAFE') return it;
      it.subjectRef = e.subjectRef; it.actorType = e.actorType; it.source = e.source;
      if (mode === 'TECHNICAL') Object.assign(it, { recordedAt: e.recordedAt, visibility: e.visibility, idempotencyKey: e.idempotencyKey, correlationId: e.correlationId, payload: e.payload, correctedPayload: c ? c.correctedPayload : undefined, correctionReason: c ? c.reasonCode : undefined });
      return it;
    });
    return deepFreeze({ journeyId: journey.id, mode, items: out, nextCursor: start + limit < items.length ? 'o:' + (start + limit) : undefined, generatedAt: iso(o.now) });
  }
  /** summary(journey, { model, nextAction, events, acquisition, ownerDisplayName, now }) → JourneySummaryReadModel */
  function summary(journey, o = {}) {
    const model = o.model || modelVersionById(journey.organizationId, journey.stageModelVersionId), st = stageOf(model, journey.currentStageId), act = activitySummary(o.events || []), na = o.nextAction && o.nextAction.status === 'OPEN' ? o.nextAction : null;
    return deepFreeze({ journeyId: journey.id, customerId: journey.customerId, developmentId: journey.developmentId, lifecycleStatus: journey.lifecycleStatus,
      currentStage: st ? { id: st.id, code: st.code, title: st.title, order: st.order, category: st.category } : null,
      nextAction: na ? { id: na.id, type: na.type, title: na.title, dueAt: na.dueAt, readState: readState(na, o.now) } : undefined,
      attentionState: attention(journey, { nextAction: na, events: o.events, now: o.now, model }), lastMeaningfulEventAt: act.lastMeaningfulEventAt, activity: act,
      ownerDisplayName: o.ownerDisplayName || undefined, acquisitionSourceLabel: o.acquisition ? (cfg().sourceLabels || {})[o.acquisition.primarySourceCode] || o.acquisition.primarySourceCode : undefined, updatedAt: journey.updatedAt });
  }
  /** contextChip(customerSummary, journeySummary) → "Maria · Negociação" (map-centric chip; no PII beyond the display name) */
  const contextChip = (cs, js) => cs && cs.displayName ? `${String(cs.displayName).split(/\s+/)[0]}${js && js.currentStage ? ' · ' + js.currentStage.title : ''}` : null;
  /** query(journeys, JourneyQuery, { summaries: Map<journeyId, summary>, customerNames: Map<customerId, name> }) — tenant-scoped filter + sort */
  function query(journeys = [], q = {}, o = {}) {
    if (!q.organizationId) return Object.freeze({ ok: false, code: Errors.MISSING_ORGANIZATION, items: [] });
    const S = o.summaries || new Map(), N = o.customerNames || new Map(), norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let items = journeys.filter(j => j.organizationId === q.organizationId).map(j => ({ j, s: S.get(j.id) || summary(j, { now: o.now }) }));
    const inList = (arr, v) => !arr || !arr.length || arr.includes(v);
    items = items.filter(({ j, s }) => inList(q.developmentIds, j.developmentId) && inList(q.stageIds, j.currentStageId) && inList(q.lifecycleStatuses, j.lifecycleStatus) && inList(q.attentionStates, s.attentionState)
      && (!q.ownerUserIds || !q.ownerUserIds.length || q.ownerUserIds.includes((o.owners || new Map()).get(j.id)))
      && (!q.acquisitionSourceCodes || !q.acquisitionSourceCodes.length || q.acquisitionSourceCodes.includes((o.sources || new Map()).get(j.id) || 'UNKNOWN'))
      && (!q.nextActionDueBefore || (s.nextAction && s.nextAction.dueAt && s.nextAction.dueAt < iso(q.nextActionDueBefore)))
      && (!q.nextActionDueAfter || (s.nextAction && s.nextAction.dueAt && s.nextAction.dueAt > iso(q.nextActionDueAfter)))
      && (!q.customerSearch || norm(N.get(j.customerId)).includes(norm(q.customerSearch))));
    const sort = Sort[q.sort] ? q.sort : 'RECENT_ACTIVITY', key = {
      RECENT_ACTIVITY: (a, b) => String(b.s.lastMeaningfulEventAt || '').localeCompare(String(a.s.lastMeaningfulEventAt || '')), OLDEST_ACTIVITY: (a, b) => String(a.s.lastMeaningfulEventAt || '').localeCompare(String(b.s.lastMeaningfulEventAt || '')),
      NEXT_ACTION_DUE: (a, b) => String((a.s.nextAction || {}).dueAt || '9').localeCompare(String((b.s.nextAction || {}).dueAt || '9')), CUSTOMER_NAME: (a, b) => norm(N.get(a.j.customerId)).localeCompare(norm(N.get(b.j.customerId))),
      STAGE_ORDER: (a, b) => ((a.s.currentStage || {}).order || 0) - ((b.s.currentStage || {}).order || 0), CREATED_AT: (a, b) => String(b.j.createdAt).localeCompare(String(a.j.createdAt)) }[sort];
    items.sort((a, b) => key(a, b) || (a.j.id < b.j.id ? -1 : 1));
    return Object.freeze({ ok: true, sort, items: Object.freeze(items.map(x => x.s)) });
  }
  /** board(summaries, model, { customerNames, owners }) → JourneyBoardReadModel (Kanban is a projection; moving a card calls transition) */
  function board(summaries = [], model, o = {}) {
    const N = o.customerNames || new Map();
    const cols = model.stages.map(st => ({ stageId: st.id, code: st.code, title: st.title, order: st.order, terminal: st.terminal,
      cards: summaries.filter(s => s.currentStage && s.currentStage.id === st.id).map(s => ({ journeyId: s.journeyId, customerDisplayName: N.get(s.customerId) || 'Cliente', stageTitle: st.title, nextAction: s.nextAction ? { title: s.nextAction.title, dueAt: s.nextAction.dueAt, readState: s.nextAction.readState } : null, attentionState: s.attentionState, ownerDisplayName: s.ownerDisplayName || null })) }));
    return deepFreeze({ stageModelVersionId: model.id, stageColumns: cols, generatedAt: iso(o.now) });
  }
  /** allowedMoves(journey, model) → transitions the UI may offer (drag & drop / menu); terminal ones need the outcome form */
  function allowedMoves(journey, model) {
    if (journey.lifecycleStatus !== 'ACTIVE') return [];
    return model.transitions.filter(t => t.fromStageId === journey.currentStageId && t.allowed !== false).map(t => { const s = stageOf(model, t.toStageId); return Object.freeze({ transitionId: t.id, toStageId: s.id, title: s.title, requireReason: !!t.requireReason, requiresOutcome: !!(t.requireOutcomeData || s.terminal), requiredPermission: t.requiredPermission || 'journey.transition' }); }).sort((a, b) => stageOf(model, a.toStageId).order - stageOf(model, b.toStageId).order);
  }

  // ------------------------------------------------------------------ access
  /** decideAccess({ journey, principal, journeyAssignments, customerAssignments, can }) → { allowed, level, reasonCodes, canTransition, canClose, canRecord } */
  function decideAccess({ journey, principal = {}, journeyAssignments = [], customerAssignments = [], can = () => false } = {}) {
    const D = codes => Object.freeze({ allowed: false, level: 'NONE', reasonCodes: Object.freeze(codes), canTransition: false, canClose: false, canRecord: false });
    if (!journey || !principal.organizationId || principal.organizationId !== journey.organizationId) return D(['NOT_FOUND']);
    const mine = a => a.status === 'ACTIVE' && ((a.assigneeType === 'USER' && a.assigneeId === principal.userId) || (a.assigneeType === 'TEAM' && (principal.teamIds || []).includes(a.assigneeId)));
    const assigned = journeyAssignments.some(a => a.journeyId === journey.id && mine(a)) || customerAssignments.some(a => a.customerId === journey.customerId && mine(a) && a.role !== 'VIEWER');
    let level;
    if (can('journey.read')) level = can('journey.technical.read') ? 'TECHNICAL' : 'MANAGER';
    else if (can('journey.readAssigned') && assigned) level = 'BROKER';
    else return D([can('journey.readAssigned') ? 'NOT_ASSIGNED' : 'NO_GRANT']);
    const active = journey.lifecycleStatus === 'ACTIVE', writer = level !== 'BROKER' || assigned;
    return Object.freeze({ allowed: true, level, reasonCodes: Object.freeze(['ALLOWED']), canTransition: active && writer && can('journey.transition'), canClose: active && writer && can('journey.close'), canRecord: writer && isOpen(journey) && can('journey.timeline.record'), canReadTimeline: can('journey.timeline.read') || level !== 'BROKER' || assigned });
  }

  // ------------------------------------------------------------------ external CRM
  /** mapExternalStage(policies, provider, externalStageCode, direction) → { internalStageId } | { conflict: 'UNMAPPED_EXTERNAL_STAGE' } */
  function mapExternalStage(policies = [], provider, code, direction = 'IMPORT') {
    const p = policies.find(x => x.provider === provider && x.externalStageCode === code && (x.direction === direction || x.direction === 'BIDIRECTIONAL'));
    return p ? Object.freeze({ internalStageId: p.internalStageId, conflictMode: p.conflictMode || 'MANUAL_REVIEW' }) : Object.freeze({ conflict: 'UNMAPPED_EXTERNAL_STAGE' });
  }
  /** applyExternalStage(journey, { provider, externalStageCode, externalEventId }, { policies, externalRef, processedKeys, model, can }) →
      { action: DUPLICATE | NO_CHANGE | CONFLICT | TRANSITION, conflict?, transition? } — never a blind bidirectional sync */
  function applyExternalStage(journey, ext = {}, o = {}) {
    const key = ext.provider + ':' + ext.externalEventId; if (o.processedKeys && o.processedKeys.has(key)) return Object.freeze({ ok: true, action: 'DUPLICATE' });
    const C = (field, status, extra = {}) => Object.freeze({ ok: true, action: 'CONFLICT', key, conflict: Object.freeze({ id: newId('jsc', o), organizationId: journey.organizationId, journeyId: journey.id, provider: ext.provider, field, internalValueRef: journey.currentStageId, externalValueRef: ext.externalStageCode, status, detectedAt: iso(o.now), ...extra }) });
    const mode = (o.externalRef || {}).authorityMode || 'REFERENCE_ONLY';
    const m = mapExternalStage(o.policies || cfg().stageMappingPolicies || [], ext.provider, ext.externalStageCode, 'IMPORT');
    if (m.conflict) return C('stage', 'OPEN', { reasonCode: m.conflict });
    if (m.internalStageId === journey.currentStageId) return Object.freeze({ ok: true, action: 'NO_CHANGE', key });
    if (mode === 'REFERENCE_ONLY' || mode === 'INTERNAL_MASTER' || m.conflictMode === 'INTERNAL_WINS') return C('stage', 'IGNORED', { reasonCode: 'INTERNAL_AUTHORITY' });
    if (m.conflictMode === 'MANUAL_REVIEW' || mode === 'HYBRID') return C('stage', 'OPEN', { reasonCode: 'MANUAL_REVIEW' });
    const t = transition(journey, { toStageId: m.internalStageId, reasonCode: 'CRM_SYNC', idempotencyKey: 'crm:' + key }, { ...o, expectedRevision: journey.recordRevision, actorType: 'INTEGRATION', actorId: undefined });
    if (!t.ok) return C('stage', 'OPEN', { reasonCode: t.code });
    return Object.freeze({ ok: true, action: 'TRANSITION', key, ...t });
  }

  // ------------------------------------------------------------------ legacy pipeline migration
  /** inventory(records, { stageField, stageMap }) → LegacyJourneyInventoryItem[] (migrationMappingCertainty, not data confidence) */
  function inventory(records = [], o = {}) {
    const field = o.stageField || 'status', map = o.stageMap || {}, counts = new Map();
    for (const r of records) { const v = r && r[field] != null ? String(r[field]) : null; if (v == null) continue; counts.set(v, (counts.get(v) || 0) + 1); }
    return [...counts].map(([label, n]) => { const p = map[label]; return Object.freeze({ sourceLocation: o.sourceLocation || 'legacy', legacyStageCode: label, legacyLabel: label, occurrenceCount: n, proposedStageId: p ? p.stageId : undefined, migrationMappingCertainty: p ? p.certainty || 'HIGH' : 'LOW', requiresHumanReview: !p || (p.certainty && p.certainty !== 'HIGH') }); });
  }
  /** migrateLegacy(records, { organizationId, model, stageMap, sourceMap, existingIds, now, migrationVersion }) → { journeys, transitions, events, nextActions, outcomes, duplicates, report }
      record: { legacyId, customerId, developmentId, status, source, ownerUserId, nextFollowUpAt, outcome: { type, reasonCode }, createdAt, notes } */
  function migrateLegacy(records = [], o = {}) {
    const model = o.model || currentModel(o.organizationId), map = o.stageMap || {}, smap = o.sourceMap || {}, mv = o.migrationVersion || 'legacy-journey/1', existing = new Set(o.existingIds || []);
    const now = iso(o.now), out = { journeys: [], transitions: [], events: [], nextActions: [], outcomes: [], acquisitions: [], duplicates: [] };
    const rep = { legacyRecordsFound: records.length, journeysCreated: 0, alreadyMigrated: 0, stageMappings: {}, unresolvedStages: [], lossReasonsMapped: 0, sourceMappings: {}, ownersMapped: 0, followUpsMigrated: 0, historyUnavailableCount: 0,
      duplicateActiveJourneyCandidates: 0, outcomeAmbiguities: [], rawNotesExcluded: 0, manualReviewRequired: [], migrationVersion: mv };
    const byKey = new Map();
    for (const r of records) {
      if (!r || !r.legacyId || !r.customerId) { rep.manualReviewRequired.push({ legacyId: r && r.legacyId || null, reason: 'MISSING_IDENTITY' }); continue; }
      const id = 'jny_mig_' + checksum([o.organizationId, r.legacyId]); if (existing.has(id)) { rep.alreadyMigrated++; continue; }
      const m = map[r.status]; const st = m && stageOf(model, m.stageId || m);
      if (!st) { rep.unresolvedStages.push({ legacyId: r.legacyId, legacyStage: r.status == null ? null : String(r.status) }); continue; } // no arbitrary stage
      rep.stageMappings[r.status] = st.code;
      let lifecycle = 'ACTIVE', outcome;
      if (st.terminal || r.outcome) {
        const ot = r.outcome && OutcomeType[r.outcome.type] ? r.outcome.type : null;
        const stageType = model.wonStageIds.includes(st.id) ? 'WON' : model.lostStageIds.includes(st.id) ? 'LOST' : null;
        if (!ot || (stageType && ot !== stageType) || (ot === 'LOST' && !registry().loss.has(r.outcome.reasonCode))) { rep.outcomeAmbiguities.push({ legacyId: r.legacyId, reason: !ot ? 'NO_EXPLICIT_OUTCOME' : 'OUTCOME_INCONSISTENT' }); continue; }
        lifecycle = ot === 'WON' ? 'CLOSED_WON' : 'CLOSED_LOST'; if (ot === 'LOST') rep.lossReasonsMapped++;
        outcome = { id: 'jout_mig_' + checksum([id]), organizationId: o.organizationId, journeyId: id, type: ot, reasonCode: r.outcome.reasonCode || 'WON', closedAt: r.outcome.closedAt || now, actorUserId: 'migration', relatedResourceRefs: [], migrated: true };
      }
      const createdKnown = r.createdAt && Number.isFinite(ms(r.createdAt)), created = createdKnown ? iso(r.createdAt) : now;
      const j = { id, organizationId: o.organizationId, customerId: r.customerId, developmentId: r.developmentId || undefined, journeyType: JourneyType[r.journeyType] ? r.journeyType : 'PURCHASE', lifecycleStatus: lifecycle,
        currentStageId: st.id, stageModelVersionId: model.id, currentOutcomeId: outcome ? outcome.id : undefined, createdAt: created, updatedAt: now, startedAt: created, closedAt: outcome ? outcome.closedAt : undefined, createdBy: 'migration', recordRevision: 1,
        metadata: { migrationVersion: mv, legacyId: r.legacyId, createdAtUnknown: !createdKnown || undefined } };
      const tr = { id: 'jst_mig_' + checksum([id]), organizationId: o.organizationId, journeyId: id, toStageId: st.id, stageModelVersionId: model.id, reasonCode: 'MIGRATED_TO_STAGE', actorType: 'SYSTEM', actorRef: 'migration', occurredAt: now, recordRevisionAfter: 1 };
      const ev = makeEvent(j, { type: 'MIGRATED_TO_STAGE', source: 'IMPORT', actorType: 'SYSTEM', occurredAt: now, payload: { legacyCurrentStage: String(r.status), historyUnavailable: true, migrationVersion: mv }, idempotencyKey: 'migration:' + r.legacyId }, { ...o, now: o.now });
      rep.historyUnavailableCount++;
      const src = r.source != null && smap[r.source] && registry().sources.has(smap[r.source]) ? smap[r.source] : 'UNKNOWN'; rep.sourceMappings[r.source == null ? '(vazio)' : r.source] = src;
      out.acquisitions.push({ id: 'jacq_mig_' + checksum([id]), organizationId: o.organizationId, journeyId: id, firstTouch: {}, primarySourceCode: src, capturedAt: now, migrated: true });
      if (r.ownerUserId) rep.ownersMapped++;
      if (r.nextFollowUpAt && Number.isFinite(ms(r.nextFollowUpAt)) && lifecycle === 'ACTIVE') { const na = { id: 'jna_mig_' + checksum([id]), organizationId: o.organizationId, journeyId: id, type: 'FOLLOW_UP', title: actionLabel('FOLLOW_UP'), dueAt: iso(r.nextFollowUpAt), assigneeUserId: r.ownerUserId || undefined, status: 'OPEN', priority: 'NORMAL', createdAt: now, createdBy: 'migration', recordRevision: 1 }; out.nextActions.push(na); j.currentNextActionId = na.id; rep.followUpsMigrated++; }
      if (r.notes) rep.rawNotesExcluded++;
      out.journeys.push(j); out.transitions.push(tr); if (ev.ok) out.events.push(ev.event); if (outcome) out.outcomes.push(outcome); rep.journeysCreated++;
      if (lifecycle === 'ACTIVE') { const k = [r.customerId, r.developmentId || '', j.journeyType].join('|'); byKey.set(k, [...(byKey.get(k) || []), id]); }
    }
    for (const [k, ids] of byKey) if (ids.length > 1) { const [customerId, developmentId] = k.split('|'); out.duplicates.push(Object.freeze({ customerId, developmentId: developmentId || undefined, journeyIds: ids, reasonCode: 'MULTIPLE_ACTIVE_LEGACY_RECORDS' })); }
    rep.duplicateActiveJourneyCandidates = out.duplicates.length;
    return deepFreeze({ ...out, report: rep });
  }

  return Object.freeze({ JourneyType, LifecycleStatus, StageCategory, ModelStatus, ActorType, EventSource, Visibility, TouchpointType, Channel, Direction, NextActionStatus, NextActionReadState, AttentionState, OutcomeType, ResourceType, SuggestionStatus, ProjectionMode, Sort, Errors, MESSAGES,
    registry, eventType, lossReasons, sources, automationPolicy, offlinePolicy, requireOnline,
    currentModel, modelVersionById, stageOf, validateStageModel, draftFrom, editDraft, publish, impactReport, migrationPlan, applyMigrationPlan,
    createJourney, transition, pause, resume, closeOutcome, archive, makeEvent, appendEvent, correctEvent, resolveActiveJourney, ingest, suggestionsFor, decideSuggestion,
    recordTouchpoint, normalizeTouch, createAcquisition, updateLatestTouch, linkArtifact, recordOptionPresented,
    createNextAction, completeNextAction, cancelNextAction, acceptSuggestion, actionLabel, readState, activitySummary, aging, attention,
    timeline, summary, contextChip, query, board, allowedMoves, decideAccess, mapExternalStage, applyExternalStage, inventory, migrateLegacy });
})();
