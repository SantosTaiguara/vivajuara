# Arquitetura de camadas do mapa (Map Layers)

Tópico 18. Implementação em `plat/src/map/layers.js` (`App.mapLayers`), configuração por empreendimento em `plat/config/layers/viva-juara.json`, seleção memoizada em `plat/src/state/selectors.js` (`selectRenderModel`) e desenho em `plat/src/presentation/map.js` (`render(model)`). As faixas e as cores continuam definidas em um único lugar, `plat/src/services/layers.js` (`App.services.layers`); `layers.js` lê essas definições e acrescenta metadados, status de valor, tokens, cobertura e estado.

Documentos relacionados: `MAP_LAYER_REGISTRY.md` (catálogo), `MAP_LAYER_SCALES.md` (escalas) e `MAP_STYLE_PRECEDENCE.md` (precedência visual).

## 1. Regra fundamental

Camada é representação visual. Uma camada nunca filtra, nunca recalcula score, Fit ou status e nunca esconde um lote. Trocar de camada não altera filtros, perfil do cliente, `FitScoreResult`, `RecommendationResult`, geometria, disponibilidade nem scores. O filtro só reduz a opacidade dos lotes fora do resultado (`dim`), sem recolorir.

## 2. Pipeline

```
Lot canônico + análise + FitScoreResult + RecommendationResult + FilterResult
  -> registry(devId)            MapLayerRegistry (definições congeladas por empreendimento)
  -> isLayerAvailable(def, ctx) a camada pedida pode ser usada neste contexto?
  -> scaleFor(def, lots, ctx)   ScaleDefinition sobre o empreendimento inteiro (cache por versão)
  -> valuesFor(def, lots, ...)  LayerValueResult por lote (lê valores já produzidos)
  -> coverage(values)           metadados de cobertura
  -> resolveStyle(...)          LotVisualStyle por lote (uma precedência)
  -> buildRenderModel(input)    MapRenderModel
  -> MapView.render(model)      o renderer só desenha
  -> App.legend.build(model)    a legenda usa o mesmo modelo (tópico 19)
```

## 3. Componentes

| Componente | Função em `layers.js` | Responsabilidade |
|---|---|---|
| MapLayerRegistry | `registry(devId)` | monta e congela as definições a partir de `THEMATIC`, `OVERLAYS`, `BASES` e da configuração; cache por empreendimento |
| Disponibilidade da camada | `isLayerAvailable(def, ctx)` | `{ available, hidden, reason }` por modo e pré-requisito |
| ScaleDefinition | `scaleFor(def, lots, ctx)` | constrói a escala uma vez sobre todos os lotes (nunca sobre o subconjunto filtrado) |
| LayerValueProvider | `valueOf`, `valuesFor` | `LayerValueResult` por lote; não recalcula nada |
| Cobertura | `coverage(values)` | contagem por `valueStatus`, `staleCount`, `expiredCount`, `coverageRatio` |
| LayerStyleResolver | `resolveStyle(input)` | `LotVisualStyle` com a precedência de `MAP_STYLE_PRECEDENCE.md` |
| MapLayerState | `defaultState`, reducers, `sanitizeState`, `migrate`, `fromStore`, `toStorePatch` | só configuração visual, nunca dado de lote |
| URL | `serialize`, `parse` | ids e chaves, nunca dados |
| MapRenderModel | `buildRenderModel(input)` | tudo o que o renderer e a legenda precisam |
| Texto | `valueText`, `tooltip`, `menu` | texto do valor (tooltip, aria, legenda) e menu de camadas |

## 4. Tipos de camada

`TYPES`: `BASE`, `THEMATIC_PRIMARY`, `CONTEXT_OVERLAY`, `INTERACTION_OVERLAY`, `REFERENCE_OVERLAY`, `LABEL`. O registro do Viva Juara tem 27 definições: 3 bases (Planta, Aérea, Híbrido), 15 camadas temáticas (14 `THEMATIC_PRIMARY` mais `none`, tipada como `BASE`) e 9 sobreposições. Uma única camada temática primária está ativa por vez (`primaryLayerId`); sobreposições se somam (`activeOverlayIds`). Detalhe em `MAP_LAYER_REGISTRY.md`.

## 5. MapLayerState

```
MapLayerState { schemaVersion, baseMapMode, baseMapBlend, primaryLayerId, activeOverlayIds, layerOpacities, layerSettings, lastUpdatedAt }
```

Padrão do Viva Juara (`defaultState('viva-juara')`, valores de `config/layers/viva-juara.json`): `baseMapMode = PLANT`, `baseMapBlend = 0.42`, `primaryLayerId = availability`, `activeOverlayIds = [recommendation, comparison, references]`, `layerOpacities = {}`, `layerSettings.score.scoreKey = housing`, `schemaVersion = 1`.

O `ApplicationState` (`plat/src/state/store.js`) guarda as chaves da versão 0, e `fromStore` / `toStorePatch` fazem a tradução:

