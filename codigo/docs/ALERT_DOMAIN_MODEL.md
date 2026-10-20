# Modelo do domínio de alertas (Tópico 36)

| Conceito | Onde | Observações |
|---|---|---|
| RuleDefinition | `config/rules/<dev>.json#definitions` | id imutável, `code` estável (não é rótulo de UI), categoria, alvo LOT, `contextType` BASE/CUSTOMER/SHARE, escopo (organização + empreendimentos), `currentPublishedVersionId` |
| RuleVersion | `#versions` | condição, parâmetros, severityPolicy, unknownPolicy, templates, lifecyclePolicy, suppression/hysteresis, `legacyProjection`, checksum; lifecycle DRAFT→VALIDATED→PUBLISHED→ARCHIVED / REJECTED |
| RuleSetVersion | `#ruleSet` | lista coerente de versões, publicada de forma atômica |
| CompiledRuleVersion | `App.ruleEngine.compile` | congelada; inclui `dependencyManifest` e `engineCompatibility` |
| RuleEvaluationInput | `App.alerts.facts.inputFor` | `{ organizationId, developmentId, entity, facts: { metrics, attributes }, context: { asOf, executionMode, dataVersionRefs, contextDiscriminator } }` — snapshot coerente para todas as regras |
| RuleEvaluationResult | `App.ruleEngine.evaluate` | truth, severity, reasonCodes, `evaluatedOperands` (traço), evidenceRefs, `evaluationFingerprint`, warnings, errors |
| AlertCandidate | `App.alerts.candidateOf` | alertKey, alertFingerprint, reasonType CONDITION/REVIEW/DATA_QUALITY, mensagens por público, explicação |
| AlertInstance | `App.alerts.store().reconcile` | estado ACTIVE/ACKNOWLEDGED/SNOOZED/RESOLVED/DISMISSED, severidade atual, versão de regra atual, ocorrências, `version` otimista, episódios |
| AlertEpisode | `instance.episodes[]` | um intervalo ativo; reconhecimento vale para o episódio |
| AlertExplanation | `App.ruleEngine.explain` | triggerFacts / thresholdFacts tirados do traço (nunca recalculados), caveats de dado não disponível |
| AlertEvidenceRef | resultado | RULE_OPERAND + versões de dado **apenas dos domínios que a regra lê** |

`alertKey = ruleDefinitionId | LOT | lotId | contextDiscriminator (BASE ou ref do cliente/compartilhamento) | reasonType`. A versão da regra não faz parte da chave: nova versão continua a mesma ocorrência lógica (mudança semântica grande = nova RuleDefinition).

Alertas de cliente (`CUSTOMER`) e de compartilhamento (`SHARE`) usam discriminador próprio e nunca entram no fluxo base do lote. Eventos carregam ids e códigos, nunca texto ou PII.
