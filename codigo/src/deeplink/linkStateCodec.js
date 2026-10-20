/* deeplink/linkStateCodec.js — topic 43: deep links as an explicit, minimal, versioned navigation contract.
   DeepLinkContext · AppRouteCode · RouteRegistry · LinkStateEnvelope · LinkStateRegistry (one entry per URL field:
   contexts, privacy class, parser, serializer, max length) · LinkSizePolicy · LinkFilterSharePolicy · LinkPrivacyPolicy
   (allow-list first, PII detector as an extra defence) · LinkIdAliasRegistry · LinkStateMigrationRegistry ·
   LinkStateValidator · LinkCanonicalizer · LinkStateCodec (encode/decode) · ShareEntryStatePolicy · legacy inventory.

   PURE: decode never touches the store, the DOM, the network or the repositories. It parses, migrates and validates;
   the restoration service (deeplink/linkRestoration.js) resolves and authorizes. A link only asks for navigation:
   it never grants access, never carries prices/availability (LIVE resolves the current data) and never carries PII.

   Wire format (hash fragment, backward compatible with every link the panel produced before topic 43):
     #<dev>                                   MAP / DEVELOPMENT
     #<dev>.lots.<code>[.<section>|.simular|.sol]   LOT
     #<dev>.compare.<code>~<code>…             COMPARE (order kept, max 4)
     #<dev>.presentation.<snapshotId>          PRESENTATION (internal preview of a snapshot; step=…)
   followed by ?v=1&s=…&base=…&layer=…&score=…&ov=…&f=…&vp=…&sec=…&step=… (canonical order, defaults omitted).
   No `v` = version 0 (the router grammar of topics 10/18/20/24), migrated to 1 losslessly. Links with v=1 stay readable
   by the old App.router (it ignores the keys it does not know). */
