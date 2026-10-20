# Relatório técnico consolidado: tópicos 3 a 10

Plataforma de Inteligência Comercial para Loteamentos. Empreendimento de referência: Viva Juara (498 lotes). Data: 2026-10-07.

Este relatório descreve o que o código em `plat/` faz hoje. Cada tópico segue a lista de itens que a sua especificação pede no relatório final. Detalhes ficam nos documentos de referência:

| Documento | Tópico |
|---|---|
| [DOMAIN_MODEL.md](DOMAIN_MODEL.md) | 5 |
| [LEGACY_FIELD_MAPPING.md](LEGACY_FIELD_MAPPING.md), [LEGACY_FIELD_MAPPING.json](LEGACY_FIELD_MAPPING.json), [unmapped_fields.json](unmapped_fields.json) | 5 |
| [LOT_DOMAIN_MODEL.md](LOT_DOMAIN_MODEL.md) | 6 |
| [DATA_LIFECYCLE.md](DATA_LIFECYCLE.md), [field-lifecycle-report.json](field-lifecycle-report.json) | 7 |
| [AVAILABILITY_DOMAIN.md](AVAILABILITY_DOMAIN.md) | 8 |
| `plat/backend/docs/BACKEND_ARCHITECTURE.md`, `DATA_MIGRATION_V2.md`, `DEPLOYMENT_V2.md`, `openapi.json` | 9 |
| [OFFLINE_CACHE_ARCHITECTURE.md](OFFLINE_CACHE_ARCHITECTURE.md) | 10 |

Os arquivos JSON desta pasta foram gerados executando os módulos reais de `plat/src` (carregados pelo `plat/tests/harness.js`) sobre `dash/lots.json`.

## Regras de dados que valem para todos os tópicos

- Disponibilidade: `UNKNOWN` para os 498 lotes. Não existe espelho de vendas; `st` é nulo no lots.json e o manifest publica `availabilityRevision: null`.
- Preço por m²: R$ 1.196 (tabela de lançamento `lancamento-2026-10`, versão `2026-10-06`: lote de 250 m² por R$ 299.000). Preço do lote = área × R$ 1.196, status calculado. Validade da tabela não informada.
- Todo valor carrega um status: confirmado (`CONFIRMED`), calculado (`CALCULATED`), estimado (`ESTIMATED`), necessita confirmação (`TO_CONFIRM`), não disponível (`UNKNOWN`). Complementares: `NOT_APPLICABLE`, `CONFLICTED`.
- A análise não promete valorização. Liquidez e valor relativo são notas comparativas e dizem isso no próprio significado; a comparação traz o texto "É leitura da análise, não promessa de valorização".
- Nenhum dado de negócio foi inventado: campos sem origem ficam `null` e aparecem como "Não disponível".

## Mapa do código

```
plat/
├── src/
│   ├── prelude.js                 cria o global App
│   ├── domain/                    enums.js · model.js (Field Registry) · rules.js · lot.js (Lot, LotFactory) · availability.js
│   ├── config/                    developments.js (DevelopmentConfig) · presentation.js (hierarquia da informação)
│   ├── data/                      legacyAdapter.js · lifecycle.js · repositories.js · apiSource.js · offline.js
│   ├── services/                  finding.js (busca, filtros, recomendação) · scoring.js · finance.js · solar.js · layers.js · comparison.js · share.js
│   ├── state/                     store.js (estado, router, analytics) · selectors.js
│   ├── utils/                     formatters.js · i18n.js
│   ├── presentation/              viewmodels.js · map.js · panels.js · overlays.js · dom.js · app.js · shell.html · styles.css
│   └── sw.template.js             Service Worker
├── scripts/                       build.js (gera dash/index.html e dash/sw.js) · build-data.js (gera dash/manifest.json e dash/commercial.json)
├── tests/                         harness.js (carrega os módulos em vm) · backend/ (testes do tópico 9)
├── backend/                       API V2 (tópico 9)
└── docs/                          esta documentação
```

Os módulos registram-se no global `App`. `scripts/build.js` concatena os módulos na ordem do harness, confere a sintaxe de cada um (`node --check`), embute CSS e HTML e grava `dash/index.html`; a versão do app é o hash do HTML.

---

## Tópico 3. Separar a arquitetura de dados da arquitetura de apresentação

**O que foi feito.** O fluxo passou a ser `lots.json → Repository → Normalizer → Domain Model → Service / Selector → ViewModel → UI`. A interface não lê o lots.json nem chaves legadas.

