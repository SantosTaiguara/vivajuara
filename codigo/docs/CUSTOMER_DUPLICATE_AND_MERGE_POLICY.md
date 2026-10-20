# Duplicidade e merge (Tópico 39)

## Detecção (`detectDuplicates`) — padrão `SUGGEST_ONLY`

Só dentro da mesma organização; ignora `MERGED`/`DELETED` e contatos `REVOKED`.

| Sinal | Força | Observação |
|---|---|---|
| `SAME_NORMALIZED_PHONE` | forte | telefone e WhatsApp comparados em E.164; pode ser de família/empresa |
| `SAME_NORMALIZED_EMAIL` | forte | comparação sem diferenciar maiúsculas |
| `SAME_EXTERNAL_REF` | forte | mesmo provider + externalId |
| `SIMILAR_NAME` | fraca | similaridade por tokens ≥ 0,8 (aceita iniciais: "Maria S." ~ "Maria Souza") |
| `SAME_NAME_AND_CONTACT_FRAGMENT` | média | nome parecido + mesmos 4 últimos dígitos |

Candidato: `{ id determinístico, customerIdA, customerIdB, matchSignals, status OPEN, action SUGGEST_ONLY }`. Nada é unido automaticamente. Pares revisados (`NOT_DUPLICATE`/`CONFIRMED_DUPLICATE`) não são reabertos.

## Merge (`merge(cmd, world)`)

`CustomerMergeCommand { sourceCustomerIds, targetCustomerId, expectedRevisions, fieldDecisions, reasonCode, idempotencyKey }`.

- Revisão esperada de cada registro; divergência → `CUSTOMER_REVISION_CONFLICT`.
- Mesma organização; origem ≠ destino; nenhum `MERGED`/`DELETED`.
- Perfis: se alguma origem tem perfil, exige decisão `preferenceProfile` = `KEEP_TARGET` | `ADOPT_SOURCE:<id>` | `NEW_VERSION` (não soma, não faz média, não escolhe o mais novo).
- CRM: mesmo provider com externalId diferente exige decisão `externalRefs.<provider>` (`SOURCE:<id>` | `KEEP_BOTH` | manter destino).
- Preserva: contatos (copiados ao destino com `mergedFromCustomerId`; primário do destino mantido), external refs, atribuições, favoritos de contexto CUSTOMER (`originalContextRef`), versões de perfil (não reescritas), snapshots e recomendações históricas (não tocados).
- Aliases: cada origem → destino; aliases antigos que apontavam para a origem passam a apontar para o destino (sem cadeias). `resolveAlias` resolve até o final.
- `CustomerMergeRecord` com decisões, autor, data, motivo e contagens preservadas. Repetir o mesmo `idempotencyKey` devolve o registro (`replay`).
- Evento `CustomerMerged` (ids e motivo).

## Varredura da base atual

A base legada (`state.customers`) só tem nome e lotes; a varredura na migração encontra apenas sugestões por nome (fracas). Nenhum merge é feito na migração.
