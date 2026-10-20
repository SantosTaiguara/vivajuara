# Política de retenção (Tópico 32)

- Configurada por classificação em `config/documents/viva-juara.json` (`retentionPolicies`); classificação desconhecida → a mais estrita
  (`RECORD`, sem exclusão física).
- Documento publicado/oficial é **arquivado**, nunca apagado por padrão (`archive` mantém versões e histórico).
- `deleteVersion` só para versão em estágio (`DRAFT/UPLOADED/REJECTED`), permitida pela política e **sem referências** (ex.: proveniência
  do Tópico 33, snapshots, documentos gerados). Caso contrário → `RETENTION_POLICY_BLOCKED`.
- Legal hold: campo previsto (`legalHoldSupported`); implementação no backend.
- Temporários (staging, quarentena) podem ser removidos (`deleteTemporary`).
