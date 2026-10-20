/* intelligence/textAdapter.js — AnalysisTextAdapter.
   The engine returns codes and parameters, never sentences. This adapter writes
   the Portuguese wording of the published analysis (the lots.json record) from a
   LotAnalysisResult. It is used to prove parity with the published data and to
   regenerate the record if the methodology is re-run; the UI keeps its own i18n. */
App.analysisText = (() => {
  const M = App.imath, I = App.intelligence;
  const LV_M = { VERY_LOW: 'Muito baixo', LOW: 'Baixo', MEDIUM: 'Médio', HIGH: 'Alto', VERY_HIGH: 'Muito alto' };
  const LV_F = { VERY_LOW: 'Muito baixa', LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', VERY_HIGH: 'Muito alta' };
  const SHAPE = { CORNER: 'Esquina', TRAPEZOIDAL: 'Trapezoidal', IRREGULAR: 'Irregular', SQUARE: 'Quadrado', RECTANGULAR: 'Retangular' };
  const EFIC = { GOOD: 'Boa', MEDIUM: 'Média', LOW: 'Baixa' };
  const SIDE = { FRONT: 'frente', BACK: 'fundos', SIDE: 'lateral' };
  const DIR_PT = { N: 'N', NE: 'NE', E: 'L', SE: 'SE', S: 'S', SW: 'SO', W: 'O', NW: 'NO' };
  const GATE = { VERY_CLOSE: 'Muito próximo', CLOSE: 'Próximo', INTERMEDIATE: 'Intermediário', FAR: 'Distante' };
  const VIA = { LOCAL_QUIET: 'Local (poucos veículos de passagem)', LOCAL: 'Local', SECONDARY: 'Secundária (passagem de outros moradores)', MAIN: 'Principal (acesso de muitos lotes à portaria/clube)', CUL_DE_SAC: 'Final de rua sem saída (balão de retorno)' };
  const VIEW = { CONDO_PARK: 'Vista para parque florestal do condomínio (atual; manutenção como área verde a confirmar)', FOREST_EXTERNAL: 'Vista para mata fora do perímetro (atual; permanência não confirmada)',
    OPEN_EXTERNAL: 'Vista aberta para área externa (pode ser ocupada no futuro)', STREET_BOTH_SIDES: 'Vista para rua nos dois lados', INTERNAL: 'Vista interna (lotes vizinhos)' };
  const PROFILE = { QUIET_LIVING: 'Moradia e tranquilidade', FAMILY: 'Família com crianças', HIGH_END: 'Alto padrão', INVESTOR: 'Investidor', ELDERLY_MOBILITY: 'Idosos / mobilidade', NATURE: 'Cliente que valoriza natureza' };
  const CLS = { A_PLUS: 'A+', A: 'A', B: 'B', C: 'C', D: 'D', UNKNOWN: null };
  const SOURCE = { AVENUE: 'Av. Porto Dourado', GATE: 'portaria', CLUB: 'clube', PLAYGROUND: 'playground', SQUARE: 'praça', PARKING: 'estacionamento', TECHNICAL_AREA: 'EEEB' };
  const f0 = v => M.toFixedPy(v, 0), f1 = v => M.toFixedPy(v, 1);

  function forma(r, input) { return SHAPE[r.descriptors['geometry.shapeClass']] + (input.geometry.hasTwoFronts ? ' (frente para duas ruas)' : ''); }
  function noiseSources(r) {
    const steps = r.criteriaTrace.quiet || [];
    return steps.filter(s => s.reason && s.reason.startsWith('NOISE_SOURCE_')).map(s => s.reason === 'NOISE_SOURCE_STREET_FLOW' ? `fluxo ${LV_M[s.input].toLowerCase()} na rua` : `${SOURCE[s.reason.replace('NOISE_SOURCE_', '')]} (${f0(s.input)} m)`);
  }
  function alertText(a, r, input) {
    const p = a.params, fc = LV_M[r.descriptors['mobility.estimatedTraffic']];
    switch (a.type) {
      case 'NOISE': return 'ATENÇÃO — RUÍDO: exposição potencial a ' + noiseSources(r).join(', ');
      case 'PRIVACY': return 'ATENÇÃO — PRIVACIDADE: ' + (p.isCorner ? 'esquina; ' : '') + (p.hasTwoFronts ? 'frente para duas ruas; ' : '') + `fluxo ${fc.toLowerCase()}`;
      case 'AFTERNOON_SUN': return 'ATENÇÃO — SOL DA TARDE: ' + (p.side === 'FRONT' ? 'frente' : 'fundos') + ' voltada para oeste/noroeste';
      case 'TECHNICAL_AREA': return `ATENÇÃO — ÁREA TÉCNICA: a ${f0(p.distanceM)} m da EEEB (estação elevatória de esgoto)`;
      case 'EASEMENT': return 'ATENÇÃO — SERVIDÃO: lote junto à "servidão projetada" indicada na planta';
      case 'AVENUE': return 'ATENÇÃO — AVENIDA: a planta prevê ampliação da Av. Porto Dourado (faixa de 3.228,11 m² a ser doada ao Município da Serra); a distância até a pista pode diminuir';
      case 'TRAFFIC': return `ATENÇÃO — TRÁFEGO: rua com fluxo estimado ${fc.toLowerCase()}`;
      case 'GEOMETRY': return `ATENÇÃO — GEOMETRIA: ${forma(r, input).toLowerCase()}` + (p.narrowFront ? `, frente de cerca de ${f1(p.frontWidthM)} m` : '');
      case 'BUILDING_RESTRICTION': return 'ATENÇÃO — RESTRIÇÃO CONSTRUTIVA: APP/mata nos fundos (citada no evento); confirmar faixa não edificável';
      case 'MISSING_AREA': return 'ATENÇÃO — ÁREA NÃO INFORMADA NA PLANTA';
      default: return null;
    }
  }
  /** legacyRecord(result, input) → the analysis fields of the published lots.json record */
  function legacyRecord(r, input) {
    const d = r.descriptors, n = r.notes, g = input.geometry, tok = d['surroundings.rearClass'], vg = input.surroundings.rearVegetationShare || 0;
    let fundo = { LOT: 'Outro lote', CONDO_GREEN: 'Parque florestal / área verde do condomínio (KMZ)', GREEN_EXTERNAL: 'Fora do perímetro: mata/vegetação densa (imagem aérea)',
      PERIMETER: 'Fora do perímetro: área externa aberta (imagem aérea)', COMMON_AREA: 'Área comum do condomínio (KMZ)', STREET: 'Rua', UNKNOWN: 'Não foi possível determinar' }[tok];
    if (g.hasTwoFronts) fundo = 'Rua (lote com frente para duas ruas)';
    const fech = tok === 'GREEN_EXTERNAL' ? 'Gradil (lotes com APP/mata atrás, conforme evento de lançamento) – necessita confirmação' : tok === 'PERIMETER' ? 'Muro (conforme evento de lançamento) – necessita confirmação'
      : tok === 'CONDO_GREEN' ? 'Não informado – necessita confirmação' : 'Divisa com outro lote (não é perímetro)';
    const viewSteps = r.criteriaTrace.view || [];
    const vista = VIEW[d['surroundings.viewBase']] + (viewSteps.some(s => s.reason === 'FRONT_NEAR_SQUARE_OR_CLUB') ? '; frente próxima a praça/clube' : '');
    const fontes = noiseSources(r);
    const L = input.location, Mo = input.mobility, rd = M.roundHalfEven, r1 = v => M.roundTo(v, 1);
    return {
      id: input.code, q: input.blockId, n: input.lotNumber, a: g.areaM2,
      wf: r1(g.frontWidthM), wb: r1(g.rearWidthM), dp: r1(g.depthM), forma: forma(r, input), pos: g.isCorner ? 'Esquina' : g.hasTwoFronts ? 'Frente para duas ruas' : 'Interno',
      efic: EFIC[r.levels['geometry.usableGeometryClass']], mconf: 'Alta', az: rd(input.environmental.frontBearingDeg),
      fs: DIR_PT[d['environmental.orientationFront']], bs: DIR_PT[d['environmental.orientationRear']], lat_s: `${DIR_PT[d['environmental.orientationLeft']]} / ${DIR_PT[d['environmental.orientationRight']]}`,
      manha: d['environmental.morningSun'].map(s => SIDE[s]).join(', ') || '—', tarde: d['environmental.afternoonSun'].map(s => SIDE[s]).join(', ') || '—',
      lazer: { BACK: 'Fundos (recebem sol do norte: bom para piscina e área de lazer)', FRONT: 'Frente/recuo frontal recebe o sol do norte; nos fundos a piscina tende a ter mais sombra', SIDE: 'Lateral voltada para o norte, conforme projeto' }[d['environmental.northSunSide']],
      quartos: 'Lado leste (sol da manhã): ' + { FRONT: 'frente', BACK: 'fundos', SIDE: 'lateral leste' }[d['environmental.eastSide']],
      fundo, fech, mata: d['surroundings.hasGreenRear'] ? 'Sim' : 'Não', vista,
      dport: rd(L.distanceToGateLinearM), rport: rd(Mo.routeDistanceToGateM), portc: GATE[d['mobility.gateProximity']], dclube: rd(L.distanceToClubLinearM), rclube: rd(Mo.routeDistanceToLeisureM),
      dplay: rd(L.distanceToPlaygroundM), dpraca: rd(L.distanceToSquareM), deeeb: rd(L.distanceToTechnicalAreaM), dav: rd(L.distanceToExternalRoadM),
      flow: rd(Mo.vehiclesPassingEstimate), fc: LV_M[d['mobility.estimatedTraffic']], via: VIA[d['mobility.streetHierarchy']],
      fontes: fontes.join('; ') || 'Nenhuma fonte relevante identificada', ruido: LV_M[r.levels['environmental.noiseLevel']], priv: LV_F[r.levels['environmental.privacyLevel']], liq: LV_F[r.levels['intelligence.liquidity']],
      nt: { priv: r1(n.privacy), sil: r1(n.quiet), sol: r1(n.solar), vent: null, vista: r1(n.view), topo: null, geo: r1(n.geometry), port: r1(n.gate), laz: r1(n.leisure), flux: r1(n.lowTraffic), pc: null, liq: r1(n.liquidity), val: r1(n.relativeValue), pq: r1(n.priceQuality) },
      sm: r.scores.housing, si: r.scores.investment, sf: r.scores.family, sp: r.scores.premium, sg: r.scores.overall, cl: CLS[r.class], conf: { MEDIUM: 'Média', LOW: 'Baixa', HIGH: 'Alta' }[r.confidence],
      perfil: r.profileSignals.map(p => PROFILE[p.id]).join(' / '), al: r.alerts.map(a => alertText(a, r, input))
    };
  }
  const PARITY_KEYS = ['a', 'wf', 'wb', 'dp', 'forma', 'pos', 'efic', 'az', 'fs', 'bs', 'lat_s', 'manha', 'tarde', 'lazer', 'quartos', 'fundo', 'fech', 'mata', 'vista', 'dport', 'rport', 'portc', 'dclube', 'rclube',
    'dplay', 'dpraca', 'deeeb', 'dav', 'flow', 'fc', 'via', 'fontes', 'ruido', 'priv', 'liq', 'nt', 'sm', 'si', 'sf', 'sp', 'sg', 'cl', 'conf', 'perfil', 'al'];
  /** parity(results, inputs, published) → { lots, identical, diffs: [{ code, field, engine, published }] } */
  function parity(results, inputs, published) {
    const byCode = new Map(published.map(l => [l.id, l])), inBy = new Map(inputs.map(i => [i.lotId, i])), diffs = [];
    for (const r of results) {
      const rec = legacyRecord(r, inBy.get(r.lotId)), pub = byCode.get(r.code);
      if (!pub) { diffs.push({ code: r.code, field: '*', engine: 'present', published: 'missing' }); continue; }
      for (const k of PARITY_KEYS) if (JSON.stringify(rec[k]) !== JSON.stringify(pub[k])) diffs.push({ code: r.code, field: k, engine: rec[k], published: pub[k] });
    }
    const bad = new Set(diffs.map(d => d.code));
    return { lots: results.length, identical: results.length - bad.size, fieldsCompared: PARITY_KEYS.length, diffs };
  }
  return Object.freeze({ legacyRecord, alertText, parity, PARITY_KEYS, PROFILE, LV_M, LV_F });
})();
