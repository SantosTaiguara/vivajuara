'use strict';
/* Helpers for the backend-owned tests (plat/backend/tests): reuse the shared backend test helpers
   (plat/tests/backend/helpers.js, contract.js — read only) and add admin requests and an SSE client. */
const path = require('path');
const h = require('../../tests/backend/helpers');
const contract = require('../../tests/backend/contract');

const TOKEN = 'test-admin-token-0123456789abcdef0123456789';
const DEV = 'viva-juara';

/** admin request helper bound to a server: req(method, path, body, { token, key, headers, raw }) → { r, body, text } */
function client(srv, { token = TOKEN } = {}) {
  return async function req(method, p, body, o = {}) {
    const headers = { ...(body !== undefined || o.raw != null ? { 'Content-Type': 'application/json' } : {}), ...(o.headers || {}) };
    const tk = o.token === undefined ? token : o.token;
    if (tk) headers.Authorization = `Bearer ${tk}`;
    if (o.key) headers['Idempotency-Key'] = o.key;
    const r = await fetch(srv.api + p, { method, headers, body: o.raw != null ? o.raw : body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
    return { r, body: json, text };
  };
}

/** minimal SSE client over fetch: events [{ id, event, data, raw }], comments [], waitFor(pred, ms) */
async function openStream(url, headers = {}) {
  const ac = new AbortController();
  const res = await fetch(url, { headers: { Accept: 'text/event-stream', ...headers }, signal: ac.signal });
  const s = { res, events: [], comments: [], raw: '', retry: null, closed: false, waiters: [] };
  const check = () => { s.waiters = s.waiters.filter(w => { const hit = w.pred(s); if (hit) { clearTimeout(w.t); w.resolve(hit); } return !hit; }); };
  if (res.headers.get('content-type') && res.headers.get('content-type').startsWith('text/event-stream')) {
    (async () => {
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          s.raw += chunk; buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            const ev = { id: null, event: 'message', data: null, raw: block };
            let isEvent = false;
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) s.comments.push(line.slice(1).trim());
              else if (line.startsWith('retry: ')) s.retry = Number(line.slice(7));
              else if (line.startsWith('id: ')) { ev.id = line.slice(4); isEvent = true; }
              else if (line.startsWith('event: ')) { ev.event = line.slice(7); isEvent = true; }
              else if (line.startsWith('data: ')) { ev.data = JSON.parse(line.slice(6)); isEvent = true; }
            }
            if (isEvent) s.events.push(ev);
          }
          check();
        }
      } catch (_) { /* aborted */ }
      s.closed = true; check();
    })();
  }
  s.waitFor = (pred, ms = 5000) => new Promise((resolve, reject) => {
    const hit = pred(s); if (hit) return resolve(hit);
    const w = { pred, resolve, t: setTimeout(() => { s.waiters = s.waiters.filter(x => x !== w); reject(new Error(`timeout waiting for SSE condition; events=${JSON.stringify(s.events.map(e => [e.id, e.data && e.data.reason]))}`)); }, ms) };
    s.waiters.push(w);
  });
  s.close = () => { ac.abort(); };
  return s;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** topic 31 fixture: a second organization (org_test_b) owning a PRIVATE development "dev-b" with one lot TB-QA-L0001.
    Rows are cloned from viva-juara with new ids; organization_id is filled by the migration 008 triggers. The slug
    "viva-juara" is reused on purpose (slugs are unique per organization, not globally). */
async function seedSecondTenant(pool) {
  await pool.query(`INSERT INTO organizations (id, slug, display_name, settings) VALUES ('org_test_b', 'test-b', 'Organização Teste B', '{"defaultDevelopmentVisibility":"PRIVATE"}')`);
  await pool.query(`INSERT INTO developments (id, organization_id, code, name, slug, status, currency, locale, config, visibility)
    SELECT 'dev-b', 'org_test_b', 'TB', 'Empreendimento Teste B', slug, status, currency, locale, config, 'PRIVATE' FROM developments WHERE id = 'viva-juara'`);
  await pool.query(`INSERT INTO static_versions (development_id, version, schema_version, checksum, lot_count)
    SELECT 'dev-b', version, schema_version, checksum, 1 FROM static_versions WHERE development_id = 'viva-juara' LIMIT 1`);
  await pool.query(`INSERT INTO blocks (development_id, code, number, name) VALUES ('dev-b', 'A', 1, 'Quadra A')`);
  await pool.query(`INSERT INTO lots (id, development_id, block_id, code, lot_number, area_m2, latitude, longitude, static_version, static, geometry, checksum, geometry_checksum)
    SELECT 'TB-QA-L0001', 'dev-b', (SELECT id FROM blocks WHERE development_id = 'dev-b' AND code = 'A'), 'A1', 1, area_m2, latitude, longitude,
           (SELECT version FROM static_versions WHERE development_id = 'dev-b' LIMIT 1), static, geometry, checksum, geometry_checksum
      FROM lots WHERE id = 'VJ-QA-L0001'`);
  await pool.query(`INSERT INTO lot_availability (lot_id, development_id, status) VALUES ('TB-QA-L0001', 'dev-b', 'UNKNOWN')`);
}

/** dev/test user with roles (topic 30) → { userId, token, ... } */
const provision = (pool, o) => require('../src/modules/iam/iam.admin').provisionUser(pool, o);

/** GET helper with optional bearer / extra headers → { r, body, text } */
async function get(srv, p, { token = null, headers = {} } = {}) {
  const r = await fetch(srv.api + p, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch (_) { /* not JSON */ }
  return { r, body, text };
}

module.exports = { h, contract, TOKEN, DEV, client, openStream, sleep, path, seedSecondTenant, provision, get };
