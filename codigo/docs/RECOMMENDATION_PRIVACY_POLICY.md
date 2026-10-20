# Privacidade na recomendação

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/policies.json` (recommendationCriteria, sensitiveTraits). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Todo critério de recomendação precisa estar na allowlist (§351). Critério não listado → `NOT_ALLOWLISTED`; traço sensível → `SENSITIVE_TRAIT` (nunca religião, saúde, raça, orientação sexual, opinião política, filhos, idade…). Critérios atuais vêm de `config/customer/policy.json` (profileBuilderGroups); todos são do imóvel, financeiros ou de estilo de vida declarado. `reviewedBy = null`: revisão pendente.

| Critério | Permitido | Categoria | Motivo | Revisado por |
|---|---|---|---|---|
| budget | sim | FINANCIAL_DECLARED | Critério financeiro informado pelo cliente. | — (necessita validação) |
| area | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |
| areaRange | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |
| solar | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |
| quiet | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |
| lowTraffic | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |
| privacy | sim | CUSTOMER_PREFERENCE | Privacidade do lote (vizinhança), não dado da pessoa. | — (necessita validação) |
| leisure | sim | CUSTOMER_PREFERENCE | Estilo de vida declarado (proximidade do lazer). | — (necessita validação) |
| gate | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |
| green | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |
| view | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |
| investment | sim | CUSTOMER_PREFERENCE | Objetivo declarado (lente de score do lote). | — (necessita validação) |
| priceQuality | sim | CUSTOMER_PREFERENCE | Lente de score do lote. | — (necessita validação) |
| geometry | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |
| housing | sim | CUSTOMER_PREFERENCE | Lente de score do lote. | — (necessita validação) |
| family | sim | CUSTOMER_PREFERENCE | Score do lote para uso familiar escolhido pelo corretor; nunca inferido da composição familiar do cliente. | — (necessita validação) |
| premium | sim | CUSTOMER_PREFERENCE | Lente de score do lote. | — (necessita validação) |
| noCorner | sim | CUSTOMER_PREFERENCE | Característica do imóvel. | — (necessita validação) |

Traços bloqueados: religion, religiao, health, saude, disability, deficiencia, sexualOrientation, orientacaoSexual, politicalOpinion, opiniaoPolitica, race, raca, ethnicity, etnia, biometric, biometria, genetic, genetico, unionMembership, sindicato, pregnancy, gravidez, age, idade, nationality, nacionalidade, maritalStatus, estadoCivil, children, filhos.
