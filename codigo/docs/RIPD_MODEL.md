# Modelo de RIPD (Relatório de Impacto à Proteção de Dados)

> Gerado por `node scripts/privacyDocs.js` a partir de arquivos do tópico 59. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

O RIPD referencia registros vivos (§148), não um PDF esquecido. Campos (PrivacyImpactReport): atividades (ids do RoPA), versão, descrição dos tipos de dado (DATA_CATEGORY_REGISTRY), metodologia de coleta (PersonalFieldPrivacyMetadata.collectionStage), medidas de segurança (PRIVACY_ARCHITECTURE, tópico 50), referência da análise de risco, mitigações, aprovador, data, status DRAFT/APPROVED/SUPERSEDED.

Candidatos a RIPD quando houver backend com clientes: PA_CUSTOMER_DOMAIN_MEMORY (quando persistido), PA_LOT_RECOMMENDATION (perfilamento), documentos do fechamento (CPF/RG), qualquer integração de CRM/WhatsApp. `App.privacy.core.compliancePackage()` gera o registro de atividades, fornecedores, transferências, matriz de retenção e índice de políticas para anexar.