| MapLayerState | Chave no store | Observação |
|---|---|---|
| `baseMapMode` (`PLANT`/`AERIAL`/`HYBRID`) | `backgroundLayer` (`plan`/`aerial`/`hybrid`) | `BASE_TO_STORE` / `STORE_TO_BASE` |
| `baseMapBlend` | `baseMapBlend` | opacidade da planta no modo Híbrido |
| `primaryLayerId` | `activeMapLayer` | |
| `activeOverlayIds` | `mapOverlays` | |
| `layerOpacities` | `layerOpacities` | |
| `layerSettings.score.scoreKey` | `scoreKey` | `housing`, `investment`, `family`, `premium`, `overall` |

Reducers puros (devolvem `{ state, ok, reason }`): `setPrimaryLayer` (recusa `UNKNOWN_LAYER` ou devolve o motivo de `isLayerAvailable`), `toggleOverlay` (`NOT_TOGGLEABLE`), `setBaseMapMode` (`UNKNOWN_BASE`), `setBaseMapBlend` (0 a 1, `OUT_OF_RANGE`), `setLayerOpacity` (0,1 a 1, só camadas com `supportsOpacity`), `resetLayersToDevelopmentDefault`. Na interface, `app.js` usa `setPrimaryLayer` (rádio `name="layer"`), `toggleOverlay`, `setBaseMapBlend` (controle "Transparência da planta", 10 a 90 %), o botão "Voltar ao padrão" (`layersReset`) e os botões Planta/Aérea/Híbrido (`data-act="bg"`). Trocar a base muda só `backgroundLayer`; viewport, lote selecionado, filtros e camada primária permanecem.

## 6. MapRenderModel

Saída de `buildRenderModel(input)`; entrada `{ developmentId, lots, layerState, mode, filter: { active, matchedIds }, selectedLotId, comparisonIds, favorites, recommendation, fit, fitKey, freshness, dataVersions, dataRevision, features, legendFocus }`.

| Campo | Conteúdo |
|---|---|
| `baseMap` | `{ mode, storeMode, blend, fillOpacity }` (0,55 na Planta, 0,8 em Aérea/Híbrido) |
| `primaryLayerId`, `requestedLayerId`, `layerError` | camada efetivamente desenhada, a pedida e o motivo da troca (`UNKNOWN_LAYER`, `LAYER_UNAVAILABLE`, `LAYER_ERROR`) |
| `def`, `scale`, `values` | definição, `ScaleDefinition` e `Map lotId -> LayerValueResult` |
| `lotStylesById` | `Map lotId -> LotVisualStyle` |
| `overlayFeatures` | `{ pins, recommendation (contagens por tier), comparison (ids) }` |
| `referenceFeatures`, `labels` | `{ visible }` |
| `layerMetadata` | `layerId, title, unit, scaleType, domainSource, dataVersion, note, coverage, layerAllStale, estimated` |
| `zOrder`, `precedence`, `timing.buildMs` | ordem formal, precedência e tempo de construção |

## 7. Seleção, cache e renderer

- `selectRenderModel(st)` em `selectors.js` é memoizado pela identidade de 16 entradas (lotes, camada, base, sobreposições, `scoreKey`, opacidades, modo, `FilterResult`, filtro ativo, lote atual, comparação, favoritos, recomendação, Fit, `legendFocus`, `dataRevision`). Um clique que só muda o hover não reconstrói o modelo.
- `dataVersions` vem de `repo.getDataVersions()`: `static`, `analysis`, `commercial` (`priceTableVersion`), `availability` (`'rev' + availabilityRevision`) e `fit` (`fitMethodologyVersion`). A escala só é refeita quando a versão da sua `versionKey` muda (ou, sem versão, quando muda `dataRevision`).
- `scaleCache` (limpo acima de 80 entradas) e `valuesCache` (limpo acima de 40) ficam em `layers.js`.
- Geometria: `MapView.init(lots)` cria os polígonos uma única vez. `render(model)` só altera, por lote, `style.fill`, `style.fillOpacity` (quando difere da base), as classes de estilo e o `aria-label`, comparando com o último valor gravado no nó (`__c`, `__op`, `__k`, `__a`). Depois reordena no DOM: comparação e recomendação acima, selecionado por último. Pontos de referência (`#gPoi`) seguem `referenceFeatures.visible`; os pins (HTML em `.pins`) vêm de `overlayFeatures.pins`.
- O renderer não busca dados. O traço (cor e espessura) é aplicado pelas classes CSS em `styles.css`, e não pelos campos `strokeToken`/`strokeWidth` do modelo (ver `MAP_STYLE_PRECEDENCE.md`).

Medido com `plat/tests/harness.js` em Node, 498 lotes: `buildRenderModel` + `App.legend.build` com cache frio levam cerca de 3 ms; `timing.buildMs` registra 1 a 3 ms por camada.

## 8. Paridade com o serviço anterior