| Item pedido | Situação |
|---|---|
| Arquivos criados | todos os módulos de `plat/src` listados no mapa do código; `plat/scripts/build.js`, `plat/scripts/build-data.js`; `plat/tests/harness.js` |
| Arquivos alterados | `dash/index.html` passou a ser gerado pelo build; `dash/sw.js`, `dash/manifest.json` e `dash/commercial.json` também são gerados. Versões anteriores do painel continuam em `dash/index_v1.html` e `dash/index_v2_before_ws.html` |
| Novos models | `domain/enums.js`, `domain/model.js` (Field Registry), `domain/lot.js` (Lot, LotFactory), `domain/rules.js` (alertas, destaques, rankings), `domain/availability.js` |
| Novos repositories | `DevelopmentRepository`, `LotRepository` (alias `JsonLotRepository`), `CommercialRepository`, `SpatialRepository`, `AssetRepository` (`data/repositories.js`); `LocalCacheRepository` (`data/offline.js`); `ApiAvailabilityRepository`, `ApiCommercialRepository`, `ApiDevelopmentRepository` (`data/apiSource.js`) |
| Novos adapters | `App.legacy` (LegacyLotAdapter), `normalizeAvailability` (LegacyAvailabilityAdapter), fontes `JsonLotSource`, `ApiLotSource`, `HybridLotSource`, `JsonRemote`, `fromLayerSource` |
| Novos viewmodels | `presentation/viewmodels.js`: `formatField`, `fieldVM`, `statusVM`, `priceNote`, `connectivityVM`, `tooltipVM`, `quickViewVM`, `detailsVM`, `comparisonVM`, `simulationVM`, `shareVM`, `glossary` |
| Componentes migrados | mapa (`map.js`, recebe lotes e valores de camada), painel Encontrar, Quick View, ficha, simulação, sol (`panels.js`), Comparar, Clientes, Empreendimento, compartilhamento (`overlays.js`) |
| Acessos diretos ao lots.json removidos | somente `data/repositories.js` (`JsonLotSource`) e `data/offline.js` (`JsonRemote`) buscam o arquivo; a busca por `fetch(`, `lots.json`, `raw.` e `getLegacyLotField` em `src/presentation`, `src/services` e `src/state` não encontra ocorrências |
| Formatters centralizados | `utils/formatters.js` (números, moeda, datas, níveis) e `utils/i18n.js` (rótulos de enum); o domínio não guarda texto formatado |
| Seleção de fonte de dados | `createLotRepository` escolhe JSON ou API pela flag `dataSource.useBackendData` (hoje `false`) |
| Testes executados | ver a seção Testes |

**Decisões.** Sem framework novo e sem dependência pesada (JavaScript puro, um arquivo HTML gerado). O backend reutiliza os mesmos módulos de domínio. Estado da interface (`App.store`) não guarda dados de lote; guarda ids e `dataRevision`.

**Pontos ainda legados.**

- `App.legacy.getLegacyLotField`: mantido como `@deprecated`, só para relatório e depuração.
- O lots.json continua com as chaves curtas antigas; o normalizador é o único ponto que as conhece.
- Migração das chaves antigas do localStorage (`ws-state`, `vj-favs`, `vj-ent`, `vj-sun-s`, `vj-sun-h`, `vj-sel`, `vj-bg2`) em `store.restore`.
- A pasta `src/viewmodels/` está vazia; os ViewModels ficam em `src/presentation/viewmodels.js`.
- O comentário de `services/solar.js` cita `presentation/solar.js`, que não existe (o desenho do sol está nos módulos de apresentação existentes).
- `dash/lots_v2_backup.json` (53 chaves por lote) convive com `dash/lots.json` (63 chaves; as 10 a mais são `sideE`, `sideD`, `edgeF`, `edgeB`, `dpark`, `vzE`, `vzD`, `did`, `st`, `fr`). O app lê só o `lots.json`.

**Riscos.** Baixos: a separação é verificável por busca no código e pelo shadow compare do backend (mesmos valores pelos dois caminhos).

**Decisões humanas pendentes.** Nenhuma específica deste tópico.

---

## Tópico 4. Modelo hierárquico de informação

**O que foi feito.** Cinco níveis de informação em `presentation/viewmodels.js`: 0 empreendimento, 1 mapa (tooltip), 2 Quick View, 3 ficha por seções, 4 evidência (popover de proveniência). As regras centrais estão em `config/presentation.js` e podem ser sobrescritas por empreendimento.

