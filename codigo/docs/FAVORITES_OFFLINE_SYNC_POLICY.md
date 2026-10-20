# Política offline e de sincronização de favoritos (Tópico 38)

## Persistência local
Namespace por `fav:v1:<organizationId>:<userId>:<developmentId>`. Backends com a mesma interface `load/save/remove`:
`idbBackend(indexedDB)` (preferido, store `ws-favorites/namespaces`), `storageBackend(localStorage)` (fallback pequeno), `memoryBackend()`
(modo privado). `pickBackend({ indexedDB, storage })` escolhe nessa ordem. A UI nunca acessa o armazenamento.
Favoritos funcionam sem rede; `syncState = LOCAL_ONLY` até existir servidor (`remote`); com remoto, PENDING_UPLOAD / PENDING_DELETE → SYNCED.

## Fila de mutações
`FavoritePendingMutation { id, idempotencyKey, organizationId, userId, command, createdAt, attemptCount, lastAttemptAt, status }`; comandos
AddFavorite, RemoveFavorite, RestoreFavorite, ArchiveFavorite, UpdateFavoriteNote, AddFavoriteToCollection, RemoveFavoriteFromCollection.
Reprodução em ordem; falha de rede interrompe e preserva a ordem para a próxima tentativa; replay só sob o mesmo principal
(`FAVORITE_USER_MISMATCH`); rejeição de permissão marca FAILED + syncState ERROR (nunca aplica em outra conta).

## Conflitos (`FavoriteSyncConflict`)
Decididos por revisão do servidor (`expectedServerRevision` = base vista pelo aparelho), nunca por relógio do cliente.
- ADD_REMOVE: outro aparelho mudou o ciclo de vida depois da base → vale a ordem do servidor; resolução `SERVER_REVISION` registrada.
- NOTE_NOTE / DELETE_UPDATE: nota sobre escrita mais nova do servidor → conflito aberto, nenhuma nota sobrescrita, mutação bloqueada até `resolveConflict(id, 'KEEP_LOCAL'|'KEEP_REMOTE')`.
- COLLECTION_MEMBERSHIP / CONTEXT_CHANGE: tipos catalogados; o servidor de referência ainda não os gera.
Sem CRDT (escala de 498 lotes). `createMemoryRemote()` é o servidor de referência em memória usado nos testes; a API real (§273–§286) é contrato.

## API futura (contrato)
`POST /api/v1/organizations/{orgId}/favorites`, `POST /favorites/{id}/remove`, `POST /favorites/{id}/restore`, `GET /favorites?developmentId&contextType&contextRef&collectionId&status`,
`GET|POST /favorite-collections`, `PATCH /favorite-collections/{id}`, `POST /favorite-collections/{id}/archive`, `POST|DELETE /favorite-collections/{id}/items[/{favoriteId}]`,
`POST /favorite-collections/{id}/reorder`. Respostas devolvem serverRevision. DTOs: FavoriteDto (= FavoriteRecord sem campos locais), FavoriteCollectionDto,
FavoriteListItemDto (= FavoriteListItemViewModel), FavoriteMutationResultDto `{ ok, favorite, code, serverRevision }`, FavoriteSyncResultDto `{ ok, sent, conflicts, failed }`.
Backend (Node + Postgres) não implementado neste tópico.

## Abas, logout, troca de tenant
`reload()` relê o namespace (base para sincronização entre abas via evento `storage`/BroadcastChannel — não ligado). Troca de tenant: criar
novo serviço e chamar `dispose()` no antigo (projeção zera, nenhuma mutação aceita). Logout: `dispose({ purge: true })` apaga o namespace do aparelho.
