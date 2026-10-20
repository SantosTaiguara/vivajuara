<!-- GERADO por plat/scripts/analyticsDocs.js a partir de plat/config/analytics — não editar à mão. -->
# Catálogo de métricas (tópico 44)

Registro v1.0.0 · funis v1.0.0 · dimensões v1.0.0 · transformação v1.0.0.

| Código | Nome | Domínio | Entidade | Medida | Fórmula (expressionRef) | Numerador / Denominador | Base de tempo | 0/0 | Dimensões | Versão | Status | Disponível no aparelho |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `product_sessions` | Sessões de produto | PRODUCT | SESSION | DISTINCT_COUNT | distinct_entities (*PRODUCT) | — | occurredAt | NOT_APPLICABLE | deviceClass, developmentId | 1.0.0 | PUBLISHED | sim |
| `lot_views` | Seleções de lote | PRODUCT | EVENT | COUNT | count_events (lot_selected) | — | occurredAt | NOT_APPLICABLE | selectionSource, lotRef, deviceClass, developmentId | 1.0.0 | PUBLISHED | sim |
| `distinct_lots_viewed` | Lotes distintos vistos | PRODUCT | LOT | DISTINCT_COUNT | distinct_entities (lot_selected) | — | occurredAt | NOT_APPLICABLE | selectionSource, deviceClass, developmentId | 1.0.0 | PUBLISHED | sim |
| `lot_views_per_session` | Seleções de lote por sessão | PRODUCT | SESSION | RATIO | ratio | lot_views / product_sessions | occurredAt | NULL | deviceClass, developmentId | 1.0.0 | PUBLISHED | sim |
| `sessions_with_filter` | Sessões com filtro | PRODUCT | SESSION | DISTINCT_COUNT | distinct_entities (filter_applied, filter_suggestion_applied, legend_filter_applied) | — | occurredAt | NOT_APPLICABLE | deviceClass, developmentId | 1.0.0 | PUBLISHED | sim |
| `filter_usage_rate` | Uso de filtros | PRODUCT | SESSION | RATE | rate | sessions_with_filter / product_sessions | occurredAt | NULL | deviceClass, developmentId | 1.0.0 | PUBLISHED | sim |
| `sessions_with_zero_result` | Sessões que chegaram a zero lotes | PRODUCT | SESSION | DISTINCT_COUNT | distinct_entities (filter_zero_result) | — | occurredAt | NOT_APPLICABLE | deviceClass | 1.0.0 | PUBLISHED | sim |
| `filter_zero_result_rate` | Filtros sem resultado | PRODUCT | SESSION | RATE | rate | sessions_with_zero_result / sessions_with_filter | occurredAt | NULL | deviceClass | 1.0.0 | PUBLISHED | sim |
| `comparisons_created` | Comparações criadas | PRODUCT | EVENT | COUNT | count_events (comparison_created) | — | occurredAt | NOT_APPLICABLE | developmentId | 1.0.0 | PUBLISHED | sim |
| `comparisons_opened` | Comparações abertas | PRODUCT | EVENT | COUNT | count_events (comparison_opened) | — | occurredAt | NOT_APPLICABLE | developmentId | 1.0.0 | PUBLISHED | sim |
| `comparison_candidates_added` | Lotes adicionados à comparação | PRODUCT | EVENT | COUNT | count_events (comparison_candidate_added) | — | occurredAt | NOT_APPLICABLE | developmentId | 1.0.0 | PUBLISHED | sim |
| `sessions_with_comparison` | Sessões com comparação aberta | PRODUCT | SESSION | DISTINCT_COUNT | distinct_entities (comparison_opened) | — | occurredAt | NOT_APPLICABLE | deviceClass, developmentId | 1.0.0 | PUBLISHED | sim |
| `comparison_usage_rate` | Uso da comparação | PRODUCT | SESSION | RATE | rate | sessions_with_comparison / product_sessions | occurredAt | NULL | deviceClass, developmentId | 1.0.0 | PUBLISHED | sim |
| `avg_candidates_per_comparison` | Lotes por comparação (média) | PRODUCT | EVENT | AVERAGE | avg_field (comparison_opened) | — | occurredAt | NULL | developmentId | 1.0.0 | PUBLISHED | sim |
| `sessions_with_recommendation` | Sessões que usaram a recomendação | PRODUCT | SESSION | DISTINCT_COUNT | distinct_entities (recommendation_opened, recommendation_preset_toggled, recommendation_scope_changed) | — | occurredAt | NOT_APPLICABLE | deviceClass | 1.0.0 | PUBLISHED | sim |
| `recommendation_usage_rate` | Uso da recomendação | PRODUCT | SESSION | RATE | rate | sessions_with_recommendation / product_sessions | occurredAt | NULL | deviceClass | 1.0.0 | PUBLISHED | sim |
| `share_preparations` | Preparações de compartilhamento | PRODUCT | EVENT | COUNT | count_events (share_dialog_opened, share_link_copied) | — | occurredAt | NOT_APPLICABLE | eventName | 1.0.0 | PUBLISHED | sim |
| `favorites_added` | Favoritos adicionados | PRODUCT | EVENT | COUNT | count_events (favorite_added) | — | occurredAt | NOT_APPLICABLE | contextType | 1.0.0 | PUBLISHED | sim |
| `presentations_started` | Apresentações iniciadas | PRODUCT | PRESENTATION_SESSION | DISTINCT_COUNT | distinct_entities (presentation_started) | — | occurredAt | NOT_APPLICABLE | — | 1.0.0 | PUBLISHED | sim |
| `presentations_completed` | Apresentações concluídas | PRODUCT | PRESENTATION_SESSION | DISTINCT_COUNT | distinct_entities (presentation_completed) | — | occurredAt | NOT_APPLICABLE | — | 1.0.0 | PUBLISHED | sim |
| `presentation_completion_rate` | Conclusão de apresentações | PRODUCT | PRESENTATION_SESSION | RATE | cohort_rate | presentations_completed / presentations_started | occurredAt do início (coorte) | NULL | — | 1.0.0 | PUBLISHED | sim |
| `presentation_steps_viewed` | Etapas vistas (primeira vez) | PRODUCT | EVENT | COUNT | count_events (presentation_step_viewed) | — | occurredAt | NOT_APPLICABLE | — | 1.0.0 | PUBLISHED | sim |
| `presentation_feedbacks` | Reações em apresentações | PRODUCT | EVENT | COUNT | count_events (presentation_feedback_recorded) | — | occurredAt | NOT_APPLICABLE | — | 1.0.0 | PUBLISHED | sim |
| `deep_link_restores` | Links profundos restaurados | PRODUCT | EVENT | COUNT | count_events (deep_link_restored) | — | occurredAt | NOT_APPLICABLE | restoreStatus | 1.0.0 | PUBLISHED | sim |
| `deep_link_full_restores` | Links restaurados por completo | PRODUCT | EVENT | COUNT | count_events (deep_link_restored) | — | occurredAt | NOT_APPLICABLE | — | 1.0.0 | PUBLISHED | sim |
| `deep_link_restore_success_rate` | Links restaurados por completo (%) | PRODUCT | EVENT | RATE | rate | deep_link_full_restores / deep_link_restores | occurredAt | NULL | — | 1.0.0 | PUBLISHED | sim |
| `layer_changes` | Trocas de camada/fundo | PRODUCT | EVENT | COUNT | count_events (map_layer_changed, overlay_toggled, base_map_changed) | — | occurredAt | NOT_APPLICABLE | eventName, layerId | 1.0.0 | PUBLISHED | sim |
| `time_to_first_lot_selection` | Tempo até o primeiro lote (mediana) | PRODUCT | SESSION | MEDIAN | session_duration_percentile | — | occurredAt | NULL | deviceClass | 1.0.0 | PUBLISHED | sim |
| `analytics_event_drop_rate` | Eventos descartados | DATA_QUALITY | EVENT | RATE | health_rate | — | capturedAt | NULL | — | 1.0.0 | PUBLISHED | sim |
| `analytics_quarantine_rate` | Eventos em quarentena | DATA_QUALITY | EVENT | RATE | health_rate | — | capturedAt | NULL | — | 1.0.0 | PUBLISHED | sim |
| `analytics_sampled_out_rate` | Eventos amostrados fora | DATA_QUALITY | EVENT | RATE | health_rate | — | capturedAt | NULL | — | 1.0.0 | PUBLISHED | sim |
| `journey_win_rate` | Taxa de ganho das jornadas | COMMERCIAL | JOURNEY | RATE | facts_rate | — | closedAt | NULL | sourceCode, campaignRef, developmentId, ownerUserId | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `journey_loss_rate` | Taxa de perda das jornadas | COMMERCIAL | JOURNEY | RATE | facts_rate | — | closedAt | NULL | sourceCode, developmentId | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `share_open_rate_by_issue_cohort` | Abertura de links (coorte de emissão) | COMMERCIAL | SHARE_GRANT | RATE | facts_cohort_rate | — | issuedAt (coorte) | NULL | developmentId | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `share_opens_in_period` | Aberturas de links no período | COMMERCIAL | SHARE_ACCESS_SESSION | COUNT | facts_count | — | openedAt | NOT_APPLICABLE | developmentId | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `share_time_to_first_open` | Tempo até a primeira abertura (mediana) | COMMERCIAL | SHARE_GRANT | MEDIAN | facts_duration_percentile | — | issuedAt | NULL | — | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `median_time_to_first_contact` | Tempo até o primeiro contato (mediana) | COMMERCIAL | JOURNEY | MEDIAN | facts_duration_percentile | — | acquiredAt | NULL | sourceCode, ownerUserId | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `stage_conversion_rate` | Conversão entre etapas | COMMERCIAL | JOURNEY | RATE | stage_conversion | — | occurredAt da entrada em A | NULL | sourceCode | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `completed_stage_duration` | Tempo em etapa concluída (mediana) | COMMERCIAL | JOURNEY | MEDIAN | stage_duration | — | occurredAt da saída | NULL | — | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `current_stage_age` | Idade na etapa atual (mediana) | COMMERCIAL | JOURNEY | MEDIAN | stage_duration | — | asOf | NULL | — | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `recommendation_to_visit_rate` | Jornadas com recomendação que chegaram a visita | COMMERCIAL | JOURNEY | RATE | facts_sequence_rate | — | generatedAt (coorte) | NULL | sourceCode | 1.0.0 | PUBLISHED | não (precisa do servidor) |
| `cost_per_win` | Custo por jornada ganha | MARKETING | JOURNEY | RATIO | blocked | — | closedAt | NULL | sourceCode, campaignRef | 0.1.0 | DRAFT | não (precisa do servidor) |

