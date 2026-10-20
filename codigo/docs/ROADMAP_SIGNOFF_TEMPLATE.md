# Modelo de signoff de fase

Signoff não precisa virar burocracia em cada fase pequena. É obrigatório em:
- fase que faz cutover de capacidade P0 (use também `MIGRATION_SIGNOFF_TEMPLATE.md`);
- fase que fecha uma onda;
- fase que remove legado (W9).

```text
Fase: __ — ____________   Onda: W_   roadmapVersion: ________
Critérios de saída (ROADMAP_ENTRY_EXIT_CRITERIA.md): todos [ ]
Gates: BUILD [ ] TEST [ ] PARITY [ ] SECURITY [ ] PERFORMANCE [ ] OBSERVABILITY [ ] DOCUMENTATION [ ] ARCHITECTURE [ ]
Evidência (arquivos/testes): ____________
Problemas conhecidos registrados: ____________

Validação de negócio (o valor existe, sem perda de capacidade): ________ data ____
Validação técnica (gates, rollback, segurança):                ________ data ____
Validação de corretor (fluxo real: mapa → lote → comparar → enviar): ________ data ____
```

```ts
interface PhaseSignoff { phaseId: string; roadmapVersion: string; gates: Record<string, boolean>; evidence: string[]; approvals: { role: 'BUSINESS'|'TECHNICAL'|'BROKER'; by: string; at: string }[]; knownIssues: string[]; }
```
