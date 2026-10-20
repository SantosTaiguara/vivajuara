/* backoffice/backofficeAdapters.js — round 6: the BackofficeProviderAdapter of deals (57), onboarding (58), privacy (59) and
   dataquality (61) for the admin shell (dash/admin.html only; never in the public panel). Contract: top of backoffice/backofficeCore.js
   (listInboxItems, listQueueItems, listApprovalTasks). Rules:
   - the data comes only from the organization's server (App.authz.backendBaseUrl(), session cookie, X-Organization-Id); without a
     server every method fails with BACKEND_UNAVAILABLE and the console says so: never an example, cached or invented item;
   - a queue whose server contract has no list endpoint yet (proposals, reservations, closings, onboarding batches, data conflicts,
     privacy incidents) fails with LIST_CONTRACT_MISSING ("contrato pendente"), even with a server;
   - projections carry ids, enums, dates and generic titles only (no subject, customer or contact data; backofficeCore drops PII);
   - severities are a fixed technical mapping of each domain's own enum (dataquality BLOCKING → CRITICAL …); a domain without a
     severity (privacy requests) is INFO, never an invented urgency. Deadlines (dueAt) only when the server sends them.
   Registered with App.backoffice.registerProvider(name, adapter) and exposed as App.<module>.backofficeAdapter when that module exists. */
