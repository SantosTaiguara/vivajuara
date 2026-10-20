# Ciclo de vida dos dados: STATIC, VERSIONED, DYNAMIC

Tópico 7. Descreve a separação implementada em `plat/src/data/lifecycle.js` (`App.lifecycle`) e usada por `plat/src/data/repositories.js` (`LotRepository`) e `plat/src/data/offline.js` (cache local). A classificação de cada campo é o atributo `dynamicType` do Field Registry (`plat/src/domain/model.js`); não existe outra lista. O relatório campo a campo, gerado do código, está em [field-lifecycle-report.json](field-lifecycle-report.json).

## 1. Definições

| Tipo | Significado | Exemplos | Muda quando | Camada (snapshot) |
|---|---|---|---|---|
| **STATIC** | Fato estrutural do lote, tirado da planta, do KMZ ou do cálculo geométrico | ID, quadra, área, polígono, medidas, coordenadas, distâncias, orientação, vizinhos | correção estrutural (nova `staticDataVersion`) | `static` |
| **VERSIONED** | Resultado de uma metodologia de análise publicada | scores, classe, notas 0–10, ruído, privacidade, sol, vista, alertas, rankings, destaques | nova `analysisVersion` | `analysis` |
| **DYNAMIC** | Estado comercial que muda sem republicar a planta ou a análise | preço, preço por m², entrada, planos, tabela; status, revisão, reserva | nova tabela/revisão comercial; nova revisão de disponibilidade | `commercial` e `availability` (dois canais independentes) |

`layerOf(field)`: STATIC → `static`; VERSIONED → `analysis`; DYNAMIC com chave `availability.*` → `availability`; demais DYNAMIC → `commercial`.

## 2. Totais

| | Campos |
|---|---|
| Total no registro | 138 |
| STATIC | 78 (74 na camada `static`, 3 virtuais, 1 em `metadata`) |
| VERSIONED | 41 |
| DYNAMIC | 19 (10 `commercial`, 9 `availability`) |
| Virtuais (não armazenados no Lot) | 3: `identity.developmentName` (lido da configuração), `mobility.routeToGate`, `mobility.routeToLeisure` (traçados carregados sob demanda de `routes.json` pelo `SpatialRepository`) |
| Híbridos (dependem de campo de outra camada) | 4 (seção 7) |

Campos por camada (gerado de `App.lifecycle.FIELDS`):

**static** (74 campos): `identity.id`, `identity.code`, `identity.developmentId`, `identity.blockId`, `identity.blockNumber`, `identity.lotNumber`, `identity.displayCode`, `identity.externalCode`, `geometry.areaM2`, `geometry.frontM`, `geometry.rearM`, `geometry.leftDepthM`, `geometry.rightDepthM`, `geometry.averageDepthM`, `geometry.perimeterM`, `geometry.shape`, `geometry.isCorner`, `geometry.cornerType`, `geometry.frontCount`, `geometry.irregularityLevel`, `geometry.measurementConfidence`, `geometry.frontBoxWidthM`, `geometry.frontEdgesM`, `geometry.rearEdgesM`, `geometry.polygon`, `geometry.centroid`, `geometry.bounds`, `location.streetId`, `location.streetName`, `location.blockPosition`, `location.perimeterPosition`, `location.sector`, `location.latitude`, `location.longitude`, `location.distanceToGateLinearM`, `location.distanceToClubLinearM`, `location.distanceToGreenAreaM`, `location.distanceToPlaygroundM`, `location.distanceToSquareM`, `location.distanceToExternalRoadM`, `location.distanceToTechnicalAreaM`, `location.distanceToAppM`, `location.distanceToMainInternalRoadM`, `surroundings.frontNeighborType`, `surroundings.rearNeighborType`, `surroundings.leftNeighborType`, `surroundings.rightNeighborType`, `surroundings.rearCondition`, `surroundings.hasRearNeighbor`, `surroundings.hasGreenRear`, `surroundings.appNearby`, `surroundings.sewageStationNearby`, `mobility.routeDistanceToGateM`, `mobility.routeDistanceToLeisureM`, `environmental.orientationFront`, `environmental.orientationRear`, `environmental.orientationLeft`, `environmental.orientationRight`, `environmental.frontBearingDeg`, `environmental.northReference`, `environmental.ventilation`, `construction.topography`, `construction.slopePercent`, `construction.drainage`, `construction.frontSetbackM`, `construction.rearSetbackM`, `construction.sideSetbackM`, `construction.occupationRate`, `construction.permeabilityRate`, `construction.buildingCoefficient`, `construction.maxFloors`, `construction.easements`, `construction.regulationStatus`, `construction.constructivePotential`

