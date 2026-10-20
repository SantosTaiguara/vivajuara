# Agregado canônico Lot

Tópico 6. Descreve o contrato `Lot` como implementado em `plat/src/domain/lot.js` (`App.domain`), com os campos declarados em `plat/src/domain/model.js` (ver [DOMAIN_MODEL.md](DOMAIN_MODEL.md)).

## 1. Definição

Um `Lot` é o único objeto que representa um lote dentro da plataforma. Ele é criado somente pela `LotFactory`, validado contra o Field Registry, congelado (`deepFreeze`) e não contém dado de interface (rótulos, cores, seleção, favoritos, valores formatados).

```
Lot { identity, geometry, location, surroundings, mobility, environmental,
      construction, commercial, intelligence, availability, provenance, metadata }
```

- Versão do contrato: `SCHEMA_VERSION = '1.0'` (`metadata.schemaVersion`). Não confundir com a versão da análise ou da tabela.
- 135 campos armazenados em 10 domínios de negócio, mais `provenance` (sobrescritas por campo) e `metadata`.
- `metadata` aceita somente: `schemaVersion`, `createdAt`, `updatedAt`, `dataVersions` (`staticVersion`, `analysisVersion`, `priceTableVersion`, `availabilityRevision`) e `freshness` (`commercial`, `availability`).
- `createdAt` e `updatedAt` existem no contrato, mas hoje são sempre `null` (nenhuma fonte informa essas datas por lote).

Fluxo de entrada (qualquer origem vira Lot pelo mesmo caminho):

```
lots.json / API / cache local
  → LegacyLotAdapter (App.legacy.normalize) ou snapshot já normalizado
  → snapshots por camada (static, analysis, commercial, availability)
  → LotComposer (App.lifecycle.composeOne)
  → LotFactory.create / createMany
  → Lot (congelado)
  → LotRepository (índices) → selectors → ViewModels → UI
```

## 2. Identidade

| Campo | Regra |
|---|---|
| `identity.id` | ID técnico global e imutável. Formato `^[A-Z0-9]+-Q[A-Z0-9]+-L\d{4}$` (ex.: `VJ-QB-L0079`). Vem de `did` no lots.json; se ausente, é montado a partir do código do empreendimento, da quadra e do número. |
| `identity.code` | Código curto da planta (ex.: `B79`), único no empreendimento. Usado em links (`#viva-juara.lots.B79`), busca e rotas. |
| `identity.developmentId` | Empreendimento dono do lote. |
| `identity.blockId`, `identity.lotNumber` | Quadra (letra) e número inteiro > 0. |
| `identity.displayCode` | Derivado para exibição (`QB L79`). |

`LotRepository.resolve(ref)` aceita o ID técnico ou o código curto, para manter links e favoritos salvos por versões antigas. Os índices O(1) são `byId`, `byCode` e `byBlock` (`buildIndex`).

## 3. Invariantes

Verificados por `validateLot` a cada criação, atualização e reidratação:

1. **Estrutura completa.** Todo campo armazenado do registro existe no objeto. Ausente (`undefined`) é erro `MISSING_REQUIRED_FIELD`; ausência de valor é expressa com `null`, `[]`, `UNKNOWN`.
2. **Campos estruturais obrigatórios** (`STRICT`): `identity.id`, `identity.code`, `identity.developmentId`, `identity.blockId`, `identity.lotNumber`, `geometry.polygon`, `availability.status`, `metadata.schemaVersion`. `null` nesses campos é erro.
3. **Campo não anulável com `null`** gera aviso `MISSING_OPTIONAL_FIELD` (não bloqueia).
4. **Tipos.** `number` finito; `string`, `date`, `datetime` texto; `boolean`; `enum` pertencente ao vocabulário; `array` (e, se tipado, itens do vocabulário).
5. **Faixas.** Área > 0 (`INVALID_AREA`); metros, lotes e % ≥ 0; preços ≥ 0 (`INVALID_PRICE`); notas 0–10 e scores 0–100 (`INVALID_SCORE`); `lotNumber` inteiro > 0.
6. **Polígono** com pelo menos 3 vértices `[x, y]` numéricos (`INVALID_POLYGON`).
7. **Formato do ID** (`INVALID_LOT_ID`) e **versão do schema** igual a `1.0` (`SCHEMA_MISMATCH`).
8. **Proveniência** só para fieldKeys do registro (`INVALID_FIELD_KEY`), com `DataStatus` e `Confidence` válidos; `CONFLICTED` gera aviso `CONFLICTED_SOURCE`.
9. **Inteligência**: alertas com `AlertType` e `AlertSeverity` válidos e `fieldKey` existente; destaques ligados a um campo existente; rankings com tipo válido e posição inteira ≥ 1.
10. **Sem campos fora do contrato.** Chave desconhecida em qualquer nível é removida e reportada (`EXTRA_FIELD_IGNORED`); não há proliferação silenciosa.
11. **ID único no conjunto** (`DUPLICATE_LOT_ID` em `createMany`).
12. **Identidade imutável em atualização**: `id`, `code`, `developmentId`, `blockId` e `lotNumber` não mudam (`IDENTITY_CHANGE`).
13. **Sem padrão perigoso.** Camada ausente produz `null`, `[]`, classe `UNKNOWN` e status `UNKNOWN` (`emptyValue`). Nunca `AVAILABLE`, nunca `LOW`.
14. **Status independente.** `availability.status` não depende de preço, geometria ou score.

