<!-- GERADO por plat/scripts/analyticsDocs.js a partir de plat/config/analytics — não editar à mão. -->
# Catálogo de eventos de analytics (tópico 45)

Versão do registro: **1.0.0** · envelope `analytics-envelope/1` · 88 eventos · 46 nomes antigos mapeados.

Convenção: `snake_case` semântico (intenção, nunca o componente visual); versão inteira e monotônica; evento PUBLISHED é imutável. `*` = propriedade obrigatória. Defaults omitidos: classe produto, produtor CLIENT (WEB_CLIENT), privacidade NONE, consentimento ANALYTICS, prioridade NORMAL, dedupe EVENT_ID, sem amostragem, destinos LOCAL_BUFFER + FIRST_PARTY_INGESTION (desligado).

| Evento | v | Categoria | Classe | Produtor (fontes) | Prioridade | Dedupe | Propriedades (* obrigatória) | Métricas que consomem | Quando dispara |
|---|---|---|---|---|---|---|---|---|---|
| `app_opened` | 1 | NAVIGATION | produto | CLIENT (WEB_CLIENT) | NORMAL | SESSION_ONCE | entryType*: DIRECT/DEEP_LINK/SHARE_LINK/PWA/UNKNOWN | product_sessions | Após o carregamento inicial estabilizar; uma vez por productSessionId. |
| `route_viewed` | 1 | NAVIGATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | routeCode*: string; navigationSource: string | product_sessions | Uma vez por navegação semântica, após a rota estabilizar; nunca em render. |
| `deep_link_opened` | 1 | NAVIGATION | produto | CLIENT (WEB_CLIENT) | HIGH | EVENT_ID | routeCode*: string; linkKind: INTERNAL/SHARE/UNKNOWN | deep_link_restores | Quando o painel é aberto por um link com estado. |
| `deep_link_restored` | 1 | NAVIGATION | produto | CLIENT (WEB_CLIENT) | HIGH | EVENT_ID | routeCode*: string; restoreStatus*: FULL/PARTIAL/FAILED/EXPIRED/DENIED; stateRefUsed*: boolean; warningCount: number | deep_link_restores, deep_link_full_restores, deep_link_restore_success_rate | LinkRestorationService, após o resultado final (uma vez por link). |
| `deep_link_partial_restore` | 1 | NAVIGATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | routeCode*: string; warningCount*: number; droppedKeys: array | — | Junto ao deep_link_restored PARTIAL. |
| `internal_link_copied` | 1 | NAVIGATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | routeCode*: string; includesFilters: boolean | — | Cópia bem-sucedida de um link interno. |
| `ui_mode_changed` | 1 | NAVIGATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | mode*: broker/client/technical | — | Clique explícito no seletor de modo. |
| `map_viewed` | 1 | MAP | produto | CLIENT (WEB_CLIENT) | LOW | SESSION_ONCE | activeLayerId: string | product_sessions | Primeira exibição do mapa na sessão. |
| `map_layer_changed` | 1 | MAP | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | layerId*: string | layer_changes | Troca explícita e bem-sucedida da camada principal. |
| `lot_selected` | 1 | MAP | produto | CLIENT (WEB_CLIENT) | HIGH | ON_CHANGE | selectionSource*: MAP/LIST/SEARCH/KEYBOARD/DEEP_LINK/RECOMMENDATION/COMPARISON/OTHER; activeLayerId: string | lot_views, distinct_lots_viewed, lot_views_per_session, time_to_first_lot_selection | Quando currentLotId muda por ação explícita (mapa, lista, busca, atalho). Não dispara por hover, re-render, hidratação nem reseleção do mesmo lote. |
| `map_search_used` | 1 | MAP | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | queryType*: LOT_CODE/BLOCK/FREE_TEXT/UNKNOWN; resultCountBucket: 0/1/2_5/6_20/21_PLUS | — | Busca submetida. |
| `overlay_toggled` | 1 | MAP | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | overlayId*: string | layer_changes | Alternância bem-sucedida. |
| `base_map_changed` | 1 | MAP | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | baseLayer*: string | layer_changes | Escolha explícita do fundo. |
| `layer_opacity_changed` | 1 | MAP | produto | CLIENT (WEB_CLIENT) | LOW | ENTITY_WINDOW | layerId*: string | — | Fim do ajuste (agrupado por 1,5 s por camada). |
| `legend_expanded` | 1 | MAP | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | — | — | Clique explícito. |
| `legend_collapsed` | 1 | MAP | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | — | — | Clique explícito. |
| `legend_filter_applied` | 1 | FILTERS | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | layerId*: string | sessions_with_filter | Ação 'filtrar' na legenda aplicada. |
| `filter_panel_opened` | 1 | FILTERS | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | — | — | Abertura explícita. |
| `filter_applied` | 1 | FILTERS | produto | CLIENT (WEB_CLIENT) | NORMAL | ENTITY_WINDOW | mode*: QUICK/ADVANCED/SUGGESTION/LEGEND/PRESET; fieldKeys*: array; filterCount: number | sessions_with_filter, filter_usage_rate | Mudança de filtro aplicada; mudanças do mesmo campo em 1 s contam uma vez. |
| `filter_cleared` | 1 | FILTERS | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | scope*: ALL/ONE; fieldKeys: array | — | Remoção explícita. |
| `filter_preset_applied` | 1 | FILTERS | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | presetId*: string | — | Aplicação explícita. |
| `filter_suggestion_applied` | 1 | FILTERS | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | suggestionId*: string | sessions_with_filter | Clique na sugestão. |
| `filter_zero_result` | 1 | FILTERS | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | filterCount*: number | sessions_with_zero_result, filter_zero_result_rate | Transição para zero resultados (não repete enquanto continuar zero). |
| `filters_saved_as_constraints` | 1 | FILTERS | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | constraintCount*: number | — | Ação explícita. |
| `recommendation_requested` | 1 | RECOMMENDATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | objective: string | — | Pedido explícito. |
| `recommendation_generated` | 1 | RECOMMENDATION | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, SERVER) | NORMAL | IDEMPOTENCY_KEY | candidateCount: number; eligibleCount: number; primaryCount: number; methodologyVersion: string | — | Serviço de recomendação concluiu (service/server). |
| `recommendation_generated` | 2 | RECOMMENDATION | produto | HYBRID (WEB_CLIENT, DOMAIN_BRIDGE, SERVER) | NORMAL | EVENT_ID | candidateCount: number; eligibleCount: number; primaryCount: number; methodologyVersion: string; status: string; mode: string; objective: string; eligible: number; review: number; shortlist: number; readiness: string | — | Serviço de recomendação concluiu, ou o usuário atualizou a recomendação no painel de decisão. |
| `decision_session_started` | 1 | RECOMMENDATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | status: string; mode: string; objective: string; eligible: number; review: number; shortlist: number; readiness: string | — | Primeira ação que cria a sessão de decisão (uma vez por sessão). |
| `shortlist_created` | 1 | RECOMMENDATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | status: string; mode: string; objective: string; eligible: number; review: number; shortlist: number; readiness: string | — | Criação explícita da shortlist no painel de decisão. |
| `recommendation_opened` | 1 | RECOMMENDATION | produto | CLIENT (WEB_CLIENT) | HIGH | EVENT_ID | primaryCount*: number | sessions_with_recommendation, recommendation_usage_rate | Abertura explícita. |
| `recommendation_lot_opened` | 1 | RECOMMENDATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | rank: number; tier: string | — | Clique em um lote recomendado. |
| `recommendation_explanation_opened` | 1 | RECOMMENDATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | — | — | Abertura explícita. |
| `recommendation_scope_changed` | 1 | RECOMMENDATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | enabled*: boolean | sessions_with_recommendation, recommendation_usage_rate | Alternância explícita. |
| `recommendation_preset_toggled` | 1 | RECOMMENDATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | presetId*: string | sessions_with_recommendation, recommendation_usage_rate | Clique no perfil. |
| `customer_constraint_changed` | 1 | RECOMMENDATION | produto | CLIENT (WEB_CLIENT) | NORMAL | ENTITY_WINDOW | fieldKey*: string | — | Mudança aplicada; repetições do mesmo campo em 1 s contam uma vez. |
| `comparison_created` | 1 | COMPARISON | produto | CLIENT (WEB_CLIENT) | HIGH | EVENT_ID | candidateCount*: number; context: GENERAL/CUSTOMER/PRESENTATION/UNKNOWN; metricProfileId: string | comparisons_created | ComparisonService criou a sessão. |
| `comparison_opened` | 1 | COMPARISON | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | candidateCount*: number; metricProfileId: string | comparisons_opened, sessions_with_comparison, comparison_usage_rate, avg_candidates_per_comparison | ComparisonService montou a matriz. |
| `comparison_candidate_added` | 1 | COMPARISON | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | candidateCount*: number; source: string | comparison_candidates_added | Adição bem-sucedida. |
| `comparison_candidate_removed` | 1 | COMPARISON | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | candidateCount*: number | — | Remoção bem-sucedida. |
| `comparison_section_viewed` | 1 | COMPARISON | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | sectionId*: string | — | Seção exibida por ação explícita. |
| `comparison_cleared` | 1 | COMPARISON | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | candidateCount: number | — | Ação explícita. |
| `comparison_profile_changed` | 1 | COMPARISON | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | metricProfileId*: string; candidateCount: number | — | Escolha explícita. |
| `comparison_shared` | 1 | COMPARISON | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | candidateCount*: number | — | Pedido de compartilhamento da comparação. |
| `comparison_bar_toggled` | 1 | LAYOUT | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | — | — | Clique explícito. |
| `favorite_added` | 1 | FAVORITES | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, SERVER) | HIGH | IDEMPOTENCY_KEY | contextType*: PERSONAL/CUSTOMER/SESSION/SHARED_COLLECTION; source*: string | favorites_added | FavoriteService persistiu (via Domain Bridge). |
| `favorite_removed` | 1 | FAVORITES | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, SERVER) | NORMAL | IDEMPOTENCY_KEY | contextType*: PERSONAL/CUSTOMER/SESSION/SHARED_COLLECTION | — | FavoriteService persistiu a remoção. |
| `favorite_collection_opened` | 1 | FAVORITES | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | contextType: string | — | Abertura explícita. |
| `customer_context_selected` | 1 | CUSTOMER_JOURNEY | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | — | — | Seleção explícita. |
| `customer_context_cleared` | 1 | CUSTOMER_JOURNEY | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | — | — | Ação explícita. |
| `journey_workspace_opened` | 1 | CUSTOMER_JOURNEY | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | — | — | Abertura explícita. |
| `journey_won` | 1 | CUSTOMER_JOURNEY | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, SERVER) | CRITICAL | IDEMPOTENCY_KEY | sourceCode: string | — | Domain Bridge a partir de JourneyClosedWon; nunca pelo clique. |
| `presentation_created` | 1 | PRESENTATION | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, SERVER) | NORMAL | IDEMPOTENCY_KEY | purpose: string | — | Serviço de apresentação criou a definição. |
| `presentation_snapshot_created` | 1 | PRESENTATION | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, SERVER) | NORMAL | IDEMPOTENCY_KEY | purpose: string; lotCount: number | — | PresentationSnapshotCreated. |
| `presentation_started` | 1 | PRESENTATION | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, PRESENTATION_RUNTIME, SERVER) | HIGH | SESSION_ONCE | purpose: string; lotCount: number; runtimeMode: GUIDED/FREE/KIOSK/UNKNOWN | presentations_started, presentation_completion_rate | PresentationStarted (runtime), uma vez por presentationSessionId. |
| `presentation_step_viewed` | 1 | PRESENTATION | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, PRESENTATION_RUNTIME) | NORMAL | SESSION_ONCE | stepId*: string; stepType: string; stepIndex: number | presentation_steps_viewed | PresentationStepViewed; SESSION_ONCE por etapa. |
| `presentation_feedback_recorded` | 1 | PRESENTATION | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, PRESENTATION_RUNTIME, SERVER) | NORMAL | IDEMPOTENCY_KEY | feedbackType: string | presentation_feedbacks | PresentationFeedbackRecorded. |
| `presentation_completed` | 1 | PRESENTATION | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, PRESENTATION_RUNTIME, SERVER) | CRITICAL | SESSION_ONCE | purpose: string; lotCount: number; feedbackCount: number | presentations_completed, presentation_completion_rate | PresentationCompleted (conclusão explícita persistida); nunca inferida da última etapa. |
| `guided_presentation_preflight` | 1 | PRESENTATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | sourceKind*: string; status*: string | — | Pré-verificação exibida. |
| `guided_presentation_launched` | 1 | PRESENTATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | — | — | Clique em 'Iniciar apresentação' com sessão criada. |
| `presentation_view_entered` | 1 | PRESENTATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | — | — | Alternância explícita. |
| `presentation_view_exited` | 1 | PRESENTATION | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | — | — | Alternância explícita. |
| `share_grant_created` | 1 | SHARE | produto | SERVER (SERVER, DOMAIN_BRIDGE) | NORMAL | IDEMPOTENCY_KEY | resourceType: string; channel: string; accessMode: string | — | ShareGrantIssued (servidor/serviço). |
| `share_link_copied` | 1 | SHARE | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | resourceType: string | share_preparations | Cópia bem-sucedida (copiar ≠ enviar). |
| `share_channel_payload_created` | 1 | SHARE | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | channel*: string | — | Conteúdo do canal gerado. |
| `share_opened` | 1 | SHARE | produto | SERVER (SERVER) | CRITICAL | IDEMPOTENCY_KEY | resourceType: string; accessMode: string; deviceClass: DESKTOP/TABLET/MOBILE/EXTERNAL_DISPLAY/UNKNOWN | — | ShareAccessService, servidor, após sessão de acesso válida. |
| `share_feedback_submitted` | 1 | SHARE | produto | SERVER (SERVER, SHARE_RUNTIME) | NORMAL | IDEMPOTENCY_KEY | feedbackType: string | — | Envio aceito pelo servidor. |
| `share_expired_view_attempted` | 1 | SHARE | produto | SERVER (SERVER) | NORMAL | EVENT_ID | — | — | Servidor negou acesso por expiração. |
| `share_dialog_opened` | 1 | SHARE | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | lotCount*: number | share_preparations | Abertura explícita da janela. |
| `financial_simulation_opened` | 1 | FINANCIAL | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | — | — | Abertura explícita. |
| `financial_simulation_created` | 1 | FINANCIAL | produto | DOMAIN_BRIDGE (DOMAIN_BRIDGE, SERVER) | CRITICAL | IDEMPOTENCY_KEY | scenarioType: string; calculationStatus: string; paymentPlanCode: string | — | Serviço/servidor concluiu a simulação. |
| `financial_plan_selected` | 1 | FINANCIAL | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | paymentPlanCode*: string | — | Escolha explícita. |
| `global_search_used` | 1 | SEARCH | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | queryType*: LOT_CODE/BLOCK/FREE_TEXT/UNKNOWN; resultCountBucket: 0/1/2_5/6_20/21_PLUS | — | Busca submetida. |
| `lot_search_used` | 1 | SEARCH | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | queryType*: LOT_CODE/BLOCK/FREE_TEXT/UNKNOWN; resultCountBucket: 0/1/2_5/6_20/21_PLUS | — | Busca submetida. |
| `customer_search_used` | 1 | SEARCH | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | resultCountBucket*: 0/1/2_5/6_20/21_PLUS; selected: boolean | — | Busca submetida. |
| `search_result_opened` | 1 | SEARCH | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | resultKind*: string | — | Clique no resultado. |
| `desktop_panel_opened` | 1 | LAYOUT | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | — | — | Clique explícito. |
| `desktop_panel_collapsed` | 1 | LAYOUT | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | — | — | Clique explícito. |
| `desktop_panel_resized` | 1 | LAYOUT | produto | CLIENT (WEB_CLIENT) | LOW | ENTITY_WINDOW | — | — | Fim do arraste do divisor. |
| `desktop_shortcut_used` | 1 | LAYOUT | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | shortcutId*: string | — | Atalho executado. |
| `mobile_sheet_snapped` | 1 | LAYOUT | produto | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | snap*: string | — | Fim do arraste/toque. |
| `quickview_action_used` | 1 | LAYOUT | produto | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | actionKey*: string; tier: string | — | Clique em ação do Quick View. |
| `layout_profile_changed` | 1 | TECHNICAL | telemetria técnica | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | from: string; to*: string | — | Resolvedor de layout trocou de perfil. |
| `offline_entered` | 1 | TECHNICAL | telemetria técnica | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | reason: string | — | Estado de rede mudou para OFFLINE. |
| `offline_exited` | 1 | TECHNICAL | telemetria técnica | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | reason: string | — | Estado de rede saiu de OFFLINE. |
| `cache_hit` | 1 | TECHNICAL | telemetria técnica | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | durationMs: number; asset: string | — | Cache respondeu. |
| `cache_miss` | 1 | TECHNICAL | telemetria técnica | CLIENT (WEB_CLIENT) | LOW | EVENT_ID | what: string; asset: string | — | Cache sem a entrada. |
| `stale_dynamic_used` | 1 | TECHNICAL | telemetria técnica | CLIENT (WEB_CLIENT) | NORMAL | EVENT_ID | reason: string | — | Fallback para cópia antiga. |
| `sync_failed` | 1 | TECHNICAL | telemetria técnica | CLIENT (WEB_CLIENT) | HIGH | EVENT_ID | reason: string | — | Sincronização terminou em ERROR/OFFLINE. |

