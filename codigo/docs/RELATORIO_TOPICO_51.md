# Relatório do tópico 51 — Observabilidade da plataforma

Data: 12/10/2026. Testes do tópico: 37 de 37 passando (`tests/observability.test.js`). Paridade de cores do mapa: diferença 0. Nenhum ID, geometria, score, classe, preço (R$ 1.196/m², tabela de 06/10/2026) ou disponibilidade mudou; os 498 lotes seguem "não confirmado".

## Em uma frase

O painel ganhou um sistema de diagnóstico que fica só no aparelho: registra erros com um código de suporte, mede o desempenho (mapa, QuickView, Web Vitals), mostra a saúde e a atualidade dos dados no modo Técnico e define os contratos para o servidor. Nada é enviado.

## O que existia (inventário)

- Logs: 34 `console.*` no navegador (nenhum com token, senha, cookie ou corpo); logger JSON no servidor com requestId.
- Métricas: espalhadas (mapa, carregamento, cache, analytics de produto). Nenhum registro único, nada no servidor.
- Tracing, error monitoring, alertas, SLOs, runbooks: não existiam. `/health` e `/health/ready` existiam.
- Riscos de PII: baixos (nenhum log de corpo). O maior risco era futuro: sem redaction central, sem regra de label.

Detalhes: OBSERVABILITY_LEGACY_MIGRATION_REPORT.md e OBSERVABILITY_LEGACY_INVENTORY.json.

## O que foi feito

| Item | Onde | Doc |
|---|---|---|
| ObservabilityContext, requestId ≠ correlationId ≠ traceId, W3C traceparent, propagação só para mesma origem | obsCore.js | OBSERVABILITY_CONTEXT_AND_CORRELATION.md |
| StructuredLogger (30 eventCodes, níveis por ambiente, buffer com prioridade) | obsCore.js | STRUCTURED_LOGGING_POLICY.md |
| LogRedactionPolicy (chaves bloqueadas/mascaradas, 8 detectores, limites, URL e pilha sanitizadas) | obsCore.js | LOG_REDACTION_POLICY.md |
| ApplicationError (30 códigos, 15 mensagens seguras), ErrorReporter (fingerprint, dedupe 60 s, 60/min, sem recursão), Error Boundaries, handlers globais | obsCore.js | APPLICATION_ERROR_TAXONOMY.md, FRONTEND_OBSERVABILITY.md |
| Registro: 85 métricas (46 no aparelho, 39 contratos), 19 spans, 18 alertas, 13 runbooks, 6 SLOs, 6 painéis, 5 checks sintéticos | scripts/observabilityRegistry.js → docs/OBSERVABILITY_REGISTRY.json + config/observability/registry.json | METRICS_REGISTRY.md, OPERATIONAL_ALERTING_POLICY.md |
| MetricsClient (labels controlados, 50 séries por métrica, p50/p95/p99) e TracerClient (erros sempre guardados, sweep) | obsSignals.js | METRICS_REGISTRY.md, DISTRIBUTED_TRACING_POLICY.md |
| Web Vitals (LCP, CLS, INP aproximado), tarefas longas, Navigation Timing; coletores que reaproveitam geo/perf.js, LoadCoordinator, CacheManager | obsSignals.js | FRONTEND_OBSERVABILITY.md, MAP_OBSERVABILITY.md, CACHE_LAZY_PWA_OBSERVABILITY.md |
| Saúde (live, ready, conectividade, dependências) e atualidade dos dados (lê o FreshnessState, não recalcula) | obsSignals.js | HEALTH_CHECK_POLICY.md |
| SLO, error budget, burn rate; alertas locais com cooldown, sem paging | obsSignals.js | SLO_AND_ERROR_BUDGET_POLICY.md |
| Sinks (LOCAL ligado, CONSOLE só em development, REMOTE desligado), mapeamento OTLP, validação do registro (CI), mudanças operacionais, marcador de release | obsPlatform.js | OBSERVABILITY_ARCHITECTURE.md, RELEASE_AND_CHANGE_OBSERVABILITY.md |
| SupportDiagnosticSnapshot + "Copiar diagnóstico técnico"; visão "Saúde da plataforma" (modo Técnico) | obsPlatform.js | SUPPORT_DIAGNOSTICS.md, OBSERVABILITY_DASHBOARDS.md |
| Segurança: só contagens agregadas; tenant scope CRITICAL nunca silenciado | obsPlatform.js | SECURITY_OBSERVABILITY_BOUNDARY.md |
| Servidor: helper puro (traceparent, correlação, redaction, RED por modelo de rota, Prometheus, /health/live) | backend/src/shared/observability/telemetry.js | API_AND_DATABASE_OBSERVABILITY.md, JOB_AND_QUEUE_OBSERVABILITY.md |
| Custo e retenção | policy.json | OBSERVABILITY_COST_AND_RETENTION.md |

Verificação no navegador (Chromium headless local, 390 px, com os módulos injetados numa cópia do painel): handlers instalados, 2 erros de teste agrupados (`API_SERVER_ERROR`, `FRONTEND_UNEXPECTED`), Web Vitals coletados, nenhum e-mail no log, nenhuma requisição a terceiros.

## Antes e depois

Antes: "não sei, tenta reproduzir". Depois, no aparelho: erro → código VJ-XXXXXX → grupo com área, versão e contagem → diagnóstico copiável. No servidor (quando O1 for decidido): requestId → trace → logs → métricas.

## Pontos cegos que continuam

- Nada chega a um servidor: sem O1 não existe visão agregada de todos os usuários, nem paging.
- Servidor: métricas RED, tracing e /health/live existem como helper e contrato, não ligados em `backend/src/app.js`.
- Jobs, fila, documentos, publicação de preço: não há infraestrutura; só contratos.
- INP é aproximado (maior interação observada).
- Os 21 `console.error` do app.js e o do map.js só serão migrados quando a integração for feita.

## Alertas sem pessoa responsável

Todos os 18: os donos são lógicos (frontend-plataforma, frontend-mapa, frontend-pwa, backend-api, backend-dados, backend-jobs, backend-documentos, dados-comercial, seguranca). Nenhum canal está configurado.

## Decisões que dependem de você

1. **O1** Destino remoto da telemetria (provedor/coletor OpenTelemetry, região, acesso com SSO/MFA/RBAC). Hoje desligado.
2. **O2** Source maps privados (junto com O1).
3. **O3** Envio de Web Vitals reais (agregado, sem URL) e base legal.
4. **O4** Orçamento: GB/dia de logs, retenção por gravidade, amostragem de traces no servidor.
5. **O5** Metas de SLO após 4 semanas de linha de base (hoje "necessita confirmação").
6. **O6** Pessoas, canal e escalonamento de cada alerta.
7. **O7** De quanto em quanto tempo disponibilidade e preço devem ser atualizados (para alertar ausência de atualização).
8. **O8** Permissão própria para a visão (`ops.diagnostics.read`), hoje igual ao modo Técnico.
