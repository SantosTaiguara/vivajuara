# Invalidação e índice de dependências (Tópico 48)

- `dependencyFingerprint(deps)` registra de quais versões um derivado foi construído (ex.: quick view ← geometria + preço + análise).
- `DEPENDENCY_INDEX` / `affectedBy(event)` → tipos afetados; `matchesSelector` é **estruturado** (tipo, tenant, versão), sem casamento por substring.
- `CacheManager.handleEvent(evt)`: VERSION_CHANGED, PRICE_TABLE_CHANGED, AVAILABILITY_CHANGED, PERMISSION_CHANGED, SHARE_REVOKED, LOGOUT, TENANT_SWITCH, PRIVACY_DELETION.
- Purgas: `logout()` (tudo que não é PUBLIC), `switchTenant()`, `permissionRevisionChanged()`, `shareRevoked(ref)`, `privacyDeletion(principal)`, `clearPartition(p)`.
- `DataCache.invalidate(kind, developmentId)` (lifecycle.js) agora compara campos guardados em `meta`, não prefixo — corrige invalidação cruzada entre empreendimentos com IDs que compartilham prefixo.
