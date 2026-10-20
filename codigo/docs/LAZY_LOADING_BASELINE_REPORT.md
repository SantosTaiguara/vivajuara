# Linha de base e resultado — lazy loading (Tópico 47)

Ferramenta: Playwright + Chromium (`/opt/pw-browsers`), servidor estático local, viewport 1400×900. "Interativo" = mapa com lotes desenhados e cores aplicadas (marcador do app). Perfis: **fast** (sem limitação) e **slow4g** (≈1,6 Mbps, 150 ms RTT, CPU 4×). Cold = contexto novo; warm = recarregar no mesmo contexto (SW + IndexedDB).

## A/B controlado (mesmo build, 3 repetições, mediana)
A = build atual com `offline.js` original; B = build atual com as mudanças deste tópico.

| Cenário | A (ms) | B (ms) | Δ | Requisições A→B | JSON A→B |
|---|---|---|---|---|---|
| fast cold | 1772 | **1355** | −24% | 15 → 10 | 5 → 3 |
| fast warm | 1435 | **1076** | −25% | 9 → 8 | 2 → 2 |
| slow4g cold | 21245 | **20836** | −2% | 16 → 8 | 5 → 3 |
| slow4g warm | 6589 | **4482** | −32% | 9 → 8 | 2 → 2 |

## Linha de base histórica (antes de qualquer mudança da rodada, 1 execução)
fast cold 2167 ms, 15 req, 6,98 MB (planta.webp 3×, manifest e commercial 2×); slow4g cold 20816 ms; fast warm 1520 ms; slow4g warm 5766 ms.

## Leitura
- Cascata `manifest → lots → commercial` virou paralela; requisições duplicadas de dados = 0 (orçamento cumprido).
- slow4g cold é limitado pela banda do **HTML inline (~2,45 MB, ~13,9 s até DOMContentLoaded)**. Só code splitting ou compressão no host (gzip ≈ 628 KB) resolvem — decisões humanas.
- Bytes por execução variam com a ordem de cancelamento/cache HTTP das imagens grandes; o indicador confiável é o número de downloads de planta.webp (3 → 1).
- Paridade de cores do mapa (t18): TOTAL DIFF 0.
