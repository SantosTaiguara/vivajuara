# Gestão de consentimento

> Gerado por `node scripts/privacyDocs.js` a partir de `src/privacy/privacyWorkflow.js`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

- Consentimento só onde é o fundamento validado da finalidade (§31). Sem base aprovada: `NO_APPROVED_BASIS` (estado atual de todas as finalidades).
- Um consentimento = uma finalidade específica; "aceito tudo" é recusado (`GENERIC_CONSENT_FORBIDDEN`).
- Prova: finalidade, versão do aviso (`noticeVersionId`), checksum sha256 do texto exato apresentado (`NOTICE_CHECKSUM_MISMATCH` se diferente), momento, meio de coleta e evidência ou contexto (clique simples sem evidência é recusado).
- Revogação: novo estado WITHDRAWN com `withdrawnAt`; o registro original não é apagado (append-only, tabela `privacy_consent_records` sem UPDATE/DELETE de prova). O resultado lista atividades paradas, categorias mantidas por outra finalidade validada (com motivo) e jobs de eliminação (só se houver retenção aprovada com gatilho CONSENT_WITHDRAWAL; senão `PRIVACY_REVIEW_REQUIRED`).
- Expirado ou revogado → finalidade indisponível (`CONSENT_EXPIRED`, `CONSENT_WITHDRAWN`).
- Migração: consentimento genérico antigo não cobre finalidade nova (§430).
