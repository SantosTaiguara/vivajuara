# PERMISSION_REGISTRY — registro de permissões (tópico 30)

> Gerado a partir de `config/security/*.json` (`App.permissions.markdownTable()`). Versão do registro 1.0.0 · policyVersion `iam-2026-10-08.1`.
> Espelho do registro do backend (`GET /api/v1/iam/registry`). Uma chave que não está aqui é **negada** no frontend.

## PermissionRegistry + PermissionRiskMatrix

| Permissão | Risco | Escopos | Anônimo | Online | Motivo | Auditoria | Roles (templates) | Descrição |
|---|---|---|---|---|---|---|---|---|
| `development.view` | LOW | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, VIEWER, BROKER, MARKETING, ANALYST, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Ver o empreendimento (nome, implantação, áreas comuns, fontes, dados pendentes). |
| `lot.view` | LOW | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, VIEWER, BROKER, MARKETING, ANALYST, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Ver mapa, lotes, Quick View e detalhes. |
| `lot.price.view` | LOW | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, VIEWER, BROKER, MARKETING, ANALYST, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Ver preço de tabela vigente (R$/m² da versão publicada). |
| `lot.price_history.view` | LOW | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, VIEWER, BROKER, MARKETING, ANALYST, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Ver histórico de preços de tabela (tópico 28; nunca como valorização ou retorno). |
| `lot.availability.view` | LOW | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, VIEWER, BROKER, MARKETING, ANALYST, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Ver status comercial (hoje todos "sem informação"). |
| `lot.analysis.view` | LOW | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, VIEWER, BROKER, MARKETING, ANALYST, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Ver análise e modo técnico: scores, classes, versões de metodologia, proveniência. |
| `lot.compare` | LOW | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, VIEWER, BROKER, MARKETING, ANALYST, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Comparar lotes. |
| `lot.simulate` | LOW | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, BROKER, ANALYST, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Simular condições de pagamento sobre o preço de tabela. |
| `share.create` | LOW | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, BROKER, MARKETING, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Gerar texto/link de compartilhamento (WhatsApp, cópia). O link nunca leva dados pessoais. |
| `customer_profile.manage` | MEDIUM | ORGANIZATION, DEVELOPMENT | sim | — | — | — | PUBLIC_VISITOR, BROKER, INVENTORY_MANAGER, PRICING_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Perfil de cliente de trabalho (nome, preferências, lotes). Hoje guardado só no aparelho; nunca enviado. |
| `analysis.preview` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | ANALYST, OWNER_ADMIN | Pré-visualizar recálculo de análise no backend (POST de preview). |
| `availability.write` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | INVENTORY_MANAGER, COMMERCIAL_MANAGER, OWNER_ADMIN | Alterar status comercial de lote (PATCH /lots/{id}/availability, revisão esperada obrigatória). |
| `provenance.resolveConflict` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | nenhum (aguarda decisão) | Resolver conflito de proveniência de um atributo (tópico 33). |
| `backoffice.access` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Entrar no console administrativo (shell separado do painel do corretor). (tópico 60) |
| `backoffice.inbox.view` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver a caixa operacional e as filas de trabalho autorizadas. (tópico 60) |
| `backoffice.queue.assign` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Atribuir itens de trabalho (atribuição não é autorização). (tópico 60) |
| `backoffice.approval.decide` | HIGH | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Decidir aprovações no Approval Center (separação de funções). (tópico 60) |
| `backoffice.commercial.view` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver as filas comerciais (propostas, reservas, closings). (tópico 60) |
| `backoffice.data.view` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver operações de dados (onboarding, conflitos, qualidade, publicações). (tópico 60) |
| `backoffice.developments.view` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver operações de empreendimentos. (tópico 60) |
| `backoffice.customers.view` | HIGH | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver a área de clientes do console (projeção por permissão). (tópico 60) |
| `backoffice.documents.view` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver operações de documentos. (tópico 60) |
| `backoffice.privacy.view` | HIGH | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver operações de privacidade (titulares, retenção, incidentes). (tópico 60) |
| `backoffice.access_admin.view` | HIGH | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver usuários, memberships, papéis e sessões. (tópico 60) |
| `backoffice.access_admin.change` | CRITICAL | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Alterar permissões/memberships (diff + step-up). (tópico 60) |
| `backoffice.session.revoke` | HIGH | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Encerrar sessões ativas de um usuário. (tópico 60) |
| `backoffice.support_session.start` | CRITICAL | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Iniciar sessão de suporte formal, com prazo e auditoria. (tópico 60) |
| `backoffice.integration.view` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver saúde das integrações e status de segredos (nunca valores). (tópico 60) |
| `backoffice.integration.resync` | HIGH | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Disparar ressincronização idempotente de integração. (tópico 60) |
| `backoffice.observability.view` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver saúde de serviços, jobs e marcadores de release. (tópico 60) |
| `backoffice.job.retry` | HIGH | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Repetir job seguro para retry (idempotente). (tópico 60) |
| `backoffice.job.replay` | CRITICAL | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Reprocessar mensagem da DLQ (prévia + análise de idempotência). (tópico 60) |
| `backoffice.config.view` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver configurações versionadas e diffs. (tópico 60) |
| `backoffice.config.publish` | CRITICAL | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Publicar/restaurar versão de configuração (nunca sobrescreve). (tópico 60) |
| `backoffice.flag.manage` | HIGH | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Alterar feature flags operacionais (dono e sunset obrigatórios). (tópico 60) |
| `backoffice.emergency.activate` | CRITICAL | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Ativar/liberar controle de emergência com escopo e expiração. (tópico 60) |
| `backoffice.export.create` | HIGH | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Gerar exportação com prévia, motivo, link curto e auditoria. (tópico 60) |
| `backoffice.audit.export` | CRITICAL | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Exportar eventos de auditoria. (tópico 60) |
| `backoffice.data.repair` | CRITICAL | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Executar comando dedicado de reparo/reconstrução (dry-run obrigatório). (tópico 60) |
| `development.location_environment.read` | LOW | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Ver o Entorno (Google Maps em até 8 km): locais no raio e trajeto sob demanda. Somente com coordenada oficial validada. (tópico 63) |
| `development.location_environment.manage` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Configurar o Entorno: categorias, raios permitidos (máximo 8 km), rotas, habilitação do Google Maps. (tópico 63) |
| `development.location.validate` | CRITICAL | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | nenhum (aguarda decisão) | Propor, aprovar e publicar a coordenada oficial do empreendimento (prévia obrigatória). (tópico 63) |
| `proposal.read` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Ler propostas, versões e negociação (dados CONFIDENTIAL) (tópico 57). |
| `proposal.create` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Criar proposta (rascunho) a partir de cliente/lote/decisão (tópico 57). |
| `proposal.update_draft` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Editar rascunho de proposta (expectedRevision) (tópico 57). |
| `proposal.submit` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Emitir/enviar proposta (versão imutável) (tópico 57). |
| `proposal.withdraw` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Registrar retirada de proposta (motivo) (tópico 57). |
| `proposal.review` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Colocar proposta em análise (tópico 57). |
| `proposal.counter` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Emitir contraproposta (nova versão) (tópico 57). |
| `proposal.accept` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Registrar aceite de versão exata (tópico 57). |
| `proposal.reject` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Recusar proposta (motivo) (tópico 57). |
| `reservation.read` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Ler reservas e quadro de reservas (tópico 57). |
| `reservation.create` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Criar reserva atômica (expectedAvailabilityRevision + Idempotency-Key) (tópico 57). |
| `reservation.extend` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Estender reserva (política/aprovação) (tópico 57). |
| `reservation.release` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Liberar reserva (motivo) (tópico 57). |
| `reservation.cancel` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Cancelar reserva (administrativo) (tópico 57). |
| `closing.read` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Ler fechamento, checklist e prontidão (tópico 57). |
| `closing.manage` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Abrir fechamento e registrar documentos recebidos (tópico 57). |
| `closing.validate_documents` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Validar/recusar documentos e registrar confirmação manual (tópico 57). |
| `contract.generate` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Gerar contrato a partir de modelo aprovado (sem cláusulas inferidas) (tópico 57). |
| `contract.issue` | CRITICAL | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | nenhum (aguarda decisão) | Emitir versão imutável de contrato (tópico 57). |
| `signature.manage` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Enviar contrato ao provedor de assinatura (tópico 57). |
| `sale.complete` | CRITICAL | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | nenhum (aguarda decisão) | Concluir venda (WON + lote SOLD, atômico) (tópico 57). |
| `sale.cancel` | CRITICAL | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | nenhum (aguarda decisão) | Cancelar/registrar perda de negócio (tópico 57). |
| `commercial_approval.request` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Pedir aprovação comercial (desconto, prazo, extensão) (tópico 57). |
| `commercial_approval.decide` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Decidir aprovação comercial (separação de funções por política) (tópico 57). |
| `price_table.publish` | CRITICAL | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | PRICING_MANAGER, OWNER_ADMIN | Publicar/ativar uma versão de tabela de preço. |
| `admin.audit.view` | HIGH | ORGANIZATION | — | sim | — | sim | COMMERCIAL_MANAGER, OWNER_ADMIN | Ler a trilha de auditoria da própria organização. |
| `platform.cross_tenant` | CRITICAL | GLOBAL | — | sim | sim | sim | SYSTEM | Plataforma: acesso entre organizações. Só principal SYSTEM/operador; nunca concedível a role de organização. |
| `data_quality.read` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Ver saúde, findings, regras, contratos e catálogo de qualidade de dados. (tópico 61) |
| `data_quality.manage_findings` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Reconhecer, remediar e resolver findings de qualidade (resolução exige evidência e reexecução). (tópico 61) |
| `data_quality.run_checks` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Executar regras/quality gates de qualidade de dados (job; não altera dados). (tópico 61) |
| `data_quality.manage_rules` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Criar/versionar/promover regras de qualidade (SHADOW→WARNING→ENFORCED com dry-run). (tópico 61) |
| `data_quality.create_exception` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Solicitar exceção temporária (com expiração) a uma regra de qualidade. (tópico 61) |
| `data_quality.approve_exception` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Aprovar exceção de qualidade (aprovador ≠ solicitante; política da organização). (tópico 61) |
| `data_quality.manage_incident` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Abrir e conduzir incidentes de dados SEV1–SEV4 (RCA, remediação, postmortem). (tópico 61) |
| `data_governance.manage_owner` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Atribuir owners/stewards de domínios de dados (necessita confirmação humana). (tópico 61) |
| `data_governance.manage_contract` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Versionar contratos de dados e avaliar compatibilidade. (tópico 61) |
| `data_governance.certify` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Certificar dataset/versão (validade e critérios por política). (tópico 61) |
| `development_onboarding.read` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | — | nenhum (aguarda decisão) | Ver casos de onboarding, fontes, lotes de ingestão, qualidade e prévia (área técnica, nunca pública). (tópico 58) |
| `development_onboarding.create` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Criar/cancelar caso de onboarding de empreendimento. (tópico 58) |
| `development_onboarding.upload_source` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Enviar arquivo-fonte imutável (checksum sha256, varredura obrigatória). (tópico 58) |
| `development_onboarding.map_schema` | MEDIUM | ORGANIZATION, DEVELOPMENT | — | sim | — | sim | nenhum (aguarda decisão) | Confirmar mapeamento de campos e regras de transformação (FieldRegistry). (tópico 58) |
| `development_onboarding.resolve_conflict` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | nenhum (aguarda decisão) | Resolver DataConflict / ReviewItem com motivo auditado. (tópico 58) |
| `development_onboarding.review_geometry` | HIGH | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | nenhum (aguarda decisão) | Aprovar vínculo geometria↔lote, alinhamento e reparo (nunca altera a fonte). (tópico 58) |
| `development_onboarding.publish` | CRITICAL | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | nenhum (aguarda decisão) | Aprovar e ativar publicação candidata (gate de qualidade, separação de funções por política). (tópico 58) |
| `development_onboarding.rollback` | CRITICAL | ORGANIZATION, DEVELOPMENT | — | sim | sim | sim | nenhum (aguarda decisão) | Reverter ponteiro de publicação para versão anterior (disponibilidade não é revertida). (tópico 58) |
| `privacy.registry.view` | MEDIUM | ORGANIZATION | — | sim | — | sim | nenhum (aguarda decisão) | Ver registros de privacidade, maturidade, métricas e auditoria (encarregado/admin). (tópico 59) |
| `privacy.request.manage` | HIGH | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Registrar e conduzir solicitações do titular, verificação de identidade e bloqueio de tratamento. (tópico 59) |
| `privacy.consent.manage` | HIGH | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Registrar/revogar consentimento e supressões de contato. (tópico 59) |
| `privacy.legal_hold.manage` | CRITICAL | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Criar e liberar legal hold. (tópico 59) |
| `privacy.retention.execute` | CRITICAL | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Executar jobs de retenção e exclusão (dry-run e aprovação obrigatórios). (tópico 59) |
| `customer.export_bulk` | HIGH | ORGANIZATION | — | sim | sim | sim | nenhum (aguarda decisão) | Exportar dados de clientes em lote (sempre auditado; nenhum papel recebe por padrão). (tópico 59) |

