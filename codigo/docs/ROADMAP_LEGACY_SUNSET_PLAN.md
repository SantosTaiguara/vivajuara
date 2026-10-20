# Plano de retirada do legado (onda W9)

O detalhe por componente está em `LEGACY_SUNSET_PLAN.md` (tópico 52). O checklist está em `LEGACY_REMOVAL_CHECKLIST.md` (tópico 54). Aqui fica a ordem no roadmap.

| Fase | Remove | Depende de (HARD em `roadmap.json`; + pré-condição) | Evidência para começar |
|---|---|---|---|
| 9.1 Legacy Usage Review | — (levantamento) | 0.5, 3.2 | `architecture52` lista os acessos legados |
| 9.2 Remove Migration Flags | `ruleEngineAlerts` e flag de confiança em sombra | 9.1; + D-CONFIDENCE e D-ALERTS decididas | modo SHADOW → NEW_ONLY estável |
| 9.3 Remove Legacy Adapters | adaptadores de compatibilidade de dados antigos | 9.1 | 0 uso em 9.1 |
| 9.4 Remove Old JSON Direct Access | leitura direta de `lots.json` fora da camada de dados (GAP-ARCH-11, GAP-ARCH-12) | 9.1, 1.5 | knownViolations RAW_JSON_ONLY_IN_DATA = 0 |
| 9.5 Remove Duplicate Formula Paths | preço calculado em 4 arquivos (TD-12) | 9.1; + 3.6 com fonte única de preço | golden `lots`/`finance` iguais com fonte única |
| 9.6 Remove Legacy Menu/Routes | menu antigo e rotas antigas | 2.9; + janela de estabilização | rotas antigas redirecionam |
| 9.7 Performance Optimization | — | 9.1, 2.10 | baseline de performance |
| 9.8 Database/Index Optimization | — | 3.1 (HARD), 9.1 (SOFT) | consultas reais medidas |
| 9.9 Cost Optimization | — | 9.1 (SOFT); + D-HOSTING | custos reais |
| 9.10 Architecture Review | — | 9.2, 9.3, 9.4, 9.5 | revisão desta arquitetura de referência; novo ADR |

## Regras

- Não remover antes da paridade (anti-pattern "remove legacy before parity").
- Não deixar o legado para sempre (anti-pattern "leave legacy forever"): toda flag e todo adaptador têm fase de retirada.
- Ao remover, atualize a capacidade em `capabilities.json` para `LEGACY_REMOVED` e mantenha o artefato anterior disponível pelo período combinado.
