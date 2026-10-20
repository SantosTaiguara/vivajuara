# Integração de favoritos na UI (Tópico 38)

## Compatibilidade imediata
`store.favorites` (array de LotIds) continua existindo: `App.favorites.bindStore(App.store, service)` o mantém igual à `FavoriteSetProjection`
do contexto ativo. Mapa (`setMarks({ fav })`, overlay tracejado), filtro "Só favoritos", Quick View (`favorites: Set`) e `toggleFav` do app.js
continuam funcionando sem alteração; escritas do app.js no array viram comandos add/remove (remoção soft).

## Receita para o app.js (lead)
1. Após `store.restore(devId)` e o carregamento dos lotes (`sanitize`):
   ```js
   const favSvc = App.favorites.createService({ organizationId, userId, developmentId: devId,
     backend: App.favorites.pickBackend({ indexedDB: window.indexedDB, storage: localStorage }),
     resolveLot: repo.resolve, resolveLots: ids => ids.map(repo.resolve), deviceId });
   await favSvc.ready;
   await App.favorites.migrateLegacy(favSvc, { restored: App.store.restoredFavorites(), storage: localStorage, resolveLot: repo.resolve });
   const favBridge = App.favorites.bindStore(App.store, favSvc);
   ```
   Sem login: `userId` = id local do aparelho (opaco), `organizationId` de `App.tenancy`.
2. `case 'fav'`: usar `a.dataset.id || lot.identity.id` e chamar `favSvc.toggle(id, { source })` (MAP / QUICK_VIEW / FULL_DETAILS); ao remover, mostrar `App.favoritesView.undoToast(id)`.
   Idem `case 'cmp'` com `data-id` para a lista de favoritos.
3. Painel/aba "Favoritos" (desktop: aba do painel esquerdo; mobile/tablet: bottom sheet): `App.favoritesView.list(favSvc.listItems({ context, sort }, { mode }).items, { context: favBridge.context(), client })`.
   Itens usam `data-act="goLot"` (localizar: selectLot + centralizar, mantém contexto), `cmp`, `fav`. Não adicionar item ao menu principal.
4. Botão estrela: `App.favoritesView.toggleButton({ lotId, isFavorite, contextLabel })` (☆ Favoritar / ★ Favoritado, aria-pressed).
5. Cliente ativo: mostrar `contextChip` e trocar com `favBridge.setContext({ type: 'CUSTOMER', ref: customerId, label: 'Favoritos de ' + nome })` só por ação explícita.
6. Troca de tenant / logout: `favBridge.unbind(); favSvc.dispose({ purge })`.
7. Campos com estado (Tópico 37): `App.favoritesView.dataValue(label, App.dataState.resolve(lot, path, { mode }))`.

## Ações novas a registrar em features.json (sugestão)
- `favCtx` → feature `lot.favorite` (trocar contexto).
- `favCollAdd`, `favCollNew` → nova feature `favorite.collections` (permissão `lot.view` enquanto device-local; futuramente `favorite.manageCollections`).
Os botões dessas ações não foram incluídos no HTML para não deixar ações sem contrato.

## Regras de UI
Toggle não cria entrada de histórico; abrir a seção pode. Seleção é mais forte que favorito no mapa (ordem: selecionado, comparação, recomendação, favorito, temático);
favorito não esconde status. Lote vendido continua na lista com "Vendido". Estado de sync só aparece quando relevante (`syncNotice`).
