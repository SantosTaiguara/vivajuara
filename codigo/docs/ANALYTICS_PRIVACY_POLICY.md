# Privacidade no analytics

> Gerado por `node scripts/privacyDocs.js` a partir de `config/analytics/policy.json` (tópico 45) e `config/privacy/policies.json`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

- Analytics de primeira parte, pseudônimo, só em memória da aba (`persistOffline = false`); nada sai do aparelho.
- Chaves proibidas e detectores de e-mail/telefone/CPF do tópico 45 são reutilizados por `analyticsPayloadCheck` (golden PrivacyAnalyticsRejectsEmail).
- Id anônimo aleatório por sessão; sem fingerprinting; pseudônimo continua dado pessoal.
- Orçamento só em faixas; supressão de coortes pequenas nos relatórios futuros.
- Pixels de marketing (Meta/Google) só via Privacy Change Gate. Retenção `RET_ANALYTICS`: a validar.

Tecnologias registradas:

| Id | Provedor | Nome | Categoria | Ligada por padrão | Transferências |
|---|---|---|---|---|---|
| TT_LS_STATE | primeira parte | localStorage ws:<dev>:state | FUNCTIONAL | sim | — (necessita validação) |
| TT_LS_DEVICE_ID | primeira parte | localStorage vj-device-id | FUNCTIONAL | sim | — (necessita validação) |
| TT_IDB_FAVORITES | primeira parte | IndexedDB ws-favorites | FUNCTIONAL | sim | — (necessita validação) |
| TT_ANALYTICS_MEMORY | primeira parte | Analytics local em memória | ANALYTICS | sim | — (necessita validação) |
| TT_GOOGLE_FONTS | Google | Requisição às fontes | FUNCTIONAL | sim | TR_GOOGLE_FONTS |
| TT_SESSION_COOKIE | primeira parte (backend) | Cookie __Host-plat_session / plat_oauth | STRICTLY_NECESSARY | não | — (necessita validação) |
