/* documents/integrity.js — integrity primitives shared by topics 32, 33 and 34.
   Pure and synchronous (browser, Node harness and backend vm alike):
   - sha256(bytes | string) → hex (FIPS 180-4; strings are hashed as UTF-8)
   - canonicalSerialize(value): deterministic JSON (keys sorted at every level, -0 → 0,
     non-finite numbers and undefined made explicit) — the input of every fingerprint
   - fingerprint(value) → 'fp1:' + sha256(canonical) — null has its own fingerprint (§32 topic 33)
   - stableId(prefix, ...parts) → deterministic id (never a filename, never a path)
   - detectMediaType(bytes) → MIME from magic bytes (the extension is never trusted)
   No clock, no randomness, no I/O. */
App.integrity = (() => {
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
    0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const ENC = typeof TextEncoder === 'function' ? new TextEncoder() : null;
  function utf8(s) {
    if (ENC) return ENC.encode(s);
    const out = []; for (let i = 0; i < s.length; i++) { let c = s.charCodeAt(i);
      if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
      if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63); else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63); }
    return Uint8Array.from(out);
  }
  const toBytes = x => typeof x === 'string' ? utf8(x) : x instanceof Uint8Array ? x : x && x.buffer instanceof ArrayBuffer ? new Uint8Array(x.buffer, x.byteOffset || 0, x.byteLength)
    : x instanceof ArrayBuffer ? new Uint8Array(x) : Array.isArray(x) ? Uint8Array.from(x) : (() => { throw Object.assign(new Error('sha256: entrada inválida'), { code: 'INVALID_INPUT' }); })();
  const H0 = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W64 = new Uint32Array(64);
  const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
  /** sha256(bytes | string) → 64 hex chars */
  function sha256(input) {
    const m = toBytes(input), len = m.length, total = ((len + 9 + 63) >> 6) << 6, b = new Uint8Array(total);
    b.set(m); b[len] = 0x80; const bits = len * 8, dv = new DataView(b.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000)); dv.setUint32(total - 4, bits >>> 0);
    const H = new Uint32Array(H0), W = W64;
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const x = W[i - 15], y = W[i - 2];
        W[i] = (((x >>> 7 | x << 25) ^ (x >>> 18 | x << 14) ^ x >>> 3) + W[i - 7] + ((y >>> 17 | y << 15) ^ (y >>> 19 | y << 13) ^ y >>> 10) + W[i - 16]) >>> 0; }
      let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = (((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    let out = ''; for (let i = 0; i < 8; i++) { const x = H[i]; out += HEX[x >>> 24] + HEX[(x >>> 16) & 255] + HEX[(x >>> 8) & 255] + HEX[x & 255]; }
    return out;
  }
  /** canonicalSerialize(v): deterministic text; distinguishes null, undefined, NaN and ±Infinity explicitly */
  function canonicalSerialize(v) {
    if (v === null) return 'null';
    if (v === undefined) return '"$undefined"';
    if (typeof v === 'number') return Number.isNaN(v) ? '"$NaN"' : v === Infinity ? '"$Infinity"' : v === -Infinity ? '"$-Infinity"' : JSON.stringify(Object.is(v, -0) ? 0 : v);
    if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'bigint') return JSON.stringify('$bigint:' + v.toString());
    if (v instanceof Date) return JSON.stringify(v.toISOString());
    if (Array.isArray(v)) return '[' + v.map(canonicalSerialize).join(',') + ']';
    if (typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonicalSerialize(v[k])).join(',') + '}';
    throw Object.assign(new Error('valor não serializável: ' + typeof v), { code: 'NOT_SERIALIZABLE' });
  }
  const FINGERPRINT_VERSION = 'fp1';
  /** fingerprint(value) → 'fp1:<sha256>' of the canonical serialization (value fingerprint of topic 33) */
  const fingerprint = v => FINGERPRINT_VERSION + ':' + sha256(canonicalSerialize(v));
  /** stableId('prov', org, entity, path, fp) → 'prov_<24 hex>' — deterministic, reproducible */
  const stableId = (prefix, ...parts) => prefix + '_' + sha256(parts.map(p => canonicalSerialize(p)).join('|')).slice(0, 24);
  /** checksumOf(object) → 'sha256:<hex>' of the canonical form (configs, snapshots, manifests) */
  const checksumOf = v => 'sha256:' + sha256(canonicalSerialize(v));
  /** detectMediaType(bytes) → { mediaType, scriptable, container } — server-side check of the declared type */
  function detectMediaType(input) {
    const b = toBytes(input), s = Array.from(b.subarray(0, 64), c => String.fromCharCode(c)).join(''), t = s.replace(/^﻿/, '').trimStart().toLowerCase();
    const r = (mediaType, o = {}) => Object.freeze({ mediaType, scriptable: !!o.scriptable, container: !!o.container });
    if (s.startsWith('%PDF-')) return r('application/pdf');
    if (b[0] === 0x89 && s.slice(1, 4) === 'PNG') return r('image/png');
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return r('image/jpeg');
    if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return r('image/webp');
    if (s.startsWith('GIF87a') || s.startsWith('GIF89a')) return r('image/gif');
    if (s.startsWith('PK\u0003\u0004')) return r('application/zip', { container: true }); // xlsx, docx, kmz: the container is known, the content needs a parser
    if (t.startsWith('<svg') || (t.startsWith('<?xml') && /<svg/.test(t))) return r('image/svg+xml', { scriptable: true });
    if (t.startsWith('<!doctype html') || t.startsWith('<html') || t.startsWith('<script')) return r('text/html', { scriptable: true });
    if (t.startsWith('<?xml') && /<kml/.test(t)) return r('application/vnd.google-earth.kml+xml');
    if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return r('application/x-ole-storage', { scriptable: true, container: true }); // legacy Office (macros)
    if (s.startsWith('MZ') || s.startsWith('\u007fELF')) return r('application/x-executable', { scriptable: true });
    return r(null);
  }
  return Object.freeze({ sha256, utf8, canonicalSerialize, fingerprint, FINGERPRINT_VERSION, stableId, checksumOf, detectMediaType });
})();
