'use strict';
/* PermissionRegistry + system RoleTemplates (topic 30). The ONLY place where permission keys and role grants are
   written: routes, the authorization service, GET /api/v1/iam/registry and the docs read from here (no string
   scatter). Pure data + pure functions, no I/O.
   - Permission key: dot-separated `resource.action` (e.g. lot.price.view, price_table.publish).
   - riskLevel: LOW | MEDIUM | HIGH | CRITICAL. HIGH/CRITICAL actions are audited (success and denial).
   - publicRead: may be exercised by ANY principal (anonymous included) on a development whose visibility is PUBLIC.
     Public never means cross-tenant internal access: it only covers PUBLIC developments.
   - systemOnly: never grantable to a tenant role (platform principal only).
   - explicitGrantOnly (round 5, see round5.js): never granted by a generic rule; held only through a dated, explicit
     decision (OWNER_ADMIN, decision 2026-10-18) or an explicit grant (config/iam/role-grants.json). feature = the
     FEATURE_* flag of the module that exposes it; with the flag off the key is not listed by /me nor /iam/registry.
   Default: deny. A permission absent from every grant is denied. */
const round5 = require('./round5');

const POLICY_VERSION = 'iam-2026-10-08.1';

const P = (key, riskLevel, description, o = {}) => Object.freeze({
  key, resource: key.split('.').slice(0, -1).join('.'), action: key.split('.').slice(-1)[0], riskLevel, description,
  scopeTypes: Object.freeze(o.scopeTypes || ['ORGANIZATION', 'DEVELOPMENT']), publicRead: !!o.publicRead, systemOnly: !!o.systemOnly,
  enforcedBy: o.enforcedBy || 'BACKEND', explicitGrantOnly: !!o.explicitGrantOnly, feature: o.feature || null
});

const PERMISSIONS = Object.freeze([
  P('development.view', 'LOW', 'Ver o empreendimento, configuração pública, manifesto e fontes.', { publicRead: true }),
  P('lot.view', 'LOW', 'Ver lotes (mapa, lista, busca, ficha, proveniência).', { publicRead: true }),
  P('lot.price.view', 'LOW', 'Ver preço de tabela corrente e tabelas publicadas.', { publicRead: true }),
  P('lot.price_history.view', 'LOW', 'Ver o histórico do preço de tabela publicado (versões imutáveis).', { publicRead: true }),
  P('lot.availability.view', 'LOW', 'Ver disponibilidade comercial, manifesto, histórico e stream.', { publicRead: true }),
  P('lot.analysis.view', 'LOW', 'Ver a análise publicada (scores, classes, rankings).', { publicRead: true }),
  P('lot.compare', 'LOW', 'Comparar lotes (executado no cliente sobre dados públicos).', { publicRead: true, enforcedBy: 'FRONTEND' }),
  P('lot.simulate', 'LOW', 'Simular condições de pagamento (executado no cliente).', { publicRead: true, enforcedBy: 'FRONTEND' }),
  P('share.create', 'LOW', 'Gerar texto/link de compartilhamento de fatos públicos.', { publicRead: true, enforcedBy: 'FRONTEND' }),
  P('customer_profile.manage', 'MEDIUM', 'Criar/editar o perfil de cliente da sessão (sem PII persistida no servidor).', { publicRead: true, enforcedBy: 'FRONTEND' }),
  P('analysis.preview', 'HIGH', 'Rodar a prévia de impacto de metodologia (nada é publicado).'),
  P('availability.write', 'HIGH', 'Alterar o status comercial de um lote (máquina de estados + revisão).'),
  P('price_table.publish', 'CRITICAL', 'Publicar nova versão imutável de tabela de preço (inclui dry-run).'),
  P('admin.audit.view', 'HIGH', 'Consultar eventos de auditoria da própria organização.', { scopeTypes: ['ORGANIZATION'] }),
  P('platform.cross_tenant', 'CRITICAL', 'Acesso explícito entre organizações (somente principal de plataforma).', { scopeTypes: ['GLOBAL'], systemOnly: true })
]);
/** round 5 (topics 57-63): explicit-grant-only keys, exposed per module feature flag */
const ROUND5_PERMISSIONS = Object.freeze(round5.definitions().map(d => P(d.key, d.riskLevel, d.description, { scopeTypes: d.scopeTypes, explicitGrantOnly: true, feature: d.feature })));
const ALL_PERMISSIONS = Object.freeze([...PERMISSIONS, ...ROUND5_PERMISSIONS]);
const BY_KEY = new Map(ALL_PERMISSIONS.map(p => [p.key, p]));
/** KEYS = the pre-round-5 keys (unchanged meaning: what SYSTEM / the registry listed before); ALL_KEYS includes round 5 */
const KEYS = Object.freeze(PERMISSIONS.map(p => p.key));
const ALL_KEYS = Object.freeze(ALL_PERMISSIONS.map(p => p.key));
const ROUND5_KEYS = Object.freeze(ROUND5_PERMISSIONS.map(p => p.key));
const PUBLIC_READ = Object.freeze(PERMISSIONS.filter(p => p.publicRead).map(p => p.key));
const VIEW = ['development.view', 'lot.view', 'lot.price.view', 'lot.price_history.view', 'lot.availability.view', 'lot.analysis.view'];
const CLIENT_TOOLS = ['lot.compare', 'lot.simulate'];

