# Estados de dados desconhecidos e degradação elegante (Tópico 37)

Módulo: `src/datastate/dataState.js` → `App.dataState`. Somente leitura sobre o Lot canônico (delta de valor zero).

## Princípio
`null` não é significado de negócio. Todo valor lido pela camada de apresentação passa pelo `AttributeValueResolver`
(`App.dataState.resolve(lot, attributePath, opts)`), que devolve um `ResolvedAttributeValue` com valor + estado.

```
UNKNOWN ≠ FALSE ≠ ZERO ≠ EMPTY ≠ NOT_APPLICABLE ≠ NOT_AVAILABLE ≠ ERROR
```

## Eixos ortogonais (nunca fundidos num enum)
| Eixo | Valores | Depende do usuário? |
|---|---|---|
| CanonicalDataState | KNOWN, UNKNOWN, NOT_AVAILABLE, NOT_APPLICABLE, PENDING, CONFLICTED, INVALID, ERROR, PARTIAL | não |
| FreshnessState | CURRENT, STALE, EXPIRED, UNKNOWN, NOT_APPLICABLE (política por domínio: commercial / availability; estáticos = NOT_APPLICABLE) | não |
| DataCompletenessState | COMPLETE, PARTIAL, EMPTY, NOT_APPLICABLE | não |
| DataAccessProjection | FULL, SUMMARY_ONLY, REDACTED, HIDDEN | sim |
| UiLoadState | NOT_REQUESTED, LOADING, LOADED, FAILED (só UI, `withLoad`) | — |

`ProjectedDataState` = estados canônicos + RESTRICTED + HIDDEN (derivado por visualizador, nunca gravado).
Offline é `ConnectivityContext` (`opts.offline`), nunca estado canônico: valor em cache continua KNOWN (+ STALE).

## Regras implementadas
- null legado sem motivo recuperável → `UNKNOWN / LEGACY_UNCLASSIFIED` (honesto); motivo só com evidência (`NULL_CLASSIFICATION`).
- Código de enum `UNKNOWN` (ex.: `geometry.shape`, `surroundings.viewPermanence`) → estado UNKNOWN sem valor operacional; exceto eixos onde UNKNOWN é valor (`availability.freshness`, confiabilidades).
- `0` conhecido permanece 0 quando a política permite (`allowKnownZero`); preço/área 0 → INVALID.
- `false` conhecido → "Não"; `[]` conhecido → "Nenhum" (`allowKnownEmptyCollection`).
- STALE preserva valor e adiciona aviso; CONFLICTED não usa candidato (valor null); RESTRICTED/HIDDEN não alteram a fonte.
- Disponibilidade UNKNOWN → estado UNKNOWN / SOURCE_NOT_INGESTED, valor null, nunca AVAILABLE.

Ver também: ATTRIBUTE_DATA_STATE_MODEL.md, NULL_AND_SENTINEL_NORMALIZATION_POLICY.md, DATA_STATE_UI_PROJECTION_POLICY.md,
DATA_STATE_FILTER_COMPARE_SHARE_SEMANTICS.md, LEGACY_NULL_MIGRATION_REPORT.md, DATA_STATE_IMPACT_REPORT.md, DATA_STATE_TEST_MATRIX.md.
