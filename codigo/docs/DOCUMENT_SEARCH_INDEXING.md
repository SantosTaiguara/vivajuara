# Busca e indexação de documentos (Tópico 32)

- Índice por organização (`Map(org → Map(versionId → registro))`); registro com título, tipo, tags, autoridade, classificação, referência ao
  texto extraído e `indexVersion` (reindexar incrementa `indexVersion` **sem** criar versão de documento).
- Modos: `METADATA`, `FULL_TEXT`, `STRUCTURED`, `HYBRID`. Padrão: apenas a versão publicada corrente; `TECHNICAL/AUDIT` incluem históricas.
- **Ordem obrigatória:** tenant → `decide(READ)` → só então título/trecho/contagem. Documento sem acesso não aparece nem como contagem.
- Relevância nunca é autoridade (`relevanceScore` é só ordenação; `metadata.authority` vem do documento).
- Tokenização sem acento (NFD) para pt-BR.

Backend: índice full-text (Postgres `tsvector` com dicionário `portuguese` ou motor externo) com filtro de `organization_id` no próprio
índice e pós-filtro de autorização; nunca indexar documento `RESTRICTED` em índice compartilhado sem partição por organização.
