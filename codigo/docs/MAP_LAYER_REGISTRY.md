# Registro de camadas do mapa (MapLayerRegistry)

Tópico 18. Implementação em `plat/src/map/layers.js` (`App.mapLayers.registry`, `isLayerAvailable`, `menu`), com metadados em `THEMATIC`, `OVERLAYS` e `BASES`, faixas em `plat/src/services/layers.js` (`DEFS`) e configuração por empreendimento em `plat/config/layers/viva-juara.json`. Visão geral em `MAP_LAYER_ARCHITECTURE.md`.

## 1. Como o registro é montado

`registry(devId)` (cache por empreendimento):

1. Lê a configuração (`cfgOf(devId)` = `App.configs.layers[devId]`; sem arquivo, usa um padrão interno com todas as camadas).
2. Percorre `layerOrder` e mantém só as camadas presentes em `enabledLayers` que tenham metadado em `THEMATIC` e definição em `services/layers.js` (`LY.BY[id]`). A única exceção é `fit`, que não existe no serviço antigo.
3. Aplica `layerOverrides` (hoje só rótulo e visibilidade; nunca escala nem significado).
4. Acrescenta as 3 bases e as 9 sobreposições. Todas as definições são congeladas (`Object.freeze`).

Visibilidade por modo: `client` vem de `services/layers.js` (`client: true/false`), depois `THEMATIC[id].visibility` e por fim `layerOverrides[id].visibility`; `broker` e `technical` são `true`, salvo override.

## 2. MapLayerDefinition (camadas temáticas)

| Campo | Significado |
|---|---|
| `id`, `type`, `version` | id estável; `THEMATIC_PRIMARY` (ou `BASE` para `none`); `REGISTRY_VERSION = 1.0.0` |
| `label`, `group`, `groupLabel` | rótulo (override > `THEMATIC.label` > `services/layers.js`), grupo e rótulo do grupo |
| `valueSource` | `DYNAMIC`, `COMMERCIAL`, `STATIC`, `ANALYSIS`, `FIT` ou `NONE` |
| `fieldKey`, `metricKey` | caminho canônico no Lot (`App.model.get`) ou métrica do resultado |
| `valueType` | `ENUM`, `MONEY`, `NUMBER`, `SCORE`, `PERCENT`, `ORDINAL`, `BOOLEAN`, `DISTANCE`, `NONE` |
| `renderMode` | `FILL` (ou `NONE`) |
| `scale` | `{ type, domainSource, versionKey, params }` (ver `MAP_LAYER_SCALES.md`) |
| `unit` | `BRL`, `BRL_PER_M2`, `M2`, `POINTS`, `PERCENT`, `M` ou `null` |
| `legendType` | `STATUS`, `BINNED`, `CATEGORICAL`, `BOOLEAN` |
| `description`, `estimated` | texto curto; `true` para estimativas (ruído, privacidade, trânsito) |
| `freshnessKey` | `availability` ou `commercial` quando o valor é dinâmico |
| `unknownIsCategory` | `UNKNOWN` é uma categoria própria (só em Disponibilidade) |
| `setting` | parâmetro da camada (`scoreKey` na camada Score) |
| `requires` | pré-requisitos verificados por `isLayerAvailable` |
| `clientVisible`, `brokerVisible`, `technicalVisible` | visibilidade por modo |
| `supportsOpacity`, `zIndex`, `sortOrder` | opacidade ajustável (todas menos `none`), `THEMATIC_FILL`, posição no menu |

## 3. Camadas temáticas do Viva Juara

Ordem de `layerOrder`. Todas as 15 estão em `enabledLayers`.

