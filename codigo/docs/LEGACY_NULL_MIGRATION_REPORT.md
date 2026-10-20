# Relatório de migração de nulos legados (Tópico 37)

Gerado por `App.dataState.legacyNullInventory(lots)` sobre os 498 lotes publicados (2026-10-09). Nenhum valor canônico foi alterado: a classificação é metadado aditivo lido pelo resolver.

## Inventário (LegacyNullInventoryItem)

| Atributo | Representação | Ocorrências | Estado proposto | Motivo | Certeza | Revisão humana | Evidência / nota |
|---|---|---|---|---|---|---|---|
| `availability.notes` | `null` | 498 | UNKNOWN | SOURCE_NOT_INGESTED | HIGH | não | Idem. |
| `availability.proposalId` | `null` | 498 | UNKNOWN | SOURCE_NOT_INGESTED | HIGH | não | Idem. |
| `availability.reason` | `null` | 498 | UNKNOWN | SOURCE_NOT_INGESTED | HIGH | não | Sem status não se sabe se há motivo; não é NOT_APPLICABLE. |
| `availability.reservedUntil` | `null` | 498 | UNKNOWN | SOURCE_NOT_INGESTED | HIGH | não | Idem. |
| `availability.revision` | `0` | 498 | KNOWN | — | HIGH | não | Zero mantido como valor conhecido (policy allowKnownZero). |
| `availability.sourceId` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_INGESTED | HIGH | não | Idem. |
| `availability.updatedAt` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_INGESTED | HIGH | não | Sem espelho de vendas integrado (status UNKNOWN em todos os lotes). |
| `commercial.validFrom` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | commercial.json: priceTables[].validFrom = null explícito ("validade não informada"). |
| `commercial.validUntil` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | commercial.json: priceTables[].validUntil = null explícito. |
| `construction.buildingCoefficient` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | Idem (regulamento construtivo). |
| `construction.constructivePotential` | `null` | 498 | NOT_AVAILABLE | MISSING_REQUIRED_INPUT | HIGH | não | Registro: "Sem regulamento não há metodologia". |
| `construction.drainage` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | MEDIUM | sim | Registro: "Falta projeto de drenagem". |
| `construction.easements` | `[]` | 493 | KNOWN | — | HIGH | não | Coleção vazia conhecida (allowKnownEmptyCollection). |
| `construction.frontSetbackM` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | construction.regulationStatus = UNAVAILABLE (regulamento não recebido). |
| `construction.maxFloors` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | Idem (regulamento construtivo). |
| `construction.occupationRate` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | Idem (regulamento construtivo). |
| `construction.permeabilityRate` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | Idem (regulamento construtivo). |
| `construction.rearSetbackM` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | Idem (regulamento construtivo). |
| `construction.sideSetbackM` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | Idem (regulamento construtivo). |
| `construction.slopePercent` | `null` | 498 | NOT_AVAILABLE | NOT_MEASURED | MEDIUM | sim | Registro: "Falta levantamento planialtimétrico". |
| `construction.topography` | `null` | 498 | NOT_AVAILABLE | NOT_MEASURED | MEDIUM | sim | Registro: "Falta levantamento planialtimétrico". |
| `environmental.frontBearingDeg` | `0` | 1 | KNOWN | — | HIGH | não | Zero mantido como valor conhecido (policy allowKnownZero). |
| `environmental.noiseSources` | `[]` | 121 | KNOWN | — | HIGH | não | Coleção vazia conhecida (allowKnownEmptyCollection). |
| `environmental.privacyScore` | `0` | 1 | KNOWN | — | HIGH | não | Zero mantido como valor conhecido (policy allowKnownZero). |
| `environmental.ventilation` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | MEDIUM | sim | Registro: "Sem dados de vento". |
| `geometry.cornerType` | `"UNKNOWN"` | 54 | UNKNOWN | LEGACY_UNCLASSIFIED | LOW | sim | Código de enum UNKNOWN lido como estado, sem valor operacional. |
| `geometry.irregularityLevel` | `null` | 498 | NOT_AVAILABLE | DERIVATION_NOT_POSSIBLE | HIGH | não | Registro: "Não calculado: sem metodologia própria". |
| `geometry.leftDepthM` | `0` | 1 | KNOWN | — | HIGH | sim | Zero mantido como valor conhecido; medida da planta pede revisão humana (não reclassificado). |
| `geometry.perimeterM` | `null` | 498 | NOT_AVAILABLE | DERIVATION_NOT_POSSIBLE | HIGH | não | Registro: "sem metodologia aprovada para o traço da planta". |
| `geometry.rearEdgesM` | `0` | 2 | KNOWN | — | HIGH | sim | Zero mantido como valor conhecido; medida da planta pede revisão humana (não reclassificado). |
| `geometry.rightDepthM` | `0` | 2 | KNOWN | — | HIGH | sim | Zero mantido como valor conhecido; medida da planta pede revisão humana (não reclassificado). |
| `geometry.shape` | `"UNKNOWN"` | 54 | UNKNOWN | SOURCE_NOT_PROVIDED | HIGH | não | Código de enum UNKNOWN lido como estado, sem valor operacional. |
| `identity.blockNumber` | `null` | 498 | NOT_APPLICABLE | NOT_APPLICABLE_BY_DOMAIN | HIGH | não | Registro: quadras identificadas por letra (status NOT_APPLICABLE). |
| `identity.externalCode` | `null` | 498 | UNKNOWN | LEGACY_UNCLASSIFIED | LOW | sim |  |
| `intelligence.alerts` | `[]` | 215 | KNOWN | — | HIGH | não | Coleção vazia conhecida (allowKnownEmptyCollection). |
| `intelligence.highlights` | `[]` | 18 | KNOWN | — | HIGH | não | Coleção vazia conhecida (allowKnownEmptyCollection). |
| `location.distanceToAppM` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | Registro: "Não há APP delimitada no material recebido". |
| `location.distanceToMainInternalRoadM` | `null` | 498 | UNKNOWN | LEGACY_UNCLASSIFIED | LOW | sim |  |
| `location.sector` | `null` | 498 | UNKNOWN | LEGACY_UNCLASSIFIED | LOW | sim |  |
| `location.streetId` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | Registro: "A planta só traz ruas projetadas". |
| `location.streetName` | `null` | 498 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | MEDIUM | sim | Sem nome oficial de rua no material (ruas projetadas). |
| `mobility.vehiclesPassingEstimate` | `0` | 17 | KNOWN | — | HIGH | não | Zero mantido como valor conhecido (policy allowKnownZero). |
| `surroundings.appNearby` | `null` | 498 | UNKNOWN | LEGACY_UNCLASSIFIED | LOW | sim |  |
| `surroundings.rearCondition` | `"UNKNOWN"` | 30 | NOT_AVAILABLE | SOURCE_NOT_PROVIDED | HIGH | não | Código de enum UNKNOWN lido como estado, sem valor operacional. |
| `surroundings.rearNeighborType` | `"UNKNOWN"` | 5 | UNKNOWN | LEGACY_UNCLASSIFIED | LOW | sim | Código de enum UNKNOWN lido como estado, sem valor operacional. |
| `surroundings.viewPermanence` | `"UNKNOWN"` | 325 | UNKNOWN | LEGACY_UNCLASSIFIED | LOW | sim | Código de enum UNKNOWN lido como estado, sem valor operacional. |

## Mapeamentos automáticos seguros
Somente onde o Field Registry ou um campo irmão sustenta o motivo (`NULL_CLASSIFICATION`): recuos/taxas/coeficiente/pavimentos
(regulamento `UNAVAILABLE`), potencial construtivo (MISSING_REQUIRED_INPUT), perímetro/irregularidade (sem metodologia),
rua (planta só com ruas projetadas), APP (não delimitada), validade da tabela (null explícito em commercial.json),
campos de disponibilidade (sem espelho de vendas), número da quadra (NOT_APPLICABLE por domínio).

## Não resolvidos (revisão humana)
`identity.externalCode`, `location.sector`, `location.distanceToMainInternalRoadM`, `surroundings.appNearby`
(UNKNOWN / LEGACY_UNCLASSIFIED); `construction.topography/slopePercent/drainage`, `environmental.ventilation`, `location.streetName`
(NOT_AVAILABLE com certeza MEDIUM); códigos UNKNOWN de `geometry.shape`, `geometry.cornerType`, `surroundings.viewPermanence`,
`surroundings.rearNeighborType`; zeros geométricos (left/right depth, rear edges).
