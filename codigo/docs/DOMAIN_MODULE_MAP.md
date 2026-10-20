# Mapa de módulos por bounded context

> Documento gerado por `node scripts/governanceDocs.js` a partir de `config/governance/architecture.json`. Não editar à mão: altere a fonte e gere de novo.

Cada bounded context agrupa os módulos que são donos de um conceito. Um contexto pode ter módulos em várias camadas (domínio puro, aplicação, infraestrutura, apresentação).

| Contexto | Domínio | Aplicação | Infraestrutura | Apresentação/composição | Outros |
|---|---|---|---|---|---|
| **admin-shell** |  |  |  | `admin/adminApp.js` |  |
| **analysis** | `domain/rules.js`<br>`intelligence/engine.js`<br>`intelligence/math.js`<br>`intelligence/methodology.js`<br>`intelligence/normalization.js`<br>`intelligence/textAdapter.js` | `services/scoring.js`<br>`versioning/analysisVersioning.js` |  |  |  |
| **analytics** | `analytics/privacy.js`<br>`analytics/registry.js`<br>`analytics/semantic.js` | `analytics/early.js`<br>`analytics/facade.js` | `analytics/client.js` | `analytics/metricsView.js` |  |
| **availability** | `domain/availability.js` |  |  |  |  |
| **backoffice** |  | `backoffice/backofficeAdapters.js`<br>`backoffice/backofficeCommands.js`<br>`backoffice/backofficeCore.js`<br>`backoffice/backofficeGovernance.js` |  | `backoffice/backofficeView.js` | `config/backoffice/backofficeConfig.js` |
| **cache** |  |  | `cache/cacheCore.js`<br>`cache/cacheManager.js` |  |  |
| **comparison** | `compare/comparisonDomain.js`<br>`compare/criterionWinner.js` | `services/comparison.js` |  |  |  |
| **confidence** | `confidence/confidenceEngine.js` | `confidence/confidenceServices.js` |  |  |  |
| **customer** | `customer/customerDomain.js` | `customer/customerContext.js`<br>`customer/customerRepository.js` |  | `customer/customerView.js` |  |
| **data-access** |  |  | `data/apiSource.js`<br>`data/legacyAdapter.js`<br>`data/offline.js`<br>`data/repositories.js` |  |  |
| **data-quality** |  | `dataquality/dqEngine.js`<br>`dataquality/dqModel.js`<br>`dataquality/dqWorkflow.js` |  | `dataquality/dqView.js` |  |
| **data-state** | `datastate/dataState.js` |  |  |  |  |
| **deals** | `deals/dealsDomain.js` |  |  | `deals/dealsView.js` |  |
| **decision** | `decision/decisionDomain.js` | `decision/decisionServices.js` |  | `decision/decisionView.js` |  |
| **development** |  |  |  |  | `config/developments.js`<br>`config/presentation.js` |
| **documents** | `documents/documentDomain.js` | `documents/documentServices.js` |  |  |  |
| **favorites** |  | `favorites/favorites.js` |  |  |  |
| **filters** | `filters/filters.js` | `services/finding.js` |  |  |  |
| **financial** | `services/finance.js` |  |  |  |  |
| **governance** |  |  |  |  | `governance/architectureConformance.js`<br>`governance/capabilityRegistry.js`<br>`governance/goldenBaseline.js`<br>`governance/roadmap.js` |
| **journey** | `journey/journeyDomain.js` | `journey/journeyServices.js` |  |  |  |
| **kernel** |  |  |  |  | `prelude.js` |
| **loading** |  |  | `loading/coordinator.js`<br>`loading/planner.js`<br>`loading/resources.js` | `loading/chunkLoader.js`<br>`loading/loadingView.js` |  |
| **lot** | `data/lifecycle.js`<br>`domain/enums.js`<br>`domain/lot.js`<br>`domain/model.js` |  |  |  |  |
| **map** | `geo/camera.js`<br>`geo/geometry.js`<br>`geo/hitTest.js`<br>`geo/spatialIndex.js`<br>`map/layers.js`<br>`map/legend.js` | `services/layers.js` | `geo/perf.js`<br>`geo/repository.js` |  |  |
| **navigation** | `deeplink/linkStateCodec.js`<br>`navigation/navigationRegistry.js` | `deeplink/linkRestoration.js`<br>`navigation/navigationService.js` |  | `navigation/menuView.js` |  |
| **observability** |  |  | `observability/obsCore.js`<br>`observability/obsPlatform.js`<br>`observability/obsSignals.js` |  |  |
| **onboarding** | `onboarding/canonical.js`<br>`onboarding/commercialImport.js`<br>`onboarding/geometryIngest.js`<br>`onboarding/mapping.js`<br>`onboarding/onboardingModel.js`<br>`onboarding/publication.js`<br>`onboarding/quality.js` | `onboarding/orchestrator.js`<br>`onboarding/parsers.js`<br>`onboarding/sourceIntake.js` |  | `onboarding/onboardingView.js` | `config/onboarding/onboardingPolicy.js` |
| **presentation-mode** | `presentationmode/domain.js`<br>`presentationmode/policy.js` | `presentationmode/projection.js`<br>`presentationmode/runtime.js` |  | `presentationmode/presentationView.js` |  |
| **pricing** | `pricing/priceHistory.js` |  |  |  |  |
| **privacy** |  | `privacy/deviceData.js`<br>`privacy/privacyCore.js`<br>`privacy/privacyWorkflow.js` |  | `privacy/privacyView.js` |  |
| **provenance** | `provenance/provenanceModel.js` | `provenance/legacyProvenance.js`<br>`provenance/provenanceServices.js` |  |  |  |
| **pwa** |  |  | `pwa/connectivity.js`<br>`pwa/offlinePack.js`<br>`pwa/pwaCore.js`<br>`pwa/swRouting.js`<br>`pwa/sync.js`<br>`pwa/update.js`<br>`pwa/webManifest.js` | `pwa/pwaView.js` | `sw.template.js` |
| **quickview** |  | `quickview/quickview.js` |  |  |  |
| **recommendation** | `intelligence/explanation.js`<br>`intelligence/fit.js`<br>`intelligence/reasonCodes.js`<br>`intelligence/recommendation.js` |  |  |  |  |
| **rules** | `rules/alertDomain.js`<br>`rules/ruleCore.js` | `rules/legacyAlertMigration.js` |  |  |  |
| **security** | `security/organization.js`<br>`security/permissions.js` | `security/authorization.js`<br>`security/hardening.js` |  |  |  |
| **share** | `share/shareDomain.js` | `services/share.js`<br>`share/shareService.js` |  | `share/sharedShellView.js` |  |
| **shared** |  |  |  |  | `documents/integrity.js`<br>`utils/formatters.js`<br>`utils/i18n.js` |
| **solar** | `services/solar.js` |  |  |  |  |
| **surroundings** | `surroundings/surroundingsDomain.js` |  | `surroundings/surroundingsClient.js` | `surroundings/surroundingsView.js` | `config/surroundings/surroundings.config.js` |
| **workspace** |  | `layout/responsiveProfile.js`<br>`layout/shortcuts.js`<br>`layout/workspace.js`<br>`mobile/sheet.js`<br>`presentation/viewmodels.js`<br>`state/selectors.js`<br>`state/store.js` |  | `presentation/app.js`<br>`presentation/compareView.js`<br>`presentation/dataTrustView.js`<br>`presentation/dom.js`<br>`presentation/favoritesView.js`<br>`presentation/map.js`<br>`presentation/overlays.js`<br>`presentation/panels.js`<br>`presentation/pricingView.js`<br>`presentation/securityView.js` |  |
