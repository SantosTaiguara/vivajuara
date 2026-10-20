# Contexto do cliente na interface (Tópico 39)

## ActiveCustomerContext

`App.customer.context.select(id, { source })` → `{ customerId, profileVersionId?, selectedAt?, source }` (CUSTOMER_LIST, SEARCH, DEEP_LINK, RECOMMENDATION, RESTORE). O store global continua guardando só `currentCustomerId` (`storePatch`). Compatível com `state.customers` e com `custPick`/`custClear` de `app.js`: os ids legados (`c` + base36) são opacos e viram os ids canônicos.

## Troca de cliente

- `switchPatch(st, nextId, { profileUi })` muda só `currentCustomerId`, `recScope` (recalculado) e as chaves de perfil do próprio cliente (`preferences`, `constraints`, `activePreset`, `objective`, como o `custPick` atual). Nunca toca `activeFilters`, `mapViewport`, `currentLotId`, camadas, favoritos pessoais nem a comparação (`PRESERVED_KEYS`).
- `guard(st, nextId, { comparison, recommendation, profileDirty, favoritesContextRef })` (CustomerContextGuard) não bloqueia o mapa; avisa `COMPARISON_BELONGS_TO_PREVIOUS_CUSTOMER`, `RECOMMENDATION_OF_PREVIOUS_CUSTOMER`, `UNSAVED_PROFILE_CHANGES`, `FAVORITES_IN_PREVIOUS_CONTEXT` e oferece "Manter a comparação do cliente anterior / Criar nova comparação / Copiar os lotes".
- "Sair do contexto do cliente": `exitPatch()` (mesmas chaves do `custClear` atual; filtros mantidos).
- Corrida Maria → João: `sequencer()`; a busca do serviço descarta respostas antigas (`superseded`).

## Rótulos

- Desktop: `headerLabel(summary)` → "Atendendo: Maria Souza"; mobile/tablet: chip "Maria"; com jornada: "Maria · Negociação" (`App.journey.domain.contextChip`). Nunca telefone/e-mail (um nome com aparência de telefone vira "Cliente").
- Fit contextual: `fitLabel` → "Compatibilidade para Maria" (camada de Fit sempre identifica o contexto).
- Favoritar: `favoriteLabel` → "Favoritar para Maria" (favorito pessoal continua separado).
- `useProfileLabel` = "Usar perfil para Encontrar": aplicar o perfil é ação explícita (cria escopo de recomendação; não altera filtros manuais).

## Deep link

Só `?customerId=<opaco>` (`parseDeepLink`, `buildDeepLink`); `phone`, `email`, `cpf`, `nome`… são rejeitados. A autorização é revalidada ao abrir. O roteador atual (`App.router.token`) não coloca cliente na URL (testado).

## Workspace

`App.customerView.tabs(active)`: Resumo · Jornada · Perfil · Favoritos · Comparações · Recomendações. `contextChip({ label })` com botão `custClear`. A aplicação continua centrada no mapa.

## Receita de integração (não aplicada: app.js/panels.js/overlays.js são de outro dono)

1. Header: trocar o texto de `#custBtn` por `App.customerView.contextChip({ label: App.customer.context.headerLabel({ displayName: cu.name }, device) })`.
2. `custPick`: antes do `store.set`, `const g = App.customer.context.guard(st, id, { comparison })`; se `g.warnings.length`, mostrar opções; depois `store.set(App.customer.context.switchPatch(st, id, { profileUi: App.customer.context.legacyProfileUi(c) }))`.
3. QuickView/legenda: usar `fitLabel`/`favoriteLabel` quando houver cliente.
4. Overlay "Clientes": `App.customerView.tabs(tab)` + painel conforme aba; aba Jornada: `App.customerView.journeyPanel(vm)` (ver `JOURNEY_SECURITY_AND_VISIBILITY.md`).
5. Logout/troca de organização: `store.set(App.customer.context.clearOnSessionChange(customerStore))`.
