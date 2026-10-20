/* Viva Juara — chunk "customer" (round 6 code splitting). Loaded on first use by App.chunks; precached by sw.js. */
/* ---- configs (customer) ---- */
Object.assign(App.configs, {"customer":{"policy":{"kind":"customer-policy","version":"1.0.0","schemaVersion":"customer-profile/1","note":"Tópico 39. Política padrão do domínio Customer por organização. Prazos de retenção e base legal NÃO são definidos aqui: são decisão do jurídico/privacidade da organização (retentionPolicyRef = null até lá).","organizations":{"org_house7":{"creationPolicy":{"minimumFields":["displayName"],"requireContactPoint":false,"duplicateCheckRequired":true,"allowCreateWithDuplicateWarning":true},"duplicatePolicy":{"mode":"SUGGEST_ONLY","nameSimilarityThreshold":0.8,"crossTenant":false},"offlinePolicy":{"allowSummaryCache":false,"allowContactCache":false,"allowProfileCache":false,"allowNotesCache":false,"maxCacheAgeSeconds":null},"retentionPolicyRef":null,"defaultPhoneCountry":"BR","dataClassificationDefault":"STANDARD_PII","fieldAuthorityPolicies":[]}},"defaults":{"creationPolicy":{"minimumFields":["displayName"],"requireContactPoint":false,"duplicateCheckRequired":true,"allowCreateWithDuplicateWarning":true},"duplicatePolicy":{"mode":"SUGGEST_ONLY","nameSimilarityThreshold":0.8,"crossTenant":false},"offlinePolicy":{"allowSummaryCache":false,"allowContactCache":false,"allowProfileCache":false,"allowNotesCache":false,"maxCacheAgeSeconds":null},"retentionPolicyRef":null,"defaultPhoneCountry":"BR","dataClassificationDefault":"STANDARD_PII","fieldAuthorityPolicies":[]},"objectiveLabels":{"LIVE":"Morar","INVEST":"Investir","LIVE_OR_INVEST":"Morar ou investir","UNDECIDED":"Ainda não decidiu"},"completeness":{"note":"Completude = quanto do perfil necessário está preenchido. Não é confiança. Não é exigida para atender o cliente.","items":[{"key":"objective","label":"Objetivo"},{"key":"budget","label":"Orçamento"},{"key":"preferences","label":"Ao menos uma preferência explícita"},{"key":"hardConstraintsReviewed","label":"Exigências eliminatórias revisadas"}]},"profileBuilderGroups":[{"id":"objective","label":"Objetivo","fields":[]},{"id":"budget","label":"Orçamento","fields":["budget"]},{"id":"size","label":"Tamanho do lote","fields":["area","areaRange"]},{"id":"solar","label":"Sol","fields":["solar"]},{"id":"noise","label":"Ruído","fields":["quiet","lowTraffic"]},{"id":"privacy","label":"Privacidade","fields":["privacy"]},{"id":"leisure","label":"Proximidade do lazer","fields":["leisure"]},{"id":"gate","label":"Proximidade da entrada","fields":["gate"]},{"id":"green","label":"Área verde","fields":["green","view"]},{"id":"investment","label":"Investimento","fields":["investment","priceQuality"]},{"id":"other","label":"Outras preferências explícitas","fields":["geometry","housing","family","premium","noCorner"]}],"permissionCatalog":{"note":"Chaves do domínio Customer usadas por App.customer (contrato p/ backend). Ainda NÃO estão em config/security/permissions.json: enquanto não forem registradas, toda checagem delas nega (deny by default). No modo estático (aparelho) vale apenas customer_profile.manage, sem contatos.","keys":["customer.read","customer.readAssigned","customer.create","customer.update","customer.archive","customer.assign","customer.profile.read","customer.profile.update","customer.contact.read","customer.contact.update","customer.merge","customer.duplicate.review","customer.privacy.read","customer.privacy.manage","customer.externalRef.manage"],"localDeviceKey":"customer_profile.manage"}}},"journey":{"policy":{"kind":"journey-policy","version":"1.0.0","note":"Tópico 40. Não havia pipeline comercial no código (inventário em docs/JOURNEY_LEGACY_PIPELINE_MIGRATION_REPORT.md): o modelo V1 abaixo é o template técnico do spec (§44), publicado para uso inicial e marcado requiresHumanValidation. Nada aqui altera lote, disponibilidade, preço, score ou Fit.","organizations":{"org_house7":{"stageModelDefinitionId":"jsm_house7_default"}},"stageModels":[{"definition":{"id":"jsm_house7_default","organizationId":"org_house7","code":"DEFAULT","title":"Jornada comercial (template inicial)","scope":"ORGANIZATION","status":"ACTIVE","createdAt":"2026-10-09T00:00:00.000Z"},"versions":[{"id":"jsmv_house7_default_1","stageModelDefinitionId":"jsm_house7_default","version":1,"requiresHumanValidation":true,"stages":[{"id":"stg_new","code":"NEW","title":"Novo","order":0,"category":"NEW","terminal":false,"recommendedNextActionType":"CONTACT","visibility":"NORMAL"},{"id":"stg_contacted","code":"CONTACTED","title":"Contato feito","order":1,"category":"ENGAGEMENT","terminal":false,"recommendedNextActionType":"COMPLETE_PROFILE","visibility":"NORMAL"},{"id":"stg_qualifying","code":"QUALIFYING","title":"Qualificando","order":2,"category":"QUALIFICATION","terminal":false,"recommendedNextActionType":"COMPLETE_PROFILE","visibility":"NORMAL"},{"id":"stg_profiled","code":"PROFILED","title":"Perfil levantado","order":3,"category":"DISCOVERY","terminal":false,"recommendedNextActionType":"PREPARE_RECOMMENDATION","visibility":"NORMAL"},{"id":"stg_recommending","code":"RECOMMENDING","title":"Opções em preparo","order":4,"category":"RECOMMENDATION","terminal":false,"recommendedNextActionType":"PRESENT_OPTIONS","visibility":"NORMAL"},{"id":"stg_shortlisted","code":"SHORTLISTED","title":"Opções selecionadas","order":5,"category":"SHORTLIST","terminal":false,"recommendedNextActionType":"SCHEDULE_VISIT","visibility":"NORMAL"},{"id":"stg_visit_planned","code":"VISIT_PLANNED","title":"Visita agendada","order":6,"category":"VISIT","terminal":false,"recommendedNextActionType":"FOLLOW_UP","visibility":"NORMAL"},{"id":"stg_visited","code":"VISITED","title":"Visitou","order":7,"category":"VISIT","terminal":false,"recommendedNextActionType":"FOLLOW_UP_VISIT","visibility":"NORMAL"},{"id":"stg_negotiating","code":"NEGOTIATING","title":"Negociação","order":8,"category":"NEGOTIATION","terminal":false,"recommendedNextActionType":"PREPARE_SIMULATION","visibility":"NORMAL"},{"id":"stg_proposal","code":"PROPOSAL","title":"Proposta","order":9,"category":"PROPOSAL","terminal":false,"recommendedNextActionType":"FOLLOW_UP_PROPOSAL","visibility":"NORMAL"},{"id":"stg_reservation","code":"RESERVATION","title":"Reserva em andamento","order":10,"category":"RESERVATION","terminal":false,"recommendedNextActionType":"FOLLOW_UP","visibility":"NORMAL"},{"id":"stg_closed_won","code":"CLOSED_WON","title":"Fechado (ganho)","order":11,"category":"WON","terminal":true,"recommendedNextActionType":null,"visibility":"NORMAL"},{"id":"stg_closed_lost","code":"CLOSED_LOST","title":"Encerrado (perdido)","order":12,"category":"LOST","terminal":true,"recommendedNextActionType":null,"visibility":"NORMAL"}],"transitions":[{"id":"tr_new__contacted","fromStageId":"stg_new","toStageId":"stg_contacted","allowed":true,"requireReason":false},{"id":"tr_new__qualifying","fromStageId":"stg_new","toStageId":"stg_qualifying","allowed":true,"requireReason":true},{"id":"tr_new__closed_lost","fromStageId":"stg_new","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_contacted__qualifying","fromStageId":"stg_contacted","toStageId":"stg_qualifying","allowed":true,"requireReason":false},{"id":"tr_contacted__profiled","fromStageId":"stg_contacted","toStageId":"stg_profiled","allowed":true,"requireReason":true},{"id":"tr_contacted__new","fromStageId":"stg_contacted","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_contacted__closed_lost","fromStageId":"stg_contacted","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_qualifying__profiled","fromStageId":"stg_qualifying","toStageId":"stg_profiled","allowed":true,"requireReason":false},{"id":"tr_qualifying__recommending","fromStageId":"stg_qualifying","toStageId":"stg_recommending","allowed":true,"requireReason":true},{"id":"tr_qualifying__new","fromStageId":"stg_qualifying","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_qualifying__contacted","fromStageId":"stg_qualifying","toStageId":"stg_contacted","allowed":true,"requireReason":true},{"id":"tr_qualifying__closed_lost","fromStageId":"stg_qualifying","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_profiled__recommending","fromStageId":"stg_profiled","toStageId":"stg_recommending","allowed":true,"requireReason":false},{"id":"tr_profiled__shortlisted","fromStageId":"stg_profiled","toStageId":"stg_shortlisted","allowed":true,"requireReason":true},{"id":"tr_profiled__new","fromStageId":"stg_profiled","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_profiled__contacted","fromStageId":"stg_profiled","toStageId":"stg_contacted","allowed":true,"requireReason":true},{"id":"tr_profiled__qualifying","fromStageId":"stg_profiled","toStageId":"stg_qualifying","allowed":true,"requireReason":true},{"id":"tr_profiled__closed_lost","fromStageId":"stg_profiled","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_recommending__shortlisted","fromStageId":"stg_recommending","toStageId":"stg_shortlisted","allowed":true,"requireReason":false},{"id":"tr_recommending__visit_planned","fromStageId":"stg_recommending","toStageId":"stg_visit_planned","allowed":true,"requireReason":true},{"id":"tr_recommending__new","fromStageId":"stg_recommending","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_recommending__contacted","fromStageId":"stg_recommending","toStageId":"stg_contacted","allowed":true,"requireReason":true},{"id":"tr_recommending__qualifying","fromStageId":"stg_recommending","toStageId":"stg_qualifying","allowed":true,"requireReason":true},{"id":"tr_recommending__profiled","fromStageId":"stg_recommending","toStageId":"stg_profiled","allowed":true,"requireReason":true},{"id":"tr_recommending__closed_lost","fromStageId":"stg_recommending","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_shortlisted__visit_planned","fromStageId":"stg_shortlisted","toStageId":"stg_visit_planned","allowed":true,"requireReason":false},{"id":"tr_shortlisted__visited","fromStageId":"stg_shortlisted","toStageId":"stg_visited","allowed":true,"requireReason":true},{"id":"tr_shortlisted__new","fromStageId":"stg_shortlisted","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_shortlisted__contacted","fromStageId":"stg_shortlisted","toStageId":"stg_contacted","allowed":true,"requireReason":true},{"id":"tr_shortlisted__qualifying","fromStageId":"stg_shortlisted","toStageId":"stg_qualifying","allowed":true,"requireReason":true},{"id":"tr_shortlisted__profiled","fromStageId":"stg_shortlisted","toStageId":"stg_profiled","allowed":true,"requireReason":true},{"id":"tr_shortlisted__recommending","fromStageId":"stg_shortlisted","toStageId":"stg_recommending","allowed":true,"requireReason":true},{"id":"tr_shortlisted__closed_lost","fromStageId":"stg_shortlisted","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_visit_planned__visited","fromStageId":"stg_visit_planned","toStageId":"stg_visited","allowed":true,"requireReason":false},{"id":"tr_visit_planned__negotiating","fromStageId":"stg_visit_planned","toStageId":"stg_negotiating","allowed":true,"requireReason":true},{"id":"tr_visit_planned__new","fromStageId":"stg_visit_planned","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_visit_planned__contacted","fromStageId":"stg_visit_planned","toStageId":"stg_contacted","allowed":true,"requireReason":true},{"id":"tr_visit_planned__qualifying","fromStageId":"stg_visit_planned","toStageId":"stg_qualifying","allowed":true,"requireReason":true},{"id":"tr_visit_planned__profiled","fromStageId":"stg_visit_planned","toStageId":"stg_profiled","allowed":true,"requireReason":true},{"id":"tr_visit_planned__recommending","fromStageId":"stg_visit_planned","toStageId":"stg_recommending","allowed":true,"requireReason":true},{"id":"tr_visit_planned__shortlisted","fromStageId":"stg_visit_planned","toStageId":"stg_shortlisted","allowed":true,"requireReason":true},{"id":"tr_visit_planned__closed_lost","fromStageId":"stg_visit_planned","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_visited__negotiating","fromStageId":"stg_visited","toStageId":"stg_negotiating","allowed":true,"requireReason":false},{"id":"tr_visited__proposal","fromStageId":"stg_visited","toStageId":"stg_proposal","allowed":true,"requireReason":true},{"id":"tr_visited__new","fromStageId":"stg_visited","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_visited__contacted","fromStageId":"stg_visited","toStageId":"stg_contacted","allowed":true,"requireReason":true},{"id":"tr_visited__qualifying","fromStageId":"stg_visited","toStageId":"stg_qualifying","allowed":true,"requireReason":true},{"id":"tr_visited__profiled","fromStageId":"stg_visited","toStageId":"stg_profiled","allowed":true,"requireReason":true},{"id":"tr_visited__recommending","fromStageId":"stg_visited","toStageId":"stg_recommending","allowed":true,"requireReason":true},{"id":"tr_visited__shortlisted","fromStageId":"stg_visited","toStageId":"stg_shortlisted","allowed":true,"requireReason":true},{"id":"tr_visited__visit_planned","fromStageId":"stg_visited","toStageId":"stg_visit_planned","allowed":true,"requireReason":true},{"id":"tr_visited__closed_lost","fromStageId":"stg_visited","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_negotiating__proposal","fromStageId":"stg_negotiating","toStageId":"stg_proposal","allowed":true,"requireReason":false},{"id":"tr_negotiating__reservation","fromStageId":"stg_negotiating","toStageId":"stg_reservation","allowed":true,"requireReason":true},{"id":"tr_negotiating__new","fromStageId":"stg_negotiating","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_negotiating__contacted","fromStageId":"stg_negotiating","toStageId":"stg_contacted","allowed":true,"requireReason":true},{"id":"tr_negotiating__qualifying","fromStageId":"stg_negotiating","toStageId":"stg_qualifying","allowed":true,"requireReason":true},{"id":"tr_negotiating__profiled","fromStageId":"stg_negotiating","toStageId":"stg_profiled","allowed":true,"requireReason":true},{"id":"tr_negotiating__recommending","fromStageId":"stg_negotiating","toStageId":"stg_recommending","allowed":true,"requireReason":true},{"id":"tr_negotiating__shortlisted","fromStageId":"stg_negotiating","toStageId":"stg_shortlisted","allowed":true,"requireReason":true},{"id":"tr_negotiating__visit_planned","fromStageId":"stg_negotiating","toStageId":"stg_visit_planned","allowed":true,"requireReason":true},{"id":"tr_negotiating__visited","fromStageId":"stg_negotiating","toStageId":"stg_visited","allowed":true,"requireReason":true},{"id":"tr_negotiating__closed_lost","fromStageId":"stg_negotiating","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_proposal__reservation","fromStageId":"stg_proposal","toStageId":"stg_reservation","allowed":true,"requireReason":false},{"id":"tr_proposal__new","fromStageId":"stg_proposal","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_proposal__contacted","fromStageId":"stg_proposal","toStageId":"stg_contacted","allowed":true,"requireReason":true},{"id":"tr_proposal__qualifying","fromStageId":"stg_proposal","toStageId":"stg_qualifying","allowed":true,"requireReason":true},{"id":"tr_proposal__profiled","fromStageId":"stg_proposal","toStageId":"stg_profiled","allowed":true,"requireReason":true},{"id":"tr_proposal__recommending","fromStageId":"stg_proposal","toStageId":"stg_recommending","allowed":true,"requireReason":true},{"id":"tr_proposal__shortlisted","fromStageId":"stg_proposal","toStageId":"stg_shortlisted","allowed":true,"requireReason":true},{"id":"tr_proposal__visit_planned","fromStageId":"stg_proposal","toStageId":"stg_visit_planned","allowed":true,"requireReason":true},{"id":"tr_proposal__visited","fromStageId":"stg_proposal","toStageId":"stg_visited","allowed":true,"requireReason":true},{"id":"tr_proposal__negotiating","fromStageId":"stg_proposal","toStageId":"stg_negotiating","allowed":true,"requireReason":true},{"id":"tr_proposal__closed_lost","fromStageId":"stg_proposal","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_reservation__new","fromStageId":"stg_reservation","toStageId":"stg_new","allowed":true,"requireReason":true},{"id":"tr_reservation__contacted","fromStageId":"stg_reservation","toStageId":"stg_contacted","allowed":true,"requireReason":true},{"id":"tr_reservation__qualifying","fromStageId":"stg_reservation","toStageId":"stg_qualifying","allowed":true,"requireReason":true},{"id":"tr_reservation__profiled","fromStageId":"stg_reservation","toStageId":"stg_profiled","allowed":true,"requireReason":true},{"id":"tr_reservation__recommending","fromStageId":"stg_reservation","toStageId":"stg_recommending","allowed":true,"requireReason":true},{"id":"tr_reservation__shortlisted","fromStageId":"stg_reservation","toStageId":"stg_shortlisted","allowed":true,"requireReason":true},{"id":"tr_reservation__visit_planned","fromStageId":"stg_reservation","toStageId":"stg_visit_planned","allowed":true,"requireReason":true},{"id":"tr_reservation__visited","fromStageId":"stg_reservation","toStageId":"stg_visited","allowed":true,"requireReason":true},{"id":"tr_reservation__negotiating","fromStageId":"stg_reservation","toStageId":"stg_negotiating","allowed":true,"requireReason":true},{"id":"tr_reservation__proposal","fromStageId":"stg_reservation","toStageId":"stg_proposal","allowed":true,"requireReason":true},{"id":"tr_reservation__closed_lost","fromStageId":"stg_reservation","toStageId":"stg_closed_lost","allowed":true,"requireReason":true,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_negotiating__closed_won","fromStageId":"stg_negotiating","toStageId":"stg_closed_won","allowed":true,"requireReason":false,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_proposal__closed_won","fromStageId":"stg_proposal","toStageId":"stg_closed_won","allowed":true,"requireReason":false,"requireOutcomeData":true,"requiredPermission":"journey.close"},{"id":"tr_reservation__closed_won","fromStageId":"stg_reservation","toStageId":"stg_closed_won","allowed":true,"requireReason":false,"requireOutcomeData":true,"requiredPermission":"journey.close"}],"entryStageId":"stg_new","wonStageIds":["stg_closed_won"],"lostStageIds":["stg_closed_lost"],"pausedStageIds":[],"lifecycleStatus":"PUBLISHED","createdAt":"2026-10-09T00:00:00.000Z","publishedAt":"2026-10-09T00:00:00.000Z"}]}],"eventTypes":[{"code":"JOURNEY_CREATED","category":"STAGE","title":"Jornada aberta","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":[],"allowed":["developmentId","journeyType"]}},{"code":"MIGRATED_TO_STAGE","category":"STAGE","title":"Jornada migrada do registro anterior","allowedSources":["IMPORT","SYSTEM"],"clientVisible":false,"countsAsMeaningfulActivity":false,"customerTouch":false,"brokerAction":false,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["legacyCurrentStage","historyUnavailable"],"allowed":["legacyLabel","migrationVersion"]}},{"code":"STAGE_CHANGED","category":"STAGE","title":"Etapa alterada","allowedSources":["MANUAL","DOMAIN_EVENT","CRM_SYNC","INTEGRATION"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["fromStageId","toStageId","transitionId"],"allowed":["reasonCode","override"]}},{"code":"CUSTOMER_CONTACTED","category":"CONTACT","title":"Contato com o cliente","allowedSources":["MANUAL","DOMAIN_EVENT","CRM_SYNC","WHATSAPP","PHONE","EMAIL"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":true,"brokerAction":true,"stageSuggestion":"CONTACTED","actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["touchpointId"],"allowed":["channel","direction","outcomeCode"]}},{"code":"PROFILE_UPDATED","category":"PROFILE","title":"Perfil do cliente atualizado","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":"PROFILED","actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["profileVersionId"],"allowed":["version"]}},{"code":"RECOMMENDATION_GENERATED","category":"RECOMMENDATION","title":"Recomendação gerada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":false,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["recommendationResultId"],"allowed":["profileVersionId"]}},{"code":"RECOMMENDATION_PRESENTED","category":"RECOMMENDATION","title":"Opções apresentadas ao cliente","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":true,"countsAsMeaningfulActivity":true,"customerTouch":true,"brokerAction":true,"stageSuggestion":"SHORTLISTED","actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["recommendationResultId"],"allowed":["lotIds","presentationRef"]}},{"code":"OPTION_PRESENTED","category":"RECOMMENDATION","title":"Lote registrado como opção apresentada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":true,"countsAsMeaningfulActivity":true,"customerTouch":true,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["lotId"],"allowed":["recommendationResultId"]}},{"code":"FAVORITE_ADDED_FOR_CUSTOMER","category":"FAVORITE","title":"Lote favoritado para o cliente","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":true,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["lotId"],"allowed":["favoriteId"]}},{"code":"FAVORITE_REMOVED_FOR_CUSTOMER","category":"FAVORITE","title":"Lote retirado dos favoritos do cliente","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":false,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["lotId"],"allowed":["favoriteId"]}},{"code":"COMPARISON_CREATED","category":"COMPARISON","title":"Comparação criada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["comparisonSessionId"],"allowed":["candidateCount"]}},{"code":"COMPARISON_UPDATED","category":"COMPARISON","title":"Comparação atualizada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":false,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["comparisonSessionId"],"allowed":["candidateCount"]}},{"code":"FINANCIAL_SIMULATION_CREATED","category":"SIMULATION","title":"Simulação financeira registrada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["simulationId"],"allowed":["version"]}},{"code":"VISIT_SCHEDULED","category":"VISIT","title":"Visita agendada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":"VISIT_PLANNED","actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":[],"allowed":["touchpointId","scheduledFor"]}},{"code":"VISIT_COMPLETED","category":"VISIT","title":"Visita realizada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":true,"brokerAction":true,"stageSuggestion":"VISITED","actionSuggestion":{"type":"FOLLOW_UP_VISIT","inHours":24,"reasonCode":"AFTER_VISIT"},"retentionClass":"OPERATIONAL","payload":{"required":[],"allowed":["touchpointId"]}},{"code":"DOCUMENT_REQUESTED","category":"DOCUMENT","title":"Documento solicitado","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["documentId"],"allowed":[]}},{"code":"DOCUMENT_RECEIVED","category":"DOCUMENT","title":"Documento recebido","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":true,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["documentId"],"allowed":[]}},{"code":"PROPOSAL_STARTED","category":"PROPOSAL","title":"Proposta iniciada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":"PROPOSAL","actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["proposalId"],"allowed":[]}},{"code":"PROPOSAL_SUBMITTED","category":"PROPOSAL","title":"Proposta enviada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["proposalId"],"allowed":[]}},{"code":"RESERVATION_CREATED","category":"RESERVATION","title":"Reserva registrada no sistema comercial","allowedSources":["DOMAIN_EVENT","INTEGRATION","CRM_SYNC"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":"RESERVATION","actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["reservationId"],"allowed":["lotId"]}},{"code":"RESERVATION_RELEASED","category":"RESERVATION","title":"Reserva liberada no sistema comercial","allowedSources":["DOMAIN_EVENT","INTEGRATION","CRM_SYNC"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["reservationId"],"allowed":["lotId"]}},{"code":"JOURNEY_PAUSED","category":"STAGE","title":"Jornada pausada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["pauseRecordId","reasonCode"],"allowed":["expectedResumeAt"]}},{"code":"JOURNEY_RESUMED","category":"STAGE","title":"Jornada retomada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["pauseRecordId"],"allowed":[]}},{"code":"JOURNEY_WON","category":"OUTCOME","title":"Jornada encerrada com ganho","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["outcomeId"],"allowed":["relatedResourceRefs"]}},{"code":"JOURNEY_LOST","category":"OUTCOME","title":"Jornada encerrada sem conversão","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["outcomeId","reasonCode"],"allowed":[]}},{"code":"FOLLOW_UP_CREATED","category":"FOLLOW_UP","title":"Próxima ação definida","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["nextActionId","type"],"allowed":["dueAt"]}},{"code":"FOLLOW_UP_COMPLETED","category":"FOLLOW_UP","title":"Próxima ação concluída","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["nextActionId"],"allowed":["completionReasonCode"]}},{"code":"FOLLOW_UP_CANCELLED","category":"FOLLOW_UP","title":"Próxima ação cancelada","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":false,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["nextActionId"],"allowed":["completionReasonCode"]}},{"code":"ASSIGNMENT_CHANGED","category":"ASSIGNMENT","title":"Responsável alterado","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":true,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["assignmentId"],"allowed":["role"]}},{"code":"ARTIFACT_LINKED","category":"OTHER","title":"Recurso vinculado","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":false,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["linkId","resourceType"],"allowed":["relationType"]}},{"code":"CRM_SYNC_COMPLETED","category":"INTEGRATION","title":"Sincronização com CRM","allowedSources":["CRM_SYNC","INTEGRATION"],"clientVisible":false,"countsAsMeaningfulActivity":false,"customerTouch":false,"brokerAction":false,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":[],"allowed":["provider"]}},{"code":"EVENT_CORRECTED","category":"OTHER","title":"Registro corrigido","allowedSources":["MANUAL","DOMAIN_EVENT"],"clientVisible":false,"countsAsMeaningfulActivity":false,"customerTouch":false,"brokerAction":true,"stageSuggestion":null,"actionSuggestion":null,"retentionClass":"OPERATIONAL","payload":{"required":["originalEventId","correctionId","reasonCode"],"allowed":[]}}],"ingestionPolicies":[{"sourceEventType":"FavoriteAdded","eligible":true,"condition":{"contextType":"CUSTOMER"},"eventType":"FAVORITE_ADDED_FOR_CUSTOMER","journeyResolutionStrategy":"ACTIVE_JOURNEY_OF_CUSTOMER_IN_DEVELOPMENT","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"FavoriteRemoved","eligible":true,"condition":{"contextType":"CUSTOMER"},"eventType":"FAVORITE_REMOVED_FOR_CUSTOMER","journeyResolutionStrategy":"ACTIVE_JOURNEY_OF_CUSTOMER_IN_DEVELOPMENT","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"RecommendationGenerated","eligible":true,"condition":{"requiresCustomer":true},"eventType":"RECOMMENDATION_GENERATED","journeyResolutionStrategy":"EXPLICIT_OR_ACTIVE","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"RecommendationPresented","eligible":true,"condition":{"requiresCustomer":true,"requiresExplicitPresentation":true},"eventType":"RECOMMENDATION_PRESENTED","journeyResolutionStrategy":"EXPLICIT_OR_ACTIVE","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"ComparisonCreated","eligible":true,"condition":{"requiresCustomer":true},"eventType":"COMPARISON_CREATED","journeyResolutionStrategy":"EXPLICIT_OR_ACTIVE","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"ComparisonUpdated","eligible":true,"condition":{"requiresCustomer":true},"eventType":"COMPARISON_UPDATED","journeyResolutionStrategy":"EXPLICIT_OR_ACTIVE","deduplicationPolicy":"COALESCE_BY_SUBJECT","coalesceWindowMinutes":60},{"sourceEventType":"ComparisonCandidatesReordered","eligible":false,"reason":"NOISE"},{"sourceEventType":"FinancialSimulationCreated","eligible":true,"condition":{"requiresCustomer":true},"eventType":"FINANCIAL_SIMULATION_CREATED","journeyResolutionStrategy":"EXPLICIT_OR_ACTIVE","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"DocumentRequested","eligible":true,"condition":{"requiresCustomer":true},"eventType":"DOCUMENT_REQUESTED","journeyResolutionStrategy":"EXPLICIT","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"DocumentReceived","eligible":true,"condition":{"requiresCustomer":true},"eventType":"DOCUMENT_RECEIVED","journeyResolutionStrategy":"EXPLICIT","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"ReservationCreated","eligible":true,"condition":{"requiresCustomer":true},"eventType":"RESERVATION_CREATED","journeyResolutionStrategy":"EXPLICIT","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"ReservationReleased","eligible":true,"condition":{"requiresCustomer":true},"eventType":"RESERVATION_RELEASED","journeyResolutionStrategy":"EXPLICIT","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"CustomerPreferenceProfileUpdated","eligible":true,"condition":{"requiresCustomer":true},"eventType":"PROFILE_UPDATED","journeyResolutionStrategy":"ACTIVE_JOURNEY_OF_CUSTOMER_IN_DEVELOPMENT","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"CrmSyncCompleted","eligible":true,"condition":{},"eventType":"CRM_SYNC_COMPLETED","journeyResolutionStrategy":"EXPLICIT","deduplicationPolicy":"SOURCE_EVENT_ID"},{"sourceEventType":"LotHovered","eligible":false,"reason":"ANALYTICS_ONLY"},{"sourceEventType":"LotClicked","eligible":false,"reason":"ANALYTICS_ONLY"},{"sourceEventType":"QuickViewOpened","eligible":false,"reason":"ANALYTICS_ONLY"},{"sourceEventType":"MapPanned","eligible":false,"reason":"ANALYTICS_ONLY"},{"sourceEventType":"FilterChanged","eligible":false,"reason":"ANALYTICS_ONLY"}],"lossReasons":[{"code":"PRICE"},{"code":"PAYMENT_TERMS"},{"code":"LOT_SIZE"},{"code":"LOCATION"},{"code":"TIMING"},{"code":"NO_RESPONSE"},{"code":"CHANGED_PLAN"},{"code":"BOUGHT_ELSEWHERE"},{"code":"FINANCING"},{"code":"NO_SUITABLE_LOT"},{"code":"COMMERCIAL_CONDITION"},{"code":"OTHER"},{"code":"UNKNOWN"}],"lossReasonLabels":{"PRICE":"Preço","PAYMENT_TERMS":"Condições de pagamento","LOT_SIZE":"Tamanho do lote","LOCATION":"Localização","TIMING":"Momento","NO_RESPONSE":"Sem resposta","CHANGED_PLAN":"Mudou de planos","BOUGHT_ELSEWHERE":"Comprou em outro lugar","FINANCING":"Financiamento","NO_SUITABLE_LOT":"Nenhum lote adequado","COMMERCIAL_CONDITION":"Condição comercial","OTHER":"Outro","UNKNOWN":"Não informado"},"pauseReasons":["CUSTOMER_REQUEST","TIMING","WAITING_FINANCING","WAITING_DOCUMENTS","OTHER"],"overrideReasons":["DATA_CORRECTION","OPERATIONAL_EXCEPTION","CUSTOMER_REQUEST","OTHER"],"sources":["WEBSITE","PAID_MEDIA","ORGANIC_SOCIAL","REFERRAL","BROKER","EVENT","CRM_REACTIVATION","DIRECT","PARTNER","OTHER","UNKNOWN"],"sourceLabels":{"WEBSITE":"Site","PAID_MEDIA":"Mídia paga","ORGANIC_SOCIAL":"Redes sociais (orgânico)","REFERRAL":"Indicação","BROKER":"Corretor","EVENT":"Evento","CRM_REACTIVATION":"Reativação (CRM)","DIRECT":"Direto","PARTNER":"Parceiro","OTHER":"Outro","UNKNOWN":"Origem não informada"},"primaryAttributionRule":"FIRST_TOUCH","touchpointOutcomes":["INTERESTED","NOT_INTERESTED","NO_ANSWER","CALL_BACK","SCHEDULED","INFORMATION_SENT","OTHER"],"nextActionTypes":["CONTACT","FOLLOW_UP","COMPLETE_PROFILE","PREPARE_RECOMMENDATION","PRESENT_OPTIONS","SCHEDULE_VISIT","FOLLOW_UP_VISIT","PREPARE_SIMULATION","REQUEST_DOCUMENT","FOLLOW_UP_PROPOSAL","WAIT_CUSTOMER","OTHER"],"nextActionDueSoonHours":24,"agingPolicies":[{"stageCode":"NEW","warningAfterHours":24,"criticalAfterHours":72,"basedOn":"LAST_MEANINGFUL_EVENT"},{"stageCode":"CONTACTED","warningAfterHours":72,"criticalAfterHours":168,"basedOn":"LAST_CUSTOMER_TOUCH"},{"stageCode":"VISITED","warningAfterHours":48,"criticalAfterHours":120,"basedOn":"LAST_CUSTOMER_TOUCH"},{"stageCode":"NEGOTIATING","warningAfterHours":72,"criticalAfterHours":168,"basedOn":"NEXT_ACTION_DUE"}],"agingNote":"Prazos ilustrativos por etapa (sem regra universal). Validar com a operação comercial.","automationPolicy":{"allowAutoStageTransition":false,"trustedEventTypes":[],"allowedTransitionIds":[]},"followUpPolicy":{"createAutomatically":false},"uniquenessPolicy":{"maxActivePerKey":1,"key":["customerId","developmentId","journeyType"]},"offlinePolicy":{"allowSummaryCache":false,"allowTimelineCache":false,"allowNextActionCache":false,"allowOfflineTouchpointQueue":false,"allowOfflineStageTransition":false,"maxCacheAgeSeconds":null},"permissionCatalog":{"note":"Chaves do domínio Journey (contrato p/ backend). Não registradas em config/security/permissions.json: negadas até serem registradas.","keys":["journey.read","journey.readAssigned","journey.create","journey.update","journey.transition","journey.overrideTransition","journey.pause","journey.close","journey.reopen","journey.assign","journey.timeline.read","journey.timeline.record","journey.nextAction.manage","journey.outcome.manage","journey.technical.read"]},"stageMappingPolicies":[]}}});
/* ---- customer/customerDomain.js ---- */
/* customer/customerDomain.js — topic 39: Customer as a canonical, private, tenant-scoped entity.
   Customer (aggregate root) · CustomerType · lifecycle (administrative, never a sales stage) · person/organization details ·
   CustomerContactPoint (+ conservative normalization, verification ≠ presence) · CustomerCommunicationPreference (consent is
   recorded, never inferred) · CustomerPrivacyProfile · CustomerAssignment (≠ RBAC) · CustomerAccessDecision ·
   CustomerExternalRef + authority modes + field authority · CustomerPreferenceProfile / immutable versions / snapshot ·
   duplicate detection (SUGGEST_ONLY) · merge + alias · projections/redaction · domain events without PII · ingestion ·
   anonymization foundation · Fit / Recommendation / Favorites / Comparison integration refs.

   Rules: USER ≠ CUSTOMER. IDs are opaque and never PII. No PII in URLs, logs, events, analytics or share links.
   Unknown budget is null (never 0). UNDECIDED ≠ UNKNOWN. A system suggestion never becomes an active preference.
   A preference never becomes a hard constraint. Nothing here recalculates Fit, Recommendation, scores, prices or
   availability: it only builds the inputs (through App.fit.buildProfile, unchanged) and keeps the references.
   Browser copies are convenience only; the frontend is never the authority (deny by default). */
App.customer = App.customer || {};
App.customer.domain = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const CustomerType = E('PERSON', 'ORGANIZATION');
  const LifecycleStatus = E('ACTIVE', 'ARCHIVED', 'MERGED', 'DELETED');
  const ContactPointType = E('PHONE', 'WHATSAPP', 'EMAIL', 'OTHER');
  const VerificationStatus = E('UNVERIFIED', 'VERIFIED', 'INVALID', 'UNKNOWN');
  const ContactLifecycle = E('ACTIVE', 'INACTIVE', 'BOUNCED', 'REVOKED');
  const NormalizationStatus = E('NORMALIZED', 'UNPARSEABLE', 'NOT_APPLICABLE');
  const CommunicationChannel = E('WHATSAPP', 'SMS', 'EMAIL', 'PHONE', 'OTHER');
  const ConsentStatus = E('GRANTED', 'DENIED', 'REVOKED', 'UNKNOWN', 'NOT_REQUIRED_BY_POLICY');
  const DataClassification = E('STANDARD_PII', 'RESTRICTED_PII');
  const AssignmentRole = E('OWNER', 'COLLABORATOR', 'VIEWER');
  const AssignmentStatus = E('ACTIVE', 'ENDED');
  const AssigneeType = E('USER', 'TEAM');
  const AccessLevel = E('NONE', 'SUMMARY', 'STANDARD', 'FULL');
  const AuthorityMode = E('INTERNAL_MASTER', 'EXTERNAL_MASTER', 'HYBRID', 'REFERENCE_ONLY');
  const FieldAuthority = E('INTERNAL', 'EXTERNAL', 'MERGE', 'MANUAL_REVIEW');
  const SyncStatus = E('NEVER_SYNCED', 'SYNCED', 'PENDING', 'FAILED', 'CONFLICT');
  const Objective = E('LIVE', 'INVEST', 'LIVE_OR_INVEST', 'UNDECIDED');
  const PreferenceSource = E('CUSTOMER_EXPLICIT', 'BROKER_RECORDED', 'IMPORTED', 'SYSTEM_SUGGESTED_UNCONFIRMED');
  const BudgetDataState = E('PROVIDED', 'NEEDS_CONFIRMATION', 'UNKNOWN', 'NOT_AVAILABLE');
  const DuplicateSignal = E('SAME_NORMALIZED_PHONE', 'SAME_NORMALIZED_EMAIL', 'SAME_EXTERNAL_REF', 'SIMILAR_NAME', 'SAME_NAME_AND_CONTACT_FRAGMENT');
  const DuplicateStatus = E('OPEN', 'CONFIRMED_DUPLICATE', 'NOT_DUPLICATE', 'MERGED');
  const ProjectionMode = E('SUMMARY', 'STANDARD', 'FULL', 'CLIENT_SAFE', 'TECHNICAL');
  const ContextSource = E('CUSTOMER_LIST', 'SEARCH', 'DEEP_LINK', 'RECOMMENDATION', 'RESTORE');
  const EventType = E('CustomerCreated', 'CustomerUpdated', 'CustomerArchived', 'CustomerAssignmentChanged', 'CustomerContactAdded', 'CustomerContactUpdated',
    'CustomerPreferenceProfileUpdated', 'CustomerDuplicateDetected', 'CustomerMerged', 'CustomerExternalRefLinked', 'CommunicationPreferenceChanged', 'CustomerAnonymized');
  const Errors = E('MISSING_ORGANIZATION', 'INVALID_TYPE', 'MISSING_FIELD', 'PII_AS_ID', 'INVALID_ID', 'CONTACT_REQUIRED', 'DUPLICATE_WARNING', 'INVALID_CONTACT_TYPE',
    'EMPTY_CONTACT', 'INVALID_CHANNEL', 'INVALID_CONSENT', 'INVALID_ROLE', 'INVALID_ASSIGNEE', 'AUTHORITY_MODE_REQUIRED', 'INVALID_AUTHORITY_MODE', 'MISSING_EXTERNAL_ID',
    'INVALID_OBJECTIVE', 'UNSUPPORTED_PREFERENCE', 'DUPLICATE_PREFERENCE', 'INVALID_IMPORTANCE', 'INVALID_SOURCE', 'UNSUPPORTED_CONSTRAINT', 'INVALID_MONEY',
    'CUSTOMER_REVISION_CONFLICT', 'CROSS_TENANT', 'MERGE_SAME_CUSTOMER', 'MERGE_INVALID_STATE', 'PROFILE_DECISION_REQUIRED', 'EXTERNAL_REF_CONFLICT', 'NOT_FOUND',
    'CONTACT_SEARCH_NOT_ALLOWED', 'REASON_REQUIRED', 'IMMUTABLE_VERSION');
  const MESSAGES = Object.freeze({
    MISSING_FIELD: 'Informe o nome do cliente.', CONTACT_REQUIRED: 'Esta organização exige ao menos um contato.',
    DUPLICATE_WARNING: 'Pode existir um cadastro parecido. Confira antes de continuar.', CUSTOMER_REVISION_CONFLICT: 'O cadastro mudou desde que foi aberto. Recarregue e revise.',
    PROFILE_DECISION_REQUIRED: 'Os cadastros têm perfis diferentes: escolha qual perfil manter.', EXTERNAL_REF_CONFLICT: 'Os cadastros apontam para registros diferentes no CRM: decida antes de unir.',
    POTENTIAL_DUPLICATE_REQUIRES_REVIEW: 'Possível cadastro duplicado: requer revisão.', NOT_FOUND: 'Cliente não encontrado ou sem acesso.', CONTACT_SEARCH_NOT_ALLOWED: 'Busca por telefone ou e-mail exige permissão de contato.'
  });
  const SCHEMA_VERSION = 'customer-profile/1';
  const cfgRoot = () => (App.configs && App.configs.customer && App.configs.customer.policy) || {};
  /** org policy (creation, duplicates, offline, retention ref): organization override over defaults */
  function policyOf(orgId) {
    const c = cfgRoot(), d = c.defaults || {}, o = (c.organizations || {})[orgId] || {};
    return Object.freeze({ ...d, ...o, creationPolicy: Object.freeze({ ...(d.creationPolicy || {}), ...(o.creationPolicy || {}) }), duplicatePolicy: Object.freeze({ mode: 'SUGGEST_ONLY', nameSimilarityThreshold: 0.8, ...(d.duplicatePolicy || {}), ...(o.duplicatePolicy || {}) }),
      offlinePolicy: Object.freeze({ allowSummaryCache: false, allowContactCache: false, allowProfileCache: false, allowNotesCache: false, ...(d.offlinePolicy || {}), ...(o.offlinePolicy || {}) }) });
  }
  const checksum = v => App.methodology.checksum(v);
  const nowIso = now => new Date(now == null ? Date.now() : now).toISOString();
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  const plain = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  let seq = 0;
  function rand() { try { const c = (typeof crypto !== 'undefined' && crypto) || null; if (c && c.getRandomValues) { const a = new Uint32Array(2); c.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); } } catch (_) { /* no crypto */ } return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6); }
  /** opaque id: never built from name/phone/email/CPF */
  const newId = (prefix, opts = {}) => opts.idGen ? opts.idGen(prefix) : `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}${rand()}`;
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/;
  const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
  /** true when a string looks like contact data or a document number (email, ≥8 digits in a row ignoring separators, CPF/CNPJ masks) */
  function looksLikePII(s) {
    if (typeof s !== 'string') return false;
    if (EMAIL_RE.test(s)) return true;
    if (/\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(s)) return true;
    return /\d{8,}/.test(s.replace(/[\s().+\-/]/g, ''));
  }
  const PII_KEY = /^(name|nome|displayname|fullname|firstname|lastname|preferredname|legalname|tradename|customername|email|e-mail|phone|telefone|whatsapp|cpf|cnpj|rg|document|registrationref|address|endereco|value|normalizedvalue|text|note|notes|message|body|transcript|budget|income|renda|query|q)$/i;
  /** redactPII(obj) → copy without PII keys and with PII-looking strings masked (logs, events, analytics, conflicts) */
  function redactPII(obj) {
    if (Array.isArray(obj)) return obj.map(redactPII);
    if (obj && typeof obj === 'object') { const o = {}; for (const [k, v] of Object.entries(obj)) { if (PII_KEY.test(k)) continue; o[k] = redactPII(v); } return o; }
    return typeof obj === 'string' && looksLikePII(obj) ? '[redacted]' : obj;
  }
  /** safe log line: ids + operation + status + correlation only */
  const logEntry = (operation, { customerId = null, status = 'OK', correlationId = null, codes = [] } = {}) => Object.freeze({ operation, customerId, status, correlationId, codes: Object.freeze([...codes]) });
  /** domain event: ids and codes only (PII keys are dropped, PII-looking strings masked) */
  function event(type, data = {}, opts = {}) {
    if (!EventType[type]) throw Object.assign(new Error('evento desconhecido: ' + type), { code: 'UNKNOWN_EVENT' });
    return deepFreeze({ id: newId('cev', opts), type, occurredAt: nowIso(opts.now), ...redactPII(data) });
  }
  const fail = (code, extra = {}) => Object.freeze({ ok: false, code, message: MESSAGES[code] || code, ...extra });
  const normText = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  // ------------------------------------------------------------------ contact normalization (conservative; never "fixes" a value)
  /** normalizePhone(raw, country) → { status, normalizedValue? } — E.164 when the number is unambiguous, else UNPARSEABLE */
  function normalizePhone(raw, country = 'BR') {
    const s = String(raw == null ? '' : raw).trim();
    if (!s || /[a-z]/i.test(s) || !/^\+?[\d\s().-]+$/.test(s)) return { status: NormalizationStatus.UNPARSEABLE };
    const plus = s.startsWith('+'), d = s.replace(/\D/g, '');
    const br = n => { // n = national digits (DDD + number)
      if (!/^[1-9][1-9]/.test(n)) return null;
      if (n.length === 11 && n[2] === '9') return '+55' + n;
      if (n.length === 10 && /[2-5]/.test(n[2])) return '+55' + n;
      return null;
    };
    let e164 = null;
    if (plus) { if (d.startsWith('55')) e164 = br(d.slice(2)); else if (d.length >= 8 && d.length <= 15 && d[0] !== '0') e164 = '+' + d; }
    else if (country === 'BR') e164 = d.length >= 12 && d.startsWith('55') ? br(d.slice(2)) : br(d);
    return e164 ? { status: NormalizationStatus.NORMALIZED, normalizedValue: e164 } : { status: NormalizationStatus.UNPARSEABLE };
  }
  /** normalizeEmail(raw) — trims and lower-cases the domain only; malformed → UNPARSEABLE (kept as typed) */
  function normalizeEmail(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return { status: NormalizationStatus.UNPARSEABLE };
    const at = s.lastIndexOf('@');
    return { status: NormalizationStatus.NORMALIZED, normalizedValue: s.slice(0, at) + '@' + s.slice(at + 1).toLowerCase() };
  }
  const matchKeyOf = c => c && c.normalizedValue ? (c.type === 'EMAIL' ? 'E:' + c.normalizedValue.toLowerCase() : c.type === 'OTHER' ? null : 'P:' + c.normalizedValue) : null;
  /** maskContact(c) — STANDARD projection: last digits / first letter + domain only */
  function maskContact(c) {
    if (!c || c.value == null) return null;
    if (c.type === 'EMAIL') { const v = c.normalizedValue || c.value, at = v.lastIndexOf('@'); return at > 0 ? v[0] + '•••@' + v.slice(at + 1) : '•••'; }
    const d = String(c.normalizedValue || c.value).replace(/\D/g, ''); return d.length >= 4 ? '•••• ' + d.slice(-4) : '••••';
  }

  // ------------------------------------------------------------------ Customer
  /** createCustomer(input, opts) → { ok, customer, details, contactPoints, communicationPreferences, privacyProfile, assignments, duplicateWarnings, events } */
  function createCustomer(input = {}, opts = {}) {
    const orgId = opts.organizationId || input.organizationId, pol = policyOf(orgId), now = nowIso(opts.now), actor = opts.actorId || null;
    if (!orgId || !ID_RE.test(orgId)) return fail(Errors.MISSING_ORGANIZATION);
    const type = input.type || CustomerType.PERSON; if (!CustomerType[type]) return fail(Errors.INVALID_TYPE);
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
    for (const f of pol.creationPolicy.minimumFields || []) if (f === 'displayName' ? !displayName : input[f] == null) return fail(Errors.MISSING_FIELD, { field: f });
    if (input.id != null) { if (typeof input.id !== 'string' || !ID_RE.test(input.id)) return fail(Errors.INVALID_ID); if (looksLikePII(input.id)) return fail(Errors.PII_AS_ID); }
    const contactsIn = (input.contacts || []).filter(c => c && c.value != null && String(c.value).trim());
    if (pol.creationPolicy.requireContactPoint && !contactsIn.length) return fail(Errors.CONTACT_REQUIRED);
    const id = input.id || newId('cus', opts);
    const customer = { id, organizationId: orgId, type, displayName, lifecycleStatus: LifecycleStatus.ACTIVE, currentPreferenceProfileVersionId: undefined, privacyProfileId: undefined,
      externalRefs: [], createdAt: now, updatedAt: now, createdBy: actor, updatedBy: undefined, recordRevision: 1, metadata: input.metadata ? redactPII(input.metadata) : undefined };
    const details = type === 'PERSON'
      ? { customerId: id, firstName: input.firstName || undefined, lastName: input.lastName || undefined, preferredName: input.preferredName || undefined, locale: input.locale || undefined }
      : { customerId: id, legalName: input.legalName || undefined, tradeName: input.tradeName || undefined, registrationRef: input.registrationRef || undefined, contactPersonCustomerId: input.contactPersonCustomerId || undefined };
    const contactPoints = [], errors = [];
    for (const c of contactsIn) { const r = newContactPoint(customer, c, { ...opts, isPrimary: !contactPoints.some(x => x.type === c.type) && c.isPrimary !== false }); if (r.ok) contactPoints.push(r.contact); else errors.push(r.code); }
    const privacy = createPrivacyProfile(customer, { ...opts, dataClassification: input.dataClassification || pol.dataClassificationDefault || DataClassification.STANDARD_PII });
    customer.privacyProfileId = privacy.id;
    const assignments = input.ownerUserId ? [assign(customer, { assigneeType: 'USER', assigneeId: input.ownerUserId, role: 'OWNER' }, opts).assignment].filter(Boolean) : [];
    // duplicate check (same tenant only); never blocks unless the org says so
    let duplicateWarnings = [];
    if (pol.creationPolicy.duplicateCheckRequired && opts.existing) {
      const cands = detectDuplicates({ customers: [customer, ...opts.existing.customers || []], contacts: [...contactPoints, ...(opts.existing.contacts || [])], externalRefs: [] }, { organizationId: orgId, only: id, now: opts.now, idGen: opts.idGen });
      duplicateWarnings = cands.map(c => duplicateWarning(c, id, opts.isVisible || (() => false)));
      if (duplicateWarnings.length && !pol.creationPolicy.allowCreateWithDuplicateWarning) return fail(Errors.DUPLICATE_WARNING, { duplicateWarnings });
    }
    const events = [event('CustomerCreated', { organizationId: orgId, customerId: id, customerType: type, contactCount: contactPoints.length }, opts),
      ...contactPoints.map(c => event('CustomerContactAdded', { organizationId: orgId, customerId: id, contactPointId: c.id, contactType: c.type }, opts)),
      ...assignments.map(a => event('CustomerAssignmentChanged', { organizationId: orgId, customerId: id, assignmentId: a.id, role: a.role }, opts))];
    return deepFreeze({ ok: true, customer, details, contactPoints, communicationPreferences: [], privacyProfile: privacy, assignments, duplicateWarnings, events, errors });
  }
  /** updateCustomer(customer, patch, { expectedRevision }) — optimistic concurrency; id/org/createdAt are immutable */
  function updateCustomer(customer, patch = {}, opts = {}) {
    if (opts.expectedRevision == null || opts.expectedRevision !== customer.recordRevision) return fail(Errors.CUSTOMER_REVISION_CONFLICT, { currentRevision: customer.recordRevision });
    if (customer.lifecycleStatus === 'MERGED' || customer.lifecycleStatus === 'DELETED') return fail(Errors.MERGE_INVALID_STATE);
    const next = { ...plain(customer) }, changed = [];
    if (patch.displayName != null) { const n = String(patch.displayName).trim().replace(/\s+/g, ' ').slice(0, 120); if (!n) return fail(Errors.MISSING_FIELD, { field: 'displayName' }); if (n !== next.displayName) { next.displayName = n; changed.push('displayName'); } }
    if (patch.currentPreferenceProfileVersionId !== undefined && patch.currentPreferenceProfileVersionId !== next.currentPreferenceProfileVersionId) { next.currentPreferenceProfileVersionId = patch.currentPreferenceProfileVersionId; changed.push('currentPreferenceProfileVersionId'); }
    if (patch.externalRefs) { next.externalRefs = plain(patch.externalRefs); changed.push('externalRefs'); }
    if (patch.lifecycleStatus && patch.lifecycleStatus !== next.lifecycleStatus) { if (!LifecycleStatus[patch.lifecycleStatus]) return fail(Errors.MERGE_INVALID_STATE); next.lifecycleStatus = patch.lifecycleStatus; changed.push('lifecycleStatus'); }
    if (patch.mergedIntoCustomerId) { next.mergedIntoCustomerId = patch.mergedIntoCustomerId; changed.push('mergedIntoCustomerId'); }
    if (!changed.length) return Object.freeze({ ok: true, customer, unchanged: true, events: [] });
    next.recordRevision = customer.recordRevision + 1; next.updatedAt = nowIso(opts.now); next.updatedBy = opts.actorId || null;
    return deepFreeze({ ok: true, customer: next, changed, events: [event(patch.lifecycleStatus === 'ARCHIVED' ? 'CustomerArchived' : 'CustomerUpdated', { organizationId: customer.organizationId, customerId: customer.id, changedFields: changed }, opts)] });
  }
  const archive = (customer, opts = {}) => updateCustomer(customer, { lifecycleStatus: LifecycleStatus.ARCHIVED }, opts);

  // ------------------------------------------------------------------ contact points, consent, privacy
  function newContactPoint(customer, input = {}, opts = {}) {
    if (!ContactPointType[input.type]) return fail(Errors.INVALID_CONTACT_TYPE);
    const value = String(input.value == null ? '' : input.value).trim(); if (!value) return fail(Errors.EMPTY_CONTACT);
    const n = input.type === 'EMAIL' ? normalizeEmail(value) : input.type === 'OTHER' ? { status: NormalizationStatus.NOT_APPLICABLE } : normalizePhone(value, policyOf(customer.organizationId).defaultPhoneCountry || 'BR');
    const now = nowIso(opts.now);
    // presence ≠ verification: every new contact starts UNVERIFIED, even when it parses
    return deepFreeze({ ok: true, normalization: n.status, contact: { id: newId('ccp', opts), organizationId: customer.organizationId, customerId: customer.id, type: input.type, value, normalizedValue: n.normalizedValue, normalizationStatus: n.status,
      label: input.label || undefined, isPrimary: opts.isPrimary != null ? !!opts.isPrimary : !!input.isPrimary, verificationStatus: VerificationStatus.UNVERIFIED, lifecycleStatus: ContactLifecycle.ACTIVE, createdAt: now, updatedAt: now } });
  }
  const addContactPoint = (customer, input, opts = {}) => { const r = newContactPoint(customer, input, opts); return r.ok ? Object.freeze({ ...r, events: [event('CustomerContactAdded', { organizationId: customer.organizationId, customerId: customer.id, contactPointId: r.contact.id, contactType: r.contact.type }, opts)] }) : r; };
  /** setVerification(contact, status, { method }) — only an explicit verification changes it */
  function setVerification(contact, status, opts = {}) {
    if (!VerificationStatus[status]) return fail('INVALID_VERIFICATION');
    return deepFreeze({ ok: true, contact: { ...plain(contact), verificationStatus: status, verificationMethod: opts.method || undefined, updatedAt: nowIso(opts.now) }, events: [event('CustomerContactUpdated', { organizationId: contact.organizationId, customerId: contact.customerId, contactPointId: contact.id, verificationStatus: status }, opts)] });
  }
  /** setCommunicationPreference(customer, { channel, consentStatus, purposeCode, sourceRef }) — records a decision; never infers one */
  function setCommunicationPreference(customer, input = {}, opts = {}) {
    if (!CommunicationChannel[input.channel]) return fail(Errors.INVALID_CHANNEL);
    if (!ConsentStatus[input.consentStatus]) return fail(Errors.INVALID_CONSENT);
    const now = nowIso(opts.now), st = input.consentStatus;
    const rec = { id: newId('ccm', opts), organizationId: customer.organizationId, customerId: customer.id, channel: input.channel, consentStatus: st, purposeCode: input.purposeCode || undefined, sourceRef: input.sourceRef || undefined,
      grantedAt: st === 'GRANTED' ? now : undefined, revokedAt: st === 'REVOKED' ? now : undefined, updatedAt: now, recordedBy: opts.actorId || undefined };
    return deepFreeze({ ok: true, preference: rec, events: [event('CommunicationPreferenceChanged', { organizationId: customer.organizationId, customerId: customer.id, channel: input.channel, consentStatus: st, purposeCode: input.purposeCode || null }, opts)] });
  }
  /** consentOf(prefs, channel, purposeCode?) → ConsentStatus — latest record for the channel(/purpose); none → UNKNOWN (a phone number is not consent) */
  function consentOf(prefs, channel, purposeCode) {
    const rel = (prefs || []).filter(p => p.channel === channel && (!purposeCode || !p.purposeCode || p.purposeCode === purposeCode)).sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    return rel.length ? rel[rel.length - 1].consentStatus : ConsentStatus.UNKNOWN;
  }
  const mayContact = (prefs, channel, purposeCode) => { const s = consentOf(prefs, channel, purposeCode); return s === 'GRANTED' || s === 'NOT_REQUIRED_BY_POLICY'; };
  function createPrivacyProfile(customer, opts = {}) {
    const now = nowIso(opts.now), pol = policyOf(customer.organizationId);
    return deepFreeze({ id: newId('cpp', opts), organizationId: customer.organizationId, customerId: customer.id, dataClassification: DataClassification[opts.dataClassification] ? opts.dataClassification : DataClassification.STANDARD_PII,
      retentionPolicyRef: pol.retentionPolicyRef || undefined, marketingCommunicationAllowed: undefined, dataExportRestriction: undefined, createdAt: now, updatedAt: now });
  }

  // ------------------------------------------------------------------ assignments (workflow ownership; never a substitute for RBAC)
  function assign(customer, input = {}, opts = {}) {
    if (!AssigneeType[input.assigneeType] || !input.assigneeId || !ID_RE.test(input.assigneeId)) return fail(Errors.INVALID_ASSIGNEE);
    if (!AssignmentRole[input.role]) return fail(Errors.INVALID_ROLE);
    const now = nowIso(opts.now), current = (opts.current || []).filter(a => a.customerId === customer.id && a.status === 'ACTIVE');
    const ended = input.role === 'OWNER' ? current.filter(a => a.role === 'OWNER').map(a => ({ ...plain(a), status: AssignmentStatus.ENDED, endedAt: now, reasonCode: 'OWNER_REPLACED' })) : [];
    const assignment = { id: newId('cas', opts), organizationId: customer.organizationId, customerId: customer.id, assigneeType: input.assigneeType, assigneeId: input.assigneeId, role: input.role, status: AssignmentStatus.ACTIVE, assignedAt: now, assignedBy: opts.actorId || null, reasonCode: input.reasonCode || undefined };
    return deepFreeze({ ok: true, assignment, ended, events: [event('CustomerAssignmentChanged', { organizationId: customer.organizationId, customerId: customer.id, assignmentId: assignment.id, role: input.role, endedAssignmentIds: ended.map(a => a.id) }, opts)] });
  }
  const endAssignment = (a, opts = {}) => deepFreeze({ ...plain(a), status: AssignmentStatus.ENDED, endedAt: nowIso(opts.now), reasonCode: opts.reasonCode || a.reasonCode });
  const activeAssignmentFor = (assignments, customerId, principal = {}) => (assignments || []).find(a => a.customerId === customerId && a.status === 'ACTIVE' &&
    ((a.assigneeType === 'USER' && a.assigneeId === principal.userId) || (a.assigneeType === 'TEAM' && (principal.teamIds || []).includes(a.assigneeId)))) || null;

  // ------------------------------------------------------------------ access decision: Tenant AND Permission AND Assignment AND Lifecycle
  /** permission checker over App.authz; keys that are not in the registry are denied (deny by default) */
  function canFromAuthz(authCtx, resource) {
    return key => { try { return !!(App.permissions && App.permissions.has(key) && App.authz.evaluate(authCtx || App.authz.context(), { permission: key, resource }).allowed); } catch (_) { return false; } };
  }
  /** static/device mode: only what the existing local customer list does (name, lots, profile) under customer_profile.manage; contacts never */
  const LOCAL_KEYS = Object.freeze(['customer.read', 'customer.create', 'customer.update', 'customer.archive', 'customer.profile.read', 'customer.profile.update']);
  function localDeviceCan(authCtx, resource) { const k = (cfgRoot().permissionCatalog || {}).localDeviceKey || 'customer_profile.manage', ok = canFromAuthz(authCtx, resource)(k); return key => ok && LOCAL_KEYS.includes(key); }
  /** decideAccess({ customer, principal: { userId, organizationId, teamIds }, assignments, can }) → CustomerAccessDecision */
  function decideAccess({ customer, principal = {}, assignments = [], can = () => false } = {}) {
    const D = (codes, extra = {}) => Object.freeze({ allowed: false, accessLevel: AccessLevel.NONE, reasonCodes: Object.freeze(codes), ...extra });
    if (!customer) return D(['NOT_FOUND']);
    if (!principal.organizationId || principal.organizationId !== customer.organizationId) return D(['NOT_FOUND']); // cross-tenant: indistinguishable from "does not exist"
    if (customer.lifecycleStatus === 'DELETED') return D(['CUSTOMER_DELETED']);
    if (customer.lifecycleStatus === 'MERGED') return D(['CUSTOMER_MERGED'], { canonicalCustomerId: customer.mergedIntoCustomerId || null });
    const perms = [], asg = activeAssignmentFor(assignments, customer.id, principal);
    if (can('customer.read')) perms.push('customer.read');
    else if (can('customer.readAssigned') && asg) perms.push('customer.readAssigned');
    else return D([can('customer.readAssigned') ? 'NOT_ASSIGNED' : 'NO_GRANT']);
    let level = AccessLevel.SUMMARY;
    if (can('customer.profile.read')) { level = AccessLevel.STANDARD; perms.push('customer.profile.read'); }
    if (level === AccessLevel.STANDARD && can('customer.contact.read') && can('customer.privacy.read')) { level = AccessLevel.FULL; perms.push('customer.contact.read', 'customer.privacy.read'); }
    const viewerOnly = asg && asg.role === 'VIEWER' && !can('customer.read');
    const write = customer.lifecycleStatus === 'ACTIVE' && can('customer.update') && !viewerOnly;
    return Object.freeze({ allowed: true, accessLevel: level, reasonCodes: Object.freeze(customer.lifecycleStatus === 'ARCHIVED' ? ['ALLOWED', 'ARCHIVED_READ_ONLY'] : ['ALLOWED']),
      assignmentRef: asg ? asg.id : undefined, permissionRefs: Object.freeze(perms), canWrite: write, canReadContacts: level === AccessLevel.FULL || (level === AccessLevel.STANDARD && can('customer.contact.read')) });
  }

  // ------------------------------------------------------------------ external refs and field authority
  function linkExternalRef(customer, input = {}, opts = {}) {
    if (!input.provider || !ID_RE.test(String(input.provider))) return fail('INVALID_PROVIDER');
    if (!input.externalId) return fail(Errors.MISSING_EXTERNAL_ID);
    if (!input.authorityMode) return fail(Errors.AUTHORITY_MODE_REQUIRED); // never chosen automatically
    if (!AuthorityMode[input.authorityMode]) return fail(Errors.INVALID_AUTHORITY_MODE);
    const clash = (customer.externalRefs || []).find(r => r.provider === input.provider && r.externalId !== String(input.externalId));
    if (clash && !opts.allowMultiplePerProvider) return fail(Errors.EXTERNAL_REF_CONFLICT, { provider: input.provider });
    if ((customer.externalRefs || []).some(r => r.provider === input.provider && r.externalId === String(input.externalId))) return Object.freeze({ ok: true, unchanged: true, customer, events: [] });
    const ref = { id: newId('cxr', opts), provider: String(input.provider), externalId: String(input.externalId), authorityMode: input.authorityMode, syncStatus: SyncStatus.NEVER_SYNCED, lastSyncedAt: undefined, metadata: input.metadata ? redactPII(input.metadata) : undefined };
    const r = updateCustomer(customer, { externalRefs: [...plain(customer.externalRefs || []), ref] }, { ...opts, expectedRevision: opts.expectedRevision != null ? opts.expectedRevision : customer.recordRevision });
    if (!r.ok) return r;
    return deepFreeze({ ok: true, customer: r.customer, ref, events: [event('CustomerExternalRefLinked', { organizationId: customer.organizationId, customerId: customer.id, provider: ref.provider, externalRefId: ref.id, authorityMode: ref.authorityMode }, opts)] });
  }
  /** fieldAuthority(policies, fieldPath, provider, authorityMode) → INTERNAL | EXTERNAL | MERGE | MANUAL_REVIEW */
  function fieldAuthority(policies, fieldPath, provider, mode) {
    const p = (policies || []).find(x => x.fieldPath === fieldPath && (!x.provider || x.provider === provider));
    if (mode === 'REFERENCE_ONLY' || mode === 'INTERNAL_MASTER') return p && mode === 'INTERNAL_MASTER' && p.authority === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL';
    if (mode === 'EXTERNAL_MASTER') return p ? p.authority : 'EXTERNAL';
    return p ? p.authority : 'MANUAL_REVIEW'; // HYBRID without a field policy: a person decides (no blind last-write-wins)
  }
  /** applyExternalChanges(customer, { provider, changes: { fieldPath: value } }, { policies }) → { applied, conflicts } — conflicts carry fingerprints, never values */
  function applyExternalChanges(customer, { provider, changes = {} } = {}, opts = {}) {
    const ref = (customer.externalRefs || []).find(r => r.provider === provider); if (!ref) return fail('EXTERNAL_REF_NOT_FOUND');
    const policies = opts.policies || policyOf(customer.organizationId).fieldAuthorityPolicies || [], applied = {}, conflicts = [];
    for (const [fieldPath, ext] of Object.entries(changes)) {
      const cur = fieldPath.split('.').reduce((o, k) => o == null ? o : o[k], customer), auth = fieldAuthority(policies, fieldPath, provider, ref.authorityMode);
      if (JSON.stringify(cur) === JSON.stringify(ext)) continue;
      if (auth === 'EXTERNAL') { applied[fieldPath] = ext; continue; }
      conflicts.push(Object.freeze({ id: newId('csc', opts), organizationId: customer.organizationId, customerId: customer.id, provider, fieldPath, internalValueFingerprint: checksum(cur == null ? null : cur), externalValueFingerprint: checksum(ext == null ? null : ext),
        authorityPolicy: auth + '/' + ref.authorityMode, status: auth === 'INTERNAL' ? 'AUTO_RESOLVED' : 'MANUAL_REVIEW', detectedAt: nowIso(opts.now) }));
    }
    return deepFreeze({ ok: true, applied, conflicts });
  }

  // ------------------------------------------------------------------ preference profile (versioned, immutable)
  const fitCfg = devId => { try { return App.fit.cfgOf(devId || 'viva-juara'); } catch (_) { return null; } };
  const recCfg = devId => { try { return App.recommendation.policyOf(devId || 'viva-juara'); } catch (_) { return null; } };
  function createPreferenceProfile(customer, opts = {}) {
    const now = nowIso(opts.now);
    return deepFreeze({ id: newId('cpf', opts), organizationId: customer.organizationId, customerId: customer.id, currentVersionId: undefined, status: 'ACTIVE', createdAt: now, updatedAt: now });
  }
  const IMPORTANCE = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
  function money(m, path, errors) {
    if (m == null) return undefined;
    const amount = typeof m === 'number' ? m : m.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) { errors.push({ code: Errors.INVALID_MONEY, path, message: 'valor deve ser positivo; desconhecido é ausente (nunca 0)' }); return undefined; }
    return { amount, currency: (m && m.currency) || 'BRL' };
  }
  /** validateProfileInput(input, { developmentId }) → { errors, warnings, value } — supported criteria only; suggestions stay inactive */
  function validateProfileInput(input = {}, opts = {}) {
    const errors = [], warnings = [], fc = fitCfg(opts.developmentId), rc = recCfg(opts.developmentId), supported = fc ? Object.keys(fc.preferences) : [], consKeys = rc ? Object.keys(rc.constraints || {}) : [];
    if (input.objective != null && !Objective[input.objective]) errors.push({ code: Errors.INVALID_OBJECTIVE, path: 'objective' });
    const seen = new Set(), preferences = [];
    (input.preferences || []).forEach((p, i) => {
      const path = `preferences[${i}]`;
      if (!p || !supported.includes(p.key)) { errors.push({ code: Errors.UNSUPPORTED_PREFERENCE, path }); return; }
      if (seen.has(p.key)) { errors.push({ code: Errors.DUPLICATE_PREFERENCE, path }); return; } seen.add(p.key);
      if (!IMPORTANCE.includes(p.importance)) { errors.push({ code: Errors.INVALID_IMPORTANCE, path }); return; }
      const source = p.source || PreferenceSource.BROKER_RECORDED; if (!PreferenceSource[source]) { errors.push({ code: Errors.INVALID_SOURCE, path }); return; }
      let active = p.active !== false;
      if (source === 'SYSTEM_SUGGESTED_UNCONFIRMED' && active) { active = false; warnings.push({ code: 'SUGGESTION_NOT_ACTIVATED', path }); }
      preferences.push({ key: p.key, fieldKey: fc.preferences[p.key].fieldKey, target: p.target === undefined ? null : p.target, importance: p.importance, source, explicit: source === 'CUSTOMER_EXPLICIT' || source === 'BROKER_RECORDED', active });
    });
    const cseen = new Set(), hardConstraints = [];
    (input.hardConstraints || []).forEach((c, i) => {
      const path = `hardConstraints[${i}]`;
      if (!c || !consKeys.includes(c.key)) { errors.push({ code: Errors.UNSUPPORTED_CONSTRAINT, path }); return; }
      if (cseen.has(c.key)) { errors.push({ code: Errors.DUPLICATE_PREFERENCE, path }); return; } cseen.add(c.key);
      const source = c.source || PreferenceSource.BROKER_RECORDED; if (!PreferenceSource[source] || source === 'SYSTEM_SUGGESTED_UNCONFIRMED') { errors.push({ code: Errors.INVALID_SOURCE, path }); return; }
      if (c.value == null && !['IS_FALSE', 'IS_TRUE'].includes((rc.constraints[c.key] || {}).operator)) { errors.push({ code: Errors.MISSING_FIELD, path: path + '.value' }); return; }
      hardConstraints.push({ key: c.key, value: c.value === undefined ? true : c.value, source });
    });
    let budgetProfile;
    if (input.budgetProfile) {
      const b = input.budgetProfile, out = { currency: b.currency || 'BRL' };
      for (const k of ['targetPurchasePriceMin', 'targetPurchasePriceMax', 'maximumPurchasePrice', 'availableDownPayment', 'preferredMonthlyPaymentMax']) { const v = money(b[k], 'budgetProfile.' + k, errors); if (v) out[k] = v; }
      if (b.financingPreference) out.financingPreference = String(b.financingPreference).slice(0, 40);
      const any = ['targetPurchasePriceMin', 'targetPurchasePriceMax', 'maximumPurchasePrice', 'availableDownPayment', 'preferredMonthlyPaymentMax'].some(k => out[k]);
      out.dataState = BudgetDataState[b.dataState] ? b.dataState : any ? BudgetDataState.NEEDS_CONFIRMATION : BudgetDataState.UNKNOWN;
      if (!any && (out.dataState === 'PROVIDED' || out.dataState === 'NEEDS_CONFIRMATION')) out.dataState = BudgetDataState.UNKNOWN;
      if (b.recordedAt) out.recordedAt = b.recordedAt;
      budgetProfile = out;
    }
    return { errors, warnings, value: { objective: input.objective || undefined, preferences, hardConstraints, budgetProfile, hardConstraintsReviewed: !!input.hardConstraintsReviewed } };
  }
  /** completeness(version) → { ratio 0–1, answered[], missing[] } — how much of the profile is filled; NOT confidence */
  function completeness(v) {
    const items = ((cfgRoot().completeness || {}).items || [{ key: 'objective' }, { key: 'budget' }, { key: 'preferences' }, { key: 'hardConstraintsReviewed' }]).map(i => i.key);
    const has = { objective: !!(v && v.objective), budget: !!(v && v.budgetProfile && v.budgetProfile.dataState !== 'UNKNOWN'), preferences: !!(v && (v.preferences || []).some(p => p.active)), hardConstraintsReviewed: !!(v && (v.hardConstraintsReviewed || (v.hardConstraints || []).length)) };
    const answered = items.filter(k => has[k]), missing = items.filter(k => !has[k]);
    return Object.freeze({ ratio: items.length ? answered.length / items.length : 0, answered: Object.freeze(answered), missing: Object.freeze(missing) });
  }
  /** createProfileVersion({ profile, previous, input }, opts) → { ok, version, profile, unchanged?, warnings, events } — saved versions are frozen; changes create V(n+1) */
  function createProfileVersion({ profile, previous = null, input = {} } = {}, opts = {}) {
    const r = validateProfileInput(input, opts);
    if (r.errors.length) return Object.freeze({ ok: false, code: r.errors[0].code, errors: Object.freeze(r.errors), warnings: Object.freeze(r.warnings) });
    const body = { schemaVersion: SCHEMA_VERSION, ...plain(r.value) }, sum = checksum(body);
    if (previous && previous.checksum === sum) return Object.freeze({ ok: true, unchanged: true, version: previous, profile, warnings: Object.freeze(r.warnings), events: [] });
    const now = nowIso(opts.now), version = {
      id: newId('cpv', opts), organizationId: profile.organizationId, customerId: profile.customerId, profileId: profile.id, version: previous ? previous.version + 1 : 1, schemaVersion: SCHEMA_VERSION,
      objective: r.value.objective, preferences: r.value.preferences, hardConstraints: r.value.hardConstraints, budgetProfile: r.value.budgetProfile, hardConstraintsReviewed: r.value.hardConstraintsReviewed,
      profileCompleteness: null, sourceSummary: null, createdAt: now, createdBy: opts.actorId || null, checksum: sum, supersedesVersionId: previous ? previous.id : undefined, developmentId: opts.developmentId || undefined };
    version.profileCompleteness = plain(completeness(version));
    const counts = {}; for (const p of version.preferences) counts[p.source] = (counts[p.source] || 0) + 1; for (const c of version.hardConstraints) counts[c.source] = (counts[c.source] || 0) + 1;
    version.sourceSummary = counts;
    const nextProfile = { ...plain(profile), currentVersionId: version.id, updatedAt: now };
    return deepFreeze({ ok: true, version, profile: nextProfile, warnings: r.warnings, events: [event('CustomerPreferenceProfileUpdated', { organizationId: profile.organizationId, customerId: profile.customerId, profileVersionId: version.id, version: version.version }, opts)] });
  }
  /** fromUiState({ preferences: {key: 1..3}, constraints: {key: value} }) → profile input (what the broker typed on the panel: BROKER_RECORDED) */
  function fromUiState(ui = {}, opts = {}) {
    const fc = fitCfg(opts.developmentId), li = (fc && fc.legacyImportance) || { 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH' };
    const preferences = Object.entries(ui.preferences || {}).filter(([k, w]) => w && fc && fc.preferences[k]).map(([key, w]) => ({ key, importance: typeof w === 'string' ? w : li[String(w)], source: opts.source || 'BROKER_RECORDED' })).filter(p => p.importance);
    const hardConstraints = Object.entries(ui.constraints || {}).filter(([, v]) => v != null && v !== false && v !== '').map(([key, value]) => ({ key, value, source: opts.source || 'BROKER_RECORDED' }));
    return { objective: ui.customerObjective || undefined, preferences, hardConstraints, hardConstraintsReviewed: Object.keys(ui.constraints || {}).length > 0 };
  }
  /** toUiState(version) → { preferences, constraints } in the panel's shape (inverse of fromUiState) */
  function toUiState(version, opts = {}) {
    const fc = fitCfg(opts.developmentId || (version && version.developmentId)), inv = {}; for (const [w, imp] of Object.entries((fc && fc.legacyImportance) || {})) inv[imp] = +w;
    const preferences = {}, constraints = {};
    for (const p of (version && version.preferences) || []) if (p.active && p.target == null && inv[p.importance]) preferences[p.key] = inv[p.importance];
    for (const c of (version && version.hardConstraints) || []) constraints[c.key] = c.value;
    return { preferences, constraints };
  }
  /** toFitProfile(version, { developmentId }) → CustomerProfile for App.fit (topic 14), built by the unchanged builder. Inactive suggestions are left out. */
  function toFitProfile(version, opts = {}) {
    const devId = opts.developmentId || version.developmentId || 'viva-juara', prefs = {};
    let budgetMax = null, areaMin = null, areaMax = null;
    for (const p of version.preferences || []) {
      if (!p.active) continue;
      if (p.key === 'budget') { if (typeof p.target === 'number') budgetMax = p.target; continue; }
      if (p.key === 'areaRange') { if (p.target) { areaMin = p.target.min ?? null; areaMax = p.target.max ?? null; } continue; }
      prefs[p.key] = p.importance;
    }
    return App.fit.buildProfile({ id: version.customerId, developmentId: devId, preferences: prefs, budgetMax, areaMin, areaMax, updatedAt: version.createdAt });
  }
  /** toRecommendationConstraints(version) → { key: value } for the RecommendationEngine (topic 15). Only hard constraints, never preferences. */
  const toRecommendationConstraints = version => Object.fromEntries((version.hardConstraints || []).map(c => [c.key, c.value]));
  /** createSnapshot(version, customer, purpose) → CustomerProfileSnapshot: references + checksum only, no PII copy */
  function createSnapshot(version, customer, purpose = 'FIT', opts = {}) {
    return deepFreeze({ id: newId('cps', opts), organizationId: version.organizationId, customerId: version.customerId, profileVersionId: version.id, customerRevision: customer ? customer.recordRevision : null,
      preferenceChecksum: version.checksum, createdAt: nowIso(opts.now), purpose });
  }
  /** fitRequestRefs(snapshot, fitProfile) → what Fit/Recommendation record (customerId, profileVersionId, profileSnapshotId, fit profileVersion) */
  const resultRefs = (snapshot, fitProfile) => Object.freeze({ customerId: snapshot.customerId, profileVersionId: snapshot.profileVersionId, profileSnapshotId: snapshot.id, customerProfileVersion: fitProfile ? fitProfile.profileVersion : null });
  /** favorite context (topic 38): CUSTOMER contextRef = canonical customerId */
  const favoriteContext = customerId => Object.freeze({ contextType: 'CUSTOMER', contextRef: customerId });
  /** comparison context (topic 24): mode CUSTOMER with the exact profile refs (the comparison keeps them; switching customer never rewrites it) */
  const comparisonContext = (customerId, profileVersionId, fitProfileVersion) => Object.freeze({ mode: 'CUSTOMER', customerId, profileVersionId: profileVersionId || null, customerProfileVersion: fitProfileVersion || null });

  // ------------------------------------------------------------------ duplicates (SUGGEST_ONLY; same tenant only)
  function nameSimilarity(a, b) {
    const ta = normText(a).split(' ').filter(Boolean), tb = normText(b).split(' ').filter(Boolean); if (!ta.length || !tb.length) return 0;
    if (ta.join(' ') === tb.join(' ')) return 1;
    // token match with initials ("Maria S." ~ "Maria Souza")
    const m = (x, y) => x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y));
    let hit = 0; const used = new Set();
    for (const x of ta) { const j = tb.findIndex((y, i) => !used.has(i) && m(x, y)); if (j >= 0) { used.add(j); hit++; } }
    return hit / Math.max(ta.length, tb.length);
  }
  /** detectDuplicates({ customers, contacts, externalRefs? }, { organizationId, only?, existing? }) → CustomerDuplicateCandidate[] (status OPEN, never auto-merged) */
  function detectDuplicates({ customers = [], contacts = [] } = {}, opts = {}) {
    const org = opts.organizationId, pol = policyOf(org), thr = pol.duplicatePolicy.nameSimilarityThreshold || 0.8;
    const live = customers.filter(c => c.organizationId === org && (c.lifecycleStatus === 'ACTIVE' || c.lifecycleStatus === 'ARCHIVED'));
    const keys = new Map(); for (const c of contacts) { if (c.organizationId !== org || c.lifecycleStatus === 'REVOKED') continue; const k = matchKeyOf(c); if (k) { if (!keys.has(c.customerId)) keys.set(c.customerId, new Set()); keys.get(c.customerId).add(k); } }
    const tail = id => new Set([...(keys.get(id) || [])].filter(k => k.startsWith('P:')).map(k => k.slice(-4)));
    const prior = new Map((opts.existing || []).map(d => [d.customerIdA + '|' + d.customerIdB, d]));
    const out = [];
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const [a, b] = [live[i], live[j]].sort((x, y) => x.id < y.id ? -1 : 1);
      if (opts.only && a.id !== opts.only && b.id !== opts.only) continue;
      const sig = [], ka = keys.get(a.id) || new Set(), kb = keys.get(b.id) || new Set();
      if ([...ka].some(k => k.startsWith('P:') && kb.has(k))) sig.push('SAME_NORMALIZED_PHONE');
      if ([...ka].some(k => k.startsWith('E:') && kb.has(k))) sig.push('SAME_NORMALIZED_EMAIL');
      if ((a.externalRefs || []).some(r => (b.externalRefs || []).some(s => s.provider === r.provider && s.externalId === r.externalId))) sig.push('SAME_EXTERNAL_REF');
      const sim = nameSimilarity(a.displayName, b.displayName);
      if (sim >= thr) sig.push('SIMILAR_NAME');
      if (sim >= 0.5 && !sig.includes('SAME_NORMALIZED_PHONE')) { const ta = tail(a.id), tb = tail(b.id); if ([...ta].some(t => tb.has(t))) sig.push('SAME_NAME_AND_CONTACT_FRAGMENT'); }
      if (!sig.length) continue;
      const p = prior.get(a.id + '|' + b.id); if (p && p.status !== 'OPEN') continue; // reviewed pairs are not reopened
      out.push(deepFreeze({ id: p ? p.id : 'dup_' + checksum([org, a.id, b.id]), organizationId: org, customerIdA: a.id, customerIdB: b.id, matchSignals: sig.map(s => ({ signal: s, strength: s === 'SIMILAR_NAME' ? 'WEAK' : s === 'SAME_NAME_AND_CONTACT_FRAGMENT' ? 'MEDIUM' : 'STRONG' })),
        status: DuplicateStatus.OPEN, action: 'SUGGEST_ONLY', detectedAt: p ? p.detectedAt : nowIso(opts.now) }));
    }
    return out;
  }
  function reviewDuplicate(cand, status, opts = {}) {
    if (!['CONFIRMED_DUPLICATE', 'NOT_DUPLICATE'].includes(status)) return fail('INVALID_STATUS');
    return deepFreeze({ ok: true, candidate: { ...plain(cand), status, reviewedAt: nowIso(opts.now), reviewedBy: opts.actorId || null } });
  }
  /** duplicateWarning(candidate, forCustomerId, isVisible) — the other record's details only when the viewer can see it */
  function duplicateWarning(cand, forId, isVisible = () => false) {
    const other = cand.customerIdA === forId ? cand.customerIdB : cand.customerIdA;
    if (!isVisible(other)) return Object.freeze({ code: 'POTENTIAL_DUPLICATE_REQUIRES_REVIEW', message: MESSAGES.POTENTIAL_DUPLICATE_REQUIRES_REVIEW, candidateId: cand.id });
    return Object.freeze({ code: 'POTENTIAL_DUPLICATE', message: MESSAGES.DUPLICATE_WARNING, candidateId: cand.id, otherCustomerId: other, signals: cand.matchSignals.map(s => s.signal) });
  }

  // ------------------------------------------------------------------ aliases and merge
  /** resolveAlias(aliases, id) → final canonical id (chains collapsed; cycles stop) */
  function resolveAlias(aliases, id) {
    const map = new Map((aliases || []).map(a => [a.aliasCustomerId, a.canonicalCustomerId])); let cur = id; const seen = new Set();
    while (map.has(cur) && !seen.has(cur)) { seen.add(cur); cur = map.get(cur); }
    return cur;
  }
  /** merge(cmd, world, opts) — cmd = { sourceCustomerIds, targetCustomerId, expectedRevisions, fieldDecisions, reasonCode, idempotencyKey };
      world = { customers, contacts, assignments, favorites, aliases, mergeRecords }. Nothing is summed, averaged or silently "newest wins". */
  function merge(cmd = {}, world = {}, opts = {}) {
    const prev = (world.mergeRecords || []).find(m => cmd.idempotencyKey && m.idempotencyKey === cmd.idempotencyKey); if (prev) return Object.freeze({ ok: true, replay: true, record: prev });
    if (!cmd.reasonCode) return fail(Errors.REASON_REQUIRED);
    const byId = new Map((world.customers || []).map(c => [c.id, c])), tgt = byId.get(cmd.targetCustomerId), srcs = (cmd.sourceCustomerIds || []).map(id => byId.get(id));
    if (!tgt || srcs.some(s => !s) || !srcs.length) return fail(Errors.NOT_FOUND);
    if (srcs.some(s => s.id === tgt.id)) return fail(Errors.MERGE_SAME_CUSTOMER);
    if (srcs.some(s => s.organizationId !== tgt.organizationId) || (opts.organizationId && tgt.organizationId !== opts.organizationId)) return fail(Errors.CROSS_TENANT);
    if ([tgt, ...srcs].some(c => c.lifecycleStatus === 'MERGED' || c.lifecycleStatus === 'DELETED')) return fail(Errors.MERGE_INVALID_STATE);
    const exp = cmd.expectedRevisions || {}, stale = [tgt, ...srcs].filter(c => exp[c.id] !== c.recordRevision).map(c => c.id);
    if (stale.length) return fail(Errors.CUSTOMER_REVISION_CONFLICT, { staleCustomerIds: stale });
    const dec = cmd.fieldDecisions || [], decOf = f => dec.find(d => d.fieldPath === f);
    // external refs: same provider, different externalId → explicit decision
    const refs = [...(tgt.externalRefs || [])];
    for (const s of srcs) for (const r of s.externalRefs || []) {
      const same = refs.find(x => x.provider === r.provider);
      if (!same) refs.push(r);
      else if (same.externalId !== r.externalId) { const d = decOf('externalRefs.' + r.provider); if (!d) return fail(Errors.EXTERNAL_REF_CONFLICT, { provider: r.provider }); if (d.choice === 'SOURCE:' + s.id) refs.splice(refs.indexOf(same), 1, r); else if (d.choice === 'KEEP_BOTH') refs.push(r); }
    }
    // profiles: any source profile → explicit decision (KEEP_TARGET | ADOPT_SOURCE:<id> | NEW_VERSION later)
    let profileVersionId = tgt.currentPreferenceProfileVersionId;
    const srcProfiles = srcs.filter(s => s.currentPreferenceProfileVersionId && s.currentPreferenceProfileVersionId !== tgt.currentPreferenceProfileVersionId);
    if (srcProfiles.length) {
      const d = decOf('preferenceProfile'); if (!d) return fail(Errors.PROFILE_DECISION_REQUIRED);
      if (String(d.choice).startsWith('ADOPT_SOURCE:')) { const s = byId.get(d.choice.slice(13)); if (!s || !srcs.includes(s)) return fail(Errors.PROFILE_DECISION_REQUIRED); profileVersionId = s.currentPreferenceProfileVersionId; }
      else if (d.choice !== 'KEEP_TARGET' && d.choice !== 'NEW_VERSION') return fail(Errors.PROFILE_DECISION_REQUIRED);
    }
    let displayName = tgt.displayName; const dn = decOf('displayName'); if (dn && String(dn.choice).startsWith('SOURCE:')) { const s = byId.get(dn.choice.slice(7)); if (s && srcs.includes(s)) displayName = s.displayName; }
    const now = nowIso(opts.now), srcIds = new Set(srcs.map(s => s.id)), actor = opts.actorId || null;
    const target = { ...plain(tgt), displayName, externalRefs: plain(refs), currentPreferenceProfileVersionId: profileVersionId, recordRevision: tgt.recordRevision + 1, updatedAt: now, updatedBy: actor };
    const sources = srcs.map(s => ({ ...plain(s), lifecycleStatus: LifecycleStatus.MERGED, mergedIntoCustomerId: tgt.id, recordRevision: s.recordRevision + 1, updatedAt: now, updatedBy: actor }));
    const tgtPrimary = new Set((world.contacts || []).filter(c => c.customerId === tgt.id && c.isPrimary).map(c => c.type));
    const contacts = (world.contacts || []).map(c => srcIds.has(c.customerId) ? { ...plain(c), customerId: tgt.id, mergedFromCustomerId: c.customerId, isPrimary: c.isPrimary && !tgtPrimary.has(c.type), updatedAt: now } : c);
    const seenA = new Set((world.assignments || []).filter(a => a.customerId === tgt.id && a.status === 'ACTIVE').map(a => a.assigneeType + a.assigneeId + a.role));
    const assignments = (world.assignments || []).map(a => {
      if (!srcIds.has(a.customerId)) return a;
      const k = a.assigneeType + a.assigneeId + a.role, active = a.status === 'ACTIVE';
      const end = active && (seenA.has(k) || (a.role === 'OWNER' && [...seenA].some(x => x.endsWith('OWNER')))); // one active OWNER: the target's (or the first) stays
      if (active && !end) seenA.add(k);
      return { ...plain(a), customerId: tgt.id, mergedFromCustomerId: a.customerId, ...(end ? { status: 'ENDED', endedAt: now, reasonCode: 'MERGED_DUPLICATE' } : {}) };
    });
    const favorites = (world.favorites || []).map(f => f.contextType === 'CUSTOMER' && srcIds.has(f.contextRef) ? { ...plain(f), contextRef: tgt.id, originalContextRef: f.contextRef } : f);
    const aliases = [...(world.aliases || []).map(a => srcIds.has(a.canonicalCustomerId) ? { ...plain(a), canonicalCustomerId: tgt.id } : a),
      ...srcs.map(s => ({ aliasCustomerId: s.id, canonicalCustomerId: tgt.id, organizationId: tgt.organizationId, reason: 'MERGED', createdAt: now }))];
    const record = { id: newId('cmr', opts), organizationId: tgt.organizationId, sourceCustomerIds: srcs.map(s => s.id), targetCustomerId: tgt.id, fieldDecisions: plain(dec), performedBy: actor, performedAt: now, reasonCode: cmd.reasonCode, idempotencyKey: cmd.idempotencyKey || null,
      preserved: { contactPoints: contacts.filter(c => c.mergedFromCustomerId && srcIds.has(c.mergedFromCustomerId)).length, assignments: assignments.filter(a => a.mergedFromCustomerId && srcIds.has(a.mergedFromCustomerId)).length, favorites: favorites.filter(f => f.originalContextRef && srcIds.has(f.originalContextRef)).length, externalRefs: refs.length },
      profileVersionsRetained: srcs.map(s => s.currentPreferenceProfileVersionId).filter(Boolean) };
    return deepFreeze({ ok: true, target, sources, contacts, assignments, favorites, aliases, record,
      events: [event('CustomerMerged', { organizationId: tgt.organizationId, customerId: tgt.id, sourceCustomerIds: record.sourceCustomerIds, mergeRecordId: record.id, reasonCode: cmd.reasonCode }, opts)] });
  }

  // ------------------------------------------------------------------ projections / read models
  const objectiveLabel = o => o ? (cfgRoot().objectiveLabels || {})[o] || null : null;
  /** project(bundle, mode, decision) — bundle = { customer, details, contacts, assignments, privacy, profileVersion, favoriteCount, ownerDisplayName }.
      The mode is capped by decision.accessLevel; NONE → null. */
  function project(b = {}, mode = 'SUMMARY', decision) {
    const c = b.customer; if (!c || !decision || !decision.allowed) return null;
    const rank = { NONE: 0, SUMMARY: 1, STANDARD: 2, FULL: 3 }, need = { SUMMARY: 1, CLIENT_SAFE: 1, TECHNICAL: 1, STANDARD: 2, FULL: 3 };
    let m = ProjectionMode[mode] ? mode : 'SUMMARY', downgraded = false;
    if (rank[decision.accessLevel] < need[m]) { m = decision.accessLevel === 'STANDARD' ? 'STANDARD' : 'SUMMARY'; downgraded = true; }
    const v = b.profileVersion, comp = v ? completeness(v) : null;
    const summary = { customerId: c.id, displayName: c.displayName, lifecycleStatus: c.lifecycleStatus, ownerDisplayName: b.ownerDisplayName || undefined,
      profileCompleteness: comp ? comp.ratio : undefined, objectiveLabel: v ? objectiveLabel(v.objective) || undefined : undefined, activeFavoriteCount: b.favoriteCount != null ? b.favoriteCount : undefined, updatedAt: c.updatedAt };
    const out = { mode: m, downgraded };
    if (m === 'SUMMARY') return deepFreeze({ ...out, summary });
    if (m === 'CLIENT_SAFE') { const d = b.details || {}; return deepFreeze({ mode: m, downgraded, displayName: d.preferredName || d.firstName || String(c.displayName).split(' ')[0], objectiveLabel: summary.objectiveLabel }); }
    if (m === 'TECHNICAL') return deepFreeze({ ...out, customerId: c.id, organizationId: c.organizationId, type: c.type, lifecycleStatus: c.lifecycleStatus, recordRevision: c.recordRevision, currentPreferenceProfileVersionId: c.currentPreferenceProfileVersionId || null,
      externalRefs: (c.externalRefs || []).map(r => ({ provider: r.provider, externalId: r.externalId, authorityMode: r.authorityMode, syncStatus: r.syncStatus })), contactPointIds: (b.contacts || []).map(x => x.id), assignmentIds: (b.assignments || []).map(a => a.id) });
    const full = m === 'FULL' && decision.canReadContacts;
    const contactPoints = (b.contacts || []).filter(x => x.lifecycleStatus !== 'REVOKED').map(x => ({ id: x.id, type: x.type, label: x.label, isPrimary: x.isPrimary, verificationStatus: x.verificationStatus, lifecycleStatus: x.lifecycleStatus,
      value: full ? x.value : maskContact(x), normalizedValue: full ? x.normalizedValue : undefined, masked: !full }));
    const res = { ...out, summary, contactPoints, assignments: (b.assignments || []).filter(a => a.status === 'ACTIVE').map(a => ({ id: a.id, assigneeType: a.assigneeType, assigneeId: a.assigneeId, role: a.role, assignedAt: a.assignedAt })),
      preferenceProfile: v ? { versionId: v.id, version: v.version, objective: v.objective || null, objectiveLabel: objectiveLabel(v.objective), preferences: v.preferences.map(p => ({ key: p.key, importance: p.importance, source: p.source, active: p.active, target: p.target })),
        hardConstraints: v.hardConstraints.map(x => ({ key: x.key, value: x.value })), budgetDataState: v.budgetProfile ? v.budgetProfile.dataState : 'UNKNOWN', completeness: comp } : null,
      actions: [] };
    if (full && b.privacy) res.privacyProjection = { dataClassification: b.privacy.dataClassification, retentionPolicyRef: b.privacy.retentionPolicyRef || null, marketingCommunicationAllowed: b.privacy.marketingCommunicationAllowed ?? null };
    return deepFreeze(res);
  }
  // DTOs (API contract shapes): list = summary only
  const toSummaryDto = (b, decision) => { const p = project(b, 'SUMMARY', decision); return p ? p.summary : null; };
  const toDetailDto = (b, decision, mode = 'STANDARD') => project(b, mode, decision);

  // ------------------------------------------------------------------ search (summaries only; visibility first; no PII in logs)
  /** search(world, query, { decide, can }) → { ok, results: CustomerSummaryReadModel[], logSafe } */
  function search(world = {}, query = {}, opts = {}) {
    const can = opts.can || (() => false), decide = opts.decide || (() => ({ allowed: false })), kind = query.phone ? 'PHONE' : query.email ? 'EMAIL' : query.externalId ? 'EXTERNAL_REF' : 'NAME';
    const logSafe = Object.freeze({ kind, length: String(query.text || query.phone || query.email || query.externalId || '').length });
    if ((kind === 'PHONE' || kind === 'EMAIL') && !can('customer.contact.read')) return Object.freeze({ ok: false, code: Errors.CONTACT_SEARCH_NOT_ALLOWED, message: MESSAGES.CONTACT_SEARCH_NOT_ALLOWED, results: [], logSafe });
    let match;
    if (kind === 'PHONE') { const n = normalizePhone(query.phone).normalizedValue; const ids = new Set((world.contacts || []).filter(c => n && (c.type === 'PHONE' || c.type === 'WHATSAPP') && c.normalizedValue === n).map(c => c.customerId)); match = c => ids.has(c.id); }
    else if (kind === 'EMAIL') { const n = (normalizeEmail(query.email).normalizedValue || '').toLowerCase(); const ids = new Set((world.contacts || []).filter(c => n && c.type === 'EMAIL' && (c.normalizedValue || '').toLowerCase() === n).map(c => c.customerId)); match = c => ids.has(c.id); }
    else if (kind === 'EXTERNAL_REF') match = c => (c.externalRefs || []).some(r => r.externalId === String(query.externalId) && (!query.provider || r.provider === query.provider));
    else { const q = normText(query.text); match = c => !!q && normText(c.displayName).includes(q); }
    const results = [];
    for (const c of world.customers || []) {
      if (c.lifecycleStatus === 'MERGED' || c.lifecycleStatus === 'DELETED' || (c.lifecycleStatus === 'ARCHIVED' && !query.includeArchived)) continue;
      const d = decide(c); if (!d || !d.allowed) continue; // invisible customers never appear (not even as a count)
      if (!match(c)) continue;
      results.push(project({ customer: c, ...(opts.bundleOf ? opts.bundleOf(c) : {}) }, 'SUMMARY', d).summary);
    }
    results.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
    return Object.freeze({ ok: true, results: Object.freeze(results.slice(0, query.limit || 50)), logSafe });
  }

  // ------------------------------------------------------------------ ingestion (idempotent; normalize → duplicate check → match/create)
  /** ingest(observation, world, opts) → { action: MATCHED | CREATED | REPLAY, customerId, created?, duplicateCandidates, events } */
  function ingest(obs = {}, world = {}, opts = {}) {
    const org = opts.organizationId, key = obs.sourceSystem && obs.sourceRecordId ? obs.sourceSystem + ':' + obs.sourceRecordId : null;
    if (key && world.ingestionKeys && world.ingestionKeys.has(key)) return Object.freeze({ ok: true, action: 'REPLAY', customerId: world.ingestionKeys.get(key), duplicateCandidates: [], events: [] });
    if (key) { const hit = (world.customers || []).find(c => c.organizationId === org && (c.externalRefs || []).some(r => r.provider === obs.sourceSystem && r.externalId === String(obs.sourceRecordId)));
      if (hit) return Object.freeze({ ok: true, action: 'MATCHED', matchedBy: 'SAME_EXTERNAL_REF', customerId: resolveAlias(world.aliases, hit.id), duplicateCandidates: [], events: [], ingestionKey: key }); }
    const contacts = [...(obs.phone ? [{ type: obs.channel === 'WHATSAPP' ? 'WHATSAPP' : 'PHONE', value: obs.phone }] : []), ...(obs.email ? [{ type: 'EMAIL', value: obs.email }] : [])];
    const r = createCustomer({ displayName: obs.displayName || 'Contato sem nome', contacts }, { ...opts, existing: { customers: world.customers || [], contacts: world.contacts || [] } });
    if (!r.ok) return r;
    let cust = r.customer, evs = [...r.events], ref = null;
    if (key) { const l = linkExternalRef(cust, { provider: obs.sourceSystem, externalId: obs.sourceRecordId, authorityMode: opts.authorityMode || 'REFERENCE_ONLY' }, opts); if (l.ok) { cust = l.customer; ref = l.ref; evs = evs.concat(l.events); } }
    const cands = detectDuplicates({ customers: [cust, ...(world.customers || [])], contacts: [...r.contactPoints, ...(world.contacts || [])] }, { organizationId: org, only: cust.id, now: opts.now });
    return deepFreeze({ ok: true, action: 'CREATED', customerId: cust.id, created: { ...plain(r), customer: plain(cust) }, externalRef: ref, duplicateCandidates: cands, ingestionKey: key,
      ignored: obs.preferenceHints != null ? ['PREFERENCE_HINTS_NOT_APPLIED'] : [],
      events: [...evs, ...cands.map(c => event('CustomerDuplicateDetected', { organizationId: org, customerId: cust.id, candidateId: c.id, signals: c.matchSignals.map(s => s.signal) }, opts))] });
  }

  // ------------------------------------------------------------------ anonymization foundation (logical; never a hard delete)
  function anonymize(b = {}, opts = {}) {
    if (!opts.reasonCode) return fail(Errors.REASON_REQUIRED);
    const c = b.customer, now = nowIso(opts.now);
    return deepFreeze({ ok: true, customer: { ...plain(c), displayName: 'Cliente anonimizado', lifecycleStatus: LifecycleStatus.DELETED, recordRevision: c.recordRevision + 1, updatedAt: now, metadata: undefined, anonymizedAt: now },
      details: { customerId: c.id }, contacts: (b.contacts || []).map(x => ({ id: x.id, organizationId: x.organizationId, customerId: x.customerId, type: x.type, value: null, normalizedValue: null, isPrimary: false, verificationStatus: 'UNKNOWN', lifecycleStatus: 'REVOKED', createdAt: x.createdAt, updatedAt: now })),
      retained: ['customerId', 'organizationId', 'profileVersionIds', 'snapshots', 'favorites(lotIds)'], events: [event('CustomerAnonymized', { organizationId: c.organizationId, customerId: c.id, reasonCode: opts.reasonCode }, opts)] });
  }

  return Object.freeze({ CustomerType, LifecycleStatus, ContactPointType, VerificationStatus, ContactLifecycle, NormalizationStatus, CommunicationChannel, ConsentStatus, DataClassification, AssignmentRole, AssignmentStatus, AssigneeType,
    AccessLevel, AuthorityMode, FieldAuthority, SyncStatus, Objective, PreferenceSource, BudgetDataState, DuplicateSignal, DuplicateStatus, ProjectionMode, ContextSource, EventType, Errors, MESSAGES, SCHEMA_VERSION,
    policyOf, newId, looksLikePII, redactPII, logEntry, event, normalizePhone, normalizeEmail, maskContact, matchKeyOf,
    createCustomer, updateCustomer, archive, addContactPoint, setVerification, setCommunicationPreference, consentOf, mayContact, createPrivacyProfile,
    assign, endAssignment, activeAssignmentFor, canFromAuthz, localDeviceCan, decideAccess, linkExternalRef, fieldAuthority, applyExternalChanges,
    createPreferenceProfile, validateProfileInput, completeness, createProfileVersion, fromUiState, toUiState, toFitProfile, toRecommendationConstraints, createSnapshot, resultRefs, favoriteContext, comparisonContext,
    nameSimilarity, detectDuplicates, reviewDuplicate, duplicateWarning, resolveAlias, merge, objectiveLabel, project, toSummaryDto, toDetailDto, search, ingest, anonymize });
})();

