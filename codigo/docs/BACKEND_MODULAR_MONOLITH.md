# Backend como monolito modular

Código: `plat/backend` (Node + PostgreSQL). Documentos detalhados já existentes: `backend/docs/BACKEND_ARCHITECTURE.md`, `API_ARCHITECTURE.md`, `API_ERRORS.md`, `IAM_ARCHITECTURE.md`, `MULTI_TENANCY.md`, `DATA_MIGRATION_V2.md`, `DEPLOYMENT_V2.md`, `openapi.json` (1.3.0). Este documento só fixa as regras de modularidade da arquitetura de referência v1 sobre o que já existe.

## 1. Módulos reais

| Módulo (`src/modules/…`) | Contexto | Arquivos | Tabelas em que escreve (verificado por `INSERT/UPDATE/DELETE` no código) |
|---|---|---|---|
| developments | development | controller, dto, repository, service | developments, sources |
| lots | lot | controller, dto, query, repository, service | lots, static_versions, blocks |
| analysis | analysis | controller, dto, repository, service, analysisPreview.service | analysis_versions, lot_analysis, analysis_input_versions, lot_analysis_inputs (+ developments: ponteiro) |
| commercial | pricing | controller, dto, repository, service, priceTablePublication.* | price_tables, payment_plans, lot_prices (+ developments: ponteiro) |
| pricing-history | pricing | controller, domain, repository, service | nenhuma (lê versões publicadas) |
| availability | availability | controller, dto, repository, service, stream (SSE) | lot_availability, availability_history (+ developments: revisão) |
| assets | development | controller, repository, service | assets |
| iam | security | authentication, authorization, permissions, routePolicies, iam.admin, repository | organizations, users, organization_memberships, role_assignments, auth_tokens |
| tenancy | security | repository, service | nenhuma (resolve organização) |
| share | share | share.tokens | nenhuma (grants no servidor pendentes) |
| imports | lot/analysis | importDevelopmentData.service | import_runs |
| shared/db | plataforma | pool, migrator, audit.repository, idempotency.repository | audit_log, idempotency_keys |

Achados (registrados em `ARCHITECTURE_GAP_REPORT.md`): `analysis`, `commercial` e `availability` escrevem na tabela `developments` (ponteiros "current"/revisão) — GAP-ARCH-15; `lots.repository.js` lê `lot_prices`, `lot_availability` e `lot_analysis` direto para montar o read model do lote — GAP-ARCH-16 (aceitável como read model, mas deve virar consulta exposta pelos módulos donos).

## 2. Estrutura interna e regras

- Cada módulo: `controller` (HTTP, DTO, códigos de erro) → `service` (caso de uso, transação, autorização) → `repository` (SQL do próprio módulo). `shared/` só contém primitivas (http, db, validation, contracts, logging, domain/checksum); nada de regra de negócio em `shared` (regra `shared → lot` proibida também no cliente).
- Um módulo não escreve em tabela de outro; lê por service/consulta exposta. Exceção exige ADR.
- Transação fica dentro de um módulo; sem transação distribuída. Efeito para outro módulo → evento de domínio em processo ou outbox (quando houver integração externa).
- Concorrência otimista onde há edição concorrente (`revision` de disponibilidade); idempotência em POST/PATCH de administrador (`Idempotency-Key`, migration 004).
- Autorização no servidor (`iam/routePolicies.js`), tenant obrigatório no contexto do request (migration 008); RLS planejado (`MULTI_TENANCY.md` §6).
- ORM não é exposto: DTOs em `*.dto.js`, schemas em `shared/contracts/schemas.js`, erros com código estável.

## 3. Fronteiras com o frontend

O motor de análise é o mesmo código do frontend (`analysis/preview` roda `intelligence/*` sem cópia). Contratos que o frontend consome: `/api/v1/developments/{id}/map-lots`, `/lots`, `/analysis/current`, `/commercial/current`, `/availability` (+ `/stream`, `/manifest`), `/lots/{id}/price-history`, `/me`, `/iam/registry`. O painel estático ainda lê `dash/*.json`; `data/apiSource.js` é o adaptador para a API (fase 3.2).

## 4. Gatilhos para extrair um serviço (não extrair antes)

Carga de documentos com escala própria; jobs de análise longos; necessidade de isolamento de segurança medida. Até lá: worker no mesmo código.

## 5. Pendências (não feitas nesta rodada)

Testes de banco não rodam aqui (D-PG-PASSWORD); provedor de identidade (D-IDP); RLS; outbox/worker; object storage; API de gestão de usuários. Nada disso foi alterado no tópico 52: este documento é contrato, não implementação.
