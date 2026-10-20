# Política de propagação (Tópico 34)

- Dependências vêm da linhagem do Tópico 33 (`dependencyRefs`); o serviço avalia as entradas primeiro (memo por chamada, proteção de ciclo,
  profundidade máxima 4).
- `missingDependencyBehavior: BLOCK` e `propagateBlockingStatus: true`: entrada obrigatória sem confiança calculada ⇒ `DEPENDENCY_UNAVAILABLE`
  (score null). Entrada faltante nunca vira 0.
- Fingerprint da entrada diferente do que o derivado registrou ⇒ entrada tratada como `INVALID_PROVENANCE`.
- Derivado limitado pelas entradas: teto `WEAKEST_DEPENDENCY = min(1, menor entrada + 0,15)` (proposta). Não se usa `output = min(inputs)` universal.
- Confiabilidade do método não substitui a confiança das entradas (fórmula determinística ainda depende de área e R$/m²).
- Mudança de fonte: nova versão publicada → Tópico 33 marca revisão → currentness `REVIEW_REQUIRED`/`SOURCE_SUPERSEDED` → nova avaliação
  com score menor e **mesmo valor** (teste `SourceUpdateLowersConfidenceWithoutChangingValue`). Histórico preservado.
- Mudança de metodologia: nova versão; resultados de versões diferentes não se comparam (`MIXED_METHODOLOGY`), nem entram no mesmo snapshot.
- Confiança nunca altera proveniência nem valor canônico.
