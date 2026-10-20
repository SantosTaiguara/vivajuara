# Motor de inteligência (IntelligenceEngine)

Tópico 12. Implementação em `plat/src/intelligence/engine.js` (`App.intelligence`), com a matemática compartilhada em `plat/src/intelligence/math.js` (`App.imath`), as normalizações em `plat/src/intelligence/normalization.js` (`App.inormalize`), a metodologia compilada em `plat/src/intelligence/methodology.js` (`App.methodology`, ver `SCORING_CONFIGURATION.md`) e o texto legado em `plat/src/intelligence/textAdapter.js` (`App.analysisText`). Testes em `plat/tests/intelligence.test.js`.

## 1. Situação atual

- Os valores exibidos na interface (scores, classe, rankings, alertas, destaques) continuam vindo da análise publicada no lots.json (`Lot.intelligence`, `analysisVersion = "2026-10-06"`). O motor não roda no carregamento do app.
- O motor roda no navegador só no popover "Como o score foi calculado" (`openTechExplain` em `src/presentation/app.js`): baixa `analysis-input.json`, compila `App.methodology.current(devId)` e chama `analyzeDevelopment`. Se o download falhar, mostra "Não foi possível carregar as medições agora. O score publicado continua valendo."
- Paridade verificada: para os 498 lotes, o motor reproduz os 45 campos analíticos do lots.json sem nenhuma diferença (`App.analysisText.parity`, teste "golden"). Scores, classe, rankings, destaques e tipos/severidades de alerta também batem com o Lot canônico.
- O backend não carrega o motor: `backend/src/shared/domain/sharedDomain.js` (`BACKEND_ORDER`) inclui só `intelligence/math.js` (usado por `domain/rules.js` para rankings).

## 2. Fronteira de responsabilidade

| Arquivo | Objeto | Responsabilidade |
|---|---|---|
| `math.js` | `App.imath` | `pyMod`, `radians`, `angDiff`, `clamp`, `roundHalfEven`, `toFixedPy`, `roundTo`, `sector`, `percentilePosition`, `competitionRank`, `isFiniteNumber`. Reproduz a semântica de float do Python da análise original |
| `normalization.js` | `App.inormalize` | registro de normalizações nomeadas e versionadas (`has`, `get`, `catalog`) |
| `methodology.js` | `App.methodology` | validação, compilação, checksum, diff, relatório de impacto e ciclo de vida da configuração |
| `engine.js` | `App.intelligence` | `analyzeLot`, `analyzeDevelopment`, `moduleOrder`, `catalog`, `MODULES`, `METRIC_KEYS`, `ENGINE_VERSION` |
| `textAdapter.js` | `App.analysisText` | converte códigos do resultado no texto em português do registro publicado (`legacyRecord`, `alertText`, `parity`) |

O motor recebe medições (`LotAnalysisInput`) e uma metodologia compilada e devolve `LotAnalysisResult`. Não acessa DOM, rede, armazenamento, relógio nem estado de interface: `generatedAt` vem do contexto (`null` se não for informado). O teste "no dynamic code" garante que nenhum arquivo de `src/intelligence/` usa `eval` ou `new Function`.

O motor não lê disponibilidade nem preço: o status comercial (inclusive UNKNOWN, que nunca é tratado como AVAILABLE) não altera nota, score, classe ou ranking. As notas `liquidity`, `relativeValue` e `priceQuality` e o score Investimento são calculados só a partir de atributos medidos do lote, comparados dentro do empreendimento; nenhum módulo projeta ou promete valorização.

Dependências fora de `src/intelligence/`: `App.rules.ALERTS` (severidade e `fieldKey` dos alertas) e `App.rules.HIGHLIGHTS` (regras de destaque) em `src/domain/rules.js`; `App.domain.deepFreeze` e `App.domain.stable`; `App.model.field` (validação de fieldKey).

## 3. API

| Função | Entrada | Saída |
|---|---|---|
| `analyzeDevelopment(inputs, ctx)` | lista de `LotAnalysisInput` + contexto | `{ results, reference, report }`; a ordem da entrada não muda a saída (resultados ordenados por quadra e número) |
| `analyzeLot(input, ctx)` | um `LotAnalysisInput` + contexto | `LotAnalysisResult`; fase 2 só com `ctx.reference` |
| `moduleOrder()` | — | ordem dos módulos; lança `CYCLE` se um módulo depender de algo ainda não produzido |
| `catalog()` | — | cópia de `MODULES` (id, versão, fase, requires, produces) |

