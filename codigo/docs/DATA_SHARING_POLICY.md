# Política de compartilhamento

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/thirdParties.json` (dataSharingArrangements, transactionDisclosurePolicies). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

- Nenhum compartilhamento registrado (`dataSharingArrangements = []`). Loteadora, assinatura e CRM entram aqui antes de receber dado.
- Divulgação por fase (PROPOSAL / RESERVATION / CLOSING) com campos permitidos vazios até aprovação; proposta exige menos que contrato.
- Share de cliente (tópico 42) = projeção client-safe; `checkClientSafe` falha com notas internas, CPF, telefone, e-mail, orçamento, nome ou token (golden PrivacyShareProjectionNoInternalNotes usa `App.presentationMode.projection.lotCard` real).
- Conectores nunca recebem o Customer inteiro: `filterOutbound` aplica allowlist de campos e exige fornecedor APPROVED.
- Achado: o nome opcional digitado no modal Compartilhar vai na URL wa.me (LPF_SHARE_NAME_IN_URL, decisão D59-2). Comportamento não alterado.
