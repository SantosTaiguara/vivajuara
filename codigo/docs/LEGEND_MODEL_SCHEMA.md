# Esquema do modelo da legenda (LegendModel)

Tópico 19. Estruturas produzidas por `plat/src/map/legend.js`: `build(input)` devolve o `LegendModel` (congelado, sem texto formatado além dos rótulos da escala) e `viewModel(lm, opções)` devolve o `LegendViewModel` usado por `renderLegend` em `plat/src/presentation/app.js`. Arquitetura em `SMART_LEGEND_ARCHITECTURE.md`.

## 1. Entrada

```
LegendInput { model, lots, filter: { active, matchedIds }, selectedLotId, mode, developmentId, freshnessState }
```

`model` é o `MapRenderModel` do tópico 18; a legenda usa `model.def`, `model.scale`, `model.values`, `model.layerMetadata` e `model.overlayFeatures`. `lots` só é usado para calcular os limites das ações de filtro de Preço e Área.

## 2. LegendModel

| Campo | Tipo / conteúdo |
|---|---|
| `id`, `layerId` | `legend:<layerId>` e a camada desenhada (não a pedida) |
| `type` | `legendType` do registro: `STATUS`, `BINNED`, `CATEGORICAL`, `BOOLEAN` |
| `titleKey`, `subtitleKey`, `unit` | título da escala (ex.: "Score Moradia"), descrição e unidade do registro |
| `status` | `READY`, `PARTIAL`, `NO_DATA`, `ERROR` |
| `countMode` | `NONE`, `TOTAL_ONLY`, `FILTERED_AND_TOTAL` (`FILTERED_ONLY` existe em `COUNT_MODES`, sem uso na política) |
| `sections[]` | `LegendSection` (seção 3) |
| `coverageSummary` | `{ totalLots, validValueCount, noDataCount, unknownCount, staleCount, conflictedCount, coverageRatio, low }`; `low` = `coverageRatio < lowCoverageRatio` fora da Disponibilidade |
| `selectedIndicator` | seção 5, ou `null` sem lote selecionado |
| `freshnessSummary` | só para camadas com `freshnessKey`: `{ freshCount, staleCount, expiredCount, unknownCount, lastSyncAt, allStale }` |
| `dataQualitySummary` | fora do modo cliente, quando a camada é estimada ou há conflito: `{ estimatedCount, conflictedCount, highConfidenceCount, mediumConfidenceCount, lowConfidenceCount }` (as três últimas sempre `null`) |
| `scaleMetadata` | `{ scaleType, domainSource, dataVersion, binDefinitions[], clamped: false }` |
| `interactionMetadata` | `legendPolicy.interaction` |
| `versions` | `{ policy, registry, dataVersion }` |
| `invariant` | `{ ok, sumTotal, sumFiltered, expected }` |
| `note`, `estimated`, `filterActive`, `layerError` | nota da escala, camada estimada, filtro ativo, erro de camada do mapa |

Casos especiais: camada `none` devolve `sections: []`, `countMode: NONE`, `status: READY`; escala com erro devolve `status: ERROR` com `error`; exceção devolve `id: legend:error`, `status: ERROR`.

## 3. LegendSection

| Seção | `id` | Quando existe | Itens |
|---|---|---|---|
| principal | `primary` | sempre (exceto `none` e erro) | um por item da escala, mais baldes |
| recomendação | `recommendation` | sobreposição de recomendação ligada e alguma contagem > 0 | `PRIMARY` (Melhor opção), `STRONG_MATCH` (Forte aderência), `ALTERNATIVE` (Alternativa), `REVIEW_REQUIRED` (Revisar (status a confirmar)), com `totalCount` |
| comparação | `comparison` | sobreposição de comparação ligada e ao menos um lote na comparação | `{ key: lotId, number: 1..4, symbolToken, lotId }` |

Campos da seção: `id`, `type` (`OVERLAY` nas sobreposições), `titleKey`, `items`, `scale` (só na principal), `summary` (`{ matched, total }` com filtro), `priority` (0, 1, 2), `collapsible`.

Na Disponibilidade o item `UNKNOWN` sai da lista quando nenhum lote está nesse status, como no mapa publicado; os outros seis status ficam sempre, desabilitados quando têm 0 lotes.

## 4. LegendItem

