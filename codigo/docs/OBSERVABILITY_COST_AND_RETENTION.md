# Custo e retenção

## No aparelho (hoje)

| Sinal | Limite | Retenção |
|---|---|---|
| Logs | 300 eventos (descarta DEBUG, depois INFO) | memória da aba |
| Grupos de erro | 100 (sai o mais antigo) + 60 capturas/min | memória da aba |
| Spans | 200 | memória da aba |
| Séries de métrica | 50 por métrica; 200 amostras por histograma | memória da aba |
| Mudanças operacionais | 50 | memória da aba |

Nada é persistido nem enviado. "Limpar diagnóstico desta aba" apaga tudo.

## ObservabilityCostBudget (servidor, a decidir — O4)

```json
{ "maxDailyLogBytes": null, "defaultTraceSampleRate": 0.1, "maxMetricLabelCardinality": 50, "logRetentionDays": null, "traceRetentionDays": null }
```

Retenção por categoria (proposta): debug curta; logs de aplicação moderada; segurança conforme política de segurança; audit conforme política de audit. Retenção não é "guardar tudo para sempre".

## Prioridade de descarte (backpressure)

Preservar primeiro FATAL, ERROR, sinais de segurança e traces de operações de alto risco; descartar primeiro DEBUG verboso e INFO de alto volume. Fila nunca infinita. Amostragem não substitui redaction. Não reduzir sinais críticos só para economizar sem política.

## Tamanho no painel

O navegador carrega só a cópia enxuta do registro (`config/observability/registry.json`, cerca de 30 KB, sem contratos de servidor nem descrições) e a política (cerca de 6 KB). O registro completo (`docs/OBSERVABILITY_REGISTRY.json`) não vai para a página. Os três módulos somam cerca de 95 KB de JS sem minificação: ao integrá-los, o orçamento `MAP_ROUTE.maxInitialJsBytes` (3.000.000 bytes, tópico 47) precisa ser revisto ou o build precisa minificar (decisão do integrador).

Residência de dados: escolher provedor/região junto com O1.
