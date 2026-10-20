'use strict';
/* AvailabilityStream: GET /api/v1/developments/{id}/availability/stream (Server-Sent Events).
   - Change detection: PostgreSQL LISTEN plat_availability (migration 007: trigger on developments.availability_revision,
     delivered on COMMIT of the availability write) + a safe poll of the revision counter (SSE_POLL_INTERVAL_MS) as a
     safety net for lost notifications / listener reconnects. One listener connection per process, only while clients are open.
   - Each event: `id: <availabilityRevision>`, `event: availability`, data = AvailabilityStreamEvent with the lots changed
     since the client's revision, PUBLIC fields only (AvailabilityDto: never proposalId or notes).
   - Last-Event-ID (header, or ?lastEventId=) resumes after a reconnect; without it the first event carries the current
     revision with resync=true (client loads the snapshot if its revision differs).
   - Heartbeat comments (`: heartbeat`) every SSE_HEARTBEAT_MS; clean disconnect (timers and listener released),
     slow consumers dropped, SSE_MAX_CLIENTS cap (503 STREAM_LIMIT_REACHED). */
const { E } = require('../../shared/http/errors');
const { toAvailabilityDto } = require('./availability.dto');

const CHANNEL = 'plat_availability';
const MAX_BUFFERED_BYTES = 1024 * 1024;
const RESYNC_AHEAD = Number.MAX_SAFE_INTEGER;

/** One statement = one snapshot: the development revision and the lots changed after `since` are consistent. */
async function findChangesSince(db, devId, since, limit) {
  const { rows } = await db.query(
    `SELECT d.availability_revision AS revision, d.availability_updated_at AS updated_at,
            (SELECT count(*)::int FROM lot_availability a WHERE a.development_id = d.id AND a.revision > $2) AS changed,
            COALESCE((SELECT json_agg(x ORDER BY x.revision, x.lot_id) FROM (
               SELECT lot_id, status, revision, updated_at, reserved_until, source_id FROM lot_availability
                WHERE development_id = d.id AND revision > $2 ORDER BY revision, lot_id LIMIT $3) x), '[]'::json) AS lots
       FROM developments d WHERE d.id = $1`, [devId, since, limit]);
  return rows[0] || null;
}

async function findRevisions(db, devIds) {
  const { rows } = await db.query('SELECT id, availability_revision FROM developments WHERE id = ANY($1::text[])', [devIds]);
  return rows;
}

const ts = v => (v == null ? null : new Date(v));
const iso = v => (v == null ? null : new Date(v).toISOString());

