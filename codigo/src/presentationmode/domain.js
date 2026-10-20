/* presentationmode/domain.js — topic 41: PresentationDefinition (mutable, revisioned) · PresentationBlockTypeRegistry +
   block schemas · PresentationTemplate · PresentationPreflightService (+ override policy) · PresentationVersionRefs ·
   PresentationSnapshotService (immutable, checksum, create-only) · LIVE projection (with stale-response protection) ·
   PresentationFreshnessEvaluator · PresentationSnapshotSafetyRecord · PresentationRepository (in-memory reference,
   tenant-scoped) · permissions / audit / domain events.

   Three separate things: the Definition is edited; the Snapshot is the frozen, client-safe, reproducible material; the
   Session (runtime.js) only navigates a Snapshot. The audience payload (snapshot.audience) is the ONLY thing a renderer
   or the ShareService (topic 42) may read; every internal ref (lot ids, customer id, versions) stays outside it.
   Frontend-only limitation: in the static panel the canonical lots are already in the page (public dataset, no customer
   PII); authoritative redaction for private data must run server-side with the same policy (docs/PRESENTATION_SECURITY_AND_REDACTION.md). */
App.presentationMode = App.presentationMode || {};
App.presentationMode.domain = (() => {
  const P = App.presentationMode.policy, PJ = App.presentationMode.projection, W = P.WORDING, F = App.fmt;
  const SCHEMA_VERSION = 1;
  const err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });
  const nowIso = o => (o && o.now) || new Date().toISOString();
  const stable = v => v == null || typeof v !== 'object' ? JSON.stringify(v === undefined ? null : v) : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']' : '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  /** two independent FNV-1a 32-bit passes (different offsets) → 16 hex chars; integrity/reproducibility check, not a security MAC */
  function checksum(v) {
    const s = stable(v); let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a ^= c; a = Math.imul(a, 0x01000193) >>> 0; b ^= c; b = Math.imul(b, 0x01000193) >>> 0; b = (b ^ (b >>> 13)) >>> 0; }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
  function opaqueId(prefix) {
    let r = null;
    try { if (typeof crypto !== 'undefined' && crypto.getRandomValues) r = Array.from(crypto.getRandomValues(new Uint8Array(10)), x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { r = null; }
    if (!r) { opaqueId.n = (opaqueId.n || 0) + 1; r = Date.now().toString(36) + opaqueId.n.toString(36); } // ids are references, never secrets
    return prefix + '_' + r;
  }
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } else if (o && typeof o === 'object') for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object' && !Object.isFrozen(o[k])) deepFreeze(o[k]); return o; };
  const plain = o => JSON.parse(JSON.stringify(o === undefined ? null : o));

  // ---------------------------------------------------------------- permissions (deny by default)
  /** Topic 41 permission keys. They are not yet in the backend registry (config/security/permissions.json mirrors it and
      only the backend adds keys): until then each key maps to an existing registry key ("interim") or to null = always
      denied in the frontend (override, presenter notes, theme management are never granted locally). */
  const PERMISSIONS = Object.freeze({
    'presentation.read': 'lot.view', 'presentation.create': 'lot.view', 'presentation.update': 'lot.view', 'presentation.archive': 'lot.view', 'presentation.preview': 'lot.view',
    'presentation.snapshot.create': 'lot.view', 'presentation.session.start': 'lot.view', 'presentation.feedback.record': 'lot.view',
    'presentation.internalNotes.read': null, 'presentation.preflight.override': null, 'presentation.theme.manage': null
  });
  /** can(ctx, key): ctx.can (backend-derived decisions) wins; else App.authz on the interim key; unknown key → false */
  function can(ctx, key) {
    if (!(key in PERMISSIONS)) return false;
    if (ctx && typeof ctx.can === 'function') return ctx.can(key) === true;
    const k = PERMISSIONS[key]; if (!k) return false;
    try { return !!(App.authz && App.authz.can(k, ctx && ctx.developmentId ? { developmentId: ctx.developmentId } : undefined)); } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- events + audit (opaque refs only, no PII)
  const EVENTS = [], AUDIT = [], MAX = 300;
  const EVENT_TYPES = Object.freeze(['PresentationSnapshotCreated', 'PresentationStarted', 'PresentationStepViewed', 'PresentationLotOpened', 'PresentationComparisonViewed', 'PresentationFinancialViewed',
    'PresentationFeedbackRecorded', 'PresentationEnded', 'PresentationCompleted']);
  const AUDIT_TYPES = Object.freeze(['PresentationCreated', 'PresentationUpdated', 'PresentationSnapshotCreated', 'PresentationPreflightBlocked', 'PresentationPreflightOverridden', 'PresentationStarted', 'PresentationEnded', 'PresentationArchived', 'PresentationSnapshotSafetyChanged']);
  function emit(type, data = {}, o = {}) {
    if (!EVENT_TYPES.includes(type)) throw err('UNKNOWN_EVENT', type);
    const ev = Object.freeze({ type, at: nowIso(o), ...sanitizeRefs(data) }); EVENTS.push(ev); if (EVENTS.length > MAX) EVENTS.shift(); return ev;
  }
  function audit(type, data = {}, o = {}) {
    if (!AUDIT_TYPES.includes(type)) throw err('UNKNOWN_AUDIT', type);
    const ev = Object.freeze({ type, at: nowIso(o), ...sanitizeRefs(data) }); AUDIT.push(ev); if (AUDIT.length > MAX) AUDIT.shift();
    try { if (App.authz && App.authz.audit) App.authz.audit.record({ action: type, resourceType: 'presentation', resourceId: data.snapshotId || data.definitionId || null, organizationId: data.organizationId, outcome: /Blocked/.test(type) ? 'DENIED' : 'SUCCESS', reasonCode: data.reasonCode || null, metadata: { refs: ev } }, o.now ? { now: o.now } : undefined); } catch (e) { /* tenant not resolvable in the static panel: the local log keeps it */ }
    return ev;
  }
  /** only opaque references and codes survive; names, contacts, notes and free text never enter events/audit */
  function sanitizeRefs(d) {
    const out = {};
    for (const [k, v] of Object.entries(d || {})) {
      if (/name|email|phone|telefone|note|text|reason$|label/i.test(k) && k !== 'reasonCode') continue;
      out[k] = Array.isArray(v) ? v.filter(x => typeof x !== 'object').slice(0, 20) : v && typeof v === 'object' ? undefined : v;
    }
    return out;
  }

  // ---------------------------------------------------------------- PresentationBlockTypeRegistry + schemas
  const str = max => v => typeof v === 'string' && v.length <= max && P.safeText(v, max).ok;
  const bool = v => typeof v === 'boolean', int = (a, b) => v => Number.isInteger(v) && v >= a && v <= b, lotId = v => typeof v === 'string' && v.length <= 40;
  const listOf = (f, max) => v => Array.isArray(v) && v.length <= max && v.every(f), oneOf = xs => v => xs.includes(v);
  const BLOCKS = {
    INTRO: { sourceDomain: 'DEVELOPMENT', schema: { headline: str(120), text: str(600) } },
    DEVELOPMENT_OVERVIEW: { sourceDomain: 'DEVELOPMENT', schema: {} },
    CUSTOMER_OBJECTIVE: { sourceDomain: 'CUSTOMER', schema: { showBudget: bool } },
    RECOMMENDATION_SUMMARY: { sourceDomain: 'RECOMMENDATION', schema: { max: int(1, 6) } },
    LOT_HIGHLIGHT: { sourceDomain: 'LOT', schema: { lotId }, required: ['lotId'] },
    LOT_DETAILS: { sourceDomain: 'LOT', schema: { lotId, fields: listOf(v => typeof v === 'string', 30) }, required: ['lotId'] },
    COMPARISON: { sourceDomain: 'COMPARISON', schema: {} },
    FINANCIAL_SIMULATION: { sourceDomain: 'FINANCIAL', schema: { lotId, simulationRef: str(80), planIds: listOf(v => typeof v === 'string', 8) }, required: ['lotId', 'simulationRef'] },
    MAP: { sourceDomain: 'MAP', schema: { showAvailability: bool } },
    LOCATION: { sourceDomain: 'LOT', schema: {} },
    AVAILABILITY_STATUS: { sourceDomain: 'LOT', schema: { claim: oneOf(['NONE', 'AVAILABLE_NOW']) } },
    INVESTMENT_CONTEXT: { sourceDomain: 'LOT', schema: {} },
    ALERTS_CLIENT_SAFE: { sourceDomain: 'LOT', schema: {} },
    NEXT_STEPS: { sourceDomain: 'JOURNEY', schema: { items: listOf(oneOf(Object.keys(PJ.NEXT_STEP)), 6) } },
    CUSTOM: { sourceDomain: 'DEVELOPMENT', schema: { text: str(600) }, required: ['text'] }
  };
  const BLOCK_REGISTRY = Object.freeze(Object.fromEntries(Object.entries(BLOCKS).map(([type, b]) => [type, Object.freeze({ type, sourceDomain: b.sourceDomain, configSchemaRef: `block.${type}.v1`,
    projectionServiceId: `presentation.projection.${type}`, supportsLive: true, supportsSnapshot: true, clientSafeByDefault: true, requiredPermission: 'presentation.read', configKeys: Object.freeze(Object.keys(b.schema)) })])));
  /** validateBlockConfig(block) → [{ code, key }]: unknown keys and wrong types are errors (no free-form config) */
  function validateBlockConfig(block) {
    const def = BLOCKS[block.type]; if (!def) return [{ code: 'UNSUPPORTED_BLOCK', key: null }];
    const errors = [], cfg = block.config || {};
    for (const [k, v] of Object.entries(cfg)) { if (!def.schema[k]) errors.push({ code: 'UNKNOWN_CONFIG_KEY', key: k }); else if (v != null && !def.schema[k](v)) errors.push({ code: 'INVALID_CONFIG_VALUE', key: k }); }
    for (const k of def.required || []) if (cfg[k] == null) errors.push({ code: 'MISSING_CONFIG', key: k });
    if (block.title != null && !str(120)(block.title)) errors.push({ code: 'INVALID_TITLE', key: 'title' });
    return errors;
  }

  // ---------------------------------------------------------------- templates (no live data)
  const T = (code, name, purpose, blocks) => Object.freeze({ id: 'tpl_' + code.toLowerCase(), organizationId: null, code, name, purpose, version: '1.0.0', status: 'ACTIVE',
    blockTemplates: Object.freeze(blocks.map(b => Object.freeze(typeof b === 'string' ? { type: b } : b))), storylineTemplate: Object.freeze(blocks.map(b => typeof b === 'string' ? b : b.type)) });
  const TEMPLATES = Object.freeze({
    INITIAL_OPTIONS: T('INITIAL_OPTIONS', 'Opções iniciais', 'INITIAL_OPTIONS', ['INTRO', 'CUSTOMER_OBJECTIVE', { type: 'RECOMMENDATION_SUMMARY', criticality: 'IMPORTANT' }, { type: 'LOT_HIGHLIGHT', perLot: 3 }, { type: 'COMPARISON', criticality: 'OPTIONAL' }, 'MAP', 'NEXT_STEPS']),
    SHORTLIST: T('SHORTLIST', 'Seleção de lotes', 'SHORTLIST', ['INTRO', { type: 'LOT_HIGHLIGHT', perLot: 6 }, { type: 'COMPARISON', criticality: 'OPTIONAL' }, 'MAP', 'NEXT_STEPS']),
    COMPARISON: T('COMPARISON', 'Comparação', 'COMPARISON', ['INTRO', { type: 'COMPARISON', criticality: 'CRITICAL' }, 'MAP', 'NEXT_STEPS']),
    INVESTMENT_REVIEW: T('INVESTMENT_REVIEW', 'Análise para investimento', 'INVESTMENT_REVIEW', ['INTRO', 'CUSTOMER_OBJECTIVE', 'LOCATION', { type: 'LOT_HIGHLIGHT', perLot: 4 }, 'INVESTMENT_CONTEXT', { type: 'COMPARISON', criticality: 'OPTIONAL' }, { type: 'FINANCIAL_SIMULATION', perLot: 1, criticality: 'IMPORTANT' }, 'NEXT_STEPS']),
    FINANCIAL_REVIEW: T('FINANCIAL_REVIEW', 'Condições de pagamento', 'FINANCIAL_REVIEW', [{ type: 'LOT_DETAILS', perLot: 1 }, 'AVAILABILITY_STATUS', { type: 'FINANCIAL_SIMULATION', perLot: 1, criticality: 'CRITICAL' }, 'NEXT_STEPS']),
    VISIT_PREPARATION: T('VISIT_PREPARATION', 'Preparação de visita', 'VISIT_PREPARATION', ['INTRO', { type: 'LOT_HIGHLIGHT', perLot: 4 }, 'LOCATION', 'MAP', { type: 'NEXT_STEPS', config: { items: ['VISIT', 'CONFIRM_AVAILABILITY'] } }]),
    GENERAL_PRESENTATION: T('GENERAL_PRESENTATION', 'Apresentação geral', 'GENERAL_PRESENTATION', ['INTRO', 'DEVELOPMENT_OVERVIEW', 'MAP', 'NEXT_STEPS'])
  });
  /** expandTemplate(template, lotIds, opts) → { contentBlocks, storyline } — lot blocks repeat per lot in presentation order; sensitive blocks are never auto-added */
  function expandTemplate(tpl, lotIds = [], opts = {}) {
    if (!tpl || tpl.status !== 'ACTIVE') throw err('TEMPLATE_NOT_ACTIVE', 'Template indisponível.');
    const blocks = []; let n = 0;
    const add = (b, cfg) => { n++; blocks.push({ id: 'b' + n, type: b.type, title: null, enabled: true, config: { ...(b.config || {}), ...cfg }, visibilityPolicyRef: P.POLICY_VERSION, order: n, criticality: b.criticality || 'OPTIONAL' }); };
    for (const b of tpl.blockTemplates) {
      if (b.type === 'FINANCIAL_SIMULATION' && !opts.simulationRefs) continue; // needs an existing simulation result
      if (b.type === 'RECOMMENDATION_SUMMARY' && !opts.hasRecommendation) continue;
      if (b.type === 'COMPARISON' && !opts.hasComparison) continue;
      if (b.type === 'CUSTOMER_OBJECTIVE' && !opts.hasCustomer) continue;
      if (b.perLot) { for (const id of lotIds.slice(0, b.perLot)) add(b, b.type === 'FINANCIAL_SIMULATION' ? { lotId: id, simulationRef: opts.simulationRefs[id] } : { lotId: id }); continue; }
      add(b, {});
    }
    const finals = blocks.filter(b => !(b.type === 'FINANCIAL_SIMULATION' && !b.config.simulationRef));
    finals.forEach((b, i) => { b.order = i + 1; });
    const steps = finals.map((b, i) => ({ id: 'st' + (i + 1), blockId: b.id, order: i + 1, title: null, navigationLabel: null, skippable: b.criticality !== 'CRITICAL', presenterHint: null }));
    return { contentBlocks: finals, storyline: { steps, startStepId: steps.length ? steps[0].id : null, allowFreeNavigation: true, allowReturnToMap: true, allowLotJump: true }, templateRef: `${tpl.code}@${tpl.version}` };
  }

  // ---------------------------------------------------------------- PresentationDefinition
  const LIMITS = Object.freeze({ maxLots: 12, maxBlocks: 30 });
  function validateDefinition(d) {
    const e = [];
    if (!d.organizationId) e.push('organizationId'); if (!d.developmentId) e.push('developmentId');
    if (!P.Purpose[d.purpose]) e.push('purpose'); if (!P.Audience[d.audience]) e.push('audience');
    if (!str(120)(d.title || '')) e.push('title'); if (d.subtitle != null && !str(200)(d.subtitle)) e.push('subtitle');
    if (!Array.isArray(d.lotIds) || d.lotIds.length > LIMITS.maxLots || new Set(d.lotIds).size !== d.lotIds.length) e.push('lotIds');
    if (!Array.isArray(d.contentBlocks) || d.contentBlocks.length > LIMITS.maxBlocks) e.push('contentBlocks');
    return e;
  }
  /** create(ctx, input) — ctx = { organizationId, userId, can?, now? }. organizationId always comes from the context, never from input. */
  function createDefinition(ctx, input = {}) {
    if (!can(ctx, 'presentation.create')) throw err('FORBIDDEN', 'Você não possui permissão para criar apresentações.');
    const at = nowIso(ctx);
    const d = { id: opaqueId('prd'), organizationId: ctx.organizationId, developmentId: input.developmentId, customerId: input.customerId || null, journeyId: input.journeyId || null,
      title: input.title || 'Apresentação', subtitle: input.subtitle || null, purpose: input.purpose || 'GENERAL_PRESENTATION', audience: input.audience || 'CUSTOMER',
      contentBlocks: plain(input.contentBlocks || []), storyline: plain(input.storyline || { steps: [], startStepId: null, allowFreeNavigation: true, allowReturnToMap: true, allowLotJump: true }),
      lotIds: (input.lotIds || []).slice(), comparisonSessionId: input.comparisonSessionId || null, recommendationResultId: input.recommendationResultId || null, favoriteCollectionId: input.favoriteCollectionId || null,
      financialSimulationRefs: (input.financialSimulationRefs || []).slice(), themeRef: input.themeRef || null, templateRef: input.templateRef || null, sourceKind: input.sourceKind || 'MANUAL',
      lifecycleStatus: 'DRAFT', createdAt: at, updatedAt: at, createdBy: ctx.userId || null, updatedBy: null, recordRevision: 1, schemaVersion: SCHEMA_VERSION };
    const bad = validateDefinition(d); if (bad.length) throw err('INVALID_DEFINITION', 'Definição inválida: ' + bad.join(', '), { fields: bad });
    audit('PresentationCreated', { organizationId: d.organizationId, definitionId: d.id }, ctx);
    return deepFreeze(d);
  }
  /** sources: lot order follows the source (rank / collection / comparison); the presentation order is then curated separately */
  const fromRecommendation = (ctx, { recommendation, max = 3, ...rest }) => createDefinition(ctx, { ...rest, sourceKind: 'RECOMMENDATION', recommendationResultId: recommendation.id,
    lotIds: (recommendation.result.recommendations || []).slice(0, max).map(r => r.lotId), purpose: rest.purpose || 'INITIAL_OPTIONS' });
  const fromFavorites = (ctx, { collection, ...rest }) => createDefinition(ctx, { ...rest, sourceKind: 'FAVORITES', favoriteCollectionId: collection.id, lotIds: [...new Set(collection.lotIds)].slice(0, LIMITS.maxLots), purpose: rest.purpose || 'SHORTLIST' });
  const fromComparison = (ctx, { session, ...rest }) => createDefinition(ctx, { ...rest, sourceKind: 'COMPARISON', comparisonSessionId: session.id, lotIds: session.candidateIds.slice(), purpose: rest.purpose || 'COMPARISON' });
  /** revise(def, patch, expectedRevision, ctx) → new frozen definition (optimistic concurrency); READY returns to DRAFT on edit */
  function revise(def, patch, expectedRevision, ctx = {}) {
    if (!can(ctx, 'presentation.update')) throw err('FORBIDDEN', 'Você não possui permissão para editar apresentações.');
    if (def.organizationId !== ctx.organizationId) throw err('NOT_FOUND', 'Apresentação não encontrada.');
    if (def.lifecycleStatus === 'ARCHIVED') throw err('ARCHIVED', 'Apresentação arquivada não pode ser editada.');
    if (expectedRevision !== def.recordRevision) throw err('REVISION_CONFLICT', 'Esta apresentação foi alterada por outra pessoa. Recarregue antes de salvar.', { currentRevision: def.recordRevision });
    const allowed = ['title', 'subtitle', 'purpose', 'audience', 'contentBlocks', 'storyline', 'lotIds', 'customerId', 'journeyId', 'comparisonSessionId', 'recommendationResultId', 'favoriteCollectionId', 'financialSimulationRefs', 'themeRef', 'templateRef'];
    const bad = Object.keys(patch).filter(k => !allowed.includes(k)); if (bad.length) throw err('FIELD_NOT_EDITABLE', 'Campos não editáveis: ' + bad.join(', '));
    const next = { ...plain(def), ...plain(patch), lifecycleStatus: def.lifecycleStatus === 'READY' ? 'DRAFT' : def.lifecycleStatus, recordRevision: def.recordRevision + 1, updatedAt: nowIso(ctx), updatedBy: ctx.userId || null };
    const v = validateDefinition(next); if (v.length) throw err('INVALID_DEFINITION', 'Definição inválida: ' + v.join(', '), { fields: v });
    audit('PresentationUpdated', { organizationId: def.organizationId, definitionId: def.id, revision: next.recordRevision }, ctx);
    return deepFreeze(next);
  }
  /** reorderLots: a permutation of the current lots (curated order ≠ recommendation rank, which stays in the source result) */
  function reorderLots(def, order, ctx) {
    const same = order.length === def.lotIds.length && order.every(id => def.lotIds.includes(id)) && new Set(order).size === order.length;
    if (!same) throw err('INVALID_ORDER', 'A nova ordem deve conter exatamente os mesmos lotes.');
    return revise(def, { lotIds: order.slice() }, def.recordRevision, ctx);
  }
  const applyTemplate = (def, code, ctx, opts = {}) => { const tpl = TEMPLATES[code]; if (!tpl) throw err('TEMPLATE_NOT_FOUND', 'Template não encontrado.'); const x = expandTemplate(tpl, def.lotIds, { hasRecommendation: !!def.recommendationResultId, hasComparison: !!def.comparisonSessionId, hasCustomer: !!def.customerId, ...opts }); return revise(def, { contentBlocks: x.contentBlocks, storyline: x.storyline, templateRef: x.templateRef, purpose: tpl.purpose }, def.recordRevision, ctx); };
  function markReady(def, pre, ctx = {}) {
    if (!pre || pre.status === 'FAIL') throw err('PREFLIGHT_REQUIRED', 'A apresentação precisa passar na verificação antes de ficar pronta.');
    if (pre.definitionRevision !== def.recordRevision) throw err('PREFLIGHT_OUTDATED', 'A apresentação mudou depois da verificação. Verifique novamente.');
    return deepFreeze({ ...plain(def), lifecycleStatus: 'READY', updatedAt: nowIso(ctx), recordRevision: def.recordRevision }); // status-only change keeps the revision the preflight saw
  }
  function archive(def, ctx = {}) {
    if (!can(ctx, 'presentation.archive')) throw err('FORBIDDEN', 'Você não possui permissão para arquivar apresentações.');
    audit('PresentationArchived', { organizationId: def.organizationId, definitionId: def.id }, ctx);
    return deepFreeze({ ...plain(def), lifecycleStatus: 'ARCHIVED', updatedAt: nowIso(ctx), recordRevision: def.recordRevision + 1 });
  }

  // ---------------------------------------------------------------- projection of one block (client-safe payload)
  const lotLabel = l => F.formatLotTitle(l.identity.blockId, l.identity.lotNumber);
  function blockPayload(block, def, src, pctx) {
    const c = block.config || {}, R = src.resolve, lots = pctx.lots;
    switch (block.type) {
      case 'INTRO': return { headline: c.headline || def.title, subtitle: def.subtitle || null, text: c.text || null, customerLabel: pctx.customerLabel };
      case 'DEVELOPMENT_OVERVIEW': return PJ.developmentOverview(src.dev);
      case 'CUSTOMER_OBJECTIVE': return src.customer && src.customer.profile ? PJ.customerObjective(src.customer.profile, { ...pctx, showBudget: !!c.showBudget }) : null;
      case 'RECOMMENDATION_SUMMARY': return src.recommendation ? PJ.recommendation(src.recommendation.result, { ...pctx, resolve: R, max: c.max || 3 }) : null;
      case 'LOT_HIGHLIGHT': { const l = R(c.lotId); return l ? { card: PJ.lotCard(l, pctx) } : null; }
      case 'LOT_DETAILS': { const l = R(c.lotId); return l ? PJ.lotDetails(l, c.fields, pctx) : null; }
      case 'COMPARISON': return src.comparison && src.comparison.evaluation ? PJ.comparison(src.comparison.evaluation, { ...pctx, resolve: R }) : null;
      case 'FINANCIAL_SIMULATION': { const l = R(c.lotId), s = (src.simulations || {})[c.simulationRef]; return l && s ? { card: PJ.lotCard(l, pctx), simulation: PJ.financial(s, { planIds: c.planIds }) } : null; }
      case 'MAP': return PJ.map({ ...pctx, developmentId: def.developmentId, lots, comparisonLots: src.comparison && src.comparison.evaluation ? src.comparison.evaluation.candidateIds.map(R) : [],
        recommendationLots: src.recommendation ? (src.recommendation.result.recommendations || []).map(r => R(r.lotId)) : [], showAvailability: c.showAvailability !== false });
      case 'LOCATION': return { items: lots.map(l => ({ lotLabel: lotLabel(l), rows: ['mobility.routeDistanceToGateM', 'mobility.routeDistanceToLeisureM', 'location.distanceToClubLinearM', 'location.distanceToSquareM', 'location.distanceToGreenAreaM'].map(k => PJ.value(l, k, pctx)).filter(Boolean) })) };
      case 'AVAILABILITY_STATUS': return { items: lots.map(l => ({ lotLabel: lotLabel(l), availability: PJ.availability(l, pctx) })) };
      case 'INVESTMENT_CONTEXT': return PJ.investmentContext(lots, pctx);
      case 'ALERTS_CLIENT_SAFE': return { items: lots.map(l => ({ lotLabel: lotLabel(l), alerts: PJ.alerts(l, pctx) })).filter(x => x.alerts.length) };
      case 'NEXT_STEPS': return { items: PJ.nextSteps(c.items) };
      case 'CUSTOM': { const t = P.safeText(c.text); if (!t || !t.ok) throw err('REDACTION_ERROR', 'Texto livre inválido.'); return { text: t.value }; }
      default: throw err('UNSUPPORTED_BLOCK', block.type);
    }
  }
  function projectionContext(def, src, opts = {}) {
    const policy = opts.policy || P.current();
    const display = opts.customerDisplay || policy.customerDisplay;
    return { policy, priceTable: src.priceTable || null, commercialFreshness: (src.freshness || {}).commercial || 'UNKNOWN', offline: !!opts.offline, developmentId: def.developmentId,
      customerLabel: def.audience === 'INTERNAL_PREVIEW' || !src.customer ? (src.customer ? P.customerLabel(src.customer, display) : null) : P.customerLabel(src.customer, display),
      lots: def.lotIds.map(src.resolve).filter(Boolean), fitByLot: src.fitByLot || null };
  }

  // ---------------------------------------------------------------- version refs
  function versionRefs(def, src, opts = {}) {
    const dev = src.dev || {}, pt = src.priceTable, lots = def.lotIds.map(src.resolve).filter(Boolean);
    const simIds = def.contentBlocks.filter(b => b.enabled !== false && b.type === 'FINANCIAL_SIMULATION').map(b => b.config.simulationRef).filter(Boolean);
    return {
      staticDataVersion: dev.staticDataVersion || ((src.dataVersions || {}).static ?? null), analysisVersionRefs: { analysis: dev.analysisVersion || ((src.dataVersions || {}).analysis ?? null) },
      priceTableVersionId: pt ? `${pt.id}@${pt.version}` : null, availabilityRevision: src.availabilityRevision != null ? String(src.availabilityRevision) : checksum(lots.map(l => [l.identity.code, l.availability.status, l.availability.revision ?? null, l.availability.freshness])),
      recommendationResultId: src.recommendation ? src.recommendation.id : null, comparisonSnapshotId: src.comparison && src.comparison.snapshot ? src.comparison.snapshot.id : null,
      profileVersionId: src.customer ? (src.customer.profileVersionId || (src.recommendation && src.recommendation.profileVersionId) || null) : null,
      financialSimulationResultIds: simIds, alertRuleSetVersionId: dev.analysisVersion || null, clientSafePolicyVersion: (opts.policy || P.current()).version,
      themeVersion: src.theme ? `${src.theme.id}@${src.theme.version}` : null, templateRef: def.templateRef || null
    };
  }

  // ---------------------------------------------------------------- Preflight
  const OVERRIDES = Object.freeze({
    PRICE_STALE_FINANCIAL: { allowed: true, requiredPermission: 'presentation.preflight.override', requireReason: true }, // e.g. price confirmed verbally: wording keeps the caveat
    AVAILABILITY_STALE_CRITICAL: { allowed: true, requiredPermission: 'presentation.preflight.override', requireReason: true },
    BLOCK_SOURCE_MISSING: { allowed: true, requiredPermission: 'presentation.preflight.override', requireReason: true }
  }); // everything else (PII/internal exposure, cross-tenant, redaction, unsafe claims, version incoherence…) is non-overridable
  const MSG = Object.freeze({
    CROSS_TENANT: 'Recurso de outra organização.', CUSTOMER_ACCESS_DENIED: 'Sem acesso a este cliente.', JOURNEY_ACCESS_DENIED: 'Sem acesso a esta jornada.', NO_LOTS: 'Selecione ao menos um lote.',
    LOT_NOT_FOUND: 'Lote não encontrado.', WRONG_DEVELOPMENT: 'Lote de outro empreendimento.', AVAILABILITY_UNCONFIRMED: 'Disponibilidade não confirmada: a apresentação mostrará "sujeita a confirmação".',
    AVAILABILITY_STALE: 'Disponibilidade pode estar desatualizada.', AVAILABILITY_CLAIM_UNSUPPORTED: 'O bloco afirma "disponível agora", mas a disponibilidade não está confirmada.',
    AVAILABILITY_STALE_CRITICAL: 'Bloco crítico depende de disponibilidade não confirmada.', PRICE_STALE: 'Preço pode estar desatualizado: será exibido com ressalva.',
    PRICE_STALE_FINANCIAL: 'Simulação crítica sobre preço não confirmado.', PRICE_CONFLICTED: 'Preço conflitante.', PRICE_NOT_AVAILABLE: 'Lote sem preço de tabela.',
    RECOMMENDATION_REF_MISSING: 'Recomendação referenciada não encontrada.', RECOMMENDATION_PROFILE_VERSION_MISSING: 'Recomendação sem versão de perfil.',
    COMPARISON_REF_MISSING: 'Comparação referenciada não encontrada.', COMPARISON_VERSION_MISMATCH: 'Comparação com versões incoerentes.', COMPARISON_TOO_MANY_LOTS: 'Mais de 4 lotes: use navegação por seleção.',
    SIMULATION_REF_INVALID: 'Simulação referenciada inválida.', SIMULATION_VERSION_MISSING: 'Simulação sem versão.', UNSUPPORTED_BLOCK: 'Bloco não suportado.', INVALID_BLOCK_CONFIG: 'Configuração de bloco inválida.',
    BLOCK_NOT_ALLOWED_BY_POLICY: 'Bloco não permitido pela política client-safe.', PII_OR_INTERNAL_DATA_EXPOSURE: 'Dado pessoal ou interno chegaria ao cliente.', UNSAFE_CLAIM: 'Afirmação sem suporte (valorização, garantia, probabilidade).',
    REDACTION_ERROR: 'Falha ao aplicar a redação client-safe.', PROJECTION_ERROR: 'Falha ao montar o bloco.', BLOCK_SOURCE_MISSING: 'Fonte do bloco indisponível.', STORYLINE_INVALID: 'Roteiro aponta para bloco inexistente.',
    THEME_MISSING: 'Tema não encontrado: será usado o tema padrão.', MIXED_VERSIONS: 'Fontes com versões diferentes (documentadas no snapshot).', OFFLINE_LIVE: 'Sem conexão: dados ao vivo indisponíveis.',
    POLICY_VERSION_MISMATCH: 'Versão da política client-safe diferente da vigente.'
  });
  const LEAK_CODES = new Set(['PII_EMAIL', 'PII_CPF', 'PII_PHONE', 'PII_FIELD', 'INTERNAL_FIELD', 'INTERNAL_LOT_ID', 'TECHNICAL_PROVENANCE', 'HTML_MARKUP']);
  const projCache = new WeakMap();
  /** preflight(def, src, ctx) → PresentationPreflightResult. ctx = { organizationId, can?, now?, overrides: [{ issueCode, blockId?, reason }], offline?, dataMode? } */
  function preflight(def, src, ctx = {}) {
    const policy = ctx.policy || P.current(), blocking = [], warnings = [], info = [];
    const I = (sev, code, extra = {}) => { const x = { code, severity: sev, message: MSG[code] || code, overridable: !!(OVERRIDES[code] && OVERRIDES[code].allowed), ...extra }; (sev === 'BLOCKING' ? blocking : sev === 'WARNING' ? warnings : info).push(x); return x; };
    if (def.organizationId !== ctx.organizationId || (src.organizationId && src.organizationId !== def.organizationId)) I('BLOCKING', 'CROSS_TENANT');
    if (ctx.clientSafePolicyVersion && ctx.clientSafePolicyVersion !== policy.version) I('BLOCKING', 'POLICY_VERSION_MISMATCH');
    if (def.customerId) { const c = src.customer; if (!c || c.id !== def.customerId || c.organizationId !== def.organizationId || (src.canAccessCustomer && !src.canAccessCustomer(def.customerId))) I('BLOCKING', 'CUSTOMER_ACCESS_DENIED'); }
    if (def.journeyId) { const j = src.journey; if (!j || j.id !== def.journeyId || j.organizationId !== def.organizationId || (src.canAccessJourney && !src.canAccessJourney(def.journeyId))) I('BLOCKING', 'JOURNEY_ACCESS_DENIED'); }
    if (!def.lotIds.length) I('BLOCKING', 'NO_LOTS');
    const pctx = projectionContext(def, src, { policy, offline: ctx.offline });
    for (const id of def.lotIds) {
      const l = src.resolve(id); if (!l) { I('BLOCKING', 'LOT_NOT_FOUND'); continue; }
      if (l.identity.developmentId !== def.developmentId) { I('BLOCKING', 'WRONG_DEVELOPMENT', { lotRef: l.identity.code }); continue; }
      const av = PJ.availability(l, pctx), pr = PJ.price(l, pctx);
      if (l.availability.status === 'AVAILABLE' && av.state === 'STATUS_CONFIRMATION_REQUIRED') I('WARNING', 'AVAILABILITY_STALE', { lotRef: l.identity.code });
      else if (av.state === 'STATUS_CONFIRMATION_REQUIRED') I('WARNING', 'AVAILABILITY_UNCONFIRMED', { lotRef: l.identity.code });
      if (pr.state === 'CURRENT_WITH_CAVEAT') I('WARNING', 'PRICE_STALE', { lotRef: l.identity.code });
      if (pr.state === 'NOT_AVAILABLE') I('INFO', 'PRICE_NOT_AVAILABLE', { lotRef: l.identity.code });
      if (pr.state === 'CONFLICTED') { const fin = def.contentBlocks.some(b => b.enabled !== false && b.type === 'FINANCIAL_SIMULATION' && b.config.lotId === id); I(fin || def.purpose === 'FINANCIAL_REVIEW' ? 'BLOCKING' : 'WARNING', 'PRICE_CONFLICTED', { lotRef: l.identity.code }); }
    }
    const blockIds = new Set(), payloads = {};
    for (const b of def.contentBlocks) {
      blockIds.add(b.id); if (b.enabled === false) continue;
      const crit = P.Criticality[b.criticality] ? b.criticality : 'OPTIONAL', at = { blockId: b.id, blockType: b.type };
      if (P.INTERNAL_BLOCK_TYPES.includes(b.type)) { I('BLOCKING', 'PII_OR_INTERNAL_DATA_EXPOSURE', at); continue; }
      if (!BLOCK_REGISTRY[b.type]) { I('BLOCKING', 'UNSUPPORTED_BLOCK', at); continue; }
      if (!policy.allowedBlockTypes.includes(b.type)) { I('BLOCKING', 'BLOCK_NOT_ALLOWED_BY_POLICY', at); continue; }
      const ce = validateBlockConfig(b); if (ce.length) { I('BLOCKING', 'INVALID_BLOCK_CONFIG', { ...at, details: ce }); continue; }
      if (b.config.lotId && !def.lotIds.includes(b.config.lotId)) { I('BLOCKING', 'INVALID_BLOCK_CONFIG', { ...at, details: [{ code: 'LOT_NOT_IN_PRESENTATION', key: 'lotId' }] }); continue; }
      if (b.type === 'RECOMMENDATION_SUMMARY') {
        if (!src.recommendation || (def.recommendationResultId && src.recommendation.id !== def.recommendationResultId)) { I(crit === 'OPTIONAL' ? 'WARNING' : 'BLOCKING', crit === 'OPTIONAL' ? 'BLOCK_SOURCE_MISSING' : 'RECOMMENDATION_REF_MISSING', at); continue; }
        if (!src.recommendation.profileVersionId) { I('BLOCKING', 'RECOMMENDATION_PROFILE_VERSION_MISSING', at); continue; }
      }
      if (b.type === 'COMPARISON') {
        const cm = src.comparison;
        if (!cm || !cm.evaluation || !cm.snapshot || (def.comparisonSessionId && cm.sessionId && cm.sessionId !== def.comparisonSessionId)) { I(crit === 'OPTIONAL' ? 'WARNING' : 'BLOCKING', crit === 'OPTIONAL' ? 'BLOCK_SOURCE_MISSING' : 'COMPARISON_REF_MISSING', at); continue; }
        if (cm.evaluation.comparisonSnapshotId !== cm.snapshot.id || (cm.snapshot.hash && cm.evaluation.comparisonSnapshotHash !== cm.snapshot.hash)) { I('BLOCKING', 'COMPARISON_VERSION_MISMATCH', at); continue; }
        if (cm.evaluation.candidateIds.length > policy.maxComparisonLots) I('INFO', 'COMPARISON_TOO_MANY_LOTS', at);
        if (cm.snapshot.dataVersions && src.dataVersions && Object.keys(cm.snapshot.dataVersions).some(k => src.dataVersions[k] != null && cm.snapshot.dataVersions[k] != null && String(cm.snapshot.dataVersions[k]) !== String(src.dataVersions[k]))) I('WARNING', 'MIXED_VERSIONS', at);
      }
      if (b.type === 'FINANCIAL_SIMULATION') {
        const s = (src.simulations || {})[b.config.simulationRef];
        if (!s || !s.result || (s.lotId && s.lotId !== b.config.lotId)) { I('BLOCKING', 'SIMULATION_REF_INVALID', at); continue; }
        if (!s.version) { I('BLOCKING', 'SIMULATION_VERSION_MISSING', at); continue; }
        const l = src.resolve(b.config.lotId), pr = l ? PJ.price(l, pctx) : null;
        if (crit === 'CRITICAL' && pr && pr.state === 'CURRENT_WITH_CAVEAT') I('BLOCKING', 'PRICE_STALE_FINANCIAL', at);
      }
      if (b.type === 'AVAILABILITY_STATUS' && b.config.claim === 'AVAILABLE_NOW' && pctx.lots.some(l => PJ.availability(l, pctx).state !== 'AVAILABLE_CONFIRMED')) { I('BLOCKING', 'AVAILABILITY_CLAIM_UNSUPPORTED', at); continue; }
      if (crit === 'CRITICAL' && ['LOT_HIGHLIGHT', 'LOT_DETAILS', 'AVAILABILITY_STATUS'].includes(b.type) && pctx.lots.some(l => (!b.config.lotId || l.identity.id === b.config.lotId) && PJ.availability(l, pctx).state === 'STATUS_CONFIRMATION_REQUIRED')) I('BLOCKING', 'AVAILABILITY_STALE_CRITICAL', at);
      let payload;
      try { payload = blockPayload(b, def, src, pctx); } catch (e) { I(e.code === 'REDACTION_ERROR' || crit !== 'OPTIONAL' ? 'BLOCKING' : 'WARNING', e.code === 'REDACTION_ERROR' ? 'REDACTION_ERROR' : 'PROJECTION_ERROR', at); continue; }
      if (payload == null) { I(crit === 'OPTIONAL' ? 'WARNING' : 'BLOCKING', 'BLOCK_SOURCE_MISSING', at); continue; }
      const audiencePart = { title: b.title || null, payload };
      const leaks = P.scanPayload(audiencePart);
      if (leaks.some(x => x.code === 'UNSAFE_CLAIM')) I('BLOCKING', 'UNSAFE_CLAIM', { ...at, paths: leaks.filter(x => x.code === 'UNSAFE_CLAIM').map(x => x.path) });
      if (leaks.some(x => LEAK_CODES.has(x.code))) { I('BLOCKING', 'PII_OR_INTERNAL_DATA_EXPOSURE', { ...at, leakCodes: [...new Set(leaks.filter(x => LEAK_CODES.has(x.code)).map(x => x.code))] }); continue; }
      payloads[b.id] = payload;
    }
    for (const s of (def.storyline && def.storyline.steps) || []) if (!blockIds.has(s.blockId)) I('BLOCKING', 'STORYLINE_INVALID', { stepId: s.id });
    for (const s of (def.storyline && def.storyline.steps) || []) for (const k of ['title', 'navigationLabel']) if (s[k] != null) { const l = P.scanPayload({ v: s[k] }); if (l.length || !P.safeText(s[k], 120).ok) I('BLOCKING', 'PII_OR_INTERNAL_DATA_EXPOSURE', { stepId: s.id }); }
    if (pctx.customerLabel && P.scanPayload({ v: pctx.customerLabel }).length) I('BLOCKING', 'PII_OR_INTERNAL_DATA_EXPOSURE', { field: 'customerLabel' });
    if (def.themeRef && !(src.theme && src.theme.id === def.themeRef)) I('WARNING', 'THEME_MISSING');
    if (ctx.offline && ctx.dataMode === 'LIVE') I('BLOCKING', 'OFFLINE_LIVE');
    // overrides: explicit, permissioned, reasoned, audited; never for non-overridable issues
    for (const o of ctx.overrides || []) {
      const pol = OVERRIDES[o.issueCode];
      const idx = blocking.findIndex(x => x.code === o.issueCode && (!o.blockId || x.blockId === o.blockId));
      if (idx < 0 || !pol || !pol.allowed) continue;
      if (!can(ctx, pol.requiredPermission)) continue;
      if (pol.requireReason && !(o.reason && String(o.reason).trim().length >= 5)) continue;
      const [x] = blocking.splice(idx, 1); warnings.push({ ...x, severity: 'WARNING', overridden: true });
      audit('PresentationPreflightOverridden', { organizationId: def.organizationId, definitionId: def.id, issueCode: x.code, revision: def.recordRevision }, ctx);
    }
    const status = blocking.length ? 'FAIL' : warnings.length ? 'PASS_WITH_WARNINGS' : 'PASS';
    if (status === 'FAIL') audit('PresentationPreflightBlocked', { organizationId: def.organizationId, definitionId: def.id, reasonCode: blocking[0].code, revision: def.recordRevision }, ctx);
    const res = Object.freeze({ status, blockingIssues: Object.freeze(blocking.map(Object.freeze)), warnings: Object.freeze(warnings.map(Object.freeze)), informational: Object.freeze(info.map(Object.freeze)),
      resolvedVersionRefs: Object.freeze(versionRefs(def, src, { policy })), evaluatedAt: nowIso(ctx), definitionRevision: def.recordRevision, clientSafePolicyVersion: policy.version });
    projCache.set(res, { payloads, pctx });
    return res;
  }

  // ---------------------------------------------------------------- audience payload (the only thing a renderer/share receives)
  function buildAudience(def, payloads, pctx, policy, meta) {
    const enabled = def.contentBlocks.filter(b => b.enabled !== false && payloads[b.id] != null).sort((a, b) => a.order - b.order);
    const ok = new Set(enabled.map(b => b.id));
    const steps = ((def.storyline && def.storyline.steps) || []).filter(s => ok.has(s.blockId)).sort((a, b) => a.order - b.order)
      .map((s, i) => ({ id: s.id, blockId: s.blockId, order: i + 1, title: s.title || null, navigationLabel: s.navigationLabel || null, skippable: s.skippable !== false })); // presenterHint never copied
    const sl = def.storyline || {};
    return {
      schemaVersion: SCHEMA_VERSION, title: def.title, subtitle: def.subtitle || null, customerLabel: pctx.customerLabel || null,
      preparedAtLabel: meta.preparedAt ? W.preparedAt(F.formatDateTime ? F.formatDateTime(meta.preparedAt) : meta.preparedAt) : null, dataMode: meta.dataMode,
      storyline: { steps, startStepId: steps.some(s => s.id === sl.startStepId) ? sl.startStepId : steps.length ? steps[0].id : null, allowFreeNavigation: sl.allowFreeNavigation !== false, allowReturnToMap: sl.allowReturnToMap !== false, allowLotJump: sl.allowLotJump !== false },
      blocks: enabled.map(b => ({ blockId: b.id, type: b.type, title: b.title || null, criticality: b.criticality || 'OPTIONAL', payload: payloads[b.id] })),
      lots: pctx.lots.map(l => ({ lotRef: l.identity.code, label: lotLabel(l) })),
      theme: meta.theme ? { name: meta.theme.name, typographyTokens: meta.theme.typographyTokens, spacingTokens: meta.theme.spacingTokens, layoutTokens: meta.theme.layoutTokens, presentationComponentTokens: meta.theme.presentationComponentTokens } : null,
      clientSafePolicyVersion: policy.version
    };
  }

  // ---------------------------------------------------------------- Snapshot service
  /** createSnapshot(repo, def, src, ctx, req) → { ok, snapshot?, preflight, reused? }.
      req = PresentationSnapshotGenerationRequest { expectedDefinitionRevision, dataMode, clientSafePolicyVersion, generatedBy, idempotencyKey? } */
  function createSnapshot(repo, def, src, ctx = {}, req = {}) {
    if (!can(ctx, 'presentation.snapshot.create')) return { ok: false, code: 'FORBIDDEN' };
    if (def.organizationId !== ctx.organizationId) return { ok: false, code: 'NOT_FOUND' };
    if (def.lifecycleStatus === 'ARCHIVED') return { ok: false, code: 'ARCHIVED' };
    if (req.expectedDefinitionRevision !== def.recordRevision) return { ok: false, code: 'DEFINITION_REVISION_CONFLICT', currentRevision: def.recordRevision };
    const policy = ctx.policy || P.current();
    if (req.clientSafePolicyVersion && req.clientSafePolicyVersion !== policy.version) return { ok: false, code: 'POLICY_VERSION_MISMATCH' };
    const pre = preflight(def, src, { ...ctx, policy, dataMode: req.dataMode || 'SNAPSHOT' });
    if (pre.status === 'FAIL') return { ok: false, code: 'PREFLIGHT_FAILED', preflight: pre };
    const { payloads, pctx } = projCache.get(pre), at = nowIso(ctx);
    const audience = buildAudience(def, payloads, pctx, policy, { preparedAt: at, dataMode: 'SNAPSHOT', theme: src.theme && src.theme.id === def.themeRef ? src.theme : null });
    const last = P.scanPayload(audience); // defense in depth: the full audience object, not only each block
    if (last.some(x => x.code !== 'UNSAFE_CLAIM')) return { ok: false, code: 'REDACTION_ERROR', preflight: pre, leaks: last };
    const lotRefs = pctx.lots.map((l, i) => ({ lotId: l.identity.id, lotRef: l.identity.code, order: i + 1 }));
    const sum = checksum({ audience: { ...audience, preparedAtLabel: null }, lotRefs, versionRefs: pre.resolvedVersionRefs, policy: policy.version, definitionRevision: def.recordRevision });
    if (req.idempotencyKey) { const prev = repo.findByIdempotencyKey(ctx, def.id, req.idempotencyKey); if (prev && prev.checksum === sum) return { ok: true, snapshot: prev, preflight: pre, reused: true }; } // commercial data changed → new checksum → new snapshot
    const snap = deepFreeze({
      id: opaqueId('prs'), schemaVersion: SCHEMA_VERSION, organizationId: def.organizationId, presentationDefinitionId: def.id, definitionRevision: def.recordRevision, developmentId: def.developmentId,
      customerRef: def.customerId ? { customerId: def.customerId, profileVersionId: pre.resolvedVersionRefs.profileVersionId, displayLabel: pctx.customerLabel || null } : null, // no phone/email
      journeyId: def.journeyId || null, purpose: def.purpose, dataMode: 'SNAPSHOT', templateRef: def.templateRef || null,
      blockSnapshots: def.contentBlocks.map(b => ({ blockId: b.id, type: b.type, order: b.order, criticality: b.criticality || 'OPTIONAL', renderState: b.enabled === false ? 'UNAVAILABLE' : payloads[b.id] != null ? 'READY' : 'UNAVAILABLE' })),
      lotRefs, versionRefs: pre.resolvedVersionRefs, clientSafePolicyVersion: policy.version, themeVersionRef: pre.resolvedVersionRefs.themeVersion, generatedAt: at, generatedBy: req.generatedBy || ctx.userId || null,
      checksum: sum, status: pre.status === 'PASS' ? 'READY' : 'READY_WITH_WARNINGS', warnings: pre.warnings.map(w => ({ code: w.code, blockId: w.blockId || null, lotRef: w.lotRef || null, overridden: !!w.overridden })),
      idempotencyKey: req.idempotencyKey || null, audience
    });
    repo.saveSnapshot(ctx, snap);
    safety.record(snap, ctx);
    audit('PresentationSnapshotCreated', { organizationId: snap.organizationId, snapshotId: snap.id, definitionId: def.id, revision: def.recordRevision }, ctx);
    emit('PresentationSnapshotCreated', { organizationId: snap.organizationId, snapshotId: snap.id }, ctx);
    return { ok: true, snapshot: snap, preflight: pre };
  }
  /** audienceOf(snapshot): what the renderer / ShareService may read */
  const audienceOf = snap => snap ? snap.audience : null;
  /** verify(snapshot) → true when the stored content still matches its checksum (reproducibility) */
  const verify = snap => checksum({ audience: { ...plain(snap.audience), preparedAtLabel: null }, lotRefs: plain(snap.lotRefs), versionRefs: plain(snap.versionRefs), policy: snap.clientSafePolicyVersion, definitionRevision: snap.definitionRevision }) === snap.checksum;

  // ---------------------------------------------------------------- LIVE projection (current refs each refresh; never stored as a snapshot)
  function liveProjection(def, src, ctx = {}) {
    const pre = preflight(def, src, { ...ctx, dataMode: 'LIVE' });
    if (pre.status === 'FAIL') return { ok: false, code: 'PREFLIGHT_FAILED', preflight: pre };
    const { payloads, pctx } = projCache.get(pre), at = nowIso(ctx);
    return { ok: true, dataMode: 'LIVE', refreshedAt: at, versionRefs: pre.resolvedVersionRefs, preflight: pre, audience: deepFreeze(buildAudience(def, payloads, pctx, ctx.policy || P.current(), { preparedAt: null, dataMode: 'LIVE', theme: src.theme && src.theme.id === def.themeRef ? src.theme : null })) };
  }
  /** LiveView: applies refresh results in request order; an older response arriving late is discarded (stale response protection) */
  function createLiveView() {
    let seq = 0, applied = 0, current = null;
    return { begin: () => ++seq, apply(reqSeq, result) { if (reqSeq <= applied) return { applied: false, reason: 'STALE_RESPONSE' }; applied = reqSeq; current = result; return { applied: true }; }, current: () => current };
  }

  // ---------------------------------------------------------------- Freshness (does not mutate the snapshot)
  const DAY = 86400000;
  const FRESHNESS_POLICY = Object.freeze({ warnAfterMs: DAY }); // UX threshold (pending human decision); version/revision changes warn immediately
  function freshness(snap, opts = {}) {
    const now = Date.parse(opts.now || new Date().toISOString()), age = Math.max(0, now - Date.parse(snap.generatedAt)), days = Math.floor(age / DAY);
    const cur = opts.currentVersionRefs || null, pol = { ...FRESHNESS_POLICY, ...(opts.policy || {}) };
    const changed = cur ? ['priceTableVersionId', 'availabilityRevision', 'staticDataVersion'].filter(k => cur[k] != null && snap.versionRefs[k] != null && String(cur[k]) !== String(snap.versionRefs[k])) : [];
    const unconfirmed = (snap.warnings || []).some(w => ['AVAILABILITY_UNCONFIRMED', 'AVAILABILITY_STALE', 'PRICE_STALE'].includes(w.code));
    const outdated = age >= pol.warnAfterMs || changed.length > 0 || !!opts.offline;
    const warnings = [];
    if (outdated) warnings.push(age >= DAY ? W.freshness(Math.max(1, days)) : 'Confirme preço e disponibilidade antes de decidir.');
    if (opts.offline) warnings.push(W.preparedAt(F.formatDateTime ? F.formatDateTime(snap.generatedAt) : snap.generatedAt));
    return Object.freeze({ ageMs: age, ageDays: days, commercialDataMayBeOutdated: outdated, changedRefs: Object.freeze(changed), unconfirmedAtGeneration: unconfirmed, warnings: Object.freeze(warnings) });
  }

  // ---------------------------------------------------------------- Snapshot safety (separate from freshness)
  const safety = (() => {
    const recs = new Map();
    const key = (org, id) => org + '|' + id;
    function record(snap, ctx = {}) { const r = Object.freeze({ snapshotId: snap.id, status: 'SAFE', policyVersion: snap.clientSafePolicyVersion, reasonCodes: Object.freeze([]), evaluatedAt: nowIso(ctx) }); recs.set(key(snap.organizationId, snap.id), r); return r; }
    function get(org, id) { return recs.get(key(org, id)) || null; }
    function mark(org, id, status, reasonCodes = [], ctx = {}) {
      if (!P.SafetyStatus[status]) throw err('INVALID_SAFETY_STATUS', status);
      const prev = get(org, id); if (!prev) return null;
      const r = Object.freeze({ snapshotId: id, status, policyVersion: (ctx.policy || P.current()).version, reasonCodes: Object.freeze(reasonCodes.slice()), evaluatedAt: nowIso(ctx) });
      recs.set(key(org, id), r); audit('PresentationSnapshotSafetyChanged', { organizationId: org, snapshotId: id, reasonCode: reasonCodes[0] || status }, ctx);
      for (const f of listeners) { try { f({ type: status === 'REVOKED' ? 'PresentationSnapshotRevoked' : 'PresentationSnapshotSafetyChanged', organizationId: org, snapshotId: id, status }); } catch (e) { /* listener isolation */ } }
      return r;
    }
    /** reevaluate(snapshot, policy): a stricter policy that now flags the frozen content → REVIEW_REQUIRED (content untouched) */
    function reevaluate(snap, ctx = {}) {
      const leaks = P.scanPayload(snap.audience, { policy: ctx.policy });
      const extra = ctx.policy && ctx.policy.deniedBlockTypes ? snap.audience.blocks.filter(b => ctx.policy.deniedBlockTypes.includes(b.type)) : [];
      if (!leaks.length && !extra.length) return get(snap.organizationId, snap.id);
      const cur = get(snap.organizationId, snap.id); if (cur && cur.status === 'REVOKED') return cur;
      return mark(snap.organizationId, snap.id, 'REVIEW_REQUIRED', ['POLICY_EVOLUTION', ...new Set(leaks.map(l => l.code))], ctx);
    }
    const listeners = [];
    return { record, get, mark, reevaluate, onChange: f => { listeners.push(f); return () => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; }, clear: () => recs.clear() };
  })();

  // ---------------------------------------------------------------- Repository (in-memory reference; the backend owns persistence)
  function createRepository() {
    const defs = new Map(), snaps = new Map(), idem = new Map();
    const scoped = (ctx, x) => x && ctx && x.organizationId === ctx.organizationId ? x : null; // cross-tenant → null (no existence leak)
    return Object.freeze({
      getDefinition: (ctx, id) => scoped(ctx, defs.get(id)),
      saveDefinition(ctx, def, expectedRevision) {
        if (def.organizationId !== ctx.organizationId) throw err('CROSS_TENANT', 'Organização diferente.');
        const cur = defs.get(def.id);
        if (cur && cur.organizationId !== ctx.organizationId) throw err('NOT_FOUND', 'Apresentação não encontrada.');
        if (cur ? cur.recordRevision !== expectedRevision : expectedRevision != null && expectedRevision !== 0) throw err('REVISION_CONFLICT', 'Revisão desatualizada.', { currentRevision: cur ? cur.recordRevision : null });
        defs.set(def.id, def); return def;
      },
      getSnapshot: (ctx, id) => scoped(ctx, snaps.get(id)),
      saveSnapshot(ctx, snap) {
        if (snap.organizationId !== ctx.organizationId) throw err('CROSS_TENANT', 'Organização diferente.');
        if (snaps.has(snap.id)) throw err('SNAPSHOT_IMMUTABLE', 'Snapshot já existe e não pode ser alterado.');
        snaps.set(snap.id, deepFreeze(snap)); if (snap.idempotencyKey) idem.set(snap.organizationId + '|' + snap.presentationDefinitionId + '|' + snap.idempotencyKey, snap.id); return snap;
      },
      findByIdempotencyKey: (ctx, defId, k) => { const id = idem.get(ctx.organizationId + '|' + defId + '|' + k); return id ? scoped(ctx, snaps.get(id)) : null; },
      listByCustomer: (ctx, customerId) => [...snaps.values()].filter(s => s.organizationId === ctx.organizationId && s.customerRef && s.customerRef.customerId === customerId).map(summary),
      listByJourney: (ctx, journeyId) => [...snaps.values()].filter(s => s.organizationId === ctx.organizationId && s.journeyId === journeyId).map(summary)
    });
  }
  const summary = s => Object.freeze({ snapshotId: s.id, definitionId: s.presentationDefinitionId, purpose: s.purpose, status: s.status, generatedAt: s.generatedAt, lotCount: s.lotRefs.length, title: s.audience.title });

  /** sourcesFromRepo(repo, dev, extra) → the read-service bundle preflight/projection expect (no DB access here) */
  function sourcesFromRepo(repo, dev, extra = {}) {
    const pt = dev && (dev.priceTables || []).find(p => p.id === dev.currentPriceTableId);
    return { organizationId: dev ? dev.tenantId : null, developmentId: dev ? dev.id : null, dev, resolve: ref => ref == null ? null : repo.resolve(ref), freshness: repo.getFreshness(), dataVersions: repo.getDataVersions(), priceTable: pt || null, ...extra };
  }

  return Object.freeze({ SCHEMA_VERSION, PERMISSIONS, can, BLOCK_REGISTRY, validateBlockConfig, TEMPLATES, expandTemplate, LIMITS, validateDefinition, createDefinition, fromRecommendation, fromFavorites, fromComparison,
    revise, reorderLots, applyTemplate, markReady, archive, versionRefs, OVERRIDES, MESSAGES: MSG, preflight, createSnapshot, audienceOf, verify, liveProjection, createLiveView, FRESHNESS_POLICY, freshness, safety,
    createRepository, sourcesFromRepo, checksum, opaqueId, deepFreeze, emit, audit, events: () => EVENTS.slice(), auditLog: () => AUDIT.slice(), EVENT_TYPES, AUDIT_TYPES, sanitizeRefs });
})();
