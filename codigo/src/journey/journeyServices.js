/* journey/journeyServices.js — topic 40: tenant-aware in-memory repositories and application services.
   JourneyRepository · JourneyEventRepository · JourneyStageRepository · JourneyNextActionRepository · JourneyArtifactLinkRepository ·
   JourneyAcquisitionRepository; services: JourneyApplicationService · JourneyStageService · JourneyTimelineService ·
   JourneyNextActionService · JourneyEventIngestionService · JourneyOutcomeService · JourneyAttributionService.

   Memory only (journey data is operational and sensitive: no localStorage, no offline cache by default). A stage change
   is one unit: compare-and-set on recordRevision → transition → current stage → event; on conflict nothing is written.
   Every call checks access first (deny by default) and writes a PII-free audit line (audit ≠ timeline). */
App.journey = App.journey || {};
App.journey.services = (() => {
  const J = () => App.journey.domain;
  function JourneyStore() {
    const T = () => ({ journeys: new Map(), events: [], transitions: [], nextActions: new Map(), links: [], acquisitions: new Map(), touchpoints: [], outcomes: new Map(), pauses: new Map(), suggestions: new Map(), assignments: [], conflicts: [], corrections: [], processedKeys: new Set() });
    let orgs = new Map();
    const of = org => { if (!org) throw Object.assign(new Error('organizationId obrigatório'), { code: 'MISSING_ORGANIZATION' }); if (!orgs.has(org)) orgs.set(org, T()); return orgs.get(org); };
    return Object.freeze({ of, clear() { orgs = new Map(); } });
  }
  function JourneyRepository(store) {
    const t = ctx => store.of(ctx.organizationId);
    return Object.freeze({
      getById: (ctx, id) => { const j = t(ctx).journeys.get(id); return j && j.organizationId === ctx.organizationId ? j : null; },
      listByCustomer: (ctx, customerId) => [...t(ctx).journeys.values()].filter(j => j.customerId === customerId),
      listByDevelopment: (ctx, devId) => [...t(ctx).journeys.values()].filter(j => j.developmentId === devId),
      findActiveJourney: (ctx, customerId, developmentId, journeyType) => { const r = J().resolveActiveJourney([...t(ctx).journeys.values()], { organizationId: ctx.organizationId, customerId, developmentId, journeyType }); return r.journeyId ? t(ctx).journeys.get(r.journeyId) : null; },
      /** compare-and-set: expectedRevision must equal the stored revision */
      save: (ctx, j, expectedRevision) => { const m = t(ctx).journeys, cur = m.get(j.id); if (cur ? cur.recordRevision !== expectedRevision : expectedRevision != null) return Object.freeze({ ok: false, code: 'JOURNEY_REVISION_CONFLICT', message: J().MESSAGES.JOURNEY_REVISION_CONFLICT }); m.set(j.id, j); return Object.freeze({ ok: true, journey: j }); }
    });
  }
  function services(store, env = {}) {
    const ctx = { organizationId: env.principal && env.principal.organizationId }, can = env.can || (() => false), dom = J(), repo = JourneyRepository(store), audit = [];
    const O = (extra = {}) => ({ now: env.now ? env.now() : undefined, idGen: env.idGen, actorId: env.principal && env.principal.userId, can, organizationId: ctx.organizationId, ...extra });
    const x = () => store.of(ctx.organizationId);
    const log = (action, data = {}) => audit.push(Object.freeze({ action, journeyId: data.journeyId || null, status: data.status || 'OK', codes: Object.freeze(data.codes || []) }));
    const notFound = (action, journeyId) => { log(action, { journeyId, status: 'DENIED' }); return Object.freeze({ ok: false, code: 'NOT_FOUND', message: 'Jornada não encontrada ou sem acesso.' }); };
    const access = j => dom.decideAccess({ journey: j, principal: env.principal, journeyAssignments: ctx.organizationId ? x().assignments : [], customerAssignments: env.customerAssignments ? env.customerAssignments() : [], can });
    const eventsOf = id => x().events.filter(e => e.journeyId === id);
    const connectivity = () => env.connectivity ? env.connectivity() : 'ONLINE';
    function appendAll(evs) { const s = x(); for (const e of evs.filter(Boolean)) { const r = dom.appendEvent(s.events, e); if (!r.duplicate) s.events = [...r.log]; } }
    /** atomic commit of a mutation result */
    function commit(prev, r, action) {
      const s = x(), save = repo.save(ctx, r.journey, prev ? prev.recordRevision : undefined);
      if (!save.ok) { log(action, { journeyId: r.journey.id, status: save.code }); return save; }
      if (r.transition) s.transitions.push(r.transition);
      appendAll([r.event, ...(r.events || [])]);
      if (r.pauseRecord) s.pauses.set(r.pauseRecord.id, r.pauseRecord);
      if (r.outcome) s.outcomes.set(r.outcome.id, r.outcome);
      if (r.nextAction) s.nextActions.set(r.nextAction.id, r.nextAction);
      if (r.assignment) s.assignments.push(r.assignment);
      log(action, { journeyId: r.journey.id, codes: r.audit ? [r.audit.action] : [] });
      return r;
    }
    const load = id => { const j = ctx.organizationId ? repo.getById(ctx, id) : null; const a = access(j); return { j, a }; };
    const app = Object.freeze({
      create(input) {
        if (!ctx.organizationId) return notFound('journey.create', null);
        const r = dom.createJourney(input, O({ existing: [...x().journeys.values()] })); if (!r.ok) { log('journey.create', { status: r.code }); return r; }
        return commit(null, r, 'JourneyCreated');
      },
      get(journeyId, mode = 'BROKER') {
        const { j, a } = load(journeyId); if (!a.allowed) return notFound('journey.read', journeyId);
        const m = mode === 'TECHNICAL' && a.level !== 'TECHNICAL' ? (a.level === 'BROKER' ? 'BROKER' : 'MANAGER') : mode;
        const na = j.currentNextActionId ? x().nextActions.get(j.currentNextActionId) : null, acq = [...x().acquisitions.values()].find(q => q.journeyId === j.id);
        return Object.freeze({ ok: true, access: a, summary: dom.summary(j, { nextAction: na, events: eventsOf(j.id), acquisition: acq, now: O().now }), timeline: a.canReadTimeline ? dom.timeline(j, { events: eventsOf(j.id), corrections: x().corrections, mode: m, now: O().now, limit: env.timelineLimit }) : null, allowedMoves: a.canTransition ? dom.allowedMoves(j, dom.modelVersionById(j.organizationId, j.stageModelVersionId)) : [] });
      },
      pause(journeyId, cmd, expectedRevision) { const { j, a } = load(journeyId); if (!a.allowed || !a.canTransition) return notFound('journey.pause', journeyId); const r = dom.pause(j, cmd, O({ expectedRevision })); return r.ok ? commit(j, r, 'JourneyPaused') : r; },
      resume(journeyId, expectedRevision) {
        const { j, a } = load(journeyId); if (!a.allowed) return notFound('journey.resume', journeyId);
        const rec = [...x().pauses.values()].filter(p => p.journeyId === j.id && !p.resumedAt).pop(); if (!rec) return Object.freeze({ ok: false, code: 'JOURNEY_NOT_PAUSED' });
        const r = dom.resume(j, rec, O({ expectedRevision })); return r.ok ? commit(j, r, 'JourneyResumed') : r;
      },
      link(journeyId, input) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.link', journeyId); const r = dom.linkArtifact(j, input, O({ existing: x().links })); if (r.ok && !r.duplicate) { x().links.push(r.link); appendAll([r.event]); } return r; },
      links(journeyId) { const { a } = load(journeyId); return a.allowed ? x().links.filter(l => l.journeyId === journeyId) : []; },
      resolveActive(customerId, developmentId) { return dom.resolveActiveJourney([...(ctx.organizationId ? x().journeys.values() : [])].filter(j => access(j).allowed), { organizationId: ctx.organizationId, customerId, developmentId }); }
    });
    const stage = Object.freeze({
      transition(journeyId, cmd = {}, expectedRevision) {
        const { j, a } = load(journeyId); if (!a.allowed || !a.canTransition) return notFound('journey.transition', journeyId);
        const r = dom.transition(j, cmd, O({ expectedRevision, connectivity: connectivity() })); if (!r.ok) { log('journey.transition', { journeyId, status: r.code }); return r; }
        return commit(j, r, 'JourneyStageTransitioned');
      },
      acceptSuggestion(suggestionId, expectedRevision) {
        const s = x().suggestions.get(suggestionId); if (!s || s.status !== 'PENDING' || !s.suggestedStageId) return Object.freeze({ ok: false, code: 'SUGGESTION_NOT_PENDING' });
        const r = this.transition(s.journeyId, { toStageId: s.suggestedStageId, sourceEventId: s.sourceEventId, reasonCode: 'SUGGESTION_ACCEPTED' }, expectedRevision);
        if (r.ok) x().suggestions.set(s.id, dom.decideSuggestion(s, 'ACCEPTED', O())); return r;
      },
      dismissSuggestion(suggestionId) { const s = x().suggestions.get(suggestionId); if (!s) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const d = dom.decideSuggestion(s, 'DISMISSED', O()); x().suggestions.set(s.id, d); return Object.freeze({ ok: true, suggestion: d }); },
      history(journeyId) { const { a } = load(journeyId); return a.allowed ? x().transitions.filter(t => t.journeyId === journeyId) : []; }
    });
    const outcome = Object.freeze({
      close(journeyId, cmd, expectedRevision) {
        const { j, a } = load(journeyId); if (!a.allowed || !a.canClose) return notFound('journey.close', journeyId);
        const off = dom.requireOnline('outcome', connectivity()); if (off) return off;
        const r = dom.closeOutcome(j, cmd, O({ expectedRevision })); if (!r.ok) { log('journey.close', { journeyId, status: r.code }); return r; }
        return commit(j, r, r.audit.action);
      }
    });
    const timelineSvc = Object.freeze({
      record(journeyId, input) {
        const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.touchpoint', journeyId);
        const off = dom.requireOnline('touchpoint', connectivity()); if (off) return off;
        const r = dom.recordTouchpoint(j, input, O()); if (!r.ok) return r;
        x().touchpoints.push(r.touchpoint); appendAll([r.event]); keepSuggestions(r); log('journey.touchpoint', { journeyId, codes: [input.type] }); return r;
      },
      presentOption(journeyId, input) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.option', journeyId); const r = dom.recordOptionPresented(j, input, O()); if (r.ok) appendAll([r.event]); return r; },
      correct(journeyId, eventId, cmd) { const { a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.correct', journeyId); const r = dom.correctEvent(eventsOf(journeyId), eventId, cmd, O()); if (r.ok) { x().corrections.push(r.correction); appendAll([r.event]); } return r; },
      page(journeyId, mode, cursor) { const { j, a } = load(journeyId); if (!a.allowed || !a.canReadTimeline) return notFound('journey.timeline', journeyId); return dom.timeline(j, { events: eventsOf(j.id), corrections: x().corrections, mode: mode === 'TECHNICAL' && a.level !== 'TECHNICAL' ? 'BROKER' : mode, cursor, limit: env.timelineLimit, now: O().now }); }
    });
    function keepSuggestions(r) { if (r.stageSuggestion) x().suggestions.set(r.stageSuggestion.id, r.stageSuggestion); if (r.actionSuggestion) x().suggestions.set(r.actionSuggestion.id, r.actionSuggestion); }
    const nextAction = Object.freeze({
      create(journeyId, input, expectedRevision) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.nextAction', journeyId); const r = dom.createNextAction(j, input, O({ expectedRevision })); if (!r.ok) return r; if (r.journey === j) { x().nextActions.set(r.nextAction.id, r.nextAction); appendAll([r.event]); return r; } return commit(j, r, 'JourneyNextActionCreated'); },
      complete(journeyId, actionId, expectedRevision, reasonCode) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.nextAction', journeyId); const na = x().nextActions.get(actionId); if (!na) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const r = dom.completeNextAction(j, na, O({ expectedRevision, reasonCode })); if (r.ok) { x().nextActions.set(na.id, r.nextAction); appendAll([r.event]); } return r; },
      cancel(journeyId, actionId, expectedRevision, reasonCode) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.nextAction', journeyId); const na = x().nextActions.get(actionId); if (!na) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const r = dom.cancelNextAction(j, na, O({ expectedRevision, reasonCode })); if (r.ok) { x().nextActions.set(na.id, r.nextAction); appendAll([r.event]); } return r; },
      acceptSuggestion(suggestionId, expectedRevision) { const s = x().suggestions.get(suggestionId); if (!s || !s.type) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const { j, a } = load(s.journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.nextAction', s.journeyId); const r = dom.acceptSuggestion(j, s, O({ expectedRevision })); if (!r.ok) return r; x().suggestions.set(s.id, r.suggestion); return commit(j, r, 'JourneyNextActionCreated'); },
      suggestions(journeyId) { return [...x().suggestions.values()].filter(s => s.journeyId === journeyId && s.status === 'PENDING'); }
    });
    const ingestion = Object.freeze({
      /** ingest(domainEvent) — idempotent; suggestions stored as PENDING; auto-transition only if the automation policy explicitly allows it */
      ingest(de) {
        if (!ctx.organizationId || de.organizationId !== ctx.organizationId) { log('journey.ingest', { status: 'IGNORED', codes: ['CROSS_TENANT'] }); return Object.freeze({ ok: true, action: 'IGNORED', reason: 'CROSS_TENANT' }); }
        const r = dom.ingest(de, { journeys: [...x().journeys.values()], log: x().events }, O());
        if (r.action === 'APPENDED') { appendAll([r.event]); keepSuggestions(r); if (r.autoTransitionEligible && r.stageSuggestion) { const j = repo.getById(ctx, r.journeyId); stage.transition(j.id, { toStageId: r.stageSuggestion.suggestedStageId, sourceEventId: r.event.id, reasonCode: 'AUTO_TRUSTED_EVENT' }, j.recordRevision); } }
        log('journey.ingest', { journeyId: r.journeyId, status: r.action, codes: [r.reason || de.type] }); return r;
      }
    });
    const attribution = Object.freeze({
      capture(journeyId, input) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.attribution', journeyId); if ([...x().acquisitions.values()].some(q => q.journeyId === journeyId)) return Object.freeze({ ok: false, code: 'FIRST_TOUCH_IMMUTABLE' }); const r = dom.createAcquisition(j, input, O()); x().acquisitions.set(r.acquisition.id, r.acquisition); return r; },
      latest(journeyId, touch) { const q = [...x().acquisitions.values()].find(z => z.journeyId === journeyId); if (!q) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const u = dom.updateLatestTouch(q, touch); x().acquisitions.set(u.id, u); return Object.freeze({ ok: true, acquisition: u }); }
    });
    const crm = Object.freeze({
      applyStage(journeyId, ext, o = {}) {
        const { j, a } = load(journeyId); if (!a.allowed) return notFound('journey.crm', journeyId);
        const r = dom.applyExternalStage(j, ext, { ...O(), ...o, processedKeys: x().processedKeys });
        if (r.action === 'CONFLICT') x().conflicts.push(r.conflict);
        if (r.action === 'TRANSITION') { const c = commit(j, r, 'JourneyStageTransitioned'); if (!c.ok) return c; }
        if (r.key && r.action !== 'DUPLICATE') x().processedKeys.add(r.key);
        return r;
      },
      conflicts() { return x().conflicts.slice(); }
    });
    /** board(query) — summaries only (customer names resolved by the caller through the Customer SUMMARY projection) */
    function board(q = {}, o = {}) {
      const visible = [...x().journeys.values()].filter(j => access(j).allowed), summaries = new Map(visible.map(j => [j.id, dom.summary(j, { nextAction: j.currentNextActionId ? x().nextActions.get(j.currentNextActionId) : null, events: eventsOf(j.id), now: O().now })]));
      const r = dom.query(visible, { ...q, organizationId: ctx.organizationId }, { summaries, customerNames: o.customerNames, now: O().now });
      const model = dom.currentModel(ctx.organizationId); return Object.freeze({ ok: true, items: r.items, board: model ? dom.board(r.items, model, { customerNames: o.customerNames, now: O().now }) : null });
    }
    return Object.freeze({ repo, application: app, stage, outcome, timeline: timelineSvc, nextAction, ingestion, attribution, crm, board, audit: () => audit.slice(), _store: () => x() });
  }
  return Object.freeze({ JourneyStore, JourneyRepository, services });
})();
