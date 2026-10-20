# Semântica de destaque por métrica (Tópico 25)

Fonte: `config/compare/viva-juara.json → criteria`. A semântica de vencedor mora só aqui (o registry de métricas do tópico 24 não é duplicado).
Métrica sem entrada → `UNKNOWN_SEMANTICS` → sem destaque (falha fechada).

| Métrica | Semântica | Resolver contextual | Empate / margem | Ressalvas |
|---|---|---|---|---|
| price | LOWER_IS_PREFERRED | — | money / money | Preço de tabela |
| pricePerM2 | LOWER_IS_PREFERRED (dedup com price) | — | money / money | Preço de tabela |
| status | CONTEXTUAL_PREFERENCE | availability: só em modo CUSTOMER/RECOMMENDATION, BOOLEAN_TRUE sobre `isOfferable`; UNKNOWN nunca conta como disponível | ordinal | — |
| area | CONTEXTUAL_PREFERENCE | area: `areaRange` → TARGET_RANGE (política target); `area` → HIGHER | area / area | Depende do perfil |
| lotClass | ORDERED_ENUM (A_PLUS 5 … D 1) | — | ordinal | Classe relativa |
| primaryScore, housing/investment/family/premiumScore | HIGHER_IS_PREFERRED (0–100) | — | score100 | Estimativa da análise (+ "não é promessa de valorização" em investimento) |
| fitScore | HIGHER_IS_PREFERRED, exige cliente | — | score100 | Depende do perfil; não é probabilidade de compra |
| quietScore, privacyScore | HIGHER_IS_PREFERRED (0–10, `estimated`) | — | note10 | Estimativa |
| solarScore | CONTEXTUAL_PREFERENCE | solar: preferência solar ou objetivo HOUSING → HIGHER | note10 | Estimativa; perfil |
| traffic | CONTEXTUAL_PREFERENCE | traffic: `lowTraffic` ou HOUSING → ORDERED_ENUM (VERY_LOW melhor) | ordinal | Estimativa; perfil |
| distanceToGate | CONTEXTUAL_PREFERENCE | gate: `nearGate` → LOWER | distance | Perfil |
| distanceToLeisure | CONTEXTUAL_PREFERENCE | leisure → LOWER | distance | Perfil |
| distanceToAvenue | CONTEXTUAL_PREFERENCE | avenue: `awayFromAvenue` → HIGHER | distance | Perfil |
| distanceToGreen, front | CONTEXTUAL_PREFERENCE | none (sem regra → sempre CONTEXT_REQUIRED) | distance | Perfil |
| greenRear | CONTEXTUAL_PREFERENCE | green → BOOLEAN_TRUE | ordinal | Perfil |
| isCorner | CONTEXTUAL_PREFERENCE | corner: `noCorner` → BOOLEAN_FALSE | ordinal | Perfil |
| downPayment | NO_WINNER | — (regras financeiras do tópico 26 não recebidas) | — | — |
| shape, blockPosition, rearNeighbor, streetHierarchy, orientationFront, northSun, viewDetail | NON_ORDERED | — | — | — |
| rear, depth, noiseLevel, privacyLevel, alertsCount, sewageStationNearby, topography, slope, constructivePotential, easements, versões, fitCoverage, fitConfidence, frescor, analysisConfidence, conflictsCount | INFORMATIONAL | — | — | — |

## Por que área, distâncias, sol, tráfego, esquina e verde são contextuais

"Maior área" ou "mais perto da portaria" não é preferível para todo cliente (custo, ruído, circulação). Sem preferência explícita do perfil do cliente, essas linhas mostram `CONTEXT_REQUIRED` (corretor: "Este atributo depende da preferência do cliente."; cliente: nada). Nunca há max/min genérico.

## Disponibilidade

Todos os 498 lotes estão `UNKNOWN` (sem espelho de vendas). Em GENERAL a linha não tem destaque; em contexto de cliente, `AVAILABLE` seria vantagem operacional, mas `UNKNOWN` nunca é tratado como disponível e a política de stale de disponibilidade suprime destaque com dado desatualizado.