/* ---- customer/customerContext.js ---- */
/* customer/customerContext.js — topic 39: ActiveCustomerContext, CustomerContextGuard, deep-link rules, request
   sequencing (a late answer for Maria never overwrites João) and LegacyCustomerMigrationAdapter.

   Compatibility with state/store.js: the store keeps only `currentCustomerId` (an id, never the Customer object) and
   the legacy `customers: [{ id, name, lots, profile }]` list the current overlay uses. Every patch produced here
   touches only keys the app already has; filters (activeFilters), map viewport and current lot are never touched.
   The legacy record ids ('c' + base36 timestamp) are opaque, so they are kept as the canonical Customer ids:
   currentCustomerId keeps working and migration is idempotent by construction. */
App.customer = App.customer || {};
App.customer.context = (() => {
  const D = () => App.customer.domain;
  const nowIso = now => new Date(now == null ? Date.now() : now).toISOString();
  const SOURCES = Object.freeze(['CUSTOMER_LIST', 'SEARCH', 'DEEP_LINK', 'RECOMMENDATION', 'RESTORE']);
  /** keys a customer switch must never change (map-centric: the map, the lot and manual filters stay) */
  const PRESERVED_KEYS = Object.freeze(['mapViewport', 'currentLotId', 'activeFilters', 'activeMapLayer', 'backgroundLayer', 'favorites', 'comparisonLotIds', 'view']);
  /** keys derived from the customer's profile (the panel's "Ajustar prioridades" / "Exigências"), already per customer in app.js */
  const PROFILE_KEYS = Object.freeze(['preferences', 'constraints', 'activePreset', 'objective']);

  const empty = () => Object.freeze({ customerId: null, profileVersionId: undefined, selectedAt: undefined, source: 'RESTORE' });
  /** select(customerId, { source, profileVersionId, now }) → ActiveCustomerContext (session/UI state, not part of Customer) */
  function select(customerId, opts = {}) {
    if (customerId != null && (typeof customerId !== 'string' || D().looksLikePII(customerId))) return empty();
    return Object.freeze({ customerId: customerId || null, profileVersionId: opts.profileVersionId || undefined, selectedAt: customerId ? nowIso(opts.now) : undefined, source: SOURCES.includes(opts.source) ? opts.source : 'CUSTOMER_LIST' });
  }
  const fromStore = st => select(st && st.currentCustomerId || null, { source: 'RESTORE' });
  /** storePatch(ctx) — only the id goes into the global store */
  const storePatch = ctx => ({ currentCustomerId: ctx && ctx.customerId || null });

  /** guard(st, nextCustomerId, { comparison, recommendation, profileDirty, favoritesContextRef }) → CustomerContextGuard result.
      Never blocks map navigation; only reports what the switch affects and the safe options. */
  function guard(st = {}, nextId = null, info = {}) {
    const cur = st.currentCustomerId || null, warnings = [], options = [];
    if (cur === nextId) return Object.freeze({ changed: false, warnings: Object.freeze([]), options: Object.freeze([]) });
    const cmp = info.comparison, cmpCustomer = cmp ? (cmp.context && cmp.context.customerId) || null : (st.comparisonLotIds || []).length ? cur : null;
    if (cmpCustomer && cmpCustomer !== nextId && ((cmp && (cmp.candidateIds || []).length) || (st.comparisonLotIds || []).length)) {
      warnings.push('COMPARISON_BELONGS_TO_PREVIOUS_CUSTOMER');
      options.push({ id: 'KEEP_COMPARISON', label: 'Manter a comparação do cliente anterior' }, { id: 'NEW_COMPARISON', label: 'Criar nova comparação para o próximo cliente' }, { id: 'COPY_CANDIDATES', label: 'Copiar os lotes para o próximo cliente' });
    }
    if (info.recommendation && info.recommendation.customerId && info.recommendation.customerId !== nextId) warnings.push('RECOMMENDATION_OF_PREVIOUS_CUSTOMER');
    else if (st.recScope && cur) warnings.push('RECOMMENDATION_OF_PREVIOUS_CUSTOMER');
    if (info.profileDirty) { warnings.push('UNSAVED_PROFILE_CHANGES'); options.push({ id: 'SAVE_PROFILE', label: 'Salvar o perfil antes de trocar' }, { id: 'DISCARD_PROFILE', label: 'Descartar alterações do perfil' }); }
    if (info.favoritesContextRef && info.favoritesContextRef === cur) warnings.push('FAVORITES_IN_PREVIOUS_CONTEXT');
    return Object.freeze({ changed: true, previousCustomerId: cur, nextCustomerId: nextId, warnings: Object.freeze(warnings), options: Object.freeze(options.map(Object.freeze)), preserves: PRESERVED_KEYS, blocking: false });
  }
  /** switchPatch(st, nextId, { profileUi }) — the store patch of a switch: id + the next customer's own profile; recommendation scope is contextual
      and is dropped; filters/map/lot/comparison/favorites untouched (the comparison keeps its own customer refs). */
  function switchPatch(st = {}, nextId, opts = {}) {
    const p = { currentCustomerId: nextId || null, recScope: null };
    if (opts.profileUi) { p.preferences = { ...(opts.profileUi.preferences || {}) }; p.constraints = { ...(opts.profileUi.constraints || {}) }; p.activePreset = opts.profileUi.activePreset || null; p.objective = opts.profileUi.objective || null; }
    return p;
  }
  /** exitPatch() — "Sair do contexto do cliente": same keys app.js 'custClear' resets; filters stay */
  const exitPatch = () => ({ currentCustomerId: null, preferences: {}, constraints: {}, activePreset: null, objective: null, recScope: null });
  const EXIT_LABEL = 'Sair do contexto do cliente';
  /** logout / tenant switch: active context is cleared and the in-memory repository dropped */
  function clearOnSessionChange(repoStore) { try { if (repoStore && repoStore.clear) repoStore.clear(); } catch (_) { /* ignore */ } return exitPatch(); }

  const firstName = s => String(s || '').trim().split(/\s+/)[0] || '';
  /** header / chip text. Desktop: "Atendendo: Maria Souza"; mobile/tablet chip: "Maria". Never a phone or e-mail. */
  function headerLabel(summary, device = 'desktop', journeyStage = null) {
    if (!summary || !summary.displayName) return null;
    const name = D().looksLikePII(summary.displayName) ? 'Cliente' : summary.displayName;
    const base = device === 'desktop' ? `Atendendo: ${name}` : firstName(name);
    return journeyStage ? `${base} · ${journeyStage}` : base;
  }
  /** contextual labels: Fit is always named with whom it is for */
  const fitLabel = summary => summary && summary.displayName ? `Compatibilidade para ${firstName(summary.displayName)}` : 'Compatibilidade com o perfil';
  const favoriteLabel = summary => summary && summary.displayName ? `Favoritar para ${firstName(summary.displayName)}` : 'Favoritar';
  const useProfileLabel = 'Usar perfil para Encontrar';

  /** deep links: ?customerId=<opaque> only. phone/email/cpf (and any PII-looking value) are rejected. Authorization is re-checked on open. */
  const FORBIDDEN_PARAMS = Object.freeze(['phone', 'telefone', 'email', 'e-mail', 'cpf', 'cnpj', 'rg', 'name', 'nome', 'whatsapp']);
  function parseDeepLink(query) {
    const out = { customerId: null, rejected: [] };
    for (const part of String(query || '').replace(/^[?#]/, '').split('&').filter(Boolean)) {
      const [k, v = ''] = part.split('='); let val; try { val = decodeURIComponent(v); } catch (_) { val = ''; }
      if (FORBIDDEN_PARAMS.includes(k.toLowerCase())) { out.rejected.push(k); continue; }
      if (k === 'customerId') { if (val && /^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/.test(val) && !D().looksLikePII(val)) out.customerId = val; else out.rejected.push(k); }
    }
    return Object.freeze({ ...out, rejected: Object.freeze(out.rejected), requiresAuthorization: !!out.customerId });
  }
  const buildDeepLink = customerId => customerId && !D().looksLikePII(customerId) ? 'customerId=' + encodeURIComponent(customerId) : '';

  /** RequestSequencer: only the latest request's answer may change the context (Maria → João quickly) */
  function sequencer() {
    let last = 0;
    return Object.freeze({ next() { const t = ++last; return Object.freeze({ token: t, isCurrent: () => t === last }); }, accept(ticket, fn) { return ticket && ticket.isCurrent() ? fn() : undefined; } });
  }

  // ------------------------------------------------------------------ LegacyCustomerMigrationAdapter
  /** migrate(legacyCustomers, { organizationId, developmentId, existing: { customerIds, profileChecksums }, now }) →
      { customers, profiles, versions, favorites, report } — idempotent: already-migrated ids are skipped, nothing duplicated. */
  function migrate(legacy = [], opts = {}) {
    const org = opts.organizationId, dev = opts.developmentId || 'viva-juara', dom = D(), existing = new Set((opts.existing && opts.existing.customerIds) || []);
    const report = { recordsDiscovered: 0, customersCreated: 0, alreadyMigrated: 0, profilesMigrated: 0, contactPointsMigrated: 0, externalRefsMigrated: 0, duplicateCandidates: 0, unresolvedIdentities: [],
      unresolvedFavoriteContexts: [], legacyPiiStorageFound: [], dataNotMigrated: [], legacyUiContext: 0 };
    const customers = [], profiles = [], versions = [], favorites = [], seen = new Set();
    for (const [i, r] of (Array.isArray(legacy) ? legacy : []).entries()) {
      report.recordsDiscovered++;
      if (!r || typeof r !== 'object') { report.dataNotMigrated.push({ index: i, reason: 'NOT_AN_OBJECT' }); continue; }
      const id = typeof r.id === 'string' ? r.id : null;
      if (!id || dom.looksLikePII(id) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/.test(id)) { report.unresolvedIdentities.push({ index: i, reason: !id ? 'MISSING_ID' : 'ID_NOT_OPAQUE' }); continue; }
      if (seen.has(id)) { report.unresolvedIdentities.push({ index: i, customerId: id, reason: 'DUPLICATE_ID_IN_LEGACY' }); continue; } seen.add(id);
      if (existing.has(id)) { report.alreadyMigrated++; continue; }
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      if (name) report.legacyPiiStorageFound.push({ customerId: id, field: 'name', storage: 'localStorage ws:<dev>:state.prefs.customers' });
      for (const k of Object.keys(r)) if (!['id', 'name', 'lots', 'profile'].includes(k)) report.dataNotMigrated.push({ customerId: id, field: k, reason: 'UNKNOWN_LEGACY_FIELD' });
      const c = dom.createCustomer({ id, displayName: name || 'Cliente sem nome' }, { organizationId: org, now: opts.now, idGen: opts.idGen, actorId: 'migration' });
      if (!c.ok) { report.unresolvedIdentities.push({ customerId: id, reason: c.code }); continue; }
      let customer = c.customer;
      const p = r.profile && typeof r.profile === 'object' ? r.profile : null;
      if (p && (Object.keys(p.preferences || {}).length || Object.keys(p.constraints || {}).length)) {
        const prof = dom.createPreferenceProfile(customer, { now: opts.now, idGen: opts.idGen });
        const input = dom.fromUiState({ preferences: p.preferences, constraints: p.constraints }, { developmentId: dev });
        const v = dom.createProfileVersion({ profile: prof, input }, { developmentId: dev, now: opts.now, idGen: opts.idGen, actorId: 'migration' });
        if (v.ok) { profiles.push(v.profile); versions.push(v.version); report.profilesMigrated++; customer = dom.updateCustomer(customer, { currentPreferenceProfileVersionId: v.version.id }, { expectedRevision: customer.recordRevision, now: opts.now }).customer; }
        else report.dataNotMigrated.push({ customerId: id, field: 'profile', reason: v.code });
      }
      // the legacy objective/preset are the panel's score lens, not the customer's objective (LIVE/INVEST): kept as UI context, not mapped
      if (p && (p.objective || p.activePreset)) { report.legacyUiContext++; report.dataNotMigrated.push({ customerId: id, field: 'profile.objective/activePreset', reason: 'UI_LENS_NOT_CUSTOMER_OBJECTIVE' }); }
      for (const lotId of Array.isArray(r.lots) ? r.lots : []) {
        if (typeof lotId !== 'string' || (opts.resolveLot && !opts.resolveLot(lotId))) { report.unresolvedFavoriteContexts.push({ customerId: id, lotRef: typeof lotId === 'string' ? lotId : null, reason: 'LOT_NOT_FOUND' }); continue; }
        favorites.push(Object.freeze({ id: 'fav_' + App.methodology.checksum([id, lotId]), contextType: 'CUSTOMER', contextRef: id, lotId, source: 'LEGACY_CUSTOMER_LOTS' }));
      }
      customers.push(customer); report.customersCreated++;
    }
    const dups = dom.detectDuplicates({ customers, contacts: [] }, { organizationId: org, now: opts.now });
    report.duplicateCandidates = dups.length;
    return Object.freeze({ customers: Object.freeze(customers), profiles: Object.freeze(profiles), versions: Object.freeze(versions), favorites: Object.freeze(favorites), duplicateCandidates: dups, report: Object.freeze(report) });
  }
  /** legacyProfileUi(customerRecord) — the legacy record's panel state, for app.js 'custPick' (unchanged behaviour) */
  const legacyProfileUi = c => { const p = (c && c.profile) || {}; return { preferences: { ...(p.preferences || {}) }, constraints: { ...(p.constraints || {}) }, activePreset: p.activePreset || null, objective: p.objective || null }; };

  return Object.freeze({ SOURCES, PRESERVED_KEYS, PROFILE_KEYS, EXIT_LABEL, FORBIDDEN_PARAMS, empty, select, fromStore, storePatch, guard, switchPatch, exitPatch, clearOnSessionChange,
    headerLabel, fitLabel, favoriteLabel, useProfileLabel, parseDeepLink, buildDeepLink, sequencer, migrate, legacyProfileUi });
})();

/* ---- customer/customerRepository.js ---- */
/* customer/customerRepository.js — topic 39: tenant-aware repositories and application services.

   MemoryCustomerStore keeps customer data IN MEMORY ONLY (never localStorage/IndexedDB: Customer data is PII and the
   offline policy defaults to no cache). Logout / tenant switch → clear(). The frontend copy is a convenience, never
   the authority: in server mode the same interfaces are served by ApiCustomerRepository, and the backend re-authorizes
   every call. Every service call checks permissions first (deny by default) and writes a PII-free audit line.

   Repositories: CustomerRepository · CustomerPreferenceProfileRepository · CustomerContactRepository ·
   CustomerAssignmentRepository · CustomerDuplicateRepository · CustomerMergeRepository.
   Services: CustomerApplicationService · CustomerProfileApplicationService · CustomerAssignmentService ·
   CustomerSearchService · CustomerDuplicateService · CustomerMergeService · CustomerIngestionService. */
App.customer = App.customer || {};
App.customer.repo = (() => {
  const D = () => App.customer.domain;
  const conflict = (cur) => Object.freeze({ ok: false, code: 'CUSTOMER_REVISION_CONFLICT', message: D().MESSAGES.CUSTOMER_REVISION_CONFLICT, currentRevision: cur });
  function MemoryCustomerStore() {
    const T = () => ({ customers: new Map(), details: new Map(), contacts: new Map(), assignments: new Map(), comms: new Map(), privacy: new Map(), profiles: new Map(), versions: new Map(),
      snapshots: new Map(), aliases: new Map(), duplicates: new Map(), merges: new Map(), favorites: new Map(), ingestionKeys: new Map() });
    let orgs = new Map();
    const of = org => { if (!org) throw Object.assign(new Error('organizationId obrigatório'), { code: 'MISSING_ORGANIZATION' }); if (!orgs.has(org)) orgs.set(org, T()); return orgs.get(org); };
    return Object.freeze({ of, clear() { orgs = new Map(); }, organizations: () => [...orgs.keys()] });
  }
  const vals = m => [...m.values()];
  const req = ctx => { if (!ctx || !ctx.organizationId) throw Object.assign(new Error('contexto sem organização'), { code: 'MISSING_ORGANIZATION' }); return ctx.organizationId; };

  function CustomerRepository(store) {
    const t = ctx => store.of(req(ctx));
    return Object.freeze({
      async getById(ctx, id) { const r = t(ctx).customers.get(id); return r && r.organizationId === ctx.organizationId ? r : null; },
      async getByIds(ctx, ids) { const m = t(ctx).customers; return (ids || []).map(id => m.get(id)).filter(Boolean); },
      async list(ctx) { return vals(t(ctx).customers); },
      async search(ctx, query, opts = {}) { const x = t(ctx); return D().search({ customers: vals(x.customers), contacts: vals(x.contacts) }, query, opts); },
      async save(ctx, customer, expectedRevision) {
        if (customer.organizationId !== ctx.organizationId) return Object.freeze({ ok: false, code: 'CROSS_TENANT' });
        const m = t(ctx).customers, cur = m.get(customer.id);
        if (cur ? expectedRevision !== cur.recordRevision || customer.recordRevision !== cur.recordRevision + 1 : expectedRevision != null) return conflict(cur ? cur.recordRevision : null);
        m.set(customer.id, customer); return Object.freeze({ ok: true, customer });
      },
      async archive(ctx, id, expectedRevision, opts = {}) { const cur = t(ctx).customers.get(id); if (!cur) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const r = D().archive(cur, { ...opts, expectedRevision }); if (!r.ok) return r; return this.save(ctx, r.customer, expectedRevision); },
      async resolveAlias(ctx, id) { return D().resolveAlias(vals(t(ctx).aliases), id); }
    });
  }
  function CustomerPreferenceProfileRepository(store) {
    const t = ctx => store.of(req(ctx));
    return Object.freeze({
      async getProfile(ctx, customerId) { return vals(t(ctx).profiles).find(p => p.customerId === customerId) || null; },
      async saveProfile(ctx, p) { t(ctx).profiles.set(p.id, p); return p; },
      async getVersion(ctx, id) { return t(ctx).versions.get(id) || null; },
      async listVersions(ctx, customerId) { return vals(t(ctx).versions).filter(v => v.customerId === customerId).sort((a, b) => a.version - b.version); },
      /** append-only: an existing version id can never be overwritten */
      async appendVersion(ctx, v) { const m = t(ctx).versions; if (m.has(v.id)) return Object.freeze({ ok: false, code: 'IMMUTABLE_VERSION' }); m.set(v.id, v); return Object.freeze({ ok: true, version: v }); },
      async saveSnapshot(ctx, s) { t(ctx).snapshots.set(s.id, s); return s; },
      async getSnapshot(ctx, id) { return t(ctx).snapshots.get(id) || null; }
    });
  }
  const simpleRepo = key => store => { const t = ctx => store.of(req(ctx))[key]; return Object.freeze({
    async list(ctx, customerId) { return vals(t(ctx)).filter(x => customerId == null || x.customerId === customerId); },
    async save(ctx, x) { t(ctx).set(x.id, x); return x; },
    async saveAll(ctx, xs) { for (const x of xs) t(ctx).set(x.id, x); return xs; } }); };
  const CustomerContactRepository = simpleRepo('contacts'), CustomerAssignmentRepository = simpleRepo('assignments');
  function CustomerDuplicateRepository(store) { const t = ctx => store.of(req(ctx)).duplicates; return Object.freeze({ async list(ctx) { return vals(t(ctx)); }, async save(ctx, d) { t(ctx).set(d.id, d); return d; } }); }
  function CustomerMergeRepository(store) { const t = ctx => store.of(req(ctx)).merges; return Object.freeze({ async list(ctx) { return vals(t(ctx)); }, async save(ctx, m) { t(ctx).set(m.id, m); return m; } }); }

  /** ApiCustomerRepository — server-mode contract (topic 39 §58). PII never goes in a URL: search is POST with a body. */
  function ApiCustomerRepository({ baseUrl, fetch: f = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
    const url = (ctx, p) => `${baseUrl}/api/v1/organizations/${encodeURIComponent(req(ctx))}${p}`;
    const call = async (u, init = {}) => { const r = await f(u, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } }); if (r.status === 404 || r.status === 403) return null; if (r.status === 409) return conflict(null); return r.ok ? r.json() : null; };
    return Object.freeze({
      getById: (ctx, id) => call(url(ctx, `/customers/${encodeURIComponent(id)}`)),
      search: (ctx, query) => call(url(ctx, '/customers/search'), { method: 'POST', body: JSON.stringify(query) }),
      save: (ctx, c, expectedRevision) => call(url(ctx, `/customers/${encodeURIComponent(c.id)}`), { method: 'PATCH', headers: { 'If-Match': String(expectedRevision) }, body: JSON.stringify({ displayName: c.displayName, expectedRevision }) }),
      archive: (ctx, id, expectedRevision) => call(url(ctx, `/customers/${encodeURIComponent(id)}/archive`), { method: 'POST', body: JSON.stringify({ expectedRevision }) }),
      resolveAlias: async (ctx, id) => { const r = await call(url(ctx, `/customers/${encodeURIComponent(id)}`)); return r && r.customerId ? r.customerId : id; }
    });
  }

  /** services(store, { principal: { userId, organizationId, teamIds }, can, now, idGen }) → application services */
  function services(store, env = {}) {
    const ctx = { organizationId: env.principal && env.principal.organizationId }, can = env.can || (() => false), dom = D();
    const repos = { customers: CustomerRepository(store), profiles: CustomerPreferenceProfileRepository(store), contacts: CustomerContactRepository(store), assignments: CustomerAssignmentRepository(store), duplicates: CustomerDuplicateRepository(store), merges: CustomerMergeRepository(store) };
    const audit = [], O = () => ({ now: env.now ? env.now() : undefined, idGen: env.idGen, actorId: env.principal && env.principal.userId, organizationId: ctx.organizationId });
    const log = (op, data) => { audit.push(dom.logEntry(op, data)); };
    const deny = (op, customerId) => { log(op, { customerId, status: 'DENIED' }); return Object.freeze({ ok: false, code: 'NOT_FOUND', message: dom.MESSAGES.NOT_FOUND }); };
    const allAssignments = async () => repos.assignments.list(ctx);
    async function access(customerId) {
      if (!ctx.organizationId) return { customer: null, decision: dom.decideAccess({}) };
      const id = await repos.customers.resolveAlias(ctx, customerId), c = await repos.customers.getById(ctx, id);
      return { customer: c, decision: dom.decideAccess({ customer: c, principal: env.principal, assignments: await allAssignments(), can }) };
    }
    const world = async () => { const x = store.of(ctx.organizationId); return { customers: vals(x.customers), contacts: vals(x.contacts), assignments: vals(x.assignments), aliases: vals(x.aliases), favorites: vals(x.favorites), mergeRecords: vals(x.merges), ingestionKeys: x.ingestionKeys }; };
    async function persistCreated(r) {
      await repos.customers.save(ctx, r.customer); await repos.contacts.saveAll(ctx, r.contactPoints); await repos.assignments.saveAll(ctx, r.assignments);
      store.of(ctx.organizationId).privacy.set(r.privacyProfile.id, r.privacyProfile); store.of(ctx.organizationId).details.set(r.customer.id, r.details);
    }
    const app = Object.freeze({
      async create(input) {
        if (!ctx.organizationId || !can('customer.create')) return deny('customer.create', null);
        const w = await world(), vis = id => { const c = w.customers.find(x => x.id === id); return !!c && dom.decideAccess({ customer: c, principal: env.principal, assignments: w.assignments, can }).allowed; };
        const r = dom.createCustomer({ ...input, ownerUserId: input.ownerUserId || (env.principal && env.principal.userId) }, { ...O(), existing: { customers: w.customers, contacts: w.contacts }, isVisible: vis });
        if (!r.ok) { log('customer.create', { status: 'REJECTED', codes: [r.code] }); return r; }
        await persistCreated(r); log('customer.create', { customerId: r.customer.id, codes: r.duplicateWarnings.map(x => x.code) });
        return Object.freeze({ ok: true, customerId: r.customer.id, duplicateWarnings: r.duplicateWarnings, events: r.events });
      },
      async get(customerId, mode = 'SUMMARY') {
        const { customer, decision } = await access(customerId); if (!decision.allowed) return deny('customer.read', customerId);
        const x = store.of(ctx.organizationId), v = customer.currentPreferenceProfileVersionId ? x.versions.get(customer.currentPreferenceProfileVersionId) : null;
        const favs = vals(x.favorites).filter(f => f.contextType === 'CUSTOMER' && f.contextRef === customer.id).length;
        return Object.freeze({ ok: true, decision, view: dom.project({ customer, details: x.details.get(customer.id), contacts: await repos.contacts.list(ctx, customer.id), assignments: await repos.assignments.list(ctx, customer.id), privacy: vals(x.privacy).find(p => p.customerId === customer.id), profileVersion: v, favoriteCount: favs }, mode, decision) });
      },
      async rename(customerId, displayName, expectedRevision) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !decision.canWrite) return deny('customer.update', customerId);
        const r = dom.updateCustomer(customer, { displayName }, { ...O(), expectedRevision }); if (!r.ok || r.unchanged) return r;
        const s = await repos.customers.save(ctx, r.customer, expectedRevision); log('customer.update', { customerId, status: s.ok ? 'OK' : s.code }); return s.ok ? r : s;
      },
      async archive(customerId, expectedRevision) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !can('customer.archive')) return deny('customer.archive', customerId);
        const s = await repos.customers.archive(ctx, customer.id, expectedRevision, O()); log('customer.archive', { customerId, status: s.ok ? 'OK' : s.code }); return s;
      },
      async addContact(customerId, input) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !can('customer.contact.update')) return deny('customer.contact.update', customerId);
        const r = dom.addContactPoint(customer, input, O()); if (r.ok) await repos.contacts.save(ctx, r.contact); log('customer.contact.add', { customerId, status: r.ok ? 'OK' : r.code }); return r;
      }
    });
    const profile = Object.freeze({
      async save(customerId, input, opts = {}) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !decision.canWrite || !can('customer.profile.update')) return deny('customer.profile.update', customerId);
        if (opts.expectedRevision != null && opts.expectedRevision !== customer.recordRevision) return conflict(customer.recordRevision);
        const prof = (await repos.profiles.getProfile(ctx, customer.id)) || dom.createPreferenceProfile(customer, O());
        const prev = prof.currentVersionId ? await repos.profiles.getVersion(ctx, prof.currentVersionId) : null;
        const r = dom.createProfileVersion({ profile: prof, previous: prev, input }, { ...O(), developmentId: opts.developmentId });
        if (!r.ok || r.unchanged) return r;
        const a = await repos.profiles.appendVersion(ctx, r.version); if (!a.ok) return a;
        await repos.profiles.saveProfile(ctx, r.profile);
        const u = dom.updateCustomer(customer, { currentPreferenceProfileVersionId: r.version.id }, { ...O(), expectedRevision: customer.recordRevision });
        await repos.customers.save(ctx, u.customer, customer.recordRevision); log('customer.profile.update', { customerId, codes: ['V' + r.version.version] });
        return Object.freeze({ ok: true, version: r.version, warnings: r.warnings, events: r.events });
      },
      async versions(customerId) { const { decision } = await access(customerId); if (!decision.allowed || decision.accessLevel === 'SUMMARY') return []; return repos.profiles.listVersions(ctx, customerId); },
      /** snapshot(customerId, purpose) → { snapshot, fitProfile, constraints, refs } — the exact version used by Fit / Recommendation */
      async snapshot(customerId, purpose = 'FIT', opts = {}) {
        const { customer, decision } = await access(customerId); if (!decision.allowed) return deny('customer.profile.read', customerId);
        const v = customer.currentPreferenceProfileVersionId ? await repos.profiles.getVersion(ctx, customer.currentPreferenceProfileVersionId) : null;
        if (!v) return Object.freeze({ ok: false, code: 'NO_PROFILE' });
        const s = await repos.profiles.saveSnapshot(ctx, dom.createSnapshot(v, customer, purpose, O())), fp = dom.toFitProfile(v, { developmentId: opts.developmentId });
        return Object.freeze({ ok: true, snapshot: s, version: v, fitProfile: fp, constraints: dom.toRecommendationConstraints(v), refs: dom.resultRefs(s, fp) });
      }
    });
    const assignment = Object.freeze({
      async assign(customerId, input) {
        const { customer, decision } = await access(customerId); if (!decision.allowed || !can('customer.assign')) return deny('customer.assign', customerId);
        const r = dom.assign(customer, input, { ...O(), current: await repos.assignments.list(ctx, customer.id) }); if (!r.ok) return r;
        await repos.assignments.saveAll(ctx, [...r.ended, r.assignment]); log('customer.assign', { customerId, codes: [input.role] }); return r;
      }
    });
    const seq = App.customer.context ? App.customer.context.sequencer() : null;
    const searchSvc = Object.freeze({
      /** search(query) — only the latest call resolves with results; older ones resolve { superseded: true } */
      async search(query = {}) {
        const ticket = seq && seq.next(); if (!ctx.organizationId || !(can('customer.read') || can('customer.readAssigned'))) return deny('customer.search', null);
        const asg = await allAssignments();
        const r = await repos.customers.search(ctx, query, { can, decide: c => dom.decideAccess({ customer: c, principal: env.principal, assignments: asg, can }) });
        if (env.delay) await env.delay(query);
        log('customer.search', { status: r.ok ? 'OK' : r.code, codes: [r.logSafe.kind] }); // the query text itself is never logged
        if (ticket && !ticket.isCurrent()) return Object.freeze({ ok: true, superseded: true, results: [] });
        return r;
      }
    });
    const duplicates = Object.freeze({
      async scan() {
        if (!ctx.organizationId || !can('customer.duplicate.review')) return deny('customer.duplicate.scan', null);
        const w = await world(), prior = await repos.duplicates.list(ctx), found = dom.detectDuplicates({ customers: w.customers, contacts: w.contacts }, { ...O(), existing: prior });
        for (const d of found) await repos.duplicates.save(ctx, d); log('customer.duplicate.scan', { codes: ['FOUND_' + found.length] }); return Object.freeze({ ok: true, candidates: found });
      },
      async review(candidateId, status) {
        if (!can('customer.duplicate.review')) return deny('customer.duplicate.review', null);
        const c = (await repos.duplicates.list(ctx)).find(d => d.id === candidateId); if (!c) return Object.freeze({ ok: false, code: 'NOT_FOUND' });
        const r = dom.reviewDuplicate(c, status, O()); if (r.ok) await repos.duplicates.save(ctx, r.candidate); return r;
      }
    });
    const mergeSvc = Object.freeze({
      async merge(cmd) {
        if (!ctx.organizationId || !can('customer.merge')) return deny('customer.merge', cmd && cmd.targetCustomerId);
        const w = await world(), r = dom.merge(cmd, w, O()); if (!r.ok || r.replay) { log('customer.merge', { customerId: cmd.targetCustomerId, status: r.ok ? 'REPLAY' : r.code }); return r; }
        const x = store.of(ctx.organizationId);
        for (const c of [r.target, ...r.sources]) x.customers.set(c.id, c);
        for (const c of r.contacts) x.contacts.set(c.id, c); for (const a of r.assignments) x.assignments.set(a.id, a); for (const f of r.favorites) x.favorites.set(f.id, f);
        x.aliases = new Map(r.aliases.map(a => [a.aliasCustomerId, a])); await repos.merges.save(ctx, r.record);
        for (const d of vals(x.duplicates)) if ([d.customerIdA, d.customerIdB].every(id => id === r.target.id || r.record.sourceCustomerIds.includes(id))) x.duplicates.set(d.id, { ...d, status: 'MERGED' });
        log('customer.merge', { customerId: r.target.id, codes: [cmd.reasonCode] }); return r;
      }
    });
    const ingestion = Object.freeze({
      async ingest(obs) {
        if (!ctx.organizationId || !can('customer.create')) return deny('customer.ingest', null);
        const x = store.of(ctx.organizationId), r = dom.ingest(obs, await world(), O()); if (!r.ok || r.action === 'REPLAY') return r;
        if (r.action === 'CREATED') { await persistCreated({ ...r.created, customer: r.created.customer }); for (const d of r.duplicateCandidates) await repos.duplicates.save(ctx, d); }
        if (r.ingestionKey) x.ingestionKeys.set(r.ingestionKey, r.customerId);
        log('customer.ingest', { customerId: r.customerId, codes: [r.action] }); return r;
      }
    });
    /** favorites in CUSTOMER context (topic 38 contract): contextRef always resolves to the canonical customer */
    const favorites = Object.freeze({
      async add(customerId, lotId) { const { customer, decision } = await access(customerId); if (!decision.allowed) return deny('customer.favorite', customerId); const f = Object.freeze({ id: 'fav_' + App.methodology.checksum([customer.id, lotId]), ...dom.favoriteContext(customer.id), lotId }); store.of(ctx.organizationId).favorites.set(f.id, f); return Object.freeze({ ok: true, favorite: f }); },
      async list(customerId) { const id = await repos.customers.resolveAlias(ctx, customerId); return vals(store.of(ctx.organizationId).favorites).filter(f => f.contextType === 'CUSTOMER' && f.contextRef === id); },
      async resolveContext(contextRef) { return repos.customers.resolveAlias(ctx, contextRef); }
    });
    return Object.freeze({ repos, application: app, profile, assignment, search: searchSvc, duplicates, merge: mergeSvc, ingestion, favorites, audit: () => audit.slice(), access });
  }
  return Object.freeze({ MemoryCustomerStore, CustomerRepository, CustomerPreferenceProfileRepository, CustomerContactRepository, CustomerAssignmentRepository, CustomerDuplicateRepository, CustomerMergeRepository, ApiCustomerRepository, services });
})();

