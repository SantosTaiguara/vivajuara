# Relatório de migração do legado — cache (Tópico 48)

`LegacyCacheInventory` (cacheCore.js):

| Legado | Situação | Ação |
|---|---|---|
| SW com regras fixas no código | migrado | regras geradas do registro (`__CACHE_RULES__`), comportamento idêntico + bypass Authorization/no-store |
| SW guardava respostas sem checar `private`/opacas | migrado | `storable()` |
| AssetCache sem dedup | migrado | `inflight` |
| DataCache.invalidate por prefixo | migrado | por campos (`meta`) |
| manifest sem checksum de analysis-input.json | migrado | asset adicionado (28) |
| `ws-cache` v1 sem organizationId | mantido | migração v2 adiada (decisão) |
| runtime `/img/` sem versão | mantido | tópico 49 |
| OFFLINE_CACHE_ARCHITECTURE.md | mantido | referência cruzada para CACHE_ARCHITECTURE.md |
