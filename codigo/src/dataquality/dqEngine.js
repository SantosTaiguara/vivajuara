/* dataquality/dqEngine.js — topic 61: safe evaluator registry, quality runner, findings (grouped), quality gates,
   freshness per use, schema / volume / distribution drift, reconciliation, dry-run, health snapshot, dimensional
   scorecard, publication quality snapshot and operational metrics.

   App.dataQuality.evaluators  registry of declarative/custom evaluators (no arbitrary code or SQL, §201)
   App.dataQuality.engine      run / dryRun / gate / health / scorecard / freshness / drift / reconcile / snapshot / metrics
   App.dataQuality.evaluateGate(input) → { decision: PASS|BLOCK|REVIEW, findings, … }   (entry point for topic 58 onboarding)

   Invariants (spec §484): CHECK ERROR → UNKNOWN, never PASS; UNKNOWN is never HEALTHY; STALE/UNKNOWN for transaction →
   BLOCK the transaction; SHADOW rules never block; unowned critical rule never blocks (runs as WARNING); BLOCKING rules
   are not waivable unless an explicit policy allows it; exceptions expire; drift of a distribution only asks for review;
   reconciliation never applies corrections (identity/geometry: never even proposed). This module READS lots, price entries
   and snapshots and never changes them (no ID, geometry, score, class, price or availability is touched).
   Pure: no DOM, no storage, no network; time comes from ctx.now. */
