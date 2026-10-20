'use strict';
// Domain layer: enums, legacy normalization, LotFactory invariants, serialization, validation errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { load, DATA } = require('./harness.js');

const RAW = JSON.parse(fs.readFileSync(path.join(DATA, 'lots.json'), 'utf8'));
const plain = x => JSON.parse(JSON.stringify(x)); // vm-realm objects → host objects for deepStrictEqual
const codes = list => plain(list).map(e => e.code);

let App, repo, lots;
test.before(async () => {
  App = load();
  repo = App.repos.LotRepository('viva-juara');
  lots = await repo.load();
});
const ctx = () => ({ developmentId: 'viva-juara', code: 'VJ', analysisVersion: '2026-10-06' });
const rawOf = code => plain(RAW.find(r => r.id === code));
/** a mutable deep copy of a valid canonical lot */
const validLot = (code = 'B79') => plain(repo.getLotByCode(code));

// ------------------------------------------------------------------ enums
test('enums: every vocabulary is frozen and value === key', () => {
  const E = App.enums;
  assert.ok(Object.isFrozen(E));
  for (const [name, voc] of Object.entries(E)) {
    assert.ok(Object.isFrozen(voc), `${name} frozen`);
    if (Array.isArray(voc)) continue;
    for (const [k, v] of Object.entries(voc)) assert.equal(v, k, `${name}.${k}`);
  }
});

test('enums: order arrays are consistent with their vocabularies', () => {
  const E = App.enums;
  assert.deepEqual([...E.AVAILABILITY_ORDER], Object.keys(E.AvailabilityStatus));
  assert.deepEqual([...E.CLASS_ORDER], Object.keys(E.LotClass).filter(k => k !== 'UNKNOWN'));
  assert.deepEqual([...E.LEVEL_ORDER], Object.keys(E.Level).filter(k => k !== 'UNKNOWN'));
  assert.deepEqual([...E.SEVERITY_ORDER].sort(), Object.keys(E.AlertSeverity).sort());
  assert.deepEqual(Object.keys(E.Freshness), ['FRESH', 'STALE', 'EXPIRED', 'UNKNOWN']);
  assert.deepEqual(Object.keys(E.DataSource), ['REMOTE', 'CACHE', 'MEMORY', 'BUNDLED']);
  // UNKNOWN exists for availability and is never AVAILABLE
  assert.ok(E.AvailabilityStatus.UNKNOWN);
  assert.notEqual(E.AvailabilityStatus.UNKNOWN, E.AvailabilityStatus.AVAILABLE);
});

test('enums: every enum referenced by the Field Registry exists and has an i18n label group', () => {
  for (const f of App.model.FIELDS) {
    if (f.type === 'enum') assert.ok(f.enum, `${f.key} declares its enum`);
    if (f.enum) {
      assert.ok(App.enums[f.enum], `${f.key} → ${f.enum}`);
      const group = App.i18n.L[f.enum];
      assert.ok(group, `i18n group ${f.enum}`);
      for (const code of Object.keys(App.enums[f.enum])) assert.equal(typeof group[code], 'string', `${f.enum}.${code} has a label`);
    }
  }
});

