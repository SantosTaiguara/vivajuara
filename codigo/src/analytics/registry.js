/* analytics/registry.js — topic 45: AnalyticsEventSchemaRegistry.

   One source of truth (plat/config/analytics/events.json, bundled into App.configs.analytics.events) for every
   AnalyticsEventDefinition: name (snake_case, semantic, never a UI element), version (integers, monotonic), category,
   eventClass (PRODUCT ≠ TECHNICAL_TELEMETRY), trigger semantics, typed properties (AnalyticsPropertyDefinition),
   privacy class, consent requirement, producer policy + allowed sources, dedup / sampling policy, priority, purposes
   (the topic-44 metrics that consume it), destinations and lifecycle status (DRAFT → VALIDATED → PUBLISHED → DEPRECATED).

   Also: the LegacyTrackingInventory (every App.analytics.track name used in the code base, with its migration action
   and a declarative payload transformer), the contract checks CI runs (contractErrors), the payload validator the
   client uses, and generators for TypeScript types and catalog docs — so client, docs and tests never diverge.
   Pure module: no storage, no network, no DOM. */
App.eventTracking = App.eventTracking || {};
App.eventTracking.registry = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const Category = E('NAVIGATION', 'MAP', 'FILTERS', 'RECOMMENDATION', 'COMPARISON', 'FAVORITES', 'CUSTOMER_JOURNEY', 'PRESENTATION', 'SHARE', 'FINANCIAL', 'SEARCH', 'LAYOUT', 'TECHNICAL');
  const EventClass = E('PRODUCT', 'TECHNICAL_TELEMETRY');
  const PropertyType = E('STRING', 'NUMBER', 'BOOLEAN', 'ENUM', 'ID', 'TIMESTAMP', 'ARRAY');
  const PrivacyClass = E('NONE', 'PSEUDONYMOUS', 'LIMITED_PII', 'RESTRICTED');
  const Consent = E('ANALYTICS', 'NOT_REQUIRED_BY_POLICY');
  const Producer = E('CLIENT', 'SERVER', 'DOMAIN_BRIDGE', 'HYBRID');
  const Source = E('WEB_CLIENT', 'SERVER', 'DOMAIN_BRIDGE', 'SHARE_RUNTIME', 'PRESENTATION_RUNTIME', 'INTEGRATION');
  const Priority = E('CRITICAL', 'HIGH', 'NORMAL', 'LOW');
  const Dedup = E('NONE', 'EVENT_ID', 'IDEMPOTENCY_KEY', 'SESSION_ONCE', 'ENTITY_WINDOW', 'ON_CHANGE');
  const Sampling = E('NONE', 'RANDOM', 'DETERMINISTIC');
  const Status = E('DRAFT', 'VALIDATED', 'PUBLISHED', 'DEPRECATED');
  const Migration = E('KEEP_CANONICAL', 'MAP', 'RENAME', 'MERGE', 'REMOVE', 'REVIEW');
  const Severity = E('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  /** issue codes shared with the client's quarantine (topic 45 §83) */
  const Issue = E('UNKNOWN_EVENT', 'UNSUPPORTED_VERSION', 'NOT_PUBLISHED', 'PRODUCER_NOT_ALLOWED', 'SCHEMA_INVALID', 'MISSING_REQUIRED', 'INVALID_TYPE', 'INVALID_ENUM', 'INVALID_NULL',
    'OUT_OF_RANGE', 'TOO_LONG', 'TOO_MANY_ITEMS', 'UNKNOWN_PROPERTY', 'RESERVED_CONTEXT_KEY', 'PRIVACY_VIOLATION', 'PAYLOAD_TOO_LARGE', 'INVALID_TIMESTAMP', 'TENANT_MISMATCH', 'TENANT_UNRESOLVED');
  const NAME_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
  const CODE_RE = /^[A-Za-z0-9_.:\-]{1,64}$/;
  const BANNED_NAMES = ['click', 'action', 'event1', 'button_clicked', 'interaction', 'map_pan', 'map_zoom', 'mousemove', 'hover'];
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const cfg = () => (App.configs && App.configs.analytics) || {};

  /** AnalyticsPropertyDefinition from the catalog's shorthand */
  function normalizeProperty(name, p = {}) {
    return { name, type: p.type, required: !!p.required, enumValues: p.enumValues ? p.enumValues.slice() : undefined, piiClass: p.piiClass || 'NONE', maxLength: p.maxLength, allowNull: !!p.allowNull,
      description: p.description || '', format: p.format, items: p.items, maxItems: p.maxItems, min: p.min, max: p.max };
  }
  /** AnalyticsEventDefinition = catalog entry + defaults */
  function normalizeEvent(raw, defaults = {}) {
    const d = { ...clone(defaults), ...clone(raw) };
    const props = Object.entries(raw.properties || {}).map(([k, v]) => normalizeProperty(k, v));
    return deepFreeze({ name: d.name, version: d.version, category: d.category, eventClass: d.eventClass, description: d.description, owner: d.owner, triggerSemantics: d.trigger || d.triggerSemantics,
      entityType: d.entityType || null, requiredProperties: props.filter(p => p.required), optionalProperties: props.filter(p => !p.required), properties: Object.fromEntries(props.map(p => [p.name, p])),
      privacyClass: d.privacyClass, consentRequirement: d.consent, producerPolicyRef: d.producer, sources: d.sources, deduplication: d.dedup, sampling: d.sampling, priority: d.priority,
      purposes: d.purposes || [], destinations: d.destinations, status: d.status, key: `${d.name}@${d.version}` });
  }

  /** build(catalog?) → registry (defaults to the bundled config) */
  function build(catalog = cfg().events || { events: [], legacy: [] }) {
    const defs = (catalog.events || []).map(e => normalizeEvent(e, catalog.defaults));
    const byKey = new Map(defs.map(d => [d.key, d])), byName = new Map();
    for (const d of defs) { const a = byName.get(d.name) || []; a.push(d); a.sort((x, y) => x.version - y.version); byName.set(d.name, a); }
    const legacy = deepFreeze(clone(catalog.legacy || []));
    const legacyByName = new Map(legacy.map(l => [l.legacyName, l]));
    const get = (name, version) => version == null ? latest(name) : byKey.get(`${name}@${version}`) || null;
    /** latest PUBLISHED version (producers in production only emit PUBLISHED) */
    function latest(name) { const a = byName.get(name) || []; const pub = a.filter(d => d.status === Status.PUBLISHED); return (pub.length ? pub : a)[(pub.length ? pub : a).length - 1] || null; }
    const has = name => byName.has(name);
    /** resolveName(name, { legacy }) → { def, legacy } — legacy facade names go through the inventory first */
    function resolveName(name, o = {}) {
      if (o.legacy && legacyByName.has(name)) { const l = legacyByName.get(name); return { def: latest(l.canonicalName), legacy: l }; }
      return { def: latest(name), legacy: null };
    }
    const isRegistered = name => has(name) || legacyByName.has(name);

    // ------------------------------------------------------------------ contract checks (CI, topic 45 §109)
    function contractErrors(o = {}) {
      const errs = [], E2 = (code, ref, message) => errs.push({ code, ref, message });
      const pol = o.policy || cfg().policy || {}, privacy = App.eventTracking.privacy;
      const dests = new Set(Object.keys((pol.destinations) || {}));
      const seen = new Set();
      for (const d of defs) {
        if (seen.has(d.key)) E2('DUPLICATE_EVENT', d.key, 'nome+versão repetidos'); seen.add(d.key);
        if (!NAME_RE.test(d.name)) E2('BAD_NAME', d.key, 'nome fora de snake_case semântico');
        if (BANNED_NAMES.includes(d.name)) E2('BANNED_NAME', d.key, 'nome genérico/gesto proibido');
        if (!Number.isInteger(d.version) || d.version < 1) E2('BAD_VERSION', d.key, 'versão deve ser inteiro ≥ 1');
        if (!Category[d.category]) E2('BAD_CATEGORY', d.key, d.category);
        if (!EventClass[d.eventClass]) E2('BAD_CLASS', d.key, d.eventClass);
        if (!d.description || !d.triggerSemantics) E2('MISSING_SEMANTICS', d.key, 'descrição e trigger são obrigatórios');
        if (!PrivacyClass[d.privacyClass]) E2('BAD_PRIVACY_CLASS', d.key, d.privacyClass);
        if (['LIMITED_PII', 'RESTRICTED'].includes(d.privacyClass)) E2('PII_EVENT', d.key, 'eventos de produto não carregam PII');
        if (!Consent[d.consentRequirement]) E2('BAD_CONSENT', d.key, d.consentRequirement);
        if (d.eventClass === 'PRODUCT' && d.consentRequirement !== 'ANALYTICS') E2('PRODUCT_WITHOUT_CONSENT', d.key, 'evento de produto depende da política de consentimento');
        if (!Producer[d.producerPolicyRef]) E2('BAD_PRODUCER', d.key, d.producerPolicyRef);
        if (!(d.sources || []).length || d.sources.some(s => !Source[s])) E2('BAD_SOURCES', d.key, String(d.sources));
        if (d.producerPolicyRef === 'SERVER' && d.sources.includes('WEB_CLIENT')) E2('SERVER_EVENT_FROM_CLIENT', d.key, 'fato autoritativo do servidor não pode vir do navegador');
        if (!Priority[d.priority]) E2('BAD_PRIORITY', d.key, d.priority);
        const dd = d.deduplication || {};
        if (!Dedup[dd.mode]) E2('BAD_DEDUP', d.key, dd.mode);
        if (['SESSION_ONCE', 'ENTITY_WINDOW', 'ON_CHANGE'].includes(dd.mode) && !(dd.keyFields || []).length) E2('DEDUP_WITHOUT_KEY', d.key, dd.mode);
        if (dd.mode === 'ENTITY_WINDOW' && !(dd.windowMs > 0)) E2('DEDUP_WITHOUT_WINDOW', d.key, 'windowMs');
        const sm = d.sampling || {};
        if (!Sampling[sm.mode] || !(sm.rate > 0 && sm.rate <= 1)) E2('BAD_SAMPLING', d.key, JSON.stringify(sm));
        if (sm.mode !== 'NONE' && ['CRITICAL', 'HIGH'].includes(d.priority)) E2('SAMPLED_CONVERSION', d.key, 'conversões críticas nunca são amostradas');
        if (!Status[d.status]) E2('BAD_STATUS', d.key, d.status);
        if (!(d.destinations || []).length) E2('NO_DESTINATION', d.key, 'sem destino');
        for (const ds of d.destinations || []) if (dests.size && !dests.has(ds)) E2('UNKNOWN_DESTINATION', d.key, ds);
        if (d.eventClass === 'TECHNICAL_TELEMETRY' && (d.destinations || []).some(x => x !== 'LOCAL_BUFFER')) E2('TELEMETRY_TO_ANALYTICS', d.key, 'telemetria técnica não vai para destinos de produto');
        for (const p of Object.values(d.properties)) {
          if (!PropertyType[p.type]) E2('BAD_PROPERTY_TYPE', d.key + '.' + p.name, p.type);
          if (p.type === 'ENUM' && !(p.enumValues || []).length) E2('ENUM_WITHOUT_VALUES', d.key + '.' + p.name, '');
          if (privacy && privacy.isForbiddenKey(p.name, pol)) E2('FORBIDDEN_PROPERTY', d.key + '.' + p.name, 'propriedade proibida por privacidade');
          if (privacy && privacy.isReservedKey(p.name, pol)) E2('RESERVED_PROPERTY', d.key + '.' + p.name, 'contexto autoritativo não vai no payload');
          if (['LIMITED_PII', 'RESTRICTED'].includes(p.piiClass)) E2('PII_PROPERTY', d.key + '.' + p.name, p.piiClass);
          if (!p.description) E2('PROPERTY_WITHOUT_DESCRIPTION', d.key + '.' + p.name, '');
        }
      }
      for (const [name, a] of byName) a.forEach((d, i) => { if (d.version !== i + 1) E2('NON_MONOTONIC_VERSION', name, 'versões devem ser 1..n sem buracos'); });
      const ln = new Set();
      for (const l of legacy) {
        if (ln.has(l.legacyName)) E2('DUPLICATE_LEGACY', l.legacyName, ''); ln.add(l.legacyName);
        if (!has(l.canonicalName)) E2('LEGACY_TARGET_UNKNOWN', l.legacyName, l.canonicalName);
        if (!Migration[l.migrationAction]) E2('BAD_MIGRATION_ACTION', l.legacyName, l.migrationAction);
        if (!Severity[l.severity]) E2('BAD_SEVERITY', l.legacyName, l.severity);
        const t = l.transform || {}, tgt = latest(l.canonicalName);
        if (tgt) for (const k of [...Object.values(t.rename || {}), ...Object.keys(t.constants || {})]) if (!tgt.properties[k]) E2('LEGACY_TRANSFORM_TARGET', l.legacyName, k);
        if (tgt && !tgt.sources.includes('WEB_CLIENT')) E2('LEGACY_TO_SERVER_EVENT', l.legacyName, 'chamada do navegador mapeada para evento só-servidor');
      }
      if (o.metricCodes) { const mc = new Set(o.metricCodes); for (const d of defs) for (const p of d.purposes) if (!mc.has(p)) E2('UNKNOWN_PURPOSE', d.key, p); }
      return errs;
    }

    // ------------------------------------------------------------------ legacy payload transformer (declarative, no eval)
    /** transformLegacy(entry, data) → { payload, entity, dropped[] } */
    function transformLegacy(l, data) {
      const src = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
      const t = (l && l.transform) || {}, entity = {}, dropped = [];
      for (const [ek, lk] of Object.entries(t.entity || {})) { if (src[lk] != null) entity[ek] = src[lk]; delete src[lk]; }
      for (const k of t.drop || []) if (k in src) { delete src[k]; dropped.push(k); }
      const out = {};
      for (const [k, v] of Object.entries(src)) out[(t.rename || {})[k] || k] = v;
      for (const [k, m] of Object.entries(t.valueMap || {})) if (k in out) out[k] = Object.prototype.hasOwnProperty.call(m, String(out[k])) ? m[String(out[k])] : (m['*'] !== undefined ? m['*'] : out[k]);
      for (const k of t.toArray || []) if (k in out && out[k] != null && !Array.isArray(out[k])) out[k] = [out[k]];
      Object.assign(out, clone(t.constants || {}));
      return { payload: out, entity, dropped };
    }

    // ------------------------------------------------------------------ payload validation (client side; the server repeats it)
    /** validatePayload(def, payload, { strict, policy }) → { ok, payload, issues[{code,path,severity}] }
        strict (canonical producers): any issue rejects. legacy facade: optional/unknown offenders are dropped with a
        recorded warning; a missing/invalid required property still rejects. Values are never echoed into issues. */
    function validatePayload(def, payload, o = {}) {
      const pol = o.policy || cfg().policy || {}, privacy = App.eventTracking.privacy, lim = pol.payload || {}, strict = !!o.strict;
      const issues = [], out = {}, I = (code, path, sev) => issues.push({ code, path, severity: sev });
      const p0 = payload == null ? {} : payload;
      if (typeof p0 !== 'object' || Array.isArray(p0)) { I(Issue.SCHEMA_INVALID, '', 'ERROR'); return { ok: false, payload: {}, issues }; }
      for (const k of Object.keys(p0)) {
        if (privacy && privacy.isReservedKey(k, pol)) { I(Issue.RESERVED_CONTEXT_KEY, k, strict ? 'ERROR' : 'WARNING'); continue; }
        if (!def.properties[k]) { I(privacy && privacy.isForbiddenKey(k, pol) ? Issue.PRIVACY_VIOLATION : Issue.UNKNOWN_PROPERTY, k, strict ? 'ERROR' : 'WARNING'); continue; }
      }
      for (const p of Object.values(def.properties)) {
        const has = Object.prototype.hasOwnProperty.call(p0, p.name) && p0[p.name] !== undefined;
        const fail = code => I(code, p.name, strict || p.required ? 'ERROR' : 'WARNING');
        if (!has) { if (p.required) I(Issue.MISSING_REQUIRED, p.name, 'ERROR'); continue; }
        const v = p0[p.name];
        if (v === null) { if (p.allowNull) out[p.name] = null; else fail(Issue.INVALID_NULL); continue; }
        const r = checkValue(p, v, lim, pol, privacy);
        if (r.ok) out[p.name] = r.value; else fail(r.code);
      }
      return { ok: !issues.some(i => i.severity === 'ERROR'), payload: out, issues };
    }
    function checkValue(p, v, lim, pol, privacy) {
      const maxLen = p.maxLength || lim.maxStringLength || 120;
      const str = (s, format) => {
        if (typeof s !== 'string' && typeof s !== 'number') return { ok: false, code: Issue.INVALID_TYPE };
        let x = String(s).trim();
        if (privacy && privacy.detect(x, pol).length) return { ok: false, code: Issue.PRIVACY_VIOLATION };
        if (format === 'code') { x = x.replace(/[^A-Za-z0-9_.:\-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64); if (!CODE_RE.test(x)) return { ok: false, code: Issue.INVALID_TYPE }; }
        if (format === 'path') { if (/^[a-z][a-z0-9+.-]*:/i.test(x) || x.startsWith('//')) return { ok: false, code: Issue.PRIVACY_VIOLATION }; x = x.split(/[?#]/)[0]; }
        if (x.length > maxLen) return { ok: false, code: Issue.TOO_LONG };
        return { ok: true, value: x };
      };
      switch (p.type) {
        case 'STRING': return str(v, p.format);
        case 'ID': return str(v, 'code');
        case 'NUMBER': { if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, code: Issue.INVALID_TYPE }; if ((p.min != null && v < p.min) || (p.max != null && v > p.max)) return { ok: false, code: Issue.OUT_OF_RANGE }; return { ok: true, value: v }; }
        case 'BOOLEAN': return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, code: Issue.INVALID_TYPE };
        case 'ENUM': return (p.enumValues || []).includes(String(v)) && (typeof v === 'string' || typeof v === 'number') ? { ok: true, value: String(v) } : { ok: false, code: Issue.INVALID_ENUM };
        case 'TIMESTAMP': return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? { ok: true, value: new Date(v).toISOString() } : { ok: false, code: Issue.INVALID_TYPE };
        case 'ARRAY': {
          if (!Array.isArray(v)) return { ok: false, code: Issue.INVALID_TYPE };
          if (v.length > (p.maxItems || lim.maxArrayLength || 20)) return { ok: false, code: Issue.TOO_MANY_ITEMS };
          const xs = []; for (const it of v) { const r = str(it, p.items === 'code' ? 'code' : undefined); if (!r.ok) return r; xs.push(r.value); }
          return { ok: true, value: xs };
        }
        default: return { ok: false, code: Issue.SCHEMA_INVALID };
      }
    }

    // ------------------------------------------------------------------ generators (types, docs, fixtures)
    const tsType = p => p.type === 'ENUM' ? p.enumValues.map(v => JSON.stringify(v)).join(' | ') : p.type === 'NUMBER' ? 'number' : p.type === 'BOOLEAN' ? 'boolean' : p.type === 'ARRAY' ? 'string[]' : 'string';
    const pascal = s => s.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('');
    /** generateTypes() → TypeScript declarations for every published payload (one per name@version) */
    function generateTypes() {
      const lines = ['// GERADO por App.eventTracking.registry.generateTypes() a partir de config/analytics/events.json — não editar à mão.', `// registryVersion ${catalog.registryVersion || '?'}`];
      for (const d of defs) {
        lines.push(`/** ${d.description} — dispara: ${d.triggerSemantics} */`, `export interface ${pascal(d.name)}V${d.version}Payload {`);
        for (const p of Object.values(d.properties)) lines.push(`  ${p.name}${p.required ? '' : '?'}: ${tsType(p)}${p.allowNull ? ' | null' : ''};`);
        lines.push('}');
      }
      lines.push('export interface AnalyticsEventPayloads {', ...defs.map(d => `  ${JSON.stringify(d.key)}: ${pascal(d.name)}V${d.version}Payload;`), '}');
      return lines.join('\n') + '\n';
    }
    /** generateDocs() → markdown table of the catalog (pt-BR) */
    function generateDocs() {
      const row = d => `| \`${d.name}\` | ${d.version} | ${d.category} | ${d.eventClass === 'PRODUCT' ? 'produto' : 'telemetria técnica'} | ${d.producerPolicyRef} (${d.sources.join(', ')}) | ${d.priority} | ${d.deduplication.mode} | ${Object.values(d.properties).map(p => `${p.name}${p.required ? '*' : ''}: ${p.type === 'ENUM' ? p.enumValues.join('/') : p.type.toLowerCase()}`).join('; ') || '—'} | ${d.purposes.join(', ') || '—'} | ${d.triggerSemantics} |`;
      return ['| Evento | v | Categoria | Classe | Produtor (fontes) | Prioridade | Dedupe | Propriedades (* obrigatória) | Métricas que consomem | Quando dispara |', '|---|---|---|---|---|---|---|---|---|---|', ...defs.map(row)].join('\n') + '\n';
    }
    /** fixture(name) → a minimal valid payload (contract tests) */
    function fixture(name) {
      const d = latest(name); if (!d) return null; const out = {};
      for (const p of d.requiredProperties) out[p.name] = p.type === 'ENUM' ? p.enumValues[0] : p.type === 'NUMBER' ? (p.min != null ? p.min : 1) : p.type === 'BOOLEAN' ? true : p.type === 'ARRAY' ? ['campo'] : 'codigo';
      return out;
    }
    /** inventory() → LegacyTrackingInventoryItem[] (topic 45 §167) */
    const inventory = () => legacy.map(l => ({ location: l.location, eventName: l.legacyName, canonicalName: l.canonicalName, destination: 'App.analytics (memória)', triggerDescription: (latest(l.canonicalName) || {}).triggerSemantics || null,
      payloadFields: Object.keys((l.transform || {}).rename || {}), containsPII: !!l.containsPII, duplicatesAnotherEvent: !!l.duplicatesAnotherEvent, producerType: 'CLIENT', migrationAction: l.migrationAction, severity: l.severity, notes: l.notes || null }));
    /** unconsumed() → events without a known analytic consumer (to be questioned, §35) */
    const unconsumed = () => defs.filter(d => d.eventClass === 'PRODUCT' && !d.purposes.length).map(d => d.name);

    return Object.freeze({ version: catalog.registryVersion, schemaVersion: catalog.schemaVersion, list: () => defs.slice(), get, latest, has, isRegistered, resolveName, legacy: () => legacy.slice(), legacyOf: n => legacyByName.get(n) || null,
      contractErrors, transformLegacy, validatePayload, generateTypes, generateDocs, fixture, inventory, unconsumed });
  }
  let cached = null, cachedSrc = null;
  /** default() → registry over the bundled catalog (rebuilt if the config object changes) */
  function current() { const src = cfg().events; if (!cached || cachedSrc !== src) { cached = build(src || { events: [], legacy: [] }); cachedSrc = src; } return cached; }
  return Object.freeze({ Category, EventClass, PropertyType, PrivacyClass, Consent, Producer, Source, Priority, Dedup, Sampling, Status, Migration, Severity, Issue, NAME_RE, CODE_RE, build, current, normalizeEvent });
})();
