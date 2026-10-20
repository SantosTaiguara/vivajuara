'use strict';
/* Server-side input validation. The frontend validates for UX; the backend is the authority.
   Every issue is { field, reason, ... } (`issue` is kept as an alias of reason for v1 clients). */
const { E } = require('../http/errors');

const DEVELOPMENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOT_ID_RE = /^[A-Z0-9]+-Q[A-Z0-9]+-L\d{4}$/;
const PRICE_TABLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

const issue = (field, reason, extra = {}) => ({ field, reason, issue: reason, ...extra });
const echo = v => (typeof v === 'string' && v.length > 64 ? v.slice(0, 64) + '…' : v);

function developmentId(v) {
  if (typeof v !== 'string' || !DEVELOPMENT_ID_RE.test(v)) throw E.badRequest('Identificador de empreendimento inválido', [issue('developmentId', 'format', { expected: DEVELOPMENT_ID_RE.source })]);
  return v;
}
function lotId(v, field = 'lotId') {
  if (typeof v !== 'string' || !LOT_ID_RE.test(v)) throw E.badRequest('Identificador de lote inválido', [issue(field, 'format', { expected: 'VJ-QB-L0079' })]);
  return v;
}
function priceTableId(v) {
  if (typeof v !== 'string' || !PRICE_TABLE_ID_RE.test(v)) throw E.badRequest('Identificador de tabela de preço inválido', [issue('priceTableId', 'format', { expected: PRICE_TABLE_ID_RE.source })]);
  return v;
}

/** Rejects unknown query parameters so typos are visible (allowlist per route). */
function queryAllowlist(query, allowed) {
  const bad = [...query.keys()].filter(k => !allowed.includes(k));
  if (bad.length) throw E.badRequest('Parâmetros de consulta não suportados', [...new Set(bad)].map(k => issue(k, 'unknown', { allowed })));
}

/**
 * parseQuery(query, spec) — typed query parameters of list endpoints (filters, sorting, pagination).
 * spec: { name: { type: 'int'|'number'|'boolean'|'enum'|'enumList'|'string', enum, min, max, maxItems, pattern, maxLength, default } }
 * Unknown parameters → 400 VALIDATION_ERROR (allowlist). Value problems → INVALID_FILTER:
 *   400 when malformed (type, format, repeated, empty), 422 when well formed but invalid (enum, range, min > max).
 * `ranges` = [[minName, maxName], ...] checked after parsing (min > max → 422 range_inverted).
 */
function parseQuery(query, spec, { ranges = [] } = {}) {
  queryAllowlist(query, Object.keys(spec));
  const malformed = [], invalid = [], out = {};
  for (const [name, s] of Object.entries(spec)) {
    const all = query.getAll(name);
    if (!all.length) { out[name] = s.default === undefined ? null : s.default; continue; }
    if (all.length > 1) { malformed.push(issue(name, 'repeated', { expected: s.type === 'enumList' ? 'lista separada por vírgula' : 'um único valor' })); continue; }
    const raw = all[0].trim();
    if (!raw) { malformed.push(issue(name, 'empty')); continue; }
    if (s.maxLength != null && raw.length > s.maxLength) { malformed.push(issue(name, 'too_long', { maxLength: s.maxLength })); continue; }
    let v;
    if (s.type === 'int' || s.type === 'number') {
      if (!/^-?\d+(\.\d+)?$/.test(raw) || (s.type === 'int' && raw.includes('.'))) { malformed.push(issue(name, 'invalid_type', { expected: s.type === 'int' ? 'integer' : 'number', value: echo(raw) })); continue; }
      v = Number(raw);
      if (!Number.isFinite(v)) { malformed.push(issue(name, 'invalid_type', { expected: 'number', value: echo(raw) })); continue; }
      if (s.min != null && v < s.min) { invalid.push(issue(name, 'below_min', { min: s.min, value: v })); continue; }
      if (s.max != null && v > s.max) { invalid.push(issue(name, 'above_max', { max: s.max, value: v })); continue; }
    } else if (s.type === 'boolean') {
      if (raw !== 'true' && raw !== 'false') { malformed.push(issue(name, 'invalid_type', { expected: 'true | false', value: echo(raw) })); continue; }
      v = raw === 'true';
    } else if (s.type === 'enum' || s.type === 'enumList') {
      const items = s.type === 'enumList' ? raw.split(',').map(x => x.trim()) : [raw];
      if (items.some(x => !x)) { malformed.push(issue(name, 'empty_item')); continue; }
      if (s.maxItems != null && items.length > s.maxItems) { invalid.push(issue(name, 'too_many_items', { maxItems: s.maxItems })); continue; }
      const bad = items.filter(x => !s.enum.includes(x));
      if (bad.length) { invalid.push(issue(name, 'invalid_enum', { value: bad.map(echo), allowed: s.enum })); continue; }
      v = s.type === 'enumList' ? [...new Set(items)] : items[0];
    } else {
      if (s.pattern && !s.pattern.test(raw)) { malformed.push(issue(name, 'invalid_format', { value: echo(raw) })); continue; }
      v = raw;
    }
    out[name] = v;
  }
  for (const [lo, hi] of ranges) if (out[lo] != null && out[hi] != null && out[lo] > out[hi]) invalid.push(issue(lo, 'range_inverted', { min: out[lo], max: out[hi], pairedWith: hi }));
  if (malformed.length) throw E.invalidFilter(400, 'Parâmetros de consulta malformados', malformed);
  if (invalid.length) throw E.invalidFilter(422, 'Parâmetros de consulta inválidos', invalid);
  return out;
}

