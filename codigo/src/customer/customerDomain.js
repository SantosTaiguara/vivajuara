/* customer/customerDomain.js — topic 39: Customer as a canonical, private, tenant-scoped entity.
   Customer (aggregate root) · CustomerType · lifecycle (administrative, never a sales stage) · person/organization details ·
   CustomerContactPoint (+ conservative normalization, verification ≠ presence) · CustomerCommunicationPreference (consent is
   recorded, never inferred) · CustomerPrivacyProfile · CustomerAssignment (≠ RBAC) · CustomerAccessDecision ·
   CustomerExternalRef + authority modes + field authority · CustomerPreferenceProfile / immutable versions / snapshot ·
   duplicate detection (SUGGEST_ONLY) · merge + alias · projections/redaction · domain events without PII · ingestion ·
   anonymization foundation · Fit / Recommendation / Favorites / Comparison integration refs.

   Rules: USER ≠ CUSTOMER. IDs are opaque and never PII. No PII in URLs, logs, events, analytics or share links.
   Unknown budget is null (never 0). UNDECIDED ≠ UNKNOWN. A system suggestion never becomes an active preference.
   A preference never becomes a hard constraint. Nothing here recalculates Fit, Recommendation, scores, prices or
   availability: it only builds the inputs (through App.fit.buildProfile, unchanged) and keeps the references.
   Browser copies are convenience only; the frontend is never the authority (deny by default). */
