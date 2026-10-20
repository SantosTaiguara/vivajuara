/* domain/rules.js — domain rules that turn existing analysis results into
   structured intelligence. Methodology is unchanged: scores, classes and alert
   texts come from the analysis; these rules only classify (severity, field of
   origin), derive highlights from existing fields and rank lots. */
App.rules = (() => {
  const AN = 'analysis-v1';
  /** alert type → severity, field that supports it and its source */
  const ALERTS = Object.freeze({
    EASEMENT: { severity: 'IMPORTANT', fieldKey: 'construction.easements', sourceId: 'official-plan-v1' },
    BUILDING_RESTRICTION: { severity: 'IMPORTANT', fieldKey: 'construction.nonBuildableRearToConfirm', sourceId: 'launch-event-v1' },
    TECHNICAL_AREA: { severity: 'IMPORTANT', fieldKey: 'location.distanceToTechnicalAreaM', sourceId: AN },
    AVENUE: { severity: 'IMPORTANT', fieldKey: 'location.distanceToExternalRoadM', sourceId: AN },
    NOISE: { severity: 'ATTENTION', fieldKey: 'environmental.noiseLevel', sourceId: AN },
    TRAFFIC: { severity: 'ATTENTION', fieldKey: 'mobility.estimatedTraffic', sourceId: AN },
    PRIVACY: { severity: 'ATTENTION', fieldKey: 'environmental.privacyScore', sourceId: AN },
    GEOMETRY: { severity: 'ATTENTION', fieldKey: 'geometry.usableGeometryScore', sourceId: AN },
    AFTERNOON_SUN: { severity: 'INFO', fieldKey: 'environmental.afternoonSun', sourceId: AN },
    OTHER: { severity: 'ATTENTION', fieldKey: null, sourceId: AN }
  });
  const SEV = App.enums.SEVERITY_ORDER;
  const sortAlerts = alerts => alerts.slice().sort((a, b) => SEV.indexOf(a.severity) - SEV.indexOf(b.severity));

  /** Highlights: positive points that follow from a field, never free text. weight orders them. */
  const HIGHLIGHTS = [
    { type: 'GREEN_REAR', title: 'Mata ou parque nos fundos', fieldKey: 'surroundings.hasGreenRear', weight: 5, test: l => l.surroundings.hasGreenRear === true },
    { type: 'QUIET', title: 'Rua silenciosa (estimativa)', fieldKey: 'environmental.quietScore', weight: 4, test: l => l.environmental.quietScore >= 8 },
    { type: 'PRIVACY', title: 'Boa privacidade (estimativa)', fieldKey: 'environmental.privacyScore', weight: 4, test: l => l.environmental.privacyScore >= 8 },
    { type: 'LOW_TRAFFIC', title: 'Baixo fluxo de carros (estimativa)', fieldKey: 'mobility.estimatedTraffic', weight: 3, test: l => ['VERY_LOW', 'LOW'].includes(l.mobility.estimatedTraffic) },
    { type: 'NORTH_SUN_REAR', title: 'Fundos com sol do norte', fieldKey: 'environmental.northSunSide', weight: 3, test: l => l.environmental.northSunSide === 'BACK' },
    { type: 'NEAR_GATE', title: 'Muito perto da portaria', fieldKey: 'mobility.routeDistanceToGateM', weight: 2, test: l => l.mobility.gateProximity === 'VERY_CLOSE' },
    { type: 'NEAR_CLUB', title: 'Perto do clube', fieldKey: 'mobility.routeDistanceToLeisureM', weight: 2, test: l => l.mobility.routeDistanceToLeisureM != null && l.mobility.routeDistanceToLeisureM < 250 },
    { type: 'LARGE', title: 'Lote amplo', fieldKey: 'geometry.areaM2', weight: 2, test: l => l.geometry.areaM2 >= 400 },
    { type: 'REGULAR_SHAPE', title: 'Formato regular', fieldKey: 'geometry.shape', weight: 1, test: l => ['RECTANGULAR', 'SQUARE'].includes(l.geometry.shape) && l.geometry.usableGeometryClass === 'GOOD' }
  ];
  function highlights(lot) {
    return HIGHLIGHT_LIST(lot).map(h => ({ id: `${lot.identity.id}-${h.type}`, type: h.type, title: h.title, fieldKey: h.fieldKey, weight: h.weight }));
  }
  const HIGHLIGHT_LIST = lot => HIGHLIGHTS.filter(h => { try { return h.test(lot); } catch (e) { return false; } }).sort((a, b) => b.weight - a.weight);

  /** competition ranking (1 = best) for each score across the development */
  const RANK_KEYS = { HOUSING: 'housing', INVESTMENT: 'investment', FAMILY: 'family', PREMIUM: 'premium', OVERALL: 'overall' };
  function rankings(lots) {
    const out = new Map(lots.map(l => [l.identity.id, []]));
    // same competition ranking as the IntelligenceEngine (shared math, intelligence/math.js)
    for (const [type, k] of Object.entries(RANK_KEYS)) {
      const r = App.imath.competitionRank(lots.map(l => ({ key: l.identity.id, value: l.intelligence.scores[k] })), 'DESC');
      for (const [id, v] of r) out.get(id).push({ type, position: v.position, total: v.total });
    }
    return out;
  }
  return Object.freeze({ ALERTS, HIGHLIGHTS, RANK_KEYS, highlights, rankings, sortAlerts });
})();
