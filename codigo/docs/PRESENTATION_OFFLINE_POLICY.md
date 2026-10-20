# Política Offline

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

`runtime.OFFLINE_POLICY` (padrão): `allowSnapshotCache:false`, `allowCustomerLabelCache:false`, `allowMapAssetsCache:true`, `allowFinancialDataCache:false`, `maxCacheAgeSeconds:null`, `clearOnLogout:true`.

- `offlineView(snapshot, {online, cached, policy, now})`: sem cópia autorizada → `OFFLINE_SNAPSHOT_NOT_CACHED`; cópia velha → `OFFLINE_CACHE_EXPIRED`; offline permitido → banner "Sem conexão: conteúdo preparado em …; disponibilidade e preço não podem ser confirmados agora."
- `liveFallback`: LIVE offline nunca finge dado atual; cai para snapshot (se permitido) ou bloqueia.
- Offline nunca afirma disponibilidade atual.
- `clearPrivateState` em logout/troca de tenant.
