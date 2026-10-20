'use strict';
/* Query contracts of the lot list endpoints (filters, sorting, pagination, search). camelCase everywhere.
   Every filter maps to ONE canonical fieldKey of the Field Registry (no legacy names, §40); enum values come
   from App.enums, so a value the domain does not know is rejected (422) instead of silently matching nothing. */
const v = require('../../shared/validation');

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 50;
const SEARCH_MAX_LENGTH = 64;
const BATCH_MAX_IDS = 100;

/** filter / sort parameter → canonical fieldKey (documentation + meta) */
const FILTER_FIELDS = Object.freeze({
  status: 'availability.status', block: 'identity.blockId', minArea: 'geometry.areaM2', maxArea: 'geometry.areaM2', minPrice: 'commercial.price', maxPrice: 'commercial.price',
  class: 'intelligence.class', minHousingScore: 'intelligence.scores.housing', noiseLevel: 'environmental.noiseLevel', privacyLevel: 'environmental.privacyLevel',
  corner: 'geometry.isCorner', search: 'identity.code'
});
const SORT_FIELDS = Object.freeze({ code: 'identity.blockId + identity.lotNumber', price: 'commercial.price', areaM2: 'geometry.areaM2', housingScore: 'intelligence.scores.housing', distanceToGateM: 'mobility.routeDistanceToGateM' });

function listQuerySpec(App) {
  const vals = name => Object.values(App.enums[name]);
  return {
    status: { type: 'enumList', enum: vals('AvailabilityStatus'), maxItems: 7 },
    block: { type: 'string', pattern: /^[A-Z0-9]{1,8}(,[A-Z0-9]{1,8}){0,49}$/, maxLength: 449 },
    minArea: { type: 'number', min: 0, max: 1e7 }, maxArea: { type: 'number', min: 0, max: 1e7 },
    minPrice: { type: 'number', min: 0, max: 1e11 }, maxPrice: { type: 'number', min: 0, max: 1e11 },
    class: { type: 'enumList', enum: vals('LotClass'), maxItems: 6 },
    minHousingScore: { type: 'number', min: 0, max: 100 },
    noiseLevel: { type: 'enumList', enum: vals('Level'), maxItems: 6 },
    privacyLevel: { type: 'enumList', enum: vals('Level'), maxItems: 6 },
    corner: { type: 'boolean' },
    search: { type: 'string', maxLength: SEARCH_MAX_LENGTH },
    sortBy: { type: 'enum', enum: Object.keys(SORT_FIELDS), default: 'code' },
    sortDirection: { type: 'enum', enum: ['asc', 'desc'], default: 'asc' },
    page: { type: 'int', min: 1, max: 100000, default: 1 },
    pageSize: { type: 'int', min: 1, max: PAGE_SIZE_MAX, default: PAGE_SIZE_DEFAULT }
  };
}

const RANGES = [['minArea', 'maxArea'], ['minPrice', 'maxPrice']];

/** → { parsed, canonical } (canonical = sorted query string, part of the ETag) */
function parseListQuery(query, App) {
  const q = v.parseQuery(query, listQuerySpec(App), { ranges: RANGES });
  if (q.block) q.block = [...new Set(q.block.split(','))];
  const canonical = [...query.keys()].sort().map(k => `${k}=${query.get(k)}`).join('&');
  return { q, canonical };
}

function parseSearchQuery(query) {
  return v.parseQuery(query, { q: { type: 'string', maxLength: SEARCH_MAX_LENGTH }, limit: { type: 'int', min: 1, max: SEARCH_LIMIT_MAX, default: SEARCH_LIMIT_DEFAULT } });
}

const BatchSummaryRequestSchema = { ids: { type: 'array', required: true, minItems: 1, maxItems: BATCH_MAX_IDS, items: { type: 'string', pattern: v.LOT_ID_RE, example: 'VJ-QB-L0079' } } };

module.exports = { listQuerySpec, parseListQuery, parseSearchQuery, BatchSummaryRequestSchema, FILTER_FIELDS, SORT_FIELDS, RANGES,
  PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, SEARCH_MAX_LENGTH, BATCH_MAX_IDS };
