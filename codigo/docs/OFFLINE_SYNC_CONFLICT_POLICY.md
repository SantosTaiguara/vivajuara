# Conflitos de sincronização

> Tópico 49 — PWA e experiência offline. Gerado/consolidado em 2026-10-12. Código: `src/pwa/*`, `src/sw.template.js`, `scripts/pwaBuild.js`, `scripts/cacheRules.js`.

Estados: NO_CONFLICT · AUTO_MERGED · USER_REVIEW_REQUIRED · REJECTED · EXPIRED. **Nunca last-write-wins genérico** (§119).

| Situação | Resultado |
|---|---|
| `baseVersion` ≠ versão atual do servidor (§365: base 12, servidor 14) | USER_REVIEW_REQUIRED — mantida na fila, as alterações seguintes da mesma entidade esperam |
| servidor responde CONFLICT | USER_REVIEW_REQUIRED |
| servidor responde DUPLICATE (mesma chave de idempotência) | concluída sem duplicar |
| permissão revogada | REJECTED (removida, informada) |
| `expiresAt` vencido | EXPIRED (removida, informada) |
| favorito SET/UNSET | estado final desejado (AUTO_MERGED implícito: o mais recente substitui o pendente) |

Texto ao usuário (§299): "Esta informação foi alterada no servidor enquanto você estava offline. Revise antes de continuar." Ações: "Descartar minha alteração" ou rebase explícito (`resolveConflict(id, 'REBASE_AND_RETRY')`). O payload técnico não é editável (§298). Risco comercial nunca resolvido em silêncio (§300).
