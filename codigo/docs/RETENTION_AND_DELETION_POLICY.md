# Política de retenção e eliminação

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/lifecycle.json`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

- Nenhum prazo foi inventado (§519–521). `duration = null` → `PRIVACY_REVIEW_REQUIRED`, nunca "para sempre"; a validação recusa `forever`.
- Eliminação ≠ DELETE da linha (§92). `planDeletion` produz um DeletionPlan por domínio/categoria: DELETE / ANONYMIZE / BLOCK / RETAIN, sempre com motivo. Categorias sem decisão de retenção ficam RETAIN + `PRIVACY_REVIEW_REQUIRED` e o plano não pode ser aprovado.
- Execução só de plano aprovado nominalmente; idempotente (`alreadyDone`); cada domínio executa pelo seu adapter (§304–305), sem SQL transversal.
- Cada eliminação gera DeletionTombstone sem o valor apagado (§105–107), usado para suprimir restauração de backup e reimportação (`guardImport`).
- Dry-run antes de qualquer execução (`retentionDryRun`: candidatos, legal holds, bloqueios, revisões, por domínio). Sem limiar aprovado, toda execução exige aprovação.
- Propagação para índices, caches e conectores: `SubjectDeletionPropagation` com status por sistema.

| Política | Categorias | Finalidades | Gatilho | Prazo | Destino | Retém em pedido de eliminação | Aprovado por | Status | Nota |
|---|---|---|---|---|---|---|---|---|---|
| RET_CUSTOMER_CORE | IDENTITY | CUSTOMER_RELATIONSHIP, LEAD_INTAKE | LAST_INTERACTION | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_CUSTOMER_CONTACT | CONTACT | LEAD_INTAKE, CUSTOMER_RELATIONSHIP | LAST_INTERACTION | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_CUSTOMER_PROFILE | CUSTOMER_PREFERENCE, FINANCIAL_DECLARED, FINANCIAL_INFERRED, CUSTOMER_BEHAVIOR | LOT_RECOMMENDATION, FINANCIAL_SIMULATION | LAST_INTERACTION | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_COMMERCIAL_HISTORY | COMMERCIAL_HISTORY | CUSTOMER_RELATIONSHIP | LAST_INTERACTION | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_COMMUNICATION | COMMUNICATION_HISTORY | CUSTOMER_RELATIONSHIP, CUSTOMER_SUPPORT | LAST_INTERACTION | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_TRANSACTION | IDENTITY, ADDRESS, MARITAL_STATUS, COMMERCIAL_HISTORY | PROPOSAL_PREPARATION, RESERVATION_PROCESS, CONTRACT_PREPARATION, LEGAL_COMPLIANCE | TRANSACTION_END | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_DOCUMENTS | DOCUMENT_IDENTIFIER, SIGNATURE_DATA | CONTRACT_PREPARATION, SIGNATURE_PROCESS, LEGAL_COMPLIANCE | CONTRACT_END | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_DEVICE_LOCAL | IDENTITY, CUSTOMER_PREFERENCE, FINANCIAL_DECLARED, CUSTOMER_BEHAVIOR, DEVICE_TECHNICAL | CUSTOMER_RELATIONSHIP | LAST_INTERACTION | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO | Hoje fica no aparelho até o usuário apagar (botão 'Apagar dados locais' ou Central de privacidade). |
| RET_ANALYTICS | ANALYTICS_PSEUDONYMOUS | PRODUCT_ANALYTICS | COLLECTION_DATE | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO | Hoje só em memória da aba (some ao fechar). |
| RET_AUTH_SESSIONS | AUTHENTICATION | SECURITY | CUSTOM_TRIGGER | — (necessita validação) | DELETE | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO | auth.repository.purgeExpired apaga sessões 30 dias após a expiração absoluta (valor técnico do W3, não decisão jurídica) |
| RET_AUDIT | AUTHENTICATION | SECURITY, LEGAL_COMPLIANCE | COLLECTION_DATE | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_SECURITY_LOGS | DEVICE_TECHNICAL | SECURITY, FRAUD_PREVENTION | COLLECTION_DATE | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_BACKUPS | — (necessita validação) | SECURITY | COLLECTION_DATE | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO | Restore suppression por tombstones (DeletionTombstone). |
| RET_MARKETING | IDENTITY, CONTACT | MARKETING_COMMUNICATION | CONSENT_WITHDRAWAL | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO |  |
| RET_PRIVACY_RECORDS | — (necessita validação) | LEGAL_COMPLIANCE | CUSTOM_TRIGGER | — (necessita validação) | REVIEW | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO | Solicitações do titular, consentimentos (prova histórica), tombstones, supressões, incidentes. |
| RET_IDENTITY_VERIFICATION | DOCUMENT_IDENTIFIER | LEGAL_COMPLIANCE | CUSTOM_TRIGGER | — (necessita validação) | DELETE | — (necessita validação) | — (necessita validação) | NECESSITA_CONFIRMACAO | Evidência de verificação: retenção curta quando possível (§76). |
