#!/usr/bin/env node
'use strict';
/* IAM CLI (topics 30 + W3 login).
   Google login administration — allowed in every environment (this is how access is granted in production):
     node scripts/iam.js invite --email pessoa@exemplo.com --org org_house7 --role BROKER [--ttl-days 14]
     node scripts/iam.js invite --email pessoa@exemplo.com --org org_house7 --role PRICING_MANAGER@viva-juara
     node scripts/iam.js list-invites --org org_house7
     node scripts/iam.js revoke-invite --id <uuid>
     node scripts/iam.js revoke-sessions --user <uuid>
   The invitation is accepted at the next Google login of that verified e-mail (membership + role). The e-mail is only
   hashed (sha256 of the normalized address); it is never stored nor printed. No invitation = no permission.
   Development/test only (refused in production):
     node scripts/iam.js create-user --org org_house7 --name "Corretor 1" --role BROKER [--role PRICING_MANAGER@viva-juara] [--ttl-days 30]
     node scripts/iam.js issue-token --user <uuid> [--ttl-days 30]
     node scripts/iam.js revoke-token --token <plat_dev_...>
     node scripts/iam.js create-org --id org_example --slug example --name "Organização Exemplo"
   The token is printed ONCE; only its sha256 is stored. Use it as `Authorization: Bearer <token>` with AUTH_DEV_TOKENS=true.
   Explicit role grants of round-5 (explicitGrantOnly) keys — file config/iam/role-grants.json, no database:
     node scripts/iam.js grant --role COMMERCIAL_MANAGER --permission proposal.read --org org_house7 --decision "Edmilson 2026-11-02" --confirm
     node scripts/iam.js revoke-grant --role COMMERCIAL_MANAGER --permission proposal.read --org org_house7
     node scripts/iam.js list-grants
     node scripts/iam.js role --role OWNER_ADMIN          (effective template keys of a role, round-5 keys marked)
   Without --confirm a round-5 key is refused. OWNER_ADMIN already holds every round-5 key (decision 2026-10-18).
   Restart the server after a change (the file is read at startup). */
const crypto = require('crypto');
const path = require('path');
const { loadConfig } = require('../src/shared/config');
const { createPool } = require('../src/shared/db/pool');
const repo = require('../src/modules/iam/iam.repository');
const { provisionUser, issueToken } = require('../src/modules/iam/iam.admin');
const authRepo = require('../src/modules/auth/auth.repository');
const authAdmin = require('../src/modules/auth/auth.admin');

const PRODUCTION_COMMANDS = new Set(['invite', 'list-invites', 'revoke-invite', 'revoke-sessions']);

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--confirm') out.confirm = 'yes'; // boolean flag
    else if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = argv[i + 1]; out[k] = out[k] ? [].concat(out[k], v) : v; i++; } else out._.push(argv[i]);
  }
  return out;
}

const GRANT_COMMANDS = new Set(['grant', 'revoke-grant', 'list-grants', 'role']);
function grantsCommand(a) {
  const roleGrants = require('../src/modules/iam/roleGrants');
  const reg = require('../src/modules/iam/permissions');
  const file = process.env.IAM_ROLE_GRANTS_FILE ? path.resolve(process.env.IAM_ROLE_GRANTS_FILE) : path.resolve(__dirname, '..', 'config', 'iam', 'role-grants.json');
  const cmd = a._[0];
  if (cmd === 'list-grants') return console.log(JSON.stringify(roleGrants.list(file), null, 2));
  if (cmd === 'role') {
    if (!reg.ROLES[a.role]) throw new Error(`role needs --role (${Object.keys(reg.ROLES).join(', ')})`);
    return console.log(JSON.stringify(reg.ROLES[a.role].map(k => (reg.BY_KEY.get(k).explicitGrantOnly ? `${k} (rodada 5, ${reg.BY_KEY.get(k).feature})` : k)), null, 2));
  }
  if (!a.role || !a.permission || !a.org) throw new Error(`${cmd} needs --role, --permission and --org`);
  if (cmd === 'grant') {
    if (a.confirm !== undefined && a.confirm !== 'yes' && a.confirm !== true) throw new Error('--confirm takes no value');
    const r = roleGrants.grant(file, { roleCode: a.role, permission: a.permission, organizationId: a.org, decisionRef: a.decision, confirm: a.confirm !== undefined });
    return console.log(JSON.stringify({ ...r, file: path.relative(process.cwd(), file), note: 'reinicie o servidor para aplicar' }, null, 2));
  }
  console.log(`removed ${roleGrants.revoke(file, { roleCode: a.role, permission: a.permission, organizationId: a.org })} grant(s); reinicie o servidor para aplicar`);
}

