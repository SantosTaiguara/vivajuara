# Matriz de testes golden

> Documento gerado por `node scripts/governanceDocs.js` a partir de `config/governance/golden.json` e `tests/golden/baseline.json`. Não editar à mão: altere a fonte e gere de novo.

Baseline `golden-viva-juara-2026-10-11`, empreendimento `viva-juara`, 498 lotes, relógio fixo 2026-10-11T12:00:00-03:00, dataset `2026-10-06.1|2026-10-06|2026-10-06`. Teste: `tests/preservation54.test.js` (qualquer diferença falha, salvo ParityException aprovada).

| Categoria (golden test category) | O que é capturado | Entradas | Fingerprint sha256 |
|---|---|---|---|
| dataset | contagens, blocos, hashes sha256 canônicos dos arquivos de dados, versões do manifest, Field Registry (chaves), contagem por status/classe | 13 | `885496c27b5f4e6c…` |
| lots | um registro por lote (498): identidade, geometria (área, frente, fundos, laterais, forma, esquina, bbox, hash do polígono), localização, vizinhança, mobilidade, orientação/sol/ruído/privacidade, preço, R$/m², entrada, planos, status, scores, classe, notas, rankings, alertas (tipo:severidade e texto), destaques, status de proveniência, hash do lote inteiro | 498 | `576f90407ee70463…` |
| map | bundle de geometria (contagem, checksums de origem e render, limites), hit-test no ponto de rótulo de cada lote (deve cair no próprio lote), âncoras dos lotes representativos | 8 | `e90ec97850ae22c9…` |
| layers | para cada camada (e cada score): lotes por cor, contagem por cor, cobertura e itens da legenda | 18 | `a94c3d13ab1c1359…` |
| filters | 28 cenários de filtro: contagem, hash da query, filtros descartados e códigos casados | 28 | `8284a2ea745d3314…` |
| recommendations | presets legados (top 10 + relevância + contagem comercial), motor de recomendação nos dados reais (0 recomendados: tudo UNKNOWN) e num cenário sintético AVAILABLE (só teste), Fit top 10 | 3 | `af52b719f8b91a51…` |
| finance | simulação de 4 cenários × todos os planos da tabela: entrada, financiado, parcela principal, anuais, total, fluxo anual | 2 | `f65454a2cd249501…` |
| solar | para 21 lotes representativos × 3 estações: nascer/pôr, intervalos frente/fundos e momento às 8/12/16 h | 21 | `9ef9648d75ea7d60…` |
| quickview | fatos essenciais do QuickView (identidade, status, preço, métricas, inteligência, destaques, alertas, fatos, proveniência, capacidades) nos modos corretor e cliente; ações e layout ficam de fora | 21 | `34f796eba7189a37…` |
| share | texto do resumo/WhatsApp, avisos e link wa.me para 3 conjuntos × 2 modos | 6 | `1f990e4bb5088bb9…` |
| comparison | colunas, linhas primárias, grupos e vencedores por critério para 2 conjuntos × 2 modos | 4 | `ca7286f4c7c8b427…` |
| search | 10 consultas de busca: tipo de resultado e códigos | 10 | `be1d03a42072d717…` |
| texts | rótulos-chave: status de disponibilidade, status do dado, formatos de moeda/área, rodapé do resumo | 9 | `f3b7cc67e275bcd2…` |

## Lotes representativos

| Código | Por quê |
|---|---|
| A1 | mais perto da portaria (percurso); frente SE; interno; 1º lote do dataset |
| A2 | classe C |
| A5 | sem alertas |
| A6 | maior preço e maior área |
| A11 | esquina; frente E |
| B1 | classe D; frente NW |
| B2 | menor score geral; mais alertas; frente N; alerta de privacidade |
| B3 | frente NE |
| B16 | menor preço e menor área |
| B65 | formato irregular; alerta de geometria |
| B67 | alerta de servidão (EASEMENT) |
| B68 | frente W |
| B70 | frente SW |
| B71 | área verde nos fundos; restrição construtiva |
| B73 | classe A+ |
| B79 | lote usado nos cenários de comparação/QuickView existentes |
| B83 | formato trapezoidal |
| B86 | frente S |
| I1 | alerta de área técnica |
| L9 | mais perto do clube (percurso) |
| O5 | maior score geral |

## Cenários de filtro

| Cenário | Estado do filtro | Lotes |
|---|---|---|
| empty | `{}` | 498 |
| status-unknown | `{"statuses":["UNKNOWN"]}` | 498 |
| status-available | `{"statuses":["AVAILABLE"]}` | 0 |
| only-offerable | `{"onlyOfferable":true}` | 0 |
| block-A | `{"block":"A"}` | 11 |
| block-O | `{"block":"O"}` | 11 |
| price-max-600k | `{"priceMax":600000}` | 478 |
| price-min-800k | `{"priceMin":800000}` | 10 |
| area-min-500 | `{"areaMin":500}` | 21 |
| class-min-A | `{"classMin":"A"}` | 125 |
| no-corner | `{"noCorner":true}` | 444 |
| shape-irregular | `{"shapes":["IRREGULAR"]}` | 14 |
| green-behind | `{"greenBehind":true}` | 83 |
| rear-north | `{"rearOrientation":["N","NE","NW"]}` | 192 |
| noise-max-low | `{"noiseMax":"LOW"}` | 408 |
| privacy-min-high | `{"privacyMin":"HIGH"}` | 133 |
| traffic-max-low | `{"trafficMax":"LOW"}` | 183 |
| gate-max-200 | `{"gateMaxM":200}` | 59 |
| club-max-250 | `{"clubMaxM":250}` | 70 |
| no-noise-alert | `{"noNoiseAlert":true}` | 469 |
| score-housing-70 | `{"scoreKey":"housing","scoreMin":70}` | 214 |
| alerts-exclude-avenue | `{"alertsExclude":["AVENUE"]}` | 467 |
| text-B7 | `{"q":"B7"}` | 1 |
| price-m2-1196 | `{"pricePerM2Min":1196,"pricePerM2Max":1196}` | 498 |
| front-min-15 | `{"frontMin":15}` | 68 |
| depth-max-30 | `{"depthMax":30}` | 450 |
| freshness-unknown | `{"freshness":["UNKNOWN"]}` | 498 |
| combo-B | `{"block":"B","noCorner":true,"classMin":"B","areaMin":400}` | 9 |