| id | Rótulo | Grupo | Fonte | fieldKey | Escala | Unidade | Cliente | Requer |
|---|---|---|---|---|---|---|---|---|
| `availability` | Disponibilidade | Comercial | DYNAMIC | `availability.status` | CATEGORICAL | — | sim | — |
| `price` | Preço | Comercial | COMMERCIAL | `commercial.price` | QUANTILE | BRL | sim | dados comerciais |
| `pricePerM2` | Preço por m² | Comercial | COMMERCIAL | `commercial.pricePerM2` | CATEGORICAL | BRL_PER_M2 | sim | dados comerciais |
| `area` | Área | Comercial | STATIC | `geometry.areaM2` | QUANTILE | M2 | sim | — |
| `class` | Classe | Inteligência | ANALYSIS | `intelligence.class` | CATEGORICAL | — | não | análise |
| `score` | Score | Inteligência | ANALYSIS | `intelligence.scores` (+ `scoreKey`) | FIXED_BINS | POINTS | não | análise |
| `fit` | Compatibilidade com o cliente | Cliente | FIT | — (`fitScore`) | THRESHOLD | PERCENT | sim | cliente |
| `noise` | Ruído (estimativa) | Conforto | ANALYSIS | `environmental.noiseLevel` | CATEGORICAL | — | sim | — |
| `privacy` | Privacidade (estimativa) | Conforto | ANALYSIS | `environmental.privacyLevel` | CATEGORICAL | — | sim | — |
| `sun` | Sol nos fundos (orientação) | Conforto | STATIC | `environmental.orientationRear` | CATEGORICAL | — | sim | dados solares |
| `forest` | Mata / área verde nos fundos | Conforto | STATIC | `surroundings.hasGreenRear` | CATEGORICAL | — | sim | — |
| `traffic` | Trânsito (estimativa) | Localização | ANALYSIS | `mobility.estimatedTraffic` | CATEGORICAL | — | sim | — |
| `gate` | Distância à portaria | Localização | STATIC | `mobility.gateProximity` | THRESHOLD | M | sim | — |
| `leisure` | Distância ao clube | Localização | STATIC | `mobility.routeDistanceToLeisureM` | THRESHOLD | M | sim | — |
| `none` | Sem camada (só a planta) | Base | NONE | — | — | — | sim | — |

O rótulo "Sol nos fundos (orientação)" vem de `layerOverrides.sun`. Ruído, privacidade e trânsito são marcados `estimated` (valores estimados, nunca medição). Ruído e trânsito são camadas distintas: trânsito é "Fluxo relativo de veículos estimado pelas rotas internas (não é ruído)".

## 4. Sobreposições e bases

| id | Tipo | Rótulo | Liga/desliga | Canal | Compartilhável | Observação |
|---|---|---|---|---|---|---|
| `recommendation` | CONTEXT_OVERLAY | Recomendação | sim | contorno + pin | sim | `autoActivateOn: 'find'` declarado, sem uso |
| `comparison` | CONTEXT_OVERLAY | Comparação | sim | contorno + número | sim | |
| `routes` | REFERENCE_OVERLAY | Rotas | não | linha | não | "Aparece somente quando uma rota é pedida no lote." |
| `references` | REFERENCE_OVERLAY | Pontos de referência | sim | símbolo | sim | POIs (`#gPoi`) |
| `selected` | INTERACTION_OVERLAY | Lote selecionado | não (sempre ativo) | contorno | — | |
| `hover` | INTERACTION_OVERLAY | Lote sob o cursor | não (sempre ativo) | contorno | — | `desktopOnly` |
| `filterDim` | INTERACTION_OVERLAY | Fora dos filtros | não (sempre ativo) | opacidade | — | |
| `favorites` | INTERACTION_OVERLAY | Favoritos | não (sempre ativo) | contorno tracejado | — | |
| `labels` | LABEL | Rótulos | não (sempre ativo) | texto | — | fora de `registry.overlays` |

Bases (`BASES`): `base.plant` (Planta), `base.aerial` (Aérea), `base.hybrid` (Híbrido), todas `BASE_MAP`. No Híbrido a planta fica por cima da imagem aérea com `baseMapBlend` (padrão 0,42).

O menu de sobreposições mostra só as que têm `toggle: true`: Recomendação, Comparação e Pontos de referência.

## 5. Disponibilidade de uma camada