/** System role templates (topic 30 §63): starting points, reviewed by humans; authorization never checks a role code. */
const ROLES = Object.freeze({
  // pre-round-5 keys (generic rule, unchanged) + round-5 keys by explicit decision 2026-10-18 (round5.ROUND5_ROLE_DECISION)
  OWNER_ADMIN: Object.freeze([...KEYS.filter(k => !BY_KEY.get(k).systemOnly), ...ROUND5_KEYS]),
  COMMERCIAL_MANAGER: Object.freeze([...VIEW, ...CLIENT_TOOLS, 'share.create', 'customer_profile.manage', 'availability.write', 'admin.audit.view']),
  PRICING_MANAGER: Object.freeze([...VIEW, ...CLIENT_TOOLS, 'price_table.publish', 'analysis.preview']),
  INVENTORY_MANAGER: Object.freeze([...VIEW, 'availability.write']),
  BROKER: Object.freeze([...VIEW, ...CLIENT_TOOLS, 'share.create', 'customer_profile.manage']),
  MARKETING: Object.freeze([...VIEW, 'share.create']),
  ANALYST: Object.freeze([...VIEW, ...CLIENT_TOOLS, 'analysis.preview']),
  VIEWER: Object.freeze([...VIEW])
});
/** pseudo-role of the anonymous principal: public permissions, valid only on PUBLIC developments */
const PUBLIC_VISITOR = PUBLIC_READ;

/** explicit grants (role → round-5 key, per organization) installed at startup from config/iam/role-grants.json */
let EXPLICIT = Object.freeze([]);
/** roles that may hold explicitGrantOnly keys from their template (each one backed by a dated decision record) */
const TEMPLATE_EXPLICIT_HOLDERS = Object.freeze({ OWNER_ADMIN: round5.ROUND5_ROLE_DECISION });

