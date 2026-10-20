/* presentationmode/runtime.js — topic 41: PresentationSession runtime (navigation only; never changes the snapshot) ·
   PresenterControlState + PresentationPresenterControlsPolicy (concealed from the audience) · PresentationOverlayCoordinator
   (one dominant overlay) · PresentationFeedbackIntent (records intent; never edits the profile, never infers hard
   constraints, never favorites by itself) · Journey milestones/suggestions (no auto stage move) · PresentationOutcomeSummary ·
   PresentationOfflinePolicy + PresentationFallbackPolicy (no silent fallback) · private cache (cleared on logout/tenant
   switch) · PresentationTheme (versioned, no business logic) · device layout · presenter notes (memory only) ·
   PresentationExportRequest (snapshot only; no PDF engine here) · LegacyPresentationInventory. */
App.presentationMode = App.presentationMode || {};
App.presentationMode.runtime = (() => {
  const P = App.presentationMode.policy, D = App.presentationMode.domain;
  const err = (code, message, extra = {}) => Object.assign(new Error(message || code), { code, ...extra });
  const nowIso = o => (o && o.now) || new Date().toISOString();
  const freeze = D.deepFreeze;

  // ---------------------------------------------------------------- access to a snapshot (current authorization always wins)
  /** openSnapshot(repo, ctx, snapshotId) → { ok, snapshot } — immutable content does not override current permission or safety */
  function openSnapshot(repo, ctx, id) {
    if (!D.can(ctx, 'presentation.read')) return { ok: false, code: 'FORBIDDEN' };
    const s = repo.getSnapshot(ctx, id); if (!s) return { ok: false, code: 'NOT_FOUND' }; // other tenant → NOT_FOUND
    const sf = D.safety.get(s.organizationId, s.id);
    if (!sf || sf.status === 'REVOKED') return { ok: false, code: 'SNAPSHOT_REVOKED' };
    if (sf.status === 'REVIEW_REQUIRED') return { ok: false, code: 'SNAPSHOT_REVIEW_REQUIRED' }; // the audience never sees content under review
    if (s.status === 'BLOCKED') return { ok: false, code: 'SNAPSHOT_BLOCKED' };
    return { ok: true, snapshot: s };
  }

  // ---------------------------------------------------------------- Session
  const sessions = new Map();
  /** start(repo, ctx, snapshotId, { mode, deviceProfile }) → PresentationSession (plain, frozen; every move returns a new one) */
  function start(repo, ctx, snapshotId, o = {}) {
    if (!D.can(ctx, 'presentation.session.start')) return { ok: false, code: 'FORBIDDEN' };
    const op = openSnapshot(repo, ctx, snapshotId); if (!op.ok) return op;
    const s = op.snapshot, st = s.audience.storyline, at = nowIso(ctx);
    const sess = freeze({ id: D.opaqueId('pss'), organizationId: s.organizationId, presentationSnapshotId: s.id, presenterUserId: ctx.userId || null, startedAt: at, endedAt: null,
      currentStepId: st.startStepId, mode: P.RuntimeMode[o.mode] ? o.mode : 'GUIDED', deviceProfile: P.DeviceProfile[o.deviceProfile] ? o.deviceProfile : 'DESKTOP', state: 'ACTIVE',
      runtimeFlags: { presenterNotesVisible: false, fullscreen: false, completed: false, mapOpen: false, overlay: null }, viewedStepIds: st.startStepId ? [st.startStepId] : [], viewedLotRefs: [], feedbackIds: [] });
    sessions.set(sess.id, { session: sess, snapshot: s });
    D.audit('PresentationStarted', { organizationId: s.organizationId, snapshotId: s.id, sessionId: sess.id }, ctx);
    D.emit('PresentationStarted', { organizationId: s.organizationId, snapshotId: s.id, sessionId: sess.id }, ctx);
    return { ok: true, session: sess };
  }
  const entry = id => { const e = sessions.get(id); if (!e) throw err('SESSION_NOT_FOUND', 'Sessão não encontrada.'); return e; };
  function put(e, patch, flags) { const next = freeze({ ...JSON.parse(JSON.stringify(e.session)), ...patch, runtimeFlags: { ...e.session.runtimeFlags, ...(flags || {}) } }); e.session = next; return next; }
  const steps = e => e.snapshot.audience.storyline.steps;
  function guardActive(e) { if (e.session.state === 'ENDED') throw err('SESSION_ENDED', 'A apresentação foi encerrada.'); }
  function goTo(sessionId, stepId, ctx = {}) {
    const e = entry(sessionId); guardActive(e);
    const ss = steps(e), i = ss.findIndex(s => s.id === stepId); if (i < 0) throw err('STEP_NOT_FOUND', 'Etapa inexistente.');
    const cur = ss.findIndex(s => s.id === e.session.currentStepId), sl = e.snapshot.audience.storyline;
    // Guided ≠ rigid: adjacent moves always; jumps when the storyline allows free navigation or the session is not GUIDED
    if (Math.abs(i - cur) > 1 && e.session.mode === 'GUIDED' && !sl.allowFreeNavigation) throw err('NAVIGATION_NOT_ALLOWED', 'Navegação livre desativada neste roteiro.');
    const viewed = e.session.viewedStepIds.includes(stepId) ? e.session.viewedStepIds : [...e.session.viewedStepIds, stepId];
    const blk = e.snapshot.audience.blocks.find(b => b.blockId === ss[i].blockId);
    D.emit('PresentationStepViewed', { organizationId: e.session.organizationId, sessionId, stepId }, ctx); // analytics-level, not a Journey fact
    if (blk && blk.type === 'COMPARISON') D.emit('PresentationComparisonViewed', { organizationId: e.session.organizationId, sessionId }, ctx);
    if (blk && blk.type === 'FINANCIAL_SIMULATION') D.emit('PresentationFinancialViewed', { organizationId: e.session.organizationId, sessionId }, ctx);
    return put(e, { currentStepId: stepId, viewedStepIds: viewed }, { overlay: null, mapOpen: false });
  }
  const move = (sessionId, d, ctx) => { const e = entry(sessionId); guardActive(e); const ss = steps(e), i = ss.findIndex(s => s.id === e.session.currentStepId), j = i + d; if (j < 0 || j >= ss.length) return e.session; return goTo(sessionId, ss[j].id, ctx); };
  const next = (id, ctx) => move(id, 1, ctx), previous = (id, ctx) => move(id, -1, ctx);
  function jumpToLot(sessionId, lotRef, ctx = {}) {
    const e = entry(sessionId); guardActive(e);
    if (!e.snapshot.audience.storyline.allowLotJump) throw err('NAVIGATION_NOT_ALLOWED', 'Salto para lote desativado neste roteiro.');
    if (!e.snapshot.audience.lots.some(l => l.lotRef === lotRef)) throw err('LOT_NOT_IN_PRESENTATION', 'Lote fora desta apresentação.');
    const blk = e.snapshot.audience.blocks.find(b => b.payload && ((b.payload.card && b.payload.card.lotRef === lotRef)));
    D.emit('PresentationLotOpened', { organizationId: e.session.organizationId, sessionId, lotRef }, ctx);
    const viewedLots = e.session.viewedLotRefs.includes(lotRef) ? e.session.viewedLotRefs : [...e.session.viewedLotRefs, lotRef];
    if (blk) { const st = steps(e).find(s => s.blockId === blk.blockId); if (st) { put(e, { viewedLotRefs: viewedLots }); return goToFree(e, st.id, ctx); } }
    return put(e, { viewedLotRefs: viewedLots }, { mapOpen: true, overlay: null, focusLotRef: lotRef });
  }
  function goToFree(e, stepId, ctx) { const viewed = e.session.viewedStepIds.includes(stepId) ? e.session.viewedStepIds : [...e.session.viewedStepIds, stepId]; D.emit('PresentationStepViewed', { organizationId: e.session.organizationId, sessionId: e.session.id, stepId }, ctx); return put(e, { currentStepId: stepId, viewedStepIds: viewed }, { overlay: null }); }
  function returnToMap(sessionId) { const e = entry(sessionId); guardActive(e); if (!e.snapshot.audience.storyline.allowReturnToMap) throw err('NAVIGATION_NOT_ALLOWED', 'Retorno ao mapa desativado neste roteiro.'); return put(e, {}, { mapOpen: true, overlay: null }); }
  function setMode(sessionId, mode) { if (!P.RuntimeMode[mode]) throw err('INVALID_MODE', mode); const e = entry(sessionId); guardActive(e); return put(e, { mode }); }
  const pause = id => { const e = entry(id); guardActive(e); return put(e, { state: 'PAUSED' }); };
  const resume = id => { const e = entry(id); guardActive(e); return put(e, { state: 'ACTIVE' }); };
  const setFullscreen = (id, on) => { const e = entry(id); return put(e, {}, { fullscreen: !!on }); }; // UI enhancement; exiting keeps the session
  /** markCompleted: explicit presenter action ("Concluir apresentação") — never inferred from reaching the last step */
  function markCompleted(sessionId, ctx = {}) { const e = entry(sessionId); guardActive(e); D.emit('PresentationCompleted', { organizationId: e.session.organizationId, sessionId, snapshotId: e.session.presentationSnapshotId }, ctx); return put(e, {}, { completed: true }); }
  function end(sessionId, ctx = {}) {
    const e = entry(sessionId); if (e.session.state === 'ENDED') return { session: e.session, journeyEvents: [] };
    const s = put(e, { state: 'ENDED', endedAt: nowIso(ctx) }, { overlay: null, presenterNotesVisible: false });
    D.audit('PresentationEnded', { organizationId: s.organizationId, sessionId, snapshotId: s.presentationSnapshotId }, ctx);
    D.emit('PresentationEnded', { organizationId: s.organizationId, sessionId }, ctx);
    const snap = e.snapshot, journeyEvents = [], suggestions = [];
    if (s.runtimeFlags.completed && snap.journeyId) {
      journeyEvents.push(freeze({ type: 'PRESENTATION_COMPLETED', journeyId: snap.journeyId, snapshotId: snap.id, sessionId, at: s.endedAt }));
      if (['SHORTLIST', 'COMPARISON', 'INITIAL_OPTIONS'].includes(snap.purpose)) suggestions.push(freeze({ type: 'STAGE_SUGGESTION', suggestedStage: 'SHORTLISTED', journeyId: snap.journeyId, autoApply: false })); // suggestion only
    }
    return { session: s, journeyEvents, stageSuggestions: suggestions, outcome: outcome(sessionId) };
  }
  const getSession = id => (sessions.get(id) || {}).session || null;
  /** audienceView(sessionId) → what the audience surface renders: the snapshot audience + current step; never presenter controls/notes */
  function audienceView(sessionId) {
    const e = entry(sessionId), a = e.snapshot.audience, st = steps(e).find(s => s.id === e.session.currentStepId) || null;
    return freeze({ title: a.title, customerLabel: a.customerLabel, step: st ? { id: st.id, order: st.order, total: steps(e).length, title: st.title, navigationLabel: st.navigationLabel } : null,
      block: st ? a.blocks.find(b => b.blockId === st.blockId) || null : null, mapOpen: !!e.session.runtimeFlags.mapOpen, focusLotRef: e.session.runtimeFlags.focusLotRef || null, lots: a.lots, theme: a.theme,
      state: e.session.state, preparedAtLabel: a.preparedAtLabel });
  }
  /** presenterControlState(sessionId, ctx) — separate surface; notes only with explicit permission (never mirrored) */
  function presenterControlState(sessionId, ctx = {}) {
    const e = entry(sessionId), ss = steps(e), i = ss.findIndex(s => s.id === e.session.currentStepId);
    const notesAllowed = D.can(ctx, 'presentation.internalNotes.read');
    return freeze({ currentStepId: e.session.currentStepId, nextStepId: ss[i + 1] ? ss[i + 1].id : null, previousStepId: i > 0 ? ss[i - 1].id : null, presenterNotesVisible: notesAllowed && !!e.session.runtimeFlags.presenterNotesVisible,
      audienceScreenConnected: !!e.session.runtimeFlags.audienceScreenConnected, controls: CONTROLS.filter(c => !c.permission || D.can(ctx, c.permission)).map(c => c.id),
      warnings: e.snapshot.warnings.map(w => (D.MESSAGES[w.code] || w.code) + (w.lotRef ? ` (${w.lotRef})` : '')), notes: notesAllowed ? notes.forStep(e.snapshot.presentationDefinitionId, e.session.currentStepId) : [] });
  }
  const CONTROLS = Object.freeze([{ id: 'ADD_PRESENTER_NOTE', permission: 'presentation.internalNotes.read' }, { id: 'MARK_PRESENTED' }, { id: 'RECORD_FEEDBACK', permission: 'presentation.feedback.record' }, { id: 'CREATE_FOLLOW_UP' }, { id: 'SCHEDULE_VISIT' }]);
  /** PresentationPresenterControlsPolicy: audience projection never carries these ids */
  const PRESENTER_CONTROLS_POLICY = Object.freeze({ audienceVisible: false, sameDeviceConcealed: true, separateWindowReady: true, controls: CONTROLS.map(c => c.id) });
  /** restorePayload / restore: crash recovery keeps only { snapshotId, currentStepId, mode } (no notes, no customer data) and re-checks access */
  const restorePayload = id => { const s = getSession(id); return s ? { snapshotId: s.presentationSnapshotId, currentStepId: s.currentStepId, mode: s.mode } : null; };
  function restore(repo, ctx, payload) {
    if (!payload || !payload.snapshotId) return { ok: false, code: 'NOTHING_TO_RESTORE' };
    const r = start(repo, ctx, payload.snapshotId, { mode: payload.mode }); if (!r.ok) return r;
    const e = entry(r.session.id); if (steps(e).some(s => s.id === payload.currentStepId)) put(e, { currentStepId: payload.currentStepId });
    return { ok: true, session: e.session };
  }

  // ---------------------------------------------------------------- overlay coordinator (one dominant overlay; no hidden modal stacks)
  const OVERLAYS = Object.freeze(['COMPARISON', 'FINANCIAL', 'LOT_DETAILS', 'MAP_LEGEND', 'FEEDBACK']);
  function createOverlayCoordinator() {
    let cur = null;
    return { open(kind) { if (!OVERLAYS.includes(kind)) throw err('UNKNOWN_OVERLAY', kind); const prev = cur; cur = kind; return { current: cur, replaced: prev }; }, close() { const p = cur; cur = null; return p; }, current: () => cur };
  }

  // ---------------------------------------------------------------- feedback intents (no profile mutation, no inferred constraints)
  const feedback = [];
  function recordFeedback(sessionId, input = {}, ctx = {}) {
    const e = entry(sessionId); guardActive(e);
    if (!D.can(ctx, 'presentation.feedback.record')) return { ok: false, code: 'FORBIDDEN' };
    if (!P.FeedbackType[input.type]) return { ok: false, code: 'INVALID_FEEDBACK_TYPE' };
    const by = input.recordedBy === 'CUSTOMER' ? 'CUSTOMER' : 'PRESENTER';
    const lot = input.lotRef ? e.snapshot.lotRefs.find(l => l.lotRef === input.lotRef) : null;
    if (input.lotRef && !lot) return { ok: false, code: 'LOT_NOT_IN_PRESENTATION' };
    const intent = freeze({ id: D.opaqueId('pfi'), sessionId, customerId: e.snapshot.customerRef ? e.snapshot.customerRef.customerId : null, lotId: lot ? lot.lotId : null, type: input.type, recordedAt: nowIso(ctx), recordedBy: by });
    feedback.push(intent); put(e, { feedbackIds: [...e.session.feedbackIds, intent.id] });
    D.emit('PresentationFeedbackRecorded', { organizationId: e.session.organizationId, sessionId, feedbackId: intent.id, type: intent.type }, ctx);
    const journeyEvent = e.snapshot.journeyId ? freeze({ type: 'PRESENTATION_FEEDBACK_RECORDED', journeyId: e.snapshot.journeyId, feedbackId: intent.id, feedbackType: intent.type }) : null;
    const nextAction = intent.type === 'VISIT_INTEREST' ? freeze({ type: 'NEXT_ACTION_SUGGESTION', action: 'SCHEDULE_VISIT', lotId: intent.lotId, reservation: false })
      : intent.type === 'FINANCIAL_INTEREST' ? freeze({ type: 'NEXT_ACTION_SUGGESTION', action: 'UPDATE_SIMULATION', lotId: intent.lotId }) : null;
    // DISLIKED is a signal for the broker to review; it never becomes a hard constraint, a preference or an unfavorite
    return { ok: true, intent, journeyEvent, nextAction, profileChanged: false, favoriteChanged: false };
  }
  const feedbackOf = sessionId => feedback.filter(f => f.sessionId === sessionId);
  /** PresentationOutcomeSummary: session summary (not analytics truth) */
  function outcome(sessionId) {
    const e = entry(sessionId), fb = feedbackOf(sessionId), refById = Object.fromEntries(e.snapshot.lotRefs.map(l => [l.lotId, l.lotRef]));
    return freeze({ sessionId, viewedLotIds: e.session.viewedLotRefs.map(r => (e.snapshot.lotRefs.find(l => l.lotRef === r) || {}).lotId).filter(Boolean), feedbackCount: fb.length,
      interestedLotIds: [...new Set(fb.filter(f => ['LIKED', 'MORE_INFO', 'VISIT_INTEREST', 'FINANCIAL_INTEREST', 'COMPARE'].includes(f.type) && f.lotId).map(f => f.lotId))].filter(id => refById[id]),
      nextActionSuggestionIds: fb.filter(f => ['VISIT_INTEREST', 'FINANCIAL_INTEREST'].includes(f.type)).map(f => f.id), completed: !!e.session.runtimeFlags.completed });
  }

  // ---------------------------------------------------------------- presenter notes (separate entity; memory only; never in snapshots)
  const notes = (() => {
    const all = [];
    return {
      add(ctx, n) { if (!D.can(ctx, 'presentation.internalNotes.read')) throw err('FORBIDDEN', 'Notas do apresentador exigem permissão.'); const x = freeze({ id: D.opaqueId('pnt'), presentationDefinitionId: n.presentationDefinitionId, blockId: n.blockId || null, stepId: n.stepId || null, authorUserId: ctx.userId || null, text: String(n.text || '').slice(0, 2000), visibility: 'PRESENTER_ONLY', createdAt: nowIso(ctx) }); all.push(x); return x; },
      forStep: (defId, stepId) => all.filter(n => n.presentationDefinitionId === defId && (!n.stepId || n.stepId === stepId)).map(n => ({ id: n.id, text: n.text })),
      clear: () => { all.length = 0; }
    };
  })();

  // ---------------------------------------------------------------- offline + fallback + private cache
  const OFFLINE_POLICY = Object.freeze({ allowSnapshotCache: false, allowCustomerLabelCache: false, allowMapAssetsCache: true, allowFinancialDataCache: false, maxCacheAgeSeconds: null, clearOnLogout: true });
  /** offlineView(snapshot, { online, policy, now, cached }) — SNAPSHOT may present offline only if policy allows caching it; never claims current availability */
  function offlineView(snap, o = {}) {
    const pol = { ...OFFLINE_POLICY, ...(o.policy || {}) };
    if (o.online !== false) return { allowed: true, offline: false, banner: null };
    if (!o.cached || !pol.allowSnapshotCache) return { allowed: false, offline: true, code: 'OFFLINE_SNAPSHOT_NOT_CACHED', message: 'Sem conexão e sem cópia local autorizada desta apresentação.' };
    if (pol.maxCacheAgeSeconds != null && (Date.parse(o.now || new Date().toISOString()) - Date.parse(snap.generatedAt)) / 1000 > pol.maxCacheAgeSeconds) return { allowed: false, offline: true, code: 'OFFLINE_CACHE_EXPIRED', message: 'A cópia local desta apresentação expirou.' };
    const fr = D.freshness(snap, { now: o.now, offline: true });
    return { allowed: true, offline: true, banner: fr.warnings.join(' '), currentAvailabilityClaimed: false, canRefresh: false, customerLabelVisible: pol.allowCustomerLabelCache, financialVisible: pol.allowFinancialDataCache };
  }
  /** liveFallback({ online, policy, lastSafeSnapshot }) — LIVE offline degrades explicitly (never silently) */
  function liveFallback(o = {}) {
    if (o.online !== false) return { mode: 'LIVE' };
    const pol = P.FallbackPolicy[o.policy] ? o.policy : 'BLOCK';
    if (pol === 'USE_LAST_SAFE_SNAPSHOT' && o.lastSafeSnapshot) return { mode: 'SNAPSHOT', snapshotId: o.lastSafeSnapshot.id, notice: 'Sem conexão: exibindo a última versão preparada desta apresentação.' };
    if (pol === 'ALLOW_PARTIAL_WITH_WARNING') return { mode: 'PARTIAL', notice: 'Sem conexão: alguns dados podem não estar disponíveis ou atualizados.' };
    return { mode: 'BLOCKED', notice: 'Sem conexão: a apresentação ao vivo não pode ser exibida.' };
  }
  /** private cache: key = org | snapshot/definition | policy version | permission context | version refs; cleared on logout/tenant switch */
  const cache = (() => {
    const m = new Map();
    const keyOf = k => [k.organizationId, k.snapshotId || k.definitionId, k.clientSafePolicyVersion, k.permissionContext || 'default', D.checksum(k.versionRefs || null)].join('|');
    return { keyOf, get: k => m.get(keyOf(k)) || null, set: (k, v) => { m.set(keyOf(k), v); return v; }, clearOrg: org => { for (const k of [...m.keys()]) if (k.startsWith(org + '|')) m.delete(k); }, clear: () => m.clear(), size: () => m.size };
  })();
  function clearPrivateState(reason = 'logout') { cache.clear(); sessions.clear(); notes.clear(); feedback.length = 0; return { cleared: true, reason }; }
  let lastOrg;
  /** bindAuth(): logout or tenant switch clears sessions, notes and the private cache */
  function bindAuth() {
    if (!App.authz || !App.authz.subscribe) return () => {};
    const org = () => { try { const c = App.authz.context(); return c && c.tenant ? c.tenant.organizationId : null; } catch (e) { return null; } };
    lastOrg = org();
    return App.authz.subscribe((ctx, info) => { const why = info && info.why, o = ctx && ctx.tenant ? ctx.tenant.organizationId : null; if (why === 'logout' || (info && info.tenantChanged) || o !== lastOrg) clearPrivateState(why === 'logout' ? 'logout' : 'tenant-switch'); lastOrg = o; });
  }

  // ---------------------------------------------------------------- theme (UI only; versioned)
  const DEFAULT_THEME = freeze({ id: 'house7-default', organizationId: 'house7', name: 'House 7', version: '1.0.0', logoAssetRef: 'logo.png', status: 'ACTIVE',
    typographyTokens: { heading: 'var(--font-heading, inherit)', body: 'var(--font-body, inherit)' }, spacingTokens: { block: '24px', gutter: '16px' }, layoutTokens: { maxWidth: '1100px' }, presentationComponentTokens: { cardRadius: '12px' } });
  function validateTheme(th) {
    const e = [];
    if (!th || !th.id || !th.version || !th.organizationId) e.push('IDENTITY');
    if (th && th.status !== 'ACTIVE') e.push('NOT_ACTIVE');
    const bad = /(price|preco|score|filter|rank|winner|availability|admin|debug)|^fit/i;
    for (const g of ['typographyTokens', 'spacingTokens', 'layoutTokens', 'presentationComponentTokens']) for (const [k, v] of Object.entries((th && th[g]) || {})) {
      if (bad.test(k)) e.push('BUSINESS_KEY:' + k);
      if (typeof v !== 'string' || /javascript:|expression\(|url\(\s*['"]?\s*(?!data:image\/)/i.test(v) || /<|>/.test(v)) e.push('UNSAFE_TOKEN:' + k);
    }
    return e;
  }
  /** device layout only (content truth is the same on every profile) */
  const LAYOUT = Object.freeze({ DESKTOP: { navigation: 'side', columns: 2, presenterPanel: 'inline' }, TABLET: { navigation: 'bottom', columns: 1, presenterPanel: 'drawer' },
    MOBILE: { navigation: 'bottom', columns: 1, presenterPanel: 'drawer', vertical: true }, EXTERNAL_DISPLAY: { navigation: 'hidden', columns: 2, presenterPanel: 'separate-surface' } });
  const layoutFor = p => LAYOUT[p] || LAYOUT.DESKTOP;

  // ---------------------------------------------------------------- export foundation (snapshot only)
  function exportRequest(snap, input = {}, ctx = {}) {
    if (!snap || !snap.id || !snap.checksum) return { ok: false, code: 'SNAPSHOT_REQUIRED' }; // never from a mutable Definition
    if (!['PDF', 'PRINT', 'IMAGE_SET'].includes(input.format)) return { ok: false, code: 'INVALID_FORMAT' };
    const sf = D.safety.get(snap.organizationId, snap.id); if (!sf || sf.status !== 'SAFE') return { ok: false, code: 'SNAPSHOT_NOT_SAFE' };
    return { ok: true, request: freeze({ snapshotId: snap.id, format: input.format, audience: 'CLIENT', includeCover: input.includeCover !== false, includeMap: !!input.includeMap, requestedBy: ctx.userId || null }), engine: input.format === 'PRINT' ? 'BROWSER_PRINT' : 'PENDING_TOPIC_42' };
  }
  /** internal route for authenticated users (no public access here; ShareService decides tokens) */
  const internalRoute = snapshotId => '/presentations/' + encodeURIComponent(snapshotId);

  // ---------------------------------------------------------------- legacy inventory (what existed before topic 41)
  const LEGACY_INVENTORY = Object.freeze([
    { location: 'presentation/app.js togglePresentation + store.presentationView', behavior: 'Botão "Apresentar": muda presentationMode para client, fecha gaveta e mostra só mapa/painel', dataSources: ['LotRepository (lots.json)', 'store'],
      hidesControlsOnly: false, exposesInternalPayload: true, classification: 'UI_ONLY', migrationAction: 'REUSE_UI', notes: 'Os textos passam por viewmodels (isFieldVisible), mas o lote canônico completo (scores, notas, provenance) está na página. Dataset público, sem PII; não serve como projeção segura para dados privados.' },
    { location: 'config/presentation.js hiddenFields/hiddenSections (modo cliente)', behavior: 'Lista de campos ocultos (deny-list)', dataSources: ['FieldRegistry'], hidesControlsOnly: false, exposesInternalPayload: false,
      classification: 'CLIENT_SAFE_PROJECTION', migrationAction: 'REUSE_UI', notes: 'Agora deny by default: clientSafeFields (allow-list) + hiddenFields. Campo novo fica oculto até ser classificado.' },
    { location: 'presentation/app.js classes ws.client / ws.pres / ws.tech', behavior: 'CSS esconde controles no modo cliente/apresentação', dataSources: [], hidesControlsOnly: true, exposesInternalPayload: false,
      classification: 'UI_ONLY', migrationAction: 'REVIEW', notes: 'Esconder por CSS não é segurança; o conteúdo do modo apresentação novo vem de snapshot.audience.' },
    { location: 'presentation/compareView.js + quickview (audience client/presentation)', behavior: 'Comparação e Quick View com audiência client', dataSources: ['compare.evaluation', 'quickView'], hidesControlsOnly: false, exposesInternalPayload: false,
      classification: 'CLIENT_SAFE_PROJECTION', migrationAction: 'REUSE_UI', notes: 'Reutilizados pela projeção (highlights audience presentation).' },
    { location: 'presentation/overlays.js share modal (WhatsApp/copiar texto/copiar link, PDF em breve)', behavior: 'Texto e link enviados ao cliente', dataSources: ['vm.shareVM', 'services.share'], hidesControlsOnly: false, exposesInternalPayload: false,
      classification: 'SHARE', migrationAction: 'REVIEW', notes: 'Distribuição é do tópico 42 (App.share). PDF continua desativado.' }
  ].map(Object.freeze));

  return Object.freeze({ openSnapshot, start, goTo, next, previous, jumpToLot, returnToMap, setMode, pause, resume, setFullscreen, markCompleted, end, getSession, audienceView, presenterControlState,
    PRESENTER_CONTROLS_POLICY, restorePayload, restore, createOverlayCoordinator, OVERLAYS, recordFeedback, feedbackOf, outcome, notes, OFFLINE_POLICY, offlineView, liveFallback, cache, clearPrivateState, bindAuth,
    DEFAULT_THEME, validateTheme, LAYOUT, layoutFor, exportRequest, internalRoute, LEGACY_INVENTORY });
})();
