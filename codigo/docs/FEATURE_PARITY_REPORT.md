# Relatório de paridade de funcionalidades

Onda: baseline (onda 0), 2026-10-11. Próximas ondas acrescentam uma seção cada, com o resultado do golden e as exceções aprovadas.

## Baseline 2026-10-11

| Capacidade | Prova | Resultado |
|---|---|---|
| 498 lotes clicáveis | golden `map` (498 features com anel; hit-test no ponto de rótulo = próprio lote: 0 falhas) | ✓ |
| Busca | golden `search` (10 consultas: "A1", "QA L1", "Q B", "B", "5", "Lote 5", "b79", "Quadra O lote 5", "ZZ9", "B7") | ✓ |
| Filtros (28 definições, 3 níveis) | golden `filters` (28 cenários; ex.: `area-min-500` 21, `green-behind` 83, `score-housing-70` 214, `status-available` 0) | ✓ |
| Camadas (13 + 5 variantes de score) | golden `layers` (cor de cada lote em cada camada; legenda) e t18 `TOTAL DIFF 0` | ✓ |
| QuickView | golden `quickview` (21 lotes × corretor/cliente) | ✓ |
| Scores/classes/rankings | golden `lots` + `intelligence.test.js` (zero diff) | ✓ |
| Solar | golden `solar` | ✓ |
| Financeiro | golden `finance` + `regression.test.js` (código de `index_v1.html`) | ✓ |
| Comparação | golden `comparison` | ✓ |
| Share/WhatsApp | golden `share` (status honesto, rodapé, sem score no modo cliente) | ✓ |
| Recomendação | golden `recommendations` (real: 0 por UNKNOWN; sintético: ranking estável) | ✓ |

## Mudanças intencionais

Nenhuma nesta onda.

## Rodada paralela (tópicos 49, 50, 51, 53, 56)

Os módulos novos dessas frentes ainda não estão na ORDER do harness; quando o coordenador integrá-los, `preservation54.test.js` mostra se algum dado ou saída calculada mudou. Mudança esperada → registrar aqui e em `LEGACY_PARITY_EXCEPTIONS.md`.
