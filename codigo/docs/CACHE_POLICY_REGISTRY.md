# Registro de políticas de cache (Tópico 48)

`POLICIES` / `getPolicy(type)` em cacheCore.js. Tipo desconhecido → **NO_CACHE** (deny by default). `validateRegistry()` falha se um tipo RESTRICTED/SENSITIVE for persistido.

| Tipo | Estratégia | Persistência | Uso de cópia antiga |
|---|---|---|---|
| APP_SHELL | NETWORK_FIRST | Cache Storage (SW) | offline |
| DEVELOPMENT_CONFIG | IMMUTABLE_VERSIONED | embutido no index.html | — |
| MAP_BOOTSTRAP (manifest) | NETWORK_FIRST, soft 0, hard 30 dias | IndexedDB | offline |
| GEOMETRY_BUNDLE, MAP_LOT_INDEX, LAYER_VALUES, ANALYSIS_VERSION | IMMUTABLE_VERSIONED (checksum) | IndexedDB | sim (versão é a chave) |
| PRICING_SNAPSHOT | NETWORK_FIRST, soft 0, hard = decisão de negócio | IndexedDB | VIEW, SIMULATE — rótulo PRICE |
| AVAILABILITY_SNAPSHOT | NETWORK_FIRST, soft 0 | IndexedDB | VIEW apenas — rótulo AVAILABILITY |
| BASE_MAP_LOW/MEDIUM/HIGH | IMMUTABLE_VERSIONED (`?v=<checksum>`) | Cache Storage (AssetCache) | sim; HIGH sai primeiro sob cota |
| TECHNICAL_ANALYSIS_INPUT | IMMUTABLE_VERSIONED | só memória (persistir: tópico 49) | sim |
| MOBILITY_ROUTES, GALLERY_INDEX | NETWORK_FIRST | Cache Storage (SW) | offline |
| GALLERY_IMAGE | IMMUTABLE_VERSIONED | Cache Storage (SW runtime) | sim |
| SPATIAL_INDEX, SEARCH_INDEX | MEMORY_ONLY (regenerável) | não | — |
| LOT_QUICK_VIEW, LOT_DETAIL_SECTION, LOT_PRICE_HISTORY | MEMORY_ONLY, exige versão igual | não | — |
| PERMISSIONS, ORGANIZATION_CONTEXT | MEMORY_ONLY, TTL curto | não | autorização continua no servidor |
| Cliente, jornada, recomendação, comparação, share | MEMORY_ONLY (USER / CUSTOMER_CONTEXT / SHARE_SESSION) | não | não |
| AUTH_TOKEN | NO_CACHE | nunca | — |
