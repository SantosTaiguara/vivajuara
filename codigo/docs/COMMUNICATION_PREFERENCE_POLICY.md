# Preferências de comunicação e supressão

> Gerado por `node scripts/privacyDocs.js` a partir de `src/privacy/privacyWorkflow.js` (canContact, suppression). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

- Canais WHATSAPP, EMAIL, SMS, PHONE × finalidades SERVICE, TRANSACTIONAL, MARKETING; estado ALLOWED / NOT_ALLOWED / UNKNOWN.
- Marketing só com ALLOWED **e** referência de base (`basisRef`). UNKNOWN nunca vira permitido.
- Opt-out de marketing não bloqueia mensagem transacional/de serviço (§170).
- Lista de supressão guarda só sha256 de domínio separado do contato normalizado, canal, finalidade, motivo e data (§171–173); impede recontato e reimportação.
- Sinal para o corretor em português simples: "Marketing WhatsApp: não permitido" (`App.privacyView.contactSignal`).
- Contas pessoais de WhatsApp são risco alto de governança; preferir canal aprovado (decisão de negócio).