## Definições

### `product_sessions` — Sessões de produto

Sessões de produto distintas com pelo menos um evento de produto aceito.

Ressalvas: Sessão de produto = 30 min de inatividade; não é sessão de login nem de apresentação.

Linhagem: FactProductEvent → dedupe eventId; distinct productSessionId.

### `lot_views` — Seleções de lote

Número de seleções explícitas de lote (reseleção do mesmo lote não conta).

Linhagem: FactProductEvent → dedupe eventId; ON_CHANGE por lote.

### `distinct_lots_viewed` — Lotes distintos vistos

Lotes distintos selecionados ao menos uma vez.

Linhagem: FactProductEvent → distinct entity.lotRef.

### `lot_views_per_session` — Seleções de lote por sessão

Seleções de lote ÷ sessões de produto no mesmo período.

Linhagem: FactProductEvent → lot_views / product_sessions.

### `sessions_with_filter` — Sessões com filtro

Sessões de produto com pelo menos um filtro aplicado.

Linhagem: FactProductEvent → distinct productSessionId.

### `filter_usage_rate` — Uso de filtros

Sessões com filtro ÷ sessões de produto.

Linhagem: FactProductEvent → distinct sessions.

### `sessions_with_zero_result` — Sessões que chegaram a zero lotes

Sessões em que os filtros chegaram a zero lotes ao menos uma vez.