| Item pedido | Situação |
|---|---|
| Componentes criados | `quickViewVM`, `detailsVM`, `fieldVM`, `tooltipVM`, `comparisonVM`; `panels.quick`, `panels.details`, `panels.provPopover`; `config/presentation.js` |
| Componentes alterados | painel do lote (`panels.js`), comparação (`overlays.js`), mapa (tooltip) |
| Campos do Quick View | título (quadra e lote); status com nota de atualidade; Área, Preço (com nota de atualidade), Preço por m²; score principal do objetivo e posição no ranking (corretor); 3 atributos-chave do objetivo (corretor); fatos em linguagem simples (Ruído provável, Privacidade, Sol do norte); até 3 destaques; alertas; "Mais indicado para" (corretor); compatibilidade com o cliente quando há preferências; ações (ação principal por status, Ver detalhes, Simular, Sol no lote, Comparar, Favoritar, Compartilhar, rotas) |
| Tooltip do mapa | quadra e lote, área, preço ou "Preço não disponível", status, compatibilidade quando houver ranking |
| Seções da ficha | Resumo (16 campos fixos), Geometria, Localização, Vizinhança, Mobilidade, Conforto, Construção, Comercial (inclui disponibilidade), Inteligência (só corretor), Fontes (identificação, versões, fontes usadas no lote) |
| Regras de prioridade | P0 a P3 do Field Registry; dentro de cada seção os campos são ordenados por prioridade; no modo cliente os campos P3 e os campos de `hiddenFields.client` ficam ocultos (66 campos do registro) |
| Regras de alertas | severidade é dado de domínio (`domain/rules.js`): servidão, restrição construtiva, área técnica e avenida = IMPORTANTE; ruído, tráfego, privacidade, geometria, outros = ATENÇÃO; sol da tarde = INFORMATIVO. O Quick View mostra sempre CRÍTICO e IMPORTANTE e completa com ATENÇÃO até 2 alertas, com o link "Mais N alertas nos detalhes"; o Resumo e a Inteligência mostram todos; o modo cliente vê só CRÍTICO e IMPORTANTE |
| Regras de proveniência | cada campo da ficha tem um selo com o status (Oficial, Calculado, Estimado, Validar, Não disponível); o popover mostra valor, situação, fonte, método e confiança (estes dois só no corretor), data e significado; a seção Fontes lista as fontes usadas no lote e as versões de dados (corretor) |
| Adaptação mobile | abaixo de 1024 px o painel Encontrar vira gaveta e o painel do lote vira folha inferior com três alturas (92 px, até 52 % ou 460 px, tela cheia menos 64 px) e alça de arraste; comparação vira botão flutuante; abaixo de 700 px o cabeçalho quebra em linhas; ajustes adicionais em 360 px; resumo do lote fixo no topo da ficha (`.dsum`, `position: sticky`) |
| Deep link | `#<dev>.lots.<código>[.<seção>|.simular|.sol]` e `#<dev>.compare.<código>~<código>` (`App.router`) |
| Campos que permaneceram sem categoria | `geometry.polygon`, `geometry.centroid`, `geometry.bounds` (aparecem no mapa, não como linha da ficha) e os virtuais `mobility.routeToGate`, `mobility.routeToLeisure` (botões de rota), `identity.developmentName` (cabeçalho) |
| Campos ausentes | 30 campos armazenados são nulos nos 498 lotes e aparecem como "Não disponível" (lista em DOMAIN_MODEL.md, seção 9); cada seção mostra "N de M com dado" |
| Testes executados | ver a seção Testes |

**Não implementado / pendente.** Busca dentro da ficha (item 83 da especificação). Analytics só em memória (`App.analytics`, eventos `lot_selected`, `filter_changed`, `layer`, `mode`, `preset`, `share_opened`), sem envio.

**Riscos.** O modo cliente depende da lista `hiddenFields.client`; um campo novo sensível precisa ser incluído nela.

**Decisões humanas pendentes.** Quais atributos-chave mostrar por objetivo (hoje definidos em `config/presentation.js`) e se o cliente deve ver alertas de nível ATENÇÃO.

---

## Tópico 5. Campos de cada lote em domínios funcionais

**O que foi feito.** Field Registry único em `domain/model.js`, normalizador legado em `data/legacyAdapter.js`, vocabulários em `domain/enums.js`, rótulos em `utils/i18n.js`. Filtros, camadas do mapa, comparação e ficha usam fieldKeys canônicos.

| Item pedido | Resultado |
|---|---|
| Número total de campos encontrados | lots.json: 63 chaves de topo (incluindo o contêiner `nt`) e 14 subchaves de `nt`, presentes nos 498 registros. Registro canônico: 138 campos (135 armazenados, 3 virtuais) |
| Campos por domínio | Identificação 9, Geometria 21, Localização 16, Vizinhança 12, Mobilidade 9, Conforto ambiental 18, Construção 14, Comercial 10, Inteligência 18, Proveniência 2, Disponibilidade 9 |
| Campos duplicados | `c` (média dos vértices) duplica o polígono: descartado e substituído por centroide de área; `pos` e `forma` repetem a informação de esquina |
| Campos ambíguos | `forma` ("Esquina" não é formato), `vista` (tipo + permanência), `fundo` (vizinho + fonte + perímetro), `fech` (fechamento + certeza), `lat_s` (dois valores) |
| Campos conflitantes | 35 lotes com frente usada (`fr`) diferente da largura na frente (`wf`) em mais de 0,5 m; registrados em `conflictingFields` (LEGACY_FIELD_MAPPING.json) |
| Campos órfãos (não mapeados) | 4: `c`, `nt.vent`, `nt.topo`, `nt.pc` (unmapped_fields.json, com motivo e ação) |
| Campos não disponíveis | 30 com status padrão `UNKNOWN` no registro; 30 armazenados nulos nos 498 lotes |
| Campos calculados / estimados / confirmados (padrão do registro) | 54 / 34 / 17; mais 2 necessita confirmação e 1 não aplicável |
| Mapeamento legado → canônico | LEGACY_FIELD_MAPPING.md e .json: 72 campos legados mapeados |
| Arquivos criados | `domain/model.js`, `domain/enums.js`, `data/legacyAdapter.js`, `utils/i18n.js`; documentos desta pasta |
| Arquivos alterados | consumidores migrados para fieldKeys: `services/finding.js` (13 filtros, cada um com `fieldKey`), `services/layers.js` (14 camadas), `presentation/viewmodels.js` |
| Testes executados | ver a seção Testes |
| Problemas encontrados | os listados em ambíguos e conflitantes; 3 notas sempre nulas na origem; `st` nulo em todos os registros |

