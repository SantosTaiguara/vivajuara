# Relatório de paridade de performance

Formato por migração: métrica · antes · depois · Δ · orçamento · decisão. Ambiente igual ao de `PERFORMANCE_BASELINE.md`.

## 2026-10-11 — tópicos 52/54/55

Nenhuma mudança de runtime: os módulos de governança (`src/governance/*`) não entram no build (não estão na ORDER nem na lista de UI) e rodam só nos testes. Performance do app inalterada por construção.

## Histórico já medido

| Migração | Métrica | Antes → depois | Fonte |
|---|---|---|---|
| Tópico 46 (renderer/câmera) | troca de camada p95 (1×) | 77 → 34 ms | `MAP_PERFORMANCE_BASELINE_REPORT.md` |
| Tópico 46 | clique → `.sel` p95 (1×) | 58 → 49 ms | idem |
| Tópico 46 | panNear quadros > 33 ms | 126 → 5 | idem |
| Tópico 47 (lazy loading) | interativo frio, fast | ver A×B no relatório | `LAZY_LOADING_BASELINE_REPORT.md` |