Contexto (`ctx`):

| Campo | Uso |
|---|---|
| `methodology` | metodologia compilada (`App.methodology.compile` ou `compiled`); obrigatória (`MISSING_METHODOLOGY`) |
| `reference` | `reference` devolvido por `analyzeDevelopment`; permite classe e ranking de um lote isolado |
| `inputVersion` | versão das medições; copiada para `provenance.inputVersion` |
| `generatedAt` | data do resultado; `null` se ausente |
| `sourceIds` | fontes; copiadas para `provenance.sourceIds` |

Erros lançados: `INVALID_INPUT` (sem `lotId`), `DUPLICATE_LOT`, `MISSING_METHODOLOGY`, `CYCLE`. Falha dentro de um módulo de métrica não interrompe o lote: vira diagnóstico `MODULE_FAILED` e as saídas desse módulo ficam `null`.

## 4. LotAnalysisInput

Arquivo `dash/analysis-input.json` (`kind: "lot-analysis-input"`, `schemaVersion: "1.0"`, `inputVersion: "measurements-2026-10-06"`, `sourceIds: official-plan-v1, kmz-v1, aerial-v1, routes-v1`), gerado por `scripts/measurements/export_analysis_input.py` a partir das medições da análise de 2026-10-06. Contém só medições, sem score nem julgamento.

| Grupo | Campos |
|---|---|
| identidade | `lotId`, `code`, `blockId`, `lotNumber` |
| `geometry` | `areaM2`, `frontWidthM`, `rearWidthM`, `depthM`, `rectangularity`, `isCorner`, `hasTwoFronts` |
| `environmental` | `frontBearingDeg` |
| `surroundings` | `rearSequence`, `rearVegetationShare` |
| `location` | `distanceToGateLinearM`, `distanceToClubLinearM`, `distanceToPlaygroundM`, `distanceToSquareM`, `distanceToTechnicalAreaM`, `distanceToAdministrationM`, `distanceToParkingM`, `distanceToExternalRoadM`, `distanceToGreenAreaM` |
| `mobility` | `routeDistanceToGateM`, `routeDistanceToLeisureM`, `vehiclesPassingEstimate`, `isCulDeSac` |
| `construction` | `adjacentToProjectedEasement` |
| opcional | `measurementConfidence` (não existe no arquivo atual) |

Nenhum campo é `null` nos 498 registros atuais. As listas que a análise mantinha fixas no código (servidão projetada, rua sem saída) viraram campos explícitos (`adjacentToProjectedEasement`, `isCulDeSac`).

## 5. Catálogo de módulos

Fase 1 roda por lote; fase 2 precisa do conjunto do empreendimento. Todos na versão `1.0`; `ENGINE_VERSION = "1.0.0"`.

| Módulo | Fase | Entradas | Saídas |
|---|---|---|---|
| `geometry` | 1 | `geometry.*` medidos | `geometry.shapeClass` (CORNER, TRAPEZOIDAL, IRREGULAR, SQUARE, RECTANGULAR), `geometry.depthToFrontRatio` e cópia das medidas |
| `location` | 1 | `location.*` | cópia das distâncias |
| `mobility` | 1 | `routeDistanceToGateM`, `routeDistanceToLeisureM`, `vehiclesPassingEstimate`, `isCulDeSac` | `estimatedTraffic`, `streetHierarchy`, `gateProximity` |
| `environmental` | 1 | `frontBearingDeg` | `rearBearingDeg`, orientações (frente, fundos, esquerda, direita), `morningSun`, `afternoonSun`, `northSunSide`, `eastSide`, `strongAfternoonSun`, `strongAfternoonSide` |
| `surroundings` | 1 | `rearSequence`, `rearVegetationShare`, `hasTwoFronts`, `adjacentToProjectedEasement` | `rearToken`, `rearClass`, `isPerimeter`, `hasGreenRear`, `viewBase` |
| `criteria` | 1 | métricas | `notes` (11 notas 0–10, definidas na config) |
| `levels` | 1 | notas | `levels` (faixas descritivas) |
| `scoring` | 1 | notas | `scores` (housing, investment, family, premium) e `criteriaResults` |
| `overall` | 1 | scores arredondados | `scores.overall` |
| `profiles` | 1 | notas, scores, métricas | `profileSignals` (perfis de cliente ideal) |
| `alerts` | 1 | notas, métricas | `alerts` (códigos e parâmetros) |
| `highlights` | 1 | notas, métricas, levels | `highlights` |
| `classification` | 2 | overall não arredondado | `class` |
| `ranking` | 2 | scores arredondados | `rankings` |

