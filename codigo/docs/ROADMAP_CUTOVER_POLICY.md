# Política de cutover do roadmap

Os modos e critérios por capacidade estão em `MIGRATION_MODES_AND_CUTOVER_POLICY.md` (tópico 54). O gate automatizado é `App.governance.capabilities.cutoverGate`. Este documento define a estratégia por capacidade no roadmap.

| Capacidade | Fase | Estratégia | Pré-requisito |
|---|---|---|---|
| Leitura de lotes via API (`apiSource`) | 3.2 | NEW_WITH_FALLBACK para o JSON estático, com fallback contado | golden `lots` igual via API e JSON |
| Disponibilidade autoritativa | 3.5 | SHADOW → CANARY com corretores representativos → NEW_ONLY | D-SALES-MIRROR, D-AVAIL-FRESHNESS; UNKNOWN continua UNKNOWN quando a fonte não informa |
| Preço versionado no backend | 3.6 | SHADOW contra `services/pricing`; delta 0 | tabela 2026-10-06 mantida; spec 27 |
| Financeiro no backend | 3.7 | SHADOW contra `services/finance.js` com tolerância 1e-6 nos 4 cenários golden | signoff de produto (P0) |
| Confiança / Rule Engine | 4.6 / 4.7 | já em SHADOW | D-CONFIDENCE / D-ALERTS |
| Customer no servidor | 5.2 | NEW_WITH_FALLBACK (aparelho) | 3.3 + 3.4 + D-CUSTOMER-RETENTION |
| Share com token | 6.3 | NEW_ONLY após projeção client-safe (6.2) | 3.3 |
| Novo renderer de mapa | futuro | só com golden `map`/`layers` iguais e t18 = 0 | — |

## Checklist antes do cutover

- [ ] Backups válidos (quando houver dado mutável no servidor; D-RPO-RTO)
- [ ] Monitoramento pronto
- [ ] Rollback pronto
- [ ] Suporte avisado
- [ ] Feature flag pronta
- [ ] Paridade aceita
- [ ] Segurança aceita

## Checklist depois do cutover

- [ ] Erros estáveis
- [ ] Latência estável
- [ ] Contagem de fallback
- [ ] Chamados do suporte
- [ ] Consistência de dados
- [ ] Eventos de segurança

## Janela

Writes críticos (disponibilidade, cliente) entram no período de menor uso operacional. Migrações só de leitura têm menos restrição. A janela de estabilização vem antes de qualquer remoção do legado (`LEGACY_REMOVAL_CHECKLIST.md`).
