# Encarregado (DPO) e governança

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/governance.json` (dpo, tenantConfig, regulatoryChanges). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Registro do encarregado: **vazio, necessita confirmação** da organização (Res. CD/ANPD nº 18/2024). A Central de privacidade mostra "não configurado" até lá. Encarregado não vira superadmin técnico (§141): nenhuma permissão é concedida pela função.

| Campo | Valor |
|---|---|
| organizationId | org_house7 |
| type | ORGANIZATION |
| publicDisplayName | House 7 Imobiliária |
| publicContactChannel | — (necessita validação) |
| appointmentDocumentRef | — (necessita validação) |
| effectiveFrom | — (necessita validação) |
| effectiveTo | — (necessita validação) |
| conflictAssessmentRef | — (necessita validação) |
| status | — (necessita validação) |
| configurationStatus | NECESSITA_CONFIRMACAO |
| decision | Encarregado definido por Edmilson Margon em 2026-10-18. Falta o canal público de contato (e-mail/página) e o documento de nomeação. |

Configuração por organização: `org_house7` controlador — (necessita validação), avisos — (necessita validação). O aviso da House 7 não vale automaticamente para outro tenant (§425).

Mudanças regulatórias acompanhadas:

| Id | Instrumento | Vigência | Políticas afetadas | Revisão |
|---|---|---|---|---|
| REG_ANPD_15_2024 | Resolução CD/ANPD nº 15/2024 (comunicação de incidente) | 2024-04-26 | INCIDENT_NOTIFICATION_ANPD, INCIDENT_NOTIFICATION_SUBJECTS | PENDING |
| REG_ANPD_18_2024 | Resolução CD/ANPD nº 18/2024 (encarregado) | 2024-07-17 | dpo | PENDING |
| REG_ANPD_19_2024 | Resolução CD/ANPD nº 19/2024 (transferência internacional) | 2024-08-23 | internationalTransfers | PENDING |

Documentos de política previstos: PRIVACY_GOVERNANCE_POLICY, RETENTION_POLICY, DATA_SUBJECT_RIGHTS_POLICY, CONSENT_POLICY, VENDOR_PRIVACY_POLICY, INCIDENT_PRIVACY_POLICY, INTERNATIONAL_TRANSFER_POLICY, TRACKING_POLICY, AI_DATA_USE_POLICY (todos a redigir e aprovar).
