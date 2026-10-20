/* domain/availability.js — the commercial status as a first-class domain.
   AvailabilityState { status, updatedAt, sourceId, revision, reservedUntil, proposalId, reason, notes, freshness }
   - LegacyAvailabilityAdapter (normalizeAvailability): only codes really mapped; anything else → UNKNOWN + warning.
   - Transition matrix + state machine: no status jumps without a rule; SOLD → AVAILABLE is blocked by default.
   - AvailabilityPolicy (per development): what counts as offerable, visible, recommendable, simulable.
   UNKNOWN is never converted to AVAILABLE. Status never depends on price, geometry or score.
   Topic 29 (second half of this file): DataState, freshness policy, source/conflict policy, LotAvailabilitySnapshot,
   AvailabilitySnapshot/Manifest/ChangeSet/events, OfferabilityResult, AvailabilityCapabilities/ActionPolicy, batch and
   transition validators, feed adapter, own cache, resolver and the CommercialContextComposer (price and availability
   side by side, each with its own version ref; neither derived from the other). See docs/AVAILABILITY_PRICE_INDEPENDENCE.md. */
App.availability = (() => {
  const S = App.enums.AvailabilityStatus;
  const ORDER = App.enums.AVAILABILITY_ORDER;
  const LEGACY_CODES = { DISP: 'AVAILABLE', DISPONIVEL: 'AVAILABLE', AVAILABLE: 'AVAILABLE', RES: 'RESERVED', RESERVADO: 'RESERVED', RESERVED: 'RESERVED', PROP: 'PROPOSAL', PROPOSTA: 'PROPOSAL',
    PROPOSAL: 'PROPOSAL', BLOQ: 'BLOCKED', BLOQUEADO: 'BLOCKED', BLOCKED: 'BLOCKED', VEND: 'SOLD', VENDIDO: 'SOLD', SOLD: 'SOLD', INDISP: 'UNAVAILABLE', INDISPONIVEL: 'UNAVAILABLE', UNAVAILABLE: 'UNAVAILABLE' };
  const LEGACY_FLAGS = { isSold: 'SOLD', isReserved: 'RESERVED', isBlocked: 'BLOCKED' };

  /** Official transition matrix. UNKNOWN can go to any confirmed state when the source is valid. */
  const TRANSITIONS = Object.freeze({
    UNKNOWN: ['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE'],
    AVAILABLE: ['RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE'],
    RESERVED: ['AVAILABLE', 'PROPOSAL', 'BLOCKED', 'SOLD'],
    PROPOSAL: ['AVAILABLE', 'RESERVED', 'BLOCKED', 'SOLD'],
    BLOCKED: ['AVAILABLE', 'UNAVAILABLE', 'SOLD'],
    UNAVAILABLE: ['AVAILABLE', 'BLOCKED'],
    SOLD: [] // reopening only through an explicit administrative correction (policy.allowSoldReopen + reason)
  });
  const DEFAULT_POLICY = Object.freeze({
    proposalCountsAsOfferable: false, reservationCountsAsUnavailable: true,
    soldVisibleOnMap: true, blockedVisibleOnMap: true, unavailableVisibleOnMap: true, unknownVisibleOnMap: true,
    allowSoldReopen: false, simulateNonOfferable: true // consultative simulation is allowed, with a warning
  });
  const policyOf = dev => ({ ...DEFAULT_POLICY, ...((dev && dev.availabilityPolicy) || {}) });

  const EMPTY = () => ({ status: 'UNKNOWN', updatedAt: null, sourceId: null, revision: 0, reservedUntil: null, proposalId: null, reason: null, notes: null, freshness: 'UNKNOWN' });
  /** LegacyAvailabilityAdapter. Conflicting legacy signals are reported and resolved to UNKNOWN, never chosen silently. */
  function normalizeAvailability(raw, warn = () => {}) {
    const out = EMPTY();
    const code = raw.st == null || raw.st === '' ? null : String(raw.st).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    let status = code == null ? 'UNKNOWN' : LEGACY_CODES[code] || (warn('UNKNOWN_ENUM', 'availability.status', `situação desconhecida (${raw.st})`), 'UNKNOWN');
    const flags = Object.entries(LEGACY_FLAGS).filter(([k]) => raw[k] === true).map(([, v]) => v);
    if (flags.length && (flags.length > 1 || (status !== 'UNKNOWN' && status !== flags[0]))) { warn('CONFLICTED_SOURCE', 'availability.status', `sinais divergentes (${raw.st} / ${flags.join(', ')})`); status = 'UNKNOWN'; }
    else if (flags.length && status === 'UNKNOWN') status = flags[0];
    out.status = status;
    if (status !== 'UNKNOWN') { out.sourceId = 'lots.json'; out.updatedAt = raw.stAt || null; }
    return out;
  }

  /** validateState: required fields and the fields that only make sense in some states */
  function validateState(a) {
    const errors = [];
    if (!a || !S[a.status]) errors.push({ code: 'UNKNOWN_ENUM', fieldKey: 'availability.status', message: `status inválido (${a && a.status})` });
    else {
      if (a.reservedUntil != null && a.status !== 'RESERVED') errors.push({ code: 'FIELD_NOT_ALLOWED', fieldKey: 'availability.reservedUntil', message: 'prazo só existe em reserva' });
      if (a.proposalId != null && a.status !== 'PROPOSAL') errors.push({ code: 'FIELD_NOT_ALLOWED', fieldKey: 'availability.proposalId', message: 'proposta só existe em PROPOSAL' });
      if (a.reason != null && !App.enums.AvailabilityReason[a.reason]) errors.push({ code: 'UNKNOWN_ENUM', fieldKey: 'availability.reason', message: `motivo inválido (${a.reason})` });
      for (const k of ['updatedAt', 'reservedUntil']) if (a[k] != null && Number.isNaN(Date.parse(a[k]))) errors.push({ code: 'INVALID_TIMESTAMP', fieldKey: 'availability.' + k, message: `data inválida (${a[k]})` });
      if (a.revision != null && !(Number.isInteger(a.revision) && a.revision >= 0)) errors.push({ code: 'INVALID_REVISION', fieldKey: 'availability.revision', message: 'revisão inválida' });
    }
    return errors;
  }
  /** canTransition(from, to, ctx) → { ok, exceptional?, reason } */
  function canTransition(from, to, ctx = {}, policy = DEFAULT_POLICY) {
    if (from === to) return { ok: true };
    if (!S[to]) return { ok: false, reason: `status inválido (${to})` };
    if (to === 'UNKNOWN') return { ok: true }; // losing confirmation is always allowed (stale or failed source)
    if (from === 'UNKNOWN' && ctx.lastConfirmed === 'SOLD' && to !== 'SOLD') from = 'SOLD'; // a sold lot that lost confirmation is still judged as sold
    if ((TRANSITIONS[from] || []).includes(to)) return { ok: true };
    if (from === 'SOLD' && to === 'AVAILABLE' && policy.allowSoldReopen && ctx.authorized && ctx.reason) return { ok: true, exceptional: true };
    return { ok: false, reason: from === 'SOLD' ? 'Lote vendido só volta a ficar disponível por correção administrativa autorizada' : `Transição ${from} → ${to} não permitida` };
  }
  /** transition(state, to, ctx) — the only way to change a status. Returns a new state, never mutates. */
  function transition(state, to, ctx = {}, policy = DEFAULT_POLICY) {
    const from = state ? state.status : 'UNKNOWN', lastConfirmed = from !== 'UNKNOWN' ? from : (state && state.lastConfirmedStatus) || null;
    const chk = canTransition(from, to, { ...ctx, lastConfirmed }, policy);
    if (!chk.ok) return { ok: false, error: { code: 'INVALID_TRANSITION', from, to, message: chk.reason } };
    if (ctx.revision != null && state && state.revision != null && ctx.revision <= state.revision) return { ok: false, error: { code: 'STALE_REVISION', from, to, message: `revisão ${ctx.revision} não é mais nova que ${state.revision}` } };
    const next = { ...EMPTY(), ...state, status: to, updatedAt: ctx.at || new Date().toISOString(), sourceId: ctx.sourceId || null,
      revision: ctx.revision != null ? ctx.revision : ((state && state.revision) || 0) + 1,
      reservedUntil: to === 'RESERVED' ? ctx.reservedUntil || null : null, proposalId: to === 'PROPOSAL' ? ctx.proposalId || null : null,
      reason: ['BLOCKED', 'UNAVAILABLE'].includes(to) || chk.exceptional ? ctx.reason || null : null, notes: ctx.notes || null };
    if (to === 'UNKNOWN' && lastConfirmed) next.lastConfirmedStatus = lastConfirmed; else delete next.lastConfirmedStatus;
    const errors = validateState(next);
    if (errors.length) return { ok: false, error: { code: 'INVALID_STATE', from, to, message: errors.map(e => e.message).join('; ') } };
    const history = { fromStatus: from, toStatus: to, changedAt: next.updatedAt, sourceId: next.sourceId, reason: next.reason, revision: next.revision }; // AvailabilityHistoryEntry (future persistence)
    if (chk.exceptional) App.lifecycle && App.lifecycle.note('sold lot reopened', history);
    return { ok: true, state: next, history, exceptional: !!chk.exceptional };
  }

  // Derived commercial flags: one place for every rule.
  const isOfferable = (status, p = DEFAULT_POLICY) => status === 'AVAILABLE' || (status === 'PROPOSAL' && p.proposalCountsAsOfferable);
  const isSelectableForSale = isOfferable;
  const isVisibleOnMap = (status, p = DEFAULT_POLICY) => ({ SOLD: p.soldVisibleOnMap, BLOCKED: p.blockedVisibleOnMap, UNAVAILABLE: p.unavailableVisibleOnMap, UNKNOWN: p.unknownVisibleOnMap }[status] ?? true);
  const isEligibleForRecommendation = (status, p = DEFAULT_POLICY) => isOfferable(status, p);
  /** simulation: allowed for offerable lots; consultative (with a warning) for the others when the policy allows */
  function simulationEligibility(status, p = DEFAULT_POLICY) {
    if (isOfferable(status, p)) return { allowed: true, sellAllowed: true, warning: null };
    if (!p.simulateNonOfferable) return { allowed: false, sellAllowed: false, warning: 'Simulação indisponível para este status' };
    return { allowed: true, sellAllowed: false, warning: status === 'UNKNOWN' ? 'Disponibilidade sujeita a confirmação' : 'Simulação apenas consultiva: o lote não está disponível' };
  }
  const isReservationExpired = (a, now = Date.now()) => !!(a && a.status === 'RESERVED' && a.reservedUntil && Date.parse(a.reservedUntil) < now);
  /** primary action by status (labels are resolved by the presentation layer) */
  const primaryAction = status => status === 'AVAILABLE' ? 'SIMULATE' : status === 'UNKNOWN' ? 'CONFIRM_AVAILABILITY' : 'DETAILS';
  function counts(lots) { const c = Object.fromEntries(ORDER.map(k => [k, 0])); for (const l of lots) c[l.availability.status]++; return c; }

  // ==================================================================================================
  // Topic 29 — Availability fully independent of price. Everything below reads availability fields only;
  // no function here receives, reads or writes a price (the composer copies price refs without reading them
  // to decide anything about status). Codes only: Portuguese labels live in presentation/pricingView.js.
  // ==================================================================================================
  const En = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const DataState = En('VALID', 'CONFLICTED', 'INCOMPLETE', 'INVALID', 'UNKNOWN_SOURCE');
  const Offerability = En('OFFERABLE', 'CONDITIONAL', 'NOT_OFFERABLE', 'NEEDS_CONFIRMATION', 'UNKNOWN');
  const ResolutionMode = En('CURRENT', 'EXPLICIT_REVISION', 'LAST_KNOWN', 'OFFLINE_LAST_KNOWN');
  const ConflictMode = En('AUTHORITATIVE_SOURCE_WINS', 'MANUAL_REVIEW', 'MOST_RECENT_AUTHORITATIVE', 'NO_AUTOMATIC_RESOLUTION');
  const SourceType = En('OFFICIAL_API', 'OFFICIAL_INVENTORY_FEED', 'OFFICIAL_SPREADSHEET', 'MANUAL_APPROVED', 'IMPORT', 'OTHER_CONFIGURED');
  const ChangeFlag = En('STATUS_CHANGED', 'FRESHNESS_CHANGED', 'RESERVATION_EXPIRED', 'PROPOSAL_UPDATED', 'SOURCE_CHANGED', 'CONFLICT_DETECTED', 'CONFLICT_RESOLVED'); // no PRICE_CHANGED, by design
  const POLICY_VERSION = '29.1.0';
  /** AvailabilityPolicy extras (topic 29). Kept apart from DEFAULT_POLICY (topic 8) so its contract does not change. */
  const INDEPENDENCE_DEFAULTS = Object.freeze({
    version: POLICY_VERSION, staleOfferability: 'NEEDS_CONFIRMATION', unknownBehavior: 'NEEDS_CONFIRMATION', conflictedBehavior: 'NEEDS_CONFIRMATION',
    authoritativeWrites: false, // no authoritative availability backend wired in the frontend: read-only, no local reservation
    // price display per status and presentation mode: SHOW (preço de tabela), LAST (último preço de tabela), HIDE. The price itself is never removed from the domain.
    priceDisplay: Object.freeze({ default: 'SHOW', SOLD: Object.freeze({ client: 'HIDE', presentation: 'HIDE', broker: 'LAST', technical: 'LAST' }) })
  });
  const SOURCE_POLICY = Object.freeze({ sourcePriorities: Object.freeze({}), authoritativeSources: Object.freeze([]), conflictResolutionMode: 'NO_AUTOMATIC_RESOLUTION', version: POLICY_VERSION });
  const independenceOf = dev => { const p = (dev && dev.availabilityPolicy) || {}; return { ...DEFAULT_POLICY, ...INDEPENDENCE_DEFAULTS, ...p, priceDisplay: { ...INDEPENDENCE_DEFAULTS.priceDisplay, ...(p.priceDisplay || {}) } }; };
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
  const ts = now => now == null ? null : new Date(now).toISOString();

  /** AvailabilityFreshnessPolicy { freshForMs, staleAfterMs, expireAfterMs } (no universal TTL: null = no time limit).
      evaluateFreshness never upgrades: a value is FRESH only if the source confirmed it (state.freshness FRESH) and it is within the limits. */
  function freshnessPolicyOf(dev) { const f = (dev && dev.freshnessPolicy) || {}; return { freshForMs: f.availabilityMaxAgeMs != null ? f.availabilityMaxAgeMs : null, staleAfterMs: f.availabilityMaxAgeMs != null ? f.availabilityMaxAgeMs : null, expireAfterMs: f.availabilityExpireAfterMs != null ? f.availabilityExpireAfterMs : null, sourceSpecificRules: null, version: POLICY_VERSION }; }
  function evaluateFreshness(a, policy = {}, now = Date.now()) {
    if (!a || a.status === 'UNKNOWN' || !a.updatedAt || Number.isNaN(Date.parse(a.updatedAt))) return 'UNKNOWN';
    const age = now - Date.parse(a.updatedAt), cur = App.enums.Freshness[a.freshness] ? a.freshness : 'UNKNOWN';
    if (policy.expireAfterMs != null && age > policy.expireAfterMs) return 'EXPIRED';
    if (policy.staleAfterMs != null && age > policy.staleAfterMs) return cur === 'EXPIRED' ? 'EXPIRED' : 'STALE';
    return cur;
  }
  /** AvailabilitySourceRef */
  const sourceRef = (s = {}) => Object.freeze({ sourceId: s.sourceId || null, sourceType: SourceType[s.sourceType] ? s.sourceType : (s.sourceId ? 'OTHER_CONFIGURED' : null), sourceName: s.sourceName || null,
    sourceUpdatedAt: s.sourceUpdatedAt || null, importedAt: s.importedAt || null, sourceHash: s.sourceHash || null, authorityLevel: s.authorityLevel || null, metadata: s.metadata || {} });
  /** resolveSources(observations[{ sourceId, status, updatedAt }], sourcePolicy) — no silent last-write-wins between sources of the same authority.
      Unresolvable conflict → status UNKNOWN + dataState CONFLICTED (conflict is data quality, not a commercial status). */
  function resolveSources(obs, sp = SOURCE_POLICY) {
    const list = (obs || []).filter(o => o && S[o.status]), statuses = [...new Set(list.map(o => o.status))];
    if (!list.length) return { status: 'UNKNOWN', dataState: 'UNKNOWN_SOURCE', sourceId: null, candidates: [], warnings: ['NO_SOURCE'] };
    if (statuses.length === 1) { const o = list.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]; return { status: o.status, dataState: 'VALID', sourceId: o.sourceId || null, candidates: list, warnings: [] }; }
    const auth = list.filter(o => (sp.authoritativeSources || []).includes(o.sourceId)), mode = sp.conflictResolutionMode || 'NO_AUTOMATIC_RESOLUTION';
    if (mode === 'AUTHORITATIVE_SOURCE_WINS' && auth.length && new Set(auth.map(o => o.status)).size === 1) return { status: auth[0].status, dataState: 'VALID', sourceId: auth[0].sourceId, candidates: list, warnings: ['CONFLICT_RESOLVED_BY_AUTHORITY'] };
    if (mode === 'MOST_RECENT_AUTHORITATIVE' && auth.length) { const o = auth.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]; return { status: o.status, dataState: 'VALID', sourceId: o.sourceId, candidates: list, warnings: ['CONFLICT_RESOLVED_BY_AUTHORITY'] }; }
    return { status: 'UNKNOWN', dataState: 'CONFLICTED', sourceId: null, candidates: list, warnings: [mode === 'MANUAL_REVIEW' ? 'MANUAL_REVIEW_REQUIRED' : 'CONFLICT_NOT_RESOLVED'] };
  }

  /** LotAvailabilitySnapshot of one lot (from a canonical Lot or an AvailabilityState) */
  function lotSnapshot(lotOrState, o = {}) {
    const a = lotOrState && lotOrState.availability ? lotOrState.availability : (lotOrState || EMPTY()), lotId = o.lotId || (lotOrState && lotOrState.identity ? lotOrState.identity.id : a.lotId || null);
    const mode = ResolutionMode[o.resolutionMode] ? o.resolutionMode : o.offline ? 'OFFLINE_LAST_KNOWN' : 'CURRENT';
    let freshness = o.freshnessPolicy ? evaluateFreshness(a, o.freshnessPolicy, o.now) : (a.status === 'UNKNOWN' ? 'UNKNOWN' : App.enums.Freshness[a.freshness] ? a.freshness : 'UNKNOWN');
    if ((mode === 'OFFLINE_LAST_KNOWN' || mode === 'LAST_KNOWN') && freshness === 'FRESH') freshness = 'STALE'; // last known is never presented as current
    const warnings = [];
    if (mode === 'LAST_KNOWN') warnings.push('LAST_KNOWN_STATUS');
    if (mode === 'OFFLINE_LAST_KNOWN') warnings.push('OFFLINE_LAST_KNOWN_STATUS');
    if (freshness === 'STALE') warnings.push('STALE_AVAILABILITY'); else if (freshness === 'EXPIRED') warnings.push('EXPIRED_AVAILABILITY');
    if (a.status === 'UNKNOWN') warnings.push('AVAILABILITY_UNKNOWN');
    const dataState = DataState[a.dataState] ? a.dataState : a.status === 'UNKNOWN' && !a.sourceId ? 'UNKNOWN_SOURCE' : 'VALID';
    if (dataState === 'CONFLICTED') warnings.push('AVAILABILITY_CONFLICTED');
    if (isReservationExpired(a, o.now != null ? o.now : Date.now())) warnings.push('RESERVATION_EXPIRED');
    return Object.freeze({ developmentId: o.developmentId || null, lotId, status: S[a.status] ? a.status : 'UNKNOWN', revision: a.revision != null ? a.revision : 0, updatedAt: a.updatedAt || null,
      sourceRef: sourceRef({ sourceId: a.sourceId, ...(o.sourceRef || {}) }), dataState, freshness, reservedUntil: a.status === 'RESERVED' ? a.reservedUntil || null : null,
      proposalRef: a.status === 'PROPOSAL' && a.proposalId ? { proposalId: a.proposalId } : null, reasonCode: a.reason || null, resolvedAt: ts(o.now), resolutionMode: mode, warnings });
  }

  /** OfferabilityResult. In doubt → NEEDS_CONFIRMATION; UNKNOWN is never OFFERABLE. Price is not an input. */
  function offerability(lotOrState, o = {}) {
    const snap = lotOrState && lotOrState.resolutionMode ? lotOrState : lotSnapshot(lotOrState, o), p = { ...INDEPENDENCE_DEFAULTS, ...DEFAULT_POLICY, ...(o.policy || {}) };
    const s = snap.status, fr = snap.freshness, reasons = [];
    let off;
    if (snap.dataState === 'CONFLICTED') { off = p.conflictedBehavior || 'NEEDS_CONFIRMATION'; reasons.push('AVAILABILITY_CONFLICTED'); }
    else if (['INVALID', 'INCOMPLETE'].includes(snap.dataState)) { off = 'NEEDS_CONFIRMATION'; reasons.push('AVAILABILITY_DATA_' + snap.dataState); }
    else if (s === 'UNKNOWN') { off = p.unknownBehavior === 'UNKNOWN' ? 'UNKNOWN' : 'NEEDS_CONFIRMATION'; reasons.push('AVAILABILITY_UNKNOWN'); }
    else if (s === 'AVAILABLE' || (s === 'PROPOSAL' && p.proposalCountsAsOfferable)) {
      if (fr === 'FRESH') { off = s === 'AVAILABLE' ? 'OFFERABLE' : 'CONDITIONAL'; if (s === 'PROPOSAL') reasons.push('PROPOSAL_POLICY'); }
      else if (fr === 'STALE') { off = p.staleOfferability === 'CONDITIONAL' ? 'CONDITIONAL' : 'NEEDS_CONFIRMATION'; reasons.push('STALE_AVAILABILITY'); }
      else { off = 'NEEDS_CONFIRMATION'; reasons.push(fr === 'EXPIRED' ? 'EXPIRED_AVAILABILITY' : 'AVAILABILITY_FRESHNESS_UNKNOWN'); }
    } else if (s === 'RESERVED' && snap.warnings.includes('RESERVATION_EXPIRED')) { off = 'NEEDS_CONFIRMATION'; reasons.push('RESERVATION_EXPIRED'); }
    else { off = 'NOT_OFFERABLE'; reasons.push('STATUS_' + s); }
    return Object.freeze({ lotId: snap.lotId, status: s, offerability: off, reasons, requiresConfirmation: off === 'NEEDS_CONFIRMATION' || off === 'CONDITIONAL' || off === 'UNKNOWN',
      availabilityRevision: snap.revision, freshness: fr, dataState: snap.dataState, evaluatedAt: snap.resolvedAt, policyVersion: p.version || POLICY_VERSION });
  }
  /** AvailabilityCapabilities — semantic capabilities of the state, not user permissions (final = capability AND permission, topic 30) */
  function capabilitiesOf(lotOrState, o = {}) {
    const off = o.offerability || offerability(lotOrState, o), p = { ...INDEPENDENCE_DEFAULTS, ...DEFAULT_POLICY, ...(o.policy || {}) }, sim = simulationEligibility(off.status, p), reasons = [...off.reasons];
    const offerable = off.offerability === 'OFFERABLE';
    if (!p.authoritativeWrites) reasons.push('READ_ONLY_NO_AUTHORITATIVE_BACKEND');
    return Object.freeze({ canRecommend: offerable, canStartProposal: offerable, canReserve: offerable && !!p.authoritativeWrites, canSimulate: !!sim.allowed, simulationConsultative: !sim.sellAllowed,
      canCompare: true, canShareAsAvailable: offerable && off.freshness === 'FRESH', canShowCommercialCTA: offerable || off.offerability === 'CONDITIONAL', canShowPriceHistory: true,
      requiresStatusConfirmation: off.requiresConfirmation, reasons: [...new Set(reasons)] });
  }
  /** AvailabilityActionPolicy: one place for every action decision (components never test status strings) */
  const actionPolicy = Object.freeze({ offerability, capabilitiesOf, primaryAction, isOfferable, simulationEligibility });
  /** share claim (codes): AVAILABLE_CONFIRMED only when offerable and fresh; stale AVAILABLE → LAST_KNOWN_AVAILABLE; UNKNOWN/conflict → TO_CONFIRM */
  function shareClaim(lotOrState, o = {}) {
    const off = offerability(lotOrState, o);
    if (off.offerability === 'OFFERABLE' && off.freshness === 'FRESH') return { claim: 'AVAILABLE_CONFIRMED', status: off.status, requiresConfirmation: false };
    if (off.status === 'AVAILABLE') return { claim: 'LAST_KNOWN_AVAILABLE', status: off.status, requiresConfirmation: true };
    if (off.status === 'UNKNOWN' || off.dataState !== 'VALID') return { claim: 'TO_CONFIRM', status: off.status, requiresConfirmation: true };
    return { claim: 'STATUS', status: off.status, requiresConfirmation: off.requiresConfirmation };
  }
  /** price display decision for a status (policy, per mode). The price stays in the domain whatever this returns. */
  function priceDisplayFor(status, mode = 'broker', policy) {
    const pd = (policy && policy.priceDisplay) || INDEPENDENCE_DEFAULTS.priceDisplay, rule = pd[status];
    const v = rule == null ? pd.default || 'SHOW' : typeof rule === 'string' ? rule : rule[mode] || pd.default || 'SHOW';
    return ['SHOW', 'LAST', 'HIDE'].includes(v) ? v : 'SHOW';
  }

  // ------------------------------------------------------------------ snapshot, manifest, change set, events, diagnostics
  const canonical = st => [st.status, st.dataState || 'VALID', st.revision || 0, st.updatedAt || '', st.reservedUntil || '', st.sourceId || ''].join(':');
  /** AvailabilitySnapshot { developmentId, revision, statesByLotId, generatedAt, sourceRefs, freshnessSummary, statusCounts, checksum } — frozen; checksum over lotId-sorted canonical states */
  function buildSnapshot(meta, statesByLotId) {
    const ids = Object.keys(statesByLotId).sort(), states = {}, statusCounts = Object.fromEntries(ORDER.map(k => [k, 0])), fresh = { FRESH: 0, STALE: 0, EXPIRED: 0, UNKNOWN: 0 }, data = Object.fromEntries(Object.keys(DataState).map(k => [k, 0]));
    for (const id of ids) {
      const a = { ...EMPTY(), ...statesByLotId[id] }; a.status = S[a.status] ? a.status : 'UNKNOWN'; a.dataState = DataState[a.dataState] ? a.dataState : a.status === 'UNKNOWN' && !a.sourceId ? 'UNKNOWN_SOURCE' : 'VALID';
      if (a.status === 'UNKNOWN') a.freshness = 'UNKNOWN';
      states[id] = Object.freeze(a); statusCounts[a.status]++; fresh[App.enums.Freshness[a.freshness] ? a.freshness : 'UNKNOWN']++; data[a.dataState]++;
    }
    return Object.freeze({ developmentId: meta.developmentId || null, revision: meta.revision != null ? meta.revision : 0, statesByLotId: Object.freeze(states), generatedAt: meta.generatedAt || null,
      updatedAt: meta.updatedAt || null, sourceRefs: (meta.sourceRefs || []).map(sourceRef), freshnessSummary: Object.freeze(fresh), statusCounts: Object.freeze(statusCounts), dataStateCounts: Object.freeze(data),
      checksum: fnv(ids.map(id => id + '=' + canonical(states[id])).join('|')), metadata: meta.metadata || {} });
  }
  /** snapshotFromLots(lots, meta): the current read model of the canonical Lots (availability fields only) */
  const snapshotFromLots = (lots, meta = {}) => buildSnapshot(meta, Object.fromEntries(lots.map(l => [l.identity.id, l.availability])));
  /** AvailabilityManifest — quick sync: same revision + checksum → nothing to download */
  function manifestOf(snap, prev) {
    return Object.freeze({ developmentId: snap.developmentId, revision: snap.revision, checksum: snap.checksum, updatedAt: snap.updatedAt, sourceUpdatedAt: (snap.sourceRefs[0] || {}).sourceUpdatedAt || null,
      statusCounts: snap.statusCounts, freshness: snap.freshnessSummary, changedLotCountSincePrevious: prev ? diff(prev, snap).changes.length : null, generatedAt: snap.generatedAt });
  }
  const needsSync = (local, remote) => !local || !remote || local.revision !== remote.revision || local.checksum !== remote.checksum;
  /** AvailabilityChangeSet between two snapshots. Flags never include a price change. */
  function diff(prev, next, o = {}) {
    const changes = [], ids = [...new Set([...Object.keys(prev.statesByLotId), ...Object.keys(next.statesByLotId)])].sort(), summary = {};
    const now = o.now != null ? o.now : Date.now();
    for (const id of ids) {
      const a = prev.statesByLotId[id] || EMPTY(), b = next.statesByLotId[id] || EMPTY(), flags = [];
      if (a.status !== b.status) flags.push('STATUS_CHANGED');
      if ((a.freshness || 'UNKNOWN') !== (b.freshness || 'UNKNOWN')) flags.push('FRESHNESS_CHANGED');
      if ((a.sourceId || null) !== (b.sourceId || null)) flags.push('SOURCE_CHANGED');
      if ((a.proposalId || null) !== (b.proposalId || null)) flags.push('PROPOSAL_UPDATED');
      if (a.dataState !== 'CONFLICTED' && b.dataState === 'CONFLICTED') flags.push('CONFLICT_DETECTED');
      if (a.dataState === 'CONFLICTED' && b.dataState !== 'CONFLICTED') flags.push('CONFLICT_RESOLVED');
      if (!isReservationExpired(a, now) && isReservationExpired(b, now)) flags.push('RESERVATION_EXPIRED');
      if (!flags.length) continue;
      changes.push(Object.freeze({ lotId: id, fromStatus: a.status, toStatus: b.status, fromDataState: a.dataState || null, toDataState: b.dataState || null, changedAt: b.updatedAt || null, sourceRef: sourceRef({ sourceId: b.sourceId }), reasonCode: b.reason || null, flags }));
      if (a.status !== b.status) { const k = `${a.status}->${b.status}`; summary[k] = (summary[k] || 0) + 1; }
    }
    const nc = next.statusCounts;
    return Object.freeze({ developmentId: next.developmentId, fromRevision: prev.revision, toRevision: next.revision, changes, changedLotIds: changes.map(c => c.lotId), generatedAt: ts(o.now), sourceRefs: next.sourceRefs,
      summary: Object.freeze({ transitions: summary, soldCount: nc.SOLD, blockedCount: nc.BLOCKED, unknownCount: nc.UNKNOWN, conflictCount: next.dataStateCounts.CONFLICTED }) });
  }
  /** domain events of a change set (no price in any payload) */
  function eventsOf(cs, o = {}) {
    const out = [{ type: 'AvailabilityRevisionPublished', developmentId: cs.developmentId, revision: cs.toRevision, fromRevision: cs.fromRevision, timestamp: cs.generatedAt, changedLotCount: cs.changes.length }];
    for (const c of cs.changes) {
      const base = { developmentId: cs.developmentId, lotId: c.lotId, fromStatus: c.fromStatus, toStatus: c.toStatus, revision: cs.toRevision, timestamp: c.changedAt || cs.generatedAt, reasonCode: c.reasonCode, sourceRef: c.sourceRef };
      if (c.flags.includes('STATUS_CHANGED')) out.push({ type: 'AvailabilityStatusChanged', ...base });
      if (c.flags.includes('CONFLICT_DETECTED')) out.push({ type: 'AvailabilityConflictDetected', ...base });
      if (c.flags.includes('RESERVATION_EXPIRED')) out.push({ type: 'AvailabilityReservationExpired', ...base });
    }
    return out;
  }
  /** what an availability change set invalidates (Fit never; price never) */
  const invalidationOf = cs => Object.freeze({ fit: false, price: false, priceHistory: false, financialFormula: false, recommendationLotIds: cs.changedLotIds, comparisonStatusCells: cs.changedLotIds, mapStatusOverlay: cs.changes.length > 0, share: cs.changes.length > 0 });
  function diagnostics(snap) {
    return Object.freeze({ developmentId: snap.developmentId, revision: snap.revision, updatedAt: snap.updatedAt, sourceUpdatedAt: (snap.sourceRefs[0] || {}).sourceUpdatedAt || null, statusCounts: snap.statusCounts,
      dataStateCounts: snap.dataStateCounts, freshnessCounts: snap.freshnessSummary, conflictCount: snap.dataStateCounts.CONFLICTED, unknownCount: snap.statusCounts.UNKNOWN, checksum: snap.checksum, sourceRefs: snap.sourceRefs,
      availableCount: snap.statusCounts.AVAILABLE, offerableCount: Object.values(snap.statesByLotId).filter(a => offerability(a).offerability === 'OFFERABLE').length });
  }

  // ------------------------------------------------------------------ validators, feed adapter, cache
  /** AvailabilityTransitionValidator (future write path): optimistic concurrency by expectedRevision; frontend has no authoritative write */
  function validateTransition(current, requestedStatus, ctx = {}) {
    const cur = current || EMPTY(), p = { ...INDEPENDENCE_DEFAULTS, ...DEFAULT_POLICY, ...(ctx.policy || {}) }, errors = [], warnings = [], reasonRequirements = [];
    if (ctx.expectedRevision == null) errors.push({ code: 'EXPECTED_REVISION_REQUIRED' });
    else if (ctx.expectedRevision !== (cur.revision || 0)) errors.push({ code: 'REVISION_CONFLICT', expectedRevision: ctx.expectedRevision, currentRevision: cur.revision || 0 });
    if (['BLOCKED', 'UNAVAILABLE'].includes(requestedStatus)) { reasonRequirements.push('REASON_CODE'); if (!ctx.reasonCode) errors.push({ code: 'REASON_REQUIRED' }); }
    const chk = canTransition(cur.status, requestedStatus, { lastConfirmed: cur.status !== 'UNKNOWN' ? cur.status : cur.lastConfirmedStatus || null, authorized: ctx.authorized, reason: ctx.reasonCode }, p);
    if (!chk.ok) errors.push({ code: 'INVALID_TRANSITION', message: chk.reason });
    if ('price' in ctx || 'amount' in ctx) warnings.push('PRICE_FIELD_IGNORED');
    if (!p.authoritativeWrites) warnings.push('READ_ONLY_NO_AUTHORITATIVE_BACKEND');
    return Object.freeze({ allowed: !errors.length, errors, warnings, transitionId: ctx.idempotencyKey || null, expectedRevision: ctx.expectedRevision != null ? ctx.expectedRevision : null, reasonRequirements });
  }
  /** AvailabilityBatchValidator: known ids, duplicates, statuses, metadata, revision order, stale source, transitions, idempotency (same sourceHash) */
  function validateBatch(batch, ctx = {}) {
    const errors = [], warnings = [], seen = new Set(), cur = ctx.current || null, p = { ...DEFAULT_POLICY, ...(ctx.policy || {}) }, src = batch.sourceRef || {};
    if (cur && src.sourceHash && cur.lastSourceHash === src.sourceHash) return Object.freeze({ ok: true, duplicate: true, apply: false, errors, warnings: ['DUPLICATE_BATCH'] });
    if (cur && batch.revision != null && !(batch.revision > (cur.revision || 0))) errors.push({ code: 'REVISION_NOT_MONOTONIC', revision: batch.revision, currentRevision: cur.revision });
    if (cur && src.sourceUpdatedAt && cur.updatedAt && Date.parse(src.sourceUpdatedAt) < Date.parse(cur.updatedAt)) warnings.push('STALE_SOURCE_TIMESTAMP');
    for (const it of batch.items || []) {
      if (!it || !it.lotId) { errors.push({ code: 'MISSING_LOT_ID' }); continue; }
      if (ctx.knownLotIds && !ctx.knownLotIds.has(it.lotId)) errors.push({ code: 'UNKNOWN_LOT', lotId: it.lotId });
      if (seen.has(it.lotId)) errors.push({ code: 'DUPLICATE_LOT', lotId: it.lotId }); seen.add(it.lotId);
      const st = { ...EMPTY(), ...it, revision: batch.revision != null ? batch.revision : 0 };
      for (const e of validateState(st)) errors.push({ ...e, lotId: it.lotId });
      if (['price', 'amount', 'pricePerM2', 'valor', 'preco'].some(k => k in it)) warnings.push('PRICE_FIELD_IGNORED');
      const before = cur && cur.statesByLotId && cur.statesByLotId[it.lotId];
      if (before && S[it.status]) { const c = canTransition(before.status, it.status, { lastConfirmed: before.status !== 'UNKNOWN' ? before.status : before.lastConfirmedStatus || null, authorized: it.authorized, reason: it.reason }, p);
        if (!c.ok) errors.push({ code: 'INVALID_TRANSITION', lotId: it.lotId, message: c.reason }); }
    }
    return Object.freeze({ ok: !errors.length, duplicate: false, apply: !errors.length, errors, warnings: [...new Set(warnings)] });
  }
  /** AvailabilityFeedAdapter: rows of an official feed (API/CSV/spreadsheet) → batch. Never touches pricing: price columns are ignored. */
  function adaptFeed(rows, src = {}, o = {}) {
    const warnings = [], items = [];
    for (const r of rows || []) {
      const ref = r.lotId || r.lot || r.codigo || r.code || null, lotId = o.resolveLotId ? o.resolveLotId(ref) : ref;
      const raw = r.status != null ? r.status : r.situacao != null ? r.situacao : r.st;
      const code = raw == null ? null : String(raw).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const status = code && LEGACY_CODES[code] ? LEGACY_CODES[code] : 'UNKNOWN';
      if (code && !LEGACY_CODES[code] && code !== 'UNKNOWN') warnings.push({ code: 'UNKNOWN_STATUS_CODE', lotRef: ref, value: raw });
      if (['price', 'preco', 'valor', 'amount', 'pricePerM2'].some(k => r[k] != null)) warnings.push({ code: 'PRICE_FIELD_IGNORED', lotRef: ref });
      if (!lotId) { warnings.push({ code: 'UNRESOLVED_LOT', lotRef: ref }); continue; }
      items.push({ lotId, status, reservedUntil: status === 'RESERVED' ? r.reservedUntil || null : null, proposalId: status === 'PROPOSAL' ? r.proposalId || null : null, reason: r.reason || null });
    }
    return { revision: o.revision != null ? o.revision : null, sourceRef: sourceRef(src), items, warnings };
  }
  /** AvailabilityCache: its own store (never shared with the pricing cache). Keys developmentId|revision|checksum + current pointer. Not a source of truth. */
  function createCache() {
    const store = new Map(), current = new Map();
    return { put(snap) { const k = `${snap.developmentId}|${snap.revision}|${snap.checksum}`; store.set(k, snap); current.set(snap.developmentId, k); return k; },
      get: (devId, revision) => [...store.entries()].filter(([k]) => k.startsWith(`${devId}|${revision}|`)).map(([, v]) => v)[0] || null,
      current: devId => current.has(devId) ? store.get(current.get(devId)) : null, latestKnownRevision: devId => current.has(devId) ? store.get(current.get(devId)).revision : null,
      size: () => store.size, clear() { store.clear(); current.clear(); } };
  }
  /** AvailabilityResolver over a snapshot (CURRENT / EXPLICIT_REVISION / LAST_KNOWN / OFFLINE_LAST_KNOWN) */
  function resolve(snapOrCache, req = {}) {
    const snap = snapOrCache && snapOrCache.statesByLotId ? snapOrCache : snapOrCache && req.revision != null ? snapOrCache.get(req.developmentId, req.revision) : snapOrCache ? snapOrCache.current(req.developmentId) : null;
    if (!snap) return lotSnapshot(EMPTY(), { ...req, lotId: req.lotId });
    if (req.revision != null && snap.revision !== req.revision) return lotSnapshot(EMPTY(), { ...req, lotId: req.lotId });
    const st = snap.statesByLotId[req.lotId] || EMPTY();
    const mode = req.revision != null ? 'EXPLICIT_REVISION' : req.offline ? 'OFFLINE_LAST_KNOWN' : req.allowLastKnown ? 'LAST_KNOWN' : 'CURRENT';
    return lotSnapshot(st, { ...req, developmentId: snap.developmentId, resolutionMode: mode });
  }

  // ------------------------------------------------------------------ CommercialContextComposer
  /** composeCommercialContext(lot, { mode, policy, now, offline, paymentPlanVersion }) → CommercialLotContext.
      Price and availability are copied side by side with their own version refs; neither is derived from the other. */
  function composeCommercialContext(lot, o = {}) {
    const p = o.policy || INDEPENDENCE_DEFAULTS, av = lotSnapshot(lot, { ...o, developmentId: o.developmentId || null }), off = offerability(av, { policy: p }), caps = capabilitiesOf(av, { policy: p, offerability: off });
    const c = lot.commercial || {}, priceFresh = lot.metadata && lot.metadata.freshness ? lot.metadata.freshness.commercial || 'UNKNOWN' : 'UNKNOWN';
    const priceStatus = c.priceStatus || (c.price == null ? 'MISSING' : 'VALID'); // VALID | MISSING | WITHHELD | CONFLICTED (the latter two only when the source says so)
    const display = priceDisplayFor(av.status, o.mode || 'broker', p), warnings = [...av.warnings];
    if (priceStatus !== 'VALID') warnings.push('PRICE_' + priceStatus);
    const simAllowed = caps.canSimulate && priceStatus === 'VALID';
    return Object.freeze({ lotId: lot.identity.id,
      price: Object.freeze({ amount: c.price != null ? c.price : null, pricePerM2: c.pricePerM2 != null ? c.pricePerM2 : null, currency: c.currency || null, status: priceStatus, freshness: priceFresh,
        priceTableId: c.priceTableId || null, priceTableVersion: c.priceTableVersion || null, display, label: display === 'LAST' ? 'LAST_TABLE_PRICE' : 'TABLE_PRICE' }),
      availability: av, offerability: off, capabilities: caps,
      simulation: Object.freeze({ allowed: simAllowed, consultative: caps.simulationConsultative, blockedBy: priceStatus !== 'VALID' ? 'PRICE' : !caps.canSimulate ? 'AVAILABILITY' : null }),
      paymentPlans: Object.freeze({ planIds: (c.availablePlans || []).slice(), priceTableVersion: c.priceTableVersion || null }), composedAt: ts(o.now),
      versionRefs: Object.freeze({ priceTableId: c.priceTableId || null, priceTableVersion: c.priceTableVersion || null, availabilityRevision: av.revision, paymentPlanVersions: c.priceTableVersion ? [c.priceTableVersion] : [] }),
      warnings: [...new Set(warnings)] });
  }
  /** LotAvailabilityViewModel data (codes; labels resolved in presentation/pricingView.js) */
  function viewModelData(lotOrState, o = {}) {
    const snap = lotSnapshot(lotOrState, o), off = offerability(snap, o), mode = o.mode || 'broker', stale = snap.freshness !== 'FRESH' && snap.status !== 'UNKNOWN';
    const labelKey = snap.dataState === 'CONFLICTED' ? 'CONFLICTED' : snap.status === 'UNKNOWN' ? 'UNKNOWN' : snap.status === 'AVAILABLE' && stale ? 'AVAILABLE_LAST_KNOWN' : snap.status === 'BLOCKED' && mode === 'client' ? 'UNAVAILABLE' : snap.status;
    return Object.freeze({ status: snap.status, labelKey, badgeStyleToken: 'av-' + snap.status.toLowerCase() + (stale ? ' av-stale' : ''), freshness: snap.freshness, updatedAt: snap.updatedAt,
      warningKey: snap.dataState === 'CONFLICTED' ? 'CONFLICTED' : snap.status === 'UNKNOWN' ? 'TO_CONFIRM' : snap.freshness === 'EXPIRED' ? 'EXPIRED' : stale ? 'STALE' : null,
      offerability: off.offerability, capabilities: capabilitiesOf(snap, { ...o, offerability: off }), reasonCode: mode === 'client' ? null : snap.reasonCode,
      technicalMeta: mode === 'technical' ? { revision: snap.revision, sourceId: snap.sourceRef.sourceId, dataState: snap.dataState, resolutionMode: snap.resolutionMode, updatedAt: snap.updatedAt } : null });
  }

  return Object.freeze({ TRANSITIONS, DEFAULT_POLICY, ORDER, LEGACY_CODES, LEGACY_FLAGS, policyOf, normalizeAvailability, validateState, canTransition, transition,
    isOfferable, isSelectableForSale, isVisibleOnMap, isEligibleForRecommendation, simulationEligibility, isReservationExpired, primaryAction, counts, EMPTY,
    // topic 29
    POLICY_VERSION, DataState, Offerability, ResolutionMode, ConflictMode, SourceType, ChangeFlag, INDEPENDENCE_DEFAULTS, SOURCE_POLICY, independenceOf, freshnessPolicyOf, evaluateFreshness,
    sourceRef, resolveSources, lotSnapshot, offerability, capabilitiesOf, actionPolicy, shareClaim, priceDisplayFor, buildSnapshot, snapshotFromLots, manifestOf, needsSync, diff, eventsOf, invalidationOf,
    diagnostics, validateTransition, validateBatch, adaptFeed, createCache, resolve, composeCommercialContext, viewModelData });
})();
