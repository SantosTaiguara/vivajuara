# Registro de fornecedores (privacidade)

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/thirdParties.json`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Nenhum fornecedor aprovado. Aprovação (`approveVendor`) exige contrato/DPA, avaliação de segurança, papel avaliado, região conhecida e, fora do Brasil, transferência ATIVA com mecanismo e evidência. Mudança de região volta para revisão. Desligamento exige revogar acesso e tokens e confirmar devolução/eliminação.

| Id | Fornecedor | Serviços | Papel | Categorias | Regiões | Contrato | Status | Evidência no código |
|---|---|---|---|---|---|---|---|---|
| V_GOOGLE_OIDC | Google (login OIDC) | Login com Google (backend/src/modules/auth) | — (necessita validação) | AUTHENTICATION, IDENTITY | — (necessita validação) | — (necessita validação) | PENDING_REVIEW | backend/src/modules/auth/google.oidc.js; client ID ainda não criado |
| V_GOOGLE_FONTS | Google Fonts | CSS e arquivos de fonte do painel (fonts.googleapis.com, fonts.gstatic.com) | — (necessita validação) | DEVICE_TECHNICAL | — (necessita validação) | — (necessita validação) | PENDING_REVIEW | config/security/browserPolicy.json thirdParty: IP e User-Agent do visitante; decisão D50-3 (auto-hospedar) |
| V_ARTIFACT_HOST | Host de artefatos do claude.ai (painel publicado) | Hospedagem do painel estático | — (necessita validação) | DEVICE_TECHNICAL | — (necessita validação) | — (necessita validação) | PENDING_REVIEW | docs/OFFLINE_CACHE_ARCHITECTURE.md (host de artefatos do claude.ai); o painel não envia dado de cliente ao host |
| V_WHATSAPP | WhatsApp (link wa.me aberto pelo corretor) | Abrir conversa com texto pronto | — (necessita validação) | IDENTITY | — (necessita validação) | — (necessita validação) | PENDING_REVIEW | src/services/share.js whatsappUrl: o nome opcional do cliente vai no texto da URL |
| V_DB_HOSTING | Hospedagem do Postgres e da API (a definir) | Banco e API do backend | — (necessita validação) | AUTHENTICATION, IDENTITY | — (necessita validação) | — (necessita validação) | PENDING_REVIEW | backend/ (provedor não escolhido) |
| V_CRM_EXTERNAL | CRM externo (ex.: Kenlo) — não integrado | — (necessita validação) | — (necessita validação) | — (necessita validação) | — (necessita validação) | — (necessita validação) | PENDING_REVIEW | nenhuma integração no código; política de campos vazia (nenhum campo sai) |

Políticas de integração (sem sync cego, §129): `V_CRM_EXTERNAL`: campos permitidos — (necessita validação); proibidos customer.cpf, customer.notes, legacyCustomer.profile.constraints.budget.
