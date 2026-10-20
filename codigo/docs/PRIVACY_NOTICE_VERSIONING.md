# Versionamento de avisos de privacidade

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/governance.json` (notices). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Nenhum aviso aprovado ainda (`notices = []`; blocker NOTICE_NOT_APPROVED). `createNotice` grava tipo, versão, referência do conteúdo, vigência, aprovador e checksum do texto. Aviso aceito nunca é editado: `supersedeNotice` cria nova versão e marca a antiga com `retiredAt` (mesma versão é recusada). Tipos: GENERAL_PRIVACY, CUSTOMER_COLLECTION, MARKETING, COOKIES, SHARE, OTHER. O aviso deve identificar o controlador correto da organização (white-label não muda o controlador).