Legenda: **Anônimo** = concedível ao visitante sem login (somente em empreendimento PUBLIC). **Online** = negada com conexão diferente de ONLINE (OnlineAuthorizationPolicy). **Motivo** = obrigação `requireReason`. **Auditoria** = HIGH/CRITICAL geram obrigação `writeAuditEvent`. CRITICAL está preparada para step-up futuro (`REQUIRES_STEP_UP`).

## Role templates

Role é resumo; nenhum componente testa role. As concessões abaixo são templates iniciais (decisão humana pendente).

| Role | Para | Concessões |
|---|---|---|
| PUBLIC_VISITOR (Visitante / apresentação) | Contexto sem login: exatamente o que o painel estático faz hoje, só em empreendimentos públicos. | `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`, `lot.compare`, `lot.simulate`, `share.create`, `customer_profile.manage` |
| VIEWER (Leitor) | Somente leitura. | `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`, `lot.compare` |
| BROKER (Corretor) | Consulta, compara, simula e compartilha; não publica preço nem altera status. | `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`, `lot.compare`, `lot.simulate`, `share.create`, `customer_profile.manage` |
| MARKETING (Marketing) | Leitura e compartilhamento; sem perfil de cliente nem escrita. | `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`, `lot.compare`, `share.create` |
| ANALYST (Analista) | Leitura técnica e preview de análise; sem escrita comercial. | `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`, `lot.compare`, `lot.simulate`, `analysis.preview` |
| INVENTORY_MANAGER (Gestor de estoque) | Altera disponibilidade; não altera preços. | `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`, `lot.compare`, `lot.simulate`, `share.create`, `customer_profile.manage`, `availability.write` |
| PRICING_MANAGER (Gestor de preços) | Publica tabelas; não altera disponibilidade. | `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`, `lot.compare`, `lot.simulate`, `share.create`, `customer_profile.manage`, `price_table.publish` |
| COMMERCIAL_MANAGER (Gestor comercial) | Corretor + disponibilidade + auditoria. | `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`, `lot.compare`, `lot.simulate`, `share.create`, `customer_profile.manage`, `availability.write`, `admin.audit.view` |
| OWNER_ADMIN (Administrador da organização) | Todas as permissões da organização; não é superadmin da plataforma. | `development.view`, `lot.view`, `lot.price.view`, `lot.price_history.view`, `lot.availability.view`, `lot.analysis.view`, `lot.compare`, `lot.simulate`, `share.create`, `customer_profile.manage`, `analysis.preview`, `availability.write`, `price_table.publish`, `admin.audit.view` |

