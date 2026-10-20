# Relatório de validação de geometria — Viva Juara (Tópico 46 §15–§17)

Executado por `App.geo.geometry.validate(lots, { dev })` sobre os 498 lotes de `lots.json` (versão estática `2026-10-06.1`).

| Verificação | Resultado |
|---|---|
| Polígono vazio / < 3 pontos | 0 |
| NaN / Infinity | 0 |
| Anel inválido / área zero | 0 |
| Autointerseção (cruzamento próprio de arestas) | 0 |
| IDs duplicados / ausentes | 0 / 0 |
| Bbox inválido | 0 |
| Fora dos limites da planta (2247 × 1587) | 0 |
| Geometria duplicada (mesmo anel) | 0 |
| Bounds declarados ≠ bounds recalculados (> 0,05) | 0 |
| Centróide fora do polígono ou a < 1 unidade da borda | 0 (todas as 498 âncoras de rótulo = centróide) |
| Compatibilidade lote ↔ geometria | READY: 498 lotes, 498 feições, 0 faltando, 0 órfãs, 0 duplicadas |
| Adjacência | 3,3 vizinhos por lote em média (simétrica) |

Nada foi corrigido: o serviço só reporta (severidade ERROR/WARNING/INFO). Um reparo explícito exigiria geometria derivada com método, versão e provenance (§16), sem sobrescrever a fonte. O caso "lote sem geometria" (teste com dados sintéticos) gera `MISSING`, nenhum polígono, e o lote continua no domínio.
