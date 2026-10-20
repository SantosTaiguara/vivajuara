# Proposal Domain

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

## Entidades
`Proposal` (cabeçalho, status, revisão) e `ProposalVersion` (termos estruturados, imutável). Status: DRAFT, SUBMITTED, UNDER_REVIEW, COUNTERED, ACCEPTED, REJECTED, EXPIRED, WITHDRAWN, CANCELLED.

## Regras
- Proposta transacional exige cliente persistido (`CUSTOMER_NOT_FOUND`).
- Preço vem apenas da tabela vigente (R$ 1.196/m², versão 2026-10-06): `pricing.listPriceMinor` é copiado da cotação; a oferta é um termo, não recalcula a tabela.
- Valores monetários em centavos inteiros; `null` nunca vira 0.
- Aceitar proposta **não** reserva o lote.
- Expirada: só nova versão/nova proposta (`PROPOSAL_EXPIRED`).
- Snapshot ao cliente (`presentationSnapshot`) sem notas internas, aprovações ou dados de outros clientes.
