# Política de avaliação de base legal

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/registries.json` (legalBasisAssessments, legalBasisCodes). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Regras executadas por `App.privacy.core`:
- A base legal **nunca é inferida** pelo código (§25). Só conta um `LegalBasisAssessment` com `status = APPROVED`, `legalBasisCode` de uma lista suportada, `rationale` e `assessedBy` preenchidos (`approvedBasis`). Senão: `NO_APPROVED_BASIS` e o tratamento é negado.
- CONSENT não é base padrão (§28). Consentimento só pode ser registrado para finalidade cuja base aprovada é CONSENT (`CONSENT_NOT_LEGAL_BASIS`).
- Dado sensível exige código do art. 11 (`SENSITIVE_REQUIRES_ART11`).
- Origem do contato não é base legal (§270).

Códigos suportados (art. 7º): CONSENT, LEGAL_OR_REGULATORY_OBLIGATION, CONTRACT_OR_PRECONTRACTUAL_PROCEDURES, REGULAR_EXERCISE_OF_RIGHTS, LEGITIMATE_INTEREST, CREDIT_PROTECTION, OTHER_LGPD_ART7_BASIS. Art. 11: LGPD_ART11_CONSENT, LGPD_ART11_LEGAL_OBLIGATION, LGPD_ART11_REGULAR_EXERCISE_OF_RIGHTS, LGPD_ART11_FRAUD_SECURITY, OTHER_ART11.

| Avaliação | Finalidade | Classe | Base legal | Justificativa | Responsável | Status | Validação |
|---|---|---|---|---|---|---|---|
| LBA_LEAD_INTAKE | LEAD_INTAKE | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_CUSTOMER_RELATIONSHIP | CUSTOMER_RELATIONSHIP | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_LOT_RECOMMENDATION | LOT_RECOMMENDATION | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_FINANCIAL_SIMULATION | FINANCIAL_SIMULATION | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_PROPOSAL_PREPARATION | PROPOSAL_PREPARATION | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_RESERVATION_PROCESS | RESERVATION_PROCESS | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_CONTRACT_PREPARATION | CONTRACT_PREPARATION | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_SIGNATURE_PROCESS | SIGNATURE_PROCESS | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_CUSTOMER_SUPPORT | CUSTOMER_SUPPORT | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_LEGAL_COMPLIANCE | LEGAL_COMPLIANCE | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_SECURITY | SECURITY | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_FRAUD_PREVENTION | FRAUD_PREVENTION | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_PRODUCT_ANALYTICS | PRODUCT_ANALYTICS | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |
| LBA_MARKETING_COMMUNICATION | MARKETING_COMMUNICATION | PERSONAL | — (necessita validação) | — (necessita validação) | — (necessita validação) | DRAFT | NECESSITA_VALIDACAO_JURIDICA |

Pendentes: 14 de 14. Aprovadas: 0.