## FeaturePermissionMatrix

| Funcionalidade | Permissões (todas exigidas) | Negação | Mensagem |
|---|---|---|---|
| `map.view` | `lot.view` | ocultar | Mapa indisponível para este acesso. |
| `development.info` | `development.view` | ocultar | Você não possui permissão para esta ação. |
| `lot.details` | `lot.view` | ocultar | Você não possui permissão para esta ação. |
| `lot.price` | `lot.price.view` | ocultar | Preço de tabela não disponível para este acesso. |
| `lot.priceHistory` | `lot.price_history.view` | ocultar | Você não possui permissão para esta ação. |
| `lot.availability` | `lot.availability.view` | ocultar | Você não possui permissão para esta ação. |
| `lot.analysis` | `lot.analysis.view` | ocultar | Você não possui permissão para esta ação. |
| `lot.compare` | `lot.compare` | desabilitar com explicação | Você não possui permissão para comparar lotes. |
| `lot.favorite` | `lot.view` | ocultar · só no aparelho | Você não possui permissão para esta ação. |
| `lot.simulation` | `lot.simulate` + `lot.price.view` | desabilitar com explicação | Você não possui permissão para simular condições. |
| `recommendation` | `lot.view` + `lot.analysis.view` | ocultar | Você não possui permissão para esta ação. |
| `mode.broker` | `lot.view` | ocultar | Você não possui permissão para esta ação. |
| `mode.client` | `lot.view` | ocultar | Você não possui permissão para esta ação. |
| `mode.technical` | `lot.analysis.view` | ocultar | Você não possui permissão para esta ação. |
| `mode.presentation` | `lot.view` | ocultar | Você não possui permissão para esta ação. |
| `share.lots` | `share.create` | desabilitar com explicação | Você não possui permissão para compartilhar. |
| `share.customer` | `share.create` + `customer_profile.manage` | desabilitar com explicação | Você não possui permissão para compartilhar a seleção do cliente. |
| `customer.profile` | `customer_profile.manage` | ocultar · só no aparelho | Você não possui permissão para esta ação. |
| `data.refresh` | `development.view` | ocultar | Você não possui permissão para esta ação. |
| `availability.edit` | `availability.write` | desabilitar com explicação · online | Alterar disponibilidade exige permissão e conexão com o servidor. |
| `pricing.publish` | `price_table.publish` | ocultar · online | Publicar tabela indisponível. Você não possui permissão. |
| `analysis.preview` | `analysis.preview` | ocultar · online | Você não possui permissão para esta ação. |
| `audit.view` | `admin.audit.view` | ocultar · online | Você não possui permissão para esta ação. |

