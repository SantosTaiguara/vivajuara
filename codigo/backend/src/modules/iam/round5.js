'use strict';
/* Round-5 permission keys (topics 57, 58, 59, 60, 61, 63) and the module feature flags that expose their routes.
   Pure data. Each key is registered in the PermissionRegistry (permissions.js) with explicitGrantOnly: true, i.e. it is
   never derived from a generic rule ("OWNER_ADMIN = every key"): a role holds it only through an explicit, dated grant.
     - DECISION 2026-10-18 (Edmilson, owner, relayed by the coordinator): OWNER_ADMIN receives ALL round-5 keys.
       No other role receives any of them.
     - further grants (other roles) only through config/iam/role-grants.json (`npm run iam -- grant ... --confirm`).
   A key is only *effective* where its module is reachable: the routes of a module exist only when its FEATURE_* flag is
   on (all default OFF), and GET /me / GET /iam/registry list a round-5 key only when its module is on, so with every flag
   off the API is exactly what it was before round 5.
   Metadata (riskLevel, description, scopeTypes) comes from the frontend mirror config/security/permissions.json (the
   same file topic 60 already reads); the key list itself is fixed here (a test keeps both in sync). */
const fs = require('fs');
const path = require('path');

/** feature flag (env name) → config key + key prefixes it owns */
const FEATURES = Object.freeze({
  FEATURE_DEALS: { configKey: 'deals', topic: 57, keys: ['proposal.read', 'proposal.create', 'proposal.update_draft', 'proposal.submit', 'proposal.withdraw', 'proposal.review', 'proposal.counter',
    'proposal.accept', 'proposal.reject', 'reservation.read', 'reservation.create', 'reservation.extend', 'reservation.release', 'reservation.cancel', 'closing.read', 'closing.manage',
    'closing.validate_documents', 'contract.generate', 'contract.issue', 'signature.manage', 'sale.complete', 'sale.cancel', 'commercial_approval.request', 'commercial_approval.decide'] },
  FEATURE_ONBOARDING: { configKey: 'onboarding', topic: 58, keys: ['development_onboarding.read', 'development_onboarding.create', 'development_onboarding.upload_source', 'development_onboarding.map_schema',
    'development_onboarding.resolve_conflict', 'development_onboarding.review_geometry', 'development_onboarding.publish', 'development_onboarding.rollback'] },
  FEATURE_PRIVACY: { configKey: 'privacy', topic: 59, keys: ['privacy.registry.view', 'privacy.request.manage', 'privacy.consent.manage', 'privacy.legal_hold.manage', 'privacy.retention.execute', 'customer.export_bulk'] },
  FEATURE_BACKOFFICE: { configKey: 'backoffice', topic: 60, keys: ['backoffice.access', 'backoffice.inbox.view', 'backoffice.queue.assign', 'backoffice.approval.decide', 'backoffice.commercial.view',
    'backoffice.data.view', 'backoffice.developments.view', 'backoffice.customers.view', 'backoffice.documents.view', 'backoffice.privacy.view', 'backoffice.access_admin.view', 'backoffice.access_admin.change',
    'backoffice.session.revoke', 'backoffice.support_session.start', 'backoffice.integration.view', 'backoffice.integration.resync', 'backoffice.observability.view', 'backoffice.job.retry',
    'backoffice.job.replay', 'backoffice.config.view', 'backoffice.config.publish', 'backoffice.flag.manage', 'backoffice.emergency.activate', 'backoffice.export.create', 'backoffice.audit.export',
    'backoffice.data.repair'] },
  FEATURE_DATA_QUALITY: { configKey: 'dataQuality', topic: 61, keys: ['data_quality.read', 'data_quality.manage_findings', 'data_quality.run_checks', 'data_quality.manage_rules', 'data_quality.create_exception',
    'data_quality.approve_exception', 'data_quality.manage_incident', 'data_governance.manage_owner', 'data_governance.manage_contract', 'data_governance.certify'] },
  FEATURE_SURROUNDINGS: { configKey: 'surroundings', topic: 63, keys: ['development.location_environment.read', 'development.location_environment.manage', 'development.location.validate'] }
});
const FEATURE_NAMES = Object.freeze(Object.keys(FEATURES));
const FEATURE_OF = new Map(Object.entries(FEATURES).flatMap(([f, d]) => d.keys.map(k => [k, f])));
const ROUND5_KEYS = Object.freeze([...FEATURE_OF.keys()]);

/** explicit decision record behind every round-5 role grant (shown by docs/tests; never inferred) */
const ROUND5_ROLE_DECISION = Object.freeze({ roleCode: 'OWNER_ADMIN', keys: 'ALL_ROUND5', decidedBy: 'Edmilson (owner)', decidedOn: '2026-10-18',
  note: 'OWNER_ADMIN recebe todas as permissões da rodada 5 quando o servidor for ligado; nenhum outro papel recebe nenhuma. Valores de política nulos continuam nulos.' });

const MIRROR = path.resolve(__dirname, '..', '..', '..', '..', 'config', 'security', 'permissions.json');
function mirrorMeta(file = MIRROR) {
  try { return new Map(JSON.parse(fs.readFileSync(file, 'utf8')).permissions.map(p => [p.key, p])); } catch (_) { return new Map(); }
}
const RISK = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
/** round-5 permission definitions for P(key, riskLevel, description, opts) — unknown risk in the mirror ⇒ HIGH (fail safe) */
function definitions(meta = mirrorMeta()) {
  return ROUND5_KEYS.map(key => {
    const m = meta.get(key) || {};
    const scopes = Array.isArray(m.scopeTypes) && m.scopeTypes.length && m.scopeTypes.every(s => ['ORGANIZATION', 'DEVELOPMENT'].includes(s)) ? m.scopeTypes : ['ORGANIZATION', 'DEVELOPMENT'];
    return { key, riskLevel: RISK.has(m.riskLevel) ? m.riskLevel : 'HIGH', description: m.description || `Permissão da rodada 5 (${FEATURE_OF.get(key)}).`, scopeTypes: scopes, feature: FEATURE_OF.get(key) };
  });
}

/** enabled feature names of a config ({ features: { deals: true, … } }) */
const enabledFeatures = config => new Set(FEATURE_NAMES.filter(f => !!(config && config.features && config.features[FEATURES[f].configKey])));
/** is `key` visible/effective under these enabled features? (pre-round-5 keys always are) */
const isActive = (key, enabled) => !FEATURE_OF.has(key) || (!!enabled && enabled.has(FEATURE_OF.get(key)));

module.exports = { FEATURES, FEATURE_NAMES, FEATURE_OF, ROUND5_KEYS, ROUND5_ROLE_DECISION, definitions, mirrorMeta, enabledFeatures, isActive, MIRROR };