Os limiares dos módulos de métrica (forma, tráfego, hierarquia de via, proximidade da portaria, janelas solares, sequência dos fundos) são lidos de `methodology.metrics` e não estão no código. A ordem dos critérios vem do grafo de dependências (`App.methodology.orderCriteria`, ordenação topológica com detecção de ciclo).

## 6. Fase 1 e fase 2

- **Notas**: cada critério executa sua cadeia de normalizações (`steps`). Se uma etapa não tem entrada, a nota fica `null` (`MISSING_INPUT`); em `ENUM_MAPPING`, valor fora do mapa dá `UNKNOWN_ENUM` e nota `null` (nunca é adivinhado); em `ENUM_DELTA`, valor fora do mapa significa "sem ajuste" (por exemplo, tráfego `LOW` não tem penalidade de ruído). Cada etapa aplicada fica em `criteriaTrace` com `op`, `reason`, `delta` e `input`.
- **Scores**: média ponderada das notas × `scale`, arredondada conforme a config (ver `SCORING_CONFIGURATION.md`).
- **Overall**: soma ponderada dos quatro scores já arredondados; `null` se algum faltar.
- **Alertas**: regras `when` da config avaliadas sobre notas e métricas; a severidade vem de `App.rules.ALERTS`. `attentionPoints` = alertas com severidade diferente de `INFO`.
- **Destaques**: `App.rules.HIGHLIGHTS` avaliado sobre uma projeção com a precisão publicada (`publishedView`: notas com 1 casa, distâncias arredondadas), ordenados por peso.
- **Classe** (fase 2): lotes ordenados pelo overall não arredondado (empate: ordem quadra/número), posição percentual `i/n`, primeira faixa cuja `below` é maior que a posição.
- **Rankings** (fase 2): ranking de competição ("1224") sobre os scores arredondados; valores iguais dividem a posição.
- **Lote isolado**: `analyzeLot` sem `reference` devolve `class = "UNKNOWN"`, `rankings = []`, diagnóstico `REQUIRES_DEVELOPMENT_CONTEXT` e `provenance.phase2 = "NOT_RUN"`. Com `reference`, a classe e os rankings são iguais aos do lote (teste "batch vs single").

## 7. LotAnalysisResult

Objeto congelado (`deepFreeze`), seguro para JSON (sem NaN nem Infinity; valor não finito vira `null` com erro `NON_FINITE_VALUE`).

| Campo | Conteúdo |
|---|---|
| `lotId`, `code`, `status` | `status` = `COMPLETE`, ou `PARTIAL` se houver erro ou algum score `null` |
| `methodologyId`, `methodologyVersion`, `analysisVersion`, `engineVersion`, `generatedAt` | `analysisVersion = "<methodologyVersion>+<checksum>"`, hoje `1.0.0+5056f1ec` |
| `notes`, `scores`, `overallRaw` | notas 0–10 sem arredondar, scores 0–100 arredondados, overall bruto |
| `class`, `rankings` | `A_PLUS`, `A`, `B`, `C`, `D` ou `UNKNOWN`; `[{ type, position, total }]` |
| `levels`, `descriptors` | faixas (ruído, privacidade, liquidez, geometria útil) e descritores de métrica |
| `criteriaResults` | por score: `value`, `raw`, `status`, `coverage`, `methodologyVersion` e, por critério, `weight`, `value`, `contribution`, `status` (`OK`/`MISSING`), `reasons` |
| `criteriaTrace`, `explanations` | etapas aplicadas por critério; contribuições por score (somam o score bruto) |
| `highlights`, `attentionPoints`, `alerts` | códigos (`HIGHLIGHT_*`, `ALERT_*`), severidade e parâmetros; nenhuma frase |
| `profileSignals` | 1 ou 2 perfis ideais (o segundo entra se estiver a até `secondWithin` do primeiro) |
| `confidence` | `methodology.confidence.map[input.measurementConfidence ou "HIGH"]` |
| `missingInputs`, `diagnostics` | entradas ausentes (ordenadas) e diagnósticos `INFO`/`WARNING`/`ERROR` |
| `provenance` | `methodologyChecksum`, `inputVersion`, `inputChecksum` (FNV-1a da entrada), `sourceIds`, `phase2` (`BATCH`, `REFERENCE` ou `NOT_RUN`) |