## ActionPermissionMatrix (data-act do painel)

| data-act | Funcionalidade |
|---|---|
| `view` | data-v=map → `map.view`; data-v=compare → `lot.compare`; data-v=development → `development.info`; data-v=clients → `customer.profile`; demais → `map.view` |
| `mode` | data-mode=broker → `mode.broker`; data-mode=client → `mode.client`; data-mode=technical → `mode.technical`; demais → negado |
| `present` | `mode.presentation` |
| `panel` | data-p=simulation → `lot.simulation`; demais → `lot.details` |
| `primary` | data-a=SIMULATE → `lot.simulation`; demais → `lot.details` |
| `openFind` | `map.view` |
| `closeFind` | `map.view` |
| `clearAll` | `map.view` |
| `fchip` | `map.view` |
| `incUnknown` | `map.view` |
| `flevel` | `map.view` |
| `fmToggle` | `map.view` |
| `status` | `map.view` |
| `legendItem` | `map.view` |
| `legendFilter` | `map.view` |
| `overlay` | `map.view` |
| `layersReset` | `map.view` |
| `layers` | `map.view` |
| `legendToggle` | `map.view` |
| `bg` | `map.view` |
| `goLot` | `lot.details` |
| `closeLot` | `lot.details` |
| `sec` | `lot.details` |
| `secJump` | `lot.details` |
| `prov` | `lot.details` |
| `backLot` | `lot.details` |
| `sugg` | `lot.details` |
| `lightbox` | `lot.details` |
| `route` | `lot.details` |
| `copyId` | `lot.details` |
| `preset` | `recommendation` |
| `clearPrefs` | `recommendation` |
| `recScope` | `recommendation` |
| `recShowReview` | `recommendation` |
| `explain` | `recommendation` |
| `clearProfile` | `customer.profile` |
| `filtersToConstraints` | `customer.profile` |
| `custPick` | `customer.profile` |
| `custDel` | `customer.profile` |
| `custAddLot` | `customer.profile` |
| `custRemoveLot` | `customer.profile` |
| `custCompare` | `customer.profile` |
| `custAdd` | `customer.profile` |
| `techExplain` | `mode.technical` |
| `fav` | `lot.favorite` |
| `cmp` | `lot.compare` |
| `cmpRemove` | `lot.compare` |
| `cmpClear` | `lot.compare` |
| `share` | `share.lots` |
| `shareCmp` | `share.lots` |
| `copyText` | `share.lots` |
| `copyLink` | `share.lots` |
| `shareCust` | `share.customer` |
| `simExpand` | `lot.simulation` |
| `season` | `lot.analysis` |
| `hourPreset` | `lot.analysis` |
| `play` | `lot.analysis` |
| `refresh` | `data.refresh` |
| `cmpBarToggle` | `lot.compare` |
| `custClear` | `customer.profile` |