var App = (typeof App !== 'undefined' && App) || (typeof globalThis !== 'undefined' && globalThis.App) || {};
App.dataQuality = App.dataQuality || {};
App.dataQuality.evaluators = (() => {
  const get = (o, key) => key.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const idOf = l => (l && l.identity && l.identity.id) || null;
  const REG = new Map();
  /** register(id, { type, needs, evaluate(rule, ctx) → { evaluatedCount, failures[], notApplicable?, observations? } }) */
  const register = (id, def) => { REG.set(id, Object.freeze({ id, ...def })); };
  const ids = () => [...REG.keys()];
  const of = id => REG.get(id) || null;
  const fail = (entityRef, fieldRef, observed, expected) => ({ entityRef, fieldRef, observed: observed === undefined ? null : observed, expected });
  const lots = ctx => ctx.lots || [];
  const NA = (reason, evaluatedCount = 0) => ({ evaluatedCount, failures: [], notApplicable: reason });

  register('NOT_NULL', { type: 'NOT_NULL', evaluate(r, ctx) {
    const keys = r.thresholdConfig.fieldKeys || [r.thresholdConfig.fieldKey], failures = [];
    for (const l of lots(ctx)) for (const k of keys) { const v = get(l, k); if (v === null || v === undefined || v === '') failures.push(fail(idOf(l), k, v === undefined ? 'ausente' : 'null', 'valor presente')); }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('UNIQUE', { type: 'UNIQUE', evaluate(r, ctx) {
    const k = r.thresholdConfig.fieldKey, seen = new Map(), failures = [];
    for (const l of lots(ctx)) { const v = get(l, k); if (v == null) continue; seen.set(v, (seen.get(v) || 0) + 1); }
    for (const [v, n] of seen) if (n > 1) failures.push(fail(String(v), k, `${n} ocorrências`, 'único'));
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('RANGE', { type: 'RANGE', evaluate(r, ctx) {
    const t = r.thresholdConfig, failures = [];
    for (const l of lots(ctx)) {
      const v = get(l, t.fieldKey);
      if (v == null) { if (t.required) failures.push(fail(idOf(l), t.fieldKey, 'null', 'valor presente')); continue; }
      if (typeof v !== 'number' || !Number.isFinite(v)) { failures.push(fail(idOf(l), t.fieldKey, String(v), 'número finito')); continue; }
      if ((t.min != null && v < t.min) || (t.max != null && v > t.max) || (t.minExclusive != null && v <= t.minExclusive)) failures.push(fail(idOf(l), t.fieldKey, v, `faixa ${t.minExclusive != null ? '> ' + t.minExclusive : (t.min ?? '-∞') + '..' + (t.max ?? '∞')}`));
    }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('ENUM', { type: 'ENUM', evaluate(r, ctx) {
    const t = r.thresholdConfig, allowed = t.allowedValues || Object.keys((App.enums && App.enums[t.enumRef]) || {}), failures = [];
    if (!allowed.length) throw new Error(`enum ${t.enumRef} indisponível`);
    for (const l of lots(ctx)) { const v = get(l, t.fieldKey); if (!allowed.includes(v)) failures.push(fail(idOf(l), t.fieldKey, v == null ? 'null' : v, allowed.join('|'))); }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('PATTERN', { type: 'VALIDITY', evaluate(r, ctx) {
    const t = r.thresholdConfig, re = new RegExp(t.pattern), failures = [];
    for (const l of lots(ctx)) { const v = get(l, t.fieldKey); if (typeof v !== 'string' || !re.test(v)) failures.push(fail(idOf(l) || String(v), t.fieldKey, v == null ? 'null' : v, t.pattern)); }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('KNOWN_STATUS', { type: 'CUSTOM_DOMAIN', evaluate(r, ctx) {
    const failures = lots(ctx).filter(l => !l.availability || l.availability.status === 'UNKNOWN').map(l => fail(idOf(l), 'availability.status', 'UNKNOWN', 'status confirmado pela fonte'));
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('AVAILABILITY_SOURCE_TIMESTAMP', { type: 'CUSTOM_DOMAIN', evaluate(r, ctx) {
    const known = lots(ctx).filter(l => l.availability && l.availability.status !== 'UNKNOWN'), failures = [];
    for (const l of known) {
      if (!l.availability.updatedAt || Number.isNaN(Date.parse(l.availability.updatedAt))) failures.push(fail(idOf(l), 'availability.updatedAt', 'null', 'data da fonte'));
      else if (!l.availability.sourceId) failures.push(fail(idOf(l), 'availability.sourceId', 'null', 'fonte declarada'));
    }
    return known.length ? { evaluatedCount: known.length, failures } : NA('NO_KNOWN_STATUS');
  } });
  register('FRESHNESS', { type: 'FRESHNESS', evaluate(r, ctx) {
    const t = r.thresholdConfig, use = t.use || 'TRANSACTION', fp = (ctx.policy.freshnessPolicies || []).find(f => f.id === t.freshnessPolicyRef) || null, failures = [];
    const E = App.dataQuality.engine, scope = ctx.targetLotIds ? lots(ctx).filter(l => ctx.targetLotIds.includes(idOf(l))) : lots(ctx);
    for (const l of scope) {
      const a = E.assessFreshness(fp, { sourceTimestamp: l.availability ? l.availability.updatedAt : null, observedAt: ctx.now, dataDomainId: r.dataDomainId });
      const u = a.perUse[use];
      if (u.state !== 'FRESH') failures.push(fail(idOf(l), 'availability.updatedAt', u.state === 'NOT_CONFIGURED' ? 'limite não configurado' : u.state === 'UNKNOWN' ? 'sem data da fonte (UNKNOWN)' : `idade ${a.ageMs} ms`, `atual para ${use}`));
    }
    return { evaluatedCount: scope.length, failures };
  } });
  const prevById = ctx => new Map(((ctx.previous && ctx.previous.lots) || []).map(p => [idOf(p) || p.id, p]));
  register('REVISION_MONOTONIC', { type: 'CUSTOM_DOMAIN', evaluate(r, ctx) {
    if (!ctx.previous) return NA('NO_PREVIOUS_SNAPSHOT');
    const prev = prevById(ctx), failures = [];
    for (const l of lots(ctx)) { const p = prev.get(idOf(l)); if (!p || !p.availability || !l.availability) continue;
      if ((l.availability.revision || 0) < (p.availability.revision || 0)) failures.push(fail(idOf(l), 'availability.revision', l.availability.revision, `≥ ${p.availability.revision}`)); }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('AVAILABILITY_TRANSITION', { type: 'CUSTOM_DOMAIN', evaluate(r, ctx) {
    if (!ctx.previous) return NA('NO_PREVIOUS_SNAPSHOT');
    const prev = prevById(ctx), A = App.availability, failures = [];
    for (const l of lots(ctx)) { const p = prev.get(idOf(l)); if (!p || !p.availability || !l.availability) continue;
      const from = p.availability.status, to = l.availability.status; if (from === to) continue;
      if (!A || !A.canTransition) throw new Error('máquina de estados de disponibilidade indisponível');
      const ok = A.canTransition(from, to, { lastConfirmed: p.availability.lastConfirmed || null });
      if (!ok || !ok.ok) failures.push(fail(idOf(l), 'availability.status', `${from} → ${to}`, 'transição permitida pela máquina de estados')); }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('AVAILABILITY_PRICE_INDEPENDENCE', { type: 'CUSTOM_DOMAIN', evaluate(r, ctx) {
    const priceSources = new Set(ctx.priceSourceIds || []), failures = [];
    for (const l of lots(ctx)) { const a = l.availability; if (!a || !['UNAVAILABLE', 'BLOCKED'].includes(a.status)) continue;
      const tid = l.commercial && l.commercial.priceTableId;
      if (/PRICE|PRE[CÇ]O/i.test(String(a.reason || '')) || (a.sourceId && (priceSources.has(a.sourceId) || a.sourceId === tid)))
        failures.push(fail(idOf(l), 'availability.status', `${a.status} derivado do preço`, 'status vindo só da fonte de disponibilidade')); }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('SOLD_WITHOUT_RESERVATION', { type: 'CUSTOM_DOMAIN', evaluate(r, ctx) {
    const sold = lots(ctx).filter(l => l.availability && l.availability.status === 'SOLD');
    const failures = sold.filter(l => l.availability.reservedUntil || l.availability.proposalId).map(l => fail(idOf(l), 'availability.reservedUntil', 'reserva/proposta ativa', 'nenhuma'));
    return sold.length ? { evaluatedCount: sold.length, failures } : NA('NO_SOLD_LOT');
  } });
  register('TENANT_SCOPE', { type: 'REFERENCE_EXISTS', evaluate(r, ctx) {
    const failures = lots(ctx).filter(l => !l.identity || !l.identity.developmentId || l.identity.developmentId !== ctx.developmentId)
      .map(l => fail(idOf(l), 'identity.developmentId', (l.identity && l.identity.developmentId) || 'null', ctx.developmentId));
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('CROSS_TENANT', { type: 'REFERENCE_EXISTS', evaluate(r, ctx) {
    if (!ctx.organizationId) throw new Error('organização do batch não resolvida');
    const orgOf = ctx.orgOfDevelopment, failures = [];
    for (const l of lots(ctx)) { const d = l.identity && l.identity.developmentId; const o = d ? orgOf(d) : null;
      if (o !== ctx.organizationId) failures.push(fail(idOf(l), 'identity.developmentId', o ? 'outra organização' : 'organização desconhecida', 'mesma organização do batch')); }
    for (const e of ctx.priceEntries || []) if (e.organizationId && e.organizationId !== ctx.organizationId) failures.push(fail(e.lotId, 'price.organizationId', 'outra organização', 'mesma organização do batch'));
    return { evaluatedCount: lots(ctx).length + (ctx.priceEntries || []).length, failures };
  } });
  // ---------------------------------------------------------------- geometry
  const ptsOf = l => { const p = l.geometry && l.geometry.polygon; if (!Array.isArray(p)) return null;
    const pts = p.filter((q, i) => i === 0 || q[0] !== p[i - 1][0] || q[1] !== p[i - 1][1]);
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts; };
  const area2 = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
  register('GEOMETRY_VALID', { type: 'GEOMETRY', evaluate(r, ctx) {
    const failures = [];
    for (const l of lots(ctx)) {
      const pts = ptsOf(l);
      if (!pts) { failures.push(fail(idOf(l), 'geometry.polygon', 'sem polígono', 'exatamente um polígono')); continue; }
      if (pts.some(q => !Array.isArray(q) || q.length < 2 || !Number.isFinite(q[0]) || !Number.isFinite(q[1]))) { failures.push(fail(idOf(l), 'geometry.polygon', 'coordenada não finita', 'coordenadas finitas')); continue; }
      const distinct = new Set(pts.map(q => q[0] + ',' + q[1])).size;
      if (distinct < 3) { failures.push(fail(idOf(l), 'geometry.polygon', `${distinct} vértices distintos`, '≥ 3 vértices')); continue; }
      if (Math.abs(area2(pts)) < 1e-9) failures.push(fail(idOf(l), 'geometry.polygon', 'área nula', 'área > 0'));
    }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const cross = (p1, p2, p3, p4) => { const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2), d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9)); };
  register('GEOMETRY_SIMPLE', { type: 'GEOMETRY', evaluate(r, ctx) {
    const failures = [];
    for (const l of lots(ctx)) { const p = ptsOf(l); if (!p || p.length < 4) continue; const n = p.length; let hit = null;
      for (let i = 0; i < n && !hit; i++) for (let j = i + 2; j < n && !hit; j++) { if (i === 0 && j === n - 1) continue; if (cross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) hit = [i, j]; }
      if (hit) failures.push(fail(idOf(l), 'geometry.polygon', `arestas ${hit[0]} e ${hit[1]} se cruzam`, 'polígono simples')); }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  register('GEOMETRY_BOUNDS', { type: 'GEOMETRY', evaluate(r, ctx) {
    const failures = [], tol = 1e-6;
    for (const l of lots(ctx)) { const p = ptsOf(l), g = l.geometry || {}; if (!p || !p.length) continue;
      const xs = p.map(q => q[0]), ys = p.map(q => q[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
      const b = g.bounds, c = g.centroid;
      if (!b || Math.abs(b.x - x0) > tol || Math.abs(b.y - y0) > tol || Math.abs(b.x + b.w - x1) > 1e-4 || Math.abs(b.y + b.h - y1) > 1e-4) failures.push(fail(idOf(l), 'geometry.bounds', b ? JSON.stringify(b) : 'null', 'envelope do polígono'));
      else if (!Array.isArray(c) || c[0] < x0 - tol || c[0] > x1 + tol || c[1] < y0 - tol || c[1] > y1 + tol) failures.push(fail(idOf(l), 'geometry.centroid', c ? c.join(',') : 'null', 'dentro dos limites')); }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  // ---------------------------------------------------------------- pricing
  register('PRICE_LOT_REFERENCE', { type: 'REFERENCE_EXISTS', evaluate(r, ctx) {
    const known = new Set(lots(ctx).map(idOf)), entries = ctx.priceEntries || [];
    return entries.length ? { evaluatedCount: entries.length, failures: entries.filter(e => !known.has(e.lotId)).map(e => fail(String(e.lotId), 'price.lotId', 'lote inexistente', 'lote do empreendimento')) } : NA('NO_PRICE_ENTRIES');
  } });
  register('PRICE_DUPLICATE', { type: 'UNIQUE', evaluate(r, ctx) {
    const entries = ctx.priceEntries || [], n = new Map(); for (const e of entries) n.set(e.lotId, (n.get(e.lotId) || 0) + 1);
    return entries.length ? { evaluatedCount: entries.length, failures: [...n].filter(([, c]) => c > 1).map(([id, c]) => fail(String(id), 'price.lotId', `${c} entradas`, '1 entrada por lote')) } : NA('NO_PRICE_ENTRIES');
  } });
  register('PRICE_VALUE', { type: 'RANGE', evaluate(r, ctx) {
    const entries = ctx.priceEntries || [], cur = r.thresholdConfig.currency || 'BRL', failures = [];
    for (const e of entries) { if (e.price == null) continue; // null = sem preço (completude), nunca 0
      if (typeof e.price !== 'number' || !Number.isFinite(e.price) || e.price < 0) failures.push(fail(String(e.lotId), 'commercial.price', String(e.price), '≥ 0'));
      else if (e.currency !== cur) failures.push(fail(String(e.lotId), 'commercial.currency', e.currency == null ? 'null' : e.currency, cur)); }
    return entries.length ? { evaluatedCount: entries.length, failures } : NA('NO_PRICE_ENTRIES');
  } });
  register('PRICE_TABLE_VERSION', { type: 'VERSION_COMPATIBILITY', evaluate(r, ctx) {
    const entries = (ctx.priceEntries || []).filter(e => e.price != null), v = ctx.versions && ctx.versions.priceTableVersion;
    if (!entries.length) return NA('NO_PRICE_ENTRIES');
    if (!v) throw new Error('versão corrente da tabela de preço não informada');
    return { evaluatedCount: entries.length, failures: entries.filter(e => e.priceTableVersion !== v).map(e => fail(String(e.lotId), 'commercial.priceTableVersion', e.priceTableVersion == null ? 'null' : e.priceTableVersion, v)) };
  } });
  // ---------------------------------------------------------------- analysis / provenance / nulls
  register('ANALYSIS_VERSION', { type: 'VERSION_COMPATIBILITY', evaluate(r, ctx) {
    const v = ctx.versions && ctx.versions.analysisVersion; if (!v) throw new Error('versão corrente da análise não informada');
    return { evaluatedCount: lots(ctx).length, failures: lots(ctx).filter(l => get(l, 'intelligence.analysisVersion') !== v).map(l => fail(idOf(l), 'intelligence.analysisVersion', get(l, 'intelligence.analysisVersion') ?? 'null', v)) };
  } });
  register('ANALYSIS_SCORES', { type: 'RANGE', evaluate(r, ctx) {
    const t = r.thresholdConfig, failures = [];
    for (const l of lots(ctx)) { const s = get(l, 'intelligence.scores') || {}; const bad = t.keys.filter(k => typeof s[k] !== 'number' || !Number.isFinite(s[k]) || s[k] < t.min || s[k] > t.max);
      if (bad.length) failures.push(fail(idOf(l), 'intelligence.scores', bad.map(k => `${k}=${s[k] ?? 'null'}`).join(', '), `${t.min}–${t.max}`)); }
    return { evaluatedCount: lots(ctx).length, failures };
  } });
  const fieldsOf = () => { const F = (App.model && App.model.FIELDS) || []; return Array.isArray(F) ? F : Object.values(F); };
  register('REGISTRY_PROVENANCE', { type: 'CUSTOM_DOMAIN', evaluate(r, ctx) {
    const fs = fieldsOf().filter(f => f.priority === (r.thresholdConfig.priority || 'P0') && f.provenanceRequired && !f.virtual);
    return { evaluatedCount: fs.length, failures: fs.filter(f => !f.sourceId && f.status !== 'UNKNOWN').map(f => fail(f.key, 'fieldRegistry.sourceId', `status ${f.status}, método ${f.method || 'null'}, sem sourceId`, 'fonte declarada')) };
  } });
  register('NULL_PROFILE', { type: 'NOT_NULL', evaluate(r, ctx) {
    const pr = r.thresholdConfig.priorities || null, fs = fieldsOf().filter(f => (!pr || pr.includes(f.priority)) && f.nullable && !f.virtual && f.type !== 'array'), n = lots(ctx).length, failures = [];
    for (const f of fs) { const c = lots(ctx).filter(l => get(l, f.key) == null).length; if (c) failures.push(fail(f.key, f.key, `${c}/${n} nulos`, 'observação (null nem sempre é erro)')); }
    return { evaluatedCount: fs.length, failures };
  } });
  // ---------------------------------------------------------------- volume / schema / distribution
  register('VOLUME', { type: 'CUSTOM_DOMAIN', evaluate(r, ctx) {
    const vp = (ctx.policy.volumeExpectations || []).find(v => v.id === r.thresholdConfig.volumePolicyRef);
    if (!vp) throw new Error('política de volume ausente');
    return { evaluatedCount: 1, failures: App.dataQuality.engine.checkVolume(vp, lots(ctx).length, ctx.previous ? ctx.previous.count ?? (ctx.previous.lots || []).length : null).breaches.map(b => fail(vp.datasetRef, 'count', b.observed, b.expected)) };
  } });
  register('SCHEMA_DRIFT', { type: 'VERSION_COMPATIBILITY', evaluate(r, ctx) {
    const base = ctx.policy.baselines && ctx.policy.baselines.schema && ctx.policy.baselines.schema[r.thresholdConfig.baselineRef];
    if (!ctx.schemaObservation) return NA('NO_SOURCE_SCHEMA_OBSERVATION');
    if (!base) throw new Error('baseline de schema ausente');
    const d = App.dataQuality.engine.detectSchemaDrift(base, ctx.schemaObservation);
    return { evaluatedCount: Object.keys(base.fields).length, failures: d.changes.filter(c => c.breaking).map(c => fail(c.fieldKey, c.fieldKey, c.kind + (c.detail ? ': ' + c.detail : ''), 'compatível com a baseline ' + base.baselineVersion)),
      observations: { nonBreaking: d.changes.filter(c => !c.breaking) } };
  } });
  register('DISTRIBUTION_DRIFT', { type: 'CUSTOM_DOMAIN', evaluate(r, ctx) {
    const base = ctx.policy.baselines && ctx.policy.baselines.distribution && ctx.policy.baselines.distribution[r.thresholdConfig.baselineRef];
    if (!base) throw new Error('baseline de distribuição ausente');
    const d = App.dataQuality.engine.detectDistributionDrift(base, App.dataQuality.engine.distributionStats(lots(ctx)), r.thresholdConfig.thresholds || null);
    return { evaluatedCount: d.compared, failures: d.changes.map(c => fail(c.fieldRef, c.fieldRef, `${c.stat}: ${c.observed}`, `baseline ${c.baseline} (revisão humana)`)) };
  } });
  register('RECONCILIATION', { type: 'RECONCILIATION', evaluate(r, ctx) {
    const rr = ctx.reconciliationRuns && ctx.reconciliationRuns[r.thresholdConfig.policyRef];
    if (!rr) return NA('NO_RECONCILIATION_RUN');
    if (rr.status === 'FAILED') throw new Error('reconciliação falhou: ' + (rr.reason || ''));
    return { evaluatedCount: rr.matched + rr.mismatched + rr.missingPlatform + rr.missingSource, failures: rr.sampleMismatches.map(m => fail(m.key, m.fieldRef, m.platform, m.source)) };
  } });
  return { register, ids, of, get, idOf, ptsOf, area2 };
})();

App.dataQuality.engine = (() => {
  const M = App.dataQuality.model, EV = App.dataQuality.evaluators;
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  const stable = x => JSON.stringify(x, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(q => [q, v[q]])) : v);
  const fp = x => (App.integrity && App.integrity.sha256 ? App.integrity.sha256(stable(x)).slice(0, 16) : fnv(stable(x)));
  const iso = ms => new Date(ms).toISOString();
  const toMs = t => t == null ? null : typeof t === 'number' ? t : Date.parse(t);
  const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
  /** durationMs('P7D' | 'PT6H' | ms number) → ms | null (null/invalid = não configurado) */
  const durationMs = d => { if (d == null) return null; if (typeof d === 'number') return Number.isFinite(d) ? d : null; const m = String(d).match(ISO_DURATION); if (!m || String(d) === 'P' || String(d) === 'PT') return null;
    return (((+(m[1] || 0) * 24 + +(m[2] || 0)) * 60 + +(m[3] || 0)) * 60 + +(m[4] || 0)) * 1000; };

  // ------------------------------------------------------------------ context
  // tenancy registry first (browser); without it (backend shared context) the organization declared by the development's DQ policy
  const orgOfDevelopment = d => { try { const o = App.tenancy && App.tenancy.organizationOfDevelopment ? App.tenancy.organizationOfDevelopment(d) : null; if (o) return App.tenancy.canonicalOrgId ? App.tenancy.canonicalOrgId(o) : o; } catch (e) { /* unknown */ }
    const c = M.rawConfig(); return (c && c[d] && c[d].scope === 'DEVELOPMENT' && c[d].organizationId) || null; };
  const devConfig = id => { const D = (App.config && App.config.DEVELOPMENTS) || []; return (Array.isArray(D) ? D.find(d => d.id === id) : D[id]) || null; };
  /** currentVersions(developmentId) → { staticVersion, analysisVersion, priceTableVersion } from the published configuration */
  function currentVersions(developmentId) {
    const d = devConfig(developmentId); if (!d) return {};
    const tables = d.priceTables || [], cur = tables.find(t => t.id === d.currentPriceTableId) || tables[tables.length - 1] || null;
    return { staticVersion: d.staticDataVersion || null, analysisVersion: d.analysisVersion || null, priceTableVersion: cur ? cur.version : null };
  }
  /** priceEntriesFromLots(lots) → [{ lotId, price, currency, priceTableVersion }] (read-only projection) */
  const priceEntriesFromLots = lots => lots.filter(l => l.commercial).map(l => ({ lotId: EV.idOf(l), price: l.commercial.price ?? null, currency: l.commercial.currency ?? null, priceTableVersion: l.commercial.priceTableVersion ?? null }));
  /** normalizeRows(rows, developmentId) → { lots, skipped[] } — legacy lots.json rows through the SAME adapter as the repository */
  function normalizeRows(rows, developmentId) {
    const d = devConfig(developmentId) || {}, ctx = { developmentId, code: d.code, analysisVersion: d.analysisVersion }, lots = [], skipped = [];
    for (const r of rows) { try { lots.push(App.legacy.normalize(r, ctx).data); } catch (e) { skipped.push({ entityRef: r && r.id ? String(r.id) : null, message: e.message }); } }
    return { lots, skipped };
  }
  /** context(input) → evaluation context (never mutates the input) */
  function context(input = {}) {
    const lotsIn = input.lots || null;
    const developmentId = input.developmentId || (lotsIn && lotsIn[0] && lotsIn[0].identity && lotsIn[0].identity.developmentId) || 'viva-juara';
    const policy = input.policy || M.policy(developmentId);
    let lots = lotsIn ? lotsIn.slice() : [], skipped = [];
    if (!lotsIn && Array.isArray(input.rows)) { const n = normalizeRows(input.rows, developmentId); lots = n.lots; skipped = n.skipped; }
    const d = devConfig(developmentId) || {};
    return {
      developmentId, organizationId: input.organizationId || policy.organizationId || orgOfDevelopment(developmentId), policy, lots, skipped,
      priceEntries: input.priceEntries || priceEntriesFromLots(lots),
      priceSourceIds: input.priceSourceIds || (d.sources || []).filter(s => s.type === 'PRICE_TABLE').map(s => s.id),
      versions: { ...currentVersions(developmentId), ...(input.versions || {}) },
      previous: input.previous || null,
      schemaObservation: input.schemaObservation || (Array.isArray(input.rows) ? observeSchema(input.rows) : null),
      reconciliationRuns: input.reconciliationRuns || null, targetLotIds: input.targetLotIds || null,
      orgOfDevelopment: input.orgOfDevelopment || orgOfDevelopment,
      now: toMs(input.now) ?? Date.now(), batchRef: input.batchRef || null, sourceAssetRefs: input.sourceAssetRefs || []
    };
  }

  // ------------------------------------------------------------------ runner
  const order = (p, ids) => { const byId = new Map(p.rules.map(r => [r.id, r])), out = [], seen = new Set();
    const visit = id => { if (seen.has(id) || !byId.has(id)) return; seen.add(id); for (const d of byId.get(id).dependsOn || []) if (ids.includes(d)) visit(d); out.push(byId.get(id)); };
    ids.forEach(visit); return out; };
  /** evaluateRule(rule, ctx) → DataQualityCheckResult (+ status, failures) — evaluator errors become CHECK_FAILED, never PASS */
  function evaluateRule(r, ctx, depResults = {}) {
    const t0 = Date.now(), base = { ruleId: r.id, ruleVersion: r.version, dataDomainId: r.dataDomainId, dimension: r.dimension, severity: r.severity, ...M.effectiveMode(r, ctx.policy) };
    base.effectiveMode = base.mode; delete base.mode;
    const badDep = (r.dependsOn || []).find(d => depResults[d] && ['CHECK_FAILED', 'SKIPPED'].includes(depResults[d].status));
    if (badDep) return { ...base, status: 'SKIPPED', reason: `DEPENDENCY_${depResults[badDep].status}:${badDep}`, evaluatedCount: 0, passedCount: 0, failedCount: 0, passRate: null, failures: [], findingRefs: [], executionTimeMs: 0 };
    const ev = EV.of(r.evaluatorRef);
    if (!ev) return { ...base, status: 'CHECK_FAILED', reason: 'UNKNOWN_EVALUATOR', evaluatedCount: 0, passedCount: 0, failedCount: 0, passRate: null, failures: [], findingRefs: [], executionTimeMs: 0 };
    let out;
    try { out = ev.evaluate(r, ctx); } catch (e) { return { ...base, status: 'CHECK_FAILED', reason: 'EVALUATOR_ERROR', error: String(e && e.message || e).slice(0, 200), evaluatedCount: 0, passedCount: 0, failedCount: 0, passRate: null, failures: [], findingRefs: [], executionTimeMs: Date.now() - t0 }; }
    if (out.notApplicable) return { ...base, status: 'NOT_EVALUATED', reason: out.notApplicable, evaluatedCount: out.evaluatedCount || 0, passedCount: 0, failedCount: 0, passRate: null, failures: [], findingRefs: [], executionTimeMs: Date.now() - t0 };
    const failedEntities = new Set(out.failures.map(f => f.entityRef)).size, failedCount = out.failures.length;
    const passedCount = Math.max(0, out.evaluatedCount - failedEntities);
    return { ...base, status: failedCount ? 'FAILED' : 'PASSED', evaluatedCount: out.evaluatedCount, passedCount, failedCount,
      passRate: out.evaluatedCount ? Math.round(passedCount / out.evaluatedCount * 1e6) / 1e6 : null, failures: out.failures, observations: out.observations || null, findingRefs: [], executionTimeMs: Date.now() - t0 };
  }
  /** groupedFinding(result, ctx, run) → GroupedDataQualityFinding + DataQualityFinding fields (explosion control, §321) */
  function groupedFinding(res, ctx, run) {
    const r = M.rule(ctx.policy, res.ruleId), N = ctx.policy.evidence.maxSampleRefs || 10, scopeRef = run.scopeRef;
    const id = 'dqf_' + fp([ctx.organizationId, ctx.developmentId, res.ruleId, res.ruleVersion, scopeRef]);
    const entities = [...new Set(res.failures.map(f => f.entityRef))];
    return {
      id, kind: 'GROUPED', organizationId: ctx.organizationId, developmentId: ctx.developmentId, dataDomainId: res.dataDomainId, ruleId: res.ruleId, ruleVersion: res.ruleVersion, ruleName: r.name,
      dimension: res.dimension, severity: res.severity, effectiveMode: res.effectiveMode, modeReason: res.reason || null, status: 'OPEN', scopeRef,
      detectedAt: iso(ctx.now), lastObservedAt: iso(ctx.now), failedCount: res.failedCount, failedEntityCount: entities.length, evaluatedCount: res.evaluatedCount,
      sampleEntityRefs: entities.slice(0, N), samples: res.failures.slice(0, N), expectedCondition: r.description,
      evidenceRef: 'dqe_' + fp(res.failures.map(f => [f.entityRef, f.fieldRef, f.observed])), evidenceArtifactRef: null,
      ownerRef: r.ownerRef || null, ownerStatus: r.ownerRef ? 'ASSIGNED' : M.NC, relatedIncidentId: null, checkRunRef: run.id,
      lineage: { findingId: id, sourceAssetRefs: ctx.sourceAssetRefs, batchRefs: ctx.batchRef ? [ctx.batchRef] : [], mappingRuleRefs: ctx.lots.length && r.evaluatorRef !== 'REGISTRY_PROVENANCE' ? ['data/legacyAdapter.js'] : [],
        transformRefs: [], analysisRefs: r.dataDomainId === 'ANALYSIS' ? [ctx.versions.analysisVersion] : [] }
    };
  }
  /** run({ ruleIds | ruleSetIds, input | ctx, trigger, scopeRef }) → DataQualityCheckRun with results + findings */
  function run(opts = {}) {
    const ctx = opts.ctx || context(opts.input || {}), p = ctx.policy;
    const sets = opts.ruleSetIds ? p.ruleSets.filter(s => opts.ruleSetIds.includes(s.id)) : null;
    let ids = opts.ruleIds || (sets ? sets.flatMap(s => s.ruleIds) : p.rules.filter(r => r.status === 'ACTIVE').map(r => r.id));
    ids = [...new Set(ids)].filter(id => M.rule(p, id));
    const startedAt = iso(ctx.now), scopeRef = opts.scopeRef || `${ctx.organizationId}/${ctx.developmentId}`;
    const runObj = { id: opts.runId || 'dqr_' + fp([scopeRef, ids, ctx.now, ctx.lots.length, opts.trigger || 'MANUAL', opts.salt || null]), ruleSetIds: sets ? sets.map(s => s.id) : null,
      ruleSetVersions: sets ? sets.map(s => `${s.id}@${s.version}`) : ids.map(id => `${id}@${M.rule(p, id).version}`), trigger: opts.trigger || 'MANUAL', scopeRef,
      policyVersions: p.policyVersions, startedAt, completedAt: null, status: 'RUNNING', results: [], findings: [], normalizationSkipped: ctx.skipped.length };
    const byRule = {};
    try {
      for (const r of order(p, ids)) { const res = evaluateRule(r, ctx, byRule); byRule[r.id] = res; runObj.results.push(res); }
    } catch (e) { runObj.status = 'ERROR'; runObj.error = String(e.message || e).slice(0, 200); runObj.completedAt = iso(ctx.now); return runObj; }
    for (const res of runObj.results) if (res.status === 'FAILED') { const f = groupedFinding(res, ctx, runObj); res.findingRefs = [f.id]; runObj.findings.push(f); }
    const anyCheckFailed = runObj.results.some(r => r.status === 'CHECK_FAILED' || r.status === 'SKIPPED');
    const enforcedFail = runObj.results.some(r => r.status === 'FAILED' && r.effectiveMode === 'ENFORCED' && ['BLOCKING', 'ERROR'].includes(r.severity));
    const anyFail = runObj.results.some(r => r.status === 'FAILED' && r.effectiveMode !== 'SHADOW' && r.severity !== 'INFO');
    runObj.status = anyCheckFailed ? 'ERROR' : enforcedFail ? 'FAILED' : anyFail ? 'PASSED_WITH_WARNINGS' : 'PASSED';
    runObj.completedAt = iso(ctx.now);
    return runObj;
  }
  /** runSafely(fn) — a failure of the runner itself yields an ERROR run (health UNKNOWN), never PASS (§214) */
  function runSafely(opts) { try { return run(opts); } catch (e) { return { id: 'dqr_error_' + fnv(String(Date.now())), status: 'ERROR', error: String(e && e.message || e).slice(0, 200), results: [], findings: [], completedAt: null }; } }
  /** dryRun(rule, input) → would-fail preview before activation (§403–§406) */
  function dryRun(rule, input = {}) {
    const ctx = input.policy && input.lots !== undefined && input.now !== undefined && input.orgOfDevelopment ? input : context(input);
    const res = evaluateRule({ ...rule, enforcementMode: 'SHADOW' }, { ...ctx, policy: { ...ctx.policy, rules: [...ctx.policy.rules.filter(r => r.id !== rule.id), rule] } });
    const wouldFail = res.status === 'FAILED' ? new Set(res.failures.map(f => f.entityRef)).size : 0;
    return Object.freeze({ dryRunRef: 'dqd_' + fp([rule.id, rule.version, ctx.now]), ruleId: rule.id, ruleVersion: rule.version, status: res.status, evaluatedCount: res.evaluatedCount, wouldFail,
      failRate: res.evaluatedCount ? Math.round(wouldFail / res.evaluatedCount * 1e4) / 1e4 : null, text: `would fail ${wouldFail}/${res.evaluatedCount}`,
      recommendedMode: res.status === 'CHECK_FAILED' ? 'SHADOW' : wouldFail > 0 ? 'SHADOW' : 'WARNING', decision: res.status === 'PASSED' ? 'PASS' : 'REVIEW', at: iso(ctx.now), sample: res.failures.slice(0, 10) });
  }

  // ------------------------------------------------------------------ exceptions applied to findings
  /** exceptionState(exception, now) → ACTIVE | EXPIRED | REVOKED | PENDING_APPROVAL (expiry is derived, never stored stale) */
  const exceptionState = (x, now) => x.status === 'REVOKED' ? 'REVOKED' : !x.approvedBy || !x.approvedAt ? 'PENDING_APPROVAL' : (toMs(x.expiresAt) == null || toMs(x.expiresAt) <= now) ? 'EXPIRED' : 'ACTIVE';
  /** applyExceptions(findings, exceptions, policy, now) → findings with ACCEPTED_EXCEPTION where an ACTIVE, allowed exception covers them;
      expired exception → finding back to OPEN when the issue persists (§448) */
  function applyExceptions(findings, exceptions = [], p, now) {
    return findings.map(f => {
      const x = exceptions.find(e => (e.findingOrRuleRef === f.id || e.findingOrRuleRef === f.ruleId) && (!e.scopeRef || e.scopeRef === f.scopeRef || e.scopeRef === `${f.organizationId}/${f.developmentId}`));
      if (!x) return f;
      const st = exceptionState(x, now), allowed = exceptionAllowedFor(p, M.rule(p, f.ruleId)).allowed;
      if (st === 'ACTIVE' && allowed && (!x.organizationId || x.organizationId === f.organizationId)) return { ...f, status: 'ACCEPTED_EXCEPTION', exceptionRef: x.id, exceptionExpiresAt: x.expiresAt };
      return { ...f, status: f.status === 'ACCEPTED_EXCEPTION' ? 'OPEN' : f.status, exceptionRef: x.id, exceptionState: st, exceptionIgnoredReason: allowed ? st : 'NOT_WAIVABLE' };
    });
  }
  /** exceptionAllowedFor(policy, rule) → { allowed, maxDurationMs, permission, reason } — BLOCKING rules are not waivable by default (§59) */
  function exceptionAllowedFor(p, r) {
    const ep = (p.exceptionPolicies || []).find(e => e.ruleId === (r && r.id)) || (p.exceptionPolicies || []).find(e => e.ruleId === '*') || null;
    if (!ep) return { allowed: false, reason: 'DQ_POLICY_NOT_CONFIGURED', maxDurationMs: null, permission: M.PERMISSIONS.APPROVE_EXCEPTION };
    const max = durationMs(ep.maxDuration);
    if (!ep.exceptionAllowed) return { allowed: false, reason: 'DQ_EXCEPTION_NOT_ALLOWED', maxDurationMs: max, permission: ep.requiredApprovalPermission || M.PERMISSIONS.APPROVE_EXCEPTION };
    if (max == null) return { allowed: false, reason: 'DQ_POLICY_NOT_CONFIGURED', maxDurationMs: null, permission: ep.requiredApprovalPermission || M.PERMISSIONS.APPROVE_EXCEPTION };
    return { allowed: true, reason: null, maxDurationMs: max, permission: ep.requiredApprovalPermission || M.PERMISSIONS.APPROVE_EXCEPTION };
  }

  // ------------------------------------------------------------------ quality gates
  const gateOf = (p, actionCode) => p.gates.find(g => g.actionCode === actionCode) || null;
  /** gate(input) → { decision, gateId, actionCode, reasons[], findings, results, run } — default deny on unknown action */
  function gate(input = {}) {
    const actionCode = input.actionCode || 'ONBOARDING_BATCH';
    let ctx;
    try { ctx = context(input); } catch (e) { return Object.freeze({ decision: 'BLOCK', actionCode, gateId: null, reasons: [{ code: e.code || 'DQ_CONTEXT_ERROR', message: String(e.message).slice(0, 200) }], findings: [], results: [], health: 'UNKNOWN' }); }
    const p = ctx.policy, g = gateOf(p, actionCode);
    if (!g) return Object.freeze({ decision: 'BLOCK', actionCode, gateId: null, reasons: [{ code: 'DQ_GATE_UNKNOWN', message: `nenhum gate de qualidade para ${actionCode}` }], findings: [], results: [], health: 'UNKNOWN' });
    if (!p.validation.ok) return Object.freeze({ decision: 'BLOCK', actionCode, gateId: g.id, reasons: p.validation.errors.map(e => ({ code: e.code, ruleId: e.ref, message: e.message })), findings: [], results: [], health: 'UNKNOWN' });
    if (input.organizationId && p.organizationId && input.organizationId !== p.organizationId)
      return Object.freeze({ decision: 'BLOCK', actionCode, gateId: g.id, reasons: [{ code: M.ERRORS.DQ_TENANT_MISMATCH, message: 'batch de outra organização' }], findings: [], results: [], health: 'UNKNOWN' });
    const required = new Set(g.requiredRuleRefs), ids = [...g.requiredRuleRefs, ...(g.optionalRuleRefs || [])];
    const r = runSafely({ ctx, ruleIds: ids, trigger: input.trigger || (actionCode === 'ONBOARDING_BATCH' ? 'WRITE' : 'PUBLISH'), scopeRef: input.scopeRef || `${ctx.organizationId}/${ctx.developmentId}/${input.batchRef || actionCode}` });
    const findings = applyExceptions(r.findings || [], input.exceptions || [], p, ctx.now);
    const reasons = [], push = (decision, code, ruleId, message, extra = {}) => reasons.push({ decision, code, ruleId, message, ...extra });
    if (r.status === 'ERROR' && !r.results.length) push('BLOCK', 'CHECK_RUN_FAILED', null, 'a execução das regras falhou: qualidade UNKNOWN');
    if (ctx.skipped.length) push('REVIEW', 'RECORDS_NOT_NORMALIZED', null, `${ctx.skipped.length} registro(s) não puderam ser lidos`, { sample: ctx.skipped.slice(0, 10) });
    let warnings = 0;
    for (const res of r.results) {
      const req = required.has(res.ruleId), f = findings.find(x => x.ruleId === res.ruleId);
      if (res.status === 'CHECK_FAILED' || res.status === 'SKIPPED') { if (req) push(res.effectiveMode === 'ENFORCED' ? 'BLOCK' : 'REVIEW', 'CHECK_FAILED_UNKNOWN', res.ruleId, `regra não executada (${res.reason}${res.error ? ': ' + res.error : ''}): resultado UNKNOWN`); continue; }
      if (res.status === 'PASSED' && res.observations && res.observations.nonBreaking && res.observations.nonBreaking.length && req)
        push('REVIEW', 'SCHEMA_DRIFT_NON_BREAKING', res.ruleId, `${res.observations.nonBreaking.length} mudança(s) não breaking no schema da fonte: revisar mapeamento`, { changes: res.observations.nonBreaking.slice(0, 10) });
      if (res.status !== 'FAILED' || !req) continue;
      if (f && f.status === 'ACCEPTED_EXCEPTION' && g.allowExceptions) { push('PASS', 'EXCEPTION_APPLIED', res.ruleId, `exceção ${f.exceptionRef} ativa até ${f.exceptionExpiresAt}`); continue; }
      if (res.effectiveMode === 'SHADOW' || res.severity === 'INFO') continue;
      if (res.effectiveMode === 'ENFORCED' && res.severity === 'BLOCKING') push('BLOCK', 'BLOCKING_RULE_FAILED', res.ruleId, `${res.failedCount} falha(s) em ${res.evaluatedCount}`);
      else if (res.severity === 'BLOCKING' || res.severity === 'ERROR') push('REVIEW', res.reason === 'RULE_UNOWNED' ? 'UNOWNED_RULE_FAILED' : 'RULE_FAILED', res.ruleId, `${res.failedCount} falha(s) em ${res.evaluatedCount}${res.reason === 'RULE_UNOWNED' ? ' (regra sem owner: não bloqueia sozinha)' : ''}`);
      else warnings++;
    }
    if (g.allowedWarningCount != null && warnings > g.allowedWarningCount) push('REVIEW', 'WARNINGS_ABOVE_LIMIT', null, `${warnings} avisos (limite ${g.allowedWarningCount})`);
    const decision = reasons.some(x => x.decision === 'BLOCK') ? 'BLOCK' : reasons.some(x => x.decision === 'REVIEW') ? 'REVIEW' : 'PASS';
    return Object.freeze({ decision, gateId: g.id, actionCode, developmentId: ctx.developmentId, organizationId: ctx.organizationId, evaluatedAt: iso(ctx.now), policyVersions: p.policyVersions,
      reasons, findings, warningsCount: warnings, run: { id: r.id, status: r.status, ruleSetVersions: r.ruleSetVersions, trigger: r.trigger },
      results: r.results.map(x => ({ ruleId: x.ruleId, ruleVersion: x.ruleVersion, status: x.status, severity: x.severity, effectiveMode: x.effectiveMode, evaluatedCount: x.evaluatedCount, failedCount: x.failedCount, passRate: x.passRate, reason: x.reason || null })) });
  }

  // ------------------------------------------------------------------ freshness per use (§69–§77, §154–§155)
  const USES = ['DISPLAY', 'DECISION', 'TRANSACTION'], MAX_KEY = { DISPLAY: 'maxAgeForDisplay', DECISION: 'maxAgeForDecision', TRANSACTION: 'maxAgeForTransaction' };
  /** assessFreshness(policy, { sourceTimestamp, observedAt, version, currentVersion }) → FreshnessAssessment + perUse { state, allowed, behavior } */
  function assessFreshness(fpol, o = {}) {
    const observedAt = toMs(o.observedAt) ?? Date.now(), mode = fpol ? fpol.mode : 'CLOCK', behavior = u => (fpol && fpol.staleBehavior && fpol.staleBehavior[u]) || 'BLOCK';
    const perUse = {}; let ageMs;
    const decide = (u, state) => { const b = behavior(u); perUse[u] = { state, behavior: state === 'FRESH' ? null : b, allowed: state === 'FRESH' || b !== 'BLOCK', degraded: state !== 'FRESH' && b === 'DEGRADE' }; };
    if (!fpol) USES.forEach(u => decide(u, 'NOT_CONFIGURED'));
    else if (mode === 'VERSION') {
      const st = o.version == null || o.currentVersion == null ? 'UNKNOWN' : o.version === o.currentVersion ? 'FRESH' : 'STALE';
      USES.forEach(u => decide(u, st));
    } else {
      const ts = toMs(o.sourceTimestamp);
      ageMs = ts == null || Number.isNaN(ts) ? undefined : Math.max(0, observedAt - ts);
      for (const u of USES) { const max = durationMs(fpol[MAX_KEY[u]]);
        decide(u, ageMs === undefined ? 'UNKNOWN' : max == null ? 'NOT_CONFIGURED' : ageMs > max ? 'STALE' : 'FRESH'); }
    }
    const status = perUse.DISPLAY.state === 'STALE' ? 'STALE_FOR_DISPLAY' : perUse.DECISION.state === 'STALE' ? 'STALE_FOR_DECISION' : perUse.TRANSACTION.state === 'STALE' ? 'STALE_FOR_TRANSACTION'
      : USES.every(u => perUse[u].state === 'FRESH') ? 'FRESH' : 'UNKNOWN';
    return Object.freeze({ dataDomainId: (fpol && fpol.dataDomainId) || o.dataDomainId || null, sourceTimestamp: o.sourceTimestamp ?? null, observedAt: iso(observedAt), ageMs, status, mode,
      perUse: Object.freeze(perUse), policyVersion: fpol ? fpol.version : null, policyRef: fpol ? fpol.id : null });
  }
  /** domainFreshness(policy, lots, now, versions) → { [domainId]: assessment } (dataset level; availability = oldest lot timestamp) */
  function domainFreshness(p, lots, now, versions = {}) {
    const out = {};
    for (const f of p.freshnessPolicies) {
      if (f.mode === 'VERSION') {
        const key = { PRICING: ['commercial.priceTableVersion', 'priceTableVersion'], ANALYSIS: ['intelligence.analysisVersion', 'analysisVersion'], GEOMETRY: [null, 'staticVersion'], LOT_IDENTITY: [null, 'staticVersion'] }[f.dataDomainId];
        const cur = key ? versions[key[1]] : null, vals = key && key[0] ? [...new Set(lots.map(l => EV.get(l, key[0])))] : [cur];
        out[f.dataDomainId] = assessFreshness(f, { version: vals.length === 1 ? vals[0] : null, currentVersion: cur, observedAt: now });
      } else {
        const ts = lots.map(l => l.availability && toMs(l.availability.updatedAt)).filter(x => x != null && !Number.isNaN(x));
        out[f.dataDomainId] = assessFreshness(f, { sourceTimestamp: ts.length === lots.length && ts.length ? iso(Math.min(...ts)) : null, observedAt: now });
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ drift (schema / volume / distribution)
  const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  /** observeSchema(rows, { maxEnum }) → { fields: { key: { types[], nullable, enumValues? } }, rowCount } (top level + one nested level for plain objects) */
  function observeSchema(rows, o = {}) {
    const maxEnum = o.maxEnum || 12, acc = new Map();
    const see = (k, v) => { let a = acc.get(k); if (!a) { a = { types: new Set(), nulls: 0, present: 0, values: new Set(), strings: true }; acc.set(k, a); }
      a.present++; if (v === null || v === undefined) { a.nulls++; return; } a.types.add(typeOf(v)); if (typeof v === 'string') { if (a.values.size <= maxEnum) a.values.add(v); } else a.strings = false; };
    for (const r of rows || []) for (const [k, v] of Object.entries(r || {})) { see(k, v); if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) see(k + '.' + k2, v2); }
    const n = (rows || []).length, fields = {};
    for (const [k, a] of [...acc].sort((x, y) => x[0] < y[0] ? -1 : 1)) {
      fields[k] = { types: [...a.types].sort(), nullable: a.nulls > 0 || a.present < n };
      if (a.strings && a.types.size === 1 && a.types.has('string') && a.values.size <= maxEnum) fields[k].enumValues = [...a.values].sort();
    }
    return { rowCount: n, fields };
  }
  /** detectSchemaDrift(baseline, observation) → { changes[{ kind, fieldKey, breaking, detail }], breaking } */
  function detectSchemaDrift(base, obs) {
    const changes = [], B = base.fields, O = obs.fields;
    for (const k of Object.keys(B)) {
      if (!O[k]) { changes.push({ kind: 'FIELD_REMOVED', fieldKey: k, breaking: true }); continue; }
      const bt = B[k].types.filter(t => t !== 'null'), ot = O[k].types.filter(t => t !== 'null');
      if (ot.some(t => !bt.includes(t)) && ot.length) changes.push({ kind: 'TYPE_CHANGED', fieldKey: k, breaking: true, detail: `${bt.join('|')} → ${ot.join('|')}` });
      if (!B[k].nullable && O[k].nullable) changes.push({ kind: 'NULLABILITY_CHANGED', fieldKey: k, breaking: true, detail: 'passou a aceitar nulo' });
      if (B[k].enumValues && O[k].enumValues) { const add = O[k].enumValues.filter(v => !B[k].enumValues.includes(v)); if (add.length) changes.push({ kind: 'ENUM_CHANGED', fieldKey: k, breaking: false, detail: 'novos valores: ' + add.join(', ') }); }
      else if (B[k].enumValues && !O[k].enumValues && ot.includes('string')) changes.push({ kind: 'ENUM_CHANGED', fieldKey: k, breaking: false, detail: 'valores além da baseline' });
    }
    for (const k of Object.keys(O)) if (!B[k]) changes.push({ kind: 'FIELD_ADDED', fieldKey: k, breaking: false });
    return { changes, breaking: changes.some(c => c.breaking) };
  }
  /** checkVolume(policy, count, previousCount) → { breaches[], action } (tolerance null = não configurado: change check skipped) */
  function checkVolume(vp, count, previousCount) {
    const breaches = [];
    if (vp.expectedMin != null && count < vp.expectedMin) breaches.push({ code: 'BELOW_MIN', observed: count, expected: `≥ ${vp.expectedMin}` });
    if (vp.expectedMax != null && count > vp.expectedMax) breaches.push({ code: 'ABOVE_MAX', observed: count, expected: `≤ ${vp.expectedMax}` });
    const tol = vp.changeTolerancePercent;
    if (tol != null && previousCount) { const ch = Math.abs(count - previousCount) / previousCount * 100; if (ch > tol) breaches.push({ code: 'CHANGE_ABOVE_TOLERANCE', observed: `${ch.toFixed(1)}%`, expected: `≤ ${tol}%` }); }
    return { count, previousCount: previousCount ?? null, breaches, action: breaches.length ? vp.actionOnBreach : null, changeCheck: tol == null ? 'NOT_CONFIGURED' : 'EVALUATED' };
  }
  const median = xs => { const s = xs.slice().sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  const r6 = v => typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v;
  const DIST_NUM = ['geometry.areaM2', 'geometry.frontM', 'intelligence.scores.overall'], DIST_CAT = ['availability.status', 'intelligence.class', 'geometry.shape'];
  /** distributionStats(lots) → robust statistics per selected field (min, max, median, null rate, distinct, distribution) */
  function distributionStats(lots) {
    const out = { count: lots.length, fields: {} };
    for (const k of DIST_NUM) { const vs = lots.map(l => EV.get(l, k)), nums = vs.filter(v => typeof v === 'number' && Number.isFinite(v));
      out.fields[k] = { min: nums.length ? r6(Math.min(...nums)) : null, max: nums.length ? r6(Math.max(...nums)) : null, median: r6(median(nums)), nullRate: lots.length ? r6((vs.length - nums.length) / lots.length) : null }; }
    for (const k of DIST_CAT) { const d = {}; for (const l of lots) { const v = EV.get(l, k); const key = v == null ? 'null' : String(v); d[key] = (d[key] || 0) + 1; }
      out.fields[k] = { distinct: Object.keys(d).length, distribution: Object.fromEntries(Object.keys(d).sort().map(x => [x, d[x]])) }; }
    return out;
  }
  /** detectDistributionDrift(baseline, current, thresholds) → changes (threshold null = any difference asks for human review; never auto-error) */
  function detectDistributionDrift(base, cur, thresholds) {
    const changes = []; let compared = 0;
    for (const [k, b] of Object.entries(base.stats.fields)) { const c = cur.fields[k] || {};
      for (const [stat, bv] of Object.entries(b)) { compared++;
        const cv = c[stat], th = thresholds && thresholds[k] && thresholds[k][stat];
        if (stat === 'distribution') { if (stable(bv) !== stable(cv)) changes.push({ fieldRef: k, stat, baseline: stable(bv), observed: stable(cv), requiresReview: true }); continue; }
        if (typeof bv === 'number' && typeof cv === 'number' && th != null) { if (bv && Math.abs(cv - bv) / Math.abs(bv) * 100 > th) changes.push({ fieldRef: k, stat, baseline: bv, observed: cv, requiresReview: true }); }
        else if (stable(bv) !== stable(cv ?? null)) changes.push({ fieldRef: k, stat, baseline: bv, observed: cv ?? null, requiresReview: true }); } }
    if (base.stats.count !== cur.count) changes.push({ fieldRef: 'dataset', stat: 'count', baseline: base.stats.count, observed: cur.count, requiresReview: true });
    return { compared, changes, thresholdStatus: thresholds ? 'CONFIGURED' : 'NOT_CONFIGURED' };
  }

  // ------------------------------------------------------------------ reconciliation (§130–§134, §265–§270)
  /** reconcile(policy, sourceRecords, platformRecords, { now }) → DataReconciliationRun; corrections are only proposed, never applied */
  function reconcile(rp, sourceRecs, platformRecs, o = {}) {
    const now = toMs(o.now) ?? Date.now(), key = rp.comparisonKeyRefs[0], fields = rp.comparedFields || [];
    const base = { id: 'dqrec_' + fp([rp.id, rp.version, now]), policyId: rp.id, policyVersion: rp.version, dataDomainId: rp.dataDomainId,
      sourceSnapshotRef: o.sourceSnapshotRef || null, platformSnapshotRef: o.platformSnapshotRef || null, at: iso(now), automaticCorrection: rp.automaticCorrection, appliedCorrections: [] };
    if (!rp.authoritativeSourceRef && !o.allowUndeclaredSource) return Object.freeze({ ...base, status: 'FAILED', reason: M.ERRORS.DQ_SOURCE_AUTHORITY_UNDEFINED, matched: 0, mismatched: 0, missingPlatform: 0, missingSource: 0, findings: [], sampleMismatches: [], proposedCorrections: [] });
    if (!Array.isArray(sourceRecs) || !Array.isArray(platformRecs)) return Object.freeze({ ...base, status: 'FAILED', reason: 'SNAPSHOT_MISSING', matched: 0, mismatched: 0, missingPlatform: 0, missingSource: 0, findings: [], sampleMismatches: [], proposedCorrections: [] });
    const S = new Map(sourceRecs.map(r => [EV.get(r, key), r])), P = new Map(platformRecs.map(r => [EV.get(r, key), r]));
    let matched = 0, mismatched = 0; const mm = [];
    for (const [k, s] of S) { const p = P.get(k); if (!p) continue; const diffs = fields.filter(f => stable(EV.get(s, f) ?? null) !== stable(EV.get(p, f) ?? null));
      if (diffs.length) { mismatched++; for (const f of diffs) mm.push({ key: String(k), fieldRef: f, source: EV.get(s, f) ?? null, platform: EV.get(p, f) ?? null }); } else matched++; }
    const missingPlatform = [...S.keys()].filter(k => !P.has(k)), missingSource = [...P.keys()].filter(k => !S.has(k));
    const never = rp.automaticCorrection === 'NEVER' || M.NEVER_AUTOCORRECT_DOMAINS.includes(rp.dataDomainId) && !rp.derivedArtifact;
    const proposed = never ? [] : rp.automaticCorrection === 'SAFE_ONLY' ? (rp.derivedArtifact && (mm.length || missingPlatform.length) ? [{ action: 'REBUILD_DERIVED_ARTIFACT', targetRef: rp.dataDomainId, safe: true, appliedBy: 'domain service (não pelo módulo de qualidade)' }] : [])
      : mm.map(m => ({ action: 'REVIEW_AND_UPDATE_VIA_DOMAIN_SERVICE', targetRef: m.key, fieldRef: m.fieldRef, safe: false }));
    const status = mismatched || missingPlatform.length || missingSource.length ? 'DIFFERENCES' : 'MATCH';
    return Object.freeze({ ...base, status, matched, mismatched, missingPlatform: missingPlatform.length, missingSource: missingSource.length,
      findings: status === 'MATCH' ? [] : ['dqf_' + fp([rp.id, 'reconciliation', base.id])], sampleMismatches: mm.slice(0, 10), missingPlatformRefs: missingPlatform.slice(0, 10).map(String), missingSourceRefs: missingSource.slice(0, 10).map(String),
      proposedCorrections: proposed, requiresReview: status !== 'MATCH' });
  }
  /** authorityCutoverReport(policy, oldSource, newSource) → mismatch counts + decision (BLOCK until reconciled, §450) */
  function authorityCutoverReport(rp, oldRecs, newRecs, o = {}) {
    const run = reconcile({ ...rp, automaticCorrection: 'NEVER' }, oldRecs, newRecs, { ...o, allowUndeclaredSource: true });
    return Object.freeze({ policyId: rp.id, dataDomainId: rp.dataDomainId, reconciliationRunId: run.id, status: run.status, matched: run.matched, mismatched: run.mismatched,
      missingInNew: run.missingPlatform, missingInOld: run.missingSource, sampleMismatches: run.sampleMismatches, decision: run.status === 'MATCH' ? 'PASS' : 'BLOCK',
      message: run.status === 'MATCH' ? 'Fontes concordam: cutover pode seguir para aprovação.' : `Cutover bloqueado até reconciliação: ${run.mismatched} divergência(s), ${run.missingPlatform + run.missingSource} ausência(s).` });
  }

  // ------------------------------------------------------------------ health, scorecard, snapshots, metrics
  const RANK = { HEALTHY: 0, DEGRADED: 1, UNKNOWN: 2, CRITICAL: 3 };
  const openish = f => !['RESOLVED', 'ACCEPTED_EXCEPTION', 'FALSE_POSITIVE'].includes(f.status);
  /** healthSnapshot({ policy, run, freshness, findings, sloBreaches, now }) → DataHealthSnapshot (derived, never edited; UNKNOWN ≠ HEALTHY) */
  function healthSnapshot(o) {
    const p = o.policy, run = o.run || { results: [], findings: [], status: 'ERROR' }, findings = o.findings || run.findings || [], fr = o.freshness || {};
    const domains = p.domains.map(d => {
      const res = (run.results || []).filter(r => r.dataDomainId === d.id), fs = findings.filter(f => f.dataDomainId === d.id && openish(f));
      const blocking = fs.filter(f => f.severity === 'BLOCKING' && f.effectiveMode === 'ENFORCED').length;
      const relevant = fs.filter(f => f.effectiveMode !== 'SHADOW' && f.severity !== 'INFO');
      const checkFailed = res.some(r => ['CHECK_FAILED', 'SKIPPED'].includes(r.status)) || run.status === 'ERROR' && !res.length;
      const fresh = fr[d.id] || null, breaches = (o.sloBreaches || []).filter(b => b.dataDomainId === d.id && b.status === 'OPEN').length;
      let status, why;
      if (!d.active) { status = 'UNKNOWN'; why = 'NOT_MONITORED'; }
      else if (blocking) { status = 'CRITICAL'; why = 'BLOCKING_FINDINGS'; }
      else if (!res.length) { status = 'UNKNOWN'; why = 'NO_RULES_EVALUATED'; }
      else if (checkFailed) { status = 'UNKNOWN'; why = 'CHECK_FAILED'; }
      else if (fresh && d.dynamic && d.freshnessMode === 'CLOCK' && fresh.status === 'UNKNOWN') { status = 'UNKNOWN'; why = 'FRESHNESS_UNKNOWN'; }
      else if (!d.sourceOfTruthRef) { status = 'UNKNOWN'; why = 'SOURCE_AUTHORITY_UNDEFINED'; }
      else if (relevant.length || breaches || (fresh && fresh.status !== 'FRESH' && fresh.status !== 'UNKNOWN')) { status = 'DEGRADED'; why = relevant.length ? 'OPEN_FINDINGS' : breaches ? 'SLO_BREACH' : 'STALE'; }
      else { status = 'HEALTHY'; why = null; }
      return { dataDomainId: d.id, name: d.name, criticality: d.criticality, active: d.active, status, statusReason: why, openFindings: relevant.length, blockingFindings: blocking,
        failedEntities: relevant.reduce((s, f) => s + (f.failedEntityCount || 0), 0), freshnessStatus: fresh ? fresh.status : null, sloBreaches: breaches,
        rulesEvaluated: res.filter(r => ['PASSED', 'FAILED'].includes(r.status)).length, rulesPassed: res.filter(r => r.status === 'PASSED').length };
    });
    const active = domains.filter(d => d.active);
    const overall = active.some(d => d.status === 'CRITICAL') ? 'CRITICAL' : active.some(d => d.status === 'UNKNOWN' && ['CRITICAL', 'HIGH'].includes(d.criticality)) ? 'UNKNOWN'
      : active.some(d => d.status !== 'HEALTHY') ? 'DEGRADED' : 'HEALTHY';
    return Object.freeze({ organizationId: p.organizationId, developmentId: p.developmentId, generatedAt: iso(toMs(o.now) ?? Date.now()), checkRunRef: run.id || null, overallStatus: overall, domains });
  }
  /** scorecard(run, scopeRef) → dimensional scorecard: absolute counts + rule-based status; never one weighted "quality = 87%" */
  function scorecard(run, scopeRef) {
    const dims = Object.keys(M.Dimension).map(dim => {
      const rs = (run.results || []).filter(r => r.dimension === dim), ev = rs.filter(r => ['PASSED', 'FAILED'].includes(r.status));
      const failed = ev.filter(r => r.status === 'FAILED' && r.effectiveMode !== 'SHADOW' && r.severity !== 'INFO');
      const status = !rs.length ? 'UNKNOWN' : rs.some(r => ['CHECK_FAILED', 'SKIPPED'].includes(r.status)) ? 'UNKNOWN' : failed.some(r => r.severity === 'BLOCKING' && r.effectiveMode === 'ENFORCED') ? 'CRITICAL' : failed.length ? 'DEGRADED' : ev.length ? 'HEALTHY' : 'UNKNOWN';
      const evaluated = ev.reduce((s, r) => s + r.evaluatedCount, 0), passed = ev.reduce((s, r) => s + r.passedCount, 0);
      return { dimension: dim, status, statusReason: !rs.length ? 'NOT_MONITORED' : null, rules: rs.length, metricValue: evaluated ? r6(passed / evaluated) : undefined, evaluated, passed, target: undefined, findings: failed.length };
    });
    const monitored = dims.filter(d => d.statusReason !== 'NOT_MONITORED');
    const overall = monitored.some(d => d.status === 'CRITICAL') ? 'CRITICAL' : monitored.some(d => d.status === 'UNKNOWN') || !monitored.length ? 'UNKNOWN' : monitored.some(d => d.status === 'DEGRADED') ? 'DEGRADED' : 'HEALTHY';
    return Object.freeze({ scopeRef: scopeRef || run.scopeRef, checkRunRef: run.id, dimensions: dims, overallStatus: overall, overallRule: 'CRITICAL > UNKNOWN > DEGRADED > HEALTHY (sem média ponderada)' });
  }
  /** evaluateSlo(slo, observedValue, window) → NOT_CONFIGURED while target is null (no invented target, §67) */
  function evaluateSlo(slo, observedValue, w = {}) {
    if (slo.target == null) return Object.freeze({ sloId: slo.id, status: 'NOT_CONFIGURED', observedValue: observedValue ?? null, target: null, message: 'Meta não definida (necessita confirmação)' });
    if (observedValue == null) return Object.freeze({ sloId: slo.id, status: 'UNKNOWN', observedValue: null, target: slo.target });
    const ok = slo.comparator === 'GTE' ? observedValue >= slo.target : slo.comparator === 'LTE' ? observedValue <= slo.target : observedValue === slo.target;
    return Object.freeze({ sloId: slo.id, status: ok ? 'MET' : 'BREACHED', observedValue, target: slo.target,
      breach: ok ? null : { sloId: slo.id, dataDomainId: slo.dataDomainId, observedValue, windowStart: w.start || null, windowEnd: w.end || null, status: 'OPEN', incidentRef: null } });
  }
  /** sloBaseline(policy, run, lots) → observed values of the SLO metric candidates (baseline before any target, §23 of the order) */
  function sloBaseline(p, run, lots) {
    const res = id => (run.results || []).find(r => r.ruleId === id), rate = r => r && r.evaluatedCount ? r6(r.passedCount / r.evaluatedCount) : null;
    const known = lots.filter(l => l.availability && l.availability.status !== 'UNKNOWN').length;
    const values = { lot_id_uniqueness_rate: rate(res('DQ-LOT-001')) , published_lots_valid_geometry_rate: rate(res('DQ-GEO-012')),
      availability_known_and_fresh_rate: lots.length ? r6(known / lots.length) : null, lots_with_current_price_rate: rate(res('DQ-PRICE-005')), lots_with_current_analysis_rate: rate(res('DQ-ANA-001')) };
    return p.slos.map(s => ({ ...s, observedBaseline: values[s.metricCode] ?? null, evaluation: evaluateSlo(s, values[s.metricCode] ?? null) }));
  }
  /** publicationQualitySnapshot({ publicationId, runs, acceptedFindings, certificationRef, now }) → frozen, reproducible record (§432) */
  function publicationQualitySnapshot(o) {
    const s = { publicationId: o.publicationId, ruleSetVersions: [...new Set((o.runs || []).flatMap(r => r.ruleSetVersions || []))].sort(), checkRunRefs: (o.runs || []).map(r => r.id),
      checkRunStatuses: (o.runs || []).map(r => r.status), findingsAccepted: (o.acceptedFindings || []).map(f => f.id || f), certificationRef: o.certificationRef || null,
      policyVersions: (o.runs && o.runs[0] && o.runs[0].policyVersions) || null, generatedAt: iso(toMs(o.now) ?? Date.now()) };
    return M.freeze({ ...s, fingerprint: fp(s) });
  }
  /** operationalMetrics({ findings, exceptions, incidents, reconciliationRuns, health, runs, now }) → dq_* by domain (no per-user labels, §288) */
  function operationalMetrics(o = {}) {
    const now = toMs(o.now) ?? Date.now(), fs = o.findings || [], by = (xs, key) => xs.reduce((a, x) => { a[x[key]] = (a[x[key]] || 0) + 1; return a; }, {});
    const open = fs.filter(openish), resolved = fs.filter(f => f.status === 'RESOLVED' && f.resolvedAt);
    const mttr = resolved.length ? Math.round(resolved.reduce((s, f) => s + (toMs(f.resolvedAt) - toMs(f.detectedAt)), 0) / resolved.length) : null;
    return Object.freeze({
      dq_findings_open: open.length, dq_findings_open_by_domain: by(open, 'dataDomainId'), dq_findings_critical: open.filter(f => f.severity === 'BLOCKING').length,
      dq_rule_failures: (o.runs || []).reduce((s, r) => s + (r.results || []).filter(x => x.status === 'FAILED').length, 0),
      dq_check_run_total: (o.runs || []).length, dq_check_run_error_total: (o.runs || []).filter(r => r.status === 'ERROR').length,
      dq_slo_breaches: (o.sloBreaches || []).filter(b => b.status === 'OPEN').length,
      dq_reconciliation_mismatches: (o.reconciliationRuns || []).reduce((s, r) => s + (r.mismatched || 0), 0), dq_reconciliation_run_total: (o.reconciliationRuns || []).length,
      dq_stale_domains: o.health ? o.health.domains.filter(d => d.freshnessStatus && d.freshnessStatus !== 'FRESH').length : null,
      dq_exceptions_active: (o.exceptions || []).filter(x => exceptionState(x, now) === 'ACTIVE').length,
      dq_incidents_total: (o.incidents || []).length, dq_mean_time_to_resolution_ms: mttr, labels: ['dataDomainId', 'developmentId'] });
  }
  /** recommendationReadiness(health, policy) → RecommendationDataReadiness: upstream quality state for DecisionReadiness (§236–§239).
      mode OK | WARN | DEGRADE | BLOCK; a critical upstream domain is never consumed silently. */
  function recommendationReadiness(h, p) {
    const pol = (p && p.recommendationReadinessPolicy && p.recommendationReadinessPolicy.domains) || {}, R = { OK: 0, WARN: 1, DEGRADE: 2, BLOCK: 3 };
    const reasons = [];
    for (const [dom, map] of Object.entries(pol)) { const d = h.domains.find(x => x.dataDomainId === dom); if (!d) continue; const m = map[d.status] || (d.status === 'HEALTHY' ? 'OK' : 'WARN');
      if (m !== 'OK') reasons.push({ dataDomainId: dom, health: d.status, mode: m, reason: d.statusReason }); }
    const mode = reasons.reduce((a, r) => R[r.mode] > R[a] ? r.mode : a, 'OK');
    return Object.freeze({ mode, reasons, healthRef: h.checkRunRef, policyVersion: p && p.recommendationReadinessPolicy ? p.recommendationReadinessPolicy.version : null });
  }
  /** contextFromRepository(repo, { rows, now }) → gate/run input over the loaded repository (read-only) */
  const inputFromRepository = (repo, o = {}) => ({ developmentId: repo.developmentId, lots: repo.lotsSync(), rows: o.rows, now: o.now, versions: repo.getDataVersions ? repo.getDataVersions() : undefined, ...o.extra });
  /** assess(input) → full current assessment: run (all active rules), health, scorecard, freshness, SLO baseline, metrics */
  function assess(input = {}) {
    const ctx = context(input), ids = ctx.policy.rules.filter(x => x.status === 'ACTIVE' && x.executionMode !== 'EVENT_DRIVEN').map(x => x.id);
    const r = runSafely({ ctx, ruleIds: ids, trigger: input.trigger || 'SCHEDULE' }); // transaction-time (EVENT_DRIVEN) rules run in their own gates
    const freshness = domainFreshness(ctx.policy, ctx.lots, ctx.now, ctx.versions);
    const health = healthSnapshot({ policy: ctx.policy, run: r, freshness, now: ctx.now });
    return { run: r, freshness, health, scorecard: scorecard(r), slos: sloBaseline(ctx.policy, r, ctx.lots), metrics: operationalMetrics({ findings: r.findings, runs: [r], health, now: ctx.now }), policy: ctx.policy };
  }

  return { context, normalizeRows, currentVersions, priceEntriesFromLots, evaluateRule, run, runSafely, dryRun, exceptionState, exceptionAllowedFor, applyExceptions, gateOf, gate,
    assessFreshness, domainFreshness, observeSchema, detectSchemaDrift, checkVolume, distributionStats, detectDistributionDrift, reconcile, authorityCutoverReport,
    healthSnapshot, scorecard, recommendationReadiness, evaluateSlo, sloBaseline, publicationQualitySnapshot, operationalMetrics, inputFromRepository, assess, durationMs, fingerprint: fp };
})();
/** evaluateGate(batchLikeInput) → { decision: 'PASS'|'BLOCK'|'REVIEW', findings, reasons, … } — the gate topic 58 (onboarding) calls */
App.dataQuality.evaluateGate = input => App.dataQuality.engine.gate(input);
