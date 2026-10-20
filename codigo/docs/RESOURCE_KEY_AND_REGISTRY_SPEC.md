# ResourceKey e Resource Registry (Tópico 47)

## ResourceKey
```
{ organizationId, developmentId?, type: LoadResourceType, resourceId, version?, variant?, locale? }
```
Regras (`App.loading.resources.makeKey`):
- `organizationId` obrigatório (`TENANT_REQUIRED`). O mesmo `resourceId` em outra organização é **outro** recurso.
- `version` nunca é um ponteiro: `current`, `latest`, `head`, `*` → `POINTER_AS_VERSION`. O ponteiro é resolvido pelo manifest e a versão concreta entra na chave.
- URL física (`http:`, `blob:`, `data:`) não é identidade → `URL_AS_IDENTITY`. A URL vem de `descriptor.resolveUrl()`.
- Chave sem versão de um recurso versionado é um **pedido de ponteiro**: pode ser deduplicada em voo, mas nunca persistida como artefato (o cache recusa: `UNVERSIONED_NOT_PERSISTED`).

## Serialização canônica
`serializeResourceKey(key)` → `rk1|org|dev|type|resourceId|version|variant|locale`, ordem fixa, campos ausentes como `~`, valores escapados (`|` e `~` codificados) — entrada manipulada não colide com outra chave. `parseResourceKey` faz o caminho inverso. Usada por: dedup em voo, diagnóstico, CacheKey (Tópico 48), futuro manifest offline (Tópico 49).

## Tipos
Os 39 tipos sugeridos pela especificação + os reais da página: `APP_FONT`, `TECHNICAL_ANALYSIS_INPUT` (`analysis-input.json`), `MOBILITY_ROUTES` (`routes.json`), `GALLERY_INDEX` (`img_list.json`), `GALLERY_IMAGE`, `SERVICE_WORKER`, `AUTH_TOKEN` (declarado para o cache recusar), `PRICE_TABLE_VERSION`, `ANALYSIS_VERSION`.

## Descritores reais (Viva Juara)
| Tipo | Arquivo | Criticidade | Prioridade | Gatilho | Segurança | Versão |
|---|---|---|---|---|---|---|
| APP_SHELL | index.html | BOOT_BLOCKING | IMMEDIATE | APP_BOOT | PUBLIC_SAFE | hash do build |
| DEVELOPMENT_CONFIG / ORGANIZATION_CONTEXT / PERMISSIONS | embutidos | BOOT_BLOCKING | IMMEDIATE | APP_BOOT | PUBLIC_SAFE / AUTHENTICATED | build |
| MAP_BOOTSTRAP | manifest.json | ROUTE_BLOCKING | HIGH | ROUTE_ENTER | PUBLIC_SAFE | ponteiro |
| GEOMETRY_BUNDLE | lots.json (≈498 lotes, inclui índice, valores de camada e seções) | ROUTE_BLOCKING | HIGH | ROUTE_ENTER | PUBLIC_SAFE | `staticVersion+analysisVersion` |
| PRICING_SNAPSHOT | commercial.json | ROUTE_BLOCKING | HIGH | ROUTE_ENTER | PUBLIC_SAFE | ponteiro (rede primeiro) |
| AVAILABILITY_SNAPSHOT | anunciado por `manifest.availabilityPath` (hoje nenhum) | NON_BLOCKING | HIGH | ROUTE_ENTER | PUBLIC_SAFE | revisão |
| BASE_MAP_MEDIUM | planta.webp | NON_BLOCKING | HIGH | ROUTE_READY | PUBLIC_SAFE | checksum do manifest |
| BASE_MAP_HIGH | aerea.webp | NON_BLOCKING | NORMAL | USER_ACTION | PUBLIC_SAFE | checksum |
| LOT_QUICK_VIEW | composto em memória | INTERACTION_BLOCKING | IMMEDIATE | USER_ACTION | AUTHENTICATED | dependências |
| TECHNICAL_ANALYSIS_INPUT | analysis-input.json | OPTIONAL | HIGH | USER_ACTION | PUBLIC_SAFE | checksum (agora no manifest) |
| MOBILITY_ROUTES | routes.json | OPTIONAL | NORMAL | USER_ACTION | PUBLIC_SAFE | checksum |
| GALLERY_INDEX / GALLERY_IMAGE | img_list.json / img/* | OPTIONAL | NORMAL/LOW | USER_ACTION / NEAR_VIEWPORT | PUBLIC_SAFE | checksum |
| CUSTOMER_* / JOURNEY_* / RECOMMENDATION_* / PRESENTATION_SNAPSHOT | memória | ROUTE/NON_BLOCKING | — | ROUTE_ENTER | CUSTOMER_SENSITIVE | — |
| SHARE_RESOURCE / DOCUMENT_PREVIEW | memória | — | — | — | RESTRICTED | — |

`criticality` (bloqueia um estado de prontidão?) e `defaultPriority` (quem o scheduler atende primeiro?) são campos separados.

## Uso
```js
const reg = App.loading.resources.ResourceRegistry({ organizationId, developmentId, manifest, dev });
const d = reg.descriptor('TECHNICAL_ANALYSIS_INPUT', { version: checksum });
d.key; d.resolveUrl(); // 'analysis-input.json'
```
