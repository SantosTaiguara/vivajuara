# ComparisonValue, ComparisonSnapshot e ComparisonMatrix (Tópico 24)

## ComparisonValue (`App.compare.domain.value`)

```
{ candidateId, metricId, rawValue, normalizedValue: null, valueStatus, comparableState, freshness, confidence?, provenanceSummary?, versionRef?, unit, fieldKey, notes? }
```
- valueStatus: VALID, NO_DATA (número nulo), UNKNOWN (enum nulo ou código `UNKNOWN`), NOT_APPLICABLE, CONFLICTED (proveniência CONFLICTED), ERROR.
- comparableState: COMPARABLE, PARTIAL (válido mas stale), NOT_COMPARABLE, CONTEXT_MISSING (Fit sem cliente: valor `null`, nunca 0%).
- freshness: comerciais ← `lot.metadata.freshness.commercial`; disponibilidade ← `lot.availability.freshness`; estáticos/analíticos não têm.
- versionRef: `static:<v>`, `priceTable:<v>`, `analysis:<v>`, `availability:rev<n>`, `fit:<metodologia>/<perfil>`.

Casos: preço nulo → NO_DATA ("Preço não disponível"); topografia desconhecida → UNKNOWN ("Desconhecido", nunca "Plano"); preço com fontes divergentes → CONFLICTED ("Verificar divergência").

## ComparisonDataProvider

`provideValues({ candidateIds, metrics, resolve, fitById, context })`: uma resolução de Lot por candidato e todas as métricas lidas desse Lot (sem N+1).
Fontes: `LotRepository.resolve` (Lot canônico com estado comercial e de disponibilidade), `Map<lotId, FitScoreResult>` do seletor `selectFit`, `RecommendationResult` (só metadado de rank/tier). Não formata, não ranqueia, não escolhe vencedor, não recalcula score.

## ComparisonSnapshot (`buildSnapshot(session, { resolve, fitById, recommendation, filter, now, requestToken })`)

```
{ id: "cmps_<hash>", sessionId, sessionRevision, developmentId, candidateIds, candidates (com resumos vivos), metricProfileId, metricOrder,
  valuesByMetric, dataVersions, mixedVersion, mixedVersionKeys, generatedAt, freshnessSummary, completenessSummary, contextRef, hash, status,
  missingCandidateIds, requestToken }
dataVersions { staticDataVersion, analysisVersion, priceTableVersion, availabilityRevision {lotId: rev}, customerProfileVersion, fitMethodologyVersion, comparisonMetricProfileVersion }
completenessSummary { totalExpectedCells, validCells, noDataCells, unknownCells, conflictedCells, staleCells, errorCells, coverageRatio, byCandidate, byMetric, partialMetricIds }
```
- Versões divergentes entre candidatos viram lista + `mixedVersion: true` + status PARTIAL; no modo técnico aparecem nomeadas.
- `hash` (FNV-1a sobre JSON estável) = candidatos e ordem + perfil e versão + dataVersions + contextHash. `generatedAt` não entra. `contextHash` usa modo, versão do perfil do cliente e score do objetivo — camada ativa e filtros são dicas de apresentação e não entram.
- status: INVALID (lote sumiu) > DRAFT > STALE (célula comercial stale/expirada) > PARTIAL (versão mista, critério com dado só para parte dos lotes, conflito) > READY.
- Proteção contra resposta antiga: `isCurrentSnapshot(session, snapshot, token)` compara sessão, `revision` e token; o `ComparisonService.buildSnapshot(deps, token)` recusa (`STALE_RESPONSE`) uma resposta de requisição superada.
- Offline: o snapshot roda sobre o cache; dinâmicos stale ficam marcados; ao reconectar, novo snapshot com a mesma sessão e ordem.

## ComparisonMatrix (`buildMatrix(session, snapshot, { audience })`) — sem vencedor

```
{ candidateColumns [{ candidateId, displayCode, code, order, status, validationState, summary { availability, commercial, freshness, matchesCurrentFilters, recommendation } }],
  groups [{ id, label, collapsedByDefault, metricIds, hiddenMetricIds, empty }],
  rows [{ metricId, groupId, labelKey, label, unit, valueType, formatterId, enumName, cells, comparability, metadata }],
  metadata { sessionId, snapshotId, snapshotHash, metricProfileId, audience, dataVersions, mixedVersion, completeness, freshness, contextMode, hasCustomer, activeLayerMetricId },
  status }
cell { candidateId, metricId, value, valueStatus, freshness, confidence, provenanceIndicator, comparableState, uiHints { stale, expired, emphasis } }
```
Ordem: candidatos ← sessão; grupos ← perfil (que segue o GroupRegistry); métricas ← registry. Linha toda sem dado some no modo normal (exceto disponibilidade); Fit sem cliente some.
Filtros não removem candidatos: cada coluna traz `matchesCurrentFilters`. Rank/tier da recomendação é metadado e não reordena colunas.

## ComparisonDelta (preparação)

`deltas(snapshot, metricId)` → `{ metricId, candidateA, candidateB, rawDelta, relativeDelta (null com base 0), comparable }` só para métricas numéricas, sem interpretar "melhor".
