/* customer/customerRepository.js — topic 39: tenant-aware repositories and application services.

   MemoryCustomerStore keeps customer data IN MEMORY ONLY (never localStorage/IndexedDB: Customer data is PII and the
   offline policy defaults to no cache). Logout / tenant switch → clear(). The frontend copy is a convenience, never
   the authority: in server mode the same interfaces are served by ApiCustomerRepository, and the backend re-authorizes
   every call. Every service call checks permissions first (deny by default) and writes a PII-free audit line.

   Repositories: CustomerRepository · CustomerPreferenceProfileRepository · CustomerContactRepository ·
   CustomerAssignmentRepository · CustomerDuplicateRepository · CustomerMergeRepository.
   Services: CustomerApplicationService · CustomerProfileApplicationService · CustomerAssignmentService ·
   CustomerSearchService · CustomerDuplicateService · CustomerMergeService · CustomerIngestionService. */
App.customer = App.customer || {};
App.customer.repo = (() => {
  const D = () => App.customer.domain;
  const conflict = (cur) => Object.freeze({ ok: false, code: 'CUSTOMER_REVISION_CONFLICT', message: D().MESSAGES.CUSTOMER_REVISION_CONFLICT, currentRevision: cur });
  function MemoryCustomerStore() {
    const T = () => ({ customers: new Map(), details: new Map(), contacts: new Map(), assignments: new Map(), comms: new Map(), privacy: new Map(), profiles: new Map(), versions: new Map(),
      snapshots: new Map(), aliases: new Map(), duplicates: new Map(), merges: new Map(), favorites: new Map(), ingestionKeys: new Map() });
    let orgs = new Map();
    const of = org => { if (!org) throw Object.assign(new Error('organizationId obrigatório'), { code: 'MISSING_ORGANIZATION' }); if (!orgs.has(org)) orgs.set(org, T()); return orgs.get(org); };
    return Object.freeze({ of, clear() { orgs = new Map(); }, organizations: () => [...orgs.keys()] });
  }
  const vals = m => [...m.values()];
  const req = ctx => { if (!ctx || !ctx.organizationId) throw Object.assign(new Error('contexto sem organização'), { code: 'MISSING_ORGANIZATION' }); return ctx.organizationId; };

  function CustomerRepository(store) {
    const t = ctx => store.of(req(ctx));
    return Object.freeze({
      async getById(ctx, id) { const r = t(ctx).customers.get(id); return r && r.organizationId === ctx.organizationId ? r : null; },
      async getByIds(ctx, ids) { const m = t(ctx).customers; return (ids || []).map(id => m.get(id)).filter(Boolean); },
      async list(ctx) { return vals(t(ctx).customers); },
      async search(ctx, query, opts = {}) { const x = t(ctx); return D().search({ customers: vals(x.customers), contacts: vals(x.contacts) }, query, opts); },
      async save(ctx, customer, expectedRevision) {
        if (customer.organizationId !== ctx.organizationId) return Object.freeze({ ok: false, code: 'CROSS_TENANT' });
        const m = t(ctx).customers, cur = m.get(customer.id);
        if (cur ? expectedRevision !== cur.recordRevision || customer.recordRevision !== cur.recordRevision + 1 : expectedRevision != null) return conflict(cur ? cur.recordRevision : null);
        m.set(customer.id, customer); return Object.freeze({ ok: true, customer });
      },
      async archive(ctx, id, expectedRevision, opts = {}) { const cur = t(ctx).customers.get(id); if (!cur) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const r = D().archive(cur, { ...opts, expectedRevision }); if (!r.ok) return r; return this.save(ctx, r.customer, expectedRevision); },
      async resolveAlias(ctx, id) { return D().resolveAlias(vals(t(ctx).aliases), id); }
    });
  }
  function CustomerPreferenceProfileRepository(store) {
    const t = ctx => store.of(req(ctx));
    return Object.freeze({
      async getProfile(ctx, customerId) { return vals(t(ctx).profiles).find(p => p.customerId === customerId) || null; },
      async saveProfile(ctx, p) { t(ctx).profiles.set(p.id, p); return p; },
      async getVersion(ctx, id) { return t(ctx).versions.get(id) || null; },
      async listVersions(ctx, customerId) { return vals(t(ctx).versions).filter(v => v.customerId === customerId).sort((a, b) => a.version - b.version); },
      /** append-only: an existing version id can never be overwritten */
      async appendVersion(ctx, v) { const m = t(ctx).versions; if (m.has(v.id)) return Object.freeze({ ok: false, code: 'IMMUTABLE_VERSION' }); m.set(v.id, v); return Object.freeze({ ok: true, version: v }); },
      async saveSnapshot(ctx, s) { t(ctx).snapshots.set(s.id, s); return s; },
      async getSnapshot(ctx, id) { return t(ctx).snapshots.get(id) || null; }
    });
  }
  const simpleRepo = key => store => { const t = ctx => store.of(req(ctx))[key]; return Object.freeze({
    async list(ctx, customerId) { return vals(t(ctx)).filter(x => customerId == null || x.customerId === customerId); },
    async save(ctx, x) { t(ctx).set(x.id, x); return x; },
    async saveAll(ctx, xs) { for (const x of xs) t(ctx).set(x.id, x); return xs; } }); };
  const CustomerContactRepository = simpleRepo('contacts'), CustomerAssignmentRepository = simpleRepo('assignments');
  function CustomerDuplicateRepository(store) { const t = ctx => store.of(req(ctx)).duplicates; return Object.freeze({ async list(ctx) { return vals(t(ctx)); }, async save(ctx, d) { t(ctx).set(d.id, d); return d; } }); }
  function CustomerMergeRepository(store) { const t = ctx => store.of(req(ctx)).merges; return Object.freeze({ async list(ctx) { return vals(t(ctx)); }, async save(ctx, m) { t(ctx).set(m.id, m); return m; } }); }

  /** ApiCustomerRepository — server-mode contract (topic 39 §58). PII never goes in a URL: search is POST with a body. */
  function ApiCustomerRepository({ baseUrl, fetch: f = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
    const url = (ctx, p) => `${baseUrl}/api/v1/organizations/${encodeURIComponent(req(ctx))}${p}`;
    const call = async (u, init = {}) => { const r = await f(u, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } }); if (r.status === 404 || r.status === 403) return null; if (r.status === 409) return conflict(null); return r.ok ? r.json() : null; };
    return Object.freeze({
      getById: (ctx, id) => call(url(ctx, `/customers/${encodeURIComponent(id)}`)),
      search: (ctx, query) => call(url(ctx, '/customers/search'), { method: 'POST', body: JSON.stringify(query) }),
      save: (ctx, c, expectedRevision) => call(url(ctx, `/customers/${encodeURIComponent(c.id)}`), { method: 'PATCH', headers: { 'If-Match': String(expectedRevision) }, body: JSON.stringify({ displayName: c.displayName, expectedRevision }) }),
      archive: (ctx, id, expectedRevision) => call(url(ctx, `/customers/${encodeURIComponent(id)}/archive`), { method: 'POST', body: JSON.stringify({ expectedRevision }) }),
      resolveAlias: async (ctx, id) => { const r = await call(url(ctx, `/customers/${encodeURIComponent(id)}`)); return r && r.customerId ? r.customerId : id; }
    });
  }

  /** services(store, { principal: { userId, organizationId, teamIds }, can, now, idGen }) → application services */
  function services(store, env = {}) {
    const ctx = { organizationId: env.principal && env.principal.organizationId }, can = env.can || (() => false), dom = D();
    const repos = { customers: CustomerRepository(store), profiles: CustomerPreferenceProfileRepository(store), contacts: CustomerContactRepository(store), assignments: CustomerAssignmentRepository(store), duplicates: CustomerDuplicateRepository(store), merges: CustomerMergeRepository(store) };
    const audit = [], O = () => ({ now: env.now ? env.now() : undefined, idGen: env.idGen, actorId: env.principal && env.principal.userId, organizationId: ctx.organizationId });
    const log = (op, data) => { audit.push(dom.logEntry(op, data)); };
    const deny = (op, customerId) => { log(op, { customerId, status: 'DENIED' }); return Object.freeze({ ok: false, code: 'NOT_FOUND', message: dom.MESSAGES.NOT_FOUND }); };
    const allAssignments = async () => repos.assignments.list(ctx);
    async function access(customerId) {
      if (!ctx.organizationId) return { customer: null, decision: dom.decideAccess({}) };
      const id = await repos.customers.resolveAlias(ctx, customerId), c = await repos.customers.getById(ctx, id);
      return { customer: c, decision: dom.decideAccess({ customer: c, principal: env.principal, assignments: await allAssignments(), can }) };
    }
    const world = async () => { const x = store.of(ctx.organizationId); return { customers: vals(x.customers), contacts: vals(x.contacts), assignments: vals(x.assignments), aliases: vals(x.aliases), favorites: vals(x.favorites), mergeRecords: vals(x.merges), ingestionKeys: x.ingestionKeys }; };
    async function persistCreated(r) {
      await repos.customers.save(ctx, r.customer); await repos.contacts.saveAll(ctx, r.contactPoints); await repos.assignments.saveAll(ctx, r.assignments);
      store.of(ctx.organizationId).privacy.set(r.privacyProfile.id, r.privacyProfile); store.of(ctx.organizationId).details.set(r.customer.id, r.details);
    }
    const app = Object.freeze({
      async create(input) {
        if (!ctx.organizationId || !can('customer.create')) return deny('customer.create', null);
        const w = await world(), vis = id => { const c = w.customers.find(x => x.id === id); return !!c && dom.decideAccess({ customer: c, principal: env.principal, assignments: w.assignments, can }).allowed; };
        const r = dom.createCustomer({ ...input, ownerUserId: input.ownerUserId || (env.principal && env.principal.userId) }, { ...O(), existing: { customers: w.customers, contacts: w.contacts }, isVisible: vis });
        if (!r.ok) { log('customer.create', { status: 'REJECTED', codes: [r.code] }); return r; }
        await persistCreated(r); log('customer.create', { customerId: r.customer.id, codes: r.duplicateWarnings.map(x => x.code) });
        return Object.freeze({ ok: true, customerId: r.customer.id, duplicateWarnings: r.duplicateWarnings, events: r.events });
      },
      async get(customerId, mode = 'SUMMARY') {
        const { customer, decision } = await access(customerId); if (!decision.allowed) return deny('customer.read', customerId);
        const x = store.of(ctx.organizationId), v = customer.currentPreferenceProfileVersionId ? x.versions.get(customer.currentPreferenceProfileVersionId) : null;
        const favs = vals(x.favorites).filter(f => f.contextType === 'CUSTOMER' && f.contextRef === customer.id).length;
        return Object.freeze({ ok: true, decision, view: dom.project({ customer, details: x.details.get(customer.id), contacts: await repos.contacts.list(ctx, customer.id), assignments: await repos.assignments.list(ctx, customer.id), privacy: vals(x.privacy).find(p => p.customerId === customer.id), profileVersion: v, favoriteCount: favs }, mode, decision) });
      },
      async rename(customerId, displayName, expectedRevision) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !decision.canWrite) return deny('customer.update', customerId);
        const r = dom.updateCustomer(customer, { displayName }, { ...O(), expectedRevision }); if (!r.ok || r.unchanged) return r;
        const s = await repos.customers.save(ctx, r.customer, expectedRevision); log('customer.update', { customerId, status: s.ok ? 'OK' : s.code }); return s.ok ? r : s;
      },
      async archive(customerId, expectedRevision) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !can('customer.archive')) return deny('customer.archive', customerId);
        const s = await repos.customers.archive(ctx, customer.id, expectedRevision, O()); log('customer.archive', { customerId, status: s.ok ? 'OK' : s.code }); return s;
      },
      async addContact(customerId, input) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !can('customer.contact.update')) return deny('customer.contact.update', customerId);
        const r = dom.addContactPoint(customer, input, O()); if (r.ok) await repos.contacts.save(ctx, r.contact); log('customer.contact.add', { customerId, status: r.ok ? 'OK' : r.code }); return r;
      }
    });
    const profile = Object.freeze({
      async save(customerId, input, opts = {}) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !decision.canWrite || !can('customer.profile.update')) return deny('customer.profile.update', customerId);
        if (opts.expectedRevision != null && opts.expectedRevision !== customer.recordRevision) return conflict(customer.recordRevision);
        const prof = (await repos.profiles.getProfile(ctx, customer.id)) || dom.createPreferenceProfile(customer, O());
        const prev = prof.currentVersionId ? await repos.profiles.getVersion(ctx, prof.currentVersionId) : null;
        const r = dom.createProfileVersion({ profile: prof, previous: prev, input }, { ...O(), developmentId: opts.developmentId });
        if (!r.ok || r.unchanged) return r;
        const a = await repos.profiles.appendVersion(ctx, r.version); if (!a.ok) return a;
        await repos.profiles.saveProfile(ctx, r.profile);
        const u = dom.updateCustomer(customer, { currentPreferenceProfileVersionId: r.version.id }, { ...O(), expectedRevision: customer.recordRevision });
        await repos.customers.save(ctx, u.customer, customer.recordRevision); log('customer.profile.update', { customerId, codes: ['V' + r.version.version] });
        return Object.freeze({ ok: true, version: r.version, warnings: r.warnings, events: r.events });
      },
      async versions(customerId) { const { decision } = await access(customerId); if (!decision.allowed || decision.accessLevel === 'SUMMARY') return []; return repos.profiles.listVersions(ctx, customerId); },
      /** snapshot(customerId, purpose) → { snapshot, fitProfile, constraints, refs } — the exact version used by Fit / Recommendation */
      async snapshot(customerId, purpose = 'FIT', opts = {}) {
        const { customer, decision } = await access(customerId); if (!decision.allowed) return deny('customer.profile.read', customerId);
        const v = customer.currentPreferenceProfileVersionId ? await repos.profiles.getVersion(ctx, customer.currentPreferenceProfileVersionId) : null;
        if (!v) return Object.freeze({ ok: false, code: 'NO_PROFILE' });
        const s = await repos.profiles.saveSnapshot(ctx, dom.createSnapshot(v, customer, purpose, O())), fp = dom.toFitProfile(v, { developmentId: opts.developmentId });
        return Object.freeze({ ok: true, snapshot: s, version: v, fitProfile: fp, constraints: dom.toRecommendationConstraints(v), refs: dom.resultRefs(s, fp) });
      }
    });
    const assignment = Object.freeze({
      async assign(customerId, input) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !can('customer.assign')) return deny('customer.assign', customerId);
        const r = dom.assign(customer, input, { ...O(), current: await repos.assignments.list(ctx, customer.id) }); if (!r.ok) return r;
        await repos.assignments.saveAll(ctx, [...r.ended, r.assignment]); log('customer.assign', { customerId, codes: [input.role] }); return r;
      }
    });
    const seq = App.customer.context ? App.customer.context.sequencer() : null;
    const searchSvc = Object.freeze({
      /** search(query) — only the latest call resolves with results; older ones resolve { superseded: true } */
      async search(query = {}) {
        const ticket = seq && seq.next(); if (!ctx.organizationId || !(can('customer.read') || can('customer.readAssigned'))) return deny('customer.search', null);
        const asg = await allAssignments();
        const r = await repos.customers.search(ctx, query, { can, decide: c => dom.decideAccess({ customer: c, principal: env.principal, assignments: asg, can }) });
        if (env.delay) await env.delay(query);
        log('customer.search', { status: r.ok ? 'OK' : r.code, codes: [r.logSafe.kind] }); // the query text itself is never logged
        if (ticket && !ticket.isCurrent()) return Object.freeze({ ok: true, superseded: true, results: [] });
        return r;
      }
    });
    const duplicates = Object.freeze({
      async scan() {
        if (!ctx.organizationId || !can('customer.duplicate.review')) return deny('customer.duplicate.scan', null);
        const w = await world(), prior = await repos.duplicates.list(ctx), found = dom.detectDuplicates({ customers: w.customers, contacts: w.contacts }, { ...O(), existing: prior });
        for (const d of found) await repos.duplicates.save(ctx, d); log('customer.duplicate.scan', { codes: ['FOUND_' + found.length] }); return Object.freeze({ ok: true, candidates: found });
      },
      async review(candidateId, status) {
        if (!can('customer.duplicate.review')) return deny('customer.duplicate.review', null);
        const c = (await repos.duplicates.list(ctx)).find(d => d.id === candidateId); if (!c) return Object.freeze({ ok: false, code: 'NOT_FOUND' });
        const r = dom.reviewDuplicate(c, status, O()); if (r.ok) await repos.duplicates.save(ctx, r.candidate); return r;
      }
    });
    const mergeSvc = Object.freeze({
      async merge(cmd) {
        if (!ctx.organizationId || !can('customer.merge')) return deny('customer.merge', cmd && cmd.targetCustomerId);
        const w = await world(), r = dom.merge(cmd, w, O()); if (!r.ok || r.replay) { log('customer.merge', { customerId: cmd.targetCustomerId, status: r.ok ? 'REPLAY' : r.code }); return r; }
        const x = store.of(ctx.organizationId);
        for (const c of [r.target, ...r.sources]) x.customers.set(c.id, c);
        for (const c of r.contacts) x.contacts.set(c.id, c); for (const a of r.assignments) x.assignments.set(a.id, a); for (const f of r.favorites) x.favorites.set(f.id, f);
        x.aliases = new Map(r.aliases.map(a => [a.aliasCustomerId, a])); await repos.merges.save(ctx, r.record);
        for (const d of vals(x.duplicates)) if ([d.customerIdA, d.customerIdB].every(id => id === r.target.id || r.record.sourceCustomerIds.includes(id))) x.duplicates.set(d.id, { ...d, status: 'MERGED' });
        log('customer.merge', { customerId: r.target.id, codes: [cmd.reasonCode] }); return r;
      }
    });
    const ingestion = Object.freeze({
      async ingest(obs) {
        if (!ctx.organizationId || !can('customer.create')) return deny('customer.ingest', null);
        const x = store.of(ctx.organizationId), r = dom.ingest(obs, await world(), O()); if (!r.ok || r.action === 'REPLAY') return r;
        if (r.action === 'CREATED') { await persistCreated({ ...r.created, customer: r.created.customer }); for (const d of r.duplicateCandidates) await repos.duplicates.save(ctx, d); }
        if (r.ingestionKey) x.ingestionKeys.set(r.ingestionKey, r.customerId);
        log('customer.ingest', { customerId: r.customerId, codes: [r.action] }); return r;
      }
    });
    /** favorites in CUSTOMER context (topic 38 contract): contextRef always resolves to the canonical customer */
    const favorites = Object.freeze({
      async add(customerId, lotId) { const { customer, decision } = await access(customerId); if (!decision.allowed) return deny('customer.favorite', customerId); const f = Object.freeze({ id: 'fav_' + App.methodology.checksum([customer.id, lotId]), ...dom.favoriteContext(customer.id), lotId }); store.of(ctx.organizationId).favorites.set(f.id, f); return Object.freeze({ ok: true, favorite: f }); },
      async list(customerId) { const id = await repos.customers.resolveAlias(ctx, customerId); return vals(store.of(ctx.organizationId).favorites).filter(f => f.contextType === 'CUSTOMER' && f.contextRef === id); },
      async resolveContext(contextRef) { return repos.customers.resolveAlias(ctx, contextRef); }
    });
    return Object.freeze({ repos, application: app, profile, assignment, search: searchSvc, duplicates, merge: mergeSvc, ingestion, favorites, audit: () => audit.slice(), access });
  }
  return Object.freeze({ MemoryCustomerStore, CustomerRepository, CustomerPreferenceProfileRepository, CustomerContactRepository, CustomerAssignmentRepository, CustomerDuplicateRepository, CustomerMergeRepository, ApiCustomerRepository, services });
})();
