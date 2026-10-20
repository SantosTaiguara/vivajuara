/* config/presentation.js
   Information hierarchy (progressive disclosure). Central rules for: primary
   score by context, Quick View key attributes, detail sections, alert severity,
   field priority (P0–P3) and visibility per mode. A development can override any
   of it through DevelopmentConfig.presentation. */
App.presentationConfig = (() => {
  const DEFAULTS = {
    defaultObjective: 'housing',
    objectives: {
      housing: { label: 'Moradia', score: 'housing', keyAttributes: ['quiet', 'privacy', 'solar', 'leisure', 'lowTraffic'] },
      investment: { label: 'Investimento', score: 'investment', keyAttributes: ['priceQuality', 'liquidity', 'relativeValue', 'gate', 'geometry'] },
      family: { label: 'Família', score: 'family', keyAttributes: ['leisure', 'lowTraffic', 'quiet', 'privacy', 'solar'] },
      premium: { label: 'Premium', score: 'premium', keyAttributes: ['privacy', 'view', 'quiet', 'solar', 'geometry'] }
    },
    quickViewKeyAttributeCount: 3,
    quickViewMaxHighlights: 3,
    quickViewMaxAttention: 2,
    scoreOrder: ['housing', 'investment', 'family', 'premium'],
    detailSections: [
      { id: 'summary', title: 'Resumo', open: true },
      { id: 'geometry', title: 'Geometria', open: false },
      { id: 'location', title: 'Localização', open: false },
      { id: 'surroundings', title: 'Vizinhança', open: false },
      { id: 'mobility', title: 'Mobilidade', open: false },
      { id: 'comfort', title: 'Conforto', open: false },
      { id: 'construction', title: 'Construção', open: false },
      { id: 'commercial', title: 'Comercial', open: false },
      { id: 'intelligence', title: 'Inteligência', open: false, brokerOnly: true },
      { id: 'sources', title: 'Fontes', open: false }
    ],
    comparisonGroups: [
      { id: 'summary', title: 'Resumo' }, { id: 'location', title: 'Localização' }, { id: 'comfort', title: 'Conforto' },
      { id: 'commercial', title: 'Comercial' }, { id: 'intelligence', title: 'Inteligência', brokerOnly: true }, { id: 'technical', title: 'Técnico' }
    ],
    // Alert severity is domain data (domain/rules.js). Presentation decides only what reaches each level.
    severityOrder: App.enums.SEVERITY_ORDER,
    quickViewSeverities: ['CRITICAL', 'IMPORTANT'],
    // Client mode hides technical IDs, methodology, internal commercial data; relevant alerts stay visible.
    hiddenFields: { client: ['identity.id', 'identity.externalCode', 'intelligence.*', 'environmental.solarScore', 'environmental.privacyScore', 'environmental.quietScore',
      'environmental.viewScore', 'geometry.usableGeometryScore', 'geometry.measurementConfidence', 'geometry.frontBoxWidthM', 'geometry.frontEdgesM', 'geometry.rearEdgesM',
      'commercial.priceTableId', 'commercial.priceTableVersion', 'availability.proposalId', 'availability.notes', 'availability.reason', 'availability.revision',
      'availability.sourceId', 'metadata.*'] },
    hiddenSections: { client: ['intelligence'] },
    // Topic 41: client mode is deny by default. A field reaches a client/presentation audience only if it is in this
    // allow-list AND not in hiddenFields.client. New registry fields stay hidden from clients until classified here.
    // (List = exactly what client mode showed before topic 41; see docs/PRESENTATION_CLIENT_SAFE_PROJECTION_POLICY.md.)
    clientDenyByDefault: true,
    clientSafeFields: Object.entries({
      identity: ['code', 'developmentId', 'developmentName', 'blockId', 'blockNumber', 'lotNumber', 'displayCode'],
      geometry: ['areaM2', 'frontM', 'rearM', 'leftDepthM', 'rightDepthM', 'averageDepthM', 'perimeterM', 'shape', 'isCorner', 'cornerType', 'frontCount', 'irregularityLevel', 'usableGeometryClass', 'polygon', 'centroid', 'bounds'],
      location: ['streetId', 'streetName', 'blockPosition', 'perimeterPosition', 'sector', 'latitude', 'longitude', 'distanceToGateLinearM', 'distanceToClubLinearM', 'distanceToGreenAreaM', 'distanceToPlaygroundM', 'distanceToSquareM',
        'distanceToExternalRoadM', 'distanceToTechnicalAreaM', 'distanceToAppM', 'distanceToMainInternalRoadM'],
      surroundings: ['frontNeighborType', 'rearNeighborType', 'leftNeighborType', 'rightNeighborType', 'rearCondition', 'hasRearNeighbor', 'hasGreenRear', 'appNearby', 'sewageStationNearby', 'viewType', 'viewPermanence', 'viewDetail'],
      mobility: ['streetHierarchy', 'estimatedTraffic', 'vehiclesPassingEstimate', 'routeDistanceToGateM', 'routeDistanceToLeisureM', 'gateProximity', 'nearMainAccess', 'routeToGate', 'routeToLeisure'],
      environmental: ['orientationFront', 'orientationRear', 'orientationLeft', 'orientationRight', 'frontBearingDeg', 'northReference', 'morningSun', 'afternoonSun', 'northSunSide', 'eastSide', 'noiseLevel', 'noiseSources', 'privacyLevel', 'ventilation'],
      construction: ['topography', 'slopePercent', 'drainage', 'frontSetbackM', 'rearSetbackM', 'sideSetbackM', 'occupationRate', 'permeabilityRate', 'buildingCoefficient', 'maxFloors', 'easements', 'nonBuildableRearToConfirm', 'regulationStatus', 'constructivePotential'],
      commercial: ['price', 'pricePerM2', 'currency', 'downPaymentDefaultPercent', 'downPaymentDefaultValue', 'availablePlans', 'validFrom', 'validUntil'],
      availability: ['status', 'updatedAt', 'freshness', 'reservedUntil']
    }).flatMap(([d, ks]) => ks.map(k => d + '.' + k))
  };
  function merge(a, b) { if (!b) return a; const o = { ...a }; for (const k of Object.keys(b)) o[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k]) ? merge(a[k], b[k]) : b[k]; return o; }
  /** fieldVisibility: one rule for every screen. */
  function isFieldVisible(cfg, key, mode) {
    if (mode !== 'client') return true;
    if (cfg.clientDenyByDefault && !(cfg.clientSafeFields || []).includes(key)) return false; // not classified → hidden
    return !(cfg.hiddenFields.client || []).some(p => p.endsWith('.*') ? key.startsWith(p.slice(0, -1)) : p === key);
  }
  return Object.assign(dev => { const c = merge(DEFAULTS, dev && dev.presentation); c.isFieldVisible = (k, m) => isFieldVisible(c, k, m); return c; }, { DEFAULTS });
})();