| Campo | Conteúdo |
|---|---|
| `id`, `key`, `interactionKey` | `<layerId>:<key>`; `key` é a chave da faixa (`b0`, `AVAILABLE`, `yes`, ...) ou do balde (`#NO_DATA`, `#UNKNOWN`, `#CONFLICTED`, `#ERROR`) |
| `labelKey` | rótulo da escala; nos baldes "Sem dado", "Desconhecido", "Fontes divergentes", "Erro de leitura" (em escala neutra, "Sem informação") |
| `styleToken`, `color`, `patternToken`, `symbolToken` | mesmo token e cor da escala; hachura `pattern.unknown`/`pattern.conflicted` nos baldes, fora do modo cliente |
| `range` | `{ min, max, includeMin, includeMax }` nas faixas numéricas; `null` nas categorias |
| `totalCount`, `filteredCount` | lotes no empreendimento; lotes no filtro (`null` sem filtro) |
| `selected` | o lote selecionado está neste item |
| `disabled` | `totalCount = 0` |
| `bucket` | `NO_DATA`, `UNKNOWN`, `CONFLICTED` ou `ERROR` nos baldes |
| `filterAction` | `{ patch, label }` ou `null` (ver `LEGEND_INTERACTION_POLICY.md`) |

No modo cliente, `CONFLICTED` é somado ao balde "Sem dado" (ou vira um balde `#NO_DATA` com esse rótulo).

## 5. SelectedLegendIndicator

```
{ lotId, rawValue, normalizedPosition, binId, valueStatus, freshness, special }
```

`normalizedPosition` = `(valor - mínimo) / (máximo - mínimo)` sobre todos os valores numéricos da camada, só quando a escala tem faixas numéricas. Sem variação: `0.5` e `special = ZERO_RANGE` (sem divisão por zero). Fora do domínio: limitado a 0..1 e `special = OUT_OF_DOMAIN`. Exemplo real (B79, camada Preço): `rawValue 348968.88`, `binId b2`, `normalizedPosition ≈ 0,082`, `valueStatus AVAILABLE`, `freshness FRESH`.

## 6. LegendViewModel

| Campo | Conteúdo |
|---|---|
| `title` | título; na camada Fit fora do modo cliente e com nome do cliente, "Compatibilidade com <nome>" |
| `subtitle`, `status`, `countMode`, `note`, `estimated` | repassados do modelo |
| `items[]` | `{ key, label, color, pattern, count, aria, selected, disabled, filterAction, interactive }`; `count` é "159" (total), "210 / 210" (filtrados / total) ou vazio |
| `filterSummary` | "<m> de <t> correspondem aos filtros." |
| `selected` | `{ code, text, position }`; texto "QB L79 · R$ 320 mil a R$ 360 mil" ou "Lote selecionado: sem dado nesta camada.", com " (último valor conhecido)" se `STALE` |
| `warnings[]` | baixa cobertura, frescor comercial, camada pedida indisponível |
| `coverage` | "Com dado: X de Y lotes." fora do modo cliente, com cobertura < 1 e fora da Disponibilidade |
| `overlays[]` | `{ id, title, items: [{ key, label, number, lotId, count, symbol }] }` |
| `technical` | `{ scaleType, domainSource, dataVersion, policy }` nos modos corretor e técnico; `renderLegend` só desenha no técnico |

Exemplo (Preço, corretor, sem filtro): itens "Até R$ 300 mil" 159, "R$ 300 mil a R$ 320 mil" 51, "R$ 320 mil a R$ 360 mil" 129, "R$ 360 mil a R$ 400 mil" 54, "Acima de R$ 400 mil" 105; nota "Faixas calculadas a partir dos preços da tabela atual."

## 7. LegendState

`defaultState()` = `{ expanded: true, pinned: false, activeSectionId: 'primary', focusedItemId: null, showCounts: true, schemaVersion: 1 }`. `focus(state, layerId, itemKey)` alterna o foco; `clearFocus` limpa; `onLayerChange` limpa o foco de outra camada; `persistable` guarda só `expanded`, `pinned`, `showCounts` (nunca o foco).

Na aplicação, o estado efetivo fica no store (`plat/src/state/store.js`): `legendFocus` (`{ layerId, itemKey }`, transitório, nunca salvo) e `legendExpanded` (`null` = decidir pela largura; salvo como preferência). Nenhum dado calculado entra nesse estado.

## 8. Não implementado / pendências

- `pinned`, `showCounts` e `activeSectionId` não têm efeito na interface.
- Faixas de confiança (`highConfidenceCount` etc.) e `clamped` são sempre `null`/`false`.
- Não há `LegendDefinition` separada por camada; a legenda é sempre gerada da `ScaleDefinition` e do registro.
