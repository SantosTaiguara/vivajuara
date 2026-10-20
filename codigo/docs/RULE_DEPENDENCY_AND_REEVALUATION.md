# Dependências e reavaliação seletiva (Tópico 36)

Cada versão compilada traz `dependencyManifest`: attributePaths, metricIds, predicateIds, contextKeys, analysisDefinitionIds, pricingDependencies, availabilityDependencies, analysisDependencies, staticDependencies, customerContextDependencies, checksum.

`App.ruleEngine.dependencyIndex(rules)` cria o índice reverso (`ATTRIBUTE:…`, `METRIC:…`, `ANALYSIS:…`, `EVENT:…` → códigos de regra). `plan(index, event)` devolve `{ ruleCodes, entityIds, reasonCodes }`.

| Evento | Regras afetadas no catálogo atual |
|---|---|
| PRICE_TABLE_CHANGED / COMMERCIAL_FRESHNESS_CHANGED | SHARE_PRICE_FROM_LAST_TABLE |
| AVAILABILITY_CHANGED | AVAILABILITY_CONFIRMATION, SHARE_NOT_OFFERABLE, SHARE_STATUS_NOT_CONFIRMED |
| ANALYSIS_VERSION_CHANGED (LOT_INTELLIGENCE_BASE) | as 10 regras da análise |
| STATIC_DATA_CHANGED | regras da análise (dependem da planta via análise) |
| CUSTOMER_CONTEXT_CHANGED / evento com `customerContextRef` | só regras CUSTOMER, só para a sessão/perfil indicado |
| evento não relacionado | nenhuma |

Regra sem dependência de preço não é reavaliada quando a tabela muda; idem para disponibilidade. O `evaluationFingerprint` (regra + versão + entidade + valores dos operandos) permite reutilizar uma avaliação quando nada relevante mudou.
