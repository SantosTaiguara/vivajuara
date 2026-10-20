# Proveniência da coordenada do empreendimento

> Tópico 63 — Google Maps, Entorno e raio máximo de 8 km. Estado: implementado atrás da flag `location_intelligence_google_maps` (DESLIGADA). Coordenada oficial do Viva Juara: **não validada**.

## Inventário (passo 4 do §618)
| Evidência encontrada | Por que não é a coordenada oficial |
|---|---|
| `src/config/developments.js` → `geo` (3 casas decimais) | entrada do cálculo solar, sem fonte, sem autor, sem validação |
| `lots.json` → latitude/longitude por lote (fonte `kmz-v1`, sem data) | coordenadas por lote; não existe centro oficial do empreendimento. Calcular um centróide seria inventar o centro |

As duas aparecem em `candidateEvidence` só como referência: os valores **não** foram copiados para o centro.

## Como a coordenada passa a existir
Endereço ou documento oficial → busca manual ou geocodificação → coordenada candidata → prévia no mapa (obrigatória) → confirmação humana → DevelopmentLocationChange publicado → nova versão `loc-N` VALIDATED.

## Fluxo DevelopmentLocationChange
DRAFT → REVIEW → APPROVED → PUBLISHED (REVIEW pode voltar a DRAFT). Regras:
- proposta exige coordenada válida, sourceRef, motivo, método da lista e solicitante;
- aprovação exige prévia confirmada; a regra "aprovador diferente do solicitante" é `locationChangePolicy.requireDistinctApprover` = **null (necessita confirmação)**: enquanto null a aprovação é recusada (LOCATION_POLICY_NOT_CONFIGURED);
- publicação exige base de versão atual (sem sobrescrever outra alteração), gera evento auditado `DEVELOPMENT_LOCATION_CENTER_CHANGED` e nova versão. Chaves de cache e Place IDs são particionados pela versão, então tudo derivado da coordenada antiga deixa de valer.

O Google nunca move o centro (§323). Diferença entre o marcador do Google e o centro oficial vira achado, nunca atualização automática.

## Atualização de 2026-10-19: mapa do entorno sem chave (OpenStreetMap)

A planta é georreferenciada pelas coordenadas por lote do KMZ (ajuste afim de 498 pontos; média 0,26 m, máximo 3,88 m, valores calculados). Nenhum novo centro foi criado: o Entorno usa só a coordenada oficial validada (portaria AC3).
