# Relatório — Tópico 52: Arquitetura de referência final

Data: 2026-10-12. Escopo: documentar a arquitetura real e a alvo, e criar o teste de conformidade entre contextos. Nenhuma mudança de UI, dados, IDs, geometria, scores, classes, metodologia ou preço.

## Arquitetura atual
Hoje a aplicação é um arquivo único, gerado por `scripts/build.js`. Os módulos são scripts que se penduram no `App` global, e as dependências aparecem como referências `App.<ns>`. Os dados estáticos estão versionados (dataset `2026-10-06.1`, tabela de preço 2026-10-06 a R$ 1.196/m²). Os 498 lotes estão UNKNOWN. O backend (`plat/backend`) é Node com Postgres e roda em modo de desenvolvimento, mas o painel ainda não depende dele. O inventário completo, gerado do código, está em `CURRENT_ARCHITECTURE_INVENTORY.md` e `DOMAIN_MODULE_MAP.md`.

## Arquitetura alvo
Monólito modular com contextos delimitados, descrito em `REFERENCE_ARCHITECTURE_V1.md` e `ARCHITECTURE.md`.
- No frontend, as camadas são domínio → aplicação → infraestrutura/view, com composition root em `presentation/app.js`.
- No backend, cada módulo é dono das suas tabelas.
- O que é estático/versionado sai em artefatos imutáveis. O dinâmico (disponibilidade, cliente) vem de API com autoridade.

## Maiores lacunas e riscos críticos
Estão em `ARCHITECTURE_GAP_REPORT.md` (GAP-ARCH-01..23) e `ARCHITECTURE_RISK_REGISTER.md`. Os críticos e altos:
- **GAP-ARCH-17**: sem IdP (D-IDP).
- **GAP-ARCH-18**: RLS não habilitado e dois IDs de organização (D-ORG-ID).
- **GAP-ARCH-19**: disponibilidade sem fonte.
- **GAP-ARCH-20**: testes de banco não rodam aqui, e não há CI.
- **GAP-ARCH-13**: ciclo lógico entre analytics, comparison, quickview, security e share.

## Contextos, ownership e áreas
Contextos e dono de cada módulo estão em `config/governance/architecture.json` e `DOMAIN_MODULE_MAP.md`. Dados e dono de cada tabela, em `DATA_OWNERSHIP_MATRIX.md`. Cada área tem seu documento:

| Área | Documento |
|---|---|
| Frontend | `FRONTEND_ARCHITECTURE.md` |
| Backend e banco | `BACKEND_MODULAR_MONOLITH.md`. Tabelas verificadas no código; GAP-ARCH-15/16: três módulos escrevem em `developments`, e `lots.repository` lê tabelas de outros módulos |
| Object storage e documentos | não decidido (D-DOCS-STORAGE, GAP-ARCH-23) |
| Jobs | importação e publicação de versões no backend (scripts), descritos em `CONTAINER_ARCHITECTURE.md` |
| API | v1 em `plat/backend/docs` e `CONTAINER_ARCHITECTURE.md` |
| Eventos | `EVENT_TAXONOMY.md` |
| Versionamento | `VERSIONED_ARTIFACT_ARCHITECTURE.md` |
| Mapa, recomendação, comparação, financeiro, cliente/jornada, apresentação/share | seções por contexto em `REFERENCE_ARCHITECTURE_V1.md`; regras invariantes em `ARCHITECTURE_INVARIANTS.md` |
| Cache e PWA/offline | `CACHE_ARCHITECTURE.md` (tópico 47); PWA no tópico 49 |
| Segurança | tópico 50; invariantes 2 e 16 |
| Observabilidade | tópico 51 |
| Deploy | `DEPLOYMENT_ARCHITECTURE.md` (staging e RPO/RTO não definidos: D-RPO-RTO, D-HOSTING) |
| CI/CD | `CI_CD_ARCHITECTURE.md` (pipeline proposto, ainda não existe) |

## Testes (fitness functions)
- `src/governance/architectureConformance.js` (`App.governance.architecture`) faz a análise léxica do código: remove comentários, strings e regex antes de analisar. Cobre 10 regras: direção de camadas, dependência proibida entre contextos, DOM ou storage no domínio, rede fora da infraestrutura, view mutando domínio, JSON cru fora da camada de dados, dono de namespace, módulo não classificado e ciclo entre contextos.
- `tests/architecture52.test.js` tem 11 testes. É um ratchet: 23 violações conhecidas estão registradas e mapeadas a GAP-ARCH (14 LAYER_DIRECTION, 4 DOMAIN_NO_DOM, 2 RAW_JSON, 2 CONTEXT_CYCLE, 1 NAMESPACE_OWNERSHIP), e só uma violação **nova** falha. O teste também cobre tolerância zero em regras de domínio, varredura de segredos, presença dos documentos e não vacuidade, usando código sintético que precisa ser pego.
- As fitness functions estão em `ARCHITECTURE_FITNESS_FUNCTIONS.md`.

## ADRs, invariantes, dívida e migração
- ADRs: `ADR_INDEX.md` (ADR-001..014).
- Invariantes: `ARCHITECTURE_INVARIANTS.md`.
- Dívida: `TECHNICAL_DEBT_REGISTER.md` (TD-01..12). TD-12 é a fórmula de preço duplicada em 4 arquivos.
- Migração: incremental por capacidade (tópicos 54 e 55), com plano de retirada em `LEGACY_SUNSET_PLAN.md`.

## Arquivos
**Criados:**
- `src/governance/architectureConformance.js`
- `config/governance/architecture.json`
- `scripts/governanceSources.js`
- `scripts/governanceDocs.js`
- `tests/architecture52.test.js`
- documentos: ARCHITECTURE, REFERENCE_ARCHITECTURE_V1, SYSTEM_CONTEXT_DIAGRAM, CONTAINER_ARCHITECTURE, FRONTEND_ARCHITECTURE, BACKEND_MODULAR_MONOLITH, DATA_OWNERSHIP_MATRIX, EVENT_TAXONOMY, VERSIONED_ARTIFACT_ARCHITECTURE, DEPLOYMENT_ARCHITECTURE, CI_CD_ARCHITECTURE, ARCHITECTURE_INVARIANTS, ARCHITECTURE_FITNESS_FUNCTIONS, ARCHITECTURE_GAP_REPORT, ARCHITECTURE_RISK_REGISTER, TECHNICAL_DEBT_REGISTER, LEGACY_SUNSET_PLAN, ADR_INDEX
- documentos gerados: CURRENT_ARCHITECTURE_INVENTORY, DOMAIN_MODULE_MAP, MODULE_DEPENDENCY_MATRIX

**Alterados:** nenhum arquivo existente.

## Impacto de compatibilidade
Nenhum. Os módulos de governança só rodam em teste e desenvolvimento e não entram no ORDER do build.

## Decisões em aberto (precisam de aprovação humana)
D-IDP, D-ORG-ID, D-RPO-RTO, D-HOSTING, D-DOCS-STORAGE e D-PG-PASSWORD.

Os módulos novos dos tópicos 49, 50, 51, 53 e 56 aparecem como UNCLASSIFIED (aviso). É preciso classificá-los em `architecture.json` e rodar `node scripts/governanceDocs.js`.
