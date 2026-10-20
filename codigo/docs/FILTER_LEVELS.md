# Níveis de filtro: rápidos, avançados e técnicos

Tópico 17. Níveis definidos no campo `level` de cada definição em `plat/src/filters/filters.js` (`levelsFor`, `visible`) e desenhados por `find` em `plat/src/presentation/panels.js`. O mesmo motor (`compile` + `run`) atende os três níveis e os dois modos; muda apenas o que é visível e compilado.

## 1. Níveis e modos

| Nível | Modo corretor (`broker`) | Modo cliente (`client`) | Seção no painel Encontrar |
|---|---|---|---|
| `QUICK` | sim | sim, exceto `classMin` | sempre aberta: "Disponibilidade" e "Preço, área e quadra" |
| `ADVANCED` | sim | sim | "Mais filtros ▾" (fechada por padrão) |
| `TECHNICAL` | sim | não | "Filtros técnicos ▾" (fechada por padrão; não aparece no modo cliente) |

`levelsFor('client')` devolve `['QUICK', 'ADVANCED']`; `visible(def, 'client')` usa `clientVisible`. No modo cliente, `compile` não gera condição para filtro invisível, mesmo que o valor continue salvo: ao voltar ao modo corretor, o filtro técnico volta a valer. Exemplo verificado: `classMin: 'A'` filtra 125 lotes no modo corretor e nenhum no modo cliente (498).

O estado de abertura das seções fica em `st.filterLevels` (`{ ADVANCED: false, TECHNICAL: false }` no início) e é persistido junto com as preferências.

## 2. Rápidos

Objetivo: poucos controles, resposta imediata.

| Controle no painel | Filtro | Opções | Observação |
|---|---|---|---|
| Chips de situação, com contagem | `statuses` | os 7 status de `AVAILABILITY_ORDER`; chip com contagem 0 só aparece se selecionado | hoje só aparece "Status não confirmado" (498) |
| "Somente disponíveis" | `onlyOfferable` | checkbox | hoje 0 lotes; o painel mostra o aviso de ausência de espelho de vendas |
| "Preço mínimo" / "Preço máximo" | `price` | `PRICE_STEPS` 300000…800000 (mais o valor atual, se diferente) | faixa aberta |
| "Área mínima (m²)" / "Área máxima (m²)" | `area` | campo numérico, passo 10 (dicas 250 e 700) | faixa aberta |
| "Quadra" | `block` | quadras do repositório, com contagem | |
| "Classe mínima" (só corretor) | `classMin` | A+, A ou melhor, B ou melhor, C ou melhor | |
| "Sem esquina" | `noCorner` | checkbox | |

## 3. Avançados

| Controle | Filtro | Opções | Observação |
|---|---|---|---|
| "Formato" | `shapes` | Retangular, Quadrado, Trapezoidal, Irregular, com contagem | sem chip "não informado" |
| "Fundos voltados para" | `rearOrientation` | N, NE, L, SE, S, SO, O, NO, com contagem | |
| "Ruído (estimativa)" | `noiseMax` | "Até muito baixo", "Até baixo", "Até médio" | estimado |
| "Privacidade (estimativa)" | `privacyMin` | "Média ou mais", "Alta ou mais", "Muito alta ou mais" | estimado |
| "Trânsito (estimativa)" | `trafficMax` | "Até muito baixo", "Até baixo", "Até médio" | estimado |
| "Portaria (de carro)" | `gateMaxM` | até 200, 400, 650 m | rota calculada |
| "Clube (de carro)" | `clubMaxM` | até 250, 500, 750 m | rota calculada |
| "Mata ou parque nos fundos" | `greenBehind` | checkbox | |
| "Sem alerta de ruído" | `noNoiseAlert` | checkbox | lote sem lista de alertas é mantido |
| "Só favoritos (N)" | `favoritesOnly` | checkbox | favoritos não vão no link |

