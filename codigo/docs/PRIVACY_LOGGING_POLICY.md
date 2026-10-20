# Política de logs (LogDataPolicy)

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/policies.json` (logData). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

`sanitizeForLog` aplica a política por classe de campo e ainda remove strings com e-mail, CPF, telefone, Bearer ou JWT. Trace/métrica nunca com nome (§217). Id interno opaco só em hash.

| Classe de campo | Regra | Substituição |
|---|---|---|
| cpf | DENY |  |
| rg | DENY |  |
| password | DENY |  |
| token | DENY |  |
| authorization | DENY |  |
| cookie | DENY |  |
| secret | DENY |  |
| document | DENY |  |
| signature | DENY |  |
| proposalterms | DENY |  |
| notes | DENY |  |
| email | REDACT | [e-mail removido] |
| phone | REDACT | [telefone removido] |
| name | REDACT | [nome removido] |
| address | REDACT | [endereço removido] |
| budget | REDACT | [valor removido] |
| customerid | HASH |  |
| subjectref | HASH |  |
| userid | HASH |  |

Backend: o logger existente já redige; os módulos novos (`backend/src/modules/privacy`) só registram ids e códigos.
