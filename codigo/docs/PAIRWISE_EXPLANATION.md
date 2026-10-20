# Explicação par a par ("por que A está acima de B")

Tópico 16. Implementação em `comparePair(result, aId, bId, opts)` de `plat/src/intelligence/explanation.js`; uso em `openExplain` (`plat/src/presentation/app.js`) e na seção "Comparado ao … (posição acima)" de `explainPopover` (`plat/src/presentation/panels.js`).

## 1. Princípio

A comparação não usa só o score final. Ela decompõe a diferença de fit entre os dois lotes por preferência, a partir da evidência do Fit já guardada em cada item (`item.fit.preferenceMatches`). Nada é recalculado: a ordem de quem está acima vem do próprio comparador do ranking (`App.recommendation.compare`).

## 2. Quem é o lote de cima

| Situação | `higherLotId` |
|---|---|
| os dois na shortlist, ou os dois em revisão | o que vem primeiro por `compare` (fit DESC, cobertura DESC, confiança DESC, `lotId` ASC) |
| um na shortlist e outro em revisão | o da shortlist |
| algum dos dois fora dos resultados | nenhum: `status UNAVAILABLE`, `summaryReasonCodes ['NOT_IN_RESULTS']` |

A ordem dos argumentos não importa: `comparePair(r, b, a)` e `comparePair(r, a, b)` apontam o mesmo lote de cima.

## 3. Decomposição da diferença

Para cada lote, a contribuição de cada preferência avaliada, em pontos de fit:

```
c(lote, pref) = 100 × peso × matchScore / Σ pesos das preferências avaliadas do lote
Σ c(lote, ·)  = fitScore do lote
delta(pref)   = c(cima, pref) − c(baixo, pref)      (ausente em um lado conta 0)
Σ delta       = fitDelta = fit(cima) − fit(baixo)
```

| Campo de cada delta | Conteúdo |
|---|---|
| `preferenceKey`, `metricKey` | preferência e `fieldKey` canônico |
| `higherValue`, `lowerValue` | valor bruto do campo em cada lote (`null` se a preferência não foi avaliada nele) |
| `delta` | pontos de fit a favor do lote de cima (negativo = a favor do de baixo) |
| `comparable` | `true` só quando a preferência foi avaliada nos dois lotes |

Só se comparam preferências do mesmo perfil (mesma chave). Quando um lote não tem o dado, a preferência é marcada `comparable: false`: o Fit já renormalizou os pesos daquele lote, então a falta de dado não é tratada como nota baixa.

## 4. Fatores decisivos e compensatórios

| Grupo | Regra |
|---|---|
| `decisiveFactors` | deltas > 0, do maior para o menor, até 3 |
| `offsettingFactors` | deltas < 0 (pontos em que o lote de baixo é melhor), do mais negativo, até 3 |

Empate entre deltas: chave da preferência em ordem alfabética. Quando há mais de 3 de cada lado, a soma dos fatores mostrados não fecha com `fitDelta`; o teste só exige a igualdade quando nenhum grupo foi cortado.

## 5. Código de resumo e desempate

Um único código, avaliado nesta ordem:

| Código | Regra | `tieBreakUsed` |
|---|---|---|
| `DIFFERENT_ELIGIBILITY` | tiers diferentes e um deles é `REVIEW_REQUIRED` | `null` |
| `HIGHER_FIT` | `|fit(cima) − fit(baixo)| ≥ equivalenceEpsilon` (0.5) | `null` |
| `TIE_BREAK_COVERAGE` | fits iguais, coberturas diferentes | `{ key: 'coverage', higher, lower }` |
| `TIE_BREAK_CONFIDENCE` | fits e coberturas iguais, confianças diferentes | `{ key: 'confidence', higher, lower }` |
| `EQUIVALENT_FOR_PROFILE` | fits diferentes, mas abaixo de `equivalenceEpsilon` (a ordem veio dessa pequena diferença) | `null` |
| `EQUIVALENT_FOR_PROFILE` | fits, coberturas e confianças iguais: só o `lotId` os separa | `{ key: 'lotId' }` |

O desempate por `lotId` nunca é apresentado como vantagem. O texto do popover é "é equivalente para este perfil; a ordem entre os dois não indica preferência". `DIFFERENT_ELIGIBILITY` aparece como "está na lista principal, e o outro precisa de revisão antes de ser oferecido". Fit nulo entra como 0 apenas no cálculo de `fitDelta` deste código; o score do lote continua `null`.

`dataQualityDifferences` traz, para os dois lotes, `{ lotId, availabilityStatus, coverage, confidence (nível), reviewReasons }`.

## 6. Exemplos verificados

Dados de teste com os 498 lotes marcados AVAILABLE (hoje todos são UNKNOWN), perfil Privacidade Essencial, Orientação solar Importante, Perto da portaria Pouco:

- 1º (I4, fit 93,29) × 10º (B83, fit 88,86): `HIGHER_FIT`, `fitDelta` 4,43, um fator decisivo `gate` (`intelligence.notes.gate` 9,5 contra 6,4, delta 4,43), nenhum compensatório.
- 5º (I19, fit 89,29) × 6º (I5, fit 89,14): diferença 0,14, abaixo de 0,5, mesma cobertura e confiança → `EQUIVALENT_FOR_PROFILE`.

Estado atual (todos em revisão, Privacidade + Silêncio): os dois primeiros candidatos têm o mesmo fit (93,33) → `EQUIVALENT_FOR_PROFILE`, sem fatores decisivos.

## 7. Uso na interface

`openExplain` compara o lote clicado com o item imediatamente acima na lista combinada (recomendados seguidos da revisão). Só o modo corretor mostra a comparação:

```
Comparado ao <código> (posição acima)
O <código> <frase do código>( (<fitDelta> pts)).
Decidiu: <preferência> (+<delta>), …. A favor deste lote: <preferência> (<delta>), ….
```

Números com 1 casa decimal (`F.number(v, 1)`). Rótulos das preferências de `config/fit/viva-juara.json`. O modo cliente não mostra a comparação.

## 8. Testes

`plat/tests/customer.test.js`, "pairwise: deltas add up to the Fit difference; lotId tie-break is shown as equivalent": `higherLotId` correto com argumentos invertidos; soma dos deltas igual a `fitDelta` quando não há corte; empate por `lotId` gera `EQUIVALENT_FOR_PROFILE`, `TIE_BREAK_CONFIDENCE` ou `TIE_BREAK_COVERAGE`, nunca `HIGHER_FIT`.

## 9. Não implementado / pendências

- Implementado em 08/10/2026: um lote excluído pode ser comparado quando há Fit para ele (do detalhe da exclusão ou passado por quem chama); sem Fit, a comparação continua indisponível.
- Implementado em 08/10/2026: `compareMany` compara de 2 a 4 lotes, e a tela de comparação mostra "Para o perfil do cliente" (melhor lote por preferência, "não comparável" quando falta dado).
- O popover "Por que esta posição?" ainda não sinaliza `comparable: false`; a tela de comparação já sinaliza.
