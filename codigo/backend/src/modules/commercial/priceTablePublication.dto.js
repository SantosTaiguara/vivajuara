'use strict';
/* PublishPriceTableRequest (command DTO) and PriceTablePublicationDto.
   Request: { version, id?, name?, pricePerM2?, lotPrices?: [{ lotId, price | pricePerM2 }], validFrom?, validUntil?,
              downPaymentDefault?, sourceId?, changeReason? }
   - pricePerM2 alone: every lot priced as areaM2 × pricePerM2 (rounded to cents, the frontend rule);
   - lotPrices alone: every lot of the development must be listed;  both: lotPrices override the table price.
   Structural validation here (400 VALIDATION_ERROR); cross-entity rules in the service (422 INVALID_PRICE_TABLE).
   Geometry/area keys are refused anywhere in the body (422 INVALID_PRICE_TABLE, reason immutable_field): a price
   table never changes geometry or area. */
const { E } = require('../../shared/http/errors');
const { issue, LOT_ID_RE, PRICE_TABLE_ID_RE } = require('../../shared/validation');

const MAX_PRICE_PER_M2 = 1e6;
const MAX_PRICE = 1e11;
const MAX_LOT_PRICES = 10000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const IMMUTABLE = new Set(['areaM2', 'area', 'a', 'geometry', 'polygon', 'centroid', 'bounds', 'frontM', 'rearM', 'averageDepthM', 'depthM', 'perimeterM', 'latitude', 'longitude', 'coordinates']);
const TOP_FIELDS = ['version', 'id', 'name', 'pricePerM2', 'lotPrices', 'validFrom', 'validUntil', 'downPaymentDefault', 'sourceId', 'changeReason'];
const ITEM_FIELDS = ['lotId', 'price', 'pricePerM2'];

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const cents = v => Math.round(v * 100) / 100 === v;
const validDate = v => DATE_RE.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

/** positive, finite, at most 2 decimals, below max */
function money(issues, field, v, max) {
  if (typeof v !== 'number') { issues.push(issue(field, 'type', { expected: 'number' })); return false; }
  if (!Number.isFinite(v)) { issues.push(issue(field, 'not_finite')); return false; }
  if (!(v > 0)) { issues.push(issue(field, 'not_positive', { min: 0, exclusive: true })); return false; }
  if (v > max) { issues.push(issue(field, 'max', { max })); return false; }
  if (!cents(v)) { issues.push(issue(field, 'max_2_decimals')); return false; }
  return true;
}

