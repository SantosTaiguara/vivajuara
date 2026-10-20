# Commercial Permission Matrix

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

| Permissão | Risco | Descrição |
|---|---|---|
| `proposal.read` | MEDIUM | Ler propostas, versões e negociação (dados CONFIDENTIAL). |
| `proposal.create` | MEDIUM | Criar proposta (rascunho) a partir de cliente/lote/decisão. |
| `proposal.update_draft` | MEDIUM | Editar rascunho de proposta (expectedRevision). |
| `proposal.submit` | HIGH | Emitir/enviar proposta (versão imutável). |
| `proposal.withdraw` | HIGH | Registrar retirada de proposta (motivo). |
| `proposal.review` | MEDIUM | Colocar proposta em análise. |
| `proposal.counter` | HIGH | Emitir contraproposta (nova versão). |
| `proposal.accept` | HIGH | Registrar aceite de versão exata. |
| `proposal.reject` | HIGH | Recusar proposta (motivo). |
| `reservation.read` | MEDIUM | Ler reservas e quadro de reservas. |
| `reservation.create` | HIGH | Criar reserva atômica (expectedAvailabilityRevision + Idempotency-Key). |
| `reservation.extend` | HIGH | Estender reserva (política/aprovação). |
| `reservation.release` | HIGH | Liberar reserva (motivo). |
| `reservation.cancel` | HIGH | Cancelar reserva (administrativo). |
| `closing.read` | MEDIUM | Ler fechamento, checklist e prontidão. |
| `closing.manage` | HIGH | Abrir fechamento e registrar documentos recebidos. |
| `closing.validate_documents` | HIGH | Validar/recusar documentos e registrar confirmação manual. |
| `contract.generate` | HIGH | Gerar contrato a partir de modelo aprovado (sem cláusulas inferidas). |
| `contract.issue` | CRITICAL | Emitir versão imutável de contrato. |
| `signature.manage` | HIGH | Enviar contrato ao provedor de assinatura. |
| `sale.complete` | CRITICAL | Concluir venda (WON + lote SOLD, atômico). |
| `sale.cancel` | CRITICAL | Cancelar/registrar perda de negócio. |
| `commercial_approval.request` | MEDIUM | Pedir aprovação comercial (desconto, prazo, extensão). |
| `commercial_approval.decide` | HIGH | Decidir aprovação comercial (separação de funções por política). |

Nenhuma role recebe estas permissões (decisão humana pendente). Registradas em `config/security/permissions.json` e `docs/PERMISSION_REGISTRY.md`; no backend o adaptador `dealsPrincipal` filtra as concessões (hoje vazio para USER).

## Rotas
- `POST /api/v1/proposals → {"permission":"proposal.create","resource":null}`
- `GET /api/v1/proposals/:proposalId → {"permission":"proposal.read","resource":null}`
- `PATCH /api/v1/proposals/:proposalId/draft → {"permission":"proposal.update_draft","resource":null}`
- `POST /api/v1/proposals/:proposalId/submit → {"permission":"proposal.submit","resource":null}`
- `POST /api/v1/proposals/:proposalId/review → {"permission":"proposal.review","resource":null}`
- `POST /api/v1/proposals/:proposalId/counter → {"permission":"proposal.counter","resource":null}`
- `POST /api/v1/proposals/:proposalId/accept → {"permission":"proposal.accept","resource":null}`
- `POST /api/v1/proposals/:proposalId/reject → {"permission":"proposal.reject","resource":null}`
- `POST /api/v1/proposals/:proposalId/withdraw → {"permission":"proposal.withdraw","resource":null}`
- `POST /api/v1/proposals/:proposalId/approvals → {"permission":"commercial_approval.request","resource":null}`
- `POST /api/v1/commercial-approvals/:approvalId/decide → {"permission":"commercial_approval.decide","resource":null}`
- `GET /api/v1/proposals/:proposalId/presentation → {"permission":"proposal.read","resource":null}`
- `POST /api/v1/proposals/:proposalId/lost → {"permission":"sale.cancel","resource":null}`
- `POST /api/v1/reservations → {"permission":"reservation.create","resource":null}`
- `GET /api/v1/reservations/:reservationId → {"permission":"reservation.read","resource":null}`
- `POST /api/v1/reservations/:reservationId/extend → {"permission":"reservation.extend","resource":null}`
- `POST /api/v1/reservations/:reservationId/release → {"permission":"reservation.release","resource":null}`
- `POST /api/v1/reservations/:reservationId/cancel → {"permission":"reservation.cancel","resource":null}`
- `POST /api/v1/closing-cases → {"permission":"closing.manage","resource":null}`
- `GET /api/v1/closing-cases/:closingId → {"permission":"closing.read","resource":null}`
- `POST /api/v1/closing-cases/:closingId/checklist/:itemId/validate → {"permission":"closing.manage","resource":null}`
- `POST /api/v1/closing-cases/:closingId/contracts → {"permission":"contract.generate","resource":null}`
- `POST /api/v1/contracts/:contractId/issue → {"permission":"contract.issue","resource":null}`
- `POST /api/v1/contracts/:contractId/signature → {"permission":"signature.manage","resource":null}`
- `POST /api/v1/closing-cases/:closingId/complete → {"permission":"sale.complete","resource":null}`
- `POST /api/v1/closing-cases/:closingId/cancel → {"permission":"sale.cancel","resource":null}`
