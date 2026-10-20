'use strict';
// Topic 40 — Customer journey. Golden scenarios named after the spec (§450).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, SRC } = require('./harness.js');

const MODULES = ['customer/customerDomain.js', 'customer/customerContext.js', 'customer/customerRepository.js', 'customer/customerView.js', 'journey/journeyDomain.js', 'journey/journeyServices.js'];
let App, J, S, model, lots, repo;
const ORG = 'org_house7', DEV = 'viva-juara', T0 = Date.parse('2026-10-09T12:00:00Z'), H = 3600000;
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m);
let n = 0; const idGen = p => `${p}_t${(++n).toString(36)}`;
const KEYS = ['journey.read', 'journey.readAssigned', 'journey.create', 'journey.update', 'journey.transition', 'journey.overrideTransition', 'journey.pause', 'journey.close', 'journey.assign', 'journey.timeline.read', 'journey.timeline.record', 'journey.nextAction.manage', 'journey.outcome.manage', 'journey.technical.read'];
const canAll = k => KEYS.includes(k), without = (...ks) => k => canAll(k) && !ks.includes(k);
const O = (x = {}) => ({ organizationId: ORG, now: T0, idGen, actorId: 'usr_broker1', can: canAll, ...x });
const st = code => J.stageOf(model, code).id;
const newJ = (x = {}, o = {}) => J.createJourney({ customerId: 'cus_c55', developmentId: DEV, ...x }, O(o));
const P = (userId = 'usr_broker1', org = ORG) => ({ userId, organizationId: org, teamIds: [] });

test.before(async () => {
  App = load();
  for (const f of MODULES) new Function('App', fs.readFileSync(path.join(SRC, f), 'utf8'))(App);
  J = App.journey.domain; S = App.journey.services; model = J.currentModel(ORG);
  repo = App.repos.LotRepository(DEV); await repo.load(); lots = repo.lotsSync();
});

