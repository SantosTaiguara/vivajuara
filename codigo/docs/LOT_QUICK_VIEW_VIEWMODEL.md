# Lot Quick View: view model

Tópico 20. `LotQuickViewViewModel` versão 2 (`VIEWMODEL_VERSION = 2`), produzido por `App.quickView.build(lot, input)` em `plat/src/quickview/quickview.js` e chamado por `App.vm.quickViewVM(lot, ctx)` em `plat/src/presentation/viewmodels.js`. O componente `App.panels.quick` só lê este objeto. Arquitetura em `LOT_QUICK_VIEW_ARCHITECTURE.md`.

## 1. Entrada do construtor

```
{ dev, cfg, mode, presentation, objective, prefs, favorites, compareIds, view,
  filter: { active, matchedIds, query, ctx }, fit (FitScoreResult deste lote), customer { id, name },
  recommendation (RecommendationResult), activeLayerId, connectivity, showRoute, statusVM }
```

`quickViewVM` monta essa entrada a partir do `ctx()` de `app.js`: `fit = fitById.get(lotId)`, `customer` só existe quando há resultado de Fit, `presentation` vem de `ctx.presentation` (a aplicação não define esse campo).

## 2. Estrutura

| Campo | Conteúdo | Origem |
|---|---|---|
| `viewModelVersion`, `lotId` | 2; id canônico | — |
| `loadStatus`, `partialErrors` | `READY` ou `PARTIAL`; blocos que falharam (`intelligence`, `fit`) | `try/catch` por bloco |
| `context` | `QuickViewContext` | `resolveContext` |
| `identity` | `{ displayCode, blockNumber, lotNumber, title, canonicalId }`; `canonicalId` é `null` no modo cliente | `lot.identity`, `F.formatLotTitle` |
| `availability` | resultado de `statusVM` (seção 3) | `viewmodels.js` |
| `commercial` | `{ price, priceText, pricePerM2, pricePerM2Text, freshness, note, priceTableVersion }` | `lot.commercial`, `lot.metadata` |
| `metrics[]` | área (P0), preço (P0), preço/m² (P1), até `maxMetrics`; cada um com `fieldKey`, `status` (proveniência) e `note` | seção 4 |
| `intelligence` | só com `showScore`: `{ primaryScore, cls, keyAttributes, analysisVersion }` | seção 5 |
| `customerFit` | só com cliente ativo (seção 6) | `FitScoreResult` |
| `recommendation` | `{ rank, tier, total, label }` quando o lote está no resultado | `RecommendationResult` |
| `comparison` | `{ index, total }` quando o lote está na comparação | store |
| `outsideFilter` | `{ reasons: [{ filterId, unknown, label }] }` quando o filtro está ativo e o lote não corresponde | `App.filters.whyNot` |
| `highlights[]` | seção 7 | `selectHighlights` |
| `alerts` | seção 8 | `alertSummary` |
| `facts[]` | com `showFacts`: "Ruído provável", "Privacidade", "Sol do norte" | `lot.environmental` |
| `freshness` | `{ availability, commercial }`; `null` no modo cliente | `lot.availability`, `lot.metadata.freshness` |
| `provenanceSummary` | `{ estimatedFields }`: quantos de ruído, privacidade e trânsito são estimados | proveniência |
| `actions[]`, `capabilities` | ver `LOT_QUICK_VIEW_ACTIONS.md` | `actions`, `capabilities` |
| `uiHints` | `{ primaryMetricKey, emphasizedFieldKeys, showRecommendationRank, showFit, showFreshnessWarning }` | contexto |
| `bestFor` | "Mais indicado para <perfis>", fora do modo cliente | `intelligence.idealProfiles` |
| `dataVersions` | só no modo técnico | `lot.metadata.dataVersions` |

Campos legados mantidos para o cabeçalho dos detalhes e outros leitores: `id`, `code`, `title`, `displayCode`, `techId`, `status`, `outOfFilters`, `cls`, `primaryScore`, `keyAttributes`, `isFavorite`, `inComparison`, `comparisonFull`, `primaryAction { id, label }`, `simulation { allowed }`.

## 3. Status (statusVM)

Sempre com texto, cor e aviso; nunca só cor.

| Situação | Rótulo | Nota (corretor) | Nota (cliente) |
|---|---|---|---|
| `UNKNOWN` | Status não confirmado | "Sem espelho de vendas: confirme com a loteadora" | "Disponibilidade sujeita a confirmação" |
| frescor `EXPIRED` | rótulo do status | "Informação vencida, confirme antes de oferecer" (+ idade) | "Disponibilidade sujeita a confirmação" |
| frescor `STALE` | rótulo do status | "Disponibilidade não confirmada" (+ última atualização) | "Disponibilidade sujeita a confirmação" |
| `AVAILABLE` sem frescor `FRESH` | "Disponível, não confirmado agora" | — | "Disponível (sujeito a confirmação)" |
| confirmado com data | rótulo do status | "Atualizado <idade>" | — |

