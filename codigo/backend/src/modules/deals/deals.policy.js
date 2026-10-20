'use strict';
/* Org-configured commercial policies (topic 57). Nothing here is a business or legal decision: every value that is a
   decision (authority matrix, WON definition, reservation duration, approval thresholds, checklist, concurrency policy,
   cancellation outcome, business timezone…) defaults to null = "necessita confirmação", and the service REFUSES the
   action that needs it with POLICY_NOT_CONFIGURED (details.policy names the missing key). Shape documented in
   docs/COMMERCIAL_WORKFLOW_POLICY.md; the same JSON lives in plat/config/deals/<developmentId>.json (frontend bundle). */
const fs = require('fs');
const path = require('path');
const { AuthorityMode, ConcurrencyMode, PriorityRule, ApprovalConditionType, SaleCondition, SignatureReadinessCondition, ChecklistCategory, CODE_RE, fail } = require('./deals.domain');

const NEEDS = 'NECESSITA_CONFIRMACAO';
const DEFAULT_POLICY = Object.freeze({
  kind: 'deals-policy', version: '57.1.0', organizationId: null, developmentId: null, status: NEEDS,
  businessTimezone: null,
  authorityMatrix: { proposal: null, negotiation: null, reservation: null, availability: null, contract: null, signature: null, journey: null },
  workflow: { policyId: null, version: null, proposalRequiredBeforeReservation: null, reservationRequiredBeforeProposal: null, acceptedProposalRequiredForClosing: null, reservationRequiredForClosing: null },
  proposalConcurrency: { mode: null, priorityRule: null },
  submission: { requiredCustomerFields: null, requiredProposalFields: null, requireFinancialSimulation: null, requireAvailabilityFreshness: null, maxAvailabilityAgeSeconds: null },
  approval: { policyId: null, version: null, rules: null, requesterCannotApprove: null },
  reservation: { maxDurationSeconds: null, allowWithoutExpiry: false, availabilityAfterExpiry: 'AVAILABLE', extension: { allowed: null, maxExtensionSeconds: null, maxExtensions: null, reasonRequired: true } },
  closingChecklist: { policyId: null, version: null, items: null },
  closingReadiness: { policyId: null, version: null, readyForSignature: null },
  saleCompletion: { policyId: null, version: null, requiredConditions: null },
  closingCancellation: { policyId: null, version: null, availabilityAfterCancel: null },
  contractTemplates: [],
  signature: { providers: [] }
});

const clone = o => JSON.parse(JSON.stringify(o));
const deepMerge = (a, b) => { if (b == null) return a; if (Array.isArray(b) || typeof b !== 'object') return b; const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = a && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? deepMerge(a[k], v) : v; return out; };

/** validatePolicy(p) → [{ path, issue }] — shape only; values stay the organization's decision */
function validatePolicy(p) {
  const e = [], E = (path, issue) => e.push({ path, issue });
  for (const [k, v] of Object.entries(p.authorityMatrix || {})) if (v != null && !AuthorityMode[v]) E(`authorityMatrix.${k}`, 'enum');
  if (p.proposalConcurrency.mode != null && !ConcurrencyMode[p.proposalConcurrency.mode]) E('proposalConcurrency.mode', 'enum');
  if (p.proposalConcurrency.priorityRule != null && !PriorityRule[p.proposalConcurrency.priorityRule]) E('proposalConcurrency.priorityRule', 'enum');
  for (const [i, r] of (p.approval.rules || []).entries()) {
    if (!CODE_RE.test(r.code || '')) E(`approval.rules[${i}].code`, 'code');
    if (!ApprovalConditionType[r.conditionType]) E(`approval.rules[${i}].conditionType`, 'enum');
    if (['DISCOUNT_PERCENT_GT', 'DISCOUNT_AMOUNT_GT'].includes(r.conditionType) && typeof r.threshold !== 'number') E(`approval.rules[${i}].threshold`, 'number_required');
    if (typeof r.requiredApprovalPermission !== 'string') E(`approval.rules[${i}].requiredApprovalPermission`, 'required');
  }
  for (const c of p.saleCompletion.requiredConditions || []) if (!SaleCondition[c]) E('saleCompletion.requiredConditions', `unknown:${c}`);
  for (const c of p.closingReadiness.readyForSignature || []) if (!SignatureReadinessCondition[c]) E('closingReadiness.readyForSignature', `unknown:${c}`);
  for (const [i, it] of (p.closingChecklist.items || []).entries()) {
    if (!CODE_RE.test(it.code || '')) E(`closingChecklist.items[${i}].code`, 'code');
    if (!ChecklistCategory[it.category]) E(`closingChecklist.items[${i}].category`, 'enum');
    if (typeof it.required !== 'boolean') E(`closingChecklist.items[${i}].required`, 'boolean');
  }
  for (const k of ['maxDurationSeconds']) { const v = p.reservation[k]; if (v != null && !(Number.isInteger(v) && v > 0)) E(`reservation.${k}`, 'positive_int'); }
  if (!['AVAILABLE', 'BLOCKED'].includes(p.reservation.availabilityAfterExpiry)) E('reservation.availabilityAfterExpiry', 'enum');
  if (p.closingCancellation.availabilityAfterCancel != null && !['AVAILABLE', 'BLOCKED'].includes(p.closingCancellation.availabilityAfterCancel)) E('closingCancellation.availabilityAfterCancel', 'enum');
  for (const [i, t] of (p.contractTemplates || []).entries()) if (!t.templateId || !t.templateVersion) E(`contractTemplates[${i}]`, 'templateId_and_version');
  return e;
}

