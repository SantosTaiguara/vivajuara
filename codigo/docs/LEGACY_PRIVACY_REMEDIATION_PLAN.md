# Plano de remediação do legado

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/governance.json` (legacyFindings). Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Migração primeiro, sem apagar tudo de imediato (§434).

| Achado | Onde | Tipo | Severidade | Remediação |
|---|---|---|---|---|
| LPF_LOCAL_CUSTOMER_NAMES | localStorage ws:<dev>:state → prefs.customers[] (src/state/store.js save; criado em src/presentation/app.js 'custAdd') | NO_BASIS_RECORD | MEDIUM | Decisão D59-1: manter nomes no aparelho (com base legal validada e aviso) ou passar a guardar só um apelido/id. Até lá: Central de privacidade permite exportar e apagar; nada é enviado. |
| LPF_SHARE_NAME_IN_URL | src/services/share.js whatsappUrl (wa.me/?text=) com o nome opcional digitado no modal Compartilhar | UNCONTROLLED_SHARING | MEDIUM | Decisão D59-2: o nome vai na URL do WhatsApp (terceiro) quando o corretor o digita. Opções: aviso no campo, só primeiro nome, ou copiar texto sem URL. |
| LPF_GOOGLE_FONTS | fonts.googleapis.com / fonts.gstatic.com (todas as páginas) | UNCONTROLLED_SHARING | LOW | Decisão D50-3 (auto-hospedar as fontes) elimina o terceiro e a possível transferência internacional. |
| LPF_DEVICE_ID | localStorage vj-device-id | NO_BASIS_RECORD | LOW | Id pseudônimo (não é anônimo): registrar finalidade/base; apagado em 'Apagar tudo deste aparelho'. |
| LPF_LOCAL_BUDGET | localStorage ws:<dev>:state → prefs.constraints (orçamento da sessão de trabalho) | NO_BASIS_RECORD | LOW | Incluído em 'Apagar dados pessoais deste aparelho'. |

Passos:
1. Jurídico valida bases legais e retenção das finalidades CUSTOMER_RELATIONSHIP, LOT_RECOMMENDATION, PRODUCT_ANALYTICS e SECURITY (desbloqueia L2).
2. Decidir D59-1 (nomes no aparelho) e D59-2 (nome na URL do WhatsApp).
3. Ligar a Central de privacidade no painel (coordenador) — já permite ao usuário exportar/apagar.
4. Avaliar fornecedores e transferências (Google, host do painel, WhatsApp, banco).
5. Registrar encarregado e aviso de privacidade.
6. Ao persistir clientes no backend: RIPD, locators/adapters por domínio, jobs de retenção com dry-run.
7. Fora do código (§431): planilhas, CSVs, Drive, listas de WhatsApp e leads importados precisam do mesmo inventário (LeadSourcePrivacyAssessment antes de importar lista).
