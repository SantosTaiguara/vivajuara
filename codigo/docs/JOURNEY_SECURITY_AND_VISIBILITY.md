# Segurança e visibilidade da jornada (Tópico 40)

## Decisão de acesso (`decideAccess`)

Tenant AND Permissão AND Atribuição AND Lifecycle (AND política de transição na mudança de etapa).

| Permissão | Nível |
|---|---|
| `journey.read` | MANAGER (organização) |
| `journey.read` + `journey.technical.read` | TECHNICAL |
| `journey.readAssigned` + atribuição da jornada ou do cliente (não VIEWER) | BROKER |
| outra organização / sem permissão | NOT_FOUND / NO_GRANT |

Escrita: `canTransition` (`journey.transition`, jornada ACTIVE), `canClose` (`journey.close`), `canRecord` (`journey.timeline.record`, jornada aberta). Override: `journey.overrideTransition`. Chaves usadas: `journey.read`, `journey.readAssigned`, `journey.create`, `journey.update`, `journey.transition`, `journey.overrideTransition`, `journey.pause`, `journey.close`, `journey.timeline.read`, `journey.timeline.record`, `journey.nextAction.manage`, `journey.technical.read`. **Não registradas** em `config/security/permissions.json`: negadas até o registro (deny by default) — no modo estático a jornada fica indisponível (`journeyPanel({ available: false })`).

## Projeções

SUMMARY (lista/contexto), BROKER, MANAGER, CLIENT_SAFE (subset para apresentação/portal: só eventos client-safe, sem ator, sem notas), TECHNICAL (ids, revisões, idempotência, payload). Pedido TECHNICAL sem permissão é rebaixado. Board e lista usam só resumos (nome de exibição vem da projeção SUMMARY do Customer; nunca telefone/e-mail). Consultas filtram por organização e visibilidade antes de ordenar (não buscam tudo para esconder no cliente — no backend isso deve ser server-side).

## Privacidade

Eventos, conflitos, links e auditoria sem PII; notas de transição recusam dados de contato; nada de mensagens completas, gravações ou documentos. Logs: `{ action, journeyId, status, codes }`.

## Offline

`offlinePolicy`: sem cache de resumo/timeline/ações; sem fila offline de touchpoint; transição e resultado exigem conexão. Logout/troca de organização: `JourneyStore.clear()` e contexto ativo limpo.

## Receita de UI

- Aba Jornada: `App.customerView.journeyPanel({ available, summary, timeline, allowedMoves, suggestions, revision, canCreate })` com dados de `svc.application.get(journeyId)`. Botões: `jnyOpen`, `jnyMove` (data-to, data-rev), `jnyNextDone` (data-id, data-rev), `jnyTouch`.
- Chip no mapa: `App.journey.domain.contextChip(customerSummary, journeySummary)` → "Maria · Negociação".
- QuickView: `App.customerView.optionPresentedButton(lotId, canRecord)` → `jnyOption`.
