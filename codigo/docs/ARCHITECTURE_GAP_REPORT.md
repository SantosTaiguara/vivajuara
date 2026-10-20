# Relatório de gaps de arquitetura (atual × referência v1)

Fontes: teste de arquitetura sobre `plat/src` (achados reais, com arquivo e linha em `MODULE_DEPENDENCY_MATRIX.md`), leitura do backend e relatórios dos tópicos 1–51. Prioridade não é fórmula: risco, dependência, impacto no usuário, segurança e alavancagem, com revisão humana (tópico 52 §392).

## Gaps de código (registrados no manifesto, cobertos pela catraca)

| Gap | Área | Atual | Alvo | Severidade | Complexidade | Fase |
|---|---|---|---|---|---|---|
| GAP-ARCH-01 | SECURITY/DOMAIN | `customer/customerDomain.js`, `presentationmode/domain.js`, `share/shareDomain.js` chamam `App.authz` (aplicação) de dentro do domínio | domínio recebe uma decisão/porta de autorização injetada pela camada de aplicação | MEDIUM | MEDIUM | 3.3 / 7.5 |
| GAP-ARCH-02 | DOMAIN | domínio usa serviços legados de aplicação: `map/layers.js` → `App.services.layers` (paleta/escala), `filters/filters.js` → `App.services.search`, `compare/comparisonDomain.js` → `App.services.comparison` e `App.services.share` | primitivas (paleta, normalização de busca, texto de share) movidas para domínio/shared; serviços legados viram fachadas | MEDIUM | MEDIUM | 9.5 |
| GAP-ARCH-03 | ANALYTICS | `compare/comparisonDomain.js` e `data/offline.js` chamam `App.analytics` diretamente | domínio emite evento de domínio; a aplicação traduz em analytics | LOW | LOW | 7.6 |
| GAP-ARCH-04 | ANALYTICS | `analytics/facade.js` (aplicação) usa `App.metricsView` (view) | view model de métricas na aplicação, markup na view | LOW | LOW | 7.6 |
| GAP-ARCH-05 | DATA | `pricing/priceHistory.js` (domínio) lê `App.repos.DevelopmentRepository` | serviço de aplicação passa as versões publicadas ao domínio | MEDIUM | LOW | 1.5 |
| GAP-ARCH-06 | DATA | `data/repositories.js` usa `App.services.search` para `searchLots` | normalização de busca como primitiva compartilhada | LOW | LOW | 1.5 |
| GAP-ARCH-07 | SECURITY | `analytics/client.js` (infra) consulta `App.authz` | contexto de consentimento/permissão injetado pela aplicação | LOW | LOW | 7.5 |
| GAP-ARCH-08 | DOMAIN | `presentationmode/domain.js` usa `App.presentationMode.projection` (aplicação) | projeção chamada pelo runtime; domínio só valida snapshot | LOW | MEDIUM | 6.2 |
| GAP-ARCH-09 | FRONTEND | `layout/responsiveProfile.js` mede `document`/`window.innerWidth` dentro do resolver | adaptador de viewport na view passa medidas ao resolver puro | LOW | LOW | 2.7 |
| GAP-ARCH-10 | ANALYTICS | `App.analytics` atribuído duas vezes (stub em `state/store.js`, fachada em `analytics/facade.js`) | um dono (`analytics/facade.js`); store só chama | LOW | LOW | 7.6 — RESOLVIDO 2026-10-12: `analytics/facade.js` é o único dono; `analytics/early.js` só bufferiza chamadas anteriores (aberto com `||`) |
| GAP-ARCH-11 | DATA | `presentation/app.js` busca `analysis-input.json` pelo nome (via LoadCoordinator, mas o caminho mora no composition root) | `AnalysisInputRepository` em `data/` | MEDIUM | LOW | 1.5 |
| GAP-ARCH-12 | DATA | `domain/availability.js` usa `'lots.json'` como `sourceId` do status legado | sourceId lógico (`legacy-lots-json`) vindo do adaptador | LOW | LOW | 3.5 |
| GAP-ARCH-13 | DOMAIN | ciclo lógico analytics ↔ comparison ↔ presentation-mode ↔ quickview ↔ security ↔ share ↔ workspace; principal aresta: `security/authorization.js` lê `App.store` (estado de UI) e `state/store.js` chama analytics | autorização recebe o contexto do ator por parâmetro; store não conhece analytics | MEDIUM | MEDIUM | 7.5 |
| GAP-ARCH-14 | CONFIG | ciclo development ↔ lot: `config/presentation.js` usa `App.enums`; domínio lê `App.config` | aceitável (config usa vocabulário do domínio); manter sem lógica | LOW | LOW | — |
| GAP-ARCH-24 | OBSERVABILITY | `observability/obsCore.js` (infra) lê `App.store`, `App.authz` e `App.responsive` para montar o contexto (tela, aparelho, modo); `observability/obsPlatform.js` consulta `App.authz` para liberar o painel técnico | contexto e decisão de acesso injetados pelo composition root (`app.js`) — registrado na integração dos tópicos 49–56 | LOW | LOW | 7.6 — RESOLVIDO 2026-10-12: `setContextSources` / `setAccessCheck` injetados por `app.js` |
| GAP-ARCH-25 | PWA/ANALYTICS | `pwa/pwaCore.js` (infra) emite eventos de produto por `App.analytics` | a aplicação traduz eventos técnicos do PWA em analytics (mesmo alvo do GAP-ARCH-03) | LOW | LOW | 7.6 — RESOLVIDO 2026-10-12: `App.pwa.core.setSinks` injetado por `app.js` |