/** resolvePolicy(raw) → frozen effective policy (defaults + org values). Throws on an invalid shape. */
function resolvePolicy(raw = {}) {
  const p = deepMerge(clone(DEFAULT_POLICY), clone(raw || {}));
  const errors = validatePolicy(p);
  if (errors.length) { const err = new Error('invalid deals policy: ' + errors.map(x => `${x.path}:${x.issue}`).join(', ')); err.errors = errors; throw err; }
  return deepFreeze(p);
}
function deepFreeze(o) { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; }

const get = (p, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), p);
/** require(policy, key) → value, or POLICY_NOT_CONFIGURED (null / undefined = necessita confirmação) */
function requirePolicy(p, key) {
  const v = get(p, key);
  if (v == null) fail('POLICY_NOT_CONFIGURED', { policy: key, status: 'necessita confirmação' });
  return v;
}
/** writable authority: PLATFORM_MASTER writes; HYBRID/EXTERNAL_MASTER go through external confirmation; REFERENCE_ONLY never writes */
function authorityOf(p, domain) {
  const mode = get(p, `authorityMatrix.${domain}`);
  if (mode == null) fail('COMMERCIAL_AUTHORITY_NOT_CONFIGURED', { domain, status: 'necessita confirmação' });
  return mode;
}
/** pending policy keys (for the report/UI "não configurado") */
function pendingKeys(p, prefix = '', out = []) {
  for (const [k, v] of Object.entries(p)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (['kind', 'version', 'status', 'organizationId', 'developmentId', 'contractTemplates', 'signature'].includes(key)) continue;
    if (v == null) out.push(key); else if (typeof v === 'object' && !Array.isArray(v)) pendingKeys(v, key, out);
  }
  return out;
}

/** file-backed policy port (plat/config/deals/<developmentId>.json): getPolicy(orgId, devId) */
function createFilePolicyPort(dir = path.resolve(__dirname, '..', '..', '..', '..', 'config', 'deals')) {
  const cache = new Map();
  return {
    async getPolicy(orgId, devId) {
      if (!/^[a-z0-9-]{2,64}$/.test(devId || '')) return resolvePolicy({ organizationId: orgId, developmentId: devId });
      if (!cache.has(devId)) {
        const f = path.join(dir, `${devId}.json`);
        cache.set(devId, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
      }
      const raw = cache.get(devId);
      // a policy file of another organization is never applied (tenant scoping)
      if (raw.organizationId && raw.organizationId !== orgId) return resolvePolicy({ organizationId: orgId, developmentId: devId });
      return resolvePolicy(raw);
    }
  };
}
const staticPolicyPort = raw => ({ async getPolicy() { return resolvePolicy(raw); } });

module.exports = { DEFAULT_POLICY, NEEDS, resolvePolicy, validatePolicy, requirePolicy, authorityOf, pendingKeys, createFilePolicyPort, staticPolicyPort };
