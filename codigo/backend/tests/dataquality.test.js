'use strict';
/* Topic 61 — data quality service, DB-FREE: shared domain (plat/src/dataquality) in the backend App context, memory repository,
   fake principals. Covers: deny by default, tenant isolation (other organization = 404), run → findings persisted, finding
   lifecycle, exception policy (not configured → refused), server-side gate for topic 58, migration 015 up/down symmetry,
   route policies ↔ permission keys, OpenAPI path module. Nothing talks to Postgres. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createAppContext } = require('../src/shared/domain/sharedDomain');
const { attachDataQuality } = require('../src/modules/dataquality/dataquality.loader');
const { createMemoryDataQualityRepository } = require('../src/modules/dataquality/dataquality.repository');
const { createDataQualityService, PERMISSIONS } = require('../src/modules/dataquality/dataquality.service');
const { ROUTE_POLICIES } = require('../src/modules/dataquality/dataquality.controller');
const { addDataQualityPaths, ROUTES } = require('../src/modules/dataquality/dataquality.openapi');

const SRC = path.resolve(__dirname, '..', '..', 'src');
const ROWS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'dash', 'lots.json'), 'utf8'));
const NOW = Date.parse('2026-10-16T12:00:00Z');
const App = createAppContext({ srcDir: SRC });
attachDataQuality(App);
const ALL = [...PERMISSIONS];
const steward = { actorId: 'usr_steward', organizationId: 'org_house7', permissions: ALL };
const other = { actorId: 'usr_x', organizationId: 'org_other', permissions: ALL };
const reader = { actorId: 'usr_r', organizationId: 'org_house7', permissions: ['data_quality.read'] };
const svc = () => createDataQualityService({ App, repo: createMemoryDataQualityRepository(), now: () => NOW });

test('deny by default: no principal or missing permission is refused', async () => {
  const s = svc();
  await assert.rejects(s.listFindings(null), e => e.code === 'DQ_PERMISSION_DENIED' && e.status === 403);
  await assert.rejects(s.runChecks(reader, { developmentId: 'viva-juara', input: { rows: ROWS } }), e => e.code === 'DQ_PERMISSION_DENIED');
});

test('run over the real 498 lots: findings persisted per tenant; other organization sees nothing and gets 404', async () => {
  const s = svc();
  const r = await s.runChecks(steward, { developmentId: 'viva-juara', input: { rows: ROWS } });
  assert.match(r.runId, /^dqr_/); assert.equal(r.status, 'PASSED_WITH_WARNINGS');
  const fs1 = await s.listFindings(steward, {});
  const avail = fs1.find(f => f.ruleId === 'DQ-AVAIL-002');
  assert.equal(avail.failedEntityCount, 498, 'all 498 lots have availability UNKNOWN');
  assert.ok(avail.sampleEntityRefs.length <= 10, 'grouped finding with samples, not 498 rows');
  assert.deepEqual(await s.listFindings(other, {}), []);
  await assert.rejects(s.getFinding(other, avail.id), e => e.status === 404);
  await assert.rejects(s.runChecks(other, { developmentId: 'viva-juara', input: { rows: ROWS } }), e => e.code === 'DQ_NOT_FOUND');
  const ack = await s.acknowledgeFinding(steward, avail.id); assert.equal(ack.status, 'ACKNOWLEDGED');
  await assert.rejects(s.resolveFinding(steward, avail.id, { resolution: { resolutionType: 'DATA_FIXED', evidenceRefs: ['x'] }, verificationRunId: r.runId }), e => e.code === 'DQ_VERIFICATION_REQUIRED', 'rule still fails → cannot resolve');
});

test('health: availability UNKNOWN (never HEALTHY), SLO targets not configured', async () => {
  const h = await svc().health(steward, { developmentId: 'viva-juara', input: { rows: ROWS } });
  assert.equal(h.health.domains.find(d => d.dataDomainId === 'AVAILABILITY').status, 'UNKNOWN');
  assert.notEqual(h.health.overallStatus, 'HEALTHY');
  assert.ok(h.slos.every(x => x.status === 'NOT_CONFIGURED' && x.target === null));
});

test('exceptions: policy not configured → refused (no invented duration)', async () => {
  await assert.rejects(svc().createException(steward, { developmentId: 'viva-juara', ruleId: 'DQ-PRICE-005', reason: 'motivo suficientemente longo', risk: 'LOW', expiresAt: NOW + 3600e3 }),
    e => e.code === 'DQ_EXCEPTION_NOT_ALLOWED' || e.code === 'DQ_POLICY_NOT_CONFIGURED');
});

test('server-side gate (topic 58): real batch PASS; duplicated lot id BLOCK; tenant forced from the principal', async () => {
  const s = svc();
  assert.equal((await s.evaluateGate(steward, { developmentId: 'viva-juara', rows: ROWS })).decision, 'PASS');
  const dup = ROWS.slice(); dup[1] = { ...dup[1], did: dup[0].did, id: dup[0].id };
  const g = await s.evaluateGate(steward, { developmentId: 'viva-juara', rows: dup });
  assert.equal(g.decision, 'BLOCK'); assert.ok(g.reasons.some(r => r.ruleId === 'DQ-LOT-001' || r.ruleId === 'DQ-LOT-004'));
  assert.equal((await s.evaluateGate(other, { developmentId: 'viva-juara', rows: ROWS })).decision, 'BLOCK', 'organization of the principal ≠ development organization');
});

test('migration 015 has a down script that drops exactly what it creates; snapshots append-only; exceptions always expire', () => {
  const up = fs.readFileSync(path.join(__dirname, '..', 'migrations', '015_data_quality.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'down', '015_data_quality.down.sql'), 'utf8');
  const created = [...up.matchAll(/CREATE TABLE (\w+)/g)].map(m => m[1]).sort();
  assert.deepEqual([...down.matchAll(/DROP TABLE IF EXISTS (\w+)/g)].map(m => m[1]).sort(), created);
  assert.match(up, /expires_at\s+TIMESTAMPTZ NOT NULL/); assert.match(up, /BEFORE UPDATE OR DELETE ON dq_publication_snapshots/);
  assert.ok(!/\b(email|phone|cpf|name)\s+TEXT/i.test(up), 'no PII columns');
});

test('route policies use only data quality permission keys; OpenAPI module documents every route', () => {
  for (const [route, p] of Object.entries(ROUTE_POLICIES)) assert.ok(PERMISSIONS.includes(p.permission), route);
  const P = {}; addDataQualityPaths((p, m, o) => { P[p] = P[p] || {}; P[p][m] = o; });
  assert.equal(Object.values(P).reduce((n, x) => n + Object.keys(x).length, 0), ROUTES.length);
  assert.equal(Object.keys(ROUTE_POLICIES).length, ROUTES.length);
});
