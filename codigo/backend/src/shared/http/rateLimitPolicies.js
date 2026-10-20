'use strict';
/* Patch B2 (topic 50 §151–161): per-category rate limits (RateLimitPolicy) on top of the global per-IP limiter.
   · Policies come from plat/config/security/rateLimits.json (override: RATE_LIMIT_POLICIES_FILE); if the file is missing
     an embedded copy of the same values is used, so the API never runs without category limits (fail closed).
   · classifyRoute(method, template, meta) → policy ids (global.ip stays in createRateLimiter / RATE_LIMIT_MAX).
   · Keys: built from keyDimensions (ip = corrected clientIp from B1, user, organization, endpoint = route TEMPLATE,
     account, shareTokenPrefix) and stored only as a truncated sha256 — never the raw IP or token.
   · In memory, fixed window per instance (same caveat as the global limiter: Redis/edge when scaled out), bounded map.
   · THROTTLE and REJECT both answer 429 + Retry-After here (no queueing in-process); the message stays generic. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.resolve(__dirname, '..', '..', '..', '..', 'config', 'security', 'rateLimits.json');
const FALLBACK = Object.freeze([
  { policyId: 'auth.login', keyDimensions: ['ip', 'account'], windowSeconds: 60, maxRequests: 5, burst: 0, action: 'REJECT' },
  { policyId: 'auth.passwordReset', keyDimensions: ['ip', 'account'], windowSeconds: 3600, maxRequests: 3, action: 'REJECT' },
  { policyId: 'share.validate', keyDimensions: ['ip'], windowSeconds: 60, maxRequests: 20, action: 'REJECT' },
  { policyId: 'share.validate.token', keyDimensions: ['shareTokenPrefix'], windowSeconds: 60, maxRequests: 30, action: 'THROTTLE' },
  { policyId: 'search', keyDimensions: ['ip', 'organization'], windowSeconds: 60, maxRequests: 60, burst: 20, action: 'THROTTLE' },
  { policyId: 'analysis.expensive', keyDimensions: ['user', 'organization'], windowSeconds: 60, maxRequests: 10, action: 'THROTTLE' },
  { policyId: 'export.bulk', keyDimensions: ['user', 'organization'], windowSeconds: 3600, maxRequests: 5, action: 'REJECT' },
  { policyId: 'admin.write', keyDimensions: ['user', 'endpoint'], windowSeconds: 60, maxRequests: 30, action: 'REJECT' },
  { policyId: 'upload', keyDimensions: ['user', 'organization'], windowSeconds: 3600, maxRequests: 50, action: 'REJECT' }
]);
const ACTIONS = new Set(['THROTTLE', 'REJECT', 'CHALLENGE']);
const validPolicy = p => p && typeof p.policyId === 'string' && p.windowSeconds > 0 && p.maxRequests > 0 && ACTIONS.has(p.action) && Array.isArray(p.keyDimensions) && p.keyDimensions.length > 0;

/** loadPolicies(file?) → Map policyId → policy (global.ip excluded: it is the RATE_LIMIT_MAX limiter) */
function loadPolicies(file = process.env.RATE_LIMIT_POLICIES_FILE || DEFAULT_FILE) {
  let list = FALLBACK, source = 'embedded';
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j.policies) && j.policies.length) { list = j.policies; source = 'file'; } } catch (_) { /* fallback */ }
  const map = new Map();
  for (const p of list) {
    if (p.policyId === 'global.ip') continue;
    if (!validPolicy(p)) throw new Error(`invalid rate limit policy ${p && p.policyId}`);
    map.set(p.policyId, Object.freeze({ ...p, keyDimensions: Object.freeze(p.keyDimensions.slice()) }));
  }
  for (const p of FALLBACK) if (!map.has(p.policyId)) map.set(p.policyId, p); // a policy removed from the file never disables a category
  map.source = source;
  return map;
}

