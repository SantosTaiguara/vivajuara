# ProcessingPurposeRegistry

> Gerado por `node scripts/privacyDocs.js` a partir de `config/privacy/registries.json`. Não edite à mão: altere a configuração e gere de novo.

> **Isto não é parecer jurídico.** Documento de arquitetura e governança técnica do tópico 59. Bases legais, prazos, papéis (controlador/operador), mecanismos de transferência e textos de aviso precisam ser validados pelo jurídico e pelo encarregado da organização antes de produção. Valores `null` aparecem como "— (necessita validação)": enquanto estiverem assim, o código **nega** o tratamento ou responde `PRIVACY_REVIEW_REQUIRED`.

Toda coleta aponta para uma finalidade determinada (§19–22). Nenhuma está ativa: status DRAFT até a base legal ser validada.

| Id | Nome | Descrição | Categorias | Avaliação de base legal | Retenção | Papel | Status |
|---|---|---|---|---|---|---|---|
| LEAD_INTAKE | Entrada de lead | Registrar o contato mínimo de uma pessoa que pediu atendimento sobre o empreendimento. | IDENTITY, CONTACT | LBA_LEAD_INTAKE | RET_CUSTOMER_CONTACT | — (necessita validação) | DRAFT |
| CUSTOMER_RELATIONSHIP | Atendimento comercial ao cliente | Manter o cadastro de trabalho e o histórico de atendimento do cliente com o corretor da organização. | IDENTITY, CONTACT, CUSTOMER_PREFERENCE, CUSTOMER_BEHAVIOR, COMMERCIAL_HISTORY, COMMUNICATION_HISTORY, DEVICE_TECHNICAL | LBA_CUSTOMER_RELATIONSHIP | RET_CUSTOMER_CORE | — (necessita validação) | DRAFT |
| LOT_RECOMMENDATION | Recomendação de lotes | Gerar recomendação de lotes de acordo com critérios informados pelo cliente (área, sol, ruído, orçamento, objetivo); o corretor decide. | CUSTOMER_PREFERENCE, FINANCIAL_DECLARED, CUSTOMER_BEHAVIOR | LBA_LOT_RECOMMENDATION | RET_CUSTOMER_PROFILE | — (necessita validação) | DRAFT |
| FINANCIAL_SIMULATION | Simulação financeira | Simular condições de pagamento sobre o preço de tabela a pedido do cliente (entrada e plano informados). | FINANCIAL_DECLARED | LBA_FINANCIAL_SIMULATION | RET_CUSTOMER_PROFILE | — (necessita validação) | DRAFT |
| PROPOSAL_PREPARATION | Preparação de proposta | Preparar a proposta comercial solicitada pelo cliente para um lote específico. | IDENTITY, CONTACT, FINANCIAL_DECLARED, CUSTOMER_PREFERENCE, COMMERCIAL_HISTORY | LBA_PROPOSAL_PREPARATION | RET_TRANSACTION | — (necessita validação) | DRAFT |
| RESERVATION_PROCESS | Processo de reserva | Registrar e acompanhar a reserva de um lote pelo cliente junto à loteadora. | IDENTITY, CONTACT, COMMERCIAL_HISTORY | LBA_RESERVATION_PROCESS | RET_TRANSACTION | — (necessita validação) | DRAFT |
| CONTRACT_PREPARATION | Preparação de contrato | Reunir os dados e documentos exigidos para o contrato de compra e venda do lote. | IDENTITY, CONTACT, ADDRESS, MARITAL_STATUS, DOCUMENT_IDENTIFIER, COMMERCIAL_HISTORY | LBA_CONTRACT_PREPARATION | RET_TRANSACTION | — (necessita validação) | DRAFT |
| SIGNATURE_PROCESS | Assinatura | Conduzir a assinatura do contrato com um provedor de assinatura eletrônica. | IDENTITY, DOCUMENT_IDENTIFIER, SIGNATURE_DATA | LBA_SIGNATURE_PROCESS | RET_DOCUMENTS | — (necessita validação) | DRAFT |
| CUSTOMER_SUPPORT | Suporte ao cliente | Responder dúvidas e solicitações do cliente sobre o atendimento e o lote. | IDENTITY, CONTACT, COMMUNICATION_HISTORY | LBA_CUSTOMER_SUPPORT | RET_COMMUNICATION | — (necessita validação) | DRAFT |
| LEGAL_COMPLIANCE | Cumprimento de obrigação legal e defesa | Guardar o mínimo necessário de registros transacionais quando uma obrigação legal ou a defesa em processo exigir. | IDENTITY, ADDRESS, MARITAL_STATUS, DOCUMENT_IDENTIFIER, SIGNATURE_DATA, COMMERCIAL_HISTORY | LBA_LEGAL_COMPLIANCE | RET_TRANSACTION | — (necessita validação) | DRAFT |
| SECURITY | Segurança da plataforma | Autenticar usuários da organização, manter sessões e trilha de auditoria de ações de alto risco. | AUTHENTICATION, DEVICE_TECHNICAL | LBA_SECURITY | RET_AUTH_SESSIONS | — (necessita validação) | DRAFT |
| FRAUD_PREVENTION | Prevenção a fraude | Detectar abuso de links de compartilhamento e de acessos (limites por referência opaca, sem IP bruto). | DEVICE_TECHNICAL | LBA_FRAUD_PREVENTION | RET_SECURITY_LOGS | — (necessita validação) | DRAFT |
| PRODUCT_ANALYTICS | Analytics de produto (primeira parte, pseudônimo) | Medir o uso das telas do painel com eventos sem dado pessoal direto, para melhorar o fluxo de busca de lotes. | ANALYTICS_PSEUDONYMOUS, DEVICE_TECHNICAL | LBA_PRODUCT_ANALYTICS | RET_ANALYTICS | — (necessita validação) | DRAFT |
| MARKETING_COMMUNICATION | Comunicação de marketing | Enviar ofertas e novidades do empreendimento por canal escolhido (WhatsApp, e-mail, SMS), separado das mensagens de serviço. | IDENTITY, CONTACT | LBA_MARKETING_COMMUNICATION | RET_MARKETING | — (necessita validação) | DRAFT |

Fronteira de finalidade (§51–53): `mayProcess` nega quando a categoria não lista a finalidade (ex.: CPF nunca em PRODUCT_ANALYTICS).
