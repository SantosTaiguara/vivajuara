# Modelo de domínio do lote (Field Registry)

Tópico 5. Documento gerado a partir do código em `plat/src/domain/model.js` (Field Registry), `plat/src/domain/enums.js` (vocabulários) e `plat/src/utils/i18n.js` (rótulos). As tabelas de campos e de enums foram produzidas por script a partir desses módulos; se o código mudar, o código vale.

Documentos relacionados: [LOT_DOMAIN_MODEL.md](LOT_DOMAIN_MODEL.md) (agregado Lot e validação), [LEGACY_FIELD_MAPPING.md](LEGACY_FIELD_MAPPING.md) (lots.json → campos canônicos), [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md) (STATIC, VERSIONED, DYNAMIC), [AVAILABILITY_DOMAIN.md](AVAILABILITY_DOMAIN.md).

## 1. Fonte de verdade

O Field Registry (`App.model.FIELDS`) declara cada atributo canônico uma única vez. Validação (`domain/lot.js`), proveniência (`getFieldProvenance`), filtros (`services/finding.js`), camadas do mapa (`services/layers.js`), comparação e ficha (`presentation/viewmodels.js`), ciclo de vida (`data/lifecycle.js`) e esta documentação leem a mesma tabela.

Cada registro (`R(...)` em `model.js`) tem:

| Atributo | Significado |
|---|---|
| `key` | fieldKey canônico, caminho dentro do Lot (ex.: `geometry.areaM2`) |
| `domain` / `subdomain` | domínio funcional e agrupamento interno |
| `label` | rótulo em português usado na interface |
| `type` | `string`, `number`, `boolean`, `enum`, `array`, `geometry`, `date`, `datetime` |
| `unit` | unidade (`m²`, `m`, `BRL`, `BRL/m²`, `score 0–10`, `score 0–100`, `%`, `graus`, `lotes`) |
| `nullable` | se o valor pode ser `null` sem erro |
| `priority` | P0 a P3 (P0 = essencial) |
| `filterable`, `comparable`, `scoreInput`, `alertInput` | uso do campo (colunas F, C, S, A nas tabelas) |
| `dynamicType` | `STATIC`, `VERSIONED` ou `DYNAMIC` (ver DATA_LIFECYCLE.md) |
| `status`, `sourceId`, `method`, `confidence` | proveniência padrão do campo |
| `legacy` | campo de origem no lots.json |
| `meaning` | definição em linguagem simples (aparece no popover de evidência) |
| `enum`, `dependsOn`, `notes`, `virtual` | vocabulário, dependências, observações; `virtual` = não armazenado no Lot |

Funções de consulta: `App.model.field(key)`, `getFieldsByDomain(d)`, `getStoredFields()`, `getFilterableFields()`, `getComparableFields()`, `getScoreInputs()`, `getAlertInputs()`, `getFieldProvenance(lot, key)`, `criterion(lot, k)`.

## 2. Estrutura do Lot

```
Lot
├── identity        identificação (ID técnico, código, quadra, lote)
├── geometry        medidas, formato, polígono, centroide
├── location        posição na quadra, coordenadas, distâncias em linha reta
├── surroundings    vizinhos, mata nos fundos, vista, estação elevatória
├── mobility        tipo de via, trânsito estimado, percursos
├── environmental   orientação, sol, ruído, privacidade, ventilação
├── construction    terreno, recuos, servidões, regulamento
├── commercial      preço, preço por m², entrada, planos, tabela
├── intelligence    scores, classe, notas, alertas, destaques, rankings
├── availability    status comercial e metadados (domínio próprio, tópico 8)
├── provenance      sobrescritas de proveniência por campo e por lote
└── metadata        schemaVersion, dataVersions, freshness
```

## 3. Domínios

| Código | Nome | Campos | Ciclo de vida dos campos | Observação |
|---|---|---|---|---|
| `IDENTITY` | Identificação | 9 | 9 STATIC | `identity.developmentName` é virtual (lido do DevelopmentConfig) |
| `GEOMETRY` | Geometria | 21 | 19 STATIC, 2 VERSIONED | nota e classe de aproveitamento vêm da análise |
| `LOCATION` | Localização | 16 | 16 STATIC | distâncias em linha reta calculadas sobre o KMZ |
| `SURROUNDINGS` | Vizinhança | 12 | 9 STATIC, 3 VERSIONED | vista vem da análise |
| `MOBILITY` | Mobilidade e trânsito | 9 | 4 STATIC, 5 VERSIONED | rotas desenhadas são virtuais (carregadas sob demanda de routes.json) |
| `ENVIRONMENTAL` | Conforto ambiental | 18 | 7 STATIC, 11 VERSIONED | sol, ruído e privacidade são estimativas |
| `CONSTRUCTION` | Construção e restrições | 14 | 13 STATIC, 1 VERSIONED | 11 campos sem dado (sem regulamento, topografia e drenagem) |
| `COMMERCIAL` | Comercial | 10 | 10 DYNAMIC | vem da tabela de preço, não do lots.json |
| `INTELLIGENCE` | Inteligência | 18 | 18 VERSIONED | metodologia da análise inalterada |
| `PROVENANCE` | Proveniência e qualidade do dado | 2 | 1 STATIC, 1 VERSIONED | `intelligence.confidence` e `metadata.schemaVersion` |
| `AVAILABILITY` | Disponibilidade | 9 | 9 DYNAMIC | ver AVAILABILITY_DOMAIN.md |
| **Total** | | **138** | **78 STATIC, 41 VERSIONED, 19 DYNAMIC** | 135 armazenados, 3 virtuais |