`reservedUntil` (com "(vencida)" quando expirou) e `reason` só fora do modo cliente. Hoje os 498 lotes estão `UNKNOWN`.

## 4. Comercial e métricas

`priceText` é "Não disponível" quando o preço é nulo. Nota de preço (`priceNote`):

| Frescor comercial | Corretor | Cliente |
|---|---|---|
| `FRESH` ou ausente | — | — |
| `STALE` | "Baseado na última tabela disponível" | "Valor sujeito a confirmação" |
| `EXPIRED` | "Tabela vencida: não use para fechar negócio" | "Valor sujeito a confirmação" |
| `UNKNOWN` | "Preço não disponível" | "Preço não disponível" |

`priceTableVersion` só no modo técnico. A proveniência de cada métrica fica em `metrics[].status` (no B79: área `CONFIRMED`, preço `CALCULATED`, preço/m² `CONFIRMED`).

## 5. Inteligência

Só nos modos com `showScore` (corretor e técnico). `primaryScore` vem do resolvedor existente `App.services.scoring.primaryScore(lot, cfg, objective)`, nunca de cálculo local, com `formatted` (ex.: "91/100") e `rankingText` ("4º de 498 em Moradia"). `cls` é `null` quando a classe é `UNKNOWN`. `keyAttributes` vem de `scoring.keyAttributes` (3 itens, `quickViewKeyAttributeCount`), cada um com "<nota>/10" ou "Não disponível".

## 6. Compatibilidade com o cliente

Existe só quando há cliente ativo e o Fit não é `INSUFFICIENT_PROFILE`: `{ status, fitScore, pct, coverage, confidence, label, customerLabel, lowCoverage, partial, staleCommercial, note }`. `label` é "<n>% compatível" ou "Compatibilidade não calculada" (Fit nulo nunca vira 0%). `lowCoverage` quando a cobertura é menor que 0,5 ("Poucos dados para este perfil."). `note` "Resultado sujeito a confirmação de preço e disponibilidade" quando disponibilidade ou preço não estão `FRESH`. `customerLabel` é o nome do cliente, nunca no modo cliente. Nunca é apresentado como probabilidade de compra (teste no modo cliente).

## 7. Destaques

`selectHighlights` junta duas fontes e devolve no máximo `maxHighlights` (3, 4 ou 5 por modo):

1. Destaques da análise (`lot.intelligence.highlights`): prioridade = peso do destaque + 3 se o tema coincide com um ponto forte do perfil + 2 se coincide com a camada ativa do mapa.
2. Pontos fortes do Fit (`fit.strengths`, só com cliente): "Atende ao perfil: <preferência>", prioridade 3 + 4 x contribuição ponderada.

Ordena por prioridade (empate: destaque da análise primeiro), mantém um item por tema (`TOPIC`: verde, silêncio, privacidade, trânsito, sol, portaria, clube, área, geometria, preço, vista) e descarta destaque positivo cujo campo de evidência está `UNKNOWN`. Cada destaque traz `reasonCode`, `fieldKey`, `evidenceRef`, `status`, `matchesCustomer` e `layerContext`. Alertas nunca entram como destaque positivo.

Exemplo real (B79, corretor, sem cliente): "Mata ou parque nos fundos", "Boa privacidade (estimativa)", "Rua silenciosa (estimativa)", "Fundos com sol do norte".

## 8. Alertas

`alertSummary` devolve `criticalCount`, `importantCount`, `attentionCount`, `infoCount`, `total`, `hasBlockingAlert` (há crítico), `topAlerts` e `moreCount`. `topAlerts` = críticos, importantes e de atenção, por severidade, cortados em `max(maxAlerts, críticos + importantes)`: crítico e importante nunca ficam de fora. Informativos só contam em `moreCount`, com o botão "Mais <n> pontos nos detalhes". Na base atual: 102 importantes, 221 de atenção e 81 informativos, nenhum crítico. B79 tem 1 importante ("APP/mata nos fundos (citada no evento); confirmar faixa não edificável").

## 9. Fora do filtro

Com filtro ativo e lote fora do resultado, `outsideFilter.reasons` lista cada filtro que exclui o lote com rótulo legível (`preço`, `área`, `situação`, `mata nos fundos`, ...; " (sem dado)" quando o lote não tem o dado). O painel mostra "Fora dos filtros atuais (preço). O lote continua selecionável." A consulta de filtro não é alterada.

## 10. Não implementado / pendências

- Implementado em 08/10/2026: `metrics[].status` e o status dos fatos aparecem como selo de origem, e `provenanceSummary` alimenta a nota "Estimados nesta ficha" (modo corretor).
- Não há frente, formato ou esquina entre as métricas (ficam nos detalhes).
- Implementado em 08/10/2026: com `context.offline` em `OFFLINE`, a Quick View mostra aviso próprio, além da barra global `#netbar`.
- `confidence` dos destaques da análise é sempre `null`.
