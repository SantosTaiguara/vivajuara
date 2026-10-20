# Arquitetura do domínio Customer (Tópico 39)

Código: `src/customer/customerDomain.js` (`App.customer.domain`), `src/customer/customerContext.js` (`App.customer.context`), `src/customer/customerRepository.js` (`App.customer.repo`), `src/customer/customerView.js` (`App.customerView`, só markup). Configuração: `config/customer/policy.json` (empacotada em `App.configs.customer.policy`). Testes: `tests/customerDomain.test.js`.

## Distinções obrigatórias

| Conceito | Onde vive | Observação |
|---|---|---|
| USER | `App.authz` (tópico 30) | quem opera; nunca é Customer |
| CUSTOMER | `createCustomer` | raiz de identidade; id opaco (`cus_…`), `organizationId` obrigatório, `recordRevision` |
| CONTACT POINT | `addContactPoint` | normalização conservadora; presença ≠ verificação (`UNVERIFIED` ao criar) |
| ASSIGNMENT | `assign` | atribuição comercial; não substitui permissão |
| PREFERENCE / HARD CONSTRAINT | `createProfileVersion` | listas separadas; importância alta não vira restrição |
| PROFILE VERSION / SNAPSHOT | `createProfileVersion`, `createSnapshot` | versão salva é congelada; snapshot só referencia (sem PII) |
| ACTIVE CUSTOMER CONTEXT | `App.customer.context.select` | estado de sessão; o store guarda só `currentCustomerId` |
| FAVORITE / COMPARISON / RECOMMENDATION | tópicos 38/24/15 | ligados por referência (`favoriteContext`, `comparisonContext`, `resultRefs`) |
| LEAD / JOURNEY STAGE | Tópico 40 (`App.journey`) | o lifecycle do Customer é só `ACTIVE/ARCHIVED/MERGED/DELETED` |
| EXTERNAL CRM RECORD | `linkExternalRef` | `authorityMode` explícito; nunca escolhido automaticamente |

## Entidades implementadas

`Customer`, `CustomerPersonDetails`, `CustomerOrganizationDetails`, `CustomerContactPoint`, `CustomerCommunicationPreference`, `CustomerPrivacyProfile`, `CustomerAssignment`, `CustomerAccessDecision`, `CustomerExternalRef`, `CustomerFieldAuthorityPolicy` (via `fieldAuthority`), `CustomerSyncConflict`, `CustomerPreferenceProfile`, `CustomerPreferenceProfileVersion`, `CustomerBudgetProfile`, `CustomerProfileCompleteness`, `CustomerProfileSnapshot`, `ActiveCustomerContext`, `CustomerDuplicateCandidate`, `CustomerMergeRecord`, `CustomerAlias`, `CustomerIngestionObservation` (via `ingest`), eventos de domínio.

`HOUSEHOLD` não foi criado (sem requisito real). `CustomerNote` não foi implementado (spec: só com necessidade real); notas nunca vão para share.

## Repositórios e serviços

Repositórios (`App.customer.repo`): `CustomerRepository` (getById, getByIds, search, save com expectedRevision, archive, resolveAlias), `CustomerPreferenceProfileRepository` (versões append-only: regravar um id devolve `IMMUTABLE_VERSION`), `CustomerContactRepository`, `CustomerAssignmentRepository`, `CustomerDuplicateRepository`, `CustomerMergeRepository`. Implementação local: `MemoryCustomerStore` (somente memória, por organização; `clear()` em logout/troca de organização). Contrato servidor: `ApiCustomerRepository` (busca por POST com corpo — nunca PII na URL).

Serviços (`App.customer.repo.services(store, { principal, can })`): `application` (create/get/rename/archive/addContact), `profile` (save → nova versão; snapshot; versions), `assignment`, `search` (só a última busca resolve: troca rápida Maria → João não sobrescreve), `duplicates` (scan/review), `merge`, `ingestion` (idempotente), `favorites` (contexto CUSTOMER resolvido pelo alias). Cada chamada verifica permissão antes (nega por padrão) e grava linha de auditoria sem PII.

## Eventos de domínio

`CustomerCreated`, `CustomerUpdated`, `CustomerArchived`, `CustomerAssignmentChanged`, `CustomerContactAdded`, `CustomerContactUpdated`, `CustomerPreferenceProfileUpdated`, `CustomerDuplicateDetected`, `CustomerMerged`, `CustomerExternalRefLinked`, `CommunicationPreferenceChanged`, `CustomerAnonymized`. Carregam ids e códigos; `event()` remove chaves de PII e mascara strings com aparência de telefone/e-mail/CPF.

## Integrações

- **Fit (14)**: `toFitProfile(version)` chama o `App.fit.buildProfile` existente, sem alteração. Mesmo perfil → mesmo `profileVersion` e mesmo Fit que o painel (testado sobre os 498 lotes).
- **Recommendation (15)**: `toRecommendationConstraints(version)` entrega só as restrições explícitas; `resultRefs(snapshot, fitProfile)` registra `customerId`, `profileVersionId`, `profileSnapshotId`, `customerProfileVersion`.
- **Favoritos (38)**: `favoriteContext(customerId)` → `{ contextType: 'CUSTOMER', contextRef }`; merge remapeia o `contextRef` e guarda `originalContextRef`. Favoritos não viram preferências.
- **Comparação (24)**: `comparisonContext(customerId, profileVersionId, fitProfileVersion)`; a sessão não é reescrita na troca de cliente.

## Fora do escopo / adiado

Sincronização real com Kenlo (sem API oficial), backend Postgres (contratos apenas: `CUSTOMER_EXTERNAL_SYNC_POLICY.md`), notas, documentos pessoais, HOUSEHOLD, workspace completo na interface (receita em `CUSTOMER_UI_CONTEXT_INTEGRATION.md`).
