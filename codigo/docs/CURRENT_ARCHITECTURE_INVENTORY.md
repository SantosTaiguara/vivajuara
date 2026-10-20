# Inventário da arquitetura atual (Fase 0.1)

> Documento gerado por `node scripts/governanceDocs.js` a partir de `plat/src/**/*.js` e `config/governance/architecture.json`. Não editar à mão: altere a fonte e gere de novo.

Data da geração: 2026-10-18. 164 arquivos JavaScript em `plat/src`, 36.367 linhas. Arquitetura atual: aplicação de página única (build `scripts/build.js` concatena os módulos na ordem de `tests/harness.js` + lista de UI) em que cada módulo é um script que se pendura no objeto global `App`. Não há imports: as dependências são as referências `App.<namespace>` lidas pelo teste de arquitetura.

## Arquivos por camada

| Camada | Arquivos |
|---|---|
| application | 46 |
| composition | 2 |
| config | 5 |
| domain | 55 |
| governance | 4 |
| infrastructure | 23 |
| kernel | 1 |
| presentation | 24 |
| shared | 3 |
| worker | 1 |

## Fontes de dados, storage e rede (achados estáticos)

- Dados publicados lidos por: `config/developments.js` (commercial.json, lots.json), `data/repositories.js` (lots.json), `domain/availability.js` (lots.json), `loading/planner.js` (analysis-input.json), `loading/resources.js` (analysis-input.json), `presentation/app.js` (analysis-input.json), `pwa/offlinePack.js` (analysis-input.json).
- Uso de storage do browser (localStorage/sessionStorage/IndexedDB/Cache Storage): `cache/cacheManager.js`, `data/offline.js`, `favorites/favorites.js`, `presentation/app.js`, `privacy/deviceData.js`, `pwa/offlinePack.js`, `pwa/pwaCore.js`, `pwa/sync.js`, `state/store.js`, `sw.template.js`.
- Chamadas de rede (fetch/XHR/sendBeacon/WebSocket/EventSource): `data/apiSource.js`, `data/repositories.js`, `presentation/app.js`, `pwa/offlinePack.js`, `sw.template.js`.
- Acesso a DOM/browser fora das views: `data/offline.js`, `layout/responsiveProfile.js`, `observability/obsPlatform.js`, `pwa/update.js`.

## Módulos