// ------------------------------------------------------------------ legacy normalization
test('normalize B79: canonical mapping of the legacy record', () => {
  const n = App.legacy.normalize(rawOf('B79'), ctx());
  const d = n.data;
  assert.deepEqual(plain(n.warnings), []);
  assert.deepEqual(plain(n.unmapped), []);
  assert.equal(d.identity.id, 'VJ-QB-L0079');
  assert.equal(d.identity.code, 'B79');
  assert.equal(d.identity.blockId, 'B');
  assert.equal(d.identity.lotNumber, 79);
  assert.equal(d.identity.displayCode, 'QB L79');
  assert.equal(d.geometry.areaM2, 291.78);
  assert.equal(d.geometry.shape, 'RECTANGULAR');
  assert.equal(d.geometry.isCorner, false);
  assert.equal(d.geometry.cornerType, 'NONE');
  assert.equal(d.geometry.frontCount, 1);
  assert.equal(d.environmental.orientationFront, 'SW'); // SO → SW
  assert.equal(d.environmental.orientationRear, 'NE');
  assert.equal(d.environmental.orientationLeft, 'NW'); // "NO / SE"
  assert.equal(d.environmental.orientationRight, 'SE');
  assert.deepEqual(plain(d.environmental.morningSun), ['BACK', 'SIDE']);
  assert.deepEqual(plain(d.environmental.afternoonSun), ['FRONT', 'SIDE']);
  assert.equal(d.environmental.northSunSide, 'BACK');
  assert.equal(d.environmental.noiseLevel, 'VERY_LOW');
  assert.deepEqual(plain(d.environmental.noiseSources), []);
  assert.equal(d.environmental.privacyLevel, 'VERY_HIGH');
  assert.equal(d.environmental.quietScore, 10);
  assert.equal(d.environmental.ventilation, null); // nt.vent never becomes a note
  assert.equal(d.construction.topography, null);
  assert.equal(d.construction.constructivePotential, null);
  assert.equal(d.surroundings.rearNeighborType, 'EXTERNAL_GREEN');
  assert.equal(d.surroundings.hasGreenRear, true);
  assert.equal(d.surroundings.rearCondition, 'FENCE');
  assert.equal(d.surroundings.viewType, 'GREEN');
  assert.equal(d.surroundings.viewPermanence, 'NOT_GUARANTEED');
  assert.equal(d.location.perimeterPosition, 'REAR');
  assert.equal(d.surroundings.sewageStationNearby, false); // deeeb 407 m
  assert.equal(d.mobility.nearMainAccess, false); // rport 637 m
  assert.equal(d.intelligence.class, 'A_PLUS');
  assert.deepEqual(plain(d.intelligence.scores), { housing: 91, investment: 93, family: 77, premium: 90, overall: 89 });
  assert.deepEqual(plain(d.intelligence.idealProfiles), ['INVESTOR', 'QUIET_LIVING']);
  assert.equal(d.intelligence.alerts.length, 1);
  assert.equal(d.intelligence.alerts[0].type, 'BUILDING_RESTRICTION');
  assert.equal(d.intelligence.alerts[0].severity, 'IMPORTANT');
  assert.equal(d.construction.nonBuildableRearToConfirm, true);
  assert.equal(d.availability.status, 'UNKNOWN');
  assert.equal(d.provenance['availability.status'], undefined);
  assert.equal(d.provenance['surroundings.rearNeighborType'].sourceId, 'aerial-v1');
  assert.equal(d.provenance['surroundings.rearNeighborType'].confidence, 'LOW');
});

test('normalize: multi-word profiles ("Idosos / mobilidade") and several alerts', () => {
  const d = App.legacy.normalize(rawOf('A1'), ctx()).data;
  assert.ok(d.intelligence.idealProfiles.includes('ELDERLY_MOBILITY'));
  assert.equal(d.intelligence.idealProfiles.filter(p => p === 'ELDERLY_MOBILITY').length, 1);
  const types = d.intelligence.alerts.map(a => a.type);
  assert.deepEqual(types.slice().sort(), ['AFTERNOON_SUN', 'AVENUE', 'NOISE']);
  // sorted by severity: IMPORTANT before ATTENTION before INFO
  const sev = App.enums.SEVERITY_ORDER;
  const idx = d.intelligence.alerts.map(a => sev.indexOf(a.severity));
  assert.deepEqual(idx, idx.slice().sort((a, b) => a - b));
  // noise sources parsed with distances
  const src = plain(d.environmental.noiseSources);
  assert.ok(src.some(s => s.detail === 'AVENUE' && s.distanceM === 50));
  assert.ok(src.some(s => s.detail === 'GATE' && s.distanceM === 25));
});