async function main() {
  const a = args(process.argv.slice(2));
  if (GRANT_COMMANDS.has(a._[0])) return grantsCommand(a);
  const config = loadConfig();
  if (config.isProduction && !PRODUCTION_COMMANDS.has(a._[0])) throw new Error(`scripts/iam.js ${a._[0] || ''}: development/test only (in production: ${[...PRODUCTION_COMMANDS].join(', ')})`);
  const pool = createPool(config.db);
  const ttlSeconds = Math.round(Number(a['ttl-days'] || 30) * 86400);
  try {
    const cmd = a._[0];
    if (cmd === 'create-user') {
      if (!a.org || !a.name) throw new Error('create-user needs --org and --name');
      const roles = [].concat(a.role || []).map(r => { const [roleCode, developmentId] = r.split('@'); return { roleCode, developmentId: developmentId || null }; });
      const r = await provisionUser(pool, { organizationId: a.org, displayName: a.name, roles, ttlSeconds, label: 'cli' });
      console.log(JSON.stringify({ userId: r.userId, token: r.token, note: 'token shown once; only its sha256 is stored' }, null, 2));
    } else if (cmd === 'issue-token') {
      if (!a.user) throw new Error('issue-token needs --user');
      console.log(JSON.stringify({ userId: a.user, token: await issueToken(pool, a.user, { ttlSeconds, label: 'cli' }) }, null, 2));
    } else if (cmd === 'revoke-token') {
      if (!a.token) throw new Error('revoke-token needs --token');
      await repo.revokeToken(pool, crypto.createHash('sha256').update(a.token).digest('hex'));
      console.log('revoked');
    } else if (cmd === 'invite') {
      if (!a.email || !a.org || !a.role) throw new Error('invite needs --email, --org and --role');
      const r = await authAdmin.invite(authRepo.createPgIdentityStore(pool), { email: a.email, organizationId: a.org, role: a.role, ttlDays: a['ttl-days'] || 14, invitedBy: 'admin' });
      console.log(JSON.stringify({ ...r, note: 'convite criado para o e-mail informado (só o hash é guardado); vale no próximo login Google dessa conta' }, null, 2));
    } else if (cmd === 'list-invites') {
      if (!a.org) throw new Error('list-invites needs --org');
      console.log(JSON.stringify(await authRepo.createPgIdentityStore(pool).listInvitations(a.org), null, 2));
    } else if (cmd === 'revoke-invite') {
      if (!a.id) throw new Error('revoke-invite needs --id');
      console.log((await authRepo.createPgIdentityStore(pool).revokeInvitation(a.id)) ? 'revoked' : 'not pending (nothing changed)');
    } else if (cmd === 'revoke-sessions') {
      if (!a.user) throw new Error('revoke-sessions needs --user');
      console.log(`revoked ${await authRepo.createPgSessionStore(pool).revokeUser(a.user, 'ADMIN', Date.now())} session(s)`);
    } else if (cmd === 'create-org') {
      await repo.createOrganization(pool, { id: a.id, slug: a.slug, displayName: a.name });
      console.log(`created ${a.id}`);
    } else throw new Error('usage: invite | list-invites | revoke-invite | revoke-sessions | create-user | issue-token | revoke-token | create-org | grant | revoke-grant | list-grants | role (see header)');
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e.message); process.exit(1); });
