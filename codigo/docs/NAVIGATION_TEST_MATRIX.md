# Matriz de testes da navegação

`tests/navigation.test.js` — 28 testes (node:test). Mais 28 checagens de navegador em `scratchpad/t53/func.js` sobre o preview com a receita aplicada.

| # | Teste |
|---|---|
| 1 | NavigationManifest is bundled and passes the navigation contract (routes, labels, order, icons, placements, permissions, codec routes) |
| 2 | the contract catches broken manifests (duplicate order, unknown feature, label used as route, 6th item, missing workspace) |
| 3 | information architecture: exactly 5 task-oriented primary items in the work order; Map is the default; labels pt-BR via message keys |
| 4 | NavUnauthorizedCustomersHidden + permission matrix by role templates (resolved through permissions, not role codes) |
| 5 | entitlement ≠ permission: an item needing an entitlement is hidden until the tenant has it (no ghost items §117) |
| 6 | NavAdminSectionsPermissionScoped: Empreendimento shows admin sections only with the permission; broker sees none; offline disables online-only |
| 7 | workspace sections match the tabs the shell renders today (customerView.TABS) and contextual actions match the QuickView action list |
| 8 | NavBrokerMobileBottomNav / NavTabletPortraitBottomNav / NavTabletLandscapeRail / desktop: one registry, placement by responsive profile |
| 9 | header overflow rules per profile: phones keep brand/development/search inline, the rest goes to "Mais"; desktop keeps mode/present/sync inline |
| 10 | the frozen legacy inventory matches the old shell header while it is still there |
| 11 | no feature loss: every legacy header control stays reachable in every layout profile (with and without a customer), and every reachable control exists in the new markup |
| 12 | feature-matrix integration: data-act="nav" variants map to the same features as the legacy data-act="view" (coordinator adds them to features.json) |
| 13 | NavBrokerDesktopDefaultMap: initial state → MAP current, no badge, workspace derived from the route (no separate menu state) |
| 14 | NavCompareBadgeThree: badge = candidate count (none at 0; DRAFT 1; READY 2–4; BLOCKED > 4) |
| 15 | NavMapToComparePreservesSelection: map → compare → map keeps development, lot, comparison, filters, layer, camera and customer |
| 16 | NavCustomerContextToFind: with a customer, Clientes → Encontrar → Mapa keeps the customer (opaque id) and the selection |
| 17 | NavFindResultToMap: "Ver no mapa" goes to the lot inside the Map workspace (no full page) |
| 18 | NavDevelopmentSwitchClearsIncompatibleState / NavTenantSwitchClearsTenantState |
| 19 | route guard: denied primary click stays and explains; deep link / history / permission change redirect safely to MAP; MAP denied → no loop |
| 20 | NavOfflineMapEnabled / NavOfflineCustomersOnlineRequired: offline states are explained, never shown as fully enabled |
| 21 | NavDeepLinkLotSelection / NavBackForwardRestoresWorkspace: the topic-43 codec is the only URL serializer; the workspace follows the restored state |
| 22 | PWA launch: last route restored only while still valid (authorized, development accessible); otherwise MAP |
| 23 | NavPresentationModeReducedNavigation / NavSharedRuntimeNoInternalNavigation / client & technical modes keep the five items |
| 24 | NavKeyboardPrimaryNavigation: G-sequences (g m, g e, g 3, g c, g 5), never while typing, with modifiers or after the timeout |
| 25 | NavScreenReaderActiveItem: landmark, aria-current target, decorative icons, full accessible labels, touch-sized targets declared |
| 26 | navigation.css is inert until the compact header is in the shell (every rule is scoped) |
| 27 | scripts/navHeader.js prints the header and its --check accepts the shell (old header until integration, or an identical compact header) |
| 28 | the reachability check has teeth: dropping an item or hiding a tool makes a legacy control unreachable |

## Cenários dourados (§252)
| Cenário | Coberto em |
|---|---|
| NavBrokerDesktopDefaultMap | NavBrokerDesktopDefaultMap… (node) + func.js "desktop default workspace MAP" |
| NavBrokerMobileBottomNav / NavTabletPortraitBottomNav / NavTabletLandscapeRail | placement por perfil (node) + after.js (5 larguras) |
| NavCompareBadgeThree | node + func.js "compare badge shows 3" |
| NavCustomerContextToFind | node + func.js (FIND no celular) |
| NavFindResultToMap | node |
| NavMapToComparePreservesSelection | node + func.js "map→compare→map preserves the selected lot" |
| NavDevelopmentSwitchClearsIncompatibleState / NavTenantSwitchClearsTenantState | node |
| NavUnauthorizedCustomersHidden / NavAdminSectionsPermissionScoped | node (8 papéis) |
| NavOfflineMapEnabled / NavOfflineCustomersOnlineRequired | node |
| NavDeepLinkLotSelection / NavBackForwardRestoresWorkspace | node (codec + restauração do tópico 43) |
| NavPresentationModeReducedNavigation / NavSharedRuntimeNoInternalNavigation | node + func.js "presentation mode hides…" |
| NavKeyboardPrimaryNavigation | node (sequências G) + func.js (setas, Home/End, g c, g m, g 3) |
| NavScreenReaderActiveItem | node (markup) + func.js (aria-current) |

Não automatizado aqui: contraste medido por ferramenta, leitores de tela reais, teste de usabilidade com corretores (§271).
