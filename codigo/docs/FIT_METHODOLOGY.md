# Metodologia do Fit Score (FitMethodologyConfig)

Tópico 14. Configuração em `plat/config/fit/viva-juara.json`, executada por `App.fit.fitLot` em `plat/src/intelligence/fit.js`. Arquitetura em `FIT_SCORE_ARCHITECTURE.md`; perfil e catálogo de preferências em `CUSTOMER_PROFILE_SCHEMA.md`.

O Fit mede aderência às preferências informadas. Não é probabilidade de compra, não promete valorização e não lê disponibilidade (status UNKNOWN nunca é tratado como AVAILABLE, e um lote vendido mantém o Fit que teria).

## 1. Cabeçalho da config

| Campo | Valor |
|---|---|
| `kind` | `fit-methodology` |
| `schemaVersion` | `1.0` |
| `fitMethodologyId` | `viva-juara-fit` |
| `fitMethodologyVersion` | `1.0.0` |
| `developmentId` | `viva-juara` |
| `status` | `PUBLISHED` |
| `publishedAt` | `2026-10-07T00:00:00.000Z` |
| `changeReason` | "Formaliza a 'compatibilidade' que o painel já calculava (média ponderada das notas 0–10, pesos Pouco 1, Importante 2, Essencial 4, notas ausentes ignoradas) e acrescenta orçamento e faixa de área como preferências." |
| `scale` | 100 |
| `importanceMap` | LOW 1, MEDIUM 2, HIGH 4 |
| `aggregation` | `WEIGHTED_AVERAGE` |
| `missingPolicy` | `IGNORE_AND_RENORMALIZE` |
| `minCoverage` | 0.5 |
| `strengthMin` / `mismatchMax` | 0.75 / 0.4 |
| `confidence.stalePenalty` | 0.5 |

A config de Fit é separada da config de scores (`config/scoring/`). Nenhum valor dela altera Score Moradia, Investimento, Família, Premium ou Geral.

## 2. Cálculo

Para cada preferência efetiva `p` (ativa, última por chave, na ordem do catálogo), com peso `w = importanceMap[importância]`:

1. Lê o valor do lote no `fieldKey` do catálogo (`App.model.get`) e a proveniência (`App.model.getFieldProvenance`).
2. Valor `null` → a preferência não é avaliada (`FIT_MISSING_LOT_DATA`); matcher sem contexto (por exemplo, sem faixa de área) → `FIT_MISSING_CONTEXT`. Nos dois casos o peso fica fora do denominador e o campo entra em `missingInputs`. O valor ausente nunca é tratado como 0.
3. Caso contrário, `m = matcher(valor)` entre 0 e 1, contribuição `w × m`.

```
fitScore   = 100 × Σ (w × m) ÷ Σ w            (só preferências avaliadas)
coverage   = Σ w avaliado ÷ Σ w de todas as preferências efetivas
confidence = Σ (w × q) ÷ Σ w avaliado          (q = qualidade da proveniência)
```

Sem preferência efetiva: `status = INSUFFICIENT_PROFILE`, `fitScore = null`, `coverage = 0`, aviso `EMPTY_PROFILE`. Com preferências mas nenhuma avaliável: `status = PARTIAL`, `fitScore = null`, aviso `NO_EVALUABLE_PREFERENCE`. Cobertura abaixo de `minCoverage` (0.5) mantém o Fit e acrescenta `LOW_COVERAGE`. O `fitScore` não é arredondado no motor; a interface mostra o inteiro mais próximo.

Paridade: com os 9 modelos de preferência, o Fit v1 dividido por 100 é igual à "compatibilidade" que o painel calculava antes (`App.services.recommendation.rank` em `src/services/finding.js`), diferença < 1e-12 em todos os 498 lotes.

## 3. Matchers (`MatchingRegistry`)

Todos na versão `1.0`, registrados por id; nenhum usa `eval`. `p` = preferência, `d` = entrada do catálogo.

