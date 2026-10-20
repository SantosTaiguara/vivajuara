# ComparisonViewModel / EvaluatedComparisonViewModel (Tópicos 24–25)

Composição, sem alterar a matriz base: `ComparisonMatrix + ComparisonEvaluationSnapshot → EvaluatedComparisonViewModel` (`App.compare.viewModel.build`).
A formatação (formatBRL, formatSquareMeters, formatMeters, formatScore, formatNote, formatLevel, i18n) acontece aqui, nunca no domínio.

## Entrada única para a UI

```js
const r = App.compare.viewModel.fromState({
  developmentId, lotIds,                 // st.comparisonLotIds (ordem explícita)
  resolve: ref => repo.resolve(ref),     // Lot canônico
  audience,                              // 'client' | 'broker' | 'technical' | 'presentation'
  metricProfileId?, scoreKey?,           // perfil de métricas; score do objetivo
  fitById?, customerProfile?,            // selectFit(st), selectProfile(st) — só preferências e profileVersion são lidos
  recommendation?, filter?: { active, matchedIds }, activeLayerId?, previous?, now? })
// → { vm, session, snapshot, matrix, evaluation, rejected }
```
`App.compareView.view(input)` faz o mesmo guardando `previous` e o perfil escolhido, e devolve `{ html, result }`.

## Estrutura

```
{ sessionId, title, mode, status, countLabel ("3 de 4"), canCompare, summaryMessage,
  candidates [{ id, name ("QA L1"), order, title, statusLabel, statusWarn, priceText, priceNote, areaText, outsideFilter, recommendationText, canMoveLeft, canMoveRight, criterionSummary { clearWins, coWins, slightAdvantages, text } }],
  groups [{ id, label, collapsedByDefault, empty, emptyText, rows [{ metricId, label, emphasis, cells [{ candidateId, text, note, cellState, badge, stale, emphasis, ariaLabel }], evaluation }] }],
  rowEvaluations [ComparisonRowEvaluationViewModel { metricId, status, winnerCandidateIds, cellStates, explanationText, caveatText, highlightMode, policyText }],
  candidateSummaries, criterionHighlights [{ candidateId, name, items[] }], highlightsNote, warnings[], fitNote, actions[], profiles[], freshness, completeness, footnote, technical?, baseComparison, evaluationPolicyVersion }
```

## Por modo

- Cliente/apresentação: sem notas, scores, classe, versões ou fontes; disponibilidade como "Disponibilidade sujeita a confirmação"; só destaques claros (badge "Destaque"); nenhum "ligeira vantagem", "valor menos favorável" nem jargão (testado).
- Corretor: badges "Destaque", "Empate", "Ligeira vantagem"; explicações de supressão ("Não foi possível destacar um lote devido a dados desatualizados.").
- Técnico: todas as linhas (inclusive as vazias e ocultas), política de cada linha (regra, empate, margem, confiança, versão, motivos), hash do snapshot e versões.

## Render (`App.compareView.render(vm)`)

- Cards dos candidatos (`<ol>`): Q/L, situação, preço de tabela, área, "Destaque em N critérios", fora dos filtros, recomendação (corretor), Mover para a esquerda/direita, Remover; o nome abre o lote no mapa.
- Cada grupo é um `<details>` com sua tabela: `<caption>`, lotes em `th scope="col"`, critérios em `th scope="row"`; a célula tem `aria-label` "Preço de tabela, QF L6, R$ 299.000. Destaque neste critério: QF L6 possui o menor preço de tabela." Status/stale/destaque sempre com texto, nunca só cor.
- Mobile: cards com rolagem horizontal e tabelas com primeira coluna fixa; tablet/desktop: grade. O HTML é o mesmo em qualquer largura.
- Ações por `data-act` delegadas pelo app: `goLot`, `cmpRemove`, `cmpMove` (`data-dir` -1|1), `cmpProfile` (`data-v`), `shareCmp`, `cmpClear`. `cmpMove` e `cmpProfile` foram registrados em `config/security/features.json` como `lot.compare`.