## 4. LotFactory e validação

| Função | Comportamento |
|---|---|
| `LotFactory.create(data)` | valida; com erro devolve `{ success: false, lotId, errors, warnings }`; sem erro devolve `{ success: true, lot }` com o objeto congelado |
| `LotFactory.createMany(list)` | cria um a um; um lote inválido é isolado em `rejected` e não derruba o conjunto; devolve `{ lots, rejected, warnings, report }` |
| `LotFactory.rehydrate(serialized)` | nunca confia no dado salvo: JSON válido, `schemaVersion` igual a `1.0` e validação completa |
| `serializeLot(lot)` | JSON determinístico (chaves ordenadas em todos os níveis); usado no shadow compare do backend |
| `deserializeLot(s)` | igual a `rehydrate` |

Erro: `{ code, lotId, fieldKey, message }`. Códigos de erro: `INVALID_LOT_ID`, `INVALID_AREA`, `INVALID_POLYGON`, `INVALID_SCORE`, `UNKNOWN_ENUM`, `MISSING_REQUIRED_FIELD`, `INVALID_NUMBER`, `INVALID_PRICE`, `INVALID_TYPE`, `INVALID_FIELD_KEY`, `DUPLICATE_LOT_ID`, `SCHEMA_MISMATCH`, `IDENTITY_CHANGE`. Códigos de aviso: `MISSING_OPTIONAL_FIELD`, `CONFLICTED_SOURCE`, `EXTRA_FIELD_IGNORED`, `LEGACY_FIELD_USED`, `UNKNOWN_PROVENANCE` (este último está declarado, mas `validateLot` não o emite).

Relatório de qualidade (`report` de `createMany`, exposto por `LotRepository.getQualityReport()`): `totalLots`, `validLots`, `invalidLots`, `warnings`, `warningsByCode`, `missingOptionalFields`, `conflicts`, `perLot`, e, acrescentados pelo repositório, `normalizationWarnings`, `orphans`, `unmappedLegacyFields`, `measurementVariants`.

Resultado com o lots.json atual: 498 lotes válidos, 0 rejeitados, 0 avisos de validação, 0 avisos de normalização, 35 variantes de medição registradas, nenhum campo legado sem mapeamento.

## 5. Atualização por cópia

Um Lot nunca é alterado no lugar. Em `domain/lot.js` existem três funções que copiam o lote, aplicam a mudança e passam de novo pela `LotFactory`:

| Função | Muda | Não muda |
|---|---|---|
| `updateLotCommercial(lot, patch)` | `commercial`; recalcula preço ↔ preço por m² juntos e o valor da entrada padrão | geometria |
| `updateLotAvailability(lot, patch)` | `availability`; grava proveniência `CONFIRMED` quando o status deixa de ser UNKNOWN | scores, geometria |
| `updateLotIntelligence(lot, patch)` | `intelligence` (scores, classe, alertas, rankings, destaques, versão) | área, preço, status |

Observação: o aplicativo hoje não chama essas funções. As atualizações reais passam pelos canais do `LotRepository` (`applyStructuralUpdate`, `applyAnalyticalUpdate`, `applyCommercialUpdate`, `applyAvailabilityUpdate`, `applyPriceTable`, `applyAvailabilityFeed`), que substituem um snapshot de camada inteiro e recompõem os lotes afetados (ver [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md)). O efeito é o mesmo: novo Lot validado, identidade preservada.

## 6. Relações

| Lot se relaciona com | Como | Onde |
|---|---|---|
| Empreendimento (`DevelopmentConfig`) | `identity.developmentId` | `config/developments.js` |
| Fontes (`sources`) | `sourceId` na proveniência padrão, nas sobrescritas e nos alertas | `config/developments.js`, `domain/model.js` |
| Tabela de preço e planos | `commercial.priceTableId`, `priceTableVersion`, `availablePlans` (ids de plano) | `CommercialRepository` |
| Estado de disponibilidade | `availability` (AvailabilityState) | `domain/availability.js` |
| Pontos de interesse e rotas | distâncias no Lot; traçados virtuais via `SpatialRepository.getRoutes(lot)` pela chave `identity.code` | `routes.json`, `config/developments.js` (`pois`) |
| Versões de dados | `metadata.dataVersions` | `data/lifecycle.js` |

