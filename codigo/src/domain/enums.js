/* domain/enums.js
   Controlled vocabularies of the canonical Lot. Values are stable codes; the
   Portuguese wording lives only in utils/i18n.js. Where the dataset needs a value
   the suggested list does not have, the extension is marked "ext" and explained
   in LOT_DOMAIN_MODEL.md. */
App.enums = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  return Object.freeze({
    DataStatus: E('CONFIRMED', 'CALCULATED', 'ESTIMATED', 'TO_CONFIRM', 'UNKNOWN', 'NOT_APPLICABLE', 'CONFLICTED'),
    Confidence: E('HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'),
    // UNKNOWN = no availability feed yet. It is never treated as AVAILABLE.
    // FRESH = confirmed by the source in this session; STALE = last known value, not confirmed now;
    // EXPIRED = beyond the policy limit or the table's validity (context only); UNKNOWN = no trustworthy value.
    Freshness: E('FRESH', 'STALE', 'EXPIRED', 'UNKNOWN'),
    // Topic 10: where a piece of data came from and how the app reaches the network.
    DataSource: E('REMOTE', 'CACHE', 'MEMORY', 'BUNDLED'),
    ConnectivityState: E('ONLINE', 'OFFLINE', 'DEGRADED', 'UNKNOWN'),
    SyncState: E('IDLE', 'SYNCING', 'SUCCESS', 'PARTIAL', 'ERROR', 'OFFLINE'),
    AvailabilityReason: E('TECHNICAL_REVIEW', 'COMMERCIAL_HOLD', 'LEGAL_HOLD', 'INTERNAL_BLOCK', 'NOT_RELEASED', 'DATA_VALIDATION', 'OTHER'),
    AvailabilityStatus: E('AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN'),
    LotClass: E('A_PLUS', 'A', 'B', 'C', 'D', 'UNKNOWN'),
    Level: E('VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH', 'UNKNOWN'), // NoiseLevel, PrivacyLevel, TrafficLevel, liquidity
    Direction: E('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'),
    LotShape: E('RECTANGULAR', 'SQUARE', 'TRAPEZOIDAL', 'TRIANGULAR', 'IRREGULAR', 'OTHER', 'UNKNOWN'),
    CornerType: E('NONE', 'INTERNAL_CORNER', 'EXTERNAL_CORNER', 'CURVED_CORNER', 'UNKNOWN'),
    BlockPosition: E('INTERNAL', 'CORNER', 'DOUBLE_FRONT'),
    PerimeterPosition: E('REAR', 'SIDE', 'NONE'),
    Efficiency: E('GOOD', 'MEDIUM', 'LOW'),
    // ext: EXTERNAL_GREEN (vegetation outside the perimeter), COMMON_AREA (condominium area of unspecified use), CONDO_BOUNDARY
    NeighborType: E('LOT', 'STREET', 'GREEN_AREA', 'EXTERNAL_GREEN', 'APP', 'LEISURE', 'TECHNICAL_AREA', 'COMMON_AREA', 'EXTERNAL_PROPERTY', 'CONDO_BOUNDARY', 'WALL', 'FENCE', 'UNKNOWN', 'NONE'),
    RearCondition: E('LOT_BOUNDARY', 'WALL', 'FENCE', 'UNKNOWN'),
    ViewType: E('INTERNAL', 'GREEN', 'LEISURE', 'URBAN', 'OPEN', 'PARTIAL', 'TECHNICAL', 'UNKNOWN'),
    ViewPermanence: E('CONFIRMED_PERMANENT', 'LIKELY', 'NOT_GUARANTEED', 'UNKNOWN'),
    ViewDetail: E('INTERNAL', 'INTERNAL_NEAR_SQUARE', 'OPEN_EXTERNAL', 'FOREST_EXTERNAL', 'CONDO_PARK', 'STREET_BOTH_SIDES'),
    GateProximity: E('VERY_CLOSE', 'CLOSE', 'INTERMEDIATE', 'FAR'),
    // ext: LOCAL_QUIET keeps the analysis' "poucos veículos de passagem" distinction
    StreetHierarchy: E('MAIN', 'SECONDARY', 'LOCAL', 'LOCAL_QUIET', 'CUL_DE_SAC', 'ACCESS_TO_LEISURE', 'ACCESS_TO_GATE', 'UNKNOWN'),
    LotSide: E('FRONT', 'BACK', 'SIDE'),
    NorthSunSide: E('BACK', 'FRONT', 'SIDE'),
    // ext: INTERNAL_ROAD (the lot's own street with relevant flow)
    NoiseSourceType: E('EXTERNAL_ROAD', 'INTERNAL_MAIN_ROAD', 'INTERNAL_ROAD', 'GATE', 'LEISURE', 'SPORTS', 'PARKING', 'TECHNICAL_AREA', 'COMMERCIAL', 'OTHER'),
    NoiseSourceDetail: E('AVENUE', 'STREET_FLOW', 'SQUARE', 'PLAYGROUND', 'CLUB', 'GATE', 'PUMP_STATION', 'PARKING'),
    TopographyType: E('FLAT', 'UPHILL', 'DOWNHILL', 'LATERAL_SLOPE', 'MIXED', 'UNKNOWN'),
    DrainageStatus: E('KNOWN_FAVORABLE', 'KNOWN_ATTENTION', 'UNKNOWN'),
    RegulationStatus: E('AVAILABLE', 'PARTIAL', 'UNAVAILABLE'),
    AlertType: E('TRAFFIC', 'AFTERNOON_SUN', 'BUILDING_RESTRICTION', 'PRIVACY', 'AVENUE', 'NOISE', 'TECHNICAL_AREA', 'GEOMETRY', 'EASEMENT', 'OTHER'),
    AlertSeverity: E('INFO', 'ATTENTION', 'IMPORTANT', 'CRITICAL'),
    RankingType: E('HOUSING', 'INVESTMENT', 'FAMILY', 'PREMIUM', 'OVERALL'),
    Profile: E('QUIET_LIVING', 'ELDERLY_MOBILITY', 'INVESTOR', 'FAMILY', 'NATURE', 'HIGH_END'),
    PoiType: E('GATE', 'CLUB', 'SQUARE', 'PLAYGROUND', 'PARK', 'PUMP_STATION', 'PARKING', 'ADMIN'),
    LEVEL_ORDER: Object.freeze(['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']),
    CLASS_ORDER: Object.freeze(['A_PLUS', 'A', 'B', 'C', 'D']),
    AVAILABILITY_ORDER: Object.freeze(['AVAILABLE', 'RESERVED', 'PROPOSAL', 'BLOCKED', 'SOLD', 'UNAVAILABLE', 'UNKNOWN']),
    SEVERITY_ORDER: Object.freeze(['CRITICAL', 'IMPORTANT', 'ATTENTION', 'INFO'])
  });
})();
