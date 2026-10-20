# Taxonomia de erros (ApplicationError)

`core.appError(code, { cause, dependency, httpStatus, metadata })` cria um erro com código estável; `core.classify(err)` dá código a erros do navegador; `core.normalizeError(err)` devolve `{ type, code, category, retryable, severity, userSafeMessageKey, httpStatus, dependency, message (redigida), stack[], causeChain[] }`.

Categorias: VALIDATION, AUTHENTICATION, AUTHORIZATION, NOT_FOUND, CONFLICT, DEPENDENCY, NETWORK, DATA_INTEGRITY, INTERNAL.

## Códigos (registry.errors, 30)

| Código | Categoria | Retry | Gravidade |
|---|---|---|---|
| VALIDATION_FAILED | VALIDATION | não | LOW |
| AUTHENTICATION_REQUIRED | AUTHENTICATION | não | MEDIUM |
| AUTHORIZATION_DENIED / TENANT_SCOPE_DENIED | AUTHORIZATION | não | MEDIUM / HIGH |
| RESOURCE_NOT_FOUND | NOT_FOUND | não | LOW |
| AVAILABILITY_REVISION_CONFLICT, PRICE_TABLE_VERSION_CONFLICT, RESOURCE_VERSION_MISMATCH | CONFLICT | sim | MEDIUM |
| API_SERVER_ERROR, API_REQUEST_FAILED, RATE_LIMITED, DEPENDENCY_TIMEOUT | DEPENDENCY | sim | HIGH/MEDIUM/LOW/HIGH |
| REQUEST_TIMEOUT, NETWORK_UNAVAILABLE | NETWORK | sim | MEDIUM / LOW |
| REQUEST_ABORTED | NETWORK | não | LOW |
| DATA_PARSE_FAILED, CACHE_CORRUPT_ENTRY, DATA_INTEGRITY_VIOLATION | DATA_INTEGRITY | sim/sim/não | MEDIUM/MEDIUM/HIGH |
| STORAGE_QUOTA_EXCEEDED, STORAGE_UNAVAILABLE | DEPENDENCY | não | MEDIUM |
| MAP_GEOMETRY_LOAD_FAILED, MAP_RENDER_FAILED | DEPENDENCY / INTERNAL | sim | HIGH |
| DOCUMENT_SCAN_FAILED, SW_UPDATE_FAILED | DEPENDENCY | sim | MEDIUM / LOW |
| SHARE_ACCESS_DENIED | AUTHORIZATION | não | LOW |
| PWA_SYNC_FAILED, PWA_SYNC_CONFLICT | NETWORK / CONFLICT | sim / não | MEDIUM |
| PRICE_TABLE_PUBLISH_FAILED | INTERNAL | sim | HIGH |
| FRONTEND_UNEXPECTED, INTERNAL_UNEXPECTED | INTERNAL | não | MEDIUM / HIGH |

Classificação automática: HTTP 401/403/404/409/429/504/5xx/4xx, `AbortError`, `TimeoutError`, `QuotaExceededError`, `TypeError: Failed to fetch`, `SyntaxError` de JSON, `CHECKSUM_MISMATCH`.

## Regras

- A lógica usa `code`, nunca o texto.
- O usuário vê `userMessage(code)` (15 textos em pt-BR, `registry.userMessages`) e o código de suporte. Nunca pilha, SQL ou mensagem interna (teste `ObsApi500ErrorCapture`).
- `cause` é preservada até 5 níveis, cada uma com código e mensagem redigida.
- Timeout tem código próprio; dependência guarda só um nome controlado (`[a-z0-9_]`).
- Metadata do erro passa pela redaction.
- Servidor: `backend/src/shared/http/errors.js` já responde `{ code, message, details, requestId, traceId, timestamp }` sem pilha. Os códigos do servidor e do registro devem convergir (decisão de manutenção, sem mudança de API neste tópico).
