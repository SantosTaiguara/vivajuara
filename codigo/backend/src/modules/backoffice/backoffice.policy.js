'use strict';
/* Backoffice policy catalog (topic 60), server side. ONE source of truth with the frontend:
   - action policies, navigation, reason codes, governance policies and secret names come from
     src/config/backoffice/backofficeConfig.js (pure data, evaluated with a stub App, no other frontend code);
   - backoffice.* permission keys come from config/security/permissions.json (the frontend mirror of the registry).
   Keys already in the IAM registry (modules/iam/permissions.js: availability.write, price_table.publish, admin.audit.view…)
   are decided by the IAM PolicyEvaluator; backoffice.* keys are not in the IAM registry yet (adding them would auto-grant
   OWNER_ADMIN, a human decision) and are decided by backoffice.authz.js with an explicit, empty-by-default grant map. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PLAT = path.resolve(__dirname, '..', '..', '..', '..');
function loadFrontendConfig(srcDir = path.join(PLAT, 'src')) {
  const sandbox = { App: {} }; // pure-data config file, evaluated in an isolated context (same as the shared App loader)
  vm.runInNewContext(fs.readFileSync(path.join(srcDir, 'config', 'backoffice', 'backofficeConfig.js'), 'utf8'), sandbox, { filename: 'backofficeConfig.js' });
  const deepFreeze = o => { if (o && typeof o === 'object') { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
  return deepFreeze(JSON.parse(JSON.stringify(sandbox.App.backofficeConfig))); // plain objects of this realm
}
function loadBackofficePermissions(configDir = path.join(PLAT, 'config')) {
  const reg = JSON.parse(fs.readFileSync(path.join(configDir, 'security', 'permissions.json'), 'utf8'));
  return new Map(reg.permissions.filter(p => p.key.startsWith('backoffice.')).map(p => [p.key, Object.freeze({ key: p.key, riskLevel: p.riskLevel, reasonRequired: !!p.reasonRequired })]));
}

const CFG = loadFrontendConfig();
const BO_PERMISSIONS = loadBackofficePermissions();
const ACTIONS = new Map(CFG.actions.map(a => [a.actionCode, a]));
const REASONS = new Map(CFG.reasonCodes.map(r => [r.code, r]));
const RESOURCE_REF_RE = /^[a-z][a-z_]*:[A-Za-z0-9._:-]{1,128}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;
const PII_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/** policyValue(name) → value | null (null = necessita confirmação → callers refuse) */
const policyValue = name => (CFG.policies[name] || {}).value ?? null;

module.exports = { CFG, BO_PERMISSIONS, ACTIONS, REASONS, RESOURCE_REF_RE, IDEMPOTENCY_KEY_RE, PII_RE, policyValue, loadFrontendConfig, loadBackofficePermissions };
