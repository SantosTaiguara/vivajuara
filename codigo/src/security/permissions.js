/* security/permissions.js — App.permissions (topic 30): PermissionRegistry, PermissionRiskMatrix, role templates,
   Feature/Action/Route permission matrices. Data comes from config/security/*.json (bundled in App.configs.security);
   this module only validates and indexes it. Components use KEYS / feature ids, never loose strings or role codes.
   Unknown permission → not in registry → always denied. */
App.permissions = (() => {
  const RISK = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });
  const RISK_ORDER = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 });
  const SCOPE = Object.freeze({ GLOBAL: 'GLOBAL', ORGANIZATION: 'ORGANIZATION', DEVELOPMENT: 'DEVELOPMENT' });
  const KEY_RE = /^[a-z][a-z_]*(\.[a-z][a-zA-Z_]*)+$/;
  const cfg = () => (App.configs && App.configs.security) || {};
  let idx = null;
  function index() {
    if (idx) return idx;
    const reg = cfg().permissions || { permissions: [] }, roles = (cfg().roles || { roles: [] }).roles, fm = cfg().features || { features: {}, actions: {}, uiOnlyActions: {}, routes: {}, detailSections: {} };
    const byKey = new Map((reg.permissions || []).map(p => [p.key, Object.freeze({ ...p, scopeTypes: Object.freeze([...(p.scopeTypes || [])]) })]));
    const keys = {}; for (const k of byKey.keys()) keys[k.toUpperCase().replace(/[^A-Z0-9]+/g, '_')] = k;
    idx = { reg, byKey, KEYS: Object.freeze(keys), roles: new Map((roles || []).map(r => [r.code, Object.freeze({ ...r, grants: Object.freeze([...(r.grants || [])]) })])), fm };
    return idx;
  }
  const get = key => index().byKey.get(key) || null;
  const has = key => index().byKey.has(key);
  const list = () => [...index().byKey.values()];
  /** assertKnown(key): throws for typos (use in tests / dev). */
  function assertKnown(key) { if (!has(key)) throw Object.assign(new Error(`permissão desconhecida: ${key}`), { code: 'UNKNOWN_PERMISSION' }); return key; }
  const riskOf = key => (get(key) || {}).riskLevel || null;
  const isAnonymousAllowed = key => !!(get(key) || {}).anonymousAllowed;
  const onlineRequired = key => !!(get(key) || {}).onlineRequired;
  const auditRequired = key => { const p = get(key); return !!p && (p.auditRequired || RISK_ORDER[p.riskLevel] >= RISK_ORDER.HIGH); };
  const policyVersion = () => index().reg.policyVersion || null;
  const registryVersion = () => index().reg.version || null;
  const role = code => index().roles.get(code) || null;
  const roles = () => [...index().roles.values()];
  const grantsOf = code => (role(code) || { grants: [] }).grants;
  const feature = id => (index().fm.features || {})[id] || null;
  const features = () => ({ ...(index().fm.features || {}) });
  const routes = () => ({ ...(index().fm.routes || {}) });
  const actions = () => ({ ...(index().fm.actions || {}) });
  const uiOnlyActions = () => ({ ...(index().fm.uiOnlyActions || {}) });
  const sectionFeature = id => (index().fm.detailSections || {})[id] || null;
  /** featureOfAction(act, dataset) → feature id | null (unknown) | '' (UI-only control). */
  function featureOfAction(act, dataset = {}) {
    const a = (index().fm.actions || {})[act];
    if (a == null) return Object.prototype.hasOwnProperty.call(index().fm.uiOnlyActions || {}, act) ? '' : null;
    if (typeof a === 'string') return a;
    const v = dataset ? dataset[a.variantKey] : undefined;
    return (v != null && a.variants && a.variants[v]) || a.default || null;
  }

  /** validate() → errors[] (registry integrity, role grants, feature matrix references). Run by tests and docs. */
  function validate() {
    const errs = [], E = (code, m) => errs.push({ code, message: m }), { reg, byKey, fm } = index();
    const seen = new Set();
    for (const p of reg.permissions || []) {
      if (seen.has(p.key)) E('DUPLICATE_PERMISSION', p.key); seen.add(p.key);
      if (!KEY_RE.test(p.key || '')) E('INVALID_KEY', p.key);
      if (!RISK[p.riskLevel]) E('INVALID_RISK', p.key);
      if (!(p.scopeTypes || []).length || p.scopeTypes.some(s => !SCOPE[s])) E('INVALID_SCOPE', p.key);
      if (p.anonymousAllowed && RISK_ORDER[p.riskLevel] >= RISK_ORDER.HIGH) E('ANONYMOUS_HIGH_RISK', p.key);
      if (p.anonymousAllowed && p.onlineRequired) E('ANONYMOUS_ONLINE_WRITE', p.key);
      if (p.systemOnly && p.scopeTypes.some(s => s !== 'GLOBAL')) E('SYSTEM_SCOPE', p.key);
    }
    for (const r of roles()) for (const g of r.grants) {
      if (!byKey.has(g)) E('UNKNOWN_GRANT', `${r.code}: ${g}`);
      else if (byKey.get(g).systemOnly) E('SYSTEM_PERMISSION_IN_TENANT_ROLE', `${r.code}: ${g}`);
      if ((r.principalTypes || []).includes('ANONYMOUS') && byKey.has(g) && !byKey.get(g).anonymousAllowed) E('ANONYMOUS_ROLE_GRANT', `${r.code}: ${g}`);
    }
    for (const [id, f] of Object.entries(fm.features || {})) {
      if (!(f.permissions || []).length) E('FEATURE_WITHOUT_PERMISSION', id);
      for (const k of f.permissions || []) if (!byKey.has(k)) E('FEATURE_UNKNOWN_PERMISSION', `${id}: ${k}`);
      if (!['hide', 'disable'].includes(f.deny)) E('FEATURE_DENY_MODE', id);
    }
    const fids = new Set(Object.keys(fm.features || {}));
    const refs = [...Object.values(fm.routes || {}), ...Object.values(fm.detailSections || {})];
    for (const a of Object.values(fm.actions || {})) if (typeof a === 'string') refs.push(a); else { refs.push(...Object.values(a.variants || {})); if (a.default) refs.push(a.default); }
    for (const r of refs) if (!fids.has(r)) E('UNKNOWN_FEATURE', r);
    for (const a of Object.keys(fm.uiOnlyActions || {})) if ((fm.actions || {})[a]) E('ACTION_BOTH_UI_AND_FEATURE', a);
    return errs;
  }
  /** markdownTable() — generated documentation (PERMISSION_REGISTRY.md). */
  function markdownTable() {
    const yes = b => b ? 'sim' : '—';
    const rows = list().map(p => `| \`${p.key}\` | ${p.riskLevel} | ${p.scopeTypes.join(', ')} | ${yes(p.anonymousAllowed)} | ${yes(p.onlineRequired)} | ${yes(p.reasonRequired)} | ${yes(auditRequired(p.key))} | ${roles().filter(r => r.grants.includes(p.key)).map(r => r.code).join(', ') || (p.systemOnly ? 'SYSTEM' : '—')} | ${p.description} |`);
    return ['| Permissão | Risco | Escopos | Anônimo | Online | Motivo | Auditoria | Roles (templates) | Descrição |', '|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
  }
  const KEYS = new Proxy({}, { get: (_, k) => index().KEYS[k], ownKeys: () => Reflect.ownKeys(index().KEYS), getOwnPropertyDescriptor: (_, k) => ({ enumerable: true, configurable: true, value: index().KEYS[k] }) });
  return Object.freeze({ RISK, RISK_ORDER, SCOPE, KEYS, get, has, list, assertKnown, riskOf, isAnonymousAllowed, onlineRequired, auditRequired, policyVersion, registryVersion,
    role, roles, grantsOf, feature, features, routes, actions, uiOnlyActions, sectionFeature, featureOfAction, validate, markdownTable });
})();
