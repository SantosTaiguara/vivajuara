# Runner de checagens (DataQualityCheckRun) (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

`engine.run({input, ruleIds?, ruleSetIds?, trigger})` avalia em ordem topológica (dependência falha → dependente NOT_EVALUATED). `runSafely` nunca lança: erro vira run ERROR. `dryRun` não persiste. `assess` exclui regras EVENT_DRIVEN (transacionais rodam nos gates). O run guarda resumos + amostras (≤10), nunca o dataset; fingerprint estável dos dados de entrada.

No backend: `service.runChecks` (job; persiste run e findings por organização).

## Execução real (2026-10-16T12:00:00Z, somente leitura) — status `PASSED_WITH_WARNINGS`
| Regra | Status | Modo efetivo | Avaliados | Falhas | Motivo |
|---|---|---|---|---|---|
| DQ-LOT-001 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-LOT-002 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-LOT-004 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-TEN-001 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-TEN-002 | PASSED | ENFORCED | 996 | 0 |  |
| DQ-AVAIL-001 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-AVAIL-002 | FAILED | WARNING | 498 | 498 |  |
| DQ-AVAIL-003 | NOT_EVALUATED | ENFORCED | 0 | 0 | NO_KNOWN_STATUS |
| DQ-AVAIL-005 | NOT_EVALUATED | ENFORCED | 0 | 0 | NO_PREVIOUS_SNAPSHOT |
| DQ-AVAIL-006 | NOT_EVALUATED | ENFORCED | 0 | 0 | NO_PREVIOUS_SNAPSHOT |
| DQ-AVAIL-007 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-TX-001 | NOT_EVALUATED | WARNING | 0 | 0 | NO_SOLD_LOT |
| DQ-GEO-012 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-GEO-002 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-GEO-003 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-GEO-004 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-PRICE-008 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-PRICE-002 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-PRICE-003 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-PRICE-004 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-PRICE-005 | PASSED | WARNING | 498 | 0 |  |
| DQ-ANA-001 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-ANA-002 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-ANA-003 | PASSED | WARNING | 498 | 0 |  |
| DQ-PROV-001 | FAILED | WARNING | 9 | 2 |  |
| DQ-NULL-001 | FAILED | SHADOW | 54 | 30 |  |
| DQ-VOL-001 | PASSED | WARNING | 1 | 0 | RULE_UNOWNED |
| DQ-VJ-LOT-003 | PASSED | ENFORCED | 498 | 0 |  |
| DQ-VJ-SCHEMA-001 | PASSED | ENFORCED | 77 | 0 |  |
| DQ-VJ-DIST-001 | PASSED | WARNING | 18 | 0 |  |
