// GERADO por App.eventTracking.registry.generateTypes() a partir de config/analytics/events.json — não editar à mão.
// registryVersion 1.0.0
/** Painel aberto (uma vez por sessão de produto). — dispara: Após o carregamento inicial estabilizar; uma vez por productSessionId. */
export interface AppOpenedV1Payload {
  entryType: "DIRECT" | "DEEP_LINK" | "SHARE_LINK" | "PWA" | "UNKNOWN";
}
/** Rota semântica estabilizada (NavigationCoordinator). — dispara: Uma vez por navegação semântica, após a rota estabilizar; nunca em render. */
export interface RouteViewedV1Payload {
  routeCode: string;
  navigationSource?: string;
}
/** Link profundo recebido. — dispara: Quando o painel é aberto por um link com estado. */
export interface DeepLinkOpenedV1Payload {
  routeCode: string;
  linkKind?: "INTERNAL" | "SHARE" | "UNKNOWN";
}
/** Resultado final da restauração de um link profundo (tópico 43). — dispara: LinkRestorationService, após o resultado final (uma vez por link). */
export interface DeepLinkRestoredV1Payload {
  routeCode: string;
  restoreStatus: "FULL" | "PARTIAL" | "FAILED" | "EXPIRED" | "DENIED";
  stateRefUsed: boolean;
  warningCount?: number;
}
/** Restauração parcial (detalhe dos itens descartados). — dispara: Junto ao deep_link_restored PARTIAL. */
export interface DeepLinkPartialRestoreV1Payload {
  routeCode: string;
  warningCount: number;
  droppedKeys?: string[];
}
/** Link interno copiado. — dispara: Cópia bem-sucedida de um link interno. */
export interface InternalLinkCopiedV1Payload {
  routeCode: string;
  includesFilters?: boolean;
}
/** Modo de trabalho trocado (corretor, cliente, técnico). — dispara: Clique explícito no seletor de modo. */
export interface UiModeChangedV1Payload {
  mode: "broker" | "client" | "technical";
}
/** Mapa exibido (uma vez por sessão). — dispara: Primeira exibição do mapa na sessão. */
export interface MapViewedV1Payload {
  activeLayerId?: string;
}
/** Camada principal do mapa trocada. — dispara: Troca explícita e bem-sucedida da camada principal. */
export interface MapLayerChangedV1Payload {
  layerId: string;
}
/** Lote selecionado por ação explícita. — dispara: Quando currentLotId muda por ação explícita (mapa, lista, busca, atalho). Não dispara por hover, re-render, hidratação nem reseleção do mesmo lote. */
export interface LotSelectedV1Payload {
  selectionSource: "MAP" | "LIST" | "SEARCH" | "KEYBOARD" | "DEEP_LINK" | "RECOMMENDATION" | "COMPARISON" | "OTHER";
  activeLayerId?: string;
}
/** Busca no mapa usada (sem o texto). — dispara: Busca submetida. */
export interface MapSearchUsedV1Payload {
  queryType: "LOT_CODE" | "BLOCK" | "FREE_TEXT" | "UNKNOWN";
  resultCountBucket?: "0" | "1" | "2_5" | "6_20" | "21_PLUS";
}
/** Sobreposição do mapa ligada/desligada. — dispara: Alternância bem-sucedida. */
export interface OverlayToggledV1Payload {
  overlayId: string;
}
/** Fundo do mapa trocado. — dispara: Escolha explícita do fundo. */
export interface BaseMapChangedV1Payload {
  baseLayer: string;
}
/** Opacidade da camada ajustada. — dispara: Fim do ajuste (agrupado por 1,5 s por camada). */
export interface LayerOpacityChangedV1Payload {
  layerId: string;
}
/** Legenda aberta. — dispara: Clique explícito. */
export interface LegendExpandedV1Payload {
}
/** Legenda recolhida. — dispara: Clique explícito. */
export interface LegendCollapsedV1Payload {
}
/** Filtro aplicado a partir da legenda. — dispara: Ação 'filtrar' na legenda aplicada. */
export interface LegendFilterAppliedV1Payload {
  layerId: string;
}
/** Painel de filtros aberto. — dispara: Abertura explícita. */
export interface FilterPanelOpenedV1Payload {
}
/** Filtro aplicado (só nomes de campos, nunca valores). — dispara: Mudança de filtro aplicada; mudanças do mesmo campo em 1 s contam uma vez. */
export interface FilterAppliedV1Payload {
  mode: "QUICK" | "ADVANCED" | "SUGGESTION" | "LEGEND" | "PRESET";
  fieldKeys: string[];
  filterCount?: number;
}
/** Filtro removido ou todos limpos. — dispara: Remoção explícita. */
export interface FilterClearedV1Payload {
  scope: "ALL" | "ONE";
  fieldKeys?: string[];
}
/** Conjunto de filtros pré-definido aplicado. — dispara: Aplicação explícita. */
export interface FilterPresetAppliedV1Payload {
  presetId: string;
}
/** Sugestão de filtro aplicada. — dispara: Clique na sugestão. */
export interface FilterSuggestionAppliedV1Payload {
  suggestionId: string;
}
/** Filtros chegaram a zero lotes. — dispara: Transição para zero resultados (não repete enquanto continuar zero). */
export interface FilterZeroResultV1Payload {
  filterCount: number;
}
/** Filtros convertidos em exigências do cliente. — dispara: Ação explícita. */
export interface FiltersSavedAsConstraintsV1Payload {
  constraintCount: number;
}
/** Recomendação pedida. — dispara: Pedido explícito. */
export interface RecommendationRequestedV1Payload {
  objective?: string;
}
/** Recomendação gerada pelo serviço. — dispara: Serviço de recomendação concluiu (service/server). */
export interface RecommendationGeneratedV1Payload {
  candidateCount?: number;
  eligibleCount?: number;
  primaryCount?: number;
  methodologyVersion?: string;
}
/** Recomendação gerada (serviço ou painel de decisão local, tópico 56). v2: também produzida no navegador; payload agregado sem perfil, orçamento, cliente ou preço. — dispara: Serviço de recomendação concluiu, ou o usuário atualizou a recomendação no painel de decisão. */
export interface RecommendationGeneratedV2Payload {
  candidateCount?: number;
  eligibleCount?: number;
  primaryCount?: number;
  methodologyVersion?: string;
  status?: string;
  mode?: string;
  objective?: string;
  eligible?: number;
  review?: number;
  shortlist?: number;
  readiness?: string;
}
/** Sessão de decisão iniciada no painel de decisão (tópico 56). — dispara: Primeira ação que cria a sessão de decisão (uma vez por sessão). */
export interface DecisionSessionStartedV1Payload {
  status?: string;
  mode?: string;
  objective?: string;
  eligible?: number;
  review?: number;
  shortlist?: number;
  readiness?: string;
}
/** Shortlist de decisão criada a partir da recomendação (tópico 56). — dispara: Criação explícita da shortlist no painel de decisão. */
export interface ShortlistCreatedV1Payload {
  status?: string;
  mode?: string;
  objective?: string;
  eligible?: number;
  review?: number;
  shortlist?: number;
  readiness?: string;
}
/** Resultado de recomendação aberto. — dispara: Abertura explícita. */
export interface RecommendationOpenedV1Payload {
  primaryCount: number;
}
/** Lote aberto a partir da recomendação. — dispara: Clique em um lote recomendado. */
export interface RecommendationLotOpenedV1Payload {
  rank?: number;
  tier?: string;
}
/** Explicação da recomendação aberta. — dispara: Abertura explícita. */
export interface RecommendationExplanationOpenedV1Payload {
}
/** Recomendação limitada (ou não) aos lotes filtrados. — dispara: Alternância explícita. */
export interface RecommendationScopeChangedV1Payload {
  enabled: boolean;
}
/** Perfil pronto de recomendação ligado/desligado. — dispara: Clique no perfil. */
export interface RecommendationPresetToggledV1Payload {
  presetId: string;
}
/** Exigência do cliente alterada (só o nome do campo; nunca o valor, ex.: orçamento). — dispara: Mudança aplicada; repetições do mesmo campo em 1 s contam uma vez. */
export interface CustomerConstraintChangedV1Payload {
  fieldKey: string;
}
/** Sessão de comparação criada. — dispara: ComparisonService criou a sessão. */
export interface ComparisonCreatedV1Payload {
  candidateCount: number;
  context?: "GENERAL" | "CUSTOMER" | "PRESENTATION" | "UNKNOWN";
  metricProfileId?: string;
}
/** Matriz de comparação montada/aberta. — dispara: ComparisonService montou a matriz. */
export interface ComparisonOpenedV1Payload {
  candidateCount: number;
  metricProfileId?: string;
}
/** Lote adicionado à comparação. — dispara: Adição bem-sucedida. */
export interface ComparisonCandidateAddedV1Payload {
  candidateCount: number;
  source?: string;
}
/** Lote removido da comparação. — dispara: Remoção bem-sucedida. */
export interface ComparisonCandidateRemovedV1Payload {
  candidateCount: number;
}
/** Seção da comparação vista. — dispara: Seção exibida por ação explícita. */
export interface ComparisonSectionViewedV1Payload {
  sectionId: string;
}
/** Comparação limpa. — dispara: Ação explícita. */
export interface ComparisonClearedV1Payload {
  candidateCount?: number;
}
/** Perfil de métricas da comparação trocado. — dispara: Escolha explícita. */
export interface ComparisonProfileChangedV1Payload {
  metricProfileId: string;
  candidateCount?: number;
}
/** Conteúdo de compartilhamento da comparação gerado (não é ShareGrant). — dispara: Pedido de compartilhamento da comparação. */
export interface ComparisonSharedV1Payload {
  candidateCount: number;
}
/** Barra de comparação aberta/fechada. — dispara: Clique explícito. */
export interface ComparisonBarToggledV1Payload {
}
/** Favorito adicionado (persistido). — dispara: FavoriteService persistiu (via Domain Bridge). */
export interface FavoriteAddedV1Payload {
  contextType: "PERSONAL" | "CUSTOMER" | "SESSION" | "SHARED_COLLECTION";
  source: string;
}
/** Favorito removido. — dispara: FavoriteService persistiu a remoção. */
export interface FavoriteRemovedV1Payload {
  contextType: "PERSONAL" | "CUSTOMER" | "SESSION" | "SHARED_COLLECTION";
}
/** Coleção de favoritos aberta. — dispara: Abertura explícita. */
export interface FavoriteCollectionOpenedV1Payload {
  contextType?: string;
}
/** Cliente escolhido como contexto (id opaco, nunca dados de contato). — dispara: Seleção explícita. */
export interface CustomerContextSelectedV1Payload {
}
/** Contexto de cliente limpo. — dispara: Ação explícita. */
export interface CustomerContextClearedV1Payload {
}
/** Área da jornada aberta. — dispara: Abertura explícita. */
export interface JourneyWorkspaceOpenedV1Payload {
}
/** Jornada encerrada como ganha (derivado do fato de domínio). — dispara: Domain Bridge a partir de JourneyClosedWon; nunca pelo clique. */
export interface JourneyWonV1Payload {
  sourceCode?: string;
}
/** Apresentação criada. — dispara: Serviço de apresentação criou a definição. */
export interface PresentationCreatedV1Payload {
  purpose?: string;
}
/** Cópia fixa da apresentação criada. — dispara: PresentationSnapshotCreated. */
export interface PresentationSnapshotCreatedV1Payload {
  purpose?: string;
  lotCount?: number;
}
/** Sessão de apresentação iniciada (PresentationSession). — dispara: PresentationStarted (runtime), uma vez por presentationSessionId. */
export interface PresentationStartedV1Payload {
  purpose?: string;
  lotCount?: number;
  runtimeMode?: "GUIDED" | "FREE" | "KIOSK" | "UNKNOWN";
}
/** Etapa da apresentação vista (primeira vez por sessão). — dispara: PresentationStepViewed; SESSION_ONCE por etapa. */
export interface PresentationStepViewedV1Payload {
  stepId: string;
  stepType?: string;
  stepIndex?: number;
}
/** Reação registrada na apresentação (sem texto livre). — dispara: PresentationFeedbackRecorded. */
export interface PresentationFeedbackRecordedV1Payload {
  feedbackType?: string;
}
/** Apresentação concluída explicitamente pelo apresentador. — dispara: PresentationCompleted (conclusão explícita persistida); nunca inferida da última etapa. */
export interface PresentationCompletedV1Payload {
  purpose?: string;
  lotCount?: number;
  feedbackCount?: number;
}
/** Verificação antes de iniciar a apresentação guiada. — dispara: Pré-verificação exibida. */
export interface GuidedPresentationPreflightV1Payload {
  sourceKind: string;
  status: string;
}
/** Apresentador clicou em iniciar e a sessão abriu (UI). A métrica oficial usa presentation_started. — dispara: Clique em 'Iniciar apresentação' com sessão criada. */
export interface GuidedPresentationLaunchedV1Payload {
}
/** Visão simples de apresentação ligada (não é PresentationSession). — dispara: Alternância explícita. */
export interface PresentationViewEnteredV1Payload {
}
/** Visão simples de apresentação desligada. — dispara: Alternância explícita. */
export interface PresentationViewExitedV1Payload {
}
/** Link de compartilhamento emitido. — dispara: ShareGrantIssued (servidor/serviço). */
export interface ShareGrantCreatedV1Payload {
  resourceType?: string;
  channel?: string;
  accessMode?: string;
}
/** Link de compartilhamento copiado. — dispara: Cópia bem-sucedida (copiar ≠ enviar). */
export interface ShareLinkCopiedV1Payload {
  resourceType?: string;
}
/** Mensagem para um canal montada. — dispara: Conteúdo do canal gerado. */
export interface ShareChannelPayloadCreatedV1Payload {
  channel: string;
}
/** Link compartilhado aberto com acesso válido (pré-visualização de robô não conta). — dispara: ShareAccessService, servidor, após sessão de acesso válida. */
export interface ShareOpenedV1Payload {
  resourceType?: string;
  accessMode?: string;
  deviceClass?: "DESKTOP" | "TABLET" | "MOBILE" | "EXTERNAL_DISPLAY" | "UNKNOWN";
}
/** Reação enviada pelo link compartilhado (sem texto livre). — dispara: Envio aceito pelo servidor. */
export interface ShareFeedbackSubmittedV1Payload {
  feedbackType?: string;
}
/** Tentativa de abrir link expirado. — dispara: Servidor negou acesso por expiração. */
export interface ShareExpiredViewAttemptedV1Payload {
}
/** Corretor abriu a janela de compartilhamento (não é abertura de link). — dispara: Abertura explícita da janela. */
export interface ShareDialogOpenedV1Payload {
  lotCount: number;
}
/** Simulação aberta. — dispara: Abertura explícita. */
export interface FinancialSimulationOpenedV1Payload {
}
/** Simulação calculada pelo serviço (sem valores pessoais). — dispara: Serviço/servidor concluiu a simulação. */
export interface FinancialSimulationCreatedV1Payload {
  scenarioType?: string;
  calculationStatus?: string;
  paymentPlanCode?: string;
}
/** Plano de pagamento escolhido. — dispara: Escolha explícita. */
export interface FinancialPlanSelectedV1Payload {
  paymentPlanCode: string;
}
/** Busca global usada (sem texto). — dispara: Busca submetida. */
export interface GlobalSearchUsedV1Payload {
  queryType: "LOT_CODE" | "BLOCK" | "FREE_TEXT" | "UNKNOWN";
  resultCountBucket?: "0" | "1" | "2_5" | "6_20" | "21_PLUS";
}
/** Busca de lote usada (sem texto). — dispara: Busca submetida. */
export interface LotSearchUsedV1Payload {
  queryType: "LOT_CODE" | "BLOCK" | "FREE_TEXT" | "UNKNOWN";
  resultCountBucket?: "0" | "1" | "2_5" | "6_20" | "21_PLUS";
}
/** Busca de cliente usada (nunca o termo). — dispara: Busca submetida. */
export interface CustomerSearchUsedV1Payload {
  resultCountBucket: "0" | "1" | "2_5" | "6_20" | "21_PLUS";
  selected?: boolean;
}
/** Resultado da busca aberto. — dispara: Clique no resultado. */
export interface SearchResultOpenedV1Payload {
  resultKind: string;
}
/** Painel lateral aberto (desktop). — dispara: Clique explícito. */
export interface DesktopPanelOpenedV1Payload {
}
/** Painel lateral recolhido (desktop). — dispara: Clique explícito. */
export interface DesktopPanelCollapsedV1Payload {
}
/** Painel lateral redimensionado (desktop). — dispara: Fim do arraste do divisor. */
export interface DesktopPanelResizedV1Payload {
}
/** Atalho de teclado usado. — dispara: Atalho executado. */
export interface DesktopShortcutUsedV1Payload {
  shortcutId: string;
}
/** Painel deslizante do celular mudou de altura. — dispara: Fim do arraste/toque. */
export interface MobileSheetSnappedV1Payload {
  snap: string;
}
/** Ação do Quick View usada. — dispara: Clique em ação do Quick View. */
export interface QuickviewActionUsedV1Payload {
  actionKey: string;
  tier?: string | null;
}
/** Perfil de layout mudou (telemetria técnica). — dispara: Resolvedor de layout trocou de perfil. */
export interface LayoutProfileChangedV1Payload {
  from?: string | null;
  to: string;
}
/** Painel ficou sem conexão. — dispara: Estado de rede mudou para OFFLINE. */
export interface OfflineEnteredV1Payload {
  reason?: string | null;
}
/** Painel saiu do modo sem conexão. — dispara: Estado de rede saiu de OFFLINE. */
export interface OfflineExitedV1Payload {
  reason?: string | null;
}
/** Leitura servida do cache local. — dispara: Cache respondeu. */
export interface CacheHitV1Payload {
  durationMs?: number;
  asset?: string;
}
/** Leitura não encontrada no cache local. — dispara: Cache sem a entrada. */
export interface CacheMissV1Payload {
  what?: string;
  asset?: string;
}
/** Dados comerciais antigos usados por falta de rede. — dispara: Fallback para cópia antiga. */
export interface StaleDynamicUsedV1Payload {
  reason?: string | null;
}
/** Sincronização falhou (só o código; a mensagem de erro nunca entra). — dispara: Sincronização terminou em ERROR/OFFLINE. */
export interface SyncFailedV1Payload {
  reason?: string | null;
}
export interface AnalyticsEventPayloads {
  "app_opened@1": AppOpenedV1Payload;
  "route_viewed@1": RouteViewedV1Payload;
  "deep_link_opened@1": DeepLinkOpenedV1Payload;
  "deep_link_restored@1": DeepLinkRestoredV1Payload;
  "deep_link_partial_restore@1": DeepLinkPartialRestoreV1Payload;
  "internal_link_copied@1": InternalLinkCopiedV1Payload;
  "ui_mode_changed@1": UiModeChangedV1Payload;
  "map_viewed@1": MapViewedV1Payload;
  "map_layer_changed@1": MapLayerChangedV1Payload;
  "lot_selected@1": LotSelectedV1Payload;
  "map_search_used@1": MapSearchUsedV1Payload;
  "overlay_toggled@1": OverlayToggledV1Payload;
  "base_map_changed@1": BaseMapChangedV1Payload;
  "layer_opacity_changed@1": LayerOpacityChangedV1Payload;
  "legend_expanded@1": LegendExpandedV1Payload;
  "legend_collapsed@1": LegendCollapsedV1Payload;
  "legend_filter_applied@1": LegendFilterAppliedV1Payload;
  "filter_panel_opened@1": FilterPanelOpenedV1Payload;
  "filter_applied@1": FilterAppliedV1Payload;
  "filter_cleared@1": FilterClearedV1Payload;
  "filter_preset_applied@1": FilterPresetAppliedV1Payload;
  "filter_suggestion_applied@1": FilterSuggestionAppliedV1Payload;
  "filter_zero_result@1": FilterZeroResultV1Payload;
  "filters_saved_as_constraints@1": FiltersSavedAsConstraintsV1Payload;
  "recommendation_requested@1": RecommendationRequestedV1Payload;
  "recommendation_generated@1": RecommendationGeneratedV1Payload;
  "recommendation_generated@2": RecommendationGeneratedV2Payload;
  "decision_session_started@1": DecisionSessionStartedV1Payload;
  "shortlist_created@1": ShortlistCreatedV1Payload;
  "recommendation_opened@1": RecommendationOpenedV1Payload;
  "recommendation_lot_opened@1": RecommendationLotOpenedV1Payload;
  "recommendation_explanation_opened@1": RecommendationExplanationOpenedV1Payload;
  "recommendation_scope_changed@1": RecommendationScopeChangedV1Payload;
  "recommendation_preset_toggled@1": RecommendationPresetToggledV1Payload;
  "customer_constraint_changed@1": CustomerConstraintChangedV1Payload;
  "comparison_created@1": ComparisonCreatedV1Payload;
  "comparison_opened@1": ComparisonOpenedV1Payload;
  "comparison_candidate_added@1": ComparisonCandidateAddedV1Payload;
  "comparison_candidate_removed@1": ComparisonCandidateRemovedV1Payload;
  "comparison_section_viewed@1": ComparisonSectionViewedV1Payload;
  "comparison_cleared@1": ComparisonClearedV1Payload;
  "comparison_profile_changed@1": ComparisonProfileChangedV1Payload;
  "comparison_shared@1": ComparisonSharedV1Payload;
  "comparison_bar_toggled@1": ComparisonBarToggledV1Payload;
  "favorite_added@1": FavoriteAddedV1Payload;
  "favorite_removed@1": FavoriteRemovedV1Payload;
  "favorite_collection_opened@1": FavoriteCollectionOpenedV1Payload;
  "customer_context_selected@1": CustomerContextSelectedV1Payload;
  "customer_context_cleared@1": CustomerContextClearedV1Payload;
  "journey_workspace_opened@1": JourneyWorkspaceOpenedV1Payload;
  "journey_won@1": JourneyWonV1Payload;
  "presentation_created@1": PresentationCreatedV1Payload;
  "presentation_snapshot_created@1": PresentationSnapshotCreatedV1Payload;
  "presentation_started@1": PresentationStartedV1Payload;
  "presentation_step_viewed@1": PresentationStepViewedV1Payload;
  "presentation_feedback_recorded@1": PresentationFeedbackRecordedV1Payload;
  "presentation_completed@1": PresentationCompletedV1Payload;
  "guided_presentation_preflight@1": GuidedPresentationPreflightV1Payload;
  "guided_presentation_launched@1": GuidedPresentationLaunchedV1Payload;
  "presentation_view_entered@1": PresentationViewEnteredV1Payload;
  "presentation_view_exited@1": PresentationViewExitedV1Payload;
  "share_grant_created@1": ShareGrantCreatedV1Payload;
  "share_link_copied@1": ShareLinkCopiedV1Payload;
  "share_channel_payload_created@1": ShareChannelPayloadCreatedV1Payload;
  "share_opened@1": ShareOpenedV1Payload;
  "share_feedback_submitted@1": ShareFeedbackSubmittedV1Payload;
  "share_expired_view_attempted@1": ShareExpiredViewAttemptedV1Payload;
  "share_dialog_opened@1": ShareDialogOpenedV1Payload;
  "financial_simulation_opened@1": FinancialSimulationOpenedV1Payload;
  "financial_simulation_created@1": FinancialSimulationCreatedV1Payload;
  "financial_plan_selected@1": FinancialPlanSelectedV1Payload;
  "global_search_used@1": GlobalSearchUsedV1Payload;
  "lot_search_used@1": LotSearchUsedV1Payload;
  "customer_search_used@1": CustomerSearchUsedV1Payload;
  "search_result_opened@1": SearchResultOpenedV1Payload;
  "desktop_panel_opened@1": DesktopPanelOpenedV1Payload;
  "desktop_panel_collapsed@1": DesktopPanelCollapsedV1Payload;
  "desktop_panel_resized@1": DesktopPanelResizedV1Payload;
  "desktop_shortcut_used@1": DesktopShortcutUsedV1Payload;
  "mobile_sheet_snapped@1": MobileSheetSnappedV1Payload;
  "quickview_action_used@1": QuickviewActionUsedV1Payload;
  "layout_profile_changed@1": LayoutProfileChangedV1Payload;
  "offline_entered@1": OfflineEnteredV1Payload;
  "offline_exited@1": OfflineExitedV1Payload;
  "cache_hit@1": CacheHitV1Payload;
  "cache_miss@1": CacheMissV1Payload;
  "stale_dynamic_used@1": StaleDynamicUsedV1Payload;
  "sync_failed@1": SyncFailedV1Payload;
}