test('normalize: corner lots ("Esquina") get shape UNKNOWN with provenance note', () => {
  const raw = RAW.find(r => r.forma === 'Esquina');
  const d = App.legacy.normalize(plain(raw), ctx()).data;
  assert.equal(d.geometry.shape, 'UNKNOWN');
  assert.equal(d.provenance['geometry.shape'].status, 'UNKNOWN');
  if (raw.pos === 'Esquina') { assert.equal(d.geometry.isCorner, true); assert.equal(d.geometry.cornerType, 'UNKNOWN'); }
});

test('normalize: Brazilian number formats, bad numbers, bad enums and unmapped keys produce warnings, never guesses', () => {
  const raw = rawOf('B79');
  raw.a = '291,78';
  raw.dport = '1.234,5';
  raw.dclube = 'abc';
  raw.fs = 'XX';
  raw.ruido = 'Ensurdecedor';
  raw.extraLegacy = 1;
  raw.nt = { ...raw.nt, sil: 12, zzz: 3 };
  raw.sm = 150;
  raw.mata = 'Talvez';
  const n = App.legacy.normalize(raw, ctx()), d = n.data, w = plain(n.warnings);
  assert.equal(d.geometry.areaM2, 291.78);
  assert.equal(d.location.distanceToGateLinearM, 1234.5);
  assert.equal(d.location.distanceToClubLinearM, null);
  assert.ok(w.some(x => x.code === 'INVALID_NUMBER' && x.fieldKey === 'location.distanceToClubLinearM'));
  assert.equal(d.environmental.orientationFront, null);
  assert.ok(w.some(x => x.code === 'UNKNOWN_ENUM' && x.fieldKey === 'environmental.orientationFront'));
  assert.equal(d.environmental.noiseLevel, null);
  assert.ok(w.some(x => x.code === 'UNKNOWN_ENUM' && x.fieldKey === 'environmental.noiseLevel'));
  assert.deepEqual(plain(n.unmapped), ['extraLegacy']);
  assert.ok(w.some(x => x.code === 'LEGACY_FIELD_UNMAPPED' && /extraLegacy/.test(x.message)));
  assert.ok(w.some(x => x.code === 'LEGACY_FIELD_UNMAPPED' && /nt\.zzz/.test(x.message)));
  assert.equal(d.environmental.quietScore, null);
  assert.ok(w.some(x => x.code === 'INVALID_SCORE' && x.fieldKey === 'environmental.quietScore'));
  assert.equal(d.intelligence.scores.housing, null);
  assert.ok(w.some(x => x.code === 'INVALID_SCORE' && x.fieldKey === 'intelligence.scores.housing'));
  assert.equal(d.surroundings.hasGreenRear, null);
  assert.ok(w.every(x => x.lotId === 'B79'));
});

test('normalize: non-positive area is rejected to null with INVALID_AREA', () => {
  for (const a of [0, -10]) {
    const raw = rawOf('B79'); raw.a = a;
    const n = App.legacy.normalize(raw, ctx());
    assert.equal(n.data.geometry.areaM2, null);
    assert.ok(codes(n.warnings).includes('INVALID_AREA'));
  }
});

test('normalize: id built from development code when the legacy did is missing', () => {
  const raw = rawOf('B79'); delete raw.did;
  assert.equal(App.legacy.normalize(raw, ctx()).data.identity.id, 'VJ-QB-L0079');
  const raw2 = rawOf('A1'); delete raw2.did;
  assert.equal(App.legacy.normalize(raw2, { ...ctx(), code: 'XY' }).data.identity.id, 'XY-QA-L0001');
});