O `MapRenderModel` produz exatamente a mesma cor por lote que `services/layers.js` (`compute(...).colorOf`) para todas as camadas e todas as chaves de score. Teste: `layer parity: every lot keeps exactly the colour of the previous layer service` em `plat/tests/map.test.js`. Ele percorre as 14 definições de `LY.DEFS`, com as 5 chaves de score na camada Score (18 combinações x 498 lotes = 8.964 comparações). Resultado verificado: 0 diferenças; `node --test map.test.js` passa nos 15 testes. A camada `fit` não existia no serviço anterior e não entra na comparação.

## 9. Fallback e erros

| Situação | Comportamento | Onde |
|---|---|---|
| id de camada desconhecido | desenha a camada padrão (`defaultPrimaryLayer`), `layerError = UNKNOWN_LAYER` | `buildRenderModel` |
| camada indisponível no contexto (Fit sem cliente, Classe/Score no modo cliente) | camada padrão, `layerError = LAYER_UNAVAILABLE` | `buildRenderModel` |
| escala com erro (`INVALID_SCALE`, `SCALE_BUILD_FAILED`) | camada `none` (só a planta), `layerError = LAYER_ERROR` | `buildRenderModel` |
| leitura de um lote falha | `valueStatus = ERROR` naquele lote; os demais continuam | `valueOf` |
| exceção no seletor | mensagem "Não foi possível carregar esta camada." e o mapa continua navegável | `renderMap` em `app.js` |
| troca recusada no menu | `toast(reason)` com o motivo | `app.js`, evento `change` |

Com `layerError`, a legenda avisa: "Não foi possível usar a camada pedida; mostrando a camada padrão."

## 10. Persistência e link

- As chaves de camada (`activeMapLayer`, `backgroundLayer`, `scoreKey`, `mapOverlays`, `baseMapBlend`, `layerOpacities`) são preferências persistidas em `localStorage` por `store.js`. Ao carregar, `store.sanitize` descarta camada, base ou sobreposição que não existam no registro.
- URL: `serialize` grava só o que difere do padrão, por exemplo `base=aerial&layer=score&score=family&ov=comparison` (`ov=-` quando nenhuma sobreposição compartilhável está ativa). Só entram no link as sobreposições com `shareable`. `parse` ignora parte malformada, base desconhecida, `score` fora da lista e `layer` fora de `^[a-zA-Z0-9_]{1,32}$`; o roteador (`App.router.parse`) também descarta id de camada que não está no registro.
- `sanitizeState` e `migrate` (v0 `activeMapLayer`/`backgroundLayer`/`scoreKey` para v1) estão prontos para estado salvo ou link, mas a aplicação usa `store.sanitize` e `router.parse`.

## 11. Modos

| Modo | Efeito nas camadas |
|---|---|
| cliente | Classe e Score ficam ocultas no menu (`clientVisible = false`); conflito aparece como "não disponível"; sem hachura técnica |
| corretor | todas as camadas do registro; Fit desabilitada com motivo até haver cliente |
| técnico | mesmo menu do corretor; a legenda mostra tipo de escala, domínio e versão |

O cabeçalho (`shell.html`) só oferece Corretor e Cliente; o modo técnico existe no código, mas não tem botão.

## 12. Não implementado / pendências

- Implementado em 08/10/2026: o resultado de busca (lote ou quadra) pisca no mapa por alguns instantes (classe `srch`, aplicada por `map.flash`, fora do `MapRenderModel`).
- Hover não faz parte do modelo: `hoverLotId` não é lido por `buildRenderModel`; o realce vem do CSS `.lot:hover` (só em dispositivos com `hover:hover`). O destaque dos lotes de um item da legenda (hover e foco) existe desde 08/10/2026.
- Implementado em 08/10/2026: controle de intensidade da cor no menu de camadas, só nas camadas que aceitam opacidade.
- `autoActivateOn: 'find'` da sobreposição de recomendação é só declarado; nenhum código o lê (a sobreposição já vem ligada por padrão).
- Fit como sobreposição (só existe como camada primária), sobreposição de distância e camada de qualidade de dado: não implementados.
- Implementado em 08/10/2026: camada indisponível volta para a camada anterior (`previousPrimaryLayerId`) antes da camada padrão do empreendimento.
- A análise solar "Sol agora" (`LY.solarNow`) ainda desenha pelo caminho antigo (`map.paint`, `setMarks`, `setPins`) e não passa pelo `MapRenderModel`. Ao entrar nesse caminho, `setMarks` remove as classes que só o modelo aplica (`rec`, `rev`, `lfocus`, `lfade`, `stale`, `conf`, `unk`) e força o próximo `render` a reestilizar todos os lotes.
- Adaptação de contraste entre Planta e Aérea, além da opacidade de preenchimento: não implementada.
- Renderer só em SVG; não há adaptador Canvas.
- Implementado em 08/10/2026: abaixo de 600 px o menu de camadas (como os demais popovers) abre como folha inferior.
- Analytics só em memória (`App.analytics`): `map_layer_changed`, `overlay_toggled`, `base_map_changed`.