Linhagem: FactProductEvent → distinct sessions.

### `filter_zero_result_rate` — Filtros sem resultado

Sessões que chegaram a zero lotes ÷ sessões com filtro.

Linhagem: FactProductEvent → distinct sessions.

### `comparisons_created` — Comparações criadas

Sessões de comparação criadas.

Linhagem: FactProductEvent → count.

### `comparisons_opened` — Comparações abertas

Matrizes de comparação montadas.

Linhagem: FactProductEvent → count.

### `comparison_candidates_added` — Lotes adicionados à comparação

Adições bem-sucedidas de lote à comparação.

Linhagem: FactProductEvent → count.

### `sessions_with_comparison` — Sessões com comparação aberta

Sessões de produto em que uma matriz de comparação foi aberta.

Linhagem: FactProductEvent → distinct sessions.

### `comparison_usage_rate` — Uso da comparação

Sessões com comparação aberta ÷ sessões de produto.

Linhagem: FactProductEvent → distinct sessions.

### `avg_candidates_per_comparison` — Lotes por comparação (média)

Média de candidatos nas matrizes abertas.

Linhagem: FactProductEvent → média de candidateCount.

### `sessions_with_recommendation` — Sessões que usaram a recomendação

Sessões com resultado de recomendação aberto, perfil pronto ou escopo ligado.

