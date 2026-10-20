'use strict';
/* RoutePermissionMatrix (topic 30 §273/§283): every API route → required permission + the route parameter that
   identifies the tenant-owned resource (development | lot). Deny by default: createApp refuses to start when a
   registered route has no entry here and is not explicitly marked { public: true } (identity/registry routes only).
   resource: 'development' → :developmentId, 'lot' → :lotId, null → no single resource (listings filter per item). */
const POLICIES = Object.freeze({
  'GET /api/v1/developments': { permission: 'development.view', resource: null },
  'GET /api/v1/developments/:developmentId': { permission: 'development.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/config': { permission: 'development.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/manifest': { permission: 'development.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/sources': { permission: 'development.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/assets': { permission: 'development.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/lots/static': { permission: 'lot.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/map-lots': { permission: 'lot.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/lots': { permission: 'lot.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/lots/search': { permission: 'lot.view', resource: 'development' },
  'POST /api/v1/lots/batch-summary': { permission: 'lot.view', resource: null },
  'GET /api/v1/lots/:lotId': { permission: 'lot.view', resource: 'lot' },
  'GET /api/v1/lots/:lotId/summary': { permission: 'lot.view', resource: 'lot' },
  'GET /api/v1/lots/:lotId/provenance': { permission: 'lot.view', resource: 'lot' },
  'GET /api/v1/lots/:lotId/analysis': { permission: 'lot.analysis.view', resource: 'lot' },
  'GET /api/v1/developments/:developmentId/analysis/current': { permission: 'lot.analysis.view', resource: 'development' },
  'POST /api/v1/developments/:developmentId/analysis/preview': { permission: 'analysis.preview', resource: 'development' },
  'GET /api/v1/lots/:lotId/commercial': { permission: 'lot.price.view', resource: 'lot' },
  'GET /api/v1/developments/:developmentId/commercial/current': { permission: 'lot.price.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/commercial/price-tables/current': { permission: 'lot.price.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/price-tables/:priceTableId': { permission: 'lot.price.view', resource: 'development' },
  'POST /api/v1/developments/:developmentId/price-tables': { permission: 'price_table.publish', resource: 'development' },
  'GET /api/v1/developments/:developmentId/lots/:lotId/price-history': { permission: 'lot.price_history.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/pricing/history': { permission: 'lot.price_history.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/availability': { permission: 'lot.availability.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/availability/manifest': { permission: 'lot.availability.view', resource: 'development' },
  'GET /api/v1/developments/:developmentId/availability/stream': { permission: 'lot.availability.view', resource: 'development' },
  'GET /api/v1/lots/:lotId/availability': { permission: 'lot.availability.view', resource: 'lot' },
  'GET /api/v1/lots/:lotId/availability/history': { permission: 'lot.availability.view', resource: 'lot' },
  'PATCH /api/v1/lots/:lotId/availability': { permission: 'availability.write', resource: 'lot' },
  'GET /api/v1/admin/audit-events': { permission: 'admin.audit.view', resource: null }
});

module.exports = { POLICIES };
