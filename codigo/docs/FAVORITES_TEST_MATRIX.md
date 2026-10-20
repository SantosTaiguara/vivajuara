# Matriz de testes — favoritos (Tópico 38)

Arquivo: `tests/favorites.test.js` (22 testes). Cenários dourados do §566 nos nomes:

| # | Teste |
|---|---|
| 1 | PersonalFavoriteFromMap: FavoriteRecord ACTIVE with canonical lot id, tenant + user scope, source MAP, LOCAL_ONLY before a backend |
| 2 | PersonalFavoriteFromQuickView + idempotency: same lot/user/context → one active record; add twice, remove twice, idempotencyKey replay |
| 3 | CustomerFavoriteContext + SameLotPersonalAndCustomerFavorite: contexts coexist; contextRef is an opaque id (no PII); explicit copy |
| 4 | SESSION favorites are memory-only by default (never persisted) |
| 5 | FavoriteAddedToTwoCollections + remove from one: membership many-to-many; removing membership never unfavorites; archive keeps favorites |
| 6 | FavoriteRemovedButCollectionPreservedHistorically: live view hides removed favorites, historical view keeps them; manual reorder |
| 7 | FavoriteCollectionSnapshotShare: snapshot freezes membership and refs; share projection has no notes, no owner, no context ref |
| 8 | SoldLotRemainsFavorite / blocked / unknown availability / unknown price: favorite stays ACTIVE with the current status |
| 9 | FavoritePriceChanged / FavoriteAvailabilityChanged: change flags only against a captured baseline; never invented |
| 10 | orphaned lot: not silently deleted; reported as ENTITY_NOT_FOUND / ORPHANED |
| 11 | read models are batched (no N+1), sorted by current price with unknown LAST (topic 37), client projection hides notes/ids |
| 12 | favorite does not change Recommendation, Fit, Availability, winner or the canonical Lot; selection/comparison are not favorites |
| 13 | FavoriteLegacyMigration + FavoriteLegacyUnknownLot: legacy arrays (short codes and ids) → PERSONAL / MIGRATION; unknown ids reported, not lost; idempotent |
| 14 | migration marker only after a successful import: a failing backend keeps the migration pending |
| 15 | store.js keeps the legacy array API: restore captures the raw favorites before sanitize drops unknown ids → lossless migration; bindStore mirrors the projection |
| 16 | FavoriteOfflineAddAndSync / FavoriteOfflineRemoveAndSync: queued locally, replayed in order, SYNCED with server revision |
| 17 | sync conflicts: note on top of a newer server write is NOT overwritten (NOTE_NOTE / DELETE_UPDATE); toggles follow server order |
| 18 | replay only under the same principal; a server permission rejection marks the mutation FAILED (never applied to another account) |
| 19 | FavoriteTenantIsolation: same user in two organizations → separate namespaces; other users denied; tenant switch/logout leave no overlay |
| 20 | no PII and no notes in events; FavoriteSetProjection is light (ids only) and its cache key carries tenant/user/context/revision |
| 21 | backends: IndexedDB persists the namespace across service instances; localStorage-like fallback; pickBackend order |
| 22 | UI: star toggle is a persistent, accessible toggle; empty states; undo uses the existing "fav" action (re-add = restore same record) |

Cobertura §515–§565: identidade, contextos distintos, usuários e tenants distintos, add/remove idempotentes, restore, coleção (add, duplicado, remover,
arquivar), projeção viva após remoção, vendido/bloqueado/status desconhecido/preço desconhecido, preço atual muda, sobrevive a filtro/comparação/seleção,
overlay = conjunto de ids, cópia explícita para cliente, contexto arquivado, lote órfão, migração legada / id não resolvido / idempotente, offline add/remove
e reconexão, conflito de revisão e de nota, logout/troca de tenant, projeção de compartilhamento sem nota, snapshot vs coleção viva, ordenação por preço
com desconhecido no fim, filtro "Só favoritos", Recommendation/Fit/Availability/vencedor inalterados, permissão negada a outro usuário, coleção cross-tenant, batch sem N+1.
Não coberto: sincronização entre abas (não implementada), API backend real.