Totais por uso: 45 filtráveis, 71 comparáveis, 31 entradas de score, 18 entradas de alerta. Por prioridade: 9 P0, 34 P1, 53 P2, 42 P3.

## 4. Status do dado e as cinco categorias de exibição

Todo valor exibido carrega um status (`DataStatus`). A interface agrupa os status nas categorias que o corretor usa:

| Categoria na regra do produto | `DataStatus` | Rótulo (`i18n.DataStatus`) | Rótulo curto (selo na ficha) | Campos com esse status padrão |
|---|---|---|---|---|
| Confirmado | `CONFIRMED` | Confirmado | Oficial | 17 |
| Calculado | `CALCULATED` | Calculado | Calculado | 54 |
| Estimado | `ESTIMATED` | Estimado | Estimado | 34 |
| Necessita confirmação | `TO_CONFIRM` | Requer validação | Validar | 2 (`surroundings.rearCondition`, `construction.nonBuildableRearToConfirm`) |
| Não disponível | `UNKNOWN` | Não disponível | Não disponível | 30 |
| (complementares) | `NOT_APPLICABLE`, `CONFLICTED` | Não aplicável, Fontes divergentes | Não aplicável, Divergente | 1 (`identity.blockNumber`), 0 |

Regras (em `getFieldProvenance`, `model.js`):

1. Se o lote tem sobrescrita em `lot.provenance[fieldKey]`, ela vale (ex.: `surroundings.rearCondition` muda de status conforme o texto de origem).
2. Senão vale o padrão do registro.
3. Campo anulável com valor `null` é sempre `UNKNOWN` (sem fonte, sem método), exceto `NOT_APPLICABLE`.

Dados de negócio que seguem essas regras hoje:

- Preço por m²: R$ 1.196 (`priceTables[0].pricePerM2 = 299000 / 250` em `config/developments.js`, fonte `price-table-v1`, "Lote de 250 m² por R$ 299.000"). Status `CONFIRMED`.
- Preço do lote: `CALCULATED` (área × preço por m² da tabela vigente).
- Scores, classes, ruído, privacidade, sol, trânsito, vista: `ESTIMATED` (metodologia `analysis-v1`, `solar-model-v1`).
- Muro e gradil nos fundos: `TO_CONFIRM` (citados no evento de lançamento).
- Disponibilidade: `UNKNOWN` para os 498 lotes (não há espelho de vendas).
- A análise não promete valorização: as notas de liquidez e de valor relativo dizem no próprio significado "não é promessa de valorização", e a comparação mostra "É leitura da análise, não promessa de valorização" (`presentation/overlays.js`).

## 5. Fontes declaradas

Definidas em `config/developments.js` (`sources`) e referenciadas por `sourceId`:

| sourceId | Tipo | Nome | Precisão declarada |
|---|---|---|---|
| `official-plan-v1` | PLAN | Planta de situação do parcelamento (PDF oficial) | Escala 1:1000; áreas oficiais com duas casas decimais |
| `plan-geometry-v1` | CALCULATION | Medidas calculadas sobre a planta oficial | Cerca de 0,3 m (espessura do traço) |
| `kmz-v1` | GIS | Implantação georreferenciada (KMZ) | Cerca de 0,12 m por pixel |
| `aerial-v1` | IMAGE | Ilustração aérea de divulgação | Ilustrativa; posição aproximada |
| `launch-event-v1` | EVENT | Gravação do evento de lançamento | Declarações verbais |
| `price-table-v1` | PRICE_TABLE | Tabela de preço confirmada pelo corretor | Exata |
| `analysis-v1` | ANALYSIS | Modelo de análise do Viva Juara | Estimativa comparativa |
| `solar-model-v1` | ANALYSIS | Cálculo astronômico para Serra/ES | Não considera sombra de vizinhos, muros ou árvores |
| `renders-v1` | IMAGE | Imagens de divulgação do empreendimento | Ilustrativas |

## 6. Campos por domínio

Legenda da coluna Uso: F = filtrável, C = comparável, S = entrada de score, A = entrada de alerta, · = nenhum. "Status padrão" é o do registro; a sobrescrita por lote pode mudá-lo (ver seção 4).

### Identificação (`IDENTITY`, 9 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `identity.id` | ID do lote | string |  | não | P0 | · | STATIC | CALCULATED |  | did |
| `identity.code` | Código do lote | string |  | não | P0 | · | STATIC | CONFIRMED | official-plan-v1 | id |
| `identity.developmentId` | Empreendimento | string |  | não | P0 | · | STATIC | CONFIRMED |  |  |
| `identity.developmentName` (virtual) | Nome do empreendimento | string |  | não | P3 | · | STATIC | CONFIRMED |  |  |
| `identity.blockId` | Quadra | string |  | não | P0 | F C | STATIC | CONFIRMED | official-plan-v1 | q |
| `identity.blockNumber` | Número da quadra | number |  | sim | P3 | · | STATIC | NOT_APPLICABLE | official-plan-v1 |  |
| `identity.lotNumber` | Lote | number |  | não | P0 | · | STATIC | CONFIRMED | official-plan-v1 | n |
| `identity.displayCode` | Código de exibição | string |  | não | P1 | · | STATIC | CALCULATED |  |  |
| `identity.externalCode` | Código da loteadora | string |  | sim | P3 | · | STATIC | UNKNOWN |  |  |

