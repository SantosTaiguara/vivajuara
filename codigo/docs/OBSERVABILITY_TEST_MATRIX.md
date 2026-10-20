# Matriz de testes de observabilidade

Arquivo: `tests/observability.test.js` — 37 testes, todos passando (node:test, sem servidor).

## Cenários dourados (§310)

| Cenário | Situação | Teste |
|---|---|---|
| ObsApiRequestTrace | coberto | ObsApiRequestTrace + ObsPricePublishTrace + async job linking: spans carry W3C ids, steps, links; open spans are swept |
| ObsApi500ErrorCapture | coberto | ObsApi500ErrorCapture: requestId generated → ApplicationError code → ERROR log → reporter → metric → user-safe response with support code |
| ObsCorrelationIdPropagation | coberto | ObsCorrelationIdPropagation: requestId ≠ correlationId ≠ traceId; correlation crosses requests; traceparent only to approved origins |
| ObsQuickViewLatencyMetric | coberto | ObsQuickViewLatencyMetric + ObsMapInteractiveMetric: instrumentation reuses geo/perf.js diagnostics and labels only controlled dimensions |
| ObsMapInteractiveMetric | coberto | ObsQuickViewLatencyMetric + ObsMapInteractiveMetric: instrumentation reuses geo/perf.js diagnostics and labels only controlled dimensions |
| ObsCacheHitMetric | coberto | ObsCacheHitMetric + ObsCacheCorruptionError: cache snapshot as gauges; corruption logs WARN and the local alert needs 5 (one isolated error never alerts) |
| ObsCacheCorruptionError | coberto | ObsCacheHitMetric + ObsCacheCorruptionError: cache snapshot as gauges; corruption logs WARN and the local alert needs 5 (one isolated error never alerts) |
| ObsPwaOfflineSyncFailure | coberto | ObsPwaOfflineSyncFailure + connectivity + SW lifecycle are counted with controlled labels |
| ObsJobRetryExhausted | coberto | ObsAvailabilityConflictMetric / ObsJobRetryExhausted (contracts): registered metrics accept only controlled outcomes; DLQ alert is HIGH with runbook |
| ObsPricePublishTrace | coberto | ObsApiRequestTrace + ObsPricePublishTrace + async job linking: spans carry W3C ids, steps, links; open spans are swept |
| ObsAvailabilityConflictMetric | coberto | ObsAvailabilityConflictMetric / ObsJobRetryExhausted (contracts): registered metrics accept only controlled outcomes; DLQ alert is HIGH with runbook |
| ObsDocumentScanFailure | coberto | ApplicationError taxonomy: stable codes from status/name, retryability, user-safe message, cause chain (ObsDocumentScanFailure) |
| ObsShareDeniedWithoutTokenLeak | coberto | ObsShareDeniedWithoutTokenLeak: denial counted by reason category; the token and the link never appear |
| ObsTenantScopeViolationSecurityMetric | coberto | ObsTenantScopeViolationSecurityMetric: aggregated counter, CRITICAL local alert owned by security, never auto-silenced; events aggregated by type only |
| ObsTelemetryBackendUnavailableNonBlocking | coberto | ObsTelemetryBackendUnavailableNonBlocking: sink failures are counted, the user flow continues; the REMOTE sink is off and refuses to send |
| ObsHealthLiveReady | coberto | ObsHealthLiveReady: live is minimal; ready needs lots + config; connectivity and dependencies say "não disponível" when unknown |
| ObsDeployMarkerRegression | coberto | ObsDeployMarkerRegression: release marker on every error group; a new version is an operational change event |
| ObsMultiTabPwaIssueDiagnostic | coberto | ObsSupportDiagnosticSnapshot + ObsMultiTabPwaIssueDiagnostic: versions, cache/PWA summaries and error refs only — no customer, token or URL |
| ObsSupportDiagnosticSnapshot | coberto | ObsSupportDiagnosticSnapshot + ObsMultiTabPwaIssueDiagnostic: versions, cache/PWA summaries and error refs only — no customer, token or URL |
| ObsHighCardinalityLabelRejected | coberto | ObsHighCardinalityLabelRejected: unregistered metric, forbidden/unknown label, uncontrolled value and cardinality budget are rejected |
| ObsLogRedactionAuthorizationHeader | coberto | ObsLogRedactionAuthorizationHeader: headers, cookies, tokens, bodies, notes, CPF and URLs never reach the log |
| ObsFrontendErrorBoundaryFallback | coberto | ObsFrontendErrorBoundaryFallback: local fallback with support code and safe message; the error is reported, never silent |
| ObsTraceSamplingErrorAlwaysCaptured | coberto | ObsTraceSamplingErrorAlwaysCaptured: with defaultRate 0 a healthy trace is dropped and an error trace is kept whole |

## Outros requisitos de teste (§303–308)

