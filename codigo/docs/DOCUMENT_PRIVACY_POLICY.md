# Privacidade de documentos

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/policies.json` (documentExtraction). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Documentos pessoais (tópico 57) são RESTRICTED; miniaturas herdam a classificação; texto extraído não fica indefinidamente; busca respeita permissão; downloads auditáveis; links expiram (tópico 34: URL assinada curta).

Extração só de campos aprovados (§340–341, `filterExtraction`). Hoje nada está aprovado (`NOTHING_ALLOWED_YET`):

| Tipo de documento | Campos permitidos | Campos proibidos | Finalidade | Status |
|---|---|---|---|---|
| IDENTITY_DOCUMENT | — (necessita validação) | biometric, photo, fatherName, motherName, birthPlace | CONTRACT_PREPARATION | NECESSITA_CONFIRMACAO |
| PROOF_OF_ADDRESS | — (necessita validação) | consumption, billAmount | CONTRACT_PREPARATION | NECESSITA_CONFIRMACAO |
