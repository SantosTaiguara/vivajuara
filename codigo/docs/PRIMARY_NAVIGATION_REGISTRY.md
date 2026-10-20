# Registro da navegação primária

| Ordem | id / routeCode | Rótulo (messageKey) | Ícone | Feature (features.json) | store.view | Celular | Desktop | Offline | Badge |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `MAP` | Mapa (`nav.map`) | map | `map.view` | map | BOTTOM_NAV | TOP_NAV | FULL (sem pacote: ONLINE_REQUIRED) | — |
| 2 | `FIND` | Encontrar (`nav.find`) | find | `map.view` | map + painel Encontrar | BOTTOM_NAV | TOP_NAV | FULL | — |
| 3 | `COMPARE` | Comparar (`nav.compare`) | compare | `lot.compare` | compare | BOTTOM_NAV | TOP_NAV | FULL | comparisonCandidates |
| 4 | `CUSTOMERS` | Clientes (`nav.customers`) | users | `customer.profile` | clients | BOTTOM_NAV | TOP_NAV | ONLINE_REQUIRED (local: FULL) | — |
| 5 | `DEVELOPMENT` | Empreendimento (`nav.development`) · curto: Empreend. | building | `development.info` | development | BOTTOM_NAV | TOP_NAV | LAST_KNOWN | — |

- `PrimaryNavItem`: `id, labelKey, iconId, routeCode, order, permission/feature, capability, badgeProviderId, mobilePlacement, desktopPlacement, enabled` (+ `view`, `panel`, `offline*`, `isDefault`).
- `NavigationRegistry.getPrimaryItems(context)` = `App.navigation.registry.getPrimaryItems(ctx)`; cada item sai com `state` (`VISIBLE_ENABLED | VISIBLE_DISABLED | HIDDEN`) e `disabledReason { code, messageKey, message }`.
- O menu **não é codificado em vários componentes**: `menuView` renderiza a partir do registro; o teste de contrato falha se faltar rota, rótulo, ícone, ordem única, feature conhecida, colocação válida ou rota no codec.
- Badge só para estado relevante: Comparar mostra a contagem de candidatos (0 = sem badge; 1 DRAFT; 2–4 READY; > 4 BLOCKED). Nenhum outro item tem badge (sem "Clientes 248", sem contagem de alertas).

## Checklist de promoção (§333)
Novo item primário só com resposta forte a: é workspace? tarefa independente? frequente? rótulo compreensível? útil em todos os dispositivos? não contextual? não só admin? não cabe num workspace existente? evidência de uso? vale a carga cognitiva? Alvo: ~5 itens (o contrato acusa `PRIMARY_MENU_OVERLOAD` acima de 5). Personalização do menu pelo usuário: não recomendada.
