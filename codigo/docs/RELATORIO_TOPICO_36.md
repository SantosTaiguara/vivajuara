# Relatório — Tópico 36: Alertas como Rule Engine

## Resumo
Os 10 alertas da análise (lots.json "al" / metodologia 1.0.0), o aviso de disponibilidade do statusVM e os 3 avisos do compartilhamento (shareVM) viraram 14 regras declarativas versionadas (`config/rules/viva-juara.json`, rule set `ruleset:viva-juara:legacy-v1`). Em SHADOW, a saída do Rule Engine é **idêntica** à legada nos 498 lotes: 404/404 alertas, mesmos textos, severidades, ids, ordem e lotes; notas de status (corretor e cliente) e avisos de compartilhamento idênticos em todos os cenários testados. A UI não foi trocada (flag `RULE_ENGINE_ALERTS_ENABLED`, padrão desligado).

## Inventário e classificação
Ver LEGACY_ALERT_MIGRATION_REPORT.md (30 itens: DOMAIN_ALERT, DATA_QUALITY_WARNING, UI_HINT, VALIDATION_ERROR, RECOMMENDATION_REASON, TECHNICAL_DIAGNOSTIC). Duplicações: STATUS_NOTE × SHARE_STATUS (mantidas separadas, revisão humana), aviso da comparação = mesmo warn do statusVM. Bugs legados preservados e documentados: MISSING_AREA sem ":" (lido como OTHER); limite "frente estreita" fixo em engine.js; dependência circular easements ← texto do alerta.

## Entregas por item do spec
- RuleDefinition / RuleVersion / RuleSetVersion, lifecycle DRAFT→VALIDATED→PUBLISHED→ARCHIVED/REJECTED, publicada imutável, latest ≠ current, publicação atômica com concorrência otimista, rollback com reavaliação, histórico de ativação/asOf: `App.ruleEngine.ruleSetRegistry`.
- AST declarativa (LOGICAL/COMPARISON/EXISTS/PREDICATE), operadores, operandos ATTRIBUTE (Field Registry), METRIC (registry versionado), CONFIG, LITERAL, CONTEXT; predicados IS_NOT_CONFIRMED_FRESH e IS_OFFERABLE; sem eval: RULE_AST_AND_OPERATOR_SPEC.md.
- Verdade TRUE/FALSE/UNKNOWN/ERROR/NOT_APPLICABLE (Kleene), null nunca é false, fonte não carregada = UNKNOWN; unknownPolicy explícita por regra (todas as migradas: NO_ALERT, que reproduz o legado).
- Compiler, validator, dependency manifest, índice e planner de reavaliação seletiva; evaluation fingerprint; explicação a partir do traço; evidências só dos domínios lidos.
- AlertCandidate, AlertInstance, episódios, reconciliação (dedup, escalonamento, auto-resolução, reabertura, UNKNOWN mantém, ERROR ignora), supressão, histerese, ações reconhecer/adiar/descartar com permissão injetada (negar por padrão), sem escrita offline, versão otimista; eventos sem PII como gancho de notificação; modo REPLAY sem mutação.
- Projeção CLIENT/BROKER/TECHNICAL, ordenação determinística, resumo do Quick View (paridade com quickview.alertSummary).
- Paridade: `App.alertMigration.parityReport` → LEGACY_ALERT_PARITY_REPORT.md.

## Arquivos
Criados: `src/rules/ruleCore.js`, `src/rules/alertDomain.js`, `src/rules/legacyAlertMigration.js`, `config/rules/viva-juara.json`, `tests/rules.test.js`, docs RULE_ENGINE_ARCHITECTURE, RULE_AST_AND_OPERATOR_SPEC, ALERT_DOMAIN_MODEL, ALERT_LIFECYCLE_AND_RECONCILIATION, RULE_DEPENDENCY_AND_REEVALUATION, RULESET_VERSIONING_AND_PUBLICATION, ALERT_UI_PROJECTION_POLICY, LEGACY_ALERT_MIGRATION_REPORT, LEGACY_ALERT_PARITY_REPORT.
Alterados (aditivo): `src/intelligence/engine.js` (resultado ganha `metrics` — as métricas base sem arredondamento; nenhum valor muda), `scripts/configBundle.js` (subpastas `rules` e `versioning` na lista).

## Testes
`tests/rules.test.js`: 34 testes, incluindo golden RoadProximityWarning/Critical, UnknownSetbackData, StaleAvailabilityConfirmation, StalePricingWarning, CustomerBudgetContextAlert, RuleSeverityEscalation, RuleAutoResolution, RuleReopenEpisode, HysteresisPreventsFlapping, SuppressionPreventsDuplicateSpam, RuleVersionShadowParity, RuleSetRollbackReevaluation, HistoricalReplayNoLiveMutation; invariantes (lotes byte-idênticos, scores/classes/rankings iguais, nenhum acesso a Fit/Recommendation/Compare). Desempenho: 14 regras × 498 lotes bem abaixo de 5 s.

## Adiado / limitações
- SourceConflictReviewAlert e LowConfidenceCriticalField: dependem de Provenance/Confidence (Tópicos 33/34) expostos como métricas; o registry aceita novas métricas, mas nada foi inventado.
- Persistência (Postgres), API REST e agendador de snooze: só contratos (ALERT_DOMAIN_MODEL, ALERT_LIFECYCLE…). O AlertStore é em memória.
- Editor de regras: não feito (catálogo em JSON é suficiente).
- Mapa/filtro por alerta continuam lendo a lista legada (mesmos tipos); a troca acontece junto com a da UI.

## Decisões humanas pendentes
Ligar a flag; quem tem `rule.publish`, `alert.acknowledge`, `alert.snooze`, `alert.dismiss`; corrigir MISSING_AREA (novo tipo no enum) — muda a saída, exige nova versão; consolidar ou não STATUS_NOTE × SHARE_STATUS; adotar ou não a nomenclatura NOTICE/WARNING de severidade.
