# Preservação de contexto

| Política | preserveDevelopment | preserveSelectedLot | preserveCustomer | preserveComparison | preserveFilters | preserveMapLayer | preserveMapCamera |
|---|---|---|---|---|---|---|---|
| default | preserva | preserva | preserva | preserva | preserva | preserva | preserva |
| developmentSwitch | limpa | limpa | preserva | limpa | limpa | limpa | limpa |
| tenantSwitch | limpa | limpa | limpa | limpa | limpa | limpa | limpa |

- Transições entre workspaces (`default`): o plano só escreve `view`/`drawerOpen` → MAP → COMPARE → MAP mantém empreendimento, lote, comparação, filtros, camada, câmera e cliente (teste NavMapToComparePreservesSelection).
- CUSTOMERS → FIND → MAP mantém `currentCustomerId` (id opaco) e a recomendação contextual.
- Câmera do mapa: restaurada em retorno rápido pelo estado de sessão; não é deep link obrigatório.
- **Troca de empreendimento** (§68): validar acesso → limpar lote, comparação, filtros, camada e câmera → manter cliente e preferências globais seguras (modo, scoreKey…) → abrir MAP. Hoje a troca recarrega a página com `#<dev>` e o estado é salvo por empreendimento; `developmentSwitchPlan` é o contrato para a troca sem recarga.
- **Troca de organização**: limpa também clientes/favoritos/preferências do tenant (`tenantSwitchPlan`); `authz.switchOrganization` já devolve o patch do tópico 31.
- Layout (painéis, sheet, recolhimento do trilho) é estado separado e não entra em deep link.
