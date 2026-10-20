# DataCategoryRegistry

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/registries.json`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Privacidade (PERSONAL / SENSITIVE_PERSONAL / NON_PERSONAL) e segurança (PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED) são dimensões diferentes (§10).

| Id | Nome | Privacidade | Segurança | Finalidades permitidas | Retenção | Tratamento especial | Ativa |
|---|---|---|---|---|---|---|---|
| IDENTITY | Identificação (nome, apelido) | PERSONAL | CONFIDENTIAL | LEAD_INTAKE, CUSTOMER_RELATIONSHIP, PROPOSAL_PREPARATION, RESERVATION_PROCESS, CONTRACT_PREPARATION, SIGNATURE_PROCESS, CUSTOMER_SUPPORT, LEGAL_COMPLIANCE, MARKETING_COMMUNICATION | RET_CUSTOMER_CORE | NO_URL, NO_LOGS, NO_ANALYTICS, NO_CACHE_KEY, NO_STORAGE_PATH | sim |
| CONTACT | Contato (telefone, e-mail, WhatsApp) | PERSONAL | CONFIDENTIAL | LEAD_INTAKE, CUSTOMER_RELATIONSHIP, PROPOSAL_PREPARATION, RESERVATION_PROCESS, CONTRACT_PREPARATION, CUSTOMER_SUPPORT, MARKETING_COMMUNICATION | RET_CUSTOMER_CONTACT | NO_URL, NO_LOGS, NO_ANALYTICS, NO_CACHE_KEY, MASK_IN_BROAD_LISTS | sim |
| ADDRESS | Endereço | PERSONAL | CONFIDENTIAL | CONTRACT_PREPARATION, LEGAL_COMPLIANCE | RET_TRANSACTION | NO_URL, NO_LOGS, NO_ANALYTICS, NOT_IN_LEAD | sim |
| MARITAL_STATUS | Estado civil / regime de bens | PERSONAL | CONFIDENTIAL | CONTRACT_PREPARATION, LEGAL_COMPLIANCE | RET_TRANSACTION | NOT_IN_LEAD, NO_RECOMMENDATION, NO_ANALYTICS | sim |
| FINANCIAL_DECLARED | Financeiro declarado (orçamento, entrada pretendida) | PERSONAL | CONFIDENTIAL | LOT_RECOMMENDATION, FINANCIAL_SIMULATION, PROPOSAL_PREPARATION | RET_CUSTOMER_PROFILE | NO_EXACT_VALUE_IN_DASHBOARDS, BUCKET_IN_ANALYTICS, NO_URL, NOT_IN_CLIENT_MODE | sim |
| FINANCIAL_INFERRED | Financeiro inferido (capacidade estimada) | PERSONAL | CONFIDENTIAL | — (necessita validação) | RET_CUSTOMER_PROFILE | NOT_COLLECTED_TODAY, REQUIRES_RISK_ASSESSMENT, NO_EXACT_VALUE_IN_DASHBOARDS | não |
| CUSTOMER_PREFERENCE | Preferências do cliente (área, sol, ruído, lazer, objetivo) | PERSONAL | CONFIDENTIAL | LOT_RECOMMENDATION, CUSTOMER_RELATIONSHIP, PROPOSAL_PREPARATION | RET_CUSTOMER_PROFILE | NO_URL, NO_ANALYTICS_RAW | sim |
| CUSTOMER_BEHAVIOR | Comportamento (lotes vistos, favoritos, comparações) | PERSONAL | CONFIDENTIAL | LOT_RECOMMENDATION, CUSTOMER_RELATIONSHIP | RET_CUSTOMER_PROFILE | NO_SENSITIVE_INFERENCE, NO_PROFILING_WITHOUT_REGISTRY | sim |
| COMMERCIAL_HISTORY | Histórico comercial (jornada, propostas, reservas) | PERSONAL | CONFIDENTIAL | CUSTOMER_RELATIONSHIP, PROPOSAL_PREPARATION, RESERVATION_PROCESS, CONTRACT_PREPARATION, LEGAL_COMPLIANCE | RET_COMMERCIAL_HISTORY, RET_TRANSACTION | RETAIN_MINIMIZED_IF_LEGALLY_REQUIRED | sim |
| COMMUNICATION_HISTORY | Histórico de comunicação e notas do corretor | PERSONAL | RESTRICTED | CUSTOMER_RELATIONSHIP, CUSTOMER_SUPPORT | RET_COMMUNICATION | FREE_TEXT_SENSITIVE_WARNING, NOT_IN_SHARE, NOT_IN_CLIENT_MODE, NO_LOGS, NEVER_PERSIST_BROWSER | sim |
| DOCUMENT_IDENTIFIER | Identificador documental (CPF, RG) e documentos pessoais | PERSONAL | RESTRICTED | CONTRACT_PREPARATION, SIGNATURE_PROCESS, LEGAL_COMPLIANCE | RET_DOCUMENTS | NOT_IN_LEAD, NEVER_PERSIST_BROWSER, NO_LOGS, NO_ANALYTICS, NO_URL, MASK_DEFAULT, EXTRACTION_ALLOWLIST | sim |
| SIGNATURE_DATA | Dados de assinatura (evidência do provedor, imagem de assinatura) | PERSONAL | RESTRICTED | SIGNATURE_PROCESS, LEGAL_COMPLIANCE | RET_DOCUMENTS | NEVER_PERSIST_BROWSER, NO_LOGS, PROVIDER_EVIDENCE_PREFERRED | não |
| AUTHENTICATION | Autenticação (sessão, hash do sujeito Google, hash do e-mail de convite) | PERSONAL | RESTRICTED | SECURITY | RET_AUTH_SESSIONS | NEVER_PERSIST_BROWSER, NO_LOGS, HASH_ONLY | sim |
| DEVICE_TECHNICAL | Técnico do aparelho (id pseudônimo do aparelho, IP e User-Agent em requisições) | PERSONAL | INTERNAL | SECURITY, FRAUD_PREVENTION, PRODUCT_ANALYTICS, CUSTOMER_RELATIONSHIP | RET_DEVICE_LOCAL | PSEUDONYMOUS_NOT_ANONYMOUS, NO_FINGERPRINTING | sim |
| ANALYTICS_PSEUDONYMOUS | Analytics pseudônimo (id anônimo de sessão, eventos de uso) | PERSONAL | INTERNAL | PRODUCT_ANALYTICS | RET_ANALYTICS | PSEUDONYMOUS_NOT_ANONYMOUS, NO_DIRECT_PII, SMALL_COHORT_SUPPRESSION, LOCAL_ONLY_TODAY | sim |
| SENSITIVE_OTHER | Dado pessoal sensível (saúde, religião, origem racial, opinião política, vida sexual, biometria…) | SENSITIVE_PERSONAL | RESTRICTED | — (necessita validação) | — (necessita validação) | NO_COLLECTION_BY_DEFAULT, NO_RECOMMENDATION, NO_PROFILING, NO_INFERENCE, ART11_ASSESSMENT_REQUIRED | não |
| LOT_DATA | Dados do lote e do empreendimento (geometria, área, preço de tabela, scores) | NON_PERSONAL | PUBLIC | — (necessita validação) | — (necessita validação) | PERSONAL_IF_LINKED_TO_PERSON | sim |

Dado pseudônimo (id do aparelho, analytics) continua sendo dado pessoal (§116). Hash não anonimiza (§282).
