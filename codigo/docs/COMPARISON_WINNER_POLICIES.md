# Políticas de destaque (Tópico 25)

Todas em `config/compare/viva-juara.json`, versionadas por `evaluationPolicyVersion` (hoje `1.0.0`). Os números abaixo são **propostas técnicas** e precisam de validação humana (ver relatório).

## Lógica legada encontrada e removida

| Onde | O que fazia | Situação |
|---|---|---|
| `src/presentation/viewmodels.js` (`comparisonVM`, `better: 'max'\|'min'`) | marcava "melhor" o maior score/área/frente e o menor preço/distância | `better` é ignorado; o vencedor vem do registry. `comparisonVM` pode ser aposentado quando o lead ligar `App.compareView` |
| `src/services/comparison.js` (`compare`) | `Math.max`/`Math.min` por linha, sem empate, sem margem, vencia com 1 valor | reescrito: delega a `legacyRowWinners` — fieldKey sem semântica registrada, área e distâncias sem contexto → sem vencedor (falha fechada) |
| `src/services/comparison.js` (`leaders`) | líder por nota com desempate implícito pela ordem | delega a `legacyLeaders` (tolerância 0,1 e margem 0,5 de nota) |

## Empate (`tiePolicies`)

| id | tipo | tolerância |
|---|---|---|
| exact | EXACT | — |
| money | ABSOLUTE_TOLERANCE | R$ 0,01 |
| score100 | ABSOLUTE_TOLERANCE | 1 ponto |
| note10 | ABSOLUTE_TOLERANCE | 0,1 |
| area | RELATIVE_TOLERANCE | 1% |
| distance | ABSOLUTE_OR_RELATIVE | 10 m ou 3% |
| ordinal | EXACT | — |
| target | TARGET_DISTANCE | 1 |

## Margem mínima (`marginPolicies`)

| id | margem | abaixo da margem |
|---|---|---|
| money | ≥ 2% | NO_CLEAR_WINNER |
| score100 | ≥ 3 pontos | NO_CLEAR_WINNER |
| note10 | ≥ 0,5 | NO_CLEAR_WINNER |
| area | ≥ 5% | NO_CLEAR_WINNER |
| distance | ≥ 50 m e ≥ 10% | NO_CLEAR_WINNER |
| ordinal | ≥ 1 nível | TIE |
| target | ≥ 10 da meta | NO_CLEAR_WINNER |

Diferença real abaixo da margem = "Sem diferença relevante" (o corretor vê "Ligeira vantagem de X"; o cliente não).

## Suficiência (`dataSufficiencyPolicies`)

- default: mínimo 2 valores válidos; cliente e apresentação exigem todos os candidatos com dado (`requireAllCandidatesFor`); versões iguais (`requireSameVersion`) senão `VERSION_MISMATCH`.
- Um único valor válido nunca vence (`ONLY_VALID_CANDIDATE_SUPPRESSED`). Dado parcial: corretor vê o destaque com ressalva "Comparação parcial: 3 de 4 lotes com dados"; cliente, suprimido.

## Dado desatualizado (`stalePolicies`)

- commercial: corretor/técnico `ALLOW_WITH_WARNING`; cliente/apresentação `SUPPRESS_WINNER`; vencido (EXPIRED) → `SUPPRESS_WINNER` para todos.
- availability: `SUPPRESS_WINNER` sempre. none: estáticos.

## Conflito e confiança

- `conflictPolicies.default = SUPPRESS_METRIC`: qualquer célula CONFLICTED suprime o destaque da linha.
- `confidencePolicies.default`: mínimo cliente MEDIUM, apresentação MEDIUM, corretor LOW, técnico LOW; métricas `estimated` (quietScore, privacyScore) exigem HIGH em apresentação.

## Perfis de avaliação e destaques

`evaluationProfiles`: QUICK, BROKER_STANDARD, CUSTOMER, TECHNICAL, INVESTMENT, HOUSING — todos sem overrides nesta versão (o perfil muda quais linhas aparecem, não as regras).
`highlights.max`: corretor 5, técnico 5, cliente 3, apresentação 3; deduplicados por `dedupGroup` (preço e preço/m² contam uma vez); só WINNER (P0/P1 primeiro).