### Geometria (`GEOMETRY`, 21 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `geometry.areaM2` | Área | number | m² | sim | P0 | F C S A | STATIC | CONFIRMED | official-plan-v1 | a |
| `geometry.frontM` | Frente | number | m | sim | P1 | F C A | STATIC | CALCULATED | plan-geometry-v1 | fr |
| `geometry.rearM` | Fundos | number | m | sim | P2 | C | STATIC | CALCULATED | plan-geometry-v1 | wb |
| `geometry.leftDepthM` | Lateral esquerda | number | m | sim | P2 | C | STATIC | CALCULATED | plan-geometry-v1 | sideE |
| `geometry.rightDepthM` | Lateral direita | number | m | sim | P2 | C | STATIC | CALCULATED | plan-geometry-v1 | sideD |
| `geometry.averageDepthM` | Profundidade média | number | m | sim | P2 | C | STATIC | CALCULATED | plan-geometry-v1 | dp |
| `geometry.perimeterM` | Perímetro | number | m | sim | P3 | · | STATIC | UNKNOWN |  |  |
| `geometry.shape` | Formato | enum (LotShape) |  | sim | P2 | F C A | STATIC | CALCULATED | plan-geometry-v1 | forma |
| `geometry.isCorner` | Esquina | boolean |  | não | P1 | F C S | STATIC | CALCULATED | kmz-v1 | pos/forma |
| `geometry.cornerType` | Tipo de esquina | enum (CornerType) |  | sim | P3 | · | STATIC | CALCULATED | kmz-v1 | pos |
| `geometry.frontCount` | Frentes para rua | number |  | não | P2 | F C | STATIC | CALCULATED | kmz-v1 | pos |
| `geometry.irregularityLevel` | Irregularidade | enum (Level) |  | sim | P3 | · | STATIC | UNKNOWN |  |  |
| `geometry.usableGeometryScore` | Nota de geometria | number | score 0–10 | sim | P2 | C S A | VERSIONED | ESTIMATED | analysis-v1 | nt.geo |
| `geometry.usableGeometryClass` | Aproveitamento do formato | enum (Efficiency) |  | sim | P2 | C | VERSIONED | ESTIMATED | analysis-v1 | efic |
| `geometry.measurementConfidence` | Confiabilidade das medidas | enum (Confidence) |  | não | P3 | · | STATIC | CALCULATED | plan-geometry-v1 | mconf |
| `geometry.frontBoxWidthM` | Largura na frente (caixa) | number | m | sim | P3 | S | STATIC | CALCULATED | plan-geometry-v1 | wf |
| `geometry.frontEdgesM` | Soma das arestas de frente | number | m | sim | P3 | · | STATIC | CALCULATED | plan-geometry-v1 | edgeF |
| `geometry.rearEdgesM` | Soma das arestas de fundos | number | m | sim | P3 | · | STATIC | CALCULATED | plan-geometry-v1 | edgeB |
| `geometry.polygon` | Contorno | geometry | unidade do mapa | não | P3 | · | STATIC | CALCULATED | official-plan-v1 | p |
| `geometry.centroid` | Centroide | geometry | unidade do mapa | não | P3 | · | STATIC | CALCULATED | official-plan-v1 | c (substituído) |
| `geometry.bounds` | Retângulo envolvente | geometry | unidade do mapa | não | P3 | · | STATIC | CALCULATED | official-plan-v1 |  |

### Localização (`LOCATION`, 16 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `location.streetId` | Rua (código) | string |  | sim | P3 | · | STATIC | UNKNOWN |  |  |
| `location.streetName` | Rua | string |  | sim | P2 | · | STATIC | UNKNOWN |  |  |
| `location.blockPosition` | Posição na quadra | enum (BlockPosition) |  | não | P1 | F C S | STATIC | CALCULATED | kmz-v1 | pos |
| `location.perimeterPosition` | Posição no perímetro | enum (PerimeterPosition) |  | não | P2 | F C | STATIC | CALCULATED | kmz-v1 | fundo/vzE/vzD |
| `location.sector` | Setor | string |  | sim | P3 | · | STATIC | UNKNOWN |  |  |
| `location.latitude` | Latitude | number | graus | não | P3 | · | STATIC | CALCULATED | kmz-v1 | lat |
| `location.longitude` | Longitude | number | graus | não | P3 | · | STATIC | CALCULATED | kmz-v1 | lon |
| `location.distanceToGateLinearM` | Portaria (linha reta) | number | m | não | P2 | F C S A | STATIC | CALCULATED | kmz-v1 | dport |
| `location.distanceToClubLinearM` | Clube (linha reta) | number | m | não | P2 | F C S | STATIC | CALCULATED | kmz-v1 | dclube |
| `location.distanceToGreenAreaM` | Parque florestal mais próximo | number | m | não | P2 | F C | STATIC | CALCULATED | kmz-v1 | dpark |
| `location.distanceToPlaygroundM` | Playground mais próximo | number | m | não | P2 | C S | STATIC | CALCULATED | kmz-v1 | dplay |
| `location.distanceToSquareM` | Praça mais próxima | number | m | não | P2 | C S | STATIC | CALCULATED | kmz-v1 | dpraca |
| `location.distanceToExternalRoadM` | Av. Porto Dourado | number | m | não | P2 | F C S A | STATIC | CALCULATED | kmz-v1 | dav |
| `location.distanceToTechnicalAreaM` | Estação elevatória (EEEB) | number | m | não | P2 | C S A | STATIC | CALCULATED | kmz-v1 | deeeb |
| `location.distanceToAppM` | APP mais próxima | number | m | sim | P3 | · | STATIC | UNKNOWN |  |  |
| `location.distanceToMainInternalRoadM` | Via interna principal | number | m | sim | P3 | · | STATIC | UNKNOWN |  |  |

