'use strict';
/* User provisioning for development/test (topic 30): creates a user, an ACTIVE membership, role assignments and a
   dev token in one transaction. Used by scripts/iam.js and the tests; there is no HTTP route for it yet (user/role
   management UI is phase 3). Every role code and permission is validated against the registry; the raw token is
   returned once and never stored. */
const repo = require('./iam.repository');
const reg = require('./permissions');
const { newDevToken } = require('./authentication');
const { withTransaction } = require('../../shared/db/pool');

async function provisionUser(pool, { organizationId, displayName, roles = [], ttlSeconds = 30 * 24 * 3600, assignedBy = 'admin', status = 'ACTIVE', membershipStatus = 'ACTIVE', label = null }) {
  for (const r of roles) if (!reg.ROLES[r.roleCode]) throw new Error(`unknown role ${r.roleCode}`);
  return withTransaction(pool, async db => {
    const userId = await repo.createUser(db, { displayName, status });
    if (organizationId) await repo.addMembership(db, organizationId, userId, membershipStatus);
    const assignmentIds = [];
    for (const r of roles) assignmentIds.push(await repo.assignRole(db, { userId, roleCode: r.roleCode, organizationId: r.organizationId || organizationId, developmentId: r.developmentId || null, assignedBy }));
    const { token, tokenHash } = newDevToken();
    const tokenId = await repo.insertToken(db, { userId, tokenHash, label, expiresAt: new Date(Date.now() + ttlSeconds * 1000) });
    return { userId, token, tokenId, assignmentIds };
  });
}

async function issueToken(pool, userId, { ttlSeconds = 30 * 24 * 3600, label = null } = {}) {
  const { token, tokenHash } = newDevToken();
  await repo.insertToken(pool, { userId, tokenHash, label, expiresAt: new Date(Date.now() + ttlSeconds * 1000) });
  return token;
}

module.exports = { provisionUser, issueToken };
