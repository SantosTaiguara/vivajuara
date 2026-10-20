# Mapeamento dos campos legados (lots.json → Lot canônico)

Tópico 5, itens 54, 55, 90 a 92 e 124. Este documento e o arquivo [LEGACY_FIELD_MAPPING.json](LEGACY_FIELD_MAPPING.json) foram gerados por script a partir do código real (`plat/src/data/legacyAdapter.js`, `plat/src/domain/model.js`, `plat/src/domain/availability.js`) executado sobre `dash/lots.json`. O JSON traz, para cada campo, os destinos com domínio, tipo, unidade, proveniência padrão, proveniência por lote, mapa de vocabulário e os valores observados. Campos não mapeados: [unmapped_fields.json](unmapped_fields.json).

## 1. Onde o mapeamento vive

- `App.legacy.LEGACY_KEYS` (`data/legacyAdapter.js`): cada chave do lots.json e seu destino principal. `c` está declarado com destino `null` (descartado de propósito).
- `App.legacy.NOTE_KEYS`: subchaves de `nt` (notas 0–10) e seus destinos; `ALWAYS_NULL_NOTES` = `vent`, `topo`, `pc`.
- `App.legacy.MAP`: tradução de cada texto legado para o código canônico (seção 6).
- `App.legacy.normalize(raw, ctx)`: único ponto que conhece nomes e redação do lots.json. Devolve `{ data, warnings, unmapped, variants }`. Nenhuma chave legada passa deste arquivo; `getLegacyLotField` existe só para relatório e depuração e está marcado `@deprecated`.
- `App.availability.normalizeAvailability(raw, warn)`: adaptador do status comercial legado (`st`).
- O resultado segue para `App.repos.buildSnapshotsFromLegacy` (separação em camadas) e para a `LotFactory` (validação). O backend usa o mesmo código (ver `plat/backend/docs/DATA_MIGRATION_V2.md`).

## 2. Inventário do arquivo real

| Item | Valor |
|---|---|
| Registros | 498 |
| Chaves de topo | 63 (incluindo o contêiner `nt`) |
| Subchaves de `nt` | 14 |
| Campos mapeados para o Lot | 72 |
| Campos não mapeados | 4: `c`, `nt.vent`, `nt.topo`, `nt.pc` |
| Mapeado, mas nulo em todos os registros | 1: `st` (sem espelho de vendas) |
| Chaves fora de `LEGACY_KEYS` encontradas pelo normalizador | 0 |
| Avisos de normalização no dataset atual | 0 |
| Lotes válidos / rejeitados pela LotFactory | 498 / 0 |
| Variantes de medição registradas (conflitos) | 35 |

Todas as 63 chaves de topo estão presentes nos 498 registros. As 14 subchaves de `nt` também.

## 3. Avisos que o normalizador pode emitir

| Código | Quando |
|---|---|
| `LEGACY_FIELD_UNMAPPED` | chave fora de `LEGACY_KEYS`, ou subchave de `nt` fora de `NOTE_KEYS` |
| `UNKNOWN_ENUM` | texto fora do vocabulário do mapa correspondente (o valor vira `null`, nunca um palpite) |
| `INVALID_NUMBER` | número ilegível |
| `INVALID_AREA` | área ≤ 0 |
| `INVALID_SCORE` | nota fora de 0–10 ou score fora de 0–100 |
| `MISSING_OPTIONAL_FIELD` | score ausente |
| `LEGACY_FIELD_USED` | `nt.vent`, `nt.topo` ou `nt.pc` com valor não nulo (ignorado) |
| `CONFLICTED_SOURCE` | sinais de disponibilidade divergentes (`st` e flags `isSold`, `isReserved`, `isBlocked`) |
| `RECORD_SKIPPED` | exceção ao normalizar um registro (em `buildSnapshotsFromLegacy`) |

No arquivo atual nenhum desses avisos ocorre.

## 4. Tabela legado → canônico

"Proveniência padrão" é a do Field Registry (status · fonte · método). Para alguns campos o normalizador grava proveniência por lote (seção 5).