/** classifyRoute → policy ids that apply to the route (template, never the raw path). Order: most specific first. */
function classifyRoute(method, template, meta = {}) {
  const t = String(template || ''), m = String(method || 'GET').toUpperCase(), ids = [];
  if (/\/auth\/(login|token)s?\b/.test(t) || /\/auth\/[a-z]+\/callback\b/.test(t)) ids.push('auth.login'); // W3: OIDC callback (code exchange); GET /auth/session is a cheap read
  if (/\/(auth\/)?password[-/]?reset\b/.test(t)) ids.push('auth.passwordReset');
  if (/\/(shares?|s)\/:(token|shareToken)\b/.test(t) || /\/shares?\/(exchange|validate|access)\b/.test(t)) ids.push('share.validate', 'share.validate.token');
  if (/\/search\b/.test(t)) ids.push('search');
  if (/\/analysis\/preview\b/.test(t)) ids.push('analysis.expensive');
  if (/\/exports?\b/.test(t)) ids.push('export.bulk');
  if (m !== 'GET' && m !== 'HEAD' && /\/(uploads?|assets)\b/.test(t)) ids.push('upload');
  if (meta.write || meta.admin) ids.push('admin.write');
  return [...new Set(ids)];
}

const needsPrincipal = p => p.keyDimensions.includes('user');
const SAFE = /^[A-Za-z0-9._:-]{1,64}$/;
/** keyOf(policy, dims) → string key, or null when a required dimension is not available (policy not applicable) */
function keyOf(policy, d = {}) {
  const parts = [];
  for (const dim of policy.keyDimensions) {
    let v;
    switch (dim) {
      case 'ip': v = d.ip || 'unknown'; break;
      case 'user': v = d.user ? `u:${d.user}` : `ip:${d.ip || 'unknown'}`; break; // anonymous callers share the IP bucket
      case 'organization': v = typeof d.organization === 'string' && SAFE.test(d.organization) ? d.organization : '-'; break;
      case 'endpoint': v = d.endpoint || '-'; break;
      case 'account': v = d.account ? String(d.account).trim().toLowerCase() : '-'; break; // body not read yet ⇒ ip-only
      case 'shareTokenPrefix': if (!d.shareToken) return null; v = String(d.shareToken).slice(0, 8); break;
      default: v = d[dim] != null ? String(d[dim]) : '-';
    }
    parts.push(`${dim}=${v}`);
  }
  return policy.policyId + '|' + crypto.createHash('sha256').update(parts.join('|')).digest('base64url').slice(0, 22);
}

/** createPolicyLimiter({ policies, maxKeys, now }) — fixed window; capacity = maxRequests + burst */
function createPolicyLimiter({ policies = loadPolicies(), maxKeys = 50000, now = Date.now, sweepMs = 60000 } = {}) {
  const hits = new Map();
  const sweep = () => { const t = now(); for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k); };
  const timer = setInterval(sweep, sweepMs); timer.unref && timer.unref();
  function hit(policy, key) {
    const t = now();
    let h = hits.get(key);
    if (!h || h.resetAt <= t) {
      if (!h && hits.size >= maxKeys) { sweep(); if (hits.size >= maxKeys) hits.delete(hits.keys().next().value); } // bounded memory
      h = { count: 0, resetAt: t + policy.windowSeconds * 1000 }; hits.set(key, h);
    }
    h.count++;
    const cap = policy.maxRequests + (policy.burst || 0);
    return h.count > cap ? { ok: false, policyId: policy.policyId, action: policy.action, retryAfter: Math.max(1, Math.ceil((h.resetAt - t) / 1000)) } : { ok: true, remaining: cap - h.count };
  }
  /** check(policyIds, dims, phase): phase 'pre' = policies without a user dimension (before authentication),
      'post' = policies keyed by user (after authentication). Returns the first rejection or { ok: true }. */
  function check(policyIds, dims, phase = 'all') {
    for (const id of policyIds) {
      const p = policies.get(id); if (!p) continue;
      if (phase === 'pre' && needsPrincipal(p)) continue;
      if (phase === 'post' && !needsPrincipal(p)) continue;
      const key = keyOf(p, dims); if (key == null) continue;
      const r = hit(p, key); if (!r.ok) return r;
    }
    return { ok: true };
  }
  return { check, classify: classifyRoute, policies, size: () => hits.size, stop: () => clearInterval(timer) };
}

module.exports = { loadPolicies, classifyRoute, keyOf, createPolicyLimiter, DEFAULT_FILE };