### Vizinhança (`SURROUNDINGS`, 12 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `surroundings.frontNeighborType` | Na frente | enum (NeighborType) |  | não | P2 | C | STATIC | CALCULATED | kmz-v1 |  |
| `surroundings.rearNeighborType` | Nos fundos | enum (NeighborType) |  | não | P1 | F C S A | STATIC | CALCULATED | kmz-v1 | fundo |
| `surroundings.leftNeighborType` | Na lateral esquerda | enum (NeighborType) |  | não | P2 | C | STATIC | CALCULATED | kmz-v1 | vzE |
| `surroundings.rightNeighborType` | Na lateral direita | enum (NeighborType) |  | não | P2 | C | STATIC | CALCULATED | kmz-v1 | vzD |
| `surroundings.rearCondition` | Fechamento dos fundos | enum (RearCondition) |  | não | P2 | C | STATIC | TO_CONFIRM | launch-event-v1 | fech |
| `surroundings.hasRearNeighbor` | Tem lote vizinho nos fundos | boolean |  | não | P2 | F C | STATIC | CALCULATED | kmz-v1 | fundo |
| `surroundings.hasGreenRear` | Mata ou parque nos fundos | boolean |  | não | P1 | F C S A | STATIC | CALCULATED | kmz-v1 | mata |
| `surroundings.appNearby` | APP próxima | boolean |  | sim | P2 | · | STATIC | UNKNOWN |  |  |
| `surroundings.sewageStationNearby` | Perto da estação elevatória | boolean |  | não | P2 | F C A | STATIC | CALCULATED | kmz-v1 | deeeb |
| `surroundings.viewType` | Vista | enum (ViewType) |  | não | P2 | F C S | VERSIONED | ESTIMATED | analysis-v1 | vista |
| `surroundings.viewPermanence` | Permanência da vista | enum (ViewPermanence) |  | sim | P2 | C | VERSIONED | ESTIMATED | analysis-v1 | vista |
| `surroundings.viewDetail` | Descrição da vista | enum (ViewDetail) |  | não | P3 | · | VERSIONED | ESTIMATED | analysis-v1 | vista |

### Mobilidade e trânsito (`MOBILITY`, 9 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `mobility.streetHierarchy` | Tipo de via | enum (StreetHierarchy) |  | não | P1 | F C | VERSIONED | ESTIMATED | analysis-v1 | via |
| `mobility.estimatedTraffic` | Trânsito estimado | enum (Level) |  | não | P1 | F C S A | VERSIONED | ESTIMATED | analysis-v1 | fc |
| `mobility.vehiclesPassingEstimate` | Lotes que passam em frente | number | lotes | não | P2 | C | VERSIONED | ESTIMATED | analysis-v1 | flow |
| `mobility.routeDistanceToGateM` | Percurso até a portaria | number | m | não | P1 | F C S | STATIC | CALCULATED | kmz-v1 | rport |
| `mobility.routeDistanceToLeisureM` | Percurso até o clube | number | m | não | P1 | F C S | STATIC | CALCULATED | kmz-v1 | rclube |
| `mobility.gateProximity` | Proximidade da portaria | enum (GateProximity) |  | não | P2 | F C | VERSIONED | CALCULATED | analysis-v1 | portc |
| `mobility.nearMainAccess` | Perto da portaria | boolean |  | não | P2 | F | VERSIONED | CALCULATED | analysis-v1 |  |
| `mobility.routeToGate` (virtual) | Rota até a portaria | geometry | unidade do mapa | sim | P3 | · | STATIC | CALCULATED | kmz-v1 | routes.json:p |
| `mobility.routeToLeisure` (virtual) | Rota até o clube | geometry | unidade do mapa | sim | P3 | · | STATIC | CALCULATED | kmz-v1 | routes.json:k |

### Conforto ambiental (`ENVIRONMENTAL`, 18 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `environmental.orientationFront` | Frente voltada para | enum (Direction) |  | não | P1 | F C | STATIC | CALCULATED | kmz-v1 | fs |
| `environmental.orientationRear` | Fundos voltados para | enum (Direction) |  | não | P2 | F C | STATIC | CALCULATED | kmz-v1 | bs |
| `environmental.orientationLeft` | Lateral esquerda voltada para | enum (Direction) |  | não | P3 | C | STATIC | CALCULATED | kmz-v1 | lat_s (1º) |
| `environmental.orientationRight` | Lateral direita voltada para | enum (Direction) |  | não | P3 | C | STATIC | CALCULATED | kmz-v1 | lat_s (2º) |
| `environmental.frontBearingDeg` | Azimute da frente | number | graus | não | P3 | S | STATIC | CALCULATED | kmz-v1 | az |
| `environmental.northReference` | Referência de norte | string |  | não | P3 | · | STATIC | CONFIRMED | official-plan-v1 |  |
| `environmental.morningSun` | Sol da manhã | array (LotSide) | enum | não | P1 | C | VERSIONED | ESTIMATED | solar-model-v1 | manha |
| `environmental.afternoonSun` | Sol da tarde | array (LotSide) | enum | não | P1 | C A | VERSIONED | ESTIMATED | solar-model-v1 | tarde |
| `environmental.northSunSide` | Sol do norte (piscina e lazer) | enum (NorthSunSide) |  | não | P2 | F C | VERSIONED | ESTIMATED | solar-model-v1 | lazer |
| `environmental.eastSide` | Lado leste (quartos) | enum (LotSide) |  | não | P2 | · | VERSIONED | ESTIMATED | solar-model-v1 | quartos |
| `environmental.solarScore` | Nota de orientação solar | number | score 0–10 | não | P1 | F C S | VERSIONED | ESTIMATED | analysis-v1 | nt.sol |
| `environmental.noiseLevel` | Ruído provável | enum (Level) |  | não | P1 | F C S A | VERSIONED | ESTIMATED | analysis-v1 | ruido |
| `environmental.quietScore` | Nota de silêncio | number | score 0–10 | não | P1 | F C S A | VERSIONED | ESTIMATED | analysis-v1 | nt.sil |
| `environmental.noiseSources` | Fontes de ruído próximas | array (NoiseSourceType) | m | não | P2 | A | VERSIONED | ESTIMATED | analysis-v1 | fontes |
| `environmental.privacyLevel` | Privacidade | enum (Level) |  | não | P1 | F C | VERSIONED | ESTIMATED | analysis-v1 | priv |
| `environmental.privacyScore` | Nota de privacidade | number | score 0–10 | não | P1 | F C S A | VERSIONED | ESTIMATED | analysis-v1 | nt.priv |
| `environmental.viewScore` | Nota de vista | number | score 0–10 | não | P2 | C S | VERSIONED | ESTIMATED | analysis-v1 | nt.vista |
| `environmental.ventilation` | Ventilação | enum (Level) |  | sim | P2 | · | STATIC | UNKNOWN |  | nt.vent (sempre nulo) |

