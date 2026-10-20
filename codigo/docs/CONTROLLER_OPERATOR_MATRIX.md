# Matriz controlador / operador

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/governance.json` (controllerOperatorMatrix). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

A plataforma não assume papel jurídico (§514–517): "House 7 = controladora de tudo" não é hardcode. Cada "?" é decisão do jurídico/negócio.

| Atividade | House 7 | Loteadora | Provedor |
|---|---|---|---|
| LEAD_INTAKE | ? | ? | - |
| LOT_RECOMMENDATION | ? | - | - |
| RESERVATION_PROCESS | ? | ? | - |
| SIGNATURE_PROCESS | ? | ? | ? |
| PRODUCT_ANALYTICS | ? | - | ? |
| SECURITY (login Google) | ? | - | ? |

Fornecedores: todos com `processingRole = null` (ver VENDOR_PRIVACY_REGISTER). Em multi-tenant futuro, o operador da plataforma tem papel próprio para conta, cobrança, segurança e telemetria (§420).
