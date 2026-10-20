/* backoffice/backofficeCore.js — App.backoffice (topic 60, phases 1-3): admin shell context, AdminNavigationRegistry,
   provider adapters, OperationalInbox, WorkQueues, BulkActionPolicy, Approval Center, WorkAssignment/WorkClaim.
   Principles (§2-§4, §23, §25, §198):
   - the backoffice is an operational layer over domain services: no CRUD, no direct DB, no parallel workflow;
   - navigation, queues and actions come from App.authz permissions; deny by default; the static public visitor
     (anonymous) gets NO backoffice entry at all (entryVisible = false, items = []);
   - inbox/queue items are projections fed by provider adapters of other modules; resolving an item runs the domain
     command of the provider (through App.backoffice.commands), never a local status change;
   - assignment ≠ authorization; unauthorized areas never reveal counts (§514).
   Provider adapter interface (BackofficeProviderAdapter), looked up as App.<name>.backofficeAdapter or registered with
   registerProvider(name, adapter); every method optional, sync or async:
     { id, version,
       listInboxItems({ organizationId, now }) → OperationalInboxItem[],
       listQueueItems(queueId, { organizationId, filters, sort, cursor, pageSize, now }) → { items, nextCursor?, lastUpdatedAt? },
       listApprovalTasks({ organizationId, now }) → ApprovalTask[] }
   Missing App.<name> → status MODULE_UNAVAILABLE ("módulo não disponível"); present but without adapter → MODULE_NOT_INTEGRATED. */
