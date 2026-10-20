# Avaliação por critério — arquitetura (Tópico 25)

O comparador destaca, critério a critério, qual lote tem o valor preferível **segundo uma semântica registrada**. Não existe "melhor lote geral", nem soma de vitórias como score, nem desempate por id.

## Módulo

`src/compare/criterionWinner.js` → `App.compare.evaluation` (avaliação pura) e `App.compare.viewModel` (texto pt-BR).
Configuração: `config/compare/viva-juara.json` (`evaluationPolicyVersion: "1.0.0"`), lida via `App.configs.compare[devId]`.

```
ComparisonSnapshot (tópico 24) ──► evaluate(snapshot, opts)
        │                              │ 1. registry(devId)            — políticas validadas (inválidas falham fechado)
        │                              │ 2. ContextualPreferenceResolver — só preferências do perfil do cliente, nunca restrições
        │                              │ 3. evaluateCriterion(def, values, ctx) por métrica
        │                              │      suficiência → stale → conflito → confiança → semântica → empate → margem
        │                              │ 4. candidateSummaries / highlights (dedup + teto por público)
        ▼                              ▼
ComparisonMatrix (sem vencedor) + ComparisonEvaluationSnapshot ─► App.compare.viewModel.build ─► App.compareView.render
```

## API

| Função | Entrada → saída |
|---|---|
| `registry(devId, override?)` | registry validado e congelado (cache por dev) |
| `definitionOf(metricId, reg)` | definição do critério (semântica, políticas, frase, ressalvas) |
| `resolvePreference(def, ctx)` | `{ semantics, target?, rationaleCode }` ou `null` (CONTEXT_REQUIRED) |
| `evaluateCriterion(def, values, ctx)` | `ComparisonMetricEvaluationResult` |
| `evaluate(snapshot, { audience, customerProfile, evaluationProfileId, metricIds, previous, referenceCandidateId, reg, now, noCache })` | `ComparisonEvaluationSnapshot` |
| `candidateSummaries`, `highlights`, `shareFacts(evaluation, { names })` | resumos por lote, destaques, linhas seguras para compartilhar |
| `phraseOf(result, label)` | frase "o menor preço de tabela" a partir da definição |
| `legacyRowWinners`, `legacyLeaders` | adaptadores da API legada `App.services.comparison` |
| `log()`, `clearCache()` | observabilidade (sem PII) e limpeza do cache |

## ComparisonMetricEvaluationResult

```
{ metricId, winnerSemantics, resolvedSemantics, evaluationStatus (WINNER|TIE|NO_CLEAR_WINNER|NOT_COMPARABLE|INSUFFICIENT_DATA|CONTEXT_REQUIRED|SUPPRESSED|ERROR),
  winnerCandidateIds, tieState (TOP_TIED|ALL_TIED|null), slightAdvantageCandidateId, assessments [{ candidateId, assessmentState, comparativeAdvantage, rank?, rawValue }],
  marginSummary { bestValue, runnerUpValue, runnerUpCandidateId, absoluteDifference, relativeDifferencePct }, dataSufficiency { validCandidates, totalCandidates, partial },
  suppressionReasons[], reasonCodes[], caveats[], evaluationConfidence, resolvedPreference, priority, policy { resolvedSemantics, tie, margin, confidence, version }, inputKey }
```

## ComparisonEvaluationSnapshot

`{ id, comparisonSnapshotId, comparisonSnapshotHash, evaluationPolicyVersion, evaluationProfileId, audience, contextHash, metricResults {metricId: result}, inputKeys {metricId: key}, recomputedMetricIds, summary { candidateSummaries, highlights }, generatedAt }`

- Determinístico: mesma entrada → mesmo resultado (a ordem dos candidatos não altera vencedor nem empate).
- Recomputação seletiva: `inputKeys` = hash(valores da métrica + versões das quais ela depende (`dependencies`) + preferência resolvida + público + versão da política). Com `previous`, só as métricas com chave diferente são reavaliadas (`recomputedMetricIds`). Mudança de filtro ou camada não muda chave nenhuma.
- Cache (`clearCache`) por hash do snapshot + contexto; acerto devolve `recomputedMetricIds: []`.

## Contexto do cliente

`hasCustomer` vem de `snapshot.contextRef.customerProfileVersion`; as preferências vêm de `opts.customerProfile.preferences` (somente leitura). Restrições (`constraints`) nunca são lidas: o comparador não filtra nem relaxa nada.

## Precisão

Valores brutos (nunca o texto arredondado); dinheiro em centavos inteiros; floats com `EPS = 1e-9`. Divisão por zero, unidade divergente, valor fora de `validRange` e política inválida → `ERROR`/`SUPPRESSED`, nunca vencedor.
