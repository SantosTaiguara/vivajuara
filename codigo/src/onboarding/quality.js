/* onboarding/quality.js — topic 58 §144–170, §439–449: DataConflict, data-quality gate, exceptions, ReviewItem queue, DataCorrectionRule.
   - Conflicts between sources are explicit (§146–148): resolution needs who/why/when; PREFER_HIGHER_AUTHORITY auto-resolution is
     recorded with its policy reason; equal authority or REQUIRE_REVIEW → review; BLOCK → blocker until resolved.
   - The publish gate (§159–161) blocks when blockers > 0 (and errors > 0 when policy.errorsBlockPublish). It is a small
     interface: QualityCheckProvider { id, version, evaluate(dataset) → DataQualityCheck[] }. The built-in provider covers the
     onboarding checks of §149–157; topic 61 (generic data-quality rules) registers its own provider with
     App.onboarding.quality.registerProvider(provider) — this file does not import topic 61 code.
   - Exceptions: only checks the policy declares waivable; BLOCKING is never waivable by default (§440–445). "Green" never
     hides warnings: summaries always carry absolute counts (§448–449).
   - Review items need an explicit resolution (§165); corrections are lineage (derived values), the source file is never patched (§167–170).
   Pure. Depends on App.onboarding.model, App.onboardingPolicy. */
