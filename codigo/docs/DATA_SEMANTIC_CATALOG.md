# Catálogo semântico (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. Derivado do Field Registry (`App.model.FIELDS`), 138 campos.
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| fieldKey | label | businessDefinition | dataType | unit | nullMeaning | allowedValues | sourceAuthorityRef |
|---|---|---|---|---|---|---|---|
| identity.id | ID do lote | ID técnico global e imutável: empreendimento + quadra + lote (VJ-Q<quadra>-L<0000>), já existente no lots.json | string | — | nunca nulo | — | **null — necessita confirmação** |
| identity.code | Código do lote | Código curto da planta (quadra + número), único dentro do empreendimento; usado nos links e na busca desde a primeira versão | string | — | nunca nulo | — | official-plan-v1 |
| identity.developmentId | Empreendimento | Empreendimento ao qual o lote pertence | string | — | nunca nulo | — | **null — necessita confirmação** |
| identity.developmentName | Nome do empreendimento | Nome comercial; não substitui developmentId | string | — | nunca nulo | — | **null — necessita confirmação** |
| identity.blockId | Quadra | Código da quadra na planta (letra) | string | — | nunca nulo | — | official-plan-v1 |
| identity.blockNumber | Número da quadra | As quadras deste empreendimento são identificadas por letra | number | — | null = não disponível / não informado; nunca 0 | — | official-plan-v1 |
| identity.lotNumber | Lote | Número do lote dentro da quadra | number | — | nunca nulo | — | official-plan-v1 |
| identity.displayCode | Código de exibição | Derivado para apresentação (quadra-lote) | string | — | nunca nulo | — | **null — necessita confirmação** |
| identity.externalCode | Código da loteadora | Código oficial da loteadora, se existir | string | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| geometry.areaM2 | Área | Área oficial do quadro de áreas da planta | number | m² | null = não disponível / não informado; nunca 0 | — | official-plan-v1 |
| geometry.frontM | Frente | Testada usada no app: soma das arestas de frente nos lotes em leque, senão a largura na frente | number | m | null = não disponível / não informado; nunca 0 | — | plan-geometry-v1 |
| geometry.rearM | Fundos | Largura nos fundos | number | m | null = não disponível / não informado; nunca 0 | — | plan-geometry-v1 |
| geometry.leftDepthM | Lateral esquerda | Lateral esquerda, vista da rua olhando para o lote | number | m | null = não disponível / não informado; nunca 0 | — | plan-geometry-v1 |
| geometry.rightDepthM | Lateral direita | Lateral direita, vista da rua olhando para o lote | number | m | null = não disponível / não informado; nunca 0 | — | plan-geometry-v1 |
| geometry.averageDepthM | Profundidade média | Profundidade média medida no eixo frente-fundos | number | m | null = não disponível / não informado; nunca 0 | — | plan-geometry-v1 |
| geometry.perimeterM | Perímetro | Não calculado: sem metodologia aprovada para o traço da planta | number | m | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| geometry.shape | Formato | Formato do polígono | enum | — | null = não disponível / não informado; nunca 0 | LotShape | plan-geometry-v1 |
| geometry.isCorner | Esquina | Lote com frente para duas ruas que se cruzam | boolean | — | nunca nulo | — | kmz-v1 |
| geometry.cornerType | Tipo de esquina | NONE para lotes que não são de esquina; UNKNOWN quando o tipo não foi classificado | enum | — | null = não disponível / não informado; nunca 0 | CornerType | kmz-v1 |
| geometry.frontCount | Frentes para rua | Quantas faces do lote dão para rua | number | — | nunca nulo | — | kmz-v1 |
| geometry.irregularityLevel | Irregularidade | Não calculado: sem metodologia própria | enum | — | null = não disponível / não informado; nunca 0 | Level | **null — necessita confirmação** |
| geometry.usableGeometryScore | Nota de geometria | Quão aproveitável é o formato para construir | number | score 0–10 | null = não disponível / não informado; nunca 0 | — | analysis-v1 |
| geometry.usableGeometryClass | Aproveitamento do formato | Classe de aproveitamento do formato | enum | — | null = não disponível / não informado; nunca 0 | Efficiency | analysis-v1 |
| geometry.measurementConfidence | Confiabilidade das medidas | Confiabilidade das medidas tiradas da planta | enum | — | nunca nulo | Confidence | plan-geometry-v1 |
| geometry.frontBoxWidthM | Largura na frente (caixa) | Largura medida perpendicular ao eixo do lote, na faixa da frente | number | m | null = não disponível / não informado; nunca 0 | — | plan-geometry-v1 |
| geometry.frontEdgesM | Soma das arestas de frente | Soma dos lados cuja normal aponta para a rua | number | m | null = não disponível / não informado; nunca 0 | — | plan-geometry-v1 |
| geometry.rearEdgesM | Soma das arestas de fundos | Soma dos lados dos fundos | number | m | null = não disponível / não informado; nunca 0 | — | plan-geometry-v1 |
| geometry.polygon | Contorno | Contorno do lote vetorizado da planta (norte para cima) | geometry | unidade do mapa | nunca nulo | — | official-plan-v1 |
| geometry.centroid | Centroide | Centroide de área calculado do contorno | geometry | unidade do mapa | nunca nulo | — | official-plan-v1 |
| geometry.bounds | Retângulo envolvente | Limites do contorno | geometry | unidade do mapa | nunca nulo | — | official-plan-v1 |
| location.streetId | Rua (código) | A planta só traz ruas projetadas | string | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| location.streetName | Rua | Nome oficial da rua | string | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| location.blockPosition | Posição na quadra | Interno, esquina ou frente para duas ruas | enum | — | nunca nulo | BlockPosition | kmz-v1 |
| location.perimeterPosition | Posição no perímetro | Se o lote encosta no limite do condomínio (fundos ou lateral) | enum | — | nunca nulo | PerimeterPosition | kmz-v1 |
| location.sector | Setor | Setor do empreendimento, se houver | string | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| location.latitude | Latitude | Latitude do centro do lote (WGS84) | number | graus | nunca nulo | — | kmz-v1 |
| location.longitude | Longitude | Longitude do centro do lote (WGS84) | number | graus | nunca nulo | — | kmz-v1 |
| location.distanceToGateLinearM | Portaria (linha reta) | Distância em linha reta até a portaria | number | m | nunca nulo | — | kmz-v1 |
| location.distanceToClubLinearM | Clube (linha reta) | Distância em linha reta até o clube | number | m | nunca nulo | — | kmz-v1 |
| location.distanceToGreenAreaM | Parque florestal mais próximo | Distância até o parque florestal mais próximo (AC9, AC10 ou AC12) | number | m | nunca nulo | — | kmz-v1 |
| location.distanceToPlaygroundM | Playground mais próximo | Distância em linha reta até o playground mais próximo | number | m | nunca nulo | — | kmz-v1 |
| location.distanceToSquareM | Praça mais próxima | Distância em linha reta até a praça mais próxima | number | m | nunca nulo | — | kmz-v1 |
| location.distanceToExternalRoadM | Av. Porto Dourado | Distância até a avenida externa (a planta prevê ampliação) | number | m | nunca nulo | — | kmz-v1 |
| location.distanceToTechnicalAreaM | Estação elevatória (EEEB) | Distância até a estação elevatória de esgoto | number | m | nunca nulo | — | kmz-v1 |
| location.distanceToAppM | APP mais próxima | Não há APP delimitada no material recebido | number | m | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| location.distanceToMainInternalRoadM | Via interna principal | Não calculado | number | m | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| surroundings.frontNeighborType | Na frente | A frente do lote é definida pela rua de acesso | enum | — | nunca nulo | NeighborType | kmz-v1 |
| surroundings.rearNeighborType | Nos fundos | O que existe hoje nos fundos | enum | — | nunca nulo | NeighborType | kmz-v1 |
| surroundings.leftNeighborType | Na lateral esquerda | Vizinho da lateral esquerda | enum | — | nunca nulo | NeighborType | kmz-v1 |
| surroundings.rightNeighborType | Na lateral direita | Vizinho da lateral direita | enum | — | nunca nulo | NeighborType | kmz-v1 |
| surroundings.rearCondition | Fechamento dos fundos | Muro, gradil ou divisa com outro lote | enum | — | nunca nulo | RearCondition | launch-event-v1 |
| surroundings.hasRearNeighbor | Tem lote vizinho nos fundos | Ausência atual de vizinho não garante que nada será construído | boolean | — | nunca nulo | — | kmz-v1 |
| surroundings.hasGreenRear | Mata ou parque nos fundos | Vegetação existente hoje nos fundos; não é o mesmo que APP | boolean | — | nunca nulo | — | kmz-v1 |
| surroundings.appNearby | APP próxima | Mata existente não é classificada automaticamente como APP | boolean | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| surroundings.sewageStationNearby | Perto da estação elevatória | A menos de 40 m da EEEB | boolean | — | nunca nulo | — | kmz-v1 |
| surroundings.viewType | Vista | Tipo de vista provável | enum | — | nunca nulo | ViewType | analysis-v1 |
| surroundings.viewPermanence | Permanência da vista | Sem evidência documental, nenhuma vista é tratada como permanente | enum | — | null = não disponível / não informado; nunca 0 | ViewPermanence | analysis-v1 |
| surroundings.viewDetail | Descrição da vista | Classificação detalhada da vista (preserva a redação original) | enum | — | nunca nulo | ViewDetail | analysis-v1 |
| mobility.streetHierarchy | Tipo de via | Papel da rua na circulação interna | enum | — | nunca nulo | StreetHierarchy | analysis-v1 |
| mobility.estimatedTraffic | Trânsito estimado | Fluxo relativo de carros na rua (não é contagem) | enum | — | nunca nulo | Level | analysis-v1 |
| mobility.vehiclesPassingEstimate | Lotes que passam em frente | Quantos lotes passam em frente no caminho até a portaria (estimativa) | number | lotes | nunca nulo | — | analysis-v1 |
| mobility.routeDistanceToGateM | Percurso até a portaria | Distância de carro pelas vias até a portaria | number | m | nunca nulo | — | kmz-v1 |
| mobility.routeDistanceToLeisureM | Percurso até o clube | Distância de carro pelas vias até o clube | number | m | nunca nulo | — | kmz-v1 |
| mobility.gateProximity | Proximidade da portaria | Faixa do percurso até a portaria | enum | — | nunca nulo | GateProximity | analysis-v1 |
| mobility.nearMainAccess | Perto da portaria | Percurso até a portaria menor que 200 m | boolean | — | nunca nulo | — | analysis-v1 |
| mobility.routeToGate | Rota até a portaria | Traçado da rota; valor pesado carregado sob demanda pelo SpatialRepository | geometry | unidade do mapa | null = não disponível / não informado; nunca 0 | — | kmz-v1 |
| mobility.routeToLeisure | Rota até o clube | Traçado da rota; valor pesado carregado sob demanda | geometry | unidade do mapa | null = não disponível / não informado; nunca 0 | — | kmz-v1 |
| environmental.orientationFront | Frente voltada para | Direção para onde a frente aponta | enum | — | nunca nulo | Direction | kmz-v1 |
| environmental.orientationRear | Fundos voltados para | Direção dos fundos | enum | — | nunca nulo | Direction | kmz-v1 |
| environmental.orientationLeft | Lateral esquerda voltada para | Direção da lateral esquerda | enum | — | nunca nulo | Direction | kmz-v1 |
| environmental.orientationRight | Lateral direita voltada para | Direção da lateral direita | enum | — | nunca nulo | Direction | kmz-v1 |
| environmental.frontBearingDeg | Azimute da frente | 0 = norte, 90 = leste | number | graus | nunca nulo | — | kmz-v1 |
| environmental.northReference | Referência de norte | Norte da planta oficial | string | — | nunca nulo | — | official-plan-v1 |
| environmental.morningSun | Sol da manhã | Lados que recebem sol pela manhã | array | enum | nunca nulo | LotSide | solar-model-v1 |
| environmental.afternoonSun | Sol da tarde | Lados que recebem sol à tarde | array | enum | nunca nulo | LotSide | solar-model-v1 |
| environmental.northSunSide | Sol do norte (piscina e lazer) | Onde fica o sol do norte | enum | — | nunca nulo | NorthSunSide | solar-model-v1 |
| environmental.eastSide | Lado leste (quartos) | Lado que recebe sol da manhã, sugerido para quartos | enum | — | nunca nulo | LotSide | solar-model-v1 |
| environmental.solarScore | Nota de orientação solar | Nota de orientação solar | number | score 0–10 | nunca nulo | — | analysis-v1 |
| environmental.noiseLevel | Ruído provável | Classificação analítica de exposição, não medição em decibéis | enum | — | nunca nulo | Level | analysis-v1 |
| environmental.quietScore | Nota de silêncio | Quanto maior, mais silencioso | number | score 0–10 | nunca nulo | — | analysis-v1 |
| environmental.noiseSources | Fontes de ruído próximas | Fontes consideradas na estimativa e suas distâncias | array | m | nunca nulo | NoiseSourceType | analysis-v1 |
| environmental.privacyLevel | Privacidade | Classe de privacidade provável | enum | — | nunca nulo | Level | analysis-v1 |
| environmental.privacyScore | Nota de privacidade | Indicador composto da metodologia atual | number | score 0–10 | nunca nulo | — | analysis-v1 |
| environmental.viewScore | Nota de vista | Nota da vista provável | number | score 0–10 | nunca nulo | — | analysis-v1 |
| environmental.ventilation | Ventilação | Sem dados de vento: permanece nulo | enum | — | null = não disponível / não informado; nunca 0 | Level | **null — necessita confirmação** |
| construction.topography | Topografia | Falta levantamento planialtimétrico | enum | — | null = não disponível / não informado; nunca 0 | TopographyType | **null — necessita confirmação** |
| construction.slopePercent | Declividade | Falta levantamento planialtimétrico | number | % | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| construction.drainage | Drenagem | Falta projeto de drenagem | enum | — | null = não disponível / não informado; nunca 0 | DrainageStatus | **null — necessita confirmação** |
| construction.frontSetbackM | Recuo frontal | Depende do regulamento construtivo | number | m | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| construction.rearSetbackM | Recuo de fundos | Depende do regulamento construtivo | number | m | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| construction.sideSetbackM | Recuos laterais | Depende do regulamento construtivo | number | m | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| construction.occupationRate | Taxa de ocupação | Depende do regulamento construtivo | number | % | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| construction.permeabilityRate | Taxa de permeabilidade | Depende do regulamento construtivo | number | % | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| construction.buildingCoefficient | Coeficiente de aproveitamento | Depende do regulamento construtivo | number | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| construction.maxFloors | Pavimentos permitidos | Depende do regulamento construtivo | number | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| construction.easements | Servidões | Servidões desenhadas na planta oficial junto ao lote | array | — | nunca nulo | — | official-plan-v1 |
| construction.nonBuildableRearToConfirm | Faixa não edificável nos fundos | APP ou mata nos fundos citada no evento; faixa não edificável a confirmar | boolean | — | nunca nulo | — | launch-event-v1 |
| construction.regulationStatus | Regulamento construtivo | UNAVAILABLE enquanto o regulamento não for recebido | enum | — | nunca nulo | RegulationStatus | **null — necessita confirmação** |
| construction.constructivePotential | Potencial construtivo | Sem regulamento não há metodologia | number | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| commercial.price | Preço | Preço de tabela = área × preço por m² da tabela vigente | number | BRL | null = não disponível / não informado; nunca 0 | — | price-table-v1 |
| commercial.pricePerM2 | Preço por m² | Preço por m² da tabela vigente | number | BRL/m² | null = não disponível / não informado; nunca 0 | — | price-table-v1 |
| commercial.currency | Moeda | BRL | string | — | nunca nulo | — | price-table-v1 |
| commercial.downPaymentDefaultPercent | Entrada padrão | Percentual de entrada apresentado no lançamento | number | % | nunca nulo | — | launch-event-v1 |
| commercial.downPaymentDefaultValue | Valor da entrada padrão | Preço × entrada padrão | number | BRL | null = não disponível / não informado; nunca 0 | — | price-table-v1 |
| commercial.availablePlans | Planos de pagamento | Planos do lançamento: 144x, 144x com anuais, 18x e 36x | array | — | nunca nulo | — | launch-event-v1 |
| commercial.priceTableId | Tabela comercial | Tabela em uso | string | — | nunca nulo | — | price-table-v1 |
| commercial.priceTableVersion | Versão da tabela | Versão da tabela em uso | string | — | nunca nulo | — | price-table-v1 |
| commercial.validFrom | Válida desde | Validade da tabela não informada | date | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| commercial.validUntil | Válida até | Validade da tabela não informada | date | — | null = não disponível / não informado; nunca 0 | — | **null — necessita confirmação** |
| intelligence.analysisVersion | Versão da análise | Versão da metodologia que gerou scores, classes e alertas | string | — | nunca nulo | — | analysis-v1 |
| intelligence.scores.housing | Score Moradia | Silêncio 25%, privacidade 20%, sol 20%, fluxo 15%, vista 10%, geometria 10% | number | score 0–100 | nunca nulo | — | analysis-v1 |
| intelligence.scores.investment | Score Investimento | Liquidez 35%, valorização relativa 25%, custo-benefício 25%, geometria 15% | number | score 0–100 | nunca nulo | — | analysis-v1 |
| intelligence.scores.family | Score Família | Lazer 30%, fluxo 25%, portaria 15%, sol 15%, silêncio 15% | number | score 0–100 | nunca nulo | — | analysis-v1 |
| intelligence.scores.premium | Score Premium | Privacidade 30%, vista 25%, silêncio 25%, sol 10%, geometria 10% | number | score 0–100 | nunca nulo | — | analysis-v1 |
| intelligence.scores.overall | Score geral | Média dos quatro scores | number | score 0–100 | nunca nulo | — | analysis-v1 |
| intelligence.class | Classe | A+ a D: posição relativa do score geral no empreendimento | enum | — | nunca nulo | LotClass | analysis-v1 |
| intelligence.notes.leisure | Nota de lazer | Proximidade do clube, praças e playground | number | score 0–10 | null = não disponível / não informado; nunca 0 | — | analysis-v1 |
| intelligence.notes.gate | Nota de acesso à portaria | Quanto menor o percurso até a portaria, maior a nota | number | score 0–10 | null = não disponível / não informado; nunca 0 | — | analysis-v1 |
| intelligence.notes.lowTraffic | Nota de baixo fluxo | Quanto menos carros passam em frente, maior a nota | number | score 0–10 | null = não disponível / não informado; nunca 0 | — | analysis-v1 |
| intelligence.notes.liquidity | Nota de liquidez | Facilidade relativa de revenda (não é promessa de valorização) | number | score 0–10 | null = não disponível / não informado; nunca 0 | — | analysis-v1 |
| intelligence.notes.relativeValue | Nota de valor relativo | Atributos do lote em relação aos demais (não é promessa de valorização) | number | score 0–10 | null = não disponível / não informado; nunca 0 | — | analysis-v1 |
| intelligence.notes.priceQuality | Nota de custo-benefício | Qualidade do lote em relação ao preço da tabela | number | score 0–10 | null = não disponível / não informado; nunca 0 | — | analysis-v1 |
| intelligence.liquidity | Liquidez | Liquidez relativa (área, sol, privacidade, silêncio, geometria) | enum | — | nunca nulo | Level | analysis-v1 |
| intelligence.idealProfiles | Mais indicado para | Perfis de cliente mais aderentes | array | enum | nunca nulo | Profile | analysis-v1 |
| intelligence.alerts | Alertas | Alertas com tipo, severidade, mensagem e campo de origem | array | — | nunca nulo | — | analysis-v1 |
| intelligence.rankings | Posição nos rankings | Posição em cada score entre todos os lotes | array | — | nunca nulo | — | analysis-v1 |
| intelligence.highlights | Destaques | Pontos fortes derivados dos dados, cada um ligado ao campo que o sustenta | array | — | nunca nulo | — | analysis-v1 |
| intelligence.confidence | Confiabilidade da análise | Qualidade geral do dado do lote (não é score do lote) | enum | — | nunca nulo | Confidence | analysis-v1 |
| metadata.schemaVersion | Versão do schema | Versão do contrato Lot; não confundir com versão da análise ou da tabela | string | — | nunca nulo | — | **null — necessita confirmação** |
| availability.status | Disponibilidade | Situação comercial informada pela loteadora; sem confirmação, aparece como "Status não confirmado" e nunca como disponível | enum | — | nunca nulo | AvailabilityStatus | **null — necessita confirmação** |
| availability.updatedAt | Atualizado em | Data e hora (ISO 8601) da última atualização conhecida da situação | datetime | — | null/UNKNOWN = sem informação da fonte; nunca disponível | — | **null — necessita confirmação** |
| availability.revision | Revisão | Ordem das atualizações: uma revisão antiga nunca sobrescreve uma nova | number | — | null/UNKNOWN = sem informação da fonte; nunca disponível | — | **null — necessita confirmação** |
| availability.reason | Motivo | Motivo de bloqueio ou indisponibilidade, quando informado | enum | — | null/UNKNOWN = sem informação da fonte; nunca disponível | AvailabilityReason | **null — necessita confirmação** |
| availability.notes | Observação interna | Nota interna; nunca exibida no modo cliente | string | — | null/UNKNOWN = sem informação da fonte; nunca disponível | — | **null — necessita confirmação** |
| availability.freshness | Atualidade do status | Indica se a situação foi confirmada recentemente, pode estar desatualizada ou ainda não foi informada | enum | — | nunca nulo | Freshness | **null — necessita confirmação** |
| availability.reservedUntil | Reservado até | Prazo de reserva | datetime | — | null/UNKNOWN = sem informação da fonte; nunca disponível | — | **null — necessita confirmação** |
| availability.sourceId | Fonte da situação | Fonte que informou a situação comercial | string | — | null/UNKNOWN = sem informação da fonte; nunca disponível | — | **null — necessita confirmação** |
| availability.proposalId | Proposta | Referência de proposta | string | — | null/UNKNOWN = sem informação da fonte; nunca disponível | — | **null — necessita confirmação** |