`isLayerAvailable(def, ctx)` devolve `{ available, hidden, reason }`:

| Condição | Resultado | Motivo exibido |
|---|---|---|
| definição inexistente | indisponível e oculta | "Camada inexistente." |
| invisível no modo atual | indisponível e oculta | "Camada técnica." |
| `requiresCustomerContext` sem resultados de Fit | desabilitada com motivo | "Selecione um cliente com preferências." |
| `requiresCommercialData` e nenhum lote com preço | desabilitada | "Sem tabela de preços carregada." |
| `requiresAnalysis` e nenhum lote com classe diferente de `UNKNOWN` | desabilitada | "Análise ainda não disponível." |
| `requiresSolarData` com `features.solarAnalysis === false` | desabilitada | "Orientação solar não disponível neste empreendimento." |

Uma camada que pintaria um mapa vazio fica desabilitada com o motivo, em vez de sumir. No Viva Juara (`features.solarAnalysis = true`, 498 lotes com preço e análise), sem cliente, o menu fica assim (`menu(ctx)`):

| Modo | Grupos e camadas |
|---|---|
| cliente | Comercial (Disponibilidade, Preço, Preço por m², Área); Cliente (Compatibilidade, desabilitada); Conforto (Ruído, Privacidade, Sol, Mata); Localização (Trânsito, Portaria, Clube); Base (Sem camada) |
| corretor / técnico | os mesmos, mais Inteligência (Classe, Score) |

O menu (`App.panels.layerMenu`) tem a base em grupo separado, a escolha "Visualizar por" em `radiogroup` por grupo, o seletor "Qual score" (somente com a camada Score e fora do modo cliente), as sobreposições e "Voltar ao padrão".

## 6. Arquivo de configuração

`plat/config/layers/viva-juara.json` (`kind: map-layer-config`, `version 1.0.0`, `schemaVersion 1`):

| Chave | Valor no Viva Juara |
|---|---|
| `defaultPrimaryLayer` | `availability` |
| `defaultBaseMap` | `PLANT` |
| `hybridBlend` | `0.42` |
| `enabledLayers` | as 15 camadas |
| `layerOrder` | availability, price, pricePerM2, area, class, score, fit, noise, privacy, sun, forest, traffic, gate, leisure, none |
| `defaultOverlays` | recommendation, comparison, references |
| `groups` | COMMERCIAL Comercial, INTELLIGENCE Inteligência, CUSTOMER Cliente, COMFORT Conforto, LOCATION Localização, BASE Base |
| `layerOverrides` | `sun.label = "Sol nos fundos (orientação)"` |
| `legendPolicy` | política da legenda (ver `SMART_LEGEND_ARCHITECTURE.md`) |

Nota do arquivo: "Faixas e cores das camadas são as mesmas do painel publicado (services/layers.js). Este arquivo só habilita, ordena e agrupa camadas deste empreendimento; não altera significado de nenhuma escala."

## 7. Como acrescentar uma camada

1. Definição de faixas em `services/layers.js` (`DEFS`: `id`, `fieldKey`, `label`, `client`, `build(items, opts)`). Sem ela a camada é ignorada pelo registro.
2. Metadado em `THEMATIC` (`layers.js`): grupo, fonte, tipo de valor, tipo de escala, `versionKey`, unidade, tipo de legenda, pré-requisitos.
3. Habilitar e ordenar em `enabledLayers` e `layerOrder` do empreendimento.
4. Rodar `plat/tests/map.test.js` (paridade, estabilidade da escala, invariantes da legenda).

## 8. Não implementado / pendências

- Camada de qualidade de dado (confiança, dado ausente, conflito) e camada de preço privada: não existem.
- `layerOverrides` só é aplicado a rótulo e visibilidade; não há override de cor ou de faixas (por decisão: significado não muda por empreendimento).
- `REGISTRY_VERSION` é fixo no código; não há histórico de versões do registro.
- O modo técnico não acrescenta camadas próprias (proveniência, confiança); o menu é igual ao do corretor.