Linhagem: FactProductEvent → distinct sessions.

### `recommendation_usage_rate` — Uso da recomendação

Sessões que usaram a recomendação ÷ sessões de produto.

Linhagem: FactProductEvent → distinct sessions.

### `share_preparations` — Preparações de compartilhamento

Janelas de compartilhamento abertas e links copiados (preparar ≠ enviar ≠ abrir).

Linhagem: FactProductEvent → count.

### `favorites_added` — Favoritos adicionados

Favoritos persistidos, por contexto (pessoal ≠ do cliente).

Linhagem: FactProductEvent → count via Domain Bridge (FavoriteAdded).

### `presentations_started` — Apresentações iniciadas

Sessões de apresentação distintas iniciadas.

Linhagem: FactProductEvent → Domain Bridge PresentationStarted; distinct presentationSessionId.

### `presentations_completed` — Apresentações concluídas

Sessões de apresentação com conclusão explícita do apresentador.

Linhagem: FactProductEvent → Domain Bridge PresentationCompleted; distinct presentationSessionId.

### `presentation_completion_rate` — Conclusão de apresentações

Das sessões de apresentação iniciadas no período, quantas tiveram conclusão explícita (coorte de início).

Ressalvas: Chegar à última etapa não é conclusão.

Linhagem: FactProductEvent → coorte de presentation_started; ∩ presentation_completed.

### `presentation_steps_viewed` — Etapas vistas (primeira vez)

Primeiras visualizações de etapa por sessão de apresentação.

Linhagem: FactProductEvent → SESSION_ONCE por etapa.

### `presentation_feedbacks` — Reações em apresentações

Reações registradas durante apresentações.

Linhagem: FactProductEvent → count.

### `deep_link_restores` — Links profundos restaurados

Resultados finais de restauração de link.

Linhagem: FactProductEvent → count.

### `deep_link_full_restores` — Links restaurados por completo

Restaurações com resultado FULL.

Linhagem: FactProductEvent → count where FULL.

### `deep_link_restore_success_rate` — Links restaurados por completo (%)

Restaurações FULL ÷ todas as restaurações.

Linhagem: FactProductEvent → count FULL / count.

### `layer_changes` — Trocas de camada/fundo

Trocas de camada principal, sobreposição e fundo.

Linhagem: FactProductEvent → count.

### `time_to_first_lot_selection` — Tempo até o primeiro lote (mediana)

Mediana, por sessão, do tempo entre o primeiro evento da sessão e a primeira seleção de lote. Sessões sem seleção ficam de fora (censuradas).

Linhagem: FactProductSession, FactProductEvent → primeiro evento → primeiro lot_selected; mediana exata.

