# Relatório de migração dos alertas legados (Tópico 36)

Gerado a partir de `App.alertMigration.INVENTORY` (src/rules/legacyAlertMigration.js) e do catálogo `config/rules/viva-juara.json` (rule set `ruleset:viva-juara:legacy-v1`).

## Inventário e classificação

| Item | Onde está hoje | Condição | Severidade | Alvo | Classe | Migrado para | Observações |
|---|---|---|---|---|---|---|---|
| NOISE | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | notes.quiet < 5 | ATTENTION | LOT | DOMAIN_ALERT | NOISE | fontes vêm do traço do critério quiet |
| PRIVACY | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | notes.privacy < 4 | ATTENTION | LOT | DOMAIN_ALERT | PRIVACY | — |
| AFTERNOON_SUN | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | environmental.strongAfternoonSun = true | INFO | LOT | DOMAIN_ALERT | AFTERNOON_SUN | INFO: só aparece em detalhes (broker), não no Quick View |
| TECHNICAL_AREA | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | location.distanceToTechnicalAreaM < 40 | IMPORTANT | LOT | DOMAIN_ALERT | TECHNICAL_AREA | — |
| EASEMENT | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | construction.adjacentToProjectedEasement = true | IMPORTANT | LOT | DOMAIN_ALERT | EASEMENT | o adaptador legado também deriva construction.easements deste texto (dependência circular conhecida) |
| AVENUE | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | location.distanceToExternalRoadM <= 100 | IMPORTANT | LOT | DOMAIN_ALERT | AVENUE | — |
| TRAFFIC | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | mobility.estimatedTraffic in [HIGH, VERY_HIGH] | ATTENTION | LOT | DOMAIN_ALERT | TRAFFIC | — |
| GEOMETRY | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | notes.geometry < 6 OR geometry.frontWidthM < 9 | ATTENTION | LOT | DOMAIN_ALERT | GEOMETRY | "frente estreita" (< 9 m) é fixo no código (engine.js alertOf), agora parâmetro narrowFrontBelowM da versão |
| BUILDING_RESTRICTION | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | surroundings.rearClass = GREEN_EXTERNAL | IMPORTANT | LOT | DOMAIN_ALERT | BUILDING_RESTRICTION | o adaptador legado deriva construction.nonBuildableRearToConfirm deste alerta |
| MISSING_AREA | config/scoring/viva-juara/1.0.json#alerts + intelligence/engine.js (cond/alertOf) + intelligence/textAdapter.js (alertText) + domain/rules.js (ALERTS) + data/legacyAdapter.js (parseAlert) | geometry.areaM2 is null | ATTENTION (via OTHER) | LOT | DATA_QUALITY_WARNING | MISSING_AREA | bug conhecido: texto sem ":" → o adaptador legado lê como OTHER sem título; AlertType não tem MISSING_AREA; nenhum lote atual dispara |
| STATUS_NOTE | presentation/viewmodels.js statusVM | status = UNKNOWN OR freshness in [EXPIRED, STALE] | warn=true | LOT | DOMAIN_ALERT | AVAILABILITY_CONFIRMATION | mesma condição usada no aviso da comparação (overlays.js, col.status.warn) |
| STATUS_UPDATED_HINT | presentation/viewmodels.js statusVM | fresh AND updatedAt (broker) | nenhuma | LOT | UI_HINT | — | não é alerta; continua na UI |
| AVAILABLE_NOT_CONFIRMED_LABEL | presentation/viewmodels.js statusVM | AVAILABLE AND freshness ≠ FRESH | nenhuma | LOT | UI_HINT | — | rótulo de status, não alerta |
| SHARE_STATUS | presentation/viewmodels.js shareVM | status = UNKNOWN OR freshness ≠ FRESH | aviso | LOT×SHARE | DOMAIN_ALERT | SHARE_STATUS_NOT_CONFIRMED | condição parecida com STATUS_NOTE, mas freshness UNKNOWN também conta aqui: mantidas separadas (revisão humana) |
| SHARE_NOT_OFFERABLE | presentation/viewmodels.js shareVM | NOT(SHARE_STATUS) AND NOT isOfferable(status) | aviso | LOT×SHARE | DOMAIN_ALERT | SHARE_NOT_OFFERABLE | — |
| SHARE_PRICE | presentation/viewmodels.js shareVM | commercial freshness tracked AND ≠ FRESH AND price != null | aviso | LOT×SHARE | DOMAIN_ALERT | SHARE_PRICE_FROM_LAST_TABLE | — |
| QUICKVIEW_ALERT_SUMMARY | quickview/quickview.js alertSummary | contagem por severidade | — | LOT | UI_HINT | App.alerts.quickViewSummary | projeção; paridade testada |
| DETAILS_CLIENT_FILTER | presentation/viewmodels.js detailsVM | cliente vê só CRITICAL/IMPORTANT | — | LOT | UI_HINT | App.alerts.project(…, CLIENT) | política de público |
| ATTENTION_POINTS | intelligence/engine.js result.attentionPoints | alertas com severidade ≠ INFO | — | LOT | UI_HINT | App.alerts.project | derivado, mesma fonte |
| FILTER_WARNINGS | presentation/panels.js WARN (STALE_PRICE, STALE_AVAILABILITY, ESTIMATED_FIELD, …) | avisos do FilterEngine | — | FILTER | DATA_QUALITY_WARNING | — | avisos do filtro, não do lote; ficam no FilterEngine |
| FILTER_INVALID | presentation/panels.js | filtros inválidos ignorados | — | FILTER | VALIDATION_ERROR | — | técnico/broker |
| FILTER_ALERT_CRITERIA | filters/filters.js noNoiseAlert / alertsExclude | NOT_CONTAINS_TYPE sobre intelligence.alerts | — | FILTER | UI_HINT | — | consumidor de alertas; passa a ler a projeção legada |
| COMPARE_OUT_OF_FILTER | presentation/overlays.js | lote da comparação fora do filtro | — | COMPARISON | UI_HINT | — | — |
| COMPARE_ALERT_COUNT | compare/comparisonDomain.js alertsCount | número de alertas | — | COMPARISON | UI_HINT | — | informativo; nunca decide vencedor |
| SIMULATION_ELIGIBILITY | domain/availability.js simulationEligibility → panels.js | status não ofertável | — | LOT | VALIDATION_ERROR | — | gate de política (tópico 8), não alerta |
| RECOMMENDATION_CONFLICTS | presentation/panels.js (rec.conflicts, INVALID_PROFILE) | perfil/exigências | — | CUSTOMER | RECOMMENDATION_REASON | — | — |
| EXPLANATION_NEGATIVE | presentation/panels.js "Ponto de atenção" | negativeFactors da explicação | — | CUSTOMER | RECOMMENDATION_REASON | — | — |
| ENGINE_DIAGNOSTICS | intelligence/engine.js diag (MISSING_INPUT, UNKNOWN_ENUM, NON_FINITE_VALUE, MODULE_FAILED) | — | WARNING/ERROR | LOT | TECHNICAL_DIAGNOSTIC | — | — |
| METHODOLOGY_VALIDATION | intelligence/methodology.js validate warnings | — | — | CONFIG | VALIDATION_ERROR | — | — |
| OFFLINE_BANNER | presentation/viewmodels.js connectivityVM | OFFLINE/DEGRADED | — | APP | UI_HINT | — | operacional, não de lote |