test('NewJourneyForCustomer: entry stage, ACTIVE, baseline transition + JOURNEY_CREATED; customer lifecycle independent; uniqueness per customer+development+type', () => {
  const r = newJ({ ownerUserId: 'usr_broker1' });
  assert.equal(r.ok, true); const j = r.journey;
  assert.equal(j.currentStageId, model.entryStageId); assert.equal(J.stageOf(model, j.currentStageId).code, 'NEW'); assert.equal(j.lifecycleStatus, 'ACTIVE'); assert.equal(j.stageModelVersionId, model.id);
  assert.ok(!j.id.includes('cus_c55'), 'id is opaque, not customerId+developmentId'); assert.equal(r.transition.fromStageId, undefined); assert.equal(r.events[0].type, 'JOURNEY_CREATED');
  assert.equal(r.assignment.role, 'OWNER'); assert.equal(j.ownerAssignmentRef, r.assignment.id);
  assert.equal(newJ({}, { existing: [j] }).code, 'ACTIVE_JOURNEY_EXISTS');
  assert.equal(newJ({ journeyType: 'INVESTMENT' }, { existing: [j] }).ok, true, 'other type allowed');
  assert.equal(newJ({}, { existing: [{ ...j, lifecycleStatus: 'CLOSED_LOST' }] }).ok, true, 'closed journey does not block a new one');
  assert.equal(newJ({}, { can: () => false }).code, 'NO_GRANT');
  assert.equal(J.createJourney({ customerId: 'c' }, { now: T0 }).code, 'MISSING_ORGANIZATION');
  deq(Object.keys(J.LifecycleStatus), ['ACTIVE', 'PAUSED', 'CLOSED_WON', 'CLOSED_LOST', 'ARCHIVED']);
});
test('CustomerWithTwoDevelopmentJourneys: one customer, independent journeys per development; active resolution requires selection when ambiguous', () => {
  const a = newJ().journey, b = newJ({ developmentId: 'empreendimento-b' }).journey;
  deq(J.resolveActiveJourney([a, b], { organizationId: ORG, customerId: 'cus_c55', developmentId: DEV }).journeyId, a.id);
  const amb = J.resolveActiveJourney([a, b], { organizationId: ORG, customerId: 'cus_c55' }); assert.equal(amb.status, 'SELECTION_REQUIRED'); assert.equal(amb.journeyId, null, 'never silently picks one');
  assert.equal(J.resolveActiveJourney([a], { organizationId: 'org_other', customerId: 'cus_c55' }).status, 'NONE');
});
test('stage model: published version is frozen with checksum; edits need a draft V2; validation; impact report and migration plan never auto-migrate', () => {
  assert.equal(model.lifecycleStatus, 'PUBLISHED'); assert.ok(Object.isFrozen(model) && Object.isFrozen(model.stages[0])); assert.match(model.checksum, /^[0-9a-f]{8}$/);
  deq(J.validateStageModel(model), []); assert.equal(J.editDraft(model, { stages: [] }).code, 'STAGE_MODEL_IMMUTABLE'); assert.equal(J.publish(model).code, 'STAGE_MODEL_IMMUTABLE');
  const d = J.draftFrom(model, { id: 'jsmv_2', now: T0 }); assert.equal(d.version, 2); assert.equal(d.lifecycleStatus, 'DRAFT');
  const d2 = J.editDraft(d, { stages: d.stages.filter(s => s.code !== 'QUALIFYING'), transitions: d.transitions.filter(t => t.fromStageId !== st('QUALIFYING') && t.toStageId !== st('QUALIFYING')) }).version;
  const pub = J.publish(d2, { now: T0 }); assert.equal(pub.ok, true); assert.ok(Object.isFrozen(pub.version));
  assert.equal(J.publish({ ...d, entryStageId: 'nope' }).code, 'INVALID_STAGE_MODEL');
  const jq = { ...newJ().journey, currentStageId: st('QUALIFYING') };
  const imp = J.impactReport(model, pub.version, [jq]); deq(imp.stagesRemoved, ['QUALIFYING']); assert.equal(imp.journeysNeedingMigration, 1); deq(imp.unmappableStages, ['QUALIFYING']); assert.equal(imp.autoMigration, false);
  const plan = J.migrationPlan(model, pub.version, { QUALIFYING: 'CONTACTED' }); deq(plan.unmapped, []); assert.equal(plan.requiresReview, true);
  assert.equal(J.applyMigrationPlan(jq, plan).code, 'PLAN_NOT_APPROVED');
  const m = J.applyMigrationPlan(jq, plan, { approvedBy: 'usr_admin', now: T0, idGen }); assert.equal(m.journey.stageModelVersionId, 'jsmv_2'); assert.equal(m.transition.reasonCode, 'STAGE_MODEL_MIGRATION');
  assert.equal(J.transition(jq, { toStageId: st('PROFILED') }, O({ expectedRevision: 1, model: pub.version })).code, 'STAGE_MODEL_MISMATCH', 'no mixing stage ids across model versions');
});
test('JourneyValidStageTransition / JourneyInvalidStageTransition / JourneyStageOverrideWithReason / revision conflict', () => {
  const j = newJ().journey;
  const ok = J.transition(j, { toStageId: st('CONTACTED') }, O({ expectedRevision: 1 }));
  assert.equal(ok.ok, true); assert.equal(ok.journey.currentStageId, st('CONTACTED')); assert.equal(ok.journey.recordRevision, 2); assert.equal(ok.transition.recordRevisionAfter, 2);
  assert.equal(ok.event.type, 'STAGE_CHANGED'); assert.equal(ok.event.subjectRef.resourceId, ok.transition.id, 'history and timeline share the reference'); assert.equal(j.currentStageId, st('NEW'), 'previous snapshot untouched');
  assert.equal(J.transition(j, { toStageId: st('CONTACTED') }, O({ expectedRevision: 0 })).code, 'JOURNEY_REVISION_CONFLICT', 'second broker on a stale revision');
  assert.equal(J.transition(j, { toStageId: st('NEGOTIATING') }, O({ expectedRevision: 1 })).code, 'TRANSITION_NOT_ALLOWED');
  assert.equal(J.transition(j, { toStageId: st('QUALIFYING') }, O({ expectedRevision: 1 })).code, 'REASON_REQUIRED', 'skip one step needs a reason');
  assert.equal(J.transition(j, { toStageId: st('CLOSED_WON') }, O({ expectedRevision: 1 })).code, 'OUTCOME_REQUIRED');
  assert.equal(J.transition(j, { toStageId: st('NEGOTIATING'), override: true, reasonCode: 'OPERATIONAL_EXCEPTION' }, O({ expectedRevision: 1, can: without('journey.overrideTransition') })).code, 'NO_GRANT');
  assert.equal(J.transition(j, { toStageId: st('NEGOTIATING'), override: true }, O({ expectedRevision: 1 })).code, 'REASON_REQUIRED');
  const ov = J.transition(j, { toStageId: st('NEGOTIATING'), override: true, reasonCode: 'OPERATIONAL_EXCEPTION' }, O({ expectedRevision: 1 }));
  assert.equal(ov.ok, true); assert.equal(ov.transition.override, true); assert.equal(ov.audit.action, 'JourneyStageOverride'); assert.equal(ov.event.payload.override, true);
  const back = J.transition(ok.journey, { toStageId: st('NEW') }, O({ expectedRevision: 2 })); assert.equal(back.code, 'REASON_REQUIRED');
  assert.equal(J.transition(ok.journey, { toStageId: st('NEW'), reasonCode: 'DATA_CORRECTION' }, O({ expectedRevision: 2 })).ok, true, 'going back is allowed with reason');
  assert.equal(J.transition(j, { toStageId: st('CONTACTED'), note: 'ligar 48 99999-1234' }, O({ expectedRevision: 1 })).code, 'CONTAINS_CONTACT_DATA');
  assert.equal(J.transition(j, { toStageId: st('CONTACTED') }, O({ expectedRevision: 1, connectivity: 'OFFLINE' })).code, 'OFFLINE_NOT_ALLOWED', 'no offline stage transition by default');
  const moves = J.allowedMoves(j, model); assert.equal(moves[0].title, 'Contato feito'); assert.ok(moves.find(m => m.toStageId === st('CLOSED_LOST')).requiresOutcome);
});
test('JourneyPauseAndResume: stage preserved, reason from registry, no new journey', () => {
  const j = J.transition(newJ().journey, { toStageId: st('CONTACTED') }, O({ expectedRevision: 1 })).journey;
  assert.equal(J.pause(j, {}, O({ expectedRevision: 2 })).code, 'REASON_REQUIRED');
  const p = J.pause(j, { reasonCode: 'TIMING', expectedResumeAt: T0 + 720 * H }, O({ expectedRevision: 2 }));
  assert.equal(p.journey.lifecycleStatus, 'PAUSED'); assert.equal(p.journey.currentStageId, st('CONTACTED')); assert.equal(p.event.type, 'JOURNEY_PAUSED');
  assert.equal(J.transition(p.journey, { toStageId: st('QUALIFYING') }, O({ expectedRevision: 3 })).code, 'JOURNEY_NOT_ACTIVE');
  assert.equal(J.attention(p.journey, {}), 'PAUSED');
  const r = J.resume(p.journey, p.pauseRecord, O({ expectedRevision: 3 })); assert.equal(r.journey.lifecycleStatus, 'ACTIVE'); assert.equal(r.journey.currentStageId, st('CONTACTED')); assert.equal(r.journey.id, j.id); assert.ok(r.pauseRecord.resumedAt);
});
test('JourneyNextActionOverdue: OVERDUE derived (never stored); DUE_SOON; complete/cancel with revision; attention state; stage-specific aging', () => {
  const j = newJ().journey;
  const c = J.createNextAction(j, { type: 'CONTACT', dueAt: T0 + 2 * H }, O({ expectedRevision: 1 }));
  assert.equal(c.nextAction.status, 'OPEN'); assert.equal(c.journey.currentNextActionId, c.nextAction.id); assert.equal(c.nextAction.title, 'Fazer contato');
  assert.equal(J.readState(c.nextAction, T0), 'DUE_SOON'); assert.equal(J.readState(c.nextAction, T0 + 3 * H), 'OVERDUE'); assert.equal(c.nextAction.status, 'OPEN', 'not persisted as OVERDUE');
  assert.equal(J.readState({ ...c.nextAction, dueAt: new Date(T0 + 100 * H).toISOString() }, T0), 'OPEN');
  assert.equal(J.attention(c.journey, { nextAction: c.nextAction, now: T0 + 3 * H }), 'OVERDUE'); assert.equal(J.attention(c.journey, { nextAction: null, now: T0 }), 'UNKNOWN');
  assert.equal(J.attention(c.journey, { nextAction: { ...c.nextAction, type: 'WAIT_CUSTOMER', dueAt: undefined }, now: T0 }), 'WAITING_CUSTOMER');
  assert.equal(J.createNextAction(j, { type: 'TELEPATHY' }, O({ expectedRevision: 1 })).code, 'INVALID_ACTION_TYPE');
  const done = J.completeNextAction(c.journey, c.nextAction, O({ expectedRevision: 1 })); assert.equal(done.nextAction.status, 'COMPLETED'); assert.equal(J.readState(done.nextAction, T0 + 10 * H), 'COMPLETED');
  assert.equal(J.completeNextAction(c.journey, done.nextAction, O({ expectedRevision: 2 })).code, 'ACTION_NOT_OPEN');
  assert.equal(J.cancelNextAction(c.journey, c.nextAction, O({ expectedRevision: 0 })).code, 'JOURNEY_REVISION_CONFLICT');
  // NEW stage aging: 24h warning / 72h critical since last meaningful event
  const ev = c.event; assert.equal(J.aging(c.journey, J.activitySummary([ev]), null, T0 + 80 * H, model).level, 'CRITICAL'); assert.equal(J.aging(c.journey, J.activitySummary([ev]), null, T0 + 1 * H, model).level, 'NONE');
});
test('JourneyRecommendationGenerated / JourneyRecommendationPresented: generated ≠ presented; presented only when explicitly confirmed; payload minimal', () => {
  const j = newJ().journey, world = { journeys: [j], log: [] };
  const g = J.ingest({ id: 'e1', type: 'RecommendationGenerated', organizationId: ORG, customerId: 'cus_c55', developmentId: DEV, occurredAt: T0, payload: { recommendationResultId: 'R11', profileVersionId: 'cpv_2', ranking: [1, 2, 3] }, subjectRef: { resourceType: 'RECOMMENDATION_RESULT', resourceId: 'R11', versionRef: 'cpv_2' } }, world, O());
  assert.equal(g.action, 'APPENDED'); assert.equal(g.event.type, 'RECOMMENDATION_GENERATED'); deq(g.event.payload, { recommendationResultId: 'R11', profileVersionId: 'cpv_2' }, 'ranking not copied'); assert.equal(g.event.subjectRef.versionRef, 'cpv_2');
  assert.equal(J.activitySummary([g.event]).lastMeaningfulEventAt, undefined, 'generation is not a meaningful touch');
  const np = J.ingest({ id: 'e2', type: 'RecommendationPresented', organizationId: ORG, customerId: 'cus_c55', developmentId: DEV, payload: { recommendationResultId: 'R11' } }, world, O());
  assert.equal(np.action, 'IGNORED'); assert.equal(np.reason, 'PRESENTATION_NOT_CONFIRMED');
  const p = J.ingest({ id: 'e3', type: 'RecommendationPresented', organizationId: ORG, customerId: 'cus_c55', developmentId: DEV, occurredAt: T0, payload: { recommendationResultId: 'R11', presentationConfirmed: true, lotIds: ['VJ-Q012-L0327'] } }, world, O());
  assert.equal(p.event.type, 'RECOMMENDATION_PRESENTED'); assert.equal(p.event.payload.presentationConfirmed, undefined); assert.equal(p.stageSuggestion.status, 'PENDING'); assert.equal(p.autoTransitionEligible, false, 'automation off by default');
  assert.equal(J.automationPolicy().allowAutoStageTransition, false);
  const opt = J.recordOptionPresented(j, { lotId: lots[0].identity.id }, O()); assert.equal(opt.event.type, 'OPTION_PRESENTED');
});
test('JourneyCustomerFavoriteMilestone: customer-context favorite becomes a milestone; personal favorite and UI noise are ignored; no stage move', () => {
  const j = newJ().journey, world = { journeys: [j], log: [] };
  const f = J.ingest({ id: 'f1', type: 'FavoriteAdded', contextType: 'CUSTOMER', organizationId: ORG, customerId: 'cus_c55', developmentId: DEV, occurredAt: T0, payload: { lotId: 'VJ-Q012-L0327', favoriteId: 'fav1', lotData: { price: 1 } } }, world, O());
  assert.equal(f.event.type, 'FAVORITE_ADDED_FOR_CUSTOMER'); deq(Object.keys(f.event.payload).sort(), ['favoriteId', 'lotId']); assert.equal(f.stageSuggestion, null);
  assert.equal(J.ingest({ id: 'f2', type: 'FavoriteAdded', contextType: 'PERSONAL', organizationId: ORG, customerId: 'cus_c55', payload: { lotId: 'x' } }, world, O()).reason, 'NOT_CUSTOMER_CONTEXT');
  for (const t of ['LotHovered', 'LotClicked', 'QuickViewOpened', 'MapPanned', 'FilterChanged', 'ComparisonCandidatesReordered', 'SomethingUnknown']) assert.equal(J.ingest({ id: 'x', type: t, organizationId: ORG, customerId: 'cus_c55' }, world, O()).action, 'IGNORED', t);
});
test('JourneyComparisonCreated: reference only, updates coalesced within the window; financial simulation / document by reference; links never copy data', () => {
  const j = newJ().journey; let log = [];
  const base = { organizationId: ORG, customerId: 'cus_c55', developmentId: DEV, subjectRef: { resourceType: 'COMPARISON_SESSION', resourceId: 'S8' } };
  const c = J.ingest({ ...base, id: 'c1', type: 'ComparisonCreated', occurredAt: T0, payload: { comparisonSessionId: 'S8', candidateCount: 3, matrix: [[1]] } }, { journeys: [j], log }, O()); log = [c.event];
  assert.equal(c.event.payload.matrix, undefined);
  assert.equal(J.ingest({ ...base, id: 'c2', type: 'ComparisonUpdated', occurredAt: T0 + 60000, payload: { comparisonSessionId: 'S8' } }, { journeys: [j], log }, O()).action, 'COALESCED');
  assert.equal(J.ingest({ ...base, id: 'c3', type: 'ComparisonUpdated', occurredAt: T0 + 3 * H, payload: { comparisonSessionId: 'S8' } }, { journeys: [j], log }, O({ now: T0 + 3 * H })).action, 'APPENDED');
  const sim = J.ingest({ id: 's1', type: 'FinancialSimulationCreated', organizationId: ORG, customerId: 'cus_c55', developmentId: DEV, payload: { simulationId: 'FS1', installments: 144 } }, { journeys: [j], log }, O());
  assert.equal(sim.event.type, 'FINANCIAL_SIMULATION_CREATED'); deq(sim.event.payload, { simulationId: 'FS1' });
  const l = J.linkArtifact(j, { resourceType: 'COMPARISON_SESSION', resourceId: 'S8', relationType: 'PRESENTED' }, O()); assert.equal(l.ok, true);
  assert.equal(J.linkArtifact(j, { resourceType: 'COMPARISON_SESSION', resourceId: 'S8', relationType: 'PRESENTED' }, O({ existing: [l.link] })).duplicate, true);
  assert.equal(J.linkArtifact(j, { resourceType: 'COMPARISON_SESSION', resourceId: 'S8', matrix: [] }, O()).code, 'RAW_CONTENT_NOT_ALLOWED');
  assert.equal(J.linkArtifact(j, { resourceType: 'SPREADSHEET', resourceId: 'S8' }, O()).code, 'INVALID_RESOURCE');
});
test('JourneyVisitScheduledAndCompleted: touchpoints without raw messages; VISIT suggests stage VISITED and a follow-up in 1 day, never applied automatically', () => {
  const j = J.transition(newJ().journey, { toStageId: st('CONTACTED') }, O({ expectedRevision: 1 })).journey;
  const w = J.recordTouchpoint(j, { type: 'CONVERSATION', channel: 'WHATSAPP', direction: 'INBOUND', outcomeCode: 'INTERESTED', summary: 'Quer lote silencioso' }, O());
  assert.equal(w.event.type, 'CUSTOMER_CONTACTED'); assert.equal(w.event.source, 'WHATSAPP'); assert.equal(w.touchpoint.visibility, 'INTERNAL');
  assert.equal(J.recordTouchpoint(j, { type: 'CONVERSATION', channel: 'WHATSAPP', direction: 'INBOUND', message: 'oi' }, O()).code, 'RAW_CONTENT_NOT_ALLOWED');
  assert.equal(J.recordTouchpoint(j, { type: 'CONVERSATION', channel: 'PHONE', direction: 'OUTBOUND', summary: 'meu email é a@b.com' }, O()).code, 'CONTAINS_CONTACT_DATA');
  assert.equal(J.recordTouchpoint(j, { type: 'CONVERSATION', channel: 'SMOKE', direction: 'OUTBOUND' }, O()).code, 'INVALID_CHANNEL');
  const call = J.recordTouchpoint(j, { type: 'CONTACT_ATTEMPT', channel: 'PHONE', direction: 'OUTBOUND', outcomeCode: 'NO_ANSWER', externalRef: 'crm-call-9' }, O()); assert.equal(call.event, undefined, 'attempt without answer is not "contacted"'); assert.equal(call.touchpoint.externalRef, 'crm-call-9');
  const sch = J.makeEvent(j, { type: 'VISIT_SCHEDULED', payload: { scheduledFor: '2026-10-12T10:00:00Z' } }, O()); assert.equal(sch.ok, true);
  const v = J.recordTouchpoint(j, { type: 'VISIT', channel: 'IN_PERSON', direction: 'MUTUAL', occurredAt: T0 }, O());
  assert.equal(v.event.type, 'VISIT_COMPLETED'); assert.equal(J.stageOf(model, v.stageSuggestion.suggestedStageId).code, 'VISITED');
  assert.equal(v.actionSuggestion.type, 'FOLLOW_UP_VISIT'); assert.equal(Date.parse(v.actionSuggestion.suggestedDueAt) - T0, 24 * H);
  const acc = J.acceptSuggestion(j, v.actionSuggestion, O({ expectedRevision: 2 })); assert.equal(acc.nextAction.fromSuggestionId, v.actionSuggestion.id); assert.equal(acc.suggestion.status, 'ACCEPTED');
  assert.equal(J.decideSuggestion(v.stageSuggestion, 'DISMISSED').status, 'DISMISSED');
});
test('JourneyDocumentRequestedReceived: document refs only (no filename), explicit journey required', () => {
  const j = newJ().journey, w = { journeys: [j], log: [] };
  assert.equal(J.ingest({ id: 'd0', type: 'DocumentRequested', organizationId: ORG, customerId: 'cus_c55', payload: { documentId: 'DOC1' } }, w, O()).reason, 'EXPLICIT_JOURNEY_REQUIRED');
  const r = J.ingest({ id: 'd1', type: 'DocumentRequested', journeyId: j.id, organizationId: ORG, customerId: 'cus_c55', payload: { documentId: 'DOC1', fileName: 'rg-maria.pdf' } }, w, O());
  deq(r.event.payload, { documentId: 'DOC1' });
  assert.equal(J.ingest({ id: 'd2', type: 'DocumentReceived', journeyId: j.id, organizationId: ORG, customerId: 'cus_c55', payload: { documentId: 'DOC1' } }, w, O()).event.type, 'DOCUMENT_RECEIVED');
});
test('JourneyClosedWonWithReservationRef / JourneyClosedLostWithReason: explicit outcome; reservation stays authoritative; lots untouched (all UNKNOWN)', () => {
  let j = newJ().journey;
  for (const [code, rev] of [['CONTACTED', 1], ['QUALIFYING', 2], ['PROFILED', 3], ['RECOMMENDING', 4], ['SHORTLISTED', 5], ['VISIT_PLANNED', 6], ['VISITED', 7], ['NEGOTIATING', 8]]) j = J.transition(j, { toStageId: st(code) }, O({ expectedRevision: rev })).journey;
  const statuses = lots.map(l => l.availability.status);
  const res = J.ingest({ id: 'rv1', type: 'ReservationCreated', journeyId: j.id, organizationId: ORG, customerId: 'cus_c55', payload: { reservationId: 'R22', lotId: lots[0].identity.id, status: 'RESERVED' } }, { journeys: [j], log: [] }, O());
  assert.equal(res.event.payload.status, undefined); assert.equal(j.lifecycleStatus, 'ACTIVE', 'reservation does not close the journey');
  assert.equal(J.closeOutcome(j, { type: 'WON' }, O({ expectedRevision: 9, actorId: undefined })).code, 'EXPLICIT_ACTOR_REQUIRED');
  const won = J.closeOutcome(j, { type: 'WON', relatedResourceRefs: [{ resourceType: 'RESERVATION', resourceId: 'R22' }] }, O({ expectedRevision: 9 }));
  assert.equal(won.ok, true); assert.equal(won.journey.lifecycleStatus, 'CLOSED_WON'); assert.equal(won.outcome.relatedResourceRefs[0].resourceId, 'R22'); deq(won.events.map(e => e.type), ['STAGE_CHANGED', 'JOURNEY_WON']);
  deq(lots.map(l => l.availability.status), statuses, 'availability never mutated'); assert.ok(statuses.every(s => s === 'UNKNOWN'));
  const lostNoReason = J.closeOutcome(j, { type: 'LOST' }, O({ expectedRevision: 9 })); assert.equal(lostNoReason.code, 'REASON_REQUIRED');
  assert.equal(J.closeOutcome(j, { type: 'LOST', reasonCode: 'ALIENS' }, O({ expectedRevision: 9 })).code, 'INVALID_REASON');
  const lost = J.closeOutcome(j, { type: 'LOST', reasonCode: 'TIMING' }, O({ expectedRevision: 9 })); assert.equal(lost.journey.lifecycleStatus, 'CLOSED_LOST');
  assert.equal(J.closeOutcome(newJ().journey, { type: 'WON' }, O({ expectedRevision: 1 })).code, 'TRANSITION_NOT_ALLOWED', 'WON from NEW not allowed without override');
  assert.ok(J.lossReasons().some(r => r.code === 'UNKNOWN' && r.label === 'Não informado'));
  assert.equal(J.attention(lost.journey, {}), 'CLOSED');
});
test('JourneyLateArrivingEvent + corrections + visibility: ordered by occurredAt; recordedAt only in TECHNICAL; CLIENT_SAFE hides internal; correction keeps original', () => {
  const j = newJ().journey; let log = [];
  const add = r => { assert.equal(r.ok, true, r.code); log = [...J.appendEvent(log, r.event).log]; return r.event; };
  const e1 = add(J.makeEvent(j, { type: 'CUSTOMER_CONTACTED', payload: { touchpointId: 't1' }, occurredAt: T0 - 2 * H, idempotencyKey: 'k1' }, O()));
  const late = add(J.makeEvent(j, { type: 'VISIT_COMPLETED', payload: {}, occurredAt: T0 - 24 * H, idempotencyKey: 'k2' }, O()));
  add(J.makeEvent(j, { type: 'FAVORITE_ADDED_FOR_CUSTOMER', payload: { lotId: 'L1' }, visibility: 'CLIENT_SAFE', occurredAt: T0 - H, idempotencyKey: 'k3' }, O()));
  assert.equal(J.makeEvent(j, { type: 'STAGE_CHANGED', payload: { fromStageId: 'a', toStageId: 'b', transitionId: 't' }, visibility: 'CLIENT_SAFE' }, O()).code, 'VISIBILITY_NOT_ALLOWED');
  assert.equal(J.makeEvent(j, { type: 'CUSTOMER_CONTACTED', payload: { touchpointId: 't' }, occurredAt: T0 + 48 * H }, O()).code, 'OCCURRED_AT_IN_FUTURE');
  assert.equal(J.makeEvent(j, { type: 'CUSTOMER_CONTACTED', actorType: 'CUSTOMER', payload: { touchpointId: 't' } }, O()).code, 'CUSTOMER_ACTOR_UNPROVEN');
  assert.equal(J.makeEvent(j, { type: 'CUSTOMER_CONTACTED', payload: { touchpointId: 't', transcript: '...' } }, O()).code, 'RAW_CONTENT_NOT_ALLOWED');
  assert.equal(J.makeEvent(j, { type: 'NOPE' }, O()).code, 'UNKNOWN_EVENT_TYPE');
  assert.equal(late.recordedAt > late.occurredAt, true);
  const tl = J.timeline(j, { events: log, mode: 'BROKER' }); deq(tl.items.map(i => i.type), ['FAVORITE_ADDED_FOR_CUSTOMER', 'CUSTOMER_CONTACTED', 'VISIT_COMPLETED']); assert.equal(tl.items[0].recordedAt, undefined);
  assert.ok(J.timeline(j, { events: log, mode: 'TECHNICAL' }).items[0].recordedAt);
  const cs = J.timeline(j, { events: log, mode: 'CLIENT_SAFE' }); deq(cs.items.map(i => i.type), ['FAVORITE_ADDED_FOR_CUSTOMER']); assert.equal(cs.items[0].actorType, undefined);
  const p1 = J.timeline(j, { events: log, limit: 2 }); assert.equal(p1.items.length, 2); assert.equal(J.timeline(j, { events: log, limit: 2, cursor: p1.nextCursor }).items.length, 1);
  const cor = J.correctEvent(log, e1.id, { correctedPayload: { touchpointId: 't9' }, reasonCode: 'WRONG_RECORD' }, O());
  assert.equal(log.find(e => e.id === e1.id).payload.touchpointId, 't1', 'original preserved');
  const tc = J.timeline(j, { events: [...log, cor.event], corrections: [cor.correction] }); const it = tc.items.find(i => i.id === e1.id); assert.equal(it.corrected, true); assert.ok(!tc.items.some(i => i.type === 'EVENT_CORRECTED'));
  const act = J.activitySummary(log); assert.equal(act.lastMeaningfulEventAt, new Date(T0 - H).toISOString()); assert.equal(act.lastCustomerTouchAt, new Date(T0 - 2 * H).toISOString());
  const sync = J.makeEvent(j, { type: 'CRM_SYNC_COMPLETED', source: 'CRM_SYNC', actorType: 'INTEGRATION', payload: {}, occurredAt: T0 }, O()).event;
  assert.equal(J.activitySummary([...log, sync]).lastMeaningfulEventAt, act.lastMeaningfulEventAt, 'sync is not "last contact"');
});
test('JourneyEventDeduplication: webhook / domain event retry never duplicates the timeline', () => {
  const j = newJ().journey; let log = [];
  const de = { id: 'ev77', type: 'FavoriteAdded', contextType: 'CUSTOMER', organizationId: ORG, customerId: 'cus_c55', developmentId: DEV, payload: { lotId: 'L1' } };
  const a = J.ingest(de, { journeys: [j], log }, O()); log = [...J.appendEvent(log, a.event).log];
  assert.equal(J.ingest(de, { journeys: [j], log }, O()).action, 'DUPLICATE');
  assert.equal(J.appendEvent(log, a.event).duplicate, true);
  assert.equal(J.ingest({ ...de, organizationId: 'org_other', journeyId: j.id }, { journeys: [j], log }, O()).reason, 'CROSS_TENANT');
});
test('JourneyCRMStageConflict: unmapped external stage → conflict; internal authority ignored; external master maps through a valid transition; retry idempotent', () => {
  const j = newJ().journey, policies = [{ provider: 'KENLO', internalStageId: st('CONTACTED'), externalStageCode: 'EM_CONTATO', direction: 'IMPORT', conflictMode: 'EXTERNAL_WINS' }, { provider: 'KENLO', internalStageId: st('NEGOTIATING'), externalStageCode: 'NEGOC', direction: 'BIDIRECTIONAL', conflictMode: 'MANUAL_REVIEW' }];
  const u = J.applyExternalStage(j, { provider: 'KENLO', externalStageCode: 'XYZ', externalEventId: '1' }, O({ policies, externalRef: { authorityMode: 'EXTERNAL_MASTER' } }));
  assert.equal(u.action, 'CONFLICT'); assert.equal(u.conflict.reasonCode, 'UNMAPPED_EXTERNAL_STAGE'); assert.equal(j.currentStageId, st('NEW'));
  assert.equal(J.applyExternalStage(j, { provider: 'KENLO', externalStageCode: 'EM_CONTATO', externalEventId: '2' }, O({ policies, externalRef: { authorityMode: 'INTERNAL_MASTER' } })).conflict.status, 'IGNORED');
  assert.equal(J.applyExternalStage(j, { provider: 'KENLO', externalStageCode: 'NEGOC', externalEventId: '3' }, O({ policies, externalRef: { authorityMode: 'EXTERNAL_MASTER' } })).conflict.reasonCode, 'MANUAL_REVIEW');
  const t = J.applyExternalStage(j, { provider: 'KENLO', externalStageCode: 'EM_CONTATO', externalEventId: '4' }, O({ policies, externalRef: { authorityMode: 'EXTERNAL_MASTER' } }));
  assert.equal(t.action, 'TRANSITION'); assert.equal(t.transition.actorType, 'INTEGRATION'); assert.equal(t.event.source, 'CRM_SYNC');
  assert.equal(J.applyExternalStage(j, { provider: 'KENLO', externalStageCode: 'EM_CONTATO', externalEventId: '4' }, O({ policies, processedKeys: new Set(['KENLO:4']) })).action, 'DUPLICATE');
  assert.ok(!JSON.stringify(u.conflict).match(/Maria|@/));
});
test('JourneyLegacyMigrationWithoutHistory: exact stage map only; baseline MIGRATED_TO_STAGE with historyUnavailable; no fabricated history; unknown source → UNKNOWN; won/lost only with evidence; duplicates flagged; idempotent', () => {
  const recs = [
    { legacyId: 'L1', customerId: 'cus_x', developmentId: DEV, status: 'Negociação', source: 'Instagram', nextFollowUpAt: T0 - H, notes: 'ligou dia 3' },
    { legacyId: 'L2', customerId: 'cus_x', developmentId: DEV, status: 'Negociação' },
    { legacyId: 'L3', customerId: 'cus_y', status: 'Esquisito' },
    { legacyId: 'L4', customerId: 'cus_z', status: 'Fechado' },
    { legacyId: 'L5', customerId: 'cus_w', status: 'Perdido', outcome: { type: 'LOST', reasonCode: 'PRICE' } }];
  const stageMap = { 'Negociação': { stageId: st('NEGOTIATING') }, Fechado: { stageId: st('CLOSED_WON') }, Perdido: { stageId: st('CLOSED_LOST') } };
  const inv = J.inventory(recs, { stageMap }); assert.equal(inv.find(i => i.legacyLabel === 'Esquisito').requiresHumanReview, true); assert.equal(inv.find(i => i.legacyLabel === 'Negociação').occurrenceCount, 2);
  assert.ok('migrationMappingCertainty' in inv[0] && !('semanticConfidence' in inv[0]));
  const m = J.migrateLegacy(recs, { organizationId: ORG, model, stageMap, sourceMap: {}, now: T0 });
  assert.equal(m.journeys.length, 3); assert.equal(m.transitions.length, 3, 'one baseline per journey, nothing fabricated');
  assert.ok(m.events.every(e => e.type === 'MIGRATED_TO_STAGE' && e.payload.historyUnavailable === true));
  assert.equal(m.report.historyUnavailableCount, 3); deq(m.report.unresolvedStages.map(u => u.legacyStage), ['Esquisito']);
  deq(m.report.outcomeAmbiguities.map(o => o.legacyId), ['L4'], 'no WON without explicit evidence');
  assert.equal(m.journeys.find(j => j.metadata.legacyId === 'L5').lifecycleStatus, 'CLOSED_LOST');
  assert.equal(m.acquisitions[0].primarySourceCode, 'UNKNOWN'); assert.equal(m.report.followUpsMigrated, 1); assert.equal(J.readState(m.nextActions[0], T0), 'OVERDUE');
  assert.equal(m.report.rawNotesExcluded, 1); assert.equal(m.journeys[0].metadata.createdAtUnknown, true); assert.equal(m.duplicates.length, 1);
  assert.equal(J.migrateLegacy(recs, { organizationId: ORG, model, stageMap, now: T0, existingIds: m.journeys.map(j => j.id) }).report.alreadyMigrated, 3);
});
test('JourneyTenantIsolation + services: atomic commit with compare-and-set, IDOR deny, assignment scope, board summaries only, no PII in audit', () => {
  const store = S.JourneyStore();
  const svc = S.services(store, { principal: P(), can: canAll, now: () => T0, idGen });
  const c = svc.application.create({ customerId: 'cus_c55', developmentId: DEV, ownerUserId: 'usr_broker1' }); assert.equal(c.ok, true); const id = c.journey.id;
  const t = svc.stage.transition(id, { toStageId: st('CONTACTED') }, 1); assert.equal(t.ok, true);
  const stale = svc.stage.transition(id, { toStageId: st('QUALIFYING'), reasonCode: 'X' }, 1); assert.equal(stale.code, 'JOURNEY_REVISION_CONFLICT');
  assert.equal(svc.stage.history(id).length, 2, 'nothing written on conflict');
  assert.equal(S.services(store, { principal: P('usr_z', 'org_other'), can: canAll }).application.get(id).code, 'NOT_FOUND', 'cross-tenant / IDOR');
  const broker2 = S.services(store, { principal: P('usr_broker2'), can: k => k === 'journey.readAssigned' || k === 'journey.transition' });
  assert.equal(broker2.application.get(id).code, 'NOT_FOUND', 'not assigned');
  const assigned = S.services(store, { principal: P('usr_broker2'), can: k => k === 'journey.readAssigned', customerAssignments: () => [{ customerId: 'cus_c55', assigneeType: 'USER', assigneeId: 'usr_broker2', role: 'COLLABORATOR', status: 'ACTIVE' }] });
  const g = assigned.application.get(id, 'TECHNICAL'); assert.equal(g.ok, true); assert.equal(g.timeline.mode, 'BROKER', 'technical projection needs journey.technical.read'); assert.equal(g.timeline.items[0].recordedAt, undefined);
  svc.timeline.record(id, { type: 'VISIT', channel: 'IN_PERSON', direction: 'MUTUAL' });
  const sug = svc.nextAction.suggestions(id); assert.ok(sug.some(s => s.type === 'FOLLOW_UP_VISIT'));
  assert.equal(svc.application.get(id).summary.currentStage.code, 'CONTACTED', 'visit suggestion not auto-applied');
  const offline = S.services(store, { principal: P(), can: canAll, connectivity: () => 'OFFLINE' }); assert.equal(offline.stage.transition(id, { toStageId: st('QUALIFYING') }, 2).code, 'OFFLINE_NOT_ALLOWED');
  const b = svc.board({}, { customerNames: new Map([['cus_c55', 'Maria Souza']]) });
  assert.equal(b.items.length, 1); const card = b.board.stageColumns.find(cl => cl.code === 'CONTACTED').cards[0]; assert.equal(card.customerDisplayName, 'Maria Souza'); assert.ok(!JSON.stringify(b).match(/@|99999/));
  assert.equal(svc.ingestion.ingest({ id: 'x1', type: 'FavoriteAdded', contextType: 'CUSTOMER', organizationId: 'org_other', customerId: 'cus_c55', payload: { lotId: 'L' } }).reason, 'CROSS_TENANT');
  assert.ok(!/Maria/.test(JSON.stringify(svc.audit())));
  assert.equal(svc.attribution.capture(id, { primarySourceCode: 'INVENTED', firstTouch: { landingPageRef: 'https://site/lp?email=a@b.com', referrer: 'https://www.google.com/search?q=x' } }).acquisition.primarySourceCode, 'UNKNOWN');
  const acq = svc.attribution.latest(id, { campaign: 'outubro' }).acquisition; assert.equal(acq.firstTouch.landingPageRef, 'https://site/lp'); assert.equal(acq.firstTouch.referrerDomain, 'www.google.com'); assert.equal(acq.latestTouch.campaign, 'outubro');
  assert.equal(svc.attribution.capture(id, {}).code, 'FIRST_TOUCH_IMMUTABLE');
  const won = svc.outcome.close(id, { type: 'LOST', reasonCode: 'NO_RESPONSE' }, 2); assert.equal(won.ok, true);
  store.clear(); assert.equal(svc.application.get(id).code, 'NOT_FOUND', 'logout / tenant switch clears');
});
test('regression + UI: no valorização promise, no hardcoded pipeline in the view, chip "Maria · Negociação", modules never touch lots/storage', () => {
  const src = MODULES.slice(4).map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n'), cfgText = JSON.stringify(App.configs.journey);
  assert.ok(!/valoriza/i.test(cfgText), 'no valorização wording in journey texts');
  assert.ok(!/localStorage\.|sessionStorage\.|indexedDB\./.test(src)); assert.ok(!/availability\.status\s*=|\.setStatus\(|commercial\.price\s*=/.test(src));
  const view = fs.readFileSync(path.join(SRC, 'customer/customerView.js'), 'utf8'); assert.ok(!/NEGOTIATING|Negociação|CONTACTED/.test(view), 'stages come from the model, not the UI');
  const j = J.transition(newJ().journey, { toStageId: st('NEGOTIATING'), override: true, reasonCode: 'OTHER' }, O({ expectedRevision: 1 })).journey;
  const s = J.summary(j, { now: T0 }); assert.equal(J.contextChip({ displayName: 'Maria Souza' }, s), 'Maria · Negociação');
  const html = App.customerView.journeyPanel({ available: true, summary: s, timeline: J.timeline(j, { events: [] }), allowedMoves: J.allowedMoves(j, model), revision: j.recordRevision });
  assert.ok(html.includes('data-act="jnyMove"') && html.includes('Negociação')); assert.ok(!html.includes('Fechado (ganho)'), 'terminal moves go through the outcome form');
  assert.ok(App.customerView.journeyPanel({ available: false }).includes('servidor'));
  assert.equal(App.customerView.optionPresentedButton('L1', false), '');
});