test('normalizeAvailability: legacy codes, flags and conflicts', () => {
  const N = (raw) => { const w = []; const out = App.availability.normalizeAvailability(raw, (code, fieldKey, message) => w.push(code)); return { ...plain(out), w }; };
  assert.equal(N({ st: null }).status, 'UNKNOWN');
  assert.equal(N({ st: '' }).status, 'UNKNOWN');
  assert.equal(N({ st: 'Vendido' }).status, 'SOLD');
  assert.equal(N({ st: 'disponível' }).status, 'AVAILABLE'); // accent and case insensitive
  assert.equal(N({ st: ' RES ' }).status, 'RESERVED');
  assert.equal(N({ st: 'INDISPONIVEL' }).status, 'UNAVAILABLE');
  const unk = N({ st: 'quem sabe' });
  assert.equal(unk.status, 'UNKNOWN'); assert.deepEqual(unk.w, ['UNKNOWN_ENUM']);
  assert.equal(N({ st: null, isSold: true }).status, 'SOLD');
  const conflict = N({ st: 'DISP', isSold: true });
  assert.equal(conflict.status, 'UNKNOWN'); assert.deepEqual(conflict.w, ['CONFLICTED_SOURCE']);
  const twoFlags = N({ isSold: true, isReserved: true });
  assert.equal(twoFlags.status, 'UNKNOWN'); assert.deepEqual(twoFlags.w, ['CONFLICTED_SOURCE']);
  const sold = N({ st: 'VEND', stAt: '2026-10-01T10:00:00Z' });
  assert.equal(sold.sourceId, 'lots.json'); assert.equal(sold.updatedAt, '2026-10-01T10:00:00Z');
  assert.equal(N({ st: null }).sourceId, null);
});

test('normalize: every one of the 498 legacy records normalizes without warnings', () => {
  let warnings = 0;
  for (const r of RAW) warnings += App.legacy.normalize(plain(r), ctx()).warnings.length;
  assert.equal(warnings, 0);
});

// ------------------------------------------------------------------ LotFactory invariants
test('LotFactory: 498 lots, none rejected, no warnings', () => {
  assert.equal(lots.length, 498);
  const rep = repo.getQualityReport();
  assert.equal(rep.totalLots, 498);
  assert.equal(rep.validLots, 498);
  assert.equal(rep.invalidLots, 0);
  assert.equal(rep.warnings, 0);
  assert.deepEqual(plain(rep.unmappedLegacyFields), []);
});

test('LotFactory: identity invariants (id format, code, uniqueness, consistency)', () => {
  const ids = new Set(), cods = new Set();
  for (const l of lots) {
    const { id, code, blockId, lotNumber, developmentId, displayCode } = l.identity;
    assert.match(id, /^VJ-Q[A-Z0-9]+-L\d{4}$/);
    assert.equal(id, `VJ-Q${blockId}-L${String(lotNumber).padStart(4, '0')}`);
    assert.equal(code, `${blockId}${lotNumber}`);
    assert.equal(displayCode, `Q${blockId} L${lotNumber}`);
    assert.equal(developmentId, 'viva-juara');
    assert.ok(Number.isInteger(lotNumber) && lotNumber > 0);
    ids.add(id); cods.add(code);
  }
  assert.equal(ids.size, 498);
  assert.equal(cods.size, 498);
  assert.ok(repo.getLotById('VJ-QB-L0079'));
  assert.equal(repo.getLotByCode('b79').identity.id, 'VJ-QB-L0079');
  assert.equal(repo.resolve('B79'), repo.resolve('VJ-QB-L0079'));
});

test('LotFactory: required (STRICT) fields are present and the lot has exactly the contract keys', () => {
  const D = App.domain;
  for (const l of lots) {
    assert.deepEqual(Object.keys(l).sort(), [...D.TOP].sort());
    for (const k of D.STRICT) assert.ok(App.model.get(l, k) != null, `${l.identity.code} ${k}`);
    assert.ok(l.geometry.polygon.length >= 3);
    assert.equal(l.metadata.schemaVersion, D.SCHEMA_VERSION);
    for (const f of App.model.getStoredFields()) assert.notEqual(App.model.get(l, f.key), undefined, `${l.identity.code} ${f.key}`);
  }
});