`report` de `analyzeDevelopment`: `lotCount`, `methodologyVersion`, `methodologyChecksum`, contagem por `status` e por `class`, `missingInputs` por campo e total de erros. Resultado atual: 498 lotes `COMPLETE`, classes `A_PLUS 25`, `A 100`, `B 199`, `C 125`, `D 49`, zero erros.

## 8. Dados ausentes

Regra geral: `null` nunca vira 0. As normalizações devolvem `{ missing }` quando falta entrada, a nota fica `null` e o score segue a política da config. Na v1.0 todos os scores usam `BLOCK_SCORE` com `minCoverage = 1`: um critério ausente deixa o score `null` (`INSUFFICIENT_DATA`) e o overall `null`.

Verificado (lote A1 sem `frontBearingDeg`): nota `solar` `null`; `liquidity`, `relativeValue` e `priceQuality` (que dependem de `solar`) `null`; os quatro scores e o overall `null`; `status = PARTIAL`; `missingInputs = environmental.frontBearingDeg, environmental.rearBearingDeg, solar`; `criteriaResults.housing.coverage = 0.8`.

Pontos em que o código não segue a regra à risca (registrados para revisão):

| Onde | Comportamento |
|---|---|
| `liquidity`, etapa `PIECEWISE_VALUE` | área ausente usa o valor declarado na config (`missing: 6.5`) e grava `DECLARED_MISSING_VALUE` no trace |
| `relativeValue`, etapa `THRESHOLD_ABOVE` | área ausente apenas não aplica o bônus; a nota não fica `null` |
| módulo `surroundings` | `rearVegetationShare` ausente conta como 0 para decidir mata nos fundos; `hasTwoFronts` ausente conta como `false` para a vista. O campo ausente entra em `missingInputs` |
| `confidence` | `measurementConfidence` ausente é tratado como `HIGH` (mapeado para `MEDIUM`), reproduzindo a "Média" publicada |

Hoje nenhum desses caminhos é exercitado: não há `null` no analysis-input.json.

## 9. Determinismo e precisão

- Mesma entrada e mesma metodologia dão o mesmo JSON, em qualquer ordem de entrada (teste "determinism and order independence").
- Precisão interna total; arredondamento só onde a metodologia manda: `roundHalfEven` (Python `round`) nos scores e no overall; `toFixedPy`/`roundTo` para a precisão de exibição (notas com 1 casa).
- `pyMod` e `angDiff` reproduzem o módulo de float do Python; `sector` usa setores de 45°.
- Ordenação estável com desempate por quadra e número; ranking ignora valores `null` ou não finitos.
- A entrada não é alterada (teste "results are JSON-safe ... inputs not mutated").

## 10. Adaptador de texto e paridade

`App.analysisText.legacyRecord(result, input)` monta os campos analíticos do registro publicado (`forma`, `pos`, `fundo`, `vista`, `fontes`, `nt`, `sm`, `si`, `sf`, `sp`, `sg`, `cl`, `al` etc.). `parity(results, inputs, published)` compara os 45 campos de `PARITY_KEYS` e devolve `{ lots, identical, fieldsCompared, diffs }`. O adaptador existe para provar paridade e regenerar o registro; a interface usa o próprio i18n. Textos específicos do Viva Juara ficam no adaptador, não no motor (por exemplo, o alerta AVENUE cita a Av. Porto Dourado e a faixa de 3.228,11 m²; o fechamento dos fundos vem com "necessita confirmação").

## 11. Uso de campos (fieldKey → onde é lido)

Gerado a partir de `config/scoring/viva-juara/1.0.json` (etapas, níveis, alertas, perfis e scores).

