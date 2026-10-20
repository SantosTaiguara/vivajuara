# Matriz de testes de performance e regressão (Tópico 46 §75, §80, §112–§120)

## Automatizados (Node, `tests/geo46.test.js`: 18 testes)
manifest/versões/CRS · geometria canônica intacta e `d` idêntico · bbox/centróide/âncora · validação e casos quebrados · compatibilidade · índice × força bruta (real + 1k/5k/10k) · hit test de centróides/âncoras (498/498) · aresta compartilhada determinística · tolerância · gestos · câmera · viewport query · plano de rótulos · LOD · adjacência · budgets/diagnóstico · repositório (tenant, versão, carga obsoleta) · invariantes do `map.js`.

## Navegador (Playwright, scripts em scratchpad; não fazem parte do `npm test`)
| Script | Cenários | Saída |
|---|---|---|
| `g46_bench.js <porta> <rótulo> W H cpu` | carga, pan contínuo (fit e zoom próximo), wheel in/out, hover, troca de 14 camadas ×2, 30 seleções, custo do hit nativo, DOM, heap | JSON com tempos CDP (script/layout/estilo/task), quadros, long tasks |
| `g46_parity.js <porta> <saída> W H` | hit nativo em centróides + vértices + meios de aresta, 6 estados de câmera; serviço em sombra | resultados por ponto |
| `g46_func.js <porta> <saída> W H` | fill/opacidade/classes/aria/`d` dos 498 lotes nas 14 camadas, ordem Z, rótulos na tela, clique após pan, POI por teclado e clique | snapshot para diff |
| `t18.js` | paridade de cor das camadas (Tópico 18) | TOTAL DIFF 0 |

## Matriz de aparelhos
| Alvo | Como foi coberto aqui | Pendente |
|---|---|---|
| Desktop moderno | Chromium 1400 × 900, CPU 1× | — |
| Notebook intermediário | Chromium 1024 × 768 | aparelho real |
| Android intermediário | 390 × 844 com CPU 4× mais lenta | aparelho real, toque nativo |
| iPhone intermediário | — (Safari/WebKit não disponível aqui) | **validar em aparelho** |
| Tablet | 1024 × 768 | iPad real |

## Regressão visual
Fixtures cobertas pelo diff funcional (estado, não pixels): mapa padrão, lote selecionado, todas as camadas (incl. disponibilidade e preço), 390 px e 1400 px. Comparação por screenshot pixel a pixel: não automatizada (pendente).