App.backofficeAdapters = (() => {
  const fail = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });
  const base = () => { try { return App.authz && App.authz.backendBaseUrl ? App.authz.backendBaseUrl() : null; } catch (e) { return null; } };
  let fetchImpl = null; // injectable for tests
  const doFetch = (...a) => (fetchImpl || (typeof fetch === 'function' ? fetch : null))(...a);
  /** apiGet(path, organizationId) → body.data of the server envelope; BACKEND_UNAVAILABLE / NOT_AUTHORIZED / PROVIDER_ERROR otherwise */
  async function apiGet(p, organizationId) {
    const b = base(); if (!b) throw fail('BACKEND_UNAVAILABLE');
    if (!fetchImpl && typeof fetch !== 'function') throw fail('BACKEND_UNAVAILABLE');
    let res;
    try { res = await doFetch(b.replace(/\/$/, '') + p, { method: 'GET', credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json', ...(organizationId ? { 'X-Organization-Id': organizationId } : {}) } }); }
    catch (e) { throw fail('BACKEND_UNAVAILABLE'); }
    if (res.status === 401 || res.status === 403) throw fail('NOT_AUTHORIZED', { status: res.status });
    if (!res.ok) throw fail('PROVIDER_ERROR', { status: res.status });
    let body = null; try { body = await res.json(); } catch (e) { throw fail('PROVIDER_ERROR'); }
    return body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
  }
  const list = d => (Array.isArray(d) ? d : d && Array.isArray(d.items) ? d.items : []);
  const safeId = v => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,120}$/.test(v) ? v : null);
  const iso = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null);

  // ------------------------------------------------------------------ projections (server record → OperationalInboxItem)
  const PRIVACY_STATUS = { RECEIVED: 'OPEN', COMPLETED: 'RESOLVED', CANCELLED: 'DISMISSED', DENIED_WITH_REASON: 'DISMISSED' };
  const PRIVACY_TYPE = { ACCESS: 'acesso', CORRECTION: 'correção', DELETION: 'eliminação', PORTABILITY: 'portabilidade', OBJECTION: 'oposição', CONSENT_WITHDRAWAL: 'revogação de consentimento', INFORMATION: 'informação' };
  function privacyRequestItem(r, organizationId) {
    const id = safeId(r && r.id); if (!id) return null;
    const kind = PRIVACY_TYPE[r.requestType] || 'titular';
    return { id: 'privacy:' + id, organizationId: r.organizationId || organizationId, type: 'privacy_request', domain: 'privacy', severity: 'INFO', status: PRIVACY_STATUS[r.status] || 'IN_PROGRESS',
      title: `Solicitação de titular (${kind})`, description: `Etapa: ${String(r.status || '').replace(/[^A-Z_]/g, '') || 'não informada'}`, queueId: 'privacy.subject_requests',
      createdAt: iso(r.receivedAt) || iso(r.createdAt), updatedAt: iso(r.updatedAt) || iso(r.receivedAt), dueAt: iso(r.dueAt) || iso(r.deadline && r.deadline.dueAt), overdue: r.overdue === true,
      actionRoute: `/admin/privacy/requests/${id}` };
  }
  const DQ_SEVERITY = { INFO: 'INFO', WARNING: 'MEDIUM', ERROR: 'HIGH', BLOCKING: 'CRITICAL' };
  const DQ_STATUS = { OPEN: 'OPEN', ACKNOWLEDGED: 'IN_PROGRESS', IN_REMEDIATION: 'IN_PROGRESS', RESOLVED: 'RESOLVED', ACCEPTED_EXCEPTION: 'DISMISSED', FALSE_POSITIVE: 'DISMISSED' };
  function dqFindingItem(f, organizationId) {
    const id = safeId(f && f.id); if (!id || !DQ_SEVERITY[f.severity]) return null;
    return { id: 'dq:' + id, organizationId: f.organizationId || organizationId, type: 'quality_blocker', domain: 'data', severity: DQ_SEVERITY[f.severity], status: DQ_STATUS[f.status] || 'OPEN',
      title: `Bloqueio de qualidade ${safeId(f.ruleId) || ''}`.trim(), description: f.dataDomainId ? `Domínio: ${String(f.dataDomainId).replace(/[^A-Za-z0-9_.-]/g, '')}` : null, queueId: 'data.quality_blockers',
      createdAt: iso(f.firstSeenAt) || iso(f.detectedAt) || iso(f.createdAt), updatedAt: iso(f.lastSeenAt) || iso(f.updatedAt), dueAt: iso(f.dueAt), overdue: f.overdue === true,
      actionRoute: `/admin/data/quality/${id}` };
  }

  // ------------------------------------------------------------------ queue sources per provider
  /** queueId → async (organizationId) → items; null = the server has no list contract for that queue yet */
  const SOURCES = {
    deals: { 'commercial.approvals': null, 'commercial.proposals': null, 'commercial.reservations_expiring': null, 'commercial.closings_blocked': null },
    onboarding: { 'data.onboarding': null, 'data.mappings_pending': null, 'data.publications_pending': null },
    privacy: {
      'privacy.subject_requests': async org => list(await apiGet('/api/v1/admin/privacy/requests', org)).map(r => privacyRequestItem(r, org)).filter(Boolean),
      'privacy.incidents': null
    },
    dataquality: {
      'data.quality_blockers': async org => list(await apiGet('/api/v1/admin/data-quality/findings?severity=BLOCKING', org)).filter(f => f && f.severity === 'BLOCKING').map(f => dqFindingItem(f, org)).filter(Boolean),
      'data.conflicts': null
    }
  };
  function adapter(name) {
    const src = SOURCES[name];
    async function listQueueItems(queueId, o = {}) {
      if (!base()) throw fail('BACKEND_UNAVAILABLE');
      if (!Object.prototype.hasOwnProperty.call(src, queueId)) throw fail('QUEUE_UNKNOWN');
      const fn = src[queueId]; if (!fn) throw fail('LIST_CONTRACT_MISSING', { queueId });
      return { items: await fn(o.organizationId), nextCursor: null, lastUpdatedAt: new Date(o.now || Date.now()).toISOString() };
    }
    async function listInboxItems(o = {}) {
      if (!base()) throw fail('BACKEND_UNAVAILABLE');
      const ready = Object.entries(src).filter(([, fn]) => fn);
      if (!ready.length) throw fail('LIST_CONTRACT_MISSING');
      const out = []; for (const [, fn] of ready) out.push(...await fn(o.organizationId));
      return out;
    }
    /** approval tasks: the commercial approval list has no server contract yet; the other domains have no approval tasks */
    async function listApprovalTasks() {
      if (!base()) throw fail('BACKEND_UNAVAILABLE');
      if (name === 'deals') throw fail('LIST_CONTRACT_MISSING', { queueId: 'commercial.approvals' });
      return [];
    }
    return Object.freeze({ id: name, version: 'r6.1', listInboxItems, listQueueItems, listApprovalTasks });
  }
  const NAMESPACE = { deals: 'deals', onboarding: 'onboarding', privacy: 'privacy', dataquality: 'dataQuality' };
  const adapters = Object.freeze(Object.fromEntries(Object.keys(SOURCES).map(n => [n, adapter(n)])));
  /** install() — registers the four adapters (idempotent) */
  function install() {
    if (!App.backoffice) return false;
    for (const [n, ad] of Object.entries(adapters)) {
      App.backoffice.registerProvider(n, ad);
      const ns = App[NAMESPACE[n]]; if (ns && typeof ns === 'object' && !Object.isFrozen(ns)) { try { ns.backofficeAdapter = ad; } catch (e) { /* frozen namespace: registry is enough */ } }
    }
    return true;
  }
  install();
  return Object.freeze({ adapters, install, apiGet, privacyRequestItem, dqFindingItem, SOURCES, setFetch: f => { fetchImpl = f || null; } });
})();
