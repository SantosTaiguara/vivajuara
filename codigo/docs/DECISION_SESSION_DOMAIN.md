# Domínio DecisionSession

> Tópico 56 — Decisão comercial orientada ao cliente. Código: `src/decision/decisionDomain.js` (App.decision.domain), `src/decision/decisionServices.js` (App.decision.services), `src/decision/decisionView.js` (App.decisionView). Política: `config/decision/viva-juara.json` (v1.0.0). Testes: `tests/decision.test.js`.

- `startSession(tenant, { developmentId, context })` cria a sessão em `DRAFT`. Exige `decision.create` (negado por padrão).
- `attachResult(session, result)` liga o `recommendationResultId`; a primeira vez passa para `ACTIVE`. Um resultado novo nunca sobrescreve o anterior: o id antigo vai para `previousResultIds` e o histórico recebe `RECOMMENDATION_REFRESHED` com o motivo (`DecisionRefreshReason`).
- `transition(session, to, { reasonCode, expectedRevision })`: DRAFT, ACTIVE, SHORTLIST_READY, PRESENTED, CLOSED, ARCHIVED. Não há progressão forçada: o usuário pode voltar. ARCHIVED é final. Cada transição fica em `transitions` (`DecisionSessionTransition`).
- `CLOSED` aceita `outcome` (`DecisionOutcome`) e `selectedLotId`. Escolher um lote não é venda e não fecha a jornada.
- `revision` (texto) e `expectedRevision` dão concorrência otimista; conflito retorna `REVISION_CONFLICT`.
- `sameCustomer(session, context)`: trocar de cliente nunca reaproveita a sessão anterior ("Iniciar nova decisão para este cliente").
- `DecisionHistoryEvent`: estado mutável + histórico append-only dos eventos relevantes (não é event sourcing). Metadados sem nota, nome, orçamento ou contato.
- `DecisionSessionSnapshot` (`snapshot(session, result, { shortlist })`): referências de versão + lotes da seleção + checksum. Responde "por que este lote foi recomendado naquele momento".
- Repositório: `createRepository()` em memória, por organização, `persistent: false`. Nada vai para localStorage, IndexedDB ou URL.

Persistência no servidor (`DecisionSessionRepository` + endpoints `/api/v1/decisions`) fica como contrato: ver DECISION_MIGRATION_PLAN.md.