App.backoffice = (() => {
  const C = () => App.backofficeConfig;
  const A = () => App.authz, P = () => App.permissions;
  const SEVERITY = Object.freeze({ INFO: 'INFO', LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });
  const SEVERITY_ORDER = Object.freeze({ INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 });
  const SEVERITY_LABEL = Object.freeze({ INFO: 'Informativo', LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', CRITICAL: 'Crítica' });
  const SEVERITY_ICON = Object.freeze({ INFO: 'i', LOW: '▽', MEDIUM: '◇', HIGH: '▲', CRITICAL: '■' }); // shape + label, never color only (§505)
  const INBOX_STATUS = Object.freeze({ OPEN: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', WAITING: 'WAITING', RESOLVED: 'RESOLVED', DISMISSED: 'DISMISSED' });
  const INBOX_STATUS_LABEL = Object.freeze({ OPEN: 'Aberto', IN_PROGRESS: 'Em andamento', WAITING: 'Aguardando', RESOLVED: 'Resolvido', DISMISSED: 'Descartado' });
  const PROVIDER_STATUS = Object.freeze({ AVAILABLE: 'AVAILABLE', MODULE_UNAVAILABLE: 'MODULE_UNAVAILABLE', MODULE_NOT_INTEGRATED: 'MODULE_NOT_INTEGRATED', PROVIDER_ERROR: 'PROVIDER_ERROR', BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE', NOT_AUTHORIZED: 'NOT_AUTHORIZED' });
  const PROVIDER_MESSAGE = Object.freeze({ MODULE_UNAVAILABLE: 'Módulo não disponível.', MODULE_NOT_INTEGRATED: 'Módulo presente, mas ainda não integrado ao backoffice.', PROVIDER_ERROR: 'Não foi possível carregar esta área agora.',
    BACKEND_UNAVAILABLE: 'Servidor administrativo indisponível: nenhum dado desta área foi carregado.', LIST_CONTRACT_MISSING: 'O servidor ainda não oferece a listagem desta fila (contrato pendente).', NOT_AUTHORIZED: 'O servidor negou o acesso a esta área.' });
  const ASSIGNMENT_STATUS = Object.freeze({ ASSIGNED: 'ASSIGNED', UNASSIGNED: 'UNASSIGNED', COMPLETED: 'COMPLETED' });
  const ERR = Object.freeze({
    NOT_AUTHORIZED: 'Você não possui permissão para esta área.', QUEUE_UNKNOWN: 'Fila inexistente.', FILTER_NOT_ALLOWED: 'Filtro não permitido nesta fila.',
    SORT_NOT_ALLOWED: 'Ordenação não permitida.', PAGE_SIZE_EXCEEDED: 'Tamanho de página acima do limite.', BULK_DISABLED: 'Ação em massa não permitida para esta ação.',
    BULK_LIMIT_NOT_CONFIGURED: 'Limite de ação em massa não configurado (necessita confirmação).', BULK_LIMIT_EXCEEDED: 'Mais itens do que o limite permitido.',
    BULK_STATUS_NOT_ALLOWED: 'Há itens em status que não aceitam esta ação.', SELF_APPROVAL_FORBIDDEN: 'Quem fez o pedido não pode aprová-lo (separação de funções).',
    ACTION_NOT_IN_QUEUE: 'Esta ação não está disponível nesta fila.', ASSIGNEE_LACKS_PERMISSION: 'O responsável atribuído não tem a permissão da ação (problema de configuração de acesso).',
    CLAIM_HELD: 'Item em análise por outra pessoa até a expiração da reserva de trabalho.', INVALID_ITEM: 'Item inválido.'
  });
  const nowMs = n => n == null ? Date.now() : (typeof n === 'number' ? n : new Date(n).getTime());
  const iso = n => new Date(nowMs(n)).toISOString();
  const err = (code, extra = {}) => Object.freeze({ ok: false, code, message: ERR[code] || code, ...extra });

  // ------------------------------------------------------------------ authorization helpers (UX layer; the server revalidates)
  const ctxOf = o => (o && o.context) || A().context();
  const isAnonymous = ctx => !ctx || !ctx.principal || ctx.principal.type === A().PRINCIPAL_TYPE.ANONYMOUS;
  const orgOf = ctx => (ctx && ctx.tenant && ctx.tenant.organizationId) || null;
  const resourceOf = ctx => orgOf(ctx) ? { organizationId: orgOf(ctx) } : null;
  /** allows(ctx, keys[]) → { allowed, reason } — every key must be ALLOW on the active organization (unknown key → deny) */
  function allows(ctx, keys, opts = {}) {
    if (isAnonymous(ctx)) return { allowed: false, reason: 'AUTH_REQUIRED' };
    if (!orgOf(ctx)) return { allowed: false, reason: 'TENANT_UNRESOLVED' };
    for (const k of keys || []) {
      const d = A().evaluate(ctx, { permission: k, resource: resourceOf(ctx), context: { connectivity: opts.connectivity || 'ONLINE', now: opts.now } });
      if (!d.allowed) return { allowed: false, reason: d.reason, permission: k };
    }
    return { allowed: true, reason: 'ALLOWED' };
  }

  // ------------------------------------------------------------------ admin shell context (§6, §161-164)
  /** entryVisible(ctx) — whether the broker app shows the entry to the admin shell at all. Visitor: false. */
  const entryVisible = (o = {}) => allows(ctxOf(o), ['backoffice.access'], o).allowed;
  /** shellContext() → { allowed, tenantLabel, organizationId, principal, supportSession? } (no PII beyond own display name) */
  function shellContext(o = {}) {
    const ctx = ctxOf(o), g = allows(ctx, ['backoffice.access'], o);
    if (!g.allowed) return Object.freeze({ allowed: false, reason: g.reason, message: ERR.NOT_AUTHORIZED });
    const org = orgOf(ctx), sum = App.tenancy && App.tenancy.summary ? App.tenancy.summary(org) : null;
    const name = (sum && sum.displayName) || org;
    return Object.freeze({ allowed: true, organizationId: org, organizationName: name, tenantLabel: `${C().shell.tenantLabelPrefix} ${name}`,
      principal: { displayName: ctx.principal.displayName || 'Usuário', type: ctx.principal.type }, title: C().shell.title, technicalMode: !!o.technicalMode });
  }

  // ------------------------------------------------------------------ AdminNavigationRegistry (§16/17)
  const modules = new Map(); // AdminModuleDefinition registry (§358): internal code registry, no dynamic plugin code
  function registerModule(def) {
    if (!def || typeof def.id !== 'string' || !Array.isArray(def.requiredPermissions)) throw Object.assign(new Error('AdminModuleDefinition inválida'), { code: 'INVALID_MODULE' });
    modules.set(def.id, Object.freeze({ routes: [], navigationItems: [], workQueueIds: [], featureFlag: null, ...def }));
    return modules.get(def.id);
  }
  const navigation = Object.freeze({
    /** getItems(ctx) → AdminNavigationItem[] the principal may see (sorted by order). Visitor → []. */
    getItems(o = {}) {
      const ctx = ctxOf(o);
      if (isAnonymous(ctx)) return [];
      return C().navigation.filter(i => allows(ctx, i.requiredPermissions, o).allowed).slice().sort((a, b) => a.order - b.order)
        .map(i => Object.freeze({ id: i.id, label: i.label, route: i.route, order: i.order, requiredPermissions: i.requiredPermissions.slice(), badgeSource: i.badgeSource || null, module: i.module }));
    },
    /** routeAccess(route) — RouteGuard for an admin route. Unknown route → deny. */
    routeAccess(route, o = {}) {
      const ctx = ctxOf(o), clean = String(route || '').split('?')[0];
      if (!/^\/admin(\/[A-Za-z0-9_-]+)*$/.test(clean)) return Object.freeze({ allowed: false, reason: 'UNKNOWN_ROUTE', message: ERR.NOT_AUTHORIZED }); // safe ids only
      const item = C().navigation.filter(i => clean === i.route || clean.startsWith(i.route + '/')).sort((a, b) => b.route.length - a.route.length)[0];
      if (!item) return Object.freeze({ allowed: false, reason: 'UNKNOWN_ROUTE', message: ERR.NOT_AUTHORIZED });
      const g = allows(ctx, item.requiredPermissions, o);
      return Object.freeze({ allowed: g.allowed, reason: g.reason, navId: item.id, message: g.allowed ? null : ERR.NOT_AUTHORIZED });
    }
  });

  // ------------------------------------------------------------------ provider adapters (other topics, never imported)
  const registered = new Map();
  function registerProvider(name, adapter) {
    if (!C().providers.includes(name)) throw Object.assign(new Error(`provider desconhecido: ${name}`), { code: 'UNKNOWN_PROVIDER' });
    if (!adapter || typeof adapter !== 'object') throw Object.assign(new Error('adapter inválido'), { code: 'INVALID_ADAPTER' });
    registered.set(name, adapter); return true;
  }
  const unregisterProvider = name => registered.delete(name);
  /** provider(name) → { status, adapter|null, message } */
  function provider(name) {
    if (registered.has(name)) return { status: PROVIDER_STATUS.AVAILABLE, adapter: registered.get(name), message: null };
    const mod = App[name];
    if (!mod) return { status: PROVIDER_STATUS.MODULE_UNAVAILABLE, adapter: null, message: PROVIDER_MESSAGE.MODULE_UNAVAILABLE };
    const ad = mod.backofficeAdapter;
    if (!ad || typeof ad !== 'object') return { status: PROVIDER_STATUS.MODULE_NOT_INTEGRATED, adapter: null, message: PROVIDER_MESSAGE.MODULE_NOT_INTEGRATED };
    return { status: PROVIDER_STATUS.AVAILABLE, adapter: ad, message: null };
  }
  async function callProvider(name, method, ...args) {
    const p = provider(name);
    if (p.status !== PROVIDER_STATUS.AVAILABLE) return { status: p.status, message: p.message, value: null };
    if (typeof p.adapter[method] !== 'function') return { status: PROVIDER_STATUS.MODULE_NOT_INTEGRATED, message: PROVIDER_MESSAGE.MODULE_NOT_INTEGRATED, value: null };
    try { return { status: PROVIDER_STATUS.AVAILABLE, message: null, value: await p.adapter[method](...args) }; }
    catch (e) { // no stack/PII to the UI; round 6 adapters say why (no server, no list contract yet, server refused)
      const c = e && e.code;
      if (c === 'BACKEND_UNAVAILABLE') return { status: PROVIDER_STATUS.BACKEND_UNAVAILABLE, message: PROVIDER_MESSAGE.BACKEND_UNAVAILABLE, value: null };
      if (c === 'LIST_CONTRACT_MISSING') return { status: PROVIDER_STATUS.MODULE_NOT_INTEGRATED, message: PROVIDER_MESSAGE.LIST_CONTRACT_MISSING, value: null };
      if (c === 'NOT_AUTHORIZED') return { status: PROVIDER_STATUS.NOT_AUTHORIZED, message: PROVIDER_MESSAGE.NOT_AUTHORIZED, value: null };
      return { status: PROVIDER_STATUS.PROVIDER_ERROR, message: PROVIDER_MESSAGE.PROVIDER_ERROR, value: null };
    }
  }

  // ------------------------------------------------------------------ OperationalInboxItem (§22) — validated projection
  const PII_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|[^\s@]+@[^\s@]+\.[a-z]{2,}|\(?\d{2}\)?\s?9?\d{4}-?\d{4}/i; // CPF / e-mail / phone
  /** normalizeItem(raw, domain, orgId) → frozen item | null (invalid, other tenant or PII in summary fields are dropped) */
  function normalizeItem(raw, domain, orgId) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.title !== 'string') return null;
    if (raw.organizationId !== orgId) return null; // cross-tenant projection never shown (§169)
    if (!SEVERITY[raw.severity] || !INBOX_STATUS[raw.status]) return null;
    if (PII_RE.test(raw.title) || (raw.description && PII_RE.test(raw.description))) return null; // §74 no sensitive details in summary
    const route = typeof raw.actionRoute === 'string' && /^\/admin\/[A-Za-z0-9_\-/]+$/.test(raw.actionRoute) ? raw.actionRoute : null; // safe ids only (§330-332)
    return Object.freeze({ id: raw.id, organizationId: orgId, type: String(raw.type || 'unknown'), domain: raw.domain || domain, severity: raw.severity, status: raw.status,
      entityRef: raw.entityRef || null, title: raw.title, description: raw.description || null, assignedTo: raw.assignedTo || null, dueAt: raw.dueAt || null,
      overdue: raw.overdue === true, createdAt: raw.createdAt || null, updatedAt: raw.updatedAt || raw.createdAt || null, actionRoute: route, queueId: raw.queueId || null, provider: raw.provider || null,
      claim: raw.claim || null });
  }
  const sortItems = (items, keys) => items.slice().sort((a, b) => {
    for (const k of keys) {
      const [f, dir] = k.split(':'), s = dir === 'desc' ? -1 : 1;
      const va = f === 'severity' ? SEVERITY_ORDER[a.severity] : a[f], vb = f === 'severity' ? SEVERITY_ORDER[b.severity] : b[f];
      if (va == null && vb == null) continue; if (va == null) return 1; if (vb == null) return -1; // nulls last
      if (va < vb) return -s; if (va > vb) return s;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const queueDef = id => C().workQueues.find(q => q.id === id) || null;
  const queuesOfProvider = name => C().workQueues.filter(q => q.provider === name);

  const inbox = Object.freeze({
    /** build({ context, now }) → { items, sections: { urgent, approvals, deadlines, failures }, providers: {name: status}, lastUpdatedAt }
        Only items of queues the principal may see; open statuses only; dedup by id; overdue comes from the server (§210). */
    async build(o = {}) {
      const ctx = ctxOf(o), org = orgOf(ctx);
      if (!allows(ctx, ['backoffice.access', 'backoffice.inbox.view'], o).allowed) return Object.freeze({ allowed: false, items: [], sections: null, providers: {}, message: ERR.NOT_AUTHORIZED });
      const visibleQueues = new Set(C().workQueues.filter(q => allows(ctx, q.requiredPermissions, o).allowed).map(q => q.id));
      const provs = [...new Set(C().workQueues.filter(q => visibleQueues.has(q.id)).map(q => q.provider))];
      const seen = new Map(), status = {};
      for (const name of provs) {
        const r = await callProvider(name, 'listInboxItems', { organizationId: org, now: iso(o.now) });
        status[name] = { status: r.status, message: r.message };
        for (const raw of Array.isArray(r.value) ? r.value : []) {
          const it = normalizeItem({ ...raw, provider: name }, name, org);
          if (!it || !visibleQueues.has(it.queueId) || queueDef(it.queueId).provider !== name) continue; // item must belong to a visible queue of that provider
          if (it.status === INBOX_STATUS.RESOLVED || it.status === INBOX_STATUS.DISMISSED) continue;
          const prev = seen.get(it.id); if (!prev || (it.updatedAt || '') > (prev.updatedAt || '')) seen.set(it.id, it); // §194 dedupe
        }
      }
      const items = sortItems([...seen.values()], ['severity:desc', 'dueAt:asc', 'createdAt:asc']).slice(0, o.limit || C().shell.maxInboxItemsHome * 5);
      const sections = Object.freeze({
        urgent: items.filter(i => i.severity === 'CRITICAL' || i.overdue),
        approvals: items.filter(i => /approval/i.test(i.type) || /approvals$/.test(i.queueId || '')),
        deadlines: items.filter(i => i.dueAt && !i.overdue),
        failures: items.filter(i => /fail|error|sync/i.test(i.type))
      });
      return Object.freeze({ allowed: true, items, sections, providers: status, lastUpdatedAt: iso(o.now), isProjection: true });
    },
    normalizeItem
  });

  // ------------------------------------------------------------------ WorkQueues (§26-28, §249-252, §541-545)
  function validateQuery(def, q = {}) {
    const pol = C().queryPolicies, issues = [];
    for (const f of q.filters || []) {
      const ops = pol.filters[f.field];
      if (!ops || !ops.includes(f.op)) issues.push(err('FILTER_NOT_ALLOWED', { field: f.field, op: f.op }));
    }
    const sort = q.sort ? [].concat(q.sort) : pol.sorts[def.sortPolicy] || pol.sorts.default;
    for (const s of sort) { const [k, d] = String(s).split(':'); if (!pol.sorts.allowedKeys.includes(k) || !['asc', 'desc'].includes(d)) issues.push(err('SORT_NOT_ALLOWED', { sort: s })); }
    const pageSize = q.pageSize == null ? pol.pageSize.default : q.pageSize;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > pol.pageSize.max) issues.push(err('PAGE_SIZE_EXCEEDED', { max: pol.pageSize.max }));
    return { ok: !issues.length, issues, sort, pageSize, filters: q.filters || [] };
  }
  const applyFilter = (it, f) => { const v = it[f.field]; if (f.op === 'eq') return v === f.value; if (f.op === 'in') return Array.isArray(f.value) && f.value.includes(v); if (f.op === 'gte') return v != null && v >= f.value; if (f.op === 'lte') return v != null && v <= f.value; return false; };
  const queues = Object.freeze({
    /** visible(ctx) → WorkQueueDefinition[] the principal may open (no counts for the others, §514) */
    visible(o = {}) { const ctx = ctxOf(o); return C().workQueues.filter(q => allows(ctx, q.requiredPermissions, o).allowed); },
    definition: queueDef,
    validateQuery,
    /** view(queueId, { filters:[{field,op,value}], sort, cursor, pageSize }) → { allowed, items, nextCursor, providerStatus, lastUpdatedAt, actions } */
    async view(queueId, q = {}, o = {}) {
      const ctx = ctxOf(o), def = queueDef(queueId);
      if (!def) return err('QUEUE_UNKNOWN');
      const g = allows(ctx, def.requiredPermissions, o);
      if (!g.allowed) return err('NOT_AUTHORIZED', { reason: g.reason });
      const v = validateQuery(def, q); if (!v.ok) return Object.freeze({ ok: false, code: v.issues[0].code, message: v.issues[0].message, issues: v.issues });
      const r = await callProvider(def.provider, 'listQueueItems', queueId, { organizationId: orgOf(ctx), filters: v.filters, sort: v.sort, cursor: q.cursor || null, pageSize: v.pageSize, now: iso(o.now) });
      const raw = r.value && Array.isArray(r.value.items) ? r.value.items : [];
      // the provider (server) filters/paginates; the client re-applies allowlisted filters as a guard, never widens
      const items = sortItems(raw.map(x => normalizeItem({ ...x, queueId, provider: def.provider }, def.domain, orgOf(ctx))).filter(Boolean).filter(it => v.filters.every(f => applyFilter(it, f))), v.sort).slice(0, v.pageSize);
      const actions = def.allowedActions.map(code => actionAvailability(code, o)).filter(a => a.visible);
      return Object.freeze({ ok: true, allowed: true, queue: def, items, nextCursor: (r.value && r.value.nextCursor) || null, providerStatus: r.status, providerMessage: r.message,
        lastUpdatedAt: (r.value && r.value.lastUpdatedAt) || null, actions, emptyText: def.emptyText, ageOf: it => it.createdAt ? Math.max(0, nowMs(o.now) - nowMs(it.createdAt)) : null });
    }
  });

  // ------------------------------------------------------------------ action availability (§306-311: hide unauthorized, disable with reason)
  const actionPolicy = code => C().actions.find(a => a.actionCode === code) || null;
  function actionAvailability(code, o = {}) {
    const pol = actionPolicy(code), ctx = ctxOf(o);
    if (!pol) return Object.freeze({ actionCode: code, visible: false, enabled: false, reason: 'UNKNOWN_ACTION' });
    if (!P().has(pol.permission)) return Object.freeze({ actionCode: code, visible: false, enabled: false, reason: 'PERMISSION_NOT_REGISTERED', label: pol.label });
    const g = allows(ctx, ['backoffice.access', pol.permission], { ...o, connectivity: 'ONLINE' });
    if (!g.allowed) return Object.freeze({ actionCode: code, visible: false, enabled: false, reason: g.reason, label: pol.label });
    const conn = o.connectivity || (App.store && App.store.get ? App.store.get().connectivity : null) || 'UNKNOWN';
    if (conn === 'OFFLINE') return Object.freeze({ actionCode: code, visible: true, enabled: false, reason: 'OFFLINE', label: pol.label, message: 'Ações administrativas exigem conexão (§495).' });
    if (o.profile === 'mobile' && !pol.mobileAllowed) return Object.freeze({ actionCode: code, visible: true, enabled: false, reason: 'MOBILE_RESTRICTED', label: pol.label, message: 'Disponível apenas no computador.' });
    return Object.freeze({ actionCode: code, visible: true, enabled: true, reason: 'ALLOWED', label: pol.label, riskLevel: pol.riskLevel, requiresReason: pol.requiresReason, requiresPreview: pol.requiresPreview, requiresStepUp: pol.requiresStepUp, help: pol.help });
  }

  // ------------------------------------------------------------------ BulkActionPolicy (§29-32)
  /** bulk.evaluate(actionCode, items) → { ok, code?, requiresPreview, requiresApproval } */
  function bulkEvaluate(actionCode, items = [], o = {}) {
    const pol = C().bulkPolicies.find(b => b.actionCode === actionCode);
    if (!pol || !pol.enabled) return err('BULK_DISABLED', { actionCode });
    if (pol.maxItems == null) return err('BULK_LIMIT_NOT_CONFIGURED', { actionCode, policyStatus: C().PENDING });
    if (items.length > pol.maxItems) return err('BULK_LIMIT_EXCEEDED', { max: pol.maxItems });
    if (items.some(i => !pol.allowedStatuses.includes(i.status))) return err('BULK_STATUS_NOT_ALLOWED');
    const a = actionAvailability(actionCode, o); if (!a.enabled) return err('NOT_AUTHORIZED', { reason: a.reason });
    return Object.freeze({ ok: true, actionCode, count: items.length, requiresPreview: pol.requiresPreview, requiresApproval: pol.requiresApproval });
  }

  // ------------------------------------------------------------------ Approval Center (§33-36, §407)
  const separationOfDuties = () => { const v = C().policies.requesterCannotApprove.value; return v == null ? true : v === true; }; // null → fail closed
  function normalizeTask(raw, orgId) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.requestedBy !== 'string' || !Array.isArray(raw.decisionActions)) return null;
    if (raw.organizationId && raw.organizationId !== orgId) return null;
    if (PII_RE.test(raw.summary || '')) return null;
    return Object.freeze({ id: raw.id, domain: raw.domain || 'unknown', entityRef: raw.entityRef || null, approvalType: raw.approvalType || 'unknown', requestedBy: raw.requestedBy, requestedAt: raw.requestedAt || null,
      severity: SEVERITY[raw.severity] ? raw.severity : 'MEDIUM', summary: raw.summary || '', contextRefs: (raw.contextRefs || []).slice(), decisionActions: raw.decisionActions.slice(), expectedRevision: raw.expectedRevision || null, provider: raw.provider || null });
  }
  const approvals = Object.freeze({
    /** list() → { allowed, tasks, providers } aggregated from the providers of queues the principal may see */
    async list(o = {}) {
      const ctx = ctxOf(o), org = orgOf(ctx);
      if (!allows(ctx, ['backoffice.access', 'backoffice.inbox.view'], o).allowed) return Object.freeze({ allowed: false, tasks: [], providers: {}, message: ERR.NOT_AUTHORIZED });
      const provs = [...new Set(queues.visible(o).map(q => q.provider))], tasks = [], status = {};
      for (const name of provs) {
        const r = await callProvider(name, 'listApprovalTasks', { organizationId: org, now: iso(o.now) });
        status[name] = { status: r.status, message: r.message };
        for (const t of Array.isArray(r.value) ? r.value : []) { const n = normalizeTask({ ...t, provider: name }, org); if (n) tasks.push(n); }
      }
      tasks.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || String(a.requestedAt).localeCompare(String(b.requestedAt)));
      return Object.freeze({ allowed: true, tasks, providers: status, emptyText: 'Nenhuma aprovação pendente.' });
    },
    /** canDecide(task, actionCode) → { allowed, code } — SoD + permission; the server decides again */
    canDecide(task, actionCode = 'commercial.approval.decide', o = {}) {
      const ctx = ctxOf(o);
      if (!task || !task.decisionActions.length || (o.decision && !task.decisionActions.includes(o.decision))) return err('INVALID_ITEM');
      if (separationOfDuties() && ctx.principal && task.requestedBy === ctx.principal.id) return err('SELF_APPROVAL_FORBIDDEN');
      const a = actionAvailability(actionCode, o);
      return a.enabled ? Object.freeze({ ok: true, allowed: true }) : err('NOT_AUTHORIZED', { reason: a.reason });
    },
    separationOfDuties
  });

  // ------------------------------------------------------------------ WorkAssignment / WorkClaim (§196-207)
  const assignments = Object.freeze({
    /** assignmentCommand(item, assigneeId) → AdminCommandEnvelope input (executed by the server; never a local state change) */
    assignmentCommand(item, { assignedToUserId = null, assignedToTeamId = null } = {}) {
      return { actionCode: 'workitem.assign', resourceRef: `workitem:${item.id}`, payload: { workItemRef: item.id, assignedToUserId, assignedToTeamId } };
    },
    /** checkAssigneeCanAct(assigneePermissions[], actionCode) — §199: assigned but lacking permission → block + flag */
    checkAssigneeCanAct(assigneePermissions, actionCode) {
      const pol = actionPolicy(actionCode); if (!pol) return err('INVALID_ITEM');
      return (assigneePermissions || []).includes(pol.permission) ? Object.freeze({ ok: true }) : err('ASSIGNEE_LACKS_PERMISSION', { flag: 'ACCESS_CONFIGURATION_ISSUE', permission: pol.permission });
    },
    /** claimState(item, principalId, now) — a temporary claim (§205-207) informs; admin override follows policy */
    claimState(item, principalId, now) {
      const c = item && item.claim; if (!c || !c.expiresAt || nowMs(c.expiresAt) <= nowMs(now)) return { claimed: false };
      return c.claimedBy === principalId ? { claimed: true, mine: true, expiresAt: c.expiresAt } : { claimed: true, mine: false, expiresAt: c.expiresAt, code: 'CLAIM_HELD', message: ERR.CLAIM_HELD };
    }
  });

  // ------------------------------------------------------------------ config validation
  function validateConfig() {
    const errs = [], E = (code, m) => errs.push({ code, message: m }), cfg = C();
    const ids = new Set();
    for (const n of cfg.navigation) { if (ids.has(n.id)) E('DUPLICATE_NAV', n.id); ids.add(n.id); if (!n.requiredPermissions.length) E('NAV_WITHOUT_PERMISSION', n.id); for (const k of n.requiredPermissions) if (!P().has(k)) E('NAV_UNKNOWN_PERMISSION', `${n.id}: ${k}`); }
    for (const q of cfg.workQueues) { if (!cfg.providers.includes(q.provider)) E('QUEUE_UNKNOWN_PROVIDER', q.id); for (const k of q.requiredPermissions) if (!P().has(k)) E('QUEUE_UNKNOWN_PERMISSION', `${q.id}: ${k}`); for (const a of q.allowedActions) if (!actionPolicy(a)) E('QUEUE_UNKNOWN_ACTION', `${q.id}: ${a}`); if (!cfg.queryPolicies.sorts[q.sortPolicy]) E('QUEUE_SORT_POLICY', q.id); }
    for (const a of cfg.actions) { if (!['MEDIUM', 'HIGH', 'CRITICAL', 'LOW'].includes(a.riskLevel)) E('ACTION_RISK', a.actionCode); if (a.riskLevel === 'CRITICAL' && !a.requiresReason) E('CRITICAL_WITHOUT_REASON', a.actionCode); if (a.riskLevel === 'CRITICAL' && !a.requiresPreview) E('CRITICAL_WITHOUT_PREVIEW', a.actionCode); }
    for (const b of cfg.bulkPolicies) if (!actionPolicy(b.actionCode)) E('BULK_UNKNOWN_ACTION', b.actionCode); else if (['HIGH', 'CRITICAL'].includes(actionPolicy(b.actionCode).riskLevel) && b.enabled && !b.requiresPreview) E('BULK_HIGH_RISK_WITHOUT_PREVIEW', b.actionCode);
    for (const [k, p] of Object.entries(cfg.policies)) if (p.value == null && p.status !== cfg.PENDING) E('POLICY_STATUS', k);
    return errs;
  }
  /** unregisteredPermissions() — permission keys referenced by actions that the registry does not know yet (always denied) */
  const unregisteredPermissions = () => [...new Set(C().actions.map(a => a.permission).filter(k => !P().has(k)))].sort();

  // not frozen: backofficeCommands.js / backofficeGovernance.js attach commands / governance (each frozen)
  return ({ SEVERITY, SEVERITY_ORDER, SEVERITY_LABEL, SEVERITY_ICON, INBOX_STATUS, INBOX_STATUS_LABEL, PROVIDER_STATUS, PROVIDER_MESSAGE, ASSIGNMENT_STATUS, ERR,
    allows, entryVisible, shellContext, navigation, registerModule, modules: () => [...modules.values()], registerProvider, unregisterProvider, provider, callProvider,
    inbox, queues, actionPolicy, actionAvailability, bulk: Object.freeze({ evaluate: bulkEvaluate }), approvals, assignments, validateConfig, unregisteredPermissions, PII_RE });
})();
