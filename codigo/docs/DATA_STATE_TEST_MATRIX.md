# Matriz de testes — estados de dados (Tópico 37)

Arquivo: `tests/datastate.test.js` (26 testes, node:test). Cenários dourados do §516:

| # | Teste |
|---|---|
| 1 | five orthogonal axes exist and are not folded into one enum; RESTRICTED/HIDDEN are projections only |
| 2 | KnownZeroValue: 0 stays KNOWN 0 where the field allows it; price 0 is INVALID (never a value) |
| 3 | KnownFalseBoolean: false shows "Não", never "Não informado"; null shows "Não informado"-like state, never "Não" |
| 4 | UnknownLegacyNull: a null with no recoverable reason is UNKNOWN / LEGACY_UNCLASSIFIED (honest), never NOT_APPLICABLE |
| 5 | NotAvailableSourceNotProvided: setbacks are NOT_AVAILABLE only because the regulation is missing (evidence), with broker/technical wording |
| 6 | NotApplicableDomainCase: NOT_APPLICABLE only by explicit domain rule (block number by letter; reservedUntil for a SOLD lot) |
| 7 | PendingImport / PendingAnalysis: PENDING comes from a state record (domain), not from UI loading; UI FAILED does not mutate it |
| 8 | UnresolvedConflict: CONFLICTED keeps value null (no candidate used) and blocks the share of a critical field |
| 9 | InvalidParsedValue / ProcessingError: invalid values are not consumed; ERROR is technical, the client sees a neutral text |
| 10 | PartialCompositeGeometry: PARTIAL needs child states; composite summary is PARTIAL while children keep their own states |
| 11 | KnownButStalePrice: STALE keeps the value (KNOWN + STALE) and adds "confirmar"; EXPIRED is not usable for comparisons |
| 12 | KnownButRestrictedField / HiddenSensitiveField: access is a projection; canonical unchanged; HIDDEN leaks nothing |
| 13 | UnknownNumericFilter: unknown area is UNKNOWN (not 0, not a fail); EXCLUDE by default, INCLUDE/SEPARATE_BUCKET explicit; facets keep the count |
| 14 | UnknownBooleanConstraint: UNKNOWN never becomes false/FAIL; NOT_APPLICABLE separate; the rule engine receives UNKNOWN |
| 15 | ComparatorInsufficientData: an unknown candidate never wins/loses numerically; one valid value → INSUFFICIENT_DATA (topic 25 unchanged) |
| 16 | ShareUnknownSafely: no false factual claim ("Recuo frontal: 0 m"); NOT_APPLICABLE omitted; hidden never mentioned |
| 17 | OfflineKnownStale: offline is a connectivity context; the cached known value stays KNOWN (+ STALE), never UNKNOWN |
| 18 | raw presence: missing key ≠ explicit null ≠ empty string; sentinels only where configured ("-" is content elsewhere) |
| 19 | invariant validator: every error code reachable; known empty collection allowed only where configured |
| 20 | field policies come from the Field Registry, validate cleanly and carry registry refs; contradictions are caught |
| 21 | state index: tenant isolation (cross-tenant read/write DENY), transitions on state change only |
| 22 | derived value: price per m² with unknown area is NOT_AVAILABLE / MISSING_REQUIRED_INPUT, never price/0 |
| 23 | map and legend: unknown values get the neutral no-data style, never the lowest bucket; counts by state |
| 24 | availability adapter: UNKNOWN status is UNKNOWN data (value null), never AVAILABLE; a known status keeps its value |
| 25 | migration parity: every KNOWN value is identical to the canonical Lot (zero delta); inventory + impact report are complete |
| 26 | the resolver does not mutate the canonical Lot and the domain holds no UI strings |

Cobertura dos itens §473–§515: known zero/false, string vazia, array vazio conhecido, chave ausente, null explícito, sentinela N/A só onde configurada,
null legado, NOT_APPLICABLE por regra, PENDING ≠ loading, falha de UI não muda estado, conflito sem valor, inválido não consumido, erro técnico,
parcial com estados filhos, stale/expired, restrito/oculto sem vazamento, filtros numérico/booleano, include unknown, facetas, mapa/legenda,
comparação/INSUFFICIENT_DATA, restrição/Recommendation UNKNOWN, operando de regra UNKNOWN, compartilhamento sem afirmação falsa, exportação técnica,
DTO known false/zero/unknown, tenant cruzado negado, offline stale, paridade de valores conhecidos, inventário de sentinelas.
Não cobertos (módulos inexistentes neste código): Rule Engine real (Tópico 36), Confidence (34), Provenance formal (33).