function validatePublishPriceTableRequest(body) {
  if (!isObj(body)) throw E.badRequest('Corpo deve ser um objeto JSON', [issue('(body)', 'type', { expected: 'object' })]);
  // geometry/area can never be changed through a price table (checked before anything else)
  const immutable = Object.keys(body).filter(k => IMMUTABLE.has(k)).map(k => issue(k, 'immutable_field'));
  if (Array.isArray(body.lotPrices)) body.lotPrices.forEach((x, i) => { if (isObj(x)) for (const k of Object.keys(x)) if (IMMUTABLE.has(k)) immutable.push(issue(`lotPrices[${i}].${k}`, 'immutable_field')); });
  if (immutable.length) throw E.unprocessable('INVALID_PRICE_TABLE', 'Tabela de preço não altera geometria nem área dos lotes', immutable.slice(0, 50));

  const issues = [];
  for (const k of Object.keys(body)) if (!TOP_FIELDS.includes(k)) issues.push(issue(k, 'unknown_field'));
  const out = { version: null, id: null, name: null, pricePerM2: null, lotPrices: null, validFrom: null, validUntil: null, downPaymentDefault: null, sourceId: null, changeReason: null };
  const str = (k, { required = false, nullable = true, re = null, maxLength = null } = {}) => {
    const v = body[k];
    if (v === undefined) { if (required) issues.push(issue(k, 'required')); return; }
    if (v === null) { if (!nullable || required) issues.push(issue(k, 'not_nullable')); return; }
    if (typeof v !== 'string') { issues.push(issue(k, 'type', { expected: 'string' })); return; }
    if (maxLength != null && v.length > maxLength) { issues.push(issue(k, 'maxLength', { maxLength })); return; }
    if (re && !re.test(v)) { issues.push(issue(k, 'format', { expected: re.source })); return; }
    out[k] = v;
  };
  str('version', { required: true, re: PRICE_TABLE_ID_RE });
  str('id', { re: PRICE_TABLE_ID_RE });
  str('name', { maxLength: 120 });
  str('sourceId', { re: SOURCE_ID_RE });
  str('changeReason', { maxLength: 500 });
  for (const k of ['validFrom', 'validUntil']) {
    const v = body[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !validDate(v)) { issues.push(issue(k, 'format', { expected: 'YYYY-MM-DD' })); continue; }
    out[k] = v;
  }
  if (body.pricePerM2 !== undefined && body.pricePerM2 !== null && money(issues, 'pricePerM2', body.pricePerM2, MAX_PRICE_PER_M2)) out.pricePerM2 = body.pricePerM2;
  if (body.downPaymentDefault !== undefined && body.downPaymentDefault !== null) {
    const v = body.downPaymentDefault;
    if (typeof v !== 'number' || !Number.isFinite(v)) issues.push(issue('downPaymentDefault', 'type', { expected: 'number' }));
    else if (v < 0 || v > 1) issues.push(issue('downPaymentDefault', 'range', { min: 0, max: 1 }));
    else if (Math.round(v * 10000) / 10000 !== v) issues.push(issue('downPaymentDefault', 'max_4_decimals'));
    else out.downPaymentDefault = v;
  }
  if (body.lotPrices !== undefined && body.lotPrices !== null) {
    const list = body.lotPrices;
    if (!Array.isArray(list)) issues.push(issue('lotPrices', 'type', { expected: 'array' }));
    else if (!list.length) issues.push(issue('lotPrices', 'min_items', { minItems: 1 }));
    else if (list.length > MAX_LOT_PRICES) issues.push(issue('lotPrices', 'max_items', { maxItems: MAX_LOT_PRICES }));
    else {
      const items = [];
      list.forEach((x, i) => {
        const f = `lotPrices[${i}]`;
        if (!isObj(x)) { issues.push(issue(f, 'type', { expected: 'object' })); return; }
        for (const k of Object.keys(x)) if (!ITEM_FIELDS.includes(k)) issues.push(issue(`${f}.${k}`, 'unknown_field'));
        if (typeof x.lotId !== 'string' || !LOT_ID_RE.test(x.lotId)) { issues.push(issue(`${f}.lotId`, x.lotId === undefined ? 'required' : 'format', { expected: 'VJ-QB-L0079' })); return; }
        const hasPrice = own(x, 'price') && x.price !== null, hasPpm = own(x, 'pricePerM2') && x.pricePerM2 !== null;
        if (hasPrice === hasPpm) { issues.push(issue(f, 'exactly_one_of', { fields: ['price', 'pricePerM2'] })); return; }
        if (hasPrice ? money(issues, `${f}.price`, x.price, MAX_PRICE) : money(issues, `${f}.pricePerM2`, x.pricePerM2, MAX_PRICE_PER_M2))
          items.push({ lotId: x.lotId, price: hasPrice ? x.price : null, pricePerM2: hasPpm ? x.pricePerM2 : null, index: i });
      });
      out.lotPrices = items;
    }
  }
  if (body.pricePerM2 == null && body.lotPrices == null) issues.push(issue('pricePerM2', 'required', { alternative: 'lotPrices' }));
  if (issues.length) throw E.badRequest('Requisição inválida', issues.slice(0, 100));
  return out;
}

module.exports = { validatePublishPriceTableRequest, IMMUTABLE, MAX_PRICE_PER_M2, MAX_PRICE, MAX_LOT_PRICES, TOP_FIELDS };
