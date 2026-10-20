# Registro de transferências internacionais

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/thirdParties.json`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Detectadas a partir do código (fornecedores com servidores potencialmente fora do Brasil). Nacionalidade da empresa não é localização do dado (§134): todas ficam UNDER_REVIEW sem destino nem mecanismo. Mecanismos aceitos (Res. CD/ANPD nº 19/2024, por política, nunca "equivalente" próprio): ADEQUACY, STANDARD_CONTRACTUAL_CLAUSES, SPECIFIC_CONTRACTUAL_CLAUSES, GLOBAL_CORPORATE_RULES, SPECIFIC_CONSENT, OTHER_LGPD_ART33_MECHANISM.

| Id | Atividade | Importador | Destino | Categorias | Mecanismo | Evidência | Status |
|---|---|---|---|---|---|---|---|
| TR_GOOGLE_OIDC | PA_GOOGLE_LOGIN | V_GOOGLE_OIDC | — (necessita validação) | AUTHENTICATION, IDENTITY | — (necessita validação) | — (necessita validação) | UNDER_REVIEW |
| TR_GOOGLE_FONTS | PA_PUBLIC_PANEL_HOSTING | V_GOOGLE_FONTS | — (necessita validação) | DEVICE_TECHNICAL | — (necessita validação) | — (necessita validação) | UNDER_REVIEW |
| TR_ARTIFACT_HOST | PA_PUBLIC_PANEL_HOSTING | V_ARTIFACT_HOST | — (necessita validação) | DEVICE_TECHNICAL | — (necessita validação) | — (necessita validação) | UNDER_REVIEW |
| TR_WHATSAPP | PA_SHARE_WHATSAPP_TEXT | V_WHATSAPP | — (necessita validação) | IDENTITY | — (necessita validação) | — (necessita validação) | UNDER_REVIEW |

Mapa: Brasil → Google (login OIDC, fontes) / ? · Brasil → host de artefatos claude.ai / ? · Brasil → WhatsApp (link aberto pelo corretor) / ? · Postgres/API: provedor a escolher.
