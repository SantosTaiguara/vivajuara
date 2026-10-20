# Definições das fases do roadmap

> Documento gerado por `node scripts/governanceDocs.js` a partir de `config/governance/roadmap.json` (RoadmapPhaseDefinition). Não editar à mão: altere a fonte e gere de novo.

## W0 — Baseline e segurança da migração

### 0.1 Architecture Inventory — **DONE**

- Tópicos: 52
- Objetivo: Inventariar a arquitetura real (módulos, App.*, dados, storage, fetch, fórmulas, cache, PWA, auth).
- Pré-requisitos: —
- Entregáveis/evidência: docs/CURRENT_ARCHITECTURE_INVENTORY.md; config/governance/architecture.json (módulo→contexto→camada); tests/governance.test.js: todo arquivo de src/ classificado
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: DOCUMENTATION, TEST
- Critério de saída: todo módulo de src/ tem contexto e camada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S0

### 0.2 Architecture Gap Report — **DONE**

- Tópicos: 52
- Objetivo: Comparar arquitetura atual × referência v1 e classificar gaps.
- Pré-requisitos: 0.1 (HARD)
- Entregáveis/evidência: docs/ARCHITECTURE_GAP_REPORT.md; knownViolations com gapId; architecture fitness test (ratchet)
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: DOCUMENTATION, TEST
- Critério de saída: gaps CRITICAL/HIGH com fase recomendada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S0

### 0.3 Capability Preservation Baseline — **DONE**

- Tópicos: 54
- Objetivo: Registrar as forças atuais com nível de preservação e prioridade.
- Pré-requisitos: 0.1 (HARD)
- Entregáveis/evidência: config/governance/capabilities.json; docs/CAPABILITY_PRESERVATION_MATRIX.md; governance.test.js valida registro
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: DOCUMENTATION, TEST
- Critério de saída: toda capacidade P0 tem golden ou teste
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S0

### 0.4 Golden Dataset — **DONE**

