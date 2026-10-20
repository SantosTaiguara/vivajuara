# Privacidade e acesso ao Customer (Tópico 39)

## Princípios

- Customer é privado por padrão (`dataClassification` `STANDARD_PII`; `RESTRICTED_PII` disponível).
- PII nunca em URL, logs, eventos, analytics, links de compartilhamento, cache público ou ids.
- O que está no navegador é cópia de conveniência; nunca autorização. O backend revalida tudo.
- Consentimento é registrado, nunca inferido de telefone/WhatsApp/e-mail/CRM (`consentOf` sem registro → `UNKNOWN`; `mayContact` só com `GRANTED` ou `NOT_REQUIRED_BY_POLICY`). A base legal é do jurídico da organização.
- Retenção: `retentionPolicyRef = null` na configuração até decisão do jurídico; nenhum prazo inventado. `anonymize()` é lógico (estado `DELETED`, ids preservados, contatos apagados), exige `reasonCode`; não há hard delete.

## CustomerAccessDecision

`decideAccess({ customer, principal, assignments, can })` = Tenant AND Permissão AND Atribuição AND Lifecycle.

| Situação | Resultado |
|---|---|
| outra organização ou inexistente | `NONE`, `NOT_FOUND` (indistinguível) |
| `DELETED` / `MERGED` | `NONE` (`MERGED` informa o canônico) |
| `customer.read` | permitido sem atribuição |
| `customer.readAssigned` + atribuição ativa (usuário ou equipe) | permitido |
| `customer.profile.read` | nível `STANDARD` (perfil + contatos mascarados) |
| + `customer.contact.read` + `customer.privacy.read` | nível `FULL` |
| `ARCHIVED` | leitura, sem escrita (`ARCHIVED_READ_ONLY`) |
| atribuição `VIEWER` sem `customer.read` | sem escrita |

## Projeções

`project(bundle, mode, decision)`: `SUMMARY` (lista/busca; sem contatos), `STANDARD` (contatos mascarados `•••• 1234`, `m•••@dominio`), `FULL`, `CLIENT_SAFE` (primeiro nome + objetivo), `TECHNICAL` (ids, revisões, refs externas; sem nome nem contatos). O modo é rebaixado ao nível da decisão (`downgraded: true`).

## Permissões

Chaves usadas (contrato para o backend, listadas em `config/customer/policy.json → permissionCatalog`): `customer.read`, `customer.readAssigned`, `customer.create`, `customer.update`, `customer.archive`, `customer.assign`, `customer.profile.read`, `customer.profile.update`, `customer.contact.read`, `customer.contact.update`, `customer.merge`, `customer.duplicate.review`, `customer.privacy.read`, `customer.externalRef.manage`. **Ainda não estão em `config/security/permissions.json`**: `canFromAuthz` as nega (deny by default) até serem registradas. No modo estático (sem login), `localDeviceCan` concede só o que a lista local já faz hoje (nome, lotes, perfil) sob `customer_profile.manage`; contatos nunca.

## Busca

Busca por telefone/e-mail exige `customer.contact.read`; resultados só de clientes visíveis (nem contagem de invisíveis); a consulta não é registrada (só `kind` e tamanho).

## Duplicidade e privacidade

Aviso sobre registro que o usuário não vê: `POTENTIAL_DUPLICATE_REQUIRES_REVIEW`, sem nome/telefone.

## Offline e cache

`offlinePolicy` padrão: nada em cache (resumo, contatos, perfil, notas). Repositório só em memória; `clearOnSessionChange` limpa contexto e dados em logout/troca de organização (o `TENANT_SENSITIVE_STATE` do tópico 31 já inclui `currentCustomerId` e `customers`).

## PII legada encontrada

- `state.customers[].name` no `localStorage` (`ws:<dev>:state`, parte `prefs`) — já existia; continua como cópia local do aparelho.
- O nome digitado no compartilhamento entra no texto do WhatsApp (`wa.me/?text=Olá, Maria…`), ou seja, numa URL. É conteúdo escolhido pelo usuário para a mensagem, mas é PII em URL: decisão humana (ver relatório).
- `App.analytics.track('customer_cleared')` não leva dado pessoal.
