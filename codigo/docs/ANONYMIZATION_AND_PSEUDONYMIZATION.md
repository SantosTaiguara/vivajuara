# Anonimização e pseudonimização

> Gerado por `node scripts/privacyDocs.js` a partir de arquivos do tópico 59. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

- Remover o nome não é anonimizar (§114). Pseudonimização (hash, id do aparelho, id anônimo de analytics) **não** é anonimização: continua dado pessoal (§115–116, §282).
- O código usa hash (sha256 com separação de domínio no backend; FNV no navegador para logs) sempre como pseudônimo.
- Ação ANONYMIZE do DeletionPlan só com política de retenção aprovada com destino ANONYMIZE; o método de anonimização precisa de aprovação (AnonymizationJob, §117) e avaliação de risco de reidentificação (§118) — não implementado: depende do backend e de decisão.
- Ambientes de teste usam só dados sintéticos (§220–224); cópia de produção para staging é proibida sem mascaramento aprovado.