| Campo legado | Presente | Destino canônico | Transformação | Proveniência padrão do destino |
|---|---|---|---|---|
| `id` | 498 | `identity.code` | String(id).toUpperCase(). Código curto usado em links, busca e chaves de rotas. | CONFIRMED · official-plan-v1 · official |
| `q` | 498 | `identity.blockId`<br>`identity.displayCode` | String(q).toUpperCase(). displayCode = `Q${quadra} L${número}`. | CONFIRMED · official-plan-v1 · official<br>CALCULATED · sem fonte · derived |
| `n` | 498 | `identity.lotNumber`<br>`identity.displayCode` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). A LotFactory exige inteiro > 0. | CONFIRMED · official-plan-v1 · official<br>CALCULATED · sem fonte · derived |
| `a` | 498 | `geometry.areaM2` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). Área ≤ 0 vira null com aviso INVALID_AREA. Também é a base do preço calculado (commercial.price = área × preço por m², em CommercialRepository). | CONFIRMED · official-plan-v1 · official |
| `lat` | 498 | `location.latitude` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · geospatial |
| `lon` | 498 | `location.longitude` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · geospatial |
| `p` | 498 | `geometry.polygon`<br>`geometry.centroid`<br>`geometry.bounds` | Mantidos só os vértices [x, y] numéricos. Com 3 ou mais vértices, polygonStats() calcula o centroide de área (2 casas decimais) e o retângulo envolvente. | CALCULATED · official-plan-v1 · vectorized<br>CALCULATED · official-plan-v1 · geometric<br>CALCULATED · official-plan-v1 · geometric |
| `c` | 498 | (não mapeado) | Não copiado. Era a média dos vértices; substituído por geometry.centroid (centroide de área calculado de p). |  |
| `wf` | 498 | `geometry.frontBoxWidthM`<br>`geometry.frontM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). Também é o valor de geometry.frontM quando fr está ausente. | CALCULATED · plan-geometry-v1 · geometric<br>CALCULATED · plan-geometry-v1 · geometric |
| `wb` | 498 | `geometry.rearM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · plan-geometry-v1 · geometric |
| `dp` | 498 | `geometry.averageDepthM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · plan-geometry-v1 · geometric |
| `forma` | 498 | `geometry.shape` | Mapa MAP.shape. "Esquina" e "Esquina (frente para duas ruas)" viram UNKNOWN (o texto antigo falava da posição, não do formato) e recebem proveniência UNKNOWN por lote. | CALCULATED · plan-geometry-v1 · geometric |
| `pos` | 498 | `location.blockPosition`<br>`geometry.isCorner`<br>`geometry.cornerType`<br>`geometry.frontCount` | Mapa MAP.pos. isCorner = (CORNER). cornerType = UNKNOWN para esquinas (tipo não classificado) e NONE para os demais. frontCount = 1 se INTERNAL, 2 se CORNER ou DOUBLE_FRONT. | CALCULATED · kmz-v1 · geospatial<br>CALCULATED · kmz-v1 · geospatial<br>CALCULATED · kmz-v1 · geospatial<br>CALCULATED · kmz-v1 · geospatial |
| `efic` | 498 | `geometry.usableGeometryClass` | Mapa MAP.efic. | ESTIMATED · analysis-v1 · analytical-model |
| `mconf` | 498 | `geometry.measurementConfidence` | Mapa MAP.conf. | CALCULATED · plan-geometry-v1 · geometric |
| `az` | 498 | `environmental.frontBearingDeg` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · geospatial |
| `fs` | 498 | `environmental.orientationFront` | Mapa MAP.dir (abreviações em português: L → E, SO → SW, O → W, NO → NW). | CALCULATED · kmz-v1 · geospatial |
| `bs` | 498 | `environmental.orientationRear` | Mapa MAP.dir. | CALCULATED · kmz-v1 · geospatial |
| `lat_s` | 498 | `environmental.orientationLeft`<br>`environmental.orientationRight` | Texto "X / Y" separado em "/": 1º valor → orientationLeft, 2º → orientationRight, cada um pelo mapa MAP.dir. | CALCULATED · kmz-v1 · geospatial<br>CALCULATED · kmz-v1 · geospatial |
| `manha` | 498 | `environmental.morningSun` | Lista separada por vírgula, cada item pelo mapa MAP.sunSide (frente/fundos/lateral → FRONT/BACK/SIDE). | ESTIMATED · solar-model-v1 · astronomical |
| `tarde` | 498 | `environmental.afternoonSun` | Lista separada por vírgula, mapa MAP.sunSide. | ESTIMATED · solar-model-v1 · astronomical |
| `lazer` | 498 | `environmental.northSunSide` | Mapa MAP.northSun (frase completa → BACK/FRONT/SIDE). | ESTIMATED · solar-model-v1 · astronomical |
| `quartos` | 498 | `environmental.eastSide` | Mapa MAP.eastSide (frase completa → BACK/FRONT/SIDE). | ESTIMATED · solar-model-v1 · astronomical |
| `fundo` | 498 | `surroundings.rearNeighborType`<br>`surroundings.hasRearNeighbor`<br>`location.perimeterPosition` | Mapa MAP.rear → [NeighborType, fonte, encosta no perímetro]. hasRearNeighbor = (LOT). perimeterPosition = REAR se a frase indica fora do perímetro; senão SIDE se vzE ou vzD = "Limite do condomínio"; senão NONE. Gera proveniência por lote para rearNeighborType, hasGreenRear e hasRearNeighbor (aerial-v1 → visual-interpretation, confiança LOW; kmz-v1 → geospatial, MEDIUM; "Não foi possível determinar" → UNKNOWN). | CALCULATED · kmz-v1 · geospatial<br>CALCULATED · kmz-v1 · geospatial<br>CALCULATED · kmz-v1 · rule |
| `fech` | 498 | `surroundings.rearCondition` | Mapa MAP.closure → [RearCondition, DataStatus, fonte]. Divisa com lote = CALCULATED (kmz-v1); muro e gradil = TO_CONFIRM (launch-event-v1, "necessita confirmação"); "Não informado" = UNKNOWN. Proveniência gravada por lote. | TO_CONFIRM · launch-event-v1 · declared |
| `mata` | 498 | `surroundings.hasGreenRear` | "Sim" → true, "Não" → false; outro valor → null com aviso UNKNOWN_ENUM. | CALCULATED · kmz-v1 · geospatial |
| `vista` | 498 | `surroundings.viewType`<br>`surroundings.viewPermanence`<br>`surroundings.viewDetail` | Mapa MAP.view → [ViewType, ViewPermanence, ViewDetail]: a frase antiga misturava tipo e permanência da vista; o texto original é preservado em viewDetail. | ESTIMATED · analysis-v1 · analytical-model<br>ESTIMATED · analysis-v1 · analytical-model<br>ESTIMATED · analysis-v1 · analytical-model |
| `dport` | 498 | `location.distanceToGateLinearM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · geospatial |
| `rport` | 498 | `mobility.routeDistanceToGateM`<br>`mobility.nearMainAccess` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). nearMainAccess = rport < 200. | CALCULATED · kmz-v1 · routing<br>CALCULATED · analysis-v1 · rule |
| `portc` | 498 | `mobility.gateProximity` | Mapa MAP.gate. | CALCULATED · analysis-v1 · rule |
| `dclube` | 498 | `location.distanceToClubLinearM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · geospatial |
| `rclube` | 498 | `mobility.routeDistanceToLeisureM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · routing |
| `dplay` | 498 | `location.distanceToPlaygroundM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · geospatial |
| `dpraca` | 498 | `location.distanceToSquareM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · geospatial |
| `deeeb` | 498 | `location.distanceToTechnicalAreaM`<br>`surroundings.sewageStationNearby` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). sewageStationNearby = deeeb < 40. | CALCULATED · kmz-v1 · geospatial<br>CALCULATED · kmz-v1 · rule |
| `dav` | 498 | `location.distanceToExternalRoadM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · geospatial |
| `flow` | 498 | `mobility.vehiclesPassingEstimate` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | ESTIMATED · analysis-v1 · routing |
| `fc` | 498 | `mobility.estimatedTraffic` | Mapa MAP.level (masculino e feminino). | ESTIMATED · analysis-v1 · routing |
| `via` | 498 | `mobility.streetHierarchy` | Mapa MAP.road. "Local (poucos veículos de passagem)" → LOCAL_QUIET (extensão do enum). | ESTIMATED · analysis-v1 · routing |
| `fontes` | 498 | `environmental.noiseSources` | Texto separado por ";", cada item "nome (N m)" → { type, detail, distanceM, relevance } pelo mapa MAP.noise. "Nenhuma fonte relevante identificada" → lista vazia. | ESTIMATED · analysis-v1 · analytical-model |
| `ruido` | 498 | `environmental.noiseLevel` | Mapa MAP.level. | ESTIMATED · analysis-v1 · analytical-model |
| `priv` | 498 | `environmental.privacyLevel` | Mapa MAP.level. | ESTIMATED · analysis-v1 · analytical-model |
| `liq` | 498 | `intelligence.liquidity` | Mapa MAP.level. | ESTIMATED · analysis-v1 · analytical-model |
| `nt` | 498 | (contêiner: ver nt.*) | Objeto de notas 0–10. Cada subchave é roteada pelo NOTE_KEYS (ver linhas nt.*). Nota fora de 0–10 vira null com aviso INVALID_SCORE. |  |
| `sm` | 498 | `intelligence.scores.housing` | score(): número 0–100; ausente → null com aviso MISSING_OPTIONAL_FIELD; fora da faixa → null com INVALID_SCORE. | ESTIMATED · analysis-v1 · analytical-model |
| `si` | 498 | `intelligence.scores.investment` | score() 0–100. | ESTIMATED · analysis-v1 · analytical-model |
| `sf` | 498 | `intelligence.scores.family` | score() 0–100. | ESTIMATED · analysis-v1 · analytical-model |
| `sp` | 498 | `intelligence.scores.premium` | score() 0–100. | ESTIMATED · analysis-v1 · analytical-model |
| `sg` | 498 | `intelligence.scores.overall` | score() 0–100. | ESTIMATED · analysis-v1 · analytical-model |
| `cl` | 498 | `intelligence.class` | Mapa MAP.cls ("A+" → A_PLUS); ausente ou desconhecido → UNKNOWN. | ESTIMATED · analysis-v1 · analytical-model |
| `conf` | 498 | `intelligence.confidence` | Mapa MAP.conf. | ESTIMATED · analysis-v1 · analytical-model |
| `perfil` | 498 | `intelligence.idealProfiles` | Texto separado por " / ", reconstruindo "Idosos / mobilidade" (que contém o próprio separador); cada nome pelo mapa MAP.profile. | ESTIMATED · analysis-v1 · analytical-model |
| `al` | 498 | `intelligence.alerts`<br>`construction.easements`<br>`construction.nonBuildableRearToConfirm` | Cada texto no formato `ATENÇÃO — TÍTULO: mensagem` vira { id, type, severity, title, message, fieldKey, sourceId }: tipo pelo mapa MAP.alert, severidade, campo de origem e fonte por App.rules.ALERTS; ordenado por severidade. Alertas SERVIDÃO → construction.easements (PROJECTED_EASEMENT, official-plan-v1). Existência de RESTRIÇÃO CONSTRUTIVA → nonBuildableRearToConfirm = true; sem ela, false com proveniência CALCULATED (regra da análise). | CALCULATED · analysis-v1 · rules<br>CONFIRMED · official-plan-v1 · official<br>TO_CONFIRM · launch-event-v1 · declared |
| `sideE` | 498 | `geometry.leftDepthM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · plan-geometry-v1 · geometric |
| `sideD` | 498 | `geometry.rightDepthM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · plan-geometry-v1 · geometric |
| `edgeF` | 498 | `geometry.frontEdgesM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · plan-geometry-v1 · geometric |
| `edgeB` | 498 | `geometry.rearEdgesM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · plan-geometry-v1 · geometric |
| `dpark` | 498 | `location.distanceToGreenAreaM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). | CALCULATED · kmz-v1 · geospatial |
| `vzE` | 498 | `surroundings.leftNeighborType`<br>`location.perimeterPosition` | Mapa MAP.side. "Limite do condomínio" contribui para perimeterPosition = SIDE. | CALCULATED · kmz-v1 · geospatial<br>CALCULATED · kmz-v1 · rule |
| `vzD` | 498 | `surroundings.rightNeighborType`<br>`location.perimeterPosition` | Mapa MAP.side. | CALCULATED · kmz-v1 · geospatial<br>CALCULATED · kmz-v1 · rule |
| `did` | 498 | `identity.id` | Copiado como texto. Se ausente, montado como `${dev.code}-Q${quadra}-L${número com 4 dígitos}`. Validado pelo padrão ^[A-Z0-9]+-Q[A-Z0-9]+-L\d{4}$ na LotFactory. | CALCULATED · sem fonte · id-rule |
| `st` | 498 | `availability.status` | normalizeAvailability() (domain/availability.js): código normalizado (maiúsculas, sem acento) pelo mapa LEGACY_CODES; flags isSold/isReserved/isBlocked consideradas; código desconhecido → UNKNOWN com aviso; sinais divergentes → UNKNOWN com aviso CONFLICTED_SOURCE. Nunca vira AVAILABLE por ausência. | UNKNOWN · sem fonte · – |
| `fr` | 498 | `geometry.frontM` | Número (num(): aceita número ou texto com vírgula decimal; inválido vira null com aviso INVALID_NUMBER). Quando \|fr − wf\| > 0,5 m, a diferença é registrada como variante de medição (measurementVariants), não escondida. | CALCULATED · plan-geometry-v1 · geometric |
| `nt.priv` | 498 | `environmental.privacyScore` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.sil` | 498 | `environmental.quietScore` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.sol` | 498 | `environmental.solarScore` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.vent` | 498 | (não mapeado) | Ignorada (ALWAYS_NULL_NOTES): environmental.ventilation não é uma nota 0–10. O campo canônico fica null; um valor não nulo geraria o aviso LEGACY_FIELD_USED. |  |
| `nt.vista` | 498 | `environmental.viewScore` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.topo` | 498 | (não mapeado) | Ignorada (ALWAYS_NULL_NOTES): construction.topography não é uma nota 0–10. O campo canônico fica null; um valor não nulo geraria o aviso LEGACY_FIELD_USED. |  |
| `nt.geo` | 498 | `geometry.usableGeometryScore` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.port` | 498 | `intelligence.notes.gate` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.laz` | 498 | `intelligence.notes.leisure` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.flux` | 498 | `intelligence.notes.lowTraffic` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.pc` | 498 | (não mapeado) | Ignorada (ALWAYS_NULL_NOTES): construction.constructivePotential não é uma nota 0–10. O campo canônico fica null; um valor não nulo geraria o aviso LEGACY_FIELD_USED. |  |
| `nt.liq` | 498 | `intelligence.notes.liquidity` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.val` | 498 | `intelligence.notes.relativeValue` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |
| `nt.pq` | 498 | `intelligence.notes.priceQuality` | Nota 0–10 copiada como número (fora de 0–10 → null com INVALID_SCORE). | ESTIMATED · analysis-v1 · analytical-model |

## 5. Proveniência gravada por lote

O normalizador sobrescreve a proveniência padrão quando o texto legado indica outra origem. Contagens no dataset atual:

| fieldKey | Lotes | Regra |
|---|---|---|
| `surroundings.rearNeighborType`, `hasGreenRear`, `hasRearNeighbor` | 498 | conforme `fundo`: imagem aérea → `CALCULATED`, `aerial-v1`, `visual-interpretation`, confiança LOW; KMZ → `CALCULATED`, `kmz-v1`, `geospatial`, MEDIUM; "Não foi possível determinar" → `UNKNOWN` |
| `surroundings.rearCondition` | 498 | conforme `fech`: divisa com lote → `CALCULATED`; muro ou gradil → `TO_CONFIRM` (`launch-event-v1`, `declared`, LOW); não informado → `UNKNOWN` |
| `construction.nonBuildableRearToConfirm` | 445 | lotes sem alerta de restrição construtiva: `CALCULATED`, `analysis-v1`, `rule`, MEDIUM ("Sem mata ou APP nos fundos pelo critério da análise.") |
| `geometry.shape`, `geometry.cornerType` | 54 | lotes de esquina: `UNKNOWN` ("A base antiga registrava "Esquina" no lugar do formato." / "Tipo de esquina não classificado.") |
| `availability.status` | 0 | só quando há status confirmado pela fonte (`CONFIRMED`, `declared`, HIGH) |

## 5.1 Valores que não vêm do lots.json

| fieldKey | Valor | Origem |
|---|---|---|
| `identity.developmentId` | `viva-juara` | contexto do empreendimento |
| `surroundings.frontNeighborType` | `STREET` | constante: a frente é definida pela rua de acesso |
| `environmental.northReference` | `OFFICIAL_PLAN_NORTH_UP` | constante: norte da planta oficial |
| `construction.regulationStatus` | `UNAVAILABLE` | constante: regulamento não recebido |
| `intelligence.analysisVersion` | `2026-10-06` | `DevelopmentConfig.analysisVersion` |
| `intelligence.rankings`, `intelligence.highlights` | calculados | `App.rules.rankings` e `App.rules.highlights` sobre o conjunto (`deriveDatasetIntelligence`) |
| `commercial.*` | calculados | `CommercialRepository.commercialFor(área, tabela vigente)`: preço = área × R$ 1.196/m², entrada padrão 12 %, planos P144, P144A, I18, I36 |
| `availability.*` (exceto `status`) | estado vazio | `App.availability.EMPTY()`: revisão 0, sem datas, freshness `UNKNOWN` |
| `metadata.schemaVersion` | `1.0` | `App.domain.SCHEMA_VERSION` |

## 6. Mapas de vocabulário (texto legado → código)

Cada mapa é total para o dataset atual; qualquer outro texto gera `UNKNOWN_ENUM` e valor `null`. Para mapas com tuplas, a ordem é a indicada no código: `rear` = [NeighborType, fonte, encosta no perímetro]; `closure` = [RearCondition, DataStatus, fonte]; `view` = [ViewType, ViewPermanence, ViewDetail]; `noise` = [NoiseSourceType, detalhe, relevância].

**MAP.level**

| Texto legado | Valor canônico |
|---|---|
| Muito baixo | VERY_LOW |
| Muito baixa | VERY_LOW |
| Baixo | LOW |
| Baixa | LOW |
| Médio | MEDIUM |
| Média | MEDIUM |
| Alto | HIGH |
| Alta | HIGH |
| Muito alto | VERY_HIGH |
| Muito alta | VERY_HIGH |

**MAP.cls**

| Texto legado | Valor canônico |
|---|---|
| A+ | A_PLUS |
| A | A |
| B | B |
| C | C |
| D | D |

**MAP.dir**

| Texto legado | Valor canônico |
|---|---|
| N | N |
| NE | NE |
| L | E |
| SE | SE |
| S | S |
| SO | SW |
| O | W |
| NO | NW |

**MAP.shape**

| Texto legado | Valor canônico |
|---|---|
| Retangular | RECTANGULAR |
| Quadrado | SQUARE |
| Trapezoidal | TRAPEZOIDAL |
| Irregular | IRREGULAR |
| Esquina | UNKNOWN |
| Retangular (frente para duas ruas) | RECTANGULAR |
| Esquina (frente para duas ruas) | UNKNOWN |

**MAP.pos**

| Texto legado | Valor canônico |
|---|---|
| Interno | INTERNAL |
| Esquina | CORNER |
| Frente para duas ruas | DOUBLE_FRONT |

**MAP.efic**

| Texto legado | Valor canônico |
|---|---|
| Boa | GOOD |
| Média | MEDIUM |
| Baixa | LOW |

**MAP.conf**

| Texto legado | Valor canônico |
|---|---|
| Alta | HIGH |
| Média | MEDIUM |
| Baixa | LOW |

**MAP.rear**

| Texto legado | Valor canônico |
|---|---|
| Outro lote | LOT · kmz-v1 · false |
| Fora do perímetro: área externa aberta (imagem aérea) | EXTERNAL_PROPERTY · aerial-v1 · true |
| Fora do perímetro: mata/vegetação densa (imagem aérea) | EXTERNAL_GREEN · aerial-v1 · true |
| Parque florestal / área verde do condomínio (KMZ) | GREEN_AREA · kmz-v1 · false |
| Rua (lote com frente para duas ruas) | STREET · kmz-v1 · false |
| Não foi possível determinar | UNKNOWN ·  · false |

**MAP.side**

| Texto legado | Valor canônico |
|---|---|
| Outro lote | LOT |
| Rua | STREET |
| Área comum | COMMON_AREA |
| Parque florestal / área verde | GREEN_AREA |
| Limite do condomínio | CONDO_BOUNDARY |
| Não determinado | UNKNOWN |

**MAP.closure**

| Texto legado | Valor canônico |
|---|---|
| Divisa com outro lote (não é perímetro) | LOT_BOUNDARY · CALCULATED · kmz-v1 |
| Muro (conforme evento de lançamento) – necessita confirmação | WALL · TO_CONFIRM · launch-event-v1 |
| Gradil (lotes com APP/mata atrás, conforme evento de lançamento) – necessita confirmação | FENCE · TO_CONFIRM · launch-event-v1 |
| Não informado – necessita confirmação | UNKNOWN · UNKNOWN ·  |

**MAP.view**

| Texto legado | Valor canônico |
|---|---|
| Vista interna (lotes vizinhos) | INTERNAL · UNKNOWN · INTERNAL |
| Vista interna (lotes vizinhos); frente próxima a praça/clube | INTERNAL · UNKNOWN · INTERNAL_NEAR_SQUARE |
| Vista aberta para área externa (pode ser ocupada no futuro) | OPEN · NOT_GUARANTEED · OPEN_EXTERNAL |
| Vista para mata fora do perímetro (atual; permanência não confirmada) | GREEN · NOT_GUARANTEED · FOREST_EXTERNAL |
| Vista para parque florestal do condomínio (atual; manutenção como área verde a confirmar) | GREEN · LIKELY · CONDO_PARK |
| Vista para rua nos dois lados | URBAN · UNKNOWN · STREET_BOTH_SIDES |

**MAP.gate**

| Texto legado | Valor canônico |
|---|---|
| Muito próximo | VERY_CLOSE |
| Próximo | CLOSE |
| Intermediário | INTERMEDIATE |
| Distante | FAR |

**MAP.road**

| Texto legado | Valor canônico |
|---|---|
| Principal (acesso de muitos lotes à portaria/clube) | MAIN |
| Secundária (passagem de outros moradores) | SECONDARY |
| Local | LOCAL |
| Local (poucos veículos de passagem) | LOCAL_QUIET |
| Final de rua sem saída (balão de retorno) | CUL_DE_SAC |

**MAP.sunSide**

| Texto legado | Valor canônico |
|---|---|
| frente | FRONT |
| fundos | BACK |
| lateral | SIDE |

**MAP.northSun**

| Texto legado | Valor canônico |
|---|---|
| Fundos (recebem sol do norte: bom para piscina e área de lazer) | BACK |
| Frente/recuo frontal recebe o sol do norte; nos fundos a piscina tende a ter mais sombra | FRONT |
| Lateral voltada para o norte, conforme projeto | SIDE |

**MAP.eastSide**

| Texto legado | Valor canônico |
|---|---|
| Lado leste (sol da manhã): fundos | BACK |
| Lado leste (sol da manhã): frente | FRONT |
| Lado leste (sol da manhã): lateral leste | SIDE |

**MAP.noise**

| Texto legado | Valor canônico |
|---|---|
| Av. Porto Dourado | EXTERNAL_ROAD · AVENUE ·  |
| fluxo médio na rua | INTERNAL_ROAD · STREET_FLOW · MEDIUM |
| fluxo alto na rua | INTERNAL_ROAD · STREET_FLOW · HIGH |
| fluxo muito alto na rua | INTERNAL_ROAD · STREET_FLOW · VERY_HIGH |
| praça | LEISURE · SQUARE ·  |
| playground | LEISURE · PLAYGROUND ·  |
| clube | LEISURE · CLUB ·  |
| portaria | GATE · GATE ·  |
| EEEB | TECHNICAL_AREA · PUMP_STATION ·  |
| estacionamento | PARKING · PARKING ·  |

**MAP.alert**

| Texto legado | Valor canônico |
|---|---|
| TRÁFEGO | TRAFFIC |
| SOL DA TARDE | AFTERNOON_SUN |
| RESTRIÇÃO CONSTRUTIVA | BUILDING_RESTRICTION |
| PRIVACIDADE | PRIVACY |
| AVENIDA | AVENUE |
| RUÍDO | NOISE |
| ÁREA TÉCNICA | TECHNICAL_AREA |
| GEOMETRIA | GEOMETRY |
| SERVIDÃO | EASEMENT |

**MAP.profile**

| Texto legado | Valor canônico |
|---|---|
| Moradia e tranquilidade | QUIET_LIVING |
| Idosos / mobilidade | ELDERLY_MOBILITY |
| Investidor | INVESTOR |
| Família com crianças | FAMILY |
| Cliente que valoriza natureza | NATURE |
| Alto padrão | HIGH_END |

Mapa de status comercial (`App.availability.LEGACY_CODES`, depois de maiúsculas e remoção de acentos): `DISP`, `DISPONIVEL`, `AVAILABLE` → AVAILABLE; `RES`, `RESERVADO`, `RESERVED` → RESERVED; `PROP`, `PROPOSTA`, `PROPOSAL` → PROPOSAL; `BLOQ`, `BLOQUEADO`, `BLOCKED` → BLOCKED; `VEND`, `VENDIDO`, `SOLD` → SOLD; `INDISP`, `INDISPONIVEL`, `UNAVAILABLE` → UNAVAILABLE. Flags: `isSold` → SOLD, `isReserved` → RESERVED, `isBlocked` → BLOCKED. Nenhum desses códigos ou flags aparece no lots.json atual: `st` é `null` nos 498 registros.

## 7. Campos duplicados, ambíguos e conflitantes

| Caso | Campos legados | Tratamento no código |
|---|---|---|
| Duplicado | `c` (média dos vértices) e `p` (polígono) | `c` descartado; `geometry.centroid` recalculado de `p` como centroide de área |
| Duplicado parcial | `pos` e `forma` falam de esquina | posição vai para `location.blockPosition` e `geometry.isCorner`; "Esquina" em `forma` vira `geometry.shape = UNKNOWN` com proveniência UNKNOWN (54 lotes) |
| Ambíguo | `vista` mistura tipo de vista e permanência | separado em `viewType`, `viewPermanence` e `viewDetail` (texto original preservado em `viewDetail`) |
| Ambíguo | `fundo` mistura vizinho, fonte e perímetro | separado em `rearNeighborType`, `hasRearNeighbor`, `perimeterPosition` e proveniência por lote |
| Ambíguo | `fech` mistura fechamento e grau de certeza | `rearCondition` + status `TO_CONFIRM` por lote |
| Dois valores num campo | `lat_s` ("X / Y") | `orientationLeft` e `orientationRight` |
| Categoria e nota do mesmo tema | `priv` e `nt.priv`; `ruido` e `nt.sil`; `liq` e `nt.liq` | mantidos como campos distintos: nível (`environmental.privacyLevel`) e nota 0–10 (`environmental.privacyScore`) etc. |
| Conflito de medição | `fr`, `wf`, `edgeF` | `geometry.frontM` = `fr` (ou `wf` se `fr` ausente); quando a diferença entre `fr` e `wf` passa de 0,5 m a variante é registrada |

Conflitos registrados (`conflictingFields` no JSON): 35 lotes em que a frente usada (`fr`) difere da largura na frente (`wf`) em mais de 0,5 m. Regra aplicada: "frente = soma das arestas de frente nos lotes em leque, senão a largura na frente". Lotes: B65, B66, B67, B68, B69, B83, B85, B86, G16, G17, G18, G19, I4, I7, I10, I21, I22, I23, I24, I25, K13, K14, K15, K16, K17, K18, L15, O7, O8, O9, Q21, Q22, Q23, Q24, Q25. As três medidas ficam disponíveis no Lot (`frontM`, `frontBoxWidthM`, `frontEdgesM`); nenhuma é descartada.

## 8. Não implementado / pendente

- `nt.vent`, `nt.topo`, `nt.pc`: sempre nulos na origem; os campos canônicos (`environmental.ventilation`, `construction.topography`, `construction.constructivePotential`) ficam `null` até existir dado e metodologia.
- `st`: mapeado, mas sem valor. Quando houver espelho de vendas, ele entra pelo canal de disponibilidade (`applyAvailabilityFeed` ou feed anunciado no manifest), não pelo lots.json.
- Decisão humana: confirmar a regra da frente nos 35 lotes com variante (a regra atual é a do normalizador).
