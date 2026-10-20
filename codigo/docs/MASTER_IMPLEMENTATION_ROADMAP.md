# Roadmap mestre de implementação

Fonte única: `config/governance/roadmap.json` (versão `2026-10-11.1`), validado por `src/governance/roadmap.js` e `tests/roadmap55.test.js`. Este documento resume. Os detalhes de cada fase ficam em `ROADMAP_PHASE_DEFINITIONS.md`, e o grafo em `ROADMAP_DEPENDENCY_GRAPH.md`. Os dois são gerados por `node scripts/governanceDocs.js`.

## Princípio

A ordem segue a dependência real, não a numeração dos tópicos. Migração incremental: baseline → contrato → implementação nova → sombra/paridade → cutover → estabilização → remoção do legado. Nenhuma fase passa a DONE sem evidência: teste, documento ou relatório existente.

## Maturidade atual: **L1 — Canonical data**

Calculada por `roadmap.maturity()`. O nível é o maior com todas as fases DONE/VALIDATING e todos os níveis anteriores completos.

| Nível | Fases | DONE/VALIDATING | Observação |
|---|---|---|---|
| L0 Legado compreendido | W0 (5) | 5 | baseline, golden e preservação feitos (tópicos 52/54) |
| L1 Dados canônicos | W1 (7) | 7 | Lote canônico, FieldRegistry, proveniência e versões |
| L2 Cliente modular | W2 (10) | 9 | falta concluir 2.9 Menu Compacto (tópico 53, em andamento) |
| L3 Backend autoritativo | W3 (8) | 2 | auth, disponibilidade real e RLS bloqueados por decisão |
| L4 Inteligência explicável | W4 (10) | 10 | pronto, mas não conta antes de L3 |
| L5 Plataforma centrada no cliente | W5 (8) | 3 | Customer só no aparelho; jornada/CRM dependem de decisão |
| L6 Compartilhável/offline | W6+W7 (14) | 6 | share e PWA no cliente; tokens e grants no servidor só como contrato |
| L7 Produto multi-tenant | W8 (7) | 0 | não começou de fato |

Sem backend autoritativo (L3) a maturidade não passa de L2. O teste `roadmap55` trava isso.

## Ondas

| Onda | Nome | Situação | Bloqueio principal |
|---|---|---|---|
| W0 | Baseline e segurança da migração | 4 DONE, 1 VALIDATING (0.5 harness: falta o teste automático entre visões) | — |
| W1 | Fundação de domínio e dados | 6 DONE, 1 VALIDATING (1.5: GAP-ARCH-05/06/11) | — |
| W2 | Mapa e experiência principal | 9 DONE, 2.9 IN_PROGRESS | — |
| W3 | Backend/API e autoridade dinâmica | 0 DONE | D-IDP, D-ORG-ID, D-SALES-MIRROR, D-AVAIL-FRESHNESS, D-DOCS-STORAGE, D-PG-PASSWORD |
| W4 | Inteligência explicável | 7 DONE, 3 VALIDATING (confiança e regras em sombra) | D-CONFIDENCE, D-ALERTS |
| W5 | Cliente e jornada | 2 DONE | D-CUSTOMER-RETENTION, D-JOURNEY, D-CRM-OWNERSHIP |
| W6 | Apresentação, Share e colaboração | 2 DONE, 2 VALIDATING | D-WHATSAPP-TEXT; tokens no servidor dependem de W3 |
| W7 | PWA, segurança e observabilidade | 2 DONE, 4 IN_PROGRESS (tópicos 49/50/51 em paralelo) | D-ANALYTICS-LEGAL, D-HOSTING |
| W8 | Multi-tenant e expansão | 0 DONE | depende de 3.3/3.4 |
| W9 | Otimização e retirada do legado | 0 DONE | depende de cutover das capacidades |

## Tópicos 1–56 → fases

Todo tópico de 1 a 56 aparece em pelo menos uma fase (verificado por `roadmap.validate`). Os tópicos 26 e 27 não têm spec recebida (`specMissing`). Nenhuma fase que depende só deles pode ser DONE. A matriz completa está em `ROADMAP_PHASE_DEFINITIONS.md`.

## Próximas fases executáveis (`roadmap.nextActionable`)

Todas as dependências HARD estão satisfeitas e não há bloqueio por decisão aberta:

`2.9 Menu Compacto` · `5.2 Customer Domain` (parte local) · `5.6 Recommendation + Customer` · `5.7 Comparison + Customer` · `6.3 ShareService` (parte cliente) · `6.7 Export foundation` · `7.3 PWA` · `7.5 Security hardening` · `7.6 Observability` (parte local) · `8.3 Development Config` · `9.1 Legacy Usage Review` · `9.8 / 9.9` (só levantamento).

Recomendação de início:
1. Fechar 0.5 com o teste cruzado entre visões.
2. Fechar 1.5: GAP-ARCH-05, 06 e 11 (domínio lendo repositório, busca acoplada, caminho de JSON no composition root).
3. Concluir 2.9.
4. Obter **D-IDP** e **D-ORG-ID**, que destravam a W3 inteira.

## Incrementos de valor (sem release gigante)

| Incremento | Conteúdo | Estado |
|---|---|---|
| A | Mapa padrão + QuickView + menu compacto | mapa e QuickView feitos; menu em 2.9 |
| B | Filtros + camadas + legenda inteligente | feito |
| C | Comparação de domínio + UI | feito |
| D | API de leitura + disponibilidade autoritativa | API em VALIDATING; disponibilidade BLOCKED (sem feed real) |
| E | Cliente + Find | local feito; servidor pendente |
| F | Apresentação + Share | cliente feito; tokens no servidor pendentes |
| G | Offline Pack | em andamento (tópico 49) |

## Regras de execução

- A arquitetura-alvo (`REFERENCE_ARCHITECTURE_V1.md`) só muda com ADR (`ADR_INDEX.md`). A ordem de execução pode mudar, desde que registrada em `ROADMAP_DECISION_LOG.md`.
- Uma fase não fica IN_PROGRESS indefinidamente. Sem avanço, ela vai a BLOCKED com o motivo, ou é dividida.
- Writes críticos só depois de authz (3.3). Customer no servidor só depois de tenant (3.4). Share público só com projeção client-safe (6.2). Offline Pack só com cache, versionamento e segurança.
- O roadmap fica atualizado: ao mudar o status de uma fase, edite `roadmap.json` e rode `node scripts/governanceDocs.js`. O teste falha se o grafo estiver desatualizado.
