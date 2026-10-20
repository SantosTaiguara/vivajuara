# Relatório de migração do legado — lazy loading (Tópico 47)

`LegacyLoadInventory` (resources.js) lista os carregamentos existentes e seu destino:

| Legado | Onde | Problema | Ação |
|---|---|---|---|
| manifest → lots → commercial em cascata | data/offline.js | 3 RTT seriais | **migrado**: prefetch paralelo |
| SyncManager no boot rebuscava manifest/commercial | data/offline.js | requisição duplicada | **migrado**: reuso < 30 s |
| planta.webp 3× | AssetCache | 3,8 MB desperdiçados | **migrado**: dedup in-flight |
| DataCache.invalidate por prefixo de string | data/lifecycle.js | invalidação errada entre empreendimentos | **migrado**: casamento por campos |
| fetch de analysis-input.json em app.js | presentation/app.js | sem dedup/cancelamento | **receita para o integrador** (passar pelo LoadCoordinator) |
| `<img>` da galeria | app.js | sem lazy/dimensões | **receita**: `imageAttrs` |
| JS inline de 2,25 MB | build | sem split | **decisão humana** |
