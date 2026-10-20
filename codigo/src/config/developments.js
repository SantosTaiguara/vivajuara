/* config/developments.js
   Tenant → Development configuration. Everything development-specific lives here
   (names, assets, map frame, price tables, sources, points of interest, feature
   flags), so components never hardcode "Viva Juara". */
App.config = (() => {
  const TENANT = { id: 'house7', name: 'House 7 Imóveis' };
  const VIVA_JUARA = {
    id: 'viva-juara', code: 'VJ', tenantId: TENANT.id,
    name: 'Viva Juara', legalName: 'Condomínio de Lotes Quintas da Lagoa', city: 'Serra/ES', law: 'LC 5.819/23',
    currency: 'BRL', locale: 'pt-BR',
    assets: { manifest: 'manifest.json', commercial: 'commercial.json', lots: 'lots.json', routes: 'routes.json', images: 'img_list.json', plan: 'planta.webp', aerial: 'aerea.webp', logo: 'logo.png' },
    // Map frame (units of the vectorized plan, north up). 1 unit = 0,4846 m (plan 1:1000).
    map: { width: 2247, height: 1587, fit: { x: 120, y: 60, w: 1940, h: 1500 }, metersPerUnit: 0.35278 / 0.72799, northUp: true,
      defaultLayer: 'availability', defaultBackground: 'plan' },
    geo: { lat: -20.145, lon: -40.208, utcOffset: -3 },
    shareUrl: 'https://claude.ai/artifact/QMVbEgfCfjxrxnu713phsN',
    // Data source (topic 9): client-only JSON today; the API source is switched on per development once the backend is hosted.
    dataSource: { useBackendData: false, apiBaseUrl: null, fallbackToJson: true },
    // Data lifecycle versions (topic 7): structural plan, analysis methodology, price table.
    staticDataVersion: '2026-10-06.1', analysisVersion: '2026-10-06',
    // Freshness policy (topic 10). Time limits are a business decision: null = no time limit, so a value is
    // FRESH only while the official source confirms it in this session and STALE as soon as it cannot.
    freshnessPolicy: { commercialMaxAgeMs: null, availabilityMaxAgeMs: null, commercialExpireAfterMs: null, availabilityExpireAfterMs: null },
    // Local cache (topic 10): the cache is an operational copy, never the source of truth.
    offline: { enabled: true, serviceWorker: true, requestTimeoutMs: 8000, retries: 2, cacheReadTimeoutMs: 3000, foregroundRevalidateAfterMs: 60000 },
    // Commercial status policy (topic 8). Safe defaults: a proposal does not count as offerable.
    availabilityPolicy: { proposalCountsAsOfferable: false, reservationCountsAsUnavailable: true, soldVisibleOnMap: true, blockedVisibleOnMap: true,
      unavailableVisibleOnMap: true, unknownVisibleOnMap: true, allowSoldReopen: false, simulateNonOfferable: true },
    features: { solarAnalysis: true, financialSimulation: true, aerialView: true, recommendations: true, customerMode: true, routes: true, gallery: true },
    priceTables: [{
      id: 'lancamento-2026-10', developmentId: 'viva-juara', version: '2026-10-06', name: 'Tabela de lançamento', sourceId: 'price-table-v1',
      createdAt: '2026-10-06', validFrom: null, validUntil: null, // validity not informed
      pricePerM2: 299000 / 250, downPaymentDefault: 0.12,
      // Plans exactly as presented at launch. rate is monthly; annual parcels start in month 11.
      plans: [
        { id: 'P144', name: 'Normal 144x', kind: 'PRICE', months: 144, rate: 0.008, desc: 'Tabela Price 0,8% a.m. + IGP-M anual' },
        { id: 'P144A', name: 'Normal com anuais', kind: 'PRICE_ANNUAL', months: 144, rate: 0.008, annualCount: 11, firstAnnualMonth: 11,
          monthlyShare: 2383 / ((0.008 / (1 - Math.pow(1.008, -144))) * 299000 * 0.88), desc: '1ª anual em novembro do ano seguinte + IGP-M' },
        { id: 'I18', name: 'Investidor 18x', kind: 'INSTALLMENTS', months: 18, discount: 0.10, desc: '10% de desconto, sem juros e sem correção' },
        { id: 'I36', name: 'Investidor 36x', kind: 'INSTALLMENTS', months: 36, discount: 0.05, desc: '5% de desconto, sem juros, com IGP-M' }
      ]
    }],
    currentPriceTableId: 'lancamento-2026-10',
    sources: [
      { id: 'official-plan-v1', type: 'PLAN', name: 'Planta de situação do parcelamento (PDF oficial)', version: '1', date: null, precision: 'Escala 1:1000; áreas oficiais com duas casas decimais', description: 'Quadro de áreas, contorno dos lotes, áreas comuns, servidões e norte.' },
      { id: 'plan-geometry-v1', type: 'CALCULATION', name: 'Medidas calculadas sobre a planta oficial', version: '1', date: '2026-10-06', precision: 'Cerca de 0,3 m (espessura do traço)', description: 'Frente, fundos, laterais e profundidade medidos nos polígonos vetorizados do PDF.' },
      { id: 'kmz-v1', type: 'GIS', name: 'Implantação georreferenciada (KMZ)', version: '1', date: null, precision: 'Cerca de 0,12 m por pixel', description: 'Coordenadas, vias, áreas verdes e distâncias.' },
      { id: 'aerial-v1', type: 'IMAGE', name: 'Ilustração aérea de divulgação', version: '1', date: null, precision: 'Ilustrativa; posição aproximada', description: 'Usada para o que existe fora do perímetro (mata, área aberta).' },
      { id: 'launch-event-v1', type: 'EVENT', name: 'Gravação do evento de lançamento', version: '1', date: null, precision: 'Declarações verbais', description: 'Condições de pagamento, entrada padrão, muro e gradil.' },
      { id: 'price-table-v1', type: 'PRICE_TABLE', name: 'Tabela de preço confirmada pelo corretor', version: '2026-10-06', date: '2026-10-06', precision: 'Exata', description: 'Lote de 250 m² por R$ 299.000 (R$ 1.196/m²).' },
      { id: 'analysis-v1', type: 'ANALYSIS', name: 'Modelo de análise do Viva Juara', version: '2026-10-06', date: '2026-10-06', precision: 'Estimativa comparativa', description: 'Scores, classes, ruído, privacidade, trânsito e alertas.' },
      { id: 'solar-model-v1', type: 'ANALYSIS', name: 'Cálculo astronômico para Serra/ES', version: '1', date: '2026-10-06', precision: 'Não considera sombra de vizinhos, muros ou árvores', description: 'Posição do sol por época do ano e hora.' },
      { id: 'renders-v1', type: 'IMAGE', name: 'Imagens de divulgação do empreendimento', version: '1', date: null, precision: 'Ilustrativas', description: 'Perspectivas das áreas comuns.' }
    ],
    pendingData: [
      ['Disponibilidade (espelho de vendas)', 'Sem a lista de reservados e vendidos, todos os lotes aparecem como "sem informação".'],
      ['Nomes oficiais das ruas', 'A planta traz apenas ruas projetadas.'],
      ['Topografia (aclive e declive)', 'Falta o levantamento planialtimétrico.'],
      ['Drenagem', 'Falta o projeto de drenagem.'],
      ['Regulamento construtivo', 'Recuos, taxa de ocupação, coeficiente e permeabilidade dependem dele.'],
      ['Ventilação', 'Não há dados de vento para o local.'],
      ['Fechamento dos fundos', 'Muro e gradil foram citados no evento e precisam de confirmação.']
    ],
    facts: {
      areas: [['Área total da gleba', 268390.76, null], ['Lotes residenciais', 154096.70, 57.42], ['Áreas condominiais (13)', 15029.10, 5.60], ['Parques florestais', 33138.11, 12.35],
        ['Pistas de rolamento', 33251.01, 12.39], ['Calçadas e faixa de serviço', 32556.74, 12.13], ['AC 6, estação elevatória (EEEB)', 319.10, 0.12]],
      avenueNote: 'A planta prevê ampliação da Av. Porto Dourado, com 3.228,11 m² a serem doados ao município.'
    },
    // Photos of the common areas (img_list.json titles). Matched by the photo title, not by a surveyed position:
    // which leisure item sits where inside the club still needs confirmation from the developer.
    poiImages: { GATE: ['Portaria'], SQUARE: ['Praça'], PLAYGROUND: ['Playground'],
      CLUB: ['Bar lounge', 'Piscina e deck', 'Deck sunset', 'Área gourmet', 'Playkids', 'Campo society', 'Beach tennis', 'Pista de cooper', 'Mercadinho', 'Pet place'],
      note: 'Imagens ilustrativas do material de lançamento, associadas pelo nome da área. A posição exata de cada item ainda precisa ser confirmada com a loteadora.' },
    // Common areas from the official plan; positions in map units.
    pois: [
      { id: 'AC3', type: 'GATE', name: 'Portaria', areaM2: 417.50, at: [376.1, 729.4], zoom: 0 },
      { id: 'AC8', type: 'CLUB', name: 'Clube', areaM2: 6806.33, at: [895.3, 258.8], zoom: 0 },
      { id: 'AC9', type: 'PARK', name: 'Parque florestal 1', areaM2: 3648.70, at: [936.4, 173.9], zoom: 0 },
      { id: 'AC10', type: 'PARK', name: 'Parque florestal 2', areaM2: 8367.12, at: [1114.9, 298.8], zoom: 0 },
      { id: 'AC12', type: 'PARK', name: 'Parque florestal 3', areaM2: 21122.29, at: [1682.9, 1024.0], zoom: 0 },
      { id: 'AC7', type: 'SQUARE', name: 'Praça', areaM2: 1915.57, at: [867.3, 359.8], zoom: 1 },
      { id: 'AC5', type: 'SQUARE', name: 'Praça', areaM2: 1785.40, at: [497.6, 637.8], zoom: 1 },
      { id: 'AC4', type: 'SQUARE', name: 'Praça', areaM2: 462.56, at: [517.5, 703.6], zoom: 1 },
      { id: 'AC11', type: 'PLAYGROUND', name: 'Playground', areaM2: 576.24, at: [1564.5, 629.2], zoom: 1 },
      { id: 'AC13', type: 'PLAYGROUND', name: 'Playground', areaM2: 560.49, at: [1400.8, 1459.1], zoom: 1 },
      { id: 'AC6', type: 'PUMP_STATION', name: 'EEEB', areaM2: 319.10, at: [714.2, 677.1], zoom: 1 },
      { id: 'AC1', type: 'PARKING', name: 'Estacionamento', areaM2: 1142.06, at: [304.2, 691.8], zoom: 1 },
      { id: 'AC2', type: 'ADMIN', name: 'Administração', areaM2: 1043.85, at: [402.7, 794.2], zoom: 1 }
    ],
    roads: [{ id: 'av-porto-dourado', name: 'Av. Porto Dourado', line: [[-112.5, 462.5], [54.3, 556.1], [228.4, 685.8], [359.0, 844.5], [446.1, 1046.6], [504.2, 1234.3]] }]
  };
  const DEVELOPMENTS = [VIVA_JUARA];
  return Object.freeze({ TENANT, DEVELOPMENTS });
})();