### Construção e restrições (`CONSTRUCTION`, 14 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `construction.topography` | Topografia | enum (TopographyType) |  | sim | P1 | · | STATIC | UNKNOWN |  | nt.topo (sempre nulo) |
| `construction.slopePercent` | Declividade | number | % | sim | P2 | · | STATIC | UNKNOWN |  |  |
| `construction.drainage` | Drenagem | enum (DrainageStatus) |  | sim | P2 | · | STATIC | UNKNOWN |  |  |
| `construction.frontSetbackM` | Recuo frontal | number | m | sim | P2 | · | STATIC | UNKNOWN |  |  |
| `construction.rearSetbackM` | Recuo de fundos | number | m | sim | P3 | · | STATIC | UNKNOWN |  |  |
| `construction.sideSetbackM` | Recuos laterais | number | m | sim | P3 | · | STATIC | UNKNOWN |  |  |
| `construction.occupationRate` | Taxa de ocupação | number | % | sim | P2 | · | STATIC | UNKNOWN |  |  |
| `construction.permeabilityRate` | Taxa de permeabilidade | number | % | sim | P2 | · | STATIC | UNKNOWN |  |  |
| `construction.buildingCoefficient` | Coeficiente de aproveitamento | number |  | sim | P2 | · | STATIC | UNKNOWN |  |  |
| `construction.maxFloors` | Pavimentos permitidos | number |  | sim | P3 | · | STATIC | UNKNOWN |  |  |
| `construction.easements` | Servidões | array |  | não | P1 | F C A | STATIC | CONFIRMED | official-plan-v1 | al (SERVIDÃO) |
| `construction.nonBuildableRearToConfirm` | Faixa não edificável nos fundos | boolean |  | não | P1 | F C A | VERSIONED | TO_CONFIRM | launch-event-v1 | al (RESTRIÇÃO CONSTRUTIVA) |
| `construction.regulationStatus` | Regulamento construtivo | enum (RegulationStatus) |  | não | P1 | · | STATIC | CONFIRMED |  |  |
| `construction.constructivePotential` | Potencial construtivo | number |  | sim | P2 | · | STATIC | UNKNOWN |  | nt.pc (sempre nulo) |

### Comercial (`COMMERCIAL`, 10 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `commercial.price` | Preço | number | BRL | sim | P0 | F C S | DYNAMIC | CALCULATED | price-table-v1 |  |
| `commercial.pricePerM2` | Preço por m² | number | BRL/m² | sim | P0 | F C | DYNAMIC | CONFIRMED | price-table-v1 |  |
| `commercial.currency` | Moeda | string |  | não | P3 | · | DYNAMIC | CONFIRMED | price-table-v1 |  |
| `commercial.downPaymentDefaultPercent` | Entrada padrão | number | % | não | P1 | · | DYNAMIC | CONFIRMED | launch-event-v1 |  |
| `commercial.downPaymentDefaultValue` | Valor da entrada padrão | number | BRL | sim | P1 | C | DYNAMIC | CALCULATED | price-table-v1 |  |
| `commercial.availablePlans` | Planos de pagamento | array |  | não | P1 | C | DYNAMIC | CONFIRMED | launch-event-v1 |  |
| `commercial.priceTableId` | Tabela comercial | string |  | não | P3 | · | DYNAMIC | CONFIRMED | price-table-v1 |  |
| `commercial.priceTableVersion` | Versão da tabela | string |  | não | P3 | · | DYNAMIC | CONFIRMED | price-table-v1 |  |
| `commercial.validFrom` | Válida desde | date |  | sim | P3 | · | DYNAMIC | UNKNOWN |  |  |
| `commercial.validUntil` | Válida até | date |  | sim | P3 | · | DYNAMIC | UNKNOWN |  |  |

