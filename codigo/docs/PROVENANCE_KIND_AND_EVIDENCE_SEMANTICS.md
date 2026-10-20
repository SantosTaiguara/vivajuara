# Semântica de ProvenanceKind e EvidenceState (Tópico 33)

| Kind | Significado | Exige |
|---|---|---|
| DIRECT_SOURCE | Valor lido de uma fonte, sem transformação | evidência (≠ dependência) |
| NORMALIZED_SOURCE | Lido de fonte e normalizado (ex.: `"250,00 m²" → 250`) | evidência + `MethodRef` de normalização |
| CALCULATED | Fórmula/processo determinístico | `MethodRef` versionado e dependências quando conhecidas |
| ESTIMATED | Modelo/estimativa — **continua estimativa** na UI | `MethodRef` |
| AGGREGATED | Agregação de membros | método + dependências |
| MANUAL_ASSERTION | Informado por pessoa, rastreável | `USER_ASSERTION`, motivo; permissão |
| MANUAL_OVERRIDE | Substituição explícita (ação de risco; desligada por padrão) | política do campo, motivo, permissão |
| ANALYSIS_DERIVED | Saída do motor de análise | `ANALYSIS_RESULT` (análise + módulo + metodologia) |
| LEGACY_DECLARED | Rótulo herdado sem fonte exata recuperável | — (nunca `VERIFIED`) |
| NOT_AVAILABLE | Ausência com motivo (`NotAvailableReason`) | motivo |

EvidenceState: `VERIFIED` (fonte exata localizável e íntegra), `PARTIAL` (parte da cadeia é rastreável), `UNRESOLVED` (fonte declarada mas não
localizada), `MISSING`, `CONFLICTED`, `ACCESS_RESTRICTED` (o próprio sistema não acessa), `INVALID`.
**Visibilidade ≠ estado:** evidência pode ser `VERIFIED` e oculta (`HIDDEN`) para quem está vendo.

Currentness: `CURRENT`, `SOURCE_SUPERSEDED`, `STALE`, `REVIEW_REQUIRED`, `UNKNOWN`. Status do registro: `ACTIVE`, `SUPERSEDED`,
`INVALIDATED`, `REVIEW_REQUIRED`, `ARCHIVED`.

## displayCode (derivado; não substitui o modelo técnico)
| Condição | Código | Corretor | Cliente | Técnico |
|---|---|---|---|---|
| DIRECT/NORMALIZED + VERIFIED | CONFIRMED | Confirmado | Confirmado | Confirmado (evidência verificada) |
| DIRECT/NORMALIZED + PARTIAL | **INFORMED** (extensão documentada) | Informado | Informado | Informado — evidência parcial |
| CALCULATED/AGGREGATED, ANALYSIS_DERIVED não estimado | CALCULATED | Calculado | Calculado | Calculado |
| ESTIMATED, ANALYSIS_DERIVED estimado | ESTIMATED | Estimado | Estimado | Estimado |
| LEGACY_DECLARED | LEGACY | Informado | Informado | Legado — fonte não rastreada |
| MANUAL_* | MANUAL | Informado manualmente | Informado | Asserção manual |
| NOT_AVAILABLE | NOT_AVAILABLE | Não disponível | Não disponível | Não disponível |
| conflito aberto | CONFLICT | Conflito | Necessita confirmação | Conflito aberto |
| revisão/invalidado | REVIEW | Revisar | Necessita confirmação | Revisão necessária |

Os rótulos atuais do painel ("Confirmado", "Calculado", "Estimado", "A confirmar", "Não disponível") **não foram alterados**; os novos
badges são adicionais e só aparecem quando o líder integrar a UI.