- Tópicos: 54
- Objetivo: Fixture versionada do Viva Juara com hash.
- Pré-requisitos: 0.3 (HARD)
- Entregáveis/evidência: tests/golden/*.golden.json; tests/golden/baseline.json (fingerprints); dataset.fileFingerprints (sha256)
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PARITY
- Critério de saída: datasetChecksum registrado
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S0

### 0.5 Regression Harness — **VALIDATING**

- Tópicos: 54
- Objetivo: Unit + golden + parity + E2E básico + baseline visual antes de reestruturar.
- Pré-requisitos: 0.4 (HARD)
- Entregáveis/evidência: tests/*.test.js (node:test); tests/golden; t18.js (paridade de cores); scripts Playwright (fora do CI)
- Pendente: E2E e baseline visual ainda rodam fora do CI (scratchpad), não há pipeline
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: E2E das 5 jornadas no CI
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S0

## W1 — Fundação de domínio e dados

### 1.1 Data Catalog / Field Registry — **DONE**

- Tópicos: 5
- Objetivo: Data Catalog / Field Registry
- Pré-requisitos: 0.5 (VALIDATION)
- Entregáveis/evidência: domain/model.js (138 campos); docs/DOMAIN_MODEL.md; LEGACY_FIELD_MAPPING.*
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: todo campo com domínio, tipo, unidade, status
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S1

### 1.2 Canonical Lot — **DONE**

- Tópicos: 6
- Objetivo: Canonical Lot
- Pré-requisitos: 1.1 (HARD)
- Entregáveis/evidência: domain/lot.js; data/legacyAdapter.js; regression.test.js: 498 lotes = lots.json
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: IDs canônicos imutáveis
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S1

### 1.3 Data State Semantics — **DONE**

- Tópicos: 37
- Objetivo: Data State Semantics
- Pré-requisitos: 1.2 (HARD)
- Entregáveis/evidência: datastate/dataState.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: null≠0, unknown≠false, UNKNOWN≠AVAILABLE testados
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S1

### 1.4 Static / Versioned / Dynamic split — **DONE**

- Tópicos: 7
- Objetivo: Static / Versioned / Dynamic split
- Pré-requisitos: 1.2 (HARD)
- Entregáveis/evidência: data/lifecycle.js; docs/DATA_LIFECYCLE.md
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: snapshots com versão própria
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S1

### 1.5 Repository Boundary — **VALIDATING**

- Tópicos: 3, 9
- Objetivo: Repository Boundary
- Pré-requisitos: 1.2 (HARD)
- Entregáveis/evidência: data/repositories.js; data/apiSource.js
- Pendente: presentation/app.js ainda busca analysis-input.json pelo nome (GAP-ARCH-11); priceHistory acessa App.repos dentro do domínio (GAP-ARCH-05)
- Bloqueios (decisões): —
- Quality gates: TEST, ARCHITECTURE
- Critério de saída: nenhuma view/composition nomeia arquivo bruto
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S1

### 1.6 Provenance Foundation — **DONE**

- Tópicos: 33
- Objetivo: Provenance Foundation
- Pré-requisitos: 1.1 (HARD)
- Entregáveis/evidência: provenance/*
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: proveniência por atributo, nunca fabricada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S1

### 1.7 Analysis Versioning Foundation — **DONE**

- Tópicos: 35, 12
- Objetivo: Analysis Versioning Foundation
- Pré-requisitos: 1.4 (HARD)
- Entregáveis/evidência: versioning/analysisVersioning.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: baseline legado registrado sem recálculo
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S1

## W2 — Mapa e experiência principal

### 2.1 Map Workspace — **DONE**

- Tópicos: 1, 2, 4
- Objetivo: Map Workspace
- Pré-requisitos: 1.5 (SOFT)
- Entregáveis/evidência: presentation/map.js; presentation/app.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY, PERFORMANCE
- Critério de saída: mapa como workspace
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.2 Map Layer Architecture — **DONE**

- Tópicos: 18
- Objetivo: Map Layer Architecture
- Pré-requisitos: 1.2 (HARD)
- Entregáveis/evidência: map/layers.js; t18 TOTAL DIFF 0; golden:layers
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.3 Smart Legend — **DONE**

- Tópicos: 19
- Objetivo: Smart Legend
- Pré-requisitos: 2.2 (HARD)
- Entregáveis/evidência: map/legend.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.4 LotQuickView — **DONE**

- Tópicos: 20, 4
- Objetivo: LotQuickView
- Pré-requisitos: 1.2 (HARD)
- Entregáveis/evidência: quickview/quickview.js; golden:quickview
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.5 Mobile Bottom Sheet — **DONE**

- Tópicos: 21
- Objetivo: Mobile Bottom Sheet
- Pré-requisitos: 2.4 (HARD)
- Entregáveis/evidência: mobile/sheet.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.6 Desktop Workstation — **DONE**

- Tópicos: 22
- Objetivo: Desktop Workstation
- Pré-requisitos: 2.1 (HARD)
- Entregáveis/evidência: layout/workspace.js; layout/shortcuts.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.7 Tablet Adaptive Profile — **DONE**

- Tópicos: 23
- Objetivo: Tablet Adaptive Profile
- Pré-requisitos: 2.1 (HARD)
- Entregáveis/evidência: layout/responsiveProfile.js
- Pendente: resolver lê DOM (GAP-ARCH-09)
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.8 Filter System — **DONE**

- Tópicos: 17
- Objetivo: Filter System
- Pré-requisitos: 1.3 (HARD)
- Entregáveis/evidência: filters/filters.js; golden:filters
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.9 Menu Compacto — **IN_PROGRESS**

- Tópicos: 53
- Objetivo: Menu Compacto
- Pré-requisitos: 2.1 (HARD)
- Entregáveis/evidência: tópico 53 (em paralelo nesta rodada)
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: nenhuma função removida, só movida (golden + matriz de preservação)
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.10 Geometry Performance — **DONE**

- Tópicos: 46, 47, 48
- Objetivo: Geometry Performance
- Pré-requisitos: 2.2 (SOFT), 0.4 (VALIDATION)
- Entregáveis/evidência: geo/*; loading/*; cache/*; MAP_PERFORMANCE_BASELINE_REPORT.md; LAZY_LOADING_BASELINE_REPORT.md
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PERFORMANCE, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

### 2.11 Location Intelligence (Entorno) — **IN_PROGRESS**

- Tópicos: 63
- Objetivo: Location Intelligence (Entorno)
- Pré-requisitos: —
- Entregáveis/evidência: surroundings/* (flag location_intelligence_google_maps OFF; só no console administrativo)
- Pendente: coordenada oficial do empreendimento não validada; chaves/projeto GCP, orçamento e revisão de termos (decisão humana)
- Bloqueios (decisões): —
- Quality gates: ARCHITECTURE, DOCUMENTATION
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S2

## W3 — Backend/API e autoridade dinâmica

### 3.1 Backend Skeleton — **VALIDATING**

- Tópicos: 9, 52
- Objetivo: Backend Skeleton
- Pré-requisitos: 1.5 (SOFT)
- Entregáveis/evidência: plat/backend (Node + Postgres, módulos por contexto); migrations 001–009 com down
- Pendente: testes de banco não rodam neste ambiente (senha do Postgres); sem CI/CD
- Bloqueios (decisões): D-PG-PASSWORD
- Quality gates: BUILD, TEST, SECURITY
- Critério de saída: testes de banco verdes em CI
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S3

### 3.2 API v1 — **VALIDATING**

- Tópicos: 11
- Objetivo: API v1
- Pré-requisitos: 3.1 (HARD)
- Entregáveis/evidência: backend/docs/openapi.json (1.3.0); data/apiSource.js
- Pendente: painel ainda lê JSON estático; shadow read API × JSON não ligado
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: parity report API × JSON = 0 diferenças
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S3

### 3.3 Authentication — **VALIDATING**

- Tópicos: 30, 50
- Objetivo: Authentication
- Pré-requisitos: 3.2 (HARD)
- Entregáveis/evidência: backend/src/modules/iam (tokens de dev; recusados em produção); backend/src/modules/auth (login Google OIDC: Authorization Code + PKCE, sessão opaca, CSRF, convites); backend/migrations/010_auth_sessions.sql; security/authorization.js (App.authz.account; deny by default); navigation/menuView.js (Entrar com Google / Sair, só com backend); backend/docs/AUTH_GOOGLE_OIDC.md; backend/docs/GUIA_GOOGLE_CLOUD_OAUTH.md; docs/RELATORIO_LOGIN_GOOGLE.md; backend/tests/authGoogle.test.js (Google falso: state, nonce, aud/iss, exp, e-mail não verificado, hd, convite, CSRF, timeouts); tests/loginGoogle.test.js (modo estático inalterado; cabeçalho em modo backend)
- Pendente: login real depende das credenciais OAuth do Google (GOOGLE_CLIENT_ID/SECRET) configuradas no host; repositórios Postgres e migração 010 não testados contra banco (D-PG-PASSWORD); primeiro convite OWNER_ADMIN em org_house7 via npm run iam -- invite
- Bloqueios (decisões): —
- Quality gates: SECURITY
- Critério de saída: login real; tokens de dev recusados em produção
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S3

### 3.4 Organization/Tenant Context — **IN_PROGRESS**

- Tópicos: 31
- Objetivo: Organization/Tenant Context
- Pré-requisitos: 3.3 (HARD)
- Entregáveis/evidência: migration 008; security/organization.js
- Pendente: RLS não habilitado; dois IDs de organização (org_house7 × house7)
- Bloqueios (decisões): D-ORG-ID
- Quality gates: SECURITY, TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S3

### 3.5 Availability backend authority — **BLOCKED**

- Tópicos: 8, 29
- Objetivo: Availability backend authority
- Pré-requisitos: 3.4 (HARD)
- Entregáveis/evidência: availability.service + stream SSE; domain/availability.js
- Pendente: —
- Bloqueios (decisões): D-SALES-MIRROR, D-AVAIL-FRESHNESS
- Quality gates: PARITY, SECURITY
- Critério de saída: espelho de vendas real publicado; UNKNOWN só onde a fonte não informa
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S3

### 3.6 Pricing backend/versioning — **IN_PROGRESS**

- Tópicos: 27, 28
- Objetivo: Pricing backend/versioning
- Pré-requisitos: 3.4 (HARD)
- Entregáveis/evidência: POST price-tables (versão imutável, dryRun); pricing/priceHistory.js
- Pendente: spec do Tópico 27 não recebida
- Bloqueios (decisões): —
- Quality gates: PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S3

### 3.7 Financial Service — **READY**

- Tópicos: 26
- Objetivo: Financial Service
- Pré-requisitos: 3.6 (HARD)
- Entregáveis/evidência: services/finance.js (paridade com index_v1.html)
- Pendente: serviço versionado no backend; modo shadow contra a calculadora atual; spec do Tópico 26 não recebida
- Bloqueios (decisões): —
- Quality gates: PARITY
- Critério de saída: finance golden = 0 diferenças em shadow
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S3

### 3.8 Documents foundation — **IN_PROGRESS**

- Tópicos: 32
- Objetivo: Documents foundation
- Pré-requisitos: 3.4 (HARD)
- Entregáveis/evidência: documents/*
- Pendente: object storage e upload no backend
- Bloqueios (decisões): D-DOCS-STORAGE
- Quality gates: SECURITY, TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S3

### 3.9 Deals: proposta, reserva e fechamento — **IN_PROGRESS**

- Tópicos: 57
- Objetivo: Deals: proposta, reserva e fechamento
- Pré-requisitos: 3.3 (HARD)
- Entregáveis/evidência: deals/* + backend/src/modules/deals (rotas não ligadas)
- Pendente: matriz de alçadas, prazos de reserva, definição de WON (decisão humana); ligar rotas e permissões no backend (iam/permissions.js concederia OWNER_ADMIN)
- Bloqueios (decisões): —
- Quality gates: ARCHITECTURE, DOCUMENTATION
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S3

## W4 — Inteligência explicável

### 4.1 Intelligence Engine — **DONE**

- Tópicos: 12
- Objetivo: Intelligence Engine
- Pré-requisitos: 1.7 (HARD)
- Entregáveis/evidência: intelligence/engine.js; 498 lotes, 45 campos, zero diff
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

### 4.2 Configurable Scoring — **DONE**

- Tópicos: 13
- Objetivo: Configurable Scoring
- Pré-requisitos: 4.1 (HARD)
- Entregáveis/evidência: config/scoring/viva-juara
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

### 4.3 Customer Fit — **DONE**

- Tópicos: 14
- Objetivo: Customer Fit
- Pré-requisitos: 1.2 (HARD)
- Entregáveis/evidência: intelligence/fit.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

### 4.4 Recommendation Engine — **DONE**

- Tópicos: 15
- Objetivo: Recommendation Engine
- Pré-requisitos: 4.3 (HARD)
- Entregáveis/evidência: intelligence/recommendation.js; golden:recommendations
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

### 4.5 Explainable Rankings — **DONE**

- Tópicos: 16
- Objetivo: Explainable Rankings
- Pré-requisitos: 4.4 (HARD)
- Entregáveis/evidência: intelligence/explanation.js; intelligence/reasonCodes.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

### 4.6 Confidence Score — **VALIDATING**

- Tópicos: 34
- Objetivo: Confidence Score
- Pré-requisitos: 1.6 (HARD)
- Entregáveis/evidência: confidence/*
- Pendente: modo sombra; pesos/faixas aguardam aprovação
- Bloqueios (decisões): D-CONFIDENCE
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

### 4.7 Rule Engine — **VALIDATING**

- Tópicos: 36
- Objetivo: Rule Engine
- Pré-requisitos: 4.1 (HARD)
- Entregáveis/evidência: rules/*
- Pendente: flag ruleEngineAlerts desligada; paridade legada em sombra
- Bloqueios (decisões): D-ALERTS
- Quality gates: PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

### 4.8 Comparison Domain — **DONE**

- Tópicos: 24
- Objetivo: Comparison Domain
- Pré-requisitos: 1.2 (HARD)
- Entregáveis/evidência: compare/comparisonDomain.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

### 4.9 Winner per Criterion — **DONE**

- Tópicos: 25
- Objetivo: Winner per Criterion
- Pré-requisitos: 4.8 (HARD)
- Entregáveis/evidência: compare/criterionWinner.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

### 4.10 Price History — **VALIDATING**

- Tópicos: 28
- Objetivo: Price History
- Pré-requisitos: 3.6 (SOFT)
- Entregáveis/evidência: pricing/priceHistory.js; backend pricing-history
- Pendente: só existe uma versão publicada de tabela
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S4

## W5 — Cliente e jornada

### 5.1 Favorites Formal Domain — **DONE**

- Tópicos: 38
- Objetivo: Favorites Formal Domain
- Pré-requisitos: 1.2 (HARD)
- Entregáveis/evidência: favorites/favorites.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S5

### 5.2 Customer Domain — **IN_PROGRESS**

- Tópicos: 39
- Objetivo: Customer Domain
- Pré-requisitos: 3.4 (VALIDATION)
- Entregáveis/evidência: customer/* (memória, sem PII persistida)
- Pendente: persistência server-side
- Bloqueios (decisões): D-CUSTOMER-RETENTION
- Quality gates: SECURITY, TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S5

### 5.3 Customer Preference Profile — **VALIDATING**

- Tópicos: 14, 39
- Objetivo: Customer Preference Profile
- Pré-requisitos: 4.3 (HARD)
- Entregáveis/evidência: perfil temporário do Fit
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S5

### 5.4 Customer Context in UI — **DONE**

- Tópicos: 39, 40
- Objetivo: Customer Context in UI
- Pré-requisitos: 5.2 (SOFT)
- Entregáveis/evidência: customer/customerContext.js; customer/customerView.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S5

### 5.5 Journey — **IN_PROGRESS**

- Tópicos: 40
- Objetivo: Journey
- Pré-requisitos: 5.2 (HARD)
- Entregáveis/evidência: journey/*
- Pendente: —
- Bloqueios (decisões): D-JOURNEY
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S5

### 5.6 Recommendation + Customer — **IN_PROGRESS**

- Tópicos: 15, 56
- Objetivo: Recommendation + Customer
- Pré-requisitos: 4.4 (HARD), 5.3 (HARD)
- Entregáveis/evidência: tópico 56 (em paralelo)
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S5

### 5.7 Comparison + Customer — **IN_PROGRESS**

- Tópicos: 24, 56
- Objetivo: Comparison + Customer
- Pré-requisitos: 4.8 (HARD)
- Entregáveis/evidência: tópico 56 (em paralelo)
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S5

### 5.8 CRM adapters — **BLOCKED**

- Tópicos: 40
- Objetivo: CRM adapters
- Pré-requisitos: 5.5 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): D-CRM-OWNERSHIP
- Quality gates: SECURITY, TEST
- Critério de saída: ownership de campos definido antes de sincronizar
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S5

## W6 — Apresentação, Share e colaboração

### 6.1 Presentation Mode — **DONE**

- Tópicos: 41
- Objetivo: Presentation Mode
- Pré-requisitos: 4.9 (SOFT)
- Entregáveis/evidência: presentationmode/*
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S6

### 6.2 Client-Safe Projection — **VALIDATING**

- Tópicos: 41
- Objetivo: Client-Safe Projection
- Pré-requisitos: 6.1 (HARD)
- Entregáveis/evidência: presentationmode/policy.js (deny by default); config/presentation.js clientSafeFields
- Pendente: projeção server-side
- Bloqueios (decisões): —
- Quality gates: SECURITY, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S6

### 6.3 ShareService — **IN_PROGRESS**

- Tópicos: 42
- Objetivo: ShareService
- Pré-requisitos: 6.2 (HARD), 3.3 (VALIDATION)
- Entregáveis/evidência: share/*
- Pendente: grants/tokens no servidor só como contrato
- Bloqueios (decisões): —
- Quality gates: SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S6

### 6.4 Deep Links — **DONE**

- Tópicos: 43
- Objetivo: Deep Links
- Pré-requisitos: 2.8 (HARD)
- Entregáveis/evidência: deeplink/*
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S6

### 6.5 WhatsApp Payload — **VALIDATING**

- Tópicos: 42
- Objetivo: WhatsApp Payload
- Pré-requisitos: 6.3 (HARD)
- Entregáveis/evidência: shareVM + services/share.js; golden:share
- Pendente: —
- Bloqueios (decisões): D-WHATSAPP-TEXT
- Quality gates: PARITY, SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S6

### 6.6 Presentation Journey Integration — **IN_PROGRESS**

- Tópicos: 41, 40
- Objetivo: Presentation Journey Integration
- Pré-requisitos: 5.5 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S6

### 6.7 Export foundation — **NOT_STARTED**

- Tópicos: 41
- Objetivo: Export foundation
- Pré-requisitos: 6.2 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S6

## W7 — PWA, segurança e observabilidade

### 7.1 Cache Architecture — **DONE**

- Tópicos: 10, 48
- Objetivo: Cache Architecture
- Pré-requisitos: 1.4 (HARD)
- Entregáveis/evidência: cache/*
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S7

### 7.2 Lazy Loading — **DONE**

- Tópicos: 47
- Objetivo: Lazy Loading
- Pré-requisitos: 7.1 (SOFT)
- Entregáveis/evidência: loading/*
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PERFORMANCE
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S7

### 7.3 PWA — **IN_PROGRESS**

- Tópicos: 49, 10
- Objetivo: PWA
- Pré-requisitos: 7.1 (HARD)
- Entregáveis/evidência: sw.template.js; tópico 49 em paralelo
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S7

### 7.4 Offline Pack — **IN_PROGRESS**

- Tópicos: 49
- Objetivo: Offline Pack
- Pré-requisitos: 7.3 (HARD), 7.5 (VALIDATION)
- Entregáveis/evidência: data/offline.js; tópico 49 em paralelo
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S7

### 7.5 Security hardening — **IN_PROGRESS**

- Tópicos: 50, 30
- Objetivo: Security hardening
- Pré-requisitos: 3.3 (SOFT)
- Entregáveis/evidência: tópico 50 em paralelo
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S7

### 7.6 Observability — **IN_PROGRESS**

- Tópicos: 51, 44, 45
- Objetivo: Observability
- Pré-requisitos: 3.1 (SOFT)
- Entregáveis/evidência: analytics/* (local); tópico 51 em paralelo
- Pendente: —
- Bloqueios (decisões): D-ANALYTICS-LEGAL
- Quality gates: OBSERVABILITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S7

### 7.7 Operational Runbooks — **NOT_STARTED**

- Tópicos: 51
- Objetivo: Operational Runbooks
- Pré-requisitos: 7.6 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: DOCUMENTATION
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S7

### 7.8 Privacy / LGPD — **IN_PROGRESS**

- Tópicos: 59
- Objetivo: Privacy / LGPD
- Pré-requisitos: —
- Entregáveis/evidência: privacy/* (central local 'Dados neste aparelho' no painel público; governança só no console)
- Pendente: bases legais, retenção, prazos de titular e encarregado (decisão humana; não é parecer jurídico)
- Bloqueios (decisões): —
- Quality gates: ARCHITECTURE, DOCUMENTATION
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S7

## W8 — Multi-tenant e expansão

### 8.1 Organization Management — **NOT_STARTED**

- Tópicos: 31
- Objetivo: Organization Management
- Pré-requisitos: 3.4 (HARD)
- Entregáveis/evidência: —
- Pendente: só CLI npm run iam
- Bloqueios (decisões): —
- Quality gates: SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S8

### 8.2 Multi-Development — **READY**

- Tópicos: 31, 52
- Objetivo: Multi-Development
- Pré-requisitos: 3.4 (HARD)
- Entregáveis/evidência: config/developments.js (DevelopmentConfig por empreendimento)
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S8

### 8.3 Development Config — **IN_PROGRESS**

- Tópicos: 52
- Objetivo: Development Config
- Pré-requisitos: 8.2 (SOFT)
- Entregáveis/evidência: config/developments.js; config/<área>/viva-juara.json
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S8

### 8.4 Organization Branding — **NOT_STARTED**

- Tópicos: 31
- Objetivo: Organization Branding
- Pré-requisitos: 8.1 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S8

### 8.5 Entitlements — **NOT_STARTED**

- Tópicos: 30, 52
- Objetivo: Entitlements
- Pré-requisitos: 8.1 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S8

### 8.6 Cross-Tenant Security Tests — **IN_PROGRESS**

- Tópicos: 31, 50
- Objetivo: Cross-Tenant Security Tests
- Pré-requisitos: 3.4 (HARD)
- Entregáveis/evidência: backend tests de tenancy (não rodam aqui)
- Pendente: —
- Bloqueios (decisões): D-PG-PASSWORD
- Quality gates: SECURITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S8

### 8.7 New Development Import Pipeline — **IN_PROGRESS**

- Tópicos: 9, 58
- Objetivo: New Development Import Pipeline
- Pré-requisitos: 8.3 (HARD)
- Entregáveis/evidência: backend importDevelopmentData.service.js
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S8

### 8.8 Admin / Operations Shell — **IN_PROGRESS**

- Tópicos: 60
- Objetivo: Admin / Operations Shell
- Pré-requisitos: 3.3 (HARD)
- Entregáveis/evidência: dash/admin.html (scripts/buildAdmin.js, src/admin/adminApp.js, backoffice/*)
- Pendente: papéis, SoD, step-up/MFA e concessões backoffice.* (decisão humana; rotas do backend não ligadas)
- Bloqueios (decisões): —
- Quality gates: ARCHITECTURE, DOCUMENTATION
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S8

### 8.9 Data Quality Governance — **IN_PROGRESS**

- Tópicos: 61
- Objetivo: Data Quality Governance
- Pré-requisitos: 8.8 (SOFT)
- Entregáveis/evidência: dataquality/* (só no console administrativo)
- Pendente: owners/stewards, limiares de frescor e metas de SLO (decisão humana)
- Bloqueios (decisões): —
- Quality gates: ARCHITECTURE, DOCUMENTATION
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S8

## W9 — Otimização e retirada do legado

### 9.1 Legacy Usage Review — **NOT_STARTED**

- Tópicos: 54
- Objetivo: Legacy Usage Review
- Pré-requisitos: 0.5 (HARD), 3.2 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: DOCUMENTATION
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

### 9.2 Remove Migration Flags — **NOT_STARTED**

- Tópicos: 54
- Objetivo: Remove Migration Flags
- Pré-requisitos: 9.1 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: TEST, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

### 9.3 Remove Legacy Adapters — **NOT_STARTED**

- Tópicos: 54
- Objetivo: Remove Legacy Adapters
- Pré-requisitos: 9.1 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

### 9.4 Remove Old JSON Direct Access — **NOT_STARTED**

- Tópicos: 3, 54
- Objetivo: Remove Old JSON Direct Access
- Pré-requisitos: 9.1 (HARD), 1.5 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: ARCHITECTURE, PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

### 9.5 Remove Duplicate Formula Paths — **NOT_STARTED**

- Tópicos: 54
- Objetivo: Remove Duplicate Formula Paths
- Pré-requisitos: 9.1 (HARD)
- Entregáveis/evidência: —
- Pendente: services/comparison.js (legado) × compare/*; services/layers.js × map/layers.js
- Bloqueios (decisões): —
- Quality gates: PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

### 9.6 Remove Legacy Menu/Routes — **NOT_STARTED**

- Tópicos: 53
- Objetivo: Remove Legacy Menu/Routes
- Pré-requisitos: 2.9 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PARITY
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

### 9.7 Performance Optimization — **NOT_STARTED**

- Tópicos: 46
- Objetivo: Performance Optimization
- Pré-requisitos: 9.1 (HARD), 2.10 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PERFORMANCE
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

### 9.8 Database/Index Optimization — **NOT_STARTED**

- Tópicos: 9
- Objetivo: Database/Index Optimization
- Pré-requisitos: 9.1 (SOFT), 3.1 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: PERFORMANCE
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

### 9.9 Cost Optimization — **NOT_STARTED**

- Tópicos: 52
- Objetivo: Cost Optimization
- Pré-requisitos: 9.1 (SOFT)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: DOCUMENTATION
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

### 9.10 Architecture Review — **NOT_STARTED**

- Tópicos: 52, 55
- Objetivo: Architecture Review
- Pré-requisitos: 9.2 (HARD), 9.3 (HARD), 9.4 (HARD), 9.5 (HARD)
- Entregáveis/evidência: —
- Pendente: —
- Bloqueios (decisões): —
- Quality gates: ARCHITECTURE, DOCUMENTATION
- Critério de saída: quality gates verdes + paridade registrada
- Rollback: Reverter o build estático anterior (artefato versionado); dados publicados são imutáveis.
- Trilha: S9

## Tópicos 1–56 → fases

| Tópico | Título | Fases |
|---|---|---|
| 1 | Reestruturação da plataforma (SRV) | 2.1 |
| 2 | Mapa como núcleo operacional | 2.1 |
| 3 | Separação dados × apresentação | 1.5, 9.4 |
| 4 | Modelo hierárquico da informação | 2.1, 2.4 |
| 5 | Domínios e campos dos lotes | 1.1 |
| 6 | Entidade canônica Lot | 1.2 |
| 7 | Dados estáticos, versionáveis e dinâmicos | 1.4 |
| 8 | Status comercial de primeira classe | 3.5 |
| 9 | Migração para backend V2 | 1.5, 3.1, 8.7, 9.8 |
| 10 | Cache híbrido e offline | 7.1, 7.3 |
| 11 | Camada de API formal versionada | 3.2 |
| 12 | Motor de inteligência separado | 1.7, 4.1 |
| 13 | Scores configuráveis e versionados | 4.2 |
| 14 | Fit Score personalizado | 4.3, 5.3 |
| 15 | Recommendation Engine | 4.4, 5.6 |
| 16 | Rankings explicáveis | 4.5 |
| 17 | Filtros em três níveis | 2.8 |
| 18 | Arquitetura de map layers | 2.2 |
| 19 | Legenda inteligente | 2.3 |
| 20 | Lot Quick View | 2.4 |
| 21 | Mobile bottom sheet | 2.5 |
| 22 | Workstation desktop | 2.6 |
| 23 | Tablet adaptativo | 2.7 |
| 24 | Comparador como domínio | 4.8, 5.7 |
| 25 | Vencedor por critério | 4.9 |
| 26 | Serviço financeiro (spec não recebida) ⚠ | 3.7 |
| 27 | Versionamento de tabela de preços (spec não recebida) ⚠ | 3.6 |
| 28 | Histórico de preços | 3.6, 4.10 |
| 29 | Disponibilidade independente do preço | 3.5 |
| 30 | Usuários, permissões, autorização | 3.3, 7.5, 8.5 |
| 31 | Multi-tenant | 3.4, 8.1, 8.2, 8.4, 8.6 |
| 32 | Documentos como entidades | 3.8 |
| 33 | Proveniência por atributo | 1.6 |
| 34 | Confidence score | 4.6 |
| 35 | Versionamento analítico | 1.7 |
| 36 | Alertas e Rule Engine | 4.7 |
| 37 | Estados de dado desconhecido | 1.3 |
| 38 | Favoritos | 5.1 |
| 39 | Customer domain | 5.2, 5.3, 5.4 |
| 40 | Jornada do cliente | 5.4, 5.5, 5.8, 6.6 |
| 41 | Modo apresentação | 6.1, 6.2, 6.6, 6.7 |
| 42 | Share service | 6.3, 6.5 |
| 43 | Deep links | 6.4 |
| 44 | Analytics / semantic layer | 7.6 |
| 45 | Event tracking | 7.6 |
| 46 | Performance geoespacial | 2.10, 9.7 |
| 47 | Lazy loading | 2.10, 7.2 |
| 48 | Arquitetura de cache | 2.10, 7.1 |
| 49 | PWA / offline / service worker | 7.3, 7.4 |
| 50 | Segurança da plataforma | 3.3, 7.5, 8.6 |
| 51 | Observabilidade | 7.6, 7.7 |
| 52 | Arquitetura de referência final | 0.1, 0.2, 3.1, 8.2, 8.3, 8.5, 9.9, 9.10 |
| 53 | Menu compacto / navegação | 2.9, 9.6 |
| 54 | Preservação das forças / não regressão | 0.3, 0.4, 0.5, 9.1, 9.2, 9.3, 9.4, 9.5 |
| 55 | Roadmap por fases | 9.10 |
| 56 | Decisão comercial orientada ao cliente | 5.6, 5.7 |
| 57 | Propostas, reservas e fechamento (deals) | 3.9 |
| 58 | Onboarding de novos empreendimentos | 8.7 |
| 59 | Privacidade e LGPD | 7.8 |
| 60 | Console administrativo (backoffice) separado | 8.8 |
| 61 | Qualidade de dados e governança operacional | 8.9 |
| 63 | Inteligência de localização (Entorno) | 2.11 |

⚠ = especificação não recebida neste projeto.
