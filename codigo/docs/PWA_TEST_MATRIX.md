# Matriz de testes PWA

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

| Área (§326–§344) | Onde | Como |
|---|---|---|
| Registro de capacidades | tests/pwa.test.js | evaluate/validateRegistry |
| Manifest (válido, ícones, escopo, start_url, standalone) | pwa.test.js + pwa.e2e.js | validateWebManifest + CDP Page.getAppManifest |
| Classificador + projeção de política | pwa.test.js | classify / swPolicies |
| Ciclo do worker (install, falha, activate, mensagens) | pwa.test.js | sw.js gerado rodando em vm com Cache Storage falso |
| App shell offline, API sem HTML, asset 404, share | pwa.test.js + pwa.e2e.js | vm + Chromium com o host derrubado |
| Pacote (BASIC, STANDARD, FULL_MAP/PARTIAL, interrupção, checksum, cota, delta, remoção) | pwa.test.js | MemoryPackStore + rede falsa |
| Pacote real (Cache Storage, leitura pelo worker) | pwa.e2e.js | prepare STANDARD + fetch offline com cabeçalho x-ws-offline-pack |
| Mapa offline (geometria, busca, QuickView, disponibilidade, preço) | pwa.test.js + pwa.e2e.js | packRemote + HybridLotSource; boot offline real |
| Mutações (negadas, favorito, idempotência, conflito, isolamento) | pwa.test.js | SyncCoordinator + IndexedDB falso |
| Conectividade (offline, backend fora com navegador online, histerese, reconexão) | pwa.test.js | relógio falso |
| Multi-tenant e segurança (org A×B, revogação, logout, tokens) | pwa.test.js | |
| Atualização + fila pendente | pwa.test.js + pwa.e2e.js | coordenador com worker falso; build A → B real |
| Navegadores sem SW / sem Background Sync / sem prompt | pwa.test.js | detectCapabilities com window falso |

## Cenários de ouro (§345) — todos em tests/pwa.test.js
`PwaFirstInstall` · `PwaAppShellOfflineBoot` · `PwaNoOfflinePack` · `PwaPrepareBasicDevelopmentPack` · `PwaPrepareStandardDevelopmentPack` · `PwaOfflineMapBrowse` · `PwaOfflineLotSearch` · `PwaOfflineLotQuickView` · `PwaOfflineAvailabilityLastKnown` · `PwaOfflinePriceVersion` · `PwaOfflineReservationDenied` · `PwaOfflineFavoriteQueued` · `PwaSyncFavoriteOnReconnect` · `PwaSyncConflictReview` · `PwaTenantSwitchIsolation` · `PwaLogoutSensitivePurge` · `PwaOfflinePackRefreshDelta` · `PwaPackInterruptedDownloadRollback` · `PwaPackChecksumFailureRollback` · `PwaStorageQuotaInsufficient` · `PwaServiceWorkerUpdateWaiting` · `PwaSafeUpdateActivation` · `PwaUpdateWithPendingMutations` · `PwaBrowserWithoutBackgroundSync` · `PwaBrowserWithoutServiceWorker` · `PwaSharedRouteNotAvailableOffline` · `PwaPresentationOfflinePack` · `PwaFinancialOfflineWarning` · `PwaDeepLinkOfflineAvailable` · `PwaDeepLinkOfflineUnavailable` · `PwaAccessRevokedOnReconnect`

## Como rodar
- Unitários/integração: `cd plat/tests && node --test pwa.test.js` (30 testes).
- Navegador: `node scripts/build.js` e depois `cd plat/tests && NODE_PATH=$(npm root -g) node pwa.e2e.js <dash> <pasta-temporária>` (19 verificações; o host é derrubado para simular offline, porque `setOffline` do Chromium não cobre as requisições do worker).