test('LotFactory: lots are deeply frozen (immutable)', () => {
  const l = repo.getLotByCode('B79');
  assert.ok(Object.isFrozen(l));
  for (const k of App.domain.TOP) assert.ok(Object.isFrozen(l[k]), k);
  assert.ok(Object.isFrozen(l.geometry.polygon));
  assert.ok(Object.isFrozen(l.geometry.polygon[0]));
  assert.ok(Object.isFrozen(l.intelligence.alerts[0]));
  const isTypeError = e => e && e.name === 'TypeError';
  assert.throws(() => { l.geometry.areaM2 = 1; }, isTypeError);
  assert.throws(() => { l.identity.id = 'X'; }, isTypeError);
  assert.throws(() => { l.intelligence.alerts.push({}); }, isTypeError);
  assert.equal(l.geometry.areaM2, 291.78);
  assert.ok(Object.isFrozen(repo.lotsSync()));
});

test('LotFactory.create: success result shape', () => {
  const r = App.domain.LotFactory.create(validLot());
  assert.equal(r.success, true);
  assert.deepEqual(plain(r.errors), []);
  assert.ok(Object.isFrozen(r.lot));
});

// ------------------------------------------------------------------ serialization
test('serialization: deterministic (sorted keys) and stable round-trip for all 498 lots', () => {
  const D = App.domain;
  for (const l of lots) {
    const s = D.serializeLot(l);
    const back = D.deserializeLot(s);
    assert.equal(back.success, true, l.identity.code);
    assert.equal(D.serializeLot(back.lot), s);
    assert.deepEqual(plain(back.lot), plain(l));
  }
  const s = D.serializeLot(repo.getLotByCode('B79'));
  const top = Object.keys(JSON.parse(s));
  assert.deepEqual(top, top.slice().sort());
  // the same lot with keys inserted in another order serializes identically
  const shuffled = Object.fromEntries(Object.entries(validLot()).reverse());
  assert.equal(D.serializeLot(shuffled), s);
});

test('rehydrate: invalid JSON and schema mismatch are refused', () => {
  const D = App.domain;
  const bad = D.LotFactory.rehydrate('{not json');
  assert.equal(bad.success, false); assert.deepEqual(codes(bad.errors), ['INVALID_TYPE']);
  const old = validLot(); old.metadata.schemaVersion = '0.9';
  const r = D.LotFactory.rehydrate(JSON.stringify(old));
  assert.equal(r.success, false); assert.deepEqual(codes(r.errors), ['SCHEMA_MISMATCH']);
  const noMeta = validLot(); delete noMeta.metadata;
  assert.deepEqual(codes(D.LotFactory.rehydrate(noMeta).errors), ['SCHEMA_MISMATCH']);
  // rehydrate never trusts stored data: a broken stored lot is validated again
  const broken = validLot(); broken.geometry.areaM2 = -1;
  const rb = D.LotFactory.rehydrate(JSON.stringify(broken));
  assert.equal(rb.success, false); assert.ok(codes(rb.errors).includes('INVALID_AREA'));
});