**Decisões.** Extensões de enum necessárias ao dataset foram marcadas "ext" no código (`EXTERNAL_GREEN`, `COMMON_AREA`, `CONDO_BOUNDARY`, `LOCAL_QUIET`, `INTERNAL_ROAD`). Texto legado fora do vocabulário vira `null` com aviso, nunca palpite. Nível e nota do mesmo tema (ex.: privacidade) são campos separados.

**Pontos que exigem decisão humana.** Regra da frente nos 35 lotes com variante; formato real dos 54 lotes de esquina (hoje `UNKNOWN`); origem futura de ventilação, topografia, drenagem e regulamento construtivo; nomes oficiais das ruas.

---

## Tópico 6. Entidade canônica Lot

**O que foi feito.** `domain/lot.js` define o agregado, a `LotFactory`, a validação, a serialização determinística, a reidratação validada, a atualização por cópia e os índices.

| Item pedido | Situação |
|---|---|
| Estrutura final de Lot | `identity, geometry, location, surroundings, mobility, environmental, construction, commercial, intelligence, availability, provenance, metadata`; `SCHEMA_VERSION = '1.0'` |
| Enums criados | 36 vocabulários em `domain/enums.js` (tabela em DOMAIN_MODEL.md, seção 7) |
| Schemas criados | o schema é derivado do Field Registry (tipos, unidades, enums, nulidade) mais os invariantes do agregado; snapshots por camada validados por `validateSnapshot` |
| Invariantes | 14, listados em LOT_DOMAIN_MODEL.md, seção 3 (estrutura completa, campos estruturais obrigatórios, tipos, faixas, polígono, formato do ID, versão do schema, proveniência, inteligência, sem campos fora do contrato, ID único, identidade imutável, sem padrão perigoso, status independente) |
| Arquivos criados | `domain/lot.js` |
| Arquivos alterados | `data/repositories.js` (o repositório só devolve Lots), consumidores de `services/` e `presentation/` |
| Consumidores migrados | mapa, filtros, busca, recomendação, scores, simulação, solar, comparação, compartilhamento, ficha; backend (importador, API, shadow compare) |
| Consumidores ainda legados | nenhum consumidor recebe o objeto bruto; restam `getLegacyLotField` (deprecated) e as funções `updateLot*`, que existem mas não são usadas |
| Campos com conflito | 35 variantes de medição da frente (seção do tópico 5) |
| Campos nulos | 30 campos armazenados nulos em todos os lotes; `metadata.createdAt` e `updatedAt` sempre nulos |
| Warnings de validação | 0 no dataset atual (498 válidos, 0 rejeitados) |
| Testes executados | ver a seção Testes |
| Regressões encontradas | nenhuma registrada; paridade JSON × API 498/498 (tópico 9) |

**Pontos que exigem validação humana.** Os mesmos do tópico 5 sobre medidas e esquinas. O aviso `UNKNOWN_PROVENANCE` está declarado e não é emitido; decidir se deve existir.

---

## Tópico 7. Dados estáticos, versionáveis e dinâmicos

**O que foi feito.** `data/lifecycle.js` separa logicamente o lots.json em quatro snapshots (static, analysis, commercial, availability) a partir do `dynamicType` do registro; o `LotComposer` monta os Lots; o `LotRepository` tem um canal de atualização por domínio com validação, comparação de versão, diff, recomposição parcial e troca atômica.

