'use strict';
/* HTTP only: availability snapshot (dynamic, always revalidated), change stream (SSE), history and the guarded write command. */
const v = require('../../shared/validation');
const { CACHE, envelope } = require('../../shared/http/respond');
const { E } = require('../../shared/http/errors');

const LAST_EVENT_ID_RE = /^\d{1,15}$/;

function registerAvailabilityRoutes(router, { availability, availabilityStream }) {
  router.get('/api/v1/developments/:developmentId/availability', async ({ params, query }) => {
    v.queryAllowlist(query, []);
    const r = await availability.getSnapshot(v.developmentId(params.developmentId));
    return { status: 200, build: r.build, etagToken: r.etagToken, cache: CACHE.DYNAMIC };
  });
  // AvailabilityManifest (topic 29): revision/checksum/counts, no price data
  router.get('/api/v1/developments/:developmentId/availability/manifest', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await availability.getManifest(v.developmentId(params.developmentId));
    return { status: 200, body: envelope(requestId, r), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'AvailabilityManifestResponse' };
  });
  // Server-Sent Events: one event per new availabilityRevision (public fields only). Public, like the snapshot.
  router.get('/api/v1/developments/:developmentId/availability/stream', async ({ req, res, params, query }) => {
    v.queryAllowlist(query, ['lastEventId']);
    const devId = v.developmentId(params.developmentId);
    const raw = req.headers['last-event-id'] !== undefined ? req.headers['last-event-id'] : query.get('lastEventId');
    if (raw != null && (typeof raw !== 'string' || !LAST_EVENT_ID_RE.test(raw))) throw E.badRequest('Last-Event-ID inválido', [v.issue('Last-Event-ID', 'format', { expected: 'availabilityRevision (inteiro ≥ 0)' })]);
    await availabilityStream.open({ req, res, devId, lastEventId: raw == null ? null : Number(raw) });
    return { stream: true };
  });
  router.get('/api/v1/lots/:lotId/availability/history', async ({ params, query }) => {
    v.queryAllowlist(query, []);
    const items = await availability.getHistory(v.lotId(params.lotId));
    return { status: 200, body: { lotId: params.lotId, items }, cache: CACHE.DYNAMIC };
  });
  router.get('/api/v1/lots/:lotId/availability', async ({ params, query, requestId }) => {
    v.queryAllowlist(query, []);
    const r = await availability.getLotAvailability(v.lotId(params.lotId));
    return { status: 200, body: envelope(requestId, r), etagToken: r.etagToken, cache: CACHE.DYNAMIC, schema: 'AvailabilityResponse' };
  });
  // write: guarded by the admin token in the pipeline (403/401 before the body is read); Idempotency-Key supported.
  router.patch('/api/v1/lots/:lotId/availability', async ({ params, query, requestId, readBody, auth }) => {
    v.queryAllowlist(query, []);
    const lotId = v.lotId(params.lotId);
    availability.assertWritesEnabled();
    const body = await readBody();
    const result = await availability.updateAvailability(lotId, body, { requestId, actorId: auth.actorId, actorType: auth.actorType, permissionKey: auth.permissionKey });
    return { status: 200, body: result, cache: CACHE.NONE, schema: 'UpdateAvailabilityResponse' };
  }, { write: true, idempotent: true });
}
module.exports = { registerAvailabilityRoutes };
