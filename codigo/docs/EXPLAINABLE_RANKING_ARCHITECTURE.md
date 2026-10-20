# Rankings explicáveis (arquitetura)

Tópico 16. Implementação em `plat/src/intelligence/explanation.js` (`App.explanation`), política no bloco `explanation` de `plat/config/recommendation/viva-juara.json`, uso na interface em `plat/src/presentation/app.js` (`openExplain`, `openTechExplain`) e `plat/src/presentation/panels.js` (`explainPopover`, `techExplainPopover`).

Documentos complementares: `EXPLANATION_REASON_CODES.md`, `RANKING_TRACE_SCHEMA.md`, `PAIRWISE_EXPLANATION.md`. O motor explicado está em `RECOMMENDATION_ENGINE.md`.

## 1. Princípio

A explicação é uma visão sobre a evidência que os motores já produziram. `App.explanation` não recalcula ranking, Fit nem restrição: lê o `RecommendationResult` (tópico 15), o `FitScoreResult` guardado em cada item (`item.fit`, tópico 14) e o `LotAnalysisResult` (tópico 12). Quando a evidência falta, devolve `PARTIAL` ou `UNAVAILABLE` em vez de supor.

O motor devolve só códigos e números. Toda frase é montada na apresentação (`panels.js`), por modo.

Regras garantidas pelo código:

- os fatores de um lote somam o próprio fit (teste "contributions add up to the Fit");
- as diferenças par a par somam a diferença de fit entre os dois lotes;
- o desempate final por `lotId` nunca é apresentado como vantagem: vira `EQUIVALENT_FOR_PROFILE`;
- disponibilidade `UNKNOWN` aparece sempre como fator de qualidade (`AVAILABILITY_UNKNOWN`); nunca é lida como disponível;
- fit é aderência ao perfil, não probabilidade de compra;
- não existe boost oculto a explicar: a ordenação usa apenas fit, cobertura, confiança e `lotId`.

## 2. Funções

| Função | Entrada | Saída | Uso na interface |
|---|---|---|---|
| `rankingTrace(result)` | `RecommendationResult` | `RankingTrace[]` (recomendados + revisão) | nenhum (diagnóstico) |
| `explainLot(result, lotId, opts)` | resultado + lote | `ExplanationResult` (scope `RECOMMENDATION`) | `explainPopover` |
| `comparePair(result, aId, bId, opts)` | resultado + dois lotes | `PairwiseExplanation` | `explainPopover` (lote da posição acima) |
| `rankChange(prev, curr)` | dois resultados | `RankChangeExplanation[]` | nenhum |
| `explainTechnical(analysis, scoreId, ref)` | `LotAnalysisResult` | explicação do score base (scope `TECHNICAL`) | `techExplainPopover` |
| `policyOf(devId)` | empreendimento | `ExplanationPolicy` | interno |

Esquemas: `RANKING_TRACE_SCHEMA.md` (trace e mudança de posição) e `PAIRWISE_EXPLANATION.md` (par a par).

## 3. Explicação de um lote (`explainLot`)

Procura o lote em `recommendations` e `reviewCandidates`. Fora deles → `status UNAVAILABLE`, `summaryReasonCodes ['NOT_IN_RESULTS']` (o popover diz "Este lote não está na recomendação atual.").

Contribuição de cada preferência avaliada (pontos de fit, escala 0–100):

```
den          = Σ peso das preferências com matchScore ≠ null
contribution = 100 × (peso × matchScore) / den        (soma = fitScore)
lost         = 100 × peso × (1 − matchScore) / den    (só fatores negativos)
```

| Grupo | Origem | Seleção |
|---|---|---|
| `positiveFactors` | matches `FIT_STRONG_MATCH` (matchScore ≥ 0.75) | `contribution ≥ minContribution` (1), ordem por contribuição, até `maxPositiveFactors` (3) |
| `negativeFactors` | matches `FIT_MISMATCH` (matchScore ≤ 0.4) | ordem por `lost`, até `maxNegativeFactors` (2) |
| `constraintFactors` | `item.constraintResults` | todos: `CONSTRAINT_PASS`, `CONSTRAINT_FAIL`, `CONSTRAINT_UNKNOWN` |
| `dataQualityFactors` | disponibilidade, `reviewReasons`, matches sem dado ou estimados, aviso `STALE_PRICE` do Fit | todos |
| `preferenceTable` | todos os matches | alvo, valor do lote, match, importância, contribuição, proveniência |

Empate na ordenação de fatores: chave da preferência em ordem alfabética. `opts.all = true` devolve todos os fatores; `allPositive`/`allNegative` dão o total antes do corte. Matches parciais (`FIT_PARTIAL_MATCH`) não entram em positivos nem negativos, só na `preferenceTable`.

`status`: `COMPLETE` quando o Fit é `COMPLETE`; `PARTIAL` quando o Fit é parcial ou não existe (perfil só com restrições).

`summaryReasonCodes`: `REVIEW_REQUIRED` (revisão), `TOP_FIT` (1º e PRIMARY) ou `TIER_<tier>`, seguido dos `keyReasonCodes` do item sem repetir `TOP_FIT`.

## 4. Score técnico (`explainTechnical`)

Lê `analysis.criteriaResults[scoreId]` e devolve, por critério, `{ criterionId, metricKey, value, weight, contribution, reasons[] }` ordenados por contribuição, mais `strongest`/`weakest` (2 maiores e 2 menores), `meanShare = 100 / nº de critérios` e, com a referência do empreendimento, a faixa de classe: posição pelo `overallRaw` (decrescente), total e `topShare`. Sem `criteriaResults` → `UNAVAILABLE`.

