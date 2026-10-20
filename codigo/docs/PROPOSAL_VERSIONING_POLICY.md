# Proposal Versioning Policy

> Tópico 57 — Proposta, Reserva, Negociação e Fechamento. Código: `backend/src/modules/deals/`, migração `011_deals.sql`, política `config/deals/viva-juara.json`. Isto não é orientação jurídica; todo valor de política não informado é `null` (**necessita confirmação**) e a ação dependente é recusada com código estável.

- Versão emitida é imutável (trigger `deal_proposal_version_immutable`; erro `PROPOSAL_VERSION_IMMUTABLE`).
- Cada versão guarda `pricingSnapshotRef` (`pricetable:<dev>:<tabela>@<versão>:<lote>`), `availabilitySnapshotRef` (`availability:<dev>:<lote>@r<rev>:<status>`), `checksum` e `supersedesVersionId`.
- Contraproposta = nova versão; `diffVersions` mostra a diferença campo a campo.
- Mudança da tabela depois da emissão aparece como `currentPriceOverlay.differsFromProposal`; a versão não muda.
- Aceite referencia `versionId` + `expectedVersionNumber` (`PROPOSAL_VERSION_CONFLICT`).
