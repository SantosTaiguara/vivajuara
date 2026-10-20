# SLI, SLO e error budget

Nenhuma meta é definitiva: não há linha de base real (§118–119). Todas estão como `PROPOSED_NEEDS_BASELINE` e a tela mostra "necessita confirmação" (decisão O5: medir pelo menos 4 semanas e aprovar com o negócio).

| SLO | Serviço | Indicador | Meta proposta | Janela |
|---|---|---|---|---|
| slo_api_critical_success | backend-api | requisições críticas sem 5xx | 99,9% | 28 dias |
| slo_quickview_latency | frontend-plataforma | QuickViews abaixo do limite (limite a decidir) | 95% | 28 dias |
| slo_map_boot_success | frontend-mapa | boots do mapa que chegam a INTERACTIVE | 99% | 28 dias |
| slo_share_access_success | backend-api | acessos válidos a links que abrem | 99,5% | 28 dias |
| slo_sync_success | frontend-pwa | sincronizações concluídas | 99% | 28 dias |
| slo_availability_freshness | dados-comercial | tempo com feed de disponibilidade dentro do limite (limite O7) | 99% | 28 dias |

## Cálculo

`signals.evaluateSlo(slo, { good, total })`:
- menos de 20 amostras → `INSUFFICIENT_DATA`, SLI "não disponível" (nunca "100%");
- SLI = good/total; error budget permitido = (1 − meta) × total; consumido = total − good; restante e fração restante;
- burn rate = taxa de erro / (1 − meta). Ex.: meta 99,9%, 998 de 1000 → burn rate 2, budget esgotado (teste).

Alerta por burn rate multi-janela (`burnRateAlert(curta, longa)`): HIGH se as duas janelas ≥ 14,4; WARNING se ≥ 6. Pico só na janela curta não alerta.

Error budget serve para decidir entre confiabilidade e novas features: budget esgotado → priorizar correções.
