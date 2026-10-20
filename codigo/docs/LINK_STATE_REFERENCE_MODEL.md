# Modelo de referência de estado (stateRef)

Estado grande ou sensível vai para um `LinkStateReference` server-side; o URL leva só `?s=LS…`.

```ts
interface LinkStateReference {
  id: string;                 // 'LS' + 12 alfanuméricos aleatórios (não derivado de nada)
  organizationId: string;
  context: 'INTERNAL' | 'BOOKMARK';      // nunca SHARE_ENTRY/PUBLIC
  payload: LinkStatePayload;  // validado pelo LinkStateValidator (allowSensitive: customer/journey permitidos)
  schemaVersion: number;
  createdBy?: string; createdAt: string; expiresAt?: string;
  lifecycleStatus: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  checksum: string;           // FNV-1a do JSON canônico (referência; backend: SHA-256)
  accessPolicyRef?: 'OWNER_ONLY' | 'ORGANIZATION' | 'ASSIGNED_TEAM';
}
```

## Regras

* **stateRef não é ShareGrant** e não é bearer: leitura exige autenticação, mesmo tenant e `link.stateRef.read`; `OWNER_ONLY` é o padrão.
* Cross-tenant e id inexistente respondem igual (`NOT_FOUND`).
* Criar exige `link.stateRef.create` (nega por padrão); contexto externo → `STATE_REF_NOT_PUBLIC`.
* TTL por `LinkPersistenceClass` (proposta, decisão humana): EPHEMERAL 1 dia, SESSION 7 dias, BOOKMARK 180 dias. SHARE é do ShareService.
* Revogação: dono com `link.stateRef.revoke` (ou `link.stateRef.revoke.any`).

## Implementação

`App.deeplink.references.createService({ now, idGen })` é a referência **em memória** (testes e contrato). Não há backend nesta rodada (sem Postgres aqui): contrato da API

```
POST /api/v1/link-states            { context, route, payload, persistenceClass, access } → { id, expiresAt }
GET  /api/v1/link-states/{id}       → { id, context, payload, schemaVersion, expiresAt } | 404 | 403 | 410 (expirado/revogado)
POST /api/v1/link-states/{id}/revoke
```

Tabelas sugeridas: `link_state_references`, `saved_views` (opcional, não implementado: sem uso imediato), `link_schema_versions`. Nenhum endpoint público genérico de stateRef.

## Permissões

`link.internal.create`, `link.stateRef.create`, `link.stateRef.read`, `link.stateRef.revoke`, `savedView.create`, `savedView.shareTeam`. Compartilhamento externo continua em `share.issue`.

## Uso

* `LinkStateService.createLink` usa stateRef quando há branch sensível (cliente/jornada), quando o intent é `HANDOFF` (outro dispositivo) ou quando os filtros excedem o limite inline. Sem serviço de stateRef, o estado sensível é **omitido** (`SENSITIVE_STATE_OMITTED`) — nunca colocado inline.