| Item pedido | Resultado |
|---|---|
| Campos STATIC | 78 (74 na camada `static`, 3 virtuais, `metadata.schemaVersion`) |
| Campos VERSIONED | 41 |
| Campos DYNAMIC | 19 (10 comercial, 9 disponibilidade) |
| Campos híbridos | 4: `mobility.gateProximity`, `mobility.nearMainAccess`, `intelligence.notes.gate` (análise, dependem de `mobility.routeDistanceToGateM`, estático) e `commercial.price` (dinâmico, depende de `geometry.areaM2`, estático) |
| Campos ambíguos | nenhum sem classificação: todo fieldKey tem `dynamicType` |
| Versões criadas | `staticDataVersion = 2026-10-06.1`, `analysisVersion = 2026-10-06`, `priceTableVersion = 2026-10-06` (revisão comercial 1), revisão de disponibilidade 0; cada Lot leva `metadata.dataVersions` |
| Estratégia de cache | memória por camada e versão (`DataCache`), IndexedDB por versão (tópico 10), ETag no backend (tópico 9) |
| Estratégia de invalidação | por domínio e por empreendimento, nunca global (`DataCache.invalidate(kind, dev)`); static e analysis por troca de versão; dinâmico por revisão |
| Estratégia de fallback | tabela embutida marcada `STALE` quando o `commercial.json` falha; disponibilidade `UNKNOWN` sem feed; snapshot inválido não substitui o anterior; camada de API inválida vira nula (DATA_LIFECYCLE.md, seção 10) |
| Campos derivados e dependências | 14 campos com `dependsOn`; `impactOf(fieldKey)` devolve derivados e consumidores (DATA_LIFECYCLE.md, seção 7; field-lifecycle-report.json) |
| Arquivos criados | `data/lifecycle.js`; `scripts/build-data.js` (`commercial.json`, `manifest.json`) |
| Arquivos alterados | `data/repositories.js` (canais `applyStructuralUpdate`, `applyAnalyticalUpdate`, `applyCommercialUpdate`, `applyAvailabilityUpdate`, `applyPriceTable`, `applyAvailabilityFeed`, `touch`) |
| Testes executados | ver a seção Testes |
| Regressões | nenhuma registrada |

**Riscos.** Os três campos híbridos da análise não são recalculados numa correção estrutural isolada. Um `commercial.json` republicado com a mesma `version` e revisão maior era recusado; foi corrigido e agora é aplicado (teste em `tests/offline.test.js`).

**Pontos dependentes de decisão humana.** Limites de tempo de atualidade (hoje `null`); validade da tabela de lançamento; se a separação física do lots.json em arquivos por camada é desejada.

---

## Tópico 8. Status comercial como entidade de primeira classe

**O que foi feito.** `domain/availability.js` define o `AvailabilityState`, o adaptador legado, a matriz de transição com máquina de estados, a política por empreendimento e as regras derivadas. O status é um canal dinâmico próprio, composto no Lot e lido pela interface por selectors e ViewModels.

| Item pedido | Resultado |
|---|---|
| Estrutura AvailabilityState | `{ status, updatedAt, sourceId, revision, reservedUntil, proposalId, reason, notes, freshness }` com `validateState` |
| Enum final | `AVAILABLE, RESERVED, PROPOSAL, BLOCKED, SOLD, UNAVAILABLE, UNKNOWN`; motivos `TECHNICAL_REVIEW, COMMERCIAL_HOLD, LEGAL_HOLD, INTERNAL_BLOCK, NOT_RELEASED, DATA_VALIDATION, OTHER` |
| Matriz de transição | AVAILABILITY_DOMAIN.md, seção 4; `SOLD` sem saída normal; ir para `UNKNOWN` sempre permitido; reabertura de vendido só com política, autorização e motivo |
| Políticas | `proposalCountsAsOfferable: false`, `reservationCountsAsUnavailable: true` (sem uso no código), todos visíveis no mapa, `allowSoldReopen: false`, `simulateNonOfferable: true` |
| Campos legados encontrados | `st` (nulo nos 498 registros); o adaptador também aceita `isSold`, `isReserved`, `isBlocked` e `stAt`, que não existem no arquivo |
| Mapeamento | códigos `DISP`, `RES`, `PROP`, `BLOQ`, `VEND`, `INDISP` e equivalentes por extenso; vazio → UNKNOWN; desconhecido → UNKNOWN com aviso; divergência → UNKNOWN com `CONFLICTED_SOURCE` |
| Componentes migrados | camada Disponibilidade do mapa (padrão do empreendimento), filtros por status e "Somente disponíveis", Quick View, ficha, comparação, recomendação comercial, simulação, compartilhamento |
| Selectors criados | `selectAvailabilityCounts`, `selectOfferableLotIds`, `selectHasAvailabilityFeed`, `selectRanking` (ranking comercial), `selectFilteredLotIds` |
| Conflitos | nenhum no dataset (não há status) |
| Testes | ver a seção Testes; verificado também que `SOLD → AVAILABLE` é recusado com `INVALID_TRANSITION` |

**Não implementado / pendente.** Espelho de vendas; persistência do histórico de transições no navegador; transações de reserva e venda (fora do escopo sem backend real); transição automática de reserva vencida (só sinalizada).

**Pontos que exigem decisão humana.** Fonte e formato do espelho de vendas; proposta como ofertável; tratamento de reserva vencida; reabertura de vendido; prazo de validade de um status salvo.

---

## Tópico 9. Migração para arquitetura com backend

Resumo de `plat/backend/docs/` (documentação completa lá; não duplicada aqui).

