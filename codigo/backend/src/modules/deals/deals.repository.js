'use strict';
/* DealsStore — persistence of the topic 57 aggregates behind ONE interface, two implementations:
     createMemoryDealsStore({ App, availability })  DB-free tests / local experiments (serialized transactions with
                                                     rollback = same atomicity contract as Postgres)
     createPgDealsStore(pool, { App })              migration 011 (NOT executed here: no database password in this
                                                     environment; SQL is generated from TABLES, whose columns a test
                                                     checks against migrations/011_deals.sql)
   store.transaction(async tx => …) — everything inside commits or rolls back together (§61, §118):
     tx.get(kind, id) · tx.insert(kind, e) · tx.update(kind, e, expectedRevision) (optimistic: REVISION_CONFLICT)
     tx.find(kind, where) (equality / IN on mapped columns)
     tx.idemGet(scope, key) · tx.idemPut(scope, key, record)                  idempotency of critical writes (§65, §189)
     tx.audit(event) · tx.outbox(event)                                       audit_log (ids/codes only) · outbox (§119)
     tx.lockLot(devId, lotId) → AvailabilityState | null                     row lock on lot_availability
     tx.transitionLot(devId, lotId, to, ctx) → AvailabilityState             shared state machine (App.availability)
   Every row carries organization_id (tenant scoping §261); the service filters by it and answers 404 otherwise. */
const { withTransaction } = require('../../shared/db/pool');
const { insertAudit } = require('../../shared/db/audit.repository');
const avRepo = require('../availability/availability.repository');
const { DealError } = require('./deals.domain');

/** kind → table + indexed columns (the full aggregate is kept in `data` JSONB; indexed columns drive constraints) */
const TABLES = Object.freeze({
  proposal: { table: 'deal_proposals', cols: { developmentId: 'development_id', customerId: 'customer_id', lotId: 'lot_id', status: 'status' } },
  proposalVersion: { table: 'deal_proposal_versions', cols: { proposalId: 'proposal_id', versionNumber: 'version_number', status: 'status', checksum: 'checksum' } },
  acceptance: { table: 'deal_proposal_acceptances', cols: { proposalId: 'proposal_id', proposalVersionId: 'proposal_version_id' } },
  negotiation: { table: 'deal_negotiations', cols: { proposalId: 'proposal_id', status: 'status' } },
  negotiationEvent: { table: 'deal_negotiation_events', cols: { negotiationId: 'negotiation_id', eventType: 'event_type' } },
  approval: { table: 'deal_approval_requests', cols: { proposalId: 'proposal_id', proposalVersionId: 'proposal_version_id', status: 'status', approvalType: 'approval_type', reservationId: 'reservation_id' } },
  reservation: { table: 'deal_reservations', cols: { developmentId: 'development_id', lotId: 'lot_id', customerId: 'customer_id', proposalId: 'proposal_id', status: 'status', expiresAt: 'expires_at' } },
  reservationExtension: { table: 'deal_reservation_extensions', cols: { reservationId: 'reservation_id' } },
  closing: { table: 'deal_closing_cases', cols: { developmentId: 'development_id', lotId: 'lot_id', proposalId: 'proposal_id', reservationId: 'reservation_id', status: 'status' } },
  checklistItem: { table: 'deal_closing_checklist_items', cols: { closingCaseId: 'closing_case_id', code: 'code', status: 'status' } },
  manualConfirmation: { table: 'deal_manual_confirmations', cols: { closingCaseId: 'closing_case_id', code: 'code' } },
  contract: { table: 'deal_contracts', cols: { closingCaseId: 'closing_case_id', status: 'status' } },
  contractVersion: { table: 'deal_contract_versions', cols: { contractId: 'contract_id', versionNumber: 'version_number', status: 'status' } },
  envelope: { table: 'deal_signature_envelopes', cols: { contractVersionId: 'contract_version_id', provider: 'provider', externalEnvelopeId: 'external_envelope_id', status: 'status' } },
  webhookEvent: { table: 'deal_signature_webhook_events', cols: { provider: 'provider', externalEventId: 'external_event_id' } },
  saleOutcome: { table: 'deal_sale_outcomes', cols: { closingCaseId: 'closing_case_id', outcome: 'outcome' } },
  commercialCase: { table: 'deal_commercial_cases', cols: { developmentId: 'development_id', customerId: 'customer_id', lotId: 'lot_id', proposalId: 'proposal_id', phase: 'phase' } },
  externalCommand: { table: 'deal_external_commands', cols: { aggregateId: 'aggregate_id', status: 'status' } },
  conflict: { table: 'deal_commercial_conflicts', cols: { domain: 'domain', status: 'status' } },
  notificationIntent: { table: 'deal_notification_intents', cols: { type: 'type' } }
});

const copy = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
const conflict = (kind, id, expected, current) => new DealError('REVISION_CONFLICT', { kind, id, expectedRevision: expected, currentRevision: current });
const matches = (e, where) => Object.entries(where).every(([k, v]) => (Array.isArray(v) ? v.includes(e[k]) : e[k] === v));