// ------------------------------------------------------------------ validation errors
const CASES = [
  ['identity.id format', d => { d.identity.id = 'B79'; }, 'INVALID_LOT_ID', 'identity.id'],
  ['identity.code null', d => { d.identity.code = null; }, 'MISSING_REQUIRED_FIELD', 'identity.code'],
  ['identity.code missing', d => { delete d.identity.code; }, 'MISSING_REQUIRED_FIELD', 'identity.code'],
  ['lotNumber not integer', d => { d.identity.lotNumber = 1.5; }, 'MISSING_REQUIRED_FIELD', 'identity.lotNumber'],
  ['negative area', d => { d.geometry.areaM2 = -5; }, 'INVALID_AREA', 'geometry.areaM2'],
  ['zero area', d => { d.geometry.areaM2 = 0; }, 'INVALID_AREA', 'geometry.areaM2'],
  ['area not a number', d => { d.geometry.areaM2 = '291'; }, 'INVALID_NUMBER', 'geometry.areaM2'],
  ['area NaN', d => { d.geometry.areaM2 = NaN; }, 'INVALID_NUMBER', 'geometry.areaM2'],
  ['negative distance', d => { d.location.distanceToGateLinearM = -1; }, 'INVALID_NUMBER', 'location.distanceToGateLinearM'],
  ['polygon too short', d => { d.geometry.polygon = [[0, 0], [1, 1]]; }, 'INVALID_POLYGON', 'geometry.polygon'],
  ['polygon null', d => { d.geometry.polygon = null; }, 'INVALID_POLYGON', 'geometry.polygon'],
  ['polygon bad vertex', d => { d.geometry.polygon = [[0, 0], [1, 1], [2, 'x']]; }, 'INVALID_POLYGON', 'geometry.polygon'],
  ['score > 100', d => { d.intelligence.scores.housing = 150; }, 'INVALID_SCORE', 'intelligence.scores.housing'],
  ['note > 10', d => { d.environmental.quietScore = 11; }, 'INVALID_SCORE', 'environmental.quietScore'],
  ['note < 0', d => { d.geometry.usableGeometryScore = -0.1; }, 'INVALID_SCORE', 'geometry.usableGeometryScore'],
  ['negative price', d => { d.commercial.price = -1; }, 'INVALID_PRICE', 'commercial.price'],
  ['unknown enum', d => { d.environmental.noiseLevel = 'LOUD'; }, 'UNKNOWN_ENUM', 'environmental.noiseLevel'],
  ['unknown enum in array', d => { d.environmental.morningSun = ['BACK', 'TOP']; }, 'UNKNOWN_ENUM', 'environmental.morningSun'],
  ['unknown availability', d => { d.availability.status = 'MAYBE'; }, 'UNKNOWN_ENUM', 'availability.status'],
  ['availability null', d => { d.availability.status = null; }, 'MISSING_REQUIRED_FIELD', 'availability.status'],
  ['boolean as string', d => { d.geometry.isCorner = 'no'; }, 'INVALID_TYPE', 'geometry.isCorner'],
  ['string as number', d => { d.identity.code = 79; }, 'INVALID_TYPE', 'identity.code'],
  ['array as string', d => { d.construction.easements = 'none'; }, 'INVALID_TYPE', 'construction.easements'],
  // BUG domain/lot.js:89/93/94 — validateLot calls .forEach on intelligence.alerts/highlights/rankings without checking Array.isArray,
  // so a non-array value throws a TypeError out of LotFactory.create (and createMany/rehydrate) instead of returning { success: false }.
  ['alerts not an array', d => { d.intelligence.alerts = 'none'; }, 'INVALID_TYPE', 'intelligence.alerts', 'BUG domain/lot.js:89 — validateLot throws TypeError on non-array intelligence.alerts instead of returning INVALID_TYPE'],
  ['highlights not an array', d => { d.intelligence.highlights = 'none'; }, 'INVALID_TYPE', 'intelligence.highlights', 'BUG domain/lot.js:93 — validateLot throws TypeError on non-array intelligence.highlights'],
  ['rankings not an array', d => { d.intelligence.rankings = {}; }, 'INVALID_TYPE', 'intelligence.rankings', 'BUG domain/lot.js:94 — validateLot throws TypeError on non-array intelligence.rankings'],
  ['schema version', d => { d.metadata.schemaVersion = '2.0'; }, 'SCHEMA_MISMATCH', 'metadata.schemaVersion'],
  ['provenance of unknown field', d => { d.provenance['geometry.color'] = { status: 'CONFIRMED' }; }, 'INVALID_FIELD_KEY', 'geometry.color'],
  ['provenance bad status', d => { d.provenance['geometry.areaM2'] = { status: 'MAYBE' }; }, 'UNKNOWN_ENUM', 'geometry.areaM2'],
  ['provenance bad confidence', d => { d.provenance['geometry.areaM2'] = { status: 'CONFIRMED', confidence: 'SURE' }; }, 'UNKNOWN_ENUM', 'geometry.areaM2'],
  ['alert bad type', d => { d.intelligence.alerts = [{ type: 'UFO', severity: 'INFO', fieldKey: null }]; }, 'UNKNOWN_ENUM', 'intelligence.alerts'],
  ['alert bad fieldKey', d => { d.intelligence.alerts = [{ type: 'NOISE', severity: 'INFO', fieldKey: 'x.y' }]; }, 'INVALID_FIELD_KEY', 'intelligence.alerts'],
  ['highlight without field', d => { d.intelligence.highlights = [{ type: 'X', fieldKey: 'nope' }]; }, 'INVALID_FIELD_KEY', 'intelligence.highlights'],
  ['ranking invalid', d => { d.intelligence.rankings = [{ type: 'HOUSING', position: 0, total: 1 }]; }, 'UNKNOWN_ENUM', 'intelligence.rankings']
];
for (const [name, mutate, code, fieldKey, todo] of CASES) {
  test(`validation error: ${name} → ${code}`, {}, () => {
    const d = validLot(); mutate(d);
    let r;
    assert.doesNotThrow(() => { r = App.domain.LotFactory.create(d); }, 'LotFactory.create must report errors, never throw');
    assert.equal(r.success, false);
    assert.equal(r.lot, undefined);
    assert.ok(r.errors.some(e => e.code === code && e.fieldKey === fieldKey), JSON.stringify(plain(r.errors)));
    assert.ok(r.errors.every(e => typeof e.message === 'string'));
  });
}

