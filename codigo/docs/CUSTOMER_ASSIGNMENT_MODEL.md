# Atribuição de clientes (Tópico 39)

`CustomerAssignment { id, organizationId, customerId, assigneeType USER|TEAM, assigneeId, role OWNER|COLLABORATOR|VIEWER, status ACTIVE|ENDED, assignedAt, assignedBy, endedAt?, reasonCode? }`.

- Um único `OWNER` ativo: atribuir novo OWNER encerra o anterior (`OWNER_REPLACED`) — devolvido em `ended`.
- Colaboradores e leitores podem ser vários.
- Atribuição não substitui RBAC: sem `customer.readAssigned` ou `customer.read`, a atribuição não dá acesso; com `customer.readAssigned`, só a atribuição ativa dá acesso.
- `VIEWER` não escreve.
- Criação pelo serviço atribui o criador como OWNER, salvo `ownerUserId` informado.
- No merge, atribuições da origem passam para o destino; duplicatas e um segundo OWNER são encerrados (`MERGED_DUPLICATE`).
- Tópico 40: a jornada pode copiar o OWNER do cliente (`JourneyAssignment`), com vínculo explícito (`copiedFromCustomerAssignmentId`).
- Evento: `CustomerAssignmentChanged` (ids e papel; sem nomes).