| Matcher | Resultado (0 a 1) | Parâmetros |
|---|---|---|
| `SCORE_PREFERENCE` | `clamp(v, 0, scaleMax) ÷ scaleMax` | `scaleMax` 10 (notas) ou 100 (scores) |
| `BOOLEAN` | 1 se `v` igual ao alvo, senão 0 | `target` da preferência ou do catálogo |
| `ENUM` | 1 se igual; senão a similaridade do catálogo; senão 0 | `similarity` |
| `CATEGORICAL_SET` | 1 se `v` está na lista alvo | — (sem uso no catálogo) |
| `NUMERIC_RANGE` | 1 dentro de [min, max]; fora, `1 − distância ÷ tolerância`, mínimo 0 | `tolerance` ou `toleranceM2` |
| `NUMERIC_TARGET` | `1 − |v − alvo| ÷ tolerância`, mínimo 0 (tolerância padrão 1) | — (sem uso no catálogo) |
| `MINIMUM` | 1 se `v ≥ alvo`; abaixo, queda linear na tolerância | `tolerance` ou `alvo × toleranceRatio` |
| `MAXIMUM` | 1 se `v ≤ alvo`; acima, queda linear na tolerância | idem |
| `PROXIMITY` | 1 até `idealM`, 0 a partir de `zeroAtM`, linear entre os dois | `idealM`, `zeroAtM` |
| `AVOIDANCE` | 0 até `zeroAtM`, 1 a partir de `idealM`, linear entre os dois | `zeroAtM`, `idealM` |
| `RELATIVE_HIGHER` | posição na faixa do empreendimento: `clamp(10 × (v − min) ÷ max(1, max − min), 0, 10) ÷ 10`; sem faixa → não avaliado | faixa de `contextFor` (só `geometry.areaM2`) |

Parâmetros do catálogo do Viva Juara:

| Preferência | Matcher | Valores |
|---|---|---|
| quiet, privacy, solar, view, leisure, gate, lowTraffic, geometry, priceQuality | SCORE_PREFERENCE | `scaleMax` 10 |
| housing, investment, family, premium | SCORE_PREFERENCE | `scaleMax` 100 |
| green | BOOLEAN | alvo `true` |
| noCorner | BOOLEAN | alvo `false` |
| area | RELATIVE_HIGHER | faixa de área dos lotes carregados |
| budget | MAXIMUM | `toleranceRatio` 0.1 (zera em 10% acima do orçamento) |
| areaRange | NUMERIC_RANGE | `toleranceM2` 50 |
| rearOrientation | ENUM | N: NE 0.5, NW 0.5; S: SE 0.5, SW 0.5; E: NE 0.5, SE 0.5; W: NW 0.5, SW 0.5 |
| nearGate | PROXIMITY | `idealM` 150, `zeroAtM` 1000 |
| awayFromAvenue | AVOIDANCE | `zeroAtM` 50, `idealM` 250 |

## 4. Classificação de cada preferência

| Faixa do `matchScore` | `reasonCode` | Lista |
|---|---|---|
| ≥ 0.75 | `FIT_STRONG_MATCH` | `strengths`: as 5 maiores contribuições (`w × m`), desempate por chave |
| > 0.4 e < 0.75 | `FIT_PARTIAL_MATCH` | `neutral` |
| ≤ 0.4 | `FIT_MISMATCH` | `mismatches`: as 5 maiores perdas (`w × (1 − m)`), desempate por chave |

`preferenceMatches` traz todas, ordenadas pela contribuição (não avaliadas por último), com: `preferenceId`, `key`, `fieldKey`, `preferenceType`, `domain`, `rawLotValue`, `targetValue`, `matchScore`, `importance`, `weight`, `weightedContribution`, `dataStatus`, `confidence` (da proveniência), `reasonCode`.

