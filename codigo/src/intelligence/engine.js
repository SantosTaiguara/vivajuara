/* intelligence/engine.js — IntelligenceEngine (topic 12).
   Pure and deterministic: LotAnalysisInput (measurements) + compiled methodology
   → LotAnalysisResult. No DOM, no network, no clock, no UI state, no mutation.
   Runs in the browser, in Node tests and in the backend vm alike.

   Phase 1 (per lot):  base-metric modules (geometry, location, mobility,
     environmental, surroundings) → criteria notes (config) → levels → scores →
     overall → profile signals → alerts → highlights.
   Phase 2 (development): classification (percentile of the unrounded overall)
     and rankings (competition ranking of the rounded scores).

   The methodology is the 2026-10-06 analysis, extracted 1:1 into the config;
   the parity test proves the engine reproduces every published value. */
App.intelligence = (() => {
  const M = App.imath, ENGINE_VERSION = '1.0.0';
  const SEC_PT = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'], SEC = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  // ---------------------------------------------------------------- base-metric modules
  // Each module: id, version, requires (input paths), produces (metric keys), run(input, cfg) → { metrics, missing }.
  const pick = (o, path) => path.split('.').reduce((x, k) => x == null ? undefined : x[k], o);
  const MODULES = [
    { id: 'geometry', version: '1.0',
      requires: ['geometry.frontWidthM', 'geometry.rearWidthM', 'geometry.depthM', 'geometry.rectangularity', 'geometry.isCorner', 'geometry.hasTwoFronts'],
      produces: ['geometry.areaM2', 'geometry.frontWidthM', 'geometry.rearWidthM', 'geometry.depthM', 'geometry.rectangularity', 'geometry.isCorner', 'geometry.hasTwoFronts', 'geometry.shapeClass', 'geometry.depthToFrontRatio'],
      run(i, m) {
        const g = i.geometry || {}, s = m.metrics.shape, wf = g.frontWidthM, wb = g.rearWidthM, dp = g.depthM, rect = g.rectangularity;
        let shape = null, ratio = null;
        if (wf != null && dp != null) ratio = dp / Math.max(wf, 1);
        if (g.isCorner === true) shape = 'CORNER';
        else if (wf != null && wb != null && rect != null && ratio != null) {
          if (Math.abs(wf - wb) / Math.max(wf, wb, 1) > s.trapezoidWidthDiffMin && rect >= s.trapezoidRectMin) shape = 'TRAPEZOIDAL';
          else if (rect < s.irregularRectMax) shape = 'IRREGULAR';
          else if (s.squareDepthRatio[0] <= ratio && ratio <= s.squareDepthRatio[1]) shape = 'SQUARE';
          else shape = 'RECTANGULAR';
        }
        return { 'geometry.areaM2': g.areaM2 ?? null, 'geometry.frontWidthM': wf ?? null, 'geometry.rearWidthM': wb ?? null, 'geometry.depthM': dp ?? null, 'geometry.rectangularity': rect ?? null,
          'geometry.isCorner': g.isCorner ?? null, 'geometry.hasTwoFronts': g.hasTwoFronts ?? null, 'geometry.shapeClass': shape, 'geometry.depthToFrontRatio': ratio };
      } },
    { id: 'location', version: '1.0',
      requires: ['location.distanceToGateLinearM', 'location.distanceToClubLinearM', 'location.distanceToPlaygroundM', 'location.distanceToSquareM', 'location.distanceToTechnicalAreaM', 'location.distanceToParkingM', 'location.distanceToExternalRoadM'],
      produces: ['location.distanceToGateLinearM', 'location.distanceToClubLinearM', 'location.distanceToPlaygroundM', 'location.distanceToSquareM', 'location.distanceToTechnicalAreaM', 'location.distanceToAdministrationM', 'location.distanceToParkingM', 'location.distanceToExternalRoadM', 'location.distanceToGreenAreaM'],
      run(i) { const l = i.location || {}; return Object.fromEntries(this.produces.map(k => [k, l[k.split('.')[1]] ?? null])); } },
    { id: 'mobility', version: '1.0',
      requires: ['mobility.routeDistanceToGateM', 'mobility.routeDistanceToLeisureM', 'mobility.vehiclesPassingEstimate'],
      produces: ['mobility.routeDistanceToGateM', 'mobility.routeDistanceToLeisureM', 'mobility.vehiclesPassingEstimate', 'mobility.estimatedTraffic', 'mobility.streetHierarchy', 'mobility.gateProximity', 'mobility.isCulDeSac'],
      run(i, m) {
        const o = i.mobility || {}, f = o.vehiclesPassingEstimate ?? null, r = o.routeDistanceToGateM ?? null, mt = m.metrics;
        const level = f == null ? null : mt.traffic.levels.find(x => x.gte == null || f >= x.gte).level;
        let street = f == null ? null : mt.streetHierarchy.find(x => x.lt == null || f < x.lt).value;
        if (o.isCulDeSac === true) street = 'CUL_DE_SAC';
        const gate = r == null ? null : mt.gateProximity.levels.find(x => x.lt == null || r < x.lt).value;
        return { 'mobility.routeDistanceToGateM': r, 'mobility.routeDistanceToLeisureM': o.routeDistanceToLeisureM ?? null, 'mobility.vehiclesPassingEstimate': f,
          'mobility.estimatedTraffic': level, 'mobility.streetHierarchy': street, 'mobility.gateProximity': gate, 'mobility.isCulDeSac': o.isCulDeSac ?? null };
      } },
    { id: 'environmental', version: '1.0', requires: ['environmental.frontBearingDeg'],
      produces: ['environmental.frontBearingDeg', 'environmental.rearBearingDeg', 'environmental.orientationFront', 'environmental.orientationRear', 'environmental.orientationLeft', 'environmental.orientationRight',
        'environmental.morningSun', 'environmental.afternoonSun', 'environmental.northSunSide', 'environmental.eastSide', 'environmental.strongAfternoonSun', 'environmental.strongAfternoonSide'],
      run(i, m) {
        const fb = i.environmental && i.environmental.frontBearingDeg;
        if (fb == null) return Object.fromEntries(this.produces.map(k => [k, null]));
        const s = m.metrics.solar, bb = M.pyMod(fb + 180, 360), D = M.angDiff;
        const sides = [['FRONT', fb], ['BACK', bb], ['SIDE', M.pyMod(fb + 90, 360)], ['SIDE', M.pyMod(fb + 270, 360)]], ORD = ['FRONT', 'BACK', 'SIDE'];
        const lit = target => [...new Set(sides.filter(([, b]) => D(b, target) <= s.sideWindowDeg).map(([n]) => n))].sort((a, b) => ORD.indexOf(a) - ORD.indexOf(b));
        const strongF = D(fb, s.strongAfternoonBearing) <= s.strongAfternoonWindowDeg, strongB = D(bb, s.strongAfternoonBearing) <= s.strongAfternoonWindowDeg;
        return { 'environmental.frontBearingDeg': fb, 'environmental.rearBearingDeg': bb,
          'environmental.orientationFront': M.sector(fb, SEC), 'environmental.orientationRear': M.sector(bb, SEC),
          'environmental.orientationLeft': M.sector(fb + 90, SEC), 'environmental.orientationRight': M.sector(fb + 270, SEC),
          'environmental.morningSun': lit(90), 'environmental.afternoonSun': lit(270),
          'environmental.northSunSide': D(bb, 0) <= s.northSunWindowDeg ? 'BACK' : D(fb, 0) <= s.northSunWindowDeg ? 'FRONT' : 'SIDE',
          'environmental.eastSide': D(fb, 90) <= s.eastWindowDeg ? 'FRONT' : D(bb, 90) <= s.eastWindowDeg ? 'BACK' : 'SIDE',
          'environmental.strongAfternoonSun': strongF || strongB, 'environmental.strongAfternoonSide': strongF ? 'FRONT' : strongB ? 'BACK' : null };
      } },
    { id: 'surroundings', version: '1.0', requires: ['surroundings.rearSequence', 'surroundings.rearVegetationShare'],
      produces: ['surroundings.rearToken', 'surroundings.rearClass', 'surroundings.isPerimeter', 'surroundings.hasGreenRear', 'surroundings.viewBase', 'surroundings.rearVegetationShare', 'construction.adjacentToProjectedEasement'],
      run(i, m) {
        const s = i.surroundings || {}, R = m.metrics.rearSequence, seq = s.rearSequence, vg = s.rearVegetationShare ?? 0, two = !!(i.geometry && i.geometry.hasTwoFronts);
        const easement = i.construction ? (i.construction.adjacentToProjectedEasement ?? null) : null;
        if (!Array.isArray(seq)) return { 'surroundings.rearToken': null, 'surroundings.rearClass': null, 'surroundings.isPerimeter': null, 'surroundings.hasGreenRear': null, 'surroundings.viewBase': null, 'surroundings.rearVegetationShare': s.rearVegetationShare ?? null, 'construction.adjacentToProjectedEasement': easement };
        const f = seq.filter(t => !R.ignore.includes(t));
        const tok = !f.length ? 'outro' : f[0] === 'perimetro' ? (f.length > 1 && f[1] === 'fora' ? 'fora' : 'perimetro') : f[0];
        const perim = R.perimeterTokens.includes(tok), green = perim && vg >= R.greenVegetationShareMin;
        const cls = tok === 'lote' ? 'LOT' : tok === 'verde' ? 'CONDO_GREEN' : perim ? (green ? 'GREEN_EXTERNAL' : 'PERIMETER') : tok === 'ac' ? 'COMMON_AREA' : tok === 'rua' ? 'STREET' : 'UNKNOWN';
        const view = tok === 'verde' ? 'CONDO_PARK' : green ? 'FOREST_EXTERNAL' : perim ? 'OPEN_EXTERNAL' : two ? 'STREET_BOTH_SIDES' : 'INTERNAL';
        return { 'surroundings.rearToken': tok, 'surroundings.rearClass': cls, 'surroundings.isPerimeter': perim, 'surroundings.hasGreenRear': green || tok === 'verde',
          'surroundings.viewBase': view, 'surroundings.rearVegetationShare': s.rearVegetationShare ?? null, 'construction.adjacentToProjectedEasement': easement };
      } }
  ];
  const METRIC_KEYS = Object.freeze([...new Set(MODULES.flatMap(m => m.produces))]);
  // later modules (config-driven): criteria → levels → scoring → overall → profiles → alerts → highlights; phase 2: classification, ranking
  const PIPELINE = Object.freeze([
    ...MODULES.map(m => ({ id: m.id, version: m.version, phase: 1, requires: m.requires, produces: m.produces })),
    { id: 'criteria', version: '1.0', phase: 1, requires: ['metrics'], produces: ['notes'] },
    { id: 'levels', version: '1.0', phase: 1, requires: ['notes'], produces: ['levels'] },
    { id: 'scoring', version: '1.0', phase: 1, requires: ['notes'], produces: ['scores', 'criteriaResults'] },
    { id: 'overall', version: '1.0', phase: 1, requires: ['scores'], produces: ['overall'] },
    { id: 'profiles', version: '1.0', phase: 1, requires: ['notes', 'scores', 'metrics'], produces: ['profileSignals'] },
    { id: 'alerts', version: '1.0', phase: 1, requires: ['notes', 'metrics'], produces: ['alerts'] },
    { id: 'highlights', version: '1.0', phase: 1, requires: ['notes', 'metrics', 'levels'], produces: ['highlights'] },
    { id: 'classification', version: '1.0', phase: 2, requires: ['overall'], produces: ['class'] },
    { id: 'ranking', version: '1.0', phase: 2, requires: ['scores', 'overall'], produces: ['rankings'] }
  ]);
  /** dependency graph check (no cycles, every requirement produced earlier) */
  function moduleOrder() {
    const produced = new Set(['input']), order = [];
    for (const m of PIPELINE) {
      const missing = m.phase === 1 && MODULES.some(x => x.id === m.id) ? [] : m.requires.filter(r => !produced.has(r) && r !== 'metrics');
      if (missing.length) { const e = new Error(`módulo ${m.id} depende de ${missing.join(', ')} ainda não produzido`); e.code = 'CYCLE'; throw e; }
      m.produces.forEach(p => produced.add(p)); if (MODULES.some(x => x.id === m.id)) produced.add('metrics'); order.push(m.id);
    }
    return order;
  }

  const nonFinite = [];
  const cleanNum = (v, path, diag) => { if (typeof v === 'number' && !Number.isFinite(v)) { diag.push({ level: 'ERROR', code: 'NON_FINITE_VALUE', path, message: 'valor não finito descartado' }); return null; } return v; };

  // ---------------------------------------------------------------- phase 1
  function phase1(input, ctx) {
    const cfg = ctx.methodology, diag = [], missing = new Set();
    if (!input || !input.lotId) { const e = new Error('LotAnalysisInput sem lotId'); e.code = 'INVALID_INPUT'; throw e; }
    // base metrics
    const metrics = {};
    for (const mod of MODULES) {
      try {
        for (const r of mod.requires) if (pick(input, r) == null) missing.add(r);
        Object.assign(metrics, mod.run(input, cfg));
      } catch (e) { diag.push({ level: 'ERROR', code: 'MODULE_FAILED', module: mod.id, message: e.message }); mod.produces.forEach(k => { if (!(k in metrics)) metrics[k] = null; }); }
    }
    // criteria notes (config)
    const notes = {}, trace = {};
    const read = k => Object.prototype.hasOwnProperty.call(notes, k) ? notes[k] : (metrics[k] ?? null);
    const adjustments = cfg.lotAdjustments[input.code] || [];
    for (const c of cfg.criteria) {
      let acc = null, ok = true; const steps = [];
      for (const s of c.steps) {
        const r = s.fn(acc, s, read, { adjustments, criterionId: c.id });
        if (r.missing) { r.missing.forEach(k => missing.add(k)); ok = false; diag.push({ level: 'WARNING', code: 'MISSING_INPUT', criterion: c.id, message: `sem ${r.missing.join(', ')}` }); break; }
        if (r.unknownEnum) { ok = false; diag.push({ level: 'WARNING', code: 'UNKNOWN_ENUM', criterion: c.id, message: `${r.unknownEnum.key} = ${r.unknownEnum.value}` }); break; }
        acc = r.value;
        if (r.applied) steps.push({ op: s.op, reason: s.reason || null, delta: r.delta, input: r.input ?? null, adjustments: r.adjustments || undefined });
        if (r.usedMissingValue) steps.push({ op: s.op, reason: 'DECLARED_MISSING_VALUE', delta: null, input: null });
      }
      notes[c.id] = ok ? cleanNum(acc, 'notes.' + c.id, diag) : null; trace[c.id] = steps;
    }
    // levels (derived descriptors of notes)
    const levels = {};
    for (const [k, l] of Object.entries(cfg.levels)) { const v = notes[l.from]; levels[k] = v == null ? null : l.levels.find(x => x.gte == null || v >= x.gte).value; }
    // scores
    const scores = {}, criteriaResults = {};
    for (const s of cfg.scores) {
      const items = s.criteria.map(c => ({ criterion: c.criterion, weight: c.weight, value: notes[c.criterion] }));
      const present = items.filter(x => x.value != null), coverage = present.reduce((a, x) => a + x.weight, 0) / items.reduce((a, x) => a + x.weight, 0);
      let raw = null, status = 'COMPLETE';
      if (present.length < items.length && (s.missingPolicy === 'BLOCK_SCORE' || coverage < s.minCoverage)) status = 'INSUFFICIENT_DATA';
      else {
        let sum = 0, wsum = 0;
        for (const x of items) {
          if (x.value == null) { if (s.missingPolicy === 'NEUTRAL') sum += 5 * x.weight; else if (s.missingPolicy === 'IGNORE_AND_RENORMALIZE') continue; wsum += x.weight; continue; }
          sum += x.value * x.weight; wsum += x.weight;
        }
        if (s.missingPolicy === 'IGNORE_AND_RENORMALIZE' && wsum > 0 && wsum !== 1) sum = sum / wsum;
        if (s.aggregation === 'WEIGHTED_AVERAGE' && wsum > 0) sum = sum / wsum;
        raw = s.scale * sum; status = present.length < items.length ? 'PARTIAL' : 'COMPLETE';
      }
      const value = raw == null ? null : s.rounding === 'HALF_EVEN' ? M.roundHalfEven(raw) : raw;
      scores[s.id] = cleanNum(value, 'scores.' + s.id, diag);
      criteriaResults[s.id] = { scoreId: s.id, value: scores[s.id], raw, status, coverage, methodologyVersion: cfg.methodologyVersion,
        criteria: items.map(x => ({ criterionId: x.criterion, fieldKey: cfg.criteriaById[x.criterion].fieldKey, weight: x.weight, value: x.value,
          contribution: x.value == null ? null : s.scale * x.value * x.weight, status: x.value == null ? 'MISSING' : 'OK', reasons: trace[x.criterion] })) };
    }
    // overall (from the rounded scores, as published)
    let overallRaw = 0; const comps = cfg.overall.components;
    if (comps.some(c => scores[c.score] == null)) overallRaw = null;
    else for (const c of comps) overallRaw += c.weight * scores[c.score];
    scores.overall = overallRaw == null ? null : M.roundHalfEven(overallRaw);
    // profile signals (ideal customer profiles)
    const profileSignals = profilesOf(cfg, notes, scores, metrics);
    // alerts (codes + params; wording lives in the text adapter)
    const alerts = [];
    for (const rule of cfg.alerts) if (cond(rule.when, notes, metrics)) alerts.push(alertOf(rule.type, notes, metrics, levels, trace));
    const confidence = cfg.confidence ? (cfg.confidence.map[input.measurementConfidence || 'HIGH'] || 'UNKNOWN') : 'UNKNOWN';
    return { input, metrics, notes, trace, levels, scores, overallRaw, criteriaResults, profileSignals, alerts, confidence, diag, missing: [...missing].sort() };
  }
  function cond(w, notes, metrics) {
    if (!w) return false;
    if (w.any) return w.any.some(x => cond(x, notes, metrics));
    if (w.all) return w.all.every(x => cond(x, notes, metrics));
    const v = w.criterion ? notes[w.criterion] : metrics[w.field];
    if (w.isNull) return v == null;
    if (v == null) return false;
    if ('eq' in w) return v === w.eq; if (w.in) return w.in.includes(v);
    if ('lt' in w) return v < w.lt; if ('lte' in w) return v <= w.lte; if ('gt' in w) return v > w.gt; if ('gte' in w) return v >= w.gte;
    return false;
  }
  function alertOf(type, notes, m, levels, trace) {
    const sev = (App.rules.ALERTS[type] || App.rules.ALERTS.OTHER).severity;
    const params = {};
    if (type === 'NOISE') params.sources = (trace.quiet || []).filter(s => s.reason && s.reason.startsWith('NOISE_SOURCE_')).map(s => ({ source: s.reason.replace('NOISE_SOURCE_', ''), distanceM: s.reason === 'NOISE_SOURCE_STREET_FLOW' ? null : s.input, level: s.reason === 'NOISE_SOURCE_STREET_FLOW' ? s.input : null }));
    if (type === 'PRIVACY') Object.assign(params, { isCorner: m['geometry.isCorner'], hasTwoFronts: m['geometry.hasTwoFronts'], traffic: m['mobility.estimatedTraffic'] });
    if (type === 'AFTERNOON_SUN') params.side = m['environmental.strongAfternoonSide'];
    if (type === 'TECHNICAL_AREA') params.distanceM = m['location.distanceToTechnicalAreaM'];
    if (type === 'AVENUE') params.distanceM = m['location.distanceToExternalRoadM'];
    if (type === 'TRAFFIC') params.traffic = m['mobility.estimatedTraffic'];
    if (type === 'GEOMETRY') Object.assign(params, { shapeClass: m['geometry.shapeClass'], hasTwoFronts: m['geometry.hasTwoFronts'], frontWidthM: m['geometry.frontWidthM'], narrowFront: m['geometry.frontWidthM'] != null && m['geometry.frontWidthM'] < 9 });
    return { type, reasonCode: 'ALERT_' + type, severity: sev, params, fieldKey: (App.rules.ALERTS[type] || {}).fieldKey || null };
  }
  function profilesOf(cfg, notes, scores, metrics) {
    const P = cfg.profiles; if (!P) return [];
    const vals = P.items.map(p => {
      let v = null;
      if (p.fromScore) v = scores[p.fromScore] == null ? null : scores[p.fromScore] / p.divide;
      else {
        let sum = 0;
        for (const t of p.terms) {
          const x = t.inputBoolean ? (metrics[t.inputBoolean] == null ? null : metrics[t.inputBoolean] ? t.ifTrue : t.ifFalse) : notes[t.input];
          if (x == null) { sum = null; break; } sum += x * t.weight;
        }
        v = sum == null ? null : sum + (p.offset || 0);
      }
      return { id: p.id, value: v };
    }).filter(x => x.value != null);
    const s = vals.slice().sort((a, b) => b.value - a.value);
    if (!s.length) return [];
    return s[1] && s[1].value >= s[0].value - P.secondWithin ? [s[0], s[1]] : [s[0]];
  }

  // ---------------------------------------------------------------- projection used by highlights (published precision)
  function publishedView(p) {
    const n = p.notes, m = p.metrics, R = M.roundTo, rd = v => v == null ? null : M.roundHalfEven(v);
    const shape = m['geometry.shapeClass'] === 'CORNER' ? 'UNKNOWN' : m['geometry.shapeClass'];
    return {
      surroundings: { hasGreenRear: m['surroundings.hasGreenRear'] },
      environmental: { quietScore: R(n.quiet, 1), privacyScore: R(n.privacy, 1), northSunSide: m['environmental.northSunSide'] },
      mobility: { estimatedTraffic: m['mobility.estimatedTraffic'], gateProximity: m['mobility.gateProximity'], routeDistanceToLeisureM: rd(m['mobility.routeDistanceToLeisureM']) },
      geometry: { areaM2: m['geometry.areaM2'], shape, usableGeometryClass: p.levels['geometry.usableGeometryClass'] }
    };
  }
  function highlightsOf(p) {
    const view = publishedView(p);
    return App.rules.HIGHLIGHTS.filter(h => { try { return h.test(view); } catch (e) { return false; } }).sort((a, b) => b.weight - a.weight)
      .map(h => ({ id: `${p.input.lotId}-${h.type}`, type: h.type, reasonCode: 'HIGHLIGHT_' + h.type, fieldKey: h.fieldKey, weight: h.weight }));
  }

  // ---------------------------------------------------------------- phase 2 + result
  function inputChecksum(input) { return App.methodology.checksum(input); }
  function classify(cfg, partials) {
    // stable sort by the unrounded overall, ties keep lot order (block, number), as in the original
    const lotOrder = (a, b) => a.input.blockId < b.input.blockId ? -1 : a.input.blockId > b.input.blockId ? 1 : a.input.lotNumber - b.input.lotNumber;
    const valid = partials.filter(p => p.overallRaw != null).slice().sort(lotOrder).sort((a, b) => b.overallRaw - a.overallRaw);
    const n = valid.length, out = new Map(), bands = cfg.classification.bands;
    valid.forEach((p, i) => { const q = M.percentilePosition(i, n); out.set(p.input.lotId, bands.find(b => b.below == null || q < b.below).class); });
    return out;
  }
  function rank(cfg, partials) {
    const out = new Map(partials.map(p => [p.input.lotId, []]));
    for (const [type, key] of Object.entries(cfg.ranking.scores)) {
      const r = M.competitionRank(partials.map(p => ({ key: p.input.lotId, value: p.scores[key] })), cfg.ranking.order);
      for (const [id, v] of r) out.get(id).push({ type, position: v.position, total: v.total });
    }
    return out;
  }
  function result(p, cls, rankings, ctx) {
    const cfg = ctx.methodology, diag = p.diag.slice();
    const status = diag.some(d => d.level === 'ERROR') ? 'PARTIAL' : Object.values(p.scores).some(v => v == null) ? 'PARTIAL' : 'COMPLETE';
    const iv = ctx.inputVersion || null, ic = inputChecksum(p.input);
    const r = {
      lotId: p.input.lotId, code: p.input.code, status,
      methodologyId: cfg.methodologyId, methodologyVersion: cfg.methodologyVersion, analysisVersion: `${cfg.methodologyVersion}+${cfg.checksum}`, engineVersion: ENGINE_VERSION,
      generatedAt: ctx.generatedAt || null,
      notes: { ...p.notes }, scores: { ...p.scores }, overallRaw: p.overallRaw, class: cls == null ? 'UNKNOWN' : cls, rankings: rankings || [],
      levels: { ...p.levels }, descriptors: descriptorsOf(p), metrics: { ...p.metrics } /* topic 36: unrounded base metrics, read by the rule engine facts (additive) */, criteriaResults: p.criteriaResults, criteriaTrace: p.trace,
      highlights: highlightsOf(p), attentionPoints: p.alerts.filter(a => a.severity !== 'INFO').map(a => ({ type: a.type, severity: a.severity, reasonCode: a.reasonCode })),
      alerts: p.alerts, profileSignals: p.profileSignals, confidence: p.confidence,
      explanations: Object.values(p.criteriaResults).map(c => ({ scoreId: c.scoreId, value: c.value, contributions: c.criteria.map(x => ({ criterionId: x.criterionId, weight: x.weight, contribution: x.contribution })) })),
      missingInputs: p.missing,
      provenance: { methodologyChecksum: cfg.checksum, inputVersion: iv, inputChecksum: ic, sourceIds: ctx.sourceIds || [], phase2: cls == null ? 'NOT_RUN' : ctx.reference ? 'REFERENCE' : 'BATCH' },
      diagnostics: diag
    };
    return App.domain.deepFreeze(r);
  }
  function descriptorsOf(p) {
    const m = p.metrics, pick = ks => Object.fromEntries(ks.map(k => [k, m[k] ?? null]));
    return pick(['geometry.shapeClass', 'geometry.depthToFrontRatio', 'surroundings.rearClass', 'surroundings.hasGreenRear', 'surroundings.isPerimeter', 'surroundings.viewBase',
      'mobility.estimatedTraffic', 'mobility.streetHierarchy', 'mobility.gateProximity', 'environmental.orientationFront', 'environmental.orientationRear', 'environmental.orientationLeft', 'environmental.orientationRight',
      'environmental.morningSun', 'environmental.afternoonSun', 'environmental.northSunSide', 'environmental.eastSide', 'environmental.strongAfternoonSun']);
  }

  /** analyzeDevelopment(inputs, ctx) → { results, report }. Order of the inputs never changes the output. */
  function analyzeDevelopment(inputs, ctx = {}) {
    if (!ctx.methodology) throw Object.assign(new Error('metodologia compilada obrigatória'), { code: 'MISSING_METHODOLOGY' });
    moduleOrder();
    const seen = new Set(), partials = [];
    for (const i of inputs) { if (seen.has(i.lotId)) throw Object.assign(new Error('lote repetido: ' + i.lotId), { code: 'DUPLICATE_LOT' }); seen.add(i.lotId); partials.push(phase1(i, ctx)); }
    const cls = classify(ctx.methodology, partials), rk = rank(ctx.methodology, partials);
    const sorted = partials.slice().sort((a, b) => a.input.blockId < b.input.blockId ? -1 : a.input.blockId > b.input.blockId ? 1 : a.input.lotNumber - b.input.lotNumber);
    const results = sorted.map(p => result(p, cls.get(p.input.lotId) || null, rk.get(p.input.lotId), ctx));
    const reference = { overall: sorted.map(p => ({ lotId: p.input.lotId, blockId: p.input.blockId, lotNumber: p.input.lotNumber, overallRaw: p.overallRaw, scores: { ...p.scores } })) };
    return { results, reference, report: reportOf(results, ctx) };
  }
  /** analyzeLot(input, ctx): phase 1 always; phase 2 only against ctx.reference (the development's distribution), else class/rankings are left UNKNOWN with a diagnostic. */
  function analyzeLot(input, ctx = {}) {
    if (!ctx.methodology) throw Object.assign(new Error('metodologia compilada obrigatória'), { code: 'MISSING_METHODOLOGY' });
    const p = phase1(input, ctx);
    if (!ctx.reference) { p.diag.push({ level: 'INFO', code: 'REQUIRES_DEVELOPMENT_CONTEXT', message: 'classe e rankings dependem dos outros lotes' }); return result(p, null, [], ctx); }
    const others = ctx.reference.overall.filter(o => o.lotId !== input.lotId).map(o => ({ input: { lotId: o.lotId, blockId: o.blockId, lotNumber: o.lotNumber }, overallRaw: o.overallRaw, scores: o.scores }));
    const all = [...others, p];
    return result(p, classify(ctx.methodology, all).get(input.lotId) || null, rank(ctx.methodology, all).get(input.lotId), ctx);
  }
  function reportOf(results, ctx) {
    const by = k => results.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
    const missing = {}; results.forEach(r => r.missingInputs.forEach(k => missing[k] = (missing[k] || 0) + 1));
    return { lotCount: results.length, methodologyVersion: ctx.methodology.methodologyVersion, methodologyChecksum: ctx.methodology.checksum, status: by('status'), classes: by('class'),
      missingInputs: missing, errors: results.reduce((n, r) => n + r.diagnostics.filter(d => d.level === 'ERROR').length, 0) };
  }
  /** catalog for the docs: module → inputs, outputs, version */
  const catalog = () => PIPELINE.map(m => ({ ...m }));
  return Object.freeze({ ENGINE_VERSION, MODULES: PIPELINE, METRIC_KEYS, analyzeLot, analyzeDevelopment, moduleOrder, catalog, SEC_PT });
})();
