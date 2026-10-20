# Relatório de impacto dos estados de dados (Tópico 37)

`App.dataState.impactReport(lots)` e `diagnostics(lots)` (técnicos, não são KPI nem score de confiança), 2026-10-09:

| Métrica | Valor |
|---|---|
| Campos revisados (registro, exceto geometria) | 132 |
| Atributos rastreados (498 × 132) | 65.736 |
| KNOWN (valores idênticos ao Lot canônico — paridade) | 49.830 (0 divergências) |
| UNKNOWN | 4.920 (dos quais LEGACY_UNCLASSIFIED 2.376) |
| NOT_AVAILABLE | 10.488 |
| NOT_APPLICABLE | 498 |
| PENDING / CONFLICTED / INVALID / ERROR / PARTIAL | 0 |
| Estado ausente (null sem estado) | 0 |
| Nulos classificados com motivo | 12.948 |
| Sentinelas de enum classificadas | 468 |
| Mapeamentos que exigem revisão humana | 15 |

## Deltas de comportamento
- **Cálculos (score, Fit, Recommendation, vencedor, preço R$ 1.196/m², solar, financeiro): nenhum delta.** Nenhum módulo de cálculo foi alterado; os testes existentes (479) seguem passando.
- Filtros/comparação/compartilhamento: 0 afetados nesta entrega — o resolver é aditivo; a UI ainda usa os formatadores atuais até a integração.
- Padrões encontrados que serão afetados quando a UI consumir o resolver (relatados, não corrigidos silenciosamente):
  - `presentation/compareView.js:60` `v || '—'` — um valor 0 apareceria como "—" (bug de truthiness).
  - `presentation/panels.js:230` `e.fitScore == null ? '—'` — correto, mas sem motivo.
  - Formatadores `App.fmt.*` devolvem "Não disponível" genérico para qualquer null (não distinguem NOT_APPLICABLE/UNKNOWN).
  - `fmt.formatBool(null)` → "Não disponível" (correto, não vira "Não").
  - 41 ocorrências `|| 0)` e 9 `?? 0` revisadas: são contadores/inputs de UI (simulação, opacidade, contagens), não campos canônicos.
- Correções de bug (ex.: compareView) dependem de validação humana (§364).