test('validation: empty input', () => {
  for (const v of [null, undefined, 42]) {
    const r = App.domain.LotFactory.create(v);
    assert.equal(r.success, false);
    assert.deepEqual(codes(r.errors), ['MISSING_REQUIRED_FIELD']);
  }
});

test('validation: unknown fields are dropped with EXTRA_FIELD_IGNORED (no silent proliferation)', () => {
  const d = validLot();
  d.uiColor = '#f00'; d.geometry.label = 'x'; d.metadata.selected = true;
  const r = App.domain.LotFactory.create(d);
  assert.equal(r.success, true);
  const w = plain(r.warnings).filter(x => x.code === 'EXTRA_FIELD_IGNORED').map(x => x.fieldKey).sort();
  assert.deepEqual(w, ['geometry.label', 'metadata.selected', 'uiColor']);
  assert.equal(r.lot.uiColor, undefined);
  assert.equal(r.lot.geometry.label, undefined);
  assert.equal(r.lot.metadata.selected, undefined);
});

test('validation: null in a non-nullable optional field is a warning, not an error', () => {
  const d = validLot(); d.location.distanceToGateLinearM = null;
  const r = App.domain.LotFactory.create(d);
  assert.equal(r.success, true);
  assert.ok(r.warnings.some(w => w.code === 'MISSING_OPTIONAL_FIELD' && w.fieldKey === 'location.distanceToGateLinearM'));
  const p = validLot(); p.provenance['geometry.areaM2'] = { status: 'CONFLICTED' };
  assert.ok(App.domain.LotFactory.create(p).warnings.some(w => w.code === 'CONFLICTED_SOURCE'));
});

test('createMany: one bad lot is isolated and duplicates are rejected', () => {
  const a = validLot('B79'), dup = validLot('B79'), bad = validLot('A1'), ok = validLot('A2');
  bad.geometry.areaM2 = -1;
  const r = App.domain.LotFactory.createMany([a, dup, bad, ok]);
  assert.deepEqual(plain(r.lots.map(l => l.identity.code)), ['B79', 'A2']);
  assert.equal(r.rejected.length, 2);
  assert.deepEqual(codes(r.rejected[0].errors), ['DUPLICATE_LOT_ID']);
  assert.ok(codes(r.rejected[1].errors).includes('INVALID_AREA'));
  assert.equal(r.report.totalLots, 4);
  assert.equal(r.report.validLots, 2);
  assert.equal(r.report.invalidLots, 2);
});