/** validateGrants(list) → errors[] — every grant: known role, known explicitGrantOnly key, organization id, decision reference */
function validateGrants(list) {
  const errors = [];
  if (!Array.isArray(list)) return ['grants must be an array'];
  list.forEach((g, i) => {
    const at = `grants[${i}]`;
    if (!g || typeof g !== 'object') return errors.push(`${at}: object expected`);
    if (!ROLES[g.roleCode]) errors.push(`${at}: unknown role ${g.roleCode}`);
    const p = BY_KEY.get(g.permission);
    if (!p) errors.push(`${at}: unknown permission ${g.permission}`);
    else if (!p.explicitGrantOnly) errors.push(`${at}: ${g.permission} is not an explicit-grant permission (role templates decide it)`);
    else if (p.systemOnly) errors.push(`${at}: ${g.permission} is system-only`);
    if (!/^org_[a-z0-9_]{2,60}$/.test(g.organizationId || '')) errors.push(`${at}: organizationId required (org_…)`);
    if (!g.decisionRef || typeof g.decisionRef !== 'string') errors.push(`${at}: decisionRef required (who decided, when)`);
  });
  return errors;
}
function installExplicitGrants(list = []) {
  const errors = validateGrants(list);
  if (errors.length) throw new Error(`invalid explicit role grants: ${errors.join('; ')}`);
  const prev = EXPLICIT;
  EXPLICIT = Object.freeze(list.map(g => Object.freeze({ roleCode: g.roleCode, permission: g.permission, organizationId: g.organizationId, decisionRef: g.decisionRef })));
  return prev;
}
const explicitGrants = () => EXPLICIT;
/** keys a role grants in an organization: template + explicit grants of that organization */
function roleKeys(roleCode, organizationId) {
  const base = ROLES[roleCode];
  if (!base) return [];
  if (!EXPLICIT.length) return base;
  const extra = EXPLICIT.filter(g => g.roleCode === roleCode && g.organizationId === organizationId).map(g => g.permission);
  return extra.length ? [...new Set([...base, ...extra])] : base;
}

function assertKnown(key) {
  if (!BY_KEY.has(key)) throw new Error(`unknown permission key "${key}" (not in the PermissionRegistry)`);
  return BY_KEY.get(key);
}

/** registry self-check: every grant is a known, grantable key (used at startup and by the tests) */
function validateRegistry() {
  const errors = [];
  for (const [role, keys] of Object.entries(ROLES)) for (const k of keys) {
    if (!BY_KEY.has(k)) errors.push(`${role}: unknown permission ${k}`);
    else if (BY_KEY.get(k).systemOnly) errors.push(`${role}: ${k} is system-only`);
  }
  for (const [role, keys] of Object.entries(ROLES)) for (const k of keys) {
    if (BY_KEY.has(k) && BY_KEY.get(k).explicitGrantOnly && !TEMPLATE_EXPLICIT_HOLDERS[role]) errors.push(`${role}: ${k} is explicit-grant-only (no decision record for this role)`);
  }
  for (const p of ALL_PERMISSIONS) if (!/^[a-z][a-z_]*(\.[a-z][a-z_]*)+$/.test(p.key)) errors.push(`bad key format ${p.key}`);
  if (new Set(ALL_KEYS).size !== ALL_KEYS.length) errors.push('duplicate permission key');
  return errors;
}

/** public description (GET /api/v1/iam/registry). enabled = Set of FEATURE_* names that are on: round-5 keys of a
    module that is off are not listed (with every flag off the DTO is byte-identical to the pre-round-5 one). */
function registryDto({ enabled = null } = {}) {
  const on = k => round5.isActive(k, enabled);
  return {
    policyVersion: POLICY_VERSION,
    permissions: ALL_PERMISSIONS.filter(p => on(p.key)).map(p => ({ key: p.key, resource: p.resource, action: p.action, riskLevel: p.riskLevel, scopeTypes: [...p.scopeTypes],
      publicRead: p.publicRead, systemOnly: p.systemOnly, enforcedBy: p.enforcedBy, description: p.description })),
    roles: Object.entries(ROLES).map(([code, keys]) => ({ code, roleType: 'SYSTEM', permissions: keys.filter(on).sort() })),
    publicVisitorPermissions: [...PUBLIC_VISITOR].sort()
  };
}

module.exports = { POLICY_VERSION, PERMISSIONS, KEYS, BY_KEY, PUBLIC_READ, PUBLIC_VISITOR, ROLES, assertKnown, validateRegistry, registryDto,
  ROUND5_PERMISSIONS, ROUND5_KEYS, ALL_PERMISSIONS, ALL_KEYS, TEMPLATE_EXPLICIT_HOLDERS, validateGrants, installExplicitGrants, explicitGrants, roleKeys };
