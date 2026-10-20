# Fatos e dimensões (tópico 44)

## Fatos (`metrics.json → facts`)
| Fato | Grão | Fonte | Situação |
|---|---|---|---|
| `FactProductEvent` | um evento aceito | LOCAL_EVENT_BUFFER | LOCAL |
| `FactProductSession` | uma sessão de produto (30 min de inatividade) | LOCAL_EVENT_BUFFER | LOCAL |
| `FactJourneyStageTransition` | uma transição de estágio | JOURNEY_STAGE_TRANSITIONS | REQUIRES_BACKEND |
| `FactJourneyOutcome` | um fechamento (ganho/perda) | JOURNEY_OUTCOMES | REQUIRES_BACKEND |
| `FactCustomerAcquisition` | uma jornada admitida | JOURNEY_ACQUISITION | REQUIRES_BACKEND |
| `FactJourneyTouchpoint` | um contato significativo | JOURNEY_TOUCHPOINTS | REQUIRES_BACKEND |
| `FactShareGrant` | um link emitido | SHARE_GRANTS | REQUIRES_BACKEND |
| `FactShareAccess` | uma sessão de acesso válida | SHARE_ACCESS_SESSIONS | REQUIRES_BACKEND |
| `FactRecommendation` | uma recomendação gerada | RECOMMENDATION_RESULTS | REQUIRES_BACKEND |

Fatos são somente leitura: analytics nunca escreve em jornada, lote, preço, disponibilidade ou recomendação. Um fato não guarda nome, telefone, e-mail, CPF, valor de orçamento nem preço de lote.

## Dimensões (`metrics.json → dimensions`)
`eventName`, `category`, `deviceClass`, `selectionSource`, `lotRef`, `layerId`, `contextType`, `restoreStatus`, `developmentId`, `sourceCode`, `campaignRef`, `ownerUserId` (sensível), `customerSegment` (sensível).

### Regras
- Só dimensões do registro podem agrupar ou filtrar; cada métrica declara `dimensionsAllowed`.
- Valor ausente vira `UNKNOWN` e **continua UNKNOWN**: nunca é redistribuído proporcionalmente entre as categorias conhecidas.
- Cobertura < 80% de uma dimensão no resultado → `LOW_COVERAGE_<DIM>` e qualidade `DEGRADED`.
- Dimensões sensíveis: grupos com menos de 5 entidades (`policy.privacy.minimumGroupSize`) são suprimidos (`value = null`, `suppressed = true`), sem numerador/denominador.
- `lotRef` é o código do lote (sem preço, sem disponibilidade). Disponibilidade continua **UNKNOWN** para os 498 lotes e não é dimensão analítica.
- Tempo: dimensão de data derivada no fuso da organização (`dimDate`: dia, semana ISO, mês, trimestre, ano).
