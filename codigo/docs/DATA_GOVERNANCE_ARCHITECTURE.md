# Arquitetura de governança de dados (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

## Camadas
1. **Políticas** (config): `platform.json` (domínios, regras obrigatórias, rule sets, gates, severidade de incidente, glossário) ← `org_house7.json` (owners, RACI, exceções, SLOs, certificação) ← `viva-juara.json` (regras do empreendimento, volume, frescor, reconciliação, contratos, limitações, dívida, baselines). Merge em `App.dataQuality.model.policy(devId)` com validação (regra obrigatória não pode ser enfraquecida; correção automática NEVER para identidade/geometria; dependências em DAG; avaliador registrado; exceção permitida exige duração máxima).
2. **Motor** (`src/dataquality/dqEngine.js`): registro de avaliadores, runner, findings agrupados, exceções, gates, frescor, drift, volume, reconciliação, saúde, scorecard, SLOs, prontidão de recomendação.
3. **Workflow** (`dqWorkflow.js`): ciclo de vida de finding, exceção, versão/promoção de regra, incidente/RCA/remediação/postmortem, mudanças, troca de fonte de autoridade, contratos, certificação. Ator = `{id, organizationId, can(perm)}`; deny by default; outra organização = NOT_FOUND.
4. **Backoffice** (`dqView.js`): HTML escapado, sem `data-act` (o painel publicado não muda).
5. **Backend** (`backend/src/modules/dataquality/*`): loader do domínio compartilhado, serviço, repositório (memória + Postgres), controller com ROUTE_POLICIES (não ligado ao router), OpenAPI pronto, migração 015.

## Reuso (sem duplicar)
- `App.governance`/`App.permissions`/`App.authz`: chaves `data_quality.*` e `data_governance.*` no registro (sem grants).
- `App.model.FIELDS` (Field Registry): catálogo semântico e campos críticos.
- `App.availability.canTransition`: transições de disponibilidade.
- `App.legacy.normalize`: normalização de linhas de batch (tópico 58).
- Proveniência/confiança: DQ-PROV-001 verifica `sourceId` no Field Registry; a qualidade não recalcula confiança.

## Gate para o tópico 58
`App.dataQuality.evaluateGate({actionCode:'ONBOARDING_BATCH', developmentId, rows|lots, priceEntries, batchRef}) → {decision: PASS|BLOCK|REVIEW, findings, reasons}`.
