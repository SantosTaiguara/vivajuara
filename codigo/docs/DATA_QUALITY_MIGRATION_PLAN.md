# Plano de migração (tópico 61)

> Qualidade de Dados e Governança Operacional · política `dq-platform-2026-10-16.1` · fonte: `config/dataquality/*.json` + `src/dataquality/*`. 
> Valores `null` = **não configurado / necessita confirmação**: o código recusa ou degrada, nunca inventa. UNKNOWN nunca é HEALTHY; null nunca é 0.

Migração `backend/migrations/015_data_quality.sql` (down: `down/015_data_quality.down.sql`): dq_check_runs, dq_findings, dq_exceptions (expires_at NOT NULL; aprovador ≠ solicitante), dq_incidents, dq_certifications, dq_reconciliation_runs, dq_change_requests, dq_publication_snapshots (imutável por trigger). Sem colunas de PII.

Passos: 1) aplicar 015; 2) ligar rotas (`registerDataQualityRoutes`, ROUTE_POLICIES, `addDataQualityPaths`); 3) chaves no IAM do backend (decisão de grant); 4) regras novas em SHADOW → WARNING → ENFORCED com dry-run e owner; 5) gate ONBOARDING_BATCH no tópico 58. Rollback: down script (dados de qualidade são derivados e regeneráveis, exceto snapshots e incidentes — exportar antes).
