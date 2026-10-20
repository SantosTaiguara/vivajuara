# Modelo de signoff de migração (P0)

Exigido por `cutoverGate` para capacidades P0. Copie para `docs/signoffs/<data>-<capacidade>.md` (ou registre no PR).

```text
Capacidade: CAP-__ — ____________________   Prioridade: P0
Migração: de ____________ para ____________   Modo atual: SHADOW | CANARY | NEW_WITH_FALLBACK
Release / build: ____________   architectureVersion: 1.0   dataset: 2026-10-06.1|2026-10-06|2026-10-06

Evidências
- tests (npm test): ___ passando, 0 falhas            [ ]
- architecture52: 0 violações novas                   [ ]
- preservation54 (golden): 0 diferenças / exceções: ___ [ ]
- divergência em sombra no período: ___ (exigido 0)    [ ]
- performance vs PERFORMANCE_BASELINE: ___             [ ]
- segurança (tópico 50): ___                           [ ]
- rollback testado em: ___                             [ ]
- nota para suporte/corretores enviada: ___            [ ]

Diferenças intencionais (LEGACY_PARITY_EXCEPTIONS.md): ___

Aprovação
- Produto / negócio: ________  data: ____
- Técnico: ________            data: ____
- Corretor de referência (fluxos reais): ________  data: ____
```

```ts
interface MigrationSignoff { capabilityId: string; release: string; evidence: Record<string, string>; approvals: { role: 'BUSINESS'|'TECHNICAL'|'BROKER'; by: string; at: string }[]; }
```

Não é preciso signoff para mudança de CSS ou capacidade P2/P3 sem diferença no golden.