## Eventos sem métrica consumidora (a questionar, §35)

`deep_link_partial_restore`, `internal_link_copied`, `ui_mode_changed`, `map_search_used`, `layer_opacity_changed`, `legend_expanded`, `legend_collapsed`, `filter_panel_opened`, `filter_cleared`, `filter_preset_applied`, `filters_saved_as_constraints`, `recommendation_requested`, `recommendation_generated`, `recommendation_generated`, `decision_session_started`, `shortlist_created`, `recommendation_lot_opened`, `recommendation_explanation_opened`, `customer_constraint_changed`, `comparison_candidate_removed`, `comparison_section_viewed`, `comparison_cleared`, `comparison_profile_changed`, `comparison_shared`, `comparison_bar_toggled`, `favorite_removed`, `favorite_collection_opened`, `customer_context_selected`, `customer_context_cleared`, `journey_workspace_opened`, `journey_won`, `presentation_created`, `presentation_snapshot_created`, `guided_presentation_preflight`, `guided_presentation_launched`, `presentation_view_entered`, `presentation_view_exited`, `share_grant_created`, `share_channel_payload_created`, `share_opened`, `share_feedback_submitted`, `share_expired_view_attempted`, `financial_simulation_opened`, `financial_simulation_created`, `financial_plan_selected`, `global_search_used`, `lot_search_used`, `customer_search_used`, `search_result_opened`, `desktop_panel_opened`, `desktop_panel_collapsed`, `desktop_panel_resized`, `desktop_shortcut_used`, `mobile_sheet_snapped`, `quickview_action_used`
