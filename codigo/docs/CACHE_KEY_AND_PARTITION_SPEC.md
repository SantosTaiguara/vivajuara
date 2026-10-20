# Chave de cache e partição (Tópico 48)

`CacheKey = ResourceKey + CachePartitionKey + schemaVersion`, serializada `ck1|<rk1…>|<partição>|s<schema>`.

- **ResourceKey**: tenant (organizationId, developmentId), tipo, versão/fingerprint; nunca "current", nunca URL.
- **CachePartitionKey** (`makePartition`): `organizationId` obrigatório; `principalScope` (padrão ORGANIZATION; USER, CUSTOMER_CONTEXT e SHARE_SESSION exigem `principalId`); campos opcionais como revisão de permissão. `principalId` com aparência de token (`Bearer `, `eyJ…`, `tok_`, `sk_`, `st_`) é **rejeitado** (`TOKEN_IN_KEY`) — a partição usa identificador opaco, nunca a credencial.
- `sharePartitionRef(shareId)` gera referência hash; o ID do link nunca entra em claro na chave.
- `queryFingerprint(params)` canônico (ordenação de chaves, sem PII; parâmetros de cliente são rejeitados).
- `canonical()` + `hash()` (FNV 64 bits) → fingerprints estáveis entre abas e sessões.
- O `ws-cache` legado usa chaves sem organizationId; migração para v2 é decisão adiada (não alterado porque um teste fixa v1 com 6 stores).