### `analytics_event_drop_rate` — Eventos descartados

Eventos descartados (limite do buffer, tamanho, tentativas esgotadas) ÷ eventos capturados.

Linhagem: TRACKER_HEALTH → contadores.

### `analytics_quarantine_rate` — Eventos em quarentena

Eventos rejeitados por contrato/privacidade ÷ eventos capturados.

Linhagem: TRACKER_HEALTH → contadores.

### `analytics_sampled_out_rate` — Eventos amostrados fora

Eventos não registrados por amostragem ÷ eventos capturados.

Linhagem: TRACKER_HEALTH → contadores.

### `journey_win_rate` — Taxa de ganho das jornadas

Jornadas distintas encerradas como ganhas ÷ jornadas distintas encerradas no período (ganhas + perdidas).

Ressalvas: Vitórias ÷ jornadas criadas é outra métrica. Coortes recentes ainda não tiveram tempo de fechar.

Linhagem: FactJourneyOutcome → distinct journeyId.

### `journey_loss_rate` — Taxa de perda das jornadas

Jornadas distintas encerradas como perdidas ÷ jornadas distintas encerradas no período.

Linhagem: FactJourneyOutcome → distinct journeyId.

### `share_open_rate_by_issue_cohort` — Abertura de links (coorte de emissão)

Links emitidos no período com pelo menos uma abertura válida (sem robô de pré-visualização) ÷ links emitidos no período.

Ressalvas: Abrir o link não identifica o cliente. Aberturas no período (share_opens_in_period) são outra métrica.

Linhagem: FactShareGrant, FactShareAccess → coorte de emissão; distinct shareGrantId com ≥1 abertura.

### `share_opens_in_period` — Aberturas de links no período

Sessões de acesso válidas abertas no período (robôs excluídos).

Linhagem: FactShareAccess → count distinct shareAccessSessionId.

### `share_time_to_first_open` — Tempo até a primeira abertura (mediana)

Mediana do tempo entre a emissão do link e a primeira abertura válida.

Linhagem: FactShareGrant, FactShareAccess → primeira abertura - emissão.

### `median_time_to_first_contact` — Tempo até o primeiro contato (mediana)

Mediana do tempo entre o início da jornada e o primeiro contato significativo (eventos de sistema/sincronização excluídos).

Linhagem: FactCustomerAcquisition, FactJourneyTouchpoint → primeiro contato significativo - acquiredAt; usa occurredAt (evento atrasado conta no dia em que ocorreu).

### `stage_conversion_rate` — Conversão entre etapas

Jornadas que passaram da etapa A para a B ÷ jornadas que entraram na etapa A (mesma versão do modelo de etapas).

Linhagem: FactJourneyStageTransition → distinct journeyId por etapa; filtro por stageModelVersionId.

### `completed_stage_duration` — Tempo em etapa concluída (mediana)

Mediana do tempo entre entrar e sair de uma etapa, só para quem já saiu.

Linhagem: FactJourneyStageTransition → derivado das transições (nunca persistido à mão).

### `current_stage_age` — Idade na etapa atual (mediana)

Mediana do tempo desde a entrada na etapa atual, só para jornadas ainda nela (não mistura com etapa concluída).

Linhagem: FactJourneyStageTransition → asOf - entrada na etapa atual.

### `recommendation_to_visit_rate` — Jornadas com recomendação que chegaram a visita

Jornadas com recomendação gerada que depois chegaram à etapa de visita ÷ jornadas com recomendação. Associação, não efeito causal.

Ressalvas: Correlação/sequência: não diz que a recomendação causou a visita.

Associação/sequência — não é efeito causal.

Linhagem: FactRecommendation, FactJourneyStageTransition → sequência recomendação → visita por journeyId.

### `cost_per_win` — Custo por jornada ganha

Investimento em mídia ÷ jornadas ganhas. Bloqueada: não há gasto de mídia confiável.

Bloqueada: Sem fonte de gasto de mídia; o gasto nunca é inventado.

Linhagem: — → —.
