# Privacidade no PWA, cache e armazenamento do navegador

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/policies.json` (browserStorage) e `src/privacy/deviceData.js`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

- Customer PII → memória/online; persistência offline de cliente desligada (`customerOfflinePersistence = false`, igual a `config/customer/policy.json`).
- NEVER_PERSIST no navegador: DOCUMENT_IDENTIFIER, SIGNATURE_DATA, AUTHENTICATION, COMMUNICATION_HISTORY, SENSITIVE_OTHER (`mayPersist`).
- O pacote offline já descarta notas, cliente, contato, CPF e tokens (`src/pwa/offlinePack.js`).
- Exceção existente no código: nomes e perfis de clientes de trabalho em `ws:<dev>:state` (achado LPF_LOCAL_CUSTOMER_NAMES).
- Central de privacidade do aparelho: exportar (JSON com checksum, nome de arquivo sem PII), "Apagar dados pessoais deste aparelho" (remove clientes, favoritos, filas; mantém preferências de tela) e "Apagar tudo deste aparelho".
- Sair da conta deve limpar caches sensíveis quando houver login no painel (decisão pendente do tópico 49).

Inventário: ver PERSONAL_DATA_INVENTORY (18 entradas, 9 com dado pessoal).
