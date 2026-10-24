/* data/legacyAdapter.js
   LegacyLotAdapter (Normalizer): the only place that knows the field names and
   wording of the current lots.json. It turns one raw record into the canonical
   Lot structure declared in domain/model.js (without the commercial part, which
   comes from the price table) and reports warnings and unmapped fields.
   It cleans; LotFactory validates and freezes. No legacy key leaks past this file. */
App.legacy = (() => {
  // Legacy wording → enum. Each map is total for the current dataset; anything
  // else becomes a warning and a null value, never a guess.
  const MAP = {
    level: { 'Muito baixo': 'VERY_LOW', 'Muito baixa': 'VERY_LOW', 'Baixo': 'LOW', 'Baixa': 'LOW', 'Médio': 'MEDIUM', 'Média': 'MEDIUM', 'Alto': 'HIGH', 'Alta': 'HIGH', 'Muito alto': 'VERY_HIGH', 'Muito alta': 'VERY_HIGH' },
    cls: { 'A+': 'A_PLUS', 'A': 'A', 'B': 'B', 'C': 'C', 'D': 'D' },
    dir: { N: 'N', NE: 'NE', L: 'E', SE: 'SE', S: 'S', SO: 'SW', O: 'W', NO: 'NW' },
    // forma mixes shape and corner: "Esquina" says nothing about the polygon's shape.
    shape: { 'Retangular': 'RECTANGULAR', 'Quadrado': 'SQUARE', 'Trapezoidal': 'TRAPEZOIDAL', 'Irregular': 'IRREGULAR', 'Esquina': 'UNKNOWN',
      'Retangular (frente para duas ruas)': 'RECTANGULAR', 'Esquina (frente para duas ruas)': 'UNKNOWN' },
    pos: { 'Interno': 'INTERNAL', 'Esquina': 'CORNER', 'Frente para duas ruas': 'DOUBLE_FRONT' },
    efic: { 'Boa': 'GOOD', 'Média': 'MEDIUM', 'Baixa': 'LOW' },
    conf: { 'Alta': 'HIGH', 'Média': 'MEDIUM', 'Baixa': 'LOW' },
    // rear: [NeighborType, sourceId, perimeter?]
    rear: {
      'Outro lote': ['LOT', 'kmz-v1', false], 'Fora do perímetro: área externa aberta (imagem aérea)': ['EXTERNAL_PROPERTY', 'aerial-v1', true],
      'Fora do perímetro: mata/vegetação densa (imagem aérea)': ['EXTERNAL_GREEN', 'aerial-v1', true], 'Parque florestal / área verde do condomínio (KMZ)': ['GREEN_AREA', 'kmz-v1', false],
      'Rua (lote com frente para duas ruas)': ['STREET', 'kmz-v1', false], 'Não foi possível determinar': ['UNKNOWN', null, false]
    },
    side: { 'Outro lote': 'LOT', 'Rua': 'STREET', 'Área comum': 'COMMON_AREA', 'Parque florestal / área verde': 'GREEN_AREA', 'Limite do condomínio': 'CONDO_BOUNDARY', 'Não determinado': 'UNKNOWN' },
    // closure: [RearCondition, DataStatus, sourceId]
    closure: {
      'Divisa com outro lote (não é perímetro)': ['LOT_BOUNDARY', 'CALCULATED', 'kmz-v1'], 'Muro (conforme evento de lançamento) – necessita confirmação': ['WALL', 'TO_CONFIRM', 'launch-event-v1'],
      'Gradil (lotes com APP/mata atrás, conforme evento de lançamento) – necessita confirmação': ['FENCE', 'TO_CONFIRM', 'launch-event-v1'], 'Não informado – necessita confirmação': ['UNKNOWN', 'UNKNOWN', null]
    },
    // vista mixes type and permanence: [ViewType, ViewPermanence, ViewDetail]
    view: {
      'Vista interna (lotes vizinhos)': ['INTERNAL', 'UNKNOWN', 'INTERNAL'], 'Vista interna (lotes vizinhos); frente próxima a praça/clube': ['INTERNAL', 'UNKNOWN', 'INTERNAL_NEAR_SQUARE'],
      'Vista aberta para área externa (pode ser ocupada no futuro)': ['OPEN', 'NOT_GUARANTEED', 'OPEN_EXTERNAL'],
      'Vista para mata fora do perímetro (atual; permanência não confirmada)': ['GREEN', 'NOT_GUARANTEED', 'FOREST_EXTERNAL'],
      'Vista para parque florestal do condomínio (atual; manutenção como área verde a confirmar)': ['GREEN', 'LIKELY', 'CONDO_PARK'],
      'Vista para rua nos dois lados': ['URBAN', 'UNKNOWN', 'STREET_BOTH_SIDES']
    },
    gate: { 'Muito próximo': 'VERY_CLOSE', 'Próximo': 'CLOSE', 'Intermediário': 'INTERMEDIATE', 'Distante': 'FAR' },
    road: { 'Principal (acesso de muitos lotes à portaria/clube)': 'MAIN', 'Secundária (passagem de outros moradores)': 'SECONDARY', 'Local': 'LOCAL',
      'Local (poucos veículos de passagem)': 'LOCAL_QUIET', 'Final de rua sem saída (balão de retorno)': 'CUL_DE_SAC' },
    sunSide: { frente: 'FRONT', fundos: 'BACK', lateral: 'SIDE' },
    northSun: { 'Fundos (recebem sol do norte: bom para piscina e área de lazer)': 'BACK',
      'Frente/recuo frontal recebe o sol do norte; nos fundos a piscina tende a ter mais sombra': 'FRONT', 'Lateral voltada para o norte, conforme projeto': 'SIDE' },
    eastSide: { 'Lado leste (sol da manhã): fundos': 'BACK', 'Lado leste (sol da manhã): frente': 'FRONT', 'Lado leste (sol da manhã): lateral leste': 'SIDE' },
    // noise: [NoiseSourceType, detail, relevance] — relevance only where the analysis states it (street flow level)
    noise: { 'Av. Porto Dourado': ['EXTERNAL_ROAD', 'AVENUE', null], 'fluxo médio na rua': ['INTERNAL_ROAD', 'STREET_FLOW', 'MEDIUM'], 'fluxo alto na rua': ['INTERNAL_ROAD', 'STREET_FLOW', 'HIGH'],
      'fluxo muito alto na rua': ['INTERNAL_ROAD', 'STREET_FLOW', 'VERY_HIGH'], 'praça': ['LEISURE', 'SQUARE', null], 'playground': ['LEISURE', 'PLAYGROUND', null], 'clube': ['LEISURE', 'CLUB', null],
      'portaria': ['GATE', 'GATE', null], 'EEEB': ['TECHNICAL_AREA', 'PUMP_STATION', null], 'estacionamento': ['PARKING', 'PARKING', null] },
    alert: { 'TRÁFEGO': 'TRAFFIC', 'SOL DA TARDE': 'AFTERNOON_SUN', 'RESTRIÇÃO CONSTRUTIVA': 'BUILDING_RESTRICTION', 'PRIVACIDADE': 'PRIVACY', 'AVENIDA': 'AVENUE',
      'RUÍDO': 'NOISE', 'ÁREA TÉCNICA': 'TECHNICAL_AREA', 'GEOMETRIA': 'GEOMETRY', 'SERVIDÃO': 'EASEMENT' },
    profile: { 'Moradia e tranquilidade': 'QUIET_LIVING', 'Idosos / mobilidade': 'ELDERLY_MOBILITY', 'Investidor': 'INVESTOR', 'Família com crianças': 'FAMILY',
      'Cliente que valoriza natureza': 'NATURE', 'Alto padrão': 'HIGH_END' },
  };
  // Every legacy key and where it goes (LEGACY_FIELD_MAPPING is generated from this and the registry).
  const LEGACY_KEYS = {
    id: 'identity.code', did: 'identity.id', q: 'identity.blockId', n: 'identity.lotNumber', a: 'geometry.areaM2', p: 'geometry.polygon', c: null /* vertex mean, replaced by geometry.centroid */,
    lat: 'location.latitude', lon: 'location.longitude', wf: 'geometry.frontBoxWidthM', fr: 'geometry.frontM', edgeF: 'geometry.frontEdgesM', wb: 'geometry.rearM', edgeB: 'geometry.rearEdgesM',
    dp: 'geometry.averageDepthM', sideE: 'geometry.leftDepthM', sideD: 'geometry.rightDepthM', forma: 'geometry.shape', pos: 'location.blockPosition', efic: 'geometry.usableGeometryClass',
    mconf: 'geometry.measurementConfidence', az: 'environmental.frontBearingDeg', fs: 'environmental.orientationFront', bs: 'environmental.orientationRear', lat_s: 'environmental.orientationLeft',
    manha: 'environmental.morningSun', tarde: 'environmental.afternoonSun', lazer: 'environmental.northSunSide', quartos: 'environmental.eastSide', fundo: 'surroundings.rearNeighborType',
    fech: 'surroundings.rearCondition', mata: 'surroundings.hasGreenRear', vista: 'surroundings.viewType', dport: 'location.distanceToGateLinearM', rport: 'mobility.routeDistanceToGateM',
    portc: 'mobility.gateProximity', dclube: 'location.distanceToClubLinearM', rclube: 'mobility.routeDistanceToLeisureM', dplay: 'location.distanceToPlaygroundM', dpraca: 'location.distanceToSquareM',
    deeeb: 'location.distanceToTechnicalAreaM', dav: 'location.distanceToExternalRoadM', dpark: 'location.distanceToGreenAreaM', flow: 'mobility.vehiclesPassingEstimate', fc: 'mobility.estimatedTraffic',
    via: 'mobility.streetHierarchy', fontes: 'environmental.noiseSources', ruido: 'environmental.noiseLevel', priv: 'environmental.privacyLevel', liq: 'intelligence.liquidity', nt: 'intelligence.notes',
    sm: 'intelligence.scores.housing', si: 'intelligence.scores.investment', sf: 'intelligence.scores.family', sp: 'intelligence.scores.premium', sg: 'intelligence.scores.overall', cl: 'intelligence.class',
    conf: 'intelligence.confidence', perfil: 'intelligence.idealProfiles', al: 'intelligence.alerts', vzE: 'surroundings.leftNeighborType', vzD: 'surroundings.rightNeighborType', st: 'availability.status', stAt: 'availability.updatedAt'
  };
  const NOTE_KEYS = { priv: 'environmental.privacyScore', sil: 'environmental.quietScore', sol: 'environmental.solarScore', vista: 'environmental.viewScore', geo: 'geometry.usableGeometryScore',
    laz: 'intelligence.notes.leisure', port: 'intelligence.notes.gate', flux: 'intelligence.notes.lowTraffic', liq: 'intelligence.notes.liquidity', val: 'intelligence.notes.relativeValue',
    pq: 'intelligence.notes.priceQuality', vent: 'environmental.ventilation', topo: 'construction.topography', pc: 'construction.constructivePotential' };
  const ALWAYS_NULL_NOTES = new Set(['vent', 'topo', 'pc']); // no data and no methodology: never copied as a 0–10 note into an enum field

  function normalize(raw, ctx) {
    const w = [], code = String(raw.id || '').toUpperCase();
    const warn = (wcode, fieldKey, message) => w.push({ code: wcode, lotId: code || '?', fieldKey, message });
    const num = (v, key) => {
      if (v == null || v === '') return null;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) { warn('INVALID_NUMBER', key, `valor numérico inválido (${v})`); return null; }
      return n;
    };
    const en = (map, v, key) => {
      if (v == null || v === '') return null;
      if (Object.prototype.hasOwnProperty.call(map, v)) return map[v];
      warn('UNKNOWN_ENUM', key, `valor fora do vocabulário (${v})`); return null;
    };
    const unmapped = Object.keys(raw).filter(k => !(k in LEGACY_KEYS));
    unmapped.forEach(k => warn('LEGACY_FIELD_UNMAPPED', null, `campo legado sem mapeamento: ${k}`));

    const block = String(raw.q || '').toUpperCase(), n = num(raw.n, 'identity.lotNumber');
    const pts = Array.isArray(raw.p) ? raw.p.filter(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) : [];
    const st = pts.length >= 3 ? polygonStats(pts) : { centroid: null, bounds: null };
    let area = num(raw.a, 'geometry.areaM2'); if (area != null && area <= 0) { warn('INVALID_AREA', 'geometry.areaM2', `área não positiva (${area})`); area = null; }

    const pos = en(MAP.pos, raw.pos, 'location.blockPosition'), isCorner = pos === 'CORNER';
    const rear = en(MAP.rear, raw.fundo, 'surroundings.rearNeighborType'), closure = en(MAP.closure, raw.fech, 'surroundings.rearCondition');
    const left = en(MAP.side, raw.vzE, 'surroundings.leftNeighborType'), right = en(MAP.side, raw.vzD, 'surroundings.rightNeighborType');
    const sides = String(raw.lat_s || '').split('/').map(s => en(MAP.dir, s.trim(), 'environmental.orientationLeft'));
    const view = en(MAP.view, raw.vista, 'surroundings.viewType') || [null, null, null];

    const v = {}; // notes routed to their canonical field
    for (const [k, val] of Object.entries(raw.nt || {})) {
      const key = NOTE_KEYS[k]; if (!key) { warn('LEGACY_FIELD_UNMAPPED', null, `nota sem mapeamento: nt.${k}`); continue; }
      if (ALWAYS_NULL_NOTES.has(k)) { if (val != null) warn('LEGACY_FIELD_USED', key, `nota nt.${k} ignorada: o campo canônico não é uma nota`); continue; }
      const nv = num(val, key);
      if (nv != null && (nv < 0 || nv > 10)) { warn('INVALID_SCORE', key, `nota fora de 0–10 (${nv})`); v[key] = null; } else v[key] = nv;
    }
    const score = (val, key) => { const s = num(val, key); if (s == null) { warn('MISSING_OPTIONAL_FIELD', key, 'score ausente'); return null; } if (s < 0 || s > 100) { warn('INVALID_SCORE', key, `score fora de 0–100 (${val})`); return null; } return s; };

    // "Idosos / mobilidade" contains the separator itself: rebuild known names.
    const parts = String(raw.perfil || '').split(' / ').map(x => x.trim()), profiles = [];
    for (let i = 0; i < parts.length; i++) {
      const two = parts[i] + ' / ' + parts[i + 1];
      if (MAP.profile[two]) { profiles.push(MAP.profile[two]); i++; } else if (parts[i]) { const p = en(MAP.profile, parts[i], 'intelligence.idealProfiles'); if (p) profiles.push(p); }
    }
    const availability = App.availability.normalizeAvailability(raw, warn);

    const id = raw.did ? String(raw.did) : `${ctx.code}-Q${block}-L${String(n).padStart(4, '0')}`;
    const alerts = (raw.al || []).map((s, i) => parseAlert(s, i, id, warn));
    const easements = alerts.filter(a => a.type === 'EASEMENT').map(a => ({ type: 'PROJECTED_EASEMENT', description: a.message, sourceId: 'official-plan-v1' }));
    const restriction = alerts.some(a => a.type === 'BUILDING_RESTRICTION');
    const deeeb = num(raw.deeeb, 'location.distanceToTechnicalAreaM'), rport = num(raw.rport, 'mobility.routeDistanceToGateM');
    const fr = num(raw.fr, 'geometry.frontM'), wf = num(raw.wf, 'geometry.frontBoxWidthM');

    const provenance = {};
    if (rear) {
      const p = { status: rear[0] === 'UNKNOWN' ? 'UNKNOWN' : 'CALCULATED', sourceId: rear[1], method: rear[1] === 'aerial-v1' ? 'visual-interpretation' : rear[1] ? 'geospatial' : null, confidence: rear[1] === 'aerial-v1' ? 'LOW' : rear[1] ? 'MEDIUM' : 'UNKNOWN' };
      provenance['surroundings.rearNeighborType'] = p; provenance['surroundings.hasGreenRear'] = p; provenance['surroundings.hasRearNeighbor'] = p;
    }
    if (closure) provenance['surroundings.rearCondition'] = { status: closure[1], sourceId: closure[2], method: closure[2] ? (closure[1] === 'CALCULATED' ? 'geospatial' : 'declared') : null, confidence: closure[1] === 'CALCULATED' ? 'MEDIUM' : closure[2] ? 'LOW' : 'UNKNOWN' };
    if (!restriction) provenance['construction.nonBuildableRearToConfirm'] = { status: 'CALCULATED', sourceId: 'analysis-v1', method: 'rule', confidence: 'MEDIUM', notes: 'Sem mata ou APP nos fundos pelo critério da análise.' };
    if (isCorner || raw.forma === 'Esquina') {
      provenance['geometry.shape'] = { status: 'UNKNOWN', sourceId: null, method: null, confidence: 'UNKNOWN', notes: 'A base antiga registrava "Esquina" no lugar do formato.' };
      provenance['geometry.cornerType'] = { status: 'UNKNOWN', sourceId: null, method: null, confidence: 'UNKNOWN', notes: 'Tipo de esquina não classificado.' };
    }
    if (availability.status !== 'UNKNOWN') provenance['availability.status'] = { status: 'CONFIRMED', sourceId: availability.sourceId, method: 'declared', confidence: 'HIGH', updatedAt: availability.updatedAt };
    // Method variants of the same measurement are reported, not hidden (see conflicting_fields).
    const variants = [];
    if (fr != null && wf != null && Math.abs(fr - wf) > 0.5) variants.push({ fieldKey: 'geometry.frontM', canonical: fr, alternatives: [{ fieldKey: 'geometry.frontBoxWidthM', value: wf }, { fieldKey: 'geometry.frontEdgesM', value: num(raw.edgeF) }], rule: 'frente = soma das arestas de frente nos lotes em leque, senão a largura na frente' });

    const data = {
      identity: { id, code, developmentId: ctx.developmentId, blockId: block, blockNumber: null, lotNumber: n, displayCode: `Q${block} L${n}`, externalCode: null },
      geometry: {
        areaM2: area, frontM: fr != null ? fr : wf, rearM: num(raw.wb, 'geometry.rearM'), leftDepthM: num(raw.sideE, 'geometry.leftDepthM'), rightDepthM: num(raw.sideD, 'geometry.rightDepthM'),
        averageDepthM: num(raw.dp, 'geometry.averageDepthM'), perimeterM: null,
        shape: en(MAP.shape, raw.forma, 'geometry.shape'), isCorner, cornerType: isCorner ? 'UNKNOWN' : 'NONE', frontCount: pos === 'INTERNAL' ? 1 : pos ? 2 : null, irregularityLevel: null,
        usableGeometryScore: v['geometry.usableGeometryScore'] ?? null, usableGeometryClass: en(MAP.efic, raw.efic, 'geometry.usableGeometryClass'),
        measurementConfidence: en(MAP.conf, raw.mconf, 'geometry.measurementConfidence'),
        frontBoxWidthM: wf, frontEdgesM: num(raw.edgeF, 'geometry.frontEdgesM'), rearEdgesM: num(raw.edgeB, 'geometry.rearEdgesM'),
        polygon: pts, centroid: st.centroid, bounds: st.bounds
      },
      location: {
        streetId: null, streetName: null, blockPosition: pos,
        perimeterPosition: rear && rear[2] ? 'REAR' : (left === 'CONDO_BOUNDARY' || right === 'CONDO_BOUNDARY') ? 'SIDE' : 'NONE', sector: null,
        latitude: num(raw.lat, 'location.latitude'), longitude: num(raw.lon, 'location.longitude'),
        distanceToGateLinearM: num(raw.dport, 'location.distanceToGateLinearM'), distanceToClubLinearM: num(raw.dclube, 'location.distanceToClubLinearM'),
        distanceToGreenAreaM: num(raw.dpark, 'location.distanceToGreenAreaM'), distanceToPlaygroundM: num(raw.dplay, 'location.distanceToPlaygroundM'),
        distanceToSquareM: num(raw.dpraca, 'location.distanceToSquareM'), distanceToExternalRoadM: num(raw.dav, 'location.distanceToExternalRoadM'),
        distanceToTechnicalAreaM: deeeb, distanceToAppM: null, distanceToMainInternalRoadM: null
      },
      surroundings: {
        frontNeighborType: 'STREET', rearNeighborType: rear ? rear[0] : null, leftNeighborType: left, rightNeighborType: right,
        rearCondition: closure ? closure[0] : null, hasRearNeighbor: rear ? rear[0] === 'LOT' : null,
        hasGreenRear: raw.mata === 'Sim' ? true : raw.mata === 'Não' ? false : (warn('UNKNOWN_ENUM', 'surroundings.hasGreenRear', `valor fora do vocabulário (${raw.mata})`), null),
        appNearby: null, sewageStationNearby: deeeb == null ? null : deeeb < 40,
        viewType: view[0], viewPermanence: view[1], viewDetail: view[2]
      },
      mobility: {
        streetHierarchy: en(MAP.road, raw.via, 'mobility.streetHierarchy'), estimatedTraffic: en(MAP.level, raw.fc, 'mobility.estimatedTraffic'),
        vehiclesPassingEstimate: num(raw.flow, 'mobility.vehiclesPassingEstimate'), routeDistanceToGateM: rport, routeDistanceToLeisureM: num(raw.rclube, 'mobility.routeDistanceToLeisureM'),
        gateProximity: en(MAP.gate, raw.portc, 'mobility.gateProximity'), nearMainAccess: rport == null ? null : rport < 200
      },
      environmental: {
        orientationFront: en(MAP.dir, raw.fs, 'environmental.orientationFront'), orientationRear: en(MAP.dir, raw.bs, 'environmental.orientationRear'),
        orientationLeft: sides[0] || null, orientationRight: sides[1] || null, frontBearingDeg: num(raw.az, 'environmental.frontBearingDeg'),
        northReference: 'OFFICIAL_PLAN_NORTH_UP',
        morningSun: String(raw.manha || '').split(',').map(s => en(MAP.sunSide, s.trim(), 'environmental.morningSun')).filter(Boolean),
        afternoonSun: String(raw.tarde || '').split(',').map(s => en(MAP.sunSide, s.trim(), 'environmental.afternoonSun')).filter(Boolean),
        northSunSide: en(MAP.northSun, raw.lazer, 'environmental.northSunSide'), eastSide: en(MAP.eastSide, raw.quartos, 'environmental.eastSide'),
        solarScore: v['environmental.solarScore'] ?? null, noiseLevel: en(MAP.level, raw.ruido, 'environmental.noiseLevel'), quietScore: v['environmental.quietScore'] ?? null,
        noiseSources: parseNoise(raw.fontes, en), privacyLevel: en(MAP.level, raw.priv, 'environmental.privacyLevel'), privacyScore: v['environmental.privacyScore'] ?? null,
        viewScore: v['environmental.viewScore'] ?? null, ventilation: null
      },
      construction: {
        topography: null, slopePercent: null, drainage: null, frontSetbackM: null, rearSetbackM: null, sideSetbackM: null, occupationRate: null, permeabilityRate: null,
        buildingCoefficient: null, maxFloors: null, easements, nonBuildableRearToConfirm: restriction, regulationStatus: 'UNAVAILABLE', constructivePotential: null
      },
      intelligence: {
        analysisVersion: ctx.analysisVersion || null,
        scores: { housing: score(raw.sm, 'intelligence.scores.housing'), investment: score(raw.si, 'intelligence.scores.investment'), family: score(raw.sf, 'intelligence.scores.family'),
          premium: score(raw.sp, 'intelligence.scores.premium'), overall: score(raw.sg, 'intelligence.scores.overall') },
        class: en(MAP.cls, raw.cl, 'intelligence.class') || 'UNKNOWN',
        notes: { leisure: v['intelligence.notes.leisure'] ?? null, gate: v['intelligence.notes.gate'] ?? null, lowTraffic: v['intelligence.notes.lowTraffic'] ?? null,
          liquidity: v['intelligence.notes.liquidity'] ?? null, relativeValue: v['intelligence.notes.relativeValue'] ?? null, priceQuality: v['intelligence.notes.priceQuality'] ?? null },
        liquidity: en(MAP.level, raw.liq, 'intelligence.liquidity'), idealProfiles: profiles, alerts: App.rules.sortAlerts(alerts),
        rankings: [], highlights: [], // dataset-level, filled by the repository pipeline
        confidence: en(MAP.conf, raw.conf, 'intelligence.confidence')
      },
      availability,
      provenance,
      metadata: { schemaVersion: App.domain.SCHEMA_VERSION, createdAt: null, updatedAt: null }
    };
    return { data, warnings: w, unmapped, variants };
  }

  function polygonStats(pts) {
    let a2 = 0, cx = 0, cy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [xa, ya] = pts[i], [xb, yb] = pts[(i + 1) % pts.length], k = xa * yb - xb * ya;
      a2 += k; cx += (xa + xb) * k; cy += (ya + yb) * k;
      x0 = Math.min(x0, xa); y0 = Math.min(y0, ya); x1 = Math.max(x1, xa); y1 = Math.max(y1, ya);
    }
    const c = Math.abs(a2) > 1e-9 ? [cx / (3 * a2), cy / (3 * a2)] : [(x0 + x1) / 2, (y0 + y1) / 2];
    return { centroid: [+c[0].toFixed(2), +c[1].toFixed(2)], bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  }
  function parseNoise(s, en) {
    if (!s || s === 'Nenhuma fonte relevante identificada') return [];
    return s.split(';').map(x => x.trim()).filter(Boolean).map(x => {
      const m = x.match(/^(.*?)\s*(?:\((\d+(?:[.,]\d+)?)\s*m\))?$/), t = en(MAP.noise, m[1], 'environmental.noiseSources');
      return t ? { type: t[0], detail: t[1], distanceM: m[2] ? Number(m[2].replace(',', '.')) : null, relevance: t[2] } : null;
    }).filter(Boolean);
  }
  function parseAlert(s, i, lotId, warn) {
    const m = String(s).match(/^ATENÇÃO\s+—\s+([^:]+):\s*(.*)$/s);
    let type = 'OTHER', title = null, message = String(s);
    if (!m) warn('UNKNOWN_ENUM', 'intelligence.alerts', `alerta sem prefixo reconhecido (${message.slice(0, 40)})`);
    else { title = m[1].trim(); message = m[2].trim(); type = MAP.alert[title] || (warn('UNKNOWN_ENUM', 'intelligence.alerts', `alerta de tipo desconhecido (${title})`), 'OTHER'); }
    const r = App.rules.ALERTS[type];
    return { id: `${lotId}-${type}-${i}`, type, severity: r.severity, title, message, fieldKey: r.fieldKey, sourceId: r.sourceId };
  }
  /** @deprecated Read canonical fields. Kept only for the migration report and debugging. */
  const getLegacyLotField = (raw, key) => raw ? raw[key] : undefined;
  return Object.freeze({ normalize, MAP, LEGACY_KEYS, NOTE_KEYS, polygonStats, getLegacyLotField });
})();
