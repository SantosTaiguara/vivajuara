# Limitações conhecidas dos dados (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. A mensagem ao cliente é neutra; nunca promete valorização.
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

| Id | Escopo | Descrição | Impacto | Mensagem ao cliente |
|---|---|---|---|---|
| KL-AVAILABILITY-NO-MIRROR | viva-juara/AVAILABILITY | Sem espelho de vendas: os 498 lotes estão com disponibilidade UNKNOWN (sem data nem fonte). | Nenhum lote pode ser apresentado como disponível; reserva e proposta ficam bloqueadas pelo gate de frescor. | Disponibilidade a confirmar com o corretor. |
| KL-TOPOGRAPHY | viva-juara/construction.topography | Topografia e declividade não levantadas. | Sem análise de terreno/terraplenagem. | Informação de topografia ainda não disponível. |
| KL-DRAINAGE | viva-juara/construction.drainage | Drenagem não informada pela fonte. | Sem avaliação de drenagem. | Informação de drenagem ainda não disponível. |
| KL-VENTILATION | viva-juara/environmental.ventilation | Ventilação não modelada. | Nota de ventilação ausente (nt.vent nulo). | Informação de ventilação ainda não disponível. |
| KL-CONSTRUCTION-RULES | viva-juara/construction | Regras construtivas (recuos, taxa de ocupação, coeficiente, gabarito) não publicadas. | Potencial construtivo não calculável. | Regras construtivas ainda não disponíveis. |
| KL-NOISE-ESTIMATE | viva-juara/environmental.noiseLevel | Ruído é estimativa por distância a fontes, sem medição. | Classificação de ruído com confiança limitada. | Ruído estimado (sem medição). |
| KL-AERIAL-ILLUSTRATIVE | viva-juara/surroundings | Vizinhança dos fundos interpretada sobre ilustração aérea de divulgação. | Mata/área aberta nos fundos com confiança baixa. | Entorno estimado a partir de imagem ilustrativa. |

## Dívida de dados
| Id | Domínio | Descrição | Risco | Owner | Prazo |
|---|---|---|---|---|---|
| DD-SPREADSHEET-AUTHORITY | PRICING | Tabela de preço vem de material manual (confirmada pelo corretor), não de fonte estruturada com ID de máquina. | Erro de digitação não detectado na origem. | **null — necessita confirmação** | **null — necessita confirmação** |
| DD-AVAILABILITY-SOURCE | AVAILABILITY | Fonte de autoridade da disponibilidade não definida. | Sem reconciliação possível. | **null — necessita confirmação** | **null — necessita confirmação** |
| DD-NO-SOURCE-DATES | DEVELOPMENT | Fontes official-plan-v1, kmz-v1, aerial-v1, launch-event-v1 e renders-v1 sem data registrada. | Currentness das fontes estáticas não verificável por data. | **null — necessita confirmação** | **null — necessita confirmação** |
| DD-TOPOGRAPHY | GEOMETRY | Topografia ausente. | Sem análise de declividade. | **null — necessita confirmação** | **null — necessita confirmação** |
