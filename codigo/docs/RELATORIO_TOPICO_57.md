# Relatório — Tópico 57: Proposta, Reserva, Negociação e Fechamento

> Isto não é orientação jurídica. Toda decisão comercial/jurídica não informada está modelada como `null` + "necessita confirmação", e a ação que depende dela é recusada com código estável.

## Entregue
- **Backend** `backend/src/modules/deals/`: domínio puro (`deals.domain.js`), política (`deals.policy.js`), repositório memória + PostgreSQL (`deals.repository.js`), serviço transacional/idempotente (`deals.service.js`), adaptador HTTP com 26 rotas e 24 permissões (`deals.controller.js`), gerador do fragmento OpenAPI (`deals.openapi.js` → `backend/docs/openapi.deals.json`).
- **Migração 011** (`backend/migrations/011_deals.sql` + `down/011_deals.down.sql`): 22 tabelas `deal_*`, índice único "uma reserva viva por lote", "um WON por fechamento", "um fechamento aberto por proposta", replay de webhook, triggers de imutabilidade e append-only.
- **Política** `config/deals/viva-juara.json`: 41 decisões `null`.
- **Frontend somente leitura** `src/deals/dealsDomain.js` (enums, códigos de erro, permissões, chips pt-BR, contagem regressiva pelo relógio do servidor, selo do lote sem identidade) e `src/deals/dealsView.js` (marcação escapada; visitante público vê '').
- **Docs**: 24 documentos da especificação + este relatório.

## Garantias testadas
Preço só da tabela vigente (R$ 1.196/m²; 250 m² = R$ 299.000,00); versão emitida imutável com snapshots de preço e disponibilidade; reserva atômica com `expectedAvailabilityRevision` + `Idempotency-Key` (`LOT_ALREADY_RESERVED`, `AVAILABILITY_REVISION_CONFLICT`, `LOT_AVAILABILITY_UNKNOWN`); concorrência com vencedor único; expiração pelo relógio do servidor (injetável), idempotente; aceitar ≠ reservar; WON nunca inferido; sem pagamento; sem cláusulas geradas; cross-tenant = 404 + evento de segurança; sem PII em logs/auditoria/outbox.

## Receita de integração (coordenador)
1. `scripts/build.js` UI: inserir `'deals/dealsDomain.js', 'deals/dealsView.js'` depois de `'decision/decisionView.js'`; `tests/harness.js` ORDER: `'deals/dealsDomain.js'` depois de `'decision/decisionServices.js'` (o view fica só no build).
2. `config/security/features.json`: data-acts `dealOpenProposal`, `dealOpenReservation`, `dealOpenClosing`, `dealRefresh` sob a feature `deals.panel` (permissões `proposal.read` OU `reservation.read` OU `closing.read`; negação: ocultar).
3. Backend: registrar as 24 chaves em `backend/src/modules/iam/permissions.js` só depois da decisão de roles (OWNER_ADMIN recebe automaticamente toda chave não-system). Em `app.js`: `const deals = createDealsService({ store: createPgDealsStore(pool, { App }), policies: createFilePolicyPort(), pricing, customers, signatureProviders: {} }); registerDealsRoutes(router, { deals });`, mesclar `backend/docs/openapi.deals.json` em `docs/openapi.json`, e agendar `deals.runExpiry({ organizationId })` (job do servidor).
4. Aplicar a migração 011 no ambiente com PostgreSQL e rodar a suíte com banco.
5. `tests/backoffice.test.js` (tópico 60) afirma que `reservation.release` e `sale.complete` ainda não estão registradas: com o tópico 57 elas passam a estar; remover essas duas chaves daquela lista.

## Decisões humanas em aberto (necessita confirmação)
Matriz de autoridade (7 domínios); fluxo (proposta antes da reserva etc.); política de concorrência de propostas; campos obrigatórios de submissão e idade máxima da disponibilidade; regras/alçadas de aprovação e separação de funções; duração máxima da reserva e regras de prorrogação; checklist de fechamento; condições de pronto-para-assinatura; definição de venda concluída (WON); disponibilidade após cancelamento; modelos de contrato aprovados pelo jurídico; provedor de assinatura; fuso horário comercial; quais roles recebem as 24 permissões.