**analysis** (41 campos): `geometry.usableGeometryScore`, `geometry.usableGeometryClass`, `surroundings.viewType`, `surroundings.viewPermanence`, `surroundings.viewDetail`, `mobility.streetHierarchy`, `mobility.estimatedTraffic`, `mobility.vehiclesPassingEstimate`, `mobility.gateProximity`, `mobility.nearMainAccess`, `environmental.morningSun`, `environmental.afternoonSun`, `environmental.northSunSide`, `environmental.eastSide`, `environmental.solarScore`, `environmental.noiseLevel`, `environmental.quietScore`, `environmental.noiseSources`, `environmental.privacyLevel`, `environmental.privacyScore`, `environmental.viewScore`, `construction.nonBuildableRearToConfirm`, `intelligence.analysisVersion`, `intelligence.scores.housing`, `intelligence.scores.investment`, `intelligence.scores.family`, `intelligence.scores.premium`, `intelligence.scores.overall`, `intelligence.class`, `intelligence.notes.leisure`, `intelligence.notes.gate`, `intelligence.notes.lowTraffic`, `intelligence.notes.liquidity`, `intelligence.notes.relativeValue`, `intelligence.notes.priceQuality`, `intelligence.liquidity`, `intelligence.idealProfiles`, `intelligence.alerts`, `intelligence.rankings`, `intelligence.highlights`, `intelligence.confidence`

**commercial** (10 campos): `commercial.price`, `commercial.pricePerM2`, `commercial.currency`, `commercial.downPaymentDefaultPercent`, `commercial.downPaymentDefaultValue`, `commercial.availablePlans`, `commercial.priceTableId`, `commercial.priceTableVersion`, `commercial.validFrom`, `commercial.validUntil`

**availability** (9 campos): `availability.status`, `availability.updatedAt`, `availability.revision`, `availability.reason`, `availability.notes`, `availability.freshness`, `availability.reservedUntil`, `availability.sourceId`, `availability.proposalId`

## 3. Separação física e lógica

O lots.json continua sendo o único arquivo físico de lotes. A separação é lógica, feita no carregamento:

```
lots.json ─► LegacyLotAdapter (normalize) ─► buildSnapshotsFromLegacy
                                              ├─► StaticSnapshot      (static)
                                              ├─► AnalysisSnapshot    (analysis)
                                              └─► AvailabilitySnapshot (availability; hoje revisão 0, sem status)
config/developments.js (priceTables) ─► CommercialRepository.buildSnapshot ─► CommercialSnapshot
commercial.json (publicado) ─► commercialFromDoc ─► CommercialSnapshot (fonte de rede, tópico 10)
                    LotComposer (composeOne/compose) ─► LotFactory ─► Lot
```

Arquivos publicados ao lado do lots.json, gerados por `plat/scripts/build-data.js`:

- `commercial.json`: documento da tabela vigente (`kind: commercial-source`, `revision`, `updatedAt`, `currentPriceTableId`, `priceTables`). É buscado na rede antes de usar a cópia salva.
- `manifest.json`: versões, checksums e assets (ver [OFFLINE_CACHE_ARCHITECTURE.md](OFFLINE_CACHE_ARCHITECTURE.md)). Informa versões; não é fonte comercial.

Formato de um snapshot (`App.lifecycle.snapshot`):

```json
{ "kind": "static|analysis|commercial|availability", "schemaVersion": "1.0", "developmentId": "viva-juara",
  "<chave de versão>": "…", "…metadados…": "…", "lots": { "VJ-QB-L0079": { "…somente campos desta camada…": {} , "provenance": {} } } }
```

`validateSnapshot` rejeita: tipo errado (`SNAPSHOT_KIND`), schema diferente (`SCHEMA_MISMATCH`), outro empreendimento (`DEVELOPMENT_MISMATCH`), chave de versão ausente (`MISSING_VERSION`), lista ausente (`NO_LOTS`), lote inexistente nos dados estáticos (`ORPHAN_LOT`), campo ou proveniência de outra camada (`LAYER_VIOLATION`), campo fora do registro (`UNKNOWN_FIELD`). Assim nenhum campo fica duplicado entre camadas.

## 4. Versões

| Camada | Chave de versão (`VERSION_KEY`) | Valor atual | Onde é definida |
|---|---|---|---|
| static | `staticDataVersion` | `2026-10-06.1` | `DevelopmentConfig.staticDataVersion`; `manifest.staticVersion` quando publicado |
| analysis | `analysisVersion` | `2026-10-06` | `DevelopmentConfig.analysisVersion`; `manifest.analysisVersion` |
| commercial | `priceTableVersion` (+ `revision`) | `2026-10-06`, revisão 1 | `priceTables[].version`; `commercial.json.revision` |
| availability | `revision` | `0` (sem espelho de vendas) | revisão do feed; `applyAvailabilityFeed` incrementa |

