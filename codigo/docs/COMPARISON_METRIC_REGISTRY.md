# ComparisonMetricRegistry, grupos e perfis (Tópico 24)

Cada métrica é uma `ComparisonMetricDefinition` (`App.compare.domain.METRICS`):
`id, fieldKey?, metricKey?, groupId, labelKey, label (pt-BR, do Field Registry quando há fieldKey), descriptionKey, valueType, unit, comparable,
clientVisible, brokerVisible, technicalVisible, customerContextRequired, dataSource, dynamicType, priority, sortOrder, formatterId, nullPolicy,
stalePolicy, provenancePolicy, comparisonSemantics, version`.

- valueType: MONEY, NUMBER, AREA, DISTANCE, SCORE, PERCENTAGE, ENUM, BOOLEAN, STATUS, TEXT_SHORT (o domínio guarda o valor bruto, nunca string).
- dataSource: CANONICAL_LOT, COMMERCIAL_STATE, AVAILABILITY_STATE, ANALYSIS_RESULT, FIT_RESULT, DERIVED_METRIC, PROVENANCE_SUMMARY.
- dynamicType: STATIC, VERSIONED, DYNAMIC, CONTEXTUAL. nullPolicy: DISPLAY_NO_DATA / DISPLAY_UNKNOWN (enums e booleanos). stalePolicy: SHOW_WITH_WARNING (comerciais), ALLOW_LAST_KNOWN.
- comparisonSemantics (preparação do tópico 24): LOWER_CAN_BE_PREFERABLE, HIGHER_CAN_BE_PREFERABLE, CONTEXT_DEPENDENT, CATEGORICAL, NON_ORDERED, STATUS, INFORMATIONAL. A semântica de vencedor do tópico 25 fica no registry de políticas (`config/compare`), sem duplicar fieldKey.

## Métricas por grupo (ordem do registry)

| Grupo | Métricas (id → fieldKey) | Público |
|---|---|---|
| SUMMARY | status → availability.status · area → geometry.areaM2 · price → commercial.price (preço de tabela) · pricePerM2 · lotClass → intelligence.class · primaryScore → intelligence.scores.{objetivo} · fitScore (FitScoreResult) | classe e score só corretor/técnico |
| CUSTOMER_FIT | fitCoverage, fitConfidence (FitScoreResult) | corretor/técnico; só com cliente |
| COMMERCIAL | downPayment → commercial.downPaymentDefaultValue · priceTableVersion (técnico) | — |
| GEOMETRY | front, rear, depth, shape, isCorner | todos |
| LOCATION | blockPosition, distanceToGate (percurso), distanceToLeisure, distanceToGreen, distanceToAvenue | todos |
| SURROUNDINGS | rearNeighbor, greenRear, sewageStationNearby | todos |
| MOBILITY | traffic → mobility.estimatedTraffic, streetHierarchy | todos |
| ENVIRONMENTAL | orientationFront, northSun, noiseLevel, quietScore, privacyLevel, privacyScore, solarScore, viewDetail | notas só corretor/técnico |
| CONSTRUCTION | topography, slope, constructivePotential, easements | todos (nulos ficam "Desconhecido"/"Não disponível") |
| INTELLIGENCE | housingScore, investmentScore, familyScore, premiumScore, alertsCount, analysisVersion (técnico) | corretor/técnico |
| DATA_QUALITY | availabilityFreshness, commercialFreshness, analysisConfidence, conflictsCount | corretor/técnico |

Ventilação, APP, recuos e taxas não entram: são nulos para todos os lotes e não há dado real (o grupo Construção mostra só o que existe ou o desconhecido explícito).
O score do objetivo, já exibido no Resumo, não se repete em Inteligência (mesmo campo, uma linha).

## Grupos (`GROUPS`)

`{ id, labelKey, label, description, priority, collapsedByDefault, clientVisible, brokerVisible, technicalVisible, metricIds, sortOrder }`.
Abertos por padrão: Resumo, Perfil do cliente, Comercial, Localização, Conforto. Grupo sem dados some no modo normal; no técnico aparece com "Sem dados disponíveis".

## Perfis (`PROFILES`) — trocar perfil nunca altera candidatos

| id | Grupos | Modo |
|---|---|---|
| QUICK | Resumo | corretor |
| BROKER_STANDARD (padrão) | Resumo, Perfil, Comercial, Localização, Conforto, Geometria, Vizinhança, Mobilidade, Construção, Inteligência | corretor |
| CUSTOMER | Resumo, Perfil, Comercial, Localização, Conforto, Geometria, Vizinhança (só métricas visíveis ao cliente) | cliente |
| TECHNICAL | todos, incl. Qualidade do dado | técnico |
| INVESTMENT / HOUSING | reordenam grupos; não recalculam scores nem criam metodologia | corretor |

## Camada ativa do mapa

`LAYER_METRIC` liga a camada à linha (price → price, score → primaryScore, noise → noiseLevel…). É só ênfase visual (`emphasis`), não muda valores, ordem nem avaliação.