## Gaps do backend (fora da catraca do cliente)

| Gap | Área | Atual | Alvo | Severidade | Fase |
|---|---|---|---|---|---|
| GAP-ARCH-15 | DATA | `analysis`, `commercial` e `availability` escrevem na tabela `developments` (ponteiros current/revisão) | ponteiros em tabela do módulo dono ou atualização via serviço de `developments` | MEDIUM | 3.6 |
| GAP-ARCH-16 | DATA | `lots.repository.js` lê `lot_prices`, `lot_availability`, `lot_analysis` direto | read model explícito (view/consulta) exposto pelos módulos donos | LOW | 3.2 |
| GAP-ARCH-17 | SECURITY | sem provedor de identidade; só tokens de dev | OIDC (D-IDP) | CRITICAL | 3.3 |
| GAP-ARCH-18 | SECURITY | isolamento de tenant na aplicação + FKs; RLS não habilitado; dois IDs de organização | RLS + ID único (D-ORG-ID) | HIGH | 3.4 |
| GAP-ARCH-19 | DATA | disponibilidade sem fonte (498 UNKNOWN); frescor sem política | feed da loteadora com revisão e frescor | HIGH | 3.5 |
| GAP-ARCH-20 | TESTING | testes de banco não rodam (sem senha do Postgres); sem CI | CI com Postgres efêmero | HIGH | 0.5 / 3.1 |
| GAP-ARCH-21 | API | painel lê JSON estático; sem shadow read API × JSON | `apiSource` com shadow read e parity report | MEDIUM | 3.2 |
| GAP-ARCH-22 | DEPLOY | sem pipeline, sem staging definido, sem RPO/RTO | `CI_CD_ARCHITECTURE.md`, D-RPO-RTO | MEDIUM | 7.7 |
| GAP-ARCH-23 | DOCUMENTS | object storage não decidido | Document + FileAsset em storage com ACL no app | MEDIUM | 3.8 |

## Críticos primeiro

GAP-ARCH-17 (autenticação) e GAP-ARCH-18 (tenant) bloqueiam qualquer escrita crítica e qualquer dado de cliente no servidor. GAP-ARCH-19 bloqueia qualquer recomendação comercial real (com 498 UNKNOWN, a recomendação real é vazia por regra). Nenhum desses é corrigível só no código: dependem de decisões humanas (`ROADMAP_DECISION_LOG.md`).

## O que não é gap

Página única com `App` global (ADR-002): a modularidade está nos namespaces e é verificada pelos testes; dividir o bundle é decisão de hospedagem (D-HOSTING), não de arquitetura.