### Inteligência (`INTELLIGENCE`, 18 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `intelligence.analysisVersion` | Versão da análise | string |  | não | P3 | · | VERSIONED | CONFIRMED | analysis-v1 |  |
| `intelligence.scores.housing` | Score Moradia | number | score 0–100 | não | P1 | F C | VERSIONED | ESTIMATED | analysis-v1 | sm |
| `intelligence.scores.investment` | Score Investimento | number | score 0–100 | não | P1 | F C | VERSIONED | ESTIMATED | analysis-v1 | si |
| `intelligence.scores.family` | Score Família | number | score 0–100 | não | P1 | F C | VERSIONED | ESTIMATED | analysis-v1 | sf |
| `intelligence.scores.premium` | Score Premium | number | score 0–100 | não | P1 | F C | VERSIONED | ESTIMATED | analysis-v1 | sp |
| `intelligence.scores.overall` | Score geral | number | score 0–100 | não | P2 | F C | VERSIONED | ESTIMATED | analysis-v1 | sg |
| `intelligence.class` | Classe | enum (LotClass) |  | não | P1 | F C | VERSIONED | ESTIMATED | analysis-v1 | cl |
| `intelligence.notes.leisure` | Nota de lazer | number | score 0–10 | sim | P2 | C S | VERSIONED | ESTIMATED | analysis-v1 | nt.laz |
| `intelligence.notes.gate` | Nota de acesso à portaria | number | score 0–10 | sim | P2 | C S | VERSIONED | ESTIMATED | analysis-v1 | nt.port |
| `intelligence.notes.lowTraffic` | Nota de baixo fluxo | number | score 0–10 | sim | P2 | C S | VERSIONED | ESTIMATED | analysis-v1 | nt.flux |
| `intelligence.notes.liquidity` | Nota de liquidez | number | score 0–10 | sim | P2 | C S | VERSIONED | ESTIMATED | analysis-v1 | nt.liq |
| `intelligence.notes.relativeValue` | Nota de valor relativo | number | score 0–10 | sim | P2 | C S | VERSIONED | ESTIMATED | analysis-v1 | nt.val |
| `intelligence.notes.priceQuality` | Nota de custo-benefício | number | score 0–10 | sim | P2 | C S | VERSIONED | ESTIMATED | analysis-v1 | nt.pq |
| `intelligence.liquidity` | Liquidez | enum (Level) |  | não | P2 | F C S | VERSIONED | ESTIMATED | analysis-v1 | liq |
| `intelligence.idealProfiles` | Mais indicado para | array (Profile) | enum | não | P1 | F | VERSIONED | ESTIMATED | analysis-v1 | perfil |
| `intelligence.alerts` | Alertas | array |  | não | P1 | F | VERSIONED | CALCULATED | analysis-v1 | al |
| `intelligence.rankings` | Posição nos rankings | array |  | não | P2 | C | VERSIONED | CALCULATED | analysis-v1 |  |
| `intelligence.highlights` | Destaques | array |  | não | P1 | · | VERSIONED | CALCULATED | analysis-v1 |  |

### Proveniência e qualidade do dado (`PROVENANCE`, 2 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `intelligence.confidence` | Confiabilidade da análise | enum (Confidence) |  | não | P3 | · | VERSIONED | ESTIMATED | analysis-v1 | conf |
| `metadata.schemaVersion` | Versão do schema | string |  | não | P3 | · | STATIC | CONFIRMED |  |  |

### Disponibilidade (`AVAILABILITY`, 9 campos)

| fieldKey | Rótulo | Tipo | Unidade | Nulo | Prior. | Uso | Ciclo | Status padrão | Fonte | Legado |
|---|---|---|---|---|---|---|---|---|---|---|
| `availability.status` | Disponibilidade | enum (AvailabilityStatus) |  | não | P0 | F C | DYNAMIC | UNKNOWN |  | st |
| `availability.updatedAt` | Atualizado em | datetime |  | sim | P1 | · | DYNAMIC | UNKNOWN |  |  |
| `availability.revision` | Revisão | number |  | sim | P3 | · | DYNAMIC | CALCULATED |  |  |
| `availability.reason` | Motivo | enum (AvailabilityReason) |  | sim | P2 | · | DYNAMIC | UNKNOWN |  |  |
| `availability.notes` | Observação interna | string |  | sim | P3 | · | DYNAMIC | UNKNOWN |  |  |
| `availability.freshness` | Atualidade do status | enum (Freshness) |  | não | P2 | · | DYNAMIC | CALCULATED |  |  |
| `availability.reservedUntil` | Reservado até | datetime |  | sim | P3 | · | DYNAMIC | UNKNOWN |  |  |
| `availability.sourceId` | Fonte da situação | string |  | sim | P3 | · | DYNAMIC | UNKNOWN |  |  |
| `availability.proposalId` | Proposta | string |  | sim | P3 | · | DYNAMIC | UNKNOWN |  |  |

## 7. Enums

Valores estáveis (códigos); o texto em português vem de `utils/i18n.js`. Extensões feitas por necessidade do dataset estão marcadas no código com "ext": `NeighborType.EXTERNAL_GREEN`, `COMMON_AREA`, `CONDO_BOUNDARY`; `StreetHierarchy.LOCAL_QUIET`; `NoiseSourceType.INTERNAL_ROAD`.

