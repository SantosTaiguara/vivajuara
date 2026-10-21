# Relatório do tópico 63: Google Maps, Entorno e raio máximo de 8 km

Data: 17/10/2026 (atualizado em 20/10/2026). Status: recursos do Google implementados com a flag `location_intelligence_google_maps` **desligada**. Desde 19/10/2026 o visitante vê a troca "Mapa de Lotes | Entorno", com mapa OpenStreetMap sem chave (seção abaixo).

## Imagem aérea ampliada (2026-10-20)

Pedido do proprietário (Edmilson): usar do mapa ilustrado do empreendimento e do entorno **só as partes que a nossa imagem aérea não cobria**, para "dar mais amplitude" à imagem atual.

**Registro (calculado).** A ilustração nova foi registrada sobre a imagem aérea do painel (`aerea.webp`, 2247 × 1587, mesmo referencial em unidades da planta) com 1.713 pontos SIFT coincidentes (inliers) e transformação de similaridade: escala 1,033, rotação 0,08°, resíduo médio ≈ 1 px. Nada dentro do empreendimento foi trocado: onde a imagem antiga tinha conteúdo, ela foi mantida; só as áreas brancas de fora foram preenchidas com a ilustração. A rosa dos ventos da ilustração foi apagada (apontava para o lado errado). Uma faixa de 37 a 39 unidades no extremo leste (x > 2208, fora da ilustração) é um espelho da borda.

**Arquivos.** `aerea.webp` (2247 × 1587, 873.334 bytes; antes 381.144) é a imagem do mesmo recorte, já preenchida. `aerea_ampliada.webp` (2321 × 2321, 1.218.472 bytes) cobre o retângulo da planta x −113…2208, y −327…1994 (1 px = 1 unidade). Os dois entram no `manifest.json` com checksum, então quem já visitou o painel recebe o arquivo novo (`?v=<checksum>` no AssetCache e revisão no Service Worker). O inventário de documentos (`config/documents/viva-juara.json`) foi atualizado (checksum, tamanho e a nova representação derivada).

**Mapa de Lotes.** Nos fundos "Aérea" e "Híbrido" o mapa desenha `aerea_ampliada.webp` no seu retângulo (a câmera já permitia afastar e arrastar além do recorte); a faixa leste que falta é preenchida pelo espelho da mesma imagem (sem download extra). Se a ampliada falhar, o mapa volta para `aerea.webp`. Cores, geometria e câmera dos lotes não mudaram (t18: TOTAL DIFF 0). O pacote offline "Completo" inclui as duas imagens.

**Entorno.** Nova opção **"Aérea ilustrativa"** ao lado de "Planta" (uma de cada vez; tocar na ativa oculta). A imagem é posicionada pela mesma afim planta → latitude/longitude usada para `planta.webp`, composta com o deslocamento do retângulo (−113, −327). Só é baixada quando escolhida, ou automaticamente quando os tiles do OpenStreetMap falham (por exemplo, no visualizador de artefatos), para o mapa continuar mostrando o entorno. O padrão continua "Planta". Nova ação `envAerial` (uiOnly).

**O que é ilustrativo.** Fora do perímetro do empreendimento, a imagem é **arte da incorporadora, não é foto nem geografia exata**: a lagoa, as vias e a vegetação estão em posição aproximada. A interface mostra "Entorno ilustrativo — arte da incorporadora, não é foto" sempre que a aérea ilustrativa está visível, e os detalhes do Entorno repetem o aviso. Distâncias e círculos continuam vindo da coordenada oficial (KMZ), não da ilustração.

## Mapa do entorno sem chave (2026-10-19)

Pedido do proprietário (Edmilson, 19/10/2026): "Use o Kmz e faça a integração dessa aplicação com o maps para que a gente consiga ver a região ao redor do empreendimento". Ainda não existe chave do Google Maps (quando existir, ficará só no ambiente do servidor/hospedagem), e o script do Google não carrega no visualizador de artefatos do claude.ai. Decisão do coordenador: publicar agora com um mapa de fundo **OpenStreetMap, sem chave**, e manter o caminho do Google (tópico 63) para quando houver chave.

