# Registro de domínios de dados (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. Criticidade = sugestão da plataforma, necessita confirmação.
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| Domínio | Nome | Tipo de owner | Criticidade | Fonte de verdade | Dinâmico | Frescor | Ativo |
|---|---|---|---|---|---|---|---|
| `DEVELOPMENT` | Empreendimento | BUSINESS | MEDIUM | official-plan-v1 | não | VERSION | sim |
| `LOT_IDENTITY` | Identidade do lote | SHARED | CRITICAL | official-plan-v1 | não | VERSION | sim |
| `GEOMETRY` | Geometria | SHARED | HIGH | official-plan-v1 | não | VERSION | sim |
| `PRICING` | Preço de tabela | BUSINESS | CRITICAL | price-table-v1 | sim | VERSION | sim |
| `AVAILABILITY` | Disponibilidade comercial | BUSINESS | CRITICAL | **null — necessita confirmação** | sim | CLOCK | sim |
| `DOCUMENTS` | Documentos | SHARED | HIGH | **null — necessita confirmação** | não | VERSION | sim |
| `ANALYSIS` | Análise | TECHNICAL | MEDIUM | analysis-v1 | não | VERSION | sim |
| `CUSTOMER` | Cliente | BUSINESS | HIGH | **null — necessita confirmação** | sim | NOT_APPLICABLE | não (não monitorado) |
| `JOURNEY` | Jornada | BUSINESS | MEDIUM | **null — necessita confirmação** | sim | NOT_APPLICABLE | não (não monitorado) |
| `COMMERCIAL_TRANSACTION` | Transação comercial | BUSINESS | CRITICAL | **null — necessita confirmação** | sim | CLOCK | não (não monitorado) |
| `PRIVACY` | Privacidade | SHARED | CRITICAL | **null — necessita confirmação** | sim | NOT_APPLICABLE | não (não monitorado) |
| `INTEGRATION_REFERENCE` | Referências de integração | TECHNICAL | MEDIUM | **null — necessita confirmação** | sim | CLOCK | não (não monitorado) |
