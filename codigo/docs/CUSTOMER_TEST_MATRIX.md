# Matriz de testes — Customer (Tópico 39)

Arquivo: `tests/customerDomain.test.js` (23 testes).

| Cenário dourado (§79) | Teste |
|---|---|
| MinimalPersonCustomer | id opaco/imutável, tenant obrigatório, sem contato/perfil, revisão, arquivamento |
| OrganizationCustomer | detalhes de organização |
| CustomerWithWhatsAppContact | E.164, inválido não corrigido, UNVERIFIED |
| CustomerWithUnknownConsent | contato ≠ consentimento, REVOKED, sem retenção inventada |
| CustomerAssignmentOwnerCollaborator | um OWNER, assignment ≠ RBAC, níveis |
| CustomerPreferenceProfileVersioning | V1 congelada, V2, sem versão para conteúdo igual, snapshot mínimo |
| CustomerBudgetUnknown | desconhecido ≠ 0, UNDECIDED ≠ UNKNOWN, completude |
| CustomerHardConstraintExplicit | preferência ≠ restrição; sugestão inativa |
| CustomerFitFromProfileSnapshot | Fit idêntico ao painel nos 498 lotes; Base Score inalterado |
| CustomerRecommendationFromProfileSnapshot | R(V1) preservada; lotes seguem UNKNOWN |
| CustomerFavoritesByContext | contexto CUSTOMER; troca preserva mapa/filtros/lote |
| CustomerSwitchGuardComparison | guard não bloqueia; comparação não reescrita |
| CustomerDuplicateByPhoneReview | OPEN, SUGGEST_ONLY, nome sozinho fraco, só mesmo tenant |
| CustomerDuplicateByExternalRef | SAME_EXTERNAL_REF; ingestão MATCHED/REPLAY |
| CustomerMergeWithAlias | revisão, decisão de perfil, alias sem cadeia, idempotência, cross-tenant |
| CustomerMergePreservesFavorites | favoritos CUSTOMER remapeados, pessoais intactos |
| CustomerArchivedHistoricalRecommendation | leitura somente; anonimização lógica |
| CustomerExternalMasterConflict | modo obrigatório; MANUAL_REVIEW; fingerprints |
| CustomerCrossTenantDenied | NOT_FOUND; deny by default no authz |
| CustomerPIIRedaction | projeções, máscaras, eventos/logs sem PII, header sem telefone |

Também: deep link sem PII, serviços (deny, IDOR, busca visível, última busca vence, auditoria sem PII, logout), módulos sem localStorage/console, migração legada idempotente, textos sem promessa de valorização.

Não testável aqui: endpoints/DB (sem backend Customer), sincronização Kenlo, cache offline (desligado por padrão).
