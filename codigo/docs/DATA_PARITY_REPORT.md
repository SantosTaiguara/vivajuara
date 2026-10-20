# Relatório de paridade de dados (DATA_PARITY_REPORT)

> Documento gerado por `node scripts/governanceDocs.js` a partir de `tests/golden/dataset.golden.json` e `lots.golden.json`. Não editar à mão: altere a fonte e gere de novo.

Estado em 2026-10-11T12:00:00-03:00: baseline gravado. Toda migração (JSON → API, renderer, motor) compara contra estes valores; diferença = falha do `preservation54.test.js`.

| Item | Valor no baseline |
|---|---|
| Lotes | 498 (IDs únicos: 498) |
| Quadras | 18 (A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R) |
| Campos do Field Registry | 138 (hash `c1ea783c095e400e…`) |
| Status de disponibilidade | UNKNOWN: 498 |
| Classes | A: 100, A_PLUS: 25, B: 199, C: 125, D: 49 |
| R$/m² | 1196 (tabela 2026-10-06) |
| Lotes sem preço | 0 |
| Versões publicadas | static 2026-10-06.1 · análise 2026-10-06 · tabela 2026-10-06 |
| Checksums FNV do manifest | static 563a5f06 · analysis 98319c8d |

## Hashes dos arquivos de dados (JSON canônico, sha256)

| Arquivo | sha256 |
|---|---|
| analysis-input.json | `323c3328f5aee8987647411792fc0a1a0a7955ece3ca19b9f86d2b5d6820e29b` |
| commercial.json | `67d29ff476cfeadcd7be7b8913bec839d7e6d8bb4e259702fe755759d366d756` |
| lots.json | `cf7d3be5baf8460f0ba890ec01f1d376fc92134c58ec4c7b5f8b065701aa13d7` |
| routes.json | `5cc65c5cd8a84a6457fb4560dda984a66bcddfdcad704bcfc86c383acfabca48` |

## Preservação de campos (FieldPreservationReport)

As chaves do Field Registry ficam no golden (`dataset.fieldRegistry.keys`). Remover ou renomear um campo faz o teste falhar; a remoção exige justificativa em `LEGACY_PARITY_EXCEPTIONS.md`.

## Diferenças aprovadas

Nenhuma (`parityExceptions` vazio).