## 7. Ciclo de vida

- Campos STATIC vêm do snapshot estático, VERSIONED do snapshot de análise, DYNAMIC dos snapshots comercial e de disponibilidade. O `LotComposer` junta as quatro camadas por `identity.id`; lote presente só numa camada não estática é órfão e é ignorado com registro.
- Rankings e destaques dependem do conjunto inteiro e são recalculados quando chega nova análise ou nova estrutura (`deriveDatasetIntelligence`).
- Detalhes e regras de versão e invalidação: [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md).

## 8. Exemplo real

Lote B79, composto pelo código atual a partir do lots.json e da tabela de lançamento, serializado com `serializeLot` (polígono, destaques e rankings encurtados). Os valores comerciais são calculados (291,78 m² × R$ 1.196/m²); a disponibilidade é não disponível; `metadata.freshness.commercial` aparece `FRESH` porque a composição foi feita direto da fonte publicada (no navegador, uma cópia em cache aparece `STALE`).

```json
{
  "identity": {"blockId": "B", "blockNumber": null, "code": "B79", "developmentId": "viva-juara", "displayCode": "QB L79", "externalCode": null, "id": "VJ-QB-L0079", "lotNumber": 79},
  "geometry": {"areaM2": 291.78, "averageDepthM": 27.6, "bounds": {"h": 55.799999999999955, "w": 54.799999999999955, "x": 1339.8, "y": 1231}, "centroid": [1367.54, 1259.25], "cornerType": "NONE", "frontBoxWidthM": 10.3, "frontCount": 1, "frontEdgesM": 10, "frontM": 10.3, "irregularityLevel": null, "isCorner": false, "leftDepthM": 27.7, "measurementConfidence": "HIGH", "perimeterM": null, "polygon": [[1394.6, 1249.2], [1394, 1250], ["…"]], "rearEdgesM": 11.5, "rearM": 11.5, "rightDepthM": 26.7, "shape": "RECTANGULAR", "usableGeometryClass": "GOOD", "usableGeometryScore": 8.5},
  "location": {"blockPosition": "INTERNAL", "distanceToAppM": null, "distanceToClubLinearM": 463, "distanceToExternalRoadM": 418, "distanceToGateLinearM": 528, "distanceToGreenAreaM": 120, "distanceToMainInternalRoadM": null, "distanceToPlaygroundM": 83, "distanceToSquareM": 471, "distanceToTechnicalAreaM": 407, "latitude": -20.147796, "longitude": -40.206826, "perimeterPosition": "REAR", "sector": null, "streetId": null, "streetName": null},
  "surroundings": {"appNearby": null, "frontNeighborType": "STREET", "hasGreenRear": true, "hasRearNeighbor": false, "leftNeighborType": "LOT", "rearCondition": "FENCE", "rearNeighborType": "EXTERNAL_GREEN", "rightNeighborType": "LOT", "sewageStationNearby": false, "viewDetail": "FOREST_EXTERNAL", "viewPermanence": "NOT_GUARANTEED", "viewType": "GREEN"},
  "mobility": {"estimatedTraffic": "LOW", "gateProximity": "INTERMEDIATE", "nearMainAccess": false, "routeDistanceToGateM": 637, "routeDistanceToLeisureM": 747, "streetHierarchy": "LOCAL", "vehiclesPassingEstimate": 14},
  "environmental": {"afternoonSun": ["FRONT", "SIDE"], "eastSide": "BACK", "frontBearingDeg": 225, "morningSun": ["BACK", "SIDE"], "noiseLevel": "VERY_LOW", "noiseSources": [], "northReference": "OFFICIAL_PLAN_NORTH_UP", "northSunSide": "BACK", "orientationFront": "SW", "orientationLeft": "NW", "orientationRear": "NE", "orientationRight": "SE", "privacyLevel": "VERY_HIGH", "privacyScore": 9, "quietScore": 10, "solarScore": 9.7, "ventilation": null, "viewScore": 8},
  "construction": {"buildingCoefficient": null, "constructivePotential": null, "drainage": null, "easements": [], "frontSetbackM": null, "maxFloors": null, "nonBuildableRearToConfirm": true, "occupationRate": null, "permeabilityRate": null, "rearSetbackM": null, "regulationStatus": "UNAVAILABLE", "sideSetbackM": null, "slopePercent": null, "topography": null},
  "commercial": {"availablePlans": ["P144", "P144A", "I18", "I36"], "currency": "BRL", "downPaymentDefaultPercent": 12, "downPaymentDefaultValue": 41876.27, "price": 348968.88, "pricePerM2": 1196, "priceTableId": "lancamento-2026-10", "priceTableVersion": "2026-10-06", "validFrom": null, "validUntil": null},
  "intelligence": {"alerts": [{"fieldKey": "construction.nonBuildableRearToConfirm", "id": "VJ-QB-L0079-BUILDING_RESTRICTION-0", "message": "APP/mata nos fundos (citada no evento); confirmar faixa não edificável", "severity": "IMPORTANT", "sourceId": "launch-event-v1", "title": "RESTRIÇÃO CONSTRUTIVA", "type": "BUILDING_RESTRICTION"}], "analysisVersion": "2026-10-06", "class": "A_PLUS", "confidence": "MEDIUM", "highlights": [{"fieldKey": "surroundings.hasGreenRear", "id": "VJ-QB-L0079-GREEN_REAR", "title": "Mata ou parque nos fundos", "type": "GREEN_REAR", "weight": 5}, {"fieldKey": "environmental.quietScore", "id": "VJ-QB-L0079-QUIET", "title": "Rua silenciosa (estimativa)", "type": "QUIET", "weight": 4}, "…"], "idealProfiles": ["INVESTOR", "QUIET_LIVING"], "liquidity": "VERY_HIGH", "notes": {"gate": 6, "leisure": 6.1, "liquidity": 10, "lowTraffic": 8, "priceQuality": 9.1, "relativeValue": 9.2}, "rankings": [{"position": 4, "total": 498, "type": "HOUSING"}, {"position": 1, "total": 498, "type": "INVESTMENT"}, "…"], "scores": {"family": 77, "housing": 91, "investment": 93, "overall": 89, "premium": 90}},
  "availability": {"freshness": "UNKNOWN", "notes": null, "proposalId": null, "reason": null, "reservedUntil": null, "revision": 0, "sourceId": null, "status": "UNKNOWN", "updatedAt": null},
  "provenance": {"surroundings.hasGreenRear": {"confidence": "LOW", "method": "visual-interpretation", "sourceId": "aerial-v1", "status": "CALCULATED"}, "surroundings.hasRearNeighbor": {"confidence": "LOW", "method": "visual-interpretation", "sourceId": "aerial-v1", "status": "CALCULATED"}, "surroundings.rearCondition": {"confidence": "LOW", "method": "declared", "sourceId": "launch-event-v1", "status": "TO_CONFIRM"}, "surroundings.rearNeighborType": {"confidence": "LOW", "method": "visual-interpretation", "sourceId": "aerial-v1", "status": "CALCULATED"}},
  "metadata": {"createdAt": null, "dataVersions": {"analysisVersion": "2026-10-06", "availabilityRevision": 0, "priceTableVersion": "2026-10-06", "staticVersion": "2026-10-06.1"}, "freshness": {"availability": "UNKNOWN", "commercial": "FRESH"}, "schemaVersion": "1.0", "updatedAt": null}
}
```

