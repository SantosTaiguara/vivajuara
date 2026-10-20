# Modelo de finding (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Findings agrupados por regra×escopo (id `dqf_<hash>`), com `failedEntityCount`, `evaluatedCount`, até 10 amostras, lineage (fonte, versões) e owner herdado da regra.

Ciclo: OPEN → ACKNOWLEDGED → IN_REMEDIATION → RESOLVED (exige evidência + reexecução passando) | FALSE_POSITIVE (motivo ≥ 10 caracteres) | EXCEPTED. Reaparecer após RESOLVED reabre. Outra organização: NOT_FOUND.

## Findings atuais
| Regra | Domínio | Severidade | Falhas/avaliados | Amostras |
|---|---|---|---|---|
| DQ-AVAIL-002 | AVAILABILITY | WARNING | 498/498 | VJ-QA-L0001, VJ-QA-L0002, VJ-QA-L0003 |
| DQ-PROV-001 | LOT_IDENTITY | WARNING | 2/9 | identity.id, identity.developmentId |
| DQ-NULL-001 | GEOMETRY | INFO | 30/54 | identity.blockNumber, identity.externalCode, geometry.perimeterM |
