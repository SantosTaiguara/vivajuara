# Política de Projeção Client-Safe

> Tópico 41 — Modo de apresentação. Implementação de referência no frontend (`src/presentationmode/`); persistência, auditoria e autorização definitivas são contratos de backend.

## Princípio: deny by default
`App.presentationMode.policy.current()` retorna a política `client-safe-41.1.0`. Um campo só aparece para o cliente se estiver na allow-list (`isAllowedPath`). Campo novo fica oculto até ser classificado. `derive()` só pode **restringir** a política e exige nova versão.

No painel atual, `config/presentation.js` agora aplica a mesma ideia: `clientDenyByDefault: true` + `clientSafeFields` (100 chaves = exatamente o que o modo cliente já exibia), antes da `hiddenFields`.

## O que é projetado
| Domínio | Regra |
|---|---|
| Identidade do lote | Código curto (ex.: `B79`), quadra, área. Nunca o ID interno (`VJ-Q…`). |
| Preço | Só `TABLE_PRICE`. Estados: `NOT_AVAILABLE`, `CONFLICTED` (sem valor), `CURRENT_WITH_CAVEAT`. Nunca preço negociado, desconto ou custo. |
| Disponibilidade | `AVAILABLE` só com dado FRESH e online; `UNKNOWN` → `STATUS_CONFIRMATION_REQUIRED`. Hoje os 498 lotes são UNKNOWN. |
| Compatibilidade | "Alta compatibilidade" só se fit ≥ `strongMatchFitScore` da política de recomendação; percentual apenas se a política permitir (`showFitPercent`, padrão desligado). |
| Razões | `App.reasonCodes.label(code,'client')`; código desconhecido é descartado. |
| Comparação | `App.compare.evaluation.highlights(ev,{audience:'presentation'})`; não recalcula vencedor. |
| Financeiro | Rótulo "Projeção"; aviso de IGP-M; sem total consolidado inventado. |
| Mapa | Camada primária do registro + campos `clientVisible` permitidos. |
| Cliente | `CustomerDisplayPolicy`: primeiro nome/nome preferido por padrão; nunca e-mail, telefone, CPF, notas, orçamento (salvo `showBudget` explícito). |

## Rótulos de dado
Cada valor sai com estado: confirmado / calculado / estimado / não disponível / necessita confirmação (via `App.vm.fieldVM`).

## Transformações
Somente as registradas em `TRANSFORMS` (`transform(id, v)`); id desconhecido → `null`. Sem expressões livres.

## Detector de vazamento (`scanPayload`)
Chaves internas (regex `INTERNAL_KEYS`) e padrões de valor: `PII_EMAIL`, `PII_CPF`, `PII_PHONE`, `TECHNICAL_PROVENANCE`, `INTERNAL_LOT_ID`, `UNSAFE_CLAIM` (valorização garantida etc.), `HTML_MARKUP`. Usado no preflight e no snapshot.