`domainMatches` repete a média ponderada por domínio (`100 × Σ w × m ÷ Σ w` dentro do domínio). É só leitura: não há peso por domínio e nada é ponderado duas vezes.

## 5. Confiança

Qualidade `q` por status do dado (`confidence.byDataStatus`):

| Status | Rótulo da plataforma | q |
|---|---|---|
| `CONFIRMED` | confirmado | 1 |
| `CALCULATED` | calculado | 0.9 |
| `ESTIMATED` | estimado | 0.7 |
| `TO_CONFIRM` | necessita confirmação | 0.5 |
| `CONFLICTED` | fontes divergentes | 0.3 |
| `UNKNOWN` | não disponível | 0 |
| `NOT_APPLICABLE` | não aplicável | 0 |

Se a preferência usa preço (`usesPrice`, hoje só `budget`) e a atualidade comercial do contexto é `STALE`, `q` é multiplicado por 0.5 e o resultado recebe `STALE_PRICE`. O status do dado reduz a confiança, não o `matchScore`.

Nível: HIGH se ≥ 0.85, MEDIUM se ≥ 0.6, LOW abaixo; UNKNOWN quando não há valor.

## 6. Exemplo verificado

Perfil `{ privacy: 3, green: 2, gate: 1 }` (HIGH, MEDIUM, LOW) no lote A1, com os valores publicados hoje:

| Preferência | Valor do lote | Status | m | w | w × m | Código |
|---|---|---|---|---|---|---|
| privacy | 7 | estimado | 0.7 | 4 | 2.8 | FIT_PARTIAL_MATCH |
| gate | 10 | estimado | 1 | 1 | 1 | FIT_STRONG_MATCH |
| green | `false` | calculado | 0 | 2 | 0 | FIT_MISMATCH |

`fitScore = 100 × 3.8 ÷ 7 = 54.29` (exibido "54% compatível"), `coverage = 1`, `status = COMPLETE`, `confidence = (4 × 0.7 + 1 × 0.7 + 2 × 0.9) ÷ 7 = 0.757` (MEDIUM). Ponto forte: gate; incompatibilidade: green; neutra: privacy. Domínios: ENVIRONMENT 46.67, LOCATION 100.

## 7. Dados dinâmicos

| Dado | Efeito no Fit |
|---|---|
| Disponibilidade | nenhum; não é lida e não entra na chave de cache |
| Preço | só com a preferência `budget`; preço novo muda o match; preço `STALE` reduz a confiança |
| Análise (notas, scores) | muda o match das preferências de nota e de score; a versão entra na `cacheKey` |
| Perfil | qualquer mudança de chave, alvo, importância ou `enabled` muda o `profileVersion` |

## 8. Não implementado / pendências

- `aggregation`, `missingPolicy`, `status`, `kind`, `fitMethodologyId` e `importanceLabels` são declarativos: `fit.js` sempre aplica média ponderada com renormalização e não lê esses campos. Trocar `missingPolicy` na config não muda o cálculo.
- Implementado em 08/10/2026: `App.fit.validateConfig` confere pesos, faixas, tipos de matcher e seus parâmetros. Continua sem ciclo de vida ou registro de versões como o de `App.methodology`.
- Políticas `NEUTRAL`, `BLOCK_PREFERENCE` e `LOW_CONFIDENCE` para dado ausente: não existem.
- Status `CONFLICTED` só reduz a confiança (q 0.3); não exclui a preferência nem gera aviso próprio.
- Implementado em 08/10/2026: o limite de cobertura baixa da Quick View vem da config do Fit (`minCoverage`); 0,5 só é usado se a config não tiver o valor. Continua pendente um `minCoverageForDisplay` que troque o percentual por um rótulo de compatibilidade parcial.
- `RELATIVE_HIGHER` só tem faixa para `geometry.areaM2`.
- Matcher customizado registrado por versão, arredondamento definido pela metodologia, calibração do Fit e domínios com peso: não existem.
