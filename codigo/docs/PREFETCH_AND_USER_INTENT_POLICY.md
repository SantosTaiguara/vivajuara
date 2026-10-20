# Prefetch e intenção do usuário (Tópico 47)

`PrefetchIntentService` (planner.js):
- Gatilhos: `hover`/`focus` com permanência ≥ 180 ms (`hoverDwellMs`); `focus`, `touchstart` e abertura de painel valem como intenção sem hover (toque). Orçamento: 1 simultâneo, 1,5 MB por janela de 60 s; cancelado quando chega requisição crítica.
- Desligado com `Save-Data`, conexão lenta (`connectionEnv()`), aba oculta ou orçamento especulativo esgotado.
- Nunca faz prefetch de recurso RESTRICTED/SENSITIVE (dados de cliente, propostas) nem de outro tenant.
- Usa a lane `idle`; se o usuário clicar, a mesma requisição é promovida (dedup).
- `settlePrefetchWaste()` contabiliza prefetch não usado (métrica de desperdício).

Candidato recomendado: botão "Como o score foi calculado" → prefetch de analysis-input.json.