// ---------------------------------------------------------------------------------------------- memory
/** availability: initial lot states { [lotId]: { developmentId, status, revision, updatedAt } } (UNKNOWN by default) */
function createMemoryDealsStore({ App, availability = {} } = {}) {
  const AV = App && App.availability;
  let state = { rows: Object.fromEntries(Object.keys(TABLES).map(k => [k, {}])), idem: {}, lots: copy(availability), devRevision: {} };
  const audit = [], outbox = [], history = [];
  let chain = Promise.resolve();
  function makeTx(s, pending) {
    const T = kind => { if (!TABLES[kind]) throw new Error(`unknown kind ${kind}`); return s.rows[kind]; };
    return {
      async get(kind, id) { return copy(T(kind)[id] || null); },
      async insert(kind, e) { if (T(kind)[e.id]) throw new Error(`duplicate ${kind} ${e.id}`); const row = { ...copy(e), revision: e.revision || 1 }; T(kind)[e.id] = row; return copy(row); },
      async update(kind, e, expectedRevision) {
        const cur = T(kind)[e.id]; if (!cur) throw conflict(kind, e.id, expectedRevision, null);
        if (cur.revision !== expectedRevision) throw conflict(kind, e.id, expectedRevision, cur.revision);
        const row = { ...copy(e), revision: expectedRevision + 1 }; T(kind)[e.id] = row; return copy(row);
      },
      async find(kind, where = {}) {
        // same contract as Postgres: only indexed columns (+ id / organizationId) may be filtered on
        for (const k of Object.keys(where)) if (!['id', 'organizationId'].includes(k) && !TABLES[kind].cols[k]) throw new Error(`${kind}.${k} is not an indexed column`);
        return Object.values(T(kind)).filter(e => matches(e, where)).map(copy);
      },
      async idemGet(scope, key) { return copy(s.idem[`${scope}|${key}`] || null); },
      async idemPut(scope, key, rec) { s.idem[`${scope}|${key}`] = copy(rec); },
      async audit(ev) { pending.audit.push(copy(ev)); },
      async outbox(ev) { pending.outbox.push(copy(ev)); },
      async lockLot(devId, lotId) { const l = s.lots[lotId]; return l && l.developmentId === devId ? copy(l) : null; },
      async transitionLot(devId, lotId, to, ctx = {}) {
        const cur = s.lots[lotId]; if (!cur || cur.developmentId !== devId) throw new DealError('LOT_NOT_FOUND', { lotId });
        const revision = (s.devRevision[devId] || Math.max(0, ...Object.values(s.lots).filter(l => l.developmentId === devId).map(l => l.revision || 0))) + 1;
        const r = AV.transition({ ...cur }, to, { at: ctx.at, sourceId: 'deals-service', revision, reservedUntil: ctx.reservedUntil || null, reason: ctx.reason || null }, AV.policyOf({}));
        if (!r.ok) throw new DealError('LOT_NOT_AVAILABLE', { lotId, from: cur.status, to, reason: r.error.code });
        const { freshness, ...next } = r.state;
        s.lots[lotId] = { ...next, developmentId: devId }; s.devRevision[devId] = revision;
        pending.history.push({ developmentId: devId, lotId, fromStatus: cur.status, toStatus: to, revision, changedAt: ctx.at, requestId: ctx.requestId || null });
        return copy(s.lots[lotId]);
      }
    };
  }
  return {
    kind: 'memory', audit, outbox, history,
    /** test helpers (outside transactions) */
    lot: lotId => copy(state.lots[lotId] || null),
    setLot(lotId, v) { state.lots[lotId] = { ...(state.lots[lotId] || {}), ...copy(v) }; },
    rows: kind => Object.values(state.rows[kind]).map(copy),
    transaction(fn) {
      const run = chain.then(async () => {
        const draft = copy(state), pending = { audit: [], outbox: [], history: [] };
        const out = await fn(makeTx(draft, pending)); // throw → draft discarded (rollback)
        state = draft; audit.push(...pending.audit); outbox.push(...pending.outbox); history.push(...pending.history);
        return out;
      });
      chain = run.catch(() => {});
      return run;
    }
  };
}

