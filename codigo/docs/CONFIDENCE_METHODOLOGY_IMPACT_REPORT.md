# Relatório de impacto de metodologia — Confiança do dado (Tópico 34)

## Situação atual
- Não há versão publicada anterior: a única versão registrada é `0.1.0-draft` (DRAFT, UNCALIBRATED).
- Portanto não existe comparação histórica real; este documento descreve a ferramenta e o procedimento.

## Ferramenta
`App.dataConfidenceServices.createService(...).impactReport(fromResults, toResults)` recebe dois conjuntos de resultados do mesmo escopo (avaliados com a versão vigente e com a candidata) e retorna:
- `fromVersion` / `toVersion`;
- `affectedResults`: quantos resultados mudaram de faixa ou status;
- `bandTransitions`: contagem por transição (ex.: `MEDIUM→LOW`, `COMPUTED→METHOD_UNASSESSED` via status);
- `averageScoreDelta` e `medianScoreDelta`;
- `criticalFieldTransitions`: atributos críticos que mudaram de faixa (até 200);
- `generatedAt`.

`checkComparable(results)` impede comparar índices de versões diferentes de metodologia (`CONFIDENCE_MIXED_METHODOLOGY`).

## Exemplo testado
Em `tests/confidence.test.js`, compara-se `0.1.0-draft` com a variante `0.1.1-strict`; o teste verifica `affectedResults`, `fromVersion` e `toVersion`. Nenhuma alteração em score de negócio, ranking, classe ou preço.

## Regras
- Nenhuma metodologia é publicada automaticamente. Publicar exige a permissão `confidence.methodology.manage` (ainda não registrada: negado por padrão) e aprovação humana.
- Versão publicada é imutável; mudanças geram nova versão.
- Antes de qualquer publicação, gerar este relatório contra a versão vigente e anexá-lo à decisão.
- Mudança de modo SHADOW para visível ao cliente é decisão separada e fora do escopo deste tópico.
