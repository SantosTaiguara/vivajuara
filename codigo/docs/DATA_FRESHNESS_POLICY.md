# Política de frescor por uso (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. DISPLAY / DECISION / TRANSACTION.
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Modo CLOCK: sem timestamp → UNKNOWN; limiar null → NOT_CONFIGURED; vencido → staleBehavior (WARN/DEGRADE/BLOCK). Modo VERSION: compara versão vigente vs. esperada.

| Política | Domínio | Modo | Fonte | Display | Decision | Transaction | Comportamento |
|---|---|---|---|---|---|---|---|
| FP-AVAILABILITY | AVAILABILITY | CLOCK | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | `{"DISPLAY":"WARN","DECISION":"DEGRADE","TRANSACTION":"BLOCK"}` |
| FP-PRICING | PRICING | VERSION | price-table-v1 | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | `{"DISPLAY":"WARN","DECISION":"DEGRADE","TRANSACTION":"BLOCK"}` |
| FP-GEOMETRY | GEOMETRY | VERSION | official-plan-v1 | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | `{"DISPLAY":"WARN","DECISION":"WARN","TRANSACTION":"BLOCK"}` |
| FP-ANALYSIS | ANALYSIS | VERSION | analysis-v1 | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | `{"DISPLAY":"WARN","DECISION":"DEGRADE","TRANSACTION":"WARN"}` |
| FP-LOT-IDENTITY | LOT_IDENTITY | VERSION | official-plan-v1 | **null — necessita confirmação** | **null — necessita confirmação** | **null — necessita confirmação** | `{"DISPLAY":"WARN","DECISION":"WARN","TRANSACTION":"BLOCK"}` |

## Estado atual
| Domínio | Modo | Status | Uso | Estado | Comportamento | Permitido | Degradado |
|---|---|---|---|---|---|---|---|
| AVAILABILITY | CLOCK | UNKNOWN | DISPLAY | UNKNOWN | WARN | sim | não |
| AVAILABILITY | CLOCK | UNKNOWN | DECISION | UNKNOWN | DEGRADE | sim | sim |
| AVAILABILITY | CLOCK | UNKNOWN | TRANSACTION | UNKNOWN | BLOCK | não | não |
| PRICING | VERSION | FRESH | DISPLAY | FRESH | — | sim | não |
| PRICING | VERSION | FRESH | DECISION | FRESH | — | sim | não |
| PRICING | VERSION | FRESH | TRANSACTION | FRESH | — | sim | não |
| GEOMETRY | VERSION | FRESH | DISPLAY | FRESH | — | sim | não |
| GEOMETRY | VERSION | FRESH | DECISION | FRESH | — | sim | não |
| GEOMETRY | VERSION | FRESH | TRANSACTION | FRESH | — | sim | não |
| ANALYSIS | VERSION | FRESH | DISPLAY | FRESH | — | sim | não |
| ANALYSIS | VERSION | FRESH | DECISION | FRESH | — | sim | não |
| ANALYSIS | VERSION | FRESH | TRANSACTION | FRESH | — | sim | não |
| LOT_IDENTITY | VERSION | FRESH | DISPLAY | FRESH | — | sim | não |
| LOT_IDENTITY | VERSION | FRESH | DECISION | FRESH | — | sim | não |
| LOT_IDENTITY | VERSION | FRESH | TRANSACTION | FRESH | — | sim | não |