| Requisito | Teste |
|---|---|
| redaction do logger | ObsLogRedactionAuthorizationHeader; redaction limits |
| labels de métrica | ObsHighCardinalityLabelRejected; histograms |
| propagação de trace | ObsCorrelationIdPropagation; ObsApiRequestTrace |
| mapeamento de erro | ApplicationError taxonomy |
| IDs de correlação | ObsCorrelationIdPropagation |
| captura de erro / handlers globais | global handlers; ObsApi500ErrorCapture |
| health endpoints | ObsHealthLiveReady; backend telemetry helpers (/health/live) |
| Error Boundary + código de suporte | ObsFrontendErrorBoundaryFallback |
| sem PII na telemetria | no PII in any telemetry |
| falha de telemetria não bloqueia | ObsTelemetryBackendUnavailableNonBlocking; reporter never recurses |
| injeção de falha: cache corrompido, recurso stale | ObsCacheCorruptionError; data freshness |
| CI do registro | registry: bundled and valid; registry validation catches |
| separação de domínios | separation |
| higiene de console | legacy inventory |

Não cobertos aqui (precisam de servidor/navegador real): testes de carga (§306–307), E2E com provedor, chaos (§309). A coleta no navegador foi verificada num Chromium headless local (ver FRONTEND_OBSERVABILITY.md).

## Lista completa

1. registry: bundled with the configs and valid for every CI check (owners, runbooks, labels, PII, naming, boundaries)
2. registry validation catches: metric without owner, forbidden label, HIGH alert without runbook, PII span attribute, security critical auto-silence
3. ObsLogRedactionAuthorizationHeader: headers, cookies, tokens, bodies, notes, CPF and URLs never reach the log
4. redaction limits: truncates long strings, deep objects and long arrays; sanitizeUrl drops query/hash and share tokens
5. no PII in any telemetry: logs, error groups, spans, metric labels, snapshot, view model and OTLP mapping
6. ObsCorrelationIdPropagation: requestId ≠ correlationId ≠ traceId; correlation crosses requests; traceparent only to approved origins
7. environment separation: localhost → development, staging hosts → staging, otherwise production; console only in development
8. ApplicationError taxonomy: stable codes from status/name, retryability, user-safe message, cause chain (ObsDocumentScanFailure)
9. ObsApi500ErrorCapture: requestId generated → ApplicationError code → ERROR log → reporter → metric → user-safe response with support code
10. fingerprint ignores the dynamic message; same group dedupes inside the window (one log line), other component is another group
11. reporter never recurses and never throws: a failing metrics client that reports again is dropped and counted
12. ObsTelemetryBackendUnavailableNonBlocking: sink failures are counted, the user flow continues; the REMOTE sink is off and refuses to send
13. bounded buffers drop low priority first: DEBUG/INFO go before ERROR/FATAL (no infinite queue)
14. ObsHighCardinalityLabelRejected: unregistered metric, forbidden/unknown label, uncontrolled value and cardinality budget are rejected
15. histograms report percentiles (never a lone average); few samples → no p95; never-seen series is null, not 0
16. ObsTraceSamplingErrorAlwaysCaptured: with defaultRate 0 a healthy trace is dropped and an error trace is kept whole
17. ObsApiRequestTrace + ObsPricePublishTrace + async job linking: spans carry W3C ids, steps, links; open spans are swept
18. ObsQuickViewLatencyMetric + ObsMapInteractiveMetric: instrumentation reuses geo/perf.js diagnostics and labels only controlled dimensions
19. ObsCacheHitMetric + ObsCacheCorruptionError: cache snapshot as gauges; corruption logs WARN and the local alert needs 5 (one isolated error never alerts)
20. ObsPwaOfflineSyncFailure + connectivity + SW lifecycle are counted with controlled labels
21. ObsShareDeniedWithoutTokenLeak: denial counted by reason category; the token and the link never appear
22. ObsTenantScopeViolationSecurityMetric: aggregated counter, CRITICAL local alert owned by security, never auto-silenced; events aggregated by type only
23. ObsAvailabilityConflictMetric / ObsJobRetryExhausted (contracts): registered metrics accept only controlled outcomes; DLQ alert is HIGH with runbook
24. ObsFrontendErrorBoundaryFallback: local fallback with support code and safe message; the error is reported, never silent
25. global handlers: window error + unhandledrejection are captured through listeners (window.onerror untouched) and can be removed
26. ObsHealthLiveReady: live is minimal; ready needs lots + config; connectivity and dependencies say "não disponível" when unknown
27. data freshness: reads the repository FreshnessState; availability stays "não confirmado"; no limit decided → no alert, "necessita confirmação"
28. SLO: targets are proposed ("necessita confirmação"); too few samples → não disponível; error budget and burn rate; multi-window burn alerts
29. ObsDeployMarkerRegression: release marker on every error group; a new version is an operational change event
30. ObsSupportDiagnosticSnapshot + ObsMultiTabPwaIssueDiagnostic: versions, cache/PWA summaries and error refs only — no customer, token or URL
31. TenantDiagnosticOverride: needs reason + approver, at most 1 h, expires by itself; DEBUG logs only while active
32. "Saúde da plataforma": technical-only view model; unknown values say "não disponível" (never 0); markup escapes and has the actions
33. OTLP mapping is a pure contract: severity numbers, W3C ids, attributes without objects; obs modules never call the network
34. separation: observability does not write Product Analytics events, Audit events or SecurityEvents
35. legacy inventory: every item is typed and has a migration action; no console call in src passes a token, password, cookie or request body
36. backend telemetry helpers: traceparent, correlation from headers, field redaction, RED metrics by route template (never raw path), /health/live minimal
37. documentation required by §328 exists (pt-BR), plus the topic report