App.deeplink = App.deeplink || {};
App.deeplink.codec = (() => {
  const freeze = Object.freeze, E = (...xs) => freeze(Object.fromEntries(xs.map(x => [x, x])));
  const SCHEMA = 'link-state', CURRENT_VERSION = 1;

  // ---------------------------------------------------------------- enums
  const DeepLinkContext = E('INTERNAL', 'SHARE_ENTRY', 'PRESENTATION', 'BOOKMARK');
  const AppRouteCode = E('MAP', 'LOT', 'FIND', 'COMPARE', 'CUSTOMER', 'JOURNEY', 'PRESENTATION', 'SHARED_PRESENTATION', 'DEVELOPMENT');
  const ResourceType = E('DEVELOPMENT', 'LOT', 'CUSTOMER', 'JOURNEY', 'COMPARISON', 'PRESENTATION', 'SHARE');
  const DecodeStatus = E('VALID', 'VALID_WITH_WARNINGS', 'INVALID', 'UNSUPPORTED_VERSION');
  const PrivacyClass = E('PUBLIC_SAFE', 'INTERNAL', 'SENSITIVE', 'FORBIDDEN');
  const PersistenceClass = E('EPHEMERAL', 'SESSION', 'BOOKMARK', 'SHARE');
  const ResourceMode = E('LIVE', 'SNAPSHOT');
  const ReproducibilityClass = E('NAVIGATIONAL', 'REPRODUCIBLE');
  const LinkIntent = E('INTERNAL_REFERENCE', 'EXTERNAL_SHARE', 'BOOKMARK', 'HANDOFF');
  const ErrorState = E('LINK_INVALID', 'LINK_VERSION_UNSUPPORTED', 'STATE_REF_EXPIRED', 'RESOURCE_NOT_FOUND', 'ACCESS_DENIED', 'PARTIAL_RESTORE');
  /** user-facing messages (no stack trace, no ids) */
  const MESSAGES = freeze({
    LINK_INVALID: 'Este link não pôde ser aberto. Mostrando o mapa do empreendimento.',
    LINK_VERSION_UNSUPPORTED: 'Este link foi criado por uma versão mais nova da plataforma. Abrimos apenas o empreendimento.',
    STATE_REF_EXPIRED: 'Este link de visualização expirou. Mostrando o mapa do empreendimento.',
    RESOURCE_NOT_FOUND: 'O conteúdo deste link não está mais disponível.',
    ACCESS_DENIED: 'Você não tem acesso ao conteúdo deste link.',
    PARTIAL_RESTORE: 'Parte da visualização deste link não está mais disponível; o restante foi restaurado.',
    LOT_NOT_FOUND: 'O lote deste link não está mais disponível na base atual.'
  });

  // ---------------------------------------------------------------- RouteRegistry (route code ≠ physical path)
  const ROUTES = freeze([
    { code: 'MAP', pathPattern: '<dev>', segment: null, allowedContexts: ['INTERNAL', 'BOOKMARK'], resourceTypes: ['DEVELOPMENT'], stateSchemaRef: 'MAP_WITH_FILTERS', historyPolicyRef: 'NAVIGATIONAL', authRequired: false, resourceMode: 'LIVE', status: 'ACTIVE' },
    { code: 'DEVELOPMENT', pathPattern: '<dev>', segment: null, allowedContexts: ['INTERNAL', 'BOOKMARK'], resourceTypes: ['DEVELOPMENT'], stateSchemaRef: 'MAP_MINIMAL', historyPolicyRef: 'NAVIGATIONAL', authRequired: false, resourceMode: 'LIVE', status: 'ALIAS_OF_MAP' },
    { code: 'LOT', pathPattern: '<dev>.lots.<lotRef>[.<section>|.simular|.sol]', segment: 'lots', allowedContexts: ['INTERNAL', 'BOOKMARK'], resourceTypes: ['LOT'], stateSchemaRef: 'LOT_CONTEXT', historyPolicyRef: 'NAVIGATIONAL', authRequired: false, resourceMode: 'LIVE', status: 'ACTIVE' },
    { code: 'COMPARE', pathPattern: '<dev>.compare.<lotRef>~<lotRef>…', segment: 'compare', allowedContexts: ['INTERNAL', 'BOOKMARK'], resourceTypes: ['COMPARISON'], stateSchemaRef: 'COMPARISON_CONTEXT', historyPolicyRef: 'NAVIGATIONAL', authRequired: false, resourceMode: 'LIVE', status: 'ACTIVE' },
    { code: 'PRESENTATION', pathPattern: '<dev>.presentation.<snapshotId>?step=<stepId>', segment: 'presentation', allowedContexts: ['INTERNAL', 'PRESENTATION', 'BOOKMARK'], resourceTypes: ['PRESENTATION'], stateSchemaRef: 'PRESENTATION_CONTEXT', historyPolicyRef: 'NAVIGATIONAL', authRequired: true, resourceMode: 'SNAPSHOT', status: 'ACTIVE' },
    { code: 'CUSTOMER', pathPattern: '<dev>?s=<stateRef> (customer only inside an authenticated stateRef)', segment: null, allowedContexts: ['INTERNAL', 'BOOKMARK'], resourceTypes: ['CUSTOMER'], stateSchemaRef: 'CUSTOMER_CONTEXT', historyPolicyRef: 'NAVIGATIONAL', authRequired: true, resourceMode: 'LIVE', status: 'STATE_REF_ONLY' },
    { code: 'JOURNEY', pathPattern: '<dev>?s=<stateRef> (journey only inside an authenticated stateRef)', segment: null, allowedContexts: ['INTERNAL', 'BOOKMARK'], resourceTypes: ['CUSTOMER', 'JOURNEY'], stateSchemaRef: 'CUSTOMER_CONTEXT', historyPolicyRef: 'NAVIGATIONAL', authRequired: true, resourceMode: 'LIVE', status: 'STATE_REF_ONLY' },
    { code: 'FIND', pathPattern: '(reservado)', segment: null, allowedContexts: ['INTERNAL'], resourceTypes: ['DEVELOPMENT'], stateSchemaRef: 'MAP_WITH_FILTERS', historyPolicyRef: 'NAVIGATIONAL', authRequired: false, resourceMode: 'LIVE', status: 'RESERVED' },
    { code: 'SHARED_PRESENTATION', pathPattern: '/s/<token> (ShareService, tópico 42)', segment: null, allowedContexts: ['SHARE_ENTRY'], resourceTypes: ['SHARE'], stateSchemaRef: 'SHARE_ENTRY', historyPolicyRef: 'NAVIGATIONAL', authRequired: false, resourceMode: 'SNAPSHOT', status: 'SHARE_SERVICE' }
  ].map(freeze));
  const ROUTE = freeze(Object.fromEntries(ROUTES.map(r => [r.code, r])));

  // ---------------------------------------------------------------- policies
  const SIZE_POLICY = freeze({ maxInlineLength: 1500, maxRawLength: 6000, maxParamCount: 16, maxFilterConditionCount: 16, maxComparisonCandidateCount: 4, maxRawCandidateCount: 8, overflowStrategy: 'STATE_REF', fallbackOverflowStrategy: 'DROP_OPTIONAL' });
  /** customer-derived filters (fit to a profile) reveal preferences/budget: never inline, never external */
  const FILTER_SHARE_POLICY = freeze({ allowCustomerDerivedFilters: false, customerDerivedKeys: freeze(['fitMin', 'fitCoverageMin', 'fitConfidenceMin']), personalKeys: freeze(['favoritesOnly']),
    technicalLevelContexts: freeze(['INTERNAL', 'BOOKMARK']), freeTextKey: 'q', freeTextPattern: /^[A-Za-z]{1,3} ?-?\d{1,4}$/ });
  const COMPARISON_SECTIONS = freeze(['summary', 'location', 'comfort', 'commercial', 'technical']); // same ids as the ShareEntryPoint (topic 42)
  const PANEL_SUFFIX = freeze({ simulation: 'simular', solar: 'sol' }), SUFFIX_PANEL = freeze({ simular: 'simulation', sol: 'solar' });

  // ---------------------------------------------------------------- privacy
  const UNSAFE_KEYS = freeze(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__', '__lookupGetter__', 'hasOwnProperty', 'toString', 'valueOf']);
  /** keys that are never accepted in any link, in any context (PII, secrets, raw stores, authority overrides) */
  const FORBIDDEN_KEY = /^(phone|tel|telefone|celular|whatsapp|wa|email|e-?mail|mail|cpf|cnpj|rg|name|nome|customername|clientname|cliente|customer|customerid|cust|cid|journey|journeyid|jid|profile|token|auth|authorization|access_?token|session|sessionid|password|senha|secret|key|apikey|notes?|state|store|redux|price|preco|pricing|availability|status|revision|pricetable|perm|permissions?|role|org|organizationid|tenant|budget|orcamento|sessionid)$/i;
  const VALUE_PATTERNS = freeze([
    { code: 'PII_EMAIL', re: /[A-Z0-9._%+-]+(@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/i },
    { code: 'PII_CPF', re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/ },
    { code: 'PII_PHONE', re: /(?:\+|%2B)?55\d{10,11}|\(?\b\d{2}\)?[\s-]?9\d{4}[-\s]?\d{4}\b|\b\d{10,11}\b/ },
    { code: 'CUSTOMER_ID', re: /\bcus_[a-z0-9]+|\bjny_[a-z0-9]+/i },
    { code: 'AUTH_TOKEN', re: /\bBearer\b|\beyJ[A-Za-z0-9_-]{10,}\.|[A-Za-z0-9_-]{43,}/ },
    { code: 'SCRIPT', re: /<\s*\/?\s*[a-z]|javascript:|data:text|on\w+\s*=/i },
    { code: 'EXPRESSION', re: /\beval\b|\bfunction\b|=>|\bselect\b.+\bfrom\b|\bwhere\b.+[<>=]|;\s*(drop|delete|update)\b/i }
  ]);
  /** scanValue(string) → [code] — PII detector: an extra defence, the schema allow-list stays the main control */
  const scanValue = s => { const t = String(s == null ? '' : s), out = []; for (const p of VALUE_PATTERNS) if (p.re.test(t)) out.push(p.code); return out; };
  const isUnsafeKey = k => UNSAFE_KEYS.includes(k) || /__proto__|prototype|constructor/i.test(k);

  // ---------------------------------------------------------------- aliases (controlled; never remap a canonical LotId)
  const ALIASES = freeze({ routeSegments: freeze({ lots: 'lots', lot: 'lots', lote: 'lots', lotes: 'lots', compare: 'compare', comparar: 'compare', comparacao: 'compare', presentation: 'presentation', apresentacao: 'presentation' }),
    panelSuffixes: freeze({ simular: 'simular', simulation: 'simular', simulacao: 'simular', sol: 'sol', solar: 'sol' }),
    layers: freeze({}), filterFields: freeze({}), steps: freeze({}), developmentSlugs: freeze({}) });
  function aliasRegistry(extra = {}) {
    const m = k => freeze({ ...ALIASES[k], ...(extra[k] || {}) });
    return freeze({ routeSegments: m('routeSegments'), panelSuffixes: m('panelSuffixes'), layers: m('layers'), filterFields: m('filterFields'), steps: m('steps'), developmentSlugs: m('developmentSlugs') });
  }

  // ---------------------------------------------------------------- ids
  const ID = freeze({
    development: /^[a-z0-9][a-z0-9-]{1,40}$/,
    lotRef: /^[A-Za-z0-9][A-Za-z0-9-]{0,23}$/,         // short code (B79) or canonical id (VJ-QB-L0079); resolved by the repository / LegacyAdapter
    section: /^[a-z]{2,24}$/,
    snapshotId: /^prs_[A-Za-z0-9]{6,40}$/,
    stepId: /^st\d{1,3}$/,
    stateRef: /^LS[0-9A-Za-z]{6,32}$/,
    layerId: /^[a-zA-Z0-9_]{1,32}$/,
    overlayId: /^[a-zA-Z]{1,24}$/,
    customerId: /^cus_[A-Za-z0-9]{4,48}$/,
    journeyId: /^jny_[A-Za-z0-9]{4,48}$/
  });
  const SCORE_KEYS = freeze(['housing', 'investment', 'family', 'premium', 'overall']);
  const BASE_MODES = () => (App.mapLayers && App.mapLayers.BASE_MODES) || ['PLANT', 'AERIAL', 'HYBRID'];

  // ---------------------------------------------------------------- LinkStateRegistry (query fields, canonical order)
  // parse(raw) → { ok, value } ; serialize(value, env, ctx) → raw | null (null = omitted, e.g. default)
  const decodeOnce = v => { try { return { ok: true, value: decodeURIComponent(v) }; } catch (e) { return { ok: false }; } };
  const num = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  const FIELDS = freeze([
    { key: 'v', branch: null, contexts: ['INTERNAL', 'BOOKMARK', 'PRESENTATION'], privacy: 'INTERNAL', maxLength: 3, defaultOmission: 'NEVER',
      parse: raw => /^\d{1,3}$/.test(raw) ? { ok: true, value: Number(raw) } : { ok: false } },
    { key: 's', branch: 'stateRef', contexts: ['INTERNAL', 'BOOKMARK'], privacy: 'INTERNAL', maxLength: 34, defaultOmission: 'IF_ABSENT',
      parse: raw => ID.stateRef.test(raw) ? { ok: true, value: raw } : { ok: false } },
    { key: 'base', branch: 'map', contexts: ['INTERNAL', 'BOOKMARK', 'PRESENTATION'], privacy: 'INTERNAL', maxLength: 10, defaultOmission: 'IF_DEFAULT',
      parse: raw => { const m = raw.toUpperCase(); return BASE_MODES().includes(m) ? { ok: true, value: m } : { ok: false }; } },
    { key: 'layer', branch: 'map', contexts: ['INTERNAL', 'BOOKMARK', 'PRESENTATION'], privacy: 'INTERNAL', maxLength: 32, defaultOmission: 'IF_DEFAULT',
      parse: raw => ID.layerId.test(raw) ? { ok: true, value: raw } : { ok: false } },
    { key: 'score', branch: 'map', contexts: ['INTERNAL', 'BOOKMARK', 'PRESENTATION'], privacy: 'INTERNAL', maxLength: 12, defaultOmission: 'ONLY_WITH_SCORE_LAYER',
      parse: raw => SCORE_KEYS.includes(raw) ? { ok: true, value: raw } : { ok: false } },
    { key: 'ov', branch: 'map', contexts: ['INTERNAL', 'BOOKMARK', 'PRESENTATION'], privacy: 'INTERNAL', maxLength: 120, defaultOmission: 'IF_DEFAULT',
      parse: raw => { if (raw === '-') return { ok: true, value: [] }; const xs = raw.split(','); if (xs.length > 12) return { ok: false }; return { ok: true, value: xs.filter(x => ID.overlayId.test(x)) }; } },
    { key: 'f', branch: 'filters', contexts: ['INTERNAL', 'BOOKMARK'], privacy: 'INTERNAL', maxLength: 1500, defaultOmission: 'IF_EMPTY',
      parse: raw => { const d = decodeOnce(raw); return d.ok ? { ok: true, value: d.value } : { ok: false }; } },
    { key: 'vp', branch: 'map.viewport', contexts: ['INTERNAL', 'BOOKMARK'], privacy: 'INTERNAL', maxLength: 24, defaultOmission: 'IF_LOT_FOCUS',
      parse: raw => { const m = /^(-?\d{1,5}(?:\.\d)?),(-?\d{1,5}(?:\.\d)?),(\d{1,2}(?:\.\d{1,2})?)$/.exec(raw); if (!m) return { ok: false }; const z = +m[3]; return z > 0 && z <= 40 ? { ok: true, value: { centerX: +m[1], centerY: +m[2], zoom: z } } : { ok: false }; } },
    { key: 'sec', branch: 'comparison', contexts: ['INTERNAL', 'BOOKMARK'], privacy: 'INTERNAL', maxLength: 12, defaultOmission: 'IF_DEFAULT',
      parse: raw => COMPARISON_SECTIONS.includes(raw) ? { ok: true, value: raw } : { ok: false } },
    { key: 'step', branch: 'presentation', contexts: ['INTERNAL', 'BOOKMARK', 'PRESENTATION'], privacy: 'INTERNAL', maxLength: 6, defaultOmission: 'IF_ABSENT',
      parse: raw => ID.stepId.test(raw) ? { ok: true, value: raw } : { ok: false } }
  ].map(freeze));
  const FIELD = freeze(Object.fromEntries(FIELDS.map(f => [f.key, f])));
  /** branches the payload may hold, their privacy class and the contexts that may carry them inline */
  const BRANCHES = freeze({
    development: { privacy: 'INTERNAL', inline: true }, lot: { privacy: 'INTERNAL', inline: true }, map: { privacy: 'INTERNAL', inline: true }, filters: { privacy: 'INTERNAL', inline: true },
    comparison: { privacy: 'INTERNAL', inline: true }, presentation: { privacy: 'INTERNAL', inline: true }, ui: { privacy: 'INTERNAL', inline: true },
    customer: { privacy: 'SENSITIVE', inline: false }, journey: { privacy: 'SENSITIVE', inline: false }
  });
  const BRANCH_KEYS = freeze({ development: ['developmentId'], lot: ['selectedLotId', 'focusedLotId'], map: ['layerId', 'baseMapMode', 'overlays', 'scoreKey', 'viewport'], filters: ['filterSchemaVersion', 'values', 'mode', 'presetId'],
    comparison: ['candidateLotIds', 'activeSectionId', 'comparisonId', 'profileId'], presentation: ['snapshotId', 'stepId', 'lotId', 'mode'], ui: ['panel', 'detailSection', 'workspaceMode'],
    customer: ['customerId', 'profileVersionId'], journey: ['journeyId'] });

  // ---------------------------------------------------------------- migrations (pure, deterministic, no network)
  /** each step receives the raw parsed link { path, params: Map } and returns a new one; no step may read data */
  const MIGRATIONS = freeze({
    // v0 → v1: the pre-43 router grammar is a subset of v1 (same path, same base/layer/score/ov/f params).
    // Only change: v0 never knew vp/sec/step/s, so those keys in a v0 link are foreign and dropped.
    0: raw => { const params = new Map(); for (const [k, v] of raw.params) if (!['vp', 'sec', 'step', 's'].includes(k)) params.set(k, v); return { ...raw, params }; }
  });

  // ---------------------------------------------------------------- helpers
  const warn = (code, extra = {}) => freeze({ code, ...extra });
  const uniq = xs => { const seen = new Set(), out = []; for (const x of xs) if (!seen.has(x)) { seen.add(x); out.push(x); } return out; };
  const fragmentOf = input => {
    const s = String(input == null ? '' : input), i = s.indexOf('#');
    if (/^https?:\/\//i.test(s) || s.startsWith('/')) return i >= 0 ? s.slice(i + 1) : '';
    return s.replace(/^#/, '');
  };
  const plainObject = () => Object.create(null);

  /** splitParams(q) → { params: Map, warnings, errors } — never builds an object from URL keys */
  function splitParams(q, contextCode) {
    const params = new Map(), warnings = [], errors = [];
    const parts = q ? q.split('&').filter(Boolean) : [];
    if (parts.length > SIZE_POLICY.maxParamCount) { errors.push(warn('TOO_MANY_PARAMS', { count: parts.length })); return { params, warnings, errors }; }
    for (const part of parts) {
      const i = part.indexOf('='), k0 = i < 0 ? part : part.slice(0, i), raw = i < 0 ? '' : part.slice(i + 1);
      const dk = decodeOnce(k0), k = dk.ok ? dk.value : k0;
      if (isUnsafeKey(k)) { errors.push(warn('PROTOTYPE_POLLUTION_REJECTED', { key: '[unsafe]' })); continue; }
      if (FORBIDDEN_KEY.test(k)) { errors.push(warn('FORBIDDEN_PARAM', { key: k.toLowerCase() })); continue; }
      if (!FIELD[k]) { warnings.push(warn('UNKNOWN_PARAM', { key: /^[a-z0-9]{1,12}$/i.test(k) ? k : '[?]' })); continue; }
      if (params.has(k)) { warnings.push(warn('DUPLICATE_PARAM', { key: k })); continue; }
      if (!raw) continue;
      if (raw.length > FIELD[k].maxLength * 3) { errors.push(warn('PARAM_TOO_LONG', { key: k })); continue; }
      const dv = decodeOnce(raw);
      if (!dv.ok) { warnings.push(warn('MALFORMED_PARAM', { key: k })); continue; }
      const pii = scanValue(k === 'f' ? decodeOnce(dv.value).value || dv.value : dv.value);
      if (pii.length) { errors.push(warn('PII_REJECTED', { key: k, codes: pii })); continue; }
      params.set(k, k === 'f' ? raw : dv.value); // f keeps its own (double) encoding: the filter module decodes its parts
    }
    return { params, warnings, errors };
  }

  /** parsePath(path, aliases) → { developmentId, segment, rest, warnings, errors } */
  function parsePath(path, aliases) {
    const warnings = [], errors = [], p = path.split('.');
    const dev0 = p[0], dev = aliases.developmentSlugs[dev0] || dev0;
    if (!ID.development.test(dev || '')) { errors.push(warn('INVALID_DEVELOPMENT_ID')); return { developmentId: null, warnings, errors }; }
    const out = { developmentId: dev, route: 'MAP', warnings, errors };
    if (p.length === 1) return out;
    const seg = aliases.routeSegments[String(p[1]).toLowerCase()];
    if (!seg) { warnings.push(warn('ROUTE_UNKNOWN')); return out; }
    if (seg === 'lots') {
      if (!p[2] || !ID.lotRef.test(p[2])) { warnings.push(warn('LOT_REF_INVALID')); return out; }
      out.route = 'LOT'; out.lotRef = p[2];
      if (p[3]) { const suf = aliases.panelSuffixes[p[3]]; if (suf) out.panel = SUFFIX_PANEL[suf]; else if (ID.section.test(p[3])) { out.panel = 'details'; out.detailSection = p[3]; } else warnings.push(warn('SECTION_INVALID')); }
    } else if (seg === 'compare') {
      const refs = String(p[2] || '').split('~').filter(Boolean);
      if (refs.length > SIZE_POLICY.maxRawCandidateCount) { errors.push(warn('COMPARISON_TOO_MANY_CANDIDATES', { count: refs.length })); return out; }
      const ok = refs.filter(r => ID.lotRef.test(r)); if (ok.length < refs.length) warnings.push(warn('LOT_REF_INVALID'));
      const dedup = uniq(ok); if (dedup.length < ok.length) warnings.push(warn('COMPARISON_DUPLICATE_REMOVED'));
      if (!dedup.length) { warnings.push(warn('COMPARISON_EMPTY')); return out; }
      out.route = 'COMPARE'; out.candidateRefs = dedup;
    } else if (seg === 'presentation') {
      if (!p[2] || !ID.snapshotId.test(p[2])) { warnings.push(warn('PRESENTATION_REF_INVALID')); return out; }
      out.route = 'PRESENTATION'; out.snapshotId = p[2];
    }
    if (p.length > 4) warnings.push(warn('PATH_EXTRA_SEGMENTS'));
    return out;
  }

  // ---------------------------------------------------------------- envelope building / validation
  function resourceOf(route, st) {
    if (route === 'LOT' && st.lot) return { type: 'LOT', id: st.lot.selectedLotId };
    if (route === 'COMPARE' && st.comparison) return { type: 'COMPARISON', id: st.comparison.candidateLotIds.join('~') };
    if (route === 'PRESENTATION' && st.presentation) return { type: 'PRESENTATION', id: st.presentation.snapshotId };
    return { type: 'DEVELOPMENT', id: st.development.developmentId };
  }
  /** validate(envelope, { context }) → { ok, errors, warnings } — schema allow-list; external is strict */
  function validate(env, opts = {}) {
    const errors = [], warnings = [], ctx = (env && env.context) || opts.context;
    if (!env || typeof env !== 'object' || Array.isArray(env)) return { ok: false, errors: [warn('MALFORMED_ENVELOPE')], warnings };
    for (const k of Object.keys(env)) if (!['schema', 'version', 'context', 'route', 'resource', 'state', 'stateRef', 'createdAt', 'checksum', 'resourceMode'].includes(k)) errors.push(warn(isUnsafeKey(k) ? 'PROTOTYPE_POLLUTION_REJECTED' : 'UNEXPECTED_KEY', { key: isUnsafeKey(k) ? '[unsafe]' : k }));
    if (env.schema !== SCHEMA) errors.push(warn('SCHEMA_INVALID'));
    if (!Number.isInteger(env.version) || env.version < 0) errors.push(warn('VERSION_INVALID'));
    if (!DeepLinkContext[ctx]) errors.push(warn('CONTEXT_INVALID'));
    if (!AppRouteCode[env.route]) errors.push(warn('ROUTE_INVALID'));
    else if (ROUTE[env.route] && !ROUTE[env.route].allowedContexts.includes(ctx)) errors.push(warn('ROUTE_NOT_ALLOWED_IN_CONTEXT', { route: env.route }));
    if (env.resource && (!ResourceType[env.resource.type] || typeof env.resource.id !== 'string')) errors.push(warn('RESOURCE_INVALID'));
    if (env.resource && ['CUSTOMER', 'JOURNEY'].includes(env.resource.type) && ctx !== 'INTERNAL' && ctx !== 'BOOKMARK') errors.push(warn('RESOURCE_INTERNAL_ONLY'));
    if (env.stateRef != null && !ID.stateRef.test(String(env.stateRef))) errors.push(warn('STATE_REF_INVALID'));
    const st = env.state;
    if (st != null) {
      if (typeof st !== 'object' || Array.isArray(st)) errors.push(warn('STATE_MALFORMED'));
      else for (const [b, v] of Object.entries(st)) {
        if (isUnsafeKey(b)) { errors.push(warn('PROTOTYPE_POLLUTION_REJECTED', { key: '[unsafe]' })); continue; }
        if (!BRANCHES[b]) { errors.push(warn('BRANCH_UNKNOWN', { branch: b })); continue; }
        if (v == null) continue;
        if (typeof v !== 'object' || Array.isArray(v)) { errors.push(warn('BRANCH_MALFORMED', { branch: b })); continue; }
        for (const k of Object.keys(v)) if (!BRANCH_KEYS[b].includes(k)) errors.push(warn(isUnsafeKey(k) ? 'PROTOTYPE_POLLUTION_REJECTED' : 'BRANCH_KEY_UNKNOWN', { branch: b, key: isUnsafeKey(k) ? '[unsafe]' : k }));
        if (BRANCHES[b].privacy === 'SENSITIVE' && !opts.allowSensitive) errors.push(warn('SENSITIVE_BRANCH_INLINE', { branch: b }));
        if (b === 'customer' && v.customerId != null && !ID.customerId.test(v.customerId)) errors.push(warn('CUSTOMER_ID_INVALID'));
        if (b === 'journey' && v.journeyId != null && !ID.journeyId.test(v.journeyId)) errors.push(warn('JOURNEY_ID_INVALID'));
        if (b === 'comparison' && v.candidateLotIds != null && (!Array.isArray(v.candidateLotIds) || v.candidateLotIds.length > SIZE_POLICY.maxRawCandidateCount || v.candidateLotIds.some(x => !ID.lotRef.test(String(x))))) errors.push(warn('COMPARISON_CANDIDATES_INVALID'));
        if (b === 'lot' && v.selectedLotId != null && !ID.lotRef.test(String(v.selectedLotId))) errors.push(warn('LOT_REF_INVALID'));
        if (b === 'map' && v.overlays != null && (!Array.isArray(v.overlays) || v.overlays.length > 12)) errors.push(warn('OVERLAYS_INVALID'));
        if (b === 'presentation' && v.stepId != null && !ID.stepId.test(v.stepId)) errors.push(warn('STEP_INVALID'));
      }
      // PII detector over every string of the payload (defence in depth)
      const walk = (x, path, depth) => {
        if (depth > 4) { errors.push(warn('UNEXPECTED_NESTING', { path })); return; }
        if (typeof x === 'string') { const c = scanValue(x).filter(c => !(c === 'CUSTOMER_ID' && opts.allowSensitive && /^(customer|journey)\./.test(path))); if (c.length) errors.push(warn('PII_REJECTED', { path, codes: c })); return; }
        if (Array.isArray(x)) { if (x.length > 64) errors.push(warn('ARRAY_TOO_LARGE', { path })); x.forEach(y => walk(y, path, depth + 1)); return; }
        if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) walk(y, path ? path + '.' + k : k, depth + 1);
      };
      if (typeof st === 'object') walk(st, '', 0);
    }
    if (env.stateRef && st && Object.keys(st).some(b => b !== 'development' && st[b] != null)) errors.push(warn('STATE_AND_STATE_REF_CONFLICT'));
    return { ok: errors.length === 0, errors, warnings };
  }

  /** canonicalize(envelope, { mapDefaults }) → new envelope: defaults removed, ids deduplicated, irrelevant branches dropped */
  function canonicalize(env, opts = {}) {
    const st = env.state || {}, route = env.route === 'DEVELOPMENT' ? 'MAP' : env.route, out = {};
    const dev = st.development && st.development.developmentId; out.development = { developmentId: dev };
    if (route === 'LOT' && st.lot && st.lot.selectedLotId) out.lot = { selectedLotId: st.lot.selectedLotId };
    if (route === 'LOT' && st.ui && st.ui.panel === 'details') out.ui = { panel: 'details', detailSection: st.ui.detailSection || 'summary' };
    else if (route === 'LOT' && st.ui && PANEL_SUFFIX[st.ui.panel]) out.ui = { panel: st.ui.panel };
    if (route === 'COMPARE' && st.comparison && Array.isArray(st.comparison.candidateLotIds)) {
      const ids = uniq(st.comparison.candidateLotIds.map(String)).slice(0, SIZE_POLICY.maxComparisonCandidateCount);
      if (ids.length) { out.comparison = { candidateLotIds: ids }; if (st.comparison.activeSectionId && st.comparison.activeSectionId !== 'summary' && COMPARISON_SECTIONS.includes(st.comparison.activeSectionId)) out.comparison.activeSectionId = st.comparison.activeSectionId; }
    }
    if (route === 'PRESENTATION' && st.presentation && st.presentation.snapshotId) { out.presentation = { snapshotId: st.presentation.snapshotId }; if (st.presentation.stepId) out.presentation.stepId = st.presentation.stepId; }
    if (st.map) {
      const d = opts.mapDefaults || {}, m = {};
      if (st.map.baseMapMode) { const b = String(st.map.baseMapMode).toUpperCase(); if (b !== d.baseMapMode) m.baseMapMode = b; }
      if (st.map.layerId && st.map.layerId !== d.primaryLayerId) m.layerId = st.map.layerId;
      if ((st.map.layerId || d.primaryLayerId) === 'score') m.scoreKey = SCORE_KEYS.includes(st.map.scoreKey) ? st.map.scoreKey : 'housing';
      if (Array.isArray(st.map.overlays)) { const ov = uniq(st.map.overlays).filter(x => !opts.shareableOverlay || opts.shareableOverlay(x)).sort(), dv = (d.activeOverlayIds || []).slice().sort(); if (ov.join(',') !== dv.join(',')) m.overlays = ov; }
      if (st.map.viewport && route === 'MAP') { const v = st.map.viewport; if ([v.centerX, v.centerY, v.zoom].every(Number.isFinite)) m.viewport = { centerX: num(v.centerX, 0), centerY: num(v.centerY, 0), zoom: num(v.zoom, 2) }; }
      if (Object.keys(m).length) out.map = m;
    }
    if (st.filters && st.filters.values && typeof st.filters.values === 'object') {
      const vals = {}; for (const k of Object.keys(st.filters.values).sort()) { const v = st.filters.values[k]; if (v == null || v === '' || v === false || (Array.isArray(v) && !v.length)) continue; vals[k] = Array.isArray(v) ? uniq(v).slice().sort() : v; }
      if (Object.keys(vals).length) out.filters = { filterSchemaVersion: st.filters.filterSchemaVersion || 1, values: vals };
    }
    for (const b of ['customer', 'journey']) if (st[b]) out[b] = { ...st[b] };
    const res = env.stateRef ? { stateRef: env.stateRef } : {};
    return { schema: SCHEMA, version: env.version == null ? CURRENT_VERSION : env.version, context: env.context || 'INTERNAL', route, resource: resourceOf(route, out), state: out, ...res, resourceMode: (ROUTE[route] || {}).resourceMode || 'LIVE' };
  }

  // ---------------------------------------------------------------- codec
  function createCodec(o = {}) {
    const version = o.currentVersion || CURRENT_VERSION, migrations = o.migrations || MIGRATIONS, aliases = aliasRegistry(o.aliases || {});
    const filterApi = () => o.filters || App.filters, mapApi = () => o.mapLayers || App.mapLayers;
    const mapDefaults = dev => { const ml = mapApi(); try { return ml ? ml.defaultState(dev) : {}; } catch (e) { return {}; } };
    const shareableOverlay = dev => { const ml = mapApi(); if (!ml) return () => true; let r; try { r = ml.registry(dev); } catch (e) { r = null; } return id => !r || !!(r.get(id) || {}).shareable; };

    /** decode(input, { context }) → LinkDecodeResult. No side effects. */
    function decode(input, dctx = {}) {
      const context = dctx.context || 'INTERNAL', warnings = [], errors = [];
      const s = String(input == null ? '' : input);
      if (s.length > SIZE_POLICY.maxRawLength) return freeze({ status: 'INVALID', envelope: null, warnings, errors: [warn('LINK_TOO_LONG', { length: s.length })], errorState: 'LINK_INVALID' });
      if (/\/s\/[A-Za-z0-9_-]+/.test(s) && context !== 'SHARE_ENTRY') return freeze({ status: 'INVALID', envelope: null, warnings, errors: [warn('SHARE_URL_USE_SHARE_SERVICE')], errorState: 'LINK_INVALID' });
      if (context === 'SHARE_ENTRY') return freeze({ status: 'INVALID', envelope: null, warnings, errors: [warn('USE_SHARE_ENTRY_POLICY')], errorState: 'LINK_INVALID' });
      const full = fragmentOf(s); if (!full) return freeze({ status: 'INVALID', envelope: null, warnings, errors: [warn('EMPTY_LINK')], errorState: 'LINK_INVALID' });
      const qi = full.indexOf('?'), path = qi < 0 ? full : full.slice(0, qi), q = qi < 0 ? '' : full.slice(qi + 1);
      const pp = parsePath(path, aliases); warnings.push(...pp.warnings); errors.push(...pp.errors);
      if (!pp.developmentId) return freeze({ status: 'INVALID', envelope: null, warnings, errors, errorState: 'LINK_INVALID' });
      const sp = splitParams(q, context); warnings.push(...sp.warnings); errors.push(...sp.errors);
      let raw = { path: pp, params: sp.params };
      const vRaw = raw.params.get('v');
      let from = vRaw == null ? 0 : FIELD.v.parse(vRaw).ok ? Number(vRaw) : NaN;
      if (!Number.isInteger(from)) { errors.push(warn('VERSION_INVALID')); from = 0; }
      const baseEnv = st => ({ schema: SCHEMA, version, context, route: 'MAP', resource: { type: 'DEVELOPMENT', id: pp.developmentId }, state: { development: { developmentId: pp.developmentId }, ...st } });
      if (from > version) {
        // newer contract: restore only what the frozen path grammar says (development + route/resource), never reinterpret params
        const st = {}, env = baseEnv(st);
        if (pp.route === 'LOT') { env.route = 'LOT'; st.lot = { selectedLotId: pp.lotRef }; env.resource = { type: 'LOT', id: pp.lotRef }; }
        else if (pp.route === 'COMPARE') { env.route = 'COMPARE'; st.comparison = { candidateLotIds: pp.candidateRefs.slice(0, SIZE_POLICY.maxComparisonCandidateCount) }; env.resource = { type: 'COMPARISON', id: st.comparison.candidateLotIds.join('~') }; }
        env.state = { ...env.state, ...st };
        return freeze({ status: 'UNSUPPORTED_VERSION', envelope: env, warnings: [...warnings, warn('LINK_VERSION_UNSUPPORTED', { version: from })], errors, linkVersion: from, errorState: 'LINK_VERSION_UNSUPPORTED' });
      }
      let migratedFromVersion; const steps = [];
      for (let v = from; v < version; v++) { const m = migrations[v]; if (!m) { errors.push(warn('MIGRATION_MISSING', { from: v })); return freeze({ status: 'UNSUPPORTED_VERSION', envelope: baseEnv({}), warnings, errors, errorState: 'LINK_VERSION_UNSUPPORTED' }); } raw = m(raw); steps.push(`${v}→${v + 1}`); }
      if (steps.length) { migratedFromVersion = from; if (from > 0) warnings.push(warn('STATE_VERSION_MIGRATED', { from, to: version })); }
      const P = raw.params, path2 = raw.path, st = { development: { developmentId: path2.developmentId } };
      let route = path2.route;
      if (route === 'LOT') { st.lot = { selectedLotId: path2.lotRef }; if (path2.panel) st.ui = path2.panel === 'details' ? { panel: 'details', detailSection: path2.detailSection } : { panel: path2.panel }; }
      if (route === 'COMPARE') st.comparison = { candidateLotIds: path2.candidateRefs.slice() };
      if (route === 'PRESENTATION') st.presentation = { snapshotId: path2.snapshotId };
      // per-field parsing through the registry
      const val = {};
      for (const [k, rv] of P) {
        if (k === 'v') continue;
        const f = FIELD[k];
        if (!f.contexts.includes(context)) { warnings.push(warn('PARAM_NOT_ALLOWED_IN_CONTEXT', { key: k })); continue; }
        const r = f.parse(k === 'layer' ? (aliases.layers[rv] || rv) : rv);
        if (!r.ok) { warnings.push(warn('PARAM_INVALID', { key: k })); continue; }
        if (k === 'layer' && aliases.layers[rv]) warnings.push(warn('ALIAS_APPLIED', { key: k }));
        val[k] = r.value;
      }
      if (val.base || val.layer || val.score || val.ov || val.vp) {
        st.map = {}; if (val.base) st.map.baseMapMode = val.base; if (val.layer) st.map.layerId = val.layer; if (val.score) st.map.scoreKey = val.score; if (val.ov) st.map.overlays = val.ov;
        if (val.vp) { if (route === 'MAP') st.map.viewport = val.vp; else warnings.push(warn('VIEWPORT_IGNORED_WITH_LOT_FOCUS')); }
      }
      if (val.f != null) {
        const F = filterApi(), r = F ? F.parse(val.f) : { state: {}, dropped: [val.f], errors: [] };
        if (r.errors && r.errors.length) warnings.push(...r.errors.map(e => warn('FILTER_REMOVED', { reason: e.code })));
        if (r.dropped && r.dropped.length) warnings.push(warn('FILTER_REMOVED', { count: r.dropped.length }));
        const values = {}, s0 = r.state || {};
        for (const k of Object.keys(s0)) {
          const k2 = aliases.filterFields[k] || k;
          if (FILTER_SHARE_POLICY.personalKeys.includes(k2)) { warnings.push(warn('FILTER_PERSONAL_IGNORED', { key: k2 })); continue; }
          if (FILTER_SHARE_POLICY.customerDerivedKeys.includes(k2) && !FILTER_SHARE_POLICY.allowCustomerDerivedFilters) { warnings.push(warn('FILTER_SENSITIVE_IGNORED', { key: k2 })); continue; }
          if (k2 === FILTER_SHARE_POLICY.freeTextKey && !FILTER_SHARE_POLICY.freeTextPattern.test(String(s0[k]))) { warnings.push(warn('FILTER_FREE_TEXT_IGNORED')); continue; }
          values[k2] = s0[k];
        }
        if (Object.keys(values).length > SIZE_POLICY.maxFilterConditionCount) errors.push(warn('FILTER_TOO_MANY_CONDITIONS'));
        else if (Object.keys(values).length) st.filters = { filterSchemaVersion: F ? F.STATE_VERSION : 1, values };
      }
      if (val.sec) { if (route === 'COMPARE') st.comparison.activeSectionId = val.sec; else warnings.push(warn('PARAM_IRRELEVANT_TO_ROUTE', { key: 'sec' })); }
      if (val.step) { if (route === 'PRESENTATION') st.presentation.stepId = aliases.steps[val.step] || val.step; else warnings.push(warn('PARAM_IRRELEVANT_TO_ROUTE', { key: 'step' })); }
      const env = { schema: SCHEMA, version, context, route, resource: resourceOf(route, st), state: st, resourceMode: (ROUTE[route] || {}).resourceMode || 'LIVE' };
      if (val.s) {
        env.stateRef = val.s;
        const inlineBranches = Object.keys(st).filter(b => !['development', 'lot', 'comparison', 'presentation', 'ui'].includes(b));
        if (inlineBranches.length) { warnings.push(warn('STATE_AND_STATE_REF_CONFLICT', { branches: inlineBranches })); for (const b of inlineBranches) delete st[b]; }
      }
      const v = validate({ ...env, state: env.stateRef ? { development: st.development } : st }, { context });
      errors.push(...v.errors);
      const status = errors.length && !env.state.development ? 'INVALID' : (warnings.length || errors.length) ? 'VALID_WITH_WARNINGS' : 'VALID';
      const all = freeze({ status, envelope: env, warnings: freeze(warnings), errors: freeze(errors), migratedFromVersion, migrationSteps: steps, linkVersion: from, securityRejections: errors.filter(e => /PROTOTYPE|FORBIDDEN|PII|TOO_MANY|TOO_LONG|NESTING|ARRAY/.test(e.code)).length });
      return all;
    }

    /** serializeQuery(canonicalEnvelope) → [k=v] in registry order */
    function serializeQuery(env, ectx = {}) {
      const st = env.state, dev = st.development.developmentId, d = mapDefaults(dev), out = [], warnings = [];
      out.push('v=' + env.version);
      if (env.stateRef) { out.push('s=' + env.stateRef); return { parts: out, warnings }; }
      const m = st.map || {};
      if (m.baseMapMode) out.push('base=' + m.baseMapMode.toLowerCase());
      if (m.layerId) out.push('layer=' + encodeURIComponent(m.layerId));
      if (m.scoreKey) out.push('score=' + m.scoreKey);
      if (m.overlays) out.push('ov=' + (m.overlays.join(',') || '-'));
      if (st.filters) {
        const F = filterApi(), vals = {};
        for (const [k, v] of Object.entries(st.filters.values)) {
          if (FILTER_SHARE_POLICY.personalKeys.includes(k)) continue;
          if (FILTER_SHARE_POLICY.customerDerivedKeys.includes(k) && !FILTER_SHARE_POLICY.allowCustomerDerivedFilters) { warnings.push(warn('FILTER_SENSITIVE_OMITTED', { key: k })); continue; }
          if (k === FILTER_SHARE_POLICY.freeTextKey && !FILTER_SHARE_POLICY.freeTextPattern.test(String(v))) { warnings.push(warn('FILTER_FREE_TEXT_OMITTED')); continue; }
          if (typeof v === 'string' && scanValue(v).length) { warnings.push(warn('FILTER_PII_OMITTED', { key: k })); continue; }
          vals[k] = v;
        }
        if (F && Object.keys(vals).length) {
          const c = F.serializeChecked ? F.serializeChecked(vals, { maxLength: ectx.maxFilterLength || SIZE_POLICY.maxInlineLength }) : { ok: true, value: F.serialize(vals) };
          if (c.ok && c.value) out.push('f=' + encodeURIComponent(c.value)); else if (!c.ok) warnings.push(warn('FILTERS_TOO_LONG', { length: c.length }));
        }
      }
      if (m.viewport) out.push(`vp=${m.viewport.centerX},${m.viewport.centerY},${m.viewport.zoom}`);
      if (st.comparison && st.comparison.activeSectionId) out.push('sec=' + st.comparison.activeSectionId);
      if (st.presentation && st.presentation.stepId) out.push('step=' + st.presentation.stepId);
      return { parts: out, warnings };
    }
    function pathOf(env) {
      const st = env.state, dev = st.development.developmentId;
      if (env.route === 'LOT' && st.lot) { const u = st.ui || {}; const suf = u.panel === 'details' ? '.' + (u.detailSection || 'summary') : PANEL_SUFFIX[u.panel] ? '.' + PANEL_SUFFIX[u.panel] : ''; return `${dev}.lots.${st.lot.selectedLotId}${suf}`; }
      if (env.route === 'COMPARE' && st.comparison) return `${dev}.compare.${st.comparison.candidateLotIds.join('~')}`;
      if (env.route === 'PRESENTATION' && st.presentation) return `${dev}.presentation.${st.presentation.snapshotId}`;
      return dev;
    }
    /** encode(envelope, { context, base }) → { ok, hash, link, length, warnings, errors, envelope (canonical) }
        Sensitive branches (customer, journey) are never inline: the caller must create a stateRef first (LinkStateService). */
    function encode(env, ectx = {}) {
      const context = ectx.context || env.context || 'INTERNAL';
      if (context === 'SHARE_ENTRY') return freeze({ ok: false, errors: [warn('USE_SHARE_SERVICE')], warnings: [] });
      const dev = env.state && env.state.development && env.state.development.developmentId;
      if (!dev || !ID.development.test(dev)) return freeze({ ok: false, errors: [warn('INVALID_DEVELOPMENT_ID')], warnings: [] });
      const c = canonicalize({ ...env, context, version: version }, { mapDefaults: mapDefaults(dev), shareableOverlay: shareableOverlay(dev) });
      const v = validate(c.stateRef ? { ...c, state: { development: c.state.development } } : c, { context });
      if (!v.ok) return freeze({ ok: false, errors: v.errors, warnings: v.warnings, envelope: c });
      const q = serializeQuery(c, ectx), hash = '#' + pathOf(c) + '?' + q.parts.join('&');
      if (hash.length > SIZE_POLICY.maxInlineLength + 200) return freeze({ ok: false, errors: [warn('LINK_TOO_LONG', { length: hash.length })], warnings: q.warnings, envelope: c, overflow: true });
      const base = ectx.base != null ? String(ectx.base).replace(/#.*$/, '') : '';
      return freeze({ ok: true, hash, link: base ? base + hash : hash, length: hash.length, warnings: freeze(q.warnings), errors: freeze([]), envelope: c });
    }
    return freeze({ version, aliases, decode, encode, canonicalize: (env, x = {}) => canonicalize(env, { mapDefaults: mapDefaults(env.state.development.developmentId), shareableOverlay: shareableOverlay(env.state.development.developmentId), ...x }), validate, pathOf });
  }

  // ---------------------------------------------------------------- ShareEntryStatePolicy (topic 42 boundary)
  /** A share URL carries ONLY /s/<token> (topic 42 validateShareUrl). Anything else that reaches a share entry
      (query/fragment appended by someone, in-page navigation request) is an untrusted request validated here against the
      ShareEntryPoint scope. It can narrow the view inside the grant; it can never widen it. */
  const SHARE_ENTRY_KEYS = freeze({ step: 'step', lot: 'lotRef', lotRef: 'lotRef', sec: 'comparisonSection', comparisonSection: 'comparisonSection', vp: 'mapViewportPreset', mapViewportPreset: 'mapViewportPreset' });
  function shareEntryState(request, scope = {}) {
    const out = plainObject(), rejected = [], warnings = [];
    const entries = request instanceof Map ? [...request] : typeof request === 'string' ? (/[?#]/.test(request) ? request.slice(request.search(/[?#]/) + 1) : request).split('&').filter(Boolean).map(p => { const i = p.indexOf('='); const d = decodeOnce(i < 0 ? '' : p.slice(i + 1)); return [i < 0 ? p : p.slice(0, i), d.ok ? d.value : null]; }) : Object.entries(request || {});
    if (entries.length > 8) return freeze({ ok: false, state: null, rejected: [warn('TOO_MANY_PARAMS')], warnings, startAtDefault: true });
    for (const [k, v] of entries) {
      if (isUnsafeKey(k)) { rejected.push(warn('PROTOTYPE_POLLUTION_REJECTED')); continue; }
      const key = SHARE_ENTRY_KEYS[k];
      if (!key) { rejected.push(warn(FORBIDDEN_KEY.test(k) || /id$|ids$|price|preco|availability|revision|version|customer|cliente|journey|resource|scope|grant/i.test(k) ? 'SCOPE_EXPANSION_REJECTED' : 'UNKNOWN_PARAM', { key: /^[a-z0-9]{1,16}$/i.test(k) ? k : '[?]' })); continue; }
      if (v == null || scanValue(v).length) { rejected.push(warn('PII_REJECTED', { key })); continue; }
      const one = App.share && App.share.domain ? App.share.domain.validateInitialViewState({ [key]: v }, { lotRefs: scope.allowedLotRefs, stepIds: scope.allowedStepIds }) : { ok: false, code: 'SHARE_DOMAIN_UNAVAILABLE' };
      if (!one.ok) {
        if (key === 'step') warnings.push(warn('PRESENTATION_STEP_NOT_FOUND', { fallback: scope.startStepId || null }));
        else if (key === 'lotRef') rejected.push(warn('LOT_OUT_OF_SCOPE'));
        else rejected.push(warn('VIEW_STATE_INVALID', { key }));
        continue;
      }
      if (key === 'comparisonSection' && scope.allowedComparisonSections && !scope.allowedComparisonSections.includes(v)) { rejected.push(warn('VIEW_STATE_INVALID', { key })); continue; }
      out[key] = v;
    }
    const startAtDefault = !out.step;
    if (!out.step && scope.startStepId) out.step = scope.startStepId;
    return freeze({ ok: rejected.length === 0, state: freeze({ ...out }), rejected: freeze(rejected), warnings: freeze(warnings), startAtDefault });
  }

  // ---------------------------------------------------------------- legacy route inventory (what existed before topic 43)
  const LEGACY_ROUTE_INVENTORY = freeze([
    { location: 'state/store.js App.router.parse/token/write (replaceState em cada render)', routePattern: '#<dev>[.lots.<code>[.<seção>|.simular|.sol]|.compare.<c>~<c>][?base&layer&score&ov&f]', params: ['base', 'layer', 'score', 'ov', 'f'], purpose: 'INTERNAL_NAV', exposesPII: false, exposesInternalState: false, restorable: true, canonicalizable: true, migrationAction: 'MIGRATE', severity: 'LOW', notes: 'Gramática preservada como v0; v1 acrescenta v, s, vp, sec, step. Filtros de aderência (ft/fc/fq) e texto livre (tx) deixam de ir para a URL.' },
    { location: 'presentation/app.js boot (hashDev = location.hash.split(".")[0]) e listener hashchange', routePattern: '#<dev>…', params: [], purpose: 'INTERNAL_NAV', exposesPII: false, exposesInternalState: false, restorable: true, canonicalizable: true, migrationAction: 'MIGRATE', severity: 'LOW', notes: 'Trocar router.parse por App.deeplink.restoration.restore (receita no relatório).' },
    { location: 'presentation/app.js shareLink() → services/share.js deepLink(dev.shareUrl, token)', routePattern: '<shareUrl>#<dev>.lots.<code> | #<dev>.compare.<c>~<c>', params: [], purpose: 'INTERNAL_NAV', exposesPII: false, exposesInternalState: false, restorable: true, canonicalizable: true, migrationAction: 'REPLACE', severity: 'LOW', notes: '"Copiar link" passa a usar LinkStateService.copyLink (extractor allow-list); continua interno. Compartilhar com cliente = ShareService.' },
    { location: 'compare/comparisonDomain.js deepLinkToken/parseDeepLink/sharePayload', routePattern: '#<dev>.compare.<c>~<c>', params: [], purpose: 'INTERNAL_NAV', exposesPII: false, exposesInternalState: false, restorable: true, canonicalizable: true, migrationAction: 'KEEP', severity: 'LOW', notes: 'Mesma gramática do codec (teste de paridade).' },
    { location: 'presentation/app.js devSel (location.hash = devId; reload)', routePattern: '#<dev>', params: [], purpose: 'INTERNAL_NAV', exposesPII: false, exposesInternalState: false, restorable: true, canonicalizable: true, migrationAction: 'KEEP', severity: 'LOW', notes: 'Rota MAP pura.' },
    { location: 'presentation/app.js ensureBackMarker/popstate (history.pushState({vjBack:1}) no mobile)', routePattern: 'mesma URL', params: [], purpose: 'TEMP_STATE', exposesPII: false, exposesInternalState: false, restorable: false, canonicalizable: false, migrationAction: 'KEEP', severity: 'LOW', notes: 'Marcador de "voltar" do mobile (tópico 21). NavigationCoordinator não empilha entradas em telas pequenas enquanto ele existir (decisão).' },
    { location: 'services/share.js whatsappUrl (wa.me/?text=)', routePattern: 'https://wa.me/?text=…', params: ['text'], purpose: 'EXTERNAL_SHARE', exposesPII: true, exposesInternalState: false, restorable: false, canonicalizable: false, migrationAction: 'REPLACE', severity: 'MEDIUM', notes: 'Já inventariado no tópico 42 (nome do cliente no texto). Fora do escopo do codec.' },
    { location: 'share/shareDomain.js shareUrl (/s/<token>)', routePattern: '<origin>/s/<token>', params: [], purpose: 'EXTERNAL_SHARE', exposesPII: false, exposesInternalState: false, restorable: true, canonicalizable: true, migrationAction: 'KEEP', severity: 'LOW', notes: 'Fronteira do tópico 42. Nenhum parâmetro; estado inicial vem do ShareEntryPoint. Parâmetros anexados são validados por shareEntryState e nunca ampliam o escopo.' },
    { location: 'state/store.js localStorage ws:<dev>:state (preferências + sessão)', routePattern: null, params: [], purpose: 'TEMP_STATE', exposesPII: false, exposesInternalState: false, restorable: true, canonicalizable: false, migrationAction: 'KEEP', severity: 'LOW', notes: 'Deep link ≠ localStorage: reload restaura a URL; o resto vem das preferências locais.' }
  ].map(freeze));
  /** parameters that are deprecated (no longer written) — still read in INTERNAL for backward compatibility, with a warning */
  const DEPRECATED_PARAMS = freeze([
    { param: 'f → ft/fc/fq (aderência ao cliente)', reason: 'derivado do perfil do cliente (orçamento/preferências)', action: 'não é mais escrito; ignorado na leitura (FILTER_SENSITIVE_IGNORED)' },
    { param: 'f → tx (texto livre)', reason: 'texto livre pode conter nome/telefone', action: 'só código de lote (ex.: B79) é escrito/lido' },
    { param: 'f → fv (só favoritos)', reason: 'conjunto pessoal', action: 'nunca foi escrito; ignorado na leitura' }
  ]);

  // ---------------------------------------------------------------- observability (topic 44/45 boundary: names only, no aggregation here)
  const EVENTS = freeze(['deep_link_opened', 'deep_link_restored', 'deep_link_partial_restore', 'internal_link_copied', 'saved_view_opened']);
  const METRICS = freeze(['deep_link_decode_failure_count', 'deep_link_partial_restore_count', 'deep_link_unsupported_version_count', 'state_ref_lookup_latency', 'state_ref_expired_count', 'link_restore_latency', 'link_security_rejection_count']);

  const defaultCodec = createCodec();
  return freeze({ SCHEMA, CURRENT_VERSION, DeepLinkContext, AppRouteCode, ResourceType, DecodeStatus, PrivacyClass, PersistenceClass, ResourceMode, ReproducibilityClass, LinkIntent, ErrorState, MESSAGES,
    ROUTES, ROUTE, SIZE_POLICY, FILTER_SHARE_POLICY, COMPARISON_SECTIONS, FIELDS, FIELD, BRANCHES, BRANCH_KEYS, ID, ALIASES, aliasRegistry, MIGRATIONS, UNSAFE_KEYS, FORBIDDEN_KEY, VALUE_PATTERNS, scanValue,
    validate, canonicalize: defaultCodec.canonicalize, createCodec, decode: defaultCodec.decode, encode: defaultCodec.encode, pathOf: defaultCodec.pathOf, shareEntryState, SHARE_ENTRY_KEYS,
    LEGACY_ROUTE_INVENTORY, DEPRECATED_PARAMS, EVENTS, METRICS });
})();