// ---------------------------------------------------------------------------------------------- postgres
const ms = d => (d == null ? null : new Date(d).toISOString());
function createPgDealsStore(pool, { App } = {}) {
  const AV = App && App.availability;
  const meta = kind => { const t = TABLES[kind]; if (!t) throw new Error(`unknown kind ${kind}`); return t; };
  const colVals = (t, e) => Object.entries(t.cols).map(([k, c]) => [c, k === 'expiresAt' ? ms(e[k]) : e[k] ?? null]);
  function makeTx(client) {
    return {
      async get(kind, id) { const { rows } = await client.query(`SELECT data, revision FROM ${meta(kind).table} WHERE id = $1`, [id]); return rows[0] ? { ...rows[0].data, revision: Number(rows[0].revision) } : null; },
      async insert(kind, e) {
        const t = meta(kind), cv = colVals(t, e), row = { ...e, revision: e.revision || 1 };
        const cols = ['id', 'organization_id', ...cv.map(x => x[0]), 'revision', 'data'];
        const vals = [e.id, e.organizationId, ...cv.map(x => x[1]), row.revision, JSON.stringify(row)];
        await client.query(`INSERT INTO ${t.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
        return row;
      },
      async update(kind, e, expectedRevision) {
        const t = meta(kind), cv = colVals(t, e), row = { ...e, revision: expectedRevision + 1 };
        const sets = cv.map(([c], i) => `${c} = $${i + 4}`);
        const r = await client.query(`UPDATE ${t.table} SET revision = $3, data = $${cv.length + 4}::jsonb, updated_at = now()${sets.length ? ', ' + sets.join(', ') : ''} WHERE id = $1 AND revision = $2`,
          [e.id, expectedRevision, row.revision, ...cv.map(x => x[1]), JSON.stringify(row)]);
        if (r.rowCount !== 1) { const cur = await this.get(kind, e.id); throw conflict(kind, e.id, expectedRevision, cur ? cur.revision : null); }
        return row;
      },
      async find(kind, where = {}) {
        const t = meta(kind), conds = [], vals = [];
        for (const [k, v] of Object.entries(where)) {
          const c = k === 'organizationId' ? 'organization_id' : k === 'id' ? 'id' : t.cols[k]; if (!c) throw new Error(`${kind}.${k} is not an indexed column`);
          vals.push(Array.isArray(v) ? v : v); conds.push(Array.isArray(v) ? `${c} = ANY($${vals.length})` : `${c} = $${vals.length}`);
        }
        const { rows } = await client.query(`SELECT data, revision FROM ${t.table}${conds.length ? ' WHERE ' + conds.join(' AND ') : ''} ORDER BY created_at, id`, vals);
        return rows.map(r => ({ ...r.data, revision: Number(r.revision) }));
      },
      async idemGet(scope, key) { const { rows } = await client.query('SELECT request_hash, response FROM deal_idempotency WHERE scope = $1 AND idempotency_key = $2', [scope, key]); return rows[0] ? { hash: rows[0].request_hash, response: rows[0].response } : null; },
      async idemPut(scope, key, rec) { await client.query('INSERT INTO deal_idempotency (scope, idempotency_key, request_hash, response) VALUES ($1, $2, $3, $4::jsonb)', [scope, key, rec.hash, JSON.stringify(rec.response)]); },
      async audit(ev) { await insertAudit(client, { ...ev, oldValue: null, newValue: ev.data || null }); },
      async outbox(ev) { await client.query('INSERT INTO deal_outbox (organization_id, event_type, aggregate_type, aggregate_id, payload, occurred_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)', [ev.organizationId, ev.type, ev.aggregateType, ev.aggregateId, JSON.stringify(ev.payload || {}), ev.occurredAt]); },
      async lockLot(devId, lotId) {
        await avRepo.lockDevelopmentRevision(client, devId);
        const r = await avRepo.lockLot(client, lotId);
        if (!r || r.development_id !== devId) return null;
        return { developmentId: devId, status: r.status, revision: Number(r.revision), updatedAt: ms(r.updated_at), sourceId: r.source_id, reservedUntil: ms(r.reserved_until), proposalId: r.proposal_id, reason: r.reason, notes: null };
      },
      async transitionLot(devId, lotId, to, ctx = {}) {
        const devRevision = await avRepo.lockDevelopmentRevision(client, devId);
        const cur = await this.lockLot(devId, lotId); if (!cur) throw new DealError('LOT_NOT_FOUND', { lotId });
        const revision = Number(devRevision) + 1;
        const r = AV.transition(cur, to, { at: ctx.at, sourceId: 'deals-service', revision, reservedUntil: ctx.reservedUntil || null, reason: ctx.reason || null }, AV.policyOf({}));
        if (!r.ok) throw new DealError('LOT_NOT_AVAILABLE', { lotId, from: cur.status, to, reason: r.error.code });
        const { freshness, ...next } = r.state;
        await avRepo.updateLot(client, lotId, { ...next, provenance: { 'availability.status': { status: 'CONFIRMED', sourceId: 'deals-service', method: 'declared', confidence: 'HIGH', updatedAt: ctx.at } } });
        await avRepo.setDevelopmentRevision(client, devId, revision, ctx.at, 'deals-service');
        await avRepo.insertHistory(client, { developmentId: devId, lotId, fromStatus: cur.status, toStatus: to, revision, changedAt: ctx.at, sourceId: 'deals-service', reason: next.reason, reservedUntil: next.reservedUntil, proposalId: null, notes: null, requestId: ctx.requestId || null });
        return { ...next, developmentId: devId };
      }
    };
  }
  return { kind: 'postgres', transaction: fn => withTransaction(pool, client => fn(makeTx(client))) };
}

module.exports = { TABLES, createMemoryDealsStore, createPgDealsStore };