**O que o usuário vê.** A troca "Mapa de Lotes | Entorno" aparece para todos (visitante incluído; modos Corretor, Cliente e Técnico), no canto superior esquerdo do mapa. "Entorno" abre, sobre o mapa de lotes, um mapa próprio:
- **Mapa de fundo:** tiles OpenStreetMap de 256 px (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`), zoom 11 a 18, arrastar, roda do mouse, pinça e botões + / − / ⌂ (centralizar na portaria). O mapa recebe foco: setas movem, + e − aproximam e afastam. Atribuição "© OpenStreetMap contributors" sempre visível, com link para https://www.openstreetmap.org/copyright.
- **Planta georreferenciada:** `planta.webp` posicionada por uma transformação afim ajustada (mínimos quadrados) entre os centróides ponderados por área dos polígonos dos 498 lotes na planta (`lots.json`, campo `p`) e a latitude/longitude de cada lote no KMZ (`lat`, `lon`), em metros Web Mercator. Resíduos **calculados**: média 0,26 m, máximo 3,88 m (lote H24); a planta só é sobreposta se o máximo ficar abaixo de 5 m. Verificação independente: os cantos da planta caem sobre o LatLonBox do GroundOverlay do KMZ (N −20,14228, S −20,14923, L −40,20275, O −40,21316) com diferença menor que 5 m. Aplicada como `transform: matrix(...)` CSS; botão "Planta" (mostrar/ocultar) e controle de opacidade. Os contornos dos lotes (mesma afim, a partir do zoom 16) abrem a ficha do lote já existente ao toque.
- **Portaria AC3** (−20,145472, −40,211418; ≈ 10 m; fonte KMZ; validada por Edmilson em 18/10/2026) e **círculos de 2, 4, 6 e 8 km** em linha reta (círculos geodésicos projetados em Mercator), com rótulos "2 km" … "8 km" e a legenda "linha reta; o trajeto por vias é maior".
- **Links "Abrir no Google Maps"** (`https://www.google.com/maps/search/?api=1&query=-20.145472,-40.211418`) e **"Como chegar"** (`https://www.google.com/maps/dir/?api=1&destination=-20.145472,-40.211418`): links comuns, nova aba, `rel="noopener noreferrer"`, só com a coordenada oficial. Nenhum dado do usuário é enviado.
- **Aviso:** "Locais próximos (mercados, escolas, farmácias) aparecem quando a chave do Google Maps for configurada." Nenhum local é listado.
- **Falha do mapa de fundo** (sem rede, CSP do hospedeiro, bloqueio): após 3 tiles com erro e nenhum carregado (ou 10 s sem nenhum), o fundo fica neutro, aparece "Mapa de fundo indisponível nesta visualização" com "Tentar de novo", e nenhum tile novo é pedido. Planta, círculos e links continuam funcionando.

**Capacidade.** `domain.capability()` ganhou `BASE_MAP` e `baseMap` (`AVAILABLE` com a coordenada validada e o provedor OSM; `NOT_VALIDATED` sem coordenada validada, sem centro aproximado; `NOT_CONFIGURED` se o provedor exigir chave). Os recursos do Google continuam `NOT_CONFIGURED` (flag `location_intelligence_google_maps` desligada, sem chave). Novas funções: `baseMap`, `baseMapProvider`, `externalLinks`. Configuração: `baseMapProviders` (OSM: modelo de URL, zoom, atribuição, política de uso de tiles, CSP, dados enviados) e `environmentMap` (círculos, planta, links, textos) em `src/config/surroundings/surroundings.config.js`.

**Política de uso dos tiles (OSMF).** Só os tiles visíveis mais no máximo 1 anel; nada é pré-carregado; tiles fora da vista são descartados; sem download em massa; o Service Worker não trata pedidos de outra origem (não guarda tiles); `referrerpolicy="strict-origin-when-cross-origin"` (só a origem da página); atribuição visível. Sem tiles @2x: em telas HiDPI os tiles ficam em zoom inteiro e em pixels inteiros (sem reamostragem), e planta, contornos e círculos são vetoriais ou de alta resolução.

**Segurança.** CSP: `img-src` ganhou só `https://tile.openstreetmap.org` (`config/security/browserPolicy.json`, com entrada em `thirdParty`); `evaluateCsp` passou a marcar como HIGH qualquer curinga em `img-src`, então `node scripts/securityHeaders.js --check` falha se alguém abrir o domínio. Novas ações (`uiOnlyActions`): `envZoomIn`, `envZoomOut`, `envRecenter`, `envPlan`, `envInfo`, `envRetryTiles`; `envTab` continua uiOnly. Nenhuma chave, nenhum `localStorage`, nenhuma geolocalização do usuário.

**Divisão de código.** Os módulos novos (`surroundings/geoMercator.js`, `surroundings/slippyMap.js`, `surroundings/entornoView.js`) só existem no chunk `surroundings`, carregado no primeiro clique em "Entorno" (voltar para "Mapa de Lotes" nunca o carrega). JS inicial: 2.276.745 bytes (+3,1 kB: troca e controlador). Chunk `surroundings`: cerca de 99,7 kB de JS e 6,0 kB de CSS. O mapa de lotes não é alterado (paridade de cores t18: TOTAL DIFF 0; câmera, camada e cores iguais antes e depois de abrir o Entorno).

**Testes.** `tests/entorno.test.js` (15): ida e volta lat/lon ↔ pixel (zoom 0–20) e índice de tile pela fórmula do wiki OSM; ajuste afim nos 498 lotes (todos os resíduos < 5 m, média < 0,5 m) e cantos do LatLonBox; raio dos círculos no solo (< 1 cm) e em pixels; orçamento de tiles; estados da capacidade; links sem dados do usuário e sem chave; marcação (atribuição, aviso, sem lista de locais, sem script do Google); CSP; Service Worker; permissões; divisão de código; mapa em DOM falso (tiles visíveis + 1 anel, zoom 11–18, falha → FAILED sem novos pedidos).

**Limitações.** No sandbox o proxy bloqueia `tile.openstreetmap.org`; o teste no navegador usou uma rota local de tiles falsos com as mesmas URLs, então o alinhamento visual com ruas reais do OSM não foi visto aqui (o alinhamento numérico com o KMZ foi). No visualizador de artefatos do claude.ai os tiles podem ser bloqueados pela CSP do hospedeiro; nesse caso aparece o aviso de mapa de fundo indisponível. A pinça muda o zoom em passos inteiros. Os locais próximos continuam dependendo da chave do Google e das decisões pendentes abaixo.

## Atualização de 2026-10-18: coordenada oficial registrada

A pedido do proprietário (Edmilson Margon), a coordenada oficial passou a vir do KMZ da incorporadora:

- **Centro:** portaria AC3 "Portaria", latitude -20,145472 e longitude -40,211418. É a entrada do empreendimento, não um centróide dos lotes.
- **Fonte:** KMZ da incorporadora (GroundOverlay "Quintas II", LatLonBox N -20,14228, S -20,14923, L -40,20275, O -40,21316). O ponto AC3 Portaria foi convertido da planta por ajuste afim com os 498 lotes (erro médio de 0,3 m, máximo de 3,9 m).
- **Precisão estimada:** cerca de 10 m.
- **Validação:** feita por Edmilson Margon (proprietário) em 2026-10-18, com base no KMZ. Método `OFFICIAL_KML_KMZ`, status `VALIDATED`, versão `loc-1`.
- **Onde está:** `src/config/surroundings/surroundings.config.js` (`developments['viva-juara'].location`). O domínio (`locationReadiness`) e o servidor leem o centro desse mesmo arquivo.

O Google Maps continua desligado (flag OFF, `googleMapsEnabled: false`) e não há chave. Por isso o visitante continua sem ver nada. No modo Técnico, o Empreendimento passou a mostrar "Entorno ainda não configurado para este empreendimento." no lugar de "Coordenada oficial do empreendimento ainda não validada.". Nenhum script do Google é carregado.

Os testes do painel foram atualizados (`tests/surroundings.test.js`, `tests/adminShell.test.js`). O teste do servidor `backend/tests/surroundings.test.js` ("Viva Juara: no validated official coordinate exists…", linhas 60–68) ainda espera `center = null`. Ele pertence ao agente do servidor nesta rodada e precisa ser atualizado por ele.

As seções abaixo descrevem o estado anterior a essa decisão.

## Resumo
- **Coordenada oficial do Viva Juara: não validada.** O repositório não tem nenhuma coordenada oficial validada. O que existe:
  - a coordenada do cálculo solar em `developments.js#geo`, com 3 casas decimais, sem fonte e sem validação;
  - latitude e longitude por lote, vindas do KMZ `kmz-v1`, que não tem data.

  Nenhum desses dados é o centro do empreendimento. Por isso `center = null` e o status é `UNVERIFIED`, e o Entorno mostra: "Coordenada oficial do empreendimento ainda não validada." Nada foi aproximado: não usamos bairro, centróide nem coordenada gerada.
- O Entorno é uma superfície separada ("Mapa de Lotes | Entorno"). O mapa interno, a geometria, os IDs, os scores e os preços não mudaram.
- O frontend roda os 14 testes de `tests/surroundings.test.js` sem chamar rede. O backend roda os 23 testes de `backend/tests/surroundings.test.js` sem rede e sem Postgres, usando um Google falso.

## Itens exigidos (§646)
| Item | Situação |
|---|---|
| Arquitetura atual do mapa | O mapa é SVG próprio em PIXEL_SPACE (tópico 46). Nenhuma biblioteca Google existia: a busca por @googlemaps, google.maps, maps/places/routes.googleapis não achou nada. |
| Coordenadas geoespaciais | Os lotes têm latitude/longitude vindas do KMZ. O empreendimento não tem centro oficial. |
| Fonte e validação da coordenada | Nenhuma ainda. Status UNVERIFIED (DEVELOPMENT_GEOLOCATION_PROVENANCE.md). |
| DevelopmentLocationConfig | Está em `src/config/surroundings/surroundings.config.js`, com versão `loc-0`. O fluxo DRAFT→REVIEW→APPROVED→PUBLISHED é auditado e vai para a migração 016. |
| Projeto e config Google | Não existem. Variáveis previstas: GOOGLE_MAPS_API_KEY (servidor), GOOGLE_MAPS_BROWSER_KEY e GOOGLE_MAPS_MAP_ID (deploy). |
| Restrições das chaves | Documentadas em GOOGLE_MAPS_API_KEY_STRATEGY.md: referenciador + API no navegador, API + IP no servidor. |
| CSP | Não alterada, porque a flag está desligada. A lista precisa está em GOOGLE_MAPS_SECURITY_POLICY.md. |
| Registro de categorias e tipos | 12 categorias e 26 tipos, conferidos em 16/10/2026 na tabela A oficial (página atualizada em 13/10/2026). Uma categoria com tipo inválido é desligada (LI-DQ-006). |
| Raio máximo e filtros | O servidor aceita só 2/4/6/8 km. Qualquer outro valor dá 422 LOCATION_RADIUS_INVALID (motivo INVALID_RADIUS), sem ajuste silencioso. Um raio acima do aprovado é recusado. |
| Círculo e viewport | `Circle` não é editável, arrastável nem clicável. `fitBounds` usa o envelope do raio, `restriction.latLngBounds` usa o envelope de 8 km e `strictBounds=false`. |
| Endpoint, FieldMask e DTO | `GET …/nearby-places` aceita só category/radius/rank. FieldMask fixo com 8 campos (curinga recusado), `maxResultCount` ≤ 20. O DTO próprio é NearbyPlace. |
| Linha reta e filtro defensivo | Haversine com precisão total. Pós-filtro com tolerância técnica de 1 m (teto de 5 m): 7.999 m entra, 8.100 m sai. |
| Rotas | `POST …/route-estimates`, só DRIVE e só sob demanda. FieldMask `routes.distanceMeters,routes.duration`. O destino precisa ser um Place ID que a busca devolveu (LI-DQ-007). A UX mostra "De carro" e "Tempo estimado". |
| Cache e Place IDs | Só Place IDs são gravados (tabela `surroundings_place_refs`). Resultados, rotas e avaliações não são persistidos. Não há cache de resultados até a revisão dos termos. |
| Termos e atribuição | A revisão dos termos está pendente (`reviewedAt` null bloqueia as chamadas). Todo resultado leva "Dados de locais: Google Maps". |
| Custo | Mapa carregado só quando o Entorno abre. Busca só por categoria escolhida. Single-flight no navegador e no servidor. Transação + AbortController descartam respostas antigas. Rota só sob demanda. Telemetria de uso. Não há preço no código. |
| Cota e limite | Política `rateLimit` por usuário com números **null**: enquanto forem null, o servidor recusa. |
| Observabilidade e erros | Contadores, latência e ProviderUsageMetric. 15 códigos neutros, sem detalhe do Google e sem chave em log. |
| Queda do provedor | Afeta só o Entorno (Places separado de Routes). Offline mostra UNAVAILABLE_OFFLINE. O mapa de lotes não depende do Google. |
| Privacidade | Não usa a localização do usuário nem pede permissão de localização. Nenhum dado de cliente vai ao Google. Os eventos levam só categoryCode e radiusBucket. |
| Mobile e acessibilidade | Abaixo de 760 px, a lista vira a seção inferior. Botões de 44 px com aria-pressed. A informação não depende só de cor e a lista é a interface principal. |
| Feature flag | `location_intelligence_google_maps` = false. As etapas de rollout estão em LOCATION_INTELLIGENCE_ROLLOUT_PLAN.md. |

## Arquivos
Criados:
- **Frontend:** `src/config/surroundings/surroundings.config.js`, `src/surroundings/{surroundingsDomain,surroundingsClient,surroundingsView}.js`, `src/surroundings/surroundings.css`, `tests/surroundings.test.js`.
- **Backend:** `backend/src/modules/surroundings/{index,google.provider,surroundings.repository,surroundings.service,surroundings.controller,surroundings.openapi}.js`, `backend/tests/surroundings.test.js`, `backend/migrations/016_surroundings_location.sql` e o down correspondente.
- **Documentação:** os 22 documentos pedidos no §619 e este relatório.

Alterados (só adições): `config/security/permissions.json` e `docs/PERMISSION_REGISTRY.md` ganharam as permissões `development.location_environment.read` (LOW), `development.location_environment.manage` (HIGH) e `development.location.validate` (CRITICAL), sem concessão a nenhum papel.

## Adiado ou não integrado
- **Rotas no backend:** ainda não estão em `src/app.js`, porque os arquivos são compartilhados. Para integrar:
  - registrar `registerSurroundingsRoutes`;
  - adicionar `ROUTE_POLICIES` em `iam/routePolicies.js`;
  - adicionar as 3 permissões em `iam/permissions.js`;
  - adicionar os códigos de `domain.ERRORS` em `ERROR_CATALOG` e `docs/API_ERRORS.md`;
  - chamar `surroundings.openapi.addPaths` em `openapiDoc.js` e depois rodar `npm run openapi`.
- **Telas de administração:** "Localização & Entorno" (prévia da coordenada, edição de categorias) e o painel "Integrações → Google Maps Platform" ficaram só como serviço e contratos.
- **Integrações futuras:** pontos curados (CuratedLocationPoint), Route Matrix, Apresentação, Comparador e Recomendação ficaram como contrato (`environmentSummary`, `LocationCriterionDefinition` sem score). A folha inferior do tópico 21 também não foi ligada.
- **Testes:** os E2E com o Google real dependem das chaves. Os testes do repositório Postgres dependem da senha do banco.
- **Tópico 62 (backup e DR):** não foi entregue. Falta incluir as tabelas da migração 016 no backup e classificar formalmente a dependência do Google como REFERENCE_ONLY.

## Decisões pendentes
**De negócio:**
- coordenada oficial do Viva Juara e sua fonte;
- quem valida e se o aprovador precisa ser diferente de quem propôs (`requireDistinctApprover`);
- papéis que recebem as permissões novas;
- etapa do rollout;
- manter ou não a categoria de avaliação no FieldMask, porque ela muda o SKU e o custo.

**De provedor e jurídicas:**
- revisão dos termos e da atribuição;
- política de renovação dos Place IDs;
- se resultados podem ter cache curto.

**De segurança e operação:**
- criação do projeto Google Cloud e das chaves;
- restrições, orçamento e alertas de faturamento;
- números do `rateLimit`;
- CSP do servidor de hospedagem.
