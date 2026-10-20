# Arquitetura do Rule Engine (Tópico 36)

```text
config/rules/<dev>.json (RuleDefinition + RuleVersion + RuleSetVersion, dados)
        │  App.alerts.catalog(dev) → ruleSetRegistry (tenant) → compile()
        ▼
CompiledRuleVersion (congelada, checksum, dependencyManifest)
        │  App.alerts.facts.inputFor(lot, analysisResult, ctx)   ← quem chama monta os fatos
        ▼
App.ruleEngine.evaluate(compiled, input) → RuleEvaluationResult (TRUE/FALSE/UNKNOWN/ERROR/NOT_APPLICABLE + traço)
        │  App.alerts.candidateOf()  (ERROR nunca vira alerta; UNKNOWN segue a unknownPolicy)
        ▼
AlertCandidate → App.alerts.store(tenant).reconcile() → AlertInstance + episódios + eventos
        │  App.alerts.project(alert, CLIENT|BROKER|TECHNICAL) / sortAlerts / quickViewSummary
        ▼
UI / API / auditoria        (App.alertMigration.* projeta para as superfícies legadas)
```

## Módulos

| Arquivo | Namespace | Responsabilidade |
|---|---|---|
| `src/rules/ruleCore.js` | `App.ruleEngine` | registries fechados (operadores, predicados, métricas, formatadores), validador, compilador, avaliação ternária, renderização de mensagens, explicação a partir do traço, índice de dependências, planner, registry de RuleDefinition/RuleVersion/RuleSet, casos de teste de regra |
| `src/rules/alertDomain.js` | `App.alerts` | catálogo empacotado, construção de fatos, AlertCandidate, AlertStore (reconciliação, ciclo de vida, supressão, histerese, eventos), projeção por público, ordenação, resumo do Quick View |
| `src/rules/legacyAlertMigration.js` | `App.alertMigration` | inventário legado, tradutor da DSL antiga, leitores legados, projeção para as superfícies legadas, relatório de paridade, pontos de integração com feature flag |

## Princípios garantidos no código

- Sem `eval`, `Function`, HTML ou código vindo do cliente (teste estático em `tests/rules.test.js`).
- O motor é puro: não busca dados, não persiste, não notifica, não lê relógio (`asOf` vem do contexto), não altera o lote.
- `null` nunca é `false`; fonte não carregada também é UNKNOWN (ex.: sem a análise, MISSING_AREA não dispara).
- Regras base não dependem do cliente atual (validador recusa `CUSTOMER_*` fora de regra `contextType: CUSTOMER`).
- Score, classe, Fit, Recommendation, vencedor da comparação e estado de Availability não são lidos para decidir nem alterados (teste de invariantes).
- Execução inicial em `SHADOW`; a UI só troca quando `dev.features.ruleEngineAlerts === true` (flag `RULE_ENGINE_ALERTS_ENABLED`, padrão desligado).