| Campo ou nota | Lido por |
|---|---|
| `mobility.estimatedTraffic` | notas `lowTraffic`, `quiet`, `privacy`; alerta TRAFFIC |
| `location.distanceToExternalRoadM` | nota `quiet`; alerta AVENUE |
| `location.distanceToGateLinearM` | notas `quiet`, `privacy` |
| `location.distanceToClubLinearM` | notas `quiet`, `view` |
| `location.distanceToPlaygroundM` | notas `quiet`, `privacy`, `leisure` |
| `location.distanceToSquareM` | notas `quiet`, `privacy`, `view` |
| `location.distanceToParkingM` | nota `quiet` |
| `location.distanceToTechnicalAreaM` | nota `quiet`; alerta TECHNICAL_AREA |
| `surroundings.rearClass` | nota `privacy`; alerta BUILDING_RESTRICTION |
| `geometry.isCorner`, `geometry.hasTwoFronts` | nota `privacy` |
| `environmental.rearBearingDeg` | nota `solar` |
| `surroundings.viewBase` | nota `view` |
| `geometry.shapeClass`, `geometry.depthToFrontRatio` | nota `geometry` |
| `geometry.frontWidthM` | nota `geometry`; alerta GEOMETRY |
| `mobility.routeDistanceToGateM` | nota `gate` |
| `mobility.routeDistanceToLeisureM` | nota `leisure` |
| `geometry.areaM2` | notas `liquidity`, `relativeValue`; alerta MISSING_AREA |
| `environmental.strongAfternoonSun` | alerta AFTERNOON_SUN |
| `construction.adjacentToProjectedEasement` | alerta EASEMENT |
| `surroundings.hasGreenRear` | perfil NATURE |

Campos medidos que a config não lê diretamente (`rearWidthM`, `rectangularity`, `vehiclesPassingEstimate`, `frontBearingDeg` etc.) são usados dentro dos módulos de métrica ou só nos descritores e destaques. `distanceToAdministrationM` e `distanceToGreenAreaM` não são usados por nenhuma regra; continuam no modelo.

## 12. Modos de execução e desempenho

| Ambiente | Como roda |
|---|---|
| Navegador | bundle único (`scripts/build.js`); configs embutidas como `App.configs` (`scripts/configBundle.js`); execução sob demanda no popover técnico |
| Node (testes) | `tests/harness.js` carrega os módulos numa vm, na ordem `ORDER` |
| Backend | não carrega o motor |

Execução síncrona. Medido em Node neste ambiente: cerca de 140–150 ms para `analyzeDevelopment` dos 498 lotes. Não há memoização dentro do motor; `App.methodology.compiled` guarda a metodologia compilada por checksum, e `app.js` guarda o resultado da primeira execução (`techAnalysis`).

## 13. Testes (`tests/intelligence.test.js`)

Golden de 45 campos × 498 lotes; paridade com o Lot canônico; distribuição de classes; determinismo e independência de ordem; lote isolado vs lote em lote; dado ausente nunca vira 0; JSON seguro e imutabilidade; proveniência e versões; contribuições somam o score bruto; grafo de módulos e de critérios sem ciclo; semântica Python da matemática; normalizações (só a primeira faixa aplica, enum desconhecido reportado); ausência de `eval`. Os testes de validação, diff, impacto e ciclo de vida estão descritos em `SCORING_CONFIGURATION.md`.

```
cd plat/tests && node --test intelligence.test.js
```

## 14. Não implementado / pendências

- O app continua exibindo a análise publicada; o motor não gera nem publica `Lot.intelligence`. O `analysisVersion` do Lot (`2026-10-06`) e o do motor (`1.0.0+5056f1ec`) são identificadores diferentes e não há vínculo gravado entre eles.
- Implementado em 08/10/2026: o motor está em `BACKEND_ORDER` e roda no backend em `POST /api/v1/developments/{id}/analysis/preview`, com paridade com o frontend (498 lotes × 45 campos). O backend não publica a análise.
- Opções do motor (`strictMode`, `diagnostics`, `moduleSelection`), módulos habilitados por empreendimento, cancelamento, progresso, Web Worker e injeção de logger: não existem. A pré-visualização existe desde 08/10/2026, só no backend (`analysis/preview`).
- Regras ainda no código, fora da config: destaques e seus limiares (`App.rules.HIGHLIGHTS`, por exemplo `quietScore >= 8`, `areaM2 >= 400`), severidade dos alertas (`App.rules.ALERTS`), o limite de frente estreita do alerta GEOMETRY (`frontWidthM < 9` em `alertOf`) e a projeção `publishedView`. Quais regras ficam no código e quais na configuração depende de decisão.
- Os quatro casos de "Dados ausentes" (seção 8) aplicam valor ou suposição em vez de `null`; precisam de decisão sobre manter ou bloquear.
- Módulos financeiro, comercial e de disponibilidade não fazem parte do motor (disponibilidade nunca entra no cálculo).
- Gate de publicação (validação, regressão, alerta de mudança em massa) só existe como função (`App.methodology.impact`), exposta desde 08/10/2026 pelo relatório de impacto do backend (`analysis/preview`); não há fluxo que publique resultado do motor.