Só itens DOMAIN_ALERT (e o DATA_QUALITY_WARNING MISSING_AREA, que já era emitido como alerta) viraram regras. Validações, dicas de UI, razões de recomendação e diagnósticos técnicos ficam onde estão.

## Regras criadas (RuleDefinition → RuleVersion 1.0.0, PUBLISHED)

| # | Código | Categoria | Contexto | Superfície legada | Severidade | Dependências | unknownPolicy |
|---|---|---|---|---|---|---|---|
| 1 | NOISE | ENVIRONMENTAL | BASE | INTELLIGENCE_ALERTS | ATTENTION | ANALYSIS_NOTE_QUIET, NOISE_SOURCES | NO_ALERT |
| 2 | PRIVACY | ENVIRONMENTAL | BASE | INTELLIGENCE_ALERTS | ATTENTION | ANALYSIS_NOTE_PRIVACY, ESTIMATED_TRAFFIC, HAS_TWO_FRONTS, IS_CORNER | NO_ALERT |
| 3 | AFTERNOON_SUN | ENVIRONMENTAL | BASE | INTELLIGENCE_ALERTS | INFO | STRONG_AFTERNOON_SIDE, STRONG_AFTERNOON_SUN | NO_ALERT |
| 4 | TECHNICAL_AREA | LOCATION | BASE | INTELLIGENCE_ALERTS | IMPORTANT | DISTANCE_TECHNICAL_AREA_M | NO_ALERT |
| 5 | EASEMENT | CONSTRUCTION | BASE | INTELLIGENCE_ALERTS | IMPORTANT | ADJACENT_PROJECTED_EASEMENT | NO_ALERT |
| 6 | AVENUE | MOBILITY | BASE | INTELLIGENCE_ALERTS | IMPORTANT | DISTANCE_EXTERNAL_ROAD_M | NO_ALERT |
| 7 | TRAFFIC | MOBILITY | BASE | INTELLIGENCE_ALERTS | ATTENTION | ESTIMATED_TRAFFIC | NO_ALERT |
| 8 | GEOMETRY | GEOMETRY | BASE | INTELLIGENCE_ALERTS | ATTENTION | ANALYSIS_NOTE_GEOMETRY, FRONT_WIDTH_M, HAS_TWO_FRONTS, SHAPE_CLASS | NO_ALERT |
| 9 | BUILDING_RESTRICTION | CONSTRUCTION | BASE | INTELLIGENCE_ALERTS | IMPORTANT | REAR_CLASS | NO_ALERT |
| 10 | MISSING_AREA | DATA_QUALITY | BASE | INTELLIGENCE_ALERTS | ATTENTION | AREA_M2 | NO_ALERT |
| 11 | AVAILABILITY_CONFIRMATION | AVAILABILITY | BASE | STATUS_NOTE | ATTENTION | availability.freshness, availability.status, availability.updatedAt | NO_ALERT |
| 12 | SHARE_STATUS_NOT_CONFIRMED | AVAILABILITY | SHARE | SHARE_WARNINGS | ATTENTION | availability.freshness, availability.status, identity.code | NO_ALERT |
| 13 | SHARE_NOT_OFFERABLE | AVAILABILITY | SHARE | SHARE_WARNINGS | ATTENTION | availability.freshness, availability.status, identity.code | NO_ALERT |
| 14 | SHARE_PRICE_FROM_LAST_TABLE | PRICING | SHARE | SHARE_WARNINGS | ATTENTION | COMMERCIAL_FRESHNESS, COMMERCIAL_FRESHNESS_TRACKED, commercial.price, identity.code | NO_ALERT |

