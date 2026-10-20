# ComparisonSession — schema (Tópico 24)

```
ComparisonSession {
  id: "cmp_<uuid>", developmentId, schemaVersion: 1, revision,           // revision sobe a cada mudança (proteção contra resposta antiga)
  candidates: ComparisonCandidate[], candidateIds, candidateOrder,         // candidateIds = candidateOrder (ordem explícita)
  context: ComparisonContext, metricProfileId, status, createdAt, updatedAt, snapshotRef: null
}
ComparisonCandidate { lotId, displayCode, order, addedAt, addedFrom, validationState }
  // availabilitySummary, commercialSummary e freshness são lidos ao montar o snapshot (dados vivos não ficam na sessão)
ComparisonPolicy { minCandidates: 2, maxCandidates: 4, requireSameDevelopment: true, allowSold: true, allowUnavailable: true,
  allowUnknownAvailability: true, allowStaleCommercial: true, preserveCandidateOnStatusChange: true, defaultMetricProfileId: "BROKER_STANDARD", version }
ComparisonContext { mode: GENERAL|CUSTOMER|RECOMMENDATION|TECHNICAL|PRESENTATION, customerId?, customerProfileVersion?, activeLayerId?,
  recommendationSessionId?, filterQueryHash?, scoreKey (objetivo: housing…), locale: "pt-BR", currency: "BRL" }
```

- `addedFrom`: MAP, SEARCH, RECOMMENDATION, QUICKVIEW, FAVORITES, DEEP_LINK, RESTORE (contexto, não altera valores).
- `validationState`: VALID, MISSING, WRONG_DEVELOPMENT, DUPLICATE, INACCESSIBLE.
- `status`: DRAFT (<2), READY; o snapshot pode rebaixar para PARTIAL, STALE ou INVALID; ARCHIVED reservado.
- Invariante de contexto: com `customerProfileVersion` o modo GENERAL vira CUSTOMER; sem cliente, CUSTOMER/RECOMMENDATION voltam a GENERAL. `customerId` aceita só id opaco (≤ 80 caracteres), nunca nome/telefone.

## Operações (`App.compare.domain`, puras: devolvem `{ ok, session, code?, message?, validationState? }`)

`createSession(devId, opts)`, `addCandidate(s, idOuCódigo, { resolve, source })`, `removeCandidate`, `reorderCandidates(s, ordem)` (só permutação),
`moveCandidate(s, id, ±1)` (alternativa de teclado ao arrastar), `replaceCandidate`, `clear`, `setContext`, `setMetricProfile`,
`syncFromIds(prev, devId, ids, opts)` (ponte com `comparisonLotIds`), `buildSnapshot`, `buildMatrix`, `restore`, `serialize`.
`createService({ developmentId, resolve })` envolve tudo num `ComparisonStore` com eventos sem PII: `comparison_started`, `comparison_candidate_added`, `comparison_candidate_removed`, `comparison_opened`, `comparison_profile_changed`, `comparison_shared`, `comparison_cleared`.

Mensagens: duplicado → "Este lote já está na comparação."; limite → "A comparação aceita até 4 lotes. Remova um lote antes de adicionar outro."

## Persistência, migração, deep link e share

- `serialize(s)` → `{ v, developmentId, candidateIds, metricProfileId, contextMode }` — sem valores vivos e sem identidade de cliente.
- `ComparisonSessionMigrationRegistry` (`MIGRATIONS`): v0 = array simples de ids (formato do store) → v1.
- `restore(raw, { developmentId, resolve, customerProfileVersion })` valida lotes, empreendimento, limite, perfil e cliente. Cliente ausente → Fit retirado, modo GENERAL, perfil CUSTOMER → BROKER_STANDARD, lotes mantidos. Lote inexistente → removido com aviso.
- Deep link: mesma gramática do router (`<dev>.compare.<code>~<code>`) e também `?compare=ID,ID`. IDs inválidos, `<script>`, mais de 4 ou outro empreendimento nunca derrubam a aplicação (avisos).
- `sharePayload(s, { codeOf, baseUrl, snapshot })` → `{ developmentId, candidateIds, metricProfileId, contextMode, deepLink, versionSummary }`; o texto de WhatsApp continua no ShareService.

## Store e UI state

`createStore()` guarda `{ session, snapshot, matrix, token }` e, separado, `ui = { expandedGroupIds, scrollPosition, focusedCandidateId, focusedMetricId, layoutVariant }`.
Na UI atual o estado de interface vive em `App.compareView.ui` (grupos abertos, perfil escolhido, foco após mover).
Seletores: `selectComparisonSession`, `selectComparisonCandidates`, `selectComparisonSnapshot`, `selectComparisonMatrix`, `selectComparisonSummary`, `selectComparisonWarnings`, `selectComparisonCanAddLot`, `selectComparisonCandidateState`.
