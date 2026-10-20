# Alterações offline e sincronização

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

Sem fila genérica de POST; o worker nunca reenvia mutações de negócio. Tipo sem política → DENY_OFFLINE.

- QUEUE_IDEMPOTENT: estado final desejado (SET_FAVORITE / UNSET_FAVORITE); um UNSET substitui o SET pendente do mesmo lote; chave de idempotência evita duplicar no reenvio.
- QUEUE_WITH_REVALIDATION: desligado até o domínio aprovar; antes do commit compara `baseVersion` com a versão atual do servidor.
- LOCAL_ONLY: preferências locais e comparação local (LOCAL_OFFLINE_COMPARISON), nunca sincronizada como sessão do servidor.
- Hoje não há backend: sem transporte, a fila recusa com "Sincronização com o servidor ainda não está disponível; a alteração ficou só neste aparelho." (os favoritos continuam locais no módulo do tópico 39).

## SyncCoordinator
`enqueue · syncPending · getPending · discard · resolveConflict · attachTriggers · onLogout · pendingInfo`.
- Partição `organizationId|userId`: o usuário B não vê nem sincroniza a fila do usuário A (§186–§188).
- Antes de cada envio: autenticado, mesma organização/usuário, permissão presente, não expirado, versão revalidada (§183/§184).
- Mesma entidade em ordem; entidades independentes em paralelo; falha de rede mantém na fila.
- Sem Background Sync: reconexão (ConnectivityService), primeiro plano e "Tentar novamente" (§251, §371). Background Sync, quando existe, só acorda o app.
- Logout: pausa (padrão) ou descarta a fila sensível (§185). Segredos/tokens no payload são recusados (§108).
- Classificação (§131): ANALYTICS_BUFFER (tópico 45) ≠ OFFLINE_BUSINESS_MUTATION ≠ PWA_ASSET_UPDATE.

## Matriz
| Mutação | Modo | Ativa | Política de conflito | Expira (dias) |
|---|---|---|---|---|
| lot.reserve | DENY_OFFLINE | sim | — | — |
| proposal.submit | DENY_OFFLINE | sim | — | — |
| availability.change | DENY_OFFLINE | sim | — | — |
| price_table.publish | DENY_OFFLINE | sim | — | — |
| price.change | DENY_OFFLINE | sim | — | — |
| permission.change | DENY_OFFLINE | sim | — | — |
| share.create | DENY_OFFLINE | sim | — | — |
| share.revoke | DENY_OFFLINE | sim | — | — |
| journey.stage_change | DENY_OFFLINE | sim | — | — |
| customer.edit | DENY_OFFLINE | sim | — | — |
| favorite.set | QUEUE_IDEMPOTENT | sim | desired-final-state | 30 |
| favorite.unset | QUEUE_IDEMPOTENT | sim | desired-final-state | 30 |
| ui.preference | LOCAL_ONLY | sim | — | — |
| comparison.local | LOCAL_ONLY | sim | — | — |
| customer.note_draft | QUEUE_WITH_REVALIDATION | não (aguarda aprovação) | user-review | 3 |
| followup.complete_draft | QUEUE_WITH_REVALIDATION | não (aguarda aprovação) | user-review | 3 |
| presentation.feedback | QUEUE_WITH_REVALIDATION | não (aguarda aprovação) | snapshot-still-valid | 14 |