## Duplicações e pontos de revisão humana

- **STATUS_NOTE × SHARE_STATUS**: condições parecidas, mas não iguais (o compartilhamento também avisa quando a atualidade é UNKNOWN com status conhecido). Mantidas como regras separadas — não consolidar sem revisão.
- **Aviso da comparação** (overlays.js) usa o mesmo `warn` do statusVM: duplicação de renderização, coberta por AVAILABILITY_CONFIRMATION.
- **MISSING_AREA**: o texto legado não tem ":" e o adaptador o lê como OTHER sem título; preservado exatamente (zero-delta). Nenhum dos 498 lotes dispara. Correção (tipo próprio no enum AlertType) exige decisão.
- **GEOMETRY**: o corte de "frente estreita" (< 9 m) estava fixo em engine.js; agora é o parâmetro `narrowFrontBelowM` da versão (mesmo valor).
- **EASEMENT / BUILDING_RESTRICTION**: o adaptador legado deriva `construction.easements` e `construction.nonBuildableRearToConfirm` do próprio texto do alerta (dependência circular). As regras leem a métrica da análise, não o texto.
- Severidades mantidas no enum atual (INFO/ATTENTION/IMPORTANT/CRITICAL); correspondência com a sugestão do spec: ATTENTION≈NOTICE, IMPORTANT≈WARNING.

## Distribuição atual (lots.json)

- AVENUE: 31
- NOISE: 29
- AFTERNOON_SUN: 81
- TRAFFIC: 152
- PRIVACY: 35
- GEOMETRY: 5
- EASEMENT: 5
- BUILDING_RESTRICTION: 53
- TECHNICAL_AREA: 13
- Total: 404 alertas em 498 lotes; todos os 498 lotes com disponibilidade UNKNOWN → AVAILABILITY_CONFIRMATION ativo em todos (como hoje).