| Enum | Valores (rótulo em português) |
|---|---|
| `DataStatus` | CONFIRMED (Confirmado), CALCULATED (Calculado), ESTIMATED (Estimado), TO_CONFIRM (Requer validação), UNKNOWN (Não disponível), NOT_APPLICABLE (Não aplicável), CONFLICTED (Fontes divergentes) |
| `Confidence` | HIGH (Alta), MEDIUM (Média), LOW (Baixa), UNKNOWN (Não avaliada) |
| `Freshness` | FRESH (Atualizado), STALE (Pode estar desatualizado), EXPIRED (Vencido, não use para decidir), UNKNOWN (Sem data de atualização) |
| `DataSource` | REMOTE (Fonte oficial), CACHE (Cópia salva neste aparelho), MEMORY (Memória da sessão), BUNDLED (Tabela embutida no aplicativo) |
| `ConnectivityState` | ONLINE (Online), OFFLINE (Offline), DEGRADED (Conexão instável), UNKNOWN (Verificando conexão) |
| `SyncState` | IDLE (Aguardando), SYNCING (Sincronizando…), SUCCESS (Sincronizado), PARTIAL (Sincronizado em parte), ERROR (Falha ao sincronizar), OFFLINE (Offline) |
| `AvailabilityReason` | TECHNICAL_REVIEW (Revisão técnica), COMMERCIAL_HOLD (Retido pela área comercial), LEGAL_HOLD (Pendência jurídica), INTERNAL_BLOCK (Bloqueio interno), NOT_RELEASED (Ainda não liberado), DATA_VALIDATION (Dados em validação), OTHER (Outro motivo) |
| `AvailabilityStatus` | AVAILABLE (Disponível), RESERVED (Reservado), PROPOSAL (Em proposta), BLOCKED (Bloqueado), SOLD (Vendido), UNAVAILABLE (Indisponível), UNKNOWN (Status não confirmado) |
| `LotClass` | A_PLUS (A+), A (A), B (B), C (C), D (D), UNKNOWN (Não disponível) |
| `Level` | VERY_LOW (Muito baixo), LOW (Baixo), MEDIUM (Médio), HIGH (Alto), VERY_HIGH (Muito alto), UNKNOWN (Não disponível) |
| `Direction` | N (Norte), NE (Nordeste), E (Leste), SE (Sudeste), S (Sul), SW (Sudoeste), W (Oeste), NW (Noroeste) |
| `LotShape` | RECTANGULAR (Retangular), SQUARE (Quadrado), TRAPEZOIDAL (Trapezoidal), TRIANGULAR (Triangular), IRREGULAR (Irregular), OTHER (Outro), UNKNOWN (Não disponível) |
| `CornerType` | NONE (Não é esquina), INTERNAL_CORNER (Esquina interna), EXTERNAL_CORNER (Esquina externa), CURVED_CORNER (Esquina em curva), UNKNOWN (Não classificado) |
| `BlockPosition` | INTERNAL (Interno), CORNER (Esquina), DOUBLE_FRONT (Frente para duas ruas) |
| `PerimeterPosition` | REAR (Fundos no limite do condomínio), SIDE (Lateral no limite do condomínio), NONE (Não encosta no limite) |
| `Efficiency` | GOOD (Bom), MEDIUM (Médio), LOW (Baixo) |
| `NeighborType` | LOT (Outro lote), STREET (Rua), GREEN_AREA (Parque florestal / área verde do condomínio), EXTERNAL_GREEN (Mata fora do perímetro), APP (APP), LEISURE (Área de lazer), TECHNICAL_AREA (Área técnica), COMMON_AREA (Área comum), EXTERNAL_PROPERTY (Área externa aberta (fora do perímetro)), CONDO_BOUNDARY (Limite do condomínio), WALL (Muro), FENCE (Gradil), UNKNOWN (Não foi possível determinar), NONE (Nenhum) |
| `RearCondition` | LOT_BOUNDARY (Divisa com outro lote), WALL (Muro, conforme o evento de lançamento), FENCE (Gradil, conforme o evento de lançamento), UNKNOWN (Não informado) |
| `ViewType` | INTERNAL (Interna), GREEN (Para área verde), LEISURE (Para área de lazer), URBAN (Para rua), OPEN (Aberta), PARTIAL (Parcial), TECHNICAL (Para área técnica), UNKNOWN (Não disponível) |
| `ViewPermanence` | CONFIRMED_PERMANENT (Permanente (documentado)), LIKELY (Provável, a confirmar), NOT_GUARANTEED (Não garantida), UNKNOWN (Não avaliada) |
| `ViewDetail` | INTERNAL (Interna (lotes vizinhos)), INTERNAL_NEAR_SQUARE (Interna, com a frente perto de praça ou clube), OPEN_EXTERNAL (Aberta para área externa (pode ser ocupada no futuro)), FOREST_EXTERNAL (Para mata fora do perímetro (permanência não confirmada)), CONDO_PARK (Para o parque florestal do condomínio (manutenção como área verde a confirmar)), STREET_BOTH_SIDES (Para rua nos dois lados) |
| `GateProximity` | VERY_CLOSE (Muito próximo), CLOSE (Próximo), INTERMEDIATE (Intermediário), FAR (Distante) |
| `StreetHierarchy` | MAIN (Principal (acesso de muitos lotes à portaria e ao clube)), SECONDARY (Secundária (passagem de outros moradores)), LOCAL (Local), LOCAL_QUIET (Local (poucos veículos de passagem)), CUL_DE_SAC (Final de rua sem saída (balão de retorno)), ACCESS_TO_LEISURE (Acesso ao lazer), ACCESS_TO_GATE (Acesso à portaria), UNKNOWN (Não disponível) |
| `LotSide` | FRONT (frente), BACK (fundos), SIDE (lateral) |
| `NorthSunSide` | BACK (Nos fundos: bom para piscina e área de lazer), FRONT (Na frente; nos fundos a piscina tende a ter mais sombra), SIDE (Na lateral voltada para o norte) |
| `NoiseSourceType` | EXTERNAL_ROAD (Via externa), INTERNAL_MAIN_ROAD (Via interna principal), INTERNAL_ROAD (Rua do lote), GATE (Portaria), LEISURE (Lazer), SPORTS (Esportes), PARKING (Estacionamento), TECHNICAL_AREA (Área técnica), COMMERCIAL (Comércio), OTHER (Outra) |
| `NoiseSourceDetail` | AVENUE (Av. Porto Dourado), STREET_FLOW (fluxo na rua), SQUARE (praça), PLAYGROUND (playground), CLUB (clube), GATE (portaria), PUMP_STATION (estação elevatória (EEEB)), PARKING (estacionamento) |
| `TopographyType` | FLAT (Plano), UPHILL (Aclive), DOWNHILL (Declive), LATERAL_SLOPE (Caimento lateral), MIXED (Misto), UNKNOWN (Não disponível) |
| `DrainageStatus` | KNOWN_FAVORABLE (Favorável), KNOWN_ATTENTION (Requer atenção), UNKNOWN (Não disponível) |
| `RegulationStatus` | AVAILABLE (Disponível), PARTIAL (Parcial), UNAVAILABLE (Ainda não recebido) |
| `AlertType` | TRAFFIC (Tráfego), AFTERNOON_SUN (Sol da tarde), BUILDING_RESTRICTION (Restrição construtiva), PRIVACY (Privacidade), AVENUE (Avenida), NOISE (Ruído), TECHNICAL_AREA (Área técnica), GEOMETRY (Geometria), EASEMENT (Servidão), OTHER (Atenção) |
| `AlertSeverity` | INFO (Informativo), ATTENTION (Atenção), IMPORTANT (Importante), CRITICAL (Crítico) |
| `RankingType` | HOUSING (Moradia), INVESTMENT (Investimento), FAMILY (Família), PREMIUM (Premium), OVERALL (Geral) |
| `Profile` | QUIET_LIVING (moradia com foco em tranquilidade), ELDERLY_MOBILITY (quem precisa de pouco deslocamento), INVESTOR (investimento), FAMILY (família com crianças), NATURE (quem valoriza natureza), HIGH_END (alto padrão) |
| `PoiType` | GATE (Portaria), CLUB (Clube), SQUARE (Praça), PLAYGROUND (Playground), PARK (Parque florestal), PUMP_STATION (EEEB), PARKING (Estacionamento), ADMIN (Administração) |