/** Command flag in the query string (?dryRun=true): only "true" / "false", once; other parameters are unknown (400 VALIDATION_ERROR). */
function booleanFlag(query, name) {
  queryAllowlist(query, [name]);
  const all = query.getAll(name);
  if (!all.length) return false;
  if (all.length > 1 || (all[0] !== 'true' && all[0] !== 'false')) throw E.badRequest('Parâmetro de consulta inválido', [issue(name, 'type', { expected: 'true | false' })]);
  return all[0] === 'true';
}

/**
 * validateObject(body, schema) — schema: { field: { type, required, nullable, enum, min, max, maxLength, pattern, format } }.
 * Unknown fields are rejected (mass-assignment protection). Returns a clean copy.
 */
function validateObject(body, schema) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw E.badRequest('Corpo deve ser um objeto JSON', [issue('(body)', 'type', { expected: 'object' })]);
  const issues = [];
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  for (const k of Object.keys(body)) if (!own(schema, k)) issues.push(issue(k, 'unknown_field'));
  const out = {};
  for (const [k, s] of Object.entries(schema)) {
    const v = body[k];
    if (v === undefined) { if (s.required) issues.push(issue(k, 'required')); continue; }
    if (v === null) { if (!s.nullable) issues.push(issue(k, 'not_nullable')); else out[k] = null; continue; }
    if (s.type === 'integer') { if (!Number.isInteger(v)) { issues.push(issue(k, 'type', { expected: 'integer' })); continue; } }
    else if (s.type === 'string') { if (typeof v !== 'string') { issues.push(issue(k, 'type', { expected: 'string' })); continue; } }
    else if (s.type === 'array') {
      if (!Array.isArray(v)) { issues.push(issue(k, 'type', { expected: 'array' })); continue; }
      if (s.minItems != null && v.length < s.minItems) { issues.push(issue(k, 'min_items', { minItems: s.minItems })); continue; }
      if (s.maxItems != null && v.length > s.maxItems) { issues.push(issue(k, 'max_items', { maxItems: s.maxItems })); continue; }
      if (s.items && s.items.type === 'string') {
        const bad = v.map((x, i) => [x, i]).filter(([x]) => typeof x !== 'string' || (s.items.pattern && !s.items.pattern.test(x)));
        if (bad.length) { issues.push(issue(k, 'invalid_items', { indexes: bad.slice(0, 10).map(([, i]) => i), expected: s.items.example || 'string' })); continue; }
      }
      out[k] = v; continue;
    }
    if (s.enum && !s.enum.includes(v)) { issues.push(issue(k, 'enum', { allowed: s.enum })); continue; }
    if (s.min != null && v < s.min) { issues.push(issue(k, 'min', { min: s.min })); continue; }
    if (s.max != null && v > s.max) { issues.push(issue(k, 'max', { max: s.max })); continue; }
    if (s.maxLength != null && v.length > s.maxLength) { issues.push(issue(k, 'maxLength', { maxLength: s.maxLength })); continue; }
    if (s.pattern && !s.pattern.test(v)) { issues.push(issue(k, 'format')); continue; }
    if (s.format === 'date-time' && (!ISO_DATETIME_RE.test(v) || Number.isNaN(Date.parse(v)))) { issues.push(issue(k, 'format', { expected: 'ISO 8601 date-time' })); continue; }
    out[k] = v;
  }
  if (issues.length) throw E.badRequest('Requisição inválida', issues);
  return out;
}

module.exports = { developmentId, lotId, priceTableId, queryAllowlist, parseQuery, booleanFlag, validateObject, issue, LOT_ID_RE, DEVELOPMENT_ID_RE, PRICE_TABLE_ID_RE };
