# Relatório — Tópico 39 (Customer domain)

## Entregue
- `src/customer/customerDomain.js`: Customer (PERSON/ORGANIZATION), lifecycle administrativo, contatos com normalização conservadora (E.164 BR/internacional, e-mail só domínio minúsculo) e verificação separada, consentimento por canal (nunca inferido), privacy profile, assignments, CustomerAccessDecision, external refs + authority mode obrigatório + field authority + sync conflicts com fingerprints, perfil de preferências versionado e imutável, budget profile (desconhecido ≠ 0), completude, snapshot mínimo, integração Fit/Recommendation/Favoritos/Comparação por referência, duplicidade SUGGEST_ONLY, merge auditado com revisões esperadas e aliases, projeções SUMMARY/STANDARD/FULL/CLIENT_SAFE/TECHNICAL, busca segura, ingestão idempotente, anonimização lógica, eventos sem PII.
- `src/customer/customerContext.js`: ActiveCustomerContext (store guarda só o id), CustomerContextGuard, patches de troca/saída compatíveis com `app.js`, rótulos ("Atendendo: Maria", "Compatibilidade para Maria", "Favoritar para Maria"), deep link só com id opaco, sequenciador de requisições, LegacyCustomerMigrationAdapter + relatório.
- `src/customer/customerRepository.js`: repositórios em memória tenant-aware, ApiCustomerRepository (contrato), serviços separados com deny by default e auditoria sem PII.
- `src/customer/customerView.js`: chip de contexto, abas do workspace, painel de jornada (markup).
- `config/customer/policy.json`; docs `CUSTOMER_*.md` (9).
- Testes: `tests/customerDomain.test.js` — 23 testes, 20 cenários dourados.

## Achados
- Estados de cliente: `state.customers` (`{ id, name, lots, profile }`, localStorage) e `currentCustomerId` (sessão). Nenhum lead/CRM no código.
- PII: só o nome local; e o nome digitado no compartilhamento entra no link `wa.me/?text=` (PII em URL).
- `objective` do painel é lente de score, não objetivo do cliente.

## Regressão
Fit e Recommendation idênticos (perfil da versão = perfil do painel, 498 lotes); Base Score, preços, disponibilidade (todos UNKNOWN), Favoritos e vencedor da comparação não alterados.

## Limitações de segurança
Frontend nunca é autoridade; repositório só em memória; chaves `customer.*` não registradas → negadas; backend Customer não implementado (contratos em `CUSTOMER_EXTERNAL_SYNC_POLICY.md`).

## Decisões humanas
1. Registrar as permissões `customer.*` em `config/security/permissions.json`/roles e no backend.
2. Política de retenção/base legal (retentionPolicyRef) e consentimento.
3. Mapear (ou não) a lente `housing/investment` para `LIVE/INVEST`.
4. Nome do cliente no texto/URL do WhatsApp.
5. Manter a lista local de clientes no localStorage (cópia de conveniência) ou movê-la para o servidor.
6. Adotar HOUSEHOLD e notas (hoje não).
7. Limiar de similaridade de nome (0,8) e normalização de telefone fora do Brasil.