O exemplo estrutural da especificação (seção 129) usa valores ilustrativos; o exemplo acima é dado real do empreendimento.

## 9. Consumidores

| Consumidor | Recebe | Arquivo |
|---|---|---|
| Mapa | Lots via selectors e valores de camada (`App.services.layers`) | `presentation/map.js`, `state/selectors.js` |
| Quick View, ficha, comparação, simulação, compartilhamento | ViewModels montados a partir do Lot | `presentation/viewmodels.js` |
| Filtros, busca, recomendação | Lots (fieldKeys canônicos) | `services/finding.js` |
| Scores e atributos-chave | `Lot.intelligence` | `services/scoring.js` |
| Simulação financeira | preço e planos | `services/finance.js` |
| Análise solar | coordenadas e orientação | `services/solar.js` |
| Backend (importador, API, shadow compare) | mesmo código carregado em `vm` | `plat/backend/src/shared/domain/sharedDomain.js` |

Nenhum componente visual lê o lots.json nem chaves legadas: a busca por `fetch(`, `lots.json`, `raw.` e `getLegacyLotField` em `src/presentation`, `src/services` e `src/state` não encontra ocorrências.

## 10. Não implementado / pendente

- `metadata.createdAt` e `updatedAt` sempre `null`.
- `updateLotCommercial`, `updateLotAvailability`, `updateLotIntelligence` existem e validam, mas não são usados pelo aplicativo (as mudanças passam pelos snapshots).
- Implementado em 08/10/2026: o aviso `UNKNOWN_PROVENANCE` é emitido para valor sem proveniência registrada; nos 498 lotes publicados não há nenhum.
- `getLegacyLotField` mantido como `@deprecated` (só relatório e depuração).
- Decisão humana: regra da frente nos 35 lotes com variante de medição; formato dos 54 lotes de esquina (hoje `UNKNOWN`).
