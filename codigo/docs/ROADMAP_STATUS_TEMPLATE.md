# Modelo de status por fase

Use na revisão periódica: semanal enquanto houver fase IN_PROGRESS. O status oficial é o de `roadmap.json`. Este relatório só registra a leitura do momento.

```text
Fase:            __ — ____________________   Onda: W_
Status:          NOT_STARTED | READY | IN_PROGRESS | BLOCKED | VALIDATING | DONE
Responsável:     ________
Pré-requisitos:  ____ (HARD) / ____ (SOFT)
Entregáveis:     ____ (existem? [ ])
Bloqueios:       D-____ / insumo externo ____
Paridade:        golden ___ diferenças; exceções ___; t18 ___
Segurança:       ___
Performance:     ___ vs PERFORMANCE_BASELINE
Cutover:         modo atual ___ → próximo ___
Rollback:        nível ___; testado em ___
Próxima ação:    ________
```

```ts
interface RoadmapExecutionRecord { phaseId: string; status: string; owner?: string; reviewedAt: string; blockers: string[]; parity?: { goldenDiffs: number; exceptions: string[] }; nextAction: string; }
```

## Painel mínimo

Na revisão, rode:

```bash
node -e "const R=require('./src/governance/roadmap.js'),r=require('./config/governance/roadmap.json');console.log(R.waveStatus(r),R.maturity(r).level,R.nextActionable(r).map(p=>p.phaseId))"
```

Fase IN_PROGRESS em duas revisões seguidas sem mudança: mover para BLOCKED (com o motivo) ou dividir.