| Item pedido | Resultado |
|---|---|
| Stack escolhida | Node.js 22 (CommonJS), `node:http` com roteador próprio, PostgreSQL 16, driver `pg` (única dependência), migrations próprias, testes com `node:test` |
| Justificativa | o backend carrega os mesmos módulos de domínio de `plat/src` (normalizador, LotComposer, LotFactory, máquina de estados): nenhuma regra reescrita em outra linguagem; superfície pequena |
| Módulos criados | monólito modular: `developments`, `lots`, `analysis`, `commercial`, `availability`, `assets`, `imports` (controller, service, repository, dto) e `shared` (config, db, domain, http, logging, validation) |
| Tabelas criadas | `developments`, `sources`, `assets`, `static_versions`, `blocks`, `lots`, `analysis_versions`, `lot_analysis`, `price_tables`, `payment_plans`, `lot_prices`, `lot_availability`, `availability_history`, `audit_log`, `import_runs`, `schema_migrations` |
| Migrations | `001_initial_schema.sql`, `002_import_runs.sql`, `003_sources_position.sql`, com scripts `down/` |
| Endpoints | `/health`, `/health/ready`; `/api/v1/developments/{id}/config`, `/map-lots`, `/lots/static`, `/analysis/current`, `/commercial/current`, `/commercial/price-tables/current`, `/availability`, `/assets`; `/api/v1/lots/{id}`, `/lots/{id}/availability/history`; `PATCH /api/v1/lots/{id}/availability` (desligado). Contrato em `openapi.json` |
| Contratos DTO | os quatro snapshots no formato de `App.lifecycle.snapshot`; `LotSummaryDto`, `LotDetailDto`, `DevelopmentConfigDto`, `PriceTableDto`, `AssetDto`, `UpdateAvailabilityRequest` |
| Repositories (frontend) | `data/apiSource.js`: `ApiClient`, `ApiLotSource`, `ApiAvailabilityRepository`, `ApiCommercialRepository`, `ApiDevelopmentRepository` |
| Importer | dry-run em transação revertida, backup verificado por sha256, upsert por checksum (idempotente), versões publicadas imutáveis |
| Dados importados | 498 lotes, 18 quadras, 498 análises, 498 preços, 498 disponibilidades; 2ª execução: 0 criados, 498 inalterados |
| Divergências JSON / API | nenhuma: shadow compare 498/498 idênticos (área, preço, status, scores, classe, alertas, distâncias, geometria) |
| Testes | 47/47 testes do backend passando (contrato da API, importação idempotente, escrita de disponibilidade, migrations, paridade, ApiLotSource) |
| Fallback | `fallbackToJson`: falha da camada estática carrega todo o dataset do lots.json; falha das demais camadas deixa a camada nula (status `UNKNOWN`, preço `null`) |
| Estratégia de deploy | um processo Node atrás de HTTPS, PostgreSQL gerenciado, assets em object storage; pipeline com testes, `migrate:check`, backup, migrations expand → migrate → contract, health check, shadow compare pós-deploy, flag no frontend por último |
| Estratégia de rollback | frontend: `useBackendData: false`; código: redeploy anterior; migrations: nova migration forward (down bloqueado em produção); dados: voltar ponteiros de versão ou restaurar backup (restore testado localmente) |
| Riscos pendentes | nada está publicado; rate limit em memória; escrita protegida só por chave até existir autenticação; PostGIS ainda não usado |
| Decisões humanas necessárias | hospedagem e domínio da API; PostgreSQL gerenciado; object storage/CDN; autenticação antes de ligar escrita; fonte de verdade da disponibilidade; quando desligar o fallback JSON |

**Situação.** Nada foi implantado. O frontend publicado continua com `dataSource.useBackendData: false` (`config/developments.js`).

---

## Tópico 10. Arquitetura híbrida de cache e offline

**O que foi feito.** `data/offline.js` implementa rede com timeout e nova tentativa limitada, conectividade por requisições reais, IndexedDB (ou memória), `LocalCacheRepository`, `AssetCache`, `HybridLotSource`, `SyncManager`, manifest e registro do Service Worker. Detalhes em OFFLINE_CACHE_ARCHITECTURE.md.

