# Migração do cliente legado (Tópico 39)

## Inventário (Fase 1)

| Ocorrência | Local | Classificação |
|---|---|---|
| `state.customers: [{ id, name, lots, profile }]` | `src/state/store.js` (persistido em `ws:<dev>:state.prefs`) | DOMAIN_CUSTOMER (cópia local) |
| `state.currentCustomerId` | `store.js` (sessão) | CURRENT_CONTEXT |
| `custAdd` / `custPick` / `custClear` / `custDel` / `custAddLot` / `custRemoveLot` / `custCompare` / `shareCust` | `src/presentation/app.js` | TEMP_UI_STATE |
| `custProfile(st)` → `{ preferences, constraints, activePreset, objective }` | `app.js` | PREFERENCE_PROFILE (tópico 14) |
| `selectProfile` → `buildProfile({ id: currentCustomerId \|\| 'working-profile' })` | `src/state/selectors.js` | PREFERENCE_PROFILE |
| `customer: { id, name }`, `customerName` | `app.js`, `quickview.js`, `viewmodels.js`, `share.js` | TEMP_UI_STATE (nome no texto de compartilhamento) |
| `objective` (`housing`/`investment`/`family`/`premium`) | `app.js`, `config/presentation.js` | LEGACY_UNKNOWN — lente de score, não objetivo do cliente |
| `TENANT_SENSITIVE_STATE` (`currentCustomerId`, `customers`) | `src/security/organization.js` | CURRENT_CONTEXT (limpo na troca de organização) |
| `customer_profile.manage` | `config/security/*.json`, backend `iam/permissions.js` | permissão do perfil local |
| lead / CRM / Kenlo | — | não encontrado no código |

PII local encontrada: somente `name` (até 60 caracteres) em `state.customers`. Não há telefone, e-mail ou documento salvos.

## LegacyCustomerMigrationAdapter

`App.customer.context.migrate(state.customers, { organizationId, developmentId, resolveLot })`:

- mantém o id legado como id canônico (é opaco) → `currentCustomerId` continua válido; idempotente (`existing.customerIds` → `alreadyMigrated`);
- ids ausentes, repetidos ou com aparência de PII → `unresolvedIdentities` (não migrados);
- `profile.preferences/constraints` → `CustomerPreferenceProfileVersion` V1 com origem `BROKER_RECORDED`;
- `profile.objective`/`activePreset` → **não mapeados** (`UI_LENS_NOT_CUSTOMER_OBJECTIVE`);
- `lots` → favoritos `{ contextType: 'CUSTOMER', contextRef: customerId, lotId }`; lote inexistente → `unresolvedFavoriteContexts`;
- campos desconhecidos → `dataNotMigrated` com motivo; nada é perdido em silêncio;
- varredura de duplicidade ao final (sugestões apenas).

## CustomerMigrationReport (campos)

`recordsDiscovered`, `customersCreated`, `alreadyMigrated`, `profilesMigrated`, `contactPointsMigrated` (0: não há contatos legados), `externalRefsMigrated` (0), `duplicateCandidates`, `unresolvedIdentities`, `unresolvedFavoriteContexts`, `legacyPiiStorageFound`, `dataNotMigrated`, `legacyUiContext`.

Não há base real de clientes disponível nesta sessão (os clientes vivem no navegador de cada corretor); o adaptador roda no aparelho quando integrado. Teste com 6 registros sintéticos em `tests/customerDomain.test.js`.
