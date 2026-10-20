# Relatório de migração de métricas legadas (tópico 44)

Inventário em `App.semanticLayer.legacyInventory()`.

**Constatação:** antes do tópico 44 o painel **não tinha fórmula de KPI nem dashboard**. Havia apenas um log de eventos em memória e resumos operacionais.

| Local | O que era | Fórmula | Ação | Observação |
|---|---|---|---|---|
| `src/state/store.js:151` (`App.analytics.log`) | log em memória dos 100 últimos eventos | nenhuma | REDEFINE | substituído pelo buffer local por organização, com validação e privacidade; `log` mantido para compatibilidade |
| `src/presentationmode/runtime.js` (outcome) | resumo da sessão de apresentação | etapas vistas, reações | KEEP | resumo operacional; a métrica analítica usa o fato explícito de conclusão |
| `src/favorites/favorites.js` (`statusSummary`) | contagens de favoritos | estado atual | KEEP | KPI operacional de estado; `favorites_added` é a métrica analítica |

## Riscos encontrados
- O log antigo não tinha tenant e podia carregar campos livres (risco de PII). Resolvido: o transformador legado do tópico 45 aplica o catálogo e a privacidade.
- Nenhuma métrica legada foi descartada, porque não existia nenhuma. Os nomes de eventos legados estão em `LEGACY_TRACKING_MIGRATION_REPORT.md`.
