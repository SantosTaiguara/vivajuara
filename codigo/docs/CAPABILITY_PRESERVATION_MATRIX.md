# Matriz de preservação de capacidades

> Documento gerado por `node scripts/governanceDocs.js` a partir de `config/governance/capabilities.json` (CapabilityPreservationRegistry). Não editar à mão: altere a fonte e gere de novo.

Prioridade: P0 não pode regredir (bloqueia release) · P1 importante (revisão obrigatória) · P2 útil · P3 opcional/legado.

| ID | Capacidade | Prioridade | Nível | Onde está hoje | Destino | Golden / testes | Modo de migração | Status |
|---|---|---|---|---|---|---|---|---|
| CAP-01-PLANTA | Planta oficial como referência espacial | P0 | EXACT_PARITY | presentation/map.js; geo/geometry.js; config/developments.js (map, geo) | MapRendererAdapter (SVG hoje; Canvas/WebGL só com GeometryParityResult = 0) | golden:map, golden:lots, test:geo46.test.js, test:map.test.js | NEW_ONLY | PRESERVED |
| CAP-02-498-LOTES | 498 lotes clicáveis e identificáveis | P0 | EXACT_PARITY | domain/lot.js; data/legacyAdapter.js; geo/hitTest.js | Lot canônico servido por repositório/API (mesmos IDs) | golden:dataset, golden:map, test:regression.test.js, test:geo46.test.js | NEW_ONLY | PRESERVED |
| CAP-03-SELECAO | Seleção direta no mapa → QuickView | P0 | UX_CONTINUITY | presentation/map.js; geo/hitTest.js; quickview/quickview.js; mobile/sheet.js | MapSelectionController + QuickView ViewModel | golden:map, golden:quickview, test:map.test.js, test:workspace.test.js | NEW_ONLY | PRESERVED |
| CAP-04-ZOOM-PAN | Zoom e pan fluidos | P1 | PERFORMANCE_PARITY | geo/camera.js; presentation/map.js | MapCamera | test:geo46.test.js | NEW_ONLY | PRESERVED |
| CAP-05-BUSCA | Busca rápida de lote (quadra, lote, ID, rótulo) | P0 | EXACT_PARITY | services/finding.js (App.services.search); data/repositories.js searchLots | MapLotIndex local + API opcional | golden:search, test:domain.test.js | NEW_ONLY | PRESERVED |
| CAP-06-FILTROS | Filtros comerciais e técnicos (QUICK/ADVANCED/TECHNICAL) | P1 | IMPROVE_ONLY | filters/filters.js; services/finding.js | FilterEngine (cliente) + filtros server-side quando volume exigir | golden:filters, test:filters.test.js | NEW_ONLY | PRESERVED |
| CAP-07-LAYERS | Camadas temáticas (classe, score, preço, R$/m², sol, ruído, privacidade, verde, tráfego, portaria, lazer, disponibilidade) | P1 | EXACT_PARITY | map/layers.js; services/layers.js | MapLayerRegistry/ScaleDefinition versionados | golden:layers, test:map.test.js | NEW_ONLY | PRESERVED |
| CAP-08-LEGENDA | Legenda contextual | P1 | SEMANTIC_PARITY | map/legend.js | Smart Legend | golden:layers, test:map.test.js | NEW_ONLY | PRESERVED |
| CAP-09-QUICKVIEW | QuickView imediato | P0 | SEMANTIC_PARITY | quickview/quickview.js; presentation/viewmodels.js quickViewVM | QuickView ViewModel único (desktop, sheet, apresentação) | golden:quickview, test:map.test.js | NEW_ONLY | PRESERVED |
| CAP-10-FICHA | Ficha detalhada rica (~70 campos, 138 no Field Registry) | P1 | DATA_PARITY | presentation/viewmodels.js detailsVM; domain/model.js | Lot detail sections + Evidence | golden:dataset, golden:lots, test:regression.test.js, test:domain.test.js | NEW_ONLY | PRESERVED |
| CAP-11-STATUS-DADO | Distinção confirmado / calculado / estimado / não disponível | P0 | SEMANTIC_PARITY | domain/model.js; provenance/*; datastate/dataState.js; utils/i18n.js | AttributeProvenance + DataState | golden:lots, golden:texts, golden:quickview, test:provenance.test.js, test:datastate.test.js | NEW_ONLY | PRESERVED |
| CAP-12-NAO-INVENTAR | Princípio de não inventar dados | P0 | EXACT_PARITY | data/legacyAdapter.js; datastate/dataState.js; utils/formatters.js | NullAndSentinelNormalization (adapters/pipeline) | golden:dataset, golden:texts, test:datastate.test.js, test:regression.test.js | NEW_ONLY | PRESERVED |
| CAP-13-SCORES | Scores, pesos, limiares e classes existentes | P0 | EXACT_PARITY | intelligence/engine.js; intelligence/methodology.js; config/scoring/viva-juara | Analysis module versionado (methodologyVersion) | golden:lots, golden:dataset, test:intelligence.test.js, test:versioning.test.js | NEW_ONLY | PRESERVED |
| CAP-14-RANKINGS | Rankings reproduzíveis | P1 | EXACT_PARITY | services/finding.js (App.services.recommendation); services/scoring.js | Explainable ranking sobre o mesmo resultado | golden:lots, golden:recommendations, test:recommendation.test.js, test:explanation.test.js | NEW_ONLY | PRESERVED |
| CAP-15-SOLAR | Análise solar (orientação, sol do norte, intervalos por estação) | P1 | EXACT_PARITY | services/solar.js; services/layers.js solarNow | Contexto do lote (sai do menu principal, não desaparece) | golden:solar, golden:lots, test:map.test.js | NEW_ONLY | PRESERVED |
| CAP-16-FINANCEIRO | Calculadora financeira (planos, entrada, parcelas, anuais, totais) | P0 | EXACT_PARITY | services/finance.js; config/developments.js priceTables | FinancialSimulationService versionado por PriceTableVersion | golden:finance, test:regression.test.js, test:pricing.test.js | NEW_ONLY | PRESERVED |
| CAP-17-COMPARACAO | Comparação de lotes | P1 | IMPROVE_ONLY | compare/*; services/comparison.js; presentation/viewmodels.js comparisonVM | Comparison domain (sessão, snapshot, avaliação) | golden:comparison, test:compare.test.js | NEW_ONLY | PRESERVED |
| CAP-18-SELECAO-CLIENTE | Seleção de lotes para cliente (favoritos + contexto) | P1 | UX_CONTINUITY | favorites/favorites.js; customer/* | Customer + Favorites (backend com tenant) | test:favorites.test.js, test:customer.test.js | NEW_ONLY | PRESERVED |
| CAP-19-WHATSAPP | Resumo compartilhável / WhatsApp | P1 | SEMANTIC_PARITY | presentation/viewmodels.js shareVM; services/share.js; share/* | ShareService + ShareChannel templates | golden:share, golden:texts, test:share.test.js | NEW_ONLY | PRESERVED |
| CAP-20-LOCAL-RAPIDO | Velocidade de uso local | P0 | PERFORMANCE_PARITY | state/selectors.js; filters/filters.js; map/layers.js | Backend autoritativo sem roundtrip por interação | test:lazyload.test.js | NEW_ONLY | PRESERVED |
| CAP-21-RESILIENCIA | Resiliência local (cache, offline, último estado conhecido) | P1 | IMPROVE_ONLY | data/offline.js; cache/*; sw.template.js | Offline packs explícitos (tópico 49) | test:offline.test.js, test:cache.test.js | NEW_ONLY | PRESERVED |
| CAP-22-MAPA-INTELIGENCIA | Integração mapa ↔ inteligência | P1 | SEMANTIC_PARITY | map/layers.js; quickview/quickview.js | Map consome read models prontos | golden:layers, golden:quickview, test:map.test.js | NEW_ONLY | PRESERVED |
| CAP-23-COR | Visualização por cor (densidade informativa) | P1 | EXACT_PARITY | map/layers.js TOKENS; services/layers.js | Tokens de escala com acessibilidade | golden:layers, test:map.test.js | NEW_ONLY | PRESERVED |
| CAP-24-SEM-JARGAO | Uso sem conhecimento técnico | P1 | UX_CONTINUITY | utils/i18n.js; utils/formatters.js; config/presentation.js | i18n + projeções por modo | golden:texts, golden:quickview, test:compare.test.js | NEW_ONLY | PRESERVED |
| CAP-25-AMBIENTE-UNICO | Um único ambiente para exploração, análise e atendimento | P2 | UX_CONTINUITY | presentation/app.js; layout/workspace.js | Workspace modular (tópico 53) | test:workspace.test.js | NEW_ONLY | PRESERVED |
| CAP-26-DISPONIBILIDADE | Disponibilidade honesta (UNKNOWN ≠ AVAILABLE; preço ≠ status) | P0 | EXACT_PARITY | domain/availability.js | Availability authority no backend | golden:dataset, golden:filters, golden:recommendations, golden:quickview, test:availability.test.js, test:availability2.test.js | NEW_ONLY | PRESERVED |
| CAP-27-PRECO | Preço de tabela (R$ 1.196/m², tabela 2026-10-06) | P0 | EXACT_PARITY | config/developments.js priceTables; scripts/build-data.js; pricing/priceHistory.js | PriceTableVersion publicada imutável | golden:lots, golden:dataset, golden:finance, test:pricing.test.js, test:regression.test.js | NEW_ONLY | PRESERVED |
| CAP-28-ALERTAS | Alertas críticos/importantes visíveis | P0 | SEMANTIC_PARITY | domain/rules.js; rules/* | Rule Engine com paridade legada | golden:lots, golden:quickview, test:rules.test.js, test:intelligence.test.js | NEW_ONLY | PRESERVED |
| CAP-29-CLIENT-SAFE | Modo cliente sem dado técnico/restrito | P0 | SEMANTIC_PARITY | config/presentation.js clientSafeFields; presentationmode/policy.js | ClientSafeProjectionPolicy server-side | golden:quickview, golden:comparison, golden:share, test:presentationmode.test.js, test:share.test.js | NEW_ONLY | PRESERVED |

## Mudanças permitidas e regressões proibidas

### CAP-01-PLANTA — Planta oficial como referência espacial

- Hoje: Mapa desenha os 498 polígonos sobre planta.webp no espaço de pixels da planta oficial (norte para cima), com ruas, quadras e POIs.
- Por que vale: é a referência espacial que o corretor e o cliente reconhecem
- Pode mudar: trocar renderer; LOD/quantização de render (fonte canônica intacta); lazy load da planta
- Não pode regredir: deslocar polígono; simplificar geometria canônica; perder alinhamento com a planta
- Métricas: map.featureCount; map.renderChecksum; lots.*.geometry.polygonFingerprint; t18 TOTAL DIFF
- Classificação do legado: REFACTOR_IN_PLACE

### CAP-02-498-LOTES — 498 lotes clicáveis e identificáveis

- Hoje: Cada um dos 498 lotes tem polígono, ID canônico (VJ-Qx-Lnnnn) e código curto (A1…R16) estáveis e é selecionável.
- Por que vale: identidade de lote é a base de preço, proposta e compartilhamento
- Pode mudar: origem dos dados (JSON → API)
- Não pode regredir: mudar ID; perder lote; lote não clicável
- Métricas: dataset.lotCount = 498 (fixture); dataset.uniqueIds; map.anchorHitMismatches = []
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-03-SELECAO — Seleção direta no mapa → QuickView

- Hoje: Clique/toque no polígono seleciona o lote (outline) e abre o QuickView no painel/bottom sheet sem trocar de página.
- Por que vale: ritmo operacional do atendimento
- Pode mudar: visual do destaque; container (painel, sheet)
- Não pode regredir: navegação pesada de página; seleção perdida ao filtrar
- Métricas: clique → .sel p95 (MAP_PERFORMANCE_BASELINE_REPORT); hit p95 < 1 ms
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-04-ZOOM-PAN — Zoom e pan fluidos

- Hoje: Câmera viewBox com zoom/pan/recenter/fit no lote; pan por translate (tópico 46).
- Por que vale: —
- Pode mudar: algoritmo de câmera
- Não pode regredir: regressão perceptível de fluidez
- Métricas: quadros > 33 ms; long tasks; p95 troca de camada
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-05-BUSCA — Busca rápida de lote (quadra, lote, ID, rótulo)

- Hoje: SearchService.parse resolve "A1", "QA L1", "Q B", "Lote 5" localmente sem roundtrip.
- Por que vale: —
- Pode mudar: índice local; UI do campo
- Não pode regredir: depender de backend para buscar código conhecido; adivinhar lote em consulta ambígua
- Métricas: search.* (kind + códigos)
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-06-FILTROS — Filtros comerciais e técnicos (QUICK/ADVANCED/TECHNICAL)

- Hoje: FilterRegistry com 28 filtros em 3 níveis; desconhecido nunca casa valor; filtro escurece, não remove; seleção mantida.
- Por que vale: —
- Pode mudar: reorganização visual; novos filtros
- Não pode regredir: remover filtro existente; null casar como 0; UNKNOWN casar como AVAILABLE
- Métricas: filters.<cenário>.count / codes
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-07-LAYERS — Camadas temáticas (classe, score, preço, R$/m², sol, ruído, privacidade, verde, tráfego, portaria, lazer, disponibilidade)

- Hoje: MapLayerRegistry + LayerValueProvider + escala → cor por lote; uma camada temática por vez.
- Por que vale: leitura visual instantânea é valor central
- Pode mudar: tokens/acessibilidade com revisão; novas camadas
- Não pode regredir: mudar cor/limiar junto com renderer; perder camada existente
- Métricas: layers.<camada>.lotsByColor; t18 TOTAL DIFF 0
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-08-LEGENDA — Legenda contextual

- Hoje: LegendEngine deriva itens e contagens do mesmo modelo de render (invariante de cobertura).
- Por que vale: —
- Pode mudar: layout, interação
- Não pode regredir: legenda divergente da cor do mapa
- Métricas: layers.<camada>.legend
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-09-QUICKVIEW — QuickView imediato

- Hoje: Identificação, área, status, preço, R$/m², score/classe, destaques, alertas, fatos com status do dado — por modo (corretor/cliente).
- Por que vale: responde a 80% das perguntas sem abrir ficha
- Pode mudar: ações e layout (tópicos 53/56)
- Não pode regredir: esconder status/preço; perder alerta crítico/importante; embelezar estimado
- Métricas: quickview.<lote>.<modo>
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-10-FICHA — Ficha detalhada rica (~70 campos, 138 no Field Registry)

- Hoje: detailsVM agrupa campos por domínio do Field Registry em seções; campos indisponíveis aparecem como tal.
- Por que vale: —
- Pode mudar: reorganizar seções
- Não pode regredir: campo válido sumir sem justificativa (FieldPreservationReport)
- Métricas: dataset.fieldRegistry.count / fingerprint
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-11-STATUS-DADO — Distinção confirmado / calculado / estimado / não disponível

- Hoje: Field Registry + provenance por atributo; rótulos Confirmado/Calculado/Estimado/Não disponível/Requer validação.
- Por que vale: —
- Pode mudar: apresentação (badge, ícone)
- Não pode regredir: esconder incerteza; null virar 0; unknown virar false
- Métricas: lots.*.provenanceStatuses; texts.dataStatus
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-12-NAO-INVENTAR — Princípio de não inventar dados

- Hoje: Ausente = "Não disponível"/UNKNOWN; nenhuma heurística preenche fonte inexistente.
- Por que vale: —
- Pode mudar: nenhuma
- Não pode regredir: default inventado; sentinela virar valor
- Métricas: dataset.nullPriceCount; texts.format.notAvailable
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-13-SCORES — Scores, pesos, limiares e classes existentes

- Hoje: IntelligenceEngine reproduz os 45 campos analíticos publicados dos 498 lotes (metodologia 2026-10-06).
- Por que vale: refactor ≠ recalibração
- Pode mudar: onde roda (cliente/worker/backend)
- Não pode regredir: recalibrar durante refactor; mudar score sem nova methodologyVersion
- Métricas: lots.*.intelligence.scores/class; dataset.classCounts
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-14-RANKINGS — Rankings reproduzíveis

- Hoje: Rankings por tipo (posição/total) publicados por lote e presets legados de "Melhores para…".
- Por que vale: —
- Pode mudar: explicação adicional
- Não pode regredir: mudar ordem sem versão
- Métricas: lots.*.intelligence.rankings; recommendations.legacyPresets
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-15-SOLAR — Análise solar (orientação, sol do norte, intervalos por estação)

- Hoje: SolarAnalysisService: declinação + ângulo horário, UTC-3; lado iluminado por estação/hora; camada "Sol agora".
- Por que vale: —
- Pode mudar: localização na UI (tópico 53)
- Não pode regredir: mudar astronomia/fuso; sumir da ficha
- Métricas: solar.<lote>.<estação>
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-16-FINANCEIRO — Calculadora financeira (planos, entrada, parcelas, anuais, totais)

- Hoje: finance.simulate com planos da tabela 2026-10-06 (P144, P144A, I18, I36), entrada %, Price 0,8% a.m.; paridade com index_v1.html.
- Por que vale: —
- Pode mudar: local de execução; UI progressiva
- Não pode regredir: delta financeiro não explicado; promessa de valorização
- Métricas: finance.simulations.* (tolerância 1e-6)
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-17-COMPARACAO — Comparação de lotes

- Hoje: Até 4 lotes; tabela agrupada, linhas de vencedor por critério (não "melhor lote geral").
- Por que vale: —
- Pode mudar: visual; winner semantics adicionais
- Não pode regredir: perder candidato em navegação; valor mostrado mudar
- Métricas: comparison.<conjunto>.<modo>
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-18-SELECAO-CLIENTE — Seleção de lotes para cliente (favoritos + contexto)

- Hoje: Favoritos formais e contexto de cliente ativo (memória, sem PII persistida).
- Por que vale: —
- Pode mudar: persistência server-side
- Não pode regredir: contexto do cliente resetar inesperadamente; PII em URL/log
- Métricas: testes de continuidade de estado
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-19-WHATSAPP — Resumo compartilhável / WhatsApp

- Hoje: shareVM monta texto (preço, status honesto, sol, ruído estimado, score no modo corretor) + link wa.me.
- Por que vale: —
- Pode mudar: template, canal
- Não pode regredir: afirmar "Disponível" sem status AVAILABLE fresco; perder aviso de incerteza
- Métricas: share.<conjunto>.<modo>.text
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-20-LOCAL-RAPIDO — Velocidade de uso local

- Hoje: Filtro, camada, seleção e comparação rodam no browser; só autoridade dinâmica vai ao servidor.
- Por que vale: —
- Pode mudar: onde vivem os dados
- Não pode regredir: roundtrip por clique/filtro
- Métricas: interativo fast cold ≈2,2 s; troca de camada p95
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-21-RESILIENCIA — Resiliência local (cache, offline, último estado conhecido)

- Hoje: SW + IndexedDB + cache por versão; offline mostra "último estado conhecido", nunca "atual".
- Por que vale: —
- Pode mudar: estratégia de cache
- Não pode regredir: stale apresentado como atual
- Métricas: testes de fallback
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-22-MAPA-INTELIGENCIA — Integração mapa ↔ inteligência

- Hoje: Mesmo lote liga dados, score, preço, sol, ruído e privacidade no mapa e no QuickView.
- Por que vale: —
- Pode mudar: fonte dos read models
- Não pode regredir: valor do mapa ≠ valor do painel
- Métricas: consistência cross-view
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-23-COR — Visualização por cor (densidade informativa)

- Hoje: Paleta verde/terra por classe/score/preço/ruído; cinza neutro para desconhecido.
- Por que vale: —
- Pode mudar: acessibilidade com revisão humana
- Não pode regredir: mudar paleta e renderer ao mesmo tempo
- Métricas: layers.*.colorCounts
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-24-SEM-JARGAO — Uso sem conhecimento técnico

- Hoje: Rótulos de negócio em pt-BR; jargão técnico só no modo técnico.
- Por que vale: —
- Pode mudar: wording com aprovação
- Não pode regredir: vazar termos internos (STALE, snapshot, cache) para o cliente
- Métricas: texts.*
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-25-AMBIENTE-UNICO — Um único ambiente para exploração, análise e atendimento

- Hoje: Mapa como workspace; painéis e overlays sobre o mapa.
- Por que vale: —
- Pode mudar: menu compacto
- Não pode regredir: fragmentar em produtos desconectados
- Métricas: jornadas E2E
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-26-DISPONIBILIDADE — Disponibilidade honesta (UNKNOWN ≠ AVAILABLE; preço ≠ status)

- Hoje: 498 lotes UNKNOWN ("Status não confirmado"); nunca ofertável; preço exibido independe do status.
- Por que vale: —
- Pode mudar: origem do status (espelho de vendas)
- Não pode regredir: UNKNOWN virar AVAILABLE; status inferido de preço
- Métricas: dataset.availabilityStatusCounts; filters.status-available.count = 0; recommendations.engine.*.recommended = 0
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-27-PRECO — Preço de tabela (R$ 1.196/m², tabela 2026-10-06)

- Hoje: Preço = área × R$ 1.196/m² da tabela de lançamento 2026-10-06; entrada padrão 12%.
- Por que vale: —
- Pode mudar: nenhuma sem nova versão de tabela
- Não pode regredir: mudar preço sem versão; prometer valorização
- Métricas: lots.*.commercial.price; dataset.pricePerM2Values
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-28-ALERTAS — Alertas críticos/importantes visíveis

- Hoje: Alertas (avenida, servidão, área técnica, restrição construtiva…) com severidade; importantes aparecem no modo cliente.
- Por que vale: —
- Pode mudar: apresentação (card → badge)
- Não pode regredir: alerta crítico sumir; critério mudar silenciosamente
- Métricas: lots.*.intelligence.alerts; quickview.*.alerts
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

### CAP-29-CLIENT-SAFE — Modo cliente sem dado técnico/restrito

- Hoje: Projeção client-safe (deny by default) no QuickView, comparação, apresentação e compartilhamento.
- Por que vale: —
- Pode mudar: regras mais restritivas
- Não pode regredir: vazar score/técnico no modo cliente
- Métricas: quickview.*.client; comparison.*:client
- Classificação do legado: PRESERVE_BEHAVIOR_REIMPLEMENT