Ordens auxiliares (não são enums de campo): `LEVEL_ORDER`, `CLASS_ORDER`, `AVAILABILITY_ORDER`, `SEVERITY_ORDER`.

## 8. Exemplos

Responder às perguntas do critério de qualidade do tópico 5 para um campo (`App.model.field('geometry.areaM2')`):

| Pergunta | Resposta |
|---|---|
| Domínio | `GEOMETRY` (subdomínio `dimensions`) |
| Tipo e unidade | `number`, `m²` |
| Fonte | `official-plan-v1` (quadro de áreas da planta), método `official`, confiança `HIGH` |
| Prioridade | P0 |
| Filtrável / comparável / score / alerta | sim / sim / sim / sim |
| Ciclo de vida | STATIC |
| Legado | `a` |

Outro exemplo: `environmental.noiseLevel` é `enum Level`, P1, filtrável, comparável, entrada de score e de alerta, VERSIONED, `ESTIMATED` pela `analysis-v1`, legado `ruido`, significado "Classificação analítica de exposição, não medição em decibéis".

Trecho real de um lote (B79), mostrando domínios diferentes:

```json
{
  "identity": { "id": "VJ-QB-L0079", "code": "B79", "developmentId": "viva-juara", "blockId": "B", "blockNumber": null, "lotNumber": 79, "displayCode": "QB L79", "externalCode": null },
  "geometry": { "areaM2": 291.78, "frontM": 10.3, "shape": "RECTANGULAR", "isCorner": false, "usableGeometryScore": 8.5 },
  "environmental": { "noiseLevel": "VERY_LOW", "privacyLevel": "VERY_HIGH", "northSunSide": "BACK", "ventilation": null },
  "construction": { "topography": null, "regulationStatus": "UNAVAILABLE", "nonBuildableRearToConfirm": true },
  "availability": { "status": "UNKNOWN", "updatedAt": null, "freshness": "UNKNOWN" }
}
```

`geometry.areaM2` é confirmado (planta oficial); `environmental.*` são estimativas; `construction.topography` é não disponível; `availability.status` é não disponível (sem espelho de vendas).

## 9. Não implementado / pendente

| Item da especificação | Situação |
|---|---|
| Nomes oficiais de rua (`location.streetId`, `streetName`) | Campos previstos, sempre `null`: a planta só traz ruas projetadas |
| Topografia, declividade, drenagem | Previstos, sempre `null`: falta levantamento planialtimétrico e projeto de drenagem |
| Recuos, taxas, coeficiente, pavimentos, potencial construtivo | Previstos, sempre `null`: regulamento construtivo não recebido (`regulationStatus = UNAVAILABLE`) |
| Ventilação | Prevista, sempre `null`: sem dados de vento |
| APP (`surroundings.appNearby`, `location.distanceToAppM`) | Prevista, sempre `null`: não há APP delimitada no material; mata existente não é classificada como APP |
| Perímetro, irregularidade, setor, código da loteadora, distância à via interna principal | Previstos, sempre `null`: sem metodologia ou sem dado |
| Validade da tabela (`commercial.validFrom`, `validUntil`) | Prevista, `null`: validade não informada |
| Disponibilidade | Domínio completo, mas sem fonte: `UNKNOWN` em todos os lotes |
| `identity.blockNumber` | `NOT_APPLICABLE`: as quadras são identificadas por letra |

No total, 30 campos armazenados são `null` nos 498 lotes: 24 por falta de dado de origem e 6 de disponibilidade (`updatedAt`, `reason`, `notes`, `reservedUntil`, `sourceId`, `proposalId`) por falta de espelho de vendas. A lista de campos canônicos sem origem no lots.json está em `unmapped_fields.json` (`canonicalFieldsWithoutLegacySource`). Nenhum valor foi inventado para preenchê-los.
