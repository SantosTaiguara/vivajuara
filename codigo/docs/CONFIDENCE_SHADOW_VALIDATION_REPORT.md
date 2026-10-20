# Relatório de validação em modo SHADOW — Confiança do dado (Tópico 34)

Metodologia: `viva-juara-data-confidence` 0.1.0-draft (status DRAFT, calibração UNCALIBRATED).
Modo de execução: **SHADOW** — o índice é calculado e exibido apenas para perfis técnicos. Ele não altera score, ranking, classes, cores, preços, filtros nem recomendações.

> O índice de confiança **não é probabilidade** de o dado estar correto. É um indicador ordinal da qualidade da evidência disponível, segundo regras explícitas e ainda não calibradas.

## Escopo da execução
- 498 lotes x 134 atributos rastreados = 66.732 avaliações (mesmo universo da migração de proveniência, Tópico 33).
- Tempo da avaliação completa do empreendimento: cerca de 4,5 s em Node (harness).

## Distribuição por status
| Status | Avaliações |
|---|---|
| COMPUTED | 23.513 |
| METHOD_UNASSESSED | 27.283 |
| NOT_APPLICABLE (valor não disponível) | 15.438 |
| INSUFFICIENT_EVIDENCE | 498 (todas `availability.freshness`: disponibilidade UNKNOWN em 100% dos lotes) |

## Distribuição por faixa (somente COMPUTED)
| Faixa | Avaliações | Origem principal |
|---|---|---|
| LOW | 18.533 | todos os atributos LEGACY_DECLARED (teto legado 0,35) |
| MEDIUM | 2.988 | preço de tabela direto parcial (1.992) + preço e entrada calculados (996) |
| HIGH | 498 | — |
| VERY_HIGH | 1.494 | fatos de configuração versionada |

Scores: mínimo 0,3367; mediana 0,35; máximo 0,9056.

## Métodos não avaliados (geram METHOD_UNASSESSED)
analysis_model 14.940; plan_geometry_measurement 4.926; analysis_rules 2.437; solar_orientation 1.992; plan_vectorization 1.494; lot_id_rule 498; lot_display_code_rule 498; analysis_ranking 498.

Atributos críticos com faixa baixa: 1.494 (necessita confirmação humana das fontes).

## Verificação de não interferência (zero delta de negócio)
Testado em `tests/confidence.test.js`: `serializeLot`, `fitLots` e `recommend` produzem saída idêntica com e sem o serviço de confiança carregado e avaliado. Nenhuma classe, cor ou preço muda. Preço de tabela permanece R$ 1.196/m² (tabela 2026-10-06).

## Leitura dos resultados
- A predominância de LOW é esperada: o legado não tem documento-fonte versionado e o teto 0,35 é intencional.
- METHOD_UNASSESSED não é falha do dado; indica que o método não teve confiabilidade avaliada por pessoa responsável.
- Nenhum resultado deve ser exibido ao cliente final enquanto a metodologia estiver em DRAFT.
