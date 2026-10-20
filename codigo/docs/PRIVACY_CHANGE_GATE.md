# Privacy Change Gate

> Gerado por `node scripts/privacyDocs.js` a partir de `src/privacy/privacyCore.js` (assessChange). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Toda feature com tratamento novo passa por `assessChange` (checklist obrigatório, não interpretação jurídica):
- PASS: nada novo.
- REVIEW_REQUIRED: novas categorias, finalidades, destinatários, transferências, mudança de retenção, perfilamento.
- BLOCKED: critério sensível de recomendação; dado sensível sem avaliação de risco; transferência nova para fornecedor não aprovado.
Também indica se exige atualizar aviso, revisar consentimento ou avaliar risco. Exemplo §152 (WhatsApp/CRM) coberto em teste. Pixels de marketing, LLM com dados de cliente e monitoramento de erros de terceiros passam por aqui.

Exceções (`exceptionStatus`): sempre com validade, motivo e aprovador; bloqueios legais (NO_APPROVED_BASIS, TRANSFER_WITHOUT_MECHANISM, SENSITIVE_DATA_WITHOUT_ASSESSMENT) só com parecer jurídico. Sem "exceção temporária permanente".
