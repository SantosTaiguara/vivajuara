'use strict';
/* Deterministic checksums (sha256 over key-sorted JSON). */
const crypto = require('crypto');

function stable(v) {
  return Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
}
const stableStringify = v => JSON.stringify(stable(v));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const checksumOf = v => sha256(stableStringify(v));

module.exports = { stable, stableStringify, sha256, checksumOf };