App.onboarding = App.onboarding || {};
App.onboarding.quality = (() => {
  const M = App.onboarding.model, P = () => App.onboardingPolicy;
  const freeze = o => Object.freeze(o);

  // ------------------------------------------------------------------ DataConflict
  const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const precedenceOf = key => P().sourcePrecedence.find(p => p.fieldKey === key) || { fieldKey: key, sourcePriorities: [], conflictMode: P().defaultConflictMode };
  /** detectConflicts(observations) — observations: [{ entityType, entityId, fieldKey, value, sourceRef, sourcePurpose, authority }] from DIFFERENT sources */
  function detectConflicts(observations, { at = null } = {}) {
    const groups = new Map();
    for (const o of observations) { if (o.value == null) continue; const k = `${o.entityType}|${o.entityId}|${o.fieldKey}`; groups.set(k, [...(groups.get(k) || []), o]); }
    const out = [];
    for (const [, obs] of groups) {
      const distinct = obs.filter((o, i) => obs.findIndex(x => sameValue(x.value, o.value)) === i);
      if (distinct.length < 2) continue;
      const { entityType, entityId, fieldKey } = obs[0], pol = precedenceOf(fieldKey);
      const prio = o => { const p = pol.sourcePriorities.find(s => s.sourcePurpose === o.sourcePurpose); return p ? p.priority : 99; };
      const conflict = { id: M.id('dc', entityType, entityId, fieldKey, obs.map(o => [o.sourceRef, o.value])), entityType, entityId, fieldKey, conflictMode: pol.conflictMode,
        candidates: freeze(obs.map(o => freeze({ sourceRef: o.sourceRef, value: o.value, authority: o.authority || o.sourcePurpose || 'UNKNOWN', priority: prio(o) }))), status: 'OPEN', detectedAt: at };
      const ranked = [...conflict.candidates].sort((a, b) => a.priority - b.priority);
      const marketingOnly = P().marketingNeverOverridesTechnical && obs.some(o => o.sourcePurpose === 'MARKETING') && obs.filter(o => o.sourcePurpose !== 'MARKETING').every((o, _, arr) => sameValue(o.value, arr[0].value));
      if ((pol.conflictMode === 'PREFER_HIGHER_AUTHORITY' && ranked[0].priority < ranked[1].priority) || marketingOnly) {
        const win = marketingOnly ? conflict.candidates.find(c => !obs.find(o => o.sourceRef === c.sourceRef && o.sourcePurpose === 'MARKETING')) : ranked[0];
        conflict.status = 'RESOLVED';
        conflict.resolution = freeze({ selectedSourceRef: win.sourceRef, selectedValue: win.value, reason: marketingOnly ? 'POLICY: fonte de marketing não sobrepõe fonte técnica' : 'POLICY: maior autoridade (SourcePrecedencePolicy)', resolvedBy: 'policy:' + P().version, resolvedAt: at });
      }
      out.push(freeze(conflict));
    }
    return freeze(out);
  }
  function resolveConflict(c, { selectedSourceRef, reason, resolvedBy, at, acceptDifference = false }) {
    if (!reason || !resolvedBy) return M.fail('VALIDATION_ERROR', 'resolução exige motivo e autor (§148)');
    const to = acceptDifference ? 'ACCEPTED_DIFFERENCE' : 'RESOLVED';
    if (!M.canTransition('conflict', c.status, to)) return M.fail('INVALID_TRANSITION', `${c.status} → ${to}`);
    const cand = c.candidates.find(x => x.sourceRef === selectedSourceRef);
    if (!acceptDifference && !cand) return M.fail('VALIDATION_ERROR', 'fonte escolhida não está entre os candidatos');
    return M.ok(freeze({ ...c, status: to, resolution: freeze({ selectedSourceRef: cand ? cand.sourceRef : null, selectedValue: cand ? cand.value : null, reason, resolvedBy, resolvedAt: at }) }));
  }

  // ------------------------------------------------------------------ data-quality checks
  const chk = (code, category, severity, entityScope, failed, details, refs = []) => freeze({ code, category, severity, entityScope, result: failed == null ? 'NOT_APPLICABLE' : failed ? 'FAIL' : 'PASS',
    details: details || undefined, count: typeof failed === 'number' ? failed : undefined, entityRefs: freeze(refs.slice(0, 20)) });
  const n = x => (x ? x.length : 0);
  /** built-in provider (onboarding checks §149–157). dataset fields are optional; absent inputs give NOT_APPLICABLE. */
  const BUILTIN_PROVIDER = freeze({ id: 'onboarding-builtin', version: '1.0.0', evaluate(d) {
    const out = [], lots = d.drafts || [], add = c => out.push(c);
    const unresolved = d.unresolved || [];
    add(chk('COMPLETENESS.LOT_ID_PRESENT', 'COMPLETENESS', 'BLOCKING', 'LOT', n(unresolved), `${n(unresolved)} registro(s) sem identidade determinística`, unresolved.map(u => u.recordRef)));
    const noArea = lots.filter(l => l.areaSqm == null);
    add(chk('COMPLETENESS.AREA_PRESENT', 'COMPLETENESS', 'ERROR', 'LOT', lots.length ? n(noArea) : null, `${n(noArea)} lote(s) sem área`, noArea.map(l => l.canonicalLotId)));
    if (d.geometry) {
      const miss = d.geometry.match ? d.geometry.match.lotsWithoutGeometry : [];
      add(chk('COMPLETENESS.GEOMETRY_PRESENT', 'COMPLETENESS', d.requireGeometry === false ? 'WARNING' : 'BLOCKING', 'LOT', n(miss), `${n(miss)} lote(s) sem polígono`, miss));
    } else add(chk('COMPLETENESS.GEOMETRY_PRESENT', 'COMPLETENESS', d.requireGeometry === false ? 'WARNING' : 'BLOCKING', 'LOT', d.requireGeometry === false ? null : lots.length, d.requireGeometry === false ? undefined : 'nenhuma fonte de geometria (produto centrado no mapa)'));
    if (d.prices) add(chk('COMPLETENESS.PRICE_PRESENT', 'COMPLETENESS', 'WARNING', 'LOT', n(d.prices.missing) + Math.max(0, lots.length - n(d.prices.candidates) - n(d.prices.missing)),
      `${n(d.prices.candidates)} lote(s) com preço; meta de cobertura: ${P().priceCoverageRequiredPercent == null ? 'não configurada' : P().priceCoverageRequiredPercent + '%'}`, [...d.prices.missing]));
    add(chk('COMPLETENESS.LOT_COUNT_EXPECTED', 'COMPLETENESS', 'ERROR', 'DEVELOPMENT', d.lotCountExpected == null ? null : (lots.length !== d.lotCountExpected ? 1 : 0), d.lotCountExpected == null ? undefined : `${lots.length} lote(s) de ${d.lotCountExpected} esperados`));
    const badArea = lots.filter(l => l.areaSqm != null && !(l.areaSqm > 0));
    add(chk('VALIDITY.AREA_POSITIVE', 'VALIDITY', 'BLOCKING', 'LOT', lots.length ? n(badArea) : null, null, badArea.map(l => l.canonicalLotId)));
    const norm = d.normalizationIssues || [];
    add(chk('VALIDITY.FIELD_NORMALIZATION', 'VALIDITY', 'ERROR', 'FIELD', n(norm), `${n(norm)} valor(es) que não puderam ser normalizados sem inventar significado`, norm.map(x => `${x.recordRef}:${x.fieldKey}:${x.code}`)));
    if (d.prices) { const pi = d.prices.issues.filter(i => i.severity === 'BLOCKING' && !/NOT_FOUND/.test(i.code)); add(chk('VALIDITY.PRICE_VALID', 'VALIDITY', 'BLOCKING', 'PRICE', n(pi), pi.map(i => i.code).join(', ') || undefined, pi.map(i => i.lotId || i.sourceRecordRef))); }
    const dups = (d.duplicates || []).filter(x => x.kind === 'CANONICAL_ID'), dupExt = (d.duplicates || []).filter(x => x.kind === 'SOURCE_EXTERNAL_ID');
    add(chk('UNIQUENESS.CANONICAL_LOT_ID', 'UNIQUENESS', 'BLOCKING', 'LOT', n(dups), dups.map(x => `${x.key} (${x.classification})`).join('; ') || undefined, dups.map(x => x.key)));
    add(chk('UNIQUENESS.SOURCE_EXTERNAL_ID', 'UNIQUENESS', 'BLOCKING', 'LOT', n(dupExt), undefined, dupExt.map(x => x.key)));
    const idi = d.identityIssues || [];
    add(chk('CONSISTENCY.SOURCE_ID_MATCHES_RULE', 'CONSISTENCY', 'BLOCKING', 'LOT', n(idi), undefined, idi.map(i => i.canonicalLotId)));
    const conf = d.conflicts || [], open = conf.filter(c => c.status === 'OPEN');
    add(chk('CONSISTENCY.BLOCKING_CONFLICTS', 'CONSISTENCY', 'BLOCKING', 'FIELD', n(open.filter(c => c.conflictMode === 'BLOCK')), undefined, open.filter(c => c.conflictMode === 'BLOCK').map(c => `${c.entityId}:${c.fieldKey}`)));
    add(chk('CONSISTENCY.OPEN_CONFLICTS', 'CONSISTENCY', 'ERROR', 'FIELD', n(open.filter(c => c.conflictMode !== 'BLOCK')), `${n(open)} conflito(s) pendente(s)`, open.map(c => `${c.entityId}:${c.fieldKey}`)));
    const mv = d.mappingValidation || [], mErr = mv.flatMap(v => v.errors);
    add(chk('CONSISTENCY.MAPPING_VALID', 'CONSISTENCY', 'BLOCKING', 'MAPPING', mv.length ? n(mErr) : null, mErr.map(e => `${e.code}:${e.detail}`).join('; ') || undefined));
    const idm = d.identityMatches || { matches: [] }, amb = idm.matches.filter(m => ['AMBIGUOUS', 'CONFLICT', 'HIGH_CONFIDENCE'].includes(m.matchType));
    add(chk('CONSISTENCY.IDENTITY_RECONCILED', 'CONSISTENCY', 'BLOCKING', 'LOT', n(amb), 'identidades ambíguas/renumeradas exigem revisão (§74)', amb.map(m => m.incomingRecordId)));
    if (d.prices) { const nf = d.prices.issues.filter(i => i.code === 'PRICE_LOT_NOT_FOUND'); add(chk('REFERENTIAL_INTEGRITY.PRICE_LOT_EXISTS', 'REFERENTIAL_INTEGRITY', 'BLOCKING', 'PRICE', n(nf), undefined, nf.map(i => i.lotId))); }
    if (d.availability) { const nf = d.availability.issues.filter(i => i.code === 'AVAILABILITY_LOT_NOT_FOUND'); add(chk('REFERENTIAL_INTEGRITY.AVAILABILITY_LOT_EXISTS', 'REFERENTIAL_INTEGRITY', 'BLOCKING', 'AVAILABILITY', n(nf), undefined, nf.map(i => i.lotId))); }
    if (d.geometry) {
      const g = d.geometry, iss = g.issues || [], um = g.match ? g.match.unmatchedFeatures : [];
      add(chk('REFERENTIAL_INTEGRITY.GEOMETRY_LOT_EXISTS', 'REFERENTIAL_INTEGRITY', 'BLOCKING', 'GEOMETRY', n(um.filter(f => !(g.approvedExclusions || []).includes(f))), 'polígono sem lote: bloqueia ou exige exclusão aprovada (§97)', um));
      const inv = iss.filter(i => ['EMPTY_POLYGON', 'NON_FINITE', 'INVALID_RING', 'ZERO_AREA', 'SELF_INTERSECTION'].includes(i.code));
      add(chk('GEOMETRY_INTEGRITY.VALID_POLYGON', 'GEOMETRY_INTEGRITY', 'BLOCKING', 'GEOMETRY', n(inv), inv.map(i => i.code).join(', ') || undefined, inv.map(i => i.featureId)));
      const dg = iss.filter(i => i.code === 'DUPLICATE_GEOMETRY'); add(chk('GEOMETRY_INTEGRITY.NO_DUPLICATE_POLYGON', 'GEOMETRY_INTEGRITY', 'BLOCKING', 'GEOMETRY', n(dg), undefined, dg.map(i => i.featureId)));
      const dm = g.match ? g.match.duplicateMatches : []; add(chk('GEOMETRY_INTEGRITY.ONE_POLYGON_PER_LOT', 'GEOMETRY_INTEGRITY', 'BLOCKING', 'GEOMETRY', n(dm), undefined, dm.map(x => x.lotId)));
      const ua = g.match ? g.match.matches.filter(m => !m.approved) : []; add(chk('GEOMETRY_INTEGRITY.MATCH_APPROVED', 'GEOMETRY_INTEGRITY', 'BLOCKING', 'GEOMETRY', n(ua), 'vínculo espacial/manual exige aprovação humana', ua.map(m => m.geometryFeatureId)));
      const ov = iss.filter(i => i.code === 'OVERLAP'); add(chk('GEOMETRY_INTEGRITY.NO_OVERLAP', 'GEOMETRY_INTEGRITY', 'ERROR', 'GEOMETRY', n(ov), undefined, ov.map(i => i.featureId)));
      const ob = iss.filter(i => i.code === 'OUTSIDE_EXPECTED_BOUNDS'); add(chk('GEOMETRY_INTEGRITY.WITHIN_BOUNDS', 'GEOMETRY_INTEGRITY', 'WARNING', 'GEOMETRY', n(ob), undefined, ob.map(i => i.featureId)));
      add(chk('GEOMETRY_INTEGRITY.CRS_DECLARED', 'GEOMETRY_INTEGRITY', 'ERROR', 'GEOMETRY', g.descriptor && g.descriptor.crs.type === 'UNKNOWN' ? 1 : 0, g.descriptor ? `referência: ${g.descriptor.coordinateReference}` : undefined));
      if (d.lotCountExpected != null && g.match) add(chk('GEOMETRY_INTEGRITY.EXPECTED_POLYGON_COUNT', 'GEOMETRY_INTEGRITY', 'ERROR', 'GEOMETRY', g.match.matches.length !== d.lotCountExpected ? 1 : 0, `${g.match.matches.length} polígono(s) vinculados de ${d.lotCountExpected} esperados`));
    }
    if (d.availability) {
      const u = d.availability.unknownStatuses || [];
      add(chk('COMMERCIAL_COHERENCE.AVAILABILITY_STATUS_KNOWN', 'COMMERCIAL_COHERENCE', 'BLOCKING', 'AVAILABILITY', n(u), u.map(x => `"${x.sourceValue}" (${x.lotIds.length})`).join(', ') || undefined, u.flatMap(x => x.lotIds)));
      const derived = d.prices ? d.availability.candidates.filter(c => d.prices.missing.includes(c.lotId) && c.canonicalStatus === 'UNAVAILABLE' && !c.sourceStatus) : [];
      add(chk('COMMERCIAL_COHERENCE.PRICE_MISSING_NOT_UNAVAILABLE', 'COMMERCIAL_COHERENCE', 'BLOCKING', 'AVAILABILITY', n(derived), 'preço ausente nunca vira indisponível'));
    }
    const crit = d.criticalFields || ['identity.blockId', 'identity.lotNumber', 'geometry.areaM2'];
    let total = 0, covered = 0; const gaps = [];
    for (const l of lots) for (const k of crit) { const has = k === 'identity.blockId' ? l.blockCode != null : k === 'identity.lotNumber' ? l.lotNumber != null : k === 'geometry.areaM2' ? l.areaSqm != null : l.attributes[k] != null; if (!has) continue; total++; if (l.provenanceRefs[k]) covered++; else gaps.push(`${l.canonicalLotId}:${k}`); }
    add(chk('PROVENANCE_COVERAGE.CRITICAL_FIELDS', 'PROVENANCE_COVERAGE', 'BLOCKING', 'FIELD', lots.length ? total - covered : null, total ? `${covered} de ${total} valores críticos com fonte` : undefined, gaps));
    if (d.piiFindings) add(chk('SECURITY.PII_NOT_INGESTED', 'VALIDITY', 'WARNING', 'SOURCE', n(d.piiFindings), d.piiFindings.map(p => `${p.sourceField}:${p.patternId}`).join(', ') || undefined));
    out.coverage = total ? Math.round(covered / total * 10000) / 100 : undefined;
    return out;
  } });

  const PROVIDERS = [BUILTIN_PROVIDER];
  /** registerProvider(provider) — plug-in point for topic 61 (generic data-quality rules). Returns an unregister function. */
  function registerProvider(p) {
    if (!p || !p.id || typeof p.evaluate !== 'function') throw new Error('QualityCheckProvider inválido');
    if (PROVIDERS.some(x => x.id === p.id)) return () => {};
    PROVIDERS.push(p); return () => { const i = PROVIDERS.indexOf(p); if (i > 0) PROVIDERS.splice(i, 1); };
  }
  const providers = () => PROVIDERS.map(p => ({ id: p.id, version: p.version || null }));

  // ------------------------------------------------------------------ exceptions (§439–445)
  function createException({ check, entityRef, reason, acceptedBy, at, expiresAt }) {
    const pol = P().qualityExceptionPolicy[check.code];
    if (!reason || !acceptedBy) return M.fail('VALIDATION_ERROR', 'exceção exige motivo e autor');
    if (check.severity === 'BLOCKING' && !(pol && pol.waivable)) return M.fail('DATA_QUALITY_BLOCKER', `${check.code}: bloqueio não dispensável`);
    if (!pol || !pol.waivable) return M.fail('POLICY_NOT_CONFIGURED', `${check.code}: política de exceção não declara dispensa`);
    return M.ok(freeze({ id: M.id('dqx', check.code, entityRef || null, acceptedBy, at), checkCode: check.code, entityRef: entityRef || undefined, reason, acceptedBy, acceptedAt: at, expiresAt: expiresAt || undefined }));
  }
  const exceptionActive = (x, at) => !x.expiresAt || !at || Date.parse(x.expiresAt) > Date.parse(at);

  /** evaluate(dataset, { exceptions, at }) → { checks[], summary, gate } — gate.publishable false whenever a blocker is present */
  function evaluate(dataset, { exceptions = [], at = null } = {}) {
    const checks = [], providerErrors = []; let coverage;
    for (const p of PROVIDERS) {
      let r; try { r = p.evaluate(dataset) || []; } catch (e) { providerErrors.push(p.id); r = [chk(`PROVIDER.${p.id}`, 'VALIDITY', 'BLOCKING', 'GATE', 1, 'provedor de qualidade falhou: publicação bloqueada (falha fechada)')]; }
      if (p === BUILTIN_PROVIDER) coverage = r.coverage;
      for (const c of r) checks.push(freeze({ ...c, provider: p.id }));
    }
    const waived = new Set(exceptions.filter(x => exceptionActive(x, at)).map(x => x.checkCode));
    const final = checks.map(c => c.result === 'FAIL' && waived.has(c.code) && !(c.severity === 'BLOCKING' && !(P().qualityExceptionPolicy[c.code] || {}).waivable) ? freeze({ ...c, waived: true }) : c);
    const fails = final.filter(c => c.result === 'FAIL');
    const blockers = fails.filter(c => c.severity === 'BLOCKING' && !c.waived).length, errors = fails.filter(c => c.severity === 'ERROR' && !c.waived).length;
    const warnings = fails.filter(c => c.severity === 'WARNING' || c.waived).length, infos = fails.filter(c => c.severity === 'INFO').length;
    const failing = blockers > 0 || (P().errorsBlockPublish && errors > 0);
    const summary = freeze({ totalChecks: final.length, passed: final.filter(c => c.result === 'PASS').length, notApplicable: final.filter(c => c.result === 'NOT_APPLICABLE').length, warnings, errors, blockers, infos,
      coveragePercent: coverage, status: failing ? 'FAIL' : warnings || errors ? 'PASS_WITH_WARNINGS' : 'PASS' });
    const gate = freeze({ publishable: !failing, blockers: freeze(fails.filter(c => c.severity === 'BLOCKING' && !c.waived).map(c => c.code)), errors: freeze(fails.filter(c => c.severity === 'ERROR' && !c.waived).map(c => c.code)),
      warnings: freeze(fails.filter(c => c.severity === 'WARNING' || c.waived).map(c => c.code)), errorsBlockPublish: !!P().errorsBlockPublish, providers: freeze(providers()), providerErrors: freeze(providerErrors) });
    return freeze({ checks: freeze(final), summary, gate });
  }
  /** plain-language summary for business users (§506) — counts, not an abstract score */
  function plainSummary(d) {
    const lots = n(d.drafts), linked = d.geometry && d.geometry.match ? d.geometry.match.matches.length : 0, priced = d.prices ? n(d.prices.candidates) : null;
    const lines = [`${lots} lotes identificados`, `${linked} polígonos vinculados`];
    if (priced != null) lines.push(`${priced} lotes com preço`, `${Math.max(0, lots - priced)} sem preço`);
    lines.push(`${n((d.conflicts || []).filter(c => c.status === 'OPEN'))} conflitos pendentes`);
    return freeze(lines);
  }

  // ------------------------------------------------------------------ review queue (§162–166, §380)
  function reviewItem({ onboardingCaseId, batchId, category, severity, entityRef, description, evidenceRefs = [] }) {
    return freeze({ id: M.id('rev', onboardingCaseId, batchId, category, entityRef || null, description), onboardingCaseId, batchId, category, severity, entityRef: entityRef || undefined, description,
      evidenceRefs: freeze([...evidenceRefs]), status: 'OPEN', assignedTo: undefined, resolution: undefined, resolvedBy: undefined, resolvedAt: undefined, revision: '1' });
  }
  function resolveReview(item, { status = 'RESOLVED', resolution, by, at, notes }) {
    if (!resolution || !by) return M.fail('VALIDATION_ERROR', 'resolução explícita exige texto e autor (§165)');
    const t = M.transition('review', item, status, { at, by }); if (!t.ok) return t;
    return M.ok(freeze({ ...t.value, resolution, resolvedBy: by, resolvedAt: at, notes: notes || undefined }));
  }
  const assignReview = (item, assignee) => item.status === 'OPEN' ? M.ok(freeze({ ...item, assignedTo: assignee })) : M.fail('INVALID_TRANSITION', 'item já resolvido');
  /** reviewItemsFor(dataset, quality, ctx) — the queue derived from what the pipeline found (aggregated, no raw source values) */
  function reviewItemsFor(d, q, { onboardingCaseId, batchId }) {
    const items = [], add = o => items.push(reviewItem({ onboardingCaseId, batchId, ...o }));
    for (const v of d.mappingValidation || []) for (const e of v.errors) add({ category: 'FIELD_MAPPING', severity: 'HIGH', entityRef: v.sourceAssetId, description: `${e.code}: ${e.detail}` });
    for (const c of (d.conflicts || []).filter(c => c.status === 'OPEN')) add({ category: 'DATA_CONFLICT', severity: c.conflictMode === 'BLOCK' ? 'CRITICAL' : 'HIGH', entityRef: `${c.entityId}:${c.fieldKey}`, description: `Fontes divergem em ${c.fieldKey}`, evidenceRefs: c.candidates.map(x => x.sourceRef) });
    for (const m of ((d.identityMatches || {}).matches || []).filter(m => ['AMBIGUOUS', 'CONFLICT', 'HIGH_CONFIDENCE'].includes(m.matchType))) add({ category: 'LOT_IDENTITY', severity: 'CRITICAL', entityRef: m.incomingRecordId, description: `Identidade ${m.matchType}${m.existingLotId ? ' com ' + m.existingLotId : ''}: possível renumeração — nunca automático`, evidenceRefs: m.evidence });
    for (const u of d.unresolved || []) if (!((d.identityMatches || {}).matches || []).some(m => m.incomingRecordId === `${u.sourceAssetId}#${u.recordRef}`)) add({ category: 'LOT_IDENTITY', severity: 'HIGH', entityRef: u.recordRef, description: `Registro sem identidade (${u.reason})` });
    for (const x of d.duplicates || []) add({ category: 'LOT_IDENTITY', severity: 'CRITICAL', entityRef: x.key, description: `Duplicidade ${x.kind} (${x.classification})`, evidenceRefs: x.recordRefs });
    if (d.geometry && d.geometry.match) {
      if (d.geometry.match.unmatchedFeatures.length) add({ category: 'GEOMETRY_MATCH', severity: 'CRITICAL', description: `${d.geometry.match.unmatchedFeatures.length} polígono(s) sem lote`, evidenceRefs: d.geometry.match.unmatchedFeatures.slice(0, 20) });
      const ua = d.geometry.match.matches.filter(m => !m.approved); if (ua.length) add({ category: 'GEOMETRY_MATCH', severity: 'HIGH', description: `${ua.length} vínculo(s) geometria-lote aguardando aprovação` });
    }
    if (d.geometry && d.geometry.alignment && d.geometry.alignment.status !== 'APPROVED') add({ category: 'GEOMETRY_ALIGNMENT', severity: 'HIGH', description: 'Alinhamento visual pendente de aprovação humana' });
    if (d.priceDiff && d.priceDiff.requiresReview) add({ category: 'PRICE_DIFF', severity: 'MEDIUM', description: `${d.priceDiff.changedPrices.length} preço(s) alterado(s), ${d.priceDiff.removedLotIds.length} removido(s); limiar: ${d.priceDiff.thresholdStatus}` });
    for (const u of (d.availability && d.availability.unknownStatuses) || []) add({ category: 'STATUS_MAPPING', severity: 'CRITICAL', entityRef: `${u.sourceSystem}:${u.sourceValue}`, description: `Status "${u.sourceValue}" sem mapeamento (${u.lotIds.length} lote(s))` });
    for (const e of d.documentExtractions || []) add({ category: 'DOCUMENT_EXTRACTION', severity: 'MEDIUM', entityRef: e.documentVersionId, description: `${e.extractedFacts.length} fato(s) extraído(s) aguardando revisão (sem interpretação jurídica)` });
    for (const p of d.piiFindings || []) add({ category: 'SECURITY', severity: 'HIGH', entityRef: p.sourceField, description: `Possível dado pessoal (${p.patternId}) na coluna "${p.sourceField}": não entra no domínio de lotes` });
    return freeze(items.filter((it, i) => items.findIndex(x => x.id === it.id) === i));
  }

  // ------------------------------------------------------------------ corrections (§167–170)
  function correction({ scope, targetRef, fieldKey, originalValue, correctedValue, reason, approvedBy, at }) {
    if (!M.CorrectionScope[scope]) return M.fail('VALIDATION_ERROR', 'escopo inválido');
    if (!reason || !approvedBy) return M.fail('VALIDATION_ERROR', 'correção exige motivo e aprovação');
    return M.ok(freeze({ id: M.id('corr', scope, targetRef, fieldKey || null, originalValue, correctedValue), scope, targetRef, fieldKey, originalValue, correctedValue, reason, approvedBy, approvedAt: at }));
  }
  /** applyCorrections(drafts, rules) → drafts with derived values; provenance points to the correction (source untouched) */
  function applyCorrections(drafts, rules) {
    return freeze(drafts.map(d => {
      const rs = rules.filter(r => (r.scope === 'LOT' || r.scope === 'FIELD') && r.targetRef === d.canonicalLotId);
      if (!rs.length) return d;
      let next = { ...d, attributes: { ...d.attributes }, provenanceRefs: { ...d.provenanceRefs }, fieldStates: { ...d.fieldStates }, corrections: [...(d.corrections || [])] };
      for (const r of rs) {
        const cur = r.fieldKey === 'geometry.areaM2' ? d.areaSqm : d.attributes[r.fieldKey];
        if (JSON.stringify(cur) !== JSON.stringify(r.originalValue)) continue; // stale rule: does not apply silently
        if (r.fieldKey === 'geometry.areaM2') next.areaSqm = r.correctedValue; else next.attributes[r.fieldKey] = r.correctedValue;
        next.provenanceRefs[r.fieldKey] = 'correction:' + r.id; next.fieldStates[r.fieldKey] = 'CONFIRMED'; next.corrections.push(r.id);
      }
      return freeze(next);
    }));
  }

  return freeze({ detectConflicts, resolveConflict, BUILTIN_PROVIDER, registerProvider, providers, createException, evaluate, plainSummary, reviewItem, resolveReview, assignReview, reviewItemsFor, correction, applyCorrections, precedenceOf });
})();
