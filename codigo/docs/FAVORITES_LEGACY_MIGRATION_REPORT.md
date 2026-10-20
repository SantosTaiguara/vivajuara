# Relatório de migração dos favoritos legados (Tópico 38)

## Implementação encontrada
- `store.js`: `favorites: []` em `INITIAL`, persistido em `prefs` de `ws:<dev>:state` (v3); versões anteriores: `ws-state` (v2, `s.favorites`) e `vj-favs` (primeiro dashboard, códigos curtos como `B79`).
- `sanitize()` resolve códigos curtos para LotId e **descarta** ids não resolvidos (perda silenciosa no comportamento antigo).
- Consumidores: `app.js` (`toggleFav`, `setMarks fav`, filtros), `panels.js` ("Só favoritos (n)"), `quickview.js` (`favorites: Set`), `filters.js` (`favoritesOnly`, `IN_USER_SET`, nunca na URL), `map/layers.js` (overlay `favorites`, contorno tracejado), `organization.js` (estado sensível ao tenant).
- Chaves que **não** são favoritos e não são migradas: `vj-sel` (lote atual), `comparisonLotIds`, `currentLotId`, `customers[].lotIds`.

## Alteração mínima em store.js
`restore()` guarda uma cópia do array bruto antes do `sanitize` (`App.store.restoredFavorites() → { ids, savedAt, developmentId }`). Aditivo; API antiga inalterada.

## LegacyFavoriteMigrationAdapter (`App.favorites.migrateLegacy`)
1. Lê, em ordem: array restaurado, `ws:<dev>:state#prefs.favorites`, `ws-state#s.favorites` (mesmo empreendimento), `vj-favs`.
2. Resolve cada ref com o `LotRepository.resolve` (id ou código curto, Tópico 6); remove duplicatas.
3. Cria favoritos PERSONAL com `source = MIGRATION`, `metadata.legacyRef/legacyKey/timestampSource` (`LEGACY_SAVED_AT` quando o estado v3 tinha `savedAt`, senão `MIGRATION_TIME`).
4. Ids não resolvidos → `UNRESOLVED_LEGACY_FAVORITE { legacyRef, sourceKey }`, mantidos no repositório (`unresolvedLegacy()`), contados em `diagnostics()`.
5. Marcador `favoriteMigrationVersion = 1` gravado **somente após** persistência bem-sucedida; segunda execução → `skipped` (sem duplicar no reload).

## Paridade
Teste: `['B79','Q99-L999','A1']` em `vj-favs` → store antigo fica com 2 ids (descarta Q99-L999); domínio migra 2 e reporta Q99-L999. Nenhum favorito local perdido.
Os dados reais do navegador dos usuários não estão disponíveis aqui; o relatório por aparelho sai de `migrateLegacy(...)` (migrated, alreadyFavorite, duplicates, unresolved, sources).
