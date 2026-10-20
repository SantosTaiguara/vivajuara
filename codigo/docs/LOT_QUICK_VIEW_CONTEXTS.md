# Lot Quick View: contextos e modos

Tópico 20. Resolução em `plat/src/quickview/quickview.js` (`resolveContext`, `CONTEXT_MODES`), limites por modo em `plat/config/quickview/viva-juara.json` e entrada montada por `ctx()` em `plat/src/presentation/app.js`. O contexto é decidido uma única vez por construção; os subcomponentes não repetem essa decisão.

## 1. QuickViewContext

```
{ mode, presentationMode, priorityMode, activeLayerId, currentCustomerId, customerLabel,
  recommendationContext, comparisonState, filterStateSummary, offline }
```

| Campo | Conteúdo |
|---|---|
| `mode` | contexto principal: `TECHNICAL`, `PRESENTATION`, `COMPARISON`, `RECOMMENDATION`, `CUSTOMER` ou `NEUTRAL` |
| `presentationMode` | `client`, `broker` ou `technical` (modo da aplicação) |
| `priorityMode` | chave de `modes` na configuração: `presentation` quando há apresentação, senão o próprio modo |
| `activeLayerId` | camada ativa do mapa (`activeMapLayer`) |
| `currentCustomerId`, `customerLabel` | cliente ativo (com Fit utilizável); o nome só fora do modo cliente |
| `recommendationContext` | `{ rank, tier, total }` se o lote está em `recommendations` ou `reviewCandidates`; em revisão, `total = reviewTotal` |
| `comparisonState` | `{ index, total }` se o lote está na comparação |
| `filterStateSummary` | `{ active, matched }` |
| `offline` | `{ status }` com a conectividade (`ONLINE`, `OFFLINE`, `DEGRADED`, `UNKNOWN`) |

## 2. Resolução do contexto principal

Primeira regra verdadeira, nesta ordem:

| Ordem | Contexto | Condição |
|---|---|---|
| 1 | `TECHNICAL` | modo técnico |
| 2 | `PRESENTATION` | modo cliente com `presentation = true` |
| 3 | `COMPARISON` | lote na comparação e vista `compare` aberta |
| 4 | `RECOMMENDATION` | lote no resultado da recomendação (inclui revisão) |
| 5 | `CUSTOMER` | cliente ativo e Fit diferente de `INSUFFICIENT_PROFILE` |
| 6 | `NEUTRAL` | nenhuma das anteriores |

## 3. O que cada contexto muda

| Contexto | Efeito |
|---|---|
| `NEUTRAL` | métrica principal: preço no cliente, score no corretor (`uiHints.primaryMetricKey`) |
| `CUSTOMER` | métrica principal `fit`; bloco "<n>% compatível com o perfil [de <nome>]"; destaques do perfil ("Atende ao perfil: ...") |
| `RECOMMENDATION` | métrica principal `fit`; selo "<n>º na recomendação" ou "<n>º para revisar (status a confirmar)" quando o motivo é disponibilidade, ou "(dado a confirmar)" para os outros motivos; ação "Por que esta posição?" fora do modo cliente |
| `COMPARISON` | selo "<n> na comparação"; ação "Na comparação" pressionada |
| `PRESENTATION` | limites do modo `presentation`; sem rotas à portaria e ao clube |
| `TECHNICAL` | limites do modo `technical`; id canônico, versões de dados, "Copiar ID técnico" e "Origem dos dados" |

Os selos de recomendação e de comparação aparecem sempre que os dados existem, mesmo quando outro contexto é o principal. O rank exibido é o da recomendação para o perfil, nunca o ranking global de score (que aparece em `primaryScore.rankingText`, ex.: "4º de 498 em Moradia").

Exemplo real (perfil de teste com silêncio 3 e privacidade 2): o primeiro candidato fica em `RECOMMENDATION`, tier `REVIEW_REQUIRED`, "1º para revisar (status a confirmar)", "97% compatível", com a nota "Resultado sujeito a confirmação de preço e disponibilidade". Todo resultado é de revisão porque nenhum lote tem disponibilidade confirmada.

## 4. Diferenças por modo da aplicação

| Elemento | Cliente | Corretor | Técnico | Apresentação |
|---|---|---|---|---|
| máximo de destaques | 3 | 4 | 5 | 3 |
| máximo de alertas (críticos e importantes sempre entram) | 2 | 3 | 4 | 2 |
| score, classe, atributos-chave | não | sim | sim | não |
| fatos (ruído, privacidade, sol do norte) | sim | sim | sim | sim |
| id canônico no cabeçalho | não | sim | sim | não |
| frescor técnico (`freshness`) | não | sim | sim | não |
| nota de status e de preço | texto simples ("sujeito a confirmação") | texto operacional | texto operacional | texto simples |
| nome do cliente | não | sim | sim | não |
| "Mais indicado para ..." | não | sim | sim | não |
| versões (análise, tabela, Quick View) | não | não | sim | não |

O teste `quick view in client mode` verifica que no modo cliente não aparecem códigos internos (`STALE`, `UNKNOWN`, `FRESH`, `EXPIRED`, `LAYER_`, `FIT_STRENGTH`), que `freshness` é `null`, que não há rótulo de cliente sem nome e que o Fit não é descrito como probabilidade ou chance de compra.

## 5. Camada ativa do mapa

- Destaques do mesmo tema da camada ganham +2 de prioridade (`LAYER_TOPIC`: ruído, privacidade, sol, mata, trânsito, portaria, clube, área, preço, preço por m²).
- `uiHints.emphasizedFieldKeys` recebe o `fieldKey` da camada no registro; a métrica correspondente (área, preço, preço/m²) ganha contorno (`.emph`).
- O fato correspondente (Ruído provável, Privacidade, Sol do norte) é destacado com as camadas Ruído, Privacidade e Sol.

## 6. Filtro

Com filtro ativo e lote fora do resultado: `filterStateSummary.matched = false`, `outsideFilter.reasons` explica quais filtros excluem o lote e o painel diz "O lote continua selecionável." A Quick View não muda a consulta, não esconde o lote e não o trata como "ruim".

## 7. Como cada modo é alcançado

| Modo | Na interface |
|---|---|
| corretor, cliente | botões "Corretor" e "Cliente" no cabeçalho (`data-act="mode"`) |
| técnico | sem botão; só se `presentationMode = technical` for gravado no store |
| apresentação | sem gatilho; `quickViewVM` repassa `ctx.presentation`, que `app.js` nunca define |

## 8. Não implementado / pendências

- Implementado em 08/10/2026: modo técnico (botão Técnico) e contexto de apresentação (botão "Apresentar") são alcançáveis pela interface.
- `dataFreshnessState` não faz parte do contexto (o frescor fica em `vm.freshness` e no status).
- Implementado em 08/10/2026: sem conexão, a Quick View mostra uma nota própria sobre preço e disponibilidade, além da barra global.
- Contextos compostos: só o principal é registrado; não há lista de contextos secundários.
- Dos `uiHints`, `panels.quick` só lê `emphasizedFieldKeys`. `primaryMetricKey`, `showRecommendationRank`, `showFit` e `showFreshnessWarning` são calculados, mas a ordem dos blocos no painel é fixa (status, selos, métricas, Fit, score, atributos, fatos, destaques, alertas, ações).
