# Matriz de testes — Jornada (Tópico 40)

Arquivo: `tests/journey.test.js` (18 testes, cobrindo os 21 cenários dourados do §450).

| Cenário | Teste |
|---|---|
| NewJourneyForCustomer | etapa inicial, baseline, unicidade, permissão |
| CustomerWithTwoDevelopmentJourneys | jornadas independentes; seleção quando ambíguo |
| (modelo) | versão publicada congelada, rascunho V2, impacto, plano de migração aprovado |
| JourneyValidStageTransition / JourneyInvalidStageTransition / JourneyStageOverrideWithReason | grafo, motivo, override auditado, conflito de revisão, offline |
| JourneyPauseAndResume | etapa preservada |
| JourneyNextActionOverdue | OVERDUE derivado, DUE_SOON, atenção, aging por etapa |
| JourneyRecommendationGenerated / Presented | distintos; apresentação confirmada; payload mínimo |
| JourneyCustomerFavoriteMilestone | só contexto CUSTOMER; ruído de UI ignorado |
| JourneyComparisonCreated / JourneyFinancialSimulationCreated | ref, coalescência, links sem cópia |
| JourneyVisitScheduledAndCompleted | touchpoint sem mensagem; sugestões não aplicadas |
| JourneyDocumentRequestedReceived | só ref (sem nome de arquivo) |
| JourneyClosedWonWithReservationRef / JourneyClosedLostWithReason | resultado explícito; disponibilidade intacta (498 UNKNOWN) |
| JourneyLateArrivingEvent | ordem por occurredAt; correção; visibilidade; atividade significativa |
| JourneyEventDeduplication | retry idempotente; cross-tenant |
| JourneyCRMStageConflict | não mapeado, autoridade interna, revisão manual, transição externa válida |
| JourneyLegacyMigrationWithoutHistory | sem histórico fabricado; UNKNOWN; evidência de resultado; duplicatas |
| JourneyTenantIsolation | serviços: compare-and-set atômico, IDOR, atribuição, board, auditoria sem PII, atribuição de origem |
| regressão/UI | sem "valorização", pipeline fora da UI, chip "Maria · Negociação", sem storage/mutação de lote |

Não testável aqui: endpoints/DB, notificações (fora do escopo), analytics (tópicos 44/45).
