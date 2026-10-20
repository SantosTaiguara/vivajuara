# Relatório — Tópico 55: Roadmap de implementação por fases

Data: 2026-10-12. O roadmap é dado, não só texto: `config/governance/roadmap.json` (versão `2026-10-11.1`) é validado por `src/governance/roadmap.js` (`App.governance.roadmap`) e por `tests/roadmap55.test.js` (7 testes).

## Maturidade atual: **L1 (Canonical data)**
- L2 só falta a fase 2.9 (Menu Compacto).
- A W4, Inteligência, está completa, mas não conta como L4 antes de existir backend autoritativo (L3).
- O teste trava a maturidade em L2 ou menos enquanto não houver backend.

## Ondas, fases e dependências
- 10 ondas (W0–W9) e 79 fases. O status de cada fase é honesto: DONE só com evidência.
- Os tópicos 1–56 estão todos mapeados. Os tópicos 26 e 27 estão sem spec, e nenhuma fase que depende deles pode ser DONE.
- 89 dependências, nos tipos HARD, SOFT, VALIDATION e OPTIONAL. Não há ciclo (`roadmap.cycles`).
- O grafo em Mermaid é gerado em `ROADMAP_DEPENDENCY_GRAPH.md`, e o teste falha se ele estiver desatualizado. As definições ficam em `ROADMAP_PHASE_DEFINITIONS.md`.

Dependências HARD críticas:
- authz (3.3) antes de writes críticos;
- tenant (3.4) antes de Customer no servidor;
- client-safe (6.2) antes de Share público;
- cache, versionamento e segurança antes do Offline Pack;
- paridade antes de remover legado.

As dependências SOFT permitem começar com objeto temporário, por exemplo Fit com perfil temporário ou a legenda antes do backend.

## Frentes, bloqueios e riscos
- Frentes S0–S9, agrupadas em 4 streams: `ROADMAP_PARALLEL_WORKSTREAMS.md`.
- Bloqueios atuais: 3.3 (D-IDP), 3.5 (D-SALES-MIRROR, D-AVAIL-FRESHNESS) e 5.8 (D-CRM-OWNERSHIP). Outras fases têm decisões pendentes, listadas em `ROADMAP_DECISION_LOG.md`.
- Riscos críticos: o dataset "feliz", com 498 lotes UNKNOWN; 15 decisões paradas; e testes de banco que não rodam aqui. Ver `ROADMAP_RISK_REGISTER.md` (RR-01..14).

## Prontidão
| Área | Estado |
|---|---|
| Baseline e preservação | W0 com 4 DONE e 1 VALIDATING. Golden e registro de capacidades prontos (tópico 54) |
| Segurança | 7.5 IN_PROGRESS (tópico 50). Auth BLOCKED |
| Observabilidade | 7.6 IN_PROGRESS (tópico 51). D-ANALYTICS-LEGAL |
| Banco e API | 3.1/3.2 VALIDATING. Sem CI e sem teste de banco aqui |
| Mapa | W2 com 9 de 10 DONE |
| Inteligência | W4 com 7 DONE e 3 VALIDATING (sombra) |
| Customer | só no aparelho (5.2 IN_PROGRESS) |
| Apresentação e Share | 6.1/6.4 DONE, 6.2/6.5 VALIDATING, 6.3 IN_PROGRESS |
| PWA | 7.3/7.4 IN_PROGRESS (tópico 49) |
| Multi-tenant | W8 sem nenhuma fase DONE |

## Cutover, rollback, gates e signoff
- Estratégia de cutover por capacidade: `ROADMAP_CUTOVER_POLICY.md`. É a política do tópico 54 com `cutoverGate`.
- Rollback em 3 níveis (UI por flag, aplicação, dados por rollforward). Versões imutáveis viram ponteiros: `ROADMAP_ROLLBACK_POLICY.md`.
- 8 gates (BUILD, TEST, PARITY, SECURITY, PERFORMANCE, OBSERVABILITY, DOCUMENTATION, ARCHITECTURE) e os bloqueadores P0/P1 de release: `ROADMAP_QUALITY_GATES.md`.
- Métricas de migração (`MigrationHealth`), com valores reais e o que não foi medido marcado como tal: `ROADMAP_MIGRATION_METRICS.md`.
- Signoff: `ROADMAP_SIGNOFF_TEMPLATE.md`, obrigatório para cutover P0, fechamento de onda e remoção de legado.
- Retirada do legado: `ROADMAP_LEGACY_SUNSET_PLAN.md` (W9).
- Critérios de entrada e saída de fase: `ROADMAP_ENTRY_EXIT_CRITERIA.md`.
- Modelo de status: `ROADMAP_STATUS_TEMPLATE.md`.

## Arquivos
**Criados:**
- `config/governance/roadmap.json`
- `src/governance/roadmap.js`
- `tests/roadmap55.test.js`
- documentos: MASTER_IMPLEMENTATION_ROADMAP, ROADMAP_ENTRY_EXIT_CRITERIA, ROADMAP_QUALITY_GATES, ROADMAP_CUTOVER_POLICY, ROADMAP_ROLLBACK_POLICY, ROADMAP_PARALLEL_WORKSTREAMS, ROADMAP_RISK_REGISTER, ROADMAP_DECISION_LOG, ROADMAP_STATUS_TEMPLATE, ROADMAP_MIGRATION_METRICS, ROADMAP_SIGNOFF_TEMPLATE, ROADMAP_LEGACY_SUNSET_PLAN
- gerados: ROADMAP_DEPENDENCY_GRAPH, ROADMAP_PHASE_DEFINITIONS

**Alterados:** nenhum arquivo existente.

## Dependências não resolvidas e decisões humanas
As 15 decisões abertas: D-PG-PASSWORD, D-IDP, D-ORG-ID, D-SALES-MIRROR, D-AVAIL-FRESHNESS, D-DOCS-STORAGE, D-CONFIDENCE, D-ALERTS, D-CUSTOMER-RETENTION, D-JOURNEY, D-CRM-OWNERSHIP, D-WHATSAPP-TEXT, D-ANALYTICS-LEGAL, D-HOSTING e D-RPO-RTO.

## Primeiras fases recomendadas
1. 0.5: teste cruzado entre visões.
2. 1.5: GAP-ARCH-05/06/11.
3. 2.9: menu compacto.
4. Obter D-IDP e D-ORG-ID, que destravam a W3.
5. 3.2: shadow read da API contra o JSON.
6. 9.1: levantamento do uso do legado.