Cada Lot carrega as versões que o compõem em `metadata.dataVersions` (`staticVersion`, `analysisVersion`, `priceTableVersion`, `availabilityRevision`). A ficha mostra essas versões na seção Fontes (modo corretor) e o painel "Dados e funcionamento offline" mostra as versões carregadas.

## 5. Composição (LotComposer)

`composeOne(id, layers)` percorre as quatro camadas e, para cada campo do registro, usa o valor do snapshot ou `emptyValue(f)` quando a camada não traz o lote: `null`, `[]`, classe `UNKNOWN`, status `UNKNOWN`. Nenhum valor semântico é presumido. A proveniência das camadas é unida; `metadata.dataVersions` e `metadata.freshness` são preenchidos; `availability.freshness` é `UNKNOWN` quando o status é UNKNOWN, senão a atualidade do snapshot de disponibilidade.

`compose(layers)` exige a camada estática (sem ela não há identidade nem geometria), ignora lotes órfãos das outras camadas (registrados no log) e entrega tudo à `LotFactory.createMany`.

## 6. Atualização por domínio

Canais do `LotRepository`: `applyStructuralUpdate`, `applyAnalyticalUpdate`, `applyCommercialUpdate`, `applyAvailabilityUpdate`, `applyPriceTable(table)` e `applyAvailabilityFeed(map, meta)`. Todos passam pelo mesmo serviço `apply(kind, next)`:

1. `validateSnapshot`. Inválido: não substitui o anterior; a camada atual é marcada `stale: true`.
2. Compara versões: em static, analysis e commercial, a mesma chave de versão é recusada ("mesma versão"); disponibilidade com revisão menor ou igual é recusada ("revisão antiga"); comercial com revisão menor é recusado. Revisão vence data (proteção contra relógio errado). No comercial, a revisão é comparada primeiro: revisão menor é recusada ("revisão antiga"); mesma versão de tabela com revisão maior (por exemplo, um preço corrigido) é aplicada; mesma versão e mesma revisão é "mesma versão" e apenas confirma os dados (`src/data/repositories.js`, função `apply`).
3. Disponibilidade: cada lote passa pela máquina de estados (`canTransition`); qualquer transição inválida rejeita o snapshot inteiro.
4. `diff(prev, next)`: lotes e campos alterados (ChangeSet `{ domain, version, previousVersion, changedLotIds, changedFields }`).
5. Recomposição: comercial e disponibilidade recompõem só os lotes alterados; análise e estrutura recompõem todos e recalculam rankings e destaques. Correção estrutural também recalcula o comercial a partir das novas áreas.
6. Se algum lote for rejeitado pela `LotFactory`, nada é aplicado.
7. Troca atômica das camadas, invalidação do cache daquela camada, notificação dos assinantes (`subscribe`), registro no log (`version replaced`).

`touch(kind, patch)` muda só metadados de uma camada dinâmica (fonte confirmou de novo ou não pôde confirmar) e recompõe se a atualidade mudou. É usado pelo SyncManager.

Exemplos de isolamento (garantidos pelo `validateSnapshot` + `diff`):

| Mudança | Afeta | Não afeta |
|---|---|---|
| Nova tabela de preço | `commercial.*` de todos os lotes | geometria, análise, status |
| Novo status de um lote | `availability.*` daquele lote | preço, scores, geometria |
| Nova análise | `intelligence.*`, notas, classes, rankings, destaques | área, preço, status |
| Correção estrutural (área) | campos estáticos + preço recalculado | status; valores da análise (ver risco na seção 7) |

## 7. Dependências e campos híbridos

Dependências declaradas no registro (`dependsOn`) e o grafo inverso `DEPENDENTS` alimentam `impactOf(fieldKey)`, que responde o que recalcular e quem consome:

| Campo alterado | Camada | Derivados a recalcular | Consumidores |
|---|---|---|---|
| `geometry.areaM2` | static | `commercial.price`, `commercial.downPaymentDefaultValue` | ficha (geometria), filtros de área, comparação |
| `geometry.polygon` | static | `geometry.centroid`, `geometry.bounds` | contorno no mapa, medidas no zoom, ficha, filtros, comparação |
| `mobility.routeDistanceToGateM` | static | `mobility.gateProximity`, `mobility.nearMainAccess`, `intelligence.notes.gate` | camada Trânsito e distâncias, ficha (mobilidade) |
| `commercial.pricePerM2` | commercial | `commercial.price`, `commercial.downPaymentDefaultValue` | camadas Preço, filtros de preço, simulação, Quick View, comparação, compartilhamento |
| `intelligence.scores.housing` | analysis | `intelligence.rankings` | camada Score, classe e rankings, recomendação, Quick View, comparação |
| `availability.status` | availability | nenhum | camada Disponibilidade, filtro "Somente disponíveis", Quick View, comparação |