App.customer = App.customer || {};
App.customer.domain = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const CustomerType = E('PERSON', 'ORGANIZATION');
  const LifecycleStatus = E('ACTIVE', 'ARCHIVED', 'MERGED', 'DELETED');
  const ContactPointType = E('PHONE', 'WHATSAPP', 'EMAIL', 'OTHER');
  const VerificationStatus = E('UNVERIFIED', 'VERIFIED', 'INVALID', 'UNKNOWN');
  const ContactLifecycle = E('ACTIVE', 'INACTIVE', 'BOUNCED', 'REVOKED');
  const NormalizationStatus = E('NORMALIZED', 'UNPARSEABLE', 'NOT_APPLICABLE');
  const CommunicationChannel = E('WHATSAPP', 'SMS', 'EMAIL', 'PHONE', 'OTHER');
  const ConsentStatus = E('GRANTED', 'DENIED', 'REVOKED', 'UNKNOWN', 'NOT_REQUIRED_BY_POLICY');
  const DataClassification = E('STANDARD_PII', 'RESTRICTED_PII');
  const AssignmentRole = E('OWNER', 'COLLABORATOR', 'VIEWER');
  const AssignmentStatus = E('ACTIVE', 'ENDED');
  const AssigneeType = E('USER', 'TEAM');
  const AccessLevel = E('NONE', 'SUMMARY', 'STANDARD', 'FULL');
  const AuthorityMode = E('INTERNAL_MASTER', 'EXTERNAL_MASTER', 'HYBRID', 'REFERENCE_ONLY');
  const FieldAuthority = E('INTERNAL', 'EXTERNAL', 'MERGE', 'MANUAL_REVIEW');
  const SyncStatus = E('NEVER_SYNCED', 'SYNCED', 'PENDING', 'FAILED', 'CONFLICT');
  const Objective = E('LIVE', 'INVEST', 'LIVE_OR_INVEST', 'UNDECIDED');
  const PreferenceSource = E('CUSTOMER_EXPLICIT', 'BROKER_RECORDED', 'IMPORTED', 'SYSTEM_SUGGESTED_UNCONFIRMED');
  const BudgetDataState = E('PROVIDED', 'NEEDS_CONFIRMATION', 'UNKNOWN', 'NOT_AVAILABLE');
  const DuplicateSignal = E('SAME_NORMALIZED_PHONE', 'SAME_NORMALIZED_EMAIL', 'SAME_EXTERNAL_REF', 'SIMILAR_NAME', 'SAME_NAME_AND_CONTACT_FRAGMENT');
  const DuplicateStatus = E('OPEN', 'CONFIRMED_DUPLICATE', 'NOT_DUPLICATE', 'MERGED');
  const ProjectionMode = E('SUMMARY', 'STANDARD', 'FULL', 'CLIENT_SAFE', 'TECHNICAL');
  const ContextSource = E('CUSTOMER_LIST', 'SEARCH', 'DEEP_LINK', 'RECOMMENDATION', 'RESTORE');
  const EventType = E('CustomerCreated', 'CustomerUpdated', 'CustomerArchived', 'CustomerAssignmentChanged', 'CustomerContactAdded', 'CustomerContactUpdated',
    'CustomerPreferenceProfileUpdated', 'CustomerDuplicateDetected', 'CustomerMerged', 'CustomerExternalRefLinked', 'CommunicationPreferenceChanged', 'CustomerAnonymized');
  const Errors = E('MISSING_ORGANIZATION', 'INVALID_TYPE', 'MISSING_FIELD', 'PII_AS_ID', 'INVALID_ID', 'CONTACT_REQUIRED', 'DUPLICATE_WARNING', 'INVALID_CONTACT_TYPE',
    'EMPTY_CONTACT', 'INVALID_CHANNEL', 'INVALID_CONSENT', 'INVALID_ROLE', 'INVALID_ASSIGNEE', 'AUTHORITY_MODE_REQUIRED', 'INVALID_AUTHORITY_MODE', 'MISSING_EXTERNAL_ID',
    'INVALID_OBJECTIVE', 'UNSUPPORTED_PREFERENCE', 'DUPLICATE_PREFERENCE', 'INVALID_IMPORTANCE', 'INVALID_SOURCE', 'UNSUPPORTED_CONSTRAINT', 'INVALID_MONEY',
    'CUSTOMER_REVISION_CONFLICT', 'CROSS_TENANT', 'MERGE_SAME_CUSTOMER', 'MERGE_INVALID_STATE', 'PROFILE_DECISION_REQUIRED', 'EXTERNAL_REF_CONFLICT', 'NOT_FOUND',
    'CONTACT_SEARCH_NOT_ALLOWED', 'REASON_REQUIRED', 'IMMUTABLE_VERSION');
  const MESSAGES = Object.freeze({
    MISSING_FIELD: 'Informe o nome do cliente.', CONTACT_REQUIRED: 'Esta organização exige ao menos um contato.',
    DUPLICATE_WARNING: 'Pode existir um cadastro parecido. Confira antes de continuar.', CUSTOMER_REVISION_CONFLICT: 'O cadastro mudou desde que foi aberto. Recarregue e revise.',
    PROFILE_DECISION_REQUIRED: 'Os cadastros têm perfis diferentes: escolha qual perfil manter.', EXTERNAL_REF_CONFLICT: 'Os cadastros apontam para registros diferentes no CRM: decida antes de unir.',
    POTENTIAL_DUPLICATE_REQUIRES_REVIEW: 'Possível cadastro duplicado: requer revisão.', NOT_FOUND: 'Cliente não encontrado ou sem acesso.', CONTACT_SEARCH_NOT_ALLOWED: 'Busca por telefone ou e-mail exige permissão de contato.'
  });
  const SCHEMA_VERSION = 'customer-profile/1';
  const cfgRoot = () => (App.configs && App.configs.customer && App.configs.customer.policy) || {};
  /** org policy (creation, duplicates, offline, retention ref): organization override over defaults */
  function policyOf(orgId) {
    const c = cfgRoot(), d = c.defaults || {}, o = (c.organizations || {})[orgId] || {};
    return Object.freeze({ ...d, ...o, creationPolicy: Object.freeze({ ...(d.creationPolicy || {}), ...(o.creationPolicy || {}) }), duplicatePolicy: Object.freeze({ mode: 'SUGGEST_ONLY', nameSimilarityThreshold: 0.8, ...(d.duplicatePolicy || {}), ...(o.duplicatePolicy || {}) }),
      offlinePolicy: Object.freeze({ allowSummaryCache: false, allowContactCache: false, allowProfileCache: false, allowNotesCache: false, ...(d.offlinePolicy || {}), ...(o.offlinePolicy || {}) }) });
  }
  const checksum = v => App.methodology.checksum(v);
  const nowIso = now => new Date(now == null ? Date.now() : now).toISOString();
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  const plain = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  let seq = 0;
  function rand() { try { const c = (typeof crypto !== 'undefined' && crypto) || null; if (c && c.getRandomValues) { const a = new Uint32Array(2); c.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); } } catch (_) { /* no crypto */ } return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); }
  /** opaque id: never built from name/phone/email/CPF */
  const newId = (prefix, opts = {}) => opts.idGen ? opts.idGen(prefix) : `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}${rand()}`;
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/;
  const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  /** true when a string looks like contact data or a document number (email, ≥8 digits in a row ignoring separators, CPF/CNPJ masks) */
  function looksLikePII(s) {
    if (typeof s !== 'string') return false;
    if (EMAIL_RE.test(s)) return true;
    if (/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(s)) return true;
    return /\d{8,}/.test(s.replace(/[\s().+\-/]/g, ''));
  }
  const PII_KEY = /^(name|nome|displayname|fullname|firstname|lastname|preferredname|legalname|tradename|customername|email|e-mail|phone|telefone|whatsapp|cpf|cnpj|rg|document|registrationref|address|endereco|value|normalizedvalue|text|note|notes|message|body|transcript|budget|income|renda|query|q)$/i;
  /** redactPII(obj) → copy without PII keys and with PII-looking strings masked (logs, events, analytics, conflicts) */
  function redactPII(obj) {
    if (Array.isArray(obj)) return obj.map(redactPII);
    if (obj && typeof obj === 'object') { const o = {}; for (const [k, v] of Object.entries(obj)) { if (PII_KEY.test(k)) continue; o[k] = redactPII(v); } return o; }
    return typeof obj === 'string' && looksLikePII(obj) ? '[redacted]' : obj;
  }
  /** safe log line: ids + operation + status + correlation only */
  const logEntry = (operation, { customerId = null, status = 'OK', correlationId = null, codes = [] } = {}) => Object.freeze({ operation, customerId, status, correlationId, codes: Object.freeze([...codes]) });
  /** domain event: ids and codes only (PII keys are dropped, PII-looking strings masked) */
  function event(type, data = {}, opts = {}) {
    if (!EventType[type]) throw Object.assign(new Error('evento desconhecido: ' + type), { code: 'UNKNOWN_EVENT' });
    return deepFreeze({ id: newId('cev', opts), type, occurredAt: nowIso(opts.now), ...redactPII(data) });
  }
  const fail = (code, extra = {}) => Object.freeze({ ok: false, code, message: MESSAGES[code] || code, ...extra });
  const normText = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  // ------------------------------------------------------------------ contact normalization (conservative; never "fixes" a value)
  /** normalizePhone(raw, country) → { status, normalizedValue? } — E.164 when the number is unambiguous, else UNPARSEABLE */
  function normalizePhone(raw, country = 'BR') {
    const s = String(raw == null ? '' : raw).trim();
    if (!s || /[a-z]/i.test(s) || !/^\+?[\d\s().-]+$/.test(s)) return { status: NormalizationStatus.UNPARSEABLE };
    const plus = s.startsWith('+'), d = s.replace(/\D/g, '');
    const br = n => { // n = national digits (DDD + number)
      if (!/^[1-9][1-9]/.test(n)) return null;
      if (n.length === 11 && n[2] === '9') return '+55' + n;
      if (n.length === 10 && /[2-5]/.test(n[2])) return '+55' + n;
      return null;
    };
    let e164 = null;
    if (plus) { if (d.startsWith('55')) e164 = br(d.slice(2)); else if (d.length >= 8 && d.length <= 15 && d[0] !== '0') e164 = '+' + d; }
    else if (country === 'BR') e164 = d.length >= 12 && d.startsWith('55') ? br(d.slice(2)) : br(d);
    return e164 ? { status: NormalizationStatus.NORMALIZED, normalizedValue: e164 } : { status: NormalizationStatus.UNPARSEABLE };
  }
  /** normalizeEmail(raw) — trims and lower-cases the domain only; malformed → UNPARSEABLE (kept as typed) */
  function normalizeEmail(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { status: NormalizationStatus.UNPARSEABLE };
    const at = s.lastIndexOf('@');
    return { status: NormalizationStatus.NORMALIZED, normalizedValue: s.slice(0, at) + '@' + s.slice(at + 1).toLowerCase() };
  }
  const matchKeyOf = c => c && c.normalizedValue ? (c.type === 'EMAIL' ? 'E:' + c.normalizedValue.toLowerCase() : c.type === 'OTHER' ? null : 'P:' + c.normalizedValue) : null;
  /** maskContact(c) — STANDARD projection: last digits / first letter + domain only */
  function maskContact(c) {
    if (!c || c.value == null) return null;
    if (c.type === 'EMAIL') { const v = c.normalizedValue || c.value, at = v.lastIndexOf('@'); return at > 0 ? v[0] + '•••@' + v.slice(at + 1) : '•••'; }
    const d = String(c.normalizedValue || c.value).replace(/\D/g, ''); return d.length >= 4 ? '•••• ' + d.slice(-4) : '••••';
  }

  // ------------------------------------------------------------------ Customer
  /** createCustomer(input, opts) → { ok, customer, details, contactPoints, communicationPreferences, privacyProfile, assignments, duplicateWarnings, events } */
  function createCustomer(input = {}, opts = {}) {
    const orgId = opts.organizationId || input.organizationId, pol = policyOf(orgId), now = nowIso(opts.now), actor = opts.actorId || null;
    if (!orgId || !ID_RE.test(orgId)) return fail(Errors.MISSING_ORGANIZATION);
    const type = input.type || CustomerType.PERSON; if (!CustomerType[type]) return fail(Errors.INVALID_TYPE);
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
    for (const f of pol.creationPolicy.minimumFields || []) if (f === 'displayName' ? !displayName : input[f] == null) return fail(Errors.MISSING_FIELD, { field: f });
    if (input.id != null) { if (typeof input.id !== 'string' || !ID_RE.test(input.id)) return fail(Errors.INVALID_ID); if (looksLikePII(input.id)) return fail(Errors.PII_AS_ID); }
    const contactsIn = (input.contacts || []).filter(c => c && c.value != null && String(c.value).trim());
    if (pol.creationPolicy.requireContactPoint && !contactsIn.length) return fail(Errors.CONTACT_REQUIRED);
    const id = input.id || newId('cus', opts);
    const customer = { id, organizationId: orgId, type, displayName, lifecycleStatus: LifecycleStatus.ACTIVE, currentPreferenceProfileVersionId: undefined, privacyProfileId: undefined,
      externalRefs: [], createdAt: now, updatedAt: now, createdBy: actor, updatedBy: undefined, recordRevision: 1, metadata: input.metadata ? redactPII(input.metadata) : undefined };
    const details = type === 'PERSON'
      ? { customerId: id, firstName: input.firstName || undefined, lastName: input.lastName || undefined, preferredName: input.preferredName || undefined, locale: input.locale || undefined }
      : { customerId: id, legalName: input.legalName || undefined, tradeName: input.tradeName || undefined, registrationRef: input.registrationRef || undefined, contactPersonCustomerId: input.contactPersonCustomerId || undefined };
    const contactPoints = [], errors = [];
    for (const c of contactsIn) { const r = newContactPoint(customer, c, { ...opts, isPrimary: !contactPoints.some(x => x.type === c.type) && c.isPrimary !== false }); if (r.ok) contactPoints.push(r.contact); else errors.push(r.code); }
    const privacy = createPrivacyProfile(customer, { ...opts, dataClassification: input.dataClassification || pol.dataClassificationDefault || DataClassification.STANDARD_PII });
    customer.privacyProfileId = privacy.id;
    const assignments = input.ownerUserId ? [assign(customer, { assigneeType: 'USER', assigneeId: input.ownerUserId, role: 'OWNER' }, opts).assignment].filter(Boolean) : [];
    // duplicate check (same tenant only); never blocks unless the org says so
    let duplicateWarnings = [];
    if (pol.creationPolicy.duplicateCheckRequired && opts.existing) {
      const cands = detectDuplicates({ customers: [customer, ...opts.existing.customers || []], contacts: [...contactPoints, ...(opts.existing.contacts || [])], externalRefs: [] }, { organizationId: orgId, only: id, now: opts.now, idGen: opts.idGen });
      duplicateWarnings = cands.map(c => duplicateWarning(c, id, opts.isVisible || (() => false)));
      if (duplicateWarnings.length && !pol.creationPolicy.allowCreateWithDuplicateWarning) return fail(Errors.DUPLICATE_WARNING, { duplicateWarnings });
    }
    const events = [event('CustomerCreated', { organizationId: orgId, customerId: id, customerType: type, contactCount: contactPoints.length }, opts),
      ...contactPoints.map(c => event('CustomerContactAdded', { organizationId: orgId, customerId: id, contactPointId: c.id, contactType: c.type }, opts)),
      ...assignments.map(a => event('CustomerAssignmentChanged', { organizationId: orgId, customerId: id, assignmentId: a.id, role: a.role }, opts))];
    return deepFreeze({ ok: true, customer, details, contactPoints, communicationPreferences: [], privacyProfile: privacy, assignments, duplicateWarnings, events, errors });
  }
  /** updateCustomer(customer, patch, { expectedRevision }) — optimistic concurrency; id/org/createdAt are immutable */
  function updateCustomer(customer, patch = {}, opts = {}) {
    if (opts.expectedRevision == null || opts.expectedRevision !== customer.recordRevision) return fail(Errors.CUSTOMER_REVISION_CONFLICT, { currentRevision: customer.recordRevision });
    if (customer.lifecycleStatus === 'MERGED' || customer.lifecycleStatus === 'DELETED') return fail(Errors.MERGE_INVALID_STATE);
    const next = { ...plain(customer) }, changed = [];
    if (patch.displayName != null) { const n = String(patch.displayName).trim().replace(/\s+/g, ' ').slice(0, 120); if (!n) return fail(Errors.MISSING_FIELD, { field: 'displayName' }); if (n !== next.displayName) { next.displayName = n; changed.push('displayName'); } }
    if (patch.currentPreferenceProfileVersionId !== undefined && patch.currentPreferenceProfileVersionId !== next.currentPreferenceProfileVersionId) { next.currentPreferenceProfileVersionId = patch.currentPreferenceProfileVersionId; changed.push('currentPreferenceProfileVersionId'); }
    if (patch.externalRefs) { next.externalRefs = plain(patch.externalRefs); changed.push('externalRefs'); }
    if (patch.lifecycleStatus && patch.lifecycleStatus !== next.lifecycleStatus) { if (!LifecycleStatus[patch.lifecycleStatus]) return fail(Errors.MERGE_INVALID_STATE); next.lifecycleStatus = patch.lifecycleStatus; changed.push('lifecycleStatus'); }
    if (patch.mergedIntoCustomerId) { next.mergedIntoCustomerId = patch.mergedIntoCustomerId; changed.push('mergedIntoCustomerId'); }
    if (!changed.length) return Object.freeze({ ok: true, customer, unchanged: true, events: [] });
    next.recordRevision = customer.recordRevision + 1; next.updatedAt = nowIso(opts.now); next.updatedBy = opts.actorId || null;
    return deepFreeze({ ok: true, customer: next, changed, events: [event(patch.lifecycleStatus === 'ARCHIVED' ? 'CustomerArchived' : 'CustomerUpdated', { organizationId: customer.organizationId, customerId: customer.id, changedFields: changed }, opts)] });
  }
  const archive = (customer, opts = {}) => updateCustomer(customer, { lifecycleStatus: LifecycleStatus.ARCHIVED }, opts);

  // ------------------------------------------------------------------ contact points, consent, privacy
  function newContactPoint(customer, input = {}, opts = {}) {
    if (!ContactPointType[input.type]) return fail(Errors.INVALID_CONTACT_TYPE);
    const value = String(input.value == null ? '' : input.value).trim(); if (!value) return fail(Errors.EMPTY_CONTACT);
    const n = input.type === 'EMAIL' ? normalizeEmail(value) : input.type === 'OTHER' ? { status: NormalizationStatus.NOT_APPLICABLE } : normalizePhone(value, policyOf(customer.organizationId).defaultPhoneCountry || 'BR');
    const now = nowIso(opts.now);
    // presence ≠ verification: every new contact starts UNVERIFIED, even when it parses
    return deepFreeze({ ok: true, normalization: n.status, contact: { id: newId('ccp', opts), organizationId: customer.organizationId, customerId: customer.id, type: input.type, value, normalizedValue: n.normalizedValue, normalizationStatus: n.status,
      label: input.label || undefined, isPrimary: opts.isPrimary != null ? !!opts.isPrimary : !!input.isPrimary, verificationStatus: VerificationStatus.UNVERIFIED, lifecycleStatus: ContactLifecycle.ACTIVE, createdAt: now, updatedAt: now } });
  }
  const addContactPoint = (customer, input, opts = {}) => { const r = newContactPoint(customer, input, opts); return r.ok ? Object.freeze({ ...r, events: [event('CustomerContactAdded', { organizationId: customer.organizationId, customerId: customer.id, contactPointId: r.contact.id, contactType: r.contact.type }, opts)] }) : r; };
  /** setVerification(contact, status, { method }) — only an explicit verification changes it */
  function setVerification(contact, status, opts = {}) {
    if (!VerificationStatus[status]) return fail('INVALID_VERIFICATION');
    return deepFreeze({ ok: true, contact: { ...plain(contact), verificationStatus: status, verificationMethod: opts.method || undefined, updatedAt: nowIso(opts.now) }, events: [event('CustomerContactUpdated', { organizationId: contact.organizationId, customerId: contact.customerId, contactPointId: contact.id, verificationStatus: status }, opts)] });
  }
  /** setCommunicationPreference(customer, { channel, consentStatus, purposeCode, sourceRef }) — records a decision; never infers one */
  function setCommunicationPreference(customer, input = {}, opts = {}) {
    if (!CommunicationChannel[input.channel]) return fail(Errors.INVALID_CHANNEL);
    if (!ConsentStatus[input.consentStatus]) return fail(Errors.INVALID_CONSENT);
    const now = nowIso(opts.now), st = input.consentStatus;
    const rec = { id: newId('ccm', opts), organizationId: customer.organizationId, customerId: customer.id, channel: input.channel, consentStatus: st, purposeCode: input.purposeCode || undefined, sourceRef: input.sourceRef || undefined,
      grantedAt: st === 'GRANTED' ? now : undefined, revokedAt: st === 'REVOKED' ? now : undefined, updatedAt: now, recordedBy: opts.actorId || undefined };
    return deepFreeze({ ok: true, preference: rec, events: [event('CommunicationPreferenceChanged', { organizationId: customer.organizationId, customerId: customer.id, channel: input.channel, consentStatus: st, purposeCode: input.purposeCode || null }, opts)] });
  }
  /** consentOf(prefs, channel, purposeCode?) → ConsentStatus — latest record for the channel(/purpose); none → UNKNOWN (a phone number is not consent) */
  function consentOf(prefs, channel, purposeCode) {
    const rel = (prefs || []).filter(p => p.channel === channel && (!purposeCode || !p.purposeCode || p.purposeCode === purposeCode)).sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    return rel.length ? rel[rel.length - 1].consentStatus : ConsentStatus.UNKNOWN;
  }
  const mayContact = (prefs, channel, purposeCode) => { const s = consentOf(prefs, channel, purposeCode); return s === 'GRANTED' || s === 'NOT_REQUIRED_BY_POLICY'; };
  function createPrivacyProfile(customer, opts = {}) {
    const now = nowIso(opts.now), pol = policyOf(customer.organizationId);
    return deepFreeze({ id: newId('cpp', opts), organizationId: customer.organizationId, customerId: customer.id, dataClassification: DataClassification[opts.dataClassification] ? opts.dataClassification : DataClassification.STANDARD_PII,
      retentionPolicyRef: pol.retentionPolicyRef || undefined, marketingCommunicationAllowed: undefined, dataExportRestriction: undefined, createdAt: now, updatedAt: now });
  }

  // ------------------------------------------------------------------ assignments (workflow ownership; never a substitute for RBAC)
  function assign(customer, input = {}, opts = {}) {
    if (!AssigneeType[input.assigneeType] || !input.assigneeId || !ID_RE.test(input.assigneeId)) return fail(Errors.INVALID_ASSIGNEE);
    if (!AssignmentRole[input.role]) return fail(Errors.INVALID_ROLE);
    const now = nowIso(opts.now), current = (opts.current || []).filter(a => a.customerId === customer.id && a.status === 'ACTIVE');
    const ended = input.role === 'OWNER' ? current.filter(a => a.role === 'OWNER').map(a => ({ ...plain(a), status: AssignmentStatus.ENDED, endedAt: now, reasonCode: 'OWNER_REPLACED' })) : [];
    const assignment = { id: newId('cas', opts), organizationId: customer.organizationId, customerId: customer.id, assigneeType: input.assigneeType, assigneeId: input.assigneeId, role: input.role, status: AssignmentStatus.ACTIVE, assignedAt: now, assignedBy: opts.actorId || null, reasonCode: input.reasonCode || undefined };
    return deepFreeze({ ok: true, assignment, ended, events: [event('CustomerAssignmentChanged', { organizationId: customer.organizationId, customerId: customer.id, assignmentId: assignment.id, role: input.role, endedAssignmentIds: ended.map(a => a.id) }, opts)] });
  }
  const endAssignment = (a, opts = {}) => deepFreeze({ ...plain(a), status: AssignmentStatus.ENDED, endedAt: nowIso(opts.now), reasonCode: opts.reasonCode || a.reasonCode });
  const activeAssignmentFor = (assignments, customerId, principal = {}) => (assignments || []).find(a => a.customerId === customerId && a.status === 'ACTIVE' &&
    ((a.assigneeType === 'USER' && a.assigneeId === principal.userId) || (a.assigneeType === 'TEAM' && (principal.teamIds || []).includes(a.assigneeId)))) || null;

  // ------------------------------------------------------------------ access decision: Tenant AND Permission AND Assignment AND Lifecycle
  /** permission checker over App.authz; keys that are not in the registry are denied (deny by default) */
  function canFromAuthz(authCtx, resource) {
    return key => { try { return !!(App.permissions && App.permissions.has(key) && App.authz.evaluate(authCtx || App.authz.context(), { permission: key, resource }).allowed); } catch (_) { return false; } };
  }
  /** static/device mode: only what the existing local customer list does (name, lots, profile) under customer_profile.manage; contacts never */
  const LOCAL_KEYS = Object.freeze(['customer.read', 'customer.create', 'customer.update', 'customer.archive', 'customer.profile.read', 'customer.profile.update']);
  function localDeviceCan(authCtx, resource) { const k = (cfgRoot().permissionCatalog || {}).localDeviceKey || 'customer_profile.manage', ok = canFromAuthz(authCtx, resource)(k); return key => ok && LOCAL_KEYS.includes(key); }
  /** decideAccess({ customer, principal: { userId, organizationId, teamIds }, assignments, can }) → CustomerAccessDecision */
  function decideAccess({ customer, principal = {}, assignments = [], can = () => false } = {}) {
    const D = (codes, extra = {}) => Object.freeze({ allowed: false, accessLevel: AccessLevel.NONE, reasonCodes: Object.freeze(codes), ...extra });
    if (!customer) return D(['NOT_FOUND']);
    if (!principal.organizationId || principal.organizationId !== customer.organizationId) return D(['NOT_FOUND']); // cross-tenant: indistinguishable from "does not exist"
    if (customer.lifecycleStatus === 'DELETED') return D(['CUSTOMER_DELETED']);
    if (customer.lifecycleStatus === 'MERGED') return D(['CUSTOMER_MERGED'], { canonicalCustomerId: customer.mergedIntoCustomerId || null });
    const perms = [], asg = activeAssignmentFor(assignments, customer.id, principal);
    if (can('customer.read')) perms.push('customer.read');
    else if (can('customer.readAssigned') && asg) perms.push('customer.readAssigned');
    else return D([can('customer.readAssigned') ? 'NOT_ASSIGNED' : 'NO_GRANT']);
    let level = AccessLevel.SUMMARY;
    if (can('customer.profile.read')) { level = AccessLevel.STANDARD; perms.push('customer.profile.read'); }
    if (level === AccessLevel.STANDARD && can('customer.contact.read') && can('customer.privacy.read')) { level = AccessLevel.FULL; perms.push('customer.contact.read', 'customer.privacy.read'); }
    const viewerOnly = asg && asg.role === 'VIEWER' && !can('customer.read');
    const write = customer.lifecycleStatus === 'ACTIVE' && can('customer.update') && !viewerOnly;
    return Object.freeze({ allowed: true, accessLevel: level, reasonCodes: Object.freeze(customer.lifecycleStatus === 'ARCHIVED' ? ['ALLOWED', 'ARCHIVED_READ_ONLY'] : ['ALLOWED']),
      assignmentRef: asg ? asg.id : undefined, permissionRefs: Object.freeze(perms), canWrite: write, canReadContacts: level === AccessLevel.FULL || (level === AccessLevel.STANDARD && can('customer.contact.read')) });
  }

  // ------------------------------------------------------------------ external refs and field authority
  function linkExternalRef(customer, input = {}, opts = {}) {
    if (!input.provider || !ID_RE.test(String(input.provider))) return fail('INVALID_PROVIDER');
    if (!input.externalId) return fail(Errors.MISSING_EXTERNAL_ID);
    if (!input.authorityMode) return fail(Errors.AUTHORITY_MODE_REQUIRED); // never chosen automatically
    if (!AuthorityMode[input.authorityMode]) return fail(Errors.INVALID_AUTHORITY_MODE);
    const clash = (customer.externalRefs || []).find(r => r.provider === input.provider && r.externalId !== String(input.externalId));
    if (clash && !opts.allowMultiplePerProvider) return fail(Errors.EXTERNAL_REF_CONFLICT, { provider: input.provider });
    if ((customer.externalRefs || []).some(r => r.provider === input.provider && r.externalId === String(input.externalId))) return Object.freeze({ ok: true, unchanged: true, customer, events: [] });
    const ref = { id: newId('cxr', opts), provider: String(input.provider), externalId: String(input.externalId), authorityMode: input.authorityMode, syncStatus: SyncStatus.NEVER_SYNCED, lastSyncedAt: undefined, metadata: input.metadata ? redactPII(input.metadata) : undefined };
    const r = updateCustomer(customer, { externalRefs: [...plain(customer.externalRefs || []), ref] }, { ...opts, expectedRevision: opts.expectedRevision != null ? opts.expectedRevision : customer.recordRevision });
    if (!r.ok) return r;
    return deepFreeze({ ok: true, customer: r.customer, ref, events: [event('CustomerExternalRefLinked', { organizationId: customer.organizationId, customerId: customer.id, provider: ref.provider, externalRefId: ref.id, authorityMode: ref.authorityMode }, opts)] });
  }
  /** fieldAuthority(policies, fieldPath, provider, authorityMode) → INTERNAL | EXTERNAL | MERGE | MANUAL_REVIEW */
  function fieldAuthority(policies, fieldPath, provider, mode) {
    const p = (policies || []).find(x => x.fieldPath === fieldPath && (!x.provider || x.provider === provider));
    if (mode === 'REFERENCE_ONLY' || mode === 'INTERNAL_MASTER') return p && mode === 'INTERNAL_MASTER' && p.authority === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL';
    if (mode === 'EXTERNAL_MASTER') return p ? p.authority : 'EXTERNAL';
    return p ? p.authority : 'MANUAL_REVIEW'; // HYBRID without a field policy: a person decides (no blind last-write-wins)
  }
  /** applyExternalChanges(customer, { provider, changes: { fieldPath: value } }, { policies }) → { applied, conflicts } — conflicts carry fingerprints, never values */
  function applyExternalChanges(customer, { provider, changes = {} } = {}, opts = {}) {
    const ref = (customer.externalRefs || []).find(r => r.provider === provider); if (!ref) return fail('EXTERNAL_REF_NOT_FOUND');
    const policies = opts.policies || policyOf(customer.organizationId).fieldAuthorityPolicies || [], applied = {}, conflicts = [];
    for (const [fieldPath, ext] of Object.entries(changes)) {
      const cur = fieldPath.split('.').reduce((o, k) => o == null ? o : o[k], customer), auth = fieldAuthority(policies, fieldPath, provider, ref.authorityMode);
      if (JSON.stringify(cur) === JSON.stringify(ext)) continue;
      if (auth === 'EXTERNAL') { applied[fieldPath] = ext; continue; }
      conflicts.push(Object.freeze({ id: newId('csc', opts), organizationId: customer.organizationId, customerId: customer.id, provider, fieldPath, internalValueFingerprint: checksum(cur == null ? null : cur), externalValueFingerprint: checksum(ext == null ? null : ext),
        authorityPolicy: auth + '/' + ref.authorityMode, status: auth === 'INTERNAL' ? 'AUTO_RESOLVED' : 'MANUAL_REVIEW', detectedAt: nowIso(opts.now) }));
    }
    return deepFreeze({ ok: true, applied, conflicts });
  }

  // ------------------------------------------------------------------ preference profile (versioned, immutable)
  const fitCfg = devId => { try { return App.fit.cfgOf(devId || 'viva-juara'); } catch (_) { return null; } };
  const recCfg = devId => { try { return App.recommendation.policyOf(devId || 'viva-juara'); } catch (_) { return null; } };
  function createPreferenceProfile(customer, opts = {}) {
    const now = nowIso(opts.now);
    return deepFreeze({ id: newId('cpf', opts), organizationId: customer.organizationId, customerId: customer.id, currentVersionId: undefined, status: 'ACTIVE', createdAt: now, updatedAt: now });
  }
  const IMPORTANCE = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
  function money(m, path, errors) {
    if (m == null) return undefined;
    const amount = typeof m === 'number' ? m : m.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { errors.push({ code: Errors.INVALID_MONEY, path, message: 'valor deve ser positivo; desconhecido é ausente (nunca 0)' }); return undefined; }
    return { amount, currency: (m && m.currency) || 'BRL' };
  }
  /** validateProfileInput(input, { developmentId }) → { errors, warnings, value } — supported criteria only; suggestions stay inactive */
  function validateProfileInput(input = {}, opts = {}) {
    const errors = [], warnings = [], fc = fitCfg(opts.developmentId), rc = recCfg(opts.developmentId), supported = fc ? Object.keys(fc.preferences) : [], consKeys = rc ? Object.keys(rc.constraints || {}) : [];
    if (input.objective != null && !Objective[input.objective]) errors.push({ code: Errors.INVALID_OBJECTIVE, path: 'objective' });
    const seen = new Set(), preferences = [];
    (input.preferences || []).forEach((p, i) => {
      const path = `preferences[${i}]`;
      if (!p || !supported.includes(p.key)) { errors.push({ code: Errors.UNSUPPORTED_PREFERENCE, path }); return; }
      if (seen.has(p.key)) { errors.push({ code: Errors.DUPLICATE_PREFERENCE, path }); return; } seen.add(p.key);
      if (!IMPORTANCE.includes(p.importance)) { errors.push({ code: Errors.INVALID_IMPORTANCE, path }); return; }
      const source = p.source || PreferenceSource.BROKER_RECORDED; if (!PreferenceSource[source]) { errors.push({ code: Errors.INVALID_SOURCE, path }); return; }
      let active = p.active !== false;
      if (source === 'SYSTEM_SUGGESTED_UNCONFIRMED' && active) { active = false; warnings.push({ code: 'SUGGESTION_NOT_ACTIVATED', path }); }
      preferences.push({ key: p.key, fieldKey: fc.preferences[p.key].fieldKey, target: p.target === undefined ? null : p.target, importance: p.importance, source, explicit: source === 'CUSTOMER_EXPLICIT' || source === 'BROKER_RECORDED', active });
    });
    const cseen = new Set(), hardConstraints = [];
    (input.hardConstraints || []).forEach((c, i) => {
      const path = `hardConstraints[${i}]`;
      if (!c || !consKeys.includes(c.key)) { errors.push({ code: Errors.UNSUPPORTED_CONSTRAINT, path }); return; }
      if (cseen.has(c.key)) { errors.push({ code: Errors.DUPLICATE_PREFERENCE, path }); return; } cseen.add(c.key);
      const source = c.source || PreferenceSource.BROKER_RECORDED; if (!PreferenceSource[source] || source === 'SYSTEM_SUGGESTED_UNCONFIRMED') { errors.push({ code: Errors.INVALID_SOURCE, path }); return; }
      if (c.value == null && !['IS_FALSE', 'IS_TRUE'].includes((rc.constraints[c.key] || {}).operator)) { errors.push({ code: Errors.MISSING_FIELD, path: path + '.value' }); return; }
      hardConstraints.push({ key: c.key, value: c.value === undefined ? true : c.value, source });
    });
    let budgetProfile;
    if (input.budgetProfile) {
      const b = input.budgetProfile, out = { currency: b.currency || 'BRL' };
      for (const k of ['targetPurchasePriceMin', 'targetPurchasePriceMax', 'maximumPurchasePrice', 'availableDownPayment', 'preferredMonthlyPaymentMax']) { const v = money(b[k], 'budgetProfile.' + k, errors); if (v) out[k] = v; }
      if (b.financingPreference) out.financingPreference = String(b.financingPreference).slice(0, 40);
      const any = ['targetPurchasePriceMin', 'targetPurchasePriceMax', 'maximumPurchasePrice', 'availableDownPayment', 'preferredMonthlyPaymentMax'].some(k => out[k]);
      out.dataState = BudgetDataState[b.dataState] ? b.dataState : any ? BudgetDataState.NEEDS_CONFIRMATION : BudgetDataState.UNKNOWN;
      if (!any && (out.dataState === 'PROVIDED' || out.dataState === 'NEEDS_CONFIRMATION')) out.dataState = BudgetDataState.UNKNOWN;
      if (b.recordedAt) out.recordedAt = b.recordedAt;
      budgetProfile = out;
    }
    return { errors, warnings, value: { objective: input.objective || undefined, preferences, hardConstraints, budgetProfile, hardConstraintsReviewed: !!input.hardConstraintsReviewed } };
  }
  /** completeness(version) → { ratio 0–1, answered[], missing[] } — how much of the profile is filled; NOT confidence */
  function completeness(v) {
    const items = ((cfgRoot().completeness || {}).items || [{ key: 'objective' }, { key: 'budget' }, { key: 'preferences' }, { key: 'hardConstraintsReviewed' }]).map(i => i.key);
    const has = { objective: !!(v && v.objective), budget: !!(v && v.budgetProfile && v.budgetProfile.dataState !== 'UNKNOWN'), preferences: !!(v && (v.preferences || []).some(p => p.active)), hardConstraintsReviewed: !!(v && (v.hardConstraintsReviewed || (v.hardConstraints || []).length)) };
    const answered = items.filter(k => has[k]), missing = items.filter(k => !has[k]);
    return Object.freeze({ ratio: items.length ? answered.length / items.length : 0, answered: Object.freeze(answered), missing: Object.freeze(missing) });
  }
  /** createProfileVersion({ profile, previous, input }, opts) → { ok, version, profile, unchanged?, warnings, events } — saved versions are frozen; changes create V(n+1) */
  function createProfileVersion({ profile, previous = null, input = {} } = {}, opts = {}) {
    const r = validateProfileInput(input, opts);
    if (r.errors.length) return Object.freeze({ ok: false, code: r.errors[0].code, errors: Object.freeze(r.errors), warnings: Object.freeze(r.warnings) });
    const body = { schemaVersion: SCHEMA_VERSION, ...plain(r.value) }, sum = checksum(body);
    if (previous && previous.checksum === sum) return Object.freeze({ ok: true, unchanged: true, version: previous, profile, warnings: Object.freeze(r.warnings), events: [] });
    const now = nowIso(opts.now), version = {
      id: newId('cpv', opts), organizationId: profile.organizationId, customerId: profile.customerId, profileId: profile.id, version: previous ? previous.version + 1 : 1, schemaVersion: SCHEMA_VERSION,
      objective: r.value.objective, preferences: r.value.preferences, hardConstraints: r.value.hardConstraints, budgetProfile: r.value.budgetProfile, hardConstraintsReviewed: r.value.hardConstraintsReviewed,
      profileCompleteness: null, sourceSummary: null, createdAt: now, createdBy: opts.actorId || null, checksum: sum, supersedesVersionId: previous ? previous.id : undefined, developmentId: opts.developmentId || undefined };
    version.profileCompleteness = plain(completeness(version));
    const counts = {}; for (const p of version.preferences) counts[p.source] = (counts[p.source] || 0) + 1; for (const c of version.hardConstraints) counts[c.source] = (counts[c.source] || 0) + 1;
    version.sourceSummary = counts;
    const nextProfile = { ...plain(profile), currentVersionId: version.id, updatedAt: now };
    return deepFreeze({ ok: true, version, profile: nextProfile, warnings: r.warnings, events: [event('CustomerPreferenceProfileUpdated', { organizationId: profile.organizationId, customerId: profile.customerId, profileVersionId: version.id, version: version.version }, opts)] });
  }
  /** fromUiState({ preferences: {key: 1..3}, constraints: {key: value} }) → profile input (what the broker typed on the panel: BROKER_RECORDED) */
  function fromUiState(ui = {}, opts = {}) {
    const fc = fitCfg(opts.developmentId), li = (fc && fc.legacyImportance) || { 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH' };
    const preferences = Object.entries(ui.preferences || {}).filter(([k, w]) => w && fc && fc.preferences[k]).map(([key, w]) => ({ key, importance: typeof w === 'string' ? w : li[String(w)], source: opts.source || 'BROKER_RECORDED' })).filter(p => p.importance);
    const hardConstraints = Object.entries(ui.constraints || {}).filter(([, v]) => v != null && v !== false && v !== '').map(([key, value]) => ({ key, value, source: opts.source || 'BROKER_RECORDED' }));
    return { objective: ui.customerObjective || undefined, preferences, hardConstraints, hardConstraintsReviewed: Object.keys(ui.constraints || {}).length > 0 };
  }
  /** toUiState(version) → { preferences, constraints } in the panel's shape (inverse of fromUiState) */
  function toUiState(version, opts = {}) {
    const fc = fitCfg(opts.developmentId || (version && version.developmentId)), inv = {}; for (const [w, imp] of Object.entries((fc && fc.legacyImportance) || {})) inv[imp] = +w;
    const preferences = {}, constraints = {};
    for (const p of (version && version.preferences) || []) if (p.active && p.target == null && inv[p.importance]) preferences[p.key] = inv[p.importance];
    for (const c of (version && version.hardConstraints) || []) constraints[c.key] = c.value;
    return { preferences, constraints };
  }
  /** toFitProfile(version, { developmentId }) → CustomerProfile for App.fit (topic 14), built by the unchanged builder. Inactive suggestions are left out. */
  function toFitProfile(version, opts = {}) {
    const devId = opts.developmentId || version.developmentId || 'viva-juara', prefs = {};
    let budgetMax = null, areaMin = null, areaMax = null;
    for (const p of version.preferences || []) {
      if (!p.active) continue;
      if (p.key === 'budget') { if (typeof p.target === 'number') budgetMax = p.target; continue; }
      if (p.key === 'areaRange') { if (p.target) { areaMin = p.target.min ?? null; areaMax = p.target.max ?? null; } continue; }
      prefs[p.key] = p.importance;
    }
    return App.fit.buildProfile({ id: version.customerId, developmentId: devId, preferences: prefs, budgetMax, areaMin, areaMax, updatedAt: version.createdAt });
  }
  /** toRecommendationConstraints(version) → { key: value } for the RecommendationEngine (topic 15). Only hard constraints, never preferences. */
  const toRecommendationConstraints = version => Object.fromEntries((version.hardConstraints || []).map(c => [c.key, c.value]));
  /** createSnapshot(version, customer, purpose) → CustomerProfileSnapshot: references + checksum only, no PII copy */
  function createSnapshot(version, customer, purpose = 'FIT', opts = {}) {
    return deepFreeze({ id: newId('cps', opts), organizationId: version.organizationId, customerId: version.customerId, profileVersionId: version.id, customerRevision: customer ? customer.recordRevision : null,
      preferenceChecksum: version.checksum, createdAt: nowIso(opts.now), purpose });
  }
  /** fitRequestRefs(snapshot, fitProfile) → what Fit/Recommendation record (customerId, profileVersionId, profileSnapshotId, fit profileVersion) */
  const resultRefs = (snapshot, fitProfile) => Object.freeze({ customerId: snapshot.customerId, profileVersionId: snapshot.profileVersionId, profileSnapshotId: snapshot.id, customerProfileVersion: fitProfile ? fitProfile.profileVersion : null });
  /** favorite context (topic 38): CUSTOMER contextRef = canonical customerId */
  const favoriteContext = customerId => Object.freeze({ contextType: 'CUSTOMER', contextRef: customerId });
  /** comparison context (topic 24): mode CUSTOMER with the exact profile refs (the comparison keeps them; switching customer never rewrites it) */
  const comparisonContext = (customerId, profileVersionId, fitProfileVersion) => Object.freeze({ mode: 'CUSTOMER', customerId, profileVersionId: profileVersionId || null, customerProfileVersion: fitProfileVersion || null });

  // ------------------------------------------------------------------ duplicates (SUGGEST_ONLY; same tenant only)
  function nameSimilarity(a, b) {
    const ta = normText(a).split(' ').filter(Boolean), tb = normText(b).split(' ').filter(Boolean); if (!ta.length || !tb.length) return 0;
    if (ta.join(' ') === tb.join(' ')) return 1;
    // token match with initials ("Maria S." ~ "Maria Souza")
    const m = (x, y) => x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y));
    let hit = 0; const used = new Set();
    for (const x of ta) { const j = tb.findIndex((y, i) => !used.has(i) && m(x, y)); if (j >= 0) { used.add(j); hit++; } }
    return hit / Math.max(ta.length, tb.length);
  }
  /** detectDuplicates({ customers, contacts, externalRefs? }, { organizationId, only?, existing? }) → CustomerDuplicateCandidate[] (status OPEN, never auto-merged) */
  function detectDuplicates({ customers = [], contacts = [] } = {}, opts = {}) {
    const org = opts.organizationId, pol = policyOf(org), thr = pol.duplicatePolicy.nameSimilarityThreshold || 0.8;
    const live = customers.filter(c => c.organizationId === org && (c.lifecycleStatus === 'ACTIVE' || c.lifecycleStatus === 'ARCHIVED'));
    const keys = new Map(); for (const c of contacts) { if (c.organizationId !== org || c.lifecycleStatus === 'REVOKED') continue; const k = matchKeyOf(c); if (k) { if (!keys.has(c.customerId)) keys.set(c.customerId, new Set()); keys.get(c.customerId).add(k); } }
    const tail = id => new Set([...(keys.get(id) || [])].filter(k => k.startsWith('P:')).map(k => k.slice(-4)));
    const prior = new Map((opts.existing || []).map(d => [d.customerIdA + '|' + d.customerIdB, d]));
    const out = [];
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const [a, b] = [live[i], live[j]].sort((x, y) => x.id < y.id ? -1 : 1);
      if (opts.only && a.id !== opts.only && b.id !== opts.only) continue;
      const sig = [], ka = keys.get(a.id) || new Set(), kb = keys.get(b.id) || new Set();
      if ([...ka].some(k => k.startsWith('P:') && kb.has(k))) sig.push('SAME_NORMALIZED_PHONE');
      if ([...ka].some(k => k.startsWith('E:') && kb.has(k))) sig.push('SAME_NORMALIZED_EMAIL');
      if ((a.externalRefs || []).some(r => (b.externalRefs || []).some(s => s.provider === r.provider && s.externalId === r.externalId))) sig.push('SAME_EXTERNAL_REF');
      const sim = nameSimilarity(a.displayName, b.displayName);
      if (sim >= thr) sig.push('SIMILAR_NAME');
      if (sim >= 0.5 && !sig.includes('SAME_NORMALIZED_PHONE')) { const ta = tail(a.id), tb = tail(b.id); if ([...ta].some(t => tb.has(t))) sig.push('SAME_NAME_AND_CONTACT_FRAGMENT'); }
      if (!sig.length) continue;
      const p = prior.get(a.id + '|' + b.id); if (p && p.status !== 'OPEN') continue; // reviewed pairs are not reopened
      out.push(deepFreeze({ id: p ? p.id : 'dup_' + checksum([org, a.id, b.id]), organizationId: org, customerIdA: a.id, customerIdB: b.id, matchSignals: sig.map(s => ({ signal: s, strength: s === 'SIMILAR_NAME' ? 'WEAK' : s === 'SAME_NAME_AND_CONTACT_FRAGMENT' ? 'MEDIUM' : 'STRONG' })),
        status: DuplicateStatus.OPEN, action: 'SUGGEST_ONLY', detectedAt: p ? p.detectedAt : nowIso(opts.now) }));
    }
    return out;
  }
  function reviewDuplicate(cand, status, opts = {}) {
    if (!['CONFIRMED_DUPLICATE', 'NOT_DUPLICATE'].includes(status)) return fail('INVALID_STATUS');
    return deepFreeze({ ok: true, candidate: { ...plain(cand), status, reviewedAt: nowIso(opts.now), reviewedBy: opts.actorId || null } });
  }
  /** duplicateWarning(candidate, forCustomerId, isVisible) — the other record's details only when the viewer can see it */
  function duplicateWarning(cand, forId, isVisible = () => false) {
    const other = cand.customerIdA === forId ? cand.customerIdB : cand.customerIdA;
    if (!isVisible(other)) return Object.freeze({ code: 'POTENTIAL_DUPLICATE_REQUIRES_REVIEW', message: MESSAGES.POTENTIAL_DUPLICATE_REQUIRES_REVIEW, candidateId: cand.id });
    return Object.freeze({ code: 'POTENTIAL_DUPLICATE', message: MESSAGES.DUPLICATE_WARNING, candidateId: cand.id, otherCustomerId: other, signals: cand.matchSignals.map(s => s.signal) });
  }

  // ------------------------------------------------------------------ aliases and merge
  /** resolveAlias(aliases, id) → final canonical id (chains collapsed; cycles stop) */
  function resolveAlias(aliases, id) {
    const map = new Map((aliases || []).map(a => [a.aliasCustomerId, a.canonicalCustomerId])); let cur = id; const seen = new Set();
    while (map.has(cur) && !seen.has(cur)) { seen.add(cur); cur = map.get(cur); }
    return cur;
  }
  /** merge(cmd, world, opts) — cmd = { sourceCustomerIds, targetCustomerId, expectedRevisions, fieldDecisions, reasonCode, idempotencyKey };
      world = { customers, contacts, assignments, favorites, aliases, mergeRecords }. Nothing is summed, averaged or silently "newest wins". */
  function merge(cmd = {}, world = {}, opts = {}) {
    const prev = (world.mergeRecords || []).find(m => cmd.idempotencyKey && m.idempotencyKey === cmd.idempotencyKey); if (prev) return Object.freeze({ ok: true, replay: true, record: prev });
    if (!cmd.reasonCode) return fail(Errors.REASON_REQUIRED);
    const byId = new Map((world.customers || []).map(c => [c.id, c])), tgt = byId.get(cmd.targetCustomerId), srcs = (cmd.sourceCustomerIds || []).map(id => byId.get(id));
    if (!tgt || srcs.some(s => !s) || !srcs.length) return fail(Errors.NOT_FOUND);
    if (srcs.some(s => s.id === tgt.id)) return fail(Errors.MERGE_SAME_CUSTOMER);
    if (srcs.some(s => s.organizationId !== tgt.organizationId) || (opts.organizationId && tgt.organizationId !== opts.organizationId)) return fail(Errors.CROSS_TENANT);
    if ([tgt, ...srcs].some(c => c.lifecycleStatus === 'MERGED' || c.lifecycleStatus === 'DELETED')) return fail(Errors.MERGE_INVALID_STATE);
    const exp = cmd.expectedRevisions || {}, stale = [tgt, ...srcs].filter(c => exp[c.id] !== c.recordRevision).map(c => c.id);
    if (stale.length) return fail(Errors.CUSTOMER_REVISION_CONFLICT, { staleCustomerIds: stale });
    const dec = cmd.fieldDecisions || [], decOf = f => dec.find(d => d.fieldPath === f);
    // external refs: same provider, different externalId → explicit decision
    const refs = [...(tgt.externalRefs || [])];
    for (const s of srcs) for (const r of s.externalRefs || []) {
      const same = refs.find(x => x.provider === r.provider);
      if (!same) refs.push(r);
      else if (same.externalId !== r.externalId) { const d = decOf('externalRefs.' + r.provider); if (!d) return fail(Errors.EXTERNAL_REF_CONFLICT, { provider: r.provider }); if (d.choice === 'SOURCE:' + s.id) refs.splice(refs.indexOf(same), 1, r); else if (d.choice === 'KEEP_BOTH') refs.push(r); }
    }
    // profiles: any source profile → explicit decision (KEEP_TARGET | ADOPT_SOURCE:<id> | NEW_VERSION later)
    let profileVersionId = tgt.currentPreferenceProfileVersionId;
    const srcProfiles = srcs.filter(s => s.currentPreferenceProfileVersionId && s.currentPreferenceProfileVersionId !== tgt.currentPreferenceProfileVersionId);
    if (srcProfiles.length) {
      const d = decOf('preferenceProfile'); if (!d) return fail(Errors.PROFILE_DECISION_REQUIRED);
      if (String(d.choice).startsWith('ADOPT_SOURCE:')) { const s = byId.get(d.choice.slice(13)); if (!s || !srcs.includes(s)) return fail(Errors.PROFILE_DECISION_REQUIRED); profileVersionId = s.currentPreferenceProfileVersionId; }
      else if (d.choice !== 'KEEP_TARGET' && d.choice !== 'NEW_VERSION') return fail(Errors.PROFILE_DECISION_REQUIRED);
    }
    let displayName = tgt.displayName; const dn = decOf('displayName'); if (dn && String(dn.choice).startsWith('SOURCE:')) { const s = byId.get(dn.choice.slice(7)); if (s && srcs.includes(s)) displayName = s.displayName; }
    const now = nowIso(opts.now), srcIds = new Set(srcs.map(s => s.id)), actor = opts.actorId || null;
    const target = { ...plain(tgt), displayName, externalRefs: plain(refs), currentPreferenceProfileVersionId: profileVersionId, recordRevision: tgt.recordRevision + 1, updatedAt: now, updatedBy: actor };
    const sources = srcs.map(s => ({ ...plain(s), lifecycleStatus: LifecycleStatus.MERGED, mergedIntoCustomerId: tgt.id, recordRevision: s.recordRevision + 1, updatedAt: now, updatedBy: actor }));
    const tgtPrimary = new Set((world.contacts || []).filter(c => c.customerId === tgt.id && c.isPrimary).map(c => c.type));
    const contacts = (world.contacts || []).map(c => srcIds.has(c.customerId) ? { ...plain(c), customerId: tgt.id, mergedFromCustomerId: c.customerId, isPrimary: c.isPrimary && !tgtPrimary.has(c.type), updatedAt: now } : c);
    const seenA = new Set((world.assignments || []).filter(a => a.customerId === tgt.id && a.status === 'ACTIVE').map(a => a.assigneeType + a.assigneeId + a.role));
    const assignments = (world.assignments || []).map(a => {
      if (!srcIds.has(a.customerId)) return a;
      const k = a.assigneeType + a.assigneeId + a.role, active = a.status === 'ACTIVE';
      const end = active && (seenA.has(k) || (a.role === 'OWNER' && [...seenA].some(x => x.endsWith('OWNER')))); // one active OWNER: the target's (or the first) stays
      if (active && !end) seenA.add(k);
      return { ...plain(a), customerId: tgt.id, mergedFromCustomerId: a.customerId, ...(end ? { status: 'ENDED', endedAt: now, reasonCode: 'MERGED_DUPLICATE' } : {}) };
    });
    const favorites = (world.favorites || []).map(f => f.contextType === 'CUSTOMER' && srcIds.has(f.contextRef) ? { ...plain(f), contextRef: tgt.id, originalContextRef: f.contextRef } : f);
    const aliases = [...(world.aliases || []).map(a => srcIds.has(a.canonicalCustomerId) ? { ...plain(a), canonicalCustomerId: tgt.id } : a),
      ...srcs.map(s => ({ aliasCustomerId: s.id, canonicalCustomerId: tgt.id, organizationId: tgt.organizationId, reason: 'MERGED', createdAt: now }))];
    const record = { id: newId('cmr', opts), organizationId: tgt.organizationId, sourceCustomerIds: srcs.map(s => s.id), targetCustomerId: tgt.id, fieldDecisions: plain(dec), performedBy: actor, performedAt: now, reasonCode: cmd.reasonCode, idempotencyKey: cmd.idempotencyKey || null,
      preserved: { contactPoints: contacts.filter(c => c.mergedFromCustomerId && srcIds.has(c.mergedFromCustomerId)).length, assignments: assignments.filter(a => a.mergedFromCustomerId && srcIds.has(a.mergedFromCustomerId)).length, favorites: favorites.filter(f => f.originalContextRef && srcIds.has(f.originalContextRef)).length, externalRefs: refs.length },
      profileVersionsRetained: srcs.map(s => s.currentPreferenceProfileVersionId).filter(Boolean) };
    return deepFreeze({ ok: true, target, sources, contacts, assignments, favorites, aliases, record,
      events: [event('CustomerMerged', { organizationId: tgt.organizationId, customerId: tgt.id, sourceCustomerIds: record.sourceCustomerIds, mergeRecordId: record.id, reasonCode: cmd.reasonCode }, opts)] });
  }

  // ------------------------------------------------------------------ projections / read models
  const objectiveLabel = o => o ? (cfgRoot().objectiveLabels || {})[o] || null : null;
  /** project(bundle, mode, decision) — bundle = { customer, details, contacts, assignments, privacy, profileVersion, favoriteCount, ownerDisplayName }.
      The mode is capped by decision.accessLevel; NONE → null. */
  function project(b = {}, mode = 'SUMMARY', decision) {
    const c = b.customer; if (!c || !decision || !decision.allowed) return null;
    const rank = { NONE: 0, SUMMARY: 1, STANDARD: 2, FULL: 3 }, need = { SUMMARY: 1, CLIENT_SAFE: 1, TECHNICAL: 1, STANDARD: 2, FULL: 3 };
    let m = ProjectionMode[mode] ? mode : 'SUMMARY', downgraded = false;
    if (rank[decision.accessLevel] < need[m]) { m = decision.accessLevel === 'STANDARD' ? 'STANDARD' : 'SUMMARY'; downgraded = true; }
    const v = b.profileVersion, comp = v ? completeness(v) : null;
    const summary = { customerId: c.id, displayName: c.displayName, lifecycleStatus: c.lifecycleStatus, ownerDisplayName: b.ownerDisplayName || undefined,
      profileCompleteness: comp ? comp.ratio : undefined, objectiveLabel: v ? objectiveLabel(v.objective) || undefined : undefined, activeFavoriteCount: b.favoriteCount != null ? b.favoriteCount : undefined, updatedAt: c.updatedAt };
    const out = { mode: m, downgraded };
    if (m === 'SUMMARY') return deepFreeze({ ...out, summary });
    if (m === 'CLIENT_SAFE') { const d = b.details || {}; return deepFreeze({ mode: m, downgraded, displayName: d.preferredName || d.firstName || String(c.displayName).split(' ')[0], objectiveLabel: summary.objectiveLabel }); }
    if (m === 'TECHNICAL') return deepFreeze({ ...out, customerId: c.id, organizationId: c.organizationId, type: c.type, lifecycleStatus: c.lifecycleStatus, recordRevision: c.recordRevision, currentPreferenceProfileVersionId: c.currentPreferenceProfileVersionId || null,
      externalRefs: (c.externalRefs || []).map(r => ({ provider: r.provider, externalId: r.externalId, authorityMode: r.authorityMode, syncStatus: r.syncStatus })), contactPointIds: (b.contacts || []).map(x => x.id), assignmentIds: (b.assignments || []).map(a => a.id) });
    const full = m === 'FULL' && decision.canReadContacts;
    const contactPoints = (b.contacts || []).filter(x => x.lifecycleStatus !== 'REVOKED').map(x => ({ id: x.id, type: x.type, label: x.label, isPrimary: x.isPrimary, verificationStatus: x.verificationStatus, lifecycleStatus: x.lifecycleStatus,
      value: full ? x.value : maskContact(x), normalizedValue: full ? x.normalizedValue : undefined, masked: !full }));
    const res = { ...out, summary, contactPoints, assignments: (b.assignments || []).filter(a => a.status === 'ACTIVE').map(a => ({ id: a.id, assigneeType: a.assigneeType, assigneeId: a.assigneeId, role: a.role, assignedAt: a.assignedAt })),
      preferenceProfile: v ? { versionId: v.id, version: v.version, objective: v.objective || null, objectiveLabel: objectiveLabel(v.objective), preferences: v.preferences.map(p => ({ key: p.key, importance: p.importance, source: p.source, active: p.active, target: p.target })),
        hardConstraints: v.hardConstraints.map(x => ({ key: x.key, value: x.value })), budgetDataState: v.budgetProfile ? v.budgetProfile.dataState : 'UNKNOWN', completeness: comp } : null,
      actions: [] };
    if (full && b.privacy) res.privacyProjection = { dataClassification: b.privacy.dataClassification, retentionPolicyRef: b.privacy.retentionPolicyRef || null, marketingCommunicationAllowed: b.privacy.marketingCommunicationAllowed ?? null };
    return deepFreeze(res);
  }
  // DTOs (API contract shapes): list = summary only
  const toSummaryDto = (b, decision) => { const p = project(b, 'SUMMARY', decision); return p ? p.summary : null; };
  const toDetailDto = (b, decision, mode = 'STANDARD') => project(b, mode, decision);

  // ------------------------------------------------------------------ search (summaries only; visibility first; no PII in logs)
  /** search(world, query, { decide, can }) → { ok, results: CustomerSummaryReadModel[], logSafe } */
  function search(world = {}, query = {}, opts = {}) {
    const can = opts.can || (() => false), decide = opts.decide || (() => ({ allowed: false })), kind = query.phone ? 'PHONE' : query.email ? 'EMAIL' : query.externalId ? 'EXTERNAL_REF' : 'NAME';
    const logSafe = Object.freeze({ kind, length: String(query.text || query.phone || query.email || query.externalId || '').length });
    if ((kind === 'PHONE' || kind === 'EMAIL') && !can('customer.contact.read')) return Object.freeze({ ok: false, code: Errors.CONTACT_SEARCH_NOT_ALLOWED, message: MESSAGES.CONTACT_SEARCH_NOT_ALLOWED, results: [], logSafe });
    let match;
    if (kind === 'PHONE') { const n = normalizePhone(query.phone).normalizedValue; const ids = new Set((world.contacts || []).filter(c => n && (c.type === 'PHONE' || c.type === 'WHATSAPP') && c.normalizedValue === n).map(c => c.customerId)); match = c => ids.has(c.id); }
    else if (kind === 'EMAIL') { const n = (normalizeEmail(query.email).normalizedValue || '').toLowerCase(); const ids = new Set((world.contacts || []).filter(c => n && c.type === 'EMAIL' && (c.normalizedValue || '').toLowerCase() === n).map(c => c.customerId)); match = c => ids.has(c.id); }
    else if (kind === 'EXTERNAL_REF') match = c => (c.externalRefs || []).some(r => r.externalId === String(query.externalId) && (!query.provider || r.provider === query.provider));
    else { const q = normText(query.text); match = c => !!q && normText(c.displayName).includes(q); }
    const results = [];
    for (const c of world.customers || []) {
      if (c.lifecycleStatus === 'MERGED' || c.lifecycleStatus === 'DELETED' || (c.lifecycleStatus === 'ARCHIVED' && !query.includeArchived)) continue;
      const d = decide(c); if (!d || !d.allowed) continue; // invisible customers never appear (not even as a count)
      if (!match(c)) continue;
      results.push(project({ customer: c, ...(opts.bundleOf ? opts.bundleOf(c) : {}) }, 'SUMMARY', d).summary);
    }
    results.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
    return Object.freeze({ ok: true, results: Object.freeze(results.slice(0, query.limit || 50)), logSafe });
  }

  // ------------------------------------------------------------------ ingestion (idempotent; normalize → duplicate check → match/create)
  /** ingest(observation, world, opts) → { action: MATCHED | CREATED | REPLAY, customerId, created?, duplicateCandidates, events } */
  function ingest(obs = {}, world = {}, opts = {}) {
    const org = opts.organizationId, key = obs.sourceSystem && obs.sourceRecordId ? obs.sourceSystem + ':' + obs.sourceRecordId : null;
    if (key && world.ingestionKeys && world.ingestionKeys.has(key)) return Object.freeze({ ok: true, action: 'REPLAY', customerId: world.ingestionKeys.get(key), duplicateCandidates: [], events: [] });
    if (key) { const hit = (world.customers || []).find(c => c.organizationId === org && (c.externalRefs || []).some(r => r.provider === obs.sourceSystem && r.externalId === String(obs.sourceRecordId)));
      if (hit) return Object.freeze({ ok: true, action: 'MATCHED', matchedBy: 'SAME_EXTERNAL_REF', customerId: resolveAlias(world.aliases, hit.id), duplicateCandidates: [], events: [], ingestionKey: key }); }
    const contacts = [...(obs.phone ? [{ type: obs.channel === 'WHATSAPP' ? 'WHATSAPP' : 'PHONE', value: obs.phone }] : []), ...(obs.email ? [{ type: 'EMAIL', value: obs.email }] : [])];
    const r = createCustomer({ displayName: obs.displayName || 'Contato sem nome', contacts }, { ...opts, existing: { customers: world.customers || [], contacts: world.contacts || [] } });
    if (!r.ok) return r;
    let cust = r.customer, evs = [...r.events], ref = null;
    if (key) { const l = linkExternalRef(cust, { provider: obs.sourceSystem, externalId: obs.sourceRecordId, authorityMode: opts.authorityMode || 'REFERENCE_ONLY' }, opts); if (l.ok) { cust = l.customer; ref = l.ref; evs = evs.concat(l.events); } }
    const cands = detectDuplicates({ customers: [cust, ...(world.customers || [])], contacts: [...r.contactPoints, ...(world.contacts || [])] }, { organizationId: org, only: cust.id, now: opts.now });
    return deepFreeze({ ok: true, action: 'CREATED', customerId: cust.id, created: { ...plain(r), customer: plain(cust) }, externalRef: ref, duplicateCandidates: cands, ingestionKey: key,
      ignored: obs.preferenceHints != null ? ['PREFERENCE_HINTS_NOT_APPLIED'] : [],
      events: [...evs, ...cands.map(c => event('CustomerDuplicateDetected', { organizationId: org, customerId: cust.id, candidateId: c.id, signals: c.matchSignals.map(s => s.signal) }, opts))] });
  }

  // ------------------------------------------------------------------ anonymization foundation (logical; never a hard delete)
  function anonymize(b = {}, opts = {}) {
    if (!opts.reasonCode) return fail(Errors.REASON_REQUIRED);
    const c = b.customer, now = nowIso(opts.now);
    return deepFreeze({ ok: true, customer: { ...plain(c), displayName: 'Cliente anonimizado', lifecycleStatus: LifecycleStatus.DELETED, recordRevision: c.recordRevision + 1, updatedAt: now, metadata: undefined, anonymizedAt: now },
      details: { customerId: c.id }, contacts: (b.contacts || []).map(x => ({ id: x.id, organizationId: x.organizationId, customerId: x.customerId, type: x.type, value: null, normalizedValue: null, isPrimary: false, verificationStatus: 'UNKNOWN', lifecycleStatus: 'REVOKED', createdAt: x.createdAt, updatedAt: now })),
      retained: ['customerId', 'organizationId', 'profileVersionIds', 'snapshots', 'favorites(lotIds)'], events: [event('CustomerAnonymized', { organizationId: c.organizationId, customerId: c.id, reasonCode: opts.reasonCode }, opts)] });
  }

  return Object.freeze({ CustomerType, LifecycleStatus, ContactPointType, VerificationStatus, ContactLifecycle, NormalizationStatus, CommunicationChannel, ConsentStatus, DataClassification, AssignmentRole, AssignmentStatus, AssigneeType,
    AccessLevel, AuthorityMode, FieldAuthority, SyncStatus, Objective, PreferenceSource, BudgetDataState, DuplicateSignal, DuplicateStatus, ProjectionMode, ContextSource, EventType, Errors, MESSAGES, SCHEMA_VERSION,
    policyOf, newId, looksLikePII, redactPII, logEntry, event, normalizePhone, normalizeEmail, maskContact, matchKeyOf,
    createCustomer, updateCustomer, archive, addContactPoint, setVerification, setCommunicationPreference, consentOf, mayContact, createPrivacyProfile,
    assign, endAssignment, activeAssignmentFor, canFromAuthz, localDeviceCan, decideAccess, linkExternalRef, fieldAuthority, applyExternalChanges,
    createPreferenceProfile, validateProfileInput, completeness, createProfileVersion, fromUiState, toUiState, toFitProfile, toRecommendationConstraints, createSnapshot, resultRefs, favoriteContext, comparisonContext,
    nameSimilarity, detectDuplicates, reviewDuplicate, duplicateWarning, resolveAlias, merge, objectiveLabel, project, toSummaryDto, toDetailDto, search, ingest, anonymize });
})();
