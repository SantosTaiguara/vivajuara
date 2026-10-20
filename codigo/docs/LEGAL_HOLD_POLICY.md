# Legal hold

> Gerado por `node scripts/privacyDocs.js` a partir de `src/privacy/privacyWorkflow.js`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

- Exige motivo e organização; pode cobrir titular, entidades e categorias.
- Suspende a eliminação aplicável: o plano marca RETAIN com motivo LEGAL_HOLD e a explicação do hold.
- **Não autoriza outras finalidades** (§110): dado mantido só por hold (`retainedForDeletion`) fica restrito a `allowedPurposeIds` (padrão LEGAL_COMPLIANCE); marketing recebe `LEGAL_HOLD_PURPOSE_ONLY`.
- Liberação registra quem e quando; outra organização recebe NOT_FOUND.
- Estado operacional do titular: LEGAL_HOLD (não exibido em telas de cliente).