/* ---- journey/journeyDomain.js ---- */
/* journey/journeyDomain.js — topic 40: CustomerJourney, a commercial journey of one Customer for one development/intent.
   Mutable journey snapshot + append-only JourneyEvent log + append-only stage transition history (no event-sourcing framework).
   Stage model definition/versions (published = frozen + checksum) · transition graph · JourneyStageTransition ·
   JourneyEvent + event type registry + ingestion policy · acquisition context (first touch immutable) · touchpoints (no raw
   messages) · next actions (OVERDUE derived) · action/stage suggestions (never auto-applied by default) · attention state ·
   outcome WON/LOST (explicit; loss reason registry) · pause/resume · artifact links (refs only) · timeline projection ·
   corrections · CRM stage mapping / sync conflicts · legacy migration (no fabricated history) · board/query projections ·
   access decision.

   Hard rules: Customer ≠ Journey; Customer lifecycle ≠ stage; clicks/hover never become timeline; nothing is copied from
   Recommendation / Favorite / Comparison / Simulation / Document / Reservation (references only); the journey never
   changes a lot, its availability (all 498 lots are UNKNOWN today), price, score or Fit; it never promises valorização;
   no last-write-wins on stage (expectedRevision); no PII in events, links, board or logs. */
App.journey = App.journey || {};
App.journey.domain = (() => {
  const E = (...xs) => Object.freeze(Object.fromEntries(xs.map(x => [x, x])));
  const JourneyType = E('PURCHASE', 'INVESTMENT', 'HOUSING', 'GENERAL_INTEREST');
  const LifecycleStatus = E('ACTIVE', 'PAUSED', 'CLOSED_WON', 'CLOSED_LOST', 'ARCHIVED');
  const StageCategory = E('NEW', 'ENGAGEMENT', 'QUALIFICATION', 'DISCOVERY', 'RECOMMENDATION', 'SHORTLIST', 'VISIT', 'NEGOTIATION', 'PROPOSAL', 'RESERVATION', 'WON', 'LOST', 'PAUSED', 'OTHER');
  const ModelStatus = E('DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED');
  const ActorType = E('USER', 'SYSTEM', 'INTEGRATION', 'CUSTOMER');
  const EventSource = E('MANUAL', 'DOMAIN_EVENT', 'CRM_SYNC', 'WEB_FORM', 'WHATSAPP', 'EMAIL', 'PHONE', 'IMPORT', 'SYSTEM', 'INTEGRATION');
  const Visibility = E('INTERNAL', 'ASSIGNED_TEAM', 'CLIENT_SAFE', 'TECHNICAL');
  const TouchpointType = E('CONTACT_ATTEMPT', 'CONVERSATION', 'MEETING', 'VISIT', 'FOLLOW_UP', 'OTHER');
  const Channel = E('WHATSAPP', 'PHONE', 'EMAIL', 'IN_PERSON', 'VIDEO', 'WEB', 'CRM', 'OTHER');
  const Direction = E('INBOUND', 'OUTBOUND', 'MUTUAL');
  const NextActionStatus = E('OPEN', 'COMPLETED', 'CANCELLED');
  const NextActionReadState = E('OPEN', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'CANCELLED');
  const AttentionState = E('ON_TRACK', 'ACTION_DUE', 'OVERDUE', 'WAITING_CUSTOMER', 'WAITING_INTERNAL', 'PAUSED', 'CLOSED', 'UNKNOWN');
  const OutcomeType = E('WON', 'LOST');
  const ResourceType = E('FAVORITE_COLLECTION', 'COMPARISON_SESSION', 'RECOMMENDATION_RESULT', 'FINANCIAL_SIMULATION', 'DOCUMENT', 'PROPOSAL', 'RESERVATION', 'LOT', 'PRESENTATION', 'CUSTOMER_PROFILE_VERSION', 'OTHER');
  const SuggestionStatus = E('PENDING', 'ACCEPTED', 'DISMISSED', 'EXPIRED');
  const ProjectionMode = E('SUMMARY', 'BROKER', 'MANAGER', 'CLIENT_SAFE', 'TECHNICAL');
  const Sort = E('RECENT_ACTIVITY', 'OLDEST_ACTIVITY', 'NEXT_ACTION_DUE', 'CUSTOMER_NAME', 'STAGE_ORDER', 'CREATED_AT');
  const Errors = E('MISSING_ORGANIZATION', 'MISSING_CUSTOMER', 'INVALID_TYPE', 'ACTIVE_JOURNEY_EXISTS', 'NO_STAGE_MODEL', 'STAGE_MODEL_NOT_PUBLISHED', 'STAGE_MODEL_IMMUTABLE', 'STAGE_MODEL_MISMATCH', 'INVALID_STAGE_MODEL',
    'JOURNEY_REVISION_CONFLICT', 'JOURNEY_NOT_ACTIVE', 'JOURNEY_NOT_PAUSED', 'NO_GRANT', 'UNKNOWN_STAGE', 'SAME_STAGE', 'TRANSITION_NOT_ALLOWED', 'REASON_REQUIRED', 'INVALID_REASON', 'OUTCOME_REQUIRED',
    'UNKNOWN_EVENT_TYPE', 'SOURCE_NOT_ALLOWED', 'CUSTOMER_ACTOR_UNPROVEN', 'PAYLOAD_MISSING_FIELD', 'PAYLOAD_KEY_NOT_ALLOWED', 'RAW_CONTENT_NOT_ALLOWED', 'VISIBILITY_NOT_ALLOWED', 'OCCURRED_AT_IN_FUTURE', 'INVALID_DATE',
    'CONTAINS_CONTACT_DATA', 'INVALID_CHANNEL', 'INVALID_DIRECTION', 'INVALID_OUTCOME_CODE', 'INVALID_ACTION_TYPE', 'ACTION_NOT_OPEN', 'INVALID_RESOURCE', 'NOT_FOUND', 'CROSS_TENANT', 'OFFLINE_NOT_ALLOWED', 'EVENT_NOT_FOUND');
  const MESSAGES = Object.freeze({
    JOURNEY_REVISION_CONFLICT: 'A jornada foi alterada por outra pessoa. Recarregue antes de mudar a etapa.', TRANSITION_NOT_ALLOWED: 'Esta mudança de etapa não é permitida pelo modelo da jornada.',
    REASON_REQUIRED: 'Informe o motivo desta mudança.', OUTCOME_REQUIRED: 'Encerrar a jornada exige registrar o resultado (ganho ou perda).', ACTIVE_JOURNEY_EXISTS: 'Já existe uma jornada ativa deste cliente neste empreendimento.',
    JOURNEY_NOT_ACTIVE: 'A jornada não está ativa.', OFFLINE_NOT_ALLOWED: 'Esta ação exige conexão com o servidor.', NO_GRANT: 'Você não possui permissão para esta ação.', SELECTION_REQUIRED: 'Este cliente tem mais de uma jornada ativa: escolha qual usar.'
  });
  const RAW_KEYS = /^(message|messages|body|text|transcript|transcription|recording|audio|content|html|filename|fileName|file|blob|attachment|matrix|result|values|lots|lotData|price|prices|availability|status)$/;
  const cfg = () => (App.configs && App.configs.journey && App.configs.journey.policy) || {};
  const checksum = v => App.methodology.checksum(v);
  const ms = t => t == null ? Date.now() : typeof t === 'number' ? t : new Date(t).getTime();
  const iso = t => new Date(ms(t)).toISOString();
  const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  const plain = o => o === undefined ? undefined : JSON.parse(JSON.stringify(o));
  const fail = (code, extra = {}) => Object.freeze({ ok: false, code, message: MESSAGES[code] || code, ...extra });
  const piiLike = s => App.customer && App.customer.domain ? App.customer.domain.looksLikePII(s) : /[^\s@]+@[^\s@]+\.[^\s@]+|\d{8,}/.test(String(s).replace(/[\s().+\-/]/g, ''));
  let seq = 0;
  const newId = (prefix, opts = {}) => opts.idGen ? opts.idGen(prefix) : (App.customer && App.customer.domain ? App.customer.domain.newId(prefix) : `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}`);
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;

  // ------------------------------------------------------------------ registries (configurable, never hardcoded in the UI)
  let regCache = null;
  function registry() {
    const c = cfg(); if (regCache && regCache.src === c) return regCache;
    regCache = { src: c, events: new Map((c.eventTypes || []).map(e => [e.code, Object.freeze(e)])), ingestion: new Map((c.ingestionPolicies || []).map(p => [p.sourceEventType, Object.freeze(p)])),
      loss: new Set((c.lossReasons || []).map(r => r.code)), sources: new Set(c.sources || []), outcomes: new Set(c.touchpointOutcomes || []), actions: new Set(c.nextActionTypes || []),
      pause: new Set(c.pauseReasons || []), override: new Set(c.overrideReasons || []) };
    return regCache;
  }
  const eventType = code => registry().events.get(code) || null;
  const lossReasons = () => [...registry().loss].map(code => Object.freeze({ code, label: (cfg().lossReasonLabels || {})[code] || code }));
  const sources = () => [...registry().sources].map(code => Object.freeze({ code, label: (cfg().sourceLabels || {})[code] || code }));
  const automationPolicy = () => Object.freeze({ allowAutoStageTransition: false, trustedEventTypes: [], allowedTransitionIds: [], ...(cfg().automationPolicy || {}) });
  const offlinePolicy = () => Object.freeze({ allowSummaryCache: false, allowTimelineCache: false, allowNextActionCache: false, allowOfflineTouchpointQueue: false, allowOfflineStageTransition: false, ...(cfg().offlinePolicy || {}) });
  /** online-only operations (stage transition / outcome) under the offline policy */
  function requireOnline(op, connectivity) {
    const p = offlinePolicy(), online = connectivity === 'ONLINE';
    if (online) return null;
    if ((op === 'transition' || op === 'outcome') && !p.allowOfflineStageTransition) return fail(Errors.OFFLINE_NOT_ALLOWED);
    if (op === 'touchpoint' && !p.allowOfflineTouchpointQueue) return fail(Errors.OFFLINE_NOT_ALLOWED);
    return null;
  }

  // ------------------------------------------------------------------ stage models
  /** stageModels(orgId) → [{ definition, versions }] from config */
  const modelsOf = orgId => (cfg().stageModels || []).filter(m => m.definition.organizationId === orgId);
  /** currentModel(orgId) → the published JourneyStageModelVersion in use (frozen) or null */
  function currentModel(orgId) {
    const defId = ((cfg().organizations || {})[orgId] || {}).stageModelDefinitionId, m = modelsOf(orgId).find(x => x.definition.id === defId) || modelsOf(orgId)[0];
    if (!m) return null; const pubs = m.versions.filter(v => v.lifecycleStatus === 'PUBLISHED').sort((a, b) => b.version - a.version);
    return pubs[0] ? sealed(pubs[0]) : null;
  }
  const sealCache = new WeakMap();
  function sealed(v) { if (sealCache.has(v)) return sealCache.get(v); const s = deepFreeze({ ...plain(v), checksum: v.checksum || modelChecksum(v) }); sealCache.set(v, s); return s; }
  const modelChecksum = v => checksum({ stages: v.stages, transitions: v.transitions, entryStageId: v.entryStageId, wonStageIds: v.wonStageIds, lostStageIds: v.lostStageIds });
  function modelVersionById(orgId, id) { for (const m of modelsOf(orgId)) { const v = m.versions.find(x => x.id === id); if (v) return sealed(v); } return null; }
  const stageOf = (model, ref) => model && (model.stages.find(s => s.id === ref) || model.stages.find(s => s.code === ref)) || null;
  /** validateStageModel(version) → errors[] */
  function validateStageModel(v) {
    const errs = [], E2 = (code, m) => errs.push({ code, message: m }), ids = new Set();
    for (const s of v.stages || []) { if (ids.has(s.id)) E2('DUPLICATE_STAGE', s.id); ids.add(s.id); if (!StageCategory[s.category]) E2('INVALID_CATEGORY', s.id); }
    if (!ids.has(v.entryStageId)) E2('MISSING_ENTRY_STAGE', v.entryStageId);
    for (const id of [...(v.wonStageIds || []), ...(v.lostStageIds || [])]) { const s = (v.stages || []).find(x => x.id === id); if (!s || !s.terminal) E2('TERMINAL_STAGE_INVALID', id); }
    const tids = new Set();
    for (const t of v.transitions || []) {
      if (tids.has(t.id)) E2('DUPLICATE_TRANSITION', t.id); tids.add(t.id);
      if (!ids.has(t.fromStageId) || !ids.has(t.toStageId)) E2('TRANSITION_UNKNOWN_STAGE', t.id);
      const from = (v.stages || []).find(s => s.id === t.fromStageId); if (from && from.terminal) E2('TRANSITION_FROM_TERMINAL', t.id);
    }
    return errs;
  }
  /** draftFrom(published) → a new DRAFT version (the published one is never edited) */
  function draftFrom(published, opts = {}) { const d = plain(published); return { ...d, id: opts.id || newId('jsmv', opts), version: published.version + 1, lifecycleStatus: 'DRAFT', publishedAt: undefined, checksum: undefined, createdAt: iso(opts.now) }; }
  function editDraft(version, patch) { if (version.lifecycleStatus === 'PUBLISHED' || Object.isFrozen(version)) return fail(Errors.STAGE_MODEL_IMMUTABLE); return Object.freeze({ ok: true, version: { ...version, ...patch } }); }
  /** publish(draft) → frozen PUBLISHED version with checksum (validation first) */
  function publish(draft, opts = {}) {
    if (draft.lifecycleStatus === 'PUBLISHED') return fail(Errors.STAGE_MODEL_IMMUTABLE);
    const errors = validateStageModel(draft); if (errors.length) return fail(Errors.INVALID_STAGE_MODEL, { errors });
    return deepFreeze({ ok: true, version: { ...plain(draft), lifecycleStatus: 'PUBLISHED', publishedAt: iso(opts.now), checksum: modelChecksum(draft) } });
  }
  /** impactReport(oldV, newV, journeys) — before publishing a new model */
  function impactReport(oldV, newV, journeys = []) {
    const oc = new Map(oldV.stages.map(s => [s.code, s])), nc = new Map(newV.stages.map(s => [s.code, s]));
    const key = (v, t) => { const s = id => stageOf(v, id).code; return s(t.fromStageId) + '>' + s(t.toStageId) + (t.requireReason ? '!' : ''); };
    const ot = new Set(oldV.transitions.map(t => key(oldV, t))), nt = new Set(newV.transitions.map(t => key(newV, t)));
    const removed = [...oc.keys()].filter(c => !nc.has(c));
    const onModel = journeys.filter(j => j.stageModelVersionId === oldV.id && (j.lifecycleStatus === 'ACTIVE' || j.lifecycleStatus === 'PAUSED'));
    return deepFreeze({ stagesAdded: [...nc.keys()].filter(c => !oc.has(c)), stagesRemoved: removed, transitionsAdded: [...nt].filter(x => !ot.has(x)), transitionsRemoved: [...ot].filter(x => !nt.has(x)),
      terminalSemanticsChanged: [...oc.keys()].filter(c => nc.has(c) && (oc.get(c).terminal !== nc.get(c).terminal || oc.get(c).category !== nc.get(c).category)),
      journeysNeedingMigration: onModel.length, unmappableStages: removed.filter(c => onModel.some(j => stageOf(oldV, j.currentStageId).code === c)), autoMigration: false });
  }
  /** migrationPlan(oldV, newV, explicitMap { oldCode: newCode }) — same code maps by default; everything else needs review */
  function migrationPlan(oldV, newV, explicit = {}) {
    const mappings = [], unmapped = [];
    for (const s of oldV.stages) { const to = stageOf(newV, explicit[s.code] || s.code); if (to) mappings.push({ fromStageId: s.id, toStageId: to.id, fromCode: s.code, toCode: to.code, explicit: !!explicit[s.code] }); else unmapped.push(s.code); }
    return deepFreeze({ fromVersionId: oldV.id, toVersionId: newV.id, mappings, unmapped, requiresReview: true, approved: false });
  }
  /** applyMigrationPlan(journey, plan, { approvedBy }) → journey on the new model with a corrective transition (never silent) */
  function applyMigrationPlan(journey, plan, opts = {}) {
    if (!plan.approved && !opts.approvedBy) return fail('PLAN_NOT_APPROVED');
    if (journey.stageModelVersionId !== plan.fromVersionId) return fail(Errors.STAGE_MODEL_MISMATCH);
    const m = plan.mappings.find(x => x.fromStageId === journey.currentStageId); if (!m) return fail('UNMAPPED_STAGE');
    const now = iso(opts.now), rev = journey.recordRevision + 1;
    const t = { id: newId('jst', opts), organizationId: journey.organizationId, journeyId: journey.id, fromStageId: journey.currentStageId, toStageId: m.toStageId, stageModelVersionId: plan.toVersionId, reasonCode: 'STAGE_MODEL_MIGRATION', actorType: 'SYSTEM', actorRef: opts.approvedBy || null, occurredAt: now, recordRevisionAfter: rev };
    return deepFreeze({ ok: true, journey: { ...plain(journey), currentStageId: m.toStageId, stageModelVersionId: plan.toVersionId, recordRevision: rev, updatedAt: now }, transition: t });
  }

  // ------------------------------------------------------------------ journey aggregate
  const isOpen = j => j.lifecycleStatus === 'ACTIVE' || j.lifecycleStatus === 'PAUSED';
  /** createJourney(input, { organizationId, model, existing, actorId, now, can }) → { journey, transition, events } */
  function createJourney(input = {}, opts = {}) {
    const org = opts.organizationId || input.organizationId, can = opts.can || (() => false);
    if (!org) return fail(Errors.MISSING_ORGANIZATION);
    if (!input.customerId || !ID_RE.test(input.customerId)) return fail(Errors.MISSING_CUSTOMER);
    if (!can('journey.create')) return fail(Errors.NO_GRANT);
    const type = input.journeyType || 'PURCHASE'; if (!JourneyType[type]) return fail(Errors.INVALID_TYPE);
    const model = opts.model || currentModel(org); if (!model) return fail(Errors.NO_STAGE_MODEL); if (model.lifecycleStatus !== 'PUBLISHED') return fail(Errors.STAGE_MODEL_NOT_PUBLISHED);
    const u = Object.assign({ maxActivePerKey: 1 }, cfg().uniquenessPolicy || {}, opts.uniquenessPolicy || {});
    const same = (opts.existing || []).filter(j => j.organizationId === org && j.customerId === input.customerId && (j.developmentId || null) === (input.developmentId || null) && j.journeyType === type && isOpen(j));
    if (u.maxActivePerKey != null && same.length >= u.maxActivePerKey) return fail(Errors.ACTIVE_JOURNEY_EXISTS, { journeyIds: same.map(j => j.id) });
    const now = iso(opts.now), actor = opts.actorId || null, id = input.id || newId('jny', opts);
    const journey = { id, organizationId: org, customerId: input.customerId, developmentId: input.developmentId || undefined, productRef: input.productRef || undefined, journeyType: type, lifecycleStatus: 'ACTIVE',
      currentStageId: model.entryStageId, stageModelVersionId: model.id, ownerAssignmentRef: undefined, acquisitionContextId: undefined, currentNextActionId: undefined, currentOutcomeId: undefined,
      createdAt: now, updatedAt: now, startedAt: now, createdBy: actor, recordRevision: 1 };
    const transition = { id: newId('jst', opts), organizationId: org, journeyId: id, fromStageId: undefined, toStageId: model.entryStageId, stageModelVersionId: model.id, reasonCode: 'JOURNEY_CREATED', actorType: actor ? 'USER' : 'SYSTEM', actorRef: actor || undefined, occurredAt: now, recordRevisionAfter: 1 };
    const ev = makeEvent(journey, { type: 'JOURNEY_CREATED', source: 'MANUAL', actorType: actor ? 'USER' : 'SYSTEM', actorRef: actor, payload: { developmentId: input.developmentId || null, journeyType: type }, occurredAt: now, idempotencyKey: 'created:' + id }, opts);
    let assignment;
    if (input.ownerUserId) assignment = { id: newId('jas', opts), organizationId: org, journeyId: id, assigneeType: 'USER', assigneeId: input.ownerUserId, role: 'OWNER', status: 'ACTIVE', assignedAt: now, assignedBy: actor, copiedFromCustomerAssignmentId: input.customerAssignmentId || undefined };
    if (assignment) journey.ownerAssignmentRef = assignment.id;
    return deepFreeze({ ok: true, journey, transition, assignment, events: [ev.event] });
  }
  /** checks shared by every mutation */
  function guardMutation(journey, opts, perm) {
    if (opts.expectedRevision == null || opts.expectedRevision !== journey.recordRevision) return fail(Errors.JOURNEY_REVISION_CONFLICT, { currentRevision: journey.recordRevision });
    if (perm && !(opts.can || (() => false))(perm)) return fail(Errors.NO_GRANT);
    if (opts.connectivity != null) { const off = requireOnline(perm === 'journey.close' ? 'outcome' : perm === 'journey.transition' ? 'transition' : 'other', opts.connectivity); if (off) return off; }
    return null;
  }
  function cleanNote(note) { if (note == null) return { ok: true }; const n = String(note).trim().slice(0, 500); if (piiLike(n)) return fail(Errors.CONTAINS_CONTACT_DATA); return { ok: true, note: n || undefined }; }
  /** transition(journey, { toStageId, reasonCode, note, override }, { model, expectedRevision, can, actorId, viaOutcome, now }) →
      { journey, transition, event } — validate → insert transition → update currentStageId → revision+1 → append event (one unit) */
  function transition(journey, cmd = {}, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.transition'); if (g) return g;
    if (journey.lifecycleStatus !== 'ACTIVE') return fail(Errors.JOURNEY_NOT_ACTIVE);
    const model = opts.model || modelVersionById(journey.organizationId, journey.stageModelVersionId);
    if (!model || model.id !== journey.stageModelVersionId) return fail(Errors.STAGE_MODEL_MISMATCH);
    const to = stageOf(model, cmd.toStageId); if (!to) return fail(Errors.UNKNOWN_STAGE);
    if (to.id === journey.currentStageId) return fail(Errors.SAME_STAGE);
    if (to.terminal && !opts.viaOutcome) return fail(Errors.OUTCOME_REQUIRED);
    const can = opts.can || (() => false), reg = registry();
    let def = model.transitions.find(t => t.fromStageId === journey.currentStageId && t.toStageId === to.id && t.allowed !== false), override = false;
    if (!def) {
      if (!cmd.override) return fail(Errors.TRANSITION_NOT_ALLOWED);
      if (!can('journey.overrideTransition')) return fail(Errors.NO_GRANT);
      if (!cmd.reasonCode || !reg.override.has(cmd.reasonCode)) return fail(cmd.reasonCode ? Errors.INVALID_REASON : Errors.REASON_REQUIRED);
      override = true; def = { id: 'override', requireReason: true };
    }
    if (def.requiredPermission && !can(def.requiredPermission)) return fail(Errors.NO_GRANT);
    if (def.requireReason && !cmd.reasonCode) return fail(Errors.REASON_REQUIRED);
    if (def.requireOutcomeData && !opts.viaOutcome) return fail(Errors.OUTCOME_REQUIRED);
    const n = cleanNote(cmd.note); if (!n.ok) return n;
    const now = iso(opts.now), rev = journey.recordRevision + 1, actorType = opts.actorType || (opts.actorId ? 'USER' : 'SYSTEM');
    const tr = { id: newId('jst', opts), organizationId: journey.organizationId, journeyId: journey.id, fromStageId: journey.currentStageId, toStageId: to.id, stageModelVersionId: model.id, reasonCode: cmd.reasonCode || undefined, note: n.note,
      actorType, actorRef: opts.actorId || undefined, occurredAt: cmd.occurredAt ? iso(cmd.occurredAt) : now, sourceEventId: cmd.sourceEventId || undefined, recordRevisionAfter: rev, override: override || undefined };
    const next = { ...plain(journey), currentStageId: to.id, recordRevision: rev, updatedAt: now, updatedBy: opts.actorId || undefined };
    const ev = makeEvent(next, { type: 'STAGE_CHANGED', source: actorType === 'INTEGRATION' ? 'CRM_SYNC' : 'MANUAL', actorType, actorRef: opts.actorId, occurredAt: tr.occurredAt, subjectRef: { resourceType: 'STAGE_TRANSITION', resourceId: tr.id },
      payload: { fromStageId: tr.fromStageId, toStageId: tr.toStageId, transitionId: def.id, ...(cmd.reasonCode ? { reasonCode: cmd.reasonCode } : {}), ...(override ? { override: true } : {}) }, idempotencyKey: cmd.idempotencyKey || 'transition:' + tr.id }, opts);
    if (!ev.ok) return ev;
    return deepFreeze({ ok: true, journey: next, transition: tr, event: ev.event, audit: override ? { action: 'JourneyStageOverride', journeyId: journey.id, reasonCode: cmd.reasonCode } : { action: 'JourneyStageTransitioned', journeyId: journey.id } });
  }
  /** pause / resume: the stage is preserved; no new journey */
  function pause(journey, cmd = {}, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.pause'); if (g) return g;
    if (journey.lifecycleStatus !== 'ACTIVE') return fail(Errors.JOURNEY_NOT_ACTIVE);
    if (!cmd.reasonCode || !registry().pause.has(cmd.reasonCode)) return fail(cmd.reasonCode ? Errors.INVALID_REASON : Errors.REASON_REQUIRED);
    const now = iso(opts.now), rec = { id: newId('jpr', opts), journeyId: journey.id, reasonCode: cmd.reasonCode, pausedAt: now, pausedBy: opts.actorId || null, expectedResumeAt: cmd.expectedResumeAt ? iso(cmd.expectedResumeAt) : undefined };
    const next = { ...plain(journey), lifecycleStatus: 'PAUSED', pausedAt: now, recordRevision: journey.recordRevision + 1, updatedAt: now };
    const ev = makeEvent(next, { type: 'JOURNEY_PAUSED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, occurredAt: now, payload: { pauseRecordId: rec.id, reasonCode: cmd.reasonCode, ...(rec.expectedResumeAt ? { expectedResumeAt: rec.expectedResumeAt } : {}) }, idempotencyKey: 'pause:' + rec.id }, opts);
    return deepFreeze({ ok: true, journey: next, pauseRecord: rec, event: ev.event });
  }
  function resume(journey, pauseRecord, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.pause'); if (g) return g;
    if (journey.lifecycleStatus !== 'PAUSED') return fail(Errors.JOURNEY_NOT_PAUSED);
    const now = iso(opts.now), rec = { ...plain(pauseRecord), resumedAt: now, resumedBy: opts.actorId || null };
    const next = { ...plain(journey), lifecycleStatus: 'ACTIVE', pausedAt: undefined, recordRevision: journey.recordRevision + 1, updatedAt: now };
    const ev = makeEvent(next, { type: 'JOURNEY_RESUMED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, occurredAt: now, payload: { pauseRecordId: rec.id }, idempotencyKey: 'resume:' + rec.id + ':' + now }, opts);
    return deepFreeze({ ok: true, journey: next, pauseRecord: rec, event: ev.event });
  }
  /** closeOutcome(journey, { type: WON|LOST, reasonCode, relatedResourceRefs, note, override }, opts) — explicit only; the journey references the
      authoritative commercial resource (reservation/sale) and never changes it, nor the lot's availability */
  function closeOutcome(journey, cmd = {}, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.close'); if (g) return g;
    if (journey.lifecycleStatus !== 'ACTIVE') return fail(Errors.JOURNEY_NOT_ACTIVE);
    if (!OutcomeType[cmd.type]) return fail(Errors.INVALID_TYPE);
    if (!opts.actorId) return fail('EXPLICIT_ACTOR_REQUIRED'); // no automatic WON/LOST
    if (cmd.type === 'LOST' && (!cmd.reasonCode || !registry().loss.has(cmd.reasonCode))) return fail(cmd.reasonCode ? Errors.INVALID_REASON : Errors.REASON_REQUIRED);
    const refs = []; for (const r of cmd.relatedResourceRefs || []) { if (!r || !ResourceType[r.resourceType] || !ID_RE.test(String(r.resourceId || ''))) return fail(Errors.INVALID_RESOURCE); refs.push({ resourceType: r.resourceType, resourceId: String(r.resourceId), versionRef: r.versionRef || undefined }); }
    const model = opts.model || modelVersionById(journey.organizationId, journey.stageModelVersionId); if (!model) return fail(Errors.STAGE_MODEL_MISMATCH);
    const toStageId = (cmd.type === 'WON' ? model.wonStageIds : model.lostStageIds)[0];
    const t = transition(journey, { toStageId, reasonCode: cmd.reasonCode || (cmd.type === 'WON' ? 'WON' : undefined), note: cmd.note, override: cmd.override }, { ...opts, viaOutcome: true, connectivity: undefined });
    if (!t.ok) return t;
    const now = iso(opts.now), outcome = { id: newId('jout', opts), organizationId: journey.organizationId, journeyId: journey.id, type: cmd.type, reasonCode: cmd.reasonCode || 'WON', closedAt: now, actorUserId: opts.actorId, relatedResourceRefs: refs, note: t.transition.note };
    const next = { ...plain(t.journey), lifecycleStatus: cmd.type === 'WON' ? 'CLOSED_WON' : 'CLOSED_LOST', closedAt: now, currentOutcomeId: outcome.id };
    const ev = makeEvent(next, { type: cmd.type === 'WON' ? 'JOURNEY_WON' : 'JOURNEY_LOST', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, occurredAt: now, subjectRef: refs[0],
      payload: cmd.type === 'WON' ? { outcomeId: outcome.id, ...(refs.length ? { relatedResourceRefs: refs } : {}) } : { outcomeId: outcome.id, reasonCode: cmd.reasonCode }, idempotencyKey: 'outcome:' + outcome.id }, opts);
    return deepFreeze({ ok: true, journey: next, transition: t.transition, outcome, events: [t.event, ev.event], audit: { action: cmd.type === 'WON' ? 'JourneyClosedWon' : 'JourneyClosedLost', journeyId: journey.id } });
  }
  function archive(journey, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.update'); if (g) return g;
    const now = iso(opts.now); return deepFreeze({ ok: true, journey: { ...plain(journey), lifecycleStatus: 'ARCHIVED', recordRevision: journey.recordRevision + 1, updatedAt: now } });
  }

  // ------------------------------------------------------------------ events (append-only)
  /** makeEvent(journey, input, opts) → { ok, event } — registry-typed, minimal payload, INTERNAL by default */
  function makeEvent(journey, input = {}, opts = {}) {
    const def = eventType(input.type); if (!def) return fail(Errors.UNKNOWN_EVENT_TYPE);
    const source = input.source || 'MANUAL'; if (!EventSource[source]) return fail(Errors.SOURCE_NOT_ALLOWED);
    const allowedSrc = new Set([...(def.allowedSources || []), 'SYSTEM']); if (!allowedSrc.has(source) && !(source === 'IMPORT' && def.code === 'MIGRATED_TO_STAGE')) return fail(Errors.SOURCE_NOT_ALLOWED);
    const actorType = input.actorType || 'USER'; if (!ActorType[actorType]) return fail(Errors.SOURCE_NOT_ALLOWED);
    if (actorType === 'CUSTOMER' && !input.customerActionProven) return fail(Errors.CUSTOMER_ACTOR_UNPROVEN);
    const payload = {}, p = input.payload || {}, allowed = new Set([...(def.payload.required || []), ...(def.payload.allowed || [])]);
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) continue;
      if (RAW_KEYS.test(k) && !allowed.has(k)) return fail(Errors.RAW_CONTENT_NOT_ALLOWED, { key: k });
      if (!allowed.has(k)) return fail(Errors.PAYLOAD_KEY_NOT_ALLOWED, { key: k });
      if (typeof v === 'string' && piiLike(v) && !/Id$|Ids$|At$|For$/.test(k) && !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(v)) return fail(Errors.CONTAINS_CONTACT_DATA, { key: k });
      payload[k] = plain(v);
    }
    for (const k of def.payload.required || []) if (payload[k] == null) return fail(Errors.PAYLOAD_MISSING_FIELD, { key: k });
    const vis = input.visibility || 'INTERNAL'; if (!Visibility[vis]) return fail(Errors.VISIBILITY_NOT_ALLOWED);
    if (vis === 'CLIENT_SAFE' && !def.clientVisible) return fail(Errors.VISIBILITY_NOT_ALLOWED);
    const now = ms(opts.now), occ = input.occurredAt != null ? ms(input.occurredAt) : now;
    if (!Number.isFinite(occ)) return fail(Errors.INVALID_DATE);
    if (occ > now + 5 * 60 * 1000) return fail(Errors.OCCURRED_AT_IN_FUTURE);
    if (input.subjectRef && (!input.subjectRef.resourceType || !ID_RE.test(String(input.subjectRef.resourceId || '')))) return fail(Errors.INVALID_RESOURCE);
    return deepFreeze({ ok: true, event: { id: newId('jev', opts), organizationId: journey.organizationId, journeyId: journey.id, customerId: journey.customerId, type: def.code, category: def.category,
      occurredAt: iso(occ), recordedAt: iso(now), actorType, actorRef: input.actorRef || undefined, source, subjectRef: input.subjectRef ? { resourceType: input.subjectRef.resourceType, resourceId: String(input.subjectRef.resourceId), versionRef: input.subjectRef.versionRef || undefined } : undefined,
      summaryCode: def.code, payload, visibility: vis, idempotencyKey: input.idempotencyKey || undefined, correlationId: input.correlationId || undefined } });
  }
  /** appendEvent(log, event) → { ok, log, duplicate } — idempotent by idempotencyKey; never mutates existing events */
  function appendEvent(log = [], ev) {
    if (ev.idempotencyKey && log.some(e => e.journeyId === ev.journeyId && e.idempotencyKey === ev.idempotencyKey)) return Object.freeze({ ok: true, duplicate: true, log });
    return Object.freeze({ ok: true, duplicate: false, log: Object.freeze([...log, ev]) });
  }
  /** correctEvent(log, originalEventId, { correctedSummaryCode, correctedPayload, reasonCode }, opts) — original preserved for audit */
  function correctEvent(log, originalId, cmd = {}, opts = {}) {
    const orig = (log || []).find(e => e.id === originalId); if (!orig) return fail(Errors.EVENT_NOT_FOUND);
    if (!cmd.reasonCode) return fail(Errors.REASON_REQUIRED);
    if (cmd.correctedPayload) { const t = makeEvent({ organizationId: orig.organizationId, id: orig.journeyId, customerId: orig.customerId }, { type: cmd.correctedSummaryCode || orig.type, source: orig.source, actorType: orig.actorType === 'CUSTOMER' ? 'USER' : orig.actorType, payload: cmd.correctedPayload, occurredAt: orig.occurredAt }, opts); if (!t.ok) return t; }
    const correction = { id: newId('jcor', opts), originalEventId: originalId, correctedSummaryCode: cmd.correctedSummaryCode || undefined, correctedPayload: cmd.correctedPayload ? plain(cmd.correctedPayload) : undefined, reasonCode: cmd.reasonCode, correctedBy: opts.actorId || null, correctedAt: iso(opts.now) };
    const ev = makeEvent({ organizationId: orig.organizationId, id: orig.journeyId, customerId: orig.customerId }, { type: 'EVENT_CORRECTED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, payload: { originalEventId: originalId, correctionId: correction.id, reasonCode: cmd.reasonCode }, idempotencyKey: 'correction:' + correction.id }, opts);
    return deepFreeze({ ok: true, correction, event: ev.event });
  }

  // ------------------------------------------------------------------ ingestion (domain events → timeline, by policy)
  /** resolveActiveJourney(journeys, { organizationId, customerId, developmentId }) → ActiveJourneyContext resolution */
  function resolveActiveJourney(journeys = [], q = {}) {
    const c = journeys.filter(j => j.organizationId === q.organizationId && j.customerId === q.customerId && (q.developmentId == null || j.developmentId === q.developmentId) && j.lifecycleStatus === 'ACTIVE' && (!q.journeyType || j.journeyType === q.journeyType));
    if (c.length === 1) return Object.freeze({ status: 'RESOLVED', journeyId: c[0].id, customerId: q.customerId, developmentId: c[0].developmentId, candidates: Object.freeze([c[0].id]) });
    return Object.freeze({ status: c.length ? 'SELECTION_REQUIRED' : 'NONE', journeyId: null, customerId: q.customerId || null, developmentId: q.developmentId, candidates: Object.freeze(c.map(j => j.id)), message: c.length ? MESSAGES.SELECTION_REQUIRED : undefined });
  }
  /** ingest(domainEvent, { journeys, log, now }) → { action: IGNORED|UNRESOLVED|DUPLICATE|COALESCED|APPENDED, reason, event, stageSuggestion, actionSuggestion }
      domainEvent = { id, type, organizationId, customerId, developmentId, journeyId?, contextType?, occurredAt, actorUserId?, payload, subjectRef? } */
  function ingest(de = {}, world = {}, opts = {}) {
    const R = (action, reason, extra = {}) => Object.freeze({ ok: true, action, reason, ...extra });
    const pol = registry().ingestion.get(de.type);
    if (!pol) return R('IGNORED', 'NO_INGESTION_POLICY');
    if (!pol.eligible) return R('IGNORED', pol.reason || 'NOT_ELIGIBLE');
    const cond = pol.condition || {};
    if (cond.contextType && de.contextType !== cond.contextType) return R('IGNORED', 'NOT_CUSTOMER_CONTEXT'); // e.g. a broker's personal favorite
    if (cond.requiresCustomer && !de.customerId && !de.journeyId) return R('IGNORED', 'NO_CUSTOMER_CONTEXT');
    if (cond.requiresExplicitPresentation && !(de.payload && de.payload.presentationConfirmed === true)) return R('IGNORED', 'PRESENTATION_NOT_CONFIRMED'); // generated ≠ presented
    const journeys = world.journeys || [];
    let journey = null;
    if (de.journeyId) { journey = journeys.find(j => j.id === de.journeyId) || null; if (!journey) return R('UNRESOLVED', 'JOURNEY_NOT_FOUND'); }
    else if (pol.journeyResolutionStrategy === 'EXPLICIT') return R('UNRESOLVED', 'EXPLICIT_JOURNEY_REQUIRED');
    else { const r = resolveActiveJourney(journeys, { organizationId: de.organizationId, customerId: de.customerId, developmentId: de.developmentId }); if (r.status !== 'RESOLVED') return R('UNRESOLVED', r.status === 'NONE' ? 'NO_ACTIVE_JOURNEY' : 'AMBIGUOUS_JOURNEY', { candidates: r.candidates }); journey = journeys.find(j => j.id === r.journeyId); }
    if (journey.organizationId !== de.organizationId) return R('IGNORED', 'CROSS_TENANT');
    if (de.customerId && journey.customerId !== de.customerId) return R('IGNORED', 'CUSTOMER_MISMATCH');
    const log = world.log || [], key = de.type + ':' + de.id, def = eventType(pol.eventType);
    if (log.some(e => e.journeyId === journey.id && e.idempotencyKey === key)) return R('DUPLICATE', 'ALREADY_INGESTED', { journeyId: journey.id });
    const subj = de.subjectRef || null;
    if (pol.deduplicationPolicy === 'COALESCE_BY_SUBJECT') {
      const win = (pol.coalesceWindowMinutes || 60) * 60000, at = ms(de.occurredAt || opts.now);
      const prev = log.filter(e => e.journeyId === journey.id && (e.type === pol.eventType || e.type === 'COMPARISON_CREATED') && e.subjectRef && subj && e.subjectRef.resourceId === subj.resourceId);
      if (prev.some(e => Math.abs(at - ms(e.occurredAt)) <= win)) return R('COALESCED', 'SAME_SUBJECT_WITHIN_WINDOW', { journeyId: journey.id });
    }
    const allowed = new Set([...(def.payload.required || []), ...(def.payload.allowed || [])]), payload = {};
    for (const [k, v] of Object.entries(de.payload || {})) if (allowed.has(k)) payload[k] = v; // minimization: only what the registry allows
    const source = de.type === 'CrmSyncCompleted' ? 'CRM_SYNC' : 'DOMAIN_EVENT';
    const m = makeEvent(journey, { type: pol.eventType, source, actorType: de.actorUserId ? 'USER' : 'SYSTEM', actorRef: de.actorUserId, occurredAt: de.occurredAt, subjectRef: subj || undefined, payload, idempotencyKey: key, correlationId: de.correlationId }, opts);
    if (!m.ok) return Object.freeze({ ok: false, action: 'REJECTED', reason: m.code, code: m.code });
    const sugg = suggestionsFor(journey, m.event, world.model || modelVersionById(journey.organizationId, journey.stageModelVersionId), opts);
    return Object.freeze({ ok: true, action: 'APPENDED', journeyId: journey.id, event: m.event, ...sugg });
  }
  /** stage / next-action suggestions for an event (PENDING; automation is off by default) */
  function suggestionsFor(journey, ev, model, opts = {}) {
    const def = eventType(ev.type), out = { stageSuggestion: null, actionSuggestion: null, autoTransitionEligible: false };
    if (def && def.stageSuggestion && model) {
      const to = stageOf(model, def.stageSuggestion), cur = stageOf(model, journey.currentStageId);
      if (to && cur && to.order > cur.order && !to.terminal) {
        const tr = model.transitions.find(t => t.fromStageId === cur.id && t.toStageId === to.id);
        out.stageSuggestion = deepFreeze({ id: newId('jss', opts), journeyId: journey.id, suggestedStageId: to.id, reasonCode: 'EVENT_' + ev.type, sourceEventId: ev.id, status: 'PENDING', createdAt: iso(opts.now), transitionId: tr ? tr.id : null });
        const ap = automationPolicy(); out.autoTransitionEligible = !!(ap.allowAutoStageTransition && tr && ap.trustedEventTypes.includes(ev.type) && ap.allowedTransitionIds.includes(tr.id));
      }
    }
    if (def && def.actionSuggestion && registry().actions.has(def.actionSuggestion.type)) out.actionSuggestion = deepFreeze({ id: newId('jas', opts), journeyId: journey.id, type: def.actionSuggestion.type, reasonCode: def.actionSuggestion.reasonCode || 'EVENT_' + ev.type,
      suggestedDueAt: def.actionSuggestion.inHours != null ? iso(ms(ev.occurredAt) + def.actionSuggestion.inHours * 3600000) : undefined, sourceEventId: ev.id, status: 'PENDING' });
    return out;
  }
  const decideSuggestion = (s, status, opts = {}) => ['ACCEPTED', 'DISMISSED', 'EXPIRED'].includes(status) ? deepFreeze({ ...plain(s), status, decidedAt: iso(opts.now), decidedBy: opts.actorId || null }) : fail('INVALID_STATUS');

  // ------------------------------------------------------------------ touchpoints, acquisition, artifact links
  /** recordTouchpoint(journey, input, opts) → { touchpoint, event? } — no raw conversation, summary ≤ 280 chars without contact data */
  function recordTouchpoint(journey, input = {}, opts = {}) {
    if (!(opts.can || (() => false))('journey.timeline.record')) return fail(Errors.NO_GRANT);
    for (const k of Object.keys(input)) if (RAW_KEYS.test(k)) return fail(Errors.RAW_CONTENT_NOT_ALLOWED, { key: k });
    if (!TouchpointType[input.type]) return fail(Errors.INVALID_TYPE);
    if (!Channel[input.channel]) return fail(Errors.INVALID_CHANNEL);
    if (!Direction[input.direction]) return fail(Errors.INVALID_DIRECTION);
    if (input.outcomeCode != null && !registry().outcomes.has(input.outcomeCode)) return fail(Errors.INVALID_OUTCOME_CODE);
    const summary = input.summary == null ? undefined : String(input.summary).trim().slice(0, 280);
    if (summary && piiLike(summary)) return fail(Errors.CONTAINS_CONTACT_DATA);
    if (input.externalRef != null && !ID_RE.test(String(input.externalRef))) return fail(Errors.INVALID_RESOURCE);
    const now = ms(opts.now), occ = input.occurredAt != null ? ms(input.occurredAt) : now; if (!Number.isFinite(occ)) return fail(Errors.INVALID_DATE);
    const tp = { id: newId('jtp', opts), organizationId: journey.organizationId, journeyId: journey.id, type: input.type, direction: input.direction, channel: input.channel, occurredAt: iso(occ), actorUserId: opts.actorId || undefined,
      externalRef: input.externalRef || undefined, outcomeCode: input.outcomeCode || undefined, summary, visibility: Visibility[input.visibility] && input.visibility !== 'CLIENT_SAFE' ? input.visibility : 'INTERNAL' };
    const evType = input.type === 'VISIT' ? 'VISIT_COMPLETED' : (input.type === 'CONVERSATION' || input.type === 'MEETING') ? 'CUSTOMER_CONTACTED' : null;
    let event;
    if (evType) {
      const src = input.channel === 'WHATSAPP' ? 'WHATSAPP' : input.channel === 'PHONE' ? 'PHONE' : input.channel === 'EMAIL' ? 'EMAIL' : 'MANUAL';
      const m = makeEvent(journey, { type: evType, source: evType === 'VISIT_COMPLETED' ? 'MANUAL' : src, actorType: 'USER', actorRef: opts.actorId, occurredAt: tp.occurredAt, subjectRef: { resourceType: 'TOUCHPOINT', resourceId: tp.id },
        payload: evType === 'VISIT_COMPLETED' ? { touchpointId: tp.id } : { touchpointId: tp.id, channel: tp.channel, direction: tp.direction, ...(tp.outcomeCode ? { outcomeCode: tp.outcomeCode } : {}) }, idempotencyKey: 'touchpoint:' + tp.id }, opts);
      if (!m.ok) return m; event = m.event;
    }
    return deepFreeze({ ok: true, touchpoint: tp, event, ...(event ? suggestionsFor(journey, event, opts.model || modelVersionById(journey.organizationId, journey.stageModelVersionId), opts) : {}) });
  }
  /** attribution touch: URLs are reduced to path (no query/fragment), referrer to its domain; unknown source → UNKNOWN */
  function normalizeTouch(t = {}) {
    const out = {}; if (t.occurredAt) out.occurredAt = iso(t.occurredAt);
    for (const k of ['source', 'medium', 'campaign', 'channel', 'provider', 'externalCampaignRef', 'externalAdRef']) if (t[k] != null) { const v = String(t[k]).trim().slice(0, 80); if (v && !piiLike(v)) out[k] = v; }
    if (t.landingPageRef) { const s = String(t.landingPageRef).split(/[?#]/)[0]; if (!piiLike(s)) out.landingPageRef = s.slice(0, 200); }
    if (t.referrerDomain || t.referrer) { const m = String(t.referrerDomain || t.referrer).match(/^(?:[a-z]+:\/\/)?([^/?#:]+)/i); if (m) out.referrerDomain = m[1].toLowerCase(); }
    return out;
  }
  function createAcquisition(journey, input = {}, opts = {}) {
    const code = input.primarySourceCode && registry().sources.has(input.primarySourceCode) ? input.primarySourceCode : 'UNKNOWN';
    return deepFreeze({ ok: true, acquisition: { id: newId('jacq', opts), organizationId: journey.organizationId, journeyId: journey.id, firstTouch: normalizeTouch(input.firstTouch), latestTouch: input.latestTouch ? normalizeTouch(input.latestTouch) : undefined,
      primarySourceCode: code, primaryAttributionRule: cfg().primaryAttributionRule || 'FIRST_TOUCH', externalLeadRef: input.externalLeadRef && ID_RE.test(String(input.externalLeadRef)) ? String(input.externalLeadRef) : undefined, capturedAt: iso(opts.now) },
      warnings: input.primarySourceCode && code === 'UNKNOWN' ? ['UNKNOWN_SOURCE_CODE'] : [] });
  }
  /** latest touch evolves; first touch never changes */
  const updateLatestTouch = (acq, touch) => deepFreeze({ ...plain(acq), latestTouch: normalizeTouch(touch) });
  /** linkArtifact(journey, { resourceType, resourceId, relationType, versionRef }, opts) — reference only, never a copy */
  function linkArtifact(journey, input = {}, opts = {}) {
    if (!(opts.can || (() => false))('journey.update')) return fail(Errors.NO_GRANT);
    for (const k of Object.keys(input)) if (!['resourceType', 'resourceId', 'relationType', 'versionRef'].includes(k)) return fail(Errors.RAW_CONTENT_NOT_ALLOWED, { key: k });
    if (!ResourceType[input.resourceType] || !ID_RE.test(String(input.resourceId || ''))) return fail(Errors.INVALID_RESOURCE);
    const ex = (opts.existing || []).find(l => l.journeyId === journey.id && l.resourceType === input.resourceType && l.resourceId === String(input.resourceId) && l.relationType === (input.relationType || 'RELATED'));
    if (ex) return Object.freeze({ ok: true, duplicate: true, link: ex });
    const link = { id: newId('jlk', opts), organizationId: journey.organizationId, journeyId: journey.id, resourceType: input.resourceType, resourceId: String(input.resourceId), versionRef: input.versionRef || undefined, relationType: input.relationType || 'RELATED', linkedAt: iso(opts.now), linkedBy: opts.actorId || undefined };
    const m = makeEvent(journey, { type: 'ARTIFACT_LINKED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, subjectRef: { resourceType: link.resourceType, resourceId: link.resourceId, versionRef: link.versionRef }, payload: { linkId: link.id, resourceType: link.resourceType, relationType: link.relationType }, idempotencyKey: 'link:' + link.id }, opts);
    return deepFreeze({ ok: true, link, event: m.event });
  }
  /** "Registrar como opção apresentada" (QuickView) — explicit broker action; opening the QuickView alone records nothing */
  function recordOptionPresented(journey, { lotId, recommendationResultId } = {}, opts = {}) {
    if (!(opts.can || (() => false))('journey.timeline.record')) return fail(Errors.NO_GRANT);
    return makeEvent(journey, { type: 'OPTION_PRESENTED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, subjectRef: { resourceType: 'LOT', resourceId: lotId }, payload: { lotId, ...(recommendationResultId ? { recommendationResultId } : {}) }, idempotencyKey: opts.idempotencyKey }, opts);
  }

  // ------------------------------------------------------------------ next actions and attention
  function createNextAction(journey, input = {}, opts = {}) {
    const g = guardMutation(journey, opts, 'journey.nextAction.manage'); if (g) return g;
    if (!isOpen(journey)) return fail(Errors.JOURNEY_NOT_ACTIVE);
    if (!registry().actions.has(input.type)) return fail(Errors.INVALID_ACTION_TYPE);
    const title = String(input.title || '').trim().slice(0, 120) || actionLabel(input.type); if (piiLike(title)) return fail(Errors.CONTAINS_CONTACT_DATA);
    const d = cleanNote(input.description); if (!d.ok) return d;
    if (input.dueAt != null && !Number.isFinite(ms(input.dueAt))) return fail(Errors.INVALID_DATE);
    const now = iso(opts.now), a = { id: newId('jna', opts), organizationId: journey.organizationId, journeyId: journey.id, type: input.type, title, description: d.note, dueAt: input.dueAt != null ? iso(input.dueAt) : undefined,
      assigneeUserId: input.assigneeUserId || opts.actorId || undefined, status: 'OPEN', priority: ['LOW', 'NORMAL', 'HIGH'].includes(input.priority) ? input.priority : 'NORMAL', createdAt: now, createdBy: opts.actorId || null, recordRevision: 1, fromSuggestionId: input.fromSuggestionId || undefined };
    const primary = input.primary !== false, next = primary ? { ...plain(journey), currentNextActionId: a.id, recordRevision: journey.recordRevision + 1, updatedAt: now } : journey;
    const m = makeEvent(journey, { type: 'FOLLOW_UP_CREATED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, subjectRef: { resourceType: 'NEXT_ACTION', resourceId: a.id }, payload: { nextActionId: a.id, type: a.type, ...(a.dueAt ? { dueAt: a.dueAt } : {}) }, idempotencyKey: 'na:' + a.id }, opts);
    return deepFreeze({ ok: true, journey: next, nextAction: a, event: m.event });
  }
  function finishNextAction(journey, action, status, opts = {}) {
    if (!(opts.can || (() => false))('journey.nextAction.manage')) return fail(Errors.NO_GRANT);
    if (opts.expectedRevision !== action.recordRevision) return fail(Errors.JOURNEY_REVISION_CONFLICT, { currentRevision: action.recordRevision });
    if (action.status !== 'OPEN') return fail(Errors.ACTION_NOT_OPEN);
    const now = iso(opts.now), a = { ...plain(action), status, completedAt: now, completedBy: opts.actorId || null, completionReasonCode: opts.reasonCode || undefined, recordRevision: action.recordRevision + 1 };
    const m = makeEvent(journey, { type: status === 'COMPLETED' ? 'FOLLOW_UP_COMPLETED' : 'FOLLOW_UP_CANCELLED', source: 'MANUAL', actorType: 'USER', actorRef: opts.actorId, subjectRef: { resourceType: 'NEXT_ACTION', resourceId: a.id }, payload: { nextActionId: a.id, ...(opts.reasonCode ? { completionReasonCode: opts.reasonCode } : {}) }, idempotencyKey: 'na-end:' + a.id }, opts);
    return deepFreeze({ ok: true, nextAction: a, event: m.event });
  }
  const completeNextAction = (j, a, opts) => finishNextAction(j, a, 'COMPLETED', opts);
  const cancelNextAction = (j, a, opts) => finishNextAction(j, a, 'CANCELLED', opts);
  /** acceptSuggestion(journey, suggestion, opts) → creates the action from a PENDING suggestion (explicit) */
  function acceptSuggestion(journey, s, opts = {}) {
    if (s.status !== 'PENDING') return fail('SUGGESTION_NOT_PENDING');
    const r = createNextAction(journey, { type: s.type, dueAt: s.suggestedDueAt, fromSuggestionId: s.id }, opts); if (!r.ok) return r;
    return deepFreeze({ ...plain(r), suggestion: decideSuggestion(s, 'ACCEPTED', opts) });
  }
  const actionLabel = t => ({ CONTACT: 'Fazer contato', FOLLOW_UP: 'Retornar ao cliente', COMPLETE_PROFILE: 'Completar o perfil', PREPARE_RECOMMENDATION: 'Preparar opções', PRESENT_OPTIONS: 'Apresentar opções', SCHEDULE_VISIT: 'Agendar visita',
    FOLLOW_UP_VISIT: 'Retornar após a visita', PREPARE_SIMULATION: 'Preparar simulação', REQUEST_DOCUMENT: 'Solicitar documento', FOLLOW_UP_PROPOSAL: 'Acompanhar proposta', WAIT_CUSTOMER: 'Aguardar o cliente', OTHER: 'Próxima ação' })[t] || 'Próxima ação';
  /** readState(action, now) → OPEN | DUE_SOON | OVERDUE | COMPLETED | CANCELLED (OVERDUE is derived, never stored) */
  function readState(a, now) {
    if (!a) return null; if (a.status !== 'OPEN') return a.status;
    if (!a.dueAt) return 'OPEN'; const left = ms(a.dueAt) - ms(now), soon = (cfg().nextActionDueSoonHours || 24) * 3600000;
    return left < 0 ? 'OVERDUE' : left <= soon ? 'DUE_SOON' : 'OPEN';
  }
  /** activitySummary(events) → { lastMeaningfulEventAt, lastCustomerTouchAt, lastBrokerActionAt } — technical/sync events never count */
  function activitySummary(events = []) {
    const out = { lastMeaningfulEventAt: undefined, lastCustomerTouchAt: undefined, lastBrokerActionAt: undefined }, mx = (k, v) => { if (!out[k] || v > out[k]) out[k] = v; };
    for (const e of events) { const d = eventType(e.type); if (!d) continue; if (d.countsAsMeaningfulActivity) mx('lastMeaningfulEventAt', e.occurredAt); if (d.customerTouch) mx('lastCustomerTouchAt', e.occurredAt); if (d.brokerAction && e.actorType === 'USER') mx('lastBrokerActionAt', e.occurredAt); }
    return Object.freeze(out);
  }
  /** aging(journey, activity, nextAction, now, model) → { level: NONE|WARNING|CRITICAL, policy } — stage-specific (no universal "X days") */
  function aging(journey, act, na, now, model) {
    const st = stageOf(model || modelVersionById(journey.organizationId, journey.stageModelVersionId), journey.currentStageId), p = st && (cfg().agingPolicies || []).find(x => x.stageCode === st.code);
    if (!p) return Object.freeze({ level: 'NONE', policy: null });
    const base = p.basedOn === 'LAST_CUSTOMER_TOUCH' ? act.lastCustomerTouchAt : p.basedOn === 'NEXT_ACTION_DUE' ? na && na.status === 'OPEN' && na.dueAt : act.lastMeaningfulEventAt;
    if (!base) return Object.freeze({ level: 'NONE', policy: p, reason: 'NO_BASE_TIMESTAMP' });
    const h = (ms(now) - ms(base)) / 3600000;
    return Object.freeze({ level: p.criticalAfterHours != null && h >= p.criticalAfterHours ? 'CRITICAL' : p.warningAfterHours != null && h >= p.warningAfterHours ? 'WARNING' : 'NONE', policy: p });
  }
  /** attention(journey, { nextAction, events, now, model }) → JourneyAttentionState (operational projection, not lifecycle) */
  function attention(journey, ctx = {}) {
    if (journey.lifecycleStatus === 'PAUSED') return 'PAUSED';
    if (journey.lifecycleStatus !== 'ACTIVE') return 'CLOSED';
    const na = ctx.nextAction && ctx.nextAction.status === 'OPEN' ? ctx.nextAction : null, rs = readState(na, ctx.now);
    let s = !na ? 'UNKNOWN' : rs === 'OVERDUE' ? 'OVERDUE' : rs === 'DUE_SOON' ? 'ACTION_DUE' : na.type === 'WAIT_CUSTOMER' ? 'WAITING_CUSTOMER' : 'ON_TRACK';
    const ag = aging(journey, activitySummary(ctx.events || []), na, ctx.now, ctx.model);
    if (ag.level === 'CRITICAL' && (s === 'ON_TRACK' || s === 'UNKNOWN')) s = 'ACTION_DUE';
    return s;
  }

  // ------------------------------------------------------------------ projections
  const VIS_BY_MODE = Object.freeze({ BROKER: ['INTERNAL', 'ASSIGNED_TEAM', 'CLIENT_SAFE'], MANAGER: ['INTERNAL', 'ASSIGNED_TEAM', 'CLIENT_SAFE'], CLIENT_SAFE: ['CLIENT_SAFE'], TECHNICAL: ['INTERNAL', 'ASSIGNED_TEAM', 'CLIENT_SAFE', 'TECHNICAL'], SUMMARY: [] });
  function eventText(e, model, payload) {
    const d = eventType(e.type), title = d ? d.title : e.type;
    if (e.type === 'STAGE_CHANGED' && model) { const a = stageOf(model, payload.fromStageId), b = stageOf(model, payload.toStageId); return `${title}: ${a ? a.title : '—'} → ${b ? b.title : '—'}`; }
    if (e.type === 'JOURNEY_LOST' && payload.reasonCode) return `${title} (${(cfg().lossReasonLabels || {})[payload.reasonCode] || payload.reasonCode})`;
    if (e.type === 'MIGRATED_TO_STAGE') return `${title} — histórico anterior não disponível`;
    return title;
  }
  /** timeline(journey, { events, corrections, mode, cursor, limit, model }) → JourneyTimelineProjection (ordered by occurredAt; recordedAt only in TECHNICAL) */
  function timeline(journey, o = {}) {
    const mode = ProjectionMode[o.mode] ? o.mode : 'BROKER', vis = VIS_BY_MODE[mode], model = o.model || modelVersionById(journey.organizationId, journey.stageModelVersionId);
    const corr = new Map(); for (const c of o.corrections || []) corr.set(c.originalEventId, c);
    let items = (o.events || []).filter(e => e.journeyId === journey.id && e.organizationId === journey.organizationId && vis.includes(e.visibility));
    if (mode === 'CLIENT_SAFE') items = items.filter(e => (eventType(e.type) || {}).clientVisible);
    if (mode !== 'TECHNICAL') items = items.filter(e => e.type !== 'EVENT_CORRECTED' && e.type !== 'CRM_SYNC_COMPLETED');
    items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.recordedAt.localeCompare(a.recordedAt) || (a.id < b.id ? 1 : -1));
    const start = o.cursor ? Math.max(0, parseInt(String(o.cursor).replace(/^o:/, ''), 10) || 0) : 0, limit = o.limit || 50, page = items.slice(start, start + limit);
    const out = page.map(e => {
      const c = corr.get(e.id), payload = c && c.correctedPayload ? c.correctedPayload : e.payload, type = c && c.correctedSummaryCode ? c.correctedSummaryCode : e.type, d = eventType(type) || {};
      const it = { id: e.id, type, category: d.category || e.category, occurredAt: e.occurredAt, text: eventText({ ...e, type }, model, payload), corrected: !!c };
      if (mode === 'CLIENT_SAFE') return it;
      it.subjectRef = e.subjectRef; it.actorType = e.actorType; it.source = e.source;
      if (mode === 'TECHNICAL') Object.assign(it, { recordedAt: e.recordedAt, visibility: e.visibility, idempotencyKey: e.idempotencyKey, correlationId: e.correlationId, payload: e.payload, correctedPayload: c ? c.correctedPayload : undefined, correctionReason: c ? c.reasonCode : undefined });
      return it;
    });
    return deepFreeze({ journeyId: journey.id, mode, items: out, nextCursor: start + limit < items.length ? 'o:' + (start + limit) : undefined, generatedAt: iso(o.now) });
  }
  /** summary(journey, { model, nextAction, events, acquisition, ownerDisplayName, now }) → JourneySummaryReadModel */
  function summary(journey, o = {}) {
    const model = o.model || modelVersionById(journey.organizationId, journey.stageModelVersionId), st = stageOf(model, journey.currentStageId), act = activitySummary(o.events || []), na = o.nextAction && o.nextAction.status === 'OPEN' ? o.nextAction : null;
    return deepFreeze({ journeyId: journey.id, customerId: journey.customerId, developmentId: journey.developmentId, lifecycleStatus: journey.lifecycleStatus,
      currentStage: st ? { id: st.id, code: st.code, title: st.title, order: st.order, category: st.category } : null,
      nextAction: na ? { id: na.id, type: na.type, title: na.title, dueAt: na.dueAt, readState: readState(na, o.now) } : undefined,
      attentionState: attention(journey, { nextAction: na, events: o.events, now: o.now, model }), lastMeaningfulEventAt: act.lastMeaningfulEventAt, activity: act,
      ownerDisplayName: o.ownerDisplayName || undefined, acquisitionSourceLabel: o.acquisition ? (cfg().sourceLabels || {})[o.acquisition.primarySourceCode] || o.acquisition.primarySourceCode : undefined, updatedAt: journey.updatedAt });
  }
  /** contextChip(customerSummary, journeySummary) → "Maria · Negociação" (map-centric chip; no PII beyond the display name) */
  const contextChip = (cs, js) => cs && cs.displayName ? `${String(cs.displayName).split(/\s+/)[0]}${js && js.currentStage ? ' · ' + js.currentStage.title : ''}` : null;
  /** query(journeys, JourneyQuery, { summaries: Map<journeyId, summary>, customerNames: Map<customerId, name> }) — tenant-scoped filter + sort */
  function query(journeys = [], q = {}, o = {}) {
    if (!q.organizationId) return Object.freeze({ ok: false, code: Errors.MISSING_ORGANIZATION, items: [] });
    const S = o.summaries || new Map(), N = o.customerNames || new Map(), norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let items = journeys.filter(j => j.organizationId === q.organizationId).map(j => ({ j, s: S.get(j.id) || summary(j, { now: o.now }) }));
    const inList = (arr, v) => !arr || !arr.length || arr.includes(v);
    items = items.filter(({ j, s }) => inList(q.developmentIds, j.developmentId) && inList(q.stageIds, j.currentStageId) && inList(q.lifecycleStatuses, j.lifecycleStatus) && inList(q.attentionStates, s.attentionState)
      && (!q.ownerUserIds || !q.ownerUserIds.length || q.ownerUserIds.includes((o.owners || new Map()).get(j.id)))
      && (!q.acquisitionSourceCodes || !q.acquisitionSourceCodes.length || q.acquisitionSourceCodes.includes((o.sources || new Map()).get(j.id) || 'UNKNOWN'))
      && (!q.nextActionDueBefore || (s.nextAction && s.nextAction.dueAt && s.nextAction.dueAt < iso(q.nextActionDueBefore)))
      && (!q.nextActionDueAfter || (s.nextAction && s.nextAction.dueAt && s.nextAction.dueAt > iso(q.nextActionDueAfter)))
      && (!q.customerSearch || norm(N.get(j.customerId)).includes(norm(q.customerSearch))));
    const sort = Sort[q.sort] ? q.sort : 'RECENT_ACTIVITY', key = {
      RECENT_ACTIVITY: (a, b) => String(b.s.lastMeaningfulEventAt || '').localeCompare(String(a.s.lastMeaningfulEventAt || '')), OLDEST_ACTIVITY: (a, b) => String(a.s.lastMeaningfulEventAt || '').localeCompare(String(b.s.lastMeaningfulEventAt || '')),
      NEXT_ACTION_DUE: (a, b) => String((a.s.nextAction || {}).dueAt || '9').localeCompare(String((b.s.nextAction || {}).dueAt || '9')), CUSTOMER_NAME: (a, b) => norm(N.get(a.j.customerId)).localeCompare(norm(N.get(b.j.customerId))),
      STAGE_ORDER: (a, b) => ((a.s.currentStage || {}).order || 0) - ((b.s.currentStage || {}).order || 0), CREATED_AT: (a, b) => String(b.j.createdAt).localeCompare(String(a.j.createdAt)) }[sort];
    items.sort((a, b) => key(a, b) || (a.j.id < b.j.id ? -1 : 1));
    return Object.freeze({ ok: true, sort, items: Object.freeze(items.map(x => x.s)) });
  }
  /** board(summaries, model, { customerNames, owners }) → JourneyBoardReadModel (Kanban is a projection; moving a card calls transition) */
  function board(summaries = [], model, o = {}) {
    const N = o.customerNames || new Map();
    const cols = model.stages.map(st => ({ stageId: st.id, code: st.code, title: st.title, order: st.order, terminal: st.terminal,
      cards: summaries.filter(s => s.currentStage && s.currentStage.id === st.id).map(s => ({ journeyId: s.journeyId, customerDisplayName: N.get(s.customerId) || 'Cliente', stageTitle: st.title, nextAction: s.nextAction ? { title: s.nextAction.title, dueAt: s.nextAction.dueAt, readState: s.nextAction.readState } : null, attentionState: s.attentionState, ownerDisplayName: s.ownerDisplayName || null })) }));
    return deepFreeze({ stageModelVersionId: model.id, stageColumns: cols, generatedAt: iso(o.now) });
  }
  /** allowedMoves(journey, model) → transitions the UI may offer (drag & drop / menu); terminal ones need the outcome form */
  function allowedMoves(journey, model) {
    if (journey.lifecycleStatus !== 'ACTIVE') return [];
    return model.transitions.filter(t => t.fromStageId === journey.currentStageId && t.allowed !== false).map(t => { const s = stageOf(model, t.toStageId); return Object.freeze({ transitionId: t.id, toStageId: s.id, title: s.title, requireReason: !!t.requireReason, requiresOutcome: !!(t.requireOutcomeData || s.terminal), requiredPermission: t.requiredPermission || 'journey.transition' }); }).sort((a, b) => stageOf(model, a.toStageId).order - stageOf(model, b.toStageId).order);
  }

  // ------------------------------------------------------------------ access
  /** decideAccess({ journey, principal, journeyAssignments, customerAssignments, can }) → { allowed, level, reasonCodes, canTransition, canClose, canRecord } */
  function decideAccess({ journey, principal = {}, journeyAssignments = [], customerAssignments = [], can = () => false } = {}) {
    const D = codes => Object.freeze({ allowed: false, level: 'NONE', reasonCodes: Object.freeze(codes), canTransition: false, canClose: false, canRecord: false });
    if (!journey || !principal.organizationId || principal.organizationId !== journey.organizationId) return D(['NOT_FOUND']);
    const mine = a => a.status === 'ACTIVE' && ((a.assigneeType === 'USER' && a.assigneeId === principal.userId) || (a.assigneeType === 'TEAM' && (principal.teamIds || []).includes(a.assigneeId)));
    const assigned = journeyAssignments.some(a => a.journeyId === journey.id && mine(a)) || customerAssignments.some(a => a.customerId === journey.customerId && mine(a) && a.role !== 'VIEWER');
    let level;
    if (can('journey.read')) level = can('journey.technical.read') ? 'TECHNICAL' : 'MANAGER';
    else if (can('journey.readAssigned') && assigned) level = 'BROKER';
    else return D([can('journey.readAssigned') ? 'NOT_ASSIGNED' : 'NO_GRANT']);
    const active = journey.lifecycleStatus === 'ACTIVE', writer = level !== 'BROKER' || assigned;
    return Object.freeze({ allowed: true, level, reasonCodes: Object.freeze(['ALLOWED']), canTransition: active && writer && can('journey.transition'), canClose: active && writer && can('journey.close'), canRecord: writer && isOpen(journey) && can('journey.timeline.record'), canReadTimeline: can('journey.timeline.read') || level !== 'BROKER' || assigned });
  }

  // ------------------------------------------------------------------ external CRM
  /** mapExternalStage(policies, provider, externalStageCode, direction) → { internalStageId } | { conflict: 'UNMAPPED_EXTERNAL_STAGE' } */
  function mapExternalStage(policies = [], provider, code, direction = 'IMPORT') {
    const p = policies.find(x => x.provider === provider && x.externalStageCode === code && (x.direction === direction || x.direction === 'BIDIRECTIONAL'));
    return p ? Object.freeze({ internalStageId: p.internalStageId, conflictMode: p.conflictMode || 'MANUAL_REVIEW' }) : Object.freeze({ conflict: 'UNMAPPED_EXTERNAL_STAGE' });
  }
  /** applyExternalStage(journey, { provider, externalStageCode, externalEventId }, { policies, externalRef, processedKeys, model, can }) →
      { action: DUPLICATE | NO_CHANGE | CONFLICT | TRANSITION, conflict?, transition? } — never a blind bidirectional sync */
  function applyExternalStage(journey, ext = {}, o = {}) {
    const key = ext.provider + ':' + ext.externalEventId; if (o.processedKeys && o.processedKeys.has(key)) return Object.freeze({ ok: true, action: 'DUPLICATE' });
    const C = (field, status, extra = {}) => Object.freeze({ ok: true, action: 'CONFLICT', key, conflict: Object.freeze({ id: newId('jsc', o), organizationId: journey.organizationId, journeyId: journey.id, provider: ext.provider, field, internalValueRef: journey.currentStageId, externalValueRef: ext.externalStageCode, status, detectedAt: iso(o.now), ...extra }) });
    const mode = (o.externalRef || {}).authorityMode || 'REFERENCE_ONLY';
    const m = mapExternalStage(o.policies || cfg().stageMappingPolicies || [], ext.provider, ext.externalStageCode, 'IMPORT');
    if (m.conflict) return C('stage', 'OPEN', { reasonCode: m.conflict });
    if (m.internalStageId === journey.currentStageId) return Object.freeze({ ok: true, action: 'NO_CHANGE', key });
    if (mode === 'REFERENCE_ONLY' || mode === 'INTERNAL_MASTER' || m.conflictMode === 'INTERNAL_WINS') return C('stage', 'IGNORED', { reasonCode: 'INTERNAL_AUTHORITY' });
    if (m.conflictMode === 'MANUAL_REVIEW' || mode === 'HYBRID') return C('stage', 'OPEN', { reasonCode: 'MANUAL_REVIEW' });
    const t = transition(journey, { toStageId: m.internalStageId, reasonCode: 'CRM_SYNC', idempotencyKey: 'crm:' + key }, { ...o, expectedRevision: journey.recordRevision, actorType: 'INTEGRATION', actorId: undefined });
    if (!t.ok) return C('stage', 'OPEN', { reasonCode: t.code });
    return Object.freeze({ ok: true, action: 'TRANSITION', key, ...t });
  }

  // ------------------------------------------------------------------ legacy pipeline migration
  /** inventory(records, { stageField, stageMap }) → LegacyJourneyInventoryItem[] (migrationMappingCertainty, not data confidence) */
  function inventory(records = [], o = {}) {
    const field = o.stageField || 'status', map = o.stageMap || {}, counts = new Map();
    for (const r of records) { const v = r && r[field] != null ? String(r[field]) : null; if (v == null) continue; counts.set(v, (counts.get(v) || 0) + 1); }
    return [...counts].map(([label, n]) => { const p = map[label]; return Object.freeze({ sourceLocation: o.sourceLocation || 'legacy', legacyStageCode: label, legacyLabel: label, occurrenceCount: n, proposedStageId: p ? p.stageId : undefined, migrationMappingCertainty: p ? p.certainty || 'HIGH' : 'LOW', requiresHumanReview: !p || (p.certainty && p.certainty !== 'HIGH') }); });
  }
  /** migrateLegacy(records, { organizationId, model, stageMap, sourceMap, existingIds, now, migrationVersion }) → { journeys, transitions, events, nextActions, outcomes, duplicates, report }
      record: { legacyId, customerId, developmentId, status, source, ownerUserId, nextFollowUpAt, outcome: { type, reasonCode }, createdAt, notes } */
  function migrateLegacy(records = [], o = {}) {
    const model = o.model || currentModel(o.organizationId), map = o.stageMap || {}, smap = o.sourceMap || {}, mv = o.migrationVersion || 'legacy-journey/1', existing = new Set(o.existingIds || []);
    const now = iso(o.now), out = { journeys: [], transitions: [], events: [], nextActions: [], outcomes: [], acquisitions: [], duplicates: [] };
    const rep = { legacyRecordsFound: records.length, journeysCreated: 0, alreadyMigrated: 0, stageMappings: {}, unresolvedStages: [], lossReasonsMapped: 0, sourceMappings: {}, ownersMapped: 0, followUpsMigrated: 0, historyUnavailableCount: 0,
      duplicateActiveJourneyCandidates: 0, outcomeAmbiguities: [], rawNotesExcluded: 0, manualReviewRequired: [], migrationVersion: mv };
    const byKey = new Map();
    for (const r of records) {
      if (!r || !r.legacyId || !r.customerId) { rep.manualReviewRequired.push({ legacyId: r && r.legacyId || null, reason: 'MISSING_IDENTITY' }); continue; }
      const id = 'jny_mig_' + checksum([o.organizationId, r.legacyId]); if (existing.has(id)) { rep.alreadyMigrated++; continue; }
      const m = map[r.status]; const st = m && stageOf(model, m.stageId || m);
      if (!st) { rep.unresolvedStages.push({ legacyId: r.legacyId, legacyStage: r.status == null ? null : String(r.status) }); continue; } // no arbitrary stage
      rep.stageMappings[r.status] = st.code;
      let lifecycle = 'ACTIVE', outcome;
      if (st.terminal || r.outcome) {
        const ot = r.outcome && OutcomeType[r.outcome.type] ? r.outcome.type : null;
        const stageType = model.wonStageIds.includes(st.id) ? 'WON' : model.lostStageIds.includes(st.id) ? 'LOST' : null;
        if (!ot || (stageType && ot !== stageType) || (ot === 'LOST' && !registry().loss.has(r.outcome.reasonCode))) { rep.outcomeAmbiguities.push({ legacyId: r.legacyId, reason: !ot ? 'NO_EXPLICIT_OUTCOME' : 'OUTCOME_INCONSISTENT' }); continue; }
        lifecycle = ot === 'WON' ? 'CLOSED_WON' : 'CLOSED_LOST'; if (ot === 'LOST') rep.lossReasonsMapped++;
        outcome = { id: 'jout_mig_' + checksum([id]), organizationId: o.organizationId, journeyId: id, type: ot, reasonCode: r.outcome.reasonCode || 'WON', closedAt: r.outcome.closedAt || now, actorUserId: 'migration', relatedResourceRefs: [], migrated: true };
      }
      const createdKnown = r.createdAt && Number.isFinite(ms(r.createdAt)), created = createdKnown ? iso(r.createdAt) : now;
      const j = { id, organizationId: o.organizationId, customerId: r.customerId, developmentId: r.developmentId || undefined, journeyType: JourneyType[r.journeyType] ? r.journeyType : 'PURCHASE', lifecycleStatus: lifecycle,
        currentStageId: st.id, stageModelVersionId: model.id, currentOutcomeId: outcome ? outcome.id : undefined, createdAt: created, updatedAt: now, startedAt: created, closedAt: outcome ? outcome.closedAt : undefined, createdBy: 'migration', recordRevision: 1,
        metadata: { migrationVersion: mv, legacyId: r.legacyId, createdAtUnknown: !createdKnown || undefined } };
      const tr = { id: 'jst_mig_' + checksum([id]), organizationId: o.organizationId, journeyId: id, toStageId: st.id, stageModelVersionId: model.id, reasonCode: 'MIGRATED_TO_STAGE', actorType: 'SYSTEM', actorRef: 'migration', occurredAt: now, recordRevisionAfter: 1 };
      const ev = makeEvent(j, { type: 'MIGRATED_TO_STAGE', source: 'IMPORT', actorType: 'SYSTEM', occurredAt: now, payload: { legacyCurrentStage: String(r.status), historyUnavailable: true, migrationVersion: mv }, idempotencyKey: 'migration:' + r.legacyId }, { ...o, now: o.now });
      rep.historyUnavailableCount++;
      const src = r.source != null && smap[r.source] && registry().sources.has(smap[r.source]) ? smap[r.source] : 'UNKNOWN'; rep.sourceMappings[r.source == null ? '(vazio)' : r.source] = src;
      out.acquisitions.push({ id: 'jacq_mig_' + checksum([id]), organizationId: o.organizationId, journeyId: id, firstTouch: {}, primarySourceCode: src, capturedAt: now, migrated: true });
      if (r.ownerUserId) rep.ownersMapped++;
      if (r.nextFollowUpAt && Number.isFinite(ms(r.nextFollowUpAt)) && lifecycle === 'ACTIVE') { const na = { id: 'jna_mig_' + checksum([id]), organizationId: o.organizationId, journeyId: id, type: 'FOLLOW_UP', title: actionLabel('FOLLOW_UP'), dueAt: iso(r.nextFollowUpAt), assigneeUserId: r.ownerUserId || undefined, status: 'OPEN', priority: 'NORMAL', createdAt: now, createdBy: 'migration', recordRevision: 1 }; out.nextActions.push(na); j.currentNextActionId = na.id; rep.followUpsMigrated++; }
      if (r.notes) rep.rawNotesExcluded++;
      out.journeys.push(j); out.transitions.push(tr); if (ev.ok) out.events.push(ev.event); if (outcome) out.outcomes.push(outcome); rep.journeysCreated++;
      if (lifecycle === 'ACTIVE') { const k = [r.customerId, r.developmentId || '', j.journeyType].join('|'); byKey.set(k, [...(byKey.get(k) || []), id]); }
    }
    for (const [k, ids] of byKey) if (ids.length > 1) { const [customerId, developmentId] = k.split('|'); out.duplicates.push(Object.freeze({ customerId, developmentId: developmentId || undefined, journeyIds: ids, reasonCode: 'MULTIPLE_ACTIVE_LEGACY_RECORDS' })); }
    rep.duplicateActiveJourneyCandidates = out.duplicates.length;
    return deepFreeze({ ...out, report: rep });
  }

  return Object.freeze({ JourneyType, LifecycleStatus, StageCategory, ModelStatus, ActorType, EventSource, Visibility, TouchpointType, Channel, Direction, NextActionStatus, NextActionReadState, AttentionState, OutcomeType, ResourceType, SuggestionStatus, ProjectionMode, Sort, Errors, MESSAGES,
    registry, eventType, lossReasons, sources, automationPolicy, offlinePolicy, requireOnline,
    currentModel, modelVersionById, stageOf, validateStageModel, draftFrom, editDraft, publish, impactReport, migrationPlan, applyMigrationPlan,
    createJourney, transition, pause, resume, closeOutcome, archive, makeEvent, appendEvent, correctEvent, resolveActiveJourney, ingest, suggestionsFor, decideSuggestion,
    recordTouchpoint, normalizeTouch, createAcquisition, updateLatestTouch, linkArtifact, recordOptionPresented,
    createNextAction, completeNextAction, cancelNextAction, acceptSuggestion, actionLabel, readState, activitySummary, aging, attention,
    timeline, summary, contextChip, query, board, allowedMoves, decideAccess, mapExternalStage, applyExternalStage, inventory, migrateLegacy });
})();

/* ---- journey/journeyServices.js ---- */
/* journey/journeyServices.js — topic 40: tenant-aware in-memory repositories and application services.
   JourneyRepository · JourneyEventRepository · JourneyStageRepository · JourneyNextActionRepository · JourneyArtifactLinkRepository ·
   JourneyAcquisitionRepository; services: JourneyApplicationService · JourneyStageService · JourneyTimelineService ·
   JourneyNextActionService · JourneyEventIngestionService · JourneyOutcomeService · JourneyAttributionService.

   Memory only (journey data is operational and sensitive: no localStorage, no offline cache by default). A stage change
   is one unit: compare-and-set on recordRevision → transition → current stage → event; on conflict nothing is written.
   Every call checks access first (deny by default) and writes a PII-free audit line (audit ≠ timeline). */
App.journey = App.journey || {};
App.journey.services = (() => {
  const J = () => App.journey.domain;
  function JourneyStore() {
    const T = () => ({ journeys: new Map(), events: [], transitions: [], nextActions: new Map(), links: [], acquisitions: new Map(), touchpoints: [], outcomes: new Map(), pauses: new Map(), suggestions: new Map(), assignments: [], conflicts: [], corrections: [], processedKeys: new Set() });
    let orgs = new Map();
    const of = org => { if (!org) throw Object.assign(new Error('organizationId obrigatório'), { code: 'MISSING_ORGANIZATION' }); if (!orgs.has(org)) orgs.set(org, T()); return orgs.get(org); };
    return Object.freeze({ of, clear() { orgs = new Map(); } });
  }
  function JourneyRepository(store) {
    const t = ctx => store.of(ctx.organizationId);
    return Object.freeze({
      getById: (ctx, id) => { const j = t(ctx).journeys.get(id); return j && j.organizationId === ctx.organizationId ? j : null; },
      listByCustomer: (ctx, customerId) => [...t(ctx).journeys.values()].filter(j => j.customerId === customerId),
      listByDevelopment: (ctx, devId) => [...t(ctx).journeys.values()].filter(j => j.developmentId === devId),
      findActiveJourney: (ctx, customerId, developmentId, journeyType) => { const r = J().resolveActiveJourney([...t(ctx).journeys.values()], { organizationId: ctx.organizationId, customerId, developmentId, journeyType }); return r.journeyId ? t(ctx).journeys.get(r.journeyId) : null; },
      /** compare-and-set: expectedRevision must equal the stored revision */
      save: (ctx, j, expectedRevision) => { const m = t(ctx).journeys, cur = m.get(j.id); if (cur ? cur.recordRevision !== expectedRevision : expectedRevision != null) return Object.freeze({ ok: false, code: 'JOURNEY_REVISION_CONFLICT', message: J().MESSAGES.JOURNEY_REVISION_CONFLICT }); m.set(j.id, j); return Object.freeze({ ok: true, journey: j }); }
    });
  }
  function services(store, env = {}) {
    const ctx = { organizationId: env.principal && env.principal.organizationId }, can = env.can || (() => false), dom = J(), repo = JourneyRepository(store), audit = [];
    const O = (extra = {}) => ({ now: env.now ? env.now() : undefined, idGen: env.idGen, actorId: env.principal && env.principal.userId, can, organizationId: ctx.organizationId, ...extra });
    const x = () => store.of(ctx.organizationId);
    const log = (action, data = {}) => audit.push(Object.freeze({ action, journeyId: data.journeyId || null, status: data.status || 'OK', codes: Object.freeze(data.codes || []) }));
    const notFound = (action, journeyId) => { log(action, { journeyId, status: 'DENIED' }); return Object.freeze({ ok: false, code: 'NOT_FOUND', message: 'Jornada não encontrada ou sem acesso.' }); };
    const access = j => dom.decideAccess({ journey: j, principal: env.principal, journeyAssignments: ctx.organizationId ? x().assignments : [], customerAssignments: env.customerAssignments ? env.customerAssignments() : [], can });
    const eventsOf = id => x().events.filter(e => e.journeyId === id);
    const connectivity = () => env.connectivity ? env.connectivity() : 'ONLINE';
    function appendAll(evs) { const s = x(); for (const e of evs.filter(Boolean)) { const r = dom.appendEvent(s.events, e); if (!r.duplicate) s.events = [...r.log]; } }
    /** atomic commit of a mutation result */
    function commit(prev, r, action) {
      const s = x(), save = repo.save(ctx, r.journey, prev ? prev.recordRevision : undefined);
      if (!save.ok) { log(action, { journeyId: r.journey.id, status: save.code }); return save; }
      if (r.transition) s.transitions.push(r.transition);
      appendAll([r.event, ...(r.events || [])]);
      if (r.pauseRecord) s.pauses.set(r.pauseRecord.id, r.pauseRecord);
      if (r.outcome) s.outcomes.set(r.outcome.id, r.outcome);
      if (r.nextAction) s.nextActions.set(r.nextAction.id, r.nextAction);
      if (r.assignment) s.assignments.push(r.assignment);
      log(action, { journeyId: r.journey.id, codes: r.audit ? [r.audit.action] : [] });
      return r;
    }
    const load = id => { const j = ctx.organizationId ? repo.getById(ctx, id) : null; const a = access(j); return { j, a }; };
    const app = Object.freeze({
      create(input) {
        if (!ctx.organizationId) return notFound('journey.create', null);
        const r = dom.createJourney(input, O({ existing: [...x().journeys.values()] })); if (!r.ok) { log('journey.create', { status: r.code }); return r; }
        return commit(null, r, 'JourneyCreated');
      },
      get(journeyId, mode = 'BROKER') {
        const { j, a } = load(journeyId); if (!a.allowed) return notFound('journey.read', journeyId);
        const m = mode === 'TECHNICAL' && a.level !== 'TECHNICAL' ? (a.level === 'BROKER' ? 'BROKER' : 'MANAGER') : mode;
        const na = j.currentNextActionId ? x().nextActions.get(j.currentNextActionId) : null, acq = [...x().acquisitions.values()].find(q => q.journeyId === j.id);
        return Object.freeze({ ok: true, access: a, summary: dom.summary(j, { nextAction: na, events: eventsOf(j.id), acquisition: acq, now: O().now }), timeline: a.canReadTimeline ? dom.timeline(j, { events: eventsOf(j.id), corrections: x().corrections, mode: m, now: O().now, limit: env.timelineLimit }) : null, allowedMoves: a.canTransition ? dom.allowedMoves(j, dom.modelVersionById(j.organizationId, j.stageModelVersionId)) : [] });
      },
      pause(journeyId, cmd, expectedRevision) { const { j, a } = load(journeyId); if (!a.allowed || !a.canTransition) return notFound('journey.pause', journeyId); const r = dom.pause(j, cmd, O({ expectedRevision })); return r.ok ? commit(j, r, 'JourneyPaused') : r; },
      resume(journeyId, expectedRevision) {
        const { j, a } = load(journeyId); if (!a.allowed) return notFound('journey.resume', journeyId);
        const rec = [...x().pauses.values()].filter(p => p.journeyId === j.id && !p.resumedAt).pop(); if (!rec) return Object.freeze({ ok: false, code: 'JOURNEY_NOT_PAUSED' });
        const r = dom.resume(j, rec, O({ expectedRevision })); return r.ok ? commit(j, r, 'JourneyResumed') : r;
      },
      link(journeyId, input) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.link', journeyId); const r = dom.linkArtifact(j, input, O({ existing: x().links })); if (r.ok && !r.duplicate) { x().links.push(r.link); appendAll([r.event]); } return r; },
      links(journeyId) { const { a } = load(journeyId); return a.allowed ? x().links.filter(l => l.journeyId === journeyId) : []; },
      resolveActive(customerId, developmentId) { return dom.resolveActiveJourney([...(ctx.organizationId ? x().journeys.values() : [])].filter(j => access(j).allowed), { organizationId: ctx.organizationId, customerId, developmentId }); }
    });
    const stage = Object.freeze({
      transition(journeyId, cmd = {}, expectedRevision) {
        const { j, a } = load(journeyId); if (!a.allowed || !a.canTransition) return notFound('journey.transition', journeyId);
        const r = dom.transition(j, cmd, O({ expectedRevision, connectivity: connectivity() })); if (!r.ok) { log('journey.transition', { journeyId, status: r.code }); return r; }
        return commit(j, r, 'JourneyStageTransitioned');
      },
      acceptSuggestion(suggestionId, expectedRevision) {
        const s = x().suggestions.get(suggestionId); if (!s || s.status !== 'PENDING' || !s.suggestedStageId) return Object.freeze({ ok: false, code: 'SUGGESTION_NOT_PENDING' });
        const r = this.transition(s.journeyId, { toStageId: s.suggestedStageId, sourceEventId: s.sourceEventId, reasonCode: 'SUGGESTION_ACCEPTED' }, expectedRevision);
        if (r.ok) x().suggestions.set(s.id, dom.decideSuggestion(s, 'ACCEPTED', O())); return r;
      },
      dismissSuggestion(suggestionId) { const s = x().suggestions.get(suggestionId); if (!s) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const d = dom.decideSuggestion(s, 'DISMISSED', O()); x().suggestions.set(s.id, d); return Object.freeze({ ok: true, suggestion: d }); },
      history(journeyId) { const { a } = load(journeyId); return a.allowed ? x().transitions.filter(t => t.journeyId === journeyId) : []; }
    });
    const outcome = Object.freeze({
      close(journeyId, cmd, expectedRevision) {
        const { j, a } = load(journeyId); if (!a.allowed || !a.canClose) return notFound('journey.close', journeyId);
        const off = dom.requireOnline('outcome', connectivity()); if (off) return off;
        const r = dom.closeOutcome(j, cmd, O({ expectedRevision })); if (!r.ok) { log('journey.close', { journeyId, status: r.code }); return r; }
        return commit(j, r, r.audit.action);
      }
    });
    const timelineSvc = Object.freeze({
      record(journeyId, input) {
        const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.touchpoint', journeyId);
        const off = dom.requireOnline('touchpoint', connectivity()); if (off) return off;
        const r = dom.recordTouchpoint(j, input, O()); if (!r.ok) return r;
        x().touchpoints.push(r.touchpoint); appendAll([r.event]); keepSuggestions(r); log('journey.touchpoint', { journeyId, codes: [input.type] }); return r;
      },
      presentOption(journeyId, input) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.option', journeyId); const r = dom.recordOptionPresented(j, input, O()); if (r.ok) appendAll([r.event]); return r; },
      correct(journeyId, eventId, cmd) { const { a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.correct', journeyId); const r = dom.correctEvent(eventsOf(journeyId), eventId, cmd, O()); if (r.ok) { x().corrections.push(r.correction); appendAll([r.event]); } return r; },
      page(journeyId, mode, cursor) { const { j, a } = load(journeyId); if (!a.allowed || !a.canReadTimeline) return notFound('journey.timeline', journeyId); return dom.timeline(j, { events: eventsOf(j.id), corrections: x().corrections, mode: mode === 'TECHNICAL' && a.level !== 'TECHNICAL' ? 'BROKER' : mode, cursor, limit: env.timelineLimit, now: O().now }); }
    });
    function keepSuggestions(r) { if (r.stageSuggestion) x().suggestions.set(r.stageSuggestion.id, r.stageSuggestion); if (r.actionSuggestion) x().suggestions.set(r.actionSuggestion.id, r.actionSuggestion); }
    const nextAction = Object.freeze({
      create(journeyId, input, expectedRevision) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.nextAction', journeyId); const r = dom.createNextAction(j, input, O({ expectedRevision })); if (!r.ok) return r; if (r.journey === j) { x().nextActions.set(r.nextAction.id, r.nextAction); appendAll([r.event]); return r; } return commit(j, r, 'JourneyNextActionCreated'); },
      complete(journeyId, actionId, expectedRevision, reasonCode) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.nextAction', journeyId); const na = x().nextActions.get(actionId); if (!na) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const r = dom.completeNextAction(j, na, O({ expectedRevision, reasonCode })); if (r.ok) { x().nextActions.set(na.id, r.nextAction); appendAll([r.event]); } return r; },
      cancel(journeyId, actionId, expectedRevision, reasonCode) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.nextAction', journeyId); const na = x().nextActions.get(actionId); if (!na) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const r = dom.cancelNextAction(j, na, O({ expectedRevision, reasonCode })); if (r.ok) { x().nextActions.set(na.id, r.nextAction); appendAll([r.event]); } return r; },
      acceptSuggestion(suggestionId, expectedRevision) { const s = x().suggestions.get(suggestionId); if (!s || !s.type) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const { j, a } = load(s.journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.nextAction', s.journeyId); const r = dom.acceptSuggestion(j, s, O({ expectedRevision })); if (!r.ok) return r; x().suggestions.set(s.id, r.suggestion); return commit(j, r, 'JourneyNextActionCreated'); },
      suggestions(journeyId) { return [...x().suggestions.values()].filter(s => s.journeyId === journeyId && s.status === 'PENDING'); }
    });
    const ingestion = Object.freeze({
      /** ingest(domainEvent) — idempotent; suggestions stored as PENDING; auto-transition only if the automation policy explicitly allows it */
      ingest(de) {
        if (!ctx.organizationId || de.organizationId !== ctx.organizationId) { log('journey.ingest', { status: 'IGNORED', codes: ['CROSS_TENANT'] }); return Object.freeze({ ok: true, action: 'IGNORED', reason: 'CROSS_TENANT' }); }
        const r = dom.ingest(de, { journeys: [...x().journeys.values()], log: x().events }, O());
        if (r.action === 'APPENDED') { appendAll([r.event]); keepSuggestions(r); if (r.autoTransitionEligible && r.stageSuggestion) { const j = repo.getById(ctx, r.journeyId); stage.transition(j.id, { toStageId: r.stageSuggestion.suggestedStageId, sourceEventId: r.event.id, reasonCode: 'AUTO_TRUSTED_EVENT' }, j.recordRevision); } }
        log('journey.ingest', { journeyId: r.journeyId, status: r.action, codes: [r.reason || de.type] }); return r;
      }
    });
    const attribution = Object.freeze({
      capture(journeyId, input) { const { j, a } = load(journeyId); if (!a.allowed || !a.canRecord) return notFound('journey.attribution', journeyId); if ([...x().acquisitions.values()].some(q => q.journeyId === journeyId)) return Object.freeze({ ok: false, code: 'FIRST_TOUCH_IMMUTABLE' }); const r = dom.createAcquisition(j, input, O()); x().acquisitions.set(r.acquisition.id, r.acquisition); return r; },
      latest(journeyId, touch) { const q = [...x().acquisitions.values()].find(z => z.journeyId === journeyId); if (!q) return Object.freeze({ ok: false, code: 'NOT_FOUND' }); const u = dom.updateLatestTouch(q, touch); x().acquisitions.set(u.id, u); return Object.freeze({ ok: true, acquisition: u }); }
    });
    const crm = Object.freeze({
      applyStage(journeyId, ext, o = {}) {
        const { j, a } = load(journeyId); if (!a.allowed) return notFound('journey.crm', journeyId);
        const r = dom.applyExternalStage(j, ext, { ...O(), ...o, processedKeys: x().processedKeys });
        if (r.action === 'CONFLICT') x().conflicts.push(r.conflict);
        if (r.action === 'TRANSITION') { const c = commit(j, r, 'JourneyStageTransitioned'); if (!c.ok) return c; }
        if (r.key && r.action !== 'DUPLICATE') x().processedKeys.add(r.key);
        return r;
      },
      conflicts() { return x().conflicts.slice(); }
    });
    /** board(query) — summaries only (customer names resolved by the caller through the Customer SUMMARY projection) */
    function board(q = {}, o = {}) {
      const visible = [...x().journeys.values()].filter(j => access(j).allowed), summaries = new Map(visible.map(j => [j.id, dom.summary(j, { nextAction: j.currentNextActionId ? x().nextActions.get(j.currentNextActionId) : null, events: eventsOf(j.id), now: O().now })]));
      const r = dom.query(visible, { ...q, organizationId: ctx.organizationId }, { summaries, customerNames: o.customerNames, now: O().now });
      const model = dom.currentModel(ctx.organizationId); return Object.freeze({ ok: true, items: r.items, board: model ? dom.board(r.items, model, { customerNames: o.customerNames, now: O().now }) : null });
    }
    return Object.freeze({ repo, application: app, stage, outcome, timeline: timelineSvc, nextAction, ingestion, attribution, crm, board, audit: () => audit.slice(), _store: () => x() });
  }
  return Object.freeze({ JourneyStore, JourneyRepository, services });
})();

/* ---- customer/customerView.js ---- */
/* customer/customerView.js — topics 39/40 UI strings (markup only, no DOM access, no state). Map-centric: a context chip,
   the customer workspace tabs (Resumo · Jornada · Perfil · Favoritos · Comparações · Recomendações) and a light journey panel.
   Uses the app's delegated data-act actions: custClear (existing: "Sair do contexto do cliente"), custTab (data-tab),
   jnyOpen, jnyMove (data-to, data-rev), jnyNextDone (data-id, data-rev), jnyTouch, jnyOption (data-id).
   Never renders phone/e-mail in the header, never promises valorização, never shows lot availability as confirmed. */
App.customerView = (() => {
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TABS = Object.freeze([['summary', 'Resumo'], ['journey', 'Jornada'], ['profile', 'Perfil'], ['favorites', 'Favoritos'], ['comparisons', 'Comparações'], ['recommendations', 'Recomendações']]);
  const READ = { OPEN: 'Em aberto', DUE_SOON: 'Vence em breve', OVERDUE: 'Atrasada', COMPLETED: 'Concluída', CANCELLED: 'Cancelada' };
  const ATT = { ON_TRACK: 'Em dia', ACTION_DUE: 'Ação pendente', OVERDUE: 'Follow-up atrasado', WAITING_CUSTOMER: 'Aguardando o cliente', WAITING_INTERNAL: 'Aguardando equipe', PAUSED: 'Pausada', CLOSED: 'Encerrada', UNKNOWN: 'Sem próxima ação definida' };
  const date = s => { if (!s) return ''; try { return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }); } catch (_) { return ''; } };
  /** contextChip({ label, device }) — label from App.customer.context.headerLabel / App.journey.domain.contextChip */
  function contextChip(vm) {
    if (!vm || !vm.label) return '';
    return `<div class="custchip" role="status" aria-live="polite"><span>${esc(vm.label)}</span><button class="lbtn small" data-act="custClear" aria-label="Sair do contexto do cliente" title="Sair do contexto do cliente">×</button></div>`;
  }
  /** tabs(active) — workspace tabs; the map stays the main surface */
  const tabs = active => `<div class="custtabs" role="tablist">${TABS.map(([id, l]) => `<button role="tab" data-act="custTab" data-tab="${id}" aria-selected="${id === active}">${esc(l)}</button>`).join('')}</div>`;
  /** journeyPanel({ available, summary, timeline, allowedMoves, suggestions, revision }) */
  function journeyPanel(vm = {}) {
    if (!vm.available) return `<div class="card"><p class="muted">A jornada comercial é registrada no servidor da organização. Neste aparelho (modo sem login) ela não fica disponível.</p></div>`;
    if (!vm.summary) return `<div class="card"><p class="muted">Este cliente ainda não tem jornada neste empreendimento.</p>${vm.canCreate ? `<button class="btn" data-act="jnyOpen">Abrir jornada</button>` : ''}</div>`;
    const s = vm.summary, rev = esc(vm.revision);
    let h = `<div class="card jny"><div class="lh1"><h3>${esc(s.currentStage ? s.currentStage.title : 'Etapa não definida')}</h3><span class="small">${esc(ATT[s.attentionState] || '')}</span></div>`;
    h += s.nextAction ? `<p><b>Próxima ação:</b> ${esc(s.nextAction.title)}${s.nextAction.dueAt ? ` · ${esc(date(s.nextAction.dueAt))}` : ''} <span class="small">(${esc(READ[s.nextAction.readState] || '')})</span> <button class="lbtn small" data-act="jnyNextDone" data-id="${esc(s.nextAction.id)}" data-rev="${rev}">Concluir</button></p>` : `<p class="muted">Defina a próxima ação (pode ser "Aguardar o cliente").</p>`;
    if ((vm.allowedMoves || []).length) h += `<div class="acts2" role="group" aria-label="Mudar etapa">${vm.allowedMoves.filter(m => !m.requiresOutcome).map(m => `<button class="btn small" data-act="jnyMove" data-to="${esc(m.toStageId)}" data-rev="${rev}"${m.requireReason ? ' data-reason="1"' : ''}>${esc(m.title)}</button>`).join('')}</div>`;
    for (const sg of vm.suggestions || []) h += `<p class="small">Sugestão: ${esc(sg.text)} <span class="muted">(não aplicada automaticamente)</span></p>`;
    h += `<div class="acts2"><button class="btn" data-act="jnyTouch">Registrar contato</button></div>`;
    const items = (vm.timeline && vm.timeline.items) || [];
    h += items.length ? `<ol class="jny-tl">${items.map(i => `<li><time datetime="${esc(i.occurredAt)}">${esc(date(i.occurredAt))}</time> ${esc(i.text)}${i.corrected ? ' <span class="small">(corrigido)</span>' : ''}</li>`).join('')}</ol>` : `<p class="muted">Sem eventos registrados.</p>`;
    return h + `</div>`;
  }
  /** optionPresentedButton(lotId) — QuickView action "Registrar como opção apresentada" (explicit; opening the lot records nothing) */
  const optionPresentedButton = (lotId, enabled) => enabled ? `<button class="lbtn small" data-act="jnyOption" data-id="${esc(lotId)}">Registrar como opção apresentada</button>` : '';
  return Object.freeze({ TABS, contextChip, tabs, journeyPanel, optionPresentedButton, esc });
})();

/* ---- chunk end ---- */
App.chunks._done("customer");
