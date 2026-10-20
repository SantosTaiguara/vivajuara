# Verificação de identidade do titular

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/lifecycle.json` (identityVerificationMethods, requestRisk). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Proporcional ao risco (§73–74): pedido simples não exige documento. Métodos fora do risco do pedido são recusados (`VERIFICATION_NOT_PROPORTIONAL`). Evidência com retenção curta (`RET_IDENTITY_VERIFICATION`, prazo a validar).

| Método | Descrição | Riscos aceitos |
|---|---|---|
| AUTHENTICATED_SESSION | Sessão autenticada do próprio titular (portal futuro) | LOW, MEDIUM |
| KNOWN_CONTACT_CONFIRMATION | Confirmação pelo canal de contato já cadastrado | LOW, MEDIUM |
| DOCUMENT_CHECK_BY_DPO | Conferência documental pelo encarregado (somente risco alto) | HIGH |

Risco por tipo: CONFIRM_PROCESSING=LOW, ACCESS=HIGH, CORRECTION=MEDIUM, ANONYMIZATION=HIGH, BLOCKING=MEDIUM, DELETION=HIGH, PORTABILITY=HIGH, SHARING_INFORMATION=MEDIUM, CONSENT_INFORMATION=LOW, CONSENT_WITHDRAWAL=LOW, OBJECTION=MEDIUM, AUTOMATED_DECISION_REVIEW=MEDIUM, OTHER=MEDIUM (proposta técnica; necessita validação). Representante legal: `representative.proofRef` (restrito).
