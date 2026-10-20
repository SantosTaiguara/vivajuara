# Relatório — Tópico 61: Qualidade de Dados e Governança Operacional

Data: 2026-10-16/17 · política `dq-platform-2026-10-16.1` · checagem real somente leitura (nenhum dado alterado).

## Entregue
- **Domínio compartilhado** `src/dataquality/`: `dqModel.js` (domínios, merge/validação de política plataforma ← organização ← empreendimento, owners, RACI, catálogo semântico a partir do Field Registry, glossário, limitações, matriz de autoridade), `dqEngine.js` (30 avaliadores, runner, findings agrupados, exceções, gates, frescor por uso, drift de schema/distribuição/volume, reconciliação, saúde, scorecard, SLOs, prontidão de recomendação), `dqWorkflow.js` (ciclo de finding, exceção, versão/promoção de regra, incidentes SEV1–SEV4 com RCA/remediação/postmortem, mudanças, troca de fonte, contratos, certificação), `dqView.js` (backoffice, HTML escapado, sem `data-act`).
- **Config** `config/dataquality/`: `platform.json` (12 domínios, 26 regras, 5 rule sets, 9 gates), `org_house7.json` (owners/RACI/SLOs/exceções/certificação todos null), `viva-juara.json` (regras do empreendimento, volume, frescor, reconciliação, 4 contratos, 7 limitações, 4 dívidas, baselines de schema e distribuição calculados dos dados publicados).
- **Backend** `backend/src/modules/dataquality/`: loader, serviço, repositório (memória + Postgres), controller (14 rotas, não ligado), OpenAPI pronto; migração 015 + down.
- **Gate para o tópico 58**: `App.dataQuality.evaluateGate(input) → {decision: PASS|BLOCK|REVIEW, findings, reasons}`.
- 10 permissões novas (`data_quality.*`, `data_governance.*`) sem grants; 30 docs + seção no `DATA_OWNERSHIP_MATRIX.md`.

## Achados reais (498 lotes, 2026-10-16T12:00Z) — run `PASSED_WITH_WARNINGS`
| Regra | Resultado |
|---|---|
| Identidade, tenant, geometria (validade, auto-interseção, limites), preço (referência, duplicidade, valor, versão), análise (versão, scores), schema, distribuição, volume (498) | **PASS** |
| DQ-AVAIL-002 | 498/498 lotes com disponibilidade **UNKNOWN** (sem espelho de vendas) |
| DQ-AVAIL-003 / DQ-TX-001 / DQ-AVAIL-005/006 | não avaliadas (nenhum status conhecido / nenhum vendido / sem snapshot anterior) |
| DQ-PROV-001 | `identity.id` e `identity.developmentId` sem `sourceId` no Field Registry (2/9 campos críticos) |
| DQ-NULL-001 (SHADOW) | 30 de 54 campos anuláveis têm nulos (ex.: `identity.blockNumber`, `identity.externalCode` 498/498) |

Saúde: geral **UNKNOWN** — AVAILABILITY UNKNOWN (frescor desconhecido, sem fonte autoritativa), LOT_IDENTITY DEGRADED, GEOMETRY/PRICING/ANALYSIS HEALTHY, DEVELOPMENT/DOCUMENTS UNKNOWN (sem regras), 5 domínios inativos não monitorados.
Gates: ONBOARDING_BATCH **PASS** no batch atual; RESERVATION e PROPOSAL_SUBMIT **BLOCK** (frescor de disponibilidade UNKNOWN para uso transacional).

## Owners e autoridade não resolvidos
- Business owner, steward e technical owner: **nenhum atribuído** nos 12 domínios; RACI (5 domínios críticos × 8 atividades) vazio.
- Fonte autoritativa: AVAILABILITY e DOCUMENTS sem fonte definida.
- Regras sem owner rodando em WARNING: DQ-TX-001, DQ-VOL-001.

## Decisões humanas pendentes
Owners/stewards/RACI; fonte autoritativa de disponibilidade; limiares de frescor (display/decision/transaction); metas de SLO; política e duração de exceções; tolerância de volume; limiares de distribuição; validade de certificação; confirmação da política de severidade SEV1–SEV4; confirmação da criticidade sugerida dos domínios; política de prontidão de recomendação; unidade monetária mínima; códigos de domínio no ERROR_CATALOG (hoje VALIDATION_ERROR + details.reason); grant automático a OWNER_ADMIN no IAM do backend.

## Decisões tomadas (técnicas, reversíveis)
- Módulos fora do ORDER e do bundle do browser (orçamento de página): carregados por `attachDataQuality` (backend/tópico 58/console).
- Regras EVENT_DRIVEN (transacionais) não entram na avaliação de saúde; rodam nos gates.
- Avaliação no backend usa a organização declarada no config do empreendimento quando `App.tenancy` não existe.
- Correção automática NEVER para identidade, geometria, preço e disponibilidade; SAFE_ONLY só para índice espacial derivado.

## Adiado
Ligar rotas no router e paths no `openapiDoc.js`; data-acts e feature `dataQuality.manage` (coordenador); integração da view no console do tópico 60; repositório Postgres para certifications/reconciliations/changes (memória apenas); agendamento SCHEDULED; alertas; testes com Postgres (sem senha no ambiente).