Exemplo verificado: "Ruído até baixo" (`noiseMax: 'LOW'`) → 408 lotes, com aviso `ESTIMATED_FIELD`.

## 4. Técnicos (só corretor)

| Controle | Filtro | Opções | Observação |
|---|---|---|---|
| "Score" + "Score mínimo" | `scoreMin` | Geral, Moradia, Investimento, Família, Premium; 60, 70, 80, 88 ou mais | score técnico do lote, não o fit |
| "Compatibilidade mínima" | `fitMin` | 50%, 60%, 70%, 80% ou mais | desabilitado sem perfil ("Defina o perfil do cliente"); sem perfil, 0 lotes e aviso `FIT_UNAVAILABLE` |
| "Qualidade do dado" + "Com origem" | `dataStatus` | campo: ruído, privacidade, trânsito, área, preço; origem (`DataStatusShort`): Oficial, Calculado, Estimado, Validar, Não disponível (`CONFIRMED`, `CALCULATED`, `ESTIMATED`, `TO_CONFIRM`, `UNKNOWN`) | filtra pela proveniência, não pelo valor |
| "Sem estes alertas" | `alertsExclude` | tipos de `App.rules.ALERTS` menos `OTHER`, com rótulos `AlertType` (Servidão, Restrição construtiva, Área técnica, Avenida, Ruído, Tráfego, Privacidade, Geometria, Sol da tarde) | |

`fitMin` usa o fit já calculado para o perfil atual. Filtrar por compatibilidade não altera o perfil nem a recomendação, e fit não é probabilidade de compra.

## 5. Regras comuns aos níveis

- Ao vivo: cada mudança grava `st.activeFilters` e o mapa, a legenda e a contagem "N de 498 lotes nos filtros" se atualizam. Não há botão Aplicar.
- AND entre filtros de qualquer nível; OR dentro de uma lista de chips.
- O mapa só esmaece os lotes fora do filtro; nenhum polígono é removido. O lote selecionado fora do filtro continua aberto, com "Fora dos filtros atuais (motivo). O lote continua selecionável." e "(sem dado)" quando o motivo é ausência de valor (`whyNot`).
- Cada filtro ativo vira um chip removível; "Limpar filtros" zera todos (e o foco da legenda).
- Nenhum nível altera o perfil do cliente, as exigências ou a recomendação. Para usar os lotes filtrados na recomendação, o corretor clica em "Usar os N lotes do filtro na recomendação" (seção Recomendação).
- Disponibilidade UNKNOWN nunca conta como disponível em nenhum nível.

## 6. Modo cliente

- Filtros técnicos e `classMin` não aparecem e não são compilados.
- O aviso `ESTIMATED_FIELD` não é exibido (os rótulos já dizem "estimativa").
- O aviso de filtros inválidos ignorados não é exibido.

## 7. Não implementado / pendências

- Layout móvel dedicado (filtros rápidos com prioridade `mobilePriority`, avançados em folha com Aplicar): não implementado; o painel é o mesmo em gaveta. Desde 08/10/2026 a gaveta tem o botão "Ver N lotes no mapa", e `quickFilterOrder` ordena os filtros rápidos por `mobilePriority`, mas o painel ainda não usa essa ordem.
- Implementado em 08/10/2026: busca por código de lote ou quadra como filtro rápido (`q`), dentro da `FilterQuery`.
- Implementado em 08/10/2026: opção "não informado" em ruído, privacidade, trânsito, formato e frescor, e opção "incluir lotes não informados".
- Implementado em 08/10/2026: filtros técnicos de cobertura e confiança do Fit e de frescor. Filtro por versão de dados continua inexistente.
- Faixas de preço e área do painel usam passos fixos (`PRICE_STEPS`) ou campo livre; `rangeStats` existe, mas não é usado para limitar os controles.
- Analytics de abertura das seções avançada e técnica: não emitidos. O de resultado zero (`filter_zero_result`) é emitido desde 08/10/2026.
