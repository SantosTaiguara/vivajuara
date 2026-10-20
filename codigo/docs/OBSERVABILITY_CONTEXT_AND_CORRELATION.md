# Contexto e correlação

## ObservabilityContext

`App.observability.core.createContext(base, extra)` aceita apenas as chaves do contrato (`CONTEXT_KEYS`): environment, appVersion, buildId, organizationId, developmentId, principalId, requestId, correlationId, traceId, spanId, routeCode, jobId, eventId, resourceType, resourceId, deviceClass, connectivityState, rendererType, component. Qualquer outra chave (e-mail, URL…) é descartada (teste).

`defaultContext()` lê só fontes autoritativas: `App.store` (desenvolvimento, rota), `App.authz` (organização), perfil responsivo (classe do dispositivo), conectividade e o marcador de release. Nunca `location.href`, nunca token. `principalId` não é preenchido no navegador (minimização); no servidor só se for o ID interno.

## IDs distintos

| ID | Formato | Vida | Quem cria |
|---|---|---|---|
| requestId | `req_` + 16 hex | uma requisição | cliente (`requestContext`) ou servidor (`requestIdOf`, já existe) |
| correlationId | `cor_` + 16 hex | sessão da aba → API → job → webhook | cliente uma vez por aba; servidor aceita `x-correlation-id` em formato seguro |
| traceId / spanId | 32 / 16 hex (W3C) | um trace | tracer |
| errorId | `err_` + 12 hex | uma ocorrência | ErrorReporter |
| supportCode | `VJ-` + 6 caracteres | derivado do errorId | mostrado ao usuário |

`requestId ≠ traceId ≠ correlationId` (teste `ObsCorrelationIdPropagation`). No corpo de erro v1 do servidor, `traceId` continua sendo um alias de `requestId` para compatibilidade; quando houver tracing, o trace W3C usa outro valor.

## Propagação

`headersFor(ctx, url)` devolve `traceparent`, `x-request-id` e `x-correlation-id` **somente** para URL relativa (mesma origem) ou origem listada em `policy.propagation.approvedOrigins` (vazia hoje). Terceiros, `//host` e outras origens recebem `{}`.

No servidor, `contextFromHeaders(headers, requestId)` (backend/src/shared/observability/telemetry.js) lê `traceparent` válido e `x-correlation-id` seguro; caso contrário cria novos.

## Jobs e assíncronos

Um job abre **trace novo** com `links` para o span que o criou (`startSpan('job.consume', { links })`); nenhum trace fica aberto por horas: `tracer.sweep()` fecha spans acima de `maxSpanDurationMs` (5 min) com `truncated: true`.

`JobObservabilityContext { jobId, jobType, organizationId, developmentId, attempt, maxAttempts, enqueuedAt, startedAt }` é contrato de servidor (ver JOB_AND_QUEUE_OBSERVABILITY.md).
