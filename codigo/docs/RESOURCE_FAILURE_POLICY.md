# Política de falha por recurso (Tópico 47)

`FAILURE_POLICY` / `failurePolicy(type)` em `loading/resources.js`:

| Recurso | Comportamento | Retries automáticos | Retry do usuário |
|---|---|---|---|
| GEOMETRY_BUNDLE | BLOCK_ROUTE ("Não foi possível carregar os lotes.") — antes usa a última cópia offline | 2 | sim |
| MAP_BOOTSTRAP | DEGRADE (versões não confirmadas; dados carregados continuam válidos) | 2 | não |
| PRICING_SNAPSHOT | DEGRADE: última tabela "necessita confirmação"; sem cópia → "Preço não disponível" | 2 | sim |
| AVAILABILITY_SNAPSHOT | DEGRADE: status desconhecido (nunca AVAILABLE) | 1 | sim |
| BASE_MAP_MEDIUM | DEGRADE: lotes continuam navegáveis | 1 | não |
| BASE_MAP_HIGH | KEEP_LOWER_QUALITY: mantém a planta | 1 | não |
| TECHNICAL_ANALYSIS_INPUT | SHOW_RETRY: "O score publicado continua valendo." | 1 | sim |
| MOBILITY_ROUTES / GALLERY_INDEX | HIDE_FEATURE | 1 | sim |
| GALLERY_IMAGE / SERVICE_WORKER | HIDE_FEATURE | 0 | não |

Retry: limitado e com backoff; **401/403 nunca são repetidos** (FORBIDDEN); 404 de recurso versionado atualiza o ponteiro (manifest) **uma vez** e tenta de novo; 5xx/timeout/rede conforme a tabela. Cancelado não é falha.
`App.loadingView.resourceStatus(result, …)` só mostra o botão `data-act="loadRetry"` quando a política permite.