| Item pedido | Resultado |
|---|---|
| Armazenamento atual encontrado | antes: localStorage com chaves do primeiro painel (`vj-favs`, `vj-ent`, `vj-sun-s`, `vj-sun-h`, `vj-sel`, `vj-bg2`) e `ws-state` (v2); agora migradas para `ws:<dev>:state` (v3) |
| Stores locais | IndexedDB `ws-cache` v1: `metadata` (key), `staticLots` e `analysisLots` (`[developmentId, version, lotId]`), `dynamicLots` (`[developmentId, lotId]`), `assetsMetadata` (`[developmentId, path]`), `syncState` (`developmentId`) |
| Dados por store | static e analysis por versão (polígono só em `staticLots`); último comercial e status por lote; metadados de assets; resultado da última sincronização; manifest local e metadados de snapshot em `metadata` |
| Cache keys | `${dev}:manifest`, `${dev}:static:${ver}`, `${dev}:analysis:${ver}`, `${dev}:dynamic:commercial`, `${dev}:dynamic:availability`; Cache Storage `ws:${dev}:assets` com `path?v=<checksum>`; shell do SW `ws-shell-<versão>`; localStorage `ws:${dev}:state` `{ v: 3, savedAt, prefs, session }` |
| Manifest | `dash/manifest.json`: versões, revisão comercial, disponibilidade nula, checksums FNV-1a de static e analysis, 498 lotes, assets com sha256, prioridade e estratégia |
| Versões | atual e anterior de static e analysis no cache; troca atômica (gravar → ativar ponteiro → limpar); atualização do manifest local por leitura-modificação-escrita atômica numa transação (`updateManifest`, operação `update`) |
| Estratégias por domínio | static e analysis: cache primeiro com verificação de versão em segundo plano; comercial: rede primeiro, último conhecido `STALE`, tabela embutida como último recurso; disponibilidade: feed anunciado, senão `UNKNOWN`; imagens: Cache Storage por checksum, sob demanda |
| Freshness policy | `FRESH` só com confirmação da fonte nesta sessão; cópia salva e tabela embutida `STALE`; `EXPIRED` por validade ou limite; limites de tempo `null` |
| Sync flow | `SyncManager`: um por empreendimento, debounce de 2 s, espera a primeira gravação em segundo plano do cache antes de sincronizar, gatilhos boot, reconexão, primeiro plano (após 60 s) e manual; cancelamento com `AbortController`; descarte de respostas superadas |
| Service Worker | só app shell e imagens; navegação rede primeiro (6 s) com página guardada; JSON direto para a rede; atualização só quando o usuário aceita |
| Assets precached | a página e `logo.png` |
| Assets lazy | `planta.webp` no primeiro uso, `aerea.webp` quando escolhida; `routes.json` e galeria sem cópia local |
| Fallback | cache corrompido descartado (contagem, checksum, schema) com volta para a versão anterior ou para a rede; IndexedDB indisponível → memória; primeira visita sem rede → mensagem clara |
| User state persistido | preferências e sessão separadas; estado transitório nunca salvo; validado contra os dados carregados (`sanitize`) |
| Testes offline e de reconexão | ver a seção Testes; comportamento verificado no navegador descrito abaixo |
| Problemas de quota | falhas de gravação capturadas e registradas (inclusive `QuotaExceededError`); uso e cota mostrados no painel; sem pedido de armazenamento persistente e sem despejo por prioridade |
| Segurança | sem tokens ou credenciais; preço e status nunca do localStorage; nomes de clientes ficam no localStorage do aparelho (apagáveis); sem criptografia superficial |
| Arquivos criados | `data/offline.js`, `sw.template.js`, `scripts/build-data.js` |
| Arquivos alterados | `state/store.js` (estado v3 por empreendimento, `sanitize`), `presentation/app.js` (boot híbrido, faixa e indicador, limpar dados, atualização do app), `presentation/viewmodels.js` (`connectivityVM`, notas de atualidade), `presentation/overlays.js` (painel "Dados e funcionamento offline"), `config/developments.js` (`offline`, `freshnessPolicy`) |

**Comportamento verificado no navegador.** Em `localhost`, com o Service Worker ativo, recarregar sem rede reabre o mapa e a planta a partir do cache, mostra "Você está offline. Alguns dados comerciais podem estar desatualizados." e o comercial fica `STALE`. Primeira visita sem rede mostra "Conecte-se à internet para carregar este empreendimento pela primeira vez.". No host de artefatos do claude.ai o Service Worker pode não registrar: o IndexedDB continua servindo os dados, mas a página precisa de rede para abrir.

**Riscos.** Host sem Service Worker; modo privado sem cópia; despejo pelo navegador; republicação do `commercial.json` sem nova versão; rotas e galeria indisponíveis offline após recarregar; checksum divergente na primeira carga só registrado (OFFLINE_CACHE_ARCHITECTURE.md, seção 20).

**Decisões pendentes.** Limites de atualidade de preço e status; domínio de hospedagem com Service Worker; nomes de clientes no aparelho; pedido de armazenamento persistente; pacote offline explícito; bloqueio da primeira carga com checksum divergente.

---

## Testes

Backend (tópico 9): 47/47 testes passando em `plat/tests/backend/` (`api.contract.test.js`, `apiSource.test.js`, `availability.write.test.js`, `import.test.js`, `migrations.test.js`, `parity.test.js`); shadow compare JSON × API 498/498 idênticos; importação idempotente (2ª execução: 0 criados, 498 inalterados).