Campos híbridos (classificados numa camada, mas dependentes de campo de outra):
| Campo | Ciclo | Depende de (outra camada) |
|---|---|---|
| `mobility.gateProximity` | VERSIONED | `mobility.routeDistanceToGateM` (STATIC) |
| `mobility.nearMainAccess` | VERSIONED | `mobility.routeDistanceToGateM` (STATIC) |
| `commercial.price` | DYNAMIC | `geometry.areaM2` (STATIC) |
| `intelligence.notes.gate` | VERSIONED | `mobility.routeDistanceToGateM` (STATIC) |

Risco: `mobility.gateProximity`, `mobility.nearMainAccess` e `intelligence.notes.gate` ficam no snapshot de análise. Uma correção estrutural que mude `routeDistanceToGateM` sem nova análise não os recalcula automaticamente (no caminho atual as duas camadas vêm juntas do lots.json, então não há divergência hoje). `commercial.price` é recalculado na correção estrutural.

## 8. Cache e invalidação

| Nível | Chave | Invalidação |
|---|---|---|
| Memória (`DataCache` em `lifecycle.js`) | `${kind}:${developmentId}:${versão}` | `invalidate(kind, developmentId)` remove só aquela camada daquele empreendimento; nunca global |
| IndexedDB (`offline.js`) | static e analysis por versão; dinâmico por lote (last-known) | nova versão é gravada, ativada (ponteiro) e só então as antigas são removidas; ver OFFLINE_CACHE_ARCHITECTURE.md |
| HTTP (backend, tópico 9) | ETag por ponteiro de versão | estático `max-age=86400`, versionado revalida a cada 5 min, dinâmico `no-cache` (ver `plat/backend/docs/BACKEND_ARCHITECTURE.md`) |

## 9. Atualidade (freshness)

`FreshnessPolicy` (por empreendimento, em `DevelopmentConfig.freshnessPolicy`) tem `staticMaxAgeMs`, `analysisMaxAgeMs`, `commercialMaxAgeMs`, `availabilityMaxAgeMs`, `commercialExpireAfterMs`, `availabilityExpireAfterMs`. Todos são `null` (sem limite de tempo), porque o limite é decisão de negócio.

`freshnessState(snapshot)`:

| Resultado | Quando |
|---|---|
| `EXPIRED` | `validUntil` já passou, ou o tempo desde a confirmação passou de `…ExpireAfterMs` |
| `UNKNOWN` | sem snapshot; ou disponibilidade sem `updatedAt` |
| `STALE` | snapshot marcado `stale`, ou vindo do cache (`CACHE`) ou da tabela embutida (`BUNDLED`), ou idade acima de `…MaxAgeMs` |
| `FRESH` | a fonte oficial confirmou nesta sessão |

Static e analysis valem até a versão mudar. Hoje: comercial `FRESH` quando o `commercial.json` foi lido na rede nesta sessão, `STALE` quando vem do cache ou da tabela embutida; disponibilidade `UNKNOWN` nos 498 lotes.

## 10. Fallback

| Falha | Comportamento | Onde |
|---|---|---|
| `commercial.json` indisponível | tabela embutida na configuração, marcada `BUNDLED` e `STALE` ("Baseado na última tabela disponível") | `offline.js` (`bundledCommercial`) |
| Tabela inexistente ao montar o comercial | camada comercial nula, preço `null`, lotes compostos sem preço | `repositories.js` (`buildSnapshotsFromLegacy`) |
| Disponibilidade sem feed ou sem cópia | todos os lotes `UNKNOWN` (`unknownAvailability`) | `offline.js` |
| Camada de análise, comercial ou disponibilidade da API inválida | aquela camada nula com estado `error`; o mapa carrega | `apiSource.js` |
| Estática da API inválida | todo o dataset do JSON (`fallbackToJson`), nunca mistura de camadas | `apiSource.js` |
| Snapshot novo inválido | o anterior continua; camada marcada `stale` | `repositories.js` (`apply`) |

## 11. Não implementado / pendente

- Limites de tempo de atualidade (`…MaxAgeMs`, `…ExpireAfterMs`): `null`, aguardam decisão de negócio. Sem eles, EXPIRED só ocorre por `validUntil`, que também é `null` (validade da tabela não informada).
- Separação física do lots.json em arquivos por camada: não feita (a especificação permite a separação lógica nesta fase).
- Histórico de versões no navegador: o cache mantém só a versão atual e a anterior de static e analysis; histórico completo existe no backend (tópico 9), que não está publicado.
- Recalcular campos VERSIONED derivados de campo STATIC numa correção estrutural isolada (seção 7).
- Revisão comercial sem troca de `priceTableVersion` é recusada (seção 6, passo 2).
- Decisão humana: limites de atualidade para preço e status; política de validade da tabela de lançamento.
