'use strict';
/* Output (DTO) validation against OpenAPI 3.0 schema objects — the same objects published in
   docs/openapi.json (components.schemas). Supported subset: $ref (#/components/schemas/X), type,
   nullable, enum, required, properties, additionalProperties (false | schema), items, minItems,
   maxItems, minimum, maximum, pattern, format (date-time, date), oneOf.
   Annotation keywords (description, example, deprecated, x-*) are ignored.
   Used by the server when VALIDATE_RESPONSES=true (default outside production) and by the contract tests. */

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ERRORS = 20;

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** validate(value, schema, components) → [] | [{ path, message }] */
function validate(value, schema, components = {}) {
  const errors = [];
  const resolve = s => {
    let guard = 0;
    while (s && s.$ref) {
      const m = /^#\/components\/schemas\/(.+)$/.exec(s.$ref);
      const next = m && components[m[1]];
      if (!next || ++guard > 20) throw new Error(`unresolvable $ref ${s.$ref}`);
      s = next;
    }
    return s;
  };
  const fail = (path, message) => { if (errors.length < MAX_ERRORS) errors.push({ path: path || '(root)', message }); };

  function walk(v, s, path) {
    if (errors.length >= MAX_ERRORS) return;
    s = resolve(s);
    if (!s || Object.keys(s).length === 0) return; // {} = any
    if (v === null) { if (!s.nullable) fail(path, 'null not allowed'); return; }
    if (v === undefined) { fail(path, 'undefined value'); return; }
    if (s.oneOf) {
      const ok = s.oneOf.filter(alt => validate(v, alt, components).length === 0).length;
      if (ok !== 1) fail(path, `matches ${ok} of oneOf alternatives (expected exactly 1)`);
      return;
    }
    if (s.enum && !s.enum.includes(v)) { fail(path, `value ${JSON.stringify(v)} not in enum`); return; }
    const t = typeOf(v);
    if (s.type) {
      const okType = s.type === t || (s.type === 'number' && t === 'integer');
      if (!okType) { fail(path, `expected ${s.type}, got ${t}`); return; }
    }
    if (t === 'number' || t === 'integer') {
      if (!Number.isFinite(v)) fail(path, 'non-finite number');
      if (s.minimum != null && v < s.minimum) fail(path, `below minimum ${s.minimum}`);
      if (s.maximum != null && v > s.maximum) fail(path, `above maximum ${s.maximum}`);
    }
    if (t === 'string') {
      if (s.format === 'date-time' && !(DATE_TIME_RE.test(v) && !Number.isNaN(Date.parse(v)))) fail(path, `not an ISO 8601 date-time: ${v}`);
      if (s.format === 'date' && !DATE_RE.test(v)) fail(path, `not an ISO 8601 date: ${v}`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) fail(path, `does not match ${s.pattern}`);
    }
    if (t === 'array') {
      if (s.minItems != null && v.length < s.minItems) fail(path, `fewer than ${s.minItems} items`);
      if (s.maxItems != null && v.length > s.maxItems) fail(path, `more than ${s.maxItems} items`);
      if (s.items) for (let i = 0; i < v.length && errors.length < MAX_ERRORS; i++) walk(v[i], s.items, `${path}[${i}]`);
    }
    if (t === 'object') {
      for (const r of s.required || []) if (!(r in v)) fail(path, `missing required property ${r}`);
      const props = s.properties || {};
      for (const [k, val] of Object.entries(v)) {
        const p = path ? `${path}.${k}` : k;
        if (props[k]) walk(val, props[k], p);
        else if (s.additionalProperties === false) fail(p, 'additional property not allowed');
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(val, s.additionalProperties, p);
      }
    }
  }
  walk(value, schema, '');
  return errors;
}

module.exports = { validate };
