# Semântica de estado em filtros, ordenação, comparação, regras e compartilhamento (Tópico 37)

## Filtros
- `evaluateRange` / `evaluateEquals` → `FilterEvaluation` MATCH, NO_MATCH, UNKNOWN, NOT_APPLICABLE, ERROR. Área desconhecida em "≥ 300 m²" é UNKNOWN (não é 0, não é falha).
- `applyFilterPolicy(ev, FilterUnknownPolicy)`: EXCLUDE (padrão), INCLUDE, INCLUDE_WITH_WARNING, SEPARATE_BUCKET ("Sem dado"); o motivo UNKNOWN fica no diagnóstico.
- `facetCounts`: known / unknown / notAvailable / notApplicable / conflicted / pending / invalid / error / partial / restricted; HIDDEN nunca é contado.
- O `App.filters` existente já exclui nulos de faixas e tem `includeUnknown`; teste confirma que não houve regressão.

## Ordenação
`comparator(dir, { unknown: LAST|FIRST|ERROR, tieBreaker })` e `sortWithUnknown(..., { unknown: 'SEPARATE' })`: sem sentinela numérica (sem ±Infinity); desempate estável por id.

## Comparação e vencedor (Tópicos 24/25)
- `toComparisonValueStatus(resolved)` → VALID / NO_DATA / UNKNOWN / NOT_APPLICABLE / CONFLICTED / ERROR.
- `comparability(entries, { minValid: 2 })` → INSUFFICIENT_DATA quando só um candidato tem dado; EXPIRED não é utilizável.
- `criterionWinner.js` já devolve INSUFFICIENT_DATA para um único valor válido (teste dourado ComparatorInsufficientData); nenhuma regra do 25 foi alterada.

## Restrições, Fit, Recommendation, Rule Engine
- `evaluateConstraint(resolved, op, expected)` → PASS / FAIL / UNKNOWN / NOT_APPLICABLE / ERROR; RESTRICTED → UNKNOWN (dado restrito nunca vira "ausente e aprovado").
- `App.recommendation.evaluateConstraint` já devolve UNKNOWN para preço nulo (teste). Política EXCLUDE / REVIEW_REQUIRED / ALLOW_WITH_WARNING permanece do Tópico 15.
- Fit (Tópico 14) já trata missing ≠ zero; não alterado.
- `toRuleOperand(resolved)` → `{ status: UNKNOWN|KNOWN|NOT_APPLICABLE|ERROR, value }` para o Tópico 36 (Rule Engine ainda não existe neste código).

## Valores derivados
`derive(inputs, fn, DerivedStatePolicy)` → `AnalysisOutput { value, dataState, reasonCode, trace }`; entrada desconhecida → NOT_AVAILABLE / MISSING_REQUIRED_INPUT (nunca preço/0); exceção ou NaN → ERROR / PROCESSING_FAILED.

## Compartilhamento e exportação
- `shareLine(label, resolved, { policy })` com `DataStateSharePolicy`: padrão (UNKNOWN/NOT_AVAILABLE rótulo, NOT_APPLICABLE omite, conflito aviso, stale com ressalva); crítico (comercial/disponibilidade: unknown com ressalva "confirmar com o corretor", conflito BLOCK_SHARE). HIDDEN/RESTRICTED nunca aparecem.
- `exportCells(r, { technical })`: técnico `{ value, state, reason, freshness }` (códigos); cliente: rótulo humano.

## Mapa e legenda
`mapBucket(resolved, binOf)`: desconhecido não entra em faixa — estilo neutro `map-nodata` com hachura e legenda "Sem dado"; NOT_APPLICABLE e CONFLICTED com estilos próprios. `legendCounts` → withData / noData / conflicted / notApplicable.

## Cache e tenant
`cacheKey` inclui organizationId, developmentId, entityId, attributePath, fingerprint de dataVersionRef e o escopo de projeção (projeção nunca compartilhada entre audiências).
