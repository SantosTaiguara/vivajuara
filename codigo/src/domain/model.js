/* domain/model.js — Field Registry / Data Catalog (the official reference).
   Every canonical attribute of a Lot is declared once here with its domain,
   subdomain, type, unit, nullability, priority (P0–P3), usage flags
   (filterable · comparable · scoreInput · alertInput), dynamic type
   (STATIC · VERSIONED · DYNAMIC), default provenance, the legacy field it comes
   from and what it depends on. Validation, provenance, filters, comparison,
   details and docs all read this table.

   Lot { identity, geometry, location, surroundings, mobility, environmental, construction,
         commercial, intelligence, availability, provenance, metadata }  (see domain/lot.js)
   dynamicType decides the data lifecycle (data/lifecycle.js): STATIC fields come
   from the static snapshot, VERSIONED from the analysis snapshot, DYNAMIC from
   the commercial and availability snapshots. Fields marked virtual are not stored
   in the Lot (heavy or development-level values loaded on demand). */
App.model = (() => {
  const DOMAINS = {
    IDENTITY: 'Identificação', GEOMETRY: 'Geometria', LOCATION: 'Localização', SURROUNDINGS: 'Vizinhança', MOBILITY: 'Mobilidade e trânsito',
    ENVIRONMENTAL: 'Conforto ambiental', CONSTRUCTION: 'Construção e restrições', COMMERCIAL: 'Comercial', INTELLIGENCE: 'Inteligência',
    PROVENANCE: 'Proveniência e qualidade do dado', AVAILABILITY: 'Disponibilidade'
  };
  const PLAN = 'official-plan-v1', GEO = 'plan-geometry-v1', KMZ = 'kmz-v1', AER = 'aerial-v1', EVT = 'launch-event-v1', AN = 'analysis-v1', SOL = 'solar-model-v1', PT = 'price-table-v1';
  const DYN = { S: 'STATIC', V: 'VERSIONED', D: 'DYNAMIC' };
  /* R(key, domain, subdomain, label, type, unit, nullable, priority, flags, dyn, status, sourceId, method, confidence, legacy, meaning, extra)
     flags: f = filterable, c = comparable, s = scoreInput, a = alertInput */
  const R = (key, domain, subdomain, label, type, unit, nullable, priority, flags, dyn, status, sourceId, method, confidence, legacy, meaning, extra = {}) => Object.freeze({
    key, domain, subdomain, label, type, unit, nullable, priority,
    filterable: flags.includes('f'), comparable: flags.includes('c'), scoreInput: flags.includes('s'), alertInput: flags.includes('a'),
    provenanceRequired: extra.provenanceRequired !== false, dynamicType: DYN[dyn], status, sourceId, method, confidence, legacy, meaning,
    enum: extra.enum || null, dependsOn: extra.dependsOn || null, notes: extra.notes || null, virtual: !!extra.virtual
  });
  const FIELDS = [
    // A. IDENTITY
    R('identity.id', 'IDENTITY', null, 'ID do lote', 'string', null, false, 'P0', '', 'S', 'CALCULATED', null, 'id-rule', 'HIGH', 'did', 'ID técnico global e imutável: empreendimento + quadra + lote (VJ-Q<quadra>-L<0000>), já existente no lots.json'),
    R('identity.code', 'IDENTITY', null, 'Código do lote', 'string', null, false, 'P0', '', 'S', 'CONFIRMED', PLAN, 'official', 'HIGH', 'id', 'Código curto da planta (quadra + número), único dentro do empreendimento; usado nos links e na busca desde a primeira versão'),
    R('identity.developmentId', 'IDENTITY', null, 'Empreendimento', 'string', null, false, 'P0', '', 'S', 'CONFIRMED', null, 'config', 'HIGH', null, 'Empreendimento ao qual o lote pertence'),
    R('identity.developmentName', 'IDENTITY', null, 'Nome do empreendimento', 'string', null, false, 'P3', '', 'S', 'CONFIRMED', null, 'config', 'HIGH', null, 'Nome comercial; não substitui developmentId', { virtual: true, notes: 'Lido do DevelopmentConfig; não é copiado em cada lote.' }),
    R('identity.blockId', 'IDENTITY', null, 'Quadra', 'string', null, false, 'P0', 'fc', 'S', 'CONFIRMED', PLAN, 'official', 'HIGH', 'q', 'Código da quadra na planta (letra)'),
    R('identity.blockNumber', 'IDENTITY', null, 'Número da quadra', 'number', null, true, 'P3', '', 'S', 'NOT_APPLICABLE', PLAN, 'official', 'HIGH', null, 'As quadras deste empreendimento são identificadas por letra'),
    R('identity.lotNumber', 'IDENTITY', null, 'Lote', 'number', null, false, 'P0', '', 'S', 'CONFIRMED', PLAN, 'official', 'HIGH', 'n', 'Número do lote dentro da quadra'),
    R('identity.displayCode', 'IDENTITY', null, 'Código de exibição', 'string', null, false, 'P1', '', 'S', 'CALCULATED', null, 'derived', 'HIGH', null, 'Derivado para apresentação (quadra-lote)', { dependsOn: ['identity.blockId', 'identity.lotNumber'] }),
    R('identity.externalCode', 'IDENTITY', null, 'Código da loteadora', 'string', null, true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'Código oficial da loteadora, se existir'),
    // B. GEOMETRY
    R('geometry.areaM2', 'GEOMETRY', 'dimensions', 'Área', 'number', 'm²', true, 'P0', 'fcsa', 'S', 'CONFIRMED', PLAN, 'official', 'HIGH', 'a', 'Área oficial do quadro de áreas da planta'),
    R('geometry.frontM', 'GEOMETRY', 'dimensions', 'Frente', 'number', 'm', true, 'P1', 'fca', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'fr', 'Testada usada no app: soma das arestas de frente nos lotes em leque, senão a largura na frente', { dependsOn: ['geometry.frontBoxWidthM', 'geometry.frontEdgesM'] }),
    R('geometry.rearM', 'GEOMETRY', 'dimensions', 'Fundos', 'number', 'm', true, 'P2', 'c', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'wb', 'Largura nos fundos'),
    R('geometry.leftDepthM', 'GEOMETRY', 'dimensions', 'Lateral esquerda', 'number', 'm', true, 'P2', 'c', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'sideE', 'Lateral esquerda, vista da rua olhando para o lote'),
    R('geometry.rightDepthM', 'GEOMETRY', 'dimensions', 'Lateral direita', 'number', 'm', true, 'P2', 'c', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'sideD', 'Lateral direita, vista da rua olhando para o lote'),
    R('geometry.averageDepthM', 'GEOMETRY', 'dimensions', 'Profundidade média', 'number', 'm', true, 'P2', 'c', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'dp', 'Profundidade média medida no eixo frente-fundos'),
    R('geometry.perimeterM', 'GEOMETRY', 'dimensions', 'Perímetro', 'number', 'm', true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'Não calculado: sem metodologia aprovada para o traço da planta'),
    R('geometry.shape', 'GEOMETRY', 'shape', 'Formato', 'enum', null, true, 'P2', 'fca', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'forma', 'Formato do polígono', { enum: 'LotShape', notes: 'Na base antiga, lotes de esquina tinham "Esquina" no lugar do formato; para eles o formato fica UNKNOWN.' }),
    R('geometry.isCorner', 'GEOMETRY', 'shape', 'Esquina', 'boolean', null, false, 'P1', 'fcs', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'pos/forma', 'Lote com frente para duas ruas que se cruzam'),
    R('geometry.cornerType', 'GEOMETRY', 'shape', 'Tipo de esquina', 'enum', null, true, 'P3', '', 'S', 'CALCULATED', KMZ, 'geospatial', 'MEDIUM', 'pos', 'NONE para lotes que não são de esquina; UNKNOWN quando o tipo não foi classificado', { enum: 'CornerType' }),
    R('geometry.frontCount', 'GEOMETRY', 'shape', 'Frentes para rua', 'number', null, false, 'P2', 'fc', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'pos', 'Quantas faces do lote dão para rua'),
    R('geometry.irregularityLevel', 'GEOMETRY', 'shape', 'Irregularidade', 'enum', null, true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'Não calculado: sem metodologia própria', { enum: 'Level' }),
    R('geometry.usableGeometryScore', 'GEOMETRY', 'shape', 'Nota de geometria', 'number', 'score 0–10', true, 'P2', 'csa', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.geo', 'Quão aproveitável é o formato para construir'),
    R('geometry.usableGeometryClass', 'GEOMETRY', 'shape', 'Aproveitamento do formato', 'enum', null, true, 'P2', 'c', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'efic', 'Classe de aproveitamento do formato', { enum: 'Efficiency' }),
    R('geometry.measurementConfidence', 'GEOMETRY', 'quality', 'Confiabilidade das medidas', 'enum', null, false, 'P3', '', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'mconf', 'Confiabilidade das medidas tiradas da planta', { enum: 'Confidence' }),
    R('geometry.frontBoxWidthM', 'GEOMETRY', 'technical', 'Largura na frente (caixa)', 'number', 'm', true, 'P3', 's', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'wf', 'Largura medida perpendicular ao eixo do lote, na faixa da frente'),
    R('geometry.frontEdgesM', 'GEOMETRY', 'technical', 'Soma das arestas de frente', 'number', 'm', true, 'P3', '', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'edgeF', 'Soma dos lados cuja normal aponta para a rua'),
    R('geometry.rearEdgesM', 'GEOMETRY', 'technical', 'Soma das arestas de fundos', 'number', 'm', true, 'P3', '', 'S', 'CALCULATED', GEO, 'geometric', 'HIGH', 'edgeB', 'Soma dos lados dos fundos'),
    R('geometry.polygon', 'GEOMETRY', 'spatial', 'Contorno', 'geometry', 'unidade do mapa', false, 'P3', '', 'S', 'CALCULATED', PLAN, 'vectorized', 'HIGH', 'p', 'Contorno do lote vetorizado da planta (norte para cima)'),
    R('geometry.centroid', 'GEOMETRY', 'spatial', 'Centroide', 'geometry', 'unidade do mapa', false, 'P3', '', 'S', 'CALCULATED', PLAN, 'geometric', 'HIGH', 'c (substituído)', 'Centroide de área calculado do contorno', { dependsOn: ['geometry.polygon'] }),
    R('geometry.bounds', 'GEOMETRY', 'spatial', 'Retângulo envolvente', 'geometry', 'unidade do mapa', false, 'P3', '', 'S', 'CALCULATED', PLAN, 'geometric', 'HIGH', null, 'Limites do contorno', { dependsOn: ['geometry.polygon'] }),
    // C. LOCATION
    R('location.streetId', 'LOCATION', 'address', 'Rua (código)', 'string', null, true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'A planta só traz ruas projetadas'),
    R('location.streetName', 'LOCATION', 'address', 'Rua', 'string', null, true, 'P2', '', 'S', 'UNKNOWN', null, null, null, null, 'Nome oficial da rua'),
    R('location.blockPosition', 'LOCATION', 'position', 'Posição na quadra', 'enum', null, false, 'P1', 'fcs', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'pos', 'Interno, esquina ou frente para duas ruas', { enum: 'BlockPosition' }),
    R('location.perimeterPosition', 'LOCATION', 'position', 'Posição no perímetro', 'enum', null, false, 'P2', 'fc', 'S', 'CALCULATED', KMZ, 'rule', 'MEDIUM', 'fundo/vzE/vzD', 'Se o lote encosta no limite do condomínio (fundos ou lateral)', { enum: 'PerimeterPosition', dependsOn: ['surroundings.rearNeighborType', 'surroundings.leftNeighborType', 'surroundings.rightNeighborType'] }),
    R('location.sector', 'LOCATION', 'position', 'Setor', 'string', null, true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'Setor do empreendimento, se houver'),
    R('location.latitude', 'LOCATION', 'coordinates', 'Latitude', 'number', 'graus', false, 'P3', '', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'lat', 'Latitude do centro do lote (WGS84)'),
    R('location.longitude', 'LOCATION', 'coordinates', 'Longitude', 'number', 'graus', false, 'P3', '', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'lon', 'Longitude do centro do lote (WGS84)'),
    R('location.distanceToGateLinearM', 'LOCATION', 'distances', 'Portaria (linha reta)', 'number', 'm', false, 'P2', 'fcsa', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'dport', 'Distância em linha reta até a portaria'),
    R('location.distanceToClubLinearM', 'LOCATION', 'distances', 'Clube (linha reta)', 'number', 'm', false, 'P2', 'fcs', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'dclube', 'Distância em linha reta até o clube'),
    R('location.distanceToGreenAreaM', 'LOCATION', 'distances', 'Parque florestal mais próximo', 'number', 'm', false, 'P2', 'fc', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'dpark', 'Distância até o parque florestal mais próximo (AC9, AC10 ou AC12)'),
    R('location.distanceToPlaygroundM', 'LOCATION', 'distances', 'Playground mais próximo', 'number', 'm', false, 'P2', 'cs', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'dplay', 'Distância em linha reta até o playground mais próximo'),
    R('location.distanceToSquareM', 'LOCATION', 'distances', 'Praça mais próxima', 'number', 'm', false, 'P2', 'cs', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'dpraca', 'Distância em linha reta até a praça mais próxima'),
    R('location.distanceToExternalRoadM', 'LOCATION', 'distances', 'Av. Porto Dourado', 'number', 'm', false, 'P2', 'fcsa', 'S', 'CALCULATED', KMZ, 'geospatial', 'MEDIUM', 'dav', 'Distância até a avenida externa (a planta prevê ampliação)'),
    R('location.distanceToTechnicalAreaM', 'LOCATION', 'distances', 'Estação elevatória (EEEB)', 'number', 'm', false, 'P2', 'csa', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'deeeb', 'Distância até a estação elevatória de esgoto'),
    R('location.distanceToAppM', 'LOCATION', 'distances', 'APP mais próxima', 'number', 'm', true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'Não há APP delimitada no material recebido'),
    R('location.distanceToMainInternalRoadM', 'LOCATION', 'distances', 'Via interna principal', 'number', 'm', true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'Não calculado'),
    // D. SURROUNDINGS
    R('surroundings.frontNeighborType', 'SURROUNDINGS', 'neighbors', 'Na frente', 'enum', null, false, 'P2', 'c', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', null, 'A frente do lote é definida pela rua de acesso', { enum: 'NeighborType' }),
    R('surroundings.rearNeighborType', 'SURROUNDINGS', 'neighbors', 'Nos fundos', 'enum', null, false, 'P1', 'fcsa', 'S', 'CALCULATED', KMZ, 'geospatial', 'MEDIUM', 'fundo', 'O que existe hoje nos fundos', { enum: 'NeighborType' }),
    R('surroundings.leftNeighborType', 'SURROUNDINGS', 'neighbors', 'Na lateral esquerda', 'enum', null, false, 'P2', 'c', 'S', 'CALCULATED', KMZ, 'geospatial', 'MEDIUM', 'vzE', 'Vizinho da lateral esquerda', { enum: 'NeighborType' }),
    R('surroundings.rightNeighborType', 'SURROUNDINGS', 'neighbors', 'Na lateral direita', 'enum', null, false, 'P2', 'c', 'S', 'CALCULATED', KMZ, 'geospatial', 'MEDIUM', 'vzD', 'Vizinho da lateral direita', { enum: 'NeighborType' }),
    R('surroundings.rearCondition', 'SURROUNDINGS', 'neighbors', 'Fechamento dos fundos', 'enum', null, false, 'P2', 'c', 'S', 'TO_CONFIRM', EVT, 'declared', 'LOW', 'fech', 'Muro, gradil ou divisa com outro lote', { enum: 'RearCondition' }),
    R('surroundings.hasRearNeighbor', 'SURROUNDINGS', 'neighbors', 'Tem lote vizinho nos fundos', 'boolean', null, false, 'P2', 'fc', 'S', 'CALCULATED', KMZ, 'geospatial', 'MEDIUM', 'fundo', 'Ausência atual de vizinho não garante que nada será construído', { dependsOn: ['surroundings.rearNeighborType'] }),
    R('surroundings.hasGreenRear', 'SURROUNDINGS', 'green', 'Mata ou parque nos fundos', 'boolean', null, false, 'P1', 'fcsa', 'S', 'CALCULATED', KMZ, 'geospatial', 'MEDIUM', 'mata', 'Vegetação existente hoje nos fundos; não é o mesmo que APP'),
    R('surroundings.appNearby', 'SURROUNDINGS', 'green', 'APP próxima', 'boolean', null, true, 'P2', '', 'S', 'UNKNOWN', null, null, null, null, 'Mata existente não é classificada automaticamente como APP'),
    R('surroundings.sewageStationNearby', 'SURROUNDINGS', 'infrastructure', 'Perto da estação elevatória', 'boolean', null, false, 'P2', 'fca', 'S', 'CALCULATED', KMZ, 'rule', 'HIGH', 'deeeb', 'A menos de 40 m da EEEB', { dependsOn: ['location.distanceToTechnicalAreaM'] }),
    R('surroundings.viewType', 'SURROUNDINGS', 'view', 'Vista', 'enum', null, false, 'P2', 'fcs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'vista', 'Tipo de vista provável', { enum: 'ViewType' }),
    R('surroundings.viewPermanence', 'SURROUNDINGS', 'view', 'Permanência da vista', 'enum', null, true, 'P2', 'c', 'V', 'ESTIMATED', AN, 'analytical-model', 'LOW', 'vista', 'Sem evidência documental, nenhuma vista é tratada como permanente', { enum: 'ViewPermanence' }),
    R('surroundings.viewDetail', 'SURROUNDINGS', 'view', 'Descrição da vista', 'enum', null, false, 'P3', '', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'vista', 'Classificação detalhada da vista (preserva a redação original)', { enum: 'ViewDetail' }),
    // E. MOBILITY
    R('mobility.streetHierarchy', 'MOBILITY', 'street', 'Tipo de via', 'enum', null, false, 'P1', 'fc', 'V', 'ESTIMATED', AN, 'routing', 'MEDIUM', 'via', 'Papel da rua na circulação interna', { enum: 'StreetHierarchy' }),
    R('mobility.estimatedTraffic', 'MOBILITY', 'traffic', 'Trânsito estimado', 'enum', null, false, 'P1', 'fcsa', 'V', 'ESTIMATED', AN, 'routing', 'MEDIUM', 'fc', 'Fluxo relativo de carros na rua (não é contagem)', { enum: 'Level' }),
    R('mobility.vehiclesPassingEstimate', 'MOBILITY', 'traffic', 'Lotes que passam em frente', 'number', 'lotes', false, 'P2', 'c', 'V', 'ESTIMATED', AN, 'routing', 'MEDIUM', 'flow', 'Quantos lotes passam em frente no caminho até a portaria (estimativa)'),
    R('mobility.routeDistanceToGateM', 'MOBILITY', 'routes', 'Percurso até a portaria', 'number', 'm', false, 'P1', 'fcs', 'S', 'CALCULATED', KMZ, 'routing', 'MEDIUM', 'rport', 'Distância de carro pelas vias até a portaria'),
    R('mobility.routeDistanceToLeisureM', 'MOBILITY', 'routes', 'Percurso até o clube', 'number', 'm', false, 'P1', 'fcs', 'S', 'CALCULATED', KMZ, 'routing', 'MEDIUM', 'rclube', 'Distância de carro pelas vias até o clube'),
    R('mobility.gateProximity', 'MOBILITY', 'routes', 'Proximidade da portaria', 'enum', null, false, 'P2', 'fc', 'V', 'CALCULATED', AN, 'rule', 'MEDIUM', 'portc', 'Faixa do percurso até a portaria', { enum: 'GateProximity', dependsOn: ['mobility.routeDistanceToGateM'] }),
    R('mobility.nearMainAccess', 'MOBILITY', 'routes', 'Perto da portaria', 'boolean', null, false, 'P2', 'f', 'V', 'CALCULATED', AN, 'rule', 'MEDIUM', null, 'Percurso até a portaria menor que 200 m', { dependsOn: ['mobility.routeDistanceToGateM'] }),
    R('mobility.routeToGate', 'MOBILITY', 'routes', 'Rota até a portaria', 'geometry', 'unidade do mapa', true, 'P3', '', 'S', 'CALCULATED', KMZ, 'routing', 'MEDIUM', 'routes.json:p', 'Traçado da rota; valor pesado carregado sob demanda pelo SpatialRepository', { virtual: true }),
    R('mobility.routeToLeisure', 'MOBILITY', 'routes', 'Rota até o clube', 'geometry', 'unidade do mapa', true, 'P3', '', 'S', 'CALCULATED', KMZ, 'routing', 'MEDIUM', 'routes.json:k', 'Traçado da rota; valor pesado carregado sob demanda', { virtual: true }),
    // F. ENVIRONMENTAL
    R('environmental.orientationFront', 'ENVIRONMENTAL', 'orientation', 'Frente voltada para', 'enum', null, false, 'P1', 'fc', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'fs', 'Direção para onde a frente aponta', { enum: 'Direction' }),
    R('environmental.orientationRear', 'ENVIRONMENTAL', 'orientation', 'Fundos voltados para', 'enum', null, false, 'P2', 'fc', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'bs', 'Direção dos fundos', { enum: 'Direction' }),
    R('environmental.orientationLeft', 'ENVIRONMENTAL', 'orientation', 'Lateral esquerda voltada para', 'enum', null, false, 'P3', 'c', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'lat_s (1º)', 'Direção da lateral esquerda', { enum: 'Direction' }),
    R('environmental.orientationRight', 'ENVIRONMENTAL', 'orientation', 'Lateral direita voltada para', 'enum', null, false, 'P3', 'c', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'lat_s (2º)', 'Direção da lateral direita', { enum: 'Direction' }),
    R('environmental.frontBearingDeg', 'ENVIRONMENTAL', 'orientation', 'Azimute da frente', 'number', 'graus', false, 'P3', 's', 'S', 'CALCULATED', KMZ, 'geospatial', 'HIGH', 'az', '0 = norte, 90 = leste'),
    R('environmental.northReference', 'ENVIRONMENTAL', 'orientation', 'Referência de norte', 'string', null, false, 'P3', '', 'S', 'CONFIRMED', PLAN, 'official', 'HIGH', null, 'Norte da planta oficial'),
    R('environmental.morningSun', 'ENVIRONMENTAL', 'solar', 'Sol da manhã', 'array', 'enum', false, 'P1', 'c', 'V', 'ESTIMATED', SOL, 'astronomical', 'MEDIUM', 'manha', 'Lados que recebem sol pela manhã', { enum: 'LotSide' }),
    R('environmental.afternoonSun', 'ENVIRONMENTAL', 'solar', 'Sol da tarde', 'array', 'enum', false, 'P1', 'ca', 'V', 'ESTIMATED', SOL, 'astronomical', 'MEDIUM', 'tarde', 'Lados que recebem sol à tarde', { enum: 'LotSide' }),
    R('environmental.northSunSide', 'ENVIRONMENTAL', 'solar', 'Sol do norte (piscina e lazer)', 'enum', null, false, 'P2', 'fc', 'V', 'ESTIMATED', SOL, 'astronomical', 'MEDIUM', 'lazer', 'Onde fica o sol do norte', { enum: 'NorthSunSide' }),
    R('environmental.eastSide', 'ENVIRONMENTAL', 'solar', 'Lado leste (quartos)', 'enum', null, false, 'P2', '', 'V', 'ESTIMATED', SOL, 'astronomical', 'MEDIUM', 'quartos', 'Lado que recebe sol da manhã, sugerido para quartos', { enum: 'LotSide' }),
    R('environmental.solarScore', 'ENVIRONMENTAL', 'solar', 'Nota de orientação solar', 'number', 'score 0–10', false, 'P1', 'fcs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.sol', 'Nota de orientação solar'),
    R('environmental.noiseLevel', 'ENVIRONMENTAL', 'acoustic', 'Ruído provável', 'enum', null, false, 'P1', 'fcsa', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'ruido', 'Classificação analítica de exposição, não medição em decibéis', { enum: 'Level' }),
    R('environmental.quietScore', 'ENVIRONMENTAL', 'acoustic', 'Nota de silêncio', 'number', 'score 0–10', false, 'P1', 'fcsa', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.sil', 'Quanto maior, mais silencioso'),
    R('environmental.noiseSources', 'ENVIRONMENTAL', 'acoustic', 'Fontes de ruído próximas', 'array', 'm', false, 'P2', 'a', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'fontes', 'Fontes consideradas na estimativa e suas distâncias', { enum: 'NoiseSourceType' }),
    R('environmental.privacyLevel', 'ENVIRONMENTAL', 'privacy', 'Privacidade', 'enum', null, false, 'P1', 'fc', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'priv', 'Classe de privacidade provável', { enum: 'Level' }),
    R('environmental.privacyScore', 'ENVIRONMENTAL', 'privacy', 'Nota de privacidade', 'number', 'score 0–10', false, 'P1', 'fcsa', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.priv', 'Indicador composto da metodologia atual'),
    R('environmental.viewScore', 'ENVIRONMENTAL', 'view', 'Nota de vista', 'number', 'score 0–10', false, 'P2', 'cs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.vista', 'Nota da vista provável'),
    R('environmental.ventilation', 'ENVIRONMENTAL', 'ventilation', 'Ventilação', 'enum', null, true, 'P2', '', 'S', 'UNKNOWN', null, null, null, 'nt.vent (sempre nulo)', 'Sem dados de vento: permanece nulo', { enum: 'Level' }),
    // G. CONSTRUCTION
    R('construction.topography', 'CONSTRUCTION', 'terrain', 'Topografia', 'enum', null, true, 'P1', '', 'S', 'UNKNOWN', null, null, null, 'nt.topo (sempre nulo)', 'Falta levantamento planialtimétrico', { enum: 'TopographyType' }),
    R('construction.slopePercent', 'CONSTRUCTION', 'terrain', 'Declividade', 'number', '%', true, 'P2', '', 'S', 'UNKNOWN', null, null, null, null, 'Falta levantamento planialtimétrico'),
    R('construction.drainage', 'CONSTRUCTION', 'terrain', 'Drenagem', 'enum', null, true, 'P2', '', 'S', 'UNKNOWN', null, null, null, null, 'Falta projeto de drenagem', { enum: 'DrainageStatus' }),
    R('construction.frontSetbackM', 'CONSTRUCTION', 'rules', 'Recuo frontal', 'number', 'm', true, 'P2', '', 'S', 'UNKNOWN', null, null, null, null, 'Depende do regulamento construtivo'),
    R('construction.rearSetbackM', 'CONSTRUCTION', 'rules', 'Recuo de fundos', 'number', 'm', true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'Depende do regulamento construtivo'),
    R('construction.sideSetbackM', 'CONSTRUCTION', 'rules', 'Recuos laterais', 'number', 'm', true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'Depende do regulamento construtivo'),
    R('construction.occupationRate', 'CONSTRUCTION', 'rules', 'Taxa de ocupação', 'number', '%', true, 'P2', '', 'S', 'UNKNOWN', null, null, null, null, 'Depende do regulamento construtivo'),
    R('construction.permeabilityRate', 'CONSTRUCTION', 'rules', 'Taxa de permeabilidade', 'number', '%', true, 'P2', '', 'S', 'UNKNOWN', null, null, null, null, 'Depende do regulamento construtivo'),
    R('construction.buildingCoefficient', 'CONSTRUCTION', 'rules', 'Coeficiente de aproveitamento', 'number', null, true, 'P2', '', 'S', 'UNKNOWN', null, null, null, null, 'Depende do regulamento construtivo'),
    R('construction.maxFloors', 'CONSTRUCTION', 'rules', 'Pavimentos permitidos', 'number', null, true, 'P3', '', 'S', 'UNKNOWN', null, null, null, null, 'Depende do regulamento construtivo'),
    R('construction.easements', 'CONSTRUCTION', 'restrictions', 'Servidões', 'array', null, false, 'P1', 'fca', 'S', 'CONFIRMED', PLAN, 'official', 'HIGH', 'al (SERVIDÃO)', 'Servidões desenhadas na planta oficial junto ao lote'),
    R('construction.nonBuildableRearToConfirm', 'CONSTRUCTION', 'restrictions', 'Faixa não edificável nos fundos', 'boolean', null, false, 'P1', 'fca', 'V', 'TO_CONFIRM', EVT, 'declared', 'LOW', 'al (RESTRIÇÃO CONSTRUTIVA)', 'APP ou mata nos fundos citada no evento; faixa não edificável a confirmar'),
    R('construction.regulationStatus', 'CONSTRUCTION', 'rules', 'Regulamento construtivo', 'enum', null, false, 'P1', '', 'S', 'CONFIRMED', null, 'inventory', 'HIGH', null, 'UNAVAILABLE enquanto o regulamento não for recebido', { enum: 'RegulationStatus' }),
    R('construction.constructivePotential', 'CONSTRUCTION', 'rules', 'Potencial construtivo', 'number', null, true, 'P2', '', 'S', 'UNKNOWN', null, null, null, 'nt.pc (sempre nulo)', 'Sem regulamento não há metodologia'),
    // H. COMMERCIAL (dynamic; attached by CommercialRepository)
    R('commercial.price', 'COMMERCIAL', 'pricing', 'Preço', 'number', 'BRL', true, 'P0', 'fcs', 'D', 'CALCULATED', PT, 'price-table', 'HIGH', null, 'Preço de tabela = área × preço por m² da tabela vigente', { dependsOn: ['geometry.areaM2', 'commercial.pricePerM2'] }),
    R('commercial.pricePerM2', 'COMMERCIAL', 'pricing', 'Preço por m²', 'number', 'BRL/m²', true, 'P0', 'fc', 'D', 'CONFIRMED', PT, 'price-table', 'HIGH', null, 'Preço por m² da tabela vigente'),
    R('commercial.currency', 'COMMERCIAL', 'pricing', 'Moeda', 'string', null, false, 'P3', '', 'D', 'CONFIRMED', PT, 'price-table', 'HIGH', null, 'BRL'),
    R('commercial.downPaymentDefaultPercent', 'COMMERCIAL', 'payment', 'Entrada padrão', 'number', '%', false, 'P1', '', 'D', 'CONFIRMED', EVT, 'declared', 'HIGH', null, 'Percentual de entrada apresentado no lançamento'),
    R('commercial.downPaymentDefaultValue', 'COMMERCIAL', 'payment', 'Valor da entrada padrão', 'number', 'BRL', true, 'P1', 'c', 'D', 'CALCULATED', PT, 'price-table', 'HIGH', null, 'Preço × entrada padrão', { dependsOn: ['commercial.price', 'commercial.downPaymentDefaultPercent'] }),
    R('commercial.availablePlans', 'COMMERCIAL', 'payment', 'Planos de pagamento', 'array', null, false, 'P1', 'c', 'D', 'CONFIRMED', EVT, 'declared', 'HIGH', null, 'Planos do lançamento: 144x, 144x com anuais, 18x e 36x'),
    R('commercial.priceTableId', 'COMMERCIAL', 'pricing', 'Tabela comercial', 'string', null, false, 'P3', '', 'D', 'CONFIRMED', PT, 'price-table', 'HIGH', null, 'Tabela em uso'),
    R('commercial.priceTableVersion', 'COMMERCIAL', 'pricing', 'Versão da tabela', 'string', null, false, 'P3', '', 'D', 'CONFIRMED', PT, 'price-table', 'HIGH', null, 'Versão da tabela em uso'),
    R('commercial.validFrom', 'COMMERCIAL', 'pricing', 'Válida desde', 'date', null, true, 'P3', '', 'D', 'UNKNOWN', null, null, null, null, 'Validade da tabela não informada'),
    R('commercial.validUntil', 'COMMERCIAL', 'pricing', 'Válida até', 'date', null, true, 'P3', '', 'D', 'UNKNOWN', null, null, null, null, 'Validade da tabela não informada'),
    // I. INTELLIGENCE
    R('intelligence.analysisVersion', 'INTELLIGENCE', 'version', 'Versão da análise', 'string', null, false, 'P3', '', 'V', 'CONFIRMED', AN, 'config', 'HIGH', null, 'Versão da metodologia que gerou scores, classes e alertas'),
    R('intelligence.scores.housing', 'INTELLIGENCE', 'scores', 'Score Moradia', 'number', 'score 0–100', false, 'P1', 'fc', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'sm', 'Silêncio 25%, privacidade 20%, sol 20%, fluxo 15%, vista 10%, geometria 10%'),
    R('intelligence.scores.investment', 'INTELLIGENCE', 'scores', 'Score Investimento', 'number', 'score 0–100', false, 'P1', 'fc', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'si', 'Liquidez 35%, valorização relativa 25%, custo-benefício 25%, geometria 15%'),
    R('intelligence.scores.family', 'INTELLIGENCE', 'scores', 'Score Família', 'number', 'score 0–100', false, 'P1', 'fc', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'sf', 'Lazer 30%, fluxo 25%, portaria 15%, sol 15%, silêncio 15%'),
    R('intelligence.scores.premium', 'INTELLIGENCE', 'scores', 'Score Premium', 'number', 'score 0–100', false, 'P1', 'fc', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'sp', 'Privacidade 30%, vista 25%, silêncio 25%, sol 10%, geometria 10%'),
    R('intelligence.scores.overall', 'INTELLIGENCE', 'scores', 'Score geral', 'number', 'score 0–100', false, 'P2', 'fc', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'sg', 'Média dos quatro scores'),
    R('intelligence.class', 'INTELLIGENCE', 'scores', 'Classe', 'enum', null, false, 'P1', 'fc', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'cl', 'A+ a D: posição relativa do score geral no empreendimento', { enum: 'LotClass' }),
    R('intelligence.notes.leisure', 'INTELLIGENCE', 'criteria', 'Nota de lazer', 'number', 'score 0–10', true, 'P2', 'cs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.laz', 'Proximidade do clube, praças e playground'),
    R('intelligence.notes.gate', 'INTELLIGENCE', 'criteria', 'Nota de acesso à portaria', 'number', 'score 0–10', true, 'P2', 'cs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.port', 'Quanto menor o percurso até a portaria, maior a nota', { dependsOn: ['mobility.routeDistanceToGateM'] }),
    R('intelligence.notes.lowTraffic', 'INTELLIGENCE', 'criteria', 'Nota de baixo fluxo', 'number', 'score 0–10', true, 'P2', 'cs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.flux', 'Quanto menos carros passam em frente, maior a nota', { dependsOn: ['mobility.vehiclesPassingEstimate'] }),
    R('intelligence.notes.liquidity', 'INTELLIGENCE', 'criteria', 'Nota de liquidez', 'number', 'score 0–10', true, 'P2', 'cs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.liq', 'Facilidade relativa de revenda (não é promessa de valorização)'),
    R('intelligence.notes.relativeValue', 'INTELLIGENCE', 'criteria', 'Nota de valor relativo', 'number', 'score 0–10', true, 'P2', 'cs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.val', 'Atributos do lote em relação aos demais (não é promessa de valorização)'),
    R('intelligence.notes.priceQuality', 'INTELLIGENCE', 'criteria', 'Nota de custo-benefício', 'number', 'score 0–10', true, 'P2', 'cs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'nt.pq', 'Qualidade do lote em relação ao preço da tabela'),
    R('intelligence.liquidity', 'INTELLIGENCE', 'market', 'Liquidez', 'enum', null, false, 'P2', 'fcs', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'liq', 'Liquidez relativa (área, sol, privacidade, silêncio, geometria)', { enum: 'Level' }),
    R('intelligence.idealProfiles', 'INTELLIGENCE', 'profiles', 'Mais indicado para', 'array', 'enum', false, 'P1', 'f', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'perfil', 'Perfis de cliente mais aderentes', { enum: 'Profile' }),
    R('intelligence.alerts', 'INTELLIGENCE', 'alerts', 'Alertas', 'array', null, false, 'P1', 'f', 'V', 'CALCULATED', AN, 'rules', 'MEDIUM', 'al', 'Alertas com tipo, severidade, mensagem e campo de origem'),
    R('intelligence.rankings', 'INTELLIGENCE', 'ranking', 'Posição nos rankings', 'array', null, false, 'P2', 'c', 'V', 'CALCULATED', AN, 'ranking', 'HIGH', null, 'Posição em cada score entre todos os lotes', { dependsOn: ['intelligence.scores.housing', 'intelligence.scores.investment', 'intelligence.scores.family', 'intelligence.scores.premium'] }),
    R('intelligence.highlights', 'INTELLIGENCE', 'recommendation', 'Destaques', 'array', null, false, 'P1', '', 'V', 'CALCULATED', AN, 'rules', 'MEDIUM', null, 'Pontos fortes derivados dos dados, cada um ligado ao campo que o sustenta'),
    R('intelligence.confidence', 'PROVENANCE', 'quality', 'Confiabilidade da análise', 'enum', null, false, 'P3', '', 'V', 'ESTIMATED', AN, 'analytical-model', 'MEDIUM', 'conf', 'Qualidade geral do dado do lote (não é score do lote)', { enum: 'Confidence' }),
    // METADATA (technical, not a business attribute)
    R('metadata.schemaVersion', 'PROVENANCE', 'schema', 'Versão do schema', 'string', null, false, 'P3', '', 'S', 'CONFIRMED', null, 'schema', 'HIGH', null, 'Versão do contrato Lot; não confundir com versão da análise ou da tabela', { provenanceRequired: false }),
    // K. AVAILABILITY
    R('availability.status', 'AVAILABILITY', null, 'Disponibilidade', 'enum', null, false, 'P0', 'fc', 'D', 'UNKNOWN', null, null, null, 'st', 'Situação comercial informada pela loteadora; sem confirmação, aparece como "Status não confirmado" e nunca como disponível', { enum: 'AvailabilityStatus' }),
    R('availability.updatedAt', 'AVAILABILITY', null, 'Atualizado em', 'datetime', null, true, 'P1', '', 'D', 'UNKNOWN', null, null, null, null, 'Data e hora (ISO 8601) da última atualização conhecida da situação'),
    R('availability.revision', 'AVAILABILITY', null, 'Revisão', 'number', null, true, 'P3', '', 'D', 'CALCULATED', null, 'sequence', 'HIGH', null, 'Ordem das atualizações: uma revisão antiga nunca sobrescreve uma nova'),
    R('availability.reason', 'AVAILABILITY', null, 'Motivo', 'enum', null, true, 'P2', '', 'D', 'UNKNOWN', null, null, null, null, 'Motivo de bloqueio ou indisponibilidade, quando informado', { enum: 'AvailabilityReason' }),
    R('availability.notes', 'AVAILABILITY', null, 'Observação interna', 'string', null, true, 'P3', '', 'D', 'UNKNOWN', null, null, null, null, 'Nota interna; nunca exibida no modo cliente'),
    R('availability.freshness', 'AVAILABILITY', null, 'Atualidade do status', 'enum', null, false, 'P2', '', 'D', 'CALCULATED', null, 'freshness-policy', 'HIGH', null, 'Indica se a situação foi confirmada recentemente, pode estar desatualizada ou ainda não foi informada', { enum: 'Freshness' }),
    R('availability.reservedUntil', 'AVAILABILITY', null, 'Reservado até', 'datetime', null, true, 'P3', '', 'D', 'UNKNOWN', null, null, null, null, 'Prazo de reserva'),
    R('availability.sourceId', 'AVAILABILITY', null, 'Fonte da situação', 'string', null, true, 'P3', '', 'D', 'UNKNOWN', null, null, null, null, 'Fonte que informou a situação comercial'),
    R('availability.proposalId', 'AVAILABILITY', null, 'Proposta', 'string', null, true, 'P3', '', 'D', 'UNKNOWN', null, null, null, null, 'Referência de proposta')
  ];
  /** analysis criteria (0–10) → the canonical field that holds each one; used by recommendation, Quick View and comparison */
  const CRITERIA_FIELDS = Object.freeze({
    quiet: 'environmental.quietScore', privacy: 'environmental.privacyScore', solar: 'environmental.solarScore', view: 'environmental.viewScore',
    geometry: 'geometry.usableGeometryScore', leisure: 'intelligence.notes.leisure', gate: 'intelligence.notes.gate', lowTraffic: 'intelligence.notes.lowTraffic',
    liquidity: 'intelligence.notes.liquidity', relativeValue: 'intelligence.notes.relativeValue', priceQuality: 'intelligence.notes.priceQuality'
  });
  const BY = Object.fromEntries(FIELDS.map(f => [f.key, f]));
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  /** Attribute-level provenance: per-lot override → registry default; a null value is UNKNOWN. */
  function getFieldProvenance(lot, key) {
    const d = BY[key] || BY[key.split('.').slice(0, 2).join('.')] || { status: 'UNKNOWN', sourceId: null, method: null, confidence: null };
    const own = lot && lot.provenance && lot.provenance[key];
    const base = { status: d.status, sourceId: d.sourceId, method: d.method, confidence: d.confidence, precision: null, updatedAt: null, notes: d.notes || null };
    if (own) return { ...base, ...own };
    const v = lot ? get(lot, key) : undefined;
    if (d.nullable && v == null && d.status !== 'NOT_APPLICABLE') return { ...base, status: 'UNKNOWN', sourceId: null, method: null, confidence: null };
    return base;
  }
  return Object.freeze({
    DOMAINS, FIELDS, CRITERIA_FIELDS, field: k => BY[k] || null, get, getFieldProvenance,
    criterion: (lot, k) => CRITERIA_FIELDS[k] ? get(lot, CRITERIA_FIELDS[k]) : undefined,
    getStoredFields: () => FIELDS.filter(f => !f.virtual),
    getFilterableFields: () => FIELDS.filter(f => f.filterable),
    getComparableFields: () => FIELDS.filter(f => f.comparable),
    getFieldsByDomain: d => FIELDS.filter(f => f.domain === d),
    getScoreInputs: () => FIELDS.filter(f => f.scoreInput),
    getAlertInputs: () => FIELDS.filter(f => f.alertInput)
  });
})();

/* App.pricing.formula — TD-12: the single source of the lot price formula (pricing namespace).
   Lives in domain/model.js because this file is in both load orders (browser ORDER and the backend's
   BACKEND_ORDER in backend/src/shared/domain/sharedDomain.js), before every consumer.

   price = round(areaM2 × pricePerM2 × 100) / 100 (R$, 2 decimals; tabela vigente R$ 1.196/m², "preço de tabela").
   downPaymentDefaultValue = round(price × percent) / 100 (percent in 0..100).
   pricePerM2 (inverse, used when a patch sets the price) = round(price / areaM2 × 100) / 100.
   Used by data/repositories.js (composition), domain/lot.js (patch), pricing/priceHistory.js (history) and
   provenance/provenanceServices.js (reproducibility check). null is never 0: a missing input gives null.
   Pure. */
App.pricing = App.pricing || {};
App.pricing.formula = (() => {
  const missing = v => v == null;
  /** lotPrice(areaM2, pricePerM2) → number | null */
  const lotPrice = (areaM2, pricePerM2) => missing(areaM2) || missing(pricePerM2) ? null : Math.round(areaM2 * pricePerM2 * 100) / 100;
  /** downPaymentValue(price, percent) → number | null */
  const downPaymentValue = (price, percent) => missing(price) || missing(percent) ? null : Math.round(price * percent) / 100;
  /** pricePerM2Of(price, areaM2) → number | null (area 0 → null) */
  const pricePerM2Of = (price, areaM2) => missing(price) || !areaM2 ? null : Math.round(price / areaM2 * 100) / 100;
  return Object.freeze({ lotPrice, downPaymentValue, pricePerM2Of, formulaId: 'price-table-v1' });
})();
