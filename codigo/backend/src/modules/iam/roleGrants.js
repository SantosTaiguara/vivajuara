'use strict';
/* Explicit role grants of explicit-grant-only (round 5) permission keys, beyond the role templates of permissions.js.
   File: config/iam/role-grants.json (IAM_ROLE_GRANTS_FILE overrides), read at startup; absent file = no grant.
   Written only by `npm run iam -- grant|revoke-grant` (scripts/iam.js). A round-5 key is refused unless `confirm`
   is true (the operator states a human decided), and every grant carries organizationId + decisionRef.
   OWNER_ADMIN already holds every round-5 key (decision 2026-10-18), so granting it again is refused as redundant.
   No secret, no personal data in this file (role codes, permission keys, organization ids, a decision reference). */
const fs = require('fs');
const path = require('path');
const reg = require('./permissions');

const KIND = 'iam-explicit-role-grants';
const EMPTY = () => ({ kind: KIND, version: 1, note: 'Concessões explícitas de permissões explicitGrantOnly (rodada 5) a papéis além do template. OWNER_ADMIN já recebe todas por decisão de 2026-10-18 (Edmilson). Editar só com `npm run iam -- grant ... --confirm`; nenhum segredo aqui.', grants: [] });

function readFile(file) {
  if (!fs.existsSync(file)) return EMPTY();
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!doc || doc.kind !== KIND || !Array.isArray(doc.grants)) throw new Error(`${file}: not an ${KIND} document`);
  return doc;
}
/** loadRoleGrants(file) → validated grants[] (throws on an invalid file: fail closed at startup) */
function loadRoleGrants(file) {
  const { grants } = readFile(file);
  const errors = reg.validateGrants(grants);
  if (errors.length) throw new Error(`${file}: ${errors.join('; ')}`);
  return grants;
}
function writeFile(file, doc) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

/** grant(file, { roleCode, permission, organizationId, decisionRef, confirm, now }) → { added, grant } */
function grant(file, { roleCode, permission, organizationId, decisionRef, confirm = false, now = new Date() }) {
  const p = reg.BY_KEY.get(permission);
  if (!p) throw new Error(`permissão desconhecida "${permission}"`);
  if (!p.explicitGrantOnly) throw new Error(`"${permission}" não é uma permissão de concessão explícita: ela vem dos templates de papel (permissions.js)`);
  if (!confirm) throw new Error(`"${permission}" é uma permissão da rodada 5 (${p.feature}): a concessão exige decisão humana; repita com --confirm e --decision "<quem decidiu, quando>"`);
  if (!reg.ROLES[roleCode]) throw new Error(`papel desconhecido "${roleCode}" (válidos: ${Object.keys(reg.ROLES).join(', ')})`);
  if (reg.ROLES[roleCode].includes(permission)) throw new Error(`${roleCode} já tem "${permission}" pelo template (nada a conceder)`);
  const g = { roleCode, permission, organizationId, decisionRef, grantedAt: now.toISOString() };
  const errors = reg.validateGrants([g]);
  if (errors.length) throw new Error(errors.join('; '));
  const doc = readFile(file);
  if (doc.grants.some(x => x.roleCode === roleCode && x.permission === permission && x.organizationId === organizationId)) return { added: false, grant: g };
  doc.grants.push(g);
  doc.grants.sort((a, b) => `${a.organizationId} ${a.roleCode} ${a.permission}`.localeCompare(`${b.organizationId} ${b.roleCode} ${b.permission}`));
  writeFile(file, doc);
  return { added: true, grant: g };
}
/** revoke(file, { roleCode, permission, organizationId }) → removed count */
function revoke(file, { roleCode, permission, organizationId }) {
  const doc = readFile(file);
  const before = doc.grants.length;
  doc.grants = doc.grants.filter(x => !(x.roleCode === roleCode && x.permission === permission && x.organizationId === organizationId));
  if (doc.grants.length !== before) writeFile(file, doc);
  return before - doc.grants.length;
}
const list = file => readFile(file).grants;

module.exports = { loadRoleGrants, grant, revoke, list, readFile, KIND };
