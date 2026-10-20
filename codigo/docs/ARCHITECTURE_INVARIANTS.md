# Invariantes da arquitetura

Cada invariante tem ao menos um mecanismo de garantia que existe hoje no código ou nos testes. "Gap" indica onde ainda falta garantia.

| # | Invariante | Garantia atual | Gap |
|---|---|---|---|
| 1 | O ID canônico do lote nunca muda depois de criado | `regression.test.js` (498 IDs = lots.json `did`); golden `lots` (chave por código, `id` por lote); `geo46.test.js` (polígonos intactos) | — |
| 2 | Preço não define disponibilidade | `domain/availability.js` sem dependência de pricing/financial (teste de arquitetura `FORBIDDEN_CONTEXT` + teste explícito); `availability*.test.js`; golden: 498 UNKNOWN com preço presente | backend: tabelas separadas (`lot_prices` × `lot_availability`) já existem |
| 3 | Cache nunca é fonte de verdade | `cache/cacheCore.js` (estratégias por tipo; `NEVER_CACHED`), `offline.test.js`, `cache.test.js` | — |
| 4 | Frontend nunca autoriza ação final | `security/authorization.js` só guarda UI (deny by default); backend `iam/routePolicies.js` | provedor de identidade (D-IDP) |
| 5 | Escopo de tenant é obrigatório para dado do tenant | `security/organization.js` (tenancy keys), cache `makePartition`, backend migration 008 | RLS; ID de organização duplicado (D-ORG-ID) |
| 6 | Versões publicadas analíticas/comerciais são imutáveis | `methodology.js` (checksum), `configBundle.js` (build falha), backend price-table publication (005), golden `dataset` | — |
| 7 | Desconhecido não é zero/false/disponível | `datastate.test.js`, `filters.test.js`; golden: `filters.status-available = 0`, `only-offerable = 0`, recomendação real = 0 | — |
| 8 | Ponteiro current não é o artefato | `config/scoring/*/current.json` validado; `currentPriceTableId` | — |
| 9 | Modo cliente não expõe técnico/restrito implicitamente | `presentationmode/policy.js` (allow-list), `config/presentation.js clientSafeFields`; golden `quickview.*.client`, `comparison.*:client`, `share.*:client` (sem "Score Moradia") | projeção no servidor |
| 10 | Recomendação não relaxa constraints em silêncio | `recommendation.test.js` (`autoRelaxed: false`) | — |
| 11 | Vencedor por critério não é "melhor lote geral" | `compare.test.js` (jargão "Vencedor" proibido) | — |
| 12 | Confiança não é probabilidade de verdade sem calibração | `confidence/*` em modo sombra; textos sem "probabilidade" | aprovação D-CONFIDENCE |
| 13 | Ocorrência de alerta não muda a verdade de domínio | `rules/alertDomain.js` (instâncias separadas do Lote); `rules.test.js` | — |
| 14 | Último estado offline não é estado atual | `data/offline.js` (rótulo "último estado conhecido"), `offline.test.js` | política de prazo do preço offline (D-HOSTING/tópico 48 §8) |
| 15 | Auditoria, analytics, observabilidade e segurança ficam separados | namespaces distintos (`App.authz` audit, `App.eventTracking`, `geo/perf`, tópico 51) — `EVENT_TAXONOMY.md` | `App.analytics` duplicado (GAP-ARCH-10) |
| 16 | Nenhum segredo bruto no frontend/logs/cache | teste de arquitetura "invariant 16"; `AUTH_TOKEN` NO_CACHE; `analytics/privacy.js` | varredura do tópico 50 |
| 17 | Otimização de render não destrói a geometria fonte | `geo/geometry.js` (canônica × render), `geo46.test.js`, golden `lots.*.geometry.polygonFingerprint` e `map.sourceChecksum` | — |
| 18 | Proveniência nunca é fabricada | `provenance/legacyProvenance.js` (honesto por construção), `provenance.test.js`, golden `lots.*.provenanceStatuses` | — |
| 19 | Preferência do cliente não é constraint dura sem marcação explícita | `intelligence/fit.js` × `recommendation.js` (constraints separadas) | — |
| 20 | Nenhuma dependência direta de provedor no domínio | teste de arquitetura: domínio sem rede; WhatsApp só em `services/share.js` (aplicação) | adaptadores CRM (D-CRM-OWNERSHIP) |