function createAvailabilityStream({ pool, config, logger, developments }) {
  const S = config.sse;
  const subs = new Map(); // developmentId → Set<sub>
  let total = 0, closed = false;
  let listener = null, connecting = null, reconnectTimer = null, pollTimer = null;

  // ---------------------------------------------------------------- delivery
  function write(sub, text) {
    if (sub.ended) return;
    sub.res.write(text);
    if (sub.res.writableLength > MAX_BUFFERED_BYTES) { logger.warn('availability stream: slow consumer dropped', { errorCode: 'SSE_SLOW_CONSUMER', developmentId: sub.devId }); end(sub); }
  }

  function event(sub, row, reason) {
    const revision = row.revision;
    const resync = reason != null || row.changed > S.maxLotsPerEvent;
    const data = {
      developmentId: sub.devId, availabilityRevision: revision, previousRevision: sub.lastSent, updatedAt: iso(row.updated_at),
      changedLots: reason != null ? null : row.changed, resync, reason: reason || (resync ? 'TOO_MANY_CHANGES' : null),
      lots: resync ? [] : row.lots.map(x => toAvailabilityDto(x.lot_id, { ...x, updated_at: ts(x.updated_at), reserved_until: ts(x.reserved_until) }))
    };
    write(sub, `id: ${revision}\nevent: availability\ndata: ${JSON.stringify(data)}\n\n`);
    sub.lastSent = revision;
  }

  /** brings one client up to date (serialized per client; coalesces bursts of notifications) */
  async function deliver(sub) {
    if (sub.ended) return;
    if (sub.busy) { sub.pending = true; return; }
    sub.busy = true;
    try {
      do {
        sub.pending = false;
        const since = sub.lastSent == null ? RESYNC_AHEAD : sub.lastSent;
        const row = await findChangesSince(pool, sub.devId, since, S.maxLotsPerEvent);
        if (!row || sub.ended) break;
        if (sub.lastSent == null) event(sub, { ...row, lots: [] }, 'INITIAL');
        else if (sub.lastSent > row.revision) event(sub, { ...row, lots: [] }, 'REVISION_AHEAD');
        else if (row.revision > sub.lastSent) event(sub, row, null);
      } while (sub.pending && !sub.ended);
    } catch (e) {
      logger.warn('availability stream delivery failed', { errorCode: 'SSE_DELIVERY_FAILED', developmentId: sub.devId, detail: e.code || e.message });
    } finally { sub.busy = false; }
  }

  function notifyDevelopment(devId, revision = null) {
    const set = subs.get(devId);
    if (!set) return;
    for (const sub of set) if (revision == null || sub.lastSent == null || sub.lastSent < revision) deliver(sub);
  }

  async function checkAll() {
    const ids = [...subs.keys()];
    if (!ids.length) return;
    try { for (const r of await findRevisions(pool, ids)) notifyDevelopment(r.id, r.availability_revision); }
    catch (e) { logger.warn('availability stream poll failed', { errorCode: 'SSE_POLL_FAILED', detail: e.code || e.message }); }
  }

  // ---------------------------------------------------------------- LISTEN connection (one per process, only while needed)
  async function startListener() {
    if (!S.listen || listener || connecting || closed || total === 0) return;
    connecting = (async () => {
      let client;
      try {
        client = await pool.connect();
        client.on('notification', msg => {
          if (msg.channel !== CHANNEL) return;
          let p; try { p = JSON.parse(msg.payload); } catch (_) { return; }
          if (p && typeof p.developmentId === 'string') notifyDevelopment(p.developmentId, Number.isFinite(p.revision) ? p.revision : null);
        });
        client.on('error', e => {
          logger.warn('availability listener lost', { errorCode: 'SSE_LISTENER_ERROR', detail: e.code || e.message });
          if (listener === client) { listener = null; try { client.release(e); } catch (_) { /* already released */ } }
          scheduleReconnect();
        });
        await client.query(`LISTEN ${CHANNEL}`);
        listener = client;
        if (total === 0 || closed) await stopListener();
        else checkAll(); // anything committed between the clients' first read and LISTEN
      } catch (e) {
        if (client && listener !== client) { try { client.release(e); } catch (_) { /* ignore */ } }
        logger.warn('availability listener unavailable (poll only)', { errorCode: 'SSE_LISTENER_ERROR', detail: e.code || e.message });
        scheduleReconnect();
      } finally { connecting = null; }
    })();
    return connecting;
  }
  function scheduleReconnect() {
    if (reconnectTimer || closed || total === 0 || !S.listen) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; startListener(); }, 1000);
    reconnectTimer.unref();
  }
  async function stopListener() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (connecting) await connecting.catch(() => {});
    const c = listener; listener = null;
    if (!c) return;
    try { await c.query(`UNLISTEN ${CHANNEL}`); c.release(); } catch (e) { try { c.release(e); } catch (_) { /* ignore */ } }
  }

  function startPoll() {
    if (pollTimer || !S.pollIntervalMs || closed) return;
    pollTimer = setInterval(checkAll, S.pollIntervalMs);
    pollTimer.unref();
  }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ---------------------------------------------------------------- clients
  function end(sub) {
    if (sub.ended) return;
    sub.ended = true;
    clearInterval(sub.heartbeat);
    const set = subs.get(sub.devId);
    if (set && set.delete(sub)) { total--; if (!set.size) subs.delete(sub.devId); }
    try { sub.res.end(); } catch (_) { /* socket gone */ }
    if (total === 0) { stopPoll(); stopListener().catch(() => {}); }
  }

  /** opens a stream (after validation; errors before this point are normal JSON ApiErrors) */
  async function open({ req, res, devId, lastEventId }) {
    if (closed || total >= S.maxClients) throw E.unavailable('STREAM_LIMIT_REACHED', 'Limite de conexões do stream de disponibilidade atingido; tente novamente');
    await developments.getVersions(devId); // 404 DEVELOPMENT_NOT_FOUND before any byte of the stream
    const headers = { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' };
    if (req.method === 'HEAD') { res.writeHead(200, headers); res.end(); return; }
    res.writeHead(200, headers);
    res.flushHeaders && res.flushHeaders();
    req.socket.setKeepAlive && req.socket.setKeepAlive(true);
    req.socket.setNoDelay && req.socket.setNoDelay(true);
    const sub = { req, res, devId, lastSent: lastEventId, busy: false, pending: false, ended: false, heartbeat: null };
    if (!subs.has(devId)) subs.set(devId, new Set());
    subs.get(devId).add(sub); total++;
    sub.heartbeat = setInterval(() => write(sub, `: heartbeat ${new Date().toISOString()}\n\n`), Math.max(S.heartbeatMs, 10));
    sub.heartbeat.unref();
    const gone = () => end(sub);
    req.on('close', gone); res.on('close', gone); res.on('error', gone);
    write(sub, `retry: ${S.retryMs}\n: connected\n\n`);
    startListener(); startPoll();
    await deliver(sub);
    return sub;
  }

  async function close() {
    closed = true;
    for (const set of [...subs.values()]) for (const sub of [...set]) end(sub);
    stopPoll();
    await stopListener();
  }

  const stats = () => ({ clients: total, developments: subs.size, listening: !!listener, polling: !!pollTimer });
  return { open, close, stats, CHANNEL };
}

module.exports = { createAvailabilityStream, findChangesSince, CHANNEL };
