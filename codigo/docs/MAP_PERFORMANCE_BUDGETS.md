# Budgets de performance do mapa (Tópico 46 §72–§74, §113)

`App.geo.perf.BUDGET` (referência; validar nos aparelhos-alvo):
| Métrica | Budget | Medido depois (desktop 1×) | Medido depois (CPU 4×) |
|---|---|---|---|
| FPS durante gesto (pan) | ≥ 50 | p95 do quadro 16,8 ms (≈60) | p95 16,8–33 ms |
| Latência de interação (clique → `.sel`) | ≤ 100 ms | ver relatório | ver relatório (dominada pelos painéis, não pelo mapa) |
| Troca de camada (até o próximo quadro) | ≤ 100 ms | ver relatório | ver relatório |
| Atualização visual de filtro | ≤ 100 ms | mesmo caminho do `render()` (≈2–4 ms no mapa) | |
| Hit test (serviço) p95 | ≤ 10 ms | ≈0,3–0,5 ms | ≈1 ms |
| Long task | ≤ 50 ms | pan: 0 | pan próximo: 123 → poucas |
| Decodificação de geometria | ≤ 50 ms | ≈17 ms (fora do caminho crítico) | ≈44–52 ms |
| Primeira renderização do mapa (DOM) | ≤ 150 ms | ≈22 ms | ≈86–140 ms |
| Construção do índice | ≤ 20 ms | ≈2,5 ms | ≈10–13 ms |
| Tamanho do bundle de geometria | ≤ 2 MB | geometria vem dentro de `lots.json` | |

`checkBudget(measured)` compara só regressões materiais (sem limites de microssegundos). Frame budget a 60 FPS: 16,67 ms; o JS próprio do mapa no pan ficou em ≈1 ms por quadro.

## Governança (§145)
Toda feature nova de mapa responde: cria cópia de geometria? adiciona trabalho por quadro? escreve no store global? aumenta rótulos? aumenta custo de hit test? aumenta memória? muda budget? precisa de worker/índice/pré-processamento? Rodar `g46_bench.js` antes/depois e anexar ao PR.