Verificações feitas ao gerar esta documentação (executando os módulos reais pelo harness, sem alterar código): 498 lotes válidos e 0 rejeitados; 0 avisos de normalização; 0 campos legados fora de `LEGACY_KEYS`; 35 variantes de medição; 498 lotes com disponibilidade `UNKNOWN`; `SOLD → AVAILABLE` recusado com `INVALID_TRANSITION`; `commercial` com mesma versão e revisão maior: antes recusado, agora aplicado (corrigido).

Frontend:

Testes automatizados do frontend (`node:test`, em `tests/`, comando `cd tests && npm test`): **219 testes, 219 passam, 0 falham**.

| Arquivo | Testes | Cobertura |
|---|---|---|
| `domain.test.js` | 59 | enums, normalização legada, invariantes da LotFactory, serialização, 33 casos de erro de validação |
| `lifecycle.test.js` | 43 | separação STATIC/VERSIONED/DYNAMIC, `validateSnapshot`, matriz de 23 casos de `freshnessState`, composição, canais de atualização |
| `availability.test.js` | 69 | matriz 7×7 de transições, SOLD → AVAILABLE só autorizado, SOLD → UNKNOWN → AVAILABLE bloqueado, feed sem espelho = UNKNOWN, rótulos por modo |
| `regression.test.js` | 17 | os 498 lotes contra `lots.json` (área, preço = área × 1.196, scores, classe, alertas, distâncias, polígono), checksums do manifest, financiamento de 12 lotes contra a função original do painel v1, completude do Field Registry |
| `offline.test.js` | 31 | stores do IndexedDB, escrita atômica, concorrência do manifest local, cache corrompido, primeira visita offline, boot offline (STALE), cota cheia, corrida de revisões, isolamento entre empreendimentos, limpeza, sanitização do estado, ausência de jargão no modo cliente |

Os testes encontraram 5 defeitos, todos corrigidos nesta entrega: `MemoryBackend.write` ignorava operações `update`/`fail` (else pendurado); comercial com mesma versão e revisão maior era recusado; SOLD → UNKNOWN → AVAILABLE contornava a regra de lote vendido; `validateLot` quebrava com `alerts`/`highlights`/`rankings` que não fossem lista; textos de ajuda de disponibilidade mostravam termos técnicos (UNKNOWN, STALE, snapshot) no modo cliente.

Testes de interface (Playwright, Chromium): fluxo completo (resumo, detalhes com origem do dado, simulação, sol, comparar, compartilhar, empreendimento, modo cliente, filtros, offline e volta) em 320, 390, 800, 1100, 1400 e 1700 px, claro e escuro, sem erro e sem estouro horizontal. Recarga offline pelo Service Worker em localhost: mapa com 498 lotes e planta reabrem do cache, aviso "Você está offline…", comercial STALE. Backend: 47/47 testes passam também depois das correções.

---

## Não implementado / pendente (consolidado)

| Tópico | Item |
|---|---|
| 4 | busca dentro da ficha; envio de analytics |
| 5 | dados de origem para ruas, topografia, drenagem, regulamento, ventilação, APP |
| 6 | `createdAt`/`updatedAt` por lote; uso das funções `updateLot*` (o aviso `UNKNOWN_PROVENANCE` foi implementado em 08/10/2026) |
| 7 | limites de tempo de atualidade; recálculo de campos híbridos numa correção estrutural isolada; aceitar revisão comercial sem nova versão |
| 8 | espelho de vendas; histórico de transições persistido no navegador; reserva e venda; expiração automática de reserva; uso de `reservationCountsAsUnavailable` |
| 9 | hospedagem; cutover; publicação da análise (há só a pré-visualização); PostGIS. Implementados em 08/10/2026: autenticação de administrador, publicação de tabela de preços, pré-visualização de análise e fluxo SSE de disponibilidade |
| 10 | pacote offline explícito; Outbox e Background Sync; pedido de armazenamento persistente; despejo por prioridade e LRU; PWA instalável (cache de rotas e galeria implementado em 08/10/2026) |

O que foi resolvido em 08/10/2026 e o que ainda depende do proprietário estão em [RELATORIO_PENDENCIAS_2026-10-08.md](RELATORIO_PENDENCIAS_2026-10-08.md).

## Decisões humanas pendentes (consolidado)

1. Fonte, formato e frequência do espelho de vendas (afeta tópicos 8, 9 e 10).
2. Limites de atualidade de preço e status e validade da tabela de lançamento.
3. Regra da frente nos 35 lotes com variante de medição e formato dos 54 lotes de esquina.
4. Política comercial: proposta como ofertável, reserva vencida, reabertura de vendido.
5. Hospedagem do frontend (domínio que permita Service Worker) e do backend (API, banco, object storage).
6. Autenticação antes de ligar escrita. A autenticação de administrador (`ADMIN_API_TOKEN`) existe desde 08/10/2026; falta decidir quando definir o token em produção e ligar a escrita.
7. Dados de clientes no aparelho.
8. Quando desligar o fallback JSON.