Controles só de interface (sem dado de servidor): `zoomIn`, `zoomOut`, `fit`, `full`, `closePop`, `closeModal`, `sheetUp`, `sheetDown`, `appUpdate`, `reload`, `clearLocal`, `clearLocalGo`, `retryRegion`, `toggleRight`, `shortcutHelp`. Qualquer outro data-act é negado (`UNMAPPED_ACTION`) e o teste `security.test.js` falha até ele entrar na matriz.

## RoutePermissionMatrix

| Rota/visão | Funcionalidade |
|---|---|
| `map` | `map.view` |
| `compare` | `lot.compare` |
| `development` | `development.info` |
| `admin/availability` | `availability.edit` |
| `admin/pricing` | `pricing.publish` |
| `admin/analysis` | `analysis.preview` |
| `admin/audit` | `audit.view` |
| `clients` | `customer.profile` |

Seções do detalhe do lote: summary → `lot.details`, geometry → `lot.details`, location → `lot.details`, surroundings → `lot.details`, mobility → `lot.details`, comfort → `lot.analysis`, construction → `lot.details`, commercial → `lot.price`, intelligence → `lot.analysis`, sources → `lot.details`.

## Como adicionar uma permissão (critério de manutenção)

1. Criar a chave no backend (fonte) e espelhar em `config/security/permissions.json` (risco, escopos, anônimo, online, motivo).
2. Concedê-la nos templates em `roles.json` (o backend decide as concessões reais).
3. Mapear funcionalidade/ação/rota em `features.json`.
4. Rodar `npm test` (valida chaves, concessões, matriz e este documento) e regenerar este arquivo.
5. Definir política de auditoria se HIGH/CRITICAL.