// ------------------------------------------------------------------ updates by copy
test('updateLotCommercial: price ↔ pricePerM2 recomputed together, original untouched, geometry unchanged', () => {
  const D = App.domain, l = repo.getLotByCode('B79');
  const r = D.updateLotCommercial(l, { pricePerM2: 1000 });
  assert.equal(r.success, true);
  assert.equal(r.lot.commercial.price, 291780);
  assert.equal(r.lot.commercial.downPaymentDefaultValue, Math.round(291780 * 12) / 100);
  assert.deepEqual(plain(r.lot.geometry), plain(l.geometry));
  assert.equal(l.commercial.pricePerM2, 1196);
  const r2 = D.updateLotCommercial(l, { price: 300000 });
  assert.equal(r2.lot.commercial.pricePerM2, Math.round(300000 / 291.78 * 100) / 100);
  const bad = D.updateLotCommercial(l, { price: -5 });
  assert.equal(bad.success, false);
  assert.ok(codes(bad.errors).includes('INVALID_PRICE'));
});

test('updateLotAvailability / updateLotIntelligence: copy with provenance, identity never changes', () => {
  const D = App.domain, l = repo.getLotByCode('B79');
  const r = D.updateLotAvailability(l, { status: 'RESERVED', updatedAt: '2026-10-07T10:00:00.000Z', sourceId: 'crm' });
  assert.equal(r.success, true);
  assert.equal(r.lot.availability.status, 'RESERVED');
  assert.equal(r.lot.provenance['availability.status'].status, 'CONFIRMED');
  assert.equal(r.lot.provenance['availability.status'].sourceId, 'crm');
  assert.equal(l.availability.status, 'UNKNOWN');
  assert.deepEqual(plain(r.lot.identity), plain(l.identity));
  assert.deepEqual(plain(r.lot.intelligence), plain(l.intelligence));
  const i = D.updateLotIntelligence(l, { class: 'B' });
  assert.equal(i.success, true);
  assert.equal(i.lot.intelligence.class, 'B');
  assert.equal(i.lot.geometry.areaM2, l.geometry.areaM2);
  assert.equal(i.lot.commercial.price, l.commercial.price);
  assert.equal(D.updateLotIntelligence(l, { class: 'Z' }).success, false);
});

test('buildIndex: by id, by code and by block', () => {
  const idx = App.domain.buildIndex(lots);
  assert.equal(idx.byId.size, 498);
  assert.equal(idx.byCode.size, 498);
  const total = [...idx.byBlock.values()].reduce((s, a) => s + a.length, 0);
  assert.equal(total, 498);
  assert.ok(idx.byBlock.get('B').every(l => l.identity.blockId === 'B'));
  assert.deepEqual(plain(repo.getBlocks()), [...idx.byBlock.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })));
});

test('validation: a value without provenance (lot or Field Registry) gets UNKNOWN_PROVENANCE; record metadata follows its anchor', () => {
  const d = validLot(); d.construction.topography = 'FLAT';
  const r = App.domain.LotFactory.create(d);
  assert.equal(r.success, true);
  assert.ok(r.warnings.some(w => w.code === 'UNKNOWN_PROVENANCE' && w.fieldKey === 'construction.topography'));
  const p = validLot(); p.construction.topography = 'FLAT'; p.provenance['construction.topography'] = { status: 'CONFIRMED', sourceId: 'survey' };
  assert.ok(!App.domain.LotFactory.create(p).warnings.some(w => w.code === 'UNKNOWN_PROVENANCE'));
  const a = App.domain.updateLotAvailability(repo.getLotByCode('B79'), { status: 'RESERVED', updatedAt: '2026-10-07T10:00:00.000Z', sourceId: 'crm' });
  assert.ok(!a.warnings.some(w => w.code === 'UNKNOWN_PROVENANCE'), 'updatedAt / sourceId covered by the availability.status provenance');
  const n = validLot(); n.availability.status = 'AVAILABLE';
  assert.ok(App.domain.LotFactory.create(n).warnings.some(w => w.code === 'UNKNOWN_PROVENANCE' && w.fieldKey === 'availability.status'), 'AVAILABLE without a source is flagged');
  assert.equal(repo.getQualityReport().warningsByCode.UNKNOWN_PROVENANCE, undefined, 'published data: every value has provenance');
});