Exemplo verificado (primeiro lote de `analysis-input.json`, score Moradia): valor 69, critérios mais fortes `solar` e `lowTraffic`, mais fracos `geometry` e `view`; classe B, 241º de 498 no score geral.

`openTechExplain` (em `app.js`) carrega `analysis-input.json` sob demanda e roda `App.intelligence.analyzeDevelopment` com a metodologia publicada. Isso reexecuta o tópico 12 para obter as contribuições, que não vêm no `lots.json`; o teste dourado de `plat/tests/intelligence.test.js` garante que o motor reproduz os 498 lotes publicados sem diferença. Se o arquivo não carregar, o popover diz "Não foi possível carregar as medições agora. O score publicado continua valendo." Uma guarda (`techGuard`) descarta a resposta se o usuário trocou de lote.

## 5. Modos e níveis

A interface tem dois modos (`presentationMode`): `broker` (Corretor) e `client` (Cliente), escolhidos em `shell.html`.

| Nível | Conteúdo | Corretor | Cliente |
|---|---|---|---|
| L0 | frase de resumo (`SUMMARY`) e selo de tier | sim | sim |
| L1 | principais motivos | lista "A favor" com +pts e "Contra" com −pts (1 casa decimal) | até 2 fatores a favor e 1 ponto de atenção, só rótulos, sem números |
| L2 | detalhe por critério | posição, compatibilidade %, "dados avaliados" %, exigências não atendidas/desconhecidas, qualidade do dado, comparação com o lote acima | não |
| L3 | evidência técnica | tabela do score técnico ("Como o score foi calculado", fora do modo cliente) | não |

Onde o botão aparece:

- lista da recomendação: botão "Por quê?" em cada linha (inclusive no modo cliente, onde o popover mostra só L0–L1);
- Quick View: "Por quê?" junto à compatibilidade e ação "Por que esta posição?", ambos só fora do modo cliente;
- ficha (seção Inteligência): "Como o score foi calculado", fora do modo cliente.

Frases do popover: `SUMMARY` (resumo), `DQ` (qualidade do dado), `PAIR` (par a par), todas em `panels.js`. No modo cliente não há pesos, pontos nem códigos internos.

## 6. Versões

`explainLot` devolve `versions = { recommendationPolicyVersion, fitMethodologyVersion, explanationPolicyVersion, profileVersion }`. O texto não é versionado como metodologia: mudar uma frase em `panels.js` não muda nenhuma versão.

## 7. Cache e desempenho

Não há cache de explicação: cada abertura do popover chama `explainLot` e `comparePair` sobre o resultado já memoizado pelo selector. `explainLot` percorre os itens ranqueados (até 35: 10 recomendados + 25 em revisão) e as preferências de um lote; `comparePair`, as preferências de dois lotes. Nenhuma chamada refaz o ranking.

## 8. Testes

`plat/tests/customer.test.js`:

- "explanations never recalculate": fatores vêm da evidência, `TOP_FIT` no 1º, no máximo 3 positivos, contribuições somam o fit, trace com chaves `fitScore, coverage, confidence, lotId`, lote ausente → `UNAVAILABLE`;
- "pairwise": `higherLotId` correto, diferenças somam `fitDelta`, empate por `lotId` aparece como equivalente e nunca como `HIGHER_FIT`;
- "rank change": mudança de perfil → `PROFILE_CHANGED`; lote vendido → `LEFT_RESULTS`.

## 9. Não implementado / pendências

- Implementado em 08/10/2026: o resultado do tópico 15 lista cada lote excluído em `excluded` (etapa, regra, valor real e esperado), e `explainLot` devolve status `EXCLUDED` com esse detalhe; o popover responde "Por que ficou de fora?".
- Implementado em 08/10/2026: `App.explanation.viewModel` monta o `ExplanationViewModel` por modo e nível (headline, fatores, trade-offs, qualidade do dado). O popover usa o viewModel para lotes excluídos e em revisão; para lotes ranqueados ainda monta parte do HTML direto do `ExplanationResult`. `sourceLinks` não existe.
- Implementado em 08/10/2026: catálogo `App.reasonCodes` (`src/intelligence/reasonCodes.js`), com cerca de 175 códigos e rótulos para cliente e corretor.
- Implementado em 08/10/2026: o viewModel lê `clientLevels`/`brokerLevels` da política quando eles existem.
- Implementado em 08/10/2026: o popover do corretor mostra a tabela por preferência (`preferenceTable`).
- Implementado em 08/10/2026: o botão Técnico (oculto abaixo de 420 px) torna alcançável o ramo `mode === 'technical'` do popover (versões da política, do Fit e da explicação).
- Fatores de qualidade sem frase em `DQ` (`LOW_FIT_COVERAGE`, `LOW_FIT_CONFIDENCE`, `STALE_AVAILABILITY`, `UNKNOWN_*`, `CONFLICTED_DATA`) ainda não aparecem no popover de lote ranqueado. Desde 08/10/2026 eles têm rótulo no catálogo e o viewModel os traz com valores; falta o popover usá-los nesse caso.
- `rankingTrace` e `rankChange` não têm uso na interface; trace não é persistido; não há snapshot de auditoria nem backend.
- Implementado em 08/10/2026: comparação explicada de 2 a 4 lotes (`compareMany`), usada na tela de comparação. Percentis, contrafactuais e análise de relaxamento continuam não implementados.
- `NEUTRAL`, `TIE_BREAK` e `RANK_CHANGE` como `factorType` não são emitidos; `tieBreakFactors`, `comparisonFactors` e `rankChangeFactors` de `explainLot` vêm sempre vazios.