| Arquivo | Namespace(s) atribuído(s) | Contexto | Camada | Linhas | Depende de (arquivos) | Storage | Rede | DOM |
|---|---|---|---|---|---|---|---|---|
| `admin/adminApp.js` | App.adminApp | admin-shell | composition | 75 | 5 |  |  | sim |
| `analytics/client.js` | — | analytics | infrastructure | 395 | 1 |  |  |  |
| `analytics/early.js` | — | analytics | application | 10 | 1 |  |  |  |
| `analytics/facade.js` | App.analytics | analytics | application | 55 | 7 |  |  |  |
| `analytics/metricsView.js` | App.metricsView | analytics | presentation | 94 | 4 |  |  |  |
| `analytics/privacy.js` | App.eventTracking.privacy | analytics | domain | 99 | 0 |  |  |  |
| `analytics/registry.js` | App.eventTracking.registry | analytics | domain | 235 | 1 |  |  |  |
| `analytics/semantic.js` | App.semanticLayer | analytics | domain | 412 | 1 |  |  |  |
| `backoffice/backofficeAdapters.js` | App.backofficeAdapters | backoffice | application | 105 | 2 |  |  |  |
| `backoffice/backofficeCommands.js` | — | backoffice | application | 122 | 3 |  |  |  |
| `backoffice/backofficeCore.js` | App.backoffice | backoffice | application | 318 | 5 |  |  |  |
| `backoffice/backofficeGovernance.js` | — | backoffice | application | 243 | 4 |  |  |  |
| `backoffice/backofficeView.js` | App.backofficeView | backoffice | presentation | 121 | 2 |  |  |  |
| `cache/cacheCore.js` | App.cache.core | cache | infrastructure | 406 | 1 |  |  |  |
| `cache/cacheManager.js` | App.cache.manager | cache | infrastructure | 351 | 2 | sim |  |  |
| `compare/comparisonDomain.js` | App.compare.domain | comparison | domain | 564 | 4 |  |  |  |
| `compare/criterionWinner.js` | App.compare.evaluation, App.compare.viewModel | comparison | domain | 611 | 5 |  |  |  |
| `confidence/confidenceEngine.js` | App.dataConfidence | confidence | domain | 238 | 1 |  |  |  |
| `confidence/confidenceServices.js` | App.dataConfidenceServices | confidence | application | 186 | 5 |  |  |  |
| `config/backoffice/backofficeConfig.js` | App.backofficeConfig | backoffice | config | 137 | 0 |  |  |  |
| `config/developments.js` | App.config | development | config | 95 | 0 |  |  |  |
| `config/onboarding/onboardingPolicy.js` | App.onboardingPolicy | onboarding | config | 136 | 0 |  |  |  |
| `config/presentation.js` | App.presentationConfig | development | config | 70 | 1 |  |  |  |
| `config/surroundings/surroundings.config.js` | App.surroundings.config | surroundings | config | 159 | 0 |  |  |  |
| `customer/customerContext.js` | App.customer.context | customer | application | 137 | 2 |  |  |  |
| `customer/customerDomain.js` | App.customer.domain | customer | domain | 598 | 5 |  |  |  |
| `customer/customerRepository.js` | App.customer.repo | customer | application | 211 | 3 |  |  |  |
| `customer/customerView.js` | App.customerView | customer | presentation | 37 | 0 |  |  |  |
| `data/apiSource.js` | App.api | data-access | infrastructure | 151 | 1 |  | sim |  |
| `data/legacyAdapter.js` | App.legacy | data-access | infrastructure | 237 | 3 |  |  |  |
| `data/lifecycle.js` | App.lifecycle | lot | domain | 165 | 3 |  |  |  |
| `data/offline.js` | App.offline | data-access | infrastructure | 710 | 5 | sim |  | sim |
| `data/repositories.js` | App.repos | data-access | infrastructure | 267 | 10 |  | sim |  |
| `dataquality/dqEngine.js` | App.dataQuality.evaluators, App.dataQuality.engine, App.dataQuality.evaluateGate | data-quality | application | 658 | 8 |  |  |  |
| `dataquality/dqModel.js` | App.dataQuality.model | data-quality | application | 223 | 4 |  |  |  |
| `dataquality/dqView.js` | App.dataQualityView | data-quality | presentation | 43 | 1 |  |  |  |
| `dataquality/dqWorkflow.js` | App.dataQuality.workflow | data-quality | application | 268 | 2 |  |  |  |
| `datastate/dataState.js` | App.dataState | data-state | domain | 557 | 4 |  |  |  |
| `deals/dealsDomain.js` | App.deals.domain | deals | domain | 59 | 0 |  |  |  |
| `deals/dealsView.js` | App.dealsView | deals | presentation | 71 | 2 |  |  |  |
| `decision/decisionDomain.js` | App.decision.domain | decision | domain | 388 | 6 |  |  |  |
| `decision/decisionServices.js` | App.decision.services | decision | application | 442 | 11 |  |  |  |
| `decision/decisionView.js` | App.decisionView | decision | presentation | 71 | 0 |  |  |  |
| `deeplink/linkRestoration.js` | App.deeplink.restoration, App.deeplink.references, App.deeplink.navigation, App.deeplink.service | navigation | application | 365 | 3 |  |  |  |
| `deeplink/linkStateCodec.js` | App.deeplink.codec | navigation | domain | 493 | 3 |  |  |  |
| `documents/documentDomain.js` | App.documents | documents | domain | 271 | 1 |  |  |  |
| `documents/documentServices.js` | App.documentServices | documents | application | 512 | 4 |  |  |  |
| `documents/integrity.js` | App.integrity | shared | shared | 88 | 0 |  |  |  |
| `domain/availability.js` | App.availability | availability | domain | 381 | 2 |  |  |  |
| `domain/enums.js` | App.enums | lot | domain | 57 | 0 |  |  |  |
| `domain/lot.js` | App.domain | lot | domain | 193 | 2 |  |  |  |
| `domain/model.js` | App.model, App.pricing.formula | lot | domain | 233 | 0 |  |  |  |
| `domain/rules.js` | App.rules | analysis | domain | 53 | 2 |  |  |  |
| `favorites/favorites.js` | App.favorites | favorites | application | 536 | 3 | sim |  |  |
| `filters/filters.js` | App.filters | filters | domain | 307 | 6 |  |  |  |
| `geo/camera.js` | App.geo.camera | map | domain | 45 | 0 |  |  |  |
| `geo/geometry.js` | App.geo.geometry | map | domain | 179 | 1 |  |  |  |
| `geo/hitTest.js` | App.geo.hitTest | map | domain | 67 | 1 |  |  |  |
| `geo/perf.js` | App.geo.perf | map | infrastructure | 46 | 0 |  |  |  |
| `geo/repository.js` | App.geo.repository | map | infrastructure | 45 | 1 |  |  |  |
| `geo/spatialIndex.js` | App.geo.spatialIndex | map | domain | 54 | 0 |  |  |  |
| `governance/architectureConformance.js` | App.governance.architecture | governance | governance | 216 | 0 |  |  |  |
| `governance/capabilityRegistry.js` | App.governance.capabilities | governance | governance | 84 | 0 |  |  |  |
| `governance/goldenBaseline.js` | App.governance.golden | governance | governance | 273 | 19 |  |  |  |
| `governance/roadmap.js` | App.governance.roadmap | governance | governance | 88 | 0 |  |  |  |
| `intelligence/engine.js` | App.intelligence | analysis | domain | 318 | 4 |  |  |  |
| `intelligence/explanation.js` | App.explanation | recommendation | domain | 296 | 4 |  |  |  |
| `intelligence/fit.js` | App.fit | recommendation | domain | 270 | 4 |  |  |  |
| `intelligence/math.js` | App.imath | analysis | domain | 48 | 0 |  |  |  |
| `intelligence/methodology.js` | App.methodology | analysis | domain | 276 | 4 |  |  |  |
| `intelligence/normalization.js` | App.inormalize | analysis | domain | 100 | 1 |  |  |  |
| `intelligence/reasonCodes.js` | App.reasonCodes | recommendation | domain | 262 | 1 |  |  |  |
| `intelligence/recommendation.js` | App.recommendation | recommendation | domain | 233 | 3 |  |  |  |
| `intelligence/textAdapter.js` | App.analysisText | analysis | domain | 89 | 2 |  |  |  |
| `journey/journeyDomain.js` | App.journey.domain | journey | domain | 636 | 2 |  |  |  |
| `journey/journeyServices.js` | App.journey.services | journey | application | 150 | 1 |  |  |  |
| `layout/responsiveProfile.js` | App.responsive | workspace | application | 104 | 0 |  |  | sim |
| `layout/shortcuts.js` | App.shortcuts | workspace | application | 46 | 0 |  |  |  |
| `layout/workspace.js` | App.workspace | workspace | application | 186 | 1 |  |  |  |
| `loading/chunkLoader.js` | App.chunks | loading | presentation | 78 | 0 |  |  |  |
| `loading/coordinator.js` | App.loading.coordinator | loading | infrastructure | 273 | 1 |  |  |  |
| `loading/loadingView.js` | App.loadingView | loading | presentation | 30 | 0 |  |  |  |
| `loading/planner.js` | App.loading.planner | loading | infrastructure | 239 | 1 |  |  |  |
| `loading/resources.js` | App.loading.resources | loading | infrastructure | 254 | 0 |  |  |  |
| `map/layers.js` | App.mapLayers | map | domain | 383 | 4 |  |  |  |
| `map/legend.js` | App.legend | map | domain | 138 | 2 |  |  |  |
| `mobile/sheet.js` | App.mobileSheet | workspace | application | 119 | 0 |  |  |  |
| `navigation/menuView.js` | App.navigation.view | navigation | presentation | 213 | 3 |  |  | sim |
| `navigation/navigationRegistry.js` | App.navigation.registry | navigation | domain | 280 | 1 |  |  |  |
| `navigation/navigationService.js` | App.navigation.state, App.navigation.service, App.navigation.shortcuts | navigation | application | 183 | 3 |  |  |  |
| `observability/obsCore.js` | App.observability.core | observability | infrastructure | 386 | 1 |  |  |  |
| `observability/obsPlatform.js` | App.observability.platform | observability | infrastructure | 270 | 2 |  |  | sim |
| `observability/obsSignals.js` | App.observability.signals | observability | infrastructure | 285 | 1 |  |  |  |
| `onboarding/canonical.js` | App.onboarding.canonical | onboarding | domain | 110 | 1 |  |  |  |
| `onboarding/commercialImport.js` | App.onboarding.commercial | onboarding | domain | 113 | 4 |  |  |  |
| `onboarding/geometryIngest.js` | App.onboarding.geometry | onboarding | domain | 170 | 3 |  |  |  |
| `onboarding/mapping.js` | App.onboarding.mapping | onboarding | domain | 188 | 3 |  |  |  |
| `onboarding/onboardingModel.js` | App.onboarding.model | onboarding | domain | 166 | 1 |  |  |  |
| `onboarding/onboardingView.js` | App.onboardingView | onboarding | presentation | 55 | 2 |  |  |  |
| `onboarding/orchestrator.js` | App.onboarding.orchestrator | onboarding | application | 452 | 1 |  |  |  |
| `onboarding/parsers.js` | App.onboarding.parsers | onboarding | application | 242 | 3 |  |  |  |
| `onboarding/publication.js` | App.onboarding.publication | onboarding | domain | 220 | 3 |  |  |  |
| `onboarding/quality.js` | App.onboarding.quality | onboarding | domain | 220 | 2 |  |  |  |
| `onboarding/sourceIntake.js` | App.onboarding.intake | onboarding | application | 197 | 4 |  |  |  |
| `prelude.js` | — | kernel | kernel | 2 | 0 |  |  |  |
| `presentation/app.js` | App.main, App.debugInfo | workspace | composition | 1505 | 70 | sim | sim | sim |
| `presentation/compareView.js` | App.compareView | workspace | presentation | 97 | 2 |  |  |  |
| `presentation/dataTrustView.js` | App.dataTrustView | workspace | presentation | 62 | 0 |  |  |  |
| `presentation/dom.js` | App.ui | workspace | presentation | 43 | 0 |  |  | sim |
| `presentation/favoritesView.js` | App.favoritesView | workspace | presentation | 49 | 1 |  |  |  |
| `presentation/map.js` | App.MapView | workspace | presentation | 374 | 8 |  |  | sim |
| `presentation/overlays.js` | App.overlays | workspace | presentation | 134 | 7 |  |  |  |
| `presentation/panels.js` | App.panels | workspace | presentation | 466 | 22 |  |  | sim |
| `presentation/pricingView.js` | App.pricingView | workspace | presentation | 104 | 3 |  |  |  |
| `presentation/securityView.js` | App.securityView | workspace | presentation | 63 | 0 |  |  |  |
| `presentation/viewmodels.js` | App.vm | workspace | application | 217 | 10 |  |  |  |
| `presentationmode/domain.js` | App.presentationMode.domain | presentation-mode | domain | 497 | 4 |  |  |  |
| `presentationmode/policy.js` | App.presentationMode.policy | presentation-mode | domain | 193 | 1 |  |  |  |
| `presentationmode/presentationView.js` | App.presentationView | presentation-mode | presentation | 75 | 0 |  |  |  |
| `presentationmode/projection.js` | App.presentationMode.projection | presentation-mode | application | 191 | 9 |  |  |  |
| `presentationmode/runtime.js` | App.presentationMode.runtime | presentation-mode | application | 245 | 3 |  |  |  |
| `pricing/priceHistory.js` | App.priceHistory | pricing | domain | 548 | 3 |  |  |  |
| `privacy/deviceData.js` | App.privacy.device | privacy | application | 114 | 2 | sim |  |  |
| `privacy/privacyCore.js` | App.privacy.core | privacy | application | 395 | 2 |  |  |  |
| `privacy/privacyView.js` | App.privacyView | privacy | presentation | 47 | 0 |  |  |  |
| `privacy/privacyWorkflow.js` | App.privacy.workflow | privacy | application | 381 | 2 |  |  |  |
| `provenance/legacyProvenance.js` | App.provenanceMigration | provenance | application | 83 | 9 |  |  |  |
| `provenance/provenanceModel.js` | App.provenance | provenance | domain | 278 | 4 |  |  |  |
| `provenance/provenanceServices.js` | App.provenanceServices | provenance | application | 405 | 6 |  |  |  |
| `pwa/connectivity.js` | App.pwa.connectivity | pwa | infrastructure | 106 | 0 |  |  |  |
| `pwa/offlinePack.js` | App.pwa.pack | pwa | infrastructure | 474 | 7 | sim | sim |  |
| `pwa/pwaCore.js` | App.pwa.core | pwa | infrastructure | 250 | 1 | sim |  |  |
| `pwa/pwaView.js` | App.pwaView | pwa | presentation | 104 | 2 |  |  |  |
| `pwa/swRouting.js` | App.pwa.routing | pwa | infrastructure | 134 | 0 |  |  |  |
| `pwa/sync.js` | App.pwa.sync | pwa | infrastructure | 196 | 1 | sim |  |  |
| `pwa/update.js` | App.pwa.update | pwa | infrastructure | 167 | 1 |  |  | sim |
| `pwa/webManifest.js` | App.pwa.webManifest | pwa | infrastructure | 70 | 0 |  |  |  |
| `quickview/quickview.js` | App.quickView | quickview | application | 191 | 11 |  |  |  |
| `rules/alertDomain.js` | App.alerts | rules | domain | 255 | 4 |  |  |  |
| `rules/legacyAlertMigration.js` | App.alertMigration | rules | application | 169 | 4 |  |  |  |
| `rules/ruleCore.js` | App.ruleEngine | rules | domain | 521 | 8 |  |  |  |
| `security/authorization.js` | App.authz | security | application | 462 | 4 |  |  |  |
| `security/hardening.js` | App.securityHardening | security | application | 499 | 2 |  |  |  |
| `security/organization.js` | App.tenancy | security | domain | 155 | 1 |  |  |  |
| `security/permissions.js` | App.permissions | security | domain | 89 | 0 |  |  |  |
| `services/comparison.js` | App.services.comparison | comparison | application | 24 | 1 |  |  |  |
| `services/finance.js` | App.services.finance | financial | domain | 48 | 0 |  |  |  |
| `services/finding.js` | App.services.search, App.services.filtering, App.services.recommendation | filters | application | 87 | 3 |  |  |  |
| `services/layers.js` | App.services.layers | map | application | 104 | 4 |  |  |  |
| `services/scoring.js` | App.services.scoring | analysis | application | 26 | 1 |  |  |  |
| `services/share.js` | App.services.share | share | application | 14 | 0 |  |  |  |
| `services/solar.js` | App.services.solar | solar | domain | 47 | 0 |  |  |  |
| `share/shareDomain.js` | App.share.domain | share | domain | 305 | 2 |  |  |  |
| `share/shareService.js` | App.share.service | share | application | 308 | 2 |  |  |  |
| `share/sharedShellView.js` | App.sharedShellView | share | presentation | 39 | 2 |  |  |  |
| `state/selectors.js` | App.selectors | workspace | application | 84 | 6 |  |  |  |
| `state/store.js` | App.store, App.router | workspace | application | 154 | 3 | sim |  |  |
| `surroundings/surroundingsClient.js` | App.surroundings.client | surroundings | infrastructure | 192 | 2 |  |  |  |
| `surroundings/surroundingsDomain.js` | App.surroundings.domain | surroundings | domain | 333 | 1 |  |  |  |
| `surroundings/surroundingsView.js` | App.surroundingsView | surroundings | presentation | 92 | 2 |  |  |  |
| `sw.template.js` | — | pwa | worker | 162 | 0 | sim | sim |  |
| `utils/formatters.js` | App.fmt | shared | shared | 37 | 1 |  |  |  |
| `utils/i18n.js` | App.i18n | shared | shared | 59 | 0 |  |  |  |
| `versioning/analysisVersioning.js` | App.versioning | analysis | application | 448 | 5 |  |  |  |

## Backend (`plat/backend`)

Node + PostgreSQL, monolito modular: `src/modules/{analysis, assets, availability, commercial, developments, iam, imports, lots, pricing-history, share, tenancy}` sobre `src/shared/{config, contracts, db, domain, http, logging, validation}`; migrations `001`–`009` com scripts `down`; contrato OpenAPI 1.3.0 (`backend/docs/openapi.json`). Os testes de banco não rodam neste ambiente (sem senha do Postgres).
