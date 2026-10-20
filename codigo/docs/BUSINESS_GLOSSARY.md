# Glossário de negócio (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| Termo | Definição | Não confundir com |
|---|---|---|
| **Disponível** | Status comercial confirmado pela fonte de autoridade de disponibilidade. Nunca inferido; UNKNOWN nunca é disponível. | — |
| **Reservado** | Lote com reserva ativa registrada pela fonte de autoridade. | — |
| **Proposta** | Lote com proposta em análise; por política padrão não conta como ofertável. | — |
| **Vendido** | Lote vendido; não reabre por padrão (allowSoldReopen=false). | — |
| **Não confirmado** | Sem informação da fonte de autoridade. Não é disponível nem indisponível. | — |
| **Aderência (fit)** | Quanto um lote atende ao perfil de um cliente (tópico 15). Não é qualidade do dado. | — |
| **Confiança** | Confiança do dado/estimativa (tópico 34). Confiança não é acurácia. | — |
| **Tabela de preço** | Versão publicada e imutável de R$/m² e planos. Preço do lote = área × R$/m² da tabela vigente (preço de tabela, nunca promessa de valorização). | — |
| **Publicação** | Conjunto de versões (estática, análise, tabela) liberado para uso, com snapshot de qualidade. | — |
| **Finding** | Registro de uma regra de qualidade violada (≠ incidente). | — |
| **Exceção de qualidade** | Decisão governada, com motivo, aprovação e expiração obrigatória. | — |
| **Completude do registro** | Para clientes: completude do registro, nunca 'qualidade do cliente'. | — |
